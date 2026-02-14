"""
Digital Avatar Templates API

路由:
  管理端 (Admin):
  - GET    /api/v2/avatars                列出形象 (支持 status/gender/style 筛选)
  - POST   /api/v2/avatars                创建形象
  - GET    /api/v2/avatars/:id            获取形象详情
  - PUT    /api/v2/avatars/:id            更新形象
  - DELETE /api/v2/avatars/:id            删除形象
  - POST   /api/v2/avatars/:id/publish    发布
  - POST   /api/v2/avatars/:id/unpublish  取消发布

  消费端 (User):
  - GET    /api/v2/avatars/gallery        用户侧画廊 (仅 published)
  - GET    /api/v2/avatars/generations/:id 查询生成进度
  - GET    /api/v2/avatars/generations     我的生成历史
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from app.services.digital_avatar_service import get_digital_avatar_service
from app.tasks.face_swap import process_face_swap
from app.tasks.avatar_reference_angles import generate_reference_angles
from app.tasks.avatar_confirm_portraits import generate_confirm_portraits
from .auth import get_current_user_id

import logging
import uuid as _uuid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/avatars", tags=["Digital Avatars"])


# ==========================================
# 请求/响应模型
# ==========================================

class CreateAvatarRequest(BaseModel):
    """创建数字人形象 (对齐 Kling 智能播报 API)"""
    name: str = Field(..., description="形象名称", min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    portrait_url: str = Field(..., description="形象照片 URL → Kling image (主图)")
    portrait_prompt: Optional[str] = Field(None, description="生成该人像的 prompt")
    reference_images: List[str] = Field(default_factory=list, description="多角度参考图 URL (含主图)，3-5 张提升一致性")
    thumbnail_url: Optional[str] = None
    demo_video_url: Optional[str] = None
    default_voice_id: str = Field("zh_female_gentle")
    default_voice_name: Optional[str] = None
    voice_sample_url: Optional[str] = None
    generation_config: Dict[str, Any] = Field(default_factory=dict, description="Kling config: broadcast_mode, image_gen_prompt, broadcast_duration")


class UpdateAvatarRequest(BaseModel):
    """更新数字人形象"""
    name: Optional[str] = None
    description: Optional[str] = None
    portrait_url: Optional[str] = None
    portrait_prompt: Optional[str] = None
    reference_images: Optional[List[str]] = None
    thumbnail_url: Optional[str] = None
    demo_video_url: Optional[str] = None
    default_voice_id: Optional[str] = None
    default_voice_name: Optional[str] = None
    voice_sample_url: Optional[str] = None
    generation_config: Optional[Dict[str, Any]] = None
    trending_score: Optional[int] = None
    is_featured: Optional[bool] = None


class GenerateRequest(BaseModel):
    """使用数字人形象生成视频"""
    # 输入方式三选一
    script: Optional[str] = Field(None, description="文案 (模式1: TTS)")
    audio_url: Optional[str] = Field(None, description="音频 URL (模式2: 直接音频)")
    voice_clone_audio_url: Optional[str] = Field(None, description="声音样本 (模式3: 克隆)")
    
    # TTS 配置
    voice_id: Optional[str] = Field(None, description="音色 ID (不传则用形象默认音色)")
    
    # 可选：换脸
    face_image_url: Optional[str] = Field(None, description="用户人脸照片 URL (启用换脸)")
    
    # Kling 参数
    duration: str = Field("5", description="视频时长: 5/10")
    prompt: Optional[str] = Field(None, description="Kling prompt: 动作/表情/运镜提示词", max_length=2500)
    mode: str = Field("std", description="Kling mode: std(标准) / pro(专家)")


class ConfirmPortraitsRequest(BaseModel):
    """上传照片后 AI 生成确认肖像"""
    source_image_urls: List[str] = Field(
        ...,
        description="用户上传的照片 URL 列表（1-10 张）",
        min_length=1,
        max_length=10,
    )
    engine: str = Field(
        "doubao",
        description="生成引擎: doubao (Seedream 4.0) 或 kling (omni-image)",
        pattern="^(doubao|kling)$",
    )


# ==========================================
# 管理端路由
# ==========================================

@router.get("", summary="列出形象")
async def list_avatars(
    status: Optional[str] = Query(None, description="draft/published/archived"),
    gender: Optional[str] = Query(None),
    style: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    is_featured: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """列出数字人形象模板 (管理端: 所有状态; 用户端: 请用 /gallery)"""
    service = get_digital_avatar_service()
    return await service.list_avatars(
        status=status, gender=gender, style=style,
        search=search, is_featured=is_featured,
        limit=limit, offset=offset,
    )


@router.get("/gallery", summary="用户画廊")
async def avatar_gallery(
    gender: Optional[str] = Query(None),
    style: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """用户侧画廊 — 仅返回已发布形象"""
    service = get_digital_avatar_service()
    return await service.list_avatars(
        status="published", gender=gender, style=style,
        search=search, is_featured=None,
        limit=limit, offset=offset,
    )


@router.post("/confirm-portraits", summary="生成确认肖像")
async def confirm_portraits(
    request: ConfirmPortraitsRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    上传照片后，AI 生成 4 张白底标准化肖像供用户确认。

    支持 Doubao Seedream / Kling omni-image 双引擎（前端选择）。

    返回 task_id，前端用 GET /api/kling/ai-task/{task_id} 轮询状态。
    """
    from datetime import datetime

    task_id = str(_uuid.uuid4())
    now = datetime.utcnow().isoformat()
    engine = request.engine  # 前端传入: "doubao" 或 "kling"

    try:
        # 创建 tasks 表记录
        from app.services.supabase_client import get_supabase
        supabase = get_supabase()
        supabase.table("tasks").insert({
            "id": task_id,
            "user_id": user_id,
            "task_type": "avatar_confirm_portraits",
            "provider": engine,
            "status": "pending",
            "progress": 0,
            "status_message": "准备生成确认肖像…",
            "input_params": {
                "source_image_urls": request.source_image_urls,
                "source_count": len(request.source_image_urls),
                "engine": engine,
            },
            "created_at": now,
        }).execute()

        # 派发 Celery 任务
        generate_confirm_portraits.delay(
            task_id=task_id,
            source_image_urls=request.source_image_urls,
            user_id=user_id,
            engine=engine,
        )

        logger.info(
            f"[DigitalAvatar] 确认肖像任务已创建: {task_id}, "
            f"源图 {len(request.source_image_urls)} 张"
        )
        return {
            "success": True,
            "task_id": task_id,
            "status": "pending",
        }

    except Exception as e:
        logger.error(f"[DigitalAvatar] 创建确认肖像任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", summary="创建形象")
async def create_avatar(
    request: CreateAvatarRequest,
    user_id: str = Depends(get_current_user_id),
):
    """创建数字人形象模板"""
    service = get_digital_avatar_service()
    avatar = await service.create_avatar(request.model_dump(), user_id)
    logger.info(f"[DigitalAvatar] 形象已创建: {avatar['id']} by {user_id}")

    # 后台自动生成多角度参考图（用户无感知）
    try:
        generate_reference_angles.delay(
            avatar_id=avatar["id"],
            portrait_url=avatar["portrait_url"],
            user_id=user_id,
        )
        logger.info(f"[DigitalAvatar] 已派发多角度参考图任务: avatar={avatar['id']}")
    except Exception as e:
        # 非关键路径，失败不影响创建结果
        logger.warning(f"[DigitalAvatar] 派发多角度任务失败（不影响创建）: {e}")

    return {"success": True, "avatar": avatar}


@router.get("/generations", summary="我的生成历史")
async def my_generations(
    user_id: str = Depends(get_current_user_id),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """获取当前用户的数字人视频生成历史"""
    service = get_digital_avatar_service()
    return await service.list_user_generations(user_id, limit=limit, offset=offset)


@router.get("/generations/{gen_id}", summary="查询生成进度")
async def get_generation(gen_id: str):
    """查询单次生成任务的状态和进度"""
    service = get_digital_avatar_service()
    gen = await service.get_generation(gen_id)
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    return gen


@router.get("/{avatar_id}", summary="获取形象详情")
async def get_avatar(avatar_id: str):
    """获取单个形象详情"""
    service = get_digital_avatar_service()
    avatar = await service.get_by_id(avatar_id)
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")
    return avatar


@router.put("/{avatar_id}", summary="更新形象")
async def update_avatar(
    avatar_id: str,
    request: UpdateAvatarRequest,
    user_id: str = Depends(get_current_user_id),
):
    """更新形象信息"""
    service = get_digital_avatar_service()
    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    avatar = await service.update_avatar(avatar_id, updates)
    return {"success": True, "avatar": avatar}


@router.delete("/{avatar_id}", summary="删除形象")
async def delete_avatar(
    avatar_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """删除形象"""
    service = get_digital_avatar_service()
    await service.delete_avatar(avatar_id)
    return {"success": True}


@router.post("/{avatar_id}/publish", summary="发布形象")
async def publish_avatar(
    avatar_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """发布形象 (draft → published)"""
    service = get_digital_avatar_service()
    avatar = await service.publish_avatar(avatar_id)
    return {"success": True, "avatar": avatar}


@router.post("/{avatar_id}/unpublish", summary="取消发布")
async def unpublish_avatar(
    avatar_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """取消发布 (published → draft)"""
    service = get_digital_avatar_service()
    avatar = await service.unpublish_avatar(avatar_id)
    return {"success": True, "avatar": avatar}
