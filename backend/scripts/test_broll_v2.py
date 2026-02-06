#!/usr/bin/env python3
"""测试 BRollAgentV2"""
import asyncio
from app.services.broll_agent_v2 import BRollAgentV2


async def test():
    agent = BRollAgentV2()
    
    segments = [
        {"id": "seg-1", "text": "数据显示，80%的用户喜欢这个功能", "start": 0, "end": 5000},
        {"id": "seg-2", "text": "比如iPhone 15就是个很好的例子", "start": 5000, "end": 10000},
        {"id": "seg-3", "text": "这只是普通的口播内容", "start": 10000, "end": 15000},
        {"id": "seg-4", "text": "我们来看看ChatGPT怎么做", "start": 15000, "end": 20000},
    ]
    
    result = await agent.analyze(
        session_id="test-123",
        segments=segments,
        search_assets=False,  # 不搜索素材，只测试检测
    )
    
    print(f"总片段: {result.total_segments}")
    print(f"需要B-Roll: {result.broll_segments}")
    print()
    for d in result.decisions:
        status = "✅" if d.need_broll else "⚪"
        print(f"{status} {d.segment_id}: need={d.need_broll}, type={d.broll_type.value}, reason={d.reason}")
        if d.keywords_en:
            print(f"   关键词: {d.keywords_en}")


if __name__ == "__main__":
    asyncio.run(test())
