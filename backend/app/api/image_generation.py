"""
统一图像生成 API — 多 Provider 分发

单一入口 POST /api/image-generation，根据 provider 参数分发到不同引擎:
  - doubao  → Doubao Seedream 4.0 (火山方舟 Ark API)
  - kling   → Kling Image O1 (可灵 AI)
"""

import logging
from typing import Optional, List, Dict

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field

from .auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/image-generation", tags=["图像生成"])


# ============================================
# 请求模型
# ============================================

class ImageGenerationRequest(BaseModel):
    """统一图像生成请求"""
    provider: str = Field("doubao", description="模型提供商: doubao / kling")
    capability: str = Field("omni_image", description="能力类型: omni_image / face_swap / skin_enhance / relight / outfit_swap / ai_stylist / outfit_shot")
    prompt: str = Field("", description="提示词", max_length=2500)
    negative_prompt: str = Field("", description="负面提示词")

    # 参考图（通用）
    image_urls: Optional[List[str]] = Field(None, description="参考图 URL 列表")

    # 生成选项
    n: int = Field(1, ge=1, le=9, description="生成数量")
    aspect_ratio: str = Field("auto", description="画面比例")
    size: str = Field("2K", description="图片尺寸")

    # 数字人
    avatar_id: Optional[str] = Field(None, description="数字人角色 ID")

    # 各能力的专属参数（前端原样传入，后端根据 capability 解读）
    extra_params: Optional[Dict] = Field(None, description="能力专属参数")

    # Prompt 增强
    auto_enhance: bool = Field(True, description="是否自动增强 prompt（L2 兜底 + L3 LLM 改写）")
    platform: Optional[str] = Field(None, description="目标平台: douyin / xiaohongshu / bilibili / weibo")
    input_type: Optional[str] = Field(None, description="输入类型: ecommerce / selfie / street_snap / runway")


# ============================================
# 工具函数
# ============================================

def _get_supabase():
    from ..services.supabase_client import supabase
    return supabase


def _get_callback_url() -> Optional[str]:
    from ..config import get_settings
    settings = get_settings()
    if settings.callback_base_url:
        return f"{settings.callback_base_url}/api/callback/kling"
    return None


def _weave_prompt(capability: str, prompt: str, negative_prompt: str, extra_params: Optional[Dict]) -> str:
    """Weave final prompt from capability + extra_params (for Doubao)"""
    parts = []
    extra = extra_params or {}

    if capability == "omni_image":
        parts.append(prompt)
    elif capability == "face_swap":
        parts.append("Face swap: replace the face in the first image with the face from the second image, preserving lighting and expression.")
        if prompt:
            parts.append(prompt)
    elif capability == "skin_enhance":
        intensity_map = {"natural": "subtle natural", "moderate": "moderate", "max": "intensive"}
        intensity = intensity_map.get(extra.get("intensity", "natural"), "subtle natural")
        parts.append(f"Apply {intensity} skin retouching to the portrait, preserving facial features and skin texture.")
        if prompt:
            parts.append(prompt)
    elif capability == "relight":
        type_map = {"natural": "natural light", "studio": "professional studio lighting", "golden_hour": "golden hour warm sunlight",
                    "dramatic": "dramatic chiaroscuro lighting", "neon": "neon colored lighting", "soft": "soft diffused lighting"}
        dir_map = {"front": "front", "left": "left side", "right": "right side", "back": "behind", "top": "above", "bottom": "below"}
        light_type = type_map.get(extra.get("light_type", "natural"), "natural light")
        light_dir = dir_map.get(extra.get("light_direction", "front"), "front")
        intensity = extra.get("light_intensity", 0.7)
        parts.append(f"Relight the scene with {light_type} coming from {light_dir}, intensity {intensity:.0%}.")
        if extra.get("light_color"):
            parts.append(f"Light color: {extra['light_color']}.")
        if prompt:
            parts.append(prompt)
    elif capability == "outfit_swap":
        type_map = {"upper": "upper body garment", "lower": "lower body garment", "full": "full outfit"}
        garment = type_map.get(extra.get("garment_type", "upper"), "upper body garment")
        parts.append(f"Virtual try-on: replace the person's {garment} with the clothing from the second image, preserving body shape and pose.")
        if prompt:
            parts.append(prompt)
    elif capability == "ai_stylist":
        parts.append("Create a complete styling recommendation based on the uploaded clothing item.")
        if extra.get("style_tags"):
            parts.append(f"Style preferences: {', '.join(extra['style_tags'])}.")
        occasion_map = {"daily": "daily casual", "work": "office work", "date": "romantic date", "travel": "travel", "party": "party"}
        if extra.get("occasion"):
            parts.append(f"Occasion: {occasion_map.get(extra['occasion'], extra['occasion'])}.")
        season_map = {"spring": "spring", "summer": "summer", "autumn": "autumn", "winter": "winter"}
        if extra.get("season"):
            parts.append(f"Season: {season_map.get(extra['season'], extra['season'])}.")
        if extra.get("gender"):
            parts.append(f"Gender: {'male' if extra['gender'] == 'male' else 'female'}.")
        if prompt:
            parts.append(prompt)
    elif capability == "outfit_shot":
        mode_map = {"content": "content showcase", "try_on": "try-on effect"}
        content_map = {"cover": "cover hero image", "streetsnap": "street snap", "lifestyle": "lifestyle scene", "flat_lay": "flat lay arrangement", "comparison": "comparison layout"}
        platform_map = {"xiaohongshu": "Xiaohongshu (RED)", "douyin": "Douyin (TikTok)", "instagram": "Instagram", "custom": "custom"}
        mode = mode_map.get(extra.get("mode", "content"), "content showcase")
        content_type = content_map.get(extra.get("content_type", "cover"), "cover hero image")
        platform = platform_map.get(extra.get("platform_preset", "xiaohongshu"), "Xiaohongshu")
        parts.append(f"Generate a {platform}-style fashion {mode} image, format: {content_type}.")
        if extra.get("gender"):
            parts.append(f"Model gender: {'male' if extra['gender'] == 'male' else 'female'}.")
        if prompt:
            parts.append(prompt)
    else:
        parts.append(prompt)

    if negative_prompt and negative_prompt.strip():
        parts.append(f"\nAvoid the following: {negative_prompt.strip()}")

    return "\n".join(parts)


def _create_ai_task(user_id: str, task_type: str, input_params: dict, project_id: str = None) -> str:
    """创建 AI 任务记录"""
    from ..utils.ai_task_helpers import create_ai_task
    callback_url = _get_callback_url()
    return create_ai_task(
        user_id=user_id,
        task_type=task_type,
        input_params=input_params,
        callback_url=callback_url,
        project_id=project_id,
    )


async def _resolve_avatar_portrait(avatar_id: str, user_id: str, prompt: str = "") -> dict:
    """复用 kling.py 的数字人解析"""
    from .kling import _resolve_avatar_portrait as resolve
    return await resolve(avatar_id, user_id, prompt=prompt)


# ============================================
# 路由
# ============================================

@router.post("")
async def create_image_generation(
    request: ImageGenerationRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id),
):
    """统一图像生成入口 — 根据 provider 分发"""
    try:
        provider = request.provider.lower()

        # ── Prompt 增强 (L2 + L3) ──
        from ..services.prompt_enhancer import get_prompt_enhancer
        enhancer = get_prompt_enhancer()
        enhanced = await enhancer.enhance(
            capability=request.capability,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            platform=request.platform,
            input_type=request.input_type,
            auto_enhance=request.auto_enhance,
        )
        request.prompt = enhanced.prompt
        request.negative_prompt = enhanced.negative_prompt
        if enhanced.enhanced:
            logger.info(f"[ImageGen] Prompt 增强({enhanced.source}): {enhanced.prompt[:60]}...")

        # 解析数字人参考图
        extra_image_urls: List[str] = []
        if request.avatar_id:
            avatar_data = await _resolve_avatar_portrait(request.avatar_id, user_id, prompt=request.prompt)
            portrait_url = avatar_data["portrait_url"]
            ref_images = avatar_data.get("reference_images", [])
            extra_image_urls = [portrait_url]
            for ref in ref_images:
                if ref not in extra_image_urls:
                    extra_image_urls.append(ref)
            logger.info(f"[ImageGen] 注入数字人 {len(extra_image_urls)} 张参考图")

        # 合并参考图
        all_image_urls = list(extra_image_urls)
        if request.image_urls:
            for url in request.image_urls:
                if url not in all_image_urls:
                    all_image_urls.append(url)

        if provider == "doubao":
            return await _dispatch_doubao(request, all_image_urls, user_id, project_id)
        elif provider == "kling":
            return await _dispatch_kling(request, all_image_urls, user_id, project_id)
        else:
            raise HTTPException(status_code=400, detail=f"不支持的 provider: {provider}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ImageGen] 创建任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _dispatch_doubao(
    request: ImageGenerationRequest,
    image_urls: List[str],
    user_id: str,
    project_id: Optional[str],
) -> dict:
    """分发到 Doubao Seedream 4.0 — 所有 image 能力通过 prompt 编织适配"""
    from ..tasks.doubao_image import process_doubao_image

    # 根据 capability + extra_params 编织最终 prompt
    final_prompt = _weave_prompt(request.capability, request.prompt, request.negative_prompt, request.extra_params)

    # 参考图格式: string(单张) / list(多张) / None
    image_param = None
    if len(image_urls) == 1:
        image_param = image_urls[0]
    elif len(image_urls) > 1:
        image_param = image_urls

    sequential = request.n > 1
    task_type = "doubao_image"

    ai_task_id = _create_ai_task(user_id, task_type, request.model_dump(), project_id=project_id)

    process_doubao_image.delay(
        ai_task_id=ai_task_id,
        user_id=user_id,
        prompt=final_prompt,
        negative_prompt="",  # 已编织到 prompt 里
        image=image_param,
        options={
            "sequential": sequential,
            "max_images": request.n,
            "size": request.size,
        },
    )

    logger.info(f"[ImageGen] Doubao 任务已创建: {ai_task_id}, capability={request.capability}")
    return {"success": True, "task_id": ai_task_id, "status": "pending", "provider": "doubao"}


async def _dispatch_kling(
    request: ImageGenerationRequest,
    image_urls: List[str],
    user_id: str,
    project_id: Optional[str],
) -> dict:
    """分发到 Kling — 根据 capability 路由到对应的 Celery task"""
    capability = request.capability
    extra = request.extra_params or {}

    # 拼接 negative_prompt 到 prompt
    final_prompt = request.prompt
    if request.negative_prompt and request.negative_prompt.strip():
        final_prompt = f"{request.prompt}\n\n避免出现以下内容：{request.negative_prompt.strip()}"

    if capability == "omni_image":
        return await _dispatch_kling_omni_image(request, image_urls, final_prompt, user_id, project_id)
    elif capability == "face_swap":
        return await _dispatch_kling_face_swap(image_urls, extra, final_prompt, user_id, project_id, request)
    elif capability in ("skin_enhance", "relight", "outfit_swap", "ai_stylist", "outfit_shot"):
        return await _dispatch_kling_enhance_style(capability, image_urls, extra, final_prompt, user_id, project_id, request)
    else:
        raise HTTPException(status_code=400, detail=f"不支持的 Kling capability: {capability}")


async def _dispatch_kling_omni_image(request, image_urls, final_prompt, user_id, project_id):
    """Kling omni_image — 原有逻辑"""
    from ..tasks.omni_image import process_omni_image

    image_list = []
    for i, url in enumerate(image_urls):
        var_name = f"image_{chr(ord('a') + i)}" if i < 26 else f"image_{i}"
        image_list.append({"image": url, "var": var_name})

    ai_task_id = _create_ai_task(user_id, "omni_image", request.model_dump(), project_id=project_id)

    process_omni_image.delay(
        ai_task_id=ai_task_id,
        user_id=user_id,
        prompt=final_prompt,
        image_list=image_list if image_list else None,
        element_list=None,
        options={
            "model_name": "kling-image-o1",
            "resolution": "2k",
            "n": request.n,
            "aspect_ratio": request.aspect_ratio,
        },
    )

    logger.info(f"[ImageGen] Kling omni_image 任务已创建: {ai_task_id}")
    return {"success": True, "task_id": ai_task_id, "status": "pending", "provider": "kling"}


async def _dispatch_kling_face_swap(image_urls, extra, prompt, user_id, project_id, request):
    """Kling face_swap — 复用现有 face_swap task"""
    from ..tasks.face_swap import process_face_swap
    if len(image_urls) < 2:
        raise HTTPException(status_code=400, detail="AI 换脸需要至少 2 张图片")
    ai_task_id = _create_ai_task(user_id, "face_swap", request.model_dump(), project_id=project_id)
    process_face_swap.delay(
        ai_task_id=ai_task_id,
        user_id=user_id,
        source_image_url=image_urls[0],
        face_image_url=image_urls[1],
        custom_prompt=prompt or None,
    )
    logger.info(f"[ImageGen] Kling face_swap 任务已创建: {ai_task_id}")
    return {"success": True, "task_id": ai_task_id, "status": "pending", "provider": "kling"}


async def _dispatch_kling_enhance_style(capability, image_urls, extra, prompt, user_id, project_id, request):
    """Kling enhance & style 能力 — 复用 process_enhance_style task"""
    from ..tasks.enhance_style import process_enhance_style

    # 构造与 enhance_style.py 路由一致的 params
    params = dict(extra)
    if capability == "skin_enhance":
        task_type = "skin_enhance"
        params["image_url"] = image_urls[0] if image_urls else None
        params["custom_prompt"] = prompt or None
    elif capability == "relight":
        task_type = "relight"
        params["image_url"] = image_urls[0] if image_urls else None
        params["custom_prompt"] = prompt or None
    elif capability == "outfit_swap":
        task_type = "outfit_swap"
        if len(image_urls) >= 2:
            params["person_image_url"] = image_urls[0]
            params["garment_image_url"] = image_urls[1]
        params["custom_prompt"] = prompt or None
    elif capability == "ai_stylist":
        task_type = "ai_stylist"
        params["garment_image_url"] = image_urls[0] if image_urls else None
        params["custom_prompt"] = prompt or None
    elif capability == "outfit_shot":
        task_type = "outfit_shot"
        params["garment_images"] = image_urls
        params["scene_prompt"] = prompt or None
    else:
        task_type = capability

    ai_task_id = _create_ai_task(user_id, task_type, request.model_dump(), project_id=project_id)

    process_enhance_style.delay(
        task_id=ai_task_id,
        user_id=user_id,
        capability_id=capability,
        params=params,
    )

    logger.info(f"[ImageGen] Kling {capability} 任务已创建: {ai_task_id}")
    return {"success": True, "task_id": ai_task_id, "status": "pending", "provider": "kling"}
