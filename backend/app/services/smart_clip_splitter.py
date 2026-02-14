"""
智能 Clip 分片服务

专门为 Kling 多模态视频编辑 API 设计的时长分片策略。

Kling API 限制：
- 有效时长区间：2-5秒 或 7-10秒
- 无效时长区间：<2秒、5-7秒、>10秒

分片策略：
1. 优先按分句切分（利用 transcript）
2. 回退按固定时长切分（5秒或10秒）
3. 确保每个分片都在有效时长区间内

流程：
1. 获取 clip 时长和 transcript
2. 判断是否需要分片
3. 尝试分句策略
4. 回退到固定时长策略
5. 返回分片信息列表
"""

import logging
from typing import Optional, List, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

logger = logging.getLogger(__name__)


# ==========================================
# 数据结构
# ==========================================

@dataclass
class ClipSegment:
    """分片信息"""
    id: str                           # 分片唯一 ID
    parent_clip_id: str               # 原 clip ID
    start_ms: int                     # 相对于原 clip 的开始时间（毫秒）
    end_ms: int                       # 相对于原 clip 的结束时间（毫秒）
    transcript: str = ""              # 该分片的转写文本
    split_reason: str = ""            # 分片原因
    
    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms
    
    @property
    def duration_seconds(self) -> float:
        return self.duration_ms / 1000


@dataclass
class SplitPlan:
    """分片计划"""
    clip_id: str
    original_duration_ms: int
    needs_split: bool
    split_reason: str                   # 为什么需要/不需要分片
    split_strategy: str                 # 'sentence', 'fixed_duration', 'none'
    segments: List[ClipSegment] = field(default_factory=list)
    
    @property
    def segment_count(self) -> int:
        return len(self.segments)


# ==========================================
# Kling 时长验证
# ==========================================

# Kling 多模态 API 支持的时长范围
VALID_DURATION_RANGES = [
    (2.0, 5.0),   # 2-5秒
    (7.0, 10.0),  # 7-10秒
]

# 目标时长（用于固定时长切分）
TARGET_DURATION_SHORT = 4.5    # 短片段目标时长（秒）- 在 2-5 区间的安全值
TARGET_DURATION_LONG = 9.0     # 长片段目标时长（秒）- 在 7-10 区间的安全值

# 最小片段时长（避免太短无法使用）
MIN_SEGMENT_DURATION = 2.0


def is_valid_duration(duration_seconds: float) -> bool:
    """检查时长是否在 Kling 有效区间内"""
    for min_dur, max_dur in VALID_DURATION_RANGES:
        if min_dur <= duration_seconds <= max_dur:
            return True
    return False


def get_invalid_reason(duration_seconds: float) -> str:
    """获取时长无效的原因"""
    if duration_seconds < 2.0:
        return f"时长 {duration_seconds:.1f}s 小于最小要求 2s"
    elif 5.0 < duration_seconds < 7.0:
        return f"时长 {duration_seconds:.1f}s 在无效区间 5-7s 内"
    elif duration_seconds > 10.0:
        return f"时长 {duration_seconds:.1f}s 超过最大限制 10s"
    return ""


# ==========================================
# 智能分片服务
# ==========================================

class SmartClipSplitter:
    """
    智能 Clip 分片服务
    
    针对 Kling 多模态 API 的时长限制，智能分片 clip。
    """
    
    def __init__(self):
        pass
    
    async def analyze_and_plan(
        self,
        clip_id: str,
        duration_ms: int,
        transcript: Optional[str] = None,
        words_with_timing: Optional[List[dict]] = None,
    ) -> SplitPlan:
        """
        分析 clip 并生成分片计划
        
        Args:
            clip_id: Clip ID
            duration_ms: Clip 时长（毫秒）
            transcript: 转写文本（可选）
            words_with_timing: 带时间戳的词列表（可选）
            
        Returns:
            SplitPlan: 分片计划
        """
        duration_seconds = duration_ms / 1000
        
        # 1. 检查是否需要分片
        if is_valid_duration(duration_seconds):
            logger.info(f"[SmartSplit] Clip {clip_id} 时长 {duration_seconds:.1f}s 在有效区间，无需分片")
            return SplitPlan(
                clip_id=clip_id,
                original_duration_ms=duration_ms,
                needs_split=False,
                split_reason=f"时长 {duration_seconds:.1f}s 符合 Kling 要求",
                split_strategy="none",
                segments=[ClipSegment(
                    id=str(uuid4()),
                    parent_clip_id=clip_id,
                    start_ms=0,
                    end_ms=duration_ms,
                    transcript=transcript or "",
                    split_reason="原片段"
                )]
            )
        
        # 2. 时长不符合，需要分片
        invalid_reason = get_invalid_reason(duration_seconds)
        logger.info(f"[SmartSplit] Clip {clip_id} 需要分片: {invalid_reason}")
        
        # 3. 尝试分句策略
        if transcript and len(transcript.strip()) > 10:
            segments = await self._split_by_sentence(
                clip_id, duration_ms, transcript, words_with_timing
            )
            if segments and len(segments) > 1:
                # 验证所有分片都在有效区间
                all_valid = all(is_valid_duration(seg.duration_seconds) for seg in segments)
                if all_valid:
                    logger.info(f"[SmartSplit] 分句策略成功: {len(segments)} 个分片")
                    return SplitPlan(
                        clip_id=clip_id,
                        original_duration_ms=duration_ms,
                        needs_split=True,
                        split_reason=invalid_reason,
                        split_strategy="sentence",
                        segments=segments
                    )
                else:
                    # 分句结果不完美，尝试调整
                    adjusted = self._adjust_segments_to_valid_range(segments, duration_ms)
                    if adjusted:
                        logger.info(f"[SmartSplit] 分句+调整策略成功: {len(adjusted)} 个分片")
                        return SplitPlan(
                            clip_id=clip_id,
                            original_duration_ms=duration_ms,
                            needs_split=True,
                            split_reason=invalid_reason,
                            split_strategy="sentence",
                            segments=adjusted
                        )
        
        # 4. 回退到固定时长策略
        segments = self._split_by_fixed_duration(clip_id, duration_ms, transcript)
        logger.info(f"[SmartSplit] 固定时长策略: {len(segments)} 个分片")
        
        return SplitPlan(
            clip_id=clip_id,
            original_duration_ms=duration_ms,
            needs_split=True,
            split_reason=invalid_reason,
            split_strategy="fixed_duration",
            segments=segments
        )
    
    async def _split_by_sentence(
        self,
        clip_id: str,
        duration_ms: int,
        transcript: str,
        words_with_timing: Optional[List[dict]] = None
    ) -> List[ClipSegment]:
        """
        按分句策略切分
        
        核心思路：
        1. 按句子边界分割
        2. 确保每个分片都在有效时长区间（2-5秒或7-10秒）
        3. 智能合并/拆分以满足约束
        
        适用于：
        - >10秒视频：切成多个 7-10秒片段
        - 5-7秒视频：切成两个 2-5秒片段
        """
        import re
        
        duration_seconds = duration_ms / 1000
        
        # 句子分割（按句末标点）
        sentence_pattern = r'[。！？!?]+'
        sentences = re.split(sentence_pattern, transcript.strip())
        sentences = [s.strip() for s in sentences if s.strip()]
        
        if len(sentences) <= 1:
            return []
        
        logger.info(f"[SmartSplit] 初步分句: {len(sentences)} 个句子, 总时长 {duration_seconds:.1f}s")
        
        # 计算平均每句时长
        avg_sentence_duration_ms = duration_ms / len(sentences)
        avg_sentence_duration_s = avg_sentence_duration_ms / 1000
        
        # ★★★ 根据总时长确定目标分片时长 ★★★
        if duration_seconds > 10:
            # >10秒：目标切成 7-10 秒的分片
            target_min = 7.0
            target_max = 10.0
        elif 5 < duration_seconds < 7:
            # 5-7秒：目标切成 2-5 秒的分片
            target_min = 2.0
            target_max = 5.0
        else:
            # 其他情况（<2秒或其他）
            target_min = 2.0
            target_max = 5.0
        
        target_duration_s = (target_min + target_max) / 2  # 目标时长取中间值
        
        logger.info(f"[SmartSplit] 目标分片时长: {target_min:.1f}-{target_max:.1f}s, 中间值 {target_duration_s:.1f}s")
        
        segments = []
        current_start = 0
        current_sentences = []
        current_duration_estimate = 0
        
        for i, sentence in enumerate(sentences):
            sentence_duration = avg_sentence_duration_ms
            
            current_sentences.append(sentence)
            current_duration_estimate += sentence_duration
            current_duration_seconds = current_duration_estimate / 1000
            
            # 检查剩余部分
            remaining_sentences = len(sentences) - i - 1
            remaining_duration = remaining_sentences * avg_sentence_duration_ms
            remaining_seconds = remaining_duration / 1000
            
            # ★★★ 判断是否应该在此切分 ★★★
            should_split = False
            
            # 情况1: 当前时长在目标范围内，且剩余部分也能形成有效分片
            if target_min <= current_duration_seconds <= target_max:
                if remaining_sentences == 0:
                    # 最后一个分片
                    should_split = True
                elif remaining_seconds >= target_min:
                    # 剩余部分足够形成一个有效分片
                    should_split = True
            
            # 情况2: 当前时长接近目标上限，应该切分
            elif current_duration_seconds >= target_max * 0.9:
                should_split = True
            
            # 情况3: 这是最后一句，必须结束
            if i == len(sentences) - 1:
                should_split = True
            
            if should_split and current_sentences:
                current_end = current_start + int(current_duration_estimate)
                segments.append(ClipSegment(
                    id=str(uuid4()),
                    parent_clip_id=clip_id,
                    start_ms=current_start,
                    end_ms=min(current_end, duration_ms),
                    transcript="。".join(current_sentences) + "。",
                    split_reason="分句边界"
                ))
                current_start = current_end
                current_sentences = []
                current_duration_estimate = 0
        
        # 处理剩余部分（如果有）
        if current_sentences:
            current_end = duration_ms
            remaining_duration = (current_end - current_start) / 1000
            
            # 如果剩余部分太短，合并到最后一个分片
            if remaining_duration < target_min and segments:
                last_seg = segments[-1]
                segments[-1] = ClipSegment(
                    id=last_seg.id,
                    parent_clip_id=clip_id,
                    start_ms=last_seg.start_ms,
                    end_ms=current_end,
                    transcript=last_seg.transcript + "。".join(current_sentences),
                    split_reason=last_seg.split_reason
                )
            else:
                segments.append(ClipSegment(
                    id=str(uuid4()),
                    parent_clip_id=clip_id,
                    start_ms=current_start,
                    end_ms=current_end,
                    transcript="。".join(current_sentences),
                    split_reason="最后一段"
                ))
        
        # ★★★ 验证分片结果 ★★★
        valid_count = sum(1 for seg in segments if is_valid_duration(seg.duration_seconds))
        logger.info(f"[SmartSplit] 分句结果: {len(segments)} 个分片, {valid_count} 个在有效区间")
        
        for i, seg in enumerate(segments):
            logger.info(f"[SmartSplit]   分片 {i+1}: {seg.duration_seconds:.1f}s, 有效={is_valid_duration(seg.duration_seconds)}")
        
        return segments
    
    def _adjust_segments_to_valid_range(
        self,
        segments: List[ClipSegment],
        total_duration_ms: int
    ) -> List[ClipSegment]:
        """
        调整分片以确保都在有效时长区间
        
        策略：
        1. 合并太短的分片
        2. 拆分太长的分片
        """
        if not segments:
            return segments
        
        adjusted = []
        buffer_segment = None
        
        for seg in segments:
            if buffer_segment:
                # 尝试合并
                merged_duration = (seg.end_ms - buffer_segment.start_ms) / 1000
                if is_valid_duration(merged_duration):
                    # 合并后在有效区间，执行合并
                    buffer_segment = ClipSegment(
                        id=buffer_segment.id,
                        parent_clip_id=seg.parent_clip_id,
                        start_ms=buffer_segment.start_ms,
                        end_ms=seg.end_ms,
                        transcript=buffer_segment.transcript + seg.transcript,
                        split_reason="合并调整"
                    )
                    if is_valid_duration(buffer_segment.duration_seconds):
                        adjusted.append(buffer_segment)
                        buffer_segment = None
                    continue
                else:
                    # 合并后超出范围，先保存 buffer，处理当前
                    if is_valid_duration(buffer_segment.duration_seconds):
                        adjusted.append(buffer_segment)
                    buffer_segment = None
            
            # 处理当前分片
            if is_valid_duration(seg.duration_seconds):
                adjusted.append(seg)
            elif seg.duration_seconds < MIN_SEGMENT_DURATION:
                # 太短，放入 buffer 等待合并
                buffer_segment = seg
            else:
                # 太长，需要拆分
                sub_segments = self._split_long_segment(seg)
                adjusted.extend(sub_segments)
        
        # 处理剩余 buffer
        if buffer_segment:
            if adjusted:
                # 合并到最后一个
                last = adjusted[-1]
                adjusted[-1] = ClipSegment(
                    id=last.id,
                    parent_clip_id=last.parent_clip_id,
                    start_ms=last.start_ms,
                    end_ms=buffer_segment.end_ms,
                    transcript=last.transcript + buffer_segment.transcript,
                    split_reason="末尾合并"
                )
            else:
                adjusted.append(buffer_segment)
        
        return adjusted
    
    def _split_long_segment(self, segment: ClipSegment) -> List[ClipSegment]:
        """拆分过长的分片"""
        duration_seconds = segment.duration_seconds
        
        # 选择目标时长
        if duration_seconds > 10:
            # 优先用长分片（9秒），尽量减少分片数量
            target = TARGET_DURATION_LONG
        else:
            # 5-7秒区间，拆成两个短分片
            target = TARGET_DURATION_SHORT
        
        target_ms = int(target * 1000)
        
        segments = []
        current_start = segment.start_ms
        remaining = segment.duration_ms
        
        while remaining > 0:
            if remaining <= target_ms * 1.2:
                # 剩余部分接近目标，作为最后一个分片
                segments.append(ClipSegment(
                    id=str(uuid4()),
                    parent_clip_id=segment.parent_clip_id,
                    start_ms=current_start,
                    end_ms=segment.end_ms,
                    transcript="",  # 无法拆分文本
                    split_reason=f"固定时长拆分 ({len(segments)+1})"
                ))
                break
            else:
                current_end = current_start + target_ms
                segments.append(ClipSegment(
                    id=str(uuid4()),
                    parent_clip_id=segment.parent_clip_id,
                    start_ms=current_start,
                    end_ms=current_end,
                    transcript="",
                    split_reason=f"固定时长拆分 ({len(segments)+1})"
                ))
                current_start = current_end
                remaining = segment.end_ms - current_end
        
        return segments
    
    def _split_by_fixed_duration(
        self,
        clip_id: str,
        duration_ms: int,
        transcript: Optional[str] = None
    ) -> List[ClipSegment]:
        """
        按固定时长切分
        
        策略：
        1. >10秒：按 9 秒切分（在 7-10 区间）
        2. 5-7秒：切成两个约 3 秒的分片（在 2-5 区间）
        """
        duration_seconds = duration_ms / 1000
        
        # 选择目标时长
        if duration_seconds > 10:
            # 长视频：优先用长分片
            target_seconds = TARGET_DURATION_LONG  # 9秒
        else:
            # 5-7秒区间：切成两个短分片
            target_seconds = duration_seconds / 2  # 2.5-3.5秒
        
        target_ms = int(target_seconds * 1000)
        
        segments = []
        current_start = 0
        segment_index = 0
        
        while current_start < duration_ms:
            remaining = duration_ms - current_start
            
            if remaining <= target_ms * 1.3:
                # 剩余部分在可接受范围，作为最后一个分片
                segments.append(ClipSegment(
                    id=str(uuid4()),
                    parent_clip_id=clip_id,
                    start_ms=current_start,
                    end_ms=duration_ms,
                    transcript="",
                    split_reason=f"固定时长分片 {segment_index + 1}"
                ))
                break
            else:
                current_end = current_start + target_ms
                segments.append(ClipSegment(
                    id=str(uuid4()),
                    parent_clip_id=clip_id,
                    start_ms=current_start,
                    end_ms=current_end,
                    transcript="",
                    split_reason=f"固定时长分片 {segment_index + 1}"
                ))
                current_start = current_end
                segment_index += 1
        
        # 验证所有分片都在有效区间
        for seg in segments:
            if not is_valid_duration(seg.duration_seconds):
                logger.warning(f"[SmartSplit] 分片 {seg.id} 时长 {seg.duration_seconds:.1f}s 不在有效区间")
        
        return segments


# ==========================================
# 辅助函数
# ==========================================

async def get_clip_info_from_db(clip_id: str) -> Optional[dict]:
    """从数据库获取 clip 信息"""
    from .supabase_client import supabase
    
    try:
        result = supabase.table("clips").select(
            "id, asset_id, start_time, end_time, content_text"
        ).eq("id", clip_id).single().execute()
        
        if result.data:
            clip = result.data
            # 计算时长
            start_ms = clip.get("start_time", 0)
            end_ms = clip.get("end_time", 0)
            duration_ms = end_ms - start_ms
            
            return {
                "id": clip_id,
                "asset_id": clip.get("asset_id"),
                "start_ms": start_ms,
                "end_ms": end_ms,
                "duration_ms": duration_ms,
                "transcript": clip.get("content_text", ""),
            }
        return None
    except Exception as e:
        logger.error(f"[SmartSplit] 获取 clip 信息失败: {e}")
        return None


# ==========================================
# 单例
# ==========================================

_splitter_instance: Optional[SmartClipSplitter] = None


def get_smart_clip_splitter() -> SmartClipSplitter:
    """获取分片服务单例"""
    global _splitter_instance
    if _splitter_instance is None:
        _splitter_instance = SmartClipSplitter()
    return _splitter_instance
