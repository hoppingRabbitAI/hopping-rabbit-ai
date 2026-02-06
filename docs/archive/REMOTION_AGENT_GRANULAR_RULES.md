# Remotion Agent 细粒度规则手册

> 基于 8 个标杆视频分析，转化为可直接执行的 Agent 规则和 Prompt 指令

---

## 1. Stage 2 结构分析 - 细粒度规则

### 1.1 B-Roll 触发识别规则 (BrollTriggerRules)

```python
# backend/app/services/remotion_agent/rules/broll_trigger_rules.py

BROLL_TRIGGER_RULES = {
    # =============== 类型 1: 人物触发 ===============
    "person": {
        "trigger_patterns": [
            r"(马斯克|Elon Musk|马老板)",
            r"(Karpathy|卡帕西|Andrej)",
            r"(黄仁勋|Jensen|老黄)",
            r"(Sam Altman|奥特曼|萨姆)",
            r"(李飞飞|Fei-Fei Li)",
            r"(吴恩达|Andrew Ng)",
            r"(理查德.萨顿|Richard Sutton|萨顿)",
            r"(\w+)说|(\w+)认为|(\w+)表示|(\w+)在访谈中",
        ],
        "broll_search_keywords": "{person_name} interview portrait speaking",
        "insert_mode": "pip-over-person",
        "duration": {"min": 3000, "max": 5000},  # 3-5秒
        "pip_config": {
            "position": "bottom-center",
            "size": 30,  # 30%
            "keep_person_visible": True
        },
        "examples": [
            {"trigger": "马斯克在访谈中说", "broll": "马斯克访谈画面", "duration": 3000},
            {"trigger": "Karpathy认为", "broll": "Karpathy讲座画面", "duration": 4000},
            {"trigger": "理查德·萨顿", "broll": "人物照片+维基百科截图", "duration": 5000},
        ]
    },
    
    # =============== 类型 2: 产品/品牌触发 ===============
    "product": {
        "trigger_patterns": [
            r"(ChatGPT|GPT-4|GPT-5)",
            r"(Claude|Anthropic)",
            r"(Gemini|Google AI)",
            r"(AlphaGo|AlphaFold|DeepMind)",
            r"(Midjourney|DALL-E|Stable Diffusion)",
            r"(Tesla|特斯拉)",
            r"用(\w+)来|在(\w+)里|打开(\w+)",
        ],
        "broll_search_keywords": "{product_name} logo demo interface screenshot",
        "insert_mode": "pip-over-person",
        "duration": {"min": 2000, "max": 4000},  # 2-4秒
        "pip_config": {
            "position": "bottom-center",
            "size": 25,
            "keep_person_visible": True
        },
        "examples": [
            {"trigger": "用Claude来", "broll": "Claude界面截图", "duration": 3000},
            {"trigger": "AlphaGo", "broll": "AlphaGo品牌标识+对战画面", "duration": 4000},
        ]
    },
    
    # =============== 类型 3: 概念触发 ===============
    "concept": {
        "trigger_patterns": [
            r"(指数增长|exponential)",
            r"(AI的本质|人工智能的核心)",
            r"(技术平权|技术民主化)",
            r"(第一性原理|First Principles)",
            r"(MVP|最小可行产品)",
            r"(通用人工智能|AGI)",
            r"(大模型|LLM|语言模型)",
            r"(神经网络|深度学习)",
            r"什么是(\w+)|(\w+)的定义|(\w+)的本质",
        ],
        "broll_search_keywords": "{concept} visualization animation diagram",
        "insert_mode": "pip-over-person",
        "duration": {"min": 3000, "max": 6000},  # 3-6秒
        "pip_config": {
            "position": "bottom-center",
            "size": 30,
            "keep_person_visible": True
        },
        "use_canvas_instead": True,  # 优先使用 Canvas 组件而非 B-Roll 视频
        "canvas_component": "ConceptCard",
        "examples": [
            {"trigger": "MVP:最小可执行产品", "canvas": "ConceptCard", "duration": 5000},
            {"trigger": "指数增长", "broll": "指数曲线动画", "duration": 4000},
        ]
    },
    
    # =============== 类型 4: 场景触发 ===============
    "scene": {
        "trigger_patterns": [
            r"(机器人手术|手术机器人)",
            r"(工厂里|生产线上)",
            r"(办公室|工位上)",
            r"(海边|沙滩|度假)",
            r"(在\w+场景|想象一下\w+)",
            r"(比如说|举个例子|像是)",
        ],
        "broll_search_keywords": "{scene_description} realistic footage",
        "insert_mode": "pip-over-person",  # 短场景用画中画
        "insert_mode_long": "fullscreen-replace",  # 长场景用全屏
        "duration_threshold": 6000,  # 超过6秒用全屏
        "duration": {"min": 4000, "max": 8000},  # 4-8秒
        "pip_config": {
            "position": "bottom-center",
            "size": 35,
            "keep_person_visible": True
        },
        "examples": [
            {"trigger": "机器人开刀", "broll": "机器人手术场景", "duration": 4000},
            {"trigger": "在工厂里", "broll": "工业生产线画面", "duration": 5000},
        ]
    },
    
    # =============== 类型 5: 演示触发 ===============
    "demo": {
        "trigger_patterns": [
            r"(我来演示|让我演示|我们来看)",
            r"(操作步骤|具体操作)",
            r"(打开这个工具|点击这里)",
            r"(屏幕上|界面上)",
            r"(怎么用|如何使用|使用方法)",
        ],
        "insert_mode": "person-pip-over-content",  # 人物缩小到角落
        "duration": {"min": 10000, "max": 40000},  # 10-40秒
        "pip_config": {
            "position": "bottom-right",  # 或 bottom-center
            "size": 25,  # 20-30%
            "keep_person_visible": True
        },
        "layout_switch": {
            "mode": "B",  # 切换到模式B
            "person_ratio": 25,
            "content_ratio": 75
        },
        "examples": [
            {"trigger": "我来演示一下", "layout": "模式B", "duration": 30000},
            {"trigger": "阶跃小伙伴演示", "broll": "工具界面操作", "duration": 35000},
        ]
    },
    
    # =============== 类型 6: 数据/论点触发 ===============
    "data": {
        "trigger_patterns": [
            r"(\d+%|\d+倍|\d+万|\d+亿)",
            r"(数据显示|研究表明|统计数据)",
            r"(有\d+个要点|分为\d+步|包含\d+个)",
            r"(第一|第二|第三|首先|其次|最后)",
            r"(对比一下|比较一下|优缺点)",
            r"(总结|归纳|概括)",
        ],
        "insert_mode": "person-pip-over-content",
        "duration": {"min": 5000, "max": 20000},  # 5-20秒
        "pip_config": {
            "position": "bottom-center",
            "size": 25,
            "keep_person_visible": True
        },
        "use_canvas_instead": True,
        "canvas_component_map": {
            "percentage": "DataNumber",
            "list": "PointListCanvas",
            "comparison": "ComparisonCanvas",
            "process": "ProcessFlowCanvas",
        },
        "examples": [
            {"trigger": "增长了15%", "canvas": "DataNumber", "duration": 4000},
            {"trigger": "有三个要点", "canvas": "PointListCanvas", "duration": 15000},
            {"trigger": "对比一下", "canvas": "ComparisonCanvas", "duration": 10000},
        ]
    },
}
```

### 1.2 B-Roll 触发识别 Prompt

```python
# backend/app/services/remotion_agent/prompts/broll_detection_prompt.py

BROLL_DETECTION_SYSTEM_PROMPT = """
你是一个专业的视频编辑分析师。你的任务是分析口播脚本，识别需要插入 B-Roll 素材的位置。

## 你必须识别的 6 种触发类型:

### 1. 人物触发 (person)
- 识别标志: 提到具体人名，如 "马斯克说"、"Karpathy认为"
- B-Roll 内容: 该人物的访谈画面、照片、演讲
- 展示方式: 画中画，位于下方中央
- 时长: 3-5秒

### 2. 产品/品牌触发 (product)
- 识别标志: 提到产品名，如 "用ChatGPT"、"在Claude里"
- B-Roll 内容: 产品Logo、界面截图、演示动画
- 展示方式: 画中画，位于下方中央
- 时长: 2-4秒

### 3. 概念触发 (concept)
- 识别标志: 抽象概念定义，如 "什么是MVP"、"AI的本质"
- B-Roll 内容: 可视化图表、概念动画
- 展示方式: 画中画 或 Canvas组件(ConceptCard)
- 时长: 3-6秒

### 4. 场景触发 (scene)
- 识别标志: 场景描述，如 "机器人手术"、"在工厂里"
- B-Roll 内容: 场景实拍、概念动画
- 展示方式: 画中画(短) 或 全屏(长)
- 时长: 4-8秒

### 5. 演示触发 (demo)
- 识别标志: 工具操作，如 "我来演示"、"打开这个工具"
- B-Roll 内容: 屏幕录制、操作界面
- 展示方式: 人物缩小到角落，内容全屏
- 时长: 10-40秒

### 6. 数据/论点触发 (data)
- 识别标志: 数据展示，如 "增长15%"、"有三个要点"
- B-Roll 内容: 数据图表、要点列表、对比表
- 展示方式: Canvas组件(DataNumber/PointList/Comparison)
- 时长: 5-20秒

## 输出格式

对每个识别到的触发点，输出:
```json
{
  "trigger_type": "person|product|concept|scene|demo|data",
  "trigger_text": "触发的原文文本",
  "start_position": 文本起始位置,
  "keywords": ["搜索关键词1", "搜索关键词2"],
  "suggested_broll": "推荐的B-Roll内容描述",
  "insert_mode": "pip-over-person|fullscreen-replace|person-pip-over-content",
  "duration_ms": 建议时长,
  "use_canvas": true/false,
  "canvas_component": "如果use_canvas为true，指定组件名"
}
```

## 注意事项
1. 不要过度识别，只标记真正需要视觉增强的位置
2. 避免在同一时间点堆积多个触发
3. 演示类触发优先级最高，一旦触发进入演示模式直到演示结束
4. 优先使用 Canvas 组件而非外部 B-Roll (更可控)
"""

BROLL_DETECTION_USER_PROMPT = """
## 脚本内容

{script_text}

---

请分析上述脚本，识别所有 B-Roll 触发点。按时间顺序输出触发点列表。
"""
```

---

## 2. Stage 3 视觉编排 - 细粒度配置

### 2.1 布局模式配置规范

```typescript
// frontend/src/remotion/config/layout-modes.ts

export const LAYOUT_MODES = {
  // =============== 模式 A: 人物全屏 + B-Roll画中画 ===============
  modeA: {
    id: 'person-fullscreen-broll-pip',
    name: '人物全屏 + B-Roll画中画',
    description: '最常见的口播布局，人物占主体，B-Roll作为补充',
    
    mainVideo: {
      defaultMode: 'fullscreen',
      size: 100,  // 全屏时占100%
    },
    
    brollPip: {
      enabled: true,
      position: 'bottom-center',
      size: 30,  // 占30%
      offsetY: 15,  // 距底部15%
      shape: 'rectangle',
      borderRadius: 12,
      border: {
        width: 2,
        color: 'rgba(255,255,255,0.3)',
      },
      shadow: '0 4px 20px rgba(0,0,0,0.3)',
    },
    
    // 字幕需要避开B-Roll区域
    subtitleAdjustment: {
      whenBrollActive: {
        position: 'above-broll',  // 字幕移到B-Roll上方
        offsetY: -5,
      }
    },
    
    triggerConditions: [
      'default',
      'talking-head',
      'mixed-media',
    ],
    
    benchmarkVideos: ['001', '002', '006', '007', '008'],
  },
  
  // =============== 模式 B: 素材全屏 + 人物画中画 ===============
  modeB: {
    id: 'content-fullscreen-person-pip',
    name: '素材全屏 + 人物画中画',
    description: '教学演示布局，内容占主体，人物缩小到角落',
    
    mainVideo: {
      defaultMode: 'pip',
      size: 25,  // 画中画时占25%
    },
    
    personPip: {
      enabled: true,
      positions: {
        'bottom-center': { x: 50, y: 85, anchorX: 'center', anchorY: 'bottom' },
        'bottom-right': { x: 90, y: 85, anchorX: 'right', anchorY: 'bottom' },
        'bottom-left': { x: 10, y: 85, anchorX: 'left', anchorY: 'bottom' },
      },
      defaultPosition: 'bottom-center',
      size: {
        small: 20,
        medium: 25,
        large: 30,
      },
      defaultSize: 'medium',
      shape: 'rectangle',
      borderRadius: 8,
      border: {
        width: 2,
        color: 'white',
      },
    },
    
    canvas: {
      fullscreen: true,
      padding: { top: 10, bottom: 20, left: 5, right: 5 },  // 留出人物画中画空间
    },
    
    triggerConditions: [
      'demo_mode',  // 演示触发
      'data_mode',  // 数据展示触发
      'screencast',
    ],
    
    benchmarkVideos: ['004', '005'],
  },
  
  // =============== 模式 C: 纯素材无人物 ===============
  modeC: {
    id: 'content-only',
    name: '纯素材',
    description: '纯白板/PPT布局，无人物出现',
    
    mainVideo: {
      defaultMode: 'hidden',
      size: 0,
    },
    
    canvas: {
      fullscreen: true,
      background: {
        type: 'paper',
        color: '#FFFEF5',
        texture: 'paper',
      },
      padding: { top: 5, bottom: 15, left: 5, right: 5 },
    },
    
    subtitles: {
      position: 'bottom',
      style: 'yellow',  // 白板型用黄色字幕
    },
    
    triggerConditions: [
      'whiteboard',
      'ppt',
      'no_camera',
    ],
    
    benchmarkVideos: ['003'],
  },
  
  // =============== 模式 D: 灵活切换 ===============
  modeD: {
    id: 'dynamic-switch',
    name: '灵活切换',
    description: '全屏口播与画中画动态切换',
    
    mainVideo: {
      defaultMode: 'fullscreen',
      dynamicMode: true,
    },
    
    modeTransitions: {
      enabled: true,
      transitionDuration: 500,  // 切换动画时长
      transitionType: 'smooth',  // smooth | cut
    },
    
    // 全屏状态配置
    fullscreenConfig: {
      size: 100,
    },
    
    // 画中画状态配置
    pipConfig: {
      positions: {
        'top-center': { x: 50, y: 15, anchorX: 'center', anchorY: 'top' },
        'top-right-circle': { x: 88, y: 15, anchorX: 'right', anchorY: 'top', shape: 'circle' },
        'bottom-center': { x: 50, y: 85, anchorX: 'center', anchorY: 'bottom' },
      },
      defaultPosition: 'bottom-center',
      sizes: {
        small: 20,
        medium: 25,
        large: 30,
      },
      defaultSize: 'medium',
    },
    
    switchRules: [
      {
        from: 'fullscreen',
        to: 'pip',
        triggers: ['demo_start', 'data_display', 'broll_long'],
        pipPosition: 'bottom-center',
        pipSize: 'medium',
      },
      {
        from: 'pip',
        to: 'fullscreen',
        triggers: ['demo_end', 'data_end', 'opinion_expression'],
      },
    ],
    
    triggerConditions: [
      'long_video',  // 视频时长 > 4分钟
    ],
    
    benchmarkVideos: ['006', '007', '008'],
  },
};
```

### 2.2 画中画位置精确配置

```typescript
// frontend/src/remotion/config/pip-positions.ts

export const PIP_POSITIONS = {
  // =============== 人物画中画位置 (模式B/D) ===============
  person: {
    'bottom-center': {
      x: '50%',
      y: 'calc(100% - 8%)',  // 距底部8%
      transform: 'translateX(-50%)',
      width: '25%',
      aspectRatio: '16/9',
      borderRadius: '8px',
      zIndex: 100,
    },
    'bottom-right': {
      x: 'calc(100% - 3%)',
      y: 'calc(100% - 8%)',
      transform: 'translateX(-100%)',
      width: '20%',
      aspectRatio: '16/9',
      borderRadius: '8px',
      zIndex: 100,
    },
    'bottom-left': {
      x: '3%',
      y: 'calc(100% - 8%)',
      width: '20%',
      aspectRatio: '16/9',
      borderRadius: '8px',
      zIndex: 100,
    },
    'top-center': {
      x: '50%',
      y: '8%',
      transform: 'translateX(-50%)',
      width: '25%',
      aspectRatio: '16/9',
      borderRadius: '8px',
      zIndex: 100,
    },
    'top-right-circle': {
      x: 'calc(100% - 5%)',
      y: '8%',
      transform: 'translateX(-100%)',
      width: '22%',
      aspectRatio: '1/1',
      borderRadius: '50%',  // 圆形
      border: '3px solid white',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      zIndex: 100,
    },
  },
  
  // =============== B-Roll画中画位置 (模式A) ===============
  broll: {
    'bottom-center': {
      x: '50%',
      y: 'calc(100% - 18%)',  // 需要在字幕上方
      transform: 'translateX(-50%)',
      width: '30%',
      aspectRatio: '16/9',
      borderRadius: '12px',
      border: '2px solid rgba(255,255,255,0.3)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      zIndex: 50,
    },
    'bottom-left': {
      x: '5%',
      y: 'calc(100% - 18%)',
      width: '28%',
      aspectRatio: '16/9',
      borderRadius: '12px',
      zIndex: 50,
    },
    'bottom-right': {
      x: 'calc(100% - 5%)',
      y: 'calc(100% - 18%)',
      transform: 'translateX(-100%)',
      width: '28%',
      aspectRatio: '16/9',
      borderRadius: '12px',
      zIndex: 50,
    },
  },
};

// 尺寸映射
export const PIP_SIZES = {
  person: {
    small: '18%',   // 18-20%
    medium: '25%',  // 25%
    large: '30%',   // 30%
  },
  broll: {
    small: '25%',
    medium: '30%',
    large: '35%',
  },
};
```

### 2.3 字幕样式精确配置

```typescript
// frontend/src/remotion/config/subtitle-styles.ts

export const SUBTITLE_STYLES = {
  // =============== 标准白字黑边 (最常见) ===============
  'white-stroke': {
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontWeight: 700,
    fontSize: 'clamp(24px, 4.5vh, 48px)',  // 响应式字号
    color: '#FFFFFF',
    textShadow: `
      -2px -2px 0 #000,
       2px -2px 0 #000,
      -2px  2px 0 #000,
       2px  2px 0 #000,
       0    3px 6px rgba(0,0,0,0.5)
    `,
    textAlign: 'center',
    lineHeight: 1.4,
    maxWidth: '85%',
    margin: '0 auto',
    padding: '8px 16px',
  },
  
  // =============== 黄色字幕 (白板/PPT型) ===============
  'yellow': {
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontWeight: 700,
    fontSize: 'clamp(22px, 4vh, 44px)',
    color: '#FFD700',
    textShadow: `
      -2px -2px 0 #000,
       2px -2px 0 #000,
      -2px  2px 0 #000,
       2px  2px 0 #000
    `,
    textAlign: 'center',
    lineHeight: 1.4,
  },
  
  // =============== 带高亮的字幕 ===============
  'white-with-highlight': {
    base: {
      fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
      fontWeight: 700,
      fontSize: 'clamp(24px, 4.5vh, 48px)',
      color: '#FFFFFF',
      textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000',
    },
    highlight: {
      yellow: {
        color: '#FFD700',
        textShadow: '0 0 10px rgba(255, 215, 0, 0.5)',
      },
      blue: {
        color: '#00BFFF',
        textShadow: '0 0 10px rgba(0, 191, 255, 0.5)',
      },
    },
  },
};

// 字幕位置配置
export const SUBTITLE_POSITIONS = {
  'center': {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  },
  'center-bottom': {
    position: 'absolute',
    top: '60%',  // 垂直60%位置
    left: '50%',
    transform: 'translateX(-50%)',
  },
  'bottom': {
    position: 'absolute',
    bottom: '8%',
    left: '50%',
    transform: 'translateX(-50%)',
  },
  'above-broll': {
    position: 'absolute',
    bottom: '38%',  // B-Roll上方
    left: '50%',
    transform: 'translateX(-50%)',
  },
};
```

### 2.4 关键词卡片变体配置

```typescript
// frontend/src/remotion/config/keyword-card-variants.ts

export const KEYWORD_CARD_VARIANTS = {
  // =============== 变体1: 深色实心 (007) ===============
  'dark-solid': {
    container: {
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      borderRadius: '8px',
      padding: '16px 24px',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
    },
    text: {
      color: '#FFFFFF',
      fontWeight: 700,
      fontSize: '24px',
    },
    number: {
      color: '#FFD700',  // 黄色数字
      fontWeight: 800,
      fontSize: '28px',
      marginRight: '12px',
    },
    position: 'top-left',
    animation: {
      enter: 'slideInLeft',
      duration: 300,
    },
    useCase: '列表型内容，左上角固定',
  },
  
  // =============== 变体2: 浅色实心 (003,004,005) ===============
  'light-solid': {
    container: {
      backgroundColor: '#FFFFFF',
      borderRadius: '12px',
      padding: '20px 32px',
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)',
    },
    text: {
      color: '#333333',
      fontWeight: 600,
      fontSize: '28px',
    },
    // 支持多色文字 (红/绿区分)
    multiColor: {
      positive: '#4CAF50',  // 绿色-正面
      negative: '#E53935',  // 红色-负面
      highlight: '#FF9800', // 橙色-高亮
    },
    position: 'center',
    animation: {
      enter: 'fadeIn',
      duration: 400,
    },
    useCase: 'PPT/白板型，中央展示',
  },
  
  // =============== 变体3: 半透明 (001,006,008) ===============
  'semi-transparent': {
    container: {
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(10px)',
      borderRadius: '12px',
      padding: '16px 28px',
      border: '1px solid rgba(255, 255, 255, 0.1)',
    },
    text: {
      color: '#FFFFFF',
      fontWeight: 600,
      fontSize: '26px',
    },
    position: 'center',
    animation: {
      enter: 'pop',
      duration: 250,
    },
    useCase: '口播型，临时弹出',
  },
  
  // =============== 变体4: 品牌渐变 (006) ===============
  'gradient': {
    container: {
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      borderRadius: '16px',
      padding: '20px 36px',
      boxShadow: '0 8px 32px rgba(102, 126, 234, 0.4)',
    },
    text: {
      color: '#FFFFFF',
      fontWeight: 700,
      fontSize: '28px',
      textShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
    },
    icon: {
      size: '32px',
      marginRight: '12px',
    },
    position: 'center',
    animation: {
      enter: 'bounceIn',
      duration: 400,
    },
    useCase: '品牌/产品介绍',
  },
  
  // =============== 变体5: 编号列表 (007,008) ===============
  'numbered': {
    container: {
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      borderRadius: '8px',
      padding: '12px 20px',
      display: 'flex',
      alignItems: 'center',
    },
    number: {
      backgroundColor: '#FFD700',
      color: '#000000',
      fontWeight: 800,
      fontSize: '20px',
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: '16px',
    },
    text: {
      color: '#FFFFFF',
      fontWeight: 600,
      fontSize: '22px',
    },
    position: 'top-left',
    animation: {
      enter: 'slideInLeft',
      duration: 300,
    },
    useCase: '多点论述，如"5条建议"',
  },
};

// 使用场景映射
export const VARIANT_SELECTION_RULES = {
  // 内容类型 → 推荐变体
  'list_item': 'numbered',
  'concept_definition': 'light-solid',
  'brand_product': 'gradient',
  'quick_emphasis': 'semi-transparent',
  'ppt_content': 'light-solid',
  'default': 'semi-transparent',
};
```

---

## 3. 节奏控制规则

### 3.1 镜头时长计算公式

```typescript
// frontend/src/remotion/utils/pacing-calculator.ts

export interface PacingConfig {
  totalDuration: number;  // 视频总时长 (ms)
  templateType: string;   // 模版类型
  segmentCount: number;   // 片段数量
}

export function calculatePacing(config: PacingConfig) {
  const { totalDuration, templateType, segmentCount } = config;
  const totalSeconds = totalDuration / 1000;
  
  // 基础镜头时长 (基于视频时长)
  let baseShotDuration: number;
  
  if (totalSeconds <= 120) {
    // 短视频 (1-2分钟): 3-6秒/镜头
    baseShotDuration = 4500;
  } else if (totalSeconds <= 300) {
    // 中等视频 (2-5分钟): 4-10秒/镜头
    baseShotDuration = 7000;
  } else {
    // 长视频 (5分钟+): 2-6秒/镜头 (需要更快切换)
    baseShotDuration = 4000;
  }
  
  // 模版修正
  const templateMultiplier: Record<string, number> = {
    'whiteboard': 5.0,     // 白板型更慢
    'screencast': 2.5,     // 演示型较慢
    'talking-head': 1.2,   // 口播型略慢
    'mixed-media': 1.0,    // 混合型标准
  };
  
  const multiplier = templateMultiplier[templateType] || 1.0;
  const avgShotDuration = baseShotDuration * multiplier;
  
  return {
    avgShotDuration: Math.round(avgShotDuration),
    minShotDuration: Math.round(avgShotDuration * 0.5),
    maxShotDuration: Math.round(avgShotDuration * 2.0),
    
    // 分段节奏
    hookPacing: {
      duration: Math.min(10000, totalDuration * 0.08),  // 8%时长
      shotDuration: Math.round(avgShotDuration * 0.6),  // 更快
    },
    bodyPacing: {
      duration: totalDuration * 0.82,  // 82%时长
      shotDuration: Math.round(avgShotDuration),
    },
    ctaPacing: {
      duration: Math.min(15000, totalDuration * 0.1),  // 10%时长
      shotDuration: Math.round(avgShotDuration * 1.3),  // 更慢
    },
    
    // 视觉元素间隔
    elementGap: 500,  // 500ms 默认间隔
    
    // 预计镜头数
    estimatedCuts: Math.ceil(totalDuration / avgShotDuration),
  };
}

// 标杆视频节奏参考
export const BENCHMARK_PACING = {
  '001': { duration: 99, cuts: 25, avgShot: 4.0 },
  '002': { duration: 79, cuts: 24, avgShot: 3.3 },
  '003': { duration: 134, cuts: 4, avgShot: 33.5 },  // 白板型
  '004': { duration: 156, cuts: 35, avgShot: 4.5 },
  '005': { duration: 138, cuts: 10, avgShot: 13.8 },
  '006': { duration: 290, cuts: 28, avgShot: 10.4 },
  '007': { duration: 268, cuts: 62, avgShot: 4.3 },
  '008': { duration: 411, cuts: 152, avgShot: 2.7 },  // 长视频快节奏
};
```

### 3.2 视觉元素时间编排规则

```typescript
// frontend/src/remotion/utils/visual-orchestrator.ts

export const ORCHESTRATION_RULES = {
  // =============== 元素出现时机 ===============
  timing: {
    // 关键词卡片: 在说出关键词后 200-500ms 出现
    keywordCard: {
      delayAfterTrigger: 300,  // ms
      duration: { min: 2000, max: 5000 },
      fadeIn: 250,
      fadeOut: 200,
    },
    
    // 数据数字: 在说出数字时同步出现
    dataNumber: {
      delayAfterTrigger: 0,  // 同步
      duration: { min: 3000, max: 6000 },
      animationDuration: 800,  // 数字滚动动画
    },
    
    // B-Roll: 在提到相关内容前 500ms 开始
    broll: {
      leadTime: 500,  // 提前出现
      duration: { min: 2000, max: 8000 },
      fadeIn: 300,
      fadeOut: 300,
    },
    
    // Canvas组件: 根据内容长度自动计算
    canvas: {
      delayAfterTrigger: 200,
      minDisplayTime: 3000,
      perItemTime: 2000,  // 每个列表项额外 2 秒
    },
  },
  
  // =============== 元素层级 ===============
  zIndex: {
    background: 0,
    canvas: 10,
    mainVideo: 20,
    brollPip: 30,
    personPip: 40,
    overlays: 50,
    keywordCard: 60,
    subtitles: 100,
  },
  
  // =============== 冲突避免规则 ===============
  collision: {
    // 同时最多显示的叠加元素数量
    maxOverlays: 2,
    
    // 不能同时出现的组合
    mutuallyExclusive: [
      ['keywordCard-center', 'canvas-center'],
      ['brollPip-bottom-center', 'personPip-bottom-center'],
    ],
    
    // 字幕避让规则
    subtitleAvoidance: {
      whenBrollPip: 'move-up',  // 字幕上移
      whenPersonPipBottom: 'move-up',
      whenKeywordCardCenter: 'move-down',
    },
  },
  
  // =============== 转场规则 ===============
  transitions: {
    // 内容类型 → 转场效果
    'hook-to-body': 'zoom-out',
    'point-to-point': 'fade',
    'body-to-cta': 'slide-up',
    'broll-insert': 'cut',  // B-Roll 保持直切
    'layout-switch': 'smooth',  // 布局切换用平滑过渡
    
    // 转场时长
    durations: {
      cut: 0,
      fade: 300,
      'zoom-out': 400,
      'slide-up': 350,
      smooth: 500,
    },
  },
};
```

---

## 4. Prompt 工程细粒度规范

### 4.1 Stage 2 结构分析 Prompt

```python
# backend/app/services/remotion_agent/prompts/structure_analysis_prompt.py

STRUCTURE_ANALYSIS_SYSTEM_PROMPT = """
你是一个专业的视频脚本分析师。你的任务是将脚本分解为结构化片段，并为每个片段标注元数据。

## 你必须识别的内容类型 (contentType)

1. **hook** - 开场钩子
   - 特征: 问题、争议观点、惊人数据
   - 位置: 视频开头 0-10秒
   - 示例: "你知道吗？95%的创业公司都会失败"

2. **core_point** - 核心要点
   - 特征: 主要论点、关键结论
   - 通常 2-5 个/视频
   - 示例: "第一个要点是..."

3. **explanation** - 解释说明
   - 特征: 对要点的展开、背景知识
   - 跟在 core_point 后面
   
4. **example** - 举例论证
   - 特征: 具体案例、人物故事、场景描述
   - 触发 B-Roll
   
5. **data** - 数据展示
   - 特征: 百分比、数字、对比数据
   - 触发 DataNumber 组件
   
6. **comparison** - 对比分析
   - 特征: A vs B、优缺点、前后对比
   - 触发 ComparisonCanvas
   
7. **demo** - 演示操作
   - 特征: 工具演示、步骤讲解
   - 触发布局切换到模式 B
   
8. **cta** - 行动号召
   - 特征: 引导关注、推荐内容
   - 位置: 视频结尾

## 你必须识别的角色 (role)

- **narrator**: 旁白/配音
- **speaker**: 说话者本人
- **quote**: 引用他人

## 输出格式

对每个片段输出:
```json
{
  "id": "seg_001",
  "text": "原始文本",
  "start_ms": 起始时间,
  "end_ms": 结束时间,
  "role": "narrator|speaker|quote",
  "contentType": "hook|core_point|explanation|example|data|comparison|demo|cta",
  
  "structure": {
    "isListItem": true/false,
    "listIndex": 如果是列表项,
    "totalListItems": 列表总数,
    "hasData": true/false,
    "dataPoints": [{"value": "15%", "label": "增长率"}],
    "hasPerson": true/false,
    "personName": "如果提到人物",
    "hasProduct": true/false,
    "productName": "如果提到产品",
    "hasConcept": true/false,
    "conceptName": "如果是概念定义"
  },
  
  "brollTrigger": {
    "type": "person|product|concept|scene|demo|data|null",
    "keywords": ["搜索关键词"],
    "insertMode": "pip-over-person|fullscreen-replace|person-pip-over-content",
    "duration_ms": 建议时长,
    "useCanvas": true/false,
    "canvasComponent": "组件名"
  },
  
  "visualPriority": "high|medium|low"
}
```

## 分析规则

1. **列表识别**: "第一/首先/1."、"第二/其次/2." → 标记为列表项
2. **数据识别**: 包含数字+单位(%, 倍, 万, 亿) → 标记 hasData
3. **人物识别**: 提到具体人名 → 标记 hasPerson
4. **概念识别**: "什么是X"、"X的定义" → 标记 hasConcept
5. **演示识别**: "我来演示"、"打开工具" → contentType=demo

## 注意事项

1. 每个片段时长建议 5-15 秒
2. 过长的内容要拆分
3. 紧密相关的内容不要过度拆分
4. 优先级判断: 核心要点 > 数据 > 示例 > 解释
"""
```

### 4.2 Stage 3 视觉配置生成 Prompt

```python
# backend/app/services/remotion_agent/prompts/visual_config_prompt.py

VISUAL_CONFIG_SYSTEM_PROMPT = """
你是一个专业的视频视觉设计师。基于脚本的结构分析结果，生成 Remotion 视觉配置。

## 你可用的组件库

### Canvas 组件 (持续显示)
1. **PointListCanvas** - 要点列表
   - 适用: 多点论述 (3-7个要点)
   - props: { points: [{text, icon?}], style: 'default'|'numbered' }

2. **ProcessFlowCanvas** - 流程/递进图  
   - 适用: 步骤、因果关系
   - props: { steps: [{text, type}], direction: 'vertical'|'horizontal' }

3. **ComparisonCanvas** - 对比画布
   - 适用: A vs B、优缺点
   - props: { left: {title, points}, right: {title, points} }

4. **ConceptCard** - 概念卡片
   - 适用: 术语定义
   - props: { term, definition, icon? }

### Overlay 组件 (临时显示)
1. **KeywordCard** - 关键词卡片
   - 变体: dark-solid, light-solid, semi-transparent, gradient, numbered
   - props: { text, variant, number?, position }

2. **DataNumber** - 数字动画
   - props: { value, label, trend: 'up'|'down'|'neutral' }

3. **HighlightBox** - 高亮框
   - props: { text, color, style: 'solid'|'handdrawn' }

4. **ProgressIndicator** - 进度指示
   - props: { current, total, style }

## 布局模式选择规则

根据以下条件选择布局:

| 条件 | 布局模式 |
|------|----------|
| 默认/口播为主 | modeA (人物全屏+B-Roll画中画) |
| 检测到 demo 类型片段 | modeB (素材全屏+人物画中画) |
| 全程无人物/纯PPT | modeC (纯素材) |
| 视频>4分钟 且 混合内容 | modeD (灵活切换) |

## 输出格式

```json
{
  "version": "2.0",
  "template": "mixed-media|talking-head|whiteboard",
  
  "layoutMode": "modeA|modeB|modeC|modeD",
  
  "mainVideo": {
    "defaultMode": "fullscreen|pip|hidden",
    "dynamicMode": true/false,
    "modeTransitions": [
      { "atMs": 时间点, "toMode": "fullscreen|pip", "pipConfig": {...} }
    ]
  },
  
  "canvas": {
    "type": "point-list|process-flow|comparison|concept",
    "config": { ... },
    "activateAtMs": 开始时间,
    "deactivateAtMs": 结束时间
  },
  
  "overlays": [
    {
      "id": "唯一ID",
      "type": "keyword-card|data-number|highlight-box|progress-indicator",
      "start_ms": 开始时间,
      "end_ms": 结束时间,
      "content": { ... },
      "position": "center|top-left|top-right|bottom-center",
      "animation": { "enter": "fade|pop|slide", "exit": "fade" }
    }
  ],
  
  "brolls": [
    {
      "id": "broll_001",
      "start_ms": 开始时间,
      "end_ms": 结束时间,
      "searchKeywords": ["关键词"],
      "insertMode": "pip-over-person|fullscreen-replace",
      "pipConfig": { "position": "bottom-center", "size": 30 }
    }
  ],
  
  "subtitles": {
    "enabled": true,
    "style": "white-stroke|yellow|white-with-highlight",
    "position": "center-bottom",
    "highlightKeywords": ["需要高亮的词"],
    "highlightColor": "yellow|blue"
  }
}
```

## 设计原则

1. **节奏感**: 每 5-8 秒必须有视觉变化
2. **层次分明**: 同时最多 2 个叠加元素
3. **避免遮挡**: 元素位置不能互相遮挡
4. **适时出现**: 元素在相关内容说出后 300ms 内出现
5. **干净退出**: 元素在内容结束前 200ms 开始淡出
"""
```

---

## 5. 验证规则

### 5.1 视觉配置验证规则

```python
# backend/app/services/remotion_agent/validators/visual_config_validator.py

VALIDATION_RULES = {
    # =============== 节奏规则 ===============
    "pacing": {
        "max_static_duration": 8000,  # 最大静止时长 8秒
        "min_element_gap": 300,       # 元素最小间隔 300ms
        "max_overlays_at_once": 2,    # 同时最多2个叠加元素
    },
    
    # =============== 位置规则 ===============
    "positioning": {
        "forbidden_combinations": [
            ("keywordCard-center", "canvas-center"),
            ("brollPip-bottom-center", "subtitles-bottom"),
            ("personPip-bottom-right", "progressIndicator-bottom-right"),
        ],
        "required_margin_from_edge": 3,  # 距离边缘至少3%
    },
    
    # =============== 时长规则 ===============
    "duration": {
        "keywordCard": {"min": 2000, "max": 6000},
        "dataNumber": {"min": 3000, "max": 8000},
        "broll": {"min": 2000, "max": 10000},
        "canvas": {"min": 5000, "max": 60000},
    },
    
    # =============== 内容规则 ===============
    "content": {
        "max_keyword_length": 20,      # 关键词最长20字
        "max_list_items": 7,           # 列表最多7项
        "data_number_format": r"^\d+(\.\d+)?[%倍万亿]?$",  # 数字格式
    },
    
    # =============== 布局规则 ===============
    "layout": {
        "mode_switch_min_interval": 5000,  # 布局切换最小间隔5秒
        "pip_min_duration": 3000,          # 画中画最短3秒
    },
}

def validate_visual_config(config: dict, template_id: str) -> dict:
    """
    验证视觉配置
    
    Returns:
        {
            "valid": bool,
            "errors": List[str],    # 必须修复
            "warnings": List[str],  # 建议优化
        }
    """
    errors = []
    warnings = []
    
    # 1. 检查静止时长
    static_segments = find_static_segments(config)
    for seg in static_segments:
        if seg["duration"] > VALIDATION_RULES["pacing"]["max_static_duration"]:
            errors.append(
                f"静止画面过长: {seg['start_ms']}-{seg['end_ms']}ms "
                f"(时长{seg['duration']}ms, 最大允许{VALIDATION_RULES['pacing']['max_static_duration']}ms)"
            )
    
    # 2. 检查元素重叠
    overlapping = find_overlapping_elements(config)
    for overlap in overlapping:
        if overlap["type"] == "position":
            errors.append(f"元素位置冲突: {overlap['elements']}")
        elif overlap["type"] == "timing":
            if overlap["count"] > VALIDATION_RULES["pacing"]["max_overlays_at_once"]:
                warnings.append(f"同时显示元素过多: {overlap['time_range']}")
    
    # 3. 检查时长合规
    for overlay in config.get("overlays", []):
        duration = overlay["end_ms"] - overlay["start_ms"]
        limits = VALIDATION_RULES["duration"].get(overlay["type"])
        if limits:
            if duration < limits["min"]:
                warnings.append(f"{overlay['id']} 显示时间过短: {duration}ms")
            if duration > limits["max"]:
                warnings.append(f"{overlay['id']} 显示时间过长: {duration}ms")
    
    # 4. 检查内容格式
    for overlay in config.get("overlays", []):
        if overlay["type"] == "keyword-card":
            text = overlay["content"].get("text", "")
            if len(text) > VALIDATION_RULES["content"]["max_keyword_length"]:
                warnings.append(f"关键词过长: '{text[:20]}...'")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
```

---

## 6. RAG 知识库数据结构

### 6.1 标杆片段数据结构

```python
# backend/app/services/remotion_agent/rag/schema.py

from pydantic import BaseModel
from typing import List, Optional, Literal

class BenchmarkSegment(BaseModel):
    """标杆视频片段 - 用于 RAG 检索"""
    
    id: str  # "benchmark_001_seg_003"
    
    # 来源信息
    source: dict = {
        "video_id": str,        # "001"
        "video_name": str,      # "科技科普-马斯克机器人"
        "timestamp_ms": int,    # 在原视频中的位置
        "duration_ms": int,
        "benchmark_type": str,  # "mixed-media"
    }
    
    # 输入 (用于检索匹配)
    input_text: str                    # 脚本文本
    content_type: str                  # hook/core_point/example/data/...
    
    # 上下文
    context: dict = {
        "position_in_video": str,      # "opening" / "middle" / "ending"
        "previous_type": Optional[str],
        "next_type": Optional[str],
    }
    
    # 输出 (标杆答案)
    visual_config: dict                # 标准的视觉配置
    reasoning: str                     # 为什么这样设计
    
    # 检索元数据
    embedding: Optional[List[float]]   # 文本向量


# 示例数据
BENCHMARK_SEGMENT_EXAMPLE = {
    "id": "benchmark_001_seg_005",
    "source": {
        "video_id": "001",
        "video_name": "科技科普-马斯克机器人",
        "timestamp_ms": 35000,
        "duration_ms": 6000,
        "benchmark_type": "mixed-media",
    },
    "input_text": "马斯克在访谈中提到，他相信机器人技术将在5年内改变制造业",
    "content_type": "example",
    "context": {
        "position_in_video": "middle",
        "previous_type": "core_point",
        "next_type": "data",
    },
    "visual_config": {
        "overlays": [],
        "brolls": [{
            "id": "broll_001",
            "start_ms": 35500,
            "end_ms": 40000,
            "searchKeywords": ["马斯克", "访谈", "Elon Musk interview"],
            "insertMode": "pip-over-person",
            "pipConfig": {
                "position": "bottom-center",
                "size": 30,
            }
        }],
        "layoutChange": None,
    },
    "reasoning": "提到具体人物名(马斯克)，触发人物类B-Roll。使用画中画模式保持主讲人可见，B-Roll时长4.5秒符合人物触发的3-5秒标准。",
}
```

### 6.2 知识库初始化数据 (基于8个标杆视频)

```python
# backend/app/services/remotion_agent/rag/benchmark_data.py

INITIAL_BENCHMARK_DATA = [
    # =============== 001.mp4 标杆片段 ===============
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
        "reasoning": "开场问题触发关键词卡片，使用半透明变体居中显示，快速抓住注意力",
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
        "reasoning": "人物名触发，使用画中画B-Roll，保持主讲人可见",
    },
    
    # =============== 003.mp4 标杆片段 (白板型) ===============
    {
        "id": "bm_003_concept",
        "source": {"video_id": "003", "benchmark_type": "whiteboard"},
        "input_text": "MVP是什么？MVP就是最小可执行产品",
        "content_type": "core_point",
        "visual_config": {
            "layoutMode": "modeC",
            "canvas": {
                "type": "ConceptCard",
                "config": {
                    "term": "MVP",
                    "definition": "最小可执行产品",
                },
            },
            "subtitles": {"style": "yellow"},
        },
        "reasoning": "概念定义触发ConceptCard，白板型视频使用黄色字幕",
    },
    
    # =============== 004/005.mp4 标杆片段 (教学演示型) ===============
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
            "layoutSwitchAt": "demo_start",
        },
        "reasoning": "演示触发切换到模式B，人物缩小到下方中央，内容占主体",
    },
    
    # =============== 006/007/008.mp4 标杆片段 (灵活切换型) ===============
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
        "reasoning": "列表项内容使用编号变体，固定在左上角，方便追踪进度",
    },
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
        "reasoning": "数据展示触发DataNumber组件，配合收款截图B-Roll增加可信度",
    },
]
```

---

*最后更新: 2026-01-31*
*基于 8 个标杆视频分析结果*
