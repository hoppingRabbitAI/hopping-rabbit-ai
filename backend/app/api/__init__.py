"""
Lepus AI - API Routes
"""
from fastapi import APIRouter

from .auth import router as auth_router
from .projects import router as projects_router
from .assets import router as assets_router
from .tasks import router as tasks_router
from .clip_split import router as clip_split_router
from .kling import router as kling_router
from .callback import router as callback_router
from .users import router as users_router
from .credits import router as credits_router
from .subscriptions import router as subscriptions_router
from .upload import router as upload_router
from .cloudflare import router as cloudflare_router
from .materials import router as materials_router
from .shot_segmentation import router as shot_segmentation_router
from .ai_capabilities import router as ai_capabilities_router
from .background_replace import router as background_replace_router
from .templates import router as templates_router
from .model_catalog import router as model_catalog_router
from .visual_separation import router as visual_separation_router
from .canvas_nodes import router as canvas_nodes_router
from .v2_templates import router as v2_templates_router
from .v2_intent import router as v2_intent_router
from .v2_capabilities import router as v2_capabilities_router
from .v2_canvas import router as v2_canvas_router
from .enhance_style import router as enhance_style_router
from .v2_avatars import router as v2_avatars_router
from .export import router as export_router
from .image_generation import router as image_generation_router
from .enhancement_rag import router as enhancement_rag_router
from .prompt_library import router as prompt_library_router

api_router = APIRouter()

api_router.include_router(auth_router)
api_router.include_router(projects_router)
api_router.include_router(assets_router)
api_router.include_router(clip_split_router)
api_router.include_router(export_router)
api_router.include_router(tasks_router)
api_router.include_router(kling_router)
api_router.include_router(callback_router)
api_router.include_router(users_router)
api_router.include_router(credits_router)
api_router.include_router(subscriptions_router)
api_router.include_router(upload_router)
api_router.include_router(cloudflare_router)
api_router.include_router(materials_router)
api_router.include_router(shot_segmentation_router)
api_router.include_router(ai_capabilities_router)
api_router.include_router(background_replace_router)
api_router.include_router(templates_router)
api_router.include_router(model_catalog_router)
api_router.include_router(visual_separation_router)
api_router.include_router(canvas_nodes_router)
api_router.include_router(v2_templates_router)
api_router.include_router(v2_intent_router)
api_router.include_router(v2_capabilities_router)
api_router.include_router(v2_canvas_router)
api_router.include_router(enhance_style_router)
api_router.include_router(v2_avatars_router)
api_router.include_router(image_generation_router)
api_router.include_router(enhancement_rag_router)
api_router.include_router(prompt_library_router)

__all__ = ["api_router"]
