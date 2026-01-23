# HoppingRabbit AI 前端代码架构

## 目录结构

```
frontend/src/
├── app/                    # Next.js App Router 页面
│   ├── editor/            # 编辑器页面
│   ├── login/             # 登录页面
│   └── workspace/         # 工作区页面
│
├── components/            # React 组件
│   ├── editor/           # 编辑器相关组件
│   │   ├── keyframes/    # 关键帧系统组件
│   │   │   ├── BezierCurveEditor.tsx   # 贝塞尔曲线编辑器
│   │   │   ├── EasingSelector.tsx      # 缓动类型选择器
│   │   │   ├── KeyframeDiamond.tsx     # 关键帧菱形标记
│   │   │   ├── KeyframePanel.tsx       # 关键帧属性面板
│   │   │   └── index.ts               # 导出入口
│   │   ├── smart/        # 智能功能组件 ⭐ NEW
│   │   │   ├── types.ts               # 智能功能类型定义
│   │   │   ├── SilenceDetectionPanel.tsx    # 静音检测
│   │   │   ├── FillerDetectionPanel.tsx     # 填充词检测
│   │   │   ├── SpeakerDiarizationPanel.tsx  # 说话人分离
│   │   │   ├── StemSeparationPanel.tsx      # 音轨分离
│   │   │   ├── SmartPanel.tsx               # 主容器
│   │   │   └── index.ts               # 导出入口
│   │   ├── AssetPanel.tsx             # 资源面板
│   │   ├── ClipToolbar.tsx            # 片段工具栏
│   │   ├── ContextMenu.tsx            # 右键菜单
│   │   ├── Header.tsx                 # 顶部导航
│   │   ├── SubtitleEditor.tsx         # 字幕编辑器
│   │   ├── Timeline.tsx               # 时间轴组件
│   │   ├── TimelineComponents.tsx     # 时间轴子组件
│   │   ├── TranscriptEditor.tsx       # 文稿编辑器
│   │   ├── VideoCanvas.tsx            # 视频画布
│   │   └── Waveform.tsx              # 波形显示
│   └── workspace/        # 工作区组件
│
├── hooks/                # 自定义 Hooks
│   └── useKeyframeTransform.ts  # 关键帧变换 Hook
│
├── lib/                  # 工具库
│   ├── api/              # API 模块 ⭐ NEW
│   │   ├── types.ts      # API 类型定义
│   │   ├── client.ts     # 基础客户端
│   │   ├── projects.ts   # 项目 API
│   │   ├── assets.ts     # 资源 API
│   │   ├── tasks.ts      # 任务 API
│   │   ├── export.ts     # 导出 API
│   │   ├── smart.ts      # 智能功能 API
│   │   └── index.ts      # 统一导出
│   ├── keyframe-interpolation.ts   # 关键帧插值算法
│   ├── media-cache.ts              # 媒体缓存
│   ├── sync-manager.ts             # 状态同步管理
│   ├── timeline-utils.ts           # 时间轴工具函数
│   └── workspace-api.ts            # 工作区 API
│
├── stores/               # Zustand 状态管理
│   ├── auth-store.ts              # 认证状态
│   └── editor-store.ts            # 编辑器状态（核心）
│
└── types/                # TypeScript 类型定义
    ├── index.ts          # 统一导出入口
    ├── asset.ts          # 资源类型
    ├── clip.ts           # 内容块与轨道类型
    ├── keyframe.ts       # 关键帧系统类型
    ├── project.ts        # 项目相关类型
    ├── subtitle.ts       # 字幕类型
    ├── task.ts           # 任务相关类型
    └── transcript.ts     # 转写相关类型
```

## 类型定义模块划分

| 文件 | 职责 | 行数 |
|------|------|------|
| `types/index.ts` | 统一导出入口 | 25 |
| `types/transcript.ts` | 转写结果、片段类型 | 56 |
| `types/asset.ts` | 资源元数据、Asset 类型 | 68 |
| `types/keyframe.ts` | 关键帧属性、插值配置 | 100 |
| `types/clip.ts` | Clip、Track、ClipType | 117 |
| `types/task.ts` | AI 任务、API 响应类型 | 140 |
| `types/project.ts` | Project、Timeline、导出配置 | 160 |
| `types/subtitle.ts` | 字幕样式、定位类型 | 279 |

## API 模块划分 ⭐ NEW

| 文件 | 职责 | 行数 |
|------|------|------|
| `lib/api/types.ts` | API 响应类型定义 | ~120 |
| `lib/api/client.ts` | 基础 HTTP 客户端 | ~80 |
| `lib/api/projects.ts` | 项目管理 API | ~110 |
| `lib/api/assets.ts` | 资源管理 API | ~130 |
| `lib/api/tasks.ts` | AI 任务 API | ~150 |
| `lib/api/export.ts` | 导出功能 API | ~130 |
| `lib/api/smart.ts` | 智能剪辑 API | ~40 |
| `lib/api/index.ts` | 统一导出 + 兼容层 | ~90 |

## SmartPanel 模块划分 ⭐ NEW

| 文件 | 职责 | 行数 |
|------|------|------|
| `smart/types.ts` | 智能功能类型定义 | ~65 |
| `smart/SilenceDetectionPanel.tsx` | 静音检测面板 | ~215 |
| `smart/FillerDetectionPanel.tsx` | 填充词检测面板 | ~280 |
| `smart/SpeakerDiarizationPanel.tsx` | 说话人分离面板 | ~250 |
| `smart/StemSeparationPanel.tsx` | 音轨分离面板 | ~275 |
| `smart/SmartPanel.tsx` | 主容器组件 | ~140 |
| `smart/index.ts` | 统一导出 | ~8 |

## 核心组件依赖关系

```
editor/page.tsx
    ├── Header
    ├── VideoCanvas ──> useKeyframeTransform
    ├── Timeline ──> KeyframeDiamond, KeyframePanel
    ├── SmartPanel
    ├── SubtitleEditor
    └── AssetPanel

Timeline.tsx
    ├── TimelineComponents
    ├── keyframes/KeyframeDiamond
    ├── keyframes/KeyframePanel
    │       └── EasingSelector
    │              └── BezierCurveEditor
    └── timeline-utils (常量和工具函数)
```

## 状态管理

### editor-store.ts (~1550 行)

核心编辑器状态，包含以下模块：

1. **项目管理**: `projectId`, `loadProject`, `saveProject`
2. **轨道管理**: `tracks`, `addTrack`, `removeTrack`
3. **内容块管理**: `clips`, `addClip`, `removeClip`, `updateClip`
4. **多选支持**: `selectedClipIds`, `selectClip`, `selectAllClips`
5. **片段操作**: `splitClip`, `duplicateClip`, `deleteSelectedClip`
6. **历史记录**: `undo`, `redo`, `saveToHistory`
7. **播放状态**: `currentTime`, `isPlaying`, `setCurrentTime`
8. **关键帧系统**: `keyframes`, `addKeyframe`, `updateKeyframe`, `deleteKeyframe`
9. **AI 功能**: `startASR`, `startStemSeparation`, `startSmartClean`
10. **同步管理**: `_syncManager`, `_addOperation`

> 注：由于 Zustand 单一 store 的特性，且各模块间存在紧密依赖，暂不进一步拆分。

## 关键帧系统

### 支持的属性

| 类别 | 属性 | 说明 |
|------|------|------|
| Transform | `position_x/y` | 位置偏移 |
| Transform | `scale_x/y` | 缩放比例 |
| Transform | `rotation` | 旋转角度 |
| Transform | `anchor_x/y` | 锚点位置 |
| Visual | `opacity` | 不透明度 |
| Visual | `blur` | 模糊程度 |
| Audio | `volume` | 音量 |
| Audio | `pan` | 声像平衡 |

### 缓动类型

- `linear`: 线性
- `ease_in`: 缓入
- `ease_out`: 缓出
- `ease_in_out`: 缓入缓出
- `hold`: 保持（跳变）
- `bezier`: 自定义贝塞尔曲线

## 代码规范

1. **类型定义**: 按领域拆分到独立文件，通过 `index.ts` 统一导出
2. **组件拆分**: 大型组件提取子组件到独立文件或子目录
3. **工具函数**: 通用工具函数放在 `lib/` 目录
4. **Hooks**: 自定义 Hooks 放在 `hooks/` 目录
5. **常量**: 组件特定常量放在对应工具文件中

## 后续优化建议

1. ~~**SmartPanel.tsx** (~1013 行)~~: ✅ 已拆分为 6 个模块
2. ~~**api.ts** (~800 行)~~: ✅ 已拆分为 7 个模块
3. **Timeline.tsx** (~1120 行): 可提取更多渲染逻辑到 `TimelineComponents.tsx`
4. **editor-store.ts** (~1550 行): 考虑使用 Zustand slice 模式进行模块化

## 模块使用指南

### API 模块

```typescript
// 项目管理
import { projectApi } from '@/lib/api';
await projectApi.getProject(projectId);
await projectApi.createProject({ name });
await projectApi.saveProjectState(projectId, request);

// 资源管理
import { assetApi, uploadVideo } from '@/lib/api';
await assetApi.getWaveform(assetId);
await uploadVideo(file, projectId);

// AI 任务
import { taskApi, transcribeVideo } from '@/lib/api';
await taskApi.startASRTask({ asset_id });
await taskApi.pollTaskUntilComplete(taskId);

// 导出
import { exportApi, exportVideo } from '@/lib/api';
await exportApi.startExport({ project_id });

// 智能剪辑
import { smartApi } from '@/lib/api';
await smartApi.smartClean({ project_id });
```

### SmartPanel 模块

```typescript
// 导入整个面板
import { SmartPanel } from '@/components/editor/smart';

// 或导入单个子面板
import { 
  SilenceDetectionPanel,
  FillerDetectionPanel,
  SpeakerDiarizationPanel,
  StemSeparationPanel 
} from '@/components/editor/smart';
```
