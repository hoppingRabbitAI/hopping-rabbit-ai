"""
Lepus AI - 可灵AI API 路由

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

from ..services.kling_ai_service import kling_client
from ..services.tts_service import tts_service
from .auth import get_current_user_id

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


def _get_callback_url() -> Optional[str]:
    """
    获取可灵AI回调URL
    
    如果配置了 callback_base_url，返回完整的回调地址
    否则返回 None，任务将使用轮询模式
    """
    from ..config import get_settings
    settings = get_settings()
    
    if settings.callback_base_url:
        return f"{settings.callback_base_url.rstrip('/')}/api/callback/kling"
    return None


async def _resolve_avatar_portrait(avatar_id: str, user_id: str, prompt: str = None) -> dict:
    """
    🆕 根据 avatar_id 获取数字人头像 URL + 多角度参考图
    
    当传入 prompt 时，使用 LLM 分析用户 prompt 中的角度/姿态意图，
    从预生成的多角度参考图中选出最匹配的一张作为 face reference，
    提升角色在非正面构图下的一致性。
    
    返回: {
        "portrait_url": str,           # 原始正面照（fallback）
        "reference_images": list[str], # 所有参考图（omni_image 用）
        "best_ref_url": str,           # 🆕 最佳匹配参考图 URL
    }
    安全校验：确认该 avatar 属于当前用户 或 是已发布的公共模板
    """
    supabase = _get_supabase()
    result = supabase.table("digital_avatar_templates").select(
        "id, portrait_url, reference_images, generation_config, status, created_by"
    ).eq("id", avatar_id).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail=f"数字人角色不存在: {avatar_id}")
    
    avatar = result.data[0]
    
    # 安全校验：必须是自己创建的 或 已发布的公共模板
    if avatar.get("created_by") != user_id and avatar.get("status") != "published":
        raise HTTPException(status_code=403, detail="无权使用该数字人角色")
    
    portrait_url = avatar.get("portrait_url")
    if not portrait_url:
        raise HTTPException(status_code=400, detail="该数字人角色缺少人像照片")
    
    reference_images = avatar.get("reference_images") or []
    
    # 🆕 动态角度选择：根据 prompt 意图挑选最佳参考图
    best_ref_url = portrait_url  # 默认用正面照
    gen_config = avatar.get("generation_config") or {}
    angle_map = gen_config.get("reference_angle_map")
    
    if prompt and angle_map and len(angle_map) > 1:
        selected = await _select_best_angle(prompt, angle_map)
        if selected:
            best_ref_url = selected
    
    logger.info(
        f"[KlingAPI] 解析数字人角色: {avatar_id} → "
        f"portrait_url={portrait_url[:60]}..., "
        f"best_ref={'(angle-matched)' if best_ref_url != portrait_url else '(front)'}, "
        f"ref_images={len(reference_images)}张"
    )
    return {
        "portrait_url": portrait_url,
        "reference_images": reference_images,
        "best_ref_url": best_ref_url,
    }


async def _select_best_angle(prompt: str, angle_map: Dict[str, str]) -> Optional[str]:
    """
    🆕 使用 LLM 分析 prompt 中的角度/姿态意图，返回最匹配的参考图 URL
    
    角度映射:
      - front: 正面（默认）
      - three_quarter_left: 左侧 3/4 视角
      - profile_right: 右侧侧面
      - slight_above: 轻微俯视
    
    如果 LLM 不可用或判断为正面，返回 None（调用方会 fallback 到 portrait_url）
    """
    from ..services.llm import llm_service
    
    if not llm_service.is_configured():
        logger.debug("[AngleSelect] LLM 未配置，跳过角度选择")
        return None
    
    available_angles = list(angle_map.keys())
    
    system_prompt = f"""你是一个摄影构图分析助手。根据用户的图像生成 prompt，
判断画面中人物最可能的朝向/角度，从以下选项中选择最匹配的一个：

可选角度: {available_angles}

角度含义：
- front: 正面面对镜头
- three_quarter_left: 人物面部微微转向左侧（3/4 侧面）
- profile_right: 右侧侧脸
- slight_above: 略微仰头或俯拍视角

判断规则：
1. 如果 prompt 明确提到朝向（如"侧脸"、"looking left"、"profile"），直接匹配
2. 如果 prompt 暗示非正面构图（如"回眸"、"望向窗外"、"turned away"），选最接近的角度
3. 如果无法判断或是正面构图，选 "front"
4. 只返回 JSON，不要解释

返回格式: {{"angle": "选中的角度key", "confidence": 0.0到1.0}}"""

    try:
        result = await llm_service.generate_json(
            user_prompt=prompt,
            system_prompt=system_prompt,
            temperature=0.1,  # 低温度确保稳定分类
        )
    except Exception as e:
        logger.warning(f"[AngleSelect] LLM 角度分析失败: {e}")
        return None
    
    if not result:
        return None
    
    angle = result.get("angle", "front")
    confidence = result.get("confidence", 0.0)
    
    # 低置信度时不切换角度，避免误判
    if confidence < 0.6 or angle == "front":
        logger.debug(f"[AngleSelect] angle={angle}, confidence={confidence} → 使用正面照")
        return None
    
    url = angle_map.get(angle)
    if url:
        logger.info(f"[AngleSelect] prompt 角度意图: {angle} (confidence={confidence}) → 使用该角度参考图")
        return url
    
    logger.debug(f"[AngleSelect] 角度 {angle} 不在 angle_map 中，fallback 正面照")
    return None


def _create_ai_task(
    user_id: str,
    task_type: str,
    input_params: Dict,
    project_id: str = None,
) -> str:
    """创建 AI 任务记录（委托给共享工具函数）"""
    from ..utils.ai_task_helpers import create_ai_task
    callback_url = _get_callback_url()
    # 兼容：如果调用方未显式传 project_id，尝试从 input_params 提取
    pid = project_id or input_params.get("project_id")
    return create_ai_task(
        user_id=user_id,
        task_type=task_type,
        input_params=input_params,
        callback_url=callback_url,
        project_id=pid,
    )


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
    model_name: str = Field("kling-v2-6", description="模型: kling-v2-6/kling-v2-1-master/kling-video-o1/kling-v2-5-turbo")
    duration: str = Field("5", description="视频时长: 5/10")
    aspect_ratio: str = Field("16:9", description="宽高比: 16:9/9:16/1:1")
    cfg_scale: float = Field(0.5, ge=0, le=1, description="提示词相关性")
    # 🆕 数字人角色 face reference
    avatar_id: Optional[str] = Field(None, description="数字人角色 ID，传入后自动带入 face reference")


class ImageToVideoRequest(BaseModel):
    """图生视频请求"""
    image: str = Field(..., description="源图片 URL 或 Base64")
    prompt: str = Field("", description="运动描述提示词", max_length=2500)
    negative_prompt: str = Field("", description="负向提示词")
    model_name: str = Field("kling-v2-6", description="模型: kling-v2-6/kling-v2-5-turbo/kling-v2-1-master")
    duration: str = Field("5", description="视频时长: 5/10")
    cfg_scale: float = Field(0.5, ge=0, le=1, description="提示词相关性")
    # 🆕 数字人角色 face reference
    avatar_id: Optional[str] = Field(None, description="数字人角色 ID，传入后自动带入 face reference")


class MultiImageToVideoRequest(BaseModel):
    """多图生视频请求"""
    images: List[str] = Field(..., description="图片列表(2-4张)", min_length=2, max_length=4)
    prompt: str = Field("", description="运动描述提示词", max_length=2500)
    negative_prompt: str = Field("", description="负向提示词")
    model_name: str = Field("kling-v2-6", description="模型: kling-v2-6/kling-v2-5-turbo")
    duration: str = Field("5", description="视频时长: 5/10")


class MotionControlRequest(BaseModel):
    """动作控制请求"""
    image: str = Field(..., description="待驱动图片 URL 或 Base64")
    video_url: str = Field(..., description="动作参考视频 URL")
    prompt: str = Field("", description="辅助描述", max_length=2500)
    model_name: str = Field("kling-v2-6", description="模型: kling-v2-6/kling-v2-5-turbo/kling-v1-6")
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
    negative_prompt: str = Field("", description="负向提示词(图生图时不支持)", max_length=2500)
    image: str = Field(None, description="参考图像(图生图模式)")
    image_reference: str = Field(None, description="参考类型: subject/face")
    model_name: str = Field("kling-v2-1", description="模型: kling-v1/kling-v1-5/kling-v2/kling-v2-new/kling-v2-1")
    resolution: str = Field("1k", description="清晰度: 1k/2k")
    n: int = Field(1, ge=1, le=9, description="生成数量")
    aspect_ratio: str = Field(None, description="画面比例(仅文生图有效，图生图由参考图决定)")
    image_fidelity: float = Field(0.5, ge=0, le=1, description="图片参考强度")
    human_fidelity: float = Field(0.45, ge=0, le=1, description="面部参考强度")
    # 🆕 数字人角色 face reference
    avatar_id: Optional[str] = Field(None, description="数字人角色 ID，传入后自动带入 face reference")


class OmniImageRequest(BaseModel):
    """Omni-Image 请求"""
    prompt: str = Field(..., description="提示词(用<<<image_N>>>引用图片)", max_length=2500)
    image_list: List[Dict[str, str]] = Field(None, description="参考图列表")
    element_list: List[Dict[str, int]] = Field(None, description="主体参考列表")
    model_name: str = Field("kling-image-o1", description="模型: kling-image-o1")
    resolution: str = Field("2k", description="清晰度: 1k/2k")
    n: int = Field(1, ge=1, le=9, description="生成数量")
    aspect_ratio: str = Field("auto", description="画面比例(支持auto)")
    # 🆕 数字人角色 face reference
    avatar_id: Optional[str] = Field(None, description="数字人角色 ID，传入后自动带入 face reference")


class FaceSwapRequest(BaseModel):
    """AI换脸请求（基于 Omni-Image）"""
    source_image_url: str = Field(..., description="源图片 URL（要被换脸的图片）")
    face_image_url: str = Field(..., description="目标人脸图片 URL")
    custom_prompt: Optional[str] = Field(None, description="额外提示词")
    resolution: str = Field("1k", description="清晰度 1k/2k")
    generate_video: bool = Field(False, description="是否在换脸后生成视频")
    video_prompt: Optional[str] = Field(None, description="视频生成提示词")
    video_duration: str = Field("5", description="视频时长 5/10 秒")


# ============================================
# 口型同步 API (核心功能)
# ============================================

@router.post("/lip-sync", summary="口型同步", tags=["视频生成"])
async def create_lip_sync(
    request: LipSyncRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """
    创建口型同步任务
    
    流程: 人脸识别 → 创建对口型任务 → 轮询状态 → 下载上传
    """
    try:
        ai_task_id = _create_ai_task(user_id, "lip_sync", request.model_dump(), project_id=project_id)
        
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
async def create_text_to_video(
    request: TextToVideoRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """创建文生视频任务"""
    try:
        # 🆕 文生视频不支持 face reference（Kling text2video API 无 image 参数）
        # 未来可扩展：先用 image_generation + face 生成图片，再转为 image_to_video
        if request.avatar_id:
            logger.info(f"[KlingAPI] 文生视频暂不支持 face reference，已忽略 avatar_id={request.avatar_id}")

        ai_task_id = _create_ai_task(user_id, "text_to_video", request.model_dump(), project_id=project_id)
        
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
async def create_image_to_video(
    request: ImageToVideoRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """创建图生视频任务"""
    try:
        # 🆕 图生视频不支持 face reference（Kling image2video API 无此参数）
        if request.avatar_id:
            logger.info(f"[KlingAPI] 图生视频暂不支持 face reference，已忽略 avatar_id={request.avatar_id}")

        ai_task_id = _create_ai_task(user_id, "image_to_video", request.model_dump(), project_id=project_id)
        
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
async def create_multi_image_to_video(
    request: MultiImageToVideoRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """创建多图生视频任务（2-4张图片场景转换）"""
    try:
        ai_task_id = _create_ai_task(user_id, "multi_image_to_video", request.model_dump(), project_id=project_id)
        
        process_multi_image_to_video.delay(
            task_id=ai_task_id,
            user_id=user_id,
            image_list=request.images,
            prompt=request.prompt,
            options={
                "model_name": request.model_name,
                "duration": request.duration,
                "negative_prompt": request.negative_prompt,
            }
        )
        
        logger.info(f"[KlingAPI] 多图生视频任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建多图生视频任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/motion-control", summary="动作控制", tags=["视频生成"])
async def create_motion_control(
    request: MotionControlRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """创建动作控制任务（参考视频驱动图片人物）"""
    try:
        ai_task_id = _create_ai_task(user_id, "motion_control", request.model_dump(), project_id=project_id)
        
        process_motion_control.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            image=request.image,
            video_url=request.video_url,
            prompt=request.prompt,
            options={
                "mode": request.mode,
                "duration": request.duration,
                "model_name": request.model_name,
            }
        )
        
        logger.info(f"[KlingAPI] 动作控制任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建动作控制任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video-extend", summary="视频延长", tags=["视频生成"])
async def create_video_extend(
    request: VideoExtendRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """创建视频延长任务（延长 4-5 秒）"""
    try:
        ai_task_id = _create_ai_task(user_id, "video_extend", request.model_dump(), project_id=project_id)
        
        process_video_extend.delay(
            task_id=ai_task_id,
            user_id=user_id,
            video_id=request.video_id,
            options={
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt,
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
async def create_image_generation(
    request: ImageGenerationRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """创建图像生成任务（文生图/图生图）"""
    try:
        # 🆕 如果传入 avatar_id，自动注入 face reference + 多角度参考图
        if request.avatar_id:
            avatar_data = await _resolve_avatar_portrait(request.avatar_id, user_id, prompt=request.prompt)
            best_ref_url = avatar_data["best_ref_url"]
            ref_images = avatar_data["reference_images"]
            # 仅在用户未手动指定 image 时注入
            if not request.image:
                request.image = best_ref_url
                request.image_reference = "face"
                if request.human_fidelity <= 0.45:  # 未手动调高
                    request.human_fidelity = 0.75
                logger.info(f"[KlingAPI] 已注入数字人 face reference: avatar={request.avatar_id}, ref_images={len(ref_images)}张, angle_matched={best_ref_url != avatar_data['portrait_url']}")

        # 使用用户指定模型或默认 kling-v2-1
        model_name = request.model_name or "kling-v2-1"
        
        ai_task_id = _create_ai_task(user_id, "image_generation", request.model_dump(), project_id=project_id)
        
        # 构建 options
        options = {
            "model_name": model_name,
            "resolution": request.resolution,
            "n": request.n,
            "image_fidelity": request.image_fidelity,
            "human_fidelity": request.human_fidelity,
        }
        
        # 文生图模式支持 aspect_ratio，图生图由参考图决定
        if not request.image and request.aspect_ratio:
            options["aspect_ratio"] = request.aspect_ratio
        
        # negative_prompt 图生图时不支持
        neg_prompt = "" if request.image else request.negative_prompt
        
        process_image_generation.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            prompt=request.prompt,
            negative_prompt=neg_prompt,
            image=request.image,
            image_reference=request.image_reference,
            options=options
        )
        
        logger.info(f"[KlingAPI] 图像生成任务已创建: {ai_task_id}, model={model_name}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建图像生成任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/omni-image", summary="Omni-Image", tags=["图像生成"])
async def create_omni_image(
    request: OmniImageRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """创建 Omni-Image 任务（高级多模态图像生成）"""
    try:
        # 🆕 如果传入 avatar_id，将人像 + 多角度参考图全部注入 image_list
        image_list = request.image_list or []
        if request.avatar_id:
            avatar_data = await _resolve_avatar_portrait(request.avatar_id, user_id, prompt=request.prompt)
            portrait_url = avatar_data["portrait_url"]
            ref_images = avatar_data["reference_images"]
            # 合并所有参考图（主图 + 多角度），去重
            all_refs = [portrait_url]
            for ref in ref_images:
                if ref not in all_refs:
                    all_refs.append(ref)
            # 将每张参考图追加到 image_list
            for ref_url in all_refs:
                face_var = f"image_{len(image_list) + 1}"
                image_list = [*image_list, {"image": ref_url, "var": face_var}]
            logger.info(f"[KlingAPI] Omni-Image 已注入数字人 {len(all_refs)} 张参考图: avatar={request.avatar_id}")

        ai_task_id = _create_ai_task(user_id, "omni_image", request.model_dump(), project_id=project_id)
        
        process_omni_image.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            prompt=request.prompt,
            image_list=image_list,
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


@router.post("/face-swap", summary="AI换脸", tags=["图像生成"])
async def create_face_swap(
    request: FaceSwapRequest,
    project_id: Optional[str] = Query(None, description="关联项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """
    创建 AI 换脸任务（基于 Omni-Image）
    
    原理：通过 Omni-Image 的 face reference 能力，保持源图场景不变，只替换人脸。
    可选联动：换脸后通过 image2video 生成动态视频。
    """
    try:
        ai_task_id = _create_ai_task(user_id, "face_swap", request.model_dump(), project_id=project_id)
        
        process_face_swap.delay(
            task_id=ai_task_id,
            user_id=user_id,
            source_image_url=request.source_image_url,
            face_image_url=request.face_image_url,
            options={
                "custom_prompt": request.custom_prompt,
                "resolution": request.resolution,
                "generate_video": request.generate_video,
                "video_prompt": request.video_prompt,
                "video_duration": request.video_duration,
            }
        )
        
        logger.info(f"[KlingAPI] AI换脸任务已创建: {ai_task_id}")
        return {"success": True, "task_id": ai_task_id, "status": "pending"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 创建AI换脸任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 统一任务查询 API（直接查询可灵AI）
# ============================================

@router.get("/tasks/{category}/{task_type}/{task_id}", summary="统一任务查询", tags=["任务管理"])
async def get_kling_task_status(
    category: str,
    task_type: str,
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """
    统一任务查询接口 - 直接查询可灵AI API
    
    路径匹配可灵API结构: /{category}/{task_type}/{task_id}
    
    示例:
    - 文生视频: GET /kling/tasks/videos/text2video/{task_id}
    - 图生视频: GET /kling/tasks/videos/image2video/{task_id}
    - 多图生视频: GET /kling/tasks/videos/multi-image2video/{task_id}
    - 动作控制: GET /kling/tasks/videos/motion-control/{task_id}
    - 视频延长: GET /kling/tasks/videos/video-extend/{task_id}
    - 口型同步: GET /kling/tasks/videos/advanced-lip-sync/{task_id}
    - 图像生成: GET /kling/tasks/images/generations/{task_id}
    - Omni图像: GET /kling/tasks/images/omni-image/{task_id}
    """
    from ..services.kling_client import get_kling_client
    
    try:
        client = get_kling_client()
        endpoint_base = f"/{category}/{task_type}"
        
        response = await client.get_task(endpoint_base, task_id)
        
        if response.get("code") != 0:
            raise HTTPException(
                status_code=400, 
                detail=response.get("message", "Unknown error")
            )
        
        task_data = response.get("data", {})
        
        return {
            "task_id": task_data.get("task_id", task_id),
            "task_status": task_data.get("task_status", "unknown"),
            "task_status_msg": task_data.get("task_status_msg"),
            "task_result": task_data.get("task_result"),
            "task_info": task_data.get("task_info"),
            "created_at": task_data.get("created_at"),
            "updated_at": task_data.get("updated_at"),
            "raw_data": task_data,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[KlingAPI] 查询可灵任务失败: {category}/{task_type}/{task_id} - {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 任务管理 API
# ============================================

@router.get("/ai-task/{task_id}", summary="查询任务状态", tags=["任务管理"])
async def get_ai_task_status(
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """查询 AI 任务状态（前端轮询）"""
    try:
        supabase = _get_supabase()
        result = supabase.table("tasks").select("*").eq("id", task_id).eq("user_id", user_id).single().execute()
        
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
            "result_metadata": task.get("metadata"),
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
    user_id: str = Depends(get_current_user_id)
):
    """获取用户的 AI 任务列表"""
    try:
        supabase = _get_supabase()
        query = supabase.table("tasks").select("*").eq("user_id", user_id)
        
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
async def cancel_ai_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """取消 AI 任务"""
    try:
        supabase = _get_supabase()
        supabase.table("tasks").update({
            "status": "cancelled",
            "completed_at": datetime.utcnow().isoformat(),
        }).eq("id", task_id).eq("user_id", user_id).execute()
        
        return {"success": True, "message": "任务已取消"}
        
    except Exception as e:
        logger.error(f"[KlingAPI] 取消任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class AddToProjectRequest(BaseModel):
    """添加到项目请求"""
    project_id: Optional[str] = Field(None, description="目标项目 ID（为空则创建新项目）")
    name: Optional[str] = Field(None, description="素材名称（可选，默认使用任务类型）")
    create_clip: bool = Field(True, description="是否自动创建 clip 添加到轨道")
    clip_type: str = Field("video", description="Clip 类型: video/audio/image")


def _get_or_create_track(supabase, project_id: str, clip_type: str, user_id: str) -> str:
    """获取或创建轨道，返回 track_id
    
    注意：Track 没有 type 字段，所有轨道都是通用的
    这里通过 clip_type 来查找已有相同类型 clip 所在的轨道，仅用于素材归类
    
    逻辑：
    1. 优先找已有同类型 clip 所在的 track
    2. 找不到则创建新轨道
    """
    now = datetime.utcnow().isoformat()
    
    # 1. 查找已有同类型 clip 所在的 track
    existing_clip = supabase.table("clips").select("track_id, tracks!inner(project_id)").eq("clip_type", clip_type).eq("tracks.project_id", project_id).order("created_at", desc=True).limit(1).execute()
    
    if existing_clip.data:
        return existing_clip.data[0]["track_id"]
    
    # 2. 没有同类型 clip，创建新轨道
    track_id = str(uuid.uuid4())
    
    # 获取当前最大 order_index
    max_order = supabase.table("tracks").select("order_index").eq("project_id", project_id).order("order_index", desc=True).limit(1).execute()
    order_index = (max_order.data[0]["order_index"] + 1) if max_order.data else 0
    
    track_data = {
        "id": track_id,
        "project_id": project_id,
        "name": f"AI {clip_type.capitalize()} Track",  # 轨道名称仅用于显示，不表示类型
        "order_index": order_index,
        "is_muted": False,
        "is_locked": False,
        "created_at": now,
        "updated_at": now,
    }
    
    supabase.table("tracks").insert(track_data).execute()
    logger.info(f"[KlingAPI] 创建新轨道: track_id={track_id}, name={track_data['name']}")
    
    return track_id


def _get_track_end_time(supabase, track_id: str) -> float:
    """获取轨道上最后一个 clip 的结束时间"""
    result = supabase.table("clips").select("end_time").eq("track_id", track_id).order("end_time", desc=True).limit(1).execute()
    
    if result.data:
        return result.data[0]["end_time"]
    return 0


@router.post("/ai-task/{task_id}/add-to-project", summary="添加到项目", tags=["任务管理"])
async def add_ai_task_to_project(
    task_id: str,
    request: AddToProjectRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    将 AI 任务的输出添加到项目
    
    支持两种模式：
    1. project_id 为空：创建新项目，自动添加 asset 和 clip
    2. project_id 有值：添加到现有项目，自动创建 clip 添加到轨道末尾
    
    返回:
    - project_id: 项目 ID（新建或现有）
    - asset_id: 素材 ID
    - clip_id: 片段 ID（如果 create_clip=true）
    - is_new_project: 是否新建了项目
    """
    try:
        supabase = _get_supabase()
        now = datetime.utcnow().isoformat()
        
        # 1. 获取 AI 任务信息
        task_result = supabase.table("tasks").select("*").eq("id", task_id).eq("user_id", user_id).single().execute()
        if not task_result.data:
            raise HTTPException(status_code=404, detail="任务不存在")
        
        task = task_result.data
        
        # 2. 检查任务状态和输出 —— 给出详细诊断信息
        current_status = task["status"]
        if current_status != "completed":
            created_at = task.get("created_at", "")
            # 计算卡住时间
            stuck_hint = ""
            if created_at:
                from datetime import datetime as _dt
                try:
                    created = _dt.fromisoformat(created_at.replace("Z", "+00:00"))
                    elapsed_min = (datetime.utcnow().replace(tzinfo=created.tzinfo) - created).total_seconds() / 60
                    if current_status == "pending" and elapsed_min > 2:
                        stuck_hint = f"（任务已等待 {elapsed_min:.0f} 分钟，可能 Celery Worker 未监听 {task.get('task_type', '')} 对应队列）"
                    elif current_status == "processing" and elapsed_min > 15:
                        stuck_hint = f"（任务已处理 {elapsed_min:.0f} 分钟，可能卡住）"
                except Exception:
                    pass
            raise HTTPException(
                status_code=400,
                detail=f"任务当前状态为 {current_status}，尚未完成{stuck_hint}"
            )
        
        if not task.get("output_url"):
            raise HTTPException(status_code=400, detail="任务已完成但没有输出文件，请检查任务日志")
        
        # 3. 确定文件类型 — 直接看 output_url 后缀，不硬编码
        task_type = task["task_type"]
        output_url: str = task["output_url"]
        video_exts = (".mp4", ".mov", ".webm", ".avi", ".mkv")
        is_image = not output_url.lower().split("?")[0].endswith(video_exts)
        file_type = "image" if is_image else "video"
        clip_type = "image" if is_image else "video"
        
        task_type_labels = {
            "lip_sync": "口型同步",
            "text_to_video": "文生视频",
            "image_to_video": "图生视频",
            "multi_image_to_video": "多图生视频",
            "motion_control": "动作控制",
            "video_extend": "视频延长",
            "image_generation": "AI生成图片",
            "omni_image": "Omni-Image",
            "face_swap": "AI换脸",
            "skin_enhance": "皮肤美化",
            "relight": "AI打光",
            "outfit_swap": "换装",
            "ai_stylist": "AI造型",
            "outfit_shot": "穿搭拍摄",
        }
        default_name = f"{task_type_labels.get(task_type, 'AI生成')}_{task_id[:8]}"
        asset_name = request.name or default_name
        
        # 从 metadata 获取媒体信息
        metadata = task.get("metadata") or {}
        duration = metadata.get("duration", 5.0)  # 默认 5 秒
        width = metadata.get("width", 1920)
        height = metadata.get("height", 1080)
        
        is_new_project = False
        project_id = request.project_id
        
        # 4. 如果没有 project_id，创建新项目
        if not project_id:
            is_new_project = True
            project_id = str(uuid.uuid4())
            
            project_data = {
                "id": project_id,
                "user_id": user_id,
                "name": f"新项目 - {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                "description": f"由 AI 任务 {task_type_labels.get(task_type, 'AI')} 创建",
                "resolution": {"width": width, "height": height},
                "fps": 30,
                "status": "draft",
                "created_at": now,
                "updated_at": now,
            }
            
            supabase.table("projects").insert(project_data).execute()
            logger.info(f"[KlingAPI] 创建新项目: project_id={project_id}")
        
        # 5. 创建 asset 记录
        asset_id = str(uuid.uuid4())
        
        asset_data = {
            "id": asset_id,
            "project_id": project_id,
            "user_id": user_id,
            "name": asset_name,
            "original_filename": f"{asset_name}.{'png' if is_image else 'mp4'}",
            "file_type": file_type,
            "mime_type": "image/png" if is_image else "video/mp4",
            "storage_path": task["output_url"],
            "duration": duration if not is_image else None,
            "width": width,
            "height": height,
            "status": "ready",
            "ai_task_id": task_id,
            "ai_generated": True,
            "created_at": now,
            "updated_at": now,
        }
        
        supabase.table("assets").insert(asset_data).execute()
        logger.info(f"[KlingAPI] 创建 asset: asset_id={asset_id}")
        
        # 6. 创建 clip（如果需要）
        clip_id = None
        track_id = None
        
        if request.create_clip:
            # 获取或创建轨道
            track_id = _get_or_create_track(supabase, project_id, clip_type, user_id)
            
            # 获取轨道末尾时间 (毫秒)
            start_time_ms = int(_get_track_end_time(supabase, track_id))
            
            # 图片默认显示 3 秒 = 3000 毫秒，视频使用实际时长
            clip_duration_ms = int((duration if not is_image else 3.0) * 1000)
            end_time_ms = start_time_ms + clip_duration_ms
            
            clip_id = str(uuid.uuid4())
            
            # clips 表字段 - 只包含数据库实际存在的字段
            clip_data = {
                "id": clip_id,
                "track_id": track_id,
                "asset_id": asset_id,
                "clip_type": clip_type,  # image 或 video
                "start_time": start_time_ms,
                "end_time": end_time_ms,
                "source_start": 0,
                "source_end": clip_duration_ms,
                "volume": 1.0 if not is_image else None,  # 图片没有音量
                "is_muted": False,
                "speed": 1.0,
                "name": asset_name,
                "cached_url": task["output_url"],
                "created_at": now,
                "updated_at": now,
            }
            
            supabase.table("clips").insert(clip_data).execute()
            logger.info(f"[KlingAPI] 创建 clip: clip_id={clip_id}, start={start_time_ms}, end={end_time_ms}")
        
        # 7. 更新 ai_tasks 表
        supabase.table("tasks").update({
            "output_asset_id": asset_id,
            "updated_at": now,
        }).eq("id", task_id).execute()
        
        # 8. 更新项目时间戳
        supabase.table("projects").update({
            "updated_at": now,
        }).eq("id", project_id).execute()
        
        logger.info(f"[KlingAPI] AI任务添加完成: task_id={task_id}, project_id={project_id}, is_new={is_new_project}")
        
        return {
            "success": True,
            "project_id": project_id,
            "asset_id": asset_id,
            "clip_id": clip_id,
            "track_id": track_id,
            "is_new_project": is_new_project,
            "message": "已创建新项目并添加" if is_new_project else "已添加到项目",
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[KlingAPI] 添加到项目失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 任务删除接口
# ============================================

class BatchDeleteRequest(BaseModel):
    """批量删除请求"""
    task_ids: List[str] = Field(..., description="要删除的任务 ID 列表")


@router.delete("/ai-task/{task_id}", summary="删除单个任务", tags=["任务管理"])
async def delete_ai_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除单个 AI 任务"""
    try:
        supabase = _get_supabase()
        
        # 验证任务属于当前用户并删除
        result = supabase.table("tasks").delete().eq("id", task_id).eq("user_id", user_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="任务不存在或无权删除")
        
        logger.info(f"[KlingAPI] 删除任务: task_id={task_id}")
        return {"success": True, "deleted_count": 1}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[KlingAPI] 删除任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai-tasks/batch-delete", summary="批量删除任务", tags=["任务管理"])
async def batch_delete_ai_tasks(
    request: BatchDeleteRequest,
    user_id: str = Depends(get_current_user_id)
):
    """批量删除 AI 任务"""
    if not request.task_ids:
        raise HTTPException(status_code=400, detail="任务 ID 列表不能为空")
    
    if len(request.task_ids) > 100:
        raise HTTPException(status_code=400, detail="单次最多删除 100 个任务")
    
    try:
        supabase = _get_supabase()
        
        # 批量删除属于当前用户的任务
        result = supabase.table("tasks").delete().in_("id", request.task_ids).eq("user_id", user_id).execute()
        
        deleted_count = len(result.data) if result.data else 0
        
        if deleted_count == 0:
            raise HTTPException(status_code=404, detail="没有找到可删除的任务")
        
        logger.info(f"[KlingAPI] 批量删除任务: count={deleted_count}")
        return {
            "success": True,
            "deleted_count": deleted_count,
            "requested_count": len(request.task_ids),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[KlingAPI] 批量删除任务失败: {e}")
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
                    "use_cases": ["数字人", "AI换脸", "多语言配音"],
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
                    "use_cases": ["视频背景", "B-roll素材", "片头片尾"],
                    "input": {"prompt": "提示词"},
                    "output": "video",
                    "estimated_time": "2-10分钟",
                    "api_endpoint": "POST /v1/videos/text2video",
                    "models": ["kling-v2-1-master", "kling-video-o1", "kling-v2-5-turbo", "kling-v2-6"],
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
                    "models": ["kling-v2-5-turbo", "kling-v2-1-master", "kling-v2-6"],
                },
                {
                    "id": "multi_image_to_video",
                    "name": "多图生视频",
                    "endpoint": "POST /kling/multi-image-to-video",
                    "description": "2-4张图片生成场景转换视频(支持首尾帧)",
                    "use_cases": ["故事板动态化", "多场景串联"],
                    "input": {"images": ["图片列表(2-4张)"]},
                    "output": "video",
                    "estimated_time": "2-8分钟",
                    "api_endpoint": "POST /v1/videos/multi-image2video",
                    "models": ["kling-v2-5-turbo"],
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
                    "models": ["kling-v2-5-turbo", "kling-v1-6"],
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
                    "models": ["kling-v2-1"],
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
                    "models": ["kling-v2-1"],
                },
            ],
        },
        "workflows": [],
        "task_management": {
            "get_status": "GET /kling/ai-task/{task_id}",
            "list_tasks": "GET /kling/ai-tasks",
            "cancel_task": "POST /kling/ai-task/{task_id}/cancel",
        }
    }

