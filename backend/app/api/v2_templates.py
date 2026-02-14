"""
Trend Templates API (PRD v1.1)

路由:
- GET  /api/v2/templates/trending    获取热门模板列表
- GET  /api/v2/templates/:id         获取模板详情
- POST /api/v2/templates/use         使用模板
- GET  /api/v2/templates/categories/stats  分类统计
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from app.services.trend_template_service import get_trend_template_service
from .auth import get_current_user_id

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/templates", tags=["V2 Templates"])


# ==========================================
# 请求/响应模型
# ==========================================

class UseTemplateRequest(BaseModel):
    template_id: str = Field(..., description="模板 ID")
    reference_upload_id: Optional[str] = Field(None, description="参考图上传 ID（可选）")


class UseTemplateResponse(BaseModel):
    session_id: str


# ==========================================
# 路由
# ==========================================

@router.get("/trending")
async def list_trending(
    category: Optional[str] = Query(None, description="分类过滤"),
    search: Optional[str] = Query(None, description="搜索关键词"),
    cursor: Optional[str] = Query(None, description="分页游标"),
    limit: int = Query(20, ge=1, le=100),
):
    """获取热门模板列表"""
    service = get_trend_template_service()
    return await service.list_trending(
        category=category, search=search, cursor=cursor, limit=limit
    )


@router.get("/categories/stats")
async def get_category_stats():
    """获取分类统计"""
    service = get_trend_template_service()
    return await service.get_category_stats()


@router.get("/{template_id}")
async def get_template(template_id: str):
    """获取模板详情"""
    service = get_trend_template_service()
    template = await service.get_by_id(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.post("/use", response_model=UseTemplateResponse)
async def use_template(
    request: UseTemplateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """使用模板（创建 canvas session）"""
    service = get_trend_template_service()
    result = await service.use_template(
        template_id=request.template_id,
        user_id=user_id,
        reference_upload_id=request.reference_upload_id,
    )
    return result
