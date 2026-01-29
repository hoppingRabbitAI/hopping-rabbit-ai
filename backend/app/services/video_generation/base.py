"""
HoppingRabbit AI - 视频生成抽象基类

定义统一接口，所有提供商实现此接口
"""

from abc import ABC, abstractmethod
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class TaskStatus(str, Enum):
    """任务状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class VideoTask(BaseModel):
    """视频任务"""
    task_id: str = Field(..., description="任务ID")
    provider: str = Field(..., description="提供商")
    model: str = Field(..., description="模型名称")
    status: TaskStatus = Field(TaskStatus.PENDING, description="任务状态")
    progress: int = Field(0, ge=0, le=100, description="进度百分比")
    message: Optional[str] = Field(None, description="状态消息")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # 提供商原始数据
    provider_task_id: Optional[str] = Field(None, description="提供商任务ID")
    raw_response: Optional[Dict[str, Any]] = Field(None, description="原始响应")


class VideoResult(BaseModel):
    """视频结果"""
    video_url: str = Field(..., description="视频URL")
    video_id: Optional[str] = Field(None, description="视频ID")
    duration: Optional[float] = Field(None, description="时长(秒)")
    width: Optional[int] = Field(None, description="宽度")
    height: Optional[int] = Field(None, description="高度")
    thumbnail_url: Optional[str] = Field(None, description="缩略图URL")
    
    # 元数据
    provider: str = Field(..., description="提供商")
    model: str = Field(..., description="模型名称")
    expires_at: Optional[datetime] = Field(None, description="URL过期时间")


class ModelInfo(BaseModel):
    """模型信息"""
    id: str = Field(..., description="模型ID (如 kling-v2-1-master)")
    name: str = Field(..., description="显示名称")
    provider: str = Field(..., description="提供商")
    
    # 能力
    capabilities: List[str] = Field(
        default_factory=list,
        description="支持的能力: text2video, image2video, video_extend, lip_sync"
    )
    
    # 参数限制
    max_duration: int = Field(10, description="最大时长(秒)")
    aspect_ratios: List[str] = Field(
        default_factory=lambda: ["16:9", "9:16", "1:1"],
        description="支持的宽高比"
    )
    
    # 计费
    credits_per_generation: int = Field(100, description="每次生成消耗积分")
    
    # 状态
    is_available: bool = Field(True, description="是否可用")
    is_beta: bool = Field(False, description="是否测试版")
    
    # 描述
    description: Optional[str] = Field(None, description="模型描述")
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": "kling-v2-1-master",
                "name": "Kling V2.1 Master",
                "provider": "kling",
                "capabilities": ["text2video", "image2video"],
                "max_duration": 10,
                "aspect_ratios": ["16:9", "9:16", "1:1"],
                "credits_per_generation": 200,
                "is_available": True,
                "description": "可灵 V2.1 高品质视频生成"
            }
        }


class VideoGeneratorBase(ABC):
    """
    视频生成器抽象基类
    
    所有提供商（Kling, Veo, Runway 等）都需要实现此接口
    """
    
    # 提供商标识
    PROVIDER: str = "base"
    
    @abstractmethod
    async def text_to_video(
        self,
        prompt: str,
        model: str,
        duration: int = 5,
        aspect_ratio: str = "16:9",
        **options
    ) -> VideoTask:
        """
        文生视频
        
        Args:
            prompt: 提示词
            model: 模型名称
            duration: 时长(秒)
            aspect_ratio: 宽高比
            **options: 其他参数
        
        Returns:
            VideoTask: 任务信息
        """
        pass
    
    @abstractmethod
    async def image_to_video(
        self,
        image: str,
        model: str,
        prompt: str = "",
        duration: int = 5,
        **options
    ) -> VideoTask:
        """
        图生视频
        
        Args:
            image: 图片 URL 或 Base64
            model: 模型名称
            prompt: 运动提示词
            duration: 时长(秒)
            **options: 其他参数
        
        Returns:
            VideoTask: 任务信息
        """
        pass
    
    @abstractmethod
    async def get_task_status(self, task_id: str, model: str) -> VideoTask:
        """
        查询任务状态
        
        Args:
            task_id: 任务ID (提供商的)
            model: 模型名称 (用于确定查询端点)
        
        Returns:
            VideoTask: 任务信息
        """
        pass
    
    @abstractmethod
    async def get_result(self, task_id: str, model: str) -> Optional[VideoResult]:
        """
        获取任务结果
        
        Args:
            task_id: 任务ID
            model: 模型名称
        
        Returns:
            VideoResult: 结果（如果完成）
        """
        pass
    
    @classmethod
    @abstractmethod
    def get_supported_models(cls) -> List[ModelInfo]:
        """
        获取支持的模型列表
        
        Returns:
            List[ModelInfo]: 模型信息列表
        """
        pass
    
    async def close(self):
        """关闭客户端连接（可选实现）"""
        pass
