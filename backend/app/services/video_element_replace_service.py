"""
视频元素替换服务 - 治本方案

使用 Kling 多模态视频编辑 API 实现视频元素替换，保持视频连续性。

核心思路：
- 不是编辑一帧然后 I2V，而是直接在视频上进行元素替换
- 保持原视频的：音频、动作、运镜、节奏
- 只替换画面中的视觉元素（背景/人物）

支持的场景：
1. 纯背景替换 - 使用 multi-elements swap API 替换背景
2. 人物替换 - 使用 motion-control + lip-sync API 替换人物
3. 元素增加 - 使用 multi-elements addition API 添加元素

API 流程：
- 背景替换：init_selection → add_selection(选人物) → swap(替换背景图)
- 人物替换：motion_control(新人物+原视频动作) → lip_sync(原音频)

优势：
- AI 模型直接处理视频，保持时序连续性
- 原生支持音频保留
- 无需复杂的帧级合成逻辑
"""

import os
import uuid
import asyncio
import logging
import tempfile
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime
from dataclasses import dataclass
from enum import Enum
import httpx

from .kling_ai_service import KlingAIClient
from .supabase_client import supabase

logger = logging.getLogger(__name__)


# ==========================================
# 数据结构
# ==========================================

class ReplaceStrategy(Enum):
    """替换策略"""
    BACKGROUND_SWAP = "background_swap"     # 纯背景替换
    PERSON_REPLACE = "person_replace"       # 人物替换
    ELEMENT_ADD = "element_add"             # 元素增加
    ELEMENT_REMOVE = "element_remove"       # 元素删除


class ReplaceStatus(Enum):
    """替换状态"""
    PENDING = "pending"
    INITIALIZING = "initializing"       # 初始化视频
    SELECTING = "selecting"             # 选择区域
    PROCESSING = "processing"           # 处理中
    SYNCING_AUDIO = "syncing_audio"     # 音频同步
    MERGING = "merging"                 # 合并音视频
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class ReplaceTask:
    """替换任务"""
    id: str
    clip_id: str
    video_url: str
    strategy: ReplaceStrategy
    status: ReplaceStatus
    progress: int  # 0-100
    
    # 输入
    new_background_url: Optional[str] = None    # 新背景图（背景替换用）
    new_person_url: Optional[str] = None        # 新人物图（人物替换用）
    element_image_url: Optional[str] = None     # 新元素图（元素增加用）
    prompt: Optional[str] = None                # 提示词
    
    # 中间状态
    session_id: Optional[str] = None            # Kling session_id
    task_id: Optional[str] = None               # Kling task_id
    original_audio_url: Optional[str] = None    # 提取的原音频
    
    # 结果
    result_video_url: Optional[str] = None
    error: Optional[str] = None
    
    created_at: datetime = None
    updated_at: datetime = None


# ==========================================
# 视频元素替换服务
# ==========================================

class VideoElementReplaceService:
    """
    视频元素替换服务
    
    使用 Kling API 实现视频级别的元素替换，保持视频连续性。
    
    Kling 多模态视频编辑 API 限制：
    - 视频时长：≥2秒且≤5秒，或≥7秒且≤10秒
    - 视频格式：MP4/MOV
    - 分辨率：720px-2160px
    - 帧率：24/30/60fps
    """
    
    # Kling 多模态 API 支持的时长范围
    VALID_DURATION_RANGES = [
        (2.0, 5.0),   # 2-5秒
        (7.0, 10.0),  # 7-10秒
    ]
    
    def __init__(self):
        self.kling = KlingAIClient()
        self.http_client = httpx.AsyncClient(timeout=120)
        
        # 内存缓存（热数据，同时持久化到 tasks 表）
        self._tasks: Dict[str, ReplaceTask] = {}
    
    # ==========================================
    # 数据库持久化方法
    # ==========================================
    
    async def _save_task_to_db(self, task: ReplaceTask, user_id: str, project_id: Optional[str] = None) -> None:
        """
        将任务保存到 tasks 表（统一任务表）
        """
        try:
            data = {
                "id": task.id,
                "user_id": user_id,
                "project_id": project_id,
                "clip_id": task.clip_id,
                "task_type": "background_replace",
                "status": task.status.value,
                "progress": task.progress,
                "status_message": self._get_status_message(task.status),
                "metadata": {
                    "provider": "kling",
                    "provider_task_id": task.task_id,
                    "video_url": task.video_url,
                    "new_background_url": task.new_background_url,
                    "new_person_url": task.new_person_url,
                    "strategy": task.strategy.value,
                    "prompt": task.prompt,
                },
                "result_url": task.result_video_url,
                "error_message": task.error,
                "created_at": task.created_at.isoformat() if task.created_at else datetime.utcnow().isoformat(),
            }
            
            # Upsert：如果存在则更新，不存在则插入
            supabase.table("tasks").upsert(data).execute()
            logger.debug(f"[VideoReplace] 任务已保存到数据库: {task.id}")
        except Exception as e:
            logger.error(f"[VideoReplace] 保存任务到数据库失败: {e}")
    
    async def _update_task_in_db(self, task: ReplaceTask) -> None:
        """
        更新 tasks 表中的任务状态
        """
        try:
            data = {
                "status": task.status.value,
                "progress": task.progress,
                "status_message": self._get_status_message(task.status),
                "result_url": task.result_video_url,
                "error_message": task.error,
                "updated_at": datetime.utcnow().isoformat(),
            }
            
            # 更新 metadata 中的 provider_task_id
            if task.task_id:
                # 先获取现有 metadata
                existing = supabase.table("tasks").select("metadata").eq("id", task.id).single().execute()
                if existing.data:
                    metadata = existing.data.get("metadata") or {}
                    metadata["provider_task_id"] = task.task_id
                    data["metadata"] = metadata
            
            if task.status == ReplaceStatus.PROCESSING and not task.error:
                data["started_at"] = datetime.utcnow().isoformat()
            elif task.status in (ReplaceStatus.COMPLETED, ReplaceStatus.FAILED):
                data["completed_at"] = datetime.utcnow().isoformat()
            
            supabase.table("tasks").update(data).eq("id", task.id).execute()
            logger.debug(f"[VideoReplace] 任务状态已更新: {task.id} -> {task.status.value}")
        except Exception as e:
            logger.error(f"[VideoReplace] 更新任务状态失败: {e}")
    
    def _get_status_message(self, status: ReplaceStatus) -> str:
        """获取状态描述"""
        messages = {
            ReplaceStatus.PENDING: "等待处理",
            ReplaceStatus.INITIALIZING: "正在初始化视频",
            ReplaceStatus.SELECTING: "正在识别人物区域",
            ReplaceStatus.PROCESSING: "AI 正在替换背景",
            ReplaceStatus.SYNCING_AUDIO: "正在同步音频",
            ReplaceStatus.MERGING: "正在合并音视频",
            ReplaceStatus.COMPLETED: "处理完成",
            ReplaceStatus.FAILED: "处理失败",
        }
        return messages.get(status, "未知状态")
    
    async def _upload_to_storage(self, video_url: str, task_id: str) -> str:
        """
        将视频 URL 下载并上传到我们的存储（治本方案）
        
        避免 Kling 等第三方 URL 过期问题，统一存储到 Supabase Storage。
        
        Args:
            video_url: 原始视频 URL（可能是 Kling 返回的临时 URL）
            task_id: 任务 ID，用于构建存储路径
            
        Returns:
            上传后的公开 URL
        """
        from .supabase_client import get_file_url
        
        try:
            # 1. 下载视频
            logger.info(f"[VideoReplace] 正在下载视频以上传到存储: {video_url[:60]}...")
            response = await self.http_client.get(video_url, follow_redirects=True)
            response.raise_for_status()
            video_data = response.content
            
            # 2. 上传到 Supabase Storage（在线程池中执行，避免阻塞）
            storage_path = f"ai-generated/{task_id}.mp4"
            
            def _upload_video():
                supabase.storage.from_("ai-creations").upload(
                    storage_path,
                    video_data,
                    file_options={"content-type": "video/mp4", "upsert": "true"}
                )
            
            await asyncio.get_event_loop().run_in_executor(None, _upload_video)
            
            # 3. 获取公开 URL（长期有效）
            public_url = get_file_url("ai-creations", storage_path, expires_in=86400 * 365)  # 1年有效
            
            logger.info(f"[VideoReplace] 视频已上传到存储: {public_url[:60]}...")
            return public_url
            
        except Exception as e:
            logger.warning(f"[VideoReplace] 上传视频到存储失败: {e}，使用原 URL")
            return video_url  # 失败时返回原 URL
    
    def _is_valid_duration(self, duration_seconds: float) -> bool:
        """检查视频时长是否符合 Kling 多模态 API 要求"""
        for min_dur, max_dur in self.VALID_DURATION_RANGES:
            if min_dur <= duration_seconds <= max_dur:
                return True
        return False
    
    async def _get_video_duration(self, video_url: str) -> float:
        """获取视频时长（秒）"""
        import subprocess
        import tempfile
        
        # 下载视频
        response = await self.http_client.get(video_url, follow_redirects=True)
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
            duration = float(result.stdout.strip())
            return duration
        finally:
            os.unlink(video_path)
    
    # ==========================================
    # 公共入口
    # ==========================================
    
    async def create_background_replace_with_smart_split(
        self,
        clip_id: str,
        video_url: str,
        new_background_url: str,
        duration_ms: int,
        transcript: Optional[str] = None,
        prompt: Optional[str] = None,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> List[ReplaceTask]:
        """
        ★★★ 智能分片 + 批量任务创建 ★★★
        
        如果 clip 时长不符合 Kling API 要求（2-5秒或7-10秒），
        自动分片并创建多个任务。
        
        Args:
            clip_id: Clip ID
            video_url: 视频 URL
            new_background_url: 新背景图 URL
            duration_ms: 视频时长（毫秒）
            transcript: 转写文本（用于分句策略）
            prompt: 提示词
            user_id: 用户 ID
            project_id: 项目 ID
            
        Returns:
            List[ReplaceTask]: 创建的任务列表（可能是1个或多个）
        """
        from .smart_clip_splitter import get_smart_clip_splitter, is_valid_duration
        
        duration_seconds = duration_ms / 1000
        
        # 1. 检查是否需要分片
        if is_valid_duration(duration_seconds):
            # 不需要分片，直接创建单个任务
            logger.info(f"[VideoReplace] Clip {clip_id} 时长 {duration_seconds:.1f}s 符合要求，创建单个任务")
            task = await self.create_background_replace_task(
                clip_id=clip_id,
                video_url=video_url,
                new_background_url=new_background_url,
                prompt=prompt,
                user_id=user_id,
                project_id=project_id,
            )
            return [task]
        
        # 2. 需要分片
        logger.info(f"[VideoReplace] Clip {clip_id} 时长 {duration_seconds:.1f}s 需要分片")
        splitter = get_smart_clip_splitter()
        
        # 获取分片计划
        split_plan = await splitter.analyze_and_plan(
            clip_id=clip_id,
            duration_ms=duration_ms,
            transcript=transcript,
        )
        
        if not split_plan.needs_split or len(split_plan.segments) <= 1:
            # 无法分片（如视频太短），尝试直接创建任务
            logger.warning(f"[VideoReplace] 无法分片，尝试直接创建任务")
            task = await self.create_background_replace_task(
                clip_id=clip_id,
                video_url=video_url,
                new_background_url=new_background_url,
                prompt=prompt,
                user_id=user_id,
                project_id=project_id,
            )
            return [task]
        
        logger.info(f"[VideoReplace] 分片计划: {split_plan.segment_count} 个分片, 策略: {split_plan.split_strategy}")
        
        # 3. 为每个分片创建任务
        tasks = []
        parent_task_id = str(uuid.uuid4())  # 父任务 ID，用于关联
        
        for i, segment in enumerate(split_plan.segments):
            # 创建分片任务
            task = ReplaceTask(
                id=str(uuid.uuid4()),
                clip_id=clip_id,
                video_url=video_url,
                strategy=ReplaceStrategy.BACKGROUND_SWAP,
                status=ReplaceStatus.PENDING,
                progress=0,
                new_background_url=new_background_url,
                prompt=prompt,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            
            # 存储分片信息
            task.segment_info = {
                "segment_id": segment.id,
                "parent_task_id": parent_task_id,
                "segment_index": i,
                "total_segments": len(split_plan.segments),
                "start_ms": segment.start_ms,
                "end_ms": segment.end_ms,
                "duration_ms": segment.duration_ms,
                "transcript": segment.transcript,
                "split_strategy": split_plan.split_strategy,
            }
            
            self._tasks[task.id] = task
            
            # 保存到数据库
            if user_id:
                await self._save_segment_task_to_db(task, user_id, project_id, segment, parent_task_id)
            
            tasks.append(task)
            logger.info(f"[VideoReplace] 创建分片任务 {i+1}/{len(split_plan.segments)}: {task.id}, 时长 {segment.duration_seconds:.1f}s")
        
        return tasks
    
    async def _save_segment_task_to_db(
        self,
        task: ReplaceTask,
        user_id: str,
        project_id: Optional[str],
        segment,
        parent_task_id: str
    ) -> None:
        """保存分片任务到数据库"""
        try:
            data = {
                "id": task.id,
                "user_id": user_id,
                "project_id": project_id,
                "clip_id": task.clip_id,
                "task_type": "background_replace",
                "status": task.status.value,
                "progress": task.progress,
                "status_message": f"分片 {segment.split_reason}",
                "metadata": {
                    "provider": "kling",
                    "video_url": task.video_url,
                    "new_background_url": task.new_background_url,
                    "strategy": task.strategy.value,
                    "prompt": task.prompt,
                    # 分片信息
                    "is_segment": True,
                    "parent_task_id": parent_task_id,
                    "segment_index": getattr(task, 'segment_info', {}).get('segment_index', 0),
                    "total_segments": getattr(task, 'segment_info', {}).get('total_segments', 1),
                    "segment_start_ms": segment.start_ms,
                    "segment_end_ms": segment.end_ms,
                    "segment_duration_ms": segment.duration_ms,
                },
                "created_at": task.created_at.isoformat() if task.created_at else datetime.utcnow().isoformat(),
            }
            
            supabase.table("tasks").upsert(data).execute()
            logger.debug(f"[VideoReplace] 分片任务已保存: {task.id}")
        except Exception as e:
            logger.error(f"[VideoReplace] 保存分片任务失败: {e}")
    
    async def execute_background_replace_with_split(
        self,
        task_id: str,
        progress_callback: Optional[callable] = None
    ) -> ReplaceTask:
        """
        ★★★ 执行分片任务的背景替换 ★★★
        
        如果任务有分片信息，会先裁剪视频片段再处理。
        处理完成后，检查是否所有分片都已完成，如果是则自动合并。
        """
        task = self._tasks.get(task_id)
        if not task:
            raise ValueError(f"任务不存在: {task_id}")
        
        segment_info = getattr(task, 'segment_info', None)
        
        try:
            if segment_info:
                # 有分片信息，需要先裁剪视频
                logger.info(f"[VideoReplace] 执行分片任务 {task_id}: {segment_info['segment_index']+1}/{segment_info['total_segments']}")
                
                # 裁剪视频片段（传入 clip_id 用于解析 localhost URL）
                segment_video_url = await self._cut_video_segment(
                    video_url=task.video_url,
                    start_ms=segment_info['start_ms'],
                    end_ms=segment_info['end_ms'],
                    task_id=task_id,
                    clip_id=task.clip_id
                )
                
                # 临时替换 video_url 为裁剪后的片段
                original_video_url = task.video_url
                task.video_url = segment_video_url
                
                try:
                    # 执行替换
                    result = await self.execute_background_replace(task_id, progress_callback)
                    
                    # ★★★ 检查是否所有分片都已完成，如果是则合并 ★★★
                    if result.status == ReplaceStatus.COMPLETED:
                        parent_task_id = segment_info.get('parent_task_id')
                        if parent_task_id:
                            merged_url = await self.check_and_merge_segments(
                                parent_task_id=parent_task_id,
                                clip_id=task.clip_id,
                            )
                            if merged_url:
                                logger.info(f"[VideoReplace] ★ 所有分片已完成并合并: {merged_url[:60]}...")
                                # TODO: 更新 clip 的 videoUrl，或创建一个合并后的总任务
                    
                    return result
                finally:
                    # 恢复原始 URL
                    task.video_url = original_video_url
            else:
                # 普通任务，直接执行
                return await self.execute_background_replace(task_id, progress_callback)
        except Exception as e:
            # ★★★ 治本：裁剪或执行过程中任何异常都要更新任务状态 ★★★
            import traceback
            logger.error(f"[VideoReplace] 分片任务执行失败: {task_id}, error: {e}\n{traceback.format_exc()}")
            task.status = ReplaceStatus.FAILED
            task.error = str(e) if str(e) else repr(e)
            task.updated_at = datetime.utcnow()
            await self._update_task_in_db(task)
            raise
    
    async def _cut_video_segment(
        self,
        video_url: str,
        start_ms: int,
        end_ms: int,
        task_id: str,
        clip_id: Optional[str] = None
    ) -> str:
        """
        裁剪视频片段
        
        使用 ffmpeg 裁剪视频，上传到临时存储，返回 URL。
        """
        import tempfile
        from .supabase_client import get_file_url, supabase
        
        logger.info(f"[VideoReplace] 裁剪视频: {start_ms}ms - {end_ms}ms")
        
        # ★★★ 治本：解析 localhost URL 为可直接访问的 URL ★★★
        resolved_url = video_url
        if "localhost" in video_url or "127.0.0.1" in video_url:
            if clip_id:
                logger.info(f"[VideoReplace] 检测到本地 URL，尝试解析: {video_url[:50]}...")
                from app.services.background_replace_workflow import resolve_video_download_url
                resolved = await resolve_video_download_url(clip_id)
                if resolved:
                    resolved_url = resolved
                    logger.info(f"[VideoReplace] 解析成功: {resolved_url[:80]}...")
                else:
                    raise ValueError(f"无法解析 clip {clip_id} 的视频 URL，请确保视频已上传到云端")
            else:
                raise ValueError(f"无法下载本地 URL {video_url}，缺少 clip_id 无法解析")
        
        # 下载原视频
        response = await self.http_client.get(resolved_url, follow_redirects=True)
        response.raise_for_status()
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as input_file:
            input_file.write(response.content)
            input_path = input_file.name
        
        output_path = input_path.replace(".mp4", f"_segment_{task_id[:8]}.mp4")
        
        try:
            # 使用 ffmpeg 裁剪（异步执行，不阻塞事件循环）
            start_seconds = start_ms / 1000
            duration_seconds = (end_ms - start_ms) / 1000
            
            cmd = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-ss", str(start_seconds),
                "-t", str(duration_seconds),
                "-c:v", "libx264",
                "-c:a", "aac",
                "-preset", "fast",
                output_path
            ]
            
            # ★★★ 使用 asyncio.create_subprocess_exec 避免阻塞 ★★★
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            if process.returncode != 0:
                raise RuntimeError(f"ffmpeg 裁剪失败: {stderr.decode()}")
            
            # 上传到临时存储（在线程池中执行，避免阻塞）
            def _read_and_upload():
                with open(output_path, "rb") as f:
                    segment_data = f.read()
                supabase.storage.from_("clips").upload(
                    storage_path,
                    segment_data,
                    file_options={"content-type": "video/mp4", "upsert": "true"}
                )
            
            storage_path = f"temp/segments/{task_id}.mp4"
            await asyncio.get_event_loop().run_in_executor(None, _read_and_upload)
            
            # 获取公开 URL
            segment_url = get_file_url("clips", storage_path, expires_in=3600)
            
            logger.info(f"[VideoReplace] 裁剪完成: {duration_seconds:.1f}s, URL: {segment_url[:60]}...")
            return segment_url
            
        finally:
            # 清理临时文件
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(output_path):
                os.unlink(output_path)

    async def merge_segment_videos(
        self,
        segment_video_urls: List[str],
        output_task_id: str
    ) -> str:
        """
        合并多个分片视频
        
        Args:
            segment_video_urls: 按顺序排列的分片视频 URL 列表
            output_task_id: 输出任务 ID（用于命名）
            
        Returns:
            合并后的视频 URL
        """
        import tempfile
        from .supabase_client import get_file_url, supabase
        
        if not segment_video_urls:
            raise ValueError("没有要合并的视频")
        
        if len(segment_video_urls) == 1:
            return segment_video_urls[0]
        
        logger.info(f"[VideoReplace] 合并 {len(segment_video_urls)} 个分片视频")
        
        # 下载所有分片视频
        segment_paths = []
        try:
            for i, url in enumerate(segment_video_urls):
                response = await self.http_client.get(url, follow_redirects=True)
                response.raise_for_status()
                
                with tempfile.NamedTemporaryFile(suffix=f"_seg{i}.mp4", delete=False) as f:
                    f.write(response.content)
                    segment_paths.append(f.name)
            
            # 创建 ffmpeg 合并列表
            list_file = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
            for path in segment_paths:
                list_file.write(f"file '{path}'\n")
            list_file.close()
            
            # 输出文件
            output_path = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
            
            # 使用 ffmpeg concat 合并（异步执行，不阻塞事件循环）
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", list_file.name,
                "-c:v", "libx264",
                "-c:a", "aac",
                "-preset", "fast",
                output_path
            ]
            
            # ★★★ 使用 asyncio.create_subprocess_exec 避免阻塞 ★★★
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            if process.returncode != 0:
                raise RuntimeError(f"ffmpeg 合并失败: {stderr.decode()}")
            
            # 上传合并后的视频（在线程池中执行，避免阻塞）
            storage_path = f"processed/{output_task_id}_merged.mp4"
            
            def _read_and_upload_merged():
                with open(output_path, "rb") as f:
                    merged_data = f.read()
                supabase.storage.from_("clips").upload(
                    storage_path,
                    merged_data,
                    file_options={"content-type": "video/mp4", "upsert": "true"}
                )
            
            await asyncio.get_event_loop().run_in_executor(None, _read_and_upload_merged)
            
            # 获取公开 URL
            merged_url = get_file_url("clips", storage_path, expires_in=86400)  # 24小时有效
            
            logger.info(f"[VideoReplace] 合并完成: {merged_url[:60]}...")
            return merged_url
            
        finally:
            # 清理临时文件
            for path in segment_paths:
                if os.path.exists(path):
                    os.unlink(path)
            if 'list_file' in dir() and os.path.exists(list_file.name):
                os.unlink(list_file.name)
            if 'output_path' in dir() and os.path.exists(output_path):
                os.unlink(output_path)

    async def check_and_merge_segments(
        self,
        parent_task_id: str,
        clip_id: str,
    ) -> Optional[str]:
        """
        检查分片任务是否全部完成，如果完成则合并
        
        Args:
            parent_task_id: 父任务 ID
            clip_id: Clip ID
            
        Returns:
            合并后的视频 URL，如果还未全部完成则返回 None
        """
        # 从数据库获取所有分片任务
        try:
            result = supabase.table("tasks").select(
                "id, status, result_url, metadata"
            ).eq("clip_id", clip_id).execute()
            
            if not result.data:
                return None
            
            # 筛选属于同一父任务的分片任务
            segment_tasks = [
                t for t in result.data
                if t.get("metadata", {}).get("parent_task_id") == parent_task_id
            ]
            
            if not segment_tasks:
                return None
            
            # 检查是否全部完成
            all_completed = all(t.get("status") == "completed" for t in segment_tasks)
            if not all_completed:
                pending = sum(1 for t in segment_tasks if t.get("status") != "completed")
                logger.info(f"[VideoReplace] 还有 {pending}/{len(segment_tasks)} 个分片任务未完成")
                return None
            
            # 按 segment_index 排序
            segment_tasks.sort(key=lambda t: t.get("metadata", {}).get("segment_index", 0))
            
            # 获取所有结果 URL
            segment_urls = [t.get("result_url") for t in segment_tasks if t.get("result_url")]
            
            if len(segment_urls) != len(segment_tasks):
                logger.warning(f"[VideoReplace] 部分分片任务没有结果 URL")
                return None
            
            # 合并视频
            merged_url = await self.merge_segment_videos(segment_urls, parent_task_id)
            
            logger.info(f"[VideoReplace] 所有分片已合并: {merged_url[:60]}...")
            return merged_url
            
        except Exception as e:
            logger.error(f"[VideoReplace] 检查分片任务失败: {e}")
            return None

    async def create_background_replace_task(
        self,
        clip_id: str,
        video_url: str,
        new_background_url: str,
        prompt: Optional[str] = None,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None
    ) -> ReplaceTask:
        """
        ★★★ 治本方案：创建背景替换任务（立即返回，异步执行）★★★
        
        只创建任务记录，不执行实际替换。
        实际替换由 execute_background_replace 在后台执行。
        
        Returns:
            ReplaceTask: 刚创建的任务（状态为 PENDING）
        """
        task = ReplaceTask(
            id=str(uuid.uuid4()),
            clip_id=clip_id,
            video_url=video_url,
            strategy=ReplaceStrategy.BACKGROUND_SWAP,
            status=ReplaceStatus.PENDING,
            progress=0,
            new_background_url=new_background_url,
            prompt=prompt,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        self._tasks[task.id] = task
        
        # 保存到数据库
        if user_id:
            await self._save_task_to_db(task, user_id, project_id)
        
        logger.info(f"[VideoReplace] 创建背景替换任务: {task.id}")
        return task
    
    async def execute_background_replace(
        self,
        task_id: str,
        progress_callback: Optional[callable] = None
    ) -> ReplaceTask:
        """
        ★★★ 治本方案：执行背景替换（在后台异步调用）★★★
        
        Args:
            task_id: 任务 ID
            progress_callback: 进度回调
            
        Returns:
            ReplaceTask: 完成后的任务
        """
        task = self._tasks.get(task_id)
        if not task:
            raise ValueError(f"任务不存在: {task_id}")
        
        video_url = task.video_url
        clip_id = task.clip_id
        new_background_url = task.new_background_url
        
        try:
            # Step 0: 解析视频 URL（将 localhost URL 转换为公开可访问的 URL）
            from app.services.background_replace_workflow import resolve_video_download_url
            
            resolved_url = video_url
            if "localhost" in video_url or "127.0.0.1" in video_url:
                logger.info(f"[VideoReplace] 检测到本地 URL，尝试解析: {video_url[:50]}...")
                resolved = await resolve_video_download_url(clip_id)
                if resolved:
                    resolved_url = resolved
                    logger.info(f"[VideoReplace] 解析成功: {resolved_url[:80]}...")
                else:
                    raise ValueError(f"无法解析 clip {clip_id} 的视频 URL，请确保视频已上传到云端")
            
            # Step 1: 初始化视频 (0-10%)
            await self._update_status(task, ReplaceStatus.INITIALIZING, 5, "正在初始化视频...", progress_callback)
            
            try:
                init_result = await self.kling.init_video_selection(video_url=resolved_url)
            except Exception as e:
                error_str = str(e)
                # ★ 治本：解析 Kling API 的具体错误
                if "400" in error_str:
                    # 400 错误通常是参数问题
                    raise ValueError(f"视频不符合 Kling API 要求（需要 MP4/MOV 格式，2-5秒或7-10秒，720-2160px）: {error_str}")
                raise
                
            if init_result.get("code") != 0:
                error_msg = init_result.get("message", str(init_result))
                # 如果是时长限制问题，给出明确提示
                if "duration" in error_msg.lower() or "时长" in error_msg:
                    raise ValueError(f"视频时长不符合要求（需要2-5秒或7-10秒）: {error_msg}")
                raise ValueError(f"初始化视频失败: {error_msg}")
            
            data = init_result.get("data", {})
            task.session_id = data.get("session_id")
            video_duration_ms = data.get("original_duration", 0)
            video_duration = video_duration_ms / 1000  # ms -> s
            video_width = data.get("width", 720)
            video_height = data.get("height", 1280)
            logger.info(f"[VideoReplace] 初始化成功: session_id={task.session_id}, duration={video_duration}s, size={video_width}x{video_height}")
            
            # 计算目标 duration（必须匹配 API 要求：5 或 10）
            if video_duration <= 5:
                target_duration = "5"
            else:
                target_duration = "10"
            
            # Step 2: 选择人物区域（选中人物，让 AI 知道要保留什么）(10-25%)
            # 文档说明：选中的点会被识别为一个语义对象
            # 我们选中人物中心点，AI 会自动分割出整个人物
            await self._update_status(task, ReplaceStatus.SELECTING, 15, "正在识别人物区域...", progress_callback)
            
            # 在画面中心偏上位置标记人物（通常人物头部在这个区域）
            # 多个点帮助 AI 更好地识别整个人物
            person_points = [
                {"x": 0.5, "y": 0.3},   # 头部区域
                {"x": 0.5, "y": 0.5},   # 躯干区域
            ]
            
            selection_result = await self.kling.add_video_selection(
                session_id=task.session_id,
                frame_index=0,  # 第一帧标记
                points=person_points
            )
            
            if selection_result.get("code") != 0:
                raise ValueError(f"选择人物区域失败: {selection_result.get('message', str(selection_result))}")
            
            await self._update_status(task, ReplaceStatus.SELECTING, 25, "人物区域已识别", progress_callback)
            
            # Step 3: 提交替换任务 (25-90%)
            await self._update_status(task, ReplaceStatus.PROCESSING, 30, "正在替换背景...", progress_callback)
            
            # ★★★ 治本：使用正确的 API 方法 create_multi_elements_task ★★★
            # 构建替换 prompt：使用新背景图片替换视频中的背景（非选中区域）
            swap_prompt = f"使用<<<image_1>>>中的背景场景，替换<<<video_1>>>中的背景"
            
            swap_result = await self.kling.create_multi_elements_task(
                session_id=task.session_id,
                edit_mode="swap",
                prompt=swap_prompt,
                options={
                    "image_list": [new_background_url],
                    "duration": target_duration,
                    "mode": "std",
                }
            )
            
            if swap_result.get("code") != 0:
                raise ValueError(f"替换请求失败: {swap_result.get('message', str(swap_result))}")
            
            task.task_id = swap_result.get("data", {}).get("task_id")
            logger.info(f"[VideoReplace] 替换任务已提交: task_id={task.task_id}")
            
            # 轮询等待完成
            result_url = await self._poll_task_completion(
                task, progress_callback,
                start_progress=35, end_progress=90,
                max_wait_seconds=300
            )
            
            # Step 4: 处理音频（如果 Kling 没有保留）(90-100%)
            await self._update_status(task, ReplaceStatus.MERGING, 95, "正在处理音频...", progress_callback)
            
            # 先检查生成的视频是否有音频
            # TODO: 如果没有，需要从原视频提取并合并
            final_url = result_url
            
            # 上传结果到我们的存储（避免 Kling URL 过期）
            try:
                final_url = await self._upload_to_storage(result_url, task.id)
            except Exception as e:
                logger.warning(f"[VideoReplace] 上传到存储失败，使用原 URL: {e}")
            
            # 完成
            task.result_video_url = final_url
            await self._update_status(task, ReplaceStatus.COMPLETED, 100, "替换完成！", progress_callback)
            
            return task
            
        except Exception as e:
            import traceback
            logger.error(f"[VideoReplace] 背景替换失败: {e}\n{traceback.format_exc()}")
            task.status = ReplaceStatus.FAILED
            task.error = str(e) if str(e) else repr(e)
            task.updated_at = datetime.utcnow()
            # ★★★ 治本修复：将失败状态同步到数据库 ★★★
            await self._update_task_in_db(task)
            if progress_callback:
                await progress_callback(task.progress, f"失败: {e}")
            raise

    async def replace_background(
        self,
        clip_id: str,
        video_url: str,
        new_background_url: str,
        prompt: Optional[str] = None,
        progress_callback: Optional[callable] = None,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None
    ) -> ReplaceTask:
        """
        替换视频背景（策略A - 治本方案）
        
        ★★★ 已废弃：请使用 create_background_replace_task + execute_background_replace ★★★
        此方法保留是为了兼容性，内部会调用新方法。
        
        使用 Kling multi-elements API 直接替换视频背景，
        保持人物动作、口型、音频完全不变。
        
        流程：
        1. 初始化视频 → 获取 session_id
        2. 标记人物区域（选中人物，这样替换的就是背景）
        3. 调用 swap API 替换背景
        4. 等待生成完成
        5. 提取原音频 + 合并（如果 Kling 没有保留音频）
        
        Args:
            clip_id: Clip ID
            video_url: 原视频 URL
            new_background_url: 新背景图 URL
            prompt: 可选提示词
            progress_callback: 进度回调 (progress: int, message: str)
            user_id: 用户 ID（用于持久化到 tasks 表）
            project_id: 项目 ID（用于关联查询）
            
        Returns:
            ReplaceTask: 替换任务
        """
        task = ReplaceTask(
            id=str(uuid.uuid4()),
            clip_id=clip_id,
            video_url=video_url,
            strategy=ReplaceStrategy.BACKGROUND_SWAP,
            status=ReplaceStatus.PENDING,
            progress=0,
            new_background_url=new_background_url,
            prompt=prompt,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        self._tasks[task.id] = task
        
        # 保存到数据库
        if user_id:
            await self._save_task_to_db(task, user_id, project_id)
        
        try:
            # Step 0: 解析视频 URL（将 localhost URL 转换为公开可访问的 URL）
            from app.services.background_replace_workflow import resolve_video_download_url
            
            resolved_url = video_url
            if "localhost" in video_url or "127.0.0.1" in video_url:
                logger.info(f"[VideoReplace] 检测到本地 URL，尝试解析: {video_url[:50]}...")
                resolved = await resolve_video_download_url(clip_id)
                if resolved:
                    resolved_url = resolved
                    logger.info(f"[VideoReplace] 解析成功: {resolved_url[:80]}...")
                else:
                    raise ValueError(f"无法解析 clip {clip_id} 的视频 URL，请确保视频已上传到云端")
            
            # Step 1: 初始化视频 (0-10%)
            await self._update_status(task, ReplaceStatus.INITIALIZING, 5, "正在初始化视频...", progress_callback)
            
            try:
                init_result = await self.kling.init_video_selection(video_url=resolved_url)
            except Exception as e:
                error_str = str(e)
                # ★ 治本：解析 Kling API 的具体错误
                if "400" in error_str:
                    # 400 错误通常是参数问题
                    raise ValueError(f"视频不符合 Kling API 要求（需要 MP4/MOV 格式，2-5秒或7-10秒，720-2160px）: {error_str}")
                raise
                
            if init_result.get("code") != 0:
                error_msg = init_result.get("message", str(init_result))
                # 如果是时长限制问题，给出明确提示
                if "duration" in error_msg.lower() or "时长" in error_msg:
                    raise ValueError(f"视频时长不符合要求（需要2-5秒或7-10秒）: {error_msg}")
                raise ValueError(f"初始化视频失败: {error_msg}")
            
            data = init_result.get("data", {})
            task.session_id = data.get("session_id")
            video_duration_ms = data.get("original_duration", 0)
            video_duration = video_duration_ms / 1000  # ms -> s
            video_width = data.get("width", 720)
            video_height = data.get("height", 1280)
            logger.info(f"[VideoReplace] 初始化成功: session_id={task.session_id}, duration={video_duration}s, size={video_width}x{video_height}")
            
            # 计算目标 duration（必须匹配 API 要求：5 或 10）
            if video_duration <= 5:
                target_duration = "5"
            else:
                target_duration = "10"
            
            # Step 2: 选择人物区域（选中人物，让 AI 知道要保留什么）(10-25%)
            # 文档说明：选中的点会被识别为一个语义对象
            # 我们选中人物中心点，AI 会自动分割出整个人物
            await self._update_status(task, ReplaceStatus.SELECTING, 15, "正在识别人物区域...", progress_callback)
            
            # 在画面中心偏上位置标记人物（通常人物头部在这个区域）
            # 多个点帮助 AI 更好地识别整个人物
            person_points = [
                {"x": 0.5, "y": 0.3},   # 头部区域
                {"x": 0.5, "y": 0.5},   # 躯干区域
                {"x": 0.5, "y": 0.7},   # 下半身
            ]
            
            selection_result = await self.kling.add_video_selection(
                session_id=task.session_id,
                frame_index=0,
                points=person_points
            )
            
            if selection_result.get("code") != 0:
                logger.warning(f"[VideoReplace] 选区标记返回: {selection_result}")
            
            await self._update_status(task, ReplaceStatus.SELECTING, 25, "人物区域已识别", progress_callback)
            
            # Step 3: 调用替换 API (25-70%)
            await self._update_status(task, ReplaceStatus.PROCESSING, 30, "正在替换背景...", progress_callback)
            
            # 构建 swap 提示词 - 按文档格式
            # 文档要求：用 <<<video_1>>> 和 <<<image_1>>> 引用
            swap_prompt = f"使用<<<image_1>>>替换<<<video_1>>>中被选中区域之外的背景部分，保持被选中的人物完全不变"
            if prompt:
                swap_prompt += f"，背景风格：{prompt}"
            
            swap_result = await self.kling.create_multi_elements_task(
                session_id=task.session_id,
                edit_mode="swap",
                prompt=swap_prompt,
                options={
                    "image_list": [new_background_url],
                    "mode": "pro",  # 高质量模式
                    "duration": target_duration,  # 匹配原视频时长
                }
            )
            
            if swap_result.get("code") != 0:
                raise ValueError(f"创建替换任务失败: {swap_result}")
            
            task.task_id = swap_result.get("data", {}).get("task_id")
            logger.info(f"[VideoReplace] 替换任务已创建: task_id={task.task_id}")
            
            # Step 4: 轮询等待完成 (30-90%)
            result_video_url = await self._poll_task_completion(
                task, 
                progress_callback,
                start_progress=30,
                end_progress=90
            )
            
            # Step 5: 处理音频 (90-100%)
            await self._update_status(task, ReplaceStatus.MERGING, 95, "正在处理音频...", progress_callback)
            
            # 检查结果视频是否有音频，如果没有则合并原音频
            # 使用 resolved_url（已解析的公开 URL）而不是 video_url（可能是 localhost）
            final_url = await self._ensure_audio(
                task,
                result_video_url,
                resolved_url  # 使用已解析的 URL
            )
            
            # 完成
            task.result_video_url = final_url
            await self._update_status(task, ReplaceStatus.COMPLETED, 100, "替换完成！", progress_callback)
            
            return task
            
        except Exception as e:
            import traceback
            logger.error(f"[VideoReplace] 背景替换失败: {e}\n{traceback.format_exc()}")
            task.status = ReplaceStatus.FAILED
            task.error = str(e) if str(e) else repr(e)
            task.updated_at = datetime.utcnow()
            # ★★★ 治本修复：将失败状态同步到数据库 ★★★
            await self._update_task_in_db(task)
            if progress_callback:
                await progress_callback(task.progress, f"失败: {e}")
            raise
    
    async def replace_person(
        self,
        clip_id: str,
        video_url: str,
        new_person_url: str,
        original_audio_url: Optional[str] = None,
        prompt: Optional[str] = None,
        progress_callback: Optional[callable] = None
    ) -> ReplaceTask:
        """
        替换视频人物（策略B - 治本方案）
        
        使用 Kling Motion Control + Lip Sync API：
        1. Motion Control: 用原视频的动作驱动新人物图片
        2. Lip Sync: 用原音频驱动新人物的口型
        
        最终效果：新人物，原动作，原口型，原音频
        
        Args:
            clip_id: Clip ID
            video_url: 原视频 URL（作为动作参考）
            new_person_url: 新人物图片 URL
            original_audio_url: 原音频 URL（可选，不提供则从视频提取）
            prompt: 可选提示词
            progress_callback: 进度回调
            
        Returns:
            ReplaceTask: 替换任务
        """
        task = ReplaceTask(
            id=str(uuid.uuid4()),
            clip_id=clip_id,
            video_url=video_url,
            strategy=ReplaceStrategy.PERSON_REPLACE,
            status=ReplaceStatus.PENDING,
            progress=0,
            new_person_url=new_person_url,
            original_audio_url=original_audio_url,
            prompt=prompt,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        self._tasks[task.id] = task
        
        try:
            # Step 0: 解析视频 URL（将 localhost URL 转换为公开可访问的 URL）
            from app.services.background_replace_workflow import resolve_video_download_url
            
            resolved_url = video_url
            if "localhost" in video_url or "127.0.0.1" in video_url:
                logger.info(f"[VideoReplace] 检测到本地 URL，尝试解析: {video_url[:50]}...")
                resolved = await resolve_video_download_url(clip_id)
                if resolved:
                    resolved_url = resolved
                    logger.info(f"[VideoReplace] 解析成功: {resolved_url[:80]}...")
                else:
                    raise ValueError(f"无法解析 clip {clip_id} 的视频 URL，请确保视频已上传到云端")
            
            # Step 1: 提取原音频（如果未提供）(0-15%)
            if not original_audio_url:
                await self._update_status(task, ReplaceStatus.INITIALIZING, 5, "正在提取原音频...", progress_callback)
                original_audio_url = await self._extract_audio(resolved_url)
                task.original_audio_url = original_audio_url
            
            await self._update_status(task, ReplaceStatus.PROCESSING, 15, "正在进行动作迁移...", progress_callback)
            
            # Step 2: Motion Control - 用原视频动作驱动新人物 (15-60%)
            motion_result = await self.kling.create_motion_control_task(
                image_url=new_person_url,
                video_url=resolved_url,
                character_orientation="video",  # 人物朝向与视频一致
                mode="pro",  # 高质量模式
                options={
                    "keep_original_sound": "no",  # 先不要原声，后面用 lip sync
                    "prompt": prompt or "保持人物动作自然流畅"
                }
            )
            
            if motion_result.get("code") != 0:
                raise ValueError(f"创建动作迁移任务失败: {motion_result}")
            
            motion_task_id = motion_result.get("data", {}).get("task_id")
            logger.info(f"[VideoReplace] 动作迁移任务: task_id={motion_task_id}")
            
            # 轮询等待 Motion Control 完成
            motion_video_url = await self._poll_motion_control(
                motion_task_id,
                progress_callback,
                start_progress=20,
                end_progress=55
            )
            
            # Step 3: Lip Sync - 用原音频驱动口型 (60-90%)
            await self._update_status(task, ReplaceStatus.SYNCING_AUDIO, 60, "正在同步口型...", progress_callback)
            
            # 先识别人脸
            face_result = await self.kling.identify_face(video_url=motion_video_url)
            face_data = face_result.get("face_data", [])
            
            if not face_data:
                logger.warning("[VideoReplace] 未检测到人脸，跳过口型同步")
                final_video_url = motion_video_url
            else:
                # 创建口型同步任务
                session_id = face_result.get("session_id")
                face_id = face_data[0].get("face_id")
                
                lip_sync_result = await self.kling.create_lip_sync_task(
                    session_id=session_id,
                    face_id=face_id,
                    audio_url=original_audio_url,
                    original_audio_volume=0.0,  # 静音原视频音轨
                    sound_volume=1.0  # 使用原音频
                )
                
                lip_sync_task_id = lip_sync_result.get("task_id")
                logger.info(f"[VideoReplace] 口型同步任务: task_id={lip_sync_task_id}")
                
                # 轮询等待 Lip Sync 完成
                final_video_url = await self._poll_lip_sync(
                    lip_sync_task_id,
                    progress_callback,
                    start_progress=65,
                    end_progress=95
                )
            
            # Step 4: 完成 (95-100%)
            task.result_video_url = final_video_url
            await self._update_status(task, ReplaceStatus.COMPLETED, 100, "人物替换完成！", progress_callback)
            
            return task
            
        except Exception as e:
            logger.error(f"[VideoReplace] 人物替换失败: {e}")
            task.status = ReplaceStatus.FAILED
            task.error = str(e)
            task.updated_at = datetime.utcnow()
            # ★★★ 治本修复：将失败状态同步到数据库 ★★★
            await self._update_task_in_db(task)
            if progress_callback:
                await progress_callback(task.progress, f"失败: {e}")
            raise
    
    # ==========================================
    # 内部方法
    # ==========================================
    
    async def _update_status(
        self,
        task: ReplaceTask,
        status: ReplaceStatus,
        progress: int,
        message: str,
        callback: Optional[callable]
    ):
        """更新任务状态（内存 + 数据库）"""
        task.status = status
        task.progress = progress
        task.updated_at = datetime.utcnow()
        
        logger.info(f"[VideoReplace] [{task.id[:8]}] {status.value}: {progress}% - {message}")
        
        # 同步更新数据库（关键状态变化时）
        if status in (ReplaceStatus.PROCESSING, ReplaceStatus.COMPLETED, ReplaceStatus.FAILED):
            await self._update_task_in_db(task)
        
        if callback:
            try:
                await callback(progress, message)
            except Exception as e:
                logger.warning(f"[VideoReplace] 回调失败: {e}")
    
    async def _poll_task_completion(
        self,
        task: ReplaceTask,
        progress_callback: Optional[callable],
        start_progress: int,
        end_progress: int,
        max_wait_seconds: int = 300
    ) -> str:
        """轮询等待多模态编辑任务完成"""
        start_time = asyncio.get_event_loop().time()
        poll_interval = 5  # 5秒轮询一次
        
        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > max_wait_seconds:
                raise TimeoutError(f"任务超时 ({max_wait_seconds}秒)")
            
            # 计算进度
            progress_ratio = min(elapsed / max_wait_seconds, 0.95)
            current_progress = int(start_progress + (end_progress - start_progress) * progress_ratio)
            
            # 查询状态
            result = await self.kling.get_multi_elements_task(task.task_id)
            data = result.get("data", {})
            status = data.get("task_status")
            
            logger.info(f"[VideoReplace] 任务状态: {status}, 进度: {current_progress}%")
            
            if status == "succeed":
                videos = data.get("task_result", {}).get("videos", [])
                if videos:
                    return videos[0].get("url")
                raise ValueError("任务成功但未返回视频URL")
            
            elif status == "failed":
                error_msg = data.get("task_status_msg", "未知错误")
                raise ValueError(f"任务失败: {error_msg}")
            
            # 更新进度
            if progress_callback:
                await progress_callback(current_progress, "正在生成中...")
            
            await asyncio.sleep(poll_interval)
    
    async def _poll_motion_control(
        self,
        task_id: str,
        progress_callback: Optional[callable],
        start_progress: int,
        end_progress: int,
        max_wait_seconds: int = 300
    ) -> str:
        """轮询等待动作控制任务完成"""
        start_time = asyncio.get_event_loop().time()
        poll_interval = 5
        
        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > max_wait_seconds:
                raise TimeoutError(f"动作迁移超时 ({max_wait_seconds}秒)")
            
            progress_ratio = min(elapsed / max_wait_seconds, 0.95)
            current_progress = int(start_progress + (end_progress - start_progress) * progress_ratio)
            
            result = await self.kling.get_motion_control_task(task_id)
            data = result.get("data", {})
            status = data.get("task_status")
            
            if status == "succeed":
                videos = data.get("task_result", {}).get("videos", [])
                if videos:
                    return videos[0].get("url")
                raise ValueError("动作迁移成功但未返回视频URL")
            
            elif status == "failed":
                error_msg = data.get("task_status_msg", "未知错误")
                raise ValueError(f"动作迁移失败: {error_msg}")
            
            if progress_callback:
                await progress_callback(current_progress, "正在迁移动作...")
            
            await asyncio.sleep(poll_interval)
    
    async def _poll_lip_sync(
        self,
        task_id: str,
        progress_callback: Optional[callable],
        start_progress: int,
        end_progress: int,
        max_wait_seconds: int = 300
    ) -> str:
        """轮询等待口型同步任务完成"""
        start_time = asyncio.get_event_loop().time()
        poll_interval = 5
        
        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > max_wait_seconds:
                raise TimeoutError(f"口型同步超时 ({max_wait_seconds}秒)")
            
            progress_ratio = min(elapsed / max_wait_seconds, 0.95)
            current_progress = int(start_progress + (end_progress - start_progress) * progress_ratio)
            
            result = await self.kling.get_lip_sync_task(task_id)
            data = result.get("data", {}) if isinstance(result.get("data"), dict) else result
            status = data.get("task_status")
            
            if status == "succeed":
                videos = data.get("task_result", {}).get("videos", [])
                if videos:
                    return videos[0].get("url")
                raise ValueError("口型同步成功但未返回视频URL")
            
            elif status == "failed":
                error_msg = data.get("task_status_msg", "未知错误")
                raise ValueError(f"口型同步失败: {error_msg}")
            
            if progress_callback:
                await progress_callback(current_progress, "正在同步口型...")
            
            await asyncio.sleep(poll_interval)
    
    async def _extract_audio(self, video_url: str) -> str:
        """从视频中提取音频"""
        import subprocess
        
        # 下载视频
        response = await self.http_client.get(video_url)
        response.raise_for_status()
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as video_file:
            video_file.write(response.content)
            video_path = video_file.name
        
        # 提取音频
        audio_path = video_path.replace(".mp4", ".mp3")
        
        try:
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-vn",  # 不要视频
                "-acodec", "libmp3lame",
                "-ab", "128k",
                audio_path
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            
            # 上传到存储
            from .supabase_client import supabase
            
            storage_path = f"temp/audio/{uuid.uuid4()}.mp3"
            with open(audio_path, "rb") as f:
                supabase.storage.from_("ai-creations").upload(
                    storage_path,
                    f.read(),
                    file_options={"content-type": "audio/mpeg", "upsert": "true"}
                )
            
            audio_url = supabase.storage.from_("ai-creations").get_public_url(storage_path)
            logger.info(f"[VideoReplace] 音频提取完成: {audio_url}")
            
            return audio_url
            
        finally:
            # 清理临时文件
            try:
                os.unlink(video_path)
                os.unlink(audio_path)
            except:
                pass
    
    async def _ensure_audio(
        self,
        task: ReplaceTask,
        result_video_url: str,
        original_video_url: str
    ) -> str:
        """
        确保结果视频有音频
        
        如果 Kling 生成的视频没有音频，则提取原视频音频并合并
        """
        import subprocess
        
        logger.info(f"[VideoReplace] 检查视频音频...")
        
        try:
            # 下载结果视频
            response = await self.http_client.get(result_video_url, follow_redirects=True)
            response.raise_for_status()
            
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
                f.write(response.content)
                result_video_path = f.name
            
            # 检测是否有音频轨道
            check_cmd = [
                "ffprobe", "-v", "error",
                "-select_streams", "a",
                "-show_entries", "stream=codec_type",
                "-of", "default=noprint_wrappers=1:nokey=1",
                result_video_path
            ]
            check_result = subprocess.run(check_cmd, capture_output=True, text=True)
            has_audio = "audio" in check_result.stdout
            
            if has_audio:
                logger.info(f"[VideoReplace] 结果视频已有音频，无需合并")
                os.unlink(result_video_path)
                return result_video_url
            
            # 没有音频，需要从原视频提取并合并
            logger.info(f"[VideoReplace] 结果视频无音频，正在合并原视频音频...")
            
            # 下载原视频
            orig_response = await self.http_client.get(original_video_url, follow_redirects=True)
            orig_response.raise_for_status()
            
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
                f.write(orig_response.content)
                original_video_path = f.name
            
            # 合并音频
            output_path = result_video_path.replace(".mp4", "_with_audio.mp4")
            merge_cmd = [
                "ffmpeg", "-y",
                "-i", result_video_path,      # 新视频（无音频）
                "-i", original_video_path,     # 原视频（有音频）
                "-c:v", "copy",                # 复制视频流
                "-map", "0:v:0",               # 使用第一个输入的视频
                "-map", "1:a:0?",              # 使用第二个输入的音频（可选）
                "-shortest",                   # 取较短的时长
                output_path
            ]
            merge_result = subprocess.run(merge_cmd, capture_output=True)
            
            if merge_result.returncode != 0:
                logger.warning(f"[VideoReplace] 音频合并失败: {merge_result.stderr.decode()[:200]}")
                # 合并失败，返回原结果
                os.unlink(result_video_path)
                os.unlink(original_video_path)
                return result_video_url
            
            # 上传合并后的视频
            from .supabase_client import supabase
            
            storage_path = f"ai-videos/{task.clip_id}/{uuid.uuid4()}.mp4"
            with open(output_path, "rb") as f:
                supabase.storage.from_("ai-creations").upload(
                    storage_path,
                    f.read(),
                    file_options={"content-type": "video/mp4", "upsert": "true"}
                )
            
            final_url = supabase.storage.from_("ai-creations").get_public_url(storage_path)
            logger.info(f"[VideoReplace] 音频合并完成: {final_url}")
            
            # 清理临时文件
            for path in [result_video_path, original_video_path, output_path]:
                try:
                    os.unlink(path)
                except:
                    pass
            
            return final_url
            
        except Exception as e:
            logger.warning(f"[VideoReplace] 音频处理失败，返回原结果: {e}")
            return result_video_url
    
    # ==========================================
    # 任务管理
    # ==========================================
    
    def get_task(self, task_id: str) -> Optional[ReplaceTask]:
        """获取任务"""
        return self._tasks.get(task_id)
    
    def list_tasks(self, clip_id: str = None) -> List[ReplaceTask]:
        """列出任务"""
        tasks = list(self._tasks.values())
        if clip_id:
            tasks = [t for t in tasks if t.clip_id == clip_id]
        return sorted(tasks, key=lambda t: t.created_at, reverse=True)


# ==========================================
# 单例
# ==========================================

_service: Optional[VideoElementReplaceService] = None


def get_video_element_replace_service() -> VideoElementReplaceService:
    """获取视频元素替换服务单例"""
    global _service
    if _service is None:
        _service = VideoElementReplaceService()
    return _service
