"""
HoppingRabbit AI - 统一视频生成 API

提供模型选择层，支持多个提供商:
- Kling AI (可灵)
- Google Veo
- Runway (TODO)
- Pika Labs (TODO)

使用方式:
1. GET /api/video-gen/models - 获取所有可用模型
2. POST /api/video-gen/text2video - 文生视频（指定 model）
3. POST /api/video-gen/image2video - 图生视频
4. GET /api/video-gen/tasks/{task_id} - 查询任务状态
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import logging
from datetime import datetime

from ..services.video_generation import (
    get_generator,
    list_models,
    list_providers,
    get_model_info,
    ModelInfo,
)
from .auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/video-gen", tags=["统一视频生成"])


# ============================================
# 请求模型
# ============================================

class Text2VideoRequest(BaseModel):
    """文生视频请求"""
    prompt: str = Field(..., min_length=1, max_length=2500, description="提示词")
    model: str = Field("kling-v2-1-master", description="模型ID")
    duration: int = Field(5, ge=5, le=10, description="时长(秒)")
    aspect_ratio: str = Field("16:9", description="宽高比")
    
    # 可选参数
    negative_prompt: Optional[str] = Field(None, max_length=2500, description="负向提示词")
    cfg_scale: Optional[float] = Field(None, ge=0, le=1, description="提示词相关性")
    mode: Optional[str] = Field(None, description="生成模式 (std/pro)")


class Image2VideoRequest(BaseModel):
    """图生视频请求"""
    image: str = Field(..., description="图片 URL 或 Base64")
    model: str = Field("kling-v2-5-turbo", description="模型ID")
    prompt: Optional[str] = Field("", max_length=2500, description="运动提示词")
    duration: int = Field(5, ge=5, le=10, description="时长(秒)")
    
    # 可选参数
    image_tail: Optional[str] = Field(None, description="尾帧图片（首尾帧模式）")
    negative_prompt: Optional[str] = Field(None, description="负向提示词")
    aspect_ratio: Optional[str] = Field(None, description="宽高比")


class TaskResponse(BaseModel):
    """任务响应"""
    success: bool = True
    task_id: str
    provider: str
    model: str
    status: str
    message: Optional[str] = None
    created_at: datetime


class TaskStatusResponse(BaseModel):
    """任务状态响应"""
    task_id: str
    provider: str
    model: str
    status: str
    progress: int = 0
    message: Optional[str] = None
    result: Optional[Dict[str, Any]] = None


# ============================================
# 模型列表 API
# ============================================

@router.get("/providers", summary="获取所有提供商")
async def get_providers():
    """
    获取所有视频生成提供商列表
    
    返回:
    - id: 提供商标识
    - name: 显示名称
    - total_models: 模型总数
    - available_models: 可用模型数
    - capabilities: 支持的能力
    """
    return {
        "success": True,
        "providers": list_providers(),
    }


@router.get("/models", summary="获取所有可用模型")
async def get_models(
    provider: Optional[str] = Query(None, description="按提供商过滤"),
    capability: Optional[str] = Query(None, description="按能力过滤: text2video, image2video"),
    include_unavailable: bool = Query(False, description="包含不可用模型"),
):
    """
    获取所有可用的视频生成模型
    
    返回模型列表，每个模型包含:
    - id: 模型标识（用于调用）
    - name: 显示名称
    - provider: 提供商
    - capabilities: 支持的能力
    - max_duration: 最大时长
    - credits_per_generation: 积分消耗
    - is_available: 是否可用
    """
    models = list_models(
        provider=provider,
        capability=capability,
        available_only=not include_unavailable,
    )
    
    return {
        "success": True,
        "total": len(models),
        "models": [m.model_dump() for m in models],
    }


@router.get("/models/{model_id}", summary="获取模型详情")
async def get_model_detail(model_id: str):
    """获取指定模型的详细信息"""
    
    model = get_model_info(model_id)
    
    if not model:
        raise HTTPException(
            status_code=404,
            detail=f"模型 '{model_id}' 不存在"
        )
    
    return {
        "success": True,
        "model": model.model_dump(),
    }


# ============================================
# 视频生成 API
# ============================================

@router.post("/text2video", response_model=TaskResponse, summary="文生视频")
async def create_text2video(
    request: Text2VideoRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    文生视频 - 统一接口
    
    根据指定的 model 路由到相应的提供商（Kling, Veo 等）
    """
    try:
        # 检查模型是否存在
        model_info = get_model_info(request.model)
        if not model_info:
            raise HTTPException(
                status_code=400,
                detail=f"模型 '{request.model}' 不存在"
            )
        
        if not model_info.is_available:
            raise HTTPException(
                status_code=400,
                detail=f"模型 '{request.model}' 当前不可用"
            )
        
        if "text2video" not in model_info.capabilities:
            raise HTTPException(
                status_code=400,
                detail=f"模型 '{request.model}' 不支持文生视频"
            )
        
        # 获取生成器
        generator = get_generator(request.model)
        
        # 构建参数
        options = {}
        if request.negative_prompt:
            options["negative_prompt"] = request.negative_prompt
        if request.cfg_scale is not None:
            options["cfg_scale"] = request.cfg_scale
        if request.mode:
            options["mode"] = request.mode
        
        # 调用生成
        task = await generator.text_to_video(
            prompt=request.prompt,
            model=request.model,
            duration=request.duration,
            aspect_ratio=request.aspect_ratio,
            **options,
        )
        
        logger.info(f"[VideoGen] 文生视频任务创建: task_id={task.task_id}, model={request.model}")
        
        return TaskResponse(
            task_id=task.task_id,
            provider=task.provider,
            model=task.model,
            status=task.status.value,
            message=task.message,
            created_at=task.created_at,
        )
        
    except HTTPException:
        raise
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        logger.error(f"[VideoGen] 文生视频失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/image2video", response_model=TaskResponse, summary="图生视频")
async def create_image2video(
    request: Image2VideoRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    图生视频 - 统一接口
    
    根据指定的 model 路由到相应的提供商
    """
    try:
        # 检查模型
        model_info = get_model_info(request.model)
        if not model_info:
            raise HTTPException(
                status_code=400,
                detail=f"模型 '{request.model}' 不存在"
            )
        
        if not model_info.is_available:
            raise HTTPException(
                status_code=400,
                detail=f"模型 '{request.model}' 当前不可用"
            )
        
        if "image2video" not in model_info.capabilities:
            raise HTTPException(
                status_code=400,
                detail=f"模型 '{request.model}' 不支持图生视频"
            )
        
        # 获取生成器
        generator = get_generator(request.model)
        
        # 构建参数
        options = {}
        if request.image_tail:
            options["image_tail"] = request.image_tail
        if request.negative_prompt:
            options["negative_prompt"] = request.negative_prompt
        if request.aspect_ratio:
            options["aspect_ratio"] = request.aspect_ratio
        
        # 调用生成
        task = await generator.image_to_video(
            image=request.image,
            model=request.model,
            prompt=request.prompt or "",
            duration=request.duration,
            **options,
        )
        
        logger.info(f"[VideoGen] 图生视频任务创建: task_id={task.task_id}, model={request.model}")
        
        return TaskResponse(
            task_id=task.task_id,
            provider=task.provider,
            model=task.model,
            status=task.status.value,
            message=task.message,
            created_at=task.created_at,
        )
        
    except HTTPException:
        raise
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        logger.error(f"[VideoGen] 图生视频失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tasks/{task_id}", summary="查询任务状态")
async def get_task_status(
    task_id: str,
    model: str = Query(..., description="模型ID（用于确定查询端点）"),
    user_id: str = Depends(get_current_user_id),
):
    """
    查询任务状态
    
    需要提供 model 参数以确定使用哪个提供商查询
    """
    try:
        generator = get_generator(model)
        task = await generator.get_task_status(task_id, model)
        
        # 如果完成，获取结果
        result = None
        if task.status.value == "completed":
            video_result = await generator.get_result(task_id, model)
            if video_result:
                result = {
                    "video_url": video_result.video_url,
                    "video_id": video_result.video_id,
                    "duration": video_result.duration,
                }
        
        return TaskStatusResponse(
            task_id=task.task_id,
            provider=task.provider,
            model=task.model,
            status=task.status.value,
            progress=task.progress,
            message=task.message,
            result=result,
        )
        
    except Exception as e:
        logger.error(f"[VideoGen] 查询任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
