"""
编辑意图分类器 (Edit Intent Classifier)

根据用户的编辑描述 + 画布涂鸦，智能识别用户的真实意图：
1. sketch_guide: 草图引导 — 用户画了具体形状，AI 根据形状生成真实物体
2. add_element: 添加元素（无涂鸦时，纯文字描述添加）
3. local_edit: 局部修改（涂大面积区域 + "改/去掉/删除"类指令）
4. full_replace: 完整换背景（换成海边、换成星空）

核心原则：用户在画布上画的东西 = 草图形状引导，不是 inpainting mask。
LLM 多模态分析涂鸦内容，识别用户画了什么物体。
"""

import logging
import re
from typing import Dict, Any, Optional, Literal
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class EditIntent(str, Enum):
    """编辑意图类型"""
    SKETCH_GUIDE = "sketch_guide"    # 草图引导：用户画了形状，AI 生成对应真实物体
    ADD_ELEMENT = "add_element"      # 添加元素（无涂鸦，纯文字描述）
    LOCAL_EDIT = "local_edit"        # 局部修改（涂大面积 + 修改类指令）
    FULL_REPLACE = "full_replace"    # 完整换背景（换成海边、换成星空）


@dataclass
class IntentClassificationResult:
    """意图分类结果"""
    intent: EditIntent
    confidence: float  # 0-1，越高越确定
    reasoning: str     # 分类理由
    suggested_api: str # 建议使用的 API
    detected_element: Optional[str] = None  # LLM 识别出的物体详细描述
    position_description: Optional[str] = None  # 物体在照片中的精确位置（英文）
    style_hint: Optional[str] = None  # 原图风格提示（英文）
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


def _keyword_classify(prompt: str, has_mask: bool = False) -> Optional[IntentClassificationResult]:
    """
    基于关键词的快速分类（不需要 LLM）
    
    注意：有 mask 时，大部分情况应走 LLM 多模态分析，
    关键词分类只处理明确的 local_edit（"去掉/删除/擦除"）和 full_replace 场景。
    """
    prompt_lower = prompt.lower()
    
    # 计算各类关键词的匹配数
    add_score = sum(1 for kw in ADD_ELEMENT_KEYWORDS if kw.lower() in prompt_lower)
    local_score = sum(1 for kw in LOCAL_EDIT_KEYWORDS if kw.lower() in prompt_lower)
    replace_score = sum(1 for kw in FULL_REPLACE_KEYWORDS if kw.lower() in prompt_lower)
    
    logger.info(f"[IntentClassifier] 关键词匹配分数: add={add_score}, local={local_score}, replace={replace_score}, has_mask={has_mask}")
    
    max_score = max(add_score, local_score, replace_score)
    
    if max_score == 0:
        return None  # 需要 LLM 分析
    
    # ★ 有 mask + 添加元素关键词 → SKETCH_GUIDE（用户画了形状来引导生成）
    if has_mask and add_score > 0 and add_score >= local_score and add_score >= replace_score:
        return IntentClassificationResult(
            intent=EditIntent.SKETCH_GUIDE,
            confidence=min(0.6 + add_score * 0.1, 0.85),  # 稍低置信度，优先让 LLM 分析涂鸦内容
            reasoning=f"有涂鸦 + 添加元素关键词 → 草图引导",
            suggested_api="omni_image",
        )
    
    # 无 mask + 添加元素 → ADD_ELEMENT
    if not has_mask and add_score > 0 and add_score >= local_score and add_score >= replace_score:
        return IntentClassificationResult(
            intent=EditIntent.ADD_ELEMENT,
            confidence=min(0.6 + add_score * 0.1, 0.95),
            reasoning=f"检测到添加元素关键词",
            suggested_api="omni_image",
        )
    
    # 局部修改（"改/去掉/删除/擦除" 类指令）
    if local_score > 0 and local_score > add_score and local_score >= replace_score:
        return IntentClassificationResult(
            intent=EditIntent.LOCAL_EDIT,
            confidence=min(0.6 + local_score * 0.1, 0.95),
            reasoning=f"检测到局部修改关键词",
            suggested_api="omni_image",
        )
    
    # 完整换背景
    if replace_score > 0 and replace_score > add_score and replace_score > local_score:
        return IntentClassificationResult(
            intent=EditIntent.FULL_REPLACE,
            confidence=min(0.6 + replace_score * 0.1, 0.95),
            reasoning=f"检测到换背景关键词",
            suggested_api="omni_image",
        )
    
    return None  # 分数相近，需要 LLM 分析


async def _llm_classify(prompt: str, has_mask: bool = False, mask_base64: Optional[str] = None, original_image_base64: Optional[str] = None) -> IntentClassificationResult:
    """
    使用 LLM 多模态分析意图 + 涂鸦内容
    
    核心能力：
    1. 有涂鸦时 → 识别用户画了什么物体（草图引导）
    2. 无涂鸦时 → 纯文字意图分析
    3. 无 prompt 时 → 完全依赖视觉分析推断意图
    """
    import json
    import re
    from .llm.service import get_llm_service
    
    llm_service = get_llm_service()
    
    # ★ 重写系统 prompt：核心是识别涂鸦画了什么 + 精确的位置/风格描述
    system_prompt = """你是一个画布编辑意图分析专家。用户在一张照片上画了涂鸦（草图），你需要分析涂鸦代表什么，并输出精确的生成指令。

## 核心任务
1. **识别涂鸦画了什么物体**：用户画的形状代表什么？（帽子、眼镜、翅膀、胡子、耳朵、尾巴等）
2. **结合原图上下文**：涂鸦在什么位置？与原图中的人/物是什么关系？
3. **判断编辑意图**
4. **输出精确的生成描述**：让 AI 仅凭文字就能在正确位置生成正确物体

## 意图分类
1. **sketch_guide** — 草图引导生成（最常见）：用户画了一个具体形状，希望 AI 在该位置生成对应的真实物体
   - 例：在头顶画了弧形 → 想加帽子
   - 例：在眼睛位置画了两个圈 → 想加眼镜
   - 例：在背后画了翅膀形状 → 想加翅膀
   - 例：在嘴巴上画了弧线 → 想加胡子
   - 只要用户画了涂鸦，且不是"删除/去掉/擦除"类指令，就应该归为 sketch_guide
   
2. **local_edit** — 局部修改：用户涂了大面积区域 + prompt 是"改/去掉/删除/擦除/变成xx颜色"
   
3. **add_element** — 添加元素（无涂鸦）：没有画任何东西，纯文字描述想添加的元素
   
4. **full_replace** — 完整换背景：想替换整个背景/场景

## 无 prompt 的情况
如果用户没写文字描述，完全依赖视觉分析：
- 分析涂鸦的形状、位置、与原图的关系
- 推断用户想要添加什么物体

## 返回 JSON 格式
{
  "intent": "sketch_guide/local_edit/add_element/full_replace",
  "confidence": 0.9,
  "reasoning": "分析理由",
  "detected_element": "要生成的物体的详细描述",
  "position_description": "物体在照片中的精确位置描述（英文）",
  "style_hint": "与原图匹配的风格描述（英文）"
}

### detected_element 要求
尽可能具体、真实、详细。这段描述将直接用于 AI 生图的 prompt，所以要像一个专业摄影指令：
- ❌ "帽子" → ✅ "一顶深棕色皮质牛仔帽，帽檐微卷，质感自然"
- ❌ "眼镜" → ✅ "一副黑色半框矩形眼镜，镜片微反光，金属铰链"
- ❌ "翅膀" → ✅ "一对白色羽毛天使翅膀，展开约肩宽1.5倍，羽毛层次分明"
- 根据涂鸦的形状轮廓和原图的整体风格（写实/卡通/时尚/休闲）来推断最匹配的具体描述

### position_description 要求
用英文描述物体在照片中的精确位置，相对于人/物体的空间关系：
- 例："on top of the person's head, slightly tilted to the right"
- 例："over the person's eyes, resting on the bridge of the nose"  
- 例："extending from behind the person's shoulders, symmetrically spread"

### style_hint 要求
分析原图的视觉风格，输出与之匹配的风格关键词（英文）：
- 例："casual street photography, natural daylight, warm color grading"
- 例："professional studio portrait, soft diffused lighting, neutral background"
- 例："outdoor selfie, bright natural light, vivid colors"
"""

    # 构建用户 prompt
    if prompt:
        user_prompt = f'用户说："{prompt}"'
    else:
        user_prompt = "用户没有输入文字描述，请完全根据涂鸦和原图来推断意图。"
    
    if has_mask:
        user_prompt += "\n用户在画布上画了涂鸦（见图片），请分析涂鸦的形状代表什么物体。"

    try:
        # ★ 多模态分析：同时传入涂鸦图 + 原图（如果有）
        if mask_base64:
            logger.info(f"[IntentClassifier] 使用多模态分析涂鸦内容")
            
            # 如果有原图，构建更丰富的分析上下文
            if original_image_base64:
                user_prompt += "\n第一张图是用户的涂鸦/草图，第二张图是原始照片。请结合两者分析。"
                # 传多张图片分析
                response_text = await llm_service.analyze_images(
                    images=[mask_base64, original_image_base64],
                    prompt=user_prompt,
                    system_prompt=system_prompt,
                )
            else:
                response_text = await llm_service.analyze_image(
                    image_base64=mask_base64,
                    prompt=user_prompt,
                    system_prompt=system_prompt,
                )
        else:
            response_text = await llm_service.call(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.3,
            )
        
        # 解析 JSON（支持多行）
        # 先尝试找 JSON 块
        json_text = response_text.strip()
        if json_text.startswith("```"):
            # 去掉 markdown code block
            json_text = re.sub(r'^```\w*\n?', '', json_text)
            json_text = re.sub(r'\n?```$', '', json_text)
        
        try:
            response = json.loads(json_text)
        except json.JSONDecodeError:
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                response = json.loads(json_match.group(0))
            else:
                raise ValueError(f"无法解析 LLM 返回的 JSON: {response_text[:200]}")
        
        intent_str = response.get("intent", "sketch_guide" if has_mask else "full_replace")
        intent = EditIntent(intent_str) if intent_str in [e.value for e in EditIntent] else (EditIntent.SKETCH_GUIDE if has_mask else EditIntent.FULL_REPLACE)
        
        detected_element = response.get("detected_element", "")
        position_description = response.get("position_description", "")
        style_hint = response.get("style_hint", "")
        reasoning = response.get("reasoning", "LLM 分析")
        if detected_element:
            reasoning = f"{reasoning}（识别元素: {detected_element}）"
        
        logger.info(f"[IntentClassifier] LLM 分类成功: intent={intent.value}, confidence={response.get('confidence', 0.7)}, "
                    f"element={detected_element}, position={position_description}, style={style_hint}")
        
        return IntentClassificationResult(
            intent=intent,
            confidence=response.get("confidence", 0.7),
            reasoning=reasoning,
            suggested_api="omni_image",
            detected_element=detected_element if detected_element else None,
            position_description=position_description if position_description else None,
            style_hint=style_hint if style_hint else None,
            enhanced_prompt=detected_element if detected_element else None,
        )
        
    except Exception as e:
        logger.warning(f"[IntentClassifier] LLM 分类失败: {e}")
        # 有 mask 时默认 sketch_guide
        if has_mask:
            return IntentClassificationResult(
                intent=EditIntent.SKETCH_GUIDE,
                confidence=0.6,
                reasoning=f"LLM 分类失败，有涂鸦默认草图引导: {e}",
                suggested_api="omni_image",
                detected_element=prompt if prompt else "the object suggested by the user's sketch",
            )
        return IntentClassificationResult(
            intent=EditIntent.FULL_REPLACE,
            confidence=0.5,
            reasoning=f"LLM 分类失败，默认换背景: {e}",
            suggested_api="omni_image",
        )


async def classify_edit_intent(
    prompt: str,
    has_mask: bool = False,
    mask_base64: Optional[str] = None,
    original_image_base64: Optional[str] = None,
    use_llm: bool = True,
) -> IntentClassificationResult:
    """
    分类用户的编辑意图（支持多模态）
    
    Args:
        prompt: 用户输入的编辑描述（可为空）
        has_mask: 是否有用户绘制的涂鸦
        mask_base64: 涂鸦图片的 base64 编码（用于多模态识别画的内容）
        original_image_base64: 原始照片的 base64（用于结合上下文分析）
        use_llm: 是否使用 LLM 进行分类
    
    Returns:
        IntentClassificationResult: 分类结果（含 detected_element）
    """
    logger.info(f"[IntentClassifier] 分类意图: prompt='{prompt}', has_mask={has_mask}, has_mask_image={mask_base64 is not None}, has_original={original_image_base64 is not None}")
    
    # ★ 有涂鸦时，优先使用 LLM 多模态分析涂鸦内容
    # 因为关键词分类无法识别涂鸦画了什么物体
    if has_mask and use_llm and mask_base64:
        llm_result = await _llm_classify(prompt, has_mask, mask_base64, original_image_base64)
        if llm_result.confidence > 0.5 and "LLM 分类失败" not in llm_result.reasoning:
            return llm_result
        # LLM 失败时 fallback 到关键词
        logger.info(f"[IntentClassifier] 有涂鸦但 LLM 分析失败，回退到关键词分类")
    
    # Step 1: 关键词快速分类
    keyword_result = _keyword_classify(prompt, has_mask)
    
    if keyword_result and keyword_result.confidence >= 0.8:
        logger.info(f"[IntentClassifier] 关键词分类成功: {keyword_result.intent.value}, confidence={keyword_result.confidence}")
        return keyword_result
    
    # Step 2: 无涂鸦时使用 LLM 文字分析
    if use_llm and not has_mask:
        llm_result = await _llm_classify(prompt, has_mask)
        if llm_result.confidence > 0.5 and "LLM 分类失败" not in llm_result.reasoning:
            return llm_result
        if keyword_result:
            logger.info(f"[IntentClassifier] LLM 分类失败，使用关键词结果: {keyword_result.intent.value}")
            return keyword_result
    
    # Step 3: 兜底
    if keyword_result:
        return keyword_result
    
    # 有涂鸦时，默认为草图引导（用户画了东西 = 想添加物体）
    if has_mask:
        return IntentClassificationResult(
            intent=EditIntent.SKETCH_GUIDE,
            confidence=0.6,
            reasoning="用户绘制了涂鸦，默认为草图引导生成",
            suggested_api="omni_image",
            detected_element=prompt if prompt else "the object suggested by the user's sketch",
        )
    
    return IntentClassificationResult(
        intent=EditIntent.FULL_REPLACE,
        confidence=0.5,
        reasoning="无法确定意图，默认为换背景",
        suggested_api="omni_image",
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
            ("加个帽子", True),     # 有涂鸦 + prompt → sketch_guide
            ("", True),            # 无 prompt 有涂鸦 → sketch_guide
        ]
        
        for prompt, has_mask in test_cases:
            result = await classify_edit_intent(prompt, has_mask, use_llm=False)
            print(f"'{prompt}' (mask={has_mask})")
            print(f"  -> {result.intent.value} ({result.confidence:.2f}): {result.reasoning}")
            print()
    
    asyncio.run(test())
