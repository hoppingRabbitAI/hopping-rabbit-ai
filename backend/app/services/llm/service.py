"""
LangChain Service - 统一服务层

提供:
1. 链式调用 (情绪分析、脚本生成等)
2. Agent 调用 (自主决策)
3. 对话管理 (带记忆)
"""

import logging
from typing import Optional, List, Dict, Any
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_core.runnables import RunnableWithMessageHistory
from langchain_core.chat_history import BaseChatMessageHistory, InMemoryChatMessageHistory

from app.config import get_settings

settings = get_settings()

from .clients import get_llm
from .prompts import AGENT_PROMPT
from .tools import get_tools, ALL_TOOLS
from .parsers import (
    EmotionAnalysisResult,
    SceneAnalysis,
    VideoScript,
    BRollSuggestion,
    ContentAnalysis,
    AgentDecision,
)
from . import chains

logger = logging.getLogger(__name__)


# ============================================
# 会话历史存储
# ============================================

_session_histories: Dict[str, BaseChatMessageHistory] = {}


def get_session_history(session_id: str) -> BaseChatMessageHistory:
    """
    获取会话历史
    
    使用内存存储，生产环境可替换为 Redis
    """
    if session_id not in _session_histories:
        _session_histories[session_id] = InMemoryChatMessageHistory()
    return _session_histories[session_id]


def clear_session_history(session_id: str) -> None:
    """清除会话历史"""
    if session_id in _session_histories:
        del _session_histories[session_id]


# ============================================
# LLM 服务类
# ============================================

class LLMService:
    """
    统一 LLM 服务
    
    提供:
    - 情绪分析
    - 场景分析
    - 脚本生成
    - B-Roll 推荐
    - 内容分析
    - Agent 调用
    - 对话功能
    """
    
    def __init__(
        self,
        provider: str = "doubao",
        model: Optional[str] = None,
        temperature: float = 0.7,
    ):
        """
        初始化 LLM 服务
        
        Args:
            provider: LLM 提供商 (doubao/gemini/openai/azure/ollama)
            model: 模型名称，None 使用默认
            temperature: 创造性参数
        """
        self.provider = provider
        self.model = model
        self.temperature = temperature
        self._llm = None
        self._agent = None
        
    @property
    def llm(self):
        """延迟初始化 LLM"""
        if self._llm is None:
            self._llm = get_llm(
                provider=self.provider,
                model=self.model,
                temperature=self.temperature,
            )
        return self._llm
    
    # ============================================
    # 链式调用方法
    # ============================================
    
    async def analyze_emotions(
        self,
        segments: List[Dict[str, str]],
    ) -> EmotionAnalysisResult:
        """
        分析片段情绪
        
        Args:
            segments: 片段列表，每个包含 id 和 text
            
        Returns:
            EmotionAnalysisResult 情绪分析结果
        """
        logger.info(f"[LLMService] 情绪分析: {len(segments)} 个片段")
        return await chains.analyze_emotions(segments)
    
    async def analyze_scene(
        self,
        video_description: str,
        transcript: str,
    ) -> SceneAnalysis:
        """
        分析场景内容
        
        Args:
            video_description: 视频描述
            transcript: 字幕文本
            
        Returns:
            SceneAnalysis 场景分析结果
        """
        logger.info(f"[LLMService] 场景分析")
        return await chains.analyze_scene(video_description, transcript)
    
    async def generate_script(
        self,
        topic: str,
        style: str = "professional",
        duration: int = 60,
    ) -> VideoScript:
        """
        生成口播脚本
        
        Args:
            topic: 主题
            style: 风格
            duration: 目标时长
            
        Returns:
            VideoScript 生成的脚本
        """
        logger.info(f"[LLMService] 脚本生成: topic={topic}, style={style}")
        return await chains.generate_script(topic, style, duration)
    
    async def suggest_broll(
        self,
        transcript: List[Dict[str, Any]],
    ) -> List[BRollSuggestion]:
        """
        推荐 B-Roll 素材
        
        Args:
            transcript: 字幕时间轴
            
        Returns:
            List[BRollSuggestion] B-Roll 推荐列表
        """
        logger.info(f"[LLMService] B-Roll 推荐")
        return await chains.suggest_broll(transcript)
    
    async def analyze_content(
        self,
        title: str,
        description: str = "",
        transcript_sample: str = "",
    ) -> ContentAnalysis:
        """
        分析内容并推荐 AI 功能
        
        Args:
            title: 视频标题
            description: 视频描述
            transcript_sample: 字幕样本
            
        Returns:
            ContentAnalysis 内容分析和功能推荐
        """
        logger.info(f"[LLMService] 内容分析: title={title}")
        return await chains.analyze_content(title, description, transcript_sample)
    
    # ============================================
    # Agent 调用
    # ============================================
    
    def _get_agent(self, tools: Optional[list] = None):
        """
        获取 Agent
        
        Args:
            tools: 工具列表，None 使用所有工具
            
        Returns:
            AgentExecutor
        """
        # 延迟导入，避免启动时报错
        from langgraph.prebuilt import create_react_agent
        
        if tools is None:
            tools = ALL_TOOLS
            
        # 使用 LangGraph 的 ReAct Agent
        return create_react_agent(
            model=self.llm,
            tools=tools,
        )
    
    async def run_agent(
        self,
        user_input: str,
        context: Optional[Dict[str, Any]] = None,
        tools: Optional[list] = None,
    ) -> Dict[str, Any]:
        """
        运行 Agent
        
        Agent 可以自主决策使用哪个工具
        
        Args:
            user_input: 用户输入
            context: 上下文信息
            tools: 可用工具列表
            
        Returns:
            Agent 执行结果
        """
        logger.info(f"[LLMService] Agent 调用: {user_input[:50]}...")
        
        agent = self._get_agent(tools)
        
        # LangGraph ReAct Agent 使用 messages 格式
        result = await agent.ainvoke({
            "messages": [HumanMessage(content=user_input)],
        })
        
        # 提取最后的 AI 消息作为输出
        messages = result.get("messages", [])
        output = messages[-1].content if messages else ""
        
        return {
            "output": output,
            "messages": messages,
        }
    
    # ============================================
    # 对话功能
    # ============================================
    
    async def chat(
        self,
        message: str,
        session_id: str,
        system_prompt: Optional[str] = None,
    ) -> str:
        """
        对话功能
        
        带历史记忆的多轮对话
        
        Args:
            message: 用户消息
            session_id: 会话 ID
            system_prompt: 系统提示
            
        Returns:
            AI 回复
        """
        logger.info(f"[LLMService] 对话: session={session_id}")
        
        messages = []
        
        if system_prompt:
            messages.append(SystemMessage(content=system_prompt))
        
        # 获取历史
        history = get_session_history(session_id)
        messages.extend(history.messages)
        
        # 添加用户消息
        messages.append(HumanMessage(content=message))
        
        # 调用 LLM
        response = await self.llm.ainvoke(messages)
        
        # 保存历史
        history.add_message(HumanMessage(content=message))
        history.add_message(response)
        
        return response.content
    
    def clear_chat_history(self, session_id: str) -> None:
        """清除对话历史"""
        clear_session_history(session_id)
    
    # ============================================
    # 图像 Prompt 增强
    # ============================================
    
    async def enhance_image_prompt(
        self,
        user_prompt: str,
        is_image_to_image: bool = False,
    ) -> str:
        """
        增强用户的图像生成 prompt
        
        Args:
            user_prompt: 用户输入的原始 prompt
            is_image_to_image: 是否是图生图模式
            
        Returns:
            增强后的 prompt，如果失败则返回原始 prompt
        """
        from .prompts import IMAGE_PROMPT_ENHANCEMENT_PROMPT
        
        context = ""
        if is_image_to_image:
            context = "（注意：用户上传了参考图片，这是图生图模式，请确保 prompt 中强调保留原图的人物/主体特征）\n\n"
        
        try:
            chain = IMAGE_PROMPT_ENHANCEMENT_PROMPT | self.llm
            result = await chain.ainvoke({
                "context": context,
                "user_prompt": user_prompt,
            })
            
            enhanced = result.content.strip()
            if enhanced:
                logger.info(f"[LLMService] Prompt 增强: {user_prompt[:30]}... -> {enhanced[:50]}...")
                return enhanced
            return user_prompt
            
        except Exception as e:
            logger.warning(f"[LLMService] Prompt 增强失败: {e}")
            return user_prompt
    
    # ============================================
    # 快捷方法
    # ============================================
    
    async def call(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
    ) -> str:
        """
        简单调用 LLM
        
        Args:
            prompt: 用户提示
            system_prompt: 系统提示
            temperature: 温度参数
            
        Returns:
            LLM 回复文本
        """
        messages = []
        
        if system_prompt:
            messages.append(SystemMessage(content=system_prompt))
        
        messages.append(HumanMessage(content=prompt))
        
        llm = self.llm
        if temperature is not None and temperature != self.temperature:
            llm = get_llm(
                provider=self.provider,
                model=self.model,
                temperature=temperature,
            )
        
        response = await llm.ainvoke(messages)
        return response.content
    
    def is_configured(self) -> bool:
        """检查 LLM 是否已配置"""
        if settings.volcengine_ark_api_key and settings.doubao_model_endpoint != "ep-xxxxxxxx":
            return True
        if settings.gemini_api_key:
            return True
        if hasattr(settings, 'openai_api_key') and settings.openai_api_key:
            return True
        return False


# ============================================
# 默认实例
# ============================================

# 单例模式
_llm_service: Optional[LLMService] = None


def get_llm_service() -> LLMService:
    """获取 LLM 服务单例"""
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service


# 模块级别导出
llm_service = get_llm_service()
