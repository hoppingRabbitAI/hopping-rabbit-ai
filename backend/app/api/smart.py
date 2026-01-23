"""
HoppingRabbit AI - 智能功能 API (Phase 6)
静音检测、填充词检测、说话人分离、音轨分离、字幕烧录
"""
import bisect
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from fastapi.responses import Response
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime
from uuid import uuid4
from pydantic import BaseModel
import json

from ..services.supabase_client import supabase
from ..services.smart_analyzer import normalize_classification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["Smart Features"])


# ============================================
# 请求模型
# ============================================

class SilenceDetectionRequest(BaseModel):
    """静音检测请求"""
    project_id: str
    audio_url: str
    method: str = "energy"  # energy, silero, ffmpeg
    silence_threshold_db: float = -35
    min_silence_duration: float = 0.5
    min_speech_duration: float = 0.3
    padding: float = 0.1

class FillerDetectionRequest(BaseModel):
    """填充词检测请求"""
    project_id: str
    transcript: Dict[str, Any]
    custom_words: Optional[List[str]] = None
    min_confidence: float = 0.7
    languages: Optional[List[str]] = None

class DiarizeRequest(BaseModel):
    """说话人分离请求"""
    project_id: str
    audio_url: str
    num_speakers: Optional[int] = None
    transcript: Optional[Dict[str, Any]] = None

class StemSeparateRequest(BaseModel):
    """音轨分离请求"""
    project_id: str
    audio_url: str
    model: str = "htdemucs"
    two_stems: bool = True
    stems: Optional[List[str]] = None

class SubtitleBurnRequest(BaseModel):
    """字幕烧录请求"""
    project_id: str
    video_url: str
    subtitles: List[Dict[str, Any]]
    style: Dict[str, Any]


# ============================================
# 静音检测
# ============================================

@router.post("/detect-silence")
async def detect_silence(request: SilenceDetectionRequest, background_tasks: BackgroundTasks):
    """
    检测音频中的静音片段
    
    支持三种检测方法:
    - energy: 基于能量阈值（快速）
    - silero: 基于 Silero VAD 深度学习模型（准确）
    - ffmpeg: 使用 FFmpeg 内置检测（无依赖）
    """
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        task_data = {
            "id": task_id,
            "type": "silence_detection",
            "project_id": request.project_id,
            "status": "pending",
            "progress": 0,
            "params": request.model_dump(),
            "created_at": now,
            "updated_at": now
        }
        
        supabase.table("tasks").insert(task_data).execute()
        
        # 异步执行
        background_tasks.add_task(
            execute_silence_detection,
            task_id,
            request.project_id,
            request.audio_url,
            request.method,
            request.silence_threshold_db,
            request.min_silence_duration,
            request.min_speech_duration,
            request.padding
        )
        
        return {"task_id": task_id, "status": "pending"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 填充词检测
# ============================================

@router.post("/detect-fillers")
async def detect_fillers(request: FillerDetectionRequest):
    """
    检测转录文本中的填充词（口头禅、语气词）
    
    自动识别：
    - 中文：嗯、啊、那个、然后、就是...
    - 英文：um, uh, like, you know, basically...
    - 支持自定义词库
    """
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 同步执行（填充词检测很快）
        from ..tasks.filler_detection import detect_fillers as detect_filler_words
        result = detect_filler_words(
            transcript=request.transcript,
            custom_words=request.custom_words,
            min_confidence=request.min_confidence,
            languages=request.languages
        )
        
        # 记录任务
        supabase.table("tasks").insert({
            "id": task_id,
            "type": "filler_detection",
            "project_id": request.project_id,
            "status": "completed",
            "progress": 100,
            "result": result,
            "created_at": now,
            "updated_at": now
        }).execute()
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 说话人分离
# ============================================

@router.post("/diarize")
async def diarize_audio(request: DiarizeRequest, background_tasks: BackgroundTasks):
    """
    说话人分离 - 识别音频中的不同说话人
    
    功能：
    - 自动检测说话人数量（2-10人）
    - 可手动指定说话人数量
    - 与转录文本合并，标注每段话的说话人
    """
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        task_data = {
            "id": task_id,
            "type": "diarization",
            "project_id": request.project_id,
            "status": "pending",
            "progress": 0,
            "params": {
                "num_speakers": request.num_speakers,
                "has_transcript": bool(request.transcript)
            },
            "created_at": now,
            "updated_at": now
        }
        
        supabase.table("tasks").insert(task_data).execute()
        
        # 异步执行
        background_tasks.add_task(
            execute_diarization,
            task_id,
            request.project_id,
            request.audio_url,
            request.num_speakers,
            request.transcript
        )
        
        return {"task_id": task_id, "status": "pending"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 音轨分离
# ============================================

@router.post("/separate-stems")
async def separate_stems(request: StemSeparateRequest, background_tasks: BackgroundTasks):
    """
    音轨分离 - 将音频分离为人声、伴奏等独立轨道
    
    支持模型：
    - htdemucs: 默认，平衡质量和速度
    - htdemucs_ft: Fine-tuned 版本，质量更高
    - mdx_extra: MDX 模型
    
    输出：
    - two_stems=True: 人声 + 伴奏
    - two_stems=False: 人声 + 鼓点 + 贝斯 + 其他
    """
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        task_data = {
            "id": task_id,
            "type": "stem_separation",
            "project_id": request.project_id,
            "status": "pending",
            "progress": 0,
            "params": request.model_dump(),
            "created_at": now,
            "updated_at": now
        }
        
        supabase.table("tasks").insert(task_data).execute()
        
        # 使用 Celery 异步执行（耗时任务）
        try:
            from ..tasks.stem_separation import separate_stems_task
            separate_stems_task.delay(
                task_id,
                request.project_id,
                request.audio_url,
                request.model,
                request.two_stems,
                request.stems
            )
        except:
            # Celery 不可用，返回提示
            return {
                "task_id": task_id, 
                "status": "error",
                "message": "音轨分离需要 Celery 后台任务支持，请确保已启动 Celery Worker"
            }
        
        return {"task_id": task_id, "status": "pending"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 字幕烧录
# ============================================

@router.post("/burn-subtitles")
async def burn_subtitles(request: SubtitleBurnRequest, background_tasks: BackgroundTasks):
    """
    字幕烧录 - 将字幕硬编码到视频中
    
    支持样式：
    - 字体、大小、颜色
    - 描边、阴影
    - 位置、动画效果
    """
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        task_data = {
            "id": task_id,
            "type": "subtitle_burn",
            "project_id": request.project_id,
            "status": "pending",
            "progress": 0,
            "params": {
                "subtitle_count": len(request.subtitles),
                "style": request.style
            },
            "created_at": now,
            "updated_at": now
        }
        
        supabase.table("tasks").insert(task_data).execute()
        
        background_tasks.add_task(
            execute_subtitle_burn,
            task_id,
            request.project_id,
            request.video_url,
            request.subtitles,
            request.style
        )
        
        return {"task_id": task_id, "status": "pending"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 字幕导出
# ============================================

@router.get("/export-subtitles/{project_id}")
async def export_subtitles(
    project_id: str,
    format: str = Query("srt", enum=["srt", "vtt", "ass"]),
    subtitles: Optional[str] = None  # JSON 字符串
):
    """
    导出字幕文件
    
    支持格式：
    - srt: SubRip 格式
    - vtt: WebVTT 格式
    - ass: ASS/SSA 格式（支持样式）
    """
    try:
        from ..tasks.subtitle_burn import export_srt, export_vtt, export_ass
        
        # 解析字幕数据
        if subtitles:
            subtitle_list = json.loads(subtitles)
        else:
            # 从项目获取字幕
            project = supabase.table("projects").select("subtitles").eq("id", project_id).single().execute()
            subtitle_list = project.data.get("subtitles", []) if project.data else []
        
        if not subtitle_list:
            raise HTTPException(status_code=404, detail="未找到字幕数据")
        
        if format == "srt":
            content = export_srt(subtitle_list)
            media_type = "text/plain"
            filename = f"{project_id}.srt"
        elif format == "vtt":
            content = export_vtt(subtitle_list)
            media_type = "text/vtt"
            filename = f"{project_id}.vtt"
        else:  # ass
            style = {}
            content = export_ass(subtitle_list, style)
            media_type = "text/plain"
            filename = f"{project_id}.ass"
        
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 任务执行函数
# ============================================

async def execute_silence_detection(
    task_id: str,
    project_id: str,
    audio_url: str,
    method: str,
    silence_threshold_db: float,
    min_silence_duration: float,
    min_speech_duration: float,
    padding: float
):
    """执行静音检测"""
    import tempfile
    import httpx
    import os
    
    try:
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "audio.wav")
            
            # 下载音频
            async with httpx.AsyncClient(timeout=300) as client:
                response = await client.get(audio_url, follow_redirects=True)
                response.raise_for_status()
                with open(audio_path, "wb") as f:
                    f.write(response.content)
            
            # 检测
            from ..tasks.vad import VADDetector, detect_silence_ffmpeg
            
            if method == "ffmpeg":
                result = detect_silence_ffmpeg(
                    audio_path,
                    silence_threshold_db,
                    min_silence_duration
                )
            else:
                detector = VADDetector(
                    method=method,
                    silence_threshold_db=silence_threshold_db,
                    min_silence_duration=min_silence_duration,
                    min_speech_duration=min_speech_duration,
                    padding=padding
                )
                result = detector.detect(audio_path)
            
            supabase.table("tasks").update({
                "status": "completed",
                "progress": 100,
                "result": result,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            
    except Exception as e:
        supabase.table("tasks").update({
            "status": "failed",
            "error": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


async def execute_diarization(
    task_id: str,
    project_id: str,
    audio_url: str,
    num_speakers: Optional[int],
    transcript: Optional[Dict]
):
    """执行说话人分离"""
    import tempfile
    import httpx
    import os
    
    try:
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "audio.wav")
            
            async with httpx.AsyncClient(timeout=300) as client:
                response = await client.get(audio_url, follow_redirects=True)
                response.raise_for_status()
                with open(audio_path, "wb") as f:
                    f.write(response.content)
            
            from ..tasks.diarization import diarize_audio
            result = await diarize_audio(
                audio_path=audio_path,
                num_speakers=num_speakers,
                transcript=transcript
            )
            
            supabase.table("tasks").update({
                "status": "completed",
                "progress": 100,
                "result": result,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            
    except Exception as e:
        supabase.table("tasks").update({
            "status": "failed",
            "error": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


async def execute_subtitle_burn(
    task_id: str,
    project_id: str,
    video_url: str,
    subtitles: List[Dict],
    style: Dict
):
    """执行字幕烧录"""
    import tempfile
    import httpx
    import os
    
    try:
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            video_path = os.path.join(tmpdir, "input.mp4")
            output_path = os.path.join(tmpdir, "output.mp4")
            
            async with httpx.AsyncClient(timeout=600) as client:
                response = await client.get(video_url, follow_redirects=True)
                response.raise_for_status()
                with open(video_path, "wb") as f:
                    f.write(response.content)
            
            from ..tasks.subtitle_burn import burn_subtitles
            result_path = await burn_subtitles(
                video_path=video_path,
                subtitles=subtitles,
                style=style,
                output_path=output_path
            )
            
            # 上传结果
            storage_path = f"exports/{project_id}/subtitled_{task_id}.mp4"
            
            with open(result_path, "rb") as f:
                supabase.storage.from_("videos").upload(
                    storage_path,
                    f.read(),
                    {"content-type": "video/mp4"}
                )
            
            from ..services.supabase_client import get_file_url
            result_url = get_file_url("videos", storage_path)
            
            supabase.table("tasks").update({
                "status": "completed",
                "progress": 100,
                "result": {"url": result_url, "subtitle_count": len(subtitles)},
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            
    except Exception as e:
        supabase.table("tasks").update({
            "status": "failed",
            "error": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


# ============================================
# 一键 AI 成片
# ============================================

class AIVideoCreateRequest(BaseModel):
    """一键成片请求"""
    project_id: str
    video_path: str  # 本地视频路径
    audio_url: str   # 音频公网 URL (用于 ASR)
    options: Optional[Dict[str, Any]] = None  # 可选配置


class AIVideoCreateResponse(BaseModel):
    """一键成片响应"""
    task_id: str
    status: str
    message: str


@router.post("/ai-create", response_model=AIVideoCreateResponse)
async def ai_video_create(request: AIVideoCreateRequest, background_tasks: BackgroundTasks):
    """
    一键 AI 成片
    
    自动完成:
    1. 语音识别 (ASR) 切片
    2. 人脸检测 (MediaPipe) 定位焦点
    3. 智能运镜 (Zoom/Pan) 生成
    4. 字幕生成
    
    可选 (需配置 LLM API):
    5. 情绪分析增强运镜效果
    """
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        task_data = {
            "id": task_id,
            "type": "ai_video_create",
            "project_id": request.project_id,
            "status": "pending",
            "progress": 0,
            "params": request.model_dump(),
            "created_at": now,
            "updated_at": now
        }
        
        supabase.table("tasks").insert(task_data).execute()
        
        # 异步执行
        background_tasks.add_task(
            execute_ai_video_create,
            task_id,
            request.project_id,
            request.video_path,
            request.audio_url,
            request.options or {}
        )
        
        return AIVideoCreateResponse(
            task_id=task_id,
            status="pending",
            message="AI 成片任务已提交，正在处理中..."
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def execute_ai_video_create(
    task_id: str,
    project_id: str,
    video_path: str,
    audio_url: str,
    options: Dict
):
    """执行一键成片任务"""
    import asyncio
    
    try:
        # 更新状态
        supabase.table("tasks").update({
            "status": "processing",
            "progress": 5,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        from ..services.ai_video_creator import ai_video_creator
        
        # 执行 AI 处理
        result = await ai_video_creator.process(
            video_path=video_path,
            audio_url=audio_url,
            options=options
        )
        
        # 更新进度
        supabase.table("tasks").update({
            "status": "processing",
            "progress": 80,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        # 将结果转换为 Clips 和 Tracks 并存入数据库
        clips_data = await _save_ai_result_to_project(project_id, result)
        
        # 完成
        supabase.table("tasks").update({
            "status": "completed",
            "progress": 100,
            "result": {
                "clips_count": result.clips_count,
                "total_duration": result.total_duration,
                "speech_duration": result.speech_duration,
                "subtitles_count": len(result.subtitles)
            },
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        
        supabase.table("tasks").update({
            "status": "failed",
            "error": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


async def _save_ai_result_to_project(project_id: str, result) -> List[Dict]:
    """
    将 AI 处理结果保存为 Project 的 Clips 和 Tracks
    
    覆盖策略：
    - 查找该项目已有的 AI 视频轨道和字幕轨道
    - 如果存在，删除旧 clips 并复用轨道
    - 如果不存在，创建新轨道
    """
    from ..services.ai_video_creator import AIEditingResult, SmartSegment
    from .workspace import _split_segments_by_punctuation
    
    now = datetime.utcnow().isoformat()
    
    # 查找已有的 AI 轨道
    existing_tracks = supabase.table("tracks").select("id, name").eq("project_id", project_id).execute()
    existing_data = existing_tracks.data or []
    
    video_track_id = None
    subtitle_track_id = None
    
    for track in existing_data:
        if track.get("name") == "AI Video Track" or track.get("name") == "AI 视频轨道":
            video_track_id = track["id"]
        elif track.get("name") == "AI Subtitles" or track.get("name") == "AI 字幕轨道":
            subtitle_track_id = track["id"]
    
    # 如果有旧轨道，删除其下的所有 clips
    if video_track_id:
        supabase.table("clips").delete().eq("track_id", video_track_id).execute()
        logger.debug(f"删除旧视频轨道 clips, track_id={video_track_id}")
    
    if subtitle_track_id:
        supabase.table("clips").delete().eq("track_id", subtitle_track_id).execute()
        logger.debug(f"删除旧字幕轨道 clips, track_id={subtitle_track_id}")
    
    # 如果没有旧轨道，创建新的
    if not video_track_id:
        video_track_id = str(uuid4())
        video_track = {
            "id": video_track_id,
            "project_id": project_id,
            "name": "AI 视频轨道",
            "order_index": 0,
            "is_visible": True,
            "is_locked": False,
            "is_muted": False,
            "created_at": now,
            "updated_at": now
        }
        supabase.table("tracks").insert(video_track).execute()
        logger.debug(f"创建新视频轨道, track_id={video_track_id}")
    
    if not subtitle_track_id:
        subtitle_track_id = str(uuid4())
        subtitle_track = {
            "id": subtitle_track_id,
            "project_id": project_id,
            "name": "AI 字幕轨道",
            "order_index": 1,
            "is_visible": True,
            "is_locked": False,
            "is_muted": False,
            "created_at": now,
            "updated_at": now
        }
        supabase.table("tracks").insert(subtitle_track).execute()
        logger.debug(f"创建新字幕轨道, track_id={subtitle_track_id}")
    
    # 3. 创建视频 Clips (带 transform 和静音分级)
    video_clips = []
    subtitle_clips = []
    
    timeline_position = 0
    speech_count = 0
    breath_count = 0
    
    for seg_idx, seg in enumerate(result.segments):
        clip_duration = int(seg.end - seg.start)
        
        # 判断是否为换气/静音片段
        is_breath = seg.is_breath if hasattr(seg, "is_breath") else False
        is_silence = seg.is_silence if hasattr(seg, "is_silence") else False
        
        # 命名
        if is_breath:
            clip_name = "换气"
            breath_count += 1
        elif is_silence:
            clip_name = "静音"
        else:
            speech_count += 1
            clip_name = f"片段 {speech_count}"
        
        # 视频 clip ID，用于字幕关联
        video_clip_id = str(uuid4())
        
        video_clip = {
            "id": video_clip_id,
            "track_id": video_track_id,
            "clip_type": "video",
            "name": clip_name,
            "start_time": timeline_position,
            "end_time": timeline_position + clip_duration,
            "source_start": int(seg.start),
            "source_end": int(seg.end),
            "volume": 1.0,
            "is_muted": False,
            "transform": seg.transform if hasattr(seg, "transform") else None,
            "speed": 1.0,
            "created_at": now,
            "updated_at": now
        }
        
        # 保留元数据
        if hasattr(seg, "metadata") and seg.metadata:
            video_clip["metadata"] = seg.metadata
        
        video_clips.append(video_clip)
        
        # 4. 创建字幕 Clips (按标点切分，只有语音片段)
        if seg.text and not is_breath and not is_silence:
            seg_dict = {
                "id": seg.id,
                "text": seg.text,
                "start": int(seg.start),
                "end": int(seg.end),
            }
            
            # 按标点切分
            fine_subs = _split_segments_by_punctuation([seg_dict])
            
            for sub_idx, sub_seg in enumerate(fine_subs):
                sub_start = sub_seg.get("start", seg.start)
                sub_end = sub_seg.get("end", seg.end)
                sub_text = sub_seg.get("text", "").strip()
                sub_duration = sub_end - sub_start
                
                if sub_duration <= 0 or not sub_text:
                    continue
                
                subtitle_timeline_start = timeline_position + (sub_start - int(seg.start))
                
                subtitle_clip = {
                    "id": str(uuid4()),
                    "track_id": subtitle_track_id,
                    "clip_type": "subtitle",
                    "parent_clip_id": video_clip_id,  # 关联视频 clip
                    "start_time": subtitle_timeline_start,
                    "end_time": subtitle_timeline_start + sub_duration,
                    "content_text": sub_text,
                    "text_style": {
                        "fontSize": 15,
                        "fontColor": "#FFFFFF",
                        "backgroundColor": "transparent",
                        "alignment": "center",
                        "maxWidth": "85%",  # 字幕最大宽度 85% 画布宽度
                    },
                    "transform": {
                        "x": 0,
                        "y": 150,
                        "scale": 1,
                    },
                    "metadata": {
                        "segment_id": seg.id,
                        "order_index": seg_idx * 100 + sub_idx,
                    },
                    "created_at": now,
                    "updated_at": now
                }
                subtitle_clips.append(subtitle_clip)
        
        timeline_position += clip_duration
    
    logger.info(f"AI Create 统计: 语音片段 {speech_count}, 换气保留 {breath_count}")
    
    # ★★★ 验证：确保所有 clip 都有必需的字段 ★★★
    required_fields = ["id", "track_id", "clip_type", "start_time", "end_time"]
    for clip in video_clips + subtitle_clips:
        for field in required_fields:
            if clip.get(field) is None:
                logger.error(f"❌ AI Create clip {clip.get('id', 'unknown')[:8]} 缺少必需字段: {field}")
                raise ValueError(f"Clip 缺少必需字段: {field}")
    
    # 批量插入
    if video_clips:
        supabase.table("clips").insert(video_clips).execute()
        logger.info(f"\n🎬 [AI Create] 创建 {len(video_clips)} 个视频 Clip:")
        for i, clip in enumerate(video_clips[:10]):  # 最多打印前 10 个
            transform_info = ""
            if clip.get("transform"):
                t = clip["transform"]
                if isinstance(t, dict) and t.get("scaleX") is not None:
                    transform_info = f", transform.scaleX={t.get('scaleX', 1):.2f}"
            logger.info(f"   [{i}] id={clip['id'][:8]}, start={clip['start_time']}, end={clip['end_time']}, source={clip.get('source_start')}-{clip.get('source_end')}{transform_info}")
        if len(video_clips) > 10:
            logger.info(f"   ... 还有 {len(video_clips) - 10} 个 clips")
    
    if subtitle_clips:
        supabase.table("clips").insert(subtitle_clips).execute()
        logger.info(f"\n📝 [AI Create] 创建 {len(subtitle_clips)} 个字幕 Clip:")
        for i, clip in enumerate(subtitle_clips[:10]):  # 最多打印前 10 个
            text = clip.get('content_text', '')[:20] + '...' if len(clip.get('content_text', '')) > 20 else clip.get('content_text', '')
            logger.info(f"   [{i}] id={clip['id'][:8]}, parent={clip.get('parent_clip_id', '')[:8] if clip.get('parent_clip_id') else 'N/A'}, start={clip['start_time']}, text='{text}'")
        if len(subtitle_clips) > 10:
            logger.info(f"   ... 还有 {len(subtitle_clips) - 10} 个字幕")
    
    return video_clips + subtitle_clips


# ============================================
# 基于字幕 Clips 重新分析 (Phase 1: 字幕级情绪分析)
# ============================================

# 常量
SUBTITLE_TIME_TOLERANCE_MS = 100  # 字幕时间匹配容差（毫秒）


class ReanalyzeFromClipsRequest(BaseModel):
    """基于字幕 clips 重新运行 AI 分析"""
    project_id: str
    video_clip_id: Optional[str] = None  # 可选：指定视频 clip，不指定则分析项目所有字幕
    enable_llm: bool = True


class ReanalyzeAllSubtitlesRequest(BaseModel):
    """重新分析项目所有字幕的情绪"""
    project_id: str
    enable_llm: bool = True


async def _get_video_clip(video_clip_id: str) -> dict:
    """获取视频 clip 信息"""
    result = supabase.table("clips").select("*").eq("id", video_clip_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="视频 clip 不存在")
    return result.data


async def _find_subtitle_clips(video_clip: dict, video_clip_id: str) -> List[dict]:
    """查找视频时间范围内的字幕 clips"""
    video_start = video_clip.get("start_time", 0)
    video_end = video_clip.get("end_time", 0)
    
    # 先按时间范围查找
    result = supabase.table("clips").select("*").eq(
        "clip_type", "subtitle"
    ).gte("start_time", video_start - SUBTITLE_TIME_TOLERANCE_MS
    ).lte("end_time", video_end + SUBTITLE_TIME_TOLERANCE_MS
    ).order("start_time").execute()
    
    subtitle_clips = result.data or []
    
    # 备选：用 parent_clip_id 查找
    if not subtitle_clips:
        result = supabase.table("clips").select("*").eq(
            "parent_clip_id", video_clip_id
        ).eq("clip_type", "subtitle").order("start_time").execute()
        subtitle_clips = result.data or []
    
    return subtitle_clips


def _convert_to_segments(subtitle_clips: List[dict]) -> List[dict]:
    """将字幕 clips 转换为分析用的 segments 格式"""
    segments = []
    for clip in subtitle_clips:
        text = clip.get("content_text", "").strip()
        if not text:
            continue
        segments.append({
            "id": clip["id"],
            "start": clip.get("start_time", 0),
            "end": clip.get("end_time", 0),
            "text": text,
            "clip_id": clip["id"],
        })
    return segments


def _create_keyframes_from_segments(
    smart_segments: List,
    video_clip_id: str,
    video_start: int,
    video_duration: int,
) -> List[dict]:
    """
    根据分析结果创建关键帧（使用归一化 offset 0-1）
    
    此函数现在使用 TransformParams.get_keyframes_for_db() 方法，
    这是生成关键帧的标准方式，包含完整的逻辑：
    - STATIC 策略：不生成关键帧
    - INSTANT 策略：只有在有实际变换时才生成首尾帧（相同值）
    - KEYFRAME 策略：只有在有实际动画时才生成首尾帧（不同值）
    
    Args:
        smart_segments: SmartSegment 列表（必须包含 transform_params 字段）
        video_clip_id: 视频 clip ID
        video_start: 视频起始时间（毫秒）
        video_duration: 视频时长（毫秒）
    
    Returns:
        关键帧记录列表
    """
    all_keyframes = []
    segments_with_keyframes = 0
    segments_skipped = 0
    
    for seg in smart_segments:
        # 优先使用 transform_params（TransformParams 对象）
        params = getattr(seg, 'transform_params', None)
        
        if params is None:
            # 向后兼容：如果没有 transform_params，尝试从 transform dict 重建
            transform = getattr(seg, 'transform', None) or {}
            strategy = transform.get('_strategy', 'static')
            
            if 'static' in strategy or 'no_change' in strategy:
                segments_skipped += 1
                continue
            
            # 无法重建 TransformParams，跳过
            logger.warning(f"[Keyframes] segment {seg.id[:8]} 没有 transform_params，跳过")
            segments_skipped += 1
            continue
        
        # 使用 TransformParams.get_keyframes_for_db() 生成关键帧
        # 注意：这里我们需要处理 segment 相对于整个视频的时间偏移
        segment_duration = seg.end - seg.start

        strategy_label = params.strategy.value if hasattr(params.strategy, "value") else str(params.strategy)
        logger.info(
            f"[Keyframes] segment {seg.id[:8]} range={seg.start}-{seg.end}ms "
            f"duration={segment_duration:.0f}ms strategy={strategy_label} "
            f"start_scale={params.start_scale:.3f} end_scale={params.end_scale:.3f} "
            f"pos=({params.position_x:.3f},{params.position_y:.3f}) rot={params.rotation:.3f} "
            f"rule={params.rule_applied}"
        )
        
        # 生成此 segment 的关键帧
        segment_keyframes = params.get_keyframes_for_db(
            clip_id=video_clip_id,
            duration_ms=segment_duration
        )
        
        if not segment_keyframes:
            segments_skipped += 1
            logger.debug(f"[Keyframes] 跳过 segment {seg.id[:8]}: TransformParams 返回空关键帧")
            continue
        
        # 调整关键帧的 offset 以反映 segment 在视频中的位置
        seg_start_in_clip = max(0, seg.start - video_start)
        seg_end_in_clip = min(video_duration, seg.end - video_start)
        
        if seg_end_in_clip <= seg_start_in_clip:
            segments_skipped += 1
            continue
        
        # 计算 segment 在整个视频中的相对位置
        clip_start_offset = seg_start_in_clip / video_duration if video_duration > 0 else 0
        clip_end_offset = seg_end_in_clip / video_duration if video_duration > 0 else 1
        segment_span = clip_end_offset - clip_start_offset
        
        # 调整每个关键帧的 offset
        for kf in segment_keyframes:
            # 将 segment 内的 offset (0-1) 映射到视频 clip 的 offset
            original_offset = kf['offset']
            kf['offset'] = clip_start_offset + original_offset * segment_span
        
        all_keyframes.extend(segment_keyframes)
        segments_with_keyframes += 1
        
        logger.info(
            f"[Keyframes] segment {seg.id[:8]}: "
            f"创建 {len(segment_keyframes)} 个关键帧, "
            f"offset {clip_start_offset:.2f}-{clip_end_offset:.2f}"
        )
    
    logger.info(
        f"[Keyframes] 总计: {segments_with_keyframes} 个 segment 生成关键帧, "
        f"{segments_skipped} 个跳过, 共 {len(all_keyframes)} 个关键帧"
    )
    
    return all_keyframes


def _collect_statistics(smart_segments: List) -> Tuple[Dict[str, int], Dict[str, int], Dict[str, int]]:
    """收集分析统计信息
    
    Returns:
        Tuple of (emotion_distribution, importance_distribution, transform_distribution)
    """
    emotion_dist = {}
    importance_dist = {}
    transform_dist = {}
    
    for seg in smart_segments:
        emotion_dist[seg.emotion] = emotion_dist.get(seg.emotion, 0) + 1
        importance_dist[seg.importance] = importance_dist.get(seg.importance, 0) + 1
        transform_dist[seg.transform_type] = transform_dist.get(seg.transform_type, 0) + 1
    
    return emotion_dist, importance_dist, transform_dist


async def _get_project_subtitle_clips(project_id: str) -> List[dict]:
    """获取项目所有字幕 clips"""
    # 先获取项目的所有轨道
    tracks_result = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
    if not tracks_result.data:
        return []
    
    track_ids = [t["id"] for t in tracks_result.data]
    
    # 获取这些轨道上的所有字幕 clips
    result = supabase.table("clips").select("*").eq(
        "clip_type", "subtitle"
    ).in_("track_id", track_ids).order("start_time").execute()
    
    return result.data or []


def _update_subtitle_clips_metadata(smart_segments: List, subtitle_clips: List[dict]) -> int:
    """将情绪分析结果更新到字幕 clips 的 metadata 中
    
    优化：使用批量更新减少数据库请求次数
    
    Returns:
        更新的字幕数量
    """
    now = datetime.utcnow().isoformat()
    
    # 创建 segment id -> analysis result 的映射
    analysis_map = {}
    for seg in smart_segments:
        analysis_map[seg.id] = {
            "emotion": seg.emotion.value if hasattr(seg.emotion, 'value') else str(seg.emotion),
            "importance": seg.importance.value if hasattr(seg.importance, 'value') else str(seg.importance),
            "keywords": seg.keywords if hasattr(seg, 'keywords') else [],
            "transform_type": seg.transform_type if hasattr(seg, 'transform_type') else "static",
            "scale_start": seg.scale_start if hasattr(seg, 'scale_start') else None,
            "scale_end": seg.scale_end if hasattr(seg, 'scale_end') else None,
            "analyzed_at": now,
        }
    
    # 收集需要更新的 clips 和对应的 metadata
    updates_by_metadata = {}  # metadata JSON string -> list of clip_ids
    
    failed_updates = []  # 收集失败的更新
    for clip in subtitle_clips:
        clip_id = clip["id"]
        if clip_id not in analysis_map:
            continue
        
        # 合并现有 metadata 和新的分析结果
        existing_metadata = clip.get("metadata") or {}
        new_metadata = {
            **existing_metadata,
            "ai_analysis": analysis_map[clip_id],
        }
        
        # 由于每个 clip 的 metadata 可能不同，需要单独更新
        # 但可以使用 upsert 或事务来优化
        try:
            supabase.table("clips").update({
                "metadata": new_metadata,
                "updated_at": now,
            }).eq("id", clip_id).execute()
        except Exception as e:
            failed_updates.append((clip_id, str(e)))
    
    # 如果有失败的更新，抛出错误
    if failed_updates:
        error_msg = f"更新字幕 metadata 失败: {len(failed_updates)} 个失败"
        for clip_id, err in failed_updates[:3]:  # 只显示前3个
            error_msg += f"\n  - {clip_id[:8]}: {err}"
        raise RuntimeError(error_msg)
    
    return len([c for c in subtitle_clips if c["id"] in analysis_map])


@router.post("/reanalyze-from-clips")
async def reanalyze_from_clips(request: ReanalyzeFromClipsRequest):
    """
    基于字幕片段重新运行 AI 情绪分析 (Phase 1: 字幕级情绪分析)
    
    流程：
    1. 获取字幕 clips（指定视频 clip 范围内的，或项目全部）
    2. 对每个字幕独立运行 LLM 情绪分析
    3. 将分析结果存到字幕 clip 的 metadata.ai_analysis 中
    4. 生成运镜决策
    5. 创建关键帧（如果指定了视频 clip）
    
    新增功能：
    - 不指定 video_clip_id 时，分析项目所有字幕
    - 情绪分析结果持久化到字幕 clip 的 metadata 中
    """
    try:
        from ..services.ai_video_creator import ai_video_creator, SmartSegment
        
        video_clip_id = request.video_clip_id
        video_clip = None
        video_start = 0
        video_duration = 0
        
        # 1. 获取字幕 clips
        if video_clip_id:
            # 指定视频 clip：获取其时间范围内的字幕
            logger.info(f"Reanalyze: 分析视频 Clip 范围内的字幕 - project={request.project_id}, clip={video_clip_id}")
            video_clip = await _get_video_clip(video_clip_id)
            video_start = video_clip.get("start_time", 0)
            video_end = video_clip.get("end_time", 0)
            video_duration = video_end - video_start
            subtitle_clips = await _find_subtitle_clips(video_clip, video_clip_id)
        else:
            # 未指定：获取项目所有字幕
            logger.info(f"Reanalyze: 分析项目所有字幕 - project={request.project_id}")
            subtitle_clips = await _get_project_subtitle_clips(request.project_id)
        
        if not subtitle_clips:
            raise HTTPException(status_code=400, detail="没有找到字幕片段")
        
        logger.info(f"Reanalyze: 找到 {len(subtitle_clips)} 个字幕片段")
        
        # 2. 转换为分析格式
        segments = _convert_to_segments(subtitle_clips)
        if not segments:
            raise HTTPException(status_code=400, detail="没有有效的字幕文本")
        
        # 3. 创建 SmartSegment
        smart_segments = [
            SmartSegment(id=seg["id"], start=seg["start"], end=seg["end"], text=seg["text"])
            for seg in segments
        ]
        for seg, orig in zip(smart_segments, segments):
            seg.metadata = {"clip_id": orig["clip_id"]}
        
        # 4. LLM 情绪分析（字幕级）
        if request.enable_llm and smart_segments:
            logger.info(f"Reanalyze: 对 {len(smart_segments)} 个字幕运行 LLM 情绪分析")
            smart_segments = await ai_video_creator._step3_llm_analysis(smart_segments)
        
        # 5. 生成运镜决策
        logger.debug("Reanalyze: 生成运镜决策")
        smart_segments = ai_video_creator._step4_generate_transform(smart_segments)
        
        # 6. 【新增】将分析结果更新到字幕 clips 的 metadata
        updated_count = _update_subtitle_clips_metadata(smart_segments, subtitle_clips)
        logger.info(f"Reanalyze: 更新 {updated_count} 个字幕的 metadata")
        
        # 7. 如果指定了视频 clip，创建关键帧
        keyframes = []
        if video_clip_id and video_clip:
            supabase.table("keyframes").delete().eq("clip_id", video_clip_id).execute()
            keyframes = _create_keyframes_from_segments(
                smart_segments, video_clip_id, video_start, video_duration
            )
            if keyframes:
                supabase.table("keyframes").insert(keyframes).execute()
                logger.info(f"Reanalyze: 创建 {len(keyframes)} 个关键帧")
        
        # 8. 收集统计
        emotion_dist, importance_dist, transform_dist = _collect_statistics(smart_segments)
        logger.info(f"Reanalyze 完成: 字幕={len(smart_segments)}, 情绪={emotion_dist}")
        
        return {
            "success": True,
            "video_clip_id": video_clip_id,
            "subtitles_analyzed": len(smart_segments),
            "subtitles_updated": updated_count,
            "keyframes_created": len(keyframes),
            "emotion_distribution": emotion_dist,
            "importance_distribution": importance_dist,
            "transform_distribution": transform_dist,
            "details": [
                {
                    "subtitle_id": seg.id,
                    "text": seg.text[:50] + "..." if len(seg.text) > 50 else seg.text,
                    "emotion": seg.emotion.value if hasattr(seg.emotion, 'value') else str(seg.emotion),
                    "importance": seg.importance.value if hasattr(seg.importance, 'value') else str(seg.importance),
                    "transform": seg.transform_type if hasattr(seg, 'transform_type') else "static",
                    "scale": f"{seg.scale_start:.2f}→{seg.scale_end:.2f}" if hasattr(seg, 'scale_start') and seg.scale_start else "static",
                }
                for seg in smart_segments
            ]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Reanalyze 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Phase 2: 智能切片决策引擎
# ============================================

class SmartSliceRequest(BaseModel):
    """智能切片请求"""
    project_id: str
    enable_llm: bool = True  # 是否先运行情绪分析


# 切片决策规则
SLICE_RULES = {
    # 必须独立成片的情绪组合
    "must_isolate": [
        ("excited", "high"),    # 激动 + 高重要性 → 独立
        ("excited", "medium"),  # 激动 + 中重要性 → 独立
        ("serious", "high"),    # 严肃 + 高重要性 → 独立
    ],
    # 可以合并的情绪组合
    "can_merge": [
        ("neutral", "low"),     # 平淡 + 低重要性 → 可合并
        ("neutral", "medium"),  # 平淡 + 中重要性 → 可合并
        ("happy", "low"),       # 开心 + 低重要性 → 可合并
    ],
    # 最大合并时长（毫秒）
    "max_merge_duration": 5000,
    # 最小独立片段时长（毫秒）
    "min_isolated_duration": 500,
}


def _should_isolate(emotion: str, importance: str) -> bool:
    """判断是否应该独立成片"""
    return (emotion, importance) in SLICE_RULES["must_isolate"]


def _can_merge(emotion: str, importance: str) -> bool:
    """判断是否可以合并"""
    return (emotion, importance) in SLICE_RULES["can_merge"]


def _decide_video_slices(subtitle_clips: List[dict]) -> List[dict]:
    """
    智能切片决策：根据字幕情绪分析结果决定视频片段划分
    
    规则：
    1. excited + high/medium → 必须独立成片
    2. neutral + low → 可以和相邻的合并
    3. 其他情况 → 默认独立
    
    Returns:
        List of video slice definitions:
        [
            {
                "slice_id": "slice_1",
                "subtitle_ids": ["sub_1", "sub_2"],  # 包含的字幕 ID
                "start_time": 0,
                "end_time": 3000,
                "reason": "merged:neutral+low",  # 切片原因
                "emotions": ["neutral", "neutral"],
                "transform_hint": "static",  # 建议的运镜效果
            }
        ]
    """
    if not subtitle_clips:
        return []
    
    slices = []
    current_slice = None
    
    for clip in subtitle_clips:
        ai_analysis = (clip.get("metadata") or {}).get("ai_analysis", {})
        emotion = ai_analysis.get("emotion", "neutral")
        importance = ai_analysis.get("importance", "medium")
        transform_type = ai_analysis.get("transform_type", "static")
        
        clip_info = {
            "id": clip["id"],
            "text": clip.get("content_text", ""),
            "start": clip.get("start_time", 0),
            "end": clip.get("end_time", 0),
            "emotion": emotion,
            "importance": importance,
            "transform": transform_type,
        }
        
        # 决策：是否独立成片
        if _should_isolate(emotion, importance):
            # 先结束当前合并中的 slice
            if current_slice:
                slices.append(current_slice)
                current_slice = None
            
            # 创建独立 slice
            slices.append({
                "slice_id": f"slice_{len(slices) + 1}",
                "subtitle_ids": [clip_info["id"]],
                "start_time": clip_info["start"],
                "end_time": clip_info["end"],
                "reason": f"isolated:{emotion}+{importance}",
                "emotions": [emotion],
                "transform_hint": transform_type,
                "is_highlight": True,  # 标记为高光片段
            })
        
        elif _can_merge(emotion, importance):
            # 可以合并
            if current_slice:
                # 检查合并后是否超过最大时长
                merged_duration = clip_info["end"] - current_slice["start_time"]
                if merged_duration <= SLICE_RULES["max_merge_duration"]:
                    # 合并到当前 slice
                    current_slice["subtitle_ids"].append(clip_info["id"])
                    current_slice["end_time"] = clip_info["end"]
                    current_slice["emotions"].append(emotion)
                else:
                    # 超时长，结束当前 slice，开始新的
                    slices.append(current_slice)
                    current_slice = {
                        "slice_id": f"slice_{len(slices) + 1}",
                        "subtitle_ids": [clip_info["id"]],
                        "start_time": clip_info["start"],
                        "end_time": clip_info["end"],
                        "reason": f"merged:{emotion}+{importance}",
                        "emotions": [emotion],
                        "transform_hint": "static",
                        "is_highlight": False,
                    }
            else:
                # 开始新的合并 slice
                current_slice = {
                    "slice_id": f"slice_{len(slices) + 1}",
                    "subtitle_ids": [clip_info["id"]],
                    "start_time": clip_info["start"],
                    "end_time": clip_info["end"],
                    "reason": f"merged:{emotion}+{importance}",
                    "emotions": [emotion],
                    "transform_hint": "static",
                    "is_highlight": False,
                }
        
        else:
            # 默认：独立成片
            if current_slice:
                slices.append(current_slice)
                current_slice = None
            
            slices.append({
                "slice_id": f"slice_{len(slices) + 1}",
                "subtitle_ids": [clip_info["id"]],
                "start_time": clip_info["start"],
                "end_time": clip_info["end"],
                "reason": f"default:{emotion}+{importance}",
                "emotions": [emotion],
                "transform_hint": transform_type,
                "is_highlight": importance == "high",
            })
    
    # 别忘了最后一个 slice
    if current_slice:
        slices.append(current_slice)
    
    return slices


@router.post("/smart-slice")
async def smart_slice(request: SmartSliceRequest):
    """
    智能切片决策 API (Phase 2)
    
    根据字幕的情绪分析结果，智能决定视频片段的划分：
    - excited + high → "但是！" 这样的片段独立成片，展示放大效果
    - neutral + low → 平淡片段可以合并，减少碎片化
    
    流程：
    1. 获取项目所有字幕（带 ai_analysis metadata）
    2. 如果没有分析结果，先运行情绪分析
    3. 应用切片决策规则
    4. 返回建议的视频片段划分
    
    注意：此 API 仅返回切片建议，不实际修改数据库
    """
    try:
        from ..services.ai_video_creator import ai_video_creator, SmartSegment
        
        logger.info(f"SmartSlice: 智能切片决策 - project={request.project_id}")
        
        # 1. 获取项目所有字幕
        subtitle_clips = await _get_project_subtitle_clips(request.project_id)
        if not subtitle_clips:
            raise HTTPException(status_code=400, detail="没有找到字幕片段")
        
        logger.info(f"SmartSlice: 找到 {len(subtitle_clips)} 个字幕")
        
        # 2. 检查是否已有情绪分析结果
        analyzed_count = sum(
            1 for c in subtitle_clips 
            if (c.get("metadata") or {}).get("ai_analysis")
        )
        
        # 如果大部分字幕没有分析结果，先运行分析
        if analyzed_count < len(subtitle_clips) * 0.5 and request.enable_llm:
            logger.info(f"SmartSlice: {analyzed_count}/{len(subtitle_clips)} 已分析，先运行情绪分析")
            
            # 复用 reanalyze 逻辑
            segments = _convert_to_segments(subtitle_clips)
            smart_segments = [
                SmartSegment(id=seg["id"], start=seg["start"], end=seg["end"], text=seg["text"])
                for seg in segments
            ]
            
            smart_segments = await ai_video_creator._step3_llm_analysis(smart_segments)
            smart_segments = ai_video_creator._step4_generate_transform(smart_segments)
            
            _update_subtitle_clips_metadata(smart_segments, subtitle_clips)
            
            # 重新获取更新后的字幕
            subtitle_clips = await _get_project_subtitle_clips(request.project_id)
        
        # 3. 应用切片决策规则
        slices = _decide_video_slices(subtitle_clips)
        
        # 4. 统计
        isolated_count = sum(1 for s in slices if "isolated" in s.get("reason", ""))
        merged_count = sum(1 for s in slices if "merged" in s.get("reason", ""))
        highlight_count = sum(1 for s in slices if s.get("is_highlight"))
        
        logger.info(f"SmartSlice 完成: 总片段={len(slices)}, 独立={isolated_count}, 合并={merged_count}, 高光={highlight_count}")
        
        return {
            "success": True,
            "project_id": request.project_id,
            "total_subtitles": len(subtitle_clips),
            "total_slices": len(slices),
            "statistics": {
                "isolated_slices": isolated_count,
                "merged_slices": merged_count,
                "highlight_slices": highlight_count,
            },
            "slices": slices,
            "rules_applied": SLICE_RULES,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"SmartSlice 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/apply-smart-slice")
async def apply_smart_slice(request: SmartSliceRequest):
    """
    应用智能切片：根据决策结果重新生成视频片段
    
    流程：
    1. 运行 smart-slice 获取切片决策
    2. 删除现有视频 clips
    3. 根据切片决策创建新的视频 clips
    4. 为每个视频 clip 创建对应的关键帧
    
    ⚠️ 此 API 会修改数据库，请谨慎使用
    """
    try:
        logger.info(f"ApplySmartSlice: 应用智能切片 - project={request.project_id}")
        
        # 1. 获取切片决策
        slice_result = await smart_slice(request)
        slices = slice_result.get("slices", [])
        
        if not slices:
            raise HTTPException(status_code=400, detail="没有生成切片决策")
        
        # 2. 获取项目的视频轨道
        tracks_result = supabase.table("tracks").select("*").eq(
            "project_id", request.project_id
        ).execute()
        
        video_track = None
        for track in (tracks_result.data or []):
            # 找到包含视频 clip 的轨道
            clips_check = supabase.table("clips").select("id").eq(
                "track_id", track["id"]
            ).eq("clip_type", "video").limit(1).execute()
            if clips_check.data:
                video_track = track
                break
        
        if not video_track:
            raise HTTPException(status_code=400, detail="没有找到视频轨道")
        
        video_track_id = video_track["id"]
        
        # 3. 获取原始视频 asset 信息（用于 source_start/source_end）
        old_clips = supabase.table("clips").select("*").eq(
            "track_id", video_track_id
        ).eq("clip_type", "video").order("start_time").execute()
        
        # 获取第一个 clip 的 asset_id 作为参考
        asset_id = None
        if old_clips.data:
            asset_id = old_clips.data[0].get("asset_id")
        
        # 4. 删除旧的视频 clips 和关键帧（优化：批量删除）
        old_clip_ids = [c["id"] for c in (old_clips.data or [])]
        if old_clip_ids:
            supabase.table("keyframes").delete().in_("clip_id", old_clip_ids).execute()
            supabase.table("clips").delete().in_("id", old_clip_ids).execute()
            logger.info(f"ApplySmartSlice: 删除 {len(old_clip_ids)} 个旧视频 clips")
        
        # 5. 创建新的视频 clips
        now = datetime.utcnow().isoformat()
        new_clips = []
        all_keyframes = []
        
        for idx, slice_info in enumerate(slices):
            clip_id = str(uuid4())
            start_time = slice_info["start_time"]
            end_time = slice_info["end_time"]
            duration = end_time - start_time
            
            # 确定运镜效果
            is_highlight = slice_info.get("is_highlight", False)
            transform_hint = slice_info.get("transform_hint", "static")
            
            # 创建视频 clip
            new_clip = {
                "id": clip_id,
                "track_id": video_track_id,
                "asset_id": asset_id,
                "clip_type": "video",
                "name": f"片段 {idx + 1}" + (" ⭐" if is_highlight else ""),
                "start_time": start_time,
                "end_time": end_time,
                "source_start": start_time,  # 假设源时间 = 时间线时间
                "source_end": end_time,
                "volume": 1.0,
                "is_muted": False,
                "speed": 1.0,
                "metadata": {
                    "smart_slice": {
                        "reason": slice_info.get("reason"),
                        "emotions": slice_info.get("emotions"),
                        "subtitle_ids": slice_info.get("subtitle_ids"),
                        "is_highlight": is_highlight,
                    }
                },
                "created_at": now,
                "updated_at": now,
            }
            new_clips.append(new_clip)
            
            # 6. 为高光片段创建关键帧
            if is_highlight and transform_hint != "static":
                # 创建 zoom in 关键帧（使用归一化 offset 0-1）
                scale_start = 1.0
                scale_end = 1.25 if "excited" in str(slice_info.get("emotions", [])) else 1.15
                
                for prop in ["scaleX", "scaleY"]:
                    # 开始关键帧 (offset = 0)
                    all_keyframes.append({
                        "id": str(uuid4()),
                        "clip_id": clip_id,
                        "property": prop,
                        "offset": 0.0,  # 归一化 offset (0-1)
                        "value": scale_start,
                        "easing": "easeInOut",
                        "created_at": now,
                        "updated_at": now,
                    })
                    # 结束关键帧 (offset = 1)
                    all_keyframes.append({
                        "id": str(uuid4()),
                        "clip_id": clip_id,
                        "property": prop,
                        "offset": 1.0,  # 归一化 offset (0-1)
                        "value": scale_end,
                        "easing": "easeInOut",
                        "created_at": now,
                        "updated_at": now,
                    })
        
        # ★★★ 验证：确保所有 clip 都有必需的字段 ★★★
        required_fields = ["id", "track_id", "clip_type", "start_time", "end_time"]
        for clip in new_clips:
            for field in required_fields:
                if clip.get(field) is None:
                    logger.error(f"❌ ApplySmartSlice clip {clip.get('id', 'unknown')[:8]} 缺少必需字段: {field}")
                    raise ValueError(f"Clip 缺少必需字段: {field}")
        
        # 7. 批量插入
        if new_clips:
            supabase.table("clips").insert(new_clips).execute()
            logger.info(f"ApplySmartSlice: 创建 {len(new_clips)} 个新视频 clips")
        
        if all_keyframes:
            supabase.table("keyframes").insert(all_keyframes).execute()
            logger.info(f"ApplySmartSlice: 创建 {len(all_keyframes)} 个关键帧")
        
        return {
            "success": True,
            "project_id": request.project_id,
            "clips_created": len(new_clips),
            "keyframes_created": len(all_keyframes),
            "slices": slices,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"ApplySmartSlice 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 智能一键成片 V2 API
# ============================================

class ContentAnalysisRequest(BaseModel):
    """智能内容分析请求"""
    project_id: str
    script: Optional[str] = None  # 用户脚本（可选）
    transcript_id: Optional[str] = None  # ASR 结果 ID（如果已有）
    options: Optional[Dict[str, Any]] = None  # 分析选项


class ContentAnalysisResponse(BaseModel):
    """智能内容分析响应"""
    analysis_id: str
    status: str
    message: str


class SegmentSelection(BaseModel):
    """片段选择"""
    segment_id: str
    action: str  # 'keep' | 'delete'
    selected_from_group: Optional[str] = None


class SelectionConfirmRequest(BaseModel):
    """确认选择请求"""
    analysis_id: str
    selections: List[SegmentSelection]
    apply_zoom_recommendations: bool = True


@router.post("/v2/analyze-content", response_model=ContentAnalysisResponse)
async def analyze_content_v2(
    request: ContentAnalysisRequest,
    background_tasks: BackgroundTasks
):
    """
    智能一键成片 V2 - 内容分析
    
    支持两种模式：
    1. 有脚本模式：对比脚本和 ASR 结果
    2. 无脚本模式：智能识别废话和有效内容
    
    异步执行，返回 analysis_id 用于轮询进度
    """
    from ..services.smart_analyzer import (
        create_content_analysis,
        ProcessingStage
    )
    
    try:
        # 获取项目信息
        project_result = supabase.table("projects").select("*").eq("id", request.project_id).single().execute()
        if not project_result.data:
            raise HTTPException(status_code=404, detail="项目不存在")
        
        project = project_result.data
        user_id = project.get("user_id", "unknown")
        
        # 创建分析记录
        analysis_id = await create_content_analysis(
            project_id=request.project_id,
            user_id=user_id,
            script=request.script
        )
        
        # 异步执行分析
        background_tasks.add_task(
            execute_smart_analysis,
            analysis_id,
            request.project_id,
            request.script,
            request.options or {}
        )
        
        return ContentAnalysisResponse(
            analysis_id=analysis_id,
            status="pending",
            message="分析任务已创建，请轮询 /v2/analysis/{id}/progress 获取进度"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"创建分析任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/v2/analysis/{analysis_id}/progress")
async def get_analysis_progress_v2(analysis_id: str):
    """
    获取分析进度
    
    返回当前处理阶段和进度百分比
    """
    from ..services.smart_analyzer import get_analysis_progress
    
    progress = await get_analysis_progress(analysis_id)
    if not progress:
        raise HTTPException(status_code=404, detail="分析任务不存在")
    
    return progress


@router.get("/v2/analysis/{analysis_id}/result")
async def get_analysis_result_v2(analysis_id: str):
    """
    获取分析结果
    
    分析完成后调用，返回完整的分析结果
    """
    try:
        result = supabase.table("content_analyses").select("*").eq("id", analysis_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="分析任务不存在")
        
        data = result.data
        
        if data["status"] not in ["completed", "confirmed"]:
            raise HTTPException(
                status_code=400, 
                detail=f"分析尚未完成，当前状态: {data['status']}"
            )
        
        # ★ 标准化 segments 中的 classification（中文 -> 英文）
        segments = data.get("segments") or []
        for seg in segments:
            if isinstance(seg, dict) and "classification" in seg:
                seg["classification"] = normalize_classification(seg["classification"])
        
        return {
            "id": data["id"],
            "project_id": data["project_id"],
            "mode": data["mode"],
            "segments": segments,
            "repeat_groups": data["repeat_groups"],
            "style_analysis": data["style_analysis"],
            "summary": data["summary"],
            "status": data["status"]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"获取分析结果失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/v2/project/{project_id}/latest-analysis")
async def get_latest_analysis_by_project(project_id: str):
    """
    根据项目 ID 获取最新的分析结果
    
    用于弹窗打开时没有 analysis_id 的场景
    """
    try:
        # 查询该项目最新的已完成分析
        result = supabase.table("content_analyses") \
            .select("*") \
            .eq("project_id", project_id) \
            .in_("status", ["completed", "confirmed"]) \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()
        
        if not result.data or len(result.data) == 0:
            # 返回空结果而不是404，表示项目没有分析记录
            return {
                "has_analysis": False,
                "analysis": None
            }
        
        data = result.data[0]
        
        # ★ 标准化 segments 中的 classification（中文 -> 英文）
        segments = data.get("segments") or []
        for seg in segments:
            if isinstance(seg, dict) and "classification" in seg:
                seg["classification"] = normalize_classification(seg["classification"])
        
        return {
            "has_analysis": True,
            "analysis": {
                "id": data["id"],
                "project_id": data["project_id"],
                "mode": data["mode"],
                "segments": segments,
                "repeat_groups": data["repeat_groups"],
                "style_analysis": data["style_analysis"],
                "summary": data["summary"],
                "status": data["status"]
            }
        }
        
    except Exception as e:
        logger.exception(f"获取项目最新分析结果失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/v2/confirm-selection")
async def confirm_selection_v2(request: SelectionConfirmRequest):
    """
    确认用户的选择，生成最终的 clips
    
    用户在审核界面完成选择后调用
    """
    try:
        logger.info(f"🎬 [confirm-selection] 开始处理确认请求")
        logger.info(f"   analysis_id: {request.analysis_id}")
        logger.info(f"   selections 数量: {len(request.selections)}")
        logger.info(f"   apply_zoom: {request.apply_zoom_recommendations}")
        
        # 详细记录每个 selection
        for i, sel in enumerate(request.selections):
            logger.debug(f"   selection[{i}]: segment_id={sel.segment_id[:8] if sel.segment_id else 'N/A'}, action={sel.action}")
        
        # 获取分析结果
        analysis_result = supabase.table("content_analyses").select("*").eq("id", request.analysis_id).single().execute()
        
        if not analysis_result.data:
            logger.error(f"   ❌ 分析任务不存在: {request.analysis_id}")
            raise HTTPException(status_code=404, detail="分析任务不存在")
        
        analysis = analysis_result.data
        logger.info(f"   分析任务状态: {analysis['status']}")
        logger.info(f"   project_id: {analysis.get('project_id')}")
        logger.info(f"   segments 数量: {len(analysis.get('segments', []))}")
        
        # ★★★ 修复：允许 completed 和 confirmed 状态都能确认选择 ★★★
        # confirmed 状态说明用户之前确认过，现在重新确认（幂等操作）
        if analysis["status"] not in ["completed", "confirmed"]:
            logger.error(f"   ❌ 分析状态不正确: {analysis['status']}")
            raise HTTPException(
                status_code=400,
                detail=f"分析状态不正确: {analysis['status']}，需要 completed 或 confirmed"
            )
        
        # 保存用户选择
        selection_id = str(uuid4())
        selection_data = {
            "id": selection_id,
            "analysis_id": request.analysis_id,
            "user_id": analysis["user_id"],
            "selections": [s.model_dump() for s in request.selections],
            "apply_zoom_recommendations": request.apply_zoom_recommendations,
            "created_at": datetime.utcnow().isoformat()
        }
        
        supabase.table("content_selections").insert(selection_data).execute()
        logger.info(f"   ✓ 用户选择已保存: selection_id={selection_id}")
        
        # 更新分析状态为已确认
        supabase.table("content_analyses").update({
            "status": "confirmed",
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", request.analysis_id).execute()
        logger.info(f"   ✓ 分析状态已更新为 confirmed")
        
        # 生成 clips（基于选择结果）
        logger.info(f"   ⏳ 开始生成 clips...")
        clips_count = await generate_clips_from_selection(
            analysis=analysis,
            selections=request.selections,
            apply_zoom=request.apply_zoom_recommendations
        )
        logger.info(f"   ✓ clips 生成完成: {clips_count} 个")
        
        # 更新生成的 clips 数量
        supabase.table("content_selections").update({
            "generated_clips_count": clips_count
        }).eq("id", selection_id).execute()
        
        # ★★★ 添加详细日志：查询最终保留的 clips 和 keyframes ★★★
        project_id = analysis.get('project_id')
        if project_id:
            # 获取视频轨道
            track_result = supabase.table("tracks").select("id").eq(
                "project_id", project_id
            ).order("order_index").limit(1).execute()
            
            if track_result.data:
                track_id = track_result.data[0]["id"]
                
                # 获取保留的视频 clips
                final_clips = supabase.table("clips").select(
                    "id, start_time, end_time, source_start, source_end, asset_id"
                ).eq("track_id", track_id).eq("clip_type", "video").order("start_time").execute()
                
                clips_data = final_clips.data or []
                logger.info(f"\n🎬 [confirm-selection] 最终保留的视频 clips: {len(clips_data)} 个")
                for i, c in enumerate(clips_data[:10]):
                    logger.info(f"   [{i}] id={c['id'][:8]}, timeline={c['start_time']}-{c['end_time']}, source={c['source_start']}-{c['source_end']}")
                if len(clips_data) > 10:
                    logger.info(f"   ... 还有 {len(clips_data) - 10} 个 clips")
                
                # 获取保留的字幕
                clip_ids = [c['id'] for c in clips_data]
                if clip_ids:
                    subtitles = supabase.table("clips").select(
                        "id, parent_clip_id, start_time, content_text"
                    ).in_("parent_clip_id", clip_ids).order("start_time").execute()
                    
                    sub_data = subtitles.data or []
                    logger.info(f"\n📝 [confirm-selection] 保留的字幕: {len(sub_data)} 条")
                
                # 获取保留的关键帧
                if clip_ids:
                    keyframes = supabase.table("keyframes").select(
                        "id, clip_id, property, offset, value"
                    ).in_("clip_id", clip_ids).order("clip_id, offset").execute()
                    
                    kf_data = keyframes.data or []
                    logger.info(f"\n🎯 [confirm-selection] 保留的关键帧: {len(kf_data)} 个")
                    for i, kf in enumerate(kf_data[:20]):
                        logger.info(f"   [{i}] clip={kf['clip_id'][:8]}, prop={kf['property']}, offset={kf['offset']:.2f}, value={kf['value']}")
                    if len(kf_data) > 20:
                        logger.info(f"   ... 还有 {len(kf_data) - 20} 个关键帧")
        
        logger.info(f"\n🎬 [confirm-selection] 完成! clips_created={clips_count}")
        
        return {
            "success": True,
            "selection_id": selection_id,
            "clips_created": clips_count,
            "message": "选择已确认，clips 已生成"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"❌ [confirm-selection] 确认选择失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 脚本管理 API
# ============================================

class ScriptUploadRequest(BaseModel):
    """脚本上传请求"""
    project_id: str
    content: str
    title: Optional[str] = None


@router.post("/v2/scripts")
async def upload_script(request: ScriptUploadRequest):
    """上传项目脚本"""
    try:
        # 获取项目
        project_result = supabase.table("projects").select("user_id").eq("id", request.project_id).single().execute()
        if not project_result.data:
            raise HTTPException(status_code=404, detail="项目不存在")
        
        user_id = project_result.data["user_id"]
        
        # 检查是否已有脚本
        existing = supabase.table("project_scripts").select("id").eq("project_id", request.project_id).execute()
        
        script_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        word_count = len(request.content)
        
        if existing.data:
            # 更新已有脚本
            script_id = existing.data[0]["id"]
            supabase.table("project_scripts").update({
                "content": request.content,
                "title": request.title,
                "word_count": word_count,
                "updated_at": now
            }).eq("id", script_id).execute()
        else:
            # 创建新脚本
            supabase.table("project_scripts").insert({
                "id": script_id,
                "project_id": request.project_id,
                "user_id": user_id,
                "content": request.content,
                "title": request.title,
                "word_count": word_count,
                "created_at": now,
                "updated_at": now
            }).execute()
        
        return {
            "id": script_id,
            "project_id": request.project_id,
            "word_count": word_count,
            "message": "脚本上传成功"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"上传脚本失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/v2/scripts/{project_id}")
async def get_script(project_id: str):
    """获取项目脚本"""
    try:
        result = supabase.table("project_scripts").select("*").eq("project_id", project_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="脚本不存在")
        
        return result.data
        
    except HTTPException:
        raise
    except Exception as e:
        if "No rows" in str(e):
            raise HTTPException(status_code=404, detail="脚本不存在")
        logger.exception(f"获取脚本失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 后台执行函数
# ============================================

async def _get_transcription_results(
    project_id: str,
    max_wait_time: int = 60
) -> Tuple[List[Dict], float]:
    """
    获取项目所有视频素材的已有转写结果
    
    ★★★ 只读取，不触发！ASR 已在 workspace 流程中完成 ★★★
    
    Args:
        project_id: 项目 ID
        max_wait_time: 最大等待时间（秒）- 等待 workspace 流程完成 ASR
    
    Returns:
        (merged_segments, total_duration): 合并后的转写片段和总时长
    """
    import asyncio
    
    poll_interval = 3  # 秒
    waited_time = 0
    
    # 1. 获取项目中所有视频素材（按创建时间排序）
    assets_result = supabase.table("assets").select(
        "id, status, storage_path, duration, created_at"
    ).eq("project_id", project_id).eq("file_type", "video").order(
        "created_at"
    ).execute()
    
    if not assets_result.data:
        logger.warning(f"⚠️ 项目 {project_id} 没有视频素材")
        return [], 0
    
    asset_ids = [a["id"] for a in assets_result.data]
    logger.info(f"📋 项目有 {len(asset_ids)} 个视频素材，等待转写结果...")
    
    # 2. 等待所有素材的转写完成（workspace 流程已触发）
    while waited_time < max_wait_time:
        # 查询所有素材的转写任务
        tasks_result = supabase.table("tasks").select(
            "id, asset_id, status, result"
        ).in_("asset_id", asset_ids).eq("task_type", "transcribe").execute()
        
        # 构建 asset_id -> task 映射（优先使用已完成的）
        task_map = {}
        for task in (tasks_result.data or []):
            asset_id = task.get("asset_id")
            if asset_id not in task_map or task.get("status") == "completed":
                task_map[asset_id] = task
        
        # 检查所有素材是否都有已完成的转写
        completed_results = {}
        pending_count = 0
        
        for asset_id in asset_ids:
            task = task_map.get(asset_id)
            if task and task.get("status") == "completed" and task.get("result"):
                result = task["result"]
                segments = result.get("segments", []) if isinstance(result, dict) else result
                completed_results[asset_id] = segments
            elif task and task.get("status") in ("pending", "running"):
                pending_count += 1
            # 如果没有任务，说明 workspace 流程还没到 ASR 步骤
            elif not task:
                pending_count += 1
        
        # 所有素材都有转写结果
        if len(completed_results) == len(asset_ids):
            logger.info(f"✅ 所有 {len(asset_ids)} 个素材的转写结果已就绪")
            break
        
        # 还有未完成的
        if waited_time < max_wait_time:
            logger.info(f"⏳ 等待转写完成... ({len(completed_results)}/{len(asset_ids)} 已完成, {pending_count} 进行中, 已等待 {waited_time}s)")
            await asyncio.sleep(poll_interval)
            waited_time += poll_interval
    
    if waited_time >= max_wait_time and len(completed_results) < len(asset_ids):
        logger.warning(f"⚠️ 等待转写结果超时，只获取到 {len(completed_results)}/{len(asset_ids)} 个")
    
    # 3. 合并所有素材的转写结果（按素材创建时间顺序）
    merged_segments = []
    total_duration = 0
    time_offset_ms = 0  # 时间偏移量（毫秒）
    
    for asset in assets_result.data:
        asset_id = asset["id"]
        asset_duration = asset.get("duration") or 0  # 秒
        asset_duration_ms = int(asset_duration * 1000)  # 转毫秒
        
        segments = completed_results.get(asset_id, [])
        if segments:
            # 为每个片段添加时间偏移和素材标识
            for seg in segments:
                adjusted_seg = seg.copy()
                adjusted_seg["start"] = seg.get("start", 0) + time_offset_ms
                adjusted_seg["end"] = seg.get("end", 0) + time_offset_ms
                adjusted_seg["_asset_id"] = asset_id
                merged_segments.append(adjusted_seg)
            logger.info(f"   ✓ 素材 {asset_id[:8]}: {len(segments)} 个片段")
        else:
            logger.warning(f"   ✗ 素材 {asset_id[:8]}: 无转写结果")
        
        time_offset_ms += asset_duration_ms
        total_duration += asset_duration
    
    logger.info(f"📊 合并结果: {len(merged_segments)} 个片段，总时长 {total_duration:.1f}s")
    return merged_segments, total_duration


async def execute_smart_analysis(
    analysis_id: str,
    project_id: str,
    script: Optional[str],
    options: Dict[str, Any]
):
    """后台执行智能分析（支持多素材）"""
    from ..services.smart_analyzer import (
        smart_analyzer,
        ProcessingStage,
        update_analysis_progress,
        save_analysis_result,
        AnalysisResult,
        AnalysisSummary
    )
    import asyncio
    
    try:
        logger.info(f"🚀 开始智能分析: analysis_id={analysis_id}, project_id={project_id}")
        
        # 阶段1: 获取转写结果（ASR 已在 workspace 流程中完成）
        await update_analysis_progress(analysis_id, ProcessingStage.TRANSCRIBING)
        
        # ★★★ 只读取已有的转写结果，不触发新的 ASR ★★★
        transcript_segments, video_duration = await _get_transcription_results(
            project_id=project_id,
            max_wait_time=60  # 最多等待 60 秒（workspace 应该已完成）
        )
        
        # 如果没有转写结果
        if not transcript_segments:
            logger.warning(f"⚠️ 项目 {project_id} 无转写结果，返回空分析结果")
            
            empty_result = AnalysisResult(
                segments=[],
                repeat_groups=[],
                style_analysis=None,
                summary=AnalysisSummary(
                    total_segments=0,
                    keep_count=0,
                    delete_count=0,
                    choose_count=0,
                    repeat_groups_count=0,
                    estimated_duration_after=0.0,
                    reduction_percent=0.0,
                    script_coverage=None
                )
            )
            await save_analysis_result(analysis_id, empty_result)
            await update_analysis_progress(analysis_id, ProcessingStage.COMPLETED)
            logger.info(f"✅ 智能分析完成（无转写内容）: {analysis_id}")
            return
        
        logger.info(f"✅ 获取到 {len(transcript_segments)} 个转写片段，继续分析...")
        logger.info(f"📋 视频总时长: {video_duration:.1f}s")
        
        # 阶段2: LLM 智能分析
        await update_analysis_progress(analysis_id, ProcessingStage.ANALYZING)
        
        result = await smart_analyzer.analyze(
            transcript_segments=transcript_segments,
            script=script,
            audio_features=None,  # TODO: 提取音频特征
            video_duration=video_duration
        )
        
        # 阶段3: 生成推荐
        await update_analysis_progress(analysis_id, ProcessingStage.GENERATING)
        
        # 保存结果
        await save_analysis_result(analysis_id, result)
        
        # 完成
        await update_analysis_progress(analysis_id, ProcessingStage.COMPLETED)
        
        logger.info(f"✅ 智能分析完成: {analysis_id}")
        
    except Exception as e:
        logger.exception(f"❌ 智能分析失败: {e}")
        
        # 更新失败状态
        supabase.table("content_analyses").update({
            "status": "failed",
            "processing_stage": "failed",
            "error_message": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", analysis_id).execute()


async def generate_clips_from_selection(
    analysis: Dict,
    selections: List[SegmentSelection],
    apply_zoom: bool
) -> int:
    """根据用户选择筛选 clips
    
    ★★★ 重构：不再重建 clips，而是复用一键成片已创建的 clips ★★★
    
    逻辑：
    1. 根据 segment 时间范围匹配现有 clips
    2. 删除与 action=delete segments 重叠的 clips（及其关联的字幕和关键帧）
    3. 紧凑时间线 - 更新保留 clips 的 start_time
    
    ★ 关键帧已在一键成片时创建，这里不需要再生成
    """
    project_id = analysis["project_id"]
    segments = analysis.get("segments", [])
    
    logger.info(f"📦 generate_clips_from_selection (简化版): project_id={project_id}")
    logger.info(f"   segments 数量: {len(segments)}")
    logger.info(f"   selections 数量: {len(selections)}")
    
    # 统计选择
    keep_count = sum(1 for s in selections if s.action == "keep")
    delete_count = sum(1 for s in selections if s.action == "delete")
    logger.info(f"   selections 统计: keep={keep_count}, delete={delete_count}")
    
    # 构建选择映射：segment_id -> action
    selection_map = {s.segment_id: s.action for s in selections}
    
    # ★ 收集要删除的时间范围（秒 -> 毫秒）
    delete_time_ranges = []  # [(start_ms, end_ms)]
    for seg in segments:
        seg_id = seg.get("id", "")
        action = selection_map.get(seg_id)
        
        # 没有明确选择的，按推荐来
        if not action:
            should_delete = seg.get("action") == "delete" or not seg.get("is_recommended", True)
        else:
            should_delete = action == "delete"
        
        if should_delete:
            # LLM 输出的时间是秒，转换为毫秒
            start_ms = int(seg.get("start", 0) * 1000)
            end_ms = int(seg.get("end", 0) * 1000)
            delete_time_ranges.append((start_ms, end_ms))
            logger.info(f"   ❌ 要删除: {seg_id} ({start_ms}-{end_ms}ms)")
    
    logger.info(f"📋 要删除的时间范围: {len(delete_time_ranges)} 个")
    
    # ★ 获取视频轨道
    track_result = supabase.table("tracks").select("id").eq(
        "project_id", project_id
    ).order("order_index").limit(1).execute()
    
    if not track_result.data:
        logger.warning(f"项目 {project_id} 没有轨道")
        return 0
    
    track_id = track_result.data[0]["id"]
    logger.info(f"   视频轨道: {track_id}")
    
    # ★ 获取现有视频 clips
    clips_result = supabase.table("clips").select(
        "id, start_time, end_time, source_start, source_end, asset_id"
    ).eq("track_id", track_id).eq("clip_type", "video").order("start_time").execute()
    
    existing_clips = clips_result.data or []
    logger.info(f"   现有视频 clips: {len(existing_clips)} 个")
    
    if not existing_clips:
        logger.warning(f"项目 {project_id} 没有视频 clips")
        return 0
    
    # ★ 判断每个 clip 是否与删除范围重叠
    clips_to_delete = []
    clips_to_keep = []
    
    for clip in existing_clips:
        clip_start = clip["source_start"]  # 使用 source 时间匹配（与原视频对应）
        clip_end = clip["source_end"]
        
        # 检查是否与任何删除范围重叠
        should_delete = False
        for del_start, del_end in delete_time_ranges:
            # 重叠条件：不是完全分离
            if not (clip_end <= del_start or clip_start >= del_end):
                should_delete = True
                logger.info(f"   clip {clip['id'][:8]} ({clip_start}-{clip_end}ms) 与删除范围 ({del_start}-{del_end}ms) 重叠")
                break
        
        if should_delete:
            clips_to_delete.append(clip)
        else:
            clips_to_keep.append(clip)
    
    logger.info(f"📊 筛选结果: 保留 {len(clips_to_keep)} 个, 删除 {len(clips_to_delete)} 个")
    
    # ★★★ 详细日志：列出保留和删除的 clips ★★★
    if clips_to_keep:
        logger.info(f"\n✅ 保留的 clips ({len(clips_to_keep)} 个):")
        for i, c in enumerate(clips_to_keep[:10]):
            logger.info(f"   [{i}] id={c['id'][:8]}, source={c['source_start']}-{c['source_end']}ms")
        if len(clips_to_keep) > 10:
            logger.info(f"   ... 还有 {len(clips_to_keep) - 10} 个")
    
    if clips_to_delete:
        logger.info(f"\n❌ 要删除的 clips ({len(clips_to_delete)} 个):")
        for i, c in enumerate(clips_to_delete[:10]):
            logger.info(f"   [{i}] id={c['id'][:8]}, source={c['source_start']}-{c['source_end']}ms")
        if len(clips_to_delete) > 10:
            logger.info(f"   ... 还有 {len(clips_to_delete) - 10} 个")
    
    # ★★★ 性能优化：如果没有删除任何 clip，直接返回 ★★★
    if not clips_to_delete:
        logger.info(f"✅ 无需删除任何 clip，保持原样")
        return len(clips_to_keep)
    
    # ★ 删除 clips 及其关联数据（关键帧、字幕）
    delete_ids = [c["id"] for c in clips_to_delete]
    
    # 先查询要删除的关键帧数量
    kf_to_delete = supabase.table("keyframes").select("id, clip_id, property").in_("clip_id", delete_ids).execute()
    kf_count = len(kf_to_delete.data or [])
    logger.info(f"\n🗑️ 删除关联数据:")
    logger.info(f"   关键帧: {kf_count} 个")
    
    # 查询要删除的字幕数量
    sub_to_delete = supabase.table("clips").select("id").in_("parent_clip_id", delete_ids).execute()
    sub_count = len(sub_to_delete.data or [])
    logger.info(f"   字幕: {sub_count} 条")
    
    # 删除关联的关键帧
    supabase.table("keyframes").delete().in_("clip_id", delete_ids).execute()
    
    # 删除关联的字幕（parent_clip_id 指向被删除的 clip）
    supabase.table("clips").delete().in_("parent_clip_id", delete_ids).execute()
    
    # 删除视频 clips
    supabase.table("clips").delete().in_("id", delete_ids).execute()
    logger.info(f"   视频 clips: {len(delete_ids)} 个")
    logger.info(f"   已删除 {len(delete_ids)} 个视频 clips")
    
    # ★ 紧凑时间线 - 按 start_time 顺序重新排列（批量优化版）
    now = datetime.utcnow().isoformat()
    timeline_position = 0
    
    # 按原始 start_time 排序（保持顺序）
    clips_to_keep.sort(key=lambda c: c["start_time"])
    
    # ★★★ 性能优化：先计算所有变更，最后批量执行 ★★★
    clip_updates = []  # [(clip_id, new_start, new_end, offset)]
    
    for clip in clips_to_keep:
        clip_duration = clip["end_time"] - clip["start_time"]
        new_start = timeline_position
        new_end = timeline_position + clip_duration
        
        # 只有位置变化时才记录
        if clip["start_time"] != new_start:
            offset = new_start - clip["start_time"]
            clip_updates.append((clip["id"], new_start, new_end, offset))
            logger.debug(f"   clip {clip['id'][:8]}: {clip['start_time']}->{new_start}ms")
        
        timeline_position = new_end
    
    logger.info(f"   需要更新的 clips: {len(clip_updates)} 个")
    
    # ★★★ 批量更新 clips（一次查询获取所有字幕，避免 N+1 问题）★★★
    if clip_updates:
        clip_ids_to_update = [u[0] for u in clip_updates]
        
        # 一次性获取所有需要更新的 clips 的字幕
        all_subtitles_result = supabase.table("clips").select(
            "id, parent_clip_id, start_time, end_time"
        ).in_("parent_clip_id", clip_ids_to_update).execute()
        
        # 构建 parent_clip_id -> subtitles 映射
        subtitles_by_parent = {}
        for sub in (all_subtitles_result.data or []):
            parent_id = sub["parent_clip_id"]
            if parent_id not in subtitles_by_parent:
                subtitles_by_parent[parent_id] = []
            subtitles_by_parent[parent_id].append(sub)
        
        logger.info(f"   关联字幕总数: {len(all_subtitles_result.data or [])} 条")
        
        # 逐个更新 clip（Supabase 不支持真正的批量 upsert with different values）
        # 但至少避免了 N+1 查询问题
        for clip_id, new_start, new_end, offset in clip_updates:
            supabase.table("clips").update({
                "start_time": new_start,
                "end_time": new_end,
                "updated_at": now
            }).eq("id", clip_id).execute()
            
            # 更新该 clip 的字幕
            for sub in subtitles_by_parent.get(clip_id, []):
                supabase.table("clips").update({
                    "start_time": sub["start_time"] + offset,
                    "end_time": sub["end_time"] + offset,
                    "updated_at": now
                }).eq("id", sub["id"]).execute()
    
    logger.info(f"✅ 时间线紧凑完成，总时长: {timeline_position}ms")
