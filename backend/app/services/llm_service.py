"""
LLM 服务 - 支持豆包大模型 & Google Gemini
用于文本情绪分析与剪辑决策

豆包 API 文档: https://www.volcengine.com/docs/82379/1263482
Gemini API 文档: https://ai.google.dev/gemini-api/docs
"""

import os
import json
import logging
import httpx
from typing import Dict, List, Optional
from app.config import get_settings

logger = logging.getLogger(__name__)

# ============================================
# 配置常量
# ============================================

# LLM 参数
LLM_DEFAULT_MAX_TOKENS = 2000
LLM_DEFAULT_TEMPERATURE = 0.3  # 低温度，输出更稳定
LLM_REQUEST_TIMEOUT_SECONDS = 60.0

# 日志预览长度
LOG_PROMPT_PREVIEW_LENGTH = 200
LOG_RESPONSE_ERROR_LENGTH = 500

# ============================================
# 配置 (从环境变量读取)
# ============================================

settings = get_settings()

# LLM Provider
LLM_PROVIDER = settings.llm_provider  # "doubao" 或 "gemini"

# 火山方舟 API (豆包)
ARK_API_BASE = "https://ark.cn-beijing.volces.com/api/v3"
ARK_API_KEY = settings.volcengine_ark_api_key
DOUBAO_MODEL_ENDPOINT = settings.doubao_model_endpoint

# Google Gemini API
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_API_KEY = settings.gemini_api_key
GEMINI_MODEL = settings.gemini_model


# ============================================
# 情绪分析 Prompt
# ============================================

EMOTION_ANALYSIS_PROMPT = """你是一个专业的视频剪辑助手。分析以下视频台词片段，判断其情绪和重要性。

台词列表:
{segments_text}

请为每个片段输出 JSON 格式的分析结果，格式如下:
```json
{{
  "results": [
    {{
      "id": "片段ID",
      "emotion": "neutral/excited/serious/happy/sad",
      "importance": "low/medium/high",
      "keywords": ["关键词1", "关键词2"],
      "focus_word": "突出的关键词(可选)"
    }}
  ]
}}
```

判断规则:
- emotion (情绪): 
  - excited: 激动、兴奋、强调重点
  - serious: 严肃、认真、讲道理
  - happy: 轻松、愉快、玩笑
  - sad: 悲伤、遗憾、惋惜
  - neutral: 平淡叙述
- importance (重要性):
  - high: 核心观点、总结性语句、含"重要/关键/必须"等词
  - medium: 普通内容
  - low: 过渡句、口头禅、无意义的语气词
- focus_word (焦点词):
  - 只有在语气突然转折或强烈强调时才填写
  - 例如: "但是", "不过", "然而", "必须", "绝对", "哇"
  - 必须是原文中存在的词

只输出 JSON，不要其他解释。
"""


# ============================================
# API 调用
# ============================================

async def call_llm(
    prompt: str,
    system_prompt: str = "你是一个专业的视频剪辑助手。",
    max_tokens: int = LLM_DEFAULT_MAX_TOKENS
) -> Optional[str]:
    """
    统一 LLM 调用入口，根据配置自动选择 provider
    """
    if LLM_PROVIDER == "gemini" and GEMINI_API_KEY:
        return await call_gemini_llm(prompt, system_prompt, max_tokens)
    else:
        return await call_doubao_llm(prompt, system_prompt, max_tokens)


async def call_gemini_llm(
    prompt: str,
    system_prompt: str = "你是一个专业的视频剪辑助手。",
    max_tokens: int = LLM_DEFAULT_MAX_TOKENS
) -> Optional[str]:
    """
    调用 Google Gemini API
    
    Args:
        prompt: 用户输入
        system_prompt: 系统提示
        max_tokens: 最大输出 token 数
    
    Returns:
        模型输出文本，失败返回 None
    """
    if not GEMINI_API_KEY:
        logger.warning("      ⚠️ GEMINI_API_KEY 未配置")
        return None
    
    # Gemini API 格式
    url = f"{GEMINI_API_BASE}/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    
    headers = {
        "Content-Type": "application/json"
    }
    
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": f"{system_prompt}\n\n{prompt}"}]
            }
        ],
        "generationConfig": {
            "temperature": LLM_DEFAULT_TEMPERATURE,
            "maxOutputTokens": max_tokens,
        }
    }
    
    # 打印 LLM 调用信息
    prompt_preview = prompt[:LOG_PROMPT_PREVIEW_LENGTH] + '...' if len(prompt) > LOG_PROMPT_PREVIEW_LENGTH else prompt
    logger.info(f"      🤖 [LLM] 调用 Gemini 模型")
    logger.info(f"         模型: {GEMINI_MODEL}")
    logger.info(f"         输入长度: {len(prompt)} 字符")
    logger.debug(f"         Prompt 预览: {prompt_preview}")
    
    try:
        async with httpx.AsyncClient(timeout=LLM_REQUEST_TIMEOUT_SECONDS) as client:
            logger.info(f"         → 发送请求到 Gemini API ...")
            
            response = await client.post(url, headers=headers, json=body)
            
            if response.status_code != 200:
                logger.error(f"         ❌ Gemini API 错误: {response.status_code}")
                logger.error(f"         响应: {response.text[:LOG_RESPONSE_ERROR_LENGTH]}")
                return None
            
            result = response.json()
            
            # 解析 Gemini 响应格式
            candidates = result.get("candidates", [])
            if not candidates:
                logger.error("         ❌ Gemini 无响应内容")
                return None
            
            content = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            
            # 打印 token 使用情况
            usage = result.get("usageMetadata", {})
            logger.info(f"         ✓ 响应成功!")
            logger.info(f"         Token 使用: prompt={usage.get('promptTokenCount', '?')}, completion={usage.get('candidatesTokenCount', '?')}, total={usage.get('totalTokenCount', '?')}")
            logger.info(f"         输出长度: {len(content)} 字符")
            
            return content
            
    except Exception as e:
        logger.error(f"         ❌ Gemini API 调用失败: {e}")
        return None


async def call_doubao_llm(
    prompt: str,
    system_prompt: str = "你是一个专业的视频剪辑助手。",
    max_tokens: int = LLM_DEFAULT_MAX_TOKENS
) -> Optional[str]:
    """
    调用豆包大模型 API
    
    Args:
        prompt: 用户输入
        system_prompt: 系统提示
        max_tokens: 最大输出 token 数
    
    Returns:
        模型输出文本，失败返回 None
    """
    if not ARK_API_KEY:
        logger.warning("      ⚠️ VOLCENGINE_ARK_API_KEY 未配置")
        return None
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {ARK_API_KEY}"
    }
    
    body = {
        "model": DOUBAO_MODEL_ENDPOINT,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": max_tokens,
        "temperature": LLM_DEFAULT_TEMPERATURE
    }
    
    # 打印 LLM 调用信息
    prompt_preview = prompt[:LOG_PROMPT_PREVIEW_LENGTH] + '...' if len(prompt) > LOG_PROMPT_PREVIEW_LENGTH else prompt
    logger.info(f"      🤖 [LLM] 调用豆包模型")
    logger.info(f"         模型: {DOUBAO_MODEL_ENDPOINT}")
    logger.info(f"         输入长度: {len(prompt)} 字符")
    logger.debug(f"         Prompt 预览: {prompt_preview}")
    
    try:
        async with httpx.AsyncClient(timeout=LLM_REQUEST_TIMEOUT_SECONDS) as client:
            logger.info(f"         → 发送请求到 {ARK_API_BASE}/chat/completions ...")
            
            response = await client.post(
                f"{ARK_API_BASE}/chat/completions",
                headers=headers,
                json=body
            )
            
            if response.status_code != 200:
                logger.error(f"         ❌ LLM API 错误: {response.status_code}")
                logger.error(f"         响应: {response.text[:LOG_RESPONSE_ERROR_LENGTH]}")
                return None
            
            result = response.json()
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            # 打印 token 使用情况
            usage = result.get("usage", {})
            logger.info(f"         ✓ 响应成功!")
            logger.info(f"         Token 使用: prompt={usage.get('prompt_tokens', '?')}, completion={usage.get('completion_tokens', '?')}, total={usage.get('total_tokens', '?')}")
            logger.info(f"         输出长度: {len(content)} 字符")
            
            return content
            
    except Exception as e:
        logger.error(f"         ❌ LLM API 调用失败: {e}")
        return None


async def analyze_segments_batch(
    segments: List[Dict],
    batch_size: int = 20
) -> Dict[str, Dict]:
    """
    批量分析片段的情绪和重要性
    
    Args:
        segments: [{"id": "xxx", "text": "台词内容"}, ...]
        batch_size: 每批处理的片段数
    
    Returns:
        {segment_id: {"emotion": "...", "importance": "...", "keywords": [...]}}
    """
    if not ARK_API_KEY:
        logger.warning("      ⚠️ LLM API Key 未配置，返回空结果")
        return {}
    
    results = {}
    total_batches = (len(segments) + batch_size - 1) // batch_size
    
    logger.info(f"      📦 批量分析: {len(segments)} 个片段，分 {total_batches} 批处理 (每批 {batch_size} 个)")
    
    # 分批处理
    for batch_idx, i in enumerate(range(0, len(segments), batch_size)):
        batch = segments[i:i + batch_size]
        
        logger.info(f"      → 处理第 {batch_idx + 1}/{total_batches} 批 ({len(batch)} 个片段)...")
        
        # 构建输入文本
        segments_text = "\n".join([
            f"[{seg['id']}] {seg['text']}" 
            for seg in batch
        ])
        
        prompt = EMOTION_ANALYSIS_PROMPT.format(segments_text=segments_text)
        
        response = await call_llm(prompt)
        
        if response:
            try:
                # 提取 JSON
                json_str = response
                if "```json" in response:
                    json_str = response.split("```json")[1].split("```")[0]
                elif "```" in response:
                    json_str = response.split("```")[1].split("```")[0]
                
                data = json.loads(json_str.strip())
                
                batch_results = 0
                for item in data.get("results", []):
                    seg_id = item.get("id", "")
                    if seg_id:
                        results[seg_id] = {
                            "emotion": item.get("emotion", "neutral"),
                            "importance": item.get("importance", "medium"),
                            "keywords": item.get("keywords", [])
                        }
                        batch_results += 1
                
                logger.info(f"         ✓ 第 {batch_idx + 1} 批解析成功: {batch_results} 条结果")
                        
            except json.JSONDecodeError as e:
                logger.error(f"         ❌ JSON 解析失败: {e}")
                logger.error(f"         原始响应: {response[:500]}...")
        else:
            logger.warning(f"         ⚠️ 第 {batch_idx + 1} 批 LLM 无响应")
    
    logger.info(f"      ✅ 批量分析完成: 共 {len(results)} 条结果")
    
    return results


# ============================================
# 辅助函数
# ============================================

def is_llm_configured() -> bool:
    """检查 LLM API 是否已配置"""
    if LLM_PROVIDER == "gemini":
        return bool(GEMINI_API_KEY)
    else:
        return bool(ARK_API_KEY and DOUBAO_MODEL_ENDPOINT != "ep-xxxxxxxx")


def get_current_llm_provider() -> str:
    """获取当前使用的 LLM provider"""
    if LLM_PROVIDER == "gemini" and GEMINI_API_KEY:
        return f"gemini ({GEMINI_MODEL})"
    else:
        return f"doubao ({DOUBAO_MODEL_ENDPOINT})"


# ============================================
# 图像 Prompt 增强
# ============================================

IMAGE_PROMPT_ENHANCEMENT_SYSTEM = """你是一个专业的 AI 图像生成提示词专家。
用户会给你一个简短的描述，你需要将其扩展为更详细、更适合 AI 图像生成的 prompt。

重要规则：
1. 如果用户提到"换背景"、"改背景"等，要强调"保持人物不变，只改变背景"
2. 添加画质描述词：如 high quality, detailed, professional photography
3. 保持用户原意，不要改变主题
4. 输出应该是英文（AI 图像模型更擅长英文）
5. 如果用户已经写了很详细的 prompt，只需微调润色
6. 长度控制在 50-150 词

只输出增强后的 prompt，不要其他解释。"""


async def enhance_image_prompt(
    user_prompt: str,
    is_image_to_image: bool = False
) -> str:
    """
    增强用户的图像生成 prompt
    
    Args:
        user_prompt: 用户输入的原始 prompt
        is_image_to_image: 是否是图生图模式
    
    Returns:
        增强后的 prompt，如果 LLM 失败则返回原始 prompt
    """
    if not is_llm_configured():
        logger.info("[PromptEnhance] LLM 未配置，跳过增强")
        return user_prompt
    
    # 构建请求
    context = ""
    if is_image_to_image:
        context = "（注意：用户上传了参考图片，这是图生图模式，请确保 prompt 中强调保留原图的人物/主体特征）\n\n"
    
    prompt = f"{context}用户输入：{user_prompt}"
    
    try:
        enhanced = await call_llm(
            prompt=prompt,
            system_prompt=IMAGE_PROMPT_ENHANCEMENT_SYSTEM,
            max_tokens=300
        )
        
        if enhanced and len(enhanced.strip()) > 0:
            logger.info(f"[PromptEnhance] 原始: {user_prompt[:50]}... -> 增强: {enhanced[:50]}...")
            return enhanced.strip()
        else:
            return user_prompt
            
    except Exception as e:
        logger.warning(f"[PromptEnhance] 增强失败: {e}")
        return user_prompt
