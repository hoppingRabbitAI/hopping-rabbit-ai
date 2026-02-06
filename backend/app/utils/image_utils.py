"""
图片处理工具

主要功能：
1. 解析 Base64 Data URL 为图片数据
2. 处理前端绘制的 mask 图片（半透明蓝色 → 黑白 mask）
3. 将图片数据转换为 Kling AI 所需的格式
"""

import base64
import io
import logging
from typing import Optional, Tuple, Dict, Any
from PIL import Image
import numpy as np

logger = logging.getLogger(__name__)


def parse_data_url(data_url: str) -> Tuple[Optional[bytes], Optional[str]]:
    """
    解析 Data URL 为二进制数据
    
    Args:
        data_url: Base64 Data URL，格式：data:image/png;base64,xxxxx
    
    Returns:
        Tuple[bytes, str]: (图片二进制数据, MIME 类型)
    """
    if not data_url or not data_url.startswith("data:"):
        return None, None
    
    try:
        # 分离 header 和 data
        header, data = data_url.split(",", 1)
        
        # 解析 MIME 类型
        # header 格式: data:image/png;base64
        mime_type = header.split(";")[0].replace("data:", "")
        
        # Base64 解码
        image_data = base64.b64decode(data)
        
        return image_data, mime_type
        
    except Exception as e:
        logger.error(f"[ImageUtils] Data URL 解析失败: {e}")
        return None, None


def data_url_to_pil_image(data_url: str) -> Optional[Image.Image]:
    """
    将 Data URL 转换为 PIL Image
    
    Args:
        data_url: Base64 Data URL
    
    Returns:
        PIL.Image 对象
    """
    image_data, _ = parse_data_url(data_url)
    if not image_data:
        return None
    
    try:
        return Image.open(io.BytesIO(image_data))
    except Exception as e:
        logger.error(f"[ImageUtils] 图片解析失败: {e}")
        return None


def pil_image_to_base64(image: Image.Image, format: str = "PNG") -> str:
    """
    将 PIL Image 转换为 Base64 字符串
    
    Args:
        image: PIL.Image 对象
        format: 图片格式 (PNG, JPEG 等)
    
    Returns:
        Base64 编码字符串
    """
    buffer = io.BytesIO()
    image.save(buffer, format=format)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def pil_image_to_data_url(image: Image.Image, format: str = "PNG") -> str:
    """
    将 PIL Image 转换为 Data URL
    
    Args:
        image: PIL.Image 对象
        format: 图片格式
    
    Returns:
        Data URL 字符串
    """
    base64_str = pil_image_to_base64(image, format)
    mime_type = f"image/{format.lower()}"
    return f"data:{mime_type};base64,{base64_str}"


def process_drawing_mask(
    mask_data_url: str,
    output_mode: str = "alpha"
) -> Optional[Image.Image]:
    """
    处理前端 DrawingCanvas 绘制的 mask 图片
    
    前端绘制的 mask 特点：
    - RGBA 格式
    - 绘制区域：半透明蓝色 (rgba(0, 100, 255, 0.3))
    - 未绘制区域：完全透明
    
    输出模式：
    - "alpha": 使用 alpha 通道直接作为 mask（白色=绘制区域，黑色=未绘制）
    - "invert": 反转 mask（黑色=绘制区域，白色=未绘制）
    - "rgba": 保持原始 RGBA 格式
    
    Args:
        mask_data_url: 前端传入的 Data URL
        output_mode: 输出模式
    
    Returns:
        处理后的 PIL.Image（L 模式，灰度图）
    """
    # 解析 Data URL
    image = data_url_to_pil_image(mask_data_url)
    if image is None:
        return None
    
    try:
        # 确保是 RGBA 模式
        if image.mode != "RGBA":
            image = image.convert("RGBA")
        
        if output_mode == "rgba":
            return image
        
        # 提取 alpha 通道
        # Alpha 值：0 = 完全透明（未绘制），255 = 完全不透明
        # 但前端绘制是半透明的 (alpha=0.3 ≈ 76)，所以需要做阈值处理
        alpha = image.split()[3]  # 获取 alpha 通道
        alpha_array = np.array(alpha)
        
        # 阈值处理：任何非零 alpha 值都认为是绘制区域
        # 绘制区域 → 白色 (255)，未绘制区域 → 黑色 (0)
        mask_array = np.where(alpha_array > 10, 255, 0).astype(np.uint8)
        
        if output_mode == "invert":
            # 反转：绘制区域 → 黑色，未绘制 → 白色
            mask_array = 255 - mask_array
        
        # 创建灰度图
        mask_image = Image.fromarray(mask_array, mode="L")
        
        logger.info(f"[ImageUtils] Mask 处理完成: size={mask_image.size}, mode={output_mode}")
        return mask_image
        
    except Exception as e:
        logger.error(f"[ImageUtils] Mask 处理失败: {e}")
        return None


def create_composite_image(
    background_image: Image.Image,
    foreground_image: Image.Image,
    mask: Image.Image
) -> Image.Image:
    """
    使用 mask 合成前景和背景图片
    
    Mask 规则：
    - 白色区域 (255)：显示前景
    - 黑色区域 (0)：显示背景
    
    Args:
        background_image: 背景图片
        foreground_image: 前景图片
        mask: 灰度 mask 图片
    
    Returns:
        合成后的图片
    """
    # 确保尺寸一致
    size = background_image.size
    target_width, target_height = size
    
    fg_width, fg_height = foreground_image.size
    
    # ★★★ 治本方案：直接 resize，不做 center crop ★★★
    # center crop 会裁掉边角，导致右上角/左下角等位置的元素丢失
    # 用户画的太阳在右上角，crop 后就没了！
    if fg_width != target_width or fg_height != target_height:
        logger.info(f"[Composite] 前景图 resize: {fg_width}x{fg_height} -> {target_width}x{target_height}")
        foreground_image = foreground_image.resize(size, Image.Resampling.LANCZOS)
    
    mask_width, mask_height = mask.size
    if mask_width != target_width or mask_height != target_height:
        logger.info(f"[Composite] Mask resize: {mask_width}x{mask_height} -> {target_width}x{target_height}")
        mask = mask.resize(size, Image.Resampling.LANCZOS)
    
    # 确保格式正确
    if background_image.mode != "RGBA":
        background_image = background_image.convert("RGBA")
    if foreground_image.mode != "RGBA":
        foreground_image = foreground_image.convert("RGBA")
    if mask.mode != "L":
        mask = mask.convert("L")
    
    # 合成
    result = Image.composite(foreground_image, background_image, mask)
    
    return result


def prepare_kling_image_input(image: Image.Image, max_size: int = 2048) -> str:
    """
    准备 Kling AI omni-image API 的图片输入
    
    Kling API 要求：
    - 图片格式：JPEG, PNG, WEBP, HEIC, HEIF
    - 图片尺寸：不超过 20MB
    - 推荐使用 Base64 格式
    
    Args:
        image: PIL.Image 对象
        max_size: 最大边长（超过则缩放）
    
    Returns:
        Base64 编码字符串（无 data: 前缀）
    """
    # 缩放过大的图片
    if max(image.size) > max_size:
        ratio = max_size / max(image.size)
        new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
        image = image.resize(new_size, Image.Resampling.LANCZOS)
        logger.info(f"[ImageUtils] 图片已缩放: {image.size}")
    
    # 转换为 RGB（去掉 alpha 通道）
    if image.mode == "RGBA":
        # 创建白色背景
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[3])
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")
    
    # 压缩为 JPEG 以减小体积
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90, optimize=True)
    
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def prepare_mask_for_inpainting(
    mask_data_url: str,
    target_size: Tuple[int, int] = None
) -> Optional[str]:
    """
    准备用于 inpainting 的 mask 图片
    
    处理流程：
    1. 解析前端 mask Data URL
    2. 提取绘制区域（alpha > 0）
    3. 转换为灰度 mask
    4. 调整尺寸匹配目标图片
    5. 输出 Base64
    
    Args:
        mask_data_url: 前端传入的 mask Data URL
        target_size: 目标尺寸 (width, height)，如果提供则调整 mask 尺寸
    
    Returns:
        Base64 编码的 mask 图片
    """
    # 处理 mask
    mask = process_drawing_mask(mask_data_url, output_mode="alpha")
    if mask is None:
        return None
    
    # 调整尺寸
    if target_size and mask.size != target_size:
        mask = mask.resize(target_size, Image.Resampling.LANCZOS)
        logger.info(f"[ImageUtils] Mask 尺寸已调整: {mask.size}")
    
    # 转为 Base64
    return pil_image_to_base64(mask, format="PNG")


def get_image_size_from_data_url(data_url: str) -> Optional[Tuple[int, int]]:
    """
    从 Data URL 获取图片尺寸
    
    Args:
        data_url: Base64 Data URL
    
    Returns:
        (width, height) 或 None
    """
    image = data_url_to_pil_image(data_url)
    if image:
        return image.size
    return None


def create_inpainting_prompt(
    original_prompt: str,
    has_mask: bool = False
) -> str:
    """
    创建 inpainting 任务的 prompt
    
    Kling omni-image API 使用 <<<image_1>>> 格式引用图片
    
    Args:
        original_prompt: 用户原始 prompt
        has_mask: 是否有 mask
    
    Returns:
        格式化后的 prompt
    """
    if has_mask:
        # 有 mask：替换 mask 区域
        return f"Based on <<<image_1>>>, replace the marked area with: {original_prompt}. Keep the unmarked areas unchanged."
    else:
        # 无 mask：整体风格迁移
        return f"Transform <<<image_1>>> into: {original_prompt}"
