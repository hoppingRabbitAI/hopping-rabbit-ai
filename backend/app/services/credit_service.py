"""
HoppingRabbit AI - Credit Service
积分服务 - 管理用户积分的消耗、发放、查询

功能:
- 计算 AI 操作所需积分
- 消耗/退还积分
- 查询积分余额和交易记录
- 月度配额重置
"""
import math
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from uuid import UUID

from app.services.supabase_client import get_supabase_admin_client

logger = logging.getLogger(__name__)


class InsufficientCreditsError(Exception):
    """积分不足异常"""
    def __init__(self, required: int, available: int, message: str = None):
        self.required = required
        self.available = available
        self.message = message or f"积分不足: 需要 {required} 积分，当前余额 {available}"
        super().__init__(self.message)


class CreditService:
    """
    积分服务 - 管理用户积分的消耗、发放、查询
    
    积分计算规则:
    - 固定积分: credits_per_call (简单操作)
    - 按秒计费: credits_per_second × duration_seconds
    - 按分钟计费: credits_per_minute × ceil(duration_seconds/60)
    - 应用 min_credits 和 max_credits 限制
    """
    
    # 缓存模型配置 (减少数据库查询)
    _model_cache: Dict[str, Dict] = {}
    _cache_time: datetime = None
    _cache_ttl_seconds: int = 300  # 5 分钟缓存
    
    def __init__(self):
        self.supabase = get_supabase_admin_client()
    
    # ========================================================================
    # 公开方法
    # ========================================================================
    
    async def get_user_credits(self, user_id: str) -> Dict[str, Any]:
        """
        获取用户积分信息
        
        ★ 简化设计: credits_balance 是唯一的真实余额
        
        Returns:
            {
                "credits_balance": 523,        # 当前可用积分 (唯一真实来源)
                "tier": "pro",                 # 会员等级
                "credits_total_granted": 700,  # 累计获得 (统计用)
                "credits_total_consumed": 177, # 累计消耗 (统计用)
            }
        """
        try:
            # 检查并重置月度积分
            await self._check_monthly_reset(user_id)
            
            # 使用 maybe_single() 而不是 single()，避免没有数据时抛异常
            result = self.supabase.table("user_credits").select("*").eq("user_id", user_id).maybe_single().execute()
            
            if not result.data:
                # 新用户，初始化积分账户
                return await self._initialize_user_credits(user_id)
            
            data = result.data
            return {
                "credits_balance": data.get("credits_balance", 0),
                "tier": data.get("tier", "free"),
                "credits_total_granted": data.get("credits_total_granted", 0),
                "credits_total_consumed": data.get("credits_total_consumed", 0),
            }
        except Exception as e:
            logger.error(f"获取用户积分失败: {e}")
            # 尝试初始化用户积分账户
            try:
                return await self._initialize_user_credits(user_id)
            except Exception as init_e:
                logger.error(f"初始化用户积分账户也失败: {init_e}")
                raise
    
    async def calculate_credits(self, model_key: str) -> int:
        """
        获取操作所需积分（固定计费）
        
        Args:
            model_key: 模型标识 ('ai_create', 'kling_lip_sync', etc.)
            
        Returns:
            所需积分数
            
        Raises:
            ValueError: 模型配置不存在
        """
        model = await self._get_model_config(model_key)
        
        if not model:
            error_msg = f"积分配置不存在: {model_key}，请在 ai_model_credits 表中添加该模型配置"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        # 固定积分消耗
        credits = model.get("credits_per_call", 0)
        
        return credits
    
    async def check_credits(self, user_id: str, required: int) -> Dict[str, Any]:
        """
        检查积分是否充足
        
        Returns:
            {
                "allowed": True/False,
                "required": 65,
                "available": 523,
                "message": "积分充足" / "积分不足，需要 65 积分"
            }
        """
        user_credits = await self.get_user_credits(user_id)
        available = user_credits["credits_balance"]
        
        allowed = available >= required
        
        return {
            "allowed": allowed,
            "required": required,
            "available": available,
            "message": "积分充足" if allowed else f"积分不足，需要 {required} 积分，当前余额 {available}",
        }
    
    async def quick_check_credits(self, user_id: str, required: int) -> Dict[str, Any]:
        """
        快速积分检查（优化版，只查一次数据库）
        
        注意：这个方法跳过了月度重置检查，仅用于快速预检查
        最终扣积分时仍会调用完整的 consume_credits
        
        Returns:
            {
                "allowed": True/False,
                "required": 65,
                "available": 523,
            }
        """
        try:
            # 只查一次数据库，不检查月度重置
            result = self.supabase.table("user_credits").select("credits_balance").eq("user_id", user_id).maybe_single().execute()
            
            if not result.data:
                # 新用户默认有 100 积分（注册时会初始化）
                available = 100
            else:
                available = result.data.get("credits_balance", 0)
            
            allowed = available >= required
            
            return {
                "allowed": allowed,
                "required": required,
                "available": available,
            }
        except Exception as e:
            logger.error(f"快速积分检查失败: {e}")
            # 出错时保守处理，让后续流程继续
            return {
                "allowed": True,
                "required": required,
                "available": -1,  # -1 表示查询失败
            }
    
    async def consume_credits(
        self,
        user_id: str,
        model_key: str,
        credits: int,
        ai_task_id: str = None,
        description: str = None,
        metadata: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        """
        消耗积分并记录
        
        Args:
            user_id: 用户 ID
            model_key: AI 模型标识
            credits: 消耗积分数
            ai_task_id: 关联的 AI 任务 ID
            description: 描述
            metadata: 额外信息 (时长、参数等)
            
        Returns:
            {
                "success": True,
                "credits_consumed": 65,
                "credits_before": 523,
                "credits_after": 458,
                "transaction_id": "uuid"
            }
            
        Raises:
            InsufficientCreditsError: 积分不足
        """
        try:
            # 获取当前余额
            user_credits = await self.get_user_credits(user_id)
            credits_before = user_credits["credits_balance"]
            
            # 检查余额
            if credits_before < credits:
                raise InsufficientCreditsError(credits, credits_before)
            
            credits_after = credits_before - credits
            
            # 更新积分余额 (只更新 credits_balance 和统计字段)
            self.supabase.table("user_credits").update({
                "credits_balance": credits_after,
                "credits_total_consumed": user_credits.get("credits_total_consumed", 0) + credits,
            }).eq("user_id", user_id).execute()
            
            # 获取模型信息用于描述
            model = await self._get_model_config(model_key)
            model_name = model.get("model_name", model_key) if model else model_key
            
            # 记录交易
            transaction = self.supabase.table("credit_transactions").insert({
                "user_id": user_id,
                "transaction_type": "consume",
                "credits_amount": -credits,
                "credits_before": credits_before,
                "credits_after": credits_after,
                "model_key": model_key,
                "ai_task_id": ai_task_id,
                "description": description or f"使用 {model_name}",
                "metadata": metadata or {},
                "status": "completed",
            }).execute()
            
            logger.info(f"用户 {user_id} 消耗 {credits} 积分, 模型: {model_key}, 余额: {credits_after}")
            
            return {
                "success": True,
                "credits_consumed": credits,
                "credits_before": credits_before,
                "credits_after": credits_after,
                "transaction_id": transaction.data[0]["id"] if transaction.data else None,
            }
        except InsufficientCreditsError:
            raise
        except Exception as e:
            logger.error(f"消耗积分失败: {e}")
            raise
    
    async def hold_credits(
        self,
        user_id: str,
        credits: int,
        ai_task_id: str,
        model_key: str = None,
    ) -> Dict[str, Any]:
        """
        冻结积分 (任务进行中)
        任务完成后调用 confirm_credits 确认扣除，或 refund_credits 退还
        
        Returns:
            {
                "success": True,
                "credits_held": 65,
                "transaction_id": "uuid"
            }
        """
        try:
            user_credits = await self.get_user_credits(user_id)
            credits_before = user_credits["credits_balance"]
            
            if credits_before < credits:
                raise InsufficientCreditsError(credits, credits_before)
            
            credits_after = credits_before - credits
            
            # 更新余额 (冻结)
            self.supabase.table("user_credits").update({
                "credits_balance": credits_after,
            }).eq("user_id", user_id).execute()
            
            # 记录冻结交易
            transaction = self.supabase.table("credit_transactions").insert({
                "user_id": user_id,
                "transaction_type": "hold",
                "credits_amount": -credits,
                "credits_before": credits_before,
                "credits_after": credits_after,
                "model_key": model_key,
                "ai_task_id": ai_task_id,
                "description": "积分冻结 (任务进行中)",
                "status": "pending",
            }).execute()
            
            # 更新 AI 任务的冻结积分
            if ai_task_id:
                self.supabase.table("tasks").update({
                    "credits_held": credits,
                }).eq("id", ai_task_id).execute()
            
            logger.info(f"用户 {user_id} 冻结 {credits} 积分, 任务: {ai_task_id}")
            
            return {
                "success": True,
                "credits_held": credits,
                "transaction_id": transaction.data[0]["id"] if transaction.data else None,
            }
        except InsufficientCreditsError:
            raise
        except Exception as e:
            logger.error(f"冻结积分失败: {e}")
            raise
    
    async def confirm_credits(self, ai_task_id: str) -> Dict[str, Any]:
        """
        确认扣除积分 (任务成功完成)
        将 hold 状态的交易标记为 completed
        """
        try:
            # 查找冻结记录
            result = self.supabase.table("credit_transactions").select("*").eq("ai_task_id", ai_task_id).eq("transaction_type", "hold").eq("status", "pending").execute()
            
            if not result.data:
                logger.warning(f"未找到任务 {ai_task_id} 的冻结记录")
                return {"success": True, "message": "无需确认"}
            
            hold_record = result.data[0]
            credits = abs(hold_record["credits_amount"])
            user_id = hold_record["user_id"]
            
            # 更新冻结记录状态为完成
            self.supabase.table("credit_transactions").update({
                "status": "completed",
                "transaction_type": "consume",
                "description": "积分消耗确认",
            }).eq("id", hold_record["id"]).execute()
            
            # 更新用户总消耗
            user_credits = await self.get_user_credits(user_id)
            self.supabase.table("user_credits").update({
                "credits_total_consumed": user_credits.get("credits_total_consumed", 0) + credits,
            }).eq("user_id", user_id).execute()
            
            # 更新 AI 任务
            self.supabase.table("tasks").update({
                "credits_consumed": credits,
                "credits_held": 0,
            }).eq("id", ai_task_id).execute()
            
            logger.info(f"任务 {ai_task_id} 积分确认扣除: {credits}")
            
            return {
                "success": True,
                "credits_confirmed": credits,
            }
        except Exception as e:
            logger.error(f"确认积分失败: {e}")
            raise
    
    async def refund_credits(
        self,
        user_id: str = None,
        ai_task_id: str = None,
        reason: str = "任务失败退款",
    ) -> Dict[str, Any]:
        """
        退还积分 (任务失败)
        
        Args:
            user_id: 用户 ID (可选，如果提供 ai_task_id 会自动获取)
            ai_task_id: AI 任务 ID
            reason: 退款原因
        """
        try:
            # 查找冻结记录
            query = self.supabase.table("credit_transactions").select("*").eq("status", "pending")
            if ai_task_id:
                query = query.eq("ai_task_id", ai_task_id)
            if user_id:
                query = query.eq("user_id", user_id)
            
            result = query.execute()
            
            if not result.data:
                logger.warning(f"未找到待退款记录, user_id={user_id}, ai_task_id={ai_task_id}")
                return {"success": True, "message": "无需退款", "credits_refunded": 0}
            
            total_refund = 0
            for record in result.data:
                credits = abs(record["credits_amount"])
                record_user_id = record["user_id"]
                
                # 获取当前余额
                user_credits = await self.get_user_credits(record_user_id)
                credits_before = user_credits["credits_balance"]
                credits_after = credits_before + credits
                
                # 退还积分
                self.supabase.table("user_credits").update({
                    "credits_balance": credits_after,
                }).eq("user_id", record_user_id).execute()
                
                # 更新原记录状态
                self.supabase.table("credit_transactions").update({
                    "status": "cancelled",
                }).eq("id", record["id"]).execute()
                
                # 记录退款交易
                self.supabase.table("credit_transactions").insert({
                    "user_id": record_user_id,
                    "transaction_type": "refund",
                    "credits_amount": credits,
                    "credits_before": credits_before,
                    "credits_after": credits_after,
                    "model_key": record.get("model_key"),
                    "ai_task_id": ai_task_id,
                    "description": reason,
                    "status": "completed",
                }).execute()
                
                total_refund += credits
                
                # 更新 AI 任务
                if ai_task_id:
                    self.supabase.table("tasks").update({
                        "credits_held": 0,
                    }).eq("id", ai_task_id).execute()
            
            logger.info(f"退还积分: {total_refund}, 任务: {ai_task_id}")
            
            return {
                "success": True,
                "credits_refunded": total_refund,
            }
        except Exception as e:
            logger.error(f"退还积分失败: {e}")
            raise
    
    async def grant_credits(
        self,
        user_id: str,
        credits: int,
        transaction_type: str = "grant",
        description: str = None,
        subscription_id: str = None,
    ) -> Dict[str, Any]:
        """
        发放积分 (订阅续费、购买、调整等)
        
        Args:
            user_id: 用户 ID
            credits: 发放积分数
            transaction_type: 交易类型 ('grant', 'purchase', 'adjust')
            description: 描述
            subscription_id: 关联的订阅 ID
        """
        try:
            logger.info(f"[CreditService] grant_credits 开始: user={user_id}, credits={credits}")
            
            user_credits = await self.get_user_credits(user_id)
            credits_before = user_credits["credits_balance"]
            credits_after = credits_before + credits
            
            logger.info(f"[CreditService] 当前余额: {credits_before}, 发放后: {credits_after}")
            
            # 更新余额
            update_data = {
                "credits_balance": credits_after,
                "credits_total_granted": user_credits.get("credits_total_granted", 0) + credits,
            }
            
            # 如果是购买，更新 paid_credits
            if transaction_type == "purchase":
                update_data["paid_credits"] = user_credits.get("paid_credits", 0) + credits
            
            # 使用 upsert 确保记录存在
            update_result = self.supabase.table("user_credits").update(update_data).eq("user_id", user_id).execute()
            logger.info(f"[CreditService] update 结果: {len(update_result.data) if update_result.data else 0} 行")
            
            # 记录交易
            transaction = self.supabase.table("credit_transactions").insert({
                "user_id": user_id,
                "transaction_type": transaction_type,
                "credits_amount": credits,
                "credits_before": credits_before,
                "credits_after": credits_after,
                "subscription_id": subscription_id,
                "description": description or f"积分发放 +{credits}",
                "status": "completed",
            }).execute()
            
            logger.info(f"用户 {user_id} 获得 {credits} 积分, 类型: {transaction_type}")
            
            return {
                "success": True,
                "credits_granted": credits,
                "credits_after": credits_after,
                "transaction_id": transaction.data[0]["id"] if transaction.data else None,
            }
        except Exception as e:
            logger.error(f"发放积分失败: {e}")
            raise
    
    async def get_transactions(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0,
        transaction_type: str = None,
    ) -> Dict[str, Any]:
        """
        获取用户积分交易记录
        
        Returns:
            {
                "transactions": [...],
                "total": 123,
                "has_more": True
            }
        """
        try:
            # 不使用 join，直接查询 credit_transactions
            query = self.supabase.table("credit_transactions").select("*", count="exact").eq("user_id", user_id).eq("status", "completed")
            
            if transaction_type:
                query = query.eq("transaction_type", transaction_type)
            
            result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
            
            # 获取模型名称映射
            model_pricing = await self.get_model_pricing()
            model_name_map = {p["model_key"]: p["model_name"] for p in model_pricing}
            
            transactions = []
            for record in result.data or []:
                model_key = record.get("model_key")
                transactions.append({
                    **record,
                    "model_name": model_name_map.get(model_key, model_key) if model_key else None,
                })
            
            return {
                "transactions": transactions,
                "total": result.count or 0,
                "has_more": (offset + limit) < (result.count or 0),
            }
        except Exception as e:
            logger.error(f"获取交易记录失败: {e}")
            return {"transactions": [], "total": 0, "has_more": False}
    
    async def get_model_pricing(self, model_key: str = None, category: str = None) -> List[Dict[str, Any]]:
        """
        获取模型积分定价表 (前端展示用)
        
        Returns:
            [{
                "model_key": "kling_lip_sync",
                "model_name": "AI 口型同步",
                "provider": "kling",
                "category": "generation",
                "description": "让视频中的人物口型匹配新音频",
                "pricing_type": "per_second",  # per_call / per_second / per_minute
                "credits_rate": 8.0,
                "min_credits": 50,
                "max_credits": 500
            }, ...]
        """
        try:
            query = self.supabase.table("ai_model_credits").select("*").eq("is_active", True)
            
            if model_key:
                query = query.eq("model_key", model_key)
            if category:
                query = query.eq("category", category)
            
            result = query.order("category").order("min_credits").execute()
            
            pricing_list = []
            for model in result.data or []:
                # 确定计费类型
                if model.get("credits_per_call"):
                    pricing_type = "per_call"
                    credits_rate = model["credits_per_call"]
                elif model.get("credits_per_second"):
                    pricing_type = "per_second"
                    credits_rate = float(model["credits_per_second"])
                elif model.get("credits_per_minute"):
                    pricing_type = "per_minute"
                    credits_rate = float(model["credits_per_minute"])
                else:
                    pricing_type = "fixed"
                    credits_rate = model.get("min_credits", 1)
                
                pricing_list.append({
                    "model_key": model["model_key"],
                    "model_name": model["model_name"],
                    "provider": model["provider"],
                    "category": model["category"],
                    "description": model.get("description"),
                    "pricing_type": pricing_type,
                    "credits_rate": credits_rate,
                    "min_credits": model.get("min_credits", 1),
                    "max_credits": model.get("max_credits"),
                })
            
            return pricing_list
        except Exception as e:
            logger.error(f"获取模型定价失败: {e}")
            return []
    
    # ========================================================================
    # 私有方法
    # ========================================================================
    
    async def _get_model_config(self, model_key: str) -> Optional[Dict[str, Any]]:
        """获取模型配置 (带缓存)"""
        now = datetime.now(timezone.utc)
        
        # 检查缓存
        if (
            self._cache_time
            and (now - self._cache_time).total_seconds() < self._cache_ttl_seconds
            and model_key in self._model_cache
        ):
            return self._model_cache[model_key]
        
        # 刷新缓存
        try:
            result = self.supabase.table("ai_model_credits").select("*").eq("is_active", True).execute()
            
            self._model_cache = {}
            for model in result.data or []:
                self._model_cache[model["model_key"]] = model
            
            self._cache_time = now
            
            return self._model_cache.get(model_key)
        except Exception as e:
            logger.error(f"获取模型配置失败: {e}")
            return None
    
    async def _initialize_user_credits(self, user_id: str) -> Dict[str, Any]:
        """初始化新用户积分账户"""
        try:
            initial_credits = 100  # 新用户赠送 100 积分 (与 Free 计划一致)
            
            # 计算下月重置时间
            now = datetime.now(timezone.utc)
            next_month = (now.replace(day=1) + timedelta(days=32)).replace(day=1)
            
            # 创建积分账户
            self.supabase.table("user_credits").insert({
                "user_id": user_id,
                "tier": "free",
                "credits_balance": initial_credits,
                "credits_total_granted": initial_credits,
                "monthly_credits_limit": 100,
                "free_trial_credits": initial_credits,
                "monthly_reset_at": next_month.isoformat(),
            }).execute()
            
            # 记录初始积分发放
            self.supabase.table("credit_transactions").insert({
                "user_id": user_id,
                "transaction_type": "grant",
                "credits_amount": initial_credits,
                "credits_before": 0,
                "credits_after": initial_credits,
                "description": "新用户注册赠送积分",
                "status": "completed",
            }).execute()
            
            logger.info(f"初始化用户 {user_id} 积分账户, 赠送 {initial_credits} 积分")
            
            return {
                "credits_balance": initial_credits,
                "monthly_credits_limit": 100,
                "monthly_credits_used": 0,
                "paid_credits": 0,
                "free_trial_credits": initial_credits,
                "tier": "free",
                "storage_limit_mb": 500,
                "storage_used_mb": 0,
                "max_projects": 3,
                "monthly_reset_at": next_month.isoformat(),
                "credits_total_granted": initial_credits,
                "credits_total_consumed": 0,
            }
        except Exception as e:
            logger.error(f"初始化用户积分失败: {e}")
            raise
    
    async def _check_monthly_reset(self, user_id: str) -> bool:
        """检查并执行月度积分重置"""
        try:
            result = self.supabase.table("user_credits").select("monthly_reset_at, monthly_credits_limit, monthly_credits_used, tier").eq("user_id", user_id).maybe_single().execute()
            
            if not result.data:
                return False
            
            reset_at = result.data.get("monthly_reset_at")
            if not reset_at:
                return False
            
            # 解析时间
            if isinstance(reset_at, str):
                reset_time = datetime.fromisoformat(reset_at.replace("Z", "+00:00"))
            else:
                reset_time = reset_at
            
            now = datetime.now(timezone.utc)
            
            if now >= reset_time:
                # 需要重置
                monthly_limit = result.data.get("monthly_credits_limit", 100)
                monthly_used = result.data.get("monthly_credits_used", 0)
                
                # 计算下次重置时间
                next_month = (now.replace(day=1) + timedelta(days=32)).replace(day=1)
                
                # 获取当前余额
                user_credits = await self.get_user_credits(user_id)
                old_balance = user_credits["credits_balance"]
                
                # 重置: 清除月度已用，重新发放月度配额
                # 注意: 充值积分不受影响
                paid_credits = user_credits.get("paid_credits", 0)
                new_balance = monthly_limit + paid_credits
                
                self.supabase.table("user_credits").update({
                    "credits_balance": new_balance,
                    "monthly_credits_used": 0,
                    "monthly_reset_at": next_month.isoformat(),
                    "credits_total_granted": user_credits.get("credits_total_granted", 0) + monthly_limit,
                }).eq("user_id", user_id).execute()
                
                # 记录过期 (如果有未用完的月度积分)
                expired = max(0, old_balance - paid_credits)
                if expired > 0:
                    self.supabase.table("credit_transactions").insert({
                        "user_id": user_id,
                        "transaction_type": "expire",
                        "credits_amount": -expired,
                        "credits_before": old_balance,
                        "credits_after": paid_credits,
                        "description": f"月度积分过期清零 (-{expired})",
                        "status": "completed",
                    }).execute()
                
                # 记录新月度发放
                self.supabase.table("credit_transactions").insert({
                    "user_id": user_id,
                    "transaction_type": "grant",
                    "credits_amount": monthly_limit,
                    "credits_before": paid_credits,
                    "credits_after": new_balance,
                    "description": f"月度积分发放 (+{monthly_limit})",
                    "status": "completed",
                }).execute()
                
                logger.info(f"用户 {user_id} 月度积分重置: {old_balance} → {new_balance}")
                return True
            
            return False
        except Exception as e:
            logger.error(f"检查月度重置失败: {e}")
            return False


# 需要导入
from datetime import timedelta


# 单例
_credit_service: Optional[CreditService] = None


def get_credit_service() -> CreditService:
    """获取 CreditService 单例"""
    global _credit_service
    if _credit_service is None:
        _credit_service = CreditService()
    return _credit_service
