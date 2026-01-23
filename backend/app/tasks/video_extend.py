"""
HoppingRabbit AI - 视频延长 Celery 任务
异步处理视频延长任务，支持进度更新和结果存储

应用场景：
- 延长AI生成的视频时长
- 可多次延长，总时长不超过3分钟
- 每次延长4-5秒
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
    """更新 ai_tasks 表"""
    updates["updated_at"] = datetime.utcnow().isoformat()
    try:
        _get_supabase().table("ai_tasks").update(updates).eq("id", task_id).execute()
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

@celery_app.task(name="tasks.video_extend.process_video_extend", bind=True)
def process_video_extend(
    self,
    task_id: str,
    user_id: str,
    video_id: str,
    options: Dict = None
):
    """
    视频延长任务入口
    
    Args:
        task_id: ai_tasks 表的任务 ID
        user_id: 用户 ID
        video_id: 要延长的视频 ID（可灵生成的视频ID）
        options: 可选参数 (prompt, negative_prompt, cfg_scale)
    """
    options = options or {}
    
    logger.info(f"[VideoExtend] 开始处理任务: task_id={task_id}, video_id={video_id}")
    
    try:
        # 使用异步函数
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        result = loop.run_until_complete(
            _process_video_extend_async(task_id, user_id, video_id, options)
        )
        return result
    
    except Exception as e:
        logger.error(f"[VideoExtend] 任务失败: {e}", exc_info=True)
        update_ai_task(
            task_id,
            status="failed",
            error_message=str(e),
            progress=0
        )
        raise


async def _process_video_extend_async(
    task_id: str,
    user_id: str,
    video_id: str,
    options: Dict
) -> Dict:
    """
    视频延长异步处理
    
    流程:
    1. 更新状态为 processing
    2. 调用可灵 API 创建视频延长任务
    3. 轮询任务状态，更新进度
    4. 下载延长后的视频
    5. 上传到 Supabase Storage
    6. 创建 Asset 记录
    7. 更新任务状态为 completed
    """
    
    try:
        # Step 1: 更新状态
        update_ai_task(task_id, status="processing", progress=10)
        logger.info(f"[VideoExtend] Step 1: 状态更新为 processing")
        
        # Step 2: 调用可灵 API
        api_options = {}
        
        if options.get("prompt"):
            api_options["prompt"] = options["prompt"]
        if options.get("negative_prompt"):
            api_options["negative_prompt"] = options["negative_prompt"]
        if options.get("cfg_scale") is not None:
            api_options["cfg_scale"] = options["cfg_scale"]
        
        logger.info(f"[VideoExtend] Step 2: 调用可灵 API...")
        response = await kling_client.create_video_extend_task(
            video_id=video_id,
            options=api_options
        )
        
        kling_task_id = response.get("data", {}).get("task_id")
        if not kling_task_id:
            raise ValueError(f"可灵 API 返回无效: {response}")
        
        update_ai_task(task_id, kling_task_id=kling_task_id, progress=20)
        logger.info(f"[VideoExtend] 可灵任务ID: {kling_task_id}")
        
        # Step 3: 轮询任务状态
        max_polls = 120  # 最多 120 次，总计 10 分钟
        poll_count = 0
        status_data = {}
        
        while poll_count < max_polls:
            await asyncio.sleep(5)  # 每 5 秒轮询一次
            poll_count += 1
            
            # 使用专用的视频延长查询接口
            status_response = await kling_client.get_video_extend_task(kling_task_id)
            status_data = status_response.get("data", {})
            task_status = status_data.get("task_status", "")
            
            logger.info(f"[VideoExtend] 轮询 {poll_count}/{max_polls}: status={task_status}")
            
            # 计算进度 20-80%
            progress = 20 + int((poll_count / max_polls) * 60)
            update_ai_task(task_id, progress=min(progress, 80))
            
            if task_status == "succeed":
                logger.info(f"[VideoExtend] 任务成功")
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
        
        video_result_url = videos[0].get("url")
        extended_video_id = videos[0].get("id")
        new_duration = float(videos[0].get("duration", 10.0))
        
        if not video_result_url:
            raise ValueError("视频 URL 为空")
        
        # 获取原视频信息
        task_info = status_data.get("task_info", {})
        parent_video = task_info.get("parent_video", {})
        original_duration = float(parent_video.get("duration", 5.0))
        
        logger.info(f"[VideoExtend] Step 4: 获取视频 URL: {video_result_url[:80]}...")
        logger.info(f"[VideoExtend] 时长: {original_duration}s -> {new_duration}s")
        update_ai_task(task_id, progress=85)
        
        # Step 5: 下载视频到临时文件
        logger.info(f"[VideoExtend] Step 5: 下载视频...")
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.get(video_result_url)
            response.raise_for_status()
            temp_file.write(response.content)
            temp_file.close()
        
        file_size = os.path.getsize(temp_file.name)
        logger.info(f"[VideoExtend] 视频已下载: {temp_file.name}, size={file_size}")
        update_ai_task(task_id, progress=90)
        
        # Step 6: 上传到 Supabase Storage
        logger.info(f"[VideoExtend] Step 6: 上传到 Supabase Storage...")
        storage_path = f"ai_generated/{user_id}/{task_id}.mp4"
        
        with open(temp_file.name, "rb") as f:
            _get_supabase().storage.from_(STORAGE_BUCKET).upload(
                storage_path,
                f.read(),
                {"content-type": "video/mp4", "upsert": "true"}
            )
        
        # 获取公开 URL
        storage_url = _get_supabase().storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
        logger.info(f"[VideoExtend] 上传成功: {storage_url[:80]}...")
        
        # 清理临时文件
        os.unlink(temp_file.name)
        
        update_ai_task(task_id, progress=95)
        
        # Step 7: 创建 Asset 记录
        logger.info(f"[VideoExtend] Step 7: 创建 Asset 记录...")
        
        asset_data = {
            "project_id": "00000000-0000-0000-0000-000000000000",
            "user_id": user_id,
            "name": f"AI视频延长_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            "file_type": "video",
            "original_filename": "ai_generated.mp4",
            "mime_type": "video/mp4",
            "storage_path": storage_path,
            "duration": new_duration,
            "ai_task_id": task_id,
            "ai_generated": True,
            "status": "ready"
        }
        
        asset_id = create_asset(user_id, asset_data)
        if not asset_id:
            raise RuntimeError("创建 Asset 记录失败")
        
        logger.info(f"[VideoExtend] Asset 创建成功: {asset_id}")
        
        # Step 8: 完成任务
        update_ai_task(
            task_id,
            status="completed",
            progress=100,
            result_asset_id=asset_id,
            result_url=storage_url
        )
        
        logger.info(f"[VideoExtend] 任务完成: task_id={task_id}, asset_id={asset_id}")
        
        return {
            "task_id": task_id,
            "asset_id": asset_id,
            "video_url": storage_url,
            "extended_video_id": extended_video_id,  # 可用于再次延长
            "duration": new_duration
        }
    
    except Exception as e:
        logger.error(f"[VideoExtend] 处理失败: {e}", exc_info=True)
        update_ai_task(task_id, status="failed", error_message=str(e))
        raise
