"""
HoppingRabbit AI - Clips API
适配新表结构 (2026-01-07)

新表字段变化：
- 移除: duration, name, is_deleted, effects, metadata, project_id
- 新增: end_time (替代 duration), cached_url
- 重命名: muted → is_muted, source_start/source_end (原 trim_start)
- 关联: 通过 track_id 关联项目（无直接 project_id）

时间单位规范（统一毫秒）：
- 前端传输：毫秒（int）
- 数据库存储：毫秒（int）
- API 输入输出：毫秒（无需转换）
- 前端展示时自行转换为秒
"""
import logging
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from typing import Optional, List
from datetime import datetime
from uuid import uuid4
from pydantic import BaseModel

from ..services.supabase_client import supabase, get_file_url
from .auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clips", tags=["Clips"])


# ============================================
# 请求/响应模型（适配新表）
# ============================================

class ClipCreate(BaseModel):
    id: Optional[str] = None
    track_id: str
    asset_id: Optional[str] = None
    parent_clip_id: Optional[str] = None
    start_time: float = 0
    end_time: Optional[float] = None  # 新字段
    duration: Optional[float] = None  # 兼容字段，用于计算 end_time
    source_start: float = 0
    source_end: Optional[float] = None
    volume: float = 1.0
    is_muted: bool = False  # 新字段名
    transform: Optional[dict] = None
    transition_in: Optional[dict] = None
    transition_out: Optional[dict] = None
    speed: float = 1.0
    subtitle_text: Optional[str] = None
    subtitle_style: Optional[dict] = None
    cached_url: Optional[str] = None


class ClipUpdate(BaseModel):
    track_id: Optional[str] = None
    asset_id: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    duration: Optional[float] = None  # 兼容字段
    source_start: Optional[float] = None
    source_end: Optional[float] = None
    volume: Optional[float] = None
    is_muted: Optional[bool] = None  # 新字段名
    transform: Optional[dict] = None
    transition_in: Optional[dict] = None
    transition_out: Optional[dict] = None
    speed: Optional[float] = None
    subtitle_text: Optional[str] = None
    subtitle_style: Optional[dict] = None
    cached_url: Optional[str] = None


class BatchClipUpdate(BaseModel):
    id: str
    updates: ClipUpdate


class BatchOperation(BaseModel):
    creates: Optional[List[ClipCreate]] = None
    updates: Optional[List[BatchClipUpdate]] = None
    deletes: Optional[List[str]] = None


class SegmentToClipCreate(BaseModel):
    """将 ASR segment 转换为 clip 的请求"""
    id: Optional[str] = None
    text: str
    start: int  # 毫秒
    end: int    # 毫秒
    speaker: Optional[str] = None


class ASRToClipsRequest(BaseModel):
    """批量创建 subtitle clips 的请求"""
    project_id: str
    track_id: str
    asset_id: Optional[str] = None  # 关联的原始素材
    segments: List[SegmentToClipCreate]
    clip_type: str = "subtitle"  # 默认是 subtitle 类型


# ============================================
# 查询接口
# ============================================

async def verify_project_access_by_track(track_id: str, user_id: str) -> str:
    """通过 track_id 验证用户权限，返回 project_id"""
    # 获取轨道对应的项目
    track = supabase.table("tracks").select("project_id").eq("id", track_id).single().execute()
    if not track.data:
        raise HTTPException(status_code=404, detail="轨道不存在")
    
    project_id = track.data["project_id"]
    
    # 验证项目归属
    project = supabase.table("projects").select("user_id").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    if project.data["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="无权访问此项目")
    
    return project_id


async def verify_project_access(project_id: str, user_id: str) -> dict:
    """验证用户是否有权限访问项目"""
    project = supabase.table("projects").select("*").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    if project.data["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="无权访问此项目")
    
    return project.data

@router.get("")
async def list_clips(
    track_id: Optional[str] = None,
    project_id: Optional[str] = None,
    clip_type: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    """获取片段列表 - 支持按 project_id 或 track_id 查询"""
    try:
        if track_id:
            # 验证用户权限
            await verify_project_access_by_track(track_id, user_id)
            
            # 直接按轨道查询
            query = supabase.table("clips").select("*").eq("track_id", track_id)
            if clip_type:
                query = query.eq("clip_type", clip_type)
            result = query.order("start_time").execute()
            clips = result.data or []
            return {"items": clips, "total": len(clips)}
            
        elif project_id:
            # 验证用户权限
            await verify_project_access(project_id, user_id)
            
            # 按项目查询（先获取轨道，再一次性查询所有 clips）
            tracks = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
            if not tracks.data:
                return {"items": [], "total": 0}
            
            track_ids = [t["id"] for t in tracks.data]
            query = supabase.table("clips").select("*").in_("track_id", track_ids)
            if clip_type:
                query = query.eq("clip_type", clip_type)
            result = query.order("start_time").execute()
            clips = result.data or []
            
            return {"items": clips, "total": len(clips)}
        else:
            raise HTTPException(status_code=400, detail="需要提供 track_id 或 project_id")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{clip_id}")
async def get_clip(
    clip_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """获取单个片段详情 - 统一毫秒"""
    try:
        result = supabase.table("clips").select("*").eq("id", clip_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="片段不存在")
        
        clip = result.data
        
        # 获取关联资源信息
        if clip.get("asset_id"):
            asset = supabase.table("assets").select("storage_path, original_filename, file_type").eq(
                "id", clip["asset_id"]
            ).single().execute()
            if asset.data:
                clip["asset"] = asset.data
                clip["url"] = get_file_url("clips", asset.data["storage_path"])
        
        return clip
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 创建接口
# ============================================

@router.post("")
async def create_clip(
    request: ClipCreate,
    user_id: str = Depends(get_current_user_id)
):
    """创建新片段 - 统一毫秒"""
    try:
        clip_id = request.id or str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 计算 end_time（毫秒）
        end_time = request.end_time
        if end_time is None and request.duration is not None:
            end_time = request.start_time + request.duration
        elif end_time is None:
            end_time = request.start_time
        
        # 直接存储毫秒
        clip_data = {
            "id": clip_id,
            "track_id": request.track_id,
            "asset_id": request.asset_id,
            "parent_clip_id": request.parent_clip_id,
            "start_time": int(request.start_time),
            "end_time": int(end_time),
            "source_start": int(request.source_start) if request.source_start else 0,
            "source_end": int(request.source_end) if request.source_end else None,
            "volume": request.volume,
            "is_muted": request.is_muted,
            "transform": request.transform,
            "transition_in": request.transition_in,
            "transition_out": request.transition_out,
            "speed": request.speed,
            "subtitle_text": request.subtitle_text,
            "subtitle_style": request.subtitle_style,
            "cached_url": request.cached_url,
            "created_at": now,
            "updated_at": now,
        }
        
        result = supabase.table("clips").insert(clip_data).execute()
        
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/split")
async def split_clip(
    clip_id: str,
    split_time: int,
    user_id: str = Depends(get_current_user_id)
):
    """分割片段 - 统一毫秒"""
    try:
        original = supabase.table("clips").select("*").eq("id", clip_id).single().execute()
        
        if not original.data:
            raise HTTPException(status_code=404, detail="片段不存在")
        
        clip = original.data
        clip_duration = clip["end_time"] - clip["start_time"]
        
        # 验证分割点（split_time 是毫秒）
        relative_time = split_time - clip["start_time"]
        if relative_time <= 100 or relative_time >= clip_duration - 100:  # 100ms 最小间隔
            raise HTTPException(status_code=400, detail="分割点无效")
        
        now = datetime.utcnow().isoformat()
        
        # 创建后半部分
        new_clip_id = str(uuid4())
        new_source_start = (clip.get("source_start") or 0) + relative_time
        
        new_clip = {
            "id": new_clip_id,
            "track_id": clip["track_id"],
            "asset_id": clip.get("asset_id"),
            "parent_clip_id": clip_id,
            "start_time": split_time,
            "end_time": clip["end_time"],
            "source_start": new_source_start,
            "source_end": clip.get("source_end"),
            "volume": clip.get("volume", 1.0),
            "is_muted": clip.get("is_muted", False),
            "speed": clip.get("speed", 1.0),
            "cached_url": clip.get("cached_url"),
            "created_at": now,
            "updated_at": now,
        }
        
        # 更新原片段
        update_original = {
            "end_time": split_time,
            "source_end": new_source_start,
            "updated_at": now,
        }
        
        supabase.table("clips").update(update_original).eq("id", clip_id).execute()
        result = supabase.table("clips").insert(new_clip).execute()
        
        original_updated = {**clip, **update_original}
        new_created = result.data[0]
        
        return {
            "original": original_updated,
            "new": new_created,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 智能拆分接口
# ============================================

class SplitSegmentItem(BaseModel):
    """拆分片段项"""
    start_ms: int
    end_ms: int
    transcript: str
    confidence: float


class AnalyzeSplitRequest(BaseModel):
    """分析拆分请求"""
    strategy: str = "sentence"  # sentence | scene | paragraph


class AnalyzeSplitResponse(BaseModel):
    """分析拆分响应"""
    can_split: bool
    reason: str
    segment_count: int
    segments: List[SplitSegmentItem]
    split_strategy: str


class ExecuteSplitRequest(BaseModel):
    """执行拆分请求"""
    segments: List[SplitSegmentItem]


class AnalyzeSplitTaskResponse(BaseModel):
    """分析拆分任务响应 - 异步模式"""
    task_id: str
    status: str  # pending | running | completed | failed


class DirectSplitRequest(BaseModel):
    """直接拆分请求（分析+执行一步完成）"""
    strategy: str = "sentence"  # sentence | scene | paragraph


@router.post("/{clip_id}/split")
async def direct_clip_split(
    clip_id: str,
    request: DirectSplitRequest = DirectSplitRequest(),
    background_tasks: BackgroundTasks = None,
    user_id: str = Depends(get_current_user_id)
):
    """
    直接拆分 Clip（分析+执行一步完成）
    
    异步模式：返回 task_id，前端轮询获取结果
    """
    from uuid import uuid4
    from datetime import datetime
    
    task_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    
    try:
        # 验证 clip 存在
        clip_result = supabase.table("clips").select("id, track_id").eq("id", clip_id).single().execute()
        if not clip_result.data:
            raise HTTPException(status_code=404, detail="Clip 不存在")
        
        # 获取 project_id
        track_id = clip_result.data.get("track_id")
        project_id = None
        if track_id:
            track_result = supabase.table("tracks").select("project_id").eq("id", track_id).single().execute()
            if track_result.data:
                project_id = track_result.data.get("project_id")
        
        # 创建任务记录
        supabase.table("tasks").insert({
            "id": task_id,
            "project_id": project_id,
            "user_id": user_id,
            "task_type": "clip_split",  # ★ 使用明确的任务类型
            "status": "pending",
            "progress": 0,
            "params": {
                "clip_id": clip_id,
                "strategy": request.strategy
            },
            "created_at": now
        }).execute()
        
        # 后台执行分析+拆分
        background_tasks.add_task(
            _execute_direct_split,
            task_id, clip_id, request.strategy
        )
        
        logger.info(f"[ClipSplit] 创建直接拆分任务 {task_id[:8]}... clip={clip_id[:8]}...")
        
        return {"task_id": task_id, "status": "pending"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ClipSplit] 创建任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _execute_direct_split(task_id: str, clip_id: str, strategy: str):
    """
    后台执行直接拆分（分析 + 执行）
    """
    try:
        from ..services.clip_split_service import analyze_clip_for_split, execute_clip_split
        
        # 更新为运行中
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "started_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        # Step 1: 分析
        logger.info(f"[ClipSplit] 开始分析 {clip_id[:8]}... strategy={strategy}")
        analysis = await analyze_clip_for_split(clip_id, supabase, strategy=strategy)
        
        if not analysis.can_split:
            # 无法拆分
            supabase.table("tasks").update({
                "status": "completed",
                "progress": 100,
                "result": {
                    "success": False,
                    "reason": analysis.reason,
                    "clips": []
                },
                "completed_at": datetime.utcnow().isoformat()
            }).eq("id", task_id).execute()
            return
        
        # 更新进度
        supabase.table("tasks").update({
            "progress": 50,
        }).eq("id", task_id).execute()
        
        # Step 2: 执行拆分
        logger.info(f"[ClipSplit] 开始执行拆分 {clip_id[:8]}... segments={len(analysis.segments)}")
        new_clips = await execute_clip_split(clip_id, analysis.segments, supabase)
        
        # 更新为完成
        supabase.table("tasks").update({
            "status": "completed",
            "progress": 100,
            "result": {
                "success": True,
                "message": f"成功拆分为 {len(new_clips)} 个片段",
                "clips": new_clips
            },
            "completed_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        logger.info(f"[ClipSplit] 拆分完成 {task_id[:8]}... new_clips={len(new_clips)}")
        
    except Exception as e:
        logger.error(f"[ClipSplit] 拆分失败 {task_id[:8]}... error={e}")
        import traceback
        traceback.print_exc()
        supabase.table("tasks").update({
            "status": "failed",
            "error_message": str(e),
            "completed_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


@router.post("/{clip_id}/analyze-split")
async def analyze_clip_split(
    clip_id: str,
    request: AnalyzeSplitRequest = AnalyzeSplitRequest(),
    background_tasks: BackgroundTasks = None,
    user_id: str = Depends(get_current_user_id)
):
    """
    分析 Clip 是否可以拆分 - 异步任务模式
    
    策略：
    - sentence: 分句（按语音断句）
    - scene: 分镜（按画面变化）
    - paragraph: 分段落（按语义段落）
    
    返回 task_id，前端轮询 /tasks/{task_id} 获取结果
    避免长时间 HTTP 连接导致的 socket hang up
    """
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 获取 clip 信息以获取 project_id
        clip_result = supabase.table("clips").select(
            "id, track_id"
        ).eq("id", clip_id).single().execute()
        
        if not clip_result.data:
            raise HTTPException(status_code=404, detail="Clip 不存在")
        
        # 通过 track_id 获取 project_id
        track_id = clip_result.data.get("track_id")
        project_id = None
        if track_id:
            track_result = supabase.table("tracks").select("project_id").eq("id", track_id).single().execute()
            if track_result.data:
                project_id = track_result.data.get("project_id")
        
        # 创建任务记录
        # 注意：task_type 使用 smart_clean 以兼容数据库 CHECK 约束
        # result.params 中记录实际类型为 clip_split_analysis
        supabase.table("tasks").insert({
            "id": task_id,
            "project_id": project_id,
            "user_id": user_id,
            "task_type": "smart_clean",
            "status": "pending",
            "progress": 0,
            "params": {
                "actual_type": "clip_split_analysis",
                "clip_id": clip_id,
                "strategy": request.strategy
            },
            "created_at": now
        }).execute()
        
        # 后台执行分析
        background_tasks.add_task(
            _execute_clip_split_analysis,
            task_id, clip_id, request.strategy
        )
        
        logger.info(f"[ClipSplit] 创建分析任务 {task_id[:8]}... clip={clip_id[:8]}...")
        
        return {"task_id": task_id, "status": "pending"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ClipSplit] 创建任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _execute_clip_split_analysis(task_id: str, clip_id: str, strategy: str):
    """
    后台执行 clip split 分析
    结果存入 tasks.result 中
    """
    try:
        # 更新为运行中
        supabase.table("tasks").update({
            "status": "running",
            "progress": 10,
            "started_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        from ..services.clip_split_service import analyze_clip_for_split
        
        # 执行分析
        result = await analyze_clip_for_split(clip_id, supabase, strategy=strategy)
        
        # 构建结果
        analysis_result = {
            "can_split": result.can_split,
            "reason": result.reason,
            "segment_count": result.segment_count,
            "segments": [
                {
                    "start_ms": seg.start_ms,
                    "end_ms": seg.end_ms,
                    "transcript": seg.transcript,
                    "confidence": seg.confidence
                }
                for seg in result.segments
            ],
            "split_strategy": result.split_strategy
        }
        
        # 更新为完成
        supabase.table("tasks").update({
            "status": "completed",
            "progress": 100,
            "result": analysis_result,
            "completed_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()
        
        logger.info(f"[ClipSplit] 任务完成 {task_id[:8]}... segments={result.segment_count}")
        
    except Exception as e:
        logger.error(f"[ClipSplit] 任务失败 {task_id[:8]}... error={e}")
        supabase.table("tasks").update({
            "status": "failed",
            "error_message": str(e),
            "completed_at": datetime.utcnow().isoformat()
        }).eq("id", task_id).execute()


@router.post("/{clip_id}/execute-split")
async def execute_clip_split_api(
    clip_id: str,
    request: ExecuteSplitRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    执行 Clip 拆分
    
    将原始 clip 拆分为多个子 clip
    原始 clip 会被删除，新 clips 保留 parent_clip_id 追溯
    """
    try:
        from ..services.clip_split_service import execute_clip_split, SplitSegment
        
        # 转换请求格式
        segments = [
            SplitSegment(
                start_ms=seg.start_ms,
                end_ms=seg.end_ms,
                transcript=seg.transcript,
                confidence=seg.confidence
            )
            for seg in request.segments
        ]
        
        new_clips = await execute_clip_split(clip_id, segments, supabase)
        
        return {
            "success": True,
            "message": f"成功拆分为 {len(new_clips)} 个片段",
            "clips": new_clips
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 更新接口
# ============================================

@router.patch("/{clip_id}")
async def update_clip(
    clip_id: str,
    request: ClipUpdate,
    user_id: str = Depends(get_current_user_id)
):
    """更新片段 - 统一毫秒"""
    try:
        update_data = request.model_dump(exclude_unset=True)
        
        # 处理 duration -> end_time（毫秒）
        if "duration" in update_data and "start_time" in update_data:
            update_data["end_time"] = update_data["start_time"] + update_data.pop("duration")
        elif "duration" in update_data:
            # 需要获取当前 start_time
            current = supabase.table("clips").select("start_time").eq("id", clip_id).single().execute()
            if current.data:
                update_data["end_time"] = current.data["start_time"] + update_data.pop("duration")
            else:
                update_data.pop("duration")
        
        update_data["updated_at"] = datetime.utcnow().isoformat()
        
        result = supabase.table("clips").update(update_data).eq("id", clip_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="片段不存在")
        
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{clip_id}/move")
async def move_clip(
    clip_id: str,
    track_id: str,
    start_time: int,
    user_id: str = Depends(get_current_user_id)
):
    """移动片段 - 统一毫秒"""
    try:
        # 获取当前片段计算 duration
        current = supabase.table("clips").select("start_time, end_time").eq("id", clip_id).single().execute()
        if not current.data:
            raise HTTPException(status_code=404, detail="片段不存在")
        
        duration = current.data["end_time"] - current.data["start_time"]
        
        update_data = {
            "track_id": track_id,
            "start_time": start_time,
            "end_time": start_time + duration,
            "updated_at": datetime.utcnow().isoformat(),
        }
        
        result = supabase.table("clips").update(update_data).eq("id", clip_id).execute()
        
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 删除接口
# ============================================

@router.delete("/{clip_id}")
async def delete_clip(
    clip_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除片段（硬删除，新表无 is_deleted）"""
    try:
        result = supabase.table("clips").delete().eq("id", clip_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="片段不存在")
        
        return {"success": True, "id": clip_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 批量操作接口
# ============================================

@router.post("/batch")
async def batch_operations(
    request: BatchOperation,
    user_id: str = Depends(get_current_user_id)
):
    """批量操作片段 - 统一毫秒"""
    try:
        now = datetime.utcnow().isoformat()
        results = {
            "created": [],
            "updated": [],
            "deleted": [],
        }
        
        # 批量创建
        if request.creates:
            create_data = []
            for clip in request.creates:
                end_time = clip.end_time
                if end_time is None and clip.duration is not None:
                    end_time = clip.start_time + clip.duration
                elif end_time is None:
                    end_time = clip.start_time
                
                create_data.append({
                    "id": clip.id or str(uuid4()),
                    "track_id": clip.track_id,
                    "asset_id": clip.asset_id,
                    "parent_clip_id": clip.parent_clip_id,
                    "start_time": int(clip.start_time),
                    "end_time": int(end_time),
                    "source_start": int(clip.source_start) if clip.source_start else 0,
                    "source_end": int(clip.source_end) if clip.source_end else None,
                    "volume": clip.volume,
                    "is_muted": clip.is_muted,
                    "speed": clip.speed,
                    "cached_url": clip.cached_url,
                    "created_at": now,
                    "updated_at": now,
                })
            
            if create_data:
                result = supabase.table("clips").insert(create_data).execute()
                results["created"] = result.data
        
        # 批量更新
        if request.updates:
            for item in request.updates:
                update_data = item.updates.model_dump(exclude_unset=True)
                
                # 处理 duration -> end_time（毫秒）
                if "duration" in update_data:
                    current = supabase.table("clips").select("start_time").eq("id", item.id).single().execute()
                    if current.data:
                        start = update_data.get("start_time", current.data["start_time"])
                        update_data["end_time"] = start + update_data.pop("duration")
                
                update_data["updated_at"] = now
                
                result = supabase.table("clips").update(update_data).eq("id", item.id).execute()
                if result.data:
                    results["updated"].extend(result.data)
        
        # 批量删除（优化：使用 in_() 一次删除多条）
        if request.deletes:
            supabase.table("clips").delete().in_("id", request.deletes).execute()
            results["deleted"] = request.deletes
        
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 同步接口
# ============================================

@router.post("/sync")
async def sync_clips(
    track_id: str,
    operations: List[dict],
    user_id: str = Depends(get_current_user_id)
):
    """增量同步片段 - 统一毫秒"""
    try:
        now = datetime.utcnow().isoformat()
        
        for op in operations:
            op_type = op.get("type")
            payload = op.get("payload", {})
            
            if op_type == "ADD_CLIP":
                start_time = int(payload.get("start_time", 0))
                end_time = int(payload.get("end_time", 0))
                
                clip_data = {
                    "id": payload.get("id") or str(uuid4()),
                    "track_id": payload.get("track_id", track_id),
                    "asset_id": payload.get("asset_id"),
                    "parent_clip_id": payload.get("parent_clip_id"),
                    "clip_type": payload.get("clip_type", "video"),
                    "name": payload.get("name"),
                    "start_time": start_time,
                    "end_time": end_time,
                    "source_start": int(payload.get("source_start", 0)),
                    "source_end": int(payload.get("source_end")) if payload.get("source_end") else None,
                    "volume": payload.get("volume", 1.0),
                    "is_muted": payload.get("is_muted", False),
                    "speed": payload.get("speed", 1.0),
                    # 文本/字幕
                    "content_text": payload.get("content_text"),
                    "text_style": payload.get("text_style"),
                    # 特效
                    "effect_type": payload.get("effect_type"),
                    "effect_params": payload.get("effect_params"),
                    # 其他
                    "transform": payload.get("transform"),
                    "created_at": now,
                    "updated_at": now,
                }
                # 过滤 None 值
                clip_data = {k: v for k, v in clip_data.items() if v is not None}
                supabase.table("clips").upsert(clip_data).execute()
            
            elif op_type == "UPDATE_CLIP":
                clip_id = payload.get("id")
                if clip_id:
                    update_data = {}
                    
                    # 允许直接更新的字段（后端命名）
                    direct_fields = [
                        "track_id", "start_time", "end_time", "source_start", "source_end",
                        "volume", "is_muted", "speed", "cached_url", "transform",
                        "transition_in", "transition_out", "content_text", "text_style",
                        "effect_type", "effect_params", "voice_params", "sticker_id",
                        "name", "color", "metadata",
                    ]
                    
                    for k, v in payload.items():
                        if k == "id":
                            continue
                        # 直接使用后端字段名
                        if k in direct_fields:
                            update_data[k] = v
                    
                    if update_data:
                        update_data["updated_at"] = now
                        supabase.table("clips").update(update_data).eq("id", clip_id).execute()
            
            elif op_type == "REMOVE_CLIP":
                clip_id = payload.get("clip_id") or payload.get("id")
                if clip_id:
                    supabase.table("clips").delete().eq("id", clip_id).execute()
            
            elif op_type == "MOVE_CLIP":
                clip_id = payload.get("id")
                if clip_id:
                    current = supabase.table("clips").select("start_time, end_time").eq("id", clip_id).single().execute()
                    if current.data:
                        duration = current.data["end_time"] - current.data["start_time"]
                        new_start = int(payload.get("start_time", payload.get("start", current.data["start_time"])))
                        
                        supabase.table("clips").update({
                            "track_id": payload.get("track_id", track_id),
                            "start_time": new_start,
                            "end_time": new_start + duration,
                            "updated_at": now
                        }).eq("id", clip_id).execute()
        
        return {
            "success": True,
            "processed": len(operations),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ASR Segments 转 Clips
# ============================================

@router.post("/from-asr")
async def create_clips_from_asr(
    request: ASRToClipsRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    将 ASR 识别的 segments 批量创建为 subtitle clips
    
    这个接口会：
    1. 验证项目权限
    2. 为每个 segment 创建一个 subtitle clip
    3. 返回创建的 clips 列表
    """
    try:
        # 验证项目权限
        await verify_project_access(request.project_id, user_id)
        
        # 验证轨道属于该项目
        track = supabase.table("tracks").select("project_id").eq("id", request.track_id).single().execute()
        if not track.data:
            raise HTTPException(status_code=404, detail="轨道不存在")
        if track.data["project_id"] != request.project_id:
            raise HTTPException(status_code=400, detail="轨道不属于该项目")
        
        now = datetime.utcnow().isoformat()
        
        # 构建 clips 数据
        clips_data = []
        for seg in request.segments:
            clip_id = seg.id or str(uuid4())
            
            clip_data = {
                "id": clip_id,
                "track_id": request.track_id,
                "asset_id": request.asset_id,
                "clip_type": request.clip_type,
                "start_time": seg.start,
                "end_time": seg.end,
                "source_start": 0,
                "volume": 1.0,
                "is_muted": False,
                "speed": 1.0,
                # 字幕内容存储在 subtitle_text 字段
                "subtitle_text": seg.text,
                "subtitle_style": {
                    "speaker": seg.speaker
                } if seg.speaker else None,
                "created_at": now,
                "updated_at": now,
            }
            
            clips_data.append(clip_data)
        
        if not clips_data:
            return {"items": [], "total": 0}
        
        # 批量插入
        result = supabase.table("clips").insert(clips_data).execute()
        
        created_clips = result.data or []
        
        return {
            "items": created_clips,
            "total": len(created_clips),
            "message": f"成功创建 {len(created_clips)} 个字幕片段"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/by-project/{project_id}")
async def get_clips_by_project(
    project_id: str,
    clip_type: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    """
    按项目 ID 获取所有 clips（包含完整信息）
    用于局部刷新 clips，而不需要重新加载整个项目
    """
    try:
        # 验证项目权限
        await verify_project_access(project_id, user_id)
        
        # 获取项目的所有轨道 ID
        tracks = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
        if not tracks.data:
            return {"items": [], "total": 0}
        
        track_ids = [t["id"] for t in tracks.data]
        
        # 一次性查询所有 clips（使用 in_ 替代循环查询）
        query = supabase.table("clips").select("*").in_("track_id", track_ids)
        if clip_type:
            query = query.eq("clip_type", clip_type)
        clips_result = query.order("start_time").execute()
        all_clips = clips_result.data or []
        
        if not all_clips:
            return {"items": [], "total": 0}
        
        # 收集需要的 asset_id，一次性查询（包含 duration 用于 origin_duration）
        asset_ids = list(set(c["asset_id"] for c in all_clips if c.get("asset_id")))
        assets_map = {}
        if asset_ids:
            assets_result = supabase.table("assets").select("id, storage_path, duration").in_("id", asset_ids).execute()
            assets_map = {a["id"]: a for a in (assets_result.data or [])}
        
        # 批量生成签名 URL（优化：一次 API 调用）
        from ..services.supabase_client import get_file_urls_batch
        storage_paths = [a["storage_path"] for a in assets_map.values() if a.get("storage_path")]
        url_map = get_file_urls_batch("clips", storage_paths) if storage_paths else {}
        
        # 为 clips 添加 URL 和兼容字段
        for clip in all_clips:
            asset = assets_map.get(clip.get("asset_id")) if clip.get("asset_id") else None
            
            if asset:
                if asset.get("storage_path"):
                    clip["url"] = url_map.get(asset["storage_path"], "")
                # ★ 关键：origin_duration 来自 asset 的 duration（毫秒）
                if asset.get("duration"):
                    # asset.duration 是秒（float），转换为毫秒
                    clip["origin_duration"] = int(asset["duration"] * 1000)
            elif clip.get("cached_url"):
                clip["url"] = clip["cached_url"]
            
            # 兼容字段
            clip["clipType"] = clip.get("clip_type", "video")
            clip["start"] = clip["start_time"]
            clip["duration"] = clip["end_time"] - clip["start_time"]
            clip["trackId"] = clip["track_id"]
            clip["sourceStart"] = clip.get("source_start", 0)
            clip["isMuted"] = clip.get("is_muted", False)
            clip["text"] = clip.get("content_text") or clip.get("subtitle_text")
            # 驼峰命名兼容
            clip["originDuration"] = clip.get("origin_duration")
            # ★ 关键：从 metadata 中提取 silenceInfo（用于换气检测）
            metadata = clip.get("metadata") or {}
            if metadata.get("silence_info"):
                clip["silenceInfo"] = metadata["silence_info"]
        
        return {
            "items": all_clips,
            "total": len(all_clips)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
