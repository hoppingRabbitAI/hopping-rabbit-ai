"""
文件上传 API
处理前端文件上传到 Supabase Storage，避免前端直接访问 Storage
"""
import io
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Depends, BackgroundTasks
from typing import Optional, List, Tuple
import uuid
from datetime import datetime
from app.services.supabase_client import get_supabase
from app.api.auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


def _detect_image_dimensions(content: bytes) -> Tuple[int, int]:
    """从图片二进制内容中检测宽高，返回 (width, height)。失败返回 (0, 0)"""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(content))
        return img.size  # (width, height)
    except Exception:
        pass
    # Pillow 不可用时，尝试解析 JPEG / PNG 头
    try:
        if content[:2] == b'\xff\xd8':  # JPEG
            # 扫描 SOF marker
            i = 2
            while i < len(content) - 9:
                if content[i] != 0xFF:
                    break
                marker = content[i + 1]
                length = int.from_bytes(content[i + 2:i + 4], 'big')
                if marker in (0xC0, 0xC1, 0xC2):
                    h = int.from_bytes(content[i + 5:i + 7], 'big')
                    w = int.from_bytes(content[i + 7:i + 9], 'big')
                    return (w, h)
                i += 2 + length
        elif content[:8] == b'\x89PNG\r\n\x1a\n':  # PNG
            w = int.from_bytes(content[16:20], 'big')
            h = int.from_bytes(content[20:24], 'big')
            return (w, h)
    except Exception:
        pass
    return (0, 0)

# 允许的文件类型
ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'}
ALLOWED_VIDEO_TYPES = {'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'}
ALLOWED_AUDIO_TYPES = {'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp3', 'audio/aac', 'audio/ogg'}
ALLOWED_ARCHIVE_TYPES = {'application/zip', 'application/x-zip-compressed', 'multipart/x-zip', 'application/octet-stream', 'binary/octet-stream'}

# 文件大小限制（字节）
MAX_IMAGE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_VIDEO_SIZE = 500 * 1024 * 1024  # 500MB
MAX_AUDIO_SIZE = 100 * 1024 * 1024  # 100MB
MAX_ARCHIVE_SIZE = 1024 * 1024 * 1024  # 1GB


def validate_archive_file(file: UploadFile, max_size: int) -> None:
    """验证压缩包（当前仅支持 zip）"""
    filename = (file.filename or '').lower()
    content_type = (file.content_type or '').lower()

    ext_ok = filename.endswith('.zip')
    type_ok = content_type in ALLOWED_ARCHIVE_TYPES

    if not ext_ok and not type_ok:
        raise HTTPException(status_code=400, detail=f"不支持的压缩包类型: {file.content_type or 'unknown'}")

    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)

    if size > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"文件过大: {size / (1024*1024):.1f}MB，最大允许 {max_size / (1024*1024):.0f}MB"
        )



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


@router.post("/upload/file")
async def upload_file(
    file: UploadFile = File(...),
    prefix: Optional[str] = Form("files")
):
    """
    上传本地文件到 Supabase Storage（用于模板入库，支持 zip）

    Returns:
        {
            "url": "https://xxx.supabase.co/storage/v1/object/public/ai-creations/...",
            "path": "files/xxx.zip"
        }
    """
    try:
        validate_archive_file(file, MAX_ARCHIVE_SIZE)

        timestamp = int(datetime.utcnow().timestamp() * 1000)
        ext = file.filename.split('.')[-1].lower() if file.filename and '.' in file.filename else 'zip'
        filename = f"{prefix}/{timestamp}_{uuid.uuid4().hex[:8]}.{ext}"

        content = await file.read()

        supabase = get_supabase()
        result = supabase.storage.from_("ai-creations").upload(
            filename,
            content,
            {
                "content-type": file.content_type or "application/zip",
                "upsert": "true"
            }
        )

        if hasattr(result, 'error') and result.error:
            raise HTTPException(status_code=500, detail=f"上传失败: {result.error}")

        url_data = supabase.storage.from_("ai-creations").get_public_url(filename)

        return {
            "url": url_data,
            "path": filename,
            "content_type": file.content_type or "application/zip",
            "size": len(content),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


# ============================================
# 批量上传：创建项目素材（一次调用搞定）
# ============================================

ALLOWED_MEDIA_TYPES = ALLOWED_IMAGE_TYPES | ALLOWED_VIDEO_TYPES


def _get_file_type(content_type: str) -> str:
    """根据 MIME 类型判断 file_type"""
    if content_type and content_type.startswith("video/"):
        return "video"
    if content_type and content_type.startswith("audio/"):
        return "audio"
    return "image"


@router.post("/upload/batch")
async def upload_batch(
    files: List[UploadFile] = File(...),
    project_id: str = Form(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    user_id: str = Depends(get_current_user_id),
):
    """
    批量上传素材到项目

    一次请求上传多个图片/视频，自动：
    1. 上传到 Supabase Storage
    2. 在 assets 表创建记录
    3. 在 canvas_nodes 表创建对应的自由节点（★ 关键：让 Visual Editor 能看到）
    4. 后台提取视频元数据

    Returns:
        { "assets": [ { id, url, file_type, ... }, ... ], "failed": [...] }
    """
    supabase = get_supabase()
    now = datetime.utcnow().isoformat()
    created_assets = []
    failed = []
    canvas_node_rows = []  # ★ 收集要批量创建的画布节点

    for file in files:
        fname = file.filename or "unknown"
        try:
            content_type = (file.content_type or "").lower()
            # 验证类型
            if content_type not in ALLOWED_MEDIA_TYPES:
                failed.append({"file_name": fname, "error": f"不支持的类型: {content_type}"})
                continue

            is_video = content_type.startswith("video/")
            max_size = MAX_VIDEO_SIZE if is_video else MAX_IMAGE_SIZE

            # 验证大小
            file.file.seek(0, 2)
            size = file.file.tell()
            file.file.seek(0)
            if size > max_size:
                failed.append({"file_name": fname, "error": f"文件过大: {size / (1024*1024):.1f}MB"})
                continue

            # 上传到 Storage
            asset_id = str(uuid.uuid4())
            ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ("mp4" if is_video else "jpg")
            timestamp = int(datetime.utcnow().timestamp() * 1000)
            prefix = "project-assets"
            storage_path = f"{prefix}/{project_id}/{timestamp}_{asset_id[:8]}.{ext}"

            content = await file.read()

            supabase.storage.from_("ai-creations").upload(
                storage_path,
                content,
                {"content-type": content_type, "upsert": "true"},
            )

            public_url = supabase.storage.from_("ai-creations").get_public_url(storage_path)

            # 创建 asset 记录
            file_type = _get_file_type(content_type)

            # ★ 图片：同步检测宽高（一次检测，asset + canvas_node 共用）
            img_w, img_h = 0, 0
            if not is_video:
                img_w, img_h = _detect_image_dimensions(content)

            asset_data = {
                "id": asset_id,
                "project_id": project_id,
                "user_id": user_id,
                "name": fname,
                "original_filename": fname,
                "file_type": file_type,
                "mime_type": content_type,
                "file_size": size,
                "storage_path": storage_path,
                "status": "processing" if is_video else "ready",
                "created_at": now,
                "updated_at": now,
            }
            if img_w > 0 and img_h > 0:
                asset_data["width"] = img_w
                asset_data["height"] = img_h

            supabase.table("assets").insert(asset_data).execute()

            # 视频后台处理（提取元数据、生成缩略图）
            if is_video:
                from app.api.assets import process_asset
                background_tasks.add_task(process_asset, asset_id)

            # ★ 确定 aspect_ratio（图片从像素判断，视频默认 16:9 等后台探测纠正）
            aspect_ratio = "16:9"
            if img_w > 0 and img_h > 0:
                aspect_ratio = "9:16" if img_h > img_w else "16:9"
                logger.debug(f"[Upload/Batch] 图片尺寸: {img_w}x{img_h} → {aspect_ratio}")

            # ★ 构建 canvas_node 行（free 节点，自动网格布局）
            node_index = len(created_assets)
            col = node_index % 3
            row_idx = node_index // 3
            canvas_node_rows.append({
                "id": str(uuid.uuid4()),
                "project_id": project_id,
                "asset_id": asset_id,
                "node_type": "free",
                "media_type": file_type if file_type in ("video", "image") else "image",
                "order_index": node_index,
                "start_time": 0,
                "end_time": 0,
                "duration": 0,
                "source_start": 0,
                "source_end": 0,
                "canvas_position": {"x": 100 + col * 400, "y": 100 + row_idx * 400},
                "video_url": public_url if is_video else None,
                "thumbnail_url": public_url if not is_video else None,
                "metadata": {
                    "aspect_ratio": aspect_ratio,
                    "width": img_w if img_w > 0 else None,
                    "height": img_h if img_h > 0 else None,
                },
                "created_at": now,
                "updated_at": now,
            })

            created_assets.append({
                "id": asset_id,
                "url": public_url,
                "file_type": file_type,
                "file_name": fname,
                "file_size": size,
            })

            logger.info(f"[Upload/Batch] ✅ {fname} → {asset_id}")

        except Exception as e:
            logger.error(f"[Upload/Batch] ❌ {fname}: {e}")
            failed.append({"file_name": fname, "error": str(e)})

    # ★ 批量创建 canvas_nodes（让 Visual Editor 能直接显示上传的素材）
    if canvas_node_rows:
        try:
            supabase.table("canvas_nodes").insert(canvas_node_rows).execute()
            logger.info(f"[Upload/Batch] ✅ 创建 {len(canvas_node_rows)} 个画布节点")
        except Exception as e:
            logger.error(f"[Upload/Batch] ⚠️ 创建画布节点失败（素材已上传）: {e}")

    return {
        "assets": created_assets,
        "failed": failed,
        "total": len(files),
        "success_count": len(created_assets),
        "fail_count": len(failed),
    }
