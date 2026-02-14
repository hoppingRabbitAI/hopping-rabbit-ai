"""
Lepus AI - Enhance & Style API 路由
五大新能力统一入口：皮肤美化 / AI 打光 / 换装 / AI 穿搭师 / AI 穿搭内容

PRD Reference: §4.1 API 端点
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import uuid
import logging
from datetime import datetime

from .auth import get_current_user_id
from ..services.ai_engine_registry import AIEngineRegistry
from ..tasks.enhance_style import process_enhance_style

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/enhance-style", tags=["Enhance & Style"])


# ============================================
# Supabase 工具
# ============================================

def _get_supabase():
    from ..services.supabase_client import supabase
    return supabase


def _create_ai_task(user_id: str, task_type: str, input_params: Dict, project_id: str = None) -> str:
    """创建 AI 任务记录（委托给共享工具函数）"""
    from ..utils.ai_task_helpers import create_ai_task
    return create_ai_task(
        user_id=user_id,
        task_type=task_type,
        input_params=input_params,
        project_id=project_id,
    )


# ============================================
# 请求模型
# ============================================

class SkinEnhanceRequest(BaseModel):
    """皮肤美化请求"""
    image_url: str = Field(..., description="输入图片 URL")
    intensity: str = Field("natural", description="强度: natural / moderate / max")
    custom_prompt: Optional[str] = Field(None, description="自定义美化描述")


class RelightRequest(BaseModel):
    """AI 打光请求"""
    image_url: str = Field(..., description="输入图片 URL")
    light_type: str = Field("natural", description="光照类型: natural / studio / golden_hour / dramatic / neon / soft")
    light_direction: str = Field("front", description="光源方向: front / left / right / back / top / bottom")
    light_color: str = Field("#FFFFFF", description="光照颜色 HEX")
    light_intensity: float = Field(0.7, ge=0, le=1, description="光照强度 0-1")
    custom_prompt: Optional[str] = Field(None, description="自定义光照描述")


class OutfitSwapRequest(BaseModel):
    """换装请求"""
    person_image_url: str = Field(..., description="人物图片 URL")
    garment_image_url: str = Field(..., description="衣物图片 URL")
    garment_type: str = Field("upper", description="衣物类型: upper / lower / full")
    custom_prompt: Optional[str] = Field(None, description="自定义换装描述")


class AIStylistRequest(BaseModel):
    """AI 穿搭师请求"""
    garment_image_url: str = Field(..., description="衣物图片 URL")
    style_tags: List[str] = Field(default_factory=list, description="风格标签: casual / street / korean / minimalist / vintage")
    occasion: str = Field("daily", description="场合: daily / work / date / travel / party")
    season: str = Field("spring", description="季节: spring / summer / autumn / winter")
    gender: str = Field("female", description="性别: male / female")
    num_variations: int = Field(1, ge=1, le=4, description="生成变体数")
    custom_prompt: Optional[str] = Field(None, description="自定义搭配描述")


class OutfitShotRequest(BaseModel):
    """AI 穿搭内容生成请求"""
    garment_images: List[str] = Field(..., description="衣物图片 URL 列表 (1-3 张)", min_length=1, max_length=3)
    mode: str = Field("content", description="模式: content (内容素材) / try_on (虚拟试穿)")
    content_type: str = Field("streetsnap", description="内容类型: cover / streetsnap / lifestyle / flat_lay / comparison")
    platform_preset: str = Field("xiaohongshu", description="平台预设: xiaohongshu / douyin / instagram / custom")
    gender: str = Field("female", description="模特性别: male / female")
    scene_prompt: Optional[str] = Field(None, description="场景描述 prompt")
    num_variations: int = Field(1, ge=1, le=4, description="生成变体数")
    # 虚拟试穿模式
    avatar_id: Optional[str] = Field(None, description="数字人 ID (try_on 模式必填)")
    # 高级参数
    body_type: Optional[str] = Field(None, description="体型: slim / average / plus_size")
    pose: Optional[str] = Field(None, description="姿势: standing / walking / sitting / dynamic")
    lighting_style: Optional[str] = Field(None, description="光线: studio / natural / dramatic / soft")
    camera_angle: Optional[str] = Field(None, description="角度: front / three_quarter / side / full_body")


# ============================================
# API 端点
# ============================================

@router.post("/skin-enhance", summary="皮肤美化", tags=["美颜增强"])
async def create_skin_enhance(
    request: SkinEnhanceRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id),
):
    """创建皮肤美化任务 — §2.1"""
    try:
        params = request.model_dump()
        ai_task_id = _create_ai_task(user_id, "skin_enhance", params, project_id=project_id)
        
        process_enhance_style.delay(
            task_id=ai_task_id,
            user_id=user_id,
            capability_id="skin_enhance",
            params=params,
        )
        
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
    except Exception as e:
        logger.error(f"[EnhanceStyle] 创建皮肤美化任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/relight", summary="AI 打光", tags=["美颜增强"])
async def create_relight(
    request: RelightRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id),
):
    """创建 AI 打光任务 — §2.2"""
    try:
        params = request.model_dump()
        ai_task_id = _create_ai_task(user_id, "relight", params, project_id=project_id)
        
        process_enhance_style.delay(
            task_id=ai_task_id,
            user_id=user_id,
            capability_id="relight",
            params=params,
        )
        
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
    except Exception as e:
        logger.error(f"[EnhanceStyle] 创建 AI 打光任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/outfit-swap", summary="换装", tags=["风格生成"])
async def create_outfit_swap(
    request: OutfitSwapRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id),
):
    """创建换装任务 — §2.3"""
    try:
        params = request.model_dump()
        ai_task_id = _create_ai_task(user_id, "outfit_swap", params, project_id=project_id)
        
        process_enhance_style.delay(
            task_id=ai_task_id,
            user_id=user_id,
            capability_id="outfit_swap",
            params=params,
        )
        
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
    except Exception as e:
        logger.error(f"[EnhanceStyle] 创建换装任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai-stylist", summary="AI 穿搭师", tags=["风格生成"])
async def create_ai_stylist(
    request: AIStylistRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id),
):
    """创建 AI 穿搭师任务 — §2.4"""
    try:
        params = request.model_dump()
        ai_task_id = _create_ai_task(user_id, "ai_stylist", params, project_id=project_id)
        
        process_enhance_style.delay(
            task_id=ai_task_id,
            user_id=user_id,
            capability_id="ai_stylist",
            params=params,
        )
        
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
    except Exception as e:
        logger.error(f"[EnhanceStyle] 创建 AI 穿搭师任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/outfit-shot", summary="AI 穿搭内容", tags=["风格生成"])
async def create_outfit_shot(
    request: OutfitShotRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id),
):
    """创建 AI 穿搭内容生成任务 — §2.5"""
    try:
        params = request.model_dump()
        ai_task_id = _create_ai_task(user_id, "outfit_shot", params, project_id=project_id)
        
        process_enhance_style.delay(
            task_id=ai_task_id,
            user_id=user_id,
            capability_id="outfit_shot",
            params=params,
        )
        
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
    except Exception as e:
        logger.error(f"[EnhanceStyle] 创建 AI 穿搭内容任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/engines", summary="引擎列表", tags=["系统"])
async def list_engines():
    """列出所有已注册的 AI 引擎"""
    return {
        "engines": AIEngineRegistry.list_engines(),
        "count": len(AIEngineRegistry.list_engines()),
    }
