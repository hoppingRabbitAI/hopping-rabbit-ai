"""
分镜策略 Agent 模块

提供视频分镜功能，支持三种策略:
- scene: 场景分镜 (基于视觉变化检测)
- sentence: 分句分镜 (基于 ASR 断句)
- paragraph: 段落分镜 (基于语义分析)

设计原则:
- 分镜结果直接使用 SegmentationClip（与项目 clips 表对齐）
- 时间单位统一使用毫秒 (ms)
- 通过 parent_clip_id 支持递归分镜
"""

from .agent import ShotSegmentationAgent, get_shot_segmentation_agent
from .types import (
    SegmentationStrategy,
    SegmentationRequest,
    SegmentationResult,
    SegmentationClip,
    TranscriptSegment,
    SegmentationTask,
)
from .thumbnail import extract_thumbnails

__all__ = [
    # Agent
    "ShotSegmentationAgent",
    "get_shot_segmentation_agent",
    
    # Types
    "SegmentationStrategy",
    "SegmentationRequest",
    "SegmentationResult",
    "SegmentationClip",
    "TranscriptSegment",
    "SegmentationTask",
    
    # Utils
    "extract_thumbnails",
]
