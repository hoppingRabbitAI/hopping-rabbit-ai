"""
B-Roll 触发检测

识别口播文本中需要 B-Roll 素材的触发点

6 种触发类型:
1. data_cite: 数据引用 (数字、百分比、统计)
2. example_mention: 举例说明 (比如、例如、举个例子)
3. comparison: 对比分析 (相比、对比、vs)
4. product_mention: 产品/品牌提及 (具体产品名、品牌名)
5. process_desc: 流程描述 (首先、然后、最后、第一步)
6. concept_visual: 概念可视化 (就像、好比、类似于)
"""

import re
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum
from dataclasses import dataclass


class BrollTriggerType(str, Enum):
    """B-Roll 触发类型"""
    DATA_CITE = "data_cite"              # 数据引用
    EXAMPLE_MENTION = "example_mention"  # 举例说明
    COMPARISON = "comparison"            # 对比分析
    PRODUCT_MENTION = "product_mention"  # 产品/品牌提及
    PROCESS_DESC = "process_desc"        # 流程描述
    CONCEPT_VISUAL = "concept_visual"    # 概念可视化


class BrollTrigger(BaseModel):
    """B-Roll 触发检测结果"""
    trigger_type: BrollTriggerType = Field(..., description="触发类型")
    matched_text: str = Field(..., description="匹配的文本")
    start_index: int = Field(..., description="在原文中的起始位置")
    end_index: int = Field(..., description="在原文中的结束位置")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="置信度")
    suggested_broll: Optional[str] = Field(None, description="建议的 B-Roll 描述")
    importance: str = Field(default="medium", description="重要性 high/medium/low")


# ============================================
# 触发规则定义
# ============================================

@dataclass
class TriggerRule:
    """触发规则"""
    trigger_type: BrollTriggerType
    pattern: str  # 正则表达式
    importance: str  # high/medium/low
    broll_suggestion_template: str  # B-Roll 建议模版


# 数据引用触发规则
DATA_CITE_RULES = [
    TriggerRule(
        trigger_type=BrollTriggerType.DATA_CITE,
        pattern=r'(\d+(?:\.\d+)?)\s*[%％]',  # 百分比: 50%, 3.5%
        importance="high",
        broll_suggestion_template="数据图表展示 {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.DATA_CITE,
        pattern=r'(\d+(?:\.\d+)?)\s*[亿万千百]',  # 大数字: 5亿, 100万
        importance="high",
        broll_suggestion_template="数字动画展示 {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.DATA_CITE,
        pattern=r'增长了?\s*(\d+(?:\.\d+)?)\s*倍',  # 增长倍数
        importance="high",
        broll_suggestion_template="增长趋势图 {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.DATA_CITE,
        pattern=r'(?:根据|据|来自).*?(?:数据|报告|统计|调查)',  # 引用来源
        importance="medium",
        broll_suggestion_template="数据来源展示",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.DATA_CITE,
        pattern=r'(?:超过|达到|突破|接近)\s*(\d+)',  # 里程碑数字
        importance="high",
        broll_suggestion_template="里程碑数字展示 {matched}",
    ),
]

# 举例说明触发规则
EXAMPLE_MENTION_RULES = [
    TriggerRule(
        trigger_type=BrollTriggerType.EXAMPLE_MENTION,
        pattern=r'(?:比如说?|例如|举个例子|像是|譬如)\s*[，,]?\s*(.{2,20})',
        importance="high",
        broll_suggestion_template="示例图片: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.EXAMPLE_MENTION,
        pattern=r'(?:以|拿)\s*(.{2,15})\s*(?:为例|来说|举例)',
        importance="high",
        broll_suggestion_template="案例展示: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.EXAMPLE_MENTION,
        pattern=r'(?:最典型的|最常见的|最明显的).*?(?:就是|是)',
        importance="medium",
        broll_suggestion_template="典型案例展示",
    ),
]

# 对比分析触发规则
COMPARISON_RULES = [
    TriggerRule(
        trigger_type=BrollTriggerType.COMPARISON,
        pattern=r'(?:和|与|跟)\s*(.{2,15})\s*(?:相比|对比|比较)',
        importance="high",
        broll_suggestion_template="对比图: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.COMPARISON,
        pattern=r'(.{2,10})\s*(?:vs|VS|versus|对比)\s*(.{2,10})',
        importance="high",
        broll_suggestion_template="对比展示: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.COMPARISON,
        pattern=r'(?:从|由)\s*(.{2,10})\s*(?:到|变成|升级为)\s*(.{2,10})',
        importance="medium",
        broll_suggestion_template="变化对比: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.COMPARISON,
        pattern=r'(?:前者|后者|前一个|后一个|两者)',
        importance="low",
        broll_suggestion_template="对比说明",
    ),
]

# 产品/品牌提及规则 (通用模式 + 常见品牌)
PRODUCT_MENTION_RULES = [
    TriggerRule(
        trigger_type=BrollTriggerType.PRODUCT_MENTION,
        pattern=r'(?:iPhone|iPad|Mac|Apple|苹果)\s*\d*\s*(?:Pro|Max|Plus|mini)?',
        importance="high",
        broll_suggestion_template="Apple产品图: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.PRODUCT_MENTION,
        pattern=r'(?:华为|HUAWEI|Mate|P\d{2}|荣耀)',
        importance="high",
        broll_suggestion_template="华为产品图: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.PRODUCT_MENTION,
        pattern=r'(?:小米|Xiaomi|红米|Redmi)\s*\d*',
        importance="high",
        broll_suggestion_template="小米产品图: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.PRODUCT_MENTION,
        pattern=r'(?:特斯拉|Tesla|Model\s*[SXY3])',
        importance="high",
        broll_suggestion_template="特斯拉产品图: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.PRODUCT_MENTION,
        pattern=r'(?:ChatGPT|GPT-\d|Claude|Gemini|文心一言|通义千问)',
        importance="high",
        broll_suggestion_template="AI产品界面: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.PRODUCT_MENTION,
        pattern=r'(?:抖音|TikTok|微信|微博|小红书|B站|bilibili)',
        importance="medium",
        broll_suggestion_template="平台界面: {matched}",
    ),
    # 通用产品模式
    TriggerRule(
        trigger_type=BrollTriggerType.PRODUCT_MENTION,
        pattern=r'这款?\s*(?:产品|软件|工具|APP|应用)',
        importance="medium",
        broll_suggestion_template="产品展示",
    ),
]

# 流程描述触发规则
PROCESS_DESC_RULES = [
    TriggerRule(
        trigger_type=BrollTriggerType.PROCESS_DESC,
        pattern=r'第\s*[一二三四五六七八九十\d]\s*[步个点]',
        importance="high",
        broll_suggestion_template="步骤演示: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.PROCESS_DESC,
        pattern=r'(?:首先|第一)[，,]?\s*(.{2,30}?)[，,。]',
        importance="high",
        broll_suggestion_template="流程起始: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.PROCESS_DESC,
        pattern=r'(?:然后|接着|其次|第二)[，,]?\s*(.{2,30}?)[，,。]',
        importance="medium",
        broll_suggestion_template="流程中间: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.PROCESS_DESC,
        pattern=r'(?:最后|最终|第三)[，,]?\s*(.{2,30}?)[，,。]',
        importance="high",
        broll_suggestion_template="流程结束: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.PROCESS_DESC,
        pattern=r'(?:先|再|后).*?(?:先|再|后).*?(?:最后)?',
        importance="medium",
        broll_suggestion_template="流程演示",
    ),
]

# 概念可视化触发规则
CONCEPT_VISUAL_RULES = [
    TriggerRule(
        trigger_type=BrollTriggerType.CONCEPT_VISUAL,
        pattern=r'(?:就像|好比|类似于|相当于|好像)\s*(.{2,20})',
        importance="high",
        broll_suggestion_template="比喻图示: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.CONCEPT_VISUAL,
        pattern=r'(?:你可以理解为|简单来说就是|本质上是|理解为|把它?[当看]作?)\s*(.{2,30})',
        importance="medium",
        broll_suggestion_template="概念图解: {matched}",
    ),
    TriggerRule(
        trigger_type=BrollTriggerType.CONCEPT_VISUAL,
        pattern=r'(?:想象一下|假设|如果把.+比作)',
        importance="medium",
        broll_suggestion_template="场景想象图",
    ),
]

# 所有规则汇总
ALL_TRIGGER_RULES: Dict[BrollTriggerType, List[TriggerRule]] = {
    BrollTriggerType.DATA_CITE: DATA_CITE_RULES,
    BrollTriggerType.EXAMPLE_MENTION: EXAMPLE_MENTION_RULES,
    BrollTriggerType.COMPARISON: COMPARISON_RULES,
    BrollTriggerType.PRODUCT_MENTION: PRODUCT_MENTION_RULES,
    BrollTriggerType.PROCESS_DESC: PROCESS_DESC_RULES,
    BrollTriggerType.CONCEPT_VISUAL: CONCEPT_VISUAL_RULES,
}


# ============================================
# 触发检测器
# ============================================

class BrollTriggerDetector:
    """B-Roll 触发检测器"""
    
    def __init__(self, custom_rules: Optional[Dict[BrollTriggerType, List[TriggerRule]]] = None):
        """
        初始化检测器
        
        Args:
            custom_rules: 自定义规则 (可选)
        """
        self.rules = custom_rules or ALL_TRIGGER_RULES
        # 预编译正则表达式
        self._compiled_rules: Dict[BrollTriggerType, List[tuple]] = {}
        for trigger_type, rules in self.rules.items():
            self._compiled_rules[trigger_type] = [
                (re.compile(rule.pattern, re.IGNORECASE), rule)
                for rule in rules
            ]
    
    def detect(self, text: str) -> List[BrollTrigger]:
        """
        检测文本中的 B-Roll 触发点
        
        Args:
            text: 输入文本
            
        Returns:
            触发点列表
        """
        triggers = []
        
        for trigger_type, compiled_rules in self._compiled_rules.items():
            for pattern, rule in compiled_rules:
                for match in pattern.finditer(text):
                    matched_text = match.group(0)
                    
                    # 生成 B-Roll 建议
                    suggestion = rule.broll_suggestion_template.format(
                        matched=matched_text
                    )
                    
                    trigger = BrollTrigger(
                        trigger_type=trigger_type,
                        matched_text=matched_text,
                        start_index=match.start(),
                        end_index=match.end(),
                        confidence=1.0,
                        suggested_broll=suggestion,
                        importance=rule.importance,
                    )
                    triggers.append(trigger)
        
        # 按位置排序
        triggers.sort(key=lambda t: t.start_index)
        
        # 去重 (重叠的触发点保留重要性高的)
        triggers = self._deduplicate_triggers(triggers)
        
        return triggers
    
    def detect_primary(self, text: str) -> Optional[BrollTrigger]:
        """
        检测最重要的触发点
        
        Returns:
            最重要的触发点，如果没有则返回 None
        """
        triggers = self.detect(text)
        if not triggers:
            return None
        
        # 优先返回 high importance
        high_triggers = [t for t in triggers if t.importance == "high"]
        if high_triggers:
            return high_triggers[0]
        
        return triggers[0]
    
    def has_trigger(self, text: str) -> bool:
        """检查文本是否有触发点"""
        return len(self.detect(text)) > 0
    
    def get_trigger_types(self, text: str) -> List[BrollTriggerType]:
        """获取文本中的所有触发类型"""
        triggers = self.detect(text)
        return list(set(t.trigger_type for t in triggers))
    
    def _deduplicate_triggers(self, triggers: List[BrollTrigger]) -> List[BrollTrigger]:
        """去除重叠的触发点"""
        if len(triggers) <= 1:
            return triggers
        
        result = []
        importance_order = {"high": 0, "medium": 1, "low": 2}
        
        for trigger in triggers:
            # 检查是否与已有触发点重叠
            overlapping = False
            for i, existing in enumerate(result):
                # 检查重叠
                if (trigger.start_index < existing.end_index and 
                    trigger.end_index > existing.start_index):
                    overlapping = True
                    # 如果新触发点更重要，替换
                    if importance_order.get(trigger.importance, 2) < importance_order.get(existing.importance, 2):
                        result[i] = trigger
                    break
            
            if not overlapping:
                result.append(trigger)
        
        return result


# ============================================
# 便捷函数
# ============================================

# 全局检测器实例
_detector: Optional[BrollTriggerDetector] = None


def get_detector() -> BrollTriggerDetector:
    """获取检测器单例"""
    global _detector
    if _detector is None:
        _detector = BrollTriggerDetector()
    return _detector


# 简单的缓存 (避免循环导入)
_trigger_cache: Dict[str, List[BrollTrigger]] = {}
_primary_cache: Dict[str, Optional[BrollTrigger]] = {}
_CACHE_MAX_SIZE = 200


def _get_cache_key(text: str) -> str:
    """生成缓存键"""
    import hashlib
    return hashlib.md5(text.encode()).hexdigest()[:16]


def detect_broll_triggers(text: str) -> List[BrollTrigger]:
    """检测 B-Roll 触发点 (带缓存)"""
    cache_key = _get_cache_key(text)
    
    if cache_key in _trigger_cache:
        return _trigger_cache[cache_key]
    
    result = get_detector().detect(text)
    
    # 限制缓存大小
    if len(_trigger_cache) >= _CACHE_MAX_SIZE:
        # 简单清理: 删除一半
        keys = list(_trigger_cache.keys())[:_CACHE_MAX_SIZE // 2]
        for k in keys:
            del _trigger_cache[k]
    
    _trigger_cache[cache_key] = result
    return result


def detect_primary_trigger(text: str) -> Optional[BrollTrigger]:
    """检测主要触发点 (带缓存)"""
    cache_key = _get_cache_key(text)
    
    if cache_key in _primary_cache:
        return _primary_cache[cache_key]
    
    result = get_detector().detect_primary(text)
    
    # 限制缓存大小
    if len(_primary_cache) >= _CACHE_MAX_SIZE:
        keys = list(_primary_cache.keys())[:_CACHE_MAX_SIZE // 2]
        for k in keys:
            del _primary_cache[k]
    
    _primary_cache[cache_key] = result
    return result


def has_broll_trigger(text: str) -> bool:
    """检查是否有触发点"""
    return get_detector().has_trigger(text)


def get_broll_trigger_types(text: str) -> List[BrollTriggerType]:
    """获取触发类型列表"""
    return get_detector().get_trigger_types(text)


def clear_trigger_cache():
    """清空触发检测缓存"""
    global _trigger_cache, _primary_cache
    _trigger_cache.clear()
    _primary_cache.clear()
