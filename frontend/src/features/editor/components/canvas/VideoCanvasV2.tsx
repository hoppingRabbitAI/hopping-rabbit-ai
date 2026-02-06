/**
 * VideoCanvasV2 - 重构版视频画布组件
 * 
 * 使用新的分层架构：
 * - Layer 1: PlaybackController (播放控制)
 * - Layer 2: ClipScheduler (Clip 调度)
 * - Layer 3: VideoResource (视频资源)
 * 
 * 设计原则：
 * - 全程 clip 维度操作
 * - 单一数据源 (clipVideos Map)
 * - 使用 MP4 代理，移除 HLS 复杂性
 * - pause-and-wait 加载策略
 * 
 * 使用方式：在 editor-store 中设置 useNewVideoSystem = true 来启用
 */

'use client';

import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { useEditorStore } from '../../store/editor-store';
import { msToSec, secToMs } from '../../lib/time-utils';
import { getClipTransformAtOffset, ClipTransform } from '../../lib/keyframe-interpolation';
import { TextOverlay } from '../TextOverlay';
import { ImageOverlay } from '../ImageOverlay';
import { BlockingLoader } from '../BlockingLoader';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { useVideoPlaybackSystem } from '../../hooks/useVideoPlaybackSystem';
import { getAssetProxyUrl } from '@/lib/api/media-proxy';
import type { Clip } from '../../types/clip';
import type { Keyframe } from '../../types/keyframe';

const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEBUG) console.log('[VideoCanvasV2]', ...args); };

/**
 * 计算 clip 在当前时间的媒体时间（秒）
 */
function calcMediaTime(timelineTimeMs: number, clip: Clip): number {
  const clipStartMs = clip.start;
  const offsetInClipMs = timelineTimeMs - clipStartMs;
  const sourceStartMs = clip.sourceStart || 0;
  return msToSec(sourceStartMs + offsetInClipMs);
}

/**
 * 计算 clip 的 transform 样式
 */
function calcClipTransformStyle(
  clip: Clip,
  currentTimeMs: number,
  clipKeyframes?: Map<string, Keyframe[]>
): { transform: string; opacity: number } {
  // 基础 transform
  const staticTransform = (clip.metadata?.transformParams || {}) as Record<string, number | boolean>;
  
  // 关键帧 transform
  const offsetMs = currentTimeMs - clip.start;
  const kfTransform: ClipTransform = clipKeyframes 
    ? getClipTransformAtOffset(clipKeyframes, offsetMs) 
    : {};
  
  // 使用 ClipTransform 的正确属性名
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

export function VideoCanvasV2() {
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
  const keyframes = useEditorStore((s) => s.keyframes);
  
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  
  // Local state
  const [zoom, setZoom] = useState(1);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [preheatProgress, setPreheatProgress] = useState({ done: 0, total: 0 });
  
  // 防止重复初始化
  const initRef = useRef(false);
  const lastVideoClipCountRef = useRef(0);
  
  // ★★★ 新架构：使用 useVideoPlaybackSystem ★★★
  const videoSystem = useVideoPlaybackSystem({
    config: {
      maxActiveVideos: 10,
      preheatWindowSec: 15,
      seekThreshold: 0.3,
      bufferThreshold: 2,
      hlsThreshold: 999, // ★ 暂时禁用 HLS，全部使用 MP4（HLS 后端 404 问题待修复）
    },
  });
  
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
  
  // 时间线总时长
  const duration = useMemo(() => {
    if (clips.length === 0) return 0;
    return Math.max(...clips.map(c => c.start + c.duration));
  }, [clips]);
  
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
  
  // ★★★ 初始预热 ★★★
  // 使用 ref 防止重复初始化（React Strict Mode 会执行两次）
  useEffect(() => {
    // 防止重复初始化
    if (initRef.current) {
      return;
    }
    
    if (videoClips.length === 0) {
      setIsInitialLoading(false);
      setIsVideoReady(true);
      return;
    }
    
    // 标记已初始化
    initRef.current = true;
    lastVideoClipCountRef.current = videoClips.length;
    
    const preloadInitialClips = async () => {
      const clipsToPreload = videoClips.slice(0, 5); // 预热前 5 个
      setPreheatProgress({ done: 0, total: clipsToPreload.length });
      
      log('🚀 开始预热', clipsToPreload.length, '个视频');
      
      let completed = 0;
      
      for (const clip of clipsToPreload) {
        if (!clip.assetId) {
          completed++;
          setPreheatProgress({ done: completed, total: clipsToPreload.length });
          continue;
        }
        
        // 检查是否已存在
        const existing = videoSystem.videoResource.getClipVideo(clip.id);
        if (existing) {
          completed++;
          setPreheatProgress({ done: completed, total: clipsToPreload.length });
          continue;
        }
        
        // 创建视频
        const sourceStartSec = msToSec(clip.sourceStart || 0);
        const clipDurationSec = msToSec(clip.duration);
        const isBRoll = clip.clipType === 'broll';
        
        videoSystem.videoResource.createVideoForClip(
          clip.id,
          clip.assetId,
          sourceStartSec,
          sourceStartSec + clipDurationSec,
          isBRoll
        );
        
        completed++;
        setPreheatProgress({ done: completed, total: clipsToPreload.length });
        
        log(`  [${completed}/${clipsToPreload.length}] 预热:`, clip.id.slice(-8));
        
        // 等待一小段时间让视频开始加载
        await new Promise(r => setTimeout(r, 100));
      }
      
      // 等待第一个视频 ready
      const firstClip = videoClips[0];
      if (firstClip) {
        let attempts = 0;
        while (attempts < 50) { // 最多等待 5 秒
          if (videoSystem.isClipReady(firstClip.id)) {
            break;
          }
          await new Promise(r => setTimeout(r, 100));
          attempts++;
        }
      }
      
      setIsInitialLoading(false);
      setIsVideoReady(true);
      log('🎉 预热完成');
    };
    
    preloadInitialClips();
    
    // ★★★ 注意：不在这里 cleanup，只在组件真正卸载时清理 ★★★
  }, [videoClips.length]);
  
  // ★★★ 组件卸载时清理 ★★★
  useEffect(() => {
    return () => {
      log('🧹 组件卸载，清理资源');
      videoSystem.cleanup();
    };
  }, []); // 空依赖，只在卸载时执行
  
  // 获取当前可见的视频 clips
  const visibleVideoClips = useMemo(() => {
    return videoClips
      .filter(clip => {
        const clipEnd = clip.start + clip.duration;
        return currentTime >= clip.start && currentTime < clipEnd;
      })
      .sort((a, b) => {
        const trackA = tracks.find(t => t.id === a.trackId);
        const trackB = tracks.find(t => t.id === b.trackId);
        const orderA = trackA?.orderIndex ?? 999;
        const orderB = trackB?.orderIndex ?? 999;
        return orderA - orderB;
      });
  }, [videoClips, currentTime, tracks]);
  
  // 预热进度文案
  const preheatProgressText = preheatProgress.total > 0 
    ? `正在加载视频 (${preheatProgress.done}/${preheatProgress.total})` 
    : '正在准备视频...';
  
  return (
    <div 
      ref={containerRef} 
      className="relative flex flex-col w-full h-full flex-1 bg-transparent overflow-hidden"
    >
      {/* 视频预热加载提示 */}
      {isInitialLoading && videoClips.length > 0 && (
        <BlockingLoader
          isLoading={true}
          type="video"
          title="视频准备中..."
          subtitle={preheatProgressText}
          stage={preheatProgress.done > 0 ? `已完成 ${preheatProgress.done} 个` : '开始加载...'}
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
                transition: 'transform 0.2s ease-out',
                overflow: 'hidden',
              }}
            >
              {/* 视频背景 */}
              <div className="absolute inset-0" style={{ background: '#f5f5f5' }} />
              
              {/* ★★★ 多轨道视频渲染 ★★★ */}
              {visibleVideoClips.map((clip, index) => {
                // 获取或创建视频元素
                let clipVideo = videoSystem.videoResource.getClipVideo(clip.id);
                
                // 如果没有，创建一个
                if (!clipVideo && clip.assetId) {
                  const sourceStartSec = msToSec(clip.sourceStart || 0);
                  const clipDurationSec = msToSec(clip.duration);
                  const isBRoll = clip.clipType === 'broll';
                  
                  clipVideo = videoSystem.videoResource.createVideoForClip(
                    clip.id,
                    clip.assetId,
                    sourceStartSec,
                    sourceStartSec + clipDurationSec,
                    isBRoll
                  );
                }
                
                if (!clipVideo) {
                  return (
                    <div
                      key={clip.id}
                      className="absolute inset-0 flex items-center justify-center bg-gray-100"
                      style={{ zIndex: index }}
                    >
                      <RabbitLoader size={24} />
                    </div>
                  );
                }
                
                // 计算 transform
                const clipKeyframes = keyframes?.get(clip.id);
                const transformStyle = calcClipTransformStyle(clip, currentTime, clipKeyframes);
                
                return (
                  <VideoClipRenderer
                    key={clip.id}
                    clip={clip}
                    clipVideo={clipVideo}
                    currentTimeMs={currentTime}
                    isPlaying={isPlaying}
                    zIndex={index}
                    transformStyle={transformStyle}
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

/**
 * 单个视频 clip 渲染器
 */
interface VideoClipRendererProps {
  clip: Clip;
  clipVideo: ReturnType<ReturnType<typeof useVideoPlaybackSystem>['videoResource']['getClipVideo']>;
  currentTimeMs: number;
  isPlaying: boolean;
  zIndex: number;
  transformStyle: { transform: string; opacity: number };
}

function VideoClipRenderer({
  clip,
  clipVideo,
  currentTimeMs,
  isPlaying,
  zIndex,
  transformStyle,
}: VideoClipRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSyncTimeRef = useRef<number>(0);
  
  // 同步视频时间和播放状态
  useEffect(() => {
    if (!clipVideo) return;
    
    const video = clipVideo.element;
    const targetTime = calcMediaTime(currentTimeMs, clip);
    const currentVideoTime = video.currentTime;
    const drift = Math.abs(currentVideoTime - targetTime);
    
    // 只在大漂移时 seek
    if (drift > 0.3) {
      video.currentTime = targetTime;
    }
    
    // 同步播放状态
    if (isPlaying && video.paused && clipVideo.status === 'ready') {
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [clipVideo, currentTimeMs, isPlaying, clip]);
  
  // 挂载视频元素到 DOM
  useEffect(() => {
    if (!containerRef.current || !clipVideo) return;
    
    const video = clipVideo.element;
    
    // 设置样式
    video.className = 'w-full h-full object-contain';
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.transform = transformStyle.transform;
    video.style.opacity = String(transformStyle.opacity);
    video.muted = clip.isMuted ?? false;
    
    // 挂载到容器
    if (video.parentElement !== containerRef.current) {
      containerRef.current.appendChild(video);
    }
    
    return () => {
      // 不要移除，让资源层管理
    };
  }, [clipVideo, transformStyle, clip.isMuted]);
  
  // 更新 transform
  useEffect(() => {
    if (!clipVideo) return;
    clipVideo.element.style.transform = transformStyle.transform;
    clipVideo.element.style.opacity = String(transformStyle.opacity);
  }, [clipVideo, transformStyle]);
  
  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        zIndex,
        willChange: 'transform, opacity',
        backfaceVisibility: 'hidden',
      }}
    />
  );
}

export default VideoCanvasV2;
