"""
模版基类和注册中心
"""

from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class PresentationModeConfig(BaseModel):
    """内容呈现模式配置"""
    primary: Literal["canvas", "talking-head", "split", "cinematic"]
    talking_head_role: Literal["main", "pip", "hidden"]
    info_reveal: Literal["progressive", "all-at-once", "narrative"]
    canvas_persistence: Literal["persistent", "segment-based", "none"]


class BackgroundStyleConfig(BaseModel):
    """背景样式配置"""
    type: Literal["solid", "gradient", "paper", "whiteboard"]
    color: Optional[str] = None
    gradient_colors: Optional[List[str]] = None
    texture: Optional[Literal["none", "paper", "grid", "dots"]] = None


class TypographyConfig(BaseModel):
    """字体配置"""
    font_family: str
    heading_weight: int
    body_weight: int


class AnimationStyleConfig(BaseModel):
    """动画风格配置"""
    duration: Literal["fast", "normal", "slow"]
    easing: str


class StyleConfig(BaseModel):
    """视觉风格配置"""
    primary: str
    secondary: str
    accent: str
    background: BackgroundStyleConfig
    typography: TypographyConfig
    animation: AnimationStyleConfig
    border_radius: Literal["none", "small", "medium", "large"]


class CanvasComponentConfig(BaseModel):
    """画布组件默认配置"""
    default_position: Literal["left", "right", "center"]
    list_style: Literal["numbered", "bulleted", "checked", "handwritten"]
    flow_connector: Literal["arrow", "line", "none"]


class AnimationConfig(BaseModel):
    """动画配置"""
    enter: Literal["fade", "slide-up", "slide-down", "zoom", "typewriter", "bounce", "draw"]
    exit: Literal["fade", "slide-up", "slide-down", "zoom"]


class OverlayComponentConfig(BaseModel):
    """叠加组件默认配置"""
    default_animation: AnimationConfig
    highlight_box_style: Literal["solid", "dashed", "handdrawn"]


class SubtitleComponentConfig(BaseModel):
    """字幕组件默认配置"""
    style: Literal["modern", "classic", "minimal", "handwritten"]
    background: Literal["blur", "solid", "none"]
    highlight_color: str


class PipComponentConfig(BaseModel):
    """PiP 组件默认配置"""
    position: Literal["bottom-right", "bottom-left", "top-right", "top-left", "bottom-center"]
    size: Literal["small", "medium", "large"]
    shape: Literal["rectangle", "circle"]


class ComponentsConfig(BaseModel):
    """组件配置集合"""
    canvas: CanvasComponentConfig
    overlay: OverlayComponentConfig
    subtitle: SubtitleComponentConfig
    pip: PipComponentConfig


class TemplateConfig(BaseModel):
    """完整模版配置"""
    id: str
    name: str
    description: str
    category: Literal["knowledge", "story", "review", "news"]
    
    presentation_mode: PresentationModeConfig
    style: StyleConfig
    components: ComponentsConfig


# 模版注册表
_templates: Dict[str, TemplateConfig] = {}


def register_template(template: TemplateConfig) -> None:
    """注册模版"""
    _templates[template.id] = template


def get_template(template_id: str = "whiteboard") -> TemplateConfig:
    """获取模版配置"""
    if template_id not in _templates:
        # 默认返回 whiteboard
        from .whiteboard import whiteboard_template
        return whiteboard_template
    return _templates[template_id]


def get_all_templates() -> List[TemplateConfig]:
    """获取所有模版"""
    return list(_templates.values())
