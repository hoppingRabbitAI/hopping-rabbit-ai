"""
分镜策略模块
"""

from .base import BaseSegmentationStrategy
from .scene import SceneDetectionStrategy
from .sentence import SentenceSegmentationStrategy
from .paragraph import ParagraphSegmentationStrategy

__all__ = [
    "BaseSegmentationStrategy",
    "SceneDetectionStrategy",
    "SentenceSegmentationStrategy",
    "ParagraphSegmentationStrategy",
]
