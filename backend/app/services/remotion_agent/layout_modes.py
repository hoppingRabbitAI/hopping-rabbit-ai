"""
布局模式管理

定义和管理 4 种布局模式：
- modeA: 人物全屏 + B-Roll画中画
- modeB: 素材全屏 + 人物画中画  
- modeC: 纯素材无人物
- modeD: 灵活切换
"""

from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
from enum import Enum


class LayoutMode(str, Enum):
    """布局模式枚举"""
    MODE_A = "modeA"  # 人物全屏 + B-Roll画中画 (适合口播为主)
    MODE_B = "modeB"  # 素材全屏 + 人物画中画 (适合素材展示)
    MODE_C = "modeC"  # 纯素材无人物 (适合纯图文)
    MODE_D = "modeD"  # 灵活切换 (根据内容动态切换)


class PipPosition(str, Enum):
    """画中画位置"""
    BOTTOM_RIGHT = "bottom-right"
    BOTTOM_LEFT = "bottom-left"
    TOP_RIGHT = "top-right"
    TOP_LEFT = "top-left"
    CENTER_RIGHT = "center-right"


class PipSize(str, Enum):
    """画中画尺寸"""
    SMALL = "small"    # 160x90
    MEDIUM = "medium"  # 280x158
    LARGE = "large"    # 400x225


class PipShape(str, Enum):
    """画中画形状"""
    RECTANGLE = "rectangle"
    CIRCLE = "circle"


# ============================================
# 布局模式配置
# ============================================

class PersonPipConfig(BaseModel):
    """人物画中画配置 (用于 modeB)"""
    position: PipPosition = PipPosition.BOTTOM_RIGHT
    size: PipSize = PipSize.MEDIUM
    shape: PipShape = PipShape.RECTANGLE
    border_radius: int = 12
    border_color: Optional[str] = None
    shadow: bool = True
    visible: bool = True


class BrollPipConfig(BaseModel):
    """B-Roll 画中画配置 (用于 modeA)"""
    position: PipPosition = PipPosition.TOP_RIGHT
    size: PipSize = PipSize.MEDIUM
    shape: PipShape = PipShape.RECTANGLE
    border_radius: int = 8
    border_color: Optional[str] = "#FFFFFF"
    shadow: bool = True


class LayoutModeConfig(BaseModel):
    """单个布局模式的完整配置"""
    mode: LayoutMode
    description: str
    
    # 主区域配置
    main_content: Literal["person", "broll", "canvas", "mixed"]
    
    # 画中画配置
    person_pip: Optional[PersonPipConfig] = None
    broll_pip: Optional[BrollPipConfig] = None
    
    # 画布配置
    canvas_area: Optional[Dict[str, Any]] = None
    
    # 字幕位置
    subtitle_position: Literal["bottom", "top"] = "bottom"
    subtitle_avoid_pip: bool = True
    
    # 叠加层限制
    max_overlays: int = 3
    overlay_safe_zones: List[str] = Field(default_factory=list)


# ============================================
# 预定义布局配置
# ============================================

LAYOUT_MODE_CONFIGS: Dict[LayoutMode, LayoutModeConfig] = {
    LayoutMode.MODE_A: LayoutModeConfig(
        mode=LayoutMode.MODE_A,
        description="人物全屏 + B-Roll画中画，适合以口播为主的内容",
        main_content="person",
        person_pip=None,  # 人物全屏，不需要 PiP
        broll_pip=BrollPipConfig(
            position=PipPosition.TOP_RIGHT,
            size=PipSize.MEDIUM,
            shape=PipShape.RECTANGLE,
        ),
        subtitle_position="bottom",
        max_overlays=3,
        overlay_safe_zones=["top-right"],  # B-Roll PiP 区域避让
    ),
    
    LayoutMode.MODE_B: LayoutModeConfig(
        mode=LayoutMode.MODE_B,
        description="素材全屏 + 人物画中画，适合展示产品、数据、图表",
        main_content="broll",
        person_pip=PersonPipConfig(
            position=PipPosition.BOTTOM_RIGHT,
            size=PipSize.MEDIUM,
            shape=PipShape.RECTANGLE,
        ),
        broll_pip=None,  # B-Roll 全屏
        subtitle_position="bottom",
        subtitle_avoid_pip=True,
        max_overlays=2,
        overlay_safe_zones=["bottom-right"],  # 人物 PiP 区域避让
    ),
    
    LayoutMode.MODE_C: LayoutModeConfig(
        mode=LayoutMode.MODE_C,
        description="纯素材无人物，适合纯图文展示、动画演示",
        main_content="canvas",
        person_pip=None,
        broll_pip=None,
        canvas_area={
            "x": "5%",
            "y": "10%",
            "width": "90%",
            "height": "70%",
        },
        subtitle_position="bottom",
        max_overlays=4,
        overlay_safe_zones=[],
    ),
    
    LayoutMode.MODE_D: LayoutModeConfig(
        mode=LayoutMode.MODE_D,
        description="灵活切换模式，根据内容动态在 A/B/C 之间切换",
        main_content="mixed",
        person_pip=PersonPipConfig(
            position=PipPosition.BOTTOM_RIGHT,
            size=PipSize.SMALL,
        ),
        broll_pip=BrollPipConfig(
            position=PipPosition.TOP_RIGHT,
            size=PipSize.MEDIUM,
        ),
        subtitle_position="bottom",
        max_overlays=3,
        overlay_safe_zones=["top-right", "bottom-right"],
    ),
}


def get_layout_config(mode: LayoutMode) -> LayoutModeConfig:
    """获取布局模式配置"""
    return LAYOUT_MODE_CONFIGS.get(mode, LAYOUT_MODE_CONFIGS[LayoutMode.MODE_A])


# ============================================
# 布局模式选择器
# ============================================

class LayoutModeSelector:
    """布局模式选择器"""
    
    @staticmethod
    def select_mode(
        has_broll: bool,
        broll_importance: str = "medium",
        content_type: str = "concept",
        template_id: str = "talking-head",
    ) -> LayoutMode:
        """
        根据内容特征选择布局模式
        
        Args:
            has_broll: 是否有 B-Roll 素材
            broll_importance: B-Roll 重要性 (high/medium/low)
            content_type: 内容类型
            template_id: 模版ID
            
        Returns:
            推荐的布局模式
        """
        # 白板模版优先使用 modeC
        if template_id == "whiteboard":
            if has_broll and broll_importance == "high":
                return LayoutMode.MODE_B
            return LayoutMode.MODE_C
        
        # 无 B-Roll 使用 modeA (人物全屏)
        if not has_broll:
            return LayoutMode.MODE_A
        
        # 有 B-Roll 根据重要性选择
        if broll_importance == "high":
            # B-Roll 是核心内容，全屏展示
            return LayoutMode.MODE_B
        elif broll_importance == "medium":
            # B-Roll 是辅助，画中画展示
            return LayoutMode.MODE_A
        else:
            # B-Roll 重要性低，可能不展示或小窗
            return LayoutMode.MODE_A
    
    @staticmethod
    def should_switch_mode(
        current_mode: LayoutMode,
        next_content_type: str,
        next_has_broll: bool,
        transition_threshold: float = 0.7,
    ) -> tuple[bool, Optional[LayoutMode]]:
        """
        判断是否需要切换布局模式
        
        用于 modeD (灵活切换) 的逻辑判断
        
        Returns:
            (是否切换, 新模式)
        """
        # 从人物模式切换到素材模式
        if current_mode == LayoutMode.MODE_A and next_has_broll:
            if next_content_type in ["product_mention", "data_cite", "example"]:
                return (True, LayoutMode.MODE_B)
        
        # 从素材模式切换回人物模式
        if current_mode == LayoutMode.MODE_B and not next_has_broll:
            if next_content_type in ["direct_talk", "summary", "transition"]:
                return (True, LayoutMode.MODE_A)
        
        return (False, None)


# ============================================
# 布局切换动画
# ============================================

class LayoutTransition(BaseModel):
    """布局切换配置"""
    from_mode: LayoutMode
    to_mode: LayoutMode
    transition_type: Literal["smooth", "cut", "fade"] = "smooth"
    duration_ms: int = 300
    at_ms: int = Field(description="切换时间点")


def create_layout_transition(
    from_mode: LayoutMode,
    to_mode: LayoutMode,
    at_ms: int,
    smooth: bool = True,
) -> LayoutTransition:
    """创建布局切换配置"""
    return LayoutTransition(
        from_mode=from_mode,
        to_mode=to_mode,
        transition_type="smooth" if smooth else "cut",
        duration_ms=300 if smooth else 0,
        at_ms=at_ms,
    )


# ============================================
# PiP 尺寸常量
# ============================================

PIP_SIZE_MAP = {
    PipSize.SMALL: {"width": 160, "height": 90},
    PipSize.MEDIUM: {"width": 280, "height": 158},
    PipSize.LARGE: {"width": 400, "height": 225},
}


def get_pip_dimensions(size: PipSize) -> Dict[str, int]:
    """获取 PiP 尺寸像素值"""
    return PIP_SIZE_MAP.get(size, PIP_SIZE_MAP[PipSize.MEDIUM])


# ============================================
# 位置坐标计算
# ============================================

def get_pip_position_coords(
    position: PipPosition,
    pip_size: Dict[str, int],
    canvas_width: int = 1920,
    canvas_height: int = 1080,
    margin: int = 20,
) -> Dict[str, int]:
    """
    计算 PiP 的实际坐标
    
    Args:
        position: PiP 位置枚举
        pip_size: PiP 尺寸 {width, height}
        canvas_width: 画布宽度
        canvas_height: 画布高度
        margin: 边距
        
    Returns:
        {x, y} 坐标
    """
    w, h = pip_size["width"], pip_size["height"]
    
    coords_map = {
        PipPosition.BOTTOM_RIGHT: {
            "x": canvas_width - w - margin,
            "y": canvas_height - h - margin - 80,  # 留出字幕空间
        },
        PipPosition.BOTTOM_LEFT: {
            "x": margin,
            "y": canvas_height - h - margin - 80,
        },
        PipPosition.TOP_RIGHT: {
            "x": canvas_width - w - margin,
            "y": margin,
        },
        PipPosition.TOP_LEFT: {
            "x": margin,
            "y": margin,
        },
        PipPosition.CENTER_RIGHT: {
            "x": canvas_width - w - margin,
            "y": (canvas_height - h) // 2,
        },
    }
    
    return coords_map.get(position, coords_map[PipPosition.BOTTOM_RIGHT])
