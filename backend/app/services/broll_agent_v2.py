"""
B-Roll 智能推荐 Agent V2

基于规则引擎，为视频片段智能推荐 B-Roll 素材

设计原则:
- 规则引擎为核心 (快速、精准、可解释)
- LLM 仅用于关键词翻译 (中→英)
- 简化流程，去除冗余

核心功能:
1. 规则检测 - 6 种触发类型，30+ 正则规则，362x 缓存加速
2. 关键词翻译 - 中文关键词转英文搜索词
3. 素材搜索 - Pexels/Pixabay API
"""

import os
import json
import httpx
import logging
import re
from typing import List, Dict, Any, Optional
from enum import Enum
from pydantic import BaseModel, Field

from app.services.remotion_agent.broll_trigger import (
    detect_broll_triggers,
    detect_primary_trigger,
    BrollTrigger,
    BrollTriggerType,
)

logger = logging.getLogger(__name__)


# ============================================
# 数据模型
# ============================================

class BRollType(str, Enum):
    """B-Roll 类型"""
    VIDEO = "video"
    IMAGE = "image"
    NONE = "none"


class SegmentBRollDecision(BaseModel):
    """单个片段的 B-Roll 决策"""
    segment_id: str = Field(description="片段ID")
    need_broll: bool = Field(description="是否需要 B-Roll")
    broll_type: BRollType = Field(default=BRollType.NONE, description="B-Roll 类型")
    trigger_type: Optional[str] = Field(None, description="触发类型")
    reason: str = Field(default="", description="决策原因")
    confidence: float = Field(default=0.8, description="置信度 0-1")
    
    # B-Roll 规格
    suggested_duration_ms: int = Field(default=0, description="建议 B-Roll 时长(毫秒)")
    
    # 搜索关键词
    keywords_en: List[str] = Field(default_factory=list, description="英文搜索关键词")
    keywords_cn: List[str] = Field(default_factory=list, description="中文关键词")
    
    # 场景描述
    scene_description: str = Field(default="", description="场景描述")
    
    # 匹配的素材
    matched_assets: List[Dict[str, Any]] = Field(default_factory=list, description="匹配到的素材")


class BRollAnalysisResult(BaseModel):
    """B-Roll 分析结果"""
    session_id: str = Field(description="会话ID")
    total_segments: int = Field(description="总片段数")
    broll_segments: int = Field(description="需要 B-Roll 的片段数")
    decisions: List[SegmentBRollDecision] = Field(description="每个片段的决策")
    
    total_broll_duration_ms: int = Field(default=0, description="B-Roll 总时长")
    video_broll_count: int = Field(default=0, description="视频 B-Roll 数量")
    image_broll_count: int = Field(default=0, description="图片 B-Roll 数量")


# ============================================
# 触发类型 → B-Roll 类型映射
# ============================================

TRIGGER_TO_BROLL_TYPE: Dict[BrollTriggerType, BRollType] = {
    BrollTriggerType.DATA_CITE: BRollType.IMAGE,       # 数据 → 图表/信息图
    BrollTriggerType.EXAMPLE_MENTION: BRollType.VIDEO, # 示例 → 演示视频
    BrollTriggerType.COMPARISON: BRollType.IMAGE,      # 对比 → 对比图
    BrollTriggerType.PRODUCT_MENTION: BRollType.VIDEO, # 产品 → 产品视频
    BrollTriggerType.PROCESS_DESC: BRollType.VIDEO,    # 流程 → 操作视频
    BrollTriggerType.CONCEPT_VISUAL: BRollType.VIDEO,  # 概念 → 动画/视频
}

TRIGGER_TYPE_NAMES: Dict[BrollTriggerType, str] = {
    BrollTriggerType.DATA_CITE: "数据引用",
    BrollTriggerType.EXAMPLE_MENTION: "示例提及",
    BrollTriggerType.COMPARISON: "对比说明",
    BrollTriggerType.PRODUCT_MENTION: "产品提及",
    BrollTriggerType.PROCESS_DESC: "流程描述",
    BrollTriggerType.CONCEPT_VISUAL: "概念可视化",
}

# 置信度映射
IMPORTANCE_TO_CONFIDENCE: Dict[str, float] = {
    "high": 0.95,
    "medium": 0.8,
    "low": 0.6,
}


# ============================================
# 简单的中英文关键词映射 (常用词)
# ============================================

KEYWORD_TRANSLATION_MAP: Dict[str, str] = {
    # 科技
    "人工智能": "artificial intelligence",
    "AI": "AI technology",
    "机器学习": "machine learning",
    "深度学习": "deep learning",
    "数据": "data analytics",
    "代码": "coding programming",
    "编程": "programming",
    "软件": "software",
    "算法": "algorithm",
    "模型": "AI model",
    "智能": "intelligence",
    
    # 商业
    "增长": "growth chart",
    "提升": "improvement",
    "效率": "efficiency productivity",
    "成本": "cost money",
    "利润": "profit",
    "市场": "market business",
    "用户": "users customers",
    "产品": "product",
    "服务": "service",
    
    # 动作
    "步骤": "step process",
    "流程": "workflow process",
    "方法": "method",
    "技巧": "tips tricks",
    "教程": "tutorial",
    "演示": "demonstration",
    
    # 通用
    "比较": "comparison",
    "对比": "versus comparison",
    "例如": "example",
    "比如": "example",
}


# ============================================
# B-Roll Agent V2
# ============================================

class BRollAgentV2:
    """
    B-Roll 智能推荐 Agent V2
    
    核心流程:
    1. 规则引擎检测触发点
    2. 提取/翻译关键词
    3. 搜索素材
    """
    
    def __init__(
        self,
        pexels_api_key: Optional[str] = None,
        pixabay_api_key: Optional[str] = None,
    ):
        self.pexels_api_key = pexels_api_key or os.getenv("PEXELS_API_KEY", "")
        self.pixabay_api_key = pixabay_api_key or os.getenv("PIXABAY_API_KEY", "")
    
    async def analyze(
        self,
        session_id: str,
        segments: List[Dict[str, Any]],
        video_style: str = "口播",
        total_duration_ms: int = 0,
        search_assets: bool = True,
    ) -> BRollAnalysisResult:
        """
        B-Roll 分析主流程
        
        Args:
            session_id: 会话ID
            segments: 片段列表 [{id, text, start, end}, ...]
            video_style: 视频风格 (保留参数，暂未使用)
            total_duration_ms: 总时长 (保留参数)
            search_assets: 是否搜索素材
        """
        logger.info(f"[BRollAgentV2] 开始分析 {len(segments)} 个片段")
        
        # Step 1: 规则引擎检测
        decisions = self._analyze_with_rules(segments)
        
        broll_count = sum(1 for d in decisions if d.need_broll)
        logger.info(f"[BRollAgentV2] 规则检测完成: {broll_count}/{len(segments)} 片段需要 B-Roll")
        
        # Step 2: 搜索素材
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
        broll_decisions = [d for d in decisions if d.need_broll]
        total_broll_duration = sum(d.suggested_duration_ms for d in broll_decisions)
        video_count = sum(1 for d in broll_decisions if d.broll_type == BRollType.VIDEO)
        image_count = sum(1 for d in broll_decisions if d.broll_type == BRollType.IMAGE)
        
        result = BRollAnalysisResult(
            session_id=session_id,
            total_segments=len(segments),
            broll_segments=len(broll_decisions),
            decisions=decisions,
            total_broll_duration_ms=total_broll_duration,
            video_broll_count=video_count,
            image_broll_count=image_count,
        )
        
        logger.info(f"[BRollAgentV2] ✅ 分析完成: {len(broll_decisions)}/{len(segments)} 片段需要 B-Roll")
        return result
    
    def _analyze_with_rules(
        self,
        segments: List[Dict[str, Any]],
    ) -> List[SegmentBRollDecision]:
        """
        使用规则引擎分析所有片段
        """
        decisions = []
        
        for i, seg in enumerate(segments):
            seg_id = seg.get("id", f"seg-{i}")
            text = seg.get("text", "")
            start_ms = seg.get("start", 0)
            end_ms = seg.get("end", 0)
            duration_ms = end_ms - start_ms
            
            if not text:
                decisions.append(SegmentBRollDecision(
                    segment_id=seg_id,
                    need_broll=False,
                    broll_type=BRollType.NONE,
                    reason="无文本内容",
                ))
                continue
            
            # 规则引擎检测
            triggers = detect_broll_triggers(text)
            
            if triggers:
                # 取主要触发点
                primary = triggers[0]
                
                # 确定 B-Roll 类型
                broll_type = TRIGGER_TO_BROLL_TYPE.get(primary.trigger_type, BRollType.VIDEO)
                
                # 提取关键词
                keywords_cn, keywords_en = self._extract_keywords(text, primary)
                
                # 计算建议时长 (片段时长的 50-70%)
                suggested_duration = min(
                    int(duration_ms * 0.6),
                    5000,  # 最长 5 秒
                )
                suggested_duration = max(suggested_duration, 2000)  # 最短 2 秒
                
                decisions.append(SegmentBRollDecision(
                    segment_id=seg_id,
                    need_broll=True,
                    broll_type=broll_type,
                    trigger_type=primary.trigger_type.value,
                    reason=TRIGGER_TYPE_NAMES.get(primary.trigger_type, "触发检测"),
                    confidence=IMPORTANCE_TO_CONFIDENCE.get(primary.importance, 0.8),
                    suggested_duration_ms=suggested_duration,
                    keywords_cn=keywords_cn,
                    keywords_en=keywords_en,
                    scene_description=primary.suggested_broll or "",
                ))
            else:
                decisions.append(SegmentBRollDecision(
                    segment_id=seg_id,
                    need_broll=False,
                    broll_type=BRollType.NONE,
                    reason="未检测到触发点",
                ))
        
        return decisions
    
    def _extract_keywords(
        self,
        text: str,
        trigger: BrollTrigger,
    ) -> tuple[List[str], List[str]]:
        """
        从文本和触发点提取关键词
        
        Returns:
            (keywords_cn, keywords_en)
        """
        keywords_cn = []
        keywords_en = []
        
        # 1. 使用触发文本
        matched_text = trigger.matched_text.strip()
        if matched_text:
            keywords_cn.append(matched_text)
        
        # 2. 从建议中提取
        if trigger.suggested_broll:
            keywords_cn.append(trigger.suggested_broll)
        
        # 3. 提取英文/品牌词 (保持原样)
        english_words = re.findall(r'[A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*)?', text)
        for word in english_words:
            if len(word) >= 2 and word.lower() not in ('the', 'is', 'are', 'of', 'to', 'and', 'or', 'it', 'in', 'on'):
                keywords_en.append(word.lower())
        
        # 4. 翻译中文关键词
        for kw_cn in keywords_cn:
            # 尝试直接映射
            for cn, en in KEYWORD_TRANSLATION_MAP.items():
                if cn in kw_cn:
                    keywords_en.append(en)
                    break
        
        # 5. 基于触发类型添加通用关键词
        type_keywords = {
            BrollTriggerType.DATA_CITE: ["data", "chart", "statistics"],
            BrollTriggerType.EXAMPLE_MENTION: ["example", "demonstration"],
            BrollTriggerType.COMPARISON: ["comparison", "versus"],
            BrollTriggerType.PRODUCT_MENTION: ["product", "technology"],
            BrollTriggerType.PROCESS_DESC: ["process", "workflow", "step"],
            BrollTriggerType.CONCEPT_VISUAL: ["concept", "visualization"],
        }
        keywords_en.extend(type_keywords.get(trigger.trigger_type, []))
        
        # 去重并限制数量
        keywords_cn = list(dict.fromkeys(keywords_cn))[:3]
        keywords_en = list(dict.fromkeys(keywords_en))[:5]
        
        return keywords_cn, keywords_en
    
    async def _search_assets(
        self,
        keywords: List[str],
        broll_type: BRollType,
        duration_hint_ms: int = 3000,
        limit: int = 3,
    ) -> List[Dict[str, Any]]:
        """
        搜索 B-Roll 素材
        """
        if not keywords:
            return []
        
        query = " ".join(keywords[:3])
        assets = []
        
        # 搜索 Pexels
        if self.pexels_api_key:
            try:
                if broll_type == BRollType.VIDEO:
                    results = await self._search_pexels_video(query, limit)
                else:
                    results = await self._search_pexels_photo(query, limit)
                assets.extend(results)
            except Exception as e:
                logger.warning(f"[BRollAgentV2] Pexels 搜索失败: {e}")
        
        # Pixabay 补充
        if len(assets) < limit and self.pixabay_api_key:
            try:
                results = await self._search_pixabay(
                    query,
                    "video" if broll_type == BRollType.VIDEO else "photo",
                    limit - len(assets)
                )
                assets.extend(results)
            except Exception as e:
                logger.warning(f"[BRollAgentV2] Pixabay 搜索失败: {e}")
        
        logger.info(f"[BRollAgentV2] 搜索 '{query}': 找到 {len(assets)} 个素材")
        return assets[:limit]
    
    async def _search_pexels_video(
        self,
        query: str,
        limit: int = 3,
    ) -> List[Dict[str, Any]]:
        """搜索 Pexels 视频"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.pexels.com/videos/search",
                params={
                    "query": query,
                    "per_page": min(limit * 2, 10),
                    "orientation": "landscape",
                    "size": "medium",
                },
                headers={"Authorization": self.pexels_api_key},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            
            results = []
            for video in data.get("videos", []):
                duration_sec = video.get("duration", 0)
                if duration_sec < 2:
                    continue
                
                # 选择最佳视频文件
                video_files = video.get("video_files", [])
                best_file = None
                for f in sorted(video_files, key=lambda x: x.get("width", 0) or 0, reverse=True):
                    if f.get("quality") == "hd" and (f.get("width") or 0) >= 1280:
                        best_file = f
                        break
                if not best_file and video_files:
                    best_file = video_files[0]
                
                if best_file:
                    results.append({
                        "id": f"pexels-{video['id']}",
                        "source": "pexels",
                        "thumbnail_url": video.get("image", ""),
                        "video_url": best_file.get("link", ""),
                        "duration_ms": duration_sec * 1000,
                        "width": best_file.get("width") or video.get("width", 1920),
                        "height": best_file.get("height") or video.get("height", 1080),
                        "relevance_score": 0.9,
                    })
                
                if len(results) >= limit:
                    break
            
            return results
    
    async def _search_pexels_photo(
        self,
        query: str,
        limit: int = 3,
    ) -> List[Dict[str, Any]]:
        """搜索 Pexels 图片"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.pexels.com/v1/search",
                params={
                    "query": query,
                    "per_page": limit,
                    "orientation": "landscape",
                },
                headers={"Authorization": self.pexels_api_key},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            
            results = []
            for photo in data.get("photos", []):
                results.append({
                    "id": f"pexels-{photo['id']}",
                    "source": "pexels",
                    "thumbnail_url": photo.get("src", {}).get("medium", ""),
                    "image_url": photo.get("src", {}).get("large2x", ""),
                    "video_url": "",
                    "width": photo.get("width", 1920),
                    "height": photo.get("height", 1080),
                    "relevance_score": 0.85,
                })
            
            return results
    
    async def _search_pixabay(
        self,
        query: str,
        media_type: str = "video",
        limit: int = 3,
    ) -> List[Dict[str, Any]]:
        """搜索 Pixabay"""
        async with httpx.AsyncClient() as client:
            endpoint = "https://pixabay.com/api/videos/" if media_type == "video" else "https://pixabay.com/api/"
            response = await client.get(
                endpoint,
                params={
                    "key": self.pixabay_api_key,
                    "q": query,
                    "per_page": limit,
                    "safesearch": "true",
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            
            results = []
            for item in data.get("hits", []):
                if media_type == "video":
                    videos = item.get("videos", {})
                    large = videos.get("large", {}) or videos.get("medium", {})
                    results.append({
                        "id": f"pixabay-{item['id']}",
                        "source": "pixabay",
                        "thumbnail_url": item.get("picture_id", ""),
                        "video_url": large.get("url", ""),
                        "duration_ms": item.get("duration", 0) * 1000,
                        "width": large.get("width", 1920),
                        "height": large.get("height", 1080),
                        "relevance_score": 0.8,
                    })
                else:
                    results.append({
                        "id": f"pixabay-{item['id']}",
                        "source": "pixabay",
                        "thumbnail_url": item.get("previewURL", ""),
                        "image_url": item.get("largeImageURL", ""),
                        "video_url": "",
                        "width": item.get("imageWidth", 1920),
                        "height": item.get("imageHeight", 1080),
                        "relevance_score": 0.75,
                    })
            
            return results


# ============================================
# 兼容性别名 (替换旧的 BRollAgent)
# ============================================

BRollAgent = BRollAgentV2
