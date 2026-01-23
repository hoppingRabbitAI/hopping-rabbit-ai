"""
HoppingRabbit AI - 可灵AI API 路由
口播场景专用接口

功能列表:
1. 口型同步 (Lip Sync) - 对口型核心功能
2. 文生视频 (Text-to-Video) - 生成背景/B-roll
3. 图生视频 (Image-to-Video) - 产品图动态化
4. 多图生视频 (Multi-Image-to-Video) - 多图场景转换
5. 动作控制 (Motion Control) - 动作迁移
6. 多模态视频编辑 (Multi-Elements) - 视频元素编辑
7. 视频延长 (Video Extend) - 延长视频时长
8. 图像生成 (Image Generation) - 文生图/图生图
9. Omni-Image (O1) - 高级多模态图像生成
10. AI换脸 (Face Swap) - 数字人换脸
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import uuid
import logging
from datetime import datetime

from ..services.kling_ai_service import kling_client, koubo_service

# 导入所有 Celery 任务
from ..tasks.lip_sync import process_lip_sync
from ..tasks.text_to_video import process_text_to_video
from ..tasks.image_to_video import process_image_to_video
from ..tasks.multi_image_to_video import process_multi_image_to_video
from ..tasks.motion_control import process_motion_control
from ..tasks.multi_elements import process_multi_elements
from ..tasks.video_extend import process_video_extend
from ..tasks.image_generation import process_image_generation
from ..tasks.omni_image import process_omni_image
from ..tasks.face_swap import process_face_swap

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/kling", tags=["可灵AI"])


# ============================================
# Supabase 工具函数
# ============================================

def _get_supabase():
    """延迟导入 supabase 客户端"""
    from ..services.supabase_client import supabase
    return supabase


def _get_current_user_id(authorization: str = None) -> str:
    """获取当前用户 ID - TODO: 集成真实认证"""
    return "00000000-0000-0000-0000-000000000001"


def _create_ai_task(
    user_id: str,
    task_type: str,
    input_params: Dict
) -> str:
    """创建 AI 任务记录"""
    ai_task_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    task_data = {
        "id": ai_task_id,
        "user_id": user_id,
        "task_type": task_type,
        "source": "rabbit_hole",
        "provider": "kling",
        "status": "pending",
        "progress": 0,
        "status_message": "任务已创建，等待处理",
        "input_params": input_params,
        "created_at": now,
    }
    
    _get_supabase().table("ai_tasks").insert(task_data).execute()
    return ai_task_id


# ============================================
# 请求模型 - 视频生成
# ============================================

class LipSyncRequest(BaseModel):
    """口型同步请求"""
    video_url: str = Field(..., description="原始视频 URL（包含人脸）")
    audio_url: str = Field(..., description="目标音频 URL")
    face_index: int = Field(0, description="多人脸时选择第几张脸")
    sound_volume: float = Field(1.0, ge=0, le=2, description="音频音量")
    original_audio_volume: float = Field(1.0, ge=0, le=2, description="原视频音量")


class TextToVideoRequest(BaseModel):
    """文生视频请求"""
    prompt: str = Field(..., description="正向提示词", min_length=1, max_length=2500)
    negative_prompt: str = Field("", description="负向提示词", max_length=2500)
    model_name: str = Field("kling-v1", description="模型: kling-v1/kling-v1-5/kling-v1-6")
    duration: str = Field("5", description="视频时长: 5/10")
    aspect_ratio: str = Field("16:9", description="宽高比: 16:9/9:16/1:1")
    cfg_scale: float = Field(0.5, ge=0, le=1, description="提示词相关性")


class ImageToVideoRequest(BaseModel):
    """图生视频请求"""
    image: str = Field(..., description="源图片 URL 或 Base64")
    prompt: str = Field("", description="运动描述提示词", max_length=2500)
    negative_prompt: str = Field("", description="负向提示词")
    model_name: str = Field("kling-v1", description="模型版本")
    duration: str = Field("5", description="视频时长: 5/10")
    cfg_scale: float = Field(0.5, ge=0, le=1, description="提示词相关性")


class MultiImageToVideoRequest(BaseModel):
    """多图生视频请求"""
    images: List[str] = Field(..., description="图片列表(2-4张)", min_length=2, max_length=4)
    prompt: str = Field("", description="运动描述提示词", max_length=2500)
    negative_prompt: str = Field("", description="负向提示词")
    model_name: str = Field("kling-v1-5", description="模型版本(仅v1.5+)")
    duration: str = Field("5", description="视频时长: 5/10")


class MotionControlRequest(BaseModel):
    """动作控制请求"""
    image: str = Field(..., description="待驱动图片 URL 或 Base64")
    video_url: str = Field(..., description="动作参考视频 URL")
    prompt: str = Field("", description="辅助描述", max_length=2500)
    mode: str = Field("pro", description="模式: pro")
    duration: str = Field("5", description="视频时长: 5/10")


class MultiElementsRequest(BaseModel):
    """多模态视频编辑请求"""
    video_id: str = Field(None, description="可灵生成的视频 ID")
    video_url: str = Field(None, description="外部视频 URL (与 video_id 二选一)")
    operation: str = Field(..., description="操作: init/add/delete/clear/preview/generate")
    # 添加元素时的参数
    element_type: str = Field(None, description="元素类型: video/image/text")
    element_content: str = Field(None, description="元素内容(URL或文本)")
    element_position: Dict = Field(None, description="位置参数")


class VideoExtendRequest(BaseModel):
    """视频延长请求"""
    video_id: str = Field(..., description="可灵生成的视频 ID")
    prompt: str = Field("", description="延长内容描述", max_length=2500)
    negative_prompt: str = Field("", description="负向提示词")
    extend_direction: str = Field("end", description="延长方向: end(向后)/start(向前)")
    cfg_scale: float = Field(0.5, ge=0, le=1, description="提示词相关性")


# ============================================
# 请求模型 - 图像生成
# ============================================

class ImageGenerationRequest(BaseModel):
    """图像生成请求"""
    prompt: str = Field(..., description="正向提示词", min_length=1, max_length=2500)
    negative_prompt: str = Field("", description="负向提示词", max_length=2500)
    image: str = Field(None, description="参考图像(图生图模式)")
    image_reference: str = Field(None, description="参考类型: subject/face")
    model_name: str = Field("kling-v1", description="模型: kling-v1/v1-5/v2/v2-new/v2-1")
    resolution: str = Field("1k", description="清晰度: 1k/2k")
    n: int = Field(1, ge=1, le=9, description="生成数量")
    aspect_ratio: str = Field("16:9", description="画面比例")
    image_fidelity: float = Field(0.5, ge=0, le=1, description="图片参考强度")
    human_fidelity: float = Field(0.45, ge=0, le=1, description="面部参考强度")


class OmniImageRequest(BaseModel):
    """Omni-Image 请求"""
    prompt: str = Field(..., description="提示词(用<<<image_N>>>引用图片)", max_length=2500)
    image_list: List[Dict[str, str]] = Field(None, description="参考图列表")
    element_list: List[Dict[str, int]] = Field(None, description="主体参考列表")
    model_name: str = Field("kling-image-o1", description="模型名称")
    resolution: str = Field("1k", description="清晰度: 1k/2k")
    n: int = Field(1, ge=1, le=9, description="生成数量")
    aspect_ratio: str = Field("auto", description="画面比例(支持auto)")


class FaceSwapRequest(BaseModel):
    """AI换脸请求"""
    video_url: str = Field(..., description="原始视频 URL")
    face_image_url: str = Field(..., description="目标人脸图片 URL")
    face_index: int = Field(0, description="视频中选择第几张脸")


# ============================================
# 口播场景封装请求
# ============================================

class DigitalHumanRequest(BaseModel):
    """数字人口播请求"""
    audio_url: str = Field(..., description="口播音频 URL")
    avatar_video_url: str = Field(..., description="数字人基础视频 URL")
    background_prompt: Optional[str] = Field(None, description="背景生成提示词")


class BatchAvatarRequest(BaseModel):
    """批量换脸请求"""
    source_video_url: str = Field(..., description="源口播视频")
    face_images: List[str] = Field(..., description="目标人脸图片列表", min_length=1)


class ProductShowcaseRequest(BaseModel):
    """产品展示请求"""
    product_images: List[str] = Field(..., description="产品图片 URL 列表", min_length=1)
    voiceover_url: Optional[str] = Field(None, description="配音音频 URL")


# ============================================
# 口型同步 API (核心功能)
# ============================================

@router.post("/lip-sync", summary="口型同步", tags=["视频生成"])
async def create_lip_sync(request: LipSyncRequest):
    """
    创建口型同步任务
    
    流程: 人脸识别 → 创建对口型任务 → 轮询状态 → 下载上传
    """
    user_id = _get_current_user_id()
    
    try:
        ai_task_id = _create_ai_task(user_id, "lip_sync", request.model_dump())
        
        process_lip_sync.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            video_url=request.video_url,
            audio_url=request.audio_url,
            options={
                "face_index": request.face_index,
                "sound_volume": request.sound_volume,
                "original_audio_volume": request.original_audio_volume,
            }
        )
        
        logger.info(f"[KlingAPI] 口型同步任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建口型同步任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/text-to-video", summary="文生视频", tags=["视频生成"])
async def create_text_to_video(request: TextToVideoRequest):
    """创建文生视频任务"""
    user_id = _get_current_user_id()
    
    try:
        ai_task_id = _create_ai_task(user_id, "text_to_video", request.model_dump())
        
        process_text_to_video.delay(
            task_id=ai_task_id,
            user_id=user_id,
            prompt=request.prompt,
            options={
                "negative_prompt": request.negative_prompt,
                "model_name": request.model_name,
                "duration": request.duration,
                "aspect_ratio": request.aspect_ratio,
                "cfg_scale": request.cfg_scale,
            }
        )
        
        logger.info(f"[KlingAPI] 文生视频任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建文生视频任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/image-to-video", summary="图生视频", tags=["视频生成"])
async def create_image_to_video(request: ImageToVideoRequest):
    """创建图生视频任务"""
    user_id = _get_current_user_id()
    
    try:
        ai_task_id = _create_ai_task(user_id, "image_to_video", request.model_dump())
        
        process_image_to_video.delay(
            task_id=ai_task_id,
            user_id=user_id,
            image=request.image,
            options={
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt,
                "model_name": request.model_name,
                "duration": request.duration,
                "cfg_scale": request.cfg_scale,
            }
        )
        
        logger.info(f"[KlingAPI] 图生视频任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建图生视频任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/multi-image-to-video", summary="多图生视频", tags=["视频生成"])
async def create_multi_image_to_video(request: MultiImageToVideoRequest):
    """创建多图生视频任务（2-4张图片场景转换）"""
    user_id = _get_current_user_id()
    
    try:
        ai_task_id = _create_ai_task(user_id, "multi_image_to_video", request.model_dump())
        
        process_multi_image_to_video.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            images=request.images,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            options={
                "model_name": request.model_name,
                "duration": request.duration,
            }
        )
        
        logger.info(f"[KlingAPI] 多图生视频任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建多图生视频任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/motion-control", summary="动作控制", tags=["视频生成"])
async def create_motion_control(request: MotionControlRequest):
    """创建动作控制任务（参考视频驱动图片人物）"""
    user_id = _get_current_user_id()
    
    try:
        ai_task_id = _create_ai_task(user_id, "motion_control", request.model_dump())
        
        process_motion_control.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            image=request.image,
            video_url=request.video_url,
            prompt=request.prompt,
            options={
                "mode": request.mode,
                "duration": request.duration,
            }
        )
        
        logger.info(f"[KlingAPI] 动作控制任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建动作控制任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video-extend", summary="视频延长", tags=["视频生成"])
async def create_video_extend(request: VideoExtendRequest):
    """创建视频延长任务（延长 4-5 秒）"""
    user_id = _get_current_user_id()
    
    try:
        ai_task_id = _create_ai_task(user_id, "video_extend", request.model_dump())
        
        process_video_extend.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            video_id=request.video_id,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            options={
                "extend_direction": request.extend_direction,
                "cfg_scale": request.cfg_scale,
            }
        )
        
        logger.info(f"[KlingAPI] 视频延长任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建视频延长任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 图像生成 API
# ============================================

@router.post("/image-generation", summary="图像生成", tags=["图像生成"])
async def create_image_generation(request: ImageGenerationRequest):
    """创建图像生成任务（文生图/图生图）"""
    user_id = _get_current_user_id()
    
    try:
        ai_task_id = _create_ai_task(user_id, "image_generation", request.model_dump())
        
        process_image_generation.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            image=request.image,
            image_reference=request.image_reference,
            options={
                "model_name": request.model_name,
                "resolution": request.resolution,
                "n": request.n,
                "aspect_ratio": request.aspect_ratio,
                "image_fidelity": request.image_fidelity,
                "human_fidelity": request.human_fidelity,
            }
        )
        
        logger.info(f"[KlingAPI] 图像生成任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建图像生成任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/omni-image", summary="Omni-Image", tags=["图像生成"])
async def create_omni_image(request: OmniImageRequest):
    """创建 Omni-Image 任务（高级多模态图像生成）"""
    user_id = _get_current_user_id()
    
    try:
        ai_task_id = _create_ai_task(user_id, "omni_image", request.model_dump())
        
        process_omni_image.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            prompt=request.prompt,
            image_list=request.image_list,
            element_list=request.element_list,
            options={
                "model_name": request.model_name,
                "resolution": request.resolution,
                "n": request.n,
                "aspect_ratio": request.aspect_ratio,
            }
        )
        
        logger.info(f"[KlingAPI] Omni-Image 任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建 Omni-Image 任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/face-swap", summary="AI换脸", tags=["视频生成"])
async def create_face_swap(request: FaceSwapRequest):
    """创建 AI 换脸任务"""
    user_id = _get_current_user_id()
    
    try:
        ai_task_id = _create_ai_task(user_id, "face_swap", request.model_dump())
        
        process_face_swap.delay(
            task_id=ai_task_id,
            user_id=user_id,
            video_url=request.video_url,
            face_image_url=request.face_image_url,
            options={"face_index": request.face_index}
        )
        
        logger.info(f"[KlingAPI] AI换脸任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建AI换脸任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 任务管理 API
# ============================================


# ============================================
# 任务管理 API
# ============================================

@router.get("/ai-task/{task_id}", summary="查询任务状态", tags=["任务管理"])
async def get_ai_task_status(task_id: str):
    """查询 AI 任务状态（前端轮询）"""
    try:
        supabase = _get_supabase()
        result = supabase.table("ai_tasks").select("*").eq("id", task_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="任务不存在")
        
        task = result.data
        return {
            "task_id": task["id"],
            "task_type": task["task_type"],
            "status": task["status"],
            "progress": task["progress"],
            "status_message": task.get("status_message"),
            "output_url": task.get("output_url"),
            "output_asset_id": task.get("output_asset_id"),
            "result_metadata": task.get("result_metadata"),
            "error_code": task.get("error_code"),
            "error_message": task.get("error_message"),
            "created_at": task["created_at"],
            "started_at": task.get("started_at"),
            "completed_at": task.get("completed_at"),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[KlingAPI] 查询任务状态失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ai-tasks", summary="任务列表", tags=["任务管理"])
async def list_ai_tasks(
    status: Optional[str] = Query(None, description="筛选状态: pending/processing/completed/failed"),
    task_type: Optional[str] = Query(None, description="筛选类型"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """获取用户的 AI 任务列表"""
    user_id = _get_current_user_id()
    
    try:
        supabase = _get_supabase()
        query = supabase.table("ai_tasks").select("*").eq("user_id", user_id)
        
        if status:
            query = query.eq("status", status)
        if task_type:
            query = query.eq("task_type", task_type)
        
        offset = (page - 1) * page_size
        query = query.order("created_at", desc=True).range(offset, offset + page_size - 1)
        
        result = query.execute()
        
        return {
            "tasks": result.data,
            "page": page,
            "page_size": page_size,
            "total": len(result.data),
        }
        
    except Exception as e:
        logger.error(f"[KlingAPI] 获取任务列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai-task/{task_id}/cancel", summary="取消任务", tags=["任务管理"])
async def cancel_ai_task(task_id: str):
    """取消 AI 任务"""
    try:
        supabase = _get_supabase()
        supabase.table("ai_tasks").update({
            "status": "cancelled",
            "completed_at": datetime.utcnow().isoformat(),
        }).eq("id", task_id).execute()
        
        return {"success": True, "message": "任务已取消"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 取消任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 口播场景封装接口
# ============================================

@router.post("/koubo/digital-human", summary="数字人口播", tags=["口播场景"])
async def generate_digital_human_video(request: DigitalHumanRequest):
    """数字人口播视频生成（完整工作流）"""
    task_id = str(uuid.uuid4())
    
    try:
        result = await koubo_service.generate_digital_human_video(
            audio_url=request.audio_url,
            avatar_video_url=request.avatar_video_url,
            background_prompt=request.background_prompt,
        )
        return {"success": True, "task_id": task_id, "result": result}
        
    except Exception as e:
        logger.error(f"数字人口播生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/koubo/batch-avatars", summary="批量换脸", tags=["口播场景"])
async def batch_generate_avatars(request: BatchAvatarRequest):
    """批量生成不同数字人版本"""
    task_id = str(uuid.uuid4())
    
    try:
        results = await koubo_service.batch_generate_avatars(
            source_video_url=request.source_video_url,
            face_images=request.face_images,
        )
        return {"success": True, "task_id": task_id, "results": results, "count": len(results)}
        
    except Exception as e:
        logger.error(f"批量生成数字人失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/koubo/product-showcase", summary="产品展示", tags=["口播场景"])
async def generate_product_showcase(request: ProductShowcaseRequest):
    """产品展示视频生成"""
    task_id = str(uuid.uuid4())
    
    try:
        result = await koubo_service.generate_product_showcase(
            product_images=request.product_images,
            voiceover_url=request.voiceover_url,
        )
        return {"success": True, "task_id": task_id, "result": result}
        
    except Exception as e:
        logger.error(f"产品展示生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 能力列表
# ============================================

@router.get("/capabilities", summary="能力列表", tags=["系统"])
async def get_capabilities():
    """获取可灵AI支持的完整能力列表"""
    return {
        "provider": "KlingAI",
        "version": "2.0",
        "updated_at": "2026-01-23",
        "capabilities": {
            "video_generation": [
                {
                    "id": "lip_sync",
                    "name": "口型同步",
                    "endpoint": "POST /kling/lip-sync",
                    "description": "将音频同步到视频人物的嘴型",
                    "use_cases": ["数字人口播", "AI换脸口播", "多语言配音"],
                    "input": {"video_url": "视频URL", "audio_url": "音频URL"},
                    "output": "video",
                    "estimated_time": "1-5分钟",
                    "api_endpoint": "POST /v1/videos/advanced-lip-sync",
                },
                {
                    "id": "text_to_video",
                    "name": "文生视频",
                    "endpoint": "POST /kling/text-to-video",
                    "description": "根据文字描述生成视频",
                    "use_cases": ["口播背景", "B-roll素材", "片头片尾"],
                    "input": {"prompt": "提示词"},
                    "output": "video",
                    "estimated_time": "2-10分钟",
                    "api_endpoint": "POST /v1/videos/text2video",
                    "models": ["kling-v1", "kling-v1-5", "kling-v1-6"],
                },
                {
                    "id": "image_to_video",
                    "name": "图生视频",
                    "endpoint": "POST /kling/image-to-video",
                    "description": "将静态图片转换为动态视频",
                    "use_cases": ["产品展示", "封面动态化"],
                    "input": {"image": "图片URL或Base64"},
                    "output": "video",
                    "estimated_time": "1-5分钟",
                    "api_endpoint": "POST /v1/videos/image2video",
                },
                {
                    "id": "multi_image_to_video",
                    "name": "多图生视频",
                    "endpoint": "POST /kling/multi-image-to-video",
                    "description": "2-4张图片生成场景转换视频",
                    "use_cases": ["故事板动态化", "多场景串联"],
                    "input": {"images": ["图片列表(2-4张)"]},
                    "output": "video",
                    "estimated_time": "2-8分钟",
                    "api_endpoint": "POST /v1/videos/multi-image2video",
                },
                {
                    "id": "motion_control",
                    "name": "动作控制",
                    "endpoint": "POST /kling/motion-control",
                    "description": "用参考视频的动作驱动图片人物",
                    "use_cases": ["虚拟主播", "动作模仿"],
                    "input": {"image": "待驱动图片", "video_url": "动作参考视频"},
                    "output": "video",
                    "estimated_time": "2-8分钟",
                    "api_endpoint": "POST /v1/videos/motion-control",
                },
                {
                    "id": "video_extend",
                    "name": "视频延长",
                    "endpoint": "POST /kling/video-extend",
                    "description": "延长视频时长4-5秒",
                    "use_cases": ["素材延长", "转场过渡"],
                    "input": {"video_id": "可灵视频ID"},
                    "output": "video",
                    "estimated_time": "1-3分钟",
                    "api_endpoint": "POST /v1/videos/video-extend",
                },
                {
                    "id": "face_swap",
                    "name": "AI换脸",
                    "endpoint": "POST /kling/face-swap",
                    "description": "将视频中的人脸替换为指定人脸",
                    "use_cases": ["数字人替换", "隐私保护", "A/B测试"],
                    "input": {"video_url": "视频URL", "face_image_url": "人脸图片"},
                    "output": "video",
                    "estimated_time": "2-8分钟",
                    "api_endpoint": "待定",
                },
            ],
            "image_generation": [
                {
                    "id": "image_generation",
                    "name": "图像生成",
                    "endpoint": "POST /kling/image-generation",
                    "description": "文生图/图生图",
                    "use_cases": ["生成封面", "生成背景", "风格转换"],
                    "input": {"prompt": "提示词", "image": "(可选)参考图"},
                    "output": "image",
                    "estimated_time": "30秒-2分钟",
                    "api_endpoint": "POST /v1/images/generations",
                    "models": ["kling-v1", "kling-v1-5", "kling-v2", "kling-v2-new", "kling-v2-1"],
                },
                {
                    "id": "omni_image",
                    "name": "Omni-Image (O1)",
                    "endpoint": "POST /kling/omni-image",
                    "description": "高级多模态图像生成",
                    "use_cases": ["图像编辑", "风格迁移", "主体融合", "场景合成"],
                    "input": {"prompt": "提示词(用<<<image_N>>>引用图片)", "image_list": "参考图列表"},
                    "output": "image",
                    "estimated_time": "30秒-2分钟",
                    "api_endpoint": "POST /v1/images/omni-image",
                    "models": ["kling-image-o1"],
                },
            ],
        },
        "workflows": [
            {
                "id": "digital_human",
                "name": "数字人口播",
                "endpoint": "POST /kling/koubo/digital-human",
                "description": "完整的数字人口播视频生成流程",
                "steps": ["上传音频", "选择数字人形象", "（可选）生成背景", "口型同步", "导出"],
            },
            {
                "id": "batch_avatar",
                "name": "批量分身",
                "endpoint": "POST /kling/koubo/batch-avatars",
                "description": "一条口播，多个数字人形象",
                "steps": ["上传口播视频", "选择多个形象", "批量生成", "导出"],
            },
            {
                "id": "product_showcase",
                "name": "产品动态展示",
                "endpoint": "POST /kling/koubo/product-showcase",
                "description": "产品图片自动动态化",
                "steps": ["上传产品图", "自动生成动态视频", "合成带货视频"],
            },
        ],
        "task_management": {
            "get_status": "GET /kling/ai-task/{task_id}",
            "list_tasks": "GET /kling/ai-tasks",
            "cancel_task": "POST /kling/ai-task/{task_id}/cancel",
        }
    }

