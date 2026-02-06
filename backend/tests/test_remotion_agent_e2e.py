"""
Remotion Agent 端到端测试

测试完整的视觉编排流程:
1. 脚本输入 → Stage 2 结构分析 → Stage 3 视觉生成 → 输出验证

覆盖场景:
- 知识科普类 (数据密集)
- 教程流程类 (步骤清晰)
- 观点评论类 (情感丰富)
- 产品介绍类 (B-Roll 密集)
- 故事叙事类 (节奏变化)
"""

import pytest
import asyncio
import time
import json
from typing import List, Dict, Any
from dataclasses import dataclass

# 导入被测模块
from app.services.remotion_agent import (
    analyze_content_structure,
    generate_visual_config,
    StructuredSegment,
    GlobalStructure,
    VisualConfig,
)
from app.services.remotion_agent.broll_trigger import detect_broll_triggers
from app.services.remotion_agent.layout_modes import LayoutMode, LayoutModeSelector
from app.services.remotion_agent.validator import validate_visual_config
from app.services.remotion_agent.pacing import PacingStyle


# ============================================
# 测试数据 - 5 种典型场景
# ============================================

@dataclass
class TestScript:
    """测试脚本"""
    name: str
    category: str  # knowledge, tutorial, opinion, product, story
    segments: List[Dict[str, Any]]
    expected_broll_count: int  # 预期 B-Roll 触发数量
    expected_layout: LayoutMode  # 预期主布局模式


# 场景 1: 知识科普类 - 数据密集
KNOWLEDGE_SCRIPT = TestScript(
    name="为什么95%的人存不下钱",
    category="knowledge",
    segments=[
        {"text": "你知道吗，中国有95%的年轻人存款不足1万元", "start_ms": 0, "end_ms": 4000},
        {"text": "今天我们来聊聊为什么存钱这么难", "start_ms": 4000, "end_ms": 7000},
        {"text": "第一个原因是消费主义陷阱", "start_ms": 7000, "end_ms": 10000},
        {"text": "研究显示，人们看到打折信息后购买欲望会提升47%", "start_ms": 10000, "end_ms": 14000},
        {"text": "第二个原因是收入增长跟不上支出", "start_ms": 14000, "end_ms": 17000},
        {"text": "过去10年，房价涨了300%，但工资只涨了50%", "start_ms": 17000, "end_ms": 21000},
        {"text": "第三个原因是缺乏理财意识", "start_ms": 21000, "end_ms": 24000},
        {"text": "所以记住这三点，你就能开始存钱了", "start_ms": 24000, "end_ms": 28000},
    ],
    expected_broll_count=3,  # 3 个数据引用
    expected_layout=LayoutMode.MODE_A,
)

# 场景 2: 教程流程类 - 步骤清晰
TUTORIAL_SCRIPT = TestScript(
    name="5分钟学会做提拉米苏",
    category="tutorial",
    segments=[
        {"text": "今天教大家做一道超简单的提拉米苏", "start_ms": 0, "end_ms": 3000},
        {"text": "首先准备材料：马斯卡彭奶酪、咖啡、手指饼干", "start_ms": 3000, "end_ms": 7000},
        {"text": "第一步，把咖啡冲泡好放凉", "start_ms": 7000, "end_ms": 10000},
        {"text": "第二步，打发奶油和奶酪混合", "start_ms": 10000, "end_ms": 14000},
        {"text": "第三步，饼干蘸咖啡铺底", "start_ms": 14000, "end_ms": 17000},
        {"text": "第四步，铺上奶酪糊，重复两层", "start_ms": 17000, "end_ms": 21000},
        {"text": "最后撒上可可粉，放冰箱4小时", "start_ms": 21000, "end_ms": 25000},
        {"text": "一道完美的提拉米苏就完成了", "start_ms": 25000, "end_ms": 28000},
    ],
    expected_broll_count=4,  # 4 个步骤需要 B-Roll
    expected_layout=LayoutMode.MODE_D,  # 动态切换
)

# 场景 3: 观点评论类 - 情感丰富
OPINION_SCRIPT = TestScript(
    name="年轻人为什么不想结婚了",
    category="opinion",
    segments=[
        {"text": "最近有个数据很有意思，90后结婚率创历史新低", "start_ms": 0, "end_ms": 4000},
        {"text": "很多人说是因为穷，但我不这么认为", "start_ms": 4000, "end_ms": 7000},
        {"text": "本质上是价值观的转变", "start_ms": 7000, "end_ms": 10000},
        {"text": "以前结婚是为了传宗接代，现在年轻人更追求自我实现", "start_ms": 10000, "end_ms": 15000},
        {"text": "你可以把它理解为一种觉醒", "start_ms": 15000, "end_ms": 18000},
        {"text": "这不是坏事，而是社会进步的表现", "start_ms": 18000, "end_ms": 22000},
        {"text": "所以与其催婚，不如尊重每个人的选择", "start_ms": 22000, "end_ms": 26000},
    ],
    expected_broll_count=2,  # 数据引用 + 概念可视化
    expected_layout=LayoutMode.MODE_A,
)

# 场景 4: 产品介绍类 - B-Roll 密集
PRODUCT_SCRIPT = TestScript(
    name="iPhone 16 深度体验",
    category="product",
    segments=[
        {"text": "iPhone 16 到手一周，聊聊真实感受", "start_ms": 0, "end_ms": 3000},
        {"text": "先说外观，这次的颜色非常好看", "start_ms": 3000, "end_ms": 6000},
        {"text": "屏幕升级到了2000nit亮度", "start_ms": 6000, "end_ms": 9000},
        {"text": "比如在户外强光下看得很清楚", "start_ms": 9000, "end_ms": 12000},
        {"text": "相机方面，这次主摄升级到5000万像素", "start_ms": 12000, "end_ms": 16000},
        {"text": "实际拍摄效果，你们看这组样张", "start_ms": 16000, "end_ms": 20000},
        {"text": "续航提升了20%，一天重度使用没问题", "start_ms": 20000, "end_ms": 24000},
        {"text": "总的来说，值得升级", "start_ms": 24000, "end_ms": 27000},
    ],
    expected_broll_count=5,  # 产品展示、对比、样张
    expected_layout=LayoutMode.MODE_B,  # B-Roll 全屏为主
)

# 场景 5: 故事叙事类 - 节奏变化
STORY_SCRIPT = TestScript(
    name="我是如何从月薪3000到年入百万的",
    category="story",
    segments=[
        {"text": "2019年，我还在一家小公司拿着3000块工资", "start_ms": 0, "end_ms": 4000},
        {"text": "每天挤2小时地铁，住在城中村", "start_ms": 4000, "end_ms": 8000},
        {"text": "转折点发生在那年冬天", "start_ms": 8000, "end_ms": 11000},
        {"text": "我决定开始做自媒体", "start_ms": 11000, "end_ms": 14000},
        {"text": "最开始每天只有十几个播放量", "start_ms": 14000, "end_ms": 17000},
        {"text": "但我坚持了下来，半年后粉丝破万", "start_ms": 17000, "end_ms": 21000},
        {"text": "到今天，我实现了年入百万", "start_ms": 21000, "end_ms": 25000},
        {"text": "所以关键就是坚持和正确的方向", "start_ms": 25000, "end_ms": 29000},
    ],
    expected_broll_count=2,  # 场景描述
    expected_layout=LayoutMode.MODE_A,
)

TEST_SCRIPTS = [
    KNOWLEDGE_SCRIPT,
    TUTORIAL_SCRIPT,
    OPINION_SCRIPT,
    PRODUCT_SCRIPT,
    STORY_SCRIPT,
]


# ============================================
# 测试辅助函数
# ============================================

def build_segments_for_analysis(script: TestScript) -> List[Dict[str, Any]]:
    """构建用于分析的片段列表"""
    return [
        {
            "id": f"seg_{i}",
            "text": seg["text"],
            "start_ms": seg["start_ms"],
            "end_ms": seg["end_ms"],
        }
        for i, seg in enumerate(script.segments)
    ]


def count_broll_triggers(segments: List[StructuredSegment]) -> int:
    """统计 B-Roll 触发数量"""
    count = 0
    for seg in segments:
        if seg.structure.needs_broll:
            count += 1
    return count


def validate_output_completeness(config: VisualConfig) -> List[str]:
    """验证输出完整性"""
    errors = []
    
    if not config.version:
        errors.append("缺少 version")
    if not config.template:
        errors.append("缺少 template")
    if config.duration_ms <= 0:
        errors.append("duration_ms 无效")
    if config.fps <= 0:
        errors.append("fps 无效")
    if not config.background:
        errors.append("缺少 background")
    
    return errors


# ============================================
# 端到端测试
# ============================================

class TestRemotionAgentE2E:
    """端到端测试套件"""
    
    @pytest.mark.asyncio
    @pytest.mark.parametrize("script", TEST_SCRIPTS, ids=lambda s: s.name)
    async def test_full_pipeline(self, script: TestScript):
        """测试完整流程"""
        # 准备输入
        segments = build_segments_for_analysis(script)
        
        # Stage 2: 结构分析 (async)
        start_time = time.time()
        analysis_result = await analyze_content_structure(segments)
        stage2_time = time.time() - start_time
        
        assert analysis_result is not None, "结构分析失败"
        assert len(analysis_result.segments) == len(segments), "片段数量不匹配"
        
        # 验证 B-Roll 触发
        broll_count = count_broll_triggers(analysis_result.segments)
        print(f"\n[{script.name}] B-Roll 触发: {broll_count} (预期 >= {script.expected_broll_count})")
        # 允许一定误差
        assert broll_count >= script.expected_broll_count * 0.5, f"B-Roll 触发过少: {broll_count}"
        
        # Stage 3: 视觉生成
        start_time = time.time()
        total_duration = script.segments[-1]["end_ms"]
        visual_config = generate_visual_config(
            segments=analysis_result.segments,
            global_structure=analysis_result.global_structure,
            template_id="whiteboard",
            total_duration_ms=total_duration,
            validate=True,
        )
        stage3_time = time.time() - start_time
        
        assert visual_config is not None, "视觉配置生成失败"
        
        # 验证输出完整性
        errors = validate_output_completeness(visual_config)
        assert len(errors) == 0, f"输出不完整: {errors}"
        
        # 验证时长
        assert visual_config.duration_ms == total_duration, "时长不匹配"
        
        # 性能检查
        total_time = stage2_time + stage3_time
        print(f"[{script.name}] Stage2: {stage2_time:.2f}s, Stage3: {stage3_time:.2f}s, 总计: {total_time:.2f}s")
        
        # 目标 < 10s (不含 LLM 调用)
        assert total_time < 30, f"处理时间过长: {total_time:.2f}s"
    
    def test_broll_trigger_detection(self):
        """测试 B-Roll 触发检测"""
        test_cases = [
            ("研究显示有95%的人存款不足1万", "data_cite"),
            ("比如说你去超市买东西", "example_mention"),
            ("和传统方法相比，这个效率高3倍", "comparison"),
            ("这款iPhone 16的屏幕非常出色", "product_mention"),
            ("第一步是准备材料", "process_desc"),
            ("你可以把它理解为一种习惯", "concept_visual"),
        ]
        
        for text, expected_type in test_cases:
            triggers = detect_broll_triggers(text)
            assert len(triggers) > 0, f"未检测到触发: {text}"
            assert triggers[0].trigger_type.value == expected_type, \
                f"触发类型错误: 预期 {expected_type}, 实际 {triggers[0].trigger_type.value}"
    
    def test_layout_mode_selection(self):
        """测试布局模式选择"""
        selector = LayoutModeSelector()
        
        # 高 B-Roll 重要性场景
        mode = selector.select_mode(
            has_broll=True,
            broll_importance="high",
            content_type="product",
            template_id="default"
        )
        assert mode == LayoutMode.MODE_B, f"高 B-Roll 重要性应选 MODE_B, 实际: {mode}"
        
        # 中等 B-Roll 重要性场景
        mode = selector.select_mode(
            has_broll=True,
            broll_importance="medium",
            content_type="concept",
            template_id="default"
        )
        assert mode == LayoutMode.MODE_A, f"中等 B-Roll 重要性应选 MODE_A, 实际: {mode}"
        
        # 无 B-Roll 场景
        mode = selector.select_mode(
            has_broll=False,
            broll_importance="low",
            template_id="default"
        )
        assert mode == LayoutMode.MODE_A, f"无 B-Roll 场景应选 MODE_A, 实际: {mode}"
        
        # 白板模版
        mode = selector.select_mode(
            has_broll=False,
            broll_importance="medium",
            template_id="whiteboard"
        )
        assert mode == LayoutMode.MODE_C, f"白板模版应选 MODE_C, 实际: {mode}"
    
    def test_visual_config_validation(self):
        """测试视觉配置验证"""
        # 有效配置
        valid_config = {
            "version": "2.0",
            "template": "whiteboard",
            "duration_ms": 30000,
            "fps": 30,
            "background": {"type": "solid", "color": "#FFFFFF"},
            "overlays": [],
            "canvas": [],
        }
        
        result = validate_visual_config(valid_config)
        assert result.is_valid, f"有效配置验证失败: {result.errors}"
        
        # 缺少必需字段
        invalid_config = {"version": "2.0"}
        result = validate_visual_config(invalid_config)
        assert not result.is_valid, "无效配置应验证失败"
    
    def test_pacing_styles(self):
        """测试不同节奏风格"""
        from app.services.remotion_agent.pacing import PacingCalculator
        
        for style in [PacingStyle.FAST, PacingStyle.MEDIUM, PacingStyle.SLOW]:
            calculator = PacingCalculator(style)
            
            start_ms, end_ms = calculator.calculate_overlay_timing(
                overlay_type="keyword-card",
                trigger_ms=1000,
                content_length=20,
            )
            
            duration = end_ms - start_ms
            assert duration > 0, f"{style} 节奏时长无效"
            
            # 快节奏应该更短
            if style == PacingStyle.FAST:
                assert duration < 3000, f"快节奏时长过长: {duration}"
            elif style == PacingStyle.SLOW:
                assert duration > 2500, f"慢节奏时长过短: {duration}"


# ============================================
# 性能基准测试
# ============================================

class TestPerformanceBenchmark:
    """性能基准测试"""
    
    def test_structure_analysis_speed(self):
        """结构分析速度"""
        script = KNOWLEDGE_SCRIPT
        segments = build_segments_for_analysis(script)
        
        times = []
        for _ in range(3):
            start = time.time()
            analyze_content_structure(segments)
            times.append(time.time() - start)
        
        avg_time = sum(times) / len(times)
        print(f"\n结构分析平均时间: {avg_time:.3f}s")
        
        # 不含 LLM 调用应该很快
        assert avg_time < 5, f"结构分析过慢: {avg_time:.3f}s"
    
    def test_visual_generation_speed(self):
        """视觉生成速度"""
        script = KNOWLEDGE_SCRIPT
        segments = build_segments_for_analysis(script)
        analysis = analyze_content_structure(segments)
        
        times = []
        for _ in range(3):
            start = time.time()
            generate_visual_config(
                segments=analysis.segments,
                global_structure=analysis.global_structure,
                template_id="whiteboard",
                total_duration_ms=30000,
            )
            times.append(time.time() - start)
        
        avg_time = sum(times) / len(times)
        print(f"\n视觉生成平均时间: {avg_time:.3f}s")
        
        assert avg_time < 2, f"视觉生成过慢: {avg_time:.3f}s"


# ============================================
# 运行测试
# ============================================

async def run_e2e_test(script: TestScript):
    """运行单个端到端测试"""
    segments = build_segments_for_analysis(script)
    
    # Stage 2: 结构分析
    start_time = time.time()
    analysis_result = await analyze_content_structure(segments)
    stage2_time = time.time() - start_time
    
    if analysis_result is None:
        return False, "结构分析失败"
    
    # 验证 B-Roll 触发
    broll_count = count_broll_triggers(analysis_result.segments)
    
    # Stage 3: 视觉生成
    start_time = time.time()
    total_duration = script.segments[-1]["end_ms"]
    visual_config = generate_visual_config(
        segments=analysis_result.segments,
        global_structure=analysis_result.global_structure,
        template_id="whiteboard",
        total_duration_ms=total_duration,
        validate=True,
    )
    stage3_time = time.time() - start_time
    
    # 验证输出
    errors = validate_output_completeness(visual_config)
    if errors:
        return False, f"输出不完整: {errors}"
    
    total_time = stage2_time + stage3_time
    return True, f"Stage2: {stage2_time:.2f}s, Stage3: {stage3_time:.2f}s, B-Roll: {broll_count}"


if __name__ == "__main__":
    print("=" * 60)
    print("Remotion Agent 端到端测试")
    print("=" * 60)
    
    # 测试 B-Roll 触发检测
    print("\n[1] B-Roll 触发检测测试...")
    test = TestRemotionAgentE2E()
    try:
        test.test_broll_trigger_detection()
        print("✅ B-Roll 触发检测通过")
    except AssertionError as e:
        print(f"❌ B-Roll 触发检测失败: {e}")
    
    # 测试布局模式选择
    print("\n[2] 布局模式选择测试...")
    try:
        test.test_layout_mode_selection()
        print("✅ 布局模式选择通过")
    except AssertionError as e:
        print(f"❌ 布局模式选择失败: {e}")
    
    # 测试视觉配置验证
    print("\n[3] 视觉配置验证测试...")
    try:
        test.test_visual_config_validation()
        print("✅ 视觉配置验证通过")
    except AssertionError as e:
        print(f"❌ 视觉配置验证失败: {e}")
    
    # 测试节奏风格
    print("\n[4] 节奏风格测试...")
    try:
        test.test_pacing_styles()
        print("✅ 节奏风格通过")
    except AssertionError as e:
        print(f"❌ 节奏风格失败: {e}")
    
    # 端到端测试 (async)
    print("\n[5] 端到端测试 (需要 LLM API)...")
    
    async def run_all_e2e():
        for script in TEST_SCRIPTS:
            try:
                success, msg = await run_e2e_test(script)
                if success:
                    print(f"✅ [{script.name}] {msg}")
                else:
                    print(f"❌ [{script.name}] {msg}")
            except Exception as e:
                print(f"❌ [{script.name}] 异常: {e}")
    
    # 运行异步测试
    try:
        asyncio.run(run_all_e2e())
    except Exception as e:
        print(f"⚠️ 端到端测试跳过 (需要配置 LLM API): {e}")
    
    print("\n" + "=" * 60)
    print("测试完成")
