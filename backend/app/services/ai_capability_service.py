"""
AI 能力服务
为视频工作流提供各种 AI 处理能力

支持的能力:
1. background-replace: 换背景 (使用 text2video 生成背景 + 合成)
2. add-broll: 插入 B-Roll (使用 text2video 生成素材)
3. add-subtitle: 添加字幕 (使用 ASR + 样式渲染)
4. style-transfer: 风格迁移 (使用 image2video)
5. voice-enhance: 声音优化 (使用音频处理)
"""

import os
import uuid
import asyncio
import logging
import json
from typing import Optional, Dict, Any, List, Callable, Set
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, asdict
from asyncio import Queue

from .kling_ai_service import KlingAIClient
from .supabase_client import get_supabase

logger = logging.getLogger(__name__)


class CapabilityType(str, Enum):
    """AI 能力类型"""
    BACKGROUND_REPLACE = "background-replace"
    ADD_BROLL = "add-broll"
    ADD_SUBTITLE = "add-subtitle"
    STYLE_TRANSFER = "style-transfer"
    VOICE_ENHANCE = "voice-enhance"


class TaskStatus(str, Enum):
    """任务状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TaskEvent:
    """任务事件"""
    task_id: str
    session_id: str
    event_type: str  # created, progress, completed, failed
    status: str
    progress: int = 0  # 0-100
    message: Optional[str] = None
    result_url: Optional[str] = None
    error: Optional[str] = None
    timestamp: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class CapabilityTask:
    """能力任务"""
    id: str
    capability_type: CapabilityType
    clip_id: str
    session_id: str
    status: TaskStatus
    progress: int = 0  # 0-100
    prompt: Optional[str] = None
    mask_url: Optional[str] = None
    keyframe_url: Optional[str] = None
    result_url: Optional[str] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None


class AICapabilityService:
    """AI 能力服务"""
    
    def __init__(self):
        self.kling_client = KlingAIClient()
        self._tasks: Dict[str, CapabilityTask] = {}  # 内存任务存储
        self._subscribers: Dict[str, Set[Queue]] = {}  # session_id -> queues
    
    # ==========================================
    # SSE 订阅管理
    # ==========================================
    
    async def subscribe(self, session_id: str) -> Queue:
        """订阅会话的任务事件"""
        if session_id not in self._subscribers:
            self._subscribers[session_id] = set()
        
        queue: Queue = Queue()
        self._subscribers[session_id].add(queue)
        logger.info(f"[SSE] 新订阅: session={session_id}, 当前订阅数={len(self._subscribers[session_id])}")
        return queue
    
    async def unsubscribe(self, session_id: str, queue: Queue):
        """取消订阅"""
        if session_id in self._subscribers:
            self._subscribers[session_id].discard(queue)
            if not self._subscribers[session_id]:
                del self._subscribers[session_id]
            logger.info(f"[SSE] 取消订阅: session={session_id}")
    
    async def _publish_event(self, event: TaskEvent):
        """发布事件到订阅者"""
        session_id = event.session_id
        if session_id not in self._subscribers:
            return
        
        for queue in self._subscribers[session_id]:
            try:
                await queue.put(event)
            except Exception as e:
                logger.warning(f"[SSE] 发布事件失败: {e}")
    
    async def _emit_progress(self, task: CapabilityTask, progress: int, message: str):
        """发送进度更新"""
        task.progress = progress
        task.updated_at = datetime.utcnow()
        
        event = TaskEvent(
            task_id=task.id,
            session_id=task.session_id,
            event_type="progress",
            status=task.status.value,
            progress=progress,
            message=message,
            timestamp=datetime.utcnow().isoformat()
        )
        await self._publish_event(event)
    
    async def create_task(
        self,
        capability_type: str,
        clip_id: str,
        session_id: str,
        prompt: str,
        keyframe_url: Optional[str] = None,
        mask_data_url: Optional[str] = None,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        **kwargs
    ) -> CapabilityTask:
        """
        创建 AI 能力任务
        
        ★★★ 治本方案：任务持久化到 tasks 表 ★★★
        
        Args:
            capability_type: 能力类型
            clip_id: 片段 ID
            session_id: 会话 ID
            prompt: 用户提示词
            keyframe_url: 关键帧 URL
            mask_data_url: Mask 数据 URL (base64)
            user_id: 用户 ID（用于持久化）
            project_id: 项目 ID（用于持久化）
            
        Returns:
            CapabilityTask: 创建的任务
        """
        from .supabase_client import supabase
        
        task_id = str(uuid.uuid4())
        
        # 如果有 mask，上传到存储
        mask_url = None
        if mask_data_url:
            mask_url = await self._upload_mask(task_id, mask_data_url)
        
        task = CapabilityTask(
            id=task_id,
            capability_type=CapabilityType(capability_type),
            clip_id=clip_id,
            session_id=session_id,
            status=TaskStatus.PENDING,
            prompt=prompt,
            mask_url=mask_url,
            keyframe_url=keyframe_url,
            created_at=datetime.utcnow(),
            metadata=kwargs
        )
        
        self._tasks[task_id] = task
        
        # ★★★ 持久化到 tasks 表 ★★★
        if user_id:
            try:
                now = datetime.utcnow().isoformat()
                task_data = {
                    "id": task_id,
                    "user_id": user_id,
                    "task_type": self._map_capability_to_task_type(capability_type),
                    "status": "pending",
                    "progress": 0,
                    "input_params": {
                        "clip_id": clip_id,
                        "prompt": prompt,
                        "keyframe_url": keyframe_url,
                        "mask_url": mask_url,
                        "session_id": session_id,
                    },
                    "created_at": now,
                    "updated_at": now,
                }
                if project_id:
                    task_data["project_id"] = project_id
                
                supabase.table("tasks").insert(task_data).execute()
                logger.info(f"[AICapability] 任务已持久化到数据库: {task_id}")
            except Exception as e:
                logger.warning(f"[AICapability] 任务持久化失败（不影响执行）: {e}")
        
        # 异步启动处理
        asyncio.create_task(self._process_task(task))
        
        logger.info(f"[AICapability] 创建任务: {task_id}, 类型: {capability_type}")
        return task
    
    def _map_capability_to_task_type(self, capability_type: str) -> str:
        """将 capability_type 映射到 tasks 表的 task_type"""
        mapping = {
            "background_replace": "background_replace",
            "person_replace": "background_replace",  # 人物替换也归类为 background_replace
            "lip_sync": "lip_sync",
            "face_swap": "face_swap",
            "image_generation": "image_generation",
        }
        return mapping.get(capability_type, "image_generation")
    
    async def get_task(self, task_id: str) -> Optional[CapabilityTask]:
        """获取任务状态"""
        return self._tasks.get(task_id)
    
    async def list_tasks(self, session_id: str) -> List[CapabilityTask]:
        """列出会话的所有任务"""
        return [t for t in self._tasks.values() if t.session_id == session_id]
    
    async def create_preview_task(
        self,
        capability_type: str,
        clip_id: str,
        session_id: str,
        prompt: str,
        keyframe_url: Optional[str] = None,
        mask_data_url: Optional[str] = None,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        **kwargs
    ) -> CapabilityTask:
        """
        创建预览任务（两步工作流的第一步）
        
        ★★★ 治本方案：任务持久化到 tasks 表 ★★★
        
        与 create_task 类似，但结果不会自动应用到 clip，
        需要用户确认后调用 apply_preview 才会应用。
        
        Args:
            capability_type: 能力类型
            clip_id: 片段 ID
            session_id: 会话 ID
            prompt: 用户提示词
            keyframe_url: 关键帧 URL
            mask_data_url: Mask 数据 URL (base64)
            user_id: 用户 ID（用于持久化）
            project_id: 项目 ID（用于持久化）
            
        Returns:
            CapabilityTask: 创建的任务（带 preview 标记）
        """
        from .supabase_client import supabase
        
        task_id = str(uuid.uuid4())
        
        # 如果有 mask，上传到存储
        mask_url = None
        if mask_data_url:
            mask_url = await self._upload_mask(task_id, mask_data_url)
        
        # 添加 preview 标记到 metadata
        metadata = kwargs.get("metadata", {}) or {}
        metadata["is_preview"] = True
        metadata["applied"] = False
        
        task = CapabilityTask(
            id=task_id,
            capability_type=CapabilityType(capability_type),
            clip_id=clip_id,
            session_id=session_id,
            status=TaskStatus.PENDING,
            prompt=prompt,
            mask_url=mask_url,
            keyframe_url=keyframe_url,
            created_at=datetime.utcnow(),
            metadata=metadata
        )
        
        self._tasks[task_id] = task
        
        # ★★★ 持久化到 tasks 表 ★★★
        if user_id:
            try:
                now = datetime.utcnow().isoformat()
                task_data = {
                    "id": task_id,
                    "user_id": user_id,
                    "task_type": self._map_capability_to_task_type(capability_type),
                    "status": "pending",
                    "progress": 0,
                    "input_params": {
                        "clip_id": clip_id,
                        "prompt": prompt,
                        "keyframe_url": keyframe_url,
                        "mask_url": mask_url,
                        "session_id": session_id,
                        "is_preview": True,
                    },
                    "created_at": now,
                    "updated_at": now,
                }
                if project_id:
                    task_data["project_id"] = project_id
                
                supabase.table("tasks").insert(task_data).execute()
                logger.info(f"[AICapability] 预览任务已持久化到数据库: {task_id}")
            except Exception as e:
                logger.warning(f"[AICapability] 预览任务持久化失败（不影响执行）: {e}")
        
        # 异步启动处理
        asyncio.create_task(self._process_task(task))
        
        logger.info(f"[AICapability] 创建预览任务: {task_id}, 类型: {capability_type}")
        return task
    
    async def apply_preview(self, task_id: str) -> Optional[CapabilityTask]:
        """
        应用预览结果到 clip（两步工作流的第二步）
        
        将预览生成的图片/视频应用到对应的 clip。
        
        Args:
            task_id: 任务 ID
            
        Returns:
            更新后的任务，如果任务不存在或状态不正确则返回 None
        """
        task = self._tasks.get(task_id)
        if not task:
            logger.warning(f"[AICapability] 任务不存在: {task_id}")
            return None
        
        # 验证任务状态
        if task.status != TaskStatus.COMPLETED:
            logger.warning(f"[AICapability] 任务未完成，无法应用: {task_id}, status={task.status}")
            return None
        
        if not task.result_url:
            logger.warning(f"[AICapability] 任务没有结果，无法应用: {task_id}")
            return None
        
        # 检查是否已经应用过
        if task.metadata and task.metadata.get("applied"):
            logger.info(f"[AICapability] 任务已经应用过: {task_id}")
            return task
        
        try:
            # 在这里调用实际的应用逻辑
            # 例如：更新数据库中 clip 的关键帧或视频资源
            await self._apply_result_to_clip(task)
            
            # 更新任务元数据
            if task.metadata is None:
                task.metadata = {}
            task.metadata["applied"] = True
            task.metadata["applied_at"] = datetime.utcnow().isoformat()
            task.updated_at = datetime.utcnow()
            
            logger.info(f"[AICapability] 预览已应用: {task_id} -> clip={task.clip_id}")
            
            # 发送应用成功事件
            event = TaskEvent(
                task_id=task.id,
                session_id=task.session_id,
                event_type="applied",
                status="applied",
                progress=100,
                message="预览已应用到片段",
                result_url=task.result_url,
                timestamp=datetime.utcnow().isoformat()
            )
            await self._publish_event(event)
            
            return task
            
        except Exception as e:
            logger.error(f"[AICapability] 应用预览失败: {task_id}, 错误: {e}")
            return None
    
    async def _apply_result_to_clip(self, task: CapabilityTask):
        """
        将任务结果应用到 clip
        
        ★★★ 核心流程 ★★★
        对于 background-replace 类型:
        1. 启动完整的 Agent Workflow
        2. 工作流包含 5 个阶段：分析 → 分离 → 生成 → 合成 → 增强
        3. 生成最终视频后，更新 clip 的 asset_id 和 cached_url
        """
        logger.info(f"[AICapability] 应用结果到 clip: task={task.id}, clip={task.clip_id}")
        
        if task.capability_type == CapabilityType.BACKGROUND_REPLACE:
            # 启动背景替换 Agent Workflow
            await self._apply_background_replace(task)
        else:
            # 其他类型：更新缩略图/预览图
            await self._apply_simple_result(task)
    
    async def _apply_background_replace(self, task: CapabilityTask):
        """
        应用背景替换 - Replace Clip
        
        使用 Kling 多模态视频编辑 API 直接在视频上替换元素：
        - 保持原视频的：音频、动作、运镜、节奏
        - 只替换画面中的背景
        
        ★★★ Replace Clip 核心流程 ★★★
        1. 调用 Kling API 生成新视频
        2. 创建新的 asset 记录
        3. 创建新的 clip（基于新 asset，保留原 clip 位置信息）
        4. 原 clip 保持不变，用户可对比选择
        """
        from .video_element_replace_service import get_video_element_replace_service
        from .supabase_client import supabase
        import uuid as uuid_module
        import subprocess
        import tempfile
        import os
        import httpx
        
        logger.info(f"[AICapability] ★ 启动 Replace Clip: clip={task.clip_id}")
        
        try:
            # 获取原 clip 信息
            clip_result = supabase.table("clips").select("*").eq("id", task.clip_id).single().execute()
            if not clip_result.data:
                raise ValueError(f"Clip 不存在: {task.clip_id}")
            
            clip_data = clip_result.data
            original_asset_id = clip_data.get("asset_id")
            track_id = clip_data.get("track_id")
            
            # 从 track 获取 project_id
            track_result = supabase.table("tracks").select("project_id").eq("id", track_id).single().execute()
            project_id = track_result.data.get("project_id") if track_result.data else None
            
            # 获取原视频 URL
            video_url = await self._get_clip_video_url(task.clip_id)
            if not video_url:
                raise ValueError(f"无法获取 clip {task.clip_id} 的视频 URL")
            
            # 背景图就是预览生成的 result_url
            background_image_url = task.result_url
            if not background_image_url:
                raise ValueError("没有可用的背景预览图")
            
            # 使用视频元素替换服务
            service = get_video_element_replace_service()
            
            # 进度回调
            async def on_progress(progress: int, message: str):
                await self._emit_progress(task, progress, message)
            
            # 从 session_id 提取 user_id
            user_id = task.session_id.split("_")[0] if "_" in task.session_id else None
            
            # 执行背景替换（同步等待完成）
            replace_task = await service.replace_background(
                clip_id=task.clip_id,
                video_url=video_url,
                new_background_url=background_image_url,
                prompt=task.prompt,
                progress_callback=on_progress,
                user_id=user_id,
                project_id=project_id,
            )
            
            # 检查是否成功
            if not replace_task.result_video_url:
                raise ValueError("背景替换失败：没有生成结果视频")
            
            # ★★★ Replace Clip 核心步骤 ★★★
            result_url = replace_task.result_video_url
            
            # Step 1: 获取新视频时长
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.get(result_url, follow_redirects=True)
                response.raise_for_status()
                
                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
                    f.write(response.content)
                    video_path = f.name
            
            try:
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
            
            logger.info(f"[AICapability] 新视频时长: {duration_seconds}s")
            
            # Step 2: 创建新的 asset 记录
            new_asset_id = str(uuid_module.uuid4())
            new_asset = {
                "id": new_asset_id,
                "project_id": project_id,
                "user_id": user_id or clip_data.get("user_id"),
                "name": f"AI替换_{datetime.utcnow().strftime('%H%M%S')}",
                "file_type": "video",
                "storage_path": result_url,
                "duration": duration_ms,
                "status": "ready",
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
            }
            
            supabase.table("assets").insert(new_asset).execute()
            logger.info(f"[AICapability] 创建新 asset: {new_asset_id}")
            
            # Step 3: 创建新的 clip（基于新 asset）
            # ★ 这是新的 clip 维度数据，保留原 clip 的时间轴位置
            new_clip_id = str(uuid_module.uuid4())
            new_clip = {
                "id": new_clip_id,
                "track_id": track_id,
                "asset_id": new_asset_id,
                "clip_type": clip_data.get("clip_type", "video"),
                # 时间信息：与原 clip 相同的时间轴位置
                "start_time": clip_data.get("start_time"),
                "end_time": clip_data.get("end_time"),
                # 源信息：新 asset 从头开始
                "source_start": 0,
                "source_end": duration_ms,
                # 音频属性
                "volume": clip_data.get("volume", 1.0),
                "is_muted": clip_data.get("is_muted", False),
                # 视觉变换（继承原 clip）
                "transform": clip_data.get("transform"),
                "speed": clip_data.get("speed", 1.0),
                # 缓存 URL
                "cached_url": result_url,
                # 元数据：标记为 AI 生成
                "name": f"AI替换_{clip_data.get('name', 'Clip')}",
                "metadata": {
                    "ai_generated": True,
                    "source_clip_id": task.clip_id,
                    "source_asset_id": original_asset_id,
                    "replace_type": "background",
                    "replace_task_id": replace_task.id,
                },
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
            }
            
            supabase.table("clips").insert(new_clip).execute()
            logger.info(f"[AICapability] ★ 创建新 Clip: {new_clip_id} (基于 asset: {new_asset_id})")
            
            # 更新任务结果
            task.result_url = result_url
            
            if task.metadata is None:
                task.metadata = {}
            task.metadata["replace_task_id"] = replace_task.id
            task.metadata["strategy"] = replace_task.strategy.value
            task.metadata["new_asset_id"] = new_asset_id
            task.metadata["new_clip_id"] = new_clip_id  # ★ 新 clip ID
            task.metadata["original_clip_id"] = task.clip_id
            task.metadata["original_asset_id"] = original_asset_id
            
            logger.info(f"[AICapability] ★ Replace Clip 完成: 新clip={new_clip_id}, 新asset={new_asset_id}")
            
        except Exception as e:
            logger.error(f"[AICapability] Replace Clip 失败: {e}")
            raise
    
    async def _apply_simple_result(self, task: CapabilityTask):
        """
        简单应用 - 仅更新缩略图或静态资源
        用于不需要完整视频处理的场景
        """
        logger.info(f"[AICapability] 简单应用结果: task={task.id}")
        # 可以在这里更新 clip 的 thumbnail 等字段
        pass
    
    async def _get_clip_video_url(self, clip_id: str) -> Optional[str]:
        """获取 clip 的视频 URL"""
        try:
            from .supabase_client import get_supabase
            
            supabase = get_supabase()
            result = supabase.table("clips").select("*").eq("id", clip_id).single().execute()
            
            if result.data:
                # 优先使用 cached_url，否则通过 asset_id 获取
                if result.data.get("cached_url"):
                    return result.data["cached_url"]
                
                asset_id = result.data.get("asset_id")
                if asset_id:
                    # 获取 asset 的 URL
                    asset_result = supabase.table("assets").select("url, cloudflare_uid").eq("id", asset_id).single().execute()
                    if asset_result.data:
                        return asset_result.data.get("url")
            
            return None
            
        except Exception as e:
            logger.warning(f"[AICapability] 获取 clip 视频 URL 失败: {e}")
            return None
    
    async def _emit_workflow_progress(self, task: CapabilityTask, event: dict):
        """转发工作流进度事件"""
        workflow_event = TaskEvent(
            task_id=task.id,
            session_id=task.session_id,
            event_type="workflow_progress",
            status=event.get("event_type", "progress"),
            progress=event.get("data", {}).get("overall_progress", 0),
            message=event.get("data", {}).get("message", "处理中..."),
            result_url=event.get("data", {}).get("result_url"),
            timestamp=datetime.utcnow().isoformat()
        )
        await self._publish_event(workflow_event)
    
    async def _update_task_in_db(self, task_id: str, **updates):
        """更新数据库中的任务状态"""
        from .supabase_client import supabase
        try:
            updates["updated_at"] = datetime.utcnow().isoformat()
            supabase.table("tasks").update(updates).eq("id", task_id).execute()
        except Exception as e:
            logger.warning(f"[AICapability] 数据库状态更新失败（不影响执行）: {e}")
    
    async def _process_task(self, task: CapabilityTask):
        """处理任务（后台执行）"""
        try:
            task.status = TaskStatus.PROCESSING
            task.updated_at = datetime.utcnow()
            
            # ★ 同步到数据库
            await self._update_task_in_db(task.id, status="processing", progress=0)
            
            # 发送开始事件
            await self._emit_progress(task, 0, "任务开始处理...")
            
            logger.info(f"[AICapability] 开始处理任务: {task.id}, 类型: {task.capability_type}")
            
            # 根据能力类型分发处理
            if task.capability_type == CapabilityType.BACKGROUND_REPLACE:
                result = await self._process_background_replace(task)
            elif task.capability_type == CapabilityType.ADD_BROLL:
                result = await self._process_add_broll(task)
            elif task.capability_type == CapabilityType.ADD_SUBTITLE:
                result = await self._process_add_subtitle(task)
            elif task.capability_type == CapabilityType.STYLE_TRANSFER:
                result = await self._process_style_transfer(task)
            elif task.capability_type == CapabilityType.VOICE_ENHANCE:
                result = await self._process_voice_enhance(task)
            else:
                raise ValueError(f"未知的能力类型: {task.capability_type}")
            
            task.result_url = result.get("url")
            task.status = TaskStatus.COMPLETED
            task.progress = 100
            task.updated_at = datetime.utcnow()
            
            # ★ 同步完成状态到数据库
            await self._update_task_in_db(
                task.id, 
                status="completed", 
                progress=100,
                output_url=task.result_url
            )
            
            # 发送完成事件
            event = TaskEvent(
                task_id=task.id,
                session_id=task.session_id,
                event_type="completed",
                status="completed",
                progress=100,
                message="任务完成！",
                result_url=task.result_url,
                timestamp=datetime.utcnow().isoformat()
            )
            await self._publish_event(event)
            
            logger.info(f"[AICapability] 任务完成: {task.id}")
            
        except Exception as e:
            logger.error(f"[AICapability] 任务失败: {task.id}, 错误: {e}")
            task.status = TaskStatus.FAILED
            task.error = str(e)
            task.updated_at = datetime.utcnow()
            
            # ★ 同步失败状态到数据库
            await self._update_task_in_db(
                task.id,
                status="failed",
                error_message=str(e)
            )
            
            # 发送失败事件
            event = TaskEvent(
                task_id=task.id,
                session_id=task.session_id,
                event_type="failed",
                status="failed",
                progress=task.progress,
                error=str(e),
                timestamp=datetime.utcnow().isoformat()
            )
            await self._publish_event(event)
    
    def _calculate_aspect_ratio_string(self, width: int, height: int) -> str:
        """
        计算最接近的标准宽高比字符串（用于 Kling API）
        
        Kling 支持的宽高比: 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3, 21:9
        
        Args:
            width: 图片宽度
            height: 图片高度
            
        Returns:
            最接近的标准宽高比字符串
        """
        if height == 0:
            return "16:9"
            
        ratio = width / height
        
        aspect_ratios = {
            "21:9": 21/9,    # 2.33
            "16:9": 16/9,    # 1.78
            "3:2": 3/2,      # 1.5
            "4:3": 4/3,      # 1.33
            "1:1": 1/1,      # 1.0
            "3:4": 3/4,      # 0.75
            "2:3": 2/3,      # 0.67
            "9:16": 9/16,    # 0.56
        }
        
        # 找最接近的
        closest = min(aspect_ratios.keys(), 
                      key=lambda k: abs(aspect_ratios[k] - ratio))
        return closest
    
    def _get_intent_display_name(self, intent) -> str:
        """获取意图的显示名称（中文）"""
        from app.services.edit_intent_classifier import EditIntent
        
        display_names = {
            EditIntent.ADD_ELEMENT: "添加元素",
            EditIntent.LOCAL_EDIT: "局部修改",
            EditIntent.FULL_REPLACE: "换背景",
        }
        return display_names.get(intent, "图像编辑")
    
    async def _build_edit_prompt_by_intent(
        self,
        task,
        intent_result,
        keyframe_image,
        image_list: list,
    ) -> Dict[str, Any]:
        """
        ★★★ 核心方法：根据意图构建不同的 Prompt ★★★
        
        这是治本的关键：
        - add_element: "在图中添加 X，保持其他一切不变"
        - local_edit: "在 mask 区域内编辑，其他不变"
        - full_replace: "替换整个背景"
        
        Args:
            task: 任务对象
            intent_result: 意图分类结果
            keyframe_image: 关键帧图片 (PIL.Image)
            image_list: 图片列表（会被修改，添加 mask）
            
        Returns:
            {
                "prompt": str,               # 最终的 prompt
                "has_mask": bool,            # 是否有 mask
                "processed_mask_image": Optional[Image],  # 处理后的 mask（用于合成）
                "original_keyframe_image": Optional[Image],  # 原图（用于合成）
            }
        """
        from app.services.edit_intent_classifier import EditIntent
        from app.utils.image_utils import (
            prepare_kling_image_input,
            data_url_to_pil_image,
            process_drawing_mask,
        )
        from PIL import Image
        import httpx
        import io
        
        mask_data_url = getattr(task, 'mask_data_url', None) or task.mask_url
        has_mask = bool(mask_data_url)
        processed_mask_image = None
        original_keyframe_for_composite = keyframe_image.copy()
        
        intent = intent_result.intent
        user_prompt = task.prompt
        
        logger.info(f"[BuildPrompt] 意图={intent.value}, has_mask={has_mask}, prompt='{user_prompt}'")
        
        # ==========================================
        # 1. ADD_ELEMENT 意图：添加元素
        # ==========================================
        if intent == EditIntent.ADD_ELEMENT:
            # 用户想添加某个元素（太阳、云、光效等）
            # 关键：只在指定位置添加，不改变其他任何东西
            
            if has_mask:
                # 有 mask：在 mask 区域添加元素
                try:
                    mask_image = await self._load_mask_image(mask_data_url, keyframe_image.size)
                    
                    # ★ 治本方案：前端已使用白色画笔，直接转灰度即可 ★
                    # AI 标准：白色 = 编辑区域
                    processed_mask_image = self._convert_to_grayscale_mask(mask_image)
                    
                    # ★★★ DEBUG: 分析 mask 内容（仅日志）★★★
                    try:
                        import numpy as np
                        mask_array = np.array(processed_mask_image)
                        white_pixels = np.sum(mask_array > 127)
                        total_pixels = mask_array.size
                        white_ratio = white_pixels / total_pixels * 100
                        
                        # 找出白色区域的边界框
                        white_coords = np.argwhere(mask_array > 127)
                        if len(white_coords) > 0:
                            y_min, x_min = white_coords.min(axis=0)
                            y_max, x_max = white_coords.max(axis=0)
                            logger.info(f"[DEBUG MASK] 白色区域边界: x=[{x_min}, {x_max}], y=[{y_min}, {y_max}], "
                                       f"占比={white_ratio:.2f}%, 图片尺寸={processed_mask_image.size}")
                        else:
                            logger.warning(f"[DEBUG MASK] ⚠️ 未检测到白色区域！")
                    except Exception as debug_err:
                        logger.warning(f"[DEBUG MASK] 调试信息生成失败: {debug_err}")
                    
                    # ★★★ 发送给 API 的是处理后的 mask（白色=用户画的区域）★★★
                    mask_base64 = prepare_kling_image_input(processed_mask_image)
                    image_list.append({"image": mask_base64})
                    
                    logger.info(f"[BuildPrompt] ADD_ELEMENT: mask 已转换，白色区域=用户标记区域, size={processed_mask_image.size}")
                    
                    # ★★★ 计算 mask 区域的位置描述（用于 prompt）★★★
                    position_description = ""
                    try:
                        import numpy as np
                        mask_array = np.array(processed_mask_image)
                        white_coords = np.argwhere(mask_array > 127)
                        if len(white_coords) > 0:
                            y_min, x_min = white_coords.min(axis=0)
                            y_max, x_max = white_coords.max(axis=0)
                            img_h, img_w = mask_array.shape
                            
                            # 判断位置区域
                            x_center = (x_min + x_max) / 2 / img_w
                            y_center = (y_min + y_max) / 2 / img_h
                            
                            h_pos = "left" if x_center < 0.33 else "right" if x_center > 0.67 else "center"
                            v_pos = "top" if y_center < 0.33 else "bottom" if y_center > 0.67 else "middle"
                            position_description = f"The white area is located at the {v_pos}-{h_pos} of the image. "
                            logger.info(f"[BuildPrompt] Mask 位置: {v_pos}-{h_pos}")
                    except Exception as pos_err:
                        logger.warning(f"[BuildPrompt] 位置计算失败: {pos_err}")
                    
                    # Prompt：在 mask 白色区域添加元素（强调真实感和严格位置）
                    prompt = (
                        f"INPAINTING TASK for <<<image_1>>> using mask <<<image_2>>>. "
                        f"{position_description}"
                        f"STRICT INPAINTING RULES: "
                        f"1. Add ONLY: {user_prompt} "
                        f"2. The element MUST be placed EXACTLY in the WHITE regions of the mask. "
                        f"3. ALL BLACK regions MUST remain PIXEL-PERFECT IDENTICAL to the original - including all people, objects, and background. "
                        f"4. DO NOT modify, regenerate, or alter ANY content in the black regions. "
                        f"5. The output image MUST have the EXACT same composition, perspective, and layout as the input. "
                        f"6. Make the added element look PHOTOREALISTIC - natural lighting, shadows, and seamless blending. "
                        f"7. If a person exists in the original image, they MUST remain EXACTLY the same - same pose, clothing, face, position."
                    )
                except Exception as e:
                    logger.warning(f"[BuildPrompt] Mask 加载失败，使用无 mask 添加模式: {e}")
                    has_mask = False
                    has_mask = False
            
            if not has_mask:
                # 无 mask：智能添加（AI 自己判断合适位置）
                prompt = (
                    f"Add to <<<image_1>>>: {user_prompt}. "
                    f"CRITICAL REQUIREMENTS: "
                    f"1. Keep all existing content EXACTLY unchanged - people, background, everything. "
                    f"2. Place the new element in a visually logical position. "
                    f"3. The result MUST look like a REAL PHOTOGRAPH - completely photorealistic, not AI-generated. "
                    f"4. Match lighting, shadows, color grading, and image quality perfectly. "
                    f"5. No visible artifacts, seams, or inconsistencies."
                )
            
            logger.info(f"[BuildPrompt] ADD_ELEMENT prompt 构建完成")
            
        # ==========================================
        # 2. LOCAL_EDIT 意图：局部修改
        # ==========================================
        elif intent == EditIntent.LOCAL_EDIT:
            if has_mask:
                try:
                    mask_image = await self._load_mask_image(mask_data_url, keyframe_image.size)
                    
                    # ★ 治本方案：前端已使用白色画笔，直接转灰度即可 ★
                    processed_mask_image = self._convert_to_grayscale_mask(mask_image)
                    
                    # 发送处理后的 mask（白色=用户画的区域）
                    mask_base64 = prepare_kling_image_input(processed_mask_image)
                    image_list.append({"image": mask_base64})
                    
                    logger.info(f"[BuildPrompt] LOCAL_EDIT: mask 已转换，白色区域=用户标记区域, size={processed_mask_image.size}")
                    
                    # ★★★ 计算 mask 区域的位置描述 ★★★
                    position_description = ""
                    try:
                        import numpy as np
                        mask_array = np.array(processed_mask_image)
                        white_coords = np.argwhere(mask_array > 127)
                        if len(white_coords) > 0:
                            y_min, x_min = white_coords.min(axis=0)
                            y_max, x_max = white_coords.max(axis=0)
                            img_h, img_w = mask_array.shape
                            x_center = (x_min + x_max) / 2 / img_w
                            y_center = (y_min + y_max) / 2 / img_h
                            h_pos = "left" if x_center < 0.33 else "right" if x_center > 0.67 else "center"
                            v_pos = "top" if y_center < 0.33 else "bottom" if y_center > 0.67 else "middle"
                            position_description = f"The edit region is at the {v_pos}-{h_pos}. "
                    except Exception:
                        pass
                    
                    # Prompt：严格的 inpainting 指令
                    prompt = (
                        f"INPAINTING TASK for <<<image_1>>> using mask <<<image_2>>>. "
                        f"{position_description}"
                        f"STRICT INPAINTING RULES: "
                        f"1. Edit ONLY the WHITE regions: {user_prompt} "
                        f"2. ALL BLACK regions MUST remain PIXEL-PERFECT IDENTICAL - including all people, faces, poses, clothing, background. "
                        f"3. DO NOT regenerate or modify ANYTHING outside the white mask area. "
                        f"4. The output MUST have the EXACT same composition and layout as the input. "
                        f"5. Make edits look PHOTOREALISTIC with seamless blending. "
                        f"6. Any person in the original MUST remain EXACTLY unchanged in pose, expression, and appearance."
                    )
                except Exception as e:
                    logger.warning(f"[BuildPrompt] LOCAL_EDIT mask 加载失败: {e}")
                    # 回退到全图编辑
                    has_mask = False
                    prompt = (
                        f"Make a subtle edit to <<<image_1>>>: {user_prompt}. "
                        f"Keep the overall composition, people, and major elements unchanged. "
                        f"Only apply the requested modification."
                    )
            else:
                # 没有 mask 的局部编辑（用户没画区域）
                prompt = (
                    f"Make a subtle edit to <<<image_1>>>: {user_prompt}. "
                    f"CRITICAL: The result must look like a REAL PHOTOGRAPH - completely photorealistic. "
                    f"Keep composition, people, and major elements unchanged. "
                    f"Only apply the requested modification with perfect blending."
                )
            
            logger.info(f"[BuildPrompt] LOCAL_EDIT prompt 构建完成")
            
        # ==========================================
        # 3. FULL_REPLACE 意图：完整换背景
        # ==========================================
        else:  # EditIntent.FULL_REPLACE
            # 用户想换整个背景
            prompt = (
                f"BACKGROUND REPLACEMENT for <<<image_1>>>. "
                f"Replace the background with: {user_prompt}. "
                f"STRICT RULES: "
                f"1. The person/subject MUST remain PIXEL-PERFECT IDENTICAL - same pose, face, expression, clothing, position. "
                f"2. ONLY the background changes - DO NOT modify the subject in ANY way. "
                f"3. New background MUST look PHOTOREALISTIC. "
                f"4. Perfect edge blending with natural lighting and shadows."
            )
            
            # 如果有 mask，可能是用户标记了"这些是背景"
            if has_mask:
                try:
                    mask_image = await self._load_mask_image(mask_data_url, keyframe_image.size)
                    
                    # ★ 治本方案：前端已使用白色画笔，直接转灰度即可 ★
                    processed_mask_image = self._convert_to_grayscale_mask(mask_image)
                    
                    # 发送处理后的 mask（白色=用户画的背景区域）
                    mask_base64 = prepare_kling_image_input(processed_mask_image)
                    image_list.append({"image": mask_base64})
                    
                    logger.info(f"[BuildPrompt] FULL_REPLACE: mask 已转换，白色区域=用户标记的背景区域, size={processed_mask_image.size}")
                    
                    # 有 mask 的换背景 - 严格 inpainting
                    prompt = (
                        f"INPAINTING TASK for <<<image_1>>> using mask <<<image_2>>>. "
                        f"WHITE areas = background to replace with: {user_prompt}. "
                        f"BLACK areas = subjects that MUST remain PIXEL-PERFECT IDENTICAL. "
                        f"STRICT RULES: "
                        f"1. DO NOT modify ANY content in black mask regions - people MUST stay exactly the same. "
                        f"2. Output MUST have EXACT same composition and layout as input. "
                        f"3. New background MUST look PHOTOREALISTIC with seamless blending."
                    )
                except Exception as e:
                    logger.warning(f"[BuildPrompt] FULL_REPLACE mask 加载失败，使用无 mask 模式: {e}")
                    has_mask = False
            
            logger.info(f"[BuildPrompt] FULL_REPLACE prompt 构建完成")
        
        return {
            "prompt": prompt,
            "has_mask": has_mask,
            "processed_mask_image": processed_mask_image,
            "original_keyframe_image": original_keyframe_for_composite,
        }
    
    async def _load_mask_image(self, mask_data_url: str, target_size: tuple):
        """加载 mask 图片"""
        from app.utils.image_utils import data_url_to_pil_image
        from PIL import Image
        import httpx
        import io
        import os
        
        if mask_data_url.startswith('data:'):
            mask_image = data_url_to_pil_image(mask_data_url)
        elif mask_data_url.startswith('http://') or mask_data_url.startswith('https://'):
            # ★ 从远程 URL 加载（Supabase Storage 等）
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(mask_data_url, follow_redirects=True)
                response.raise_for_status()
                mask_image = Image.open(io.BytesIO(response.content))
                logger.info(f"[LoadMask] 从远程加载 mask: {mask_data_url[:80]}...")
        else:
            raise ValueError(f"不支持的 mask URL 格式: {mask_data_url}")
        
        if mask_image.size != target_size:
            mask_image = mask_image.resize(target_size, Image.Resampling.LANCZOS)
        
        return mask_image
    
    def _convert_to_grayscale_mask(self, mask_image):
        """
        将 mask 转换为灰度图
        
        ★ 治本方案：前端已使用白色画笔，这里只需简单转灰度 ★
        - 前端：白色画笔 = 编辑区域
        - 后端：直接转灰度，白色保持白色
        """
        from PIL import Image
        import numpy as np
        
        if mask_image.mode == "RGBA":
            # 有 alpha 通道时，根据 alpha 提取 mask
            alpha = mask_image.split()[3]
            alpha_array = np.array(alpha)
            # alpha > 10 的区域视为有效（白色画笔区域）
            mask_array = np.where(alpha_array > 10, 255, 0).astype(np.uint8)
            return Image.fromarray(mask_array, mode="L")
        elif mask_image.mode == "L":
            # 已经是灰度图，直接返回
            return mask_image
        else:
            # RGB 等模式，转灰度
            return mask_image.convert("L")

    async def _process_background_replace(self, task: CapabilityTask) -> Dict[str, Any]:
        """
        换背景/图像编辑处理（使用 Kling omni-image API）
        
        ★★★ 重大更新：增加意图分类 ★★★
        
        工作流:
        0. 意图分类：判断是添加元素/局部修改/完整换背景
        1. 解析关键帧图片和 mask
        2. 根据意图选择不同的 API 和处理逻辑
        3. 返回生成的图片 URL
        
        ★ 画布模式核心原则：
        - 保持原始视频的宽高比
        - 根据意图决定处理方式
        
        意图分类:
        - add_element: 添加元素（太阳、云、特效）-> 使用 omni-image 局部添加
        - local_edit: 局部修改（有 mask）-> 使用 omni-image inpainting
        - full_replace: 完整换背景 -> 使用 omni-image 整体替换
        """
        logger.info(f"[BackgroundReplace] 开始图像编辑: {task.prompt}")
        
        try:
            # ★★★ Step 0: 意图分类 - 治本的核心（支持多模态） ★★★
            await self._emit_progress(task, 5, "正在分析编辑意图...")
            
            from app.services.edit_intent_classifier import classify_edit_intent, EditIntent
            from app.utils.image_utils import pil_image_to_base64
            from PIL import Image
            import os
            
            mask_data_url = getattr(task, 'mask_data_url', None) or task.mask_url
            has_mask = bool(mask_data_url)
            
            # ★ 如果有 mask，读取它的 base64 用于多模态分析
            mask_base64_for_analysis = None
            if has_mask and mask_data_url:
                try:
                    if mask_data_url.startswith('data:'):
                        # data URL 直接提取 base64
                        if ',' in mask_data_url:
                            mask_base64_for_analysis = mask_data_url.split(',')[1]
                    elif mask_data_url.startswith('http://') or mask_data_url.startswith('https://'):
                        # ★ 从远程 URL 读取（Supabase Storage）
                        async with httpx.AsyncClient(timeout=30) as client:
                            response = await client.get(mask_data_url, follow_redirects=True)
                            response.raise_for_status()
                            mask_img = Image.open(io.BytesIO(response.content))
                            mask_base64_for_analysis = pil_image_to_base64(mask_img, format="PNG")
                            logger.info(f"[BackgroundReplace] 已从远程加载 mask 用于多模态分析")
                except Exception as e:
                    logger.warning(f"[BackgroundReplace] 读取 mask 用于分析失败: {e}")
            
            intent_result = await classify_edit_intent(
                prompt=task.prompt,
                has_mask=has_mask,
                mask_base64=mask_base64_for_analysis,  # ★ 传入 mask 图片用于多模态分析
                use_llm=True,
            )
            
            logger.info(f"[BackgroundReplace] ★ 意图分类结果: {intent_result.intent.value}, "
                       f"confidence={intent_result.confidence:.2f}, "
                       f"reason={intent_result.reasoning}")
            
            # 记录意图到任务（用于调试和统计）
            task.metadata = task.metadata or {}
            task.metadata["intent"] = {
                "type": intent_result.intent.value,
                "confidence": intent_result.confidence,
                "reasoning": intent_result.reasoning,
                "suggested_api": intent_result.suggested_api,
            }
            
            await self._emit_progress(task, 10, f"意图识别完成: {self._get_intent_display_name(intent_result.intent)}")
            
            # Step 1: 准备图片数据
            if not task.keyframe_url:
                raise ValueError("需要关键帧图片进行图像编辑")
            
            # 导入图片处理工具
            from app.utils.image_utils import (
                prepare_kling_image_input,
                data_url_to_pil_image,
                process_drawing_mask,
                prepare_mask_for_inpainting,
                create_composite_image
            )
            import httpx
            from PIL import Image
            import io
            
            # ★ 用于后续合成的变量
            original_keyframe_image = None  # 原图（用于合成）
            processed_mask_image = None     # 处理后的 mask（用于合成）
            
            await self._emit_progress(task, 15, "正在准备图片...")
            
            # 确保 URL 有协议前缀
            keyframe_url = task.keyframe_url
            if keyframe_url and not keyframe_url.startswith(('http://', 'https://', 'data:')):
                # 相对路径，添加本地后端 URL
                from app.config import get_settings
                settings = get_settings()
                base_url = getattr(settings, 'BACKEND_URL', 'http://localhost:8000')
                keyframe_url = f"{base_url.rstrip('/')}/{keyframe_url.lstrip('/')}"
                logger.info(f"[BackgroundReplace] 补全 keyframe_url: {keyframe_url}")
            
            # 下载关键帧图片
            async with httpx.AsyncClient() as client:
                response = await client.get(keyframe_url)
                response.raise_for_status()
                keyframe_image = Image.open(io.BytesIO(response.content))
            
            # ★★★ 保存原图用于后续合成 ★★★
            original_keyframe_image = keyframe_image.copy()
            
            # ★★★ 核心修复：记录原始尺寸和宽高比 ★★★
            original_width, original_height = keyframe_image.size
            original_aspect_ratio = self._calculate_aspect_ratio_string(original_width, original_height)
            logger.info(f"[BackgroundReplace] 原始尺寸: {original_width}x{original_height}, 宽高比: {original_aspect_ratio}")
            
            # 准备 omni-image 的图片输入
            keyframe_base64 = prepare_kling_image_input(keyframe_image)
            image_list = [{"image": keyframe_base64}]
            
            await self._emit_progress(task, 20, "正在构建编辑指令...")
            
            # ★★★ Step 2: 根据意图构建不同的 Prompt ★★★
            # 意图已在 Step 0 分类，这里根据意图选择策略
            edit_prompt = await self._build_edit_prompt_by_intent(
                task=task,
                intent_result=intent_result,
                keyframe_image=keyframe_image,
                image_list=image_list,
            )
            
            # _build_edit_prompt_by_intent 已经处理了 mask 并返回最终的 prompt
            # edit_prompt 和 processed_mask_image, has_mask 都是从该方法返回的
            processed_mask_image = edit_prompt.get("processed_mask_image")
            has_mask = edit_prompt.get("has_mask", False)
            original_keyframe_image_for_composite = edit_prompt.get("original_keyframe_image")
            final_edit_prompt = edit_prompt.get("prompt", "")
            
            await self._emit_progress(task, 30, "正在调用 AI 生成...")
            
            # Step 3: 调用 Kling omni-image API（★ 使用 auto 保持原图比例）
            logger.info(f"[BackgroundReplace] 调用 omni-image, prompt: {final_edit_prompt[:100]}...")
            logger.info(f"[BackgroundReplace] 图片 base64 长度: {len(keyframe_base64)}, 原始尺寸: {original_width}x{original_height}")
            
            kling_task = await self.kling_client.create_omni_image_task(
                prompt=final_edit_prompt,
                image_list=image_list,
                options={
                    "n": 1,
                    "aspect_ratio": "auto"  # ★ 关键：使用 auto 让 API 自动保持输入图片的比例
                }
            )
            
            logger.info(f"[BackgroundReplace] omni-image 响应: {kling_task}")
            
            # 可灵 API 返回格式: {"code": 0, "data": {"task_id": "xxx"}}
            kling_data = kling_task.get("data", {})
            kling_task_id = kling_data.get("task_id") if isinstance(kling_data, dict) else None
            
            if not kling_task_id:
                error_msg = kling_task.get("message", "未知错误")
                raise ValueError(f"可灵 AI omni-image 任务创建失败: {error_msg}")
            
            logger.info(f"[BackgroundReplace] 创建 omni-image 任务: {kling_task_id}")
            
            # Step 4: 轮询等待结果
            result = await self._wait_for_omni_image_task(
                task=task,
                kling_task_id=kling_task_id,
                start_progress=30,
                end_progress=85
            )
            
            image_url = result.get("image_url")
            if not image_url:
                raise ValueError("图像编辑生成失败")
            
            # ★★★ 直接使用 AI 生成的图片，不做合成 ★★★
            logger.info(f"[BackgroundReplace] 直接使用 AI 生成图: {image_url}")
            
            await self._emit_progress(task, 94, "正在验证输出尺寸...")
            
            # ★★★ Step 5: 验证并调整输出尺寸（确保与原图一致）★★★
            final_image_url = await self._ensure_output_size(
                image_url=image_url,
                target_width=original_width,
                target_height=original_height
            )
            
            await self._emit_progress(task, 95, "处理完成...")
            
            logger.info(f"[BackgroundReplace] 图像编辑完成: {final_image_url}")
            
            # ★ 返回包含意图信息的结果
            return {
                "url": final_image_url, 
                "type": "image",
                "preview": True,  # 标记为预览，需要用户确认后应用
                "original_keyframe": task.keyframe_url,
                "original_size": {"width": original_width, "height": original_height},  # ★ 记录原始尺寸
                # ★★★ 新增：返回意图分类信息给前端 ★★★
                "intent": task.metadata.get("intent", {}) if task.metadata else {},
            }
            
        except Exception as e:
            logger.error(f"[BackgroundReplace] 图像编辑失败: {e}")
            raise
    
    async def _ensure_output_size(
        self,
        image_url: str,
        target_width: int,
        target_height: int,
        tolerance: float = 0.05  # 5% 容差
    ) -> str:
        """
        确保输出图片尺寸与目标尺寸一致
        
        画布模式核心原则：保持原始尺寸和比例
        
        Args:
            image_url: 生成的图片 URL
            target_width: 目标宽度
            target_height: 目标高度
            tolerance: 允许的尺寸误差比例
            
        Returns:
            处理后的图片 URL（可能与输入相同，也可能是调整后的新 URL）
        """
        import httpx
        from PIL import Image
        import io
        
        try:
            # 下载生成的图片
            async with httpx.AsyncClient() as client:
                response = await client.get(image_url)
                response.raise_for_status()
                generated_image = Image.open(io.BytesIO(response.content))
            
            gen_width, gen_height = generated_image.size
            
            # 检查尺寸是否在容差范围内
            width_diff = abs(gen_width - target_width) / target_width
            height_diff = abs(gen_height - target_height) / target_height
            
            if width_diff <= tolerance and height_diff <= tolerance:
                logger.info(f"[BackgroundReplace] 尺寸验证通过: {gen_width}x{gen_height} ≈ {target_width}x{target_height}")
                return image_url
            
            # 需要调整尺寸
            logger.warning(f"[BackgroundReplace] 尺寸不匹配: {gen_width}x{gen_height} → {target_width}x{target_height}, 正在调整...")
            
            # 调整尺寸（使用高质量重采样）
            resized_image = generated_image.resize(
                (target_width, target_height),
                Image.Resampling.LANCZOS
            )
            
            # 上传调整后的图片
            from app.utils.image_utils import pil_image_to_base64
            resized_base64 = pil_image_to_base64(resized_image, format="JPEG")
            
            # TODO: 这里应该上传到存储服务，暂时返回 data URL
            # 实际生产中应该上传到 Supabase Storage 或 CDN
            resized_url = f"data:image/jpeg;base64,{resized_base64}"
            
            logger.info(f"[BackgroundReplace] 尺寸调整完成: {target_width}x{target_height}")
            return resized_url
            
        except Exception as e:
            logger.error(f"[BackgroundReplace] 尺寸验证/调整失败: {e}, 返回原图")
            return image_url
    
    async def _wait_for_omni_image_task(
        self,
        task: CapabilityTask,
        kling_task_id: str,
        start_progress: int = 30,
        end_progress: int = 90,
        max_wait_seconds: int = 120
    ) -> Dict[str, Any]:
        """等待 omni-image 任务完成，同时发送进度更新"""
        import time
        start_time = time.time()
        poll_interval = 3  # omni-image 通常较快，3秒轮询一次
        
        while True:
            elapsed = time.time() - start_time
            if elapsed > max_wait_seconds:
                raise TimeoutError("等待 AI 生成超时")
            
            # 计算进度
            progress_ratio = min(elapsed / max_wait_seconds, 0.95)
            current_progress = int(start_progress + (end_progress - start_progress) * progress_ratio)
            await self._emit_progress(task, current_progress, f"AI 正在生成中... ({int(elapsed)}秒)")
            
            # 查询任务状态
            result = await self.kling_client.get_omni_image_task(kling_task_id)
            
            # 解析返回数据
            data = result.get("data", result)
            status = data.get("task_status")
            
            if status == "succeed":
                # 成功：提取图片 URL
                task_result = data.get("task_result", {})
                images = task_result.get("images", [])
                if images:
                    return {"image_url": images[0].get("url")}
                raise ValueError("omni-image 任务成功但无图片返回")
                
            elif status == "failed":
                error_msg = data.get("task_status_msg", "未知错误")
                raise ValueError(f"AI 生成失败: {error_msg}")
            
            # submitted / processing 继续等待
            await asyncio.sleep(poll_interval)
    
    async def _wait_for_kling_task_with_progress(
        self, 
        task: CapabilityTask, 
        kling_task_id: str, 
        task_type: str,
        start_progress: int = 30,
        end_progress: int = 90,
        max_wait_seconds: int = 300
    ) -> Dict[str, Any]:
        """等待可灵 AI 任务完成，同时发送进度更新"""
        import time
        start_time = time.time()
        poll_interval = 5
        
        while True:
            elapsed = time.time() - start_time
            if elapsed > max_wait_seconds:
                raise TimeoutError("等待 AI 生成超时")
            
            # 计算进度（基于时间估算）
            progress_ratio = min(elapsed / max_wait_seconds, 0.95)
            current_progress = int(start_progress + (end_progress - start_progress) * progress_ratio)
            await self._emit_progress(task, current_progress, f"AI 正在生成中... ({int(elapsed)}秒)")
            
            # 查询任务状态
            if task_type == "text2video":
                result = await self.kling_client.get_text_to_video_task(kling_task_id)
            elif task_type == "image2video":
                result = await self.kling_client.get_image_to_video_task(kling_task_id)
            else:
                raise ValueError(f"不支持的任务类型: {task_type}")
            
            status = result.get("status")
            if status == "completed":
                return result
            elif status == "failed":
                raise ValueError(f"AI 生成失败: {result.get('error', '未知错误')}")
            
            await asyncio.sleep(poll_interval)
    
    async def _process_add_broll(self, task: CapabilityTask) -> Dict[str, Any]:
        """
        在现有画面上添加元素（使用 omni-image 图像编辑）
        
        ★ 这是图像编辑功能，在现有关键帧上添加元素，不是生成新视频！
        
        工作流:
        1. 获取关键帧图片
        2. 使用 omni-image API 在图片上添加元素
        3. 返回编辑后的图片 URL
        """
        logger.info(f"[AddElement] 开始在画面上添加元素: {task.prompt}")
        
        try:
            await self._emit_progress(task, 10, "正在分析场景...")
            
            # Step 1: 准备图片数据
            if not task.keyframe_url:
                raise ValueError("需要关键帧图片进行编辑")
            
            from app.utils.image_utils import prepare_kling_image_input
            import httpx
            from PIL import Image
            import io
            
            await self._emit_progress(task, 15, "正在准备图片...")
            
            # 确保 URL 有协议前缀
            keyframe_url = task.keyframe_url
            if keyframe_url and not keyframe_url.startswith(('http://', 'https://', 'data:')):
                from app.config import get_settings
                settings = get_settings()
                base_url = getattr(settings, 'BACKEND_URL', 'http://localhost:8000')
                keyframe_url = f"{base_url.rstrip('/')}/{keyframe_url.lstrip('/')}"
            
            # 下载关键帧图片
            async with httpx.AsyncClient() as client:
                response = await client.get(keyframe_url)
                response.raise_for_status()
                keyframe_image = Image.open(io.BytesIO(response.content))
            
            # 记录原始尺寸和宽高比
            original_width, original_height = keyframe_image.size
            original_aspect_ratio = self._calculate_aspect_ratio_string(original_width, original_height)
            logger.info(f"[AddElement] 原始尺寸: {original_width}x{original_height}, 宽高比: {original_aspect_ratio}")
            
            # 准备 omni-image 的图片输入
            keyframe_base64 = prepare_kling_image_input(keyframe_image)
            image_list = [{"image": keyframe_base64}]
            
            await self._emit_progress(task, 25, "正在构建编辑指令...")
            
            # Step 2: 构建 prompt（在现有图片上添加元素）
            edit_prompt = (
                f"Based on <<<image_1>>>, add the following element: {task.prompt}. "
                f"Keep the original image content completely unchanged. "
                f"Only add the new element in the appropriate position. "
                f"Blend naturally with the existing scene."
            )
            
            await self._emit_progress(task, 30, "正在调用 AI 生成...")
            
            # Step 3: 调用 Kling omni-image API（图像编辑）
            logger.info(f"[AddElement] 调用 omni-image, prompt: {edit_prompt[:100]}...")
            
            kling_task = await self.kling_client.create_omni_image_task(
                prompt=edit_prompt,
                image_list=image_list,
                options={
                    "n": 1,
                    "aspect_ratio": "auto"  # ★ 使用 auto 自动保持输入图片的比例
                }
            )
            
            # 解析返回数据
            kling_data = kling_task.get("data", {})
            kling_task_id = kling_data.get("task_id") if isinstance(kling_data, dict) else None
            
            if not kling_task_id:
                error_msg = kling_task.get("message", "未知错误")
                raise ValueError(f"可灵 AI omni-image 任务创建失败: {error_msg}")
            
            logger.info(f"[AddElement] 创建 omni-image 任务: {kling_task_id}")
            
            # Step 4: 轮询等待结果
            result = await self._wait_for_omni_image_task(
                task=task,
                kling_task_id=kling_task_id,
                start_progress=35,
                end_progress=85
            )
            
            image_url = result.get("image_url")
            if not image_url:
                raise ValueError("图像编辑生成失败")
            
            await self._emit_progress(task, 90, "正在验证输出...")
            
            # Step 5: 验证并调整输出尺寸
            final_image_url = await self._ensure_output_size(
                image_url=image_url,
                target_width=original_width,
                target_height=original_height
            )
            
            await self._emit_progress(task, 95, "处理完成...")
            
            logger.info(f"[AddElement] 元素添加完成: {final_image_url}")
            
            return {
                "url": final_image_url, 
                "type": "image",
                "preview": True,
                "original_keyframe": task.keyframe_url,
                "original_size": {"width": original_width, "height": original_height}
            }
            
        except Exception as e:
            logger.error(f"[AddElement] 元素添加失败: {e}")
            raise
    
    async def _process_add_subtitle(self, task: CapabilityTask) -> Dict[str, Any]:
        """
        添加字幕处理
        
        工作流:
        1. 提取音频进行 ASR
        2. 生成字幕文件 (SRT/ASS)
        3. 烧录字幕到视频
        """
        logger.info(f"[AddSubtitle] 开始添加字幕")
        
        # TODO: 实现字幕处理
        # 目前返回占位结果
        return {"url": None, "type": "subtitle", "message": "字幕功能开发中"}
    
    async def _process_style_transfer(self, task: CapabilityTask) -> Dict[str, Any]:
        """
        风格迁移处理
        
        工作流:
        1. 提取关键帧
        2. 使用 image2video 进行风格迁移
        """
        logger.info(f"[StyleTransfer] 开始风格迁移: {task.prompt}")
        
        if not task.keyframe_url:
            raise ValueError("风格迁移需要关键帧图片")
        
        try:
            style_prompt = f"Transform this image into: {task.prompt}. Maintain the main subject and composition."
            
            kling_task = await self.kling_client.create_image_to_video_task(
                image=task.keyframe_url,  # 参数名是 image 不是 image_url
                prompt=style_prompt,
                options={
                    "model_name": "kling-v1-5",
                    "duration": "5",
                }
            )
            
            kling_task_id = kling_task.get("task_id")
            if not kling_task_id:
                raise ValueError("可灵 AI 任务创建失败")
            
            result = await self.kling_client.wait_for_task_completion(
                task_id=kling_task_id,
                task_type="image2video",
                max_wait_seconds=300
            )
            
            video_url = result.get("video_url")
            if not video_url:
                raise ValueError("风格迁移视频生成失败")
            
            return {"url": video_url, "type": "style"}
            
        except Exception as e:
            logger.error(f"[StyleTransfer] 风格迁移失败: {e}")
            raise
    
    async def _process_voice_enhance(self, task: CapabilityTask) -> Dict[str, Any]:
        """
        声音优化处理
        
        工作流:
        1. 提取音频
        2. 进行降噪、均衡处理
        3. 替换原音频
        """
        logger.info(f"[VoiceEnhance] 开始声音优化")
        
        # TODO: 实现声音优化
        # 目前返回占位结果
        return {"url": None, "type": "voice", "message": "声音优化功能开发中"}
    
    async def _upload_mask(self, task_id: str, mask_data_url: str) -> Optional[str]:
        """
        上传 Mask 图片到 Supabase Storage
        
        ★ 治本方案：不使用本地存储，直接上传到云端
        """
        try:
            import base64
            from .supabase_client import supabase
            
            # 解析 data URL
            if not mask_data_url.startswith("data:"):
                return None
            
            # 格式: data:image/png;base64,xxxxx
            header, data = mask_data_url.split(",", 1)
            image_data = base64.b64decode(data)
            
            # ★ 上传到 Supabase Storage
            storage_path = f"masks/{task_id}_mask.png"
            
            # 上传到 ai-creations bucket
            result = supabase.storage.from_("ai-creations").upload(
                path=storage_path,
                file=image_data,
                file_options={"content-type": "image/png", "upsert": "true"}
            )
            
            # 获取公开 URL
            public_url = supabase.storage.from_("ai-creations").get_public_url(storage_path)
            
            logger.info(f"[AICapability] Mask 上传到 Supabase: {public_url}")
            return public_url
            
        except Exception as e:
            logger.warning(f"[AICapability] Mask 上传失败: {e}")
            return None


# 单例
_ai_capability_service: Optional[AICapabilityService] = None


def get_ai_capability_service() -> AICapabilityService:
    """获取 AI 能力服务单例"""
    global _ai_capability_service
    if _ai_capability_service is None:
        _ai_capability_service = AICapabilityService()
    return _ai_capability_service
