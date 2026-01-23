"""
HoppingRabbit AI - 工作台 API
处理从上传到进入编辑器的完整流程
适配新表结构 (2026-01-07)
"""
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel
from typing import Optional, Literal, List
from datetime import datetime
from uuid import uuid4
from enum import Enum

from ..services.supabase_client import supabase, get_file_url
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
    创建处理会话
    需要用户登录
    """
    try:
        session_id = str(uuid4())
        project_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        user_id = current_user["user_id"]
        
        logger.info(f"[Session] 开始创建会话, user_id={user_id}, source_type={request.source_type.value}")
        
        # 1. 创建项目
        project_name = _generate_project_name(request)
        project_data = {
            "id": project_id,
            "user_id": user_id,
            "name": project_name,
            "status": "processing",
            "resolution": {"width": 1920, "height": 1080},
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
                    
                    # 生成预签名上传 URL
                    presign_result = supabase.storage.from_("clips").create_signed_upload_url(storage_path)
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
                presign_result = supabase.storage.from_("clips").create_signed_upload_url(storage_path)
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
        
        # ★ 优化：添加网络超时和更快的编码参数
        cmd = [
            "ffmpeg", "-y",
            "-reconnect", "1",           # 断线重连
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5", # 最大重连延迟 5 秒
            "-i", video_url,
            "-vn",                       # 不要视频
            "-ar", "16000",              # 16kHz 采样率
            "-ac", "1",                  # 单声道
            "-b:a", "64k",               # 64kbps 码率
            "-f", "mp3",
            "-progress", "pipe:1",       # ★ 输出进度到 stdout
            audio_path
        ]
        
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
            logger.error(f"[ASR优化] ❌ FFmpeg 失败: {stderr_text[:500]}")
            raise Exception(f"音频提取失败: {stderr_text[:200]}")
        
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


async def _run_asr(file_url: str, update_progress, current_progress: int, step_progress: int, asset_id: str = None, video_duration_sec: float = None) -> list:
    """
    执行 ASR 语音转写
    
    优化1：如果 asset_id 在 tasks 表中已有转写结果，直接复用
    优化2：如果提供了 asset_id 且是大文件（视频），会先提取音频再转写
    """
    logger.info(f"[_run_asr] 🎤 开始 ASR 转写")
    logger.info(f"[_run_asr]    file_url: {file_url[:100]}...")
    logger.info(f"[_run_asr]    current_progress: {current_progress}, step_progress: {step_progress}")
    logger.info(f"[_run_asr]    asset_id: {asset_id}, video_duration: {video_duration_sec}s")
    
    try:
        from ..tasks.transcribe import transcribe_audio
        import httpx
        
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
        
        def on_asr_progress(progress: int, step: str):
            mapped_progress = current_progress + int(progress * step_progress / 100)
            update_progress("transcribe", mapped_progress)
        
        asr_result = await transcribe_audio(
            audio_url=actual_audio_url,
            language="zh",
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


async def _run_silence_detection(file_url: str) -> list:
    """执行静音检测"""
    try:
        from ..tasks.vad import detect_silence_segments
        
        result = await detect_silence_segments(
            audio_url=file_url,
            min_silence_duration=0.5,
            silence_threshold_db=-35,
        )
        
        segments = result.get("segments", [])
        logger.info(f"[Workspace] ✅ 静音检测完成，检测到 {len(segments)} 个静音片段")
        return segments
    except Exception as e:
        logger.error(f"[Workspace] ❌ 静音检测失败: {e}")
        return []


def _create_clips_from_segments(
    project_id: str,
    asset_id: str,
    transcript_segments: list,
    video_track_id: str,
    text_track_id: str,
) -> tuple:
    """
    根据 ASR segments 创建视频和字幕 clips
    
    策略：
    - 视频 clip：使用原始 ASR segments，不受标点切分影响
    - 字幕 clip：使用标点切分后的细分 segments
    - 死寂/长停顿/卡顿：自动跳过，不创建 clip（相当于自动切除）
    - 换气：保留让用户选择是否删除
    
    这样视频片段保持完整，而字幕可以按句子精细显示
    """
    now = datetime.utcnow().isoformat()
    
    # 按时间顺序排序原始 segments
    sorted_segments = sorted(transcript_segments, key=lambda s: s.get("start", 0))
    
    video_clips = []
    subtitle_clips = []
    timeline_position = 0
    
    # 统计自动跳过的静音片段
    auto_skipped = {"dead_air": 0, "long_pause": 0, "hesitation": 0}
    auto_skipped_duration = 0
    
    for seg_idx, seg in enumerate(sorted_segments):
        seg_start = seg.get("start", 0)  # 原视频中的开始位置（毫秒）
        seg_end = seg.get("end", 0)      # 原视频中的结束位置（毫秒）
        seg_text = seg.get("text", "").strip()
        seg_duration = seg_end - seg_start
        
        if seg_duration <= 0:
            continue
        
        # ========================================
        # 检查静音信息，决定是否自动跳过
        # ========================================
        silence_info = seg.get("silence_info")
        
        if silence_info:
            cls = silence_info.get("classification")
            
            # 死寂、长停顿、卡顿：自动跳过，不创建 clip
            if cls in ("dead_air", "long_pause", "hesitation"):
                auto_skipped[cls] = auto_skipped.get(cls, 0) + 1
                auto_skipped_duration += seg_duration
                logger.debug(f"[Workspace] ⏭️ 自动跳过静音: {cls}, duration={seg_duration}ms")
                continue  # 不创建 clip，不增加 timeline_position
        
        # ========================================
        # 1. 创建视频 clip（使用原始 segment，不切分）
        # ========================================
        clip_name = f"片段 {seg_idx + 1}"
        
        if silence_info:
            cls = silence_info.get("classification")
            if cls == "breath":
                clip_name = "换气"
            logger.debug(f"[Workspace] 🔇 保留静音片段: classification={cls}, name={clip_name}, duration={seg_duration}ms")
        
        # 生成视频 clip ID，后续字幕需要关联
        video_clip_id = str(uuid4())
        
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
            "created_at": now,
            "updated_at": now,
            "metadata": {
                "silence_info": silence_info,
                "original_text": seg_text
            }
        })
        
        # ========================================
        # 2. 创建字幕 clips（按标点切分成多个子句）
        # ========================================
        if seg_text:
            # 对当前 segment 进行标点切分
            fine_subs = _split_segments_by_punctuation([seg])
            
            # 当前 segment 内的相对时间起点
            relative_start = 0
            
            for sub_idx, sub_seg in enumerate(fine_subs):
                sub_start = sub_seg.get("start", seg_start)
                sub_end = sub_seg.get("end", seg_end)
                sub_text = sub_seg.get("text", "").strip()
                sub_duration = sub_end - sub_start
                
                if sub_duration <= 0 or not sub_text:
                    continue
                
                # 字幕在时间轴上的位置 = 当前视频 clip 开始位置 + 相对偏移
                subtitle_timeline_start = timeline_position + (sub_start - seg_start)
                
                subtitle_clips.append({
                    "id": str(uuid4()),
                    "track_id": text_track_id,
                    "clip_type": "subtitle",
                    "parent_clip_id": video_clip_id,  # 关联对应的视频 clip，方便后续覆盖
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
                        "maxWidth": "85%",  # 字幕最大宽度 85% 画布宽度，适配各种比例
                    },
                    "transform": {
                        "x": 0,
                        "y": 150,
                        "scale": 1,
                    },
                    "metadata": {
                        "segment_id": seg.get("id"),
                        "speaker": seg.get("speaker"),
                        "order_index": seg_idx * 100 + sub_idx,  # 确保顺序唯一
                        "original_start": sub_start,
                        "original_end": sub_end,
                    },
                    "created_at": now,
                    "updated_at": now,
                })
        
        # 更新时间轴位置
        timeline_position += seg_duration
    
    # 输出统计日志
    total_skipped = sum(auto_skipped.values())
    logger.info(f"[Workspace] 创建 {len(video_clips)} 个视频 Clip，{len(subtitle_clips)} 个字幕 Clip")
    if total_skipped > 0:
        logger.info(f"[Workspace] ✂️ 自动切除 {total_skipped} 个静音片段 (共 {auto_skipped_duration/1000:.1f}s): "
              f"死寂={auto_skipped['dead_air']}, 长停顿={auto_skipped['long_pause']}, 卡顿={auto_skipped['hesitation']}")
    
    return video_clips, subtitle_clips


async def _process_session(
    session_id: str,
    project_id: str,
    asset_id: str,
    task_type: str,
):
    """
    后台处理会话
    执行 ASR 转写（已集成智能静音分级）
    支持一键 AI 成片模式（task_type == 'ai-create'）
    """
    import asyncio
    
    # ★ 由 task_type 决定处理流程
    ai_create_mode = task_type == "ai-create"
    # enable_llm 是独立开关，控制是否调用 LLM 进行语义分析
    # TODO: 后续可从请求参数或用户配置获取
    enable_llm = False
    
    if ai_create_mode:
        logger.info(f"[Workspace] 开始一键 AI 成片流程 {session_id}, enable_llm={enable_llm}")
    else:
        logger.info(f"[Workspace] 开始处理会话 {session_id}, task_type={task_type}, enable_llm={enable_llm}")
    
    try:
        update_progress = _create_progress_updater(session_id)
        
        # Step 1: 获取视频数据 (0% → 20%)
        _raise_if_cancelled(session_id, "开始处理")
        update_progress("fetch", 5)
        await asyncio.sleep(0.5)
        
        asset = supabase.table("assets").select("*").eq("id", asset_id).single().execute()
        if not asset.data:
            raise Exception("资源不存在")
        
        storage_path = asset.data.get("storage_path")
        file_url = get_file_url("clips", storage_path)
        
        # 提取视频元数据（宽高、帧率等）
        metadata = await _fetch_asset_metadata(asset_id, file_url)
        # duration 从 asset 表获取（前端传入），不依赖 ffprobe
        duration = asset.data.get("duration") or metadata.get("duration", 0)
        width = metadata.get("width", 1920)
        height = metadata.get("height", 1080)
        # fps 必须是整数（projects 表要求）
        fps_value = metadata.get("fps", 30)
        fps = int(round(fps_value)) if isinstance(fps_value, (int, float)) else 30
        
        update_progress("fetch", 20)
        
        transcript_segments = []
        
        # Step 2: ASR 语音转写（已包含智能静音分级）
        _raise_if_cancelled(session_id, "ASR 转写前")
        update_progress("transcribe", 25)
        logger.info(f"[Workspace] 开始 ASR 转写（含智能静音分级）...")
        transcript_segments = await _run_asr(file_url, update_progress, 20, 60, asset_id=asset_id, video_duration_sec=duration)
        _raise_if_cancelled(session_id, "ASR 转写后")
        update_progress("transcribe", 80)
        
        # ==========================================
        # 一键 AI 成片模式 - 调用 AI 成片服务
        # ==========================================
        if ai_create_mode:
            _raise_if_cancelled(session_id, "AI 成片前")
            update_progress("segment", 35)
            logger.info(f"[Workspace] 进入一键 AI 成片流程...")
            
            from ..services.ai_video_creator import ai_video_creator
            
            # 获取本地视频路径（从 storage_path 构造）
            video_path = f"/tmp/{storage_path}" if storage_path else file_url
            
            # 调用 AI 成片服务
            update_progress("vision", 50)
            ai_result = await ai_video_creator.process(
                video_path=file_url,  # 使用 URL，服务内部会处理
                audio_url=file_url,
                options={
                    "enable_llm": enable_llm,
                    "transcript_segments": transcript_segments  # 传入已有的 ASR 结果
                }
            )
            
            _raise_if_cancelled(session_id, "AI 视觉分析后")
            update_progress("transform", 70)
            
            # 将 AI 结果转换为 Clips
            now = datetime.utcnow().isoformat()
            
            # 创建视频轨道
            video_track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": video_track_id,
                "project_id": project_id,
                "name": "AI 视频轨道",
                "order_index": 0,
                "is_muted": False,
                "is_locked": False,
                "is_visible": True,
                "created_at": now,
                "updated_at": now,
            }).execute()
            
            # 创建字幕轨道
            text_track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": text_track_id,
                "project_id": project_id,
                "name": "AI 字幕轨道",
                "order_index": 1,
                "is_muted": False,
                "is_locked": False,
                "is_visible": True,
                "created_at": now,
                "updated_at": now,
            }).execute()
            
            update_progress("subtitle", 85)
            
            # 从 AI 结果创建 Clips
            video_clips = []
            subtitle_clips = []
            
            timeline_position = 0
            breath_count = 0
            speech_count = 0
            
            for seg_idx, seg in enumerate(ai_result.segments):
                clip_duration = int(seg.end - seg.start)
                
                # 判断是否为换气片段
                is_breath = seg.is_breath if hasattr(seg, "is_breath") else False
                is_silence = seg.is_silence if hasattr(seg, "is_silence") else False
                
                # 为片段命名
                if is_breath:
                    clip_name = "换气"
                    breath_count += 1
                elif is_silence:
                    clip_name = "静音"
                else:
                    speech_count += 1
                    clip_name = f"片段 {speech_count}"
                
                # 生成视频 clip ID，后续字幕需要关联
                video_clip_id = str(uuid4())
                
                # 视频 Clip
                video_clip = {
                    "id": video_clip_id,
                    "track_id": video_track_id,
                    "asset_id": asset_id,
                    "clip_type": "video",
                    "name": clip_name,
                    "start_time": timeline_position,
                    "end_time": timeline_position + clip_duration,
                    "source_start": int(seg.start),
                    "source_end": int(seg.end),
                    "is_muted": False,
                    "created_at": now,
                    "updated_at": now,
                }
                
                # 添加元数据 (保留静音分级信息)
                if hasattr(seg, "metadata") and seg.metadata:
                    video_clip["metadata"] = seg.metadata
                
                # 添加运镜关键帧 (如果有)
                if hasattr(seg, "transform") and seg.transform:
                    video_clip["transform"] = seg.transform
                
                video_clips.append(video_clip)
                
                # 字幕 Clip (只有语音片段才生成字幕，按标点切分)
                if seg.text and not is_breath and not is_silence:
                    # 将 SmartSegment 转换为标准 segment dict 用于切分
                    seg_dict = {
                        "id": seg.id,
                        "text": seg.text,
                        "start": int(seg.start),
                        "end": int(seg.end),
                    }
                    
                    # 按标点切分成多个子句
                    fine_subs = _split_segments_by_punctuation([seg_dict])
                    
                    # 为每个子句创建字幕 clip
                    for sub_idx, sub_seg in enumerate(fine_subs):
                        sub_start = sub_seg.get("start", seg.start)
                        sub_end = sub_seg.get("end", seg.end)
                        sub_text = sub_seg.get("text", "").strip()
                        sub_duration = sub_end - sub_start
                        
                        if sub_duration <= 0 or not sub_text:
                            continue
                        
                        # 字幕在时间轴上的位置 = 当前视频 clip 开始位置 + 相对偏移
                        subtitle_timeline_start = timeline_position + (sub_start - int(seg.start))
                        
                        subtitle_clip = {
                            "id": str(uuid4()),
                            "track_id": text_track_id,
                            "clip_type": "subtitle",
                            "parent_clip_id": video_clip_id,  # 关联对应的视频 clip，方便后续覆盖
                            "start_time": subtitle_timeline_start,
                            "end_time": subtitle_timeline_start + sub_duration,
                            "content_text": sub_text,
                            "text_style": {
                                "fontSize": 15,
                                "fontColor": "#FFFFFF",
                                "backgroundColor": "transparent",
                                "alignment": "center",
                                "maxWidth": "85%",  # 字幕最大宽度 85% 画布宽度
                            },
                            "transform": {
                                "x": 0,
                                "y": 150,
                                "scale": 1,
                            },
                            "is_muted": False,
                            "metadata": {
                                "segment_id": seg.id,
                                "order_index": seg_idx * 100 + sub_idx,  # 确保顺序唯一
                                "original_start": sub_start,
                                "original_end": sub_end,
                            },
                            "created_at": now,
                            "updated_at": now,
                        }
                        subtitle_clips.append(subtitle_clip)
                
                timeline_position += clip_duration
            
            logger.info(f"[Workspace] 📊 AI 成片统计: 语音片段 {speech_count}, 换气保留 {breath_count}")
            
            # 批量插入前检查取消状态
            _raise_if_cancelled(session_id, "插入 Clip 前")
            
            # 批量插入
            if video_clips:
                supabase.table("clips").insert(video_clips).execute()
                logger.info(f"[Workspace] ✅ AI 成片创建 {len(video_clips)} 个视频 Clip")
            if subtitle_clips:
                supabase.table("clips").insert(subtitle_clips).execute()
                logger.info(f"[Workspace] ✅ AI 成片创建 {len(subtitle_clips)} 个字幕 Clip")
            
            update_progress("prepare", 95)
            
            # 完成
            now_complete = datetime.utcnow().isoformat()
            supabase.table("workspace_sessions").update({
                "status": "completed",
                "progress": 100,
                "current_step": "completed",
                "completed_at": now_complete,
                "updated_at": now_complete
            }).eq("id", session_id).execute()
            
            logger.info(f"[Workspace] ✅ 一键 AI 成片完成！")
            return
        
        # ==========================================
        # Step 3: 准备工作台 - 创建轨道和 Clip (普通模式)
        # ==========================================
        _raise_if_cancelled(session_id, "创建轨道前")
        update_progress("prepare", 90)
        
        now = datetime.utcnow().isoformat()
        
        # 创建视频轨道
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
        
        clip_duration_ms = int((duration if duration > 0 else 10) * 1000)
        
        # 如果有 ASR 结果，根据语音片段切分视频
        if transcript_segments:
            # 创建文本轨道
            text_track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": text_track_id,
                "project_id": project_id,
                "name": "转写文本",
                "order_index": 1,
                "is_muted": False,
                "is_locked": False,
                "is_visible": True,
                "created_at": now,
                "updated_at": now,
            }).execute()
            
            # 使用辅助函数创建 clips
            video_clips, subtitle_clips = _create_clips_from_segments(
                project_id=project_id,
                asset_id=asset_id,
                transcript_segments=transcript_segments,
                video_track_id=video_track_id,
                text_track_id=text_track_id,
            )
            
            # 批量插入所有 clips
            if video_clips:
                supabase.table("clips").insert(video_clips).execute()
                logger.info(f"[Workspace] ✅ 创建 {len(video_clips)} 个视频 Clip 成功")
            
            if subtitle_clips:
                supabase.table("clips").insert(subtitle_clips).execute()
                logger.info(f"[Workspace] ✅ 创建 {len(subtitle_clips)} 个字幕 Clip 成功")
        else:
            # 没有 ASR 结果，创建完整视频 Clip
            video_clip_id = str(uuid4())
            supabase.table("clips").insert({
                "id": video_clip_id,
                "track_id": video_track_id,
                "asset_id": asset_id,
                "clip_type": "video",
                "start_time": 0,
                "end_time": clip_duration_ms,
                "source_start": 0,
                "source_end": clip_duration_ms,
                "is_muted": False,
                "created_at": now,
                "updated_at": now,
            }).execute()
        
        # 更新项目
        supabase.table("projects").update({
            "status": "ready",
            "resolution": {"width": width, "height": height},
            "fps": fps,
            "updated_at": now,
        }).eq("id", project_id).execute()
        
        update_progress("prepare", 100)
        
        # 标记会话完成
        # 计算静音片段数量（通过 silence_info 字段判断）
        silence_count = len([s for s in transcript_segments if s.get("silence_info")])
        
        supabase.table("workspace_sessions").update({
            "status": "completed",
            "progress": 100,
            "transcript_segments": len(transcript_segments),
            "marked_clips": silence_count,  # 静音片段数量（已集成到 ASR）
            "completed_at": now,
            "updated_at": now,
        }).eq("id", session_id).execute()
        
        logger.info(f"[Workspace] ✅ 会话 {session_id} 处理完成")
        
    except SessionCancelledException:
        # 用户主动取消，不需要更新状态（已经是 cancelled）
        logger.info(f"[Workspace] 🛑 会话 {session_id} 处理已被用户取消")
        return
    except Exception as e:
        logger.error(f"[Workspace] ❌ 处理失败: {e}")
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
    # enable_llm 是独立开关，控制是否调用 LLM 进行语义分析
    # TODO: 后续可从请求参数或用户配置获取
    enable_llm = False
    
    logger.info(f"[Workspace] ========================================")
    logger.info(f"[Workspace] 🚀 开始处理多素材会话")
    logger.info(f"[Workspace]    session_id: {session_id}")
    logger.info(f"[Workspace]    project_id: {project_id}")
    logger.info(f"[Workspace]    task_type: {task_type}")
    logger.info(f"[Workspace]    ai_create_mode: {ai_create_mode}")
    logger.info(f"[Workspace]    voice_extract_mode: {voice_extract_mode}")
    logger.info(f"[Workspace]    enable_llm: {enable_llm}")
    logger.info(f"[Workspace]    素材数量: {len(assets)}")
    logger.info(f"[Workspace] ========================================")
    
    try:
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
            logger.info(f"[Workspace] 📦 获取素材 {idx_asset + 1}/{len(assets)} 元数据: {asset_id}")
            logger.info(f"[Workspace]    storage_path: {storage_path}")
            file_url = get_file_url("clips", storage_path)
            logger.info(f"[Workspace]    file_url: {file_url[:80]}...")
            
            # 获取元数据（包括编码信息）
            metadata = await _fetch_asset_metadata(asset_id, file_url)
            logger.info(f"[Workspace]    metadata: {metadata}")
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
        # 🚀 启动 HLS 后台生成（所有需要转码的视频 + 大视频）
        # ========================================
        # ★ 移除阻塞转码！HLS 流本身就是 H.264 编码，前端优先使用 HLS 播放
        # ★ ProRes 等浏览器不支持的格式会通过 HLS 转码后播放
        from ..tasks.asset_processing import generate_hls_from_url
        
        # HLS 生成条件：
        # 1. 需要转码的视频（ProRes、HEVC 等）- 必须生成 HLS 才能播放
        # 2. 时长 > 2分钟 或 分辨率 > 1080p 的视频 - 优化播放体验
        HLS_DURATION_THRESHOLD = 120  # 秒
        HLS_RESOLUTION_THRESHOLD = 1920  # 像素
        
        assets_need_hls = [
            info for info in asset_infos
            if info.get("needs_transcode")  # ★ ProRes 等必须生成 HLS
               or info["duration"] > HLS_DURATION_THRESHOLD 
               or max(info["width"], info["height"]) > HLS_RESOLUTION_THRESHOLD
        ]
        
        # ★ 标记需要 HLS 的素材（前端会等待 HLS 就绪后再播放）
        for info in assets_need_hls:
            asset_id = info["asset_id"]
            needs_transcode = info.get("needs_transcode", False)
            try:
                supabase.table("assets").update({
                    "hls_status": "pending",  # pending -> processing -> ready
                    "needs_transcode": needs_transcode,
                }).eq("id", asset_id).execute()
            except Exception as e:
                logger.warning(f"[Workspace] 更新 HLS 状态失败: {e}")
        
        async def generate_all_hls():
            """顺序生成 HLS，避免多个 FFmpeg 并发导致资源竞争"""
            for info in assets_need_hls:
                asset_id = info["asset_id"]
                file_url = info["file_url"]
                codec = info.get("codec", "unknown")
                logger.info(f"[Workspace] 🎬 启动 HLS 生成: {asset_id} (codec={codec}, duration={info['duration']:.1f}s)")
                try:
                    hls_path = await generate_hls_from_url(asset_id, file_url)
                    if hls_path:
                        # ★ 成功：同时设置 hls_status 和 hls_path
                        supabase.table("assets").update({
                            "hls_status": "ready",
                            "hls_path": hls_path
                        }).eq("id", asset_id).execute()
                        logger.info(f"[Workspace] ✅ HLS 生成成功: {asset_id}, path={hls_path}")
                    else:
                        # HLS 生成返回 None（失败）
                        supabase.table("assets").update({
                            "hls_status": "failed"
                        }).eq("id", asset_id).execute()
                        logger.error(f"[Workspace] ❌ HLS 生成失败（返回空）: {asset_id}")
                except Exception as e:
                    logger.error(f"[Workspace] HLS 生成失败 {asset_id}: {e}")
                    supabase.table("assets").update({
                        "hls_status": "failed"
                    }).eq("id", asset_id).execute()
        
        # 后台启动 HLS 生成（不阻塞主流程）
        hls_task = None
        if assets_need_hls:
            hls_task = asyncio.create_task(generate_all_hls())
            logger.info(f"[Workspace] 📦 已启动 HLS 生成任务（{len(assets_need_hls)}/{len(asset_infos)} 个素材需要 HLS）")
        else:
            logger.info(f"[Workspace] ⏭️ 跳过 HLS 生成（所有 {len(asset_infos)} 个素材都是小视频，直接播放原文件）")
        
        # Step 2: 创建轨道
        # 1. 视频轨道 (始终创建，Track 0)
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
        
        audio_track_id = None
        main_track_id = video_track_id  # 默认主轨道是视频轨
        
        # 2. 如果是 Voice Extract 模式，创建音频轨道 (Track 1)
        if voice_extract_mode:
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
            main_track_id = audio_track_id  # 主素材放在音频轨
        
        # 3. 字幕轨道 (Track 2)
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
        
        # Step 3: 按顺序处理每个素材的 ASR (10% → 80%)
        all_video_clips = []
        all_subtitle_clips = []
        all_keyframes = []  # ★ 收集所有关键帧（统一存储到 keyframes 表）
        timeline_position = 0
        total_segments = 0
        
        progress_per_asset = 70 / len(asset_infos)  # 每个素材占 70% 进度
        
        for idx, info in enumerate(asset_infos):
            # 每个素材处理前检查取消状态
            _raise_if_cancelled(session_id, f"处理素材 {idx + 1}/{len(asset_infos)} 前")
            
            asset_id = info["asset_id"]
            file_url = info["file_url"]
            asset_duration_ms = info["duration_ms"]
            
            base_progress = 10 + int(idx * progress_per_asset)
            logger.info(f"[Workspace] ========================================")
            logger.info(f"[Workspace] 📹 处理素材 {idx + 1}/{len(asset_infos)}")
            logger.info(f"[Workspace]    名称: {info['name']}")
            logger.info(f"[Workspace]    asset_id: {asset_id}")
            logger.info(f"[Workspace]    时长: {info['duration']:.1f}s ({asset_duration_ms}ms)")
            logger.info(f"[Workspace]    base_progress: {base_progress}%")
            logger.info(f"[Workspace] ========================================")
            
            transcript_segments = []
            
            # ASR 转写（始终执行）
            logger.info(f"[Workspace] 🎙️ 开始 ASR 转写素材 {idx + 1}...")
            logger.info(f"[Workspace]    ASR 输入 URL: {file_url}")
            update_progress("transcribe", base_progress + 5)
            
            # 如果不是第一个素材，等待一小段时间避免 API 限流
            if idx > 0:
                logger.info(f"[Workspace]    ⏳ 等待 2 秒避免 API 限流...")
                await asyncio.sleep(2)
            
            try:
                transcript_segments = await _run_asr(
                    file_url, 
                    update_progress,
                    base_progress,
                    int(progress_per_asset),  # step_progress: 这个素材占的进度范围
                    asset_id=asset_id,
                    video_duration_sec=info['duration']  # ★ 传入视频时长
                )
                
                logger.info(f"[Workspace] ✅ ASR 完成素材 {idx + 1}, 识别 {len(transcript_segments)} 个片段")
                
                # ASR 完成后检查取消状态
                _raise_if_cancelled(session_id, f"素材 {idx + 1} ASR 后")
                
                # 统计 breath 片段数量（注意 silence_info 可能为 None）
                breath_count = sum(1 for seg in transcript_segments if (seg.get("silence_info") or {}).get("classification") == "breath")
                speech_count = sum(1 for seg in transcript_segments if not seg.get("silence_info"))
                logger.info(f"[Workspace]    其中: 语音片段 {speech_count} 个, 换气片段 {breath_count} 个")
                
                total_segments += len(transcript_segments)
            except Exception as asr_err:
                logger.error(f"[Workspace] ❌ ASR 转写素材 {idx + 1} 失败: {asr_err}")
                import traceback
                traceback.print_exc()
            
            # 创建 clips（带时间轴偏移）
            # 注意：如果 voice_extract_mode，传入 audio_track_id 作为 main_track_id
            # ★ Voice Extract 模式：禁用智能运镜（不需要关键帧）
            video_clips, subtitle_clips, keyframes = await _create_clips_from_segments_with_offset(
                project_id=project_id,
                asset_id=asset_id,
                transcript_segments=transcript_segments,
                video_track_id=main_track_id,  # 传入主轨道ID (可能是音频轨ID)
                text_track_id=text_track_id,
                timeline_offset=timeline_position,
                asset_index=idx,
                enable_llm=enable_llm,
                enable_smart_camera=not voice_extract_mode,  # ★ Voice Extract 禁用智能运镜
            )
            
            # ★ 如果是 Voice Extract 模式，修正 clip_type 为 audio
            if voice_extract_mode and video_clips:
                for clip in video_clips:
                    clip["clip_type"] = "audio"
                    # 移除不必要的视觉属性
                    if "transform" in clip:
                        del clip["transform"]
            
            all_video_clips.extend(video_clips)
            all_subtitle_clips.extend(subtitle_clips)
            all_keyframes.extend(keyframes)  # ★ 收集关键帧
            
            # 计算实际用到的时长（排除跳过的静音）
            if video_clips:
                last_clip = max(video_clips, key=lambda c: c["end_time"])
                timeline_position = last_clip["end_time"]
            else:
                timeline_position += asset_duration_ms
            
            logger.info(f"[Workspace] ✅ 素材 {idx + 1} 处理完成，时间轴位置: {timeline_position}ms")
        
        # Step 4: 批量插入所有 clips (80% → 95%)
        _raise_if_cancelled(session_id, "批量插入 clips 前")
        update_progress("prepare", 85)
        
        if all_video_clips:
            supabase.table("clips").insert(all_video_clips).execute()
            logger.info(f"[Workspace] ✅ 创建 {len(all_video_clips)} 个视频 Clip")
        
        if all_subtitle_clips:
            supabase.table("clips").insert(all_subtitle_clips).execute()
            logger.info(f"[Workspace] ✅ 创建 {len(all_subtitle_clips)} 个字幕 Clip")
        
        # ★ 批量插入关键帧到 keyframes 表（统一存储）
        if all_keyframes:
            supabase.table("keyframes").insert(all_keyframes).execute()
            logger.info(f"[Workspace] ✅ 创建 {len(all_keyframes)} 个关键帧")
        
        # ========================================
        # 🎬 等待 HLS 后台任务完成（带超时）
        # ========================================
        update_progress("prepare", 90)
        
        if 'hls_task' in locals() and hls_task:
            logger.info(f"[Workspace] ⏳ 等待 HLS 生成任务完成（最多 120 秒）...")
            try:
                # 设置超时，避免无限等待
                await asyncio.wait_for(hls_task, timeout=120.0)
                logger.info(f"[Workspace] ✅ HLS 生成任务完成")
            except asyncio.TimeoutError:
                logger.warning(f"[Workspace] ⚠️ HLS 任务超时（120秒），继续处理...")
                hls_task.cancel()
            except Exception as e:
                logger.warning(f"[Workspace] ⚠️ HLS 任务异常: {e}")
        
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
        # 取消未完成的 HLS 任务
        if 'hls_task' in locals() and hls_task and not hls_task.done():
            hls_task.cancel()
            logger.info(f"[Workspace] 🛑 取消 HLS 任务")
        return
    except Exception as e:
        logger.error(f"[Workspace] ❌ 多素材处理失败: {e}")
        import traceback
        traceback.print_exc()
        
        # 取消未完成的 HLS 任务
        if 'hls_task' in locals() and hls_task and not hls_task.done():
            hls_task.cancel()
            logger.info(f"[Workspace] 🛑 取消 HLS 任务")
        
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
    llm_results = {}
    if enable_llm and valid_segments:
        from ..services.llm_service import analyze_segments_batch, is_llm_configured
        
        if is_llm_configured():
            logger.info(f"[Workspace] 🤖 开始 LLM 语义分析...")
            # 构建待分析的文本片段
            text_segments = []
            for seg_idx, seg, seg_duration, clip_name, is_breath, silence_info in valid_segments:
                seg_text = seg.get("text", "").strip()
                if seg_text and not is_breath:
                    text_segments.append({"id": str(seg_idx), "text": seg_text})
            
            if text_segments:
                try:
                    llm_results = await analyze_segments_batch(text_segments)
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
        
        # 从 LLM 结果获取情绪和重要性，或使用默认值
        seg_id_str = str(seg_idx)
        llm_data = llm_results.get(seg_id_str, {})
        emotion_str = llm_data.get("emotion", "neutral")
        importance_str = llm_data.get("importance", "medium")
        
        try:
            emotion = EmotionType(emotion_str)
        except ValueError:
            emotion = EmotionType.NEUTRAL
        try:
            importance = ImportanceLevel(importance_str)
        except ValueError:
            importance = ImportanceLevel.MEDIUM
        
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
