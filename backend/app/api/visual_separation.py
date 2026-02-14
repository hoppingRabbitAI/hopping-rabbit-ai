"""
视觉元素分离 API
================
POST /api/visual-separation/separate         - 提交分离任务
GET  /api/visual-separation/tasks/{task_id}   - 查询分离任务状态（快捷路由，也可用 /api/tasks/{task_id}）

任务通过 tasks 表统一管理，前端轮询标准 /api/tasks/{task_id} 即可。
此处提供额外的便捷端点以获取带结构化 result_metadata 的结果。
"""

import logging
from uuid import uuid4
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import get_current_user_id
from app.services.supabase_client import supabase
from app.services.visual_separation_service import (
    SeparationType,
    run_separation_task,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/visual-separation", tags=["Visual Separation"])


# ==========================================
# 请求/响应 Schema
# ==========================================

class SeparateRequest(BaseModel):
    """分离请求"""
    image_url: str = Field(..., description="源图片 URL（缩略图或视频帧）")
    separation_type: str = Field(
        default=SeparationType.PERSON_BACKGROUND.value,
        description="分离类型: person_background | person_clothing | person_accessory | layer_separation"
    )
    clip_id: Optional[str] = Field(None, description="关联的 clip ID（可选，用于回写 mask URL）")
    shot_id: Optional[str] = Field(None, description="关联的 shot ID（可选）")
    project_id: Optional[str] = Field(None, description="项目 ID（可选，用于任务归档）")
    enhance: bool = Field(True, description="是否在分层后执行 AI 质量增强")


class SeparateResponse(BaseModel):
    """分离响应"""
    task_id: str
    status: str = "pending"
    message: str = "分离任务已创建"


class SemanticLabels(BaseModel):
    """语义标签"""
    foreground: Optional[str] = None
    foreground_clothing: Optional[str] = None
    background: Optional[str] = None
    scene: Optional[str] = None
    has_person: Optional[bool] = None


class SeparationTaskResult(BaseModel):
    """分离任务结果"""
    task_id: str
    status: str
    progress: int = 0
    status_message: Optional[str] = None
    error_message: Optional[str] = None
    mask_url: Optional[str] = None
    foreground_url: Optional[str] = None
    background_url: Optional[str] = None
    enhanced_foreground_url: Optional[str] = None
    midground_url: Optional[str] = None
    original_width: Optional[int] = None
    original_height: Optional[int] = None
    separation_type: Optional[str] = None
    layer_count: Optional[int] = None
    semantic_labels: Optional[SemanticLabels] = None
    enhancement_info: Optional[dict] = None


# ==========================================
# 端点
# ==========================================

@router.post("/separate", response_model=SeparateResponse)
async def create_separation_task(
    request: SeparateRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """
    创建视觉分离任务

    流程：
    1. 在 tasks 表创建任务记录
    2. 启动后台任务执行分离
    3. 返回 task_id，前端轮询 /api/tasks/{task_id} 获取进度
    """

    # 验证分离类型
    valid_types = [t.value for t in SeparationType]
    if request.separation_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的分离类型: {request.separation_type}，可选: {valid_types}"
        )

    # 验证 image_url
    if not request.image_url or not request.image_url.startswith("http"):
        raise HTTPException(status_code=400, detail="image_url 必须是有效的 HTTP(S) URL")

    task_id = str(uuid4())
    now = datetime.utcnow().isoformat()

    # 写入 tasks 表
    task_record = {
        "id": task_id,
        "user_id": user_id,
        "task_type": "visual_separation",
        "status": "pending",
        "progress": 0,
        "status_message": "等待处理...",
        "input_params": {
            "image_url": request.image_url,
            "separation_type": request.separation_type,
            "clip_id": request.clip_id,
            "shot_id": request.shot_id,
        },
        "created_at": now,
        "updated_at": now,
    }
    if request.clip_id:
        task_record["clip_id"] = request.clip_id
    if request.project_id:
        task_record["project_id"] = request.project_id

    try:
        supabase.table("tasks").insert(task_record).execute()
    except Exception as e:
        logger.error(f"[VisualSeparation] 创建任务失败: {e}")
        raise HTTPException(status_code=500, detail="创建分离任务失败")

    # 启动后台任务
    background_tasks.add_task(
        run_separation_task,
        task_id=task_id,
        image_url=request.image_url,
        separation_type=request.separation_type,
        clip_id=request.clip_id,
        shot_id=request.shot_id,
        enhance=request.enhance,
    )

    logger.info(
        f"[VisualSeparation] 任务已创建 task={task_id} "
        f"type={request.separation_type} clip={request.clip_id}"
    )

    return SeparateResponse(task_id=task_id)


@router.get("/tasks/{task_id}", response_model=SeparationTaskResult)
async def get_separation_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    获取分离任务详情（结构化结果）
    也可以使用通用 /api/tasks/{task_id}，此端点额外解构 result_metadata
    """
    result = (
        supabase.table("tasks")
        .select("*")
        .eq("id", task_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="任务不存在")

    task = result.data
    metadata = task.get("metadata") or {}

    return SeparationTaskResult(
        task_id=task["id"],
        status=task.get("status", "pending"),
        progress=task.get("progress", 0),
        status_message=task.get("status_message"),
        error_message=task.get("error_message"),
        mask_url=metadata.get("mask_url"),
        foreground_url=metadata.get("foreground_url"),
        background_url=metadata.get("background_url"),
        enhanced_foreground_url=metadata.get("enhanced_foreground_url"),
        midground_url=metadata.get("midground_url"),
        original_width=metadata.get("original_width"),
        original_height=metadata.get("original_height"),
        separation_type=metadata.get("separation_type"),
        layer_count=metadata.get("layer_count"),
        semantic_labels=metadata.get("semantic_labels"),
        enhancement_info=metadata.get("enhancement_info"),
    )
