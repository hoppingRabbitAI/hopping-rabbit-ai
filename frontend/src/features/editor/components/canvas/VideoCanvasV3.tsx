/**
 * VideoCanvasV3 - 使用全局单例资源管理器的视频画布
 * 
 * ★★★ 核心设计原则 ★★★
 * 1. 使用全局单例 PlaybackClock 作为唯一时间源
 * 2. 使用全局单例 VideoResourceManager 管理视频资源
 * 3. 视频是从属者，根据时钟 seek 到正确位置
 * 4. 组件只是渲染层，不拥有资源
 * 
 * 架构：
 * - PlaybackClock: 独立时钟（RAF + performance.now）
 * - VideoResourceManager: 视频资源管理（创建/销毁/LRU）
 * - VideoCanvasV3: 渲染层（挂载视频元素到 DOM）
 */

'use client';

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Play } from 'lucide-react';
import { useEditorStore } from '../../store/editor-store';
import { msToSec } from '../../lib/time-utils';
import { getClipTransformAtOffset, ClipTransform } from '../../lib/keyframe-interpolation';
import { TextOverlay } from '../TextOverlay';
import { ImageOverlay } from '../ImageOverlay';
import { BlockingLoader } from '../BlockingLoader';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { videoResourceManager, ClipVideoState } from '../../services/VideoResourceManager';
import { playbackClock, type RegisteredClip } from '../../services/PlaybackClock';
import type { Clip } from '../../types/clip';
import type { Keyframe } from '../../types/keyframe';

const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEBUG) console.log('[VideoCanvasV3]', ...args); };

// ==================== 工具函数 ====================

function calcMediaTime(timelineTimeMs: number, clip: Clip): number {
  const clipStartMs = clip.start;
  const offsetInClipMs = timelineTimeMs - clipStartMs;
  const sourceStartMs = clip.sourceStart || 0;
  return msToSec(sourceStartMs + offsetInClipMs);
}

function calcClipTransformStyle(
  clip: Clip,
  currentTimeMs: number,
  clipKeyframes?: Map<string, Keyframe[]>
): { transform: string; opacity: number } {
  const staticTransform = (clip.metadata?.transformParams || {}) as Record<string, number | boolean>;
  const offsetMs = currentTimeMs - clip.start;
  const kfTransform: ClipTransform = clipKeyframes 
    ? getClipTransformAtOffset(clipKeyframes, offsetMs) 
    : {};
  
  const x = kfTransform.positionX ?? (staticTransform.x as number | undefined) ?? 0;
  const y = kfTransform.positionY ?? (staticTransform.y as number | undefined) ?? 0;
  const scale = (staticTransform.scale as number | undefined) ?? 1;
  const scaleX = kfTransform.scaleX ?? (staticTransform.scaleX as number | undefined) ?? scale;
  const scaleY = kfTransform.scaleY ?? (staticTransform.scaleY as number | undefined) ?? scale;
  const rotation = kfTransform.rotation ?? (staticTransform.rotation as number | undefined) ?? 0;
  const opacity = kfTransform.opacity ?? (staticTransform.opacity as number | undefined) ?? 1;
  const flipH = (staticTransform.flipH as boolean | undefined) ?? false;
  const flipV = (staticTransform.flipV as boolean | undefined) ?? false;
  
  const transforms: string[] = [];
  if (x !== 0 || y !== 0) transforms.push(`translate3d(${x}px, ${y}px, 0)`);
  if (scaleX !== 1 || scaleY !== 1) transforms.push(`scale3d(${scaleX}, ${scaleY}, 1)`);
  if (rotation !== 0) transforms.push(`rotate(${rotation}deg)`);
  if (flipH || flipV) transforms.push(`scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`);
  
  return {
    transform: transforms.length > 0 ? transforms.join(' ') : '',
    opacity: typeof opacity === 'number' ? opacity : 1,
  };
}

// ==================== 主组件 ====================

export function VideoCanvasV3() {
  // Store 状态
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setIsVideoReady = useEditorStore((s) => s.setIsVideoReady);
  const canvasEditMode = useEditorStore((s) => s.canvasEditMode);
  const canvasAspectRatio = useEditorStore((s) => s.canvasAspectRatio);
  const keyframes = useEditorStore((s) => s.keyframes);
  
  // Refs
  const videoAreaRef = useRef<HTMLDivElement>(null);
  const initDoneRef = useRef(false);
  const componentIdRef = useRef(`canvas-${Date.now()}`);
  const clockSyncRef = useRef(false); // 防止循环同步
  
  // Local state
  const [zoom] = useState(1);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [preheatProgress, setPreheatProgress] = useState({ done: 0, total: 0, timedOut: 0 });
  const [isWaitingBuffer, setIsWaitingBuffer] = useState(false);
  const [waitingClipInfo, setWaitingClipInfo] = useState<{ clipId: string; clipIndex: number } | null>(null);
  
  // 过滤视频 clips
  const videoClips = useMemo(() => {
    return clips.filter(c => 
      (c.clipType === 'video' || c.clipType === 'broll') && 
      (c.mediaUrl || c.assetId)
    );
  }, [clips]);
  
  // 图片 clips
  const imageClips = useMemo(() => {
    return clips.filter(c => c.clipType === 'image' && (c.mediaUrl || c.assetId));
  }, [clips]);
  
  // 是否有可视内容
  const hasVisualContent = videoClips.length > 0 || imageClips.length > 0;
  
  // 画布尺寸计算
  const ASPECT_RATIOS: Record<string, number> = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
  };
  
  const canvasSize = useMemo(() => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return { width: 0, height: 0 };
    }
    
    const ratio = ASPECT_RATIOS[canvasAspectRatio] || 16 / 9;
    const maxWidth = containerSize.width - 32;
    const maxHeight = containerSize.height - 32;
    
    let width = maxWidth;
    let height = width / ratio;
    
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    
    return { width, height };
  }, [containerSize, canvasAspectRatio]);
  
  // 监听容器尺寸
  useEffect(() => {
    if (!videoAreaRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    
    observer.observe(videoAreaRef.current);
    return () => observer.disconnect();
  }, []);
  
  // ★★★ 初始预热（只执行一次）- 治标治本版本 ★★★
  // 原则：宁可加载久一点，也要确保播放时无卡顿
  useEffect(() => {
    if (initDoneRef.current) return;
    if (videoClips.length === 0) {
      setIsInitialLoading(false);
      setIsVideoReady(true);
      return;
    }
    
    initDoneRef.current = true;
    
    const preloadClips = async () => {
      // ★ 预加载所有 clip（不只是前 5 个）
      const clipsToPreload = videoClips;
      setPreheatProgress({ done: 0, total: clipsToPreload.length, timedOut: 0 });
      
      log('🚀 开始预热', clipsToPreload.length, '个视频（治标治本模式）');
      
      // 1. 先批量检查 HLS 可用性
      const assetIds = clipsToPreload
        .map(c => c.assetId)
        .filter((id): id is string => !!id);
      
      await videoResourceManager.batchCheckHlsAvailability(assetIds);
      
      // 2. 并行创建所有视频元素
      const createPromises = clipsToPreload.map(async (clip) => {
        if (!clip.assetId) return null;
        
        // 检查是否已存在
        let clipVideo = videoResourceManager.getClipVideo(clip.id);
        if (!clipVideo) {
          const sourceStartSec = msToSec(clip.sourceStart || 0);
          const clipDurationSec = msToSec(clip.duration);
          const isBRoll = clip.clipType === 'broll';
          
          clipVideo = videoResourceManager.createVideoForClip(
            clip.id,
            clip.assetId,
            sourceStartSec,
            sourceStartSec + clipDurationSec,
            isBRoll
          );
        }
        
        return { clip, clipVideo };
      });
      
      const results = await Promise.all(createPromises);
      const validResults = results.filter((r): r is { clip: Clip; clipVideo: ClipVideoState } => r !== null);
      
      // 3. ★★★ 关键：等待每个 clip 都 ready + seek 到起始位置 + seeked 完成 ★★★
      let completed = 0;
      let timedOutCount = 0;  // ★ 追踪超时的视频数量
      
      const waitForClipReady = (clip: Clip, clipVideo: ClipVideoState): Promise<void> => {
        return new Promise((resolve) => {
          const video = clipVideo.element;
          const targetTime = msToSec(clip.sourceStart || 0);
          
          // ★★★ 治标治本：等待 status = 'ready'（不只是 canplay）★★★
          const waitForStatusReady = (): Promise<'ready' | 'timeout'> => {
            return new Promise((res) => {
              // 已经 ready 了
              if (clipVideo.status === 'ready') {
                res('ready');
                return;
              }
              
              // 监听事件
              const listenerId = `preheat-${clip.id}`;
              const handler = (event: { type: string; clipId: string }) => {
                if (event.clipId === clip.id && event.type === 'load-ready') {
                  videoResourceManager.removeEventListener(listenerId);
                  res('ready');
                }
              };
              videoResourceManager.addEventListener(listenerId, handler);
              
              // 超时保护（15s，给足够时间缓冲 2s）
              setTimeout(() => {
                videoResourceManager.removeEventListener(listenerId);
                res('timeout');
              }, 15000);
            });
          };
          
          // 等待 seeked 事件（帧已解码）
          const waitForSeeked = (): Promise<void> => {
            return new Promise((res) => {
              const drift = Math.abs(video.currentTime - targetTime);
              if (drift < 0.1) {
                res();
                return;
              }
              
              const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                res();
              };
              video.addEventListener('seeked', onSeeked, { once: true });
              video.currentTime = targetTime;
              
              // 超时保护
              setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                res();
              }, 5000);
            });
          };
          
          // ★★★ 并行执行：status ready + seek 完成 ★★★
          Promise.all([waitForStatusReady(), waitForSeeked()])
            .then(([statusResult]) => {
              completed++;
              if (statusResult === 'timeout') {
                timedOutCount++;
              }
              setPreheatProgress({ done: completed, total: clipsToPreload.length, timedOut: timedOutCount });
              resolve();
            });
        });
      };
      
      // 并行等待所有 clip 就绪（有超时保护，不会无限等待）
      await Promise.all(validResults.map(({ clip, clipVideo }) => waitForClipReady(clip, clipVideo)));
      
      setIsInitialLoading(false);
      setIsVideoReady(true);
      log('预热完成:', completed, '个视频', timedOutCount > 0 ? `(其中 ${timedOutCount} 个仍在后台加载)` : '');
    };
    
    preloadClips();
  }, [videoClips, setIsVideoReady]);
  
  // ★★★ 注册事件监听器（用于状态更新）★★★
  useEffect(() => {
    const id = componentIdRef.current;
    
    videoResourceManager.addEventListener(id, (_event) => {
      // 事件监听用于触发 React 重渲染
    });
    
    return () => {
      videoResourceManager.removeEventListener(id);
    };
  }, []);
  
  // ★★★ 动态添加的 clips 预热（B-Roll 等）★★★
  // 当 videoClips 变化时，检查是否有新的 clips 需要创建视频元素
  useEffect(() => {
    // 跳过初始加载阶段（由上面的 preloadClips 处理）
    if (isInitialLoading) return;
    if (videoClips.length === 0) return;
    
    const preloadNewClips = async () => {
      // 找出没有视频元素的 clips
      const newClips = videoClips.filter(clip => {
        if (!clip.assetId) return false;
        return !videoResourceManager.getClipVideo(clip.id);
      });
      
      if (newClips.length === 0) return;
      
      // 1. 批量检查 HLS 可用性
      const assetIds = newClips.map(c => c.assetId).filter((id): id is string => !!id);
      await videoResourceManager.batchCheckHlsAvailability(assetIds);
      
      // 2. 创建视频元素
      for (const clip of newClips) {
        if (!clip.assetId) continue;
        
        const sourceStartSec = msToSec(clip.sourceStart || 0);
        const clipDurationSec = msToSec(clip.duration);
        const isBRoll = clip.clipType === 'broll';
        
        videoResourceManager.createVideoForClip(
          clip.id,
          clip.assetId,
          sourceStartSec,
          sourceStartSec + clipDurationSec,
          isBRoll
        );
      }
    };
    
    preloadNewClips();
  }, [videoClips, isInitialLoading]);
  
  // ★★★ 时钟监听：PlaybackClock -> Store 同步 ★★★
  useEffect(() => {
    const id = componentIdRef.current;
    
    // 监听时钟变化，更新 store
    playbackClock.addListener(id, (timeMs, playing) => {
      clockSyncRef.current = true;
      setCurrentTime(timeMs);
      if (playing !== isPlaying) {
        setIsPlaying(playing);
      }
      clockSyncRef.current = false;
    });
    
    // 监听等待状态
    playbackClock.addWaitingListener(id, (waiting) => {
      setIsWaitingBuffer(waiting);
    });
    
    return () => {
      playbackClock.removeListener(id);
      playbackClock.removeWaitingListener(id);
    };
  }, [setCurrentTime, setIsPlaying, isPlaying]);
  
  // ★★★ Store -> 时钟同步（用户拖动时间轴时）★★★
  useEffect(() => {
    // 如果是时钟触发的更新，不要反向同步
    if (clockSyncRef.current) return;
    
    // 检查时间差异，只有用户操作才同步
    const clockTime = playbackClock.currentTimeMs;
    const drift = Math.abs(currentTime - clockTime);
    if (drift > 100) { // 超过 100ms 才认为是用户 seek
      playbackClock.seek(currentTime);
    }
  }, [currentTime]);
  
  // ★★★ Store isPlaying -> 时钟同步 ★★★
  useEffect(() => {
    if (clockSyncRef.current) return;
    
    if (isPlaying && !playbackClock.isPlaying) {
      playbackClock.play();
    } else if (!isPlaying && playbackClock.isPlaying) {
      playbackClock.pause();
    }
  }, [isPlaying]);
  
  // ★★★ 设置时钟总时长 ★★★
  useEffect(() => {
    if (clips.length === 0) {
      playbackClock.setDuration(0);
      return;
    }
    const totalDuration = Math.max(...clips.map(c => c.start + c.duration));
    playbackClock.setDuration(totalDuration);
  }, [clips]);
  
  // ★★★ 注册视频 clips 到 PlaybackClock（用于多视频同步）★★★
  useEffect(() => {
    if (videoClips.length === 0) {
      playbackClock.clearRegisteredClips();
      return;
    }
    
    // 转换为 RegisteredClip 格式
    const registeredClips: RegisteredClip[] = videoClips.map(clip => ({
      clipId: clip.id,
      timelineStart: clip.start,
      timelineEnd: clip.start + clip.duration,
      sourceStart: clip.sourceStart || 0,
    }));
    
    // 清空后重新注册
    playbackClock.clearRegisteredClips();
    playbackClock.registerClips(registeredClips);
  }, [videoClips]);
  
  // ★★★ 检测叠加区域并提前预热（叠加感知预热）★★★
  const upcomingOverlayClips = useMemo(() => {
    if (!isPlaying) return [];
    
    // 扩大预热窗口：3s 用于叠加预热
    const overlayPreheatMs = 3000;
    const lookAheadEnd = currentTime + overlayPreheatMs;
    
    // 找出即将进入叠加状态的 clips
    const upcoming: Clip[] = [];
    
    for (const clip of videoClips) {
      const clipStart = clip.start;
      const clipEnd = clip.start + clip.duration;
      
      // 即将开始（不是当前可见）
      if (clipStart > currentTime && clipStart <= lookAheadEnd) {
        upcoming.push(clip);
      }
      // 或者当前正在播放，检查是否有其他 clip 即将叠加上来
      else if (clipStart <= currentTime && clipEnd > currentTime) {
        // 这个 clip 正在播放，检查其他即将开始的 clip
        for (const other of videoClips) {
          if (other.id === clip.id) continue;
          if (other.start > currentTime && other.start <= lookAheadEnd) {
            // 有叠加即将发生！确保两个 clip 都在预热列表中
            if (!upcoming.includes(clip)) upcoming.push(clip);
            if (!upcoming.includes(other)) upcoming.push(other);
          }
        }
      }
    }
    
    return upcoming;
  }, [videoClips, currentTime, isPlaying]);
  
  // ★★★ 预热即将到来的 clips（避免切换时闪屏）★★★
  useEffect(() => {
    if (!isPlaying) return;
    
    // ★★★ 短 clip 优化：预加载窗口增加到 10s ★★★
    // 对于 2-5s 的短 clip，10s 窗口可以覆盖接下来 2-5 个 clips
    const preheatWindowMs = 10000;
    const upcomingClips = videoClips.filter(clip => {
      const clipStart = clip.start;
      const clipEnd = clip.start + clip.duration;
      // 即将开始或正在播放的 clip
      return clipStart <= currentTime + preheatWindowMs && clipEnd > currentTime;
    });
    
    // 预热这些 clips
    for (const clip of upcomingClips) {
      if (!clip.assetId) continue;
      
      // 如果还没创建，创建它
      if (!videoResourceManager.getClipVideo(clip.id)) {
        const sourceStartSec = msToSec(clip.sourceStart || 0);
        const clipDurationSec = msToSec(clip.duration);
        const isBRoll = clip.clipType === 'broll';
        
        videoResourceManager.createVideoForClip(
          clip.id,
          clip.assetId,
          sourceStartSec,
          sourceStartSec + clipDurationSec,
          isBRoll
        );
      }
    }
  }, [currentTime, isPlaying, videoClips]);

  // 获取当前可见的视频 clips（必须在等待条件 useEffect 之前）
  const visibleVideoClips = useMemo(() => {
    return videoClips
      .filter(clip => {
        const clipEnd = clip.start + clip.duration;
        return currentTime >= clip.start && currentTime < clipEnd;
      })
      .sort((a, b) => {
        const trackA = tracks.find(t => t.id === a.trackId);
        const trackB = tracks.find(t => t.id === b.trackId);
        return (trackA?.orderIndex ?? 999) - (trackB?.orderIndex ?? 999);
      });
  }, [videoClips, currentTime, tracks]);
  
  // ★★★ 添加等待条件：当前可见 clip + 即将叠加的 clip 必须 ready ★★★
  useEffect(() => {
    const id = `wait-${componentIdRef.current}`;
    const OVERLAY_LOOK_AHEAD_MS = 500; // 提前 500ms 检查即将叠加的 clip
    
    playbackClock.addWaitCondition({
      id,
      reason: '等待视频缓冲',
      check: () => {
        // 1. 检查所有当前可见的 clip 是否存在且 ready
        for (let i = 0; i < visibleVideoClips.length; i++) {
          const clip = visibleVideoClips[i];
          const video = videoResourceManager.getClipVideo(clip.id);
          // 视频必须存在且状态为 ready
          if (!video || video.status !== 'ready') {
            // ★★★ 记录正在等待的 clip 信息 ★★★
            const clipIndex = videoClips.findIndex(c => c.id === clip.id) + 1;
            setWaitingClipInfo({ clipId: clip.id, clipIndex });
            return false;
          }
        }
        
        // 2. ★★★ 预判检查：即将叠加的 clip 也必须 ready ★★★
        const upcomingOverlay = videoClips.filter(clip => {
          const clipStart = clip.start;
          // 即将开始（在 500ms 内）
          return clipStart > currentTime && clipStart <= currentTime + OVERLAY_LOOK_AHEAD_MS;
        });
        
        for (const clip of upcomingOverlay) {
          const video = videoResourceManager.getClipVideo(clip.id);
          
          // 即将叠加的视频必须已创建且 ready
          if (!video || video.status !== 'ready') {
            // 记录正在等待的 clip 信息
            const clipIndex = videoClips.findIndex(c => c.id === clip.id) + 1;
            setWaitingClipInfo({ clipId: clip.id, clipIndex });
            return false;
          }
          
          // ★★★ 还要检查是否已经 seek 到正确位置 ★★★
          const targetTime = msToSec(clip.sourceStart || 0);
          if (!videoResourceManager.isClipSeekedToPosition(clip.id, targetTime, 0.15)) {
            const clipIndex = videoClips.findIndex(c => c.id === clip.id) + 1;
            setWaitingClipInfo({ clipId: clip.id, clipIndex });
            return false;
          }
        }
        
        // 全部 ready，清除等待信息
        setWaitingClipInfo(null);
        return true;
      },
    });
    
    return () => {
      playbackClock.removeWaitCondition(id);
    };
  }, [visibleVideoClips, videoClips, currentTime]);
  
  // 预热进度文案（治标治本：说明在等什么）
  const preheatProgressText = preheatProgress.total > 0 
    ? `正在预加载所有片段 (${preheatProgress.done}/${preheatProgress.total})` 
    : '正在检查视频资源...';
  
  const preheatStageText = useMemo(() => {
    if (preheatProgress.done === 0) {
      return '正在创建视频元素...';
    }
    if (preheatProgress.timedOut > 0) {
      return `${preheatProgress.done - preheatProgress.timedOut} 个已就绪，${preheatProgress.timedOut} 个仍在加载`;
    }
    return `${preheatProgress.done} 个片段已就绪，确保无卡顿播放`;
  }, [preheatProgress]);
  
  // ★★★ 缓冲中提示文案 ★★★
  const bufferHintText = useMemo(() => {
    if (!waitingClipInfo) return '加载下一个片段...';
    return `正在加载第 ${waitingClipInfo.clipIndex} 个片段`;
  }, [waitingClipInfo]);
  
  return (
    <div className="relative flex flex-col w-full h-full flex-1 bg-transparent overflow-hidden">
      {/* 视频预热加载提示 */}
      {isInitialLoading && videoClips.length > 0 && (
        <BlockingLoader
          isLoading={true}
          type="video"
          title="视频准备中..."
          subtitle={preheatProgressText}
          stage={preheatStageText}
        />
      )}
      
      {/* 视频画布区域 */}
      <div ref={videoAreaRef} className="flex-1 flex items-center justify-center min-h-0 p-4">
        {hasVisualContent ? (
          canvasSize.width > 0 && canvasSize.height > 0 ? (
            <div 
              className="relative rounded-2xl shadow-lg"
              style={{
                width: canvasSize.width,
                height: canvasSize.height,
                transform: `scale(${zoom})`,
                transformOrigin: 'center center',
                overflow: 'hidden',
              }}
            >
              {/* 视频背景 */}
              <div className="absolute inset-0" style={{ background: '#000' }} />
              
              {/* ★★★ 治标治本：预热完成前不渲染 VideoClipRenderer ★★★ */}
              {/* 这样确保 VideoClipRenderer 渲染时，视频已经创建好了 */}
              {!isInitialLoading && videoClips.map((clip) => {
                const clipEnd = clip.start + clip.duration;
                
                // ★ 三种状态：visible（正在显示）、upcoming（即将显示，需预热）、hidden（不需要）
                const isVisible = currentTime >= clip.start && currentTime < clipEnd;
                
                // ★★★ 短 clip 优化：预热窗口加大到 2000ms ★★★
                // 这样对于 2-5s 的短 clip，有足够时间完成 seek + 解码
                const PREHEAT_WINDOW_MS = 2000;
                const isUpcoming = !isVisible && 
                  currentTime >= clip.start - PREHEAT_WINDOW_MS && 
                  currentTime < clip.start;
                
                // 计算 z-index（视频层限制在 10-29，留出空间给图片、文本层）
                const track = tracks.find(t => t.id === clip.trackId);
                const trackOrderIndex = track?.orderIndex ?? 0;
                const zIndex = isVisible ? Math.min(trackOrderIndex + 10, 29) : 0;
                
                // ★★★ 计算是否是最底层轨道（用于音频优先级）★★★
                const minOrderIndex = Math.min(...tracks.map(t => t.orderIndex));
                const isLowestTrack = trackOrderIndex === minOrderIndex;
                
                const clipKeyframes = keyframes?.get(clip.id);
                const transformStyle = calcClipTransformStyle(clip, currentTime, clipKeyframes);
                
                return (
                  <VideoClipRenderer
                    key={clip.id}
                    clip={clip}
                    currentTimeMs={currentTime}
                    isPlaying={isPlaying && isVisible && !isWaitingBuffer}
                    isVisible={isVisible}
                    isUpcoming={isUpcoming}
                    zIndex={zIndex}
                    transformStyle={transformStyle}
                    trackOrderIndex={trackOrderIndex}
                    isLowestTrack={isLowestTrack}
                  />
                );
              })}
              
              {/* 文本覆盖层 */}
              <TextOverlay
                containerWidth={canvasSize.width}
                containerHeight={canvasSize.height}
                zoom={zoom}
                showControls={(canvasEditMode === 'text' || canvasEditMode === 'subtitle') && !isPlaying}
              />
              
              {/* 图片覆盖层 */}
              <ImageOverlay
                containerWidth={canvasSize.width}
                containerHeight={canvasSize.height}
                zoom={zoom}
                showControls={!isPlaying}
              />

              {/* ★★★ 缓冲加载中 ★★★ */}
              {isWaitingBuffer && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/30 backdrop-blur-sm pointer-events-none">
                  <RabbitLoader size={48} text={bufferHintText} />
                </div>
              )}
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
    </div>
  );
}

// ==================== 音频优先级系统 ====================

type AudioPriority = 'primary' | 'secondary' | 'background' | 'muted';

interface AudioConfig {
  priority: AudioPriority;
  volume: number;
  muted: boolean;
}

/**
 * 根据 clip 类型和轨道位置计算音频配置
 * - B-Roll 默认静音
 * - 主轨道（orderIndex 最低）是主音频
 * - 其他轨道降低音量
 */
function getAudioConfig(clip: Clip, trackOrderIndex: number, isLowestTrack: boolean): AudioConfig {
  // B-Roll 默认静音
  if (clip.clipType === 'broll') {
    return { priority: 'muted', volume: 0, muted: true };
  }
  
  // 用户明确静音
  if (clip.isMuted) {
    return { priority: 'muted', volume: 0, muted: true };
  }
  
  // 主轨道（orderIndex 最低）是主音频
  if (isLowestTrack) {
    return { 
      priority: 'primary', 
      volume: clip.volume ?? 1, 
      muted: false 
    };
  }
  
  // 其他轨道降低音量（叠加时避免音频冲突）
  return { 
    priority: 'secondary', 
    volume: (clip.volume ?? 1) * 0.3, // 降低到 30%
    muted: false 
  };
}

// ==================== 单个视频渲染器 ====================

interface VideoClipRendererProps {
  clip: Clip;
  currentTimeMs: number;
  isPlaying: boolean;
  isVisible: boolean;  // ★ 当前正在显示
  isUpcoming: boolean; // ★ 即将显示，需要预热（seek + 解码）
  zIndex: number;
  transformStyle: { transform: string; opacity: number };
  trackOrderIndex: number;    // ★ 轨道层级
  isLowestTrack: boolean;     // ★ 是否是最底层轨道
}

function VideoClipRenderer({
  clip,
  currentTimeMs,
  isPlaying,
  isVisible,
  isUpcoming,
  zIndex,
  transformStyle,
  trackOrderIndex,
  isLowestTrack,
}: VideoClipRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // ★★★ 关键修复：初始化时就同步获取视频，不等 useEffect ★★★
  const initialVideo = videoResourceManager.getClipVideo(clip.id);
  const [clipVideo, setClipVideo] = useState<ClipVideoState | undefined>(initialVideo);
  const [videoStatus, setVideoStatus] = useState<'loading' | 'ready' | 'error'>(
    initialVideo?.status || 'loading'
  );
  
  const isMountedRef = useRef(false); // 追踪是否已挂载到 DOM
  const isPreheatSeekingRef = useRef(false); // ★ 追踪预热 seek 状态
  const hasPreheatFrameRef = useRef(false); // ★ 追踪是否已解码预热帧
  
  // ★★★ 纯同步获取视频（初始预热已创建好所有视频）★★★
  // 监听视频状态变化，触发 re-render
  useEffect(() => {
    const listenerId = `renderer-${clip.id}`;
    
    videoResourceManager.addEventListener(listenerId, (event) => {
      if (event.clipId === clip.id) {
        if (event.type === 'load-ready') {
          setVideoStatus('ready');
        } else if (event.type === 'load-error') {
          setVideoStatus('error');
        }
      }
    });
    
    return () => {
      videoResourceManager.removeEventListener(listenerId);
    };
  }, [clip.id]);
  
  // ★★★ 同步获取视频（去掉所有异步逻辑）★★★
  useEffect(() => {
    if (!clip.assetId) return;
    
    // 重置预热状态
    hasPreheatFrameRef.current = false;
    isPreheatSeekingRef.current = false;
    
    // 同步获取（初始预热时已创建）
    const video = videoResourceManager.getClipVideo(clip.id);
    
    if (video) {
      setClipVideo(video);
      setVideoStatus(video.status);
    } else {
      setClipVideo(undefined);
      setVideoStatus('loading');
    }
  }, [clip.id, clip.assetId]);
  
  // 挂载视频元素到 DOM（必须在播放逻辑之前）
  useEffect(() => {
    if (!containerRef.current || !clipVideo) {
      isMountedRef.current = false;
      return;
    }
    
    const video = clipVideo.element;
    
    // 设置样式
    video.className = 'w-full h-full object-contain';
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.transform = transformStyle.transform;
    video.style.opacity = String(transformStyle.opacity);
    
    // ★★★ 应用音频优先级配置 ★★★
    const audioConfig = getAudioConfig(clip, trackOrderIndex, isLowestTrack);
    video.muted = audioConfig.muted;
    video.volume = audioConfig.volume;
    
    // 挂载到容器
    if (video.parentElement !== containerRef.current) {
      containerRef.current.appendChild(video);
    }
    
    isMountedRef.current = true;
    
    return () => {
      isMountedRef.current = false;
      // 从 DOM 移除，但不销毁资源
      if (containerRef.current && video.parentElement === containerRef.current) {
        containerRef.current.removeChild(video);
      }
    };
  }, [clipVideo, clip.isMuted, clip.volume, clip.clipType, trackOrderIndex, isLowestTrack]); // 音频相关依赖
  
  // 同步视频时间和播放状态（必须在挂载之后）
  useEffect(() => {
    if (!clipVideo) return;
    if (!isMountedRef.current) return; // ★ 必须挂载到 DOM 后才能播放
    
    const video = clipVideo.element;
    const targetTime = calcMediaTime(currentTimeMs, clip);
    
    // ★★★ 真正的双缓冲核心逻辑 ★★★
    // 1. visible：正在播放，同步时间和播放状态
    // 2. upcoming：即将播放，提前 seek 到目标位置并解码帧（但不播放）
    // 3. hidden：完全不可见，暂停即可
    
    if (isVisible) {
      // ===== 正在显示：同步时间并播放 =====
      const drift = Math.abs(video.currentTime - targetTime);
      
      // 只在大漂移时 seek
      if (drift > 0.3) {
        video.currentTime = targetTime;
      }
      
      // 同步播放状态（使用 videoStatus 而不是 clipVideo.status）
      if (isPlaying && video.paused && videoStatus === 'ready') {
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      } else if (!isPlaying && !video.paused) {
        video.pause();
      }
      
      // 更新访问时间
      videoResourceManager.touchClip(clip.id);
      
    } else if (isUpcoming) {
      // ===== 即将显示：预热 - seek 到 clip 开始位置并等待帧解码 =====
      // ★★★ 关键优化：不只是 seek，还要等 seeked 事件确保帧已解码 ★★★
      const clipStartMediaTime = msToSec(clip.sourceStart || 0);
      const drift = Math.abs(video.currentTime - clipStartMediaTime);
      
      // 只在大漂移且未在预热 seek 中时才 seek
      if (drift > 0.1 && !isPreheatSeekingRef.current && !hasPreheatFrameRef.current) {
        isPreheatSeekingRef.current = true;
        
        // 监听 seeked 事件，确认帧已解码
        const onSeeked = () => {
          isPreheatSeekingRef.current = false;
          hasPreheatFrameRef.current = true;
          video.removeEventListener('seeked', onSeeked);
          // 可选：记录预热完成日志
          // console.log('[预热完成]', clip.id.slice(-8), 'seek 到', clipStartMediaTime.toFixed(2), 's');
        };
        
        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = clipStartMediaTime;
      }
      
      // 确保暂停状态
      if (!video.paused) {
        video.pause();
      }
      
    } else {
      // ===== 不可见且不需要预热：暂停并重置预热状态 =====
      if (!video.paused) {
        video.pause();
      }
      // ★ 重置预热状态，为下次预热准备
      hasPreheatFrameRef.current = false;
      isPreheatSeekingRef.current = false;
    }
  }, [clipVideo, videoStatus, currentTimeMs, isPlaying, isVisible, isUpcoming, clip]);
  
  // 更新 transform（不触发重挂载）
  useEffect(() => {
    if (!clipVideo) return;
    clipVideo.element.style.transform = transformStyle.transform;
    clipVideo.element.style.opacity = String(transformStyle.opacity);
  }, [clipVideo, transformStyle]);
  
  // ★ 不显示 loading 避免闪屏，保持空白或黑色
  // 视频加载后会自动显示
  
  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        zIndex,
        // ★★★ 双缓冲核心：用 opacity 控制显隐（不用 visibility，因为 hidden 会阻止解码） ★★★
        // 即将可见的 clip (upcoming) 也用 opacity:0，但浏览器会继续解码
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? 'auto' : 'none',
        // 使用 GPU 加速，确保 opacity 变化是 GPU 合成层操作
        willChange: 'opacity',
        backfaceVisibility: 'hidden',
        // 强制 GPU 层
        transform: 'translateZ(0)',
        // 如果没有视频，显示黑色背景而不是 loading
        backgroundColor: !clipVideo ? '#000' : 'transparent',
      }}
    />
  );
}

export default VideoCanvasV3;
