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
        # start/end 已经是毫秒单位（来自 ASR 转写）
        return int(self.end - self.start)


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
    # ★★★ 新增细分开关 ★★★
    detect_ng: bool = True,         # 是否检测 NG/重复片段
    detect_fillers: bool = True,    # 是否检测口癖词
) -> List[FillerDetection]:
    """
    使用 LLM 进行语义分析，检测口吃/填充词/NG片段
    无白名单，全部由 LLM 根据上下文判断
    
    Args:
        segments: 待分析的片段列表
        excluded_ids: 已被其他检测器标记的片段ID（跳过）
        detect_ng: 是否检测 NG/重复片段
        detect_fillers: 是否检测口癖词
    """
    if excluded_ids is None:
        excluded_ids = set()
    
    # ★ 如果两个开关都关闭，直接返回空
    if not detect_ng and not detect_fillers:
        logger.info("[LLM] NG 和口癖词检测均已关闭，跳过 LLM 分析")
        return []
    
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
        
        # 一次性分析所有 segment，减少 LLM 调用次数
        logger.info(f"[LLM] 开始分析 {len(segments_to_analyze)} 个语音片段 (ng={detect_ng}, fillers={detect_fillers})")
        all_detections = await _llm_analyze_batch(llm, segments_to_analyze, detect_ng, detect_fillers)
        
        logger.info(f"[LLM] 检测到 {len(all_detections)} 个语义问题")
        return all_detections
        
    except Exception as e:
        logger.error(f"[LLM] 检测失败: {e}")
        return []


async def _llm_analyze_batch(llm, batch: List[Dict], detect_ng: bool = True, detect_fillers: bool = True) -> List[FillerDetection]:
    """LLM 批量分析
    
    Args:
        llm: LLM 客户端
        batch: 待分析的片段列表
        detect_ng: 是否检测 NG/重复片段
        detect_fillers: 是否检测口癖词
    """
    from langchain_core.messages import HumanMessage
    
    texts = "\n".join([
        f"{i+1}. [{seg['id']}] {seg['text']}"
        for i, seg in enumerate(batch)
    ])
    
    # ★★★ 根据开关动态构建 Prompt ★★★
    detect_items = []
    type_hints = []
    
    if detect_fillers:
        detect_items.append("1. **口吃** - \"我我我觉得\"、\"那那那个\"（连续重复同一个字/词）")
        detect_items.append("2. **填充词** - 整句只有\"嗯\"、\"啊\"、\"呃\"（无意义语气词）")
        type_hints.append("stutter")
        type_hints.append("filler_word")
    
    if detect_ng:
        detect_items.append("3. **NG片段** - **紧挨着的**两句话意思完全相同（说错后立即重录）")
        type_hints.append("ng_take")
    
    detect_section = "\n".join(detect_items) if detect_items else "（无检测项）"
    type_hint_str = "|".join(type_hints) if type_hints else "none"
    
    prompt = f"""你是视频剪辑助手，分析口播视频文稿，识别需要删除的片段。

## 需要删除：
{detect_section}

## 不删除（重要！）：
- "对对对"、"好好好" - 表示赞同的语气强调
- "那个东西很好" - "那个"是正常指代
- 有实际内容的完整句子
- **相隔较远的相似内容** - 这是总结/回顾/强调，不是 NG
- **不同语境下的重复** - 开头提出概念，结尾总结回顾，这是正常叙述结构

## NG片段判断标准（必须同时满足）：
- 两句话**紧挨着**出现（中间无其他内容）
- 两句话**意思完全相同**
- 明显是说错后**立即重录**的情况

## 文稿：
{texts}

## 输出：
返回需删除片段的 JSON 数组，无则返回 `[]`
每个片段只能有一个标签，不要重复标记同一片段。

```json
[{{"id": "片段ID", "type": "{type_hint_str}", "reason": "原因"}}]
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
    # ★★★ 新增三选项参数 ★★★
    cut_bad_takes: bool = True,         # 是否检测 NG/重复片段
    remove_filler_words: bool = True,   # 是否检测口癖词
) -> FillerAnalysisResult:
    """
    综合口癖检测
    
    Args:
        segments: ASR 转写片段（含 silence_info，由 transcribe.py 生成）
        detect_silences: 是否检测静音（换气/卡顿/死寂）
        detect_semantics: 是否进行 LLM 语义分析
        cut_bad_takes: 是否检测 NG/重复片段（需要 detect_semantics=True）
        remove_filler_words: 是否检测口癖词（需要 detect_semantics=True）
    
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
        llm_detections = await llm_detect_fillers(
            text_segments, 
            detected_ids,
            # ★★★ 传递细分开关给 LLM 检测 ★★★
            detect_ng=cut_bad_takes,
            detect_fillers=remove_filler_words,
        )
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