"""
HoppingRabbit AI - 工作台 API
处理从上传到进入编辑器的完整流程
适配新表结构 (2026-01-07)
"""
import os
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel
from typing import Optional, Literal, List, Dict, Any
from datetime import datetime
from uuid import uuid4
from enum import Enum

from ..services.supabase_client import supabase, get_file_url, create_signed_upload_url
from ..services.transform_rules import SegmentContext, transform_engine, sequence_processor, EmotionType, ImportanceLevel, TransformParams, ZoomStrategy
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspace", tags=["Workspace"])


# ============================================
# 数据模型
# ============================================

class TaskType(str, Enum):
    AI_CLIPS = "clips"      # AI 智能切片
    SUMMARY = "summary"     # 内容总结
    AI_CREATE = "ai-create" # ★ 一键成片
    VOICE_EXTRACT = "voice-extract" # ★ 仅提取字幕/音频


class SourceType(str, Enum):
    LOCAL = "local"         # 本地上传
    YOUTUBE = "youtube"     # YouTube 链接
    URL = "url"             # 其他 URL


# ★ ProcessingStepsConfig 已删除
# 一键成片由 task_type == 'ai-create' 决定，ASR 默认开启


class FileInfo(BaseModel):
    """单个文件信息（多文件上传）"""
    name: str
    size: int
    content_type: str
    duration: Optional[float] = None  # 视频时长（秒）
    order_index: int = 0


class CreateSessionRequest(BaseModel):
    """创建处理会话请求"""
    source_type: SourceType
    task_type: TaskType = TaskType.AI_CLIPS
    # ★ 强制视频比例：仅允许 9:16 或 16:9
    aspect_ratio: Optional[str] = None  # "9:16" 或 "16:9"
    
    # === 单文件上传（向后兼容）===
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    content_type: Optional[str] = None
    duration: Optional[float] = None  # 视频时长（秒），前端本地提取
    
    # === 多文件上传（新增）===
    files: Optional[List[FileInfo]] = None  # 多个文件信息
    
    # 链接解析相关
    source_url: Optional[str] = None
    # ★ processing_steps 已删除，由 task_type 决定处理流程


class AssetUploadInfo(BaseModel):
    """单个资源的上传信息"""
    asset_id: str
    upload_url: str
    storage_path: str
    order_index: int  # 保持与前端一致
    file_name: str


class CreateSessionResponse(BaseModel):
    """创建会话响应"""
    session_id: str
    project_id: str
    # ★ 统一用 assets 数组（即使单文件也是一个元素的数组）
    assets: Optional[List[AssetUploadInfo]] = None


class SessionStatus(BaseModel):
    """会话状态"""
    session_id: str
    project_id: str
    status: Literal["uploading", "processing", "completed", "failed", "cancelled", "expired"]
    current_step: Optional[str] = None
    progress: int = 0
    steps: List[dict] = []  # 处理步骤列表
    error: Optional[str] = None
    transcript_segments: Optional[int] = None
    marked_clips: Optional[int] = None
    
    # === 视频资源 ID（用于预览）===
    uploaded_asset_id: Optional[str] = None
    uploaded_asset_ids: Optional[List[str]] = None
    
    # === 多文件上传进度（新增）===
    upload_progress: Optional[dict] = None  # {total_files, completed_files, ...}


# ★ 步骤定义已移至前端 ProcessingView.tsx
# 后端只返回 current_step，前端本地生成步骤列表
# 这样避免前后端维护两套重复的步骤定义


def _get_file_type(content_type: str) -> str:
    """根据 MIME 类型判断文件类型"""
    if not content_type:
        return "video"
    if content_type.startswith("video/"):
        return "video"
    elif content_type.startswith("audio/"):
        return "audio"
    elif content_type.startswith("image/"):
        return "image"
    else:
        return "video"


# ============================================
# API 端点
# ============================================

@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session(
    request: CreateSessionRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    创建处理会话 (步骤1: 仅上传，不扣积分)
    
    ★ 渐进式两步流程:
    1. create_session - 创建会话 + 上传视频 (本接口，不扣积分)
    2. start-ai-processing - 用户确认配置后启动 AI 处理 (扣积分)
    """
    try:
        user_id = current_user["user_id"]
        
        # ★ 移除积分检查！积分检查移到 start-ai-processing 接口
        # 这样用户可以先上传视频，再决定是否使用 AI 功能
        
        session_id = str(uuid4())
        project_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        logger.info(f"[Session] 开始创建会话, user_id={user_id}, source_type={request.source_type.value}")
        
        # ★ 强制校验比例（只允许 9:16 / 16:9）
        if request.aspect_ratio not in ("9:16", "16:9"):
            raise HTTPException(status_code=400, detail="请先选择视频比例（仅支持 9:16 或 16:9）")

        # 1. 创建项目
        project_name = _generate_project_name(request)
        # 根据比例设置项目分辨率
        if request.aspect_ratio == "9:16":
            resolution = {"width": 1080, "height": 1920}
        else:
            resolution = {"width": 1920, "height": 1080}

        project_data = {
            "id": project_id,
            "user_id": user_id,
            "name": project_name,
            "status": "processing",
            "resolution": resolution,
            "fps": 30,
            "created_at": now,
            "updated_at": now,
        }
        supabase.table("projects").insert(project_data).execute()
        logger.info(f"[Session] ✅ 创建项目成功, project_id={project_id}, name={project_name}")
        
        # 2. 创建会话记录
        session_data = {
            "id": session_id,
            "user_id": user_id,
            "project_id": project_id,
            "status": "uploading",
            "upload_source": request.source_type.value,
            "source_url": request.source_url,
            "selected_tasks": [request.task_type.value],
            "processing_steps": {"aspect_ratio": request.aspect_ratio},
            "progress": 0,
            "created_at": now,
            "updated_at": now,
        }
        supabase.table("workspace_sessions").insert(session_data).execute()
        logger.info(f"[Session] ✅ 创建会话成功, session_id={session_id}, task_type={request.task_type.value}")
        
        response = CreateSessionResponse(
            session_id=session_id,
            project_id=project_id,
        )
        
        # 3. 根据来源类型处理
        if request.source_type == SourceType.LOCAL:
            # === 判断是多文件还是单文件上传 ===
            logger.info(f"[Session] 📂 检查上传模式:")
            logger.info(f"[Session]    request.files: {request.files}")
            logger.info(f"[Session]    request.file_name: {request.file_name}")
            logger.info(f"[Session]    files 是否有值: {bool(request.files)}")
            logger.info(f"[Session]    files 长度: {len(request.files) if request.files else 0}")
            
            if request.files and len(request.files) > 0:
                logger.info(f"[Session] ✅ 进入多文件上传模式")
                # ★ 多文件上传模式
                assets_info = []
                asset_ids = []
                total_bytes = sum(f.size for f in request.files)
                
                for file_info in request.files:
                    asset_id = str(uuid4())
                    asset_ids.append(asset_id)
                    file_ext = file_info.name.split(".")[-1] if "." in file_info.name else "mp4"
                    storage_path = f"uploads/{project_id}/{asset_id}.{file_ext}"
                    
                    # 生成预签名上传 URL（启用 upsert 避免重试失败）
                    presign_result = create_signed_upload_url("clips", storage_path, upsert=True)
                    upload_url = presign_result.get("signedURL") or presign_result.get("signed_url", "")
                    
                    # 创建 asset 记录
                    asset_data = {
                        "id": asset_id,
                        "project_id": project_id,
                        "user_id": user_id,
                        "name": file_info.name,
                        "original_filename": file_info.name,
                        "file_type": _get_file_type(file_info.content_type),
                        "mime_type": file_info.content_type or "video/mp4",
                        "file_size": file_info.size,
                        "storage_path": storage_path,
                        "duration": file_info.duration,
                        "status": "uploading",  # 等待上传（约束只允许 uploading/processing/ready/error）
                        "order_index": file_info.order_index,  # 素材顺序
                        "upload_progress": {
                            "bytes_uploaded": 0,
                            "total_bytes": file_info.size,
                            "percentage": 0,
                        },
                        "created_at": now,
                        "updated_at": now,
                    }
                    supabase.table("assets").insert(asset_data).execute()
                    
                    assets_info.append(AssetUploadInfo(
                        asset_id=asset_id,
                        upload_url=upload_url,
                        storage_path=storage_path,
                        order_index=file_info.order_index,
                        file_name=file_info.name,
                    ))
                
                # 更新会话记录
                supabase.table("workspace_sessions").update({
                    "uploaded_asset_id": asset_ids[0] if asset_ids else None,  # ★ 兼容旧逻辑
                    "uploaded_asset_ids": asset_ids,  # JSON 数组
                    "upload_progress": {
                        "total_files": len(request.files),
                        "completed_files": 0,
                        "failed_files": 0,
                        "pending_files": len(request.files),
                        "total_bytes": total_bytes,
                        "uploaded_bytes": 0,
                    },
                    "status": "uploading",
                }).eq("id", session_id).execute()
                
                response.assets = assets_info
                logger.info(f"[Session] ✅ 多文件上传模式，创建 {len(assets_info)} 个资源")
                logger.info(f"[Session]    response.assets 数量: {len(response.assets)}")
                for i, a in enumerate(response.assets):
                    logger.info(f"[Session]    asset[{i}]: {a.asset_id}, order={a.order_index}")
                
            else:
                # ★ 单文件上传模式（向后兼容）
                asset_id = str(uuid4())
                file_ext = request.file_name.split(".")[-1] if request.file_name and "." in request.file_name else "mp4"
                storage_path = f"uploads/{project_id}/{asset_id}.{file_ext}"
                
                logger.info(f"[Session] 正在生成预签名上传URL, storage_path={storage_path}")
                logger.debug(f"[Session] 收到的 duration: {request.duration}")
                presign_result = create_signed_upload_url("clips", storage_path, upsert=True)
                upload_url = presign_result.get("signedURL") or presign_result.get("signed_url", "")
                logger.info(f"[Session] ✅ 预签名URL生成成功, url_length={len(upload_url)}")
                
                asset_data = {
                    "id": asset_id,
                    "project_id": project_id,
                    "user_id": user_id,
                    "name": request.file_name or "未命名",
                    "original_filename": request.file_name,
                    "file_type": _get_file_type(request.content_type),
                    "mime_type": request.content_type or "video/mp4",
                    "file_size": request.file_size,
                    "storage_path": storage_path,
                    "duration": request.duration,
                    "status": "uploading",
                    "order_index": 0,
                    "created_at": now,
                    "updated_at": now,
                }
                supabase.table("assets").insert(asset_data).execute()
                logger.info(f"[Session] ✅ 创建资源成功, asset_id={asset_id}, file_name={request.file_name}")
                
                supabase.table("workspace_sessions").update({
                    "uploaded_asset_id": asset_id,
                    "uploaded_asset_ids": [asset_id],  # 同时更新数组字段
                    "status": "uploading",
                }).eq("id", session_id).execute()
                logger.info(f"[Session] ✅ 更新会话关联资源成功")
                
                # ★ 单文件也统一放入 assets 数组
                response.assets = [AssetUploadInfo(
                    asset_id=asset_id,
                    upload_url=upload_url,
                    storage_path=storage_path,
                    order_index=0,
                    file_name=request.file_name,
                )]
            
        elif request.source_type in (SourceType.YOUTUBE, SourceType.URL):
            supabase.table("workspace_sessions").update({
                "status": "processing",
                "current_step": "fetch",
            }).eq("id", session_id).execute()
            logger.info(f"[Session] ✅ URL类型会话开始处理, source_url={request.source_url}")
        
        logger.info(f"[Session] ✅ 会话创建完成, session_id={session_id}, project_id={project_id}")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[Session] ❌ 创建会话失败: {e}")
        logger.error(f"[Session] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sessions/{session_id}/asset/{asset_id}/uploaded")
async def notify_asset_uploaded(session_id: str, asset_id: str):
    """
    通知单个文件上传完成（多文件上传模式）
    前端每上传完一个文件就调用一次
    """
    logger.info(f"[Upload] 📤 收到资源上传完成通知: session={session_id}, asset={asset_id}")
    try:
        now = datetime.utcnow().isoformat()
        
        # 更新该 asset 状态
        logger.info(f"[Upload]    更新 asset {asset_id} 状态为 uploaded")
        supabase.table("assets").update({
            "status": "uploaded",
            "upload_progress": {
                "percentage": 100,
                "completed": True,
            },
            "updated_at": now,
        }).eq("id", asset_id).execute()
        
        # 获取 session 信息
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        asset_ids = session_data.get("uploaded_asset_ids", [])
        
        # 统计上传进度
        assets_result = supabase.table("assets").select("id, status, file_size").in_("id", asset_ids).execute()
        assets = assets_result.data or []
        
        completed = sum(1 for a in assets if a.get("status") == "uploaded")
        failed = sum(1 for a in assets if a.get("status") == "error")
        pending = len(assets) - completed - failed
        uploaded_bytes = sum(a.get("file_size", 0) for a in assets if a.get("status") == "uploaded")
        total_bytes = sum(a.get("file_size", 0) for a in assets)
        
        # 更新 session 进度
        supabase.table("workspace_sessions").update({
            "upload_progress": {
                "total_files": len(assets),
                "completed_files": completed,
                "failed_files": failed,
                "pending_files": pending,
                "total_bytes": total_bytes,
                "uploaded_bytes": uploaded_bytes,
            },
            "updated_at": now,
        }).eq("id", session_id).execute()
        
        logger.info(f"[Session] 📤 Asset {asset_id} 上传完成, 进度: {completed}/{len(assets)}")
        
        return {
            "status": "ok",
            "progress": {
                "completed": completed,
                "total": len(assets),
                "all_completed": completed == len(assets),
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Session] ❌ 通知上传完成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ 上传完成后创建基础项目结构 (新增)
# ============================================

class FinalizeUploadResponse(BaseModel):
    """完成上传响应"""
    status: str
    project_id: str
    tracks: list  # 创建的轨道信息
    clips: list   # 创建的 clip 信息
    message: str


@router.post("/sessions/{session_id}/finalize-upload", response_model=FinalizeUploadResponse)
async def finalize_upload(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    完成上传，创建基础项目结构 (track + video clip)
    
    ★ 渐进式流程的关键步骤:
    1. 用户上传视频后调用此接口
    2. 创建基础的视频轨道和字幕轨道
    3. 将上传的视频放到时间轴上（创建 video clip）
    4. 此时用户可以在编辑器中预览和编辑
    5. 后续 AI 处理是可选的增值功能
    """
    try:
        user_id = current_user["user_id"]
        now = datetime.utcnow().isoformat()
        
        # 1. 获取会话信息
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        
        # 校验会话归属
        if session_data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        # 2. 获取所有关联的 assets
        asset_ids = session_data.get("uploaded_asset_ids", [])
        if not asset_ids:
            single_asset_id = session_data.get("uploaded_asset_id")
            if single_asset_id:
                asset_ids = [single_asset_id]
        
        if not asset_ids:
            raise HTTPException(status_code=400, detail="会话未关联任何资源")
        
        # 检查所有文件是否都上传完成
        assets_result = supabase.table("assets").select("*").in_("id", asset_ids).execute()
        assets = assets_result.data or []
        
        not_ready = [a for a in assets if a.get("status") not in ("uploaded", "ready")]
        if not_ready:
            pending_names = [a.get("name", a["id"]) for a in not_ready[:3]]
            raise HTTPException(
                status_code=400, 
                detail=f"部分文件未上传完成: {', '.join(pending_names)}"
            )
        
        # 3. 检查是否已创建过 track（避免重复创建）
        existing_tracks = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
        if existing_tracks.data and len(existing_tracks.data) > 0:
            logger.info(f"[Finalize] ⚠️ 项目 {project_id} 已存在轨道，跳过创建")
            return FinalizeUploadResponse(
                status="ok",
                project_id=project_id,
                tracks=[{"id": t["id"]} for t in existing_tracks.data],
                clips=[],
                message="项目结构已存在",
            )
        
        # 4. 创建基础轨道
        video_track_id = str(uuid4())
        text_track_id = str(uuid4())
        
        # 视频轨道
        supabase.table("tracks").insert({
            "id": video_track_id,
            "project_id": project_id,
            "name": "视频轨道",
            "order_index": 0,
            "is_muted": False,
            "is_locked": False,
            "is_visible": True,
            "created_at": now,
            "updated_at": now,
        }).execute()
        
        # 字幕轨道 (order_index 100+ 确保始终在最上层)
        supabase.table("tracks").insert({
            "id": text_track_id,
            "project_id": project_id,
            "name": "字幕轨道",
            "order_index": 100,  # ★ 字幕/文本轨道固定在 100+ 层级
            "is_muted": False,
            "is_locked": False,
            "is_visible": True,
            "created_at": now,
            "updated_at": now,
        }).execute()
        
        logger.info(f"[Finalize] ✅ 创建基础轨道: video={video_track_id}, text={text_track_id}")
        
        # 5. 按顺序排列 assets 并创建 video clips
        sorted_assets = sorted(assets, key=lambda a: a.get("order_index", 0))
        
        created_clips = []
        timeline_position = 0  # 时间轴位置（毫秒）
        
        for asset in sorted_assets:
            asset_id = asset["id"]
            duration_sec = asset.get("duration") or 0
            duration_ms = int(duration_sec * 1000)
            
            # 如果没有时长信息，使用默认值（后续可以通过 ffprobe 获取）
            if duration_ms <= 0:
                duration_ms = 10000  # 默认 10 秒
                logger.warning(f"[Finalize] ⚠️ Asset {asset_id} 无时长信息，使用默认 10s")
            
            clip_id = str(uuid4())
            
            # 创建 video clip
            clip_data = {
                "id": clip_id,
                "track_id": video_track_id,
                "asset_id": asset_id,
                "clip_type": "video",
                "name": asset.get("name", "视频"),
                "start_time": timeline_position,
                "end_time": timeline_position + duration_ms,
                "source_start": 0,
                "source_end": duration_ms,
                "volume": 1.0,
                "is_muted": False,
                "transform": {
                    "x": 0, "y": 0,
                    "scaleX": 1, "scaleY": 1,
                    "rotation": 0,
                    "opacity": 1,
                },
                "speed": 1.0,
                "created_at": now,
                "updated_at": now,
            }
            
            supabase.table("clips").insert(clip_data).execute()
            
            created_clips.append({
                "id": clip_id,
                "asset_id": asset_id,
                "start_time": timeline_position,
                "end_time": timeline_position + duration_ms,
            })
            
            logger.info(f"[Finalize] ✅ 创建 clip: {clip_id}, asset={asset_id}, duration={duration_ms}ms")
            
            # 更新时间轴位置（下一个 clip 紧跟着）
            timeline_position += duration_ms
        
        # 6. 更新所有 assets 状态为 ready
        for asset in assets:
            supabase.table("assets").update({
                "status": "ready",
                "updated_at": now,
            }).eq("id", asset["id"]).execute()
        
        # 7. 更新项目状态为 ready (数据库约束: draft/processing/ready/exported/archived)
        supabase.table("projects").update({
            "status": "ready",
            "updated_at": now,
        }).eq("id", project_id).execute()
        
        # 8. 更新会话状态和 workflow_step
        #    status: completed 表示上传完成
        #    workflow_step: config 表示下一步是"分析配置"
        #    ★ 同时确保 uploaded_asset_id 和 uploaded_asset_ids 都有值
        session_update = {
            "status": "completed",
            "workflow_step": "config",  # ★ 上传完成后进入配置步骤
            "uploaded_asset_ids": asset_ids,  # 确保数组字段有值
            "updated_at": now,
        }
        # 如果有 assets，设置第一个为 uploaded_asset_id（兼容旧逻辑）
        if asset_ids:
            session_update["uploaded_asset_id"] = asset_ids[0]
        
        supabase.table("workspace_sessions").update(session_update).eq("id", session_id).execute()
        
        logger.info(f"[Finalize] ✅ 完成上传，项目 {project_id} 可以编辑了")
        logger.info(f"[Finalize]    创建了 {len(created_clips)} 个 clips, workflow_step -> config")
        
        return FinalizeUploadResponse(
            status="ok",
            project_id=project_id,
            tracks=[
                {"id": video_track_id, "name": "视频轨道", "order_index": 0},
                {"id": text_track_id, "name": "字幕轨道", "order_index": 100},  # ★ 字幕始终在最上层
            ],
            clips=created_clips,
            message=f"基础项目结构创建成功，包含 {len(created_clips)} 个视频片段",
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[Finalize] ❌ 完成上传失败: {e}")
        logger.error(f"[Finalize] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sessions/{session_id}/confirm-upload")
async def confirm_upload(session_id: str, background_tasks: BackgroundTasks):
    """
    确认所有文件上传完成，开始处理
    支持多文件和单文件模式
    """
    try:
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        now = datetime.utcnow().isoformat()
        
        # ★ 防止重复触发：如果已经在处理中，直接返回
        current_status = session_data.get("status")
        if current_status == "processing":
            logger.info(f"[Session] ⚠️ 会话 {session_id} 已在处理中，跳过重复请求")
            return {
                "status": "processing",
                "message": "任务已在处理中，请勿重复提交",
                "asset_count": len(session_data.get("uploaded_asset_ids", [])),
            }
        
        # === 获取所有关联的 assets ===
        asset_ids = session_data.get("uploaded_asset_ids", [])
        
        # 兼容旧的单文件模式
        if not asset_ids:
            single_asset_id = session_data.get("uploaded_asset_id")
            if single_asset_id:
                asset_ids = [single_asset_id]
        
        if not asset_ids:
            raise HTTPException(status_code=400, detail="会话未关联任何资源")
        
        # === 检查所有文件是否都上传完成 ===
        assets_result = supabase.table("assets").select("*").in_("id", asset_ids).execute()
        assets = assets_result.data or []
        
        if len(assets) != len(asset_ids):
            raise HTTPException(status_code=400, detail="部分资源记录不存在")
        
        # 检查未完成的上传
        not_uploaded = [a for a in assets if a.get("status") not in ("uploaded", "uploading", "processing", "ready")]
        if not_uploaded:
            pending_names = [a.get("name", a["id"]) for a in not_uploaded[:3]]
            raise HTTPException(
                status_code=400, 
                detail=f"部分文件未上传完成: {', '.join(pending_names)}"
            )
        
        # === 更新所有 assets 状态为处理中 ===
        for asset in assets:
            supabase.table("assets").update({
                "status": "processing",
                "updated_at": now,
            }).eq("id", asset["id"]).execute()
        
        # === 更新 session 状态 ===
        supabase.table("workspace_sessions").update({
            "status": "processing",
            "current_step": "fetch",
            "progress": 0,
            "updated_at": now,
        }).eq("id", session_id).execute()
        
        selected_tasks = session_data.get("selected_tasks", ["clips"])
        task_type = selected_tasks[0] if selected_tasks else "clips"
        
        # === 按顺序排列 assets ===
        sorted_assets = sorted(assets, key=lambda a: a.get("order_index", 0))
        
        logger.info(f"[Session] ========================================")
        logger.info(f"[Session] 🚀 准备启动后台处理任务")
        logger.info(f"[Session]    session_id: {session_id}")
        logger.info(f"[Session]    project_id: {project_id}")
        logger.info(f"[Session]    task_type: {task_type}")
        logger.info(f"[Session]    sorted_assets count: {len(sorted_assets)}")
        for i, a in enumerate(sorted_assets):
            logger.info(f"[Session]    asset[{i}]: {a.get('name')} (order={a.get('order_index')})")
        logger.info(f"[Session] ========================================")
        
        # === 启动后台处理任务 ===
        background_tasks.add_task(
            _process_session_multi_assets,
            session_id=session_id,
            project_id=project_id,
            assets=sorted_assets,
            task_type=task_type,
        )
        
        logger.info(f"[Session] ✅ 后台任务已添加, 开始处理 {len(assets)} 个素材")
        
        return {
            "status": "processing", 
            "message": f"开始处理 {len(assets)} 个素材",
            "asset_count": len(assets),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Session] ❌ 确认上传失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}", response_model=SessionStatus)
async def get_session_status(session_id: str):
    """获取会话处理状态
    
    返回:
    - current_step: 当前步骤 ID（fetch/transcribe/segment/vision/transform/subtitle/prepare）
    - progress: 0-100 进度
    - status: pending/processing/completed/failed
    
    注意: steps 字段已废弃，前端本地生成步骤列表
    """
    try:
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        data = session.data
        
        return SessionStatus(
            session_id=data["id"],
            project_id=data["project_id"],
            status=data["status"],
            current_step=data.get("current_step"),
            progress=data.get("progress", 0),
            steps=[],  # ★ 废弃，前端本地生成
            error=data.get("error_message"),
            uploaded_asset_id=data.get("uploaded_asset_id"),
            uploaded_asset_ids=data.get("uploaded_asset_ids"),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sessions/{session_id}")
async def cancel_session(session_id: str):
    """取消处理会话"""
    try:
        supabase.table("workspace_sessions").update({
            "status": "cancelled",
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", session_id).execute()
        
        return {"message": "会话已取消"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ 工作流步骤管理 API
# ============================================

class UpdateWorkflowStepRequest(BaseModel):
    """更新工作流步骤请求"""
    workflow_step: str  # entry, upload, processing, defiller, broll_config
    entry_mode: Optional[str] = None  # ai-talk, refine
    enable_smart_clip: Optional[bool] = None  # 智能剪辑开关
    enable_broll: Optional[bool] = None  # B-Roll 开关
    shot_strategy: Optional[str] = None  # 分镜策略: scene, sentence, paragraph
    aspect_ratio: Optional[str] = None  # 仅支持 9:16 或 16:9


@router.put("/sessions/{session_id}/workflow-step")
async def update_workflow_step(
    session_id: str,
    request: UpdateWorkflowStepRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    更新会话的工作流步骤状态
    
    用于前端保存用户当前所在的工作流步骤，支持断点恢复。
    """
    try:
        user_id = current_user["user_id"]
        
        # 验证会话归属
        session = supabase.table("workspace_sessions").select("user_id").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        if session.data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        # 更新工作流步骤
        update_data = {
            "current_step": request.workflow_step,
            "updated_at": datetime.utcnow().isoformat(),
        }
        
        # 将所有工作流状态存储到 processing_steps JSONB 字段
        processing_steps_data = {
            "workflow_step": request.workflow_step,
        }
        if request.entry_mode is not None:
            processing_steps_data["entry_mode"] = request.entry_mode
        if request.enable_smart_clip is not None:
            processing_steps_data["enable_smart_clip"] = request.enable_smart_clip
        if request.enable_broll is not None:
            processing_steps_data["enable_broll"] = request.enable_broll
        if request.shot_strategy is not None:
            processing_steps_data["shot_strategy"] = request.shot_strategy
        if request.aspect_ratio is not None:
            if request.aspect_ratio not in ("9:16", "16:9"):
                raise HTTPException(status_code=400, detail="比例不合法，仅支持 9:16 或 16:9")
            processing_steps_data["aspect_ratio"] = request.aspect_ratio
        
        update_data["processing_steps"] = processing_steps_data
        
        supabase.table("workspace_sessions").update(update_data).eq("id", session_id).execute()
        
        logger.info(f"[Workflow] 更新工作流步骤: session={session_id}, step={request.workflow_step}, mode={request.entry_mode}, smart_clip={request.enable_smart_clip}, broll={request.enable_broll}, shot_strategy={request.shot_strategy}")
        
        return {"status": "ok", "workflow_step": request.workflow_step}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Workflow] 更新工作流步骤失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}/workflow-step")
async def get_workflow_step(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    获取会话的工作流步骤状态
    
    用于前端恢复到用户上次离开的工作流步骤。
    """
    try:
        user_id = current_user["user_id"]
        
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        if session.data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        data = session.data
        processing_steps = data.get("processing_steps") or {}
        
        # ★ 优先使用顶层 workflow_step（由 B-Roll 完成时设置），其次是 processing_steps 中的值
        workflow_step = data.get("workflow_step") or processing_steps.get("workflow_step") or data.get("current_step") or "upload"
        
        return {
            "session_id": session_id,
            "project_id": data.get("project_id"),
            "workflow_step": workflow_step,
            "entry_mode": processing_steps.get("entry_mode") or "refine",
            "enable_smart_clip": processing_steps.get("enable_smart_clip"),
            "enable_broll": processing_steps.get("enable_broll"),
            "aspect_ratio": processing_steps.get("aspect_ratio"),
            "status": data.get("status"),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Workflow] 获取工作流步骤失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/by-project/{project_id}/workflow-step")
async def get_workflow_step_by_project(
    project_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    通过项目 ID 获取会话的工作流步骤状态
    
    用于从项目列表点击时检查是否有未完成的工作流。
    
    ★★★ 治本逻辑：检查弹窗每个步骤的实际完成状态 ★★★
    
    refine 模式步骤完成条件：
    1. upload - 有 assets（视频已上传）
    2. config - 进入过 processing（有转写任务或结果）
    3. processing - 转写已完成（assets 有 transcript）
    4. defiller - clips 已创建（口癖修剪已应用或跳过）
    
    如果所有步骤都完成 → 返回 completed，不弹窗
    """
    try:
        user_id = current_user["user_id"]
        
        # 通过 project_id 查找最新的会话
        session = supabase.table("workspace_sessions")\
            .select("*")\
            .eq("project_id", project_id)\
            .eq("user_id", user_id)\
            .order("created_at", desc=True)\
            .limit(1)\
            .execute()
        
        if not session.data or len(session.data) == 0:
            raise HTTPException(status_code=404, detail="未找到相关会话")
        
        data = session.data[0]
        session_id = data.get("id")
        processing_steps = data.get("processing_steps") or {}
        entry_mode = processing_steps.get("entry_mode") or "refine"
        
        # ★★★ 检查每个步骤的实际完成状态 ★★★
        # 简化逻辑：只检查 assets 和 clips 是否存在
        
        # Step 1: upload - 检查是否有 assets
        assets_check = supabase.table("assets")\
            .select("id, status")\
            .eq("project_id", project_id)\
            .eq("file_type", "video")\
            .limit(1)\
            .execute()
        
        has_assets = assets_check.data and len(assets_check.data) > 0
        if not has_assets:
            # 没有上传视频，从 upload 步骤开始
            logger.info(f"[Workflow] 项目 {project_id} 未上传视频，需从 upload 开始")
            return {
                "session_id": session_id,
                "project_id": project_id,
                "workflow_step": "upload",
                "entry_mode": entry_mode,
                "enable_smart_clip": processing_steps.get("enable_smart_clip"),
                "enable_broll": processing_steps.get("enable_broll"),
                "aspect_ratio": processing_steps.get("aspect_ratio"),
                "status": data.get("status"),
            }
        
        # Step 2-4: 检查是否有 clips（clips 存在 = 口癖修剪已完成 = 工作流已完成）
        # ★ clips 没有 project_id，需要通过 tracks 表关联
        clips_check = supabase.table("clips")\
            .select("id, tracks!inner(project_id)")\
            .eq("tracks.project_id", project_id)\
            .limit(1)\
            .execute()
        
        has_clips = clips_check.data and len(clips_check.data) > 0
        if not has_clips:
            # 有视频但没 clips，需要检查当前步骤
            stored_step = data.get("workflow_step") or processing_steps.get("workflow_step") or "config"
            # 如果是 processing/defiller/broll-config，保持原步骤；否则从 config 开始
            actual_step = stored_step if stored_step in ["processing", "defiller", "broll-config"] else "config"
            logger.info(f"[Workflow] 项目 {project_id} 无 clips，需从 {actual_step} 开始")
            return {
                "session_id": session_id,
                "project_id": project_id,
                "workflow_step": actual_step,
                "entry_mode": entry_mode,
                "enable_smart_clip": processing_steps.get("enable_smart_clip"),
                "enable_broll": processing_steps.get("enable_broll"),
                "aspect_ratio": processing_steps.get("aspect_ratio"),
                "status": data.get("status"),
            }
        
        # ★ 所有步骤都完成了！返回 completed，不弹窗
        logger.info(f"[Workflow] 项目 {project_id} 所有步骤已完成，直接进编辑器")
        return {
            "session_id": session_id,
            "project_id": project_id,
            "workflow_step": "completed",
            "entry_mode": entry_mode,
            "enable_smart_clip": processing_steps.get("enable_smart_clip"),
            "enable_broll": processing_steps.get("enable_broll"),
            "aspect_ratio": processing_steps.get("aspect_ratio"),
            "status": data.get("status"),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Workflow] 通过项目获取工作流步骤失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ 保存工作流配置（B-Roll, PiP 等）
# ============================================

class WorkflowConfigRequest(BaseModel):
    """工作流配置请求"""
    pip_enabled: bool = False                   # 是否启用挂角人像
    pip_position: Optional[str] = "bottom-right"  # 人像位置: bottom-right, bottom-left, top-right, top-left
    pip_size: Optional[str] = "medium"          # 人像大小: small, medium, large
    broll_enabled: bool = False                 # 是否启用 B-Roll
    broll_selections: Optional[List[dict]] = None  # B-Roll 选择 [{clip_id, selected_asset_id}]
    background_preset: Optional[str] = None     # 背景预设 ID
    
    # ★★★ B-Roll 增强配置（Phase 2） ★★★
    broll_display_mode: Optional[str] = "fullscreen"  # fullscreen | pip | mixed
    broll_pip_config: Optional[dict] = None     # PiP 专属配置
    broll_mixed_config: Optional[dict] = None   # 混合模式配置
    broll_face_detection: Optional[dict] = None # 人脸检测结果缓存


@router.post("/sessions/{session_id}/workflow-config")
async def save_workflow_config(
    session_id: str,
    request: WorkflowConfigRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    保存工作流配置（B-Roll, PiP 等）
    
    ★ 这些配置将在编辑器加载时使用，自动应用到画布上
    """
    try:
        user_id = current_user["user_id"]
        
        # 验证会话归属
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        if session.data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        # 更新 processing_steps JSONB 字段，保留已有配置
        existing_steps = session.data.get("processing_steps") or {}
        existing_steps.update({
            "pip_enabled": request.pip_enabled,
            "pip_position": request.pip_position,
            "pip_size": request.pip_size,
            "broll_enabled": request.broll_enabled,
            "broll_selections": request.broll_selections or [],
            "background_preset": request.background_preset,
            # ★★★ B-Roll 增强配置 ★★★
            "broll_display_mode": request.broll_display_mode or "fullscreen",
            "broll_pip_config": request.broll_pip_config,
            "broll_mixed_config": request.broll_mixed_config,
            "broll_face_detection": request.broll_face_detection,
            "config_saved_at": datetime.utcnow().isoformat(),
        })
        
        supabase.table("workspace_sessions").update({
            "processing_steps": existing_steps,
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", session_id).execute()
        
        logger.info(f"[Workflow] 保存工作流配置: session={session_id}, pip={request.pip_enabled}, broll={request.broll_enabled}, mode={request.broll_display_mode}")
        
        return {
            "status": "ok",
            "message": "配置已保存",
            "config": {
                "pip_enabled": request.pip_enabled,
                "broll_enabled": request.broll_enabled,
                "broll_display_mode": request.broll_display_mode,
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Workflow] 保存工作流配置失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}/workflow-config")
async def get_workflow_config(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    获取工作流配置
    
    ★ 编辑器加载时调用，读取 PiP 和 B-Roll 配置
    """
    try:
        user_id = current_user["user_id"]
        
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        if session.data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        processing_steps = session.data.get("processing_steps") or {}
        
        return {
            "session_id": session_id,
            "project_id": session.data.get("project_id"),
            "pip_enabled": processing_steps.get("pip_enabled", False),
            "pip_position": processing_steps.get("pip_position", "bottom-right"),
            "pip_size": processing_steps.get("pip_size", "medium"),
            "broll_enabled": processing_steps.get("broll_enabled", False),
            "broll_selections": processing_steps.get("broll_selections", []),
            "background_preset": processing_steps.get("background_preset"),
            # ★★★ B-Roll 增强配置 ★★★
            "broll_display_mode": processing_steps.get("broll_display_mode", "fullscreen"),
            "broll_pip_config": processing_steps.get("broll_pip_config"),
            "broll_mixed_config": processing_steps.get("broll_mixed_config"),
            "broll_face_detection": processing_steps.get("broll_face_detection"),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Workflow] 获取工作流配置失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★★★ 人脸检测 API（用于 PiP B-Roll 避让）★★★
# ============================================

class DetectFacesRequest(BaseModel):
    """人脸检测请求"""
    asset_id: str
    sample_interval_ms: int = 1000  # 采样间隔
    max_samples: int = 20           # 最大采样帧数


@router.post("/sessions/{session_id}/detect-faces")
async def detect_faces(
    session_id: str,
    request: DetectFacesRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    检测视频中的人脸位置
    
    用于 PiP B-Roll 位置计算，避免遮挡人脸
    """
    try:
        user_id = current_user["user_id"]
        
        # 验证会话归属
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        if session.data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        # 获取资源信息
        asset = supabase.table("assets").select("*").eq("id", request.asset_id).single().execute()
        if not asset.data:
            raise HTTPException(status_code=404, detail="资源不存在")
        
        # 获取视频文件路径
        video_url = asset.data.get("url") or asset.data.get("proxy_url")
        if not video_url:
            raise HTTPException(status_code=400, detail="资源无可用视频 URL")
        
        # 导入人脸检测器
        try:
            from app.services.face_detector import get_face_detector, FaceRegion
        except ImportError as e:
            logger.error(f"[FaceDetection] 无法导入人脸检测器: {e}")
            # 返回默认结果（所有位置都安全）
            return {
                "status": "ok",
                "asset_id": request.asset_id,
                "frames": [],
                "dominant_region": None,
                "safe_pip_positions": ["top-left", "top-right", "bottom-left", "bottom-right"],
                "message": "人脸检测模块未安装，使用默认配置",
            }
        
        # 检查是否是本地文件还是远程 URL
        import os
        from pathlib import Path
        
        # 如果是相对路径，尝试找到本地文件
        local_path = None
        if not video_url.startswith("http"):
            # 尝试多个可能的路径
            possible_paths = [
                video_url,
                f"/app/data/{video_url}",
                f"./data/{video_url}",
            ]
            for p in possible_paths:
                if Path(p).exists():
                    local_path = p
                    break
        
        if local_path:
            # 本地文件，直接检测
            detector = get_face_detector()
            result = detector.detect_from_video(
                local_path,
                sample_interval_ms=request.sample_interval_ms,
                max_samples=request.max_samples,
            )
            
            return {
                "status": "ok",
                "asset_id": request.asset_id,
                "frames": [
                    {
                        "timestamp_ms": f.timestamp_ms,
                        "faces": [face.to_dict() for face in f.faces],
                    }
                    for f in result.frames
                ],
                "dominant_region": result.dominant_region.to_dict() if result.dominant_region else None,
                "safe_pip_positions": result.safe_pip_positions,
            }
        else:
            # 远程 URL，需要下载后处理（异步任务）
            # 暂时返回默认结果
            logger.warning(f"[FaceDetection] 远程视频暂不支持人脸检测: {video_url}")
            return {
                "status": "ok",
                "asset_id": request.asset_id,
                "frames": [],
                "dominant_region": None,
                "safe_pip_positions": ["top-left", "top-right", "bottom-left", "bottom-right"],
                "message": "远程视频暂不支持实时人脸检测",
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[FaceDetection] 人脸检测失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ 渐进式两步流程: 启动 AI 处理 (步骤2)
# ============================================

class StartAIProcessingRequest(BaseModel):
    """启动 AI 处理请求"""
    task_type: TaskType = TaskType.AI_CREATE
    # AI 配置选项 (可选)
    output_ratio: Optional[str] = None  # 输出比例: "9:16" 或 "16:9"
    template_id: Optional[str] = None   # 模板 ID
    options: Optional[dict] = None      # 其他 AI 选项


class StartAIProcessingResponse(BaseModel):
    """启动 AI 处理响应"""
    status: str
    message: str
    credits_consumed: int
    credits_remaining: int


@router.post("/sessions/{session_id}/start-ai-processing", response_model=StartAIProcessingResponse)
async def start_ai_processing(
    session_id: str,
    request: StartAIProcessingRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    启动 AI 处理 (步骤2: 检查积分 + 扣除积分 + 开始处理)
    
    ★ 渐进式两步流程:
    1. create_session - 创建会话 + 上传视频 (不扣积分)
    2. start-ai-processing - 用户确认配置后启动 AI 处理 (本接口，扣积分)
    
    流程:
    1. 校验会话状态 (必须是上传完成状态)
    2. 检查积分余额
    3. 扣除积分
    4. 启动后台处理任务
    """
    try:
        user_id = current_user["user_id"]
        now = datetime.utcnow().isoformat()
        
        # 1. 获取会话信息
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        
        # 校验会话归属
        if session_data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        # 校验会话状态: 必须是 completed（finalize-upload 后的状态）
        if session_data.get("status") != "completed":
            raise HTTPException(
                status_code=400, 
                detail=f"会话状态不正确: {session_data.get('status')}，预期为 completed（请先完成上传）"
            )
        
        # 2. 获取所有关联的 assets
        asset_ids = session_data.get("uploaded_asset_ids", [])
        if not asset_ids:
            single_asset_id = session_data.get("uploaded_asset_id")
            if single_asset_id:
                asset_ids = [single_asset_id]

        # ★ 强制限制输出比例
        if request.output_ratio is not None and request.output_ratio not in ("9:16", "16:9"):
            raise HTTPException(status_code=400, detail="输出比例不合法，仅支持 9:16 或 16:9")
        
        if not asset_ids:
            raise HTTPException(status_code=400, detail="会话未关联任何资源，请先上传视频")
        
        # 检查所有文件是否都上传完成
        assets_result = supabase.table("assets").select("*").in_("id", asset_ids).execute()
        assets = assets_result.data or []
        
        not_ready = [a for a in assets if a.get("status") not in ("uploaded", "ready", "processing")]
        if not_ready:
            pending_names = [a.get("name", a["id"]) for a in not_ready[:3]]
            raise HTTPException(
                status_code=400, 
                detail=f"部分文件未上传完成: {', '.join(pending_names)}"
            )
        
        # 3. 检查并扣除积分 (仅 AI 功能需要)
        credits_consumed = 0
        credits_remaining = 0
        
        if request.task_type.value == 'ai-create':
            from app.services.credit_service import get_credit_service
            credit_service = get_credit_service()
            
            # ai_create 固定 100 积分
            credits_required = 100
            
            # 检查积分
            check_result = await credit_service.quick_check_credits(user_id, credits_required)
            
            if not check_result.get("allowed"):
                logger.warning(f"[AI Processing] ❌ 积分不足: user_id={user_id}, required={credits_required}, available={check_result.get('available')}")
                raise HTTPException(
                    status_code=402,
                    detail={
                        "error": "insufficient_credits",
                        "message": f"积分不足，需要 {credits_required} 积分，当前余额 {check_result.get('available')}",
                        "required": credits_required,
                        "available": check_result.get("available"),
                    }
                )
            
            # ★ 扣除积分
            consume_result = await credit_service.consume_credits(
                user_id=user_id,
                model_key="ai_create",
                credits=credits_required,  # ★ 必须传入消耗的积分数
                ai_task_id=session_id,  # 使用 session_id 作为任务 ID
                description=f"一键 AI 成片 - {session_data.get('project_id', 'unknown')[:8]}",
            )
            
            if not consume_result.get("success"):
                raise HTTPException(
                    status_code=500,
                    detail=f"积分扣除失败: {consume_result.get('error', '未知错误')}"
                )
            
            credits_consumed = consume_result.get("credits_consumed", credits_required)
            credits_remaining = consume_result.get("credits_after", 0)
            
            logger.info(f"[AI Processing] ✅ 积分扣除成功: user_id={user_id}, consumed={credits_consumed}, remaining={credits_remaining}")
        
        # 4. 更新会话配置
        update_data = {
            "selected_tasks": [request.task_type.value],
            "status": "processing",
            "current_step": "fetch",
            "progress": 0,
            "updated_at": now,
        }
        
        # 保存 AI 配置选项
        if request.output_ratio or request.template_id or request.options:
            update_data["ai_config"] = {
                "output_ratio": request.output_ratio,
                "template_id": request.template_id,
                "options": request.options or {},
            }
        
        supabase.table("workspace_sessions").update(update_data).eq("id", session_id).execute()
        
        # 5. 更新所有 assets 状态为处理中
        for asset in assets:
            supabase.table("assets").update({
                "status": "processing",
                "updated_at": now,
            }).eq("id", asset["id"]).execute()
        
        # 6. 按顺序排列 assets
        sorted_assets = sorted(assets, key=lambda a: a.get("order_index", 0))
        
        logger.info(f"[AI Processing] ========================================")
        logger.info(f"[AI Processing] 🚀 启动 AI 处理任务")
        logger.info(f"[AI Processing]    session_id: {session_id}")
        logger.info(f"[AI Processing]    project_id: {project_id}")
        logger.info(f"[AI Processing]    task_type: {request.task_type.value}")
        logger.info(f"[AI Processing]    credits_consumed: {credits_consumed}")
        logger.info(f"[AI Processing]    素材数量: {len(sorted_assets)}")
        logger.info(f"[AI Processing] ========================================")
        
        # 7. 启动后台处理任务
        background_tasks.add_task(
            _process_session_multi_assets,
            session_id=session_id,
            project_id=project_id,
            assets=sorted_assets,
            task_type=request.task_type.value,
        )
        
        return StartAIProcessingResponse(
            status="processing",
            message=f"AI 处理已启动，正在处理 {len(assets)} 个素材",
            credits_consumed=credits_consumed,
            credits_remaining=credits_remaining,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[AI Processing] ❌ 启动失败: {e}")
        logger.error(f"[AI Processing] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ 口播视频精修: 口癖/废话检测 (Defiller) - V2
# ============================================

class FillerWord(BaseModel):
    """口癖词汇"""
    word: str                      # 口癖词汇（如"嗯..."、"那个"）
    count: int                     # 出现次数
    total_duration_ms: int         # 总时长（毫秒）
    occurrences: List[dict]        # 出现位置 [{"start": ms, "end": ms, "clip_id": str}]


class ClipInfo(BaseModel):
    """V2: Clip 信息（智能分析阶段直接创建的 clips）"""
    id: str                        # clip UUID
    text: str                      # 文本内容
    start_time: int                # 时间轴开始位置 (ms)
    end_time: int                  # 时间轴结束位置 (ms)
    source_start: int              # 源素材开始位置 (ms)
    source_end: int                # 源素材结束位置 (ms)
    asset_id: str                  # 关联的 asset ID
    is_filler: bool = False        # 是否为口癖/待删除片段
    filler_type: Optional[str] = None   # 口癖类型: breath/hesitation/repeat_word/filler_word
    filler_reason: Optional[str] = None # 口癖原因
    confidence: float = 1.0        # 检测置信度


class DetectFillersRequest(BaseModel):
    """口癖检测请求 - ★★★ 智能清理三选项 ★★★"""
    # ★★★ 新版三选项参数（参考竞品设计）★★★
    cut_silences: bool = True           # 删除静音片段（换气/停顿/死寂）
    cut_bad_takes: bool = True          # 删除NG/重复片段（口吃/说错）
    remove_filler_words: bool = True    # 删除口癖词（嗯/那个/就是）
    
    # ★ 向后兼容旧参数（会被自动转换）
    detect_fillers: Optional[bool] = None   # 旧参数：识别口癖
    detect_breaths: Optional[bool] = None   # 旧参数：识别换气


class DetectFillersResponse(BaseModel):
    """口癖检测响应 - V2 支持直接返回 clips"""
    status: str
    session_id: str
    project_id: str
    filler_words: List[FillerWord]           # 检测到的口癖词汇
    silence_segments: List[dict]             # 静音片段列表（含 silence_info）
    transcript_segments: List[dict]          # 完整转写结果（向后兼容）
    total_filler_duration_ms: int            # 废话总时长
    original_duration_ms: int                # 原视频时长
    estimated_savings_percent: float         # 预计节省百分比
    # ★ V2 新增字段
    clips: Optional[List[ClipInfo]] = None   # 智能分析阶段创建的 clips
    clips_created: Optional[int] = None      # 创建的 clip 数量
    filler_clips_count: Optional[int] = None # 口癖 clip 数量


@router.post("/sessions/{session_id}/detect-fillers", response_model=DetectFillersResponse)
async def detect_fillers(
    session_id: str,
    request: DetectFillersRequest = None,
    background_tasks: BackgroundTasks = None,
    current_user: dict = Depends(get_current_user)
):
    """
    口癖/废话检测 (口播视频精修模式)
    
    ★ 复用现有 ASR + 静音检测逻辑，不执行 keyframe 分析
    ★ 返回废话片段供前端 DefillerModal 使用
    ★ 根据配置选项控制检测内容
    ★ 性能优化：多 asset 并行 ASR
    
    流程:
    1. 获取会话关联的视频资源
    2. 执行 ASR 转写（含静音检测）- 并行处理多个 asset
    3. 分析口癖词汇（嗯、啊、那个、就是等）
    4. 返回结构化的废话数据
    """
    import asyncio
    import time
    
    start_time = time.time()
    
    try:
        user_id = current_user["user_id"]
        now = datetime.utcnow().isoformat()
        
        # ★ 获取配置选项（如果没有传入，使用默认值）
        if request is None:
            request = DetectFillersRequest()
        
        # ★★★ 新版三选项参数处理 ★★★
        # 向后兼容：如果使用旧参数，转换为新参数
        if request.detect_fillers is not None or request.detect_breaths is not None:
            # 旧版本调用，转换为新参数
            cut_silences = request.detect_breaths if request.detect_breaths is not None else True
            cut_bad_takes = request.detect_fillers if request.detect_fillers is not None else True
            remove_filler_words = request.detect_fillers if request.detect_fillers is not None else True
        else:
            # 新版本调用
            cut_silences = request.cut_silences
            cut_bad_takes = request.cut_bad_takes
            remove_filler_words = request.remove_filler_words
        
        # 映射到实际检测开关
        detect_silences_enabled = cut_silences               # 静音检测（换气/停顿/死寂）
        detect_semantics_enabled = cut_bad_takes or remove_filler_words  # LLM 语义分析（NG + 口癖词）
        
        logger.info(f"[Defiller] ★ 三选项配置: cut_silences={cut_silences}, cut_bad_takes={cut_bad_takes}, remove_filler_words={remove_filler_words}")
        logger.info(f"[Defiller] → 检测开关: silences={detect_silences_enabled}, semantics={detect_semantics_enabled}")
        
        # 1. 获取会话信息
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        
        # 校验会话归属
        if session_data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        # 2. 获取关联的 assets
        asset_ids = session_data.get("uploaded_asset_ids", [])
        if not asset_ids:
            single_asset_id = session_data.get("uploaded_asset_id")
            if single_asset_id:
                asset_ids = [single_asset_id]
        
        if not asset_ids:
            raise HTTPException(status_code=400, detail="会话未关联任何资源")
        
        assets_result = supabase.table("assets").select("*").in_("id", asset_ids).execute()
        assets = assets_result.data or []
        
        if not assets:
            raise HTTPException(status_code=400, detail="未找到资源文件")
        
        # 3. 执行 ASR 转写（复用 _run_asr 函数，正确处理 Cloudflare HLS）
        # ★★★ 优化：多 asset 并行处理 ★★★
        from ..services.supabase_client import get_file_url
        
        all_segments = []
        total_duration_ms = 0
        
        # 进度回调（detect-fillers 无需实时进度，使用空函数）
        def dummy_progress(step: str, progress: int):
            logger.debug(f"[Defiller] Progress: {step} = {progress}%")
        
        async def process_single_asset(asset: dict) -> tuple:
            """处理单个 asset 的 ASR，返回 (asset_id, segments, duration_ms)"""
            # ★ assets 表用 storage_path 存储相对路径，需要生成签名 URL
            storage_path = asset.get("storage_path")
            if not storage_path:
                logger.warning(f"[Defiller] ⚠️ Asset {asset['id']} 没有 storage_path，跳过")
                return (asset["id"], [], 0)
            
            # 使用 get_file_url 获取签名 URL (bucket 是 "clips")
            try:
                file_url = get_file_url("clips", storage_path, expires_in=3600)
                if not file_url:
                    logger.warning(f"[Defiller] ⚠️ 无法获取签名 URL: {storage_path}")
                    return (asset["id"], [], 0)
            except Exception as url_err:
                logger.warning(f"[Defiller] ⚠️ 获取签名 URL 失败: {url_err}")
                return (asset["id"], [], 0)
            
            asset_duration = float(asset.get("duration") or 0)
            duration_ms = int(asset_duration * 1000)
            
            logger.info(f"[Defiller] 开始转写 asset {asset['id'][:8]}: {file_url[:60]}...")
            
            # ★★★ 复用 _run_asr 函数，关闭 DDC 以保留语气词 ★★★
            # enable_ddc=False: 不启用语义顺滑，保留"嗯"、"啊"等原始语气词
            segments = await _run_asr(
                file_url=file_url,
                update_progress=dummy_progress,
                current_progress=0,
                step_progress=100,
                asset_id=asset["id"],
                video_duration_sec=asset_duration,
                enable_ddc=False  # ★ 口癖检测需要保留原始语气词
            )
            
            # 为每个 segment 添加 asset_id
            for seg in segments:
                seg["asset_id"] = asset["id"]
            
            logger.info(f"[Defiller] 转写完成 asset {asset['id'][:8]}: {len(segments)} 个片段")
            return (asset["id"], segments, duration_ms)
        
        # ★★★ 并行执行所有 asset 的 ASR ★★★
        asr_start = time.time()
        logger.info(f"[Defiller] 🚀 开始并行 ASR，共 {len(assets)} 个 asset")
        
        tasks = [process_single_asset(asset) for asset in assets]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        asr_elapsed = time.time() - asr_start
        logger.info(f"[Defiller] ⏱️ ASR 并行完成，耗时 {asr_elapsed:.1f}s")
        
        # 收集结果（按原始顺序）
        asset_order = {asset["id"]: i for i, asset in enumerate(assets)}
        valid_results = []
        
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"[Defiller] ❌ ASR 异常: {result}")
                continue
            asset_id, segments, duration_ms = result
            valid_results.append((asset_id, segments, duration_ms))
        
        # 按原始 asset 顺序排序并合并
        valid_results.sort(key=lambda x: asset_order.get(x[0], 999))
        
        for asset_id, segments, duration_ms in valid_results:
            all_segments.extend(segments)
            total_duration_ms += duration_ms
        
        # 4. ★ 使用智能口癖检测服务
        from ..services.filler_detector import detect_all_fillers, FillerType
        
        filler_words_map = {}  # word -> {count, total_duration_ms, occurrences}
        silence_segments = []
        
        logger.info(f"[Defiller] 🤖 开始智能口癖检测: {len(all_segments)} 个片段")
        
        # 直接使用 ASR 结果，无需额外下载
        # - 静音片段：从 ASR 结果的 silence_info 提取（transcribe.py 已分类）
        # - 语义分析：LLM 分析文本
        # ★★★ 传递三选项参数给检测服务 ★★★
        analysis_result = await detect_all_fillers(
            segments=all_segments,  # 包含静音和文本片段
            detect_silences=detect_silences_enabled,    # 静音检测
            detect_semantics=detect_semantics_enabled,   # LLM 语义分析
            cut_bad_takes=cut_bad_takes,                 # ★ 新增：是否检测 NG 片段
            remove_filler_words=remove_filler_words,     # ★ 新增：是否检测口癖词
        )
        
        logger.info(f"[Defiller] 🤖 检测完成: {len(analysis_result.detections)} 个问题")
        logger.info(f"[Defiller] 🤖 分类: {analysis_result.filler_count_by_type}")
        
        # 将检测结果转换为 filler_words_map 格式
        for detection in analysis_result.detections:
            # 根据类型生成显示名称
            type_names = {
                FillerType.BREATH: "[换气]",
                FillerType.HESITATION: "[卡顿]",
                FillerType.DEAD_AIR: "[死寂]",
                FillerType.FILLER_WORD: detection.text or "[口癖词]",
                FillerType.REPEAT_WORD: f"[重复] {detection.text}",
                FillerType.NG_TAKE: "[NG片段]",
            }
            filler_type = type_names.get(detection.filler_type, detection.text)
            
            duration_ms = detection.duration_ms
            
            if filler_type not in filler_words_map:
                filler_words_map[filler_type] = {"count": 0, "total_duration_ms": 0, "occurrences": []}
            
            filler_words_map[filler_type]["count"] += 1
            filler_words_map[filler_type]["total_duration_ms"] += duration_ms
            filler_words_map[filler_type]["occurrences"].append({
                "start": detection.start,
                "end": detection.end,
                "asset_id": detection.asset_id,
                "text": detection.text,
                "reason": detection.reason,
                "confidence": detection.confidence,
                "segment_id": detection.segment_id,
            })
            
            # 如果是静音类型，添加到 silence_segments
            if detection.filler_type in (FillerType.BREATH, FillerType.HESITATION, FillerType.DEAD_AIR):
                silence_segments.append({
                    "id": detection.segment_id,
                    "text": "",
                    "start": detection.start,
                    "end": detection.end,
                    "asset_id": detection.asset_id,
                    "silence_info": {
                        "classification": detection.filler_type.value,
                        "duration_ms": duration_ms,
                        "reason": detection.reason,
                    }
                })
        
        # 5. 构建响应
        filler_words = [
            FillerWord(
                word=word,
                count=data["count"],
                total_duration_ms=data["total_duration_ms"],
                occurrences=data["occurrences"]
            )
            for word, data in sorted(filler_words_map.items(), key=lambda x: -x[1]["count"])
        ]
        
        total_filler_duration = sum(f.total_duration_ms for f in filler_words)
        savings_percent = (total_filler_duration / total_duration_ms * 100) if total_duration_ms > 0 else 0
        
        logger.info(f"[Defiller] ✅ 检测完成: {len(filler_words)} 类口癖, 总时长 {total_filler_duration}ms")
        logger.info(f"[Defiller]    预计节省 {savings_percent:.1f}%")
        
        # ★★★ V2: 智能分析阶段直接创建 clips ★★★
        # 构建 filler 检测结果的快速查找表 (segment_id -> detection_info)
        filler_lookup = {}
        for detection in analysis_result.detections:
            filler_lookup[detection.segment_id] = {
                "filler_type": detection.filler_type.value,
                "reason": detection.reason,
                "confidence": detection.confidence,
            }
        
        # 获取或创建视频轨道
        tracks_result = supabase.table("tracks").select("id").eq("project_id", project_id).eq("order_index", 0).execute()
        if tracks_result.data:
            track_id = tracks_result.data[0]["id"]
            logger.info(f"[Defiller V2] 使用已有轨道: {track_id}")
        else:
            # 创建新轨道
            track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": track_id,
                "project_id": project_id,
                "name": "视频轨道",
                "type": "video",
                "order_index": 0,
                "created_at": now,
                "updated_at": now,
            }).execute()
            logger.info(f"[Defiller V2] 创建新轨道: {track_id}")
        
        # ★★★ 获取或创建字幕轨道 ★★★
        # 字幕轨道应该在 100+ 层级（始终在最上层）
        subtitle_tracks_result = supabase.table("tracks").select("id").eq("project_id", project_id).eq("name", "字幕").execute()
        if not subtitle_tracks_result.data:
            # 也检查旧的 order_index=1 的轨道（兼容旧数据）
            subtitle_tracks_result = supabase.table("tracks").select("id").eq("project_id", project_id).eq("order_index", 1).execute()
        
        if subtitle_tracks_result.data:
            subtitle_track_id = subtitle_tracks_result.data[0]["id"]
            # ★ 确保字幕轨道 order_index 是 100+
            supabase.table("tracks").update({"order_index": 100}).eq("id", subtitle_track_id).execute()
            logger.info(f"[Defiller V2] 使用已有字幕轨道: {subtitle_track_id}, 更新 order_index=100")
        else:
            # 创建字幕轨道
            subtitle_track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": subtitle_track_id,
                "project_id": project_id,
                "name": "字幕",
                "order_index": 100,  # ★ 字幕始终在最上层
                "created_at": now,
                "updated_at": now,
            }).execute()
            logger.info(f"[Defiller V2] 创建字幕轨道: {subtitle_track_id}, order_index=100")
        
        # 删除已有的 clips（如果重新分析）
        if assets:
            asset_ids_list = [a["id"] for a in assets]
            supabase.table("clips").delete().in_("asset_id", asset_ids_list).execute()
            logger.info(f"[Defiller V2] 清理已有 clips")
        
        # 创建 clips（每个 segment 对应一个视频 clip + 一个字幕 clip）
        created_clips = []
        subtitle_clips = []  # ★★★ 新增：字幕 clips ★★★
        clip_infos = []
        clip_start_time = 0  # 时间轴上的累积位置
        filler_clips_count = 0
        
        for idx, seg in enumerate(all_segments):
            clip_id = str(uuid4())
            subtitle_clip_id = str(uuid4())  # ★ 字幕 clip ID
            seg_start = seg.get("start", 0)
            seg_end = seg.get("end", 0)
            seg_text = seg.get("text", "")
            seg_asset_id = seg.get("asset_id", assets[0]["id"] if assets else None)
            duration_ms = seg_end - seg_start
            
            # 检查是否为口癖片段
            seg_id = seg.get("id", f"seg-{idx}")
            filler_info = filler_lookup.get(seg_id)
            is_filler = filler_info is not None
            filler_type = filler_info["filler_type"] if filler_info else None
            filler_reason = filler_info["reason"] if filler_info else None
            confidence = filler_info["confidence"] if filler_info else 1.0
            
            if is_filler:
                filler_clips_count += 1
            
            # 构建 clip metadata
            metadata = {
                "is_filler": is_filler,
                "filler_type": filler_type,
                "filler_reason": filler_reason,
                "confidence": confidence,
                "segment_index": idx,
                "hidden": False,  # 用于 apply-trimming 软删除
            }
            
            # ★ 视频 clip
            clip_data = {
                "id": clip_id,
                "track_id": track_id,
                "asset_id": seg_asset_id,
                "clip_type": "video",
                "start_time": clip_start_time,
                "end_time": clip_start_time + duration_ms,
                "source_start": seg_start,
                "source_end": seg_end,
                "content_text": seg_text or None,
                "metadata": metadata,
                "created_at": now,
                "updated_at": now,
            }
            created_clips.append(clip_data)
            
            # ★★★ 字幕 clip（有文本内容才创建）★★★
            if seg_text and seg_text.strip():
                subtitle_clip_data = {
                    "id": subtitle_clip_id,
                    "track_id": subtitle_track_id,
                    "asset_id": seg_asset_id,
                    "clip_type": "subtitle",
                    "start_time": clip_start_time,
                    "end_time": clip_start_time + duration_ms,
                    "source_start": seg_start,
                    "source_end": seg_end,
                    "content_text": seg_text,
                    "metadata": {
                        "video_clip_id": clip_id,  # 关联到视频 clip
                        "is_filler": is_filler,
                        "segment_index": idx,
                        "hidden": False,
                    },
                    "created_at": now,
                    "updated_at": now,
                }
                subtitle_clips.append(subtitle_clip_data)
            
            # 构建 ClipInfo 响应
            clip_infos.append(ClipInfo(
                id=clip_id,
                text=seg_text,
                start_time=clip_start_time,
                end_time=clip_start_time + duration_ms,
                source_start=seg_start,
                source_end=seg_end,
                asset_id=seg_asset_id,
                is_filler=is_filler,
                filler_type=filler_type,
                filler_reason=filler_reason,
                confidence=confidence,
            ))
            
            clip_start_time += duration_ms
        
        # 批量插入 clips
        if created_clips:
            supabase.table("clips").insert(created_clips).execute()
            logger.info(f"[Defiller V2] ✅ 创建 {len(created_clips)} 个视频 clips，其中 {filler_clips_count} 个为口癖")
        
        # ★★★ 批量插入字幕 clips ★★★
        if subtitle_clips:
            supabase.table("clips").insert(subtitle_clips).execute()
            logger.info(f"[Defiller V2] ✅ 创建 {len(subtitle_clips)} 个字幕 clips")
        
        # ★ 总耗时统计
        total_elapsed = time.time() - start_time
        logger.info(f"[Defiller] ⏱️ 总耗时: {total_elapsed:.1f}s (ASR: {asr_elapsed:.1f}s)")
        
        return DetectFillersResponse(
            status="completed",
            session_id=session_id,
            project_id=project_id,
            filler_words=filler_words,
            silence_segments=silence_segments,
            transcript_segments=all_segments,
            total_filler_duration_ms=total_filler_duration,
            original_duration_ms=total_duration_ms,
            estimated_savings_percent=round(savings_percent, 1),
            # V2 新增
            clips=clip_infos,
            clips_created=len(created_clips),
            filler_clips_count=filler_clips_count,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[Defiller] ❌ 检测失败: {e}")
        logger.error(f"[Defiller] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ 口播视频精修: 应用修剪 (Apply Trimming) - V2
# ============================================

class TrimSegment(BaseModel):
    """需要删除的片段"""
    start: int                # 开始时间（毫秒）
    end: int                  # 结束时间（毫秒）
    asset_id: Optional[str] = None  # 所属资源 ID
    reason: Optional[str] = None    # 删除原因（如 "filler_word:嗯"）


class TranscriptSegmentInput(BaseModel):
    """转写片段输入"""
    id: Optional[str] = None
    text: str
    start: int  # 毫秒
    end: int    # 毫秒
    asset_id: Optional[str] = None


class ApplyTrimmingRequest(BaseModel):
    """应用修剪请求"""
    removed_fillers: List[str]        # 用户选择删除的口癖词汇
    trim_segments: Optional[List[TrimSegment]] = None  # 可选：具体要删除的片段
    transcript_segments: Optional[List[TranscriptSegmentInput]] = None  # ★ 前端传入的转写结果
    create_clips_from_segments: bool = True  # 是否根据保留片段创建 clips
    # ★ 新增：用户选中的片段 ID（用于按 ID 删除）
    segment_ids_to_remove: Optional[List[str]] = None


class ApplyTrimmingResponse(BaseModel):
    """应用修剪响应"""
    status: str
    session_id: str
    project_id: str
    clips_created: int                # 创建的 clip 数量
    total_duration_ms: int            # 修剪后的总时长
    removed_duration_ms: int          # 被删除的时长
    clips: List[dict]                 # 创建的 clips 列表


# ★ V2: 简化的应用修剪请求（直接操作 clip IDs）
class ApplyTrimmingRequestV2(BaseModel):
    """V2 应用修剪请求 - 直接指定要删除/保留的 clip IDs"""
    clip_ids_to_hide: List[str]              # 要隐藏（软删除）的 clip IDs
    clip_ids_to_show: Optional[List[str]] = None  # 要恢复显示的 clip IDs（用户手动恢复）


class ApplyTrimmingResponseV2(BaseModel):
    """V2 应用修剪响应"""
    status: str
    session_id: str
    project_id: str
    hidden_clips_count: int           # 隐藏的 clip 数量
    visible_clips_count: int          # 可见的 clip 数量
    removed_duration_ms: int          # 被隐藏的总时长
    remaining_duration_ms: int        # 保留的总时长


@router.post("/sessions/{session_id}/apply-trimming-v2", response_model=ApplyTrimmingResponseV2)
async def apply_trimming_v2(
    session_id: str,
    request: ApplyTrimmingRequestV2,
    current_user: dict = Depends(get_current_user)
):
    """
    V2 应用口癖修剪 - 简化版本
    
    ★ 直接操作 clips 的 metadata.hidden 字段
    ★ 不重新创建 clips，只标记隐藏/显示
    
    流程:
    1. 验证会话权限
    2. 批量更新 clips 的 metadata.hidden 字段
    3. 返回统计信息
    """
    try:
        user_id = current_user["user_id"]
        now = datetime.utcnow().isoformat()
        
        # 1. 验证会话
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        
        if session_data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        logger.info(f"[ApplyTrimming V2] 开始: session={session_id}, hide={len(request.clip_ids_to_hide)}, show={len(request.clip_ids_to_show or [])}")
        
        # 2. 获取所有相关 clips
        asset_ids = session_data.get("uploaded_asset_ids", [])
        if not asset_ids:
            single_asset_id = session_data.get("uploaded_asset_id")
            if single_asset_id:
                asset_ids = [single_asset_id]
        
        all_clips_result = supabase.table("clips").select("*").in_("asset_id", asset_ids).execute()
        all_clips = all_clips_result.data or []
        
        if not all_clips:
            raise HTTPException(status_code=400, detail="未找到 clips，请先执行智能分析")
        
        # 3. 批量更新 hidden 状态
        hidden_duration_ms = 0
        visible_duration_ms = 0
        hidden_count = 0
        visible_count = 0
        
        for clip in all_clips:
            clip_id = clip["id"]
            metadata = clip.get("metadata") or {}
            duration = (clip.get("end_time") or 0) - (clip.get("start_time") or 0)
            
            if clip_id in request.clip_ids_to_hide:
                # 标记为隐藏
                metadata["hidden"] = True
                hidden_duration_ms += duration
                hidden_count += 1
            elif request.clip_ids_to_show and clip_id in request.clip_ids_to_show:
                # 恢复显示
                metadata["hidden"] = False
                visible_duration_ms += duration
                visible_count += 1
            elif not metadata.get("hidden", False):
                # 保持可见
                visible_duration_ms += duration
                visible_count += 1
            else:
                # 保持隐藏
                hidden_duration_ms += duration
                hidden_count += 1
            
            # 更新 metadata
            supabase.table("clips").update({
                "metadata": metadata,
                "updated_at": now,
            }).eq("id", clip_id).execute()
        
        # 4. 更新会话状态
        supabase.table("workspace_sessions").update({
            "status": "completed",
            "updated_at": now,
        }).eq("id", session_id).execute()
        
        logger.info(f"[ApplyTrimming V2] ✅ 完成: hidden={hidden_count}, visible={visible_count}")
        
        return ApplyTrimmingResponseV2(
            status="completed",
            session_id=session_id,
            project_id=project_id,
            hidden_clips_count=hidden_count,
            visible_clips_count=visible_count,
            removed_duration_ms=hidden_duration_ms,
            remaining_duration_ms=visible_duration_ms,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[ApplyTrimming V2] ❌ 失败: {e}")
        logger.error(f"[ApplyTrimming V2] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# 保留旧版本 apply-trimming 向后兼容
@router.post("/sessions/{session_id}/apply-trimming", response_model=ApplyTrimmingResponse)
async def apply_trimming(
    session_id: str,
    request: ApplyTrimmingRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    应用口癖修剪 (口播视频精修模式) - V1 旧版本
    
    ★ 根据用户在 DefillerModal 中的选择，执行实际的修剪操作
    ★ 创建新的 clips 并更新 project
    
    流程:
    1. 获取会话关联的视频资源和转写结果
    2. 根据选中的口癖词汇过滤出需要删除的片段
    3. 计算保留片段并创建 clips
    4. 更新数据库
    """
    try:
        user_id = current_user["user_id"]
        now = datetime.utcnow().isoformat()
        
        # 1. 获取会话信息
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        
        # 校验会话归属
        if session_data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        # 2. 获取关联的 assets
        asset_ids = session_data.get("uploaded_asset_ids", [])
        if not asset_ids:
            single_asset_id = session_data.get("uploaded_asset_id")
            if single_asset_id:
                asset_ids = [single_asset_id]
        
        if not asset_ids:
            raise HTTPException(status_code=400, detail="会话未关联任何资源")
        
        assets_result = supabase.table("assets").select("*").in_("id", asset_ids).execute()
        assets = assets_result.data or []
        
        if not assets:
            raise HTTPException(status_code=400, detail="未找到资源文件")
        
        # 3. 获取已有的转写结果（从 clips 或 transcripts 表）
        # 先检查是否已执行过 detect-fillers (clips 表没有 project_id，用 asset_id 查询)
        existing_clips = supabase.table("clips").select("*").in_("asset_id", asset_ids).execute()
        existing_clips_data = existing_clips.data or []
        
        # 如果有 trim_segments，直接使用；否则需要重新分析
        trim_segments = request.trim_segments or []
        removed_fillers = set(request.removed_fillers)
        
        logger.info(f"[ApplyTrimming] 开始修剪: session={session_id}, project={project_id}")
        logger.info(f"[ApplyTrimming] 删除的口癖: {removed_fillers}")
        
        # 4. 如果没有提供具体的 trim_segments，需要重新执行 ASR 分析
        if not trim_segments:
            from ..tasks.transcribe import transcribe_audio
            
            all_segments = []
            total_duration_ms = 0
            
            for asset in assets:
                file_url = asset.get("file_url") or asset.get("url")
                if not file_url:
                    continue
                
                asset_duration = int((asset.get("duration") or 0) * 1000)
                total_duration_ms += asset_duration
                
                # 使用缓存的转写结果（如果有）
                cached_transcript = asset.get("metadata", {}).get("transcript_segments")
                if cached_transcript:
                    segments = cached_transcript
                else:
                    result = await transcribe_audio(
                        audio_url=file_url,
                        language="zh",
                    )
                    segments = result.get("segments", [])
                
                for seg in segments:
                    seg["asset_id"] = asset["id"]
                all_segments.extend(segments)
            
            # 根据 removed_fillers 标记需要删除的片段
            FILLER_PATTERNS = list(removed_fillers)
            
            for seg in all_segments:
                silence_info = seg.get("silence_info")
                text = seg.get("text", "").strip()
                should_remove = False
                reason = None
                
                # 检查静音片段
                if silence_info:
                    classification = silence_info.get("classification")
                    filler_type = f"[{classification}]"
                    if filler_type in removed_fillers:
                        should_remove = True
                        reason = f"silence:{classification}"
                
                # 检查文本中的口癖词汇
                if text and not should_remove:
                    for pattern in FILLER_PATTERNS:
                        if pattern in text and not pattern.startswith("["):
                            should_remove = True
                            reason = f"filler_word:{pattern}"
                            break
                
                if should_remove:
                    trim_segments.append(TrimSegment(
                        start=int(seg.get("start", 0)),
                        end=int(seg.get("end", 0)),
                        asset_id=seg.get("asset_id"),
                        reason=reason,
                    ))
        
        # 5. 计算保留片段并创建 clips
        # ★ 简化逻辑：单 asset 场景下，所有 trim_segments 直接归属该 asset
        logger.info(f"[ApplyTrimming] 收到 {len(trim_segments)} 个 trim_segments, {len(assets)} 个 assets")
        
        if len(assets) == 1:
            # 单 asset 场景（口播视频精修的主要场景）
            asset = assets[0]
            asset_id = asset["id"]
            duration_ms = int((asset.get("duration") or 0) * 1000)
            
            # 所有 trim_segments 都属于这个 asset
            all_trim_segs = [{"start": seg.start, "end": seg.end} for seg in trim_segments]
            
            asset_segments = {
                asset_id: {
                    "asset": asset,
                    "trim_segments": all_trim_segs,
                    "duration_ms": duration_ms,
                }
            }
            logger.info(f"[ApplyTrimming] 单 asset 模式: {asset_id}, duration={duration_ms}ms, trim_segs={len(all_trim_segs)}")
        else:
            # 多 asset 场景（需要 asset_id 来区分）
            asset_segments = {}
            for asset in assets:
                asset_segments[asset["id"]] = {
                    "asset": asset,
                    "trim_segments": [],
                    "duration_ms": int((asset.get("duration") or 0) * 1000),
                }
            
            for trim_seg in trim_segments:
                if trim_seg.asset_id and trim_seg.asset_id in asset_segments:
                    asset_segments[trim_seg.asset_id]["trim_segments"].append({
                        "start": trim_seg.start,
                        "end": trim_seg.end,
                    })
        
        # 合并重叠的修剪片段
        def merge_overlapping_segments(segments):
            if not segments:
                return []
            sorted_segs = sorted(segments, key=lambda x: x["start"])
            merged = [sorted_segs[0]]
            for seg in sorted_segs[1:]:
                if seg["start"] <= merged[-1]["end"]:
                    merged[-1]["end"] = max(merged[-1]["end"], seg["end"])
                else:
                    merged.append(seg)
            return merged
        
        # 计算保留片段
        created_clips = []
        total_removed_duration = 0
        clip_start_time = 0  # 全局时间轴上的起始时间
        
        # 获取主轨道 (tracks 表没有 track_type，通过 order_index=0 判断主轨道)
        track_result = supabase.table("tracks").select("id").eq("project_id", project_id).eq("order_index", 0).single().execute()
        if not track_result.data:
            # 创建默认主轨道 (tracks 表只有 name, order_index 等字段，没有 track_type)
            track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": track_id,
                "project_id": project_id,
                "name": "主轨道",
                "order_index": 0,
                "created_at": now,
            }).execute()
        else:
            track_id = track_result.data["id"]
        
        # 删除现有的 clips（通过 asset_ids 删除）
        asset_ids_list = list(asset_segments.keys())
        if asset_ids_list:
            supabase.table("clips").delete().in_("asset_id", asset_ids_list).execute()
        
        for asset_id, asset_data in asset_segments.items():
            asset = asset_data["asset"]
            duration_ms = asset_data["duration_ms"]
            trim_segs = merge_overlapping_segments(asset_data["trim_segments"])
            
            logger.info(f"[ApplyTrimming] Asset {asset_id}: duration={duration_ms}ms, trim_segs={len(trim_segs)}")
            for i, seg in enumerate(trim_segs):
                logger.info(f"[ApplyTrimming]   trim[{i}]: {seg['start']}-{seg['end']}ms")
            
            # 计算被删除的时长
            for seg in trim_segs:
                total_removed_duration += seg["end"] - seg["start"]
            
            # 计算保留片段
            keep_segments = []
            current_pos = 0
            
            for trim_seg in trim_segs:
                if trim_seg["start"] > current_pos:
                    keep_segments.append({
                        "start": current_pos,
                        "end": trim_seg["start"],
                    })
                current_pos = trim_seg["end"]
            
            # 最后一个保留片段
            if current_pos < duration_ms:
                keep_segments.append({
                    "start": current_pos,
                    "end": duration_ms,
                })
            
            logger.info(f"[ApplyTrimming] 计算出 {len(keep_segments)} 个保留片段")
            for i, seg in enumerate(keep_segments):
                logger.info(f"[ApplyTrimming]   keep[{i}]: {seg['start']}-{seg['end']}ms")
            
            # ★ 使用前端传入的 transcript_segments（不再从数据库查询）
            transcript_segments = []
            if request.transcript_segments:
                transcript_segments = [
                    {"text": seg.text, "start": seg.start, "end": seg.end}
                    for seg in request.transcript_segments
                    if not seg.asset_id or seg.asset_id == asset_id
                ]
            
            logger.info(f"[ApplyTrimming] 获取转写结果: {len(transcript_segments)} 个片段")
            if not transcript_segments:
                logger.warning(f"[ApplyTrimming] ⚠️ 无转写结果，clips 将没有 content_text")
            
            def get_text_for_range(start_ms: int, end_ms: int) -> str:
                """根据时间范围提取转写文本"""
                texts = []
                for seg in transcript_segments:
                    seg_start = seg.get("start", 0)
                    seg_end = seg.get("end", 0)
                    # 如果片段与时间范围有交集
                    if seg_end > start_ms and seg_start < end_ms:
                        text = seg.get("text", "").strip()
                        if text:
                            texts.append(text)
                return "".join(texts)
            
            # 为每个保留片段创建 clip
            for i, keep_seg in enumerate(keep_segments):
                clip_id = str(uuid4())  # 完整的 UUID，不能截断
                clip_duration = keep_seg["end"] - keep_seg["start"]
                
                # ★ 提取该时间段的转写文本
                clip_text = get_text_for_range(keep_seg["start"], keep_seg["end"])
                
                clip_data = {
                    "id": clip_id,
                    "track_id": track_id,
                    "asset_id": asset_id,
                    "clip_type": "video",
                    "start_time": clip_start_time,
                    "end_time": clip_start_time + clip_duration,
                    "source_start": keep_seg["start"],
                    "source_end": keep_seg["end"],
                    "content_text": clip_text or None,  # ★ 保存转写文本
                    "created_at": now,
                    "updated_at": now,
                }
                
                text_preview = (clip_text[:50] + "...") if clip_text and len(clip_text) > 50 else (clip_text or "(无文本)")
                logger.info(f"[ApplyTrimming] 创建 clip[{i}]: {keep_seg['start']}-{keep_seg['end']}ms, text={text_preview}")
                
                created_clips.append(clip_data)
                clip_start_time += clip_duration
        
        # 6. 批量插入 clips
        if created_clips:
            supabase.table("clips").insert(created_clips).execute()
        
        # ★★★ 7. 创建字幕轨道和字幕 clips ★★★
        subtitle_clips = []
        text_track_id = None
        
        if request.transcript_segments:
            # 创建字幕轨道
            text_track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": text_track_id,
                "project_id": project_id,
                "name": "字幕",
                "order_index": 1,  # 字幕轨道在视频轨道下方
                "created_at": now,
            }).execute()
            logger.info(f"[ApplyTrimming] 创建字幕轨道: {text_track_id}")
            
            # 收集所有转写片段
            all_transcript_segs = [
                {"text": seg.text, "start": seg.start, "end": seg.end, "asset_id": seg.asset_id}
                for seg in request.transcript_segments
            ]
            
            # 合并所有修剪片段用于过滤
            all_trim_ranges = [{"start": seg.start, "end": seg.end} for seg in trim_segments]
            merged_trim = merge_overlapping_segments(all_trim_ranges)
            
            def is_in_trim_range(start_ms: int, end_ms: int) -> bool:
                """检查时间范围是否在修剪范围内（需要跳过）"""
                for trim in merged_trim:
                    # 如果片段完全在修剪范围内，跳过
                    if start_ms >= trim["start"] and end_ms <= trim["end"]:
                        return True
                    # 如果有大部分重叠（>50%），也跳过
                    overlap_start = max(start_ms, trim["start"])
                    overlap_end = min(end_ms, trim["end"])
                    if overlap_end > overlap_start:
                        overlap = overlap_end - overlap_start
                        duration = end_ms - start_ms
                        if duration > 0 and overlap / duration > 0.5:
                            return True
                return False
            
            def get_adjusted_time(source_time_ms: int) -> int:
                """根据修剪片段调整时间轴位置"""
                adjusted = source_time_ms
                for trim in merged_trim:
                    if trim["end"] <= source_time_ms:
                        # 在此修剪片段之后，需要减去修剪的时长
                        adjusted -= (trim["end"] - trim["start"])
                    elif trim["start"] < source_time_ms < trim["end"]:
                        # 在修剪片段内部，调整到修剪开始位置
                        adjusted -= (source_time_ms - trim["start"])
                return max(0, adjusted)
            
            # 为每个保留的转写片段创建字幕 clip
            for seg_idx, seg in enumerate(all_transcript_segs):
                seg_start = seg.get("start", 0)
                seg_end = seg.get("end", 0)
                seg_text = seg.get("text", "").strip()
                seg_duration = seg_end - seg_start
                
                if seg_duration <= 0 or not seg_text:
                    continue
                
                # 跳过被修剪的片段
                if is_in_trim_range(seg_start, seg_end):
                    continue
                
                # 计算调整后的时间轴位置
                adjusted_start = get_adjusted_time(seg_start)
                adjusted_end = get_adjusted_time(seg_end)
                adjusted_duration = adjusted_end - adjusted_start
                
                if adjusted_duration <= 0:
                    continue
                
                subtitle_clips.append({
                    "id": str(uuid4()),
                    "track_id": text_track_id,
                    "clip_type": "subtitle",
                    "start_time": adjusted_start,
                    "end_time": adjusted_end,
                    "source_start": 0,
                    "source_end": adjusted_duration,
                    "is_muted": False,
                    "content_text": seg_text,
                    "text_style": {
                        "fontSize": 15,
                        "fontColor": "#FFFFFF",
                        "backgroundColor": "transparent",
                        "alignment": "center",
                        "maxWidth": "95%",
                    },
                    "transform": {
                        "x": 0,
                        "y": 150,
                        "scale": 1,
                    },
                    "metadata": {
                        "order_index": seg_idx,
                        "original_start": seg_start,
                        "original_end": seg_end,
                    },
                    "created_at": now,
                    "updated_at": now,
                })
            
            # 批量插入字幕 clips
            if subtitle_clips:
                supabase.table("clips").insert(subtitle_clips).execute()
                logger.info(f"[ApplyTrimming] ✅ 创建 {len(subtitle_clips)} 个字幕 clips")
        
        # 8. 计算总时长（用于返回，projects 表没有 duration 字段，不更新）
        total_duration = sum(c["end_time"] - c["start_time"] for c in created_clips)
        supabase.table("projects").update({
            "updated_at": now,
        }).eq("id", project_id).execute()
        
        # 9. 更新会话状态
        supabase.table("workspace_sessions").update({
            "status": "completed",
            "updated_at": now,
        }).eq("id", session_id).execute()
        
        logger.info(f"[ApplyTrimming] ✅ 修剪完成: 创建 {len(created_clips)} 个视频 clips, {len(subtitle_clips)} 个字幕 clips")
        logger.info(f"[ApplyTrimming]    保留时长: {total_duration}ms, 删除时长: {total_removed_duration}ms")
        
        return ApplyTrimmingResponse(
            status="completed",
            session_id=session_id,
            project_id=project_id,
            clips_created=len(created_clips),
            total_duration_ms=total_duration,
            removed_duration_ms=total_removed_duration,
            clips=[{
                "id": c["id"],
                "start": c["start_time"],
                "duration": c["end_time"] - c["start_time"],
                "source_start": c["source_start"],
                "source_end": c["source_end"],
            } for c in created_clips],
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[ApplyTrimming] ❌ 修剪失败: {e}")
        logger.error(f"[ApplyTrimming] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ B-Roll 片段建议 API (口播视频精修模式)
# ============================================

class BRollAsset(BaseModel):
    """B-Roll 素材"""
    id: str
    thumbnail_url: str
    video_url: str
    source: str  # pexels, local, ai-generated
    duration: int  # 毫秒
    width: int
    height: int
    relevance_score: Optional[float] = None


class ClipSuggestion(BaseModel):
    """AI 片段建议"""
    clip_id: str
    clip_number: int
    text: str
    time_range: dict  # {start: int, end: int}
    suggested_assets: List[BRollAsset]
    selected_asset_id: Optional[str] = None
    
    # B-Roll Agent 分析结果
    need_broll: Optional[bool] = None          # 是否需要 B-Roll
    broll_type: Optional[str] = None           # video/image/none
    broll_reason: Optional[str] = None         # 决策原因
    keywords_en: Optional[List[str]] = None    # 英文搜索关键词
    keywords_cn: Optional[List[str]] = None    # 中文关键词
    suggested_duration_ms: Optional[int] = None  # 建议 B-Roll 时长


class GetClipSuggestionsResponse(BaseModel):
    """获取片段建议响应"""
    status: str
    session_id: str
    project_id: str
    clips: List[ClipSuggestion]
    total_duration_ms: int
    
    # 统计信息
    broll_segments_count: Optional[int] = None      # 需要 B-Roll 的片段数
    total_broll_duration_ms: Optional[int] = None   # B-Roll 总时长


@router.post("/sessions/{session_id}/clip-suggestions", response_model=GetClipSuggestionsResponse)
async def get_clip_suggestions(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    获取 AI 片段建议 (口播视频精修模式)
    
    ★ 根据 ASR 转写结果，为每个片段推荐合适的 B-Roll 素材
    ★ 使用关键词提取 + Pexels 搜索实现
    
    流程:
    1. 获取会话的转写片段（从 detect-fillers 结果）
    2. 对每个片段进行关键词提取
    3. 使用关键词搜索 Pexels B-Roll 素材
    4. 返回片段 + 推荐素材列表
    """
    try:
        user_id = current_user["user_id"]
        
        # 1. 获取会话信息
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        
        # 校验会话归属
        if session_data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        # 2. 获取项目的 clips
        tracks_result = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
        track_ids = [t["id"] for t in (tracks_result.data or [])]
        
        if not track_ids:
            raise HTTPException(status_code=400, detail="项目没有轨道")
        
        clips_result = supabase.table("clips").select("*").in_("track_id", track_ids).order("start_time").execute()
        clips = clips_result.data or []
        
        if not clips:
            raise HTTPException(status_code=400, detail="项目没有片段")
        
        # 3. 收集片段信息用于 B-Roll 分析
        segments_for_analysis = []
        total_duration = 0
        
        for i, clip in enumerate(clips):
            clip_id = clip["id"]
            start_time = clip.get("start_time", 0)
            end_time = clip.get("end_time", 0)
            duration = end_time - start_time
            total_duration += duration
            
            # ★ 直接使用 clips.content_text（由 apply-trimming 保存）
            text = clip.get("content_text", "")
            if not text:
                text = f"片段 {i + 1}"
                logger.warning(f"[ClipSuggestions] clip {clip_id} 无文本内容，使用默认文本")
            
            segments_for_analysis.append({
                "id": clip_id,
                "text": text,
                "start": start_time,
                "end": end_time,
            })
        
        # ★ 使用 B-Roll Agent V2 进行智能分析 (规则引擎为核心)
        from app.services.broll_agent_v2 import BRollAgentV2
        
        agent = BRollAgentV2()
        broll_result = await agent.analyze(
            session_id=session_id,
            segments=segments_for_analysis,
            video_style="口播",
            total_duration_ms=total_duration,
            search_assets=True,  # 自动搜索素材
        )
        
        # 转换为 API 响应格式
        suggestions = []
        for i, decision in enumerate(broll_result.decisions):
            try:
                clip = next((c for c in clips if c["id"] == decision.segment_id), None)
                if not clip:
                    logger.warning(f"[ClipSuggestions] ⚠️ 找不到 clip: {decision.segment_id}")
                    continue
                
                # ★ 直接使用 clips.content_text
                text = clip.get("content_text", "")
                if not text:
                    text = f"片段 {i + 1}"
                
                # 将匹配的素材转换为 BRollAsset
                suggested_assets = []
                for asset in decision.matched_assets:
                    try:
                        suggested_assets.append(BRollAsset(
                            id=asset.get("id", ""),
                            thumbnail_url=asset.get("thumbnail_url", ""),
                            video_url=asset.get("video_url", "") or asset.get("image_url", ""),
                            source=asset.get("source", "pexels"),
                            duration=asset.get("duration_ms", 5000),
                            width=asset.get("width", 1920),
                            height=asset.get("height", 1080),
                            relevance_score=asset.get("relevance_score", 0.8),
                        ))
                    except Exception as asset_err:
                        logger.error(f"[ClipSuggestions] ❌ Asset 转换失败: {asset_err}, asset={asset}")
                
                suggestions.append(ClipSuggestion(
                    clip_id=decision.segment_id,
                    clip_number=i + 1,
                    text=text[:100] if text else f"片段 {i + 1}",
                    time_range={
                        "start": clip.get("start_time", 0), 
                        "end": clip.get("end_time", 0)
                    },
                    suggested_assets=suggested_assets,
                    # 扩展字段
                    need_broll=decision.need_broll,
                    broll_type=decision.broll_type.value if decision.broll_type else "none",
                    broll_reason=decision.reason,
                    keywords_en=decision.keywords_en,
                    keywords_cn=decision.keywords_cn,
                    suggested_duration_ms=decision.suggested_duration_ms,
                ))
            except Exception as decision_err:
                logger.error(f"[ClipSuggestions] ❌ Decision 转换失败: {decision_err}, decision={decision}")
        
        logger.info(f"[ClipSuggestions] ✅ 智能分析完成: {broll_result.broll_segments}/{broll_result.total_segments} 片段需要 B-Roll")
        logger.info(f"[ClipSuggestions] 准备返回响应: suggestions={len(suggestions)}, total_duration={total_duration}")
        
        response = GetClipSuggestionsResponse(
            status="completed",
            session_id=session_id,
            project_id=project_id,
            clips=suggestions,
            total_duration_ms=total_duration,
            # 扩展统计
            broll_segments_count=broll_result.broll_segments,
            total_broll_duration_ms=broll_result.total_broll_duration_ms,
        )
        logger.info(f"[ClipSuggestions] ✅ 响应构建成功")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[ClipSuggestions] ❌ 获取建议失败: {e}")
        logger.error(f"[ClipSuggestions] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ V2: Remotion 配置生成 API
# ============================================

class GetRemotionConfigResponse(BaseModel):
    """V2: Remotion 配置响应"""
    status: str
    session_id: str
    project_id: str
    total_duration_ms: int
    
    # Remotion 配置
    remotion_config: Dict[str, Any]
    
    # 统计信息
    broll_count: int = 0
    text_count: int = 0
    chapter_count: int = 0
    
    # 向后兼容：保留 clips 数组
    clips: Optional[List[ClipSuggestion]] = None


@router.post("/sessions/{session_id}/remotion-config", response_model=GetRemotionConfigResponse)
async def get_remotion_config(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    V2: 生成 Remotion 渲染配置
    
    ★ 分析完整文本内容，生成整体的视频渲染配置
    ★ 包括文字动画、B-Roll 插入点、章节标题
    ★ B-Roll 只提供搜索关键词，前端自行搜索素材
    
    流程:
    1. 获取会话的 clips（detect-fillers V2 已创建）
    2. 过滤掉隐藏的 clips（已被 apply-trimming 标记）
    3. LLM 分析完整文本，生成 Remotion 配置
    4. 返回配置供前端渲染
    """
    try:
        user_id = current_user["user_id"]
        
        # 1. 获取会话信息
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        
        if session_data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        logger.info(f"[RemotionConfig] 开始生成配置: session={session_id}")
        
        # 2. 获取 clips
        asset_ids = session_data.get("uploaded_asset_ids", [])
        if not asset_ids:
            single_asset_id = session_data.get("uploaded_asset_id")
            if single_asset_id:
                asset_ids = [single_asset_id]
        
        if not asset_ids:
            raise HTTPException(status_code=400, detail="会话未关联任何资源")
        
        clips_result = supabase.table("clips").select("*").in_("asset_id", asset_ids).order("start_time").execute()
        all_clips = clips_result.data or []
        
        if not all_clips:
            raise HTTPException(status_code=400, detail="未找到 clips，请先执行智能分析")
        
        logger.info(f"[RemotionConfig] 获取到 {len(all_clips)} 个 clips")
        
        # 3. 计算总时长
        total_duration = sum(
            (c.get("end_time") or 0) - (c.get("start_time") or 0)
            for c in all_clips
            if not (c.get("metadata") or {}).get("hidden", False)
        )
        
        # 4. 调用 Remotion 配置生成器 (V2 两阶段方案)
        from app.services.remotion_generator_v2 import get_remotion_generator_v2
        
        generator = get_remotion_generator_v2()
        config = await generator.generate(
            clips=all_clips,
            total_duration_ms=total_duration,
        )
        
        logger.info(f"[RemotionConfig] ✅ 配置生成成功: {config.broll_count} B-Roll, {config.text_count} 文字")
        
        # 5. 构建响应
        return GetRemotionConfigResponse(
            status="completed",
            session_id=session_id,
            project_id=project_id,
            total_duration_ms=total_duration,
            remotion_config=config.model_dump(),
            broll_count=config.broll_count,
            text_count=config.text_count,
            chapter_count=len(config.chapter_components),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[RemotionConfig] ❌ 生成失败: {e}")
        logger.error(f"[RemotionConfig] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ 文本特效枚举（参考剪映）
# ============================================

class TextEffect(str, Enum):
    """文本特效类型 - 参考剪映"""
    # 入场动画
    NONE = "none"                    # 无特效
    FADE_IN = "fade-in"              # 淡入
    TYPEWRITER = "typewriter"        # 打字机（逐字出现）
    SLIDE_UP = "slide-up"            # 从下滑入
    SLIDE_DOWN = "slide-down"        # 从上滑入
    SLIDE_LEFT = "slide-left"        # 从右滑入
    SLIDE_RIGHT = "slide-right"      # 从左滑入
    ZOOM_IN = "zoom-in"              # 放大出现
    ZOOM_OUT = "zoom-out"            # 缩小出现
    BOUNCE = "bounce"                # 弹跳出现
    SHAKE = "shake"                  # 抖动
    ROTATE_IN = "rotate-in"          # 旋转入场
    BLUR_IN = "blur-in"              # 模糊淡入
    
    # 循环动画
    PULSE = "pulse"                  # 脉冲（呼吸）
    FLOAT = "float"                  # 漂浮
    GLOW = "glow"                    # 发光
    NEON = "neon"                    # 霓虹灯闪烁
    
    # 组合特效（抖音/小红书风格）
    DOUYIN_SUBTITLE = "douyin-subtitle"    # 抖音字幕风格
    KEYWORD_HIGHLIGHT = "keyword-highlight"  # 关键词高亮


# 默认文本特效（一键成片使用）
DEFAULT_TEXT_EFFECT = TextEffect.FADE_IN


# ============================================
# ★ V3: 生成 B-Roll Clips 并保存到数据库
# ============================================

class TextClipInfo(BaseModel):
    """单个文本 clip 信息"""
    clip_id: str
    start_ms: int
    end_ms: int
    text: str
    position: str = "center"  # ★ 位置
    effect_type: str = "fade-in"  # ★ 特效类型
    text_style: Dict[str, Any] = {}  # ★ 样式

class BRollClipInfo(BaseModel):
    """单个 B-Roll clip 信息"""
    clip_id: str
    task_id: str
    start_ms: int
    end_ms: int
    search_keywords: List[str]
    pexels_video_id: Optional[int] = None
    thumbnail: Optional[str] = None

class GenerateBRollClipsResponse(BaseModel):
    """生成 B-Roll Clips 响应（★ 只生成 B-Roll 镜头，不生成文本）"""
    status: str
    session_id: str
    project_id: str
    broll_clips_created: int = 0
    broll_track_id: str = ""
    broll_clips: List[BRollClipInfo] = []
    message: str = ""
    remotion_config: Optional[dict] = None


@router.post("/sessions/{session_id}/generate-broll-clips", response_model=GenerateBRollClipsResponse)
async def generate_broll_clips(
    session_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    ★ 生成 B-Roll clips
    
    核心改动：broll 是 video clip 的子类型（和手动拖拽 Pexels 一致）
    
    流程：
    1. 获取会话的 clips（主视频）
    2. 调用 LLM 生成 B-Roll 配置（插入点、搜索关键词、时长）
    3. 为每个 B-Roll 自动搜索 Pexels
    4. 启动异步下载任务，每个任务完成后会：
       - 创建 asset
       - 创建 video 类型的 clip（关联 asset_id，metadata.is_broll=true）
    5. 立即返回（前端可以轮询检测 clips 是否创建完成）
    """
    import httpx
    from app.tasks.broll_download import download_broll_video, set_download_progress
    
    PEXELS_API_KEY = os.getenv("PEXELS_API_KEY", "")
    PEXELS_API_URL = "https://api.pexels.com/videos/search"
    
    try:
        user_id = current_user["user_id"]
        
        # 1. 获取会话信息
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        
        if session_data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        logger.info(f"[GenerateBRollClips] 开始生成 B-Roll clips: session={session_id}")
        
        # ★★★ 2.1 读取 B-Roll 配置 ★★★
        processing_steps = session_data.get("processing_steps") or {}
        broll_display_mode = processing_steps.get("broll_display_mode", "fullscreen")  # fullscreen | pip | mixed
        broll_pip_config = processing_steps.get("broll_pip_config") or {}
        broll_mixed_config = processing_steps.get("broll_mixed_config") or {}
        broll_face_detection = processing_steps.get("broll_face_detection", False)
        
        logger.info(f"[GenerateBRollClips] ★ B-Roll 配置: mode={broll_display_mode}, pip_config={broll_pip_config}, face_detect={broll_face_detection}")
        
        # 2. 获取原始 clips（主视频）
        asset_ids = session_data.get("uploaded_asset_ids", [])
        if not asset_ids:
            single_asset_id = session_data.get("uploaded_asset_id")
            if single_asset_id:
                asset_ids = [single_asset_id]
        
        if not asset_ids:
            raise HTTPException(status_code=400, detail="会话未关联任何资源")
        
        # ★★★ 2.5 获取主视频宽高比 ★★★
        from app.services.video_utils import (
            get_pexels_orientation,
            AspectRatio,
            get_broll_fit_info,  # ★ 改用新的 fit_info（支持 letterbox）
        )
        
        # 优先使用项目目标分辨率（强制 9:16 / 16:9）
        project_result = supabase.table("projects").select("resolution").eq("id", project_id).single().execute()
        project_resolution = (project_result.data or {}).get("resolution") or {}
        target_width = project_resolution.get("width")
        target_height = project_resolution.get("height")

        if target_width and target_height:
            target_aspect_ratio = AspectRatio.RATIO_16_9 if target_width >= target_height else AspectRatio.RATIO_9_16
            main_video_width = target_width
            main_video_height = target_height
            logger.info(f"[GenerateBRollClips] ★ 使用项目分辨率作为目标比例: {target_width}x{target_height}")
        else:
            # 回退：使用主视频 asset 信息
            main_asset_result = supabase.table("assets").select("width, height").in_("id", asset_ids).limit(1).execute()
            main_asset = main_asset_result.data[0] if main_asset_result.data else {}
            main_video_width = main_asset.get("width", 1920)
            main_video_height = main_asset.get("height", 1080)
            target_aspect_ratio = AspectRatio.RATIO_16_9 if main_video_width >= main_video_height else AspectRatio.RATIO_9_16
        pexels_orientation = get_pexels_orientation(target_aspect_ratio)
        
        logger.info(f"[GenerateBRollClips] ★ 主视频尺寸: {main_video_width}x{main_video_height}")
        logger.info(f"[GenerateBRollClips] ★ 目标宽高比: {target_aspect_ratio.value}, Pexels方向: {pexels_orientation}")
        
        clips_result = supabase.table("clips").select("*").in_("asset_id", asset_ids).order("start_time").execute()
        all_clips = clips_result.data or []
        
        if not all_clips:
            raise HTTPException(status_code=400, detail="未找到 clips，请先执行智能分析")
        
        logger.info(f"[GenerateBRollClips] 获取到 {len(all_clips)} 个主视频 clips")
        
        # 3. 计算总时长
        total_duration = sum(
            (c.get("end_time") or 0) - (c.get("start_time") or 0)
            for c in all_clips
            if not (c.get("metadata") or {}).get("hidden", False)
        )
        
        # ★★★ 3.5 如果是 PiP 模式且开启人脸检测，执行人脸检测 ★★★
        face_detection_result = None
        if broll_display_mode in ("pip", "mixed") and broll_face_detection:
            try:
                from app.services.face_detector import get_face_detector
                
                # 获取主视频文件路径
                main_asset_full = supabase.table("assets").select("file_url, storage_path").in_("id", asset_ids).limit(1).execute()
                if main_asset_full.data:
                    asset_info = main_asset_full.data[0]
                    video_path = asset_info.get("storage_path") or asset_info.get("file_url", "")
                    
                    if video_path and os.path.exists(video_path):
                        detector = get_face_detector()
                        face_detection_result = detector.detect_from_video(
                            video_path=video_path,
                            sample_interval_ms=2000,  # 每 2 秒采样
                            max_samples=20,
                        )
                        logger.info(f"[GenerateBRollClips] ★ 人脸检测完成: dominant_region={face_detection_result.dominant_region is not None}, safe_positions={face_detection_result.safe_pip_positions}")
                    else:
                        logger.warning(f"[GenerateBRollClips] ⚠️ 视频路径不存在，跳过人脸检测: {video_path}")
            except Exception as face_err:
                logger.warning(f"[GenerateBRollClips] ⚠️ 人脸检测失败（非致命）: {face_err}")
        
        # 4. 调用 Remotion 配置生成器获取 B-Roll 配置 (V2 两阶段方案)
        from app.services.remotion_generator_v2 import get_remotion_generator_v2
        
        # ★★★ 根据用户配置确定默认显示模式 ★★★
        # mixed 模式下，generator 生成的 B-Roll 会混合使用 fullscreen 和 pip
        # 这里传入 fullscreen 作为默认，后续根据 mixed_config 调整
        effective_display_mode = "fullscreen" if broll_display_mode == "fullscreen" else "pip" if broll_display_mode == "pip" else "fullscreen"
        
        generator = get_remotion_generator_v2()
        config = await generator.generate(
            clips=all_clips,
            total_duration_ms=total_duration,
            target_aspect_ratio=target_aspect_ratio.value,  # ★ 传入主视频宽高比
            default_display_mode=effective_display_mode,  # ★ 使用用户配置的模式
        )
        
        logger.info(f"[GenerateBRollClips] 配置生成成功: {config.broll_count} B-Roll, mode={broll_display_mode}")
        
        if config.broll_count == 0:
            return GenerateBRollClipsResponse(
                status="completed",
                session_id=session_id,
                project_id=project_id,
                broll_clips_created=0,
                message="没有生成 B-Roll 建议",
            )
        
        now = datetime.utcnow().isoformat()
        
        # 5. ★★★ 直接创建新的 B-Roll track（这批 clips 共享） ★★★
        # ★★★ 轨道层级设计 ★★★
        # - 0-9: 主视频轨道
        # - 10-49: B-Roll 轨道（在主视频之上，但在文本/字幕之下）
        # - 50-99: 图片/贴纸轨道
        # - 100+: 文本/字幕轨道（始终在最上层）
        tracks_result = supabase.table("tracks").select("order_index, name").eq("project_id", project_id).execute()
        tracks = tracks_result.data or []
        
        # 找到 B-Roll 轨道范围内的最大 order_index (10-49)
        broll_orders = [t.get("order_index", 0) for t in tracks if 10 <= t.get("order_index", 0) < 50]
        broll_order = max(broll_orders, default=9) + 1  # 从 10 开始
        if broll_order >= 50:
            broll_order = 49  # 不能超过 B-Roll 层级范围
        
        broll_track_id = str(uuid4())
        broll_track_data = {
            "id": broll_track_id,
            "project_id": project_id,
            "name": "B-Roll",
            "order_index": broll_order,  # ★ B-Roll 固定在 10-49 层级范围
            "is_visible": True,
            "is_locked": False,
            "is_muted": False,
            "created_at": now,
            "updated_at": now,
        }
        supabase.table("tracks").insert(broll_track_data).execute()
        logger.info(f"[GenerateBRollClips] ✨ 创建 B-Roll track: {broll_track_id}, order_index={broll_order}")
        
        # ★★★ 不再创建文本轨道和文本 clips（只做 B-Roll 镜头）★★★
        
        # 6. ★★★ 为每个 B-Roll 搜索 Pexels 并启动下载任务 ★★★
        # 下载任务完成后会自动创建 asset + video clip
        broll_clips_info: List[BRollClipInfo] = []
        download_tasks_count = 0
        
        async with httpx.AsyncClient() as client:
            for broll in config.broll_components:
                task_id = str(uuid4())
                
                # 构建搜索关键词（合并为一个搜索词）
                search_query = " ".join(broll.search_keywords[:3])
                
                # ★★★ 搜索 Pexels - 使用主视频的方向参数 ★★★
                pexels_video = None
                if PEXELS_API_KEY:
                    try:
                        response = await client.get(
                            PEXELS_API_URL,
                            params={
                                "query": search_query, 
                                "per_page": 1, 
                                "orientation": pexels_orientation  # ★ 使用主视频的方向
                            },
                            headers={"Authorization": PEXELS_API_KEY},
                            timeout=10.0
                        )
                        
                        if response.status_code == 200:
                            data = response.json()
                            videos = data.get("videos", [])
                            if videos:
                                pexels_video = videos[0]
                                logger.info(f"[GenerateBRollClips] ✅ Pexels 找到素材 ({pexels_orientation}): {pexels_video.get('id')} for '{search_query}'")
                    except Exception as e:
                        logger.warning(f"[GenerateBRollClips] Pexels 搜索失败: {e}")
                
                if not pexels_video:
                    logger.warning(f"[GenerateBRollClips] ⚠️ 未找到素材: {search_query}")
                    continue
                
                # ★★★ 获取视频 URL - 限制文件大小在 30MB 以内 ★★★
                MAX_FILE_SIZE_MB = 30
                MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
                
                video_files = pexels_video.get("video_files", [])
                best_file = None
                
                # 按优先级排序：HD 质量 + 文件大小限制
                # Pexels 的 video_files 包含 file_type, width, height, link, size (可能没有 size 字段)
                hd_files = [vf for vf in video_files if vf.get("quality") == "hd" and vf.get("width", 0) >= 1280]
                sd_files = [vf for vf in video_files if vf.get("quality") == "sd"]
                
                # 优先选择 HD，但要小于 30MB
                for vf in sorted(hd_files, key=lambda x: x.get("width", 0), reverse=True):
                    # Pexels 不一定返回 size 字段，但 HD 720p 通常 < 30MB
                    file_size = vf.get("size", 0)
                    # 如果有 size 字段且超过限制，跳过
                    if file_size > 0 and file_size > MAX_FILE_SIZE_BYTES:
                        logger.info(f"[GenerateBRollClips] 跳过过大文件: {file_size / 1024 / 1024:.1f}MB > {MAX_FILE_SIZE_MB}MB")
                        continue
                    # 优先选择 720p（通常 < 30MB）
                    if vf.get("height", 0) <= 720:
                        best_file = vf
                        break
                
                # 如果没有合适的 HD，尝试 SD
                if not best_file:
                    for vf in sorted(sd_files, key=lambda x: x.get("width", 0), reverse=True):
                        file_size = vf.get("size", 0)
                        if file_size > 0 and file_size > MAX_FILE_SIZE_BYTES:
                            continue
                        best_file = vf
                        break
                
                # 最后兜底：选择分辨率最小的
                if not best_file and video_files:
                    best_file = min(video_files, key=lambda x: x.get("width", 0) * x.get("height", 0))
                    logger.info(f"[GenerateBRollClips] ⚠️ 兜底选择最小分辨率: {best_file.get('width')}x{best_file.get('height')}")
                
                if not best_file:
                    continue
                
                video_url = best_file.get("link")
                thumbnail = pexels_video.get("image")
                
                # 设置初始下载状态
                set_download_progress(task_id, {
                    "status": "pending",
                    "progress": 0,
                    "asset_id": "",
                    "message": "任务排队中..."
                })
                
                # ★★★ 计算 B-Roll 适配信息（fullscreen 使用 letterbox，不裁剪）★★★
                broll_width = best_file.get("width", 1920)
                broll_height = best_file.get("height", 1080)
                
                # ★★★ 根据用户配置决定每个 B-Roll 的显示模式 ★★★
                original_display_mode = broll.display_mode.value if hasattr(broll.display_mode, 'value') else broll.display_mode
                
                if broll_display_mode == "mixed":
                    # Mixed 模式：根据 pip_ratio 随机决定
                    import random
                    pip_ratio = broll_mixed_config.get("pip_ratio", 0.3)  # 默认 30% 为 PiP
                    final_display_mode = "pip" if random.random() < pip_ratio else "fullscreen"
                elif broll_display_mode == "pip":
                    final_display_mode = "pip"
                else:
                    final_display_mode = "fullscreen"
                
                # ★★★ PiP 模式下计算安全位置（避开人脸） ★★★
                pip_position_info = None
                if final_display_mode == "pip":
                    pip_size_map = {"small": 0.2, "medium": 0.3, "large": 0.4}
                    pip_size = pip_size_map.get(broll_pip_config.get("size", "medium"), 0.3)
                    default_position = broll_pip_config.get("default_position", "bottom-right")
                    margin = broll_pip_config.get("margin", 0.02)
                    
                    if face_detection_result and face_detection_result.dominant_region:
                        # 有人脸检测结果，计算安全位置
                        from app.services.face_detector import get_face_detector
                        detector = get_face_detector()
                        safe_x, safe_y, safe_position = detector.get_safe_pip_position(
                            faces=[face_detection_result.dominant_region],
                            pip_size=pip_size,
                            margin=margin,
                            preferred_position=default_position,
                        )
                        pip_position_info = {
                            "size": pip_size,
                            "position": safe_position,
                            "x": safe_x,
                            "y": safe_y,
                            "face_avoided": safe_position != default_position,
                            "margin": margin,
                            "border_radius": broll_pip_config.get("border_radius", 8),
                        }
                        logger.info(f"[GenerateBRollClips] ★ PiP 位置: {safe_position} (首选={default_position}, 避让={safe_position != default_position})")
                    else:
                        # 无人脸检测结果，使用默认位置
                        from app.services.face_detector import get_pip_position_coords
                        pip_x, pip_y = get_pip_position_coords(default_position, pip_size, margin)
                        pip_position_info = {
                            "size": pip_size,
                            "position": default_position,
                            "x": pip_x,
                            "y": pip_y,
                            "face_avoided": False,
                            "margin": margin,
                            "border_radius": broll_pip_config.get("border_radius", 8),
                        }
                
                fit_info = get_broll_fit_info(
                    broll_width, broll_height, target_aspect_ratio,
                    display_mode=final_display_mode,  # ★ 使用最终确定的显示模式
                )
                
                # ★★★ 启动下载任务（下载完成后自动创建 asset + video clip） ★★★
                video_data = {
                    "id": pexels_video.get("id"),
                    "url": video_url,
                    "width": best_file.get("width"),
                    "height": best_file.get("height"),
                    "duration": pexels_video.get("duration"),
                    "thumbnail": thumbnail,
                    "source": "pexels",
                    "author": pexels_video.get("user", {}).get("name", ""),
                    "author_url": pexels_video.get("user", {}).get("url", ""),
                    "original_url": pexels_video.get("url", ""),
                }
                
                # B-Roll 时间范围信息（增加裁剪和目标宽高比信息）
                broll_time_info = {
                    "start_ms": broll.start_ms,
                    "end_ms": broll.end_ms,
                    "search_keywords": broll.search_keywords,
                    "display_mode": final_display_mode,  # ★ 使用最终确定的显示模式
                    # ★★★ 新增：目标宽高比和适配信息（letterbox/pillarbox）★★★
                    "target_aspect_ratio": target_aspect_ratio.value,
                    "target_width": main_video_width,
                    "target_height": main_video_height,
                    "fit_info": fit_info,  # ★ 包含 letterbox_params 或 crop_params
                    # ★★★ 新增：PiP 位置信息（如果是 PiP 模式）★★★
                    "pip_position_info": pip_position_info,
                }
                
                # ★ 启动下载任务，传入 track_id（这批 B-Roll 共享同一个 track）
                download_broll_video.delay(
                    task_id=task_id,
                    user_id=user_id,
                    project_id=project_id,
                    video_data=video_data,
                    track_id=broll_track_id,
                    broll_time_info=broll_time_info,
                )
                
                download_tasks_count += 1
                pip_info = f", pip_pos={pip_position_info.get('position')}" if pip_position_info else ""
                logger.info(f"[GenerateBRollClips] 🚀 启动下载任务: {task_id}, mode={final_display_mode}, 适配={fit_info.get('fit_mode')}{pip_info}")
                
                # 记录 clip 信息供前端轮询
                broll_clips_info.append(BRollClipInfo(
                    clip_id="",  # 下载完成后才有
                    task_id=task_id,
                    start_ms=broll.start_ms,
                    end_ms=broll.end_ms,
                    search_keywords=broll.search_keywords,
                    pexels_video_id=pexels_video.get("id"),
                    thumbnail=thumbnail,
                ))
        
        # 7. 更新会话状态
        supabase.table("workspace_sessions").update({
            "workflow_step": "completed",
            "updated_at": now,
        }).eq("id", session_id).execute()
        
        return GenerateBRollClipsResponse(
            status="completed",
            session_id=session_id,
            project_id=project_id,
            broll_clips_created=download_tasks_count,
            broll_track_id=broll_track_id,
            broll_clips=broll_clips_info,
            message=f"已启动 {download_tasks_count} 个 B-Roll 下载任务",
            remotion_config=config.model_dump(),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[GenerateBRollClips] ❌ 生成失败: {e}")
        logger.error(f"[GenerateBRollClips] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# ★ Remotion Agent API (知识博主视觉编排)
# ============================================

class GenerateVisualConfigRequest(BaseModel):
    """生成视觉配置请求"""
    template: Optional[str] = "whiteboard"  # whiteboard | talking-head
    pip_position: Optional[str] = "bottom-right"  # 口播小窗位置


class VisualConfigResponse(BaseModel):
    """视觉配置响应"""
    status: str
    session_id: str
    project_id: str
    
    # 视觉配置
    visual_config: Dict[str, Any]
    
    # 统计信息
    segment_count: int = 0
    canvas_count: int = 0
    overlay_count: int = 0
    
    # 元信息
    template_used: str = "whiteboard"
    pip_position: str = "bottom-right"


@router.post("/sessions/{session_id}/visual-config", response_model=VisualConfigResponse)
async def generate_visual_config(
    session_id: str,
    request: GenerateVisualConfigRequest = GenerateVisualConfigRequest(),
    current_user: dict = Depends(get_current_user)
):
    """
    ★ Remotion Agent: 为知识类博主生成智能视觉编排配置
    
    这是一个为知识/教育内容创作者设计的高级视觉编排系统：
    - 自动识别内容结构（提问、要点、流程、结论等）
    - 生成画布配置（要点列表、流程图、对比表）
    - 生成叠加组件（关键词卡片、数据展示、高亮框）
    - 支持多种模板风格（白板讲解、口播主导）
    
    流程:
    1. 获取会话的 transcript segments
    2. Stage 2: 分析内容结构（角色、类型、要点）
    3. Stage 3: 根据结构生成视觉配置
    4. 返回配置供前端 Remotion 渲染
    """
    try:
        user_id = current_user["user_id"]
        
        # 1. 获取会话信息
        session = supabase.table("workspace_sessions").select("*").eq("id", session_id).single().execute()
        if not session.data:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        session_data = session.data
        project_id = session_data.get("project_id")
        
        if session_data.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权操作此会话")
        
        logger.info(f"[VisualConfig] 开始生成视觉配置: session={session_id}, template={request.template}")
        
        # 2. 获取 transcript segments
        asset_ids = session_data.get("uploaded_asset_ids", [])
        if not asset_ids:
            single_asset_id = session_data.get("uploaded_asset_id")
            if single_asset_id:
                asset_ids = [single_asset_id]
        
        if not asset_ids:
            raise HTTPException(status_code=400, detail="会话未关联任何资源")
        
        # 从 assets 表获取 transcript
        assets_result = supabase.table("assets").select("id, transcript").in_("id", asset_ids).execute()
        assets = assets_result.data or []
        
        if not assets:
            raise HTTPException(status_code=400, detail="未找到资源信息")
        
        # 合并所有 segments
        all_segments = []
        for asset in assets:
            transcript = asset.get("transcript") or {}
            segments = transcript.get("segments", [])
            for seg in segments:
                all_segments.append({
                    "id": seg.get("id", str(uuid4())),
                    "text": seg.get("text", ""),
                    "start_ms": int(seg.get("start", 0) * 1000),
                    "end_ms": int(seg.get("end", 0) * 1000),
                    "asset_id": asset.get("id"),
                })
        
        if not all_segments:
            raise HTTPException(status_code=400, detail="未找到字幕数据，请先执行 ASR 处理")
        
        logger.info(f"[VisualConfig] 获取到 {len(all_segments)} 个 segments")
        
        # 3. 调用 Remotion Agent
        from app.services.remotion_agent import analyze_content_structure, generate_visual_config as gen_visual
        from app.services.remotion_agent.templates import get_template
        
        # 获取模板配置
        template = get_template(request.template or "whiteboard")
        
        # Stage 2: 内容结构分析
        structured_segments = await analyze_content_structure(all_segments)
        logger.info(f"[VisualConfig] Stage 2 完成: {len(structured_segments)} 个结构化片段")
        
        # Stage 3: 生成视觉配置
        visual_config = gen_visual(
            segments=structured_segments,
            template=template,
            pip_position=request.pip_position or "bottom-right",
        )
        logger.info(f"[VisualConfig] Stage 3 完成: canvas={len(visual_config.canvas)}, overlays={len(visual_config.overlays)}")
        
        # 4. 构建响应
        return VisualConfigResponse(
            status="completed",
            session_id=session_id,
            project_id=project_id,
            visual_config=visual_config.model_dump(),
            segment_count=len(structured_segments),
            canvas_count=len(visual_config.canvas),
            overlay_count=len(visual_config.overlays),
            template_used=request.template or "whiteboard",
            pip_position=request.pip_position or "bottom-right",
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[VisualConfig] ❌ 生成失败: {e}")
        logger.error(f"[VisualConfig] ❌ 完整堆栈:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 辅助函数
# ============================================

import re


class SessionCancelledException(Exception):
    """会话被用户取消的异常"""
    pass


def _check_session_cancelled(session_id: str) -> bool:
    """
    检查会话是否被取消
    
    Args:
        session_id: 会话 ID
        
    Returns:
        True 如果会话已被取消，False 否则
    """
    try:
        result = supabase.table("workspace_sessions").select("status").eq("id", session_id).single().execute()
        if result.data:
            return result.data.get("status") == "cancelled"
        return False
    except Exception as e:
        logger.warning(f"[Workspace] 检查会话状态失败: {e}")
        return False


def _raise_if_cancelled(session_id: str, step_name: str = ""):
    """
    如果会话已取消，抛出异常终止处理
    
    Args:
        session_id: 会话 ID
        step_name: 当前步骤名称（用于日志）
    """
    if _check_session_cancelled(session_id):
        step_info = f" (步骤: {step_name})" if step_name else ""
        logger.info(f"[Workspace] 🛑 会话 {session_id} 被取消，终止处理{step_info}")
        raise SessionCancelledException(f"会话 {session_id} 已被用户取消")


def _split_by_max_length(text: str, max_length: int) -> list:
    """
    按最大长度智能切分文本
    
    切分策略（按优先级）：
    1. 优先在空格处切分（适合英文）
    2. 其次在中文常见停顿词后切分（的、是、在、了、和、与、或）
    3. 最后强制按长度切分
    
    Args:
        text: 待切分的文本
        max_length: 每段最大字符数
        
    Returns:
        切分后的文本列表
    """
    if len(text) <= max_length:
        return [text]
    
    result = []
    remaining = text
    
    while len(remaining) > max_length:
        # 在 max_length 范围内寻找最佳切分点
        chunk = remaining[:max_length]
        
        # 策略1：寻找空格切分点（英文）
        space_idx = chunk.rfind(' ')
        if space_idx > max_length // 2:  # 确保切分点不会太靠前
            result.append(chunk[:space_idx].strip())
            remaining = remaining[space_idx:].strip()
            continue
        
        # 策略2：寻找中文停顿词切分点
        stop_words = ['的', '是', '在', '了', '和', '与', '或', '也', '都', '就', '而', '但', '很', '更']
        best_stop_idx = -1
        for word in stop_words:
            idx = chunk.rfind(word)
            if idx > max_length // 2 and idx > best_stop_idx:
                best_stop_idx = idx + len(word)  # 切分点在停顿词之后
        
        if best_stop_idx > 0:
            result.append(chunk[:best_stop_idx].strip())
            remaining = remaining[best_stop_idx:].strip()
            continue
        
        # 策略3：强制按长度切分
        result.append(chunk.strip())
        remaining = remaining[max_length:].strip()
    
    if remaining:
        result.append(remaining.strip())
    
    return result


def _split_segments_by_punctuation(segments: list, max_chars_per_line: int = 20) -> list:
    """
    将 ASR segments 按标点符号进一步切分成更细的子句
    
    切分规则：
    1. 中文标点：，。！？；
    2. 英文标点：,.!?;
    3. 根据文本长度按比例分配时间
    4. 单行最大字符数限制（防止字幕过长超出屏幕）
    
    Args:
        segments: ASR 返回的 segments 列表，每个包含 start, end, text
        max_chars_per_line: 单行最大字符数，15号字体下建议20字符
        
    Returns:
        细分后的 segments 列表
    """
    # 标点符号正则：匹配中英文逗号、句号、问号、感叹号、分号
    punctuation_pattern = re.compile(r'([，。！？；,.!?;])')
    
    fine_segments = []
    
    for seg in segments:
        text = seg.get("text", "").strip()
        start_ms = seg.get("start", 0)
        end_ms = seg.get("end", 0)
        total_duration = end_ms - start_ms
        
        if not text or total_duration <= 0:
            continue
        
        # 按标点切分文本
        parts = punctuation_pattern.split(text)
        
        # 重新组合：将标点符号与前面的文本合并
        sentences = []
        buffer = ""
        for part in parts:
            buffer += part
            if punctuation_pattern.match(part):
                if buffer.strip():
                    sentences.append(buffer.strip())
                buffer = ""
        # 处理最后没有标点的部分
        if buffer.strip():
            sentences.append(buffer.strip())
        
        # 如果只有一个句子或没有切分，检查是否需要按长度切分
        if len(sentences) <= 1:
            # 检查是否超过最大长度
            if len(text) <= max_chars_per_line:
                fine_segments.append(seg)
                continue
            else:
                # 按最大长度切分
                sentences = _split_by_max_length(text, max_chars_per_line)
        else:
            # 对每个句子检查长度，过长的进一步切分
            expanded_sentences = []
            for s in sentences:
                if len(s) > max_chars_per_line:
                    expanded_sentences.extend(_split_by_max_length(s, max_chars_per_line))
                else:
                    expanded_sentences.append(s)
            sentences = expanded_sentences
        
        # 按字符数比例分配时间
        total_chars = sum(len(s) for s in sentences)
        if total_chars == 0:
            fine_segments.append(seg)
            continue
        
        current_time = start_ms
        for sentence in sentences:
            char_ratio = len(sentence) / total_chars
            duration = int(total_duration * char_ratio)
            
            # 确保至少有 100ms
            duration = max(duration, 100)
            
            fine_segments.append({
                "id": seg.get("id"),
                "text": sentence,
                "start": current_time,
                "end": current_time + duration,
                "speaker": seg.get("speaker"),
            })
            
            current_time += duration
    
    return fine_segments


def _generate_project_name(request: CreateSessionRequest) -> str:
    """生成项目名称"""
    if request.file_name:
        name = request.file_name.rsplit(".", 1)[0]
        return name[:50]
    elif request.source_url:
        return f"YouTube 视频 - {datetime.now().strftime('%m/%d %H:%M')}"
    else:
        return f"新项目 - {datetime.now().strftime('%Y-%m-%d %H:%M')}"


def _create_progress_updater(session_id: str):
    """
    创建进度更新器函数
    
    内置节流：只在进度变化 ≥1% 或步骤变化时才真正更新数据库
    避免频繁写入造成性能问题
    """
    last_progress = {"step": None, "value": -1}
    
    def update_progress(step: str, progress: int):
        # 节流：只在进度变化 ≥1% 或步骤变化时才更新
        if step == last_progress["step"] and progress == last_progress["value"]:
            return  # 完全相同，跳过
        
        if step == last_progress["step"] and abs(progress - last_progress["value"]) < 1:
            return  # 同一步骤，进度变化 <1%，跳过
        
        last_progress["step"] = step
        last_progress["value"] = progress
        
        supabase.table("workspace_sessions").update({
            "current_step": step,
            "progress": progress,
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", session_id).execute()
    
    return update_progress


async def _fetch_asset_metadata(asset_id: str, file_url: str) -> dict:
    """提取资源元数据（宽高、帧率、编码等，duration 由前端提供）"""
    try:
        from ..tasks.asset_processing import extract_media_metadata
        logger.info(f"[Workspace] 正在提取元数据: {file_url[:80]}...")
        metadata = await extract_media_metadata(file_url)
        logger.debug(f"[Workspace] 提取到的元数据: {metadata}")
        
        # ★ 检测视频编码，判断浏览器是否支持
        video_codec = metadata.get("codec", "")
        # 浏览器原生支持的编码格式
        BROWSER_SUPPORTED_CODECS = {"h264", "avc1", "vp8", "vp9", "av1", "hevc", "h265"}
        needs_transcode = video_codec and video_codec.lower() not in BROWSER_SUPPORTED_CODECS
        if needs_transcode:
            logger.warning(f"[Workspace] ⚠️ 视频编码 {video_codec} 需要转码为 H.264")
        
        # duration 由前端提供，这里只更新宽高、帧率、编码等信息
        supabase.table("assets").update({
            "width": metadata.get("width", 1920),
            "height": metadata.get("height", 1080),
            "fps": metadata.get("fps", 30),
            "sample_rate": metadata.get("sample_rate"),
            "channels": metadata.get("channels"),
            "status": "ready",
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", asset_id).execute()
        
        # 返回完整元数据，包括编码信息
        metadata["needs_transcode"] = needs_transcode
        return metadata
    except Exception as e:
        logger.warning(f"[Workspace] ❌ 提取元数据失败: {e}, 使用默认值")
        supabase.table("assets").update({
            "status": "ready",
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", asset_id).execute()
        return {"duration": 0, "width": 1920, "height": 1080, "fps": 30, "needs_transcode": False}


async def _extract_audio_for_asr(video_url: str, asset_id: str, update_progress, current_progress: int, video_duration_sec: float = None) -> str:
    """
    从视频中提取压缩音频，用于 ASR 转写
    
    优化策略:
    - 16kHz 采样率（语音识别足够）
    - 单声道
    - 64kbps 码率
    - 4GB 视频 → 约 20MB 音频，上传速度提升 99%
    - ★ 缓存复用：如果音频已提取过，直接返回缓存 URL
    - ★ 实时进度：解析 FFmpeg 输出更新进度
    
    Args:
        video_url: 视频的签名 URL
        asset_id: 资产 ID（用于存储路径）
        update_progress: 进度回调
        current_progress: 当前进度百分比
        video_duration_sec: 视频时长（秒），用于计算进度
        
    Returns:
        提取后音频的签名 URL
    """
    import tempfile
    import httpx
    import asyncio
    import os
    import re
    
    audio_storage_path = f"asr_audio/{asset_id}.mp3"
    
    # ★★★ 缓存检查：如果音频已存在，直接返回 ★★★
    try:
        # 尝试直接获取签名 URL，如果成功说明文件存在
        from ..services.supabase_client import supabase
        result = supabase.storage.from_("clips").create_signed_url(audio_storage_path, 60)
        cached_url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        if cached_url:
            logger.info(f"[ASR优化] ✅ 使用缓存音频: {audio_storage_path}")
            update_progress("extract_audio", current_progress + 15)
            return cached_url
    except Exception:
        pass  # 缓存不存在或检查失败，继续提取
    
    logger.info(f"[ASR优化] 🎵 开始提取音频 asset_id={asset_id}, duration={video_duration_sec}s")
    
    custom_temp_dir = os.getenv("ASR_TEMP_DIR")
    temp_dir = tempfile.mkdtemp(prefix="asr_", dir=custom_temp_dir)
    logger.info(f"[ASR优化] 📁 临时目录: {temp_dir}")
    
    audio_path = os.path.join(temp_dir, "audio_for_asr.mp3")
    
    try:
        update_progress("extract_audio", current_progress)
        logger.info(f"[ASR优化] 🔧 FFmpeg 流式提取音频...")
        logger.info(f"[ASR优化] 📍 输入 URL: {video_url[:120]}...")
        
        # 检测是否是 HLS (m3u8) 流
        is_hls = 'm3u8' in video_url.lower()
        
        # ★ 优化：添加网络超时和更快的编码参数
        cmd = [
            "ffmpeg", "-y",
            "-reconnect", "1",           # 断线重连
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5", # 最大重连延迟 5 秒
        ]
        
        # HLS 需要额外参数
        if is_hls:
            cmd.extend([
                "-protocol_whitelist", "file,http,https,tcp,tls,crypto",  # 允许的协议
                "-allowed_extensions", "ALL",  # 允许所有扩展名
            ])
        
        cmd.extend([
            "-i", video_url,
            "-vn",                       # 不要视频
            "-ar", "16000",              # 16kHz 采样率
            "-ac", "1",                  # 单声道
            "-b:a", "64k",               # 64kbps 码率
            "-f", "mp3",
            "-progress", "pipe:1",       # ★ 输出进度到 stdout
            audio_path
        ])
        
        logger.info(f"[ASR优化] 🔧 FFmpeg 命令: {' '.join(cmd[:10])}...")
        
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        # ★★★ 实时解析 FFmpeg 进度 ★★★
        last_progress_update = 0
        total_duration_us = (video_duration_sec or 60) * 1_000_000  # 微秒
        
        async def read_progress():
            nonlocal last_progress_update
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                line_str = line.decode().strip()
                # FFmpeg progress 格式: out_time_us=12345678
                if line_str.startswith("out_time_us="):
                    try:
                        current_us = int(line_str.split("=")[1])
                        if total_duration_us > 0:
                            pct = min(current_us / total_duration_us, 1.0)
                            # extract_audio 占 10% 进度（current_progress 到 current_progress + 10）
                            new_progress = current_progress + int(pct * 10)
                            # 避免频繁更新（每增加 2% 更新一次）
                            if new_progress >= last_progress_update + 2:
                                update_progress("extract_audio", new_progress)
                                last_progress_update = new_progress
                    except (ValueError, IndexError):
                        pass
        
        # 并行读取 stdout 进度和 stderr
        async def read_stderr():
            """读取 stderr 获取错误信息"""
            data = await process.stderr.read()
            return data.decode() if data else ""
        
        progress_task = asyncio.create_task(read_progress())
        stderr_task = asyncio.create_task(read_stderr())
        
        # 等待进程完成（不用 communicate，因为我们已经在读 stdout）
        await process.wait()
        
        # 等待读取任务完成
        await progress_task
        stderr_text = await stderr_task
        
        if process.returncode != 0:
            # 提取真正的错误信息（跳过 FFmpeg 版本信息）
            error_lines = stderr_text.split('\n')
            real_errors = [line for line in error_lines if 
                          'error' in line.lower() or 
                          'failed' in line.lower() or 
                          'invalid' in line.lower() or
                          'unable' in line.lower() or
                          'no such' in line.lower()]
            error_summary = '\n'.join(real_errors[-5:]) if real_errors else stderr_text[-500:]
            
            logger.error(f"[ASR优化] ❌ FFmpeg 失败 (returncode={process.returncode}):")
            logger.error(f"[ASR优化] ❌ 错误摘要: {error_summary}")
            logger.error(f"[ASR优化] ❌ 完整 stderr (最后 1000 字符): {stderr_text[-1000:]}")
            raise Exception(f"音频提取失败: {error_summary[:300]}")
        
        audio_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        logger.info(f"[ASR优化] ✅ 音频流式提取完成: {audio_size_mb:.1f}MB")
        
        # 上传音频到 Supabase
        update_progress("upload_audio", current_progress + 12)
        logger.info(f"[ASR优化] ⬆️ 上传音频...")
        
        audio_storage_path = f"asr_audio/{asset_id}.mp3"
        
        with open(audio_path, "rb") as f:
            audio_data = f.read()
        
        # 使用 asyncio.to_thread 避免阻塞
        await asyncio.to_thread(
            lambda: supabase.storage.from_("clips").upload(
                audio_storage_path,
                audio_data,
                {"content-type": "audio/mpeg", "upsert": "true"}
            )
        )
        
        audio_url = get_file_url("clips", audio_storage_path)
        update_progress("upload_audio", current_progress + 15)
        logger.info(f"[ASR优化] ✅ 音频上传完成: {audio_storage_path}")
        
        return audio_url
        
    finally:
        # 清理临时文件
        import shutil
        try:
            shutil.rmtree(temp_dir)
            logger.info(f"[ASR优化] 🧹 临时文件已清理")
        except Exception as e:
            logger.warning(f"[ASR优化] ⚠️ 清理临时文件失败: {e}")


async def _run_asr(file_url: str, update_progress, current_progress: int, step_progress: int, asset_id: str = None, video_duration_sec: float = None, enable_ddc: bool = True) -> list:
    """
    执行 ASR 语音转写
    
    优化1：如果 asset_id 在 tasks 表中已有转写结果，直接复用
    优化2：如果提供了 asset_id 且是大文件（视频），会先提取音频再转写
    
    Args:
        enable_ddc: 是否启用语义顺滑（DDC），会删除"嗯"、"啊"等语气词
                    ★ 口癖检测（detect_fillers）时应设为 False
    """
    logger.info(f"[_run_asr] 🎤 开始 ASR 转写")
    logger.info(f"[_run_asr]    file_url: {file_url[:100]}...")
    logger.info(f"[_run_asr]    current_progress: {current_progress}, step_progress: {step_progress}")
    logger.info(f"[_run_asr]    asset_id: {asset_id}, video_duration: {video_duration_sec}s")
    
    try:
        from ..tasks.transcribe import transcribe_audio
        import httpx
        import asyncio
        
        # ★★★ 优化：检查是否已有转写结果（复用 analyze-content 的转写）★★★
        # 注意：排除 clip 级别的转写任务（params 中包含 clip_id 的是 clip 转写）
        # 只复用整体 asset 的转写结果
        if asset_id:
            existing_tasks = supabase.table("tasks").select(
                "id, status, result, params"
            ).eq("asset_id", asset_id).eq("task_type", "transcribe").eq("status", "completed").execute()
            
            # 筛选出整体 asset 的转写任务（params 中没有 clip_id）
            existing_task_data = None
            if existing_tasks and existing_tasks.data:
                for task in existing_tasks.data:
                    params = task.get("params") or {}
                    if not params.get("clip_id"):  # 整体 asset 转写，不是 clip 转写
                        existing_task_data = task
                        break
            
            if existing_task_data and existing_task_data.get("result"):
                result = existing_task_data["result"]
                segments = result.get("segments", []) if isinstance(result, dict) else result
                if segments:
                    logger.info(f"[_run_asr] ✅ 复用已有转写结果: {len(segments)} 个片段 (task_id={existing_task_data['id'][:8]})")
                    update_progress("transcribe", current_progress + step_progress)
                    return segments
        
        # ★ Cloudflare HLS URL：FFmpeg 支持直接读取 HLS，提取音频用于 ASR
        is_cloudflare_hls = 'videodelivery.net' in file_url and 'm3u8' in file_url
        
        actual_audio_url = file_url
        
        if is_cloudflare_hls:
            # Cloudflare HLS：从 HLS 提取音频
            logger.info(f"[_run_asr] ☁️ Cloudflare HLS，使用 FFmpeg 提取音频")
            audio_progress = int(step_progress * 0.2)
            actual_audio_url = await _extract_audio_for_asr(
                video_url=file_url,
                asset_id=asset_id,
                update_progress=update_progress,
                current_progress=current_progress,
                video_duration_sec=video_duration_sec
            )
            current_progress += audio_progress
            step_progress -= audio_progress
            logger.info(f"[_run_asr] ✅ Cloudflare HLS 音频提取成功")
        else:
            # 判断是否是视频文件，需要提取音频
            is_video = any(ext in file_url.lower() for ext in ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'])
            
            # 如果是视频且有 asset_id，先提取音频（大幅提升速度）
            actual_audio_url = file_url
            if is_video and asset_id:
                logger.info(f"[_run_asr] 🎬 检测到视频文件，先提取音频以优化上传速度")
                try:
                    # 提取音频占用 20% 进度
                    audio_progress = int(step_progress * 0.2)
                    actual_audio_url = await _extract_audio_for_asr(
                        video_url=file_url,
                        asset_id=asset_id,
                        update_progress=update_progress,
                        current_progress=current_progress,
                        video_duration_sec=video_duration_sec  # ★ 传入视频时长用于进度计算
                    )
                    # 调整剩余进度
                    current_progress += audio_progress
                    step_progress -= audio_progress
                    logger.info(f"[_run_asr] ✅ 音频提取成功，使用压缩音频进行转写")
                except Exception as e:
                    logger.warning(f"[_run_asr] ⚠️ 音频提取失败，回退到原始文件: {e}")
                    actual_audio_url = file_url
        
        # ★ Cloudflare HLS URL 不需要验证（直接可用）
        is_cloudflare_hls = 'videodelivery.net' in actual_audio_url and 'm3u8' in actual_audio_url
        
        if not is_cloudflare_hls:
            # 验证文件是否可访问（等待上传完成）
            max_retries = 30  # 最多等待 30 秒
            for retry in range(max_retries):
                try:
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        resp = await client.head(actual_audio_url)
                        if resp.status_code == 200:
                            logger.info(f"[_run_asr] ✅ 文件可访问，开始转写")
                            break
                        else:
                            logger.warning(f"[_run_asr] ⏳ 文件不可访问 (HTTP {resp.status_code})，等待... ({retry+1}/{max_retries})")
                except Exception as e:
                    logger.warning(f"[_run_asr] ⏳ 文件检查失败: {e}，等待... ({retry+1}/{max_retries})")
                
                if retry < max_retries - 1:
                    await asyncio.sleep(1)
            else:
                logger.error(f"[_run_asr] ❌ 文件在 {max_retries} 秒后仍不可访问")
                return []
        else:
            logger.info(f"[_run_asr] ☁️ Cloudflare HLS URL，跳过验证")
        
        def on_asr_progress(progress: int, step: str):
            mapped_progress = current_progress + int(progress * step_progress / 100)
            update_progress("transcribe", mapped_progress)
        
        asr_result = await transcribe_audio(
            audio_url=actual_audio_url,
            language="zh",
            enable_ddc=enable_ddc,  # ★ 传递语义顺滑开关
            on_progress=on_asr_progress,
        )
        
        segments = asr_result.get("segments", [])
        logger.info(f"[_run_asr] ✅ ASR 完成，识别 {len(segments)} 个片段")
        
        # 详细日志
        if segments:
            first_seg = segments[0]
            last_seg = segments[-1]
            logger.info(f"[_run_asr]    第一个片段: start={first_seg.get('start')}ms text='{first_seg.get('text', '')[:20]}...'")
            logger.info(f"[_run_asr]    最后一个片段: end={last_seg.get('end')}ms text='{last_seg.get('text', '')[:20]}...'")
        else:
            logger.warning(f"[_run_asr] ⚠️ ASR 返回空结果!")
        
        # ★★★ 保存转写结果到 tasks 表，供智能分析复用 ★★★
        if asset_id and segments:
            try:
                now = datetime.utcnow().isoformat()
                default_user_id = "00000000-0000-0000-0000-000000000000"
                task_id = str(uuid4())
                
                # 先查询 project_id
                asset_info = supabase.table("assets").select("project_id").eq("id", asset_id).single().execute()
                project_id = asset_info.data.get("project_id") if asset_info.data else None
                
                supabase.table("tasks").insert({
                    "id": task_id,
                    "project_id": project_id,
                    "user_id": default_user_id,
                    "task_type": "transcribe",
                    "asset_id": asset_id,
                    "status": "completed",
                    "progress": 100,
                    "params": {"language": "zh", "model": "base"},
                    "result": asr_result,
                    "created_at": now,
                    "completed_at": now,
                    "updated_at": now
                }).execute()
                logger.info(f"[_run_asr] 💾 转写结果已保存到 tasks 表 (task_id={task_id[:8]})")
            except Exception as save_err:
                logger.warning(f"[_run_asr] ⚠️ 保存转写结果失败（不影响主流程）: {save_err}")
            
        return segments
    except Exception as e:
        logger.error(f"[_run_asr] ❌ ASR 失败: {e}")
        import traceback
        traceback.print_exc()
        return []


# NOTE: _run_silence_detection 已删除 (2025-01-28)
# 静音检测功能已整合到 filler_detector.py 中
# detect_fillers API 直接调用 filler_detector.detect_all_fillers


# NOTE: _create_clips_from_segments 已删除 (2025-01-27)
# 该函数从未被调用，_process_session_multi_assets 内部直接处理 clips 创建
# 保留 _create_clips_from_segments_with_offset 供 assets.py 使用


# NOTE: _process_session 已删除 (2025-01-27)
# 该函数从未被调用，所有处理都使用 _process_session_multi_assets
# 删除约 410 行冗余代码


async def _process_session_multi_assets(
    session_id: str,
    project_id: str,
    assets: list,
    task_type: str,
):
    """
    后台处理会话 - 多素材版本
    按顺序处理多个素材，拼接到同一时间轴
    """
    import asyncio
    
    # ★ 由 task_type 决定处理流程
    ai_create_mode = task_type == "ai-create"
    voice_extract_mode = task_type == "voice-extract"
    enable_llm = False
    
    logger.info(f"[Workspace] 🚀 开始处理多素材会话: session={session_id}, project={project_id}, task={task_type}, assets={len(assets)}")
    logger.debug(f"[Workspace]    ai_create_mode: {ai_create_mode}, voice_extract_mode: {voice_extract_mode}")
    
    try:
        # ========================================
        # ★ Step 0: 清空项目的所有 clips 和 keyframes（避免重复/残留）
        # ========================================
        logger.info(f"[Workspace] 🧹 清空项目 {project_id} 的所有 clips 和 keyframes...")
        
        # 先获取项目的所有 track_ids
        tracks_result = supabase.table("tracks").select("id").eq("project_id", project_id).execute()
        track_ids = [t["id"] for t in (tracks_result.data or [])]
        
        if track_ids:
            # 获取所有 clip_ids（用于删除关联的 keyframes）
            clips_result = supabase.table("clips").select("id").in_("track_id", track_ids).execute()
            clip_ids = [c["id"] for c in (clips_result.data or [])]
            
            # 先删除 keyframes（有外键约束）
            if clip_ids:
                try:
                    supabase.table("keyframes").delete().in_("clip_id", clip_ids).execute()
                    logger.debug(f"[Workspace]    删除 {len(clip_ids)} 个 clips 关联的 keyframes")
                except Exception as e:
                    logger.warning(f"[Workspace]    删除 keyframes 失败（可能不存在）: {e}")
            
            # 再删除所有 clips
            try:
                supabase.table("clips").delete().in_("track_id", track_ids).execute()
                logger.debug(f"[Workspace]    删除 {len(track_ids)} 个 tracks 下的所有 clips")
            except Exception as e:
                logger.warning(f"[Workspace]    删除 clips 失败: {e}")
        
        logger.info(f"[Workspace] ✅ 项目清理完成，开始全新处理")
        
        update_progress = _create_progress_updater(session_id)
        now = datetime.utcnow().isoformat()
        
        # Step 1: 获取所有素材元数据 (0% → 10%)
        _raise_if_cancelled(session_id, "开始处理多素材")
        update_progress("fetch", 5)
        
        # 收集所有素材信息
        asset_infos = []
        total_duration = 0
        max_width = 0
        max_height = 0
        
        for idx_asset, asset in enumerate(assets):
            asset_id = asset["id"]
            storage_path = asset.get("storage_path")
            logger.debug(f"[Workspace] 📦 获取素材 {idx_asset + 1}/{len(assets)} 元数据: {asset_id}")
            logger.debug(f"[Workspace]    storage_path: {storage_path}")
            file_url = get_file_url("clips", storage_path)
            logger.debug(f"[Workspace]    file_url: {file_url[:80]}...")
            
            # 获取元数据（包括编码信息）
            metadata = await _fetch_asset_metadata(asset_id, file_url)
            logger.debug(f"[Workspace]    metadata: {metadata}")
            duration = asset.get("duration") or metadata.get("duration", 0)
            width = metadata.get("width", 1920)
            height = metadata.get("height", 1080)
            codec = metadata.get("codec", "unknown")
            needs_transcode = metadata.get("needs_transcode", False)
            
            asset_infos.append({
                "asset_id": asset_id,
                "storage_path": storage_path,  # ★ 保存 storage_path 用于转码
                "file_url": file_url,
                "duration": duration,
                "duration_ms": int(duration * 1000),
                "width": width,
                "height": height,
                "order": asset.get("order_index", 0),
                "name": asset.get("name", "素材"),
                "codec": codec,  # ★ 保存编码信息
                "needs_transcode": needs_transcode,  # ★ 是否需要转码
            })
            
            total_duration += duration
            max_width = max(max_width, width)
            max_height = max(max_height, height)
        
        # 按顺序排序
        asset_infos.sort(key=lambda x: x["order"])
        
        update_progress("fetch", 10)
        logger.info(f"[Workspace] ✅ 获取 {len(asset_infos)} 个素材元数据，总时长 {total_duration:.1f}s")
        
        # ========================================
        # ★ Cloudflare Stream：无需本地处理
        # ========================================
        # Cloudflare 自动处理：HLS 转码、自适应码率、CDN 分发
        logger.info(f"[Workspace] ☁️ {len(asset_infos)} 个素材（Cloudflare 自动处理）")
        
        # ========================================
        # Step 2: 复用已有轨道（finalize_upload 已创建）
        # ========================================
        logger.info(f"[Workspace] 🔍 查找已有轨道...")
        existing_tracks = supabase.table("tracks").select("*").eq("project_id", project_id).execute()
        
        video_track_id = None
        text_track_id = None
        audio_track_id = None
        
        if existing_tracks.data:
            for track in existing_tracks.data:
                if track.get("order_index") == 0:
                    video_track_id = track["id"]
                    logger.debug(f"[Workspace]    找到视频轨道: {video_track_id}")
                elif track.get("order_index") == 1:
                    # order_index=1 可能是字幕轨道或音频轨道
                    if "字幕" in track.get("name", "") or "text" in track.get("name", "").lower():
                        text_track_id = track["id"]
                        logger.debug(f"[Workspace]    找到字幕轨道: {text_track_id}")
                    else:
                        audio_track_id = track["id"]
                        logger.debug(f"[Workspace]    找到音频轨道: {audio_track_id}")
                elif track.get("order_index") == 2:
                    text_track_id = track["id"]
                    logger.debug(f"[Workspace]    找到字幕轨道(order=2): {text_track_id}")
        
        # 如果没有找到已有轨道，才创建新的（理论上不应该发生）
        if not video_track_id:
            logger.warning(f"[Workspace] ⚠️ 未找到视频轨道，创建新的（不应该发生！）")
            video_track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": video_track_id,
                "project_id": project_id,
                "name": "视频轨道",
                "order_index": 0,
                "is_muted": False,
                "is_locked": False,
                "is_visible": True,
                "created_at": now,
                "updated_at": now,
            }).execute()
        
        main_track_id = video_track_id  # 默认主轨道是视频轨
        
        # Voice Extract 模式处理
        if voice_extract_mode:
            if not audio_track_id:
                audio_track_id = str(uuid4())
                supabase.table("tracks").insert({
                    "id": audio_track_id,
                    "project_id": project_id,
                    "name": "原声音频",
                    "order_index": 1,
                    "is_muted": False,
                    "is_locked": False,
                    "is_visible": True,
                    "created_at": now,
                    "updated_at": now,
                }).execute()
            main_track_id = audio_track_id
        
        if not text_track_id:
            logger.warning(f"[Workspace] ⚠️ 未找到字幕轨道，创建新的（不应该发生！）")
            text_track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": text_track_id,
                "project_id": project_id,
                "name": "字幕轨道",
                "order_index": 2 if voice_extract_mode else 1,
                "is_muted": False,
                "is_locked": False,
                "is_visible": True,
                "created_at": now,
                "updated_at": now,
            }).execute()
        
        logger.info(f"[Workspace] ✅ 轨道准备完成: video={video_track_id}, text={text_track_id}")
        
        # ========================================
        # ★ AI-Create 模式：先 ASR，再按语音切片
        # ★ Voice-Extract 模式：整体 clip + 字幕
        # ========================================
        
        all_video_clips = []
        all_subtitle_clips = []
        all_keyframes = []
        total_segments = 0
        timeline_position = 0  # 时间轴位置（毫秒）
        
        progress_per_asset = 70 / len(asset_infos)  # 每个素材占 70% 进度
        
        for idx, info in enumerate(asset_infos):
            # 每个素材处理前检查取消状态
            _raise_if_cancelled(session_id, f"处理素材 {idx + 1}/{len(asset_infos)} 前")
            
            asset_id = info["asset_id"]
            file_url = info["file_url"]
            storage_path = info.get("storage_path", "")
            asset_duration_ms = info["duration_ms"]
            
            if asset_duration_ms <= 0:
                asset_duration_ms = 10000
                logger.warning(f"[Workspace] ⚠️ Asset {asset_id} 无时长信息，使用默认 10s")
            
            base_progress = 10 + int(idx * progress_per_asset)
            logger.info(f"[Workspace] 📹 处理素材 {idx + 1}/{len(asset_infos)}: {info['name'][:30]}...")
            logger.debug(f"[Workspace]    asset_id: {asset_id}, 时长: {info['duration']:.1f}s, 模式: {'AI智能切片' if ai_create_mode else '整体提取'}")
            
            # ★ Cloudflare 视频：无需等待 MP4，ASR 会从 HLS 提取音频
            if storage_path.startswith("cloudflare:"):
                logger.info(f"[Workspace] ☁️ Cloudflare 视频，ASR 将从 HLS 提取音频")
            
            # Step 1: ASR 转写（获取语音片段）
            transcript_segments = []
            logger.debug(f"[Workspace] 🎙️ 开始 ASR 转写素材 {idx + 1}...")
            update_progress("transcribe", base_progress + 5)
            
            if idx > 0:
                logger.debug(f"[Workspace]    ⏳ 等待 2 秒避免 API 限流...")
                await asyncio.sleep(2)
            
            try:
                transcript_segments = await _run_asr(
                    file_url, 
                    update_progress,
                    base_progress,
                    int(progress_per_asset),
                    asset_id=asset_id,
                    video_duration_sec=info['duration']
                )
                
                logger.info(f"[Workspace] ✅ ASR 完成素材 {idx + 1}, 识别 {len(transcript_segments)} 个片段")
                _raise_if_cancelled(session_id, f"素材 {idx + 1} ASR 后")
                
                breath_count = sum(1 for seg in transcript_segments if (seg.get("silence_info") or {}).get("classification") == "breath")
                speech_count = sum(1 for seg in transcript_segments if not seg.get("silence_info"))
                logger.debug(f"[Workspace]    其中: 语音片段 {speech_count} 个, 换气片段 {breath_count} 个")
                total_segments += len(transcript_segments)
            except Exception as asr_err:
                logger.error(f"[Workspace] ❌ ASR 转写素材 {idx + 1} 失败: {asr_err}")
                import traceback
                traceback.print_exc()
            
            # ========================================
            # Step 2: 创建 Video Clips
            # ========================================
            
            if ai_create_mode and transcript_segments:
                # ★★★ AI-Create 模式：完整一键成片流程 ★★★
                # 使用 AIVideoCreatorService 处理：
                # 1. 智能切片 (已有 ASR 结果)
                # 2. 视觉分析 (人脸检测)
                # 3. LLM 语义分析 (情绪/重要性)
                # 4. 运镜规则引擎 (决策)
                # 5. 序列感知后处理 (多样性)
                
                logger.debug(f"[Workspace] 🎬 AI智能切片模式：调用 AIVideoCreatorService...")
                
                from app.services.ai_video_creator import ai_video_creator
                from app.services.transform_rules import ZoomStrategy
                
                try:
                    # 调用 AI 成片服务（复用已有 ASR 结果）
                    ai_result = await ai_video_creator.process(
                        video_path=file_url,  # 使用 URL（视觉分析会下载）
                        audio_url=file_url,
                        options={
                            "transcript_segments": transcript_segments,
                            "enable_llm": enable_llm,  # 根据配置决定是否启用 LLM
                        }
                    )
                    
                    logger.info(f"[Workspace] ✅ AIVideoCreator 处理完成: {ai_result.clips_count} 个片段")
                    
                    # 将 AI 结果转换为 clips 和 keyframes
                    for seg_idx, smart_seg in enumerate(ai_result.segments):
                        seg_start = int(smart_seg.start)
                        seg_end = int(smart_seg.end)
                        seg_text = smart_seg.text.strip() if smart_seg.text else ""
                        seg_duration = seg_end - seg_start
                        
                        if seg_duration <= 0:
                            continue
                        
                        clip_id = str(uuid4())
                        
                        # ★ 换气片段：保留，添加 silence_info 让前端向导处理
                        is_breath = smart_seg.is_breath
                        
                        if is_breath:
                            # 换气片段：创建 clip 但标记为换气，供前端向导处理
                            clip_data = {
                                "id": clip_id,
                                "track_id": video_track_id,
                                "asset_id": asset_id,
                                "clip_type": "video",
                                "name": "[换气]",
                                "start_time": timeline_position,
                                "end_time": timeline_position + seg_duration,
                                "source_start": seg_start,
                                "source_end": seg_end,
                                "volume": 1.0,
                                "is_muted": False,
                                "transform": {
                                    "x": 0, "y": 0,
                                    "scaleX": 1, "scaleY": 1,
                                    "rotation": 0,
                                    "opacity": 1,
                                },
                                "speed": 1.0,
                                "metadata": {
                                    "segment_id": smart_seg.id,
                                    "asset_index": idx,
                                    "segment_index": seg_idx,
                                    "silence_info": {
                                        "classification": "breath",
                                        "duration_ms": seg_duration,
                                    },
                                },
                                "created_at": now,
                                "updated_at": now,
                            }
                            all_video_clips.append(clip_data)
                            
                            # 换气片段不需要字幕和运镜
                            logger.debug(f"[Workspace]    Clip {seg_idx + 1} [换气]: {timeline_position}~{timeline_position + seg_duration}ms")
                            timeline_position += seg_duration
                            continue
                        
                        # 跳过空文本的非换气片段
                        if not seg_text:
                            continue
                        
                        # 语音片段
                        clip_data = {
                            "id": clip_id,
                            "track_id": video_track_id,
                            "asset_id": asset_id,
                            "clip_type": "video",
                            "name": seg_text[:20] + ("..." if len(seg_text) > 20 else ""),
                            "start_time": timeline_position,
                            "end_time": timeline_position + seg_duration,
                            "source_start": seg_start,
                            "source_end": seg_end,
                            "volume": 1.0,
                            "is_muted": False,
                            "transform": {
                                "x": 0, "y": 0,
                                "scaleX": 1, "scaleY": 1,
                                "rotation": 0,
                                "opacity": 1,
                            },
                            "speed": 1.0,
                            "metadata": {
                                "segment_id": smart_seg.id,
                                "asset_index": idx,
                                "segment_index": seg_idx,
                                "emotion": smart_seg.emotion.value if smart_seg.emotion else "neutral",
                                "importance": smart_seg.importance.value if smart_seg.importance else "medium",
                                "has_face": smart_seg.has_face,
                                "rule_applied": smart_seg.transform.get("_rule_applied") if smart_seg.transform else None,
                            },
                            "created_at": now,
                            "updated_at": now,
                        }
                        all_video_clips.append(clip_data)
                        
                        # 字幕 clips（细分）
                        fine_subs = _split_segments_by_punctuation([{
                            "id": smart_seg.id,
                            "start": seg_start,
                            "end": seg_end,
                            "text": seg_text,
                        }])
                        for sub_idx, sub_seg in enumerate(fine_subs):
                            sub_start = sub_seg.get("start", seg_start)
                            sub_end = sub_seg.get("end", seg_end)
                            sub_text = sub_seg.get("text", "").strip()
                            sub_duration = sub_end - sub_start
                            
                            if sub_duration <= 0 or not sub_text:
                                continue
                            
                            sub_offset = sub_start - seg_start
                            
                            all_subtitle_clips.append({
                                "id": str(uuid4()),
                                "track_id": text_track_id,
                                "clip_type": "subtitle",
                                "parent_clip_id": clip_id,
                                "start_time": timeline_position + sub_offset,
                                "end_time": timeline_position + sub_offset + sub_duration,
                                "source_start": 0,
                                "source_end": sub_duration,
                                "is_muted": False,
                                "content_text": sub_text,
                                "text_style": {
                                    "fontSize": 15,
                                    "fontColor": "#FFFFFF",
                                    "backgroundColor": "transparent",
                                    "alignment": "center",
                                    "maxWidth": "95%",
                                },
                                "transform": {"x": 0, "y": 150, "scale": 1},
                                "metadata": {
                                    "segment_id": smart_seg.id,
                                    "asset_index": idx,
                                    "order_index": seg_idx * 100 + sub_idx,
                                },
                                "created_at": now,
                                "updated_at": now,
                            })
                        
                        # ★ Keyframes：根据 AI 运镜决策生成
                        if smart_seg.transform_params:
                            params = smart_seg.transform_params
                            
                            # 起始关键帧
                            all_keyframes.append({
                                "id": str(uuid4()),
                                "clip_id": clip_id,
                                "property": "scale",
                                "offset": 0.0,
                                "value": {"x": params.start_scale, "y": params.start_scale},
                                "easing": "ease_in_out",
                                "created_at": now,
                                "updated_at": now,
                            })
                            
                            # 结束关键帧
                            all_keyframes.append({
                                "id": str(uuid4()),
                                "clip_id": clip_id,
                                "property": "scale",
                                "offset": 1.0,
                                "value": {"x": params.end_scale, "y": params.end_scale},
                                "easing": params.easing.value if hasattr(params.easing, 'value') else str(params.easing),
                                "created_at": now,
                                "updated_at": now,
                            })
                            
                            # 位移关键帧（如果有位移）
                            if abs(params.position_x) > 0.01 or abs(params.position_y) > 0.01:
                                all_keyframes.append({
                                    "id": str(uuid4()),
                                    "clip_id": clip_id,
                                    "property": "position",
                                    "offset": 0.0,
                                    "value": {"x": 0, "y": 0},
                                    "easing": "ease_in_out",
                                    "created_at": now,
                                    "updated_at": now,
                                })
                                all_keyframes.append({
                                    "id": str(uuid4()),
                                    "clip_id": clip_id,
                                    "property": "position",
                                    "offset": 1.0,
                                    "value": {"x": params.position_x, "y": params.position_y},
                                    "easing": params.easing.value if hasattr(params.easing, 'value') else str(params.easing),
                                    "created_at": now,
                                    "updated_at": now,
                                })
                            
                            logger.debug(f"[Workspace]    Clip {seg_idx + 1}: {timeline_position}~{timeline_position + seg_duration}ms, "
                                       f"rule={params.rule_applied}, scale={params.start_scale:.2f}→{params.end_scale:.2f}")
                        else:
                            # Fallback: 简单慢推
                            all_keyframes.append({
                                "id": str(uuid4()),
                                "clip_id": clip_id,
                                "property": "scale",
                                "offset": 0.0,
                                "value": {"x": 1.0, "y": 1.0},
                                "easing": "ease_in_out",
                                "created_at": now,
                                "updated_at": now,
                            })
                            all_keyframes.append({
                                "id": str(uuid4()),
                                "clip_id": clip_id,
                                "property": "scale",
                                "offset": 1.0,
                                "value": {"x": 1.08, "y": 1.08},
                                "easing": "linear",
                                "created_at": now,
                                "updated_at": now,
                            })
                        
                        timeline_position += seg_duration
                    
                    logger.debug(f"[Workspace] ✅ AI切片完成: {len([c for c in all_video_clips if c.get('asset_id') == asset_id])} 个 video clips")
                    
                except Exception as ai_err:
                    logger.error(f"[Workspace] ❌ AIVideoCreator 处理失败: {ai_err}")
                    import traceback
                    traceback.print_exc()
                    
                    # Fallback: 使用简单切片逻辑
                    logger.debug(f"[Workspace] ⚠️ 降级为简单切片模式...")
                    speech_segments = [seg for seg in transcript_segments 
                                      if seg.get("text", "").strip() and not seg.get("silence_info")]
                    
                    for seg_idx, seg in enumerate(speech_segments):
                        seg_start = seg.get("start", 0)
                        seg_end = seg.get("end", 0)
                        seg_text = seg.get("text", "").strip()
                        seg_duration = seg_end - seg_start
                        
                        if seg_duration <= 0:
                            continue
                        
                        clip_id = str(uuid4())
                        clip_data = {
                            "id": clip_id,
                            "track_id": video_track_id,
                            "asset_id": asset_id,
                            "clip_type": "video",
                            "name": seg_text[:20] + ("..." if len(seg_text) > 20 else ""),
                            "start_time": timeline_position,
                            "end_time": timeline_position + seg_duration,
                            "source_start": seg_start,
                            "source_end": seg_end,
                            "volume": 1.0,
                            "is_muted": False,
                            "transform": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1},
                            "speed": 1.0,
                            "created_at": now,
                            "updated_at": now,
                        }
                        all_video_clips.append(clip_data)
                        
                        # 简单 keyframes
                        all_keyframes.append({
                            "id": str(uuid4()),
                            "clip_id": clip_id,
                            "property": "scale",
                            "offset": 0.0,
                            "value": {"x": 1.0, "y": 1.0},
                            "easing": "ease_in_out",
                            "created_at": now,
                            "updated_at": now,
                        })
                        all_keyframes.append({
                            "id": str(uuid4()),
                            "clip_id": clip_id,
                            "property": "scale",
                            "offset": 1.0,
                            "value": {"x": 1.08, "y": 1.08},
                            "easing": "linear",
                            "created_at": now,
                            "updated_at": now,
                        })
                        
                        timeline_position += seg_duration
                
            else:
                # ★ Voice-Extract 或无 ASR 结果：创建整体 clip
                logger.debug(f"[Workspace] 🎬 整体模式：创建单个 clip...")
                
                clip_id = str(uuid4())
                clip_data = {
                    "id": clip_id,
                    "track_id": video_track_id,
                    "asset_id": asset_id,
                    "clip_type": "video",
                    "name": info.get("name", "视频"),
                    "start_time": timeline_position,
                    "end_time": timeline_position + asset_duration_ms,
                    "source_start": 0,
                    "source_end": asset_duration_ms,
                    "volume": 1.0,
                    "is_muted": False,
                    "transform": {
                        "x": 0, "y": 0,
                        "scaleX": 1, "scaleY": 1,
                        "rotation": 0,
                        "opacity": 1,
                    },
                    "speed": 1.0,
                    "created_at": now,
                    "updated_at": now,
                }
                all_video_clips.append(clip_data)
                
                # 创建字幕 clips（如果有 ASR 结果）
                if transcript_segments:
                    subtitle_clips = await _create_subtitle_clips_only(
                        transcript_segments=transcript_segments,
                        text_track_id=text_track_id,
                        video_clip_id=clip_id,
                        timeline_offset=timeline_position,
                        asset_index=idx,
                    )
                    all_subtitle_clips.extend(subtitle_clips)
                
                logger.debug(f"[Workspace]    创建 clip: {clip_id}, {timeline_position}~{timeline_position + asset_duration_ms}ms")
                timeline_position += asset_duration_ms
            
            logger.debug(f"[Workspace] ✅ 素材 {idx + 1} 处理完成")
        
        # ========================================
        # Step 3: 批量插入 clips 和 keyframes
        # ========================================
        logger.debug(f"[Workspace] 📦 批量插入数据库...")
        
        if all_video_clips:
            try:
                supabase.table("clips").insert(all_video_clips).execute()
                logger.debug(f"[Workspace] ✅ 创建 {len(all_video_clips)} 个 video clips")
            except Exception as e:
                logger.error(f"[Workspace] ❌ 创建 video clips 失败: {e}")
                raise
        
        if all_keyframes:
            try:
                supabase.table("keyframes").insert(all_keyframes).execute()
                logger.debug(f"[Workspace] ✅ 创建 {len(all_keyframes)} 个 keyframes")
            except Exception as e:
                logger.warning(f"[Workspace] ⚠️ 插入 keyframes 失败: {e}")
        
        if all_subtitle_clips:
            try:
                supabase.table("clips").insert(all_subtitle_clips).execute()
                logger.debug(f"[Workspace] ✅ 创建 {len(all_subtitle_clips)} 个字幕 clips")
            except Exception as e:
                logger.warning(f"[Workspace] ⚠️ 创建字幕 clips 失败: {e}")
        
        # ========================================
        # ★ Cloudflare 简化：无需等待 HLS 任务
        # ========================================
        update_progress("prepare", 95)
        
        # 更新项目
        fps = 30
        supabase.table("projects").update({
            "status": "ready",
            "resolution": {"width": max_width, "height": max_height},
            "fps": fps,
            "updated_at": now,
        }).eq("id", project_id).execute()
        
        # 更新所有素材状态
        for info in asset_infos:
            supabase.table("assets").update({
                "status": "ready",
                "updated_at": now,
            }).eq("id", info["asset_id"]).execute()
        
        update_progress("prepare", 100)
        
        # 标记会话完成
        supabase.table("workspace_sessions").update({
            "status": "completed",
            "progress": 100,
            "current_step": "completed",
            "transcript_segments": total_segments,
            "completed_at": now,
            "updated_at": now,
        }).eq("id", session_id).execute()
        
        logger.info(f"[Workspace] ✅ 多素材会话 {session_id} 处理完成，共 {len(asset_infos)} 个素材")
        
    except SessionCancelledException:
        # 用户主动取消，不需要更新状态（已经是 cancelled）
        logger.info(f"[Workspace] 🛑 多素材会话 {session_id} 处理已被用户取消")
        return
    except Exception as e:
        logger.error(f"[Workspace] ❌ 多素材处理失败: {e}")
        import traceback
        traceback.print_exc()
        
        supabase.table("workspace_sessions").update({
            "status": "failed",
            "error_message": str(e),
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", session_id).execute()
        
        supabase.table("projects").update({
            "status": "draft",
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", project_id).execute()


async def _create_clips_from_segments_with_offset(
    project_id: str,
    asset_id: str,
    transcript_segments: list,
    video_track_id: str,
    text_track_id: str,
    timeline_offset: int = 0,
    asset_index: int = 0,
    enable_llm: bool = False,
    enable_smart_camera: bool = True,
    enable_subtitle: bool = True,
) -> tuple:
    """
    根据 ASR segments 创建视频和字幕 clips（带时间轴偏移）
    用于多素材拼接场景
    
    Args:
        timeline_offset: 在时间轴上的起始位置（毫秒）
        asset_index: 素材索引，用于命名
        enable_llm: 是否启用 LLM 语义分析
        enable_smart_camera: 是否启用智能运镜（如果为 False，则不进行裁剪/缩放）
        enable_subtitle: 是否生成字幕 clips（如果为 False，只生成视频 clips）
        
    Returns:
        tuple: (video_clips, subtitle_clips, keyframes)
        - keyframes: 待插入 keyframes 表的记录列表
    """
    logger.info(f"[Workspace] ======== 切片函数开始 ========")
    logger.info(f"[Workspace] 🎬 _create_clips_from_segments_with_offset")
    logger.info(f"[Workspace]    asset_id: {asset_id}")
    logger.info(f"[Workspace]    asset_index: {asset_index}")
    logger.info(f"[Workspace]    timeline_offset: {timeline_offset}ms")
    logger.info(f"[Workspace]    enable_smart_camera: {enable_smart_camera}")
    logger.info(f"[Workspace]    enable_subtitle: {enable_subtitle}")
    logger.info(f"[Workspace]    输入 segments 数量: {len(transcript_segments)}")
    
    # ★ 关键日志：打印前几个 segments 的内容，验证 ASR 结果和 asset 对应
    if transcript_segments:
        for i, seg in enumerate(transcript_segments[:3]):
            seg_text = seg.get("text", "")[:30]
            logger.info(f"[Workspace]    segment[{i}]: start={seg.get('start')} text='{seg_text}...'")
    
    now = datetime.utcnow().isoformat()
    
    # 按时间顺序排序原始 segments
    sorted_segments = sorted(transcript_segments, key=lambda s: s.get("start", 0))
    
    video_clips = []
    subtitle_clips = []
    all_keyframes = []  # ★ 收集所有关键帧记录
    timeline_position = timeline_offset
    
    # 统计自动跳过的静音片段
    auto_skipped = {"dead_air": 0, "long_pause": 0, "hesitation": 0}
    
    # ========== 第一阶段：收集有效片段 ==========
    valid_segments = []  # 存储 (seg_idx, seg, seg_duration, clip_name, is_breath, silence_info)
    
    for seg_idx, seg in enumerate(sorted_segments):
        seg_start = seg.get("start", 0)
        seg_end = seg.get("end", 0)
        seg_text = seg.get("text", "").strip()
        seg_duration = seg_end - seg_start
        
        if seg_duration <= 0:
            continue
        
        # 检查静音信息
        silence_info = seg.get("silence_info")
        
        if silence_info:
            cls = silence_info.get("classification")
            if cls in ("dead_air", "long_pause", "hesitation"):
                logger.info(f"[Workspace]   ⚠️ 跳过 segment[{seg_idx}]: type={cls} start={seg_start} end={seg_end}")
                auto_skipped[cls] = auto_skipped.get(cls, 0) + 1
                continue
        
        # 确定片段类型
        clip_name = f"素材{asset_index + 1}-片段{seg_idx + 1}"
        is_breath = False
        if silence_info and silence_info.get("classification") == "breath":
            clip_name = f"素材{asset_index + 1}-换气"
            is_breath = True
        
        valid_segments.append((seg_idx, seg, seg_duration, clip_name, is_breath, silence_info))
    
    # ========== 第二阶段：LLM 语义分析（可选）==========
    # 存储分析结果: {segment_id: SegmentAnalysis}
    llm_results: Dict[str, Any] = {}
    if enable_llm and valid_segments:
        from ..services.llm import llm_service
        
        if llm_service.is_configured():
            logger.info(f"[Workspace] 🤖 开始 LLM 语义分析...")
            # 构建待分析的文本片段
            text_segments = []
            for seg_idx, seg, seg_duration, clip_name, is_breath, silence_info in valid_segments:
                seg_text = seg.get("text", "").strip()
                if seg_text and not is_breath:
                    text_segments.append({"id": str(seg_idx), "text": seg_text})
            
            if text_segments:
                try:
                    emotion_result = await llm_service.analyze_emotions(text_segments)
                    # 直接使用 SegmentAnalysis 对象
                    for seg_analysis in emotion_result.results:
                        llm_results[seg_analysis.id] = seg_analysis
                    logger.info(f"[Workspace] ✅ LLM 分析完成: {len(llm_results)} 条结果")
                except Exception as e:
                    logger.warning(f"[Workspace] ⚠️ LLM 分析失败: {e}，使用默认值")
            else:
                logger.info(f"[Workspace]    无文本片段需要分析")
        else:
            logger.info(f"[Workspace] ⚠️ LLM API 未配置，跳过语义分析")
    
    # ========== 第三阶段：批量生成 transform（含序列后处理）==========
    # 重置序列处理器状态
    sequence_processor.reset()
    
    # 口播模式默认人脸位置（与单素材流程一致）
    DEFAULT_FACE_CENTER_X = 0.5   # 居中
    DEFAULT_FACE_CENTER_Y = 0.35  # 稍微偏上（口播常见构图）
    
    # 构建上下文列表
    contexts = []
    for seg_idx, seg, seg_duration, clip_name, is_breath, silence_info in valid_segments:
        seg_text = seg.get("text", "").strip()
        seg_id_str = str(seg_idx)
        
        # 从 LLM 结果获取情绪和重要性，或使用默认值
        seg_analysis = llm_results.get(seg_id_str)
        emotion = seg_analysis.emotion if seg_analysis else EmotionType.NEUTRAL
        importance = seg_analysis.importance if seg_analysis else ImportanceLevel.MEDIUM
        
        context = SegmentContext(
            segment_id=seg_id_str,
            duration_ms=seg_duration,
            text=seg_text,
            # 口播模式：默认有人脸，居中偏上（与单素材流程一致）
            has_face=True,
            face_center_x=DEFAULT_FACE_CENTER_X,
            face_center_y=DEFAULT_FACE_CENTER_Y,
            # 使用 LLM 分析结果或默认值
            emotion=emotion,
            importance=importance,
            is_breath=is_breath,
        )
        contexts.append(context)
    
    logger.info(f"[Workspace] 🎥 enable_smart_camera={enable_smart_camera}, 待处理 {len(contexts)} 个片段")
    
    # 使用规则引擎批量处理
    if enable_smart_camera:
        params_list = [transform_engine.process(ctx) for ctx in contexts]
        
        # 序列感知后处理：确保运镜多样性（与单素材流程一致）
        params_contexts = list(zip(params_list, contexts))
        processed_params = sequence_processor.process_batch(params_contexts)
    else:
        # 禁用智能运镜，生成默认静态参数
        processed_params = [
            TransformParams(strategy=ZoomStrategy.STATIC, rule_applied="disabled_by_user")
            for _ in contexts
        ]
    
    # ========== 第三阶段：构建 clips ==========
    for i, (seg_idx, seg, seg_duration, clip_name, is_breath, silence_info) in enumerate(valid_segments):
        seg_start = seg.get("start", 0)
        seg_end = seg.get("end", 0)
        seg_text = seg.get("text", "").strip()
        
        video_clip_id = str(uuid4())
        
        # 获取批处理后的 transform
        transform_params = processed_params[i]
        
        # ★ 新 API：直接获取元信息和关键帧
        transform_meta = transform_params.get_meta()
        clip_keyframes = transform_params.get_keyframes_for_db(video_clip_id, seg_duration)
        
        logger.info(f"[Workspace]   ✅ 创建 clip[{seg_idx}]: name='{clip_name}' timeline={timeline_position}~{timeline_position + seg_duration} source={seg_start}~{seg_end} rule={transform_meta.get('_rule_applied', 'none')}")
        
        video_clips.append({
            "id": video_clip_id,
            "track_id": video_track_id,
            "asset_id": asset_id,
            "clip_type": "video",
            "start_time": timeline_position,
            "end_time": timeline_position + seg_duration,
            "source_start": seg_start,
            "source_end": seg_end,
            "is_muted": False,
            "name": clip_name,
            "transform": transform_meta,  # 只存元信息
            "created_at": now,
            "updated_at": now,
            "metadata": {
                "silence_info": silence_info,
                "original_text": seg_text,
                "asset_index": asset_index,
            }
        })
        
        # 收集关键帧（统一存储到 keyframes 表）
        all_keyframes.extend(clip_keyframes)
        
        # 创建字幕 clips（仅当 enable_subtitle=True 时）
        if seg_text and enable_subtitle:
            fine_subs = _split_segments_by_punctuation([seg])
            
            for sub_idx, sub_seg in enumerate(fine_subs):
                sub_start = sub_seg.get("start", seg_start)
                sub_end = sub_seg.get("end", seg_end)
                sub_text = sub_seg.get("text", "").strip()
                sub_duration = sub_end - sub_start
                
                if sub_duration <= 0 or not sub_text:
                    continue
                
                subtitle_timeline_start = timeline_position + (sub_start - seg_start)
                
                subtitle_clips.append({
                    "id": str(uuid4()),
                    "track_id": text_track_id,
                    "clip_type": "subtitle",
                    "parent_clip_id": video_clip_id,
                    "start_time": subtitle_timeline_start,
                    "end_time": subtitle_timeline_start + sub_duration,
                    "source_start": 0,
                    "source_end": sub_duration,
                    "is_muted": False,
                    "content_text": sub_text,
                    "text_style": {
                        "fontSize": 15,
                        "fontColor": "#FFFFFF",
                        "backgroundColor": "transparent",
                        "alignment": "center",
                        "maxWidth": "95%",
                    },
                    "transform": {
                        "x": 0,
                        "y": 150,
                        "scale": 1,
                    },
                    "metadata": {
                        "segment_id": seg.get("id"),
                        "asset_index": asset_index,
                        "order_index": seg_idx * 100 + sub_idx,
                        "original_start": sub_start,
                        "original_end": sub_end,
                    },
                    "created_at": now,
                    "updated_at": now,
                })
        
        timeline_position += seg_duration
    
    logger.info(f"[Workspace] ======== 切片函数结束 ========")
    logger.info(f"[Workspace] 📊 素材 {asset_index + 1} 统计:")
    logger.info(f"[Workspace]    输入 segments: {len(sorted_segments)}")
    logger.info(f"[Workspace]    创建视频 clips: {len(video_clips)}")
    logger.info(f"[Workspace]    创建字幕 clips: {len(subtitle_clips)}")
    logger.info(f"[Workspace]    提取关键帧数: {len(all_keyframes)}")
    logger.info(f"[Workspace]    跳过静音: {auto_skipped}")
    logger.info(f"[Workspace]    最终 timeline 位置: {timeline_position}ms")
    
    return video_clips, subtitle_clips, all_keyframes


async def _create_subtitle_clips_only(
    transcript_segments: list,
    text_track_id: str,
    video_clip_id: str = None,
    timeline_offset: int = 0,
    asset_index: int = 0,
) -> list:
    """
    ★ 只创建字幕 clips，不创建 video clips
    用于 confirm_upload 阶段，video clips 已由 finalize_upload 创建
    
    Args:
        transcript_segments: ASR 转写结果
        text_track_id: 字幕轨道 ID
        video_clip_id: 关联的视频 clip ID (用于 parent_clip_id)
        timeline_offset: 时间轴偏移（毫秒）
        asset_index: 素材索引
    
    Returns:
        list: 字幕 clips 列表
    """
    logger.info(f"[Workspace] 📝 _create_subtitle_clips_only")
    logger.info(f"[Workspace]    text_track_id: {text_track_id}")
    logger.info(f"[Workspace]    video_clip_id: {video_clip_id}")
    logger.info(f"[Workspace]    timeline_offset: {timeline_offset}ms")
    logger.info(f"[Workspace]    segments count: {len(transcript_segments)}")
    
    now = datetime.utcnow().isoformat()
    subtitle_clips = []
    
    # 过滤有效的语音片段（跳过静音）
    sorted_segments = sorted(transcript_segments, key=lambda s: s.get("start", 0))
    
    for seg_idx, seg in enumerate(sorted_segments):
        seg_start = seg.get("start", 0)
        seg_end = seg.get("end", 0)
        seg_text = seg.get("text", "").strip()
        seg_duration = seg_end - seg_start
        
        if seg_duration <= 0 or not seg_text:
            continue
        
        # 跳过静音片段
        silence_info = seg.get("silence_info")
        if silence_info:
            cls = silence_info.get("classification")
            if cls in ("dead_air", "long_pause", "hesitation", "breath"):
                continue
        
        # 细分字幕（按标点符号分割）
        fine_subs = _split_segments_by_punctuation([seg])
        
        for sub_idx, sub_seg in enumerate(fine_subs):
            sub_start = sub_seg.get("start", seg_start)
            sub_end = sub_seg.get("end", seg_end)
            sub_text = sub_seg.get("text", "").strip()
            sub_duration = sub_end - sub_start
            
            if sub_duration <= 0 or not sub_text:
                continue
            
            # ★ 计算时间轴位置：使用 source 时间（相对于视频开始）
            subtitle_timeline_start = timeline_offset + sub_start
            
            subtitle_clips.append({
                "id": str(uuid4()),
                "track_id": text_track_id,
                "clip_type": "subtitle",
                "parent_clip_id": video_clip_id,
                "start_time": subtitle_timeline_start,
                "end_time": subtitle_timeline_start + sub_duration,
                "source_start": 0,
                "source_end": sub_duration,
                "is_muted": False,
                "content_text": sub_text,
                "text_style": {
                    "fontSize": 15,
                    "fontColor": "#FFFFFF",
                    "backgroundColor": "transparent",
                    "alignment": "center",
                    "maxWidth": "95%",
                },
                "transform": {
                    "x": 0,
                    "y": 150,
                    "scale": 1,
                },
                "metadata": {
                    "segment_id": seg.get("id"),
                    "asset_index": asset_index,
                    "order_index": seg_idx * 100 + sub_idx,
                    "original_start": sub_start,
                    "original_end": sub_end,
                },
                "created_at": now,
                "updated_at": now,
            })
    
    logger.info(f"[Workspace] ✅ 创建 {len(subtitle_clips)} 个字幕 clips")
    return subtitle_clips