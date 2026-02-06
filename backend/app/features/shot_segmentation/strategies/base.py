"""
分镜策略 - 基类

设计原则：
- 分镜结果直接使用 SegmentationClip（与项目 clips 表对齐）
- 时间单位统一使用毫秒 (ms)
- 支持递归分镜（对已有 clip 进行二次分割）
"""

from abc import ABC, abstractmethod
from typing import Optional, Callable, List
import uuid

from ..types import SegmentationClip, SegmentationRequest, TranscriptSegment


class BaseSegmentationStrategy(ABC):
    """分镜策略基类"""
    
    name: str = "base"
    description: str = "基础分镜策略"
    
    @abstractmethod
    async def segment(
        self,
        video_path: str,
        asset_id: str,
        transcript_segments: Optional[List[TranscriptSegment]] = None,
        params: Optional[SegmentationRequest] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> List[SegmentationClip]:
        """
        执行分镜
        
        Args:
            video_path: 视频文件路径
            asset_id: 素材 ID
            transcript_segments: ASR 分句结果 (分句/段落策略需要)
            params: 分镜参数（包含递归分镜的范围信息）
            on_progress: 进度回调 (progress: 0-100, step: str)
        
        Returns:
            分镜 Clip 列表
        """
        pass
    
    def _get_segment_range(self, params: Optional[SegmentationRequest]) -> tuple:
        """
        获取分镜范围（用于递归分镜）
        
        Returns:
            (source_start_ms, source_end_ms) - 如果是首次分镜，返回 (None, None)
        """
        if params and params.source_start_ms is not None and params.source_end_ms is not None:
            return (params.source_start_ms, params.source_end_ms)
        return (None, None)
    
    def _filter_segments_by_range(
        self,
        segments: List[dict],
        range_start_ms: Optional[int],
        range_end_ms: Optional[int],
    ) -> List[dict]:
        """
        过滤出指定范围内的 segments（用于递归分镜）
        """
        if range_start_ms is None or range_end_ms is None:
            return segments
        
        filtered = []
        for seg in segments:
            # segment 与范围有重叠
            seg_start = seg.get("start", 0)
            seg_end = seg.get("end", 0)
            
            if seg_end > range_start_ms and seg_start < range_end_ms:
                # 裁剪到范围内
                clipped_seg = seg.copy()
                clipped_seg["start"] = max(seg_start, range_start_ms)
                clipped_seg["end"] = min(seg_end, range_end_ms)
                filtered.append(clipped_seg)
        
        return filtered
    
    def _create_clip(
        self,
        asset_id: str,
        start_time_ms: int,
        end_time_ms: int,
        source_start_ms: int,
        source_end_ms: int,
        transcript: Optional[str] = None,
        name: Optional[str] = None,
        parent_clip_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> SegmentationClip:
        """
        创建分镜 Clip 对象
        
        Args:
            asset_id: 素材 ID
            start_time_ms: 时间轴上的起始位置（毫秒）
            end_time_ms: 时间轴上的结束位置（毫秒）
            source_start_ms: 原素材中的起始偏移（毫秒）
            source_end_ms: 原素材中的结束位置（毫秒）
            transcript: 该分镜的文稿内容
            name: 分镜名称
            parent_clip_id: 父 Clip ID（用于递归分镜追溯）
            metadata: 额外元数据
        """
        return SegmentationClip(
            id=str(uuid.uuid4()),
            asset_id=asset_id,
            clip_type="video",
            start_time=start_time_ms,
            end_time=end_time_ms,
            source_start=source_start_ms,
            source_end=source_end_ms,
            parent_clip_id=parent_clip_id,
            transcript=transcript,
            name=name,
            metadata=metadata or {},
        )
    
    def _validate_clips(
        self,
        clips: List[SegmentationClip],
        min_duration_ms: int = 500,
    ) -> List[SegmentationClip]:
        """
        验证和清理分镜列表
        
        1. 确保时间连续
        2. 移除过短的分镜 (注意：分句分镜已经合并过短句，这里用较低阈值)
        3. 重新调整时间轴位置（start_time/end_time）
        """
        import logging
        logger = logging.getLogger(__name__)
        
        if not clips:
            return []
        
        logger.info(f"[validate_clips] 🔍 输入 {len(clips)} 个 clips, min_duration_ms={min_duration_ms}")
        
        # 按源素材时间排序
        clips = sorted(clips, key=lambda c: c.source_start)
        
        # ★ 过滤时使用较低的阈值（200ms），因为分句分镜已经合并过短句了
        # 这里只过滤掉真正异常短的 clips
        filter_threshold = min(min_duration_ms, 200)  # 最多用 200ms 过滤
        
        # 过滤过短的分镜
        filtered_out = [c for c in clips if c.source_duration < filter_threshold]
        valid_clips = [c for c in clips if c.source_duration >= filter_threshold]
        
        if filtered_out:
            logger.warning(f"[validate_clips] ⚠️ 过滤掉 {len(filtered_out)} 个过短 clips (<{filter_threshold}ms):")
            for c in filtered_out:
                logger.warning(f"[validate_clips]   - {c.name}: {c.source_duration}ms, text={c.transcript[:30] if c.transcript else ''}...")
        
        # 重新计算时间轴位置（连续排列）
        timeline_pos = 0
        for clip in valid_clips:
            duration = clip.source_duration
            clip.start_time = timeline_pos
            clip.end_time = timeline_pos + duration
            timeline_pos += duration
        
        logger.info(f"[validate_clips] ✅ 输出 {len(valid_clips)} 个 clips, 总时长={timeline_pos}ms ({timeline_pos/1000:.1f}s)")
        
        return valid_clips
    
    def _normalize_segments(self, segments: list) -> List[dict]:
        """
        将不同格式的 segment 统一为 dict
        时间单位统一为毫秒
        
        ★ 过滤掉静音片段（text 为空）
        """
        import logging
        logger = logging.getLogger(__name__)
        
        result = []
        skipped_silence = 0
        
        for i, seg in enumerate(segments):
            if isinstance(seg, dict):
                text = seg.get("text", "").strip()
                
                # ★★★ 过滤静音片段 ★★★
                if not text:
                    skipped_silence += 1
                    continue
                
                # 获取原始值
                start = seg.get("start", 0)
                end = seg.get("end", 0)
                
                original_start, original_end = start, end
                
                # 智能检测时间单位：
                # - 如果所有值都 < 1000 且是浮点数，很可能是秒
                # - 如果值是整数且 > 1000，很可能是毫秒
                if isinstance(start, float) or isinstance(end, float):
                    # 浮点数，检查范围
                    if start < 1000 and end < 1000:
                        # 看起来是秒，转换为毫秒
                        start = int(start * 1000)
                        end = int(end * 1000)
                        if i == 0:
                            logger.info(f"[normalize_segments] 检测到秒为单位，转换为毫秒")
                    else:
                        start = int(start)
                        end = int(end)
                else:
                    start = int(start)
                    end = int(end)
                
                # 打印前3个和后3个的转换详情
                if len(result) < 3:
                    logger.info(f"[normalize_segments] [{len(result)}] 原始={original_start}-{original_end}, 转换后={start}-{end}ms, text={text[:20]}...")
                
                result.append({
                    "id": seg.get("id", f"seg-{i}"),
                    "text": text,
                    "start": start,
                    "end": end,
                })
            elif hasattr(seg, "text"):  # TranscriptSegment
                text = seg.text.strip() if seg.text else ""
                if not text:
                    skipped_silence += 1
                    continue
                    
                result.append({
                    "id": seg.id,
                    "text": text,
                    "start": int(seg.start),
                    "end": int(seg.end),
                })
            else:
                logger.warning(f"未知的 segment 格式: {type(seg)}")
        
        logger.info(f"[normalize_segments] ✅ 转换完成: {len(segments)} 原始 -> {len(result)} 有效 (跳过 {skipped_silence} 个静音)")
        if result:
            total_duration = result[-1]["end"] - result[0]["start"]
            logger.info(f"[normalize_segments] 时间范围: {result[0]['start']}ms - {result[-1]['end']}ms, 总时长={total_duration}ms ({total_duration/1000:.1f}s)")
        
        return result
