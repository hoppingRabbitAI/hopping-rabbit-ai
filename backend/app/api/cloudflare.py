"""
Cloudflare Stream API 路由
处理视频上传和播放 URL 获取
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict
import logging

from ..services.cloudflare_stream import (
    create_upload_url,
    upload_from_url,
    get_video_status,
    wait_for_ready,
    get_hls_url,
    get_thumbnail_url,
    is_configured,
    # enable_mp4_download, wait_for_mp4_ready 不再需要，FFmpeg 直接读取 HLS
)
from ..services.supabase_client import supabase
from .auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cloudflare", tags=["cloudflare"])


# ============================================
# 请求/响应模型
# ============================================

class CreateUploadRequest(BaseModel):
    """创建上传请求"""
    asset_id: str  # 关联的 asset ID
    file_size: int  # 文件大小（字节）- TUS 协议必须
    max_duration_seconds: int = 3600


class CreateUploadResponse(BaseModel):
    """创建上传响应"""
    upload_url: str
    video_uid: str
    asset_id: str


class UploadFromUrlRequest(BaseModel):
    """从 URL 上传请求"""
    asset_id: str
    video_url: str


class VideoStatusResponse(BaseModel):
    """视频状态响应"""
    asset_id: str
    cloudflare_uid: Optional[str]
    cloudflare_status: str
    hls_url: Optional[str]
    thumbnail_url: Optional[str]
    duration: Optional[float]
    is_ready: bool


# ============================================
# API 路由
# ============================================

@router.get("/status")
async def get_service_status():
    """检查 Cloudflare Stream 服务状态"""
    return {
        "configured": is_configured(),
        "service": "cloudflare_stream",
    }


@router.post("/upload/create", response_model=CreateUploadResponse)
async def create_direct_upload(
    request: CreateUploadRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    创建直传上传 URL（前端使用 TUS 协议上传）
    
    流程：
    1. 创建 Cloudflare 上传 URL
    2. 更新 asset 记录
    3. 前端使用返回的 URL 上传视频
    4. 上传完成后调用 /upload/complete 通知
    """
    if not is_configured():
        raise HTTPException(status_code=503, detail="Cloudflare Stream 未配置")
    
    user_id = current_user["user_id"]
    asset_id = request.asset_id
    
    # 验证 asset 归属
    asset_result = supabase.table("assets").select("*").eq("id", asset_id).single().execute()
    if not asset_result.data:
        raise HTTPException(status_code=404, detail="Asset 不存在")
    
    asset = asset_result.data
    if asset.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权操作此资源")
    
    # 创建上传 URL
    metadata = {
        "asset_id": asset_id,
        "user_id": user_id,
    }
    
    upload_url, video_uid = await create_upload_url(
        file_size=request.file_size,
        max_duration_seconds=request.max_duration_seconds,
        metadata=metadata,
    )
    
    if not upload_url or not video_uid:
        raise HTTPException(status_code=500, detail="创建上传 URL 失败")
    
    # 更新 asset 记录
    supabase.table("assets").update({
        "cloudflare_uid": video_uid,
        "cloudflare_status": "uploading",
    }).eq("id", asset_id).execute()
    
    logger.info(f"[CF API] 创建上传 URL: asset={asset_id}, cf_uid={video_uid[:8]}...")
    
    return CreateUploadResponse(
        upload_url=upload_url,
        video_uid=video_uid,
        asset_id=asset_id,
    )


@router.post("/upload/from-url")
async def upload_video_from_url(
    request: UploadFromUrlRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    从 URL 上传视频到 Cloudflare（后端触发）
    
    适用于迁移现有 Supabase 视频到 Cloudflare
    """
    if not is_configured():
        raise HTTPException(status_code=503, detail="Cloudflare Stream 未配置")
    
    user_id = current_user["user_id"]
    asset_id = request.asset_id
    
    # 验证 asset
    asset_result = supabase.table("assets").select("*").eq("id", asset_id).single().execute()
    if not asset_result.data:
        raise HTTPException(status_code=404, detail="Asset 不存在")
    
    asset = asset_result.data
    if asset.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权操作此资源")
    
    # 更新状态为上传中
    supabase.table("assets").update({
        "cloudflare_status": "uploading",
    }).eq("id", asset_id).execute()
    
    # 上传到 Cloudflare
    metadata = {
        "asset_id": asset_id,
        "user_id": user_id,
    }
    
    video_uid = await upload_from_url(request.video_url, metadata)
    
    if not video_uid:
        supabase.table("assets").update({
            "cloudflare_status": "error",
        }).eq("id", asset_id).execute()
        raise HTTPException(status_code=500, detail="上传到 Cloudflare 失败")
    
    # 更新记录
    supabase.table("assets").update({
        "cloudflare_uid": video_uid,
        "cloudflare_status": "processing",
    }).eq("id", asset_id).execute()
    
    logger.info(f"[CF API] URL 上传成功: asset={asset_id}, cf_uid={video_uid[:8]}...")
    
    return {
        "status": "ok",
        "asset_id": asset_id,
        "cloudflare_uid": video_uid,
        "message": "视频已提交转码，请稍后查询状态",
    }


@router.post("/upload/complete/{asset_id}")
async def notify_upload_complete(
    asset_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    通知上传完成，开始等待转码
    
    前端上传完成后调用此接口，后端会：
    1. 更新状态为 processing
    2. 后台轮询等待转码完成
    3. 转码完成后更新状态为 ready
    """
    user_id = current_user["user_id"]
    
    # 验证 asset
    asset_result = supabase.table("assets").select("*").eq("id", asset_id).single().execute()
    if not asset_result.data:
        raise HTTPException(status_code=404, detail="Asset 不存在")
    
    asset = asset_result.data
    if asset.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权操作此资源")
    
    cloudflare_uid = asset.get("cloudflare_uid")
    if not cloudflare_uid:
        raise HTTPException(status_code=400, detail="未关联 Cloudflare 视频")
    
    # 更新状态为处理中，同时更新 storage_path 标记为 Cloudflare 存储
    supabase.table("assets").update({
        "cloudflare_status": "processing",
        "storage_path": f"cloudflare:{cloudflare_uid}",  # ★ 标记为 Cloudflare 存储
        "status": "processing",  # 同步更新主状态
    }).eq("id", asset_id).execute()
    
    # 后台任务：等待转码完成
    import asyncio
    
    async def wait_and_update():
        try:
            is_ready, video_info = await wait_for_ready(cloudflare_uid, timeout_seconds=600)
            
            if is_ready and video_info:
                # ★ 不再需要 MP4 下载，FFmpeg 可直接读取 HLS
                
                # 更新为就绪状态
                hls_url = get_hls_url(cloudflare_uid)
                thumbnail_url = get_thumbnail_url(cloudflare_uid)
                duration = video_info.get("duration", 0)
                
                supabase.table("assets").update({
                    "cloudflare_status": "ready",
                    "status": "ready",  # ★ 同步更新主状态
                    "hls_path": hls_url,  # 复用 hls_path 字段存储 Cloudflare HLS URL
                    "thumbnail_path": thumbnail_url,  # ★ 使用 thumbnail_path 字段
                    "duration": duration,
                    "hls_status": "ready",
                }).eq("id", asset_id).execute()
                
                logger.info(f"[CF API] ✅ 转码完成: asset={asset_id}")
            else:
                # 转码失败
                supabase.table("assets").update({
                    "cloudflare_status": "error",
                    "hls_status": "failed",
                }).eq("id", asset_id).execute()
                
                logger.error(f"[CF API] ❌ 转码失败: asset={asset_id}")
                
        except Exception as e:
            logger.error(f"[CF API] 转码监控异常: {e}")
            supabase.table("assets").update({
                "cloudflare_status": "error",
            }).eq("id", asset_id).execute()
    
    # 启动后台任务
    asyncio.create_task(wait_and_update())
    
    return {
        "status": "ok",
        "asset_id": asset_id,
        "cloudflare_uid": cloudflare_uid,
        "message": "正在转码中，请稍后查询状态",
    }


@router.get("/video/{asset_id}", response_model=VideoStatusResponse)
async def get_video_info(
    asset_id: str,
    current_user: dict = Depends(get_current_user)
):
    """获取视频状态和播放 URL"""
    user_id = current_user["user_id"]
    
    # 获取 asset
    asset_result = supabase.table("assets").select("*").eq("id", asset_id).single().execute()
    if not asset_result.data:
        raise HTTPException(status_code=404, detail="Asset 不存在")
    
    asset = asset_result.data
    if asset.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权操作此资源")
    
    cloudflare_uid = asset.get("cloudflare_uid")
    cloudflare_status = asset.get("cloudflare_status", "none")
    
    hls_url = None
    thumbnail_url = None
    
    if cloudflare_uid and cloudflare_status == "ready":
        hls_url = get_hls_url(cloudflare_uid)
        thumbnail_url = get_thumbnail_url(cloudflare_uid)
    
    return VideoStatusResponse(
        asset_id=asset_id,
        cloudflare_uid=cloudflare_uid,
        cloudflare_status=cloudflare_status,
        hls_url=hls_url,
        thumbnail_url=thumbnail_url,
        duration=asset.get("duration"),
        is_ready=cloudflare_status == "ready",
    )
