"""
Lepus AI - 导出 API
Visual Editor 主线导出（ffmpeg 合成）
"""
import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
from uuid import uuid4
from datetime import datetime

from ..services.supabase_client import supabase, get_file_url
from .auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/exports", tags=["Exports"])


# ============================================
# 请求/响应模型
# ============================================

class ExportStartRequest(BaseModel):
    project_id: str
    preset: str = Field("1080p", description="分辨率预设: 720p | 1080p | 2k | 4k")
    custom_settings: Optional[dict] = Field(None, description="自定义设置 {fps, format}")


class ExportStartResponse(BaseModel):
    job_id: str
    status: str = "pending"


# ============================================
# 端点
# ============================================

@router.post("", response_model=ExportStartResponse)
async def start_export(
    req: ExportStartRequest,
    user_id: str = Depends(get_current_user_id),
):
    """创建导出任务"""
    job_id = str(uuid4())
    fmt = "mp4"
    fps = 30

    if req.custom_settings:
        fmt = req.custom_settings.get("format", "mp4")
        fps = req.custom_settings.get("fps", 30)

    # 获取项目信息 + 验证所有权
    proj = supabase.table("projects").select("*").eq("id", req.project_id).eq("user_id", user_id).single().execute()
    if not proj.data:
        raise HTTPException(404, "项目不存在")

    # 创建导出记录
    supabase.table("exports").insert({
        "id": job_id,
        "project_id": req.project_id,
        "user_id": user_id,
        "format": fmt,
        "quality": "high",
        "resolution": {"preset": req.preset, "fps": fps},
        "status": "pending",
        "progress": 0,
    }).execute()

    # 尝试分发 Celery 任务
    try:
        from ..tasks.export import export_video_task
        # 构建简易 timeline（让任务侧从 DB 读取真实数据）
        export_video_task.delay(
            task_id=job_id,
            project_id=req.project_id,
            timeline={},  # 任务侧自行查库
            settings={
                "resolution": req.preset,
                "format": fmt,
                "fps": fps,
            },
        )
        # 更新状态为 processing
        supabase.table("exports").update({"status": "processing"}).eq("id", job_id).execute()
    except Exception as e:
        logger.warning(f"[Export] Celery 分发失败，标记为 pending: {e}")
        # 保持 pending，前端会轮询

    return ExportStartResponse(job_id=job_id)


@router.get("")
async def list_exports(user_id: str = Depends(get_current_user_id)):
    """获取当前用户的导出列表"""
    result = (
        supabase.table("exports")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return result.data or []


@router.get("/{job_id}")
async def get_export_status(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """查询导出任务状态"""
    result = (
        supabase.table("exports")
        .select("*")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "导出任务不存在")

    row = result.data
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "status": row["status"],
        "progress": row.get("progress", 0),
        "output_url": row.get("output_path"),
        "output_file_size": row.get("file_size"),
        "error_message": row.get("error_message"),
        "format": row.get("format"),
        "created_at": row.get("created_at"),
        "completed_at": row.get("completed_at"),
    }


@router.get("/{job_id}/download")
async def get_download_url(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """获取导出文件下载链接"""
    result = (
        supabase.table("exports")
        .select("output_path, status, user_id")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "导出任务不存在")

    if result.data["status"] != "completed":
        raise HTTPException(400, "导出尚未完成")

    output_path = result.data.get("output_path")
    if not output_path:
        raise HTTPException(404, "导出文件不存在")

    # 如果是完整 URL 直接返回，否则生成签名 URL
    if output_path.startswith("http"):
        return {"url": output_path}

    url = get_file_url("export-videos", output_path, expires_in=3600)
    if not url:
        raise HTTPException(404, "无法生成下载链接")
    return {"url": url}


@router.post("/{job_id}/cancel")
async def cancel_export(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """取消导出任务"""
    result = (
        supabase.table("exports")
        .select("status")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "导出任务不存在")

    if result.data["status"] in ("completed", "cancelled"):
        return {"ok": True, "message": "任务已结束"}

    supabase.table("exports").update({
        "status": "cancelled",
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", job_id).execute()

    return {"ok": True}


@router.delete("/{job_id}")
async def delete_export(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """删除导出记录"""
    supabase.table("exports").delete().eq("id", job_id).eq("user_id", user_id).execute()
    return {"ok": True}
