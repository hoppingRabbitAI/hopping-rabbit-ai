"""
Lepus AI - 图生视频 Celery 任务
异步处理图生视频任务，支持进度更新和结果存储

应用场景：
- 产品图片动态展示
- 静态素材动起来
- 封面图生成预告片
"""
import os
import asyncio
import logging
import tempfile
import httpx
from datetime import datetime
from typing import Optional, Dict, Any
from uuid import uuid4

from ..celery_config import celery_app
from ..services.kling_ai_service import kling_client, KlingConfig

logger = logging.getLogger(__name__)

# ============================================
# Supabase 配置
# ============================================

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", os.getenv("SUPABASE_ANON_KEY", ""))
STORAGE_BUCKET = "ai-creations"


def _get_supabase():
    """延迟导入 supabase 客户端"""
    from ..services.supabase_client import supabase
    return supabase


# ============================================
# AI 任务表操作
# ============================================

def update_ai_task(task_id: str, **updates):
    """更新任务表"""
    updates["updated_at"] = datetime.utcnow().isoformat()
    try:
        _get_supabase().table("tasks").update(updates).eq("id", task_id).execute()
    except Exception as e:
        logger.error(f"更新 ai_task 失败: {e}")


def create_asset(user_id: str, asset_data: Dict) -> Optional[str]:
    """创建 Asset 记录"""
    try:
        result = _get_supabase().table("assets").insert(asset_data).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]["id"]
    except Exception as e:
        logger.error(f"创建 asset 失败: {e}")
    return None


# ============================================
# Celery 任务
# ============================================

@celery_app.task(
    name="tasks.image_to_video.process_image_to_video",
    bind=True,
    queue="gpu",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_kwargs={"max_retries": 2},
)
def process_image_to_video(self, task_id: str, user_id: str, image_url: str, options: Dict = None):
    """
    图生视频任务入口
    
    Args:
        task_id: 任务 ID
        user_id: 用户 ID
        image_url: 源图片 URL
        options: 可选参数 (prompt, duration, motion_scale, camera_motion)
    """
    options = options or {}
    
    logger.info(f"[ImageToVideo] 开始处理任务: task_id={task_id}, image_url={image_url[:80]}...")
    
    try:
        # 使用异步函数
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        result = loop.run_until_complete(
            _process_image_to_video_async(task_id, user_id, image_url, options)
        )
        return result
    
    except Exception as e:
        logger.error(f"[ImageToVideo] 任务失败: {e}", exc_info=True)
        update_ai_task(
            task_id,
            status="failed",
            error_message=str(e),
            progress=0
        )
        raise


async def _process_image_to_video_async(
    task_id: str,
    user_id: str,
    image_url: str,
    options: Dict
) -> Dict:
    """
    图生视频异步处理
    
    流程:
    1. 更新状态为 processing
    2. 调用可灵 API 创建图生视频任务
    3. 轮询任务状态，更新进度
    4. 下载生成的视频
    5. 上传到 Supabase Storage
    6. 创建 Asset 记录
    7. 更新任务状态为 completed
    """
    
    try:
        # Step 1: 更新状态
        update_ai_task(task_id, status="processing", progress=10)
        logger.info(f"[ImageToVideo] Step 1: 状态更新为 processing")
        
        # Step 2: 调用可灵 API
        prompt = options.get("prompt", "")
        api_options = {
            "model_name": options.get("model_name", "kling-v2-6"),  # 默认使用 v2.6
            "duration": options.get("duration", "5"),
            "mode": options.get("mode", "std"),
            "cfg_scale": options.get("cfg_scale", 0.5),
        }
        
        # 可选高级参数
        # ⚠️ API 互斥约束: image_tail / camera_control / static_mask+dynamic_masks 三选一
        has_image_tail = bool(options.get("image_tail"))
        if has_image_tail:
            api_options["image_tail"] = options["image_tail"]
        if options.get("negative_prompt"):
            api_options["negative_prompt"] = options["negative_prompt"]
        if options.get("camera_control") and not has_image_tail:
            api_options["camera_control"] = options["camera_control"]
        if options.get("static_mask") and not has_image_tail:
            api_options["static_mask"] = options["static_mask"]
        if options.get("dynamic_masks") and not has_image_tail:
            api_options["dynamic_masks"] = options["dynamic_masks"]
        
        logger.info(f"[ImageToVideo] Step 2: 调用可灵 API - image={image_url[:80]}...")
        response = await kling_client.create_image_to_video_task(
            image=image_url,  # 参数名改为 image
            prompt=prompt,
            options=api_options
        )
        
        kling_task_id = response.get("data", {}).get("task_id")
        if not kling_task_id:
            raise ValueError(f"可灵 API 返回无效: {response}")
        
        update_ai_task(task_id, provider_task_id=kling_task_id, progress=20)
        logger.info(f"[ImageToVideo] 可灵任务ID: {kling_task_id}")
        
        # Step 3: 轮询任务状态
        max_polls = 120  # 最多 120 次，总计 10 分钟
        poll_count = 0
        
        while poll_count < max_polls:
            await asyncio.sleep(5)  # 每 5 秒轮询一次
            poll_count += 1
            
            # 使用专用的图生视频查询接口
            status_response = await kling_client.get_image_to_video_task(kling_task_id)
            status_data = status_response.get("data", {})
            task_status = status_data.get("task_status", "")
            
            logger.info(f"[ImageToVideo] 轮询 {poll_count}/{max_polls}: task_id={task_id}, status={task_status}")
            
            # 计算进度 20-80%
            progress = 20 + int((poll_count / max_polls) * 60)
            update_ai_task(task_id, progress=min(progress, 80))
            
            if task_status == "succeed":
                logger.info(f"[ImageToVideo] 任务成功")
                break
            elif task_status == "failed":
                error_msg = status_data.get("task_status_msg", "Unknown error")
                raise RuntimeError(f"可灵任务失败: {error_msg}")
        
        if poll_count >= max_polls:
            raise TimeoutError("任务超时")
        
        # Step 4: 获取结果视频 URL
        task_result = status_data.get("task_result", {})
        videos = task_result.get("videos", [])
        if not videos or len(videos) == 0:
            raise ValueError("任务结果中没有视频")
        
        video_url = videos[0].get("url")
        if not video_url:
            raise ValueError("视频 URL 为空")
        
        logger.info(f"[ImageToVideo] Step 4: 获取视频 URL: {video_url[:80]}...")
        update_ai_task(task_id, progress=85)
        
        # Step 5: 下载视频到临时文件
        logger.info(f"[ImageToVideo] Step 5: 下载视频...")
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.get(video_url)
            response.raise_for_status()
            temp_file.write(response.content)
            temp_file.close()
        
        logger.info(f"[ImageToVideo] 视频已下载: {temp_file.name}")
        update_ai_task(task_id, progress=90)
        
        # Step 6: 上传到 Supabase Storage（带重试，防止超时）
        logger.info(f"[ImageToVideo] Step 6: 上传到 Supabase Storage...")
        storage_path = f"ai_generated/{user_id}/{task_id}.mp4"
        
        with open(temp_file.name, "rb") as f:
            file_bytes = f.read()
        
        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                _get_supabase().storage.from_(STORAGE_BUCKET).upload(
                    storage_path,
                    file_bytes,
                    {"content-type": "video/mp4", "upsert": "true"}
                )
                break
            except Exception as upload_err:
                err_msg = str(upload_err)
                is_timeout = "timeout" in err_msg.lower() or "ReadTimeout" in err_msg
                logger.warning(
                    f"[ImageToVideo] Storage 上传失败 (attempt {attempt}/{max_retries}): {err_msg}"
                )
                if attempt >= max_retries or not is_timeout:
                    raise RuntimeError(f"Supabase Storage 上传失败(已重试{attempt}次): {err_msg}") from upload_err
                await asyncio.sleep(2 ** attempt)  # 2s, 4s 指数退避
        
        # 获取公开 URL
        storage_url = _get_supabase().storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
        logger.info(f"[ImageToVideo] 上传成功: {storage_url[:80]}...")
        
        # 清理临时文件
        os.unlink(temp_file.name)
        
        update_ai_task(task_id, progress=95)
        
        # Step 7: 创建 Asset 记录
        logger.info(f"[ImageToVideo] Step 7: 创建 Asset 记录...")
        
        asset_data = {
            "project_id": None,  # AI 生成的素材不属于任何项目
            "user_id": user_id,
            "name": f"AI图生视频_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            "original_filename": "ai_generated.mp4",
            "file_type": "video",
            "mime_type": "video/mp4",
            "storage_path": storage_path,
            "status": "ready",
            "duration": float(videos[0].get("duration", 5.0)),
            "ai_task_id": task_id,
            "ai_generated": True,
        }
        
        asset_id = create_asset(user_id, asset_data)
        if not asset_id:
            raise RuntimeError("创建 Asset 记录失败")
        
        logger.info(f"[ImageToVideo] Asset 创建成功: {asset_id}")
        
        # Step 8: 完成任务
        update_ai_task(
            task_id,
            status="completed",
            progress=100,
            output_asset_id=asset_id,
            output_url=storage_url
        )
        
        logger.info(f"[ImageToVideo] 任务完成: task_id={task_id}, asset_id={asset_id}")
        
        return {
            "task_id": task_id,
            "asset_id": asset_id,
            "video_url": storage_url
        }
    
    except Exception as e:
        logger.error(f"[ImageToVideo] 处理失败: {e}", exc_info=True)
        update_ai_task(task_id, status="failed", error_message=str(e))
        raise
