"""
Clip 智能拆分服务

分析 Clip 内容，智能拆分为更小的片段
支持基于 transcript（分句）和场景变化（分镜）的拆分

设计原则：
1. 优先使用 transcript 进行分句拆分
2. 如果无 transcript，临时调用 ASR 服务获取
3. 返回拆分建议，用户确认后执行
4. 保持父子关系追溯 (parent_clip_id)
"""

import logging
from typing import Optional, List, Tuple
from dataclasses import dataclass
from uuid import uuid4

logger = logging.getLogger(__name__)


# ==========================================
# 数据模型
# ==========================================

@dataclass
class SplitPoint:
    """拆分点"""
    time_ms: int          # 拆分时间点（毫秒）
    confidence: float     # 置信度 0-1
    reason: str           # 拆分原因
    transcript: str = ""  # 该片段的转写文本


@dataclass
class SplitSegment:
    """拆分后的片段"""
    start_ms: int
    end_ms: int
    transcript: str
    confidence: float
    
    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


@dataclass
class SplitAnalysisResult:
    """拆分分析结果"""
    can_split: bool
    reason: str
    segments: List[SplitSegment]
    split_strategy: str  # 'sentence' | 'scene' | 'none'
    
    @property
    def segment_count(self) -> int:
        return len(self.segments)


# ==========================================
# 分析逻辑
# ==========================================

MIN_SEGMENT_DURATION_MS = 3000  # 最小片段时长 3 秒（避免拆分太细）
MIN_CLIP_DURATION_MS = 5000     # 可拆分的最小 clip 时长 5 秒
TARGET_SEGMENT_DURATION_MS = 10000  # 目标片段时长 10 秒（用于合并短句）


def analyze_transcript_for_split(
    transcript: str,
    clip_start_ms: int,
    clip_end_ms: int,
    words_with_timing: Optional[List[dict]] = None
) -> Tuple[bool, List[SplitSegment]]:
    """
    分析 transcript 并确定拆分点
    
    Args:
        transcript: 完整转写文本
        clip_start_ms: clip 起始时间
        clip_end_ms: clip 结束时间
        words_with_timing: 带时间戳的词列表 [{"word": "...", "start": ms, "end": ms}]
        
    Returns:
        (can_split, segments)
    """
    if not transcript or not transcript.strip():
        return False, []
    
    clip_duration = clip_end_ms - clip_start_ms
    
    # ★ 改进的句子分割逻辑：
    # 1. 只按句末标点分割（句号、问号、感叹号）
    # 2. 逗号不作为分句点（避免拆分太细）
    import re
    
    # 只匹配句末标点：中英文句号、问号、感叹号
    sentence_pattern = r'[。！？!?]+'
    
    # 分割句子
    sentences = re.split(sentence_pattern, transcript.strip())
    sentences = [s.strip() for s in sentences if s.strip() and len(s.strip()) > 5]
    
    logger.info(f"[ClipSplit] 初步分句: {len(sentences)} 个句子")
    
    if len(sentences) <= 1:
        return False, []
    
    # ★ 合并短句：如果句子太短（< 20 字符），合并到下一句
    merged_sentences = []
    buffer = ""
    for s in sentences:
        buffer += s
        # 如果累积文本足够长（> 30 字符），作为一个独立句子
        if len(buffer) >= 30:
            merged_sentences.append(buffer)
            buffer = ""
        else:
            buffer += "。"  # 保留分隔
    if buffer:
        if merged_sentences:
            merged_sentences[-1] += buffer  # 并入最后一句
        else:
            merged_sentences.append(buffer)
    
    sentences = merged_sentences
    logger.info(f"[ClipSplit] 合并短句后: {len(sentences)} 个句子")
    
    # 如果有词级时间戳，使用精确拆分
    if words_with_timing and len(words_with_timing) > 0:
        return _split_by_word_timing(sentences, words_with_timing, clip_start_ms, clip_end_ms)
    
    # 没有词级时间戳，按句子数量均分时间
    return _split_by_even_distribution(sentences, clip_start_ms, clip_end_ms)


def _split_by_word_timing(
    sentences: List[str],
    words: List[dict],
    clip_start_ms: int,
    clip_end_ms: int
) -> Tuple[bool, List[SplitSegment]]:
    """
    基于词级时间戳精确拆分
    
    改进策略：
    1. 按句子边界分割
    2. 如果分出的片段太短（< MIN_SEGMENT_DURATION_MS），合并到下一句
    3. 确保片段数量合理（不超过 clip 时长 / 5秒）
    """
    clip_duration = clip_end_ms - clip_start_ms
    max_segments = max(2, clip_duration // 5000)  # 最多每 5 秒一个片段
    
    logger.info(f"[ClipSplit] 开始精确分割: {len(sentences)} 个句子, clip 时长 {clip_duration/1000:.1f}s, 最多 {max_segments} 个片段")
    
    segments = []
    current_sentence_idx = 0
    current_segment_start = clip_start_ms
    accumulated_text = ""
    accumulated_sentences = []
    
    for i, word_info in enumerate(words):
        # 兼容两种格式: {"word": "...", "end": ...} 或 {"text": "...", "end_time": ...}
        word = word_info.get("word") or word_info.get("text", "")
        word_end = int(word_info.get("end") or word_info.get("end_time", 0))
        
        accumulated_text += word
        
        # 检查是否匹配到当前句子的结尾
        if current_sentence_idx < len(sentences):
            target_sentence = sentences[current_sentence_idx]
            # 简化匹配：检查累积文本是否包含目标句子的主要内容
            if len(accumulated_text) >= len(target_sentence) * 0.8:
                accumulated_sentences.append(target_sentence)
                segment_duration = word_end - current_segment_start
                
                # ★ 只有当时长 >= MIN_SEGMENT_DURATION_MS 时才创建新片段
                # 否则继续累积到下一句
                if segment_duration >= MIN_SEGMENT_DURATION_MS:
                    segments.append(SplitSegment(
                        start_ms=current_segment_start,
                        end_ms=word_end,
                        transcript="".join(accumulated_sentences),
                        confidence=0.9
                    ))
                    current_segment_start = word_end
                    accumulated_text = ""
                    accumulated_sentences = []
                
                current_sentence_idx += 1
    
    # 处理最后一个片段
    if current_segment_start < clip_end_ms:
        remaining_sentences = accumulated_sentences + sentences[current_sentence_idx:]
        if remaining_sentences and clip_end_ms - current_segment_start >= MIN_SEGMENT_DURATION_MS:
            segments.append(SplitSegment(
                start_ms=current_segment_start,
                end_ms=clip_end_ms,
                transcript="".join(remaining_sentences),
                confidence=0.8
            ))
        elif segments and remaining_sentences:
            # 并入最后一个片段
            segments[-1] = SplitSegment(
                start_ms=segments[-1].start_ms,
                end_ms=clip_end_ms,
                transcript=segments[-1].transcript + "".join(remaining_sentences),
                confidence=0.8
            )
    
    # ★ 如果片段太多，进一步合并
    if len(segments) > max_segments:
        logger.info(f"[ClipSplit] 片段数 {len(segments)} > 最大 {max_segments}，进行合并...")
        segments = _merge_short_segments(segments, max_segments)
    
    logger.info(f"[ClipSplit] 最终分割: {len(segments)} 个片段")
    return len(segments) > 1, segments


def _merge_short_segments(segments: List[SplitSegment], max_count: int) -> List[SplitSegment]:
    """合并短片段，确保片段数不超过 max_count"""
    if len(segments) <= max_count:
        return segments
    
    # 计算需要合并的次数
    merge_count = len(segments) - max_count
    
    # 找到最短的片段进行合并
    for _ in range(merge_count):
        if len(segments) <= max_count:
            break
        
        # 找到时长最短的片段（不是第一个也不是最后一个更好）
        min_duration = float('inf')
        min_idx = 1
        for i in range(1, len(segments)):
            duration = segments[i].duration_ms
            if duration < min_duration:
                min_duration = duration
                min_idx = i
        
        # 合并到前一个片段
        if min_idx > 0:
            prev = segments[min_idx - 1]
            curr = segments[min_idx]
            merged = SplitSegment(
                start_ms=prev.start_ms,
                end_ms=curr.end_ms,
                transcript=prev.transcript + curr.transcript,
                confidence=min(prev.confidence, curr.confidence)
            )
            segments = segments[:min_idx-1] + [merged] + segments[min_idx+1:]
    
    return segments


def _split_by_even_distribution(
    sentences: List[str],
    clip_start_ms: int,
    clip_end_ms: int
) -> Tuple[bool, List[SplitSegment]]:
    """基于句子数量均分时间"""
    clip_duration = clip_end_ms - clip_start_ms
    segment_duration = clip_duration // len(sentences)
    
    # 如果均分后片段太短，减少拆分数量
    if segment_duration < MIN_SEGMENT_DURATION_MS:
        # 计算最多能拆成几个片段
        max_segments = clip_duration // MIN_SEGMENT_DURATION_MS
        if max_segments <= 1:
            return False, []
        # 合并句子
        merged_sentences = []
        sentences_per_segment = len(sentences) // max_segments + 1
        for i in range(0, len(sentences), sentences_per_segment):
            merged = " ".join(sentences[i:i+sentences_per_segment])
            merged_sentences.append(merged)
        sentences = merged_sentences[:max_segments]
        segment_duration = clip_duration // len(sentences)
    
    segments = []
    for i, sentence in enumerate(sentences):
        start = clip_start_ms + i * segment_duration
        end = clip_start_ms + (i + 1) * segment_duration if i < len(sentences) - 1 else clip_end_ms
        
        segments.append(SplitSegment(
            start_ms=start,
            end_ms=end,
            transcript=sentence,
            confidence=0.6  # 均分的置信度较低
        ))
    
    return len(segments) > 1, segments


async def _fetch_asr_for_clip(clip: dict, supabase_client) -> Tuple[str, List[dict]]:
    """
    临时调用 ASR 服务获取 clip 的语音转写结果
    
    流程：下载视频 → 提取音频 → 上传到 Supabase → 调用 ASR
    
    Args:
        clip: Clip 数据
        supabase_client: Supabase 客户端
        
    Returns:
        (transcript, words_with_timing)
    """
    import os
    import asyncio
    import tempfile
    import hashlib
    from app.tasks.transcribe import transcribe_audio
    from app.config import get_settings
    
    settings = get_settings()
    asset_id = clip.get("asset_id")
    if not asset_id:
        return "", []
    
    # 获取 asset 信息
    asset_result = supabase_client.table("assets").select(
        "storage_path, hls_path, cloudflare_uid, project_id"
    ).eq("id", asset_id).single().execute()
    
    if not asset_result.data:
        logger.warning(f"[ClipSplit] Asset {asset_id} 不存在")
        return "", []
    
    asset = asset_result.data
    storage_path = asset.get("storage_path", "")
    
    # 1. 确定视频下载 URL
    if storage_path.startswith("cloudflare:"):
        video_uid = storage_path.replace("cloudflare:", "")
        download_url = f"https://videodelivery.net/{video_uid}/manifest/video.m3u8"
    elif storage_path.startswith("http"):
        download_url = storage_path
    else:
        # Supabase Storage
        from app.services.supabase_client import get_file_url
        download_url = get_file_url("clips", storage_path, expires_in=3600)
        if not download_url:
            logger.warning(f"[ClipSplit] 无法获取视频 URL: {storage_path}")
            return "", []
    
    logger.info(f"[ClipSplit] 视频 URL: {download_url[:60]}...")
    
    # 2. 检查是否已有提取的音频缓存
    audio_storage_path = f"asr_audio/{asset_id}.mp3"
    try:
        result = supabase_client.storage.from_("clips").create_signed_url(audio_storage_path, 3600)
        cached_url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        if cached_url:
            logger.info(f"[ClipSplit] ✅ 使用缓存音频")
            audio_url = cached_url
        else:
            audio_url = None
    except Exception:
        audio_url = None
    
    # 3. 如果没有缓存，下载视频并提取音频
    if not audio_url:
        temp_dir = settings.cache_dir or tempfile.gettempdir()
        path_hash = hashlib.md5(asset_id.encode()).hexdigest()[:12]
        temp_video_path = os.path.join(temp_dir, f"clip_split_{path_hash}.mp4")
        temp_audio_path = os.path.join(temp_dir, f"asr_{asset_id}.mp3")
        
        try:
            # 下载视频
            if not os.path.exists(temp_video_path):
                logger.info(f"[ClipSplit] 开始下载视频 (URL: {download_url[:80]}...)")
                process = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y",
                    "-i", download_url,
                    "-c", "copy",
                    "-movflags", "+faststart",
                    temp_video_path,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                try:
                    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
                except asyncio.TimeoutError:
                    process.kill()
                    logger.error(f"[ClipSplit] ❌ 视频下载超时 (5分钟)")
                    raise ValueError("视频下载超时")
                if process.returncode != 0:
                    raise ValueError(f"视频下载失败: {stderr.decode()[:200]}")
                logger.info(f"[ClipSplit] ✅ 视频下载完成 -> {temp_video_path}")
            else:
                logger.info(f"[ClipSplit] ✅ 使用缓存视频: {temp_video_path}")
            
            # 提取音频
            logger.info(f"[ClipSplit] 提取音频...")
            process = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y",
                "-i", temp_video_path,
                "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", "-f", "mp3",
                temp_audio_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60)
            except asyncio.TimeoutError:
                process.kill()
                logger.error(f"[ClipSplit] ❌ 音频提取超时 (1分钟)")
                raise ValueError("音频提取超时")
            if process.returncode != 0:
                raise ValueError(f"音频提取失败: {stderr.decode()[:200]}")
            logger.info(f"[ClipSplit] ✅ 音频提取完成 -> {temp_audio_path}")
            
            # 上传音频到 Supabase
            with open(temp_audio_path, "rb") as f:
                audio_data = f.read()
            logger.info(f"[ClipSplit] 上传音频 ({len(audio_data) / 1024:.1f} KB)...")
            
            try:
                supabase_client.storage.from_("clips").upload(
                    audio_storage_path, audio_data,
                    {"content-type": "audio/mpeg", "upsert": "true"}
                )
            except Exception as e:
                if "Duplicate" not in str(e):
                    raise
            
            # 获取签名 URL
            result = supabase_client.storage.from_("clips").create_signed_url(audio_storage_path, 3600)
            audio_url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
            logger.info(f"[ClipSplit] ✅ 音频上传完成")
            
        except Exception as e:
            logger.error(f"[ClipSplit] 准备音频失败: {e}")
            return "", []
    
    # 4. 调用 ASR 服务
    logger.info(f"[ClipSplit] 调用 ASR 服务...")
    try:
        asr_result = await transcribe_audio(
            audio_url=audio_url,
            language="zh",
            audio_format="mp3",
            enable_word_timestamps=True,
        )
        
        segments = asr_result.get("segments", [])
        
        # ★ 先保存 ASR 结果到 asset.metadata（不管是否有相关片段）
        if segments:
            try:
                existing_metadata = supabase_client.table("assets").select("metadata").eq("id", asset_id).single().execute()
                current_metadata = existing_metadata.data.get("metadata") or {}
                if not current_metadata.get("transcript_segments"):
                    current_metadata["transcript_segments"] = segments
                    supabase_client.table("assets").update({
                        "metadata": current_metadata
                    }).eq("id", asset_id).execute()
                    logger.info(f"[ClipSplit] ✅ ASR 结果已保存 ({len(segments)} 个片段)")
            except Exception as e:
                logger.warning(f"[ClipSplit] 保存 ASR 结果失败: {e}")
        
        if not segments:
            return "", []
        
        # 筛选与 clip 时间范围重叠的 segments
        # 注意：clip 的 source_start/source_end 单位是毫秒
        # ASR 返回的 start/end 单位也是毫秒
        source_start = clip.get("source_start", 0)
        source_end = clip.get("source_end", clip.get("end_time", 0) - clip.get("start_time", 0))
        
        logger.info(f"[ClipSplit] 筛选 segments: clip 范围 {source_start}ms - {source_end}ms ({source_start/1000:.1f}s - {source_end/1000:.1f}s)")
        
        relevant_segments = []
        for seg in segments:
            # ASR 返回的时间单位是毫秒
            seg_start_ms = int(seg.get("start", 0))
            seg_end_ms = int(seg.get("end", 0))
            if seg_start_ms < source_end and seg_end_ms > source_start:
                relevant_segments.append(seg)
        
        logger.info(f"[ClipSplit] 筛选到 {len(relevant_segments)}/{len(segments)} 个相关片段")
        
        if not relevant_segments:
            return "", []
        
        transcript = " ".join([s.get("text", "") for s in relevant_segments])
        all_words = []
        for seg in relevant_segments:
            if seg.get("words"):
                all_words.extend(seg["words"])
        
        return transcript, all_words
        
    except Exception as e:
        logger.error(f"[ClipSplit] ASR 调用失败: {e}")
        return "", []


async def analyze_clip_for_split(
    clip_id: str,
    supabase_client,
    strategy: str = "sentence"
) -> SplitAnalysisResult:
    """
    分析 clip 是否可以拆分
    
    Args:
        clip_id: Clip ID
        supabase_client: Supabase 客户端
        strategy: 拆分策略 (sentence | scene | paragraph)
        
    Returns:
        SplitAnalysisResult
    """
    logger.info(f"[ClipSplit] 分析 clip {clip_id[:8]}... 策略: {strategy}")
    
    # 1. 获取 clip 信息
    clip_result = supabase_client.table("clips").select("*").eq("id", clip_id).single().execute()
    
    if not clip_result.data:
        return SplitAnalysisResult(
            can_split=False,
            reason="片段不存在",
            segments=[],
            split_strategy="none"
        )
    
    clip = clip_result.data
    clip_start = clip.get("start_time", 0)
    clip_end = clip.get("end_time", 0)
    clip_duration = clip_end - clip_start
    
    # ★ 源视频时间（用于与 ASR 时间戳匹配）
    source_start = clip.get("source_start", 0)
    source_end = clip.get("source_end", clip_duration)
    
    # 2. 检查时长是否足够
    if clip_duration < MIN_CLIP_DURATION_MS:
        return SplitAnalysisResult(
            can_split=False,
            reason=f"片段时长太短（{clip_duration/1000:.1f}秒），无法拆分",
            segments=[],
            split_strategy="none"
        )
    
    # 3. 获取 transcript（从 clip metadata 或关联的 transcript）
    transcript = clip.get("metadata", {}).get("transcript") or clip.get("content_text") or ""
    words_with_timing = clip.get("metadata", {}).get("words") or []
    
    # 如果 clip 本身没有 transcript，尝试从 asset 的 ASR 结果获取
    if not transcript and clip.get("asset_id"):
        asset_id = clip["asset_id"]
        
        try:
            # ★ 从 assets.metadata.transcript_segments 获取 ASR 结果
            asset_result = supabase_client.table("assets").select(
                "metadata"
            ).eq("id", asset_id).single().execute()
            
            if asset_result.data:
                asset_metadata = asset_result.data.get("metadata") or {}
                transcript_segments = asset_metadata.get("transcript_segments") or []
                
                # 筛选与 clip 时间范围重叠的 segments
                # 注意：ASR 返回的 start/end 单位已经是毫秒
                relevant_segments = []
                for seg in transcript_segments:
                    # ASR 返回的时间单位是毫秒
                    seg_start = int(seg.get("start", 0))
                    seg_end = int(seg.get("end", 0))
                    
                    # 检查是否与 clip 时间范围有重叠
                    if seg_start < source_end and seg_end > source_start:
                        relevant_segments.append(seg)
                
                if relevant_segments:
                    transcript = " ".join([s.get("text", "") for s in relevant_segments])
                    # 合并所有 words
                    all_words = []
                    for seg in relevant_segments:
                        if seg.get("words"):
                            all_words.extend(seg["words"])
                    words_with_timing = all_words
                    logger.info(f"[ClipSplit] 从 asset.metadata 获取 {len(relevant_segments)} 个 transcript segments")
        except Exception as e:
            logger.warning(f"[ClipSplit] 获取 transcript 失败: {e}")
    
    # ★ 治标治本：如果没有 ASR 数据，且需要分句/分段落，临时调用 ASR 服务
    if not transcript and strategy in ("sentence", "paragraph") and clip.get("asset_id"):
        logger.info(f"[ClipSplit] 没有 ASR 数据，临时调用 ASR 服务...")
        try:
            transcript, words_with_timing = await _fetch_asr_for_clip(
                clip, supabase_client
            )
            if transcript:
                logger.info(f"[ClipSplit] ASR 完成，获取到 {len(words_with_timing)} 个词")
        except Exception as e:
            logger.warning(f"[ClipSplit] 临时 ASR 调用失败: {e}")
    
    # 4. 根据策略进行拆分
    if strategy == "scene":
        # 场景拆分 - 基于画面变化
        # TODO: 实现场景变化检测，目前返回不支持
        return SplitAnalysisResult(
            can_split=False,
            reason="分镜拆分功能开发中，请使用分句或分段落",
            segments=[],
            split_strategy="scene"
        )
    
    elif strategy == "paragraph":
        # 段落拆分 - 基于语义分析
        if not transcript:
            return SplitAnalysisResult(
                can_split=False,
                reason="该片段没有检测到语音内容",
                segments=[],
                split_strategy="paragraph"
            )
        # TODO: 使用 LLM 进行语义段落划分，目前使用分句作为回退
        # ★ 使用源视频时间（与 ASR 时间戳匹配）
        can_split, segments = analyze_transcript_for_split(
            transcript, source_start, source_end, words_with_timing
        )
        if can_split and len(segments) > 1:
            return SplitAnalysisResult(
                can_split=True,
                reason=f"检测到 {len(segments)} 个语义段落，可以拆分",
                segments=segments,
                split_strategy="paragraph"
            )
        else:
            return SplitAnalysisResult(
                can_split=False,
                reason="该片段内容较短，无法划分段落",
                segments=[],
                split_strategy="paragraph"
            )
    
    else:
        # 默认：分句拆分
        if not transcript:
            return SplitAnalysisResult(
                can_split=False,
                reason="该片段没有检测到语音内容",
                segments=[],
                split_strategy="sentence"
            )
        
        # ★ 使用源视频时间（与 ASR 时间戳匹配）
        can_split, segments = analyze_transcript_for_split(
            transcript, source_start, source_end, words_with_timing
        )
        
        if can_split and len(segments) > 1:
            return SplitAnalysisResult(
                can_split=True,
                reason=f"检测到 {len(segments)} 个句子，可以拆分",
                segments=segments,
                split_strategy="sentence"
            )
        else:
            return SplitAnalysisResult(
                can_split=False,
                reason="该片段内容为单一语句，无法进一步拆分",
                segments=[],
                split_strategy="sentence"
            )


async def execute_clip_split(
    clip_id: str,
    segments: List[SplitSegment],
    supabase_client
) -> List[dict]:
    """
    执行 clip 拆分
    
    Args:
        clip_id: 原始 clip ID
        segments: 拆分后的片段列表
        supabase_client: Supabase 客户端
        
    Returns:
        新创建的 clips 列表
    """
    from datetime import datetime
    
    # 1. 获取原始 clip
    clip_result = supabase_client.table("clips").select("*").eq("id", clip_id).single().execute()
    if not clip_result.data:
        raise ValueError(f"Clip {clip_id} 不存在")
    
    original_clip = clip_result.data
    now = datetime.utcnow().isoformat()
    
    # ★ 原始 clip 的时间信息
    orig_start_time = original_clip["start_time"]  # timeline 上的开始位置
    orig_end_time = original_clip["end_time"]      # timeline 上的结束位置
    orig_source_start = original_clip.get("source_start", 0)  # 源视频开始点
    orig_duration = orig_end_time - orig_start_time
    
    # ★ 原始 clip 的 metadata（用于继承缩略图）
    original_metadata = original_clip.get("metadata", {}) or {}
    
    # 2. 创建新 clips
    # ★ segment 的 start_ms/end_ms 是相对于源视频的时间（即 source_start 基准）
    # 需要转换为 timeline 上的位置
    new_clips = []
    current_timeline_pos = orig_start_time  # 新 clip 在 timeline 上的位置
    
    for i, segment in enumerate(segments):
        # 计算片段时长
        segment_duration = segment.end_ms - segment.start_ms
        
        new_clip = {
            "id": str(uuid4()),
            "track_id": original_clip["track_id"],
            "asset_id": original_clip.get("asset_id"),
            "parent_clip_id": clip_id,
            "clip_type": original_clip.get("clip_type", "video"),
            # ★ timeline 上的位置：顺序排列
            "start_time": current_timeline_pos,
            "end_time": current_timeline_pos + segment_duration,
            # ★ 源视频中的位置：保持与 ASR 一致
            "source_start": segment.start_ms,
            "source_end": segment.end_ms,
            "volume": original_clip.get("volume", 1.0),
            "is_muted": original_clip.get("is_muted", False),
            "speed": original_clip.get("speed", 1.0),
            "cached_url": original_clip.get("cached_url"),
            "metadata": {
                "transcript": segment.transcript,
                "split_index": i,
                "split_confidence": segment.confidence,
                "split_from": clip_id,
                # ★ 治标治本：先继承原始 clip 的缩略图
                "thumbnail_url": original_metadata.get("thumbnail_url"),
            },
            "created_at": now,
            "updated_at": now,
        }
        new_clips.append(new_clip)
        current_timeline_pos += segment_duration  # 下一个 clip 紧接着排列
    
    # 3. 批量插入新 clips（先保存，让用户立即看到结果）
    if new_clips:
        result = supabase_client.table("clips").insert(new_clips).execute()
        
        # 4. 删除原始 clip
        supabase_client.table("clips").delete().eq("id", clip_id).execute()
        
        logger.info(f"[ClipSplit] ✅ 拆分完成: {clip_id} -> {len(new_clips)} 个片段")
        
        # 5. ★ 治标治本：同步生成缩略图（确保前端刷新后能看到新缩略图）
        asset_id = original_clip.get("asset_id")
        track_id = original_clip.get("track_id")
        if asset_id and track_id:
            try:
                await _generate_thumbnails_sync(
                    result.data, asset_id, track_id, supabase_client
                )
            except Exception as e:
                logger.warning(f"[ClipSplit] 缩略图生成失败，但拆分已完成: {e}")
        
        return result.data
    
    return []


async def _generate_thumbnails_sync(
    clips: List[dict],
    asset_id: str,
    track_id: str,
    supabase_client
):
    """
    ★ 治标治本：同步为拆分后的 clips 生成精确缩略图
    
    在拆分完成后同步执行，确保前端刷新时能看到新缩略图
    """
    import tempfile
    import subprocess
    import os
    import shutil
    
    try:
        # 1. 获取视频 URL
        asset_result = supabase_client.table("assets").select("*").eq("id", asset_id).single().execute()
        if not asset_result.data:
            logger.warning(f"[ClipSplit Thumbnail] Asset {asset_id} 不存在")
            return
        
        asset = asset_result.data
        video_url = asset.get("cf_stream_url") or asset.get("storage_url") or asset.get("cached_url")
        if not video_url:
            logger.warning(f"[ClipSplit Thumbnail] 无法获取视频 URL")
            return
        
        # 2. 获取 session_id 和项目比例
        track_result = supabase_client.table("tracks").select("project_id").eq("id", track_id).single().execute()
        if not track_result.data:
            return
        
        project_id = track_result.data.get("project_id")
        session_result = supabase_client.table("workspace_sessions").select("id").eq(
            "project_id", project_id
        ).order("created_at", desc=True).limit(1).execute()
        
        session_id = session_result.data[0].get("id") if session_result.data else "unknown"
        
        # ★ 获取项目目标比例
        target_aspect = None
        try:
            project_result = supabase_client.table("projects").select("resolution").eq("id", project_id).single().execute()
            if project_result.data and project_result.data.get("resolution"):
                resolution = project_result.data["resolution"]
                if resolution.get("width") and resolution.get("height"):
                    if resolution["width"] > resolution["height"]:
                        target_aspect = "16:9"
                    else:
                        target_aspect = "9:16"
                    logger.info(f"[ClipSplit Thumbnail] 📐 目标比例: {target_aspect}")
        except Exception as e:
            logger.warning(f"[ClipSplit Thumbnail] 获取项目比例失败: {e}")
        
        # 3. 下载视频（如果是 HLS）
        temp_dir = tempfile.mkdtemp(prefix="clip_thumb_sync_")
        video_path = video_url
        
        if 'videodelivery.net' in video_url or 'm3u8' in video_url:
            temp_video = os.path.join(temp_dir, "video.mp4")
            cmd = [
                "ffmpeg", "-y", "-i", video_url,
                "-c", "copy", "-bsf:a", "aac_adtstoasc",
                temp_video
            ]
            logger.info(f"[ClipSplit Thumbnail] 下载视频...")
            result = subprocess.run(cmd, capture_output=True, timeout=300)
            if result.returncode == 0 and os.path.exists(temp_video):
                video_path = temp_video
            else:
                logger.warning(f"[ClipSplit Thumbnail] 视频下载失败")
                shutil.rmtree(temp_dir, ignore_errors=True)
                return
        
        # ★ 获取视频尺寸（用于裁剪）
        src_width, src_height = 1920, 1080
        crop_filter = None
        if target_aspect:
            try:
                probe_cmd = [
                    "ffprobe", "-v", "quiet",
                    "-select_streams", "v:0",
                    "-show_entries", "stream=width,height",
                    "-of", "csv=p=0",
                    video_path
                ]
                result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
                if result.returncode == 0 and result.stdout.strip():
                    parts = result.stdout.strip().split(',')
                    if len(parts) == 2:
                        src_width, src_height = int(parts[0]), int(parts[1])
                        src_ratio = src_width / src_height
                        target_ratio = 16/9 if target_aspect == "16:9" else 9/16
                        if abs(src_ratio - target_ratio) / target_ratio > 0.05:
                            if src_ratio > target_ratio:
                                new_w = int(src_height * target_ratio)
                                new_h = src_height
                                x = (src_width - new_w) // 2
                                y = 0
                            else:
                                new_w = src_width
                                new_h = int(src_width / target_ratio)
                                x = 0
                                y = (src_height - new_h) // 2
                            crop_filter = f"crop={new_w}:{new_h}:{x}:{y}"
                            logger.info(f"[ClipSplit Thumbnail] ✂️ 裁剪: {crop_filter}")
            except Exception as e:
                logger.warning(f"[ClipSplit Thumbnail] 获取尺寸失败: {e}")
        
        # 4. 为每个 clip 生成缩略图
        STORAGE_BUCKET = "ai-creations"
        success_count = 0
        
        for i, clip in enumerate(clips):
            clip_id = clip.get("id")
            source_start = clip.get("source_start", 0)
            source_end = clip.get("source_end", source_start + 1000)
            mid_time_sec = (source_start + source_end) / 2 / 1000
            
            local_filename = f"clip_{i:03d}_{clip_id[:8]}.jpg"
            output_path = os.path.join(temp_dir, local_filename)
            
            try:
                # 构建滤镜链
                filter_parts = []
                if crop_filter:
                    filter_parts.append(crop_filter)
                if target_aspect == "9:16":
                    filter_parts.append("scale=-2:'min(568,ih)'")
                else:
                    filter_parts.append("scale='min(320,iw)':-2")
                
                video_filter = ",".join(filter_parts) if filter_parts else None
                
                # 提取帧
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(mid_time_sec),
                    "-i", video_path,
                    "-vframes", "1",
                ]
                if video_filter:
                    cmd.extend(["-vf", video_filter])
                cmd.extend(["-q:v", "2", output_path])
                
                result = subprocess.run(cmd, capture_output=True, timeout=30)
                
                if result.returncode != 0 or not os.path.exists(output_path):
                    continue
                
                # 上传到 Supabase
                storage_path = f"shot_thumbnails/{session_id}/{local_filename}"
                
                with open(output_path, "rb") as f:
                    file_data = f.read()
                
                try:
                    supabase_client.storage.from_(STORAGE_BUCKET).remove([storage_path])
                except:
                    pass
                
                supabase_client.storage.from_(STORAGE_BUCKET).upload(
                    storage_path, file_data, {"content-type": "image/jpeg"}
                )
                
                public_url = supabase_client.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
                
                # 更新数据库中的 clip
                current_clip = supabase_client.table("clips").select("metadata").eq("id", clip_id).single().execute()
                if current_clip.data:
                    metadata = current_clip.data.get("metadata", {}) or {}
                    metadata["thumbnail_url"] = public_url
                    supabase_client.table("clips").update({"metadata": metadata}).eq("id", clip_id).execute()
                
                success_count += 1
                os.remove(output_path)
                
            except Exception as e:
                logger.warning(f"[ClipSplit Thumbnail] clip {clip_id[:8]} 失败: {e}")
                continue
        
        # 清理
        shutil.rmtree(temp_dir, ignore_errors=True)
        logger.info(f"[ClipSplit Thumbnail] ✅ 同步生成完成: {success_count}/{len(clips)} 个")
        
    except Exception as e:
        logger.error(f"[ClipSplit Thumbnail] 同步生成失败: {e}")
        import traceback
        traceback.print_exc()


async def _async_generate_thumbnails(
    clips: List[dict],
    asset_id: str,
    track_id: str,
    supabase_client
):
    """
    后台异步为拆分后的 clips 生成精确缩略图
    
    完成后直接更新数据库，前端下次刷新即可看到
    """
    import tempfile
    import subprocess
    import os
    import shutil
    
    try:
        # 1. 获取视频 URL
        asset_result = supabase_client.table("assets").select("*").eq("id", asset_id).single().execute()
        if not asset_result.data:
            logger.warning(f"[ClipSplit Thumbnail] Asset {asset_id} 不存在")
            return
        
        asset = asset_result.data
        video_url = asset.get("cf_stream_url") or asset.get("storage_url") or asset.get("cached_url")
        if not video_url:
            logger.warning(f"[ClipSplit Thumbnail] 无法获取视频 URL")
            return
        
        # 2. 获取 session_id 和项目比例
        track_result = supabase_client.table("tracks").select("project_id").eq("id", track_id).single().execute()
        if not track_result.data:
            return
        
        project_id = track_result.data.get("project_id")
        session_result = supabase_client.table("workspace_sessions").select("id").eq(
            "project_id", project_id
        ).order("created_at", desc=True).limit(1).execute()
        
        session_id = session_result.data[0].get("id") if session_result.data else "unknown"
        
        # ★★★ 获取项目目标比例 ★★★
        target_aspect = None
        try:
            project_result = supabase_client.table("projects").select("resolution").eq("id", project_id).single().execute()
            if project_result.data and project_result.data.get("resolution"):
                resolution = project_result.data["resolution"]
                if resolution.get("width") and resolution.get("height"):
                    if resolution["width"] > resolution["height"]:
                        target_aspect = "16:9"
                    else:
                        target_aspect = "9:16"
                    logger.info(f"[ClipSplit Thumbnail] 📐 目标比例: {target_aspect}")
        except Exception as e:
            logger.warning(f"[ClipSplit Thumbnail] 获取项目比例失败: {e}")
        
        # 3. 下载视频（如果是 HLS）
        temp_dir = tempfile.mkdtemp(prefix="clip_thumb_")
        video_path = video_url
        
        if 'videodelivery.net' in video_url or 'm3u8' in video_url:
            temp_video = os.path.join(temp_dir, "video.mp4")
            cmd = [
                "ffmpeg", "-y", "-i", video_url,
                "-c", "copy", "-bsf:a", "aac_adtstoasc",
                temp_video
            ]
            logger.info(f"[ClipSplit Thumbnail] 下载视频...")
            result = subprocess.run(cmd, capture_output=True, timeout=300)
            if result.returncode == 0 and os.path.exists(temp_video):
                video_path = temp_video
            else:
                logger.warning(f"[ClipSplit Thumbnail] 视频下载失败")
                shutil.rmtree(temp_dir, ignore_errors=True)
                return
        
        # ★★★ 获取视频尺寸（用于裁剪） ★★★
        src_width, src_height = 1920, 1080
        crop_filter = None
        if target_aspect:
            try:
                probe_cmd = [
                    "ffprobe", "-v", "quiet",
                    "-select_streams", "v:0",
                    "-show_entries", "stream=width,height",
                    "-of", "csv=p=0",
                    video_path
                ]
                result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
                if result.returncode == 0 and result.stdout.strip():
                    parts = result.stdout.strip().split(',')
                    if len(parts) == 2:
                        src_width, src_height = int(parts[0]), int(parts[1])
                        src_ratio = src_width / src_height
                        target_ratio = 16/9 if target_aspect == "16:9" else 9/16
                        if abs(src_ratio - target_ratio) / target_ratio > 0.05:
                            if src_ratio > target_ratio:
                                new_w = int(src_height * target_ratio)
                                new_h = src_height
                                x = (src_width - new_w) // 2
                                y = 0
                            else:
                                new_w = src_width
                                new_h = int(src_width / target_ratio)
                                x = 0
                                y = (src_height - new_h) // 2
                            crop_filter = f"crop={new_w}:{new_h}:{x}:{y}"
                            logger.info(f"[ClipSplit Thumbnail] ✂️ 裁剪: {crop_filter}")
            except Exception as e:
                logger.warning(f"[ClipSplit Thumbnail] 获取尺寸失败: {e}")
        
        # 4. 为每个 clip 生成缩略图
        STORAGE_BUCKET = "ai-creations"
        
        for i, clip in enumerate(clips):
            clip_id = clip.get("id")
            source_start = clip.get("source_start", 0)
            source_end = clip.get("source_end", source_start + 1000)
            mid_time_sec = (source_start + source_end) / 2 / 1000
            
            local_filename = f"clip_{i:03d}_{clip_id[:8]}.jpg"
            output_path = os.path.join(temp_dir, local_filename)
            
            try:
                # 构建滤镜链
                filter_parts = []
                if crop_filter:
                    filter_parts.append(crop_filter)
                if target_aspect == "9:16":
                    filter_parts.append("scale=-2:'min(568,ih)'")
                else:
                    filter_parts.append("scale='min(320,iw)':-2")
                
                video_filter = ",".join(filter_parts) if filter_parts else None
                
                # 提取帧
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(mid_time_sec),
                    "-i", video_path,
                    "-vframes", "1",
                ]
                if video_filter:
                    cmd.extend(["-vf", video_filter])
                cmd.extend(["-q:v", "2", output_path])
                
                result = subprocess.run(cmd, capture_output=True, timeout=30)
                
                if result.returncode != 0 or not os.path.exists(output_path):
                    continue
                
                # 上传到 Supabase
                storage_path = f"shot_thumbnails/{session_id}/{local_filename}"
                
                with open(output_path, "rb") as f:
                    file_data = f.read()
                
                try:
                    supabase_client.storage.from_(STORAGE_BUCKET).remove([storage_path])
                except:
                    pass
                
                supabase_client.storage.from_(STORAGE_BUCKET).upload(
                    storage_path, file_data, {"content-type": "image/jpeg"}
                )
                
                public_url = supabase_client.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
                
                # 更新数据库中的 clip
                current_clip = supabase_client.table("clips").select("metadata").eq("id", clip_id).single().execute()
                if current_clip.data:
                    metadata = current_clip.data.get("metadata", {}) or {}
                    metadata["thumbnail_url"] = public_url
                    supabase_client.table("clips").update({"metadata": metadata}).eq("id", clip_id).execute()
                
                logger.info(f"[ClipSplit Thumbnail] ✅ {clip_id[:8]} 缩略图已更新")
                os.remove(output_path)
                
            except Exception as e:
                logger.warning(f"[ClipSplit Thumbnail] clip {clip_id[:8]} 失败: {e}")
                continue
        
        # 清理
        shutil.rmtree(temp_dir, ignore_errors=True)
        logger.info(f"[ClipSplit Thumbnail] ✅ 全部完成，共 {len(clips)} 个")
        
    except Exception as e:
        logger.error(f"[ClipSplit Thumbnail] 异步生成失败: {e}")
        import traceback
        traceback.print_exc()



