"""
节奏计算器

基于标杆视频分析，计算视觉元素的理想出现时机和持续时长

核心规则:
1. 静止画面不超过 5 秒
2. 视觉元素间隔 2-4 秒
3. 信息密集处增加视觉元素
4. 关键词/数据在说出时同步显示
"""

from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field
from enum import Enum


class PacingStyle(str, Enum):
    """节奏风格"""
    FAST = "fast"      # 快节奏 (抖音风格)
    MEDIUM = "medium"  # 中等节奏 (B站风格)
    SLOW = "slow"      # 慢节奏 (深度内容)


class PacingConfig(BaseModel):
    """节奏配置"""
    style: PacingStyle = PacingStyle.MEDIUM
    
    # 视觉元素间隔 (毫秒)
    min_element_gap_ms: int = 2000
    max_element_gap_ms: int = 4000
    
    # 静止画面最大时长 (毫秒)
    max_static_duration_ms: int = 5000
    
    # 叠加层持续时长
    keyword_card_duration_ms: int = 2500
    data_number_duration_ms: int = 3000
    quote_duration_ms: int = 4000
    chapter_title_duration_ms: int = 2000
    
    # 画布相关
    canvas_min_duration_ms: int = 8000
    canvas_item_reveal_gap_ms: int = 1500  # 列表项出现间隔


# 预设节奏配置
PACING_PRESETS: Dict[PacingStyle, PacingConfig] = {
    PacingStyle.FAST: PacingConfig(
        style=PacingStyle.FAST,
        min_element_gap_ms=1500,
        max_element_gap_ms=3000,
        max_static_duration_ms=3000,
        keyword_card_duration_ms=2000,
        data_number_duration_ms=2500,
        quote_duration_ms=3000,
        chapter_title_duration_ms=1500,
        canvas_min_duration_ms=6000,
        canvas_item_reveal_gap_ms=1000,
    ),
    PacingStyle.MEDIUM: PacingConfig(
        style=PacingStyle.MEDIUM,
        min_element_gap_ms=2000,
        max_element_gap_ms=4000,
        max_static_duration_ms=5000,
        keyword_card_duration_ms=2500,
        data_number_duration_ms=3000,
        quote_duration_ms=4000,
        chapter_title_duration_ms=2000,
        canvas_min_duration_ms=8000,
        canvas_item_reveal_gap_ms=1500,
    ),
    PacingStyle.SLOW: PacingConfig(
        style=PacingStyle.SLOW,
        min_element_gap_ms=3000,
        max_element_gap_ms=6000,
        max_static_duration_ms=8000,
        keyword_card_duration_ms=3500,
        data_number_duration_ms=4000,
        quote_duration_ms=5000,
        chapter_title_duration_ms=2500,
        canvas_min_duration_ms=12000,
        canvas_item_reveal_gap_ms=2000,
    ),
}


class VisualElementTiming(BaseModel):
    """视觉元素时间配置"""
    element_id: str
    element_type: str
    start_ms: int
    end_ms: int
    sync_with_text: Optional[str] = None  # 同步的文本内容


class PacingCalculator:
    """节奏计算器"""
    
    def __init__(self, style: PacingStyle = PacingStyle.MEDIUM):
        self.config = PACING_PRESETS.get(style, PACING_PRESETS[PacingStyle.MEDIUM])
    
    def calculate_overlay_timing(
        self,
        overlay_type: str,
        trigger_ms: int,
        content_length: int = 0,
    ) -> Tuple[int, int]:
        """
        计算叠加层的显示时间
        
        Args:
            overlay_type: 叠加层类型
            trigger_ms: 触发时间点
            content_length: 内容长度 (字符数)
            
        Returns:
            (start_ms, end_ms)
        """
        # 基础持续时长
        duration_map = {
            "keyword-card": self.config.keyword_card_duration_ms,
            "data-number": self.config.data_number_duration_ms,
            "quote-block": self.config.quote_duration_ms,
            "chapter-title": self.config.chapter_title_duration_ms,
            "highlight-box": 2000,
            "question-hook": 3000,
            "progress-indicator": 2000,
            "definition-card": 4000,
        }
        
        base_duration = duration_map.get(overlay_type, 2500)
        
        # 根据内容长度调整
        if content_length > 20:
            # 每多 10 个字符增加 500ms
            extra_duration = ((content_length - 20) // 10) * 500
            base_duration = min(base_duration + extra_duration, 6000)  # 上限 6 秒
        
        # 计算开始时间 (提前 200ms 出现)
        start_ms = max(0, trigger_ms - 200)
        end_ms = start_ms + base_duration
        
        return (start_ms, end_ms)
    
    def calculate_canvas_timing(
        self,
        item_count: int,
        first_item_ms: int,
        last_item_ms: int,
    ) -> Tuple[int, int]:
        """
        计算画布的显示时间
        
        Args:
            item_count: 画布项目数量
            first_item_ms: 第一个项目提到的时间
            last_item_ms: 最后一个项目提到的时间
            
        Returns:
            (start_ms, end_ms)
        """
        # 画布在第一个项目前 500ms 出现
        start_ms = max(0, first_item_ms - 500)
        
        # 画布在最后一个项目后保持一段时间
        min_end_ms = last_item_ms + 2000  # 至少保持 2 秒
        
        # 确保满足最小持续时长
        duration = max(
            min_end_ms - start_ms,
            self.config.canvas_min_duration_ms
        )
        
        end_ms = start_ms + duration
        
        return (start_ms, end_ms)
    
    def calculate_item_reveal_times(
        self,
        item_mention_times: List[int],
    ) -> List[int]:
        """
        计算列表项的显示时间
        
        根据口播中提到各项的时间，计算每项的出现时机
        
        Args:
            item_mention_times: 每项被口播提到的时间点
            
        Returns:
            每项的显示时间点列表
        """
        if not item_mention_times:
            return []
        
        reveal_times = []
        min_gap = self.config.canvas_item_reveal_gap_ms
        
        for i, mention_time in enumerate(item_mention_times):
            if i == 0:
                # 第一项提前 300ms 显示
                reveal_times.append(max(0, mention_time - 300))
            else:
                # 后续项确保与前一项有足够间隔
                prev_reveal = reveal_times[i - 1]
                reveal_time = max(mention_time - 300, prev_reveal + min_gap)
                reveal_times.append(reveal_time)
        
        return reveal_times
    
    def suggest_visual_gaps(
        self,
        total_duration_ms: int,
        existing_elements: List[Dict[str, int]],
    ) -> List[Tuple[int, int]]:
        """
        建议需要添加视觉元素的时间段
        
        Args:
            total_duration_ms: 总时长
            existing_elements: 现有元素列表 [{start_ms, end_ms}, ...]
            
        Returns:
            需要填充的时间段列表 [(start_ms, end_ms), ...]
        """
        if not existing_elements:
            # 没有现有元素，建议整个时间段
            return [(0, total_duration_ms)]
        
        # 按开始时间排序
        sorted_elements = sorted(existing_elements, key=lambda x: x.get("start_ms", 0))
        
        gaps = []
        
        # 检查开头是否有空白
        first_start = sorted_elements[0].get("start_ms", 0)
        if first_start > self.config.max_static_duration_ms:
            gaps.append((0, first_start))
        
        # 检查元素之间的空白
        for i in range(len(sorted_elements) - 1):
            curr_end = sorted_elements[i].get("end_ms", 0)
            next_start = sorted_elements[i + 1].get("start_ms", 0)
            
            gap = next_start - curr_end
            if gap > self.config.max_static_duration_ms:
                gaps.append((curr_end, next_start))
        
        # 检查结尾是否有空白
        last_end = sorted_elements[-1].get("end_ms", 0)
        if total_duration_ms - last_end > self.config.max_static_duration_ms:
            gaps.append((last_end, total_duration_ms))
        
        return gaps
    
    def adjust_timing_for_speech(
        self,
        elements: List[Dict[str, Any]],
        speech_segments: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        根据语音节奏调整元素时间
        
        Args:
            elements: 视觉元素列表
            speech_segments: 语音片段列表 [{text, start_ms, end_ms}, ...]
            
        Returns:
            调整后的元素列表
        """
        adjusted = []
        
        for element in elements:
            elem_start = element.get("start_ms", 0)
            elem_end = element.get("end_ms", 0)
            
            # 找到最近的语音片段边界
            for seg in speech_segments:
                seg_start = seg.get("start_ms", 0)
                seg_end = seg.get("end_ms", 0)
                
                # 如果元素开始时间在语音片段中间，调整到片段开始
                if seg_start < elem_start < seg_end:
                    # 检查是否更接近开始
                    if elem_start - seg_start < 500:
                        elem_start = seg_start
            
            adjusted_element = {**element, "start_ms": elem_start, "end_ms": elem_end}
            adjusted.append(adjusted_element)
        
        return adjusted


def get_pacing_config(style: PacingStyle) -> PacingConfig:
    """获取节奏配置"""
    return PACING_PRESETS.get(style, PACING_PRESETS[PacingStyle.MEDIUM])


def calculate_overlay_timing(
    overlay_type: str,
    trigger_ms: int,
    style: PacingStyle = PacingStyle.MEDIUM,
) -> Tuple[int, int]:
    """便捷函数：计算叠加层时间"""
    calculator = PacingCalculator(style)
    return calculator.calculate_overlay_timing(overlay_type, trigger_ms)


def suggest_visual_additions(
    total_duration_ms: int,
    existing_elements: List[Dict[str, int]],
    style: PacingStyle = PacingStyle.MEDIUM,
) -> List[Tuple[int, int]]:
    """便捷函数：建议需要添加视觉的时间段"""
    calculator = PacingCalculator(style)
    return calculator.suggest_visual_gaps(total_duration_ms, existing_elements)
