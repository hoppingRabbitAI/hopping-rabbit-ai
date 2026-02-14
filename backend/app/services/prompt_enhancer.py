"""
Prompt Enhancement Service (L2 + L3)

L2: Library fallback + negative_prompt 补全（无 LLM 调用，纯 DB 查询）
L3: LLM 融会贯通改写（保持用户意图不变，补充专业技法描述）

底线：永远不曲解用户意思和大方向
"""
import logging
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class EnhancedPrompt:
    prompt: str
    negative_prompt: str
    enhanced: bool = False
    source: str = "original"  # "original" / "library_fallback" / "llm_enhanced"


# 能力 → 默认 negative prompt（兜底，库中没有时使用）
DEFAULT_NEGATIVES = {
    "omni_image": "cartoon, anime, illustration, painting, drawing, artificial, oversaturated, distorted face, extra fingers, bad anatomy, blurry, low quality",
    "face_swap": "cartoon face, mask-like, skin mismatch, lighting inconsistency, uncanny valley, blurry edges",
    "skin_enhance": "plastic skin, over-smoothed, wax figure, loss of texture, artificial glow",
    "relight": "flat lighting, harsh shadows, unnatural color cast, overexposed, underexposed",
    "outfit_swap": "floating garment, body distortion, size mismatch, wrinkle artifacts, color bleeding",
    "ai_stylist": "mismatched style, clashing colors, inappropriate occasion, costume-like",
    "outfit_shot": "mannequin, flat lay wrinkles, poor composition, amateur lighting, cluttered background",
    "image_to_video": "static, frozen, jittery motion, morphing artifacts, flickering",
    "text_to_video": "low frame rate, inconsistent motion, text overlay, watermark",
}


class PromptEnhancer:
    """Prompt 增强器 — L2 兜底 + L3 LLM 改写"""

    def __init__(self):
        self._supabase = None

    @property
    def supabase(self):
        if not self._supabase:
            from app.services.supabase_client import get_supabase_client
            self._supabase = get_supabase_client()
        return self._supabase

    async def enhance(
        self,
        capability: str,
        prompt: str,
        negative_prompt: str = "",
        platform: Optional[str] = None,
        input_type: Optional[str] = None,
        auto_enhance: bool = True,
    ) -> EnhancedPrompt:
        """
        主入口

        - 用户写了 prompt → 保留原样，L3 增强（如果开启）
        - 用户没写 prompt → L2 从库中取 fallback
        - 用户没给 negative_prompt → L2 从库/默认值补全
        """
        result_prompt = prompt.strip()
        result_negative = negative_prompt.strip()
        source = "original"

        # ── L2: 空 prompt → 从库取 fallback ──
        if not result_prompt:
            fallback = await self._get_library_fallback(capability, platform, input_type)
            if fallback:
                result_prompt = fallback["prompt"]
                if not result_negative and fallback.get("negative_prompt"):
                    result_negative = fallback["negative_prompt"]
                source = "library_fallback"
                logger.info(f"[PromptEnhancer] L2 fallback: cap={capability}, prompt={result_prompt[:50]}...")

        # ── L2: negative_prompt 补全 ──
        if not result_negative:
            lib_neg = await self._get_library_negative(capability, platform, input_type)
            result_negative = lib_neg or DEFAULT_NEGATIVES.get(capability, "")

        # ── L3: LLM 融会贯通改写 ──
        if auto_enhance and result_prompt:
            try:
                enhanced = await self._llm_enhance(result_prompt, capability, platform, input_type)
                if enhanced:
                    result_prompt = enhanced
                    if source == "original":
                        source = "llm_enhanced"
            except Exception as e:
                logger.warning(f"[PromptEnhancer] L3 失败，保留原始: {e}")

        return EnhancedPrompt(
            prompt=result_prompt,
            negative_prompt=result_negative,
            enhanced=(source != "original"),
            source=source,
        )

    # ── L2 Private Methods ──

    async def _get_library_fallback(
        self, capability: str, platform: Optional[str], input_type: Optional[str]
    ) -> Optional[dict]:
        """从 prompt_library 取 quality_score 最高的一条作为 fallback"""
        try:
            query = (
                self.supabase.table("prompt_library")
                .select("prompt, negative_prompt, quality_score")
                .eq("capability", capability)
                .order("quality_score", desc=True)
                .limit(1)
            )
            if platform and platform != "universal":
                query = query.eq("platform", platform)
            if input_type and input_type != "universal":
                query = query.eq("input_type", input_type)
            result = query.execute()
            if result.data:
                return result.data[0]
        except Exception as e:
            logger.warning(f"[PromptEnhancer] fallback 查询失败: {e}")
        return None

    async def _get_library_negative(
        self, capability: str, platform: Optional[str], input_type: Optional[str]
    ) -> str:
        """从 prompt_library 取 negative_prompt 补全"""
        try:
            query = (
                self.supabase.table("prompt_library")
                .select("negative_prompt")
                .eq("capability", capability)
                .neq("negative_prompt", "")
                .order("quality_score", desc=True)
                .limit(1)
            )
            if platform and platform != "universal":
                query = query.eq("platform", platform)
            result = query.execute()
            if result.data and result.data[0].get("negative_prompt"):
                return result.data[0]["negative_prompt"]
        except Exception as e:
            logger.warning(f"[PromptEnhancer] negative 查询失败: {e}")
        return ""

    # ── L3 Private Methods ──

    async def _llm_enhance(
        self,
        prompt: str,
        capability: str,
        platform: Optional[str],
        input_type: Optional[str],
    ) -> Optional[str]:
        """LLM 融会贯通改写 — 保留用户意图，补充专业技法"""
        from app.services.llm.clients import get_fast_llm

        llm = get_fast_llm()
        if not llm:
            return None

        # 组装上下文
        cap_hint = _CAPABILITY_CONTEXT.get(capability, "")
        plat_hint = _PLATFORM_CONTEXT.get(platform, "") if platform else ""
        input_hint = _INPUT_TYPE_CONTEXT.get(input_type, "") if input_type else ""

        context_parts = [c for c in [cap_hint, plat_hint, input_hint] if c]
        context_block = "\n".join(context_parts) if context_parts else ""

        system = _L3_SYSTEM_PROMPT.format(context=context_block)

        try:
            from langchain_core.messages import SystemMessage, HumanMessage

            messages = [
                SystemMessage(content=system),
                HumanMessage(content=prompt),
            ]
            result = await llm.ainvoke(messages)
            enhanced = result.content.strip()
            # 基本质量检查：结果不能比原 prompt 短太多
            if enhanced and len(enhanced) >= len(prompt) * 0.5:
                logger.info(
                    f"[PromptEnhancer] L3: '{prompt[:30]}...' → '{enhanced[:50]}...'"
                )
                return enhanced
        except Exception as e:
            logger.warning(f"[PromptEnhancer] LLM 调用失败: {e}")
        return None


# ============================================
# L3 System Prompt & Context
# ============================================

_L3_SYSTEM_PROMPT = """你是一个 AI 图像/视频生成的 prompt 专家。

用户给你一个描述（可能很简短，如"加个眼镜"），你需要将其扩展为专业的、融会贯通的 prompt。

核心规则：
1. **保留用户意图** — 用户说什么就做什么，绝不曲解、绝不偏离大方向
2. **真实感优先** — 默认真实摄影风格，除非用户明确要求其他风格（如动漫、水彩）
3. **自然融合** — 写成一段连贯、专业的描述，不是关键词堆砌
4. **适度扩展** — 补充光影、镜头、质感等技术细节，但不添加用户没提到的主体/场景
5. **英文输出** — AI 模型更擅长英文 prompt
6. **长度控制** — 30-120 词，简洁有力

{context}

只输出增强后的 prompt，不要任何解释。"""

_CAPABILITY_CONTEXT = {
    "omni_image": "当前任务：图像生成/编辑。注重构图、光影、细节质感。",
    "face_swap": "当前任务：AI 换脸。强调面部融合自然、光影一致、边缘无痕。",
    "skin_enhance": "当前任务：皮肤美化。保持面部特征不变，只提升皮肤质感。",
    "relight": "当前任务：AI 打光。注重光源方向、强度、色温的真实物理效果。",
    "outfit_swap": "当前任务：AI 换装。强调服装与人物体型的自然贴合、褶皱真实。",
    "ai_stylist": "当前任务：AI 穿搭推荐。注重整体搭配协调、风格一致性。",
    "outfit_shot": "当前任务：穿搭内容生成。注重构图、场景氛围、平台风格适配。",
    "image_to_video": "当前任务：图生视频。注重动态自然、主体稳定、无形变。",
    "text_to_video": "当前任务：文生视频。注重场景连贯、运动流畅、画面质感。",
}

_PLATFORM_CONTEXT = {
    "douyin": "目标平台：抖音/快手。偏好高对比度、戏剧感强、视觉冲击力、竖屏 9:16。",
    "xiaohongshu": "目标平台：小红书。偏好柔和奶油色调、梦幻氛围、精致感、清新自然。",
    "bilibili": "目标平台：B站。偏好清晰对比、技术展示感、干净布局。",
    "weibo": "目标平台：微博。偏好明星杂志感、高端大气、品牌质感。",
}

_INPUT_TYPE_CONTEXT = {
    "ecommerce": "输入来源：电商产品图。将平铺/白底图转化为生活场景。",
    "selfie": "输入来源：自拍照。提升背景、修正光线、增加专业感。",
    "street_snap": "输入来源：街拍照。提升到时尚杂志级别的色彩和构图。",
    "runway": "输入来源：秀场图。保持高级时装质感的同时融入新场景。",
}


# ── Singleton ──

_instance: Optional[PromptEnhancer] = None


def get_prompt_enhancer() -> PromptEnhancer:
    global _instance
    if not _instance:
        _instance = PromptEnhancer()
    return _instance
