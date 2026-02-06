#!/usr/bin/env python3
"""检查 clip 和 asset 的 transcript 数据"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client
from dotenv import load_dotenv
load_dotenv()

supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_ANON_KEY'))

clip_id = '89c7f2e5-d082-4132-a9b4-8d633118cf3f'

# 获取 clip 信息
clip_result = supabase.table('clips').select('*').eq('id', clip_id).single().execute()
clip = clip_result.data
print('=== Clip 信息 ===')
print(f'asset_id: {clip.get("asset_id")}')
print(f'start_time: {clip.get("start_time")}')
print(f'end_time: {clip.get("end_time")}')
print(f'source_start: {clip.get("source_start")}')
print(f'source_end: {clip.get("source_end")}')
print(f'metadata: {clip.get("metadata")}')
print(f'content_text: {clip.get("content_text")}')

# 获取 asset 的 metadata
asset_id = clip.get('asset_id')
asset_result = supabase.table('assets').select('metadata').eq('id', asset_id).single().execute()
metadata = asset_result.data.get('metadata') or {}
print(f'\n=== Asset Metadata ===')
print(f'keys: {list(metadata.keys())}')
transcript_segments = metadata.get('transcript_segments') or []
print(f'transcript_segments 数量: {len(transcript_segments)}')
if transcript_segments:
    print(f'前3个 segments:')
    for i, seg in enumerate(transcript_segments[:3]):
        start = seg.get("start") or seg.get("start_ms")
        end = seg.get("end") or seg.get("end_ms")
        text = seg.get("text", "")[:50]
        print(f'  {i}: start={start}, end={end}, text={text}...')
else:
    print('没有 transcript_segments!')
