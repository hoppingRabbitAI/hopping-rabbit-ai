"""
HoppingRabbit AI - 用户配额服务
管理用户的试用次数、AI 任务配额、存储限制等
"""
from typing import Optional, Dict, Any
from datetime import datetime, date
import logging

from app.services.supabase_client import get_supabase
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class QuotaError(Exception):
    """配额相关错误"""
    pass


class QuotaExceededError(QuotaError):
    """配额不足错误"""
    def __init__(self, message: str, quota_type: str, remaining: int = 0):
        super().__init__(message)
        self.quota_type = quota_type
        self.remaining = remaining


class QuotaService:
    """用户配额服务"""
    
    # 配额类型常量
    QUOTA_FREE_TRIAL = "free_trial"
    QUOTA_AI_TASK = "ai_task"
    QUOTA_STORAGE = "storage"
    QUOTA_PROJECT = "project"
    
    def __init__(self):
        self.supabase = get_supabase()
    
    async def get_user_quota(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        获取用户配额信息
        
        Returns:
            用户配额数据，包括：
            - tier: 会员等级
            - free_trials_remaining: 剩余试用次数
            - ai_tasks_remaining_today: 今日剩余 AI 任务数
            - storage_remaining_mb: 剩余存储空间 (MB)
            - projects_remaining: 剩余可创建项目数
        """
        try:
            # 首先检查是否需要重置每日配额
            await self._check_daily_reset(user_id)
            
            response = self.supabase.table("user_quotas").select("*").eq("user_id", user_id).single().execute()
            
            if not response.data:
                # 用户配额记录不存在，创建默认配额
                return await self._create_default_quota(user_id)
            
            quota = response.data
            
            # 计算剩余配额
            return {
                "user_id": user_id,
                "tier": quota.get("tier", "free"),
                "free_trials_total": quota.get("free_trials_total", 6),
                "free_trials_used": quota.get("free_trials_used", 0),
                "free_trials_remaining": max(0, quota.get("free_trials_total", 6) - quota.get("free_trials_used", 0)),
                "ai_tasks_daily_limit": quota.get("ai_tasks_daily_limit", 10),
                "ai_tasks_used_today": quota.get("ai_tasks_used_today", 0),
                "ai_tasks_remaining_today": max(0, quota.get("ai_tasks_daily_limit", 10) - quota.get("ai_tasks_used_today", 0)),
                "storage_limit_mb": quota.get("storage_limit_mb", 500),
                "storage_used_mb": quota.get("storage_used_mb", 0),
                "storage_remaining_mb": max(0, quota.get("storage_limit_mb", 500) - quota.get("storage_used_mb", 0)),
                "max_projects": quota.get("max_projects", 3),
                "monthly_credits": quota.get("monthly_credits", 0),
                "credits_used_this_month": quota.get("credits_used_this_month", 0),
            }
        except Exception as e:
            logger.error(f"Failed to get user quota: {e}")
            # 返回默认配额
            return self._get_default_quota_response(user_id)
    
    async def check_quota(self, user_id: str, quota_type: str, amount: int = 1) -> Dict[str, Any]:
        """
        检查用户是否有足够的配额
        
        Args:
            user_id: 用户 ID
            quota_type: 配额类型 (free_trial, ai_task, storage, project)
            amount: 需要消耗的数量
            
        Returns:
            {"allowed": bool, "remaining": int, "message": str}
        """
        quota = await self.get_user_quota(user_id)
        if not quota:
            return {"allowed": False, "remaining": 0, "message": "无法获取配额信息"}
        
        tier = quota.get("tier", "free")
        
        if quota_type == self.QUOTA_FREE_TRIAL:
            # 免费试用次数检查（仅对 free 用户）
            if tier != "free":
                return {"allowed": True, "remaining": -1, "message": "付费用户无限制"}
            
            remaining = quota.get("free_trials_remaining", 0)
            if remaining >= amount:
                return {"allowed": True, "remaining": remaining - amount, "message": "配额充足"}
            else:
                return {"allowed": False, "remaining": remaining, "message": f"免费试用次数不足，剩余 {remaining} 次"}
        
        elif quota_type == self.QUOTA_AI_TASK:
            # AI 任务每日限制检查
            remaining = quota.get("ai_tasks_remaining_today", 0)
            limit = quota.get("ai_tasks_daily_limit", 10)
            
            # -1 表示无限制
            if limit == -1:
                return {"allowed": True, "remaining": -1, "message": "无每日限制"}
            
            if remaining >= amount:
                return {"allowed": True, "remaining": remaining - amount, "message": "配额充足"}
            else:
                return {"allowed": False, "remaining": remaining, "message": f"今日 AI 任务配额不足，剩余 {remaining} 次"}
        
        elif quota_type == self.QUOTA_STORAGE:
            # 存储空间检查
            remaining = quota.get("storage_remaining_mb", 0)
            if remaining >= amount:
                return {"allowed": True, "remaining": remaining - amount, "message": "存储空间充足"}
            else:
                return {"allowed": False, "remaining": remaining, "message": f"存储空间不足，剩余 {remaining} MB"}
        
        elif quota_type == self.QUOTA_PROJECT:
            # 项目数量检查
            max_projects = quota.get("max_projects", 3)
            # -1 表示无限制
            if max_projects == -1:
                return {"allowed": True, "remaining": -1, "message": "项目数量无限制"}
            
            # 需要查询当前项目数
            project_count = await self._get_user_project_count(user_id)
            remaining = max_projects - project_count
            
            if remaining >= amount:
                return {"allowed": True, "remaining": remaining - amount, "message": "可以创建项目"}
            else:
                return {"allowed": False, "remaining": remaining, "message": f"项目数量已达上限 {max_projects}"}
        
        return {"allowed": False, "remaining": 0, "message": "未知的配额类型"}
    
    async def consume_quota(self, user_id: str, quota_type: str, amount: int = 1) -> bool:
        """
        消耗用户配额
        
        Args:
            user_id: 用户 ID
            quota_type: 配额类型
            amount: 消耗数量
            
        Returns:
            是否成功消耗
            
        Raises:
            QuotaExceededError: 配额不足时抛出
        """
        # 先检查配额
        check_result = await self.check_quota(user_id, quota_type, amount)
        if not check_result["allowed"]:
            raise QuotaExceededError(
                check_result["message"],
                quota_type=quota_type,
                remaining=check_result["remaining"]
            )
        
        try:
            if quota_type == self.QUOTA_FREE_TRIAL:
                # 消耗免费试用次数
                self.supabase.rpc(
                    "increment_quota_field",
                    {"p_user_id": user_id, "p_field": "free_trials_used", "p_amount": amount}
                ).execute()
                
            elif quota_type == self.QUOTA_AI_TASK:
                # 消耗每日 AI 任务配额
                self.supabase.rpc(
                    "increment_quota_field",
                    {"p_user_id": user_id, "p_field": "ai_tasks_used_today", "p_amount": amount}
                ).execute()
                
            elif quota_type == self.QUOTA_STORAGE:
                # 消耗存储空间
                self.supabase.rpc(
                    "increment_quota_field",
                    {"p_user_id": user_id, "p_field": "storage_used_mb", "p_amount": amount}
                ).execute()
            
            logger.info(f"Consumed quota: user={user_id}, type={quota_type}, amount={amount}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to consume quota: {e}")
            # 如果是 RPC 不存在，使用备用方法
            return await self._consume_quota_fallback(user_id, quota_type, amount)
    
    async def _consume_quota_fallback(self, user_id: str, quota_type: str, amount: int) -> bool:
        """备用配额消耗方法（直接更新）"""
        try:
            quota = await self.get_user_quota(user_id)
            if not quota:
                return False
            
            update_data = {"updated_at": datetime.utcnow().isoformat()}
            
            if quota_type == self.QUOTA_FREE_TRIAL:
                update_data["free_trials_used"] = quota.get("free_trials_used", 0) + amount
            elif quota_type == self.QUOTA_AI_TASK:
                update_data["ai_tasks_used_today"] = quota.get("ai_tasks_used_today", 0) + amount
            elif quota_type == self.QUOTA_STORAGE:
                update_data["storage_used_mb"] = quota.get("storage_used_mb", 0) + amount
            else:
                return False
            
            self.supabase.table("user_quotas").update(update_data).eq("user_id", user_id).execute()
            return True
            
        except Exception as e:
            logger.error(f"Fallback quota consume failed: {e}")
            return False
    
    async def _check_daily_reset(self, user_id: str):
        """检查并重置每日配额"""
        try:
            response = self.supabase.table("user_quotas").select("ai_tasks_reset_at").eq("user_id", user_id).single().execute()
            
            if response.data:
                reset_date = response.data.get("ai_tasks_reset_at")
                today = date.today().isoformat()
                
                if reset_date and reset_date < today:
                    # 重置每日配额
                    self.supabase.table("user_quotas").update({
                        "ai_tasks_used_today": 0,
                        "ai_tasks_reset_at": today,
                        "updated_at": datetime.utcnow().isoformat()
                    }).eq("user_id", user_id).execute()
                    logger.info(f"Reset daily quota for user: {user_id}")
        except Exception as e:
            logger.warning(f"Failed to check daily reset: {e}")
    
    async def _create_default_quota(self, user_id: str) -> Dict[str, Any]:
        """为新用户创建默认配额"""
        try:
            default_quota = {
                "user_id": user_id,
                "tier": "free",
                "free_trials_total": 6,
                "free_trials_used": 0,
                "monthly_credits": 0,
                "credits_used_this_month": 0,
                "ai_tasks_daily_limit": 10,
                "ai_tasks_used_today": 0,
                "ai_tasks_reset_at": date.today().isoformat(),
                "storage_limit_mb": 500,
                "storage_used_mb": 0,
                "max_projects": 3,
            }
            
            self.supabase.table("user_quotas").insert(default_quota).execute()
            
            return self._get_default_quota_response(user_id)
        except Exception as e:
            logger.error(f"Failed to create default quota: {e}")
            return self._get_default_quota_response(user_id)
    
    def _get_default_quota_response(self, user_id: str) -> Dict[str, Any]:
        """获取默认配额响应"""
        return {
            "user_id": user_id,
            "tier": "free",
            "free_trials_total": 6,
            "free_trials_used": 0,
            "free_trials_remaining": 6,
            "ai_tasks_daily_limit": 10,
            "ai_tasks_used_today": 0,
            "ai_tasks_remaining_today": 10,
            "storage_limit_mb": 500,
            "storage_used_mb": 0,
            "storage_remaining_mb": 500,
            "max_projects": 3,
            "monthly_credits": 0,
            "credits_used_this_month": 0,
        }
    
    async def _get_user_project_count(self, user_id: str) -> int:
        """获取用户当前项目数量"""
        try:
            response = self.supabase.table("projects").select("id", count="exact").eq("user_id", user_id).execute()
            return response.count or 0
        except Exception as e:
            logger.error(f"Failed to get project count: {e}")
            return 0
    
    async def upgrade_user_tier(self, user_id: str, new_tier: str) -> bool:
        """
        升级用户会员等级
        
        Args:
            user_id: 用户 ID
            new_tier: 新的会员等级 (free, pro, enterprise)
        """
        tier_configs = {
            "free": {
                "ai_tasks_daily_limit": 10,
                "storage_limit_mb": 500,
                "max_projects": 3,
            },
            "pro": {
                "ai_tasks_daily_limit": 100,
                "storage_limit_mb": 10240,
                "max_projects": 20,
            },
            "enterprise": {
                "ai_tasks_daily_limit": -1,  # 无限制
                "storage_limit_mb": 102400,
                "max_projects": -1,  # 无限制
            }
        }
        
        if new_tier not in tier_configs:
            logger.error(f"Invalid tier: {new_tier}")
            return False
        
        try:
            update_data = {
                "tier": new_tier,
                **tier_configs[new_tier],
                "updated_at": datetime.utcnow().isoformat()
            }
            
            self.supabase.table("user_quotas").update(update_data).eq("user_id", user_id).execute()
            logger.info(f"Upgraded user {user_id} to tier: {new_tier}")
            return True
        except Exception as e:
            logger.error(f"Failed to upgrade user tier: {e}")
            return False


# 单例
_quota_service: Optional[QuotaService] = None

def get_quota_service() -> QuotaService:
    """获取配额服务实例"""
    global _quota_service
    if _quota_service is None:
        _quota_service = QuotaService()
    return _quota_service
