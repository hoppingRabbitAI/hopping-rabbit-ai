"""
HoppingRabbit AI - 任务 API
适配新表结构 (2026-01-07)

新表结构变化：
- tasks: type → task_type, error → error_message
- tasks: 移除 current_step 字段
- assets: type → file_type, 移除 url/subtype/metadata
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from typing import Optional, List
from datetime import datetime
from uuid import uuid4
import re
import logging

logger = logging.getLogger(__name__)

from ..models import ASRRequest, ASRClipRequest, StemSeparationRequest, SmartCleanRequest, ExtractAudioRequest
from ..services.supabase_client import supabase, get_file_url
from .auth import get_current_user_id

router = APIRouter(prefix="/tasks", tags=["Tasks"])


# ============================================
# 任务状态查询
# ============================================

@router.get("/{task_id}")
async def get_task_status(
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """获取任务状态"""
    try:
        result = supabase.table("tasks").select("*").eq("id", task_id).eq("user_id", user_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="任务不存在")
        
        return result.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_tasks(
    project_id: Optional[str] = None,
    asset_id: Optional[str] = None,
    clip_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 20,
    user_id: str = Depends(get_current_user_id)
):
    """获取任务列表（统一 tasks 表）"""
    try:
        # 查询 tasks 表
        query = supabase.table("tasks").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit)
        
        if project_id:
            query = query.eq("project_id", project_id)
        if asset_id:
            query = query.eq("asset_id", asset_id)
        if clip_id:
            query = query.eq("clip_id", clip_id)
        if status:
            query = query.eq("status", status)
        
        result = query.execute()
        all_tasks = result.data or []
        
        # 统一字段名 - 将 result_url 映射为 output_url
        for task in all_tasks:
            if "result_url" in task and not task.get("output_url"):
                task["output_url"] = task.get("result_url")
        
        return {"tasks": all_tasks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{task_id}")
async def cancel_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """取消任务"""
    try:
        result = supabase.table("tasks").update({
            "status": "cancelled",
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).eq("user_id", user_id).eq("status", "pending").execute()
        
        if not result.data:
            raise HTTPException(status_code=400, detail="任务无法取消")
        
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ASR 语音转文字
# ============================================

@router.post("/asr")
async def start_asr_task(
    request: ASRRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id)
):
    """启动语音转文字任务"""
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 从 asset 获取 project_id
        asset_result = supabase.table("assets").select("project_id").eq("id", request.asset_id).eq("user_id", user_id).single().execute()
        if not asset_result.data:
            raise HTTPException(status_code=404, detail="Asset not found")
        project_id = asset_result.data.get("project_id")
        
        supabase.table("tasks").insert({
            "id": task_id,
            "project_id": project_id,
            "user_id": user_id,
            "task_type": "transcribe",
            "asset_id": request.asset_id,
            "status": "pending",
            "progress": 0,
            "params": {"language": request.language, "model": request.model},
            "created_at": now,
            "updated_at": now
        }).execute()
        
        background_tasks.add_task(execute_asr, task_id, request.asset_id, request.language, request.model)
        
        return {"task_id": task_id, "status": "pending"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ASR 语音转文字（基于 Clip）
# ============================================

@router.post("/asr-clip")
async def start_asr_clip_task(
    request: ASRClipRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id)
):
    """对特定 clip 进行语音转文字，只转写 clip 对应的时间范围"""
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 获取 clip 信息
        clip_result = supabase.table("clips").select(
            "id, track_id, asset_id, start_time, end_time, source_start"
        ).eq("id", request.clip_id).single().execute()
        
        if not clip_result.data:
            raise HTTPException(status_code=404, detail="Clip not found")
        
        clip_data = clip_result.data
        
        # 获取 track 以获得 project_id
        track_result = supabase.table("tracks").select("project_id").eq("id", clip_data["track_id"]).single().execute()
        if not track_result.data:
            raise HTTPException(status_code=404, detail="Track not found")
        project_id = track_result.data.get("project_id")
        
        # 获取 asset 信息
        if not clip_data.get("asset_id"):
            raise HTTPException(status_code=400, detail="Clip has no associated asset")
        
        asset_result = supabase.table("assets").select("storage_path").eq("id", clip_data["asset_id"]).eq("user_id", user_id).single().execute()
        if not asset_result.data:
            raise HTTPException(status_code=404, detail="Asset not found")
        
        supabase.table("tasks").insert({
            "id": task_id,
            "project_id": project_id,
            "user_id": user_id,
            "task_type": "transcribe",  # 复用 transcribe 类型，通过 params.clip_id 区分
            "asset_id": clip_data["asset_id"],
            "status": "pending",
            "progress": 0,
            "params": {
                "language": request.language,
                "model": request.model,
                "clip_id": request.clip_id,
                "start_time": clip_data["start_time"],
                "end_time": clip_data["end_time"],
                "source_start": clip_data.get("source_start", 0),
            },
            "created_at": now,
            "updated_at": now
        }).execute()
        
        background_tasks.add_task(
            execute_asr_clip,
            task_id,
            request.clip_id,
            clip_data["asset_id"],
            clip_data["start_time"],
            clip_data["end_time"],
            clip_data.get("source_start", 0),
            project_id,  # 直接传入，避免重复查询
            asset_result.data["storage_path"],  # 直接传入
            request.language,
            request.model
        )
        
        return {"task_id": task_id, "status": "pending"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 提取视频音频
# ============================================

@router.post("/extract-audio")
async def start_extract_audio(
    request: ExtractAudioRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id)
):
    """从视频中提取音频轨道"""
    try:
        # 通过 asset_id 查询 project_id（满足 schema NOT NULL 约束）
        asset_result = supabase.table("assets").select("project_id").eq("id", request.asset_id).eq("user_id", user_id).single().execute()
        if not asset_result.data:
            raise HTTPException(status_code=404, detail="Asset not found")
        project_id = asset_result.data["project_id"]
        
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        supabase.table("tasks").insert({
            "id": task_id,
            "project_id": project_id,
            "user_id": user_id,
            "task_type": "asset_processing",
            "asset_id": request.asset_id,
            "status": "pending",
            "progress": 0,
            "params": {
                "format": request.format,
                "action": "extract_audio",
                "source_start": request.source_start,
                "duration": request.duration
            },
            "created_at": now,
            "updated_at": now
        }).execute()
        
        background_tasks.add_task(
            execute_extract_audio, 
            task_id, 
            request.asset_id, 
            request.format,
            request.source_start,
            request.duration
        )
        
        return {"task_id": task_id, "status": "pending"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 人声分离
# ============================================

@router.post("/stem-separation")
async def start_stem_separation(
    request: StemSeparationRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id)
):
    """启动人声分离任务"""
    try:
        # 通过 asset_id 查询 project_id
        asset_result = supabase.table("assets").select("project_id").eq("id", request.asset_id).eq("user_id", user_id).single().execute()
        if not asset_result.data:
            raise HTTPException(status_code=404, detail="Asset not found")
        project_id = asset_result.data["project_id"]
        
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        supabase.table("tasks").insert({
            "id": task_id,
            "user_id": user_id,
            "project_id": project_id,
            "task_type": "stem_separation",
            "asset_id": request.asset_id,
            "status": "pending",
            "progress": 0,
            "params": {"stems": request.stems},
            "created_at": now,
            "updated_at": now
        }).execute()
        
        background_tasks.add_task(execute_stem_separation, task_id, request.asset_id, request.stems)
        
        return {"task_id": task_id, "status": "pending"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 智能清洗
# ============================================

@router.post("/smart-clean")
async def start_smart_clean(
    request: SmartCleanRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id)
):
    """启动智能清洗任务"""
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        supabase.table("tasks").insert({
            "id": task_id,
            "user_id": user_id,
            "task_type": "smart_clean",
            "project_id": request.project_id,
            "status": "pending",
            "progress": 0,
            "params": request.model_dump(),
            "created_at": now,
            "updated_at": now
        }).execute()
        
        background_tasks.add_task(execute_smart_clean, task_id, request.project_id)
        
        return {"task_id": task_id, "status": "pending"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 任务执行函数
# ============================================

def update_task_progress(task_id: str, progress: int, message: str = None):
    """更新任务进度（不使用 current_step）"""
    update_data = {
        "progress": progress,
        "updated_at": datetime.utcnow().isoformat()
    }
    # message 可以存在 params 或 result 中，但不存在 current_step
    supabase.table("tasks").update(update_data).eq("id", task_id).execute()


async def execute_asr(task_id: str, asset_id: str, language: str, model: str):
    """执行 ASR 任务"""
    try:
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        # 获取资源（使用新字段名）
        asset = supabase.table("assets").select("storage_path, project_id").eq("id", asset_id).single().execute()
        
        if not asset.data:
            raise Exception("资源不存在")
        
        project_id = asset.data.get("project_id")
        
        # 生成签名 URL
        audio_url = get_file_url("clips", asset.data["storage_path"])
        
        # 调用转写
        from ..tasks.transcribe import transcribe_audio
        result = await transcribe_audio(
            audio_url=audio_url,
            language=language,
            model=model,
            word_timestamps=True,
            on_progress=lambda p, s: update_task_progress(task_id, p, s)
        )
        
        # ★ 新增：ASR 完成后自动创建 subtitle clips
        segments = result.get("segments", [])
        created_clips = []
        
        logger.info(f"[ASR] 获取到 {len(segments)} 个 segments, project_id={project_id}")
        
        if segments and project_id:
            try:
                # 获取或创建一个 subtitle 轨道
                track_id = await _get_or_create_subtitle_track(project_id)
                logger.info(f"[ASR] 使用 track_id={track_id}")
                
                # 为每个 segment 创建 clip
                now = datetime.utcnow().isoformat()
                clips_data = []
                
                for seg in segments:
                    clip_id = str(uuid4())
                    # 豆包 ASR segments 时间已经是毫秒
                    start_ms = seg.get("start", 0)
                    end_ms = seg.get("end", 0)
                    # 数据库字段: content_text (不是 subtitle_text)
                    clip_data = {
                        "id": clip_id,
                        "track_id": track_id,
                        "asset_id": asset_id,
                        "clip_type": "subtitle",
                        "start_time": start_ms,
                        "end_time": end_ms,
                        "source_start": 0,
                        "volume": 1.0,
                        "is_muted": False,
                        "speed": 1.0,
                        "content_text": seg.get("text", ""),
                        "text_style": {
                            "speaker": seg.get("speaker")
                        } if seg.get("speaker") else None,
                        "created_at": now,
                        "updated_at": now,
                    }
                    clips_data.append(clip_data)
                
                if clips_data:
                    logger.info(f"[ASR] 准备插入 {len(clips_data)} 个 clips")
                    insert_result = supabase.table("clips").insert(clips_data).execute()
                    created_clips = insert_result.data or []
                    logger.info(f"[ASR] 成功插入 {len(created_clips)} 个 clips")
                    
            except Exception as clip_error:
                # Clips 创建失败不影响任务结果，记录日志即可
                logger.error(f"[ASR] 创建 subtitle clips 失败: {clip_error}")
                import traceback
                traceback.print_exc()
        
        # 在结果中包含创建的 clips 信息
        result["clips_count"] = len(created_clips)
        # 注意：保留 segments 数据，智能分析 V2 需要用它
        # result.pop("segments", None)  # 不再移除
        
        supabase.table("tasks").update({
            "status": "completed",
            "progress": 100,
            "result": result,
            "completed_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
    except Exception as e:
        supabase.table("tasks").update({
            "status": "failed",
            "error_message": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


def _split_segments_by_punctuation(segments: list) -> list:
    """
    将 ASR segments 按标点符号进一步切分成更细的子句
    
    切分规则：
    1. 中文标点：，。！？；
    2. 英文标点：,.!?;
    3. 优先使用 word-level timestamps 精确分配时间
    4. 如果没有 word timestamps，按文本长度比例分配
    
    Args:
        segments: ASR 返回的 segments 列表，每个包含 start, end, text, words
        
    Returns:
        细分后的 segments 列表
    """
    punctuation_pattern = re.compile(r'([，。！？；,.!?;])')
    
    fine_segments = []
    
    for seg in segments:
        text = seg.get("text", "").strip()
        start_ms = seg.get("start", 0)
        end_ms = seg.get("end", 0)
        words = seg.get("words", [])
        total_duration = end_ms - start_ms
        
        if not text or total_duration <= 0:
            continue
        
        # 按标点切分文本
        parts = punctuation_pattern.split(text)
        
        # 重新组合：将标点符号与前面的文本合并
        sentences = []
        buffer = ""
        for part in parts:
            buffer += part
            if punctuation_pattern.match(part):
                if buffer.strip():
                    sentences.append(buffer.strip())
                buffer = ""
        # 处理最后没有标点的部分
        if buffer.strip():
            sentences.append(buffer.strip())
        
        # 如果只有一个句子或没有切分，直接返回原 segment
        if len(sentences) <= 1:
            # 移除 words 字段避免传递到前端
            seg_copy = {k: v for k, v in seg.items() if k != 'words'}
            fine_segments.append(seg_copy)
            continue
        
        # 如果有 word-level timestamps，使用精确时间
        if words:
            current_word_idx = 0
            for sentence in sentences:
                # 找到这个句子对应的 words
                sentence_words = []
                remaining_text = sentence
                
                while current_word_idx < len(words) and remaining_text:
                    word = words[current_word_idx]
                    word_text = word.get("text", "")
                    
                    if word_text and remaining_text.startswith(word_text):
                        sentence_words.append(word)
                        remaining_text = remaining_text[len(word_text):]
                        current_word_idx += 1
                    elif word_text and word_text in remaining_text[:len(word_text)+2]:
                        # 容错：标点可能导致轻微不匹配
                        sentence_words.append(word)
                        idx = remaining_text.find(word_text)
                        if idx >= 0:
                            remaining_text = remaining_text[idx + len(word_text):]
                        current_word_idx += 1
                    else:
                        break
                
                if sentence_words:
                    seg_start = sentence_words[0].get("start_time", start_ms)
                    seg_end = sentence_words[-1].get("end_time", end_ms)
                    
                    fine_segments.append({
                        **{k: v for k, v in seg.items() if k != 'words'},
                        "id": str(uuid4()),
                        "text": sentence,
                        "start": seg_start,
                        "end": seg_end,
                    })
                else:
                    # 没找到对应的 words，跳过
                    pass
        else:
            # 没有 word timestamps，按字符数比例分配时间
            total_chars = sum(len(s) for s in sentences)
            if total_chars == 0:
                seg_copy = {k: v for k, v in seg.items() if k != 'words'}
                fine_segments.append(seg_copy)
                continue
            
            current_time = start_ms
            for idx, sentence in enumerate(sentences):
                char_ratio = len(sentence) / total_chars
                duration = int(total_duration * char_ratio)
                
                # 确保至少有 100ms
                duration = max(duration, 100)
                
                # 最后一个 segment 确保结束时间不超过原始边界
                segment_end = current_time + duration
                if idx == len(sentences) - 1:
                    segment_end = min(segment_end, end_ms)
                
                fine_segments.append({
                    **{k: v for k, v in seg.items() if k != 'words'},
                    "id": str(uuid4()),
                    "text": sentence,
                    "start": current_time,
                    "end": segment_end,
                })
                
                current_time = segment_end
    
    return fine_segments


async def execute_asr_clip(
    task_id: str,
    clip_id: str,
    asset_id: str,
    clip_start_time: int,
    clip_end_time: int,
    source_start: int,
    project_id: str,
    storage_path: str,
    language: str,
    model: str
):
    """
    执行基于 Clip 的 ASR 任务
    - 只转写 clip 对应的时间范围（先截取音频再 ASR）
    - 生成的字幕时间戳对应到 clip 在时间轴上的位置
    - 会覆盖之前生成的字幕
    """
    import tempfile
    import subprocess
    import os
    
    try:
        clip_duration = clip_end_time - clip_start_time
        source_end = source_start + clip_duration
        
        logger.info(f"[ASR-Clip] ========== 开始 ==========")
        logger.info(f"[ASR-Clip] clip_id={clip_id}")
        logger.info(f"[ASR-Clip] source_start={source_start}ms, source_end={source_end}ms, duration={clip_duration}ms")
        logger.info(f"[ASR-Clip] timeline: {clip_start_time}-{clip_end_time}ms")
        
        supabase.table("tasks").update({
            "status": "running",
            "progress": 5,
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        # 生成原始视频的签名 URL
        video_url = get_file_url("clips", storage_path)
        logger.info(f"[ASR-Clip] 原始视频 URL: {video_url[:100]}...")
        
        # ========== 使用 FFmpeg 截取 clip 对应的音频片段 ==========
        supabase.table("tasks").update({
            "progress": 10,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        # 创建临时文件存储截取的音频
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_audio:
            tmp_audio_path = tmp_audio.name
        
        try:
            # 使用 FFmpeg 截取指定时间范围的音频
            # -ss: 开始时间（秒），-t: 持续时间（秒）
            start_sec = source_start / 1000.0
            duration_sec = clip_duration / 1000.0
            
            ffmpeg_cmd = [
                "ffmpeg", "-y",
                "-ss", str(start_sec),
                "-i", video_url,
                "-t", str(duration_sec),
                "-vn",  # 不要视频
                "-acodec", "libmp3lame",
                "-ar", "16000",  # 采样率
                "-ac", "1",  # 单声道
                "-b:a", "64k",
                tmp_audio_path
            ]
            
            logger.info(f"[ASR-Clip] FFmpeg 命令: ffmpeg -ss {start_sec} -i [video] -t {duration_sec} -vn ...")
            
            process = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if process.returncode != 0:
                logger.error(f"[ASR-Clip] FFmpeg 失败: {process.stderr}")
                raise Exception(f"音频截取失败: {process.stderr[:200]}")
            
            # 检查输出文件
            if not os.path.exists(tmp_audio_path) or os.path.getsize(tmp_audio_path) < 1000:
                raise Exception("截取的音频文件无效")
            
            audio_size = os.path.getsize(tmp_audio_path)
            logger.info(f"[ASR-Clip] 音频截取成功: {audio_size} bytes, {duration_sec:.2f}s")
            
            # ========== 上传截取的音频到临时存储 ==========
            supabase.table("tasks").update({
                "progress": 20,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            
            # 上传到 Supabase Storage 临时目录
            temp_audio_path = f"temp/{task_id}.mp3"
            with open(tmp_audio_path, "rb") as f:
                supabase.storage.from_("clips").upload(
                    temp_audio_path,
                    f.read(),
                    {"content-type": "audio/mpeg"}
                )
            
            # 获取临时音频的签名 URL
            clip_audio_url = get_file_url("clips", temp_audio_path)
            logger.info(f"[ASR-Clip] 临时音频已上传: {temp_audio_path}")
            
            # ========== 调用 ASR 转写截取后的音频 ==========
            supabase.table("tasks").update({
                "progress": 30,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            
            from ..tasks.transcribe import transcribe_audio
            result = await transcribe_audio(
                audio_url=clip_audio_url,
                language=language,
                model=model,
                word_timestamps=True,
                on_progress=lambda p, s: update_task_progress(task_id, 30 + int(p * 0.5), s)
            )
            
            all_segments = result.get("segments", [])
            logger.info(f"[ASR-Clip] ASR 返回 {len(all_segments)} 个 segments")
            
            # ========== 映射时间戳到时间轴位置 ==========
            # 因为 ASR 是针对截取后的音频（从 0 开始），需要映射到 clip 在时间轴的位置
            mapped_segments = []
            for seg in all_segments:
                # 截取后音频的时间 -> 时间轴位置
                # ASR 返回的 start/end 是相对于截取音频的（从 0 开始）
                seg_start = seg.get("start", 0)
                seg_end = seg.get("end", 0)
                
                # 映射到时间轴: 加上 clip 的起始位置
                timeline_start = seg_start + clip_start_time
                timeline_end = seg_end + clip_start_time
                
                # 同样映射 words 的时间戳
                words = seg.get("words", [])
                mapped_words = []
                for w in words:
                    mapped_words.append({
                        **w,
                        "start_time": w.get("start_time", 0) + clip_start_time,
                        "end_time": w.get("end_time", 0) + clip_start_time,
                    })
                
                mapped_segments.append({
                    **seg,
                    "start": timeline_start,
                    "end": timeline_end,
                    "words": mapped_words,
                })
                
                logger.info(f"[ASR-Clip] segment: '{seg.get('text', '')[:30]}' {seg_start}-{seg_end}ms -> {timeline_start}-{timeline_end}ms")
            
            # ========== 清理临时文件 ==========
            try:
                supabase.storage.from_("clips").remove([temp_audio_path])
                logger.info(f"[ASR-Clip] 已删除临时音频: {temp_audio_path}")
            except Exception as e:
                logger.warning(f"[ASR-Clip] 删除临时音频失败: {e}")
            
            # 保存 ASR 结果供后续使用
            asr_result = result
            
        finally:
            # 清理本地临时文件
            if os.path.exists(tmp_audio_path):
                os.unlink(tmp_audio_path)
        
        # ========== 标点切分 ==========
        supabase.table("tasks").update({
            "progress": 85,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        fine_segments = _split_segments_by_punctuation(mapped_segments)
        logger.info(f"[ASR-Clip] 标点切分后 segments={len(fine_segments)}")
        logger.info(f"[ASR-Clip] ========== 结束 ==========")
        
        # 先查询并删除旧字幕，获取原有的 track_id
        created_clips = []
        if project_id:
            try:
                # 查询该 video clip 关联的所有字幕，获取 track_id
                existing_subtitles = supabase.table("clips").select("id, track_id").eq("parent_clip_id", clip_id).execute()
                existing_data = existing_subtitles.data or []
                
                # 获取原有字幕的 track_id（用于在同一轨道上创建新字幕）
                track_id = None
                if existing_data:
                    track_id = existing_data[0].get("track_id")
                    # 删除旧字幕
                    supabase.table("clips").delete().eq("parent_clip_id", clip_id).execute()
                    logger.info(f"[ASR-Clip] 已删除 {len(existing_data)} 个旧字幕，复用 track_id={track_id}")
                
                if fine_segments:
                    # 如果没有旧字幕（首次转写），查找可用的空闲轨道或创建新轨道
                    if not track_id:
                        track_id = await _find_available_subtitle_track(project_id, fine_segments)
                        logger.info(f"[ASR-Clip] 使用轨道 track_id={track_id}")
                    
                    now = datetime.utcnow().isoformat()
                    
                    clips_data = [{
                        "id": str(uuid4()),
                        "track_id": track_id,
                        "asset_id": asset_id,
                        "clip_type": "subtitle",
                        "start_time": seg["start"],
                        "end_time": seg["end"],
                        "source_start": 0,
                        "volume": 1.0,
                        "is_muted": False,
                        "speed": 1.0,
                        "content_text": seg.get("text", ""),
                        "parent_clip_id": clip_id,
                        "text_style": {"speaker": seg["speaker"]} if seg.get("speaker") else None,
                        "created_at": now,
                        "updated_at": now,
                    } for seg in fine_segments]
                    
                    insert_result = supabase.table("clips").insert(clips_data).execute()
                    created_clips = insert_result.data or []
                    logger.info(f"[ASR-Clip] 创建了 {len(created_clips)} 个字幕")
                    
            except Exception as e:
                logger.error(f"[ASR-Clip] 字幕操作失败: {e}")
        
        # 更新任务结果
        task_result = {
            "clips_count": len(created_clips),
            "duration": clip_duration / 1000.0,
            "word_count": sum(len(seg.get("text", "")) for seg in fine_segments),
        }
        
        supabase.table("tasks").update({
            "status": "completed",
            "progress": 100,
            "result": task_result,
            "completed_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        supabase.table("tasks").update({
            "status": "failed",
            "error_message": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


async def _create_subtitle_track(project_id: str) -> str:
    """创建字幕轨道"""
    # 获取当前最小的 order_index（字幕轨道通常在底部）
    try:
        tracks = supabase.table("tracks").select("order_index").eq(
            "project_id", project_id
        ).order("order_index").execute()
        
        min_order = 0
        if tracks and tracks.data:
            min_order = min(t["order_index"] for t in tracks.data) - 1
    except Exception as e:
        logger.warning(f"[ASR] 获取轨道顺序失败: {e}")
        min_order = -1
    
    # 创建新轨道
    track_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    
    supabase.table("tracks").insert({
        "id": track_id,
        "project_id": project_id,
        "name": "转写文本",
        "order_index": min_order,
        "is_visible": True,
        "is_locked": False,
        "is_muted": False,
        "created_at": now,
        "updated_at": now,
    }).execute()
    
    return track_id


async def _find_available_subtitle_track(project_id: str, segments: list) -> str:
    """
    查找可用于放置字幕的轨道
    
    逻辑：
    1. 获取项目中所有包含 subtitle 类型 clip 的轨道
    2. 检查每个轨道在目标时间范围内是否有空间
    3. 优先选择离主轨道最近（order_index 最小）的可用轨道
    4. 如果都没有空间，创建新轨道
    """
    if not segments:
        return await _create_subtitle_track(project_id)
    
    # 获取需要放置的时间范围
    target_start = min(seg["start"] for seg in segments)
    target_end = max(seg["end"] for seg in segments)
    
    try:
        # 获取项目中所有轨道
        all_tracks = supabase.table("tracks").select("id, order_index, name").eq(
            "project_id", project_id
        ).order("order_index", desc=True).execute()  # order_index 从大到小（字幕轨道通常在底部，order_index 较小）
        
        if not all_tracks.data:
            return await _create_subtitle_track(project_id)
        
        # 获取所有字幕类型的 clips
        subtitle_clips = supabase.table("clips").select(
            "id, track_id, start_time, end_time"
        ).eq("clip_type", "subtitle").in_(
            "track_id", [t["id"] for t in all_tracks.data]
        ).execute()
        
        # 按 track_id 分组现有字幕
        clips_by_track = {}
        for clip in (subtitle_clips.data or []):
            track_id = clip["track_id"]
            if track_id not in clips_by_track:
                clips_by_track[track_id] = []
            clips_by_track[track_id].append(clip)
        
        # 找出已经有字幕的轨道（按 order_index 从大到小排序，即从底部向上）
        subtitle_track_ids = set(clips_by_track.keys())
        candidate_tracks = [t for t in all_tracks.data if t["id"] in subtitle_track_ids]
        
        # 检查每个候选轨道是否有足够空间
        for track in candidate_tracks:
            track_id = track["id"]
            existing_clips = clips_by_track.get(track_id, [])
            
            # 检查是否有时间冲突
            has_conflict = False
            for clip in existing_clips:
                clip_start = clip["start_time"]
                clip_end = clip["end_time"]
                # 检查时间范围是否重叠
                if not (target_end <= clip_start or target_start >= clip_end):
                    has_conflict = True
                    break
            
            if not has_conflict:
                logger.info(f"[ASR-Clip] 找到可用字幕轨道 track_id={track_id}")
                return track_id
        
        # 没有可用轨道，创建新的
        logger.info(f"[ASR-Clip] 所有字幕轨道都有冲突，创建新轨道")
        return await _create_subtitle_track(project_id)
        
    except Exception as e:
        logger.warning(f"[ASR-Clip] 查找可用轨道失败: {e}，创建新轨道")
        return await _create_subtitle_track(project_id)


async def execute_extract_audio(
    task_id: str, 
    asset_id: str, 
    audio_format: str = "wav",
    source_start_ms: float = None,  # 殥秒
    duration_ms: float = None  # 殥秒
):
    """从视频中提取音频轨道（支持截取片段）"""
    import subprocess
    import tempfile
    import os
    
    try:
        # 从任务记录获取 user_id
        task_result = supabase.table("tasks").select("user_id").eq("id", task_id).single().execute()
        task_user_id = task_result.data.get("user_id") if task_result.data else None
        
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        # 获取视频资源
        asset = supabase.table("assets").select("*").eq("id", asset_id).single().execute()
        
        if not asset.data:
            raise Exception("资源不存在")
        
        # 获取视频 URL
        storage_path = asset.data.get("storage_path")
        if not storage_path:
            raise Exception("资源没有存储路径")
        
        video_url = get_file_url("clips", storage_path)
        
        supabase.table("tasks").update({
            "progress": 20,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        # 创建临时目录
        with tempfile.TemporaryDirectory() as temp_dir:
            # 下载视频文件
            import httpx
            video_path = os.path.join(temp_dir, "input_video")
            
            async with httpx.AsyncClient() as client:
                response = await client.get(video_url)
                response.raise_for_status()
                with open(video_path, "wb") as f:
                    f.write(response.content)
            
            supabase.table("tasks").update({
                "progress": 40,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            
            # 使用 FFmpeg 提取音频
            audio_ext = audio_format if audio_format in ["wav", "mp3", "aac"] else "wav"
            audio_path = os.path.join(temp_dir, f"extracted_audio.{audio_ext}")
            
            # FFmpeg 命令：提取音频（支持时间片段截取）
            # 注意：使用 output seeking（-ss/-t 放在 -i 后面）确保精确性
            ffmpeg_cmd = ["ffmpeg", "-y", "-i", video_path]
            
            # 如果有起始时间，添加 -ss 参数（放在 -i 后面确保精确切割）
            if source_start_ms is not None and source_start_ms > 0:
                start_seconds = source_start_ms / 1000.0
                ffmpeg_cmd.extend(["-ss", str(start_seconds)])
            
            # 如果有时长，添加 -t 参数
            if duration_ms is not None and duration_ms > 0:
                duration_seconds = duration_ms / 1000.0
                ffmpeg_cmd.extend(["-t", str(duration_seconds)])
            
            ffmpeg_cmd.extend([
                "-vn",  # 不要视频
                "-acodec", "pcm_s16le" if audio_ext == "wav" else "libmp3lame" if audio_ext == "mp3" else "aac",
                "-ar", "44100",  # 采样率
                "-ac", "2",  # 立体声
                audio_path
            ])
            
            logger.debug(f"[ExtractAudio] FFmpeg cmd: {' '.join(ffmpeg_cmd)}")
            
            result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                raise Exception(f"FFmpeg 提取音频失败: {result.stderr}")
            
            supabase.table("tasks").update({
                "progress": 70,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            
            # 上传音频到存储
            audio_asset_id = str(uuid4())
            audio_storage_path = f"audio/{audio_asset_id}/extracted.{audio_ext}"
            
            # 读取音频文件
            with open(audio_path, "rb") as f:
                audio_data = f.read()
            
            # 上传到 Supabase Storage
            supabase.storage.from_("clips").upload(
                audio_storage_path,
                audio_data,
                {"content-type": f"audio/{audio_ext}" if audio_ext != "wav" else "audio/wav"}
            )
            
            # 获取音频时长（使用 ffprobe）
            duration = asset.data.get("duration", 0)
            try:
                probe_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", 
                           "-of", "default=noprint_wrappers=1:nokey=1", audio_path]
                probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
                if probe_result.returncode == 0:
                    duration = float(probe_result.stdout.strip()) * 1000  # 转为毫秒
            except:
                pass
            
            supabase.table("tasks").update({
                "progress": 90,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            
            # 创建音频资源记录
            now = datetime.utcnow().isoformat()
            original_filename = asset.data.get("original_filename", "video")
            audio_filename = os.path.splitext(original_filename)[0] + f"_audio.{audio_ext}"
            
            supabase.table("assets").insert({
                "id": audio_asset_id,
                "user_id": task_user_id,
                "project_id": asset.data.get("project_id"),
                "name": audio_filename,  # schema 要求的 name 字段
                "file_type": "audio",
                "storage_path": audio_storage_path,
                "original_filename": audio_filename,
                "file_size": len(audio_data),
                "duration": duration,
                "sample_rate": 44100,
                "channels": 2,
                "status": "ready",
                "created_at": now,
                "updated_at": now
            }).execute()
            
            # 获取音频文件的公开 URL
            audio_url = get_file_url("clips", audio_storage_path)
            
            # 任务完成
            supabase.table("tasks").update({
                "status": "completed",
                "progress": 100,
                "result": {
                    "audio": {
                        "asset_id": audio_asset_id,
                        "url": audio_url,
                        "duration": duration,
                        "format": audio_ext,
                        "filename": audio_filename
                    }
                },
                "completed_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            
            logger.info(f"[ExtractAudio] 音频提取完成: {audio_asset_id}")
            
    except Exception as e:
        logger.error(f"[ExtractAudio] 音频提取失败: {e}")
        supabase.table("tasks").update({
            "status": "failed",
            "error_message": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


async def execute_stem_separation(task_id: str, asset_id: str, stems: List[str]):
    """执行人声分离任务"""
    try:
        # 从任务记录获取 user_id
        task_result = supabase.table("tasks").select("user_id").eq("id", task_id).single().execute()
        task_user_id = task_result.data.get("user_id") if task_result.data else None
        
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        # 获取资源（使用新字段名）
        asset = supabase.table("assets").select("*").eq("id", asset_id).single().execute()
        
        if not asset.data:
            raise Exception("资源不存在")
        
        # TODO: 实际的人声分离逻辑
        # 模拟结果
        now = datetime.utcnow().isoformat()
        result_stems = []
        
        # 生成源文件 URL
        source_url = get_file_url("clips", asset.data["storage_path"]) if asset.data.get("storage_path") else None
        
        for stem_type in stems:
            stem_asset_id = str(uuid4())
            
            # 创建衍生资源（使用新字段名）
            # 实际应该上传分离后的文件并获取 storage_path
            stem_storage_path = f"stems/{stem_asset_id}/{stem_type}.wav"
            
            supabase.table("assets").insert({
                "id": stem_asset_id,
                "user_id": task_user_id,
                "project_id": asset.data.get("project_id"),
                "file_type": "audio",  # 新字段名
                "storage_path": stem_storage_path,
                "original_filename": f"{stem_type}.wav",
                "file_size": 0,  # 实际应该是真实大小
                "duration": asset.data.get("duration", 0),
                "sample_rate": asset.data.get("sample_rate"),
                "channels": asset.data.get("channels"),
                "parent_id": asset_id,
                "status": "ready",
                "created_at": now,
                "updated_at": now
            }).execute()
            
            result_stems.append({
                "type": stem_type,
                "asset_id": stem_asset_id,
                "url": get_file_url("clips", stem_storage_path),
                "duration": asset.data.get("duration", 0)
            })
        
        supabase.table("tasks").update({
            "status": "completed",
            "progress": 100,
            "result": {"stems": result_stems},
            "completed_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
    except Exception as e:
        supabase.table("tasks").update({
            "status": "failed",
            "error_message": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


async def execute_smart_clean(task_id: str, project_id: str):
    """执行智能清洗任务"""
    try:
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        # 获取项目的转写结果（从最近的 ASR 任务获取）
        # 新表中 projects 没有 segments 字段
        asr_task = supabase.table("tasks").select("result").eq(
            "project_id", project_id
        ).eq("task_type", "asr").eq("status", "completed").order(
            "completed_at", desc=True
        ).limit(1).execute()
        
        segments = []
        if asr_task.data and asr_task.data[0].get("result"):
            segments = asr_task.data[0]["result"].get("segments", [])
        
        if not segments:
            raise Exception("未找到转写结果，请先执行 ASR 任务")
        
        # 分析
        from ..tasks.smart_clean import analyze_transcript
        result = await analyze_transcript(segments)
        
        supabase.table("tasks").update({
            "status": "completed",
            "progress": 100,
            "result": result,
            "completed_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
    except Exception as e:
        supabase.table("tasks").update({
            "status": "failed",
            "error_message": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
