#!/usr/bin/env python3
"""
测试火山方舟多模态 Embedding API 并重新生成 RAG 数据
Model: doubao-embedding-vision-250615 (1024 维度)
"""

import os
import sys
import json
import httpx
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

from supabase import create_client

# Embedding 配置
ARK_EMBEDDING_MODEL = "doubao-embedding-vision-250615"
EMBEDDING_DIMENSION = 1024

def generate_embedding(text):
    """生成单个文本的 embedding"""
    api_key = os.environ.get('VOLCENGINE_ARK_API_KEY')
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    payload = {
        "model": ARK_EMBEDDING_MODEL,
        "input": [{"type": "text", "text": text}],
        "encoding_format": "float",
        "dimensions": EMBEDDING_DIMENSION,
    }
    with httpx.Client(timeout=30.0) as client:
        response = client.post("https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal", json=payload, headers=headers)
        response.raise_for_status()
        return response.json()["data"]["embedding"]

print("=" * 50)
print("RAG Embedding 重新生成 (火山方舟多模态 API)")
print("=" * 50)
print(f"模型: {ARK_EMBEDDING_MODEL}")
print(f"维度: {EMBEDDING_DIMENSION}")

# 1. 测试 API
print("\n1️⃣ 测试火山方舟多模态 Embedding API...")
try:
    test_emb = generate_embedding("测试文本：用于验证多模态Embedding接口是否正常工作。")
    print(f"   ✅ API 正常, 返回维度: {len(test_emb)}")
    if len(test_emb) != EMBEDDING_DIMENSION:
        print(f"   ⚠️ 警告: 返回维度 {len(test_emb)} != 预期 {EMBEDDING_DIMENSION}")
except Exception as e:
    print(f"   ❌ 失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# 2. 连接 Supabase
print("\n2️⃣ 连接 Supabase...")
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")

if not url or not key:
    print("   ❌ 请设置 SUPABASE_URL 和 SUPABASE_SERVICE_KEY")
    sys.exit(1)

supabase = create_client(url, key)
print("   ✅ 连接成功")

# 3. 检查本地 JSON 数据
print("\n3️⃣ 查找本地数据...")
data_file = Path(__file__).parent.parent / "app" / "services" / "remotion_agent" / "rag" / "data" / "benchmark_segments.json"

local_data = []
if data_file.exists():
    with open(data_file) as f:
        raw_data = json.load(f)
    
    # 数据格式是 {"001": [...], "002": [...]} 需要展平
    if isinstance(raw_data, dict):
        for key, segments in raw_data.items():
            if isinstance(segments, list):
                local_data.extend(segments)
    elif isinstance(raw_data, list):
        local_data = raw_data
    
    print(f"   ✅ 找到本地数据: {len(local_data)} 条")
else:
    print(f"   ⚠️ 未找到本地数据文件: {data_file}")
    # 尝试从 Supabase 现有表获取 (排除 embedding)
    try:
        result = supabase.table("benchmark_segments").select("id, template_id, segment_idx, segment_text, transform_rules, metadata").execute()
        if result.data:
            local_data = result.data
            print(f"   ✅ 从 Supabase 获取: {len(local_data)} 条 (仅元数据)")
        else:
            print("   ❌ 表中也没有数据")
            sys.exit(1)
    except Exception as e:
        print(f"   ❌ 无法获取数据: {e}")
        sys.exit(1)

# 4. 构建用于 embedding 的文本
def segment_to_text(row):
    """从 segment 数据构建用于 embedding 的文本"""
    # 优先使用 input_text_clean，否则用 input_text 或 segment_text
    text = row.get("input_text_clean") or row.get("input_text") or row.get("segment_text", "")
    
    content_type = row.get("content_type", "")
    if content_type:
        text = f"[{content_type}] {text}"
    
    return text


def row_to_record(row, embedding):
    """将原始数据行转换为数据库记录"""
    # 构建 transform_rules
    transform_rules = {
        "visual_config": row.get("visual_config", {}),
        "broll_trigger_type": row.get("broll_trigger_type"),
        "broll_trigger_pattern": row.get("broll_trigger_pattern"),
    }
    
    # 构建 metadata
    metadata = {
        "content_type": row.get("content_type"),
        "source": row.get("source", {}),
        "quality_score": row.get("quality_score"),
        "tags": row.get("tags", []),
        "reasoning": row.get("reasoning"),
    }
    
    # 将 embedding 转换为 pgvector 格式字符串
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
    
    return {
        "id": row["id"],
        "template_id": row.get("template_id", "unknown"),
        "segment_idx": 0,  # 可以后续根据 source.timestamp_start 计算
        "segment_text": row.get("input_text_clean") or row.get("input_text", ""),
        "transform_rules": transform_rules,
        "metadata": metadata,
        "embedding": embedding_str,
    }


# 5. 生成 embeddings 并插入
print("\n4️⃣ 生成 Embeddings...")
records_to_insert = []

for i, row in enumerate(local_data):
    text = segment_to_text(row)
    
    try:
        embedding = generate_embedding(text)
        record = row_to_record(row, embedding)
        records_to_insert.append(record)
        
        print(f"   [{i+1}/{len(local_data)}] ✅ {row['id']}")
        
    except Exception as e:
        print(f"   [{i+1}/{len(local_data)}] ❌ {row.get('id', 'unknown')}: {e}")
        continue

print(f"\n5️⃣ 插入 Supabase ({len(records_to_insert)} 条)...")

if records_to_insert:
    try:
        # 清空表
        supabase.table("benchmark_segments").delete().neq("id", "").execute()
        print("   ✅ 清空旧数据")
        
        # 批量插入
        batch_size = 50
        for i in range(0, len(records_to_insert), batch_size):
            batch = records_to_insert[i:i + batch_size]
            supabase.table("benchmark_segments").insert(batch).execute()
            print(f"   ✅ 插入 {i + len(batch)}/{len(records_to_insert)}")
        
        print(f"\n🎉 完成! 共插入 {len(records_to_insert)} 条记录")
        
    except Exception as e:
        print(f"   ❌ 插入失败: {e}")
        import traceback
        traceback.print_exc()
else:
    print("   ⚠️ 没有数据可插入")

# 6. 测试搜索
print("\n6️⃣ 测试向量搜索...")
try:
    query_embedding = generate_embedding("产品介绍视频开场")
    # 转换为 pgvector 格式
    query_embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
    
    result = supabase.rpc(
        "match_benchmark_segments",
        {
            "query_embedding": query_embedding_str,
            "match_count": 3,
            "match_threshold": 0.3
        }
    ).execute()
    
    if result.data:
        print(f"   ✅ 搜索成功, 返回 {len(result.data)} 条结果:")
        for r in result.data:
            print(f"      - [{r['similarity']:.3f}] {r['segment_text'][:50]}...")
    else:
        print("   ⚠️ 没有搜索结果 (阈值可能过高)")
        
except Exception as e:
    print(f"   ❌ 搜索失败: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 50)
print("完成!")
