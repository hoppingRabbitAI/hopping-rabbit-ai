"""
Lepus AI - Doubao Seedream 4.0 图像生成 Celery 任务

与 omni_image.py 结构一致，但调用豆包 Ark API（同步/SSE）。
任务流程:
  1. 调用 DoubaoImageService.generate() 获取图片 URL
  2. 下载图片到临时文件
  3. 上传到 Supabase Storage
  4. 创建 Asset 记录
  5. 更新任务状态
"""
import os
import asyncio
import logging
import tempfile
from datetime import datetime
from typing import Dict, List, Optional
from uuid import uuid4

from ..celery_config import celery_app

logger = logging.getLogger(__name__)

# ============================================
# 复用 omni_image 的通用工具函数
# ============================================

from ..tasks.omni_image import (
    update_ai_task,
    update_ai_task_progress,
    update_ai_task_status,
    download_file,
    upload_to_storage,
    create_asset_record,
)


# ============================================
# Celery 任务
# ============================================

@celery_app.task(
    bind=True,
    name="app.tasks.doubao_image.process_doubao_image",
    queue="gpu",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=300,   # 5 分钟软超时（Doubao 同步返回，比 Kling 快）
    time_limit=600,        # 10 分钟硬超时
)
def process_doubao_image(
    self,
    ai_task_id: str,
    user_id: str,
    prompt: str,
    negative_prompt: str = "",
    image: Optional[object] = None,
    options: Dict = None,
):
    """
    Doubao Seedream 4.0 图像生成 Celery 任务

    Args:
        ai_task_id: 任务 ID
        user_id: 用户 ID
        prompt: 提示词
        negative_prompt: 负面提示词
        image: 参考图 — string(单张) / list(多张) / None(纯文生图)
        options: 可选参数
            - sequential: bool — 是否生成连贯一组
            - max_images: int — 连贯生成最多几张
            - size: str — 图片尺寸
    """
    options = options or {}

    logger.info(f"[DoubaoImage] 开始处理任务: {ai_task_id}")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        result = loop.run_until_complete(
            _process_doubao_image_async(
                ai_task_id=ai_task_id,
                user_id=user_id,
                prompt=prompt,
                negative_prompt=negative_prompt,
                image=image,
                options=options,
            )
        )
        return result
    finally:
        loop.close()


async def _process_doubao_image_async(
    ai_task_id: str,
    user_id: str,
    prompt: str,
    negative_prompt: str,
    image: Optional[object],
    options: Dict,
) -> Dict:
    """Doubao 图像生成异步处理"""

    try:
        # Step 1: 更新状态
        update_ai_task_status(ai_task_id, "processing")
        update_ai_task_progress(ai_task_id, 10, "提交生成请求")

        # Step 2: 调用 Doubao API
        from ..services.doubao_image_service import get_doubao_image_service
        service = get_doubao_image_service()

        sequential = options.get("sequential", False)
        max_images = options.get("max_images", 1)
        size = options.get("size", "2K")

        update_ai_task_progress(ai_task_id, 20, "AI 生成中")

        result = await service.generate(
            prompt=prompt,
            negative_prompt=negative_prompt or None,
            image=image,
            sequential=sequential,
            max_images=max_images,
            size=size,
        )

        images = result.get("images", [])
        if not images:
            raise ValueError("Doubao 返回结果中没有图片")

        logger.info(f"[DoubaoImage] 生成了 {len(images)} 张图片")

        # Step 3: 下载并上传
        update_ai_task_progress(ai_task_id, 70, f"下载生成结果 ({len(images)} 张)")

        uploaded_images = []
        first_asset_id = None
        first_url = None

        for img in images:
            img_index = img.get("index", 0)
            img_url = img.get("url")
            if not img_url:
                continue

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp_path = tmp.name

            await download_file(img_url, tmp_path)

            storage_path = f"ai_generated/{user_id}/{ai_task_id}_doubao_{img_index}.png"
            final_url = upload_to_storage(tmp_path, storage_path, "image/png")

            os.unlink(tmp_path)

            asset_id = create_asset_record(
                user_id=user_id,
                storage_path=storage_path,
                ai_task_id=ai_task_id,
                asset_type="image",
            )

            uploaded_images.append({
                "index": img_index,
                "url": final_url,
                "asset_id": asset_id,
            })

            if first_asset_id is None:
                first_asset_id = asset_id
                first_url = final_url

        # Step 4: 完成
        update_ai_task_status(
            ai_task_id,
            status="completed",
            output_url=first_url,
            output_asset_id=first_asset_id,
            result_metadata={
                "provider": "doubao",
                "total_images": len(uploaded_images),
                "images": uploaded_images,
            },
        )

        logger.info(f"[DoubaoImage] 任务完成: {ai_task_id}, 共 {len(uploaded_images)} 张图片")

        return {
            "success": True,
            "ai_task_id": ai_task_id,
            "output_url": first_url,
            "output_asset_id": first_asset_id,
            "images": uploaded_images,
        }

    except Exception as e:
        logger.error(f"[DoubaoImage] 任务失败: {ai_task_id}, error={e}")

        update_ai_task_status(
            ai_task_id,
            status="failed",
            error_code="PROCESSING_ERROR",
            error_message=str(e),
        )

        raise
