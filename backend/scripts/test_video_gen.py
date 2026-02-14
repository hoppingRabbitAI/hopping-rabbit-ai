#!/usr/bin/env python3
"""
测试统一视频生成模块
"""
import sys
import importlib
sys.path.insert(0, '/Users/hexiangyang/rabbit-ai/lepus-ai/backend')

def test_imports():
    print("=" * 60)
    print("测试统一视频生成模块导入")
    print("=" * 60)
    
    # 1. 测试 base（绕过 services/__init__.py）
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "base", 
            "/Users/hexiangyang/rabbit-ai/lepus-ai/backend/app/services/video_generation/base.py"
        )
        base = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(base)
        
        VideoGeneratorBase = base.VideoGeneratorBase
        VideoTask = base.VideoTask
        VideoResult = base.VideoResult
        ModelInfo = base.ModelInfo
        
        print("✅ base 模块导入成功")
        print(f"   - VideoGeneratorBase: 抽象基类")
        print(f"   - VideoTask, VideoResult, ModelInfo: 数据模型")
    except Exception as e:
        print(f"❌ base 导入失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # 2. 测试 registry
    try:
        spec = importlib.util.spec_from_file_location(
            "registry", 
            "/Users/hexiangyang/rabbit-ai/lepus-ai/backend/app/services/video_generation/registry.py"
        )
        registry = importlib.util.module_from_spec(spec)
        
        # 需要先设置 base 模块
        sys.modules['app.services.video_generation.base'] = base
        spec.loader.exec_module(registry)
        
        list_providers = registry.list_providers
        list_models = registry.list_models
        
        print("✅ registry 模块导入成功")
        providers = list_providers()
        print(f"   已注册提供商: {providers}")
    except Exception as e:
        print(f"⚠️ registry 导入失败（需要完整环境）: {e}")
    
    print("=" * 60)
    print("基础模块测试完成!")
    print("")
    print("注意: 完整功能测试需要安装 langchain_core 依赖")
    print("在 Docker 容器中运行时会自动安装所有依赖")
    print("=" * 60)
    return True

if __name__ == "__main__":
    success = test_imports()
    sys.exit(0 if success else 1)
