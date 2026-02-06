# Remotion Agent 技术规范 v2.0

> 智能视觉编排系统完整技术规范
> 
> 整合自: REMOTION_AGENT_DESIGN.md + REMOTION_AGENT_GRANULAR_RULES.md + BENCHMARK_TO_REMOTION_INTEGRATION.md

**最后更新**: 2026-01-31  
**状态**: 准备进入开发执行阶段

---

## 目录

1. [系统概述](#1-系统概述)
2. [三阶段流水线](#2-三阶段流水线)
3. [布局模式规范](#3-布局模式规范)
4. [B-Roll触发规则](#4-broll触发规则)
5. [视觉组件规范](#5-视觉组件规范)
6. [节奏控制规则](#6-节奏控制规则)
7. [RAG知识库设计](#7-rag知识库设计)
8. [Agent架构](#8-agent架构)
9. [已完成功能](#9-已完成功能)
10. [开发计划](#10-开发计划)

---

## 1. 系统概述

### 1.1 核心目标

将口播脚本自动转换为具有丰富视觉元素的视频配置，达到或超越标杆视频的质量。

### 1.2 核心洞察 (来自8个标杆视频分析)

| 洞察 | 描述 |
|------|------|
| **4种布局模式** | 人物全屏+B-Roll画中画 / 素材全屏+人物画中画 / 纯素材 / 灵活切换 |
| **6种B-Roll触发** | 人物/产品/概念/场景/演示/数据 |
| **5种关键词卡片** | dark-solid / light-solid / semi-transparent / gradient / numbered |
| **节奏规律** | 短视频快切(3-6s) / 长视频更快(2-6s) / 白板型慢(20-40s) |

### 1.3 设计原则

```
1. 标杆驱动 - 所有规则从真实标杆视频提炼
2. RAG增强 - 动态检索相似案例作为Few-Shot
3. 渐进复杂 - 从简单Workflow开始，按需增加复杂度
4. 可验证 - 每个输出都有明确的验证规则
```

---

## 2. 三阶段流水线

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Stage 1        │    │  Stage 2        │    │  Stage 3        │
│  内容理解        │ →  │  结构分析        │ →  │  视觉编排        │
│                 │    │                 │    │                 │
│ • 主题识别       │    │ • 片段切分       │    │ • 布局选择       │
│ • 风格判断       │    │ • 内容类型标注    │    │ • 组件配置       │
│ • 模版路由       │    │ • B-Roll触发识别  │    │ • 时间编排       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                      │                      │
         ▼                      ▼                      ▼
   ContentUnderstanding   StructuredSegments      VisualConfig
```

### 2.1 Stage 1: 内容理解

**输入**: 原始脚本文本  
**输出**: `ContentUnderstanding`

```typescript
interface ContentUnderstanding {
  topic: string;                    // 主题
  category: 'tech' | 'business' | 'education' | 'lifestyle';
  tone: 'educational' | 'casual' | 'professional';
  suggestedTemplate: string;        // 推荐模版
  hasCamera: boolean;               // 是否有人物出镜
  estimatedDuration: number;        // 预估时长(ms)
}
```

### 2.2 Stage 2: 结构分析

**输入**: 脚本 + ContentUnderstanding  
**输出**: `StructuredSegment[]`

```typescript
interface StructuredSegment {
  id: string;
  text: string;
  start_ms: number;
  end_ms: number;
  role: 'narrator' | 'speaker' | 'quote';
  contentType: 'hook' | 'core_point' | 'explanation' | 'example' | 'data' | 'comparison' | 'demo' | 'cta';
  
  structure: {
    isListItem: boolean;
    listIndex?: number;
    totalListItems?: number;
    hasData: boolean;
    dataPoints?: Array<{value: string; label: string}>;
    hasPerson: boolean;
    personName?: string;
    hasProduct: boolean;
    productName?: string;
    hasConcept: boolean;
    conceptName?: string;
  };
  
  brollTrigger?: {
    type: 'person' | 'product' | 'concept' | 'scene' | 'demo' | 'data';
    keywords: string[];
    insertMode: 'pip-over-person' | 'fullscreen-replace' | 'person-pip-over-content';
    duration_ms: number;
    useCanvas: boolean;
    canvasComponent?: string;
  };
  
  visualPriority: 'high' | 'medium' | 'low';
}
```

### 2.3 Stage 3: 视觉编排

**输入**: StructuredSegments + 模版配置  
**输出**: `VisualConfig`

```typescript
interface VisualConfig {
  version: '2.0';
  template: string;
  layoutMode: 'modeA' | 'modeB' | 'modeC' | 'modeD';
  duration_ms: number;
  
  mainVideo: {
    defaultMode: 'fullscreen' | 'pip' | 'hidden';
    dynamicMode?: boolean;
    modeTransitions?: Array<{
      atMs: number;
      toMode: string;
      pipConfig?: PipConfig;
    }>;
    pip?: PipConfig;
  };
  
  canvas?: CanvasConfig;
  overlays: OverlayConfig[];
  brolls: BrollConfig[];
  subtitles: SubtitleConfig;
}
```

---

## 3. 布局模式规范

### 3.1 四种布局模式

| 模式 | ID | 人物占比 | 触发条件 | 标杆视频 |
|------|-----|----------|----------|----------|
| **A** | `person-fullscreen-broll-pip` | 70% 全屏 | 默认/口播 | 001,002,006,007,008 |
| **B** | `content-fullscreen-person-pip` | 20-30% 画中画 | 演示/教学 | 004,005 |
| **C** | `content-only` | 0% | 白板/PPT | 003 |
| **D** | `dynamic-switch` | 动态切换 | 长视频(>4分钟) | 006,007,008 |

### 3.2 模式A配置 (人物全屏 + B-Roll画中画)

```typescript
const MODE_A: LayoutModeConfig = {
  id: 'person-fullscreen-broll-pip',
  mainVideo: {
    defaultMode: 'fullscreen',
    size: 100,
  },
  brollPip: {
    enabled: true,
    position: 'bottom-center',
    size: 30,
    offsetY: 15,  // 距底部15%
    shape: 'rectangle',
    borderRadius: 12,
    border: { width: 2, color: 'rgba(255,255,255,0.3)' },
    shadow: '0 4px 20px rgba(0,0,0,0.3)',
  },
  subtitleAdjustment: {
    whenBrollActive: { position: 'above-broll', offsetY: -5 },
  },
};
```

### 3.3 模式B配置 (素材全屏 + 人物画中画)

```typescript
const MODE_B: LayoutModeConfig = {
  id: 'content-fullscreen-person-pip',
  mainVideo: {
    defaultMode: 'pip',
    size: 25,
  },
  personPip: {
    enabled: true,
    positions: {
      'bottom-center': { x: 50, y: 85, anchorX: 'center', anchorY: 'bottom' },
      'bottom-right': { x: 90, y: 85, anchorX: 'right', anchorY: 'bottom' },
    },
    defaultPosition: 'bottom-center',
    defaultSize: 25,
    shape: 'rectangle',
    borderRadius: 8,
    border: { width: 2, color: 'white' },
  },
  canvas: {
    fullscreen: true,
    padding: { top: 10, bottom: 20, left: 5, right: 5 },
  },
};
```

### 3.4 模式C配置 (纯素材无人物)

```typescript
const MODE_C: LayoutModeConfig = {
  id: 'content-only',
  mainVideo: {
    defaultMode: 'hidden',
    size: 0,
  },
  canvas: {
    fullscreen: true,
    background: { type: 'paper', color: '#FFFEF5', texture: 'paper' },
    padding: { top: 5, bottom: 15, left: 5, right: 5 },
  },
  subtitles: {
    style: 'yellow',  // 白板型用黄色字幕
  },
};
```

### 3.5 模式D配置 (灵活切换)

```typescript
const MODE_D: LayoutModeConfig = {
  id: 'dynamic-switch',
  mainVideo: {
    defaultMode: 'fullscreen',
    dynamicMode: true,
  },
  modeTransitions: {
    enabled: true,
    transitionDuration: 500,
    transitionType: 'smooth',
  },
  fullscreenConfig: { size: 100 },
  pipConfig: {
    positions: {
      'top-center': { x: 50, y: 15, shape: 'rectangle' },
      'top-right-circle': { x: 88, y: 15, shape: 'circle' },
      'bottom-center': { x: 50, y: 85, shape: 'rectangle' },
    },
    defaultPosition: 'bottom-center',
    defaultSize: 25,
  },
  switchRules: [
    { from: 'fullscreen', to: 'pip', triggers: ['demo_start', 'data_display'] },
    { from: 'pip', to: 'fullscreen', triggers: ['demo_end', 'opinion_expression'] },
  ],
};
```

### 3.6 画中画位置精确配置

```typescript
const PIP_POSITIONS = {
  person: {
    'bottom-center': {
      x: '50%', y: 'calc(100% - 8%)',
      transform: 'translateX(-50%)',
      width: '25%', aspectRatio: '16/9',
      borderRadius: '8px', zIndex: 100,
    },
    'bottom-right': {
      x: 'calc(100% - 3%)', y: 'calc(100% - 8%)',
      transform: 'translateX(-100%)',
      width: '20%', aspectRatio: '16/9',
      borderRadius: '8px', zIndex: 100,
    },
    'top-right-circle': {
      x: 'calc(100% - 5%)', y: '8%',
      transform: 'translateX(-100%)',
      width: '22%', aspectRatio: '1/1',
      borderRadius: '50%',
      border: '3px solid white',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      zIndex: 100,
    },
  },
  broll: {
    'bottom-center': {
      x: '50%', y: 'calc(100% - 18%)',
      transform: 'translateX(-50%)',
      width: '30%', aspectRatio: '16/9',
      borderRadius: '12px',
      border: '2px solid rgba(255,255,255,0.3)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      zIndex: 50,
    },
  },
};
```

---

## 4. B-Roll触发规则

### 4.1 六种触发类型

| 类型 | 触发特征 | B-Roll内容 | 插入方式 | 时长 |
|------|----------|------------|----------|------|
| **person** | 人名 | 该人物画面 | pip-over-person | 3-5s |
| **product** | 品牌名 | Logo/界面 | pip-over-person | 2-4s |
| **concept** | 抽象定义 | 可视化/Canvas | pip/canvas | 3-6s |
| **scene** | 场景描述 | 实拍/动画 | pip/fullscreen | 4-8s |
| **demo** | 工具操作 | 屏幕录制 | person-pip-over-content | 10-40s |
| **data** | 数字/论点 | 图表/Canvas | person-pip-over-content | 5-20s |

### 4.2 触发识别正则规则

```python
BROLL_TRIGGER_RULES = {
    "person": {
        "patterns": [
            r"(马斯克|Elon Musk|马老板)",
            r"(Karpathy|卡帕西|Andrej)",
            r"(黄仁勋|Jensen|老黄)",
            r"(Sam Altman|奥特曼)",
            r"(\w+)说|(\w+)认为|(\w+)表示",
        ],
        "search_template": "{name} interview portrait speaking",
        "insert_mode": "pip-over-person",
        "duration": {"min": 3000, "max": 5000},
        "pip_config": {"position": "bottom-center", "size": 30},
    },
    
    "product": {
        "patterns": [
            r"(ChatGPT|GPT-4|Claude|Gemini)",
            r"(AlphaGo|AlphaFold|DeepMind)",
            r"(Midjourney|DALL-E|Stable Diffusion)",
            r"用(\w+)来|在(\w+)里|打开(\w+)",
        ],
        "search_template": "{product} logo demo interface",
        "insert_mode": "pip-over-person",
        "duration": {"min": 2000, "max": 4000},
        "pip_config": {"position": "bottom-center", "size": 25},
    },
    
    "concept": {
        "patterns": [
            r"(指数增长|exponential)",
            r"(AI的本质|人工智能的核心)",
            r"(MVP|最小可行产品)",
            r"(AGI|通用人工智能)",
            r"什么是(\w+)|(\w+)的定义",
        ],
        "use_canvas": True,
        "canvas_component": "ConceptCard",
        "duration": {"min": 3000, "max": 6000},
    },
    
    "scene": {
        "patterns": [
            r"(机器人手术|手术机器人)",
            r"(工厂里|生产线上)",
            r"(比如说|举个例子|想象一下)",
        ],
        "search_template": "{scene} realistic footage",
        "insert_mode": "pip-over-person",
        "insert_mode_long": "fullscreen-replace",  # >6s用全屏
        "duration_threshold": 6000,
        "duration": {"min": 4000, "max": 8000},
    },
    
    "demo": {
        "patterns": [
            r"(我来演示|让我演示)",
            r"(操作步骤|具体操作)",
            r"(打开这个工具|点击这里)",
        ],
        "insert_mode": "person-pip-over-content",
        "layout_switch": {"mode": "B", "person_ratio": 25},
        "duration": {"min": 10000, "max": 40000},
    },
    
    "data": {
        "patterns": [
            r"(\d+%|\d+倍|\d+万|\d+亿)",
            r"(数据显示|研究表明)",
            r"(第一|第二|首先|其次)",
            r"(对比一下|比较一下)",
        ],
        "use_canvas": True,
        "canvas_map": {
            "percentage": "DataNumber",
            "list": "PointListCanvas",
            "comparison": "ComparisonCanvas",
        },
        "insert_mode": "person-pip-over-content",
        "duration": {"min": 5000, "max": 20000},
    },
}
```

### 4.3 B-Roll触发检测Prompt

```markdown
## System Prompt

你是专业的视频编辑分析师。分析脚本，识别需要插入B-Roll的位置。

### 6种触发类型:

1. **person** - 提到人名 → 该人物画面 (3-5s)
2. **product** - 提到品牌 → Logo/界面 (2-4s)
3. **concept** - 抽象定义 → Canvas组件 (3-6s)
4. **scene** - 场景描述 → 实拍素材 (4-8s)
5. **demo** - 工具操作 → 切换到模式B (10-40s)
6. **data** - 数字/论点 → Canvas组件 (5-20s)

### 输出格式:

```json
{
  "trigger_type": "person|product|concept|scene|demo|data",
  "trigger_text": "触发的原文",
  "keywords": ["搜索关键词"],
  "insert_mode": "pip-over-person|fullscreen-replace|person-pip-over-content",
  "duration_ms": 建议时长,
  "use_canvas": true/false,
  "canvas_component": "组件名"
}
```

### 注意:
- 不要过度识别
- 避免同时间多个触发
- 演示触发优先级最高
- 优先用Canvas而非外部B-Roll
```

---

## 5. 视觉组件规范

### 5.1 Canvas组件 (持续显示)

| 组件 | 用途 | 触发条件 |
|------|------|----------|
| **PointListCanvas** | 要点列表 | 3-7个要点论述 |
| **ProcessFlowCanvas** | 流程/递进图 | 步骤、因果关系 |
| **ComparisonCanvas** | 对比画布 | A vs B、优缺点 |
| **ConceptCard** | 概念卡片 | 术语定义 |

### 5.2 Overlay组件 (临时显示)

| 组件 | 用途 | 时长 |
|------|------|------|
| **KeywordCard** | 关键词弹出 | 2-6s |
| **DataNumber** | 数字动画 | 3-8s |
| **HighlightBox** | 强调框 | 2-5s |
| **ProgressIndicator** | 进度指示 | 持续 |
| **ChapterTitle** | 章节标题 | 2-4s |
| **QuoteBlock** | 引用块 | 3-6s |

### 5.3 关键词卡片5种变体

```typescript
const KEYWORD_CARD_VARIANTS = {
  'dark-solid': {
    container: {
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      borderRadius: '8px',
      padding: '16px 24px',
    },
    text: { color: '#FFFFFF', fontWeight: 700, fontSize: '24px' },
    number: { color: '#FFD700', fontWeight: 800, fontSize: '28px' },
    position: 'top-left',
    animation: { enter: 'slideInLeft', duration: 300 },
    useCase: '列表型内容，左上角固定',
  },
  
  'light-solid': {
    container: {
      backgroundColor: '#FFFFFF',
      borderRadius: '12px',
      padding: '20px 32px',
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)',
    },
    text: { color: '#333333', fontWeight: 600, fontSize: '28px' },
    multiColor: { positive: '#4CAF50', negative: '#E53935', highlight: '#FF9800' },
    position: 'center',
    animation: { enter: 'fadeIn', duration: 400 },
    useCase: 'PPT/白板型，中央展示',
  },
  
  'semi-transparent': {
    container: {
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(10px)',
      borderRadius: '12px',
      padding: '16px 28px',
    },
    text: { color: '#FFFFFF', fontWeight: 600, fontSize: '26px' },
    position: 'center',
    animation: { enter: 'pop', duration: 250 },
    useCase: '口播型，临时弹出',
  },
  
  'gradient': {
    container: {
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      borderRadius: '16px',
      padding: '20px 36px',
    },
    text: { color: '#FFFFFF', fontWeight: 700, fontSize: '28px' },
    position: 'center',
    animation: { enter: 'bounceIn', duration: 400 },
    useCase: '品牌/产品介绍',
  },
  
  'numbered': {
    container: {
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      borderRadius: '8px',
      padding: '12px 20px',
    },
    number: {
      backgroundColor: '#FFD700',
      color: '#000000',
      width: '32px', height: '32px',
      borderRadius: '50%',
    },
    text: { color: '#FFFFFF', fontWeight: 600, fontSize: '22px' },
    position: 'top-left',
    animation: { enter: 'slideInLeft', duration: 300 },
    useCase: '多点论述，如"5条建议"',
  },
};

// 变体选择规则
const VARIANT_SELECTION = {
  'list_item': 'numbered',
  'concept_definition': 'light-solid',
  'brand_product': 'gradient',
  'quick_emphasis': 'semi-transparent',
  'ppt_content': 'light-solid',
  'default': 'semi-transparent',
};
```

### 5.4 字幕样式规范

```typescript
const SUBTITLE_STYLES = {
  'white-stroke': {
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontWeight: 700,
    fontSize: 'clamp(24px, 4.5vh, 48px)',
    color: '#FFFFFF',
    textShadow: `-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 3px 6px rgba(0,0,0,0.5)`,
    textAlign: 'center',
    lineHeight: 1.4,
    maxWidth: '85%',
  },
  
  'yellow': {
    fontFamily: "'PingFang SC', sans-serif",
    fontWeight: 700,
    fontSize: 'clamp(22px, 4vh, 44px)',
    color: '#FFD700',
    textShadow: `-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000`,
  },
  
  'white-with-highlight': {
    base: { color: '#FFFFFF' },
    highlight: {
      yellow: { color: '#FFD700', textShadow: '0 0 10px rgba(255, 215, 0, 0.5)' },
      blue: { color: '#00BFFF', textShadow: '0 0 10px rgba(0, 191, 255, 0.5)' },
    },
  },
};

const SUBTITLE_POSITIONS = {
  'center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
  'center-bottom': { top: '60%', left: '50%', transform: 'translateX(-50%)' },
  'bottom': { bottom: '8%', left: '50%', transform: 'translateX(-50%)' },
  'above-broll': { bottom: '38%', left: '50%', transform: 'translateX(-50%)' },
};
```

---

## 6. 节奏控制规则

### 6.1 镜头时长计算

```typescript
function calculatePacing(totalDuration: number, templateType: string) {
  const totalSeconds = totalDuration / 1000;
  
  // 基础镜头时长
  let baseShotDuration: number;
  if (totalSeconds <= 120) baseShotDuration = 4500;      // 短视频: 3-6s
  else if (totalSeconds <= 300) baseShotDuration = 7000; // 中等: 4-10s
  else baseShotDuration = 4000;                          // 长视频: 2-6s (更快)
  
  // 模版修正
  const multiplier = {
    'whiteboard': 5.0,    // 白板型更慢
    'screencast': 2.5,    // 演示型较慢
    'talking-head': 1.2,  // 口播型略慢
    'mixed-media': 1.0,   // 混合型标准
  }[templateType] || 1.0;
  
  const avgShotDuration = baseShotDuration * multiplier;
  
  return {
    avgShotDuration: Math.round(avgShotDuration),
    minShotDuration: Math.round(avgShotDuration * 0.5),
    maxShotDuration: Math.round(avgShotDuration * 2.0),
    
    // 分段节奏
    hookPacing: {
      duration: Math.min(10000, totalDuration * 0.08),
      shotDuration: Math.round(avgShotDuration * 0.6),  // 更快
    },
    bodyPacing: {
      duration: totalDuration * 0.82,
      shotDuration: Math.round(avgShotDuration),
    },
    ctaPacing: {
      duration: Math.min(15000, totalDuration * 0.1),
      shotDuration: Math.round(avgShotDuration * 1.3),  // 更慢
    },
    
    elementGap: 500,  // 视觉元素间隔
  };
}
```

### 6.2 视觉编排规则

```typescript
const ORCHESTRATION_RULES = {
  timing: {
    keywordCard: { delayAfterTrigger: 300, duration: {min: 2000, max: 5000} },
    dataNumber: { delayAfterTrigger: 0, duration: {min: 3000, max: 6000} },
    broll: { leadTime: 500, duration: {min: 2000, max: 8000} },
    canvas: { delayAfterTrigger: 200, minDisplayTime: 3000, perItemTime: 2000 },
  },
  
  zIndex: {
    background: 0, canvas: 10, mainVideo: 20,
    brollPip: 30, personPip: 40, overlays: 50,
    keywordCard: 60, subtitles: 100,
  },
  
  collision: {
    maxOverlays: 2,
    mutuallyExclusive: [
      ['keywordCard-center', 'canvas-center'],
      ['brollPip-bottom-center', 'personPip-bottom-center'],
    ],
    subtitleAvoidance: {
      whenBrollPip: 'move-up',
      whenPersonPipBottom: 'move-up',
    },
  },
  
  transitions: {
    'hook-to-body': 'zoom-out',
    'point-to-point': 'fade',
    'body-to-cta': 'slide-up',
    'broll-insert': 'cut',
    'layout-switch': 'smooth',
    durations: { cut: 0, fade: 300, 'zoom-out': 400, smooth: 500 },
  },
};
```

### 6.3 验证规则

```typescript
const VALIDATION_RULES = {
  pacing: {
    max_static_duration: 8000,  // 最大静止8秒
    min_element_gap: 300,       // 元素最小间隔300ms
    max_overlays_at_once: 2,    // 同时最多2个叠加
  },
  
  positioning: {
    forbidden_combinations: [
      ['keywordCard-center', 'canvas-center'],
      ['brollPip-bottom-center', 'subtitles-bottom'],
    ],
    required_margin_from_edge: 3,  // 距边缘至少3%
  },
  
  duration: {
    keywordCard: {min: 2000, max: 6000},
    dataNumber: {min: 3000, max: 8000},
    broll: {min: 2000, max: 10000},
    canvas: {min: 5000, max: 60000},
  },
  
  content: {
    max_keyword_length: 20,
    max_list_items: 7,
  },
  
  layout: {
    mode_switch_min_interval: 5000,
    pip_min_duration: 3000,
  },
};
```

---

## 7. RAG知识库设计

### 7.1 数据结构

```python
class BenchmarkSegment(BaseModel):
    """标杆视频片段 - RAG检索单元"""
    
    id: str                          # "bm_001_seg_003"
    
    # 来源
    source: dict = {
        "video_id": str,             # "001"
        "video_name": str,           # "科技科普-马斯克机器人"
        "timestamp_ms": int,
        "duration_ms": int,
        "benchmark_type": str,       # "mixed-media"
    }
    
    # 输入 (检索匹配用)
    input_text: str                  # 脚本文本
    content_type: str                # hook/core_point/example/data/...
    
    # 上下文
    context: dict = {
        "position_in_video": str,    # "opening"/"middle"/"ending"
        "previous_type": str,
        "next_type": str,
    }
    
    # 输出 (标杆答案)
    visual_config: dict              # 标准视觉配置
    reasoning: str                   # 设计理由
    
    # 向量
    embedding: List[float]
```

### 7.2 知识库初始种子数据

```python
# 基于8个标杆视频的初始数据
INITIAL_BENCHMARK_DATA = [
    # === 001.mp4 片段 ===
    {
        "id": "bm_001_hook",
        "source": {"video_id": "001", "benchmark_type": "mixed-media"},
        "input_text": "你知道现在最火的机器人技术是什么吗？",
        "content_type": "hook",
        "visual_config": {
            "layoutMode": "modeA",
            "overlays": [{
                "type": "keyword-card",
                "variant": "semi-transparent",
                "content": {"text": "机器人技术"},
                "position": "center",
            }],
        },
        "reasoning": "开场问题触发关键词卡片，半透明变体居中，快速抓注意力",
    },
    {
        "id": "bm_001_person",
        "source": {"video_id": "001", "benchmark_type": "mixed-media"},
        "input_text": "马斯克在最近的访谈中说",
        "content_type": "example",
        "visual_config": {
            "brolls": [{
                "searchKeywords": ["马斯克", "访谈"],
                "insertMode": "pip-over-person",
                "pipConfig": {"position": "bottom-center", "size": 30},
                "duration_ms": 4000,
            }],
        },
        "reasoning": "人物名触发，画中画B-Roll保持主讲人可见",
    },
    
    # === 003.mp4 片段 (白板型) ===
    {
        "id": "bm_003_concept",
        "source": {"video_id": "003", "benchmark_type": "whiteboard"},
        "input_text": "MVP是什么？MVP就是最小可执行产品",
        "content_type": "core_point",
        "visual_config": {
            "layoutMode": "modeC",
            "canvas": {
                "type": "ConceptCard",
                "config": {"term": "MVP", "definition": "最小可执行产品"},
            },
            "subtitles": {"style": "yellow"},
        },
        "reasoning": "概念定义触发ConceptCard，白板型用黄色字幕",
    },
    
    # === 004/005.mp4 片段 (教学演示) ===
    {
        "id": "bm_004_demo",
        "source": {"video_id": "004", "benchmark_type": "mixed-media"},
        "input_text": "我来给大家演示一下Claude的Skill功能怎么用",
        "content_type": "demo",
        "visual_config": {
            "layoutMode": "modeB",
            "mainVideo": {
                "defaultMode": "pip",
                "pipConfig": {"position": "bottom-center", "size": 25},
            },
        },
        "reasoning": "演示触发切换到模式B，人物缩小到下方中央",
    },
    
    # === 007.mp4 片段 (列表型) ===
    {
        "id": "bm_007_list",
        "source": {"video_id": "007", "benchmark_type": "mixed-media"},
        "input_text": "第一条建议：客户沟通比写代码重要10倍",
        "content_type": "core_point",
        "visual_config": {
            "overlays": [{
                "type": "keyword-card",
                "variant": "numbered",
                "content": {"number": 1, "text": "客户沟通，比写代码重要10倍"},
                "position": "top-left",
            }],
        },
        "reasoning": "列表项用numbered变体，固定左上角方便追踪",
    },
    
    # === 008.mp4 片段 (数据型) ===
    {
        "id": "bm_008_data",
        "source": {"video_id": "008", "benchmark_type": "mixed-media"},
        "input_text": "这个项目让我赚了2万块",
        "content_type": "data",
        "visual_config": {
            "overlays": [{
                "type": "data-number",
                "content": {"value": "2万", "label": "收入", "trend": "up"},
                "position": "top-right",
            }],
            "brolls": [{
                "searchKeywords": ["银行转账", "收款截图"],
                "insertMode": "pip-over-person",
                "duration_ms": 3000,
            }],
        },
        "reasoning": "数据触发DataNumber组件+收款截图B-Roll增加可信度",
    },
]
```

### 7.3 RAG检索流程

```python
class RAGVisualChain:
    def __init__(self):
        self.vectorstore = Chroma(
            collection_name="benchmark_segments",
            embedding_function=OpenAIEmbeddings(),
        )
        self.llm = ChatOpenAI(model="gpt-4", temperature=0.3)
    
    def generate_visual_config(
        self, 
        segment: StructuredSegment,
        template_id: str,
        k: int = 3
    ) -> dict:
        # 1. 检索相似标杆
        similar = self.vectorstore.similarity_search(
            query=segment.text,
            k=k,
            filter={"template_id": template_id, "content_type": segment.contentType}
        )
        
        # 2. Few-Shot Prompt
        examples = self._format_examples(similar)
        prompt = self._build_prompt(examples, segment)
        
        # 3. LLM生成
        return (prompt | self.llm | JsonOutputParser()).invoke({})
```

---

## 8. Agent架构

### 8.1 LangGraph工作流

```
┌─────────────────────────────────────────────────────────────────┐
│                    Orchestrator (编排器)                         │
│  - 接收脚本                                                      │
│  - 调度Worker                                                   │
│  - 聚合结果                                                      │
│  - 判断是否迭代                                                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   Worker 1    │   │   Worker 2    │   │   Worker 3    │
│   Template    │   │   Content     │   │   Visual      │
│   Router      │   │   Analyzer    │   │   Designer    │
│               │   │               │   │               │
│ - 模版匹配     │   │ - 结构分析     │   │ - 视觉配置     │
│ - RAG检索     │   │ - B-Roll识别   │   │ - RAG检索     │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
                    ┌───────────────┐
                    │   Evaluator   │
                    │   评估器       │
                    │               │
                    │ - 规则检查     │
                    │ - 通过/迭代    │
                    └───────────────┘
```

### 8.2 状态定义

```python
class AgentState(TypedDict):
    # 输入
    script: str
    user_preferences: dict
    
    # 中间状态
    current_stage: Literal["routing", "analysis", "visual", "review", "complete"]
    segments: List[dict]
    selected_template: Optional[str]
    
    # Worker结果
    router_result: Optional[dict]
    analysis_result: Optional[dict]
    visual_result: Optional[dict]
    
    # 迭代控制
    iteration_count: int
    max_iterations: int
    evaluation_feedback: Optional[str]
    
    # 输出
    final_config: Optional[dict]
    error: Optional[str]
```

---

## 9. 已完成功能

### 9.1 后端模块 (1585行代码)

| 文件 | 描述 | 状态 |
|------|------|------|
| `models.py` | Pydantic数据模型 | ✅ |
| `stage2_structure.py` | 结构分析 | ✅ |
| `stage3_visual.py` | 视觉配置生成 | ✅ |
| `templates/base.py` | 模板基类 | ✅ |
| `templates/whiteboard.py` | 白板风格 | ✅ |
| `templates/talking_head.py` | 口播风格 | ✅ |
| `prompts/structure.py` | LLM提示词 | ✅ |

### 9.2 前端组件

| 类型 | 组件 | 状态 |
|------|------|------|
| Canvas | PointListCanvas, ProcessFlowCanvas, ComparisonCanvas, ConceptCard | ✅ |
| Overlay | KeywordCard, DataNumber, HighlightBox, QuestionHook, ChapterTitle, ProgressIndicator, QuoteBlock | ✅ |
| Background | GradientBackground, PaperBackground | ✅ |
| Core | VisualRenderer, RemotionAgentDemo | ✅ |

### 9.3 编辑器集成

- ✅ VisualAgentPanel - 智能视觉编排面板
- ✅ 集成到ToolsSidebar (Visual AI按钮)
- ✅ editor-store状态管理

---

## 10. 开发计划

### Phase 1: RAG知识库 (Week 1)

| 任务 | 优先级 | 预估 |
|------|--------|------|
| 创建Chroma向量数据库 | P0 | 0.5d |
| 定义BenchmarkSegment Schema | P0 | 0.5d |
| 导入8个标杆视频种子数据 (~50条) | P0 | 1d |
| 实现RAG检索接口 | P0 | 1d |
| 测试检索效果 | P1 | 0.5d |

### Phase 2: Agent核心升级 (Week 2)

| 任务 | 优先级 | 预估 |
|------|--------|------|
| 实现4种布局模式配置 | P0 | 1d |
| 实现B-Roll触发识别规则 | P0 | 1d |
| 升级Stage2添加brollTrigger | P0 | 1d |
| 升级Stage3集成RAG | P0 | 1d |
| 实现验证规则检查器 | P1 | 0.5d |

### Phase 3: 组件增强 (Week 3)

| 任务 | 优先级 | 预估 |
|------|--------|------|
| 实现5种KeywordCard变体 | P0 | 1d |
| 实现PiP组件 (人物/B-Roll) | P0 | 1.5d |
| 实现动态布局切换 | P1 | 1d |
| 字幕样式规范化 | P1 | 0.5d |
| 节奏计算器集成 | P1 | 0.5d |

### Phase 4: 集成测试 (Week 4)

| 任务 | 优先级 | 预估 |
|------|--------|------|
| 端到端测试流程 | P0 | 1d |
| 与标杆视频对比验证 | P0 | 1d |
| 性能优化 | P1 | 1d |
| 文档更新 | P1 | 0.5d |
| Bug修复 | P0 | 1.5d |

### 里程碑

```
Week 1 结束: RAG知识库可用，能检索相似标杆
Week 2 结束: Agent能根据脚本生成带布局模式的配置
Week 3 结束: 所有视觉组件就绪，支持动态切换
Week 4 结束: 端到端流程打通，质量接近标杆视频
```

---

## 附录

### A. 相关文档

- [BENCHMARK_CONCLUSION.md](./BENCHMARK_CONCLUSION.md) - 8个标杆视频原始分析数据

### B. 标杆视频参考

| 视频 | 时长 | 类型 | 特点 |
|------|------|------|------|
| 001 | 1:39 | mixed-media | 模式A，人物全屏+B-Roll画中画 |
| 002 | 1:19 | mixed-media | 快节奏，3.2s镜头 |
| 003 | 2:14 | whiteboard | 模式C，无人物，黄色字幕 |
| 004 | 2:36 | mixed-media | 模式B，人物画中画下方中央 |
| 005 | 2:18 | mixed-media | 模式B，人物画中画右下角 |
| 006 | 4:50 | talking-head | 模式D，灵活切换 |
| 007 | 4:28 | mixed-media | numbered卡片，左上角 |
| 008 | 6:51 | mixed-media | 圆形画中画，快节奏 |

---

*最后更新: 2026-01-31*
