"""
增强 RAG 管理 API
=================
POST /api/enhancement-rag/strategies            - 添加增强策略
GET  /api/enhancement-rag/strategies/search      - 语义检索策略
POST /api/enhancement-rag/references             - 添加参考图（JSON）
POST /api/enhancement-rag/references/upload      - 上传参考图（multipart）
GET  /api/enhancement-rag/references             - 列出参考图
GET  /api/enhancement-rag/references/search      - 语义检索参考图
DELETE /api/enhancement-rag/references/{ref_id}  - 删除参考图
POST /api/enhancement-rag/seed                   - 执行种子数据入库
"""

import logging
import uuid
import io
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form
from pydantic import BaseModel, Field

from app.api.auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/enhancement-rag", tags=["Enhancement RAG"])


# ── 请求/响应 Schema ──────────────────────────

class StrategyCreateRequest(BaseModel):
    content_category: str = Field(..., description="内容类别: face_portrait/garment/accessory/product/scene/generic")
    quality_target: str = Field(default="realistic_casual", description="质量目标: fashion_editorial/product_catalog/realistic_casual/cinematic")
    description: str = Field(..., description="策略描述（也用于生成 embedding）")
    pipeline_config: dict = Field(..., description="管线配置: { steps: [...], kling_params: {...}, prompt_template: '...' }")


class ReferenceCreateRequest(BaseModel):
    category: str = Field(..., description="内容类别")
    style: str = Field(default="auto_detected", description="风格标签")
    image_url: str = Field(..., description="参考图 URL")
    description: str = Field(..., description="参考图描述")
    quality_score: float = Field(default=0.9, ge=0.0, le=1.0, description="质量评分")


class SearchRequest(BaseModel):
    query: str = Field(..., description="搜索文本")
    category: Optional[str] = Field(None, description="过滤类别")
    top_k: int = Field(default=5, ge=1, le=20)


# ── 策略端点 ──────────────────────────────────

@router.post("/strategies")
async def add_strategy(
    request: StrategyCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """添加一条增强策略到向量库"""
    try:
        from app.services.enhancement_rag.schema import EnhancementStrategy, PipelineConfig
        from app.services.enhancement_rag.vectorstore import get_enhancement_vectorstore

        strategy = EnhancementStrategy(
            content_category=request.content_category,
            quality_target=request.quality_target,
            description=request.description,
            pipeline_config=PipelineConfig(**request.pipeline_config),
        )

        store = get_enhancement_vectorstore()
        strategy_id = store.upsert_strategy(strategy)

        return {"success": True, "data": {"id": strategy_id}}

    except Exception as e:
        logger.error(f"[EnhancementRAG] 添加策略失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/strategies/search")
async def search_strategies(
    query: str,
    category: Optional[str] = None,
    top_k: int = 5,
    user_id: str = Depends(get_current_user_id),
):
    """语义检索增强策略"""
    try:
        from app.services.enhancement_rag.vectorstore import get_enhancement_vectorstore

        store = get_enhancement_vectorstore()
        results = store.search_strategies(
            query_text=query,
            category=category,
            top_k=top_k,
        )

        data = []
        for r in results:
            data.append({
                "id": str(r.id) if r.id else None,
                "content_category": r.content_category.value if hasattr(r.content_category, 'value') else r.content_category,
                "quality_target": r.quality_target.value if hasattr(r.quality_target, 'value') else r.quality_target,
                "description": r.description,
                "pipeline_config": r.pipeline_config.model_dump() if r.pipeline_config else None,
                "similarity": r.similarity,
            })

        return {"success": True, "data": data}

    except Exception as e:
        logger.error(f"[EnhancementRAG] 检索策略失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 参考图端点 ────────────────────────────────

REFERENCE_ANALYSIS_SYSTEM = """你是AI视觉创作平台的素材评估专家。
我们的平台帮助内容创作者（抖音变装KOL、小红书穿搭博主、电商运营、短视频创作者）用AI生成变装/增强视频。
你的任务是评估上传图片作为「AI变装/增强参考标杆」的价值——不是评价摄影艺术，而是评价这张图对AI生成管线的指导价值。
只返回有效 JSON，不要额外解释。"""

REFERENCE_ANALYSIS_PROMPT = """请评估这张图片作为「AI变装/增强参考标杆图」的价值，返回 JSON:

{
  "category": "face_portrait" | "garment" | "accessory" | "product" | "scene" | "generic",
  "source_type": "ecommerce" | "social_ugc" | "kol_content" | "fashion_media" | "brand_official" | "studio_professional" | "user_review" | "unknown",
  "applicable_platforms": ["douyin", "xiaohongshu", "bilibili", "weibo", "ecommerce", "universal"],
  "style": "风格标签",
  "description": "50-80字的中文描述，聚焦：图像内容 + 主体特征 + 作为AI参考的核心价值",
  "quality_score": 0.0-1.0,
  "quality_reasoning": "简要说明评分理由（侧重AI参考价值，不是摄影艺术）"
}

═══ 内容类别 ═══
- face_portrait: 人物面部/半身照为主体（证件照、杂志封面、肖像、自拍）
- garment: 服装/穿搭为主体（电商平铺图、模特穿搭、秀场图、变装前后）
- accessory: 配饰为主体（珠宝、手表、眼镜、包、鞋等）
- product: 非服装类产品（电子、食品、化妆品、家居等）
- scene: 场景/环境/背景
- generic: 无法归入以上类别

═══ 素材来源 ═══
- ecommerce: 电商平台商品图（淘宝/京东/ZARA等主图、详情图、多角度图）
- social_ugc: 社交平台普通用户内容（小红书素人穿搭、朋友圈、普通买家秀）
- kol_content: KOL/博主专业内容（头部穿搭博主、时尚KOL的精修内容）
- fashion_media: 时尚资讯媒体（Vogue/Elle/GQ等秀场图、时尚大片、编辑内容）
- brand_official: 品牌官方素材（品牌Campaign、官方Lookbook、广告素材）
- studio_professional: 影棚专业拍摄（商业棚拍、模特卡、产品硬照）
- user_review: 购物评价图（买家实拍、真人上身评价）
- unknown: 来源不明

═══ 适用平台（数组，可多选）═══
- douyin: 抖音/快手（15-30秒变装视频、特效挑战赛）
- xiaohongshu: 小红书（图文穿搭笔记、教程、素人测评）
- bilibili: B站（深度测评、技术解析、教程类）
- weibo: 微博（前后对比图、明星合作、话题传播）
- ecommerce: 电商详情页（商品主图增强、模特换装）
- universal: 通用（跨平台适用）

═══ 质量评分标准——AI参考价值分 ═══
注意：这不是摄影艺术评分，而是「作为AI增强/变装管线参考标杆的实用价值分」。
一张清晰的淘宝主图虽不是VOGUE级摄影，但如果主体清晰、细节丰富、易于AI理解和参考，就该获得高分。

【核心评判维度】
1. 主体清晰度（40%权重）：主体是否锐利清晰？边缘是否分明？直接影响抠图/分割/AI理解质量
2. 细节信息量（25%权重）：服装纹理/面部特征/产品细节是否丰富？AI能否从中提取足够参考信息？
3. 风格代表性（20%权重）：在其细分领域中，这张图是否具有代表性？能否作为该类型的视觉标杆？
4. 技术可用性（15%权重）：分辨率、曝光、白平衡等技术指标是否满足AI处理需求？

【评分区间】
- 0.90-1.0: 顶级参考素材
  主体极其清晰锐利、细节丰富到位、在其领域具有强代表性、分辨率充足
  例：清晰的电商ZARA主图（服装纹理、版型一目了然）、头部穿搭KOL的精修全身照、专业影棚白底产品图
- 0.75-0.89: 优质参考素材
  主体清晰、光线适当、有足够的细节供AI参考、风格鲜明
  例：优质小红书穿搭博主图、品牌官方Lookbook、良好光线下的街拍
- 0.60-0.74: 可用参考素材
  有参考价值但存在明显不足（背景杂乱影响主体、光线不均、分辨率偏低、部分遮挡）
  例：普通素人穿搭图、一般买家秀、手机随拍但主体尚可辨识
- 0.40-0.59: 勉强可用
  信息量有限、主体不够清晰、仅在缺少更好素材时使用
- <0.40: 不推荐入库
  模糊、过曝/欠曝严重、主体无法识别

═══ style 风格标签 ═══
- 人像: fashion_editorial / studio_portrait / natural_portrait / id_photo / kol_selfie / street_snap
- 服装: ecommerce_flat / ecommerce_model / runway / street_style / lookbook / outfit_change / try_on_haul
- 配饰: detail_shot / styling_shot / flat_lay
- 产品: white_bg_product / lifestyle_product / unboxing / comparison
- 场景: interior / outdoor / studio_set / urban / cinematic"""


@router.post("/references/analyze")
async def analyze_reference_image(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """上传图片 → LLM 自动分析类别、描述、质量分、风格"""
    import base64

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片文件")

    try:
        from app.services.llm.service import get_llm_service
        import json as json_mod

        content = await file.read()
        image_b64 = base64.b64encode(content).decode("utf-8")

        llm = get_llm_service()
        raw = await llm.analyze_image(
            image_base64=image_b64,
            prompt=REFERENCE_ANALYSIS_PROMPT,
            system_prompt=REFERENCE_ANALYSIS_SYSTEM,
        )

        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text[:-3]

        result = json_mod.loads(text)

        # 确保必要字段
        result.setdefault("category", "generic")
        result.setdefault("source_type", "unknown")
        result.setdefault("applicable_platforms", ["universal"])
        result.setdefault("style", "auto_detected")
        result.setdefault("description", "")
        result.setdefault("quality_score", 0.7)
        result.setdefault("quality_reasoning", "")

        # 将 base64 传回前端用于后续入库（避免重复上传）
        result["image_base64"] = image_b64
        result["file_name"] = file.filename
        result["content_type"] = file.content_type

        return {"success": True, "data": result}

    except Exception as e:
        logger.error(f"[EnhancementRAG] 分析参考图失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/references/confirm")
async def confirm_reference(
    category: str = Form(...),
    description: str = Form(...),
    style: str = Form("auto_detected"),
    quality_score: float = Form(0.9),
    source_type: str = Form("unknown"),
    applicable_platforms: str = Form("universal"),
    image_base64: str = Form(...),
    file_name: str = Form("image.jpg"),
    content_type: str = Form("image/jpeg"),
    user_id: str = Depends(get_current_user_id),
):
    """确认分析结果并入库（接收 base64 避免重复上传文件）"""
    import base64

    try:
        from app.services.supabase_client import supabase
        from app.services.enhancement_rag.schema import QualityReference
        from app.services.enhancement_rag.vectorstore import get_enhancement_vectorstore

        # 解码 base64
        image_bytes = base64.b64decode(image_base64)
        ext = file_name.rsplit(".", 1)[-1] if "." in file_name else "jpg"
        storage_path = f"enhancement-references/{category}/{uuid.uuid4().hex}.{ext}"

        # 上传到 Supabase Storage
        supabase.storage.from_("ai-creations").upload(
            storage_path,
            image_bytes,
            {"content-type": content_type},
        )
        image_url = supabase.storage.from_("ai-creations").get_public_url(storage_path)

        # 解析平台列表（前端传逗号分隔字符串）
        platforms = [p.strip() for p in applicable_platforms.split(",") if p.strip()]

        # 入库向量（用图片做多模态 embedding）
        ref = QualityReference(
            category=category,
            style=style,
            image_url=image_url,
            description=description,
            quality_score=quality_score,
            source="manual",
            metadata={
                "source_type": source_type,
                "applicable_platforms": platforms,
            },
        )

        store = get_enhancement_vectorstore()
        ref_id = store.upsert_reference(ref, image_base64=image_base64)

        return {"success": True, "data": {
            "id": ref_id,
            "image_url": image_url,
            "category": category,
            "description": description,
            "quality_score": quality_score,
            "source_type": source_type,
            "applicable_platforms": platforms,
        }}

    except Exception as e:
        logger.error(f"[EnhancementRAG] 确认入库失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/references")
async def add_reference(
    request: ReferenceCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """添加一条质量参考图到向量库"""
    try:
        from app.services.enhancement_rag.schema import QualityReference
        from app.services.enhancement_rag.vectorstore import get_enhancement_vectorstore

        ref = QualityReference(
            category=request.category,
            style=request.style,
            image_url=request.image_url,
            description=request.description,
            quality_score=request.quality_score,
            source="manual",
        )

        store = get_enhancement_vectorstore()
        ref_id = store.upsert_reference(ref)

        return {"success": True, "data": {"id": ref_id}}

    except Exception as e:
        logger.error(f"[EnhancementRAG] 添加参考图失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/references/search")
async def search_references(
    query: str,
    category: Optional[str] = None,
    top_k: int = 5,
    user_id: str = Depends(get_current_user_id),
):
    """语义检索质量参考图"""
    try:
        from app.services.enhancement_rag.vectorstore import get_enhancement_vectorstore

        store = get_enhancement_vectorstore()
        results = store.search_references(
            query_text=query,
            category=category,
            top_k=top_k,
        )

        data = []
        for r in results:
            data.append({
                "id": str(r.id) if r.id else None,
                "category": r.category,
                "style": r.style,
                "image_url": r.image_url,
                "description": r.description,
                "quality_score": r.quality_score,
                "source": r.source,
                "similarity": r.similarity,
            })

        return {"success": True, "data": data}

    except Exception as e:
        logger.error(f"[EnhancementRAG] 检索参考图失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/references/upload")
async def upload_reference(
    file: UploadFile = File(...),
    category: str = Form(...),
    description: str = Form(...),
    style: str = Form("auto_detected"),
    quality_score: float = Form(0.9),
    user_id: str = Depends(get_current_user_id),
):
    """上传参考图文件 → 存到 Supabase Storage → 生成 embedding → 入库"""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片文件")

    try:
        from app.services.supabase_client import supabase
        from app.services.enhancement_rag.schema import QualityReference
        from app.services.enhancement_rag.vectorstore import get_enhancement_vectorstore

        # 读取文件
        content = await file.read()
        ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg"
        storage_path = f"enhancement-references/{category}/{uuid.uuid4().hex}.{ext}"

        # 上传到 Supabase Storage
        supabase.storage.from_("ai-creations").upload(
            storage_path,
            content,
            {"content-type": file.content_type or "image/jpeg"},
        )
        image_url = supabase.storage.from_("ai-creations").get_public_url(storage_path)

        # 入库向量
        ref = QualityReference(
            category=category,
            style=style,
            image_url=image_url,
            description=description,
            quality_score=quality_score,
            source="manual",
        )

        store = get_enhancement_vectorstore()
        ref_id = store.upsert_reference(ref)

        return {"success": True, "data": {
            "id": ref_id,
            "image_url": image_url,
            "category": category,
            "description": description,
        }}

    except Exception as e:
        logger.error(f"[EnhancementRAG] 上传参考图失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/references")
async def list_references(
    category: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    user_id: str = Depends(get_current_user_id),
):
    """列出质量参考图"""
    try:
        from app.services.supabase_client import supabase

        query = supabase.table("quality_references").select(
            "id, category, style, image_url, description, quality_score, source, created_at"
        ).order("created_at", desc=True)

        if category:
            query = query.eq("category", category)

        offset = (page - 1) * page_size
        query = query.range(offset, offset + page_size - 1)
        result = query.execute()

        return {"success": True, "data": result.data or []}

    except Exception as e:
        logger.error(f"[EnhancementRAG] 列出参考图失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/references/{ref_id}")
async def delete_reference(
    ref_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """删除质量参考图"""
    try:
        from app.services.supabase_client import supabase

        # 获取记录以删除 Storage 文件
        record = supabase.table("quality_references").select("image_url").eq("id", ref_id).execute()
        if record.data:
            image_url = record.data[0].get("image_url", "")
            # 尝试从 URL 提取 storage path 并删除
            if "enhancement-references/" in image_url:
                path = image_url.split("ai-creations/")[-1].split("?")[0]
                try:
                    supabase.storage.from_("ai-creations").remove([path])
                except Exception:
                    pass  # Storage 删除失败不阻塞

        supabase.table("quality_references").delete().eq("id", ref_id).execute()

        return {"success": True, "data": {"id": ref_id}}

    except Exception as e:
        logger.error(f"[EnhancementRAG] 删除参考图失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 种子数据端点 ──────────────────────────────

@router.post("/seed")
async def seed_strategies(
    user_id: str = Depends(get_current_user_id),
):
    """执行种子数据入库（从 enhancement_seeds.json 读取）"""
    import json
    import os

    try:
        from app.services.enhancement_rag.schema import EnhancementStrategy, PipelineConfig
        from app.services.enhancement_rag.vectorstore import get_enhancement_vectorstore

        seed_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "scripts", "enhancement_seeds.json"
        )
        seed_path = os.path.normpath(seed_path)

        if not os.path.exists(seed_path):
            raise HTTPException(status_code=404, detail=f"种子文件不存在: {seed_path}")

        with open(seed_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        strategies = []
        for item in data.get("strategies", []):
            strategies.append(EnhancementStrategy(
                content_category=item["content_category"],
                quality_target=item["quality_target"],
                description=item["description"],
                pipeline_config=PipelineConfig(**item["pipeline_config"]),
            ))

        store = get_enhancement_vectorstore()
        ids = store.upsert_strategies_batch(strategies)

        return {"success": True, "data": {"count": len(ids), "ids": ids}}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[EnhancementRAG] 种子入库失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
