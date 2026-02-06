"""
B-Roll Remotion 配置生成器 V2

★★★ 两阶段层次化生成方案 ★★★

解决问题：长视频（90秒以上）单次 LLM 调用超时（180秒）

方案：
1. Stage 1 - 全局理解：快速生成大纲（章节结构 + 主题 + 情绪）
2. Stage 2 - 分段细化：基于大纲并行处理各段，保证上下文连贯

优势：
- 避免超时：单次调用处理 20-30 秒片段
- 保证连贯：大纲提供全局上下文
- 提高质量：每段独立优化，更精细
"""

import asyncio
import json
import logging
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from enum import Enum

from app.services.llm.clients import get_remotion_llm, get_outline_llm
from langchain_core.prompts import ChatPromptTemplate

logger = logging.getLogger(__name__)


# ============================================
# Stage 1: 全局大纲模型
# ============================================

class SegmentOutline(BaseModel):
    """单个段落大纲"""
    segment_id: str = Field(description="段落ID")
    start_ms: int = Field(description="开始时间(毫秒)")
    end_ms: int = Field(description="结束时间(毫秒)")
    title: str = Field(description="段落标题/主题")
    keywords: List[str] = Field(description="关键词（用于后续 B-Roll 搜索）")
    emotion: str = Field(description="情绪基调：excited/calm/serious/humorous/inspiring")
    suggested_broll: bool = Field(description="是否建议插入 B-Roll")
    broll_hint: Optional[str] = Field(default=None, description="B-Roll 内容提示")


class VideoOutline(BaseModel):
    """视频全局大纲"""
    theme: str = Field(description="视频整体主题风格")
    color_palette: List[str] = Field(default_factory=lambda: ["#1a1a1a", "#ffffff", "#3b82f6"])
    total_duration_ms: int = Field(description="总时长")
    segments: List[SegmentOutline] = Field(description="段落大纲列表")
    summary: str = Field(description="视频内容一句话总结")


# ============================================
# Stage 1: 大纲生成 Prompt
# ============================================

OUTLINE_SYSTEM_PROMPT = """你是一个视频内容分析专家。快速分析口播视频文本，生成结构化大纲。

## 任务
分析视频文本，将其划分为 3-6 个语义段落，为后续精细化处理提供指导。

## 输出要求
1. 每个段落约 15-30 秒（可根据语义自然断点调整）
2. 识别每个段落的主题、关键词、情绪
3. 标记需要 B-Roll 的段落（通常是讲产品、数据、案例的部分）

## 段落划分原则
- 按语义自然断点划分，不要机械切分
- 开场引入：通常 0-10 秒
- 核心内容：分 2-4 个段落
- 总结收尾：通常最后 10-15 秒

## 情绪类型
- excited: 兴奋、激动
- calm: 平静、舒缓
- serious: 严肃、专业
- humorous: 幽默、轻松
- inspiring: 鼓舞、激励

## 输出 JSON 格式
```json
{{
  "theme": "tech",
  "color_palette": ["#1a1a1a", "#ffffff", "#3b82f6"],
  "total_duration_ms": 90000,
  "summary": "一句话总结视频核心内容",
  "segments": [
    {{
      "segment_id": "seg_1",
      "start_ms": 0,
      "end_ms": 12000,
      "title": "开场引入",
      "keywords": ["问题", "痛点"],
      "emotion": "serious",
      "suggested_broll": false,
      "broll_hint": null
    }},
    {{
      "segment_id": "seg_2", 
      "start_ms": 12000,
      "end_ms": 35000,
      "title": "产品介绍",
      "keywords": ["手机", "摄像头", "拍照"],
      "emotion": "excited",
      "suggested_broll": true,
      "broll_hint": "smartphone camera closeup"
    }}
  ]
}}
```"""

OUTLINE_USER_PROMPT = """分析以下视频，生成结构化大纲：

## 视频信息
- 总时长: {total_duration_ms} 毫秒 ({total_duration_sec} 秒)
- 片段数: {clip_count}

## 完整文本（带时间戳）
```
{full_text}
```

请输出纯净 JSON，不要添加注释。"""


# ============================================
# Stage 2: 分段配置 Prompt（★ 只生成 B-Roll，不生成文本）
# ============================================

SEGMENT_SYSTEM_PROMPT = """你是一个专业的视频编辑 AI，为视频的**特定段落**生成 B-Roll 素材配置。

## 你的任务
为指定的段落生成 1-2 个 B-Roll 配置。

★★★ 重要：每个段落都应该生成至少 1 个 B-Roll！★★★

## B-Roll 配置规范

```json
{{
  "id": "broll_1",
  "start_ms": 8000,
  "end_ms": 18000,
  "search_keywords": ["robot arm", "industrial automation", "factory"],
  "display_mode": "fullscreen",
  "transition_in": "fade"
}}
```

### search_keywords 要求（★★★ 极其重要）
- 必须使用英文关键词（Pexels 搜索用）
- 2-4 个关键词，第一个最重要
- 具体、可视化的名词：robot, smartphone, city skyline, office meeting
- 不要抽象概念：不要用 "technology", "innovation", "future"

### B-Roll 类型示例
- 讲 AI/机器人: robot arm, humanoid robot, AI chip, data center
- 讲科技产品: smartphone, laptop, VR headset, drone
- 讲医疗: surgery room, hospital, medical equipment, doctor
- 讲金融: stock market, trading floor, business meeting
- 讲自然: nature landscape, ocean waves, forest, mountain

## 输出要求
- ★ 每个段落必须生成 1-2 个 B-Roll
- 时间范围必须在段落内，不要越界
- B-Roll 时长应覆盖该概念的讲解时间（5-15 秒）"""

SEGMENT_USER_PROMPT = """## 全局上下文

### 视频大纲
{outline_summary}

### 前一段落摘要
{prev_segment_summary}

### 后一段落摘要  
{next_segment_summary}

---

## 当前段落详情

### 段落信息
- 段落: {segment_title}
- 时间范围: {segment_start_ms}ms - {segment_end_ms}ms
- 情绪: {segment_emotion}
- 关键词: {segment_keywords}
- B-Roll 提示: {broll_hint}

### 显示模式
- 目标宽高比: {target_aspect_ratio}
- B-Roll 默认模式: {default_display_mode}

### 段落文本
```
{segment_text}
```

---

★★★ 必须为这个段落生成 1-2 个 B-Roll ★★★

根据段落内容和关键词，选择合适的 B-Roll 素材。输出 JSON：
```json
{{
  "broll_components": [
    {{
      "id": "broll_1",
      "start_ms": {segment_start_ms},
      "end_ms": ...,
      "search_keywords": ["具体英文关键词"],
      "display_mode": "fullscreen",
      "transition_in": "fade"
    }}
  ]
}}
```

⚠️ 时间必须在 {segment_start_ms}-{segment_end_ms} 范围内！"""


# ============================================
# 导入原有模型（复用）
# ============================================

from app.services.remotion_generator import (
    RemotionTheme,
    TextAnimation,
    BRollDisplayMode,
    TransitionEffect,
    TextComponent,
    BRollComponent,
    ChapterComponent,
    RemotionConfig,
    _get_rag_retriever,
    _format_fewshot,
)


# ============================================
# V2 生成器
# ============================================

class RemotionConfigGeneratorV2:
    """两阶段层次化生成器（只生成 B-Roll 镜头，不生成文本）"""
    
    def __init__(self):
        self.llm = None
        self.outline_llm = None  # ★ 大纲用 flash 模型
        # 分段处理的最大片段数（约 20-30 秒）
        self.max_clips_per_segment = 8
    
    async def _get_llm(self):
        """懒加载 LLM（用于 B-Roll 配置生成）"""
        if self.llm is None:
            self.llm = get_remotion_llm()
        return self.llm
    
    async def _get_outline_llm(self):
        """懒加载大纲 LLM（用 flash 模型，速度快）"""
        if self.outline_llm is None:
            self.outline_llm = get_outline_llm()
        return self.outline_llm
    
    async def generate(
        self,
        clips: List[Dict[str, Any]],
        total_duration_ms: int,
        target_aspect_ratio: str = "16:9",
        default_display_mode: str = "fullscreen",
    ) -> RemotionConfig:
        """
        两阶段生成 Remotion 配置
        
        Stage 1: 生成全局大纲
        Stage 2: 分段并行生成详细配置
        """
        logger.info(f"[RemotionV2] ===== 两阶段生成开始 =====")
        logger.info(f"[RemotionV2] clips={len(clips)}, 时长={total_duration_ms}ms, 宽高比={target_aspect_ratio}")
        
        # 过滤可见 clips
        visible_clips = [
            c for c in clips 
            if not (c.get("metadata") or {}).get("hidden", False)
            and not (c.get("metadata") or {}).get("is_filler", False)
        ]
        
        if not visible_clips:
            logger.warning("[RemotionV2] 没有可见 clips")
            return self._empty_config(total_duration_ms)
        
        # ===== Stage 1: 生成大纲 =====
        logger.info(f"[RemotionV2] ----- Stage 1: 生成大纲 -----")
        outline = await self._generate_outline(visible_clips, total_duration_ms)
        
        if not outline or not outline.segments:
            logger.error("[RemotionV2] 大纲生成失败，使用降级方案")
            return self._fallback_config(visible_clips, total_duration_ms)
        
        logger.info(f"[RemotionV2] 大纲生成成功: {len(outline.segments)} 个段落")
        for seg in outline.segments:
            logger.info(f"  [{seg.segment_id}] {seg.start_ms}-{seg.end_ms}ms: {seg.title}, broll={seg.suggested_broll}")
        
        # ===== Stage 2: 分段并行生成 =====
        logger.info(f"[RemotionV2] ----- Stage 2: 分段生成 -----")
        segment_configs = await self._generate_segments_parallel(
            outline=outline,
            clips=visible_clips,
            target_aspect_ratio=target_aspect_ratio,
            default_display_mode=default_display_mode,
        )
        
        # ===== 合并所有段落配置 =====
        logger.info(f"[RemotionV2] ----- 合并配置 -----")
        final_config = self._merge_configs(
            outline=outline,
            segment_configs=segment_configs,
            total_duration_ms=total_duration_ms,
        )
        
        logger.info(f"[RemotionV2] ===== 生成完成 =====")
        logger.info(f"[RemotionV2] 最终结果: {final_config.text_count} 文字, {final_config.broll_count} B-Roll")
        
        return final_config
    
    async def _generate_outline(
        self,
        clips: List[Dict[str, Any]],
        total_duration_ms: int,
    ) -> Optional[VideoOutline]:
        """Stage 1: 生成全局大纲（使用 flash 模型，速度快）"""
        
        # 构建简化的文本（只要时间戳和内容）
        full_text = "\n".join([
            f"[{c.get('start_time', 0)//1000}s-{c.get('end_time', 0)//1000}s] {c.get('content_text', '') or c.get('text', '')}"
            for c in clips
        ])
        
        # ★★★ 大纲用 flash 模型 ★★★
        llm = await self._get_outline_llm()
        prompt = ChatPromptTemplate.from_messages([
            ("system", OUTLINE_SYSTEM_PROMPT),
            ("human", OUTLINE_USER_PROMPT),
        ])
        
        chain = prompt | llm
        
        try:
            result = await chain.ainvoke({
                "total_duration_ms": total_duration_ms,
                "total_duration_sec": round(total_duration_ms / 1000, 1),
                "clip_count": len(clips),
                "full_text": full_text,
            })
            
            content = result.content
            logger.info(f"[RemotionV2] 大纲 LLM 响应: {len(content)} 字符")
            
            # 解析 JSON
            json_str = self._extract_json(content)
            if not json_str:
                logger.error("[RemotionV2] 大纲 JSON 解析失败")
                return None
            
            data = json.loads(json_str)
            
            # 构建大纲对象
            segments = []
            for seg_data in data.get("segments", []):
                try:
                    segments.append(SegmentOutline(**seg_data))
                except Exception as e:
                    logger.warning(f"[RemotionV2] 跳过无效段落: {e}")
            
            if not segments:
                return None
            
            return VideoOutline(
                theme=data.get("theme", "dynamic"),
                color_palette=data.get("color_palette", ["#1a1a1a", "#ffffff", "#3b82f6"]),
                total_duration_ms=total_duration_ms,
                segments=segments,
                summary=data.get("summary", ""),
            )
            
        except Exception as e:
            logger.error(f"[RemotionV2] 大纲生成异常: {e}")
            return None
    
    async def _generate_segments_parallel(
        self,
        outline: VideoOutline,
        clips: List[Dict[str, Any]],
        target_aspect_ratio: str,
        default_display_mode: str,
    ) -> List[Dict[str, Any]]:
        """Stage 2: 并行生成各段落配置"""
        
        # 准备各段落的任务
        tasks = []
        for i, segment in enumerate(outline.segments):
            # 获取该段落的 clips
            segment_clips = self._get_clips_in_range(
                clips, segment.start_ms, segment.end_ms
            )
            
            # 前后段落摘要（用于上下文连贯）
            prev_summary = ""
            next_summary = ""
            if i > 0:
                prev_seg = outline.segments[i - 1]
                prev_summary = f"[{prev_seg.title}] {', '.join(prev_seg.keywords)}"
            if i < len(outline.segments) - 1:
                next_seg = outline.segments[i + 1]
                next_summary = f"[{next_seg.title}] {', '.join(next_seg.keywords)}"
            
            task = self._generate_segment_config(
                segment=segment,
                segment_clips=segment_clips,
                outline_summary=outline.summary,
                prev_segment_summary=prev_summary or "（这是第一段）",
                next_segment_summary=next_summary or "（这是最后一段）",
                target_aspect_ratio=target_aspect_ratio,
                default_display_mode=default_display_mode,
            )
            tasks.append(task)
        
        # 并行执行所有段落
        logger.info(f"[RemotionV2] 并行生成 {len(tasks)} 个段落...")
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 收集成功的结果
        segment_configs = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"[RemotionV2] 段落 {i+1} 生成失败: {result}")
                segment_configs.append({"text_components": [], "broll_components": []})
            else:
                segment_configs.append(result)
        
        return segment_configs
    
    async def _generate_segment_config(
        self,
        segment: SegmentOutline,
        segment_clips: List[Dict[str, Any]],
        outline_summary: str,
        prev_segment_summary: str,
        next_segment_summary: str,
        target_aspect_ratio: str,
        default_display_mode: str,
    ) -> Dict[str, Any]:
        """生成单个段落的配置"""
        
        # 构建段落文本
        segment_text = "\n".join([
            f"[{c.get('start_time', 0)//1000}s] {c.get('content_text', '') or c.get('text', '')}"
            for c in segment_clips
        ])
        
        # 构建 clips JSON
        clips_json = json.dumps([
            {
                "id": c.get("id"),
                "text": c.get("content_text", "") or c.get("text", ""),
                "start_ms": c.get("start_time", 0),
                "end_ms": c.get("end_time", 0),
            }
            for c in segment_clips
        ], ensure_ascii=False, indent=2)
        
        llm = await self._get_llm()
        prompt = ChatPromptTemplate.from_messages([
            ("system", SEGMENT_SYSTEM_PROMPT),
            ("human", SEGMENT_USER_PROMPT),
        ])
        
        chain = prompt | llm
        
        try:
            result = await chain.ainvoke({
                "outline_summary": outline_summary,
                "prev_segment_summary": prev_segment_summary,
                "next_segment_summary": next_segment_summary,
                "segment_title": segment.title,
                "segment_start_ms": segment.start_ms,
                "segment_end_ms": segment.end_ms,
                "segment_emotion": segment.emotion,
                "segment_keywords": ", ".join(segment.keywords),
                "broll_hint": segment.broll_hint or segment.title,  # ★ 用标题作为默认提示
                "target_aspect_ratio": target_aspect_ratio,
                "default_display_mode": default_display_mode,
                "segment_text": segment_text,
            })
            
            content = result.content
            logger.info(f"[RemotionV2] 段落 [{segment.segment_id}] 响应: {len(content)} 字符")
            logger.info(f"[RemotionV2] 段落 [{segment.segment_id}] 内容: {content[:200]}...")  # ★ 查看实际返回内容
            
            json_str = self._extract_json(content)
            if not json_str:
                logger.warning(f"[RemotionV2] 段落 [{segment.segment_id}] JSON 解析失败")
                return {"text_components": [], "broll_components": []}
            
            data = json.loads(json_str)
            return {
                "text_components": data.get("text_components", []),
                "broll_components": data.get("broll_components", []),
            }
            
        except Exception as e:
            logger.error(f"[RemotionV2] 段落 [{segment.segment_id}] 异常: {e}")
            return {"text_components": [], "broll_components": []}
    
    def _get_clips_in_range(
        self,
        clips: List[Dict[str, Any]],
        start_ms: int,
        end_ms: int,
    ) -> List[Dict[str, Any]]:
        """获取时间范围内的 clips"""
        result = []
        for c in clips:
            clip_start = c.get("start_time", 0)
            clip_end = c.get("end_time", 0)
            # clip 与段落有重叠就算入
            if clip_start < end_ms and clip_end > start_ms:
                result.append(c)
        return result
    
    def _merge_configs(
        self,
        outline: VideoOutline,
        segment_configs: List[Dict[str, Any]],
        total_duration_ms: int,
    ) -> RemotionConfig:
        """合并所有段落配置（★ 只合并 B-Roll，不要文本）"""
        
        all_broll_components = []
        all_chapter_components = []
        
        # 从大纲生成章节
        for i, seg in enumerate(outline.segments):
            # 只为主要段落生成章节标题（跳过太短的开头/结尾）
            if seg.end_ms - seg.start_ms >= 8000:  # 至少 8 秒
                chapter = ChapterComponent(
                    id=f"chapter_{i+1}",
                    start_ms=seg.start_ms,
                    end_ms=min(seg.start_ms + 3000, seg.end_ms),
                    title=seg.title,
                )
                all_chapter_components.append(chapter)
        
        # 合并各段落的 B-Roll 组件（★ 不合并 text_components）
        for i, config in enumerate(segment_configs):
            # B-Roll 组件
            for bc_data in config.get("broll_components", []):
                try:
                    bc = BRollComponent(**bc_data)
                    bc.id = f"broll_s{i+1}_{bc.id}"
                    all_broll_components.append(bc)
                except Exception as e:
                    logger.warning(f"[RemotionV2] 跳过无效 BRollComponent: {e}")
        
        # 解析 theme
        theme_str = outline.theme
        try:
            theme = RemotionTheme(theme_str)
        except ValueError:
            theme = RemotionTheme.DYNAMIC
            logger.warning(f"[RemotionV2] 无效 theme '{theme_str}'，使用 dynamic")
        
        return RemotionConfig(
            total_duration_ms=total_duration_ms,
            theme=theme,
            color_palette=outline.color_palette,
            text_components=[],  # ★ 不生成文本
            broll_components=all_broll_components,
            chapter_components=all_chapter_components,
            broll_count=len(all_broll_components),
            text_count=0,  # ★ 文本数量为 0
        )
    
    def _extract_json(self, content: str) -> Optional[str]:
        """从 LLM 响应中提取 JSON"""
        import re
        
        # 找 ```json ... ```
        match = re.search(r'```json\s*([\s\S]*?)\s*```', content)
        if match:
            json_str = match.group(1)
        else:
            # 找 { ... }
            match = re.search(r'\{[\s\S]*\}', content)
            if match:
                json_str = match.group(0)
            else:
                return None
        
        # 清理注释
        json_str = re.sub(r'//[^\n]*', '', json_str)
        json_str = re.sub(r'/\*[\s\S]*?\*/', '', json_str)
        json_str = re.sub(r',\s*([}\]])', r'\1', json_str)
        
        return json_str.strip()
    
    def _empty_config(self, total_duration_ms: int) -> RemotionConfig:
        """空配置"""
        return RemotionConfig(
            total_duration_ms=total_duration_ms,
            broll_count=0,
            text_count=0,
        )
    
    def _fallback_config(
        self,
        clips: List[Dict[str, Any]],
        total_duration_ms: int,
    ) -> RemotionConfig:
        """降级配置"""
        logger.info("[RemotionV2] 使用降级配置")
        
        chapter = ChapterComponent(
            id="chapter-1",
            start_ms=0,
            end_ms=3000,
            title="视频精彩内容",
        )
        
        return RemotionConfig(
            total_duration_ms=total_duration_ms,
            chapter_components=[chapter],
            broll_count=0,
            text_count=0,
        )


# ============================================
# 单例
# ============================================

_generator_v2: Optional[RemotionConfigGeneratorV2] = None

def get_remotion_generator_v2() -> RemotionConfigGeneratorV2:
    """获取 V2 生成器单例"""
    global _generator_v2
    if _generator_v2 is None:
        _generator_v2 = RemotionConfigGeneratorV2()
    return _generator_v2
