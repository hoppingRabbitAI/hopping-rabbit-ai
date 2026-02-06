# 视频编辑器核心系统

> 合并自：VIDEO_EDITOR_V3_ARCHITECTURE / VIDEO_PLAYBACK_ARCHITECTURE / 关键帧设计 / TEXT_EDITOR_DESIGN
> 
> 本文档是视频编辑器的核心技术参考，涵盖播放架构、资源管理、关键帧和文本编辑。

---

## 1. 架构概览

### 1.1 三层分离架构

```
┌─────────────────────────────────────────────────────────────┐
│                      PlaybackClock (时钟层)                   │
│                   RAF + performance.now() 驱动                │
│                        ↓ 时间信号 ↓                           │
├─────────────────────────────────────────────────────────────┤
│                  VideoResourceManager (资源层)                │
│              全局单例，管理 video 元素生命周期                  │
│                        ↓ 视频资源 ↓                           │
├─────────────────────────────────────────────────────────────┤
│                    VideoCanvasV3 (渲染层)                     │
│                 纯渲染，不拥有资源，只消费                      │
└─────────────────────────────────────────────────────────────┘
```

**核心原则：时钟驱动视频，不是视频驱动时钟**

### 1.2 模块职责

| 模块 | 类型 | 文件路径 | 职责 |
|------|------|----------|------|
| **VideoResourceManager** | 全局单例 | `services/VideoResourceManager.ts` | 视频 DOM 元素管理、HLS 实例、预加载、缓冲监控 |
| **PlaybackClock** | 全局单例 | `services/PlaybackClock.ts` | RAF 高精度时钟，播放进度驱动 |
| **VideoCanvasV3** | UI 组件 | `components/canvas/VideoCanvasV3.tsx` | 视口渲染、布局计算、Store 同步 |

---

## 2. PlaybackClock - 独立时钟

### 2.1 核心接口

```typescript
class PlaybackClock {
  private currentTimeMs: number = 0;
  private isPlaying: boolean = false;
  private rafId: number | null = null;
  
  play(): void;
  pause(): void;
  seek(timeMs: number): void;
  
  // 等待条件（视频未就绪时暂停）
  addWaitCondition(id: string, condition: WaitCondition): void;
  removeWaitCondition(id: string): void;
  
  // 监听器
  addListener(id: string, listener: ClockListener): void;
}

export const playbackClock = new PlaybackClock();
```

### 2.2 等待条件机制

```typescript
// 示例：等待当前可见 clip 的视频就绪
playbackClock.addWaitCondition('video-ready', {
  check: () => {
    for (const clip of visibleClips) {
      const video = videoResourceManager.getClipVideo(clip.id);
      if (!video || video.status !== 'ready') return false;
    }
    return true;
  },
});
```

---

## 3. VideoResourceManager - 资源管理

### 3.1 核心接口

```typescript
class VideoResourceManager {
  private clipVideos: Map<string, ClipVideoState> = new Map();
  private hlsAvailability: Map<string, HlsStatus> = new Map();
  
  private config = {
    maxActiveVideos: 10,      // 最大活跃视频数
    hlsThreshold: 10,         // 超过 10s 使用 HLS
    preheatWindowSec: 15,     // 预热窗口
  };
  
  createVideoForClip(clipId, assetId, inPoint, outPoint, isBRoll): ClipVideoState;
  getClipVideo(clipId: string): ClipVideoState | undefined;
  async batchCheckHlsAvailability(assetIds: string[]): Promise<void>;
  evictOldest(): void;  // LRU 淘汰
}

export const videoResourceManager = new VideoResourceManager();
```

### 3.2 视频源类型决策

| 场景 | 视频源类型 | 原因 |
|------|-----------|------|
| 主视频（Cloudflare Stream）| HLS | Cloudflare 只提供 HLS 流 |
| B-Roll（Pexels）| MP4 | 标准 H.264，直接 MP4 代理 |
| HLS 不可用 | MP4 | 回退到后端 MP4 代理 |

### 3.3 预热就绪条件

所有条件必须同时满足：
- ✅ HLS 实例挂载完成
- ✅ `loadedmetadata` 事件触发
- ✅ Seek 到入点完成 (`seeked` 事件)
- ✅ 缓冲区 ≥ 2s

---

## 4. 关键帧系统（参考 CapCut）

### 4.1 设计精髓

| 模块 | 要点 |
|------|------|
| 交互逻辑 | **选择-标记-调节**，属性旁的钻石图标是统一触发点 |
| 自动生成 | **A→B 自动创建**，在 A 点设置参数，移动到 B 点再调整，系统自动创建新关键帧 |
| 数据模型 | **时间归一化 offset**，0.0-1.0 表示相对位置 |
| 属性离散化 | 每个属性独立定义和插值 |

### 4.2 工作流

```
1. 选中 Clip
2. 在属性面板找到目标属性（如缩放）
3. 点击 ◆ 添加第一个关键帧
4. 移动播放头到新位置
5. 调整属性值 → 系统自动创建关键帧
6. 预览动画效果
```

### 4.3 数据模型

```typescript
interface Keyframe {
  offset: number;      // 0.0-1.0 相对位置
  value: number;       // 属性值
  easing: EasingType;  // 缓动曲线
}

interface KeyframeTrack {
  property: string;    // 'position_x' | 'scale' | 'opacity' | ...
  keyframes: Keyframe[];
}
```

---

## 5. 文本编辑（参考剪映）

### 5.1 核心能力

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 添加文本 | P0 | 用户可在视频上添加文本 Clip |
| 文本编辑 | P0 | 双击进入编辑模式 |
| 拖拽移动 | P0 | 在画布上拖拽位置 |
| 缩放旋转 | P0 | 控制点调整大小和角度 |
| 样式编辑 | P0 | 字体、字号、颜色、描边 |
| 预设模板 | P1 | 花字、标题预设 |
| 动画效果 | P2 | 入场/出场/循环动画 |

### 5.2 数据模型

```typescript
interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadow?: TextShadow;
  letterSpacing?: number;
  lineHeight?: number;
}

interface TextClip extends BaseClip {
  type: 'text';
  content: string;
  style: TextStyle;
  position: { x: number; y: number };
  transform: { scale: number; rotation: number };
}
```

---

## 6. 异常处理

### 6.1 降级策略

| 异常 | 处理 |
|------|------|
| HLS 加载失败 | 回退到 MP4 代理 |
| 视频加载超时 | 显示 loading，重试 |
| 内存不足 | LRU 淘汰旧视频 |
| Seek 失败 | 重新 seek，最多 3 次 |

### 6.2 调试

```typescript
// 开启调试日志
window.__DEBUG_VIDEO_RESOURCE__ = true;
window.__DEBUG_PLAYBACK_CLOCK__ = true;
```

---

## 7. 详细实现参考

完整实现细节请查看归档：
- [VIDEO_EDITOR_V3_ARCHITECTURE.md](archive/VIDEO_EDITOR_V3_ARCHITECTURE.md)
- [VIDEO_PLAYBACK_ARCHITECTURE.md](archive/VIDEO_PLAYBACK_ARCHITECTURE.md)
- [关键帧设计.md](archive/关键帧设计.md)
- [TEXT_EDITOR_DESIGN.md](archive/TEXT_EDITOR_DESIGN.md)
