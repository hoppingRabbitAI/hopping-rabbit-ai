"""
视觉元素分离服务
===============
将视频/图片中的前景（人物）与背景分离，生成：
  - foreground_mask: 二值蒙版（白=人物，黑=背景）
  - foreground_image: 带透明通道的前景人物
  - background_image: 修复后的背景层（前景区域被填充）

分离类型：
  - person_background: 背景/人物分离
  - person_clothing:   人物/服饰分离（预留，后续接入 Kling 细粒度分割）

当前实现使用 rembg（本地 U²-Net 模型），
后续可无缝切换到 Kling 图片分割 API。
"""

import logging
import io
import uuid
import asyncio
from datetime import datetime
from enum import Enum
from typing import Optional, Tuple, Dict, Any

import numpy as np
from PIL import Image, ImageFilter
import httpx

logger = logging.getLogger(__name__)

# ==========================================
# 常量
# ==========================================

STORAGE_BUCKET = "ai-creations"
SEPARATION_PREFIX = "separation"


class SeparationType(str, Enum):
    """分离类型"""
    PERSON_BACKGROUND = "person_background"   # 背景/人物分离
    PERSON_CLOTHING = "person_clothing"       # 人物/服饰分离
    PERSON_ACCESSORY = "person_accessory"     # 人物/配饰分离
    LAYER_SEPARATION = "layer_separation"     # 前/中/后景结构分离


class SeparationStatus(str, Enum):
    """分离任务状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# ==========================================
# 核心分离逻辑
# ==========================================

async def download_image(url: str) -> Image.Image:
    """从 URL 下载图片并转为 PIL Image"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        img = Image.open(io.BytesIO(response.content))
        img.load()  # ★ 强制完整加载像素数据，避免 Pillow 延迟加载兼容性问题
        return img.convert("RGBA")


def generate_person_mask(image: Image.Image) -> Image.Image:
    """
    生成人物前景 mask（白色=前景，黑色=背景）
    使用 rembg（U²-Net）模型

    Args:
        image: RGBA 格式的 PIL Image
    Returns:
        L 模式的 mask 图片
    """
    try:
        from rembg import remove
    except ImportError:
        logger.error("[VisualSeparation] rembg 未安装，请运行: pip install rembg[gpu]")
        raise RuntimeError("rembg 未安装，无法进行视觉分离")

    # rembg only_mask=True 直接返回 alpha mask
    rgb_image = image.convert("RGB")
    mask = remove(rgb_image, only_mask=True)

    if isinstance(mask, Image.Image):
        mask = mask.convert("L")
    else:
        mask = Image.fromarray(mask).convert("L")

    # 形态学后处理：平滑边缘
    # 1. 轻度膨胀填充小孔洞
    mask = mask.filter(ImageFilter.MaxFilter(3))
    # 2. 高斯模糊平滑毛边
    mask = mask.filter(ImageFilter.GaussianBlur(radius=1))
    # 3. 重新二值化（保持锐利边缘）
    mask_arr = np.array(mask)
    mask_arr = ((mask_arr > 128) * 255).astype(np.uint8)
    mask = Image.fromarray(mask_arr, mode="L")

    return mask


def extract_foreground(image: Image.Image, mask: Image.Image) -> Image.Image:
    """
    根据 mask 提取前景（带透明通道）

    Args:
        image: RGBA 原图
        mask:  L 模式 mask（白=前景）
    Returns:
        RGBA 图片，背景区域为透明
    """
    image = image.convert("RGBA")
    mask = mask.resize(image.size, Image.Resampling.LANCZOS)

    # 将 mask 作为 alpha 通道
    fg = image.copy()
    fg.putalpha(mask)
    return fg


def extract_background(image: Image.Image, mask: Image.Image) -> Image.Image:
    """
    根据 mask 提取背景层
    前景区域进行简单修复（中值滤波填充）

    Args:
        image: RGBA 原图
        mask:  L 模式 mask（白=前景）
    Returns:
        RGB 背景图片
    """
    image_rgb = image.convert("RGB")
    mask = mask.resize(image_rgb.size, Image.Resampling.LANCZOS)
    mask_arr = np.array(mask)

    # 简单修复策略：对前景区域进行大核中值滤波
    # 创建一个背景副本
    bg_arr = np.array(image_rgb)

    # 标记前景像素
    fg_pixels = mask_arr > 128

    if np.any(fg_pixels):
        # 用周围背景颜色填充前景区域
        # 方法：迭代扩散 - 从边缘向内填充
        from scipy import ndimage
        
        for channel in range(3):
            ch = bg_arr[:, :, channel].astype(float)
            ch[fg_pixels] = 0
            
            # 计算距离权重
            weight = (~fg_pixels).astype(float)
            
            # 多次迭代扩散
            kernel_size = max(3, min(image_rgb.size) // 20)
            if kernel_size % 2 == 0:
                kernel_size += 1
            
            filled = ndimage.uniform_filter(ch, size=kernel_size)
            weight_filled = ndimage.uniform_filter(weight, size=kernel_size)
            
            # 避免除零
            safe_weight = np.where(weight_filled > 0.001, weight_filled, 1.0)
            result = filled / safe_weight
            
            # 只替换前景区域
            bg_arr[fg_pixels, channel] = np.clip(result[fg_pixels], 0, 255).astype(np.uint8)

    return Image.fromarray(bg_arr, mode="RGB")


def extract_background_simple(image: Image.Image, mask: Image.Image) -> Image.Image:
    """
    简单背景提取（无修复，前景区域填白）
    当 scipy 不可用时的回退方案

    Args:
        image: RGBA 原图
        mask:  L 模式 mask（白=前景）
    Returns:
        RGB 背景图片
    """
    image_rgb = image.convert("RGB")
    mask = mask.resize(image_rgb.size, Image.Resampling.LANCZOS)
    mask_arr = np.array(mask)
    bg_arr = np.array(image_rgb)

    # 前景区域填充白色
    fg_pixels = mask_arr > 128
    bg_arr[fg_pixels] = [245, 245, 245]

    return Image.fromarray(bg_arr, mode="RGB")


async def upload_image_to_storage(
    image: Image.Image,
    prefix: str,
    task_id: str,
    suffix: str,
    format: str = "PNG"
) -> str:
    """
    将 PIL Image 上传到 Supabase Storage

    Args:
        image: PIL Image
        prefix: 存储路径前缀
        task_id: 任务 ID
        suffix: 文件名后缀（如 mask, foreground, background）
        format: 图片格式
    Returns:
        公开 URL
    """
    from app.services.supabase_client import supabase

    buf = io.BytesIO()
    image.save(buf, format=format)
    buf.seek(0)

    ext = "png" if format == "PNG" else "jpg"
    content_type = f"image/{ext}"
    storage_path = f"{prefix}/{task_id}/{suffix}.{ext}"

    supabase.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        buf.getvalue(),
        {"content-type": content_type, "upsert": "true"}
    )

    public_url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
    return public_url


# ==========================================
# LLM 语义分析
# ==========================================

SEMANTIC_ANALYSIS_PROMPT = """请仔细分析这张图片，识别其中的所有视觉元素，返回 JSON 格式：

{
  "foreground": "前景主体的详细描述（人物：性别、年龄段、发型、发色、表情、体型等外貌特征）",
  "foreground_clothing": "前景人物的穿着描述（上衣、下装、鞋子、颜色、材质、风格）",
  "background": "背景场景的详细描述（环境、地点、光线、氛围、关键物体）",
  "scene": "整体场景一句话概括（如：室内半身照，自然光，咖啡厅环境）",
  "has_person": true/false
}

要求：
- 用中文描述，准确且具体
- 如果没有人物，foreground 描述主要物体，foreground_clothing 留空字符串
- background 要包含环境中的显著物体（桌椅、植物、建筑等）
- 只返回 JSON，不要其他文字"""

SEMANTIC_ANALYSIS_SYSTEM = "你是一个专业的图像分析师，擅长精确描述图片中的视觉元素。只返回有效 JSON。"


async def _analyze_image_semantics(image: Image.Image) -> Dict[str, str]:
    """
    用 Doubao 视觉模型分析图片语义，返回各层的描述。

    并行于 rembg 分割执行，不阻塞分离流程。
    失败时返回空描述（降级为旧行为），不影响核心分离功能。
    """
    import json as _json
    try:
        from app.services.llm.service import get_llm_service
        from app.utils.image_utils import pil_image_to_base64

        llm = get_llm_service()
        image_b64 = pil_image_to_base64(image.convert("RGB"), format="JPEG")

        raw = await llm.analyze_image(
            image_base64=image_b64,
            prompt=SEMANTIC_ANALYSIS_PROMPT,
            system_prompt=SEMANTIC_ANALYSIS_SYSTEM,
        )

        # 解析 JSON（兼容 markdown code block 包裹）
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        result = _json.loads(text)
        logger.info(f"[VisualSeparation] 语义分析完成: {list(result.keys())}")
        return {
            "foreground": result.get("foreground", ""),
            "foreground_clothing": result.get("foreground_clothing", ""),
            "background": result.get("background", ""),
            "scene": result.get("scene", ""),
            "has_person": result.get("has_person", True),
        }
    except Exception as e:
        logger.warning(f"[VisualSeparation] 语义分析失败（降级为默认标签）: {e}")
        return {
            "foreground": "",
            "foreground_clothing": "",
            "background": "",
            "scene": "",
            "has_person": True,
        }


# ==========================================
# 主流程：人物/背景分离
# ==========================================

async def separate_person_background(
    image_url: str,
    task_id: str
) -> Dict[str, Any]:
    """
    执行人物/背景分离 + LLM 语义分析，返回分层结果 + 语义标签

    Args:
        image_url: 源图片 URL
        task_id: 任务 ID
    Returns:
        {
            "mask_url": "...",
            "foreground_url": "...",
            "background_url": "...",
            "original_width": ...,
            "original_height": ...,
            "semantic_labels": {
                "foreground": "穿白色衬衫的年轻女性，黑色长发...",
                "foreground_clothing": "白色衬衫，黑色西裤...",
                "background": "现代办公室，白色书架...",
                "scene": "室内半身照，自然光，办公环境",
            },
        }
    """
    logger.info(f"[VisualSeparation] 开始智能分层 task={task_id}")

    # 1. 下载源图
    image = await download_image(image_url)
    original_width, original_height = image.size
    logger.info(f"[VisualSeparation] 源图尺寸: {original_width}x{original_height}")

    # 2. 并行执行：rembg 分割 + LLM 语义分析
    loop = asyncio.get_event_loop()

    mask_future = loop.run_in_executor(None, generate_person_mask, image)
    semantic_future = asyncio.ensure_future(_analyze_image_semantics(image))

    mask = await mask_future
    logger.info("[VisualSeparation] mask 生成完毕")

    # 3. 提取前景
    foreground = await loop.run_in_executor(None, extract_foreground, image, mask)
    logger.info("[VisualSeparation] 前景提取完毕")

    # 4. 提取背景（带修复）
    try:
        background = await loop.run_in_executor(None, extract_background, image, mask)
    except ImportError:
        logger.warning("[VisualSeparation] scipy 不可用，使用简单背景提取")
        background = await loop.run_in_executor(None, extract_background_simple, image, mask)
    logger.info("[VisualSeparation] 背景提取完毕")

    # 5. 等待语义分析完成（大概率已经完成）
    semantic_labels = await semantic_future
    logger.info(f"[VisualSeparation] 语义标签: scene={semantic_labels.get('scene', '')[:50]}")

    # 6. 上传到存储
    prefix = f"{SEPARATION_PREFIX}"
    mask_url, fg_url, bg_url = await asyncio.gather(
        upload_image_to_storage(mask.convert("RGB"), prefix, task_id, "mask", "PNG"),
        upload_image_to_storage(foreground, prefix, task_id, "foreground", "PNG"),
        upload_image_to_storage(background, prefix, task_id, "background", "JPEG"),
    )
    logger.info(f"[VisualSeparation] 上传完毕 mask={mask_url[:50]}...")

    return {
        "mask_url": mask_url,
        "foreground_url": fg_url,
        "background_url": bg_url,
        "original_width": original_width,
        "original_height": original_height,
        "semantic_labels": semantic_labels,
    }


# ==========================================
# 主流程：人物/服饰分离（预留）
# ==========================================

async def separate_person_clothing(
    image_url: str,
    task_id: str
) -> Dict[str, Any]:
    """
    人物/服饰分离（预留接口）
    后续接入 Kling 细粒度分割 API 或 SAM2

    目前返回与 person_background 相同的结果 + 标记
    """
    logger.info(f"[VisualSeparation] 人物/服饰分离 (使用 person_background 替代) task={task_id}")

    # 当前实现与人物/背景一致，后续替换为细粒度分割
    result = await separate_person_background(image_url, task_id)
    result["separation_type"] = SeparationType.PERSON_CLOTHING.value
    result["note"] = "当前使用人物/背景分离替代，后续接入细粒度分割"

    return result


# ==========================================
# 主流程：人物/配饰分离
# ==========================================

async def separate_person_accessory(
    image_url: str,
    task_id: str
) -> Dict[str, Any]:
    """
    人物/配饰分离
    分离眼镜、帽子、首饰等配饰

    当前使用 rembg 做基础人物分离作为 fallback，
    后续接入 SAM2 细粒度语义分割（配饰级别的 mask）
    """
    logger.info(f"[VisualSeparation] 人物/配饰分离 task={task_id}")

    # Phase 1: 使用人物/背景分离作为基础（后续升级为 SAM2 配饰级分割）
    result = await separate_person_background(image_url, task_id)
    result["separation_type"] = SeparationType.PERSON_ACCESSORY.value
    result["note"] = "当前使用人物前景分离替代，后续接入 SAM2 细粒度配饰级分割"

    return result


# ==========================================
# 主流程：前/中/后景结构分离
# ==========================================

async def separate_layers(
    image_url: str,
    task_id: str
) -> Dict[str, Any]:
    """
    前/中/后景深度层分离
    将画面按深度分为前景、中景、后景三层

    当前使用 rembg 做基础前景/背景分离（2 层），
    后续接入 MiDaS / ZoeDepth 深度估计模型实现真正的三层分离
    """
    logger.info(f"[VisualSeparation] 前/中/后景分离 task={task_id}")

    # Phase 1: 基于 rembg 的 2 层分离（前景 + 背景）
    # 后续升级为 MiDaS/ZoeDepth 深度估计 → 3 层 mask
    image = await download_image(image_url)
    original_width, original_height = image.size

    loop = asyncio.get_event_loop()
    mask = await loop.run_in_executor(None, generate_person_mask, image)

    foreground = await loop.run_in_executor(None, extract_foreground, image, mask)
    try:
        background = await loop.run_in_executor(None, extract_background, image, mask)
    except ImportError:
        background = await loop.run_in_executor(None, extract_background_simple, image, mask)

    prefix = f"{SEPARATION_PREFIX}"
    mask_url, fg_url, bg_url = await asyncio.gather(
        upload_image_to_storage(mask.convert("RGB"), prefix, task_id, "mask_foreground", "PNG"),
        upload_image_to_storage(foreground, prefix, task_id, "layer_foreground", "PNG"),
        upload_image_to_storage(background, prefix, task_id, "layer_background", "JPEG"),
    )

    return {
        "mask_url": mask_url,
        "foreground_url": fg_url,
        "background_url": bg_url,
        "midground_url": None,  # Phase 2: 通过深度估计模型生成
        "original_width": original_width,
        "original_height": original_height,
        "separation_type": SeparationType.LAYER_SEPARATION.value,
        "layer_count": 2,
        "note": "当前为 2 层分离（前景+背景），后续接入深度估计模型实现 3 层",
    }


# ==========================================
# 后台任务入口
# ==========================================

async def run_separation_task(
    task_id: str,
    image_url: str,
    separation_type: str,
    clip_id: Optional[str] = None,
    shot_id: Optional[str] = None,
    enhance: bool = True,
):
    """
    分离任务后台执行入口
    更新 tasks 表中的状态和结果

    Args:
        task_id: 任务 ID
        image_url: 源图 URL
        separation_type: 分离类型
        clip_id: 关联的 clip ID
        shot_id: 关联的 shot ID
    """
    from app.services.supabase_client import supabase

    now = datetime.utcnow().isoformat()

    try:
        # 更新为 processing
        supabase.table("tasks").update({
            "status": "processing",
            "progress": 10,
            "status_message": "正在分析图像内容…",
            "started_at": now,
            "updated_at": now,
        }).eq("id", task_id).execute()

        # 执行分离
        if separation_type == SeparationType.PERSON_CLOTHING.value:
            result = await separate_person_clothing(image_url, task_id)
        elif separation_type == SeparationType.PERSON_ACCESSORY.value:
            result = await separate_person_accessory(image_url, task_id)
        elif separation_type == SeparationType.LAYER_SEPARATION.value:
            result = await separate_layers(image_url, task_id)
        else:
            result = await separate_person_background(image_url, task_id)

        # 更新进度
        supabase.table("tasks").update({
            "progress": 60,
            "status_message": "分层完成，正在增强质量…",
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", task_id).execute()

        # 执行增强（如果启用）
        if enhance and result.get("foreground_url"):
            try:
                from app.services.layer_enhancement_service import enhance_layer

                enhancement = await enhance_layer(
                    layer_image_url=result["foreground_url"],
                    task_id=task_id,
                    semantic_labels=result.get("semantic_labels"),
                )
                if enhancement.get("enhanced_url") != result["foreground_url"]:
                    result["enhanced_foreground_url"] = enhancement["enhanced_url"]
                    result["enhancement_info"] = {
                        "content_category": enhancement.get("content_category"),
                        "strategy_used": enhancement.get("strategy_used"),
                        "steps_executed": enhancement.get("steps_executed"),
                        "quality_score": enhancement.get("quality_score"),
                    }
                    logger.info(f"[VisualSeparation] 前景增强完成 task={task_id}")
            except Exception as e:
                logger.warning(f"[VisualSeparation] 增强失败（非阻塞）: {e}")

        supabase.table("tasks").update({
            "progress": 90,
            "status_message": "正在保存结果…",
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", task_id).execute()

        # 更新完成
        supabase.table("tasks").update({
            "status": "completed",
            "progress": 100,
            "status_message": "分离完成",
            "metadata": result,
            "output_url": result.get("foreground_url"),
            "completed_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", task_id).execute()

        logger.info(f"[VisualSeparation] 任务完成 task={task_id}")

    except Exception as e:
        logger.error(f"[VisualSeparation] 任务失败 task={task_id}: {e}", exc_info=True)

        supabase.table("tasks").update({
            "status": "failed",
            "progress": 0,
            "error_message": str(e),
            "status_message": f"分离失败: {str(e)[:200]}",
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", task_id).execute()
