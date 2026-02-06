"""
B-Roll 智能推荐 Agent

基于语义分析，为视频片段智能推荐 B-Roll 素材

核心功能:
1. 语义分析 - 识别哪些片段需要 B-Roll
2. 类型决策 - 视频 B-Roll 还是图片 B-Roll
3. 时长匹配 - 根据内容长度决定 B-Roll 时长
4. 关键词提取 - 生成搜索关键词
5. 素材搜索 - 调用 Pexels/Pixabay API
"""

import os
import json
import httpx
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from enum import Enum
from pydantic import BaseModel, Field

from app.services.llm.clients import get_analysis_llm
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser

# 🆕 导入规则引擎
from app.services.remotion_agent.broll_trigger import (
    detect_broll_triggers,
    detect_primary_trigger,
    BrollTriggerType,
)

logger = logging.getLogger(__name__)


# ============================================
# 数据模型
# ============================================

class BRollType(str, Enum):
    """B-Roll 类型"""
    VIDEO = "video"      # 视频素材
    IMAGE = "image"      # 图片素材
    NONE = "none"        # 不需要 B-Roll


class BRollSource(str, Enum):
    """B-Roll 来源"""
    PEXELS = "pexels"
    PIXABAY = "pixabay"
    KLING_AI = "kling_ai"   # AI 生成
    USER_UPLOAD = "user"    # 用户上传


class SegmentBRollDecision(BaseModel):
    """单个片段的 B-Roll 决策"""
    segment_id: str = Field(description="片段ID")
    need_broll: bool = Field(description="是否需要 B-Roll")
    broll_type: BRollType = Field(default=BRollType.NONE, description="B-Roll 类型")
    reason: str = Field(default="", description="决策原因")
    confidence: float = Field(default=0.8, description="置信度 0-1")
    
    # B-Roll 规格
    suggested_duration_ms: int = Field(default=0, description="建议 B-Roll 时长(毫秒)")
    start_offset_ms: int = Field(default=0, description="在片段中的起始偏移(毫秒)")
    
    # 搜索关键词
    keywords_en: List[str] = Field(default_factory=list, description="英文搜索关键词")
    keywords_cn: List[str] = Field(default_factory=list, description="中文关键词(用于显示)")
    
    # 场景描述(用于 AI 生成)
    scene_description: str = Field(default="", description="场景描述(用于AI生成)")
    
    # 匹配的素材
    matched_assets: List[Dict[str, Any]] = Field(default_factory=list, description="匹配到的素材列表")


class BRollAnalysisResult(BaseModel):
    """B-Roll 分析结果"""
    session_id: str = Field(description="会话ID")
    total_segments: int = Field(description="总片段数")
    broll_segments: int = Field(description="需要 B-Roll 的片段数")
    decisions: List[SegmentBRollDecision] = Field(description="每个片段的决策")
    
    # 统计信息
    total_broll_duration_ms: int = Field(default=0, description="B-Roll 总时长")
    video_broll_count: int = Field(default=0, description="视频 B-Roll 数量")
    image_broll_count: int = Field(default=0, description="图片 B-Roll 数量")


# ============================================
# LLM Prompt 模板
# ============================================

BROLL_ANALYSIS_SYSTEM = """你是一个专业的视频剪辑助手，专门为口播视频分析并推荐 B-Roll 素材。

## B-Roll 的作用
1. **视觉丰富**：避免画面单调，让观众保持注意力
2. **辅助说明**：用画面解释抽象概念
3. **节奏调节**：缓解视觉疲劳，增加观看舒适度
4. **专业感**：提升视频制作品质

## 什么情况下需要 B-Roll？

### 强烈建议添加 B-Roll ✅
1. **描述具体事物**：提到产品、地点、物体、人物等
   - 例："这款手机的摄像头..." → 手机特写
   - 例："在北京的时候..." → 城市风景
2. **解释抽象概念**：需要用画面辅助理解
   - 例："数据增长了300%..." → 增长图表/动画
   - 例："用户体验很重要..." → 用户使用场景
3. **列举/举例**：连续讲述多个点
   - 例："第一点是...第二点是..." → 配合图标/动画
4. **情绪高潮**：强调重点内容
   - 例："这是最关键的一步！" → 强调画面
5. **转折/过渡**：话题转换时
   - 例："说完这个，我们来看看..." → 过渡画面

### 不需要 B-Roll ❌
1. **人物特写强调**：说话人需要直接面对观众
   - 例："我想对你说..." → 保持口播画面
2. **快速过渡句**：时长太短（< 2秒）
3. **已有画面切换**：正在展示产品/演示
4. **互动性内容**：需要看到说话人的表情

## B-Roll 类型选择

### 视频 B-Roll (video)
- 动态场景：城市、自然、人物活动
- 产品演示：使用场景、特写展示
- 抽象概念：数据可视化、流程动画

### 图片 B-Roll (image)
- 静态物体：产品图、截图、证书
- 信息图表：数据图、流程图
- 引用内容：新闻截图、社交媒体

## B-Roll 时长规则
1. 短片段 (2-5秒)：单个概念、快速展示
2. 中等片段 (5-10秒)：详细展示、场景建立
3. 长片段 (10-15秒)：复杂概念、多步骤演示

## 关键词生成规则（非常重要！）
1. **必须是具体的视觉元素**：能在视频中看到的东西
2. **优先名词**：物体 > 场景 > 动作
3. **使用 Pexels 常见搜索词**：
   - 科技类: technology, smartphone, laptop, coding, office
   - 自然类: nature, sunset, ocean, forest, mountain
   - 商务类: business, meeting, teamwork, presentation
   - 生活类: lifestyle, cooking, fitness, travel
   - 城市类: city, urban, traffic, building, skyline
4. **避免抽象词**：不要用 success, growth, important 等
5. **2-3个关键词**：主关键词 + 场景词
6. **英文搜索词格式**：全小写，空格分隔的短语也可以

### 关键词示例
| 原文 | ✅ 好的关键词 | ❌ 差的关键词 |
|------|-------------|--------------|
| "手机摄像头很强大" | smartphone camera, phone photography | technology, powerful |
| "数据增长了300%" | business chart, graph animation | growth, success |
| "北京的故宫" | beijing palace, chinese architecture | china, travel |
| "第一步打开设置" | phone settings, app interface | tutorial, step |
| "美食太好吃了" | delicious food, restaurant meal | tasty, yummy |

## 输出格式
严格按 JSON 格式输出，不要有其他解释。"""


BROLL_ANALYSIS_USER = """分析以下视频片段，判断哪些需要添加 B-Roll：

## 视频信息
- 视频时长: {total_duration_sec} 秒
- 视频风格: {video_style}

## 片段列表（带时间戳）
```json
{segments_json}
```

## 要求
对每个片段输出：
1. `need_broll`: 是否需要 B-Roll
2. `broll_type`: "video" 或 "image" 或 "none"
3. `reason`: 简短说明原因
4. `confidence`: 置信度 (0-1)
5. `suggested_duration_ms`: 建议 B-Roll 时长（毫秒）
6. `keywords_en`: 英文搜索关键词（2-4个）
7. `keywords_cn`: 中文关键词（用于显示）
8. `scene_description`: 场景描述（英文，用于AI生成）

输出 JSON:
```json
{{
  "decisions": [
    {{
      "segment_id": "片段ID",
      "need_broll": true/false,
      "broll_type": "video/image/none",
      "reason": "原因",
      "confidence": 0.9,
      "suggested_duration_ms": 3000,
      "keywords_en": ["keyword1", "keyword2"],
      "keywords_cn": ["关键词1", "关键词2"],
      "scene_description": "A professional..."
    }}
  ]
}}
```"""

BROLL_ANALYSIS_PROMPT = ChatPromptTemplate.from_messages([
    ("system", BROLL_ANALYSIS_SYSTEM),
    ("user", BROLL_ANALYSIS_USER),
])


# ============================================
# B-Roll Agent 类
# ============================================

# 🆕 触发类型到 B-Roll 类型的映射
TRIGGER_TO_BROLL_TYPE = {
    BrollTriggerType.DATA_CITE: BRollType.IMAGE,       # 数据 → 图表/数字图片
    BrollTriggerType.EXAMPLE_MENTION: BRollType.VIDEO, # 示例 → 演示视频
    BrollTriggerType.COMPARISON: BRollType.IMAGE,      # 对比 → 对比图
    BrollTriggerType.PRODUCT_MENTION: BRollType.VIDEO, # 产品 → 产品视频
    BrollTriggerType.PROCESS_DESC: BRollType.VIDEO,    # 流程 → 演示视频
    BrollTriggerType.CONCEPT_VISUAL: BRollType.IMAGE,  # 概念 → 概念图
}

# 🆕 触发类型到中文名称的映射
TRIGGER_TYPE_NAMES = {
    BrollTriggerType.DATA_CITE: "数据引用",
    BrollTriggerType.EXAMPLE_MENTION: "示例提及",
    BrollTriggerType.COMPARISON: "对比说明",
    BrollTriggerType.PRODUCT_MENTION: "产品提及",
    BrollTriggerType.PROCESS_DESC: "流程描述",
    BrollTriggerType.CONCEPT_VISUAL: "概念可视化",
}


class BRollAgent:
    """
    B-Roll 智能推荐 Agent
    
    工作流程:
    0. 🆕 规则引擎快速预检测 - 识别触发类型
    1. analyze_segments - LLM 分析哪些片段需要 B-Roll
    2. search_assets - 为每个片段搜索匹配素材
    3. rank_and_select - 排序并选择最佳素材
    """
    
    def __init__(
        self,
        pexels_api_key: Optional[str] = None,
        pixabay_api_key: Optional[str] = None,
    ):
        self.pexels_api_key = pexels_api_key or os.getenv("PEXELS_API_KEY", "")
        self.pixabay_api_key = pixabay_api_key or os.getenv("PIXABAY_API_KEY", "")
        self.llm = get_analysis_llm()
    
    def _detect_with_rules(
        self,
        segments: List[Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        """
        🆕 使用规则引擎快速检测 B-Roll 触发点
        
        Returns:
            {segment_id: {need_broll, trigger_type, trigger_text, importance, suggested_broll}}
        """
        hints = {}
        
        for seg in segments:
            seg_id = seg.get("id", "")
            text = seg.get("text", "")
            
            if not text:
                hints[seg_id] = {"need_broll": False, "trigger_type": None}
                continue
            
            # 使用规则引擎检测
            triggers = detect_broll_triggers(text)
            
            if triggers:
                # 取最高优先级的触发
                primary = triggers[0]  # 已按优先级排序
                hints[seg_id] = {
                    "need_broll": True,
                    "trigger_type": primary.trigger_type,
                    "trigger_type_name": TRIGGER_TYPE_NAMES.get(primary.trigger_type, ""),
                    "trigger_text": primary.matched_text,
                    "importance": primary.importance,
                    "suggested_broll": primary.suggested_broll,
                    "suggested_broll_type": TRIGGER_TO_BROLL_TYPE.get(primary.trigger_type, BRollType.VIDEO),
                    "all_triggers": [(t.trigger_type.value, t.matched_text) for t in triggers],
                }
            else:
                hints[seg_id] = {"need_broll": False, "trigger_type": None}
        
        return hints
        
    async def analyze(
        self,
        session_id: str,
        segments: List[Dict[str, Any]],
        video_style: str = "口播",
        total_duration_ms: int = 0,
        search_assets: bool = True,
    ) -> BRollAnalysisResult:
        """
        完整的 B-Roll 分析流程
        
        Args:
            session_id: 会话ID
            segments: 转写片段列表 [{id, text, start, end}, ...]
            video_style: 视频风格
            total_duration_ms: 视频总时长
            search_assets: 是否搜索素材
            
        Returns:
            BRollAnalysisResult
        """
        logger.info(f"[BRollAgent] 开始分析 {len(segments)} 个片段")
        
        # 🆕 Step 0: 规则引擎快速预检测
        rule_hints = self._detect_with_rules(segments)
        logger.info(f"[BRollAgent] 规则引擎检测到 {sum(1 for h in rule_hints.values() if h['need_broll'])} 个片段需要 B-Roll")
        
        # Step 1: LLM 分析 (结合规则提示)
        decisions = await self._analyze_with_llm(
            segments=segments,
            video_style=video_style,
            total_duration_ms=total_duration_ms,
            rule_hints=rule_hints,  # 🆕 传递规则提示
        )
        
        # Step 2: 搜索素材 (可选)
        if search_assets:
            for decision in decisions:
                if decision.need_broll and decision.keywords_en:
                    assets = await self._search_assets(
                        keywords=decision.keywords_en,
                        broll_type=decision.broll_type,
                        duration_hint_ms=decision.suggested_duration_ms,
                    )
                    decision.matched_assets = assets
        
        # Step 3: 统计
        broll_segments = [d for d in decisions if d.need_broll]
        total_broll_duration = sum(d.suggested_duration_ms for d in broll_segments)
        video_count = sum(1 for d in broll_segments if d.broll_type == BRollType.VIDEO)
        image_count = sum(1 for d in broll_segments if d.broll_type == BRollType.IMAGE)
        
        result = BRollAnalysisResult(
            session_id=session_id,
            total_segments=len(segments),
            broll_segments=len(broll_segments),
            decisions=decisions,
            total_broll_duration_ms=total_broll_duration,
            video_broll_count=video_count,
            image_broll_count=image_count,
        )
        
        logger.info(f"[BRollAgent] ✅ 分析完成: {len(broll_segments)}/{len(segments)} 片段需要 B-Roll")
        return result
    
    async def _analyze_with_llm(
        self,
        segments: List[Dict[str, Any]],
        video_style: str,
        total_duration_ms: int,
        rule_hints: Optional[Dict[str, Dict[str, Any]]] = None,  # 🆕 规则提示
    ) -> List[SegmentBRollDecision]:
        """
        使用 LLM 分析片段 (结合规则引擎提示)
        """
        if not segments:
            return []
        
        rule_hints = rule_hints or {}
        
        # 准备输入数据 (🆕 添加规则提示)
        segments_for_llm = []
        for seg in segments:
            seg_id = seg.get("id", "")
            seg_data = {
                "id": seg_id,
                "text": seg.get("text", ""),
                "start_ms": seg.get("start", 0),
                "end_ms": seg.get("end", 0),
                "duration_ms": seg.get("end", 0) - seg.get("start", 0),
            }
            
            # 🆕 添加规则引擎提示
            hint = rule_hints.get(seg_id, {})
            if hint.get("need_broll"):
                seg_data["rule_hint"] = {
                    "trigger_type": hint.get("trigger_type_name", ""),
                    "trigger_text": hint.get("trigger_text", ""),
                    "suggested_broll": hint.get("suggested_broll", ""),
                    "importance": hint.get("importance", "medium"),
                }
            
            segments_for_llm.append(seg_data)
        
        total_duration_sec = total_duration_ms / 1000 if total_duration_ms else sum(s["duration_ms"] for s in segments_for_llm) / 1000
        
        # ★ 打印 LLM 入参
        # 🆕 记录规则引擎提示
        rule_triggered = sum(1 for s in segments_for_llm if s.get("rule_hint"))
        logger.info(f"[BRollAgent] 规则引擎预检测: {rule_triggered}/{len(segments_for_llm)} 片段有触发提示")
        
        segments_json_str = json.dumps(segments_for_llm, ensure_ascii=False, indent=2)
        logger.info(f"[BRollAgent] ========== LLM 入参 ==========")
        logger.info(f"[BRollAgent] video_style: {video_style}")
        logger.info(f"[BRollAgent] total_duration_sec: {total_duration_sec:.1f}")
        logger.info(f"[BRollAgent] segments 数量: {len(segments_for_llm)}")
        logger.info(f"[BRollAgent] segments_json (前500字符):\n{segments_json_str[:500]}")
        logger.info(f"[BRollAgent] ================================")
        
        # 调用 LLM
        try:
            chain = BROLL_ANALYSIS_PROMPT | self.llm
            response = await chain.ainvoke({
                "segments_json": segments_json_str,
                "video_style": video_style,
                "total_duration_sec": f"{total_duration_sec:.1f}",
            })
            
            # 解析响应
            content = response.content if hasattr(response, 'content') else str(response)
            logger.info(f"[BRollAgent] LLM 响应长度: {len(content)}, 前200字符: {content[:200] if content else '(空)'}")
            
            if not content or not content.strip():
                logger.warning(f"[BRollAgent] ⚠️ LLM 返回空内容，使用规则引擎结果降级")
                # 🆕 使用规则引擎结果降级
                return self._fallback_to_rules(segments, rule_hints)
            
            decisions = self._parse_llm_response(content, segments, rule_hints)
            return decisions
            
        except Exception as e:
            import traceback
            logger.error(f"[BRollAgent] LLM 分析失败: {type(e).__name__}: {e}")
            logger.error(f"[BRollAgent] 完整堆栈:\n{traceback.format_exc()}")
            # 🆕 使用规则引擎结果降级
            logger.info(f"[BRollAgent] 使用规则引擎结果降级")
            return self._fallback_to_rules(segments, rule_hints)
    
    def _fallback_to_rules(
        self,
        segments: List[Dict[str, Any]],
        rule_hints: Dict[str, Dict[str, Any]],
    ) -> List[SegmentBRollDecision]:
        """
        🆕 LLM 失败时使用规则引擎结果降级
        """
        decisions = []
        for i, seg in enumerate(segments):
            seg_id = seg.get("id", f"seg-{i}")
            hint = rule_hints.get(seg_id, {})
            
            if hint.get("need_broll"):
                # 从规则提示构建决策
                trigger_type = hint.get("trigger_type")
                suggested_broll_type = hint.get("suggested_broll_type", BRollType.VIDEO)
                
                # 简单关键词提取：使用触发文本
                trigger_text = hint.get("trigger_text", "")
                keywords_cn = [trigger_text] if trigger_text else []
                # 简单翻译（可以后续优化）
                keywords_en = []
                
                decisions.append(SegmentBRollDecision(
                    segment_id=seg_id,
                    need_broll=True,
                    broll_type=suggested_broll_type,
                    reason=f"规则检测: {hint.get('trigger_type_name', '未知')}",
                    confidence=0.9 if hint.get("importance") == "high" else 0.7,
                    suggested_duration_ms=min(3000, (seg.get("end", 0) - seg.get("start", 0)) * 0.6),
                    keywords_cn=keywords_cn,
                    keywords_en=keywords_en,
                    scene_description=hint.get("suggested_broll", ""),
                ))
            else:
                decisions.append(SegmentBRollDecision(
                    segment_id=seg_id,
                    need_broll=False,
                    broll_type=BRollType.NONE,
                    reason="规则未检测到触发",
                ))
        
        return decisions
    
    def _parse_llm_response(
        self,
        content: str,
        original_segments: List[Dict],
        rule_hints: Optional[Dict[str, Dict[str, Any]]] = None,  # 🆕 规则提示
    ) -> List[SegmentBRollDecision]:
        """
        解析 LLM 响应 (结合规则提示增强)
        """
        rule_hints = rule_hints or {}
        logger.info(f"[BRollAgent] 开始解析 LLM 响应，原始内容长度: {len(content)}")
        
        # 提取 JSON
        json_content = content
        if "```json" in content:
            json_content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            json_content = content.split("```")[1].split("```")[0]
        
        logger.info(f"[BRollAgent] 提取 JSON 后长度: {len(json_content)}, 内容预览: {json_content[:300] if json_content else '(空)'}")
        
        try:
            data = json.loads(json_content.strip())
            decisions_data = data.get("decisions", [])
            logger.info(f"[BRollAgent] JSON 解析成功，获得 {len(decisions_data)} 个 decisions")
        except json.JSONDecodeError as e:
            logger.warning(f"[BRollAgent] JSON 解析失败: {e}")
            logger.warning(f"[BRollAgent] 原始内容: {content[:500] if content else '(空)'}")
            decisions_data = []
        
        # 转换为 Pydantic 模型
        decisions = []
        segment_ids = {seg.get("id", f"seg-{i}"): seg for i, seg in enumerate(original_segments)}
        
        for item in decisions_data:
            seg_id = item.get("segment_id", "")
            
            # 计算片段时长
            seg = segment_ids.get(seg_id, {})
            seg_duration = seg.get("end", 0) - seg.get("start", 0) if seg else 0
            
            # 建议的 B-Roll 时长（不超过片段时长的 80%）
            suggested_duration = min(
                item.get("suggested_duration_ms", 3000),
                int(seg_duration * 0.8) if seg_duration > 0 else 3000
            )
            
            broll_type_str = item.get("broll_type", "none").lower()
            broll_type = BRollType.VIDEO if broll_type_str == "video" else (
                BRollType.IMAGE if broll_type_str == "image" else BRollType.NONE
            )
            
            decision = SegmentBRollDecision(
                segment_id=seg_id,
                need_broll=item.get("need_broll", False),
                broll_type=broll_type,
                reason=item.get("reason", ""),
                confidence=item.get("confidence", 0.8),
                suggested_duration_ms=suggested_duration,
                start_offset_ms=0,  # 默认从片段开始
                keywords_en=item.get("keywords_en", []),
                keywords_cn=item.get("keywords_cn", []),
                scene_description=item.get("scene_description", ""),
            )
            decisions.append(decision)
        
        # 补充缺失的片段（LLM 可能遗漏）- 🆕 使用规则引擎结果补充
        returned_ids = {d.segment_id for d in decisions}
        for i, seg in enumerate(original_segments):
            seg_id = seg.get("id", f"seg-{i}")
            if seg_id not in returned_ids:
                # 检查规则引擎是否检测到该片段需要 B-Roll
                hint = rule_hints.get(seg_id, {})
                if hint.get("need_broll"):
                    # 使用规则引擎结果补充
                    decisions.append(SegmentBRollDecision(
                        segment_id=seg_id,
                        need_broll=True,
                        broll_type=hint.get("suggested_broll_type", BRollType.VIDEO),
                        reason=f"规则补充: {hint.get('trigger_type_name', '')}",
                        confidence=0.85,
                        suggested_duration_ms=3000,
                        keywords_cn=[hint.get("trigger_text", "")] if hint.get("trigger_text") else [],
                        scene_description=hint.get("suggested_broll", ""),
                    ))
                else:
                    decisions.append(SegmentBRollDecision(
                        segment_id=seg_id,
                        need_broll=False,
                        broll_type=BRollType.NONE,
                        reason="默认不添加",
                    ))
        
        # 按原始顺序排序
        id_order = {seg.get("id", f"seg-{i}"): i for i, seg in enumerate(original_segments)}
        decisions.sort(key=lambda d: id_order.get(d.segment_id, 999))
        
        return decisions
    
    async def _search_assets(
        self,
        keywords: List[str],
        broll_type: BRollType,
        duration_hint_ms: int = 3000,
        limit: int = 3,
    ) -> List[Dict[str, Any]]:
        """
        搜索 B-Roll 素材
        
        搜索策略:
        - 使用 LLM 提供的关键词组合成一个查询字符串
        - 单次 API 调用获取结果
        - LLM 负责生成优质关键词，搜索层只负责执行
        """
        if not keywords:
            return []
        
        # 关键词组合：用空格连接，Pexels API 会自动处理
        # 例如: ["smartphone", "camera"] -> "smartphone camera"
        query = " ".join(keywords[:3])  # 最多取前3个关键词
        
        assets = []
        
        # 搜索 Pexels
        if self.pexels_api_key and broll_type == BRollType.VIDEO:
            try:
                pexels_results = await self._search_pexels(
                    query=query, 
                    limit=limit,
                    min_duration_sec=max(2, duration_hint_ms // 1000 - 1),
                )
                assets.extend(pexels_results)
            except Exception as e:
                logger.warning(f"[BRollAgent] Pexels 搜索 '{query}' 失败: {e}")
        
        # Pexels 不够时尝试 Pixabay 补充
        if len(assets) < limit and self.pixabay_api_key:
            try:
                pixabay_results = await self._search_pixabay(
                    query=query, 
                    media_type="video" if broll_type == BRollType.VIDEO else "photo",
                    limit=limit - len(assets)
                )
                assets.extend(pixabay_results)
            except Exception as e:
                logger.warning(f"[BRollAgent] Pixabay 搜索 '{query}' 失败: {e}")
        
        logger.info(f"[BRollAgent] 搜索完成: query='{query}', 找到 {len(assets)} 个素材")
        return assets[:limit]
    
    async def _search_pexels(
        self,
        query: str,
        limit: int = 3,
        min_duration_sec: int = 2,
    ) -> List[Dict[str, Any]]:
        """
        搜索 Pexels 视频
        
        Pexels Video Search API:
        - URL: GET https://api.pexels.com/videos/search
        - Headers: Authorization: {API_KEY}
        - Params: query (required), orientation, size, locale, page, per_page
        - Response: {page, per_page, total_results, url, videos: [Video...]}
        
        Video 对象:
        - id, width, height, url, image, duration (秒)
        - user: {id, name, url}
        - video_files: [{id, quality, file_type, width, height, fps, link}, ...]
        - video_pictures: [{id, picture, nr}, ...]
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.pexels.com/videos/search",
                params={
                    "query": query,
                    "per_page": min(limit * 2, 10),  # 请求数量：limit*2 用于过滤，最多10条
                    "orientation": "landscape",      # landscape | portrait | square
                    "size": "medium",                # large(4K) | medium(FullHD) | small(HD)
                },
                headers={"Authorization": self.pexels_api_key},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            
            results = []
            for video in data.get("videos", []):
                duration_sec = video.get("duration", 0)  # Pexels 返回的是秒
                
                # 过滤太短的视频
                if duration_sec < min_duration_sec:
                    continue
                
                # 选择最佳质量的视频文件 (优先 HD 1280+)
                video_files = video.get("video_files", [])
                best_file = None
                
                # 按宽度降序排列，选择 HD 质量的文件
                for f in sorted(video_files, key=lambda x: x.get("width", 0) or 0, reverse=True):
                    quality = f.get("quality", "")
                    width = f.get("width") or 0
                    # 优先选 hd 且宽度 >= 1280 的
                    if quality == "hd" and width >= 1280:
                        best_file = f
                        break
                
                # 如果没找到合适的 HD，取最大宽度的（排除 hls）
                if not best_file:
                    for f in sorted(video_files, key=lambda x: x.get("width", 0) or 0, reverse=True):
                        if f.get("quality") != "hls":  # hls 没有 width/height
                            best_file = f
                            break
                
                if not best_file:
                    continue
                
                results.append({
                    "id": f"pexels-{video['id']}",
                    "source": "pexels",
                    "pexels_url": video.get("url", ""),  # Pexels 页面链接（用于归属）
                    "thumbnail_url": video.get("image", ""),
                    "video_url": best_file.get("link", ""),
                    "width": best_file.get("width") or 1920,
                    "height": best_file.get("height") or 1080,
                    "duration_ms": duration_sec * 1000,
                    "quality": best_file.get("quality", "hd"),
                    "file_type": best_file.get("file_type", "video/mp4"),
                    "fps": best_file.get("fps"),
                    "author": video.get("user", {}).get("name", ""),
                    "author_url": video.get("user", {}).get("url", ""),
                    "query": query,  # 记录搜索词，便于调试
                })
                
                if len(results) >= limit:
                    break
            
            return results
    
    async def _search_pixabay(
        self,
        query: str,
        media_type: str = "video",
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """搜索 Pixabay 视频/图片"""
        endpoint = "https://pixabay.com/api/videos/" if media_type == "video" else "https://pixabay.com/api/"
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                endpoint,
                params={
                    "key": self.pixabay_api_key,
                    "q": query,
                    "per_page": limit,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            
            results = []
            items = data.get("hits", [])
            
            for item in items:
                if media_type == "video":
                    videos = item.get("videos", {})
                    large = videos.get("large", {})
                    results.append({
                        "id": f"pixabay-{item['id']}",
                        "source": "pixabay",
                        "thumbnail_url": item.get("picture_id", ""),
                        "video_url": large.get("url", ""),
                        "width": large.get("width", 1920),
                        "height": large.get("height", 1080),
                        "duration_ms": (item.get("duration", 0) * 1000),
                        "author": item.get("user", ""),
                        "relevance_score": 0.8,
                    })
                else:
                    results.append({
                        "id": f"pixabay-{item['id']}",
                        "source": "pixabay",
                        "thumbnail_url": item.get("previewURL", ""),
                        "image_url": item.get("largeImageURL", ""),
                        "width": item.get("imageWidth", 1920),
                        "height": item.get("imageHeight", 1080),
                        "author": item.get("user", ""),
                        "relevance_score": 0.8,
                    })
            
            return results


# ============================================
# 便捷函数
# ============================================

async def analyze_broll_for_session(
    session_id: str,
    segments: List[Dict[str, Any]],
    video_style: str = "口播",
    total_duration_ms: int = 0,
) -> BRollAnalysisResult:
    """
    为会话分析 B-Roll 需求
    
    快捷调用入口
    """
    agent = BRollAgent()
    return await agent.analyze(
        session_id=session_id,
        segments=segments,
        video_style=video_style,
        total_duration_ms=total_duration_ms,
        search_assets=True,
    )
