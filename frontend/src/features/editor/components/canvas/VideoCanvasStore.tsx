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
import { ImageOverlay } from '../ImageOverlay';
import { BlockingLoader } from '../BlockingLoader';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import type { Clip } from '../../types/clip';
import type { Keyframe } from '../../types/keyframe';
import { getAssetProxyUrl, getHlsPlaylistUrl, checkHlsAvailable } from '@/lib/api/media-proxy';

const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
// 视频播放/缓冲专用调试日志（生产环境关闭）
const DEBUG_VIDEO_BUFFER = false;
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[VideoCanvas]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[VideoCanvas]', ...args); };
const bufferLog = (...args: unknown[]) => { if (DEBUG_VIDEO_BUFFER) console.log('[VideoBuffer]', ...args); };
// 预热日志（仅在 development 模式下打印）
const preheatLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[Preheat]', ...args); };

type AspectRatio = '16:9' | '9:16';

const ASPECT_RATIOS: Record<AspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const SEEK_THRESHOLD = 0.05;        // seek 阈值（秒）- 50ms 精度
const AUDIO_DRIFT_THRESHOLD = 0.08; // 音频漂移阈值（秒）- 80ms 精度
const SEEK_DEBOUNCE_MS = 250;       // ★★★ seek 防抖间隔（毫秒）- 从 100ms 增加到 250ms
const SCRUBBING_FRAME_SKIP = 5;     // ★★★ 拖动时每 N 帧才真正 seek 一次
const STORE_UPDATE_INTERVAL = 33;   // 30fps 节流 store 更新

// ★★★ 治本修复：Seek 节流配置 ★★★
const RENDER_SEEK_THRESHOLD = 0.5;      // 渲染时 seek 阈值（秒）- 500ms，只有大漂移才 seek
const RAF_SEEK_THRESHOLD = 0.3;         // RAF循环中 seek 阈值（秒）- 300ms
const BROLL_SEEK_THRESHOLD = 0.8;       // B-Roll seek 阈值（秒）- 800ms，更宽容
const SEEK_COOLDOWN_MS = 300;           // seek 冷却时间（毫秒）- 同一视频 300ms 内不重复 seek
const CLIP_SWITCH_WAIT_MS = 100;        // clip 切换等待时间（毫秒）- 等待视频就绪

// ★★★ Seek 时间戳记录：避免频繁 seek 同一视频 ★★★
const lastSeekTimestamps = new Map<string, number>(); // clipId -> timestamp

// ★ 音量转换：clip.volume 范围 0-2，但 HTMLMediaElement.volume 只支持 0-1
// 超过 1 的部分需要通过 Web Audio API 的 GainNode 实现，暂时先限制到 1
const clampVolume = (vol: number | undefined): number => Math.min(1, Math.max(0, vol ?? 1));

// ★★★ 构建滤镜/调色 CSS filter 字符串 ★★★
// 注意：美颜（磨皮、美白、瘦脸等）必须通过 AI 处理，不能用 CSS filter 模拟
// 这里只处理：滤镜预设（全局色彩调整）和图像调节（亮度、对比度等）
function buildFilterStyle(clip: { effectParams?: unknown; metadata?: Record<string, unknown> }): string {
  const filters: string[] = [];
  const effectParams = clip.effectParams as Record<string, unknown> | undefined;
  
  // ★ 滤镜预设 (effectParams.filter) - 全局色彩效果，不需要人脸
  if (effectParams?.filter) {
    const filterData = effectParams.filter as { id?: string; intensity?: number };
    const filterId = filterData.id;
    const intensity = (filterData.intensity ?? 100) / 100;
    
    if (filterId && filterId !== 'none' && intensity > 0) {
      switch (filterId) {
        case 'natural':
          filters.push(`saturate(${1 + 0.1 * intensity})`);
          break;
        case 'fresh':
          filters.push(`saturate(${1 + 0.15 * intensity}) brightness(${1 + 0.02 * intensity})`);
          break;
        case 'soft':
          filters.push(`brightness(${1 + 0.03 * intensity})`);
          break;
        case 'warm':
        case 'warmwhite':
          filters.push(`sepia(${0.15 * intensity}) saturate(${1.1})`);
          break;
        case 'cool':
        case 'coldwhite':
          filters.push(`hue-rotate(${-10 * intensity}deg) saturate(${0.95})`);
          break;
        case 'pinkwhite':
        case 'rosy':
          filters.push(`hue-rotate(${5 * intensity}deg) brightness(${1.02})`);
          break;
        case 'peach':
        case 'cream':
          filters.push(`saturate(${0.9}) brightness(${1 + 0.05 * intensity})`);
          break;
        case 'ins':
        case 'film':
        case 'vintage':
          filters.push(`sepia(${0.2 * intensity}) contrast(${1.1})`);
          break;
        case 'blackwhite':
        case 'bw':
          filters.push(`grayscale(${intensity})`);
          break;
        case 'drama':
          filters.push(`contrast(${1 + 0.3 * intensity}) saturate(${1 + 0.2 * intensity})`);
          break;
        case 'fade':
          filters.push(`contrast(${1 - 0.1 * intensity}) brightness(${1 + 0.05 * intensity})`);
          break;
      }
    }
  }
  
  // ★ 图片/视频调节参数 (metadata.imageAdjustments) - 全局调色，不需要人脸
  const adjustments = clip.metadata?.imageAdjustments as Record<string, number> | undefined;
  if (adjustments) {
    if (adjustments.temperature !== undefined && adjustments.temperature !== 0) {
      filters.push(`hue-rotate(${adjustments.temperature * 0.5}deg)`);
    }
    if (adjustments.tint !== undefined && adjustments.tint !== 0) {
      filters.push(`hue-rotate(${adjustments.tint * 1.8}deg)`);
    }
    if (adjustments.saturation !== undefined && adjustments.saturation !== 0) {
      filters.push(`saturate(${1 + adjustments.saturation / 100})`);
    }
    if (adjustments.brightness !== undefined && adjustments.brightness !== 0) {
      filters.push(`brightness(${1 + adjustments.brightness / 100})`);
    }
    if (adjustments.contrast !== undefined && adjustments.contrast !== 0) {
      filters.push(`contrast(${1 + adjustments.contrast / 100})`);
    }
  }
  
  return filters.length > 0 ? filters.join(' ') : '';
}

// ★★★ 检测是否需要 AI 美颜处理（面部变形功能需要 MediaPipe） ★★★
function needsAIBeautyProcessing(clip: { effectParams?: unknown }): boolean {
  const effectParams = clip.effectParams as Record<string, unknown> | undefined;
  if (!effectParams?.beauty) return false;
  
  const beauty = effectParams.beauty as Record<string, number>;
  
  // 面部变形功能需要 AI 处理（不能用 CSS filter 实现）
  return (
    (beauty.thinFace ?? 0) > 0 ||
    (beauty.smallFace ?? 0) > 0 ||
    (beauty.vFace ?? 0) > 0 ||
    (beauty.chin ?? 0) !== 0 ||
    (beauty.forehead ?? 0) !== 0 ||
    (beauty.cheekbone ?? 0) > 0 ||
    (beauty.jawbone ?? 0) > 0 ||
    (beauty.bigEye ?? 0) > 0 ||
    (beauty.eyeDistance ?? 0) !== 0 ||
    (beauty.eyeAngle ?? 0) !== 0 ||
    (beauty.brightenEye ?? 0) > 0 ||
    (beauty.thinNose ?? 0) > 0 ||
    (beauty.noseWing ?? 0) > 0 ||
    (beauty.noseTip ?? 0) !== 0 ||
    (beauty.noseBridge ?? 0) > 0 ||
    (beauty.mouthSize ?? 0) !== 0 ||
    (beauty.lipThickness ?? 0) !== 0 ||
    (beauty.smile ?? 0) > 0 ||
    (beauty.teethWhiten ?? 0) > 0 ||
    (beauty.removeAcne ?? 0) > 0 ||
    (beauty.removeDarkCircle ?? 0) > 0 ||
    (beauty.removeWrinkle ?? 0) > 0
  );
}

// ★★★ 检测是否需要 AI 美体处理 ★★★
function needsAIBodyProcessing(clip: { effectParams?: unknown }): boolean {
  const effectParams = clip.effectParams as Record<string, unknown> | undefined;
  if (!effectParams?.body) return false;
  
  const body = effectParams.body as Record<string, number>;
  
  return (
    (body.autoBody ?? 0) > 0 ||
    (body.slimBody ?? 0) > 0 ||
    (body.longLeg ?? 0) > 0 ||
    (body.slimLeg ?? 0) > 0 ||
    (body.slimWaist ?? 0) > 0 ||
    (body.slimArm ?? 0) > 0 ||
    (body.shoulder ?? 0) !== 0 ||
    (body.hip ?? 0) > 0 ||
    (body.swanNeck ?? 0) > 0
  );
}

// ★★★ HLS 流式播放配置 ★★★
// 优化要点：
// 1. 增大缓冲区：maxBufferLength 从 30s 增加到 120s，支持长视频顺畅播放
// 2. 增加分片加载超时：fragLoadingTimeOut 从 20s 增加到 60s，适应慢网络
// 3. 增加重试次数：fragLoadingMaxRetry 从 6 增加到 8，提高容错能力
// 4. 提前缓冲策略：backBufferLength 保留已播放内容用于回看
// 5. ★★★ seek 时保留缓存：避免拖动播放头时重复请求 ts 文件 ★★★
const HLS_CONFIG: Partial<HlsConfig> = {
  // ★ 前向缓冲 - 支持长视频
  maxBufferLength: 120,          // 最大缓冲 120 秒（原 30s）
  maxMaxBufferLength: 300,       // 极限缓冲 5 分钟（原 60s）
  maxBufferSize: 200 * 1000 * 1000, // 200MB 缓冲上限（原 60MB）
  maxBufferHole: 0.5,            // 允许的缓冲空洞
  
  // ★★★ 后向缓冲 - 大幅增加以支持快速回看（关键优化）★★★
  backBufferLength: 180,         // ★ 保留 180 秒已播放内容（从 60s 增加）
  
  // ★ 加载超时配置 - 增强网络容错
  manifestLoadingTimeOut: 15000,  // playlist 加载超时 15s（原 10s）
  manifestLoadingMaxRetry: 5,     // 重试 5 次（原 3 次）
  levelLoadingTimeOut: 15000,    // （原 10s）
  levelLoadingMaxRetry: 4,       // 新增
  fragLoadingTimeOut: 60000,     // 分片加载超时 60s（原 20s）★ 关键
  fragLoadingMaxRetry: 8,        // 重试 8 次（原 6 次）
  
  // ★ 预加载策略 - 主动缓冲
  startFragPrefetch: true,       // 预加载起始分片（新增）
  testBandwidth: true,           // 带宽测试以选择最佳质量（新增）
  
  // ★★★ Seek 优化：保持已加载的 segment 不被清除 ★★★
  liveSyncDuration: 0,           // 非直播模式
  liveBackBufferLength: Infinity, // 后向缓冲无限（非直播）
  
  // ★ 其他配置
  lowLatencyMode: false,
  startLevel: -1,                // 自动选择质量
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
      bufferLog('  ↳ HLS 状态:', status.available ? 'ready' : status.cloudflareStatus || status.hlsStatus || 'processing',
        '| canPlayMp4:', status.canPlayMp4, '| needsTranscode:', status.needsTranscode);
      
      let info: HlsSourceInfo;
    
    if (status.available && status.playlistUrl) {
      // ★ HLS 已就绪，直接使用
      let playlistUrl = status.playlistUrl;
      
      // 相对路径加上 API 基础 URL
      if (playlistUrl.startsWith('/')) {
        playlistUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}${playlistUrl}`;
      }
      
      info = { 
        url: playlistUrl, 
        type: 'hls', 
        checked: true,
        needsTranscode: false,
        hlsStatus: 'ready',
      };
    } else if (status.canPlayMp4) {
      // ★★★ 关键修复：如果可以播放 MP4，直接用 MP4 代理 ★★★
      // 不需要转码的视频（如 B-Roll 的 H.264）可以直接播放
      bufferLog('  ↳ 不需要 HLS，使用 MP4 代理');
      info = { 
        url: getAssetProxyUrl(assetId), 
        type: 'mp4', 
        checked: true,
        needsTranscode: false,
        hlsStatus: status.hlsStatus || 'not-needed',
      };
    } else {
      // ★ 需要转码但 HLS 未就绪，显示处理中
      info = { 
        url: '', 
        type: 'transcoding', 
        checked: true,
        needsTranscode: true,
        hlsStatus: status.cloudflareStatus || status.hlsStatus || 'processing',
      };
    }
    
    hlsSourceCache.set(assetId, info);
    return info;
  } catch (error) {
    // ★★★ 记录详细错误，但不抛异常，回退到 MP4 代理 ★★★
    console.error(`[VideoBuffer] ❌ getHlsSource 失败 (assetId=${assetId}):`, error);
    bufferLog('  ❌ getHlsSource 失败，回退到 MP4 代理:', assetId.slice(-8));
    
    // ★ 失败时回退到 MP4 代理，不阻塞播放
    const fallbackInfo: HlsSourceInfo = { 
      url: getAssetProxyUrl(assetId), 
      type: 'mp4', 
      checked: true,
      needsTranscode: false,
      hlsStatus: 'fallback',
    };
    hlsSourceCache.set(assetId, fallbackInfo);
    return fallbackInfo;
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
          // ★★★ 预热缓冲 30s，确保播放流畅 ★★★
          hlsInstance = new Hls({
            ...HLS_CONFIG,
            maxBufferLength: 30,
            maxMaxBufferLength: 45,
            startFragPrefetch: true,
          });
          
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
      
      // 超时保护 90 秒（长视频需要更长时间下载 manifest + 第一个分片）
      // ★ 从 30s 增加到 90s，支持大文件和慢网络
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
      }, 90000); // ★ 90 秒超时（从 30s 增加）
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

// ★★★ 滑动预热窗口配置 ★★★
const PRELOAD_WINDOW_SIZE = 5;  // 预热窗口：当前 ± 2 个 clip（共5个）
const MAX_POOL_SIZE = 8;        // 预热池最大容量（超出时清理最老的）

/**
 * ★★★ 滑动窗口预热管理 ★★★
 * 根据当前播放位置，维护一个预热窗口，自动预热窗口内的视频，释放窗口外的资源
 * 
 * @param allVideoClips 所有视频 clips（按时间轴顺序）
 * @param currentClipIndex 当前播放的 clip 索引
 */
export function updatePreloadWindow(
  allVideoClips: Array<{ id: string; assetId?: string; start: number }>,
  currentClipIndex: number
): void {
  if (allVideoClips.length === 0) return;
  
  // 计算窗口范围：当前 ± 2
  const windowStart = Math.max(0, currentClipIndex - 2);
  const windowEnd = Math.min(allVideoClips.length - 1, currentClipIndex + 2);
  
  // 获取窗口内需要预热的 assetIds
  const windowAssetIds = new Set<string>();
  for (let i = windowStart; i <= windowEnd; i++) {
    const assetId = allVideoClips[i]?.assetId;
    if (assetId) {
      windowAssetIds.add(assetId);
    }
  }
  
  bufferLog('📦 更新预热窗口:', 
    `当前索引=${currentClipIndex}`,
    `窗口范围=[${windowStart}-${windowEnd}]`,
    `窗口内资源数=${windowAssetIds.size}`
  );
  
  // 1. 预热窗口内未预热的资源
  windowAssetIds.forEach(assetId => {
    if (!videoPreloadPool.has(assetId) && !preloadingAssets.has(assetId)) {
      bufferLog('🔥 窗口预热:', assetId.slice(-8));
      preheatVideo(assetId);
    }
  });
  
  // 2. 清理窗口外的资源（但保留最近使用的）
  if (videoPreloadPool.size > MAX_POOL_SIZE) {
    const poolEntries = Array.from(videoPreloadPool.entries());
    
    // 按预热时间排序（最老的在前）
    poolEntries.sort((a, b) => a[1].preheatedAt - b[1].preheatedAt);
    
    // 找出不在窗口内的资源
    const toRemove = poolEntries.filter(([assetId]) => !windowAssetIds.has(assetId));
    
    // 只清理超出最大容量的部分
    const removeCount = Math.max(0, videoPreloadPool.size - MAX_POOL_SIZE);
    
    for (let i = 0; i < Math.min(removeCount, toRemove.length); i++) {
      const [assetId, entry] = toRemove[i];
      bufferLog('🗑️ 窗口外清理:', assetId.slice(-8));
      
      // 清理资源
      if (entry.hlsInstance) {
        entry.hlsInstance.destroy();
      }
      if (entry.videoElement.parentNode) {
        entry.videoElement.parentNode.removeChild(entry.videoElement);
      }
      entry.videoElement.src = '';
      entry.videoElement.load();
      
      videoPreloadPool.delete(assetId);
    }
  }
}

/**
 * ★★★ 新素材自动预热 ★★★
 * 当添加新素材到时间轴时调用，自动预热新素材
 */
export async function preheatNewAsset(assetId: string): Promise<boolean> {
  if (!assetId) return false;
  
  // 已经在预热池中
  if (videoPreloadPool.has(assetId)) {
    bufferLog('✅ 新素材已在预热池:', assetId.slice(-8));
    return true;
  }
  
  // 正在预热中
  if (preloadingAssets.has(assetId)) {
    bufferLog('⏳ 新素材正在预热中:', assetId.slice(-8));
    return preloadPromises.get(assetId) ?? Promise.resolve(false);
  }
  
  bufferLog('🆕 预热新素材:', assetId.slice(-8));
  return preheatVideo(assetId);
}

/**
 * ★★★ 获取预热池状态 ★★★
 * 用于调试和监控
 */
export function getPreloadPoolStatus(): {
  size: number;
  maxSize: number;
  entries: Array<{
    assetId: string;
    readyState: number;
    bufferedPercent: number;
    preheatedAt: number;
    type: string;
  }>;
} {
  const entries = Array.from(videoPreloadPool.entries()).map(([assetId, entry]) => ({
    assetId: assetId.slice(-8),
    readyState: entry.readyState,
    bufferedPercent: entry.bufferedPercent,
    preheatedAt: entry.preheatedAt,
    type: entry.sourceInfo.type,
  }));
  
  return {
    size: videoPreloadPool.size,
    maxSize: MAX_POOL_SIZE,
    entries,
  };
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
  element.crossOrigin = 'anonymous'; // 支持跨域视频（如 Pexels B-roll）
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
  // ★★★ 组件卸载清理：销毁所有 HLS 实例和视频元素 ★★★
  useEffect(() => {
    return () => {
      bufferLog('🧹 组件卸载，清理资源...');
      
      // 清理挂载的视频元素
      mountedVideosRef.current.forEach((info, assetId) => {
        if (info.hlsInstance) {
          info.hlsInstance.destroy();
        }
        if (info.element.parentNode) {
          info.element.remove();
        }
      });
      mountedVideosRef.current.clear();
      
      // 清理 HLS 缓存
      clearHlsCache();
    };
  }, []);

  // Store 状态
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const assets = useEditorStore((s) => s.assets);
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
  // ★★★ 【已删除】videoRefInternal - 死代码，所有视频通过 mountedVideosRef 管理 ★★★
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
  // ★ loadingStage 已移除，加载状态由预热流程统一管理
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
  
  // ★★★ 【已删除】videoRef callback - 死代码 ★★★

  // 分离视频、音频和图片 clips
  const { videoClips, audioClips, imageClips } = useMemo(() => {
    const video: Clip[] = [];
    const audio: Clip[] = [];
    const image: Clip[] = [];
    clips.forEach(c => {
      // ★ 修复：只要有 mediaUrl 或 assetId 就可以播放
      // assetId 可以用来动态生成代理 URL
      if (!c.mediaUrl && !c.assetId) return;
      if (c.clipType === 'video') video.push(c);
      else if (c.clipType === 'audio') audio.push(c);
      else if (c.clipType === 'image') image.push(c);
    });
    bufferLog('📋 Clips 过滤结果: video=', video.length, 'audio=', audio.length, 'image=', image.length, 'total=', clips.length);
    return { videoClips: video, audioClips: audio, imageClips: image };
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
  
  // 当前活跃的图片 clips（可能有多个，按 track.orderIndex 排序）
  const activeImageClips = useMemo(() => {
    return imageClips
      .filter(c => currentTime >= c.start && currentTime < c.start + c.duration)
      .sort((a, b) => {
        // 按 trackId 找到 track 的 orderIndex，越高越靠上
        const trackA = tracks.find(t => t.id === a.trackId);
        const trackB = tracks.find(t => t.id === b.trackId);
        return (trackB?.orderIndex || 0) - (trackA?.orderIndex || 0);
      });
  }, [imageClips, currentTime, tracks]);
  
  // ★★★ 关键修复：使用 activeVideoClip 的 URL，而不是固定使用第一个 ★★★
  // 如果当前时间没有活跃的 clip，退回到第一个 clip
  const currentVideoClip = activeVideoClip || primaryVideoClip;
  
  // 是否有可视内容（视频或图片）
  const hasVisualContent = videoClips.length > 0 || imageClips.length > 0;
  
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
  
  // ★★★ 智能预热策略：统一使用阻塞式预热，确保所有 clip 准备好后才可操作 ★★★
  const preheatedRef = useRef<Set<string>>(new Set()); // 记录已预热的 assetId
  const [isPreheatComplete, setIsPreheatComplete] = useState(false);
  // ★★★ 预热进度追踪 ★★★
  const [preheatProgress, setPreheatProgress] = useState({ done: 0, total: 0 });
  
  // ★★★ 计算所有 clip 的 assetId 列表（用于检测素材替换）★★★
  const videoClipAssetIds = useMemo(() => {
    return videoClips.map(c => c.assetId || '').join(',');
  }, [videoClips]);
  
  // ★★★ 核心优化：只预热前几个 clip，其他按需加载 ★★★
  // 避免 20 个 clip 同时预热导致 500+ 请求
  // ★★★ 治本：增加初始预热数量到 5，覆盖更多初始播放场景 ★★★
  const PREHEAT_LIMIT = 5;
  
  useEffect(() => {
    if (videoClips.length === 0) {
      // 没有视频 clip 时直接完成
      setIsPreheatComplete(true);
      setIsInitialLoading(false);
      return;
    }
    
    // ★★★ 只预热前 N 个 clip ★★★
    const clipsToPreload = videoClips.slice(0, PREHEAT_LIMIT);
    const totalToPreload = clipsToPreload.length;
    
    // 重置状态
    setIsPreheatComplete(false);
    setIsInitialLoading(true);
    setPreheatProgress({ done: 0, total: totalToPreload });
    
    preheatLog('🚀 开始预热视频，预热前', totalToPreload, '个 clips（共', videoClips.length, '个）');
    
    // 为每个 clip 创建预加载的视频元素（使用 HLS 流式加载）
    const preloadClipVideos = async () => {
      let completedCount = 0;
      let firstClipReady = false;
      
      // ★★★ 串行预热，避免并发请求过多 ★★★
      // 原来是 3 并发预热所有 clip，现在改为串行预热前 3 个
      const CONCURRENT_LIMIT = 1; // 改为串行
      const queue = [...clipsToPreload];
      const inProgress: Promise<void>[] = [];
      
      const preloadOneClip = async (clip: typeof videoClips[0], index: number) => {
        const clipLabel = `[${index + 1}/${totalToPreload}] ${clip.id.slice(-8)}`;
        const assetId = clip.assetId;
        
        // 如果已经挂载了这个 clip，跳过
        if (mountedVideosRef.current.has(clip.id)) {
          preheatLog(`  ✓ ${clipLabel} 已挂载，跳过`);
          completedCount++;
          setPreheatProgress({ done: completedCount, total: totalToPreload });
          
          // ★★★ 第一个 clip 就绪后立即解除阻塞 ★★★
          if (index === 0 && !firstClipReady) {
            firstClipReady = true;
            preheatLog('🎬 第一个视频就绪，解除阻塞');
            setIsInitialLoading(false);
            setIsVideoReady(true);
          }
          return;
        }
        
        if (!assetId) {
          preheatLog(`  ⚠️ ${clipLabel} 无 assetId，跳过`);
          completedCount++;
          setPreheatProgress({ done: completedCount, total: totalToPreload });
          return;
        }
        
        // ★★★ 多 clip 共享 asset：检查同 asset 是否已有 clip 预热过 ★★★
        const existingClipWithSameAsset = Array.from(mountedVideosRef.current.entries())
          .find(([, info]) => {
            // 找到使用同一 asset 的已挂载 clip
            const clipInfo = videoClips.find(c => c.id === info.element?.dataset?.clipId);
            return clipInfo?.assetId === assetId;
          });
        
        if (existingClipWithSameAsset) {
          // 复用已预热的视频元素（需要克隆，否则多个 clip 会冲突）
          preheatLog(`  ♻️ ${clipLabel} 复用同 asset 的预热结果`);
        }
        
        preheatLog(`  ⏳ ${clipLabel} 开始预热...`);
        
        try {
          // 1. 获取 HLS 源信息（有缓存，同 asset 只请求一次）
          const sourceInfo = await getHlsSource(assetId);
          
          // 2. 如果正在转码，跳过预热
          if (sourceInfo.type === 'transcoding') {
            preheatLog(`  ⏳ ${clipLabel} 视频转码中，跳过预热`);
            completedCount++;
            setPreheatProgress({ done: completedCount, total: totalToPreload });
            return;
          }
          
          // 3. 创建视频元素（每个 clip 需要独立的视频元素，因为 currentTime 不同）
          // ★★★ 治本：不能用 visibility:hidden 或 1px，否则浏览器可能不加载 ★★★
          const video = document.createElement('video');
          video.preload = 'auto';
          video.playsInline = true;
          video.muted = true;
          video.dataset.clipId = clip.id; // ★ 标记所属 clip
          video.dataset.assetId = assetId; // ★ 标记所属 asset
          // ★★★ 关键：不设置 crossOrigin，避免跨域问题 ★★★
          // video.crossOrigin = 'anonymous';
          
          // ★★★ 使用 offscreen 方式隐藏，而不是 visibility:hidden ★★★
          video.style.position = 'fixed';
          video.style.left = '-9999px';
          video.style.top = '-9999px';
          video.style.width = '320px';  // 给一个合理的尺寸
          video.style.height = '240px';
          video.style.opacity = '0';
          video.style.pointerEvents = 'none';
          document.body.appendChild(video);
          
          let hlsInstance: Hls | null = null;
          
          // 4. 根据源类型初始化
          if (sourceInfo.type === 'hls' && Hls.isSupported()) {
            // ★★★ 关键：为每个 clip 创建独立的 HLS 实例 ★★★
            // ★★★ 优化：预热前 3 个 clip，每个缓冲 30 秒保证流畅 ★★★
            hlsInstance = new Hls({
              ...HLS_CONFIG,
              // ★ 预热缓冲 30s，确保播放流畅不卡顿
              maxBufferLength: 30,
              maxMaxBufferLength: 45,
              startFragPrefetch: true, // 启用预取
            });
            
            // ★★★ 修复：等待视频真正可以播放（canplay），而不仅仅是 manifest 解析 ★★★
            await new Promise<void>((resolve, reject) => {
              let resolved = false;
              
              // 监听视频元素的 canplay 事件（readyState >= 3）
              const onCanPlay = () => {
                if (!resolved) {
                  resolved = true;
                  video.removeEventListener('canplay', onCanPlay);
                  video.removeEventListener('loadeddata', onCanPlay);
                  preheatLog(`    📦 ${clipLabel} 视频可播放，readyState=${video.readyState}`);
                  resolve();
                }
              };
              
              // canplay 或 loadeddata 都可以
              video.addEventListener('canplay', onCanPlay);
              video.addEventListener('loadeddata', onCanPlay);
              
              hlsInstance!.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal && !resolved) {
                  resolved = true;
                  video.removeEventListener('canplay', onCanPlay);
                  video.removeEventListener('loadeddata', onCanPlay);
                  reject(new Error(data.details));
                }
              });
              
              hlsInstance!.loadSource(sourceInfo.url);
              hlsInstance!.attachMedia(video);
              
              // 超时保护 60s（增加到 60s，确保有足够时间加载）
              setTimeout(() => {
                if (!resolved) {
                  resolved = true;
                  video.removeEventListener('canplay', onCanPlay);
                  video.removeEventListener('loadeddata', onCanPlay);
                  preheatLog(`    ⚠️ ${clipLabel} 预热超时，当前 readyState=${video.readyState}`);
                  resolve(); // 超时也继续，不阻塞其他 clip
                }
              }, 60000);
            });
            
          } else {
            // MP4 模式
            video.src = sourceInfo.url || getAssetProxyUrl(assetId);
            
            // ★★★ 治本：等待 canplay（readyState >= 3）或至少 loadeddata（readyState >= 2）★★★
            await new Promise<void>((resolve) => {
              let resolved = false;
              
              const onReady = () => {
                if (resolved) return;
                // 只有 readyState >= 2 才算真正就绪
                if (video.readyState >= 2) {
                  resolved = true;
                  video.removeEventListener('canplay', onReady);
                  video.removeEventListener('loadeddata', onReady);
                  video.removeEventListener('canplaythrough', onReady);
                  video.removeEventListener('error', onError);
                  preheatLog(`    📦 ${clipLabel} MP4 数据加载完成，readyState=${video.readyState}`);
                  resolve();
                }
              };
              
              const onError = () => {
                if (resolved) return;
                resolved = true;
                video.removeEventListener('canplay', onReady);
                video.removeEventListener('loadeddata', onReady);
                video.removeEventListener('canplaythrough', onReady);
                video.removeEventListener('error', onError);
                preheatLog(`    ❌ ${clipLabel} MP4 加载出错`);
                resolve();
              };
              
              video.addEventListener('canplay', onReady);
              video.addEventListener('loadeddata', onReady);
              video.addEventListener('canplaythrough', onReady);
              video.addEventListener('error', onError);
              
              // 触发加载
              video.load();
              
              // 超时 30s
              setTimeout(() => {
                if (!resolved) {
                  resolved = true;
                  video.removeEventListener('canplay', onReady);
                  video.removeEventListener('loadeddata', onReady);
                  video.removeEventListener('canplaythrough', onReady);
                  video.removeEventListener('error', onError);
                  preheatLog(`    ⚠️ ${clipLabel} MP4 加载超时，readyState=${video.readyState}`);
                  resolve();
                }
              }, 30000);
            });
          }
          
          // 5. 注册到挂载池（★★★ 关键：只有 readyState >= 2 才算真正准备好 ★★★）
          const isVideoReady = video.readyState >= 2;
          mountedVideosRef.current.set(clip.id, {
            element: video,
            hlsInstance,
            isReady: isVideoReady,
          });
          
          // ★★★ 如果还没准备好，继续等待 ★★★
          if (!isVideoReady) {
            preheatLog(`    ⏳ ${clipLabel} 等待视频数据加载... (readyState=${video.readyState})`);
            await new Promise<void>((resolve) => {
              const checkReady = () => {
                if (video.readyState >= 2) {
                  const info = mountedVideosRef.current.get(clip.id);
                  if (info) info.isReady = true;
                  video.removeEventListener('canplay', checkReady);
                  video.removeEventListener('loadeddata', checkReady);
                  resolve();
                }
              };
              video.addEventListener('canplay', checkReady);
              video.addEventListener('loadeddata', checkReady);
              // 10秒超时
              setTimeout(() => {
                video.removeEventListener('canplay', checkReady);
                video.removeEventListener('loadeddata', checkReady);
                resolve();
              }, 10000);
            });
          }
          
          // 6. 设置正确的初始时间点，并等待 seek 完成
          // ★★★ 关键修复：seek 后需要等待 seeked 事件，否则 readyState 会降回 1 ★★★
          if (video.readyState >= 1) {
            const mediaTime = calcMediaTime(clip.start, clip);
            const targetTime = Math.max(0, mediaTime);
            
            // 只有在需要 seek 时才 seek
            if (Math.abs(video.currentTime - targetTime) > 0.1) {
              video.currentTime = targetTime;
              
              // 等待 seek 完成
              await new Promise<void>((resolve) => {
                const onSeeked = () => {
                  video.removeEventListener('seeked', onSeeked);
                  resolve();
                };
                video.addEventListener('seeked', onSeeked, { once: true });
                // 超时保护 5s
                setTimeout(() => {
                  video.removeEventListener('seeked', onSeeked);
                  resolve();
                }, 5000);
              });
              
              // seek 后可能需要重新等待数据加载
              if (video.readyState < 2) {
                await new Promise<void>((resolve) => {
                  const onReady = () => {
                    if (video.readyState >= 2) {
                      video.removeEventListener('canplay', onReady);
                      video.removeEventListener('loadeddata', onReady);
                      resolve();
                    }
                  };
                  video.addEventListener('canplay', onReady);
                  video.addEventListener('loadeddata', onReady);
                  setTimeout(resolve, 5000);
                });
              }
            }
          }
          
          completedCount++;
          setPreheatProgress({ done: completedCount, total: totalToPreload });
          
          // ★★★ 最终状态日志 ★★★
          const finalReady = video.readyState >= 2;
          const info = mountedVideosRef.current.get(clip.id);
          if (info) info.isReady = finalReady;
          
          preheatLog(`  ${finalReady ? '✅' : '⚠️'} ${clipLabel} 预热${finalReady ? '完成' : '未完全就绪'} (${completedCount}/${totalToPreload})`,
            '| 源类型:', sourceInfo.type,
            '| readyState:', video.readyState,
            '| isReady:', finalReady);
          
          // ★★★ 第一个 clip 就绪后立即解除阻塞 ★★★
          if (index === 0 && finalReady && !firstClipReady) {
            firstClipReady = true;
            preheatLog('🎬 第一个视频就绪，解除阻塞');
            setIsInitialLoading(false);
            setIsVideoReady(true);
          }
            
        } catch (error) {
          completedCount++;
          setPreheatProgress({ done: completedCount, total: totalToPreload });
          preheatLog(`  ❌ ${clipLabel} 预热失败 (${completedCount}/${totalToPreload}):`, error);
        }
      };
      
      // 使用有限并发处理队列（带索引追踪）
      let clipIndex = 0;
      while (queue.length > 0 || inProgress.length > 0) {
        // 填充并发队列
        while (queue.length > 0 && inProgress.length < CONCURRENT_LIMIT) {
          const clip = queue.shift()!;
          const currentIndex = clipIndex++;
          const promise = preloadOneClip(clip, currentIndex).finally(() => {
            const idx = inProgress.indexOf(promise);
            if (idx !== -1) inProgress.splice(idx, 1);
          });
          inProgress.push(promise);
        }
        
        // 等待任意一个完成
        if (inProgress.length > 0) {
          await Promise.race(inProgress);
        }
      }
      
      // ★★★ 治本：检查预热的视频是否都真正就绪 ★★★
      const notReadyClips = clipsToPreload.filter(clip => {
        const info = mountedVideosRef.current.get(clip.id);
        return !info || !info.isReady || info.element.readyState < 2;
      });
      
      if (notReadyClips.length > 0) {
        preheatLog('⏳ 有', notReadyClips.length, '个视频未就绪，继续等待...');
        
        // 继续等待未就绪的视频
        await Promise.all(notReadyClips.map(clip => {
          return new Promise<void>((resolve) => {
            const info = mountedVideosRef.current.get(clip.id);
            if (!info) {
              resolve();
              return;
            }
            
            if (info.element.readyState >= 2) {
              info.isReady = true;
              resolve();
              return;
            }
            
            // ★ 使用轮询检查，避免事件丢失的竞态条件
            let checkCount = 0;
            const maxChecks = 60; // 30秒 / 500ms = 60次
            
            const checkReady = () => {
              checkCount++;
              if (info.element.readyState >= 2) {
                info.isReady = true;
                preheatLog(`  ✅ ${clip.id.slice(-8)} 轮询就绪，readyState:`, info.element.readyState);
                resolve();
                return;
              }
              
              if (checkCount >= maxChecks) {
                preheatLog(`  ⚠️ ${clip.id.slice(-8)} 最终超时，readyState:`, info.element.readyState);
                // 即使超时也标记为 ready，让用户可以尝试播放
                info.isReady = info.element.readyState >= 1;
                resolve();
                return;
              }
              
              setTimeout(checkReady, 500);
            };
            
            // 同时监听事件（可能更快）
            const onReady = () => {
              info.element.removeEventListener('canplay', onReady);
              info.element.removeEventListener('loadeddata', onReady);
              if (!info.isReady) {
                info.isReady = true;
                preheatLog(`  ✅ ${clip.id.slice(-8)} 事件就绪，readyState:`, info.element.readyState);
                resolve();
              }
            };
            
            info.element.addEventListener('canplay', onReady);
            info.element.addEventListener('loadeddata', onReady);
            
            // 启动轮询
            setTimeout(checkReady, 500);
          });
        }));
      }
      
      // 最终状态日志
      const readyCount = clipsToPreload.filter(clip => {
        const info = mountedVideosRef.current.get(clip.id);
        return info?.isReady;
      }).length;
      
      // ★★★ 详细调试日志：预热完成时的池子状态 ★★★
      const poolStatus = Array.from(mountedVideosRef.current.entries()).map(([k, v]) => 
        `${k.slice(-8)}:${v.isReady ? '✅' : '❌'}(rs=${v.element.readyState})`
      );
      preheatLog('🎉 预热完成！', readyCount, '/', totalToPreload, '个视频就绪');
      preheatLog('📦 mountedVideosRef 状态:', poolStatus.join(' | '));
      preheatLog('📋 全部 videoClips:', videoClips.map(c => c.id.slice(-8)).join(','));
      
      setIsPreheatComplete(true);
      setIsInitialLoading(false);
      setIsVideoReady(readyCount > 0);
    };
    
    // 直接开始预热
    preloadClipVideos().catch((err) => {
      preheatLog('❌ 预热过程出错:', err);
      setIsPreheatComplete(true);
      setIsInitialLoading(false);
    });
    
    // ★★★ 依赖说明 ★★★
    // - videoClips.length: clip 数量变化（添加/删除/切分）
    // - videoClipAssetIds: clip 的 assetId 变化（替换素材 / 添加新 clip）
    // ★ 移除 assets 依赖：assets 是对象数组，每次 load 时引用都会变化
    //   导致预热 useEffect 频繁重新执行，造成 HLS 重复请求
    //   videoClipAssetIds 已经足够检测 clip 素材变化
  }, [videoClips.length, videoClipAssetIds]);
  
  // ★★★ 动态预热：检测即将可见的所有 clips（包括叠加的 B-Roll） ★★★
  // 每当 currentTime 变化，检查接下来 15 秒内会变为可见的 clips
  // ★ 使用 ref 追踪正在预热的 clipId，防止重复预热
  const preheatInProgressRef = useRef(new Set<string>());
  
  // ★★★ 治本：使用节流的预热检测，避免每帧都检测 ★★★
  const lastPreheatCheckRef = useRef(0);
  const PREHEAT_CHECK_INTERVAL = 500; // 每500ms检测一次
  
  useEffect(() => {
    // ★★★ 节流：避免每帧都执行预热检测 ★★★
    const now = performance.now();
    if (now - lastPreheatCheckRef.current < PREHEAT_CHECK_INTERVAL) return;
    lastPreheatCheckRef.current = now;
    
    // ★★★ 治本：增加预热窗口到 15 秒，确保有足够时间加载 HLS ★★★
    const lookaheadTime = currentTime + 15000; // 提前 15 秒
    
    // ★★★ 详细日志：当前池子状态（减少日志频率）★★★
    const mountedKeys = Array.from(mountedVideosRef.current.keys()).map(k => k.slice(-8));
    const inProgressKeys = Array.from(preheatInProgressRef.current).map(k => k.slice(-8));
    
    const upcomingClips = videoClips.filter(clip => {
      // ★ 已经在挂载池的跳过
      if (mountedVideosRef.current.has(clip.id)) return false;
      // ★ 正在预热中的跳过
      if (preheatInProgressRef.current.has(clip.id)) return false;
      // ★ 没有 assetId 的跳过
      if (!clip.assetId) return false;
      // ★★★ 治本：删除 videoPreloadPool 检查 ★★★
      // 播放用的是 mountedVideosRef，所以只检查 mountedVideosRef
      // 时间范围检查：clip 会在 lookahead 时间内开始
      const willBeVisible = clip.start >= currentTime && clip.start <= lookaheadTime;
      // 或者当前时间已经在 clip 范围内（应该立即可见）
      const shouldBeVisibleNow = currentTime >= clip.start && currentTime < clip.start + clip.duration;
      return willBeVisible || shouldBeVisibleNow;
    });
    
    // ★★★ 更详细的日志 ★★★
    if (upcomingClips.length > 0) {
      preheatLog('🔮 动态预热检测:', {
        currentTime: (currentTime / 1000).toFixed(1) + 's',
        mountedKeys: mountedKeys.join(',') || '(空)',
        inProgressKeys: inProgressKeys.join(',') || '(空)',
        upcoming: upcomingClips.map(c => `${c.id.slice(-8)}@${(c.start/1000).toFixed(1)}s`).join(','),
      });
    }
    
    if (upcomingClips.length === 0) return;
    
    // 串行预热，避免并发
    upcomingClips.forEach(async (clip) => {
      // ★ 再次检查是否已被预热（可能被其他逻辑预热了）
      if (mountedVideosRef.current.has(clip.id)) return;
      if (preheatInProgressRef.current.has(clip.id)) return;
      
      const assetId = clip.assetId!;
      
      // ★★★ 治本：删除 videoPreloadPool 检查，只看 mountedVideosRef ★★★
      // 全局 videoPreloadPool 是按 assetId 存的，但播放用的是按 clip.id 的 mountedVideosRef
      // 这两个池子 key 不同，检查 videoPreloadPool 不代表 mountedVideosRef 有值
      
      // ★ 标记为正在预热
      preheatInProgressRef.current.add(clip.id);
      preloadingAssets.add(assetId);
      
      const clipLabel = clip.metadata?.is_broll ? 'B-Roll' : 'Video';
      preheatLog(`  ⚡ 动态预热 ${clipLabel}:`, clip.id.slice(-8), '| assetId:', assetId.slice(-8));
      
      try {
        const sourceInfo = await getHlsSource(assetId);
        if (sourceInfo.type === 'transcoding') {
          preheatLog(`    ⏳ ${clipLabel} 正在转码，跳过`);
          preheatInProgressRef.current.delete(clip.id);
          preloadingAssets.delete(assetId);
          return;
        }
        
        const video = document.createElement('video');
        video.preload = 'auto';
        video.playsInline = true;
        video.muted = true;
        video.dataset.clipId = clip.id;
        video.dataset.assetId = assetId;
        video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:320px;height:240px;opacity:0';
        document.body.appendChild(video);
        
        let hlsInst: Hls | null = null;
        
        if (sourceInfo.type === 'hls' && Hls.isSupported()) {
          hlsInst = new Hls({
            ...HLS_CONFIG,
            maxBufferLength: 30,
            maxMaxBufferLength: 45,
            startFragPrefetch: true,
          });
          hlsInst.loadSource(sourceInfo.url);
          hlsInst.attachMedia(video);
        } else {
          video.src = sourceInfo.url || getAssetProxyUrl(assetId);
        }
        
        // 加入挂载池
        mountedVideosRef.current.set(clip.id, {
          element: video,
          hlsInstance: hlsInst,
          isReady: false,
        });
        
        // ★ 从"正在预热"状态移除
        preheatInProgressRef.current.delete(clip.id);
        
        // ★★★ 治本修复：优化预热流程，避免频繁seek导致readyState降级 ★★★
        // 策略：先等待canplay，然后一次性seek到目标位置，等待seeked+数据加载
        const clipSourceStart = (clip.sourceStart || 0) / 1000;
        let seekCompleted = false;
        
        const markReady = () => {
          const info = mountedVideosRef.current.get(clip.id);
          if (info && !info.isReady) {
            info.isReady = true;
            preloadingAssets.delete(assetId);
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('canplaythrough', onCanPlayThrough);
            // 记录预热完成时的位置，后续seek时参考
            (video as HTMLVideoElement & { __preheatedTime?: number }).__preheatedTime = video.currentTime;
            preheatLog(`    ✅ ${clipLabel} 就绪:`, clip.id.slice(-8), 
              `| currentTime: ${video.currentTime.toFixed(2)}s | readyState: ${video.readyState}`);
          }
        };
        
        // ★★★ 等待canplaythrough而非canplay，确保有足够缓冲 ★★★
        const onCanPlayThrough = () => {
          if (seekCompleted) {
            markReady();
          }
        };
        
        const onCanPlay = () => {
          const info = mountedVideosRef.current.get(clip.id);
          // 已就绪则直接移除监听器
          if (info?.isReady) {
            video.removeEventListener('canplay', onCanPlay);
            return;
          }
          
          // 检查是否需要 seek 到 sourceStart
          if (Math.abs(video.currentTime - clipSourceStart) > 0.5) {
            preheatLog(`    🎯 ${clipLabel} seek:`, clip.id.slice(-8), 
              `| ${video.currentTime.toFixed(2)}s -> ${clipSourceStart.toFixed(2)}s`);
            
            // ★★★ 关键：seek后等待seeked+canplaythrough，确保数据已加载 ★★★
            const onSeeked = () => {
              seekCompleted = true;
              // 如果readyState已经足够，直接标记就绪
              if (video.readyState >= 3) {
                markReady();
              }
              // 否则等待canplaythrough
            };
            video.addEventListener('seeked', onSeeked, { once: true });
            video.currentTime = clipSourceStart;
          } else {
            // 不需要 seek，直接标记就绪
            seekCompleted = true;
            markReady();
          }
        };
        
        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('canplaythrough', onCanPlayThrough);
        
        // ★ 如果已经 canplay（readyState >= 3），立即触发
        if (video.readyState >= 3) {
          onCanPlay();
        }
        
        // ★ 错误处理
        video.addEventListener('error', () => {
          video.removeEventListener('canplay', onCanPlay);
          video.removeEventListener('canplaythrough', onCanPlayThrough);
          preheatInProgressRef.current.delete(clip.id);
          preloadingAssets.delete(assetId);
          preheatLog(`    ❌ ${clipLabel} 加载错误:`, clip.id.slice(-8));
        }, { once: true });
        
      } catch (error) {
        preheatInProgressRef.current.delete(clip.id);
        preloadingAssets.delete(assetId);
        preheatLog(`    ❌ ${clipLabel} 预热失败:`, error);
      }
    });
  }, [currentTime, videoClips]);
  
  // ★★★ 播放时动态预取：提前 3 秒预热下一个 clip 的视频 ★★★
  // 注：此逻辑现在由上面的通用预热逻辑覆盖，保留仅作兼容
  useEffect(() => {
    if (!isPlaying || !currentVideoClip || videoClips.length <= 1) return;
    
    const currentIndex = videoClips.findIndex(c => c.id === currentVideoClip.id);
    if (currentIndex === -1 || currentIndex >= videoClips.length - 1) return;
    
    // 计算当前 clip 剩余时间
    const clipEndTime = currentVideoClip.start + currentVideoClip.duration;
    const remainingTime = clipEndTime - currentTime;
    
    // 当剩余时间 < 5 秒时，检查下一个 clip 是否已预热
    if (remainingTime > 5000) return;
    
    const nextClip = videoClips[currentIndex + 1];
    if (!nextClip || !nextClip.assetId) return;
    
    // ★★★ 治本：只检查 mountedVideosRef ★★★
    // 全局 videoPreloadPool 是按 assetId 存的，但播放用的是 clip.id 的 mountedVideosRef
    if (mountedVideosRef.current.has(nextClip.id)) return;
    if (preheatInProgressRef.current.has(nextClip.id)) return;
    
    // 下一个 clip 未准备好，紧急预热
    bufferLog('⚡ 紧急预热下一个 clip:', nextClip.id.slice(-8), 
      '| 剩余时间:', (remainingTime / 1000).toFixed(1) + 's');
    
    // ★ 标记为正在预热
    preheatInProgressRef.current.add(nextClip.id);
    preloadingAssets.add(nextClip.assetId);
    
    getHlsSource(nextClip.assetId).then(async (sourceInfo) => {
      if (sourceInfo.type === 'transcoding') {
        preheatInProgressRef.current.delete(nextClip.id);
        preloadingAssets.delete(nextClip.assetId!);
        return;
      }
      
      const video = document.createElement('video');
      video.preload = 'auto';
      video.playsInline = true;
      video.muted = true;
      video.crossOrigin = 'anonymous';
      video.style.cssText = 'position:absolute;visibility:hidden;width:1px;height:1px';
      document.body.appendChild(video);
      
      let hlsInst: Hls | null = null;
      
      if (sourceInfo.type === 'hls' && Hls.isSupported()) {
        // ★★★ 动态预热：缓冲 30s 确保流畅切换 ★★★
        hlsInst = new Hls({
          ...HLS_CONFIG,
          maxBufferLength: 30,
          maxMaxBufferLength: 45,
          startFragPrefetch: true,
        });
        hlsInst.loadSource(sourceInfo.url);
        hlsInst.attachMedia(video);
      } else {
        video.src = sourceInfo.url || getAssetProxyUrl(nextClip.assetId!);
      }
      
      mountedVideosRef.current.set(nextClip.id, {
        element: video,
        hlsInstance: hlsInst,
        isReady: false,
      });
      
      // ★ 从"正在预热"状态移除
      preheatInProgressRef.current.delete(nextClip.id);
      
      video.addEventListener('canplay', () => {
        preloadingAssets.delete(nextClip.assetId!);
      }, { once: true });
      
      video.addEventListener('error', () => {
        preheatInProgressRef.current.delete(nextClip.id);
        preloadingAssets.delete(nextClip.assetId!);
      }, { once: true });
    }).catch(() => {
      preheatInProgressRef.current.delete(nextClip.id);
      preloadingAssets.delete(nextClip.assetId!);
    });
  }, [currentTime, isPlaying, currentVideoClip?.id, videoClips]);
  
  // ★★★ HLS 状态管理 ★★★
  const [hlsSource, setHlsSource] = useState<HlsSourceInfo | null>(null);
  const [isHlsLoading, setIsHlsLoading] = useState(false);
  // ★★★ 【已删除】hlsRef - 死代码，HLS 实例由 mountedVideosRef 管理 ★★★
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
  
  // ★★★ 【已删除】videoSourceType - 死代码 ★★★
  
  // 计算画布尺寸
  const canvasSize = useMemo(() => {
    if (containerSize.width < 100 || containerSize.height < 100) {
      return { width: 0, height: 0 };
    }
    
    const ratio = ASPECT_RATIOS[canvasAspectRatio] || 9 / 16;
    const padding = 12; // 减小 padding 让画布更大
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

    // ★★★ 应用图片/视频调节参数 (imageAdjustments) ★★★
    const adjustments = currentVideoClip.metadata?.imageAdjustments;
    let filterString = '';
    if (adjustments) {
      const filters: string[] = [];
      
      // 色彩
      if (adjustments.temperature !== undefined && adjustments.temperature !== 0) {
        // 色温：负值偏冷(蓝)，正值偏暖(黄/橙)
        const tempHue = adjustments.temperature > 0 ? 30 : 200; // 黄色 vs 蓝色
        const tempSat = Math.abs(adjustments.temperature) / 100;
        filters.push(`hue-rotate(${adjustments.temperature * 0.5}deg)`);
      }
      if (adjustments.tint !== undefined && adjustments.tint !== 0) {
        // 色调：负值偏绿，正值偏品红
        filters.push(`hue-rotate(${adjustments.tint * 1.8}deg)`);
      }
      if (adjustments.saturation !== undefined && adjustments.saturation !== 0) {
        filters.push(`saturate(${1 + adjustments.saturation / 100})`);
      }
      
      // 明度
      if (adjustments.brightness !== undefined && adjustments.brightness !== 0) {
        filters.push(`brightness(${1 + adjustments.brightness / 100})`);
      }
      if (adjustments.contrast !== undefined && adjustments.contrast !== 0) {
        filters.push(`contrast(${1 + adjustments.contrast / 100})`);
      }
      
      // 效果
      if (adjustments.sharpness !== undefined && adjustments.sharpness > 0) {
        // 锐化使用 contrast 近似
        filters.push(`contrast(${1 + adjustments.sharpness / 200})`);
      }
      
      filterString = filters.join(' ');
    }

    return {
      ...baseStyle,
      // 始终设置 transform，即使是空字符串也要显式设置以覆盖 RAF 残留的值
      transform: transform || 'none',
      opacity,
      filter: filterString || 'none',
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
  // ★★★ 关键修复：拖动播放头时必须暂停播放 ★★★
  const seekToTime = useCallback((timelineTimeMs: number, options?: { showIndicator?: boolean }) => {
    // ★★★ 治本：拖动播放头时暂停播放 ★★★
    const wasPlaying = useEditorStore.getState().isPlaying;
    if (wasPlaying) {
      bufferLog('⏸️ Seek 时暂停播放');
      setIsPlaying(false);
      
      // 暂停所有已挂载的视频
      mountedVideosRef.current.forEach((info) => {
        if (!info.element.paused) {
          info.element.pause();
        }
      });
    }
    
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
    
    // ★★★ 多视频模式：同步所有可见视频的位置（以 clip.id 为 key）★★★
    const visibleClips = videoClips.filter(clip => {
      const inTimeRange = timelineTimeMs >= clip.start && timelineTimeMs < clip.start + clip.duration;
      return inTimeRange && (clip.mediaUrl || clip.assetId);
    });
    
    let needsAnySeek = false;
    let hasUnmountedClip = false;
    
    visibleClips.forEach(clip => {
      const videoInfo = mountedVideosRef.current.get(clip.id); // ★★★ 治本：用 clip.id ★★★
      
      // ★★★ 关键：如果目标 clip 未挂载，触发紧急预热 ★★★
      if (!videoInfo) {
        hasUnmountedClip = true;
        bufferLog('⚡ Seek 到未挂载的 clip，紧急预热:', clip.id.slice(-8));
        
        if (clip.assetId) {
          getHlsSource(clip.assetId).then(async (sourceInfo) => {
            if (sourceInfo.type === 'transcoding') return;
            
            const video = document.createElement('video');
            video.preload = 'auto';
            video.playsInline = true;
            video.muted = true;
            video.crossOrigin = 'anonymous';
            video.style.cssText = 'position:absolute;visibility:hidden;width:1px;height:1px';
            document.body.appendChild(video);
            
            let hlsInst: Hls | null = null;
            
            if (sourceInfo.type === 'hls' && Hls.isSupported()) {
              // ★★★ 紧急预热：缓冲 30s ★★★
              hlsInst = new Hls({
                ...HLS_CONFIG,
                maxBufferLength: 30,
                maxMaxBufferLength: 45,
                startFragPrefetch: true,
              });
              hlsInst.loadSource(sourceInfo.url);
              hlsInst.attachMedia(video);
            } else {
              video.src = sourceInfo.url || getAssetProxyUrl(clip.assetId!);
            }
            
            mountedVideosRef.current.set(clip.id, {
              element: video,
              hlsInstance: hlsInst,
              isReady: false,
            });
            
            // 设置正确的时间点
            const mediaTimeSec = calcMediaTime(timelineTimeMs, clip);
            video.addEventListener('loadedmetadata', () => {
              video.currentTime = Math.max(0, mediaTimeSec);
            }, { once: true });
          });
        }
        return;
      }
      
      if (videoInfo.element.readyState < 1) return;
      
      const mediaTimeSec = calcMediaTime(timelineTimeMs, clip);
      const needsSeek = Math.abs(videoInfo.element.currentTime - mediaTimeSec) > SEEK_THRESHOLD;
      
      if (needsSeek) {
        needsAnySeek = true;
        videoInfo.element.currentTime = Math.max(0, mediaTimeSec);
      }
    });
    
    // 显示 seek 指示器
    if (needsAnySeek || hasUnmountedClip) {
      if (options?.showIndicator !== false) {
        setSeekingLabel(hasUnmountedClip ? 'loading' : 'seeking');
        setIsSeeking(true);
      }
      
      // 超时保护：未挂载 clip 需要更长时间
      const timeout = hasUnmountedClip ? 3000 : 1000;
      setTimeout(() => {
        setSeekingLabel(null);
        setIsSeeking(false);
      }, timeout);
    } else {
      // 不需要 seek，清除状态
      setSeekingLabel(null);
      setIsSeeking(false);
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
        // ★ seek 时也暂停音频
        if (!el.paused) {
          el.pause();
        }
      }
    });
  }, [currentVideoClip, videoClips, audioClips, setIsPlaying]);

  // 音频同步
  const syncAudioClips = useCallback((timelineTimeMs: number, shouldPlay: boolean) => {
    // ★★★ 重点排查：记录主视频时间用于对比 ★★★
    const mainVideoTime = (window as unknown as { __mainVideoCurrentTime?: number }).__mainVideoCurrentTime;
    
    audioClips.forEach(clip => {
      if (!clip.mediaUrl) return;
      
      const audioElement = cachedMediaRef.current.get(clip.mediaUrl) as HTMLAudioElement;
      if (!audioElement) return;
      
      const clipEnd = clip.start + clip.duration;
      const isInRange = timelineTimeMs >= clip.start && timelineTimeMs < clipEnd;
      
      if (shouldPlay && isInRange) {
        const expectedTime = calcMediaTime(timelineTimeMs, clip);
        
        if (audioElement.readyState < 3) {
          // 音频未就绪时只打印一次
          console.log('[AUDIO] ⏳ 未就绪:', clip.id.slice(-8), 'rs:', audioElement.readyState);
          
          audioElement.currentTime = Math.max(0, expectedTime);
          audioElement.volume = clampVolume(clip.volume);
          audioElement.muted = clip.isMuted || false;
          
          const clipId = clip.id;
          const playWhenReady = () => {
            audioElement.removeEventListener('canplaythrough', playWhenReady);
            const state = useEditorStore.getState();
            
            if (state.isPlaying) {
              const latestClip = state.clips.find(c => c.id === clipId);
              if (!latestClip) return;
              
              const currentMs = state.currentTime;
              const newExpectedTime = calcMediaTime(currentMs, latestClip);
              const drift = Math.abs(audioElement.currentTime - newExpectedTime);
              if (drift > SEEK_THRESHOLD) {
                console.log('[AUDIO] 🔄 就绪后sync:', clipId.slice(-8), 'drift:', drift.toFixed(3) + 's');
                audioElement.currentTime = Math.max(0, newExpectedTime);
              }
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
        const actualAudioTime = audioElement.currentTime;
        
        // ★★★ 重点排查：音频与视频的时间差（用于排查不同步）★★★
        // 计算音频相对于时间轴的实际位置
        const audioTimelinePos = (actualAudioTime - (clip.sourceStart || 0) / 1000) * 1000 + clip.start;
        const audioVideoGap = mainVideoTime !== undefined ? (audioTimelinePos - mainVideoTime) : null;
        
        // 检测音频不同步：与视频差距超过 100ms
        if (audioVideoGap !== null && mainVideoTime !== undefined && Math.abs(audioVideoGap) > 100) {
          console.warn('[AUDIO] ⚠️ 音视频不同步:', {
            clipId: clip.id.slice(-8),
            audioPos: (audioTimelinePos / 1000).toFixed(3) + 's',
            videoPos: (mainVideoTime / 1000).toFixed(3) + 's',
            gap: audioVideoGap.toFixed(0) + 'ms',
            audioDrift: drift.toFixed(3) + 's',
          });
        }
        
        // 音频需要 seek
        if (drift > AUDIO_DRIFT_THRESHOLD) {
          console.log('[AUDIO] 🔄 sync:', clip.id.slice(-8), 
            'drift:', drift.toFixed(3) + 's',
            'from:', actualAudioTime.toFixed(3),
            'to:', expectedTime.toFixed(3));
          audioElement.currentTime = Math.max(0, expectedTime);
        }
        
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

  // ★★★ 【已删除】视频 URL 缓存和 HLS 初始化 ★★★
  // 旧架构使用 videoRefInternal 初始化 HLS，新架构由 mountedVideosRef 和预热系统管理

  // ★★★ 【已删除】缓冲进度订阅 - 死代码（videoRefInternal.current 永远是 null）★★★
  // ★★★ 【已删除】暂停时同步位置 - 死代码（被多视频播放控制取代）★★★

  // ★★★ 【已删除】旧播放/暂停控制代码 - 被新架构的多视频播放控制取代 ★★★
  // 新架构通过 mountedVideosRef 管理所有视频元素，见下方 "多视频播放控制" useEffect

  // ★★★ 【已删除】旧 RAF 循环 - 被新架构的 RAF 播放循环取代 ★★★
  // 旧架构使用单个 videoRefInternal，新架构使用 mountedVideosRef 管理多视频

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

  // ★★★ 【已删除】旧视频生命周期事件 - 死代码 ★★★
  // 旧架构使用 videoRefInternal 监听事件，但 videoRefInternal.current 永远是 null
  // 新架构在 mountedVideosRef 的视频元素上处理事件

  // 全屏监听
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handlePlayPause = useCallback(async () => {
    // ★★★ 简化逻辑：直接切换播放状态，不等待视频就绪 ★★★
    // 新架构下，每个 clip 有独立的视频元素，RAF 循环会处理同步
    // 用户点击播放后不应看到任何加载提示
    
    // 如果要播放，检查当前时间是否有效
    if (!isPlaying) {
      const state = useEditorStore.getState();
      const totalDuration = state.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
      
      // ★★★ 修复：只有播放到末尾时才回到开头 ★★★
      // 不要因为某个 clip 加载失败就重置播放位置
      if (totalDuration > 0 && state.currentTime >= totalDuration - 100) {
        // 只有真的到末尾（100ms 容差）才重置
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
  }, [isPlaying, setIsPlaying, setCurrentTime, seekToTime]);

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

  // ★★★ 注意：isInitialLoading 只在预热阶段统一管理 ★★★
  // 预热开始时设为 true，预热完成后设为 false
  // 不再有分散的 setIsInitialLoading 调用

  // ★★★ 关键：videoClips 变化时清理不再需要的视频元素 ★★★
  // 场景：删除视频 clip、切换项目、替换素材等
  useEffect(() => {
    // ★★★ 治本：以 clip.id 为 key 管理视频元素 ★★★
    const currentClipIds = new Set(videoClips.map(c => c.id));
    
    // 找出 mountedVideosRef 中不再需要的视频（key 是 clip.id）
    const toRemove: string[] = [];
    mountedVideosRef.current.forEach((info, clipId) => {
      if (!currentClipIds.has(clipId)) {
        toRemove.push(clipId);
      }
    });
    
    // 清理不再需要的视频元素
    if (toRemove.length > 0) {
      toRemove.forEach(clipId => {
        const info = mountedVideosRef.current.get(clipId);
        if (info) {
          // ★★★ 关键：检查是否来自预热池，如果是则不销毁，只从 mountedVideosRef 移除 ★★★
          const clip = videoClips.find(c => c.id === clipId);
          const isFromPreheatedPool = clip?.assetId && videoPreloadPool.has(clip.assetId);
          
          if (!isFromPreheatedPool) {
            // 不是预热池的视频，可以销毁
            if (info.hlsInstance) {
              info.hlsInstance.destroy();
            }
            info.element.pause();
            info.element.src = '';
          } else {
            // 来自预热池，只暂停，不销毁（可能被其他 clip 复用）
            info.element.pause();
          }
          
          // 从 mountedVideosRef 中删除
          mountedVideosRef.current.delete(clipId);
        }
      });
    }
  }, [videoClips]);

  // ★★★ 多视频播放控制：同步所有可见视频的播放状态和时间 ★★★
  // ★ 注意：此 effect 主要处理暂停时的视频同步，播放由 RAF 控制
  useEffect(() => {
    if (!mountedVideosRef.current.size) return;
    
    // ★★★ 治本：isSeeking 时不处理播放，避免竞争 ★★★
    if (isSeeking) return;
    
    // ★★★ 治本修复：播放中不在此处同步，完全交给RAF处理 ★★★
    // 此effect只处理暂停时的精确定位
    if (isPlaying) return;
    
    // 获取当前可见的视频 clips（所有 clip 一视同仁）
    const visibleVideoClips = videoClips.filter(clip => {
      const inTimeRange = currentTime >= clip.start && currentTime < clip.start + clip.duration;
      return inTimeRange && (clip.mediaUrl || clip.assetId);
    });
    
    const visibleClipIds = new Set(visibleVideoClips.map(c => c.id));
    
    // 同步所有视频的播放状态和时间（以 clip.id 为 key）
    mountedVideosRef.current.forEach((info, clipId) => {
      const isVisible = visibleClipIds.has(clipId);
      const clip = visibleVideoClips.find(c => c.id === clipId);
      
      if (!isVisible || !clip) {
        // 不可见的视频暂停
        if (!info.element.paused) {
          info.element.pause();
        }
        return;
      }
      
      // ★★★ 暂停状态：精确同步时间 ★★★
      const clipMediaTime = calcMediaTime(currentTime, clip);
      const drift = Math.abs(info.element.currentTime - clipMediaTime);
      const isBroll = clip.metadata?.is_broll;
      const seekThreshold = isBroll ? BROLL_SEEK_THRESHOLD : 0.15; // 暂停时使用更精确的阈值
      
      if (drift > seekThreshold && info.element.readyState >= 2) {
        info.element.currentTime = clipMediaTime;
      }
      if (!info.element.paused) {
        info.element.pause();
      }
    });
  }, [currentTime, isPlaying, isSeeking, videoClips]);

  // ★★★ RAF 播放循环：实时更新播放头位置 + 关键帧动画 ★★★
  useEffect(() => {
    if (!isPlaying) return;

    let rafId: number;
    let lastUpdateTime = performance.now();
    
    const updatePlayhead = () => {
      const now = performance.now();
      const delta = now - lastUpdateTime;
      lastUpdateTime = now;
      
      // ★★★ 关键修复：使用 store 最新状态，避免闭包陈旧 ★★★
      const storeState = useEditorStore.getState();
      const storeTime = storeState.currentTime;
      const allClips = storeState.clips;
      const storeVideoClips = allClips.filter(c => c.clipType === 'video' && (c.mediaUrl || c.assetId));
      const storeAudioClips = allClips.filter(c => c.clipType === 'audio');
      
      // 获取当前可见的视频 clips（所有 clip 一视同仁，包括 B-Roll）
      const visibleClips = storeVideoClips.filter(clip => {
        const inTimeRange = storeTime >= clip.start && storeTime < clip.start + clip.duration;
        return inTimeRange && (clip.mediaUrl || clip.assetId);
      });
      
      if (visibleClips.length === 0) {
        // 纯音频模式或没有可见 clip：使用时间增量
        const newTime = storeTime + delta; // delta 已经是毫秒
        const maxTime = Math.max(...storeVideoClips.concat(storeAudioClips).map(c => c.start + c.duration), 0);
        
        if (newTime >= maxTime && maxTime > 0) {
          storeState.setIsPlaying(false);
          storeState.setCurrentTime(maxTime);
          return;
        }
        storeState.setCurrentTime(newTime);
        rafId = requestAnimationFrame(updatePlayhead);
        return;
      }
      
      // ★★★ 治本：主视频（非 B-Roll）驱动时间轴，B-Roll 跟随同步 ★★★
      // 从可见 clips 中找主视频（非 B-Roll），只有没有主视频时才用 B-Roll
      const mainVideoClips = visibleClips.filter(c => !c.metadata?.is_broll);
      const brollClips = visibleClips.filter(c => c.metadata?.is_broll);
      
      // 主视频优先，按 start 排序（deterministic）
      const candidateClips = mainVideoClips.length > 0 ? mainVideoClips : brollClips;
      const sortedCandidates = [...candidateClips].sort((a, b) => {
        const startDiff = a.start - b.start;
        if (startDiff !== 0) return startDiff;
        return a.id.localeCompare(b.id);
      });
      
      const mainClip = sortedCandidates[0];
      
      // ★★★ 重点排查：时间跳变检测（用于排查重复播放）★★★
      const prevStoreTime = (window as unknown as { __prevStoreTime?: number }).__prevStoreTime || 0;
      const prevMainClipId = (window as unknown as { __prevMainClipId?: string }).__prevMainClipId;
      const isClipSwitch = prevMainClipId && prevMainClipId !== mainClip.id;
      const timeJump = storeTime - prevStoreTime;
      
      // 检测时间回跳（重复播放的根源）
      if (timeJump < -50 && timeJump > -500) { // 回跳 50ms~500ms 是可疑的重复播放
        console.warn('[TIME] ⚠️ 时间回跳检测（可能导致重复播放）:', {
          from: (prevStoreTime / 1000).toFixed(3) + 's',
          to: (storeTime / 1000).toFixed(3) + 's',
          jump: timeJump.toFixed(0) + 'ms',
          clipId: mainClip.id.slice(-8),
          isClipSwitch,
          delta: delta.toFixed(1) + 'ms',
        });
      }
      
      (window as unknown as { __prevStoreTime?: number }).__prevStoreTime = storeTime;
      (window as unknown as { __prevMainClipId?: string }).__prevMainClipId = mainClip.id;
      
      if (isClipSwitch) {
        console.log('[RAF] 🔄 CLIP切换:', mainClip.id.slice(-8), '@', (storeTime / 1000).toFixed(2) + 's');
      }
      
      const videoInfo = mountedVideosRef.current.get(mainClip.id);
      
      // ★★★ 治本修复：readyState 判断使用更精确的阈值 ★★★
      // readyState:
      // 0 = HAVE_NOTHING, 1 = HAVE_METADATA, 2 = HAVE_CURRENT_DATA, 
      // 3 = HAVE_FUTURE_DATA, 4 = HAVE_ENOUGH_DATA
      // 只要有当前帧数据(>=2)就可以尝试播放，不必等到HAVE_ENOUGH_DATA(4)
      const videoReady = videoInfo && videoInfo.element.readyState >= 2;
      const videoPlaying = videoReady && !videoInfo.element.paused;
      
      if (!videoReady) {
        // ★★★ 治本：视频未就绪时不要频繁seek，只在必要时触发加载 ★★★
        const newTime = storeTime + delta;
        const clipEnd = mainClip.start + mainClip.duration;
        
        // 只在 clip 切换时打印（减少日志噪音）
        if (isClipSwitch) {
          console.log('[RAF] ⚠️ 视频未就绪:', mainClip.id.slice(-8), 'rs:', videoInfo?.element.readyState ?? -1);
        }
        
        if (newTime >= clipEnd) {
          // 到达边界，设置到边界位置（不立即切换，等RAF下一帧处理）
          storeState.setCurrentTime(clipEnd);
        } else {
          storeState.setCurrentTime(newTime);
        }
        
        // ★★★ 关键优化：只在首次或大偏差时触发加载，避免频繁seek导致readyState降级 ★★★
        if (videoInfo) {
          const clipMediaTime = calcMediaTime(newTime, mainClip);
          const currentTime = videoInfo.element.currentTime;
          const drift = Math.abs(currentTime - clipMediaTime);
          const lastSeekTime = lastSeekTimestamps.get(mainClip.id) || 0;
          const now = performance.now();
          const cooldownPassed = now - lastSeekTime > SEEK_COOLDOWN_MS * 3; // 未就绪时使用更长冷却
          
          // 只在以下情况seek：
          // 1. 从未设置过时间（currentTime接近0）
          // 2. 大偏差（>2秒）且冷却已过
          if (currentTime < 0.5 || (drift > 2 && cooldownPassed)) {
            videoInfo.element.currentTime = clipMediaTime;
            lastSeekTimestamps.set(mainClip.id, now);
          }
        }
        
        rafId = requestAnimationFrame(updatePlayhead);
        return;
      }
      
      // ★★★ 视频已就绪但暂停中：启动播放 ★★★
      if (!videoPlaying) {
        const clipMediaTime = calcMediaTime(storeTime, mainClip);
        const drift = Math.abs(videoInfo.element.currentTime - clipMediaTime);
        const lastSeekTime = lastSeekTimestamps.get(mainClip.id) || 0;
        const now = performance.now();
        const cooldownPassed = now - lastSeekTime > SEEK_COOLDOWN_MS;
        
        // 只在需要 seek 且冷却已过时 seek
        if (drift > RAF_SEEK_THRESHOLD && cooldownPassed) {
          console.log('[RAF] ▶️ 启动播放+seek:', mainClip.id.slice(-8), 'drift:', drift.toFixed(3) + 's');
          videoInfo.element.currentTime = clipMediaTime;
          lastSeekTimestamps.set(mainClip.id, now);
        }
        videoInfo.element.play().catch((err) => {
          console.error('[RAF] ❌ play() 失败:', err.name, err.message);
        });
        
        // 用 delta 推进，不等待播放启动
        const newTime = storeTime + delta;
        storeState.setCurrentTime(Math.min(newTime, mainClip.start + mainClip.duration));
        
        rafId = requestAnimationFrame(updatePlayhead);
        return;
      }
      
      // ★★★ 视频正常播放：从视频 currentTime 同步时间 ★★★
      const mediaTime = videoInfo.element.currentTime; // 秒
      const sourceStart = (mainClip.sourceStart || 0) / 1000; // 毫秒转秒
      const timelineTime = (mediaTime - sourceStart) * 1000 + mainClip.start; // 转回毫秒
      
      // ★★★ 重点排查：记录主视频的时间轴位置（供音频同步对比）★★★
      (window as unknown as { __mainVideoCurrentTime?: number }).__mainVideoCurrentTime = timelineTime;
      
      // 检查是否到达 clip 边界
      const clipEnd = mainClip.start + mainClip.duration;
      if (timelineTime >= clipEnd) {
        // ★★★ 检查是否有下一个主视频 clip（优先主视频，没有才用 B-Roll）★★★
        const upcomingClips = storeVideoClips.filter(c => c.start >= clipEnd && (c.mediaUrl || c.assetId));
        const upcomingMainClips = upcomingClips.filter(c => !c.metadata?.is_broll);
        const upcomingBrollClips = upcomingClips.filter(c => c.metadata?.is_broll);
        
        // 主视频优先
        const candidateNextClips = upcomingMainClips.length > 0 ? upcomingMainClips : upcomingBrollClips;
        const nextClip = [...candidateNextClips].sort((a, b) => {
          const startDiff = a.start - b.start;
          if (startDiff !== 0) return startDiff;
          return a.id.localeCompare(b.id);
        })[0];
        
        if (nextClip) {
          // ★★★ 治本修复：边界切换时等待下一个视频就绪 ★★★
          const nextVideoInfo = mountedVideosRef.current.get(nextClip.id);
          const nextReady = nextVideoInfo && nextVideoInfo.element.readyState >= 3;
          
          console.log('[RAF] 🔄 边界切换:', mainClip.id.slice(-8), '->', nextClip.id.slice(-8),
            '| next_rs:', nextVideoInfo?.element.readyState ?? -1, '| ready:', nextReady);
          
          // 暂停当前视频
          videoInfo.element.pause();
          
          if (nextReady) {
            // ★★★ 下一个视频已就绪：立即切换 ★★★
            const nextMediaTime = calcMediaTime(nextClip.start, nextClip);
            const currentVideoTime = nextVideoInfo.element.currentTime;
            const drift = Math.abs(currentVideoTime - nextMediaTime);
            
            // 只在需要 seek 时 seek
            if (drift > RAF_SEEK_THRESHOLD) {
              console.log('[RAF] ⏩ 边界seek:', nextClip.id.slice(-8), 'drift:', drift.toFixed(3) + 's');
              nextVideoInfo.element.currentTime = nextMediaTime;
            }
            
            // 设置时间到下一个 clip 的开始位置
            storeState.setCurrentTime(nextClip.start);
            
            // 启动播放
            nextVideoInfo.element.play().catch((err) => {
              console.error('[RAF] ❌ 下一个视频 play() 失败:', err.name, err.message);
            });
            
            // 清除当前视频的seek时间戳
            lastSeekTimestamps.delete(mainClip.id);
          } else {
            // ★★★ 下一个视频未就绪：短暂等待，避免卡帧 ★★★
            // 设置时间到边界位置（当前clip结束），但保持当前帧
            storeState.setCurrentTime(clipEnd);
            
            // 尝试预加载下一个视频
            if (nextVideoInfo && nextVideoInfo.element.readyState < 2) {
              const nextMediaTime = calcMediaTime(nextClip.start, nextClip);
              nextVideoInfo.element.currentTime = nextMediaTime;
              // 触发加载
              nextVideoInfo.element.load();
            }
            
            // 继续 RAF，等待下一个视频就绪
            console.log('[RAF] ⏳ 等待下一视频就绪:', nextClip.id.slice(-8));
          }
          
          rafId = requestAnimationFrame(updatePlayhead);
          return;
        } else {
          // 没有更多 clip，停止播放
          storeState.setIsPlaying(false);
          storeState.setCurrentTime(clipEnd);
          return;
        }
      } else {
        // ★★★ 重点排查：时间同步中的回跳检测（重复播放根源）★★★
        const proposedTime = Math.max(mainClip.start, timelineTime);
        const timeDelta = proposedTime - storeTime;
        
        // 检测各种异常情况
        if (timeDelta < -50) {
          // 时间回跳 - 可能导致重复播放
          console.warn('[TIME] ⚠️ 视频时间回跳:', {
            jump: timeDelta.toFixed(0) + 'ms',
            storeTime: (storeTime / 1000).toFixed(3) + 's',
            proposedTime: (proposedTime / 1000).toFixed(3) + 's',
            videoCurrentTime: mediaTime.toFixed(3) + 's',
            clipId: mainClip.id.slice(-8),
            sourceStart: ((mainClip.sourceStart || 0) / 1000).toFixed(3) + 's',
          });
          
          if (timeDelta < -500) {
            // 超过 500ms 的大回跳，跳过同步
            console.warn('[TIME] 🚫 跳过大回跳同步');
          } else {
            // 小回跳（50-500ms）仍然同步，但记录下来
            storeState.setCurrentTime(proposedTime);
          }
        } else if (timeDelta > 500) {
          // 时间前跳过多 - 可能丢帧
          console.warn('[TIME] ⏩ 时间前跳:', timeDelta.toFixed(0) + 'ms');
          storeState.setCurrentTime(proposedTime);
        } else {
          storeState.setCurrentTime(proposedTime);
        }
      }
      
      // ★★★ 治本修复：B-Roll 同步使用更宽容的阈值和节流 ★★★
      visibleClips.forEach((clip, index) => {
        if (index === 0) return; // 主视频已处理
        
        const overlayVideoInfo = mountedVideosRef.current.get(clip.id);
        if (!overlayVideoInfo) return;
        
        const expectedMediaTime = calcMediaTime(storeTime, clip);
        const actualMediaTime = overlayVideoInfo.element.currentTime;
        const drift = Math.abs(actualMediaTime - expectedMediaTime);
        
        // ★★★ B-Roll 使用更宽容的阈值，避免频繁 seek ★★★
        // B-Roll 通常是叠加层，小偏差不明显，可以容忍更大的漂移
        const lastSeekTime = lastSeekTimestamps.get(clip.id) || 0;
        const now = performance.now();
        const cooldownPassed = now - lastSeekTime > SEEK_COOLDOWN_MS * 2; // B-Roll 冷却时间加倍
        
        // 只有在大偏差且冷却已过时才 seek
        if (drift > BROLL_SEEK_THRESHOLD && overlayVideoInfo.element.readyState >= 2 && cooldownPassed) {
          console.log('[SYNC] B-Roll sync:', clip.id.slice(-8), 'drift:', drift.toFixed(3) + 's');
          overlayVideoInfo.element.currentTime = expectedMediaTime;
          lastSeekTimestamps.set(clip.id, now);
        }
        
        // 确保正在播放
        if (overlayVideoInfo.element.paused && overlayVideoInfo.element.readyState >= 2) {
          overlayVideoInfo.element.play().catch(() => {});
        }
      });
      
      // ★★★ 新增：同步音频 clips ★★★
      syncAudioClips(storeTime, true);
      
      rafId = requestAnimationFrame(updatePlayhead);
    };
    
    rafId = requestAnimationFrame(updatePlayhead);
    
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isPlaying]); // ★★★ 只依赖 isPlaying，避免闭包陈旧 ★★★

  // ★★★ 滑动窗口预热：根据当前位置动态管理预热池 ★★★
  useEffect(() => {
    if (videoClips.length === 0) return;
    
    // 按时间排序
    const sortedClips = [...videoClips].sort((a, b) => a.start - b.start);
    
    // 找到当前 clip 的索引
    const currentIndex = sortedClips.findIndex(c => 
      currentTime >= c.start && currentTime < c.start + c.duration
    );
    
    // 如果找不到当前 clip，使用最近的一个
    const effectiveIndex = currentIndex === -1 
      ? sortedClips.findIndex(c => c.start > currentTime) - 1
      : currentIndex;
    
    if (effectiveIndex >= 0) {
      // 使用滑动窗口更新预热池
      updatePreloadWindow(sortedClips, effectiveIndex);
    }
  }, [currentTime, videoClips]);

  // ★★★ 预热进度文案 ★★★
  const preheatProgressText = preheatProgress.total > 0 
    ? `正在加载视频 (${preheatProgress.done}/${preheatProgress.total})` 
    : '正在准备视频...';

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

      {/* ★★★ 视频预热加载提示 - 预热完成前阻塞用户操作 ★★★ */}
      {!isTranscoding && isInitialLoading && videoClips.length > 0 && (
        <BlockingLoader
          isLoading={true}
          type="video"
          title="视频准备中..."
          subtitle={preheatProgressText}
          stage={preheatProgress.done > 0 ? `已完成 ${preheatProgress.done} 个` : '开始加载...'}
        />
      )}

      {/* 视频画布区域 - 裁剪超出画布边界的内容（只显示绿框内） */}
      <div ref={videoAreaRef} className="flex-1 flex items-center justify-center min-h-0 p-4" onClick={handleCanvasBackgroundClick}>
        {hasVisualContent ? (
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
              
              {/* ★★★ 多轨道视频渲染：支持多素材同时显示 ★★★ */}
              {(() => {
                // 找出当前时间点所有可见的视频 clips（按轨道顺序层叠）
                const visibleVideoClips = videoClips
                  .filter(clip => {
                    const clipEnd = clip.start + clip.duration;
                    const hasMedia = clip.mediaUrl || clip.assetId;
                    return currentTime >= clip.start && currentTime < clipEnd && hasMedia;
                  })
                  .sort((a, b) => {
                    // 按轨道顺序排序（order_index 小的在下层）
                    const trackA = tracks.find(t => t.id === a.trackId);
                    const trackB = tracks.find(t => t.id === b.trackId);
                    const orderA = trackA?.orderIndex ?? 999;
                    const orderB = trackB?.orderIndex ?? 999;
                    return orderA - orderB;
                  });
                
                return visibleVideoClips.map((clip, index) => {
                  // 判断是否是主视频
                  const isMainVideo = clip.assetId && clip.assetId === currentVideoClip?.assetId;
                  
                  // ✅ 统一 URL 处理：优先级 clip.mediaUrl > asset.url(如果是HTTP) > 生成代理URL
                  let mediaUrl = clip.mediaUrl;
                  if (!mediaUrl && clip.assetId) {
                    const asset = assets.find(a => a.id === clip.assetId);
                    if (asset) {
                      // 检查 asset.url 是否是有效的 HTTP URL
                      if (asset.url && (asset.url.startsWith('http://') || asset.url.startsWith('https://'))) {
                        mediaUrl = asset.url;
                      } else {
                        // 不是 HTTP URL（如 storage_path），动态生成代理 URL
                        mediaUrl = getAssetProxyUrl(clip.assetId);
                      }
                    } else {
                      // 找不到 asset，使用代理 URL（兜底）
                      mediaUrl = getAssetProxyUrl(clip.assetId);
                    }
                  }
                  
                  if (!mediaUrl) {
                    bufferLog('[MultiVideo] 跳过无 URL 的 clip:', clip.id.slice(-8));
                    return null;
                  }
                  
                  // 计算当前 clip 的媒体时间（相对于视频内部）
                  const mediaTime = calcMediaTime(currentTime, clip);
                  
                  // 计算 transform 和 keyframe 效果
                  const clipKeyframes = keyframes?.get(clip.id);
                  
                  const transformStyle = calcClipTransformStyle(
                    clip,
                    currentTime,
                    clipKeyframes
                  );
                  
                  // ★★★ 构建美颜 + 滤镜 CSS filter ★★★
                  const beautyFilter = buildFilterStyle(clip);
                  
                  // ★★★ 检查预热池获取 HLS 源 URL（如果有的话）★★★
                  const preheatedVideo = clip.assetId ? getPreheatedVideo(clip.assetId) : null;
                  const effectiveUrl = preheatedVideo?.sourceInfo?.url || mediaUrl;
                  
                  return (
                    <div
                      key={`video-layer-${clip.id}`}
                      className={`absolute inset-0`}
                      style={{
                        zIndex: index,
                        willChange: 'transform, opacity',
                        backfaceVisibility: 'hidden',
                        pointerEvents: isMainVideo ? 'auto' : 'none',
                      }}
                      onClick={isMainVideo ? handleVideoClick : undefined}
                      ref={(containerEl) => {
                        if (!containerEl) return;
                        
                        const clipKey = clip.id;
                        const existingInfo = mountedVideosRef.current.get(clipKey);
                        
                        // ★★★ 调试日志：播放时查找视频 ★★★
                        const poolKeys = Array.from(mountedVideosRef.current.keys()).map(k => k.slice(-8));
                        bufferLog('🎬 渲染 clip:', clipKey.slice(-8), 
                          '| 在 mountedVideosRef:', existingInfo ? '✅' : '❌',
                          '| isReady:', existingInfo?.isReady,
                          '| 池子大小:', mountedVideosRef.current.size,
                          '| 池子keys:', poolKeys.join(','));
                        
                        // ★★★ 核心：复用预热好的视频元素 ★★★
                        if (existingInfo?.element) {
                          const videoEl = existingInfo.element;
                          
                          // 如果视频元素还没在这个容器里，移动过来
                          if (videoEl.parentElement !== containerEl) {
                            // 设置样式
                            videoEl.className = 'w-full h-full object-contain';
                            videoEl.style.position = '';
                            videoEl.style.visibility = '';
                            videoEl.style.width = '100%';
                            videoEl.style.height = '100%';
                            videoEl.style.transform = transformStyle.transform;
                            videoEl.style.opacity = String(transformStyle.opacity);
                            videoEl.style.filter = beautyFilter || 'none';
                            videoEl.muted = clip.isMuted ?? false;
                            
                            // 移动到渲染容器
                            containerEl.appendChild(videoEl);
                          } else {
                            // 已经在容器里，只更新 transform 和 filter
                            videoEl.style.transform = transformStyle.transform;
                            videoEl.style.opacity = String(transformStyle.opacity);
                            videoEl.style.filter = beautyFilter || 'none';
                          }
                          
                          // ★★★ 治本修复：渲染时的seek节流 ★★★
                          // 只在以下情况才seek：
                          // 1. 不在播放中（暂停时需要精确定位）
                          // 2. drift超过大阈值（播放中只处理大偏差）
                          // 3. 冷却时间已过（防止频繁seek导致卡顿）
                          const storeState = useEditorStore.getState();
                          const clipMediaTime = calcMediaTime(storeState.currentTime, clip);
                          if (videoEl.readyState >= 1) {
                            const drift = Math.abs(videoEl.currentTime - clipMediaTime);
                            const isBroll = clip.metadata?.is_broll;
                            const seekThreshold = isBroll ? BROLL_SEEK_THRESHOLD : RENDER_SEEK_THRESHOLD;
                            const lastSeekTime = lastSeekTimestamps.get(clipKey) || 0;
                            const now = performance.now();
                            const cooldownPassed = now - lastSeekTime > SEEK_COOLDOWN_MS;
                            
                            // 只有在不播放、或大偏差且冷却已过时才seek
                            if (!storeState.isPlaying && drift > 0.1) {
                              // 暂停时精确同步
                              videoEl.currentTime = clipMediaTime;
                              lastSeekTimestamps.set(clipKey, now);
                            } else if (drift > seekThreshold && cooldownPassed) {
                              // 播放时只处理大偏差
                              console.log('[Render] seek:', clipKey.slice(-8), 'drift:', drift.toFixed(3) + 's');
                              videoEl.currentTime = clipMediaTime;
                              lastSeekTimestamps.set(clipKey, now);
                            }
                            // 小偏差忽略，靠视频自然播放追赶
                          }
                          
                          // 同步播放状态
                          if (storeState.isPlaying && videoEl.paused && existingInfo.isReady) {
                            videoEl.play().catch((err) => {
                              if (err.name === 'NotAllowedError') {
                                videoEl.muted = true;
                                videoEl.play().catch(() => {});
                              }
                            });
                          }
                          
                          return;
                        }
                        
                        // ★★★ 治本：如果预热完成但没有可用的视频元素，显示加载提示 ★★★
                        // 不再在此处创建新视频，避免重复请求和状态混乱
                        if (isPreheatComplete) {
                          // 预热已完成但没有这个 clip 的视频，说明预热失败
                          const allKeys = Array.from(mountedVideosRef.current.keys()).map(k => k.slice(-8));
                          bufferLog('❌ 预热完成但无可用视频:', clipKey.slice(-8), 
                            '| 池子keys:', allKeys.join(',') || '(空)',
                            '| 全部clips:', videoClips.map(c => c.id.slice(-8)).join(','));
                          
                          // 显示一个占位提示
                          if (!containerEl.querySelector('.video-loading-placeholder')) {
                            const placeholder = document.createElement('div');
                            placeholder.className = 'video-loading-placeholder absolute inset-0 flex items-center justify-center bg-gray-100';
                            placeholder.innerHTML = '<span class="text-gray-500 text-sm">视频加载中...</span>';
                            containerEl.appendChild(placeholder);
                          }
                          return;
                        }
                        
                        // ★★★ 预热未完成，等待预热 ★★★
                        bufferLog('⏳ 等待预热完成:', clipKey.slice(-8));
                      }}
                    />
                  );
                });
              })()}

              {/* 加载/缓冲指示器：只在没有挂载任何视频时显示 */}
              {/* 注意：用户可操作后不应显示任何加载提示 */}

              {/* 定位/缓冲提示：只在播放时显示 */}
              {isPlaying && seekingLabel && (
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

              {/* 图片覆盖层 - 始终渲染可见的图片 clip */}
              <ImageOverlay
                containerWidth={canvasSize.width}
                containerHeight={canvasSize.height}
                zoom={zoom}
                showControls={!isPlaying}
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
