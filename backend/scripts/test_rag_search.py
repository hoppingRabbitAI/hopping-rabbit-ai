#!/usr/bin/env python3
"""快速测试 RAG 搜索"""
import os
import sys
import httpx
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

from supabase import create_client

# 直接调用 embedding API
def generate_embedding(text):
    api_key = os.environ.get('VOLCENGINE_ARK_API_KEY')
    url = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal"
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    
    payload = {
        "model": "doubao-embedding-vision-250615",
        "input": [{"type": "text", "text": text}],
        "encoding_format": "float",
        "dimensions": 1024,
    }
    
    with httpx.Client(timeout=30.0) as client:
        response = client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()["data"]["embedding"]

url = os.environ.get('SUPABASE_URL')
key = os.environ.get('SUPABASE_SERVICE_KEY')
supabase = create_client(url, key)

# 生成查询向量
query = '开场吸引观众注意力'
print(f'查询: {query}')
query_emb = generate_embedding(query)
query_str = '[' + ','.join(str(x) for x in query_emb) + ']'

# 用 RPC 测试，阈值设为 0
print('测试 RPC 调用 (阈值=0)...')
result = supabase.rpc(
    'match_benchmark_segments',
    {
        'query_embedding': query_str,
        'match_count': 5,
        'match_threshold': 0.0
    }
).execute()

print(f'返回 {len(result.data)} 条')
for r in result.data[:5]:
    print(f'  [{r["similarity"]:.4f}] {r["segment_text"][:50]}')
