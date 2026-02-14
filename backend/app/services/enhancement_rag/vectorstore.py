"""
分层增强 RAG 向量库
==================
复用火山方舟多模态 Embedding + Supabase pgvector。
提供策略检索和参考图检索两个核心能力。
"""

import logging
import uuid
import httpx
from typing import Optional, List, Dict, Any

from .schema import (
    EnhancementStrategy,
    QualityReference,
    PipelineConfig,
    ContentCategory,
    QualityTarget,
)

logger = logging.getLogger(__name__)

# ── 火山方舟 Embedding 配置 (与现有 RAG 一致) ─────
ARK_EMBEDDING_API_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal"
ARK_EMBEDDING_MODEL = "doubao-embedding-vision-250615"
EMBEDDING_DIMENSION = 1024

_ark_api_key: Optional[str] = None


def _get_ark_api_key() -> str:
    global _ark_api_key
    if _ark_api_key is None:
        from app.config import get_settings
        settings = get_settings()
        _ark_api_key = settings.volcengine_ark_api_key
        if not _ark_api_key:
            raise ValueError("未配置 volcengine_ark_api_key")
    return _ark_api_key


# ── Embedding 生成 ────────────────────────────────

def generate_text_embedding(text: str) -> List[float]:
    """纯文本 embedding"""
    api_key = _get_ark_api_key()
    payload = {
        "model": ARK_EMBEDDING_MODEL,
        "input": [{"type": "text", "text": text}],
        "encoding_format": "float",
        "dimensions": EMBEDDING_DIMENSION,
    }
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                ARK_EMBEDDING_API_URL,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
            )
            resp.raise_for_status()
            return resp.json()["data"]["embedding"]
    except Exception as e:
        logger.error(f"[EnhancementRAG] 文本 embedding 失败: {e}")
        raise


def generate_multimodal_embedding(text: str, image_base64: Optional[str] = None) -> List[float]:
    """多模态 embedding（文本 + 可选图片）"""
    api_key = _get_ark_api_key()
    input_items: List[Dict[str, Any]] = [{"type": "text", "text": text}]
    if image_base64:
        input_items.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
        })

    payload = {
        "model": ARK_EMBEDDING_MODEL,
        "input": input_items,
        "encoding_format": "float",
        "dimensions": EMBEDDING_DIMENSION,
    }
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                ARK_EMBEDDING_API_URL,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
            )
            resp.raise_for_status()
            return resp.json()["data"]["embedding"]
    except Exception as e:
        logger.error(f"[EnhancementRAG] 多模态 embedding 失败: {e}")
        raise


def _embedding_to_pg(embedding: List[float]) -> str:
    """转为 pgvector 字符串格式 [x,y,z]"""
    return "[" + ",".join(str(x) for x in embedding) + "]"


# ── VectorStore ───────────────────────────────────

class EnhancementVectorStore:
    """增强策略 + 质量参考图 向量库"""

    STRATEGY_TABLE = "enhancement_strategies"
    REFERENCE_TABLE = "quality_references"

    def __init__(self):
        self._client = None

    @property
    def client(self):
        if self._client is None:
            from app.services.supabase_client import get_supabase_client
            self._client = get_supabase_client()
        return self._client

    # ── 策略 CRUD ─────────────────────────────────

    def upsert_strategy(self, strategy: EnhancementStrategy, embedding: Optional[List[float]] = None) -> str:
        """插入/更新增强策略"""
        if embedding is None:
            embedding = generate_text_embedding(strategy.description)

        sid = strategy.id or str(uuid.uuid4())
        row = {
            "id": sid,
            "content_category": strategy.content_category.value if isinstance(strategy.content_category, ContentCategory) else strategy.content_category,
            "quality_target": strategy.quality_target.value if isinstance(strategy.quality_target, QualityTarget) else strategy.quality_target,
            "description": strategy.description,
            "pipeline_config": strategy.pipeline_config.model_dump() if isinstance(strategy.pipeline_config, PipelineConfig) else strategy.pipeline_config,
            "metadata": strategy.metadata,
            "embedding": _embedding_to_pg(embedding),
        }
        try:
            self.client.table(self.STRATEGY_TABLE).upsert(row).execute()
            logger.info(f"[EnhancementRAG] upsert 策略: {sid} ({strategy.content_category})")
            return sid
        except Exception as e:
            logger.error(f"[EnhancementRAG] upsert 策略失败: {e}")
            raise

    def upsert_strategies_batch(self, strategies: List[EnhancementStrategy]) -> List[str]:
        """批量插入策略"""
        if not strategies:
            return []

        embeddings = [generate_text_embedding(s.description) for s in strategies]
        ids = []
        rows = []
        for s, emb in zip(strategies, embeddings):
            sid = s.id or str(uuid.uuid4())
            ids.append(sid)
            rows.append({
                "id": sid,
                "content_category": s.content_category.value if isinstance(s.content_category, ContentCategory) else s.content_category,
                "quality_target": s.quality_target.value if isinstance(s.quality_target, QualityTarget) else s.quality_target,
                "description": s.description,
                "pipeline_config": s.pipeline_config.model_dump() if isinstance(s.pipeline_config, PipelineConfig) else s.pipeline_config,
                "metadata": s.metadata,
                "embedding": _embedding_to_pg(emb),
            })

        try:
            self.client.table(self.STRATEGY_TABLE).upsert(rows).execute()
            logger.info(f"[EnhancementRAG] 批量 upsert {len(rows)} 条策略")
            return ids
        except Exception as e:
            logger.error(f"[EnhancementRAG] 批量 upsert 策略失败: {e}")
            raise

    # ── 参考图 CRUD ───────────────────────────────

    def upsert_reference(self, ref: QualityReference, embedding: Optional[List[float]] = None, image_base64: Optional[str] = None) -> str:
        """插入/更新参考图"""
        if embedding is None:
            if image_base64:
                embedding = generate_multimodal_embedding(ref.description, image_base64)
            else:
                embedding = generate_text_embedding(ref.description)

        rid = ref.id or str(uuid.uuid4())
        row = {
            "id": rid,
            "category": ref.category,
            "style": ref.style,
            "image_url": ref.image_url,
            "description": ref.description,
            "quality_score": ref.quality_score,
            "source": ref.source,
            "metadata": ref.metadata,
            "embedding": _embedding_to_pg(embedding),
        }
        try:
            self.client.table(self.REFERENCE_TABLE).upsert(row).execute()
            logger.info(f"[EnhancementRAG] upsert 参考图: {rid} ({ref.category}/{ref.style})")
            return rid
        except Exception as e:
            logger.error(f"[EnhancementRAG] upsert 参考图失败: {e}")
            raise

    # ── 策略检索 ──────────────────────────────────

    def search_strategies(
        self,
        query_text: str,
        category: Optional[str] = None,
        top_k: int = 3,
        threshold: float = 0.3,
    ) -> List[EnhancementStrategy]:
        """语义检索增强策略"""
        query_embedding = generate_text_embedding(query_text)
        query_str = _embedding_to_pg(query_embedding)

        try:
            result = self.client.rpc("match_enhancement_strategies", {
                "query_embedding": query_str,
                "match_count": top_k,
                "match_threshold": threshold,
                "filter_category": category,
            }).execute()

            strategies = []
            for row in result.data:
                strategies.append(EnhancementStrategy(
                    id=row["id"],
                    content_category=row["content_category"],
                    quality_target=row["quality_target"],
                    description=row["description"],
                    pipeline_config=PipelineConfig(**row["pipeline_config"]) if isinstance(row["pipeline_config"], dict) else row["pipeline_config"],
                    metadata=row.get("metadata", {}),
                    similarity=row.get("similarity", 0.0),
                ))
            logger.debug(f"[EnhancementRAG] 策略检索返回 {len(strategies)} 条")
            return strategies

        except Exception as e:
            logger.error(f"[EnhancementRAG] 策略检索失败: {e}")
            return []

    # ── 参考图检索 ────────────────────────────────

    def search_references(
        self,
        query_text: str,
        category: Optional[str] = None,
        style: Optional[str] = None,
        top_k: int = 3,
        threshold: float = 0.3,
        query_image_b64: Optional[str] = None,
    ) -> List[QualityReference]:
        """语义检索质量参考图（支持多模态查询）"""
        if query_image_b64:
            query_embedding = generate_multimodal_embedding(query_text, query_image_b64)
        else:
            query_embedding = generate_text_embedding(query_text)
        query_str = _embedding_to_pg(query_embedding)

        try:
            result = self.client.rpc("match_quality_references", {
                "query_embedding": query_str,
                "match_count": top_k,
                "match_threshold": threshold,
                "filter_category": category,
                "filter_style": style,
            }).execute()

            refs = []
            for row in result.data:
                refs.append(QualityReference(
                    id=row["id"],
                    category=row["category"],
                    style=row["style"],
                    image_url=row["image_url"],
                    description=row["description"],
                    quality_score=row.get("quality_score", 1.0),
                    similarity=row.get("similarity", 0.0),
                ))
            logger.debug(f"[EnhancementRAG] 参考图检索返回 {len(refs)} 条")
            return refs

        except Exception as e:
            logger.error(f"[EnhancementRAG] 参考图检索失败: {e}")
            return []


# ── 单例 ──────────────────────────────────────────

_instance: Optional[EnhancementVectorStore] = None


def get_enhancement_vectorstore() -> EnhancementVectorStore:
    global _instance
    if _instance is None:
        _instance = EnhancementVectorStore()
    return _instance
