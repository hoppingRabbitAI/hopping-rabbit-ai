"""
LangChain LLM 客户端适配器

支持多种 LLM Provider:
- 豆包 (Doubao / 火山方舟)
- Google Gemini
- OpenAI / Azure OpenAI
- 本地模型 (Ollama)
"""

import os
import logging
import httpx
from typing import Optional, List, Any, Iterator
from abc import ABC

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult, ChatGenerationChunk
from langchain_core.callbacks import CallbackManagerForLLMRun

logger = logging.getLogger(__name__)


# ============================================
# 豆包 LLM 适配器 (火山方舟 API)
# ============================================

class DoubaoChat(BaseChatModel):
    """
    豆包大模型的 LangChain 适配器
    
    使用火山方舟 API: https://www.volcengine.com/docs/82379/1263482
    """
    
    model_endpoint: str
    api_key: str
    api_base: str = "https://ark.cn-beijing.volces.com/api/v3"
    temperature: float = 0.3
    max_tokens: int = 2000
    timeout: float = 60.0
    
    class Config:
        arbitrary_types_allowed = True
    
    @property
    def _llm_type(self) -> str:
        return "doubao"
    
    @property
    def _identifying_params(self) -> dict:
        return {
            "model_endpoint": self.model_endpoint,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
    
    def _convert_messages(self, messages: List[BaseMessage]) -> List[dict]:
        """转换 LangChain 消息格式为 API 格式"""
        result = []
        for msg in messages:
            if isinstance(msg, SystemMessage):
                result.append({"role": "system", "content": msg.content})
            elif isinstance(msg, HumanMessage):
                result.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                result.append({"role": "assistant", "content": msg.content})
            else:
                # 其他类型作为 user
                result.append({"role": "user", "content": str(msg.content)})
        return result
    
    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        """同步生成"""
        ark_messages = self._convert_messages(messages)
        
        payload = {
            "model": self.model_endpoint,
            "messages": ark_messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if stop:
            payload["stop"] = stop
        
        try:
            response = httpx.post(
                f"{self.api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()
            
            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            
            message = AIMessage(
                content=content,
                additional_kwargs={
                    "usage": usage,
                    "model": data.get("model"),
                }
            )
            
            generation = ChatGeneration(message=message)
            return ChatResult(generations=[generation])
            
        except httpx.HTTPStatusError as e:
            logger.error(f"[Doubao] API 错误: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"[Doubao] 请求异常: {e}")
            raise
    
    async def _agenerate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        """异步生成"""
        ark_messages = self._convert_messages(messages)
        
        payload = {
            "model": self.model_endpoint,
            "messages": ark_messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if stop:
            payload["stop"] = stop
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(
                    f"{self.api_base}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
                
                content = data["choices"][0]["message"]["content"]
                usage = data.get("usage", {})
                
                message = AIMessage(
                    content=content,
                    additional_kwargs={
                        "usage": usage,
                        "model": data.get("model"),
                    }
                )
                
                generation = ChatGeneration(message=message)
                return ChatResult(generations=[generation])
                
            except httpx.HTTPStatusError as e:
                logger.error(f"[Doubao] API 错误: {e.response.status_code} - {e.response.text}")
                raise
            except Exception as e:
                logger.error(f"[Doubao] 请求异常: {e}")
                raise


# ============================================
# LLM 工厂函数
# ============================================

def get_llm(
    provider: Optional[str] = None,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 2000,
) -> BaseChatModel:
    """
    获取 LLM 实例
    
    Args:
        provider: LLM 提供商 (doubao/gemini/openai/azure)，默认从配置读取
        model: 模型名称，默认从配置读取
        temperature: 生成温度
        max_tokens: 最大 token 数
    
    Returns:
        LangChain BaseChatModel 实例
    """
    from app.config import get_settings
    settings = get_settings()
    
    provider = provider or settings.llm_provider
    
    if provider == "doubao":
        return DoubaoChat(
            model_endpoint=model or settings.doubao_model_endpoint,
            api_key=settings.volcengine_ark_api_key,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    
    elif provider == "gemini":
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model=model or settings.gemini_model,
                google_api_key=settings.gemini_api_key,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except ImportError:
            raise ImportError("请安装 langchain-google-genai: pip install langchain-google-genai")
    
    elif provider == "openai":
        try:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model=model or "gpt-4o-mini",
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except ImportError:
            raise ImportError("请安装 langchain-openai: pip install langchain-openai")
    
    elif provider == "azure":
        try:
            from langchain_openai import AzureChatOpenAI
            return AzureChatOpenAI(
                deployment_name=model or os.getenv("AZURE_OPENAI_DEPLOYMENT"),
                azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                api_key=os.getenv("AZURE_OPENAI_API_KEY"),
                api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except ImportError:
            raise ImportError("请安装 langchain-openai: pip install langchain-openai")
    
    elif provider == "ollama":
        try:
            from langchain_community.llms import Ollama
            return Ollama(
                model=model or "llama3",
                temperature=temperature,
            )
        except ImportError:
            raise ImportError("请安装 langchain-community: pip install langchain-community")
    
    else:
        raise ValueError(f"不支持的 LLM provider: {provider}")


# ============================================
# 快捷获取函数
# ============================================

def get_fast_llm() -> BaseChatModel:
    """获取快速响应的 LLM（用于简单任务）"""
    return get_llm(temperature=0.1, max_tokens=500)


def get_creative_llm() -> BaseChatModel:
    """获取创意 LLM（用于脚本生成等）"""
    return get_llm(temperature=0.7, max_tokens=4000)


def get_analysis_llm() -> BaseChatModel:
    """获取分析 LLM（用于情绪分析等）"""
    return get_llm(temperature=0.2, max_tokens=2000)
