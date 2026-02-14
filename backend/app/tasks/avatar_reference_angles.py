"""
数字人多角度参考图自动生成

当用户创建数字人形象（上传或 AI 生成正面照）后，
后台自动用 Kling image_generation + subject reference
生成 2-3 张不同角度的补充参考图，写入 reference_images 字段。

流程:
  1. 接收 avatar_id + portrait_url
  2. 并发提交 3 个 Kling image_generation 任务（3 种角度 prompt）
  3. 统一轮询等待完成
  4. 收集成功的图片 URL
  5. 回写 digital_avatar_templates.reference_images

设计原则:
  - 静默后台任务，用户无感知（无需等待）
  - 部分失败不影响其他：3 张中成功几张写几张
  - 不依赖回调链路，全部用轮询（任务内部处理，不需要实时反馈）
"""

import asyncio
import logging
import os
import tempfile
from typing import Dict, List, Optional

import httpx

from ..celery_config import celery_app
from ..services.kling_ai_service import kling_client

logger = logging.getLogger(__name__)

STORAGE_BUCKET = "ai-creations"


# ============================================
# 角度 prompt 定义
# ============================================

# 每个角度的 prompt — 保持同一人、不同视角
# 通过 image_reference: "subject" + 高 image_fidelity 确保人物一致
ANGLE_PROMPTS = [
    {
        "key": "three_quarter_left",
        "prompt": (
            "Same person, three-quarter view turned slightly to the left, "
            "natural soft lighting, neutral background, "
            "photorealistic, 85mm portrait lens, shallow depth of field, "
            "visible skin texture and pores, no retouching"
        ),
    },
    {
        "key": "profile_right",
        "prompt": (
            "Same person, right profile view showing side of face, "
            "natural window light, neutral background, "
            "photorealistic, 85mm portrait lens, "
            "visible skin texture, natural hair detail, no retouching"
        ),
    },
    {
        "key": "slight_above",
        "prompt": (
            "Same person, slightly elevated camera angle looking down, "
            "gentle overhead natural lighting, neutral background, "
            "photorealistic, 50mm lens, "
            "visible skin pores, natural expression, no retouching"
        ),
    },
]


def _get_supabase():
    """延迟导入避免循环依赖"""
    from ..services.supabase_client import supabase
    return supabase


async def _download_file(url: str, dest_path: str) -> str:
    """下载文件到本地临时路径"""
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        with open(dest_path, "wb") as f:
            f.write(response.content)
    return dest_path


def _upload_to_storage(file_path: str, storage_path: str, content_type: str = "image/png") -> str:
    """上传文件到 Supabase Storage，返回持久化公开 URL"""
    supabase = _get_supabase()
    with open(file_path, "rb") as f:
        file_data = f.read()
    supabase.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        file_data,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)


async def _persist_image_to_storage(
    cdn_url: str,
    user_id: str,
    avatar_id: str,
    angle_key: str,
) -> str:
    """
    将单张 Kling CDN 图片持久化到 Supabase Storage。
    CDN URL ~30 天过期，必须持久化到自有存储。
    失败时降级返回原始 CDN URL。
    """
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = tmp.name

        await _download_file(cdn_url, tmp_path)

        storage_path = f"avatars/{user_id}/{avatar_id}_angle_{angle_key}.png"
        public_url = _upload_to_storage(tmp_path, storage_path)
        logger.info(f"[AvatarAngles] {angle_key} 已持久化: {storage_path}")
        return public_url

    except Exception as e:
        logger.warning(
            f"[AvatarAngles] {angle_key} 持久化失败，保留 CDN URL: {e}"
        )
        return cdn_url  # 降级：保留 CDN URL
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ============================================
# Celery Task
# ============================================

@celery_app.task(
    bind=True,
    name="app.tasks.avatar_reference_angles.generate_reference_angles",
    queue="gpu",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_kwargs={"max_retries": 2},
    soft_time_limit=600,
    time_limit=900,
)
def generate_reference_angles(
    self,
    avatar_id: str,
    portrait_url: str,
    user_id: str,
):
    """
    为数字人形象自动生成多角度参考图

    Args:
        avatar_id: 数字人形象 ID
        portrait_url: 用户上传/生成的正面照 URL（作为 subject reference）
        user_id: 创建者 user_id（用于日志追踪）
    """
    logger.info(
        f"[AvatarAngles] 开始为 avatar={avatar_id} 生成多角度参考图, "
        f"portrait={portrait_url[:60]}..."
    )

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            _generate_angles_async(avatar_id, portrait_url, user_id)
        )
        return result
    finally:
        loop.close()


async def _generate_angles_async(
    avatar_id: str,
    portrait_url: str,
    user_id: str,
) -> Dict:
    """
    异步执行多角度生成

    步骤:
      1. 并发提交 3 个 Kling 任务
      2. 统一轮询等待
      3. 收集结果 URL
      4. 回写 DB
    """

    # ---- Step 1: 并发提交 ----
    tasks_submitted: List[Dict] = []

    for angle in ANGLE_PROMPTS:
        try:
            result = await kling_client.create_image_generation_task(
                prompt=angle["prompt"],
                image=portrait_url,
                image_reference="subject",
                options={
                    "model_name": "kling-v2-1",
                    "image_fidelity": 0.75,   # 高保真度确保人物一致
                    "human_fidelity": 0.80,    # 高人脸保真
                    "resolution": "1k",        # 1k 足够做 reference，省成本
                    "n": 1,                    # 每个角度只生成 1 张
                    "aspect_ratio": "3:4",     # 竖版人像
                },
            )

            if result.get("code") != 0:
                logger.warning(
                    f"[AvatarAngles] {angle['key']} 提交失败: "
                    f"{result.get('message')}"
                )
                continue

            provider_task_id = result.get("data", {}).get("task_id")
            if provider_task_id:
                tasks_submitted.append({
                    "key": angle["key"],
                    "provider_task_id": provider_task_id,
                })
                logger.info(
                    f"[AvatarAngles] {angle['key']} 已提交: "
                    f"task_id={provider_task_id}"
                )

        except Exception as e:
            logger.warning(f"[AvatarAngles] {angle['key']} 提交异常: {e}")

    if not tasks_submitted:
        logger.error(f"[AvatarAngles] avatar={avatar_id} 所有角度提交失败")
        return {"success": False, "avatar_id": avatar_id, "reason": "all_submit_failed"}

    logger.info(
        f"[AvatarAngles] 已提交 {len(tasks_submitted)}/{len(ANGLE_PROMPTS)} 个角度任务"
    )

    # ---- Step 2: 统一轮询 ----
    max_polls = 60       # 最多 5 分钟
    poll_interval = 5    # 每 5 秒

    completed_urls: List[str] = []
    # 🆕 角度→URL 映射，用于动态角度选择
    angle_url_map: Dict[str, str] = {}
    pending = list(tasks_submitted)

    for poll_round in range(max_polls):
        if not pending:
            break

        await asyncio.sleep(poll_interval)

        still_pending = []
        for task_info in pending:
            try:
                query = await kling_client.get_image_generation_task(
                    task_info["provider_task_id"]
                )

                if query.get("code") != 0:
                    still_pending.append(task_info)
                    continue

                task_data = query.get("data", {})
                status = task_data.get("task_status")

                if status == "succeed":
                    # 提取生成的图片 URL
                    images = task_data.get("task_result", {}).get("images", [])
                    for img in images:
                        url = img.get("url")
                        if url:
                            # 持久化到 Supabase Storage（CDN URL ~30天过期）
                            persistent_url = await _persist_image_to_storage(
                                url, user_id, avatar_id, task_info["key"]
                            )
                            completed_urls.append(persistent_url)
                            angle_url_map[task_info["key"]] = persistent_url
                            logger.info(
                                f"[AvatarAngles] {task_info['key']} 完成: {persistent_url[:60]}..."
                            )
                elif status == "failed":
                    error_msg = task_data.get("task_status_msg", "unknown")
                    logger.warning(
                        f"[AvatarAngles] {task_info['key']} 生成失败: {error_msg}"
                    )
                else:
                    # 仍在处理中
                    still_pending.append(task_info)

            except Exception as e:
                logger.warning(
                    f"[AvatarAngles] 轮询 {task_info['key']} 异常: {e}"
                )
                still_pending.append(task_info)

        pending = still_pending

        if poll_round % 6 == 0:  # 每 30 秒打一次日志
            logger.info(
                f"[AvatarAngles] 轮询 {poll_round + 1}/{max_polls}, "
                f"完成={len(completed_urls)}, 待处理={len(pending)}"
            )

    # 超时的任务视为失败
    if pending:
        logger.warning(
            f"[AvatarAngles] {len(pending)} 个角度任务超时: "
            f"{[t['key'] for t in pending]}"
        )

    # ---- Step 3: 回写 DB ----
    # reference_images = [原始正面照] + [生成的角度图]（保持平铺列表，omni_image 等需要）
    reference_images = [portrait_url] + completed_urls

    # 🆕 构建角度→URL 映射（包含原始正面照）
    # 用于动态角度选择：根据用户 prompt 意图选最匹配的参考图
    reference_angle_map = {"front": portrait_url}
    reference_angle_map.update(angle_url_map)

    try:
        supabase = _get_supabase()

        # 先读取现有的 generation_config，合并写入
        existing = supabase.table("digital_avatar_templates").select(
            "generation_config"
        ).eq("id", avatar_id).execute()

        gen_config = {}
        if existing.data and existing.data[0].get("generation_config"):
            gen_config = existing.data[0]["generation_config"]
        gen_config["reference_angle_map"] = reference_angle_map

        supabase.table("digital_avatar_templates").update({
            "reference_images": reference_images,
            "generation_config": gen_config,
        }).eq("id", avatar_id).execute()

        logger.info(
            f"[AvatarAngles] avatar={avatar_id} 参考图已更新: "
            f"{len(reference_images)} 张 (原图 + {len(completed_urls)} 角度)"
        )
    except Exception as e:
        logger.error(f"[AvatarAngles] 回写 DB 失败: {e}")
        return {
            "success": False,
            "avatar_id": avatar_id,
            "reason": "db_write_failed",
            "urls": reference_images,
        }

    return {
        "success": True,
        "avatar_id": avatar_id,
        "reference_images": reference_images,
        "angles_generated": len(completed_urls),
        "angles_failed": len(ANGLE_PROMPTS) - len(completed_urls),
    }
