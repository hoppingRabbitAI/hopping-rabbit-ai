"""
HoppingRabbit AI - 统一视频生成服务

支持多个模型提供商:
- Kling AI (可灵)
- Google Veo
- Runway
- Pika Labs
- 更多...

使用方式:
    from app.services.video_generation import get_generator, list_models
    
    # 列出所有可用模型
    models = list_models()
    
    # 获取生成器
    generator = get_generator("kling-v2-1-master")
    result = await generator.text_to_video(prompt="...")
"""

from .base import VideoGeneratorBase, VideoTask, VideoResult, ModelInfo
from .registry import (
    get_generator,
    list_models,
    list_providers,
    get_model_info,
    register_model,
)
from .kling_generator import KlingVideoGenerator

__all__ = [
    # 基类
    "VideoGeneratorBase",
    "VideoTask",
    "VideoResult",
    "ModelInfo",
    # 注册表
    "get_generator",
    "list_models",
    "list_providers",
    "get_model_info",
    "register_model",
    # 实现
    "KlingVideoGenerator",
]
