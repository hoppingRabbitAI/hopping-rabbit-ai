"""
Cloudflare Stream 服务
用于视频上传、转码和 HLS 流式播放

官方文档: https://developers.cloudflare.com/stream/
"""
import os
import logging
import httpx
import asyncio
from typing import Optional, Dict, Any, Tuple
from datetime import datetime
from dotenv import load_dotenv

# 加载 .env
load_dotenv()

logger = logging.getLogger(__name__)

# ============================================
# 配置
# ============================================
CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
CLOUDFLARE_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN", "")

# API 基础 URL
CF_API_BASE = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/stream"

# 请求头
def _get_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json",
    }


# ============================================
# 视频上传
# ============================================

async def create_upload_url(
    file_size: int,
    max_duration_seconds: int = 3600,
    metadata: Optional[Dict[str, str]] = None
) -> Tuple[Optional[str], Optional[str]]:
    """
    创建 TUS 上传 URL（前端直传用）
    
    Cloudflare Stream 支持 TUS 协议，前端可以直接上传大文件
    
    Args:
        file_size: 文件大小（字节）- TUS 协议必须
        max_duration_seconds: 最大视频时长（秒）
        metadata: 自定义元数据
    
    Returns:
        (upload_url, video_uid) 或 (None, None) 失败时
    """
    if not CLOUDFLARE_ACCOUNT_ID or not CLOUDFLARE_API_TOKEN:
        logger.error("[CF Stream] 未配置 Cloudflare 凭证")
        return None, None
    
    if file_size <= 0:
        logger.error("[CF Stream] file_size 必须大于 0")
        return None, None
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # TUS 创建上传
            headers = _get_headers()
            headers["Tus-Resumable"] = "1.0.0"
            headers["Upload-Length"] = str(file_size)  # ★ 必须提供文件大小
            
            # 元数据编码 - TUS 协议要求所有值都 base64 编码
            import base64
            
            def encode_meta_value(val: str) -> str:
                return base64.b64encode(val.encode()).decode()
            
            meta_parts = [f"maxDurationSeconds {encode_meta_value(str(max_duration_seconds))}"]
            if metadata:
                for key, value in metadata.items():
                    meta_parts.append(f"{key} {encode_meta_value(value)}")
            
            headers["Upload-Metadata"] = ",".join(meta_parts)
            
            response = await client.post(
                f"{CF_API_BASE}?direct_user=true",
                headers=headers,
            )
            
            if response.status_code in (200, 201):
                # 从响应头获取上传 URL
                upload_url = response.headers.get("Location") or response.headers.get("location")
                # 从 URL 中提取 video UID
                if upload_url:
                    # URL 格式: https://upload.videodelivery.net/tus/xxxxx
                    video_uid = upload_url.split("/")[-1].split("?")[0]
                    logger.info(f"[CF Stream] ✅ 创建上传 URL 成功: {video_uid[:8]}...")
                    return upload_url, video_uid
            
            logger.error(f"[CF Stream] 创建上传 URL 失败: {response.status_code} - {response.text}")
            return None, None
            
    except Exception as e:
        logger.error(f"[CF Stream] 创建上传 URL 异常: {e}")
        return None, None


async def upload_from_url(
    video_url: str,
    metadata: Optional[Dict[str, str]] = None
) -> Optional[str]:
    """
    从 URL 上传视频到 Cloudflare Stream（后端触发）
    
    适用于：从 Supabase 迁移现有视频到 Cloudflare
    
    Args:
        video_url: 视频的公开 URL
        metadata: 自定义元数据
    
    Returns:
        video_uid 或 None 失败时
    """
    if not CLOUDFLARE_ACCOUNT_ID or not CLOUDFLARE_API_TOKEN:
        logger.error("[CF Stream] 未配置 Cloudflare 凭证")
        return None
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            payload = {
                "url": video_url,
                "meta": metadata or {},
            }
            
            response = await client.post(
                f"{CF_API_BASE}/copy",
                headers=_get_headers(),
                json=payload,
            )
            
            if response.status_code in (200, 201):
                data = response.json()
                if data.get("success"):
                    video_uid = data["result"]["uid"]
                    logger.info(f"[CF Stream] ✅ URL 上传成功: {video_uid[:8]}...")
                    return video_uid
            
            logger.error(f"[CF Stream] URL 上传失败: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        logger.error(f"[CF Stream] URL 上传异常: {e}")
        return None


# ============================================
# 视频状态查询
# ============================================

async def get_video_status(video_uid: str) -> Optional[Dict[str, Any]]:
    """
    获取视频状态和详情
    
    Returns:
        {
            "uid": "xxx",
            "status": {
                "state": "ready" | "inprogress" | "error",
                "pctComplete": "100",
                "errorReasonCode": "",
                "errorReasonText": ""
            },
            "duration": 123.45,
            "size": 123456789,
            "playback": {
                "hls": "https://...",
                "dash": "https://..."
            },
            "thumbnail": "https://...",
            ...
        }
    """
    if not video_uid:
        return None
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{CF_API_BASE}/{video_uid}",
                headers=_get_headers(),
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    return data["result"]
            
            logger.warning(f"[CF Stream] 获取视频状态失败: {response.status_code}")
            return None
            
    except Exception as e:
        logger.error(f"[CF Stream] 获取视频状态异常: {e}")
        return None


async def wait_for_ready(
    video_uid: str,
    timeout_seconds: int = 300,
    poll_interval: int = 5
) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """
    等待视频转码完成
    
    Args:
        video_uid: 视频 UID
        timeout_seconds: 超时时间
        poll_interval: 轮询间隔
    
    Returns:
        (is_ready, video_info)
    """
    import asyncio
    
    start_time = datetime.now()
    
    while True:
        elapsed = (datetime.now() - start_time).total_seconds()
        if elapsed > timeout_seconds:
            logger.warning(f"[CF Stream] 等待超时: {video_uid[:8]}...")
            return False, None
        
        status = await get_video_status(video_uid)
        if not status:
            await asyncio.sleep(poll_interval)
            continue
        
        state = status.get("status", {}).get("state", "")
        pct = status.get("status", {}).get("pctComplete", "0")
        
        if state == "ready":
            logger.info(f"[CF Stream] ✅ 视频就绪: {video_uid[:8]}...")
            return True, status
        elif state == "error":
            error_text = status.get("status", {}).get("errorReasonText", "Unknown error")
            logger.error(f"[CF Stream] ❌ 转码失败: {error_text}")
            return False, status
        else:
            logger.info(f"[CF Stream] ⏳ 转码中: {video_uid[:8]}... {pct}%")
            await asyncio.sleep(poll_interval)


# ============================================
# 播放 URL 生成
# ============================================

def get_hls_url(video_uid: str) -> str:
    """获取 HLS 播放 URL（使用 Cloudflare 通用域名）"""
    return f"https://videodelivery.net/{video_uid}/manifest/video.m3u8"


def get_dash_url(video_uid: str) -> str:
    """获取 DASH 播放 URL"""
    return f"https://videodelivery.net/{video_uid}/manifest/video.mpd"


def get_thumbnail_url(video_uid: str, time_seconds: float = 0) -> str:
    """获取缩略图 URL"""
    return f"https://videodelivery.net/{video_uid}/thumbnails/thumbnail.jpg?time={time_seconds}s"


def get_iframe_embed(video_uid: str) -> str:
    """获取 iframe 嵌入代码"""
    return f'<iframe src="https://videodelivery.net/{video_uid}/iframe" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowfullscreen="true"></iframe>'


# ============================================
# 视频删除
# ============================================

async def delete_video(video_uid: str) -> bool:
    """删除视频"""
    if not video_uid:
        return False
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                f"{CF_API_BASE}/{video_uid}",
                headers=_get_headers(),
            )
            
            if response.status_code in (200, 204):
                logger.info(f"[CF Stream] 🗑️ 视频已删除: {video_uid[:8]}...")
                return True
            
            logger.warning(f"[CF Stream] 删除失败: {response.status_code}")
            return False
            
    except Exception as e:
        logger.error(f"[CF Stream] 删除异常: {e}")
        return False


# ============================================
# 启用 MP4 下载
# ============================================

async def enable_mp4_download(video_uid: str) -> bool:
    """
    启用视频的 MP4 下载功能
    
    Cloudflare Stream 默认不启用 MP4 下载，需要通过 API 开启
    开启后可以通过 /downloads/default.mp4 下载
    
    注意：启用后需要等待 Cloudflare 生成 MP4 文件，可能需要几分钟
    
    Args:
        video_uid: 视频 UID
        
    Returns:
        是否成功启用
    """
    if not video_uid:
        return False
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # ★ 正确的 API：POST 请求创建下载
            response = await client.post(
                f"{CF_API_BASE}/{video_uid}/downloads",
                headers=_get_headers(),
            )
            
            if response.status_code in (200, 201):
                data = response.json()
                if data.get("success"):
                    logger.info(f"[CF Stream] ✅ 已请求 MP4 下载: {video_uid[:8]}...")
                    return True
            
            # 409 表示已经启用
            if response.status_code == 409:
                logger.info(f"[CF Stream] ✅ MP4 下载已启用: {video_uid[:8]}...")
                return True
            
            logger.warning(f"[CF Stream] 启用下载失败: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        logger.error(f"[CF Stream] 启用下载异常: {e}")
        return False


async def wait_for_mp4_ready(video_uid: str, timeout_seconds: int = 120) -> bool:
    """
    等待 MP4 下载就绪
    
    启用 MP4 下载后，Cloudflare 需要时间生成文件
    此函数轮询检查 MP4 是否可下载
    
    Args:
        video_uid: 视频 UID
        timeout_seconds: 超时秒数
        
    Returns:
        是否就绪
    """
    if not video_uid:
        return False
    
    import time
    start_time = time.time()
    poll_interval = 3  # 每 3 秒检查一次
    mp4_url = get_mp4_download_url(video_uid)
    
    logger.info(f"[CF Stream] ⏳ 等待 MP4 下载就绪: {video_uid[:8]}...")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        while time.time() - start_time < timeout_seconds:
            try:
                response = await client.head(mp4_url)
                
                if response.status_code == 200:
                    logger.info(f"[CF Stream] ✅ MP4 下载就绪: {video_uid[:8]}...")
                    return True
                elif response.status_code == 404:
                    # 还在生成中
                    pass
                else:
                    logger.warning(f"[CF Stream] MP4 检查异常: {response.status_code}")
                    
            except Exception as e:
                logger.debug(f"[CF Stream] MP4 检查失败: {e}")
            
            await asyncio.sleep(poll_interval)
    
    logger.warning(f"[CF Stream] ⚠️ MP4 等待超时 ({timeout_seconds}s): {video_uid[:8]}...")
    return False


def get_mp4_download_url(video_uid: str) -> str:
    """获取 MP4 下载 URL"""
    return f"https://videodelivery.net/{video_uid}/downloads/default.mp4"


# ============================================
# 工具函数
# ============================================

def is_configured() -> bool:
    """检查 Cloudflare Stream 是否已配置"""
    return bool(CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)


async def test_connection() -> bool:
    """测试 API 连接"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                CF_API_BASE,
                headers=_get_headers(),
                params={"limit": 1},
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    logger.info("[CF Stream] ✅ API 连接成功")
                    return True
            
            logger.error(f"[CF Stream] API 连接失败: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        logger.error(f"[CF Stream] API 连接异常: {e}")
        return False
