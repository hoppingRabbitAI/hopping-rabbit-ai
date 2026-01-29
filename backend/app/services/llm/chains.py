"""
LangChain Chains 模块

定义各种功能 Chain:
- 情绪分析
- 场景分析
- 脚本生成
- B-Roll 建议
- 内容分析
"""

import json
import logging
from typing import List, Dict, Any, Optional
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.runnables import RunnablePassthrough, RunnableLambda

from .clients import get_llm, get_analysis_llm, get_creative_llm
from .prompts import (
    EMOTION_ANALYSIS_PROMPT,
    SCENE_ANALYSIS_PROMPT,
    SCRIPT_GENERATION_PROMPT,
    BROLL_SUGGESTION_PROMPT,
    CONTENT_ANALYSIS_PROMPT,
)
from .parsers import (
    EmotionAnalysisResult,
    SegmentAnalysis,
    SceneAnalysis,
    VideoScript,
    BRollSuggestion,
    ContentAnalysis,
    EmotionType,
    ImportanceLevel,
)

logger = logging.getLogger(__name__)


# ============================================
# 输出解析器
# ============================================

def create_json_parser(pydantic_model):
    """创建带容错的 JSON 解析器"""
    base_parser = JsonOutputParser(pydantic_object=pydantic_model)
    
    def safe_parse(text: str) -> dict:
        """安全解析，处理 markdown 代码块等情况"""
        # 移除 markdown 代码块
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        
        text = text.strip()
        
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            logger.warning(f"JSON 解析失败: {e}, 原文: {text[:200]}...")
            # 返回空结果
            return {"results": []}
    
    return RunnableLambda(lambda x: safe_parse(x.content if hasattr(x, 'content') else str(x)))


# ============================================
# 情绪分析 Chain
# ============================================

def create_emotion_analysis_chain():
    """
    创建情绪分析 Chain
    
    输入: {"segments_text": "..."}
    输出: EmotionAnalysisResult
    """
    llm = get_analysis_llm()
    parser = create_json_parser(EmotionAnalysisResult)
    
    chain = EMOTION_ANALYSIS_PROMPT | llm | parser
    
    return chain


async def analyze_emotions(segments: List[Dict[str, Any]]) -> EmotionAnalysisResult:
    """
    分析多个片段的情绪
    
    Args:
        segments: 片段列表，每个包含 id 和 text
        
    Returns:
        EmotionAnalysisResult
    """
    if not segments:
        return EmotionAnalysisResult(results=[])
    
    # 格式化输入
    segments_text = "\n".join([
        f"[{s['id']}] {s.get('text', '')}" 
        for s in segments
        if s.get('text', '').strip()
    ])
    
    if not segments_text:
        return EmotionAnalysisResult(results=[])
    
    chain = create_emotion_analysis_chain()
    
    try:
        result = await chain.ainvoke({"segments_text": segments_text})
        
        # 转换为 Pydantic 模型
        parsed_results = []
        for r in result.get("results", []):
            try:
                parsed_results.append(SegmentAnalysis(
                    id=r.get("id", ""),
                    emotion=EmotionType(r.get("emotion", "neutral")),
                    importance=ImportanceLevel(r.get("importance", "medium")),
                    keywords=r.get("keywords", []),
                    focus_word=r.get("focus_word"),
                ))
            except Exception as e:
                logger.warning(f"解析片段结果失败: {e}, data={r}")
        
        return EmotionAnalysisResult(results=parsed_results)
        
    except Exception as e:
        logger.error(f"情绪分析失败: {e}")
        return EmotionAnalysisResult(results=[])


# ============================================
# 场景分析 Chain
# ============================================

def create_scene_analysis_chain():
    """创建场景分析 Chain"""
    llm = get_analysis_llm()
    parser = create_json_parser(SceneAnalysis)
    
    chain = SCENE_ANALYSIS_PROMPT | llm | parser
    
    return chain


async def analyze_scene(frame_descriptions: List[str]) -> SceneAnalysis:
    """
    分析视频场景
    
    Args:
        frame_descriptions: 帧描述列表
        
    Returns:
        SceneAnalysis
    """
    chain = create_scene_analysis_chain()
    
    try:
        result = await chain.ainvoke({
            "frame_descriptions": "\n".join(frame_descriptions)
        })
        return SceneAnalysis(**result)
    except Exception as e:
        logger.error(f"场景分析失败: {e}")
        return SceneAnalysis(scene_type="other")


# ============================================
# 脚本生成 Chain
# ============================================

def create_script_generation_chain():
    """创建脚本生成 Chain"""
    llm = get_creative_llm()
    parser = create_json_parser(VideoScript)
    
    chain = SCRIPT_GENERATION_PROMPT | llm | parser
    
    return chain


async def generate_script(
    topic: str,
    style: str = "professional",
    duration: int = 60,
    audience: str = "general",
    additional_requirements: str = "",
) -> VideoScript:
    """
    生成口播脚本
    
    Args:
        topic: 主题
        style: 风格 (professional/casual/humorous)
        duration: 目标时长(秒)
        audience: 目标受众
        additional_requirements: 额外要求
        
    Returns:
        VideoScript
    """
    chain = create_script_generation_chain()
    
    try:
        result = await chain.ainvoke({
            "topic": topic,
            "style": style,
            "duration": duration,
            "audience": audience,
            "additional_requirements": additional_requirements or "无",
        })
        return VideoScript(**result)
    except Exception as e:
        logger.error(f"脚本生成失败: {e}")
        raise


# ============================================
# B-Roll 建议 Chain
# ============================================

def create_broll_suggestion_chain():
    """创建 B-Roll 建议 Chain"""
    llm = get_creative_llm()
    
    def parse_broll_list(response) -> List[Dict]:
        """解析 B-Roll 列表"""
        content = response.content if hasattr(response, 'content') else str(response)
        
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        try:
            data = json.loads(content.strip())
            return data.get("suggestions", data) if isinstance(data, dict) else data
        except:
            return []
    
    chain = BROLL_SUGGESTION_PROMPT | llm | RunnableLambda(parse_broll_list)
    
    return chain


async def suggest_broll(transcript: List[Dict[str, Any]]) -> List[BRollSuggestion]:
    """
    推荐 B-Roll 素材
    
    Args:
        transcript: 字幕时间轴列表 [{"start": 0, "end": 3, "text": "..."}]
        
    Returns:
        B-Roll 建议列表
    """
    chain = create_broll_suggestion_chain()
    
    # 格式化时间轴
    transcript_text = "\n".join([
        f"[{t['start']:.1f}s - {t['end']:.1f}s] {t.get('text', '')}"
        for t in transcript
    ])
    
    try:
        results = await chain.ainvoke({"transcript": transcript_text})
        return [BRollSuggestion(**r) for r in results]
    except Exception as e:
        logger.error(f"B-Roll 建议失败: {e}")
        return []


# ============================================
# 内容分析 Chain (Rabbit Hole)
# ============================================

def create_content_analysis_chain():
    """创建内容分析 Chain"""
    llm = get_analysis_llm()
    parser = create_json_parser(ContentAnalysis)
    
    chain = CONTENT_ANALYSIS_PROMPT | llm | parser
    
    return chain


async def analyze_content(
    title: str,
    description: str = "",
    transcript_sample: str = "",
) -> ContentAnalysis:
    """
    分析内容并推荐 AI 功能
    
    用于 Rabbit Hole 推荐引擎
    
    Args:
        title: 视频标题
        description: 描述
        transcript_sample: 字幕片段
        
    Returns:
        ContentAnalysis
    """
    chain = create_content_analysis_chain()
    
    try:
        result = await chain.ainvoke({
            "title": title,
            "description": description or "无",
            "transcript_sample": transcript_sample or "无",
        })
        return ContentAnalysis(**result)
    except Exception as e:
        logger.error(f"内容分析失败: {e}")
        return ContentAnalysis(
            topics=[],
            content_type="other",
            suggested_features=[],
            optimization_tips=[],
        )


# ============================================
# Chain 注册表
# ============================================

CHAINS = {
    "emotion_analysis": create_emotion_analysis_chain,
    "scene_analysis": create_scene_analysis_chain,
    "script_generation": create_script_generation_chain,
    "broll_suggestion": create_broll_suggestion_chain,
    "content_analysis": create_content_analysis_chain,
}


def get_chain(name: str):
    """获取 Chain 实例"""
    if name not in CHAINS:
        raise ValueError(f"Unknown chain: {name}. Available: {list(CHAINS.keys())}")
    return CHAINS[name]()
