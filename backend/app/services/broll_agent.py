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

class BRollAgent:
    """
    B-Roll 智能推荐 Agent
    
    工作流程:
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
        
        # Step 1: LLM 分析
        decisions = await self._analyze_with_llm(
            segments=segments,
            video_style=video_style,
            total_duration_ms=total_duration_ms,
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
    ) -> List[SegmentBRollDecision]:
        """
        使用 LLM 分析片段
        """
        if not segments:
            return []
        
        # 准备输入数据
        segments_for_llm = []
        for seg in segments:
            segments_for_llm.append({
                "id": seg.get("id", ""),
                "text": seg.get("text", ""),
                "start_ms": seg.get("start", 0),
                "end_ms": seg.get("end", 0),
                "duration_ms": seg.get("end", 0) - seg.get("start", 0),
            })
        
        total_duration_sec = total_duration_ms / 1000 if total_duration_ms else sum(s["duration_ms"] for s in segments_for_llm) / 1000
        
        # 调用 LLM
        try:
            chain = BROLL_ANALYSIS_PROMPT | self.llm
            response = await chain.ainvoke({
                "segments_json": json.dumps(segments_for_llm, ensure_ascii=False, indent=2),
                "video_style": video_style,
                "total_duration_sec": f"{total_duration_sec:.1f}",
            })
            
            # 解析响应
            content = response.content if hasattr(response, 'content') else str(response)
            decisions = self._parse_llm_response(content, segments)
            return decisions
            
        except Exception as e:
            logger.error(f"[BRollAgent] LLM 分析失败: {e}")
            # 返回默认决策（不添加 B-Roll）
            return [
                SegmentBRollDecision(
                    segment_id=seg.get("id", f"seg-{i}"),
                    need_broll=False,
                    broll_type=BRollType.NONE,
                    reason="分析失败，使用默认设置",
                )
                for i, seg in enumerate(segments)
            ]
    
    def _parse_llm_response(
        self,
        content: str,
        original_segments: List[Dict],
    ) -> List[SegmentBRollDecision]:
        """
        解析 LLM 响应
        """
        # 提取 JSON
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        try:
            data = json.loads(content.strip())
            decisions_data = data.get("decisions", [])
        except json.JSONDecodeError as e:
            logger.warning(f"[BRollAgent] JSON 解析失败: {e}")
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
        
        # 补充缺失的片段（LLM 可能遗漏）
        returned_ids = {d.segment_id for d in decisions}
        for i, seg in enumerate(original_segments):
            seg_id = seg.get("id", f"seg-{i}")
            if seg_id not in returned_ids:
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
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        搜索 B-Roll 素材
        
        搜索策略:
        1. 先用第一个关键词搜索（最精准）
        2. 如果结果不足，用组合关键词搜索
        3. 如果还不足，用第二个关键词单独搜索
        4. 按相关度排序返回
        """
        assets = []
        seen_ids = set()  # 去重
        
        if not keywords:
            return assets
        
        # 搜索策略：多轮搜索
        search_queries = []
        
        # 第一轮：第一个关键词（最精准）
        if keywords:
            search_queries.append(keywords[0])
        
        # 第二轮：前两个关键词组合
        if len(keywords) >= 2:
            search_queries.append(f"{keywords[0]} {keywords[1]}")
        
        # 第三轮：第二个关键词单独
        if len(keywords) >= 2:
            search_queries.append(keywords[1])
        
        for query in search_queries:
            if len(assets) >= limit:
                break
                
            # 尝试 Pexels
            if self.pexels_api_key and broll_type == BRollType.VIDEO:
                try:
                    pexels_results = await self._search_pexels(
                        query, 
                        limit=limit - len(assets),
                        min_duration_sec=max(2, duration_hint_ms // 1000 - 1),  # 至少比建议时长少1秒
                    )
                    for r in pexels_results:
                        if r["id"] not in seen_ids:
                            seen_ids.add(r["id"])
                            assets.append(r)
                except Exception as e:
                    logger.warning(f"[BRollAgent] Pexels 搜索 '{query}' 失败: {e}")
            
            # 如果结果不足，尝试 Pixabay
            if len(assets) < limit and self.pixabay_api_key:
                try:
                    pixabay_results = await self._search_pixabay(
                        query, 
                        media_type="video" if broll_type == BRollType.VIDEO else "photo",
                        limit=limit - len(assets)
                    )
                    for r in pixabay_results:
                        if r["id"] not in seen_ids:
                            seen_ids.add(r["id"])
                            assets.append(r)
                except Exception as e:
                    logger.warning(f"[BRollAgent] Pixabay 搜索 '{query}' 失败: {e}")
        
        # 按相关度排序
        assets.sort(key=lambda x: x.get("relevance_score", 0), reverse=True)
        
        logger.info(f"[BRollAgent] 搜索完成: keywords={keywords}, 找到 {len(assets)} 个素材")
        return assets[:limit]
    
    async def _search_pexels(
        self,
        query: str,
        limit: int = 5,
        min_duration_sec: int = 2,
    ) -> List[Dict[str, Any]]:
        """
        搜索 Pexels 视频
        
        Args:
            query: 搜索关键词
            limit: 返回数量
            min_duration_sec: 最小时长(秒)
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.pexels.com/videos/search",
                params={
                    "query": query,
                    "per_page": min(limit * 2, 20),  # 多拉一些用于过滤
                    "orientation": "landscape",
                    "size": "medium",  # medium = Full HD
                },
                headers={"Authorization": self.pexels_api_key},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            
            results = []
            for video in data.get("videos", []):
                duration_sec = video.get("duration", 0)
                
                # 过滤太短的视频
                if duration_sec < min_duration_sec:
                    continue
                
                # 选择最佳质量的视频文件 (优先 HD 1280+)
                video_files = video.get("video_files", [])
                best_file = None
                for f in sorted(video_files, key=lambda x: x.get("width", 0), reverse=True):
                    if f.get("quality") == "hd" and f.get("width", 0) >= 1280:
                        best_file = f
                        break
                if not best_file and video_files:
                    best_file = max(video_files, key=lambda x: x.get("width", 0))
                
                if not best_file:
                    continue
                
                # 计算相关度评分
                relevance = 0.9  # Pexels 基础分
                # 时长适中的加分
                if 3 <= duration_sec <= 10:
                    relevance += 0.05
                # 高清加分
                if best_file.get("width", 0) >= 1920:
                    relevance += 0.03
                
                results.append({
                    "id": f"pexels-{video['id']}",
                    "source": "pexels",
                    "thumbnail_url": video.get("image", ""),
                    "video_url": best_file.get("link", ""),
                    "width": best_file.get("width", 1920),
                    "height": best_file.get("height", 1080),
                    "duration_ms": duration_sec * 1000,
                    "author": video.get("user", {}).get("name", ""),
                    "relevance_score": round(relevance, 2),
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
