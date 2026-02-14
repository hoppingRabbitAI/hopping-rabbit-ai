"""
Intent Router API (PRD v1.1 §4)

路由:
- POST /api/v2/intent/parse         解析用户意图 (旧接口)
- POST /api/v2/intent/confirm       确认意图 → 生成 pipeline
- POST /api/v2/intent/analyze       完整分析 → RouteResult (新接口)
- POST /api/v2/intent/analyze-text  仅文字分析 → RouteResult
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from app.services.intent_router_service import get_intent_router_service
from .auth import get_current_user_id

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/intent", tags=["V2 Intent Router"])


# ==========================================
# 请求/响应模型
# ==========================================

class IntentParseRequest(BaseModel):
    text: Optional[str] = Field(None, description="用户文字描述")
    reference_url: Optional[str] = Field(None, description="参考图 URL")
    subject_url: Optional[str] = Field(None, description="主体图 URL")
    template_id: Optional[str] = Field(None, description="预选模板 ID")


class CapabilityRecommendation(BaseModel):
    capability: str
    suggested_params: Dict[str, Any] = {}
    importance: float = 0.8
    order: int = 1


class IntentParseResponse(BaseModel):
    intent_id: str
    capabilities: List[CapabilityRecommendation]
    confidence: float
    explanation: str


class IntentConfirmRequest(BaseModel):
    intent_id: str = Field(..., description="意图 ID")


class IntentConfirmResponse(BaseModel):
    session_id: str
    pipeline: List[Dict[str, Any]] = []


# ==========================================
# 路由
# ==========================================

@router.post("/parse", response_model=IntentParseResponse)
async def parse_intent(
    request: IntentParseRequest,
    user_id: str = Depends(get_current_user_id),
):
    """解析用户意图 → 推荐能力组合"""
    service = get_intent_router_service()
    result = await service.parse_intent(
        text=request.text,
        reference_url=request.reference_url,
        subject_url=request.subject_url,
        template_id=request.template_id,
    )
    return result


@router.post("/confirm", response_model=IntentConfirmResponse)
async def confirm_intent(
    request: IntentConfirmRequest,
    user_id: str = Depends(get_current_user_id),
):
    """确认意图 → 创建画布 session + pipeline"""
    service = get_intent_router_service()
    result = await service.confirm_intent(request.intent_id)
    return result


# ---- 新增: analyze (完整分析) ----

class AnalyzeRequest(BaseModel):
    subject_url: Optional[str] = Field(None, description="用户照片 URL")
    reference_url: Optional[str] = Field(None, description="参考图 URL")
    text: Optional[str] = Field(None, description="文字描述")
    template_id: Optional[str] = Field(None, description="模板 ID")


class RouteStepResponse(BaseModel):
    capability: str
    params: Dict[str, Any] = {}
    prompt_template: str = ""
    reason: Optional[str] = None
    estimated_credits: Optional[int] = None


class RouteResultResponse(BaseModel):
    route: List[RouteStepResponse]
    overall_description: str
    suggested_golden_preset: Optional[str] = None
    suggested_output_duration: float = 0.0
    total_estimated_credits: int = 0
    confidence: float = 0.0


@router.post("/analyze", response_model=RouteResultResponse)
async def analyze_and_route(
    request: AnalyzeRequest,
    user_id: str = Depends(get_current_user_id),
):
    """完整分析: 用户照片 + 参考 → RouteResult"""
    service = get_intent_router_service()
    result = await service.analyze_and_route(
        subject_url=request.subject_url,
        reference_url=request.reference_url,
        text=request.text,
        template_id=request.template_id,
    )
    return result


# ---- 新增: analyze-text (仅文字) ----

class AnalyzeTextRequest(BaseModel):
    text: str = Field(..., description="用户文字描述")
    subject_url: Optional[str] = Field(None, description="用户照片 URL")
    template_id: Optional[str] = Field(None, description="模板 ID")


@router.post("/analyze-text", response_model=RouteResultResponse)
async def analyze_text(
    request: AnalyzeTextRequest,
    user_id: str = Depends(get_current_user_id),
):
    """仅文字分析 → RouteResult（支持附带用户照片上下文）"""
    service = get_intent_router_service()
    result = await service.analyze_and_route(
        text=request.text,
        subject_url=request.subject_url,
        template_id=request.template_id,
    )
    return result
