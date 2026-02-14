"""
Lepus AI - Celery 配置
分布式任务队列配置，支持 AI 处理任务
"""
import os
from pathlib import Path

# 加载环境变量（必须在其他导入之前）
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

from celery import Celery
from kombu import Queue

# 从环境变量获取配置
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# 使用 Redis 同时作为 Broker 和 Result Backend（简化架构，不需要 RabbitMQ）
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", REDIS_URL)

# 检测是否使用 SSL Redis（Upstash 等云服务）
USE_SSL_REDIS = REDIS_URL.startswith("rediss://")

# 创建 Celery 应用
celery_app = Celery(
    "lepus",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=[
        "app.tasks.transcribe",
        "app.tasks.export",
        "app.tasks.asset_processing",
        "app.tasks.lip_sync",              # AI 口型同步
        "app.tasks.text_to_video",         # AI 文生视频
        "app.tasks.image_to_video",        # AI 图生视频
        "app.tasks.multi_image_to_video",  # AI 多图生视频
        "app.tasks.motion_control",        # AI 动作控制
        "app.tasks.multi_elements",        # AI 多模态视频编辑
        "app.tasks.video_extend",          # AI 视频延长
        "app.tasks.image_generation",      # AI 图像生成
        "app.tasks.omni_image",            # AI Omni-Image (O1)
        "app.tasks.face_swap",             # AI 换脸
        "app.tasks.enhance_style",         # AI 美化打光换装（5 大能力）
        "app.tasks.avatar_confirm_portraits",  # 数字人确认肖像
        "app.tasks.doubao_image",              # 豆包 Seedream 图像生成
        "app.tasks.broll_download",        # B-roll 下载
    ]
)

# ============================================
# Celery 配置
# ============================================

# SSL 配置（用于 Upstash 等云 Redis 服务）
ssl_config = {
    "broker_use_ssl": {"ssl_cert_reqs": "CERT_NONE"},
    "redis_backend_use_ssl": {"ssl_cert_reqs": "CERT_NONE"},
} if USE_SSL_REDIS else {}

celery_app.conf.update(
    # SSL 配置（如果使用 rediss://）
    **ssl_config,
    
    # 任务序列化
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    
    # 时区
    timezone="Asia/Shanghai",
    enable_utc=True,
    
    # 任务结果过期时间（7天）
    result_expires=604800,
    
    # 任务确认
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    
    # 并发配置
    worker_prefetch_multiplier=1,  # 每次只预取一个任务
    worker_concurrency=2,  # 每个 worker 2个并发（AI 任务占用 GPU）
    
    # 任务超时
    task_soft_time_limit=1800,  # 30分钟软超时
    task_time_limit=3600,  # 60分钟硬超时
    
    # 队列定义 — 统一使用单一 gpu 队列，简化运维
    task_queues=(
        Queue("gpu", routing_key="gpu"),
    ),
    
    # 默认队列
    task_default_queue="gpu",
    task_default_routing_key="gpu",
    
    # 任务跟踪
    task_track_started=True,
    
    # 结果后端配置
    result_backend_transport_options={
        "visibility_timeout": 43200,  # 12小时
    },
)

# ============================================
# 任务优先级装饰器
# ============================================

def gpu_task(func=None, *, priority="high"):
    """GPU 任务装饰器（所有任务统一用 gpu 队列）"""
    
    def decorator(f):
        return celery_app.task(
            bind=True,
            queue="gpu",
            autoretry_for=(Exception,),
            retry_backoff=True,
            retry_backoff_max=600,
            retry_kwargs={"max_retries": 3},
        )(f)
    
    if func:
        return decorator(func)
    return decorator


def cpu_task(func=None, *, priority="medium"):
    """CPU 任务装饰器（所有任务统一用 gpu 队列）"""
    
    def decorator(f):
        return celery_app.task(
            bind=True,
            queue="gpu",
            autoretry_for=(Exception,),
            retry_backoff=True,
            retry_backoff_max=300,
            retry_kwargs={"max_retries": 3},
        )(f)
    
    if func:
        return decorator(func)
    return decorator


# ============================================
# 任务状态更新工具
# ============================================

from datetime import datetime


def _get_supabase():
    """延迟导入 supabase 客户端，避免循环导入"""
    from app.services.supabase_client import supabase
    return supabase


def update_task_progress(task_id: str, progress: int, current_step: str = None):
    """更新任务进度"""
    update_data = {
        "progress": progress,
        "updated_at": datetime.utcnow().isoformat()
    }
    if current_step:
        update_data["current_step"] = current_step
    
    _get_supabase().table("tasks").update(update_data).eq("id", task_id).execute()


def update_task_status(task_id: str, status: str, result: dict = None, error: str = None):
    """更新任务状态"""
    update_data = {
        "status": status,
        "updated_at": datetime.utcnow().isoformat()
    }
    if result is not None:
        update_data["result"] = result
    if error is not None:
        update_data["error"] = error
    if status == "completed":
        update_data["progress"] = 100
    
    _get_supabase().table("tasks").update(update_data).eq("id", task_id).execute()
