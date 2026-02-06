#!/usr/bin/env python3
"""
重新生成所有 RAG embeddings (使用火山方舟 API)

执行步骤:
1. 先在 Supabase 运行 SQL 迁移: supabase/migrations/20260131_rag_ark_embedding.sql
2. 然后运行此脚本: python -m scripts.regenerate_rag_embeddings

此脚本会:
- 从备份表读取原始数据
- 使用火山方舟 Embedding API 生成新的 2560 维向量
- 写入新的 benchmark_segments 表
"""

import os
import sys
import logging
from typing import List, Dict, Any

# 添加 backend 到 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def main():
    from supabase import create_client
    from app.services.remotion_agent.rag.vectorstore import (
        generate_embeddings_batch,
        ARK_EMBEDDING_MODEL,
        EMBEDDING_DIMENSION,
    )
    
    # 连接 Supabase
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    
    if not url or not key:
        logger.error("请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY")
        return
    
    supabase = create_client(url, key)
    logger.info(f"连接 Supabase 成功")
    logger.info(f"使用 Embedding 模型: {ARK_EMBEDDING_MODEL} ({EMBEDDING_DIMENSION}维)")
    
    # 1. 从备份表读取数据
    try:
        result = supabase.table("benchmark_segments_backup").select("*").execute()
        backup_data = result.data
        logger.info(f"从备份表读取 {len(backup_data)} 条记录")
    except Exception as e:
        logger.error(f"读取备份表失败: {e}")
        logger.info("尝试从原表读取...")
        
        try:
            result = supabase.table("benchmark_segments").select("*").execute()
            backup_data = result.data
            logger.info(f"从原表读取 {len(backup_data)} 条记录")
        except Exception as e2:
            logger.error(f"读取原表也失败: {e2}")
            return
    
    if not backup_data:
        logger.warning("没有数据需要迁移")
        return
    
    # 2. 生成文档文本
    def segment_to_document(row: Dict[str, Any]) -> str:
        """将数据行转换为文档文本"""
        parts = [
            row.get("input_text_clean", ""),
            f"内容类型: {row.get('content_type', '')}",
            f"模版: {row.get('template_id', '')}",
        ]
        if row.get("broll_trigger_type"):
            parts.append(f"触发类型: {row['broll_trigger_type']}")
        if row.get("tags"):
            parts.append(f"标签: {', '.join(row['tags'])}")
        if row.get("reasoning"):
            parts.append(row["reasoning"])
        
        return " | ".join(parts)
    
    # 3. 批量生成 embeddings
    doc_texts = [segment_to_document(row) for row in backup_data]
    
    logger.info(f"开始生成 {len(doc_texts)} 个 embeddings...")
    
    try:
        embeddings = generate_embeddings_batch(doc_texts)
        logger.info(f"成功生成 {len(embeddings)} 个 embeddings")
    except Exception as e:
        logger.error(f"生成 embeddings 失败: {e}")
        return
    
    # 4. 准备新数据
    new_rows = []
    for row, embedding in zip(backup_data, embeddings):
        new_row = {
            "id": row["id"],
            "video_id": row["video_id"],
            "video_title": row.get("video_title"),
            "timestamp_start": row.get("timestamp_start", 0),
            "timestamp_end": row.get("timestamp_end", 0),
            "input_text": row["input_text"],
            "input_text_clean": row["input_text_clean"],
            "content_type": row["content_type"],
            "template_id": row.get("template_id", "talking-head"),
            "broll_trigger_type": row.get("broll_trigger_type"),
            "broll_trigger_pattern": row.get("broll_trigger_pattern"),
            "visual_config": row.get("visual_config"),
            "reasoning": row.get("reasoning"),
            "quality_score": row.get("quality_score", 1.0),
            "tags": row.get("tags", []),
            "embedding": embedding,
        }
        new_rows.append(new_row)
    
    # 5. 写入新表 (分批写入)
    batch_size = 10
    success_count = 0
    
    for i in range(0, len(new_rows), batch_size):
        batch = new_rows[i:i + batch_size]
        try:
            supabase.table("benchmark_segments").upsert(batch).execute()
            success_count += len(batch)
            logger.info(f"已写入 {success_count}/{len(new_rows)} 条记录")
        except Exception as e:
            logger.error(f"写入第 {i}-{i+len(batch)} 条记录失败: {e}")
    
    logger.info(f"✅ 迁移完成! 共迁移 {success_count} 条记录")
    
    # 6. 验证
    try:
        count_result = supabase.table("benchmark_segments").select("id", count="exact").execute()
        final_count = count_result.count
        logger.info(f"最终验证: benchmark_segments 表有 {final_count} 条记录")
    except Exception as e:
        logger.warning(f"验证失败: {e}")
    
    # 7. 测试搜索
    logger.info("\n--- 测试搜索 ---")
    from app.services.remotion_agent.rag.vectorstore import generate_embedding
    
    test_query = "今天我要给大家讲一个故事"
    test_embedding = generate_embedding(test_query)
    
    try:
        search_result = supabase.rpc("match_benchmark_segments", {
            "query_embedding": test_embedding,
            "match_count": 3,
            "similarity_threshold": 0.0,
        }).execute()
        
        logger.info(f"测试查询: '{test_query}'")
        for row in search_result.data:
            logger.info(f"  - [{row['similarity']:.3f}] {row['input_text_clean'][:80]}...")
    except Exception as e:
        logger.warning(f"测试搜索失败: {e}")


if __name__ == "__main__":
    main()
