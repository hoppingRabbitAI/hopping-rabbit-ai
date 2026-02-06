"""
Remotion Agent - 智能视觉编排系统

为知识类博主设计的视频视觉增强 Agent，实现：
1. 内容理解 - 识别主题、风格、受众
2. 结构分析 - 划分章节、识别内容类型、提取数据
3. 视觉编排 - 选择组件、设计动画、时间编排

设计文档: docs/REMOTION_AGENT_SPEC.md
"""

from .models import (
    # 内容理解
    ContentUnderstanding,
    ContentCategory,
    ContentTone,
    ContentDensity,
    TargetAudience,
    
    # 结构分析
    SegmentRole,
    ContentType,
    StructuredSegment,
    ListContext,
    ProcessContext,
    ExtractedNumber,
    ExtractedKeyword,
    ExtractedData,
    SegmentStructure,
    GlobalStructure,
    ChapterInfo,
    StructureAnalysisResult,
    
    # 视觉配置
    VisualConfig,
    CanvasConfig,
    PointListConfig,
    PointListItem,
    ProcessFlowConfig,
    ProcessFlowStep,
    OverlayConfig,
    MainVideoConfig,
    PipConfig,
    SubtitleConfig,
    BackgroundConfig,
    AnimationConfig,
)

from .stage2_structure import analyze_content_structure
from .stage3_visual import generate_visual_config

__all__ = [
    # 服务函数
    "analyze_content_structure",
    "generate_visual_config",
    
    # 模型
    "ContentUnderstanding",
    "ContentCategory",
    "ContentTone",
    "ContentDensity",
    "TargetAudience",
    "SegmentRole",
    "ContentType",
    "StructuredSegment",
    "ListContext",
    "ProcessContext",
    "ExtractedNumber",
    "ExtractedKeyword",
    "ExtractedData",
    "SegmentStructure",
    "GlobalStructure",
    "ChapterInfo",
    "StructureAnalysisResult",
    "VisualConfig",
    "CanvasConfig",
    "PointListConfig",
    "PointListItem",
    "ProcessFlowConfig",
    "ProcessFlowStep",
    "OverlayConfig",
    "MainVideoConfig",
    "PipConfig",
    "SubtitleConfig",
    "BackgroundConfig",
    "AnimationConfig",
]
