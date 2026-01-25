"""
HoppingRabbit AI - 导出 API
"""
import logging
import asyncio
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from datetime import datetime
from uuid import uuid4

from ..models import ExportRequest
from ..services.supabase_client import supabase, get_file_url
from .auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/export", tags=["Export"])

# 存储活跃的导出任务
_active_export_tasks: dict[str, asyncio.Task] = {}

@router.post("")
async def start_export(
    request: ExportRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id)
):
    """启动视频导出任务"""
    try:
        job_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 解析导出配置
        settings = {}
        if request.custom_settings:
            settings = request.custom_settings.model_dump()
        
        # 如果有预设分辨率，使用预设
        if request.preset:
            settings["resolution"] = request.preset
        
        # 保存完整的导出配置，用于后续重试
        export_config = {
            "preset": request.preset,
            "custom_settings": request.custom_settings.model_dump() if request.custom_settings else None
        }
        
        job_data = {
            "id": job_id,
            "project_id": request.project_id,
            "user_id": user_id,
            "format": settings.get("format", "mp4"),  # 默认 mp4，适合社交媒体发布
            "quality": settings.get("quality", "high"),
            "resolution": {"preset": request.preset, "config": export_config},  # 保存完整配置
            "status": "pending",
            "progress": 0
        }
        
        supabase.table("exports").insert(job_data).execute()
        
        logger.info(f"[Export] 创建导出任务 {job_id}, settings={settings}")
        
        # 使用 asyncio.Task 来管理任务，支持取消
        task = asyncio.create_task(execute_export_task(job_id, request))
        _active_export_tasks[job_id] = task
        
        # 任务完成后从字典中移除
        def cleanup(t):
            _active_export_tasks.pop(job_id, None)
        task.add_done_callback(cleanup)
        
        return {"job_id": job_id, "status": "pending"}
    except Exception as e:
        logger.error(f"[Export] 创建任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list/{project_id}")
async def get_export_list(
    project_id: str,
    limit: int = 20,
    user_id: str = Depends(get_current_user_id)
):
    """获取项目的导出历史列表"""
    try:
        result = supabase.table("exports").select("*").eq(
            "project_id", project_id
        ).eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()
        
        return {"exports": result.data or []}
    except Exception as e:
        logger.error(f"[Export] 获取导出列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user-exports")
async def get_user_exports(
    limit: int = 50,
    user_id: str = Depends(get_current_user_id)
):
    """获取用户的所有导出历史（跨项目）- 优化版"""
    try:
        # 优化：只查询列表需要的字段，避免 SELECT *
        # 注意：resolution 字段可能包含大的 config 对象，列表只需要 preset
        result = supabase.table("exports").select(
            "id, project_id, format, quality, status, progress, "
            "output_path, file_size, error_message, created_at, completed_at, "
            "resolution->preset"  # 只取 preset，不取整个 config
        ).eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()
        
        exports = result.data or []
        
        if not exports:
            return {"exports": []}
        
        # 批量获取项目名称（单次查询）
        project_ids = list(set(e.get("project_id") for e in exports if e.get("project_id")))
        project_names = {}
        
        if project_ids:
            # 只查询需要的字段
            projects_result = supabase.table("projects").select(
                "id, name"
            ).in_("id", project_ids).execute()
            project_names = {p["id"]: p.get("name", "未命名") for p in (projects_result.data or [])}
        
        # 合并项目名称
        for export in exports:
            export["project_name"] = project_names.get(export.get("project_id"), "未命名项目")
        
        return {"exports": exports}
    except Exception as e:
        logger.error(f"[Export] 获取用户导出列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{job_id}")
async def get_export_status(
    job_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """获取导出任务状态"""
    try:
        result = supabase.table("exports").select("*").eq("id", job_id).eq("user_id", user_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="导出任务不存在")
        
        return result.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{job_id}/cancel")
async def cancel_export(
    job_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """取消进行中的导出任务"""
    try:
        # 1. 检查任务是否存在且正在进行
        task = _active_export_tasks.get(job_id)
        
        if task and not task.done():
            # 取消 asyncio 任务
            task.cancel()
            logger.info(f"[Export] 已取消任务 {job_id}")
            
            # 等待任务真正结束
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        
        # 2. 更新数据库状态为 failed (数据库约束不允许 cancelled)
        result = supabase.table("exports").update({
            "status": "failed",
            "error_message": "用户取消"
        }).eq("id", job_id).eq("user_id", user_id).in_("status", ["pending", "processing"]).execute()
        
        if not result.data:
            raise HTTPException(status_code=400, detail="任务无法取消或已完成")
        
        return {"success": True, "message": "导出任务已取消"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Export] 取消任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{job_id}/retry")
async def retry_export(
    job_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id)
):
    """重试失败的导出任务（使用原有配置）"""
    try:
        # 1. 获取原导出记录
        result = supabase.table("exports").select("*").eq("id", job_id).eq("user_id", user_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="导出记录不存在")
        
        original_export = result.data
        
        # 2. 检查状态，只允许重试失败的任务
        if original_export.get("status") not in ["failed"]:
            raise HTTPException(
                status_code=400, 
                detail=f"只能重试失败的任务，当前状态: {original_export.get('status')}"
            )
        
        # 3. 从 resolution 字段中提取保存的配置
        resolution_data = original_export.get("resolution") or {}
        saved_config = resolution_data.get("config", {})
        
        # 4. 构建 ExportRequest
        from ..models import ExportRequest, ExportSettings
        
        custom_settings = None
        if saved_config.get("custom_settings"):
            custom_settings = ExportSettings(**saved_config["custom_settings"])
        
        request = ExportRequest(
            project_id=original_export["project_id"],
            preset=saved_config.get("preset") or resolution_data.get("preset"),
            custom_settings=custom_settings
        )
        
        # 5. 创建新的导出任务
        new_job_id = str(uuid4())
        
        # 保存完整的导出配置
        export_config = {
            "preset": request.preset,
            "custom_settings": request.custom_settings.model_dump() if request.custom_settings else None,
            "retry_from": job_id  # 记录是从哪个任务重试的
        }
        
        job_data = {
            "id": new_job_id,
            "project_id": request.project_id,
            "user_id": user_id,  # 使用已认证的用户ID
            "format": original_export.get("format", "mov"),
            "quality": original_export.get("quality", "high"),
            "resolution": {"preset": request.preset, "config": export_config},
            "status": "pending",
            "progress": 0
        }
        
        supabase.table("exports").insert(job_data).execute()
        
        logger.info(f"[Export] 重试导出任务: 原任务 {job_id} -> 新任务 {new_job_id}")
        
        # 6. 启动导出任务
        task = asyncio.create_task(execute_export_task(new_job_id, request))
        _active_export_tasks[new_job_id] = task
        
        def cleanup(t):
            _active_export_tasks.pop(new_job_id, None)
        task.add_done_callback(cleanup)
        
        return {
            "success": True,
            "job_id": new_job_id,
            "original_job_id": job_id,
            "status": "pending",
            "message": "已创建重试任务"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Export] 重试任务失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{job_id}")
async def delete_export(
    job_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除导出记录（仅限已完成/失败/取消的记录）"""
    try:
        # 检查记录状态
        check = supabase.table("exports").select("status").eq("id", job_id).eq("user_id", user_id).single().execute()
        
        if not check.data:
            raise HTTPException(status_code=404, detail="导出记录不存在")
        
        if check.data.get("status") in ["pending", "processing"]:
            raise HTTPException(status_code=400, detail="进行中的任务请使用取消接口")
        
        # 删除记录
        supabase.table("exports").delete().eq("id", job_id).eq("user_id", user_id).execute()
        
        return {"success": True, "message": "导出记录已删除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Export] 删除记录失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{job_id}/download-url")
async def get_download_url(
    job_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """获取导出文件的下载链接"""
    try:
        result = supabase.table("exports").select("*").eq("id", job_id).eq("user_id", user_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="导出任务不存在")
        
        export_data = result.data
        
        if export_data.get("status") != "completed":
            raise HTTPException(status_code=400, detail="导出尚未完成")
        
        output_path = export_data.get("output_path")
        if not output_path:
            raise HTTPException(status_code=400, detail="导出文件不存在")
        
        # output_path 可能已经是完整 URL（旧格式）或相对路径（新格式）
        if output_path.startswith("http://") or output_path.startswith("https://"):
            # 已经是完整 URL，直接返回
            # 但签名可能已过期，需要从路径中提取并重新生成
            # URL 格式: https://xxx.supabase.co/storage/v1/object/sign/videos/exports/...
            import re
            match = re.search(r'/storage/v1/object/(?:sign|public)/([^/]+)/(.+?)(?:\?|$)', output_path)
            if match:
                bucket = match.group(1)
                path = match.group(2)
                # 重新生成签名 URL (有效期 1 小时)
                url = get_file_url(bucket, path, expires_in=3600)
                if url:
                    return {"url": url, "expires_in": 3600}
            # 无法解析，直接返回原 URL
            return {"url": output_path, "expires_in": 0}
        else:
            # 相对路径，生成签名 URL
            # 文件存储在 videos bucket 的 exports/ 目录下
            url = get_file_url("videos", output_path, expires_in=3600)
            
            if not url:
                raise HTTPException(status_code=500, detail="生成下载链接失败")
            
            return {"url": url, "expires_in": 3600}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Export] 获取下载链接失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def execute_export_task(job_id: str, request: ExportRequest):
    """执行视频导出任务"""
    try:
        logger.info(f"[Export] 开始执行导出任务 {job_id}")
        
        supabase.table("exports").update({
            "status": "processing",
            "progress": 5
        }).eq("id", job_id).execute()
        
        # 检查是否被取消
        await asyncio.sleep(0)  # 让出控制权，检查取消
        
        # 获取项目
        project = supabase.table("projects").select("*").eq("id", request.project_id).single().execute()
        logger.info(f"[Export] 项目: {project.data.get('name') if project.data else 'None'}")
        
        if not project.data:
            raise Exception("项目不存在")
        
        # 获取 tracks 和 clips
        tracks = supabase.table("tracks").select("*").eq("project_id", request.project_id).execute()
        logger.info(f"[Export] 获取到 {len(tracks.data) if tracks.data else 0} 个轨道")
        
        track_ids = [t["id"] for t in tracks.data] if tracks.data else []
        
        clips = supabase.table("clips").select("*").in_("track_id", track_ids).execute() if track_ids else None
        logger.info(f"[Export] 获取到 {len(clips.data) if clips and clips.data else 0} 个片段")
        
        # ★ 获取关键帧数据
        clip_ids = [c["id"] for c in (clips.data if clips else [])]
        keyframes = []
        if clip_ids:
            kf_result = supabase.table("keyframes").select("*").in_("clip_id", clip_ids).execute()
            keyframes = kf_result.data or []
            logger.info(f"[Export] 获取到 {len(keyframes)} 个关键帧")
        
        # 获取 assets（用于关联视频 URL）
        assets = supabase.table("assets").select("*").eq("project_id", request.project_id).execute()
        assets_by_id = {a["id"]: a for a in (assets.data or [])}
        logger.info(f"[Export] 获取到 {len(assets_by_id)} 个素材")
        
        # 为 clip 关联 asset URL 和关键帧
        keyframes_by_clip = {}
        for kf in keyframes:
            clip_id = kf.get("clip_id")
            if clip_id not in keyframes_by_clip:
                keyframes_by_clip[clip_id] = []
            keyframes_by_clip[clip_id].append(kf)
        
        enriched_clips = []
        for c in (clips.data if clips else []):
            clip = dict(c)
            clip_id = clip.get("id")
            
            # 关联关键帧
            if clip_id in keyframes_by_clip:
                clip["keyframes"] = keyframes_by_clip[clip_id]
            
            # 如果是视频/音频类型且有 asset_id，从 assets 获取 URL
            if clip.get("clip_type") in ("video", "audio") and clip.get("asset_id"):
                asset = assets_by_id.get(clip["asset_id"])
                if asset:
                    # 优先使用已有的完整 URL
                    raw_url = asset.get("url") or asset.get("storage_path")
                    
                    # 如果不是完整 URL，需要通过 storage_path 生成签名 URL
                    if raw_url:
                        if raw_url.startswith("http://") or raw_url.startswith("https://"):
                            clip["asset_url"] = raw_url
                        else:
                            # 是相对路径，生成签名 URL
                            clip["asset_url"] = get_file_url("clips", raw_url)
                    
                    logger.info(f"[Export] Clip {clip_id[:8]}... 关联到 asset URL: {clip.get('asset_url', 'None')[:50] if clip.get('asset_url') else 'None'}...")
            enriched_clips.append(clip)
        
        # 打印片段详情
        if enriched_clips:
            for c in enriched_clips[:5]:  # 只打印前5个
                kf_count = len(c.get('keyframes', []))
                logger.info(f"[Export] Clip: id={c.get('id')[:8]}..., type={c.get('clip_type')}, speed={c.get('speed', 1.0)}, keyframes={kf_count}")
        
        # 构建时间线
        timeline = {
            "tracks": tracks.data or [],
            "clips": enriched_clips,
            "keyframes": keyframes,
        }
        
        # 构建导出配置
        config = {}
        if request.custom_settings:
            config = request.custom_settings.model_dump()
        if request.preset:
            config["resolution"] = request.preset
        
        logger.info(f"[Export] 导出配置: {config}")
        
        # 更新进度
        def update_progress(progress: int):
            supabase.table("exports").update({
                "progress": progress
            }).eq("id", job_id).execute()
        
        # 调用导出函数
        from ..tasks.export import export_project
        result = await export_project(
            project_id=request.project_id,
            timeline=timeline,
            settings=config,
            on_progress=lambda p, m: update_progress(p)
        )
        
        supabase.table("exports").update({
            "status": "completed",
            "progress": 100,
            "output_path": result.get("export_url"),
            "file_size": result.get("file_size"),
            "completed_at": datetime.utcnow().isoformat()
        }).eq("id", job_id).execute()
        
        logger.info(f"[Export] 导出任务 {job_id} 完成")
        
    except asyncio.CancelledError:
        logger.info(f"[Export] 导出任务 {job_id} 被用户取消")
        supabase.table("exports").update({
            "status": "failed",
            "error_message": "用户取消"
        }).eq("id", job_id).execute()
        raise  # 重新抛出以让 asyncio 正确处理
        
    except Exception as e:
        logger.error(f"[Export] 导出任务 {job_id} 失败: {e}")
        import traceback
        traceback.print_exc()
        supabase.table("exports").update({
            "status": "failed",
            "error_message": str(e)
        }).eq("id", job_id).execute()
