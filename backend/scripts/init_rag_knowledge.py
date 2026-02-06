#!/usr/bin/env python3
"""
初始化 RAG 知识库脚本

使用方法:
    python scripts/init_rag_knowledge.py [--clear]

参数:
    --clear: 清空现有数据后重新初始化
"""

import sys
import argparse
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from app.services.remotion_agent.rag import (
    get_vector_store,
    init_with_seed_data,
    get_seed_count,
    get_retriever,
    ContentType,
)


def main():
    parser = argparse.ArgumentParser(description="初始化 RAG 知识库")
    parser.add_argument("--clear", action="store_true", help="清空现有数据后重新初始化")
    parser.add_argument("--test", action="store_true", help="测试检索功能")
    args = parser.parse_args()
    
    print("=" * 50)
    print("Remotion Agent RAG 知识库初始化")
    print("=" * 50)
    
    # 获取向量存储
    store = get_vector_store()
    
    # 显示当前状态
    current_count = store.count()
    print(f"\n📊 当前数据量: {current_count} 条")
    print(f"📦 种子数据量: {get_seed_count()} 条")
    
    # 清空数据 (如果指定)
    if args.clear:
        print("\n🗑️  清空现有数据...")
        store.clear()
        print("✅ 数据已清空")
    
    # 初始化种子数据
    print("\n📥 加载种子数据...")
    count = init_with_seed_data()
    print(f"✅ 知识库初始化完成，共 {count} 条数据")
    
    # 测试检索
    if args.test:
        print("\n" + "=" * 50)
        print("🔍 检索功能测试")
        print("=" * 50)
        
        retriever = get_retriever()
        
        # 测试1: 基础搜索
        print("\n📝 测试1: 搜索 '为什么AI这么火'")
        result = retriever.search("为什么AI这么火", top_k=3)
        for i, (seg, score) in enumerate(zip(result.segments, result.scores)):
            print(f"  [{i+1}] ({score:.3f}) {seg.input_text[:50]}...")
        
        # 测试2: 按内容类型搜索
        print("\n📝 测试2: 搜索 opener 类型")
        result = retriever.search(
            "开场白引人入胜",
            content_type=ContentType.OPENER,
            top_k=3
        )
        for i, (seg, score) in enumerate(zip(result.segments, result.scores)):
            print(f"  [{i+1}] ({score:.3f}) [{seg.content_type}] {seg.input_text[:40]}...")
        
        # 测试3: Few-shot 示例格式化
        print("\n📝 测试3: Few-shot 示例")
        examples = retriever.search_for_fewshot(
            "这个产品的销量增长了50%",
            template_id="talking-head",
            top_k=2
        )
        for i, ex in enumerate(examples):
            print(f"  [{i+1}] layout={ex['layout_mode']}, broll={ex['has_broll']}")
            print(f"      -> {ex['reasoning'][:60]}...")
        
        print("\n✅ 检索测试完成")
    
    print("\n" + "=" * 50)
    print("🎉 RAG 知识库初始化完成!")
    print("=" * 50)


if __name__ == "__main__":
    main()
