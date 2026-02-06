"""
HoppingRabbit AI - API Routes
模块化 API 路由注册
"""
from fastapi import APIRouter

# 导入各模块路由
from .auth import router as auth_router
from .projects import router as projects_router
from .assets import router as assets_router
from .tasks import router as tasks_router
from .smart import router as smart_router
from .export import router as export_router
from .clips import router as clips_router
from .tracks import router as tracks_router
from .workspace import router as workspace_router
from .keyframes import router as keyframes_router
from .kling import router as kling_router  # 可灵AI
from .callback import router as callback_router  # AI回调接收
from .users import router as users_router  # 用户配额
from .credits import router as credits_router  # 积分系统
from .subscriptions import router as subscriptions_router  # 订阅系统
from .broll import router as broll_router  # B-roll 素材库
from .upload import router as upload_router  # 文件上传
from .cloudflare import router as cloudflare_router  # Cloudflare Stream
from .video_gen import router as video_gen_router  # 统一视频生成（多模型）
from .materials import router as materials_router  # 用户素材库
from .benchmark import router as benchmark_router  # 标杆视频分析
from .shot_segmentation import router as shot_segmentation_router  # 分镜策略
from .ai_capabilities import router as ai_capabilities_router  # AI 能力（换背景等）
from .background_replace import router as background_replace_router  # 背景替换 Agent Workflow

# 创建主路由器
api_router = APIRouter()

# 注册所有子路由（认证路由优先）
api_router.include_router(auth_router)
api_router.include_router(workspace_router)  # 工作台入口流程
api_router.include_router(projects_router)
api_router.include_router(assets_router)
api_router.include_router(clips_router)
api_router.include_router(tracks_router)
api_router.include_router(keyframes_router)  # 关键帧
api_router.include_router(tasks_router)
api_router.include_router(smart_router)
api_router.include_router(export_router)
api_router.include_router(kling_router)  # 可灵AI 口播能力
api_router.include_router(video_gen_router)  # 统一视频生成（Kling/Veo/Runway）
api_router.include_router(callback_router)  # AI回调接收
api_router.include_router(users_router)  # 用户配额
api_router.include_router(credits_router)  # 积分系统
api_router.include_router(subscriptions_router)  # 订阅系统
api_router.include_router(broll_router)  # B-roll 素材库
api_router.include_router(upload_router)  # 文件上传
api_router.include_router(cloudflare_router)  # Cloudflare Stream
api_router.include_router(materials_router)  # 用户素材库
api_router.include_router(benchmark_router)  # 标杆视频分析
api_router.include_router(shot_segmentation_router)  # 分镜策略
api_router.include_router(ai_capabilities_router)  # AI 能力（换背景等）
api_router.include_router(background_replace_router)  # 背景替换 Agent Workflow

# 导出
__all__ = [
    "api_router",
    "auth_router",
    "workspace_router",
    "projects_router",
    "assets_router", 
    "tasks_router",
    "smart_router",
    "export_router"
]
