# AI 视觉处理系统

> 合并自：AI_VISUAL_STUDIO_DESIGN / VISUAL_EDITOR_DESIGN / SHOT_SEGMENTATION_DESIGN / ENHANCEMENT_FEATURE_DESIGN / IMAGE_EDITING_INPAINTING
> 
> 本文档涵盖分镜策略、背景替换、图像编辑、增强生成等 AI 视觉处理功能。

---

## 1. 系统概览

### 1.1 用户旅程

```
上传视频 → AI 分析分镜 → 逐镜定制（背景/B-Roll）→ 进入编辑器精调 → 导出
```

### 1.2 核心页面

| 页面 | 路由 | 定位 | 核心功能 |
|------|------|------|----------|
| **AI 视觉工作室** | Modal in Editor | 分镜分析 + 背景定制 | AI 分析、逐镜配置、批量应用 |
| **视觉编辑器** | `/visual-editor` | 分镜设计 + 画布交互 | Fabric.js 画布、图层管理 |
| **视频编辑器** | `/editor` | 时间线剪辑 | 轨道编辑、字幕、导出 |

---

## 2. 分镜策略（Shot Segmentation）

### 2.1 三种分镜模式

| 策略 | 说明 | 适用场景 | 预期分镜数 |
|------|------|----------|-----------|
| **场景分镜** | 基于视觉变化检测镜头切换 | 多镜头素材、场景变化丰富 | 少 (3-10) |
| **分句分镜** | 基于 ASR 断句，每句一镜 | 口播清晰、节奏明快 | 多 (10-30) |
| **段落分镜** | 基于语义分析，按话题划分 | 内容有章节结构 | 中等 (5-15) |

### 2.2 场景检测实现

```python
from scenedetect import detect, AdaptiveDetector, ContentDetector

# ContentDetector - 基于内容变化检测硬切
# AdaptiveDetector - 两遍自适应检测（处理快速镜头）
# ThresholdDetector - 基于亮度阈值（淡入淡出）
```

### 2.3 数据流

```
Asset → Shot Segmentation Agent → Shots 数据 → Visual Editor
```

---

## 3. AI 视觉工作室（背景定制）

### 3.1 交互状态

| 状态 | 说明 |
|------|------|
| **未分析** | 显示「开始 AI 分析」按钮 |
| **分析中** | 进度条，识别分镜、检测人物 |
| **分析完成** | 展示分镜列表，逐镜定制背景 |

### 3.2 分镜定制选项

```
┌──────────────────────────────────────────────┐
│  当前：分镜 #3 (0:28-0:45)                   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ [保持原始] [自定义背景]               │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  🎨 背景生成：输入提示词                      │
│  ┌──────────────────────────────────────┐   │
│  │ 夏日海滩，金色阳光...                  │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  [🔄 生成背景]  [✓ 应用到当前分镜]           │
└──────────────────────────────────────────────┘
```

---

## 4. 图像编辑 / Inpainting

### 4.1 功能支持

| 功能 | 说明 |
|------|------|
| **局部替换** | 用户绘制 mask → 替换指定区域 |
| **风格迁移** | 无 mask 时进行整体风格变换 |
| **两步工作流** | 先生成预览 → 用户确认后应用 |

### 4.2 架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   前端 UI       │     │   Backend API    │     │   Kling AI      │
│                 │     │                  │     │                 │
│ DrawingCanvas   │────▶│ /preview         │────▶│ omni-image API  │
│ (mask 绘制)     │     │                  │     │                 │
│                 │     │ /tasks/{id}/apply│     │                 │
│ PreviewDialog   │◀────│                  │◀────│                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### 4.3 API 接口

```typescript
// POST /api/ai-capabilities/preview
{
  capability_type: 'background-replace',
  clip_id: 'clip-xxx',
  prompt: '夏日海滩，金色阳光',
  keyframe_url: 'https://...',
  mask_data_url: 'data:image/png;base64,...'
}

// POST /api/ai-capabilities/tasks/{id}/apply
// 确认应用到 clip
```

---

## 5. AI 增强功能（Regenerate / Refine）

### 5.1 核心理念：迭代式生成

```
第一次生成 → 不满意 → 调整参数 → 重新生成 → ... → 满意 → 确认
```

### 5.2 支持的操作

| 操作 | 说明 |
|------|------|
| **重新生成** | 保持同样参数，换随机种子 |
| **相似生成** | 基于上一次结果做 variation |
| **修改 prompt** | 调整描述后重新生成 |
| **修改 mask** | 重新涂抹修改区域 |
| **历史版本** | 对比多个版本，选择最满意的 |

### 5.3 细粒度优化流程

```
Step 1: 分离人物与背景
  原图 → 人物(抠图) + 背景(去人)

Step 2: 单独优化背景
  背景 → 新背景 (prompt: 海边日落...)

Step 3: 合成最终图
  人物 + 新背景 → 最终合成图
```

---

## 6. 数据模型

### 6.1 Shot（分镜）

```typescript
interface Shot {
  id: string;
  startTime: number;
  endTime: number;
  keyframeUrl: string;
  backgroundConfig?: {
    type: 'original' | 'custom';
    prompt?: string;
    generatedUrl?: string;
  };
}
```

### 6.2 AI 任务

```typescript
interface AITask {
  id: string;
  capability_type: 'background-replace' | 'inpainting' | 'enhancement';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  prompt: string;
  keyframe_url: string;
  mask_data_url?: string;
  result_url?: string;
  seed?: number;
  history: TaskVersion[];  // 历史版本
}
```

---

## 7. 详细实现参考

完整设计文档请查看归档：
- [AI_VISUAL_STUDIO_DESIGN.md](archive/AI_VISUAL_STUDIO_DESIGN.md)
- [VISUAL_EDITOR_DESIGN.md](archive/VISUAL_EDITOR_DESIGN.md)
- [SHOT_SEGMENTATION_DESIGN.md](archive/SHOT_SEGMENTATION_DESIGN.md)
- [ENHANCEMENT_FEATURE_DESIGN.md](archive/ENHANCEMENT_FEATURE_DESIGN.md)
- [IMAGE_EDITING_INPAINTING.md](archive/IMAGE_EDITING_INPAINTING.md)
