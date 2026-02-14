"""
分镜 API 路由
提供分镜策略相关的 REST API

设计原则：
- 分镜结果直接存入 clips 表（复用项目已有结构）
- 通过 parent_clip_id 支持递归分镜
- 时间单位统一使用毫秒 (ms)
"""

import logging
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Depends
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.supabase_client import get_supabase, get_file_url
from app.api.auth import get_current_user_id
from app.features.shot_segmentation import (
    SegmentationStrategy,
    SegmentationRequest,
    SegmentationClip,
    get_shot_segmentation_agent,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shot-segmentation", tags=["Shot Segmentation"])


def _convert_thumbnail_path_to_url(path: Optional[str]) -> Optional[str]:
    """
    将本地缩略图路径转换为可访问的完整 URL
    
    例如: /tmp/lepus_cache/xxx/clip.jpg -> http://localhost:8000/cache/xxx/clip.jpg
    前端直接使用，无需再处理
    """
    if not path:
        return None
    
    # 如果已经是完整 URL，直接返回
    if path.startswith("http"):
        return path
    
    settings = get_settings()
    cache_dir = settings.cache_dir or "/tmp/lepus_cache"
    backend_url = settings.backend_url or "http://localhost:8000"
    
    # 如果路径以 cache_dir 开头，转换为完整 URL
    if path.startswith(cache_dir):
        relative_path = path[len(cache_dir):]
        # 确保以 / 开头
        if not relative_path.startswith("/"):
            relative_path = "/" + relative_path
        return f"{backend_url}/cache{relative_path}"
    
    # 如果是相对路径 /cache/...，补全为完整 URL
    if path.startswith("/cache"):
        return f"{backend_url}{path}"
    
    # 其他情况直接返回
    return path


async def _extract_and_upload_audio_for_asr(video_path: str, asset_id: str, supabase) -> str:
    """
    从本地视频文件提取音频，上传到 Supabase Storage，返回签名 URL
    
    Args:
        video_path: 本地视频文件路径
        asset_id: 资产 ID（用于存储路径）
        supabase: Supabase 客户端
        
    Returns:
        音频文件的签名 URL
    """
    import tempfile
    import asyncio
    import os
    
    audio_storage_path = f"asr_audio/{asset_id}.mp3"
    
    # 缓存检查：如果音频已存在，直接返回
    try:
        result = supabase.storage.from_("clips").create_signed_url(audio_storage_path, 3600)
        cached_url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        if cached_url:
            logger.info(f"[ASR] ✅ 使用缓存音频: {audio_storage_path}")
            return cached_url
    except Exception:
        pass  # 缓存不存在，继续提取
    
    logger.info(f"[ASR] 🎵 开始从本地视频提取音频...")
    
    # 提取音频到临时文件
    audio_path = os.path.join(tempfile.gettempdir(), f"asr_{asset_id}.mp3")
    
    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",                # 不要视频
            "-ar", "16000",       # 16kHz 采样率（语音识别足够）
            "-ac", "1",           # 单声道
            "-b:a", "64k",        # 64kbps 码率
            "-f", "mp3",
            audio_path
        ]
        
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            raise ValueError(f"FFmpeg 提取音频失败: {stderr.decode()[:200]}")
        
        logger.info(f"[ASR] ✅ 音频提取完成: {audio_path}")
        
        # 上传到 Supabase Storage
        with open(audio_path, "rb") as f:
            audio_data = f.read()
        
        logger.info(f"[ASR] ☁️ 上传音频到 Supabase ({len(audio_data) / 1024:.1f} KB)...")
        
        supabase.storage.from_("clips").upload(
            audio_storage_path,
            audio_data,
            {"content-type": "audio/mpeg", "upsert": "true"}
        )
        
        # 获取签名 URL
        result = supabase.storage.from_("clips").create_signed_url(audio_storage_path, 3600)
        signed_url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        
        if not signed_url:
            raise ValueError("无法获取音频签名 URL")
        
        logger.info(f"[ASR] ✅ 音频上传成功")
        return signed_url
        
    finally:
        # 清理临时文件
        if os.path.exists(audio_path):
            os.remove(audio_path)


async def _probe_video_duration_sec(video_url: str) -> Optional[float]:
    """使用 ffprobe 探测视频时长（秒）。"""
    import asyncio

    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        video_url,
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _stderr = await process.communicate()
    raw = (stdout or b"").decode(errors="ignore").strip()
    if not raw or raw.upper() == "N/A":
        return None
    try:
        value = float(raw)
        return value if value > 0 else None
    except ValueError:
        return None


async def _extract_single_frame(video_url: str, timestamp_sec: float, output_path: str) -> None:
    """使用 ffmpeg 在指定时间点抽取一帧。"""
    import asyncio

    seek = max(float(timestamp_sec), 0.0)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-ss", f"{seek:.3f}",
        "-i", video_url,
        "-frames:v", "1",
        "-q:v", "2",
        output_path,
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await process.communicate()
    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg extract failed: {(stderr or b'').decode(errors='ignore')[:240]}")


def _resolve_clip_video_context_for_extract(supabase, clip_id: str, user_id: str) -> Dict[str, Any]:
    """解析 clip 抽帧所需的视频上下文，并校验项目访问权限。"""

    clip = (
        supabase.table("clips")
        .select("id,track_id,asset_id,video_url,cached_url,source_start,source_end,start_time,end_time")
        .eq("id", clip_id)
        .single()
        .execute()
        .data
    )
    if not clip:
        raise HTTPException(status_code=404, detail=f"Clip not found: {clip_id}")

    track_id = clip.get("track_id")
    track = (
        supabase.table("tracks")
        .select("id,project_id")
        .eq("id", track_id)
        .single()
        .execute()
        .data
    )
    if not track:
        raise HTTPException(status_code=400, detail=f"Clip {clip_id} 缺少有效 track")

    project_id = track.get("project_id")
    if project_id:
        project = (
            supabase.table("projects")
            .select("id,user_id")
            .eq("id", project_id)
            .single()
            .execute()
            .data
        )
        if not project:
            raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
        owner_id = str(project.get("user_id") or "")
        if owner_id and owner_id != str(user_id):
            raise HTTPException(status_code=403, detail="无权访问该 clip")

    video_url = clip.get("video_url") or clip.get("cached_url")
    if video_url and isinstance(video_url, str) and not video_url.startswith("http"):
        # 兼容存储路径形式
        video_url = get_file_url("clips", video_url, expires_in=3600)

    if not video_url:
        asset_id = clip.get("asset_id")
        if not asset_id:
            raise HTTPException(status_code=400, detail=f"Clip {clip_id} 缺少可用视频来源")
        asset = (
            supabase.table("assets")
            .select("storage_path")
            .eq("id", asset_id)
            .single()
            .execute()
            .data
        )
        if not asset or not asset.get("storage_path"):
            raise HTTPException(status_code=400, detail=f"Clip {clip_id} 无法解析资产路径")
        video_url = get_file_url("clips", asset.get("storage_path"), expires_in=3600)

    source_start_ms = clip.get("source_start") or 0
    source_end_ms = clip.get("source_end")
    start_time_ms = clip.get("start_time") or 0
    end_time_ms = clip.get("end_time") or start_time_ms
    clip_duration_sec = max((end_time_ms - start_time_ms) / 1000.0, 0.0)

    source_start_sec = max(source_start_ms / 1000.0, 0.0)
    source_end_sec = source_end_ms / 1000.0 if source_end_ms is not None else None
    if source_end_sec is None and clip_duration_sec > 0:
        source_end_sec = source_start_sec + clip_duration_sec

    return {
        "clip": clip,
        "project_id": project_id,
        "video_url": video_url,
        "source_start_sec": source_start_sec,
        "source_end_sec": source_end_sec,
        "clip_duration_sec": clip_duration_sec if clip_duration_sec > 0 else None,
    }


# ==========================================
# 请求/响应模型
# ==========================================

class StartSegmentationRequest(BaseModel):
    """启动分镜请求"""
    strategy: str  # scene | sentence | paragraph
    
    # ============ 递归分镜支持 ============
    parent_clip_id: Optional[str] = Field(default=None, description="父 Clip ID，用于递归分镜")
    source_start_ms: Optional[int] = Field(default=None, description="分镜范围起始（毫秒）")
    source_end_ms: Optional[int] = Field(default=None, description="分镜范围结束（毫秒）")
    
    # ============ 场景分镜参数 ============
    scene_threshold: float = 27.0
    scene_min_length_ms: int = 500
    
    # ============ 分句分镜参数 ============
    min_sentence_duration_ms: int = 1500
    max_sentence_duration_ms: int = 30000
    merge_short_sentences: bool = True
    
    # ============ 段落分镜参数 ============
    target_paragraph_count: Optional[int] = None
    min_paragraph_duration_ms: int = 10000


class StartSegmentationResponse(BaseModel):
    """启动分镜响应"""
    task_id: str
    status: str = "pending"
    message: str = "分镜任务已创建"
    is_recursive: bool = False  # 是否为递归分镜


class ClipItem(BaseModel):
    """单个分镜 Clip"""
    id: str
    asset_id: str
    clip_type: str = "video"
    start_time: int      # 时间轴位置（毫秒）
    end_time: int
    source_start: int    # 源素材位置（毫秒）
    source_end: int
    parent_clip_id: Optional[str] = None
    thumbnail_url: Optional[str] = None
    transcript: Optional[str] = None
    name: Optional[str] = None
    video_url: Optional[str] = None  # ★ 替换后的视频 URL
    canvas_position: Optional[dict] = None  # ★ 画布上的位置（刷新后恢复）
    
    @property
    def duration(self) -> int:
        return self.end_time - self.start_time


class FreeNodeResponse(BaseModel):
    """自由节点响应数据"""
    id: str
    asset_id: str
    media_type: str
    thumbnail_url: Optional[str] = None
    video_url: Optional[str] = None
    duration_ms: int = 5000
    canvas_position: dict = {}
    aspect_ratio: Optional[str] = None
    generating_task_id: Optional[str] = None
    generating_capability: Optional[str] = None


class CanvasEdgeResponse(BaseModel):
    """画布连线响应数据"""
    id: str
    source: str
    target: str


class GetClipsResponse(BaseModel):
    """获取分镜结果响应"""
    session_id: str
    strategy: Optional[str] = None
    status: str  # pending | analyzing | completed | error
    clips: List[ClipItem] = []
    total_duration_ms: int = 0
    error_message: Optional[str] = None
    # ★ 自由节点 & 画布连线
    free_nodes: List[FreeNodeResponse] = []
    canvas_edges: List[CanvasEdgeResponse] = []


class ExtractClipFramesRequest(BaseModel):
    """视频节点抽帧请求"""
    frame_count: int = Field(6, ge=1, le=24, description="抽帧数量")
    start_offset_ms: int = Field(0, ge=0, le=30000, description="相对片段起点偏移")
    end_offset_ms: int = Field(0, ge=0, le=30000, description="相对片段终点偏移")


class ExtractedFrameItem(BaseModel):
    index: int
    timestamp_sec: float
    image_url: str
    asset_id: str
    storage_path: str


# ==========================================
# API 路由
# ==========================================

@router.post("/sessions/{session_id}/segment", response_model=StartSegmentationResponse)
async def start_segmentation(
    session_id: str,
    request: StartSegmentationRequest,
    background_tasks: BackgroundTasks,
):
    """
    启动分镜任务（幂等）
    
    支持两种场景:
    1. 首次分镜: 对整个 asset 进行分镜
    2. 递归分镜: 对已有的 clip 进行二次分镜（通过 parent_clip_id 指定）
    
    策略:
    - scene: 场景分镜 (基于视觉变化)
    - sentence: 分句分镜 (需要 ASR 结果)
    - paragraph: 段落分镜 (需要 ASR 结果 + LLM)
    
    幂等性:
    - 如果分镜正在进行中，直接返回 "analyzing" 状态
    - 如果分镜已完成且策略匹配，返回 "completed" 状态
    """
    
    supabase = get_supabase()
    
    # 1. 获取 Session 信息（包括 workflow_step 用于幂等性检查）
    session_result = supabase.table("workspace_sessions").select(
        "id, user_id, uploaded_asset_id, uploaded_asset_ids, status, workflow_step, project_id"
    ).eq("id", session_id).single().execute()
    
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = session_result.data
    workflow_step = session.get("workflow_step", "")
    
    # ★ 幂等性检查 1: 如果分镜正在进行中，直接返回
    if workflow_step == "shot_segmentation":
        logger.info(f"[分镜] 幂等性检查: session {session_id} 分镜正在进行中，跳过启动")
        return StartSegmentationResponse(
            task_id="",  # 无需新任务 ID
            status="analyzing",
            message=f"分镜正在进行中，请等待完成",
            is_recursive=request.parent_clip_id is not None,
        )
    
    # ★ 幂等性检查 2: 直接查询是否已有相同策略的 clips（不依赖 workflow_step）
    # 这样即使 workflow_step 状态异常，只要有对应策略的 clips 就不会重复分镜
    project_id = session.get("project_id")
    if project_id:
        # 获取现有 clips 的策略
        track_result = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
        track_ids = [t["id"] for t in (track_result.data or [])]
        if track_ids:
            clip_result = supabase.table("clips").select("id, metadata").in_("track_id", track_ids).limit(1).execute()
            if clip_result.data and len(clip_result.data) > 0:
                existing_strategy = (clip_result.data[0].get("metadata") or {}).get("strategy")
                if existing_strategy == request.strategy:
                    logger.info(f"[分镜] 幂等性检查: session {session_id} 策略 {request.strategy} 已有 clips，跳过启动")
                    # ★ 修复 workflow_step 状态（如果不一致）
                    if workflow_step != "shot_completed":
                        logger.info(f"[分镜] 修复 workflow_step: {workflow_step} -> shot_completed")
                        supabase.table("workspace_sessions").update({
                            "workflow_step": "shot_completed",
                        }).eq("id", session_id).execute()
                    return StartSegmentationResponse(
                        task_id="",
                        status="completed",
                        message=f"使用 {request.strategy} 策略的分镜已完成",
                        is_recursive=request.parent_clip_id is not None,
                    )
                else:
                    logger.info(f"[分镜] 策略变更: {existing_strategy} -> {request.strategy}，需要重新分镜")
    
    # 3. 获取 Asset ID
    asset_id = session.get("uploaded_asset_id")
    if not asset_id:
        asset_ids = session.get("uploaded_asset_ids", [])
        if asset_ids:
            asset_id = asset_ids[0]
    
    if not asset_id:
        raise HTTPException(status_code=400, detail="Session 中没有关联的视频资源")
    
    # 3. 验证策略
    try:
        strategy = SegmentationStrategy(request.strategy)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的分镜策略: {request.strategy}，可选: scene, sentence, paragraph"
        )
    
    # 4. 如果是递归分镜，验证父 Clip
    is_recursive = request.parent_clip_id is not None
    if is_recursive:
        clip_result = supabase.table("clips").select(
            "id, source_start, source_end, asset_id"
        ).eq("id", request.parent_clip_id).single().execute()
        
        if not clip_result.data:
            raise HTTPException(status_code=404, detail="Parent clip not found")
        
        parent_clip = clip_result.data
        
        # 使用父 clip 的范围（如果请求中没有指定）
        if request.source_start_ms is None:
            request.source_start_ms = parent_clip.get("source_start", 0)
        if request.source_end_ms is None:
            request.source_end_ms = parent_clip.get("source_end", 0)
    
    # 5. 创建任务
    task_id = str(uuid4())
    
    # 更新 Session 状态（策略是 action，不是 state，不存到 session）
    supabase.table("workspace_sessions").update({
        "workflow_step": "shot_segmentation",
    }).eq("id", session_id).execute()
    
    # 6. 在后台执行分镜
    background_tasks.add_task(
        run_segmentation_task,
        task_id=task_id,
        session_id=session_id,
        asset_id=asset_id,
        strategy=strategy,
        params=request,
    )
    
    return StartSegmentationResponse(
        task_id=task_id,
        status="pending",
        message=f"正在使用 {strategy.value} 策略进行{'递归' if is_recursive else ''}分镜",
        is_recursive=is_recursive,
    )



# ==========================================
# 查询接口
# ==========================================

@router.get("/sessions/{session_id}/clips")
async def get_session_clips(
    session_id: str,
    parent_clip_id: Optional[str] = Query(None, description="筛选特定父 Clip 的子分镜"),
):
    """
    获取 Session 的分镜 Clips
    
    数据模型关系: session → project → tracks → clips
    """
    
    supabase = get_supabase()
    
    # 1. 获取 Session 信息（包含 project_id）
    session_result = supabase.table("workspace_sessions").select(
        "id, project_id, user_id, workflow_step, error_message"
    ).eq("id", session_id).single().execute()
    
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = session_result.data
    project_id = session.get("project_id")
    session_user_id = session.get("user_id")
    
    if not project_id:
        return GetClipsResponse(
            session_id=session_id,
            strategy=None,
            status="pending",
            clips=[],
            total_duration_ms=0,
        )
    
    # 2. ★ 优先从 canvas_nodes 表读取（重构后的新路径）
    nodes_result = supabase.table("canvas_nodes").select("*").eq(
        "project_id", project_id
    ).order("order_index").execute()
    
    all_nodes = nodes_result.data or []
    
    # ★ 降级: canvas_nodes 为空时回退到 clips 表
    if not all_nodes:
        track_result = supabase.table("tracks").select("id").eq(
            "project_id", project_id
        ).execute()
        track_ids = [t["id"] for t in (track_result.data or [])]
        
        if not track_ids:
            return GetClipsResponse(
                session_id=session_id, strategy=None, status="pending",
                clips=[], total_duration_ms=0,
            )
        
        query = supabase.table("clips").select(
            "id, asset_id, clip_type, start_time, end_time, source_start, source_end, "
            "parent_clip_id, name, metadata, video_url"
        ).in_("track_id", track_ids).in_("clip_type", ["video", "image"])
        if parent_clip_id:
            query = query.eq("parent_clip_id", parent_clip_id)
        clips_result = query.order("start_time").execute()
        
        all_clips_data = clips_result.data or []
        clips_data = []
        free_nodes_data = []
        for clip in all_clips_data:
            metadata = clip.get("metadata", {}) or {}
            if metadata.get("canvas_mode") == "free":
                free_nodes_data.append(clip)
            else:
                clips_data.append(clip)
    else:
        # ★ 从 canvas_nodes 构建兼容的 clips_data / free_nodes_data
        clips_data = []
        free_nodes_data = []
        for node in all_nodes:
            # 转换 canvas_node 为 clip 兼容格式
            meta = node.get("metadata") or {}
            compat = {
                "id": node.get("id"),
                "asset_id": node.get("asset_id"),
                "clip_type": node.get("media_type", "video"),
                "start_time": int((node.get("start_time") or 0) * 1000),
                "end_time": int((node.get("end_time") or 0) * 1000),
                "source_start": node.get("source_start", 0),
                "source_end": node.get("source_end", 0),
                "parent_clip_id": None,
                "name": meta.get("name"),
                "metadata": {
                    **meta,
                    "thumbnail_url": node.get("thumbnail_url") or meta.get("thumbnail_url"),
                    "canvas_position": node.get("canvas_position"),
                },
                "video_url": node.get("video_url"),
            }
            if node.get("node_type") == "free":
                compat["metadata"]["canvas_mode"] = "free"
                free_nodes_data.append(compat)
            else:
                clips_data.append(compat)
    
    # 5. 判断状态
    workflow_step = session.get("workflow_step", "")
    
    if workflow_step == "shot_segmentation":
        status = "analyzing"
    elif len(clips_data) > 0:
        status = "completed"
    else:
        status = "pending"
    
    # 5. 转换格式
    clips = []
    total_duration_ms = 0
    
    for clip in clips_data:
        metadata = clip.get("metadata", {}) or {}
        # 将本地缩略图路径转换为可访问的 URL
        thumbnail_url = _convert_thumbnail_path_to_url(metadata.get("thumbnail_url"))
        # ★ 图片类型：优先用素材本身的签名 URL（避免过期问题）
        if clip.get("clip_type") == "image" and clip.get("asset_id"):
            try:
                asset_result = supabase.table("assets").select("storage_path").eq("id", clip["asset_id"]).single().execute()
                if asset_result.data and asset_result.data.get("storage_path"):
                    thumbnail_url = get_file_url("clips", asset_result.data["storage_path"])
            except Exception as e:
                logger.warning(f"[Segmentation] ⚠️ 获取 clip {clip.get('id', '?')} 缩略图失败: {e}")
        clips.append(ClipItem(
            id=clip.get("id", ""),
            asset_id=clip.get("asset_id", ""),
            clip_type=clip.get("clip_type", "video"),
            start_time=clip.get("start_time", 0),
            end_time=clip.get("end_time", 0),
            source_start=clip.get("source_start", 0),
            source_end=clip.get("source_end", 0),
            parent_clip_id=clip.get("parent_clip_id"),
            thumbnail_url=thumbnail_url,
            transcript=metadata.get("transcript"),
            name=clip.get("name"),
            video_url=clip.get("video_url"),  # ★ 替换后的视频 URL
            canvas_position=metadata.get("canvas_position"),  # ★ 画布位置
        ))
        total_duration_ms = max(total_duration_ms, clip.get("end_time", 0))
    
    # 从第一个 clip 的 metadata 获取策略（每个 clip 可能不同）
    first_clip_strategy = None
    if clips_data:
        first_metadata = clips_data[0].get("metadata", {}) or {}
        first_clip_strategy = first_metadata.get("strategy")
    
    # ★ 转换自由节点
    free_nodes_response = []
    for fn_clip in free_nodes_data:
        fn_meta = fn_clip.get("metadata", {}) or {}
        fn_asset_id = fn_clip.get("asset_id")

        # 治本：历史脏数据修复 —— 画布节点若缺少 asset_id，自动补建 asset 并回写 clip
        if not fn_asset_id:
            is_image_node = fn_clip.get("clip_type") == "image"
            fallback_ext = "jpg" if is_image_node else "mp4"
            fallback_mime = "image/jpeg" if is_image_node else "video/mp4"
            generated_asset_id = str(uuid4())
            fallback_url = fn_meta.get("thumbnail_url") if is_image_node else (fn_clip.get("video_url") or fn_meta.get("thumbnail_url"))
            asset_payload = {
                "id": generated_asset_id,
                "project_id": project_id,
                "user_id": session_user_id,
                "name": f"canvas-node-{fn_clip.get('id', '')[:8]}",
                "original_filename": f"canvas-node-{fn_clip.get('id', '')[:8]}.{fallback_ext}",
                "file_type": "image" if is_image_node else "video",
                "mime_type": fallback_mime,
                "file_size": 0,
                "storage_path": f"virtual/free-nodes/{session_id}/{fn_clip.get('id', '')}.{fallback_ext}",
                "duration": max(0.0, float(max(0, fn_clip.get("end_time", 0) - fn_clip.get("start_time", 0))) / 1000.0),
                "status": "ready",
                "metadata": {
                    "is_virtual": True,
                    "source": "canvas_free_node_backfill",
                    "external_url": fallback_url,
                },
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
            }
            try:
                supabase.table("assets").insert(asset_payload).execute()
                supabase.table("clips").update({"asset_id": generated_asset_id}).eq("id", fn_clip.get("id", "")).execute()
                fn_asset_id = generated_asset_id
                fn_clip["asset_id"] = generated_asset_id
                logger.info("[GetClips] 已为自由节点补建 asset_id: clip=%s asset=%s", fn_clip.get("id"), generated_asset_id)
            except Exception as backfill_err:
                logger.warning("[GetClips] 自由节点补建 asset 失败 clip=%s err=%s", fn_clip.get("id"), backfill_err)

        fn_thumbnail = _convert_thumbnail_path_to_url(fn_meta.get("thumbnail_url"))
        # ★ 图片类型：优先用素材本身的签名 URL（避免过期问题）
        if fn_clip.get("clip_type") == "image" and fn_asset_id:
            try:
                asset_res = supabase.table("assets").select("storage_path").eq("id", fn_asset_id).single().execute()
                if asset_res.data and asset_res.data.get("storage_path"):
                    fn_thumbnail = get_file_url("clips", asset_res.data["storage_path"])
            except Exception as e:
                logger.warning(f"[Segmentation] ⚠️ 获取自由节点缩略图失败: {e}")
        free_nodes_response.append(FreeNodeResponse(
            id=fn_clip.get("id", ""),
            asset_id=fn_asset_id or "",
            media_type=fn_clip.get("clip_type", "video"),
            thumbnail_url=fn_thumbnail,
            video_url=fn_clip.get("video_url"),
            duration_ms=max(0, fn_clip.get("end_time", 0) - fn_clip.get("start_time", 0)),
            canvas_position=fn_meta.get("canvas_position", {"x": 200, "y": 200}),
            aspect_ratio=fn_meta.get("aspect_ratio"),
            generating_task_id=fn_meta.get("generating_task_id"),
            generating_capability=fn_meta.get("generating_capability"),
        ))
    
    # ★ 获取画布连线（优先从 canvas_edges 表，降级到 session metadata）
    canvas_edges_response = []
    try:
        edges_result = supabase.table("canvas_edges").select("*").eq(
            "project_id", project_id
        ).execute()
        if edges_result.data:
            for edge_data in edges_result.data:
                canvas_edges_response.append(CanvasEdgeResponse(
                    id=edge_data.get("id", ""),
                    source=edge_data.get("source_node_id", ""),
                    target=edge_data.get("target_node_id", ""),
                ))
        else:
            # 降级: 从 session metadata 读取
            session_meta = session.get("metadata") or {}
            if not session_meta:
                sess_meta_result = supabase.table("workspace_sessions").select("metadata").eq("id", session_id).single().execute()
                if sess_meta_result.data:
                    session_meta = sess_meta_result.data.get("metadata") or {}
            for edge_data in session_meta.get("canvas_edges", []):
                canvas_edges_response.append(CanvasEdgeResponse(
                    id=edge_data.get("id", ""),
                    source=edge_data.get("source", ""),
                    target=edge_data.get("target", ""),
                ))
    except Exception as e:
        logger.warning(f"[GetClips] 获取画布连线失败: {e}")
    
    return GetClipsResponse(
        session_id=session_id,
        strategy=first_clip_strategy,
        status=status,
        clips=clips,
        total_duration_ms=total_duration_ms,
        error_message=session.get("error_message"),
        free_nodes=free_nodes_response,
        canvas_edges=canvas_edges_response,
    )


# ==========================================
# 批量创建 Clips（从素材库添加）
# ==========================================

class BatchClipItem(BaseModel):
    """批量创建的单个 Clip 数据"""
    id: str  # 前端生成的 UUID
    asset_id: str
    start_time: int  # 毫秒
    end_time: int  # 毫秒
    source_start: Optional[int] = None
    source_end: Optional[int] = None
    thumbnail_url: Optional[str] = None
    video_url: Optional[str] = None  # ★ 素材视频 URL
    clip_type: str = "video"  # ★ 支持 image / video


class BatchCreateClipsRequest(BaseModel):
    """批量创建 Clips 请求"""
    after_clip_id: str  # 在此 clip 之后插入
    clips: List[BatchClipItem]


@router.post("/sessions/{session_id}/clips/batch")
async def batch_create_clips(session_id: str, request: BatchCreateClipsRequest):
    """
    批量创建 Clips（从素材库添加到时间轴）
    
    1. 获取 session 的 project 和 track
    2. 在指定位置插入新的 clips
    3. 更新后续 clips 的时间位置
    """
    import uuid
    
    supabase = get_supabase()
    
    # 1. 获取 Session 信息
    session_result = supabase.table("workspace_sessions").select(
        "id, project_id"
    ).eq("id", session_id).single().execute()
    
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    project_id = session_result.data.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="Session has no project")
    
    # 2. 获取 Track（使用第一个 track，按 order_index 排序）
    # 注意：tracks 表没有 type 字段，它是通用容器
    track_result = supabase.table("tracks").select("id").eq(
        "project_id", project_id
    ).order("order_index").limit(1).execute()
    
    if not track_result.data:
        raise HTTPException(status_code=400, detail="No track found for this project")
    
    track_id = track_result.data[0]["id"]
    
    # 3. 获取 after_clip 的位置信息
    after_clip_result = supabase.table("clips").select(
        "id, start_time, end_time, track_id"
    ).eq("id", request.after_clip_id).single().execute()
    
    if not after_clip_result.data:
        raise HTTPException(status_code=404, detail="After clip not found")
    
    after_clip = after_clip_result.data
    # ★ 使用 after_clip 所在的 track，而不是第一个 track
    track_id = after_clip.get("track_id") or track_id
    insert_time = after_clip["end_time"]  # 新 clips 从这个时间开始
    
    # 4. 计算需要移动的时间量（所有新 clips 的总时长）
    total_new_duration = sum(c.end_time - c.start_time for c in request.clips)
    
    # 5. 更新后续 clips 的时间（需要后移）
    # 获取所有在 after_clip 之后的 clips
    later_clips_result = supabase.table("clips").select("id, start_time, end_time").eq(
        "track_id", track_id
    ).gt("start_time", after_clip["end_time"]).execute()
    
    # 批量更新时间
    for later_clip in (later_clips_result.data or []):
        supabase.table("clips").update({
            "start_time": later_clip["start_time"] + total_new_duration,
            "end_time": later_clip["end_time"] + total_new_duration,
        }).eq("id", later_clip["id"]).execute()
    
    # 6. 创建新的 clips
    created_clips = []
    current_time = insert_time
    
    for clip_data in request.clips:
        duration = clip_data.end_time - clip_data.start_time
        
        # ★ 验证或生成有效的 UUID
        try:
            clip_id = str(uuid.UUID(clip_data.id))  # 验证是否为有效 UUID
        except (ValueError, AttributeError):
            clip_id = str(uuid.uuid4())  # 如果无效，自动生成
        
        new_clip = {
            "id": clip_id,
            "track_id": track_id,
            "asset_id": clip_data.asset_id,
            "clip_type": clip_data.clip_type,  # ★ 使用前端传入的类型（image/video）
            "start_time": current_time,
            "end_time": current_time + duration,
            "source_start": clip_data.source_start or 0,
            "source_end": clip_data.source_end or duration,
            "video_url": clip_data.video_url,  # ★ 保存素材视频 URL
            "metadata": {
                "thumbnail_url": clip_data.thumbnail_url,
                "added_from": "material_picker",
            },
        }
        
        supabase.table("clips").insert(new_clip).execute()
        created_clips.append(new_clip)
        current_time += duration
    
    logger.info(f"[BatchCreateClips] ✅ 创建 {len(created_clips)} 个 clips，插入位置: {request.after_clip_id}")
    
    # ★ 同步写入 canvas_nodes 表（Visual Editor 专用）
    try:
        from datetime import datetime as dt
        now_cn = dt.utcnow().isoformat()
        # 获取当前最大 order_index
        existing_nodes = supabase.table("canvas_nodes").select("order_index").eq(
            "project_id", project_id
        ).order("order_index", desc=True).limit(1).execute()
        max_order = (existing_nodes.data[0]["order_index"] + 1) if existing_nodes.data else 0
        
        canvas_rows = []
        for idx, clip in enumerate(created_clips):
            duration_ms = clip["end_time"] - clip["start_time"]
            canvas_rows.append({
                "id": str(uuid.uuid4()),
                "project_id": project_id,
                "asset_id": clip["asset_id"],
                "node_type": "sequence",
                "media_type": clip.get("clip_type", "video"),
                "order_index": max_order + idx,
                "start_time": clip["start_time"] / 1000.0,
                "end_time": clip["end_time"] / 1000.0,
                "duration": duration_ms / 1000.0,
                "source_start": clip.get("source_start", 0),
                "source_end": clip.get("source_end", duration_ms),
                "canvas_position": {"x": 0, "y": 0},
                "video_url": clip.get("video_url"),
                "thumbnail_url": (clip.get("metadata") or {}).get("thumbnail_url"),
                "metadata": {"added_from": "material_picker"},
                "clip_id": clip["id"],
                "created_at": now_cn,
                "updated_at": now_cn,
            })
        if canvas_rows:
            supabase.table("canvas_nodes").insert(canvas_rows).execute()
            logger.info(f"[BatchCreateClips] ✅ 同步创建 {len(canvas_rows)} 个 canvas_nodes")
    except Exception as e:
        logger.warning(f"[BatchCreateClips] ⚠️ canvas_nodes 写入失败（不影响主流程）: {e}")
    
    return {
        "success": True,
        "session_id": session_id,
        "created_count": len(created_clips),
        "clips": [{"id": c["id"], "start_time": c["start_time"], "end_time": c["end_time"]} for c in created_clips],
    }


@router.post("/clips/{clip_id}/extract-frames")
async def extract_clip_frames(
    clip_id: str,
    request: ExtractClipFramesRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    对单个视频节点执行均匀抽帧，返回可直接用于创建自由图片节点的数据。
    """
    import os
    import tempfile

    supabase = get_supabase()
    context = _resolve_clip_video_context_for_extract(supabase, clip_id, user_id)

    if not context.get("video_url"):
        raise HTTPException(status_code=400, detail="未找到可用视频 URL")

    # 探测时长；若无法探测则由 clip 元数据兜底
    probed_duration = await _probe_video_duration_sec(context["video_url"])

    if probed_duration and probed_duration > 0:
        duration_sec = float(probed_duration)
    elif context.get("source_end_sec"):
        duration_sec = float(context["source_end_sec"])
    elif context.get("clip_duration_sec"):
        duration_sec = float(context.get("source_start_sec") or 0.0) + float(context["clip_duration_sec"])
    else:
        raise HTTPException(status_code=400, detail="无法确定视频时长，无法抽帧")

    source_start_sec = float(context.get("source_start_sec") or 0.0)
    source_end_sec = context.get("source_end_sec")
    clip_duration_sec = context.get("clip_duration_sec")

    if source_end_sec is None:
        if clip_duration_sec:
            source_end_sec = source_start_sec + float(clip_duration_sec)
        else:
            source_end_sec = duration_sec

    source_end_sec = max(source_start_sec, min(float(source_end_sec), duration_sec))

    start_offset_sec = max(request.start_offset_ms / 1000.0, 0.0)
    end_offset_sec = max(request.end_offset_ms / 1000.0, 0.0)

    window_start = min(source_start_sec + start_offset_sec, source_end_sec)
    window_end = max(window_start, source_end_sec - end_offset_sec)

    # 留一点安全边界，避免贴边抽帧在某些编码下取不到关键帧
    safe_margin = 0.02
    if window_end - window_start > safe_margin * 2:
        window_start += safe_margin
        window_end -= safe_margin

    if window_end <= window_start:
        raise HTTPException(status_code=400, detail="抽帧窗口无效，请减少起止偏移")

    if request.frame_count == 1:
        timestamps = [(window_start + window_end) / 2.0]
    else:
        step = (window_end - window_start) / (request.frame_count - 1)
        timestamps = [window_start + (step * i) for i in range(request.frame_count)]

    project_id = context.get("project_id")
    frames: List[Dict[str, Any]] = []

    try:
        with tempfile.TemporaryDirectory(prefix="clip-extract-frames-") as tmp_dir:
            for idx, ts in enumerate(timestamps):
                local_frame_path = os.path.join(tmp_dir, f"frame-{idx+1:02d}.jpg")
                await _extract_single_frame(context["video_url"], ts, local_frame_path)

                with open(local_frame_path, "rb") as f:
                    frame_bytes = f.read()

                frame_asset_id = str(uuid4())
                storage_path = f"extracted-frames/{project_id or 'global'}/{clip_id}/{frame_asset_id}.jpg"

                supabase.storage.from_("clips").upload(
                    storage_path,
                    frame_bytes,
                    {"content-type": "image/jpeg", "upsert": "true"},
                )

                asset_record = {
                    "id": frame_asset_id,
                    "project_id": project_id,
                    "user_id": user_id,
                    "name": f"clip-{clip_id}-frame-{idx+1:02d}",
                    "original_filename": f"clip-{clip_id}-frame-{idx+1:02d}.jpg",
                    "file_type": "image",
                    "mime_type": "image/jpeg",
                    "file_size": len(frame_bytes),
                    "storage_path": storage_path,
                    "status": "ready",
                }
                supabase.table("assets").insert(asset_record).execute()

                frame_url = get_file_url("clips", storage_path, expires_in=3600)
                frames.append({
                    "index": idx,
                    "timestamp_sec": round(ts, 3),
                    "image_url": frame_url,
                    "asset_id": frame_asset_id,
                    "storage_path": storage_path,
                })
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[ExtractFrames] 抽帧失败 clip=%s error=%s", clip_id, exc)
        raise HTTPException(status_code=400, detail=f"抽帧失败: {exc}")

    return {
        "success": True,
        "clip_id": clip_id,
        "frame_count": len(frames),
        "window_start_sec": round(window_start, 3),
        "window_end_sec": round(window_end, 3),
        "frames": frames,
    }


class ClipUpdateRequest(BaseModel):
    """更新 Clip 请求"""
    source_start: Optional[int] = None
    source_end: Optional[int] = None
    name: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None  # ★ 缩略图 URL


@router.patch("/clips/{clip_id}")
async def update_clip(clip_id: str, request: ClipUpdateRequest):
    """
    更新分镜（包括替换视频和缩略图）
    """
    supabase = get_supabase()
    
    # 获取当前 Clip
    clip_result = supabase.table("clips").select("*").eq("id", clip_id).single().execute()
    if not clip_result.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    
    # 构建更新数据
    update_data = {}
    if request.source_start is not None:
        update_data["source_start"] = request.source_start
    if request.source_end is not None:
        update_data["source_end"] = request.source_end
    if request.name is not None:
        update_data["name"] = request.name
    if request.video_url is not None:
        update_data["video_url"] = request.video_url
    
    # ★ 更新缩略图：存储在 metadata.thumbnail_url
    if request.thumbnail_url is not None:
        current_metadata = clip_result.data.get("metadata") or {}
        current_metadata["thumbnail_url"] = request.thumbnail_url
        update_data["metadata"] = current_metadata
    
    if not update_data:
        return {"success": True, "clip_id": clip_id, "message": "No changes"}
    
    supabase.table("clips").update(update_data).eq("id", clip_id).execute()
    
    return {"success": True, "clip_id": clip_id, "updated": update_data}



@router.delete("/clips/{clip_id}")
async def delete_clip(clip_id: str):
    """
    删除单个 Clip
    
    1. 获取 clip 信息用于时间调整
    2. 删除 clip
    3. 调整后续 clips 的时间
    """
    supabase = get_supabase()
    
    # 1. 获取要删除的 clip 信息
    clip_result = supabase.table("clips").select(
        "id, track_id, start_time, end_time"
    ).eq("id", clip_id).single().execute()
    
    if not clip_result.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    
    clip = clip_result.data
    track_id = clip["track_id"]
    deleted_duration = clip["end_time"] - clip["start_time"]
    deleted_end_time = clip["end_time"]
    
    # 2. 删除 clip
    supabase.table("clips").delete().eq("id", clip_id).execute()
    
    # 3. 调整后续 clips 的时间（前移）
    later_clips_result = supabase.table("clips").select(
        "id, start_time, end_time"
    ).eq("track_id", track_id).gt("start_time", deleted_end_time).execute()
    
    for later_clip in (later_clips_result.data or []):
        supabase.table("clips").update({
            "start_time": later_clip["start_time"] - deleted_duration,
            "end_time": later_clip["end_time"] - deleted_duration,
        }).eq("id", later_clip["id"]).execute()
    
    logger.info(f"[DeleteClip] ✅ 删除 clip: {clip_id}, 调整 {len(later_clips_result.data or [])} 个后续 clips")
    
    return {"success": True, "clip_id": clip_id}


class UploadThumbnailRequest(BaseModel):
    """上传缩略图请求"""
    clip_id: str
    base64_data: str  # data:image/jpeg;base64,... 或纯 base64


@router.post("/clips/{clip_id}/upload-thumbnail")
async def upload_clip_thumbnail(clip_id: str, request: UploadThumbnailRequest):
    """
    上传 Clip 缩略图到 Supabase Storage
    
    接收前端截取的 base64 图片，上传到云存储，返回 URL
    """
    import base64
    import tempfile
    import os
    
    supabase = get_supabase()
    
    # 检查 clip 是否存在
    clip_result = supabase.table("clips").select("id").eq("id", clip_id).single().execute()
    if not clip_result.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    
    try:
        # 解析 base64 数据
        base64_str = request.base64_data
        if base64_str.startswith("data:"):
            # 移除 data:image/jpeg;base64, 前缀
            base64_str = base64_str.split(",", 1)[1]
        
        # 解码
        image_data = base64.b64decode(base64_str)
        
        # 保存到临时文件
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp.write(image_data)
            tmp_path = tmp.name
        
        try:
            # 上传到 Supabase Storage（使用与现有缩略图相同的 bucket）
            STORAGE_BUCKET = "ai-creations"
            storage_path = f"thumbnails/{clip_id}_replaced.jpg"
            
            # 先尝试删除已存在的文件
            try:
                supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
            except:
                pass
            
            # 上传
            supabase.storage.from_(STORAGE_BUCKET).upload(
                storage_path,
                image_data,
                {"content-type": "image/jpeg"}
            )
            
            # 获取公开 URL
            public_url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
            
            # 更新 clip 的 metadata.thumbnail_url
            clip_data = supabase.table("clips").select("metadata").eq("id", clip_id).single().execute()
            current_metadata = clip_data.data.get("metadata") or {} if clip_data.data else {}
            current_metadata["thumbnail_url"] = public_url
            supabase.table("clips").update({"metadata": current_metadata}).eq("id", clip_id).execute()
            
            logger.info(f"[UploadThumbnail] ✅ 上传成功: {clip_id} -> {public_url[:60]}...")
            
            return {"success": True, "clip_id": clip_id, "thumbnail_url": public_url}
            
        finally:
            # 清理临时文件
            os.unlink(tmp_path)
            
    except Exception as e:
        logger.error(f"[UploadThumbnail] ❌ 上传失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 后台任务
# ==========================================

async def run_segmentation_task(
    task_id: str,
    session_id: str,
    asset_id: str,
    strategy: SegmentationStrategy,
    params: StartSegmentationRequest,
):
    """
    后台执行分镜任务
    
    分镜结果直接存入 clips 表
    """
    import os
    from app.config import get_settings
    
    settings = get_settings()
    supabase = get_supabase()
    
    try:
        is_recursive = params.parent_clip_id is not None
        logger.info(
            f"开始分镜任务: session={session_id}, strategy={strategy.value}, "
            f"recursive={is_recursive}"
        )
        
        # 1. 获取 Asset 信息
        asset_result = supabase.table("assets").select(
            "id, storage_path, metadata, duration"
        ).eq("id", asset_id).single().execute()
        
        if not asset_result.data:
            raise ValueError("Asset not found")
        
        asset = asset_result.data
        
        # 2. 构建视频路径
        # PySceneDetect/OpenCV 需要直接可读取的本地视频文件
        # 需要把远程视频下载到本地临时文件
        storage_path = asset.get("storage_path", "")
        temp_video_path = None  # 用于追踪需要清理的临时文件
        
        import tempfile
        import subprocess
        import hashlib
        
        temp_dir = settings.cache_dir or tempfile.gettempdir()
        
        if storage_path.startswith("cloudflare:"):
            # Cloudflare Stream 视频
            video_uid = storage_path.replace("cloudflare:", "")
            hls_url = f"https://videodelivery.net/{video_uid}/manifest/video.m3u8"
            temp_video_path = os.path.join(temp_dir, f"shot_seg_{video_uid}.mp4")
            
            logger.info(f"下载 Cloudflare HLS 到临时文件: {hls_url}")
            download_url = hls_url
            
        elif storage_path.startswith("http"):
            # 已经是 HTTP URL
            download_url = storage_path
            path_hash = hashlib.md5(storage_path.encode()).hexdigest()[:12]
            temp_video_path = os.path.join(temp_dir, f"shot_seg_{path_hash}.mp4")
            
        else:
            # Supabase Storage 路径（如 uploads/xxx/xxx.mp4）
            from app.services.supabase_client import get_file_url
            download_url = get_file_url("clips", storage_path, expires_in=3600)
            
            if not download_url:
                raise ValueError(f"无法获取视频 URL: {storage_path}")
            
            path_hash = hashlib.md5(storage_path.encode()).hexdigest()[:12]
            temp_video_path = os.path.join(temp_dir, f"shot_seg_{path_hash}.mp4")
            
            logger.info(f"获取 Supabase 签名 URL: {download_url[:80]}...")
        
        # 下载视频到临时文件（使用异步方式，避免阻塞事件循环）
        import asyncio
        
        if not os.path.exists(temp_video_path):
            logger.info(f"下载视频到临时文件: {temp_video_path}")
            
            try:
                # ★ 使用异步 subprocess，避免阻塞事件循环导致连接断开
                process = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y",
                    "-i", download_url,
                    "-c", "copy",  # 直接复制，不重新编码
                    "-movflags", "+faststart",
                    temp_video_path,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                
                # 等待完成，设置超时
                try:
                    stdout, stderr = await asyncio.wait_for(
                        process.communicate(),
                        timeout=300  # 5 分钟超时
                    )
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
                    raise ValueError("视频下载超时（>5分钟）")
                
                if process.returncode != 0:
                    error_msg = stderr.decode() if stderr else "未知错误"
                    logger.error(f"FFmpeg 下载失败: {error_msg}")
                    raise ValueError(f"无法下载视频: {error_msg[:200]}")
                
                logger.info(f"视频下载完成: {temp_video_path}")
                
            except FileNotFoundError:
                raise ValueError("FFmpeg 未安装，无法处理视频")
        else:
            logger.info(f"使用缓存的临时文件: {temp_video_path}")
        
        video_path = temp_video_path
        
        if not video_path or not os.path.exists(video_path):
            raise ValueError(f"视频文件不存在: {video_path}")
        
        # 3. 获取 ASR 结果 (如果有)
        metadata = asset.get("metadata", {}) or {}
        transcript_segments = metadata.get("transcript_segments", [])
        
        logger.info(f"[分镜任务] 📋 ASR transcript_segments 来自 metadata: {len(transcript_segments)} 条")
        if transcript_segments:
            # 打印前3个 segments 的结构
            for i, seg in enumerate(transcript_segments[:3]):
                logger.info(f"[分镜任务]   ASR样本[{i}]: {seg}")
            if len(transcript_segments) > 3:
                logger.info(f"[分镜任务]   ... 还有 {len(transcript_segments) - 3} 条")
        
        # 3.5 如果策略需要 ASR 但没有结果，自动执行 ASR
        if strategy in [SegmentationStrategy.SENTENCE, SegmentationStrategy.PARAGRAPH]:
            if not transcript_segments or len(transcript_segments) == 0:
                logger.info(f"策略 {strategy.value} 需要 ASR，开始自动转写...")
                
                # 使用已下载的本地视频文件提取音频，上传到 Supabase 获取公开 URL
                asr_audio_url = await _extract_and_upload_audio_for_asr(
                    video_path=video_path,
                    asset_id=asset_id,
                    supabase=supabase,
                )
                
                logger.info(f"ASR 音频 URL: {asr_audio_url[:80]}...")
                
                # 执行 ASR 转写
                from app.tasks.transcribe import transcribe_audio
                
                asr_result = await transcribe_audio(
                    audio_url=asr_audio_url,
                    language="zh",
                    audio_format="mp3",
                    enable_word_timestamps=True,
                    enable_ddc=True,  # 语义顺滑
                )
                
                transcript_segments = asr_result.get("segments", [])
                logger.info(f"[分镜任务] 🎤 ASR 转写完成: {len(transcript_segments)} 个分句")
                
                # 打印 ASR 结果详情
                for i, seg in enumerate(transcript_segments):
                    start = seg.get('start', seg.get('start_ms', 0))
                    end = seg.get('end', seg.get('end_ms', 0))
                    text = seg.get('text', seg.get('transcript', ''))[:50]
                    logger.info(f"[分镜任务]   ASR[{i+1}]: [{start}-{end}] {text}...")
                
                # 将 ASR 结果保存到 asset metadata
                new_metadata = {**metadata, "transcript_segments": transcript_segments}
                supabase.table("assets").update({
                    "metadata": new_metadata
                }).eq("id", asset_id).execute()
                logger.info("[分镜任务] 💾 ASR 结果已保存到 asset metadata")
        
        # 4. 创建分镜请求
        seg_request = SegmentationRequest(
            session_id=session_id,
            asset_id=asset_id,
            strategy=strategy,
            parent_clip_id=params.parent_clip_id,
            source_start_ms=params.source_start_ms,
            source_end_ms=params.source_end_ms,
            scene_threshold=params.scene_threshold,
            scene_min_length_ms=params.scene_min_length_ms,
            min_sentence_duration_ms=params.min_sentence_duration_ms,
            max_sentence_duration_ms=params.max_sentence_duration_ms,
            merge_short_sentences=params.merge_short_sentences,
            target_paragraph_count=params.target_paragraph_count,
            min_paragraph_duration_ms=params.min_paragraph_duration_ms,
        )
        
        # 5. 执行分镜
        logger.info(f"[分镜任务] 🚀 开始执行分镜: strategy={strategy.value}, transcript_segments={len(transcript_segments)}条")
        logger.info(f"[分镜任务]   参数: min_sentence={seg_request.min_sentence_duration_ms}ms, max_sentence={seg_request.max_sentence_duration_ms}ms, merge={seg_request.merge_short_sentences}")
        
        agent = get_shot_segmentation_agent()
        result = await agent.segment(
            request=seg_request,
            video_path=video_path,
            transcript_segments=transcript_segments,
            extract_thumbnails_flag=True,
        )
        
        logger.info(f"[分镜任务] ✅ 分镜完成: 生成 {len(result.clips)} 个 clips")
        
        # 6. 获取或创建 Track
        track_id = await _get_or_create_track(supabase, session_id, asset_id)
        
        # 7. 删除旧的 Clips
        if is_recursive:
            # 递归分镜：删除指定父 clip 的子 clips
            supabase.table("clips").delete().eq(
                "parent_clip_id", params.parent_clip_id
            ).execute()
            logger.info(f"已删除 parent_clip_id={params.parent_clip_id} 的子分镜")
        else:
            # 非递归分镜：删除该 track 下所有无父节点的 clips（保留有 parent_clip_id 的子分镜）
            supabase.table("clips").delete().eq(
                "track_id", track_id
            ).is_("parent_clip_id", "null").execute()
            logger.info(f"已删除 track_id={track_id} 的顶层分镜")
        
        # 8. 保存 Clips 到数据库
        clips_to_insert = []
        for clip in result.clips:
            clip_data = {
                "id": clip.id,
                "track_id": track_id,
                "asset_id": clip.asset_id,
                "clip_type": "video",
                "start_time": clip.start_time,
                "end_time": clip.end_time,
                "source_start": clip.source_start,
                "source_end": clip.source_end,
                "parent_clip_id": clip.parent_clip_id,
                "name": clip.name,
                "metadata": {
                    "strategy": strategy.value,
                    "transcript": clip.transcript,
                    "thumbnail_url": clip.thumbnail_url,
                    **clip.metadata,
                },
            }
            clips_to_insert.append(clip_data)
        
        if clips_to_insert:
            supabase.table("clips").insert(clips_to_insert).execute()
        
        # 9. 更新 Session 状态
        # 注：策略信息存在每个 clip.metadata.strategy 中
        # 支持同一 session 用不同策略切分不同 clip
        supabase.table("workspace_sessions").update({
            "workflow_step": "shot_completed",
        }).eq("id", session_id).execute()
        
        logger.info(f"分镜完成: {len(result.clips)} 个分镜已保存到 clips 表")
        
    except Exception as e:
        logger.error(f"分镜任务失败: {e}")
        import traceback
        traceback.print_exc()
        
        supabase.table("workspace_sessions").update({
            "workflow_step": "shot_error",
            "error_message": str(e),
        }).eq("id", session_id).execute()
    
    finally:
        # 清理临时文件
        if temp_video_path and os.path.exists(temp_video_path):
            try:
                os.remove(temp_video_path)
                logger.info(f"已清理临时视频文件: {temp_video_path}")
            except Exception as cleanup_err:
                logger.warning(f"清理临时文件失败: {cleanup_err}")


async def _get_or_create_track(supabase, session_id: str, asset_id: str) -> str:
    """
    获取或创建 Project 的主视频轨道
    
    数据模型: session → project → tracks
    """
    
    # 1. 获取 session 的 project_id
    session_result = supabase.table("workspace_sessions").select(
        "project_id"
    ).eq("id", session_id).single().execute()
    
    if not session_result.data or not session_result.data.get("project_id"):
        raise ValueError(f"Session {session_id} 没有关联的 project")
    
    project_id = session_result.data["project_id"]
    
    # 2. 查找现有轨道
    track_result = supabase.table("tracks").select("id").eq(
        "project_id", project_id
    ).eq("name", "视频轨道").execute()
    
    if track_result.data and len(track_result.data) > 0:
        return track_result.data[0]["id"]
    
    # 3. 创建新轨道
    new_track = {
        "id": str(uuid4()),
        "project_id": project_id,
        "name": "视频轨道",
        "order_index": 0,
    }
    
    supabase.table("tracks").insert(new_track).execute()
    
    return new_track["id"]


# ==========================================
# ★ 自由节点 API（画布上独立于时间轴的素材）
# ==========================================

class FreeNodeItem(BaseModel):
    """自由节点数据"""
    id: str
    asset_id: Optional[str] = None
    media_type: str = "video"
    thumbnail_url: Optional[str] = None
    video_url: Optional[str] = None
    duration_ms: int = 0
    canvas_position: dict = Field(default_factory=lambda: {"x": 200, "y": 200})
    aspect_ratio: Optional[str] = None
    generating_task_id: Optional[str] = None
    generating_capability: Optional[str] = None


class BatchCreateFreeNodesRequest(BaseModel):
    """批量创建自由节点"""
    nodes: List[FreeNodeItem]


@router.post("/sessions/{session_id}/free-nodes/batch")
async def batch_create_free_nodes(session_id: str, request: BatchCreateFreeNodesRequest):
    """
    批量创建自由节点（存储在 clips 表，metadata.canvas_mode='free'）
    """
    import uuid
    supabase = get_supabase()

    session_result = supabase.table("workspace_sessions").select("id, project_id, user_id").eq("id", session_id).single().execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session_project_id = session_result.data.get("project_id")
    session_user_id = session_result.data.get("user_id")
    now = datetime.utcnow().isoformat()
    
    # 获取 track_id（取第一个节点的 asset_id 作为参考）
    first_asset_id = request.nodes[0].asset_id if request.nodes else ""
    track_id = await _get_or_create_track(supabase, session_id, first_asset_id)
    
    created = []
    for node in request.nodes:
        # ★ clip_id 必须是合法 UUID（clips.id 列是 UUID 类型）
        raw_clip_id = node.id
        try:
            clip_id = str(uuid.UUID(raw_clip_id))
        except (ValueError, AttributeError):
            # gen-xxx 或其他非 UUID 格式 → 生成新 UUID，将原始 ID 存入 metadata
            logger.warning("[FreeNodes] clip_id=%s 不是合法 UUID，自动生成新 UUID", raw_clip_id)
            clip_id = str(uuid.uuid4())
        
        metadata = {
            "canvas_mode": "free",
            "canvas_position": node.canvas_position,
            "thumbnail_url": node.thumbnail_url,
            "aspect_ratio": node.aspect_ratio,
            "added_from": "canvas_free_add",
        }
        # ★ 持久化 AI 生成状态（占位节点刷新后恢复）
        if node.generating_task_id:
            metadata["generating_task_id"] = node.generating_task_id
        if node.generating_capability:
            metadata["generating_capability"] = node.generating_capability
        
        normalized_asset_id = (node.asset_id or '').strip() or None
        if normalized_asset_id:
            try:
                normalized_asset_id = str(uuid.UUID(normalized_asset_id))
            except ValueError:
                raise HTTPException(status_code=400, detail=f"free-node[{clip_id}] 的 asset_id 不是合法 UUID")
        else:
            normalized_asset_id = str(uuid.uuid4())

        # 治本：每个节点都确保有对应 asset 记录（若不存在则自动补建）
        asset_exists = False
        try:
            existing_assets = supabase.table("assets").select("id").eq("id", normalized_asset_id).limit(1).execute().data or []
            asset_exists = len(existing_assets) > 0
        except Exception:
            asset_exists = False

        if not asset_exists:
            is_image = node.media_type == "image"
            fallback_ext = "jpg" if is_image else "mp4"
            fallback_mime = "image/jpeg" if is_image else "video/mp4"
            source_url = node.thumbnail_url if is_image else (node.video_url or node.thumbnail_url)

            asset_payload = {
                "id": normalized_asset_id,
                "project_id": session_project_id,
                "user_id": session_user_id,
                "name": f"canvas-node-{clip_id[:8]}",
                "original_filename": f"canvas-node-{clip_id[:8]}.{fallback_ext}",
                "file_type": "image" if is_image else "video",
                "mime_type": fallback_mime,
                "file_size": 0,
                "storage_path": f"virtual/free-nodes/{session_id}/{clip_id}.{fallback_ext}",
                "duration": max(0.0, float(node.duration_ms) / 1000.0),
                "status": "processing" if node.generating_task_id else "ready",
                "metadata": {
                    "is_virtual": True,
                    "source": "canvas_free_node",
                    "external_url": source_url,
                    "generating_task_id": node.generating_task_id,
                },
                "created_at": now,
                "updated_at": now,
            }
            try:
                supabase.table("assets").insert(asset_payload).execute()
            except Exception as asset_insert_err:
                logger.warning("[FreeNodes] 自动补建 asset 失败 asset_id=%s clip_id=%s err=%s", normalized_asset_id, clip_id, asset_insert_err)

        new_clip = {
            "id": clip_id,
            "track_id": track_id,
            "asset_id": normalized_asset_id,
            "clip_type": node.media_type,
            "start_time": -1,  # ★ 自由节点用 -1 标记
            "end_time": -1 + max(node.duration_ms, 1),
            "source_start": 0,
            "source_end": max(node.duration_ms, 1),  # ★ 至少为 1，满足 valid_source_range 约束 (source_end > source_start)
            "metadata": metadata,
            "video_url": node.video_url,
        }
        
        supabase.table("clips").insert(new_clip).execute()
        created.append(new_clip)
    
    # ★ 同步写入 canvas_nodes 表（Visual Editor 专用）
    try:
        canvas_rows = []
        for clip in created:
            meta = clip.get("metadata") or {}
            duration_ms = max(clip.get("source_end", 1) - clip.get("source_start", 0), 1)
            canvas_rows.append({
                "id": str(uuid.uuid4()),
                "project_id": session_project_id,
                "asset_id": clip["asset_id"],
                "node_type": "free",
                "media_type": clip.get("clip_type", "video"),
                "order_index": 0,
                "start_time": 0,
                "end_time": duration_ms / 1000.0,
                "duration": duration_ms / 1000.0,
                "source_start": clip.get("source_start", 0),
                "source_end": clip.get("source_end", duration_ms),
                "canvas_position": meta.get("canvas_position", {"x": 200, "y": 200}),
                "video_url": clip.get("video_url"),
                "thumbnail_url": meta.get("thumbnail_url"),
                "metadata": {
                    "generating_task_id": meta.get("generating_task_id"),
                    "generating_capability": meta.get("generating_capability"),
                    "aspect_ratio": meta.get("aspect_ratio"),
                },
                "clip_id": clip["id"],
                "created_at": now,
                "updated_at": now,
            })
        if canvas_rows:
            supabase.table("canvas_nodes").insert(canvas_rows).execute()
            logger.info(f"[FreeNodes] ✅ 同步创建 {len(canvas_rows)} 个 canvas_nodes")
    except Exception as e:
        logger.warning(f"[FreeNodes] ⚠️ canvas_nodes 写入失败（不影响主流程）: {e}")
    
    logger.info(f"[FreeNodes] ✅ 创建 {len(created)} 个自由节点")
    return {"success": True, "created_count": len(created)}


@router.delete("/free-nodes/{node_id}")
async def delete_free_node(node_id: str):
    """删除自由节点"""
    import uuid as uuid_mod
    try:
        str(uuid_mod.UUID(node_id))
    except (ValueError, AttributeError):
        logger.warning("[FreeNodes] delete_free_node: node_id=%s 不是合法 UUID，跳过", node_id)
        return {"success": False, "reason": "invalid_uuid"}
    supabase = get_supabase()
    supabase.table("clips").delete().eq("id", node_id).execute()
    
    # ★ 同步删除 canvas_nodes
    try:
        # 先删关联的 canvas_edges
        supabase.table("canvas_edges").delete().or_(
            f"source_node_id.eq.{node_id},target_node_id.eq.{node_id}"
        ).execute()
        # 删除节点（通过 clip_id 关联）
        supabase.table("canvas_nodes").delete().eq("clip_id", node_id).execute()
        # 也尝试通过 id 直接删除
        supabase.table("canvas_nodes").delete().eq("id", node_id).execute()
    except Exception as e:
        logger.warning(f"[FreeNodes] ⚠️ canvas_nodes 删除同步失败: {e}")
    
    return {"success": True}


class UpdateFreeNodeRequest(BaseModel):
    """更新自由节点数据（任务完成后更新 videoUrl、metadata 等）"""
    video_url: Optional[str] = None
    metadata: Optional[dict] = None


@router.patch("/free-nodes/{node_id}/update")
async def update_free_node(node_id: str, request: UpdateFreeNodeRequest):
    """更新自由节点的视频 URL 和 metadata（任务完成后调用）"""
    import uuid as uuid_mod
    try:
        str(uuid_mod.UUID(node_id))
    except (ValueError, AttributeError):
        logger.warning("[FreeNodes] update_free_node: node_id=%s 不是合法 UUID，跳过", node_id)
        return {"success": False, "reason": "invalid_uuid"}
    supabase = get_supabase()
    
    clip_result = supabase.table("clips").select("metadata, video_url").eq("id", node_id).single().execute()
    if not clip_result.data:
        raise HTTPException(status_code=404, detail="Node not found")
    
    updates = {}
    if request.video_url is not None:
        updates["video_url"] = request.video_url
    
    if request.metadata is not None:
        existing_metadata = clip_result.data.get("metadata") or {}
        existing_metadata.update(request.metadata)
        updates["metadata"] = existing_metadata
    
    if updates:
        supabase.table("clips").update(updates).eq("id", node_id).execute()
        
        # ★ 同步更新 canvas_nodes
        try:
            cn_updates = {"updated_at": datetime.utcnow().isoformat()}
            if request.video_url is not None:
                cn_updates["video_url"] = request.video_url
            if request.metadata is not None:
                # 合并 metadata 并提取 thumbnail_url
                cn_updates["metadata"] = updates.get("metadata", {})
                thumb = (updates.get("metadata") or {}).get("thumbnail_url")
                if thumb:
                    cn_updates["thumbnail_url"] = thumb
            
            supabase.table("canvas_nodes").update(cn_updates).eq("clip_id", node_id).execute()
        except Exception as e:
            logger.warning(f"[FreeNodes] ⚠️ canvas_nodes 更新同步失败: {e}")
    
    return {"success": True}


class UpdatePositionRequest(BaseModel):
    canvas_position: dict


@router.patch("/free-nodes/{node_id}/position")
async def update_free_node_position(node_id: str, request: UpdatePositionRequest):
    """更新自由节点的画布位置"""
    import uuid as uuid_mod
    try:
        str(uuid_mod.UUID(node_id))
    except (ValueError, AttributeError):
        logger.warning("[FreeNodes] update_position: node_id=%s 不是合法 UUID，跳过", node_id)
        return {"success": False, "reason": "invalid_uuid"}
    supabase = get_supabase()
    
    # 获取当前 metadata 并合并
    clip_result = supabase.table("clips").select("metadata").eq("id", node_id).single().execute()
    if not clip_result.data:
        raise HTTPException(status_code=404, detail="Node not found")
    
    metadata = clip_result.data.get("metadata") or {}
    metadata["canvas_position"] = request.canvas_position
    
    supabase.table("clips").update({"metadata": metadata}).eq("id", node_id).execute()
    
    # ★ 同步更新 canvas_nodes 表
    try:
        # 先尝试通过 clip_id 关联更新
        cn_result = supabase.table("canvas_nodes").select("id").eq("clip_id", node_id).limit(1).execute()
        if cn_result.data:
            supabase.table("canvas_nodes").update({
                "canvas_position": request.canvas_position,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("clip_id", node_id).execute()
        else:
            # 降级: 通过 id 直接匹配
            supabase.table("canvas_nodes").update({
                "canvas_position": request.canvas_position,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", node_id).execute()
    except Exception as e:
        logger.warning(f"[FreeNodes] ⚠️ canvas_nodes position 同步失败: {e}")
    
    return {"success": True}


# ==========================================
# ★ 画布连线 API（存储在 session metadata）
# ==========================================

class CanvasEdgesRequest(BaseModel):
    edges: List[dict]


@router.put("/sessions/{session_id}/canvas-edges")
async def save_canvas_edges(session_id: str, request: CanvasEdgesRequest):
    """保存画布连线到 session metadata + canvas_edges 表"""
    supabase = get_supabase()
    
    session_result = supabase.table("workspace_sessions").select("metadata, project_id").eq("id", session_id).single().execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    metadata = session_result.data.get("metadata") or {}
    metadata["canvas_edges"] = request.edges
    
    supabase.table("workspace_sessions").update({"metadata": metadata}).eq("id", session_id).execute()
    
    # ★ 同步写入 canvas_edges 表
    project_id = session_result.data.get("project_id")
    if project_id:
        try:
            # 清空旧连线
            supabase.table("canvas_edges").delete().eq("project_id", project_id).execute()
            # 写入新连线
            if request.edges:
                from datetime import datetime as dt
                now = dt.utcnow().isoformat()
                rows = []
                for edge in request.edges:
                    if isinstance(edge, dict) and edge.get("source") and edge.get("target"):
                        rows.append({
                            "id": edge.get("id") or str(uuid4()),
                            "project_id": project_id,
                            "source_node_id": edge["source"],
                            "target_node_id": edge["target"],
                            "source_handle": edge.get("sourceHandle"),
                            "target_handle": edge.get("targetHandle"),
                            "created_at": now,
                        })
                if rows:
                    supabase.table("canvas_edges").insert(rows).execute()
                    logger.info(f"[CanvasEdges] ✅ 同步 {len(rows)} 条连线到 canvas_edges 表")
        except Exception as e:
            logger.warning(f"[CanvasEdges] ⚠️ canvas_edges 表同步失败: {e}")
    
    return {"success": True}


@router.get("/sessions/{session_id}/canvas-edges")
async def get_canvas_edges(session_id: str):
    """获取画布连线"""
    supabase = get_supabase()
    
    session_result = supabase.table("workspace_sessions").select("metadata").eq("id", session_id).single().execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    metadata = session_result.data.get("metadata") or {}
    return {"edges": metadata.get("canvas_edges", [])}
