#!/usr/bin/env python3
"""
深度分析 RAG 相似度问题
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

from supabase import create_client
import httpx

url = os.environ.get('SUPABASE_URL')
key = os.environ.get('SUPABASE_SERVICE_KEY')
supabase = create_client(url, key)

def generate_embedding(text):
    api_key = os.environ.get('VOLCENGINE_ARK_API_KEY')
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    payload = {
        "model": "doubao-embedding-vision-250615",
        "input": [{"type": "text", "text": text}],
        "encoding_format": "float",
        "dimensions": 1024,
    }
    with httpx.Client(timeout=30.0) as client:
        response = client.post("https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal", json=payload, headers=headers)
        return response.json()["data"]["embedding"]

# ============================================
# 1. 看看存储的数据长什么样
# ============================================
print("=" * 70)
print("1. 数据库中存储的 segment_text 示例 (来自 001.mp4 种子数据):")
print("=" * 70)
result = supabase.table('benchmark_segments').select('id, segment_text, metadata').limit(10).execute()
for r in result.data:
    meta = r.get('metadata', {})
    content_type = meta.get('content_type', '')
    print(f"\n[{r['id']}] 类型={content_type}")
    print(f"  text: {r['segment_text'][:80]}...")

# ============================================
# 2. 查询用的文本是什么 (模拟用户视频内容)
# ============================================
print("\n" + "=" * 70)
print("2. 用户视频的查询文本 (前几个 clip):")
print("=" * 70)
# 这是用户视频的内容，和 001.mp4 应该是同一个视频
query_text = """现在念医学系的人其实可以不用念了，因为在3~5年之后，机器人开刀的技术会比最强的外科医生还更强。这句话真的合理吗？"""
print(f"查询文本: {query_text}")

# ============================================
# 3. 测试相似度 (无阈值)
# ============================================
print("\n" + "=" * 70)
print("3. 相似度测试 (阈值=0，返回所有结果):")
print("=" * 70)

query_emb = generate_embedding(query_text)
query_str = '[' + ','.join(str(x) for x in query_emb) + ']'

result = supabase.rpc(
    'match_benchmark_segments',
    {'query_embedding': query_str, 'match_count': 10, 'match_threshold': 0.0}
).execute()

print(f"返回 {len(result.data)} 条结果:")
for r in result.data[:10]:
    print(f"  [{r['similarity']:.4f}] {r['segment_text'][:60]}...")

# ============================================
# 4. 直接比较 001-opener-01 的原始文本
# ============================================
print("\n" + "=" * 70)
print("4. 精确匹配测试 (用种子数据的原文查询):")
print("=" * 70)

# 获取 001-opener-01 的原文
opener = supabase.table('benchmark_segments').select('segment_text').eq('id', '001-opener-01').execute()
if opener.data:
    seed_text = opener.data[0]['segment_text']
    print(f"种子原文: {seed_text}")
    
    # 用原文查询
    seed_emb = generate_embedding(seed_text)
    seed_str = '[' + ','.join(str(x) for x in seed_emb) + ']'
    
    result = supabase.rpc(
        'match_benchmark_segments',
        {'query_embedding': seed_str, 'match_count': 5, 'match_threshold': 0.0}
    ).execute()
    
    print(f"\n用原文查询返回 {len(result.data)} 条:")
    for r in result.data:
        print(f"  [{r['similarity']:.4f}] {r['id']}: {r['segment_text'][:50]}...")
