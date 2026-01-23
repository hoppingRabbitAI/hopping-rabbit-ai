/**
 * VideoCanvas - Store 集成版本 (新 UI + 完整功能)
 * 
 * 现代化的视频画布组件，特点：
 * - 悬浮式控制栏（hover 显示）
 * - 毛玻璃效果
 * - HLS 流式播放（低内存占用，支持任意时长视频）
 * - 多轨道音视频同步
 * - 关键帧动画
 * - RAF 时间同步
 */

'use client';

import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import Hls, { Events, ErrorTypes, HlsConfig } from 'hls.js';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw
} from 'lucide-react';
import { useEditorStore } from '../../store/editor-store';
import { msToSec, secToMs } from '../../lib/time-utils';
import { getClipTransformAtOffset } from '../../lib/keyframe-interpolation';
import { TransformOverlay } from '../TransformOverlay';
import { TextOverlay } from '../TextOverlay';
import { BlockingLoader } from '../BlockingLoader';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import type { Clip } from '../../types/clip';
import type { Keyframe } from '../../types/keyframe';
import { getAssetProxyUrl, getHlsPlaylistUrl, checkHlsAvailable } from '@/lib/api/media-proxy';

const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
// 视频播放/缓冲专用调试日志（★ 调试多素材播放问题，临时开启）
const DEBUG_VIDEO_BUFFER = true;
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[VideoCanvas]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[VideoCanvas]', ...args); };
const bufferLog = (...args: unknown[]) => { if (DEBUG_VIDEO_BUFFER) console.log('[VideoBuffer]', ...args); };

type AspectRatio = '16:9' | '9:16' | '1:1';

const ASPECT_RATIOS: Record<AspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const SEEK_THRESHOLD = 0.05;        // seek 阈值（秒）- 50ms 精度
const AUDIO_DRIFT_THRESHOLD = 0.08; // 音频漂移阈值（秒）- 80ms 精度
const SEEK_DEBOUNCE_MS = 100;       // seek 防抖间隔（毫秒）
const STORE_UPDATE_INTERVAL = 33;   // 30fps 节流 store 更新

// ★ 音量转换：clip.volume 范围 0-2，但 HTMLMediaElement.volume 只支持 0-1
// 超过 1 的部分需要通过 Web Audio API 的 GainNode 实现，暂时先限制到 1
const clampVolume = (vol: number | undefined): number => Math.min(1, Math.max(0, vol ?? 1));

// ★★★ HLS 流式播放配置 ★★★
const HLS_CONFIG: Partial<HlsConfig> = {
  maxBufferLength: 30,           // 最大缓冲 30 秒
  maxMaxBufferLength: 60,        // 极限缓冲 60 秒
  maxBufferSize: 60 * 1000 * 1000, // 60MB 缓冲上限
  maxBufferHole: 0.5,            // 允许的缓冲空洞
  manifestLoadingTimeOut: 10000,  // playlist 加载超时 10s
  manifestLoadingMaxRetry: 3,     // 重试 3 次
  levelLoadingTimeOut: 10000,
  fragLoadingTimeOut: 20000,
  fragLoadingMaxRetry: 6,
  lowLatencyMode: false,
  startLevel: -1,
  startPosition: -1,
  debug: false,
};

// ★★★ HLS 源缓存：assetId -> { url, type, hlsInstance } ★★★
interface HlsSourceInfo {
  url: string;
  type: 'hls' | 'mp4' | 'transcoding';  // ★ 新增 transcoding 状态
  checked: boolean;
  needsTranscode?: boolean;  // ★ 是否需要转码
  hlsStatus?: string;        // ★ HLS 生成状态
}
const hlsSourceCache = new Map<string, HlsSourceInfo>();
const hlsInstanceCache = new Map<string, Hls>(); // assetId -> Hls instance

// ★★★ 视频预热池：提前加载下一个 clip 的视频 ★★★
interface PreheatedVideo {
  assetId: string;
  videoElement: HTMLVideoElement;
  hlsInstance: Hls | null;
  sourceInfo: HlsSourceInfo;
  readyState: number;        // 视频 readyState
  bufferedPercent: number;   // 缓冲百分比
  preheatedAt: number;       // 预热时间戳
}
const videoPreloadPool = new Map<string, PreheatedVideo>();
const preloadingAssets = new Set<string>(); // 正在预加载的资源ID
const preloadPromises = new Map<string, Promise<boolean>>(); // ★ 预热 Promise 缓存，避免重复请求

// ★ HLS 源请求 Promise 缓存，避免并发请求导致重复调用 API
const hlsSourcePromises = new Map<string, Promise<HlsSourceInfo>>();

/** 获取资源的 HLS 源信息（带缓存 + 防并发）*/
async function getHlsSource(assetId: string): Promise<HlsSourceInfo> {
  bufferLog('🔍 getHlsSource:', assetId.slice(-8));
  
  // 1. 检查缓存（但如果是 transcoding 状态，需要重新检查）
  const cached = hlsSourceCache.get(assetId);
  if (cached?.checked && cached.type !== 'transcoding') {
    bufferLog('  ↳ 使用缓存:', cached.type);
    return cached;
  }
  
  // 2. ★ 检查是否有正在进行的请求（防止并发重复调用）
  const existingPromise = hlsSourcePromises.get(assetId);
  if (existingPromise) {
    bufferLog('  ↳ 等待已有请求...');
    return existingPromise;
  }
  
  // 3. 创建新请求并缓存 Promise
  const fetchPromise = (async (): Promise<HlsSourceInfo> => {
    try {
      bufferLog('  ↳ 调用 checkHlsAvailable...');
      const status = await checkHlsAvailable(assetId);
      bufferLog('  ↳ HLS 状态:', status);
      
      let info: HlsSourceInfo;
    
    if (status.available) {
      // HLS 已就绪，但需要验证 playlist 真的可以访问
      const playlistUrl = getHlsPlaylistUrl(assetId);
      bufferLog('  ↳ 验证 HLS playlist:', playlistUrl);
      
      try {
        const checkResponse = await fetch(playlistUrl, { method: 'HEAD' });
        if (!checkResponse.ok) {
          // ★★★ HLS 状态说可用，但 playlist 实际不存在！这是严重错误！★★★
          throw new Error(`HLS playlist 不可访问！status=${checkResponse.status}, url=${playlistUrl}`);
        }
        bufferLog('  ✓ HLS playlist 可访问');
      } catch (fetchError) {
        // ★★★ 网络错误或 playlist 不存在 ★★★
        throw new Error(`HLS playlist 获取失败！url=${playlistUrl}, error=${fetchError}`);
      }
      
      info = { 
        url: playlistUrl, 
        type: 'hls', 
        checked: true,
        needsTranscode: status.needsTranscode,
        hlsStatus: status.hlsStatus ?? undefined,
      };
    } else if (status.needsTranscode && !status.canPlayMp4) {
      // ★ 需要转码但 HLS 未就绪 → 显示"转码中"
      info = { 
        url: '', 
        type: 'transcoding', 
        checked: true,
        needsTranscode: true,
        hlsStatus: status.hlsStatus ?? undefined,
      };
      bufferLog('⏳ 视频转码中:', assetId.slice(-8), 'hlsStatus:', status.hlsStatus);
    } else {
      // 可以直接播放 MP4
      info = { 
        url: getAssetProxyUrl(assetId), 
        type: 'mp4', 
        checked: true,
        needsTranscode: status.needsTranscode,
        hlsStatus: status.hlsStatus ?? undefined,
      };
    }
    
    hlsSourceCache.set(assetId, info);
    bufferLog('📡 HLS 源:', assetId.slice(-8), '→', info.type.toUpperCase());
    return info;
  } catch (error) {
    // ★★★ 不再静默回退到 MP4，直接抛出异常 ★★★
    bufferLog('  ❌ getHlsSource 失败:', error);
    throw error;
  } finally {
    // ★ 请求完成后清理 Promise 缓存
    hlsSourcePromises.delete(assetId);
  }
  })();
  
  // 缓存 Promise
  hlsSourcePromises.set(assetId, fetchPromise);
  return fetchPromise;
}

/** 
 * ★★★ 预热视频资源 ★★★
 * 提前初始化 HLS 实例并开始缓冲，确保切换时秒播
 * 
 * 优化：使用 Promise 缓存，多个调用者共享同一个预热过程
 */
export async function preheatVideo(assetId: string): Promise<boolean> {
  // 已经预热过了
  if (videoPreloadPool.has(assetId)) {
    bufferLog('🔥 视频已预热:', assetId.slice(-8));
    return true;
  }
  
  // ★ 正在预热中，返回现有的 Promise（共享预热过程）
  const existingPromise = preloadPromises.get(assetId);
  if (existingPromise) {
    bufferLog('⏳ 视频正在预热中，等待共享结果:', assetId.slice(-8));
    return existingPromise;
  }
  
  // ★ 创建新的预热 Promise 并缓存
  const preheatPromise = doPreheatVideo(assetId);
  preloadPromises.set(assetId, preheatPromise);
  
  try {
    return await preheatPromise;
  } finally {
    // 预热完成后清理 Promise 缓存
    preloadPromises.delete(assetId);
  }
}

/** 实际执行预热的内部函数 */
async function doPreheatVideo(assetId: string): Promise<boolean> {
  preloadingAssets.add(assetId);
  bufferLog('🔥 开始预热视频:', assetId.slice(-8));
  
  try {
    // ★★★ Safari 检测：只有真正的 Safari 才跳过预热 ★★★
    // Safari 不会为 visibility:hidden 的视频元素加载 HLS
    // 使用 UA 检测更准确，因为 Chrome macOS 也可能支持原生 HLS
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isSafari) {
      bufferLog('⏭️ Safari 浏览器：跳过预热（Safari 不支持隐藏元素加载 HLS）');
      return false;
    }
    
    // 获取 HLS 源信息
    const sourceInfo = await getHlsSource(assetId);
    
    // ★ 如果视频正在转码中，跳过预热（稍后重试）
    if (sourceInfo.type === 'transcoding') {
      bufferLog('⏳ 视频转码中，跳过预热:', assetId.slice(-8), 'hlsStatus:', sourceInfo.hlsStatus);
      preloadingAssets.delete(assetId);
      return false;
    }
    
    // 创建隐藏的 video 元素
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = true;
    video.style.position = 'absolute';
    video.style.visibility = 'hidden';
    video.style.pointerEvents = 'none';
    video.style.width = '1px';
    video.style.height = '1px';
    document.body.appendChild(video);
    
    let hlsInstance: Hls | null = null;
    
    // ★★★ 修复：使用 Promise 包装整个加载过程，正确处理 HLS 事件 ★★★
    const loadPromise = new Promise<void>((resolve, reject) => {
      let resolved = false;
      
      const onReady = () => {
        if (resolved) return;
        resolved = true;
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('error', onError);
        bufferLog('  ✓ 视频元素就绪:', assetId.slice(-8), 'readyState:', video.readyState);
        resolve();
      };
      
      const onError = (e: Event) => {
        if (resolved) return;
        resolved = true;
        bufferLog('  ✗ 视频加载失败:', assetId.slice(-8), e);
        reject(new Error('Video load error'));
      };
      
      video.addEventListener('canplay', onReady);
      video.addEventListener('loadeddata', onReady);
      video.addEventListener('error', onError);
      
      if (sourceInfo.type === 'hls') {
        // 检查浏览器是否原生支持 HLS (Safari)
        // 注：这个分支在 Safari 中不应该执行，因为上面已经提前返回了
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          bufferLog('  → Safari 原生 HLS（不应该到达这里）');
          video.src = sourceInfo.url;
          video.load();
        } else if (Hls.isSupported()) {
          bufferLog('  → HLS.js 模式');
          hlsInstance = new Hls(HLS_CONFIG);
          
          // ★★★ 关键：监听 HLS.js 的 MANIFEST_PARSED 事件 ★★★
          hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            bufferLog('  ✓ HLS manifest 解析完成:', assetId.slice(-8));
            // ★★★ manifest 解析完成后直接 resolve ★★★
            // 不需要等 canplay，因为 HLS 是分片加载的，预热只需确保 manifest 可用
            if (!resolved) {
              onReady();
            }
          });
          
          hlsInstance.on(Hls.Events.FRAG_BUFFERED, () => {
            // 有分片缓冲完成，可以提前 resolve
            if (!resolved && video.readyState >= 2) {
              onReady();
            }
          });
          
          hlsInstance.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              bufferLog('  ✗ HLS 致命错误:', assetId.slice(-8), data.type, data.details);
              if (!resolved) {
                resolved = true;
                reject(new Error(`HLS error: ${data.details}`));
              }
            }
          });
          
          hlsInstance.loadSource(sourceInfo.url);
          hlsInstance.attachMedia(video);
          hlsInstanceCache.set(assetId, hlsInstance);
        } else {
          // 回退到 MP4
          bufferLog('  → 回退到 MP4');
          video.src = getAssetProxyUrl(assetId);
          video.load();
        }
      } else {
        video.src = sourceInfo.url;
        video.load();
      }
      
      // 超时保护 30 秒（HLS 需要下载 manifest + 第一个分片，远程存储可能较慢）
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const errorDetail = {
            assetId: assetId.slice(-8),
            readyState: video.readyState,
            networkState: video.networkState,
            error: video.error?.message || video.error?.code || null,
            sourceType: sourceInfo.type,
            sourceUrl: sourceInfo.url,
            currentSrc: video.currentSrc,
            duration: video.duration,
          };
          bufferLog('  ⚠️ 预热超时（不影响播放）:', errorDetail);
          
          // ★★★ 预热超时不抛异常，只是返回失败 ★★★
          // 播放时会重新加载，预热失败不影响使用
          resolve();
        }
      }, 30000);
    });
    
    await loadPromise;
    
    // 计算缓冲百分比
    const bufferedPercent = video.duration > 0 && video.buffered.length > 0
      ? Math.round((video.buffered.end(video.buffered.length - 1) / video.duration) * 100)
      : 0;
    
    // ★ 二次检查：确保视频至少有元数据（readyState >= 1）
    // 对于 HLS，只要有 hlsInstance 就算预热成功（manifest 已解析）
    if (video.readyState < 1 && !hlsInstance) {
      // 清理 HLS 实例
      const hlsToClean = hlsInstanceCache.get(assetId);
      if (hlsToClean) {
        hlsToClean.destroy();
        hlsInstanceCache.delete(assetId);
      }
      if (video.parentNode) video.parentNode.removeChild(video);
      preloadingAssets.delete(assetId);
      
      // ★ 预热失败不再抛异常，只返回 false
      bufferLog('⚠️ 视频预热后仍无元数据（不影响播放）:', assetId.slice(-8));
      return false;
    }
    
    // 保存到预热池
    videoPreloadPool.set(assetId, {
      assetId,
      videoElement: video,
      hlsInstance,
      sourceInfo,
      readyState: video.readyState,
      bufferedPercent,
      preheatedAt: Date.now(),
    });
    
    bufferLog('✅ 视频预热完成:', assetId.slice(-8), 
      '| readyState:', video.readyState,
      '| 缓冲:', bufferedPercent + '%');
    
    return true;
  } catch (error) {
    // ★ 预热失败不影响播放，只记录警告
    bufferLog('⚠️ 视频预热失败（不影响播放）:', assetId.slice(-8), error);
    return false;
  } finally {
    preloadingAssets.delete(assetId);
  }
}

/** 获取预热池中的视频 */
export function getPreheatedVideo(assetId: string): PreheatedVideo | undefined {
  const preheated = videoPreloadPool.get(assetId);
  if (!preheated) return undefined;
  
  // ★ 动态更新 readyState（视频可能在保存后继续加载）
  preheated.readyState = preheated.videoElement.readyState;
  if (preheated.videoElement.duration > 0 && preheated.videoElement.buffered.length > 0) {
    preheated.bufferedPercent = Math.round(
      (preheated.videoElement.buffered.end(preheated.videoElement.buffered.length - 1) / preheated.videoElement.duration) * 100
    );
  }
  
  return preheated;
}

/**
 * ★★★ 更新预热池中的视频元素 ★★★
 * 当主编辑器创建的新视频成功加载后，用它替换预热池中未成功加载的视频
 * 这样弹窗就可以复用主编辑器已加载的视频，实现秒开
 */
export function updatePreheatedVideo(assetId: string, videoElement: HTMLVideoElement): void {
  const existing = videoPreloadPool.get(assetId);
  
  // 如果新视频元素的 readyState 更好，就替换
  if (!existing || videoElement.readyState > existing.readyState) {
    // 销毁旧的隐藏视频元素（如果存在且不同）
    if (existing && existing.videoElement !== videoElement) {
      if (existing.hlsInstance) {
        existing.hlsInstance.destroy();
      }
      if (existing.videoElement.parentNode) {
        existing.videoElement.parentNode.removeChild(existing.videoElement);
      }
    }
    
    // 获取 HLS 源信息
    const sourceInfo = hlsSourceCache.get(assetId) || { url: '', type: 'mp4' as const, checked: false };
    
    // 更新预热池
    videoPreloadPool.set(assetId, {
      assetId,
      videoElement,
      hlsInstance: null, // 主编辑器的视频，HLS 由外部管理
      sourceInfo,
      readyState: videoElement.readyState,
      bufferedPercent: videoElement.duration > 0 && videoElement.buffered.length > 0
        ? Math.round((videoElement.buffered.end(videoElement.buffered.length - 1) / videoElement.duration) * 100)
        : 0,
      preheatedAt: Date.now(),
    });
    
    bufferLog('🔄 预热池已更新:', assetId.slice(-8), 'readyState:', videoElement.readyState);
  }
}

/** 
 * ★★★ 从预热池中获取可用的 video 元素 ★★★
 * 如果预热池有已加载的元素，直接返回使用
 * 这样切换 asset 时可以即时显示，无需重新加载
 */
export function getOrCreateVideoElement(assetId: string, fallbackUrl: string): {
  element: HTMLVideoElement;
  isPreheated: boolean;
  hlsInstance: Hls | null;
} {
  const preheated = videoPreloadPool.get(assetId);
  
  if (preheated && preheated.readyState >= 2) {
    bufferLog('🎯 使用预热池中的 video 元素:', assetId.slice(-8));
    return {
      element: preheated.videoElement,
      isPreheated: true,
      hlsInstance: preheated.hlsInstance,
    };
  }
  
  // 没有预热，创建新元素
  bufferLog('📦 创建新的 video 元素:', assetId.slice(-8));
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.src = fallbackUrl;
  
  return {
    element: video,
    isPreheated: false,
    hlsInstance: null,
  };
}

/** 检查视频是否已预热就绪 */
export function isVideoPreheated(assetId: string): boolean {
  const preheated = videoPreloadPool.get(assetId);
  return preheated !== undefined && preheated.readyState >= 2;
}

/** 获取视频预热状态 */
export function getVideoReadyState(assetId: string): number {
  const preheated = videoPreloadPool.get(assetId);
  return preheated?.readyState ?? 0;
}

/** 清理 HLS 缓存（切换项目时调用）*/
export function clearHlsCache(): void {
  // 清理 HLS 实例
  hlsInstanceCache.forEach(hls => hls.destroy());
  hlsInstanceCache.clear();
  hlsSourceCache.clear();
  
  // 清理预热池
  videoPreloadPool.forEach(({ videoElement, hlsInstance }) => {
    if (hlsInstance) hlsInstance.destroy();
    if (videoElement.parentNode) {
      videoElement.parentNode.removeChild(videoElement);
    }
  });
  videoPreloadPool.clear();
  preloadingAssets.clear();
  
  bufferLog('🗑️ HLS 缓存 + 预热池已清理');
}

/** 
 * ★★★ 深度预热视频（用于短项目）★★★
 * 等待视频缓冲到指定百分比或全部缓冲完成
 */
export async function deepPreheatVideo(assetId: string, minBufferPercent: number = 80): Promise<boolean> {
  // 先执行基础预热
  const basicSuccess = await preheatVideo(assetId);
  if (!basicSuccess) return false;
  
  const poolEntry = videoPreloadPool.get(assetId);
  if (!poolEntry) return false;
  
  const video = poolEntry.videoElement;
  
  // 检查是否已经缓冲足够
  const getBufferPercent = () => {
    if (!video.duration || video.duration === 0) return 0;
    if (video.buffered.length === 0) return 0;
    return Math.round((video.buffered.end(video.buffered.length - 1) / video.duration) * 100);
  };
  
  let currentBuffer = getBufferPercent();
  if (currentBuffer >= minBufferPercent) {
    bufferLog('✅ 深度预热完成（已达标）:', assetId.slice(-8), '| 缓冲:', currentBuffer + '%');
    return true;
  }
  
  bufferLog('⏳ 深度预热中:', assetId.slice(-8), '| 当前:', currentBuffer + '%', '| 目标:', minBufferPercent + '%');
  
  // 等待缓冲到指定百分比
  return new Promise<boolean>((resolve) => {
    const checkInterval = 200; // 每200ms检查一次
    const maxWait = 10000; // 最多等10秒
    let elapsed = 0;
    
    const check = () => {
      currentBuffer = getBufferPercent();
      elapsed += checkInterval;
      
      if (currentBuffer >= minBufferPercent) {
        bufferLog('✅ 深度预热完成:', assetId.slice(-8), '| 缓冲:', currentBuffer + '%');
        resolve(true);
        return;
      }
      
      if (elapsed >= maxWait) {
        bufferLog('⚠️ 深度预热超时:', assetId.slice(-8), '| 缓冲:', currentBuffer + '%');
        resolve(true); // 超时也返回 true，允许继续
        return;
      }
      
      setTimeout(check, checkInterval);
    };
    
    setTimeout(check, checkInterval);
  });
}

/** 
 * ★★★ 按顺序深度预热视频资源（用于短项目）★★★
 * 串行预热并等待每个视频缓冲到足够百分比
 */
export async function deepPreheatVideosInOrder(assetIds: string[], minBufferPercent: number = 80): Promise<void> {
  const uniqueIds = Array.from(new Set(assetIds)).filter(id => id && !videoPreloadPool.has(id));
  
  if (uniqueIds.length === 0) {
    bufferLog('🔥 所有视频已深度预热');
    return;
  }
  
  bufferLog('🔥 开始深度预热视频，数量:', uniqueIds.length, '| 目标缓冲:', minBufferPercent + '%');
  
  for (let i = 0; i < uniqueIds.length; i++) {
    const id = uniqueIds[i];
    bufferLog(`🔥 [${i + 1}/${uniqueIds.length}] 深度预热视频:`, id.slice(-8));
    await deepPreheatVideo(id, minBufferPercent);
  }
  
  bufferLog('🎉 所有视频深度预热完成');
}

/** 
 * ★★★ 按顺序预热视频资源 ★★★
 * 按时间轴顺序串行预热，确保前面的视频先就绪
 */
export async function preheatVideosInOrder(assetIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(assetIds)).filter(id => id && !videoPreloadPool.has(id));
  
  if (uniqueIds.length === 0) {
    bufferLog('🔥 所有视频已预热');
    return;
  }
  
  bufferLog('🔥 按顺序预热视频，数量:', uniqueIds.length);
  
  // ★★★ 串行预热：确保按顺序完成 ★★★
  for (let i = 0; i < uniqueIds.length; i++) {
    const id = uniqueIds[i];
    bufferLog(`🔥 [${i + 1}/${uniqueIds.length}] 预热视频:`, id.slice(-8));
    await preheatVideo(id);
  }
  
  bufferLog('🎉 所有视频按顺序预热完成');
}

/** 预热所有项目中的视频资源（并行，用于非关键场景） */
export async function preheatAllVideos(assetIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(assetIds)).filter(id => id && !videoPreloadPool.has(id));
  
  if (uniqueIds.length === 0) {
    bufferLog('🔥 所有视频已预热');
    return;
  }
  
  bufferLog('🔥 并行预热所有视频，数量:', uniqueIds.length);
  
  // 并行预热所有视频
  await Promise.all(uniqueIds.map(id => preheatVideo(id)));
  
  bufferLog('🎉 所有视频预热完成');
}

// 全局媒体缓存
const globalMediaCache = new Map<string, HTMLVideoElement | HTMLAudioElement>();
const mediaLoadingPromises = new Map<string, Promise<void>>();
const videoBufferProgress = new Map<string, number>();
const videoBufferCallbacks = new Map<string, Set<(progress: number) => void>>();
const backgroundBufferingUrls = new Set<string>();

// ★★★ Blob URL 缓存：视频完全下载到内存后的本地 URL ★★★
const videoBlobUrlCache = new Map<string, string>();  // 原始 URL -> Blob URL
const videoBlobCache = new Map<string, Blob>();       // 原始 URL -> Blob 数据
let allVideosFullyBuffered = false;  // 标记是否所有视频都已完全缓冲

/** 检查是否所有视频都已完全缓冲 */
export function areAllVideosFullyBuffered(): boolean {
  return allVideosFullyBuffered;
}

/** 获取视频的 Blob URL（如果已缓冲）或原始 URL */
export function getBufferedVideoUrl(originalUrl: string): string {
  return videoBlobUrlCache.get(originalUrl) || originalUrl;
}

/** 检查视频是否已有 Blob 缓存 */
export function hasVideoBlobCache(originalUrl: string): boolean {
  return videoBlobUrlCache.has(originalUrl);
}

/**
 * ★★★ 完全下载视频到内存（Blob）★★★
 * 确保视频 100% 本地化，播放时无任何网络依赖
 */
export async function downloadVideoToBlob(
  url: string, 
  onProgress?: (percent: number) => void
): Promise<string> {
  // 已有缓存直接返回
  if (videoBlobUrlCache.has(url)) {
    bufferLog('✓ 视频已有 Blob 缓存:', url.slice(-40));
    onProgress?.(100);
    return videoBlobUrlCache.get(url)!;
  }
  
  bufferLog('⬇️ 开始完全下载视频:', url.slice(-50));
  const startTime = performance.now();
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    
    if (!response.body) {
      throw new Error('响应没有 body');
    }
    
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      received += value.length;
      
      if (total > 0) {
        const percent = Math.round((received / total) * 100);
        onProgress?.(percent);
        updateBufferProgress(url, percent);
      }
    }
    
    // 合并所有 chunks 创建 Blob
    const blob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    
    // 缓存
    videoBlobCache.set(url, blob);
    videoBlobUrlCache.set(url, blobUrl);
    updateBufferProgress(url, 100);
    
    const elapsed = performance.now() - startTime;
    const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
    bufferLog('✅ 视频下载完成:', url.slice(-40), '| 大小:', sizeMB, 'MB | 耗时:', Math.round(elapsed), 'ms');
    
    return blobUrl;
    
  } catch (error) {
    debugError('❌ 视频下载失败:', url.slice(-40), error);
    throw error;
  }
}

/**
 * ★★★ 预缓冲所有视频到内存 ★★★
 * 在编辑器加载时调用，确保所有视频 100% 本地化
 * @returns 缓冲进度回调的取消函数
 */
export async function preloadAllVideosToBlob(
  videoUrls: string[],
  onProgress?: (overallPercent: number, currentUrl: string) => void
): Promise<void> {
  if (videoUrls.length === 0) {
    allVideosFullyBuffered = true;
    return;
  }
  
  bufferLog('🚀 开始预缓冲所有视频, 数量:', videoUrls.length);
  allVideosFullyBuffered = false;
  
  const progressMap = new Map<string, number>();
  videoUrls.forEach(url => progressMap.set(url, 0));
  
  const updateOverallProgress = () => {
    const total = Array.from(progressMap.values()).reduce((sum, p) => sum + p, 0);
    const overall = Math.round(total / progressMap.size);
    return overall;
  };
  
  // 并行下载所有视频
  await Promise.all(
    videoUrls.map(async (url) => {
      try {
        await downloadVideoToBlob(url, (percent) => {
          progressMap.set(url, percent);
          const overall = updateOverallProgress();
          onProgress?.(overall, url);
        });
      } catch (error) {
        debugError('预缓冲失败:', url.slice(-40), error);
        progressMap.set(url, 100); // 即使失败也标记完成，避免卡住
      }
    })
  );
  
  allVideosFullyBuffered = true;
  bufferLog('🎉 所有视频预缓冲完成!');
}

/** 清理 Blob 缓存（切换项目时调用）*/
export function clearVideoBlobCache(): void {
  videoBlobUrlCache.forEach((blobUrl) => {
    URL.revokeObjectURL(blobUrl);
  });
  videoBlobUrlCache.clear();
  videoBlobCache.clear();
  allVideosFullyBuffered = false;
  bufferLog('🗑️ Blob 缓存已清理');
}

/** 获取视频缓冲进度 (0-100) */
export function getVideoBufferProgress(url: string): number {
  return videoBufferProgress.get(url) || 0;
}

/** 订阅视频缓冲进度更新 */
export function subscribeBufferProgress(url: string, callback: (progress: number) => void): () => void {
  if (!videoBufferCallbacks.has(url)) {
    videoBufferCallbacks.set(url, new Set());
  }
  videoBufferCallbacks.get(url)!.add(callback);
  callback(getVideoBufferProgress(url));
  
  return () => {
    videoBufferCallbacks.get(url)?.delete(callback);
  };
}

function updateBufferProgress(url: string, progress: number) {
  videoBufferProgress.set(url, progress);
  videoBufferCallbacks.get(url)?.forEach(cb => cb(progress));
}

/** 计算视频已缓冲的百分比 */
function calculateBufferedPercent(video: HTMLVideoElement): number {
  if (!video.duration || video.duration === Infinity) return 0;
  
  const buffered = video.buffered;
  if (buffered.length === 0) return 0;
  
  let totalBuffered = 0;
  for (let i = 0; i < buffered.length; i++) {
    const start = buffered.start(i);
    const end = buffered.end(i);
    totalBuffered += end - start;
  }
  
  const percent = Math.min(100, Math.round((totalBuffered / video.duration) * 100));
  
  // 缓冲进度日志太频繁，移除轮询打印
  return percent;
}

/** 检查视频是否已在缓存中加载到可播放状态 */
export function isVideoCached(url: string): boolean {
  const cacheKey = `video:${url}`;
  const element = globalMediaCache.get(cacheKey);
  return element ? element.readyState >= 2 : false;
}

/** 后台持续缓冲视频 */
export function bufferVideoInBackground(url: string, videoElement?: HTMLVideoElement): void {
  if (backgroundBufferingUrls.has(url)) return;
  
  const cacheKey = `video:${url}`;
  const targetVideo = videoElement || (globalMediaCache.get(cacheKey) as HTMLVideoElement);
  
  if (!targetVideo) return;
  
  const bufferedPercent = calculateBufferedPercent(targetVideo);
  if (bufferedPercent >= 99) {
    updateBufferProgress(url, 100);
    return;
  }
  
  debugLog('Starting background buffering:', url.slice(-30), 'current:', bufferedPercent + '%');
  backgroundBufferingUrls.add(url);
  
  let checkInterval: ReturnType<typeof setInterval> | null = null;
  
  const cleanup = () => {
    if (checkInterval) clearInterval(checkInterval);
    backgroundBufferingUrls.delete(url);
  };
  
  const handleProgress = () => {
    const currentBuffered = calculateBufferedPercent(targetVideo);
    updateBufferProgress(url, currentBuffered);
    
    if (currentBuffered >= 99) {
      cleanup();
      targetVideo.removeEventListener('progress', handleProgress);
    }
  };
  
  targetVideo.addEventListener('progress', handleProgress);
  
  checkInterval = setInterval(() => {
    const currentBuffered = calculateBufferedPercent(targetVideo);
    updateBufferProgress(url, currentBuffered);
    if (currentBuffered >= 99) cleanup();
  }, 2000);
  
  // 超时保护（3分钟）
  setTimeout(() => {
    if (backgroundBufferingUrls.has(url)) {
      cleanup();
      targetVideo.removeEventListener('progress', handleProgress);
    }
  }, 180000);
}

/**
 * 预加载视频到全局缓存
 * @param url 视频 URL
 * @param waitForFullBuffer 是否等待完全缓冲（默认 false，只等 canplay）
 */
export function preloadVideoToCache(url: string, waitForFullBuffer: boolean = false): Promise<boolean> {
  return new Promise((resolve) => {
    const cacheKey = `video:${url}`;
    
    bufferLog('▶ 开始预加载视频:', url.slice(-50));
    
    // 检查是否已经在缓存中
    if (globalMediaCache.has(cacheKey)) {
      const existing = globalMediaCache.get(cacheKey)! as HTMLVideoElement;
      const bufferedPercent = calculateBufferedPercent(existing);
      
      // 移除高频日志：视频已在缓存中

      if (bufferedPercent >= 99) {
        updateBufferProgress(url, 100);
        resolve(true);
        return;
      }
      
      if (!waitForFullBuffer && existing.readyState >= 3) {
        resolve(true);
        return;
      }
      
      // 已在加载中，等待完成
      const promise = mediaLoadingPromises.get(cacheKey);
      if (promise) {
        // 移除高频日志：视频正在加载中
        promise.then(() => resolve(existing.readyState >= 2));
        return;
      }
    }
    
    // 移除高频日志：创建新的 video 元素
    const startTime = performance.now();
    
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = true;
    video.src = url;
    
    // 启动后台缓冲
    // ★ 注意：必须在 play() Promise resolve 后才能调用 pause()
    // 否则会报错: "play() interrupted by pause()"
    const startBackgroundBuffering = () => {
      video.play().then(() => {
        // 在 play() 成功后立即暂停，避免竞争问题
        video.pause();
        video.currentTime = 0;
      }).catch(() => {
        if (video.duration && video.duration !== Infinity) {
          const seekPoints = [0, video.duration * 0.25, video.duration * 0.5, video.duration * 0.75];
          let seekIndex = 0;
          const doSeek = () => {
            if (seekIndex < seekPoints.length && calculateBufferedPercent(video) < 99) {
              video.currentTime = seekPoints[seekIndex];
              seekIndex++;
              setTimeout(doSeek, 500);
            }
          };
          doSeek();
        }
      });
    };
    
    const loadPromise = new Promise<void>((innerResolve) => {
      let progressInterval: ReturnType<typeof setInterval> | null = null;
      let hasResolved = false;
      
      const checkAndResolve = (force: boolean = false) => {
        if (hasResolved) return;
        
        const bufferedPercent = calculateBufferedPercent(video);
        updateBufferProgress(url, bufferedPercent);
        
        if (waitForFullBuffer && !force) {
          if (bufferedPercent >= 99) {
            // 只在完成时打印日志
            const elapsed = performance.now() - startTime;
            bufferLog('  ✓ 完全缓冲完成, 耗时:', Math.round(elapsed), 'ms');
            cleanup();
            hasResolved = true;
            innerResolve();
            resolve(true);
          }
          return;
        }
        
        if (video.readyState >= 3 || force) {
          // 移除高频日志：可播放状态
          cleanup();
          hasResolved = true;
          innerResolve();
          resolve(true);
        }
      };
      
      const onCanPlay = () => checkAndResolve();
      const onProgress = () => {
        const bufferedPercent = calculateBufferedPercent(video);
        updateBufferProgress(url, bufferedPercent);
        checkAndResolve();
      };
      const onError = () => {
        cleanup();
        if (!hasResolved) {
          hasResolved = true;
          innerResolve();
          resolve(false);
        }
      };
      
      const cleanup = () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('canplaythrough', onCanPlay);
        video.removeEventListener('loadeddata', onCanPlay);
        video.removeEventListener('progress', onProgress);
        video.removeEventListener('error', onError);
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
      };
      
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('canplaythrough', onCanPlay);
      video.addEventListener('loadeddata', onCanPlay);
      video.addEventListener('progress', onProgress);
      video.addEventListener('error', onError);
      
      progressInterval = setInterval(() => {
        const bufferedPercent = calculateBufferedPercent(video);
        updateBufferProgress(url, bufferedPercent);
        checkAndResolve();
      }, 500);
      
      const timeout = waitForFullBuffer ? 60000 : 5000;
      setTimeout(() => {
        if (!hasResolved) {
          debugLog('Preload timeout, readyState:', video.readyState, 'buffered:', calculateBufferedPercent(video) + '%');
          checkAndResolve(true);
        }
      }, timeout);
      
      video.addEventListener('loadedmetadata', () => {
        debugLog('Metadata loaded, starting background buffering');
        startBackgroundBuffering();
      }, { once: true });
    });
    
    mediaLoadingPromises.set(cacheKey, loadPromise);
    globalMediaCache.set(cacheKey, video);
    
    video.load();
  });
}

/** 获取或创建媒体元素 */
function getOrCreateMediaElement(url: string, type: 'video' | 'audio'): HTMLVideoElement | HTMLAudioElement {
  const cacheKey = `${type}:${url}`;
  
  if (globalMediaCache.has(cacheKey)) {
    return globalMediaCache.get(cacheKey)!;
  }
  
  const element = type === 'video' 
    ? document.createElement('video')
    : document.createElement('audio');
  
  element.preload = 'auto';
  element.src = url;
  if (type === 'video') {
    (element as HTMLVideoElement).playsInline = true;
  }
  
  const loadPromise = new Promise<void>((resolve) => {
    if (element.readyState >= 2) {
      resolve();
      return;
    }
    
    const onCanPlay = () => {
      element.removeEventListener('canplay', onCanPlay);
      element.removeEventListener('loadeddata', onCanPlay);
      element.removeEventListener('error', onError);
      resolve();
    };
    
    const onError = () => {
      element.removeEventListener('canplay', onCanPlay);
      element.removeEventListener('loadeddata', onCanPlay);
      element.removeEventListener('error', onError);
      resolve();
    };
    
    element.addEventListener('canplay', onCanPlay);
    element.addEventListener('loadeddata', onCanPlay);
    element.addEventListener('error', onError);
    
    setTimeout(() => {
      element.removeEventListener('canplay', onCanPlay);
      element.removeEventListener('loadeddata', onCanPlay);
      element.removeEventListener('error', onError);
      resolve();
    }, 5000);
  });
  
  mediaLoadingPromises.set(cacheKey, loadPromise);
  element.load();
  globalMediaCache.set(cacheKey, element);
  
  return element;
}

/** 格式化时间 (ms -> MM:SS) */
function formatTime(timeMs: number): string {
  const totalSec = msToSec(timeMs);
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** 查找指定时间点的活跃 clip */
function findActiveClip(clips: Clip[], timeMs: number): Clip | null {
  return clips.find(clip => {
    const clipEnd = clip.start + clip.duration;
    return timeMs >= clip.start && timeMs < clipEnd;
  }) || null;
}

/** 计算媒体内部时间 */
function calcMediaTime(timelineTimeMs: number, clip: Clip): number {
  return msToSec(timelineTimeMs - clip.start + (clip.sourceStart || 0));
}

/** 计算 clip 在指定时间点的 transform 字符串 */
function calcClipTransformStyle(
  clip: Clip,
  timelineTimeMs: number,
  clipKeyframes: Map<string, Keyframe[]> | undefined
): { transform: string; opacity: number } {
  const clipDuration = clip.duration;
  const relativeTime = timelineTimeMs - clip.start;
  const offset = clipDuration > 0 ? Math.max(0, Math.min(1, relativeTime / clipDuration)) : 0;
  
  const kfTransform = getClipTransformAtOffset(clipKeyframes, offset);
  const staticTransform = clip.transform || {};
  
  // ★ Position: 关键帧位置是绝对值，直接使用
  const x = kfTransform.positionX ?? staticTransform.x ?? 0;
  const y = kfTransform.positionY ?? staticTransform.y ?? 0;
  
  // ★★★ Scale: 关键帧 scale 直接表示屏幕显示比例 ★★★
  // 如果有 scale 关键帧，使用关键帧值（1.0 = 填满画布）
  // 如果没有关键帧，使用静态 scale
  const hasScaleKf = kfTransform.scaleX !== undefined || kfTransform.scaleY !== undefined;
  const scaleX = hasScaleKf ? (kfTransform.scaleX ?? 1) : (staticTransform.scale ?? 1);
  const scaleY = hasScaleKf ? (kfTransform.scaleY ?? 1) : (staticTransform.scale ?? 1);
  
  const rotation = kfTransform.rotation ?? staticTransform.rotation ?? 0;
  const opacity = kfTransform.opacity ?? staticTransform.opacity ?? 1;
  const flipH = staticTransform.flipH ?? false;
  const flipV = staticTransform.flipV ?? false;
  
  const transforms: string[] = [];
  if (x !== 0 || y !== 0) transforms.push(`translate3d(${x}px, ${y}px, 0)`);
  if (scaleX !== 1 || scaleY !== 1) transforms.push(`scale3d(${scaleX}, ${scaleY}, 1)`);
  if (rotation !== 0) transforms.push(`rotate(${rotation}deg)`);
  if (flipH || flipV) transforms.push(`scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`);
  
  return {
    transform: transforms.length > 0 ? transforms.join(' ') : '',
    opacity,
  };
}

export function VideoCanvasNew() {
  // Store 状态
  const clips = useEditorStore((s) => s.clips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const isVideoReady = useEditorStore((s) => s.isVideoReady);
  const setIsVideoReady = useEditorStore((s) => s.setIsVideoReady);
  const canvasEditMode = useEditorStore((s) => s.canvasEditMode);
  const canvasAspectRatio = useEditorStore((s) => s.canvasAspectRatio);
  const updateClip = useEditorStore((s) => s.updateClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectClip = useEditorStore((s) => s.selectClip);
  const keyframes = useEditorStore((s) => s.keyframes);
  const setActiveSidebarPanel = useEditorStore((s) => s.setActiveSidebarPanel);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  const videoRefInternal = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);  // ★ 视频容器 ref（可变）
  const progressRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const cachedMediaRef = useRef<Map<string, HTMLVideoElement | HTMLAudioElement>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const audioOnlyRafRef = useRef<number | null>(null);  // ★ 纯音频模式 RAF
  const lastSeekTimeRef = useRef<number>(0);
  const pendingSeekRef = useRef<number | null>(null);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // ★★★ 多视频元素池：每个 assetId 对应一个已挂载的 video 元素 ★★★
  const mountedVideosRef = useRef<Map<string, {
    element: HTMLVideoElement;
    hlsInstance: Hls | null;
    isReady: boolean;
  }>>(new Map());
  const currentAssetIdRef = useRef<string | null>(null);

  // Local state
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekingLabel, setSeekingLabel] = useState<string | null>(null);
  const [bufferProgress, setBufferProgress] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<'loading' | 'buffering'>('loading');
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // ★★★ 追踪视频容器是否已挂载 ★★★
  const [isContainerMounted, setIsContainerMounted] = useState(false);
  const videoContainerCallback = useCallback((node: HTMLDivElement | null) => {
    videoContainerRef.current = node;
    setIsContainerMounted(!!node);
    if (node) {
      bufferLog('📦 视频容器已挂载');
    }
  }, []);
  
  // 使用 state 追踪 video 元素，确保 ref 设置后 useEffect 重新运行
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRefInternal.current = node;
    setVideoElement(node);
  }, []);

  // 分离视频和音频 clips
  const { videoClips, audioClips } = useMemo(() => {
    const video: Clip[] = [];
    const audio: Clip[] = [];
    clips.forEach(c => {
      // ★ 修复：只要有 mediaUrl 或 assetId 就可以播放
      // assetId 可以用来动态生成代理 URL
      if (!c.mediaUrl && !c.assetId) return;
      if (c.clipType === 'video') video.push(c);
      else if (c.clipType === 'audio') audio.push(c);
    });
    bufferLog('📋 Clips 过滤结果: video=', video.length, 'audio=', audio.length, 'total=', clips.length);
    return { videoClips: video, audioClips: audio };
  }, [clips]);

  const primaryVideoClip = videoClips[0] || null;
  
  // 时间线总时长 (移到前面，因为后面需要用)
  const duration = useMemo(() => {
    if (clips.length === 0) return 0;
    return Math.max(...clips.map(c => c.start + c.duration));
  }, [clips]);
  
  // 当前活跃的视频 clip (移到前面，用于确定 videoUrl)
  const activeVideoClip = useMemo(() => 
    findActiveClip(videoClips, currentTime),
    [videoClips, currentTime]
  );
  
  // ★★★ 关键修复：使用 activeVideoClip 的 URL，而不是固定使用第一个 ★★★
  // 如果当前时间没有活跃的 clip，退回到第一个 clip
  const currentVideoClip = activeVideoClip || primaryVideoClip;
  
  // ★ 仅在开发调试时启用：播放头在第一个 clip 之前的警告
  useEffect(() => {
    const firstClipStart = videoClips[0]?.start;
    if (videoClips.length > 0 && firstClipStart !== undefined && currentTime < firstClipStart) {
      console.warn('[VideoBuffer] ⚠️ 播放头在第一个 clip 之前!', {
        currentTime,
        firstClipStart,
        hint: '可能需要等待 compactVideoTrack 执行',
      });
    }
  }, [currentTime, videoClips]);
  
  // ★★★ 智能预热策略：根据项目总时长选择不同策略 ★★★
  // 短项目（<= 30秒）：阻塞等全部预热完，确保流畅播放
  // 长项目（> 30秒）：边播边缓冲，用户可以立即操作
  const SHORT_PROJECT_THRESHOLD = 30; // 30秒以下为短项目
  
  const preheatedRef = useRef<Set<string>>(new Set()); // 记录已预热的 assetId
  const [isPreheatComplete, setIsPreheatComplete] = useState(false);
  const [preheatStrategy, setPreheatStrategy] = useState<'short' | 'long' | null>(null);
  
  // 计算项目总时长
  const projectTotalDuration = useMemo(() => {
    if (videoClips.length === 0) return 0;
    const lastClip = videoClips[videoClips.length - 1];
    return (lastClip.start + (lastClip.duration || 0)) / 1000; // 转换为秒
  }, [videoClips]);
  
  useEffect(() => {
    if (videoClips.length === 0) return;
    
    // 按时间轴顺序收集所有需要预热的 assetId（保持顺序，去重）
    const orderedAssetIds: string[] = [];
    const seen = new Set<string>();
    for (const clip of videoClips) {
      if (clip.assetId && !seen.has(clip.assetId) && !preheatedRef.current.has(clip.assetId)) {
        orderedAssetIds.push(clip.assetId);
        seen.add(clip.assetId);
      }
    }
    
    if (orderedAssetIds.length === 0) {
      setIsPreheatComplete(true);
      return;
    }
    
    orderedAssetIds.forEach(id => preheatedRef.current.add(id));
    
    // ★★★ 根据项目时长选择策略 ★★★
    const isShortProject = projectTotalDuration <= SHORT_PROJECT_THRESHOLD;
    setPreheatStrategy(isShortProject ? 'short' : 'long');
    
    if (isShortProject) {
      // 短项目：深度预热，等待缓冲到80%以上
      bufferLog(`📺 短项目 (${projectTotalDuration.toFixed(1)}s ≤ ${SHORT_PROJECT_THRESHOLD}s)：深度预热全部 ${orderedAssetIds.length} 个视频（目标缓冲80%）`);
      deepPreheatVideosInOrder(orderedAssetIds, 80).then(() => {
        bufferLog('🎉 短项目：所有视频深度预热完成，可流畅播放');
        setIsPreheatComplete(true);
      }).catch((err) => {
        bufferLog('⚠️ 短项目：部分视频预热失败:', err);
        setIsPreheatComplete(true);
      });
    } else {
      // 长项目：后台预热，用户可立即操作
      bufferLog(`📺 长项目 (${projectTotalDuration.toFixed(1)}s > ${SHORT_PROJECT_THRESHOLD}s)：后台预热，用户可立即操作`);
      setIsPreheatComplete(true); // 立即允许操作
      
      // 后台串行预热所有视频
      preheatVideosInOrder(orderedAssetIds).then(() => {
        bufferLog('🎉 长项目：后台预热完成');
      }).catch((err) => {
        bufferLog('⚠️ 长项目：部分视频预热失败:', err);
      });
    }
  }, [videoClips, projectTotalDuration]);
  
  // ★★★ 播放时动态预取：当前clip播放时，预热后续2个视频 ★★★
  useEffect(() => {
    if (!currentVideoClip || videoClips.length <= 1) return;
    
    const currentIndex = videoClips.findIndex(c => c.id === currentVideoClip.id);
    if (currentIndex === -1) return;
    
    // 预热后续 2 个视频（去重 + 过滤已预热的）
    const nextClips = videoClips.slice(currentIndex + 1, currentIndex + 3);
    const nextAssetIds = Array.from(new Set(
      nextClips
        .map(c => c.assetId)
        .filter((id): id is string => !!id && !videoPreloadPool.has(id))
    ));
    
    if (nextAssetIds.length > 0) {
      bufferLog('⏩ 预取后续视频:', nextAssetIds.map(id => id.slice(-8)));
      nextAssetIds.forEach(id => preheatVideo(id));
    }
  }, [currentVideoClip?.id, videoClips]);
  
  // ★★★ HLS 状态管理 ★★★
  const [hlsSource, setHlsSource] = useState<HlsSourceInfo | null>(null);
  const [isHlsLoading, setIsHlsLoading] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  const transcodePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 当前资源 ID
  const currentAssetId = currentVideoClip?.assetId || null;
  
  // ★★★ 转码状态：轮询检查 HLS 是否生成完成 ★★★
  const isTranscoding = hlsSource?.type === 'transcoding';
  
  // 检查 HLS 可用性
  useEffect(() => {
    if (!currentAssetId) {
      setHlsSource(null);
      return;
    }
    
    // 避免重复检查（但如果是 transcoding 状态，需要允许轮询刷新）
    if (currentAssetIdRef.current === currentAssetId && hlsSource && hlsSource.type !== 'transcoding') {
      return;
    }
    
    setIsHlsLoading(true);
    currentAssetIdRef.current = currentAssetId;
    
    getHlsSource(currentAssetId)
      .then((source) => {
        setHlsSource(source);
        bufferLog('🎬 视频源类型:', source.type.toUpperCase(), '| URL:', source.url.slice(-50));
      })
      .finally(() => {
        setIsHlsLoading(false);
      });
  }, [currentAssetId]);
  
  // ★★★ 轮询检查转码状态 ★★★
  useEffect(() => {
    // 清理之前的轮询
    if (transcodePollRef.current) {
      clearInterval(transcodePollRef.current);
      transcodePollRef.current = null;
    }
    
    // 如果正在转码，启动轮询
    if (isTranscoding && currentAssetId) {
      bufferLog('⏳ 启动转码状态轮询:', currentAssetId.slice(-8));
      
      transcodePollRef.current = setInterval(async () => {
        bufferLog('🔄 轮询检查转码状态:', currentAssetId.slice(-8));
        
        // 清除缓存强制重新检查
        hlsSourceCache.delete(currentAssetId);
        
        try {
          const source = await getHlsSource(currentAssetId);
          if (source.type !== 'transcoding') {
            bufferLog('✅ 转码完成，视频源:', source.type.toUpperCase());
            setHlsSource(source);
            
            // 停止轮询
            if (transcodePollRef.current) {
              clearInterval(transcodePollRef.current);
              transcodePollRef.current = null;
            }
          }
        } catch (error) {
          bufferLog('❌ 轮询检查失败:', error);
        }
      }, 5000); // 每 5 秒检查一次
    }
    
    return () => {
      if (transcodePollRef.current) {
        clearInterval(transcodePollRef.current);
        transcodePollRef.current = null;
      }
    };
  }, [isTranscoding, currentAssetId]);
  
  // 视频 URL（优先 HLS）
  const videoUrl = useMemo(() => {
    if (hlsSource) {
      return hlsSource.url;
    }
    // 回退：使用代理 URL
    if (currentAssetId) {
      return getAssetProxyUrl(currentAssetId);
    }
    return currentVideoClip?.mediaUrl || null;
  }, [hlsSource, currentAssetId, currentVideoClip?.mediaUrl]);
  
  // 视频源类型
  const videoSourceType = hlsSource?.type || 'mp4';

  // ★★★ 关键：视频切换时的处理逻辑 ★★★
  // 当切换到不同素材时，优先使用预热池中已加载的 video 元素
  const prevAssetIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    const newAssetId = currentVideoClip?.assetId || null;
    const container = videoContainerRef.current;
    
    // 没有容器，跳过
    if (!container) return;
    
    // ★★★ 关键：如果视频正在转码中，不要尝试加载原文件 ★★★
    if (isTranscoding) {
      bufferLog('⏳ 视频转码中，跳过视频加载:', newAssetId?.slice(-8));
      // 注意：不更新 prevAssetIdRef，这样转码完成后会重新触发
      return;
    }
    
    // assetId 未变化且已加载，跳过
    if (newAssetId === prevAssetIdRef.current && mountedVideosRef.current.has(newAssetId || '')) {
      return;
    }
    
    const wasPlaying = useEditorStore.getState().isPlaying;
    const storeTime = useEditorStore.getState().currentTime;
    
    // ★ 只在首次挂载时打印，避免误导
    const isFirstMount = prevAssetIdRef.current === null;
    bufferLog(isFirstMount ? '🎬 首次挂载视频:' : '🔄 切换视频素材:', newAssetId?.slice(-8));
    
    // ★★★ 修复：切换素材时先暂停播放，避免 play() 被中断 ★★★
    if (wasPlaying) {
      bufferLog('  ⏸ 暂停播放以避免 play() 中断');
      useEditorStore.getState().setIsPlaying(false);
    }
    
    // 隐藏当前所有视频元素
    mountedVideosRef.current.forEach((info, assetId) => {
      info.element.style.display = 'none';
      info.element.pause();
    });
    
    if (!newAssetId) {
      prevAssetIdRef.current = null;
      return;
    }
    
    // 检查是否已经挂载过这个 asset 的视频
    let videoInfo = mountedVideosRef.current.get(newAssetId);
    
    if (!videoInfo) {
      // 检查预热池
      const preheated = getPreheatedVideo(newAssetId);
      
      if (preheated && preheated.readyState >= 2) {
        // ★★★ 核心优化：使用预热池中已缓冲的视频元素 ★★★
        bufferLog('✨ 使用预热池中的视频元素 (秒切换)');
        const video = preheated.videoElement;
        
        // 从 body 移动到容器（如果还在 body 中）
        if (video.parentNode === document.body) {
          document.body.removeChild(video);
        }
        
        // 设置样式并挂载
        video.style.position = 'relative';
        video.style.visibility = 'visible';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.display = 'block';
        video.className = 'w-full h-full object-cover';
        // ★ 应用音量和静音设置
        video.volume = clampVolume(currentVideoClip?.volume);
        video.muted = currentVideoClip?.isMuted || false;
        
        if (!video.parentNode) {
          container.appendChild(video);
        }
        
        videoInfo = {
          element: video,
          hlsInstance: preheated.hlsInstance,
          isReady: true,
        };
        mountedVideosRef.current.set(newAssetId, videoInfo);
        
        // 更新 ref
        videoRefInternal.current = video;
        setVideoElement(video);
        setIsVideoReady(true);
        setIsSeeking(false);
        setIsInitialLoading(false); // ★ 关闭加载弹窗
        
        // Seek 到正确位置
        if (currentVideoClip) {
          const mediaTimeSec = calcMediaTime(storeTime, currentVideoClip);
          bufferLog('  → seek 到:', mediaTimeSec.toFixed(2) + 's');
          video.currentTime = Math.max(0, mediaTimeSec);
        }
        
        // 恢复播放
        if (wasPlaying) {
          bufferLog('  → 恢复播放状态...');
          useEditorStore.getState().setIsPlaying(true);
          video.play().catch(e => {
            bufferLog('  ✗ 恢复播放失败:', e.message);
            useEditorStore.getState().setIsPlaying(false);
          });
        }
        
      } else if (preheated) {
        // ★★★ 预热中但还没完全就绪，复用元素但等待就绪 ★★★
        bufferLog('⏳ 预热中，复用元素等待就绪...', 'readyState:', preheated.readyState);
        const video = preheated.videoElement;
        
        // 从 body 移动到容器
        if (video.parentNode === document.body) {
          document.body.removeChild(video);
        }
        
        // 设置样式并挂载
        video.style.position = 'relative';
        video.style.visibility = 'visible';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.display = 'block';
        video.className = 'w-full h-full object-cover';
        // ★ 应用音量和静音设置
        video.volume = clampVolume(currentVideoClip?.volume);
        video.muted = currentVideoClip?.isMuted || false;
        
        if (!video.parentNode) {
          container.appendChild(video);
        }
        
        videoInfo = {
          element: video,
          hlsInstance: preheated.hlsInstance,
          isReady: false,
        };
        mountedVideosRef.current.set(newAssetId, videoInfo);
        videoRefInternal.current = video;
        setVideoElement(video);
        
        // 监听就绪事件
        const onReady = () => {
          video.removeEventListener('canplay', onReady);
          video.removeEventListener('loadeddata', onReady);
          
          bufferLog('✅ 视频元素就绪:', newAssetId.slice(-8));
          videoInfo!.isReady = true;
          setIsVideoReady(true);
          setIsSeeking(false);
          setIsInitialLoading(false);
          
          if (currentVideoClip) {
            const mediaTimeSec = calcMediaTime(storeTime, currentVideoClip);
            video.currentTime = Math.max(0, mediaTimeSec);
          }
          
          if (wasPlaying) {
            bufferLog('  → 恢复播放状态...');
            useEditorStore.getState().setIsPlaying(true);
            video.play().catch((e) => {
              bufferLog('  ✗ 恢复播放失败:', e.message);
              useEditorStore.getState().setIsPlaying(false);
            });
          }
        };
        
        // 如果已经就绪直接触发
        if (video.readyState >= 2) {
          onReady();
        } else {
          video.addEventListener('canplay', onReady);
          video.addEventListener('loadeddata', onReady);
        }
        
      } else {
        // 没有预热，需要创建新元素并加载
        bufferLog('⏳ 无预热，创建新视频元素...');
        setIsVideoReady(false);
        setIsSeeking(true);
        
        const video = document.createElement('video');
        video.preload = 'auto';
        video.playsInline = true;
        video.className = 'w-full h-full object-cover';
        // ★ 应用音量和静音设置
        video.volume = clampVolume(currentVideoClip?.volume);
        video.muted = currentVideoClip?.isMuted || false;
        container.appendChild(video);
        
        videoInfo = {
          element: video,
          hlsInstance: null,
          isReady: false,
        };
        mountedVideosRef.current.set(newAssetId, videoInfo);
        videoRefInternal.current = video;
        setVideoElement(video);
        
        // ★★★ 添加错误事件监听，检测视频加载问题 ★★★
        const handleError = (e: Event) => {
          const mediaError = video.error;
          bufferLog('❌ 视频加载错误:', newAssetId.slice(-8), {
            code: mediaError?.code,
            message: mediaError?.message,
            networkState: video.networkState,
            readyState: video.readyState,
          });
          // 尝试标记为就绪（可能只有音频能播放）
          if (video.readyState >= 1) {
            bufferLog('  ⚠️ 视频有元数据，尝试继续（可能仅音频）');
            videoInfo!.isReady = true;
            setIsVideoReady(true);
            setIsSeeking(false);
            setIsInitialLoading(false);
          }
        };
        video.addEventListener('error', handleError);
        
        // ★★★ 添加 loadedmetadata 事件，检测视频轨道信息 ★★★
        const handleMetadata = () => {
          bufferLog('📹 视频元数据加载:', newAssetId.slice(-8), {
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            duration: video.duration,
            readyState: video.readyState,
          });
          // ★ 如果 videoWidth/videoHeight 为 0，说明没有视频轨道（可能是纯音频或编码不支持）
          if (video.videoWidth === 0 || video.videoHeight === 0) {
            bufferLog('  ⚠️ 视频尺寸为 0，可能是编码格式不支持（如 ProRes）');
          }
        };
        video.addEventListener('loadedmetadata', handleMetadata);
        
        const handleReady = () => {
          video.removeEventListener('canplay', handleReady);
          video.removeEventListener('loadeddata', handleReady);
          video.removeEventListener('error', handleError);
          video.removeEventListener('loadedmetadata', handleMetadata);
          
          bufferLog('✅ 新视频元素就绪:', newAssetId.slice(-8), {
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            readyState: video.readyState,
          });
          videoInfo!.isReady = true;
          setIsVideoReady(true);
          setIsSeeking(false);
          setIsInitialLoading(false); // ★ 关闭加载弹窗
          
          // ★★★ 更新预热池，让弹窗可以复用这个已加载的视频 ★★★
          updatePreheatedVideo(newAssetId, video);
          
          if (currentVideoClip) {
            const mediaTimeSec = calcMediaTime(storeTime, currentVideoClip);
            video.currentTime = Math.max(0, mediaTimeSec);
          }
          
          if (wasPlaying) {
            bufferLog('  → 恢复播放状态...');
            useEditorStore.getState().setIsPlaying(true);
            video.play().catch((e) => {
              bufferLog('  ✗ 恢复播放失败:', e.message);
              useEditorStore.getState().setIsPlaying(false);
            });
          }
        };
        
        video.addEventListener('canplay', handleReady);
        video.addEventListener('loadeddata', handleReady);
        
        // 设置 HLS 或 MP4 源
        const setupSource = async () => {
          const sourceInfo = await getHlsSource(newAssetId);
          
          if (sourceInfo.type === 'hls') {
            if (video.canPlayType('application/vnd.apple.mpegurl')) {
              bufferLog('  → Safari 原生 HLS');
              video.src = sourceInfo.url;
              video.load();
            } else if (Hls.isSupported()) {
              bufferLog('  → HLS.js 模式');
              const hls = new Hls(HLS_CONFIG);
              
              // ★★★ 关键：监听 HLS 分片缓冲事件 ★★★
              hls.on(Hls.Events.FRAG_BUFFERED, () => {
                if (!videoInfo!.isReady && video.readyState >= 2) {
                  handleReady();
                }
              });
              
              hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                  bufferLog('  ✗ HLS 错误:', data.type, data.details);
                }
              });
              
              hls.loadSource(sourceInfo.url);
              hls.attachMedia(video);
              videoInfo!.hlsInstance = hls;
            } else {
              video.src = getAssetProxyUrl(newAssetId);
              video.load();
            }
          } else {
            video.src = sourceInfo.url;
            video.load();
          }
        };
        
        setupSource();
      }
    } else {
      // 已挂载，直接显示
      bufferLog('♻️ 复用已挂载的视频元素');
      const video = videoInfo.element;
      video.style.display = 'block';
      // ★ 应用音量和静音设置
      video.volume = clampVolume(currentVideoClip?.volume);
      video.muted = currentVideoClip?.isMuted || false;
      
      videoRefInternal.current = video;
      setVideoElement(video);
      setIsVideoReady(videoInfo.isReady);
      
      if (currentVideoClip) {
        const mediaTimeSec = calcMediaTime(storeTime, currentVideoClip);
        if (Math.abs(video.currentTime - mediaTimeSec) > 0.2) {
          video.currentTime = Math.max(0, mediaTimeSec);
        }
      }
      
      if (wasPlaying && videoInfo.isReady) {
        bufferLog('  → 恢复播放状态...');
        useEditorStore.getState().setIsPlaying(true);
        video.play().catch((e) => {
          bufferLog('  ✗ 恢复播放失败:', e.message);
          useEditorStore.getState().setIsPlaying(false);
        });
      }
      
      // ★ 已挂载的视频也关闭加载弹窗
      if (videoInfo.isReady) {
        setIsInitialLoading(false);
      }
    }
    
    prevAssetIdRef.current = newAssetId;
  }, [currentVideoClip?.assetId, currentVideoClip?.isMuted, isContainerMounted, isTranscoding]);  // ★ 加入转码状态，转码完成后重新加载

  // 计算画布尺寸
  const canvasSize = useMemo(() => {
    if (containerSize.width < 100 || containerSize.height < 100) {
      return { width: 0, height: 0 };
    }
    
    const ratio = ASPECT_RATIOS[canvasAspectRatio] || 9 / 16;
    const padding = 24;
    const availableWidth = Math.max(0, containerSize.width - padding * 2);
    const availableHeight = Math.max(0, containerSize.height - padding * 2);

    if (availableWidth === 0 || availableHeight === 0) {
      return { width: 0, height: 0 };
    }

    let width: number, height: number;
    if (availableWidth / availableHeight > ratio) {
      height = availableHeight;
      width = height * ratio;
    } else {
      width = availableWidth;
      height = width / ratio;
    }

    return { width: Math.round(width), height: Math.round(height) };
  }, [containerSize, canvasAspectRatio]);

  // 选中的视频 clip
  const selectedVideoClip = useMemo(() => 
    videoClips.find(c => c.id === selectedClipId) || null,
    [videoClips, selectedClipId]
  );

  // Transform 目标 clip
  const transformTargetClip = selectedVideoClip || activeVideoClip;
  // ★ 修复：只要有视频 clip 就应该显示视频（用 currentVideoClip 判断）
  const hasActiveVideo = currentVideoClip !== null;

  // 播放时样式由 RAF 直接控制，暂停时才计算
  const videoStyle = useMemo(() => {
    const baseStyle = {
      objectFit: 'cover' as const,
      visibility: (hasActiveVideo ? 'visible' : 'hidden') as 'visible' | 'hidden',
    };
    
    // 播放时：RAF 直接更新容器 DOM，但仍需提供基础样式
    // 暂停时：React 控制 transform
    // ★ 修复：使用 currentVideoClip（包含回退逻辑）而不是 activeVideoClip
    if (!currentVideoClip) return baseStyle;

    const clipKeyframes = keyframes.get(currentVideoClip.id);
    const { transform, opacity } = calcClipTransformStyle(currentVideoClip, currentTime, clipKeyframes);

    return {
      ...baseStyle,
      // 始终设置 transform，即使是空字符串也要显式设置以覆盖 RAF 残留的值
      transform: transform || 'none',
      opacity,
    };
  }, [currentVideoClip, hasActiveVideo, currentTime, keyframes]);

  // 当前 transform 值（用于 TransformOverlay 显示）
  const currentTransformValues = useMemo(() => {
    if (!transformTargetClip) return { scale: 1, x: 0, y: 0 };
    
    const clipDuration = transformTargetClip.duration;
    const relativeTime = currentTime - transformTargetClip.start;
    const offset = clipDuration > 0 ? Math.max(0, Math.min(1, relativeTime / clipDuration)) : 0;
    
    const clipKeyframes = keyframes.get(transformTargetClip.id);
    const kfTransform = getClipTransformAtOffset(clipKeyframes, offset);
    const staticTransform = transformTargetClip.transform || {};

    // ★★★ Scale: 关键帧 scale 直接表示屏幕显示比例 ★★★
    const hasScaleKf = kfTransform.scaleX !== undefined || kfTransform.scaleY !== undefined;
    const scaleX = hasScaleKf ? (kfTransform.scaleX ?? 1) : (staticTransform.scale ?? 1);
    const scaleY = hasScaleKf ? (kfTransform.scaleY ?? 1) : (staticTransform.scale ?? 1);
    const scale = (scaleX + scaleY) / 2;
    
    const x = kfTransform.positionX ?? staticTransform.x ?? 0;
    const y = kfTransform.positionY ?? staticTransform.y ?? 0;
    
    return { scale, x, y };
  }, [transformTargetClip, currentTime, keyframes]);

  // Seek 定位逻辑（带防抖）
  const seekToTime = useCallback((timelineTimeMs: number, options?: { showIndicator?: boolean }) => {
    const mainVideo = videoRefInternal.current;
    
    // 即使没有视频也要处理防抖逻辑
    const now = Date.now();
    const timeSinceLastSeek = now - lastSeekTimeRef.current;

    if (timeSinceLastSeek < SEEK_DEBOUNCE_MS) {
      pendingSeekRef.current = timelineTimeMs;
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);

      seekTimeoutRef.current = setTimeout(() => {
        if (pendingSeekRef.current !== null) {
          seekToTime(pendingSeekRef.current, options);
          pendingSeekRef.current = null;
        }
      }, SEEK_DEBOUNCE_MS - timeSinceLastSeek);
      return;
    }
    
    lastSeekTimeRef.current = now;
    
    // 如果有视频，同步视频位置
    // ★ 使用 currentVideoClip（当前活跃或第一个 clip）
    if (mainVideo && currentVideoClip) {
      const activeClip = findActiveClip(videoClips, timelineTimeMs);
      
      if (activeClip) {
        const mediaTimeSec = calcMediaTime(timelineTimeMs, activeClip);
        const needsSeek = Math.abs(mainVideo.currentTime - mediaTimeSec) > SEEK_THRESHOLD;

        if (needsSeek) {
          if (options?.showIndicator !== false) {
            setSeekingLabel('seeking');
            setIsSeeking(true);
          }
          mainVideo.currentTime = Math.max(0, mediaTimeSec);
          
          // 超时保护：1秒后自动清除定位状态
          setTimeout(() => {
            setSeekingLabel(null);
            setIsSeeking(false);
          }, 1000);
        } else {
          // 不需要 seek，清除状态
          setSeekingLabel(null);
          setIsSeeking(false);
        }
      } else {
        // 没有活跃 clip，清除状态
        setSeekingLabel(null);
        setIsSeeking(false);
      }
    }

    // 同步音频 clips
    audioClips.forEach(clip => {
      if (!clip.mediaUrl) return;
      const el = cachedMediaRef.current.get(clip.mediaUrl);
      if (el) {
        const audioTimeSec = calcMediaTime(timelineTimeMs, clip);
        if (Math.abs(el.currentTime - audioTimeSec) > SEEK_THRESHOLD) {
          el.currentTime = Math.max(0, audioTimeSec);
        }
      }
    });
  }, [currentVideoClip, videoClips, audioClips]);

  // 音频同步
  const syncAudioClips = useCallback((timelineTimeMs: number, shouldPlay: boolean) => {
    audioClips.forEach(clip => {
      if (!clip.mediaUrl) return;
      
      const audioElement = cachedMediaRef.current.get(clip.mediaUrl) as HTMLAudioElement;
      if (!audioElement) return;
      
      const clipEnd = clip.start + clip.duration;
      const isInRange = timelineTimeMs >= clip.start && timelineTimeMs < clipEnd;
      
      if (shouldPlay && isInRange) {
        const expectedTime = calcMediaTime(timelineTimeMs, clip);
        
        if (audioElement.readyState < 3) {
          audioElement.currentTime = Math.max(0, expectedTime);
          // ★ 应用音量和静音设置
          audioElement.volume = clampVolume(clip.volume);
          audioElement.muted = clip.isMuted || false;
          
          const clipId = clip.id; // 捕获 clip ID 避免闭包问题
          const playWhenReady = () => {
            audioElement.removeEventListener('canplaythrough', playWhenReady);
            const state = useEditorStore.getState();
            if (state.isPlaying) {
              // 重新获取最新的 clip 数据
              const latestClip = state.clips.find(c => c.id === clipId);
              if (!latestClip) return;
              
              const currentMs = state.currentTime;
              const newExpectedTime = calcMediaTime(currentMs, latestClip);
              const drift = Math.abs(audioElement.currentTime - newExpectedTime);
              if (drift > SEEK_THRESHOLD) {
                audioElement.currentTime = Math.max(0, newExpectedTime);
              }
              // ★ 应用最新的音量设置
              audioElement.volume = clampVolume(latestClip.volume);
              audioElement.muted = latestClip.isMuted || false;
              audioElement.play().catch(() => {});
            }
          };
          
          audioElement.addEventListener('canplaythrough', playWhenReady, { once: true });
          audioElement.load();
          return;
        }
        
        const drift = Math.abs(audioElement.currentTime - expectedTime);
        
        if (drift > AUDIO_DRIFT_THRESHOLD) {
          audioElement.currentTime = Math.max(0, expectedTime);
        }
        // ★ 应用音量和静音设置
        audioElement.volume = clampVolume(clip.volume);
        audioElement.muted = clip.isMuted || false;
        if (audioElement.paused) {
          audioElement.play().catch(() => {});
        }
      } else if (!audioElement.paused) {
        audioElement.pause();
      }
    });
  }, [audioClips]);

  // 非播放状态时同步 DOM 元素（时间显示和进度条）
  // 播放时由 RAF 控制
  useEffect(() => {
    if (isPlaying) return; // 播放时由 RAF 控制
    
    // 同步时间显示
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTime(currentTime);
    }
    // 同步进度条宽度
    if (progressBarRef.current) {
      const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
      progressBarRef.current.style.width = `${percent}%`;
    }
  }, [currentTime, duration, isPlaying]);

  // 监听视频区域容器尺寸
  useEffect(() => {
    const container = videoAreaRef.current;
    if (!container) return;
    
    const initialSize = {
      width: container.clientWidth,
      height: container.clientHeight,
    };
    if (initialSize.width > 0 && initialSize.height > 0) {
      setContainerSize(initialSize);
    }
    
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 预加载媒体元素
  useEffect(() => {
    [...videoClips, ...audioClips].forEach(clip => {
      if (!clip.mediaUrl) return;
      const type = clip.clipType as 'video' | 'audio';
      const element = getOrCreateMediaElement(clip.mediaUrl, type);
      cachedMediaRef.current.set(clip.mediaUrl, element);
    });
  }, [videoClips, audioClips]);

  // 视频 URL 变化时缓存主视频元素
  useEffect(() => {
    if (videoRefInternal.current && videoUrl) {
      cachedMediaRef.current.set(videoUrl, videoRefInternal.current);
      if (isVideoCached(videoUrl)) {
        setIsVideoReady(true);
      }
    }
  }, [videoUrl, setIsVideoReady]);

  // ★★★ HLS 初始化 ★★★
  // 注意：当使用预热池/挂载池时，此逻辑由 asset 切换 useEffect 处理
  useEffect(() => {
    const video = videoRefInternal.current;
    
    // ★ 修复：如果没有视频元素，提前返回
    if (!video) {
      bufferLog('⚠️ HLS 初始化：视频元素未就绪');
      return;
    }
    
    // ★ 修复：如果没有 videoUrl，检查是否可以从 assetId 生成
    const assetId = currentVideoClip?.assetId;
    const effectiveUrl = videoUrl || (assetId ? getAssetProxyUrl(assetId) : null);
    
    if (!effectiveUrl) {
      bufferLog('⚠️ HLS 初始化：无有效 URL, assetId=', assetId?.slice(-8), 'videoUrl=', videoUrl?.slice(-30));
      return;
    }
    
    // ★★★ 关键：如果当前视频已通过挂载池管理，跳过此初始化 ★★★
    // 挂载池中的视频已经设置好了 src，不需要重复设置
    if (assetId && mountedVideosRef.current.has(assetId)) {
      bufferLog('🔄 跳过 HLS 初始化：视频由挂载池管理');
      return;
    }
    
    // ★ 修复：如果 hlsSource 还在加载中，先使用代理 URL
    if (!hlsSource) {
      bufferLog('⚠️ HLS 源未就绪，使用代理 URL:', effectiveUrl.slice(-50));
      if (video.src !== effectiveUrl) {
        video.src = effectiveUrl;
      }
      return;
    }

    // 如果是 MP4，直接设置 src
    if (videoSourceType === 'mp4') {
      if (video.src !== effectiveUrl) {
        bufferLog('🎬 设置 MP4 源:', effectiveUrl.slice(-50));
        video.src = effectiveUrl;
      }
      return;
    }

    // HLS 模式
    // 检查浏览器是否原生支持 HLS (Safari)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      if (video.src !== effectiveUrl) {
        bufferLog('🎬 Safari 原生 HLS:', effectiveUrl.slice(-50));
        video.src = effectiveUrl;
      }
      return;
    }

    // 使用 hls.js
    if (!Hls.isSupported()) {
      debugError('浏览器不支持 HLS');
      // 回退到 MP4
      video.src = effectiveUrl;
      return;
    }

    // 检查是否已有 HLS 实例
    if (hlsRef.current) {
      // 如果 URL 没变，不重新初始化
      const currentHlsSrc = (hlsRef.current as Hls & { url?: string }).url;
      if (currentHlsSrc === effectiveUrl) {
        return;
      }
      // 销毁旧实例
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    bufferLog('🎬 初始化 hls.js:', effectiveUrl.slice(-50));
    
    const hls = new Hls(HLS_CONFIG);
    hlsRef.current = hls;
    (hls as Hls & { url?: string }).url = effectiveUrl;

    // 绑定事件
    hls.on(Events.MANIFEST_PARSED, () => {
      bufferLog('✅ HLS Manifest 解析完成');
      setIsVideoReady(true);
    });

    hls.on(Events.FRAG_BUFFERED, () => {
      // 更新缓冲进度
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const percent = video.duration > 0 
          ? Math.round((bufferedEnd / video.duration) * 100) 
          : 0;
        setBufferProgress(percent);
      }
    });

    hls.on(Events.ERROR, (event, data) => {
      debugError('[HLS] 错误:', data.type, data.details);
      
      if (data.fatal) {
        switch (data.type) {
          case ErrorTypes.NETWORK_ERROR:
            bufferLog('⚠️ HLS 网络错误，尝试恢复...');
            hls.startLoad();
            break;
          case ErrorTypes.MEDIA_ERROR:
            bufferLog('⚠️ HLS 媒体错误，尝试恢复...');
            hls.recoverMediaError();
            break;
          default:
            debugError('[HLS] 致命错误，回退到 MP4');
            hls.destroy();
            hlsRef.current = null;
            // 回退到 MP4
            video.src = effectiveUrl;
            break;
        }
      }
    });

    // 加载 HLS 源
    hls.loadSource(effectiveUrl);
    hls.attachMedia(video);

    return () => {
      // 组件卸载时清理
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [videoUrl, hlsSource, videoSourceType, currentAssetId, currentVideoClip?.assetId, setIsVideoReady]);

  // 订阅缓冲进度（仅 MP4 模式需要）
  useEffect(() => {
    if (!videoUrl) return;
    
    const unsubscribe = subscribeBufferProgress(videoUrl, (progress) => {
      setBufferProgress(progress);
    });
    
    const mainVideo = videoRefInternal.current;
    if (mainVideo) {
      bufferVideoInBackground(videoUrl, mainVideo);
    }
    
    return unsubscribe;
  }, [videoUrl]);

  // 暂停时同步视频位置
  useEffect(() => {
    if (isPlaying || !videoRefInternal.current || !currentVideoClip) return;
    seekToTime(currentTime, { showIndicator: true });
  }, [currentTime, isPlaying, currentVideoClip, seekToTime]);

  // 播放/暂停控制
  useEffect(() => {
    const mainVideo = videoRefInternal.current;
    if (!mainVideo || !videoUrl) return;
    
    const storeTime = useEditorStore.getState().currentTime;
    const activeClip = findActiveClip(videoClips, storeTime);
    
    // ★ 调试日志：追踪播放状态
    if (isPlaying && !activeClip && videoClips.length > 0) {
      console.warn('[VideoCanvas] ⚠️ 播放中但找不到活跃 clip!', {
        storeTime,
        videoClipsCount: videoClips.length,
        videoClipsRanges: videoClips.map(c => ({
          id: c.id.slice(0, 8),
          start: c.start,
          end: c.start + c.duration,
        })),
      });
    }
    
    if (isPlaying && activeClip) {
      const mediaTimeSec = calcMediaTime(storeTime, activeClip);
      // ★ 应用音量和静音设置
      mainVideo.volume = clampVolume(activeClip.volume);
      mainVideo.muted = activeClip.isMuted || false;
      
      const needsSeek = Math.abs(mainVideo.currentTime - mediaTimeSec) > SEEK_THRESHOLD;
      
      // ★ 缓冲相关日志
      bufferLog('▶ 播放控制 | needsSeek:', needsSeek, 
        '| 视频时间:', mainVideo.currentTime.toFixed(2) + 's',
        '| 目标时间:', mediaTimeSec.toFixed(2) + 's',
        '| readyState:', mainVideo.readyState,
        '| 缓冲:', calculateBufferedPercent(mainVideo) + '%');
      
      if (needsSeek) {
        setIsSeeking(true);
        mainVideo.currentTime = Math.max(0, mediaTimeSec);
        
        const onCanPlay = () => {
          bufferLog('  ✓ seek 后 canplay 触发');
          mainVideo.removeEventListener('canplay', onCanPlay);
          setIsSeeking(false);
          if (useEditorStore.getState().isPlaying) {
            mainVideo.play().catch((e) => bufferLog('  ✗ play() 失败:', e.message));
            syncAudioClips(useEditorStore.getState().currentTime, true);
          }
        };
        mainVideo.addEventListener('canplay', onCanPlay);
        
        if (mainVideo.readyState >= 3) {
          mainVideo.removeEventListener('canplay', onCanPlay);
          setIsSeeking(false);
          mainVideo.play().catch((e) => bufferLog('  ✗ play() 失败:', e.message));
          syncAudioClips(storeTime, true);
        }
      } else {
        mainVideo.play().catch((err) => {
          bufferLog('  ✗ play() 失败:', err.message);
          if (err.name === 'NotAllowedError') {
            mainVideo.muted = true;
            mainVideo.play().catch(() => {});
          }
        });
        syncAudioClips(storeTime, true);
      }
    } else if (isPlaying && !activeClip) {
      // ★★★ 纯音频模式：没有视频 clip 但有音频 clip ★★★
      // 视频暂停，但音频继续播放
      mainVideo.pause();
      // 检查是否有音频 clip 在当前时间范围内
      const hasActiveAudio = audioClips.some(c => 
        storeTime >= c.start && storeTime < c.start + c.duration
      );
      if (hasActiveAudio) {
        bufferLog('♪ 纯音频模式 | 时间:', storeTime);
        syncAudioClips(storeTime, true); // 继续播放音频
      } else {
        syncAudioClips(storeTime, false);
      }
    } else {
      mainVideo.pause();
      syncAudioClips(storeTime, false);
    }
  }, [isPlaying, videoUrl, videoClips, audioClips, syncAudioClips]);

  // RAF 实现流畅播放 + 关键帧动画
  useEffect(() => {
    const mainVideo = videoRefInternal.current;
    if (!mainVideo || !videoUrl || !currentVideoClip) return;

    let lastStoreUpdateTime = 0;
    const preloadedUrls = new Set<string>();
    
    // 追踪当前正在播放的 clip ID（防止重复切换）
    let activeClipIdRef = currentVideoClip.id;

    const updatePlayhead = () => {
      if (!mainVideo || mainVideo.paused) return;
      
      const mediaTimeSec = mainVideo.currentTime;
      const now = performance.now();
      
      // ★★★ 关键：实时获取当前状态 ★★★
      const storeClips = useEditorStore.getState().clips;
      const videoClipsNow = storeClips.filter(c => c.clipType === 'video' && c.mediaUrl);
      
      // 通过 ID 找到当前正在播放的 clip
      let playingClip = videoClipsNow.find(c => c.id === activeClipIdRef);
      
      // 如果找不到（可能被删除了），用 currentVideoClip
      if (!playingClip) {
        playingClip = currentVideoClip;
        activeClipIdRef = currentVideoClip.id;
      }
      
      if (!playingClip) {
        bufferLog('⚠️ 无法确定当前播放的 clip');
        return;
      }
      
      // 计算时间线位置
      // 公式：timelineTime = (mediaTime - sourceStart) + clipStart
      // 即：视频内相对位置 + clip在时间线的开始位置
      const sourceStartMs = playingClip.sourceStart || 0;
      const mediaTimeMs = secToMs(mediaTimeSec);
      
      // ★★★ 修复：如果视频时间小于 sourceStart，说明还未 seek 到正确位置，跳过此帧 ★★★
      // 避免产生负数时间导致的错误
      if (mediaTimeMs < sourceStartMs - 100) { // 100ms 容差
        bufferLog('⚠️ 视频时间尚未到达 sourceStart，等待 seek 完成', {
          mediaTimeMs,
          sourceStartMs,
          diff: sourceStartMs - mediaTimeMs,
        });
        return; // 跳过此帧，等待视频 seek 到正确位置
      }
      
      const timelineTimeMs = Math.max(playingClip.start, mediaTimeMs + playingClip.start - sourceStartMs);
      
      // 调试日志（太频繁，默认关闭）
      // bufferLog('🎬 RAF | clip:', playingClip.id.slice(-8), 
      //   '| 视频时间:', mediaTimeSec.toFixed(2) + 's',
      //   '| 时间线:', timelineTimeMs.toFixed(0) + 'ms',
      //   '| clip范围:', playingClip.start + '-' + (playingClip.start + playingClip.duration) + 'ms');

      // 边界检测：到达当前 clip 末尾
      // ★★★ 修复：减少提前量到 10ms，避免明显的时间跳跃 ★★★
      const clipEndMs = playingClip.start + playingClip.duration;
      let didSwitchClip = false; // ★ 追踪是否切换了 clip
      
      if (timelineTimeMs >= clipEndMs - 10) { // 10ms 提前量（平衡响应速度和连续性）
        // 检查是否有下一个 clip
        // ★ 修复：使用 clipEnd 而不是 clipStart 来查找下一个 clip
        const nextClip = videoClipsNow
          .filter(c => c.id !== playingClip.id && c.start >= clipEndMs - 50) // 允许 50ms 重叠容差
          .sort((a, b) => a.start - b.start)[0];
        
        if (nextClip && nextClip.id !== activeClipIdRef) {
          const isSameVideo = nextClip.assetId === playingClip.assetId;
          bufferLog('🔄 到达 clip 边界 | 下一个:', nextClip.id.slice(-8), 
            '| 同视频:', isSameVideo,
            '| assetId:', nextClip.assetId?.slice(-8));
          
          // 更新活跃 clip ID
          activeClipIdRef = nextClip.id;
          didSwitchClip = true; // ★ 标记已切换
          
          if (isSameVideo) {
            // ★★★ 优化：检查是否连续播放（无需 seek）★★★
            // 如果当前 clip 的 sourceEnd 和下一个 clip 的 sourceStart 接近（相差 < 50ms），
            // 说明在原视频中是连续的，不需要 seek，避免卡顿
            const currentSourceEnd = (playingClip.sourceStart || 0) + playingClip.duration;
            const nextSourceStart = nextClip.sourceStart || 0;
            const gap = Math.abs(nextSourceStart - currentSourceEnd);
            
            if (gap < 50) { // ★ 降低到 50ms，更严格判断连续性
              // ★ 连续播放，无需 seek，直接更新时间线位置
              bufferLog('  → 同视频连续播放（gap=' + gap + 'ms），无需 seek');
              setCurrentTime(nextClip.start);
              lastStoreUpdateTime = now; // ★ 重置 store 更新时间，避免重复更新
            } else {
              // ★ 非连续，需要 seek
              const nextMediaTimeSec = nextSourceStart / 1000;
              bufferLog('  → 同视频非连续 seek 到:', nextMediaTimeSec.toFixed(2) + 's', '(gap=' + gap + 'ms)');
              mainVideo.currentTime = nextMediaTimeSec;
              setCurrentTime(nextClip.start);
              lastStoreUpdateTime = now; // ★ 重置 store 更新时间
            }
          } else {
            // ★★★ 修复：不同视频文件，需要主动触发视频切换 ★★★
            bufferLog('  → 切换到不同视频, assetId:', nextClip.assetId?.slice(-8));
            // 先暂停当前视频
            mainVideo.pause();
            // 更新时间线位置，触发 React 重新渲染和视频切换
            setCurrentTime(nextClip.start);
            // ★★★ 必须 return，否则下面的代码会使用旧的 video 元素 ★★★
            // React 会在下一帧处理视频切换，新的 RAF 循环会启动
            return;
          }
        } else if (!nextClip) {
          // 没有下一个 video clip，但需要检查是否到达整个项目的末尾
          // ★★★ 修复：播放范围应该是所有 clip 中最长的，而不仅仅是 video clip ★★★
          const totalDuration = storeClips.reduce((max, c) => 
            Math.max(max, c.start + c.duration), 0);
          
          // 如果当前时间还没到项目末尾，继续播放（纯音频模式）
          if (timelineTimeMs < totalDuration - 50) {
            bufferLog('📼 Video clip 结束，但项目未结束，继续纯音频模式 | 当前:', timelineTimeMs, '总时长:', totalDuration);
            // 暂停视频但继续更新时间线（音频会由 syncAudioClips 处理）
            mainVideo.pause();
            // 继续推进时间线
            const nextTimeMs = Math.min(timelineTimeMs + 33, totalDuration); // 约 30fps 推进
            setCurrentTime(nextTimeMs);
            lastStoreUpdateTime = now;
            // 不 return，让 RAF 继续运行
          } else {
            // 真正到达时间线末尾
            bufferLog('⏹ 到达时间线末尾，停止播放 | 总时长:', totalDuration);
            mainVideo.pause();
            useEditorStore.getState().setIsPlaying(false);
            useEditorStore.getState().setCurrentTime(totalDuration);
            return;
          }
        }
      }

      // 30fps 节流 store 更新（如果刚切换了 clip，跳过本次更新）
      if (!didSwitchClip && now - lastStoreUpdateTime >= STORE_UPDATE_INTERVAL) {
        setCurrentTime(timelineTimeMs);
        lastStoreUpdateTime = now;
      }

      // 直接更新 DOM（绕过 React）- 更新容器而不是 video 元素
      const state = useEditorStore.getState();
      const storeKeyframes = state.keyframes;

      const activeClipForTransform = videoClipsNow
        .find(c => timelineTimeMs >= c.start && timelineTimeMs < c.start + c.duration);

      // ★ 更新视频容器的 transform，保持和暂停时 React 控制的一致
      const container = videoContainerRef.current;
      if (activeClipForTransform && container) {
        const clipKeyframesMap = storeKeyframes.get(activeClipForTransform.id);
        const { transform, opacity } = calcClipTransformStyle(
          activeClipForTransform,
          timelineTimeMs,
          clipKeyframesMap
        );
        container.style.transform = transform;
        container.style.opacity = String(opacity);
      }

      // 动态设置音量和静音状态
      const activeClip = findActiveClip(videoClipsNow, timelineTimeMs);
      if (activeClip) {
        mainVideo.volume = clampVolume(activeClip.volume);
        mainVideo.muted = activeClip.isMuted || false;
      }

      // 同步音频
      syncAudioClips(timelineTimeMs, true);

      // 更新 UI 元素（直接 DOM）- 使用实时计算的 totalDuration
      const currentTotalDuration = storeClips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatTime(timelineTimeMs);
      }
      if (progressBarRef.current && currentTotalDuration > 0) {
        const percent = Math.min(100, Math.max(0, (timelineTimeMs / currentTotalDuration) * 100));
        progressBarRef.current.style.width = `${percent}%`;
      }

      // 预加载下一个 clip（70% 进度时）
      if (activeClip) {
        const clipProgress = (timelineTimeMs - activeClip.start) / activeClip.duration;
        if (clipProgress > 0.7) {
          const sortedVideoClips = [...videoClipsNow].sort((a, b) => a.start - b.start);
          const currentIndex = sortedVideoClips.findIndex(c => c.id === activeClip.id);
          const nextClip = sortedVideoClips[currentIndex + 1];

          // ★★★ 使用新的预热系统 ★★★
          if (nextClip?.assetId && !preloadedUrls.has(nextClip.assetId)) {
            preloadedUrls.add(nextClip.assetId);
            bufferLog('🔥 播放中预热下一个 clip:', nextClip.id.slice(-8), '| assetId:', nextClip.assetId.slice(-8));
            preheatVideo(nextClip.assetId);
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    };

    const handlePlay = () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    };

    const handlePause = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
    
    mainVideo.addEventListener('play', handlePlay);
    mainVideo.addEventListener('pause', handlePause);
    
    if (!mainVideo.paused) handlePlay();
    
    return () => {
      mainVideo.removeEventListener('play', handlePlay);
      mainVideo.removeEventListener('pause', handlePause);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [videoUrl, currentVideoClip, videoClips, duration, setCurrentTime, syncAudioClips, isVideoReady, videoElement]);

  // ★★★ 纯音频/字幕模式 RAF：当没有视频 clip 时驱动时间更新 ★★★
  useEffect(() => {
    // 检查是否处于非视频模式：播放中 + 没有视频 clip 在当前位置
    const storeState = useEditorStore.getState();
    const activeVideoClip = findActiveClip(videoClips, storeState.currentTime);
    
    // ★★★ 修复：检查是否还有任何类型的 clip 未播放完（不仅仅是音频）★★★
    const totalDuration = storeState.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
    const hasMoreContent = storeState.currentTime < totalDuration - 50;
    
    const isNonVideoMode = isPlaying && !activeVideoClip && hasMoreContent;
    
    if (!isNonVideoMode) {
      // 不是非视频模式，清理 RAF
      if (audioOnlyRafRef.current) {
        cancelAnimationFrame(audioOnlyRafRef.current);
        audioOnlyRafRef.current = null;
      }
      return;
    }
    
    bufferLog('♪♪ 启动非视频模式 RAF (音频/字幕播放)');
    let lastUpdateTime = performance.now();
    let lastStoreUpdateTime = 0;
    
    const updateAudioPlayhead = () => {
      const state = useEditorStore.getState();
      if (!state.isPlaying) {
        audioOnlyRafRef.current = null;
        return;
      }
      
      const now = performance.now();
      const deltaMs = now - lastUpdateTime;
      lastUpdateTime = now;
      
      // 计算新的时间线位置
      const newTime = state.currentTime + deltaMs;
      
      // 检查是否还在纯音频模式
      const activeVideo = findActiveClip(
        state.clips.filter(c => c.clipType === 'video' && c.mediaUrl),
        newTime
      );
      
      if (activeVideo) {
        // 进入了视频区域，停止纯音频 RAF（视频 RAF 会接管）
        bufferLog('♪♪ 非视频模式结束，进入视频区域');
        audioOnlyRafRef.current = null;
        return;
      }
      
      // ★★★ 修复：检查是否到达时间线末尾（使用所有 clips 的总时长）★★★
      const totalDuration = state.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
      if (newTime >= totalDuration - 50) {
        bufferLog('♪♪ 非视频模式结束，到达时间线末尾');
        state.setIsPlaying(false);
        state.setCurrentTime(totalDuration);
        audioOnlyRafRef.current = null;
        return;
      }
      
      // 同步音频 clips（如果有的话）
      syncAudioClips(newTime, true);
      
      // 30fps 节流 store 更新
      if (now - lastStoreUpdateTime >= STORE_UPDATE_INTERVAL) {
        setCurrentTime(newTime);
        lastStoreUpdateTime = now;
        
        // 更新 UI 元素（直接 DOM）
        if (timeDisplayRef.current) {
          timeDisplayRef.current.textContent = formatTime(newTime);
        }
        if (progressBarRef.current) {
          const totalDuration = state.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
          if (totalDuration > 0) {
            const percent = Math.min(100, Math.max(0, (newTime / totalDuration) * 100));
            progressBarRef.current.style.width = `${percent}%`;
          }
        }
      }
      
      audioOnlyRafRef.current = requestAnimationFrame(updateAudioPlayhead);
    };
    
    audioOnlyRafRef.current = requestAnimationFrame(updateAudioPlayhead);
    
    return () => {
      if (audioOnlyRafRef.current) {
        cancelAnimationFrame(audioOnlyRafRef.current);
        audioOnlyRafRef.current = null;
      }
    };
  }, [isPlaying, videoClips, audioClips, syncAudioClips, setCurrentTime]);

  // 视频生命周期事件
  useEffect(() => {
    const mainVideo = videoRefInternal.current;
    if (!mainVideo || !videoUrl) return;
    
    const handleEnded = () => {
      // ★ 多素材模式：检查是否还有下一个 clip
      const state = useEditorStore.getState();
      const currentTimeMs = state.currentTime;
      const videoClipsNow = state.clips.filter(c => c.clipType === 'video' && c.mediaUrl);
      // ★★★ 修复：使用所有 clips 计算总时长，而不仅仅是 video clips ★★★
      const totalDuration = state.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
      
      // 只有到达时间轴末尾才真正停止
      if (currentTimeMs >= totalDuration - 100) { // 100ms 容差
        bufferLog('⏹ 视频 ended 事件，时间轴结束');
        setIsPlaying(false);
      } else {
        bufferLog('⚠️ 视频 ended 事件，但时间轴未结束，继续播放');
        // 可能是单个素材播放完毕，检查下一个 video clip
        const nextVideoClip = videoClipsNow
          .filter(c => c.start > currentTimeMs)
          .sort((a, b) => a.start - b.start)[0];
        
        if (nextVideoClip) {
          // 有下一个视频 clip，跳转到那里
          setCurrentTime(nextVideoClip.start);
        } else {
          // 没有更多视频 clip，但可能还有音频/字幕，继续纯音频模式
          // 不停止播放，让纯音频模式 RAF 接管
          bufferLog('♪ 进入纯音频模式，继续播放直到时间线末尾');
        }
      }
    };
    
    const handleCanPlay = () => {
      bufferLog('✓ canplay 事件 | readyState:', mainVideo.readyState);
      setIsVideoReady(true);
    };
    
    const handleProgress = () => {
      const bufferedPercent = calculateBufferedPercent(mainVideo);
      updateBufferProgress(videoUrl, bufferedPercent);
    };

    const handleSeeking = () => {
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      // ★ 只有在真正需要缓冲时才显示指示器
      seekTimeoutRef.current = setTimeout(() => {
        if (mainVideo.seeking && mainVideo.readyState < 3) {
          setSeekingLabel('seeking');
        }
      }, 400); // 延长到 400ms，避免快速 seek 时闪烁
    };

    const handleSeeked = () => {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
        seekTimeoutRef.current = null;
      }
      setIsSeeking(false);
      setSeekingLabel(null);
    };

    let waitingTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const handleWaiting = () => {
      bufferLog('⏳ waiting 事件 | readyState:', mainVideo.readyState, '| paused:', mainVideo.paused);
      if (waitingTimeoutId) clearTimeout(waitingTimeoutId);
      // ★ 缩短等待时间到 150ms，让用户更快感知到缓冲状态
      waitingTimeoutId = setTimeout(() => {
        // ★ 只要视频真的在等待数据且正在播放就立即显示
        if (mainVideo.readyState < 3 && !mainVideo.paused && mainVideo.networkState === 2) {
          bufferLog('  → 真正需要缓冲，显示指示器');
          setSeekingLabel('buffering');
          setIsSeeking(true);
        }
      }, 150); // ★ 从 800ms 减少到 150ms
    };

    const handlePlaying = () => {
      bufferLog('▶ playing 事件 | 缓冲恢复');
      if (waitingTimeoutId) {
        clearTimeout(waitingTimeoutId);
        waitingTimeoutId = null;
      }
      setIsSeeking(false);
      setSeekingLabel(null);
    };
    
    mainVideo.addEventListener('ended', handleEnded);
    mainVideo.addEventListener('canplay', handleCanPlay);
    mainVideo.addEventListener('loadeddata', handleCanPlay);
    mainVideo.addEventListener('progress', handleProgress);
    mainVideo.addEventListener('seeking', handleSeeking);
    mainVideo.addEventListener('seeked', handleSeeked);
    mainVideo.addEventListener('waiting', handleWaiting);
    mainVideo.addEventListener('playing', handlePlaying);

    if (mainVideo.readyState >= 2) {
      setIsVideoReady(true);
    }
    
    return () => {
      mainVideo.removeEventListener('ended', handleEnded);
      mainVideo.removeEventListener('canplay', handleCanPlay);
      mainVideo.removeEventListener('loadeddata', handleCanPlay);
      mainVideo.removeEventListener('progress', handleProgress);
      mainVideo.removeEventListener('seeking', handleSeeking);
      mainVideo.removeEventListener('seeked', handleSeeked);
      mainVideo.removeEventListener('waiting', handleWaiting);
      mainVideo.removeEventListener('playing', handlePlaying);
      
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      if (waitingTimeoutId) clearTimeout(waitingTimeoutId);
    };
  }, [videoUrl, setIsPlaying, setIsVideoReady]);

  // 全屏监听
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handlePlayPause = useCallback(async () => {
    const mainVideo = videoRefInternal.current;
    
    // ★ 如果视频正在缓冲，不允许播放（避免 play() was interrupted 错误）
    if (!isPlaying && mainVideo) {
      // 检查视频是否真正可以播放
      if (mainVideo.readyState < 2) {
        bufferLog('⚠️ 视频未就绪 (readyState:', mainVideo.readyState, ')，等待...');
        setSeekingLabel('buffering');
        setIsSeeking(true);
        
        // 等待视频可播放
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
            const onCanPlay = () => {
              clearTimeout(timeout);
              mainVideo.removeEventListener('canplay', onCanPlay);
              mainVideo.removeEventListener('error', onError);
              resolve();
            };
            const onError = () => {
              clearTimeout(timeout);
              mainVideo.removeEventListener('canplay', onCanPlay);
              mainVideo.removeEventListener('error', onError);
              reject(new Error('video error'));
            };
            mainVideo.addEventListener('canplay', onCanPlay);
            mainVideo.addEventListener('error', onError);
          });
          setIsSeeking(false);
          setSeekingLabel(null);
        } catch (e) {
          bufferLog('❌ 等待视频就绪失败:', e);
          setIsSeeking(false);
          setSeekingLabel(null);
          return; // 不播放
        }
      }
    }
    
    // 如果要播放，检查当前时间是否有效
    if (!isPlaying) {
      const state = useEditorStore.getState();
      const totalDuration = state.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
      const activeClip = findActiveClip(videoClips, state.currentTime);
      
      // 如果当前时间已到末尾或没有 clip，回到开头
      if (state.currentTime >= totalDuration || !activeClip) {
        setCurrentTime(0);
        seekToTime(0, { showIndicator: false });
      }
    }
    
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      // 忽略
    }
    
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying, videoClips, setCurrentTime, seekToTime]);

  const handleSeek = useCallback((timeMs: number) => {
    debugLog('handleSeek called:', timeMs);
    setCurrentTime(timeMs);
    seekToTime(timeMs, { showIndicator: true });
  }, [setCurrentTime, seekToTime]);

  const handleProgressClick = useCallback((e: React.MouseEvent) => {
    debugLog('handleProgressClick:', { progressRef: !!progressRef.current, duration });
    if (!progressRef.current || duration <= 0) return;
    
    const rect = progressRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = Math.round(percent * duration);
    debugLog('Seeking to:', newTime);
    handleSeek(Math.max(0, Math.min(duration, newTime)));
  }, [duration, handleSeek]);

  const handleSkipBack = useCallback(() => {
    handleSeek(Math.max(0, currentTime - 5000));
  }, [currentTime, handleSeek]);

  const handleSkipForward = useCallback(() => {
    handleSeek(Math.min(duration, currentTime + 5000));
  }, [currentTime, duration, handleSeek]);

  const handleZoomIn = useCallback(() => 
    setZoom(prev => Math.min(MAX_ZOOM, +(prev + ZOOM_STEP).toFixed(2))), []);
  
  const handleZoomOut = useCallback(() => 
    setZoom(prev => Math.max(MIN_ZOOM, +(prev - ZOOM_STEP).toFixed(2))), []);
  
  const handleZoomReset = useCallback(() => setZoom(1), []);

  // ★ 进入transform模式时自动缩小zoom，让边框handles可见
  useEffect(() => {
    if (canvasEditMode === 'transform' && zoom === 1) {
      setZoom(0.9); // 缩小到90%让边框可见
    }
  }, [canvasEditMode]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleTransformChange = useCallback((newTransform: Partial<NonNullable<Clip['transform']>>) => {
    const targetClipId = selectedClipId || activeVideoClip?.id;
    if (!targetClipId) return;

    const targetClip = clips.find(c => c.id === targetClipId);
    if (!targetClip) return;

    // ★ 检查是否有 position 关键帧
    const clipKeyframesMap = keyframes.get(targetClipId);
    const positionKeyframes = clipKeyframesMap?.get('position') || [];
    
    // ★ 如果有 position 关键帧，需要偏移所有关键帧
    if (positionKeyframes.length > 0 && (newTransform.x !== undefined || newTransform.y !== undefined)) {
      const currentTransform = targetClip.transform || {};
      const oldX = currentTransform.x ?? 0;
      const oldY = currentTransform.y ?? 0;
      const deltaX = (newTransform.x ?? oldX) - oldX;
      const deltaY = (newTransform.y ?? oldY) - oldY;
      
      // ★ 批量更新所有 position 关键帧
      const { updateKeyframe } = useEditorStore.getState();
      for (const kf of positionKeyframes) {
        const oldValue = kf.value as { x: number; y: number };
        updateKeyframe(kf.id, {
          value: {
            x: oldValue.x + deltaX,
            y: oldValue.y + deltaY,
          }
        });
      }
      
      // ★ 同时更新静态 transform，保持同步
      saveToHistory();
      updateClip(targetClipId, {
        transform: {
          ...currentTransform,
          x: (newTransform.x ?? oldX),
          y: (newTransform.y ?? oldY),
        }
      });
      return;
    }

    // ★ 没有关键帧时，直接更新静态 transform
    saveToHistory();
    updateClip(targetClipId, {
      transform: {
        ...targetClip.transform,
        ...newTransform,
      }
    });
  }, [selectedClipId, activeVideoClip?.id, clips, keyframes, updateClip, saveToHistory]);

  // ★ 点击视频区域时选中当前活跃的视频 clip
  const handleVideoClick = useCallback((e: React.MouseEvent) => {
    // 阻止冒泡，避免触发外层的取消选择
    e.stopPropagation();
    
    // 选中当前播放的视频 clip
    const videoClipToSelect = activeVideoClip || selectedVideoClip;
    if (videoClipToSelect) {
      selectClip(videoClipToSelect.id);
    }
  }, [activeVideoClip, selectedVideoClip, selectClip]);

  // 获取 clearSelection
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const setCanvasEditMode = useEditorStore((s) => s.setCanvasEditMode);

  // ★ 点击视频框外的区域时取消选择并关闭侧边栏
  const handleOutsideClick = useCallback((e: React.MouseEvent) => {
    // 如果点击的就是最外层容器（不是内部元素），则取消选择
    if (e.target === e.currentTarget) {
      clearSelection();
      setActiveSidebarPanel(null);
      setCanvasEditMode(null);
    }
  }, [clearSelection, setActiveSidebarPanel, setCanvasEditMode]);

  // ★ 点击画布空白区域时关闭侧边栏
  const handleCanvasBackgroundClick = useCallback((e: React.MouseEvent) => {
    // 如果点击的是空白区域（不是视频或覆盖层），关闭侧边栏
    if (e.target === e.currentTarget) {
      clearSelection();
      setActiveSidebarPanel(null);
      setCanvasEditMode(null);
    }
  }, [clearSelection, setActiveSidebarPanel, setCanvasEditMode]);

  // 控制栏自动隐藏
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 2500);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    }
  }, [isPlaying]);

  // 进度百分比
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ★★★ 初始加载状态管理（智能判断）★★★
  // 追踪是否是首次加载（组件挂载后第一个视频）
  const isFirstLoadRef = useRef(true);
  const loadingAssetIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    const assetId = currentVideoClip?.assetId;
    
    if (!assetId) {
      setIsInitialLoading(false);
      return;
    }
    
    // 同一个 asset，不需要重新处理
    if (loadingAssetIdRef.current === assetId) {
      return;
    }
    loadingAssetIdRef.current = assetId;
    
    // ★ 关键：检查当前素材是否已预热或已挂载
    const isPreheated = isVideoPreheated(assetId);
    const isMounted = mountedVideosRef.current.has(assetId);
    
    if (isFirstLoadRef.current && !isPreheated && !isMounted) {
      // 首次加载且没有预热
      bufferLog('🎬 首次加载视频，显示加载弹窗');
      setIsInitialLoading(true);
      setLoadingStage('loading');
      isFirstLoadRef.current = false;
    } else if (!isPreheated && !isMounted) {
      // 切换到未预热且未挂载的视频
      bufferLog('🔄 切换到未预热视频，显示加载弹窗');
      setIsInitialLoading(true);
      setLoadingStage('loading');
    } else {
      // 已预热或已挂载，无需显示加载
      bufferLog('✨ 视频已预热/已挂载，跳过加载弹窗');
      setIsInitialLoading(false);
      isFirstLoadRef.current = false;
    }
  }, [currentVideoClip?.assetId]);

  // ★★★ 当视频准备好时，结束初始加载 ★★★
  useEffect(() => {
    if (isVideoReady && isInitialLoading) {
      // ★ HLS 模式：不需要等待大量缓冲，可以边播边缓冲
      if (videoSourceType === 'hls') {
        bufferLog('✅ HLS 模式，视频准备就绪，关闭加载弹窗');
        setIsInitialLoading(false);
        return;
      }
      
      // MP4 模式：如果缓冲进度还低，先显示缓冲状态
      if (bufferProgress < 30) {
        setLoadingStage('buffering');
        // 等待缓冲达到 30% 或 2 秒后结束
        const timeout = setTimeout(() => {
          setIsInitialLoading(false);
        }, 2000);
        return () => clearTimeout(timeout);
      } else {
        setIsInitialLoading(false);
      }
    }
  }, [isVideoReady, isInitialLoading, bufferProgress, videoSourceType]);

  // ★★★ 短项目预热时显示加载弹窗 ★★★
  const isShortProjectPreheating = preheatStrategy === 'short' && !isPreheatComplete;

  return (
    <div 
      ref={containerRef} 
      className="relative flex flex-col w-full h-full flex-1 bg-transparent overflow-hidden"
      onClick={handleOutsideClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* ★★★ 转码中状态显示 - ProRes 等格式需要后台转码 ★★★ */}
      {isTranscoding && (
        <BlockingLoader
          isLoading={true}
          type="video"
          title="视频转码中..."
          subtitle="正在将视频转换为流式播放格式，请稍候。此过程在后台进行，完成后自动播放。"
          stage={hlsSource?.hlsStatus === 'generating' ? '正在生成 HLS 流...' : '正在处理视频...'}
        />
      )}

      {/* ★★★ 阻塞性加载弹窗 - 短项目预热或初始加载时显示（非转码状态）★★★ */}
      {!isTranscoding && (
        <BlockingLoader
          isLoading={(isShortProjectPreheating || isInitialLoading) && !!videoUrl}
          type="video"
          title="视频准备中..."
          subtitle={isShortProjectPreheating 
            ? `正在预加载视频确保流畅播放 (${projectTotalDuration.toFixed(0)}秒短视频)` 
            : loadingStage === 'loading' 
              ? '正在加载视频资源' 
              : '正在缓冲视频以确保流畅播放'
          }
          progress={loadingStage === 'buffering' && !isShortProjectPreheating ? bufferProgress : undefined}
          stage={isShortProjectPreheating ? '预热视频...' : loadingStage === 'loading' ? '连接服务器...' : undefined}
        />
      )}

      {/* 视频画布区域 - 裁剪超出画布边界的内容（只显示绿框内） */}
      <div ref={videoAreaRef} className="flex-1 flex items-center justify-center min-h-0 p-4" onClick={handleCanvasBackgroundClick}>
        {videoUrl ? (
          canvasSize.width > 0 && canvasSize.height > 0 ? (
            <div 
              className="relative rounded-2xl shadow-lg"
              style={{
                width: canvasSize.width,
                height: canvasSize.height,
                transform: `scale(${zoom})`,
                transformOrigin: 'center center',
                transition: 'transform 0.2s ease-out',
                // ★ 裁剪内容：只显示画布范围内的视频（绿框内）
                overflow: 'hidden',
              }}
            >
              {/* 视频背景（纯灰色） */}
              <div 
                className="absolute inset-0"
                style={{ background: '#f5f5f5' }}
              />
              
              {/* ★★★ 视频容器：动态挂载预热的视频元素 ★★★ */}
              <div 
                ref={videoContainerCallback}
                className="relative w-full h-full cursor-pointer"
                style={{
                  ...videoStyle,
                  willChange: 'transform, opacity',
                  backfaceVisibility: 'hidden',
                }}
                onClick={handleVideoClick}
              />

              {/* 加载/缓冲指示器 */}
              {!isVideoReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                  <div className="text-center space-y-2">
                    <RabbitLoader size={48} />
                    <p className="text-xs text-gray-500">视频加载中...</p>
                  </div>
                </div>
              )}

              {/* 定位/缓冲提示 */}
              {isVideoReady && seekingLabel && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-white/90 backdrop-blur-sm rounded-lg px-4 py-2 flex items-center space-x-2 shadow-sm">
                    <RabbitLoader size={20} />
                    <p className="text-xs text-gray-600">
                      {seekingLabel === 'seeking' ? '定位中...' : '缓冲中...'}
                    </p>
                  </div>
                </div>
              )}

              {/* Transform 覆盖层 - 选中视频进入transform模式时显示 */}
              {canvasEditMode === 'transform' && isVideoReady && !isPlaying && (
                <TransformOverlay
                  containerWidth={canvasSize.width}
                  containerHeight={canvasSize.height}
                  clip={selectedVideoClip || activeVideoClip}
                  onTransformChange={handleTransformChange}
                  currentScale={currentTransformValues.scale}
                  currentOffsetX={currentTransformValues.x}
                  currentOffsetY={currentTransformValues.y}
                  zoom={zoom}
                />
              )}

              {/* 文本覆盖层 - 始终渲染可见的文本 clip */}
              <TextOverlay
                containerWidth={canvasSize.width}
                containerHeight={canvasSize.height}
                zoom={zoom}
                showControls={(canvasEditMode === 'text' || canvasEditMode === 'subtitle') && !isPlaying}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <RabbitLoader size={48} />
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <Play size={32} className="text-gray-400" />
            </div>
            <p className="text-sm text-gray-600">暂无视频</p>
            <p className="text-xs text-gray-500 mt-1">上传或导入视频开始编辑</p>
          </div>
        )}
      </div>

      {/* 底部控制栏已移除 - 播放控制通过时间轴进行 */}
    </div>
  );
}

// 导出
export { VideoCanvasNew as VideoCanvas };
