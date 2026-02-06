"""
Remotion Agent - Pydantic 模型定义

所有 Remotion Agent 相关的数据模型
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Literal
from enum import Enum


# ============================================
# Stage 1: 内容理解层 模型
# ============================================

class ContentCategory(str, Enum):
    """内容类别"""
    TUTORIAL = "tutorial"      # 教程
    ANALYSIS = "analysis"      # 分析
    REVIEW = "review"          # 评测
    STORY = "story"            # 故事
    OPINION = "opinion"        # 观点
    NEWS = "news"              # 资讯


class ContentTone(str, Enum):
    """情感基调"""
    EDUCATIONAL = "educational"  # 教育性
    INSPIRING = "inspiring"      # 励志
    CASUAL = "casual"            # 轻松
    SERIOUS = "serious"          # 严肃
    HUMOROUS = "humorous"        # 幽默


class TargetAudience(str, Enum):
    """目标受众"""
    PROFESSIONAL = "professional"  # 专业人士
    GENERAL = "general"            # 普通大众
    BEGINNER = "beginner"          # 初学者


class ContentDensity(str, Enum):
    """内容密度"""
    HIGH = "high"      # 高密度（信息量大）
    MEDIUM = "medium"  # 中等
    LOW = "low"        # 低密度（轻松闲聊）


class ContentUnderstanding(BaseModel):
    """Stage 1 输出: 内容理解结果"""
    topic: str = Field(description="视频主题 (一句话概括)")
    category: ContentCategory = Field(description="内容类别")
    tone: ContentTone = Field(description="情感基调")
    global_keywords: List[str] = Field(default_factory=list, description="全局关键词")
    target_audience: TargetAudience = Field(default=TargetAudience.GENERAL, description="目标受众")
    content_density: ContentDensity = Field(default=ContentDensity.MEDIUM, description="内容密度")


# ============================================
# Stage 2: 结构分析层 模型
# ============================================

class SegmentRole(str, Enum):
    """内容角色 - 这段内容在视频中的作用"""
    HOOK = "hook"              # 开场钩子
    POINT = "point"            # 核心要点
    EXPLANATION = "explanation"  # 解释说明
    EXAMPLE = "example"        # 举例论证
    DATA = "data"              # 数据支撑
    TRANSITION = "transition"  # 过渡连接
    SUMMARY = "summary"        # 总结回顾
    CTA = "cta"                # 行动号召
    FILLER = "filler"          # 填充内容


class ContentType(str, Enum):
    """内容类型 - 决定用什么视觉组件"""
    TITLE_DISPLAY = "title-display"       # 标题展示 → 大字标题组件
    DATA_HIGHLIGHT = "data-highlight"     # 数据强调 → 数字动画组件
    KEYWORD_EMPHASIS = "keyword-emphasis"  # 关键词强调 → 关键词卡片
    LIST_ITEM = "list-item"               # 列表项 → 画布列表组件
    PROCESS_STEP = "process-step"         # 流程步骤 → 流程图组件
    COMPARISON = "comparison"             # 对比内容 → 对比表格组件
    STORY_SCENE = "story-scene"           # 故事场景 → B-Roll
    CONCEPT_DEFINE = "concept-define"     # 概念定义 → 定义卡片
    QUOTE = "quote"                       # 引用观点 → 引用样式
    DIRECT_TALK = "direct-talk"           # 直接对话 → 保持口播
    NONE = "none"                         # 无需视觉增强


class ImportanceLevel(str, Enum):
    """重要程度"""
    CRITICAL = "critical"  # 核心论点、重要数据
    HIGH = "high"          # 要点内容、关键概念
    MEDIUM = "medium"      # 解释说明、一般案例
    LOW = "low"            # 过渡、填充内容


class ListContext(BaseModel):
    """列表项上下文"""
    list_id: str = Field(description="所属列表ID")
    item_index: int = Field(description="第几项 (1-based)")
    total_items: int = Field(description="总共几项")
    item_title: str = Field(description="该项的标题/摘要")


class ProcessContext(BaseModel):
    """流程步骤上下文"""
    process_id: str = Field(description="所属流程ID")
    step_index: int = Field(description="第几步 (1-based)")
    total_steps: int = Field(description="总共几步")
    step_title: str = Field(description="该步骤的标题")


class ExtractedNumber(BaseModel):
    """提取的数字数据"""
    value: str = Field(description="数值，如 '300%', '5倍', '100万'")
    label: str = Field(description="标签，如 '增长率', '提升', '用户数'")
    trend: Optional[Literal["up", "down", "neutral"]] = Field(None, description="趋势方向")


class ExtractedKeyword(BaseModel):
    """提取的关键词"""
    word: str = Field(description="关键词")
    importance: Literal["primary", "secondary"] = Field(description="重要性")


class ExtractedQuote(BaseModel):
    """提取的引用"""
    text: str = Field(description="引用文本")
    source: Optional[str] = Field(None, description="引用来源")


class ExtractedData(BaseModel):
    """提取的结构化数据"""
    numbers: List[ExtractedNumber] = Field(default_factory=list, description="数字数据")
    keywords: List[ExtractedKeyword] = Field(default_factory=list, description="关键词")
    quote: Optional[ExtractedQuote] = Field(None, description="引用")


class SegmentStructure(BaseModel):
    """单个片段的结构分析结果"""
    role: SegmentRole = Field(description="内容角色")
    content_type: ContentType = Field(description="内容类型")
    importance: ImportanceLevel = Field(default=ImportanceLevel.MEDIUM, description="重要程度")
    
    # 列表/流程上下文
    list_context: Optional[ListContext] = Field(None, description="列表项上下文")
    process_context: Optional[ProcessContext] = Field(None, description="流程步骤上下文")
    
    # 提取的数据
    extracted_data: Optional[ExtractedData] = Field(None, description="提取的结构化数据")
    
    # B-Roll 相关 (增强版)
    needs_broll: bool = Field(default=False, description="是否需要B-Roll")
    broll_keywords: List[str] = Field(default_factory=list, description="B-Roll搜索关键词")
    broll_trigger_type: Optional[str] = Field(None, description="B-Roll触发类型: data_cite|example_mention|comparison|product_mention|process_desc|concept_visual")
    broll_trigger_text: Optional[str] = Field(None, description="触发B-Roll的原文文本")
    broll_suggested_content: Optional[str] = Field(None, description="建议的B-Roll内容描述")
    broll_importance: str = Field(default="medium", description="B-Roll重要性: high|medium|low")
    
    # 布局模式建议
    suggested_layout_mode: Optional[str] = Field(None, description="建议的布局模式: modeA|modeB|modeC|modeD")


class StructuredSegment(BaseModel):
    """带结构分析的片段"""
    id: str = Field(description="片段ID")
    text: str = Field(description="片段文本")
    start_ms: int = Field(description="开始时间(毫秒)")
    end_ms: int = Field(description="结束时间(毫秒)")
    structure: SegmentStructure = Field(description="结构分析结果")


class ChapterInfo(BaseModel):
    """章节信息"""
    title: str = Field(description="章节标题")
    start_segment_id: str = Field(description="起始片段ID")
    end_segment_id: str = Field(description="结束片段ID")


class GlobalStructure(BaseModel):
    """全局结构信息"""
    has_point_list: bool = Field(default=False, description="是否有明确的要点列表结构")
    point_list_count: Optional[int] = Field(None, description="要点数量")
    
    has_process: bool = Field(default=False, description="是否有流程/步骤结构")
    process_step_count: Optional[int] = Field(None, description="步骤数量")
    
    has_comparison: bool = Field(default=False, description="是否有对比结构")
    
    chapters: List[ChapterInfo] = Field(default_factory=list, description="章节划分")


class StructureAnalysisResult(BaseModel):
    """Stage 2 完整输出"""
    segments: List[StructuredSegment] = Field(description="结构化片段列表")
    global_structure: GlobalStructure = Field(description="全局结构信息")


# ============================================
# Stage 3: 视觉编排层 模型
# ============================================

class AnimationConfig(BaseModel):
    """动画配置"""
    enter: Literal["fade", "slide-up", "slide-down", "zoom", "typewriter", "bounce", "draw"] = Field(default="fade")
    exit: Literal["fade", "slide-up", "slide-down", "zoom"] = Field(default="fade")
    duration_ms: Optional[int] = Field(None, description="动画时长")


# ---- 画布组件配置 ----

class PointListItem(BaseModel):
    """要点列表项"""
    id: str
    text: str
    reveal_at_ms: int = Field(description="何时显示这一项")
    highlight: Optional[Dict[str, Any]] = Field(None, description="高亮配置 {word, color}")


class PointListConfig(BaseModel):
    """要点列表画布配置"""
    title: Optional[str] = None
    subtitle: Optional[str] = None
    items: List[PointListItem] = Field(default_factory=list)
    style: Literal["numbered", "bulleted", "checked", "handwritten"] = "handwritten"
    position: Literal["left", "right", "center"] = "center"


class ProcessFlowStep(BaseModel):
    """流程步骤"""
    id: str
    text: str
    sub_text: Optional[str] = Field(None, description="副标题/说明")
    step_type: Literal["question", "concept", "explanation", "conclusion"] = "explanation"
    style: Optional[Dict[str, Any]] = Field(None, description="样式配置 {bordered, color}")
    activate_at_ms: int = Field(description="何时激活此步骤")


class ProcessFlowConfig(BaseModel):
    """流程图画布配置"""
    title: Optional[str] = None
    steps: List[ProcessFlowStep] = Field(default_factory=list)
    direction: Literal["horizontal", "vertical"] = "vertical"
    connector: Literal["arrow", "line", "none"] = "arrow"


class ComparisonRow(BaseModel):
    """对比表格行"""
    left: str
    right: str
    reveal_at_ms: int


class ComparisonConfig(BaseModel):
    """对比表格配置"""
    left_title: str
    right_title: str
    rows: List[ComparisonRow] = Field(default_factory=list)


class ConceptCardConfig(BaseModel):
    """概念卡片配置"""
    term: str = Field(description="术语，如 'MVP'")
    definition: str = Field(description="定义")
    key_points: List[str] = Field(default_factory=list, description="关键要点")
    reveal_at_ms: int


class CanvasConfig(BaseModel):
    """画布组件总配置 (带时间轴)"""
    segment_id: str = Field(description="关联的片段ID")
    start_ms: int = Field(description="开始时间(毫秒)")
    end_ms: int = Field(description="结束时间(毫秒)")
    
    type: Literal["point-list", "process-flow", "comparison-table", "concept-card"]
    point_list: Optional[PointListConfig] = None
    process_flow: Optional[ProcessFlowConfig] = None
    comparison_table: Optional[ComparisonConfig] = None
    concept_card: Optional[ConceptCardConfig] = None


# ---- 叠加组件配置 ----

class OverlayContent(BaseModel):
    """叠加组件内容（根据类型不同而不同）"""
    # KeywordCard
    title: Optional[str] = None
    text: Optional[str] = None
    variant: Optional[Literal["tip", "warning", "key", "quote"]] = None
    
    # DataNumber
    value: Optional[str] = None
    label: Optional[str] = None
    trend: Optional[Literal["up", "down", "neutral"]] = None
    
    # HighlightBox
    word: Optional[str] = None
    color: Optional[str] = None
    box_style: Optional[Literal["solid", "dashed", "handdrawn"]] = None
    
    # QuestionHook / ChapterTitle
    question: Optional[str] = None
    chapter_number: Optional[int] = None
    chapter_title: Optional[str] = None
    
    # Quote
    quote_text: Optional[str] = None
    source: Optional[str] = None
    
    # Progress
    current: Optional[int] = None
    total: Optional[int] = None


class OverlayConfig(BaseModel):
    """叠加组件配置"""
    id: str
    type: Literal[
        "chapter-title",
        "keyword-card",
        "data-number",
        "quote-block",
        "highlight-box",
        "progress-indicator",
        "definition-card",
        "question-hook"
    ]
    start_ms: int
    end_ms: int
    content: OverlayContent
    position: Literal[
        "center", "top", "bottom",
        "top-left", "top-right",
        "bottom-left", "bottom-right",
        "bottom-center"
    ] = "center"
    animation: AnimationConfig = Field(default_factory=AnimationConfig)


# ---- 主视频配置 ----

class PipConfig(BaseModel):
    """PiP 配置"""
    position: Literal[
        "bottom-right", "bottom-left",
        "top-right", "top-left",
        "bottom-center"
    ] = "bottom-center"
    size: Literal["small", "medium", "large"] = "medium"
    shape: Literal["rectangle", "circle"] = "rectangle"


class MainVideoConfig(BaseModel):
    """主视频配置"""
    url: Optional[str] = None
    default_mode: Literal["fullscreen", "pip"] = "pip"
    pip: PipConfig = Field(default_factory=PipConfig)


# ---- 字幕配置 ----

class SubtitleConfig(BaseModel):
    """字幕配置"""
    enabled: bool = True
    style: Literal["modern", "classic", "minimal", "handwritten"] = "handwritten"
    position: Literal["bottom", "top"] = "bottom"
    highlight_keywords: bool = True
    highlight_color: Optional[str] = "#FFEB3B"
    background: Literal["blur", "solid", "none"] = "none"


# ---- 背景配置 ----

class BackgroundConfig(BaseModel):
    """背景配置"""
    type: Literal["solid", "gradient", "paper", "whiteboard"] = "paper"
    color: Optional[str] = "#FFFEF5"
    gradient_colors: Optional[List[str]] = None
    texture: Optional[Literal["none", "paper", "grid", "dots"]] = "paper"


class PipConfigForVisual(BaseModel):
    """视觉配置中的 PiP 配置"""
    position: Literal[
        "bottom-right", "bottom-left",
        "top-right", "top-left",
        "bottom-center"
    ] = "bottom-center"
    size: Optional[Dict[str, int]] = Field(None, description="尺寸 {width, height}")
    visible: bool = True


# ---- 最终视觉配置 ----

class VisualConfig(BaseModel):
    """Stage 3 完整输出: 可渲染的 Remotion 配置"""
    version: str = "2.0"
    template: str = "whiteboard"
    duration_ms: int
    fps: int = 30
    
    background: BackgroundConfig = Field(default_factory=BackgroundConfig)
    main_video: MainVideoConfig = Field(default_factory=MainVideoConfig)
    canvas: List[CanvasConfig] = Field(default_factory=list, description="画布数组")
    overlays: List[OverlayConfig] = Field(default_factory=list, description="叠加组件数组")
    subtitles: SubtitleConfig = Field(default_factory=SubtitleConfig)
    pip: Optional[PipConfigForVisual] = Field(None, description="PiP 配置")
