"""
分层增强 RAG 检索器
==================
组合策略检索 + 参考图检索，输出可执行的增强计划。
"""

import logging
from typing import Optional, Dict, Any

from .schema import (
    EnhancementPlan,
    EnhancementStrategy,
    ContentCategory,
    LayerClassification,
)
from .vectorstore import get_enhancement_vectorstore

logger = logging.getLogger(__name__)

# ── 回退策略（向量库为空或检索失败时使用）──────

FALLBACK_STRATEGIES: Dict[str, Dict[str, Any]] = {
    "face_portrait": {
        "steps": ["skin_enhance", "relight"],
        "kling_params": {
            "skin_intensity": "moderate",
            "light_type": "studio",
            "light_direction": "front",
            "light_intensity": 0.6,
        },
        "prompt_template": "时尚杂志级人像，细腻无瑕肤质，柔和正面影棚光，{original_description}",
    },
    "garment": {
        "steps": ["omni_image"],
        "kling_params": {},
        "prompt_template": "高端电商服装特写，色彩还原准确，面料质感清晰，{original_description}",
    },
    "product": {
        "steps": ["relight"],
        "kling_params": {
            "light_type": "studio",
            "light_direction": "front",
            "light_intensity": 0.7,
        },
        "prompt_template": "专业产品摄影，白底纯净背景，均匀打光，{original_description}",
    },
    "scene": {
        "steps": ["omni_image"],
        "kling_params": {},
        "prompt_template": "高画质场景，光影自然，细节丰富，{original_description}",
    },
    "generic": {
        "steps": ["omni_image"],
        "kling_params": {},
        "prompt_template": "高质量真实图像，细节清晰，{original_description}",
    },
}


class EnhancementRetriever:
    """增强计划检索器"""

    def __init__(self):
        self._store = None

    @property
    def store(self):
        if self._store is None:
            self._store = get_enhancement_vectorstore()
        return self._store

    def get_enhancement_plan(
        self,
        classification: LayerClassification,
        layer_description: str,
        layer_image_b64: Optional[str] = None,
    ) -> EnhancementPlan:
        """
        根据分层分类结果，检索最佳增强策略 + 参考图，组装执行计划。

        Args:
            classification: LLM 对分层内容的分类结果
            layer_description: 分层的语义描述
            layer_image_b64: 分层图片的 base64（可选，用于多模态检索）

        Returns:
            EnhancementPlan 包含策略配置 + 参考图列表 + 组装后的 prompt
        """
        category = classification.content_category
        category_str = category.value if isinstance(category, ContentCategory) else category

        # 构造检索 query
        query = f"{category_str} {classification.style_hint} {layer_description}"
        logger.info(f"[EnhancementRetriever] 检索计划: category={category_str}, query={query[:80]}...")

        # 1. 检索增强策略 (top-1)
        strategies = self.store.search_strategies(
            query_text=query,
            category=category_str,
            top_k=1,
            threshold=0.3,
        )

        strategy = strategies[0] if strategies else None

        # 2. 检索质量参考图 (top-3)
        references = self.store.search_references(
            query_text=query,
            category=category_str,
            top_k=3,
            threshold=0.3,
            query_image_b64=layer_image_b64,
        )

        # 3. 回退策略
        if strategy is None:
            logger.info(f"[EnhancementRetriever] 未检索到策略，使用回退: {category_str}")
            fallback = FALLBACK_STRATEGIES.get(category_str, FALLBACK_STRATEGIES["generic"])
            from .schema import PipelineConfig
            strategy = EnhancementStrategy(
                content_category=category,
                quality_target="realistic_casual",
                description=f"回退策略: {category_str}",
                pipeline_config=PipelineConfig(**fallback),
            )

        # 4. 组装最终 prompt
        template = strategy.pipeline_config.prompt_template if hasattr(strategy.pipeline_config, 'prompt_template') else ""
        ref_hint = ""
        if references:
            ref_descriptions = [r.description for r in references[:2]]
            ref_hint = "；参考标准: " + "、".join(ref_descriptions)

        final_prompt = template.replace("{original_description}", layer_description + ref_hint)

        plan = EnhancementPlan(
            strategy=strategy,
            references=references,
            content_category=category,
            final_prompt=final_prompt,
        )

        logger.info(
            f"[EnhancementRetriever] 计划生成: "
            f"steps={strategy.pipeline_config.steps}, "
            f"refs={len(references)}, "
            f"prompt={final_prompt[:60]}..."
        )
        return plan


# ── 单例 ──────────────────────────────────────────

_instance: Optional[EnhancementRetriever] = None


def get_enhancement_retriever() -> EnhancementRetriever:
    global _instance
    if _instance is None:
        _instance = EnhancementRetriever()
    return _instance
