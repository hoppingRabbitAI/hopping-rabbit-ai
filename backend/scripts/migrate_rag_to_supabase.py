#!/usr/bin/env python3
"""
RAG 数据迁移脚本 - 将本地数据导入到 Supabase pgvector

用法:
    python scripts/migrate_rag_to_supabase.py --import-json     # 从本地 JSON 导入
    python scripts/migrate_rag_to_supabase.py --verify          # 验证迁移结果
    python scripts/migrate_rag_to_supabase.py --test-search     # 测试搜索功能
    python scripts/migrate_rag_to_supabase.py --stats           # 查看统计信息
    python scripts/migrate_rag_to_supabase.py --clear           # 清空数据
"""

import sys
import os
import json
import argparse
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.remotion_agent.rag.schema import (
    BenchmarkSegment,
    BenchmarkSource,
    VisualConfigSnippet,
    LayoutMode,
)


def load_local_segments() -> list:
    """加载本地 JSON 数据"""
    json_path = Path(__file__).parent.parent / "app" / "services" / "remotion_agent" / "rag" / "data" / "benchmark_segments.json"
    
    if not json_path.exists():
        print(f"❌ 数据文件不存在: {json_path}")
        return []
    
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"📄 从 {json_path} 加载数据...")
    
    segments = []
    
    # 数据格式: {video_id: [segment_list]} 或 [segment_list]
    if isinstance(data, dict):
        # 嵌套格式: {video_id: [segments]}
        all_items = []
        for video_id, video_segments in data.items():
            all_items.extend(video_segments)
    else:
        # 扁平格式: [segments]
        all_items = data
    
    for item in all_items:
        try:
            # 处理 visual_config
            vc_data = item.get("visual_config", {})
            layout_mode = vc_data.get("layout_mode", "modeA")
            if isinstance(layout_mode, str):
                try:
                    layout_mode = LayoutMode(layout_mode)
                except ValueError:
                    layout_mode = LayoutMode.MODE_A
            
            visual_config = VisualConfigSnippet(
                layout_mode=layout_mode,
                has_broll=vc_data.get("has_broll", False),
                broll_keyword=vc_data.get("broll_keyword"),
                canvas_type=vc_data.get("canvas_type"),
            )
            
            segment = BenchmarkSegment(
                id=item["id"],
                source=BenchmarkSource(
                    video_id=item["source"]["video_id"],
                    video_title=item["source"].get("video_title", ""),
                    timestamp_start=item["source"].get("timestamp_start"),
                    timestamp_end=item["source"].get("timestamp_end"),
                ),
                input_text=item["input_text"],
                input_text_clean=item["input_text_clean"],
                content_type=item["content_type"],
                template_id=item["template_id"],
                broll_trigger_type=item.get("broll_trigger_type"),
                broll_trigger_pattern=item.get("broll_trigger_pattern"),
                visual_config=visual_config,
                reasoning=item.get("reasoning", ""),
                quality_score=item.get("quality_score", 1.0),
                tags=item.get("tags", []),
            )
            segments.append(segment)
        except Exception as e:
            print(f"  ⚠️ 解析失败: {e}, 数据: {item.get('id', 'unknown')}")
    
    return segments


def import_to_supabase(segments: list, clear_first: bool = True):
    """导入到 Supabase"""
    from app.services.remotion_agent.rag.vectorstore import get_vector_store, init_with_seed_data
    
    print(f"\n📤 准备导入 {len(segments)} 个片段到 Supabase...")
    
    if clear_first:
        print("  🗑️ 清空现有数据...")
    
    count = init_with_seed_data(segments, clear=clear_first)
    print(f"  ✅ 成功导入 {count} 个片段")
    
    return count


def verify_migration():
    """验证迁移结果"""
    from app.services.remotion_agent.rag.vectorstore import get_vector_store
    
    print("\n🔍 验证迁移结果...")
    vs = get_vector_store()
    
    count = vs.count()
    print(f"  📊 Supabase 中的片段数: {count}")
    
    if count == 0:
        print("  ⚠️ 数据库为空，需要先导入数据")
        return False
    
    # 测试获取单个
    videos = vs.list_videos()
    print(f"  📹 视频数量: {len(videos)}")
    if videos:
        print(f"  📹 视频列表: {videos[:5]}...")
    
    return True


def test_search():
    """测试搜索功能"""
    from app.services.remotion_agent.rag.vectorstore import get_vector_store
    
    print("\n🔎 测试搜索功能...")
    vs = get_vector_store()
    
    test_queries = [
        "股票投资的收益和风险",
        "医学研究和健康问题",
        "一个人背后，我们永远也看不到的东西",
    ]
    
    for query in test_queries:
        print(f"\n  查询: \"{query[:30]}...\"")
        result = vs.search(query, top_k=3)
        
        for i, (seg, score) in enumerate(zip(result.segments, result.scores)):
            print(f"    [{i+1}] 相似度: {score:.3f}")
            print(f"        视频: {seg.source.video_id}")
            print(f"        文本: {seg.input_text_clean[:50]}...")


def show_stats():
    """显示统计信息"""
    from app.services.remotion_agent.rag.vectorstore import get_vector_store
    
    print("\n📊 统计信息:")
    vs = get_vector_store()
    stats = vs.get_stats()
    
    for key, value in stats.items():
        print(f"  {key}: {value}")


def clear_data():
    """清空数据"""
    from app.services.remotion_agent.rag.vectorstore import get_vector_store
    
    print("\n🗑️ 清空所有数据...")
    vs = get_vector_store()
    vs.clear()
    print("  ✅ 已清空")


def main():
    parser = argparse.ArgumentParser(description="RAG 数据迁移到 Supabase")
    parser.add_argument("--import-json", action="store_true", help="从本地 JSON 导入数据")
    parser.add_argument("--verify", action="store_true", help="验证迁移结果")
    parser.add_argument("--test-search", action="store_true", help="测试搜索功能")
    parser.add_argument("--stats", action="store_true", help="查看统计信息")
    parser.add_argument("--clear", action="store_true", help="清空所有数据")
    parser.add_argument("--no-clear", action="store_true", help="导入时不清空现有数据")
    
    args = parser.parse_args()
    
    # 如果没有任何参数，显示帮助
    if not any([args.import_json, args.verify, args.test_search, args.stats, args.clear]):
        parser.print_help()
        print("\n💡 推荐操作流程:")
        print("  1. python scripts/migrate_rag_to_supabase.py --import-json  # 导入数据")
        print("  2. python scripts/migrate_rag_to_supabase.py --verify       # 验证")
        print("  3. python scripts/migrate_rag_to_supabase.py --test-search  # 测试搜索")
        return
    
    if args.clear:
        confirm = input("⚠️ 确定要清空所有数据吗？(y/N): ")
        if confirm.lower() == 'y':
            clear_data()
        else:
            print("已取消")
        return
    
    if args.import_json:
        segments = load_local_segments()
        if segments:
            print(f"  📦 加载了 {len(segments)} 个片段")
            import_to_supabase(segments, clear_first=not args.no_clear)
    
    if args.verify:
        verify_migration()
    
    if args.test_search:
        test_search()
    
    if args.stats:
        show_stats()


if __name__ == "__main__":
    main()
