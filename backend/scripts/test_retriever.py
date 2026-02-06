#!/usr/bin/env python3
"""
测试完整的 RAG retriever 流程
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
os.chdir(Path(__file__).parent.parent)

from dotenv import load_dotenv
load_dotenv()

# 测试 retriever
print("=" * 60)
print("测试 RAG Retriever 完整流程")
print("=" * 60)

try:
    from app.services.remotion_agent.rag import get_retriever
    
    retriever = get_retriever()
    print("✅ Retriever 初始化成功")
    
    # 模拟用户视频的查询文本
    query_text = """[0s-1s] 吴奇的话，不用担心。
[1s-8s] 最近一次访谈说，现在念医学系的人其实可以不用念了，因为在3~5年之后，机器人开刀的技术会比最强的外科医生还更强。
[8s-9s] 这句话真的合理吗？"""
    
    print(f"\n查询文本 (前200字):\n{query_text[:200]}")
    
    # 调用 search_for_fewshot
    print("\n调用 search_for_fewshot...")
    examples = retriever.search_for_fewshot(
        query_text=query_text,
        template_id="talking-head",
        top_k=5
    )
    
    print(f"\n返回 {len(examples)} 个示例:")
    for i, ex in enumerate(examples):
        print(f"\n[{i+1}] 相似度={ex.get('similarity_score', 0):.4f}")
        print(f"    类型: {ex.get('content_type')}")
        print(f"    布局: {ex.get('layout_mode')}")
        print(f"    B-Roll: {ex.get('has_broll')}")
        print(f"    输入: {ex.get('input', '')[:60]}...")
        
except Exception as e:
    import traceback
    print(f"❌ 错误: {e}")
    traceback.print_exc()
