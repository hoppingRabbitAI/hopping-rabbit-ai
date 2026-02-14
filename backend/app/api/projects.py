"""
Lepus AI - 项目管理 API
适配新表结构 (2026-01-07)

新表结构变化：
- projects: 移除 settings/timeline/segments/version/duration，使用 resolution/fps
- tracks: layer → order_index, muted → is_muted, locked → is_locked
- clips: 移除 clip_type/duration/name/is_deleted/effects, muted → is_muted
"""
import asyncio
import logging
from fastapi import APIRouter, HTTPException, Query, Path, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import uuid4

from ..models import ProjectCreate, ProjectUpdate
from ..services.supabase_client import supabase, get_file_url
from .auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["Projects"])


# ============================================
# 辅助函数
# ============================================

def _format_clip(c: dict) -> dict:
    """格式化单个 clip（统一使用下划线命名）"""
    return {
        "id": c["id"],
        "track_id": c["track_id"],
        "asset_id": c.get("asset_id"),
        "clip_type": c.get("clip_type", "video"),
        # 时间字段（统一毫秒）
        "start_time": c["start_time"],
        "end_time": c["end_time"],
        "duration": c["end_time"] - c["start_time"],
        "origin_duration": c.get("origin_duration", 0),
        "source_start": c.get("source_start", 0),
        "source_end": c.get("source_end"),
        # 媒体
        "url": c.get("url"),
        # 音频属性
        "is_muted": c.get("is_muted", False),
        "volume": c.get("volume", 1.0),
        "speed": c.get("speed", 1.0),
        # 变换
        "transform": c.get("transform"),
        "transition_in": c.get("transition_in"),
        "transition_out": c.get("transition_out"),
        # 文本内容 (text, subtitle)
        "content_text": c.get("content_text") or c.get("subtitle_text"),
        "text_style": c.get("text_style") or c.get("subtitle_style"),
        # 特效/滤镜 (effect, filter)
        "effect_type": c.get("effect_type"),
        "effect_params": c.get("effect_params"),
        # 配音 (voice)
        "voice_params": c.get("voice_params"),
        # 贴纸 (sticker)
        "sticker_id": c.get("sticker_id"),
        # 元数据
        "name": c.get("name") or (c.get("subtitle_text") or c.get("content_text") or "Clip")[:20],
        "color": c.get("color"),
        "metadata": c.get("metadata"),
        "parent_clip_id": c.get("parent_clip_id"),
    }


def _group_clips_by_type(clips: list) -> dict:
    """按 clip_type 分组返回 clips"""
    grouped = {
        "video": [],
        "audio": [],
        "subtitle": [],
        "text": [],
        "voice": [],
        "effect": [],
        "filter": [],
        "transition": [],
        "sticker": [],
    }
    
    for c in clips:
        clip_type = c.get("clip_type", "video")
        formatted = _format_clip(c)
        
        if clip_type in grouped:
            grouped[clip_type].append(formatted)
        else:
            # 未知类型归入 video
            grouped["video"].append(formatted)
    
    return grouped


# ============================================
# 权限验证辅助函数
# ============================================

async def verify_project_access(project_id: str, user_id: str) -> dict:
    """验证用户是否有权限访问项目，返回项目数据"""
    result = supabase.table("projects").select("*").eq("id", project_id).single().execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = result.data
    
    # 验证用户权限
    if project.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权访问此项目")
    
    return project


@router.get("")
async def list_projects(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    """获取当前用户的项目列表
    
    前端实际使用的字段: id, name, updated_at, thumbnail_url, thumbnail_asset_id, duration
    不需要返回: status, resolution, fps, created_at
    """
    import time
    start_time = time.time()
    
    try:
        # 1. 查询当前用户的项目 - 只获取前端需要的字段
        query = supabase.table("projects").select(
            "id, name, thumbnail_url, updated_at"
        ).eq("user_id", user_id).order("updated_at", desc=True)
        
        if status:
            query = query.eq("status", status)
        
        result = query.range(offset, offset + limit - 1).execute()
        projects = result.data or []
        
        logger.info(f"[Projects] 查询项目列表耗时: {(time.time() - start_time) * 1000:.1f}ms, 数量: {len(projects)}")
        
        if not projects:
            return {
                "items": [],
                "total": 0,
                "limit": limit,
                "offset": offset
            }
        
        project_ids = [p["id"] for p in projects]
        
        # 2. 并行查询 tracks 和 assets（减少串行等待）
        parallel_start = time.time()
        
        tracks_result, assets_result = await asyncio.gather(
            asyncio.to_thread(lambda: supabase.table("tracks").select("id, project_id").in_("project_id", project_ids).execute()),
            asyncio.to_thread(lambda: supabase.table("assets").select("id, project_id, thumbnail_path, created_at").in_("project_id", project_ids).eq("file_type", "video").eq("status", "ready").order("created_at").execute())
        )
        
        tracks = tracks_result.data or []
        assets = assets_result.data or []
        
        logger.info(f"[Projects] 并行查询 tracks+assets 耗时: {(time.time() - parallel_start) * 1000:.1f}ms")
        
        # 3. 构建 track_id -> project_id 映射
        track_to_project = {t["id"]: t["project_id"] for t in tracks}
        track_ids = list(track_to_project.keys())
        
        # 4. 查询 clips（只需要 track_id 和 end_time）
        duration_map = {}
        if track_ids:
            clips_start = time.time()
            clips_result = supabase.table("clips").select("track_id, end_time").in_("track_id", track_ids).execute()
            clips = clips_result.data or []
            
            logger.info(f"[Projects] 查询 clips 耗时: {(time.time() - clips_start) * 1000:.1f}ms, 数量: {len(clips)}")
            
            # 按 project_id 分组并计算最大 end_time
            for clip in clips:
                track_id = clip["track_id"]
                project_id = track_to_project.get(track_id)
                if project_id:
                    end = clip.get("end_time", 0) or 0
                    if project_id not in duration_map:
                        duration_map[project_id] = end
                    else:
                        duration_map[project_id] = max(duration_map[project_id], end)
        
        # 5. 添加 duration 到每个项目
        for project in projects:
            project["duration"] = duration_map.get(project["id"], 0)
        
        # 6. 每个项目只取第一个视频（最早上传的）作为封面
        project_first_asset = {}
        for asset in assets:
            pid = asset["project_id"]
            if pid not in project_first_asset:
                project_first_asset[pid] = asset
        
        for project in projects:
            pid = project["id"]
            if pid in project_first_asset:
                asset = project_first_asset[pid]
                project["thumbnail_asset_id"] = asset["id"]
                # ★ 如果 asset 有缩略图，用它作为项目封面
                if asset.get("thumbnail_path") and not project.get("thumbnail_url"):
                    project["thumbnail_url"] = asset["thumbnail_path"]
        
        # 7. 处理 thumbnail_url：如果是存储路径，生成签名 URL
        from ..services.supabase_client import get_file_url
        for project in projects:
            thumb_url = project.get("thumbnail_url")
            # 如果看起来是存储路径（不是完整 URL），生成签名 URL
            if thumb_url and not thumb_url.startswith(('http://', 'https://')):
                try:
                    project["thumbnail_url"] = get_file_url("clips", thumb_url)
                except Exception as e:
                    logger.warning(f"[Projects] 生成封面 URL 失败: {e}")
                    project["thumbnail_url"] = None
        
        logger.info(f"[Projects] 列表接口总耗时: {(time.time() - start_time) * 1000:.1f}ms")
        
        return {
            "items": projects,
            "total": len(projects),
            "limit": limit,
            "offset": offset
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def create_project(
    request: ProjectCreate,
    user_id: str = Depends(get_current_user_id)
):
    """创建新项目"""
    try:
        project_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 适配新表结构
        project_data = {
            "id": project_id,
            "user_id": user_id,  # 使用认证用户ID
            "name": request.name,
            "description": request.description,
            "status": "draft",
            "resolution": request.resolution or {"width": 1920, "height": 1080},
            "fps": request.fps or 30,
            "created_at": now,
            "updated_at": now
        }
        
        result = supabase.table("projects").insert(project_data).execute()
        
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project_id}")
async def get_project(
    project_id: str = Path(..., description="项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """获取项目详情（包含 tracks, clips, assets）- 优化版"""
    import asyncio
    import time
    
    try:
        start_time = time.time()
        
        # 验证用户权限并获取项目
        project = await verify_project_access(project_id, user_id)
        
        # ========== 并行查询 assets 和 tracks ==========
        def fetch_assets():
            # 优化：只选择必要字段，排除 waveform_data（可能很大）
            return supabase.table("assets").select(
                "id, project_id, name, original_filename, file_type, mime_type, "
                "file_size, storage_path, thumbnail_path, proxy_path, hls_path, "
                "duration, width, height, fps, sample_rate, channels, status"
            ).eq("project_id", project_id).execute()
        
        def fetch_tracks():
            # 优化：只选择必要字段
            return supabase.table("tracks").select(
                "id, name, order_index, is_muted, is_locked, is_visible"
            ).eq("project_id", project_id).order("order_index").execute()
        
        # 并行执行（使用 asyncio.to_thread 因为 supabase-py 是同步的）
        assets_result, tracks_result = await asyncio.gather(
            asyncio.to_thread(fetch_assets),
            asyncio.to_thread(fetch_tracks)
        )
        
        # 解包结果
        assets = assets_result.data or []
        tracks = tracks_result.data or []
        
        logger.info(f"[GetProject] ⏱️ 并行查询 assets+tracks: {(time.time() - start_time)*1000:.0f}ms")
        
        # 批量生成签名 URL
        t1 = time.time()
        if assets:
            from ..services.supabase_client import get_file_urls_batch
            
            # 收集所有需要签名的路径
            storage_paths = [a["storage_path"] for a in assets if a.get("storage_path")]
            thumbnail_paths = [a["thumbnail_path"] for a in assets if a.get("thumbnail_path")]
            all_paths = list(set(storage_paths + thumbnail_paths))
            
            # 批量签名
            url_map = get_file_urls_batch("clips", all_paths) if all_paths else {}
            
            # 分配 URL 并映射字段
            for asset in assets:
                if asset.get("storage_path"):
                    asset["url"] = url_map.get(asset["storage_path"], "")
                if asset.get("thumbnail_path"):
                    asset["thumbnail_url"] = url_map.get(asset["thumbnail_path"], "")
                # ★ 映射 file_type -> type，前端使用 type
                asset["type"] = asset.get("file_type", "video")
                # ★ 构建 metadata 对象
                asset["metadata"] = {
                    "duration": asset.get("duration"),
                    "width": asset.get("width"),
                    "height": asset.get("height"),
                    "fps": asset.get("fps"),
                    "sample_rate": asset.get("sample_rate"),
                    "channels": asset.get("channels"),
                }
        
        logger.info(f"[GetProject] ⏱️ 批量签名 URL: {(time.time() - t1)*1000:.0f}ms")
        
        # ========== 查询 clips ==========
        t2 = time.time()
        clips = []
        assets_map = {str(a["id"]): a for a in assets}
        
        if tracks:
            track_ids = [t["id"] for t in tracks]
            # 优化：只选择必要字段
            clips_result = supabase.table("clips").select(
                "id, track_id, asset_id, clip_type, start_time, end_time, "
                "source_start, source_end, volume, is_muted, transform, speed, "
                "transition_in, transition_out, content_text, text_style, "
                "effect_type, effect_params, voice_params, sticker_id, "
                "cached_url, name, color, metadata, parent_clip_id"
            ).in_("track_id", track_ids).order("start_time").execute()
            
            if clips_result.data:
                for clip in clips_result.data:
                    asset = assets_map.get(str(clip.get("asset_id"))) if clip.get("asset_id") else None
                    if asset:
                        if asset.get("url"):
                            clip["url"] = asset["url"]
                        if asset.get("duration"):
                            clip["origin_duration"] = int(asset["duration"] * 1000)
                    elif clip.get("cached_url"):
                        clip["url"] = clip["cached_url"]
                        
                clips = clips_result.data
                
                video_clips = [c for c in clips if c.get("clip_type") == "video"]
                subtitle_clips = [c for c in clips if c.get("clip_type") == "subtitle"]
                logger.info(f"[GetProject] ⏱️ clips 查询: {(time.time() - t2)*1000:.0f}ms, 视频={len(video_clips)}, 字幕={len(subtitle_clips)}")
        
        # 计算项目总时长
        duration = 0
        if clips:
            duration = max(c.get("end_time", 0) for c in clips)
        
        # ========== 查询关键帧 ==========
        t3 = time.time()
        keyframes = []
        if clips:
            clip_ids = [c["id"] for c in clips]
            
            # 优化：只选择必要字段，直接读取 offset（归一化值 0-1）
            keyframes_result = supabase.table("keyframes").select(
                "id, clip_id, property, offset, value, easing"
            ).in_("clip_id", clip_ids).order("offset").execute()
            
            if keyframes_result.data:
                for kf in keyframes_result.data:
                    # offset 已经是归一化值，直接使用
                    keyframes.append({
                        "id": kf["id"],
                        "clipId": kf["clip_id"],
                        "property": kf["property"],
                        "offset": kf["offset"],
                        "value": kf["value"],
                        "easing": kf.get("easing", "linear"),
                    })
                
                logger.info(f"[GetProject] ⏱️ keyframes 查询: {(time.time() - t3)*1000:.0f}ms, 共 {len(keyframes)} 个")
        
        # 构建 timeline（duration 放在最外层，避免冗余）
        timeline = {
            "tracks": [
                {
                    "id": t["id"],
                    "name": t["name"],
                    "order_index": t["order_index"],
                    "is_muted": t["is_muted"],
                    "is_locked": t["is_locked"],
                    "is_visible": t["is_visible"],
                }
                for t in tracks
            ],
            "clips": _group_clips_by_type(clips),
            "keyframes": keyframes,
        }
        
        # 处理项目封面 URL
        from ..services.supabase_client import get_file_url
        thumb_url = project.get("thumbnail_url")
        if thumb_url and not thumb_url.startswith(('http://', 'https://')):
            try:
                project["thumbnail_url"] = get_file_url("clips", thumb_url)
            except Exception as e:
                logger.warning(f"[Projects] 生成项目封面 URL 失败: {e}")
                project["thumbnail_url"] = None
        
        total_time = (time.time() - start_time) * 1000
        logger.info(f"[GetProject] ✅ 总耗时: {total_time:.0f}ms")
        
        # ★ 统一使用 timeline 包含 tracks/clips/keyframes，避免冗余
        return {
            **project,
            "timeline": timeline,
            "duration": duration,
            "assets": assets,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{project_id}")
async def update_project(
    project_id: str,
    request: ProjectUpdate,
    user_id: str = Depends(get_current_user_id)
):
    """更新项目基本信息"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        update_data = {}
        
        if request.name is not None:
            update_data["name"] = request.name
        if request.description is not None:
            update_data["description"] = request.description
        if request.thumbnail_url is not None:
            update_data["thumbnail_url"] = request.thumbnail_url
        if request.status is not None:
            update_data["status"] = request.status
        if request.resolution is not None:
            update_data["resolution"] = request.resolution
        if request.fps is not None:
            update_data["fps"] = request.fps
        if request.wizard_completed is not None:
            update_data["wizard_completed"] = request.wizard_completed
        
        update_data["updated_at"] = datetime.utcnow().isoformat()
        
        result = supabase.table("projects").update(update_data).eq("id", project_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="项目不存在")
        
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 批量删除项目辅助函数（优化版 V3 - 支持级联删除）
# ============================================

# 配置：是否使用数据库级联删除（需要运行迁移 20260119_cascade_delete.sql）
USE_CASCADE_DELETE = True


async def _delete_project_data_legacy(project_id: str) -> None:
    """删除单个项目的所有关联数据（旧版：手动删除，不依赖级联）"""
    # 1. 获取所有轨道 ID
    tracks = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
    track_ids = [t["id"] for t in tracks.data] if tracks.data else []
    
    # 2. 批量获取所有 clip ID
    clip_ids = []
    if track_ids:
        clips = supabase.table("clips").select("id").in_("track_id", track_ids).execute()
        clip_ids = [c["id"] for c in clips.data] if clips.data else []
    
    # 3. 批量删除关键帧
    if clip_ids:
        supabase.table("keyframes").delete().in_("clip_id", clip_ids).execute()
    
    # 4. 批量删除片段
    if track_ids:
        supabase.table("clips").delete().in_("track_id", track_ids).execute()
    
    # 5. 删除其他关联数据
    supabase.table("tracks").delete().eq("project_id", project_id).execute()
    supabase.table("assets").delete().eq("project_id", project_id).execute()
    supabase.table("snapshots").delete().eq("project_id", project_id).execute()
    supabase.table("exports").delete().eq("project_id", project_id).execute()
    supabase.table("tasks").delete().eq("project_id", project_id).execute()
    supabase.table("projects").delete().eq("id", project_id).execute()


async def _delete_project_data(project_id: str) -> None:
    """删除项目（利用级联删除，只需一条 SQL）"""
    if USE_CASCADE_DELETE:
        # V3: 级联删除 - 数据库自动清理所有关联数据
        supabase.table("projects").delete().eq("id", project_id).execute()
    else:
        # 回退到旧版手动删除
        await _delete_project_data_legacy(project_id)


async def _delete_single_project(project_id: str, user_id: str) -> dict:
    """删除单个项目及其关联数据，返回删除结果"""
    try:
        # 验证用户权限
        result = supabase.table("projects").select("id, user_id").eq("id", project_id).single().execute()
        if not result.data:
            return {"id": project_id, "success": False, "error": "项目不存在"}
        if result.data.get("user_id") != user_id:
            return {"id": project_id, "success": False, "error": "无权删除此项目"}
        
        await _delete_project_data(project_id)
        return {"id": project_id, "success": True}
    except Exception as e:
        return {"id": project_id, "success": False, "error": str(e)}


class BatchDeleteRequest(BaseModel):
    project_ids: list[str]


@router.post("/batch-delete")
async def batch_delete_projects(
    request: BatchDeleteRequest,
    user_id: str = Depends(get_current_user_id)
):
    """批量删除项目（优化版 V2：批量权限校验 + 并行删除）"""
    import asyncio
    
    if not request.project_ids:
        raise HTTPException(status_code=400, detail="请提供要删除的项目 ID 列表")
    
    if len(request.project_ids) > 50:
        raise HTTPException(status_code=400, detail="单次最多删除 50 个项目")
    
    # 1. 批量权限校验（一次 SQL 查询所有项目）
    projects_result = supabase.table("projects").select("id, user_id").in_("id", request.project_ids).execute()
    existing_projects = {p["id"]: p["user_id"] for p in projects_result.data} if projects_result.data else {}
    
    # 2. 分类：有权限的、无权限的、不存在的
    authorized_ids = []
    results = []
    
    for pid in request.project_ids:
        if pid not in existing_projects:
            results.append({"id": pid, "success": False, "error": "项目不存在"})
        elif existing_projects[pid] != user_id:
            results.append({"id": pid, "success": False, "error": "无权删除此项目"})
        else:
            authorized_ids.append(pid)
    
    # 3. 并行删除有权限的项目
    if authorized_ids:
        async def delete_one(pid: str):
            try:
                await _delete_project_data(pid)
                return {"id": pid, "success": True}
            except Exception as e:
                return {"id": pid, "success": False, "error": str(e)}
        
        delete_tasks = [delete_one(pid) for pid in authorized_ids]
        delete_results = await asyncio.gather(*delete_tasks)
        results.extend(delete_results)
    
    # 4. 统计结果
    success_count = sum(1 for r in results if r["success"])
    fail_count = len(results) - success_count
    
    return {
        "success": True,
        "message": f"成功删除 {success_count} 个项目" + (f"，{fail_count} 个失败" if fail_count > 0 else ""),
        "results": results,
        "success_count": success_count,
        "fail_count": fail_count
    }


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除项目及关联数据"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        # 获取所有轨道
        tracks = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
        
        # 删除所有片段及其关键帧（优化：批量操作）
        if tracks.data:
            track_ids = [t["id"] for t in tracks.data]
            # 一次性获取所有 clip ids
            clips = supabase.table("clips").select("id").in_("track_id", track_ids).execute()
            if clips.data:
                clip_ids = [c["id"] for c in clips.data]
                # 批量删除关键帧
                supabase.table("keyframes").delete().in_("clip_id", clip_ids).execute()
            # 批量删除 clips
            supabase.table("clips").delete().in_("track_id", track_ids).execute()
        
        # 删除轨道
        supabase.table("tracks").delete().eq("project_id", project_id).execute()
        
        # 删除资源
        supabase.table("assets").delete().eq("project_id", project_id).execute()
        
        # 删除快照
        supabase.table("snapshots").delete().eq("project_id", project_id).execute()
        
        # 删除导出
        supabase.table("exports").delete().eq("project_id", project_id).execute()
        
        # 删除任务
        supabase.table("tasks").delete().eq("project_id", project_id).execute()
        
        # 删除项目
        result = supabase.table("projects").delete().eq("id", project_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="项目不存在")
        
        return {"success": True, "message": "项目已删除"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 轨道管理
# ============================================

@router.post("/{project_id}/tracks")
async def create_track(
    project_id: str,
    track_data: dict,
    user_id: str = Depends(get_current_user_id)
):
    """创建轨道"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        track_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 获取当前最大 order_index
        existing = supabase.table("tracks").select("order_index").eq("project_id", project_id).order("order_index", desc=True).limit(1).execute()
        max_order = existing.data[0]["order_index"] if existing.data else -1
        
        track = {
            "id": track_id,
            "project_id": project_id,
            "name": track_data.get("name", "Track"),
            "order_index": track_data.get("order_index", max_order + 1),
            "is_visible": track_data.get("is_visible", True),
            "is_locked": track_data.get("is_locked", False),
            "is_muted": track_data.get("is_muted", False),
            "adjustment_params": track_data.get("adjustment_params"),
            "created_at": now,
            "updated_at": now,
        }
        
        result = supabase.table("tracks").insert(track).execute()
        
        # 更新项目时间戳
        supabase.table("projects").update({"updated_at": now}).eq("id", project_id).execute()
        
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{project_id}/tracks/{track_id}")
async def update_track(
    project_id: str,
    track_id: str,
    track_data: dict,
    user_id: str = Depends(get_current_user_id)
):
    """更新轨道"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        now = datetime.utcnow().isoformat()
        
        update_data = {"updated_at": now}
        
        for field in ["name", "type", "order_index", "is_visible", "is_locked", "is_muted", "adjustment_params"]:
            if field in track_data:
                update_data[field] = track_data[field]
        
        result = supabase.table("tracks").update(update_data).eq("id", track_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="轨道不存在")
        
        # 更新项目时间戳
        supabase.table("projects").update({"updated_at": now}).eq("id", project_id).execute()
        
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{project_id}/tracks/{track_id}")
async def delete_track(
    project_id: str,
    track_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除轨道及其片段"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        # 获取轨道上的所有 clips
        clips = supabase.table("clips").select("id").eq("track_id", track_id).execute()
        if clips.data:
            # 批量删除关键帧（使用 in_() 避免 N+1 问题）
            clip_ids = [c["id"] for c in clips.data]
            supabase.table("keyframes").delete().in_("clip_id", clip_ids).execute()
        
        # 删除轨道上的所有片段
        supabase.table("clips").delete().eq("track_id", track_id).execute()
        
        # 删除轨道
        result = supabase.table("tracks").delete().eq("id", track_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="轨道不存在")
        
        # 更新项目时间戳
        supabase.table("projects").update({"updated_at": datetime.utcnow().isoformat()}).eq("id", project_id).execute()
        
        return {"success": True, "message": "轨道已删除"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 片段管理
# ============================================

@router.post("/{project_id}/clips")
async def create_clip(
    project_id: str,
    clip_data: dict,
    user_id: str = Depends(get_current_user_id)
):
    """创建片段"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        clip_id = clip_data.get("id") or str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 计算 end_time
        start_time = clip_data.get("start_time", clip_data.get("start", 0))
        duration = clip_data.get("duration", 0)
        end_time = clip_data.get("end_time", start_time + duration)
        
        clip = {
            "id": clip_id,
            "track_id": clip_data.get("track_id"),
            "asset_id": clip_data.get("asset_id"),
            "start_time": start_time,
            "end_time": end_time,
            "source_start": clip_data.get("source_start", clip_data.get("trim_start", 0)),
            "source_end": clip_data.get("source_end"),
            "volume": clip_data.get("volume", 1.0),
            "is_muted": clip_data.get("is_muted", clip_data.get("muted", False)),
            "transform": clip_data.get("transform"),
            "transition_in": clip_data.get("transition_in"),
            "transition_out": clip_data.get("transition_out"),
            "speed": clip_data.get("speed", 1.0),
            "parent_clip_id": clip_data.get("parent_clip_id"),
            "subtitle_text": clip_data.get("subtitle_text"),
            "subtitle_style": clip_data.get("subtitle_style"),
            "cached_url": clip_data.get("url", clip_data.get("cached_url")),
            "created_at": now,
            "updated_at": now,
        }
        
        result = supabase.table("clips").insert(clip).execute()
        
        # 更新项目时间戳
        supabase.table("projects").update({"updated_at": now}).eq("id", project_id).execute()
        
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{project_id}/clips/{clip_id}")
async def update_clip(
    project_id: str,
    clip_id: str,
    clip_data: dict,
    user_id: str = Depends(get_current_user_id)
):
    """更新片段"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        now = datetime.utcnow().isoformat()
        
        update_data = {"updated_at": now}
        
        # 字段映射
        field_mapping = {
            "start": "start_time",
            "trim_start": "source_start",
            "muted": "is_muted",
            "url": "cached_url",
        }
        
        for key, value in clip_data.items():
            if key == "id":
                continue
            
            # 处理 duration -> end_time
            if key == "duration" and "start_time" in clip_data:
                update_data["end_time"] = clip_data["start_time"] + value
            elif key == "duration" and "start" in clip_data:
                update_data["end_time"] = clip_data["start"] + value
            elif key in field_mapping:
                update_data[field_mapping[key]] = value
            elif key in ["track_id", "asset_id", "start_time", "end_time", "source_start", "source_end", 
                        "volume", "is_muted", "transform", "transition_in", "transition_out", 
                        "speed", "parent_clip_id", "subtitle_text", "subtitle_style", "cached_url"]:
                update_data[key] = value
        
        result = supabase.table("clips").update(update_data).eq("id", clip_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="片段不存在")
        
        # 更新项目时间戳
        supabase.table("projects").update({"updated_at": now}).eq("id", project_id).execute()
        
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{project_id}/clips/{clip_id}")
async def delete_clip(
    project_id: str,
    clip_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除片段"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        # 先删除关联的关键帧
        supabase.table("keyframes").delete().eq("clip_id", clip_id).execute()
        
        result = supabase.table("clips").delete().eq("id", clip_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="片段不存在")
        
        # 更新项目时间戳
        supabase.table("projects").update({"updated_at": datetime.utcnow().isoformat()}).eq("id", project_id).execute()
        
        return {"success": True, "message": "片段已删除"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 批量操作
# ============================================

@router.post("/{project_id}/clips/batch")
async def batch_clips_operation(
    project_id: str,
    request: dict,
    user_id: str = Depends(get_current_user_id)
):
    """批量片段操作"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        operation = request.get("operation")
        clips_data = request.get("clips", [])
        now = datetime.utcnow().isoformat()
        
        results = []
        
        if operation == "create":
            for clip_data in clips_data:
                clip_id = clip_data.get("id") or str(uuid4())
                start_time = clip_data.get("start_time", clip_data.get("start", 0))
                duration = clip_data.get("duration", 0)
                end_time = clip_data.get("end_time", start_time + duration)
                
                clip = {
                    "id": clip_id,
                    "track_id": clip_data.get("track_id"),
                    "asset_id": clip_data.get("asset_id"),
                    "start_time": start_time,
                    "end_time": end_time,
                    "source_start": clip_data.get("source_start", 0),
                    "source_end": clip_data.get("source_end"),
                    "volume": clip_data.get("volume", 1.0),
                    "is_muted": clip_data.get("is_muted", False),
                    "speed": clip_data.get("speed", 1.0),
                    "cached_url": clip_data.get("url"),
                    "created_at": now,
                    "updated_at": now,
                }
                result = supabase.table("clips").insert(clip).execute()
                if result.data:
                    results.append(result.data[0])
        
        elif operation == "update":
            for clip_data in clips_data:
                clip_id = clip_data.get("id")
                if not clip_id:
                    continue
                
                update_data = {"updated_at": now}
                for key in ["track_id", "start_time", "end_time", "source_start", "source_end", 
                           "volume", "is_muted", "speed"]:
                    if key in clip_data:
                        update_data[key] = clip_data[key]
                
                result = supabase.table("clips").update(update_data).eq("id", clip_id).execute()
                if result.data:
                    results.append(result.data[0])
        
        elif operation == "delete":
            clip_ids = [c.get("id") for c in clips_data if c.get("id")]
            if clip_ids:
                # 批量删除关联的关键帧
                supabase.table("keyframes").delete().in_("clip_id", clip_ids).execute()
                # 批量删除 clips
                supabase.table("clips").delete().in_("id", clip_ids).execute()
                results.extend([{"id": cid, "deleted": True} for cid in clip_ids])
        
        # 更新项目时间戳
        supabase.table("projects").update({"updated_at": now}).eq("id", project_id).execute()
        
        return {"success": True, "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 快照管理
# ============================================

@router.get("/{project_id}/snapshots")
async def list_snapshots(project_id: str, limit: int = 20):
    """获取项目快照列表"""
    try:
        result = supabase.table("snapshots").select(
            "id, version, description, created_at"
        ).eq("project_id", project_id).order("version", desc=True).limit(limit).execute()
        
        return {"snapshots": result.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project_id}/snapshots")
async def create_snapshot(
    project_id: str,
    request: dict,
    user_id: str = Depends(get_current_user_id)
):
    """创建项目快照"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        # 获取当前最大版本号
        existing = supabase.table("snapshots").select("version").eq("project_id", project_id).order("version", desc=True).limit(1).execute()
        max_version = existing.data[0]["version"] if existing.data else 0
        
        # 获取当前项目状态
        project = await get_project(project_id, user_id)
        
        snapshot_data = {
            "id": str(uuid4()),
            "project_id": project_id,
            "user_id": user_id,  # 使用认证用户ID
            "version": max_version + 1,
            "state": {
                "tracks": project.get("tracks", []),
                "clips": project.get("clips", []),
                "resolution": project.get("resolution"),
                "fps": project.get("fps"),
            },
            "description": request.get("description", "手动保存"),
            "created_at": datetime.utcnow().isoformat(),
        }
        
        result = supabase.table("snapshots").insert(snapshot_data).execute()
        
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project_id}/snapshots/{snapshot_id}/restore")
async def restore_snapshot(
    project_id: str,
    snapshot_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """恢复到指定快照"""
    try:
        # 验证用户权限
        await verify_project_access(project_id, user_id)
        
        # 获取快照
        snapshot = supabase.table("snapshots").select("*").eq("id", snapshot_id).single().execute()
        
        if not snapshot.data:
            raise HTTPException(status_code=404, detail="快照不存在")
        
        state = snapshot.data.get("state", {})
        now = datetime.utcnow().isoformat()
        
        # 删除当前所有轨道和片段（优化：批量操作）
        tracks = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
        track_ids = [t["id"] for t in tracks.data] if tracks.data else []
        if track_ids:
            supabase.table("clips").delete().in_("track_id", track_ids).execute()
        supabase.table("tracks").delete().eq("project_id", project_id).execute()
        
        # 恢复轨道（批量插入）
        tracks_data = state.get("tracks", [])
        if tracks_data:
            for track in tracks_data:
                track["created_at"] = now
                track["updated_at"] = now
            supabase.table("tracks").insert(tracks_data).execute()
        
        # 恢复片段（批量插入）
        clips_data = state.get("clips", [])
        if clips_data:
            for clip in clips_data:
                clip["created_at"] = now
                clip["updated_at"] = now
            supabase.table("clips").insert(clips_data).execute()
        
        # 更新项目
        supabase.table("projects").update({
            "resolution": state.get("resolution", {"width": 1920, "height": 1080}),
            "fps": state.get("fps", 30),
            "updated_at": now,
        }).eq("id", project_id).execute()
        
        return {"success": True, "message": f"已恢复到版本 {snapshot.data['version']}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 项目状态保存（核心接口）
# ============================================

@router.patch("/{project_id}/state")
async def save_project_state(project_id: str, request: dict):
    """
    保存项目状态（核心接口）
    前端通过此接口实时保存编辑状态
    
    ★ 优化：使用批量操作减少数据库请求次数
    ★ 新增：自动重试 HTTP/2 断连错误
    """
    import asyncio
    import time
    import httpx
    
    MAX_RETRIES = 3  # 最大重试次数
    
    start_time = time.time()
    
    try:
        now = datetime.utcnow().isoformat()
        
        changes = request.get("changes", {})
        client_version = request.get("version", 0)
        
        # UUID 验证函数
        import re
        uuid_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)
        def is_valid_uuid(val):
            return bool(val and uuid_pattern.match(str(val)))
        
        t1 = time.time()
        
        # ★ 优化：一次性查询所有需要的数据（带重试）
        def _fetch_all():
            # 查项目（必须）
            project = supabase.table("projects").select("id").eq("id", project_id).single().execute()
            if not project.data:
                return None, set(), set(), set()
            
            # 查现有 tracks
            tracks = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
            track_ids = {t["id"] for t in tracks.data} if tracks.data else set()
            
            # 查现有 clips 和 keyframes（如果有 tracks）
            clip_ids = set()
            kf_ids = set()
            if track_ids:
                clips = supabase.table("clips").select("id").in_("track_id", list(track_ids)).execute()
                clip_ids = {c["id"] for c in clips.data} if clips.data else set()
                
                if clip_ids:
                    kfs = supabase.table("keyframes").select("id").in_("clip_id", list(clip_ids)).execute()
                    kf_ids = {k["id"] for k in kfs.data} if kfs.data else set()
            
            return project.data, track_ids, clip_ids, kf_ids
        
        # ★ 带重试的查询
        for attempt in range(MAX_RETRIES):
            try:
                project, existing_track_ids, existing_clip_ids, existing_kf_ids = await asyncio.to_thread(_fetch_all)
                break
            except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError) as e:
                if attempt < MAX_RETRIES - 1:
                    logger.warning(f"[Projects] 查询断连，重试 {attempt + 1}/{MAX_RETRIES}: {e}")
                    await asyncio.sleep(0.5 * (attempt + 1))
                else:
                    raise
        
        t2 = time.time()
        logger.debug(f"[Projects] 查询耗时: {(t2-t1)*1000:.0f}ms")
        
        if project is None:
            raise HTTPException(status_code=404, detail="项目不存在")
        
        # ★ 收集批量操作
        tracks_to_update = []
        tracks_to_insert = []
        clips_to_update = []
        clips_to_insert = []
        kf_to_upsert = []
        
        frontend_clip_ids = set()
        frontend_kf_ids = set()
        
        # 处理轨道
        if "tracks" in changes:
            for track in changes["tracks"]:
                track_id = track.get("id")
                if not track_id:
                    continue
                
                track_data = {
                    "id": track_id,
                    "project_id": project_id,
                    "name": track.get("name", "Track"),
                    "order_index": track.get("orderIndex", track.get("order_index", 0)),
                    "is_muted": track.get("isMuted", track.get("is_muted", False)),
                    "is_locked": track.get("isLocked", track.get("is_locked", False)),
                    "is_visible": track.get("isVisible", track.get("is_visible", True)),
                    "updated_at": now,
                }
                
                if track_id in existing_track_ids:
                    tracks_to_update.append(track_data)
                else:
                    track_data["created_at"] = now
                    tracks_to_insert.append(track_data)
        
        # 处理片段
        if "clips" in changes:
            for clip in changes["clips"]:
                clip_id = clip.get("id")
                if not clip_id or not is_valid_uuid(clip_id):
                    continue
                
                track_id = clip.get("trackId", clip.get("track_id"))
                if not is_valid_uuid(track_id):
                    continue
                
                frontend_clip_ids.add(clip_id)
                
                # 时间计算
                start_time = int(clip.get("start", clip.get("start_time", 0)))
                duration = int(clip.get("duration", 0))
                end_time = start_time + duration if duration > 0 else int(clip.get("end_time", start_time + 1000))
                if end_time <= start_time:
                    end_time = start_time + 1000
                source_start = int(clip.get("sourceStart", clip.get("source_start", 0)))
                source_end = clip.get("source_end")
                source_end = int(source_end) if source_end else None
                
                clip_data = {
                    "id": clip_id,
                    "track_id": track_id,
                    "asset_id": clip.get("assetId", clip.get("asset_id")),
                    "clip_type": clip.get("clipType", clip.get("clip_type", "video")),
                    "start_time": start_time,
                    "end_time": end_time,
                    "source_start": source_start,
                    "source_end": source_end,
                    "is_muted": clip.get("isMuted", clip.get("is_muted", False)),
                    "volume": clip.get("volume", 1.0),
                    "speed": clip.get("speed", 1.0),
                    "content_text": clip.get("text", clip.get("contentText", clip.get("content_text"))),
                    "text_style": clip.get("textStyle", clip.get("text_style")),
                    "effect_type": clip.get("effectType", clip.get("effect_type")),
                    "effect_params": clip.get("effectParams", clip.get("effect_params")),
                    "voice_params": clip.get("voiceParams", clip.get("voice_params")),
                    "sticker_id": clip.get("stickerId", clip.get("sticker_id")),
                    "transform": clip.get("transform"),
                    "name": clip.get("name"),
                    "color": clip.get("color"),
                    "parent_clip_id": clip.get("parentClipId", clip.get("parent_clip_id")),
                    "updated_at": now,
                }
                
                if clip_id in existing_clip_ids:
                    clips_to_update.append(clip_data)
                else:
                    clip_data["created_at"] = now
                    clips_to_insert.append(clip_data)
        
        # 处理关键帧
        if "keyframes" in changes:
            for kf in changes["keyframes"]:
                kf_id = kf.get("id")
                clip_id = kf.get("clipId", kf.get("clip_id"))
                if not kf_id or not clip_id:
                    continue
                
                frontend_kf_ids.add(kf_id)
                
                kf_offset = float(kf.get("offset", 0))
                kf_offset = max(0, min(1, kf_offset))
                
                kf_data = {
                    "id": kf_id,
                    "clip_id": clip_id,
                    "property": kf.get("property"),
                    "offset": kf_offset,
                    "value": kf.get("value"),
                    "easing": kf.get("easing", "linear"),
                    "updated_at": now,
                    "created_at": now,
                }
                kf_to_upsert.append(kf_data)
        
        t3 = time.time()
        
        # ★ 执行批量操作（使用 upsert 一次性处理）
        def _batch_save():
            # Tracks: 使用 upsert
            all_tracks = tracks_to_insert + tracks_to_update
            if all_tracks:
                supabase.table("tracks").upsert(all_tracks, on_conflict="id").execute()
            
            # Clips: 使用 upsert
            all_clips = clips_to_insert + clips_to_update
            if all_clips:
                # 移除 None 值
                cleaned_clips = []
                for c in all_clips:
                    cleaned_clips.append({k: v for k, v in c.items() if v is not None})
                supabase.table("clips").upsert(cleaned_clips, on_conflict="id").execute()
            
            # 删除被移除的 clips
            clips_to_delete = existing_clip_ids - frontend_clip_ids
            if clips_to_delete and "clips" in changes:
                supabase.table("keyframes").delete().in_("clip_id", list(clips_to_delete)).execute()
                supabase.table("clips").delete().in_("id", list(clips_to_delete)).execute()
            
            # Keyframes: 使用 upsert
            if kf_to_upsert:
                supabase.table("keyframes").upsert(kf_to_upsert, on_conflict="id").execute()
            
            # 删除被移除的 keyframes
            kf_to_delete = existing_kf_ids - frontend_kf_ids
            if kf_to_delete and "keyframes" in changes:
                supabase.table("keyframes").delete().in_("id", list(kf_to_delete)).execute()
            
            # 更新项目时间戳
            supabase.table("projects").update({"updated_at": now}).eq("id", project_id).execute()
        
        # ★ 带重试的保存
        for attempt in range(MAX_RETRIES):
            try:
                await asyncio.to_thread(_batch_save)
                break
            except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError) as e:
                if attempt < MAX_RETRIES - 1:
                    logger.warning(f"[Projects] 保存断连，重试 {attempt + 1}/{MAX_RETRIES}: {e}")
                    await asyncio.sleep(0.5 * (attempt + 1))
                else:
                    raise
        
        t4 = time.time()
        total_ms = (t4 - start_time) * 1000
        query_ms = (t2 - t1) * 1000
        prep_ms = (t3 - t2) * 1000
        save_ms = (t4 - t3) * 1000
        
        logger.info(f"[Projects] state 保存完成: 总耗时={total_ms:.0f}ms (查询={query_ms:.0f}ms, 准备={prep_ms:.0f}ms, 写入={save_ms:.0f}ms)")
        
        return {
            "success": True,
            "version": client_version + 1,
            "saved_at": now,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[Projects] save_project_state: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
