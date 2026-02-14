"""
Prompt Library API
==================
POST /api/prompt-library/seed          - 从 JSON 文件批量入库（生成 embedding）
GET  /api/prompt-library               - 列出 prompt（分页 + 三维筛选）
GET  /api/prompt-library/search        - 语义检索 prompt
POST /api/prompt-library               - 手动添加一条 prompt
DELETE /api/prompt-library/{prompt_id}  - 删除
GET  /api/prompt-library/stats         - 统计各维度数量
"""

import logging
import uuid
import json
import os
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/prompt-library", tags=["Prompt Library"])


# ── 请求/响应 Schema ──────────────────────────

class PromptCreateRequest(BaseModel):
    capability: str = Field(..., description="能力: omni_image / relight / outfit_swap 等")
    platform: str = Field(default="universal", description="平台: douyin / xiaohongshu / bilibili / weibo / universal")
    input_type: str = Field(default="universal", description="输入类型: ecommerce / selfie / street_snap / runway / universal")
    prompt: str = Field(..., description="完整英文 prompt")
    negative_prompt: str = Field(default="", description="Negative prompt")
    label: str = Field(default="", description="中文展示标签")
    source: str = Field(default="manual", description="来源: scraped / manual / llm_generated")
    quality_score: float = Field(default=0.8, ge=0.0, le=1.0)


class PromptItem(BaseModel):
    id: str
    capability: str
    platform: str
    input_type: str
    prompt: str
    negative_prompt: str
    label: str
    source: str
    quality_score: float
    similarity: Optional[float] = None
    created_at: Optional[str] = None


# ── 列出 ──────────────────────────────────────

@router.get("")
async def list_prompts(
    capability: Optional[str] = None,
    platform: Optional[str] = None,
    input_type: Optional[str] = None,
    source: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user_id: str = Depends(get_current_user_id),
):
    """列出 prompt（分页 + 三维筛选）"""
    try:
        from app.services.supabase_client import supabase

        query = supabase.table("prompt_library").select(
            "id, capability, platform, input_type, prompt, negative_prompt, label, source, quality_score, created_at"
        ).order("quality_score", desc=True).order("created_at", desc=True)

        if capability:
            query = query.eq("capability", capability)
        if platform:
            query = query.eq("platform", platform)
        if input_type:
            query = query.eq("input_type", input_type)
        if source:
            query = query.eq("source", source)

        offset = (page - 1) * page_size
        query = query.range(offset, offset + page_size - 1)
        result = query.execute()

        return {"success": True, "data": result.data or []}

    except Exception as e:
        logger.error(f"[PromptLibrary] 列出失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 统计 ──────────────────────────────────────

@router.get("/stats")
async def get_stats(
    user_id: str = Depends(get_current_user_id),
):
    """统计各维度的 prompt 数量"""
    try:
        from app.services.supabase_client import supabase

        # 总数
        total_result = supabase.table("prompt_library").select("id", count="exact").execute()
        total = total_result.count or 0

        # 按 capability 统计
        cap_result = supabase.table("prompt_library").select("capability").execute()
        cap_counts: dict = {}
        for row in (cap_result.data or []):
            c = row["capability"]
            cap_counts[c] = cap_counts.get(c, 0) + 1

        # 按 platform 统计
        plat_result = supabase.table("prompt_library").select("platform").execute()
        plat_counts: dict = {}
        for row in (plat_result.data or []):
            p = row["platform"]
            plat_counts[p] = plat_counts.get(p, 0) + 1

        return {"success": True, "data": {
            "total": total,
            "by_capability": cap_counts,
            "by_platform": plat_counts,
        }}

    except Exception as e:
        logger.error(f"[PromptLibrary] 统计失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 语义检索 ──────────────────────────────────

@router.get("/search")
async def search_prompts(
    query: str,
    capability: Optional[str] = None,
    platform: Optional[str] = None,
    input_type: Optional[str] = None,
    top_k: int = Query(default=10, ge=1, le=50),
    user_id: str = Depends(get_current_user_id),
):
    """语义检索 prompt"""
    try:
        from app.services.enhancement_rag.vectorstore import (
            generate_text_embedding,
            _embedding_to_pg,
        )
        from app.services.supabase_client import supabase

        query_embedding = generate_text_embedding(query)
        query_str = _embedding_to_pg(query_embedding)

        result = supabase.rpc("match_prompt_library", {
            "query_embedding": query_str,
            "match_count": top_k,
            "match_threshold": 0.3,
            "filter_capability": capability,
            "filter_platform": platform,
            "filter_input_type": input_type,
        }).execute()

        return {"success": True, "data": result.data or []}

    except Exception as e:
        logger.error(f"[PromptLibrary] 语义检索失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 添加 ──────────────────────────────────────

@router.post("")
async def add_prompt(
    request: PromptCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """手动添加一条 prompt 到向量库"""
    try:
        from app.services.enhancement_rag.vectorstore import (
            generate_text_embedding,
            _embedding_to_pg,
        )
        from app.services.supabase_client import supabase

        embedding = generate_text_embedding(request.prompt)
        pid = str(uuid.uuid4())

        row = {
            "id": pid,
            "capability": request.capability,
            "platform": request.platform,
            "input_type": request.input_type,
            "prompt": request.prompt,
            "negative_prompt": request.negative_prompt,
            "label": request.label,
            "source": request.source,
            "quality_score": request.quality_score,
            "metadata": {},
            "embedding": _embedding_to_pg(embedding),
        }

        supabase.table("prompt_library").upsert(row).execute()
        logger.info(f"[PromptLibrary] 添加 prompt: {pid} ({request.capability}/{request.platform})")

        return {"success": True, "data": {"id": pid}}

    except Exception as e:
        logger.error(f"[PromptLibrary] 添加失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 删除 ──────────────────────────────────────

@router.delete("/{prompt_id}")
async def delete_prompt(
    prompt_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """删除一条 prompt"""
    try:
        from app.services.supabase_client import supabase

        supabase.table("prompt_library").delete().eq("id", prompt_id).execute()

        return {"success": True, "data": {"id": prompt_id}}

    except Exception as e:
        logger.error(f"[PromptLibrary] 删除失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 种子入库 ──────────────────────────────────

@router.post("/seed")
async def seed_prompts(
    user_id: str = Depends(get_current_user_id),
):
    """从 fashion_prompts.json 批量入库（生成 embedding + 写入向量库）"""
    try:
        from app.services.enhancement_rag.vectorstore import (
            generate_text_embedding,
            _embedding_to_pg,
        )
        from app.services.supabase_client import supabase

        # 查找 JSON 文件
        seed_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "scripts", "fashion_prompts.json"
        )
        seed_path = os.path.normpath(seed_path)

        if not os.path.exists(seed_path):
            raise HTTPException(status_code=404, detail=f"种子文件不存在: {seed_path}")

        with open(seed_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        default_neg = data.get("meta", {}).get("default_negative_prompt", "")
        total_inserted = 0
        errors = 0

        for cap_id, cap_data in data.get("capabilities", {}).items():
            # universal 版本
            universal_prompts = cap_data.get("universal", {}).get("prompts", [])
            universal_neg = cap_data.get("universal", {}).get("negative_prompt", default_neg)

            for prompt_text in universal_prompts[:100]:  # 每能力最多 100 条 universal
                try:
                    embedding = generate_text_embedding(prompt_text)
                    row = {
                        "id": str(uuid.uuid4()),
                        "capability": cap_id,
                        "platform": "universal",
                        "input_type": "universal",
                        "prompt": prompt_text,
                        "negative_prompt": universal_neg,
                        "label": "",
                        "source": "scraped",
                        "quality_score": 0.8,
                        "metadata": {},
                        "embedding": _embedding_to_pg(embedding),
                    }
                    supabase.table("prompt_library").insert(row).execute()
                    total_inserted += 1
                except Exception as e:
                    logger.warning(f"[PromptLibrary] seed 单条失败: {e}")
                    errors += 1

            # 按平台×输入 版本（每个组合最多 10 条）
            for plat_id, plat_data in cap_data.get("by_platform", {}).items():
                for input_id, input_data in plat_data.get("by_input_type", {}).items():
                    neg = input_data.get("negative_prompt", default_neg)
                    for prompt_text in input_data.get("prompts", [])[:10]:
                        try:
                            embedding = generate_text_embedding(prompt_text)
                            row = {
                                "id": str(uuid.uuid4()),
                                "capability": cap_id,
                                "platform": plat_id,
                                "input_type": input_id,
                                "prompt": prompt_text,
                                "negative_prompt": neg,
                                "label": "",
                                "source": "scraped",
                                "quality_score": 0.75,
                                "metadata": {},
                                "embedding": _embedding_to_pg(embedding),
                            }
                            supabase.table("prompt_library").insert(row).execute()
                            total_inserted += 1
                        except Exception as e:
                            logger.warning(f"[PromptLibrary] seed 单条失败: {e}")
                            errors += 1

        logger.info(f"[PromptLibrary] seed 完成: {total_inserted} 条入库, {errors} 条失败")
        return {"success": True, "data": {
            "total_inserted": total_inserted,
            "errors": errors,
        }}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[PromptLibrary] seed 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
