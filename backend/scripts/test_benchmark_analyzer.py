#!/usr/bin/env python
"""
标杆视频分析测试脚本

用法:
    python scripts/test_benchmark_analyzer.py <video_path> [--quick]

示例:
    # 快速分析
    python scripts/test_benchmark_analyzer.py /path/to/video.mp4 --quick
    
    # 完整分析
    python scripts/test_benchmark_analyzer.py /path/to/video.mp4
"""

import sys
import os
import asyncio
import argparse
import json

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.benchmark_analyzer import (
    get_benchmark_analyzer,
    quick_analyze_video,
    DoubaoVisionClient
)


async def test_quick_analyze(video_path: str):
    """测试快速分析"""
    print(f"\n🎬 快速分析视频: {video_path}")
    print("=" * 60)
    
    result = await quick_analyze_video(video_path)
    
    print("\n📊 分析结果:")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    return result


async def test_full_analyze(video_path: str):
    """测试完整分析"""
    print(f"\n🎬 完整分析视频: {video_path}")
    print("=" * 60)
    
    analyzer = get_benchmark_analyzer()
    analysis = await analyzer.analyze_benchmark_video(
        video_path=video_path,
        fps=0.5  # 每2秒抽1帧
    )
    
    print("\n📊 分析结果:")
    print(f"\n【基本信息】")
    print(f"  视频ID: {analysis.video_id}")
    print(f"  总时长: {analysis.total_duration}")
    print(f"  模版类型: {analysis.template_type}")
    print(f"  整体风格: {analysis.overall_style}")
    print(f"  目标受众: {analysis.target_audience}")
    
    print(f"\n【结构分析】")
    print(f"  {analysis.structure_summary}")
    
    print(f"\n【B-Roll 分析】")
    print(f"  B-Roll 占比: {analysis.broll_percentage}%")
    print(f"  B-Roll 场景数: {len(analysis.broll_scenes)}")
    for i, scene in enumerate(analysis.broll_scenes[:5], 1):
        print(f"    {i}. {scene.get('start_time')} - {scene.get('description', '')[:50]}")
    
    print(f"\n【视觉元素统计】")
    for element, count in analysis.visual_element_stats.items():
        print(f"    {element}: {count}")
    
    print(f"\n【剪辑节奏】")
    print(f"  总镜头切换: {analysis.total_cuts} 次")
    print(f"  平均镜头时长: {analysis.average_shot_duration} 秒")
    print(f"  节奏分析: {analysis.pacing_analysis}")
    
    print(f"\n【详细分段】(前5段)")
    for seg in analysis.segments[:5]:
        print(f"\n  段落 {seg.get('segment_id', 0)}:")
        print(f"    时间: {seg.get('start_time')} - {seg.get('end_time')}")
        print(f"    类型: {seg.get('content_type')}")
        print(f"    主视觉: {seg.get('main_visual')}")
        print(f"    有B-Roll: {seg.get('has_broll')}")
        if seg.get('spoken_text'):
            print(f"    口播: {seg.get('spoken_text')[:100]}...")
    
    return analysis


async def test_upload_only(video_path: str):
    """测试视频上传"""
    print(f"\n🎬 测试视频上传: {video_path}")
    print("=" * 60)
    
    client = DoubaoVisionClient()
    
    print("正在上传视频...")
    file_id = await client.upload_video(video_path, fps=0.3)
    print(f"✅ 上传成功, file_id: {file_id}")
    
    print("正在删除文件...")
    await client.delete_file(file_id)
    print("✅ 文件已删除")


async def main():
    parser = argparse.ArgumentParser(description="标杆视频分析测试")
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument("--quick", action="store_true", help="快速模式（单次API调用）")
    parser.add_argument("--upload-only", action="store_true", help="仅测试上传")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.video_path):
        print(f"❌ 文件不存在: {args.video_path}")
        sys.exit(1)
    
    try:
        if args.upload_only:
            await test_upload_only(args.video_path)
        elif args.quick:
            await test_quick_analyze(args.video_path)
        else:
            await test_full_analyze(args.video_path)
        
        print("\n✅ 测试完成!")
        
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
