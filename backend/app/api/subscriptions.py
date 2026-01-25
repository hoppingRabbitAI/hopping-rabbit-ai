"""
HoppingRabbit AI - 订阅 API
处理订阅相关的 HTTP 请求

端点:
- GET  /api/subscriptions/plans       获取所有订阅计划
- GET  /api/subscriptions/current     获取当前用户订阅
- POST /api/subscriptions/subscribe   创建/升级订阅
- POST /api/subscriptions/cancel      取消订阅
"""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import get_current_user_id
from app.services.subscription_service import (
    get_subscription_service,
    SubscriptionError,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


# ============================================
# 请求/响应模型
# ============================================

class SubscribeRequest(BaseModel):
    """订阅请求"""
    plan_slug: str = Field(..., description="计划标识: basic, pro, ultimate, creator")
    billing_cycle: str = Field(default="yearly", description="计费周期: monthly, yearly")
    
    class Config:
        json_schema_extra = {
            "example": {
                "plan_slug": "pro",
                "billing_cycle": "yearly"
            }
        }


class CancelRequest(BaseModel):
    """取消订阅请求"""
    reason: Optional[str] = Field(None, description="取消原因")
    immediate: bool = Field(default=False, description="是否立即取消")


class SubscriptionResponse(BaseModel):
    """订阅响应"""
    success: bool
    message: str
    subscription_id: Optional[str] = None
    plan: Optional[dict] = None
    billing_cycle: Optional[str] = None
    current_period_end: Optional[str] = None
    credits_granted: Optional[int] = None


# ============================================
# API 端点
# ============================================

@router.get("/plans")
async def get_subscription_plans():
    """
    获取所有可用的订阅计划
    
    无需登录即可访问
    """
    service = get_subscription_service()
    
    try:
        plans = await service.get_all_plans(active_only=True)
        
        # 格式化返回数据
        formatted_plans = []
        for plan in plans:
            formatted_plans.append({
                "slug": plan["slug"],
                "name": plan["name"],
                "description": plan.get("description"),
                "price_monthly": float(plan.get("price_monthly", 0)),
                "price_yearly": float(plan.get("price_yearly", 0)),
                "credits_per_month": plan.get("credits_per_month", 0),
                "bonus_credits": plan.get("bonus_credits", 0),
                "features": plan.get("features", {}),
                "is_popular": plan.get("is_popular", False),
                "badge_text": plan.get("badge_text"),
            })
        
        return {
            "success": True,
            "plans": formatted_plans,
        }
        
    except Exception as e:
        logger.error(f"获取订阅计划失败: {e}")
        raise HTTPException(status_code=500, detail="获取订阅计划失败")


@router.get("/current")
async def get_current_subscription(user_id: str = Depends(get_current_user_id)):
    """
    获取当前用户的订阅信息
    
    如果没有订阅，返回免费计划
    """
    service = get_subscription_service()
    
    try:
        subscription = await service.get_user_subscription_with_free(user_id)
        
        plan = subscription["plan"]  # 不用 get，没有就报错
        
        return {
            "success": True,
            "subscription": {
                "id": subscription.get("id"),
                "status": subscription["status"],
                "is_free": subscription.get("is_free", False),
                "billing_cycle": subscription.get("billing_cycle"),
                "current_period_start": subscription.get("current_period_start"),
                "current_period_end": subscription.get("current_period_end"),
                "auto_renew": subscription.get("auto_renew", False),
                "canceled_at": subscription.get("canceled_at"),
                "plan": {
                    "slug": plan["slug"],
                    "name": plan["name"],
                    "credits_per_month": plan["credits_per_month"],
                    "features": plan["features"],  # 不用 get，没有就报错
                },
            },
        }
    
    except SubscriptionError as e:
        logger.error(f"获取用户订阅失败: {e.message} (code={e.code})")
        raise HTTPException(
            status_code=500,
            detail={
                "message": e.message,
                "code": e.code,
                "action": "请运行数据库迁移" if "迁移" in e.message else None
            }
        )
        
    except Exception as e:
        logger.error(f"获取用户订阅失败: {e}")
        raise HTTPException(status_code=500, detail="获取订阅信息失败")


@router.post("/subscribe", response_model=SubscriptionResponse)
async def subscribe(
    request: SubscribeRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    创建或升级订阅
    
    开发模式: 直接成功，立即发放积分
    生产模式: 需要先完成支付 (通过 Stripe)
    """
    service = get_subscription_service()
    
    # 验证计费周期
    if request.billing_cycle not in ["monthly", "yearly"]:
        raise HTTPException(
            status_code=400,
            detail="无效的计费周期，请选择 monthly 或 yearly"
        )
    
    # 验证计划
    valid_plans = ["basic", "pro", "ultimate", "creator"]
    if request.plan_slug not in valid_plans:
        raise HTTPException(
            status_code=400,
            detail=f"无效的订阅计划，可选: {', '.join(valid_plans)}"
        )
    
    try:
        result = await service.subscribe(
            user_id=user_id,
            plan_slug=request.plan_slug,
            billing_cycle=request.billing_cycle,
            payment_method="dev_mode",  # 开发模式
        )
        
        return SubscriptionResponse(
            success=True,
            message=result["message"],
            subscription_id=result["subscription_id"],
            plan=result["plan"],
            billing_cycle=result["billing_cycle"],
            current_period_end=result["current_period_end"],
            credits_granted=result["credits_granted"],
        )
        
    except SubscriptionError as e:
        logger.warning(f"订阅失败: {e.message}")
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        logger.error(f"订阅处理异常: {e}")
        raise HTTPException(status_code=500, detail="订阅处理失败，请稍后重试")


@router.post("/cancel")
async def cancel_subscription(
    request: CancelRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    取消订阅
    
    - immediate=False: 关闭自动续期，到期后降级
    - immediate=True: 立即取消并降级为免费用户
    """
    service = get_subscription_service()
    
    try:
        result = await service.cancel_subscription(
            user_id=user_id,
            reason=request.reason,
            immediate=request.immediate,
        )
        
        return {
            "success": True,
            "status": result["status"],
            "message": result["message"],
        }
        
    except SubscriptionError as e:
        logger.warning(f"取消订阅失败: {e.message}")
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        logger.error(f"取消订阅异常: {e}")
        raise HTTPException(status_code=500, detail="取消订阅失败，请稍后重试")


# ============================================
# 积分充值 API (Top-up)
# ============================================

class TopupRequest(BaseModel):
    """充值请求"""
    credits_amount: int = Field(..., ge=100, description="购买积分数量")
    
    class Config:
        json_schema_extra = {
            "example": {
                "credits_amount": 500
            }
        }


@router.post("/topup")
async def topup_credits(
    request: TopupRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    购买额外积分 (充值)
    
    开发模式: 直接发放积分
    生产模式: 需要先完成支付
    """
    from app.services.credit_service import get_credit_service
    
    credit_service = get_credit_service()
    
    # 积分定价 (简化版)
    credit_packs = {
        100: {"price": 5, "bonus": 0},
        500: {"price": 20, "bonus": 50},
        1000: {"price": 35, "bonus": 150},
        5000: {"price": 150, "bonus": 1000},
    }
    
    # 找到最接近的积分包
    pack = credit_packs.get(request.credits_amount)
    if not pack:
        raise HTTPException(
            status_code=400,
            detail=f"无效的积分数量，可选: {list(credit_packs.keys())}"
        )
    
    try:
        total_credits = request.credits_amount + pack["bonus"]
        
        # 发放积分
        await credit_service.grant_credits(
            user_id=user_id,
            credits=total_credits,
            transaction_type="topup_purchase",
            description=f"充值 {request.credits_amount} 积分" + (f" (赠送 {pack['bonus']})" if pack["bonus"] > 0 else ""),
        )
        
        logger.info(f"[Topup] 用户 {user_id} 充值 {total_credits} 积分")
        
        return {
            "success": True,
            "credits_purchased": request.credits_amount,
            "bonus_credits": pack["bonus"],
            "total_credits": total_credits,
            "amount_paid": pack["price"],
            "message": f"充值成功！获得 {total_credits} 积分",
        }
        
    except Exception as e:
        logger.error(f"积分充值失败: {e}")
        raise HTTPException(status_code=500, detail="充值处理失败，请稍后重试")
