# Remotion 内容可视化架构设计

## 核心理念

### ❌ 错误的方式：Clip 维度
```
clip1(0-5s) → clip2(5-10s) → clip3(10-15s)
按时间机械切分，与内容无关
```

### ✅ 正确的方式：内容维度
```
主题A(开场引入) → 主题B(核心论点) → 主题C(案例说明) → 主题D(总结升华)
按语义主题切分，每个主题有独立的可视化策略
```

---

## 数据模型设计

### ContentSegment（内容片段）

```typescript
interface ContentSegment {
  id: string;
  
  // 时间范围（从 ASR 推断）
  timeRange: { start: number; end: number };
  
  // 内容结构
  content: {
    rawText: string;           // 原始转写文本
    topic: string;             // 主题标题（AI 生成）
    summary: string;           // 内容摘要（1-2 句话）
    keyPoints: string[];       // 关键要点列表
    keywords: string[];        // 关键词
    sentiment: 'positive' | 'neutral' | 'negative' | 'inspiring';
  };
  
  // 可视化决策（AI 推荐 + 用户可调整）
  visualization: {
    type: VisualizationType;
    config: VisualizationConfig;
  };
  
  // B-Roll 素材（可选，type=broll 时使用）
  broll?: {
    assetId: string;
    url: string;
    source: 'pexels' | 'local' | 'ai-generated';
  };
}
```

### VisualizationType（可视化类型）

```typescript
type VisualizationType = 
  | 'talking-head'      // 纯口播，无叠加
  | 'broll-overlay'     // B-Roll 叠加 + PiP
  | 'text-highlight'    // 关键词/标题动画浮现
  | 'list-animation'    // 要点列表逐条展示
  | 'quote-display'     // 引用/金句展示
  | 'split-screen'      // 分屏：左口播右内容
  | 'fullscreen-text'   // 全屏文字（过渡/强调）
  | 'data-viz'          // 数据可视化（图表）
  | 'icon-animation';   // 图标 + 文字动画
```

### VisualizationConfig（可视化配置）

```typescript
interface VisualizationConfig {
  // 通用配置
  transition: 'fade' | 'slide' | 'zoom' | 'none';
  transitionDuration: number; // ms
  
  // 文字样式
  textStyle?: {
    fontSize: number;
    fontFamily: string;
    color: string;
    backgroundColor?: string;
    position: 'center' | 'bottom' | 'top' | 'left' | 'right';
  };
  
  // 列表动画配置
  listConfig?: {
    animationType: 'fade-in' | 'slide-up' | 'typewriter';
    staggerDelay: number; // 每项间隔 ms
  };
  
  // B-Roll 配置
  brollConfig?: {
    opacity: number;
    pipEnabled: boolean;
    pipPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    pipSize: 'small' | 'medium' | 'large';
  };
}
```

---

## AI 分析流程

### 输入
```json
{
  "transcript": [
    { "text": "大家好，今天我要分享...", "start": 0, "end": 3000 },
    { "text": "第一点，我们需要了解...", "start": 3000, "end": 8000 },
    ...
  ]
}
```

### 输出（AI 内容分析结果）
```json
{
  "title": "如何提高工作效率",
  "segments": [
    {
      "id": "seg-1",
      "timeRange": { "start": 0, "end": 5000 },
      "content": {
        "topic": "开场引入",
        "summary": "介绍视频主题和背景",
        "keyPoints": [],
        "keywords": ["效率", "时间管理"],
        "sentiment": "neutral"
      },
      "visualization": {
        "type": "talking-head",
        "config": {}
      }
    },
    {
      "id": "seg-2",
      "timeRange": { "start": 5000, "end": 20000 },
      "content": {
        "topic": "核心方法论",
        "summary": "三个提高效率的关键方法",
        "keyPoints": [
          "专注单任务，避免多线程",
          "使用番茄工作法",
          "定期复盘总结"
        ],
        "keywords": ["专注", "番茄工作法", "复盘"],
        "sentiment": "inspiring"
      },
      "visualization": {
        "type": "list-animation",
        "config": {
          "listConfig": {
            "animationType": "slide-up",
            "staggerDelay": 800
          }
        }
      }
    },
    {
      "id": "seg-3",
      "timeRange": { "start": 20000, "end": 35000 },
      "content": {
        "topic": "案例说明",
        "summary": "用实际案例说明方法效果",
        "keyPoints": [],
        "keywords": ["案例", "实践"],
        "sentiment": "positive"
      },
      "visualization": {
        "type": "broll-overlay",
        "config": {
          "brollConfig": {
            "pipEnabled": true,
            "pipPosition": "bottom-right",
            "pipSize": "medium"
          }
        }
      }
    }
  ]
}
```

---

## Remotion 组件结构

```
RemotionContentComposition
├── BackgroundLayer (口播视频或 B-Roll)
├── ContentVisualizationLayer
│   ├── TalkingHeadMode (纯口播)
│   ├── BRollOverlayMode (B-Roll + PiP)
│   ├── TextHighlightMode (关键词动画)
│   ├── ListAnimationMode (要点列表)
│   ├── QuoteDisplayMode (金句展示)
│   ├── SplitScreenMode (分屏)
│   └── ...
├── SubtitleLayer (字幕)
└── TransitionLayer (过渡动画)
```

---

## 实现计划

### Phase 1: 基础架构
1. [ ] 定义 ContentSegment 类型
2. [ ] 创建 ContentAnalyzer 服务（后端 AI）
3. [ ] 修改 BRoll API 返回内容维度数据

### Phase 2: Remotion 组件
4. [ ] 创建 ContentComposition 主组件
5. [ ] 实现各种 VisualizationType 子组件
6. [ ] 添加过渡动画

### Phase 3: 前端集成
7. [ ] 修改 WorkflowModal 使用新组件
8. [ ] 添加可视化类型选择 UI
9. [ ] 支持用户调整配置

---

## 关键优势

1. **语义驱动**：不是机械切分，而是理解内容
2. **多样化展示**：不只是 B-Roll，还有文字、列表、图表等
3. **AI 智能推荐**：根据内容自动推荐最佳可视化方式
4. **用户可调**：AI 推荐 + 用户微调
5. **一致性**：同一主题使用统一的视觉风格
