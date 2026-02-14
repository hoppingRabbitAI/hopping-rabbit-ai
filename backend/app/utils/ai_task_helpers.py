"""
AI 任务公共工具函数

提供 _create_ai_task 等在多个 API 路由中复用的工具。
"""

import uuid
import logging
from datetime import datetime
from typing import Dict, Optional

logger = logging.getLogger(__name__)


def _get_supabase():
    """延迟导入 supabase 客户端"""
    from ..services.supabase_client import supabase
    return supabase


def create_ai_task(
    user_id: str,
    task_type: str,
    input_params: Dict,
    provider: str = "kling",
    callback_url: Optional[str] = None,
    project_id: Optional[str] = None,
) -> str:
    """
    创建 AI 任务记录（写入 tasks 表）

    统一入口，供 kling.py / enhance_style.py 等 API 路由调用。

    Args:
        user_id: 用户 ID
        task_type: 任务类型 (face_swap / image_to_video / skin_enhance / ...)
        input_params: 用户输入参数快照
        provider: AI 服务商 (默认 kling)
        callback_url: 可选回调 URL（有则显示"回调模式"，否则"轮询模式"）
        project_id: 关联项目 ID（任务历史按项目过滤）

    Returns:
        新创建的 ai_task_id
    """
    ai_task_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    mode_hint = "（回调模式）" if callback_url else "（轮询模式）"

    task_data = {
        "id": ai_task_id,
        "user_id": user_id,
        "task_type": task_type,
        "provider": provider,
        "status": "pending",
        "progress": 0,
        "status_message": f"任务已创建，等待处理{mode_hint}",
        "input_params": input_params,
        "created_at": now,
    }

    if project_id:
        task_data["project_id"] = project_id

    _get_supabase().table("tasks").insert(task_data).execute()

    logger.info(f"[AITask] 创建任务: {ai_task_id}, type={task_type}, callback={callback_url or '无(轮询模式)'}")
    return ai_task_id
