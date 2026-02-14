"""
Lepus AI - AI Engine Registry & Abstraction Layer
统一管理各 AI 能力的引擎路由，解耦能力与具体 AI 供应商实现

设计目标：
1. 统一接口：所有 AI 能力通过 BaseAIEngine 抽象接口调用
2. 引擎注册：AIEngineRegistry 管理能力 → 引擎映射
3. 供应商可替换：同一能力可切换不同 AI 后端（Kling / GFPGAN / IC-Light 等）
4. 结果标准化：所有引擎返回统一的 AIEngineResult

PRD Reference: §4.3 AI 引擎抽象层 (P0)
"""

import os
import logging
import httpx
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Dict, Any, List, Type

logger = logging.getLogger(__name__)


# ============================================
# 标准化结果
# ============================================

class AIEngineStatus(str, Enum):
    """引擎任务状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    POLLING = "polling"        # 正在轮询第三方 API
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class AIEngineResult:
    """
    AI 引擎统一返回结果
    
    所有引擎必须返回此格式，由 Celery Task 层消费
    """
    status: AIEngineStatus
    provider_task_id: Optional[str] = None   # 第三方任务 ID（用于轮询）
    output_urls: List[str] = field(default_factory=list)  # 生成结果 URL 列表
    output_type: str = "image"                # "image" | "video"
    metadata: Dict[str, Any] = field(default_factory=dict)  # 引擎特有元数据
    error_message: Optional[str] = None
    credits_cost: int = 0                     # 实际消耗 credits
    estimated_time_seconds: int = 15          # 预估耗时


# ============================================
# 基础引擎抽象类
# ============================================

class BaseAIEngine(ABC):
    """
    AI 引擎基类
    
    所有 AI 能力引擎必须继承此类，实现以下方法：
    - execute(): 发起 AI 任务（返回 provider_task_id 用于异步轮询，或直接返回结果）
    - poll_status(): 轮询异步任务状态（可选，同步引擎无需实现）
    - validate_params(): 参数校验
    
    Usage:
        engine = AIEngineRegistry.get_engine('skin_enhance')
        result = await engine.execute(params)
        while result.status == AIEngineStatus.POLLING:
            await asyncio.sleep(5)
            result = await engine.poll_status(result.provider_task_id)
    """

    # 子类必须声明
    engine_name: str = "base"
    capability_id: str = ""
    provider: str = "unknown"    # "kling" | "gfpgan" | "ic_light" | "idm_vton" | "sdxl"
    
    # 默认配置
    default_credits: int = 5
    default_timeout: int = 300   # 秒
    poll_interval: int = 5       # 轮询间隔

    def validate_params(self, params: Dict[str, Any]) -> Optional[str]:
        """
        参数校验，返回 None 表示通过，返回字符串表示错误信息
        子类可覆写添加自定义校验
        """
        return None

    @abstractmethod
    async def execute(self, params: Dict[str, Any]) -> AIEngineResult:
        """
        执行 AI 任务
        
        Args:
            params: 能力特有参数（见各能力 PRD 定义）
            
        Returns:
            AIEngineResult - 如果是异步任务，status=POLLING + provider_task_id
                           如果是同步任务，status=COMPLETED + output_urls
        """
        ...

    async def poll_status(self, provider_task_id: str) -> AIEngineResult:
        """
        轮询异步任务状态
        
        默认实现：直接返回 COMPLETED（同步引擎无需轮询）
        异步引擎（如 Kling）需覆写此方法
        """
        return AIEngineResult(
            status=AIEngineStatus.COMPLETED,
            provider_task_id=provider_task_id,
        )

    def estimate_credits(self, params: Dict[str, Any]) -> int:
        """预估 credits 消耗，子类可覆写"""
        return self.default_credits

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} engine={self.engine_name} provider={self.provider}>"


# ============================================
# Kling 基础引擎（复用现有 kling_client）
# ============================================

class KlingBaseEngine(BaseAIEngine):
    """
    Kling AI 引擎基类
    
    封装 Kling API 的公共逻辑（JWT 认证、轮询、结果提取）
    现有 9 个能力和新增能力中使用 Kling 后端的都继承此类
    """
    provider = "kling"
    poll_interval = 5
    default_timeout = 600  # Kling 最长 10 分钟

    def _get_kling_client(self):
        """延迟导入 kling_client 单例"""
        from .kling_ai_service import kling_client
        return kling_client

    async def poll_status(self, provider_task_id: str) -> AIEngineResult:
        """Kling 统一轮询逻辑 — 使用 Omni-Image 专用查询端点"""
        client = self._get_kling_client()
        try:
            response = await client.get_omni_image_task(provider_task_id)
            status_data = response.get("data", {})
            task_status = status_data.get("task_status", "")

            if task_status == "succeed":
                task_result = status_data.get("task_result", {})
                # 提取输出 URL（视频或图片）
                urls = []
                for video in task_result.get("videos", []):
                    if video.get("url"):
                        urls.append(video["url"])
                for image in task_result.get("images", []):
                    if image.get("url"):
                        urls.append(image["url"])
                
                return AIEngineResult(
                    status=AIEngineStatus.COMPLETED,
                    provider_task_id=provider_task_id,
                    output_urls=urls,
                    metadata=task_result,
                )
            elif task_status == "failed":
                error_msg = status_data.get("task_status_msg", "Kling task failed")
                return AIEngineResult(
                    status=AIEngineStatus.FAILED,
                    provider_task_id=provider_task_id,
                    error_message=error_msg,
                )
            else:
                # 仍在处理中
                return AIEngineResult(
                    status=AIEngineStatus.POLLING,
                    provider_task_id=provider_task_id,
                )
        except Exception as e:
            logger.error(f"[{self.engine_name}] 轮询失败: {e}")
            return AIEngineResult(
                status=AIEngineStatus.FAILED,
                provider_task_id=provider_task_id,
                error_message=str(e),
            )


# ============================================
# 🆕 五大新能力引擎
# ============================================

class SkinEnhanceEngine(KlingBaseEngine):
    """
    皮肤美化引擎
    
    V1: 使用 Kling Omni-Image 做美颜增强（prompt-driven）
    V2: 可替换为 GFPGAN / CodeFormer 自部署方案
    
    PRD: §2.1
    """
    engine_name = "skin_enhance"
    capability_id = "skin_enhance"
    default_credits = 3

    def validate_params(self, params: Dict[str, Any]) -> Optional[str]:
        if not params.get("image_url"):
            return "skin_enhance 需要输入图片 URL"
        return None

    async def execute(self, params: Dict[str, Any]) -> AIEngineResult:
        client = self._get_kling_client()
        
        image_url = params["image_url"]
        intensity = params.get("intensity", "natural")  # natural | moderate | max
        
        # 根据强度生成美颜 prompt
        intensity_prompts = {
            "natural": "enhance skin texture, subtle skin smoothing, keep natural look, high quality portrait",
            "moderate": "skin retouching, smooth skin, remove blemishes, bright and clear complexion, portrait photography",
            "max": "perfect skin, flawless complexion, professional beauty retouching, studio quality skin, magazine cover",
        }
        prompt = intensity_prompts.get(intensity, intensity_prompts["natural"])
        
        # 追加用户自定义 prompt
        if params.get("custom_prompt"):
            prompt = f"{prompt}, {params['custom_prompt']}"

        try:
            response = await client.create_omni_image_task(
                prompt=f"<<<image_1>>> {prompt}",
                image_list=[{"image": image_url}],
                options={"model_name": "kling-image-o1", "n": 1},
            )
            
            task_id = response.get("data", {}).get("task_id")
            if not task_id:
                return AIEngineResult(
                    status=AIEngineStatus.FAILED,
                    error_message=f"Kling API 返回无效: {response}",
                )
            
            return AIEngineResult(
                status=AIEngineStatus.POLLING,
                provider_task_id=task_id,
                output_type="image",
                credits_cost=self.default_credits,
                estimated_time_seconds=10,
            )
        except Exception as e:
            return AIEngineResult(
                status=AIEngineStatus.FAILED,
                error_message=str(e),
            )


class StabilityRelightEngine(BaseAIEngine):
    """
    AI 打光引擎 — Stability AI Replace Background & Relight

    使用 Stability AI 专业打光 API，支持：
    - light_source_direction: above / below / left / right
    - light_source_strength: 0-1
    - background_prompt: 文字描述背景
    - keep_original_background: 保留原背景（仅重新打光）
    - preserve_original_subject: 保留原始主体完整度 0-1

    API 文档: https://platform.stability.ai/docs/api-reference#tag/Edit/paths/~1v2beta~1stable-image~1edit~1replace-background-and-relight/post
    PRD: §2.2
    """
    engine_name = "relight"
    capability_id = "relight"
    provider = "stability_ai"
    default_credits = 8          # Stability 每次 8 credits
    default_timeout = 300
    poll_interval = 3

    # 前端 light_direction → Stability API light_source_direction 映射
    _DIRECTION_MAP = {
        "front": "above",     # 正面光 → 从上方照射
        "left": "left",
        "right": "right",
        "back": "above",      # 逆光效果 → 从上打光（API 不支持 back）
        "top": "above",
        "bottom": "below",
    }

    # light_type → background_prompt 风格映射
    _LIGHT_TYPE_PROMPTS = {
        "natural": "natural daylight, soft ambient lighting",
        "studio": "professional studio lighting, clean white background",
        "golden_hour": "warm golden hour sunlight, soft warm tones",
        "dramatic": "dramatic moody lighting, strong contrast, dark atmosphere",
        "neon": "neon lighting, colorful neon glow, cyberpunk atmosphere",
        "soft": "soft diffused lighting, beauty lighting, gentle shadows",
    }

    def _get_api_key(self) -> str:
        from ..config import get_settings
        settings = get_settings()
        if not settings.stability_api_key:
            raise ValueError("未配置 Stability AI API Key（STABILITY_API_KEY）")
        return settings.stability_api_key

    def _get_api_base(self) -> str:
        from ..config import get_settings
        return get_settings().stability_api_base

    def validate_params(self, params: Dict[str, Any]) -> Optional[str]:
        if not params.get("image_url"):
            return "relight 需要输入图片 URL"
        return None

    async def execute(self, params: Dict[str, Any]) -> AIEngineResult:
        """
        调用 Stability AI Replace-Background-and-Relight API (async)

        1. 下载原图 → 二进制
        2. 构建 multipart/form-data 请求
        3. 提交任务 → 获得 generation_id
        4. 返回 POLLING 状态
        """
        api_key = self._get_api_key()
        api_base = self._get_api_base()

        image_url = params["image_url"]
        light_type = params.get("light_type", "natural")
        light_direction = params.get("light_direction", "front")
        light_intensity = params.get("light_intensity", 0.7)
        keep_background = params.get("keep_original_background", True)

        try:
            # ── 1. 下载原图 ──
            async with httpx.AsyncClient(timeout=30) as client:
                img_resp = await client.get(image_url)
                img_resp.raise_for_status()
                image_bytes = img_resp.content

            # ── 2. 构建请求参数 ──
            direction = self._DIRECTION_MAP.get(light_direction, "above")
            strength = max(0.0, min(1.0, light_intensity))

            # 基于 light_type 生成背景 prompt
            bg_prompt = self._LIGHT_TYPE_PROMPTS.get(light_type, light_type)
            if params.get("custom_prompt"):
                bg_prompt = f"{bg_prompt}, {params['custom_prompt']}"

            form_data = {
                "light_source_direction": direction,
                "light_source_strength": str(strength),
                "keep_original_background": "true" if keep_background else "false",
                "preserve_original_subject": str(params.get("preserve_original_subject", 0.7)),
                "output_format": params.get("output_format", "png"),
                "background_prompt": bg_prompt,
            }

            if params.get("foreground_prompt"):
                form_data["foreground_prompt"] = params["foreground_prompt"]

            # ── 3. 提交 Stability API ──
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{api_base}/v2beta/stable-image/edit/replace-background-and-relight",
                    headers={
                        "authorization": f"Bearer {api_key}",
                        "accept": "application/json",
                    },
                    files={
                        "subject_image": ("image.png", image_bytes, "image/png"),
                    },
                    data=form_data,
                )
                resp.raise_for_status()
                result_data = resp.json()

            generation_id = result_data.get("id")
            if not generation_id:
                return AIEngineResult(
                    status=AIEngineStatus.FAILED,
                    error_message=f"Stability API 返回无效: {result_data}",
                )

            return AIEngineResult(
                status=AIEngineStatus.POLLING,
                provider_task_id=generation_id,
                output_type="image",
                credits_cost=self.default_credits,
                estimated_time_seconds=15,
                metadata={
                    "provider": "stability_ai",
                    "light_type": light_type,
                    "light_direction": light_direction,
                    "light_source_direction": direction,
                    "light_source_strength": strength,
                },
            )

        except httpx.HTTPStatusError as e:
            error_body = e.response.text if e.response else str(e)
            return AIEngineResult(
                status=AIEngineStatus.FAILED,
                error_message=f"Stability API HTTP {e.response.status_code}: {error_body}",
            )
        except Exception as e:
            return AIEngineResult(
                status=AIEngineStatus.FAILED,
                error_message=str(e),
            )

    async def poll_status(self, provider_task_id: str) -> AIEngineResult:
        """
        轮询 Stability AI 异步结果

        GET /v2beta/results/{id}
        - 200 + finish_reason=SUCCESS → 完成
        - 202 → 仍在处理
        - 其他 → 失败
        """
        api_key = self._get_api_key()
        api_base = self._get_api_base()

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{api_base}/v2beta/results/{provider_task_id}",
                    headers={
                        "authorization": f"Bearer {api_key}",
                        "accept": "application/json",
                    },
                )

            if resp.status_code == 202:
                # 仍在处理
                return AIEngineResult(
                    status=AIEngineStatus.POLLING,
                    provider_task_id=provider_task_id,
                )

            if resp.status_code == 200:
                result_data = resp.json()
                finish_reason = result_data.get("finish_reason")

                if finish_reason == "SUCCESS":
                    # 结果中包含 base64 图像 — 写入 Supabase 或返回 data URI
                    image_b64 = result_data.get("image")
                    output_url = f"data:image/png;base64,{image_b64}" if image_b64 else ""
                    return AIEngineResult(
                        status=AIEngineStatus.COMPLETED,
                        provider_task_id=provider_task_id,
                        output_urls=[output_url] if output_url else [],
                        metadata={"finish_reason": finish_reason, "seed": result_data.get("seed")},
                    )
                else:
                    return AIEngineResult(
                        status=AIEngineStatus.FAILED,
                        provider_task_id=provider_task_id,
                        error_message=f"Stability 生成失败: finish_reason={finish_reason}",
                    )

            # 其他 HTTP 状态码
            return AIEngineResult(
                status=AIEngineStatus.FAILED,
                provider_task_id=provider_task_id,
                error_message=f"Stability poll HTTP {resp.status_code}: {resp.text}",
            )

        except Exception as e:
            logger.error(f"[relight] Stability 轮询失败: {e}")
            return AIEngineResult(
                status=AIEngineStatus.FAILED,
                provider_task_id=provider_task_id,
                error_message=str(e),
            )


class OutfitSwapEngine(KlingBaseEngine):
    """
    换装引擎
    
    V1: 使用 Kling Omni-Image 做服装替换（prompt-driven）
    V2: 可替换为 IDM-VTON 自部署方案
    
    PRD: §2.3
    """
    engine_name = "outfit_swap"
    capability_id = "outfit_swap"
    default_credits = 5

    def validate_params(self, params: Dict[str, Any]) -> Optional[str]:
        if not params.get("person_image_url"):
            return "outfit_swap 需要人物图片"
        if not params.get("garment_image_url"):
            return "outfit_swap 需要衣物图片"
        return None

    async def execute(self, params: Dict[str, Any]) -> AIEngineResult:
        client = self._get_kling_client()
        
        person_url = params["person_image_url"]
        garment_url = params["garment_image_url"]
        garment_type = params.get("garment_type", "upper")  # upper | lower | full
        
        type_prompts = {
            "upper": "wearing the outfit shown in <<<image_2>>> as upper body clothing",
            "lower": "wearing the pants/skirt shown in <<<image_2>>>",
            "full": "wearing the complete outfit shown in <<<image_2>>>",
        }
        
        prompt = (
            f"<<<image_1>>> person {type_prompts.get(garment_type, type_prompts['upper'])}, "
            f"<<<image_2>>> is the garment reference, "
            f"keep person's face and body unchanged, only change clothing, "
            f"photorealistic, high quality"
        )
        
        if params.get("custom_prompt"):
            prompt = f"{prompt}, {params['custom_prompt']}"

        try:
            response = await client.create_omni_image_task(
                prompt=prompt,
                image_list=[
                    {"image": person_url},
                    {"image": garment_url},
                ],
                options={"model_name": "kling-image-o1", "n": 1},
            )
            
            task_id = response.get("data", {}).get("task_id")
            if not task_id:
                return AIEngineResult(
                    status=AIEngineStatus.FAILED,
                    error_message=f"Kling API 返回无效: {response}",
                )
            
            return AIEngineResult(
                status=AIEngineStatus.POLLING,
                provider_task_id=task_id,
                output_type="image",
                credits_cost=self.default_credits,
                estimated_time_seconds=15,
            )
        except Exception as e:
            return AIEngineResult(
                status=AIEngineStatus.FAILED,
                error_message=str(e),
            )


class AIStylistEngine(KlingBaseEngine):
    """
    AI 穿搭师引擎
    
    根据用户标签/风格偏好，基于上传衣物图自动搭配
    V1: Kling Omni-Image prompt-driven 搭配
    
    PRD: §2.4
    """
    engine_name = "ai_stylist"
    capability_id = "ai_stylist"
    default_credits = 5

    def validate_params(self, params: Dict[str, Any]) -> Optional[str]:
        if not params.get("garment_image_url"):
            return "ai_stylist 需要至少一件衣物图片"
        return None

    async def execute(self, params: Dict[str, Any]) -> AIEngineResult:
        client = self._get_kling_client()
        
        garment_url = params["garment_image_url"]
        style_tags = params.get("style_tags", [])  # ["casual", "street", "korean"]
        occasion = params.get("occasion", "daily")  # daily | work | date | travel
        season = params.get("season", "spring")
        gender = params.get("gender", "female")
        
        style_str = ", ".join(style_tags) if style_tags else "fashionable"
        
        occasion_prompts = {
            "daily": "everyday casual outfit",
            "work": "professional office outfit",
            "date": "elegant date night outfit",
            "travel": "comfortable travel outfit",
            "party": "stylish party outfit",
        }
        
        prompt = (
            f"Fashion stylist recommendation: create a complete {occasion_prompts.get(occasion, 'stylish')} "
            f"coordination based on <<<image_1>>> garment, {style_str} style, "
            f"{season} season, {gender} model wearing the complete styled outfit, "
            f"full body shot, fashion photography, high quality"
        )
        
        if params.get("custom_prompt"):
            prompt = f"{prompt}, {params['custom_prompt']}"

        try:
            response = await client.create_omni_image_task(
                prompt=prompt,
                image_list=[{"image": garment_url}],
                options={"model_name": "kling-image-o1", "n": params.get("num_variations", 1)},
            )
            
            task_id = response.get("data", {}).get("task_id")
            if not task_id:
                return AIEngineResult(
                    status=AIEngineStatus.FAILED,
                    error_message=f"Kling API 返回无效: {response}",
                )
            
            return AIEngineResult(
                status=AIEngineStatus.POLLING,
                provider_task_id=task_id,
                output_type="image",
                credits_cost=self.default_credits,
                estimated_time_seconds=15,
            )
        except Exception as e:
            return AIEngineResult(
                status=AIEngineStatus.FAILED,
                error_message=str(e),
            )


class OutfitShotEngine(KlingBaseEngine):
    """
    AI 穿搭内容生成引擎
    
    两种模式：
    - content: 内容素材模式（主推）— 生成可发布的穿搭内容图
    - try_on: 虚拟试穿预览（辅助）— 依赖数字人资产
    
    V1 先做 content 模式
    
    PRD: §2.5
    """
    engine_name = "outfit_shot"
    capability_id = "outfit_shot"
    default_credits = 8

    def validate_params(self, params: Dict[str, Any]) -> Optional[str]:
        if not params.get("garment_images"):
            return "outfit_shot 需要至少一张衣物图片"
        mode = params.get("mode", "content")
        if mode == "try_on" and not params.get("avatar_id"):
            return "虚拟试穿模式需要选择数字人"
        return None

    def estimate_credits(self, params: Dict[str, Any]) -> int:
        mode = params.get("mode", "content")
        n = params.get("num_variations", 1)
        if mode == "try_on":
            return 5  # 复用 VTON，较低
        # 内容素材：8 per variant, 批量折扣
        if n >= 4:
            return 24  # 8 * 3 折扣
        return 8 * n

    async def execute(self, params: Dict[str, Any]) -> AIEngineResult:
        client = self._get_kling_client()
        
        garment_images = params["garment_images"]  # list of URLs
        mode = params.get("mode", "content")
        content_type = params.get("content_type", "streetsnap")
        platform_preset = params.get("platform_preset", "xiaohongshu")
        gender = params.get("gender", "female")
        scene_prompt = params.get("scene_prompt", "")
        num_variations = params.get("num_variations", 1)
        
        # 平台比例映射
        platform_ratios = {
            "xiaohongshu": "3:4",
            "douyin": "9:16",
            "instagram": "1:1",
            "custom": "1:1",
        }
        aspect_ratio = platform_ratios.get(platform_preset, "3:4")
        
        # 内容类型 → prompt 风格
        content_prompts = {
            "cover": "social media cover image, bold text-friendly composition, eye-catching layout",
            "streetsnap": "street style photography, urban background, natural casual pose, city setting",
            "lifestyle": "lifestyle photography, cozy atmosphere, cafe or home setting, warm tones",
            "flat_lay": "flat lay photography, top-down view, neatly arranged items on clean background",
            "comparison": "before and after comparison, side by side outfit styling, split composition",
        }
        
        style_desc = content_prompts.get(content_type, content_prompts["streetsnap"])
        
        # 构建 prompt — Kling Omni-Image 使用 <<<image_N>>> 数字索引引用图片
        image_refs = []
        prompt_parts = []
        for i, url in enumerate(garment_images[:3]):
            image_refs.append({"image": url})
            prompt_parts.append(f"<<<image_{i + 1}>>>")
        
        garment_ref = " and ".join(prompt_parts)
        
        prompt = (
            f"{gender} model wearing the clothing from {garment_ref}, "
            f"{style_desc}, "
            f"professional fashion photography, high quality, "
            f"publishable social media content"
        )
        
        if scene_prompt:
            prompt = f"{prompt}, {scene_prompt}"

        try:
            response = await client.create_omni_image_task(
                prompt=prompt,
                image_list=image_refs,
                options={
                    "model_name": "kling-image-o1",
                    "n": min(num_variations, 4),
                    "aspect_ratio": aspect_ratio,
                },
            )
            
            task_id = response.get("data", {}).get("task_id")
            if not task_id:
                return AIEngineResult(
                    status=AIEngineStatus.FAILED,
                    error_message=f"Kling API 返回无效: {response}",
                )
            
            return AIEngineResult(
                status=AIEngineStatus.POLLING,
                provider_task_id=task_id,
                output_type="image",
                credits_cost=self.estimate_credits(params),
                estimated_time_seconds=20,
                metadata={
                    "mode": mode,
                    "content_type": content_type,
                    "platform_preset": platform_preset,
                    "aspect_ratio": aspect_ratio,
                },
            )
        except Exception as e:
            return AIEngineResult(
                status=AIEngineStatus.FAILED,
                error_message=str(e),
            )


# ============================================
# 引擎注册表
# ============================================

class AIEngineRegistry:
    """
    统一管理各 AI 能力的引擎路由
    
    Usage:
        engine = AIEngineRegistry.get_engine('skin_enhance')
        result = await engine.execute(params)
    """
    
    _engines: Dict[str, Type[BaseAIEngine]] = {
        # 🆕 Enhance & Style 能力组
        "skin_enhance": SkinEnhanceEngine,
        "relight": StabilityRelightEngine,   # V2: Stability AI 专业打光
        "outfit_swap": OutfitSwapEngine,
        "ai_stylist": AIStylistEngine,
        "outfit_shot": OutfitShotEngine,
    }
    
    # 单例缓存
    _instances: Dict[str, BaseAIEngine] = {}

    @classmethod
    def get_engine(cls, capability_id: str) -> BaseAIEngine:
        """获取指定能力的引擎实例（单例）"""
        if capability_id not in cls._engines:
            raise ValueError(
                f"未注册的 AI 能力: {capability_id}. "
                f"已注册: {list(cls._engines.keys())}"
            )
        
        if capability_id not in cls._instances:
            cls._instances[capability_id] = cls._engines[capability_id]()
            logger.info(f"[AIEngine] 初始化引擎: {cls._instances[capability_id]}")
        
        return cls._instances[capability_id]

    @classmethod
    def register(cls, capability_id: str, engine_class: Type[BaseAIEngine]):
        """动态注册新引擎（支持运行时扩展）"""
        cls._engines[capability_id] = engine_class
        # 清除旧实例缓存
        cls._instances.pop(capability_id, None)
        logger.info(f"[AIEngine] 注册引擎: {capability_id} → {engine_class.__name__}")

    @classmethod
    def list_engines(cls) -> Dict[str, str]:
        """列出所有已注册引擎"""
        return {
            cap_id: engine_cls.__name__
            for cap_id, engine_cls in cls._engines.items()
        }

    @classmethod
    def has_engine(cls, capability_id: str) -> bool:
        """检查引擎是否已注册"""
        return capability_id in cls._engines
