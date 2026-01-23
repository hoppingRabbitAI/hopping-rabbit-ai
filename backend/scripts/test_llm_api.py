#!/usr/bin/env python3
"""
测试火山方舟 (豆包) LLM API 连接
"""
import asyncio
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.llm_service import call_doubao_llm, is_llm_configured, analyze_segments_batch


async def test_basic_call():
    """测试基础 API 调用"""
    print("=" * 50)
    print("🧪 测试 1: 基础 API 调用")
    print("=" * 50)
    
    if not is_llm_configured():
        print("❌ LLM API 未配置")
        return False
    
    print("✅ API Key 已配置")
    
    # 简单测试
    response = await call_doubao_llm(
        prompt="请用一句话介绍你自己。",
        system_prompt="你是一个友好的AI助手。",
        max_tokens=100
    )
    
    if response:
        print(f"✅ API 调用成功!")
        print(f"📝 响应: {response[:200]}...")
        return True
    else:
        print("❌ API 调用失败")
        return False


async def test_emotion_analysis():
    """测试情绪分析功能"""
    print("\n" + "=" * 50)
    print("🧪 测试 2: 情绪分析功能")
    print("=" * 50)
    
    test_segments = [
        {"id": "seg_001", "text": "大家好，欢迎来到我的频道！"},
        {"id": "seg_002", "text": "今天我要给大家分享一个非常重要的技巧！"},
        {"id": "seg_003", "text": "这个方法真的太厉害了，彻底改变了我的工作流！"},
        {"id": "seg_004", "text": "好的，那我们下期再见。"},
    ]
    
    print(f"📤 发送 {len(test_segments)} 个测试片段...")
    
    results = await analyze_segments_batch(test_segments)
    
    if results:
        print("✅ 情绪分析成功!")
        for seg_id, analysis in results.items():
            print(f"  [{seg_id}] emotion={analysis['emotion']}, importance={analysis['importance']}, keywords={analysis['keywords']}")
        return True
    else:
        print("❌ 情绪分析返回空结果")
        return False


async def main():
    print("\n🚀 火山方舟 LLM API 测试")
    print("=" * 50)
    
    # 显示配置信息
    from app.config import get_settings
    settings = get_settings()
    print(f"📌 API Base: https://ark.cn-beijing.volces.com/api/v3")
    print(f"📌 Model: {settings.doubao_model_endpoint}")
    print(f"📌 API Key: {settings.volcengine_ark_api_key[:8]}...{settings.volcengine_ark_api_key[-4:]}")
    
    # 执行测试
    test1_passed = await test_basic_call()
    test2_passed = await test_emotion_analysis()
    
    # 总结
    print("\n" + "=" * 50)
    print("📊 测试结果汇总")
    print("=" * 50)
    print(f"  基础调用: {'✅ PASS' if test1_passed else '❌ FAIL'}")
    print(f"  情绪分析: {'✅ PASS' if test2_passed else '❌ FAIL'}")
    
    if test1_passed and test2_passed:
        print("\n🎉 所有测试通过！LLM API 已就绪。")
    else:
        print("\n⚠️ 部分测试失败，请检查配置。")


if __name__ == "__main__":
    asyncio.run(main())
