"""
Stage 3: 视觉编排层

将结构化内容转换为具体的 Remotion 视觉组件配置

职责:
1. 根据内容类型选择组件
2. 设计动画效果
3. 时间编排
4. 配置参数
5. 🆕 基于布局模式和 B-Roll 触发配置 PiP
6. 🆕 节奏控制
"""

import logging
from typing import List, Dict, Any, Optional
import uuid

from .models import (
    VisualConfig,
    BackgroundConfig,
    MainVideoConfig,
    PipConfig,
    PipConfigForVisual,
    SubtitleConfig,
    CanvasConfig,
    PointListConfig,
    PointListItem,
    ProcessFlowConfig,
    ProcessFlowStep,
    OverlayConfig,
    OverlayContent,
    AnimationConfig,
    StructuredSegment,
    GlobalStructure,
    SegmentRole,
    ContentType,
    ImportanceLevel,
)
from .templates import get_template, TemplateConfig
from .layout_modes import (
    LayoutMode,
    LayoutModeSelector,
    get_layout_config,
    get_pip_dimensions,
    PipSize,
)
from .pacing import PacingCalculator, PacingStyle
from .validator import validate_visual_config

logger = logging.getLogger(__name__)


def generate_visual_config(
    segments: List[StructuredSegment],
    global_structure: GlobalStructure,
    template_id: str = "whiteboard",
    main_video_url: Optional[str] = None,
    total_duration_ms: int = 60000,
    pip_position: str = "bottom-right",
    pacing_style: PacingStyle = PacingStyle.MEDIUM,
    validate: bool = True,
) -> VisualConfig:
    """
    生成视觉配置
    
    Args:
        segments: 结构化片段列表
        global_structure: 全局结构信息
        template_id: 模版 ID
        main_video_url: 主视频 URL
        total_duration_ms: 总时长（毫秒）
        pip_position: PiP 位置
        pacing_style: 节奏风格
        validate: 是否进行验证
        
    Returns:
        VisualConfig: 可渲染的 Remotion 配置
    """
    template = get_template(template_id)
    pacing = PacingCalculator(pacing_style)
    
    # 🆕 分析主布局模式
    primary_layout_mode = _determine_primary_layout_mode(segments, template_id)
    layout_config = get_layout_config(primary_layout_mode)
    
    # 基础配置
    config = VisualConfig(
        version="2.0",
        template=template_id,
        duration_ms=total_duration_ms,
        fps=30,
        background=_build_background(template),
        main_video=_build_main_video(template, main_video_url),
        subtitles=_build_subtitles(template),
        canvas=[],
        overlays=[],
        pip=_build_pip_config(layout_config, pip_position),
    )
    
    # 根据全局结构决定画布类型
    if global_structure.has_point_list:
        canvas_config = _build_point_list_canvas(segments, global_structure, template)
        if canvas_config:
            config.canvas.append(canvas_config)
    elif global_structure.has_process:
        canvas_config = _build_process_flow_canvas(segments, global_structure, template)
        if canvas_config:
            config.canvas.append(canvas_config)
    
    # 🆕 生成叠加组件 (使用节奏计算器)
    config.overlays = _build_overlays_with_pacing(segments, template, pacing)
    
    # 🆕 验证配置
    if validate:
        result = validate_visual_config(config.model_dump())
        if not result.is_valid:
            for error in result.errors:
                logger.warning(f"Visual config validation error: {error.code} - {error.message}")
        for warning in result.warnings:
            logger.info(f"Visual config warning: {warning.code} - {warning.message}")
    
    return config


def _determine_primary_layout_mode(
    segments: List[StructuredSegment],
    template_id: str,
) -> LayoutMode:
    """分析并确定主布局模式"""
    # 统计各布局模式的建议
    mode_counts = {mode: 0 for mode in LayoutMode}
    
    for seg in segments:
        suggested = seg.structure.suggested_layout_mode
        if suggested:
            try:
                mode = LayoutMode(suggested)
                mode_counts[mode] += 1
            except ValueError:
                pass
    
    # 统计需要 B-Roll 的片段比例
    broll_segments = [s for s in segments if s.structure.needs_broll]
    broll_ratio = len(broll_segments) / len(segments) if segments else 0
    
    # 决策逻辑
    if template_id == "whiteboard":
        return LayoutMode.MODE_C  # 白板模版默认纯内容模式
    
    if broll_ratio > 0.5:
        # B-Roll 需求高，使用灵活切换
        return LayoutMode.MODE_D
    elif broll_ratio > 0.3:
        # 中等 B-Roll 需求，人物为主
        return LayoutMode.MODE_A
    else:
        # 低 B-Roll 需求，人物全屏
        return LayoutMode.MODE_A


def _build_pip_config(
    layout_config,
    pip_position: str,
) -> PipConfigForVisual:
    """基于布局模式构建 PiP 配置"""
    # 如果布局模式指定了人物 PiP 配置
    if layout_config.person_pip:
        pip_size = get_pip_dimensions(layout_config.person_pip.size)
        return PipConfigForVisual(
            position=layout_config.person_pip.position.value,
            size=pip_size,
            visible=layout_config.person_pip.visible,
        )
    
    # 默认配置
    return PipConfigForVisual(
        position=pip_position,
        size={"width": 280, "height": 158},
        visible=True,
    )


def _build_overlays_with_pacing(
    segments: List[StructuredSegment],
    template: TemplateConfig,
    pacing: PacingCalculator,
) -> List[OverlayConfig]:
    """使用节奏计算器生成叠加组件"""
    overlays = []
    overlay_id = 0
    
    for seg in segments:
        structure = seg.structure
        
        # 跳过低重要性和无需增强的片段
        if structure.importance == ImportanceLevel.LOW:
            continue
        if structure.content_type == ContentType.NONE:
            continue
        if structure.content_type == ContentType.DIRECT_TALK:
            continue
        
        overlay = _create_overlay_for_segment_with_pacing(
            seg, template, pacing, overlay_id
        )
        if overlay:
            overlays.append(overlay)
            overlay_id += 1
    
    return overlays


def _create_overlay_for_segment_with_pacing(
    seg: StructuredSegment,
    template: TemplateConfig,
    pacing: PacingCalculator,
    overlay_id: int,
) -> Optional[OverlayConfig]:
    """为单个片段创建叠加组件 (带节奏控制)"""
    structure = seg.structure
    content_type = structure.content_type
    
    # 根据内容类型决定叠加层类型
    overlay_type = _map_content_type_to_overlay(content_type, structure.role)
    if not overlay_type:
        return None
    
    # 使用节奏计算器计算时间
    content_length = len(_get_overlay_text(seg))
    start_ms, end_ms = pacing.calculate_overlay_timing(
        overlay_type,
        seg.start_ms,
        content_length,
    )
    
    # 确保不超出片段时间
    end_ms = min(end_ms, seg.end_ms + 1000)  # 允许延长 1 秒
    
    # 构建内容
    content = _build_overlay_content(seg, overlay_type)
    
    # 确定位置
    position = _determine_overlay_position(content_type, template)
    
    return OverlayConfig(
        id=f"overlay_{overlay_id}",
        type=overlay_type,
        start_ms=start_ms,
        end_ms=end_ms,
        content=content,
        position=position,
        animation=AnimationConfig(enter="fade", exit="fade", duration_ms=300),
    )


def _get_overlay_text(seg: StructuredSegment) -> str:
    """获取叠加层显示的文本"""
    structure = seg.structure
    
    if structure.extracted_data:
        if structure.extracted_data.keywords:
            return structure.extracted_data.keywords[0].word
        if structure.extracted_data.numbers:
            return structure.extracted_data.numbers[0].value
        if structure.extracted_data.quote:
            return structure.extracted_data.quote.text
    
    return seg.text[:20]


def _map_content_type_to_overlay(
    content_type: ContentType,
    role: SegmentRole,
) -> Optional[str]:
    """映射内容类型到叠加层类型"""
    mapping = {
        ContentType.DATA_HIGHLIGHT: "data-number",
        ContentType.KEYWORD_EMPHASIS: "keyword-card",
        ContentType.CONCEPT_DEFINE: "keyword-card",
        ContentType.QUOTE: "quote-block",
    }
    
    # 特殊角色处理
    if role == SegmentRole.HOOK:
        return "question-hook"
    
    return mapping.get(content_type)


def _build_overlay_content(seg: StructuredSegment, overlay_type: str) -> OverlayContent:
    """根据叠加类型构建内容"""
    structure = seg.structure
    
    if overlay_type == "data-number":
        if structure.extracted_data and structure.extracted_data.numbers:
            num = structure.extracted_data.numbers[0]
            return OverlayContent(
                value=num.value,
                label=num.label,
                trend=num.trend,
            )
    
    elif overlay_type == "keyword-card":
        if structure.extracted_data and structure.extracted_data.keywords:
            kw = structure.extracted_data.keywords[0]
            variant = "key" if structure.content_type == ContentType.CONCEPT_DEFINE else "tip"
            return OverlayContent(text=kw.word, variant=variant)
        return OverlayContent(text=seg.text[:20], variant="tip")
    
    elif overlay_type == "quote-block":
        if structure.extracted_data and structure.extracted_data.quote:
            quote = structure.extracted_data.quote
            return OverlayContent(quote_text=quote.text, source=quote.source)
    
    elif overlay_type == "question-hook":
        return OverlayContent(question=seg.text)
    
    # 默认
    return OverlayContent(text=seg.text[:50])


def _determine_overlay_position(
    content_type: ContentType,
    template: TemplateConfig,
) -> str:
    """确定叠加层位置"""
    position_map = {
        ContentType.DATA_HIGHLIGHT: "top-right",
        ContentType.KEYWORD_EMPHASIS: "center",
        ContentType.CONCEPT_DEFINE: "center",
        ContentType.QUOTE: "center",
    }
    return position_map.get(content_type, "center")


def _build_background(template: TemplateConfig) -> BackgroundConfig:
    """构建背景配置"""
    bg = template.style.background
    return BackgroundConfig(
        type=bg.type,
        color=bg.color,
        gradient_colors=bg.gradient_colors,
        texture=bg.texture,
    )


def _build_main_video(
    template: TemplateConfig,
    video_url: Optional[str]
) -> MainVideoConfig:
    """构建主视频配置"""
    pip_cfg = template.components.pip
    
    # 根据模版的呈现模式决定默认显示模式
    default_mode = "fullscreen"
    if template.presentation_mode.talking_head_role == "pip":
        default_mode = "pip"
    
    return MainVideoConfig(
        url=video_url,
        default_mode=default_mode,
        pip=PipConfig(
            position=pip_cfg.position,
            size=pip_cfg.size,
            shape=pip_cfg.shape,
        ),
    )


def _build_subtitles(template: TemplateConfig) -> SubtitleConfig:
    """构建字幕配置"""
    sub_cfg = template.components.subtitle
    return SubtitleConfig(
        enabled=True,
        style=sub_cfg.style,
        position="bottom",
        highlight_keywords=True,
        highlight_color=sub_cfg.highlight_color,
        background=sub_cfg.background,
    )


def _build_point_list_canvas(
    segments: List[StructuredSegment],
    global_structure: GlobalStructure,
    template: TemplateConfig,
) -> Optional[CanvasConfig]:
    """构建要点列表画布"""
    items = []
    start_ms = None
    end_ms = None
    segment_id = None
    
    for seg in segments:
        if seg.structure.list_context:
            ctx = seg.structure.list_context
            items.append(PointListItem(
                id=f"item_{ctx.item_index}",
                text=ctx.item_title or seg.text[:50],
                reveal_at_ms=seg.start_ms,
                highlight=None,  # 可以从 extracted_data 中提取高亮词
            ))
            if start_ms is None:
                start_ms = seg.start_ms
                segment_id = seg.id
            end_ms = seg.end_ms
    
    # 如果没有找到列表项，使用降级逻辑
    if not items:
        for i, seg in enumerate(segments):
            if seg.structure.role == SegmentRole.POINT:
                items.append(PointListItem(
                    id=f"item_{i}",
                    text=seg.text[:50],
                    reveal_at_ms=seg.start_ms,
                ))
                if start_ms is None:
                    start_ms = seg.start_ms
                    segment_id = seg.id
                end_ms = seg.end_ms
    
    if not items:
        return None
    
    canvas_cfg = template.components.canvas
    
    return CanvasConfig(
        segment_id=segment_id or "default",
        start_ms=start_ms or 0,
        end_ms=end_ms or 60000,
        type="point-list",
        point_list=PointListConfig(
            title=None,  # 可以从全局结构中提取
            items=items,
            style=canvas_cfg.list_style,
            position=canvas_cfg.default_position,
        ),
    )


def _build_process_flow_canvas(
    segments: List[StructuredSegment],
    global_structure: GlobalStructure,
    template: TemplateConfig,
) -> Optional[CanvasConfig]:
    """构建流程图画布"""
    steps = []
    start_ms = None
    end_ms = None
    segment_id = None
    
    for seg in segments:
        if seg.structure.process_context:
            ctx = seg.structure.process_context
            
            # 根据角色确定步骤类型
            step_type = "explanation"
            if seg.structure.role == SegmentRole.HOOK:
                step_type = "question"
            elif seg.structure.content_type == ContentType.CONCEPT_DEFINE:
                step_type = "concept"
            elif seg.structure.role == SegmentRole.SUMMARY:
                step_type = "conclusion"
            
            steps.append(ProcessFlowStep(
                id=f"step_{ctx.step_index}",
                text=ctx.step_title or seg.text[:60],
                step_type=step_type,
                style={"bordered": step_type == "question", "color": "#E53935" if step_type == "question" else None},
                activate_at_ms=seg.start_ms,
            ))
            
            if start_ms is None:
                start_ms = seg.start_ms
                segment_id = seg.id
            end_ms = seg.end_ms
    
    if not steps:
        return None
    
    canvas_cfg = template.components.canvas
    
    return CanvasConfig(
        segment_id=segment_id or "default",
        start_ms=start_ms or 0,
        end_ms=end_ms or 60000,
        type="process-flow",
        process_flow=ProcessFlowConfig(
            steps=steps,
            direction="vertical",
            connector=canvas_cfg.flow_connector,
        ),
    )


def _build_overlays(
    segments: List[StructuredSegment],
    template: TemplateConfig,
) -> List[OverlayConfig]:
    """构建叠加组件列表"""
    overlays = []
    overlay_cfg = template.components.overlay
    
    for seg in segments:
        structure = seg.structure
        
        # 数据高亮 → DataNumber
        if structure.content_type == ContentType.DATA_HIGHLIGHT:
            if structure.extracted_data and structure.extracted_data.numbers:
                for num_data in structure.extracted_data.numbers:
                    overlays.append(_create_data_number_overlay(
                        seg, num_data, overlay_cfg
                    ))
        
        # 关键词强调 → KeywordCard
        elif structure.content_type == ContentType.KEYWORD_EMPHASIS:
            if structure.extracted_data and structure.extracted_data.keywords:
                for kw_data in structure.extracted_data.keywords:
                    if kw_data.importance == "primary":
                        overlays.append(_create_keyword_card_overlay(
                            seg, kw_data.word, overlay_cfg
                        ))
        
        # 概念定义 → KeywordCard (key 变体)
        elif structure.content_type == ContentType.CONCEPT_DEFINE:
            term = seg.text[:20]  # 简化处理
            overlays.append(_create_keyword_card_overlay(
                seg, term, overlay_cfg, variant="key"
            ))
        
        # 开场钩子 → QuestionHook
        elif structure.role == SegmentRole.HOOK and "？" in seg.text:
            overlays.append(_create_question_hook_overlay(seg, overlay_cfg))
        
        # 引用 → QuoteBlock
        elif structure.content_type == ContentType.QUOTE:
            if structure.extracted_data and structure.extracted_data.quote:
                quote = structure.extracted_data.quote
                overlays.append(_create_quote_overlay(seg, quote, overlay_cfg))
    
    # 添加进度指示器（如果有列表结构）
    # 这里可以根据需要添加
    
    return overlays


def _create_data_number_overlay(
    seg: StructuredSegment,
    num_data,
    overlay_cfg,
) -> OverlayConfig:
    """创建数字动画叠加组件"""
    return OverlayConfig(
        id=f"data_{uuid.uuid4().hex[:8]}",
        type="data-number",
        start_ms=seg.start_ms,
        end_ms=seg.end_ms,
        content=OverlayContent(
            value=num_data.value,
            label=num_data.label,
            trend=num_data.trend,
        ),
        position="top-right",
        animation=AnimationConfig(
            enter="zoom",
            exit="fade",
        ),
    )


def _create_keyword_card_overlay(
    seg: StructuredSegment,
    keyword: str,
    overlay_cfg,
    variant: str = "tip",
) -> OverlayConfig:
    """创建关键词卡片叠加组件"""
    return OverlayConfig(
        id=f"kw_{uuid.uuid4().hex[:8]}",
        type="keyword-card",
        start_ms=seg.start_ms,
        end_ms=min(seg.end_ms, seg.start_ms + 4000),  # 最多显示 4 秒
        content=OverlayContent(
            text=keyword,
            variant=variant,
        ),
        position="center",
        animation=AnimationConfig(
            enter=overlay_cfg.default_animation.enter,
            exit=overlay_cfg.default_animation.exit,
        ),
    )


def _create_question_hook_overlay(
    seg: StructuredSegment,
    overlay_cfg,
) -> OverlayConfig:
    """创建问题钩子叠加组件"""
    return OverlayConfig(
        id=f"hook_{uuid.uuid4().hex[:8]}",
        type="question-hook",
        start_ms=seg.start_ms,
        end_ms=min(seg.end_ms, seg.start_ms + 5000),  # 最多显示 5 秒
        content=OverlayContent(
            question=seg.text,
        ),
        position="center",
        animation=AnimationConfig(
            enter="zoom",
            exit="fade",
        ),
    )


def _create_quote_overlay(
    seg: StructuredSegment,
    quote_data,
    overlay_cfg,
) -> OverlayConfig:
    """创建引用叠加组件"""
    return OverlayConfig(
        id=f"quote_{uuid.uuid4().hex[:8]}",
        type="quote-block",
        start_ms=seg.start_ms,
        end_ms=seg.end_ms,
        content=OverlayContent(
            quote_text=quote_data.text,
            source=quote_data.source,
        ),
        position="center",
        animation=AnimationConfig(
            enter="fade",
            exit="fade",
        ),
    )
