"""
Stage 2: 结构分析层

分析每个片段的内容角色和类型，是整个 Remotion Agent 的核心。

职责:
1. 划分章节
2. 识别内容类型 (列表项、数据、关键词等)
3. 标记重点
4. 提取结构化数据 (数字、关键词、引用)
5. 🆕 检测 B-Roll 触发点
6. 🆕 建议布局模式
"""

import logging
import json
import re
from typing import List, Dict, Any, Optional, Tuple
from pydantic import ValidationError

from app.services.llm.clients import get_llm
from .models import (
    SegmentRole,
    ContentType,
    ImportanceLevel,
    StructuredSegment,
    SegmentStructure,
    ListContext,
    ProcessContext,
    ExtractedData,
    ExtractedNumber,
    ExtractedKeyword,
    ExtractedQuote,
    GlobalStructure,
    ChapterInfo,
    StructureAnalysisResult,
)
from .prompts.structure import STRUCTURE_ANALYSIS_PROMPT
from .broll_trigger import detect_broll_triggers, detect_primary_trigger, BrollTriggerType
from .layout_modes import LayoutMode, LayoutModeSelector

logger = logging.getLogger(__name__)


async def analyze_content_structure(
    segments: List[Dict[str, Any]],
    content_understanding: Optional[Dict[str, Any]] = None,
    provider: str = "doubao"
) -> StructureAnalysisResult:
    """
    分析内容结构
    
    Args:
        segments: ASR 转写片段列表，每个包含 {id, text, start_ms, end_ms}
        content_understanding: Stage 1 的理解结果（可选）
        provider: LLM 提供商
        
    Returns:
        StructureAnalysisResult: 结构化分析结果
    """
    if not segments:
        return StructureAnalysisResult(
            segments=[],
            global_structure=GlobalStructure()
        )
    
    # 准备输入文本
    segments_text = _format_segments_for_prompt(segments)
    
    # 可选的上下文信息
    context_hint = ""
    if content_understanding:
        context_hint = f"""
## 内容背景
- 主题: {content_understanding.get('topic', '未知')}
- 类别: {content_understanding.get('category', '未知')}
- 风格: {content_understanding.get('tone', '未知')}
"""
    
    # 调用 LLM
    try:
        llm = get_llm(provider=provider)
        prompt = STRUCTURE_ANALYSIS_PROMPT.format(
            segments_text=segments_text,
            context_hint=context_hint
        )
        
        response = await llm.ainvoke(prompt)
        result_text = response.content if hasattr(response, 'content') else str(response)
        
        # 解析 JSON 结果
        parsed_result = _parse_llm_response(result_text, segments)
        
        return parsed_result
        
    except Exception as e:
        logger.error(f"Structure analysis failed: {e}")
        # 返回基础分析结果（降级处理）
        return _fallback_analysis(segments)


def _format_segments_for_prompt(segments: List[Dict[str, Any]]) -> str:
    """格式化片段为 Prompt 输入"""
    lines = []
    for seg in segments:
        seg_id = seg.get('id', '')
        text = seg.get('text', '')
        start_ms = seg.get('start_ms', 0)
        lines.append(f"[{seg_id}] ({start_ms}ms) {text}")
    return "\n".join(lines)


def _parse_llm_response(
    response_text: str,
    original_segments: List[Dict[str, Any]]
) -> StructureAnalysisResult:
    """
    解析 LLM 响应
    
    LLM 返回的 JSON 结构:
    {
        "segments": [
            {
                "id": "seg_1",
                "role": "hook",
                "content_type": "title-display",
                "importance": "high",
                "extracted_data": {
                    "numbers": [{"value": "300%", "label": "增长", "trend": "up"}],
                    "keywords": [{"word": "效率", "importance": "primary"}]
                },
                "list_context": null,
                "process_context": null
            }
        ],
        "global_structure": {
            "has_point_list": true,
            "point_list_count": 3,
            "has_process": false,
            "has_comparison": false,
            "chapters": [{"title": "开场", "start_segment_id": "seg_1", "end_segment_id": "seg_3"}]
        }
    }
    """
    # 提取 JSON
    json_match = re.search(r'```json\s*(.*?)\s*```', response_text, re.DOTALL)
    if json_match:
        json_str = json_match.group(1)
    else:
        # 尝试直接解析整个响应
        json_str = response_text
    
    # 尝试修复常见的 JSON 格式问题
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse LLM response as JSON: {e}")
        
        # 尝试修复: 移除尾部逗号
        fixed_json = re.sub(r',\s*}', '}', json_str)
        fixed_json = re.sub(r',\s*]', ']', fixed_json)
        
        try:
            data = json.loads(fixed_json)
            logger.info("JSON parsing succeeded after fixing trailing commas")
        except json.JSONDecodeError:
            # 尝试提取 { } 之间的内容
            brace_match = re.search(r'\{.*\}', json_str, re.DOTALL)
            if brace_match:
                try:
                    data = json.loads(brace_match.group())
                    logger.info("JSON parsing succeeded after extracting braces")
                except json.JSONDecodeError:
                    logger.error("All JSON parsing attempts failed, using fallback")
                    return _fallback_analysis(original_segments)
            else:
                return _fallback_analysis(original_segments)
    
    # 构建片段 ID 到原始数据的映射
    seg_map = {seg.get('id', f'seg_{i}'): seg for i, seg in enumerate(original_segments)}
    
    # 解析 segments
    structured_segments = []
    llm_segments = data.get('segments', [])
    
    for llm_seg in llm_segments:
        seg_id = llm_seg.get('id', '')
        original = seg_map.get(seg_id, {})
        original_text = original.get('text', '')
        
        # 解析结构数据 (传入原文用于 B-Roll 触发检测)
        structure = _parse_segment_structure(llm_seg, text=original_text)
        
        structured_segments.append(StructuredSegment(
            id=seg_id,
            text=original_text,
            start_ms=original.get('start_ms', 0),
            end_ms=original.get('end_ms', 0),
            structure=structure
        ))
    
    # 解析全局结构
    global_data = data.get('global_structure', {})
    chapters = [
        ChapterInfo(**ch) for ch in global_data.get('chapters', [])
    ]
    
    global_structure = GlobalStructure(
        has_point_list=global_data.get('has_point_list', False),
        point_list_count=global_data.get('point_list_count'),
        has_process=global_data.get('has_process', False),
        process_step_count=global_data.get('process_step_count'),
        has_comparison=global_data.get('has_comparison', False),
        chapters=chapters
    )
    
    return StructureAnalysisResult(
        segments=structured_segments,
        global_structure=global_structure
    )


def _parse_segment_structure(llm_seg: Dict[str, Any], text: str = "") -> SegmentStructure:
    """解析单个片段的结构"""
    # 角色
    role_str = llm_seg.get('role', 'filler')
    try:
        role = SegmentRole(role_str)
    except ValueError:
        role = SegmentRole.FILLER
    
    # 内容类型
    content_type_str = llm_seg.get('content_type', 'none')
    try:
        content_type = ContentType(content_type_str)
    except ValueError:
        content_type = ContentType.NONE
    
    # 重要程度 (增强映射)
    importance_str = llm_seg.get('importance', 'medium')
    # 映射可能的 LLM 返回值到标准枚举
    importance_map = {
        'critical': 'critical',
        'high': 'high',
        'medium': 'medium',
        'low': 'low',
        # LLM 可能返回的非标准值
        'primary': 'high',
        'secondary': 'medium',
        'tertiary': 'low',
        'main': 'high',
        'normal': 'medium',
        'minor': 'low',
    }
    importance_str = importance_map.get(importance_str.lower(), 'medium')
    try:
        importance = ImportanceLevel(importance_str)
    except ValueError:
        importance = ImportanceLevel.MEDIUM
    
    # 列表上下文
    list_ctx = None
    if llm_seg.get('list_context'):
        ctx = llm_seg['list_context']
        # 确保必需的整数字段有默认值
        item_index = ctx.get('item_index')
        total_items = ctx.get('total_items')
        item_title = ctx.get('item_title')
        if item_index is None or not isinstance(item_index, int):
            item_index = 1
        if total_items is None or not isinstance(total_items, int):
            total_items = 1
        if item_title is None or not isinstance(item_title, str):
            item_title = ''
        list_ctx = ListContext(
            list_id=ctx.get('list_id', '') or '',
            item_index=item_index,
            total_items=total_items,
            item_title=item_title
        )
    
    # 流程上下文
    process_ctx = None
    if llm_seg.get('process_context'):
        ctx = llm_seg['process_context']
        # 确保必需的整数字段有默认值
        step_index = ctx.get('step_index')
        total_steps = ctx.get('total_steps')
        step_title = ctx.get('step_title')
        if step_index is None or not isinstance(step_index, int):
            step_index = 1
        if total_steps is None or not isinstance(total_steps, int):
            total_steps = 1
        if step_title is None or not isinstance(step_title, str):
            step_title = ''
        process_ctx = ProcessContext(
            process_id=ctx.get('process_id', '') or '',
            step_index=step_index,
            total_steps=total_steps,
            step_title=step_title
        )
    
    # 提取的数据
    extracted_data = None
    if llm_seg.get('extracted_data'):
        ed = llm_seg['extracted_data']
        
        # 解析数字 (带容错)
        numbers = []
        for n in ed.get('numbers', []):
            try:
                # 验证并修正 trend 值
                trend = n.get('trend', 'neutral')
                if trend not in ('up', 'down', 'neutral'):
                    trend = 'neutral'
                numbers.append(ExtractedNumber(
                    value=str(n.get('value', '')),
                    label=n.get('label', ''),
                    trend=trend,
                ))
            except Exception as e:
                logger.warning(f"Failed to parse ExtractedNumber: {e}")
        
        # 解析关键词 (带容错)
        keywords = []
        for k in ed.get('keywords', []):
            try:
                if isinstance(k, str):
                    # LLM 可能只返回字符串
                    keywords.append(ExtractedKeyword(word=k, importance="primary"))
                elif isinstance(k, dict):
                    # 确保必需字段存在
                    word = k.get('word') or k.get('text') or k.get('keyword', '')
                    importance = k.get('importance', 'primary')
                    if importance not in ('primary', 'secondary'):
                        importance = 'primary'
                    if word:
                        keywords.append(ExtractedKeyword(word=word, importance=importance))
                else:
                    logger.warning(f"Unexpected keyword format: {type(k)}")
            except Exception as e:
                logger.warning(f"Failed to parse ExtractedKeyword: {e}")
        
        quote = None
        if ed.get('quote'):
            try:
                quote = ExtractedQuote(**ed['quote'])
            except Exception as e:
                logger.warning(f"Failed to parse ExtractedQuote: {e}")
        
        extracted_data = ExtractedData(
            numbers=numbers,
            keywords=keywords,
            quote=quote
        )
    
    # 🆕 B-Roll 触发检测 (增强版)
    needs_broll = llm_seg.get('needs_broll', False)
    broll_keywords = llm_seg.get('broll_keywords', [])
    broll_trigger_type = None
    broll_trigger_text = None
    broll_suggested_content = None
    broll_importance = "medium"
    
    # 使用规则引擎检测触发点
    if text:
        primary_trigger = detect_primary_trigger(text)
        if primary_trigger:
            needs_broll = True
            broll_trigger_type = primary_trigger.trigger_type.value
            broll_trigger_text = primary_trigger.matched_text
            broll_suggested_content = primary_trigger.suggested_broll
            broll_importance = primary_trigger.importance
            
            # 补充关键词
            if not broll_keywords and primary_trigger.matched_text:
                broll_keywords = [primary_trigger.matched_text]
    
    # 🆕 建议布局模式
    suggested_layout_mode = LayoutModeSelector.select_mode(
        has_broll=needs_broll,
        broll_importance=broll_importance,
        content_type=content_type_str,
        template_id="talking-head",  # 默认模版
    ).value
    
    return SegmentStructure(
        role=role,
        content_type=content_type,
        importance=importance,
        list_context=list_ctx,
        process_context=process_ctx,
        extracted_data=extracted_data,
        needs_broll=needs_broll,
        broll_keywords=broll_keywords,
        broll_trigger_type=broll_trigger_type,
        broll_trigger_text=broll_trigger_text,
        broll_suggested_content=broll_suggested_content,
        broll_importance=broll_importance,
        suggested_layout_mode=suggested_layout_mode,
    )


def _fallback_analysis(segments: List[Dict[str, Any]]) -> StructureAnalysisResult:
    """
    降级分析 - 使用规则进行基础分析
    
    当 LLM 调用失败时使用
    """
    structured_segments = []
    
    # 简单的规则分析
    list_pattern = re.compile(r'(第[一二三四五六七八九十\d]+|首先|其次|最后|然后|\d+[\.、])')
    number_pattern = re.compile(r'(\d+(?:\.\d+)?)\s*(%|倍|万|亿|个|次)')
    keyword_triggers = ['重要', '关键', '核心', '必须', '一定', '记住']
    
    has_list = False
    list_items = []
    
    for i, seg in enumerate(segments):
        seg_id = seg.get('id', f'seg_{i}')
        text = seg.get('text', '')
        
        # 默认值
        role = SegmentRole.FILLER
        content_type = ContentType.NONE
        importance = ImportanceLevel.MEDIUM
        extracted_data = None
        
        # 🆕 B-Roll 触发检测
        needs_broll = False
        broll_keywords = []
        broll_trigger_type = None
        broll_trigger_text = None
        broll_suggested_content = None
        broll_importance = "medium"
        
        primary_trigger = detect_primary_trigger(text)
        if primary_trigger:
            needs_broll = True
            broll_trigger_type = primary_trigger.trigger_type.value
            broll_trigger_text = primary_trigger.matched_text
            broll_suggested_content = primary_trigger.suggested_broll
            broll_importance = primary_trigger.importance
            broll_keywords = [primary_trigger.matched_text]
        
        # 检测开场
        if i < 2 and any(kw in text for kw in ['你知道', '今天', '大家好', '？']):
            role = SegmentRole.HOOK
            content_type = ContentType.TITLE_DISPLAY
            importance = ImportanceLevel.HIGH
        
        # 检测列表项
        elif list_pattern.search(text):
            has_list = True
            role = SegmentRole.POINT
            content_type = ContentType.LIST_ITEM
            importance = ImportanceLevel.HIGH
            list_items.append(seg_id)
        
        # 检测数字
        number_match = number_pattern.search(text)
        if number_match:
            role = SegmentRole.DATA
            content_type = ContentType.DATA_HIGHLIGHT
            importance = ImportanceLevel.HIGH
            extracted_data = ExtractedData(
                numbers=[ExtractedNumber(
                    value=number_match.group(0),
                    label="数据",
                    trend="neutral"
                )]
            )
        
        # 检测关键词强调
        if any(kw in text for kw in keyword_triggers):
            content_type = ContentType.KEYWORD_EMPHASIS
            importance = ImportanceLevel.HIGH
        
        # 检测总结
        if any(kw in text for kw in ['总结', '总之', '所以', '综上']):
            role = SegmentRole.SUMMARY
            importance = ImportanceLevel.HIGH
        
        # 🆕 建议布局模式
        suggested_layout_mode = LayoutModeSelector.select_mode(
            has_broll=needs_broll,
            broll_importance=broll_importance,
            content_type=content_type.value if content_type else "none",
            template_id="talking-head",
        ).value
        
        structure = SegmentStructure(
            role=role,
            content_type=content_type,
            importance=importance,
            extracted_data=extracted_data,
            needs_broll=needs_broll,
            broll_keywords=broll_keywords,
            broll_trigger_type=broll_trigger_type,
            broll_trigger_text=broll_trigger_text,
            broll_suggested_content=broll_suggested_content,
            broll_importance=broll_importance,
            suggested_layout_mode=suggested_layout_mode,
        )
        
        structured_segments.append(StructuredSegment(
            id=seg_id,
            text=text,
            start_ms=seg.get('start_ms', 0),
            end_ms=seg.get('end_ms', 0),
            structure=structure
        ))
    
    global_structure = GlobalStructure(
        has_point_list=has_list,
        point_list_count=len(list_items) if has_list else None
    )
    
    return StructureAnalysisResult(
        segments=structured_segments,
        global_structure=global_structure
    )
