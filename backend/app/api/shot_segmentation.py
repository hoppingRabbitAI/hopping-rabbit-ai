"""
分镜 API 路由
提供分镜策略相关的 REST API

设计原则：
- 分镜结果直接存入 clips 表（复用项目已有结构）
- 通过 parent_clip_id 支持递归分镜
- 时间单位统一使用毫秒 (ms)
"""

import logging
from typing import Optional, List
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.supabase_client import get_supabase
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
    
    例如: /tmp/hoppingrabbit_cache/xxx/clip.jpg -> http://localhost:8000/cache/xxx/clip.jpg
    前端直接使用，无需再处理
    """
    if not path:
        return None
    
    # 如果已经是完整 URL，直接返回
    if path.startswith("http"):
        return path
    
    settings = get_settings()
    cache_dir = settings.cache_dir or "/tmp/hoppingrabbit_cache"
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
    
    @property
    def duration(self) -> int:
        return self.end_time - self.start_time


class GetClipsResponse(BaseModel):
    """获取分镜结果响应"""
    session_id: str
    strategy: Optional[str] = None
    status: str  # pending | analyzing | completed | error
    clips: List[ClipItem] = []
    total_duration_ms: int = 0
    error_message: Optional[str] = None


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


@router.post("/clips/{clip_id}/segment", response_model=StartSegmentationResponse)
async def segment_clip(
    clip_id: str,
    request: StartSegmentationRequest,
    background_tasks: BackgroundTasks,
):
    """
    对单个 Clip 进行递归分镜
    
    右键点击某个分镜后，可以对其应用任意策略进行二次分割
    """
    
    supabase = get_supabase()
    
    # 1. 获取 Clip 信息
    clip_result = supabase.table("clips").select(
        "id, track_id, asset_id, source_start, source_end, parent_clip_id"
    ).eq("id", clip_id).single().execute()
    
    if not clip_result.data:
        raise HTTPException(status_code=404, detail="Clip not found")
    
    clip = clip_result.data
    
    # 2. 获取 Track 和 Session
    track_result = supabase.table("tracks").select(
        "id, session_id"
    ).eq("id", clip.get("track_id")).single().execute()
    
    if not track_result.data:
        raise HTTPException(status_code=404, detail="Track not found")
    
    session_id = track_result.data.get("session_id")
    
    # 3. 设置递归分镜参数
    request.parent_clip_id = clip_id
    request.source_start_ms = clip.get("source_start", 0)
    request.source_end_ms = clip.get("source_end", 0)
    
    # 4. 验证策略
    try:
        strategy = SegmentationStrategy(request.strategy)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的分镜策略: {request.strategy}，可选: scene, sentence, paragraph"
        )
    
    # 5. 创建任务
    task_id = str(uuid4())
    
    # 6. 在后台执行分镜
    background_tasks.add_task(
        run_segmentation_task,
        task_id=task_id,
        session_id=session_id,
        asset_id=clip.get("asset_id"),
        strategy=strategy,
        params=request,
    )
    
    return StartSegmentationResponse(
        task_id=task_id,
        status="pending",
        message=f"正在对 Clip 使用 {strategy.value} 策略进行递归分镜",
        is_recursive=True,
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
        "id, project_id, workflow_step, error_message"
    ).eq("id", session_id).single().execute()
    
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = session_result.data
    project_id = session.get("project_id")
    
    if not project_id:
        return GetClipsResponse(
            session_id=session_id,
            strategy=None,
            status="pending",
            clips=[],
            total_duration_ms=0,
        )
    
    # 2. 获取 Project 关联的 Tracks
    track_result = supabase.table("tracks").select("id").eq(
        "project_id", project_id
    ).execute()
    
    track_ids = [t["id"] for t in (track_result.data or [])]
    
    if not track_ids:
        return GetClipsResponse(
            session_id=session_id,
            strategy=None,
            status="pending",
            clips=[],
            total_duration_ms=0,
        )
    
    # 3. 查询 Clips
    query = supabase.table("clips").select(
        "id, asset_id, clip_type, start_time, end_time, source_start, source_end, "
        "parent_clip_id, name, metadata"
    ).in_("track_id", track_ids).eq("clip_type", "video")
    
    # 如果指定了 parent_clip_id，只获取其子分镜
    if parent_clip_id:
        query = query.eq("parent_clip_id", parent_clip_id)
    
    clips_result = query.order("start_time").execute()
    
    # 4. 判断状态
    workflow_step = session.get("workflow_step", "")
    clips_data = clips_result.data or []
    
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
        ))
        total_duration_ms = max(total_duration_ms, clip.get("end_time", 0))
    
    # 从第一个 clip 的 metadata 获取策略（每个 clip 可能不同）
    first_clip_strategy = None
    if clips_data:
        first_metadata = clips_data[0].get("metadata", {}) or {}
        first_clip_strategy = first_metadata.get("strategy")
    
    return GetClipsResponse(
        session_id=session_id,
        strategy=first_clip_strategy,
        status=status,
        clips=clips,
        total_duration_ms=total_duration_ms,
        error_message=session.get("error_message"),
    )


class ClipUpdateRequest(BaseModel):
    """更新 Clip 请求"""
    source_start: Optional[int] = None
    source_end: Optional[int] = None
    name: Optional[str] = None
    video_url: Optional[str] = None


@router.patch("/clips/{clip_id}")
async def update_clip(clip_id: str, request: ClipUpdateRequest):
    """
    更新分镜（包括替换视频）
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
    
    if not update_data:
        return {"success": True, "clip_id": clip_id, "message": "No changes"}
    
    supabase.table("clips").update(update_data).eq("id", clip_id).execute()
    
    return {"success": True, "clip_id": clip_id, "updated": update_data}


@router.delete("/clips/{clip_id}/children")
async def delete_clip_children(clip_id: str):
    """
    删除 Clip 的所有子分镜
    
    用于重新分镜前清除旧的结果
    """
    
    supabase = get_supabase()
    
    # 删除以此 Clip 为父的所有子 Clip
    result = supabase.table("clips").delete().eq("parent_clip_id", clip_id).execute()
    
    deleted_count = len(result.data) if result.data else 0
    
    return {"success": True, "clip_id": clip_id, "deleted_count": deleted_count}


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
