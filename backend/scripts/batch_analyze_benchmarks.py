#!/usr/bin/env python3
"""
批量分析标杆视频并生成 RAG 种子数据

Usage:
    python scripts/batch_analyze_benchmarks.py
    python scripts/batch_analyze_benchmarks.py --video 001
    python scripts/batch_analyze_benchmarks.py --output seed_data_new.py
"""

import asyncio
import json
import sys
import os
import argparse
from pathlib import Path
from datetime import datetime

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.benchmark_analyzer import quick_analyze_video

# 视频路径
VIDEO_DIR = Path("/Users/hexiangyang/Downloads")
VIDEO_IDS = ["001", "002", "003", "004", "005", "006", "007", "008"]


async def analyze_video(video_id: str) -> dict:
    """分析单个视频"""
    video_path = VIDEO_DIR / f"{video_id}.mp4"
    if not video_path.exists():
        print(f"❌ 视频不存在: {video_path}")
        return None
    
    print(f"\n{'='*60}")
    print(f"📹 分析视频 {video_id}.mp4")
    print(f"{'='*60}")
    
    try:
        # 使用快速模式分析
        result = await quick_analyze_video(str(video_path))
        
        print(f"✅ 分析完成!")
        print(f"   模板类型: {result.get('template_type', 'unknown')}")
        print(f"   时长: {result.get('total_duration', 'unknown')}")
        
        # 添加视频ID
        result['video_id'] = video_id
        
        return result
        
    except Exception as e:
        print(f"❌ 分析失败: {e}")
        import traceback
        traceback.print_exc()
        return None


def convert_to_seed_data(analysis_results: list) -> str:
    """将分析结果转换为 seed_data.py 格式"""
    
    segments = []
    
    for result in analysis_results:
        if not result:
            continue
            
        video_id = result.get('video_id', '000')
        template_type = result.get('template_type', 'mixed-media')
        structure = result.get('structure', {})
        visual_style = result.get('visual_style', {})
        key_timestamps = result.get('key_timestamps', [])
        
        # 确定模板ID
        template_id = "talking-head"
        if template_type == "whiteboard":
            template_id = "whiteboard"
        elif "PPT" in str(visual_style) or "白板" in str(visual_style):
            template_id = "whiteboard"
        
        # 提取 hook
        hook = structure.get('hook', '')
        if hook:
            segments.append({
                'id': f'{video_id}-hook-01',
                'video_id': video_id,
                'template_id': template_id,
                'content_type': 'hook',
                'text': hook[:200] if len(hook) > 200 else hook,
                'reasoning': f"来自视频 {video_id} 的开场钩子，使用争议性观点或问题引发好奇",
                'has_broll': 'B-Roll' in str(visual_style) or 'B-roll' in str(visual_style),
                'broll_suggestion': visual_style.get('broll_usage', ''),
                'layout_mode': 'MODE_A',
            })
        
        # 提取主要观点
        main_points = structure.get('main_points', [])
        for i, point in enumerate(main_points[:3], 1):  # 最多取3个
            content_type = 'concept' if i == 1 else 'example' if i == 2 else 'data'
            segments.append({
                'id': f'{video_id}-point-0{i}',
                'video_id': video_id,
                'template_id': template_id,
                'content_type': content_type,
                'text': point[:200] if len(point) > 200 else point,
                'reasoning': f"来自视频 {video_id} 的第{i}个核心观点",
                'has_broll': True,
                'broll_suggestion': '',
                'layout_mode': 'MODE_A' if template_id != 'whiteboard' else 'MODE_C',
            })
        
        # 提取结尾
        ending = structure.get('ending', '')
        if ending:
            segments.append({
                'id': f'{video_id}-cta-01',
                'video_id': video_id,
                'template_id': template_id,
                'content_type': 'cta',
                'text': ending[:200] if len(ending) > 200 else ending,
                'reasoning': f"来自视频 {video_id} 的结尾行动号召",
                'has_broll': False,
                'broll_suggestion': '',
                'layout_mode': 'MODE_A',
            })
        
        # 从关键时间戳提取更多片段
        for ts in key_timestamps[:5]:
            event = ts.get('event', '')
            if not event:
                continue
            
            # 判断内容类型
            if any(kw in event for kw in ['数据', '数字', '增长', '%', '亿']):
                ct = 'data'
            elif any(kw in event for kw in ['比如', '例如', '案例']):
                ct = 'example'
            elif any(kw in event for kw in ['对比', '相比', 'vs']):
                ct = 'comparison'
            elif any(kw in event for kw in ['B-Roll', '素材', '画面']):
                ct = 'concept'
            else:
                continue  # 跳过普通描述
            
            # 避免重复
            existing_texts = [s['text'] for s in segments]
            if event in existing_texts:
                continue
                
            segments.append({
                'id': f'{video_id}-{ct[:4]}-ts',
                'video_id': video_id,
                'template_id': template_id,
                'content_type': ct,
                'text': event[:200] if len(event) > 200 else event,
                'reasoning': f"来自视频 {video_id} 的关键时刻: {ts.get('time', '')}",
                'has_broll': 'B-Roll' in event or '素材' in event,
                'broll_suggestion': '',
                'layout_mode': 'MODE_A',
            })
    
    return segments


def generate_seed_data_file(segments: list, output_path: str = None):
    """生成 seed_data.py 文件"""
    
    # 按视频ID分组统计
    video_counts = {}
    for seg in segments:
        vid = seg.get('video_id', '000')
        video_counts[vid] = video_counts.get(vid, 0) + 1
    
    header = '''"""
RAG 知识库种子数据 - 从标杆视频自动生成

基于 8 个标杆视频的 AI 分析结果
生成时间: {timestamp}
视频来源: /Users/hexiangyang/Downloads/001-008.mp4

统计:
{stats}
"""

from .schema import (
    BenchmarkSegment,
    BenchmarkSource,
    VisualConfigSnippet,
    ContentType,
    LayoutMode,
    BrollTriggerType,
    CanvasType,
    KeywordCardVariant,
)


def get_seed_segments() -> list[BenchmarkSegment]:
    """返回所有标杆视频片段种子数据"""
    return SEED_SEGMENTS


SEED_SEGMENTS: list[BenchmarkSegment] = [
'''.format(
        timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        stats="\n".join([f"- 视频 {vid}: {cnt} 条" for vid, cnt in sorted(video_counts.items())])
    )
    
    # 生成每个片段
    segment_strs = []
    for seg in segments:
        content_type_map = {
            'hook': 'ContentType.HOOK',
            'concept': 'ContentType.CONCEPT',
            'example': 'ContentType.EXAMPLE',
            'data': 'ContentType.DATA',
            'comparison': 'ContentType.COMPARISON',
            'cta': 'ContentType.CTA',
            'quote': 'ContentType.QUOTE',
            'outlook': 'ContentType.OUTLOOK',
        }
        layout_mode_map = {
            'MODE_A': 'LayoutMode.MODE_A',
            'MODE_B': 'LayoutMode.MODE_B',
            'MODE_C': 'LayoutMode.MODE_C',
            'MODE_D': 'LayoutMode.MODE_D',
        }
        
        ct = content_type_map.get(seg['content_type'], 'ContentType.CONCEPT')
        lm = layout_mode_map.get(seg['layout_mode'], 'LayoutMode.MODE_A')
        
        # 转义文本中的引号
        text = seg['text'].replace('"', '\\"').replace('\n', ' ')
        reasoning = seg['reasoning'].replace('"', '\\"').replace('\n', ' ')
        broll = seg['broll_suggestion'].replace('"', '\\"').replace('\n', ' ') if seg['broll_suggestion'] else ''
        
        segment_str = f'''    BenchmarkSegment(
        id="{seg['id']}",
        source=BenchmarkSource(
            video_id="{seg['video_id']}",
            timestamp_ms=0,
            duration_ms=5000,
        ),
        template_id="{seg['template_id']}",
        content_type={ct},
        original_text="{text}",
        reasoning="{reasoning}",
        visual_config=VisualConfigSnippet(
            layout_mode={lm},
            has_broll={str(seg['has_broll'])},
            broll_trigger_type=BrollTriggerType.CONCEPT_VISUAL if {str(seg['has_broll'])} else None,
            broll_description="{broll}" if "{broll}" else None,
        ),
    ),'''
        segment_strs.append(segment_str)
    
    footer = '''
]
'''
    
    content = header + '\n'.join(segment_strs) + footer
    
    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"\n✅ 种子数据已保存到: {output_path}")
    
    return content


async def main():
    parser = argparse.ArgumentParser(description="批量分析标杆视频")
    parser.add_argument("--video", type=str, help="只分析指定视频 (如 001)")
    parser.add_argument("--output", type=str, default="seed_data_generated.py", 
                       help="输出文件名")
    parser.add_argument("--dry-run", action="store_true", help="只显示结果，不保存")
    args = parser.parse_args()
    
    print("=" * 60)
    print("🎬 标杆视频批量分析器")
    print("=" * 60)
    
    # 确定要分析的视频
    if args.video:
        videos = [args.video]
    else:
        videos = VIDEO_IDS
    
    print(f"📁 视频目录: {VIDEO_DIR}")
    print(f"📹 待分析: {', '.join(videos)}")
    
    # 批量分析
    results = []
    for video_id in videos:
        result = await analyze_video(video_id)
        if result:
            results.append(result)
    
    print(f"\n{'='*60}")
    print(f"📊 分析完成: {len(results)}/{len(videos)} 个视频")
    print(f"{'='*60}")
    
    # 转换为种子数据
    segments = convert_to_seed_data(results)
    print(f"\n🌱 生成种子数据: {len(segments)} 条")
    
    # 生成文件
    if not args.dry_run:
        output_path = Path(__file__).parent.parent / "app" / "services" / "remotion_agent" / "rag" / args.output
        generate_seed_data_file(segments, str(output_path))
    else:
        print("\n[Dry Run] 预览种子数据:")
        for seg in segments[:5]:
            print(f"  - [{seg['id']}] {seg['content_type']}: {seg['text'][:50]}...")
    
    # 保存原始分析结果
    if not args.dry_run and results:
        raw_output = Path(__file__).parent / "benchmark_analysis_raw.json"
        with open(raw_output, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"📄 原始分析结果: {raw_output}")


if __name__ == "__main__":
    asyncio.run(main())
