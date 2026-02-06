"""
分镜策略 Agent - 类型定义

设计原则：
- 分镜 = Clip（视频类型的片段）
- 复用项目现有的 clips 表结构
- 通过 parent_clip_id 支持递归分割
- 时间单位统一使用毫秒 (ms)
"""

from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid


class SegmentationStrategy(str, Enum):
    """分镜策略枚举"""
    SCENE = "scene"           # 场景分镜 - 基于视觉变化
    SENTENCE = "sentence"     # 分句分镜 - 基于 ASR 断句
    PARAGRAPH = "paragraph"   # 段落分镜 - 基于语义分析


class SegmentationClip(BaseModel):
    """
    分镜结果 Clip - 与项目 clips 表结构对齐
    
    ⚠️ 时间单位统一：所有时间字段都使用【毫秒】(milliseconds)
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    track_id: Optional[str] = None
    asset_id: str
    clip_type: str = "video"
    
    # ============ 时间信息（毫秒 ms） ============
    start_time: int           # 时间轴上的起始位置 (ms)
    end_time: int             # 时间轴上的结束位置 (ms)
    source_start: int         # 原素材中的起始偏移 (ms)
    source_end: int           # 原素材中的结束位置 (ms)
    
    # ============ 递归分割支持 ============
    parent_clip_id: Optional[str] = None  # 父 Clip ID（用于追溯分割来源）
    
    # ============ 分镜元数据 ============
    name: Optional[str] = None
    transcript: Optional[str] = None      # 该分镜的文稿内容
    thumbnail_url: Optional[str] = None
    
    # ============ 通用元数据 ============
    metadata: dict = Field(default_factory=dict)
    
    @property
    def duration(self) -> int:
        """时长（毫秒）"""
        return self.end_time - self.start_time
    
    @property
    def source_duration(self) -> int:
        """源素材片段时长（毫秒）"""
        return self.source_end - self.source_start


class TranscriptSegment(BaseModel):
    """ASR 转写片段"""
    id: str
    text: str
    start: int    # 毫秒 (ms)
    end: int      # 毫秒 (ms)
    words: List[dict] = []
    speaker: Optional[str] = None


class SegmentationRequest(BaseModel):
    """
    分镜请求
    
    支持两种场景：
    1. 首次分镜：对整个 asset 进行分镜
    2. 递归分镜：对已有的 clip 进行二次分镜
    """
    session_id: str
    asset_id: str
    strategy: SegmentationStrategy
    
    # ============ 递归分镜支持 ============
    parent_clip_id: Optional[str] = Field(default=None, description="父 Clip ID，用于递归分镜")
    source_start_ms: Optional[int] = Field(default=None, description="分镜范围起始（毫秒），用于递归分镜")
    source_end_ms: Optional[int] = Field(default=None, description="分镜范围结束（毫秒），用于递归分镜")
    
    # ============ 场景分镜参数 ============
    scene_threshold: float = Field(default=27.0, description="场景检测阈值，越低越敏感")
    scene_min_length_ms: int = Field(default=500, description="最小场景时长（毫秒）")
    
    # ============ 分句分镜参数 ============
    min_sentence_duration_ms: int = Field(default=1500, description="最短句子时长（毫秒）")
    max_sentence_duration_ms: int = Field(default=30000, description="最长句子时长（毫秒）")
    merge_short_sentences: bool = Field(default=True, description="是否合并过短句子")
    
    # ============ 段落分镜参数 ============
    target_paragraph_count: Optional[int] = Field(default=None, description="目标段落数量")
    min_paragraph_duration_ms: int = Field(default=10000, description="最小段落时长（毫秒）")
    max_paragraph_duration_ms: int = Field(default=120000, description="最大段落时长（毫秒）")


class SegmentationResult(BaseModel):
    """
    分镜结果
    
    clips 直接对应 clips 表的数据结构，可以直接入库
    """
    session_id: str
    asset_id: str
    strategy: SegmentationStrategy
    clips: List[SegmentationClip]          # 分镜结果 Clips
    parent_clip_id: Optional[str] = None   # 递归分镜时的父 Clip ID
    total_duration_ms: int = 0             # 总时长（毫秒）
    clip_count: int = 0
    created_at: str = ""
    
    def __init__(self, **data):
        super().__init__(**data)
        if self.clip_count == 0:
            self.clip_count = len(self.clips)
        if not self.created_at:
            self.created_at = datetime.utcnow().isoformat()


class SegmentationTask(BaseModel):
    """分镜任务状态"""
    task_id: str
    session_id: str
    asset_id: str
    strategy: SegmentationStrategy
    parent_clip_id: Optional[str] = None   # 递归分镜时的父 Clip ID
    status: str = "pending"  # pending, running, completed, failed
    progress: int = 0
    current_step: Optional[str] = None
    result: Optional[SegmentationResult] = None
    error_message: Optional[str] = None
    created_at: str = ""
    completed_at: Optional[str] = None
