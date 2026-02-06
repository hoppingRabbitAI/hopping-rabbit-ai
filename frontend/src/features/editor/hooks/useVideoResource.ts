/**
 * useVideoResource - 视频资源层 Hook
 * 
 * Layer 3: 视频资源层
 * 职责：
 * - video element 创建/销毁
 * - MP4/HLS 分流（短 clip 用 MP4，长视频用 HLS，B-Roll 强制 MP4）
 * - buffered 范围检测
 * - 加载状态追踪 (loading/ready/error)
 * 
 * 分流策略：
 * - 短 clip (< 10秒)：MP4 proxy（更快，无 HLS 开销）
 * - 长视频 (≥ 10秒)：HLS（流式加载优势明显）
 * - B-Roll：强制 MP4（需要精确 seek）
 * 
 * 设计原则：
 * - 全程 clip 维度操作
 * - 单一数据源 clipVideos
 * - 使用 video.buffered 而非 readyState
 */

import { useRef, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { getAssetProxyUrl, getAssetHlsUrl, checkHlsAvailable } from '@/lib/api/media-proxy';
import type {
  ClipVideoState,
  ClipVideoStatus,
  BufferedRange,
  VideoResourceConfig,
  VideoSourceType,
} from '../types/video';

// 日志工具
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEBUG) console.log('[VideoResource]', ...args); };

// 事件处理函数引用类型
interface EventHandlers {
  onLoadedMetadata: () => void;
  onCanPlay: () => void;
  onProgress: () => void;
  onError: () => void;
}

/**
 * 从 HTMLVideoElement.buffered 提取 BufferedRange 数组
 */
function extractBufferedRanges(video: HTMLVideoElement): BufferedRange[] {
  const ranges: BufferedRange[] = [];
  const buffered = video.buffered;
  for (let i = 0; i < buffered.length; i++) {
    ranges.push({
      start: buffered.start(i),
      end: buffered.end(i),
    });
  }
  return ranges;
}

/**
 * 检查指定时间范围是否已缓冲
 * @param ranges 已缓冲的范围列表
 * @param start 需要检查的起始时间
 * @param end 需要检查的结束时间
 * @param threshold 需要的最小缓冲量（秒）
 */
function isRangeBuffered(
  ranges: BufferedRange[],
  start: number,
  end: number,
  threshold: number
): boolean {
  // 找到覆盖 start 位置的缓冲区
  for (const range of ranges) {
    if (range.start <= start && range.end >= start) {
      // 计算从 start 开始有多少秒被缓冲
      const bufferedAmount = Math.min(range.end, end) - start;
      return bufferedAmount >= threshold;
    }
  }
  return false;
}

/**
 * 获取 clip 范围内的有效缓冲量
 * @param ranges 已缓冲的范围列表
 * @param inPoint clip 在素材中的开始时间
 * @param outPoint clip 在素材中的结束时间
 * @returns clip 范围内已缓冲的秒数
 */
function getClipBufferedAmount(
  ranges: BufferedRange[],
  inPoint: number,
  outPoint: number
): number {
  const clipDuration = outPoint - inPoint;
  
  for (const range of ranges) {
    if (range.start <= inPoint && range.end >= inPoint) {
      // 计算 clip 范围内实际缓冲了多少
      const bufferedEnd = Math.min(range.end, outPoint);
      const bufferedAmount = bufferedEnd - inPoint;
      return Math.min(bufferedAmount, clipDuration);
    }
  }
  return 0;
}

export interface UseVideoResourceOptions {
  config?: Partial<VideoResourceConfig>;
  onEvent?: (event: { type: string; clipId: string; [key: string]: unknown }) => void;
}

export interface UseVideoResourceReturn {
  /** 获取 clip 的视频状态 */
  getClipVideo: (clipId: string) => ClipVideoState | undefined;
  
  /** 
   * 为 clip 创建视频元素（自动分流 MP4/HLS）
   * @param clipId - Clip 唯一标识
   * @param assetId - Asset ID（用于构建 URL）
   * @param inPoint - 素材内起始时间（秒）
   * @param outPoint - 素材内结束时间（秒）
   * @param isBRoll - 是否是 B-Roll（强制使用 MP4）
   */
  createVideoForClip: (
    clipId: string,
    assetId: string,
    inPoint: number,
    outPoint: number,
    isBRoll?: boolean
  ) => ClipVideoState;
  
  /** 销毁 clip 的视频元素 */
  destroyVideoForClip: (clipId: string) => void;
  
  /** 检查 clip 是否已缓冲到可播放状态 */
  isClipReady: (clipId: string) => boolean;
  
  /** 检查 clip 在指定时间范围是否已缓冲 */
  isClipBuffered: (clipId: string, startTime: number, duration: number) => boolean;
  
  /** 获取 clip 范围内的可用缓冲量（秒） */
  getClipBufferedAmount: (clipId: string) => number;
  
  /** 更新 clip 的最后访问时间 */
  touchClip: (clipId: string) => void;
  
  /** 刷新 clip 的缓冲状态 */
  refreshClipBufferState: (clipId: string) => void;
  
  /** 获取所有活跃的 clip ID 列表 */
  getActiveClipIds: () => string[];
  
  /** 获取活跃视频数量 */
  getActiveCount: () => number;
  
  /** 执行 LRU 淘汰，保持活跃数量在限制内 */
  evictLRU: (keepClipIds: string[]) => string[];
  
  /** 清空所有资源 */
  destroyAll: () => void;
  
  /** 配置 */
  config: VideoResourceConfig;
}

/**
 * 视频资源层 Hook
 */
export function useVideoResource(options: UseVideoResourceOptions = {}): UseVideoResourceReturn {
  const { onEvent } = options;
  
  // 合并配置
  const config = useMemo<VideoResourceConfig>(() => ({
    maxActiveVideos: 10,
    preheatWindowSec: 15,
    seekThreshold: 0.3,
    bufferThreshold: 2,
    hlsThreshold: 10, // 10秒以上使用 HLS
    debug: process.env.NODE_ENV === 'development',
    ...options.config,
  }), [options.config]);
  
  // ★★★ 核心数据结构：clipId -> ClipVideoState ★★★
  const clipVideosRef = useRef<Map<string, ClipVideoState>>(new Map());
  
  // ★★★ HLS 可用性缓存：assetId -> { available: boolean, checked: boolean } ★★★
  const hlsAvailabilityRef = useRef<Map<string, { available: boolean; playlistUrl: string | null }>>(new Map());
  
  // 事件通知
  const emitEvent = useCallback((type: string, clipId: string, extra?: Record<string, unknown>) => {
    if (onEvent) {
      onEvent({ type, clipId, ...extra });
    }
    if (config.debug) {
      log(`[${type}]`, clipId.slice(-8), extra || '');
    }
  }, [onEvent, config.debug]);
  
  /**
   * 获取 clip 的视频状态
   */
  const getClipVideo = useCallback((clipId: string): ClipVideoState | undefined => {
    return clipVideosRef.current.get(clipId);
  }, []);
  
  /**
   * 更新 clip 状态
   */
  const updateClipStatus = useCallback((clipId: string, status: ClipVideoStatus, errorMessage?: string) => {
    const state = clipVideosRef.current.get(clipId);
    if (state) {
      state.status = status;
      if (errorMessage) {
        state.errorMessage = errorMessage;
      }
      // 刷新缓冲状态
      state.bufferedRanges = extractBufferedRanges(state.element);
    }
  }, []);
  
  /**
   * 检查 asset 的 HLS 是否可用（异步）
   * 结果会被缓存
   */
  const checkAssetHlsAvailability = useCallback(async (assetId: string): Promise<{ available: boolean; playlistUrl: string | null }> => {
    // 检查缓存
    const cached = hlsAvailabilityRef.current.get(assetId);
    if (cached !== undefined) {
      return cached;
    }
    
    // 请求后端检查
    try {
      const status = await checkHlsAvailable(assetId);
      const result = { available: status.available, playlistUrl: status.playlistUrl };
      hlsAvailabilityRef.current.set(assetId, result);
      log('HLS 状态:', assetId.slice(-8), status.available ? '✅ 可用' : '❌ 不可用', status.hlsStatus);
      return result;
    } catch (err) {
      log('HLS 状态检查失败:', assetId.slice(-8), err);
      const result = { available: false, playlistUrl: null };
      hlsAvailabilityRef.current.set(assetId, result);
      return result;
    }
  }, []);
  
  /**
   * 判断应该使用哪种视频源类型
   * - B-Roll：强制 MP4（需要精确 seek）
   * - 短 clip (< hlsThreshold)：MP4（更快，无 HLS 开销）
   * - 长视频且 HLS 可用：HLS（流式加载优势明显）
   * - 长视频但 HLS 不可用：MP4（等待 HLS 生成）
   */
  const getSourceType = useCallback((
    clipDuration: number,
    isBRoll: boolean,
    hlsAvailable: boolean
  ): VideoSourceType => {
    // B-Roll 强制使用 MP4
    if (isBRoll) {
      return 'mp4';
    }
    // 短 clip 使用 MP4
    if (clipDuration < config.hlsThreshold) {
      return 'mp4';
    }
    // 长视频：检查 HLS 是否可用
    if (!hlsAvailable) {
      log('HLS 不可用，使用 MP4');
      return 'mp4';
    }
    return 'hls';
  }, [config.hlsThreshold]);
  
  /**
   * 为 clip 创建视频元素（支持 MP4/HLS 分流）
   */
  const createVideoForClip = useCallback((
    clipId: string,
    assetId: string,
    inPoint: number,
    outPoint: number,
    isBRoll: boolean = false
  ): ClipVideoState => {
    // 如果已存在，先销毁
    const existing = clipVideosRef.current.get(clipId);
    if (existing) {
      log('替换已存在的视频:', clipId.slice(-8));
      // 销毁 HLS 实例
      if (existing.hls) {
        existing.hls.destroy();
      }
      existing.element.pause();
      existing.element.src = '';
      existing.element.load();
    }
    
    // 计算 clip 时长
    const clipDuration = outPoint - inPoint;
    
    // 决定使用 MP4 还是 HLS（假设 HLS 可用，实际应检查）
    const sourceType = getSourceType(clipDuration, isBRoll, true);
    
    // 创建新的 video 元素
    const element = document.createElement('video');
    element.preload = 'auto';
    element.playsInline = true;
    element.muted = true; // 初始静音，由播放控制层管理音量
    
    let src: string;
    let hlsInstance: Hls | undefined;
    
    if (sourceType === 'hls' && Hls.isSupported()) {
      // 使用 HLS.js
      src = getAssetHlsUrl(assetId);
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hlsInstance.loadSource(src);
      hlsInstance.attachMedia(element);
      log('使用 HLS:', clipId.slice(-8), '| 时长:', clipDuration.toFixed(1), 's');
    } else {
      // 使用 MP4 代理
      src = getAssetProxyUrl(assetId);
      element.src = src;
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
    
    // ★★★ 监听事件 - 保存引用以便销毁时移除 ★★★
    
    const onLoadedMetadata = () => {
      // 检查元素是否还有效
      if (!state.element || !state.element.src) return;
      log('loadedmetadata:', clipId.slice(-8), '| clip时长:', clipDuration.toFixed(1), 's');
      state.bufferedRanges = extractBufferedRanges(element);
    };
    
    const onCanPlay = () => {
      // 检查元素是否还有效
      if (!state.element || !state.element.src) return;
      state.bufferedRanges = extractBufferedRanges(element);
      // 检查 clip 范围内是否有足够的缓冲
      const bufferedAmount = getClipBufferedAmount(state.bufferedRanges, inPoint, outPoint);
      const bufferedPercent = clipDuration > 0 ? (bufferedAmount / clipDuration * 100) : 100;
      
      if (bufferedAmount >= Math.min(config.bufferThreshold, clipDuration)) {
        state.status = 'ready';
        emitEvent('load-ready', clipId);
      }
      log('canplay:', clipId.slice(-8), '| 缓冲:', bufferedAmount.toFixed(1), '/', clipDuration.toFixed(1), 's', `(${bufferedPercent.toFixed(0)}%)`);
    };
    
    const onProgress = () => {
      // 检查元素是否还有效
      if (!state.element || !state.element.src) return;
      state.bufferedRanges = extractBufferedRanges(element);
      // 检查是否达到 ready 状态
      if (state.status === 'loading') {
        const bufferedAmount = getClipBufferedAmount(state.bufferedRanges, inPoint, outPoint);
        if (bufferedAmount >= Math.min(config.bufferThreshold, clipDuration)) {
          state.status = 'ready';
          emitEvent('load-ready', clipId);
        }
      }
    };
    
    const onError = () => {
      // 检查元素是否还有效
      if (!state.element) return;
      const errorMsg = element.error?.message || 'Unknown error';
      state.status = 'error';
      state.errorMessage = errorMsg;
      emitEvent('load-error', clipId, { error: errorMsg });
    };
    
    // 保存事件处理函数引用（用于销毁时移除）
    (state as ClipVideoState & { _handlers?: EventHandlers })._handlers = {
      onLoadedMetadata,
      onCanPlay,
      onProgress,
      onError,
    };
    
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
          state.errorMessage = `HLS Error: ${data.details}`;
          emitEvent('load-error', clipId, { error: data.details, type: data.type });
        }
      });
      
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        log('HLS manifest 解析完成:', clipId.slice(-8));
      });
    }
    
    // 保存到 Map
    clipVideosRef.current.set(clipId, state);
    emitEvent('load-start', clipId, { sourceType });
    
    // 触发加载（MP4 模式）
    if (sourceType === 'mp4') {
      element.load();
    }
    
    log('创建视频:', clipId.slice(-8), '| asset:', assetId.slice(-8), '| 类型:', sourceType, '| in:', inPoint.toFixed(2), '| out:', outPoint.toFixed(2));
    
    return state;
  }, [config.bufferThreshold, emitEvent]);
  
  /**
   * 销毁 clip 的视频元素
   */
  const destroyVideoForClip = useCallback((clipId: string) => {
    const state = clipVideosRef.current.get(clipId);
    if (!state) return;
    
    // ★★★ 先移除事件监听器，防止 "Empty src attribute" 错误 ★★★
    const stateWithHandlers = state as ClipVideoState & { _handlers?: EventHandlers };
    if (stateWithHandlers._handlers) {
      const { onLoadedMetadata, onCanPlay, onProgress, onError } = stateWithHandlers._handlers;
      state.element.removeEventListener('loadedmetadata', onLoadedMetadata);
      state.element.removeEventListener('canplay', onCanPlay);
      state.element.removeEventListener('progress', onProgress);
      state.element.removeEventListener('error', onError);
      delete stateWithHandlers._handlers;
    }
    
    // 销毁 HLS 实例
    if (state.hls) {
      state.hls.destroy();
      log('销毁 HLS:', clipId.slice(-8));
    }
    
    // 停止播放，清空 src
    state.element.pause();
    state.element.src = '';
    state.element.load(); // 释放资源
    
    // 从 Map 中移除
    clipVideosRef.current.delete(clipId);
    
    emitEvent('evicted', clipId);
    log('销毁视频:', clipId.slice(-8), '| 类型:', state.sourceType);
  }, [emitEvent]);
  
  /**
   * 检查 clip 是否已缓冲到可播放状态
   */
  const isClipReady = useCallback((clipId: string, _fromTime?: number): boolean => {
    const state = clipVideosRef.current.get(clipId);
    if (!state) return false;
    
    // 先刷新缓冲状态
    state.bufferedRanges = extractBufferedRanges(state.element);
    
    const { clipStartInAsset: inPoint, clipEndInAsset: outPoint } = state;
    const clipDuration = outPoint - inPoint;
    const bufferedAmount = getClipBufferedAmount(state.bufferedRanges, inPoint, outPoint);
    
    // clip 范围内缓冲够了就认为 ready
    return bufferedAmount >= Math.min(config.bufferThreshold, clipDuration);
  }, [config.bufferThreshold]);
  
  /**
   * 检查 clip 在指定时间范围是否已缓冲
   */
  const isClipBuffered = useCallback((clipId: string, startTime: number, duration: number): boolean => {
    const state = clipVideosRef.current.get(clipId);
    if (!state) return false;
    
    // 刷新缓冲状态
    state.bufferedRanges = extractBufferedRanges(state.element);
    
    return isRangeBuffered(
      state.bufferedRanges,
      startTime,
      startTime + duration,
      Math.min(duration, config.bufferThreshold)
    );
  }, [config.bufferThreshold]);
  
  /**
   * 获取 clip 范围内的可用缓冲量（秒）
   */
  const getClipBufferedAmountFn = useCallback((clipId: string): number => {
    const state = clipVideosRef.current.get(clipId);
    if (!state) return 0;
    
    state.bufferedRanges = extractBufferedRanges(state.element);
    return getClipBufferedAmount(state.bufferedRanges, state.clipStartInAsset, state.clipEndInAsset);
  }, []);
  
  /**
   * 更新 clip 的最后访问时间
   */
  const touchClip = useCallback((clipId: string) => {
    const state = clipVideosRef.current.get(clipId);
    if (state) {
      state.lastAccessTime = Date.now();
    }
  }, []);
  
  /**
   * 刷新 clip 的缓冲状态
   */
  const refreshClipBufferState = useCallback((clipId: string) => {
    const state = clipVideosRef.current.get(clipId);
    if (state) {
      state.bufferedRanges = extractBufferedRanges(state.element);
      
      // 检查是否应该更新状态
      if (state.status === 'loading') {
        const { clipStartInAsset: inPoint, clipEndInAsset: outPoint } = state;
        const clipDuration = outPoint - inPoint;
        const bufferedAmount = getClipBufferedAmount(state.bufferedRanges, inPoint, outPoint);
        if (bufferedAmount >= Math.min(config.bufferThreshold, clipDuration)) {
          state.status = 'ready';
          emitEvent('load-ready', clipId);
        }
      }
    }
  }, [config.bufferThreshold, emitEvent]);
  
  /**
   * 获取所有活跃的 clip ID 列表
   */
  const getActiveClipIds = useCallback((): string[] => {
    return Array.from(clipVideosRef.current.keys());
  }, []);
  
  /**
   * 获取活跃视频数量
   */
  const getActiveCount = useCallback((): number => {
    return clipVideosRef.current.size;
  }, []);
  
  /**
   * 执行 LRU 淘汰，保持活跃数量在限制内
   * @param keepClipIds 不要淘汰这些 clip（当前播放窗口内的）
   * @returns 被淘汰的 clip ID 列表
   */
  const evictLRU = useCallback((keepClipIds: string[]): string[] => {
    const keepSet = new Set(keepClipIds);
    const evictedIds: string[] = [];
    
    // 如果没超过限制，不需要淘汰
    if (clipVideosRef.current.size <= config.maxActiveVideos) {
      return evictedIds;
    }
    
    // 按最后访问时间排序，最久未访问的在前面
    const sorted = Array.from(clipVideosRef.current.entries())
      .filter(([id]) => !keepSet.has(id)) // 排除需要保留的
      .sort((a, b) => a[1].lastAccessTime - b[1].lastAccessTime);
    
    // 计算需要淘汰多少个
    const toEvict = clipVideosRef.current.size - config.maxActiveVideos;
    
    for (let i = 0; i < toEvict && i < sorted.length; i++) {
      const [clipId] = sorted[i];
      destroyVideoForClip(clipId);
      evictedIds.push(clipId);
    }
    
    if (evictedIds.length > 0) {
      log('LRU 淘汰:', evictedIds.length, '个视频');
    }
    
    return evictedIds;
  }, [config.maxActiveVideos, destroyVideoForClip]);
  
  /**
   * 清空所有资源
   */
  const destroyAll = useCallback(() => {
    const ids = Array.from(clipVideosRef.current.keys());
    for (const clipId of ids) {
      destroyVideoForClip(clipId);
    }
    log('已清空所有视频资源');
  }, [destroyVideoForClip]);
  
  return {
    getClipVideo,
    createVideoForClip,
    destroyVideoForClip,
    isClipReady,
    isClipBuffered,
    getClipBufferedAmount: getClipBufferedAmountFn,
    touchClip,
    refreshClipBufferState,
    getActiveClipIds,
    getActiveCount,
    evictLRU,
    destroyAll,
    config,
  };
}
