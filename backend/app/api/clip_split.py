"""
Lepus AI - Clip Split API
Visual Editor 用的 clip 拆分端点

仅保留 /{clip_id}/split 端点，用于 Visual Editor 的 ClipNode 拆分功能。
"""
import logging
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from datetime import datetime
from uuid import uuid4

from ..services.supabase_client import supabase
from .auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clips", tags=["Clips"])


@router.post("/{clip_id}/split")
async def direct_clip_split(
    clip_id: str,
    background_tasks: BackgroundTasks = None,
    user_id: str = Depends(get_current_user_id)
):
    """
    拆镜头（场景检测 + 拆分一步完成）
    异步模式：返回 task_id，前端轮询获取结果
    """
    task_id = str(uuid4())
    now = datetime.utcnow().isoformat()

    try:
        # 查 canvas_nodes（Visual Editor 唯一数据源）
        project_id = None
        try:
            cn_result = supabase.table("canvas_nodes").select("id, project_id").eq("id", clip_id).single().execute()
            if cn_result.data:
                project_id = cn_result.data.get("project_id")
        except Exception:
            pass

        if not project_id:
            raise HTTPException(
                status_code=404,
                detail="节点数据未持久化，请刷新页面后重试",
            )

        # 创建任务记录
        supabase.table("tasks").insert({
            "id": task_id,
            "project_id": project_id,
            "user_id": user_id,
            "task_type": "clip_split",
            "status": "pending",
            "progress": 0,
            "params": {"clip_id": clip_id},
            "created_at": now
        }).execute()

        # 后台执行场景检测 + 拆分
        background_tasks.add_task(_execute_direct_split, task_id, clip_id)

        logger.info(f"[ClipSplit] 创建拆分任务 {task_id[:8]}... clip={clip_id[:8]}...")
        return {"task_id": task_id, "status": "pending"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ClipSplit] 创建任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _execute_direct_split(task_id: str, clip_id: str):
    """后台执行 ffmpeg 场景检测 + 拆分"""
    try:
        from ..services.clip_split_service import analyze_and_split

        # 更新为运行中
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "started_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()

        result = await analyze_and_split(clip_id, supabase)

        supabase.table("tasks").update({
            "status": "completed",
            "progress": 100,
            "result": {
                "success": result.success,
                "reason": result.reason,
                "message": result.reason,
                "segment_count": len(result.segments),
            },
            "completed_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()

        logger.info(f"[ClipSplit] 拆分完成 {task_id[:8]}... success={result.success} segments={len(result.segments)}")

    except Exception as e:
        logger.error(f"[ClipSplit] 拆分失败 {task_id[:8]}... error={e}")
        import traceback
        traceback.print_exc()
        supabase.table("tasks").update({
            "status": "failed",
            "error_message": str(e),
            "completed_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
