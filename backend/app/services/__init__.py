# HoppingRabbit AI - Services
from .ai_video_creator import ai_video_creator, AIVideoCreatorService
from .transform_rules import (
    transform_engine,
    sequence_processor,
    EmotionType,
    ImportanceLevel,
    TransformRule,
    TransformRuleEngine,
    TransformParams,
    SegmentContext,
)
from .llm import llm_service, LLMService

# 可灵AI 客户端（推荐使用新客户端）
from .kling_client import get_kling_client, KlingClient, close_kling_client

__all__ = [
    # AI 成片服务
    "ai_video_creator",
    "AIVideoCreatorService",
    # 规则引擎
    "transform_engine",
    "sequence_processor",
    "EmotionType",
    "ImportanceLevel",
    "TransformRule",
    "TransformRuleEngine",
    "TransformParams",
    "SegmentContext",
    # LLM 服务
    "llm_service",
    "LLMService",
    # 可灵AI 客户端
    "get_kling_client",
    "KlingClient",
    "close_kling_client",
]