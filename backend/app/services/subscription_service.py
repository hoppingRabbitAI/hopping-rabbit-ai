"""
Lepus AI - 订阅服务
管理用户订阅的创建、查询、取消和续期

设计原则:
1. 订阅变更必须有完整日志
2. 积分发放必须有流水记录
3. 开发模式下模拟支付，生产模式接入 Stripe
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from uuid import UUID
from decimal import Decimal

from app.services.supabase_client import get_supabase_admin_client
from app.services.credit_service import get_credit_service

logger = logging.getLogger(__name__)


class SubscriptionError(Exception):
    """订阅操作异常"""
    def __init__(self, message: str, code: str = "SUBSCRIPTION_ERROR"):
        self.message = message
        self.code = code
        super().__init__(self.message)


class SubscriptionService:
    """
    订阅服务 - 管理用户订阅的完整生命周期
    
    核心功能:
    - 创建订阅 (开发模式直接成功)
    - 查询当前订阅
    - 取消订阅
    - 变更订阅计划
    - 发放订阅积分
    """
    
    def __init__(self):
        self.supabase = get_supabase_admin_client()
        self.credit_service = get_credit_service()
    
    # ========================================================================
    # 订阅计划查询
    # ========================================================================
    
    async def get_all_plans(self, active_only: bool = True) -> List[Dict]:
        """
        获取所有订阅计划
        
        Returns:
            订阅计划列表
        """
        try:
            query = self.supabase.table("subscription_plans").select("*")
            if active_only:
                query = query.eq("is_active", True)
            
            result = query.order("display_order").execute()
            return result.data or []
        except Exception as e:
            logger.error(f"获取订阅计划失败: {e}")
            return []
    
    async def get_plan_by_slug(self, slug: str) -> Optional[Dict]:
        """
        根据 slug 获取订阅计划
        """
        try:
            result = self.supabase.table("subscription_plans").select("*").eq("slug", slug).single().execute()
            return result.data
        except Exception as e:
            logger.error(f"获取订阅计划失败 [{slug}]: {e}")
            return None
    
    # ========================================================================
    # 用户订阅管理
    # ========================================================================
    
    async def get_user_subscription(self, user_id: str) -> Optional[Dict]:
        """
        获取用户当前活跃订阅
        
        Returns:
            订阅信息 (包含计划详情) 或 None
        """
        try:
            result = self.supabase.table("user_subscriptions").select(
                "*, plan:subscription_plans(*)"
            ).eq("user_id", user_id).eq("status", "active").single().execute()
            
            return result.data
        except Exception as e:
            # 可能是没有订阅，不算错误
            logger.debug(f"用户 {user_id} 没有活跃订阅: {e}")
            return None
    
    async def get_user_subscription_with_free(self, user_id: str) -> Dict:
        """
        获取用户订阅，如果没有则返回免费计划
        
        Returns:
            订阅信息
            
        Raises:
            SubscriptionError: 如果数据库中没有 free 计划，说明迁移未运行
        """
        subscription = await self.get_user_subscription(user_id)
        
        if subscription:
            # 验证数据完整性
            plan = subscription.get("plan")
            if not plan:
                raise SubscriptionError(
                    "订阅数据不完整: 缺少 plan 信息",
                    code="INVALID_SUBSCRIPTION_DATA"
                )
            if not plan.get("features"):
                raise SubscriptionError(
                    f"订阅计划 [{plan.get('slug')}] 缺少 features 字段，请检查数据库迁移",
                    code="MISSING_PLAN_FEATURES"
                )
            return subscription
        
        # 获取免费计划
        free_plan = await self.get_plan_by_slug("free")
        if not free_plan:
            raise SubscriptionError(
                "数据库中没有 'free' 订阅计划，请运行数据库迁移: supabase/migrations/20260125_subscription_system.sql",
                code="FREE_PLAN_NOT_FOUND"
            )
        
        if not free_plan.get("features"):
            raise SubscriptionError(
                "'free' 计划缺少 features 字段，请检查数据库迁移",
                code="FREE_PLAN_MISSING_FEATURES"
            )
        
        return {
            "id": None,
            "user_id": user_id,
            "status": "active",
            "billing_cycle": "monthly",
            "plan": free_plan,
            "is_free": True,
            "current_period_end": None,
        }
    
    async def subscribe(
        self,
        user_id: str,
        plan_slug: str,
        billing_cycle: str = "monthly",
        payment_method: str = "dev_mode",
        amount_paid: float = None,
    ) -> Dict[str, Any]:
        """
        创建或升级订阅
        
        开发模式下直接成功，生产模式需要支付确认
        
        Args:
            user_id: 用户 ID
            plan_slug: 计划标识 ('basic', 'pro', 'ultimate')
            billing_cycle: 计费周期 ('monthly')
            payment_method: 支付方式 ('stripe', 'dev_mode')
            amount_paid: 实际支付金额
            
        Returns:
            {
                "success": True,
                "subscription_id": "uuid",
                "plan": {...},
                "credits_granted": 650,
                "message": "订阅成功"
            }
        """
        try:
            # 1. 获取目标计划
            plan = await self.get_plan_by_slug(plan_slug)
            if not plan:
                raise SubscriptionError(f"订阅计划不存在: {plan_slug}", "PLAN_NOT_FOUND")
            
            if plan_slug == "free":
                raise SubscriptionError("免费计划无需订阅", "CANNOT_SUBSCRIBE_FREE")
            
            # 2. 检查是否已有订阅
            existing = await self.get_user_subscription(user_id)
            
            # 3. 计算周期（仅支持月付）
            now = datetime.now(timezone.utc)
            period_end = now + timedelta(days=30)
            price = float(plan.get("price_monthly", 0))
            
            actual_amount = amount_paid if amount_paid is not None else price
            
            # 4. 处理现有订阅
            if existing:
                # 升级/降级/续期
                old_plan_id = existing.get("plan", {}).get("id")
                action = self._determine_action(existing, plan)
                
                # 取消旧订阅
                self.supabase.table("user_subscriptions").update({
                    "status": "cancelled",
                    "canceled_at": now.isoformat(),
                    "auto_renew": False,
                }).eq("id", existing["id"]).execute()
            
            # 5. 创建新订阅
            subscription_data = {
                "user_id": user_id,
                "plan_id": plan["id"],
                "status": "active",
                "billing_cycle": billing_cycle,
                "started_at": now.isoformat(),
                "current_period_start": now.isoformat(),
                "current_period_end": period_end.isoformat(),
                "auto_renew": True,
                "payment_method": payment_method,
                "amount_paid": actual_amount,
                "currency": "USD",
                "metadata": {
                    "subscribed_at": now.isoformat(),
                    "source": "pricing_page",
                }
            }
            
            result = self.supabase.table("user_subscriptions").insert(subscription_data).execute()
            subscription = result.data[0] if result.data else None
            
            if not subscription:
                raise SubscriptionError("创建订阅失败", "CREATE_FAILED")
            
            # 6. 发放积分
            credits_granted = await self._grant_subscription_credits(
                user_id=user_id,
                plan=plan,
                subscription_id=subscription["id"],
                is_first_subscription=not existing,
            )
            
            # 8. 更新用户 tier
            await self._update_user_tier(user_id, plan_slug)
            
            logger.info(f"[Subscription] 用户 {user_id} 订阅成功: {plan_slug}, 发放 {credits_granted} 积分")
            
            return {
                "success": True,
                "subscription_id": subscription["id"],
                "plan": plan,
                "billing_cycle": billing_cycle,
                "current_period_end": period_end.isoformat(),
                "credits_granted": credits_granted,
                "message": f"订阅 {plan['name']} 成功！已发放 {credits_granted} 积分",
            }
            
        except SubscriptionError:
            raise
        except Exception as e:
            logger.error(f"订阅失败: {e}")
            raise SubscriptionError(f"订阅处理失败: {str(e)}", "SUBSCRIBE_FAILED")
    
    async def cancel_subscription(
        self,
        user_id: str,
        reason: str = None,
        immediate: bool = False,
    ) -> Dict[str, Any]:
        """
        取消订阅
        
        Args:
            user_id: 用户 ID
            reason: 取消原因
            immediate: 是否立即取消 (否则到期后取消)
            
        Returns:
            {"success": True, "message": "..."}
        """
        try:
            subscription = await self.get_user_subscription(user_id)
            
            if not subscription:
                raise SubscriptionError("没有活跃订阅", "NO_ACTIVE_SUBSCRIPTION")
            
            now = datetime.now(timezone.utc)
            
            if immediate:
                # 立即取消
                new_status = "cancelled"
                self.supabase.table("user_subscriptions").update({
                    "status": "cancelled",
                    "canceled_at": now.isoformat(),
                    "auto_renew": False,
                }).eq("id", subscription["id"]).execute()
                
                # 降级到免费
                await self._update_user_tier(user_id, "free")
                message = "订阅已取消，已降级为免费用户"
            else:
                # 到期后取消 (关闭自动续期)
                new_status = "active"
                self.supabase.table("user_subscriptions").update({
                    "auto_renew": False,
                    "canceled_at": now.isoformat(),
                }).eq("id", subscription["id"]).execute()
                
                period_end = subscription.get("current_period_end", "")
                message = f"已关闭自动续期，订阅将于 {period_end[:10]} 到期"
            
            logger.info(f"[Subscription] 用户 {user_id} 取消订阅, immediate={immediate}")
            
            return {
                "success": True,
                "status": new_status,
                "message": message,
            }
            
        except SubscriptionError:
            raise
        except Exception as e:
            logger.error(f"取消订阅失败: {e}")
            raise SubscriptionError(f"取消订阅失败: {str(e)}", "CANCEL_FAILED")
    
    async def reactivate_subscription(self, user_id: str) -> Dict[str, Any]:
        """
        重新激活已取消但未到期的订阅 (恢复自动续期)
        
        Returns:
            {"success": True, "message": "..."}
        """
        try:
            # 查找已取消但未过期的订阅
            result = self.supabase.table("user_subscriptions").select(
                "*, plan:subscription_plans(*)"
            ).eq("user_id", user_id).eq("auto_renew", False).execute()
            
            subscriptions = result.data or []
            
            # 找到状态为 active 且 auto_renew=false 的订阅 (已取消但未到期)
            subscription = None
            for sub in subscriptions:
                if sub.get("status") == "active":
                    subscription = sub
                    break
            
            if not subscription:
                raise SubscriptionError("没有可恢复的订阅", "NO_SUBSCRIPTION_TO_REACTIVATE")
            
            now = datetime.now(timezone.utc)
            period_end = subscription.get("current_period_end")
            
            if period_end:
                period_end_dt = datetime.fromisoformat(period_end.replace('Z', '+00:00'))
                if period_end_dt < now:
                    raise SubscriptionError("订阅已过期，请重新订阅", "SUBSCRIPTION_EXPIRED")
            
            # 恢复自动续期
            self.supabase.table("user_subscriptions").update({
                "auto_renew": True,
                "canceled_at": None,
            }).eq("id", subscription["id"]).execute()
            
            plan_name = subscription.get("plan", {}).get("name", "")
            logger.info(f"[Subscription] 用户 {user_id} 恢复订阅 {plan_name}")
            
            return {
                "success": True,
                "message": f"已恢复 {plan_name} 订阅，将继续自动续期",
                "subscription_id": subscription["id"],
            }
            
        except SubscriptionError:
            raise
        except Exception as e:
            logger.error(f"恢复订阅失败: {e}")
            raise SubscriptionError(f"恢复订阅失败: {str(e)}", "REACTIVATE_FAILED")
    
    async def get_upgrade_options(self, user_id: str) -> Dict[str, Any]:
        """
        获取用户可用的升级选项
        
        Returns:
            {
                "current_plan": {...},
                "upgrades": [...],
                "can_upgrade": True/False
            }
        """
        try:
            subscription = await self.get_user_subscription_with_free(user_id)
            current_plan = subscription.get("plan", {})
            current_order = current_plan.get("display_order", 0)
            
            # 获取所有计划
            all_plans = await self.get_all_plans(active_only=True)
            
            # 筛选出比当前计划更高级的
            upgrades = []
            for plan in all_plans:
                if plan.get("display_order", 0) > current_order and plan.get("slug") != "free":
                    upgrades.append({
                        "slug": plan["slug"],
                        "name": plan["name"],
                        "price_monthly": float(plan.get("price_monthly", 0)),
                        "credits_per_month": plan.get("credits_per_month", 0),
                        "features": plan.get("features", {}),
                    })
            
            return {
                "current_plan": {
                    "slug": current_plan.get("slug"),
                    "name": current_plan.get("name"),
                    "credits_per_month": current_plan.get("credits_per_month", 0),
                },
                "upgrades": upgrades,
                "can_upgrade": len(upgrades) > 0,
                "is_free": subscription.get("is_free", False),
            }
            
        except Exception as e:
            logger.error(f"获取升级选项失败: {e}")
            return {
                "current_plan": None,
                "upgrades": [],
                "can_upgrade": False,
            }
    
    # ========================================================================
    # 积分发放
    # ========================================================================
    
    async def _grant_subscription_credits(
        self,
        user_id: str,
        plan: Dict,
        subscription_id: str,
        is_first_subscription: bool = False,
    ) -> int:
        """
        发放订阅积分
        
        Returns:
            发放的总积分数
        """
        total_granted = 0
        credits_per_month = plan.get("credits_per_month", 0)
        bonus_credits = plan.get("bonus_credits", 0) if is_first_subscription else 0
        
        logger.info(f"[Credits] 准备发放积分: user={user_id}, monthly={credits_per_month}, bonus={bonus_credits}")
        
        try:
            # 1. 发放月度积分
            if credits_per_month > 0:
                logger.info(f"[Credits] 发放月度积分: {credits_per_month}")
                await self.credit_service.grant_credits(
                    user_id=user_id,
                    credits=credits_per_month,
                    transaction_type="grant",
                    description=f"订阅 {plan['name']} - 月度积分",
                    subscription_id=subscription_id,
                )
                total_granted += credits_per_month
            
            # 2. 发放首次奖励积分
            if bonus_credits > 0:
                logger.info(f"[Credits] 发放首次奖励: {bonus_credits}")
                await self.credit_service.grant_credits(
                    user_id=user_id,
                    credits=bonus_credits,
                    transaction_type="grant",
                    description=f"订阅 {plan['name']} - 首次奖励",
                    subscription_id=subscription_id,
                )
                total_granted += bonus_credits
            
            # 3. 更新用户积分配额 (monthly_credits_limit)
            self.supabase.table("user_credits").update({
                "monthly_credits_limit": credits_per_month,
            }).eq("user_id", user_id).execute()
            
            logger.info(f"[Credits] 用户 {user_id} 订阅积分发放成功: {total_granted}")
            return total_granted
            
        except Exception as e:
            import traceback
            logger.error(f"发放订阅积分失败: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return 0
    
    # ========================================================================
    # 辅助方法
    # ========================================================================
    
    def _determine_action(self, existing: Dict, new_plan: Dict) -> str:
        """判断订阅变更类型"""
        old_order = existing.get("plan", {}).get("display_order", 0)
        new_order = new_plan.get("display_order", 0)
        
        if new_order > old_order:
            return "upgraded"
        elif new_order < old_order:
            return "downgraded"
        else:
            return "renewed"
    
    async def _update_user_tier(self, user_id: str, plan_slug: str):
        """更新用户等级"""
        try:
            # 数据库 tier 只允许: free, pro, enterprise
            tier_mapping = {
                "free": "free",
                "basic": "pro",      # Basic 映射到 pro
                "pro": "pro",
                "ultimate": "pro",
                "creator": "enterprise",
            }
            tier = tier_mapping.get(plan_slug, "free")
            
            # 更新 user_credits 表
            self.supabase.table("user_credits").update({
                "tier": tier,
            }).eq("user_id", user_id).execute()
            
        except Exception as e:
            logger.warning(f"更新用户等级失败: {e}")


# 单例模式
_subscription_service: Optional[SubscriptionService] = None


def get_subscription_service() -> SubscriptionService:
    """获取订阅服务实例"""
    global _subscription_service
    if _subscription_service is None:
        _subscription_service = SubscriptionService()
    return _subscription_service
