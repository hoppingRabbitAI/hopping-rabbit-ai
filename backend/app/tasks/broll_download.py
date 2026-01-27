"""
HoppingRabbit AI - B-roll 下载任务
使用 Celery 后台任务下载 B-roll 视频到 Supabase Storage
"""
import os
import logging
import httpx
import uuid
from datetime import datetime
from typing import Dict, Optional
from pathlib import Path

from app.celery_config import celery_app
from app.services.supabase_client import supabase

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
    video_data: dict
):
    """
    下载 B-roll 视频到 Supabase Storage
    
    Args:
        task_id: 任务 ID
        user_id: 用户 ID
        project_id: 项目 ID
        video_data: 视频数据
            {
                "id": 123456,
                "url": "https://...",
                "width": 1920,
                "height": 1080,
                "duration": 15,
                "thumbnail": "https://...",
                "source": "pexels",
                "author": "Name",
                "author_url": "https://..."
            }
    """
    asset_id = None
    
    import time
    task_start_time = time.time()
    try:
        logger.info(f"[BRoll] 🚀 开始下载视频: task_id={task_id}, source={video_data.get('source')}, video_id={video_data.get('id')}")
        logger.info(f"[BRoll] 📋 视频信息: url={video_data.get('url')[:100]}..., duration={video_data.get('duration')}s")
        
        # 1. 创建 asset 记录（状态为 downloading）
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
            "keywords": video_data.get("keywords", []),
            "quality": video_data.get("quality", "hd"),
            "orientation": video_data.get("orientation", "landscape"),
        }
        
        # 创建 asset 记录（使用正确的字段名）
        # 不需要生成 URL，前端会用 getAssetStreamUrl(asset_id) 生成代理 URL
        
        asset_name = f"B-roll: {video_data.get('author', source)} #{external_id}"
        asset_data = {
            "id": asset_id,
            "project_id": project_id,
            "user_id": user_id,
            "name": asset_name,  # 必填字段
            "original_filename": f"broll-{source}-{external_id}{file_ext}",  # 数据库字段
            "file_type": "video",  # 数据库字段
            "mime_type": "video/mp4",
            "storage_path": storage_path,
            "status": "processing",  # 使用允许的状态值 (uploading/uploaded/processing/ready/error)
            "duration": float(video_data.get("duration", 0)),
            "width": video_data.get("width"),
            "height": video_data.get("height"),
            "broll_metadata": broll_metadata,
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
        
        logger.info(f"[BRoll] 开始下载文件: {video_url}")
        
        # 使用流式下载，支持大文件和进度跟踪
        total_bytes = 0
        downloaded_bytes = 0
        temp_file = Path(f"/tmp/{asset_id}{file_ext}")
        
        download_start = time.time()
        logger.info(f"[BRoll] ⬇️ 开始 HTTP 下载: {video_url[:100]}...")
        
        with httpx.Client(timeout=300) as client:
            with client.stream("GET", video_url) as response:
                response.raise_for_status()
                
                # 获取文件总大小
                total_bytes = int(response.headers.get("content-length", 0))
                logger.info(f"[BRoll] 📦 文件大小: {total_bytes / 1024 / 1024:.2f} MB, HTTP状态: {response.status_code}")
                
                # 流式写入临时文件
                last_log_time = time.time()
                with open(temp_file, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=65536):  # 增大 chunk 到 64KB
                        f.write(chunk)
                        downloaded_bytes += len(chunk)
                        
                        # 每 5 秒或每下载 5MB 更新一次进度
                        now = time.time()
                        if now - last_log_time >= 5 or downloaded_bytes % (5 * 1024 * 1024) == 0:
                            progress = int((downloaded_bytes / total_bytes) * 100) if total_bytes > 0 else 0
                            speed = downloaded_bytes / (now - download_start) / 1024 / 1024  # MB/s
                            logger.info(f"[BRoll] ⏳ 下载中: {progress}%, {downloaded_bytes/1024/1024:.1f}/{total_bytes/1024/1024:.1f}MB, 速度={speed:.2f}MB/s")
                            set_download_progress(task_id, {
                                "status": "downloading",
                                "progress": progress,
                                "total_bytes": total_bytes,
                                "downloaded_bytes": downloaded_bytes,
                                "asset_id": asset_id,
                                "speed_mbps": round(speed, 2),
                            })
                            last_log_time = now
        
        download_duration = time.time() - download_start
        avg_speed = downloaded_bytes / download_duration / 1024 / 1024 if download_duration > 0 else 0
        logger.info(f"[BRoll] ✅ 文件下载完成: {downloaded_bytes / 1024 / 1024:.2f} MB, 耗时={download_duration:.1f}s, 平均速度={avg_speed:.2f}MB/s")
        
        # 3. 上传到 Supabase Storage
        set_download_progress(task_id, {
            "status": "uploading",
            "progress": 95,
            "asset_id": asset_id,
        })
        
        upload_start = time.time()
        logger.info(f"[BRoll] ⬆️ 开始上传到 Supabase Storage: {storage_path}, 文件大小={downloaded_bytes/1024/1024:.2f}MB")
        
        with open(temp_file, "rb") as f:
            file_data = f.read()
            logger.info(f"[BRoll] 📤 读取临时文件完成，开始上传...")
            supabase.storage.from_("clips").upload(
                storage_path,
                file_data,
                {"content-type": "video/mp4"}
            )
        
        upload_duration = time.time() - upload_start
        upload_speed = downloaded_bytes / upload_duration / 1024 / 1024 if upload_duration > 0 else 0
        logger.info(f"[BRoll] ✅ 上传完成: 耗时={upload_duration:.1f}s, 速度={upload_speed:.2f}MB/s")
        
        # 删除临时文件
        temp_file.unlink()
        logger.info(f"[BRoll] 🗑️ 临时文件已删除")
        
        # 4. 更新 asset 状态为 ready
        supabase.table("assets").update({
            "status": "ready",
            "file_size": downloaded_bytes,
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", asset_id).execute()
        
        logger.info(f"[BRoll] ✅ Asset 状态已更新为 ready")
        
        # 5. 触发后台任务：提取元数据 + 生成缩略图 + HLS 转码
        # 先设置为 completed，让前端可以使用
        set_download_progress(task_id, {
            "status": "completed",
            "progress": 100,
            "asset_id": asset_id,
            "total_bytes": total_bytes,
            "downloaded_bytes": downloaded_bytes,
            "message": "下载完成，正在处理...",
        })
        logger.info(f"[BRoll] 📋 已设置完成状态，前端可用，开始后处理...")
        
        try:
            from app.api.assets import process_asset
            import asyncio
            process_start = time.time()
            logger.info(f"[BRoll] 🔧 开始 process_asset: asset_id={asset_id}")
            
            # 在新的事件循环中运行异步任务（因为 Celery 任务是同步的）
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(process_asset(asset_id))
            loop.close()
            
            process_duration = time.time() - process_start
            logger.info(f"[BRoll] ✅ 资源处理任务已完成: 耗时={process_duration:.1f}s")
        except Exception as process_error:
            logger.warning(f"[BRoll] ⚠️ 资源处理失败，但不影响下载: {process_error}")
        
        total_duration = time.time() - task_start_time
        logger.info(f"[BRoll] ✅ B-roll 下载任务完成: asset_id={asset_id}, 总耗时={total_duration:.1f}s")
        
        return {
            "status": "success",
            "asset_id": asset_id,
            "storage_path": storage_path,
            "total_duration": total_duration,
        }
        
    except Exception as e:
        logger.error(f"[BRoll] ❌ 下载失败: {e}", exc_info=True)
        
        # 更新 asset 状态为 error
        if asset_id:
            try:
                supabase.table("assets").update({
                    "status": "error",
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("id", asset_id).execute()
            except Exception as update_error:
                logger.error(f"[BRoll] 更新 asset 状态失败: {update_error}")
        
        # 更新进度为失败
        set_download_progress(task_id, {
            "status": "failed",
            "progress": 0,
            "error": str(e),
            "asset_id": asset_id,
        })
        
        raise
