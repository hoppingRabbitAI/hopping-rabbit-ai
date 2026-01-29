"""
HoppingRabbit AI - LangChain 统一 LLM 服务模块

架构说明:
├── clients.py        # LLM 客户端适配器（豆包/Gemini/OpenAI）
├── chains.py         # Chain 定义（情绪分析、场景分析、脚本生成等）
├── parsers.py        # 输出解析器（Pydantic 模型）
├── prompts.py        # Prompt 模板管理
├── tools.py          # Agent 工具定义（可灵AI 等）
├── service.py        # 统一服务层

使用示例:
    from app.services.llm import llm_service
    
    # 情绪分析
    result = await llm_service.analyze_emotions(segments)
    
    # 脚本生成
    script = await llm_service.generate_script(topic="产品介绍")
    
    # Agent 模式（自动选择工具）
    result = await llm_service.run_agent("分析这段视频并生成运镜方案")
    
    # B-Roll 推荐
    broll = await llm_service.suggest_broll(transcript)
    
    # 内容分析 (Rabbit Hole 功能推荐)
    analysis = await llm_service.analyze_content(title="产品宣传片")
"""

from .service import LLMService, get_llm_service, llm_service
from .parsers import (
    EmotionType,
    ImportanceLevel,
    SegmentAnalysis,
    EmotionAnalysisResult,
    VideoScript,
    BRollSuggestion,
    ContentAnalysis,
)
from .clients import get_llm, DoubaoChat
from .tools import get_tools, get_tool_names

__all__ = [
    # 服务
    "LLMService",
    "get_llm_service",
    "llm_service",
    # 数据模型
    "EmotionType",
    "ImportanceLevel",
    "SegmentAnalysis",
    "EmotionAnalysisResult",
    "VideoScript",
    "BRollSuggestion",
    "ContentAnalysis",
    # 客户端
    "get_llm",
    "DoubaoChat",
    # 工具
    "get_tools",
    "get_tool_names",
]
