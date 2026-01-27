"""
HoppingRabbit AI - B-roll 素材搜索 API
集成 Pexels Video API，提供免费高质量 B-roll 视频素材
支持下载视频到项目资源库
"""
import os
import httpx
import logging
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends, Body
from pydantic import BaseModel
from ..api.auth import get_current_user_id
from ..tasks.broll_download import download_broll_video, get_download_progress, set_download_progress

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/broll", tags=["B-roll"])

# Pexels API 配置
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY", "")
PEXELS_API_URL = "https://api.pexels.com/videos/search"

if not PEXELS_API_KEY:
    logger.warning("[B-roll] ⚠️  PEXELS_API_KEY 未配置，B-roll 功能将无法使用")


# ============================================
# 请求/响应模型
# ============================================

class DownloadRequest(BaseModel):
    """下载 B-roll 视频请求"""
    project_id: str
    video: dict  # 视频数据


class DownloadResponse(BaseModel):
    """下载响应"""
    asset_id: str
    task_id: str
    download_status: str


@router.get("/search")
async def search_broll_videos(
    query: str = Query(..., min_length=1, description="搜索关键词"),
    page: int = Query(1, ge=1, description="页码"),
    per_page: int = Query(20, ge=1, le=80, description="每页数量"),
    orientation: Optional[str] = Query(None, description="方向: landscape, portrait, square"),
    size: Optional[str] = Query(None, description="尺寸: large (4K), medium (Full HD), small (HD)"),
    user_id: str = Depends(get_current_user_id)
):
    """
    搜索 B-roll 视频素材（Pexels）
    
    Args:
        query: 搜索关键词（英文）
        page: 页码，从1开始
        per_page: 每页数量，最多80个
        orientation: 视频方向（可选）
        size: 视频尺寸（可选）
        user_id: 用户ID（自动从token获取）
    
    Returns:
        {
            "source": "pexels",
            "page": 1,
            "per_page": 20,
            "total_results": 1000,
            "videos": [...]
        }
    """
    return await _search_pexels(query, page, per_page, orientation, size, user_id)


async def _search_pexels(
    query: str,
    page: int,
    per_page: int,
    orientation: Optional[str],
    size: Optional[str],
    user_id: str
):
    """搜索 Pexels 视频"""
async def _search_pexels(
    query: str,
    page: int,
    per_page: int,
    orientation: Optional[str],
    size: Optional[str],
    user_id: str
):
    """搜索 Pexels 视频"""
    if not PEXELS_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Pexels 服务未配置。请联系管理员设置 PEXELS_API_KEY"
        )
    
    try:
        logger.info(f"[B-roll] Pexels 搜索: query={query}, page={page}, user={user_id}")
        
        # 构建请求参数
        params = {
            "query": query,
            "page": page,
            "per_page": per_page,
        }
        if orientation:
            params["orientation"] = orientation
        if size:
            params["size"] = size
        
        # 调用 Pexels API
        async with httpx.AsyncClient() as client:
            response = await client.get(
                PEXELS_API_URL,
                params=params,
                headers={"Authorization": PEXELS_API_KEY},
                timeout=10.0
            )
            
            if response.status_code != 200:
                logger.error(f"[B-roll] Pexels API 错误: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Pexels API 错误: {response.status_code}"
                )
            
            data = response.json()
            logger.info(f"[B-roll] ✅ Pexels 找到 {data.get('total_results', 0)} 个结果")
            
            return {
                "source": "pexels",
                "page": data.get("page", page),
                "per_page": data.get("per_page", per_page),
                "total_results": data.get("total_results", 0),
                "videos": data.get("videos", []),
            }
            
    except httpx.TimeoutException:
        logger.error("[B-roll] Pexels API 超时")
        raise HTTPException(status_code=504, detail="请求超时，请重试")
    except httpx.RequestError as e:
        logger.error(f"[B-roll] Pexels API 请求失败: {e}")
        raise HTTPException(status_code=502, detail="无法连接到 Pexels 服务")
    except Exception as e:
        logger.error(f"[B-roll] Pexels 搜索失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 下载功能
# ============================================

@router.post("/download", response_model=DownloadResponse)
async def download_broll(
    request: DownloadRequest = Body(...),
    user_id: str = Depends(get_current_user_id)
):
    """
    下载 B-roll 视频到项目资源库
    
    Args:
        request: 下载请求
        user_id: 用户 ID
    
    Returns:
        {
            "asset_id": "uuid",
            "task_id": "uuid",
            "download_status": "downloading"
        }
    """
    try:
        task_id = str(uuid.uuid4())
        video_data = request.video
        project_id = request.project_id
        
        logger.info(f"[B-roll] 创建下载任务: task_id={task_id}, video_id={video_data.get('id')}")
        
        # 先设置初始进度状态（防止前端轮询时 Celery 任务还未启动）
        set_download_progress(task_id, {
            "status": "pending",
            "progress": 0,
            "asset_id": "",
            "message": "任务排队中..."
        })
        
        # 启动 Celery 异步任务
        task = download_broll_video.delay(
            task_id=task_id,
            user_id=user_id,
            project_id=project_id,
            video_data=video_data
        )
        
        # 注意：asset_id 会在任务执行时创建，这里先返回 task_id
        return DownloadResponse(
            asset_id="",  # 稍后由任务创建
            task_id=task_id,
            download_status="downloading"
        )
        
    except Exception as e:
        logger.error(f"[B-roll] 创建下载任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download/{task_id}/status")
async def get_download_status(
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """
    查询下载进度
    
    Returns:
        {
            "status": "downloading | completed | failed",
            "progress": 65,
            "total_bytes": 15728640,
            "downloaded_bytes": 10223616,
            "asset_id": "uuid"
        }
    """
    try:
        progress = get_download_progress(task_id)
        
        if not progress:
            raise HTTPException(status_code=404, detail="下载任务不存在或已过期")
        
        return progress
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[B-roll] 查询下载进度失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Kling AI 集成（调用现有的 Kling API）
# ============================================

@router.get("/kling/tasks")
async def get_kling_tasks(
    project_id: str = Query(..., description="项目 ID"),
    user_id: str = Depends(get_current_user_id)
):
    """
    获取项目的 Kling AI 生成任务列表
    
    返回所有与该项目关联的 AI 视频生成任务
    """
    from ..services.supabase_client import supabase
    
    try:
        # 查询 ai_outputs 表，筛选 text-to-video 类型的任务
        result = supabase.table("ai_outputs").select("*").eq(
            "project_id", project_id
        ).eq(
            "task_type", "text-to-video"
        ).order(
            "created_at", desc=True
        ).limit(50).execute()
        
        tasks = result.data or []
        
        return {
            "tasks": [{
                "task_id": task["task_id"],
                "prompt": task.get("input_data", {}).get("prompt", ""),
                "status": task["status"],
                "video_url": task.get("output_data", {}).get("video_url"),
                "asset_id": task.get("output_asset_id"),
                "created_at": task["created_at"],
            } for task in tasks]
        }
        
    except Exception as e:
        logger.error(f"[B-roll] 获取 Kling 任务列表失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 热门视频（保持原有功能）
# ============================================
@router.get("/popular")
async def get_popular_videos(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=80),
    user_id: str = Depends(get_current_user_id)
):
    """
    获取热门 B-roll 视频（Pexels 精选）
    """
    if not PEXELS_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Pexels 服务未配置"
        )
    
    try:
        logger.info(f"[B-roll] 获取 Pexels 热门视频: page={page}, user={user_id}")
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.pexels.com/videos/popular",
                params={"page": page, "per_page": per_page},
                headers={"Authorization": PEXELS_API_KEY},
                timeout=10.0
            )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Pexels API 错误: {response.status_code}"
                )
            
            data = response.json()
            return {
                "source": "pexels",
                "page": data.get("page", page),
                "per_page": data.get("per_page", per_page),
                "total_results": data.get("total_results", 0),
                "videos": data.get("videos", []),
            }
            
    except Exception as e:
        logger.error(f"[B-roll] 获取热门视频失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
