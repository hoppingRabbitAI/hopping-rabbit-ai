"""
段落分镜策略 - 基于语义分析
使用 LLM 进行段落划分，然后映射回时间轴

设计原则：
- 时间单位统一使用毫秒 (ms)
- 支持递归分镜（对已有 clip 的指定范围进行段落分析）
"""

import logging
import json
from typing import Optional, Callable, List

from .base import BaseSegmentationStrategy
from ..types import SegmentationClip, SegmentationRequest, TranscriptSegment

logger = logging.getLogger(__name__)


# LLM Prompt 模板
PARAGRAPH_SEGMENTATION_PROMPT = """你是一个专业的视频编辑助手。请分析以下口播文稿，将其划分为有意义的段落/章节。

## 文稿内容

{transcript}

## 分句信息 (用于时间映射)

{sentences_info}

## 划分规则

1. 每个段落应该有一个完整的主题
2. 段落之间应该有明显的话题转换（如开场白、正文、总结等）
3. 每个段落建议 30-120 秒（除非内容特殊需要）
4. 段落数量建议 {target_count} 个左右
5. 开场问候和结尾可以独立成段

## 输出格式

请返回 JSON 格式，包含段落划分结果：
```json
{{
    "paragraphs": [
        {{
            "index": 0,
            "title": "段落标题（简洁描述）",
            "summary": "段落内容摘要（一句话）",
            "start_sentence_index": 0,
            "end_sentence_index": 3
        }}
    ]
}}
```

注意：
- start_sentence_index 和 end_sentence_index 是分句的索引（从 0 开始）
- end_sentence_index 是包含的（inclusive）
- 确保所有分句都被覆盖，不能遗漏

请只输出 JSON，不要其他解释。"""


class ParagraphSegmentationStrategy(BaseSegmentationStrategy):
    """
    段落分镜策略
    
    使用 LLM 分析文稿语义，将内容划分为有意义的段落
    适用于：内容有章节结构、话题切换明显的视频
    """
    
    name = "paragraph"
    description = "基于语义分析的段落分镜"
    
    async def segment(
        self,
        video_path: str,
        asset_id: str,
        transcript_segments: Optional[List[TranscriptSegment]] = None,
        params: Optional[SegmentationRequest] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> List[SegmentationClip]:
        """
        使用 LLM 进行段落划分
        """
        
        if on_progress:
            on_progress(10, "检查 ASR 转写结果...")
        
        # 验证输入
        if not transcript_segments or len(transcript_segments) == 0:
            logger.warning("没有 ASR 转写结果，无法进行段落分镜")
            raise ValueError("段落分镜需要 ASR 转写结果，请先执行语音识别")
        
        # 转换为统一格式
        segments = self._normalize_segments(transcript_segments)
        
        # 获取递归分镜范围
        range_start_ms, range_end_ms = self._get_segment_range(params)
        parent_clip_id = params.parent_clip_id if params else None
        
        # 如果是递归分镜，过滤出范围内的 segments
        if range_start_ms is not None:
            segments = self._filter_segments_by_range(segments, range_start_ms, range_end_ms)
        
        if not segments:
            logger.warning("指定范围内没有分句数据")
            return []
        
        if len(segments) < 3:
            logger.warning("分句数量太少，直接返回单个分镜")
            start_ms = segments[0]["start"]
            end_ms = segments[-1]["end"]
            return [self._create_clip(
                asset_id=asset_id,
                start_time_ms=0,
                end_time_ms=end_ms - start_ms,
                source_start_ms=start_ms,
                source_end_ms=end_ms,
                transcript="".join(s["text"] for s in segments),
                name="段落 1",
                parent_clip_id=parent_clip_id,
                metadata={"strategy": "paragraph", "paragraph_index": 0},
            )]
        
        if on_progress:
            on_progress(20, "准备 LLM 分析...")
        
        # 获取参数
        target_count = params.target_paragraph_count if params else None
        min_para_duration_ms = params.min_paragraph_duration_ms if params else 10000
        
        if not target_count:
            # 根据视频时长估算段落数量
            total_duration_ms = segments[-1]["end"] - segments[0]["start"]
            target_count = max(3, min(10, int(total_duration_ms / 60000)))  # 每分钟约 1 个段落
        
        # 构建完整文稿
        full_transcript = "".join(s["text"] for s in segments)
        
        # 构建分句信息 (用于 LLM 参考)
        sentences_info = "\n".join([
            f"[{i}] ({s['start']/1000:.1f}s - {s['end']/1000:.1f}s): {s['text'][:50]}..."
            if len(s['text']) > 50 else f"[{i}] ({s['start']/1000:.1f}s - {s['end']/1000:.1f}s): {s['text']}"
            for i, s in enumerate(segments)
        ])
        
        if on_progress:
            on_progress(30, "调用 LLM 分析段落结构...")
        
        # 调用 LLM
        paragraphs = await self._call_llm_for_paragraphs(
            transcript=full_transcript,
            sentences_info=sentences_info,
            target_count=target_count,
        )
        
        if on_progress:
            on_progress(70, f"LLM 返回 {len(paragraphs)} 个段落")
        
        # 验证和修正段落划分
        paragraphs = self._validate_paragraphs(paragraphs, len(segments))
        
        if on_progress:
            on_progress(80, "映射时间轴...")
        
        # 将段落映射到时间轴
        clips = self._map_paragraphs_to_timeline(paragraphs, segments, asset_id, parent_clip_id)
        
        if on_progress:
            on_progress(100, f"生成 {len(clips)} 个分镜")
        
        return self._validate_clips(clips, min_para_duration_ms)
    
    async def _call_llm_for_paragraphs(
        self,
        transcript: str,
        sentences_info: str,
        target_count: int,
    ) -> List[dict]:
        """
        调用 LLM 进行段落划分（使用豆包）
        """
        from app.services.llm.service import get_llm_service
        
        llm_service = get_llm_service()
        
        if not llm_service.is_configured():
            logger.error("未配置 LLM (豆包/Gemini)")
            raise ValueError("段落分镜需要 LLM 支持，请配置 VOLCENGINE_ARK_API_KEY")
        
        # 构建 prompt
        prompt = PARAGRAPH_SEGMENTATION_PROMPT.format(
            transcript=transcript[:5000],  # 限制长度
            sentences_info=sentences_info[:3000],
            target_count=target_count,
        )
        
        try:
            # 使用统一的 LLM 服务调用豆包
            content = await llm_service.call(
                prompt=prompt,
                temperature=0.3,
            )
            
            # 解析 JSON
            try:
                result = json.loads(content)
            except json.JSONDecodeError:
                # 尝试提取 JSON 块
                import re
                json_match = re.search(r'\{[\s\S]*\}', content)
                if json_match:
                    result = json.loads(json_match.group())
                else:
                    logger.error(f"无法解析 LLM 返回: {content[:200]}")
                    return []
            
            return result.get("paragraphs", [])
            
        except Exception as e:
            logger.error(f"LLM 调用失败: {e}")
            return []
    
    def _validate_paragraphs(
        self,
        paragraphs: List[dict],
        total_sentences: int,
    ) -> List[dict]:
        """
        验证和修正段落划分
        
        确保:
        1. 段落索引有效
        2. 段落之间没有间隙
        3. 段落覆盖所有分句
        """
        if not paragraphs:
            # 如果 LLM 没有返回有效结果，使用简单的均分策略
            logger.warning("LLM 未返回有效段落，使用均分策略")
            return self._fallback_paragraphs(total_sentences)
        
        # 按 start_sentence_index 排序
        paragraphs = sorted(paragraphs, key=lambda p: p.get("start_sentence_index", 0))
        
        # 验证索引范围
        validated = []
        prev_end = -1
        
        for para in paragraphs:
            start_idx = para.get("start_sentence_index", 0)
            end_idx = para.get("end_sentence_index", start_idx)
            
            # 修正越界
            start_idx = max(0, min(start_idx, total_sentences - 1))
            end_idx = max(start_idx, min(end_idx, total_sentences - 1))
            
            # 确保连续 (填补间隙)
            if prev_end >= 0 and start_idx > prev_end + 1:
                start_idx = prev_end + 1
            
            validated.append({
                "index": len(validated),
                "title": para.get("title", f"段落 {len(validated) + 1}"),
                "summary": para.get("summary", ""),
                "start_sentence_index": start_idx,
                "end_sentence_index": end_idx,
            })
            
            prev_end = end_idx
        
        # 确保覆盖到最后
        if validated and validated[-1]["end_sentence_index"] < total_sentences - 1:
            validated[-1]["end_sentence_index"] = total_sentences - 1
        
        return validated
    
    def _fallback_paragraphs(self, total_sentences: int) -> List[dict]:
        """
        备用方案：均分段落
        """
        # 每 5-8 句一个段落
        sentences_per_para = max(3, min(8, total_sentences // 3))
        paragraphs = []
        
        for i in range(0, total_sentences, sentences_per_para):
            end_idx = min(i + sentences_per_para - 1, total_sentences - 1)
            paragraphs.append({
                "index": len(paragraphs),
                "title": f"段落 {len(paragraphs) + 1}",
                "summary": "",
                "start_sentence_index": i,
                "end_sentence_index": end_idx,
            })
        
        return paragraphs
    
    def _map_paragraphs_to_timeline(
        self,
        paragraphs: List[dict],
        segments: List[dict],
        asset_id: str,
        parent_clip_id: Optional[str],
    ) -> List[SegmentationClip]:
        """
        将段落划分映射回时间轴
        """
        clips = []
        timeline_pos = 0
        
        for para in paragraphs:
            start_idx = para["start_sentence_index"]
            end_idx = para["end_sentence_index"]
            
            # 确保索引有效
            start_idx = max(0, min(start_idx, len(segments) - 1))
            end_idx = max(start_idx, min(end_idx, len(segments) - 1))
            
            source_start_ms = segments[start_idx]["start"]
            source_end_ms = segments[end_idx]["end"]
            duration = source_end_ms - source_start_ms
            
            # 收集该段落的文本
            transcript = "".join(
                segments[i]["text"]
                for i in range(start_idx, end_idx + 1)
            )
            
            clip = self._create_clip(
                asset_id=asset_id,
                start_time_ms=timeline_pos,
                end_time_ms=timeline_pos + duration,
                source_start_ms=source_start_ms,
                source_end_ms=source_end_ms,
                transcript=transcript,
                name=para.get("title", f"段落 {para['index'] + 1}"),
                parent_clip_id=parent_clip_id,
                metadata={
                    "strategy": "paragraph",
                    "paragraph_index": para["index"],
                    "summary": para.get("summary", ""),
                },
            )
            clips.append(clip)
            timeline_pos += duration
        
        return clips
