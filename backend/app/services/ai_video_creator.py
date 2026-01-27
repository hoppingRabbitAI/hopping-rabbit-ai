"""
AI 一键成片核心服务
整合 VAD + ASR + CV + LLM 实现智能剪辑

重构说明 (2026-01):
- 运镜规则已迁移至 transform_rules.py
- 使用可扩展的规则引擎架构
- 聚焦"AI修改视频比例"能力
"""

import logging
import asyncio
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from enum import Enum

# 从规则引擎导入类型和引擎
from app.services.transform_rules import (
    EmotionType,
    ImportanceLevel,
    EasingType,
    SegmentContext,
    TransformParams,
    transform_engine,
    sequence_processor,
    DEFAULT_CENTER_X,
    DEFAULT_CENTER_Y,
)

logger = logging.getLogger(__name__)


# ============================================
# 配置常量
# ============================================

# 片段时长阈值 (毫秒)
MIN_SEGMENT_DURATION_MS = 500  # 片段最小有效时长
SHORT_GAP_MERGE_THRESHOLD_MS = 300  # 短间隙合并阈值
FOCUS_WORD_EXTENSION_MS = 500  # 焦点词扩展时长

# 人脸检测默认值
DEFAULT_FACE_CENTER_Y_OFFSET = 0.4  # 口播常见构图，稍微偏上

# 缩放阈值
MIN_SCALE_DELTA_THRESHOLD = 0.03  # 缩放变化最小阈值

# 位移计算系数
POSITION_OFFSET_FACTOR = 0.8  # 位置偏移系数

# 毫秒转秒
MS_TO_SECONDS = 1000.0


@dataclass
class SmartSegment:
    """智能切片结构"""
    id: str
    start: float  # 毫秒
    end: float    # 毫秒
    text: str
    
    # 视觉分析结果
    has_face: bool = False
    face_center_x: float = DEFAULT_CENTER_X
    face_center_y: float = DEFAULT_CENTER_Y
    face_ratio: float = 0.0
    
    # LLM 分析结果 (Phase 4)
    emotion: EmotionType = EmotionType.NEUTRAL
    importance: ImportanceLevel = ImportanceLevel.MEDIUM
    keywords: List[str] = field(default_factory=list)
    focus_word: str = ""  # 突出的关键词（用于突然放大）
    
    # 词级时间戳信息 (ASR 2.0)
    words: List[Dict] = field(default_factory=list)
    
    # 生成的运镜参数
    transform: Optional[Dict] = None  # 元信息 dict（向后兼容）
    transform_params: Optional[TransformParams] = None  # 完整的 TransformParams 对象
    
    # 元数据 (保留静音分级等信息)
    metadata: Optional[Dict] = field(default_factory=dict)
    
    @property
    def duration(self) -> float:
        """时长 (毫秒)"""
        return self.end - self.start
    
    @property
    def duration_seconds(self) -> float:
        """时长 (秒)"""
        return self.duration / MS_TO_SECONDS
    
    @property
    def is_breath(self) -> bool:
        """是否为换气片段"""
        return self.metadata.get("is_breath", False) if self.metadata else False
    
    @property
    def is_silence(self) -> bool:
        """是否为静音片段"""
        return self.metadata.get("silence_info") is not None if self.metadata else False


@dataclass
class AIEditingResult:
    """AI 剪辑结果"""
    segments: List[SmartSegment]
    total_duration: float
    speech_duration: float
    clips_count: int
    subtitles: List[Dict]
    metadata: Dict = field(default_factory=dict)


# ============================================
# 核心服务类
# ============================================

class AIVideoCreatorService:
    """
    一键 AI 成片服务
    
    Pipeline:
    1. 预处理 -> 2. 智能切片 (VAD+ASR) -> 3. 视觉分析 -> 4. 运镜决策 -> 5. 输出
    """
    
    def __init__(self) -> None:
        self._vision_service: Optional[Any] = None
        self._llm_service: Optional[Any] = None
    
    @property
    def vision_service(self) -> Any:
        """懒加载视觉服务"""
        if self._vision_service is None:
            from app.features.vision import vision_service
            self._vision_service = vision_service
        return self._vision_service
    
    async def process(
        self,
        video_path: str,
        audio_url: str,
        options: Optional[Dict] = None
    ) -> AIEditingResult:
        """
        执行一键成片流程
        
        Args:
            video_path: 本地视频文件路径
            audio_url: 音频文件的公网 URL (用于 ASR)
            options: 可选配置 (如 style, enable_llm, transcript_segments 等)
        
        Returns:
            AIEditingResult: 包含所有切片和运镜数据
        """
        options = options or {}
        enable_llm = options.get("enable_llm", False)
        existing_segments = options.get("transcript_segments")  # 复用已有的 ASR 结果
        
        logger.info(f"\n{'='*60}")
        logger.info(f"🚀 [AI Creator] 开始一键成片流程")
        logger.info(f"{'='*60}")
        logger.info(f"📁 视频文件: {video_path}")
        logger.info(f"🔧 LLM 启用: {enable_llm}")
        
        # Step 1: 智能切片 (复用已有 ASR 或重新调用)
        logger.info(f"\n📍 Step 1: 智能切片 (ASR)")
        logger.info("-" * 40)
        if existing_segments:
            logger.info(f"   ✓ 复用已有 ASR 结果: {len(existing_segments)} 个片段")
            segments = self._convert_to_smart_segments(existing_segments)
        else:
            logger.info("   → 调用 ASR 服务进行语音识别...")
            segments = await self._step1_smart_segmentation(audio_url)
        
        # 打印片段摘要
        total_text_len = sum(len(s.text) for s in segments)
        breath_count = sum(1 for s in segments if s.is_breath)
        logger.info(f"   ✓ 有效片段: {len(segments)} 个")
        logger.info(f"   ✓ 换气片段: {breath_count} 个")
        logger.info(f"   ✓ 总文本长度: {total_text_len} 字符")
        
        # Step 2: 视觉分析 (MediaPipe)
        logger.info(f"\n📍 Step 2: 视觉分析 (人脸检测)")
        logger.info("-" * 40)
        segments = await self._step2_visual_analysis(video_path, segments)
        
        # 打印视觉分析结果
        face_segments = [s for s in segments if s.has_face]
        logger.info(f"   ✓ 有人脸片段: {len(face_segments)}/{len(segments)} 个")
        
        # Step 3: LLM 语义分析 (可选)
        if enable_llm:
            logger.info(f"\n📍 Step 3: LLM 语义分析 (豆包大模型)")
            logger.info("-" * 40)
            segments = await self._step3_llm_analysis(segments)
        else:
            logger.info(f"\n📍 Step 3: LLM 语义分析 [已跳过]")
            logger.info("   ⚠️ enable_llm=False，使用默认情绪和重要性")
        
        # Step 4: 生成运镜决策
        logger.info(f"\n📍 Step 4: 运镜决策 (规则引擎)")
        logger.info("-" * 40)
        segments = self._step4_generate_transform(segments)
        
        # Step 5: 生成字幕数据
        logger.info(f"\n📍 Step 5: 生成字幕数据")
        logger.info("-" * 40)
        subtitles = self._generate_subtitles(segments)
        logger.info(f"   ✓ 字幕条数: {len(subtitles)} 条")
        
        # 汇总统计
        total_duration = segments[-1].end if segments else 0
        speech_duration = sum(s.duration for s in segments)
        
        logger.info(f"\n{'='*60}")
        logger.info(f"✅ [AI Creator] 一键成片完成!")
        logger.info(f"{'='*60}")
        logger.info(f"📊 总时长: {total_duration/1000:.1f}s")
        logger.info(f"📊 语音时长: {speech_duration/1000:.1f}s")
        logger.info(f"📊 片段数: {len(segments)} 个")
        logger.info(f"{'='*60}\n")
        
        return AIEditingResult(
            segments=segments,
            total_duration=total_duration,
            speech_duration=speech_duration,
            clips_count=len(segments),
            subtitles=subtitles,
            metadata={
                "enable_llm": enable_llm,
                "video_path": video_path
            }
        )
    
    async def _step1_smart_segmentation(self, audio_url: str) -> List[SmartSegment]:
        """
        Step 1: 使用 ASR 进行智能切片
        """
        from app.tasks.transcribe import transcribe_audio
        
        result = await transcribe_audio(
            audio_url=audio_url,
            enable_word_timestamps=True
        )
        
        segments = []
        for seg in result.get("segments", []):
            # 过滤无效片段
            if seg.get("is_deleted"):
                continue
            
            # 过滤静音片段
            if seg.get("silence_info"):
                continue
            
            text = seg.get("text", "").strip()
            if not text:
                continue
            
            smart_seg = SmartSegment(
                id=seg.get("id", ""),
                start=seg.get("start", 0),
                end=seg.get("end", 0),
                text=text,
                words=seg.get("words", [])
            )
            
            # 过滤过短的片段 (< MIN_SEGMENT_DURATION_MS)
            if smart_seg.duration >= MIN_SEGMENT_DURATION_MS:
                segments.append(smart_seg)
        
        # 合并间隔过短的相邻片段 (< SHORT_GAP_MERGE_THRESHOLD_MS)
        segments = self._merge_short_gaps(segments, min_gap_ms=SHORT_GAP_MERGE_THRESHOLD_MS)
        
        return segments
    
    def _refine_segments_with_focus(self, segments: List[SmartSegment]) -> List[SmartSegment]:
        """
        根据 LLM 识别的 focus_word 和 ASR 的 words 时间戳，细化切分片段
        实现"突然放大"的效果：将一个长片段切分为 Pre -> Focus(Instant Zoom) -> Post
        """
        refined_segments = []
        count_refined = 0
        
        for seg in segments:
            # 1. 基础校验：无焦点词或无词级时间戳，直接保留
            if not seg.focus_word or not seg.words:
                refined_segments.append(seg)
                continue
            
            # 2. 查找焦点词 (Focus Word) 在 words 列表中的位置
            # focus_word 可能是短语，这里简化处理，匹配单个词
            focus_text = seg.focus_word.strip()
            found_idx = -1
            found_word = None
            
            # 匹配逻辑：包含匹配
            for i, w in enumerate(seg.words):
                w_text = w.get("text", "")
                # 移除标点后比较
                clean_w = w_text.strip(".,?!，。？！")
                clean_f = focus_text.strip(".,?!，。？！")
                
                if clean_f and (clean_f in clean_w or clean_w in clean_f):
                    found_idx = i
                    found_word = w
                    break
            
            if not found_word:
                # 没找到对应词的时间戳，无法切分，保留原样
                refined_segments.append(seg)
                continue
                
            # 3. 执行切分
            count_refined += 1
            
            w_start = found_word.get("start", 0)
            w_end = found_word.get("end", 0)
            
            # A. 前段 (Pre-focus)
            if w_start > seg.start + 100: # 最小间隔 100ms
                pre_text = "".join([w.get("text","") for w in seg.words[:found_idx]])
                pre_seg = SmartSegment(
                    id=f"{seg.id}_pre",
                    start=seg.start,
                    end=w_start,
                    text=pre_text or "...",
                    has_face=seg.has_face,
                    face_center_x=seg.face_center_x,
                    face_center_y=seg.face_center_y,
                    emotion=seg.emotion,
                    importance=ImportanceLevel.MEDIUM, # 降级为普通
                    words=seg.words[:found_idx]
                )
                refined_segments.append(pre_seg)
            
            # B. 焦点段 (Focus) - 核心部分
            # 稍微延长一点结束时间以展示效果，但不能超过原片段结束时间
            focus_seg_end = min(w_end + FOCUS_WORD_EXTENSION_MS, seg.end) 
            
            focus_seg = SmartSegment(
                id=f"{seg.id}_focus",
                start=w_start,
                end=focus_seg_end,
                text=found_word.get("text", focus_text),
                has_face=seg.has_face,
                face_center_x=seg.face_center_x,
                face_center_y=seg.face_center_y,
                emotion=seg.emotion,
                importance=ImportanceLevel.HIGH, # 提升为高重要性
                metadata={"is_emphasis": True, "focus_word": focus_text}, # 标记，供规则引擎使用
                words=[found_word] 
            )
            refined_segments.append(focus_seg)
            
            # C. 后段 (Post-focus)
            if focus_seg_end < seg.end - 100:
                post_text = "".join([w.get("text","") for w in seg.words[found_idx+1:]])
                post_seg = SmartSegment(
                    id=f"{seg.id}_post",
                    start=focus_seg_end,
                    end=seg.end,
                    text=post_text or "...",
                    has_face=seg.has_face,
                    face_center_x=seg.face_center_x,
                    face_center_y=seg.face_center_y,
                    emotion=seg.emotion, # 保持原情绪，或重置
                    importance=ImportanceLevel.MEDIUM,
                    words=seg.words[found_idx+1:]
                )
                refined_segments.append(post_seg)

        if count_refined > 0:
            logger.info(f"   ⚡️ [SmartRefine] 基于焦点词细化了 {count_refined} 个切片 (Sudden Zoom)")
            
        return refined_segments

    def _convert_to_smart_segments(self, asr_segments: List[Dict]) -> List[SmartSegment]:
        """
        将已有的 ASR segments 转换为 SmartSegment
        
        保留精细的静音分级逻辑:
        - dead_air (死寂 >3s): 跳过
        - long_pause (句末长停顿 >2s): 跳过
        - hesitation (句中卡顿 >500ms): 跳过
        - breath (换气): 保留 (用户可选择删除)
        - uncertain: 保留
        - 语音片段: 正常处理
        """
        segments = []
        
        # 统计
        skipped_count = {"dead_air": 0, "long_pause": 0, "hesitation": 0}
        breath_count = 0
        
        for seg in asr_segments:
            silence_info = seg.get("silence_info")
            
            # 处理静音片段
            if silence_info:
                classification = silence_info.get("classification")
                
                # 死寂、长停顿、卡顿 → 自动跳过
                if classification in ("dead_air", "long_pause", "hesitation"):
                    skipped_count[classification] = skipped_count.get(classification, 0) + 1
                    continue
                
                # 换气 → 保留（创建一个空文本的 segment，后续生成视频 clip 时会保留时长）
                if classification == "breath":
                    breath_count += 1
                    smart_seg = SmartSegment(
                        id=seg.get("id", ""),
                        start=seg.get("start", 0),
                        end=seg.get("end", 0),
                        text="",  # 换气没有文字
                    )
                    # 标记为换气，后续可用于运镜决策
                    smart_seg.metadata = {"is_breath": True, "silence_info": silence_info}
                    segments.append(smart_seg)
                    continue
                
                # uncertain → 保留
                if classification == "uncertain":
                    smart_seg = SmartSegment(
                        id=seg.get("id", ""),
                        start=seg.get("start", 0),
                        end=seg.get("end", 0),
                        text="",
                    )
                    smart_seg.metadata = {"is_uncertain": True, "silence_info": silence_info}
                    segments.append(smart_seg)
                    continue
            
            # 语音片段
            text = seg.get("text", "").strip()
            if not text:
                continue
            
            seg_start = seg.get("start", 0)
            seg_end = seg.get("end", 0)
            duration = seg_end - seg_start
            
            # 过滤过短的片段 (< 200ms)
            if duration < 200:
                continue

            smart_seg = SmartSegment(
                id=seg.get("id", ""),
                start=seg_start,
                end=seg_end,
                text=text,
                words=seg.get("words", [])
            )
            segments.append(smart_seg)
        
        logger.info(f"[AI Creator] Converted ASR segments: {len(segments)} kept, "
                   f"skipped: {skipped_count}, breaths: {breath_count}")
        
        return segments
    
    def _merge_short_gaps(
        self, 
        segments: List[SmartSegment], 
        min_gap_ms: float = SHORT_GAP_MERGE_THRESHOLD_MS
    ) -> List[SmartSegment]:
        """合并间隔过短的相邻片段"""
        if len(segments) <= 1:
            return segments
        
        merged = [segments[0]]
        
        for seg in segments[1:]:
            prev = merged[-1]
            gap = seg.start - prev.end
            
            if gap < min_gap_ms:
                # 合并：扩展前一个片段
                prev.end = seg.end
                prev.text = prev.text + " " + seg.text
            else:
                merged.append(seg)
        
        return merged
    
    async def _step2_visual_analysis(
        self, 
        video_path: str, 
        segments: List[SmartSegment]
    ) -> List[SmartSegment]:
        """
        Step 2: 视觉分析（使用 MediaPipe 人脸检测）
        
        检测每个片段中的人脸位置，用于精准的运镜推进效果。
        """
        logger.info("   → 开始视觉分析（人脸检测）...")
        
        try:
            vision = self.vision_service
            detected_count = 0
            
            for seg in segments:
                if seg.is_breath:
                    # 换气片段跳过检测，使用默认值
                    seg.has_face = True
                    seg.face_center_x = DEFAULT_CENTER_X
                    seg.face_center_y = DEFAULT_FACE_CENTER_Y_OFFSET
                    seg.face_ratio = 0.0
                    continue
                
                try:
                    # 调用视觉服务检测人脸
                    result = vision.analyze_clip_region(
                        video_path=video_path,
                        start_time=seg.start / MS_TO_SECONDS,
                        end_time=seg.end / MS_TO_SECONDS,
                        sample_rate=1.0  # 每秒采样 1 帧
                    )
                    
                    seg.has_face = result.get("has_face", False)
                    seg.face_center_x = result.get("center_x", DEFAULT_CENTER_X)
                    seg.face_center_y = result.get("center_y", DEFAULT_FACE_CENTER_Y_OFFSET)
                    seg.face_ratio = result.get("face_ratio", 0.0)
                    
                    if seg.has_face:
                        detected_count += 1
                        
                except Exception as e:
                    # 单个片段检测失败，使用默认值
                    logger.debug(f"      片段 {seg.id} 人脸检测失败: {e}，使用默认值")
                    seg.has_face = True
                    seg.face_center_x = DEFAULT_CENTER_X
                    seg.face_center_y = DEFAULT_FACE_CENTER_Y_OFFSET
                    seg.face_ratio = 0.0
            
            logger.info(f"   ✓ 视觉分析完成: {detected_count}/{len(segments)} 个片段检测到人脸")
            
        except Exception as e:
            # 整体检测失败，使用默认值
            logger.warning(f"   ⚠️ 视觉分析失败: {e}，使用默认人脸位置")
            for seg in segments:
                seg.has_face = True
                seg.face_center_x = DEFAULT_CENTER_X
                seg.face_center_y = DEFAULT_FACE_CENTER_Y_OFFSET
                seg.face_ratio = 0.0
        
        return segments
    
    async def _step3_llm_analysis(
        self, 
        segments: List[SmartSegment]
    ) -> List[SmartSegment]:
        """
        Step 3: 使用 LLM 分析文本情绪和重要性
        """
        from app.services.llm_service import analyze_segments_batch, is_llm_configured
        
        if not is_llm_configured():
            logger.warning("   ⚠️ LLM API 未配置，跳过语义分析")
            return segments
        
        # 过滤出有文本的片段
        text_segments = [{"id": s.id, "text": s.text} for s in segments if s.text.strip()]
        logger.info(f"   → 待分析片段: {len(text_segments)} 个 (有文本)")
        
        if not text_segments:
            logger.info("   ⚠️ 没有需要分析的文本片段")
            return segments
        
        # 打印部分文本预览
        preview_count = min(3, len(text_segments))
        logger.info(f"   → 文本预览 (前{preview_count}条):")
        for i, seg in enumerate(text_segments[:preview_count]):
            text_preview = seg['text'][:50] + '...' if len(seg['text']) > 50 else seg['text']
            logger.info(f"      [{i+1}] {text_preview}")
        
        try:
            logger.info(f"   → 调用豆包 LLM 进行情绪分析...")
            analyzed = await analyze_segments_batch(text_segments)
            
            logger.info(f"   ✓ LLM 返回 {len(analyzed)} 条分析结果")
            
            # 统计情绪分布
            emotion_counts = {}
            importance_counts = {}
            
            # 更新分析结果
            for seg in segments:
                if seg.id in analyzed:
                    result = analyzed[seg.id]
                    seg.emotion = EmotionType(result.get("emotion", "neutral"))
                    seg.importance = ImportanceLevel(result.get("importance", "medium"))
                    seg.keywords = result.get("keywords", [])
                    seg.focus_word = result.get("focus_word", "")
                    
                    # 统计
                    emotion_counts[seg.emotion.value] = emotion_counts.get(seg.emotion.value, 0) + 1
                    importance_counts[seg.importance.value] = importance_counts.get(seg.importance.value, 0) + 1
            
            # 打印分析结果统计
            logger.info(f"   📊 情绪分布: {emotion_counts}")
            logger.info(f"   📊 重要性分布: {importance_counts}")
            
            # 打印部分详细结果
            analyzed_segs = [s for s in segments if s.id in analyzed]
            logger.info(f"   → 详细结果预览 (前5条):")
            for seg in analyzed_segs[:5]:
                text_preview = seg.text[:30] + '...' if len(seg.text) > 30 else seg.text
                keywords_str = ', '.join(seg.keywords[:3]) if seg.keywords else '-'
                logger.info(f"      [{seg.emotion.value:8}|{seg.importance.value:6}] \"{text_preview}\" 关键词: {keywords_str}")
            
            # 细化焦点词切片 (New)
            segments = self._refine_segments_with_focus(segments)
                    
        except Exception as e:
            logger.warning(f"   ❌ LLM 分析失败: {e}")
            logger.info("   → 使用默认情绪和重要性")
        
        return segments
    
    def _step4_generate_transform(
        self, 
        segments: List[SmartSegment]
    ) -> List[SmartSegment]:
        """
        Step 4: 根据分析结果生成运镜参数
        
        使用可扩展的规则引擎 (transform_rules.py)：
        - EmotionZoomRule: 情绪驱动的缩放规则
        - NoFaceZoomRule: 无人脸时的 Ken Burns 效果
        - ShortClipRule: 短片段处理
        - BreathClipRule: 换气片段处理
        
        新增：序列感知后处理器 (SequenceAwarePostProcessor)
        - 避免连续片段使用相同运镜效果
        - 高潮后自动插入"呼吸"片段
        - 确保视觉节奏多样性
        
        规则引擎支持后续扩展更多规则，如转场、特效等。
        """
        # 重置序列处理器状态
        sequence_processor.reset()
        
        # 构建规则引擎上下文列表
        contexts = []
        for seg in segments:
            context = SegmentContext(
                segment_id=seg.id,
                duration_ms=seg.duration,
                text=seg.text,
                has_face=seg.has_face,
                face_center_x=seg.face_center_x,
                face_center_y=seg.face_center_y,
                face_ratio=seg.face_ratio,
                emotion=seg.emotion,
                importance=seg.importance,
                keywords=seg.keywords,
                is_breath=seg.is_breath,
                metadata=seg.metadata or {},
            )
            contexts.append(context)
        
        # 使用规则引擎批量处理
        params_list = [transform_engine.process(ctx) for ctx in contexts]
        
        # 序列感知后处理：确保运镜多样性
        params_contexts = list(zip(params_list, contexts))
        processed_params = sequence_processor.process_batch(params_contexts)
        
        # 转换为元信息并赋值（关键帧由调用方生成并存入 keyframes 表）
        for seg, params in zip(segments, processed_params):
            seg.transform = params.get_meta()  # 元信息 dict（向后兼容）
            seg.transform_params = params  # 完整的 TransformParams 对象（用于生成关键帧）
        
        # 打印运镜决策统计
        rule_counts = {}
        strategy_counts = {"keyframe": 0, "instant": 0, "static": 0}
        
        for seg in segments:
            rule = seg.transform.get('_rule_applied', 'unknown') if seg.transform else 'none'
            rule_name = rule.split(':')[0]  # 取规则名
            rule_counts[rule_name] = rule_counts.get(rule_name, 0) + 1
            
            # 统计策略类型
            strategy = seg.transform.get('_strategy', 'unknown') if seg.transform else 'none'
            if 'keyframe' in strategy:
                strategy_counts["keyframe"] += 1
            elif 'instant' in strategy:
                strategy_counts["instant"] += 1
            else:
                strategy_counts["static"] += 1
        
        logger.info(f"   📊 规则应用统计: {rule_counts}")
        logger.info(f"   🎬 运镜策略分布: keyframe={strategy_counts['keyframe']}, instant={strategy_counts['instant']}, static={strategy_counts['static']}")
        
        # 打印部分运镜决策详情
        logger.info(f"   → 运镜决策详情 (前5条):")
        for seg in segments[:5]:
            if seg.transform:
                rule = seg.transform.get('_rule_applied', 'unknown')
                strategy = seg.transform.get('_strategy', 'unknown')
                text_preview = seg.text[:20] + '...' if len(seg.text) > 20 else (seg.text or '[换气]')
                logger.info(f"      [{rule:25}] strategy={strategy:15} | \"{text_preview}\"")
        
        return segments
    
    def _generate_subtitles(self, segments: List[SmartSegment]) -> List[Dict]:
        """生成字幕数据"""
        return [
            {
                "id": seg.id,
                "text": seg.text,
                "start": seg.start,
                "end": seg.end,
                "style": "default"
            }
            for seg in segments
        ]


# 单例导出
ai_video_creator = AIVideoCreatorService()
