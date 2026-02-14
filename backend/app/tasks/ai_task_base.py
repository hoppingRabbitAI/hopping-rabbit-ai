"""
Lepus AI - AI 任务公共模块
提供所有 AI 任务共用的工具函数，避免代码重复

包含功能：
- AI 任务状态更新
- 文件下载/上传
- Asset 记录创建
- 进度追踪
"""
import os
import asyncio
import logging
import tempfile
import httpx
from datetime import datetime
from typing import Optional, Dict, Any, List, Callable
from uuid import uuid4

logger = logging.getLogger(__name__)

# ============================================
# Supabase 配置
# ============================================

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", os.getenv("SUPABASE_ANON_KEY", ""))
STORAGE_BUCKET = "ai-creations"


def _get_supabase():
    """延迟导入 supabase 客户端，避免循环导入"""
    from ..services.supabase_client import supabase
    return supabase


# ============================================
# AI 任务状态管理
# ============================================

def update_ai_task(task_id: str, **updates) -> bool:
    """
    更新任务表
    
    Args:
        task_id: 任务 ID
        **updates: 要更新的字段
        
    Returns:
        更新是否成功
    """
    updates["updated_at"] = datetime.utcnow().isoformat()
    try:
        _get_supabase().table("tasks").update(updates).eq("id", task_id).execute()
        return True
    except Exception as e:
        logger.error(f"[AITask] 更新任务状态失败: task_id={task_id}, error={e}")
        return False


def update_ai_task_progress(task_id: str, progress: int, status_message: str = None):
    """
    更新任务进度
    
    Args:
        task_id: 任务 ID
        progress: 进度百分比 0-100
        status_message: 状态描述消息
    """
    updates = {"progress": min(max(progress, 0), 100)}
    if status_message:
        updates["status_message"] = status_message
    update_ai_task(task_id, **updates)


def update_ai_task_status(
    task_id: str, 
    status: str, 
    output_url: str = None,
    output_asset_id: str = None,
    error_code: str = None,
    error_message: str = None,
    result_metadata: Dict = None
):
    """
    更新任务状态（完成/失败）
    
    Args:
        task_id: 任务 ID
        status: 状态 (pending/processing/completed/failed/cancelled)
        output_url: 输出文件 URL
        output_asset_id: 输出 Asset ID
        error_code: 错误码
        error_message: 错误消息
        result_metadata: 结果元数据（JSON）
    """
    updates = {"status": status}
    
    # 自动设置时间戳
    if status == "processing":
        updates["started_at"] = datetime.utcnow().isoformat()
    elif status in ("completed", "failed", "cancelled"):
        updates["completed_at"] = datetime.utcnow().isoformat()
    
    # 可选字段
    if output_url:
        updates["output_url"] = output_url
    if output_asset_id:
        updates["output_asset_id"] = output_asset_id
    if error_code:
        updates["error_code"] = error_code
    if error_message:
        updates["error_message"] = error_message
    if result_metadata:
        updates["metadata"] = result_metadata
    
    # 完成时自动设置进度为 100
    if status == "completed":
        updates["progress"] = 100
    
    update_ai_task(task_id, **updates)


def mark_task_started(task_id: str, provider_task_id: str = None):
    """标记任务开始处理"""
    updates = {"status": "processing", "started_at": datetime.utcnow().isoformat()}
    if provider_task_id:
        updates["provider_task_id"] = provider_task_id
    update_ai_task(task_id, **updates)


def mark_task_completed(
    task_id: str, 
    output_url: str, 
    output_asset_id: str = None,
    result_metadata: Dict = None
):
    """标记任务完成"""
    update_ai_task_status(
        task_id,
        status="completed",
        output_url=output_url,
        output_asset_id=output_asset_id,
        result_metadata=result_metadata
    )


def mark_task_failed(task_id: str, error_message: str, error_code: str = "PROCESSING_ERROR"):
    """标记任务失败"""
    update_ai_task_status(
        task_id,
        status="failed",
        error_code=error_code,
        error_message=error_message
    )


# ============================================
# 文件操作
# ============================================

async def download_file(url: str, dest_path: str, timeout: int = 300) -> str:
    """
    下载文件到本地
    
    Args:
        url: 文件 URL
        dest_path: 目标路径
        timeout: 超时时间（秒）
        
    Returns:
        下载后的本地路径
    """
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        
        with open(dest_path, "wb") as f:
            f.write(response.content)
    
    logger.info(f"[AITask] 文件下载完成: {url[:50]}... -> {dest_path}")
    return dest_path


def upload_to_storage(
    file_path: str, 
    storage_path: str, 
    content_type: str = "video/mp4"
) -> str:
    """
    上传文件到 Supabase Storage
    
    Args:
        file_path: 本地文件路径
        storage_path: Storage 中的路径
        content_type: MIME 类型
        
    Returns:
        公开访问 URL
    """
    supabase = _get_supabase()
    
    with open(file_path, "rb") as f:
        file_data = f.read()
    
    # 上传文件 (upsert=true 避免重复报错)
    supabase.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        file_data,
        file_options={"content-type": content_type, "upsert": "true"}
    )
    
    # 获取公开 URL
    public_url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
    
    logger.info(f"[AITask] 文件上传完成: {storage_path}")
    return public_url


async def download_and_upload(
    source_url: str,
    user_id: str,
    task_id: str,
    file_type: str = "video",
    index: int = None
) -> tuple[str, str]:
    """
    下载远程文件并上传到 Storage（一体化操作）
    
    Args:
        source_url: 源文件 URL
        user_id: 用户 ID
        task_id: 任务 ID
        file_type: 文件类型 (video/image/audio)
        index: 文件索引（批量生成时）
        
    Returns:
        (storage_path, public_url) 元组
    """
    # 确定文件扩展名和 MIME 类型
    ext_map = {
        "video": (".mp4", "video/mp4"),
        "image": (".png", "image/png"),
        "audio": (".mp3", "audio/mpeg"),
    }
    ext, content_type = ext_map.get(file_type, (".bin", "application/octet-stream"))
    
    # 下载到临时文件
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp_path = tmp.name
    
    try:
        await download_file(source_url, tmp_path)
        
        # 构建 Storage 路径
        suffix = f"_{index}" if index is not None else ""
        storage_path = f"ai_generated/{user_id}/{task_id}{suffix}{ext}"
        
        # 上传
        final_url = upload_to_storage(tmp_path, storage_path, content_type)
        return storage_path, final_url
        
    finally:
        # 清理临时文件
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ============================================
# Asset 记录管理
# ============================================

def create_asset_record(
    user_id: str,
    storage_path: str,
    ai_task_id: str,
    asset_type: str = "video",
    name: str = None,
) -> str:
    """
    创建 Asset 记录 - 匹配 assets 表结构
    
    Args:
        user_id: 用户 ID
        storage_path: Storage 中的路径
        ai_task_id: 关联的 AI 任务 ID
        asset_type: 类型 (video/image/audio)
        name: 素材名称
        
    Returns:
        新创建的 Asset ID
    """
    supabase = _get_supabase()
    
    asset_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    
    # 自动生成名称和 MIME 类型
    type_config = {
        "video": (".mp4", "video", "video/mp4"),
        "image": (".png", "image", "image/png"),
        "audio": (".mp3", "audio", "audio/mpeg"),
    }
    ext, file_type, mime_type = type_config.get(asset_type, ("", asset_type, "application/octet-stream"))
    
    if not name:
        name = f"AI生成_{datetime.now().strftime('%Y%m%d_%H%M%S')}{ext}"
    
    asset_data = {
        "id": asset_id,
        "project_id": None,  # AI 生成的素材不属于任何项目
        "user_id": user_id,
        "name": name,
        "original_filename": f"ai_generated{ext}",
        "file_type": file_type,
        "mime_type": mime_type,
        "storage_path": storage_path,
        "status": "ready",
        "ai_task_id": ai_task_id,
        "ai_generated": True,
        "created_at": now,
        "updated_at": now,
    }
    
    supabase.table("assets").insert(asset_data).execute()
    
    logger.info(f"[AITask] Asset 创建完成: id={asset_id}, type={asset_type}")
    return asset_id


# ============================================
# 轮询辅助函数
# ============================================

async def poll_task_status(
    query_func: Callable,
    task_id: str,
    ai_task_id: str,
    max_polls: int = 120,
    poll_interval: int = 5,
    progress_start: int = 20,
    progress_end: int = 85,
    task_name: str = "AI"
) -> Dict:
    """
    通用任务轮询函数
    
    Args:
        query_func: 查询函数，接受 task_id 返回任务状态
        task_id: 提供商任务 ID
        ai_task_id: 我们的 AI 任务 ID
        max_polls: 最大轮询次数
        poll_interval: 轮询间隔（秒）
        progress_start: 起始进度
        progress_end: 结束进度
        task_name: 任务名称（用于日志）
        
    Returns:
        成功时返回任务结果
        
    Raises:
        ValueError: 任务失败
        TimeoutError: 轮询超时
    """
    current_status = "submitted"
    task_result = None
    
    for i in range(max_polls):
        await asyncio.sleep(poll_interval)
        
        query_result = await query_func(task_id)
        
        # 处理 API 响应
        if isinstance(query_result, dict):
            if query_result.get("code") != 0:
                logger.warning(f"[{task_name}] 查询失败: {query_result.get('message')}")
                continue
            task_data = query_result.get("data", {})
        else:
            task_data = query_result
        
        current_status = task_data.get("task_status")
        
        # 更新进度
        progress = progress_start + int((i / max_polls) * (progress_end - progress_start))
        update_ai_task_progress(ai_task_id, progress, f"AI 处理: {current_status}")
        
        logger.info(f"[{task_name}] 轮询 {i+1}/{max_polls}: status={current_status}")
        
        if current_status == "succeed":
            task_result = task_data
            logger.info(f"[{task_name}] 任务完成")
            break
        elif current_status == "failed":
            error_msg = task_data.get("task_status_msg", "未知错误")
            raise ValueError(f"AI 任务失败: {error_msg}")
        elif current_status in ("submitted", "processing"):
            continue
        else:
            logger.warning(f"[{task_name}] 未知状态: {current_status}")
    
    if current_status != "succeed":
        raise TimeoutError(f"任务超时：{max_polls * poll_interval} 秒后仍未完成")
    
    return task_result


# ============================================
# 任务执行装饰器
# ============================================

def run_async_task(async_func):
    """
    将异步函数转换为同步 Celery 任务可调用的形式
    
    用法:
        result = run_async_task(my_async_function)(arg1, arg2)
    """
    def wrapper(*args, **kwargs):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(async_func(*args, **kwargs))
        finally:
            loop.close()
    return wrapper
