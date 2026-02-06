"""
RAG 向量数据库管理 - Supabase pgvector 版本

使用 Supabase 的 pgvector 扩展 + 火山方舟 Embedding API
彻底移除 HuggingFace / sentence-transformers 依赖
"""

import logging
import httpx
from typing import Optional, List, Dict, Any

from .schema import (
    BenchmarkSegment,
    BenchmarkSource,
    VisualConfigSnippet,
    RAGQueryResult,
    LayoutMode,
)

logger = logging.getLogger(__name__)

# ============================================
# 火山方舟 Embedding 配置 (多模态向量化)
# ============================================
ARK_EMBEDDING_API_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal"
ARK_EMBEDDING_MODEL = "doubao-embedding-vision-250615"
EMBEDDING_DIMENSION = 1024  # 使用 1024 维度 (IVFFlat 索引最大支持 2000)
TABLE_NAME = "benchmark_segments"

# API Key 缓存
_ark_api_key: Optional[str] = None


def _get_ark_api_key() -> str:
    """获取火山方舟 API Key"""
    global _ark_api_key
    if _ark_api_key is None:
        from app.config import get_settings
        settings = get_settings()
        _ark_api_key = settings.volcengine_ark_api_key
        if not _ark_api_key:
            raise ValueError("未配置 volcengine_ark_api_key，请在 .env 中设置")
    return _ark_api_key


def generate_embedding(text: str) -> List[float]:
    """
    使用火山方舟多模态 Embedding API 生成文本向量
    
    Args:
        text: 输入文本
        
    Returns:
        向量列表 (2048维)
    """
    api_key = _get_ark_api_key()
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    
    # 多模态 API 格式
    payload = {
        "model": ARK_EMBEDDING_MODEL,
        "input": [
            {
                "type": "text",
                "text": text
            }
        ],
        "encoding_format": "float",
        "dimensions": EMBEDDING_DIMENSION,
    }
    
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(ARK_EMBEDDING_API_URL, json=payload, headers=headers)
            response.raise_for_status()
            
            result = response.json()
            embedding = result["data"]["embedding"]
            
            logger.debug(f"[Embedding] 生成向量成功, 维度: {len(embedding)}")
            return embedding
            
    except httpx.HTTPStatusError as e:
        logger.error(f"[Embedding] API 请求失败: {e.response.status_code} - {e.response.text}")
        raise
    except Exception as e:
        logger.error(f"[Embedding] 生成向量失败: {e}")
        raise


def generate_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """
    批量生成文本向量 (多模态 API 每次只能处理一个输入)
    
    Args:
        texts: 输入文本列表
        
    Returns:
        向量列表的列表
    """
    if not texts:
        return []
    
    all_embeddings = []
    
    for i, text in enumerate(texts):
        try:
            embedding = generate_embedding(text)
            all_embeddings.append(embedding)
            
            if (i + 1) % 10 == 0:
                logger.info(f"[Embedding] 已生成 {i + 1}/{len(texts)} 个向量")
                
        except Exception as e:
            logger.error(f"[Embedding] 第 {i} 个文本生成失败: {e}")
            raise
    
    return all_embeddings


class RAGVectorStore:
    """
    RAG 向量存储管理器 - Supabase pgvector 版本
    
    使用 Supabase 的 pgvector 扩展进行向量存储
    """
    
    def __init__(self):
        # 延迟导入避免循环依赖
        from app.services.supabase_client import supabase
        self.client = supabase
        self.table_name = TABLE_NAME
        logger.info(f"[RAGVectorStore] 使用 Supabase pgvector + 火山方舟 Embedding ({ARK_EMBEDDING_MODEL})")
    
    def _segment_to_document(self, segment: BenchmarkSegment) -> str:
        """将片段转换为文档文本 (用于 embedding)"""
        parts = [
            segment.input_text_clean,
            f"内容类型: {segment.content_type}",
            f"模版: {segment.template_id}",
        ]
        if segment.broll_trigger_type:
            parts.append(f"触发类型: {segment.broll_trigger_type}")
        if segment.tags:
            parts.append(f"标签: {', '.join(segment.tags)}")
        if segment.reasoning:
            parts.append(segment.reasoning)
        
        return " | ".join(parts)
    
    def _segment_to_row(self, segment: BenchmarkSegment, embedding: Optional[List[float]] = None) -> Dict[str, Any]:
        """将 BenchmarkSegment 转换为数据库行"""
        # 如果没有传入 embedding，则生成
        if embedding is None:
            doc_text = self._segment_to_document(segment)
            embedding = generate_embedding(doc_text)
        
        # 处理枚举值
        content_type = segment.content_type
        if hasattr(content_type, 'value'):
            content_type = content_type.value
        
        broll_trigger_type = segment.broll_trigger_type
        if broll_trigger_type and hasattr(broll_trigger_type, 'value'):
            broll_trigger_type = broll_trigger_type.value
        
        # 处理 visual_config
        visual_config = segment.visual_config
        if hasattr(visual_config, 'model_dump'):
            visual_config = visual_config.model_dump()
        elif hasattr(visual_config, 'dict'):
            visual_config = visual_config.dict()
        
        # 处理嵌套枚举
        if isinstance(visual_config, dict):
            if 'layout_mode' in visual_config and hasattr(visual_config['layout_mode'], 'value'):
                visual_config['layout_mode'] = visual_config['layout_mode'].value
            if 'canvas_type' in visual_config and visual_config['canvas_type'] and hasattr(visual_config['canvas_type'], 'value'):
                visual_config['canvas_type'] = visual_config['canvas_type'].value
        
        return {
            "id": segment.id,
            "video_id": segment.source.video_id,
            "video_title": segment.source.video_title,
            "timestamp_start": segment.source.timestamp_start or 0,
            "timestamp_end": segment.source.timestamp_end or 0,
            "input_text": segment.input_text,
            "input_text_clean": segment.input_text_clean,
            "content_type": content_type,
            "template_id": segment.template_id,
            "broll_trigger_type": broll_trigger_type,
            "broll_trigger_pattern": segment.broll_trigger_pattern,
            "visual_config": visual_config,
            "reasoning": segment.reasoning,
            "quality_score": segment.quality_score,
            "tags": segment.tags,
            "embedding": embedding,
        }
    
    def _row_to_segment(self, row: Dict[str, Any], similarity: float = 0.0) -> BenchmarkSegment:
        """将数据库行转换为 BenchmarkSegment (适配新表结构)"""
        # 新表结构: id, template_id, segment_idx, segment_text, transform_rules, metadata
        metadata = row.get("metadata", {}) or {}
        transform_rules = row.get("transform_rules", {}) or {}
        visual_config_data = transform_rules.get("visual_config", {})
        
        # 从 metadata 中提取信息
        source_info = metadata.get("source", {})
        
        return BenchmarkSegment(
            id=row["id"],
            source=BenchmarkSource(
                video_id=source_info.get("video_id", ""),
                video_title=source_info.get("video_title", ""),
                timestamp_start=source_info.get("timestamp_start"),
                timestamp_end=source_info.get("timestamp_end"),
            ),
            input_text=row.get("segment_text", ""),
            input_text_clean=row.get("segment_text", ""),
            content_type=metadata.get("content_type", ""),
            template_id=row["template_id"],
            broll_trigger_type=transform_rules.get("broll_trigger_type"),
            broll_trigger_pattern=transform_rules.get("broll_trigger_pattern"),
            visual_config=VisualConfigSnippet(**visual_config_data) if visual_config_data else VisualConfigSnippet(layout_mode=LayoutMode.MODE_A),
            reasoning=metadata.get("reasoning", ""),
            quality_score=metadata.get("quality_score", 1.0),
            tags=metadata.get("tags", []),
        )
    
    def add_segment(self, segment: BenchmarkSegment) -> str:
        """添加单个片段"""
        row = self._segment_to_row(segment)
        
        try:
            self.client.table(self.table_name).upsert(row).execute()
            logger.debug(f"[RAGVectorStore] 添加片段: {segment.id}")
            return segment.id
        except Exception as e:
            logger.error(f"[RAGVectorStore] 添加片段失败: {e}")
            raise
    
    def add_segments(self, segments: List[BenchmarkSegment]) -> List[str]:
        """批量添加片段 (使用批量 Embedding API)"""
        if not segments:
            return []
        
        # 批量生成 embeddings
        doc_texts = [self._segment_to_document(s) for s in segments]
        embeddings = generate_embeddings_batch(doc_texts)
        
        # 转换为数据库行
        rows = [
            self._segment_to_row(seg, emb) 
            for seg, emb in zip(segments, embeddings)
        ]
        
        try:
            self.client.table(self.table_name).upsert(rows).execute()
            logger.info(f"[RAGVectorStore] 批量添加 {len(segments)} 个片段")
            return [s.id for s in segments]
        except Exception as e:
            logger.error(f"[RAGVectorStore] 批量添加失败: {e}")
            raise
    
    def search(
        self,
        query_text: str,
        top_k: int = 5,
        template_id: Optional[str] = None,
        content_type: Optional[str] = None,
        broll_trigger_type: Optional[str] = None,
        similarity_threshold: float = 0.0
    ) -> RAGQueryResult:
        """
        搜索相似片段
        
        Args:
            query_text: 查询文本
            top_k: 返回数量
            template_id: 模板ID过滤
            content_type: 内容类型过滤
            broll_trigger_type: B-Roll触发类型过滤
            similarity_threshold: 最小相似度阈值
            
        Returns:
            RAGQueryResult 包含匹配的片段和相似度分数
        """
        # 生成查询向量
        query_embedding = generate_embedding(query_text)
        # 转为 pgvector 格式
        query_embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
        
        try:
            # 调用 Supabase RPC 函数 (新版本简化参数)
            result = self.client.rpc("match_benchmark_segments", {
                "query_embedding": query_embedding_str,
                "match_count": top_k,
                "match_threshold": similarity_threshold,
            }).execute()
            
            segments = []
            scores = []
            
            for row in result.data:
                similarity = row.pop("similarity", 0.0)
                segment = self._row_to_segment(row, similarity)
                segments.append(segment)
                scores.append(similarity)
            
            logger.debug(f"[RAGVectorStore] 搜索返回 {len(segments)} 个结果, 分数: {scores}")
            
            return RAGQueryResult(
                segments=segments,
                scores=scores,
                query_text=query_text
            )
            
        except Exception as e:
            logger.error(f"[RAGVectorStore] 搜索失败: {e}")
            # 返回空结果而不是抛出异常
            return RAGQueryResult(
                segments=[],
                scores=[],
                query_text=query_text
            )
    
    def delete_segment(self, segment_id: str) -> bool:
        """删除片段"""
        try:
            self.client.table(self.table_name).delete().eq("id", segment_id).execute()
            logger.debug(f"[RAGVectorStore] 删除片段: {segment_id}")
            return True
        except Exception as e:
            logger.error(f"[RAGVectorStore] 删除失败: {e}")
            return False
    
    def delete_by_video(self, video_id: str) -> int:
        """删除指定视频的所有片段"""
        try:
            result = self.client.table(self.table_name).delete().eq("video_id", video_id).execute()
            count = len(result.data) if result.data else 0
            logger.info(f"[RAGVectorStore] 删除视频 {video_id} 的 {count} 个片段")
            return count
        except Exception as e:
            logger.error(f"[RAGVectorStore] 删除视频片段失败: {e}")
            return 0
    
    def get_segment(self, segment_id: str) -> Optional[BenchmarkSegment]:
        """获取单个片段"""
        try:
            result = self.client.table(self.table_name).select("*").eq("id", segment_id).single().execute()
            if result.data:
                return self._row_to_segment(result.data)
            return None
        except Exception as e:
            logger.error(f"[RAGVectorStore] 获取片段失败: {e}")
            return None
    
    def count(self) -> int:
        """获取片段总数"""
        try:
            result = self.client.table(self.table_name).select("id", count="exact").execute()
            return result.count if result.count is not None else 0
        except Exception as e:
            logger.error(f"[RAGVectorStore] 获取数量失败: {e}")
            return 0
    
    def clear(self) -> None:
        """清空所有片段"""
        try:
            # 删除所有记录
            self.client.table(self.table_name).delete().neq("id", "").execute()
            logger.info("[RAGVectorStore] 已清空所有片段")
        except Exception as e:
            logger.error(f"[RAGVectorStore] 清空失败: {e}")
            raise
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        try:
            # 总数
            total = self.count()
            
            # 按视频分组
            video_result = self.client.table(self.table_name).select("video_id").execute()
            video_ids = set(row["video_id"] for row in video_result.data) if video_result.data else set()
            
            # 按内容类型分组
            type_result = self.client.table(self.table_name).select("content_type").execute()
            type_counts = {}
            if type_result.data:
                for row in type_result.data:
                    ct = row["content_type"]
                    type_counts[ct] = type_counts.get(ct, 0) + 1
            
            # B-Roll 统计
            broll_result = self.client.table(self.table_name).select("visual_config").execute()
            broll_count = 0
            if broll_result.data:
                for row in broll_result.data:
                    vc = row.get("visual_config", {})
                    if vc.get("has_broll"):
                        broll_count += 1
            
            return {
                "total_segments": total,
                "total_videos": len(video_ids),
                "segments_with_broll": broll_count,
                "content_type_distribution": type_counts,
                "embedding_model": ARK_EMBEDDING_MODEL,
                "embedding_dimension": EMBEDDING_DIMENSION,
            }
        except Exception as e:
            logger.error(f"[RAGVectorStore] 获取统计失败: {e}")
            return {"error": str(e)}
    
    def list_videos(self) -> List[str]:
        """列出所有视频ID"""
        try:
            result = self.client.table(self.table_name).select("video_id").execute()
            return list(set(row["video_id"] for row in result.data)) if result.data else []
        except Exception as e:
            logger.error(f"[RAGVectorStore] 列出视频失败: {e}")
            return []


# ============================================
# 单例和便捷函数
# ============================================

_vectorstore_instance: Optional[RAGVectorStore] = None


def get_vector_store() -> RAGVectorStore:
    """获取向量存储单例"""
    global _vectorstore_instance
    if _vectorstore_instance is None:
        _vectorstore_instance = RAGVectorStore()
    return _vectorstore_instance


def init_with_seed_data(segments: List[BenchmarkSegment], clear: bool = False) -> int:
    """
    用种子数据初始化向量库
    
    Args:
        segments: 种子数据列表
        clear: 是否先清空现有数据
        
    Returns:
        添加的片段数量
    """
    vs = get_vector_store()
    
    if clear:
        vs.clear()
    
    if segments:
        vs.add_segments(segments)
    
    return len(segments)
