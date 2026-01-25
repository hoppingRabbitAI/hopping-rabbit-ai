"""
HoppingRabbit AI - Credits API
积分管理 API 端点
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from app.api.auth import get_current_user
from app.services.credit_service import (
    get_credit_service,
    CreditService,
    InsufficientCreditsError,
)

router = APIRouter(prefix="/credits", tags=["credits"])


# ============================================================================
# 请求/响应模型
# ============================================================================

class CalculateCreditsRequest(BaseModel):
    """计算积分请求"""
    model_key: str = Field(..., description="AI 模型标识")
    duration_seconds: Optional[float] = Field(None, description="时长 (秒)")
    duration_minutes: Optional[float] = Field(None, description="时长 (分钟)")
    count: Optional[int] = Field(1, description="操作次数")


class CalculateCreditsResponse(BaseModel):
    """计算积分响应"""
    model_key: str
    credits_required: int
    pricing_type: str  # per_call / per_second / per_minute
    credits_rate: float
    params_used: Dict[str, Any]


class CheckCreditsRequest(BaseModel):
    """检查积分请求"""
    credits_required: int = Field(..., gt=0, description="需要的积分数")


class CheckCreditsResponse(BaseModel):
    """检查积分响应"""
    allowed: bool
    required: int
    available: int
    message: str


class ConsumeCreditsRequest(BaseModel):
    """消耗积分请求"""
    model_key: str = Field(..., description="AI 模型标识")
    credits: int = Field(..., gt=0, description="消耗积分数")
    ai_task_id: Optional[str] = Field(None, description="关联的 AI 任务 ID")
    description: Optional[str] = Field(None, description="描述")
    metadata: Optional[Dict[str, Any]] = Field(None, description="额外信息")


class ConsumeCreditsResponse(BaseModel):
    """消耗积分响应"""
    success: bool
    credits_consumed: int
    credits_before: int
    credits_after: int
    transaction_id: Optional[str]


class HoldCreditsRequest(BaseModel):
    """冻结积分请求"""
    credits: int = Field(..., gt=0, description="冻结积分数")
    ai_task_id: str = Field(..., description="AI 任务 ID")
    model_key: Optional[str] = Field(None, description="AI 模型标识")


class GrantCreditsRequest(BaseModel):
    """发放积分请求 (管理员)"""
    user_id: str = Field(..., description="用户 ID")
    credits: int = Field(..., gt=0, description="发放积分数")
    transaction_type: str = Field("grant", description="交易类型")
    description: Optional[str] = Field(None, description="描述")


class UserCreditsResponse(BaseModel):
    """用户积分信息响应"""
    credits_balance: int
    monthly_credits_limit: int
    monthly_credits_used: int
    paid_credits: int
    free_trial_credits: int
    tier: str
    storage_limit_mb: int
    storage_used_mb: int
    max_projects: int
    monthly_reset_at: Optional[str]
    credits_total_granted: Optional[int]
    credits_total_consumed: Optional[int]


class TransactionItem(BaseModel):
    """交易记录项"""
    id: str
    transaction_type: str
    credits_amount: int
    credits_before: int
    credits_after: int
    model_key: Optional[str]
    model_name: Optional[str]
    ai_task_id: Optional[str]
    description: Optional[str]
    created_at: str


class TransactionsResponse(BaseModel):
    """交易记录响应"""
    transactions: List[TransactionItem]
    total: int
    has_more: bool


class ModelPricingItem(BaseModel):
    """模型定价项"""
    model_key: str
    model_name: str
    provider: str
    category: str
    description: Optional[str]
    pricing_type: str
    credits_rate: float
    min_credits: int
    max_credits: Optional[int]


# ============================================================================
# API 端点
# ============================================================================

@router.get("", response_model=UserCreditsResponse)
async def get_user_credits(user: dict = Depends(get_current_user)):
    """
    获取当前用户积分信息
    
    返回:
    - credits_balance: 当前可用积分
    - monthly_credits_limit: 月度配额上限
    - monthly_credits_used: 本月已用
    - paid_credits: 充值积分 (永不过期)
    - tier: 会员等级 (free/pro/enterprise)
    """
    service = get_credit_service()
    credits = await service.get_user_credits(user["user_id"])
    return credits


@router.post("/calculate", response_model=CalculateCreditsResponse)
async def calculate_credits(
    request: CalculateCreditsRequest,
    user: dict = Depends(get_current_user),
):
    """
    计算 AI 操作所需积分
    
    根据模型和参数计算预估积分消耗，用于:
    - 操作前显示预估消耗
    - 帮助用户决定是否执行
    """
    service = get_credit_service()
    
    params = {}
    if request.duration_seconds:
        params["duration_seconds"] = request.duration_seconds
    if request.duration_minutes:
        params["duration_minutes"] = request.duration_minutes
    if request.count:
        params["count"] = request.count
    
    credits_required = await service.calculate_credits(request.model_key, params)
    
    # 获取定价信息
    pricing_list = await service.get_model_pricing(model_key=request.model_key)
    pricing_info = pricing_list[0] if pricing_list else {
        "pricing_type": "fixed",
        "credits_rate": credits_required,
    }
    
    return {
        "model_key": request.model_key,
        "credits_required": credits_required,
        "pricing_type": pricing_info.get("pricing_type", "fixed"),
        "credits_rate": pricing_info.get("credits_rate", credits_required),
        "params_used": params,
    }


@router.post("/check", response_model=CheckCreditsResponse)
async def check_credits(
    request: CheckCreditsRequest,
    user: dict = Depends(get_current_user),
):
    """
    检查用户积分是否充足
    
    在执行 AI 操作前调用，确认用户有足够积分
    """
    service = get_credit_service()
    result = await service.check_credits(user["user_id"], request.credits_required)
    return result


@router.post("/consume", response_model=ConsumeCreditsResponse)
async def consume_credits(
    request: ConsumeCreditsRequest,
    user: dict = Depends(get_current_user),
):
    """
    消耗积分
    
    直接扣除积分，用于简单操作。
    对于需要等待的任务，建议使用 hold → confirm/refund 流程。
    """
    service = get_credit_service()
    
    try:
        result = await service.consume_credits(
            user_id=user["user_id"],
            model_key=request.model_key,
            credits=request.credits,
            ai_task_id=request.ai_task_id,
            description=request.description,
            metadata=request.metadata,
        )
        return result
    except InsufficientCreditsError as e:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "insufficient_credits",
                "message": e.message,
                "required": e.required,
                "available": e.available,
            }
        )


@router.post("/hold")
async def hold_credits(
    request: HoldCreditsRequest,
    user: dict = Depends(get_current_user),
):
    """
    冻结积分 (任务开始时)
    
    用于需要等待的 AI 任务:
    1. 任务开始时调用 hold 冻结积分
    2. 任务成功时调用 confirm 确认扣除
    3. 任务失败时调用 refund 退还积分
    """
    service = get_credit_service()
    
    try:
        result = await service.hold_credits(
            user_id=user["user_id"],
            credits=request.credits,
            ai_task_id=request.ai_task_id,
            model_key=request.model_key,
        )
        return result
    except InsufficientCreditsError as e:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "insufficient_credits",
                "message": e.message,
                "required": e.required,
                "available": e.available,
            }
        )


@router.post("/confirm/{ai_task_id}")
async def confirm_credits(
    ai_task_id: str,
    user: dict = Depends(get_current_user),
):
    """
    确认扣除积分 (任务成功完成)
    
    将冻结的积分正式扣除
    """
    service = get_credit_service()
    result = await service.confirm_credits(ai_task_id)
    return result


@router.post("/refund/{ai_task_id}")
async def refund_credits(
    ai_task_id: str,
    reason: str = Query("任务失败退款", description="退款原因"),
    user: dict = Depends(get_current_user),
):
    """
    退还积分 (任务失败)
    
    将冻结的积分退还给用户
    """
    service = get_credit_service()
    result = await service.refund_credits(
        user_id=user["user_id"],
        ai_task_id=ai_task_id,
        reason=reason,
    )
    return result


@router.get("/transactions", response_model=TransactionsResponse)
async def get_transactions(
    limit: int = Query(50, ge=1, le=100, description="每页数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    transaction_type: Optional[str] = Query(None, description="交易类型过滤"),
    user: dict = Depends(get_current_user),
):
    """
    获取用户积分交易记录
    
    支持分页和按类型过滤:
    - consume: 消耗
    - grant: 发放
    - refund: 退款
    - purchase: 购买
    - expire: 过期
    """
    service = get_credit_service()
    result = await service.get_transactions(
        user_id=user["user_id"],
        limit=limit,
        offset=offset,
        transaction_type=transaction_type,
    )
    return result


@router.get("/pricing", response_model=List[ModelPricingItem])
async def get_model_pricing(
    category: Optional[str] = Query(None, description="分类过滤"),
    user: dict = Depends(get_current_user),
):
    """
    获取 AI 模型积分定价表
    
    返回所有可用模型的积分消耗配置，用于:
    - 在 UI 中显示各功能的积分消耗
    - 帮助用户了解积分使用情况
    
    分类:
    - transcription: 语音转文字
    - analysis: 分析
    - enhancement: 增强
    - editing: 编辑
    - generation: AI 生成
    """
    service = get_credit_service()
    pricing = await service.get_model_pricing(category=category)
    return pricing


# ============================================================================
# 公开端点 (无需登录)
# ============================================================================

@router.get("/pricing/public", response_model=List[ModelPricingItem])
async def get_public_pricing(
    category: Optional[str] = Query(None, description="分类过滤"),
):
    """
    获取公开的模型定价表 (无需登录)
    
    用于定价页面展示
    """
    service = get_credit_service()
    pricing = await service.get_model_pricing(category=category)
    return pricing
