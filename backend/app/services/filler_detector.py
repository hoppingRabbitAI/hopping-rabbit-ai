"""
HoppingRabbit AI - 智能口癖检测服务

架构：
┌─────────────────────────────────────────────────────────────────┐
│  第一级：豆包 ASR (transcribe.py)                               │
│  - 直接用 URL，不下载文件                                        │
│  - 词级时间戳 + 保留语气词 (enable_ddc=False)                    │
│  - 自动插入静音片段（基于时间间隙分类）                           │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  第二级：智能分析 (本模块)                                       │
│  ├── 静音分类 - 从 ASR 结果提取（breath/hesitation/dead_air）    │
│  └── LLM 语义分析 - 检测口吃/填充词/NG片段                       │
└─────────────────────────────────────────────────────────────────┘

★ 无文件下载，全程使用 URL 或 ASR 结果
"""

import logging
import json
from typing import List, Dict, Optional
from dataclasses import dataclass, field
from enum import Enum

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class FillerType(str, Enum):
    """口癖类型"""
    BREATH = "breath"
    HESITATION = "hesitation"
    DEAD_AIR = "dead_air"
    FILLER_WORD = "filler_word"
    REPEAT_WORD = "repeat_word"
    NG_TAKE = "ng_take"


@dataclass
class FillerDetection:
    """口癖检测结果"""
    segment_id: str
    filler_type: FillerType
    text: str
    start: float
    end: float
    confidence: float = 0.8
    reason: str = ""
    should_delete: bool = True
    asset_id: Optional[str] = None
    
    @property
    def duration_ms(self) -> int:
        return int((self.end - self.start) * 1000)


@dataclass
class FillerAnalysisResult:
    """完整分析结果"""
    detections: List[FillerDetection] = field(default_factory=list)
    total_filler_duration_ms: int = 0
    original_duration_ms: int = 0
    filler_count_by_type: Dict[str, int] = field(default_factory=dict)


# ============================================
# 静音检测（从 ASR 结果提取）
# ============================================

def extract_silences_from_asr(segments: List[Dict]) -> List[FillerDetection]:
    """
    从 ASR 结果中提取静音片段
    
    ASR (transcribe.py) 已经基于时间间隙插入了 silence_info：
    - breath: 换气（句末短停顿）
    - hesitation: 卡顿（句中停顿）
    - dead_air: 死寂（长时间静音）
    - long_pause: 长停顿
    
    直接复用，无需重复分析
    """
    detections = []
    
    for seg in segments:
        silence_info = seg.get("silence_info")
        if not silence_info:
            continue
        
        classification = silence_info.get("classification", "")
        
        # 映射到 FillerType
        type_map = {
            "breath": FillerType.BREATH,
            "hesitation": FillerType.HESITATION,
            "dead_air": FillerType.DEAD_AIR,
            "long_pause": FillerType.DEAD_AIR,  # 长停顿归类为死寂
        }
        
        filler_type = type_map.get(classification)
        if not filler_type:
            continue  # uncertain 等类型跳过
        
        detections.append(FillerDetection(
            segment_id=seg.get("id", ""),
            filler_type=filler_type,
            text="",
            start=seg.get("start", 0),
            end=seg.get("end", 0),
            confidence=0.9,
            reason=silence_info.get("reason", ""),
            asset_id=seg.get("asset_id"),
        ))
    
    return detections


# ============================================
# LLM 语义分析
# ============================================

async def llm_detect_fillers(
    segments: List[Dict],
    excluded_ids: set = None,
) -> List[FillerDetection]:
    """
    使用 LLM 进行语义分析，检测口吃/填充词/NG片段
    无白名单，全部由 LLM 根据上下文判断
    """
    if excluded_ids is None:
        excluded_ids = set()
    
    try:
        from app.services.llm.clients import get_llm
        
        if not settings.volcengine_ark_api_key:
            logger.warning("[LLM] 未配置豆包 API Key，跳过语义分析")
            return []
        
        llm = get_llm(provider="doubao", temperature=0)
        
        segments_to_analyze = [
            seg for seg in segments
            if seg.get("text", "").strip() and seg.get("id") not in excluded_ids
        ]
        
        if not segments_to_analyze:
            return []
        
        all_detections = []
        batch_size = 20
        
        for i in range(0, len(segments_to_analyze), batch_size):
            batch = segments_to_analyze[i:i + batch_size]
            detections = await _llm_analyze_batch(llm, batch)
            all_detections.extend(detections)
        
        logger.info(f"[LLM] 检测到 {len(all_detections)} 个语义问题")
        return all_detections
        
    except Exception as e:
        logger.error(f"[LLM] 检测失败: {e}")
        return []


async def _llm_analyze_batch(llm, batch: List[Dict]) -> List[FillerDetection]:
    """LLM 批量分析"""
    from langchain_core.messages import HumanMessage
    
    texts = "\n".join([
        f"{i+1}. [{seg['id']}] {seg['text']}"
        for i, seg in enumerate(batch)
    ])
    
    prompt = f"""你是视频剪辑助手，分析口播视频文稿，识别需要删除的片段。

## 需要删除：
1. **口吃** - "我我我觉得"、"那那那个"（说话卡顿重复）
2. **填充词** - 整句只有"嗯"、"啊"、"呃"（无意义语气词）
3. **NG片段** - 连续两句意思相同（说错重录）

## 不删除：
- "对对对"、"好好好" - 表示赞同的语气强调
- "那个东西很好" - "那个"是正常指代
- 有实际内容的完整句子

## 文稿：
{texts}

## 输出：
返回需删除片段的 JSON 数组，无则返回 `[]`
每个片段只能有一个标签，不要重复标记同一片段。

```json
[{{"id": "片段ID", "type": "stutter|filler_word|ng_take", "reason": "原因"}}]
```"""

    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        content = response.content.strip()
        
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        content = content.strip()
        if not content or content == "[]":
            return []
        
        results = json.loads(content)
        
        seg_map = {seg["id"]: seg for seg in batch}
        detections = []
        seen_ids = set()  # ★ 去重：每个 segment 只取第一个标签
        
        type_map = {
            "stutter": FillerType.REPEAT_WORD,
            "filler_word": FillerType.FILLER_WORD,
            "ng_take": FillerType.NG_TAKE,
        }
        
        for item in results:
            seg_id = item.get("id", "")
            if seg_id not in seg_map:
                continue
            
            # ★ 去重：同一个 segment 只保留第一个标签
            if seg_id in seen_ids:
                continue
            seen_ids.add(seg_id)
            
            seg = seg_map[seg_id]
            filler_type = type_map.get(item.get("type"), FillerType.FILLER_WORD)
            
            detections.append(FillerDetection(
                segment_id=seg_id,
                filler_type=filler_type,
                text=seg.get("text", ""),
                start=seg.get("start", 0),
                end=seg.get("end", 0),
                confidence=0.85,
                reason=item.get("reason", ""),
                asset_id=seg.get("asset_id"),
            ))
        
        return detections
        
    except json.JSONDecodeError as e:
        logger.warning(f"[LLM] JSON 解析失败: {e}")
        return []
    except Exception as e:
        logger.error(f"[LLM] 分析失败: {e}")
        return []


# ============================================
# 主入口
# ============================================

async def detect_all_fillers(
    segments: List[Dict],
    detect_silences: bool = True,
    detect_semantics: bool = True,
) -> FillerAnalysisResult:
    """
    综合口癖检测
    
    Args:
        segments: ASR 转写片段（含 silence_info，由 transcribe.py 生成）
        detect_silences: 是否检测静音（换气/卡顿）
        detect_semantics: 是否检测语义问题（口吃/填充词/NG）
    
    流程：
    1. 从 ASR 结果提取静音片段（transcribe.py 已分类）
    2. LLM 语义分析（口吃/填充词/NG）
    
    ★ 无文件下载，全程使用 ASR 结果
    """
    all_detections = []
    detected_ids = set()
    
    # 第一层：从 ASR 结果提取静音
    if detect_silences:
        silence_detections = extract_silences_from_asr(segments)
        all_detections.extend(silence_detections)
        detected_ids.update(d.segment_id for d in silence_detections)
        logger.info(f"[Filler] 静音检测: {len(silence_detections)} 个")
    
    # 第二层：LLM 语义分析
    if detect_semantics:
        # 过滤掉静音片段，只分析有文本的
        text_segments = [seg for seg in segments if seg.get("text", "").strip()]
        llm_detections = await llm_detect_fillers(text_segments, detected_ids)
        for d in llm_detections:
            if d.segment_id not in detected_ids:
                all_detections.append(d)
                detected_ids.add(d.segment_id)
        logger.info(f"[Filler] LLM 检测: {len(llm_detections)} 个")
    
    # 统计汇总
    total_duration = sum(d.duration_ms for d in all_detections)
    count_by_type = {}
    for d in all_detections:
        count_by_type[d.filler_type.value] = count_by_type.get(d.filler_type.value, 0) + 1
    
    original_duration = 0
    if segments:
        max_end = max(seg.get("end", 0) for seg in segments)
        original_duration = int(max_end * 1000)
    
    logger.info(f"[Filler] ✅ 检测完成: {len(all_detections)} 个问题, 总时长 {total_duration}ms")
    
    return FillerAnalysisResult(
        detections=all_detections,
        total_filler_duration_ms=total_duration,
        original_duration_ms=original_duration,
        filler_count_by_type=count_by_type,
    )