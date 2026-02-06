"""
talking_head - 口播主导风模版

适合观点表达、评论、故事讲述
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


talking_head_template = TemplateConfig(
    id="talking-head",
    name="口播主导风",
    description="保持口播画面为主，关键词弹出强调，适合观点表达、故事讲述",
    category="story",
    
    presentation_mode=PresentationModeConfig(
        primary="talking-head",
        talking_head_role="main",
        info_reveal="all-at-once",
        canvas_persistence="none",
    ),
    
    style=StyleConfig(
        primary="#1F2937",
        secondary="#4B5563",
        accent="#3B82F6",
        
        background=BackgroundStyleConfig(
            type="solid",
            color="transparent",
        ),
        
        typography=TypographyConfig(
            font_family='"Noto Sans SC", sans-serif',
            heading_weight=700,
            body_weight=500,
        ),
        
        animation=AnimationStyleConfig(
            duration="fast",
            easing="ease-in-out",
        ),
        
        border_radius="large",
    ),
    
    components=ComponentsConfig(
        canvas=CanvasComponentConfig(
            default_position="center",
            list_style="bulleted",
            flow_connector="line",
        ),
        
        overlay=OverlayComponentConfig(
            default_animation=AnimationConfig(
                enter="zoom",
                exit="fade",
            ),
            highlight_box_style="solid",
        ),
        
        subtitle=SubtitleComponentConfig(
            style="modern",
            background="blur",
            highlight_color="#60A5FA",
        ),
        
        pip=PipComponentConfig(
            position="bottom-right",
            size="small",
            shape="circle",
        ),
    ),
)

# 注册模版
register_template(talking_head_template)
