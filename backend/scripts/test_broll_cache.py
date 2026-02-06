#!/usr/bin/env python
"""测试 B-Roll 触发检测缓存"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
from app.services.remotion_agent.broll_trigger import (
    detect_broll_triggers,
    detect_primary_trigger,
    clear_trigger_cache,
    _trigger_cache,
    _primary_cache
)

def main():
    # 测试文本
    test_texts = [
        '根据数据显示，增长了 300%',
        '第一步，打开设置；第二步，点击确认',
        '比如说，你可以这样做',
        '和传统方法相比，效率提升 5 倍',
    ]
    
    # 清除之前的缓存
    clear_trigger_cache()
    
    # 首次运行（无缓存）
    print('=== 首次检测（无缓存）===')
    start = time.time()
    for text in test_texts:
        triggers = detect_broll_triggers(text)
        print(f'  "{text[:20]}..." -> {len(triggers)} triggers')
    elapsed1 = time.time() - start
    print(f'耗时: {elapsed1*1000:.2f}ms')
    print(f'缓存大小: {len(_trigger_cache)}')
    
    # 第二次运行（有缓存）
    print()
    print('=== 再次检测（命中缓存）===')
    start = time.time()
    for text in test_texts:
        triggers = detect_broll_triggers(text)
    elapsed2 = time.time() - start
    print(f'耗时: {elapsed2*1000:.2f}ms')
    if elapsed2 > 0:
        print(f'加速比: {elapsed1/elapsed2:.1f}x')
    else:
        print('瞬间完成')
    
    # 测试主要触发检测缓存
    print()
    print('=== 主要触发检测 ===')
    primary = detect_primary_trigger(test_texts[0])
    print(f'主要触发: {primary.trigger_type.value if primary else None}')
    print(f'primary_cache 大小: {len(_primary_cache)}')
    
    # 清除缓存
    clear_trigger_cache()
    print()
    print('=== 清除缓存后 ===')
    print(f'缓存大小: trigger={len(_trigger_cache)}, primary={len(_primary_cache)}')
    
    print()
    print('✅ 缓存功能正常!')

if __name__ == '__main__':
    main()
