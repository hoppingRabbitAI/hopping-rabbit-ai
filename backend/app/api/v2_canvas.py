"""
Canvas Session API (PRD v1.1)

路由:
- POST   /api/v2/canvas/sessions           创建会话
- GET    /api/v2/canvas/sessions            列出用户会话
- GET    /api/v2/canvas/sessions/:id        获取会话详情
- PUT    /api/v2/canvas/sessions/:id/state  保存画布状态
- POST   /api/v2/canvas/sessions/:id/upload 上传素材
- DELETE /api/v2/canvas/sessions/:id        删除会话
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List

from app.services.canvas_session_service import get_canvas_session_service
from .auth import get_current_user_id

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/canvas", tags=["V2 Canvas"])


# ==========================================
# 请求/响应模型
# ==========================================

class CreateSessionRequest(BaseModel):
    template_id: Optional[str] = Field(None, description="关联模板 ID")


class SaveStateRequest(BaseModel):
    state: Dict[str, Any] = Field(..., description="画布状态 JSON")


# ==========================================
# 路由
# ==========================================

@router.post("/sessions")
async def create_session(
    request: CreateSessionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """创建新画布会话"""
    service = get_canvas_session_service()
    return await service.create_session(
        user_id=user_id,
        template_id=request.template_id,
    )


@router.get("/sessions")
async def list_sessions(
    limit: int = Query(20, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    """获取用户的会话列表"""
    service = get_canvas_session_service()
    return await service.list_user_sessions(user_id=user_id, limit=limit)


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """获取会话详情"""
    service = get_canvas_session_service()
    session = await service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.put("/sessions/{session_id}/state")
async def save_state(
    session_id: str,
    request: SaveStateRequest,
):
    """保存画布状态"""
    service = get_canvas_session_service()
    await service.save_state(session_id, request.state)
    return {"ok": True}


@router.post("/sessions/{session_id}/upload")
async def upload_reference(
    session_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """上传素材图片到 session"""
    service = get_canvas_session_service()

    result = await service.upload_reference(
        session_id=session_id,
        user_id=user_id,
        file_path="",  # TODO: 先上传到 Storage 获取路径
        filename=file.filename or "unknown",
        mime_type=file.content_type or "image/jpeg",
        file_size=file.size or 0,
    )

    return result


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """删除会话"""
    service = get_canvas_session_service()
    deleted = await service.delete_session(session_id, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


# ---- 新增: open-canvas (PRD §3.3) ----

class OpenCanvasRequest(BaseModel):
    template_id: Optional[str] = Field(None, description="关联模板 ID")
    subject_url: Optional[str] = Field(None, description="用户照片 URL")
    reference_url: Optional[str] = Field(None, description="参考图 URL")
    text: Optional[str] = Field(None, description="文字描述")


class OpenCanvasResponse(BaseModel):
    session_id: str
    route_result: Optional[Dict[str, Any]] = None


@router.post("/open-canvas", response_model=OpenCanvasResponse)
async def open_canvas(
    request: OpenCanvasRequest,
    user_id: str = Depends(get_current_user_id),
):
    """一键创建会话 + 自动分析 → 返回 session_id + route"""
    service = get_canvas_session_service()

    # 创建 session
    session = await service.create_session(
        user_id=user_id,
        template_id=request.template_id,
        subject_url=request.subject_url,
        reference_url=request.reference_url,
        text_input=request.text,
    )
    session_id = session.get("id") or session.get("session_id", "")

    # 如果有素材，自动触发 IntentRouter 分析
    route_result = None
    if request.subject_url or request.reference_url or request.text:
        from app.services.intent_router_service import get_intent_router_service
        intent_service = get_intent_router_service()
        route_result = await intent_service.analyze_and_route(
            subject_url=request.subject_url,
            reference_url=request.reference_url,
            text=request.text,
            template_id=request.template_id,
        )

    return {
        "session_id": session_id,
        "route_result": route_result,
    }


# ---- 新增: export (PRD §3.3) ----

class CanvasExportRequest(BaseModel):
    format: str = Field("mp4", description="导出格式: mp4 | gif | png")
    resolution: Optional[str] = Field(None, description="分辨率: 720p | 1080p | 4k")


@router.post("/sessions/{session_id}/export")
async def export_session(
    session_id: str,
    request: CanvasExportRequest,
    user_id: str = Depends(get_current_user_id),
):
    """导出画布 session 的最终结果"""
    # Phase 0: 返回占位
    from uuid import uuid4
    export_id = str(uuid4())

    return {
        "export_id": export_id,
        "session_id": session_id,
        "format": request.format,
        "status": "queued",
        "download_url": None,
    }


# ---- 新增: publish (PRD §3.3) ----

class PublishRequest(BaseModel):
    name: str = Field(..., description="作品名称")
    tags: List[str] = Field(default_factory=list, description="标签")
    visibility: str = Field("public", description="可见性: public | private")


@router.post("/sessions/{session_id}/publish")
async def publish_session(
    session_id: str,
    request: PublishRequest,
    user_id: str = Depends(get_current_user_id),
):
    """发布画布 session 为社区作品"""
    from uuid import uuid4

    # Phase 0: 占位返回
    return {
        "publish_id": str(uuid4()),
        "session_id": session_id,
        "name": request.name,
        "status": "published",
        "share_url": f"/gallery/{session_id}",
    }
