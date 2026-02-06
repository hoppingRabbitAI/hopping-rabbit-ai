#!/usr/bin/env python3
"""
Remotion Agent 测试脚本

测试 Stage 2 (结构分析) 和 Stage 3 (视觉编排) 的完整流水线
"""

import asyncio
import json
import sys
import os

# 添加项目路径
backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_path)

# 直接导入具体模块，避免触发 services/__init__.py
import importlib.util

def load_module_direct(module_name, file_path):
    """直接加载模块，绕过包初始化"""
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module

# 先加载 models
models = load_module_direct(
    "remotion_agent_models",
    os.path.join(backend_path, "app/services/remotion_agent/models.py")
)

# 加载 templates
templates_base = load_module_direct(
    "remotion_agent_templates_base",
    os.path.join(backend_path, "app/services/remotion_agent/templates/base.py")
)

# 注册到 templates 包
sys.modules["app"] = type(sys)("app")
sys.modules["app.services"] = type(sys)("app.services")
sys.modules["app.services.remotion_agent"] = type(sys)("app.services.remotion_agent")
sys.modules["app.services.remotion_agent.models"] = models
sys.modules["app.services.remotion_agent.templates"] = type(sys)("templates")
sys.modules["app.services.remotion_agent.templates.base"] = templates_base

# 加载 whiteboard 模板
whiteboard = load_module_direct(
    "remotion_agent_templates_whiteboard",
    os.path.join(backend_path, "app/services/remotion_agent/templates/whiteboard.py")
)
sys.modules["app.services.remotion_agent.templates.whiteboard"] = whiteboard

# 加载 talking_head 模板
talking_head = load_module_direct(
    "remotion_agent_templates_talking_head",
    os.path.join(backend_path, "app/services/remotion_agent/templates/talking_head.py")
)
sys.modules["app.services.remotion_agent.templates.talking_head"] = talking_head

# 设置 templates 模块的属性
templates_module = sys.modules["app.services.remotion_agent.templates"]
templates_module.get_template = templates_base.get_template
templates_module.TemplateConfig = templates_base.TemplateConfig
templates_module.TEMPLATES = templates_base.TEMPLATES

# 加载 stage2
stage2 = load_module_direct(
    "remotion_agent_stage2",
    os.path.join(backend_path, "app/services/remotion_agent/stage2_structure.py")
)

# 加载 stage3
stage3 = load_module_direct(
    "remotion_agent_stage3",
    os.path.join(backend_path, "app/services/remotion_agent/stage3_visual.py")
)

# 使用导入的模块
_fallback_structure_analysis = stage2._fallback_structure_analysis
generate_visual_config = stage3.generate_visual_config
GlobalStructure = models.GlobalStructure


# 测试用例：知识类博主典型内容
TEST_SEGMENTS = [
    {
        "id": "seg_001",
        "text": "你知道为什么大多数创业公司都失败了吗？",
        "start_ms": 0,
        "end_ms": 3000,
    },
    {
        "id": "seg_002",
        "text": "今天我要分享一个非常重要的概念：MVP，最小可执行产品",
        "start_ms": 3000,
        "end_ms": 7000,
    },
    {
        "id": "seg_003",
        "text": "第一点，MVP 能帮你用最小的成本验证想法",
        "start_ms": 7000,
        "end_ms": 11000,
    },
    {
        "id": "seg_004",
        "text": "第二点，只需要 20% 的投入就能完成核心功能闭环",
        "start_ms": 11000,
        "end_ms": 15000,
    },
    {
        "id": "seg_005",
        "text": "第三点，快速迭代比完美发布更重要",
        "start_ms": 15000,
        "end_ms": 19000,
    },
    {
        "id": "seg_006",
        "text": "数据显示，采用 MVP 方法的团队成功率提升了 300%",
        "start_ms": 19000,
        "end_ms": 23000,
    },
    {
        "id": "seg_007",
        "text": "所以记住，先做出来比做完美更重要。Done is better than perfect!",
        "start_ms": 23000,
        "end_ms": 28000,
    },
]


async def test_structure_analysis():
    """测试 Stage 2: 内容结构分析 (需要 LLM)"""
    print("\n" + "="*60)
    print("Stage 2: 内容结构分析 (LLM)")
    print("="*60)
    print("⚠️ 跳过 - 需要 LLM API 配置")
    return None


def test_visual_generation(structure_result):
    """测试 Stage 3: 视觉编排"""
    print("\n" + "="*60)
    print("Stage 3: 视觉编排")
    print("="*60)
    
    try:
        config = generate_visual_config(
            segments=structure_result.segments,
            global_structure=structure_result.global_structure,
            template_id="whiteboard",
            total_duration_ms=28000,
            pip_position="bottom-right",
        )
        
        print(f"\n✅ 配置生成完成")
        print(f"模板: {config.template}")
        print(f"时长: {config.duration_ms}ms")
        print(f"FPS: {config.fps}")
        
        print(f"\n画布配置 ({len(config.canvas)} 个):")
        for c in config.canvas:
            print(f"  - {c.type}: {c.start_ms}ms ~ {c.end_ms}ms")
            if c.point_list:
                print(f"    └── {len(c.point_list.items)} 个要点")
            if c.process_flow:
                print(f"    └── {len(c.process_flow.steps)} 个步骤")
        
        print(f"\n叠加组件 ({len(config.overlays)} 个):")
        for o in config.overlays:
            print(f"  - {o.type}: {o.start_ms}ms ~ {o.end_ms}ms @ {o.position}")
        
        print(f"\n背景: {config.background.type}")
        print(f"PiP: {config.pip.position if config.pip else 'None'}")
        
        # 输出完整 JSON
        print(f"\n完整配置 JSON:")
        print(json.dumps(config.model_dump(), indent=2, ensure_ascii=False, default=str))
        
        return config
        
    except Exception as e:
        print(f"\n❌ 生成失败: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_fallback_mode():
    """测试降级模式（不调用 LLM）"""
    print("\n" + "="*60)
    print("降级模式测试（规则引擎）")
    print("="*60)
    
    from app.services.remotion_agent.stage2_structure import _fallback_structure_analysis
    from app.services.remotion_agent.models import GlobalStructure
    
    try:
        segments, global_struct = _fallback_structure_analysis(TEST_SEGMENTS)
        
        print(f"\n✅ 降级分析完成")
        print(f"片段数: {len(segments)}")
        print(f"全局结构:")
        print(f"  - 有要点列表: {global_struct.has_point_list}")
        print(f"  - 要点数量: {global_struct.point_list_count}")
        
        # 测试视觉生成
        config = generate_visual_config(
            segments=segments,
            global_structure=global_struct,
            template_id="whiteboard",
            total_duration_ms=28000,
        )
        
        print(f"\n✅ 降级配置生成完成")
        print(f"画布数: {len(config.canvas)}")
        print(f"叠加组件数: {len(config.overlays)}")
        
        return True
        
    except Exception as e:
        print(f"\n❌ 降级测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """运行所有测试"""
    print("\n" + "="*60)
    print("🚀 Remotion Agent 测试")
    print("="*60)
    
    # 1. 测试降级模式（不需要 LLM）
    test_fallback_mode()
    
    # 2. 测试完整流水线（需要 LLM）
    print("\n\n" + "="*60)
    print("完整流水线测试（需要 LLM API）")
    print("="*60)
    
    try:
        # Stage 2
        result = await test_structure_analysis()
        
        if result:
            # Stage 3
            test_visual_generation(result)
    except Exception as e:
        print(f"\n⚠️ 完整流水线测试跳过: {e}")
        print("提示: 需要配置 LLM API 密钥")
    
    print("\n" + "="*60)
    print("✅ 测试完成")
    print("="*60)


if __name__ == "__main__":
    asyncio.run(main())
