#!/usr/bin/env python3
"""
深度分析 RAG 问题 - 为什么训练过的视频在实际场景相似度不够

运行: python scripts/analyze_rag_problem.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json

print("=" * 70)
print("🔍 深度分析：为什么训练过的视频在实际场景相似度不够？")
print("=" * 70)

# 1. 检查当前向量库状态
from app.services.remotion_agent.rag.vectorstore import get_vector_store

store = get_vector_store()
print(f"\n【1. 向量库状态】")
print(f"  存储路径: {store.persist_directory}")
print(f"  集合名称: {store.collection.name}")
print(f"  记录数量: {store.collection.count()}")

# 2. 检查种子数据来源
from app.services.remotion_agent.rag.seed_data import SEED_DATA
print(f"\n【2. 种子数据来源】")
print(f"  种子数据条数: {len(SEED_DATA)}")

videos = {}
for seg in SEED_DATA:
    vid = seg.source.video_id
    if vid not in videos:
        videos[vid] = {'title': seg.source.video_title, 'count': 0, 'ids': []}
    videos[vid]['count'] += 1
    videos[vid]['ids'].append(seg.id)

print(f"  来源视频数: {len(videos)}")
for vid, info in sorted(videos.items()):
    print(f"    {vid}: {info['title']} ({info['count']} 条)")

# 3. 分析嵌入内容
print(f"\n【3. 嵌入文本分析】")
print("  每条种子数据的嵌入文本是 input_text 字段:")
for seg in SEED_DATA[:3]:
    print(f"    - {seg.id}: '{seg.input_text[:50]}...'")

# 4. 测试实际查询
print(f"\n【4. 相似度测试】")
test_queries = [
    "马斯克最近说，3到5年内机器人的手术技术会超过最厉害的外科医生",
    "机器人技术是以递归式三倍指数在增长",
    "ChatGPT从发布到1亿用户只用了2个月"
]

from app.services.remotion_agent.rag import get_retriever
retriever = get_retriever()

for query in test_queries:
    print(f"\n  查询: '{query[:40]}...'")
    result = retriever.search(query, top_k=3)
    for seg, score in zip(result.segments, result.scores):
        print(f"    [{score:.3f}] {seg.id}: {seg.input_text[:40]}...")

# 5. 核心问题分析
print(f"\n" + "=" * 70)
print("【5. 核心问题分析】")
print("=" * 70)
print("""
问题根源:
1. 种子数据是「模拟数据」，不是真实的视频理解结果
   - seed_data.py 里的数据是手写的示例
   - 和真实视频内容的文本风格差异大

2. 嵌入模型使用的是 sentence-transformers (all-MiniLM-L6-v2)
   - 这是通用语义模型，不是针对口播内容优化的
   - 中文支持有限

3. 你之前「训练」的两个视频：
   - benchmark_analyzer 是用来「分析」视频的
   - 但分析结果没有写入 RAG 种子数据
   - 只是输出了分析报告，没有持久化到向量库

解决方案:
1. 用 benchmark_analyzer 重新分析这两个视频
2. 将分析结果转换为 BenchmarkSegment 格式
3. 添加到 seed_data.py 或直接写入向量库
""")
