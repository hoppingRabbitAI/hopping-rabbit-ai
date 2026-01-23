"""
HoppingRabbit AI - 任务模块
导出所有 Celery 任务
"""

# 导入各任务模块
from . import transcribe
from . import export
from . import smart_clean
from . import stem_separation
from . import diarization
from . import asset_processing
from . import lip_sync  # AI 口型同步
from . import text_to_video  # AI 文生视频
from . import image_to_video  # AI 图生视频
from . import multi_image_to_video  # AI 多图生视频
from . import motion_control  # AI 动作控制
from . import multi_elements  # AI 多模态视频编辑
from . import video_extend  # AI 视频延长
from . import image_generation  # AI 图像生成
from . import omni_image  # AI Omni-Image (O1)
from . import face_swap  # AI 换脸

# 导出任务函数（便于直接调用）
__all__ = [
    # ASR 语音识别
    "transcribe",
    
    # 视频导出
    "export",
    
    # 智能清理
    "smart_clean",
    
    # 人声分离
    "stem_separation",
    
    # 说话人分离
    "diarization",
    
    # 资源处理
    "asset_processing",

    # AI 智能剪辑
    "ai_editing",
    
    # AI 口型同步
    "lip_sync",
    
    # AI 文生视频
    "text_to_video",
    
    # AI 图生视频
    "image_to_video",
    
    # AI 多图生视频
    "multi_image_to_video",
    
    # AI 动作控制
    "motion_control",
    
    # AI 多模态视频编辑
    "multi_elements",
    
    # AI 视频延长
    "video_extend",
    
    # AI 图像生成
    "image_generation",
    
    # AI Omni-Image (O1)
    "omni_image",
    
    # AI 换脸
    "face_swap",
]

