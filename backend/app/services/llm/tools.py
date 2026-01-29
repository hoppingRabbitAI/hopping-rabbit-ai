"""
LangChain Tools - Agent 可调用的工具

定义可灵 AI 和其他服务的工具封装
供 Agent 动态调用
"""

import logging
from typing import Optional, List, Dict, Any
from langchain_core.tools import tool, StructuredTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ============================================
# 工具输入模型
# ============================================

class EmotionAnalysisInput(BaseModel):
    """情绪分析输入"""
    segments: List[Dict[str, str]] = Field(description="片段列表，每个包含 id 和 text")


class ScriptGenerationInput(BaseModel):
    """脚本生成输入"""
    topic: str = Field(description="脚本主题")
    style: str = Field(default="professional", description="风格: professional/casual/humorous")
    duration: int = Field(default=60, description="目标时长(秒)")


class LipSyncInput(BaseModel):
    """口型同步输入"""
    video_url: str = Field(description="原视频 URL")
    audio_url: str = Field(description="目标音频 URL")


class TextToVideoInput(BaseModel):
    """文生视频输入"""
    prompt: str = Field(description="视频描述")
    duration: str = Field(default="5", description="时长: 5/10")
    aspect_ratio: str = Field(default="16:9", description="宽高比")


class ImageToVideoInput(BaseModel):
    """图生视频输入"""
    image_url: str = Field(description="图片 URL")
    prompt: str = Field(default="", description="运动描述")
    duration: str = Field(default="5", description="时长")


class FaceSwapInput(BaseModel):
    """换脸输入"""
    video_url: str = Field(description="源视频 URL")
    face_image_url: str = Field(description="目标人脸图片 URL")


# ============================================
# 分析类工具
# ============================================

@tool
async def analyze_emotions_tool(segments: List[Dict[str, str]]) -> Dict[str, Any]:
    """
    分析视频片段的情绪和重要性。
    
    输入片段列表，返回每个片段的情绪(excited/serious/happy/sad/neutral)
    和重要性(high/medium/low)分析。
    
    适用场景：一键成片、运镜决策、字幕样式
    """
    from .chains import analyze_emotions
    
    result = await analyze_emotions(segments)
    return {"results": [r.model_dump() for r in result.results]}


@tool
async def generate_script_tool(
    topic: str,
    style: str = "professional",
    duration: int = 60,
) -> Dict[str, Any]:
    """
    生成口播视频脚本。
    
    根据主题、风格和目标时长生成完整的口播脚本，
    包含多个片段，每个片段有台词、情绪提示和画面建议。
    
    适用场景：内容创作、口播视频制作
    """
    from .chains import generate_script
    
    result = await generate_script(topic=topic, style=style, duration=duration)
    return result.model_dump()


@tool
async def suggest_broll_tool(transcript: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    为口播视频推荐 B-Roll 素材。
    
    根据字幕时间轴推荐适合插入的 B-Roll 片段，
    包括插入时间点、内容描述和搜索关键词。
    
    适用场景：视频丰富、专业感提升
    """
    from .chains import suggest_broll
    
    result = await suggest_broll(transcript)
    return [r.model_dump() for r in result]


@tool
async def analyze_content_tool(
    title: str,
    description: str = "",
    transcript_sample: str = "",
) -> Dict[str, Any]:
    """
    分析视频内容并推荐 AI 功能。
    
    分析视频的主题、受众、类型，并推荐适合使用的 AI 功能
    如口型同步、换脸、文生视频等。
    
    适用场景：Rabbit Hole 功能推荐
    """
    from .chains import analyze_content
    
    result = await analyze_content(
        title=title,
        description=description,
        transcript_sample=transcript_sample,
    )
    return result.model_dump()


# ============================================
# 可灵 AI 工具
# ============================================

@tool
async def lip_sync_tool(video_url: str, audio_url: str) -> Dict[str, Any]:
    """
    口型同步 - 让视频中的人物口型匹配新音频。
    
    输入原视频和目标音频，生成口型同步的新视频。
    适用于配音替换、多语言版本制作。
    
    注意：这是异步任务，返回 task_id 用于查询进度。
    """
    # 延迟导入避免循环依赖
    from app.tasks.lip_sync import process_lip_sync
    
    logger.info(f"[Tool] 调用口型同步: video={video_url[:50]}...")
    
    # 这里应该创建任务，返回 task_id
    # 实际调用需要 user_id，这里返回占位信息
    return {
        "status": "tool_invoked",
        "action": "lip_sync",
        "params": {
            "video_url": video_url,
            "audio_url": audio_url,
        },
        "message": "请通过 API 调用创建口型同步任务",
    }


@tool
async def text_to_video_tool(
    prompt: str,
    duration: str = "5",
    aspect_ratio: str = "16:9",
) -> Dict[str, Any]:
    """
    文生视频 - 根据文字描述生成视频。
    
    输入详细的场景描述，生成对应的视频片段。
    适用于生成 B-Roll 素材、背景视频、创意内容。
    
    注意：这是异步任务，返回 task_id 用于查询进度。
    """
    logger.info(f"[Tool] 调用文生视频: prompt={prompt[:50]}...")
    
    return {
        "status": "tool_invoked",
        "action": "text_to_video",
        "params": {
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
        },
        "message": "请通过 API 调用创建文生视频任务",
    }


@tool
async def image_to_video_tool(
    image_url: str,
    prompt: str = "",
    duration: str = "5",
) -> Dict[str, Any]:
    """
    图生视频 - 将静态图片转换为动态视频。
    
    输入产品图或场景图，生成动态展示视频。
    适用于产品动态化、场景动画。
    
    注意：这是异步任务，返回 task_id 用于查询进度。
    """
    logger.info(f"[Tool] 调用图生视频: image={image_url[:50]}...")
    
    return {
        "status": "tool_invoked",
        "action": "image_to_video",
        "params": {
            "image_url": image_url,
            "prompt": prompt,
            "duration": duration,
        },
        "message": "请通过 API 调用创建图生视频任务",
    }


@tool
async def face_swap_tool(video_url: str, face_image_url: str) -> Dict[str, Any]:
    """
    AI换脸 - 将视频中的人脸替换为另一个人脸。
    
    输入源视频和目标人脸图片，生成换脸后的视频。
    适用于数字人生成、隐私保护。
    
    注意：这是异步任务，返回 task_id 用于查询进度。
    """
    logger.info(f"[Tool] 调用换脸: video={video_url[:50]}...")
    
    return {
        "status": "tool_invoked",
        "action": "face_swap",
        "params": {
            "video_url": video_url,
            "face_image_url": face_image_url,
        },
        "message": "请通过 API 调用创建换脸任务",
    }


# ============================================
# 工具注册表
# ============================================

# 分析类工具（直接返回结果）
ANALYSIS_TOOLS = [
    analyze_emotions_tool,
    generate_script_tool,
    suggest_broll_tool,
    analyze_content_tool,
]

# 生成类工具（返回任务 ID）
GENERATION_TOOLS = [
    lip_sync_tool,
    text_to_video_tool,
    image_to_video_tool,
    face_swap_tool,
]

# 所有工具
ALL_TOOLS = ANALYSIS_TOOLS + GENERATION_TOOLS


def get_tools(category: str = "all") -> list:
    """
    获取工具列表
    
    Args:
        category: "all" | "analysis" | "generation"
        
    Returns:
        工具列表
    """
    if category == "analysis":
        return ANALYSIS_TOOLS
    elif category == "generation":
        return GENERATION_TOOLS
    else:
        return ALL_TOOLS


def get_tool_names() -> List[str]:
    """获取所有工具名称"""
    return [t.name for t in ALL_TOOLS]
