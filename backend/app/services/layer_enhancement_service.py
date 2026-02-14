"""
分层增强服务
============
抠图分层后，根据内容类型自适应执行增强管线。

流程：
  1. LLM 视觉分类 → 识别内容类别 + 风格
  2. RAG 检索 → 获取最佳增强策略 + 质量参考图
  3. 按策略执行 Kling API (skin_enhance / relight / omni_image)
  4. 质量评估 + 高质量结果自动入库
"""

import logging
import json
import asyncio
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


# ── LLM 分类 Prompt ──────────────────────────────

LAYER_CLASSIFICATION_SYSTEM = """你是专业的图像内容分析师。
分析给定的抠图分层图片，判断其内容类别和视觉特征。
只返回有效 JSON，不要额外解释。"""

LAYER_CLASSIFICATION_PROMPT = """请分析这张抠图后的分层图片，返回 JSON:

{
  "content_category": "face_portrait" | "garment" | "accessory" | "product" | "scene" | "generic",
  "style_hint": "描述当前图像的视觉风格，如'自然光户外人像'、'电商白底产品图'",
  "quality_assessment": "当前质量评估，指出需要改进的地方，如'发丝边缘粗糙，肤色偏暗'",
  "is_face": true/false,
  "is_full_body": true/false,
  "has_text": true/false,
  "dominant_colors": ["#xxx", "#xxx"]
}

分类标准:
- face_portrait: 人物面部占画面主体（含半身照、头像）
- garment: 服装/穿搭为主体（可含人物但重点是衣服）
- accessory: 配饰（珠宝、手表、眼镜、包等）
- product: 非服装类产品（电子产品、食品、家居等）
- scene: 场景/背景（无明确主体）
- generic: 无法明确分类"""


async def classify_layer(
    image_base64: str,
    semantic_labels: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    LLM 视觉分类：识别分层内容的类别和特征

    Args:
        image_base64: 分层图片 base64
        semantic_labels: 已有的语义标签（来自分离阶段）

    Returns:
        LayerClassification 字段的 dict
    """
    from app.services.llm.service import get_llm_service

    llm = get_llm_service()

    # 如果有现有语义标签，注入到 prompt 中提升准确度
    extra_context = ""
    if semantic_labels:
        extra_context = f"\n\n已知信息: {json.dumps(semantic_labels, ensure_ascii=False)}"

    prompt = LAYER_CLASSIFICATION_PROMPT + extra_context

    try:
        raw = await llm.analyze_image(
            image_base64=image_base64,
            prompt=prompt,
            system_prompt=LAYER_CLASSIFICATION_SYSTEM,
        )

        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text[:-3]

        result = json.loads(text)
        logger.info(f"[LayerEnhance] 分类结果: {result.get('content_category')} / {result.get('style_hint', '')[:30]}")
        return result

    except Exception as e:
        logger.error(f"[LayerEnhance] LLM 分类失败: {e}")
        return {
            "content_category": "generic",
            "style_hint": "",
            "quality_assessment": "",
            "is_face": False,
            "is_full_body": False,
            "has_text": False,
            "dominant_colors": [],
        }


# ── Kling API 步骤执行 ───────────────────────────

async def _execute_skin_enhance(
    image_url: str,
    kling_params: Dict[str, Any],
    custom_prompt: str = "",
) -> Optional[str]:
    """执行 skin_enhance 步骤，返回结果图 URL"""
    from app.services.ai_engine_registry import AIEngineRegistry, AIEngineStatus

    engine = AIEngineRegistry.get_engine("skin_enhance")
    if engine is None:
        logger.warning("[LayerEnhance] skin_enhance 引擎未注册")
        return None

    params = {
        "image_url": image_url,
        "intensity": kling_params.get("skin_intensity", "natural"),
    }
    if custom_prompt:
        params["custom_prompt"] = custom_prompt

    try:
        result = await engine.execute(params)
        if result.status == AIEngineStatus.POLLING and result.provider_task_id:
            output_url = await _poll_engine_result(engine, result.provider_task_id)
            return output_url
        elif result.status == AIEngineStatus.COMPLETED and result.output_urls:
            return result.output_urls[0]
        else:
            logger.error(f"[LayerEnhance] skin_enhance 失败: {result.error_message}")
            return None
    except Exception as e:
        logger.error(f"[LayerEnhance] skin_enhance 异常: {e}")
        return None


async def _execute_relight(
    image_url: str,
    kling_params: Dict[str, Any],
) -> Optional[str]:
    """执行 relight 步骤，返回结果图 URL"""
    from app.services.ai_engine_registry import AIEngineRegistry, AIEngineStatus

    engine = AIEngineRegistry.get_engine("relight")
    if engine is None:
        logger.warning("[LayerEnhance] relight 引擎未注册")
        return None

    params = {
        "image_url": image_url,
        "light_type": kling_params.get("light_type", "studio"),
        "light_direction": kling_params.get("light_direction", "front"),
        "light_intensity": kling_params.get("light_intensity", 0.7),
        "keep_original_background": kling_params.get("keep_original_background", True),
        "preserve_original_subject": kling_params.get("preserve_original_subject", 0.7),
    }

    try:
        result = await engine.execute(params)
        if result.status == AIEngineStatus.POLLING and result.provider_task_id:
            output_url = await _poll_engine_result(engine, result.provider_task_id)
            return output_url
        elif result.status == AIEngineStatus.COMPLETED and result.output_urls:
            return result.output_urls[0]
        else:
            logger.error(f"[LayerEnhance] relight 失败: {result.error_message}")
            return None
    except Exception as e:
        logger.error(f"[LayerEnhance] relight 异常: {e}")
        return None


async def _execute_omni_image(
    image_url: str,
    prompt: str,
) -> Optional[str]:
    """执行 omni_image 增强步骤，返回结果图 URL"""
    from app.services.kling_ai_service import get_kling_ai_service

    service = get_kling_ai_service()

    try:
        response = await service.create_omni_image_task(
            prompt=f"<<<image_1>>> {prompt}",
            image_list=[{"image": image_url}],
            options={"model_name": "kling-image-o1", "n": 1},
        )

        task_id = response.get("data", {}).get("task_id")
        if not task_id:
            logger.error(f"[LayerEnhance] omni_image 无 task_id: {response}")
            return None

        # 轮询
        output_url = await _poll_kling_omni_image(service, task_id)
        return output_url

    except Exception as e:
        logger.error(f"[LayerEnhance] omni_image 异常: {e}")
        return None


async def _poll_engine_result(engine: Any, provider_task_id: str, timeout: int = 120) -> Optional[str]:
    """轮询引擎结果"""
    from app.services.ai_engine_registry import AIEngineStatus

    elapsed = 0
    interval = 5
    while elapsed < timeout:
        await asyncio.sleep(interval)
        elapsed += interval

        try:
            result = await engine.poll_status(provider_task_id)
            if result.status == AIEngineStatus.COMPLETED and result.output_urls:
                return result.output_urls[0]
            elif result.status == AIEngineStatus.FAILED:
                logger.error(f"[LayerEnhance] 引擎轮询失败: {result.error_message}")
                return None
        except Exception as e:
            logger.error(f"[LayerEnhance] 轮询异常: {e}")
            return None

    logger.warning(f"[LayerEnhance] 轮询超时 ({timeout}s)")
    return None


async def _poll_kling_omni_image(service: Any, task_id: str, timeout: int = 120) -> Optional[str]:
    """轮询 Kling omni_image 任务"""
    elapsed = 0
    interval = 5
    while elapsed < timeout:
        await asyncio.sleep(interval)
        elapsed += interval

        try:
            status_resp = await service.get_omni_image_task(task_id)
            data = status_resp.get("data", {})
            status = data.get("task_status")

            if status == "succeed":
                images = data.get("task_result", {}).get("images", [])
                if images:
                    return images[0].get("url")
                return None
            elif status == "failed":
                logger.error(f"[LayerEnhance] omni_image 失败: {data.get('task_status_msg')}")
                return None
        except Exception as e:
            logger.error(f"[LayerEnhance] omni_image 轮询异常: {e}")

    logger.warning(f"[LayerEnhance] omni_image 轮询超时 ({timeout}s)")
    return None


# ── 步骤路由 ──────────────────────────────────────

STEP_EXECUTORS = {
    "skin_enhance": _execute_skin_enhance,
    "relight": _execute_relight,
    "omni_image": _execute_omni_image,
}


# ── 主入口 ────────────────────────────────────────

async def enhance_layer(
    layer_image_url: str,
    task_id: str,
    semantic_labels: Optional[Dict[str, str]] = None,
    layer_image_b64: Optional[str] = None,
) -> Dict[str, Any]:
    """
    对分层图片执行自适应增强。

    Args:
        layer_image_url: 分层图片 URL（前景或背景）
        task_id: 关联的 task ID
        semantic_labels: 来自分离阶段的语义标签
        layer_image_b64: 分层图片的 base64（用于 LLM 分类 + 多模态检索）

    Returns:
        {
            "enhanced_url": "...",        # 增强后图片 URL
            "content_category": "...",    # 内容类别
            "strategy_used": "...",       # 使用的策略描述
            "steps_executed": [...],      # 执行的步骤列表
            "quality_score": float,       # 质量评估分数
        }
    """
    from app.services.enhancement_rag.schema import LayerClassification, ContentCategory

    logger.info(f"[LayerEnhance] 开始增强 task={task_id}")

    # 1. 如果没有 base64，从 URL 下载
    if not layer_image_b64:
        layer_image_b64 = await _download_image_as_b64(layer_image_url)

    # 2. LLM 视觉分类
    classification_dict = await classify_layer(layer_image_b64, semantic_labels)
    classification = LayerClassification(
        content_category=classification_dict.get("content_category", "generic"),
        style_hint=classification_dict.get("style_hint", ""),
        quality_assessment=classification_dict.get("quality_assessment", ""),
        is_face=classification_dict.get("is_face", False),
        is_full_body=classification_dict.get("is_full_body", False),
        has_text=classification_dict.get("has_text", False),
        dominant_colors=classification_dict.get("dominant_colors", []),
    )

    # 3. RAG 检索增强计划
    from app.services.enhancement_rag.retriever import get_enhancement_retriever

    retriever = get_enhancement_retriever()
    layer_description = semantic_labels.get("foreground", "") if semantic_labels else ""
    if not layer_description:
        layer_description = classification.style_hint

    plan = retriever.get_enhancement_plan(
        classification=classification,
        layer_description=layer_description,
        layer_image_b64=layer_image_b64,
    )

    if not plan.strategy:
        logger.warning(f"[LayerEnhance] 无可用策略，跳过增强 task={task_id}")
        return {
            "enhanced_url": layer_image_url,
            "content_category": classification.content_category,
            "strategy_used": "none",
            "steps_executed": [],
            "quality_score": 0.0,
        }

    # 4. 按策略步骤顺序执行
    current_url = layer_image_url
    steps_executed: List[str] = []
    pipeline = plan.strategy.pipeline_config

    for step_name in pipeline.steps:
        executor = STEP_EXECUTORS.get(step_name)
        if executor is None:
            logger.warning(f"[LayerEnhance] 未知步骤: {step_name}, 跳过")
            continue

        logger.info(f"[LayerEnhance] 执行步骤: {step_name} task={task_id}")

        if step_name == "omni_image":
            result_url = await executor(current_url, plan.final_prompt)
        elif step_name in ("skin_enhance",):
            result_url = await executor(current_url, pipeline.kling_params, plan.final_prompt)
        else:
            result_url = await executor(current_url, pipeline.kling_params)

        if result_url:
            current_url = result_url
            steps_executed.append(step_name)
            logger.info(f"[LayerEnhance] 步骤 {step_name} 完成")
        else:
            logger.warning(f"[LayerEnhance] 步骤 {step_name} 失败，使用上一步结果继续")

    # 5. 质量评估（简化版：有增强步骤则给分）
    quality_score = min(0.5 + len(steps_executed) * 0.2, 1.0)

    # 6. 高质量结果自动入库参考图库
    if quality_score >= 0.85 and steps_executed:
        await _auto_ingest_reference(
            image_url=current_url,
            category=classification.content_category.value if isinstance(classification.content_category, ContentCategory) else classification.content_category,
            style=classification.style_hint,
            description=layer_description,
            quality_score=quality_score,
        )

    result = {
        "enhanced_url": current_url,
        "content_category": classification.content_category.value if isinstance(classification.content_category, ContentCategory) else classification.content_category,
        "strategy_used": plan.strategy.description if plan.strategy else "none",
        "steps_executed": steps_executed,
        "quality_score": quality_score,
    }

    logger.info(f"[LayerEnhance] 增强完成 task={task_id} steps={steps_executed} score={quality_score}")
    return result


# ── 辅助函数 ──────────────────────────────────────

async def _download_image_as_b64(url: str) -> str:
    """下载图片并转为 base64"""
    import base64
    import httpx

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return base64.b64encode(resp.content).decode("utf-8")


async def _auto_ingest_reference(
    image_url: str,
    category: str,
    style: str,
    description: str,
    quality_score: float,
):
    """高质量增强结果自动入库参考图库"""
    try:
        from app.services.enhancement_rag.schema import QualityReference
        from app.services.enhancement_rag.vectorstore import get_enhancement_vectorstore

        ref = QualityReference(
            category=category,
            style=style or "auto_detected",
            image_url=image_url,
            description=description,
            quality_score=quality_score,
            source="auto",
        )

        store = get_enhancement_vectorstore()
        store.upsert_reference(ref)
        logger.info(f"[LayerEnhance] 自动入库参考图: {category}/{style} score={quality_score}")

    except Exception as e:
        # 入库失败不阻塞主流程
        logger.warning(f"[LayerEnhance] 自动入库失败（非阻塞）: {e}")
