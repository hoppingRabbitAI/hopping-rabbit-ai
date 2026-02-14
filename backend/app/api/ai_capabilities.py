"""
AI 能力 API
提供视频 AI 处理能力的 REST 接口

路由:
- POST /api/ai-capabilities/tasks: 创建任务
- GET /api/ai-capabilities/tasks/{task_id}: 获取任务状态
- GET /api/ai-capabilities/tasks: 列出会话任务
- GET /api/ai-capabilities/events/{session_id}: SSE 事件流
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List, AsyncGenerator
from datetime import datetime
import asyncio
import json
import uuid

from app.services.ai_capability_service import (
    get_ai_capability_service,
    CapabilityTask,
    CapabilityType,
    TaskStatus,
    TaskEvent,
    normalize_capability_type,
)
from .auth import get_current_user_id, get_current_user_id_optional

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-capabilities", tags=["AI Capabilities"])


# ==========================================
# 请求/响应模型
# ==========================================

class CreateTaskRequest(BaseModel):
    """创建任务请求"""
    capability_type: str = Field(..., description="能力类型: background-replace, add-broll, etc.")
    clip_id: str = Field(..., description="片段 ID")
    session_id: Optional[str] = Field(None, description="会话 ID（可选，缺失时自动生成）")
    prompt: str = Field(..., description="用户提示词")
    keyframe_url: Optional[str] = Field(None, description="关键帧图片 URL")
    mask_data_url: Optional[str] = Field(None, description="Mask 数据 URL (base64)")
    user_id: Optional[str] = Field(None, description="用户 ID（用于任务持久化）")
    project_id: Optional[str] = Field(None, description="项目 ID（用于任务持久化）")
    
    class Config:
        json_schema_extra = {
            "example": {
                "capability_type": "background-replace",
                "clip_id": "clip-123",
                "session_id": None,
                "prompt": "日落时分的海滩，金色阳光洒在海面上",
                "keyframe_url": "https://example.com/keyframe.jpg",
                "mask_data_url": None
            }
        }


class TaskResponse(BaseModel):
    """任务响应"""
    id: str
    capability_type: str
    clip_id: str
    session_id: str
    status: str
    prompt: Optional[str] = None
    mask_url: Optional[str] = None
    keyframe_url: Optional[str] = None
    result_url: Optional[str] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    @classmethod
    def from_task(cls, task: CapabilityTask) -> "TaskResponse":
        return cls(
            id=task.id,
            capability_type=task.capability_type.value,
            clip_id=task.clip_id,
            session_id=task.session_id,
            status=task.status.value,
            prompt=task.prompt,
            mask_url=task.mask_url,
            keyframe_url=task.keyframe_url,
            result_url=task.result_url,
            error=task.error,
            created_at=task.created_at,
            updated_at=task.updated_at,
        )


class TaskListResponse(BaseModel):
    """任务列表响应"""
    tasks: List[TaskResponse]
    total: int


# ==========================================
# API 端点
# ==========================================

@router.post("/preview", response_model=TaskResponse)
async def create_preview_task(
    request: CreateTaskRequest,
    user_id: Optional[str] = Depends(get_current_user_id_optional)
):
    """
    创建预览任务（两步工作流第一步）
    
    与 /tasks 端点类似，但生成的结果不会自动应用到 clip，
    而是返回预览图片供用户确认。确认后调用 /tasks/{id}/apply 应用结果。
    
    工作流:
    1. 前端提交 mask + prompt → 调用此端点
    2. 后端生成预览图片 → 返回预览 URL
    3. 前端展示预览 → 用户确认/拒绝
    4. 用户确认 → 调用 /tasks/{id}/apply 应用结果
    
    支持的能力类型:
    - background-replace: 换背景/图像编辑（支持 mask）
    - style-transfer: 风格迁移
    - omni_image / omni-image: 图像编辑（Compositor）
    
    ★ 治本：自动从 Authorization header 获取 user_id，确保任务持久化
    """
    try:
        # 验证能力类型（兼容下划线/短横线别名）
        normalized_capability_type = normalize_capability_type(request.capability_type)
        try:
            CapabilityType(normalized_capability_type)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的能力类型: {request.capability_type}"
            )
        
        # ★ 治本：优先使用 header 中的 user_id，其次使用请求体中的
        effective_user_id = user_id or request.user_id
        
        # session_id 可选：未提供时用 project_id 兜底，再无则自动生成 UUID
        effective_session_id = request.session_id or request.project_id or str(uuid.uuid4())
        
        service = get_ai_capability_service()
        task = await service.create_preview_task(
            capability_type=normalized_capability_type,
            clip_id=request.clip_id,
            session_id=effective_session_id,
            prompt=request.prompt,
            keyframe_url=request.keyframe_url,
            mask_data_url=request.mask_data_url,
            user_id=effective_user_id,
            project_id=request.project_id,
        )
        
        logger.info(f"[AICapabilityAPI] 创建预览任务成功: {task.id}, user_id={effective_user_id}")
        return TaskResponse.from_task(task)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[AICapabilityAPI] 创建预览任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tasks/{task_id}/apply", response_model=TaskResponse)
async def apply_preview(task_id: str):
    """
    应用预览结果到 clip（两步工作流第二步）
    
    将预览任务生成的图片/视频应用到对应的 clip。
    
    前提条件:
    - 任务必须已完成 (status=completed)
    - 任务必须有结果 (result_url 不为空)
    
    返回:
    - 成功: 更新后的任务信息
    - 失败: 404 任务不存在，400 任务状态不正确
    """
    service = get_ai_capability_service()
    task = await service.apply_preview(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或状态不正确")
    
    return TaskResponse.from_task(task)


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str):
    """
    获取任务状态
    
    返回任务的当前状态和结果（如果已完成）
    """
    service = get_ai_capability_service()
    task = await service.get_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    return TaskResponse.from_task(task)


@router.get("/tasks/{task_id}/status")
async def get_task_status(task_id: str):
    """
    轻量查询任务状态（直接读数据库，适用于回调模式任务的轮询补偿）
    """
    from ..services.supabase_client import supabase
    try:
        result = supabase.table("tasks").select(
            "id, status, progress, output_url, output_asset_id, status_message"
        ).eq("id", task_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="任务不存在")
        return result.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))





# ==========================================
# SSE 事件流
# ==========================================

async def event_generator(session_id: str) -> AsyncGenerator[str, None]:
    """生成 SSE 事件流"""
    service = get_ai_capability_service()
    queue = await service.subscribe(session_id)
    
    try:
        # 发送初始连接确认
        yield f"event: connected\ndata: {json.dumps({'session_id': session_id})}\n\n"
        
        while True:
            try:
                # 等待事件，超时后发送心跳
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                
                # 发送事件
                event_data = event.to_dict()
                yield f"event: {event.event_type}\ndata: {json.dumps(event_data)}\n\n"
                
            except asyncio.TimeoutError:
                # 发送心跳保持连接
                yield f"event: heartbeat\ndata: {json.dumps({'timestamp': datetime.utcnow().isoformat()})}\n\n"
                
    except asyncio.CancelledError:
        logger.info(f"[SSE] 连接取消: session={session_id}")
    except Exception as e:
        logger.error(f"[SSE] 事件流错误: {e}")
    finally:
        await service.unsubscribe(session_id, queue)


@router.get("/events/{session_id}")
async def subscribe_events(session_id: str):
    """
    订阅会话的任务事件流 (SSE)
    
    事件类型:
    - connected: 连接成功
    - progress: 进度更新
    - completed: 任务完成
    - failed: 任务失败
    - heartbeat: 心跳（每30秒）
    """
    return StreamingResponse(
        event_generator(session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲
        }
    )
