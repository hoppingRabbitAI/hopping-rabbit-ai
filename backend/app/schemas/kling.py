"""
Lepus AI - 可灵AI Pydantic 模型

完整的请求/响应模型定义，包含:
1. 枚举类型 (ModelName, Mode, AspectRatio 等)
2. 字段验证器 (Base64 清洗、互斥参数检查)
3. 视频生成请求模型
4. 口型同步请求模型
5. 图像生成请求模型
6. 统一响应模型

参考: Kling AI 官方 API 文档
"""

from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator


# ============================================
# 枚举定义
# ============================================

class ModelName(str, Enum):
    """可灵AI 模型版本"""
    V1 = "kling-v1"
    V1_5 = "kling-v1-5"
    V1_6 = "kling-v1-6"
    V2 = "kling-v2"
    V2_1 = "kling-v2-1"
    V2_1_MASTER = "kling-v2-1-master"
    V2_5_TURBO = "kling-v2-5-turbo"
    V2_6 = "kling-v2-6"
    VIDEO_O1 = "kling-video-o1"
    IMAGE_O1 = "kling-image-o1"


class Mode(str, Enum):
    """生成模式"""
    STD = "std"   # 标准模式
    PRO = "pro"   # 专家/高品质模式


class AspectRatio(str, Enum):
    """画面纵横比"""
    R_16_9 = "16:9"
    R_9_16 = "9:16"
    R_1_1 = "1:1"
    R_4_3 = "4:3"
    R_3_4 = "3:4"
    R_3_2 = "3:2"
    R_2_3 = "2:3"
    R_21_9 = "21:9"
    AUTO = "auto"  # 仅 Omni-Image 支持


class CameraControlType(str, Enum):
    """运镜控制类型"""
    SIMPLE = "simple"
    DOWN_BACK = "down_back"
    FORWARD_UP = "forward_up"
    RIGHT_TURN_FORWARD = "right_turn_forward"
    LEFT_TURN_FORWARD = "left_turn_forward"


class TaskStatus(str, Enum):
    """任务状态"""
    SUBMITTED = "submitted"    # 已提交
    PROCESSING = "processing"  # 处理中
    SUCCEED = "succeed"        # 成功
    FAILED = "failed"          # 失败


class Duration(str, Enum):
    """视频时长"""
    FIVE = "5"
    TEN = "10"


# ============================================
# 通用验证器
# ============================================

def clean_base64_field(v: Optional[str]) -> Optional[str]:
    """
    清洗 Base64 字段
    
    移除 data:xxx;base64, 前缀，API 要求纯 Base64 或 URL
    """
    if v and isinstance(v, str) and v.startswith('data:'):
        parts = v.split(',', 1)
        if len(parts) == 2:
            return parts[1]
    return v


# ============================================
# 复杂对象模型
# ============================================

class CameraControlConfig(BaseModel):
    """
    运镜控制配置
    
    6 个参数选其一填值，其余必须为 0，范围 [-10, 10]
    """
    horizontal: float = Field(0, ge=-10, le=10, description="水平平移（负左正右）")
    vertical: float = Field(0, ge=-10, le=10, description="垂直平移（负下正上）")
    pan: float = Field(0, ge=-10, le=10, description="水平摇镜（绕y轴旋转）")
    tilt: float = Field(0, ge=-10, le=10, description="垂直摇镜（沿x轴旋转）")
    roll: float = Field(0, ge=-10, le=10, description="旋转运镜（绕z轴旋转）")
    zoom: float = Field(0, ge=-10, le=10, description="变焦（负长焦，正短焦）")

    @model_validator(mode='after')
    def check_at_least_one_nonzero(self):
        """确保至少有一个非零值"""
        if all(getattr(self, field) == 0 for field in self.model_fields):
            raise ValueError("camera_control.config 必须有至少一个非零字段")
        return self


class CameraControl(BaseModel):
    """运镜控制"""
    type: CameraControlType = Field(..., description="运镜类型")
    config: Optional[CameraControlConfig] = Field(None, description="运镜配置")

    @model_validator(mode='after')
    def check_config_required(self):
        """当 type=simple 时，config 必填"""
        if self.type == CameraControlType.SIMPLE and not self.config:
            raise ValueError("当 type 为 simple 时，config 是必填的")
        return self


# ============================================
# 视频生成请求模型
# ============================================

class Text2VideoRequest(BaseModel):
    """
    文生视频请求
    
    API: POST /v1/videos/text2video
    """
    prompt: str = Field(..., max_length=2500, description="正向提示词")
    negative_prompt: Optional[str] = Field(None, max_length=2500, description="负向提示词")
    model_name: Optional[str] = Field("kling-v2-6", description="模型版本")
    cfg_scale: Optional[float] = Field(0.5, ge=0, le=1, description="提示词相关性")
    mode: Optional[Mode] = Field(Mode.STD, description="生成模式")
    aspect_ratio: Optional[AspectRatio] = Field(AspectRatio.R_16_9, description="画面比例")
    duration: Optional[str] = Field("5", description="视频时长(秒)")
    sound: Optional[str] = Field("off", description="是否生成声音(on/off)")
    camera_control: Optional[CameraControl] = Field(None, description="运镜控制")
    external_task_id: Optional[str] = Field(None, description="自定义任务ID")
    callback_url: Optional[str] = Field(None, description="回调通知地址")


class Image2VideoRequest(BaseModel):
    """
    图生视频请求
    
    API: POST /v1/videos/image2video
    """
    image: str = Field(..., description="源图片 URL 或 Base64")
    image_tail: Optional[str] = Field(None, description="尾帧图片（首尾帧模式）")
    prompt: Optional[str] = Field(None, max_length=2500, description="运动描述提示词")
    negative_prompt: Optional[str] = Field(None, max_length=2500, description="负向提示词")
    model_name: Optional[str] = Field("kling-v2-5-turbo", description="模型版本")
    cfg_scale: Optional[float] = Field(0.5, ge=0, le=1, description="提示词相关性")
    mode: Optional[Mode] = Field(Mode.STD, description="生成模式")
    duration: Optional[str] = Field("5", description="视频时长(秒)")
    aspect_ratio: Optional[AspectRatio] = Field(AspectRatio.R_16_9, description="画面比例")
    camera_control: Optional[CameraControl] = Field(None, description="运镜控制")
    external_task_id: Optional[str] = Field(None, description="自定义任务ID")
    callback_url: Optional[str] = Field(None, description="回调通知地址")

    @field_validator('image', 'image_tail')
    @classmethod
    def validate_base64(cls, v):
        """清洗 Base64 前缀"""
        return clean_base64_field(v)


class MultiImage2VideoRequest(BaseModel):
    """
    多图生视频请求
    
    API: POST /v1/videos/multi-image2video
    支持 1-4 张参考图
    """
    image_list: List[str] = Field(..., min_length=1, max_length=4, description="图片列表")
    prompt: str = Field(..., max_length=2500, description="正向提示词")
    negative_prompt: Optional[str] = Field(None, max_length=2500, description="负向提示词")
    model_name: Optional[str] = Field("kling-v1-6", description="模型版本(仅支持v1-6)")
    mode: Optional[Mode] = Field(Mode.STD, description="生成模式")
    duration: Optional[str] = Field("5", description="视频时长(秒)")
    aspect_ratio: Optional[AspectRatio] = Field(AspectRatio.R_16_9, description="画面比例")
    external_task_id: Optional[str] = Field(None, description="自定义任务ID")
    callback_url: Optional[str] = Field(None, description="回调通知地址")

    @field_validator('image_list')
    @classmethod
    def validate_image_list(cls, v):
        """清洗所有图片的 Base64 前缀"""
        return [clean_base64_field(img) for img in v]


class MotionControlRequest(BaseModel):
    """
    动作控制请求
    
    API: POST /v1/videos/motion-control
    让图片中的角色执行参考视频中的动作
    """
    image_url: str = Field(..., description="参考图像 URL 或 Base64")
    video_url: str = Field(..., description="动作视频 URL")
    character_orientation: str = Field(..., description="人物朝向: image/video")
    mode: Mode = Field(Mode.STD, description="生成模式")
    prompt: Optional[str] = Field(None, max_length=2500, description="辅助描述")
    keep_original_sound: Optional[str] = Field("yes", description="是否保留原声(yes/no)")
    external_task_id: Optional[str] = Field(None, description="自定义任务ID")
    callback_url: Optional[str] = Field(None, description="回调通知地址")

    @field_validator('image_url')
    @classmethod
    def validate_image(cls, v):
        """清洗 Base64 前缀"""
        return clean_base64_field(v)


class VideoExtendRequest(BaseModel):
    """
    视频延长请求
    
    API: POST /v1/videos/video-extend
    单次延长 4-5 秒，总时长上限 3 分钟
    """
    video_id: str = Field(..., description="待延长的视频ID")
    prompt: Optional[str] = Field(None, max_length=2500, description="续写提示词")
    negative_prompt: Optional[str] = Field(None, max_length=2500, description="负向提示词")
    cfg_scale: Optional[float] = Field(0.5, ge=0, le=1, description="提示词相关性")
    callback_url: Optional[str] = Field(None, description="回调通知地址")


# ============================================
# 口型同步请求模型
# ============================================

class IdentifyFaceRequest(BaseModel):
    """
    人脸识别请求 - 对口型第一步
    
    API: POST /v1/videos/identify-face
    """
    video_id: Optional[str] = Field(None, description="可灵生成的视频ID")
    video_url: Optional[str] = Field(None, description="视频 URL")

    @model_validator(mode='after')
    def check_video_source(self):
        """video_id 和 video_url 必须二选一"""
        if not self.video_id and not self.video_url:
            raise ValueError("video_id 和 video_url 必须提供一个")
        if self.video_id and self.video_url:
            raise ValueError("video_id 和 video_url 不能同时提供")
        return self


class FaceChoose(BaseModel):
    """人脸选择配置"""
    face_id: str = Field(..., description="人脸ID")
    audio_id: Optional[str] = Field(None, description="可灵生成的音频ID")
    sound_file: Optional[str] = Field(None, description="音频 URL 或 Base64")
    sound_start_time: int = Field(0, ge=0, description="音频裁剪起点(ms)")
    sound_end_time: int = Field(..., description="音频裁剪终点(ms)")
    sound_insert_time: int = Field(0, ge=0, description="音频插入视频的时间(ms)")
    sound_volume: float = Field(1.0, ge=0, le=2, description="音频音量")
    original_audio_volume: float = Field(1.0, ge=0, le=2, description="原视频音量")

    @field_validator('sound_file')
    @classmethod
    def validate_sound_file(cls, v):
        """清洗 Base64 前缀"""
        return clean_base64_field(v)


class LipSyncRequest(BaseModel):
    """
    创建对口型任务请求 - 第二步
    
    API: POST /v1/videos/advanced-lip-sync
    """
    session_id: str = Field(..., description="人脸识别返回的会话ID")
    face_choose: List[FaceChoose] = Field(..., description="人脸配置列表")
    external_task_id: Optional[str] = Field(None, description="自定义任务ID")
    callback_url: Optional[str] = Field(None, description="回调通知地址")


# ============================================
# 图像生成请求模型
# ============================================

class GenerateImageRequest(BaseModel):
    """
    标准图像生成请求
    
    API: POST /v1/images/generations
    支持文生图和图生图
    """
    prompt: str = Field(..., max_length=2500, description="正向提示词")
    negative_prompt: Optional[str] = Field(None, max_length=2500, description="负向提示词")
    model_name: Optional[str] = Field("kling-v1", description="模型版本")
    image: Optional[str] = Field(None, description="参考图像 URL 或 Base64")
    image_reference: Optional[str] = Field(None, description="参考类型: subject/face")
    image_fidelity: Optional[float] = Field(0.5, ge=0, le=1, description="图片参考强度")
    human_fidelity: Optional[float] = Field(0.45, ge=0, le=1, description="五官相似度")
    resolution: Optional[str] = Field("1k", description="清晰度: 1k/2k")
    aspect_ratio: Optional[AspectRatio] = Field(AspectRatio.R_16_9, description="画面比例")
    n: Optional[int] = Field(1, ge=1, le=9, description="生成数量")
    callback_url: Optional[str] = Field(None, description="回调通知地址")

    @field_validator('image')
    @classmethod
    def validate_image(cls, v):
        """清洗 Base64 前缀"""
        return clean_base64_field(v)


class OmniImageRequest(BaseModel):
    """
    Omni-Image (O1) 高级图像生成请求
    
    API: POST /v1/images/omni-image
    支持多图参考和 <<<image_1>>> 语法
    """
    prompt: str = Field(..., max_length=2500, description="提示词，支持<<<image_N>>>引用")
    model_name: Optional[str] = Field("kling-image-o1", description="模型版本")
    image_list: Optional[List[str]] = Field(None, description="参考图列表")
    element_list: Optional[List[Any]] = Field(None, description="主体参考列表")
    resolution: Optional[str] = Field("1k", description="清晰度: 1k/2k")
    aspect_ratio: Optional[AspectRatio] = Field(AspectRatio.AUTO, description="画面比例")
    n: Optional[int] = Field(1, ge=1, le=9, description="生成数量")
    external_task_id: Optional[str] = Field(None, description="自定义任务ID")
    callback_url: Optional[str] = Field(None, description="回调通知地址")

    @field_validator('image_list')
    @classmethod
    def validate_image_list(cls, v):
        """清洗所有图片的 Base64 前缀"""
        if v:
            return [clean_base64_field(img) for img in v]
        return v


# ============================================
# 多元素视频编辑请求模型
# ============================================

class MultiElementsRequest(BaseModel):
    """
    多模态视频编辑请求
    
    API: POST /v1/videos/multi-elements
    """
    video_url: str = Field(..., description="源视频 URL")
    elements: List[Dict[str, Any]] = Field(..., description="编辑元素列表")
    callback_url: Optional[str] = Field(None, description="回调通知地址")


# ============================================
# 响应模型
# ============================================

class TaskResponse(BaseModel):
    """统一任务响应"""
    task_id: str = Field(..., description="任务ID")
    message: str = Field("success", description="响应消息")
    raw_data: Dict[str, Any] = Field(default_factory=dict, description="原始响应数据")


class VideoResult(BaseModel):
    """视频结果"""
    id: str = Field(..., description="视频ID")
    url: str = Field(..., description="视频URL（有效期30天）")
    duration: str = Field(..., description="视频时长(秒)")


class ImageResult(BaseModel):
    """图像结果"""
    index: int = Field(..., description="图片索引")
    url: str = Field(..., description="图片URL（有效期30天）")


class TaskQueryResponse(BaseModel):
    """任务查询响应"""
    task_id: str = Field(..., description="任务ID")
    task_status: TaskStatus = Field(..., description="任务状态")
    task_status_msg: Optional[str] = Field(None, description="失败原因")
    task_result: Optional[Dict[str, Any]] = Field(None, description="任务结果")
    created_at: Optional[int] = Field(None, description="创建时间戳")
    updated_at: Optional[int] = Field(None, description="更新时间戳")


class FaceIdentifyResponse(BaseModel):
    """人脸识别响应"""
    session_id: str = Field(..., description="会话ID")
    face_data: List[Dict[str, Any]] = Field(..., description="人脸数据列表")


# ============================================
# 内部使用的简化请求模型（保持向后兼容）
# ============================================

class SimpleLipSyncRequest(BaseModel):
    """简化版口型同步请求（前端用）"""
    video_url: str = Field(..., description="原始视频 URL")
    audio_url: str = Field(..., description="目标音频 URL")
    face_index: int = Field(0, ge=0, description="多人脸时选择第几张脸")
    sound_volume: float = Field(1.0, ge=0, le=2, description="音频音量")
    original_audio_volume: float = Field(1.0, ge=0, le=2, description="原视频音量")


class SimpleText2VideoRequest(BaseModel):
    """简化版文生视频请求（前端用）"""
    prompt: str = Field(..., min_length=1, max_length=2500, description="正向提示词")
    negative_prompt: str = Field("", max_length=2500, description="负向提示词")
    model_name: str = Field("kling-v2-6", description="模型版本")
    duration: str = Field("5", description="视频时长: 5/10")
    aspect_ratio: str = Field("16:9", description="宽高比")
    cfg_scale: float = Field(0.5, ge=0, le=1, description="提示词相关性")


class SimpleImage2VideoRequest(BaseModel):
    """简化版图生视频请求（前端用）"""
    image: str = Field(..., description="源图片 URL 或 Base64")
    prompt: str = Field("", max_length=2500, description="运动描述提示词")
    negative_prompt: str = Field("", description="负向提示词")
    model_name: str = Field("kling-v2-5-turbo", description="模型版本")
    duration: str = Field("5", description="视频时长: 5/10")
    cfg_scale: float = Field(0.5, ge=0, le=1, description="提示词相关性")

    @field_validator('image')
    @classmethod
    def validate_image(cls, v):
        """清洗 Base64 前缀"""
        return clean_base64_field(v)
