"""
Lepus AI - AI换脸 Celery 任务（基于 Omni-Image）
通过 Omni-Image 的 face reference 能力实现换脸

原理：
  将源图片和目标人脸照片作为 image_list 传入 Omni-Image，
  通过 prompt 指导模型保持场景不变、只替换人脸。
  
链路：
  图→图: source_image + face_image → omni-image → 换脸图片
  图→视频（可选）: 换脸图片 → image2video → 动态视频

应用场景：
- 批量生成不同数字人版本
- 隐私保护：用数字人替代真人
- A/B 测试不同形象的播放效果
- 模板使用：上传照片 → 替换模板中的人脸
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
from ..services.kling_ai_service import kling_client

logger = logging.getLogger(__name__)

STORAGE_BUCKET = "ai-creations"

# 换脸 prompt 模板（英文 prompt 效果更好，尤其对真实照片）
FACE_SWAP_PROMPT = (
    "Keep the scene, composition, pose, clothing, hairstyle, and background of <<<image_1>>> completely unchanged. "
    "Replace ONLY the face of the person in <<<image_1>>> with the face from <<<image_2>>>. "
    "Maintain consistent lighting, natural skin texture, realistic facial details, and seamless blending. "
    "Preserve the original head angle, expression intensity, and shadow direction. "
    "The result must look like a real unedited photograph with no artifacts or uncanny valley effect."
)

FACE_SWAP_PROMPT_WITH_CUSTOM = (
    "Keep the scene, composition, pose, clothing, hairstyle, and background of <<<image_1>>> completely unchanged. "
    "Replace ONLY the face of the person in <<<image_1>>> with the face from <<<image_2>>>. "
    "Maintain consistent lighting, natural skin texture, realistic facial details, and seamless blending. "
    "Preserve the original head angle, expression intensity, and shadow direction. "
    "The result must look like a real unedited photograph with no artifacts or uncanny valley effect. "
    "Additional requirements: {custom_prompt}"
)


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
        logger.error(f"[FaceSwap] 更新任务状态失败: {e}")


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
    error_message: str = None,
    result_metadata: Dict = None
):
    """更新任务最终状态"""
    updates = {"status": status}
    if status == "processing":
        updates["started_at"] = datetime.utcnow().isoformat()
    elif status in ("completed", "failed"):
        updates["completed_at"] = datetime.utcnow().isoformat()
    if output_url:
        updates["output_url"] = output_url
    if output_asset_id:
        updates["output_asset_id"] = output_asset_id
    if error_message:
        updates["error_message"] = error_message
    if result_metadata:
        updates["metadata"] = result_metadata
    if status == "completed":
        updates["progress"] = 100
    update_ai_task(task_id, **updates)


# ============================================
# 文件操作
# ============================================

async def download_file(url: str, dest_path: str) -> str:
    """下载文件到本地"""
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        with open(dest_path, "wb") as f:
            f.write(response.content)
    return dest_path


def upload_to_storage(file_path: str, storage_path: str, content_type: str = "image/png") -> str:
    """上传文件到 Supabase Storage"""
    supabase = _get_supabase()
    with open(file_path, "rb") as f:
        file_data = f.read()
    supabase.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        file_data,
        file_options={"content-type": content_type, "upsert": "true"}
    )
    return supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)


def create_asset_record(
    user_id: str,
    storage_path: str,
    ai_task_id: str,
    asset_type: str = "image",
) -> str:
    """创建 Asset 记录"""
    supabase = _get_supabase()
    asset_id = str(uuid4())
    now = datetime.utcnow().isoformat()

    if asset_type == "image":
        ext, file_type, mime_type = ".png", "image", "image/png"
    else:
        ext, file_type, mime_type = ".mp4", "video", "video/mp4"

    asset_data = {
        "id": asset_id,
        "project_id": None,
        "user_id": user_id,
        "name": f"AI换脸_{datetime.now().strftime('%Y%m%d_%H%M%S')}{ext}",
        "original_filename": f"ai_face_swap{ext}",
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
    return asset_id


# ============================================
# Celery 任务
# ============================================

@celery_app.task(
    bind=True,
    name="tasks.face_swap.process_face_swap",
    queue="gpu",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=600,
    time_limit=900,
)
def process_face_swap(
    self,
    task_id: str,
    user_id: str,
    source_image_url: str,
    face_image_url: str,
    options: Dict = None
):
    """
    AI换脸任务入口（基于 Omni-Image）
    
    Args:
        task_id: 任务 ID
        user_id: 用户 ID
        source_image_url: 源图片 URL（要被换脸的图片）
        face_image_url: 目标人脸图片 URL
        options: 可选参数
            - custom_prompt: 额外提示词
            - resolution: 清晰度 1k/2k
            - generate_video: 是否在换脸后生成视频（图→视频联动）
            - video_prompt: 视频生成的提示词
            - video_duration: 视频时长 "5" 或 "10"
    """
    options = options or {}
    logger.info(f"[FaceSwap] 开始处理任务: task_id={task_id}")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            _process_face_swap_async(task_id, user_id, source_image_url, face_image_url, options)
        )
        return result
    except Exception as e:
        logger.error(f"[FaceSwap] 任务失败: {e}", exc_info=True)
        update_ai_task_status(task_id, "failed", error_message=str(e))
        raise
    finally:
        loop.close()


async def _process_face_swap_async(
    task_id: str,
    user_id: str,
    source_image_url: str,
    face_image_url: str,
    options: Dict
) -> Dict:
    """
    AI换脸异步处理（基于 Omni-Image）
    
    流程:
    1. 构建 omni-image 请求（源图 + 人脸照片 → face reference prompt）
    2. 调用可灵 Omni-Image API
    3. 轮询任务状态
    4. 下载换脸结果图片
    5. 上传到 Supabase Storage + 创建 Asset
    6.（可选）将换脸图片通过 image2video 生成动态视频
    """
    try:
        # Step 1: 构建 Omni-Image 请求
        update_ai_task_status(task_id, "processing")
        update_ai_task_progress(task_id, 5, "准备换脸请求")

        custom_prompt = options.get("custom_prompt", "")
        if custom_prompt:
            prompt = FACE_SWAP_PROMPT_WITH_CUSTOM.format(custom_prompt=custom_prompt)
        else:
            prompt = FACE_SWAP_PROMPT

        # image_list: image_1 = 源图片（场景），image_2 = 目标人脸
        image_list = [
            {"image": source_image_url},
            {"image": face_image_url},
        ]

        omni_options = {
            "model_name": "kling-image-o1",
            "resolution": options.get("resolution", "1k"),
            "n": 1,
            "aspect_ratio": "auto",
        }

        logger.info(f"[FaceSwap] Step 1: 构建 Omni-Image 请求, prompt={prompt[:60]}...")
        update_ai_task_progress(task_id, 10, "提交换脸请求")

        # Step 2: 调用 Omni-Image API
        create_result = await kling_client.create_omni_image_task(
            prompt=prompt,
            image_list=image_list,
            options=omni_options
        )

        if create_result.get("code") != 0:
            raise ValueError(f"创建换脸任务失败: {create_result.get('message', '未知错误')}")

        provider_task_id = create_result.get("data", {}).get("task_id")
        if not provider_task_id:
            raise ValueError("创建任务失败：未返回 task_id")

        update_ai_task(task_id, provider_task_id=provider_task_id)
        logger.info(f"[FaceSwap] Step 2: Omni-Image 任务已创建: {provider_task_id}")

        # Step 3: 轮询任务状态
        update_ai_task_progress(task_id, 20, "AI 正在换脸")

        max_polls = 60
        poll_interval = 5
        task_result = None

        for i in range(max_polls):
            await asyncio.sleep(poll_interval)

            query_result = await kling_client.get_omni_image_task(provider_task_id)

            if query_result.get("code") != 0:
                logger.warning(f"[FaceSwap] 查询失败: {query_result.get('message')}")
                continue

            task_data = query_result.get("data", {})
            current_status = task_data.get("task_status")

            progress = 20 + int((i / max_polls) * 55)
            update_ai_task_progress(task_id, progress, f"AI 换脸: {current_status}")

            logger.info(f"[FaceSwap] 轮询 {i+1}/{max_polls}: status={current_status}")

            if current_status == "succeed":
                task_result = task_data
                break
            elif current_status == "failed":
                error_msg = task_data.get("task_status_msg", "未知错误")
                raise ValueError(f"AI 换脸失败: {error_msg}")
            elif current_status in ("submitted", "processing"):
                continue

        if task_result is None:
            raise TimeoutError(f"换脸任务超时：{max_polls * poll_interval} 秒后仍未完成")

        # Step 4: 获取结果图片
        images = task_result.get("task_result", {}).get("images", [])
        if not images:
            raise ValueError("AI 返回结果中没有图片")

        img_url = images[0].get("url")
        if not img_url:
            raise ValueError("图片 URL 为空")

        logger.info(f"[FaceSwap] Step 4: 获取换脸结果: {img_url[:80]}...")
        update_ai_task_progress(task_id, 80, "下载换脸结果")

        # Step 5: 下载并上传图片
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = tmp.name
        await download_file(img_url, tmp_path)

        storage_path = f"ai_generated/{user_id}/{task_id}_face_swap.png"
        final_url = upload_to_storage(tmp_path, storage_path, "image/png")
        os.unlink(tmp_path)

        asset_id = create_asset_record(
            user_id=user_id,
            storage_path=storage_path,
            ai_task_id=task_id,
            asset_type="image",
        )

        logger.info(f"[FaceSwap] Step 5: 上传完成, asset_id={asset_id}")
        update_ai_task_progress(task_id, 90, "换脸完成")

        # Step 6（可选）: image2video 联动
        generate_video = options.get("generate_video", False)
        video_url = None
        video_asset_id = None

        if generate_video:
            update_ai_task_progress(task_id, 92, "正在将换脸图片转为视频")
            try:
                video_result = await _generate_video_from_image(
                    task_id=task_id,
                    user_id=user_id,
                    image_url=final_url,
                    prompt=options.get("video_prompt", "The person makes subtle natural movements, gentle blinking, slight head turns, and a soft smile. Realistic and lifelike motion with natural breathing."),
                    duration=options.get("video_duration", "5"),
                )
                video_url = video_result.get("url")
                video_asset_id = video_result.get("asset_id")
                logger.info(f"[FaceSwap] Step 6: 视频生成完成, video_asset_id={video_asset_id}")
            except Exception as e:
                # 视频生成失败不影响换脸结果
                logger.warning(f"[FaceSwap] 视频联动失败（不影响换脸结果）: {e}")

        # 完成
        result_metadata = {
            "swap_image_url": final_url,
            "swap_image_asset_id": asset_id,
        }
        if video_url:
            result_metadata["video_url"] = video_url
            result_metadata["video_asset_id"] = video_asset_id

        update_ai_task_status(
            task_id,
            status="completed",
            output_url=final_url,
            output_asset_id=asset_id,
            result_metadata=result_metadata,
        )

        logger.info(f"[FaceSwap] 任务完成: task_id={task_id}, asset_id={asset_id}")

        return {
            "success": True,
            "task_id": task_id,
            "output_url": final_url,
            "output_asset_id": asset_id,
            "video_url": video_url,
            "video_asset_id": video_asset_id,
        }

    except Exception as e:
        logger.error(f"[FaceSwap] 处理失败: {e}", exc_info=True)
        update_ai_task_status(task_id, "failed", error_message=str(e))
        raise


async def _generate_video_from_image(
    task_id: str,
    user_id: str,
    image_url: str,
    prompt: str = "The person makes subtle natural movements, gentle blinking, slight head turns, and a soft smile. Realistic and lifelike motion with natural breathing.",
    duration: str = "5",
) -> Dict:
    """
    将换脸图片通过 image2video 生成动态视频（使用 omni 模型）
    
    用于换脸后的可选联动：静态换脸图 → 动态视频
    """
    logger.info(f"[FaceSwap] 开始 image2video 联动 (omni): image_url={image_url[:60]}...")

    # 调用 image2video（omni 模型效果更好）
    create_result = await kling_client.create_image_to_video_task(
        image_url=image_url,
        prompt=prompt,
        options={
            "duration": duration,
            "mode": "std",
            "model_name": "kling-video-o1",
        }
    )

    if create_result.get("code") != 0:
        raise ValueError(f"image2video 创建失败: {create_result.get('message', '未知错误')}")

    provider_task_id = create_result.get("data", {}).get("task_id")
    if not provider_task_id:
        raise ValueError("image2video 创建失败：未返回 task_id")

    # 轮询 image2video 任务
    max_polls = 120
    for i in range(max_polls):
        await asyncio.sleep(5)
        query_result = await kling_client.get_image_to_video_task(provider_task_id)

        if query_result.get("code") != 0:
            continue

        task_data = query_result.get("data", {})
        status = task_data.get("task_status")

        if i % 10 == 0:
            update_ai_task_progress(
                task_id,
                92 + int((i / max_polls) * 6),
                f"视频生成中: {status}"
            )

        if status == "succeed":
            videos = task_data.get("task_result", {}).get("videos", [])
            if not videos:
                raise ValueError("image2video 未返回视频")

            video_result_url = videos[0].get("url")
            if not video_result_url:
                raise ValueError("视频 URL 为空")

            # 下载并上传视频
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name
            await download_file(video_result_url, tmp_path)

            storage_path = f"ai_generated/{user_id}/{task_id}_face_swap_video.mp4"
            final_url = upload_to_storage(tmp_path, storage_path, "video/mp4")
            os.unlink(tmp_path)

            asset_id = create_asset_record(
                user_id=user_id,
                storage_path=storage_path,
                ai_task_id=task_id,
                asset_type="video",
            )

            return {"url": final_url, "asset_id": asset_id}

        elif status == "failed":
            error_msg = task_data.get("task_status_msg", "未知错误")
            raise ValueError(f"image2video 失败: {error_msg}")

    raise TimeoutError("image2video 任务超时")
