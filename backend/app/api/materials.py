"""
HoppingRabbit AI - 用户素材库 API
支持数字人形象、声音样本等用户素材的管理
创建时间: 2026-01-30
"""
import logging
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from uuid import uuid4
import httpx

logger = logging.getLogger(__name__)

from ..services.supabase_client import supabase, get_file_url, create_signed_upload_url, get_file_urls_batch
from .auth import get_current_user_id

router = APIRouter(prefix="/materials", tags=["User Materials"])

# ============================================
# Pydantic 模型
# ============================================

class MaterialUploadRequest(BaseModel):
    """素材上传请求"""
    file_name: str = Field(..., description="文件名")
    content_type: str = Field(..., description="MIME类型")
    file_size: int = Field(..., description="文件大小（字节）")
    material_type: Literal["avatar", "voice_sample", "general"] = Field(..., description="素材类型")
    display_name: Optional[str] = Field(None, description="显示名称")
    tags: Optional[List[str]] = Field(default_factory=list, description="标签")
    material_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="素材元数据")

class MaterialUploadResponse(BaseModel):
    """素材上传响应"""
    asset_id: str
    upload_url: str
    storage_path: str

class MaterialConfirmRequest(BaseModel):
    """确认上传完成"""
    asset_id: str
    storage_path: str
    duration: Optional[float] = None  # 音频时长（秒）
    width: Optional[int] = None
    height: Optional[int] = None

class MaterialUpdateRequest(BaseModel):
    """更新素材信息"""
    display_name: Optional[str] = None
    tags: Optional[List[str]] = None
    is_favorite: Optional[bool] = None
    material_metadata: Optional[Dict[str, Any]] = None

class VoiceCloneRequest(BaseModel):
    """声音克隆请求"""
    asset_id: str = Field(..., description="声音样本素材ID")
    voice_name: str = Field(..., description="克隆后的声音名称")
    language: str = Field(default="zh", description="语言")

class VoiceCloneResponse(BaseModel):
    """声音克隆响应"""
    clone_id: str
    name: str
    fish_audio_reference_id: str
    status: str

class SetDefaultMaterialRequest(BaseModel):
    """设置默认素材请求"""
    material_type: Literal["avatar", "voice"] = Field(..., description="素材类型")
    asset_id: Optional[str] = Field(None, description="素材ID，为空则清除默认设置")
    voice_type: Optional[Literal["preset", "cloned"]] = Field(None, description="声音类型")


class ImportFromUrlRequest(BaseModel):
    """从 URL 导入素材请求"""
    source_url: str = Field(..., description="源文件 URL")
    display_name: Optional[str] = Field(None, description="显示名称")
    material_type: Literal["avatar", "voice_sample", "general"] = Field(default="general", description="素材类型")
    tags: Optional[List[str]] = Field(default_factory=list, description="标签")
    source_task_id: Optional[str] = Field(None, description="来源任务 ID")


# ============================================
# 用户素材列表
# ============================================

@router.get("")
async def list_user_materials(
    material_type: Optional[str] = None,
    file_type: Optional[str] = None,
    is_favorite: Optional[bool] = None,
    tags: Optional[str] = None,  # 逗号分隔的标签
    limit: int = 50,
    offset: int = 0,
    user_id: str = Depends(get_current_user_id)
):
    """
    获取用户素材库列表
    
    - material_type: avatar/voice_sample/general
    - file_type: video/audio/image
    - is_favorite: true/false
    - tags: 逗号分隔的标签过滤
    """
    try:
        query = supabase.table("assets").select("*") \
            .eq("user_id", user_id) \
            .eq("asset_category", "user_material") \
            .order("created_at", desc=True)
        
        if material_type:
            query = query.eq("material_type", material_type)
        if file_type:
            query = query.eq("file_type", file_type)
        if is_favorite is not None:
            query = query.eq("is_favorite", is_favorite)
        if tags:
            tag_list = [t.strip() for t in tags.split(",")]
            query = query.contains("tags", tag_list)
        
        result = query.range(offset, offset + limit - 1).execute()
        
        if not result.data:
            return {"items": [], "total": 0}
        
        # 批量生成签名 URL
        storage_paths = [a["storage_path"] for a in result.data if a.get("storage_path")]
        thumbnail_paths = [a["thumbnail_path"] for a in result.data if a.get("thumbnail_path")]
        all_paths = list(set(storage_paths + thumbnail_paths))
        url_map = get_file_urls_batch("clips", all_paths) if all_paths else {}
        
        items = []
        for asset in result.data:
            item = {**asset}
            if asset.get("storage_path"):
                item["url"] = url_map.get(asset["storage_path"], "")
            if asset.get("thumbnail_path"):
                item["thumbnail_url"] = url_map.get(asset["thumbnail_path"], "")
            # 使用 display_name 或回退到 original_filename
            item["name"] = asset.get("display_name") or asset.get("original_filename") or asset.get("name")
            items.append(item)
        
        # 获取总数
        count_query = supabase.table("assets").select("id", count="exact") \
            .eq("user_id", user_id) \
            .eq("asset_category", "user_material")
        if material_type:
            count_query = count_query.eq("material_type", material_type)
        count_result = count_query.execute()
        total = count_result.count if hasattr(count_result, 'count') else len(items)
        
        return {"items": items, "total": total}
    except Exception as e:
        logger.error(f"获取素材列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 获取数字人形象列表（快捷方法）
# ============================================

@router.get("/avatars")
async def list_avatars(
    limit: int = 20,
    user_id: str = Depends(get_current_user_id)
):
    """获取用户的数字人形象列表"""
    try:
        # 检查是否支持新字段（兼容未迁移的数据库）
        try:
            query = supabase.table("assets").select("*") \
                .eq("user_id", user_id) \
                .eq("asset_category", "user_material") \
                .eq("material_type", "avatar") \
                .eq("file_type", "image") \
                .order("created_at", desc=True) \
                .limit(limit)
            result = query.execute()
        except Exception as db_err:
            # 如果字段不存在，返回空列表
            if "does not exist" in str(db_err):
                logger.warning(f"数据库未迁移，返回空列表: {db_err}")
                return {"items": []}
            raise
        
        if not result.data:
            return {"items": []}
        
        # 生成 URL
        storage_paths = [a["storage_path"] for a in result.data if a.get("storage_path")]
        url_map = get_file_urls_batch("clips", storage_paths) if storage_paths else {}
        
        items = []
        for asset in result.data:
            items.append({
                "id": asset["id"],
                "name": asset.get("display_name") or asset.get("original_filename"),
                "url": url_map.get(asset.get("storage_path", ""), ""),
                "is_favorite": asset.get("is_favorite", False),
                "usage_count": asset.get("usage_count", 0),
                "metadata": asset.get("material_metadata", {}),
                "created_at": asset["created_at"]
            })
        
        return {"items": items}
    except Exception as e:
        logger.error(f"获取数字人形象列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 获取声音样本列表（快捷方法）
# ============================================

@router.get("/voice-samples")
async def list_voice_samples(
    include_clones: bool = True,
    limit: int = 20,
    user_id: str = Depends(get_current_user_id)
):
    """获取用户的声音样本列表，包含已克隆的声音"""
    try:
        items = []
        
        # 获取原始声音样本（兼容未迁移的数据库）
        try:
            samples_query = supabase.table("assets").select("*") \
                .eq("user_id", user_id) \
                .eq("asset_category", "user_material") \
                .eq("material_type", "voice_sample") \
                .order("created_at", desc=True) \
                .limit(limit)
            
            samples_result = samples_query.execute()
            
            # 处理原始样本
            if samples_result.data:
                storage_paths = [a["storage_path"] for a in samples_result.data if a.get("storage_path")]
                url_map = get_file_urls_batch("clips", storage_paths) if storage_paths else {}
                
                for asset in samples_result.data:
                    items.append({
                        "id": asset["id"],
                        "type": "sample",
                        "name": asset.get("display_name") or asset.get("original_filename"),
                        "url": url_map.get(asset.get("storage_path", ""), ""),
                        "duration": asset.get("duration"),
                        "is_cloned": bool(asset.get("material_metadata", {}).get("fish_audio_reference_id")),
                        "metadata": asset.get("material_metadata", {}),
                        "created_at": asset["created_at"]
                    })
        except Exception as db_err:
            if "does not exist" in str(db_err):
                logger.warning(f"数据库未迁移，跳过素材查询: {db_err}")
            else:
                raise
        
        # 获取已克隆的声音（如果表存在）
        if include_clones:
            try:
                clones_query = supabase.table("voice_clones").select("*") \
                    .eq("user_id", user_id) \
                    .eq("status", "active") \
                    .order("created_at", desc=True) \
                    .limit(limit)
                clones_result = clones_query.execute()
                
                if clones_result.data:
                    for clone in clones_result.data:
                        items.append({
                            "id": clone["id"],
                            "type": "clone",
                            "name": clone["name"],
                            "fish_audio_reference_id": clone["fish_audio_reference_id"],
                            "language": clone.get("language", "zh"),
                            "gender": clone.get("gender"),
                            "preview_url": clone.get("preview_audio_url"),
                            "usage_count": clone.get("usage_count", 0),
                            "created_at": clone["created_at"]
                        })
            except Exception as e:
                # voice_clones 表可能不存在，这是预期的
                if "Could not find" in str(e) or "does not exist" in str(e):
                    logger.debug(f"voice_clones 表不存在（正常情况）: {e}")
                else:
                    logger.warning(f"voice_clones 表查询失败: {e}")
        
        return {"items": items}
    except Exception as e:
        logger.error(f"获取声音样本列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 素材上传
# ============================================

@router.post("/presign-upload")
async def presign_material_upload(
    request: MaterialUploadRequest,
    user_id: str = Depends(get_current_user_id)
):
    """获取用户素材上传的预签名 URL"""
    try:
        asset_id = str(uuid4())
        file_ext = request.file_name.split(".")[-1] if "." in request.file_name else ""
        
        # 存储路径: materials/{user_id}/{material_type}/{asset_id}.{ext}
        storage_path = f"materials/{user_id}/{request.material_type}/{asset_id}.{file_ext}"
        
        presign_result = create_signed_upload_url("clips", storage_path, upsert=True)
        
        return MaterialUploadResponse(
            asset_id=asset_id,
            upload_url=presign_result.get("signedURL") or presign_result.get("signed_url", ""),
            storage_path=storage_path
        )
    except Exception as e:
        logger.error(f"生成预签名URL失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/confirm-upload")
async def confirm_material_upload(
    request: MaterialConfirmRequest,
    material_type: str,
    file_name: str,
    content_type: str,
    file_size: int,
    display_name: Optional[str] = None,
    tags: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    """确认素材上传完成，创建数据库记录"""
    try:
        now = datetime.utcnow().isoformat()
        
        # 确定 file_type
        file_type = "image"
        if content_type.startswith("video/"):
            file_type = "video"
        elif content_type.startswith("audio/"):
            file_type = "audio"
        
        # 解析 tags
        tag_list = [t.strip() for t in tags.split(",")] if tags else []
        
        asset_data = {
            "id": request.asset_id,
            "project_id": None,  # 用户素材不关联项目
            "user_id": user_id,
            "name": display_name or file_name,
            "original_filename": file_name,
            "display_name": display_name,
            "file_type": file_type,
            "mime_type": content_type,
            "file_size": file_size,
            "storage_path": request.storage_path,
            "duration": request.duration,
            "width": request.width,
            "height": request.height,
            "asset_category": "user_material",
            "material_type": material_type,
            "tags": tag_list,
            "status": "ready",
            "created_at": now,
            "updated_at": now
        }
        
        result = supabase.table("assets").insert(asset_data).execute()
        
        # 返回带 URL 的数据
        response_data = result.data[0]
        response_data["url"] = get_file_url("clips", request.storage_path)
        
        return response_data
    except Exception as e:
        logger.error(f"确认素材上传失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 素材管理操作
# ============================================

@router.patch("/{asset_id}")
async def update_material(
    asset_id: str,
    request: MaterialUpdateRequest,
    user_id: str = Depends(get_current_user_id)
):
    """更新素材信息"""
    try:
        # 检查素材是否存在且属于当前用户
        check = supabase.table("assets").select("id") \
            .eq("id", asset_id) \
            .eq("user_id", user_id) \
            .eq("asset_category", "user_material") \
            .single().execute()
        
        if not check.data:
            raise HTTPException(status_code=404, detail="素材不存在")
        
        update_data = {"updated_at": datetime.utcnow().isoformat()}
        
        if request.display_name is not None:
            update_data["display_name"] = request.display_name
            update_data["name"] = request.display_name
        if request.tags is not None:
            update_data["tags"] = request.tags
        if request.is_favorite is not None:
            update_data["is_favorite"] = request.is_favorite
        if request.material_metadata is not None:
            update_data["material_metadata"] = request.material_metadata
        
        result = supabase.table("assets").update(update_data).eq("id", asset_id).execute()
        
        return result.data[0] if result.data else {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新素材失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{asset_id}")
async def delete_material(
    asset_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除用户素材"""
    try:
        # 检查素材是否存在
        asset = supabase.table("assets").select("storage_path, thumbnail_path") \
            .eq("id", asset_id) \
            .eq("user_id", user_id) \
            .eq("asset_category", "user_material") \
            .single().execute()
        
        if not asset.data:
            raise HTTPException(status_code=404, detail="素材不存在")
        
        # 删除存储文件
        storage_path = asset.data.get("storage_path")
        if storage_path:
            try:
                paths_to_delete = [storage_path]
                if asset.data.get("thumbnail_path"):
                    paths_to_delete.append(asset.data["thumbnail_path"])
                supabase.storage.from_("clips").remove(paths_to_delete)
            except Exception as e:
                logger.warning(f"删除存储文件失败: {e}")
        
        # 删除数据库记录
        supabase.table("assets").delete().eq("id", asset_id).execute()
        
        return {"success": True, "message": "素材已删除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除素材失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{asset_id}/use")
async def record_material_usage(
    asset_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """记录素材使用（更新使用次数和时间）"""
    try:
        # 获取当前使用次数
        asset = supabase.table("assets").select("usage_count") \
            .eq("id", asset_id) \
            .eq("user_id", user_id) \
            .single().execute()
        
        if not asset.data:
            raise HTTPException(status_code=404, detail="素材不存在")
        
        current_count = asset.data.get("usage_count", 0) or 0
        
        supabase.table("assets").update({
            "usage_count": current_count + 1,
            "last_used_at": datetime.utcnow().isoformat()
        }).eq("id", asset_id).execute()
        
        return {"success": True, "usage_count": current_count + 1}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"记录素材使用失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 声音克隆
# ============================================

@router.post("/voice-clone")
async def create_voice_clone(
    request: VoiceCloneRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    克隆用户的声音样本
    使用 Fish Audio API 创建声音模型
    """
    try:
        # 获取声音样本素材
        asset = supabase.table("assets").select("*") \
            .eq("id", request.asset_id) \
            .eq("user_id", user_id) \
            .eq("material_type", "voice_sample") \
            .single().execute()
        
        if not asset.data:
            raise HTTPException(status_code=404, detail="声音样本不存在")
        
        # 检查是否已克隆
        metadata = asset.data.get("material_metadata", {})
        if metadata.get("fish_audio_reference_id"):
            return VoiceCloneResponse(
                clone_id=asset.data["id"],
                name=request.voice_name,
                fish_audio_reference_id=metadata["fish_audio_reference_id"],
                status="exists"
            )
        
        # 获取音频文件 URL
        audio_url = get_file_url("clips", asset.data["storage_path"])
        
        # 调用 Fish Audio 克隆接口
        from ..services.tts_service import TTSService
        tts_service = TTSService()
        
        reference_id = await tts_service.clone_voice(
            audio_url=audio_url,
            voice_name=request.voice_name
        )
        
        if not reference_id:
            raise HTTPException(status_code=500, detail="声音克隆失败")
        
        # 更新素材元数据
        updated_metadata = {
            **metadata,
            "fish_audio_reference_id": reference_id,
            "voice_name": request.voice_name,
            "language": request.language,
            "cloned_at": datetime.utcnow().isoformat()
        }
        
        supabase.table("assets").update({
            "material_metadata": updated_metadata,
            "display_name": request.voice_name,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", request.asset_id).execute()
        
        # 创建 voice_clones 记录（如果表存在）
        try:
            clone_id = str(uuid4())
            supabase.table("voice_clones").insert({
                "id": clone_id,
                "user_id": user_id,
                "source_asset_id": request.asset_id,
                "name": request.voice_name,
                "fish_audio_reference_id": reference_id,
                "language": request.language,
                "status": "active",
                "created_at": datetime.utcnow().isoformat()
            }).execute()
        except Exception as e:
            logger.warning(f"voice_clones 表插入失败: {e}")
            clone_id = request.asset_id
        
        return VoiceCloneResponse(
            clone_id=clone_id,
            name=request.voice_name,
            fish_audio_reference_id=reference_id,
            status="created"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"声音克隆失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 用户偏好设置
# ============================================

@router.get("/preferences")
async def get_material_preferences(
    user_id: str = Depends(get_current_user_id)
):
    """获取用户素材偏好设置"""
    try:
        result = supabase.table("user_material_preferences").select("*") \
            .eq("user_id", user_id) \
            .execute()
        
        if not result.data or len(result.data) == 0:
            # 返回默认设置
            return {
                "default_avatar_id": None,
                "default_voice_type": "preset",
                "default_voice_id": None,
                "default_broadcast_settings": {
                    "aspect_ratio": "16:9",
                    "model": "kling-v2-master",
                    "lip_sync_mode": "audio2video"
                }
            }
        
        return result.data[0]
    except Exception as e:
        logger.error(f"获取用户偏好失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/preferences/default")
async def set_default_material(
    request: SetDefaultMaterialRequest,
    user_id: str = Depends(get_current_user_id)
):
    """设置默认素材（默认数字人形象或默认声音）"""
    try:
        now = datetime.utcnow().isoformat()
        
        # 检查是否已有偏好记录
        existing = supabase.table("user_material_preferences").select("id") \
            .eq("user_id", user_id) \
            .execute()
        
        update_data = {"updated_at": now}
        
        if request.material_type == "avatar":
            update_data["default_avatar_id"] = request.asset_id
        else:  # voice
            update_data["default_voice_type"] = request.voice_type or "preset"
            update_data["default_voice_id"] = request.asset_id
        
        if existing.data and len(existing.data) > 0:
            result = supabase.table("user_material_preferences").update(update_data) \
                .eq("user_id", user_id).execute()
        else:
            result = supabase.table("user_material_preferences").insert({
                "user_id": user_id,
                **update_data,
                "created_at": now
            }).execute()
        
        return {"success": True, "data": result.data[0] if result.data else update_data}
    except Exception as e:
        logger.error(f"设置默认素材失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 从 URL 导入素材
# ============================================

@router.post("/import-from-url")
async def import_material_from_url(
    request: ImportFromUrlRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    从 URL 导入素材到用户素材库
    适用于将 AI 生成的结果保存到素材库
    """
    try:
        source_url = request.source_url
        
        # 从 URL 推断文件信息
        # 解析 URL 获取文件名
        from urllib.parse import urlparse, unquote
        parsed = urlparse(source_url)
        path_parts = parsed.path.split('/')
        original_filename = unquote(path_parts[-1]) if path_parts else "imported_file"
        
        # 去掉查询参数
        if '?' in original_filename:
            original_filename = original_filename.split('?')[0]
        
        # 推断文件类型
        file_ext = original_filename.split('.')[-1].lower() if '.' in original_filename else 'mp4'
        
        # 确定 MIME 类型和文件类型
        mime_map = {
            'mp4': ('video/mp4', 'video'),
            'webm': ('video/webm', 'video'),
            'mov': ('video/quicktime', 'video'),
            'png': ('image/png', 'image'),
            'jpg': ('image/jpeg', 'image'),
            'jpeg': ('image/jpeg', 'image'),
            'gif': ('image/gif', 'image'),
            'webp': ('image/webp', 'image'),
            'mp3': ('audio/mpeg', 'audio'),
            'wav': ('audio/wav', 'audio'),
            'm4a': ('audio/m4a', 'audio'),
        }
        
        mime_type, file_type = mime_map.get(file_ext, ('application/octet-stream', 'video'))
        
        asset_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 存储路径
        storage_path = f"materials/{user_id}/{request.material_type}/{asset_id}.{file_ext}"
        
        # 下载源文件
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(source_url)
            if response.status_code != 200:
                raise HTTPException(
                    status_code=400, 
                    detail=f"无法下载源文件: HTTP {response.status_code}"
                )
            file_content = response.content
            file_size = len(file_content)
        
        # 上传到存储
        upload_result = supabase.storage.from_("clips").upload(
            storage_path,
            file_content,
            {"content-type": mime_type, "upsert": "true"}
        )
        
        if hasattr(upload_result, 'error') and upload_result.error:
            raise HTTPException(status_code=500, detail=f"上传失败: {upload_result.error}")
        
        # 准备元数据
        material_metadata = {
            "source_url": source_url,
            "imported_at": now,
        }
        if request.source_task_id:
            material_metadata["source_task_id"] = request.source_task_id
        
        # 创建素材记录
        display_name = request.display_name or original_filename
        
        asset_data = {
            "id": asset_id,
            "project_id": None,
            "user_id": user_id,
            "name": display_name,
            "original_filename": original_filename,
            "display_name": display_name,
            "file_type": file_type,
            "mime_type": mime_type,
            "file_size": file_size,
            "storage_path": storage_path,
            "asset_category": "user_material",
            "material_type": request.material_type,
            "tags": request.tags or [],
            "material_metadata": material_metadata,
            "status": "ready",
            "created_at": now,
            "updated_at": now
        }
        
        result = supabase.table("assets").insert(asset_data).execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="创建素材记录失败")
        
        # 返回带 URL 的数据
        response_data = result.data[0]
        response_data["url"] = get_file_url("clips", storage_path)
        
        logger.info(f"素材导入成功: {asset_id}, 来源: {source_url[:50]}...")
        
        return {
            "success": True,
            "asset": response_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"从 URL 导入素材失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
