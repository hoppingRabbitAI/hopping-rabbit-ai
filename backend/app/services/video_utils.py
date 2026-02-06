"""
视频工具函数

提供视频尺寸、宽高比相关的工具函数

★ B-Roll 全屏显示策略 ★
当 B-Roll 素材与目标视频比例不匹配时：
- fullscreen 模式：使用 letterbox/pillarbox（黑边填充），完全覆盖原视频
- pip 模式：保持原比例缩放，不裁剪

举例：
- 9:16 竖屏视频 + 16:9 横屏 B-Roll = 横屏素材居中，上下黑边（letterbox）
- 16:9 横屏视频 + 9:16 竖屏 B-Roll = 竖屏素材居中，左右黑边（pillarbox）
"""
from typing import Tuple, Literal, Optional, Dict, Any
from enum import Enum


class VideoOrientation(str, Enum):
    """视频方向"""
    LANDSCAPE = "landscape"  # 横屏 16:9
    PORTRAIT = "portrait"    # 竖屏 9:16
    SQUARE = "square"        # 方形 1:1


class AspectRatio(str, Enum):
    """视频宽高比"""
    RATIO_16_9 = "16:9"      # 横屏
    RATIO_9_16 = "9:16"      # 竖屏
    RATIO_1_1 = "1:1"        # 方形
    RATIO_4_3 = "4:3"        # 传统横屏
    RATIO_3_4 = "3:4"        # 传统竖屏


class BRollFitMode(str, Enum):
    """B-Roll 适配模式"""
    LETTERBOX = "letterbox"  # 黑边填充（保持原比例，空白区域填黑）
    CROP = "crop"            # 裁剪（填满目标区域，可能损失内容）
    STRETCH = "stretch"      # 拉伸（变形填满，不推荐）


def detect_video_orientation(width: int, height: int) -> VideoOrientation:
    """
    根据视频宽高检测视频方向
    
    Args:
        width: 视频宽度
        height: 视频高度
        
    Returns:
        VideoOrientation: landscape(横屏), portrait(竖屏), square(方形)
    """
    # 处理 None 或无效值
    if width is None or height is None or width <= 0 or height <= 0:
        return VideoOrientation.LANDSCAPE  # 默认横屏
    
    ratio = width / height
    
    if ratio > 1.2:
        return VideoOrientation.LANDSCAPE
    elif ratio < 0.8:
        return VideoOrientation.PORTRAIT
    else:
        return VideoOrientation.SQUARE


def detect_aspect_ratio(width: int, height: int) -> AspectRatio:
    """
    根据视频宽高检测宽高比
    
    Args:
        width: 视频宽度
        height: 视频高度
        
    Returns:
        AspectRatio: 16:9, 9:16, 1:1, 4:3, 3:4
    """
    # 处理 None 或无效值
    if width is None or height is None or width <= 0 or height <= 0:
        return AspectRatio.RATIO_16_9
    
    ratio = width / height
    
    # 16:9 = 1.778, 9:16 = 0.5625, 1:1 = 1.0, 4:3 = 1.333, 3:4 = 0.75
    if ratio >= 1.6:
        return AspectRatio.RATIO_16_9
    elif ratio <= 0.625:
        return AspectRatio.RATIO_9_16
    elif 0.9 <= ratio <= 1.1:
        return AspectRatio.RATIO_1_1
    elif ratio > 1.1:
        return AspectRatio.RATIO_4_3
    else:
        return AspectRatio.RATIO_3_4


def get_target_dimensions(
    target_aspect_ratio: AspectRatio,
    max_resolution: int = 1080
) -> Tuple[int, int]:
    """
    根据目标宽高比获取目标分辨率
    
    Args:
        target_aspect_ratio: 目标宽高比
        max_resolution: 最大分辨率（短边）
        
    Returns:
        (width, height): 目标分辨率
    """
    if target_aspect_ratio == AspectRatio.RATIO_16_9:
        return (1920, 1080) if max_resolution >= 1080 else (1280, 720)
    elif target_aspect_ratio == AspectRatio.RATIO_9_16:
        return (1080, 1920) if max_resolution >= 1080 else (720, 1280)
    elif target_aspect_ratio == AspectRatio.RATIO_1_1:
        return (1080, 1080) if max_resolution >= 1080 else (720, 720)
    elif target_aspect_ratio == AspectRatio.RATIO_4_3:
        return (1440, 1080) if max_resolution >= 1080 else (960, 720)
    elif target_aspect_ratio == AspectRatio.RATIO_3_4:
        return (1080, 1440) if max_resolution >= 1080 else (720, 960)
    else:
        return (1920, 1080)


def calculate_crop_area(
    source_width: int,
    source_height: int,
    target_aspect_ratio: AspectRatio,
    alignment: Literal["center", "top", "bottom", "left", "right"] = "center"
) -> Tuple[int, int, int, int]:
    """
    计算裁剪区域，将源视频裁剪为目标宽高比
    
    采用智能居中裁剪策略
    
    Args:
        source_width: 源视频宽度
        source_height: 源视频高度
        target_aspect_ratio: 目标宽高比
        alignment: 对齐方式（center=居中, top/bottom=上下, left/right=左右）
        
    Returns:
        (x, y, width, height): 裁剪区域
    """
    # 处理 None 或无效值
    if source_width is None or source_height is None or source_width <= 0 or source_height <= 0:
        return (0, 0, source_width or 1920, source_height or 1080)
    
    # 计算目标宽高比数值
    ratio_map = {
        AspectRatio.RATIO_16_9: 16 / 9,    # 1.778
        AspectRatio.RATIO_9_16: 9 / 16,    # 0.5625
        AspectRatio.RATIO_1_1: 1.0,
        AspectRatio.RATIO_4_3: 4 / 3,      # 1.333
        AspectRatio.RATIO_3_4: 3 / 4,      # 0.75
    }
    target_ratio = ratio_map.get(target_aspect_ratio, 16 / 9)
    source_ratio = source_width / source_height
    
    if abs(source_ratio - target_ratio) < 0.01:
        # 已经是目标比例，无需裁剪
        return (0, 0, source_width, source_height)
    
    if source_ratio > target_ratio:
        # 源视频更宽，需要裁剪左右
        new_width = int(source_height * target_ratio)
        new_height = source_height
        
        if alignment == "left":
            x = 0
        elif alignment == "right":
            x = source_width - new_width
        else:  # center
            x = (source_width - new_width) // 2
        y = 0
    else:
        # 源视频更高，需要裁剪上下
        new_width = source_width
        new_height = int(source_width / target_ratio)
        
        if alignment == "top":
            y = 0
        elif alignment == "bottom":
            y = source_height - new_height
        else:  # center
            y = (source_height - new_height) // 2
        x = 0
    
    return (x, y, new_width, new_height)


def needs_aspect_ratio_adjustment(
    source_width: int,
    source_height: int,
    target_aspect_ratio: AspectRatio,
    tolerance: float = 0.1
) -> bool:
    """
    检查是否需要调整宽高比
    
    Args:
        source_width: 源视频宽度
        source_height: 源视频高度
        target_aspect_ratio: 目标宽高比
        tolerance: 允许的误差范围 (默认 10%)
        
    Returns:
        bool: 是否需要调整
    """
    # 处理 None 或无效值
    if source_width is None or source_height is None or source_width <= 0 or source_height <= 0:
        return False
    
    ratio_map = {
        AspectRatio.RATIO_16_9: 16 / 9,
        AspectRatio.RATIO_9_16: 9 / 16,
        AspectRatio.RATIO_1_1: 1.0,
        AspectRatio.RATIO_4_3: 4 / 3,
        AspectRatio.RATIO_3_4: 3 / 4,
    }
    target_ratio = ratio_map.get(target_aspect_ratio, 16 / 9)
    source_ratio = source_width / source_height
    
    return abs(source_ratio - target_ratio) / target_ratio > tolerance


def get_pexels_orientation(aspect_ratio: AspectRatio) -> str:
    """
    将宽高比转换为 Pexels API 的 orientation 参数
    
    Args:
        aspect_ratio: 宽高比
        
    Returns:
        str: Pexels API orientation 参数 (landscape/portrait/square)
    """
    if aspect_ratio in [AspectRatio.RATIO_16_9, AspectRatio.RATIO_4_3]:
        return "landscape"
    elif aspect_ratio in [AspectRatio.RATIO_9_16, AspectRatio.RATIO_3_4]:
        return "portrait"
    else:
        return "square"


def get_ffmpeg_crop_filter(
    source_width: int,
    source_height: int,
    target_aspect_ratio: AspectRatio,
    alignment: Literal["center", "top", "bottom", "left", "right"] = "center"
) -> str:
    """
    生成 FFmpeg 裁剪滤镜字符串
    
    Args:
        source_width: 源视频宽度
        source_height: 源视频高度
        target_aspect_ratio: 目标宽高比
        alignment: 对齐方式
        
    Returns:
        str: FFmpeg crop 滤镜 (e.g., "crop=1080:1920:420:0")
    """
    x, y, w, h = calculate_crop_area(
        source_width, source_height, target_aspect_ratio, alignment
    )
    return f"crop={w}:{h}:{x}:{y}"


def get_broll_crop_info(
    broll_width: int,
    broll_height: int,
    target_aspect_ratio: AspectRatio
) -> dict:
    """
    ⚠️ 已废弃，请使用 get_broll_fit_info()
    
    为 B-Roll 素材生成裁剪信息（用于 clip metadata）
    """
    return get_broll_fit_info(
        broll_width, broll_height, target_aspect_ratio,
        display_mode="pip",  # pip 模式用裁剪
        fit_mode=BRollFitMode.CROP
    )


def calculate_letterbox_params(
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
) -> Dict[str, Any]:
    """
    计算 letterbox/pillarbox 参数
    
    将源视频放入目标区域，保持原比例，空白区域填黑
    
    Args:
        source_width: 源视频宽度
        source_height: 源视频高度
        target_width: 目标区域宽度
        target_height: 目标区域高度
        
    Returns:
        dict: {
            scale_factor: 缩放比例,
            scaled_width: 缩放后宽度,
            scaled_height: 缩放后高度,
            pad_x: X方向填充（左右各 pad_x/2）,
            pad_y: Y方向填充（上下各 pad_y/2）,
            offset_x: 素材在目标中的X偏移,
            offset_y: 素材在目标中的Y偏移,
            mode: "letterbox" 或 "pillarbox" 或 "fit"
        }
    """
    if source_width <= 0 or source_height <= 0:
        return {
            "scale_factor": 1.0,
            "scaled_width": target_width,
            "scaled_height": target_height,
            "pad_x": 0,
            "pad_y": 0,
            "offset_x": 0,
            "offset_y": 0,
            "mode": "fit",
        }
    
    source_ratio = source_width / source_height
    target_ratio = target_width / target_height
    
    if abs(source_ratio - target_ratio) < 0.01:
        # 比例相同，直接缩放
        scale_factor = target_width / source_width
        return {
            "scale_factor": scale_factor,
            "scaled_width": target_width,
            "scaled_height": target_height,
            "pad_x": 0,
            "pad_y": 0,
            "offset_x": 0,
            "offset_y": 0,
            "mode": "fit",
        }
    
    if source_ratio > target_ratio:
        # 源视频更宽 → letterbox（上下黑边）
        # 宽度填满，高度按比例缩放
        scale_factor = target_width / source_width
        scaled_width = target_width
        scaled_height = int(source_height * scale_factor)
        pad_x = 0
        pad_y = target_height - scaled_height
        offset_x = 0
        offset_y = pad_y // 2
        mode = "letterbox"
    else:
        # 源视频更高 → pillarbox（左右黑边）
        # 高度填满，宽度按比例缩放
        scale_factor = target_height / source_height
        scaled_width = int(source_width * scale_factor)
        scaled_height = target_height
        pad_x = target_width - scaled_width
        pad_y = 0
        offset_x = pad_x // 2
        offset_y = 0
        mode = "pillarbox"
    
    return {
        "scale_factor": scale_factor,
        "scaled_width": scaled_width,
        "scaled_height": scaled_height,
        "pad_x": pad_x,
        "pad_y": pad_y,
        "offset_x": offset_x,
        "offset_y": offset_y,
        "mode": mode,
    }


def get_ffmpeg_letterbox_filter(
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
    background_color: str = "black"
) -> str:
    """
    生成 FFmpeg letterbox/pillarbox 滤镜
    
    Args:
        source_width: 源视频宽度
        source_height: 源视频高度
        target_width: 目标宽度
        target_height: 目标高度
        background_color: 背景颜色（默认黑色）
        
    Returns:
        str: FFmpeg 滤镜字符串，如 "scale=1920:-1,pad=1920:1080:0:270:black"
    """
    params = calculate_letterbox_params(
        source_width, source_height, target_width, target_height
    )
    
    if params["mode"] == "fit":
        # 比例相同，只需缩放
        return f"scale={target_width}:{target_height}"
    
    # 先缩放，再填充
    # scale: 缩放到计算的尺寸
    # pad: 填充到目标尺寸，居中放置
    return (
        f"scale={params['scaled_width']}:{params['scaled_height']},"
        f"pad={target_width}:{target_height}:{params['offset_x']}:{params['offset_y']}:{background_color}"
    )


def get_broll_fit_info(
    broll_width: int,
    broll_height: int,
    target_aspect_ratio: AspectRatio,
    display_mode: str = "fullscreen",
    fit_mode: BRollFitMode = BRollFitMode.LETTERBOX,
) -> Dict[str, Any]:
    """
    ★ 为 B-Roll 素材生成适配信息（用于 clip metadata）
    
    Args:
        broll_width: B-Roll 素材宽度
        broll_height: B-Roll 素材高度
        target_aspect_ratio: 主视频的目标宽高比
        display_mode: 显示模式 ("fullscreen" / "pip")
        fit_mode: 适配模式 (letterbox / crop)
        
    Returns:
        dict: 适配信息
    """
    # 获取目标分辨率
    target_dims = get_target_dimensions(target_aspect_ratio)
    target_width, target_height = target_dims
    
    # 检测源视频信息
    source_ratio = detect_aspect_ratio(broll_width, broll_height)
    needs_adjustment = needs_aspect_ratio_adjustment(
        broll_width, broll_height, target_aspect_ratio
    )
    
    result = {
        "source_width": broll_width,
        "source_height": broll_height,
        "source_aspect_ratio": source_ratio.value,
        "target_aspect_ratio": target_aspect_ratio.value,
        "target_width": target_width,
        "target_height": target_height,
        "display_mode": display_mode,
        "needs_adjustment": needs_adjustment,
    }
    
    if not needs_adjustment:
        # 比例匹配，无需调整
        result.update({
            "fit_mode": "none",
            "ffmpeg_filter": f"scale={target_width}:{target_height}",
            "letterbox_params": None,
            "crop_params": None,
        })
        return result
    
    # ★ 核心策略：fullscreen 用 letterbox，pip 可以用 crop
    if display_mode == "fullscreen":
        # 全屏模式：letterbox/pillarbox，完全覆盖原视频
        letterbox_params = calculate_letterbox_params(
            broll_width, broll_height, target_width, target_height
        )
        ffmpeg_filter = get_ffmpeg_letterbox_filter(
            broll_width, broll_height, target_width, target_height
        )
        result.update({
            "fit_mode": letterbox_params["mode"],  # "letterbox" 或 "pillarbox"
            "ffmpeg_filter": ffmpeg_filter,
            "letterbox_params": letterbox_params,
            "crop_params": None,
        })
    else:
        # pip 模式：可以裁剪或保持原样
        if fit_mode == BRollFitMode.CROP:
            crop_area = calculate_crop_area(
                broll_width, broll_height, target_aspect_ratio, "center"
            )
            ffmpeg_filter = get_ffmpeg_crop_filter(
                broll_width, broll_height, target_aspect_ratio, "center"
            )
            result.update({
                "fit_mode": "crop",
                "ffmpeg_filter": ffmpeg_filter,
                "letterbox_params": None,
                "crop_params": {
                    "x": crop_area[0],
                    "y": crop_area[1],
                    "width": crop_area[2],
                    "height": crop_area[3],
                },
            })
        else:
            # pip 也可以用 letterbox
            letterbox_params = calculate_letterbox_params(
                broll_width, broll_height, target_width, target_height
            )
            ffmpeg_filter = get_ffmpeg_letterbox_filter(
                broll_width, broll_height, target_width, target_height
            )
            result.update({
                "fit_mode": letterbox_params["mode"],
                "ffmpeg_filter": ffmpeg_filter,
                "letterbox_params": letterbox_params,
                "crop_params": None,
            })
    
    return result
