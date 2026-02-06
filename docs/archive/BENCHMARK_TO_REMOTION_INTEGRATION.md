# 标杆视频分析 → Remotion Agent 集成方案

> 将 8 个标杆视频的分析结论转化为 Remotion Agent 的可执行规则和组件配置

---

## 1. 核心发现与 Agent 映射

### 1.1 布局模式 → Remotion 主视频配置

从标杆视频中提炼出 **4 种布局模式**，需要在 Remotion Agent 中实现为 `mainVideo` 配置模式：

| 布局模式 | 标杆视频 | Remotion 配置 | 触发条件 |
|----------|----------|---------------|----------|
| **模式 A**: 人物全屏+画中画B-Roll | 001,002,006,007,008 | `defaultMode: 'fullscreen'` + `broll.pip: true` | 默认/口播为主 |
| **模式 B**: 素材全屏+人物画中画 | 004,005 | `defaultMode: 'pip'` + `canvas.fullscreen: true` | 检测到教学演示/工具操作 |
| **模式 C**: 纯素材无人物 | 003 | `defaultMode: 'hidden'` + `canvas.fullscreen: true` | 纯白板/PPT/干货讲解 |
| **模式 D**: 灵活切换 | 006,007,008 | `dynamicMode: true` + 切换规则 | 长视频(>4分钟) |

### 1.2 新增 Remotion 配置字段

```typescript
interface MainVideoConfig {
  // 现有字段
  defaultMode: 'fullscreen' | 'pip' | 'hidden';
  
  // ========== 新增: 基于标杆分析 ==========
  
  // 动态模式切换 (长视频场景)
  dynamicMode?: boolean;
  modeTransitions?: Array<{
    atMs: number;
    toMode: 'fullscreen' | 'pip' | 'hidden';
    pipConfig?: PipConfig;
  }>;
  
  // 人物画中画配置 (模式B/D)
  pip: {
    position: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left';
    size: 'small' | 'medium' | 'large';  // 20% | 25% | 30%
    shape: 'rectangle' | 'circle';       // 新增: 圆形画中画 (008)
    border?: {
      width: number;
      color: string;
      glow?: boolean;  // 发光边框
    };
  };
  
  // B-Roll 画中画配置 (模式A)
  brollPip?: {
    enabled: boolean;
    position: 'bottom-center' | 'bottom-left' | 'bottom-right';
    size: 'small' | 'medium' | 'large';  // 20% | 25% | 30%
    keepPersonVisible: boolean;  // 是否保留人物 (默认 true)
  };
}
```

---

## 2. B-Roll 触发规则 → Agent Stage 2 增强

### 2.1 从标杆视频提炼的 B-Roll 触发模式

| 触发类型 | 口播特征 | B-Roll 类型 | 插入方式 | 时长 |
|----------|----------|-------------|----------|------|
| **人物触发** | 提到人名 (马斯克/Karpathy) | 该人物画面/访谈截图 | 画中画 | 3-5s |
| **产品触发** | 提到产品名 (AlphaGo/Claude) | 产品Logo/演示画面 | 画中画 | 2-4s |
| **概念触发** | 抽象概念 (AI/指数增长) | 可视化动画/图表 | 画中画 | 3-6s |
| **场景触发** | 场景描述 (机器人手术) | 场景实拍/概念动画 | 画中画/全屏 | 4-8s |
| **演示触发** | 工具操作/教学 | 屏幕录制界面 | 全屏+人物画中画 | 10-40s |
| **数据触发** | 数据/论点展示 | PPT/文字逻辑图 | 全屏+人物画中画 | 5-20s |

### 2.2 Stage 2 结构分析增强

```typescript
interface StructuredSegment {
  // ... 现有字段 ...
  
  structure: {
    // ... 现有字段 ...
    
    // ========== 新增: B-Roll 触发分析 ==========
    brollTrigger?: {
      type: 'person' | 'product' | 'concept' | 'scene' | 'demo' | 'data';
      
      // 触发关键词 (用于素材搜索)
      keywords: string[];
      
      // 推荐的插入方式
      insertMode: 'pip-over-person' | 'fullscreen-replace' | 'person-pip-over-content';
      
      // 推荐时长
      suggestedDuration: {
        min: number;  // ms
        max: number;  // ms
      };
      
      // 是否保留人物可见
      keepPersonVisible: boolean;
    };
  };
}
```

### 2.3 B-Roll 触发识别 Prompt

```markdown
## B-Roll 触发识别规则

当分析每个片段时，检查是否包含以下触发模式：

### 1. 人物触发
- 关键词: "马斯克说", "Karpathy认为", "XXX表示"
- 搜索词: 人名 + interview/portrait/speaking
- 插入方式: pip-over-person
- 时长: 3-5秒

### 2. 产品/品牌触发
- 关键词: "用Claude", "在AlphaGo中", "ChatGPT能够"
- 搜索词: 产品名 + logo/demo/interface
- 插入方式: pip-over-person
- 时长: 2-4秒

### 3. 概念可视化触发
- 关键词: "指数增长", "AI的本质", "技术平权"
- 搜索词: 概念相关的视觉化关键词
- 插入方式: pip-over-person
- 时长: 3-6秒

### 4. 场景描述触发
- 关键词: "机器人手术", "在工厂里", "海边别墅"
- 搜索词: 场景关键词
- 插入方式: pip-over-person 或 fullscreen-replace
- 时长: 4-8秒

### 5. 演示/教学触发
- 关键词: "我来演示一下", "打开这个工具", "操作步骤是"
- 插入方式: person-pip-over-content (人物缩小到角落)
- 时长: 10-40秒 (随演示内容)

### 6. 数据/论点触发
- 关键词: "从数据来看", "这里有三个要点", "对比一下"
- 插入方式: person-pip-over-content
- 时长: 5-20秒
```

---

## 3. 视觉组件规范 → 基于标杆视频校准

### 3.1 字幕组件 (Subtitles)

**从标杆视频提炼的字幕规范:**

```typescript
interface SubtitleConfig {
  // 位置 (统计: 7/8 使用中央偏下)
  position: 'center' | 'center-bottom' | 'bottom';
  verticalOffset: number;  // 50-70% of frame height
  
  // 样式 (统计: 白字黑边最常见)
  style: {
    color: 'white' | 'yellow';  // 白色(主流) / 黄色(PPT型)
    stroke: {
      color: 'black';
      width: 2-3;  // px
    };
    fontSize: 'medium' | 'large';  // 画面高度 4-5%
    fontFamily: 'sans-serif-bold';
  };
  
  // 高亮 (6/8 视频使用高亮)
  highlight: {
    enabled: boolean;
    color: 'yellow' | 'blue';  // 黄色更常见
    style: 'background' | 'glow' | 'underline';
  };
  
  // 行数限制
  maxLines: 2;
  
  // 对齐
  textAlign: 'center';
}
```

### 3.2 关键词卡片 (KeywordCard)

**从标杆视频提炼的样式变体:**

```typescript
type KeywordCardVariant = 
  | 'dark-solid'      // 007: 黑色纯色块 + 白/黄字 (左上角)
  | 'light-solid'     // 003,004,005: 白色块 + 黑字 (中央)
  | 'semi-transparent'// 001,006,008: 半透明 + 白字
  | 'gradient'        // 006: 品牌渐变
  | 'numbered';       // 007,008: 带数字编号 "1 客户沟通..."

interface KeywordCardConfig {
  variant: KeywordCardVariant;
  
  // 位置 (根据变体不同)
  position: 'center' | 'top-left' | 'bottom-left' | 'top-right';
  
  // 内容
  content: {
    number?: number;     // 编号 (numbered 变体)
    icon?: string;       // emoji 或 icon
    title?: string;      // 标题
    text: string;        // 主文本
  };
  
  // 动画
  animation: {
    enter: 'fade' | 'slide-in' | 'pop' | 'bounce';
    duration: number;
  };
}
```

**使用规则:**
```
- 出现专业术语/核心概念 → 使用 'semi-transparent' 居中
- 列表型内容 (1,2,3...) → 使用 'numbered' 或 'dark-solid' 左上角
- PPT/白板型视频 → 使用 'light-solid' 居中
```

### 3.3 画中画组件 (PictureInPicture)

**标杆视频中的画中画位置统计:**

```
位置分布:
- 下方中央 (bottom-center): 001,002,004,006,007 → 最常见
- 右下角 (bottom-right): 005
- 右上角圆形 (top-right-circle): 008

占比分布:
- 20%: 005,007 → 小尺寸
- 25%-30%: 001,002,004,006,008 → 中等尺寸

形状:
- 矩形 (rectangle): 001-007
- 圆形 (circle): 008
```

```typescript
interface PipConfig {
  // 人物画中画 (当素材全屏时)
  person: {
    position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right-circle';
    size: number;  // 20-30%
    shape: 'rectangle' | 'circle';
    border?: {
      width: 2;
      color: 'white' | 'brand';
    };
  };
  
  // B-Roll 画中画 (当人物全屏时)
  broll: {
    position: 'bottom-center' | 'bottom-left' | 'bottom-right';
    size: number;  // 25-35%
    shape: 'rectangle';  // B-Roll 通常是矩形
  };
}
```

---

## 4. 节奏控制规则 → Stage 3 增强

### 4.1 从标杆视频提炼的节奏规律

```
视频时长 → 推荐镜头时长:
- 短视频 (1-2分钟): 平均 3-6 秒/镜头
- 中等视频 (2-5分钟): 平均 4-10 秒/镜头  
- 长视频 (5分钟+): 平均 2-6 秒/镜头 (更快切换维持注意力)
- 白板/PPT型: 平均 20-40 秒/镜头 (内容驱动)

分段节奏:
- 开场 Hook (0-10s): 快节奏，争议观点/数据/问题
- 核心讲解: 中快节奏，配合 B-Roll
- 深度展开: 中节奏，案例/演示
- 结尾 CTA: 中慢节奏，引导关注
```

### 4.2 Stage 3 节奏编排规则

```typescript
interface PacingConfig {
  // 视频总时长
  totalDuration: number;  // ms
  
  // 根据时长自动计算
  autoConfig: {
    // 平均镜头时长 (ms)
    avgShotDuration: number;
    
    // 最小/最大镜头时长
    minShotDuration: number;
    maxShotDuration: number;
    
    // 视觉元素间隔
    elementGap: number;  // 默认 500ms
  };
  
  // 分段节奏配置
  segmentPacing: {
    hook: {
      shotDuration: 'fast';      // 2-4s
      transitionSpeed: 'quick';
    };
    body: {
      shotDuration: 'medium';    // 4-8s
      transitionSpeed: 'normal';
    };
    cta: {
      shotDuration: 'slow';      // 6-10s
      transitionSpeed: 'smooth';
    };
  };
  
  // 模版特殊规则
  templateOverrides?: {
    whiteboard: {
      avgShotDuration: 25000;  // 白板型更长
    };
    screencast: {
      avgShotDuration: 15000;  // 演示型较长
    };
  };
}
```

---

## 5. 模版系统增强

### 5.1 基于标杆视频重新定义模版参数

原有的 6 大模版需要根据标杆视频分析结果进行参数校准：

#### Mixed Media (混合媒体) - 001,002,006,007,008

```typescript
const MIXED_MEDIA_TEMPLATE: TemplateConfig = {
  id: 'mixed-media',
  name: '混合媒体',
  
  // 布局默认配置
  layout: {
    defaultMode: 'fullscreen',
    
    // 人物配置
    person: {
      defaultSize: 70,  // 70% (来自标杆分析)
      position: 'center',
    },
    
    // B-Roll 画中画配置
    brollPip: {
      enabled: true,
      position: 'bottom-center',
      size: 30,  // 30%
      keepPersonVisible: true,
    },
    
    // 长视频动态切换
    dynamicSwitch: {
      enableAfterMs: 240000,  // 4分钟后启用
      personPipSize: 25,
      personPipPosition: 'bottom-center',
    },
  },
  
  // 字幕配置
  subtitles: {
    position: 'center-bottom',
    style: 'white-stroke',
    highlight: {
      enabled: true,
      color: 'yellow',  // 标杆视频中黄色高亮更常见
    },
  },
  
  // 节奏配置
  pacing: {
    avgShotDuration: 5000,  // 5秒
    range: [3000, 8000],
  },
  
  // 关键词卡片
  keywordCard: {
    variant: 'semi-transparent',
    position: 'center',
    animation: 'pop',
  },
};
```

#### Whiteboard (白板讲解) - 003

```typescript
const WHITEBOARD_TEMPLATE: TemplateConfig = {
  id: 'whiteboard',
  name: '白板讲解',
  
  layout: {
    defaultMode: 'hidden',  // 无人物
    
    canvas: {
      fullscreen: true,
      background: 'white',
      style: 'paper',  // 纸张纹理
    },
  },
  
  subtitles: {
    position: 'bottom',
    style: 'yellow',  // 白板型用黄色字幕
    highlight: {
      enabled: false,
    },
  },
  
  pacing: {
    avgShotDuration: 33000,  // 33秒 (内容驱动)
    range: [20000, 45000],
  },
  
  keywordCard: {
    variant: 'light-solid',  // 白底黑字
    position: 'center',
    animation: 'fade',
    // 多色文字支持 (红/绿区分重点)
    multiColor: true,
  },
};
```

#### Screencast (屏录教程) - 004,005

```typescript
const SCREENCAST_TEMPLATE: TemplateConfig = {
  id: 'screencast',
  name: '屏录教程',
  
  layout: {
    defaultMode: 'pip',  // 人物默认画中画
    
    person: {
      defaultSize: 25,  // 20-30%
      position: 'bottom-center',  // 004
      // 或 'bottom-right',  // 005
    },
    
    canvas: {
      fullscreen: true,
      // 素材占主体
    },
  },
  
  subtitles: {
    position: 'center-bottom',
    style: 'white',
    highlight: {
      enabled: true,
      color: 'yellow',
    },
  },
  
  pacing: {
    avgShotDuration: 10000,  // 10秒
    range: [5000, 20000],
  },
};
```

---

## 6. RAG 知识库构建

### 6.1 将标杆分析结果转化为 RAG 知识条目

每个视频的分析结果应该被结构化存储，供 Agent 在生成时检索参考：

```typescript
interface BenchmarkKnowledge {
  id: string;  // "benchmark_001"
  
  // 元数据
  metadata: {
    videoId: string;
    duration: string;
    templateType: string;
    source?: string;  // 原视频来源
  };
  
  // 布局知识
  layout: {
    mode: string;
    personRatio: number;
    personPosition: string;
    pipRatio?: number;
    pipPosition?: string;
  };
  
  // 视觉元素知识
  visualElements: {
    subtitleStyle: object;
    keywordCardStyle: object;
    brollStyle: object;
  };
  
  // B-Roll 案例库
  brollExamples: Array<{
    trigger: string;       // "机器人手术"
    content: string;       // "机器人手术场景"
    type: string;          // "概念动画"
    duration: number;      // 4000ms
    insertMode: string;    // "pip-over-person"
  }>;
  
  // 节奏参数
  pacing: {
    avgShotDuration: number;
    totalCuts: number;
    rhythm: string;
  };
}
```

### 6.2 知识检索策略

```markdown
## Agent 决策时的知识检索流程

1. **模版匹配**
   - 根据 Stage 1 分析的 category 和 tone
   - 检索匹配模版的标杆视频
   - 获取布局参数参考

2. **B-Roll 触发匹配**
   - 根据口播内容关键词
   - 检索相似的 B-Roll 案例
   - 参考插入方式和时长

3. **节奏参考**
   - 根据视频总时长
   - 检索相近时长的标杆视频
   - 参考镜头切换频率

4. **样式参考**
   - 根据 tone (educational/casual/...)
   - 检索匹配风格的标杆视频
   - 参考字幕/卡片样式
```

---

## 7. 超越标杆的增强点

### 7.1 标杆视频的局限

从分析中发现标杆视频存在的可改进点：

| 局限 | 表现 | 我们的优化方案 |
|------|------|----------------|
| B-Roll 获取耗时 | 需要人工搜索素材 | AI 自动匹配 Pexels + 生成式素材 |
| 关键词高亮手动 | 需要后期逐字添加 | 自动识别并高亮关键词 |
| 画中画位置固定 | 大多在下方中央 | 智能避开字幕/重要内容 |
| 缺乏进度指示 | 多点内容难以追踪 | 自动添加 "1/5" 进度指示 |
| 转场单一 | 多数使用直切 | 根据内容类型智能选择转场 |

### 7.2 Remotion Agent 增强特性

```typescript
// 增强特性配置
interface EnhancedFeatures {
  // 1. 智能避让
  smartPositioning: {
    enabled: true;
    avoidSubtitles: true;
    avoidKeywords: true;
    // 动态调整 PiP 位置避开遮挡
  };
  
  // 2. 自动进度指示
  progressIndicator: {
    enabled: true;
    style: 'numbered';  // "2/5"
    position: 'top-left';
    showOnListItems: true;
  };
  
  // 3. 智能转场
  smartTransitions: {
    enabled: true;
    rules: {
      'hook-to-body': 'zoom-out',
      'point-to-point': 'fade',
      'body-to-cta': 'slide-up',
      'broll-insert': 'cut',  // B-Roll 保持直切
    };
  };
  
  // 4. 关键词自动高亮
  autoKeywordHighlight: {
    enabled: true;
    detectFromStructure: true;  // 从 Stage 2 结构中提取
    highlightColor: 'yellow';
    animation: 'glow';
  };
  
  // 5. 节奏自适应
  adaptivePacing: {
    enabled: true;
    // 检测到密集内容时自动加快切换
    // 检测到重点内容时适当延长展示
  };
  
  // 6. 多语言字幕支持
  multilangSubtitles: {
    enabled: true;
    detectLanguage: true;
    // 中文用黄色高亮，英文用蓝色
  };
}
```

---

## 8. 实施路线图

### Phase 1: 基础对齐 (Week 1-2)
- [ ] 更新 `mainVideo` 配置支持 4 种布局模式
- [ ] 实现动态模式切换逻辑
- [ ] 校准字幕组件参数 (白字黑边/黄色高亮)
- [ ] 实现标准 PiP 位置和尺寸

### Phase 2: B-Roll 增强 (Week 2-3)
- [ ] 更新 Stage 2 添加 `brollTrigger` 分析
- [ ] 实现 6 种触发类型的识别规则
- [ ] 集成 Pexels API 自动搜索
- [ ] 实现画中画 B-Roll 组件

### Phase 3: 模版系统 (Week 3-4)
- [ ] 更新 3 个核心模版参数 (mixed-media, whiteboard, screencast)
- [ ] 实现模版参数自动应用
- [ ] 构建 RAG 知识库
- [ ] 实现知识检索逻辑

### Phase 4: 增强特性 (Week 4-5)
- [ ] 实现智能避让算法
- [ ] 实现自动进度指示
- [ ] 实现智能转场选择
- [ ] 实现关键词自动高亮

### Phase 5: 验证与优化 (Week 5-6)
- [ ] 使用标杆视频口播内容测试生成效果
- [ ] 对比生成结果与原视频
- [ ] 收集反馈并优化参数
- [ ] 编写最佳实践文档

---

## 9. 验证标准

### 9.1 与标杆视频的对比 Checklist

```markdown
## 生成视频 vs 标杆视频对比

### 布局一致性
- [ ] 人物占比接近目标 (±5%)
- [ ] 画中画位置正确
- [ ] 画中画尺寸接近目标 (±3%)

### 视觉元素
- [ ] 字幕样式一致 (白字黑边/高亮)
- [ ] 关键词卡片样式匹配
- [ ] B-Roll 插入时机合理

### 节奏
- [ ] 平均镜头时长在合理范围
- [ ] 开场/主体/结尾节奏差异化
- [ ] 视觉元素切换流畅

### 增强效果
- [ ] 进度指示清晰
- [ ] 元素无遮挡
- [ ] 转场自然
```

### 9.2 量化指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 布局准确率 | >95% | 对比生成配置与模版参数 |
| B-Roll 触发识别率 | >85% | 人工标注对比 |
| 视觉元素覆盖率 | >90% | 关键内容是否有视觉增强 |
| 用户满意度 | >4.0/5.0 | 用户评分 |

---

*最后更新: 2026-01-31*
