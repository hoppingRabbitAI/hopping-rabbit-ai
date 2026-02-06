#!/usr/bin/env python3
"""
RAG 知识库问题诊断与解决方案

问题：视频分析结果没有写入 RAG 种子数据
解决：将视频分析结果转换为 BenchmarkSegment 格式并添加到知识库
"""

import sys
import os
import json
import asyncio
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.remotion_agent.rag import get_retriever
from app.services.remotion_agent.rag.seed_data import SEED_DATA


def diagnose_rag():
    """诊断 RAG 知识库问题"""
    print("=" * 70)
    print("RAG 知识库问题诊断")
    print("=" * 70)

    # 1. 检查种子数据中是否有马斯克/机器人相关的内容
    print("\n【1. 种子数据中与 001/002 视频相关的条目】")
    keywords = ["马斯克", "机器人", "robot", "musk", "chatgpt", "指数", "增长", "递归", "手术", "退休"]
    related = []
    for seg in SEED_DATA:
        text = seg.input_text.lower()
        if any(kw.lower() in text for kw in keywords):
            related.append(seg)
            print(f"  - {seg.id}: {seg.input_text[:60]}...")

    if not related:
        print("  ❌ 没有找到相关条目！")
    else:
        print(f"  ✅ 找到 {len(related)} 个相关条目")

    # 2. 测试检索
    print("\n【2. 测试检索相似度】")
    retriever = get_retriever()

    test_queries = [
        "马斯克说3到5年内机器人的手术技术会超过最厉害的外科医生",
        "机器人技术是以递归式三倍指数在增长",
        "马斯克不用存退休金，未来商品服务成本趋近免费",
    ]

    for query in test_queries:
        print(f"\n  查询: {query[:40]}...")
        result = retriever.search(query_text=query, top_k=3)
        for seg, score in zip(result.segments, result.scores):
            print(f"    [{score:.3f}] {seg.input_text[:50]}...")

    # 3. 统计信息
    print("\n【3. 种子数据统计】")
    print(f"  总条目数: {len(SEED_DATA)}")
    
    broll_count = sum(1 for s in SEED_DATA if s.visual_config.has_broll)
    print(f"  带B-Roll的条目: {broll_count}/{len(SEED_DATA)} ({broll_count/len(SEED_DATA)*100:.1f}%)")

    # 按视频ID统计
    video_ids = set(s.source.video_id for s in SEED_DATA)
    print(f"  视频数: {len(video_ids)}")
    for vid in sorted(video_ids):
        count = sum(1 for s in SEED_DATA if s.source.video_id == vid)
        print(f"    - 视频 {vid}: {count} 条")


def main():
    diagnose_rag()
    
    print("\n" + "=" * 70)
    print("【问题诊断结论】")
    print("=" * 70)
    print("""
问题根源：
1. 种子数据是手工编写的模拟数据，不是从真实视频提取的
2. 种子数据中的文本内容与你的视频内容不匹配
3. 即使之前"训练"过视频，那只是用 benchmark_analyzer 分析了视频
   但分析结果并没有写入 RAG 知识库的种子数据中！

工作流缺失环节：
  视频分析 → ??? → RAG知识库
  
  benchmark_analyzer 只负责"分析视频"
  但缺少一个步骤将分析结果转换为 seed_data.py 格式并写入！

解决方案：
  需要实现 视频分析结果 → BenchmarkSegment 的转换器
  然后将结果追加到 seed_data.py 或动态加载到向量库
""")


if __name__ == "__main__":
    main()
