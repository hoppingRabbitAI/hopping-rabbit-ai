"""
Lepus AI - 用户 API
用户资料、配额、订阅相关接口
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import logging
import uuid

from app.api.auth import get_current_user, get_current_user_id
from app.services.quota_service import get_quota_service, QuotaService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["用户"])


# ============================================
# 响应模型
# ============================================

class QuotaResponse(BaseModel):
    """用户配额响应"""
    user_id: str
    tier: str = Field(description="会员等级: free, pro, enterprise")
    
    # 免费试用
    free_trials_total: int = Field(description="总试用次数")
    free_trials_used: int = Field(description="已使用试用次数")
    free_trials_remaining: int = Field(description="剩余试用次数")
    
    # AI 任务每日限制
    ai_tasks_daily_limit: int = Field(description="每日 AI 任务上限，-1 表示无限制")
    ai_tasks_used_today: int = Field(description="今日已使用 AI 任务数")
    ai_tasks_remaining_today: int = Field(description="今日剩余 AI 任务数")
    
    # 存储
    storage_limit_mb: int = Field(description="存储上限 (MB)")
    storage_used_mb: int = Field(description="已用存储 (MB)")
    storage_remaining_mb: int = Field(description="剩余存储 (MB)")
    
    # 项目
    max_projects: int = Field(description="最大项目数，-1 表示无限制")
    
    # 月度额度
    monthly_credits: int = Field(description="月度配额")
    credits_used_this_month: int = Field(description="本月已用配额")


class QuotaCheckRequest(BaseModel):
    """配额检查请求"""
    quota_type: str = Field(description="配额类型: free_trial, ai_task, storage, project")
    amount: int = Field(default=1, description="需要消耗的数量")


class QuotaCheckResponse(BaseModel):
    """配额检查响应"""
    allowed: bool = Field(description="是否允许")
    remaining: int = Field(description="剩余数量，-1 表示无限制")
    message: str = Field(description="提示信息")


class UserProfileResponse(BaseModel):
    """用户资料响应"""
    user_id: str
    email: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    tier: str = "free"
    created_at: Optional[str] = None


class UpdateProfileRequest(BaseModel):
    """更新用户资料请求"""
    display_name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    preferences: Optional[Dict[str, Any]] = None


# ============================================
# API 路由
# ============================================

@router.get("/me/quota", response_model=QuotaResponse)
async def get_current_user_quota(user_id: str = Depends(get_current_user_id)):
    """
    获取当前用户配额信息
    """
    quota_service = get_quota_service()
    quota = await quota_service.get_user_quota(user_id)
    
    if not quota:
        raise HTTPException(status_code=500, detail="无法获取配额信息")
    
    return QuotaResponse(**quota)


@router.post("/me/quota/check", response_model=QuotaCheckResponse)
async def check_user_quota(
    request: QuotaCheckRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    检查用户配额是否充足
    
    配额类型:
    - free_trial: 免费试用次数
    - ai_task: 每日 AI 任务数
    - storage: 存储空间 (MB)
    - project: 项目数量
    """
    quota_service = get_quota_service()
    result = await quota_service.check_quota(user_id, request.quota_type, request.amount)
    
    return QuotaCheckResponse(**result)


@router.patch("/me/profile")
async def update_user_profile(
    request: UpdateProfileRequest,
    user: dict = Depends(get_current_user)
):
    """
    更新当前用户资料
    """
    from app.services.supabase_client import get_supabase
    
    user_id = user["user_id"]
    supabase = get_supabase()
    
    # 构建更新数据
    update_data = {}
    if request.display_name is not None:
        update_data["display_name"] = request.display_name
    if request.bio is not None:
        update_data["bio"] = request.bio
    if request.avatar_url is not None:
        update_data["avatar_url"] = request.avatar_url
    if request.preferences is not None:
        update_data["preferences"] = request.preferences
    
    if not update_data:
        return {"message": "没有需要更新的字段"}
    
    try:
        # 尝试更新，如果记录不存在则插入
        response = supabase.table("user_profiles").upsert({
            "user_id": user_id,
            **update_data
        }).execute()
        
        return {"message": "资料更新成功", "data": response.data}
    except Exception as e:
        logger.error(f"Failed to update profile: {e}")
        raise HTTPException(status_code=500, detail="更新资料失败")


# 订阅相关端点已迁移到 /api/subscriptions
# 请使用:
#   GET /api/subscriptions/current - 获取当前订阅
#   GET /api/subscriptions/plans - 获取所有订阅计划


# ============================================
# 头像上传路由
# ============================================

@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id)
):
    """
    上传用户头像
    
    - 支持 jpg, png, gif, webp 格式
    - 最大 2MB
    - 存储到 Supabase Storage 的 avatars bucket
    """
    from app.services.supabase_client import get_supabase
    
    # 验证文件类型
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="不支持的图片格式，请使用 jpg, png, gif 或 webp")
    
    # 验证文件大小 (最大 2MB)
    contents = await file.read()
    if len(contents) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小不能超过 2MB")
    
    # 生成文件名
    ext = file.filename.split(".")[-1] if file.filename else "jpg"
    filename = f"{user_id}/{uuid.uuid4()}.{ext}"
    
    supabase = get_supabase()
    
    try:
        # 上传到 Supabase Storage
        response = supabase.storage.from_("avatars").upload(
            filename,
            contents,
            {"content-type": file.content_type}
        )
        
        # 获取公开 URL
        public_url = supabase.storage.from_("avatars").get_public_url(filename)
        
        # 更新用户资料
        supabase.table("user_profiles").upsert({
            "user_id": user_id,
            "avatar_url": public_url
        }).execute()
        
        return {"url": public_url, "message": "头像上传成功"}
    except Exception as e:
        logger.error(f"Failed to upload avatar: {e}")
        raise HTTPException(status_code=500, detail="头像上传失败，请重试")
