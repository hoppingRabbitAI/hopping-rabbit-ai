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
from ..services.tts_service import tts_service, get_preset_voices
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
from ..tasks.smart_broadcast import process_smart_broadcast

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


def _create_ai_task(
    user_id: str,
    task_type: str,
    input_params: Dict
) -> str:
    """创建 AI 任务记录"""
    ai_task_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    # 获取回调URL
    callback_url = _get_callback_url()
    
    task_data = {
        "id": ai_task_id,
        "user_id": user_id,
        "task_type": task_type,
        "provider": "kling",
        "status": "pending",
        "progress": 0,
        "status_message": "任务已创建，等待处理" + ("（回调模式）" if callback_url else "（轮询模式）"),
        "input_params": input_params,
        "created_at": now,
    }
    
    _get_supabase().table("ai_tasks").insert(task_data).execute()
    
    logger.info(f"[KlingAPI] 创建任务: {ai_task_id}, callback={callback_url or '无(轮询模式)'}")
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
    model_name: str = Field("kling-v2-1-master", description="模型: kling-v2-1-master/kling-video-o1/kling-v2-5-turbo/kling-v2-6")
    duration: str = Field("5", description="视频时长: 5/10")
    aspect_ratio: str = Field("16:9", description="宽高比: 16:9/9:16/1:1")
    cfg_scale: float = Field(0.5, ge=0, le=1, description="提示词相关性")


class ImageToVideoRequest(BaseModel):
    """图生视频请求"""
    image: str = Field(..., description="源图片 URL 或 Base64")
    prompt: str = Field("", description="运动描述提示词", max_length=2500)
    negative_prompt: str = Field("", description="负向提示词")
    model_name: str = Field("kling-v2-5-turbo", description="模型: kling-v2-5-turbo/kling-v2-1-master/kling-v2-6")
    duration: str = Field("5", description="视频时长: 5/10")
    cfg_scale: float = Field(0.5, ge=0, le=1, description="提示词相关性")


class MultiImageToVideoRequest(BaseModel):
    """多图生视频请求"""
    images: List[str] = Field(..., description="图片列表(2-4张)", min_length=2, max_length=4)
    prompt: str = Field("", description="运动描述提示词", max_length=2500)
    negative_prompt: str = Field("", description="负向提示词")
    model_name: str = Field("kling-v2-5-turbo", description="模型: kling-v2-5-turbo(支持首尾帧)")
    duration: str = Field("5", description="视频时长: 5/10")


class MotionControlRequest(BaseModel):
    """动作控制请求"""
    image: str = Field(..., description="待驱动图片 URL 或 Base64")
    video_url: str = Field(..., description="动作参考视频 URL")
    prompt: str = Field("", description="辅助描述", max_length=2500)
    model_name: str = Field("kling-v2-5-turbo", description="模型: kling-v2-5-turbo/kling-v1-6")
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


class OmniImageRequest(BaseModel):
    """Omni-Image 请求"""
    prompt: str = Field(..., description="提示词(用<<<image_N>>>引用图片)", max_length=2500)
    image_list: List[Dict[str, str]] = Field(None, description="参考图列表")
    element_list: List[Dict[str, int]] = Field(None, description="主体参考列表")
    model_name: str = Field("kling-v2-1", description="模型: kling-v1/kling-v1-5/kling-v2/kling-v2-new/kling-v2-1")
    resolution: str = Field("1k", description="清晰度: 1k/2k")
    n: int = Field(1, ge=1, le=9, description="生成数量")
    aspect_ratio: str = Field("auto", description="画面比例(支持auto)")


class FaceSwapRequest(BaseModel):
    """AI换脸请求"""
    video_url: str = Field(..., description="原始视频 URL")
    face_image_url: str = Field(..., description="目标人脸图片 URL")
    face_index: int = Field(0, description="视频中选择第几张脸")


# ============================================
# 智能播报请求模型
# ============================================

class SmartBroadcastRequest(BaseModel):
    """
    智能播报请求
    
    三种输入模式:
    1. 图片 + 音频: image_url + audio_url
    2. 图片 + 脚本 + 预设音色: image_url + script + voice_id
    3. 图片 + 脚本 + 声音克隆: image_url + script + voice_clone_audio_url
    """
    # 必填 - 人物图片
    image_url: str = Field(..., description="人物图片 URL (需包含清晰人脸)")
    
    # 音频输入 (三选一)
    audio_url: Optional[str] = Field(None, description="音频 URL (模式1: 直接上传音频)")
    script: Optional[str] = Field(None, description="文本脚本 (模式2/3: 使用 TTS 合成)")
    
    # TTS 配置
    voice_id: Optional[str] = Field("zh_female_gentle", description="预设音色 ID (模式2)")
    voice_clone_audio_url: Optional[str] = Field(None, description="声音样本 URL，用于克隆您的声音 (模式3)")
    
    # 视频生成选项
    duration: str = Field("5", description="视频时长: 5/10 秒")
    image_prompt: Optional[str] = Field(None, description="图片动态化提示词")
    
    # 音频混合选项
    sound_volume: float = Field(1.0, ge=0, le=2, description="配音音量")
    original_audio_volume: float = Field(0.0, ge=0, le=2, description="原视频音量 (通常为0)")


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
async def create_lip_sync(
    request: LipSyncRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    创建口型同步任务
    
    流程: 人脸识别 → 创建对口型任务 → 轮询状态 → 下载上传
    """
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


# ============================================
# 智能播报 API (一键数字人播报)
# ============================================

@router.get("/smart-broadcast/voices", summary="获取预设音色列表", tags=["智能播报"])
async def get_voices(
    language: Optional[str] = Query(None, description="语言过滤: zh/en"),
    gender: Optional[str] = Query(None, description="性别过滤: male/female"),
):
    """
    获取 TTS 预设音色列表
    
    用于前端展示音色选择器
    """
    voices = get_preset_voices(language=language, gender=gender)
    return {
        "success": True,
        "voices": voices,
        "total": len(voices),
    }


@router.post("/smart-broadcast", summary="智能播报", tags=["智能播报"])
async def create_smart_broadcast(
    request: SmartBroadcastRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    🎙️ 智能播报 - 一键生成数字人播报视频
    
    ## 三种输入模式
    
    ### 模式 1: 图片 + 音频
    直接上传人物图片和配音音频，AI 自动同步口型
    ```json
    {
        "image_url": "https://xxx/person.jpg",
        "audio_url": "https://xxx/voice.mp3"
    }
    ```
    
    ### 模式 2: 图片 + 脚本 + 预设音色
    上传图片和文字脚本，使用预设音色合成语音
    ```json
    {
        "image_url": "https://xxx/person.jpg",
        "script": "大家好，欢迎来到我的频道...",
        "voice_id": "zh_female_gentle"
    }
    ```
    
    ### 模式 3: 图片 + 脚本 + 声音克隆
    上传图片、脚本和声音样本，克隆您的声音生成播报
    ```json
    {
        "image_url": "https://xxx/person.jpg",
        "script": "大家好，欢迎来到我的频道...",
        "voice_clone_audio_url": "https://xxx/my_voice_sample.mp3"
    }
    ```
    
    ## 处理流程
    1. (可选) TTS 语音合成
    2. 图生视频 - 将静态图片转为动态人像视频
    3. 口型同步 - 音频驱动口型动作
    4. 输出最终播报视频
    
    ## 预计时长
    - 5秒视频: 约 3-5 分钟
    - 10秒视频: 约 5-8 分钟
    """
    # 验证输入
    if not request.audio_url and not request.script:
        raise HTTPException(
            status_code=400,
            detail="请提供 audio_url (上传音频) 或 script (文本脚本)"
        )
    
    if request.script and request.audio_url:
        raise HTTPException(
            status_code=400,
            detail="audio_url 和 script 只能选择一个"
        )
    
    try:
        # 构建输入参数记录
        input_params = {
            "image_url": request.image_url,
            "mode": "audio" if request.audio_url else ("voice_clone" if request.voice_clone_audio_url else "tts"),
        }
        if request.audio_url:
            input_params["audio_url"] = request.audio_url
        if request.script:
            input_params["script"] = request.script[:100] + "..." if len(request.script) > 100 else request.script
            input_params["voice_id"] = request.voice_id
        if request.voice_clone_audio_url:
            input_params["voice_clone"] = True
        
        ai_task_id = _create_ai_task(user_id, "smart_broadcast", input_params)
        
        process_smart_broadcast.delay(
            ai_task_id=ai_task_id,
            user_id=user_id,
            image_url=request.image_url,
            audio_url=request.audio_url,
            script=request.script,
            voice_id=request.voice_id,
            voice_clone_audio_url=request.voice_clone_audio_url,
            options={
                "duration": request.duration,
                "image_prompt": request.image_prompt,
                "sound_volume": request.sound_volume,
                "original_audio_volume": request.original_audio_volume,
            }
        )
        
        # 返回模式说明
        mode_desc = {
            "audio": "图片 + 音频模式",
            "tts": "图片 + 脚本 + 预设音色模式",
            "voice_clone": "图片 + 脚本 + 声音克隆模式",
        }
        
        logger.info(f"[KlingAPI] 智能播报任务已创建: {ai_task_id}, mode={input_params['mode']}")
        return {
            "success": True,
            "task_id": ai_task_id,
            "status": "pending",
            "mode": input_params["mode"],
            "mode_description": mode_desc[input_params["mode"]],
            "estimated_time": "3-8 分钟",
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[KlingAPI] 创建智能播报任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/text-to-video", summary="文生视频", tags=["视频生成"])
async def create_text_to_video(
    request: TextToVideoRequest,
    user_id: str = Depends(get_current_user_id)
):
    """创建文生视频任务"""
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
async def create_image_to_video(
    request: ImageToVideoRequest,
    user_id: str = Depends(get_current_user_id)
):
    """创建图生视频任务"""
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
async def create_multi_image_to_video(
    request: MultiImageToVideoRequest,
    user_id: str = Depends(get_current_user_id)
):
    """创建多图生视频任务（2-4张图片场景转换）"""
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
async def create_motion_control(
    request: MotionControlRequest,
    user_id: str = Depends(get_current_user_id)
):
    """创建动作控制任务（参考视频驱动图片人物）"""
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
async def create_video_extend(
    request: VideoExtendRequest,
    user_id: str = Depends(get_current_user_id)
):
    """创建视频延长任务（延长 4-5 秒）"""
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
async def create_image_generation(
    request: ImageGenerationRequest,
    user_id: str = Depends(get_current_user_id)
):
    """创建图像生成任务（文生图/图生图）"""
    try:
        # 使用用户指定模型或默认 kling-v2-1
        model_name = request.model_name or "kling-v2-1"
        
        ai_task_id = _create_ai_task(user_id, "image_generation", request.model_dump())
        
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
    user_id: str = Depends(get_current_user_id)
):
    """创建 Omni-Image 任务（高级多模态图像生成）"""
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
async def create_face_swap(
    request: FaceSwapRequest,
    user_id: str = Depends(get_current_user_id)
):
    """创建 AI 换脸任务"""
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
        result = supabase.table("ai_tasks").select("*").eq("id", task_id).eq("user_id", user_id).single().execute()
        
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
    user_id: str = Depends(get_current_user_id)
):
    """获取用户的 AI 任务列表"""
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
async def cancel_ai_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """取消 AI 任务"""
    try:
        supabase = _get_supabase()
        supabase.table("ai_tasks").update({
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
    track_type: str = Field("video", description="轨道类型: video/audio/image")


def _get_or_create_track(supabase, project_id: str, track_type: str, user_id: str) -> str:
    """获取或创建轨道，返回 track_id
    
    逻辑：
    1. 优先找已有同类型 clip 所在的 track（通过 clips.clip_type 判断）
    2. 找不到则创建新轨道
    """
    now = datetime.utcnow().isoformat()
    
    # 1. 查找已有同类型 clip 所在的 track
    existing_clip = supabase.table("clips").select("track_id, tracks!inner(project_id)").eq("clip_type", track_type).eq("tracks.project_id", project_id).order("created_at", desc=True).limit(1).execute()
    
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
        "name": f"AI {track_type.capitalize()} Track",
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
        task_result = supabase.table("ai_tasks").select("*").eq("id", task_id).eq("user_id", user_id).single().execute()
        if not task_result.data:
            raise HTTPException(status_code=404, detail="任务不存在")
        
        task = task_result.data
        
        # 2. 检查任务状态和输出
        if task["status"] != "completed":
            raise HTTPException(status_code=400, detail="任务尚未完成")
        
        if not task.get("output_url"):
            raise HTTPException(status_code=400, detail="任务没有输出文件")
        
        # 3. 确定文件类型和素材名称
        task_type = task["task_type"]
        is_image = task_type in ["image_generation", "omni_image"]
        file_type = "image" if is_image else "video"  # 用于 assets.file_type
        clip_type = "image" if is_image else "video"   # 用于 clips.clip_type
        
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
        }
        default_name = f"{task_type_labels.get(task_type, 'AI生成')}_{task_id[:8]}"
        asset_name = request.name or default_name
        
        # 从 result_metadata 获取媒体信息
        metadata = task.get("result_metadata") or {}
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
        supabase.table("ai_tasks").update({
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
        result = supabase.table("ai_tasks").delete().eq("id", task_id).eq("user_id", user_id).execute()
        
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
        result = supabase.table("ai_tasks").delete().in_("id", request.task_ids).eq("user_id", user_id).execute()
        
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
# 口播场景封装接口
# ============================================

@router.post("/koubo/digital-human", summary="数字人口播", tags=["口播场景"])
async def generate_digital_human_video(
    request: DigitalHumanRequest,
    user_id: str = Depends(get_current_user_id)
):
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
async def batch_generate_avatars(
    request: BatchAvatarRequest,
    user_id: str = Depends(get_current_user_id)
):
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
async def generate_product_showcase(
    request: ProductShowcaseRequest,
    user_id: str = Depends(get_current_user_id)
):
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
                    "models": ["kling-image-o1", "kling-v2-1"],
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

