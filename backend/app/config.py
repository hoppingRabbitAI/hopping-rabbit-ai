"""
HoppingRabbit AI - Configuration
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional


class Settings(BaseSettings):
    # Supabase 配置（必须在 .env 中设置）
    supabase_url: str = ""  # 格式: https://xxx.supabase.co
    supabase_anon_key: str = ""  # 格式: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
    supabase_service_key: Optional[str] = None  # 格式: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
    
    # Redis
    redis_url: str = "redis://localhost:6379/0"
    
    # OpenAI (可选，用于智能清洗)
    openai_api_key: Optional[str] = None
    
    # ============================================
    # 火山引擎 / 豆包 API 配置
    # ============================================
    # ASR (语音识别) - 从火山引擎控制台获取
    doubao_app_id: str = ""
    doubao_access_token: str = ""
    doubao_resource_id: str = "volc.bigasr.auc"
    
    # LLM Provider 选择: "doubao" 或 "gemini"
    llm_provider: str = "doubao"
    
    # LLM (豆包大模型 - 火山方舟 Ark)
    # 文档: https://www.volcengine.com/docs/82379/1399008
    volcengine_ark_api_key: str = ""  # 从火山方舟控制台获取
    volcengine_access_key: Optional[str] = None
    volcengine_secret_key: Optional[str] = None
    doubao_model_endpoint: str = "doubao-seed-1-6-flash-250828"  # Flash 模型（速度快）
    
    # LLM (Google Gemini)
    # 获取 API Key: https://aistudio.google.com/app/apikey
    # 可用模型: gemini-2.5-flash (推荐), gemini-2.5-pro, gemini-2.0-flash
    gemini_api_key: Optional[str] = None  # 从 Google AI Studio 获取
    gemini_model: str = "gemini-2.5-flash"  # 最新稳定版，速度快性价比高
    
    # Whisper
    whisper_model: str = "base"  # 开发阶段用 base，生产用 large-v3
    whisper_device: str = "cpu"  # cpu 或 cuda
    
    # Storage
    cache_dir: str = "/tmp/hoppingrabbit_cache"
    
    # CORS
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    
    # 开发模式（使用本地文件存储代替 Supabase Storage）
    dev_mode: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
