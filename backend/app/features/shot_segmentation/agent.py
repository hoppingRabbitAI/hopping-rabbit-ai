"""
分镜 Agent 主入口
负责根据策略对视频进行分镜划分

设计原则：
- 分镜结果直接使用 SegmentationClip（与项目 clips 表对齐）
- 时间单位统一使用毫秒 (ms)
- 支持递归分镜（对已有 clip 进行二次分割）
"""

import logging
from datetime import datetime
from typing import Optional, Callable, List

from .types import (
    SegmentationStrategy,
    SegmentationRequest,
    SegmentationResult,
    SegmentationClip,
    TranscriptSegment,
)
from .strategies import (
    SceneDetectionStrategy,
    SentenceSegmentationStrategy,
    ParagraphSegmentationStrategy,
)
from .thumbnail import extract_thumbnails

logger = logging.getLogger(__name__)


class ShotSegmentationAgent:
    """
    分镜 Agent
    
    统一入口，根据策略选择对应的分镜算法
    
    支持的策略:
    - scene: 场景分镜 (基于视觉变化)
    - sentence: 分句分镜 (基于 ASR 断句)
    - paragraph: 段落分镜 (基于语义分析)
    
    架构说明:
    - 分镜结果是 SegmentationClip 列表，与 clips 表对齐
    - 通过 parent_clip_id 支持递归分镜（对任意 clip 进行二次分割）
    - 首次分镜: source_start/source_end 对应原素材时间范围
    - 递归分镜: 通过 request 中的 source_start_ms/source_end_ms 指定范围
    """
    
    def __init__(self):
        self.strategies = {
            SegmentationStrategy.SCENE: SceneDetectionStrategy(),
            SegmentationStrategy.SENTENCE: SentenceSegmentationStrategy(),
            SegmentationStrategy.PARAGRAPH: ParagraphSegmentationStrategy(),
        }
    
    async def segment(
        self,
        request: SegmentationRequest,
        video_path: str,
        transcript_segments: Optional[List[dict]] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
        extract_thumbnails_flag: bool = True,
    ) -> SegmentationResult:
        """
        执行分镜
        
        Args:
            request: 分镜请求参数（包含递归分镜的范围信息）
            video_path: 视频文件路径
            transcript_segments: ASR 分句结果 (分句/段落策略需要)
            on_progress: 进度回调 (progress: 0-100, step: str)
            extract_thumbnails_flag: 是否提取关键帧缩略图
        
        Returns:
            分镜结果（包含 SegmentationClip 列表）
        """
        
        if on_progress:
            on_progress(5, "初始化分镜策略...")
        
        # 1. 获取策略处理器
        strategy = self.strategies.get(request.strategy)
        if not strategy:
            raise ValueError(f"不支持的分镜策略: {request.strategy}")
        
        is_recursive = request.parent_clip_id is not None
        logger.info(f"使用分镜策略: {request.strategy.value}, 递归分镜: {is_recursive}")
        
        # 2. 检查是否需要 ASR 结果
        if request.strategy in [SegmentationStrategy.SENTENCE, SegmentationStrategy.PARAGRAPH]:
            if not transcript_segments or len(transcript_segments) == 0:
                raise ValueError(
                    f"{request.strategy.value} 策略需要 ASR 转写结果，"
                    "请先执行语音识别或选择 scene 策略"
                )
            logger.info(f"[Agent] 📥 收到 transcript_segments: {len(transcript_segments)} 条")
        
        if on_progress:
            on_progress(10, f"使用 {strategy.description} 分析...")
        
        # 3. 执行分镜
        logger.info(f"[Agent] 🚀 开始执行 {request.strategy.value} 策略分镜...")
        clips = await strategy.segment(
            video_path=video_path,
            asset_id=request.asset_id,
            transcript_segments=transcript_segments,
            params=request,
            on_progress=lambda p, s: on_progress(10 + int(p * 0.5), s) if on_progress else None,
        )
        
        logger.info(f"[Agent] ✅ 分镜完成: {len(clips)} 个分镜")
        
        # 4. 提取关键帧 (可选)
        if extract_thumbnails_flag and clips:
            if on_progress:
                on_progress(60, f"提取关键帧... (共 {len(clips)} 个分镜)")
            
            clips = await extract_thumbnails(
                video_path=video_path,
                clips=clips,
                on_progress=lambda p, s: on_progress(60 + int(p * 0.35), s) if on_progress else None,
                session_id=request.session_id,
                upload_to_cloud=True,
            )
        
        if on_progress:
            on_progress(95, "生成分镜结果...")
        
        # 5. 计算总时长（毫秒）
        total_duration_ms = sum(c.source_duration for c in clips) if clips else 0
        
        # 6. 构建结果
        result = SegmentationResult(
            session_id=request.session_id,
            asset_id=request.asset_id,
            strategy=request.strategy,
            clips=clips,
            parent_clip_id=request.parent_clip_id,
            total_duration_ms=total_duration_ms,
            clip_count=len(clips),
            created_at=datetime.utcnow().isoformat(),
        )
        
        if on_progress:
            on_progress(100, "分镜完成")
        
        logger.info(
            f"分镜结果: {result.clip_count} 个分镜, "
            f"总时长 {result.total_duration_ms / 1000:.1f}s"
        )
        
        return result
    
    async def segment_with_fallback(
        self,
        request: SegmentationRequest,
        video_path: str,
        transcript_segments: Optional[List[dict]] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> SegmentationResult:
        """
        带降级策略的分镜
        
        如果主策略失败，自动降级到备用策略
        """
        
        try:
            return await self.segment(
                request=request,
                video_path=video_path,
                transcript_segments=transcript_segments,
                on_progress=on_progress,
            )
        except ValueError as e:
            # 如果是因为缺少 ASR 结果，降级到场景分镜
            if "ASR" in str(e) and request.strategy != SegmentationStrategy.SCENE:
                logger.warning(f"降级到场景分镜: {e}")
                
                if on_progress:
                    on_progress(10, "降级到场景分镜...")
                
                fallback_request = SegmentationRequest(
                    session_id=request.session_id,
                    asset_id=request.asset_id,
                    strategy=SegmentationStrategy.SCENE,
                    parent_clip_id=request.parent_clip_id,
                    source_start_ms=request.source_start_ms,
                    source_end_ms=request.source_end_ms,
                    scene_threshold=request.scene_threshold,
                )
                
                return await self.segment(
                    request=fallback_request,
                    video_path=video_path,
                    on_progress=on_progress,
                )
            else:
                raise


# 单例
_agent_instance: Optional[ShotSegmentationAgent] = None


def get_shot_segmentation_agent() -> ShotSegmentationAgent:
    """
    获取分镜 Agent 单例
    """
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = ShotSegmentationAgent()
    return _agent_instance
