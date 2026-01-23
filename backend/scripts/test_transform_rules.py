#!/usr/bin/env python3
"""
测试运镜规则引擎 (Transform Rule Engine)
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.transform_rules import (
    EmotionType,
    ImportanceLevel,
    SegmentContext,
    TransformParams,
    transform_engine,
    generate_transform,
    generate_transforms_batch,
    sequence_processor,
)


def test_emotion_zoom_mapping():
    """测试情绪→缩放比例映射"""
    print("=" * 60)
    print("🧪 测试: 情绪 → 缩放比例映射")
    print("=" * 60)
    
    test_cases = [
        # (emotion, importance, has_face, duration_ms)
        ("excited", "high", True, 3000),     # 激动+高重要
        ("excited", "medium", True, 3000),   # 激动+中
        ("serious", "high", True, 3000),     # 严肃+高
        ("happy", "medium", True, 3000),     # 轻松+中
        ("neutral", "medium", True, 3000),   # 平叙+中
        ("sad", "high", True, 3000),         # 悲伤+高
        ("neutral", "low", True, 3000),      # 平叙+低
    ]
    
    print(f"\n{'情绪':<10} {'重要性':<10} {'缩放范围':<18} {'缓动':<15} {'规则'}")
    print("-" * 75)
    
    for emotion, importance, has_face, duration in test_cases:
        context = SegmentContext(
            segment_id="test",
            duration_ms=duration,
            has_face=has_face,
            face_center_x=0.5,
            face_center_y=0.5,
            emotion=EmotionType(emotion),
            importance=ImportanceLevel(importance),
        )
        
        params = transform_engine.process(context)
        scale_range = f"{params.start_scale:.2f} → {params.end_scale:.2f}"
        
        print(f"{emotion:<10} {importance:<10} {scale_range:<18} {params.easing.value:<15} {params.rule_applied}")
    
    print()


def test_no_face_scenarios():
    """测试无人脸场景"""
    print("=" * 60)
    print("🧪 测试: 无人脸场景 (Ken Burns)")
    print("=" * 60)
    
    test_cases = [
        ("neutral", 3000),   # 普通场景
        ("excited", 4000),   # 激动场景
        ("sad", 5000),       # 悲伤场景
    ]
    
    print(f"\n{'情绪':<10} {'时长(s)':<10} {'效果':<20} {'规则'}")
    print("-" * 55)
    
    for emotion, duration in test_cases:
        context = SegmentContext(
            segment_id="test",
            duration_ms=duration,
            has_face=False,
            emotion=EmotionType(emotion),
            importance=ImportanceLevel.MEDIUM,
        )
        
        params = transform_engine.process(context)
        effect = f"scale={params.start_scale:.2f}, pan_x={params.position_x:.2f}"
        
        print(f"{emotion:<10} {duration/1000:<10.1f} {effect:<20} {params.rule_applied}")
    
    print()


def test_short_clips():
    """测试短片段处理"""
    print("=" * 60)
    print("🧪 测试: 短片段处理 (<1.5s)")
    print("=" * 60)
    
    test_cases = [
        (800, "high"),    # 极短+高重要
        (1200, "medium"), # 短+中
        (500, "low"),     # 极短+低
    ]
    
    print(f"\n{'时长(ms)':<10} {'重要性':<10} {'缩放':<18} {'规则'}")
    print("-" * 50)
    
    for duration, importance in test_cases:
        context = SegmentContext(
            segment_id="test",
            duration_ms=duration,
            has_face=True,
            emotion=EmotionType.NEUTRAL,
            importance=ImportanceLevel(importance),
        )
        
        params = transform_engine.process(context)
        scale_range = f"{params.start_scale:.2f} → {params.end_scale:.2f}"
        
        print(f"{duration:<10} {importance:<10} {scale_range:<18} {params.rule_applied}")
    
    print()


def test_keyframes_output():
    """测试关键帧输出格式"""
    print("=" * 60)
    print("🧪 测试: 关键帧输出格式")
    print("=" * 60)
    
    keyframes = generate_transform(
        segment_id="seg_001",
        duration_ms=3000,
        has_face=True,
        face_center_x=0.4,
        face_center_y=0.45,
        emotion="excited",
        importance="high",
    )
    
    print("\n生成的关键帧数据:")
    print(f"  enable_animation: {keyframes['enable_animation']}")
    print(f"  规则: {keyframes.get('_rule_applied', 'N/A')}")
    print(f"  关键帧数量: {len(keyframes['keyframes'])}")
    
    for i, kf in enumerate(keyframes['keyframes']):
        print(f"\n  [Keyframe {i}]")
        for key, value in kf.items():
            if isinstance(value, float):
                print(f"    {key}: {value:.4f}")
            else:
                print(f"    {key}: {value}")
    
    print()


def test_rule_list():
    """测试规则列表"""
    print("=" * 60)
    print("🧪 测试: 已注册规则列表")
    print("=" * 60)
    
    rules = transform_engine.list_rules()
    
    print(f"\n{'优先级':<10} {'规则名称'}")
    print("-" * 30)
    
    for rule in rules:
        print(f"{rule['priority']:<10} {rule['name']}")
    
    print(f"\n📌 共 {len(rules)} 条规则已注册")
    print()


def main():
    print("\n🚀 运镜规则引擎测试")
    print("=" * 60)
    
    test_rule_list()
    test_emotion_zoom_mapping()
    test_no_face_scenarios()
    test_short_clips()
    test_keyframes_output()
    test_sequence_aware()  # 新增：序列感知测试
    
    print("=" * 60)
    print("✅ 所有测试完成！")
    print("=" * 60)


def test_sequence_aware():
    """测试序列感知后处理器 - 连续片段多样性"""
    print("=" * 60)
    print("🧪 测试: 序列感知后处理器 (避免连续相同效果)")
    print("=" * 60)
    
    # 模拟连续 8 个相似片段（都是 neutral + medium）
    segments = []
    for i in range(8):
        segments.append({
            "segment_id": f"seg_{i:03d}",
            "duration_ms": 2500,
            "has_face": True,
            "face_center_x": 0.5,
            "face_center_y": 0.5,
            "emotion": "neutral",
            "importance": "medium",
            "is_breath": False,
        })
    
    print("\n📌 场景: 连续 8 个 neutral+medium 片段 (原本都会是 zoom_in)")
    
    # 不启用序列感知
    print("\n[不启用序列感知] 效果序列:")
    keyframes_without = generate_transforms_batch(segments, enable_sequence_aware=False)
    effects_without = []
    for i, kf in enumerate(keyframes_without):
        kfs = kf.get('keyframes', [])
        if len(kfs) >= 2:
            delta = kfs[1].get('scale', 1) - kfs[0].get('scale', 1)
            if abs(delta) < 0.03:
                effect = "static"
            elif delta > 0:
                effect = "zoom_in"
            else:
                effect = "zoom_out"
        else:
            effect = "static"
        effects_without.append(effect)
        print(f"  Clip {i+1}: {effect:10} | scale {kfs[0].get('scale', 1):.2f}→{kfs[-1].get('scale', 1):.2f}")
    
    # 启用序列感知
    print("\n[启用序列感知] 效果序列:")
    keyframes_with = generate_transforms_batch(segments, enable_sequence_aware=True)
    effects_with = []
    for i, kf in enumerate(keyframes_with):
        kfs = kf.get('keyframes', [])
        rule = kf.get('_rule_applied', 'unknown')
        if len(kfs) >= 2:
            delta = kfs[1].get('scale', 1) - kfs[0].get('scale', 1)
            if abs(delta) < 0.03:
                effect = "static"
            elif delta > 0:
                effect = "zoom_in"
            else:
                effect = "zoom_out"
        else:
            effect = "static"
        effects_with.append(effect)
        print(f"  Clip {i+1}: {effect:10} | scale {kfs[0].get('scale', 1):.2f}→{kfs[-1].get('scale', 1):.2f} | {rule}")
    
    # 对比
    print("\n📊 对比:")
    print(f"  不启用: {' → '.join(effects_without)}")
    print(f"  启用后: {' → '.join(effects_with)}")
    
    # 检查多样性提升
    without_unique = len(set(effects_without))
    with_unique = len(set(effects_with))
    print(f"\n  效果多样性: {without_unique} 种 → {with_unique} 种")
    
    # 测试高潮后休息
    print("\n" + "-" * 40)
    print("📌 场景: 高潮后休息 (excited+high 后接 neutral)")
    
    climax_segments = [
        {"segment_id": "c1", "duration_ms": 2000, "has_face": True, "emotion": "excited", "importance": "high"},
        {"segment_id": "c2", "duration_ms": 2000, "has_face": True, "emotion": "neutral", "importance": "medium"},
        {"segment_id": "c3", "duration_ms": 2000, "has_face": True, "emotion": "neutral", "importance": "medium"},
        {"segment_id": "c4", "duration_ms": 2000, "has_face": True, "emotion": "neutral", "importance": "medium"},
    ]
    
    keyframes_climax = generate_transforms_batch(climax_segments, enable_sequence_aware=True)
    
    print("\n  效果序列:")
    for i, kf in enumerate(keyframes_climax):
        kfs = kf.get('keyframes', [])
        rule = kf.get('_rule_applied', 'unknown')
        delta = kfs[-1].get('scale', 1) - kfs[0].get('scale', 1) if len(kfs) >= 2 else 0
        if abs(delta) < 0.03:
            effect = "static"
        elif delta > 0:
            effect = "zoom_in"
        else:
            effect = "zoom_out"
        label = "[高潮]" if i == 0 else f"[后续{i}]"
        print(f"  {label}: {effect:10} | {rule}")
    
    print()


if __name__ == "__main__":
    main()
