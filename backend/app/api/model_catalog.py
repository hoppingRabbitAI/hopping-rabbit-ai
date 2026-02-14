"""
Lepus AI - 模型目录 API

为前端提供多模型参数目录，支持：
  GET /models/catalog                     → 完整目录
  GET /models/catalog/{provider}          → 单供应商
  GET /models/compatibility               → 兼容性检查（灰掉不支持的模型）
  GET /models/defaults/{provider}/{endpoint} → 参数默认值
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.services.video_generation.model_catalog import (
    get_catalog_dict,
    get_provider_catalog,
    get_param_defaults,
    check_compatibility,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/models", tags=["模型目录"])


@router.get("/catalog", summary="获取完整模型参数目录")
async def catalog_all() -> Dict[str, Any]:
    """
    返回所有 provider 的完整参数目录。
    前端用此数据渲染模型选择器和动态参数表单。

    Response 结构:
    ```json
    {
      "kling": {
        "provider": "kling",
        "display_name": "可灵 AI (Kling)",
        "status": "active",
        "endpoints": [
          {
            "name": "image_to_video",
            "params": [
              {
                "name": "cfg_scale",
                "type": "float",
                "default": 0.5,
                "ui_hint": "slider",
                "constraints": {"min": 0, "max": 1},
                "desc_zh": "...",
                ...
              }
            ]
          }
        ]
      },
      "veo": { ... },
      "seeddance": { ... }
    }
    ```
    """
    return get_catalog_dict()


@router.get("/catalog/{provider}", summary="获取单个供应商的参数目录")
async def catalog_provider(provider: str) -> Dict[str, Any]:
    """返回指定 provider 的目录，如 /models/catalog/kling"""
    data = get_provider_catalog(provider)
    if not data:
        raise HTTPException(
            status_code=404,
            detail=f"Provider '{provider}' not found. Available: kling, veo, seeddance",
        )
    return data


@router.get("/compatibility", summary="检查模型兼容性")
async def compatibility_check(
    capabilities: str = Query(
        ...,
        description="逗号分隔的能力要求，如 'image_tail' 或 'single_image,image_tail'",
        examples=["image_tail", "single_image", "text_only"],
    ),
) -> List[Dict[str, Any]]:
    """
    给定模板需要的能力，返回每个 provider×endpoint 是否兼容。
    前端用 compatible=false 的条目灰掉不支持的模型。

    例：模板需要 image_tail（转场首尾帧）：
      GET /models/compatibility?capabilities=image_tail

    返回:
    ```json
    [
      {"provider": "kling", "endpoint": "image_to_video", "compatible": true, ...},
      {"provider": "veo",   "endpoint": "image_to_video", "compatible": false,
       "missing_capabilities": ["image_tail"], ...}
    ]
    ```
    """
    caps = [c.strip() for c in capabilities.split(",") if c.strip()]
    if not caps:
        raise HTTPException(status_code=400, detail="capabilities 不能为空")
    return check_compatibility(caps)


@router.get("/defaults/{provider}/{endpoint}", summary="获取端点参数默认值")
async def defaults(provider: str, endpoint: str) -> Dict[str, Any]:
    """
    获取指定 provider×endpoint 所有参数的默认值。
    前端在用户选择模型后调用，一次性填充表单。

    例：GET /models/defaults/kling/image_to_video
    返回:
    ```json
    {
      "model_name": "kling-v2-6",
      "duration": "5",
      "mode": "pro",
      "cfg_scale": 0.5,
      "aspect_ratio": "16:9",
      "negative_prompt": "blurry, distorted, ..."
    }
    ```
    """
    data = get_param_defaults(provider, endpoint)
    if not data:
        raise HTTPException(
            status_code=404,
            detail=f"No defaults found for {provider}/{endpoint}",
        )
    return data
