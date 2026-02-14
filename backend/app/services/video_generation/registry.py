"""
Lepus AI - 模型注册表

管理所有视频生成模型和提供商
"""

import logging
from typing import Dict, List, Optional, Type

from .base import VideoGeneratorBase, ModelInfo

logger = logging.getLogger(__name__)


# ============================================
# 模型注册表
# ============================================

# 模型ID -> (提供商, 生成器类)
_model_registry: Dict[str, tuple] = {}

# 提供商 -> 生成器类
_provider_registry: Dict[str, Type[VideoGeneratorBase]] = {}

# 生成器实例缓存
_generator_instances: Dict[str, VideoGeneratorBase] = {}


def register_provider(provider: str, generator_class: Type[VideoGeneratorBase]):
    """
    注册提供商
    
    Args:
        provider: 提供商标识 (如 "kling", "google")
        generator_class: 生成器类
    """
    _provider_registry[provider] = generator_class
    
    # 自动注册该提供商的所有模型
    for model in generator_class.get_supported_models():
        _model_registry[model.id] = (provider, generator_class)
    
    logger.info(f"[Registry] 注册提供商: {provider}, 模型数: {len(generator_class.get_supported_models())}")


def register_model(model_id: str, provider: str, generator_class: Type[VideoGeneratorBase]):
    """
    手动注册单个模型
    
    Args:
        model_id: 模型ID
        provider: 提供商
        generator_class: 生成器类
    """
    _model_registry[model_id] = (provider, generator_class)


def get_generator(model_id: str) -> VideoGeneratorBase:
    """
    获取模型对应的生成器
    
    Args:
        model_id: 模型ID (如 "kling-v2-1-master", "veo-001")
    
    Returns:
        VideoGeneratorBase: 生成器实例
    
    Raises:
        ValueError: 模型未注册
    """
    if model_id not in _model_registry:
        available = list(_model_registry.keys())
        raise ValueError(f"模型 '{model_id}' 未注册。可用模型: {available}")
    
    provider, generator_class = _model_registry[model_id]
    
    # 复用生成器实例
    if provider not in _generator_instances:
        _generator_instances[provider] = generator_class()
    
    return _generator_instances[provider]


def get_generator_by_provider(provider: str) -> VideoGeneratorBase:
    """
    按提供商获取生成器
    
    Args:
        provider: 提供商标识
    
    Returns:
        VideoGeneratorBase: 生成器实例
    """
    if provider not in _provider_registry:
        raise ValueError(f"提供商 '{provider}' 未注册")
    
    if provider not in _generator_instances:
        _generator_instances[provider] = _provider_registry[provider]()
    
    return _generator_instances[provider]


def list_models(
    provider: Optional[str] = None,
    capability: Optional[str] = None,
    available_only: bool = True
) -> List[ModelInfo]:
    """
    列出所有可用模型
    
    Args:
        provider: 按提供商过滤
        capability: 按能力过滤 (text2video, image2video, etc.)
        available_only: 仅返回可用模型
    
    Returns:
        List[ModelInfo]: 模型列表
    """
    models = []
    
    for p, generator_class in _provider_registry.items():
        if provider and p != provider:
            continue
        
        for model in generator_class.get_supported_models():
            # 过滤不可用
            if available_only and not model.is_available:
                continue
            
            # 过滤能力
            if capability and capability not in model.capabilities:
                continue
            
            models.append(model)
    
    return models


def list_providers() -> List[Dict]:
    """
    列出所有提供商
    
    Returns:
        List[Dict]: 提供商列表
    """
    providers = []
    
    for provider, generator_class in _provider_registry.items():
        models = generator_class.get_supported_models()
        available_models = [m for m in models if m.is_available]
        
        providers.append({
            "id": provider,
            "name": _get_provider_name(provider),
            "total_models": len(models),
            "available_models": len(available_models),
            "capabilities": list(set(
                cap for m in models for cap in m.capabilities
            )),
        })
    
    return providers


def get_model_info(model_id: str) -> Optional[ModelInfo]:
    """
    获取模型详细信息
    
    Args:
        model_id: 模型ID
    
    Returns:
        ModelInfo: 模型信息
    """
    if model_id not in _model_registry:
        return None
    
    provider, generator_class = _model_registry[model_id]
    
    for model in generator_class.get_supported_models():
        if model.id == model_id:
            return model
    
    return None


def _get_provider_name(provider: str) -> str:
    """获取提供商显示名称"""
    names = {
        "kling": "可灵 AI (Kling)",
        "google": "Google Veo",
        "runway": "Runway",
        "pika": "Pika Labs",
        "stability": "Stability AI",
    }
    return names.get(provider, provider)


# ============================================
# 自动注册所有提供商
# ============================================

def _auto_register():
    """自动注册所有已实现的提供商"""
    
    # Kling AI
    from .kling_generator import KlingVideoGenerator
    register_provider("kling", KlingVideoGenerator)
    
    # Google Veo (预览)
    from .veo_generator import VeoVideoGenerator
    register_provider("google", VeoVideoGenerator)
    
    # TODO: 添加更多提供商
    # from .runway_generator import RunwayVideoGenerator
    # register_provider("runway", RunwayVideoGenerator)


# 启动时自动注册
_auto_register()
