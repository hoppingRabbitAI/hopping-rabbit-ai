#!/usr/bin/env python3
"""
RAG Supabase 连接测试脚本 - 火山方舟 Embedding 版本
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.supabase_client import supabase
from app.services.remotion_agent.rag.vectorstore import (
    get_vector_store, 
    generate_embedding, 
    ARK_EMBEDDING_MODEL,
    EMBEDDING_DIMENSION,
)


def main():
    print("=" * 50)
    print("RAG Supabase + 火山方舟 Embedding 检查")
    print("=" * 50)
    
    print(f"\n📌 Embedding 模型: {ARK_EMBEDDING_MODEL}")
    print(f"📌 向量维度: {EMBEDDING_DIMENSION}")
    
    # 1. 测试表
    print("\n1️⃣  测试 benchmark_segments 表...")
    try:
        result = supabase.table("benchmark_segments").select("id", count="exact").execute()
        print(f"   ✅ 表存在，当前 {result.count or 0} 条记录")
    except Exception as e:
        print(f"   ❌ 失败: {e}")
        return 1
    
    # 2. 测试 RPC 函数
    print("\n2️⃣  测试 match_benchmark_segments() 函数...")
    try:
        test_vector = [0.0] * EMBEDDING_DIMENSION
        result = supabase.rpc("match_benchmark_segments", {
            "query_embedding": test_vector,
            "match_count": 1,
        }).execute()
        print("   ✅ RPC 函数正常")
    except Exception as e:
        print(f"   ❌ 失败: {e}")
        print("   💡 如果维度不匹配，请运行 SQL 迁移: supabase/migrations/20260131_rag_ark_embedding.sql")
        return 1
    
    # 3. 测试火山方舟 Embedding API
    print("\n3️⃣  测试火山方舟 Embedding API...")
    try:
        embedding = generate_embedding("测试文本")
        print(f"   ✅ API 调用成功 (返回维度: {len(embedding)})")
    except ValueError as e:
        print(f"   ❌ 配置错误: {e}")
        print("   💡 请在 .env 中设置 VOLCENGINE_ARK_API_KEY")
        return 1
    except Exception as e:
        print(f"   ❌ API 调用失败: {e}")
        return 1
    
    # 4. 检查本地数据
    print("\n4️⃣  检查本地数据...")
    data_file = Path(__file__).parent.parent / "app" / "services" / "remotion_agent" / "rag" / "data" / "benchmark_segments.json"
    if data_file.exists():
        import json
        with open(data_file) as f:
            data = json.load(f)
        print(f"   ✅ 本地 {len(data)} 个片段待导入")
    else:
        print("   ⚠️ 无本地数据")
    
    # 5. 统计信息
    print("\n5️⃣  向量库统计...")
    vs = get_vector_store()
    stats = vs.get_stats()
    print(f"   📊 总片段数: {stats.get('total_segments', 0)}")
    print(f"   📊 总视频数: {stats.get('total_videos', 0)}")
    print(f"   📊 Embedding 模型: {stats.get('embedding_model', 'N/A')}")
    
    print("\n" + "=" * 50)
    print("🎉 检查通过！")
    print("\n如需重新生成 embeddings，运行:")
    print("  python -m scripts.regenerate_rag_embeddings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
