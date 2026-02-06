# Remotion Agent 系统

> 合并自：REMOTION_AGENT_SPEC / REMOTION_AGENT_GUIDE
> 
> 智能视觉编排系统：将口播脚本自动转换为高质量视频视觉配置

---

## 1. 系统概述

### 1.1 核心目标

将口播脚本自动转换为具有丰富视觉元素的视频配置，达到或超越标杆视频的质量。

### 1.2 核心洞察（来自 8 个标杆视频分析）

| 洞察 | 描述 |
|------|------|
| **4 种布局模式** | 人物全屏+B-Roll画中画 / 素材全屏+人物画中画 / 纯素材 / 灵活切换 |
| **6 种 B-Roll 触发** | 人物/产品/概念/场景/演示/数据 |
| **5 种关键词卡片** | dark-solid / light-solid / semi-transparent / gradient / numbered |
| **节奏规律** | 短视频快切(3-6s) / 长视频更快(2-6s) / 白板型慢(20-40s) |

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
```

### 2.1 Stage 1: 内容理解

```typescript
interface ContentUnderstanding {
  topic: string;
  category: 'tech' | 'business' | 'education' | 'lifestyle';
  tone: 'educational' | 'casual' | 'professional';
  suggestedTemplate: string;
  hasCamera: boolean;
  estimatedDuration: number;
}
```

### 2.2 Stage 2: 结构分析

```typescript
interface StructuredSegment {
  id: string;
  text: string;
  start_ms: number;
  end_ms: number;
  contentType: 'hook' | 'core_point' | 'explanation' | 'example' | 'data' | 'comparison' | 'demo' | 'cta';
  brollTriggers: BrollTrigger[];
}
```

### 2.3 Stage 3: 视觉编排

```typescript
interface VisualConfig {
  segments: VisualSegment[];
  globalStyle: StyleConfig;
  timeline: TimelineConfig;
}
```

---

## 3. 布局模式

### Mode A: 人物全屏 + B-Roll 画中画（默认）

```
┌─────────────────────────────────────────┐
│                                         │
│      【人物区域 70%】                     │
│       全屏居中口播                        │
│                                         │
│    ┌─────────────────────┐              │
│    │   B-Roll 画中画      │              │
│    │   右下角 30%         │              │
│    └─────────────────────┘              │
└─────────────────────────────────────────┘
```

### Mode B: 素材全屏 + 人物画中画

```
┌─────────────────────────────────────────┐
│                                         │
│      【B-Roll 全屏】                      │
│       产品展示 / 演示视频                  │
│                                         │
│    ┌──────────┐                         │
│    │  人物    │                         │
│    │  左下角  │                         │
│    └──────────┘                         │
└─────────────────────────────────────────┘
```

### Mode C: 纯素材

无人物，适合数据展示、概念解释。

### Mode D: 灵活切换

根据内容动态切换以上模式。

---

## 4. B-Roll 触发规则

| 触发类型 | 关键词示例 | 说明 |
|----------|-----------|------|
| **data_cite** | "增长了300%"、"数据显示" | 数字/统计 |
| **example_mention** | "比如"、"例如"、"举个例子" | 举例说明 |
| **comparison** | "对比"、"相比"、"而另一个" | 对比分析 |
| **product_mention** | 产品名称 | 产品展示 |
| **process_description** | "第一步"、"流程是" | 流程演示 |
| **concept_visualization** | 抽象概念 | 概念可视化 |

---

## 5. 快速开始

### 5.1 配置

```bash
# .env
DOUBAO_API_KEY=your_api_key
DOUBAO_MODEL=doubao-1.5-pro-32k
```

### 5.2 基本使用

```python
from app.services.remotion_agent.stage2_structure import analyze_content_structure
from app.services.remotion_agent.broll_trigger import detect_broll_triggers

# 准备输入
segments = [
    {"id": "1", "text": "今天分享三个让你效率翻倍的AI工具", "start_ms": 0, "end_ms": 5000},
]

# 分析结构
result = await analyze_content_structure(segments, content_understanding)

# 检测 B-Roll 触发点
triggers = detect_broll_triggers("根据数据显示，增长了 300%")
```

---

## 6. 核心模块

| 模块 | 文件 | 功能 |
|------|------|------|
| 布局模式 | `layout_modes.py` | 4种布局模式定义和选择 |
| B-Roll 触发 | `broll_trigger.py` | 6种触发类型检测 |
| 结构分析 | `stage2_structure.py` | LLM 驱动的内容分析 |
| 视觉编排 | `stage3_visual.py` | 生成最终视觉配置 |
| 节奏控制 | `pacing.py` | 动画时长和切换频率 |
| 验证器 | `validator.py` | 冲突和规则检查 |

---

## 7. 验证系统

### 7.1 验证规则

| 规则 | 说明 |
|------|------|
| 时间冲突检测 | B-Roll 和 Overlay 不能时间重叠 |
| 时长验证 | 动画时长不超过片段时长 |
| 位置验证 | 组件位置在可视区域内 |
| 风格一致性 | 全局风格统一 |

### 7.2 调用验证

```python
from app.services.remotion_agent.validator import validate_visual_config

errors = validate_visual_config(visual_config)
if errors:
    print("配置有误:", errors)
```

---

## 8. 详细实现参考

完整规范文档请查看归档：
- [REMOTION_AGENT_SPEC.md](archive/REMOTION_AGENT_SPEC.md) - 完整技术规范 (1086行)
- [REMOTION_AGENT_GUIDE.md](archive/REMOTION_AGENT_GUIDE.md) - 使用指南 (338行)
