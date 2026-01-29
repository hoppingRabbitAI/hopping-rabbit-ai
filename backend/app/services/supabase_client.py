"""
HoppingRabbit AI - Supabase Client
直接连接 Supabase 服务
"""
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
import httpx
from app.config import get_settings
from functools import lru_cache, wraps
from typing import Optional, Any, List, Dict, Callable, TypeVar
import time
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

T = TypeVar('T')


# ============================================
# 重试装饰器 - 解决 HTTP/2 "Server disconnected" 问题
# ============================================
def with_retry(max_retries: int = 3, retry_delay: float = 0.5):
    """
    装饰器：自动重试 Supabase 操作，处理 HTTP/2 断连问题
    
    Args:
        max_retries: 最大重试次数
        retry_delay: 重试间隔（秒）
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            last_error = None
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError) as e:
                    last_error = e
                    if attempt < max_retries:
                        logger.warning(f"[Supabase] 连接断开，重试 {attempt + 1}/{max_retries}: {e}")
                        time.sleep(retry_delay * (attempt + 1))  # 指数退避
                        # 重置连接池
                        _reset_client()
                    else:
                        logger.error(f"[Supabase] 重试 {max_retries} 次后仍失败: {e}")
                        raise
            raise last_error
        return wrapper
    return decorator


def _reset_client():
    """重置 Supabase 客户端连接"""
    global _client, supabase
    _client = None
    supabase = get_supabase()

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

# Admin 客户端（使用 service_role key，绕过 RLS）
_admin_client: Optional[Client] = None

def get_supabase_admin_client() -> Client:
    """
    获取 Supabase Admin 客户端（使用 service_role key）
    用于需要绕过 RLS 的操作，如积分管理、用户配额等
    """
    global _admin_client
    
    if _admin_client is None:
        if not settings.supabase_url:
            raise RuntimeError("Supabase URL is required. Check your .env file.")
        
        # 优先使用 service key，否则降级到 anon key
        api_key = settings.supabase_service_key or settings.supabase_anon_key
        if not api_key:
            raise RuntimeError("Supabase API key is required. Check your .env file.")
        
        _admin_client = create_client(
            settings.supabase_url,
            api_key,
            options=ClientOptions(
                postgrest_client_timeout=30,
                storage_client_timeout=60,
            )
        )
        logger.info(f"Admin client connected to: {settings.supabase_url}")
    
    return _admin_client


def get_file_url(bucket: str, path: str, expires_in: int = SIGNED_URL_EXPIRES_SECONDS) -> str:
    """
    获取文件的可访问 URL（带缓存）
    优先使用签名 URL（适用于私有 bucket），失败时回退到公开 URL
    
    Args:
        bucket: 存储桶名称 (如 'clips', 'videos')
        path: 文件路径（可以是相对路径或完整 URL，或 cloudflare:video_uid）
        expires_in: 签名 URL 有效期（秒），默认 7 天
        
    Returns:
        可访问的文件 URL
    """
    # 空路径检查
    if not path:
        return ""
    
    # ★ Cloudflare Stream 视频：返回 HLS URL（FFmpeg 直接支持 HLS 输入）
    if path.startswith('cloudflare:'):
        video_uid = path.replace('cloudflare:', '')
        # 使用 HLS URL（FFmpeg 支持，无需等待 MP4 下载启用）
        return f"https://videodelivery.net/{video_uid}/manifest/video.m3u8"
    
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


def create_signed_upload_url(bucket: str, path: str, upsert: bool = True) -> dict:
    """
    创建签名上传 URL，支持 upsert 参数
    
    Args:
        bucket: 存储桶名称
        path: 文件路径
        upsert: 是否允许覆盖已存在的文件（默认 True，避免重试失败）
        
    Returns:
        { "signed_url": "...", "token": "...", "path": "..." }
    """
    import httpx
    
    try:
        # 直接调用 Supabase Storage REST API
        base_url = settings.supabase_url
        api_key = settings.supabase_service_key or settings.supabase_anon_key
        
        # POST /storage/v1/object/upload/sign/{bucket}/{path}
        url = f"{base_url}/storage/v1/object/upload/sign/{bucket}/{path}"
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "apikey": api_key,
            "x-upsert": "true" if upsert else "false",  # ★ 正确的方式：使用 x-upsert header
        }
        
        with httpx.Client(timeout=30.0) as client:
            response = client.post(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            # 构建完整的签名 URL
            signed_url = f"{base_url}/storage/v1{data['url']}"
            
            # 解析 token
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(signed_url)
            query_params = parse_qs(parsed.query)
            token = query_params.get("token", [""])[0]
            
            return {
                "signed_url": signed_url,
                "signedURL": signed_url,  # 兼容旧字段
                "token": token,
                "path": path,
            }
    except Exception as e:
        logger.error(f"创建签名上传 URL 失败: {e}")
        # 回退到 SDK 方法（不支持 upsert）
        result = supabase.storage.from_(bucket).create_signed_upload_url(path)
        return {
            "signed_url": result.get("signedURL") or result.get("signed_url", ""),
            "signedURL": result.get("signedURL") or result.get("signed_url", ""),
            "token": result.get("token", ""),
            "path": path,
        }


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
    
    # 先处理特殊路径和缓存
    for path in paths:
        # ★ Cloudflare 视频：返回 HLS URL（FFmpeg 支持直接读取）
        if path.startswith('cloudflare:'):
            video_uid = path.replace('cloudflare:', '')
            result[path] = f"https://videodelivery.net/{video_uid}/manifest/video.m3u8"
            continue
        
        # 已经是完整 URL
        if path.startswith('http://') or path.startswith('https://'):
            result[path] = path
            continue
        
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
