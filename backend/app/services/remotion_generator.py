"""
B-Roll Remotion 配置生成器

V2 版本：不再为每个 clip 单独搜索素材
而是分析完整文本，生成 Remotion 渲染配置

核心功能:
1. 分析完整视频文本，识别关键时刻
2. 生成文字动画配置（标题、高亮、数据展示）
3. 生成 B-Roll 插入点（搜索关键词，不是具体素材）
4. 生成过渡效果配置
5. 🆕 RAG 增强：从标杆视频检索相似案例作为 Few-shot 示例
"""

import json
import logging
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from enum import Enum

from app.services.llm.clients import get_remotion_llm
from langchain_core.prompts import ChatPromptTemplate

logger = logging.getLogger(__name__)

# 🆕 RAG 模块延迟导入标记
_rag_available = None


def _get_rag_retriever():
    """
    懒加载 RAG retriever，避免循环导入和启动时加载问题
    """
    global _rag_available
    
    if _rag_available is False:
        return None
    
    try:
        from app.services.remotion_agent.rag import get_retriever
        _rag_available = True
        return get_retriever()
    except Exception as e:
        logger.warning(f"[RemotionGen] RAG 模块加载失败: {e}")
        _rag_available = False
        return None


def _format_fewshot(examples: list) -> str:
    """格式化 few-shot 示例"""
    try:
        from app.services.remotion_agent.rag import format_fewshot_examples
        return format_fewshot_examples(examples)
    except Exception:
        return "暂无参考示例。"


def _detect_triggers(text: str) -> list:
    """检测 B-Roll 触发点"""
    try:
        from app.services.remotion_agent.broll_trigger import detect_broll_triggers
        return detect_broll_triggers(text)
    except Exception:
        return []


# ============================================
# Remotion 配置模型
# ============================================

class RemotionTheme(str, Enum):
    """视频主题风格"""
    MINIMALIST = "minimalist"    # 简约风
    DYNAMIC = "dynamic"          # 动感
    CINEMATIC = "cinematic"      # 电影感
    VLOG = "vlog"                # Vlog 风格
    TECH = "tech"                # 科技感
    VIBRANT = "vibrant"          # 活力风
    ELEGANT = "elegant"          # 优雅风
    MODERN = "modern"            # 现代风
    WARM = "warm"                # 温暖风
    COOL = "cool"                # 冷色调


class TextAnimation(str, Enum):
    """文字动画类型
    
    ★ 抖音/小红书风格双层字幕系统：
    - MAIN_SUBTITLE: 主字幕（大字、彩色+白描边、底部居中）
    - KEYWORD_HIGHLIGHT: 关键词高亮（小字、蓝色背景框、主字幕上方）
    """
    # ★★★ 核心类型（抖音风格）★★★
    MAIN_SUBTITLE = "main-subtitle"        # 主字幕：大字、彩色、白描边
    KEYWORD_HIGHLIGHT = "keyword-highlight"  # 关键词高亮：蓝色背景框
    
    # 其他动画类型（补充用）
    FADE_IN = "fade-in"
    SLIDE_UP = "slide-up"
    TYPEWRITER = "typewriter"
    HIGHLIGHT = "highlight"
    ZOOM_IN = "zoom-in"
    BOUNCE = "bounce"


class BRollDisplayMode(str, Enum):
    """
    B-Roll 显示模式 - 只有两种
    
    ★ 治本原则：B-Roll 要么全屏覆盖，要么占据部分位置，没有第三种
    """
    FULLSCREEN = "fullscreen"    # 全屏覆盖（B-Roll 占满屏幕，主视频可变 PiP）
    PIP = "pip"                  # 部分位置（B-Roll 作为小窗出现）


class TransitionEffect(str, Enum):
    """过渡效果"""
    FADE = "fade"
    SLIDE = "slide"
    ZOOM = "zoom"
    WIPE = "wipe"


class TextComponent(BaseModel):
    """文字动画组件"""
    id: str = Field(description="组件唯一ID")
    type: str = Field(default="text", description="组件类型")
    start_ms: int = Field(description="开始时间(毫秒)")
    end_ms: int = Field(description="结束时间(毫秒)")
    text: str = Field(description="显示文字")
    animation: TextAnimation = Field(default=TextAnimation.FADE_IN, description="动画类型")
    position: str = Field(default="center", description="位置: center/top/bottom/left/right")
    style: Dict[str, Any] = Field(default_factory=lambda: {
        "fontSize": 48,
        "color": "#FFFFFF",
        "fontWeight": "bold",
    })


class BRollComponent(BaseModel):
    """B-Roll 视频组件"""
    id: str = Field(description="组件唯一ID")
    type: str = Field(default="broll", description="组件类型")
    start_ms: int = Field(description="开始时间(毫秒)")
    end_ms: int = Field(description="结束时间(毫秒)")
    search_keywords: List[str] = Field(description="B-Roll 搜索关键词")
    display_mode: BRollDisplayMode = Field(default=BRollDisplayMode.PIP, description="显示模式")
    transition_in: TransitionEffect = Field(default=TransitionEffect.FADE, description="入场过渡")
    transition_out: TransitionEffect = Field(default=TransitionEffect.FADE, description="出场过渡")
    # 可选：如果用户已选择素材
    asset_url: Optional[str] = Field(default=None, description="素材URL（如果已选择）")
    asset_id: Optional[str] = Field(default=None, description="素材ID（如果已选择）")


class ChapterComponent(BaseModel):
    """章节标题组件"""
    id: str = Field(description="组件唯一ID")
    type: str = Field(default="chapter", description="组件类型")
    start_ms: int = Field(description="开始时间(毫秒)")
    end_ms: int = Field(description="结束时间(毫秒)")
    title: str = Field(description="章节标题")
    subtitle: Optional[str] = Field(default=None, description="副标题")
    style: str = Field(default="modern", description="样式: modern/classic/minimal")


class RemotionConfig(BaseModel):
    """Remotion 完整配置"""
    version: str = Field(default="2.0", description="配置版本")
    total_duration_ms: int = Field(description="视频总时长(毫秒)")
    fps: int = Field(default=30, description="帧率")
    
    # 整体风格
    theme: RemotionTheme = Field(default=RemotionTheme.MINIMALIST, description="主题风格")
    color_palette: List[str] = Field(default_factory=lambda: ["#1a1a1a", "#ffffff", "#3b82f6"])
    font_family: str = Field(default="Noto Sans SC", description="字体（支持中文）")
    
    # 时间线组件
    text_components: List[TextComponent] = Field(default_factory=list, description="文字动画")
    broll_components: List[BRollComponent] = Field(default_factory=list, description="B-Roll")
    chapter_components: List[ChapterComponent] = Field(default_factory=list, description="章节")
    
    # 统计
    broll_count: int = Field(default=0, description="B-Roll 数量")
    text_count: int = Field(default=0, description="文字动画数量")


# ============================================
# LLM Prompt
# ============================================

REMOTION_SYSTEM_PROMPT = """你是一个专业的视频编辑 AI，专门为口播视频生成**抖音/小红书风格**的 Remotion 渲染配置。

## 核心任务
分析视频文本，生成**双层字幕系统**：主字幕 + 关键词高亮。

## ★★★ 抖音风格双层字幕系统（核心！）★★★

抖音/小红书的字幕有两层：
1. **主字幕（main-subtitle）**：屏幕底部 8%，大字（52px），彩色+白描边
2. **关键词高亮（keyword-highlight）**：主字幕上方约 10%，小字（24px），蓝色背景框

### 使用规则
- 当讲到**关键概念、数据、专业术语**时，同时显示两层：
  - keyword-highlight: 概念名词（如"递归式三倍指数增长"）
  - main-subtitle: 口语化内容（如"逮迥可累乘三倍指数"）
- 两层字幕**同时出现**，时间范围相同
- keyword-highlight 通常比 main-subtitle 文字少，是提炼的关键词

### 示例
```
讲解时说："这个增长是递归式的，可以累乘三倍指数"

应该生成两个组件（同一时间段）：
1. keyword-highlight: "🔄 递归式三倍指数增长"  // 概念提炼
2. main-subtitle: "逮迥可累乘三倍指数"        // 口语内容（可以有错别字，跟随原文）
```

## 黄金比例（必须遵守！）
- **main-subtitle + keyword-highlight 组合**: 每 10-15 秒至少 1 组
- **单独的 main-subtitle**: 普通口语内容，每 5-10 秒 1 个
- **broll_components**: 4-6 个（分布在视频各个部分）
- **chapter_components**: 2-4 个（标记主要段落）

## 文字组件类型

### 1. main-subtitle（主字幕）- 最常用！
- position: "subtitle-main"（固定，底部 8%）
- animation: "main-subtitle"
- 字体大小: 48-56px
- 颜色: 彩色（橙红 #FF6B35、金黄 #F59E0B、白色 #FFFFFF）
- 特点: 白色粗描边，高可读性

### 2. keyword-highlight（关键词高亮）- 搭配使用！
- position: "subtitle-keyword"（固定，底部 18%）
- animation: "keyword-highlight"
- 字体大小: 22-28px
- 背景: 蓝色（#3B82F6）或紫色（#8B5CF6）
- 特点: 圆角背景框，弹性入场

### 3. 其他动画类型（补充用）
- fade-in: 普通淡入
- slide-up: 从下滑入
- typewriter: 打字机效果
- zoom-in: 缩放强调
- bounce: 弹跳效果

## B-Roll 规则

### ★★★ B-Roll 时长核心原则（语义覆盖！）★★★

B-Roll 的时长必须**完整覆盖讲解该概念的整个时间段**，而不是固定时长！

**正确做法**：
- 分析讲解内容，找出**从开始讲到结束**的完整时间范围
- B-Roll 从概念开始讲的时候出现，到讲完这个概念时结束
- 例如：讲"手机摄像头"从 8000ms 讲到 15000ms，B-Roll 就是 8000-15000ms

**错误做法**：
- ❌ 固定 3-5 秒时长
- ❌ 只覆盖部分讲解内容
- ❌ 在讲解中途结束

**时长参考**：
- 简单提及（如"比如说手机"）: 2-4 秒
- 详细解释（如"手机摄像头有几个重要参数..."）: 5-12 秒
- 深入讲解（如"让我详细说说这个功能..."）: 10-20 秒

### ★★★ 显示模式（只有两种！）★★★

**重要**：当前默认使用 `fullscreen`（全局覆盖）模式！

- `fullscreen`：B-Roll **全屏覆盖**（默认！B-Roll 完全替代主画面）
  - 适用于：详细讲解、展示产品、演示流程、解释概念
  - 这是主要模式，**90% 的 B-Roll 应该使用 fullscreen**
  
- `pip`：B-Roll 作为小窗（Picture-in-Picture，局部显示）
  - 适用于：快速提及、需要同时看到说话人的情况
  - 这是补充模式，**仅在特殊情况下使用**

### 关键词规则（英文，具体）
✅ 好: "laptop coding workspace", "person thinking coffee shop"
❌ 差: "success", "growth"（太抽象）

## 位置约束
- main-subtitle: 必须用 position: "subtitle-main"
- keyword-highlight: 必须用 position: "subtitle-keyword"
- 其他类型: 可用 center, top, bottom 等

## 时间分配
1. 主字幕: 2-4 秒
2. 关键词高亮: 与对应主字幕同步（2-4 秒）
3. B-Roll: **根据语义覆盖完整讲解时间**（通常 5-15 秒）
4. 章节标题: 2-3 秒
5. 组件之间至少间隔 5 秒，避免视觉混乱

## 输出要求
必须输出有效的 JSON，包含足够数量的组件。"""


REMOTION_USER_PROMPT = """分析以下口播视频文本，生成丰富的 Remotion 渲染配置：

## 视频信息
- 总时长: {total_duration_ms} 毫秒 ({total_duration_sec} 秒)
- 片段数: {clip_count}
- ★ 目标宽高比: {target_aspect_ratio}
- ★ 默认显示模式: {default_display_mode}（fullscreen=全屏覆盖，pip=局部小窗）

## 完整文本内容（按时间顺序）
```
{full_text}
```

## 带时间戳的片段
```json
{clips_json}
```

## 生成要求（必须严格遵守！）

### 数量要求
- `text_components`: 必须生成 **5-10 个**，分布在整个视频中
- `broll_components`: 必须生成 **4-6 个**
- `chapter_components`: 必须生成 **2-4 个**

### ★★★ B-Roll 显示模式（重要！）★★★
根据上面的"默认显示模式"参数：
- 如果默认是 `fullscreen`：所有 B-Roll 的 display_mode 都应该设为 `"fullscreen"`（全屏覆盖主画面）
- 如果默认是 `pip`：B-Roll 作为小窗显示

**当前默认模式是: {default_display_mode}，请确保生成的 broll_components 都使用这个模式！**

### text_components 字段规范（★ 抖音风格双层字幕 ★）

#### 主字幕（main-subtitle）
```json
{{
  "id": "text_main_1",
  "start_ms": 5000,
  "end_ms": 8000,
  "text": "逮迥可累乘三倍指数",        // 口语化内容
  "animation": "main-subtitle",       // ★ 必须是 main-subtitle
  "position": "subtitle-main",        // ★ 必须是 subtitle-main
  "style": {{
    "fontSize": 52,                   // 大字 48-56
    "color": "#FF6B35",               // 彩色（橙红/金黄/白）
    "fontWeight": "900"
  }}
}}
```

#### 关键词高亮（keyword-highlight）- 与主字幕同时显示
```json
{{
  "id": "text_keyword_1",
  "start_ms": 5000,                   // ★ 与主字幕相同时间
  "end_ms": 8000,
  "text": "🔄 递归式三倍指数增长",      // 概念提炼
  "animation": "keyword-highlight",   // ★ 必须是 keyword-highlight
  "position": "subtitle-keyword",     // ★ 必须是 subtitle-keyword
  "style": {{
    "fontSize": 24,                   // 小字 22-28
    "color": "#FFFFFF",
    "backgroundColor": "#3B82F6"      // 蓝色背景
  }}
}}
```

### broll_components 字段规范（★ 时长必须覆盖完整讲解 ★）

**关键原则**：B-Roll 的 start_ms 和 end_ms 必须完整覆盖讲解该概念的时间范围！

```json
{{
  "id": "broll_1",
  "start_ms": 8000,      // ★ 从开始讲"手机摄像头"的时候
  "end_ms": 18000,       // ★ 到讲完"摄像头功能"的时候（10秒完整覆盖）
  "search_keywords": ["smartphone camera closeup", "phone photography"],
  "display_mode": "pip",     // 只能是: pip 或 fullscreen
  "transition_in": "fade"
}}
```

**错误示例**（不要这样做）：
```json
// ❌ 错误：固定 5 秒时长，没有覆盖完整讲解
{{"start_ms": 8000, "end_ms": 13000}}  // 讲到 18000ms 但 B-Roll 在 13000ms 就结束了
```

### chapter_components 字段规范
```json
{{
  "id": "chapter_1",
  "start_ms": 0,
  "end_ms": 3000,
  "title": "开篇引入",
  "subtitle": "今天聊聊..."
}}
```

## ★★★ 完整输出示例（抖音风格双层字幕）★★★
```json
{{
  "theme": "dynamic",
  "color_palette": ["#1a1a1a", "#ffffff", "#3b82f6"],
  "text_components": [
    // 第一组：主字幕 + 关键词高亮（同时显示）
    {{"id": "kw_1", "start_ms": 3000, "end_ms": 6000, "text": "📊 复利效应", "animation": "keyword-highlight", "position": "subtitle-keyword", "style": {{"fontSize": 24, "color": "#FFFFFF", "backgroundColor": "#3B82F6"}}}},
    {{"id": "main_1", "start_ms": 3000, "end_ms": 6000, "text": "这就是复利的威力", "animation": "main-subtitle", "position": "subtitle-main", "style": {{"fontSize": 52, "color": "#FF6B35", "fontWeight": "900"}}}},
    
    // 第二组：数据展示
    {{"id": "kw_2", "start_ms": 15000, "end_ms": 18000, "text": "📈 增长 300%", "animation": "keyword-highlight", "position": "subtitle-keyword", "style": {{"fontSize": 24, "color": "#FFFFFF", "backgroundColor": "#8B5CF6"}}}},
    {{"id": "main_2", "start_ms": 15000, "end_ms": 18000, "text": "三个月涨了三倍", "animation": "main-subtitle", "position": "subtitle-main", "style": {{"fontSize": 52, "color": "#F59E0B", "fontWeight": "900"}}}},
    
    // 单独主字幕（无关键词时）
    {{"id": "main_3", "start_ms": 30000, "end_ms": 33000, "text": "所以关键是持续行动", "animation": "main-subtitle", "position": "subtitle-main", "style": {{"fontSize": 52, "color": "#FFFFFF", "fontWeight": "900"}}}},
    
    // 第三组：总结
    {{"id": "kw_3", "start_ms": 50000, "end_ms": 53000, "text": "✅ 核心要点", "animation": "keyword-highlight", "position": "subtitle-keyword", "style": {{"fontSize": 24, "color": "#FFFFFF", "backgroundColor": "#10B981"}}}},
    {{"id": "main_4", "start_ms": 50000, "end_ms": 53000, "text": "立即开始比完美准备更重要", "animation": "main-subtitle", "position": "subtitle-main", "style": {{"fontSize": 48, "color": "#FF6B35", "fontWeight": "900"}}}}
  ],
  "broll_components": [
    // ★ 注意：B-Roll 时长覆盖了完整的讲解时间段 ★
    // 假设讲"早晨工作习惯"从 8000ms 到 18000ms（10秒），B-Roll 就是 10 秒
    {{"id": "broll_1", "start_ms": 8000, "end_ms": 18000, "search_keywords": ["laptop workspace morning", "person working coffee"], "display_mode": "pip", "transition_in": "fade"}},
    // 假设讲"增长数据"从 25000ms 到 38000ms（13秒），B-Roll 就是 13 秒
    {{"id": "broll_2", "start_ms": 25000, "end_ms": 38000, "search_keywords": ["growth chart animation", "business success graph"], "display_mode": "fullscreen", "transition_in": "slide"}}
  ],
  "chapter_components": [
    {{"id": "chapter_1", "start_ms": 0, "end_ms": 3000, "title": "引言"}},
    {{"id": "chapter_2", "start_ms": 45000, "end_ms": 48000, "title": "总结"}}
  ]
}}
```

## ⚠️ 严格字段约束（必须遵守！）

### animation 字段
- "main-subtitle" - ★ 主字幕（抖音风格大字）
- "keyword-highlight" - ★ 关键词高亮（蓝色背景框）
- "fade-in", "slide-up", "typewriter", "zoom-in", "bounce" - 其他效果

### position 字段
- "subtitle-main" - ★ 主字幕位置（底部 8%）
- "subtitle-keyword" - ★ 关键词位置（底部 18%）
- "center", "top", "bottom" - 其他位置

### display_mode 字段（★只有两种★）
- "pip" - B-Roll 小窗
- "fullscreen" - B-Roll 全屏

### ★★★ B-Roll 时长再次强调 ★★★
B-Roll 的 end_ms - start_ms 必须等于讲解该概念的完整时长！
- 讲 10 秒 → B-Roll 10 秒
- 讲 15 秒 → B-Roll 15 秒
- 绝对不要固定 5 秒！

### 颜色推荐
- 主字幕: #FF6B35（橙红）、#F59E0B（金黄）、#FFFFFF（白）
- 关键词背景: #3B82F6（蓝）、#8B5CF6（紫）、#10B981（绿）

## 🌟 标杆视频示例

{fewshot_examples}

## 现在请根据上面的视频内容，生成**抖音风格双层字幕**配置 JSON:

⚠️ **严格要求：输出纯净的 JSON，禁止使用任何注释（包括 // 和 /* */）！**"""


# ============================================
# Remotion 配置生成器
# ============================================

class RemotionConfigGenerator:
    """Remotion 配置生成器"""
    
    def __init__(self):
        self.llm = None
    
    async def _get_llm(self):
        """懒加载 LLM（使用 Doubao-Seed-1.8）"""
        if self.llm is None:
            self.llm = get_remotion_llm()
        return self.llm
    
    async def generate(
        self,
        clips: List[Dict[str, Any]],
        total_duration_ms: int,
        target_aspect_ratio: str = "16:9",  # ★ 新增：目标宽高比
        default_display_mode: str = "fullscreen",  # ★ 新增：默认显示模式
    ) -> RemotionConfig:
        """
        生成 Remotion 配置
        
        Args:
            clips: clips 列表，每个包含 id, text, start_time, end_time
            total_duration_ms: 视频总时长
            target_aspect_ratio: 主视频宽高比 (16:9, 9:16, 1:1)
            default_display_mode: B-Roll 默认显示模式 (fullscreen/pip)
            
        Returns:
            RemotionConfig 配置对象
        """
        logger.info(f"[RemotionGen] 开始生成配置: {len(clips)} 个 clips, 时长 {total_duration_ms}ms")
        logger.info(f"[RemotionGen] ★ 目标宽高比: {target_aspect_ratio}, 默认显示模式: {default_display_mode}")
        
        # 过滤掉隐藏的 clips
        visible_clips = [
            c for c in clips 
            if not (c.get("metadata") or {}).get("hidden", False)
            and not (c.get("metadata") or {}).get("is_filler", False)
        ]
        
        if not visible_clips:
            logger.warning("[RemotionGen] 没有可见的 clips")
            return RemotionConfig(
                total_duration_ms=total_duration_ms,
                broll_count=0,
                text_count=0,
            )
        
        # 构建完整文本
        full_text = "\n".join([
            f"[{c.get('start_time', 0)//1000}s-{c.get('end_time', 0)//1000}s] {c.get('content_text', '') or c.get('text', '')}"
            for c in visible_clips
        ])
        
        # 构建 clips JSON
        clips_json = json.dumps([
            {
                "id": c.get("id"),
                "text": c.get("content_text", "") or c.get("text", ""),
                "start_ms": c.get("start_time", 0),
                "end_ms": c.get("end_time", 0),
            }
            for c in visible_clips
        ], ensure_ascii=False, indent=2)
        
        # 🆕 RAG 检索：获取相似标杆视频示例
        fewshot_examples = "暂无参考示例。"
        examples = []  # 初始化
        retriever = _get_rag_retriever()
        if retriever:
            try:
                # 使用完整文本的前 500 字符作为查询
                query_text = full_text[:500]
                raw_examples = retriever.search_for_fewshot(
                    query_text=query_text,
                    template_id="talking-head",  # 统一使用 talking-head
                    top_k=5  # 多检索一些，然后过滤
                )
                
                # 🆕 相似度阈值过滤：只保留相似度 > 0.35 的示例
                # 注意：all-MiniLM-L6-v2 的语义相似度通常在 0.3-0.7 范围内
                MIN_SIMILARITY = 0.35
                
                # 调试：打印所有检索结果的相似度
                if raw_examples:
                    logger.info(f"[RemotionGen] 🔍 RAG 原始结果相似度:")
                    for i, ex in enumerate(raw_examples):
                        logger.info(f"  [{i+1}] 相似度={ex.get('similarity_score', 0):.3f}, 类型={ex.get('content_type')}")
                
                examples = [ex for ex in raw_examples if ex.get('similarity_score', 0) >= MIN_SIMILARITY]
                
                if examples:
                    # 🆕 优先保留带 B-Roll 的示例
                    broll_examples = [ex for ex in examples if ex.get('has_broll')]
                    non_broll_examples = [ex for ex in examples if not ex.get('has_broll')]
                    
                    # 重新排序：带 B-Roll 的优先
                    examples = (broll_examples + non_broll_examples)[:3]
                    
                    fewshot_examples = _format_fewshot(examples)
                    logger.info(f"[RemotionGen] 🆕 RAG 检索到 {len(raw_examples)} 个示例, 过滤后保留 {len(examples)} 个 (阈值={MIN_SIMILARITY})")
                    for i, ex in enumerate(examples):
                        logger.info(f"  [{i+1}] 类型={ex.get('content_type')}, 布局={ex.get('layout_mode')}, B-Roll={ex.get('has_broll')}, 相似度={ex.get('similarity_score', 0):.2f}")
                else:
                    logger.info(f"[RemotionGen] RAG 检索到 {len(raw_examples)} 个示例, 但相似度都低于阈值 {MIN_SIMILARITY}")
            except Exception as e:
                logger.warning(f"[RemotionGen] RAG 检索失败: {e}")
        else:
            logger.info("[RemotionGen] RAG 未启用")
        
        # 🆕 检测 B-Roll 触发点（规则引擎预检测）
        detected_triggers = _detect_triggers(full_text)
        trigger_summary = ""
        if detected_triggers:
            logger.info(f"[RemotionGen] 🆕 规则引擎检测到 {len(detected_triggers)} 个 B-Roll 触发点")
            trigger_types = {}
            for t in detected_triggers:
                ttype = t.trigger_type.value if hasattr(t.trigger_type, 'value') else str(t.trigger_type)
                trigger_types[ttype] = trigger_types.get(ttype, 0) + 1
            trigger_summary = f"\n\n## 规则引擎预检测到的 B-Roll 触发点\n"
            for ttype, count in trigger_types.items():
                trigger_summary += f"- {ttype}: {count} 处\n"
        
        # ★ 详细日志：LLM 输入
        logger.info(f"[RemotionGen] ===== LLM 调用开始 =====")
        logger.info(f"[RemotionGen] 输入参数:")
        logger.info(f"  - total_duration_ms: {total_duration_ms}")
        logger.info(f"  - total_duration_sec: {round(total_duration_ms / 1000, 1)}")
        logger.info(f"  - clip_count: {len(visible_clips)}")
        logger.info(f"  - full_text (前200字): {full_text[:200]}...")
        
        # 🆕 RAG Few-shot 详细日志
        if retriever and examples:
            logger.info(f"[RemotionGen] 🌟 RAG Few-shot 示例详情:")
            for i, ex in enumerate(examples):
                logger.info(f"  示例 {i+1}:")
                logger.info(f"    输入: {ex.get('input', '')[:80]}...")
                logger.info(f"    类型: {ex.get('content_type')}, 布局: {ex.get('layout_mode')}")
                logger.info(f"    B-Roll: {ex.get('has_broll')}, 触发: {ex.get('broll_trigger_type', 'N/A')}")
                logger.info(f"    推理: {ex.get('reasoning', '')[:100]}...")
            logger.info(f"  Few-shot 注入长度: {len(fewshot_examples)} 字符")
        else:
            logger.info(f"[RemotionGen] ⚠️ 无 RAG 示例注入")
        
        # 调用 LLM
        llm = await self._get_llm()
        prompt = ChatPromptTemplate.from_messages([
            ("system", REMOTION_SYSTEM_PROMPT),
            ("human", REMOTION_USER_PROMPT + trigger_summary),
        ])
        
        chain = prompt | llm
        
        try:
            result = await chain.ainvoke({
                "total_duration_ms": total_duration_ms,
                "total_duration_sec": round(total_duration_ms / 1000, 1),
                "clip_count": len(visible_clips),
                "full_text": full_text,
                "clips_json": clips_json,
                "fewshot_examples": fewshot_examples,  # 🆕 传入 RAG 示例
                "target_aspect_ratio": target_aspect_ratio,  # ★ 新增
                "default_display_mode": default_display_mode,  # ★ 新增
            })
            
            # 解析 LLM 输出
            content = result.content
            logger.info(f"[RemotionGen] LLM 响应长度: {len(content)}")
            logger.info(f"[RemotionGen] LLM 响应内容 (前500字):\n{content[:500]}...")
            
            # 提取 JSON
            json_str = self._extract_json(content)
            if not json_str:
                logger.error("[RemotionGen] 无法从 LLM 响应中提取 JSON")
                return self._fallback_config(visible_clips, total_duration_ms)
            
            data = json.loads(json_str)
            logger.info(f"[RemotionGen] 解析成功: {len(data.get('text_components', []))} 文字, {len(data.get('broll_components', []))} B-Roll")
            
            # ★ 详细日志：解析结果
            logger.info(f"[RemotionGen] text_components:")
            for i, tc in enumerate(data.get('text_components', [])):
                logger.info(f"  [{i+1}] {tc.get('start_ms')}ms-{tc.get('end_ms')}ms: {tc.get('text', '')[:30]}...")
            logger.info(f"[RemotionGen] broll_components:")
            for i, bc in enumerate(data.get('broll_components', [])):
                logger.info(f"  [{i+1}] {bc.get('start_ms')}ms-{bc.get('end_ms')}ms: mode={bc.get('display_mode', 'N/A')}, keywords={bc.get('search_keywords', [])}")
            
            # 构建配置，跳过无效组件
            text_components = []
            for tc in data.get("text_components", []):
                try:
                    text_components.append(TextComponent(**tc))
                except Exception as e:
                    logger.warning(f"[RemotionGen] 跳过无效 TextComponent: {e}, data={tc}")
            
            broll_components = []
            for bc in data.get("broll_components", []):
                try:
                    broll_components.append(BRollComponent(**bc))
                except Exception as e:
                    logger.warning(f"[RemotionGen] 跳过无效 BRollComponent: {e}, data={bc}")
            
            chapter_components = []
            for cc in data.get("chapter_components", []):
                try:
                    chapter_components.append(ChapterComponent(**cc))
                except Exception as e:
                    logger.warning(f"[RemotionGen] 跳过无效 ChapterComponent: {e}, data={cc}")
            
            # ★ 健壮的 theme 解析：LLM 可能返回无效值（如 "dynamic-tech"）
            theme_str = data.get("theme", "minimalist")
            try:
                theme = RemotionTheme(theme_str)
            except ValueError:
                # 尝试模糊匹配
                theme_mapping = {
                    "dynamic-tech": RemotionTheme.TECH,
                    "tech-dynamic": RemotionTheme.TECH,
                    "modern-tech": RemotionTheme.TECH,
                }
                theme = theme_mapping.get(theme_str, RemotionTheme.DYNAMIC)
                logger.warning(f"[RemotionGen] 无效 theme '{theme_str}'，使用 {theme.value}")
            
            config = RemotionConfig(
                total_duration_ms=total_duration_ms,
                theme=theme,
                color_palette=data.get("color_palette", ["#1a1a1a", "#ffffff", "#3b82f6"]),
                text_components=text_components,
                broll_components=broll_components,
                chapter_components=chapter_components,
                broll_count=len(broll_components),
                text_count=len(text_components),
            )
            
            return config
            
        except Exception as e:
            logger.error(f"[RemotionGen] LLM 调用失败: {e}")
            return self._fallback_config(visible_clips, total_duration_ms)
    
    def _extract_json(self, content: str) -> Optional[str]:
        """从 LLM 响应中提取 JSON，并清理注释"""
        import re
        
        # 尝试找 ```json ... ``` 块
        match = re.search(r'```json\s*([\s\S]*?)\s*```', content)
        if match:
            json_str = match.group(1)
        else:
            # 尝试找 { ... } 块
            match = re.search(r'\{[\s\S]*\}', content)
            if match:
                json_str = match.group(0)
            else:
                return None
        
        # ★★★ 清理 JSON 中的注释（LLM 有时会添加 // 或 /* */ 注释）★★★
        # 1. 移除单行注释 // ...
        json_str = re.sub(r'//[^\n]*', '', json_str)
        # 2. 移除多行注释 /* ... */
        json_str = re.sub(r'/\*[\s\S]*?\*/', '', json_str)
        # 3. 移除可能产生的多余逗号（如 {"a": 1, // comment\n} 变成 {"a": 1, }）
        json_str = re.sub(r',\s*([}\]])', r'\1', json_str)
        
        return json_str.strip()
    
    def _fallback_config(
        self, 
        clips: List[Dict[str, Any]], 
        total_duration_ms: int
    ) -> RemotionConfig:
        """降级配置（LLM 失败时使用）"""
        logger.info("[RemotionGen] 使用降级配置")
        
        # 简单生成一个开场标题
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


# 单例
_generator: Optional[RemotionConfigGenerator] = None

def get_remotion_generator() -> RemotionConfigGenerator:
    """获取 Remotion 配置生成器单例"""
    global _generator
    if _generator is None:
        _generator = RemotionConfigGenerator()
    return _generator
