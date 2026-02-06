"""
分句分镜策略 - 基于 ASR 断句
每个句子作为一个独立分镜

设计原则：
- 时间单位统一使用毫秒 (ms)
- 支持递归分镜（对已有 clip 的指定范围进行分句）
"""

import logging
from typing import Optional, Callable, List

from .base import BaseSegmentationStrategy
from ..types import SegmentationClip, SegmentationRequest, TranscriptSegment

logger = logging.getLogger(__name__)


class SentenceSegmentationStrategy(BaseSegmentationStrategy):
    """
    分句分镜策略
    
    基于 ASR 转写结果的断句进行分镜
    适用于：口播清晰、节奏明快的视频
    """
    
    name = "sentence"
    description = "基于 ASR 断句的分镜"
    
    async def segment(
        self,
        video_path: str,
        asset_id: str,
        transcript_segments: Optional[List[TranscriptSegment]] = None,
        params: Optional[SegmentationRequest] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> List[SegmentationClip]:
        """
        基于 ASR 分句结果进行分镜
        """
        
        if on_progress:
            on_progress(10, "检查 ASR 转写结果...")
        
        # 验证输入
        if not transcript_segments or len(transcript_segments) == 0:
            logger.warning("没有 ASR 转写结果，无法进行分句分镜")
            raise ValueError("分句分镜需要 ASR 转写结果，请先执行语音识别")
        
        logger.info(f"[分句分镜] 📥 收到 transcript_segments: {len(transcript_segments)} 条")
        
        # 获取参数
        min_duration_ms = params.min_sentence_duration_ms if params else 1500
        max_duration_ms = params.max_sentence_duration_ms if params else 30000
        merge_short = params.merge_short_sentences if params else True
        parent_clip_id = params.parent_clip_id if params else None
        
        logger.info(f"[分句分镜] ⚙️ 参数: min_duration={min_duration_ms}ms, max_duration={max_duration_ms}ms, merge_short={merge_short}")
        
        # 获取递归分镜范围
        range_start_ms, range_end_ms = self._get_segment_range(params)
        logger.info(f"[分句分镜] 📍 分镜范围: start={range_start_ms}ms, end={range_end_ms}ms")
        
        if on_progress:
            on_progress(30, f"处理 {len(transcript_segments)} 个语句...")
        
        # 转换为统一格式 (兼容 dict 和 TranscriptSegment)
        segments = self._normalize_segments(transcript_segments)
        logger.info(f"[分句分镜] 🔄 标准化后 segments: {len(segments)} 条")
        
        # 打印前5个和后5个 segments 的详情
        for i, seg in enumerate(segments[:5]):
            logger.info(f"[分句分镜]   前{i+1}: [{seg.get('start', 0)}-{seg.get('end', 0)}ms] {seg.get('text', '')[:30]}...")
        if len(segments) > 10:
            logger.info(f"[分句分镜]   ... 省略 {len(segments) - 10} 条 ...")
            for i, seg in enumerate(segments[-5:]):
                logger.info(f"[分句分镜]   后{i+1}: [{seg.get('start', 0)}-{seg.get('end', 0)}ms] {seg.get('text', '')[:30]}...")
        
        # 如果是递归分镜，过滤出范围内的 segments
        if range_start_ms is not None:
            before_filter = len(segments)
            segments = self._filter_segments_by_range(segments, range_start_ms, range_end_ms)
            logger.info(f"[分句分镜] 🔍 范围过滤: {before_filter} -> {len(segments)} 条")
        
        if not segments:
            logger.warning("指定范围内没有分句数据")
            return []
        
        if on_progress:
            on_progress(50, "合并短句...")
        
        # 合并过短的句子
        if merge_short:
            before_merge = len(segments)
            segments = self._merge_short_sentences(segments, min_duration_ms, max_duration_ms)
            logger.info(f"[分句分镜] 🔗 合并短句: {before_merge} -> {len(segments)} 条")
        else:
            logger.info(f"[分句分镜] ⏭️ 跳过短句合并，保留 {len(segments)} 条")
        
        # 打印合并后的 segments 详情
        for i, seg in enumerate(segments):
            duration = seg.get('end', 0) - seg.get('start', 0)
            logger.info(f"[分句分镜]   合并后[{i+1}]: [{seg.get('start', 0)}-{seg.get('end', 0)}ms] 时长={duration}ms, 文字={seg.get('text', '')[:40]}...")
        
        if on_progress:
            on_progress(70, "生成分镜...")
        
        # 转换为 Clip 列表
        clips = []
        timeline_pos = 0
        
        for i, seg in enumerate(segments):
            start_ms = seg["start"]
            end_ms = seg["end"]
            duration = end_ms - start_ms
            
            clip = self._create_clip(
                asset_id=asset_id,
                start_time_ms=timeline_pos,
                end_time_ms=timeline_pos + duration,
                source_start_ms=start_ms,
                source_end_ms=end_ms,
                transcript=seg["text"],
                name=f"句子 {i + 1}",
                parent_clip_id=parent_clip_id,
                metadata={"strategy": "sentence", "sentence_index": i},
            )
            clips.append(clip)
            timeline_pos += duration
        
        if on_progress:
            on_progress(100, f"生成 {len(clips)} 个分镜")
        
        logger.info(f"[分句分镜] 🎬 生成了 {len(clips)} 个原始 clips，开始验证...")
        
        # ★ 传入较低的阈值（200ms），因为短句已经被合并过了
        return self._validate_clips(clips, 200)
    
    def _merge_short_sentences(
        self,
        segments: List[dict],
        min_duration_ms: int,
        max_duration_ms: int,
    ) -> List[dict]:
        """
        合并过短的句子
        
        规则:
        1. 如果句子 < min_duration_ms，尝试与前一句合并
        2. 如果合并后 > max_duration_ms，保持独立
        3. 连续的短句会被合并成一个
        """
        if not segments:
            return []
        
        logger.info(f"[合并短句] 开始处理 {len(segments)} 个句子, min={min_duration_ms}ms, max={max_duration_ms}ms")
        
        # 统计短句数量
        short_count = sum(1 for s in segments if (s.get('end', 0) - s.get('start', 0)) < min_duration_ms)
        logger.info(f"[合并短句] 短句(<{min_duration_ms}ms)数量: {short_count}/{len(segments)}")
        
        merged = []
        buffer = None
        
        for idx, seg in enumerate(segments):
            duration = seg["end"] - seg["start"]
            action = ""  # 用于记录本次操作
            
            if buffer is None:
                # 第一个句子，放入缓冲区
                buffer = seg.copy()
                action = "init_buffer"
            elif duration < min_duration_ms:
                # 当前句子太短，尝试合并到缓冲区
                potential_duration = seg["end"] - buffer["start"]
                
                if potential_duration <= max_duration_ms:
                    # 可以合并
                    buffer["end"] = seg["end"]
                    buffer["text"] = buffer["text"] + seg["text"]
                    action = f"merge_short(duration={duration}ms, merged_len={potential_duration}ms)"
                else:
                    # 合并后太长，先保存缓冲区，开始新的
                    merged.append(buffer)
                    buffer = seg.copy()
                    action = f"short_but_too_long(duration={duration}ms, would_be={potential_duration}ms)"
            else:
                # 当前句子足够长
                buffer_duration = buffer["end"] - buffer["start"]
                
                if buffer_duration < min_duration_ms:
                    # 缓冲区太短，尝试与当前句子合并
                    potential_duration = seg["end"] - buffer["start"]
                    
                    if potential_duration <= max_duration_ms:
                        buffer["end"] = seg["end"]
                        buffer["text"] = buffer["text"] + seg["text"]
                        action = f"merge_with_short_buffer(buf_dur={buffer_duration}ms, merged={potential_duration}ms)"
                    else:
                        # 无法合并，都保存
                        merged.append(buffer)
                        buffer = seg.copy()
                        action = f"save_short_buffer(buf_dur={buffer_duration}ms)"
                else:
                    # 缓冲区足够长，保存并开始新的
                    merged.append(buffer)
                    buffer = seg.copy()
                    action = f"save_normal_buffer(buf_dur={buffer_duration}ms)"
            
            # 每处理5个或最后一个打印一次
            if idx % 5 == 0 or idx == len(segments) - 1:
                logger.debug(f"[合并短句] [{idx+1}/{len(segments)}] {action}, 当前merged={len(merged)}个, buffer_len={buffer['end']-buffer['start'] if buffer else 0}ms")
        
        # 不要忘记最后一个
        if buffer:
            merged.append(buffer)
            logger.info(f"[合并短句] 最后buffer保存: {buffer['end']-buffer['start']}ms")
        
        logger.info(f"[合并短句] ✅ 完成: {len(segments)} 个原始句子 -> {len(merged)} 个合并后片段")
        return merged
