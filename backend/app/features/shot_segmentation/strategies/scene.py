"""
场景分镜策略 - 基于视觉变化检测
使用 PySceneDetect 进行场景边界检测

设计原则：
- 时间单位统一使用毫秒 (ms)
- 支持递归分镜（对已有 clip 的指定范围进行场景检测）
"""

import logging
import asyncio
from typing import Optional, Callable, List

from .base import BaseSegmentationStrategy
from ..types import SegmentationClip, SegmentationRequest, TranscriptSegment

logger = logging.getLogger(__name__)


class SceneDetectionStrategy(BaseSegmentationStrategy):
    """
    场景分镜策略
    
    基于视频帧的视觉变化检测镜头切换点
    适用于：已有多镜头素材、场景变化丰富的视频
    """
    
    name = "scene"
    description = "基于视觉变化的场景分镜"
    
    async def segment(
        self,
        video_path: str,
        asset_id: str,
        transcript_segments: Optional[List[TranscriptSegment]] = None,
        params: Optional[SegmentationRequest] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> List[SegmentationClip]:
        """
        使用 PySceneDetect 检测场景边界
        """
        
        if on_progress:
            on_progress(10, "正在加载视频...")
        
        # 获取参数
        threshold = params.scene_threshold if params else 27.0
        min_scene_len_ms = params.scene_min_length_ms if params else 500
        parent_clip_id = params.parent_clip_id if params else None
        
        # 获取递归分镜范围
        range_start_ms, range_end_ms = self._get_segment_range(params)
        
        try:
            # 尝试导入 scenedetect
            from scenedetect import detect, AdaptiveDetector, ContentDetector
        except ImportError:
            logger.warning("PySceneDetect 未安装，使用简化的场景检测")
            return await self._fallback_detection(
                video_path, asset_id, parent_clip_id, 
                range_start_ms, range_end_ms, on_progress
            )
        
        if on_progress:
            on_progress(20, "正在分析视频帧...")
        
        # 在线程池中运行同步的场景检测
        loop = asyncio.get_event_loop()
        scene_list = await loop.run_in_executor(
            None,
            self._detect_scenes_sync,
            video_path,
            threshold,
            min_scene_len_ms,
            range_start_ms,
            range_end_ms,
        )
        
        if on_progress:
            on_progress(80, f"检测到 {len(scene_list)} 个场景")
        
        # 转换 ASR segments 为统一格式
        segments = self._normalize_segments(transcript_segments) if transcript_segments else []
        
        # 转换为 Clip 列表
        clips = []
        timeline_pos = 0
        
        for i, (start_ms, end_ms) in enumerate(scene_list):
            duration = end_ms - start_ms
            
            # 提取对应时间段的文本
            transcript = self._get_transcript_for_range(segments, start_ms, end_ms) if segments else None
            
            clip = self._create_clip(
                asset_id=asset_id,
                start_time_ms=timeline_pos,
                end_time_ms=timeline_pos + duration,
                source_start_ms=start_ms,
                source_end_ms=end_ms,
                transcript=transcript,
                name=f"场景 {i + 1}",
                parent_clip_id=parent_clip_id,
                metadata={"strategy": "scene", "scene_index": i},
            )
            clips.append(clip)
            timeline_pos += duration
        
        if on_progress:
            on_progress(100, "场景检测完成")
        
        return self._validate_clips(clips, min_scene_len_ms)
    
    def _detect_scenes_sync(
        self,
        video_path: str,
        threshold: float,
        min_scene_len_ms: int,
        range_start_ms: Optional[int] = None,
        range_end_ms: Optional[int] = None,
    ) -> List[tuple]:
        """
        同步执行场景检测
        
        Returns:
            List of (start_ms, end_ms) tuples
        """
        from scenedetect import detect, AdaptiveDetector, ContentDetector
        import cv2
        
        logger.info(f"开始场景检测: {video_path}, threshold={threshold}")
        
        # 获取视频帧率
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        video_duration_ms = int((total_frames / fps) * 1000)
        cap.release()
        
        # 计算最小场景帧数
        min_frames = max(1, int((min_scene_len_ms / 1000) * fps))
        
        # 首先尝试 AdaptiveDetector
        try:
            scene_list = detect(
                video_path,
                AdaptiveDetector(min_scene_len=min_frames),
            )
            
            if len(scene_list) >= 2:
                logger.info(f"AdaptiveDetector 检测到 {len(scene_list)} 个场景")
                results = [(int(s[0].get_seconds() * 1000), int(s[1].get_seconds() * 1000)) for s in scene_list]
                return self._filter_scenes_by_range(results, range_start_ms, range_end_ms, video_duration_ms)
        except Exception as e:
            logger.warning(f"AdaptiveDetector 失败: {e}")
        
        # 降级到 ContentDetector
        try:
            scene_list = detect(
                video_path,
                ContentDetector(threshold=threshold, min_scene_len=min_frames),
            )
            
            logger.info(f"ContentDetector 检测到 {len(scene_list)} 个场景")
            results = [(int(s[0].get_seconds() * 1000), int(s[1].get_seconds() * 1000)) for s in scene_list]
            return self._filter_scenes_by_range(results, range_start_ms, range_end_ms, video_duration_ms)
        except Exception as e:
            logger.error(f"ContentDetector 失败: {e}")
            return []
    
    def _filter_scenes_by_range(
        self,
        scenes: List[tuple],
        range_start_ms: Optional[int],
        range_end_ms: Optional[int],
        video_duration_ms: int,
    ) -> List[tuple]:
        """
        过滤出指定范围内的场景（用于递归分镜）
        """
        if range_start_ms is None or range_end_ms is None:
            return scenes
        
        filtered = []
        for start_ms, end_ms in scenes:
            # 场景与范围有重叠
            if end_ms > range_start_ms and start_ms < range_end_ms:
                # 裁剪到范围内
                clipped_start = max(start_ms, range_start_ms)
                clipped_end = min(end_ms, range_end_ms)
                if clipped_end > clipped_start:
                    filtered.append((clipped_start, clipped_end))
        
        return filtered
    
    async def _fallback_detection(
        self,
        video_path: str,
        asset_id: str,
        parent_clip_id: Optional[str],
        range_start_ms: Optional[int],
        range_end_ms: Optional[int],
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> List[SegmentationClip]:
        """
        备用方案：使用 OpenCV 简单的帧差检测
        """
        import cv2
        import numpy as np
        
        if on_progress:
            on_progress(20, "使用简化场景检测...")
        
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration_ms = int((total_frames / fps) * 1000)
        
        # 确定检测范围
        detect_start_ms = range_start_ms if range_start_ms is not None else 0
        detect_end_ms = range_end_ms if range_end_ms is not None else duration_ms
        
        # 定位到起始帧
        start_frame = int((detect_start_ms / 1000) * fps)
        end_frame = int((detect_end_ms / 1000) * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        
        # 采样间隔 (每秒采样 2 帧)
        sample_interval = int(fps / 2)
        
        prev_hist = None
        scene_boundaries_ms = [detect_start_ms]  # 第一个场景从起点开始
        threshold = 0.5  # 直方图差异阈值
        
        frame_idx = start_frame
        while frame_idx < end_frame:
            ret, frame = cap.read()
            if not ret:
                break
            
            if (frame_idx - start_frame) % sample_interval == 0:
                # 计算灰度直方图
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
                hist = cv2.normalize(hist, hist).flatten()
                
                if prev_hist is not None:
                    # 计算直方图差异
                    diff = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA)
                    
                    if diff > threshold:
                        time_ms = int((frame_idx / fps) * 1000)
                        # 确保与上一个边界有足够间隔 (2秒)
                        if time_ms - scene_boundaries_ms[-1] >= 2000:
                            scene_boundaries_ms.append(time_ms)
                
                prev_hist = hist
            
            frame_idx += 1
            
            # 更新进度
            if on_progress and (frame_idx - start_frame) % ((end_frame - start_frame) // 10 or 1) == 0:
                progress = 20 + int(60 * (frame_idx - start_frame) / (end_frame - start_frame))
                on_progress(progress, f"分析进度 {frame_idx - start_frame}/{end_frame - start_frame}")
        
        cap.release()
        
        # 添加结束边界
        scene_boundaries_ms.append(detect_end_ms)
        
        if on_progress:
            on_progress(90, f"检测到 {len(scene_boundaries_ms) - 1} 个场景")
        
        # 转换为 Clip 列表
        clips = []
        timeline_pos = 0
        
        for i in range(len(scene_boundaries_ms) - 1):
            start_ms = scene_boundaries_ms[i]
            end_ms = scene_boundaries_ms[i + 1]
            duration = end_ms - start_ms
            
            clip = self._create_clip(
                asset_id=asset_id,
                start_time_ms=timeline_pos,
                end_time_ms=timeline_pos + duration,
                source_start_ms=start_ms,
                source_end_ms=end_ms,
                name=f"场景 {i + 1}",
                parent_clip_id=parent_clip_id,
                metadata={"strategy": "scene", "scene_index": i, "fallback": True},
            )
            clips.append(clip)
            timeline_pos += duration
        
        return clips
    
    def _get_transcript_for_range(
        self,
        segments: List[dict],
        start_ms: int,
        end_ms: int,
    ) -> str:
        """
        获取指定时间范围内的转写文本
        """
        texts = []
        for seg in segments:
            seg_start = seg.get("start", 0)
            seg_end = seg.get("end", 0)
            # 如果片段与时间范围有重叠
            if seg_end > start_ms and seg_start < end_ms:
                texts.append(seg.get("text", ""))
        
        return "".join(texts) if texts else ""
