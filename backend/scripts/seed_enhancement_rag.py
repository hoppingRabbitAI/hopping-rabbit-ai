"""
种子数据入库脚本 — 增强策略 RAG
================================
读取 enhancement_seeds.json → 生成 embedding → 批量写入 pgvector

使用方法:
  cd backend
  source .venv/bin/activate
  python scripts/seed_enhancement_rag.py
"""

import json
import sys
import os
import logging

# 确保项目根目录在 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def main():
    # 加载种子数据
    seed_path = os.path.join(os.path.dirname(__file__), "enhancement_seeds.json")
    with open(seed_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    strategies_raw = data.get("strategies", [])
    logger.info(f"加载了 {len(strategies_raw)} 条增强策略种子")

    # 构建 Schema 对象
    from app.services.enhancement_rag.schema import (
        EnhancementStrategy,
        PipelineConfig,
    )
    from app.services.enhancement_rag.vectorstore import get_enhancement_vectorstore

    strategies = []
    for item in strategies_raw:
        strategies.append(EnhancementStrategy(
            content_category=item["content_category"],
            quality_target=item["quality_target"],
            description=item["description"],
            pipeline_config=PipelineConfig(**item["pipeline_config"]),
            metadata={},
        ))

    # 批量入库
    store = get_enhancement_vectorstore()
    logger.info("开始生成 embedding 并入库...")

    ids = store.upsert_strategies_batch(strategies)
    logger.info(f"✅ 成功入库 {len(ids)} 条增强策略")

    # 验证
    test_results = store.search_strategies("正面人脸 时尚大片 白底", top_k=3)
    logger.info(f"验证检索: query='正面人脸 时尚大片 白底' → {len(test_results)} 条结果")
    for r in test_results:
        logger.info(f"  [{r.similarity:.3f}] {r.content_category} / {r.quality_target}: {r.description[:40]}...")


if __name__ == "__main__":
    main()
