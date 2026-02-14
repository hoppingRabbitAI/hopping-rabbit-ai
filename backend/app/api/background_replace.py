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
    
    # [新增] 智能分片相关参数
    duration_ms: Optional[int] = Field(None, description="视频时长（毫秒），用于智能分片判断")
    transcript: Optional[str] = Field(None, description="转写文本（用于分句策略分片）")
    
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
    
    ★★★ 异步工作流 ★★★
    1. 立即创建任务并返回任务 ID
    2. 在后台执行实际替换
    3. 前端通过 SSE 或轮询获取进度
    """
    try:
        service = get_video_element_replace_service()
        
        # 根据 force_strategy 或 edited_frame_url 决定策略
        use_person_replace = (
            request.force_strategy == "person_major_edit" or
            request.force_strategy == "person_minor_edit"
        )
        
        if use_person_replace and request.edited_frame_url:
            # 策略B：人物替换（暂时保持同步，后续优化）
            replace_task = await service.replace_person(
                clip_id=request.clip_id,
                video_url=request.video_url,
                new_person_url=request.edited_frame_url,
                original_audio_url=request.original_audio_url,
                prompt=request.prompt,
                user_id=user_id,
                project_id=request.project_id,
            )
        else:
            # ★★★ 策略A：背景替换 ★★★
            duration_ms = request.duration_ms
            transcript = request.transcript
            
            if not duration_ms or duration_ms <= 0:
                raise HTTPException(status_code=400, detail="缺少必要参数: duration_ms")
            
            # ★★★ 检查时长是否符合 Kling 要求 ★★★
            from app.services.smart_clip_splitter import SmartClipSplitter, is_valid_duration
            from app.services.supabase_client import supabase
            from uuid import uuid4 as _uuid4
            from datetime import datetime as _dt
            
            duration_seconds = duration_ms / 1000
            all_tasks = []
            
            if not is_valid_duration(duration_seconds):
                # ★★★ 时长不符合，自动分片并为每个分片创建任务 ★★★
                logger.info(f"[WorkflowAPI] Clip {request.clip_id} 时长 {duration_seconds:.1f}s 不在有效区间，启动智能分片")
                
                splitter = SmartClipSplitter()
                split_plan = await splitter.analyze_and_plan(
                    clip_id=request.clip_id,
                    duration_ms=duration_ms,
                    transcript=transcript,
                )
                
                if split_plan.needs_split and len(split_plan.segments) > 1:
                    # 执行分片：在 canvas_nodes 创建新节点
                    orig_node = None
                    try:
                        orig_res = supabase.table("canvas_nodes").select("*").eq("id", request.clip_id).single().execute()
                        orig_node = orig_res.data
                    except Exception:
                        pass
                    
                    new_clips = []
                    if orig_node:
                        now = _dt.utcnow().isoformat()
                        orig_pos = orig_node.get("canvas_position") or {"x": 200, "y": 200}
                        new_nodes = []
                        for i, seg in enumerate(split_plan.segments):
                            node_id = str(_uuid4())
                            new_nodes.append({
                                "id": node_id,
                                "project_id": orig_node.get("project_id"),
                                "asset_id": orig_node.get("asset_id"),
                                "node_type": orig_node.get("node_type", "sequence"),
                                "media_type": "video",
                                "order_index": i,
                                "start_time": seg.start_ms / 1000,
                                "end_time": seg.end_ms / 1000,
                                "duration": (seg.end_ms - seg.start_ms) / 1000,
                                "source_start": seg.start_ms,
                                "source_end": seg.end_ms,
                                "video_url": orig_node.get("video_url"),
                                "thumbnail_url": orig_node.get("thumbnail_url"),
                                "canvas_position": {
                                    "x": orig_pos.get("x", 200) + i * 340,
                                    "y": orig_pos.get("y", 200),
                                },
                                "metadata": {"split_from": request.clip_id, "split_index": i},
                                "created_at": now,
                                "updated_at": now,
                            })
                        supabase.table("canvas_nodes").insert(new_nodes).execute()
                        supabase.table("canvas_nodes").delete().eq("id", request.clip_id).execute()
                        new_clips = new_nodes
                    
                    logger.info(f"[WorkflowAPI] 智能分片完成: {len(new_clips)} 个新节点")
                    
                    # 为每个新 clip 创建任务
                    for new_clip in new_clips:
                        new_clip_id = new_clip["id"]
                        new_duration_ms = int(new_clip.get("duration", 0) * 1000)
                        
                        task = await service.create_background_replace_task(
                            clip_id=new_clip_id,
                            video_url=request.video_url,
                            new_background_url=request.background_image_url,
                            prompt=request.prompt,
                            user_id=user_id,
                            project_id=request.project_id,
                        )
                        all_tasks.append(task)
                else:
                    # 无法分片，但时长又不符合，创建单个任务尝试处理
                    logger.warning(f"[WorkflowAPI] Clip {request.clip_id} 无法分片，尝试直接处理")
                    task = await service.create_background_replace_task(
                        clip_id=request.clip_id,
                        video_url=request.video_url,
                        new_background_url=request.background_image_url,
                        prompt=request.prompt,
                        user_id=user_id,
                        project_id=request.project_id,
                    )
                    all_tasks.append(task)
            else:
                # 时长符合要求，创建单个任务
                task = await service.create_background_replace_task(
                    clip_id=request.clip_id,
                    video_url=request.video_url,
                    new_background_url=request.background_image_url,
                    prompt=request.prompt,
                    user_id=user_id,
                    project_id=request.project_id,
                )
                all_tasks.append(task)
            
            # 在后台执行所有任务
            async def execute_in_background(task_id: str):
                try:
                    await service.execute_background_replace(task_id)
                except Exception as e:
                    logger.error(f"[WorkflowAPI] 后台执行任务失败: {task_id}, error: {e}")
            
            for task in all_tasks:
                asyncio.create_task(execute_in_background(task.id))
            
            logger.info(f"[WorkflowAPI] 创建 {len(all_tasks)} 个任务")
            
            # 返回第一个任务的信息
            replace_task = all_tasks[0]
        
        logger.info(f"[WorkflowAPI] 创建工作流成功: {replace_task.id}, 策略: {replace_task.strategy.value}")
        
        # 转换为兼容的响应格式（此时状态为 pending）
        return WorkflowResponse(
            id=replace_task.id,
            clip_id=replace_task.clip_id,
            session_id=request.session_id,
            status=replace_task.status.value,
            current_stage=replace_task.status.value,
            stage_progress=replace_task.progress,
            overall_progress=replace_task.progress,
            error=replace_task.error,
            result_url=replace_task.result_video_url,
            created_at=replace_task.created_at,
            updated_at=replace_task.updated_at,
            detected_strategy=replace_task.strategy.value,
            strategy_confidence=1.0,
            strategy_recommendation=f"使用 {replace_task.strategy.value} 策略",
            qa_passed=False,  # 刚创建，还没有 QA
            qa_score=None,
        )
        
    except Exception as e:
        import traceback
        logger.error(f"[WorkflowAPI] 创建工作流失败: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e) if str(e) else repr(e))


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


@router.get("/workflows/{workflow_id}")
async def get_workflow_status(workflow_id: str):
    """
    获取工作流状态（用于轮询）
    
    先从新服务 (VideoElementReplaceService) 查找，
    找不到再从旧服务 (BackgroundReplaceWorkflow) 查找。
    """
    # ★ 优先从新服务获取任务状态
    service = get_video_element_replace_service()
    task = service.get_task(workflow_id)
    
    if task:
        return {
            "id": task.id,
            "clip_id": task.clip_id,
            "status": task.status.value,
            "progress": task.progress,
            "error": task.error,
            "result_url": task.result_video_url,
            "strategy": task.strategy.value,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        }
    
    # ★ 回退到旧服务
    workflow = get_background_replace_workflow()
    old_task = await workflow.get_task(workflow_id)
    
    if old_task:
        return WorkflowResponse.from_task(old_task).model_dump()
    
    raise HTTPException(status_code=404, detail="工作流不存在")

