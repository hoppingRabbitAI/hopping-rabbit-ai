"""
HoppingRabbit AI - Supabase Client
直接连接 Supabase 服务
"""
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
import httpx
from app.config import get_settings
from functools import lru_cache
from typing import Optional, Any, List, Dict
import time
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

_client: Optional[Client] = None

# ============================================
# 常量定义
# ============================================

# URL 签名有效期（秒）- 默认 7 天
SIGNED_URL_EXPIRES_SECONDS = 60 * 60 * 24 * 7  # 7 days

# URL 缓存有效期提前量（秒）- 在过期前 1 小时就刷新
URL_CACHE_MARGIN_SECONDS = 3600  # 1 hour

# ========== URL 缓存 ==========
# 结构: { "bucket:path": {"url": "...", "expires_at": timestamp} }
_url_cache: Dict[str, Dict[str, Any]] = {}

# ========== HTTP 连接池配置 ==========
# 解决 HTTP/2 连接被服务器端关闭导致的 "Server disconnected" 错误
# 通过限制连接保持时间和使用 HTTP/1.1 避免连接复用问题
_http_limits = httpx.Limits(
    max_keepalive_connections=5,  # 减少保持的连接数
    max_connections=20,           # 最大并发连接
    keepalive_expiry=30.0,        # 连接保持 30 秒（Supabase 默认可能是 60s）
)
_http_timeout = httpx.Timeout(30.0, connect=10.0)


def get_supabase() -> Client:
    """
    获取 Supabase 客户端（单例）
    """
    global _client
    
    if _client is None:
        if not settings.supabase_url or not settings.supabase_anon_key:
            raise RuntimeError("Supabase URL and API key are required. Check your .env file.")
        
        # 优先使用 service key（有更高权限），否则用 anon key
        api_key = settings.supabase_service_key or settings.supabase_anon_key
        
        # 配置 httpx 连接池，避免 HTTP/2 连接复用导致的断连问题
        _client = create_client(
            settings.supabase_url,
            api_key,
            options=ClientOptions(
                postgrest_client_timeout=30,
                storage_client_timeout=60,
            )
        )
        logger.info(f"Connected to: {settings.supabase_url}")
    
    return _client


# 导出单例实例
supabase = get_supabase()


def get_file_url(bucket: str, path: str, expires_in: int = SIGNED_URL_EXPIRES_SECONDS) -> str:
    """
    获取文件的可访问 URL（带缓存）
    优先使用签名 URL（适用于私有 bucket），失败时回退到公开 URL
    
    Args:
        bucket: 存储桶名称 (如 'clips', 'videos')
        path: 文件路径（可以是相对路径或完整 URL）
        expires_in: 签名 URL 有效期（秒），默认 7 天
        
    Returns:
        可访问的文件 URL
    """
    # 空路径检查
    if not path:
        return ""
    
    # 如果 path 已经是完整的 URL，直接返回
    if path.startswith('http://') or path.startswith('https://'):
        return path
    
    cache_key = f"{bucket}:{path}"
    now = time.time()
    
    # 检查缓存
    if cache_key in _url_cache:
        cached = _url_cache[cache_key]
        if cached["expires_at"] > now + URL_CACHE_MARGIN_SECONDS:
            return cached["url"]
    
    # 生成新的签名 URL
    try:
        signed_result = supabase.storage.from_(bucket).create_signed_url(path, expires_in)
        url = signed_result.get("signedURL") or signed_result.get("signed_url", "")
        if url:
            # 缓存结果
            _url_cache[cache_key] = {
                "url": url,
                "expires_at": now + expires_in
            }
            return url
    except Exception as e:
        # 文件不存在/400/404 是正常情况（如检查缓存），不需要 warning 级别
        error_msg = str(e)
        if any(x in error_msg.lower() for x in ["not_found", "object not found", "400", "404", "not found"]):
            logger.debug(f"签名 URL 创建失败（文件不存在或无效）: {path}")
        else:
            logger.warning(f"签名 URL 创建失败: {e}")
    
    # 回退到公开 URL（去除末尾多余的 ?）
    public_url = supabase.storage.from_(bucket).get_public_url(path)
    return public_url.rstrip('?')


def get_file_urls_batch(bucket: str, paths: List[str], expires_in: int = SIGNED_URL_EXPIRES_SECONDS) -> Dict[str, str]:
    """
    批量获取文件的签名 URL（高效）
    
    Args:
        bucket: 存储桶名称
        paths: 文件路径列表
        expires_in: 签名 URL 有效期（秒）
        
    Returns:
        { path: url } 映射
    """
    # 过滤掉 None 和空字符串
    paths = [p for p in paths if p]
    if not paths:
        return {}
    
    now = time.time()
    result = {}
    paths_to_sign = []
    
    # 先从缓存获取
    for path in paths:
        cache_key = f"{bucket}:{path}"
        if cache_key in _url_cache:
            cached = _url_cache[cache_key]
            if cached["expires_at"] > now + URL_CACHE_MARGIN_SECONDS:
                result[path] = cached["url"]
                continue
        paths_to_sign.append(path)
    
    # 批量签名剩余的
    if paths_to_sign:
        try:
            # Supabase 批量签名 API
            signed_results = supabase.storage.from_(bucket).create_signed_urls(paths_to_sign, expires_in)
            
            for item in signed_results:
                path = item.get("path", "")
                url = item.get("signedURL") or item.get("signed_url", "")
                if path and url:
                    result[path] = url
                    # 缓存
                    cache_key = f"{bucket}:{path}"
                    _url_cache[cache_key] = {
                        "url": url,
                        "expires_at": now + expires_in
                    }
        except Exception as e:
            logger.error(f"批量签名失败: {e}，回退到逐个签名")
            # 回退到逐个签名
            for path in paths_to_sign:
                result[path] = get_file_url(bucket, path, expires_in)
    
    return result
