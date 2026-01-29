"""
HoppingRabbit AI - Kling AI 视频生成器

实现 VideoGeneratorBase 接口
"""

import logging
from typing import Optional, List
from datetime import datetime, timedelta

from .base import (
    VideoGeneratorBase,
    VideoTask,
    VideoResult,
    ModelInfo,
    TaskStatus,
)
# 直接从文件导入，避免触发 services/__init__.py 中的 langchain 依赖
from app.services.kling_client import get_kling_client

logger = logging.getLogger(__name__)


class KlingVideoGenerator(VideoGeneratorBase):
    """
    Kling AI 视频生成器
    
    支持的模型:
    - kling-v1, kling-v1-5, kling-v1-6
    - kling-v2, kling-v2-1-master, kling-v2-5-turbo, kling-v2-6
    - kling-video-o1
    """
    
    PROVIDER = "kling"
    
    # 模型到端点的映射
    MODEL_ENDPOINTS = {
        "text2video": "/videos/text2video",
        "image2video": "/videos/image2video",
        "multi_image2video": "/videos/multi-image2video",
        "video_extend": "/videos/video-extend",
        "lip_sync": "/videos/advanced-lip-sync",
    }
    
    def __init__(self):
        self.client = get_kling_client()
    
    async def text_to_video(
        self,
        prompt: str,
        model: str = "kling-v2-1-master",
        duration: int = 5,
        aspect_ratio: str = "16:9",
        **options
    ) -> VideoTask:
        """文生视频"""
        
        data = {
            "prompt": prompt,
            "model_name": model,
            "duration": str(duration),
            "aspect_ratio": aspect_ratio,
        }
        
        # 可选参数
        if options.get("negative_prompt"):
            data["negative_prompt"] = options["negative_prompt"]
        if options.get("cfg_scale") is not None:
            data["cfg_scale"] = options["cfg_scale"]
        if options.get("mode"):
            data["mode"] = options["mode"]
        if options.get("camera_control"):
            data["camera_control"] = options["camera_control"]
        if options.get("callback_url"):
            data["callback_url"] = options["callback_url"]
        
        logger.info(f"[KlingGenerator] 文生视频: model={model}, prompt={prompt[:50]}...")
        
        response = await self.client.create_text2video(data)
        
        if response.get("code") != 0:
            raise Exception(response.get("message", "Unknown error"))
        
        task_data = response.get("data", {})
        
        return VideoTask(
            task_id=task_data.get("task_id", ""),
            provider=self.PROVIDER,
            model=model,
            status=self._map_status(task_data.get("task_status", "submitted")),
            provider_task_id=task_data.get("task_id"),
            raw_response=task_data,
        )
    
    async def image_to_video(
        self,
        image: str,
        model: str = "kling-v2-5-turbo",
        prompt: str = "",
        duration: int = 5,
        **options
    ) -> VideoTask:
        """图生视频"""
        
        data = {
            "image": image,
            "model_name": model,
            "duration": str(duration),
        }
        
        if prompt:
            data["prompt"] = prompt
        if options.get("negative_prompt"):
            data["negative_prompt"] = options["negative_prompt"]
        if options.get("image_tail"):
            data["image_tail"] = options["image_tail"]
        if options.get("cfg_scale") is not None:
            data["cfg_scale"] = options["cfg_scale"]
        if options.get("aspect_ratio"):
            data["aspect_ratio"] = options["aspect_ratio"]
        if options.get("callback_url"):
            data["callback_url"] = options["callback_url"]
        
        logger.info(f"[KlingGenerator] 图生视频: model={model}")
        
        response = await self.client.create_image2video(data)
        
        if response.get("code") != 0:
            raise Exception(response.get("message", "Unknown error"))
        
        task_data = response.get("data", {})
        
        return VideoTask(
            task_id=task_data.get("task_id", ""),
            provider=self.PROVIDER,
            model=model,
            status=self._map_status(task_data.get("task_status", "submitted")),
            provider_task_id=task_data.get("task_id"),
            raw_response=task_data,
        )
    
    async def get_task_status(self, task_id: str, model: str) -> VideoTask:
        """查询任务状态"""
        
        # 根据模型确定端点
        # 大多数模型都是 text2video 或 image2video
        # 这里简化处理，尝试 text2video 端点
        try:
            response = await self.client.get_text2video_task(task_id)
        except Exception:
            # 如果失败，尝试 image2video
            response = await self.client.get_image2video_task(task_id)
        
        if response.get("code") != 0:
            raise Exception(response.get("message", "Unknown error"))
        
        task_data = response.get("data", {})
        
        return VideoTask(
            task_id=task_id,
            provider=self.PROVIDER,
            model=model,
            status=self._map_status(task_data.get("task_status", "unknown")),
            message=task_data.get("task_status_msg"),
            provider_task_id=task_id,
            raw_response=task_data,
        )
    
    async def get_result(self, task_id: str, model: str) -> Optional[VideoResult]:
        """获取任务结果"""
        
        task = await self.get_task_status(task_id, model)
        
        if task.status != TaskStatus.COMPLETED:
            return None
        
        task_result = task.raw_response.get("task_result", {})
        videos = task_result.get("videos", [])
        
        if not videos:
            return None
        
        video = videos[0]
        
        return VideoResult(
            video_url=video.get("url", ""),
            video_id=video.get("id"),
            duration=float(video.get("duration", 0)) if video.get("duration") else None,
            provider=self.PROVIDER,
            model=model,
            expires_at=datetime.utcnow() + timedelta(days=30),  # Kling 视频有效期 30 天
        )
    
    @classmethod
    def get_supported_models(cls) -> List[ModelInfo]:
        """获取支持的模型列表"""
        
        return [
            # V2 系列 (推荐)
            ModelInfo(
                id="kling-v2-1-master",
                name="Kling V2.1 Master",
                provider="kling",
                capabilities=["text2video", "image2video"],
                max_duration=10,
                aspect_ratios=["16:9", "9:16", "1:1"],
                credits_per_generation=200,
                description="可灵 V2.1 高品质视频生成，推荐使用",
            ),
            ModelInfo(
                id="kling-v2-5-turbo",
                name="Kling V2.5 Turbo",
                provider="kling",
                capabilities=["text2video", "image2video", "multi_image2video"],
                max_duration=10,
                aspect_ratios=["16:9", "9:16", "1:1"],
                credits_per_generation=150,
                description="可灵 V2.5 快速版，支持首尾帧模式",
            ),
            ModelInfo(
                id="kling-v2-6",
                name="Kling V2.6",
                provider="kling",
                capabilities=["text2video", "image2video"],
                max_duration=10,
                aspect_ratios=["16:9", "9:16", "1:1"],
                credits_per_generation=180,
                description="可灵 V2.6，支持生成声音",
            ),
            ModelInfo(
                id="kling-video-o1",
                name="Kling Video O1",
                provider="kling",
                capabilities=["text2video"],
                max_duration=10,
                aspect_ratios=["16:9", "9:16", "1:1"],
                credits_per_generation=250,
                is_beta=True,
                description="可灵 O1 模型，最高品质",
            ),
            # V1 系列 (兼容)
            ModelInfo(
                id="kling-v1-6",
                name="Kling V1.6",
                provider="kling",
                capabilities=["text2video", "image2video", "multi_image2video", "motion_control"],
                max_duration=10,
                aspect_ratios=["16:9", "9:16", "1:1"],
                credits_per_generation=100,
                description="可灵 V1.6，支持动作控制",
            ),
            ModelInfo(
                id="kling-v1",
                name="Kling V1",
                provider="kling",
                capabilities=["text2video", "image2video"],
                max_duration=10,
                aspect_ratios=["16:9", "9:16", "1:1"],
                credits_per_generation=80,
                description="可灵基础版",
            ),
        ]
    
    def _map_status(self, kling_status: str) -> TaskStatus:
        """映射 Kling 状态到统一状态"""
        mapping = {
            "submitted": TaskStatus.PENDING,
            "processing": TaskStatus.PROCESSING,
            "succeed": TaskStatus.COMPLETED,
            "failed": TaskStatus.FAILED,
        }
        return mapping.get(kling_status, TaskStatus.PENDING)
    
    async def close(self):
        """关闭客户端"""
        await self.client.close()


# 单例
_kling_generator: Optional[KlingVideoGenerator] = None


def get_kling_generator() -> KlingVideoGenerator:
    """获取 Kling 生成器单例"""
    global _kling_generator
    if _kling_generator is None:
        _kling_generator = KlingVideoGenerator()
    return _kling_generator
