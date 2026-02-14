"""
数字人确认肖像生成

用户上传照片后，AI 生成 4 张白底标准化肖像供用户确认"AI 是否理解了我的外貌"。

支持两种引擎（前端页面选择，通过 API 参数传入）:
  - "doubao": Seedream 4.0 多图参考生图（同步/SSE，2K，无需轮询）
  - "kling":  Omni-Image 多图编辑（异步轮询，2k）

流程:
  1. 接收 source_image_urls (1-N 张用户上传照片)
  2. 根据配置选择 Doubao Seedream 或 Kling omni-image
  3. 收集 4 张白底肖像 URL
  4. 持久化到 Supabase Storage
  5. 回写 tasks 表结果

设计原则:
  - 走 tasks 表，前端用 getAITaskStatus 轮询
  - 不消耗积分（创建数字人的基础成本）
  - 生成失败不阻塞用户（可重试）
  - Doubao 失败时自动 fallback 到 Kling
"""

import asyncio
import logging
import os
import tempfile
from typing import Dict, List

import httpx

from ..celery_config import celery_app
from ..services.kling_ai_service import kling_client

logger = logging.getLogger(__name__)

STORAGE_BUCKET = "ai-creations"


# ============================================
# 辅助函数
# ============================================

def _get_supabase():
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


async def _persist_images_to_storage(
    image_urls: List[str],
    user_id: str,
    task_id: str,
) -> List[str]:
    """
    将 Kling CDN 图片下载并上传到 Supabase Storage，返回持久化 URL 列表。
    CDN URL 约 30 天过期，必须持久化到自有存储。
    """
    persistent_urls: List[str] = []
    for i, cdn_url in enumerate(image_urls):
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp_path = tmp.name

            await _download_file(cdn_url, tmp_path)

            storage_path = f"avatars/{user_id}/{task_id}_confirm_{i}.png"
            public_url = _upload_to_storage(tmp_path, storage_path)
            persistent_urls.append(public_url)

            logger.info(
                f"[AvatarConfirm] 图片 {i} 已持久化: {storage_path}"
            )
        except Exception as e:
            logger.warning(
                f"[AvatarConfirm] 图片 {i} 持久化失败，保留 CDN URL: {e}"
            )
            persistent_urls.append(cdn_url)  # 降级：保留 CDN URL
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    return persistent_urls


def _update_task(task_id: str, **updates):
    """更新 tasks 表"""
    from datetime import datetime
    updates["updated_at"] = datetime.utcnow().isoformat()
    try:
        _get_supabase().table("tasks").update(updates).eq("id", task_id).execute()
    except Exception as e:
        logger.error(f"[AvatarConfirm] 更新任务状态失败: {e}")


# ── 5-Section Realism Prompt Framework ──────────────────────────
# 按权重排列：摄影媒介 > 身份还原 > 真实感引擎 > 光影构图 > 背景
# 核心武器是 [3] Realism Engine —— 毛孔/绒毛/油光 打破 AI 塑料感
# ────────────────────────────────────────────────────────────────

OMNI_PORTRAIT_PROMPT_TEMPLATE = (
    # [1] Photography Style & Medium  — 最高权重，把模型拉向纪实摄影
    "Candid 35mm film photograph of the person in {refs}. "
    "RAW photo, Kodak Portra 400 film stock. "
    "85mm portrait lens, f/2.8, high shutter speed, tack-sharp focus on eyes. "
    "Unedited, no retouching, no airbrushing, subtle film grain, realistic color science. "
    # [2] Subject & Identity  — 严格还原参考照片
    "Maintain EXACT identity from reference: face shape, eye shape and color, "
    "nose structure, lip shape, eyebrow thickness, skin tone, freckles, moles, "
    "hairstyle, hair color, and all distinguishing features. "
    "Minimal makeup, natural lash line, hydrated lips. "
    # [3] Realism Engine  — 反塑料核心（MANDATORY）
    "Hyper-realistic skin texture: visible pores and fine lines on close inspection, "
    "natural vellus hair (peach fuzz) visible under side light, "
    "subtle skin oil and sheen on the T-zone (not matte), "
    "authentic micro-imperfections — slight redness around nose and under eyes. "
    "Realistic hair: natural flyaways and stray hairs at the hairline, "
    "individual strands catching light with translucent glow. "
    # [4] Lighting & Composition  — 侧光让皮肤纹理"活"起来
    "Side key light at 45 degrees with soft fill, creates soft shadows defining "
    "facial bone structure, authentic specular highlights on the T-zone, "
    "subtle rim light for hair separation from background. "
    "Centered close-up head and shoulders, eye-level angle, "
    "natural relaxed expression with a hint of a gentle smile. "
    # [5] Background  — 干净可控
    "Solid plain white background, high-key studio, "
    "shallow depth of field, natural shadow cast by the subject. "
    "No accessories unless present in ALL reference photos."
)

# Doubao Seedream 4.0 — 同样 5 层框架，中文版
# Seedream 用「图1」「图2」引用 image 数组中的图片
DOUBAO_PORTRAIT_PROMPT_TEMPLATE = (
    # [1] 摄影风格与媒介 — 权重最高，引导模型远离美颜权重
    "纪实风格35mm胶片摄影，参考{refs}中的人物。"
    "RAW底片，柯达Portra 400胶片质感。"
    "85mm人像镜头，f/2.8光圈，高速快门，眼部精准对焦。"
    "未经修图，无磨皮无美颜，微妙胶片颗粒感，真实色彩还原。"
    # [2] 主体身份 — 严格还原
    "严格保持参考照片中的所有面部特征：脸型、眼睛形状和颜色、"
    "鼻子结构、嘴唇形状、眉毛粗细、肤色、雀斑、痣、"
    "发型、发色等所有辨识特征。淡妆或素颜，自然睫毛，真实眉形。"
    # [3] 真实感引擎 — 反塑料核心（必须包含）
    "超写实皮肤质感（必须）：近距离可见毛孔和细纹，"
    "侧光下可见面部绒毛（桃子绒毛），"
    "T区自然的皮肤油光和光泽（非哑光），真实的皮肤微瑕疵，"
    "鼻翼和眼周微微泛红增强真实感。"
    "真实头发：发际线自然的碎发和飞丝，发丝捕捉光线呈现半透明光泽。"
    # [4] 光影与构图 — 侧光凸显皮肤纹理
    "45度侧面主光配合柔和补光，营造面部骨骼结构的明暗过渡，"
    "T区自然高光反射，发丝轮廓光与背景分离。"
    "正面居中头肩构图，平视角度，"
    "自然放松的表情，略带温和微笑。"
    "生成一组共4张，每张表情和头部角度略有不同。"
    # [5] 背景环境 — 干净可控
    "纯白色背景，高调影棚风格，"
    "浅景深虚化，人物投射自然阴影。"
    "不要添加参考照片中没有的饰品或配件。"
)


# ============================================
# Celery Task
# ============================================

@celery_app.task(
    bind=True,
    name="app.tasks.avatar_confirm_portraits.generate_confirm_portraits",
    queue="gpu",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_kwargs={"max_retries": 2},
    soft_time_limit=600,
    time_limit=900,
)
def generate_confirm_portraits(
    self,
    task_id: str,
    source_image_urls: List[str],
    user_id: str,
    engine: str = "doubao",
):
    """
    为数字人创建流程生成 4 张白底确认肖像

    Args:
        task_id: tasks 表的任务 ID（前端用此 ID 轮询）
        source_image_urls: 用户上传的照片 URL 列表（1-N 张）
        user_id: 用户 ID
        engine: 生成引擎 "doubao" 或 "kling"（前端选择）
    """
    logger.info(
        f"[AvatarConfirm] 开始生成确认肖像: task={task_id}, "
        f"源图 {len(source_image_urls)} 张"
    )

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            _generate_confirm_async(task_id, source_image_urls, user_id, engine)
        )
        return result
    finally:
        # 正确关闭 async generators，避免 "Task was destroyed but it is pending!" 警告
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()


async def _generate_confirm_async(
    task_id: str,
    source_image_urls: List[str],
    user_id: str,
    engine: str = "doubao",
) -> Dict:
    """异步执行确认肖像生成，支持 Doubao / Kling 双引擎"""

    from datetime import datetime

    try:
        # Step 1: 更新状态为处理中
        _update_task(
            task_id,
            status="processing",
            progress=5,
            status_message="AI 正在分析你的外貌特征…",
            started_at=datetime.utcnow().isoformat(),
        )

        # Step 2: 选择引擎
        image_urls = None

        if engine == "doubao":
            logger.info(f"[AvatarConfirm] 使用 Doubao Seedream 引擎")
            _update_task(
                task_id,
                progress=10,
                status_message="AI 正在生成你的数字人形象…",
            )
            try:
                image_urls = await _submit_doubao_image(source_image_urls)
            except Exception as e:
                logger.warning(
                    f"[AvatarConfirm] Doubao 引擎异常，fallback 到 Kling: {e}"
                )
                image_urls = None

            # Doubao 返回空结果（无异常但 0 张图）→ fallback 到 Kling
            if not image_urls:
                logger.warning("[AvatarConfirm] Doubao 返回空结果，fallback 到 Kling")
                engine = "kling"

        if engine == "kling" and not image_urls:
            logger.info(f"[AvatarConfirm] 使用 Kling omni-image 引擎")
            provider_task_id = await _submit_omni_image(source_image_urls)

            if not provider_task_id:
                _update_task(
                    task_id,
                    status="failed",
                    error_message="提交 AI 任务失败",
                    completed_at=datetime.utcnow().isoformat(),
                )
                return {"success": False, "reason": "submit_failed"}

            _update_task(
                task_id,
                provider_task_id=provider_task_id,
                progress=20,
                status_message="AI 正在生成你的数字人形象…",
            )

            # 轮询 Kling 任务
            image_urls = await _poll_for_results(provider_task_id, task_id)

        if not image_urls:
            _update_task(
                task_id,
                status="failed",
                error_message="生成完成但未获取到图片",
                completed_at=datetime.utcnow().isoformat(),
            )
            return {"success": False, "reason": "no_images"}

        # Step 3: 持久化图片到 Supabase Storage
        _update_task(
            task_id,
            progress=85,
            status_message="正在保存图片…",
        )
        image_urls = await _persist_images_to_storage(image_urls, user_id, task_id)

        # Step 4: 更新任务为完成
        _update_task(
            task_id,
            status="completed",
            progress=100,
            status_message=f"已生成 {len(image_urls)} 张确认肖像",
            output_url=image_urls[0],
            metadata={"images": [{"url": url} for url in image_urls], "engine": engine},
            completed_at=datetime.utcnow().isoformat(),
        )

        logger.info(
            f"[AvatarConfirm] task={task_id} 完成: {len(image_urls)} 张肖像 (engine={engine})"
        )
        return {
            "success": True,
            "task_id": task_id,
            "image_urls": image_urls,
            "engine": engine,
        }

    except Exception as e:
        logger.error(f"[AvatarConfirm] task={task_id} 失败: {e}")
        _update_task(
            task_id,
            status="failed",
            error_message=str(e),
            completed_at=datetime.utcnow().isoformat(),
        )
        raise


async def _submit_omni_image(source_urls: List[str]) -> str | None:
    """Kling omni-image 引擎：多图参考生成 4 张肖像（异步轮询模式）"""
    try:
        image_refs = " and ".join(
            f"<<<image_{i + 1}>>>" for i in range(len(source_urls))
        )
        prompt = OMNI_PORTRAIT_PROMPT_TEMPLATE.format(refs=image_refs)
        image_list = [{"image": url} for url in source_urls]

        result = await kling_client.create_omni_image_task(
            prompt=prompt,
            image_list=image_list,
            options={
                "model_name": "kling-image-o1",
                "resolution": "2k",
                "n": 4,
                "aspect_ratio": "3:4",
            },
        )

        if result.get("code") != 0:
            logger.warning(
                f"[AvatarConfirm] omni_image 提交失败: "
                f"code={result.get('code')}, msg={result.get('message')}"
            )
            return None

        task_id = result.get("data", {}).get("task_id")
        logger.info(f"[AvatarConfirm] omni_image 已提交: {task_id}")
        return task_id

    except Exception as e:
        logger.error(f"[AvatarConfirm] omni_image 提交异常: {e}")
        return None


async def _submit_doubao_image(source_urls: List[str]) -> List[str] | None:
    """
    Doubao Seedream 4.0 引擎：多图参考 + 连贯序列生成 4 张肖像。

    与 Kling 的关键差异:
      - 同步/SSE 返回，无需轮询
      - image 参数直接传 URL 数组
      - prompt 中用「图1」「图2」引用
      - 支持 2K 分辨率
      - sequential_image_generation 生成风格统一的一组图

    Returns:
        图片 URL 列表（4 张），失败返回 None
    """
    from ..services.doubao_image_service import get_doubao_image_service

    try:
        service = get_doubao_image_service()

        # 构建参考图引用
        refs = "、".join(f"图{i + 1}" for i in range(len(source_urls)))
        prompt = DOUBAO_PORTRAIT_PROMPT_TEMPLATE.format(refs=refs)

        # 多图参考 + 连贯序列生成
        result = await service.generate(
            prompt=prompt,
            image=source_urls if len(source_urls) > 1 else source_urls[0],
            sequential=True,
            max_images=4,
            size="2K",
            watermark=False,
        )

        images = result.get("images", [])
        urls = [img["url"] for img in images if img.get("url")]

        if not urls:
            logger.warning("[AvatarConfirm] Doubao 返回 0 张图片")
            return None

        logger.info(f"[AvatarConfirm] Doubao 返回 {len(urls)} 张图片")
        return urls

    except Exception as e:
        logger.error(f"[AvatarConfirm] Doubao 引擎异常: {e}")
        return None


async def _poll_for_results(
    provider_task_id: str,
    our_task_id: str,
    max_polls: int = 60,
    poll_interval: int = 5,
) -> List[str]:
    """轮询 Kling omni-image 任务，收集结果图片 URL"""
    for poll_round in range(max_polls):
        await asyncio.sleep(poll_interval)

        try:
            query = await kling_client.get_omni_image_task(provider_task_id)

            if query.get("code") != 0:
                logger.warning(
                    f"[AvatarConfirm] 轮询返回 code={query.get('code')}: "
                    f"{query.get('message')}"
                )
                continue

            task_data = query.get("data", {})
            status = task_data.get("task_status")

            if status == "succeed":
                images = task_data.get("task_result", {}).get("images", [])
                urls = [img["url"] for img in images if img.get("url")]
                return urls
            elif status == "failed":
                error_msg = task_data.get("task_status_msg", "unknown")
                logger.warning(f"[AvatarConfirm] Kling 任务失败: {error_msg}")
                return []

            # 进度更新
            if poll_round % 4 == 0:
                progress = min(20 + poll_round * 1.2, 90)
                _update_task(
                    our_task_id,
                    progress=int(progress),
                    status_message="AI 正在生成中…",
                )

        except Exception as e:
            logger.warning(f"[AvatarConfirm] 轮询异常: {e}")

    logger.warning(f"[AvatarConfirm] 轮询超时: provider_task={provider_task_id}")
    return []
