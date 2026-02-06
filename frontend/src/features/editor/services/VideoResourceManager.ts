/**
 * VideoResourceManager - 视频资源管理器（全局单例）
 * 
 * ★★★ 核心设计原则 ★★★
 * 1. 模块级单例，不随组件生命周期变化
 * 2. 视频资源由 LRU 策略管理，不受 React 重渲染影响
 * 3. 组件只是消费者，不拥有资源
 * 
 * 职责：
 * - video element 创建/销毁
 * - MP4/HLS 分流（短 clip 用 MP4，长视频用 HLS，B-Roll 强制 MP4）
 * - buffered 范围检测
 * - 加载状态追踪 (loading/ready/error)
 * - HLS 可用性检查和缓存
 */

import Hls from 'hls.js';
import { getAssetProxyUrl, getAssetHlsUrl, checkHlsAvailable } from '@/lib/api/media-proxy';

// ==================== 类型定义 ====================

export type VideoSourceType = 'mp4' | 'hls';
export type ClipVideoStatus = 'loading' | 'ready' | 'error';

export interface BufferedRange {
  start: number;
  end: number;
}

export interface ClipVideoState {
  clipId: string;
  assetId: string;
  element: HTMLVideoElement;
  src: string;
  sourceType: VideoSourceType;
  hls?: Hls;
  status: ClipVideoStatus;
  bufferedRanges: BufferedRange[];
  lastAccessTime: number;
  clipStartInAsset: number;
  clipEndInAsset: number;
  isBRoll: boolean;
  // 事件处理函数引用
  _handlers?: {
    onLoadedMetadata: () => void;
    onCanPlay: () => void;
    onProgress: () => void;
    onError: () => void;
  };
}

export interface VideoResourceConfig {
  maxActiveVideos: number;
  preheatWindowSec: number;
  seekThreshold: number;
  bufferThreshold: number;
  hlsThreshold: number;
  overlaySyncThreshold: number;    // ★ 叠加视频同步阈值（秒）
  overlayLookAheadMs: number;      // ★ 叠加预判窗口（毫秒）
  debug: boolean;
}

// ==================== 工具函数 ====================

const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEBUG) console.log('[VideoResourceManager]', ...args); };

function extractBufferedRanges(video: HTMLVideoElement): BufferedRange[] {
  const ranges: BufferedRange[] = [];
  try {
    const buffered = video.buffered;
    for (let i = 0; i < buffered.length; i++) {
      ranges.push({
        start: buffered.start(i),
        end: buffered.end(i),
      });
    }
  } catch {
    // video 可能已被销毁
  }
  return ranges;
}

function getClipBufferedAmount(
  ranges: BufferedRange[],
  inPoint: number,
  outPoint: number
): number {
  const clipDuration = outPoint - inPoint;
  for (const range of ranges) {
    if (range.start <= inPoint && range.end >= inPoint) {
      const bufferedEnd = Math.min(range.end, outPoint);
      const bufferedAmount = bufferedEnd - inPoint;
      return Math.min(bufferedAmount, clipDuration);
    }
  }
  return 0;
}

// ==================== VideoResourceManager 类 ====================

// ★★★ Asset 级别共享的 HLS 实例 ★★★
interface SharedAssetVideo {
  assetId: string;
  element: HTMLVideoElement;
  hls: Hls | null;
  src: string;
  sourceType: VideoSourceType;
  refCount: number;  // 引用计数
  duration: number;
}

class VideoResourceManager {
  private clipVideos: Map<string, ClipVideoState> = new Map();
  private hlsAvailability: Map<string, { available: boolean; playlistUrl: string | null }> = new Map();
  
  // ★★★ 新增：Asset 级别共享的视频资源 ★★★
  private sharedAssetVideos: Map<string, SharedAssetVideo> = new Map();
  
  // ★★★ 诊断统计 ★★★
  private stats = {
    hlsInstancesCreated: 0,
    mp4InstancesCreated: 0,
    hlsInstancesDestroyed: 0,
    assetHlsCount: new Map<string, number>(),  // 每个 asset 创建了多少个 HLS 实例
  };
  
  private config: VideoResourceConfig;
  private eventListeners: Map<string, (event: { type: string; clipId: string; [key: string]: unknown }) => void> = new Map();

  constructor() {
    this.config = {
      maxActiveVideos: 15,          // ★ 增加到 15 支持叠加场景
      preheatWindowSec: 15,
      seekThreshold: 0.3,
      bufferThreshold: 2,
      hlsThreshold: 10,
      overlaySyncThreshold: 0.05,   // ★ 50ms 同步阈值
      overlayLookAheadMs: 500,      // ★ 500ms 预判窗口
      debug: DEBUG,
    };
    log('🎬 VideoResourceManager 初始化（全局单例）');
  }

  // ==================== 配置 ====================

  setConfig(config: Partial<VideoResourceConfig>) {
    this.config = { ...this.config, ...config };
  }

  getConfig(): VideoResourceConfig {
    return this.config;
  }

  // ==================== 事件监听 ====================

  addEventListener(id: string, listener: (event: { type: string; clipId: string; [key: string]: unknown }) => void) {
    this.eventListeners.set(id, listener);
  }

  removeEventListener(id: string) {
    this.eventListeners.delete(id);
  }

  private emitEvent(type: string, clipId: string, extra?: Record<string, unknown>) {
    this.eventListeners.forEach(listener => {
      listener({ type, clipId, ...extra });
    });
    if (this.config.debug) {
      log(`[${type}]`, clipId.slice(-8), extra || '');
    }
  }

  // ==================== HLS 可用性检查 ====================

  /**
   * 预检查 asset 的 HLS 可用性（异步）
   * 在创建视频前调用，结果会被缓存
   */
  async checkHlsAvailability(assetId: string): Promise<boolean> {
    // 已缓存
    if (this.hlsAvailability.has(assetId)) {
      return this.hlsAvailability.get(assetId)!.available;
    }

    try {
      const status = await checkHlsAvailable(assetId);
      this.hlsAvailability.set(assetId, {
        available: status.available,
        playlistUrl: status.playlistUrl,
      });
      log('HLS 状态:', assetId.slice(-8), status.available ? '✅ 可用' : '❌ 不可用');
      return status.available;
    } catch (error) {
      log('HLS 检查失败:', assetId.slice(-8), error);
      this.hlsAvailability.set(assetId, { available: false, playlistUrl: null });
      return false;
    }
  }

  /**
   * 批量预检查 HLS 可用性
   */
  async batchCheckHlsAvailability(assetIds: string[]): Promise<void> {
    const unchecked = assetIds.filter(id => !this.hlsAvailability.has(id));
    if (unchecked.length === 0) return;

    log('批量检查 HLS 可用性:', unchecked.length, '个 asset');
    await Promise.all(unchecked.map(id => this.checkHlsAvailability(id)));
  }

  /**
   * 同步获取 HLS 可用性（必须先调用 checkHlsAvailability）
   */
  isHlsAvailable(assetId: string): boolean {
    return this.hlsAvailability.get(assetId)?.available ?? false;
  }

  // ==================== 视频源类型判断 ====================

  /**
   * 判断应该使用哪种视频源类型
   * 
   * ★★★ 决策逻辑 ★★★
   * 1. 如果有缓存的 HLS playlistUrl 可用 → 使用 HLS
   * 2. B-Roll 通常来自 Pexels，是标准 H.264 MP4，没有 HLS → 使用 MP4
   * 3. 其他情况检查 HLS 缓存可用性
   */
  getSourceType(assetId: string, _clipDuration: number, isBRoll: boolean): VideoSourceType {
    // 检查缓存的 HLS 状态
    const cachedHls = this.hlsAvailability.get(assetId);
    
    // 如果 HLS 明确可用且有 playlistUrl，使用 HLS
    if (cachedHls?.available && cachedHls.playlistUrl) {
      return 'hls';
    }
    
    // B-Roll 通常没有 HLS（Pexels 视频直接存储为 MP4）
    // 或者 HLS 检查返回不可用，回退到 MP4
    if (isBRoll || (cachedHls && !cachedHls.available)) {
      return 'mp4';
    }
    
    // 默认尝试 HLS（主视频通常有 Cloudflare HLS）
    return 'hls';
  }

  // ==================== 视频创建/销毁 ====================

  /**
   * 获取 clip 的视频状态
   */
  getClipVideo(clipId: string): ClipVideoState | undefined {
    return this.clipVideos.get(clipId);
  }

  /**
   * 为 clip 创建视频元素
   */
  createVideoForClip(
    clipId: string,
    assetId: string,
    inPoint: number,
    outPoint: number,
    isBRoll: boolean = false
  ): ClipVideoState {
    // 如果已存在，直接返回（不销毁重建）
    const existing = this.clipVideos.get(clipId);
    if (existing) {
      existing.lastAccessTime = Date.now();
      return existing;
    }

    // 计算 clip 时长
    const clipDuration = outPoint - inPoint;

    // 决定使用 MP4 还是 HLS
    const sourceType = this.getSourceType(assetId, clipDuration, isBRoll);

    // 创建新的 video 元素
    const element = document.createElement('video');
    element.preload = 'auto';
    element.playsInline = true;
    element.muted = true;

    let src: string;
    let hlsInstance: Hls | undefined;

    if (sourceType === 'hls' && Hls.isSupported()) {
      // 优先使用缓存的 playlistUrl（Cloudflare URL），否则回退到后端 URL
      const cachedHls = this.hlsAvailability.get(assetId);
      src = cachedHls?.playlistUrl || getAssetHlsUrl(assetId);
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hlsInstance.loadSource(src);
      hlsInstance.attachMedia(element);
      
      // ★ 统计
      this.stats.hlsInstancesCreated++;
      this.stats.assetHlsCount.set(assetId, (this.stats.assetHlsCount.get(assetId) || 0) + 1);
      
      log('使用 HLS:', clipId.slice(-8), '| 时长:', clipDuration.toFixed(1), 's', '| asset:', assetId.slice(-8), '| 该asset第', this.stats.assetHlsCount.get(assetId), '个HLS');
    } else {
      src = getAssetProxyUrl(assetId);
      element.src = src;
      this.stats.mp4InstancesCreated++;
      log('使用 MP4:', clipId.slice(-8), '| 时长:', clipDuration.toFixed(1), 's', isBRoll ? '| B-Roll' : '');
    }

    // 创建状态对象
    const state: ClipVideoState = {
      clipId,
      assetId,
      element,
      src,
      sourceType,
      hls: hlsInstance,
      status: 'loading',
      bufferedRanges: [],
      lastAccessTime: Date.now(),
      clipStartInAsset: inPoint,
      clipEndInAsset: outPoint,
      isBRoll,
    };

    // 事件处理函数
    const onLoadedMetadata = () => {
      if (!state.element.src) return;
      state.bufferedRanges = extractBufferedRanges(element);
      
      // ★★★ MP4 关键优化：加载元数据后立即 seek 到 inPoint ★★★
      // 这样浏览器会发起 Range 请求，直接从 inPoint 位置开始缓冲
      // 而不是从 0 开始顺序加载（避免浪费带宽和时间）
      if (sourceType === 'mp4' && inPoint > 0.5) {
        element.currentTime = inPoint;
      }
    };

    const onCanPlay = () => {
      if (!state.element.src) return;
      state.bufferedRanges = extractBufferedRanges(element);
      const bufferedAmount = getClipBufferedAmount(state.bufferedRanges, inPoint, outPoint);
      
      if (bufferedAmount >= Math.min(this.config.bufferThreshold, clipDuration)) {
        state.status = 'ready';
        this.emitEvent('load-ready', clipId);
      }
    };

    const onProgress = () => {
      if (!state.element.src) return;
      state.bufferedRanges = extractBufferedRanges(element);
      if (state.status === 'loading') {
        const bufferedAmount = getClipBufferedAmount(state.bufferedRanges, inPoint, outPoint);
        if (bufferedAmount >= Math.min(this.config.bufferThreshold, clipDuration)) {
          state.status = 'ready';
          this.emitEvent('load-ready', clipId);
        }
      }
    };

    const onError = () => {
      if (!state.element) return;
      const mediaError = element.error;
      const errorCode = mediaError?.code || 0;
      const errorMsg = mediaError?.message || 'Unknown error';
      
      // ★★★ 治标治本：详细错误日志 ★★★
      log('❌ 视频加载失败:', clipId.slice(-8), {
        code: errorCode,
        message: errorMsg,
        src: state.src,
        sourceType: state.sourceType,
        // MediaError codes: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
        codeDesc: ['', 'ABORTED', 'NETWORK', 'DECODE', 'SRC_NOT_SUPPORTED'][errorCode] || 'UNKNOWN',
      });
      
      state.status = 'error';
      this.emitEvent('load-error', clipId, { 
        error: errorMsg,
        code: errorCode,
        src: state.src,
        sourceType: state.sourceType,
      });
    };

    // 保存事件处理函数引用
    state._handlers = { onLoadedMetadata, onCanPlay, onProgress, onError };

    element.addEventListener('loadedmetadata', onLoadedMetadata);
    element.addEventListener('canplay', onCanPlay);
    element.addEventListener('progress', onProgress);
    element.addEventListener('error', onError);

    // HLS 错误处理
    if (hlsInstance) {
      hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          log('HLS 严重错误:', clipId.slice(-8), data.type, data.details);
          state.status = 'error';
          this.emitEvent('load-error', clipId, { error: data.details, type: data.type });
        }
      });
    }

    // 保存到 Map
    this.clipVideos.set(clipId, state);
    this.emitEvent('load-start', clipId, { sourceType });

    // 触发加载（MP4 模式）
    if (sourceType === 'mp4') {
      element.load();
    }

    log('创建视频:', clipId.slice(-8), '| asset:', assetId.slice(-8), '| 类型:', sourceType);

    return state;
  }

  /**
   * 销毁 clip 的视频元素
   */
  destroyVideoForClip(clipId: string): void {
    const state = this.clipVideos.get(clipId);
    if (!state) return;

    // 先移除事件监听器
    if (state._handlers) {
      const { onLoadedMetadata, onCanPlay, onProgress, onError } = state._handlers;
      state.element.removeEventListener('loadedmetadata', onLoadedMetadata);
      state.element.removeEventListener('canplay', onCanPlay);
      state.element.removeEventListener('progress', onProgress);
      state.element.removeEventListener('error', onError);
      delete state._handlers;
    }

    // 销毁 HLS 实例
    if (state.hls) {
      state.hls.destroy();
      this.stats.hlsInstancesDestroyed++;
      log('⚠️ 销毁 HLS:', clipId.slice(-8), '| asset:', state.assetId.slice(-8), '| 已销毁总数:', this.stats.hlsInstancesDestroyed);
    }

    // 停止播放，清空 src
    state.element.pause();
    state.element.src = '';
    state.element.load();

    // 从 Map 中移除
    this.clipVideos.delete(clipId);

    this.emitEvent('evicted', clipId);
    log('销毁视频:', clipId.slice(-8), '| 类型:', state.sourceType);
  }

  // ==================== 缓冲状态检查 ====================

  /**
   * 检查 clip 是否已缓冲到可播放状态
   */
  isClipReady(clipId: string): boolean {
    const state = this.clipVideos.get(clipId);
    if (!state) return false;

    state.bufferedRanges = extractBufferedRanges(state.element);
    const { clipStartInAsset: inPoint, clipEndInAsset: outPoint } = state;
    const clipDuration = outPoint - inPoint;
    const bufferedAmount = getClipBufferedAmount(state.bufferedRanges, inPoint, outPoint);

    return bufferedAmount >= Math.min(this.config.bufferThreshold, clipDuration);
  }

  /**
   * 获取 clip 范围内的可用缓冲量（秒）
   */
  getClipBufferedAmount(clipId: string): number {
    const state = this.clipVideos.get(clipId);
    if (!state) return 0;

    state.bufferedRanges = extractBufferedRanges(state.element);
    return getClipBufferedAmount(
      state.bufferedRanges,
      state.clipStartInAsset,
      state.clipEndInAsset
    );
  }

  /**
   * 更新 clip 的最后访问时间
   */
  touchClip(clipId: string): void {
    const state = this.clipVideos.get(clipId);
    if (state) {
      state.lastAccessTime = Date.now();
    }
  }

  // ==================== LRU 淘汰 ====================

  /**
   * 获取所有活跃的 clip ID 列表
   */
  getActiveClipIds(): string[] {
    return Array.from(this.clipVideos.keys());
  }

  /**
   * 获取活跃视频数量
   */
  getActiveCount(): number {
    return this.clipVideos.size;
  }

  /**
   * 执行 LRU 淘汰
   */
  evictLRU(keepClipIds: string[]): string[] {
    const currentCount = this.clipVideos.size;
    if (currentCount <= this.config.maxActiveVideos) {
      return [];
    }

    const keepSet = new Set(keepClipIds);
    const evictable: Array<{ clipId: string; lastAccessTime: number }> = [];

    this.clipVideos.forEach((state, clipId) => {
      if (!keepSet.has(clipId)) {
        evictable.push({ clipId, lastAccessTime: state.lastAccessTime });
      }
    });

    // 按最后访问时间排序（最旧的在前）
    evictable.sort((a, b) => a.lastAccessTime - b.lastAccessTime);

    const toEvict = currentCount - this.config.maxActiveVideos;
    const evictedIds: string[] = [];

    for (let i = 0; i < Math.min(toEvict, evictable.length); i++) {
      const { clipId } = evictable[i];
      this.destroyVideoForClip(clipId);
      evictedIds.push(clipId);
    }

    if (evictedIds.length > 0) {
      log('LRU 淘汰:', evictedIds.length, '个视频');
    }

    return evictedIds;
  }

  /**
   * 销毁所有资源
   */
  destroyAll(): void {
    const ids = Array.from(this.clipVideos.keys());
    for (const clipId of ids) {
      this.destroyVideoForClip(clipId);
    }
    log('已清空所有视频资源');
  }

  /**
   * 获取调试信息
   */
  getDebugInfo(): { clipId: string; status: ClipVideoStatus; sourceType: VideoSourceType }[] {
    return Array.from(this.clipVideos.values()).map(state => ({
      clipId: state.clipId,
      status: state.status,
      sourceType: state.sourceType,
    }));
  }

  // ==================== 叠加播放支持 ====================

  /**
   * 获取所有活跃的 ClipVideoState
   */
  getAllClipVideos(): ClipVideoState[] {
    return Array.from(this.clipVideos.values());
  }

  /**
   * 检查多个 clip 的同步漂移情况
   * 返回最大漂移值（秒）
   */
  checkSyncDrift(clipIds: string[], expectedTimes: Map<string, number>): number {
    let maxDrift = 0;
    
    for (const clipId of clipIds) {
      const video = this.clipVideos.get(clipId);
      if (!video || video.status !== 'ready') continue;
      
      const expectedTime = expectedTimes.get(clipId);
      if (expectedTime === undefined) continue;
      
      const actualTime = video.element.currentTime;
      const drift = Math.abs(actualTime - expectedTime);
      maxDrift = Math.max(maxDrift, drift);
    }
    
    return maxDrift;
  }

  /**
   * 同步校正多个视频到目标时间
   * @param corrections Map<clipId, targetTime>
   */
  syncCorrect(corrections: Map<string, number>): void {
    const threshold = this.config.overlaySyncThreshold;
    
    corrections.forEach((targetTime, clipId) => {
      const video = this.clipVideos.get(clipId);
      if (!video || video.status !== 'ready') return;
      
      const currentTime = video.element.currentTime;
      const drift = Math.abs(currentTime - targetTime);
      
      if (drift > threshold) {
        video.element.currentTime = targetTime;
        if (this.config.debug) {
          log('同步校正:', clipId.slice(-8), 
            'drift:', (drift * 1000).toFixed(1), 'ms',
            '-> target:', targetTime.toFixed(3));
        }
      }
    });
  }

  /**
   * 批量设置播放状态
   */
  setPlayingState(clipIds: string[], playing: boolean): void {
    for (const clipId of clipIds) {
      const video = this.clipVideos.get(clipId);
      if (!video || video.status !== 'ready') continue;
      
      if (playing && video.element.paused) {
        video.element.play().catch(() => {
          video.element.muted = true;
          video.element.play().catch(() => {});
        });
      } else if (!playing && !video.element.paused) {
        video.element.pause();
      }
    }
  }

  /**
   * 检查 clip 是否已 seek 到目标位置（用于预热验证）
   */
  isClipSeekedToPosition(clipId: string, targetTime: number, tolerance: number = 0.1): boolean {
    const video = this.clipVideos.get(clipId);
    if (!video) return false;
    
    const currentTime = video.element.currentTime;
    return Math.abs(currentTime - targetTime) <= tolerance;
  }
}

// ==================== 导出全局单例 ====================

export const videoResourceManager = new VideoResourceManager();

// 开发模式下暴露到 window 方便调试
if (typeof window !== 'undefined' && DEBUG) {
  (window as unknown as { __videoResourceManager: VideoResourceManager }).__videoResourceManager = videoResourceManager;
}
