"""
LangChain 输出解析器 - Pydantic 模型定义

所有 LLM 输出的结构化类型定义
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from enum import Enum


# ============================================
# 通用枚举类型
# ============================================

class EmotionType(str, Enum):
    """情绪类型"""
    EXCITED = "excited"    # 激动、兴奋
    SERIOUS = "serious"    # 严肃、认真
    HAPPY = "happy"        # 轻松、愉快
    SAD = "sad"            # 悲伤、遗憾
    NEUTRAL = "neutral"    # 平淡叙述


class ImportanceLevel(str, Enum):
    """重要性级别"""
    HIGH = "high"      # 核心观点
    MEDIUM = "medium"  # 普通内容
    LOW = "low"        # 过渡句


class SceneType(str, Enum):
    """场景类型"""
    TALKING_HEAD = "talking_head"    # 口播
    PRODUCT_SHOW = "product_show"    # 产品展示
    OUTDOOR = "outdoor"              # 户外
    INTERVIEW = "interview"          # 访谈
    PRESENTATION = "presentation"    # 演示
    OTHER = "other"


class TransitionType(str, Enum):
    """转场类型"""
    CUT = "cut"              # 硬切
    FADE = "fade"            # 淡入淡出
    ZOOM = "zoom"            # 缩放
    SLIDE = "slide"          # 滑动
    DISSOLVE = "dissolve"    # 溶解


# ============================================
# 一键成片相关模型
# ============================================

class SegmentAnalysis(BaseModel):
    """单个片段的情绪分析结果"""
    id: str = Field(description="片段ID")
    emotion: EmotionType = Field(default=EmotionType.NEUTRAL, description="情绪类型")
    importance: ImportanceLevel = Field(default=ImportanceLevel.MEDIUM, description="重要性级别")
    keywords: List[str] = Field(default_factory=list, description="关键词列表")
    focus_word: Optional[str] = Field(None, description="焦点词（强调词）")


class EmotionAnalysisResult(BaseModel):
    """批量情绪分析结果"""
    results: List[SegmentAnalysis] = Field(description="分析结果列表")


class SceneAnalysis(BaseModel):
    """场景分析结果"""
    scene_type: SceneType = Field(description="场景类型")
    subjects: List[str] = Field(default_factory=list, description="主体列表")
    background: str = Field(default="", description="背景描述")
    lighting: str = Field(default="normal", description="光照条件")
    motion_level: str = Field(default="low", description="运动程度: low/medium/high")


class TransitionSuggestion(BaseModel):
    """转场建议"""
    from_clip_id: str = Field(description="前一个片段ID")
    to_clip_id: str = Field(description="后一个片段ID")
    transition_type: TransitionType = Field(description="建议的转场类型")
    duration_ms: int = Field(default=500, description="转场时长(毫秒)")
    reason: str = Field(default="", description="建议原因")


class CameraMotionPlan(BaseModel):
    """运镜方案"""
    clip_id: str = Field(description="片段ID")
    motion_type: str = Field(description="运镜类型: static/zoom_in/zoom_out/pan_left/pan_right/ken_burns")
    start_scale: float = Field(default=1.0, description="起始缩放")
    end_scale: float = Field(default=1.0, description="结束缩放")
    center_x: float = Field(default=0.5, description="焦点X坐标")
    center_y: float = Field(default=0.5, description="焦点Y坐标")
    easing: str = Field(default="linear", description="缓动函数")


# ============================================
# Rabbit Hole 相关模型
# ============================================

class ScriptSegment(BaseModel):
    """脚本片段"""
    text: str = Field(description="台词内容")
    duration_hint: float = Field(default=3.0, description="建议时长(秒)")
    emotion_hint: EmotionType = Field(default=EmotionType.NEUTRAL, description="情绪提示")
    visual_hint: str = Field(default="", description="画面提示")


class VideoScript(BaseModel):
    """视频脚本"""
    title: str = Field(description="标题")
    segments: List[ScriptSegment] = Field(description="脚本片段列表")
    total_duration: float = Field(description="总时长(秒)")
    style: str = Field(default="professional", description="风格")


class BRollSuggestion(BaseModel):
    """B-Roll 建议"""
    timestamp_start: float = Field(description="开始时间(秒)")
    timestamp_end: float = Field(description="结束时间(秒)")
    description: str = Field(description="B-Roll 内容描述")
    keywords: List[str] = Field(default_factory=list, description="搜索关键词")
    source_hint: str = Field(default="stock", description="来源提示: stock/ai_generate/user_upload")


class ContentAnalysis(BaseModel):
    """内容分析结果（用于 Rabbit Hole 推荐）"""
    topics: List[str] = Field(description="主题列表")
    target_audience: str = Field(default="general", description="目标受众")
    content_type: str = Field(description="内容类型: tutorial/review/vlog/ad/news")
    suggested_features: List[str] = Field(default_factory=list, description="建议使用的 AI 功能")
    optimization_tips: List[str] = Field(default_factory=list, description="优化建议")


# ============================================
# 通用对话模型
# ============================================

class ChatMessage(BaseModel):
    """对话消息"""
    role: str = Field(description="角色: user/assistant/system")
    content: str = Field(description="消息内容")


class ChatResponse(BaseModel):
    """对话响应"""
    message: str = Field(description="回复内容")
    suggestions: List[str] = Field(default_factory=list, description="后续建议")
    actions: List[Dict[str, Any]] = Field(default_factory=list, description="可执行动作")


# ============================================
# Agent 工具调用模型
# ============================================

class ToolCall(BaseModel):
    """工具调用"""
    tool_name: str = Field(description="工具名称")
    arguments: Dict[str, Any] = Field(default_factory=dict, description="调用参数")
    reason: str = Field(default="", description="调用原因")


class AgentDecision(BaseModel):
    """Agent 决策结果"""
    thought: str = Field(description="思考过程")
    tool_calls: List[ToolCall] = Field(default_factory=list, description="工具调用列表")
    final_answer: Optional[str] = Field(None, description="最终答案（如果不需要工具）")
