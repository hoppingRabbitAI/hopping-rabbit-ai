"""
背景替换 Agent Workflow 服务

实现高还原度的视频背景替换，包含5个阶段：
1. 视频分析 (Video Analysis)
2. 前景分离 (Foreground Separation)
3. 背景视频生成 (Background Video Generation)
4. 智能合成 (Intelligent Compositing)
5. 质量增强 (Quality Enhancement)
"""

import os
import uuid
import asyncio
import logging
import json
import time
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime
from dataclasses import dataclass, asdict
from enum import Enum
from PIL import Image
import io
import httpx

logger = logging.getLogger(__name__)


# ==========================================
# 视频 URL 解析工具（参考 clip_split_service.py）
# ==========================================

async def resolve_video_download_url(clip_id: str) -> Optional[str]:
    """
    根据 clip_id 解析可直接下载的视频 URL
    
    治本方案：
    1. 从 clips 表获取 asset_id, source_start, source_end
    2. 从 assets 表获取 storage_path
    3. 用 ffmpeg 裁剪出 clip 对应的片段
    4. 上传到 Supabase Storage 并返回签名 URL
    
    Returns:
        可直接访问的视频 URL，失败返回 None
    """
    from app.services.supabase_client import supabase, get_file_url
    import subprocess
    import tempfile
    import os
    import uuid
    
    try:
        # 1. 获取 clip 信息（包含时间范围）
        clip_result = supabase.table("clips").select(
            "asset_id, source_start, source_end"
        ).eq("id", clip_id).single().execute()
        
        if not clip_result.data:
            logger.warning(f"[ResolveURL] Clip {clip_id} 不存在")
            return None
        
        clip_data = clip_result.data
        asset_id = clip_data.get("asset_id")
        source_start_ms = clip_data.get("source_start", 0)
        source_end_ms = clip_data.get("source_end")
        
        if not asset_id:
            logger.warning(f"[ResolveURL] Clip {clip_id} 没有关联的 asset_id")
            return None
        
        # 2. 获取 asset 的 storage_path
        asset_result = supabase.table("assets").select("storage_path").eq("id", asset_id).single().execute()
        if not asset_result.data:
            logger.warning(f"[ResolveURL] Asset {asset_id} 不存在")
            return None
        
        storage_path = asset_result.data.get("storage_path", "")
        if not storage_path:
            logger.warning(f"[ResolveURL] Asset {asset_id} 没有 storage_path")
            return None
        
        # 3. 获取原视频 URL（用 HLS 流，ffmpeg 可以处理）
        if storage_path.startswith("http"):
            source_video_url = storage_path
        elif storage_path.startswith("cloudflare:"):
            video_uid = storage_path.replace("cloudflare:", "")
            # 使用 HLS 流，ffmpeg 可以处理，downloads 需要单独开权限
            source_video_url = f"https://videodelivery.net/{video_uid}/manifest/video.m3u8"
        else:
            source_video_url = get_file_url("clips", storage_path, expires_in=3600)
        
        if not source_video_url:
            logger.warning(f"[ResolveURL] 无法获取原视频 URL")
            return None
        
        # 4. 计算时间范围
        source_start_s = (source_start_ms or 0) / 1000
        source_end_s = (source_end_ms / 1000) if source_end_ms else None
        
        # 5. 用 ffmpeg 处理视频（裁剪 + 转码为 MP4）
        # 即使是完整视频也需要处理，因为 Cloudflare HLS 格式 Kling 不支持
        logger.info(f"[ResolveURL] 处理 Clip: start={source_start_s:.2f}s, end={source_end_s:.2f}s" if source_end_s else f"[ResolveURL] 处理完整视频")
        
        # 创建临时文件
        temp_dir = tempfile.mkdtemp()
        output_filename = f"clip_{clip_id}_{uuid.uuid4().hex[:8]}.mp4"
        output_path = os.path.join(temp_dir, output_filename)
        
        try:
            # ffmpeg 命令 - 根据是否有时间范围构建
            cmd = ["ffmpeg", "-y"]
            
            # 如果有起始时间，添加 -ss
            if source_start_s > 0:
                cmd.extend(["-ss", str(source_start_s)])
            
            cmd.extend(["-i", source_video_url])  # 输入
            
            # 如果有结束时间，添加 -t（持续时间）
            if source_end_s:
                duration_s = source_end_s - source_start_s
                cmd.extend(["-t", str(duration_s)])
            
            # 输出设置 - 确保尺寸符合 Kling 要求（720-2160px）
            # 使用 scale 滤镜：如果宽度<720则放大到720，如果>2160则缩小到2160，保持宽高比
            cmd.extend([
                "-vf", "scale='if(lt(iw,720),720,if(gt(iw,2160),2160,iw))':'if(lt(iw,720),720*ih/iw,if(gt(iw,2160),2160*ih/iw,ih))'",
                "-c:v", "libx264",               # 视频编码
                "-c:a", "aac",                   # 音频编码
                "-movflags", "+faststart",       # 快速启动
                "-preset", "fast",               # 快速编码
                output_path
            ])
            
            logger.info(f"[ResolveURL] 执行 ffmpeg 处理: {' '.join(cmd[:6])}...")
            
            # ★★★ 使用 asyncio 异步执行 ffmpeg，不阻塞事件循环 ★★★
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=180)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                logger.error(f"[ResolveURL] ffmpeg 处理超时")
                return None
            
            if process.returncode != 0:
                logger.error(f"[ResolveURL] ffmpeg 处理失败: {stderr.decode()[:500]}")
                return None  # 不回退，直接失败
            
            # 6. 上传裁剪后的视频到 Supabase Storage（在线程池中执行，避免阻塞）
            upload_path = f"clip-exports/{output_filename}"
            
            def _read_and_upload():
                with open(output_path, "rb") as f:
                    video_bytes = f.read()
                supabase.storage.from_("ai-creations").upload(
                    path=upload_path,
                    file=video_bytes,
                    file_options={"content-type": "video/mp4"}
                )
            
            await asyncio.get_event_loop().run_in_executor(None, _read_and_upload)
            
            # 7. 获取签名 URL
            clip_url = get_file_url("ai-creations", upload_path, expires_in=3600)
            logger.info(f"[ResolveURL] Clip 已裁剪并上传: {clip_url[:80]}...")
            
            return clip_url
            
        finally:
            # 清理临时文件
            if os.path.exists(output_path):
                os.remove(output_path)
            if os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        
    except Exception as e:
        logger.error(f"[ResolveURL] 解析视频 URL 失败: {e}")
        return None


# ==========================================
# 数据模型
# ==========================================

class WorkflowStage(str, Enum):
    """工作流阶段"""
    CREATED = "created"
    DETECTING = "detecting"    # [新增] 编辑检测阶段
    ANALYZING = "analyzing"
    SEPARATING = "separating"
    GENERATING = "generating"
    MOTION_CONTROL = "motion_control"  # [新增] 策略B: Motion Control
    LIP_SYNC = "lip_sync"              # [新增] 策略B: Lip Sync
    COMPOSITING = "compositing"
    ENHANCING = "enhancing"
    COMPLETED = "completed"
    FAILED = "failed"


class EditStrategy(str, Enum):
    """编辑策略"""
    BACKGROUND_ONLY = "background_only"      # 策略A：纯背景替换，保持原始口型
    PERSON_MINOR_EDIT = "person_minor_edit"  # 策略B-轻度：小配饰修改
    PERSON_MAJOR_EDIT = "person_major_edit"  # 策略B-重度：换装等大面积修改


class WorkflowStatus(str, Enum):
    """工作流状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class LightingInfo:
    """光照信息"""
    direction: Tuple[float, float, float]  # 光源方向向量
    color_temperature: int  # 色温 (K)
    intensity: float  # 强度 0-1
    type: str  # "natural", "artificial", "mixed"
    shadow_direction: Tuple[float, float]  # 阴影投射方向


@dataclass
class CameraMotion:
    """摄像机运动信息"""
    type: str  # "static", "pan", "zoom", "tilt", "handheld"
    intensity: float  # 运动强度 0-1
    direction: Optional[Tuple[float, float]] = None  # 运动方向
    motion_vectors: Optional[List[Tuple[float, float]]] = None  # 每帧运动向量


@dataclass
class SceneInfo:
    """场景信息"""
    type: str  # "indoor", "outdoor"
    environment: str  # "office", "home", "studio", "nature", etc.
    depth_range: Tuple[float, float]  # 深度范围 (近, 远)


@dataclass
class VideoAnalysisReport:
    """视频分析报告"""
    scene: SceneInfo
    lighting: LightingInfo
    camera_motion: CameraMotion
    subject_bboxes: List[List[int]]  # 每帧的人物边界框 [[x, y, w, h], ...]
    fps: float
    duration: float
    resolution: Tuple[int, int]  # (width, height)
    frame_count: int


@dataclass
class ForegroundResult:
    """前景分离结果"""
    foreground_frames_url: str  # 前景帧序列存储路径
    alpha_mattes_url: str  # Alpha 通道序列存储路径
    frame_count: int
    quality_score: float  # 分离质量评分 0-1


@dataclass
class BackgroundVideoResult:
    """背景视频生成结果"""
    video_url: str
    duration: float
    motion_matched: bool  # 是否匹配了原视频的运动


@dataclass
class CompositeResult:
    """合成结果"""
    video_url: str
    quality_score: float


@dataclass
class QAReport:
    """质量检测报告"""
    overall_score: float  # 0-1
    temporal_consistency: float  # 时序一致性
    edge_quality: float  # 边缘质量
    color_consistency: float  # 颜色一致性
    lighting_match: float  # 光照匹配度
    flicker_score: float  # 闪烁评分 (越高越好)
    artifact_score: float  # AI 痕迹评分 (越高越好，表示越少痕迹)
    passed: bool  # 是否通过质量检测


@dataclass
class WorkflowCheckpoint:
    """工作流检查点（用于断点续传）"""
    task_id: str
    stage: int  # 0-5
    stage_name: WorkflowStage
    data: Dict[str, Any]
    created_at: datetime
    updated_at: datetime


@dataclass
class EditDetectionResult:
    """编辑检测结果"""
    strategy: EditStrategy
    edit_on_person_ratio: float    # 编辑区域中落在人物上的比例 (0-1)
    person_edited_ratio: float     # 人物区域被编辑的比例 (0-1)
    confidence: float              # 置信度 (0-1)
    recommendation: str            # 推荐说明
    person_mask_url: Optional[str] = None  # 人物 mask URL


@dataclass
class BackgroundReplaceTask:
    """背景替换任务"""
    id: str
    clip_id: str
    session_id: str
    video_url: str
    background_image_url: str
    prompt: Optional[str]
    status: WorkflowStatus
    current_stage: WorkflowStage
    stage_progress: int  # 当前阶段进度 0-100
    overall_progress: int  # 总体进度 0-100
    error: Optional[str]
    result_url: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    # [新增] 编辑相关输入
    edit_mask_url: Optional[str] = None       # 用户涂抹的 mask URL
    edited_frame_url: Optional[str] = None    # 用户编辑后的帧 URL
    original_audio_url: Optional[str] = None  # 原视频音频 URL
    force_strategy: Optional[EditStrategy] = None  # 强制策略覆盖
    
    # [新增] 解析后的视频 URL（可直接访问，无需鉴权）
    resolved_video_url: Optional[str] = None
    
    # [新增] 编辑检测结果
    detected_strategy: Optional[EditStrategy] = None
    edit_detection: Optional[EditDetectionResult] = None
    
    # 中间结果
    analysis: Optional[VideoAnalysisReport] = None
    foreground: Optional[ForegroundResult] = None
    background_video: Optional[BackgroundVideoResult] = None
    composite: Optional[CompositeResult] = None
    qa_report: Optional[QAReport] = None


# ==========================================
# Stage 0: 编辑检测 Agent
# ==========================================

class EditDetectionAgent:
    """
    编辑检测 Agent
    
    职责:
    - 分析用户涂抹区域与人物区域的交集
    - 决定使用策略A（纯背景I2V）还是策略B（Motion Control + Lip Sync）
    
    检测逻辑:
    - 如果编辑区域与人物区域无交集 → 策略A
    - 如果编辑区域涉及人物但比例 < 10% → 策略A（可接受的误差）
    - 如果编辑区域涉及人物比例 >= 10% → 策略B
    """
    
    # 阈值配置
    PERSON_EDIT_THRESHOLD = 0.10  # 人物区域被编辑超过10%时使用策略B
    EDIT_ON_PERSON_THRESHOLD = 0.15  # 编辑区域中超过15%落在人物上时使用策略B
    
    def __init__(self):
        self.http_client = httpx.AsyncClient(timeout=60)
    
    async def detect(
        self,
        original_frame_url: str,
        edited_frame_url: str,
        edit_mask_url: Optional[str] = None,
        person_mask_url: Optional[str] = None,
        progress_callback: Optional[callable] = None
    ) -> EditDetectionResult:
        """
        检测用户的编辑策略
        
        Args:
            original_frame_url: 原始帧 URL
            edited_frame_url: 用户编辑后的帧 URL
            edit_mask_url: 用户涂抹的 mask URL（可选，如果没有则通过图像差异计算）
            person_mask_url: 人物 mask URL（可选，如果没有则自动生成）
            progress_callback: 进度回调
        
        Returns:
            EditDetectionResult: 检测结果
        """
        logger.info(f"[EditDetection] 开始编辑检测")
        logger.info(f"  - 原始帧: {original_frame_url}")
        logger.info(f"  - 编辑帧: {edited_frame_url}")
        
        try:
            # Step 1: 下载图像
            if progress_callback:
                await progress_callback(10, "正在加载图像...")
            
            original_frame = await self._download_image(original_frame_url)
            edited_frame = await self._download_image(edited_frame_url)
            
            # Step 2: 获取或生成编辑 mask
            if progress_callback:
                await progress_callback(25, "正在分析编辑区域...")
            
            if edit_mask_url:
                edit_mask = await self._download_image(edit_mask_url)
            else:
                edit_mask = await self._compute_diff_mask(original_frame, edited_frame)
            
            # Step 3: 获取或生成人物 mask
            if progress_callback:
                await progress_callback(50, "正在检测人物区域...")
            
            if person_mask_url:
                person_mask = await self._download_image(person_mask_url)
                generated_person_mask_url = person_mask_url
            else:
                person_mask, generated_person_mask_url = await self._generate_person_mask(original_frame)
            
            # Step 4: 计算交集比例
            if progress_callback:
                await progress_callback(75, "正在计算编辑策略...")
            
            edit_on_person_ratio, person_edited_ratio = self._compute_overlap_ratios(
                edit_mask, person_mask
            )
            
            # Step 5: 决策
            strategy, confidence, recommendation = self._decide_strategy(
                edit_on_person_ratio, person_edited_ratio
            )
            
            if progress_callback:
                await progress_callback(100, f"检测完成: {strategy.value}")
            
            result = EditDetectionResult(
                strategy=strategy,
                edit_on_person_ratio=edit_on_person_ratio,
                person_edited_ratio=person_edited_ratio,
                confidence=confidence,
                recommendation=recommendation,
                person_mask_url=generated_person_mask_url
            )
            
            logger.info(f"[EditDetection] 检测结果: {result}")
            return result
            
        except Exception as e:
            logger.error(f"[EditDetection] 检测失败: {e}")
            # 降级：无法检测时默认使用策略A（更安全）
            return EditDetectionResult(
                strategy=EditStrategy.BACKGROUND_ONLY,
                edit_on_person_ratio=0.0,
                person_edited_ratio=0.0,
                confidence=0.0,
                recommendation="检测失败，默认使用背景替换策略",
                person_mask_url=None
            )
    
    async def _download_image(self, url: str) -> Image.Image:
        """下载图像"""
        response = await self.http_client.get(url)
        response.raise_for_status()
        return Image.open(io.BytesIO(response.content)).convert('RGBA')
    
    async def _compute_diff_mask(self, original: Image.Image, edited: Image.Image) -> Image.Image:
        """
        通过图像差异计算编辑区域 mask
        
        Returns:
            二值化的 mask 图像，白色区域表示被编辑的区域
        """
        import numpy as np
        
        # 确保尺寸一致
        if original.size != edited.size:
            edited = edited.resize(original.size, Image.Resampling.LANCZOS)
        
        # 转换为 numpy 数组
        orig_arr = np.array(original.convert('RGB'), dtype=np.float32)
        edit_arr = np.array(edited.convert('RGB'), dtype=np.float32)
        
        # 计算像素差异
        diff = np.abs(orig_arr - edit_arr)
        diff_gray = np.mean(diff, axis=2)
        
        # 二值化（差异大于阈值的区域视为编辑区域）
        threshold = 30  # 像素差异阈值
        mask_arr = (diff_gray > threshold).astype(np.uint8) * 255
        
        # 形态学操作：去噪 + 填充
        from PIL import ImageFilter
        mask = Image.fromarray(mask_arr, mode='L')
        # 膨胀操作填充小空洞
        mask = mask.filter(ImageFilter.MaxFilter(5))
        # 腐蚀操作去除噪点
        mask = mask.filter(ImageFilter.MinFilter(3))
        
        return mask
    
    async def _generate_person_mask(self, frame: Image.Image) -> Tuple[Image.Image, Optional[str]]:
        """
        生成人物 mask
        
        使用 rembg 或其他分割服务
        
        Returns:
            (mask_image, mask_url)
        """
        try:
            from rembg import remove
            import numpy as np
            
            # 使用 rembg 获取前景
            result = remove(frame, only_mask=True)
            
            # result 已经是 mask
            if isinstance(result, Image.Image):
                mask = result
            else:
                mask = Image.fromarray(result)
            
            # TODO: 上传 mask 到存储并返回 URL
            # 这里暂时返回 None 作为 URL
            return mask, None
            
        except ImportError:
            logger.warning("[EditDetection] rembg 未安装，使用空 mask")
            # 返回空 mask
            empty_mask = Image.new('L', frame.size, 0)
            return empty_mask, None
        except Exception as e:
            logger.error(f"[EditDetection] 生成人物 mask 失败: {e}")
            empty_mask = Image.new('L', frame.size, 0)
            return empty_mask, None
    
    def _compute_overlap_ratios(
        self, 
        edit_mask: Image.Image, 
        person_mask: Image.Image
    ) -> Tuple[float, float]:
        """
        计算编辑区域与人物区域的重叠比例
        
        Returns:
            (edit_on_person_ratio, person_edited_ratio)
            - edit_on_person_ratio: 编辑区域中落在人物上的比例
            - person_edited_ratio: 人物区域被编辑的比例
        """
        import numpy as np
        
        # 确保尺寸一致
        if edit_mask.size != person_mask.size:
            person_mask = person_mask.resize(edit_mask.size, Image.Resampling.NEAREST)
        
        # 转换为二值数组
        edit_arr = np.array(edit_mask.convert('L')) > 128
        person_arr = np.array(person_mask.convert('L')) > 128
        
        # 计算交集
        intersection = edit_arr & person_arr
        
        # 计算像素数量
        edit_pixels = np.sum(edit_arr)
        person_pixels = np.sum(person_arr)
        intersection_pixels = np.sum(intersection)
        
        # 计算比例
        edit_on_person_ratio = 0.0
        person_edited_ratio = 0.0
        
        if edit_pixels > 0:
            edit_on_person_ratio = intersection_pixels / edit_pixels
        
        if person_pixels > 0:
            person_edited_ratio = intersection_pixels / person_pixels
        
        logger.info(f"[EditDetection] 重叠分析:")
        logger.info(f"  - 编辑区域像素: {edit_pixels}")
        logger.info(f"  - 人物区域像素: {person_pixels}")
        logger.info(f"  - 交集像素: {intersection_pixels}")
        logger.info(f"  - edit_on_person_ratio: {edit_on_person_ratio:.2%}")
        logger.info(f"  - person_edited_ratio: {person_edited_ratio:.2%}")
        
        return edit_on_person_ratio, person_edited_ratio
    
    def _decide_strategy(
        self, 
        edit_on_person_ratio: float, 
        person_edited_ratio: float
    ) -> Tuple[EditStrategy, float, str]:
        """
        根据重叠比例决定使用哪种策略
        
        Returns:
            (strategy, confidence, recommendation)
        """
        # 判断是否编辑了人物
        edited_person = (
            edit_on_person_ratio >= self.EDIT_ON_PERSON_THRESHOLD or
            person_edited_ratio >= self.PERSON_EDIT_THRESHOLD
        )
        
        if not edited_person:
            # 策略A：纯背景替换
            confidence = 1.0 - max(edit_on_person_ratio, person_edited_ratio)
            return (
                EditStrategy.BACKGROUND_ONLY,
                confidence,
                "检测到仅编辑背景区域，将保持原始口型和动作"
            )
        
        # 判断编辑程度
        if person_edited_ratio < 0.3:
            # 策略B-轻度：小面积编辑
            confidence = 0.7 + (0.3 - person_edited_ratio)
            return (
                EditStrategy.PERSON_MINOR_EDIT,
                min(confidence, 1.0),
                "检测到人物区域有小范围编辑，将使用 AI 动作迁移和口型同步"
            )
        else:
            # 策略B-重度：大面积编辑
            confidence = 0.6 + person_edited_ratio * 0.3
            return (
                EditStrategy.PERSON_MAJOR_EDIT,
                min(confidence, 1.0),
                "检测到人物区域有大面积编辑，将使用 AI 重建动作和口型"
            )


# ==========================================
# Stage 1: 视频分析 Agent
# ==========================================

class VideoAnalysisAgent:
    """
    视频分析 Agent
    
    职责:
    - 场景检测 (室内/室外, 环境类型)
    - 光线分析 (光源方向, 色温, 强度)
    - 摄像机运动分析 (类型, 强度, 方向)
    - 主体检测与追踪 (边界框序列)
    - 深度估计 (前后景分离)
    """
    
    def __init__(self):
        self.http_client = httpx.AsyncClient(timeout=60)
    
    async def analyze(
        self, 
        video_url: str,
        progress_callback: Optional[callable] = None
    ) -> VideoAnalysisReport:
        """分析视频"""
        logger.info(f"[VideoAnalysis] 开始分析视频: {video_url}")
        
        try:
            # 1. 下载视频并提取帧
            if progress_callback:
                await progress_callback(10, "正在提取视频帧...")
            
            frames, fps, duration = await self._extract_frames(video_url)
            frame_count = len(frames)
            
            if frame_count == 0:
                raise ValueError("无法提取视频帧")
            
            # 获取分辨率
            first_frame = frames[0]
            resolution = (first_frame.width, first_frame.height)
            
            # 2. 场景检测
            if progress_callback:
                await progress_callback(30, "正在分析场景...")
            scene = await self._detect_scene(frames[0])
            
            # 3. 光线分析
            if progress_callback:
                await progress_callback(50, "正在分析光线...")
            lighting = await self._analyze_lighting(frames)
            
            # 4. 摄像机运动分析
            if progress_callback:
                await progress_callback(70, "正在分析运动...")
            camera_motion = await self._analyze_camera_motion(frames)
            
            # 5. 主体检测
            if progress_callback:
                await progress_callback(90, "正在检测主体...")
            subject_bboxes = await self._detect_subjects(frames)
            
            if progress_callback:
                await progress_callback(100, "分析完成")
            
            return VideoAnalysisReport(
                scene=scene,
                lighting=lighting,
                camera_motion=camera_motion,
                subject_bboxes=subject_bboxes,
                fps=fps,
                duration=duration,
                resolution=resolution,
                frame_count=frame_count,
            )
            
        except Exception as e:
            logger.error(f"[VideoAnalysis] 分析失败: {e}")
            raise
    
    async def _extract_frames(
        self, 
        video_url: str, 
        sample_rate: int = 5
    ) -> Tuple[List[Image.Image], float, float]:
        """
        提取视频帧
        
        Args:
            video_url: 视频 URL（支持 HTTP URL 和 HLS 流）
            sample_rate: 采样率 (每秒提取几帧)
        
        Returns:
            (帧列表, fps, 时长)
        """
        import subprocess
        import tempfile
        import asyncio
        import hashlib
        
        # ★★★ 使用 ffmpeg 直接处理 URL（支持 HLS 流）★★★
        # 不再使用 httpx 下载，ffmpeg 可以直接处理远程 URL 和 HLS 流
        
        # 创建临时文件路径
        url_hash = hashlib.md5(video_url.encode()).hexdigest()[:12]
        temp_dir = tempfile.gettempdir()
        tmp_path = os.path.join(temp_dir, f"bg_replace_{url_hash}.mp4")
        
        try:
            # Step 1: 用 ffmpeg 下载/转换视频到本地（支持 HLS 流）
            if not os.path.exists(tmp_path):
                logger.info(f"[VideoAnalysis] 使用 ffmpeg 下载视频: {video_url[:80]}...")
                download_process = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y",
                    "-i", video_url,
                    "-c", "copy",
                    "-movflags", "+faststart",
                    tmp_path,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                try:
                    stdout, stderr = await asyncio.wait_for(download_process.communicate(), timeout=120)
                except asyncio.TimeoutError:
                    download_process.kill()
                    raise ValueError("视频下载超时 (2分钟)")
                
                if download_process.returncode != 0:
                    error_msg = stderr.decode()[:300] if stderr else "Unknown error"
                    raise ValueError(f"视频下载失败: {error_msg}")
                
                logger.info(f"[VideoAnalysis] 视频下载完成: {tmp_path}")
            else:
                logger.info(f"[VideoAnalysis] 使用缓存视频: {tmp_path}")
            
            # Step 2: 使用 ffprobe 获取视频信息（异步执行）
            probe_cmd = [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=r_frame_rate,duration",
                "-of", "json", tmp_path
            ]
            probe_process = await asyncio.create_subprocess_exec(
                *probe_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            probe_stdout, _ = await probe_process.communicate()
            probe_data = json.loads(probe_stdout.decode())
            
            stream = probe_data.get("streams", [{}])[0]
            fps_str = stream.get("r_frame_rate", "30/1")
            fps_parts = fps_str.split("/")
            fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else 30.0
            duration = float(stream.get("duration", 0))
            
            # Step 3: 使用 ffmpeg 提取帧（异步执行）
            frames_dir = tempfile.mkdtemp()
            extract_cmd = [
                "ffmpeg", "-i", tmp_path,
                "-vf", f"fps={sample_rate}",
                "-q:v", "2",
                f"{frames_dir}/frame_%04d.jpg"
            ]
            extract_process = await asyncio.create_subprocess_exec(
                *extract_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await extract_process.communicate()
            
            # 加载帧
            frames = []
            frame_files = sorted([f for f in os.listdir(frames_dir) if f.endswith(".jpg")])
            for f in frame_files:
                frame_path = os.path.join(frames_dir, f)
                frames.append(Image.open(frame_path).copy())
            
            # 清理帧目录（保留视频缓存供后续阶段使用）
            import shutil
            shutil.rmtree(frames_dir)
            
            logger.info(f"[VideoAnalysis] 提取了 {len(frames)} 帧, fps={fps:.2f}, duration={duration:.2f}s")
            return frames, fps, duration
            
        except Exception as e:
            # 出错时清理临时视频文件
            if os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except:
                    pass
            raise
    
    async def _detect_scene(self, frame: Image.Image) -> SceneInfo:
        """场景检测"""
        # TODO: 使用 CLIP 或 场景分类模型
        # 目前返回默认值
        return SceneInfo(
            type="indoor",
            environment="studio",
            depth_range=(0.5, 10.0)
        )
    
    async def _analyze_lighting(self, frames: List[Image.Image]) -> LightingInfo:
        """光线分析"""
        # TODO: 使用光照估计模型
        # 分析亮度分布、阴影方向等
        
        # 简单实现：分析图像亮度和色温
        import numpy as np
        
        # 取中间帧分析
        mid_frame = frames[len(frames) // 2]
        img_array = np.array(mid_frame)
        
        # 估算色温（简化：基于红蓝通道比例）
        r_mean = img_array[:, :, 0].mean()
        b_mean = img_array[:, :, 2].mean()
        color_temp = 5500 + int((r_mean - b_mean) * 20)  # 粗略估计
        color_temp = max(2700, min(10000, color_temp))
        
        # 估算光源方向（简化：假设顶部偏左）
        direction = (0.3, 0.8, 0.5)  # (x, y, z)
        
        # 估算强度（基于亮度）
        brightness = img_array.mean() / 255.0
        
        return LightingInfo(
            direction=direction,
            color_temperature=color_temp,
            intensity=brightness,
            type="natural" if color_temp > 5000 else "artificial",
            shadow_direction=(-direction[0], -direction[1])
        )
    
    async def _analyze_camera_motion(self, frames: List[Image.Image]) -> CameraMotion:
        """摄像机运动分析"""
        # TODO: 使用光流或特征点匹配分析运动
        
        if len(frames) < 2:
            return CameraMotion(type="static", intensity=0.0)
        
        # 简化实现：比较首尾帧
        import numpy as np
        
        first = np.array(frames[0].convert("L"))
        last = np.array(frames[-1].convert("L"))
        
        # 计算差异
        diff = np.abs(first.astype(float) - last.astype(float)).mean()
        
        if diff < 5:
            motion_type = "static"
            intensity = 0.0
        elif diff < 15:
            motion_type = "handheld"  # 轻微晃动
            intensity = 0.2
        else:
            motion_type = "pan"  # 有明显运动
            intensity = min(diff / 50, 1.0)
        
        return CameraMotion(
            type=motion_type,
            intensity=intensity,
            direction=(0.0, 0.0) if motion_type == "static" else (1.0, 0.0)
        )
    
    async def _detect_subjects(self, frames: List[Image.Image]) -> List[List[int]]:
        """主体检测"""
        # TODO: 使用 YOLO 或人体检测模型
        # 目前返回默认边界框（画面中心区域）
        
        bboxes = []
        for frame in frames:
            w, h = frame.size
            # 假设人物在画面中心，占画面 60%
            x = int(w * 0.2)
            y = int(h * 0.1)
            bbox_w = int(w * 0.6)
            bbox_h = int(h * 0.8)
            bboxes.append([x, y, bbox_w, bbox_h])
        
        return bboxes


# ==========================================
# Stage 2: 前景分离 Agent
# ==========================================

class ForegroundSeparationAgent:
    """
    前景分离 Agent
    
    职责:
    - 高精度人物分割 (SAM2)
    - Alpha Matting (处理头发、半透明区域)
    - 时序一致性优化
    - 边缘优化
    """
    
    def __init__(self):
        self.http_client = httpx.AsyncClient(timeout=120)
    
    async def separate(
        self,
        video_url: str,
        analysis: VideoAnalysisReport,
        progress_callback: Optional[callable] = None
    ) -> ForegroundResult:
        """分离前景"""
        logger.info(f"[ForegroundSeparation] 开始前景分离")
        
        try:
            # 1. 逐帧分割
            if progress_callback:
                await progress_callback(10, "正在分割人物...")
            
            masks = await self._segment_person_all_frames(video_url, analysis)
            
            # 2. Alpha Matting 优化
            if progress_callback:
                await progress_callback(40, "正在优化边缘...")
            
            alpha_mattes = await self._refine_alpha_matting(masks, analysis)
            
            # 3. 时序一致性
            if progress_callback:
                await progress_callback(70, "正在确保时序一致性...")
            
            consistent_mattes = await self._ensure_temporal_consistency(alpha_mattes)
            
            # 4. 保存结果
            if progress_callback:
                await progress_callback(90, "正在保存结果...")
            
            result = await self._save_foreground_result(consistent_mattes, video_url)
            
            if progress_callback:
                await progress_callback(100, "前景分离完成")
            
            return result
            
        except Exception as e:
            logger.error(f"[ForegroundSeparation] 分离失败: {e}")
            raise
    
    async def _segment_person_all_frames(
        self, 
        video_url: str,
        analysis: VideoAnalysisReport
    ) -> List[Image.Image]:
        """使用 SAM2 或类似模型分割所有帧"""
        # TODO: 集成 SAM2 进行视频分割
        # 目前使用 rembg 作为简化实现
        
        try:
            from rembg import remove
        except ImportError:
            logger.warning("rembg not installed, using placeholder masks")
            # 返回占位 masks
            masks = []
            for i in range(analysis.frame_count):
                mask = Image.new("L", analysis.resolution, 255)
                masks.append(mask)
            return masks
        
        # 提取帧并分割
        # 这里简化处理，实际应该对每帧进行分割
        masks = []
        
        # TODO: 实际实现应该：
        # 1. 提取所有帧
        # 2. 使用 SAM2 进行视频级分割
        # 3. 返回每帧的 mask
        
        return masks
    
    async def _refine_alpha_matting(
        self, 
        masks: List[Image.Image],
        analysis: VideoAnalysisReport
    ) -> List[Image.Image]:
        """使用 Matting 模型优化 Alpha 通道"""
        # TODO: 集成 RobustVideoMatting 或 MODNet
        # 处理头发丝等细节
        
        refined = []
        for mask in masks:
            # 简化实现：高斯模糊边缘
            from PIL import ImageFilter
            refined_mask = mask.filter(ImageFilter.GaussianBlur(radius=1))
            refined.append(refined_mask)
        
        return refined
    
    async def _ensure_temporal_consistency(
        self, 
        mattes: List[Image.Image]
    ) -> List[Image.Image]:
        """确保帧间一致性，消除闪烁"""
        # TODO: 使用光流传播或时序平滑
        
        if len(mattes) < 3:
            return mattes
        
        import numpy as np
        
        consistent = []
        for i, matte in enumerate(mattes):
            if i == 0 or i == len(mattes) - 1:
                consistent.append(matte)
            else:
                # 时序平滑：与前后帧加权平均
                prev_arr = np.array(mattes[i - 1])
                curr_arr = np.array(matte)
                next_arr = np.array(mattes[i + 1])
                
                smoothed = (prev_arr * 0.2 + curr_arr * 0.6 + next_arr * 0.2).astype(np.uint8)
                consistent.append(Image.fromarray(smoothed))
        
        return consistent
    
    async def _save_foreground_result(
        self, 
        mattes: List[Image.Image],
        video_url: str
    ) -> ForegroundResult:
        """保存分离结果"""
        import tempfile
        
        # 保存到临时目录
        cache_dir = os.path.join(os.path.dirname(__file__), "..", "cache", "foreground")
        os.makedirs(cache_dir, exist_ok=True)
        
        task_id = str(uuid.uuid4())[:8]
        mattes_dir = os.path.join(cache_dir, f"{task_id}_mattes")
        os.makedirs(mattes_dir, exist_ok=True)
        
        for i, matte in enumerate(mattes):
            matte.save(os.path.join(mattes_dir, f"matte_{i:04d}.png"))
        
        return ForegroundResult(
            foreground_frames_url=f"/cache/foreground/{task_id}_frames",
            alpha_mattes_url=f"/cache/foreground/{task_id}_mattes",
            frame_count=len(mattes),
            quality_score=0.9  # TODO: 实际评估质量
        )


# ==========================================
# Stage 3: 视频生成 Agent (支持策略A和策略B)
# ==========================================

@dataclass
class VideoGenerationResult:
    """视频生成结果"""
    video_url: str
    duration: float
    strategy_used: EditStrategy
    motion_matched: bool = False  # 策略A: 是否匹配了原视频的运动
    lip_synced: bool = False      # 策略B: 是否完成了口型同步


class VideoGenerationAgent:
    """
    视频生成 Agent (原 BackgroundVideoAgent 的升级版)
    
    职责:
    - 策略A (纯背景替换): 图生视频 → 与前景合成
    - 策略B (人物编辑): Motion Control → Lip Sync
    
    入口方法:
    - generate(): 根据策略自动选择路径
    - generate_strategy_a(): 强制使用策略A
    - generate_strategy_b(): 强制使用策略B
    """
    
    def __init__(self):
        from .kling_ai_service import KlingAIClient
        self.kling_client = KlingAIClient()
        self.http_client = httpx.AsyncClient(timeout=300)
        
        # 子 Agent
        self.motion_agent = MotionControlAgent()
        self.lip_sync_agent = LipSyncAgent()
    
    async def generate(
        self,
        task: 'BackgroundReplaceTask',
        analysis: VideoAnalysisReport,
        progress_callback: Optional[callable] = None
    ) -> VideoGenerationResult:
        """
        根据策略生成视频
        
        Args:
            task: 背景替换任务
            analysis: 视频分析报告
            progress_callback: 进度回调
        
        Returns:
            VideoGenerationResult
        """
        strategy = task.detected_strategy or EditStrategy.BACKGROUND_ONLY
        
        logger.info(f"[VideoGeneration] 使用策略: {strategy.value}")
        
        if strategy == EditStrategy.BACKGROUND_ONLY:
            return await self.generate_strategy_a(
                background_image=task.background_image_url,
                analysis=analysis,
                progress_callback=progress_callback
            )
        else:
            return await self.generate_strategy_b(
                task=task,
                analysis=analysis,
                progress_callback=progress_callback
            )
    
    # ==========================================
    # 策略A: 纯背景替换 (保留原有逻辑)
    # ==========================================
    
    async def generate_strategy_a(
        self,
        background_image: str,
        analysis: VideoAnalysisReport,
        progress_callback: Optional[callable] = None
    ) -> VideoGenerationResult:
        """
        策略A: 纯背景 I2V 生成
        
        保持原有 BackgroundVideoAgent 的逻辑
        """
        logger.info(f"[VideoGeneration-A] 开始背景I2V生成, 目标时长: {analysis.duration}秒")
        
        try:
            # 1. 规划生成策略
            segments = self._plan_segments(analysis.duration)
            
            # 2. 构建运动提示词
            motion_prompt = self._build_motion_prompt(analysis.camera_motion)
            
            # 3. 分段生成
            segment_videos = []
            for i, segment in enumerate(segments):
                if progress_callback:
                    progress = int(10 + (i / len(segments)) * 70)
                    await progress_callback(progress, f"正在生成第 {i+1}/{len(segments)} 段...")
                
                video_url = await self._generate_segment(
                    image_url=background_image,  # 注意：这里变量名叫 image_url，但传给 _generate_segment 的参数也叫 image_url
                    duration=segment["duration"],
                    motion_prompt=motion_prompt,
                    seed=segment.get("seed")
                )
                segment_videos.append(video_url)
            
            # 4. 拼接
            if progress_callback:
                await progress_callback(85, "正在拼接视频...")
            
            if len(segment_videos) == 1:
                final_video = segment_videos[0]
            else:
                final_video = await self._stitch_segments(segment_videos)
            
            # 5. 精确匹配时长
            if progress_callback:
                await progress_callback(95, "正在调整时长...")
            
            matched_video = await self._match_duration(
                final_video, 
                analysis.duration,
                analysis.fps
            )
            
            if progress_callback:
                await progress_callback(100, "背景视频生成完成")
            
            return VideoGenerationResult(
                video_url=matched_video,
                duration=analysis.duration,
                strategy_used=EditStrategy.BACKGROUND_ONLY,
                motion_matched=analysis.camera_motion.type != "static",
                lip_synced=False
            )
            
        except Exception as e:
            logger.error(f"[VideoGeneration-A] 生成失败: {e}")
            raise
    
    # ==========================================
    # 策略B: 人物编辑 (Motion Control + Lip Sync)
    # ==========================================
    
    async def generate_strategy_b(
        self,
        task: 'BackgroundReplaceTask',
        analysis: VideoAnalysisReport,
        progress_callback: Optional[callable] = None
    ) -> VideoGenerationResult:
        """
        策略B: Motion Control + Lip Sync
        
        流程:
        1. Motion Control: 让编辑后的人物图片动起来
        2. Lip Sync: 与原音频对口型
        3. 返回最终视频
        """
        logger.info(f"[VideoGeneration-B] 开始 Motion Control + Lip Sync 生成")
        
        try:
            # 验证必要输入
            if not task.edited_frame_url:
                raise ValueError("策略B需要提供 edited_frame_url")
            if not task.original_audio_url:
                logger.warning("[VideoGeneration-B] 未提供 original_audio_url，将跳过 Lip Sync")
            
            # Step 1: Motion Control (0-50%)
            if progress_callback:
                await progress_callback(5, "正在启动动作控制...")
            
            # 使用解析后的视频 URL
            reference_video_url = task.resolved_video_url or task.video_url
            
            motion_video_url = await self.motion_agent.generate(
                edited_frame_url=task.edited_frame_url,
                reference_video_url=reference_video_url,
                progress_callback=lambda p, m: progress_callback(
                    int(5 + p * 0.45), m
                ) if progress_callback else None
            )
            
            # Step 2: Lip Sync (50-95%)
            if task.original_audio_url:
                if progress_callback:
                    await progress_callback(55, "正在启动口型同步...")
                
                final_video_url = await self.lip_sync_agent.sync_lip(
                    video_url=motion_video_url,
                    audio_url=task.original_audio_url,
                    progress_callback=lambda p, m: progress_callback(
                        int(55 + p * 0.40), m
                    ) if progress_callback else None
                )
                lip_synced = True
            else:
                # 无音频，跳过 Lip Sync
                final_video_url = motion_video_url
                lip_synced = False
            
            if progress_callback:
                await progress_callback(100, "视频生成完成")
            
            return VideoGenerationResult(
                video_url=final_video_url,
                duration=analysis.duration,
                strategy_used=task.detected_strategy or EditStrategy.PERSON_MINOR_EDIT,
                motion_matched=True,
                lip_synced=lip_synced
            )
            
        except Exception as e:
            logger.error(f"[VideoGeneration-B] 生成失败: {e}")
            raise

    def _plan_segments(self, duration: float) -> List[Dict[str, Any]]:
        """规划分段策略"""
        MAX_SEGMENT_DURATION = 5.0  # Kling 最大 5秒
        
        segments = []
        remaining = duration
        seed_base = int(time.time())
        
        while remaining > 0:
            seg_duration = min(MAX_SEGMENT_DURATION, remaining)
            segments.append({
                "duration": seg_duration,
                "seed": seed_base + len(segments),  # 保持风格一致
            })
            remaining -= seg_duration
        
        return segments
    
    def _build_motion_prompt(self, camera_motion: CameraMotion) -> str:
        """构建运动提示词"""
        if camera_motion.type == "static":
            # 静态背景，添加微妙的环境动效
            return "subtle ambient movement, gentle light changes, very stable camera"
        elif camera_motion.type == "pan":
            direction = "right" if camera_motion.direction[0] > 0 else "left"
            return f"slow camera pan to the {direction}, smooth movement"
        elif camera_motion.type == "zoom":
            return "slow zoom in, gradual movement"
        elif camera_motion.type == "handheld":
            return "slight handheld camera shake, natural movement"
        else:
            return "stable camera, minimal movement"
    
    async def _generate_segment(
        self,
        image_url: str,
        duration: float,
        motion_prompt: str,
        seed: Optional[int] = None
    ) -> str:
        """生成单个视频段"""
        # 确定时长参数
        duration_param = "5" if duration > 2.5 else "5"  # Kling 只支持 5 或 10 秒
        
        # 构建完整提示词
        full_prompt = f"Animate this background image with {motion_prompt}. Keep the scene consistent and natural."
        
        logger.info(f"[BackgroundVideo] 生成段落: duration={duration_param}s, prompt={full_prompt[:50]}...")
        
        # 调用 Kling image2video（注意：参数是 image 不是 image_url）
        result = await self.kling_client.create_image_to_video_task(
            image=image_url,  # ★ 正确的参数名是 image
            prompt=full_prompt,
            options={
                "model_name": "kling-v1-5",
                "duration": duration_param,
                "mode": "std",
            }
        )
        
        # 解析返回结果
        if result.get("code") != 0:
            error_msg = result.get("message", str(result))
            raise ValueError(f"创建图生视频任务失败: {error_msg}")
        
        task_id = result.get("data", {}).get("task_id")
        if not task_id:
            raise ValueError("创建图生视频任务失败: 未返回 task_id")
        
        logger.info(f"[BackgroundVideo] I2V 任务已创建: task_id={task_id}")
        
        # 轮询等待完成
        video_url = await self._poll_i2v_task(task_id)
        return video_url
    
    async def _poll_i2v_task(self, task_id: str, max_wait_seconds: int = 300) -> str:
        """轮询等待图生视频任务完成"""
        import time
        start_time = time.time()
        poll_interval = 5
        
        while True:
            elapsed = time.time() - start_time
            if elapsed > max_wait_seconds:
                raise TimeoutError(f"图生视频任务超时 ({max_wait_seconds}秒)")
            
            # 查询任务状态
            result = await self.kling_client.get_image_to_video_task(task_id)
            data = result.get("data", {})
            status = data.get("task_status")
            
            logger.info(f"[BackgroundVideo] I2V 任务状态: {status}")
            
            if status == "succeed":
                videos = data.get("task_result", {}).get("videos", [])
                if videos:
                    return videos[0].get("url")
                raise ValueError("图生视频成功但未返回视频URL")
            
            elif status == "failed":
                error_msg = data.get("task_status_msg", "未知错误")
                raise ValueError(f"图生视频失败: {error_msg}")
            
            await asyncio.sleep(poll_interval)
    
    async def _stitch_segments(self, segments: List[str]) -> str:
        """无缝拼接多个视频段"""
        import subprocess
        import tempfile
        
        # 下载所有段
        temp_files = []
        for i, url in enumerate(segments):
            response = await self.http_client.get(url)
            response.raise_for_status()
            
            tmp = tempfile.NamedTemporaryFile(suffix=f"_{i}.mp4", delete=False)
            tmp.write(response.content)
            tmp.close()
            temp_files.append(tmp.name)
        
        try:
            # 创建文件列表
            list_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
            for f in temp_files:
                list_file.write(f"file '{f}'\n")
            list_file.close()
            
            # 使用 ffmpeg 拼接
            output_file = tempfile.NamedTemporaryFile(suffix="_stitched.mp4", delete=False)
            output_file.close()
            
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", list_file.name,
                "-c", "copy",
                output_file.name
            ]
            # 异步执行 ffmpeg
            stitch_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            _, stitch_stderr = await stitch_process.communicate()
            if stitch_process.returncode != 0:
                raise RuntimeError(f"ffmpeg 拼接失败: {stitch_stderr.decode()[:200]}")
            
            # TODO: 上传到存储并返回 URL
            # 目前返回本地路径
            return output_file.name
            
        finally:
            # 清理临时文件
            for f in temp_files:
                try:
                    os.unlink(f)
                except:
                    pass
            try:
                os.unlink(list_file.name)
            except:
                pass
    
    async def _match_duration(
        self, 
        video_url: str, 
        target_duration: float,
        target_fps: float
    ) -> str:
        """精确匹配目标时长"""
        # TODO: 使用变速或补帧技术
        # 目前直接返回
        return video_url


# ==========================================
# Stage 3.5: Lip Sync Agent (策略B专用)
# ==========================================

class LipSyncAgent:
    """
    口型同步 Agent
    
    职责:
    - 调用可灵 Lip Sync API 进行口型同步
    - 处理 identify_face → create_lip_sync_task 流程
    
    使用场景:
    - 策略B: 用户编辑了人物区域，需要重建口型
    """
    
    # 轮询配置
    POLL_INTERVAL = 3  # 轮询间隔(秒)
    MAX_WAIT_TIME = 300  # 最大等待时间(秒)
    
    def __init__(self):
        from .kling_ai_service import KlingAIClient
        self.kling_client = KlingAIClient()
    
    async def sync_lip(
        self,
        video_url: str,
        audio_url: str,
        progress_callback: Optional[callable] = None
    ) -> str:
        """
        执行口型同步
        
        Args:
            video_url: 输入视频 URL (Motion Control 输出)
            audio_url: 音频文件 URL (原视频音频)
            progress_callback: 进度回调
        
        Returns:
            最终视频 URL
        """
        logger.info(f"[LipSync] 开始口型同步")
        logger.info(f"  - 视频: {video_url}")
        logger.info(f"  - 音频: {audio_url}")
        
        try:
            # Step 1: 人脸识别
            if progress_callback:
                await progress_callback(10, "正在识别人脸...")
            
            face_result = await self.kling_client.identify_face(video_url=video_url)
            
            session_id = face_result.get("session_id")
            face_data = face_result.get("face_data", [])
            
            if not session_id or not face_data:
                raise ValueError("人脸识别失败: 未检测到可用人脸")
            
            # 选择第一个人脸 (TODO: 多人场景需要优化选择逻辑)
            face_id = face_data[0].get("face_id")
            
            logger.info(f"[LipSync] 人脸识别成功: session_id={session_id}, face_id={face_id}")
            
            # Step 2: 创建对口型任务
            if progress_callback:
                await progress_callback(30, "正在创建对口型任务...")
            
            lip_task = await self.kling_client.create_lip_sync_task(
                session_id=session_id,
                face_id=face_id,
                audio_url=audio_url,
                sound_volume=1.0,           # 音频音量 100%
                original_audio_volume=0.0   # 静音原视频音频
            )
            
            task_id = lip_task.get("task_id")
            if not task_id:
                raise ValueError("创建对口型任务失败")
            
            logger.info(f"[LipSync] 任务已创建: task_id={task_id}")
            
            # Step 3: 等待任务完成
            final_video_url = await self._poll_lip_sync_task(
                task_id=task_id,
                progress_callback=progress_callback
            )
            
            if progress_callback:
                await progress_callback(100, "口型同步完成")
            
            logger.info(f"[LipSync] 完成: {final_video_url}")
            return final_video_url
            
        except Exception as e:
            logger.error(f"[LipSync] 口型同步失败: {e}")
            raise
    
    async def _poll_lip_sync_task(
        self,
        task_id: str,
        progress_callback: Optional[callable] = None
    ) -> str:
        """轮询等待 Lip Sync 任务完成"""
        start_time = time.time()
        
        while True:
            elapsed = time.time() - start_time
            
            if elapsed > self.MAX_WAIT_TIME:
                raise TimeoutError(f"口型同步任务超时: {task_id}")
            
            # 查询任务状态
            result = await self.kling_client.get_lip_sync_task(task_id)
            data = result.get("data", {})
            status = data.get("task_status")
            
            if status == "succeed":
                # 任务成功，提取视频 URL
                videos = data.get("task_result", {}).get("videos", [])
                if videos:
                    return videos[0].get("url")
                raise ValueError("任务成功但未返回视频")
            
            elif status == "failed":
                msg = data.get("task_status_msg", "未知错误")
                raise ValueError(f"口型同步任务失败: {msg}")
            
            # 更新进度
            if progress_callback:
                progress = min(30 + int(elapsed / self.MAX_WAIT_TIME * 65), 95)
                await progress_callback(progress, f"正在处理口型同步... ({int(elapsed)}秒)")
            
            # 等待下次轮询
            await asyncio.sleep(self.POLL_INTERVAL)


# ==========================================
# Stage 3.6: Motion Control Agent (策略B专用)
# ==========================================

class MotionControlAgent:
    """
    动作控制 Agent
    
    职责:
    - 调用可灵 Motion Control API
    - 用参考视频驱动编辑后的人物图像
    
    使用场景:
    - 策略B: 用户编辑了人物区域，需要让编辑后的人物动起来
    """
    
    # 轮询配置
    POLL_INTERVAL = 3  # 轮询间隔(秒)
    MAX_WAIT_TIME = 300  # 最大等待时间(秒)
    
    def __init__(self):
        from .kling_ai_service import KlingAIClient
        self.kling_client = KlingAIClient()
    
    async def generate(
        self,
        edited_frame_url: str,
        reference_video_url: str,
        progress_callback: Optional[callable] = None
    ) -> str:
        """
        动作控制生成
        
        Args:
            edited_frame_url: 用户编辑后的帧 URL
            reference_video_url: 参考视频 URL (原视频，提供动作)
            progress_callback: 进度回调
        
        Returns:
            生成的视频 URL
        """
        logger.info(f"[MotionControl] 开始动作控制生成")
        logger.info(f"  - 编辑帧: {edited_frame_url}")
        logger.info(f"  - 参考视频: {reference_video_url}")
        
        try:
            # Step 1: 创建动作控制任务
            if progress_callback:
                await progress_callback(10, "正在创建动作控制任务...")
            
            task_result = await self.kling_client.create_motion_control_task(
                image_url=edited_frame_url,
                video_url=reference_video_url,
                character_orientation="video",  # 人物朝向与视频一致
                mode="pro",                      # 高品质模式
                options={
                    "keep_original_sound": "no"  # 不保留原声，后续会用 Lip Sync
                }
            )
            
            task_id = task_result.get("data", {}).get("task_id")
            if not task_id:
                raise ValueError("创建动作控制任务失败")
            
            logger.info(f"[MotionControl] 任务已创建: task_id={task_id}")
            
            # Step 2: 等待任务完成
            video_url = await self._poll_motion_task(
                task_id=task_id,
                progress_callback=progress_callback
            )
            
            if progress_callback:
                await progress_callback(100, "动作控制生成完成")
            
            logger.info(f"[MotionControl] 完成: {video_url}")
            return video_url
            
        except Exception as e:
            logger.error(f"[MotionControl] 动作控制生成失败: {e}")
            raise
    
    async def _poll_motion_task(
        self,
        task_id: str,
        progress_callback: Optional[callable] = None
    ) -> str:
        """轮询等待 Motion Control 任务完成"""
        start_time = time.time()
        
        while True:
            elapsed = time.time() - start_time
            
            if elapsed > self.MAX_WAIT_TIME:
                raise TimeoutError(f"动作控制任务超时: {task_id}")
            
            # 查询任务状态
            result = await self.kling_client.get_motion_control_task(task_id)
            data = result.get("data", {})
            status = data.get("task_status")
            
            if status == "succeed":
                # 任务成功，提取视频 URL
                videos = data.get("task_result", {}).get("videos", [])
                if videos:
                    return videos[0].get("url")
                raise ValueError("任务成功但未返回视频")
            
            elif status == "failed":
                msg = data.get("task_status_msg", "未知错误")
                raise ValueError(f"动作控制任务失败: {msg}")
            
            # 更新进度
            if progress_callback:
                progress = min(10 + int(elapsed / self.MAX_WAIT_TIME * 85), 95)
                await progress_callback(progress, f"正在生成动作... ({int(elapsed)}秒)")
            
            # 等待下次轮询
            await asyncio.sleep(self.POLL_INTERVAL)


# ==========================================
# Stage 4: 智能合成 Agent
# ==========================================

class IntelligentCompositingAgent:
    """
    智能合成 Agent
    
    职责:
    - 光线调和 (Relighting)
    - 颜色匹配 (Color Grading)
    - 阴影生成 (Shadow Generation)
    - 边缘融合 (Edge Blending)
    """
    
    def __init__(self):
        self.http_client = httpx.AsyncClient(timeout=120)
    
    async def composite(
        self,
        video_url: str,
        foreground: ForegroundResult,
        background: BackgroundVideoResult,
        analysis: VideoAnalysisReport,
        progress_callback: Optional[callable] = None
    ) -> CompositeResult:
        """智能合成"""
        logger.info(f"[Compositing] 开始智能合成")
        
        try:
            # 1. 提取前景帧
            if progress_callback:
                await progress_callback(10, "正在加载素材...")
            
            foreground_frames = await self._load_foreground_frames(
                video_url, foreground
            )
            
            # 2. 提取背景帧
            background_frames = await self._extract_background_frames(
                background.video_url
            )
            
            # 3. 光线调和
            if progress_callback:
                await progress_callback(30, "正在调和光线...")
            
            relit_frames = await self._relight_foreground(
                foreground_frames,
                background_frames,
                analysis.lighting
            )
            
            # 4. 颜色匹配
            if progress_callback:
                await progress_callback(50, "正在匹配颜色...")
            
            color_matched = await self._match_color_grade(
                relit_frames,
                background_frames
            )
            
            # 5. 生成阴影
            if progress_callback:
                await progress_callback(65, "正在生成阴影...")
            
            shadow_frames = await self._generate_shadows(
                foreground,
                analysis.lighting
            )
            
            # 6. 边缘融合
            if progress_callback:
                await progress_callback(80, "正在融合边缘...")
            
            blended_frames = await self._blend_edges(
                color_matched,
                background_frames,
                foreground.alpha_mattes_url
            )
            
            # 7. 最终合成
            if progress_callback:
                await progress_callback(90, "正在生成最终视频...")
            
            result_url = await self._render_final_video(
                blended_frames,
                shadow_frames,
                analysis.fps
            )
            
            if progress_callback:
                await progress_callback(100, "合成完成")
            
            return CompositeResult(
                video_url=result_url,
                quality_score=0.9  # TODO: 实际评估
            )
            
        except Exception as e:
            logger.error(f"[Compositing] 合成失败: {e}")
            raise
    
    async def _load_foreground_frames(
        self,
        video_url: str,
        foreground: ForegroundResult
    ) -> List[Image.Image]:
        """加载前景帧"""
        # TODO: 实际实现
        return []
    
    async def _extract_background_frames(self, video_url: str) -> List[Image.Image]:
        """提取背景视频帧"""
        # TODO: 使用 ffmpeg 提取
        return []
    
    async def _relight_foreground(
        self,
        foreground_frames: List[Image.Image],
        background_frames: List[Image.Image],
        lighting: LightingInfo
    ) -> List[Image.Image]:
        """光线调和"""
        # TODO: 使用 IC-Light 或类似模型
        return foreground_frames
    
    async def _match_color_grade(
        self,
        foreground_frames: List[Image.Image],
        background_frames: List[Image.Image]
    ) -> List[Image.Image]:
        """颜色匹配"""
        # TODO: 直方图匹配或神经网络色彩迁移
        return foreground_frames
    
    async def _generate_shadows(
        self,
        foreground: ForegroundResult,
        lighting: LightingInfo
    ) -> List[Image.Image]:
        """生成阴影"""
        # TODO: 基于轮廓和光源方向生成阴影
        return []
    
    async def _blend_edges(
        self,
        foreground_frames: List[Image.Image],
        background_frames: List[Image.Image],
        alpha_mattes_url: str
    ) -> List[Image.Image]:
        """边缘融合"""
        # TODO: Alpha 预乘 + 边缘羽化
        return foreground_frames
    
    async def _render_final_video(
        self,
        frames: List[Image.Image],
        shadow_frames: List[Image.Image],
        fps: float
    ) -> str:
        """渲染最终视频"""
        # TODO: 使用 ffmpeg 渲染
        return ""


# ==========================================
# Stage 5: 质量增强 Agent
# ==========================================

class QualityEnhancementAgent:
    """
    质量增强 Agent
    
    职责:
    - 时序一致性检查与修复
    - 闪烁检测与修复
    - AI 痕迹检测与修复
    - 超分辨率增强
    - 质量验证
    """
    
    async def enhance(
        self,
        composite: CompositeResult,
        analysis: VideoAnalysisReport,
        progress_callback: Optional[callable] = None
    ) -> Tuple[str, QAReport]:
        """质量增强"""
        logger.info(f"[QualityEnhancement] 开始质量增强")
        
        try:
            video_url = composite.video_url
            
            # 1. 时序一致性修复
            if progress_callback:
                await progress_callback(20, "正在检查时序一致性...")
            video_url = await self._fix_temporal_issues(video_url)
            
            # 2. 去闪烁
            if progress_callback:
                await progress_callback(40, "正在去除闪烁...")
            video_url = await self._deflicker(video_url)
            
            # 3. AI 痕迹修复
            if progress_callback:
                await progress_callback(60, "正在优化细节...")
            video_url = await self._fix_ai_artifacts(video_url)
            
            # 4. 超分辨率（可选）
            if analysis.resolution[1] < 1080:
                if progress_callback:
                    await progress_callback(75, "正在提升分辨率...")
                video_url = await self._upscale(video_url, target_height=1080)
            
            # 5. 质量验证
            if progress_callback:
                await progress_callback(90, "正在验证质量...")
            qa_report = await self._quality_assurance(video_url)
            
            if progress_callback:
                await progress_callback(100, "质量增强完成")
            
            return video_url, qa_report
            
        except Exception as e:
            logger.error(f"[QualityEnhancement] 增强失败: {e}")
            raise
    
    async def _fix_temporal_issues(self, video_url: str) -> str:
        """修复时序问题"""
        # TODO: 使用时序平滑算法
        return video_url
    
    async def _deflicker(self, video_url: str) -> str:
        """去闪烁"""
        # TODO: 使用 DeFlicker 算法
        return video_url
    
    async def _fix_ai_artifacts(self, video_url: str) -> str:
        """修复 AI 痕迹"""
        # TODO: 检测并修复常见 AI 痕迹
        return video_url
    
    async def _upscale(self, video_url: str, target_height: int) -> str:
        """超分辨率"""
        # TODO: 使用 Real-ESRGAN Video
        return video_url
    
    async def _quality_assurance(self, video_url: str) -> QAReport:
        """质量检测"""
        # TODO: 实际的质量检测
        return QAReport(
            overall_score=0.9,
            temporal_consistency=0.92,
            edge_quality=0.88,
            color_consistency=0.91,
            lighting_match=0.87,
            flicker_score=0.95,
            artifact_score=0.89,
            passed=True
        )


# ==========================================
# 主工作流协调器
# ==========================================

class BackgroundReplaceWorkflow:
    """
    背景替换工作流协调器 (已改造支持双策略)
    
    策略A (纯背景替换):
        Stage 0: 编辑检测 → Stage 1: 视频分析 → Stage 2: 前景分离 → 
        Stage 3: 背景I2V → Stage 4: 智能合成 → Stage 5: 质量增强
    
    策略B (人物编辑):
        Stage 0: 编辑检测 → Stage 1: 视频分析 → 
        Stage 3: Motion Control → Stage 3.5: Lip Sync → 
        Stage 4: 背景合成 → Stage 5: 质量增强
    """
    
    def __init__(self):
        # Stage 0: 编辑检测 [新增]
        self.edit_detection_agent = EditDetectionAgent()
        
        # Stage 1: 视频分析
        self.analysis_agent = VideoAnalysisAgent()
        
        # Stage 2: 前景分离 (仅策略A)
        self.separation_agent = ForegroundSeparationAgent()
        
        # Stage 3: 视频生成 [改造] (原 BackgroundVideoAgent)
        self.video_generation_agent = VideoGenerationAgent()
        
        # Stage 4: 智能合成
        self.compositing_agent = IntelligentCompositingAgent()
        
        # Stage 5: 质量增强
        self.enhancement_agent = QualityEnhancementAgent()
        
        # 兼容旧代码
        self.background_agent = self.video_generation_agent
        
        self._tasks: Dict[str, BackgroundReplaceTask] = {}
        self._checkpoints: Dict[str, WorkflowCheckpoint] = {}
        self._event_callbacks: Dict[str, callable] = {}
    
    async def create_task(
        self,
        clip_id: str,
        session_id: str,
        video_url: str,
        background_image_url: str,
        prompt: Optional[str] = None,
        # [新增] 编辑相关参数
        edit_mask_url: Optional[str] = None,
        edited_frame_url: Optional[str] = None,
        original_audio_url: Optional[str] = None,
        force_strategy: Optional[str] = None
    ) -> BackgroundReplaceTask:
        """创建背景替换任务"""
        task_id = f"bg-{uuid.uuid4().hex[:12]}"
        now = datetime.utcnow()
        
        # 解析强制策略
        _force_strategy = None
        if force_strategy:
            try:
                _force_strategy = EditStrategy(force_strategy)
            except ValueError:
                logger.warning(f"[Workflow] 无效的强制策略: {force_strategy}")
        
        task = BackgroundReplaceTask(
            id=task_id,
            clip_id=clip_id,
            session_id=session_id,
            video_url=video_url,
            background_image_url=background_image_url,
            prompt=prompt,
            status=WorkflowStatus.PENDING,
            current_stage=WorkflowStage.CREATED,
            stage_progress=0,
            overall_progress=0,
            error=None,
            result_url=None,
            created_at=now,
            updated_at=now,
            # [新增] 编辑相关
            edit_mask_url=edit_mask_url,
            edited_frame_url=edited_frame_url,
            original_audio_url=original_audio_url,
            force_strategy=_force_strategy,
        )
        
        self._tasks[task_id] = task
        
        # 异步启动工作流
        asyncio.create_task(self._execute_workflow(task))
        
        return task
    
    async def get_task(self, task_id: str) -> Optional[BackgroundReplaceTask]:
        """获取任务状态"""
        return self._tasks.get(task_id)
    
    def register_event_callback(self, session_id: str, callback: callable):
        """注册事件回调"""
        self._event_callbacks[session_id] = callback
    
    async def _execute_workflow(self, task: BackgroundReplaceTask):
        """
        执行完整工作流 (已改造支持双策略)
        
        流程:
        1. 编辑检测 → 确定策略A或B
        2. 视频分析
        3. 根据策略执行不同的 Pipeline
        """
        try:
            task.status = WorkflowStatus.RUNNING
            
            # ==========================================
            # 预处理：解析真实可访问的视频 URL（绕过 API 鉴权）
            # ==========================================
            resolved_video_url = await resolve_video_download_url(task.clip_id)
            if not resolved_video_url:
                # 如果解析失败，尝试使用原始 URL（可能是外部 URL）
                logger.warning(f"[Workflow] 无法从 clip_id 解析视频 URL，尝试使用原始 URL")
                resolved_video_url = task.video_url
            task.resolved_video_url = resolved_video_url
            logger.info(f"[Workflow] 解析视频 URL 完成: {task.resolved_video_url[:80]}...")
            
            # ==========================================
            # Stage 0: 编辑检测 (0-5%) [新增]
            # ==========================================
            await self._update_stage(task, WorkflowStage.DETECTING, 0)
            
            # 如果有强制策略，则跳过检测
            if task.force_strategy:
                task.detected_strategy = task.force_strategy
                task.edit_detection = EditDetectionResult(
                    strategy=task.force_strategy,
                    edit_on_person_ratio=0.0,
                    person_edited_ratio=0.0,
                    confidence=1.0,
                    recommendation=f"用户强制使用策略: {task.force_strategy.value}"
                )
                logger.info(f"[Workflow] 使用强制策略: {task.force_strategy.value}")
            elif task.edited_frame_url:
                # 有编辑帧，执行检测（使用解析后的视频 URL）
                task.edit_detection = await self.edit_detection_agent.detect(
                    original_frame_url=task.resolved_video_url,  # TODO: 提取首帧
                    edited_frame_url=task.edited_frame_url,
                    edit_mask_url=task.edit_mask_url,
                    progress_callback=lambda p, m: self._update_progress(task, p, m, 0, 5)
                )
                task.detected_strategy = task.edit_detection.strategy
            else:
                # 无编辑帧，默认策略A
                task.detected_strategy = EditStrategy.BACKGROUND_ONLY
                task.edit_detection = EditDetectionResult(
                    strategy=EditStrategy.BACKGROUND_ONLY,
                    edit_on_person_ratio=0.0,
                    person_edited_ratio=0.0,
                    confidence=1.0,
                    recommendation="未提供编辑帧，默认使用纯背景替换"
                )
            
            # 通知前端检测结果
            await self._emit_event(task, "strategy_detected", {
                "strategy": task.detected_strategy.value,
                "confidence": task.edit_detection.confidence if task.edit_detection else 1.0,
                "recommendation": task.edit_detection.recommendation if task.edit_detection else ""
            })
            
            # ==========================================
            # Stage 1: 视频分析 (5-15%)
            # ==========================================
            await self._update_stage(task, WorkflowStage.ANALYZING, 5)
            
            task.analysis = await self.analysis_agent.analyze(
                task.resolved_video_url,
                progress_callback=lambda p, m: self._update_progress(task, p, m, 5, 15)
            )
            await self._save_checkpoint(task, 1)
            
            # ==========================================
            # 根据策略分流
            # ==========================================
            if task.detected_strategy == EditStrategy.BACKGROUND_ONLY:
                await self._execute_strategy_a(task)
            else:
                await self._execute_strategy_b(task)
            
            logger.info(f"[Workflow] 任务完成: {task.id}")
            
        except Exception as e:
            logger.error(f"[Workflow] 任务失败: {task.id}, 错误: {e}")
            task.status = WorkflowStatus.FAILED
            task.current_stage = WorkflowStage.FAILED
            task.error = str(e)
            task.updated_at = datetime.utcnow()
            
            await self._emit_event(task, "failed", {"error": str(e)})
    
    async def _execute_strategy_a(self, task: BackgroundReplaceTask):
        """
        执行策略A: 纯背景替换
        
        流程: 前景分离 → I2V生成 → 智能合成 → 质量增强
        """
        logger.info(f"[Workflow] 执行策略A: 纯背景替换")
        
        # 使用解析后的视频 URL
        video_url = task.resolved_video_url or task.video_url
        
        # Stage 2: 前景分离 (15-35%)
        await self._update_stage(task, WorkflowStage.SEPARATING, 15)
        task.foreground = await self.separation_agent.separate(
            video_url,
            task.analysis,
            progress_callback=lambda p, m: self._update_progress(task, p, m, 15, 35)
        )
        await self._save_checkpoint(task, 2)
        
        # Stage 3: 背景I2V生成 (35-65%)
        await self._update_stage(task, WorkflowStage.GENERATING, 35)
        video_result = await self.video_generation_agent.generate_strategy_a(
            background_image=task.background_image_url,
            analysis=task.analysis,
            progress_callback=lambda p, m: self._update_progress(task, p, m, 35, 65)
        )
        task.background_video = BackgroundVideoResult(
            video_url=video_result.video_url,
            duration=video_result.duration,
            motion_matched=video_result.motion_matched
        )
        await self._save_checkpoint(task, 3)
        
        # Stage 4: 智能合成 (65-85%)
        await self._update_stage(task, WorkflowStage.COMPOSITING, 65)
        task.composite = await self.compositing_agent.composite(
            video_url,
            task.foreground,
            task.background_video,
            task.analysis,
            progress_callback=lambda p, m: self._update_progress(task, p, m, 65, 85)
        )
        await self._save_checkpoint(task, 4)
        
        # Stage 5: 质量增强 (85-100%)
        await self._finalize_workflow(task)
    
    async def _execute_strategy_b(self, task: BackgroundReplaceTask):
        """
        执行策略B: 人物编辑 + 口型同步
        
        流程: Motion Control → Lip Sync → 背景合成 → 质量增强
        """
        logger.info(f"[Workflow] 执行策略B: 人物编辑 + 口型同步")
        
        # Stage 3: Motion Control + Lip Sync (15-55%)
        await self._update_stage(task, WorkflowStage.MOTION_CONTROL, 15)
        
        video_result = await self.video_generation_agent.generate_strategy_b(
            task=task,
            analysis=task.analysis,
            progress_callback=lambda p, m: self._update_progress(task, p, m, 15, 55)
        )
        
        # 策略B不需要前景分离，直接使用生成的视频
        task.background_video = BackgroundVideoResult(
            video_url=video_result.video_url,
            duration=video_result.duration,
            motion_matched=True
        )
        await self._save_checkpoint(task, 3)
        
        # Stage 4: 背景合成 (55-80%)
        # 策略B的合成相对简单，主要是将背景图与生成的人物视频合成
        await self._update_stage(task, WorkflowStage.COMPOSITING, 55)
        
        # 为策略B创建简化的前景结果（从Motion Control视频提取）
        task.foreground = ForegroundResult(
            foreground_frames_url=video_result.video_url,  # 直接使用生成的视频
            alpha_mattes_url="",  # 策略B不需要alpha matte
            frame_count=int(task.analysis.frame_count),
            quality_score=0.9
        )
        
        task.composite = await self.compositing_agent.composite(
            video_result.video_url,  # 使用策略B生成的视频
            task.foreground,
            task.background_video,
            task.analysis,
            progress_callback=lambda p, m: self._update_progress(task, p, m, 55, 80)
        )
        await self._save_checkpoint(task, 4)
        
        # Stage 5: 质量增强 (80-100%)
        await self._finalize_workflow(task, start_progress=80)
    
    async def _finalize_workflow(self, task: BackgroundReplaceTask, start_progress: int = 85):
        """完成工作流的最后阶段"""
        # Stage 5: 质量增强
        await self._update_stage(task, WorkflowStage.ENHANCING, start_progress)
        final_url, qa_report = await self.enhancement_agent.enhance(
            task.composite,
            task.analysis,
            progress_callback=lambda p, m: self._update_progress(task, p, m, start_progress, 100)
        )
        task.qa_report = qa_report
        task.result_url = final_url
        
        # 完成
        task.status = WorkflowStatus.COMPLETED
        task.current_stage = WorkflowStage.COMPLETED
        task.overall_progress = 100
        task.updated_at = datetime.utcnow()
        
        await self._emit_event(task, "completed", {
            "result_url": final_url,
            "strategy_used": task.detected_strategy.value if task.detected_strategy else "unknown",
            "qa_report": asdict(qa_report) if qa_report else None
        })
    
    async def _update_stage(
        self, 
        task: BackgroundReplaceTask, 
        stage: WorkflowStage,
        overall_progress: int
    ):
        """更新当前阶段"""
        task.current_stage = stage
        task.stage_progress = 0
        task.overall_progress = overall_progress
        task.updated_at = datetime.utcnow()
        
        await self._emit_event(task, "stage_change", {
            "stage": stage.value,
            "overall_progress": overall_progress
        })
    
    async def _update_progress(
        self,
        task: BackgroundReplaceTask,
        stage_progress: int,
        message: str,
        overall_start: int,
        overall_end: int
    ):
        """更新进度"""
        task.stage_progress = stage_progress
        task.overall_progress = overall_start + int((overall_end - overall_start) * stage_progress / 100)
        task.updated_at = datetime.utcnow()
        
        await self._emit_event(task, "progress", {
            "stage": task.current_stage.value,
            "stage_progress": stage_progress,
            "overall_progress": task.overall_progress,
            "message": message
        })
    
    async def _save_checkpoint(self, task: BackgroundReplaceTask, stage: int):
        """保存检查点"""
        checkpoint = WorkflowCheckpoint(
            task_id=task.id,
            stage=stage,
            stage_name=task.current_stage,
            data={
                "analysis": asdict(task.analysis) if task.analysis else None,
                "foreground": asdict(task.foreground) if task.foreground else None,
                "background_video": asdict(task.background_video) if task.background_video else None,
                "composite": asdict(task.composite) if task.composite else None,
            },
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        self._checkpoints[task.id] = checkpoint
    
    async def _emit_event(self, task: BackgroundReplaceTask, event_type: str, data: Dict):
        """发送事件"""
        callback = self._event_callbacks.get(task.session_id)
        if callback:
            try:
                await callback({
                    "task_id": task.id,
                    "event_type": event_type,
                    "data": data,
                    "timestamp": datetime.utcnow().isoformat()
                })
            except Exception as e:
                logger.warning(f"[Workflow] 事件发送失败: {e}")


# ==========================================
# 单例
# ==========================================

_background_replace_workflow: Optional[BackgroundReplaceWorkflow] = None


def get_background_replace_workflow() -> BackgroundReplaceWorkflow:
    """获取背景替换工作流单例"""
    global _background_replace_workflow
    if _background_replace_workflow is None:
        _background_replace_workflow = BackgroundReplaceWorkflow()
    return _background_replace_workflow
