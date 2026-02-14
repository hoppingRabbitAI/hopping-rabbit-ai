"""
Canvas Nodes API - 画布节点 CRUD
Visual Editor 专用，从 clips 表分离

数据流:
  finalize_project_upload → 同时写 clips + canvas_nodes
  Visual Editor → 读写 canvas_nodes (不再走 clips)
  Timeline Editor → 继续读写 clips (不受影响)
"""

import logging
from datetime import datetime
from uuid import uuid4
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from ..services.supabase_client import supabase
from .auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/canvas-nodes", tags=["CanvasNodes"])


# ============================================
# Models
# ============================================

class CanvasNodeCreate(BaseModel):
    asset_id: str
    node_type: str = "sequence"    # sequence / free
    media_type: str = "video"      # video / image
    order_index: int = 0
    start_time: float = 0          # 秒
    end_time: float = 0
    duration: float = 0
    source_start: int = 0          # 毫秒
    source_end: int = 0
    canvas_position: Optional[dict] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    metadata: Optional[dict] = None
    clip_id: Optional[str] = None  # 关联的 timeline clip


class CanvasNodeUpdate(BaseModel):
    asset_id: Optional[str] = None  # ★ AI 生成完成后回写真实 asset_id
    node_type: Optional[str] = None
    order_index: Optional[int] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    duration: Optional[float] = None
    canvas_position: Optional[dict] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    metadata: Optional[dict] = None


class BatchCanvasNodeItem(BaseModel):
    id: Optional[str] = None
    asset_id: Optional[str] = None
    node_type: str = "sequence"
    media_type: str = "video"
    order_index: int = 0
    start_time: float = 0
    end_time: float = 0
    duration: float = 0
    source_start: int = 0
    source_end: int = 0
    canvas_position: Optional[dict] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    metadata: Optional[dict] = None
    clip_id: Optional[str] = None


class BatchCreateRequest(BaseModel):
    nodes: List[BatchCanvasNodeItem]


class CanvasEdgeCreate(BaseModel):
    source_node_id: str
    target_node_id: str
    source_handle: Optional[str] = None
    target_handle: Optional[str] = None
    relation_type: Optional[str] = None    # ★ 关联关系类型
    relation_label: Optional[str] = None   # ★ 关联关系标签


# ============================================
# 画布节点 CRUD
# ============================================

@router.get("/projects/{project_id}")
async def list_canvas_nodes(
    project_id: str,
    node_type: Optional[str] = Query(None, description="sequence / free"),
    user_id: str = Depends(get_current_user_id),
):
    """获取项目的所有画布节点"""
    try:
        query = supabase.table("canvas_nodes").select("*").eq(
            "project_id", project_id
        ).order("order_index")
        
        if node_type:
            query = query.eq("node_type", node_type)
        
        result = query.execute()
        nodes = result.data or []
        
        # 分离序列节点、自由节点和 Prompt 节点
        sequence_nodes = [n for n in nodes if n.get("node_type") == "sequence"]
        free_nodes = [n for n in nodes if n.get("node_type") == "free"]
        prompt_nodes = [n for n in nodes if n.get("node_type") == "prompt"]
        
        # 获取画布连线
        edges_result = supabase.table("canvas_edges").select("*").eq(
            "project_id", project_id
        ).execute()
        
        return {
            "project_id": project_id,
            "sequence_nodes": sequence_nodes,
            "free_nodes": free_nodes,
            "prompt_nodes": prompt_nodes,
            "canvas_edges": edges_result.data or [],
            "total_count": len(nodes),
        }
    except Exception as e:
        logger.error(f"[CanvasNodes] ❌ 获取节点失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}")
async def create_canvas_node(
    project_id: str,
    data: CanvasNodeCreate,
    user_id: str = Depends(get_current_user_id),
):
    """创建单个画布节点"""
    try:
        now = datetime.utcnow().isoformat()
        node_id = str(uuid4())
        
        row = {
            "id": node_id,
            "project_id": project_id,
            "node_type": data.node_type,
            "media_type": data.media_type,
            "order_index": data.order_index,
            "start_time": data.start_time,
            "end_time": data.end_time,
            "duration": data.duration,
            "source_start": data.source_start,
            "source_end": data.source_end,
            "canvas_position": data.canvas_position or {"x": 0, "y": 0},
            "video_url": data.video_url,
            "thumbnail_url": data.thumbnail_url,
            "metadata": data.metadata or {},
            "asset_id": data.asset_id,
            "clip_id": data.clip_id,
            "created_at": now,
            "updated_at": now,
        }
        
        result = supabase.table("canvas_nodes").insert(row).execute()
        if not result.data:
            raise HTTPException(status_code=500, detail="创建画布节点失败")
        
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CanvasNodes] ❌ 创建节点失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{node_id}")
async def update_canvas_node(
    node_id: str,
    data: CanvasNodeUpdate,
    user_id: str = Depends(get_current_user_id),
):
    """更新画布节点"""
    try:
        update_data = {
            k: v for k, v in data.dict(exclude_unset=True).items()
        }
        update_data["updated_at"] = datetime.utcnow().isoformat()

        # ★ metadata 做合并而非覆盖，防止丢失 aspect_ratio / transcript 等
        if "metadata" in update_data and update_data["metadata"] is not None:
            existing = supabase.table("canvas_nodes").select("metadata").eq(
                "id", node_id
            ).single().execute()
            old_meta = (existing.data or {}).get("metadata") or {}
            old_meta.update(update_data["metadata"])
            update_data["metadata"] = old_meta

        result = supabase.table("canvas_nodes").update(
            update_data
        ).eq("id", node_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="画布节点不存在")
        
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CanvasNodes] ❌ 更新节点失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{node_id}")
async def delete_canvas_node(
    node_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """删除画布节点（同时删除关联的连线）"""
    try:
        # 先删除关联的边
        supabase.table("canvas_edges").delete().or_(
            f"source_node_id.eq.{node_id},target_node_id.eq.{node_id}"
        ).execute()
        
        # 删除节点
        result = supabase.table("canvas_nodes").delete().eq("id", node_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="画布节点不存在")
        
        return {"message": "已删除", "id": node_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CanvasNodes] ❌ 删除节点失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 批量操作
# ============================================

@router.post("/projects/{project_id}/batch")
async def batch_create_canvas_nodes(
    project_id: str,
    request: BatchCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """批量创建画布节点（素材库添加、分镜结果写入）"""
    try:
        now = datetime.utcnow().isoformat()
        rows = []
        for node in request.nodes:
            node_id = node.id or str(uuid4())
            row = {
                "id": node_id,
                "project_id": project_id,
                "node_type": node.node_type,
                "media_type": node.media_type,
                "order_index": node.order_index,
                "start_time": node.start_time,
                "end_time": node.end_time,
                "duration": node.duration,
                "source_start": node.source_start,
                "source_end": node.source_end,
                "canvas_position": node.canvas_position or {"x": 0, "y": 0},
                "video_url": node.video_url,
                "thumbnail_url": node.thumbnail_url,
                "metadata": node.metadata or {},
                "asset_id": node.asset_id,
                "clip_id": node.clip_id,
                "created_at": now,
                "updated_at": now,
            }
            rows.append(row)
        
        result = supabase.table("canvas_nodes").insert(rows).execute()
        created = result.data or []
        
        logger.info(f"[CanvasNodes] ✅ 批量创建 {len(created)} 个节点, project={project_id}")
        return {
            "success": True,
            "created_count": len(created),
            "nodes": created,
        }
    except Exception as e:
        logger.error(f"[CanvasNodes] ❌ 批量创建失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/projects/{project_id}/reorder")
async def reorder_canvas_nodes(
    project_id: str,
    node_ids: List[str] = [],
    user_id: str = Depends(get_current_user_id),
):
    """重新排序序列节点（传入按新顺序排列的 node_id 列表）"""
    try:
        now = datetime.utcnow().isoformat()
        for idx, node_id in enumerate(node_ids):
            supabase.table("canvas_nodes").update({
                "order_index": idx,
                "updated_at": now,
            }).eq("id", node_id).eq("project_id", project_id).execute()
        
        return {"success": True, "count": len(node_ids)}
    except Exception as e:
        logger.error(f"[CanvasNodes] ❌ 重排序失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 画布连线 CRUD
# ============================================

@router.post("/projects/{project_id}/edges")
async def create_canvas_edge(
    project_id: str,
    data: CanvasEdgeCreate,
    user_id: str = Depends(get_current_user_id),
):
    """创建画布连线"""
    try:
        edge_id = str(uuid4())
        row = {
            "id": edge_id,
            "project_id": project_id,
            "source_node_id": data.source_node_id,
            "target_node_id": data.target_node_id,
            "source_handle": data.source_handle,
            "target_handle": data.target_handle,
            "relation_type": data.relation_type,
            "relation_label": data.relation_label,
            "created_at": datetime.utcnow().isoformat(),
        }
        result = supabase.table("canvas_edges").insert(row).execute()
        if not result.data:
            raise HTTPException(status_code=500, detail="创建连线失败")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CanvasEdges] ❌ 创建连线失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/edges/{edge_id}")
async def delete_canvas_edge(
    edge_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """删除画布连线"""
    try:
        supabase.table("canvas_edges").delete().eq("id", edge_id).execute()
        return {"message": "已删除", "id": edge_id}
    except Exception as e:
        logger.error(f"[CanvasEdges] ❌ 删除连线失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/projects/{project_id}/edges/sync")
async def sync_canvas_edges(
    project_id: str,
    edges: List[CanvasEdgeCreate] = [],
    user_id: str = Depends(get_current_user_id),
):
    """全量同步画布连线（删除旧的，插入新的）"""
    try:
        # 清空旧连线
        supabase.table("canvas_edges").delete().eq(
            "project_id", project_id
        ).execute()
        
        # 插入新连线
        if edges:
            now = datetime.utcnow().isoformat()
            rows = [{
                "id": str(uuid4()),
                "project_id": project_id,
                "source_node_id": e.source_node_id,
                "target_node_id": e.target_node_id,
                "source_handle": e.source_handle,
                "target_handle": e.target_handle,
                "relation_type": e.relation_type,
                "relation_label": e.relation_label,
                "created_at": now,
            } for e in edges]
            supabase.table("canvas_edges").insert(rows).execute()
        
        return {"success": True, "count": len(edges)}
    except Exception as e:
        logger.error(f"[CanvasEdges] ❌ 同步连线失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
