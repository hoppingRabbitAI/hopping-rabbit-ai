"""
HoppingRabbit AI - Tracks API
适配新表结构 (2026-01-07)

新表字段：
- order_index (原 layer)
- is_muted (原 muted)
- is_locked (原 locked)
- is_visible (新增)
- adjustment_params (新增)
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from datetime import datetime
from uuid import uuid4
from pydantic import BaseModel

from ..services.supabase_client import supabase
from .auth import get_current_user_id

router = APIRouter(prefix="/tracks", tags=["Tracks"])


# ============================================
# 请求/响应模型（适配新表）
# ============================================

class TrackCreate(BaseModel):
    id: Optional[str] = None
    project_id: str
    name: str = "Track"
    order_index: Optional[int] = None
    is_visible: bool = True
    is_muted: bool = False
    is_locked: bool = False
    adjustment_params: Optional[dict] = None


class TrackUpdate(BaseModel):
    name: Optional[str] = None
    order_index: Optional[int] = None  # 新字段名
    is_visible: Optional[bool] = None
    is_muted: Optional[bool] = None  # 新字段名
    is_locked: Optional[bool] = None  # 新字段名
    adjustment_params: Optional[dict] = None


class TrackReorder(BaseModel):
    track_ids: List[str]


# ============================================
# 查询接口
# ============================================

@router.get("")
async def list_tracks(
    project_id: str = Query(..., description="项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """获取项目的所有轨道"""
    try:
        result = supabase.table("tracks").select("*").eq(
            "project_id", project_id
        ).order("order_index").execute()
        
        tracks = result.data or []
        return {"items": tracks, "total": len(tracks)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{track_id}")
async def get_track(
    track_id: str,
    include_clips: bool = False,
    user_id: str = Depends(get_current_user_id)
):
    """获取单个轨道详情"""
    try:
        result = supabase.table("tracks").select("*").eq("id", track_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="轨道不存在")
        
        track = result.data
        
        if include_clips:
            clips_result = supabase.table("clips").select("*").eq(
                "track_id", track_id
            ).order("start_time").execute()
            track["clips"] = clips_result.data or []
        
        return track
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 创建接口
# ============================================

@router.post("")
async def create_track(
    request: TrackCreate,
    user_id: str = Depends(get_current_user_id)
):
    """创建新轨道"""
    try:
        track_id = request.id or str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 获取当前最大 order_index
        max_order = supabase.table("tracks").select("order_index").eq(
            "project_id", request.project_id
        ).order("order_index", desc=True).limit(1).execute()
        
        new_order = request.order_index if request.order_index is not None else 0
        if max_order.data:
            new_order = max(new_order, max_order.data[0]["order_index"] + 1)
        
        track_data = {
            "id": track_id,
            "project_id": request.project_id,
            "name": request.name,
            "order_index": new_order,
            "is_visible": request.is_visible,
            "is_muted": request.is_muted,
            "is_locked": request.is_locked,
            "adjustment_params": request.adjustment_params,
            "created_at": now,
            "updated_at": now,
        }
        
        result = supabase.table("tracks").insert(track_data).execute()
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 更新接口
# ============================================

@router.patch("/{track_id}")
async def update_track(
    track_id: str,
    request: TrackUpdate,
    user_id: str = Depends(get_current_user_id)
):
    """更新轨道"""
    try:
        update_data = request.model_dump(exclude_unset=True)
        update_data["updated_at"] = datetime.utcnow().isoformat()
        
        result = supabase.table("tracks").update(update_data).eq("id", track_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="轨道不存在")
        
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reorder")
async def reorder_tracks(
    request: TrackReorder,
    project_id: str = Query(..., description="项目ID"),
    user_id: str = Depends(get_current_user_id)
):
    """重新排序轨道"""
    try:
        now = datetime.utcnow().isoformat()
        
        # 注：轨道数量通常 < 10，逐个更新可接受
        # 如需优化可使用 PostgreSQL RPC 函数批量更新
        for index, track_id in enumerate(request.track_ids):
            supabase.table("tracks").update({
                "order_index": index,
                "updated_at": now
            }).eq("id", track_id).eq("project_id", project_id).execute()
        
        return {"success": True, "order": request.track_ids}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 删除接口
# ============================================

@router.delete("/{track_id}")
async def delete_track(
    track_id: str,
    move_clips_to: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    """删除轨道（硬删除）"""
    try:
        now = datetime.utcnow().isoformat()
        
        if move_clips_to:
            # 将片段移动到指定轨道
            supabase.table("clips").update({
                "track_id": move_clips_to,
                "updated_at": now
            }).eq("track_id", track_id).execute()
        else:
            # 硬删除轨道上的所有片段（新表无 is_deleted）
            supabase.table("clips").delete().eq("track_id", track_id).execute()
        
        # 删除轨道
        result = supabase.table("tracks").delete().eq("id", track_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="轨道不存在")
        
        return {"success": True, "id": track_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 批量操作
# ============================================

@router.post("/batch")
async def batch_create_tracks(
    tracks: List[TrackCreate],
    user_id: str = Depends(get_current_user_id)
):
    """批量创建轨道"""
    try:
        now = datetime.utcnow().isoformat()
        
        track_data = []
        for i, track in enumerate(tracks):
            track_data.append({
                "id": track.id or str(uuid4()),
                "project_id": track.project_id,
                "name": track.name,
                "order_index": track.order_index if track.order_index is not None else i,
                "is_visible": track.is_visible,
                "is_muted": track.is_muted,
                "is_locked": track.is_locked,
                "adjustment_params": track.adjustment_params,
                "created_at": now,
                "updated_at": now,
            })
        
        result = supabase.table("tracks").insert(track_data).execute()
        return {"items": result.data, "total": len(result.data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
