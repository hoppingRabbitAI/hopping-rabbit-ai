#!/usr/bin/env python3
"""展示 RAG 种子数据结构"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.remotion_agent.rag.seed_data import SEED_DATA
import json

print("=" * 70)
print("RAG 种子数据 - 可用字段展示")
print("=" * 70)

# 找几个有完整配置的示例
count = 0
for seg in SEED_DATA:
    if seg.visual_config.canvas_type or seg.visual_config.has_broll:
        count += 1
        print()
        print(f"### 示例 {count}: {seg.id} ###")
        print()
        print("【输入】")
        print(f"  文本: {seg.input_text}")
        ct = seg.content_type.value if hasattr(seg.content_type, 'value') else seg.content_type
        print(f"  类型: {ct}")
        bt = seg.broll_trigger_type.value if seg.broll_trigger_type and hasattr(seg.broll_trigger_type, 'value') else seg.broll_trigger_type
        print(f"  触发类型: {bt or 'N/A'}")
        print()
        print("【视觉配置】")
        vc = seg.visual_config
        lm = vc.layout_mode.value if hasattr(vc.layout_mode, 'value') else vc.layout_mode
        print(f"  布局模式: {lm}")
        cvt = vc.canvas_type.value if vc.canvas_type and hasattr(vc.canvas_type, 'value') else vc.canvas_type
        print(f"  画布类型: {cvt or 'N/A'}")
        if vc.canvas_config:
            print(f"  画布配置:")
            for k, v in vc.canvas_config.items():
                print(f"    {k}: {v}")
        if vc.keyword_card:
            print(f"  关键词卡片: {vc.keyword_card}")
        print(f"  需要B-Roll: {vc.has_broll}")
        if vc.has_broll:
            print(f"  B-Roll描述: {vc.broll_description}")
        if vc.pip_config:
            print(f"  画中画: {vc.pip_config}")
        print()
        print(f"【推理】 {seg.reasoning}")
        print("-" * 70)
        
        if count >= 3:
            break

print()
print("=" * 70)
print("总结: RAG 可提供的信息")
print("=" * 70)
print("""
1. content_type (内容类型)
   - opener: 开场
   - concept: 概念讲解
   - data: 数据展示
   - comparison: 对比分析
   - example: 举例说明
   - summary: 总结
   - cta: 行动号召

2. layout_mode (布局模式)
   - MODE_A: 人物全屏 + 叠加元素
   - MODE_B: 人物画中画 + B-Roll 全屏
   - MODE_C: 人物画中画 + 画布全屏
   - MODE_D: 动态切换

3. canvas_type (画布类型)
   - point_list: 要点列表
   - comparison: 对比表格
   - data_chart: 数据图表
   - process_flow: 流程图
   - timeline: 时间线

4. keyword_card (关键词卡片)
   - variant: 样式变体
   - text: 显示文字
   - position: 位置

5. broll_trigger_type (B-Roll触发类型)
   - data_cite: 数据引用
   - product_mention: 产品提及
   - comparison: 对比
   - example_mention: 举例
   - process_desc: 流程描述
   - concept_visual: 概念可视化

6. reasoning (推理逻辑)
   - 为什么选择这个视觉配置的原因
""")
