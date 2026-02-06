#!/usr/bin/env python3
"""
测试 B-Roll 触发检测功能

验证 6 种触发类型的识别准确性
"""

import sys
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from app.services.remotion_agent.broll_trigger import (
    detect_broll_triggers,
    detect_primary_trigger,
    has_broll_trigger,
    get_broll_trigger_types,
    BrollTriggerType,
)


# 测试用例
TEST_CASES = [
    # 数据引用 (data_cite)
    {
        "text": "去年全球AI市场规模突破了5000亿美元，同比增长35%",
        "expected_types": [BrollTriggerType.DATA_CITE],
        "description": "数据引用: 大数字 + 百分比",
    },
    {
        "text": "根据最新报告显示，用户数已经达到了1亿",
        "expected_types": [BrollTriggerType.DATA_CITE],
        "description": "数据引用: 报告引用 + 里程碑数字",
    },
    
    # 举例说明 (example_mention)
    {
        "text": "比如说乔布斯，1985年被自己创办的公司赶出去",
        "expected_types": [BrollTriggerType.EXAMPLE_MENTION],
        "description": "举例说明: 比如说 + 人物",
    },
    {
        "text": "以特斯拉为例，它的市值已经超过了传统车企",
        "expected_types": [BrollTriggerType.EXAMPLE_MENTION],
        "description": "举例说明: 以...为例",
    },
    
    # 对比分析 (comparison)
    {
        "text": "和去年的iPhone 15相比，续航提升了25%",
        "expected_types": [BrollTriggerType.COMPARISON, BrollTriggerType.DATA_CITE],
        "description": "对比分析: 和...相比",
    },
    {
        "text": "iPhone vs 安卓，到底哪个更好用？",
        "expected_types": [BrollTriggerType.COMPARISON],
        "description": "对比分析: vs 对比",
    },
    
    # 产品/品牌提及 (product_mention)
    {
        "text": "iPhone 16 Pro Max最大的升级就是这颗A18芯片",
        "expected_types": [BrollTriggerType.PRODUCT_MENTION],
        "description": "产品提及: iPhone 产品线",
    },
    {
        "text": "ChatGPT现在已经可以联网搜索了",
        "expected_types": [BrollTriggerType.PRODUCT_MENTION],
        "description": "产品提及: AI 产品",
    },
    {
        "text": "在抖音上，这种视频非常火",
        "expected_types": [BrollTriggerType.PRODUCT_MENTION],
        "description": "产品提及: 平台名称",
    },
    
    # 流程描述 (process_desc)
    {
        "text": "第一步，选中你的数据区域，注意要包含表头",
        "expected_types": [BrollTriggerType.PROCESS_DESC],
        "description": "流程描述: 第一步",
    },
    {
        "text": "首先打开设置，然后找到隐私选项，最后关闭追踪",
        "expected_types": [BrollTriggerType.PROCESS_DESC],
        "description": "流程描述: 首先...然后...最后",
    },
    
    # 概念可视化 (concept_visual)
    {
        "text": "简单来说，咖啡因就像一把钥匙，锁住了让你困的那扇门",
        "expected_types": [BrollTriggerType.CONCEPT_VISUAL],
        "description": "概念可视化: 就像 比喻",
    },
    {
        "text": "你可以把它理解为一个智能管家",
        "expected_types": [BrollTriggerType.CONCEPT_VISUAL],
        "description": "概念可视化: 理解为 类比",
    },
    
    # 无触发
    {
        "text": "今天我们来聊一聊这个话题",
        "expected_types": [],
        "description": "无触发: 普通口播",
    },
    {
        "text": "好的，这就是我今天想分享的内容",
        "expected_types": [],
        "description": "无触发: 结束语",
    },
]


def run_tests():
    """运行测试"""
    print("=" * 60)
    print("B-Roll 触发检测测试")
    print("=" * 60)
    
    passed = 0
    failed = 0
    
    for i, case in enumerate(TEST_CASES, 1):
        text = case["text"]
        expected = set(case["expected_types"])
        description = case["description"]
        
        # 检测触发
        triggers = detect_broll_triggers(text)
        actual_types = set(t.trigger_type for t in triggers)
        
        # 判断结果
        # 只要期望的类型都被检测到就算通过
        matched = expected.issubset(actual_types) if expected else len(actual_types) == 0
        
        status = "✅ PASS" if matched else "❌ FAIL"
        if matched:
            passed += 1
        else:
            failed += 1
        
        print(f"\n[{i}] {status} - {description}")
        print(f"    文本: {text[:50]}...")
        print(f"    期望: {[t.value for t in expected] if expected else '无触发'}")
        print(f"    实际: {[t.trigger_type.value for t in triggers] if triggers else '无触发'}")
        
        if triggers:
            primary = triggers[0]
            print(f"    主触发: {primary.trigger_type.value} | {primary.matched_text}")
            print(f"    建议: {primary.suggested_broll}")
    
    print("\n" + "=" * 60)
    print(f"测试结果: {passed} 通过, {failed} 失败")
    print("=" * 60)
    
    return failed == 0


def test_detector_api():
    """测试检测器 API"""
    print("\n" + "=" * 60)
    print("API 功能测试")
    print("=" * 60)
    
    text = "比如说苹果公司，它的市值已经超过了3万亿美元，增长了50%"
    
    print(f"\n测试文本: {text}")
    
    # 测试 has_broll_trigger
    has_trigger = has_broll_trigger(text)
    print(f"\n1. has_broll_trigger(): {has_trigger}")
    
    # 测试 get_broll_trigger_types
    trigger_types = get_broll_trigger_types(text)
    print(f"2. get_broll_trigger_types(): {[t.value for t in trigger_types]}")
    
    # 测试 detect_primary_trigger
    primary = detect_primary_trigger(text)
    if primary:
        print(f"3. detect_primary_trigger():")
        print(f"   - 类型: {primary.trigger_type.value}")
        print(f"   - 匹配: {primary.matched_text}")
        print(f"   - 重要性: {primary.importance}")
        print(f"   - 建议: {primary.suggested_broll}")
    
    # 测试 detect_broll_triggers
    all_triggers = detect_broll_triggers(text)
    print(f"4. detect_broll_triggers(): 共 {len(all_triggers)} 个触发点")
    for t in all_triggers:
        print(f"   - [{t.trigger_type.value}] {t.matched_text}")


if __name__ == "__main__":
    success = run_tests()
    test_detector_api()
    
    sys.exit(0 if success else 1)
