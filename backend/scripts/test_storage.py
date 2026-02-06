#!/usr/bin/env python3
"""测试 Supabase Storage"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

from supabase import create_client

url = os.environ.get('SUPABASE_URL')
key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')
print(f'URL: {url}')
print(f'Key exists: {bool(key)}')

supabase = create_client(url, key)

# 检查 bucket
try:
    buckets = supabase.storage.list_buckets()
    print(f'Buckets: {[b.name for b in buckets]}')
except Exception as e:
    print(f'List buckets error: {e}')

# 测试上传到 ai-creations
try:
    test_data = b'test image data'
    result = supabase.storage.from_('ai-creations').upload(
        'test/test_upload.txt',
        test_data,
        {'content-type': 'text/plain', 'upsert': 'true'}
    )
    print(f'Upload result: {result}')
    
    public_url = supabase.storage.from_('ai-creations').get_public_url('test/test_upload.txt')
    print(f'Public URL: {public_url}')
except Exception as e:
    print(f'Upload error: {type(e).__name__}: {e}')
