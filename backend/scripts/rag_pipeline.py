#!/usr/bin/env python3
"""
RAG 数据管道命令行工具

标杆视频分析 → RAG 种子数据的完整流程

用法:
    # 分析并导入单个视频
    python scripts/rag_pipeline.py --video /path/to/001.mp4
    
    # 批量处理 001-008 标杆视频
    python scripts/rag_pipeline.py --batch /Users/hexiangyang/Downloads --pattern "00*.mp4"
    
    # 强制重新分析 (覆盖缓存)
    python scripts/rag_pipeline.py --video 001.mp4 --force
    
    # 只转换已有分析结果 (不调用 API)
    python scripts/rag_pipeline.py --convert-only
    
    # 查看统计信息
    python scripts/rag_pipeline.py --stats
    
    # 导出为 seed_data.py 格式 (可选)
    python scripts/rag_pipeline.py --export seed_data_new.py
"""

import sys
import os
import asyncio
import argparse
import json
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.remotion_agent.rag.pipeline import (
    RAGDataPipeline,
    get_pipeline,
    DATA_DIR,
)


def print_banner():
    print("""
╔══════════════════════════════════════════════════════════════╗
║           🎬 RAG 数据管道 - 标杆视频分析工具                 ║
║                                                              ║
║   视频分析 → 结构化数据 → 向量库                             ║
╚══════════════════════════════════════════════════════════════╝
""")


def print_stats(pipeline: RAGDataPipeline):
    """打印统计信息"""
    stats = pipeline.get_stats()
    
    print("\n📊 数据统计:")
    print(f"   已分析视频: {stats['videos_analyzed']}")
    print(f"   已转换视频: {stats['videos_converted']}")
    print(f"   总片段数量: {stats['total_segments']}")
    print(f"   带B-Roll片段: {stats['segments_with_broll']}")
    print(f"   向量库数量: {stats['vectorstore_count']}")
    
    print("\n📈 内容类型分布:")
    for ct, count in sorted(stats['content_type_distribution'].items()):
        bar = "█" * min(count, 20)
        print(f"   {ct:15s} {count:3d} {bar}")


def export_to_seed_data(pipeline: RAGDataPipeline, output_path: str):
    """导出为 seed_data.py 格式"""
    from datetime import datetime
    
    all_segments = []
    for segs in pipeline.segments_cache.values():
        all_segments.extend(segs)
    
    if not all_segments:
        print("❌ 没有数据可导出")
        return
    
    # 生成文件内容
    header = f'''"""
RAG 知识库种子数据 - 从标杆视频自动生成

生成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
视频数量: {len(pipeline.segments_cache)}
片段总数: {len(all_segments)}
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
    return SEED_DATA


SEED_DATA: list[BenchmarkSegment] = [
'''
    
    # 生成每个片段的代码
    segment_codes = []
    for seg in all_segments:
        if isinstance(seg, dict):
            from app.services.remotion_agent.rag.schema import BenchmarkSegment
            seg = BenchmarkSegment(**seg)
        
        # 生成代码
        code = f'''    BenchmarkSegment(
        id="{seg.id}",
        source=BenchmarkSource(
            video_id="{seg.source.video_id}",
            video_title="{seg.source.video_title}",
            timestamp_start={seg.source.timestamp_start},
            timestamp_end={seg.source.timestamp_end},
        ),
        input_text="""{seg.input_text}""",
        input_text_clean="{seg.input_text_clean}",
        content_type=ContentType.{seg.content_type.upper() if isinstance(seg.content_type, str) else seg.content_type.name},
        template_id="{seg.template_id}",
        broll_trigger_type={f'BrollTriggerType.{seg.broll_trigger_type.upper()}' if seg.broll_trigger_type and isinstance(seg.broll_trigger_type, str) else f'BrollTriggerType.{seg.broll_trigger_type.name}' if seg.broll_trigger_type else 'None'},
        broll_trigger_pattern={f'"{seg.broll_trigger_pattern}"' if seg.broll_trigger_pattern else 'None'},
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.{seg.visual_config.layout_mode.upper() if isinstance(seg.visual_config.layout_mode, str) else seg.visual_config.layout_mode.name},
            has_broll={seg.visual_config.has_broll},
            broll_description={f'"{seg.visual_config.broll_description}"' if seg.visual_config.broll_description else 'None'},
        ),
        reasoning="""{seg.reasoning}""",
        quality_score={seg.quality_score},
        tags={seg.tags},
    ),'''
        segment_codes.append(code)
    
    footer = '''
]
'''
    
    content = header + "\n".join(segment_codes) + footer
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"✅ 已导出到: {output_path}")
    print(f"   片段数量: {len(all_segments)}")


async def main():
    parser = argparse.ArgumentParser(
        description="RAG 数据管道 - 标杆视频分析工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s --video /path/to/001.mp4           分析单个视频
  %(prog)s --batch /path/to/videos            批量分析目录下所有视频
  %(prog)s --batch /path --pattern "00*.mp4"  批量分析匹配模式的视频
  %(prog)s --stats                            查看统计信息
  %(prog)s --export seed_data_new.py          导出为 Python 代码
        """
    )
    
    parser.add_argument("--video", "-v", type=str, help="分析单个视频文件")
    parser.add_argument("--batch", "-b", type=str, help="批量分析目录")
    parser.add_argument("--pattern", "-p", type=str, default="*.mp4", help="文件匹配模式 (默认: *.mp4)")
    parser.add_argument("--force", "-f", action="store_true", help="强制重新分析 (忽略缓存)")
    parser.add_argument("--convert-only", "-c", action="store_true", help="只转换已有分析结果")
    parser.add_argument("--stats", "-s", action="store_true", help="显示统计信息")
    parser.add_argument("--export", "-e", type=str, help="导出为 seed_data.py 格式")
    parser.add_argument("--no-import", action="store_true", help="不导入向量库")
    parser.add_argument("--clear", action="store_true", help="清空向量库后重新导入")
    
    args = parser.parse_args()
    
    print_banner()
    
    pipeline = get_pipeline()
    
    # 显示统计
    if args.stats:
        print_stats(pipeline)
        return
    
    # 只转换
    if args.convert_only:
        print("📄 转换已有分析结果...")
        for video_id in pipeline.analysis_cache:
            try:
                segments = pipeline.convert_to_segments(video_id)
                print(f"  ✅ {video_id}: {len(segments)} 个片段")
            except Exception as e:
                print(f"  ❌ {video_id}: {e}")
        
        if not args.no_import:
            pipeline.import_to_vectorstore(clear=args.clear)
            print("\n✅ 已导入向量库")
        
        print_stats(pipeline)
        return
    
    # 导出
    if args.export:
        export_to_seed_data(pipeline, args.export)
        return
    
    # 单个视频
    if args.video:
        video_path = Path(args.video)
        if not video_path.exists():
            print(f"❌ 视频文件不存在: {video_path}")
            return
        
        print(f"🎬 分析视频: {video_path}")
        segments = await pipeline.process_video(
            str(video_path), 
            force=args.force,
            import_to_vs=not args.no_import
        )
        print(f"✅ 完成: {len(segments)} 个片段")
        
        print("\n📋 片段预览:")
        for seg in segments[:5]:
            ct = seg.content_type.value if hasattr(seg.content_type, 'value') else seg.content_type
            text = seg.input_text[:50] + "..." if len(seg.input_text) > 50 else seg.input_text
            print(f"  [{seg.id}] {ct}: {text}")
        
        if len(segments) > 5:
            print(f"  ... 还有 {len(segments) - 5} 个片段")
        
        print_stats(pipeline)
        return
    
    # 批量处理
    if args.batch:
        batch_dir = Path(args.batch)
        if not batch_dir.exists():
            print(f"❌ 目录不存在: {batch_dir}")
            return
        
        video_files = sorted(batch_dir.glob(args.pattern))
        if not video_files:
            print(f"❌ 没有找到匹配 '{args.pattern}' 的视频文件")
            return
        
        print(f"🎬 批量分析 {len(video_files)} 个视频:")
        for vf in video_files:
            print(f"  - {vf.name}")
        print()
        
        results = await pipeline.process_batch(
            [str(vf) for vf in video_files],
            force=args.force,
            clear_vs=args.clear
        )
        
        print("\n" + "=" * 50)
        print("📊 处理结果:")
        total = 0
        for video_id, segments in sorted(results.items()):
            status = "✅" if segments else "❌"
            print(f"  {status} {video_id}: {len(segments)} 个片段")
            total += len(segments)
        
        print(f"\n🎉 总计: {total} 个片段")
        print_stats(pipeline)
        return
    
    # 无参数显示帮助
    parser.print_help()


if __name__ == "__main__":
    asyncio.run(main())
