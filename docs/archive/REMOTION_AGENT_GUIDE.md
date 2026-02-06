# Remotion Agent 使用指南

> 口播脚本到视觉配置的自动化生成系统

---

## 📖 概述

Remotion Agent 是一个智能视觉配置生成系统，能够将口播脚本自动转换为高质量的视频视觉配置。系统基于 8 个标杆视频的分析结论，实现了：

- **4 种布局模式**: 人物全屏、素材全屏、纯素材、灵活切换
- **6 种 B-Roll 触发类型**: 数据引用、示例提及、对比、产品提及、流程描述、概念可视化
- **智能节奏控制**: 根据内容类型自动调整动画时长和切换频率
- **完整验证系统**: 冲突检测、时长验证、位置验证

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
# .env
DOUBAO_API_KEY=your_api_key
DOUBAO_MODEL=doubao-1.5-pro-32k
```

### 3. 基本使用

```python
import asyncio
from app.services.remotion_agent.stage2_structure import analyze_content_structure
from app.services.remotion_agent.broll_trigger import detect_broll_triggers

# 准备输入
segments = [
    {"id": "1", "text": "今天分享三个让你效率翻倍的AI工具", "start_ms": 0, "end_ms": 5000},
    {"id": "2", "text": "第一个是Cursor，它可以帮你写代码", "start_ms": 5000, "end_ms": 10000},
    # ...
]

# 分析结构
result = asyncio.run(analyze_content_structure(
    segments=segments,
    content_understanding={"topic": "AI工具推荐", "category": "knowledge"}
))

# 检测 B-Roll 触发点
triggers = detect_broll_triggers("根据数据显示，增长了 300%")
print(triggers)  # [BrollTrigger(type=data_cite, ...)]
```

---

## 🏗️ 系统架构

### 三阶段处理流程

```
Stage 1: 内容理解
    ↓
Stage 2: 结构分析
    ↓
Stage 3: 视觉编排
```

### 核心模块

| 模块 | 文件 | 功能 |
|------|------|------|
| 布局模式 | `layout_modes.py` | 4种布局模式定义和选择 |
| B-Roll 触发 | `broll_trigger.py` | 6种触发类型检测 |
| 结构分析 | `stage2_structure.py` | LLM 驱动的内容分析 |
| 视觉编排 | `stage3_visual.py` | 生成最终视觉配置 |
| 节奏控制 | `pacing.py` | 动画时长和切换频率 |
| 验证器 | `validator.py` | 冲突和规则检查 |
| 缓存 | `cache.py` | 性能优化缓存 |

---

## 🎨 布局模式

### Mode A: 人物全屏 + B-Roll 画中画 (默认)

最常见的布局，适用于观点、故事类内容。

```
┌─────────────────────────────────────────┐
│                                         │
│      【人物区域 70%】                     │
│       全屏居中口播                        │
│                                         │
│    ┌─────────────────────┐              │
│    │   B-Roll 画中画 30%   │              │
│    └─────────────────────┘              │
│  ════════ 字幕区域 ════════              │
└─────────────────────────────────────────┘
```

**适用场景**: opinion, story, knowledge

### Mode B: 素材全屏 + 人物画中画

适用于教学演示、产品测评。

```
┌─────────────────────────────────────────┐
│  ┌────────────────────────────────────┐ │
│  │     【素材/演示 70%】                │ │
│  │     全屏展示内容                     │ │
│  └────────────────────────────────────┘ │
│  ┌──────────┐                           │
│  │ 人物 30% │  ════════ 字幕 ════════   │
│  └──────────┘                           │
└─────────────────────────────────────────┘
```

**适用场景**: tutorial, product

### Mode C: 纯素材 (无人物)

适用于白板/PPT 讲解。

```
┌─────────────────────────────────────────┐
│                                         │
│     【PPT / 白板 / 图表 100%】           │
│                                         │
│  ════════ 字幕区域 ════════              │
└─────────────────────────────────────────┘
```

**适用场景**: whiteboard, concept

### Mode D: 灵活切换

动态切换 Mode A ↔ Mode B。

**适用场景**: 长视频、混合内容

---

## 🎯 B-Roll 触发类型

### 1. DATA_CITE (数据引用)
检测数字、百分比、增长率等。

```
"增长了 300%" → BrollTrigger(type=data_cite, importance=high)
"用户数突破 1 亿" → BrollTrigger(type=data_cite, importance=high)
```

### 2. EXAMPLE_MENTION (示例提及)
检测"比如"、"例如"等举例标志。

```
"比如说，AlphaGo..." → BrollTrigger(type=example_mention)
```

### 3. COMPARISON (对比)
检测"相比"、"更"、"胜过"等对比词。

```
"和传统方法相比，效率提升 5 倍" → BrollTrigger(type=comparison)
```

### 4. PRODUCT_MENTION (产品提及)
检测产品、工具、品牌名称。

```
"Cursor 可以帮你写代码" → BrollTrigger(type=product_mention)
```

### 5. PROCESS_DESC (流程描述)
检测"第一步"、"首先"等步骤标志。

```
"第一步，打开设置" → BrollTrigger(type=process_desc)
```

### 6. CONCEPT_VISUAL (概念可视化)
检测抽象概念、技术术语。

```
"AGI 不是会不会到来的问题" → BrollTrigger(type=concept_visual)
```

---

## ⚡ 性能优化

### 缓存机制

系统内置 LRU 缓存，重复检测同一文本时命中缓存：

```python
from app.services.remotion_agent.broll_trigger import (
    detect_broll_triggers,
    clear_trigger_cache
)

# 首次调用 (~3ms)
triggers1 = detect_broll_triggers("增长了 300%")

# 缓存命中 (~0.01ms, 300x 加速)
triggers2 = detect_broll_triggers("增长了 300%")

# 清除缓存
clear_trigger_cache()
```

### 缓存配置

```python
# broll_trigger.py
_CACHE_MAX_SIZE = 200  # 最大缓存条目
```

---

## 🧪 测试

### 运行 E2E 测试

```bash
cd backend
pytest tests/test_remotion_agent_e2e.py -v
```

### 运行标杆对比测试

```bash
# 快速测试 (前3个)
python scripts/test_benchmark_comparison.py --quick

# 测试特定视频
python scripts/test_benchmark_comparison.py --video 001

# 完整测试 (8个标杆)
python scripts/test_benchmark_comparison.py
```

### 测试缓存性能

```bash
python scripts/test_broll_cache.py
```

---

## 📊 测试结果

### E2E 测试 (5 场景)

| 场景 | 结果 |
|------|------|
| 知识型 | ✅ 通过 |
| 教程型 | ✅ 通过 |
| 观点型 | ✅ 通过 |
| 产品型 | ✅ 通过 |
| 故事型 | ✅ 通过 |

### 标杆对比 (8 视频)

| 指标 | 通过率 |
|------|--------|
| 布局模式 | 100% (8/8) |
| B-Roll 触发 | 88% (7/8) |
| 结构分析 | 100% (8/8) |

---

## 🔧 扩展指南

### 添加新的触发规则

```python
# broll_trigger.py

# 1. 在 BrollTriggerType 添加新类型
class BrollTriggerType(str, Enum):
    # ...
    NEW_TYPE = "new_type"

# 2. 创建规则列表
NEW_TYPE_RULES = [
    TriggerRule(
        trigger_type=BrollTriggerType.NEW_TYPE,
        pattern=r'你的正则表达式',
        importance="medium",
        broll_suggestion_template="B-Roll 建议模板"
    ),
]

# 3. 添加到 ALL_TRIGGER_RULES
ALL_TRIGGER_RULES = [
    # ...
    *NEW_TYPE_RULES,
]
```

### 添加新的布局模式

```python
# layout_modes.py

class LayoutMode(str, Enum):
    # ...
    MODE_E = "modeE"

# 添加配置
LAYOUT_MODE_CONFIGS[LayoutMode.MODE_E] = LayoutModeConfig(
    mode=LayoutMode.MODE_E,
    name="新模式",
    description="描述",
    # ...
)
```

---

## 📚 相关文档

- [REMOTION_AGENT_SPEC.md](./REMOTION_AGENT_SPEC.md) - 完整技术规范
- [BENCHMARK_CONCLUSION.md](./BENCHMARK_CONCLUSION.md) - 标杆视频分析
- [REMOTION_AGENT_DEV_PLAN.md](./REMOTION_AGENT_DEV_PLAN.md) - 开发计划

---

*最后更新: 2026-02-01*
