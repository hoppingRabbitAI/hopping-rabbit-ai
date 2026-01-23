"""
HoppingRabbit AI - 口型同步 Celery 任务
异步处理口型同步任务，支持进度更新和结果存储

任务流程:
1. 接收视频 URL 和音频 URL
2. 调用可灵 AI API 创建口型同步任务
3. 轮询任务状态，更新进度
4. 下载生成结果，上传到 Supabase Storage
5. 创建 Asset 记录，更新任务状态
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
STORAGE_BUCKET = "assets"  # 素材存储桶


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
        logger.error(f"[LipSync] 更新任务状态失败: {e}")


def update_ai_task_progress(task_id: str, progress: int, status_message: str = None):
    """更新任务进度"""
    updates = {"progress": progress}
    if status_message:
        updates["status_message"] = status_message
    update_ai_task(task_id, **updates)


def update_ai_task_status(
    task_id: str, 
    status: str, 
    output_url: str = None,
    output_asset_id: str = None,
    error_code: str = None,
    error_message: str = None
):
    """更新任务状态"""
    updates = {"status": status}
    
    if status == "processing":
        updates["started_at"] = datetime.utcnow().isoformat()
    elif status in ("completed", "failed"):
        updates["completed_at"] = datetime.utcnow().isoformat()
    
    if output_url:
        updates["output_url"] = output_url
    if output_asset_id:
        updates["output_asset_id"] = output_asset_id
    if error_code:
        updates["error_code"] = error_code
    if error_message:
        updates["error_message"] = error_message
    if status == "completed":
        updates["progress"] = 100
    
    update_ai_task(task_id, **updates)


# ============================================
# 文件下载和上传
# ============================================

async def download_file(url: str, dest_path: str) -> str:
    """下载文件到本地"""
    async with httpx.AsyncClient(timeout=300) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        
        with open(dest_path, "wb") as f:
            f.write(response.content)
    
    return dest_path


def upload_to_storage(file_path: str, storage_path: str) -> str:
    """上传文件到 Supabase Storage"""
    supabase = _get_supabase()
    
    with open(file_path, "rb") as f:
        file_data = f.read()
    
    # 上传文件
    result = supabase.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        file_data,
        file_options={"content-type": "video/mp4"}
    )
    
    # 获取公开 URL
    public_url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
    
    return public_url


def create_asset_record(
    user_id: str,
    file_url: str,
    ai_task_id: str,
    metadata: Dict = None
) -> str:
    """创建 Asset 记录"""
    supabase = _get_supabase()
    
    asset_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    
    asset_data = {
        "id": asset_id,
        "user_id": user_id,
        "name": f"AI生成_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4",
        "type": "video",
        "url": file_url,
        "ai_task_id": ai_task_id,
        "ai_generated": True,
        "metadata": metadata or {},
        "created_at": now,
        "updated_at": now,
    }
    
    supabase.table("assets").insert(asset_data).execute()
    
    return asset_id


# ============================================
# Celery 任务
# ============================================

@celery_app.task(
    bind=True,
    name="app.tasks.lip_sync.process_lip_sync",
    queue="gpu_medium",  # AI 任务使用 GPU 队列
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=1800,  # 30 分钟软超时
    time_limit=3600,       # 60 分钟硬超时
)
def process_lip_sync(
    self,
    ai_task_id: str,
    user_id: str,
    video_url: str,
    audio_url: str,
    options: Dict = None
):
    """
    口型同步 Celery 任务 - 完整流程
    
    流程:
    1. 人脸识别 - 获取 session_id 和 face_id
    2. 创建对口型任务 - 使用 session_id 提交任务
    3. 轮询任务状态 - 等待生成完成
    4. 下载并上传结果 - 存储到 Supabase
    
    Args:
        ai_task_id: AI 任务 ID (ai_tasks 表)
        user_id: 用户 ID
        video_url: 原始视频 URL
        audio_url: 目标音频 URL
        options: 可选参数
            - face_index: 选择第几张脸 (默认 0)
            - sound_volume: 音频音量 (默认 1.0)
            - original_audio_volume: 原视频音量 (默认 1.0)
    """
    options = options or {}
    
    logger.info(f"[LipSync] 开始处理任务: {ai_task_id}")
    
    # 运行异步任务
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        result = loop.run_until_complete(
            _process_lip_sync_async(
                ai_task_id=ai_task_id,
                user_id=user_id,
                video_url=video_url,
                audio_url=audio_url,
                options=options,
            )
        )
        return result
    finally:
        loop.close()


async def _process_lip_sync_async(
    ai_task_id: str,
    user_id: str,
    video_url: str,
    audio_url: str,
    options: Dict
) -> Dict:
    """口型同步异步处理 - 完整两步流程"""
    
    try:
        # Step 1: 更新状态为处理中
        update_ai_task_status(ai_task_id, "processing")
        update_ai_task_progress(ai_task_id, 5, "准备处理")
        
        # Step 2: 人脸识别
        update_ai_task_progress(ai_task_id, 10, "识别人脸")
        logger.info(f"[LipSync] 人脸识别: video={video_url[:50]}...")
        
        face_result = await kling_client.identify_face(video_url=video_url)
        session_id = face_result.get("session_id")
        face_data = face_result.get("face_data", [])
        
        if not session_id or not face_data:
            raise ValueError("人脸识别失败：未检测到人脸")
        
        # 选择要对口型的人脸
        face_index = options.get("face_index", 0)
        if face_index >= len(face_data):
            face_index = 0
        
        selected_face = face_data[face_index]
        face_id = selected_face["face_id"]
        face_start = selected_face["start_time"]
        face_end = selected_face["end_time"]
        
        logger.info(f"[LipSync] 选择人脸: face_id={face_id}, 可对口型区间={face_start}-{face_end}ms")
        
        # Step 3: 创建对口型任务
        update_ai_task_progress(ai_task_id, 20, "创建对口型任务")
        
        # 音频时间参数（这里简化处理，使用完整音频）
        sound_start_time = options.get("sound_start_time", 0)
        sound_end_time = options.get("sound_end_time", face_end - face_start)  # 默认使用整段音频
        sound_insert_time = options.get("sound_insert_time", face_start)  # 从人脸开始位置插入
        
        create_result = await kling_client.create_lip_sync_task(
            session_id=session_id,
            face_id=face_id,
            audio_url=audio_url,
            sound_start_time=sound_start_time,
            sound_end_time=sound_end_time,
            sound_insert_time=sound_insert_time,
            sound_volume=options.get("sound_volume", 1.0),
            original_audio_volume=options.get("original_audio_volume", 1.0),
            external_task_id=ai_task_id,
        )
        
        provider_task_id = create_result.get("task_id")
        task_status = create_result.get("task_status")
        
        if not provider_task_id:
            raise ValueError("创建对口型任务失败：未返回 task_id")
        
        update_ai_task(ai_task_id, provider_task_id=provider_task_id)
        logger.info(f"[LipSync] 对口型任务已创建: provider_task_id={provider_task_id}, status={task_status}")
        
        # Step 4: 轮询任务状态
        update_ai_task_progress(ai_task_id, 30, "AI 处理中")
        
        max_polls = 120  # 最多轮询 120 次（10 分钟）
        poll_interval = 5  # 每 5 秒轮询一次
        
        for i in range(max_polls):
            await asyncio.sleep(poll_interval)
            
            task_result = await kling_client.get_lip_sync_task(provider_task_id)
            current_status = task_result.get("task_status")
            
            # 更新进度（30% - 85%）
            progress = 30 + int((i / max_polls) * 55)
            update_ai_task_progress(ai_task_id, progress, f"AI 处理: {current_status}")
            
            logger.info(f"[LipSync] 轮询 {i+1}/{max_polls}: status={current_status}")
            
            if current_status == "succeed":
                logger.info(f"[LipSync] 任务完成")
                break
            elif current_status == "failed":
                error_msg = task_result.get("task_status_msg", "未知错误")
                raise ValueError(f"AI 任务失败: {error_msg}")
            elif current_status in ("submitted", "processing"):
                continue  # 继续等待
            else:
                logger.warning(f"[LipSync] 未知状态: {current_status}")
        
        if current_status != "succeed":
            raise TimeoutError(f"任务超时：{max_polls * poll_interval} 秒后仍未完成")
        
        # Step 5: 获取生成结果
        task_result = await kling_client.get_lip_sync_task(provider_task_id)
        videos = task_result.get("task_result", {}).get("videos", [])
        
        if not videos:
            raise ValueError("AI 返回结果中没有视频")
        
        output_video_url = videos[0]["url"]
        video_id = videos[0]["id"]
        video_duration = videos[0].get("duration", "0")
        
        logger.info(f"[LipSync] 获取结果: video_id={video_id}, url={output_video_url[:50]}...")
        
        # Step 6: 下载生成的视频
        update_ai_task_progress(ai_task_id, 85, "下载生成结果")
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = tmp.name
        
        await download_file(output_video_url, tmp_path)
        
        # Step 7: 上传到 Supabase Storage
        update_ai_task_progress(ai_task_id, 90, "保存到素材库")
        
        storage_path = f"ai_generated/{user_id}/{ai_task_id}.mp4"
        final_url = upload_to_storage(tmp_path, storage_path)
        
        # 清理临时文件
        os.unlink(tmp_path)
        
        # Step 8: 创建 Asset 记录
        update_ai_task_progress(ai_task_id, 95, "创建素材记录")
        
        asset_id = create_asset_record(
            user_id=user_id,
            file_url=final_url,
            ai_task_id=ai_task_id,
            metadata={
                "duration": video_duration,
                "video_id": video_id,
                "source": "lip_sync",
                "session_id": session_id,
                "face_id": face_id,
                "input_video": video_url,
                "input_audio": audio_url,
            }
        )
        
        # Step 7: 完成
        update_ai_task_status(
            ai_task_id,
            status="completed",
            output_url=final_url,
            output_asset_id=asset_id
        )
        
        logger.info(f"[LipSync] 任务完成: {ai_task_id}, asset_id={asset_id}")
        
        return {
            "success": True,
            "ai_task_id": ai_task_id,
            "output_url": final_url,
            "output_asset_id": asset_id,
        }
        
    except Exception as e:
        logger.error(f"[LipSync] 任务失败: {ai_task_id}, error={e}")
        
        update_ai_task_status(
            ai_task_id,
            status="failed",
            error_code="PROCESSING_ERROR",
            error_message=str(e)
        )
        
        raise


async def _mock_kling_api(ai_task_id: str, video_url: str, audio_url: str) -> Dict:
    """
    Mock 可灵 API 响应（开发测试用）
    模拟处理过程和返回结果
    """
    logger.info(f"[LipSync][Mock] 模拟 AI 处理...")
    
    # 模拟处理进度
    for progress in [20, 40, 60, 80]:
        update_ai_task_progress(ai_task_id, 20 + int(progress * 0.6), f"[Mock] AI 处理 {progress}%")
        await asyncio.sleep(1)  # 模拟处理时间
    
    # 返回 Mock 结果（使用原视频作为输出）
    return {
        "task_id": f"mock_{ai_task_id}",
        "status": "completed",
        "result": {
            "video_url": video_url,  # Mock: 直接返回原视频
            "duration": 30.0,
            "width": 1920,
            "height": 1080,
        }
    }
