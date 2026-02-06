"""
HoppingRabbit AI - B-roll 下载任务
使用 Celery 后台任务下载 B-roll 视频到 Supabase Storage
★ 优化：下载后异步上传到 Cloudflare Stream 获取 HLS
"""
import os
import logging
import httpx
import uuid
import asyncio
from datetime import datetime
from typing import Dict, Optional
from pathlib import Path

from app.celery_config import celery_app
from app.services.supabase_client import supabase
from app.services.cloudflare_stream import upload_from_url, wait_for_ready, get_hls_url, is_configured as is_cf_configured

logger = logging.getLogger(__name__)

# Redis 客户端用于存储下载进度
try:
    import redis
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
except Exception as e:
    logger.warning(f"[BRoll] Redis 未配置，下载进度功能将不可用: {e}")
    redis_client = None


def set_download_progress(task_id: str, progress: dict):
    """设置下载进度到 Redis"""
    import time
    progress['timestamp'] = time.time()
    progress['updated_at'] = datetime.utcnow().isoformat()
    logger.info(f"[BRoll] 📝 设置进度: task_id={task_id}, status={progress.get('status')}, progress={progress.get('progress')}%")
    if redis_client:
        try:
            redis_client.setex(
                f"broll:download:{task_id}",
                3600,  # 1小时过期
                str(progress)
            )
        except Exception as e:
            logger.error(f"[BRoll] 设置下载进度失败: {e}")
    else:
        logger.warning(f"[BRoll] ⚠️ Redis 未连接，无法保存进度")


def get_download_progress(task_id: str) -> Optional[dict]:
    """从 Redis 获取下载进度"""
    if redis_client:
        try:
            data = redis_client.get(f"broll:download:{task_id}")
            if data:
                import ast
                result = ast.literal_eval(data)
                logger.debug(f"[BRoll] 📖 读取进度: task_id={task_id}, status={result.get('status')}, progress={result.get('progress')}%")
                return result
            else:
                logger.warning(f"[BRoll] ⚠️ 进度不存在: task_id={task_id}")
        except Exception as e:
            logger.error(f"[BRoll] 获取下载进度失败: {e}")
    else:
        logger.warning(f"[BRoll] ⚠️ Redis 未连接")
    return None


@celery_app.task(name="app.tasks.broll_download.download_broll_video", bind=True)
def download_broll_video(
    self,
    task_id: str,
    user_id: str,
    project_id: str,
    video_data: dict,
    track_id: str = None,
    broll_time_info: dict = None,
):
    """
    下载 B-roll 视频到 Supabase Storage，并创建 video clip
    
    Args:
        task_id: 任务 ID
        user_id: 用户 ID
        project_id: 项目 ID
        video_data: 视频数据 {"id", "url", "width", "height", "duration", "thumbnail", ...}
        track_id: 目标轨道 ID（由 workspace.py 提前创建）
        broll_time_info: B-Roll 时间信息
            {"start_ms", "end_ms", "search_keywords", "display_mode"}
    """
    asset_id = None
    clip_id = None
    
    import time
    task_start_time = time.time()
    try:
        logger.info(f"[BRoll] 🚀 开始下载视频: task_id={task_id}, source={video_data.get('source')}, video_id={video_data.get('id')}")
        logger.info(f"[BRoll] 📋 视频信息: url={video_data.get('url')[:100]}..., duration={video_data.get('duration')}s")
        if broll_time_info:
            logger.info(f"[BRoll] 📍 时间信息: start={broll_time_info.get('start_ms')}ms, end={broll_time_info.get('end_ms')}ms")
        
        # 1. 创建 asset 记录（状态为 processing）
        asset_id = str(uuid.uuid4())
        video_url = video_data.get("url", "")
        source = video_data.get("source", "pexels")
        external_id = str(video_data.get("id", ""))
        
        # 确定文件扩展名
        file_ext = ".mp4"
        if "." in video_url:
            file_ext = "." + video_url.split(".")[-1].split("?")[0]
        
        # 存储路径
        storage_path = f"{user_id}/broll/{asset_id}{file_ext}"
        
        # broll_metadata
        broll_metadata = {
            "source": source,
            "external_id": external_id,
            "author": video_data.get("author", ""),
            "author_url": video_data.get("author_url", ""),
            "original_url": video_data.get("original_url", ""),
            "license": video_data.get("license", f"{source.capitalize()} License"),
            "keywords": broll_time_info.get("search_keywords", []) if broll_time_info else [],
            "quality": video_data.get("quality", "hd"),
            "orientation": video_data.get("orientation", "landscape"),
        }
        
        asset_name = f"B-roll: {video_data.get('author', source)} #{external_id}"
        asset_data = {
            "id": asset_id,
            "project_id": project_id,
            "user_id": user_id,
            "name": asset_name,
            "original_filename": f"broll-{source}-{external_id}{file_ext}",
            "file_type": "video",
            "mime_type": "video/mp4",
            "storage_path": storage_path,
            "status": "processing",
            "duration": float(video_data.get("duration", 0)),
            "width": video_data.get("width"),
            "height": video_data.get("height"),
            "broll_metadata": broll_metadata,
            # ★★★ 关键：Pexels 视频是 H.264，不需要转码 ★★★
            "needs_transcode": False,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        
        supabase.table("assets").insert(asset_data).execute()
        logger.info(f"[BRoll] ✅ Asset 记录已创建: {asset_id}")
        
        # 2. 下载视频文件
        set_download_progress(task_id, {
            "status": "downloading",
            "progress": 0,
            "asset_id": asset_id,
        })
        
        total_bytes = 0
        downloaded_bytes = 0
        temp_file = Path(f"/tmp/{asset_id}{file_ext}")
        
        download_start = time.time()
        logger.info(f"[BRoll] ⬇️ 开始 HTTP 下载: {video_url[:100]}...")
        
        with httpx.Client(timeout=300) as client:
            with client.stream("GET", video_url) as response:
                response.raise_for_status()
                
                total_bytes = int(response.headers.get("content-length", 0))
                logger.info(f"[BRoll] 📦 文件大小: {total_bytes / 1024 / 1024:.2f} MB")
                
                last_log_time = time.time()
                with open(temp_file, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=65536):
                        f.write(chunk)
                        downloaded_bytes += len(chunk)
                        
                        now = time.time()
                        if now - last_log_time >= 5:
                            progress = int((downloaded_bytes / total_bytes) * 100) if total_bytes > 0 else 0
                            speed = downloaded_bytes / (now - download_start) / 1024 / 1024
                            logger.info(f"[BRoll] ⏳ 下载中: {progress}%, {downloaded_bytes/1024/1024:.1f}MB, 速度={speed:.2f}MB/s")
                            set_download_progress(task_id, {
                                "status": "downloading",
                                "progress": progress,
                                "asset_id": asset_id,
                            })
                            last_log_time = now
        
        download_duration = time.time() - download_start
        logger.info(f"[BRoll] ✅ 文件下载完成: {downloaded_bytes / 1024 / 1024:.2f} MB, 耗时={download_duration:.1f}s")
        
        # 3. 上传到 Supabase Storage
        set_download_progress(task_id, {
            "status": "uploading",
            "progress": 95,
            "asset_id": asset_id,
        })
        
        upload_start = time.time()
        file_size_mb = downloaded_bytes / 1024 / 1024
        logger.info(f"[BRoll] ⬆️ 开始上传到 Supabase Storage: {storage_path} ({file_size_mb:.1f}MB)")
        
        # ★ 大文件上传可能很慢（30MB 约需 15-30 秒）
        if file_size_mb > 50:
            logger.warning(f"[BRoll] ⚠️ 文件较大 ({file_size_mb:.1f}MB)，上传可能需要较长时间...")
        
        with open(temp_file, "rb") as f:
            file_data = f.read()
            supabase.storage.from_("clips").upload(
                storage_path,
                file_data,
                {"content-type": "video/mp4"}
            )
        
        upload_duration = time.time() - upload_start
        logger.info(f"[BRoll] ✅ 上传完成: 耗时={upload_duration:.1f}s")
        
        # 删除临时文件
        temp_file.unlink()
        
        # 4. 更新 asset 状态为 ready
        # ★★★ 关键：B-Roll 不需要 HLS 转码，直接设置 hls_status: ready ★★★
        supabase.table("assets").update({
            "status": "ready",
            "file_size": downloaded_bytes,
            "hls_status": "ready",  # ★ Pexels 视频是 H.264，可直接播放
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", asset_id).execute()
        
        logger.info(f"[BRoll] ✅ Asset 状态已更新为 ready (hls_status=ready)")
        
        # ★★★ 5. 创建 video clip（broll 是 video 的子类型） ★★★
        if track_id and broll_time_info:
            clip_id = str(uuid.uuid4())
            now = datetime.utcnow().isoformat()
            
            # 计算 clip 时长
            start_ms = broll_time_info.get("start_ms", 0)
            end_ms = broll_time_info.get("end_ms", start_ms + int(video_data.get("duration", 10) * 1000))
            clip_duration = end_ms - start_ms
            
            # 确定素材原始宽高比
            width = video_data.get("width", 1920)
            height = video_data.get("height", 1080)
            ratio = width / height if height > 0 else 1.78
            if ratio > 1.5:
                source_aspect_ratio = "16:9"
            elif ratio < 0.7:
                source_aspect_ratio = "9:16"
            else:
                source_aspect_ratio = "1:1"
            
            # ★★★ 获取目标宽高比和适配信息（fit_info 包含 letterbox_params）★★★
            target_aspect_ratio = broll_time_info.get("target_aspect_ratio", source_aspect_ratio)
            fit_info = broll_time_info.get("fit_info", {})
            display_mode = broll_time_info.get("display_mode", "fullscreen")
            pip_position_info = broll_time_info.get("pip_position_info")  # ★ 新增：PiP 位置信息
            
            # 提取 letterbox_params（用于前端渲染黑边）
            letterbox_params = fit_info.get("letterbox_params")
            fit_mode = fit_info.get("fit_mode")  # "letterbox" / "pillarbox" / "exact" / "crop"
            
            # 日志
            logger.info(f"[BRoll] 📐 宽高比: source={source_aspect_ratio}, target={target_aspect_ratio}, fit_mode={fit_mode}")
            if letterbox_params:
                logger.info(f"[BRoll] 📐 Letterbox: padding_top={letterbox_params.get('padding_top')}, padding_bottom={letterbox_params.get('padding_bottom')}")
            if pip_position_info:
                logger.info(f"[BRoll] 📐 PiP位置: position={pip_position_info.get('position')}, x={pip_position_info.get('x'):.2f}, y={pip_position_info.get('y'):.2f}, face_avoided={pip_position_info.get('face_avoided')}")
            
            # ★★★ 计算 transform - 兼容编辑器画布操作 ★★★
            # transform.x/y: 相对于画布中心的像素偏移（0=居中）
            # transform.scale: 整体缩放比例（1=填满画布）
            # 用户可在编辑器中拖拽调整位置、四角缩放
            target_width = broll_time_info.get("target_width", 1920)
            target_height = broll_time_info.get("target_height", 1080)
            
            transform_x = 0    # 像素偏移，0 表示居中
            transform_y = 0
            transform_scale = 1.0  # 缩放比例，1 表示填满画布
            
            if display_mode == "pip" and pip_position_info:
                # PiP 模式：计算像素偏移量
                # 归一化坐标 (0-1) 的 x, y 是 PiP 左上角位置
                pip_x_norm = pip_position_info.get("x", 0)  # 归一化 0-1
                pip_y_norm = pip_position_info.get("y", 0)  # 归一化 0-1
                pip_size = pip_position_info.get("size", 0.3)  # 相对尺寸 0.2-0.4
                
                # PiP 尺寸（像素）
                pip_width = target_width * pip_size
                pip_height = target_height * pip_size
                
                # PiP 中心点（像素坐标，相对于画布左上角）
                pip_center_x = pip_x_norm * target_width + pip_width / 2
                pip_center_y = pip_y_norm * target_height + pip_height / 2
                
                # 画布中心（像素）
                canvas_center_x = target_width / 2
                canvas_center_y = target_height / 2
                
                # transform.x/y = PiP 中心相对于画布中心的偏移（像素）
                transform_x = pip_center_x - canvas_center_x
                transform_y = pip_center_y - canvas_center_y
                
                # 缩放比例（视频 clip 使用 scale，不是 scaleX/scaleY）
                transform_scale = pip_size
                
                logger.info(f"[BRoll] 📐 PiP transform: x={transform_x:.0f}px, y={transform_y:.0f}px, scale={pip_size}")
            
            clip_data = {
                "id": clip_id,
                "track_id": track_id,
                "asset_id": asset_id,
                "clip_type": "video",  # ★ video 类型，broll 是子类型
                "name": f"B-roll: {', '.join(broll_time_info.get('search_keywords', [])[:2])}",
                "start_time": start_ms,
                "end_time": end_ms,
                "source_start": 0,
                "source_end": clip_duration,
                "volume": 1.0,
                "is_muted": True,  # B-roll 默认静音
                "speed": 1.0,
                # ★★★ transform: 兼容编辑器画布操作 ★★★
                # - x/y: 相对于画布中心的像素偏移（0=居中）
                # - scale: 整体缩放比例（1=填满画布）
                # - 用户可在编辑器中拖拽调整位置、四角缩放
                "transform": {
                    "x": transform_x,
                    "y": transform_y,
                    "scale": transform_scale,  # ★ 视频 clip 用 scale（不是 scaleX/scaleY）
                    "rotation": 0,
                    "opacity": 1,
                },
                "metadata": {
                    "is_broll": True,  # ★ 标记为 B-roll 子类型
                    "source": source,
                    "source_id": external_id,
                    "search_keywords": broll_time_info.get("search_keywords", []),
                    # ★★★ display_mode: fullscreen (全局覆盖) / pip (局部) ★★★
                    "display_mode": display_mode,
                    "thumbnail": video_data.get("thumbnail"),
                    "author": video_data.get("author", ""),
                    # ★★★ 宽高比信息 ★★★
                    "source_aspect_ratio": source_aspect_ratio,
                    "target_aspect_ratio": target_aspect_ratio,
                    "aspect_ratio": target_aspect_ratio,  # 兼容旧字段
                    # ★★★ fit_info（前端/渲染时使用） ★★★
                    "fit_mode": fit_mode,  # "letterbox" / "pillarbox" / "exact" / "crop"
                    "letterbox_params": letterbox_params,  # ★★★ 前端渲染黑边需要这个 ★★★
                    # ★★★ 目标分辨率 ★★★
                    "target_width": broll_time_info.get("target_width"),
                    "target_height": broll_time_info.get("target_height"),
                    # ★★★ PiP 配置（用户可在编辑器中覆盖） ★★★
                    "pip_config": pip_position_info,  # 包含 size, position, border_radius 等
                },
                "created_at": now,
                "updated_at": now,
            }
            
            supabase.table("clips").insert(clip_data).execute()
            logger.info(f"[BRoll] ✅ Video clip 已创建: clip_id={clip_id}, asset_id={asset_id}, time={start_ms}-{end_ms}ms, fit_mode={fit_mode}")
        
        # 6. 设置完成状态（下载完成，HLS 可能还在处理）
        set_download_progress(task_id, {
            "status": "completed",
            "progress": 100,
            "asset_id": asset_id,
            "clip_id": clip_id,
            "message": "下载完成",
        })
        
        # ★★★ 7. 异步触发 Cloudflare Stream 上传以获取 HLS ★★★
        # B-Roll 视频需要 HLS 流才能支持 seek 和分片加载
        if is_cf_configured():
            logger.info(f"[BRoll] 🚀 触发 Cloudflare Stream 上传任务: asset_id={asset_id}")
            upload_broll_to_cloudflare.delay(
                asset_id=asset_id,
                user_id=user_id,
                project_id=project_id,
            )
        else:
            logger.warning(f"[BRoll] ⚠️ Cloudflare Stream 未配置，B-Roll 将使用 MP4 代理播放")
        
        total_duration = time.time() - task_start_time
        logger.info(f"[BRoll] ✅ B-roll 下载任务完成: asset_id={asset_id}, clip_id={clip_id}, 总耗时={total_duration:.1f}s")
        
        return {
            "status": "success",
            "asset_id": asset_id,
            "clip_id": clip_id,
            "storage_path": storage_path,
        }
        
    except Exception as e:
        logger.error(f"[BRoll] ❌ 下载失败: {e}", exc_info=True)
        
        if asset_id:
            try:
                supabase.table("assets").update({
                    "status": "error",
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("id", asset_id).execute()
            except Exception as update_error:
                logger.error(f"[BRoll] 更新 asset 状态失败: {update_error}")
        
        set_download_progress(task_id, {
            "status": "failed",
            "progress": 0,
            "error": str(e),
            "asset_id": asset_id,
        })
        
        raise
