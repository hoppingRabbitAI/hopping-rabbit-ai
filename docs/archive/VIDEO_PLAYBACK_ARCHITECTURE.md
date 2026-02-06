# 视频编辑器播放架构技术设计

## 1. 架构概览

### 1.1 核心设计原则

```
┌─────────────────────────────────────────────────────────────────┐
│                      PlaybackClock (时钟层)                       │
│                   RAF + performance.now() 驱动                    │
│                        ↓ 时间信号 ↓                               │
├─────────────────────────────────────────────────────────────────┤
│                  VideoResourceManager (资源层)                    │
│              全局单例，管理 video 元素生命周期                      │
│                        ↓ 视频资源 ↓                               │
├─────────────────────────────────────────────────────────────────┤
│                    VideoCanvasV3 (渲染层)                         │
│                 纯渲染，不拥有资源，只消费                          │
└─────────────────────────────────────────────────────────────────┘
```

**核心原则：时钟驱动视频，不是视频驱动时钟**

- 时钟是唯一的时间源
- 视频是从属者，根据时钟 seek 到正确位置
- 组件只是渲染层，不拥有资源

### 1.2 文件结构

```
frontend/src/features/editor/
├── services/
│   ├── PlaybackClock.ts       # 独立时钟（全局单例）
│   └── VideoResourceManager.ts # 视频资源管理器（全局单例）
├── components/canvas/
│   └── VideoCanvasV3.tsx      # 视频画布组件（渲染层）
└── store/
    └── editor-store.ts        # Zustand 状态（UI 同步）
```

---

## 2. PlaybackClock - 独立时钟

### 2.1 设计目标

- 独立于任何视频元素
- 使用 `requestAnimationFrame` + `performance.now()` 精确计时
- 支持"暂停等待"机制（视频未就绪时暂停时钟）

### 2.2 核心接口

```typescript
class PlaybackClock {
  // 状态
  private currentTimeMs: number = 0;
  private isPlaying: boolean = false;
  private durationMs: number = 0;
  
  // RAF 相关
  private rafId: number | null = null;
  private lastTickTime: number = 0;
  
  // 控制
  play(): void;
  pause(): void;
  seek(timeMs: number): void;
  setDuration(durationMs: number): void;
  
  // 等待条件（视频未就绪时暂停）
  addWaitCondition(id: string, condition: WaitCondition): void;
  removeWaitCondition(id: string): void;
  
  // 监听器
  addListener(id: string, listener: ClockListener): void;
  removeListener(id: string): void;
}

// 导出全局单例
export const playbackClock = new PlaybackClock();
```

### 2.3 时钟循环

```typescript
private tick = () => {
  if (!this.isPlaying) return;
  
  const now = performance.now();
  const deltaMs = now - this.lastTickTime;
  this.lastTickTime = now;
  
  // 检查等待条件
  if (this.shouldWait()) {
    this.rafId = requestAnimationFrame(this.tick);
    return; // 暂停推进，等待视频就绪
  }
  
  // 推进时间
  this.currentTimeMs = Math.min(this.currentTimeMs + deltaMs, this.durationMs);
  
  // 通知监听器
  this.notifyListeners();
  
  // 继续循环
  if (this.currentTimeMs < this.durationMs) {
    this.rafId = requestAnimationFrame(this.tick);
  } else {
    this.pause(); // 播放结束
  }
};
```

### 2.4 等待条件机制

```typescript
interface WaitCondition {
  name: string;
  check: () => boolean; // 返回 true 表示可以继续
}

// 示例：等待当前可见 clip 的视频就绪
playbackClock.addWaitCondition('video-ready', {
  name: 'video-buffer',
  check: () => {
    for (const clip of visibleClips) {
      const video = videoResourceManager.getClipVideo(clip.id);
      if (!video || video.status !== 'ready') {
        return false; // 视频未就绪，暂停时钟
      }
    }
    return true;
  },
});
```

---

## 3. VideoResourceManager - 视频资源管理器

### 3.1 设计目标

- 全局单例，不随组件生命周期变化
- LRU 淘汰策略，控制内存使用
- MP4/HLS 智能分流
- HLS 可用性预检查和缓存

### 3.2 核心接口

```typescript
class VideoResourceManager {
  // 视频存储
  private clipVideos: Map<string, ClipVideoState> = new Map();
  private hlsAvailability: Map<string, boolean> = new Map();
  
  // 配置
  private config = {
    maxActiveVideos: 10,      // 最大活跃视频数
    hlsThreshold: 10,         // 超过 10s 使用 HLS
    preheatWindowSec: 15,     // 预热窗口
  };
  
  // 创建/获取视频
  createVideoForClip(clipId, assetId, inPoint, outPoint, isBRoll): ClipVideoState;
  getClipVideo(clipId: string): ClipVideoState | undefined;
  
  // HLS 可用性
  async checkHlsAvailability(assetId: string): Promise<boolean>;
  async batchCheckHlsAvailability(assetIds: string[]): Promise<void>;
  
  // 资源管理
  touchClip(clipId: string): void;  // 更新访问时间
  evictOldest(): void;              // LRU 淘汰
  destroyClip(clipId: string): void;
  destroyAll(): void;
}

// 导出全局单例
export const videoResourceManager = new VideoResourceManager();
```

### 3.3 视频状态

```typescript
interface ClipVideoState {
  clipId: string;
  assetId: string;
  element: HTMLVideoElement;
  src: string;
  sourceType: 'mp4' | 'hls';
  hls?: Hls;                    // HLS.js 实例
  status: 'loading' | 'ready' | 'error';
  bufferedRanges: BufferedRange[];
  lastAccessTime: number;       // LRU 淘汰依据
  clipStartInAsset: number;     // clip 在素材中的起点
  clipEndInAsset: number;       // clip 在素材中的终点
  isBRoll: boolean;
}
```

### 3.4 MP4/HLS 分流策略

```typescript
getSourceType(assetId: string, clipDuration: number, isBRoll: boolean): 'mp4' | 'hls' {
  // B-Roll 强制 MP4（需要精确 seek）
  if (isBRoll) return 'mp4';
  
  // 短 clip 使用 MP4（HLS 初始化开销大）
  if (clipDuration < this.config.hlsThreshold) return 'mp4';
  
  // 长视频检查 HLS 可用性
  if (!this.isHlsAvailable(assetId)) return 'mp4';
  
  return 'hls';
}
```

---

## 4. VideoCanvasV3 - 渲染层

### 4.1 职责

- 监听 PlaybackClock 时间变化
- 根据时间计算哪些 clip 可见
- 将视频元素挂载到 DOM
- 同步视频 currentTime 和播放状态

### 4.2 初始预热流程

```
用户进入编辑器
      ↓
显示 RabbitLoader
      ↓
批量检查 HLS 可用性
      ↓
为所有 clip 创建 video 元素
      ↓
等待所有 video canplay + seek 到起始位置 + seeked
      ↓
隐藏 RabbitLoader，可以无卡顿播放
```

### 4.3 播放时同步

```typescript
useEffect(() => {
  // 监听时钟
  playbackClock.addListener('canvas', (timeMs, playing) => {
    setCurrentTime(timeMs);
    setIsPlaying(playing);
  });
}, []);

// 根据时间计算可见 clip
const visibleClips = useMemo(() => {
  return videoClips.filter(clip => {
    const clipEnd = clip.start + clip.duration;
    return currentTime >= clip.start && currentTime < clipEnd;
  });
}, [videoClips, currentTime]);
```

### 4.4 视频时间同步

```typescript
// 计算视频应该播放的时间点
function calcMediaTime(currentTimeMs: number, clip: Clip): number {
  const offsetInClip = currentTimeMs - clip.start;
  const sourceStartSec = msToSec(clip.sourceStart || 0);
  return sourceStartSec + msToSec(offsetInClip);
}

// 同步逻辑
useEffect(() => {
  const targetTime = calcMediaTime(currentTimeMs, clip);
  const drift = Math.abs(video.currentTime - targetTime);
  
  // 只在大漂移时 seek（避免频繁 seek）
  if (drift > 0.3) {
    video.currentTime = targetTime;
  }
  
  // 同步播放状态
  if (isPlaying && video.paused) {
    video.play();
  } else if (!isPlaying && !video.paused) {
    video.pause();
  }
}, [currentTimeMs, isPlaying]);
```

---

## 5. 数据流

### 5.1 播放控制流

```
用户点击播放按钮
      ↓
setIsPlaying(true) → Store
      ↓
useEffect 检测到 isPlaying 变化
      ↓
playbackClock.play()
      ↓
RAF 循环开始，推进时间
      ↓
playbackClock 通知监听器
      ↓
VideoCanvasV3 更新 currentTime
      ↓
VideoClipRenderer 同步视频
```

### 5.2 时间同步流

```
PlaybackClock (RAF)
      ↓ currentTimeMs
Store.setCurrentTime()
      ↓
Timeline 组件更新播放头位置
VideoCanvasV3 更新可见 clip
      ↓
VideoClipRenderer seek 视频
```

---

## 6. 预热策略

### 6.1 初始预热

进入编辑器时，预加载所有 clip：

```typescript
const preloadClips = async () => {
  // 1. 批量检查 HLS 可用性
  await videoResourceManager.batchCheckHlsAvailability(assetIds);
  
  // 2. 创建所有 video 元素
  for (const clip of clips) {
    videoResourceManager.createVideoForClip(...);
  }
  
  // 3. 等待 canplay
  await waitForAllCanPlay();
  
  // 4. 完成，可以播放
  setIsInitialLoading(false);
};
```

### 6.2 播放时预热

播放过程中，预加载即将可见的 clip：

```typescript
// 预热窗口：当前时间 + 10s
const preheatWindowMs = 10000;

const upcomingClips = videoClips.filter(clip => {
  return clip.start <= currentTime + preheatWindowMs && 
         clip.start + clip.duration > currentTime;
});

for (const clip of upcomingClips) {
  if (!videoResourceManager.getClipVideo(clip.id)) {
    videoResourceManager.createVideoForClip(...);
  }
}
```

---

## 7. 已知问题和待优化

### 7.1 当前问题

| 问题 | 原因 | 状态 |
|------|------|------|
| Clip 切换闪屏 | 切换时 seek 异步，帧未解码 | 待修复 |
| 短 clip 连续卡顿 | 预热窗口不足 | 待优化 |
| 内存占用高 | 所有 clip 都有 video 元素 | 需评估 |

### 7.2 优化方向

1. **双缓冲策略**：渲染所有 clip，用 CSS opacity 控制显隐
2. **预热帧解码**：提前 seek + 等待 seeked 事件
3. **LRU 优化**：限制同时存在的 video 元素数量
4. **短 clip 优化**：增大预热窗口，强制使用 MP4

---

## 8. 多视频叠加播放设计（Overlay Stacking）

### 8.1 问题场景

在实际视频编辑中，经常需要多个视频同时播放并叠加显示：

```
┌─────────────────────────────────────────────────────────────┐
│                       时间轴                                 │
├─────────────────────────────────────────────────────────────┤
│ Track 4 (最上层)  │████ PiP/Logo ████│                      │
│ Track 3           │     ████ B-Roll ████     │              │
│ Track 2           │  ████ 叠加视频 ████        │            │
│ Track 1 (底层)    │████████ 主视频 ██████████████████████│  │
└─────────────────────────────────────────────────────────────┘
                    ↑
              多个 clip 在此时刻同时可见
```

**叠加场景**：
| 场景 | 描述 | 同时视频数 |
|------|------|-----------|
| 画中画 (PiP) | 主视频上叠加小窗口 | 2 |
| B-Roll 覆盖 | B-Roll 短暂覆盖主视频 | 2 |
| 多画面分屏 | 2x2 或 3x3 分屏 | 4-9 |
| 转场过渡 | 两个视频淡入淡出 | 2 |
| Logo/水印视频 | 动态 Logo 叠加 | 2+ |
| 反应视频 | 主视频 + 反应人物 | 2 |

### 8.2 当前架构对叠加的支持分析

#### 已支持的能力 ✅

1. **多 video 元素并存**
   - `VideoResourceManager` 使用 `Map<clipId, ClipVideoState>` 管理
   - 每个 clip 有独立的 video 元素
   - LRU 策略限制最大数量（默认 10 个）

2. **zIndex 层级控制**
   ```typescript
   // 当前实现：按 track.orderIndex 排序
   const zIndex = isVisible ? (track?.orderIndex ?? 0) + 10 : 0;
   ```

3. **可见性判断支持多个 clip**
   ```typescript
   const visibleVideoClips = useMemo(() => {
     return videoClips.filter(clip => {
       return currentTime >= clip.start && currentTime < clipEnd;
     });
   }, [videoClips, currentTime]);
   ```

4. **等待条件检查所有可见 clip**
   ```typescript
   check: () => {
     for (const clip of visibleVideoClips) {
       const video = videoResourceManager.getClipVideo(clip.id);
       if (!video || video.status !== 'ready') return false;
     }
     return true;
   }
   ```

#### 需要优化的问题 ⚠️

| 问题 | 影响 | 优先级 |
|------|------|--------|
| 多视频同步漂移 | 叠加视频逐渐不同步 | 🔴 高 |
| 多视频同时 seek 卡顿 | 切换到叠加区域时卡顿 | 🔴 高 |
| 音频混合 | 多个视频音频重叠 | 🟡 中 |
| 预热策略单一 | 只考虑"即将显示"，没考虑"叠加显示" | 🟡 中 |
| 资源上限不足 | 10 个 video 可能不够复杂项目 | 🟢 低 |

### 8.3 多视频精确同步方案

#### 8.3.1 同步漂移问题

**问题描述**：
- 多个视频各自调用 `video.play()`
- 由于解码速度、缓冲状态不同，播放速度微小差异累积
- 长时间播放后，叠加视频之间产生可见的不同步

**解决方案：主从同步 (Master-Slave Sync)**

```typescript
// 在 VideoCanvasV3 中实现
interface OverlayGroup {
  masterClipId: string;           // 主视频（通常是底层轨道）
  slaveClipIds: string[];         // 从视频
  syncThresholdMs: number;        // 同步阈值（默认 50ms）
}

// 同步逻辑
function syncOverlayVideos(group: OverlayGroup, timeMs: number) {
  const masterVideo = videoResourceManager.getClipVideo(group.masterClipId);
  if (!masterVideo) return;
  
  const masterTime = masterVideo.element.currentTime;
  
  for (const slaveId of group.slaveClipIds) {
    const slaveVideo = videoResourceManager.getClipVideo(slaveId);
    if (!slaveVideo) continue;
    
    const slaveTime = slaveVideo.element.currentTime;
    const drift = Math.abs(masterTime - slaveTime) * 1000; // 转换为 ms
    
    if (drift > group.syncThresholdMs) {
      // 从视频需要校正
      slaveVideo.element.currentTime = masterTime;
      log('同步校正:', slaveId, 'drift:', drift, 'ms');
    }
  }
}
```

#### 8.3.2 统一时钟驱动方案（推荐）

**更优雅的方案：让 PlaybackClock 成为唯一时间源，所有视频被动跟随**

```typescript
// PlaybackClock.ts 增强
class PlaybackClock {
  // ... 现有代码 ...
  
  // ★★★ 帧级同步：每帧检查所有活跃视频 ★★★
  private syncAllVideos() {
    const targetTimeSec = this._currentTimeMs / 1000;
    
    // 获取所有当前可见的视频
    const activeVideos = videoResourceManager.getActiveClipVideos();
    
    for (const clipVideo of activeVideos) {
      const clip = getClipById(clipVideo.clipId);
      if (!clip) continue;
      
      // 计算该 clip 在当前时间应该显示的媒体时间
      const mediaTime = calcMediaTime(this._currentTimeMs, clip);
      const currentVideoTime = clipVideo.element.currentTime;
      const drift = Math.abs(mediaTime - currentVideoTime);
      
      // 分级同步策略
      if (drift > 0.5) {
        // 大漂移：立即 seek
        clipVideo.element.currentTime = mediaTime;
      } else if (drift > 0.1 && this._isPlaying) {
        // 中等漂移：微调播放速率
        clipVideo.element.playbackRate = drift > 0 ? 1.05 : 0.95;
      } else {
        // 同步良好：恢复正常速率
        clipVideo.element.playbackRate = this._playbackRate;
      }
    }
  }
  
  // 在 RAF tick 中调用
  private tick = () => {
    // ... 时间推进逻辑 ...
    
    // ★★★ 每帧同步所有视频 ★★★
    this.syncAllVideos();
    
    this.rafId = requestAnimationFrame(this.tick);
  };
}
```

### 8.4 叠加区域预热优化

#### 8.4.1 问题

当前预热逻辑：
```typescript
const isUpcoming = !isVisible && 
  currentTime >= clip.start - PREHEAT_WINDOW_MS && 
  currentTime < clip.start;
```

**问题**：只考虑单个 clip 的"即将开始"，没有考虑：
- 即将进入叠加区域（多个 clip 同时开始可见）
- 叠加区域内的 clip 相互依赖

#### 8.4.2 改进方案：叠加感知预热

```typescript
// VideoCanvasV3.tsx 改进
const upcomingClipsWithOverlay = useMemo(() => {
  const preheatWindowMs = 3000; // 3s 预热窗口
  
  // 找出即将可见的所有 clips
  const upcomingStart = currentTime;
  const upcomingEnd = currentTime + preheatWindowMs;
  
  const upcoming = videoClips.filter(clip => {
    const clipStart = clip.start;
    const clipEnd = clip.start + clip.duration;
    
    // 即将开始，或者即将进入叠加
    return (clipStart > currentTime && clipStart <= upcomingEnd) ||
           // 已经在播放，但即将有其他 clip 叠加上来
           (clipStart <= currentTime && clipEnd > currentTime);
  });
  
  // ★★★ 检测即将发生的叠加区域 ★★★
  const overlayZones = detectUpcomingOverlayZones(videoClips, currentTime, upcomingEnd);
  
  // 叠加区域内的所有 clip 都需要预热
  const overlayClips = overlayZones.flatMap(zone => zone.clips);
  
  return [...new Set([...upcoming, ...overlayClips])];
}, [videoClips, currentTime]);

function detectUpcomingOverlayZones(
  clips: Clip[], 
  startTime: number, 
  endTime: number
): OverlayZone[] {
  const zones: OverlayZone[] = [];
  
  // 扫描时间线，找出多个 clip 同时可见的区域
  const events: { time: number; clipId: string; type: 'start' | 'end' }[] = [];
  
  for (const clip of clips) {
    if (clip.start + clip.duration < startTime) continue;
    if (clip.start > endTime) continue;
    
    events.push({ time: clip.start, clipId: clip.id, type: 'start' });
    events.push({ time: clip.start + clip.duration, clipId: clip.id, type: 'end' });
  }
  
  events.sort((a, b) => a.time - b.time);
  
  const activeClips = new Set<string>();
  let zoneStart = 0;
  
  for (const event of events) {
    if (event.type === 'start') {
      if (activeClips.size > 0) {
        // 产生叠加！
        zones.push({
          start: event.time,
          clips: [...activeClips, event.clipId].map(id => 
            clips.find(c => c.id === id)!
          ),
        });
      }
      activeClips.add(event.clipId);
    } else {
      activeClips.delete(event.clipId);
    }
  }
  
  return zones;
}
```

### 8.5 叠加视频的等待条件增强

#### 8.5.1 当前问题

现有等待条件只检查"当前可见"的 clip：
```typescript
check: () => {
  for (const clip of visibleVideoClips) {
    if (!video || video.status !== 'ready') return false;
  }
  return true;
}
```

**问题**：
- 进入叠加区域时，新叠加的视频可能还未就绪
- 造成进入叠加区域瞬间卡顿

#### 8.5.2 改进方案：预判等待

```typescript
// 增强的等待条件
playbackClock.addWaitCondition({
  id: 'overlay-ready',
  reason: '等待叠加视频就绪',
  check: () => {
    const lookAheadMs = 500; // 提前 500ms 检查
    
    // 1. 检查当前可见的 clips
    for (const clip of visibleVideoClips) {
      const video = videoResourceManager.getClipVideo(clip.id);
      if (!video || video.status !== 'ready') return false;
    }
    
    // 2. ★★★ 检查即将叠加的 clips ★★★
    const upcomingOverlay = videoClips.filter(clip => {
      const clipStart = clip.start;
      return clipStart > currentTime && clipStart <= currentTime + lookAheadMs;
    });
    
    for (const clip of upcomingOverlay) {
      const video = videoResourceManager.getClipVideo(clip.id);
      // 即将叠加的视频必须已创建且 ready
      if (!video || video.status !== 'ready') {
        log('等待即将叠加的视频:', clip.id);
        return false;
      }
      
      // ★★★ 还要检查是否已经 seek 到正确位置 ★★★
      const targetTime = msToSec(clip.sourceStart || 0);
      const currentVideoTime = video.element.currentTime;
      if (Math.abs(targetTime - currentVideoTime) > 0.1) {
        log('等待视频 seek:', clip.id, 'target:', targetTime, 'current:', currentVideoTime);
        return false;
      }
    }
    
    return true;
  },
});
```

### 8.6 音频混合策略

#### 8.6.1 问题

多个视频同时播放时，音频需要正确混合：
- 主视频保持原音量
- B-Roll 通常静音或降低音量
- 画中画可能需要混音
- 背景音乐视频需要调整音量

#### 8.6.2 方案：音频优先级系统

```typescript
interface AudioPriority {
  clipId: string;
  priority: 'primary' | 'secondary' | 'background' | 'muted';
  volume: number; // 0-1
}

// 根据轨道和 clip 类型确定音频优先级
function getAudioPriority(clip: Clip, track: Track): AudioPriority {
  // B-Roll 默认静音
  if (clip.clipType === 'broll') {
    return { clipId: clip.id, priority: 'muted', volume: 0 };
  }
  
  // 主轨道（orderIndex 最低）是主音频
  if (track.orderIndex === 0) {
    return { clipId: clip.id, priority: 'primary', volume: clip.volume ?? 1 };
  }
  
  // 其他轨道根据设置
  if (clip.isMuted) {
    return { clipId: clip.id, priority: 'muted', volume: 0 };
  }
  
  return { 
    clipId: clip.id, 
    priority: 'secondary', 
    volume: (clip.volume ?? 1) * 0.5 // 默认降低 50%
  };
}

// 在 VideoClipRenderer 中应用
useEffect(() => {
  if (!clipVideo) return;
  
  const track = tracks.find(t => t.id === clip.trackId);
  const audioPriority = getAudioPriority(clip, track);
  
  clipVideo.element.muted = audioPriority.priority === 'muted';
  clipVideo.element.volume = audioPriority.volume;
}, [clipVideo, clip, tracks]);
```

### 8.7 资源管理优化

#### 8.7.1 叠加场景的 LRU 策略调整

```typescript
class VideoResourceManager {
  // 叠加场景需要更多资源
  private config = {
    maxActiveVideos: 15,        // 从 10 增加到 15
    overlayBonus: 5,            // 叠加 clip 额外保护
  };
  
  // ★★★ 智能 LRU：保护叠加中的视频 ★★★
  evictOldest() {
    if (this.clipVideos.size <= this.config.maxActiveVideos) return;
    
    // 找出当前时间附近的叠加 clips
    const overlayClipIds = this.getOverlayClipIds();
    
    // 排序：优先淘汰非叠加、访问时间久远的
    const candidates = Array.from(this.clipVideos.entries())
      .filter(([id]) => !overlayClipIds.has(id)) // 排除叠加中的
      .sort((a, b) => a[1].lastAccessTime - b[1].lastAccessTime);
    
    if (candidates.length > 0) {
      const [clipId] = candidates[0];
      this.destroyClip(clipId);
    }
  }
}
```

### 8.8 实现优先级建议

| 优先级 | 功能 | 复杂度 | 影响 |
|--------|------|--------|------|
| P0 | 多视频同步校正 | 中 | 叠加视频不漂移 |
| P0 | 叠加预热优化 | 中 | 进入叠加无卡顿 |
| P1 | 预判等待条件 | 低 | 切换更平滑 |
| P1 | 音频混合策略 | 低 | 声音正确 |
| P2 | LRU 叠加保护 | 低 | 内存更优 |
| P2 | 分屏渲染优化 | 高 | 支持更多叠加 |

---

## 9. 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `maxActiveVideos` | 15 | 最大同时存在的 video 元素（支持叠加） |
| `hlsThreshold` | 10s | 超过此时长使用 HLS |
| `preheatWindowSec` | 10s | 预加载窗口大小 |
| `seekThreshold` | 0.3s | 超过此漂移才 seek |
| `overlaySyncThreshold` | 0.05s | 叠加视频同步阈值 |
| `overlayLookAheadMs` | 500ms | 叠加预判窗口 |

---

## 10. 调试工具

```typescript
// 开启调试日志
const DEBUG = process.env.NODE_ENV === 'development';

// 查看活跃视频数
videoResourceManager.getActiveCount();

// 查看 clip 状态
videoResourceManager.getClipVideo(clipId);

// 查看时钟状态
playbackClock.getCurrentTime();
playbackClock.getIsPlaying();

// ★★★ 叠加调试工具 ★★★

// 查看当前可见的所有视频 clips
videoResourceManager.getVisibleClipVideos(currentTime, clips);

// 检测叠加区域
function debugOverlayZones(clips: Clip[], currentTime: number) {
  const visible = clips.filter(c => 
    currentTime >= c.start && currentTime < c.start + c.duration
  );
  console.log('当前叠加数量:', visible.length);
  visible.forEach(c => {
    const v = videoResourceManager.getClipVideo(c.id);
    console.log(' -', c.id.slice(-8), 
      '状态:', v?.status, 
      '时间:', v?.element.currentTime.toFixed(2)
    );
  });
}

// 检测同步漂移
function debugSyncDrift(clips: Clip[], currentTime: number) {
  const visible = clips.filter(c => 
    currentTime >= c.start && currentTime < c.start + c.duration
  );
  if (visible.length < 2) return;
  
  const times = visible.map(c => {
    const v = videoResourceManager.getClipVideo(c.id);
    return { clipId: c.id, time: v?.element.currentTime ?? 0 };
  });
  
  const maxDrift = Math.max(...times.map(t => t.time)) - 
                   Math.min(...times.map(t => t.time));
  console.log('最大漂移:', (maxDrift * 1000).toFixed(1), 'ms');
}
```

---

## 11. 未来优化方向

### 11.1 WebCodecs 高性能方案

对于更复杂的叠加场景（4+ 视频），可以考虑使用 WebCodecs API：

```typescript
// 使用 VideoDecoder 精确控制帧解码
const decoder = new VideoDecoder({
  output: (frame) => {
    // 直接获取解码后的帧，绘制到 canvas
    ctx.drawImage(frame, 0, 0);
    frame.close();
  },
  error: (e) => console.error(e),
});
```

**优势**：
- 帧级别精确控制
- 多个视频帧可以精确同步后再渲染
- 支持 GPU 加速合成

**复杂度**：高，需要重构渲染管线

### 11.2 Canvas 合成方案

使用 Canvas 2D 或 WebGL 合成多个视频：

```typescript
function compositeVideos(
  ctx: CanvasRenderingContext2D,
  videos: HTMLVideoElement[],
  transforms: Transform[]
) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const t = transforms[i];
    
    ctx.save();
    ctx.globalAlpha = t.opacity;
    ctx.translate(t.x, t.y);
    ctx.scale(t.scaleX, t.scaleY);
    ctx.rotate(t.rotation);
    ctx.drawImage(video, -video.videoWidth/2, -video.videoHeight/2);
    ctx.restore();
  }
}
```

**优势**：
- 所有视频统一合成，避免 DOM 层叠问题
- 方便添加混合模式、滤镜等效果
- 可以录制最终输出

**劣势**：
- 需要每帧重绘
- 大分辨率性能开销大

