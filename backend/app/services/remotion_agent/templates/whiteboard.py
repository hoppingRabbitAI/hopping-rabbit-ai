"""
whiteboard - 白板讲解风模版

知识博主常用的内容呈现风格
"""

from .base import (
    TemplateConfig,
    PresentationModeConfig,
    StyleConfig,
    BackgroundStyleConfig,
    TypographyConfig,
    AnimationStyleConfig,
    ComponentsConfig,
    CanvasComponentConfig,
    OverlayComponentConfig,
    AnimationConfig,
    SubtitleComponentConfig,
    PipComponentConfig,
    register_template,
)


whiteboard_template = TemplateConfig(
    id="whiteboard",
    name="白板讲解风",
    description="画布为主、逻辑递进的知识分享风格，适合概念解释、方法论讲解",
    category="knowledge",
    
    presentation_mode=PresentationModeConfig(
        primary="canvas",
        talking_head_role="pip",
        info_reveal="progressive",
        canvas_persistence="persistent",
    ),
    
    style=StyleConfig(
        primary="#333333",
        secondary="#666666",
        accent="#4CAF50",
        
        background=BackgroundStyleConfig(
            type="paper",
            color="#FFFEF5",
            texture="paper",
        ),
        
        typography=TypographyConfig(
            font_family='"ZCOOL XiaoWei", "Noto Sans SC", sans-serif',
            heading_weight=700,
            body_weight=400,
        ),
        
        animation=AnimationStyleConfig(
            duration="normal",
            easing="ease-out",
        ),
        
        border_radius="medium",
    ),
    
    components=ComponentsConfig(
        canvas=CanvasComponentConfig(
            default_position="center",
            list_style="handwritten",
            flow_connector="arrow",
        ),
        
        overlay=OverlayComponentConfig(
            default_animation=AnimationConfig(
                enter="draw",
                exit="fade",
            ),
            highlight_box_style="handdrawn",
        ),
        
        subtitle=SubtitleComponentConfig(
            style="handwritten",
            background="none",
            highlight_color="#FFEB3B",
        ),
        
        pip=PipComponentConfig(
            position="bottom-center",
            size="medium",
            shape="rectangle",
        ),
    ),
)

# 注册模版
register_template(whiteboard_template)
