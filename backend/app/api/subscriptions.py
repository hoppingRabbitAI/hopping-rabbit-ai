"""
Lepus AI - 订阅 API
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
    plan_slug: str = Field(..., description="计划标识: basic, pro, ultimate")
    billing_cycle: str = Field(default="monthly", description="计费周期: monthly")
    
    class Config:
        json_schema_extra = {
            "example": {
                "plan_slug": "pro",
                "billing_cycle": "monthly"
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
                "credits_per_month": plan.get("credits_per_month", 0),
                "bonus_credits": plan.get("bonus_credits", 0),
                "features": plan.get("features", {}),
                "is_popular": plan.get("is_popular", False),
                "badge_text": plan.get("badge_text"),
                "display_order": plan.get("display_order", 0),
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
    获取当前用户的订阅信息（包含积分余额）
    
    如果没有订阅，返回免费计划
    """
    from app.services.credit_service import get_credit_service
    
    service = get_subscription_service()
    credit_service = get_credit_service()
    
    try:
        subscription = await service.get_user_subscription_with_free(user_id)
        plan = subscription["plan"]  # 不用 get，没有就报错
        
        # 同时获取积分信息，避免前端多次请求
        credits = await credit_service.get_user_credits(user_id)
        
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
            # 积分信息 - 合并返回，减少 API 调用
            "credits": {
                "balance": credits.get("credits_balance", 0),
                "total_granted": credits.get("credits_total_granted", 0),
                "total_consumed": credits.get("credits_total_consumed", 0),
                "storage_used_mb": credits.get("storage_used_mb", 0),
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
    
    # 验证计费周期（仅支持月付）
    if request.billing_cycle != "monthly":
        raise HTTPException(
            status_code=400,
            detail="仅支持月付订阅"
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


@router.post("/reactivate")
async def reactivate_subscription(
    user_id: str = Depends(get_current_user_id),
):
    """
    恢复已取消但未到期的订阅
    
    如果用户取消了订阅但还在订阅期内，可以恢复自动续期
    """
    service = get_subscription_service()
    
    try:
        result = await service.reactivate_subscription(user_id=user_id)
        
        return {
            "success": True,
            "message": result["message"],
            "subscription_id": result.get("subscription_id"),
        }
        
    except SubscriptionError as e:
        logger.warning(f"恢复订阅失败: {e.message}")
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        logger.error(f"恢复订阅异常: {e}")
        raise HTTPException(status_code=500, detail="恢复订阅失败，请稍后重试")



# ============================================
# 积分充值 API (Top-up)
# ============================================

class TopupRequest(BaseModel):
    """充值请求"""
    credits_amount: int = Field(..., ge=100, description="购买积分数量")
    dev_mode: bool = Field(default=False, description="开发模式直接发放（仅测试用）")
    
    class Config:
        json_schema_extra = {
            "example": {
                "credits_amount": 500
            }
        }


# 积分包定价配置
CREDIT_PACKS = {
    100: {"price_cents": 500, "bonus": 0, "description": "100 积分"},
    500: {"price_cents": 2000, "bonus": 50, "description": "500 积分 + 50 赠送"},
    1000: {"price_cents": 3500, "bonus": 150, "description": "1000 积分 + 150 赠送"},
    5000: {"price_cents": 15000, "bonus": 1000, "description": "5000 积分 + 1000 赠送"},
}


@router.post("/topup")
async def topup_credits(
    request: TopupRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    购买额外积分 (充值)
    
    生产模式: 创建 Stripe Checkout Session，返回支付链接
    开发模式 (dev_mode=True): 直接发放积分
    """
    import os
    from app.config import get_settings
    
    settings = get_settings()
    
    # 找到对应的积分包
    pack = CREDIT_PACKS.get(request.credits_amount)
    if not pack:
        raise HTTPException(
            status_code=400,
            detail=f"无效的积分数量，可选: {list(CREDIT_PACKS.keys())}"
        )
    
    # 开发模式：直接发放积分
    if request.dev_mode or os.getenv("DEV_MODE") == "true":
        from app.services.credit_service import get_credit_service
        credit_service = get_credit_service()
        
        total_credits = request.credits_amount + pack["bonus"]
        
        await credit_service.grant_credits(
            user_id=user_id,
            credits=total_credits,
            transaction_type="purchase",
            description=f"充值 {request.credits_amount} 积分" + (f" (赠送 {pack['bonus']})" if pack["bonus"] > 0 else ""),
        )
        
        logger.info(f"[Topup] 开发模式：用户 {user_id} 充值 {total_credits} 积分")
        
        return {
            "success": True,
            "mode": "dev",
            "credits_purchased": request.credits_amount,
            "bonus_credits": pack["bonus"],
            "total_credits": total_credits,
            "amount_cents": pack["price_cents"],
            "message": f"充值成功！获得 {total_credits} 积分",
        }
    
    # 生产模式：创建 Stripe Checkout Session
    try:
        import stripe
        stripe.api_key = settings.stripe_secret_key
        
        if not stripe.api_key:
            raise HTTPException(status_code=500, detail="Stripe 未配置")
        
        # 创建 Checkout Session
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": pack["price_cents"],
                    "product_data": {
                        "name": f"Lepus 积分充值",
                        "description": pack["description"],
                    },
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=settings.stripe_success_url,
            cancel_url=settings.stripe_cancel_url,
            metadata={
                "user_id": user_id,
                "credits_amount": request.credits_amount,
                "bonus_credits": pack["bonus"],
                "type": "credits_topup",
            },
            client_reference_id=user_id,
        )
        
        logger.info(f"[Topup] 创建 Stripe Session: {checkout_session.id} for user {user_id}")
        
        return {
            "success": True,
            "mode": "stripe",
            "checkout_url": checkout_session.url,
            "session_id": checkout_session.id,
            "credits_amount": request.credits_amount,
            "bonus_credits": pack["bonus"],
            "amount_cents": pack["price_cents"],
        }
        
    except Exception as e:
        logger.error(f"创建 Stripe Session 失败: {e}")
        raise HTTPException(status_code=500, detail="创建支付会话失败，请稍后重试")


# ============================================
# 调试接口 (仅开发模式)
# ============================================

@router.post("/debug/reset")
async def debug_reset_subscription(
    user_id: str = Depends(get_current_user_id),
):
    """
    [开发调试] 重置用户订阅状态，模拟全新用户
    
    - 删除所有订阅记录
    - 删除积分记录
    - 重置为 free tier
    """
    import os
    if os.getenv("DEV_MODE") != "true":
        raise HTTPException(status_code=403, detail="仅开发模式可用")
    
    try:
        from app.services.supabase_client import get_supabase_admin_client
        supabase = get_supabase_admin_client()
        
        # 1. 删除订阅记录
        try:
            supabase.table("user_subscriptions").delete().eq("user_id", user_id).execute()
            logger.info(f"[Debug] 删除用户 {user_id} 的订阅记录")
        except Exception as e:
            logger.warning(f"[Debug] 删除订阅记录失败 (可忽略): {e}")
        
        # 2. 删除积分交易记录
        try:
            supabase.table("credit_transactions").delete().eq("user_id", user_id).execute()
            logger.info(f"[Debug] 删除用户 {user_id} 的积分交易记录")
        except Exception as e:
            logger.warning(f"[Debug] 删除积分交易记录失败 (可忽略): {e}")
        
        # 3. 删除积分账户
        try:
            supabase.table("user_credits").delete().eq("user_id", user_id).execute()
            logger.info(f"[Debug] 删除用户 {user_id} 的积分账户")
        except Exception as e:
            logger.warning(f"[Debug] 删除积分账户失败 (可忽略): {e}")
        
        # 4. 更新用户 tier 为 free
        try:
            supabase.table("users").update({"tier": "free"}).eq("id", user_id).execute()
            logger.info(f"[Debug] 重置用户 {user_id} tier 为 free")
        except Exception as e:
            logger.warning(f"[Debug] 重置 tier 失败 (可忽略): {e}")
        
        return {
            "success": True,
            "message": "已重置为全新用户状态",
            "user_id": user_id,
        }
        
    except Exception as e:
        logger.error(f"[Debug] 重置订阅状态失败: {e}")
        raise HTTPException(status_code=500, detail=f"重置失败: {str(e)}")
