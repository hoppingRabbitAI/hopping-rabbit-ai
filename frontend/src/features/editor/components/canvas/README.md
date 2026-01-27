# Canvas 组件架构文档

## 概述

视频画布模块，负责视频预览、播放控制、Transform 变换等功能。

## 当前架构

```
VideoCanvasStore.tsx
├── 状态管理: 直接读取 EditorStore（Zustand）
├── 核心功能:
│   ├── 视频渲染 + RAF 播放循环
│   ├── 时间同步（视频 ↔ 时间轴 ↔ 音频）
│   ├── Transform 关键帧插值
│   └── HLS 流式播放 + 视频预热
├── 覆盖层: TransformOverlay（../TransformOverlay.tsx）
└── 工具函数:
    ├── preheatVideo() - 预热视频资源
    ├── getPreheatedVideo() - 获取预热的视频
    └── clearHlsCache() - 清理 HLS 缓存
```

## 核心功能

### 1. 播放控制
- `handlePlayPause()`: 播放/暂停切换
- `seekToTime(ms)`: 跳转到指定时间
- RAF 循环驱动时间更新

### 2. 音视频同步
- `syncAudioClips()`: 同步所有音频轨道的播放状态
- 支持多音频轨道（原声、背景音乐、音效）

### 3. Transform 变换
- 关键帧插值计算（position, scale, rotation, opacity）
- 与 TransformOverlay 配合实现可视化编辑

### 4. 视频预热
```ts
// 预热视频资源（HLS 流式加载）
await preheatVideo(assetId)

// 获取预热的视频元素
const preheated = getPreheatedVideo(assetId)

// 清理 HLS 缓存（切换项目时）
clearHlsCache()
```

## 使用方式

```tsx
import { VideoCanvas } from '@/features/editor/components/canvas';

function EditorPage() {
  return <VideoCanvas />;
}
```

组件内部自动连接 EditorStore，无需传递 props。

**拆分原则：**
1. **Props 驱动** - 组件通过 props 接收数据，不直接依赖 Store
2. **职责单一** - 每个组件只负责一个功能
3. **可组合** - 允许自由组合需要的子组件
4. **可测试** - 方便单元测试

## 相关文件

- [VideoCanvasStore.tsx](./VideoCanvasStore.tsx) - 主画布组件
- [../TransformOverlay.tsx](../TransformOverlay.tsx) - 变换覆盖层
- [../../stores/EditorStore.ts](../../stores/EditorStore.ts) - 状态管理
