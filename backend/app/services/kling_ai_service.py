"""
Lepus AI - 可灵AI API 集成服务
专注于口播场景的 AI 视频生成能力

可灵AI 主要能力（口播相关）：
1. 口型同步 (Lip Sync) - 数字人/换脸口播
2. 文生视频 - 生成口播背景、B-roll 素材
3. 图生视频 - 产品图动态化
4. 视频续写 - 延长素材时长
5. 表情/动作迁移 - 批量生成不同版本

API 文档: https://platform.klingai.com/docs/api

注意: 
- 底层 HTTP 客户端已迁移到 kling_client.py (单例模式，连接复用)
- Pydantic 模型定义在 schemas/kling.py
- 本文件保留业务服务层逻辑
"""

import os
import uuid
import asyncio
import httpx
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum

# 导入新的客户端（推荐使用）
from .kling_client import get_kling_client, KlingClient, close_kling_client

logger = logging.getLogger(__name__)


# ============================================
# 配置
# ============================================

class KlingConfig:
    """可灵AI API 配置"""
    
    # 从环境变量读取
    API_KEY = os.getenv("KLING_API_KEY", "")
    API_SECRET = os.getenv("KLING_API_SECRET", "")
    # 注意：正确的 Base URL 是 api-beijing.klingai.com
    BASE_URL = os.getenv("KLING_API_BASE_URL", "https://api-beijing.klingai.com/v1")
    
    # 超时配置（视频生成是异步的，需要轮询）
    REQUEST_TIMEOUT = 60  # 单次请求超时
    POLL_INTERVAL = 5     # 轮询间隔（秒）
    MAX_POLL_TIME = 600   # 最大等待时间（10分钟）

    # Prompt 长度限制（Kling API 要求 0~2500）
    PROMPT_MAX_LEN = 2500
    NEGATIVE_PROMPT_MAX_LEN = 2500


class TaskType(Enum):
    """可灵AI 任务类型"""
    TEXT_TO_VIDEO = "text2video"        # 文生视频
    IMAGE_TO_VIDEO = "image2video"      # 图生视频
    LIP_SYNC = "lipsync"                # 口型同步
    VIDEO_EXTEND = "video_extend"       # 视频续写
    FACE_SWAP = "face_swap"             # AI换脸
    EXPRESSION_TRANSFER = "expression"  # 表情迁移


class TaskStatus(Enum):
    """任务状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# ============================================
# 可灵AI 客户端
# ============================================

class KlingAIClient:
    """可灵AI API 客户端"""
    
    @staticmethod
    def _truncate_prompt(text: str, max_len: int = KlingConfig.PROMPT_MAX_LEN) -> str:
        """截断 prompt 到 API 允许的最大长度，在词边界处截断"""
        if not text or len(text) <= max_len:
            return text
        truncated = text[:max_len]
        # 尝试在最后一个空格/句号处截断，避免截断到词中间
        for sep in ['. ', ', ', ' ', '。', '，']:
            idx = truncated.rfind(sep)
            if idx > max_len * 0.8:
                truncated = truncated[:idx + len(sep)].rstrip()
                break
        logger.warning(f"[KlingAI] Prompt 超长 ({len(text)} chars)，已截断至 {len(truncated)} chars")
        return truncated

    def __init__(self, api_key: str = None, api_secret: str = None):
        self.api_key = api_key or KlingConfig.API_KEY
        self.api_secret = api_secret or KlingConfig.API_SECRET
        self.base_url = KlingConfig.BASE_URL
        
        if not self.api_key:
            logger.warning("[KlingAI] API Key 未配置，请设置 KLING_API_KEY 环境变量")
    
    def _generate_jwt_token(self) -> str:
        """生成 JWT 认证 token"""
        import jwt
        import time
        
        now = int(time.time())
        payload = {
            "iss": self.api_key,
            "exp": now + 1800,  # 30分钟后过期
            "nbf": now - 5,     # 5秒前开始生效
        }
        token = jwt.encode(payload, self.api_secret, algorithm="HS256")
        return token
    
    def _get_headers(self) -> Dict[str, str]:
        """获取请求头 - 使用 JWT 认证"""
        token = self._generate_jwt_token()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
    
    async def _request(
        self,
        method: str,
        endpoint: str,
        data: Dict = None,
        files: Dict = None
    ) -> Dict:
        """发送 API 请求"""
        url = f"{self.base_url}{endpoint}"
        
        async with httpx.AsyncClient(timeout=KlingConfig.REQUEST_TIMEOUT) as client:
            if method == "GET":
                response = await client.get(url, headers=self._get_headers())
            elif method == "POST":
                if files:
                    # 文件上传
                    response = await client.post(
                        url,
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        files=files,
                        data=data
                    )
                else:
                    response = await client.post(
                        url,
                        headers=self._get_headers(),
                        json=data
                    )
            else:
                raise ValueError(f"不支持的 HTTP 方法: {method}")
            
            # 处理错误响应，打印详细信息
            if response.status_code >= 400:
                error_text = response.text
                logger.error(f"[KlingAI] API 错误: {response.status_code} - {error_text}")
                logger.error(f"[KlingAI] 请求 URL: {url}")
                # 避免打印过长的 base64 数据
                safe_data = {k: (v[:100] + "..." if isinstance(v, str) and len(v) > 100 else v) for k, v in (data or {}).items()}
                logger.error(f"[KlingAI] 请求数据: {safe_data}")
                # ★ 尝试解析错误响应，提取更有用的错误信息
                kling_message = ""
                try:
                    error_json = response.json()
                    kling_code = error_json.get("code")
                    kling_message = error_json.get("message", "")
                    logger.error(f"[KlingAI] Kling 错误码: {kling_code}, 消息: {kling_message}")
                except Exception:
                    pass
                # 抛出包含详细信息的异常
                raise ValueError(f"Kling API 错误 ({response.status_code}): {kling_message or error_text[:200]}")
            
            return response.json()
    
    # ========================================
    # 口型同步 (Lip Sync) - 口播核心功能
    # ========================================
    
    async def identify_face(
        self,
        video_url: str = None,
        video_id: str = None
    ) -> Dict:
        """
        人脸识别 - 对口型第一步
        
        识别视频中的人脸，返回 session_id 和可对口型的人脸列表
        
        Args:
            video_url: 视频 URL（与 video_id 二选一）
            video_id: 可灵生成的视频 ID（与 video_url 二选一）
        
        Returns:
            {
                "session_id": "xxx",
                "face_data": [
                    {
                        "face_id": "xxx",
                        "face_image": "url",
                        "start_time": 0,
                        "end_time": 5200
                    }
                ]
            }
        """
        if not video_url and not video_id:
            raise ValueError("video_url 和 video_id 必须提供一个")
        
        payload = {}
        if video_url:
            payload["video_url"] = video_url
        if video_id:
            payload["video_id"] = video_id
        
        logger.info(f"[KlingAI] 人脸识别: video_url={video_url or 'N/A'}, video_id={video_id or 'N/A'}")
        
        result = await self._request("POST", "/videos/identify-face", payload)
        return result.get("data", {})
    
    async def create_lip_sync_task(
        self,
        session_id: str,
        face_id: str,
        audio_url: str = None,
        audio_id: str = None,
        sound_start_time: int = 0,
        sound_end_time: int = None,
        sound_insert_time: int = 0,
        sound_volume: float = 1.0,
        original_audio_volume: float = 1.0,
        external_task_id: str = None,
        callback_url: str = None
    ) -> Dict:
        """
        创建对口型任务 - 第二步
        
        基于人脸识别结果创建对口型任务
        
        Args:
            session_id: 人脸识别返回的会话 ID
            face_id: 要对口型的人脸 ID
            audio_url: 音频 URL（与 audio_id 二选一）
            audio_id: 可灵生成的音频 ID（与 audio_url 二选一）
            sound_start_time: 音频裁剪起点时间(ms)
            sound_end_time: 音频裁剪终点时间(ms)
            sound_insert_time: 裁剪后音频插入视频的时间(ms)
            sound_volume: 音频音量 [0, 2]
            original_audio_volume: 原始视频音量 [0, 2]
            external_task_id: 自定义任务 ID
            callback_url: 回调通知地址
        
        Returns:
            {"task_id": "xxx", "task_status": "submitted", ...}
        """
        if not audio_url and not audio_id:
            raise ValueError("audio_url 和 audio_id 必须提供一个")
        
        # 构建 face_choose
        face_choose = {
            "face_id": face_id,
            "sound_start_time": sound_start_time,
            "sound_end_time": sound_end_time,
            "sound_insert_time": sound_insert_time,
            "sound_volume": sound_volume,
            "original_audio_volume": original_audio_volume,
        }
        
        if audio_url:
            face_choose["sound_file"] = audio_url
        if audio_id:
            face_choose["audio_id"] = audio_id
        
        payload = {
            "session_id": session_id,
            "face_choose": [face_choose]  # 数组形式
        }
        
        if external_task_id:
            payload["external_task_id"] = external_task_id
        if callback_url:
            payload["callback_url"] = callback_url
        
        logger.info(f"[KlingAI] 创建对口型任务: session_id={session_id}, face_id={face_id}")
        
        result = await self._request("POST", "/videos/advanced-lip-sync", payload)
        return result.get("data", {})
    
    async def get_lip_sync_task(self, task_id: str) -> Dict:
        """
        查询对口型任务状态
        
        Args:
            task_id: 任务 ID
        
        Returns:
            {
                "task_id": "xxx",
                "task_status": "submitted/processing/succeed/failed",
                "task_result": {
                    "videos": [{"id": "xxx", "url": "xxx", "duration": "5"}]
                }
            }
        """
        logger.info(f"[KlingAI] 查询对口型任务: task_id={task_id}")
        
        result = await self._request("GET", f"/videos/advanced-lip-sync/{task_id}")
        return result.get("data", {})
    
    # ========================================
    # 文生视频 - 口播背景/B-roll 素材
    # 官方文档: https://app.klingai.com/cn/dev/document-api/apiReference/model/textToVideo
    # ========================================
    
    async def create_text_to_video_task(
        self,
        prompt: str,
        negative_prompt: str = "",
        options: Dict = None
    ) -> Dict:
        """
        文生视频任务
        
        官方 API: POST /v1/videos/text2video
        
        口播场景应用：
        - 生成口播背景视频（循环播放）
        - 生成 B-roll 插入素材
        - 生成片头/片尾动画
        
        Args:
            prompt: 正向提示词（必填，不超过2500字符）
            negative_prompt: 负向提示词（可选，不超过2500字符）
            options: 可选参数
                - model_name: 模型版本 kling-v2-1-master/kling-video-o1/kling-v2-5-turbo/kling-v2-6 (默认 kling-v2-1-master)
                - duration: 视频时长 "5"/"10" 秒 (默认 "5")
                - aspect_ratio: 宽高比 "16:9"/"9:16"/"1:1" (默认 "16:9")
                - mode: 生成模式 "std"(标准)/"pro"(高品质) (默认 "std")
                - cfg_scale: 自由度 0-1，越大越贴近提示词 (默认 0.5)
                - sound: 是否生成声音 "on"/"off" (仅V2.6支持，默认 "off")
                - camera_control: 运镜控制 {type, config}
                - callback_url: 回调地址
                - external_task_id: 自定义任务ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed"
                }
            }
        """
        options = options or {}
        
        # 构建请求体
        payload = {
            "prompt": self._truncate_prompt(prompt),
        }
        
        # 可选参数
        if negative_prompt:
            payload["negative_prompt"] = self._truncate_prompt(negative_prompt, KlingConfig.NEGATIVE_PROMPT_MAX_LEN)
        
        if options.get("model_name"):
            payload["model_name"] = options["model_name"]
        
        if options.get("duration"):
            payload["duration"] = str(options["duration"])  # API要求字符串
        
        if options.get("aspect_ratio"):
            payload["aspect_ratio"] = options["aspect_ratio"]
        
        if options.get("mode"):
            payload["mode"] = options["mode"]
        
        if options.get("cfg_scale") is not None:
            payload["cfg_scale"] = options["cfg_scale"]
        
        if options.get("sound"):
            payload["sound"] = options["sound"]
        
        # 运镜控制
        if options.get("camera_control"):
            payload["camera_control"] = options["camera_control"]
        
        # 回调和自定义ID
        if options.get("callback_url"):
            payload["callback_url"] = options["callback_url"]
        
        if options.get("external_task_id"):
            payload["external_task_id"] = options["external_task_id"]
        
        logger.info(f"[KlingAI] 创建文生视频任务: prompt={prompt[:50]}...")
        
        result = await self._request("POST", "/videos/text2video", payload)
        return result
    
    async def get_text_to_video_task(self, task_id: str) -> Dict:
        """
        查询文生视频任务状态
        
        官方 API: GET /v1/videos/text2video/{task_id}
        
        Args:
            task_id: 任务 ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed",
                    "task_status_msg": "失败原因",
                    "task_result": {
                        "videos": [
                            {"id": "xxx", "url": "https://...", "duration": "5"}
                        ]
                    }
                }
            }
        """
        logger.info(f"[KlingAI] 查询文生视频任务: task_id={task_id}")
        
        result = await self._request("GET", f"/videos/text2video/{task_id}")
        return result
    
    # ========================================
    # 图生视频 - 产品展示动态化
    # 官方文档: https://app.klingai.com/cn/dev/document-api/apiReference/model/imageToVideo
    # ========================================
    
    async def create_image_to_video_task(
        self,
        image: str,
        prompt: str = "",
        options: Dict = None
    ) -> Dict:
        """
        图生视频任务
        
        官方 API: POST /v1/videos/image2video
        
        口播场景应用：
        - 产品图片动态展示
        - 静态素材动起来
        - 封面图生成预告片
        
        Args:
            image: 参考图像（必填）- URL 或 Base64 编码
            prompt: 正向提示词（可选，不超过2500字符）
            options: 可选参数
                - model_name: 模型版本 kling-v2-5-turbo/kling-v2-1-master/kling-v2-6 (默认 kling-v2-5-turbo)
                - image_tail: 尾帧图片（URL或Base64）用于控制结束帧
                - negative_prompt: 负向提示词
                - duration: 视频时长 "5"/"10" 秒 (默认 "5")
                - mode: 生成模式 "std"(标准)/"pro"(高品质) (默认 "std")
                - cfg_scale: 自由度 0-1，越大越贴近提示词 (默认 0.5)
                - sound: 是否生成声音 "on"/"off" (仅V2.6+支持，默认 "off")
                - voice_list: 音色列表 [{"voice_id": "xxx"}] (仅V2.6+支持)
                - camera_control: 运镜控制 {type, config}
                - static_mask: 静态笔刷蒙版图片 URL/Base64
                - dynamic_masks: 动态笔刷配置 [{mask, trajectories: [{x, y}]}]
                - callback_url: 回调地址
                - external_task_id: 自定义任务ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed"
                }
            }
        """
        options = options or {}
        
        # 清洗 data:xxx;base64, 前缀
        from app.schemas.kling import clean_base64_field
        
        # 构建请求体
        payload = {
            "image": clean_base64_field(image),  # 必填
        }
        
        # 可选参数
        if prompt:
            payload["prompt"] = self._truncate_prompt(prompt)
        
        if options.get("model_name"):
            payload["model_name"] = options["model_name"]
        
        if options.get("image_tail"):
            payload["image_tail"] = clean_base64_field(options["image_tail"])
        
        if options.get("negative_prompt"):
            payload["negative_prompt"] = self._truncate_prompt(options["negative_prompt"], KlingConfig.NEGATIVE_PROMPT_MAX_LEN)
        
        if options.get("duration"):
            payload["duration"] = str(options["duration"])  # API要求字符串
        
        if options.get("mode"):
            payload["mode"] = options["mode"]
        
        if options.get("cfg_scale") is not None:
            payload["cfg_scale"] = options["cfg_scale"]
        
        if options.get("sound"):
            payload["sound"] = options["sound"]
        
        if options.get("voice_list"):
            payload["voice_list"] = options["voice_list"]
        
        # 运镜控制（与 image_tail / static_mask / dynamic_masks 互斥）
        # ★ API 互斥约束: image+image_tail / camera_control / dynamic_masks+static_mask 三选一
        has_image_tail = "image_tail" in payload
        # ★ 验证 camera_control 格式：必须包含 type 字段
        if options.get("camera_control") and not has_image_tail:
            camera_control = options["camera_control"]
            if isinstance(camera_control, dict) and camera_control.get("type"):
                payload["camera_control"] = camera_control
            else:
                logger.warning(f"[KlingAI] camera_control 格式无效（缺少 type 字段），已忽略: {camera_control}")
        elif options.get("camera_control") and has_image_tail:
            logger.warning("[KlingAI] image_tail 与 camera_control 互斥，已忽略 camera_control")
        
        # 运动笔刷（与 camera_control / image_tail 互斥）
        if options.get("static_mask") and not has_image_tail:
            payload["static_mask"] = clean_base64_field(options["static_mask"])
        
        if options.get("dynamic_masks") and not has_image_tail:
            payload["dynamic_masks"] = options["dynamic_masks"]
        
        # 回调和自定义ID
        if options.get("callback_url"):
            payload["callback_url"] = options["callback_url"]
        
        if options.get("external_task_id"):
            payload["external_task_id"] = options["external_task_id"]
        
        logger.info(f"[KlingAI] 创建图生视频任务: image={image[:50] if len(image) > 50 else image}...")
        
        result = await self._request("POST", "/videos/image2video", payload)
        return result
    
    async def get_image_to_video_task(self, task_id: str) -> Dict:
        """
        查询图生视频任务状态
        
        官方 API: GET /v1/videos/image2video/{task_id}
        
        Args:
            task_id: 任务 ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed",
                    "task_status_msg": "失败原因",
                    "task_result": {
                        "videos": [
                            {"id": "xxx", "url": "https://...", "duration": "5"}
                        ]
                    }
                }
            }
        """
        logger.info(f"[KlingAI] 查询图生视频任务: task_id={task_id}")
        
        result = await self._request("GET", f"/videos/image2video/{task_id}")
        return result
    
    # ========================================
    # 多图生视频 - 多张图片参考生成视频
    # 官方文档: https://app.klingai.com/cn/dev/document-api/apiReference/model/multiImageToVideo
    # ========================================
    
    async def create_multi_image_to_video_task(
        self,
        image_list: List[str],
        prompt: str,
        options: Dict = None
    ) -> Dict:
        """
        多图参考生视频任务
        
        官方 API: POST /v1/videos/multi-image2video
        
        口播场景应用：
        - 多角度产品展示
        - 故事板转视频
        - 多素材融合生成
        
        Args:
            image_list: 图片列表（必填，最多4张）- URL 或 Base64 编码
            prompt: 正向提示词（必填，不超过2500字符）
            options: 可选参数
                - model_name: 模型版本 kling-v2-5-turbo (支持首尾帧)
                - negative_prompt: 负向提示词
                - duration: 视频时长 "5"/"10" 秒 (默认 "5")
                - aspect_ratio: 宽高比 "16:9"/"9:16"/"1:1" (默认 "16:9")
                - mode: 生成模式 "std"(标准)/"pro"(高品质) (默认 "std")
                - callback_url: 回调地址
                - external_task_id: 自定义任务ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed"
                }
            }
        """
        options = options or {}
        
        # 验证图片数量
        if not image_list or len(image_list) == 0:
            raise ValueError("image_list 不能为空")
        if len(image_list) > 4:
            raise ValueError("image_list 最多支持4张图片")
        
        # 构建 image_list 格式 - 清洗 data:xxx;base64, 前缀
        from app.schemas.kling import clean_base64_field
        formatted_image_list = [{"image": clean_base64_field(img)} for img in image_list]
        
        # 构建请求体
        payload = {
            "image_list": formatted_image_list,
            "prompt": self._truncate_prompt(prompt),  # 必填
        }
        
        # 可选参数 - multi-image2video 不传 model_name，使用 API 默认值
        # 注意：该接口可能只支持特定模型，不要传入 model_name 避免报错
        
        if options.get("negative_prompt"):
            payload["negative_prompt"] = self._truncate_prompt(options["negative_prompt"], KlingConfig.NEGATIVE_PROMPT_MAX_LEN)
        
        if options.get("duration"):
            payload["duration"] = str(options["duration"])
        
        if options.get("aspect_ratio"):
            payload["aspect_ratio"] = options["aspect_ratio"]
        
        if options.get("mode"):
            payload["mode"] = options["mode"]
        
        # 回调和自定义ID
        if options.get("callback_url"):
            payload["callback_url"] = options["callback_url"]
        
        if options.get("external_task_id"):
            payload["external_task_id"] = options["external_task_id"]
        
        logger.info(f"[KlingAI] 创建多图生视频任务: image_count={len(image_list)}, prompt={prompt[:50]}...")
        
        result = await self._request("POST", "/videos/multi-image2video", payload)
        return result
    
    async def get_multi_image_to_video_task(self, task_id: str) -> Dict:
        """
        查询多图生视频任务状态
        
        官方 API: GET /v1/videos/multi-image2video/{task_id}
        
        Args:
            task_id: 任务 ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed",
                    "task_status_msg": "失败原因",
                    "task_result": {
                        "videos": [
                            {"id": "xxx", "url": "https://...", "duration": "5"}
                        ]
                    }
                }
            }
        """
        logger.info(f"[KlingAI] 查询多图生视频任务: task_id={task_id}")
        
        result = await self._request("GET", f"/videos/multi-image2video/{task_id}")
        return result
    
    # ========================================
    # 动作控制 - 参考视频驱动图片人物动作
    # 官方文档: https://app.klingai.com/cn/dev/document-api/apiReference/model/motionControl
    # ========================================
    
    async def create_motion_control_task(
        self,
        image_url: str,
        video_url: str,
        character_orientation: str,
        mode: str,
        options: Dict = None
    ) -> Dict:
        """
        动作控制任务
        
        官方 API: POST /v1/videos/motion-control
        
        口播场景应用：
        - 用参考视频动作驱动图片人物
        - 数字人动作迁移
        - 风格化角色动画生成
        
        Args:
            image_url: 参考图像（必填）- URL 或 Base64，人物需露出清晰上半身或全身
            video_url: 参考视频（必填）- 动作来源视频，3-30秒，.mp4/.mov
            character_orientation: 人物朝向（必填）- "image"(与图片一致,≤10秒) / "video"(与视频一致,≤30秒)
            mode: 生成模式（必填）- "std"(标准) / "pro"(高品质)
            options: 可选参数
                - prompt: 文本提示词，可增加元素、运镜效果（不超过2500字符）
                - keep_original_sound: 是否保留视频原声 "yes"/"no" (默认 "yes")
                - callback_url: 回调地址
                - external_task_id: 自定义任务ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed"
                }
            }
        """
        options = options or {}
        
        # 验证必填参数
        if character_orientation not in ["image", "video"]:
            raise ValueError("character_orientation 必须是 'image' 或 'video'")
        if mode not in ["std", "pro"]:
            raise ValueError("mode 必须是 'std' 或 'pro'")
        
        # 构建请求体
        payload = {
            "image_url": image_url,
            "video_url": video_url,
            "character_orientation": character_orientation,
            "mode": mode,
        }
        
        # 可选参数
        if options.get("model_name"):
            payload["model_name"] = options["model_name"]
        
        if options.get("duration"):
            payload["duration"] = str(options["duration"])
        
        if options.get("prompt"):
            payload["prompt"] = self._truncate_prompt(options["prompt"])
        
        if options.get("keep_original_sound"):
            payload["keep_original_sound"] = options["keep_original_sound"]
        else:
            payload["keep_original_sound"] = "yes"  # 默认保留原声
        
        # 回调和自定义ID
        if options.get("callback_url"):
            payload["callback_url"] = options["callback_url"]
        
        if options.get("external_task_id"):
            payload["external_task_id"] = options["external_task_id"]
        
        logger.info(f"[KlingAI] 创建动作控制任务: orientation={character_orientation}, mode={mode}")
        
        result = await self._request("POST", "/videos/motion-control", payload)
        return result
    
    async def get_motion_control_task(self, task_id: str) -> Dict:
        """
        查询动作控制任务状态
        
        官方 API: GET /v1/videos/motion-control/{task_id}
        
        Args:
            task_id: 任务 ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed",
                    "task_status_msg": "失败原因",
                    "task_result": {
                        "videos": [
                            {"id": "xxx", "url": "https://...", "duration": "5"}
                        ]
                    }
                }
            }
        """
        logger.info(f"[KlingAI] 查询动作控制任务: task_id={task_id}")
        
        result = await self._request("GET", f"/videos/motion-control/{task_id}")
        return result
    
    # ========================================
    # 多模态视频编辑 - 增加/替换/删除视频元素
    # 官方文档: https://app.klingai.com/cn/dev/document-api/apiReference/model/multiElements
    # ========================================
    
    async def init_video_selection(
        self,
        video_url: str = None,
        video_id: str = None
    ) -> Dict:
        """
        初始化待编辑视频 - 多模态编辑第一步
        
        官方 API: POST /v1/videos/multi-elements/init-selection
        
        使用多模态视频编辑功能前，需先初始化视频。
        
        Args:
            video_url: 视频URL（与video_id二选一）
                - 仅支持MP4和MOV格式
                - 时长≥2秒且≤5秒，或≥7秒且≤10秒
                - 宽高720px-2160px，24/30/60fps
            video_id: 视频ID，从历史作品选择（与video_url二选一）
                - 仅支持30天内生成的视频
        
        Returns:
            {
                "code": 0,
                "data": {
                    "session_id": "xxx",  # 会话ID，24小时有效
                    "fps": 30.0,
                    "original_duration": 1000,
                    "width": 720,
                    "height": 1280,
                    "total_frame": 300,
                    "normalized_video": "url"
                }
            }
        """
        if not video_url and not video_id:
            raise ValueError("video_url 和 video_id 必须提供一个")
        if video_url and video_id:
            raise ValueError("video_url 和 video_id 不能同时提供")
        
        payload = {}
        if video_url:
            payload["video_url"] = video_url
        if video_id:
            payload["video_id"] = video_id
        
        logger.info(f"[KlingAI] 初始化待编辑视频: video_url={video_url or 'N/A'}")
        
        result = await self._request("POST", "/videos/multi-elements/init-selection", payload)
        return result
    
    async def add_video_selection(
        self,
        session_id: str,
        frame_index: int,
        points: List[Dict[str, float]]
    ) -> Dict:
        """
        增加视频选区 - 标记要编辑的元素
        
        官方 API: POST /v1/videos/multi-elements/add-selection
        
        Args:
            session_id: 会话ID（初始化返回）
            frame_index: 帧号，最多支持10个标记帧
            points: 点选坐标列表，如 [{"x": 0.5, "y": 0.5}]
                - x,y取值范围 [0,1]，百分比表示
                - [0,0] 代表画面左上角
                - 每帧最多标记10个点
        
        Returns:
            {
                "code": 0,
                "data": {
                    "session_id": "xxx",
                    "res": {
                        "frame_index": 0,
                        "rle_mask_list": [...]
                    }
                }
            }
        """
        payload = {
            "session_id": session_id,
            "frame_index": frame_index,
            "points": points
        }
        
        logger.info(f"[KlingAI] 增加视频选区: session_id={session_id}, frame={frame_index}, points={len(points)}")
        
        result = await self._request("POST", "/videos/multi-elements/add-selection", payload)
        return result
    
    async def delete_video_selection(
        self,
        session_id: str,
        frame_index: int,
        points: List[Dict[str, float]]
    ) -> Dict:
        """
        删减视频选区
        
        官方 API: POST /v1/videos/multi-elements/delete-selection
        
        Args:
            session_id: 会话ID
            frame_index: 帧号
            points: 点选坐标（需与增加选区时完全一致）
        
        Returns:
            同 add_video_selection
        """
        payload = {
            "session_id": session_id,
            "frame_index": frame_index,
            "points": points
        }
        
        logger.info(f"[KlingAI] 删减视频选区: session_id={session_id}, frame={frame_index}")
        
        result = await self._request("POST", "/videos/multi-elements/delete-selection", payload)
        return result
    
    async def clear_video_selection(self, session_id: str) -> Dict:
        """
        清除视频选区 - 清除所有标记
        
        官方 API: POST /v1/videos/multi-elements/clear-selection
        
        Args:
            session_id: 会话ID
        
        Returns:
            {"code": 0, "data": {"session_id": "xxx"}}
        """
        payload = {"session_id": session_id}
        
        logger.info(f"[KlingAI] 清除视频选区: session_id={session_id}")
        
        result = await self._request("POST", "/videos/multi-elements/clear-selection", payload)
        return result
    
    async def preview_video_selection(self, session_id: str) -> Dict:
        """
        预览已选区视频
        
        官方 API: POST /v1/videos/multi-elements/preview-selection
        
        Args:
            session_id: 会话ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "session_id": "xxx",
                    "res": {
                        "video": "url",  # 含mask的视频
                        "video_cover": "url",  # 封面
                        "tracking_output": "url"  # 每帧mask结果
                    }
                }
            }
        """
        payload = {"session_id": session_id}
        
        logger.info(f"[KlingAI] 预览已选区视频: session_id={session_id}")
        
        result = await self._request("POST", "/videos/multi-elements/preview-selection", payload)
        return result
    
    async def create_multi_elements_task(
        self,
        session_id: str,
        edit_mode: str,
        prompt: str,
        options: Dict = None
    ) -> Dict:
        """
        创建多模态视频编辑任务
        
        官方 API: POST /v1/videos/multi-elements/
        
        Args:
            session_id: 会话ID（初始化返回）
            edit_mode: 操作类型（必填）
                - "addition": 增加元素
                - "swap": 替换元素
                - "removal": 删除元素
            prompt: 提示词（必填）
                - 用<<<video_1>>>指代视频，<<<image_1>>>指代图片
                - 增加: "基于<<<video_1>>>中的原始内容，将<<<image_1>>>中的【X】融入<<<video_1>>>的【Y】"
                - 替换: "使用<<<image_1>>>中的【X】，替换<<<video_1>>>中的【Y】"
                - 删除: "删除<<<video_1>>>中的【X】"
            options: 可选参数
                - model_name: 模型版本 (默认 kling-v1-6)
                - image_list: 图片列表 ["url1", "url2"]
                    - 增加元素: 必填，1-2张
                    - 替换元素: 必填，1张
                    - 删除元素: 不需要
                - negative_prompt: 负向提示词
                - duration: 视频时长 "5"/"10" (默认 "5")
                - mode: 生成模式 "std"/"pro" (默认 "std")
                - callback_url: 回调地址
                - external_task_id: 自定义任务ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted",
                    "session_id": "xxx"
                }
            }
        """
        options = options or {}
        
        # 验证必填参数
        if edit_mode not in ["addition", "swap", "removal"]:
            raise ValueError("edit_mode 必须是 'addition', 'swap' 或 'removal'")
        
        # 构建请求体
        payload = {
            "session_id": session_id,
            "edit_mode": edit_mode,
            "prompt": self._truncate_prompt(prompt),
        }
        
        # 可选参数
        if options.get("model_name"):
            payload["model_name"] = options["model_name"]
        else:
            payload["model_name"] = "kling-v1-6"
        
        # 图片列表 - 清洗 data:xxx;base64, 前缀
        if options.get("image_list"):
            from app.schemas.kling import clean_base64_field
            formatted_image_list = [{"image": clean_base64_field(img)} for img in options["image_list"]]
            payload["image_list"] = formatted_image_list
        
        if options.get("negative_prompt"):
            payload["negative_prompt"] = self._truncate_prompt(options["negative_prompt"], KlingConfig.NEGATIVE_PROMPT_MAX_LEN)
        
        if options.get("duration"):
            payload["duration"] = str(options["duration"])
        
        if options.get("mode"):
            payload["mode"] = options["mode"]
        
        if options.get("callback_url"):
            payload["callback_url"] = options["callback_url"]
        
        if options.get("external_task_id"):
            payload["external_task_id"] = options["external_task_id"]
        
        logger.info(f"[KlingAI] 创建多模态编辑任务: session_id={session_id}, mode={edit_mode}")
        
        result = await self._request("POST", "/videos/multi-elements/", payload)
        return result
    
    async def get_multi_elements_task(self, task_id: str) -> Dict:
        """
        查询多模态视频编辑任务状态
        
        官方 API: GET /v1/videos/multi-elements/{task_id}
        
        Args:
            task_id: 任务 ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed",
                    "task_status_msg": "失败原因",
                    "task_result": {
                        "videos": [
                            {"id": "xxx", "url": "https://...", "duration": "5", "session_id": "xxx"}
                        ]
                    }
                }
            }
        """
        logger.info(f"[KlingAI] 查询多模态编辑任务: task_id={task_id}")
        
        result = await self._request("GET", f"/videos/multi-elements/{task_id}")
        return result
    
    # ========================================
    # 视频延长 - 延长已生成视频的时长
    # 官方文档: https://app.klingai.com/cn/dev/document-api/apiReference/model/videoExtend
    # ========================================
    
    async def create_video_extend_task(
        self,
        video_id: str,
        options: Dict = None
    ) -> Dict:
        """
        视频延长任务
        
        官方 API: POST /v1/videos/video-extend
        
        用于延长文生/图生视频结果的时长，单次延长4~5秒。
        被延长后的视频可以再次延长，但总时长不能超过3分钟。
        
        Args:
            video_id: 视频ID（必填）
                - 支持文生视频、图生视频、视频延长生成的视频ID
                - 原视频不能超过3分钟
                - 视频生成30天后会被清理，无法延长
            options: 可选参数
                - prompt: 正向提示词（≤2500字符）
                - negative_prompt: 负向提示词（≤2500字符）
                - cfg_scale: 提示词参考强度 0-1 (默认 0.5)
                - callback_url: 回调地址
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed"
                }
            }
        """
        options = options or {}
        
        # 构建请求体
        payload = {
            "video_id": video_id,
        }
        
        # 可选参数
        if options.get("prompt"):
            payload["prompt"] = self._truncate_prompt(options["prompt"])
        
        if options.get("negative_prompt"):
            payload["negative_prompt"] = self._truncate_prompt(options["negative_prompt"], KlingConfig.NEGATIVE_PROMPT_MAX_LEN)
        
        if options.get("cfg_scale") is not None:
            payload["cfg_scale"] = options["cfg_scale"]
        
        if options.get("callback_url"):
            payload["callback_url"] = options["callback_url"]
        
        logger.info(f"[KlingAI] 创建视频延长任务: video_id={video_id}")
        
        result = await self._request("POST", "/videos/video-extend", payload)
        return result
    
    async def get_video_extend_task(self, task_id: str) -> Dict:
        """
        查询视频延长任务状态
        
        官方 API: GET /v1/videos/video-extend/{task_id}
        
        Args:
            task_id: 任务 ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed",
                    "task_status_msg": "失败原因",
                    "task_info": {
                        "parent_video": {
                            "id": "xxx",
                            "url": "https://...",
                            "duration": "5"
                        }
                    },
                    "task_result": {
                        "videos": [
                            {"id": "xxx", "url": "https://...", "duration": "10"}
                        ]
                    }
                }
            }
        """
        logger.info(f"[KlingAI] 查询视频延长任务: task_id={task_id}")
        
        result = await self._request("GET", f"/videos/video-extend/{task_id}")
        return result
    
    # ========================================
    # 图像生成 - 文生图/图生图
    # 官方文档: POST /v1/images/generations
    # ========================================
    
    async def create_image_generation_task(
        self,
        prompt: str,
        negative_prompt: str = "",
        image: str = None,
        image_reference: str = None,
        options: Dict = None
    ) -> Dict:
        """
        创建图像生成任务（文生图/图生图）
        
        官方 API: POST /v1/images/generations
        
        Args:
            prompt: 正向文本提示词（必填，不超过2500字符）
            negative_prompt: 负向文本提示词（图生图时不支持）
            image: 参考图像（Base64 或 URL）
            image_reference: 图片参考类型
                - subject: 角色特征参考
                - face: 人物长相参考（需仅含1张人脸）
            options: 可选参数
                - model_name: 模型名称
                    - kling-v1, kling-v1-5, kling-v2, kling-v2-new, kling-v2-1
                    - 默认 kling-v2-1（推荐）
                - image_fidelity: 图片参考强度 [0,1]，默认 0.5
                - human_fidelity: 面部参考强度 [0,1]，默认 0.45（仅 subject 模式）
                - resolution: 清晰度 1k/2k，默认 1k
                - n: 生成数量 [1,9]，默认 1
                - aspect_ratio: 画面比例 16:9/9:16/1:1/4:3/3:4/3:2/2:3/21:9（仅文生图）
                - callback_url: 回调地址
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted",
                    "created_at": 1722769557708,
                    "updated_at": 1722769557708
                }
            }
        """
        options = options or {}
        
        payload = {
            "prompt": self._truncate_prompt(prompt)
        }
        
        # 模型选择逻辑：
        # - 图生图(image不为空)：只有 kling-v1-5 支持，强制使用
        # - 文生图：可以使用任意模型，默认 kling-v2-1
        if image:
            # 图生图强制使用 kling-v1-5（唯一支持图生图的模型）
            model_name = "kling-v1-5"
            logger.info(f"[KlingAI] 图生图模式，自动切换到 kling-v1-5")
        else:
            # 文生图使用指定模型或默认 kling-v2-1
            model_name = options.get("model_name", "kling-v2-1")
        
        payload["model_name"] = model_name
        
        # 负向提示词（图生图时不支持）
        if negative_prompt and not image:
            payload["negative_prompt"] = self._truncate_prompt(negative_prompt, KlingConfig.NEGATIVE_PROMPT_MAX_LEN)
        
        # 参考图像（图生图模式）
        if image:
            from app.schemas.kling import clean_base64_field
            payload["image"] = clean_base64_field(image)
            
            # kling-v1-5 图生图必须指定 image_reference
            if image_reference:
                payload["image_reference"] = image_reference
            else:
                # 默认使用 subject（保留主体特征）
                payload["image_reference"] = "subject"
            
            # 图片参考强度
            if options.get("image_fidelity") is not None:
                payload["image_fidelity"] = options["image_fidelity"]
            
            # 面部参考强度（仅 subject 模式）
            if options.get("human_fidelity") is not None:
                payload["human_fidelity"] = options["human_fidelity"]
        
        # 清晰度
        if options.get("resolution"):
            payload["resolution"] = options["resolution"]
        
        # 生成数量
        if options.get("n"):
            payload["n"] = options["n"]
        
        # 画面比例（仅文生图时有效，图生图时由参考图决定）
        if options.get("aspect_ratio") and not image:
            payload["aspect_ratio"] = options["aspect_ratio"]
        
        # 回调地址
        if options.get("callback_url"):
            payload["callback_url"] = options["callback_url"]
        
        logger.info(f"[KlingAI] 创建图像生成任务: prompt={prompt[:50]}..., model={model_name}, image_reference={image_reference}")
        
        result = await self._request("POST", "/images/generations", payload)
        return result
    
    async def get_image_generation_task(self, task_id: str) -> Dict:
        """
        查询图像生成任务状态（单个）
        
        官方 API: GET /v1/images/generations/{task_id}
        
        Args:
            task_id: 任务 ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed",
                    "task_status_msg": "失败原因",
                    "task_result": {
                        "images": [
                            {"index": 0, "url": "https://..."}
                        ]
                    }
                }
            }
        """
        logger.info(f"[KlingAI] 查询图像生成任务: task_id={task_id}")
        
        result = await self._request("GET", f"/images/generations/{task_id}")
        return result
    
    async def list_image_generation_tasks(
        self,
        page_num: int = 1,
        page_size: int = 30
    ) -> Dict:
        """
        查询图像生成任务列表
        
        官方 API: GET /v1/images/generations?pageNum=1&pageSize=30
        
        Args:
            page_num: 页码 [1,1000]，默认 1
            page_size: 每页数据量 [1,500]，默认 30
        
        Returns:
            {
                "code": 0,
                "data": [
                    {
                        "task_id": "xxx",
                        "task_status": "succeed",
                        "task_result": {
                            "images": [{"index": 0, "url": "https://..."}]
                        }
                    }
                ]
            }
        """
        logger.info(f"[KlingAI] 查询图像生成任务列表: page={page_num}, size={page_size}")
        
        result = await self._request(
            "GET", 
            f"/images/generations?pageNum={page_num}&pageSize={page_size}"
        )
        return result
    
    # ========================================
    # Omni-Image (O1) - 高级多模态图像生成
    # 官方文档: POST /v1/images/omni-image
    # ========================================
    
    async def create_omni_image_task(
        self,
        prompt: str,
        image_list: list = None,
        element_list: list = None,
        options: Dict = None
    ) -> Dict:
        """
        创建 Omni-Image 任务（高级多模态图像生成）
        
        官方 API: POST /v1/images/omni-image
        
        Omni 模型通过 Prompt 中的 <<<image_1>>> 格式引用图片，实现多种能力：
        - 图像编辑（局部修改）
        - 风格迁移
        - 主体融合
        - 场景合成
        
        Args:
            prompt: 文本提示词（必填，不超过2500字符）
                - 使用 <<<image_1>>> 格式引用 image_list 中的图片
                - 例如："将 <<<image_1>>> 中的人物放到沙滩背景中"
            image_list: 参考图列表
                [{"image": "url或base64"}, ...]
                - 图片数量 + 主体数量 <= 10
            element_list: 主体参考列表（基于主体库）
                [{"element_id": 123}, ...]
                - 主体数量 + 图片数量 <= 10
            options: 可选参数
                - model_name: 模型名称，支持 kling-image-o1（默认）
                - resolution: 清晰度 1k/2k，默认 1k
                - n: 生成数量 [1,9]，默认 1
                - aspect_ratio: 画面比例 16:9/9:16/1:1/4:3/3:4/3:2/2:3/21:9/auto
                - callback_url: 回调地址
                - external_task_id: 自定义任务 ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted",
                    "task_info": {"external_task_id": "xxx"},
                    "created_at": 1722769557708,
                    "updated_at": 1722769557708
                }
            }
        """
        options = options or {}
        
        payload = {
            "prompt": self._truncate_prompt(prompt)
        }
        
        # 模型选择（omni-image 支持 kling-image-o1）
        payload["model_name"] = options.get("model_name") or "kling-image-o1"
        
        # 参考图列表 - 清洗 data:xxx;base64, 前缀
        if image_list:
            from app.schemas.kling import clean_base64_field
            cleaned_image_list = [
                {"image": clean_base64_field(item.get("image", ""))} 
                for item in image_list
            ]
            payload["image_list"] = cleaned_image_list
        
        # 主体参考列表
        if element_list:
            payload["element_list"] = element_list
        
        # 清晰度
        if options.get("resolution"):
            payload["resolution"] = options["resolution"]
        
        # 生成数量
        if options.get("n"):
            payload["n"] = options["n"]
        
        # 画面比例（支持 auto）
        if options.get("aspect_ratio"):
            payload["aspect_ratio"] = options["aspect_ratio"]
        
        # 回调地址
        if options.get("callback_url"):
            payload["callback_url"] = options["callback_url"]
        
        # 自定义任务 ID
        if options.get("external_task_id"):
            payload["external_task_id"] = options["external_task_id"]
        
        logger.info(f"[KlingAI] 创建 Omni-Image 任务: prompt={prompt[:50]}..., images={len(image_list) if image_list else 0}")
        logger.debug(f"[KlingAI] Omni-Image 请求参数: {payload}")
        
        result = await self._request("POST", "/images/omni-image", payload)
        logger.info(f"[KlingAI] Omni-Image 响应: {result}")
        return result
    
    async def get_omni_image_task(self, task_id: str) -> Dict:
        """
        查询 Omni-Image 任务状态（单个）
        
        官方 API: GET /v1/images/omni-image/{task_id}
        
        Args:
            task_id: 任务 ID
        
        Returns:
            {
                "code": 0,
                "data": {
                    "task_id": "xxx",
                    "task_status": "submitted/processing/succeed/failed",
                    "task_status_msg": "失败原因",
                    "task_info": {"external_task_id": "xxx"},
                    "task_result": {
                        "images": [
                            {"index": 0, "url": "https://..."}
                        ]
                    }
                }
            }
        """
        logger.info(f"[KlingAI] 查询 Omni-Image 任务: task_id={task_id}")
        
        result = await self._request("GET", f"/images/omni-image/{task_id}")
        return result
    
    async def list_omni_image_tasks(
        self,
        page_num: int = 1,
        page_size: int = 30
    ) -> Dict:
        """
        查询 Omni-Image 任务列表
        
        官方 API: GET /v1/images/omni-image?pageNum=1&pageSize=30
        
        Args:
            page_num: 页码 [1,1000]，默认 1
            page_size: 每页数据量 [1,500]，默认 30
        
        Returns:
            {
                "code": 0,
                "data": [
                    {
                        "task_id": "xxx",
                        "task_status": "succeed",
                        "task_info": {"external_task_id": "xxx"},
                        "task_result": {
                            "images": [{"index": 0, "url": "https://..."}]
                        }
                    }
                ]
            }
        """
        logger.info(f"[KlingAI] 查询 Omni-Image 任务列表: page={page_num}, size={page_size}")
        
        result = await self._request(
            "GET", 
            f"/images/omni-image?pageNum={page_num}&pageSize={page_size}"
        )
        return result
    
    # ========================================
    # 通用任务查询（使用各端点专用查询方法）
    # ========================================
    
    async def wait_for_task(
        self,
        task_id: str,
        on_progress: callable = None
    ) -> Dict:
        """
        等待任务完成（轮询）
        
        Args:
            task_id: 任务 ID
            on_progress: 进度回调 (progress: int, status: str) -> None
        
        Returns:
            完成后的任务结果
        """
        start_time = asyncio.get_event_loop().time()
        
        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > KlingConfig.MAX_POLL_TIME:
                raise TimeoutError(f"任务超时: {task_id}")
            
            result = await self.get_task_status(task_id)
            status = result.get("status", "")
            progress = result.get("progress", 0)
            
            if on_progress:
                on_progress(progress, status)
            
            if status == "completed":
                logger.info(f"[KlingAI] 任务完成: {task_id}")
                return result
            elif status == "failed":
                error = result.get("error", "Unknown error")
                raise RuntimeError(f"任务失败: {error}")
            
            await asyncio.sleep(KlingConfig.POLL_INTERVAL)
    
    # ========================================
    # 取消任务
    # ========================================
    
    async def cancel_task(self, task_id: str) -> Dict:
        """取消任务"""
        result = await self._request("POST", f"/task/{task_id}/cancel")
        return result


# ============================================
# 口播场景封装服务
# ============================================

class KouboService:
    """
    口播场景专用服务
    封装常见口播工作流
    """
    
    def __init__(self):
        self.client = KlingAIClient()
    
    async def generate_digital_human_video(
        self,
        audio_url: str,
        avatar_video_url: str,
        background_prompt: str = None,
        on_progress: callable = None
    ) -> Dict:
        """
        数字人口播视频生成
        
        完整工作流：
        1. (可选) 生成口播背景
        2. 口型同步：将音频同步到数字人视频
        3. (可选) 合成背景
        
        Args:
            audio_url: 口播音频 URL
            avatar_video_url: 数字人基础视频 URL（静默或循环）
            background_prompt: 背景生成提示词（可选）
            on_progress: 进度回调
        
        Returns:
            {
                "video_url": "https://...",
                "duration": 60.0,
                "background_url": "https://..." (如果生成了背景)
            }
        """
        result = {}
        
        # Step 1: 可选 - 生成背景
        if background_prompt:
            if on_progress:
                on_progress(10, "生成口播背景")
            
            bg_task = await self.client.create_text_to_video_task(
                prompt=background_prompt,
                options={"duration": 10, "aspect_ratio": "16:9"}
            )
            bg_result = await self.client.wait_for_task(bg_task["task_id"])
            result["background_url"] = bg_result["result"]["video_url"]
        
        # Step 2: 口型同步
        if on_progress:
            on_progress(40, "口型同步处理中")
        
        lip_task = await self.client.create_lip_sync_task(
            video_url=avatar_video_url,
            audio_url=audio_url,
            options={
                "enhance_face": True,
                "sync_blink": True,
                "expression_scale": 1.0
            }
        )
        
        lip_result = await self.client.wait_for_task(
            lip_task["task_id"],
            on_progress=lambda p, s: on_progress(40 + int(p * 0.5), f"口型同步: {s}") if on_progress else None
        )
        
        result["video_url"] = lip_result["result"]["video_url"]
        result["duration"] = lip_result["result"]["duration"]
        
        if on_progress:
            on_progress(100, "完成")
        
        return result
    
    async def generate_product_showcase(
        self,
        product_images: List[str],
        voiceover_url: str = None,
        on_progress: callable = None
    ) -> Dict:
        """
        产品展示视频生成
        
        场景：口播带货，产品图片动态化展示
        
        Args:
            product_images: 产品图片 URL 列表
            voiceover_url: 配音音频 URL（可选）
            on_progress: 进度回调
        
        Returns:
            {"video_url": "...", "clips": [...]}
        """
        clips = []
        total = len(product_images)
        
        for i, img_url in enumerate(product_images):
            if on_progress:
                on_progress(int(i / total * 80), f"动态化第 {i+1}/{total} 张图片")
            
            task = await self.client.create_image_to_video_task(
                image=img_url,  # 参数名是 image 不是 image_url
                prompt="smooth zoom in, product showcase, professional lighting",
                options={"duration": 5, "motion_scale": 0.8}
            )
            
            result = await self.client.wait_for_task(task["task_id"])
            clips.append({
                "source_image": img_url,
                "video_url": result["result"]["video_url"],
                "duration": result["result"]["duration"]
            })
        
        # TODO: 后续可以接入 export.py 的合成逻辑，将 clips 合成为完整视频
        
        return {
            "clips": clips,
            "total_duration": sum(c["duration"] for c in clips)
        }


# ============================================
# 全局实例
# ============================================

kling_client = KlingAIClient()
koubo_service = KouboService()


# ============================================
# 便捷函数
# ============================================

async def lip_sync(video_url: str, audio_url: str, **options) -> Dict:
    """口型同步快捷函数"""
    task = await kling_client.create_lip_sync_task(video_url, audio_url, options)
    return await kling_client.wait_for_task(task["task_id"])


async def text_to_video(prompt: str, **options) -> Dict:
    """文生视频快捷函数"""
    task = await kling_client.create_text_to_video_task(prompt, options=options)
    return await kling_client.wait_for_task(task["task_id"])


async def image_to_video(image_url: str, prompt: str = "", **options) -> Dict:
    """图生视频快捷函数"""
    task = await kling_client.create_image_to_video_task(image_url, prompt, options)
    return await kling_client.wait_for_task(task["task_id"])
