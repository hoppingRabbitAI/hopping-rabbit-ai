'use client';

import { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useEditorStore, TICK_WIDTH } from '../store/editor-store';
import type { Clip } from '../types';
import { getCachedThumbnails, setCachedThumbnails } from './LazyMedia';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugWarn = (...args: unknown[]) => { if (DEBUG_ENABLED) console.warn(...args); };

// ============================================
// 迷你波形显示（移到前面避免引用问题）
// ============================================

interface MiniWaveformDisplayProps {
  data: number[];
  width: number;
  height: number;
  color?: string;
}

function MiniWaveformDisplay({ data, width, height, color = '#4ade80' }: MiniWaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    
    const barWidth = width / data.length;
    const centerY = height / 2;
    
    data.forEach((amplitude, i) => {
      const barHeight = amplitude * centerY * 0.9;
      const x = i * barWidth;
      
      // 上半部分
      ctx.fillRect(x, centerY - barHeight, Math.max(1, barWidth - 1), barHeight);
      // 下半部分（镜像）
      ctx.fillRect(x, centerY, Math.max(1, barWidth - 1), barHeight);
    });
  }, [data, width, height, color]);
  
  return <canvas ref={canvasRef} className="opacity-60" />;
}

// ============================================
// 音频波形缓存（避免重复生成）
// ============================================
const waveformCache = new Map<string, number[]>();

// 生成模拟波形（看起来像真实音频波形）
function generateMockWaveform(samples: number, seed: string): number[] {
  // 使用 URL 作为种子，确保同一音频每次生成相同的波形
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  
  // 简单的伪随机数生成器
  const random = () => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash / 0x7fffffff;
  };
  
  const waveform: number[] = [];
  let value = 0.4;
  
  for (let i = 0; i < samples; i++) {
    // 使用随机游走 + 正弦波组合，模拟真实波形
    const noise = (random() - 0.5) * 0.4;
    const wave = Math.sin(i * 0.15) * 0.15;
    const beat = Math.sin(i * 0.04) * 0.2; // 低频节拍感
    
    value = value * 0.6 + (0.45 + noise + wave + beat) * 0.4;
    value = Math.max(0.15, Math.min(0.95, value));
    waveform.push(value);
  }
  
  return waveform;
}

// 获取或生成波形数据
function getWaveformData(url: string, samples: number): number[] {
  if (waveformCache.has(url)) {
    return waveformCache.get(url)!;
  }
  
  const waveform = generateMockWaveform(samples, url);
  waveformCache.set(url, waveform);
  return waveform;
}

// ============================================
// 音频波形显示组件（同步生成模拟波形）
// ============================================
interface AudioWaveformDisplayProps {
  url: string;
  width: number;
  height: number;
  color?: string;
}

function AudioWaveformDisplay({ url, width, height, color = '#4ade80' }: AudioWaveformDisplayProps) {
  // 计算采样数量（根据宽度）
  const samples = useMemo(() => Math.min(200, Math.max(30, Math.floor(width / 4))), [width]);
  
  // 同步生成波形数据
  const waveformData = useMemo(() => {
    if (!url) return null;
    return getWaveformData(url, samples);
  }, [url, samples]);
  
  if (!waveformData) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-xs text-green-300/60">🎵</span>
      </div>
    );
  }
  
  return <MiniWaveformDisplay data={waveformData} width={width} height={height} color={color} />;
}

// ============================================
// 片段缩略图组件（带缓存和懒加载）
// ============================================

interface ClipThumbnailProps {
  clip: Clip;
  width: number;
  height: number;
}

export const ClipThumbnail = memo(function ClipThumbnail({ clip, width, height }: ClipThumbnailProps) {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInView, setIsInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 计算需要显示的缩略图数量 - 填满整个 clip 宽度
  const thumbnailCount = useMemo(() => {
    // 每个缩略图的理想宽度（基于视频宽高比，假设 16:9）
    const aspectRatio = 16 / 9;
    const idealThumbWidth = height * aspectRatio;
    // 计算能填满宽度需要多少个缩略图
    const count = Math.max(1, Math.ceil(width / idealThumbWidth));
    // 限制最大数量以提升性能，但允许更多以填满
    return Math.min(count, 20);
  }, [width, height]);
  
  // 懒加载：只有进入视口才开始生成
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '100px', // 提前 100px 开始加载
        threshold: 0,
      }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  
  // 生成缩略图（带缓存）
  useEffect(() => {
    if (!isInView || !clip.mediaUrl || clip.clipType !== 'video') {
      setIsLoading(false);
      return;
    }
    
    // 检查缓存
    const cached = getCachedThumbnails(clip.id, thumbnailCount);
    if (cached) {
      setThumbnails(cached);
      setIsLoading(false);
      return;
    }
    
    let isCancelled = false;
    const video = document.createElement('video');
    video.src = clip.mediaUrl;
    console.log('[Thumbnail] 🖼️ 开始加载视频缩略图:', {
      clipId: clip.id?.slice(-8),
      assetId: clip.assetId?.slice(-8),
      mediaUrl: clip.mediaUrl,
    });
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';
    video.muted = true; // 静音以避免自动播放限制
    
    const generateThumbnails = async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => {
            console.log('[Thumbnail] 视频元数据加载成功:', { clipId: clip.id.slice(-8), duration: video.duration, width: video.videoWidth, height: video.videoHeight });
            resolve();
          };
          video.onerror = (e) => {
            // 如果已取消，忽略错误（可能是清理函数清空了 src）
            if (isCancelled) {
              console.log('[Thumbnail] 已取消，忽略加载错误');
              return;
            }
            console.error('[Thumbnail] 视频加载失败:', { 
              clipId: clip.id.slice(-8), 
              mediaUrl: clip.mediaUrl,
              assetId: clip.assetId,
              error: e,
              networkState: video.networkState,
              readyState: video.readyState,
              errorCode: video.error?.code,
              errorMessage: video.error?.message
            });
            reject(e);
          };
          // 超时保护
          setTimeout(() => {
            if (!isCancelled) reject(new Error('Video load timeout'));
          }, 10000);
        });
        
        if (isCancelled) {
          console.log('[Thumbnail] 生成已取消 - 元数据加载后');
          return;
        }
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        // 使用更小的缩略图尺寸
        const thumbWidth = 80;
        const thumbHeight = Math.round(thumbWidth * (video.videoHeight / video.videoWidth)) || 45;
        canvas.width = thumbWidth;
        canvas.height = thumbHeight;
        
        const sourceStart = clip.sourceStart || 0;
        const interval = clip.duration / thumbnailCount;
        const newThumbnails: string[] = [];
        
        for (let i = 0; i < thumbnailCount; i++) {
          if (isCancelled) return;
          
          const time = sourceStart + (i + 0.5) * interval;
          video.currentTime = Math.min(time, video.duration - 0.1);
          
          await new Promise<void>((resolve) => {
            video.onseeked = () => resolve();
            // 超时保护
            setTimeout(resolve, 2000);
          });
          
          if (isCancelled) return;
          
          ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
          newThumbnails.push(canvas.toDataURL('image/jpeg', 0.5)); // 降低质量以减小内存占用
        }
        
        if (!isCancelled && newThumbnails.length > 0) {
          // 缓存结果
          setCachedThumbnails(clip.id, thumbnailCount, newThumbnails);
          setThumbnails(newThumbnails);
        }
      } catch (error) {
        // ★ 静默处理缩略图生成失败，使用渐变色作为后备
        if (process.env.NODE_ENV === 'development') {
          debugWarn('Failed to generate thumbnails:', error);
        }
        // 不设置缩略图，让 UI 显示渐变色后备
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };
    
    generateThumbnails();
    
    return () => {
      isCancelled = true;
      // 延迟清空 src，避免中断正在进行的异步操作
      setTimeout(() => {
        video.src = '';
        video.load();
      }, 100);
    };
  }, [clip.id, clip.mediaUrl, clip.clipType, clip.duration, clip.sourceStart, thumbnailCount, isInView]);
  
  // 视频片段：显示缩略图
  if (clip.clipType === 'video') {
    return (
      <div ref={containerRef} className="absolute inset-0 flex overflow-hidden rounded">
        {!isInView ? (
          // 未进入视口时显示占位符
          <div className="w-full h-full bg-black" />
        ) : isLoading ? (
          <div className="w-full h-full bg-black animate-pulse" />
        ) : thumbnails.length > 0 ? (
          thumbnails.map((thumb, i) => (
            <div
              key={i}
              className="h-full flex-shrink-0"
              style={{
                width: `${100 / thumbnailCount}%`,
                backgroundImage: `url(${thumb})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          ))
        ) : clip.thumbnail ? (
          <div
            className="w-full h-full"
            style={{
              backgroundImage: `url(${clip.thumbnail})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        ) : (
          <div className="w-full h-full bg-black" />
        )}
      </div>
    );
  }
  
  // 音频片段：显示波形（从 URL 异步加载）
  if (clip.clipType === 'audio') {
    return (
      <div className="absolute inset-0 overflow-hidden rounded bg-gradient-to-r from-green-900/50 to-green-700/50">
        {clip.waveformData ? (
          <MiniWaveformDisplay data={clip.waveformData} width={width} height={height} />
        ) : clip.mediaUrl ? (
          <AudioWaveformDisplay url={clip.mediaUrl} width={width} height={height} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-xs text-green-300/60">🎵 音频</span>
          </div>
        )}
      </div>
    );
  }
  
  // 文本片段：显示文本预览
  if (clip.clipType === 'text') {
    return (
      <div className="absolute inset-0 flex items-center overflow-hidden rounded bg-gradient-to-r from-gray-200 to-gray-100 px-2 border border-gray-300">
        <span className="text-xs text-gray-800 line-clamp-2 leading-tight">
          {clip.contentText || clip.name}
        </span>
      </div>
    );
  }
  
  // 字幕片段：显示字幕文本（黄色主题）
  if (clip.clipType === 'subtitle') {
    return (
      <div className="absolute inset-0 flex items-center overflow-hidden rounded bg-gradient-to-r from-yellow-200 to-yellow-100 px-2 border border-yellow-300">
        <span className="text-xs text-yellow-800 line-clamp-2 leading-tight font-medium">
          {clip.contentText || clip.name}
        </span>
      </div>
    );
  }
  
  return null;
});

// ============================================
// 时间线标尺组件
// ============================================

interface TimeRulerProps {
  duration: number;
  zoomLevel: number;
  currentTime: number;
  onTimeClick: (time: number) => void;
}

export function TimeRuler({ duration, zoomLevel, currentTime, onTimeClick }: TimeRulerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 根据缩放级别计算刻度间隔
  const { majorInterval, minorInterval, formatTime } = useMemo(() => {
    const pixelsPerSecond = TICK_WIDTH * zoomLevel;
    
    // 根据像素密度选择合适的时间间隔
    if (pixelsPerSecond >= 100) {
      return {
        majorInterval: 1,    // 1秒一个大刻度
        minorInterval: 0.1,  // 0.1秒一个小刻度
        formatTime: (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`,
      };
    } else if (pixelsPerSecond >= 40) {
      return {
        majorInterval: 5,
        minorInterval: 1,
        formatTime: (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      };
    } else if (pixelsPerSecond >= 15) {
      return {
        majorInterval: 10,
        minorInterval: 2,
        formatTime: (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      };
    } else {
      return {
        majorInterval: 30,
        minorInterval: 10,
        formatTime: (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
      };
    }
  }, [zoomLevel]);
  
  // 绘制标尺
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    
    const width = duration * TICK_WIDTH * zoomLevel + 200;
    const height = 28;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, width, height);
    
    // 背景
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);
    
    // 绘制刻度
    const pixelsPerSecond = TICK_WIDTH * zoomLevel;
    
    // 小刻度
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    
    for (let t = 0; t <= duration; t += minorInterval) {
      const x = t * pixelsPerSecond;
      ctx.beginPath();
      ctx.moveTo(x, height - 4);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    // 大刻度和时间标签
    ctx.strokeStyle = '#555';
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    
    for (let t = 0; t <= duration; t += majorInterval) {
      const x = t * pixelsPerSecond;
      
      // 刻度线
      ctx.beginPath();
      ctx.moveTo(x, height - 10);
      ctx.lineTo(x, height);
      ctx.stroke();
      
      // 时间标签
      ctx.fillText(formatTime(t), x, height - 14);
    }
    
    // 当前时间指示器
    const currentX = currentTime * pixelsPerSecond;
    ctx.fillStyle = '#DAFF01';
    ctx.beginPath();
    ctx.moveTo(currentX - 5, 0);
    ctx.lineTo(currentX + 5, 0);
    ctx.lineTo(currentX, 8);
    ctx.closePath();
    ctx.fill();
  }, [duration, zoomLevel, currentTime, majorInterval, minorInterval, formatTime]);
  
  // 点击跳转
  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (containerRef.current?.scrollLeft || 0);
    const time = x / (TICK_WIDTH * zoomLevel);
    onTimeClick(Math.max(0, Math.min(duration, time)));
  };
  
  return (
    <div
      ref={containerRef}
      className="overflow-x-auto cursor-pointer"
      onClick={handleClick}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

// ============================================
// 播放头组件
// ============================================

interface PlayheadProps {
  currentTime: number;
  zoomLevel: number;
  containerHeight: number;
}

export function Playhead({ currentTime, zoomLevel, containerHeight }: PlayheadProps) {
  const x = currentTime * TICK_WIDTH * zoomLevel;
  
  return (
    <div
      className="absolute top-0 pointer-events-none z-50"
      style={{
        left: x,
        height: containerHeight,
      }}
    >
      {/* 播放头顶部三角形 */}
      <div
        className="absolute -translate-x-1/2"
        style={{
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '8px solid #DAFF01',
        }}
      />
      {/* 播放头线 */}
      <div
        className="absolute top-2 w-0.5 bg-gray-700"
        style={{ height: containerHeight - 8, left: -1 }}
      />
    </div>
  );
}

// ============================================
// 磁吸指示器组件
// ============================================

interface SnapIndicatorProps {
  snapPoints: number[];
  zoomLevel: number;
  containerHeight: number;
}

export function SnapIndicator({ snapPoints, zoomLevel, containerHeight }: SnapIndicatorProps) {
  return (
    <>
      {snapPoints.map((point, i) => (
        <div
          key={i}
          className="absolute top-0 pointer-events-none z-40"
          style={{
            left: point * TICK_WIDTH * zoomLevel,
            height: containerHeight,
          }}
        >
          <div
            className="absolute top-0 w-px bg-yellow-400/50"
            style={{ height: containerHeight }}
          />
        </div>
      ))}
    </>
  );
}

// ============================================
// 选择框组件（框选多个片段）
// ============================================

interface SelectionBoxProps {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export function SelectionBox({ start, end }: SelectionBoxProps) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  
  return (
    <div
      className="absolute border border-gray-500 bg-gray-600/10 pointer-events-none z-50"
      style={{ left, top, width, height }}
    />
  );
}

// ============================================
// 轨道头部组件
// ============================================

interface TrackHeaderProps {
  trackId: string;
  trackName: string;
  trackLayer: number;
  color: string;
  isMuted?: boolean;
  isSolo?: boolean;
  isLocked?: boolean;
  onMuteToggle?: () => void;
  onSoloToggle?: () => void;
  onLockToggle?: () => void;
  onLayerChange?: (delta: number) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function TrackHeader({
  trackId,
  trackName,
  trackLayer,
  color,
  isMuted,
  isSolo,
  isLocked,
  onMuteToggle,
  onSoloToggle,
  onLockToggle,
  onLayerChange,
  onContextMenu,
}: TrackHeaderProps) {
  return (
    <div
      className="h-12 flex items-center px-2 border-b border-gray-200 bg-white group"
      onContextMenu={onContextMenu}
    >
      {/* 颜色标记 */}
      <div
        className="w-1 h-8 rounded-full mr-2"
        style={{ backgroundColor: color }}
      />
      
      {/* 轨道名称 */}
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium truncate">{trackName}</span>
        <span className="text-[10px] text-gray-500 ml-1">L{trackLayer}</span>
      </div>
      
      {/* 控制按钮 */}
      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onMuteToggle && (
          <button
            onClick={onMuteToggle}
            className={`w-6 h-6 rounded text-[10px] font-bold ${
              isMuted ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            M
          </button>
        )}
        {onSoloToggle && (
          <button
            onClick={onSoloToggle}
            className={`w-6 h-6 rounded text-[10px] font-bold ${
              isSolo ? 'bg-yellow-500 text-black' : 'bg-gray-100 text-gray-500'
            }`}
          >
            S
          </button>
        )}
        {onLockToggle && (
          <button
            onClick={onLockToggle}
            className={`w-6 h-6 rounded text-[10px] font-bold ${
              isLocked ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-500'
            }`}
          >
            🔒
          </button>
        )}
      </div>
    </div>
  );
}
