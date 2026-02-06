# 视觉编辑器设计文档 (Visual Editor Design)

## 1. 产品定位

### 1.1 概念拆分

| 页面 | 路由 | 定位 | 核心功能 |
|------|------|------|----------|
| **视觉编辑器** | `/visual-editor` | 分镜设计 + 背景定制 | 交互式画布、分镜管理、AI 背景生成、图层编辑 |
| **视频编辑器** | `/editor` | 时间线剪辑 | 轨道编辑、字幕、音频、特效、导出 |

### 1.2 用户流程

```
上传视频 → 配置（勾选 B-Roll）→ 智能剪辑
                                    ↓
                            [视觉编辑器]  ← 新页面
                            • AI 分析分镜
                            • 逐镜定制背景
                            • 画布交互
                                    ↓
                            [视频编辑器]
                            • 时间线精调
                            • 添加字幕/音频
                            • 导出
```

---

## 2. 页面布局

### 2.1 整体结构（参考 Lovart/Figma）

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Header: Logo + 项目名 + [预览] [导出到编辑器] [保存]                           │
├──────────────────┬──────────────────────────────────────────────────┬───────────┤
│                  │                                                  │           │
│   Left Panel     │              Canvas Area                         │  Right    │
│   (200px)        │              (flex-1)                            │  Panel    │
│                  │                                                  │  (280px)  │
│   • 图层列表     │                                                  │           │
│   • 历史记录     │         交互式画布                                │  • 属性   │
│                  │         支持缩放/平移                             │  • 背景   │
│                  │                                                  │  • 样式   │
│                  │                                                  │           │
├──────────────────┴──────────────────────────────────────────────────┴───────────┤
│  Toolbar: 选择 | 画笔 | 形状 | 文字 | 图片 | AI | 颜色 | 撤销/重做             │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Timeline: 分镜时间轴 + 播放控制                                                │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 各区域功能

#### Header
- Logo + 项目名称
- 预览按钮（播放当前分镜效果）
- 导出到编辑器（进入视频编辑器）
- 保存按钮

#### Left Panel（图层面板）
- 分镜列表（树形结构）
  - 每个分镜包含：背景层、人物层、装饰层
- 历史记录
  - 支持撤销/重做
  - 显示操作列表

#### Canvas Area（画布区域）
- 交互式画布（基于 Fabric.js 或 Konva.js）
- 支持：
  - 缩放（滚轮/手势）
  - 平移（拖拽）
  - 选中/移动/缩放/旋转元素
  - 绘制（画笔/形状）
  - 添加文字/图片

#### Right Panel（属性面板）
- 背景定制
  - 保持原始 / 自定义
  - AI 生成 / 画布绘制 / 模板库
- 选中元素属性
  - 尺寸、位置、旋转
  - 颜色、透明度
  - 图层顺序

#### Toolbar（工具栏）
- 选择工具（移动/缩放/旋转）
- 画笔工具
- 形状工具（矩形、圆形、线条）
- 文字工具
- 图片工具（上传/AI生成）
- 颜色选择器
- 撤销/重做

#### Timeline（时间轴）
- 分镜缩略图列表
- 点击切换分镜
- 当前分镜高亮
- 时间指示器

---

## 3. 技术方案

### 3.1 画布库选型

| 库 | 优点 | 缺点 | 选择 |
|---|------|------|------|
| **Fabric.js** | 功能全、文档好、社区活跃 | 体积稍大 | ✅ 推荐 |
| Konva.js | 性能好、React 友好 | 功能略少 | 备选 |
| Paper.js | 矢量强 | 学习曲线 | - |

### 3.2 状态管理

```typescript
interface VisualEditorState {
  // 项目信息
  projectId: string;
  sessionId: string;
  
  // 分镜数据
  shots: Shot[];
  currentShotId: string;
  
  // 画布状态
  canvas: {
    zoom: number;
    panX: number;
    panY: number;
    selectedObjectIds: string[];
  };
  
  // 工具状态
  activeTool: ToolType;
  brushColor: string;
  brushSize: number;
  
  // 历史记录
  history: HistoryEntry[];
  historyIndex: number;
}
```

### 3.3 文件结构

```
frontend/src/
├── app/
│   └── visual-editor/
│       └── page.tsx              # 页面入口
│
├── components/
│   └── visual-editor/
│       ├── VisualEditor.tsx      # 主组件
│       ├── Header.tsx            # 顶部栏
│       ├── LeftPanel/
│       │   ├── index.tsx
│       │   ├── LayerList.tsx     # 图层列表
│       │   └── History.tsx       # 历史记录
│       ├── Canvas/
│       │   ├── index.tsx
│       │   ├── CanvasWrapper.tsx # 画布容器
│       │   └── hooks/
│       │       ├── useCanvas.ts
│       │       └── useTools.ts
│       ├── RightPanel/
│       │   ├── index.tsx
│       │   ├── BackgroundPanel.tsx
│       │   └── PropertiesPanel.tsx
│       ├── Toolbar/
│       │   └── index.tsx
│       └── Timeline/
│           └── index.tsx
│
├── stores/
│   └── visualEditorStore.ts      # Zustand store
│
└── types/
    └── visual-editor.ts          # 类型定义
```

---

## 4. 开发计划

### Phase 1: 基础框架（当前）
- [x] 设计文档
- [ ] 页面路由 `/visual-editor`
- [ ] 基础布局（Header/Left/Canvas/Right/Toolbar/Timeline）
- [ ] 类型定义
- [ ] Zustand store

### Phase 2: 画布核心
- [ ] Fabric.js 集成
- [ ] 画布缩放/平移
- [ ] 基础工具（选择、画笔、形状）
- [ ] 元素选中/移动/缩放

### Phase 3: 分镜管理
- [ ] 分镜时间轴
- [ ] 分镜切换
- [ ] 图层面板
- [ ] 背景定制面板

### Phase 4: AI 集成
- [ ] AI 分镜分析 API
- [ ] AI 背景生成
- [ ] 人物前景检测

### Phase 5: 联调
- [ ] 工作流跳转逻辑
- [ ] 数据持久化
- [ ] 导出到编辑器

---

## 5. API 设计

### 5.1 分镜分析

```
POST /api/visual-editor/analyze-shots
Body: { session_id, video_url }
Response: {
  shots: [
    { id, index, start_time, end_time, thumbnail_url, foreground_mask_url }
  ]
}
```

### 5.2 背景生成

```
POST /api/visual-editor/generate-background
Body: { prompt, reference_image_url?, style? }
Response: { image_url, thumbnail_url }
```

### 5.3 保存项目

```
POST /api/visual-editor/save
Body: { session_id, shots, canvas_state }
Response: { success }
```

---

## 6. 交互细节

### 6.1 分镜切换
- 点击时间轴分镜 → 切换画布内容
- 当前分镜有绿色边框
- 已定制的分镜有绿点标记

### 6.2 背景编辑
- 选择"自定义背景"后显示三个选项
- AI 生成：输入 prompt → 生成 → 预览 → 应用
- 画布绘制：直接在画布上绘制
- 模板库：选择 → 应用

### 6.3 图层管理
- 拖拽排序
- 显示/隐藏
- 锁定/解锁
- 删除

### 6.4 历史记录
- 每次操作记录
- 点击可跳转到任意状态
- Cmd+Z 撤销，Cmd+Shift+Z 重做
