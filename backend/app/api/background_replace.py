"""
背景替换工作流 API

提供背景替换 Agent Workflow 的 REST 接口:
- 查询工作流状态
- SSE 事件流
- 控制接口 (取消/重试)
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List, AsyncGenerator
from datetime import datetime
import asyncio
import json
import logging

from app.services.background_replace_workflow import (
    get_background_replace_workflow,
    BackgroundReplaceTask,
    WorkflowStatus,
    WorkflowStage,
)
from app.services.video_element_replace_service import (
    get_video_element_replace_service,
    ReplaceTask,
    ReplaceStatus,
    ReplaceStrategy,
)
from app.api.auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/background-replace", tags=["Background Replace Workflow"])


# ==========================================
# 请求/响应模型
# ==========================================

class CreateWorkflowRequest(BaseModel):
    """创建工作流请求"""
    clip_id: str = Field(..., description="目标 clip ID")
    session_id: str = Field(..., description="会话 ID")
    project_id: Optional[str] = Field(None, description="项目 ID（用于任务列表筛选）")
    video_url: str = Field(..., description="原视频 URL")
    background_image_url: str = Field(..., description="新背景图片 URL")
    prompt: Optional[str] = Field(None, description="用户描述（可选）")
    
    # [新增] 编辑相关参数
    edit_mask_url: Optional[str] = Field(None, description="用户涂抹区域的 mask 图片 URL")
    edited_frame_url: Optional[str] = Field(None, description="用户编辑后的完整帧 URL")
    original_audio_url: Optional[str] = Field(None, description="原视频音频 URL（用于口型同步）")
    force_strategy: Optional[str] = Field(None, description="强制策略: background_only / person_minor_edit / person_major_edit")
    
    class Config:
        json_schema_extra = {
            "example": {
                "clip_id": "clip-123",
                "session_id": "session-456",
                "video_url": "https://example.com/video.mp4",
                "background_image_url": "https://example.com/background.jpg",
                "prompt": "日落时分的海滩",
                "edit_mask_url": "https://example.com/mask.png",
                "edited_frame_url": "https://example.com/edited_frame.jpg",
                "original_audio_url": "https://example.com/audio.mp3",
                "force_strategy": None
            }
        }


class WorkflowResponse(BaseModel):
    """工作流响应"""
    id: str
    clip_id: str
    session_id: str
    status: str
    current_stage: str
    stage_progress: int
    overall_progress: int
    error: Optional[str] = None
    result_url: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    # [新增] 策略信息
    detected_strategy: Optional[str] = None
    strategy_confidence: Optional[float] = None
    strategy_recommendation: Optional[str] = None
    
    # 质量报告
    qa_passed: Optional[bool] = None
    qa_score: Optional[float] = None
    
    @classmethod
    def from_task(cls, task: BackgroundReplaceTask) -> "WorkflowResponse":
        return cls(
            id=task.id,
            clip_id=task.clip_id,
            session_id=task.session_id,
            status=task.status.value,
            current_stage=task.current_stage.value,
            stage_progress=task.stage_progress,
            overall_progress=task.overall_progress,
            error=task.error,
            result_url=task.result_url,
            created_at=task.created_at,
            updated_at=task.updated_at,
            detected_strategy=task.detected_strategy.value if task.detected_strategy else None,
            strategy_confidence=task.edit_detection.confidence if task.edit_detection else None,
            strategy_recommendation=task.edit_detection.recommendation if task.edit_detection else None,
            qa_passed=task.qa_report.passed if task.qa_report else None,
            qa_score=task.qa_report.overall_score if task.qa_report else None,
        )


class WorkflowDetailResponse(WorkflowResponse):
    """工作流详细响应（包含中间结果）"""
    analysis_completed: bool = False
    foreground_completed: bool = False
    background_completed: bool = False
    composite_completed: bool = False
    
    # 各阶段质量评分
    foreground_quality: Optional[float] = None
    composite_quality: Optional[float] = None
    
    # 质量报告详情
    qa_report: Optional[Dict[str, Any]] = None
    
    @classmethod
    def from_task_detail(cls, task: BackgroundReplaceTask) -> "WorkflowDetailResponse":
        base = WorkflowResponse.from_task(task)
        
        return cls(
            **base.model_dump(),
            analysis_completed=task.analysis is not None,
            foreground_completed=task.foreground is not None,
            background_completed=task.background_video is not None,
            composite_completed=task.composite is not None,
            foreground_quality=task.foreground.quality_score if task.foreground else None,
            composite_quality=task.composite.quality_score if task.composite else None,
            qa_report={
                "overall_score": task.qa_report.overall_score,
                "temporal_consistency": task.qa_report.temporal_consistency,
                "edge_quality": task.qa_report.edge_quality,
                "color_consistency": task.qa_report.color_consistency,
                "lighting_match": task.qa_report.lighting_match,
                "flicker_score": task.qa_report.flicker_score,
                "artifact_score": task.qa_report.artifact_score,
                "passed": task.qa_report.passed,
            } if task.qa_report else None,
        )


# ==========================================
# API 端点
# ==========================================

@router.post("/workflows", response_model=WorkflowResponse)
async def create_workflow(
    request: CreateWorkflowRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    创建背景替换工作流（治本方案）
    
    使用 Kling 多模态视频编辑 API 直接在视频上替换元素：
    - 保持原视频的：音频、动作、运镜、节奏
    - 只替换画面中的背景/人物
    
    策略A (纯背景替换):
    - 使用 Kling multi-elements swap API
    - 保持人物动作、口型、音频完全不变
    
    策略B (人物替换):
    - 使用 Kling motion-control + lip-sync API
    - 新人物 + 原动作 + 原口型 + 原音频
    """
    try:
        service = get_video_element_replace_service()
        
        # 根据 force_strategy 或 edited_frame_url 决定策略
        use_person_replace = (
            request.force_strategy == "person_major_edit" or
            request.force_strategy == "person_minor_edit"
        )
        
        if use_person_replace and request.edited_frame_url:
            # 策略B：人物替换
            replace_task = await service.replace_person(
                clip_id=request.clip_id,
                video_url=request.video_url,
                new_person_url=request.edited_frame_url,  # 编辑后的人物图
                original_audio_url=request.original_audio_url,
                prompt=request.prompt,
                user_id=user_id,
                project_id=request.project_id,
            )
        else:
            # 策略A：背景替换（默认）
            replace_task = await service.replace_background(
                clip_id=request.clip_id,
                video_url=request.video_url,
                new_background_url=request.background_image_url,
                prompt=request.prompt,
                user_id=user_id,
                project_id=request.project_id,
            )
        
        logger.info(f"[WorkflowAPI] 创建工作流成功: {replace_task.id}, 策略: {replace_task.strategy.value}")
        
        # 转换为兼容的响应格式
        return WorkflowResponse(
            id=replace_task.id,
            clip_id=replace_task.clip_id,
            session_id=request.session_id,
            status=replace_task.status.value,
            current_stage=replace_task.status.value,  # 新服务没有分阶段
            stage_progress=replace_task.progress,
            overall_progress=replace_task.progress,
            error=replace_task.error,
            result_url=replace_task.result_video_url,
            created_at=replace_task.created_at,
            updated_at=replace_task.updated_at,
            detected_strategy=replace_task.strategy.value,
            strategy_confidence=1.0,
            strategy_recommendation=f"使用 {replace_task.strategy.value} 策略",
            qa_passed=replace_task.status == ReplaceStatus.COMPLETED,
            qa_score=1.0 if replace_task.status == ReplaceStatus.COMPLETED else None,
        )
        
    except Exception as e:
        import traceback
        logger.error(f"[WorkflowAPI] 创建工作流失败: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e) if str(e) else repr(e))


@router.get("/workflows/{workflow_id}", response_model=WorkflowDetailResponse)
async def get_workflow(workflow_id: str):
    """
    获取工作流详细状态
    
    返回工作流的完整信息，包括:
    - 当前阶段和进度
    - 各阶段完成状态
    - 质量评分
    - 最终结果
    """
    # 先尝试从新服务获取
    service = get_video_element_replace_service()
    task = service.get_task(workflow_id)
    
    if task:
        # 转换为兼容格式
        return WorkflowDetailResponse(
            id=task.id,
            clip_id=task.clip_id,
            session_id="",
            status=task.status.value,
            current_stage=task.status.value,
            stage_progress=task.progress,
            overall_progress=task.progress,
            error=task.error,
            result_url=task.result_video_url,
            created_at=task.created_at,
            updated_at=task.updated_at,
            detected_strategy=task.strategy.value,
            strategy_confidence=1.0,
            strategy_recommendation=f"使用 {task.strategy.value} 策略",
            qa_passed=task.status == ReplaceStatus.COMPLETED,
            qa_score=1.0 if task.status == ReplaceStatus.COMPLETED else None,
            analysis_completed=True,
            foreground_completed=True,
            background_completed=True,
            composite_completed=task.status == ReplaceStatus.COMPLETED,
        )
    
    # 回退到旧 workflow
    workflow = get_background_replace_workflow()
    old_task = await workflow.get_task(workflow_id)
    
    if not old_task:
        raise HTTPException(status_code=404, detail="工作流不存在")
    
    return WorkflowDetailResponse.from_task_detail(old_task)


@router.get("/workflows")
async def list_workflows(
    session_id: str = Query(..., description="会话 ID"),
    status: Optional[str] = Query(None, description="状态过滤")
):
    """
    列出会话的所有工作流
    """
    # 从新服务获取任务
    service = get_video_element_replace_service()
    new_tasks = service.list_tasks()
    
    # 转换为响应格式
    results = []
    for task in new_tasks:
        results.append(WorkflowResponse(
            id=task.id,
            clip_id=task.clip_id,
            session_id=session_id,
            status=task.status.value,
            current_stage=task.status.value,
            stage_progress=task.progress,
            overall_progress=task.progress,
            error=task.error,
            result_url=task.result_video_url,
            created_at=task.created_at,
            updated_at=task.updated_at,
            detected_strategy=task.strategy.value,
            strategy_confidence=1.0,
            strategy_recommendation=f"使用 {task.strategy.value} 策略",
            qa_passed=task.status == ReplaceStatus.COMPLETED,
            qa_score=1.0 if task.status == ReplaceStatus.COMPLETED else None,
        ))
    
    # 状态过滤
    if status:
        results = [r for r in results if r.status == status]
    
    return {
        "workflows": results,
        "total": len(results)
    }


@router.post("/workflows/{workflow_id}/cancel")
async def cancel_workflow(workflow_id: str):
    """
    取消工作流
    
    正在执行的阶段会尝试安全终止
    """
    workflow = get_background_replace_workflow()
    task = await workflow.get_task(workflow_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="工作流不存在")
    
    if task.status == WorkflowStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="工作流已完成，无法取消")
    
    if task.status == WorkflowStatus.FAILED:
        raise HTTPException(status_code=400, detail="工作流已失败")
    
    # TODO: 实现取消逻辑
    task.status = WorkflowStatus.FAILED
    task.error = "用户取消"
    task.updated_at = datetime.utcnow()
    
    return {"status": "cancelled", "workflow_id": workflow_id}


@router.post("/workflows/{workflow_id}/retry")
async def retry_workflow(workflow_id: str):
    """
    重试失败的工作流
    
    从上次检查点恢复执行
    """
    workflow = get_background_replace_workflow()
    task = await workflow.get_task(workflow_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="工作流不存在")
    
    if task.status != WorkflowStatus.FAILED:
        raise HTTPException(status_code=400, detail="只能重试失败的工作流")
    
    # TODO: 实现从检查点恢复
    raise HTTPException(status_code=501, detail="重试功能开发中")


@router.get("/workflows/{workflow_id}/events")
async def workflow_events(workflow_id: str):
    """
    工作流事件 SSE 流
    
    实时推送工作流进度更新
    """
    workflow = get_background_replace_workflow()
    task = await workflow.get_task(workflow_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="工作流不存在")
    
    async def event_generator() -> AsyncGenerator[str, None]:
        queue = asyncio.Queue()
        
        # 注册事件回调
        async def callback(event: dict):
            await queue.put(event)
        
        workflow.register_event_callback(task.session_id, callback)
        
        try:
            # 发送初始状态
            yield f"data: {json.dumps({'type': 'connected', 'workflow_id': workflow_id})}\n\n"
            
            # 持续发送事件
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    
                    if event.get("task_id") == workflow_id:
                        yield f"data: {json.dumps(event)}\n\n"
                        
                        # 工作流结束时关闭连接
                        if event.get("event_type") in ["completed", "failed"]:
                            break
                            
                except asyncio.TimeoutError:
                    # 心跳
                    yield f": heartbeat\n\n"
                    
        except asyncio.CancelledError:
            pass
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ==========================================
# 工作流阶段信息
# ==========================================

@router.get("/stages")
async def get_stages_info():
    """
    获取工作流阶段信息
    
    返回各阶段的描述和预计时间
    """
    return {
        "stages": [
            {
                "id": "analyzing",
                "name": "视频分析",
                "description": "分析原视频的光线、运动、场景等特征",
                "estimated_time": "10-15秒",
                "progress_range": [0, 15],
            },
            {
                "id": "separating",
                "name": "前景分离",
                "description": "高精度提取人物，包括头发丝等细节",
                "estimated_time": "20-40秒",
                "progress_range": [15, 35],
            },
            {
                "id": "generating",
                "name": "背景生成",
                "description": "将静态背景转换为动态视频",
                "estimated_time": "60-120秒",
                "progress_range": [35, 65],
            },
            {
                "id": "compositing",
                "name": "智能合成",
                "description": "光影匹配、边缘融合、阴影生成",
                "estimated_time": "15-30秒",
                "progress_range": [65, 85],
            },
            {
                "id": "enhancing",
                "name": "质量增强",
                "description": "去闪烁、AI痕迹修复、质量验证",
                "estimated_time": "10-20秒",
                "progress_range": [85, 100],
            },
        ],
        "total_estimated_time": "2-4分钟",
    }


# ==========================================
# 应用替换结果到 Clip
# ==========================================

class ApplyResultRequest(BaseModel):
    """应用替换结果请求"""
    task_id: str = Field(..., description="AI 任务 ID")
    clip_id: str = Field(..., description="目标 Clip ID")
    result_url: str = Field(..., description="替换结果视频 URL")


class ApplyResultResponse(BaseModel):
    """应用替换结果响应"""
    success: bool
    clip_id: str
    new_asset_id: Optional[str] = None
    message: str


@router.post("/apply", response_model=ApplyResultResponse)
async def apply_replace_result(
    request: ApplyResultRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    将背景替换结果应用到 Clip
    
    策略说明：
    - 不删除原 clip，而是更新 clip 的 asset_id 指向新素材
    - 原素材保留，支持用户撤销
    - 自动从结果视频获取时长，更新 source_start/source_end
    
    流程：
    1. 下载结果视频，获取时长
    2. 创建新的 asset 记录
    3. 更新 clip.asset_id 指向新 asset
    4. 更新 clip.source_start/source_end
    """
    from app.services.supabase_client import supabase
    import subprocess
    import tempfile
    import httpx
    import os
    
    try:
        logger.info(f"[ApplyResult] 开始应用替换结果: task={request.task_id}, clip={request.clip_id}")
        
        # 1. 验证任务状态
        task_result = supabase.table("tasks").select("*").eq("id", request.task_id).single().execute()
        if not task_result.data:
            raise HTTPException(status_code=404, detail="任务不存在")
        
        task_data = task_result.data
        if task_data["status"] != "completed":
            raise HTTPException(status_code=400, detail=f"任务未完成，当前状态: {task_data['status']}")
        
        # 2. 获取原 clip 信息
        clip_result = supabase.table("clips").select("*, assets(*)").eq("id", request.clip_id).single().execute()
        if not clip_result.data:
            raise HTTPException(status_code=404, detail="Clip 不存在")
        
        clip_data = clip_result.data
        original_asset = clip_data.get("assets", {})
        project_id = clip_data.get("project_id")
        track_id = clip_data.get("track_id")
        
        # 3. 下载结果视频获取时长
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(request.result_url, follow_redirects=True)
            response.raise_for_status()
            
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
                f.write(response.content)
                video_path = f.name
        
        try:
            # 使用 ffprobe 获取时长
            cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            duration_seconds = float(result.stdout.strip())
            duration_ms = int(duration_seconds * 1000)
        finally:
            os.unlink(video_path)
        
        logger.info(f"[ApplyResult] 结果视频时长: {duration_seconds}s ({duration_ms}ms)")
        
        # 4. 创建新的 asset 记录
        import uuid
        from datetime import datetime
        
        new_asset_id = str(uuid.uuid4())
        new_asset = {
            "id": new_asset_id,
            "project_id": project_id,
            "user_id": user_id,
            "name": f"背景替换_{datetime.utcnow().strftime('%H%M%S')}",
            "file_type": "video",
            "storage_path": request.result_url,  # 直接使用 URL
            "duration": duration_ms,
            "status": "ready",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        
        supabase.table("assets").insert(new_asset).execute()
        logger.info(f"[ApplyResult] 创建新 asset: {new_asset_id}")
        
        # 5. 更新 clip 指向新 asset
        # 保留原 clip 的时间轴位置（start_time, duration），只更新素材引用
        clip_update = {
            "asset_id": new_asset_id,
            "source_start": 0,  # 新视频从头开始
            "source_end": duration_ms,  # 使用新视频的完整时长
            "updated_at": datetime.utcnow().isoformat(),
        }
        
        supabase.table("clips").update(clip_update).eq("id", request.clip_id).execute()
        logger.info(f"[ApplyResult] 更新 clip: {request.clip_id} -> asset: {new_asset_id}")
        
        # 6. 更新 tasks 记录，关联结果信息
        supabase.table("tasks").update({
            "result_asset_id": new_asset_id,
            "metadata": {
                **(task_data.get("metadata") or {}),
                "applied": True,
                "applied_at": datetime.utcnow().isoformat(),
                "original_asset_id": clip_data.get("asset_id"),
            }
        }).eq("id", request.task_id).execute()
        
        return ApplyResultResponse(
            success=True,
            clip_id=request.clip_id,
            new_asset_id=new_asset_id,
            message=f"替换成功！新视频时长: {duration_seconds:.1f}秒"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ApplyResult] 应用替换结果失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))