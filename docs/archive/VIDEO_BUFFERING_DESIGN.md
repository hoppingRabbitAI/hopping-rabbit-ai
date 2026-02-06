# 视频流畅播放技术方案

## 问题背景

当前实现将整个视频下载到 Blob URL，存在以下问题：
- 5分钟 1080p 视频约 300-600MB，会导致浏览器内存爆炸
- 多个视频同时加载会更严重
- 用户需要等待完全下载才能开始编辑

## 核心需求

> "播放时流畅，不允许任何卡顿等待缓冲的可能性"

## 方案对比

| 方案 | 实现复杂度 | 内存占用 | 首次加载 | 播放流畅度 | 推荐场景 |
|-----|----------|---------|---------|-----------|---------|
| 完全预加载 Blob | ⭐ 简单 | ❌ 极高 | ❌ 很慢 | ✅ 100% | 短视频 <1分钟 |
| 原生 video preload | ⭐ 简单 | ✅ 低 | ✅ 快 | ⚠️ 可能卡 | 不推荐 |
| HLS 分片流 | ⭐⭐⭐⭐ 复杂 | ✅ 低 | ✅ 快 | ✅ 流畅 | 长期方案 |
| **智能预热 + 缓冲监控** | ⭐⭐ 中等 | ✅ 可控 | ✅ 快 | ✅ 流畅 | **推荐** |

---

## 推荐方案：智能预热 + 缓冲监控

### 核心思路

1. **不再完全下载到内存**，利用浏览器原生 video 元素的流式加载
2. **预热策略**：为每个视频源创建隐藏的 video 元素，提前触发缓冲
3. **缓冲监控**：播放前检查 `video.buffered` 范围，确保当前位置已缓冲
4. **智能预加载**：根据播放进度，提前加载后续片段

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     VideoBufferManager                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Video Pool   │  │ Video Pool   │  │ Video Pool   │       │
│  │ (Asset A)    │  │ (Asset B)    │  │ (Asset C)    │       │
│  │              │  │              │  │              │       │
│  │ preload=auto │  │ preload=auto │  │ preload=auto │       │
│  │ buffered: ██ │  │ buffered: █  │  │ buffered: ░  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Buffer Monitor                             │ │
│  │  - 检查 buffered 范围是否覆盖播放位置                    │ │
│  │  - 如果未缓冲，暂停播放 + 显示 loading                   │ │
│  │  - 缓冲完成后自动恢复播放                                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Preload Scheduler                          │ │
│  │  - 当前 clip 播放到 80% 时，预热下一个 clip             │ │
│  │  - Seek 时，优先加载 seek 目标位置                       │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 核心实现

#### 1. VideoBufferManager - 视频缓冲管理器

```typescript
interface BufferState {
  assetId: string;
  videoElement: HTMLVideoElement;
  bufferedRanges: TimeRanges;
  isPreheating: boolean;
  totalDuration: number;
}

class VideoBufferManager {
  private videoPool: Map<string, BufferState> = new Map();
  private readonly PREHEAT_THRESHOLD = 0.8; // 播放到 80% 时预热下一个
  private readonly BUFFER_AHEAD_SEC = 10;   // 需要提前缓冲 10 秒
  
  /**
   * 为资源创建预热 video 元素（隐藏的）
   */
  async preheatVideo(assetId: string, url: string): Promise<void> {
    if (this.videoPool.has(assetId)) return;
    
    const video = document.createElement('video');
    video.preload = 'auto';  // 自动缓冲
    video.muted = true;      // 静音，避免权限问题
    video.src = url;
    video.style.display = 'none';
    document.body.appendChild(video);
    
    // 触发加载
    video.load();
    
    this.videoPool.set(assetId, {
      assetId,
      videoElement: video,
      bufferedRanges: video.buffered,
      isPreheating: true,
      totalDuration: 0,
    });
    
    // 监听缓冲进度
    video.addEventListener('progress', () => {
      this.updateBufferedRanges(assetId);
    });
    
    video.addEventListener('loadedmetadata', () => {
      const state = this.videoPool.get(assetId);
      if (state) {
        state.totalDuration = video.duration;
      }
    });
  }
  
  /**
   * 检查指定时间点是否已缓冲
   */
  isBufferedAt(assetId: string, timeInSeconds: number): boolean {
    const state = this.videoPool.get(assetId);
    if (!state) return false;
    
    const buffered = state.videoElement.buffered;
    for (let i = 0; i < buffered.length; i++) {
      if (timeInSeconds >= buffered.start(i) && timeInSeconds <= buffered.end(i)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * 检查是否有足够的缓冲来流畅播放
   * @param timeInSeconds 当前播放位置
   * @returns 是否可以流畅播放
   */
  hasEnoughBuffer(assetId: string, timeInSeconds: number): boolean {
    const state = this.videoPool.get(assetId);
    if (!state) return false;
    
    const buffered = state.videoElement.buffered;
    const requiredEnd = Math.min(
      timeInSeconds + this.BUFFER_AHEAD_SEC,
      state.totalDuration
    );
    
    for (let i = 0; i < buffered.length; i++) {
      if (timeInSeconds >= buffered.start(i) && requiredEnd <= buffered.end(i)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * 获取缓冲进度百分比
   */
  getBufferProgress(assetId: string): number {
    const state = this.videoPool.get(assetId);
    if (!state || state.totalDuration === 0) return 0;
    
    const buffered = state.videoElement.buffered;
    let totalBuffered = 0;
    
    for (let i = 0; i < buffered.length; i++) {
      totalBuffered += buffered.end(i) - buffered.start(i);
    }
    
    return Math.round((totalBuffered / state.totalDuration) * 100);
  }
  
  /**
   * 强制 seek 到指定位置触发加载
   */
  forceLoadAt(assetId: string, timeInSeconds: number): void {
    const state = this.videoPool.get(assetId);
    if (!state) return;
    
    state.videoElement.currentTime = timeInSeconds;
    // 浏览器会自动开始缓冲这个位置附近的数据
  }
  
  /**
   * 清理资源
   */
  dispose(assetId: string): void {
    const state = this.videoPool.get(assetId);
    if (state) {
      state.videoElement.pause();
      state.videoElement.src = '';
      state.videoElement.remove();
      this.videoPool.delete(assetId);
    }
  }
  
  disposeAll(): void {
    this.videoPool.forEach((_, assetId) => this.dispose(assetId));
  }
}
```

#### 2. 播放流程改造

```typescript
// VideoCanvasStore.tsx 改造

const useVideoPlayback = () => {
  const bufferManager = useRef(new VideoBufferManager());
  const [isWaitingBuffer, setIsWaitingBuffer] = useState(false);
  
  // 项目加载后，预热所有视频
  useEffect(() => {
    const assetUrls = getAllVideoAssetUrls();
    assetUrls.forEach(({ assetId, url }) => {
      bufferManager.current.preheatVideo(assetId, url);
    });
    
    return () => bufferManager.current.disposeAll();
  }, [projectId]);
  
  // 播放前检查缓冲
  const handlePlay = useCallback(() => {
    const currentClip = getCurrentClip();
    if (!currentClip) return;
    
    const mediaTime = getMediaTimeForClip(currentClip, currentTime);
    
    // 检查是否有足够缓冲
    if (!bufferManager.current.hasEnoughBuffer(currentClip.assetId, mediaTime)) {
      setIsWaitingBuffer(true);
      
      // 强制加载当前位置
      bufferManager.current.forceLoadAt(currentClip.assetId, mediaTime);
      
      // 监听缓冲完成
      const checkBuffer = setInterval(() => {
        if (bufferManager.current.hasEnoughBuffer(currentClip.assetId, mediaTime)) {
          clearInterval(checkBuffer);
          setIsWaitingBuffer(false);
          actualPlay(); // 真正开始播放
        }
      }, 100);
      
      return;
    }
    
    actualPlay();
  }, [currentTime]);
  
  // RAF 循环中监控缓冲
  const updatePlayhead = useCallback(() => {
    // ... 正常更新播放头
    
    // 检查是否需要等待缓冲
    const currentClip = getCurrentClip();
    const mediaTime = mainVideo.currentTime;
    
    if (!bufferManager.current.hasEnoughBuffer(currentClip.assetId, mediaTime)) {
      // 缓冲不足，暂停并显示 loading
      mainVideo.pause();
      setIsWaitingBuffer(true);
      
      const waitForBuffer = () => {
        if (bufferManager.current.hasEnoughBuffer(currentClip.assetId, mediaTime)) {
          setIsWaitingBuffer(false);
          mainVideo.play();
        } else {
          requestAnimationFrame(waitForBuffer);
        }
      };
      waitForBuffer();
      return;
    }
    
    // 预热下一个 clip
    if (getClipProgress(currentClip) > 0.8) {
      const nextClip = getNextClip();
      if (nextClip && nextClip.assetId !== currentClip.assetId) {
        bufferManager.current.preheatVideo(nextClip.assetId, nextClip.url);
      }
    }
  }, []);
};
```

#### 3. 加载界面改造

不再显示"正在加载视频到内存"，而是：

```tsx
// 初始加载时显示
{isInitializing && (
  <LoadingScreen message="正在初始化编辑器..." />
)}

// 播放中缓冲不足时显示（这个应该很少出现）
{isWaitingBuffer && (
  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
    <div className="flex items-center gap-2 text-white">
      <Spinner className="w-5 h-5" />
      <span>缓冲中...</span>
    </div>
  </div>
)}
```

---

## 进阶优化：Service Worker 缓存

对于需要**离线使用**或**多次编辑同一视频**的场景，可以用 Service Worker：

```typescript
// sw.ts
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // 只处理视频资源
  if (!url.pathname.includes('/api/media/proxy/')) return;
  
  event.respondWith(
    caches.open('video-cache').then(async (cache) => {
      // 尝试从缓存读取
      const cached = await cache.match(event.request);
      if (cached) return cached;
      
      // 没有缓存，请求网络并缓存
      const response = await fetch(event.request);
      
      // 只缓存成功的响应
      if (response.ok) {
        cache.put(event.request, response.clone());
      }
      
      return response;
    })
  );
});
```

---

## 长期方案：HLS 流式播放

对于专业级视频编辑，最佳方案是后端生成 HLS 流：

### 后端处理

```python
# 上传后，用 FFmpeg 生成 HLS
async def generate_hls(asset_id: str, source_path: str):
    output_dir = f"/hls/{asset_id}"
    
    command = [
        "ffmpeg", "-i", source_path,
        "-c:v", "libx264", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-hls_time", "4",              # 每个片段 4 秒
        "-hls_list_size", "0",         # 保留所有片段
        "-hls_segment_filename", f"{output_dir}/segment_%03d.ts",
        f"{output_dir}/playlist.m3u8"
    ]
    
    await asyncio.create_subprocess_exec(*command)
```

### 前端播放

```typescript
import Hls from 'hls.js';

const video = document.querySelector('video');
const hls = new Hls({
  maxBufferLength: 30,      // 最多缓冲 30 秒
  maxMaxBufferLength: 60,   // 极限 60 秒
});

hls.loadSource(`/api/hls/${assetId}/playlist.m3u8`);
hls.attachMedia(video);

// HLS.js 会自动管理分片加载，非常流畅
```

### HLS 优点
- ✅ 内存占用极低（只缓冲几个片段）
- ✅ 支持自适应码率
- ✅ Seek 响应快（只需加载目标片段）
- ✅ 浏览器原生支持良好（Safari 原生，其他用 hls.js）

### HLS 缺点
- ❌ 需要后端支持转码
- ❌ 首次上传需要更长处理时间
- ❌ 需要额外存储空间（原始 + HLS）

---

## 实施计划

### Phase 1（短期，1-2天）- 智能预热方案

1. 移除完全预加载到 Blob 的逻辑
2. 实现 VideoBufferManager
3. 改造播放逻辑，增加缓冲检测
4. 优化加载界面

### Phase 2（中期，1周）- Service Worker 缓存

1. 实现 Service Worker
2. 视频资源缓存到 IndexedDB
3. 支持离线播放

### Phase 3（长期，2-3周）- HLS 流式播放

1. 后端集成 FFmpeg HLS 转码
2. 前端集成 hls.js
3. 自适应码率支持

---

## 结论

**推荐立即实施 Phase 1**：
- 移除完全预加载，改用浏览器原生缓冲
- 实现智能预热 + 缓冲监控
- 用户体验：快速进入编辑器，播放时可能偶尔有短暂 loading（正常网络下几乎不会出现）

这样可以在**不牺牲体验**的前提下，**支持任意时长视频**。
