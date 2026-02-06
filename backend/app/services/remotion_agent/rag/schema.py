"""
RAG 知识库数据模型定义

标杆视频片段的结构化表示，用于检索增强生成。
"""

from typing import Optional, List, Literal
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum


class ContentType(str, Enum):
    """内容类型"""
    OPENER = "opener"                     # 开场hook
    PROBLEM_SETUP = "problem_setup"       # 问题引入
    CONCEPT = "concept"                   # 概念解释
    EXAMPLE = "example"                   # 举例说明
    DATA = "data"                         # 数据展示
    COMPARISON = "comparison"             # 对比分析
    QUOTE = "quote"                       # 引用/金句
    TRANSITION = "transition"             # 过渡
    SUMMARY = "summary"                   # 总结
    CTA = "cta"                          # 行动召唤


class LayoutMode(str, Enum):
    """布局模式"""
    MODE_A = "modeA"  # 人物全屏 + B-Roll画中画
    MODE_B = "modeB"  # 素材全屏 + 人物画中画
    MODE_C = "modeC"  # 纯素材无人物
    MODE_D = "modeD"  # 灵活切换


class BrollTriggerType(str, Enum):
    """B-Roll触发类型"""
    DATA_CITE = "data_cite"             # 数据引用
    EXAMPLE_MENTION = "example_mention"  # 举例说明
    COMPARISON = "comparison"            # 对比分析
    PRODUCT_MENTION = "product_mention"  # 产品/品牌提及
    PROCESS_DESC = "process_desc"        # 流程描述
    CONCEPT_VISUAL = "concept_visual"    # 概念可视化


class CanvasType(str, Enum):
    """画布类型"""
    POINT_LIST = "point-list"
    PROCESS_FLOW = "process-flow"
    COMPARISON = "comparison"
    CONCEPT_CARD = "concept-card"
    DATA_CHART = "data-chart"
    TIMELINE = "timeline"


class KeywordCardVariant(str, Enum):
    """关键词卡片变体"""
    DARK_SOLID = "dark-solid"
    LIGHT_SOLID = "light-solid"
    SEMI_TRANSPARENT = "semi-transparent"
    GRADIENT = "gradient"
    NUMBERED = "numbered"


class PipPosition(str, Enum):
    """画中画位置"""
    BOTTOM_RIGHT = "bottom-right"
    BOTTOM_LEFT = "bottom-left"
    TOP_RIGHT = "top-right"
    TOP_LEFT = "top-left"
    CENTER_RIGHT = "center-right"


class BenchmarkSource(BaseModel):
    """标杆来源信息"""
    video_id: str = Field(..., description="视频ID, 如 '001', '002'")
    video_title: str = Field(..., description="视频标题")
    channel: Optional[str] = Field(None, description="频道名称")
    timestamp_start: Optional[float] = Field(None, description="片段开始时间(秒)")
    timestamp_end: Optional[float] = Field(None, description="片段结束时间(秒)")


class VisualConfigSnippet(BaseModel):
    """视觉配置片段"""
    layout_mode: LayoutMode = Field(..., description="布局模式")
    canvas_type: Optional[CanvasType] = Field(None, description="画布类型")
    canvas_config: Optional[dict] = Field(None, description="画布配置")
    keyword_card: Optional[dict] = Field(None, description="关键词卡片配置")
    has_broll: bool = Field(False, description="是否有B-Roll")
    broll_description: Optional[str] = Field(None, description="B-Roll描述")
    pip_config: Optional[dict] = Field(None, description="画中画配置")
    transition: Optional[str] = Field(None, description="转场效果")


class BenchmarkSegment(BaseModel):
    """标杆视频片段 - RAG知识库核心数据结构"""
    
    id: str = Field(..., description="唯一ID")
    
    # 来源信息
    source: BenchmarkSource = Field(..., description="视频来源")
    
    # 输入文本
    input_text: str = Field(..., description="原始口播文本")
    input_text_clean: str = Field(..., description="清洗后的文本(用于检索)")
    
    # 内容分类
    content_type: ContentType = Field(..., description="内容类型")
    template_id: str = Field(..., description="适用模版ID")
    
    # B-Roll触发
    broll_trigger_type: Optional[BrollTriggerType] = Field(None, description="B-Roll触发类型")
    broll_trigger_pattern: Optional[str] = Field(None, description="触发的具体文本模式")
    
    # 视觉配置输出
    visual_config: VisualConfigSnippet = Field(..., description="视觉配置")
    
    # 推理说明
    reasoning: str = Field(..., description="为什么这样配置的解释")
    
    # 质量分数
    quality_score: float = Field(default=1.0, ge=0.0, le=1.0, description="质量分数")
    
    # 元数据
    tags: List[str] = Field(default_factory=list, description="标签")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    class Config:
        use_enum_values = True


class RAGQueryInput(BaseModel):
    """RAG查询输入"""
    query_text: str = Field(..., description="查询文本")
    template_id: Optional[str] = Field(None, description="模版ID过滤")
    content_type: Optional[ContentType] = Field(None, description="内容类型过滤")
    broll_trigger_type: Optional[BrollTriggerType] = Field(None, description="B-Roll触发类型过滤")
    top_k: int = Field(default=3, ge=1, le=10, description="返回结果数量")


class RAGQueryResult(BaseModel):
    """RAG查询结果"""
    segments: List[BenchmarkSegment] = Field(..., description="匹配的片段")
    scores: List[float] = Field(..., description="相似度分数")
    query_text: str = Field(..., description="原始查询文本")


# ===== 验证规则模型 =====

class ValidationError(BaseModel):
    """验证错误"""
    code: str = Field(..., description="错误代码")
    message: str = Field(..., description="错误信息")
    field: Optional[str] = Field(None, description="相关字段")
    severity: Literal["error", "warning"] = Field(default="error")


class ValidationResult(BaseModel):
    """验证结果"""
    is_valid: bool = Field(..., description="是否通过验证")
    errors: List[ValidationError] = Field(default_factory=list)
    warnings: List[ValidationError] = Field(default_factory=list)


# ===== B-Roll触发检测模型 =====

class BrollTrigger(BaseModel):
    """B-Roll触发检测结果"""
    trigger_type: BrollTriggerType = Field(..., description="触发类型")
    matched_text: str = Field(..., description="匹配的文本")
    start_index: int = Field(..., description="在原文中的起始位置")
    end_index: int = Field(..., description="在原文中的结束位置")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="置信度")
    suggested_broll: Optional[str] = Field(None, description="建议的B-Roll描述")
