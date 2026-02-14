"""
分层增强 RAG 数据模型
====================
增强策略 + 质量参考图的结构化表示。
"""

from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
from enum import Enum


# ── 枚举 ──────────────────────────────────────────

class ContentCategory(str, Enum):
    """分层内容类别"""
    FACE_PORTRAIT = "face_portrait"
    GARMENT = "garment"
    ACCESSORY = "accessory"
    PRODUCT = "product"
    SCENE = "scene"
    GENERIC = "generic"


class QualityTarget(str, Enum):
    """增强目标质量等级"""
    FASHION_EDITORIAL = "fashion_editorial"   # 时尚杂志封面级
    PRODUCT_CATALOG = "product_catalog"       # 电商产品图级
    REALISTIC_CASUAL = "realistic_casual"     # 自然真实风
    CINEMATIC = "cinematic"                   # 电影质感


class ReferenceStyle(str, Enum):
    """参考图风格"""
    FASHION_EDITORIAL = "fashion_editorial"
    ECOMMERCE = "ecommerce"
    LIFESTYLE = "lifestyle"
    STUDIO = "studio"
    CINEMATIC = "cinematic"


# ── 管线配置 ──────────────────────────────────────

class PipelineConfig(BaseModel):
    """增强管线配置"""
    steps: List[str] = Field(..., description="按顺序执行的增强步骤，如 ['skin_enhance', 'relight']")
    kling_params: Dict[str, Any] = Field(default_factory=dict, description="各步骤的 Kling API 参数")
    prompt_template: str = Field("", description="增强 prompt 模板，{original_description} 占位符")


# ── 增强策略 ──────────────────────────────────────

class EnhancementStrategy(BaseModel):
    """增强策略记录"""
    id: Optional[str] = None
    content_category: ContentCategory
    quality_target: QualityTarget
    description: str = Field(..., description="策略语义描述（用于 embedding）")
    pipeline_config: PipelineConfig
    metadata: Dict[str, Any] = Field(default_factory=dict)
    similarity: Optional[float] = None  # 检索时填充


class QualityReference(BaseModel):
    """质量参考图记录"""
    id: Optional[str] = None
    category: str
    style: str
    image_url: str
    description: str
    quality_score: float = 1.0
    source: Literal["manual", "auto"] = "manual"
    metadata: Dict[str, Any] = Field(default_factory=dict)
    similarity: Optional[float] = None


# ── 增强计划 (检索结果组合) ──────────────────────

class EnhancementPlan(BaseModel):
    """向量检索后组装的增强执行计划"""
    strategy: Optional[EnhancementStrategy] = None
    references: List[QualityReference] = Field(default_factory=list)
    content_category: ContentCategory = ContentCategory.GENERIC
    final_prompt: str = ""  # 组装后的完整 prompt


# ── LLM 分类结果 ─────────────────────────────────

class LayerClassification(BaseModel):
    """LLM 对分层内容的分类结果"""
    content_category: ContentCategory
    style_hint: str = Field("", description="风格描述，如 '自然光户外人像'")
    quality_assessment: str = Field("", description="当前质量评估，如 '发丝边缘粗糙，肤色偏暗'")
    is_face: bool = False
    is_full_body: bool = False
    has_text: bool = False
    dominant_colors: List[str] = Field(default_factory=list)
