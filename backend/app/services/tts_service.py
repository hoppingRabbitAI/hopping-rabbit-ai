"""
Lepus AI - TTS 语音合成服务
支持 Fish Audio API 实现文本转语音和声音克隆

功能:
1. 文本转语音 (TTS) - 使用预设音色
2. 声音克隆 - 上传音频样本克隆声音
3. 音色列表 - 获取可用预设音色
"""
import os
import httpx
import logging
import tempfile
from typing import Optional, Dict, List, Any
from datetime import datetime

logger = logging.getLogger(__name__)

# ============================================
# 配置
# ============================================

FISH_AUDIO_API_KEY = os.getenv("FISH_AUDIO_API_KEY", "")
FISH_AUDIO_BASE_URL = "https://api.fish.audio"

# 预设音色配置 (Fish Audio 公开模型)
# 实际使用时需要替换为真实的 model_id
PRESET_VOICES = [
    {
        "id": "zh_female_gentle",
        "name": "温柔女声",
        "description": "温柔亲切的女性声音，适合讲解、教程",
        "language": "zh",
        "gender": "female",
        "style": "gentle",
        "sample_url": None,  # 可添加试听 URL
        "model_id": "7f92f8afb8ec43bf81429cc1c9199cb1",  # Fish Audio 模型 ID
    },
    {
        "id": "zh_female_energetic",
        "name": "活力女声",
        "description": "充满活力的女性声音，适合带货、宣传",
        "language": "zh",
        "gender": "female",
        "style": "energetic",
        "sample_url": None,
        "model_id": "54a5170264694bfc8e9ad98df7bd89c3",
    },
    {
        "id": "zh_male_steady",
        "name": "沉稳男声",
        "description": "沉稳有磁性的男性声音，适合新闻、纪录片",
        "language": "zh",
        "gender": "male",
        "style": "steady",
        "sample_url": None,
        "model_id": "e58b0d7efca34eb38d5c4985e378abcb",
    },
    {
        "id": "zh_male_young",
        "name": "青年男声",
        "description": "年轻活泼的男性声音，适合短视频、直播",
        "language": "zh",
        "gender": "male",
        "style": "young",
        "sample_url": None,
        "model_id": "bf04b5f7a0a14a85b0b424f5a74c7f95",
    },
    {
        "id": "en_female_professional",
        "name": "英语女声",
        "description": "Professional English female voice",
        "language": "en",
        "gender": "female",
        "style": "professional",
        "sample_url": None,
        "model_id": "8051a5e56c934a55b37fc8c89e91aea6",
    },
    {
        "id": "en_male_narrator",
        "name": "英语男声",
        "description": "Deep English male narrator voice",
        "language": "en",
        "gender": "male",
        "style": "narrator",
        "sample_url": None,
        "model_id": "3c8f4a68e2b34f5c9a1d7e6f8b9c0a1d",
    },
]


# ============================================
# TTS 服务类
# ============================================

class TTSService:
    """文本转语音服务"""
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or FISH_AUDIO_API_KEY
        self.base_url = FISH_AUDIO_BASE_URL
    
    def _get_headers(self) -> Dict[str, str]:
        """获取请求头"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
    
    # ========================================
    # 音色管理
    # ========================================
    
    def get_preset_voices(self, language: str = None, gender: str = None) -> List[Dict]:
        """
        获取预设音色列表
        
        Args:
            language: 语言过滤 ('zh', 'en')
            gender: 性别过滤 ('male', 'female')
        
        Returns:
            音色列表
        """
        voices = PRESET_VOICES.copy()
        
        if language:
            voices = [v for v in voices if v["language"] == language]
        
        if gender:
            voices = [v for v in voices if v["gender"] == gender]
        
        return voices
    
    def get_voice_by_id(self, voice_id: str) -> Optional[Dict]:
        """根据 ID 获取音色信息"""
        for voice in PRESET_VOICES:
            if voice["id"] == voice_id:
                return voice
        return None
    
    # ========================================
    # 文本转语音
    # ========================================
    
    async def text_to_speech(
        self,
        text: str,
        voice_id: str = None,
        model_id: str = None,
        speed: float = 1.0,
        pitch: float = 0.0,
        output_format: str = "mp3",
    ) -> Dict[str, Any]:
        """
        文本转语音
        
        Args:
            text: 要合成的文本
            voice_id: 预设音色 ID（与 model_id 二选一）
            model_id: Fish Audio 模型 ID（与 voice_id 二选一）
            speed: 语速 (0.5 - 2.0)
            pitch: 音调 (-12 - 12)
            output_format: 输出格式 ('mp3', 'wav', 'opus')
        
        Returns:
            {
                "audio_url": str,  # 音频 URL
                "duration": float,  # 时长（秒）
                "text": str,  # 原文本
            }
        """
        # 获取模型 ID
        if voice_id and not model_id:
            voice = self.get_voice_by_id(voice_id)
            if not voice:
                raise ValueError(f"未知的音色 ID: {voice_id}")
            model_id = voice["model_id"]
        
        if not model_id:
            raise ValueError("必须指定 voice_id 或 model_id")
        
        # Mock 模式
        if not self.api_key:
            logger.info(f"[TTS][Mock] 生成语音: {text[:50]}...")
            return {
                "audio_url": f"https://example.com/mock_tts_{datetime.now().timestamp()}.mp3",
                "duration": len(text) * 0.15,  # 粗略估算
                "text": text,
                "mock": True,
            }
        
        # 调用 Fish Audio API
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/v1/tts",
                    headers=self._get_headers(),
                    json={
                        "text": text,
                        "reference_id": model_id,
                        "format": output_format,
                        "latency": "normal",  # 'normal' | 'balanced' | 'low'
                        # Fish Audio 特定参数
                        "chunk_length": 200,
                        "normalize": True,
                    }
                )
                
                if response.status_code != 200:
                    error_text = response.text
                    logger.error(f"[TTS] API 错误: {response.status_code} - {error_text}")
                    raise Exception(f"TTS API 错误: {error_text}")
                
                # Fish Audio 直接返回音频流
                audio_content = response.content
                
                # 保存到临时文件并上传到存储
                audio_url = await self._save_audio(audio_content, output_format)
                
                # 估算时长（实际应该解析音频文件）
                duration = len(text) * 0.15
                
                logger.info(f"[TTS] 语音生成成功: {len(audio_content)} bytes, 预估时长 {duration:.1f}s")
                
                return {
                    "audio_url": audio_url,
                    "duration": duration,
                    "text": text,
                }
                
        except httpx.TimeoutException:
            raise Exception("TTS 服务超时，请稍后重试")
        except Exception as e:
            logger.error(f"[TTS] 语音生成失败: {e}")
            raise
    
    async def _save_audio(self, audio_content: bytes, format: str) -> str:
        """
        保存音频内容到存储
        
        TODO: 实现上传到 Supabase Storage
        """
        # 临时实现：保存到临时文件
        import uuid
        from ..tasks.ai_task_base import upload_to_storage
        
        filename = f"tts_{uuid.uuid4().hex}.{format}"
        
        with tempfile.NamedTemporaryFile(suffix=f".{format}", delete=False) as tmp:
            tmp.write(audio_content)
            tmp_path = tmp.name
        
        try:
            # 上传到 Supabase Storage
            storage_path = f"tts_audio/{filename}"
            url = upload_to_storage(tmp_path, storage_path)
            return url
        finally:
            # 清理临时文件
            import os
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    
    # ========================================
    # 声音克隆
    # ========================================
    
    async def clone_voice(
        self,
        audio_url: str,
        name: str,
        description: str = None,
    ) -> Dict[str, Any]:
        """
        克隆声音 - 创建自定义音色
        
        Args:
            audio_url: 参考音频 URL (30秒-3分钟)
            name: 音色名称
            description: 音色描述
        
        Returns:
            {
                "voice_id": str,  # 新创建的音色 ID
                "model_id": str,  # Fish Audio 模型 ID
                "name": str,
                "status": str,  # 'processing' | 'ready' | 'failed'
            }
        """
        if not self.api_key:
            logger.info(f"[TTS][Mock] 克隆声音: {name}")
            return {
                "voice_id": f"clone_{datetime.now().timestamp()}",
                "model_id": "mock_model_id",
                "name": name,
                "status": "ready",
                "mock": True,
            }
        
        try:
            # Step 1: 下载参考音频
            async with httpx.AsyncClient(timeout=30.0) as client:
                audio_response = await client.get(audio_url)
                audio_content = audio_response.content
            
            # Step 2: 上传到 Fish Audio 创建模型
            async with httpx.AsyncClient(timeout=120.0) as client:
                # 使用 multipart/form-data 上传
                files = {
                    "voices": ("reference.mp3", audio_content, "audio/mpeg"),
                }
                data = {
                    "visibility": "private",
                    "type": "tts",
                    "title": name,
                    "description": description or f"克隆声音: {name}",
                }
                
                headers = {"Authorization": f"Bearer {self.api_key}"}
                
                response = await client.post(
                    f"{self.base_url}/model",
                    headers=headers,
                    files=files,
                    data=data,
                )
                
                if response.status_code not in (200, 201):
                    error_text = response.text
                    logger.error(f"[TTS] 声音克隆失败: {response.status_code} - {error_text}")
                    raise Exception(f"声音克隆失败: {error_text}")
                
                result = response.json()
                model_id = result.get("_id")
                
                logger.info(f"[TTS] 声音克隆成功: model_id={model_id}")
                
                return {
                    "voice_id": f"custom_{model_id}",
                    "model_id": model_id,
                    "name": name,
                    "status": "ready",
                }
                
        except Exception as e:
            logger.error(f"[TTS] 声音克隆失败: {e}")
            raise
    
    async def get_clone_status(self, model_id: str) -> Dict[str, Any]:
        """
        获取声音克隆状态
        
        Fish Audio 通常很快完成，但复杂的可能需要等待
        """
        if not self.api_key:
            return {"status": "ready", "mock": True}
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.base_url}/model/{model_id}",
                    headers=self._get_headers(),
                )
                
                if response.status_code != 200:
                    return {"status": "failed", "error": response.text}
                
                result = response.json()
                return {
                    "status": "ready" if result.get("state") == "trained" else "processing",
                    "name": result.get("title"),
                    "model_id": model_id,
                }
                
        except Exception as e:
            logger.error(f"[TTS] 获取克隆状态失败: {e}")
            return {"status": "error", "error": str(e)}


# ============================================
# 全局单例
# ============================================

tts_service = TTSService()


# ============================================
# 便捷函数
# ============================================

async def text_to_speech(text: str, voice_id: str = "zh_female_gentle", **options) -> Dict:
    """文本转语音快捷函数"""
    return await tts_service.text_to_speech(text, voice_id=voice_id, **options)


async def clone_voice(audio_url: str, name: str, **options) -> Dict:
    """声音克隆快捷函数"""
    return await tts_service.clone_voice(audio_url, name, **options)


def get_preset_voices(**filters) -> List[Dict]:
    """获取预设音色列表"""
    return tts_service.get_preset_voices(**filters)
