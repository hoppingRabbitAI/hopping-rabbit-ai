"""
关键帧提取模块
为每个分镜提取代表性的缩略图

时间单位：毫秒 (ms)
"""

import os
import logging
import asyncio
import subprocess
from typing import Optional, Callable, List, Tuple

from .types import SegmentationClip

logger = logging.getLogger(__name__)

# Supabase Storage 配置
STORAGE_BUCKET = "ai-creations"


async def _get_project_aspect_ratio(session_id: str) -> Optional[str]:
    """
    通过 session_id 获取项目的目标比例
    
    Returns:
        "9:16" 或 "16:9"，失败返回 None
    """
    try:
        from app.services.supabase_client import get_supabase
        supabase = get_supabase()
        
        # session_id -> project_id -> resolution (注意表名是 workspace_sessions)
        session_result = supabase.table("workspace_sessions").select("project_id").eq("id", session_id).single().execute()
        if not session_result.data or not session_result.data.get("project_id"):
            logger.warning(f"[Thumbnail] ⚠️ session {session_id[:8]} 未找到 project_id")
            return None
        
        project_id = session_result.data["project_id"]
        project_result = supabase.table("projects").select("resolution").eq("id", project_id).single().execute()
        if not project_result.data or not project_result.data.get("resolution"):
            logger.warning(f"[Thumbnail] ⚠️ project {project_id[:8]} 未找到 resolution")
            return None
        
        resolution = project_result.data["resolution"]
        if resolution.get("width") and resolution.get("height"):
            if resolution["width"] > resolution["height"]:
                return "16:9"
            else:
                return "9:16"
        return None
    except Exception as e:
        logger.warning(f"[Thumbnail] 获取项目比例失败: {e}")
        return None


def _calculate_crop_params(
    src_width: int, 
    src_height: int, 
    target_aspect: str
) -> Optional[Tuple[int, int, int, int]]:
    """
    计算裁剪参数 (x, y, width, height)
    """
    src_ratio = src_width / src_height
    target_ratio = 16/9 if target_aspect == "16:9" else 9/16
    
    # 比例差异小于 5% 不需要裁剪
    if abs(src_ratio - target_ratio) / target_ratio <= 0.05:
        return None
    
    if src_ratio > target_ratio:
        # 源视频更宽，裁剪左右
        new_width = int(src_height * target_ratio)
        new_height = src_height
        x = (src_width - new_width) // 2
        y = 0
    else:
        # 源视频更高，裁剪上下
        new_width = src_width
        new_height = int(src_width / target_ratio)
        x = 0
        y = (src_height - new_height) // 2
    
    return (x, y, new_width, new_height)


async def _ensure_bucket_exists():
    """确保 Storage bucket 存在且是公开的"""
    try:
        from app.services.supabase_client import get_supabase
        supabase = get_supabase()
        
        # 检查 bucket 是否存在
        buckets = supabase.storage.list_buckets()
        bucket_names = [b.name for b in buckets]
        
        if STORAGE_BUCKET not in bucket_names:
            # 创建公开 bucket
            logger.info(f"[Thumbnail] 创建 bucket: {STORAGE_BUCKET}")
            supabase.storage.create_bucket(STORAGE_BUCKET, options={"public": True})
        return True
    except Exception as e:
        logger.warning(f"[Thumbnail] 检查/创建 bucket 失败: {e}")
        return False


async def _upload_to_supabase(local_path: str, storage_path: str) -> Optional[str]:
    """
    上传文件到 Supabase Storage
    
    Args:
        local_path: 本地文件路径
        storage_path: 存储路径
    
    Returns:
        公开 URL，失败返回 None
    """
    try:
        from app.services.supabase_client import get_supabase
        
        supabase = get_supabase()
        
        with open(local_path, "rb") as f:
            file_data = f.read()
        
        # 先尝试删除已存在的文件（避免重复上传错误）
        try:
            supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except:
            pass
        
        # 上传到 Supabase
        result = supabase.storage.from_(STORAGE_BUCKET).upload(
            storage_path,
            file_data,
            {"content-type": "image/jpeg"}
        )
        
        # 获取公开 URL
        public_url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
        logger.info(f"[Thumbnail] ✅ 上传成功: {storage_path} -> {public_url[:60]}...")
        return public_url
        
    except Exception as e:
        logger.error(f"[Thumbnail] ❌ 上传到 Supabase 失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


async def extract_thumbnails(
    video_path: str,
    clips: List[SegmentationClip],
    output_dir: Optional[str] = None,
    on_progress: Optional[Callable[[int, str], None]] = None,
    session_id: Optional[str] = None,
    upload_to_cloud: bool = True,
) -> List[SegmentationClip]:
    """
    为每个分镜提取关键帧缩略图
    
    Args:
        video_path: 视频文件路径
        clips: 分镜 Clip 列表
        output_dir: 输出目录 (默认在视频同目录下创建 thumbnails 文件夹)
        on_progress: 进度回调
        session_id: 会话 ID (用于云端存储路径)
        upload_to_cloud: 是否上传到云端存储
    
    Returns:
        带有 thumbnail_url 的分镜列表
    """
    
    if not clips:
        return clips
    
    # ★ 确保 bucket 存在
    if upload_to_cloud:
        await _ensure_bucket_exists()
    
    # ★★★ 获取项目目标比例 ★★★
    target_aspect: Optional[str] = None
    if session_id:
        target_aspect = await _get_project_aspect_ratio(session_id)
        if target_aspect:
            logger.info(f"[Thumbnail] 📐 项目目标比例: {target_aspect}")
    
    # 创建输出目录
    if output_dir is None:
        video_dir = os.path.dirname(video_path)
        video_name = os.path.splitext(os.path.basename(video_path))[0]
        output_dir = os.path.join(video_dir, f"{video_name}_thumbnails")
    
    os.makedirs(output_dir, exist_ok=True)
    
    # 批量提取关键帧
    total = len(clips)
    for i, clip in enumerate(clips):
        if on_progress and i % max(1, total // 10) == 0:
            progress = int((i / total) * 100)
            on_progress(progress, f"提取关键帧 {i + 1}/{total}")
        
        # 选取源素材片段中间时间点（毫秒 -> 秒）
        mid_time_sec = (clip.source_start + clip.source_end) / 2 / 1000
        
        # 输出路径
        local_filename = f"clip_{i:03d}_{clip.id[:8]}.jpg"
        output_path = os.path.join(output_dir, local_filename)
        
        try:
            # 使用 ffmpeg 提取帧（传入目标比例用于裁剪）
            await _extract_frame(video_path, mid_time_sec, output_path, target_aspect=target_aspect)
            
            # 上传到云端存储
            if upload_to_cloud and session_id:
                storage_path = f"shot_thumbnails/{session_id}/{local_filename}"
                cloud_url = await _upload_to_supabase(output_path, storage_path)
                if cloud_url:
                    clip.thumbnail_url = cloud_url
                    # 删除本地文件节省空间
                    try:
                        os.remove(output_path)
                    except:
                        pass
                else:
                    # 上传失败，使用本地路径
                    clip.thumbnail_url = output_path
            else:
                clip.thumbnail_url = output_path
                
        except Exception as e:
            logger.warning(f"提取关键帧失败 (clip {clip.id}): {e}")
    
    if on_progress:
        on_progress(100, "关键帧提取完成")
    
    return clips


async def _extract_frame(
    video_path: str,
    timestamp_sec: float,
    output_path: str,
    max_width: int = 320,
    max_height: int = 568,
    target_aspect: Optional[str] = None,
) -> None:
    """
    使用 ffmpeg 提取单帧，根据项目比例裁剪
    
    Args:
        video_path: 视频路径
        timestamp_sec: 时间点 (秒)
        output_path: 输出图片路径
        max_width: 最大宽度（横屏视频按此限制）
        max_height: 最大高度（竖屏视频按此限制）
        target_aspect: 目标比例 ("9:16" 或 "16:9")
    """
    
    # ★★★ 构建滤镜链：裁剪 → 缩放 ★★★
    filter_parts = []
    
    # 1. 获取视频尺寸用于计算裁剪
    if target_aspect:
        try:
            probe_cmd = [
                "ffprobe", "-v", "quiet",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0",
                video_path
            ]
            result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0 and result.stdout.strip():
                parts = result.stdout.strip().split(',')
                if len(parts) == 2:
                    src_width, src_height = int(parts[0]), int(parts[1])
                    crop_params = _calculate_crop_params(src_width, src_height, target_aspect)
                    if crop_params:
                        x, y, w, h = crop_params
                        filter_parts.append(f"crop={w}:{h}:{x}:{y}")
                        logger.info(f"[Thumbnail] ✂️ 应用裁剪: crop={w}:{h}:{x}:{y}")
        except Exception as e:
            logger.warning(f"[Thumbnail] 获取视频尺寸失败: {e}")
    
    # 2. 缩放滤镜（保持比例，限制最大尺寸）
    if target_aspect == "9:16":
        # 竖屏：限制高度
        scale_filter = f"scale=-2:'min({max_height},ih)'"
    else:
        # 横屏或未知：限制宽度
        scale_filter = f"scale='min({max_width},iw)':-2"
    filter_parts.append(scale_filter)
    
    video_filter = ",".join(filter_parts)
    
    cmd = [
        "ffmpeg",
        "-ss", str(timestamp_sec),
        "-i", video_path,
        "-vframes", "1",
        "-vf", video_filter,
        "-q:v", "2",  # JPEG 质量
        "-y",  # 覆盖已存在的文件
        output_path,
    ]
    
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_ffmpeg, cmd)


def _run_ffmpeg(cmd: List[str]) -> None:
    """
    同步执行 ffmpeg 命令
    """
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            logger.warning(f"ffmpeg 错误: {result.stderr[:200]}")
    except subprocess.TimeoutExpired:
        logger.warning("ffmpeg 执行超时")
    except Exception as e:
        logger.error(f"ffmpeg 执行失败: {e}")


async def generate_shot_strip(
    video_path: str,
    clips: List[SegmentationClip],
    output_path: str,
    frame_width: int = 120,
    frame_height: int = 68,
) -> str:
    """
    生成分镜条带图（所有分镜关键帧横向拼接）
    用于时间轴概览
    
    Args:
        video_path: 视频路径
        clips: 分镜列表
        output_path: 输出图片路径
        frame_width: 每帧宽度
        frame_height: 每帧高度
    
    Returns:
        条带图路径
    """
    
    if not clips:
        return ""
    
    # 计算总宽度
    total_width = frame_width * len(clips)
    
    # 构建 ffmpeg filter
    inputs = []
    filter_parts = []
    
    for i, clip in enumerate(clips):
        # 使用 source_start/source_end 计算中点（毫秒转秒）
        mid_time_sec = (clip.source_start + clip.source_end) / 2 / 1000.0
        inputs.extend(["-ss", str(mid_time_sec), "-i", video_path])
        filter_parts.append(f"[{i}:v]scale={frame_width}:{frame_height}:force_original_aspect_ratio=decrease,pad={frame_width}:{frame_height}:(ow-iw)/2:(oh-ih)/2[v{i}]")
    
    # 横向拼接
    concat_inputs = "".join(f"[v{i}]" for i in range(len(clips)))
    filter_parts.append(f"{concat_inputs}hstack=inputs={len(clips)}[out]")
    
    filter_complex = ";".join(filter_parts)
    
    cmd = ["ffmpeg"] + inputs + [
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-vframes", "1",
        "-y",
        output_path,
    ]
    
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_ffmpeg, cmd)
    
    return output_path
