"""
编辑意图分类器 (Edit Intent Classifier)

根据用户的编辑描述，智能识别用户的真实意图：
1. add_element: 添加元素（太阳、云彩、特效等）-> 使用 Multi-Elements API 或 Inpainting
2. local_edit: 局部修改（修改某处细节）-> 使用 Inpainting + Mask
3. full_replace: 完整换背景 -> 使用 I2V 或 Image-to-Image

这解决了用户说"加个太阳"却被整个换背景的问题。
"""

import logging
import re
from typing import Dict, Any, Optional, Literal
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class EditIntent(str, Enum):
    """编辑意图类型"""
    ADD_ELEMENT = "add_element"      # 添加元素（加太阳、加云、加特效）
    LOCAL_EDIT = "local_edit"        # 局部修改（改某处颜色、修复某处）
    FULL_REPLACE = "full_replace"    # 完整换背景（换成海边、换成星空）


@dataclass
class IntentClassificationResult:
    """意图分类结果"""
    intent: EditIntent
    confidence: float  # 0-1，越高越确定
    reasoning: str     # 分类理由
    suggested_api: str # 建议使用的 API
    enhanced_prompt: Optional[str] = None  # 增强后的 prompt


# ========================================
# 关键词规则（快速路径，无需 LLM）
# ========================================

# 添加元素的关键词
ADD_ELEMENT_KEYWORDS = [
    # 中文 - 动作词
    "加个", "加一个", "添加", "放一个", "放个", "弄一个", "弄个",
    "插入", "放入", "增加", "画一个", "画个", "生成一个", "生成个",
    "来个", "给我一个", "整一个", "整个", "搞一个", "搞个",
    # 中文 - 元素类型
    "小太阳", "太阳光", "阳光", "光晕", "光效", "光芒",
    "云朵", "小云", "彩虹", "星星", "月亮", "闪电",
    "雪花", "落叶", "花瓣", "气泡", "火花", "烟雾",
    "文字", "水印", "logo", "贴纸", "表情",
    # 英文
    "add a", "add an", "put a", "put an", "place a", "place an",
    "insert a", "insert an", "draw a", "draw an",
]

# 局部修改的关键词
LOCAL_EDIT_KEYWORDS = [
    # 中文
    "把这里", "这部分", "这个地方", "这个区域", "选中的",
    "涂抹的", "圈出来的", "标记的", "画的区域",
    "改一下", "修改", "调整", "修复", "去掉", "删除", "擦除",
    "变成", "改成", "换成",  # 但这些需要配合 mask
    # 英文
    "this area", "this part", "selected", "marked", "painted",
    "change this", "modify this", "fix this", "remove this",
]

# 完整换背景的关键词
FULL_REPLACE_KEYWORDS = [
    # 中文
    "换背景", "换个背景", "换成", "改成", "变成",
    "背景换成", "把背景", "整个背景", "全部背景",
    "场景换成", "场景改成", "换到", "移到",
    # 场景描述（通常表示换背景）
    "海边", "沙滩", "海滩", "大海", "森林", "草原", "雪山",
    "星空", "银河", "太空", "城市", "都市", "夜景",
    "日落", "日出", "黄昏", "清晨", "蓝天白云",
    # 英文
    "replace background", "change background", "new background",
    "move to", "transport to", "be in",
]


def _keyword_classify(prompt: str) -> Optional[IntentClassificationResult]:
    """
    基于关键词的快速分类（不需要 LLM）
    
    Args:
        prompt: 用户输入的 prompt
    
    Returns:
        分类结果，如果无法确定则返回 None
    """
    prompt_lower = prompt.lower()
    
    # 计算各类关键词的匹配数
    add_score = sum(1 for kw in ADD_ELEMENT_KEYWORDS if kw.lower() in prompt_lower)
    local_score = sum(1 for kw in LOCAL_EDIT_KEYWORDS if kw.lower() in prompt_lower)
    replace_score = sum(1 for kw in FULL_REPLACE_KEYWORDS if kw.lower() in prompt_lower)
    
    logger.info(f"[IntentClassifier] 关键词匹配分数: add={add_score}, local={local_score}, replace={replace_score}")
    
    # 如果某一类明显高于其他，直接返回
    max_score = max(add_score, local_score, replace_score)
    
    if max_score == 0:
        return None  # 需要 LLM 分析
    
    # 判断是否是添加元素（如"加个小太阳"）
    if add_score > 0 and add_score >= local_score and add_score >= replace_score:
        return IntentClassificationResult(
            intent=EditIntent.ADD_ELEMENT,
            confidence=min(0.6 + add_score * 0.1, 0.95),
            reasoning=f"检测到添加元素关键词",
            suggested_api="multi_elements_addition",
        )
    
    # 判断是否是局部修改
    if local_score > 0 and local_score > add_score and local_score >= replace_score:
        return IntentClassificationResult(
            intent=EditIntent.LOCAL_EDIT,
            confidence=min(0.6 + local_score * 0.1, 0.95),
            reasoning=f"检测到局部修改关键词",
            suggested_api="omni_image_inpainting",
        )
    
    # 判断是否是完整换背景
    if replace_score > 0 and replace_score > add_score and replace_score > local_score:
        return IntentClassificationResult(
            intent=EditIntent.FULL_REPLACE,
            confidence=min(0.6 + replace_score * 0.1, 0.95),
            reasoning=f"检测到换背景关键词",
            suggested_api="image_to_video",
        )
    
    return None  # 分数相近，需要 LLM 分析


async def _llm_classify(prompt: str, has_mask: bool = False, mask_base64: Optional[str] = None) -> IntentClassificationResult:
    """
    使用 LLM 进行意图分类
    
    如果有 mask 图片，使用多模态（图片+文字）分析
    否则只用文字分析
    
    Args:
        prompt: 用户输入的 prompt
        has_mask: 是否有用户绘制的 mask
        mask_base64: mask 图片的 base64 编码（可选）
    
    Returns:
        分类结果
    """
    import json
    import re
    from .llm.service import get_llm_service
    
    llm_service = get_llm_service()
    
    system_prompt = """你是一个视频编辑意图分析专家。分析用户的编辑意图。

## 意图分类
1. **add_element** - 添加元素：用户想添加新元素（太阳、云、光效、贴纸）
2. **local_edit** - 局部修改：用户想修改某个区域
3. **full_replace** - 完整换背景：用户想替换整个背景/场景

## 关键判断
- 提到具体物体（太阳、云、月亮、光效）→ add_element
- 如果有画布/mask，画的形状也说明意图（画了太阳形状→add_element）
- 场景替换（海边、森林、星空）→ full_replace

只返回 JSON：{"intent": "add_element或local_edit或full_replace", "confidence": 0.9, "reasoning": "理由", "detected_element": "识别到的元素（如有）"}"""

    user_prompt = f'用户说："{prompt}"'
    if has_mask:
        user_prompt += "\n用户在画布上画了内容（见图片）"

    try:
        # ★ 如果有 mask 图片，使用多模态分析
        if mask_base64:
            logger.info(f"[IntentClassifier] 使用多模态分析 mask 图片")
            response_text = await llm_service.analyze_image(
                image_base64=mask_base64,
                prompt=user_prompt,
                system_prompt=system_prompt,
            )
        else:
            # 只用文字分析
            response_text = await llm_service.call(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.3,
            )
        
        # 解析 JSON
        json_match = re.search(r'\{[^{}]*\}', response_text)
        if json_match:
            response = json.loads(json_match.group(0))
        else:
            response = json.loads(response_text)
        
        intent_str = response.get("intent", "full_replace")
        intent = EditIntent(intent_str) if intent_str in [e.value for e in EditIntent] else EditIntent.FULL_REPLACE
        
        # 根据意图选择 API
        api_map = {
            EditIntent.ADD_ELEMENT: "multi_elements_addition",
            EditIntent.LOCAL_EDIT: "omni_image_inpainting",
            EditIntent.FULL_REPLACE: "image_to_video",
        }
        
        detected_element = response.get("detected_element", "")
        reasoning = response.get("reasoning", "LLM 分析")
        if detected_element:
            reasoning = f"{reasoning}（识别元素: {detected_element}）"
        
        logger.info(f"[IntentClassifier] LLM 分类成功: {intent.value}, confidence={response.get('confidence', 0.7)}, element={detected_element}")
        
        return IntentClassificationResult(
            intent=intent,
            confidence=response.get("confidence", 0.7),
            reasoning=reasoning,
            suggested_api=api_map[intent],
            enhanced_prompt=detected_element if detected_element else None,
        )
        
    except Exception as e:
        logger.warning(f"[IntentClassifier] LLM 分类失败: {e}")
        # 有 mask 时默认 add_element
        if has_mask:
            return IntentClassificationResult(
                intent=EditIntent.ADD_ELEMENT,
                confidence=0.6,
                reasoning=f"LLM 分类失败，有 mask 默认添加元素: {e}",
                suggested_api="multi_elements_addition",
            )
        return IntentClassificationResult(
            intent=EditIntent.FULL_REPLACE,
            confidence=0.5,
            reasoning=f"LLM 分类失败，默认换背景: {e}",
            suggested_api="image_to_video",
        )


async def classify_edit_intent(
    prompt: str,
    has_mask: bool = False,
    mask_base64: Optional[str] = None,
    use_llm: bool = True,
) -> IntentClassificationResult:
    """
    分类用户的编辑意图（支持多模态）
    
    Args:
        prompt: 用户输入的编辑描述
        has_mask: 是否有用户绘制的 mask 区域
        mask_base64: mask 图片的 base64 编码（用于多模态识别画的内容）
        use_llm: 是否使用 LLM 进行分类
    
    Returns:
        IntentClassificationResult: 分类结果
    """
    logger.info(f"[IntentClassifier] 分类意图: prompt='{prompt}', has_mask={has_mask}, has_mask_image={mask_base64 is not None}")
    
    # Step 1: 尝试关键词快速分类
    keyword_result = _keyword_classify(prompt)
    
    if keyword_result and keyword_result.confidence >= 0.8:
        # 高置信度，直接返回
        logger.info(f"[IntentClassifier] 关键词分类成功: {keyword_result.intent.value}, confidence={keyword_result.confidence}")
        return keyword_result
    
    # Step 2: 使用 LLM 多模态分类（如果有 mask 图片，会同时分析图片内容）
    if use_llm:
        llm_result = await _llm_classify(prompt, has_mask, mask_base64)
        # 如果 LLM 成功，使用 LLM 结果
        if llm_result.confidence > 0.5 and "LLM 分类失败" not in llm_result.reasoning:
            return llm_result
        # LLM 失败时，回退到关键词分类结果
        if keyword_result:
            logger.info(f"[IntentClassifier] LLM 分类失败，使用关键词结果: {keyword_result.intent.value}")
            return keyword_result
    
    # Step 3: 无法确定时的默认值
    if keyword_result:
        return keyword_result
    
    # 有 mask 时，默认为添加元素（用户画了区域通常是想加东西）
    if has_mask:
        return IntentClassificationResult(
            intent=EditIntent.ADD_ELEMENT,
            confidence=0.6,
            reasoning="用户绘制了区域，默认为添加元素",
            suggested_api="multi_elements_addition",
        )
    
    return IntentClassificationResult(
        intent=EditIntent.FULL_REPLACE,
        confidence=0.5,
        reasoning="无法确定意图，默认为换背景",
        suggested_api="image_to_video",
    )


# ========================================
# 测试函数
# ========================================

if __name__ == "__main__":
    import asyncio
    
    async def test():
        test_cases = [
            ("在图中位置加个小太阳阳光打下来", False),
            ("加个太阳", False),
            ("添加一些云彩", False),
            ("换成海边背景", False),
            ("把背景改成星空", False),
            ("把这里改成红色", True),
            ("去掉这个水印", True),
            ("让画面更亮一点", False),
        ]
        
        for prompt, has_mask in test_cases:
            result = await classify_edit_intent(prompt, has_mask, use_llm=False)
            print(f"'{prompt}' (mask={has_mask})")
            print(f"  -> {result.intent.value} ({result.confidence:.2f}): {result.reasoning}")
            print()
    
    asyncio.run(test())
