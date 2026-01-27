"""
文件上传 API
处理前端文件上传到 Supabase Storage，避免前端直接访问 Storage
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Form
from fastapi.responses import JSONResponse
from typing import Optional
import os
import uuid
from datetime import datetime
from app.services.supabase_client import get_supabase

router = APIRouter()

# 允许的文件类型
ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'}
ALLOWED_VIDEO_TYPES = {'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'}
ALLOWED_AUDIO_TYPES = {'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp3', 'audio/aac', 'audio/ogg'}

# 文件大小限制（字节）
MAX_IMAGE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_VIDEO_SIZE = 500 * 1024 * 1024  # 500MB
MAX_AUDIO_SIZE = 100 * 1024 * 1024  # 100MB


def validate_file(file: UploadFile, allowed_types: set, max_size: int) -> None:
    """验证文件类型和大小"""
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400, 
            detail=f"不支持的文件类型: {file.content_type}"
        )
    
    # 读取文件大小（不加载到内存）
    file.file.seek(0, 2)  # 移到文件末尾
    size = file.file.tell()
    file.file.seek(0)  # 重置到开头
    
    if size > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"文件过大: {size / (1024*1024):.1f}MB，最大允许 {max_size / (1024*1024):.0f}MB"
        )


@router.post("/upload/image")
async def upload_image(
    file: UploadFile = File(...),
    prefix: Optional[str] = Form("image")
):
    """
    上传图片到 Supabase Storage
    
    Returns:
        {
            "url": "https://xxx.supabase.co/storage/v1/object/public/ai-creations/...",
            "path": "image/xxx.jpg"
        }
    """
    try:
        # 验证文件
        validate_file(file, ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE)
        
        # 生成唯一文件名
        timestamp = int(datetime.utcnow().timestamp() * 1000)
        ext = file.filename.split('.')[-1].lower() if '.' in file.filename else 'jpg'
        filename = f"{prefix}/{timestamp}_{uuid.uuid4().hex[:8]}.{ext}"
        
        # 读取文件内容
        content = await file.read()
        
        # 上传到 Supabase Storage
        supabase = get_supabase()
        result = supabase.storage.from_("ai-creations").upload(
            filename,
            content,
            {
                "content-type": file.content_type,
                "upsert": "true"
            }
        )
        
        if hasattr(result, 'error') and result.error:
            raise HTTPException(status_code=500, detail=f"上传失败: {result.error}")
        
        # 获取公开 URL
        url_data = supabase.storage.from_("ai-creations").get_public_url(filename)
        
        return {
            "url": url_data,
            "path": filename
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@router.post("/upload/video")
async def upload_video(
    file: UploadFile = File(...),
    prefix: Optional[str] = Form("video")
):
    """
    上传视频到 Supabase Storage
    
    Returns:
        {
            "url": "https://xxx.supabase.co/storage/v1/object/public/ai-creations/...",
            "path": "video/xxx.mp4"
        }
    """
    try:
        # 验证文件
        validate_file(file, ALLOWED_VIDEO_TYPES, MAX_VIDEO_SIZE)
        
        # 生成唯一文件名
        timestamp = int(datetime.utcnow().timestamp() * 1000)
        ext = file.filename.split('.')[-1].lower() if '.' in file.filename else 'mp4'
        filename = f"{prefix}/{timestamp}_{uuid.uuid4().hex[:8]}.{ext}"
        
        # 读取文件内容
        content = await file.read()
        
        # 上传到 Supabase Storage
        supabase = get_supabase()
        result = supabase.storage.from_("ai-creations").upload(
            filename,
            content,
            {
                "content-type": file.content_type,
                "upsert": "true"
            }
        )
        
        if hasattr(result, 'error') and result.error:
            raise HTTPException(status_code=500, detail=f"上传失败: {result.error}")
        
        # 获取公开 URL
        url_data = supabase.storage.from_("ai-creations").get_public_url(filename)
        
        return {
            "url": url_data,
            "path": filename
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@router.post("/upload/audio")
async def upload_audio(
    file: UploadFile = File(...),
    prefix: Optional[str] = Form("audio")
):
    """
    上传音频到 Supabase Storage
    
    Returns:
        {
            "url": "https://xxx.supabase.co/storage/v1/object/public/ai-creations/...",
            "path": "audio/xxx.mp3"
        }
    """
    try:
        # 验证文件
        validate_file(file, ALLOWED_AUDIO_TYPES, MAX_AUDIO_SIZE)
        
        # 生成唯一文件名
        timestamp = int(datetime.utcnow().timestamp() * 1000)
        ext = file.filename.split('.')[-1].lower() if '.' in file.filename else 'mp3'
        filename = f"{prefix}/{timestamp}_{uuid.uuid4().hex[:8]}.{ext}"
        
        # 读取文件内容
        content = await file.read()
        
        # 上传到 Supabase Storage
        supabase = get_supabase()
        result = supabase.storage.from_("ai-creations").upload(
            filename,
            content,
            {
                "content-type": file.content_type,
                "upsert": "true"
            }
        )
        
        if hasattr(result, 'error') and result.error:
            raise HTTPException(status_code=500, detail=f"上传失败: {result.error}")
        
        # 获取公开 URL
        url_data = supabase.storage.from_("ai-creations").get_public_url(filename)
        
        return {
            "url": url_data,
            "path": filename
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")
