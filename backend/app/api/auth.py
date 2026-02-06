"""
HoppingRabbit AI - Authentication API
处理用户登录验证、JWT Token 解析

注意：由于 Supabase 的新 key 格式 (sb_publishable_...) 与 Python SDK 不兼容，
认证流程调整为：
1. 前端直接通过 Supabase JS SDK 进行登录
2. 后端接收前端传来的 JWT Token 并验证
3. 后端通过解析 JWT 获取用户信息

★ 重要：Token 验证策略
- 首先本地解析 JWT 检查过期时间（不依赖网络）
- 如果 token 已过期 → 返回 401（让用户重新登录）
- 如果 token 未过期 → 尝试调用 Supabase API 获取用户信息
- 如果 Supabase API 调用失败但 token 未过期 → 使用 JWT payload 中的用户信息（降级）
- 这样可以避免因网络问题导致有效 token 被错误拒绝
"""
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, EmailStr
from typing import Optional
import jwt
import httpx
import logging
import time
from functools import lru_cache

logger = logging.getLogger(__name__)

from app.config import get_settings

router = APIRouter(prefix="/auth", tags=["认证"])
settings = get_settings()


# ============================================
# 请求/响应模型
# ============================================

class UserInfo(BaseModel):
    user_id: str
    email: str


class VerifyResponse(BaseModel):
    valid: bool
    user: Optional[UserInfo] = None


# ============================================
# JWT 本地解析（不验证签名，只检查过期）
# ============================================

def parse_jwt_payload(token: str) -> Optional[dict]:
    """
    解析 JWT payload（不验证签名）
    用于快速检查 token 是否过期，以及获取用户信息
    
    Returns:
        解析后的 payload，包含 sub (user_id), email, exp 等字段
        如果 token 格式无效返回 None
    """
    try:
        # 不验证签名，只解码 payload
        payload = jwt.decode(token, options={"verify_signature": False})
        return payload
    except jwt.exceptions.DecodeError as e:
        logger.warning(f"JWT decode error: {e}")
        return None
    except Exception as e:
        logger.warning(f"JWT parse error: {type(e).__name__}: {e}")
        return None


def is_token_expired(payload: dict) -> bool:
    """检查 token 是否已过期"""
    exp = payload.get("exp")
    if not exp:
        return True  # 没有过期时间，视为过期
    return time.time() > exp


def get_user_from_payload(payload: dict) -> Optional[dict]:
    """从 JWT payload 提取用户信息"""
    user_id = payload.get("sub")  # Supabase JWT 中 user_id 存储在 sub 字段
    email = payload.get("email")
    
    if not user_id:
        return None
    
    return {
        "user_id": user_id,
        "email": email or "",
    }


# ============================================
# JWT 验证辅助函数
# ============================================

async def verify_supabase_token(token: str) -> Optional[dict]:
    """
    验证 Supabase JWT Token
    
    ★ 验证策略（避免网络问题导致有效 token 被拒绝）：
    1. 首先本地解析 JWT 检查过期时间
    2. 如果 token 已过期 → 返回 None（调用者会返回 401）
    3. 如果 token 未过期 → 尝试调用 Supabase API 获取最新用户信息
    4. 如果 Supabase API 调用失败但 token 未过期 → 使用 JWT 中的信息（降级）
    """
    if not token:
        logger.warning("Token verification skipped: no token provided")
        return None
    
    # ★ Step 1: 本地解析 JWT
    payload = parse_jwt_payload(token)
    if not payload:
        logger.warning("Token verification failed: invalid JWT format")
        return None
    
    # ★ Step 2: 检查过期时间
    if is_token_expired(payload):
        exp = payload.get("exp", 0)
        logger.warning(f"Token expired: exp={exp}, now={int(time.time())}, expired_ago={(int(time.time()) - exp)}s")
        return None  # token 真的过期了，返回 None → 401
    
    # ★ Step 3: 从 JWT 提取用户信息（作为降级方案）
    fallback_user = get_user_from_payload(payload)
    if not fallback_user:
        logger.warning("Token verification failed: no user_id in JWT payload")
        return None
    
    # ★ Step 4: 尝试调用 Supabase API 获取最新信息（可选，失败时降级）
    if settings.supabase_url:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{settings.supabase_url}/auth/v1/user",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "apikey": settings.supabase_anon_key,
                    },
                    timeout=5.0,  # 缩短超时时间
                )
                
                if response.status_code == 200:
                    try:
                        user_data = response.json()
                        user_id = user_data.get("id")
                        email = user_data.get("email")
                        if user_id:
                            return {
                                "user_id": user_id,
                                "email": email,
                            }
                    except Exception as json_err:
                        logger.warning(f"Supabase API JSON parse error: {json_err}")
                elif response.status_code == 401:
                    # Supabase 明确说 token 无效（可能被撤销）
                    logger.warning("Token revoked by Supabase")
                    return None
                else:
                    logger.warning(f"Supabase API returned {response.status_code}")
                    
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            # 网络问题，使用降级方案
            logger.warning(f"Supabase API unreachable ({type(e).__name__}), using JWT payload as fallback")
        except Exception as e:
            logger.warning(f"Supabase API error ({type(e).__name__}: {e}), using JWT payload as fallback")
    
    # ★ Step 5: Supabase API 不可用或失败，使用 JWT payload 中的信息
    logger.info(f"Using JWT payload fallback for user: {fallback_user['user_id'][:8]}...")
    return fallback_user


async def get_token_from_header(authorization: str = Header(None)) -> Optional[str]:
    """从 Authorization header 提取 token"""
    if not authorization:
        return None
    
    if authorization.startswith("Bearer "):
        return authorization[7:]
    return authorization


async def get_current_user(authorization: str = Header(None)) -> dict:
    """
    获取当前用户（必须已登录）
    作为路由依赖使用
    """
    token = await get_token_from_header(authorization)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="未授权访问，请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = await verify_supabase_token(token)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="登录已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user


async def get_optional_user(authorization: str = Header(None)) -> Optional[dict]:
    """
    获取当前用户（可选）
    用于既可以匿名也可以登录访问的接口
    """
    token = await get_token_from_header(authorization)
    if not token:
        return None
    
    return await verify_supabase_token(token)


async def get_current_user_id(authorization: str = Header(None)) -> str:
    """
    获取当前用户 ID（必须已登录）
    """
    token = await get_token_from_header(authorization)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="未授权访问，请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = await verify_supabase_token(token)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="登录已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user.get("user_id")


async def get_current_user_id_optional(authorization: str = Header(None)) -> Optional[str]:
    """
    获取当前用户 ID（可选，未登录返回 None）
    用于不强制要求登录但需要用户信息的场景
    """
    token = await get_token_from_header(authorization)
    if not token:
        return None
    
    user = await verify_supabase_token(token)
    if not user:
        return None
    
    return user.get("user_id")


# ============================================
# 认证路由
# ============================================

@router.get("/verify", response_model=VerifyResponse)
async def verify_token(user: Optional[dict] = Depends(get_optional_user)):
    """
    验证当前 Token 是否有效
    """
    if user:
        return VerifyResponse(
            valid=True,
            user=UserInfo(user_id=user["user_id"], email=user["email"]),
        )
    return VerifyResponse(valid=False)


@router.get("/me", response_model=UserInfo)
async def get_current_user_info(user: dict = Depends(get_current_user)):
    """
    获取当前登录用户信息
    """
    return UserInfo(user_id=user["user_id"], email=user["email"])
