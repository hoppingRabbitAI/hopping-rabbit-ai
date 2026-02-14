"""
Lepus AI - Enhance & Style 统一 Celery 任务
通过 AIEngineRegistry 路由到具体引擎，避免每个能力写重复的轮询 + 上传逻辑

支持能力：
- skin_enhance  (皮肤美化)
- relight       (AI 打光)
- outfit_swap   (换装)
- ai_stylist    (AI 穿搭师)
- outfit_shot   (AI 穿搭内容生成)

PRD Reference: §4.3 / §8 数据流
"""
import os
import asyncio
import logging
import tempfile
import httpx
from datetime import datetime
from typing import Optional, Dict, Any, List
from uuid import uuid4

from ..celery_config import celery_app
from ..services.ai_engine_registry import (
    AIEngineRegistry,
    AIEngineResult,
    AIEngineStatus,
)

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
# DB 操作
# ============================================

def update_ai_task(task_id: str, **updates):
    """更新任务表"""
    updates["updated_at"] = datetime.utcnow().isoformat()
    try:
        _get_supabase().table("tasks").update(updates).eq("id", task_id).execute()
    except Exception as e:
        logger.error(f"[EnhanceStyle] 更新 ai_task 失败: {e}")


def create_asset(user_id: str, asset_data: Dict) -> Optional[str]:
    """创建 Asset 记录"""
    try:
        result = _get_supabase().table("assets").insert(asset_data).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]["id"]
    except Exception as e:
        logger.error(f"[EnhanceStyle] 创建 asset 失败: {e}")
    return None


# ============================================
# Celery 任务
# ============================================

@celery_app.task(
    name="tasks.enhance_style.process_enhance_style",
    bind=True,
    queue="gpu",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_kwargs={"max_retries": 2},
)
def process_enhance_style(
    self,
    task_id: str,
    user_id: str,
    capability_id: str,
    params: Dict[str, Any],
):
    """
    Enhance & Style 统一任务入口
    
    通过 AIEngineRegistry 路由到具体引擎，共享轮询 + 上传逻辑
    
    Args:
        task_id: 任务 ID
        user_id: 用户 ID
        capability_id: 能力 ID (skin_enhance / relight / outfit_swap / ai_stylist / outfit_shot)
        params: 能力特有参数
    """
    logger.info(f"[EnhanceStyle] 开始处理: task_id={task_id}, capability={capability_id}")
    
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(
                _process_async(task_id, user_id, capability_id, params)
            )
            return result
        finally:
            loop.close()
    
    except Exception as e:
        logger.error(f"[EnhanceStyle] 任务失败: {e}", exc_info=True)
        update_ai_task(
            task_id,
            status="failed",
            error_message=str(e),
            progress=0,
        )
        raise


async def _process_async(
    task_id: str,
    user_id: str,
    capability_id: str,
    params: Dict[str, Any],
) -> Dict:
    """
    统一异步处理流程
    
    1. 获取引擎 → 校验参数
    2. 调用引擎 execute()
    3. 轮询（如果是异步引擎）
    4. 下载结果 → 上传 Supabase Storage
    5. 创建 Asset → 更新任务状态
    """
    
    # Step 1: 获取引擎 & 校验
    engine = AIEngineRegistry.get_engine(capability_id)
    
    validation_error = engine.validate_params(params)
    if validation_error:
        update_ai_task(task_id, status="failed", error_message=validation_error)
        raise ValueError(validation_error)
    
    update_ai_task(task_id, status="processing", progress=10)
    logger.info(f"[EnhanceStyle] Step 1: 引擎={engine}, 参数校验通过")
    
    # Step 2: 调用引擎
    logger.info(f"[EnhanceStyle] Step 2: 调用引擎 execute()...")
    result = await engine.execute(params)
    
    if result.status == AIEngineStatus.FAILED:
        raise RuntimeError(f"引擎执行失败: {result.error_message}")
    
    update_ai_task(
        task_id,
        provider_task_id=result.provider_task_id,
        progress=20,
    )
    
    # Step 3: 轮询（如需要）
    if result.status == AIEngineStatus.POLLING:
        logger.info(f"[EnhanceStyle] Step 3: 轮询 provider_task={result.provider_task_id}")
        max_polls = engine.default_timeout // engine.poll_interval
        poll_count = 0
        
        while poll_count < max_polls:
            await asyncio.sleep(engine.poll_interval)
            poll_count += 1
            
            result = await engine.poll_status(result.provider_task_id)
            
            # 计算进度 20-80%
            progress = 20 + int((poll_count / max_polls) * 60)
            update_ai_task(task_id, progress=min(progress, 80))
            
            if result.status == AIEngineStatus.COMPLETED:
                logger.info(f"[EnhanceStyle] 轮询完成 ({poll_count} 次)")
                break
            elif result.status == AIEngineStatus.FAILED:
                raise RuntimeError(f"引擎任务失败: {result.error_message}")
        
        if poll_count >= max_polls:
            raise TimeoutError(f"任务超时 ({engine.default_timeout}s)")
    
    # Step 4: 下载结果 → 上传 Storage
    if not result.output_urls:
        raise ValueError("引擎返回空结果")
    
    logger.info(f"[EnhanceStyle] Step 4: 下载 {len(result.output_urls)} 个结果...")
    update_ai_task(task_id, progress=85)
    
    output_type = result.output_type or "image"
    suffix = ".mp4" if output_type == "video" else ".png"
    mime_type = "video/mp4" if output_type == "video" else "image/png"
    
    uploaded_urls = []
    asset_ids = []
    
    for i, url in enumerate(result.output_urls):
        try:
            # 下载
            async with httpx.AsyncClient(timeout=300) as client:
                response = await client.get(url)
                response.raise_for_status()
                content = response.content
            
            # 上传到 Supabase Storage
            variant_suffix = f"_v{i}" if len(result.output_urls) > 1 else ""
            storage_path = f"ai_generated/{user_id}/{task_id}{variant_suffix}{suffix}"
            
            _get_supabase().storage.from_(STORAGE_BUCKET).upload(
                storage_path,
                content,
                {"content-type": mime_type, "upsert": "true"},
            )
            
            storage_url = _get_supabase().storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
            uploaded_urls.append(storage_url)
            
            # 创建 Asset
            capability_labels = {
                "skin_enhance": "皮肤美化",
                "relight": "AI打光",
                "outfit_swap": "换装",
                "ai_stylist": "AI穿搭师",
                "outfit_shot": "AI穿搭内容",
            }
            label = capability_labels.get(capability_id, capability_id)
            
            asset_data = {
                "project_id": None,
                "user_id": user_id,
                "name": f"{label}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}{variant_suffix}",
                "file_type": output_type,
                "original_filename": f"ai_generated{variant_suffix}{suffix}",
                "mime_type": mime_type,
                "storage_path": storage_path,
                "ai_task_id": task_id,
                "ai_generated": True,
                "status": "ready",
            }
            
            asset_id = create_asset(user_id, asset_data)
            if asset_id:
                asset_ids.append(asset_id)
            
            logger.info(f"[EnhanceStyle] 上传结果 {i+1}/{len(result.output_urls)}: {storage_url[:60]}...")
            
        except Exception as e:
            logger.error(f"[EnhanceStyle] 下载/上传结果 {i} 失败: {e}")
            # 继续处理其他结果，不中断
    
    if not uploaded_urls:
        raise RuntimeError("所有结果下载/上传均失败")
    
    # Step 5: 完成
    update_ai_task(
        task_id,
        status="completed",
        progress=100,
        output_asset_id=asset_ids[0] if asset_ids else None,
        output_url=uploaded_urls[0],
        metadata={
            "capability_id": capability_id,
            "output_urls": uploaded_urls,
            "asset_ids": asset_ids,
            "variant_count": len(uploaded_urls),
            "engine_metadata": result.metadata,
        },
    )
    
    logger.info(
        f"[EnhanceStyle] 任务完成: task_id={task_id}, "
        f"capability={capability_id}, variants={len(uploaded_urls)}"
    )
    
    return {
        "task_id": task_id,
        "capability_id": capability_id,
        "asset_ids": asset_ids,
        "output_urls": uploaded_urls,
    }
