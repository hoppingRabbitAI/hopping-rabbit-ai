/**
 * B-Roll 视频预览组件
 * 
 * 基于编辑器 VideoPreviewPanel 的简化版本
 * 用于 WorkflowModal 中预览口播视频 + 字幕
 * 
 * ★ 核心设计：聚焦 B-Roll 片段预览
 * - 当选中某个 B-Roll 片段时，只显示该片段的时间范围
 * - 进度条和时间显示都限制在当前片段范围内
 * - 播放到片段结束时自动停止
 * 
 * 特点：
 * - 保持正确的视频宽高比（竖屏 9:16）
 * - 支持 HLS 和普通视频
 * - 字幕叠加显示
 * - 简洁的播放控制
 */
'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import Hls from 'hls.js';

// 调试开关
const DEBUG = false;
const log = (...args: unknown[]) => { if (DEBUG) console.log('[BRollVideoPreview]', ...args); };

// ============================================
// 类型定义
// ============================================

export interface BRollClip {
  clipId: string;
  clipNumber: number;
  text: string;
  timeRange: { start: number; end: number };
  selectedAssetId?: string;
  brollUrl?: string;
}

export interface SubtitleSegment {
  id: string;
  text: string;
  start: number; // ms
  end: number;   // ms
}

export interface BRollVideoPreviewProps {
  /** 视频 URL */
  videoUrl: string;
  /** 视频总时长（毫秒） */
  duration: number;
  /** 字幕列表 */
  subtitles?: SubtitleSegment[];
  /** B-Roll 片段列表（用于显示标记） */
  clips?: BRollClip[];
  /** 当前选中的片段 ID */
  activeClipId?: string;
  /** 点击片段回调 */
  onClipClick?: (clipId: string) => void;
  /** 时间变化回调 */
  onTimeChange?: (timeMs: number) => void;
  /** 播放状态变化回调 */
  onPlayingChange?: (playing: boolean) => void;
  /** 容器类名 */
  className?: string;
}

// 毫秒转秒
const msToSec = (ms: number) => ms / 1000;
// 秒转毫秒
const secToMs = (sec: number) => sec * 1000;

// ============================================
// 主组件
// ============================================

export function BRollVideoPreview({
  videoUrl,
  duration,
  subtitles = [],
  clips = [],
  activeClipId,
  onClipClick,
  onTimeChange,
  onPlayingChange,
  className = '',
}: BRollVideoPreviewProps) {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const animationRef = useRef<number | null>(null);
  
  // State
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  
  // 判断是否是 HLS
  const isHlsUrl = videoUrl?.includes('.m3u8');
  
  // 当前显示的字幕
  const currentSubtitle = useMemo(() => {
    return subtitles.find(sub => 
      currentTimeMs >= sub.start && currentTimeMs < sub.end
    );
  }, [subtitles, currentTimeMs]);
  
  // 当前时间所在的片段
  const currentClip = useMemo(() => {
    return clips.find(clip =>
      currentTimeMs >= clip.timeRange.start && currentTimeMs < clip.timeRange.end
    );
  }, [clips, currentTimeMs]);
  
  // ★ 当前激活的片段（用于聚焦模式）
  const activeClip = useMemo(() => {
    return clips.find(clip => clip.clipId === activeClipId);
  }, [clips, activeClipId]);
  
  // ★ 是否处于聚焦模式（选中了某个 B-Roll 片段）
  const isFocusMode = !!activeClip;
  
  // ★ 聚焦模式下的时间范围
  const focusRange = useMemo(() => {
    if (!activeClip) return { start: 0, end: duration };
    return activeClip.timeRange;
  }, [activeClip, duration]);
  
  // ★ 聚焦模式下的时长
  const focusDuration = focusRange.end - focusRange.start;
  
  // ★ 聚焦模式下的当前时间（相对于片段开始）
  const focusCurrentTime = isFocusMode 
    ? Math.max(0, currentTimeMs - focusRange.start) 
    : currentTimeMs;
  
  // 计算画布尺寸（保持 9:16 比例）
  const canvasStyle = useMemo(() => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return { width: '100%', height: '100%' };
    }
    
    // 默认 9:16 竖屏比例
    const targetRatio = 9 / 16;
    
    let width: number, height: number;
    
    // 根据容器尺寸计算
    if (containerSize.width / containerSize.height > targetRatio) {
      // 容器更宽，以高度为准
      height = containerSize.height;
      width = height * targetRatio;
    } else {
      // 容器更高，以宽度为准
      width = containerSize.width;
      height = width / targetRatio;
    }
    
    return {
      width: Math.round(width),
      height: Math.round(height),
    };
  }, [containerSize]);
  
  // 监听容器尺寸变化
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const updateSize = () => {
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };
    
    // 初始尺寸
    updateSize();
    
    // 监听 resize
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    
    return () => resizeObserver.disconnect();
  }, []);
  
  // ============================================
  // 视频初始化
  // ============================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !videoUrl) return;
    
    log('初始化视频:', videoUrl.slice(-50));
    
    // 清理旧的 HLS 实例
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    
    setIsVideoReady(false);
    setCurrentTimeMs(0);
    
    // 创建视频元素
    const video = document.createElement('video');
    video.style.cssText = 'width: 100%; height: 100%; object-fit: contain; background: #000;';
    video.playsInline = true;
    video.muted = isMuted;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    
    // 清空容器并添加视频
    const videoWrapper = container.querySelector('.video-wrapper');
    if (videoWrapper) {
      videoWrapper.innerHTML = '';
      videoWrapper.appendChild(video);
    }
    videoRef.current = video;
    
    // 视频就绪处理
    const handleCanPlay = () => {
      log('视频就绪, readyState:', video.readyState, 'size:', video.videoWidth, 'x', video.videoHeight);
      setIsVideoReady(true);
    };
    
    const handleWaiting = () => {
      log('缓冲中...');
      setIsBuffering(true);
    };
    
    const handlePlaying = () => {
      log('播放恢复');
      setIsBuffering(false);
    };
    
    const handleTimeUpdate = () => {
      const timeMs = secToMs(video.currentTime);
      setCurrentTimeMs(timeMs);
      onTimeChange?.(timeMs);
    };
    
    const handleEnded = () => {
      setIsPlaying(false);
      onPlayingChange?.(false);
    };
    
    // 绑定事件
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    
    // 加载视频
    if (isHlsUrl && Hls.isSupported()) {
      log('使用 HLS.js 加载');
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      
      hls.loadSource(videoUrl);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error('[BRollVideoPreview] HLS 错误:', data);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生 HLS
      log('Safari 原生 HLS');
      video.src = videoUrl;
    } else {
      // 普通视频
      log('普通视频加载');
      video.src = videoUrl;
    }
    
    // 清理
    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      
      video.pause();
      video.src = '';
    };
  }, [videoUrl, isHlsUrl]);
  
  // 同步静音状态
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);
  
  // ============================================
  // 播放控制
  // ============================================
  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !isVideoReady) return;
    
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      onPlayingChange?.(false);
    } else {
      // ★ 聚焦模式下，如果当前时间不在片段范围内，先跳转到片段开始
      if (isFocusMode && activeClip) {
        if (currentTimeMs < activeClip.timeRange.start || currentTimeMs >= activeClip.timeRange.end) {
          video.currentTime = msToSec(activeClip.timeRange.start);
        }
      }
      try {
        await video.play();
        setIsPlaying(true);
        onPlayingChange?.(true);
      } catch (err) {
        console.error('[BRollVideoPreview] 播放失败:', err);
      }
    }
  }, [isPlaying, isVideoReady, onPlayingChange, isFocusMode, activeClip, currentTimeMs]);
  
  // ★ 聚焦模式下，播放到片段结束时自动停止
  useEffect(() => {
    if (!isFocusMode || !isPlaying || !activeClip) return;
    
    const video = videoRef.current;
    if (!video) return;
    
    // 如果当前时间超过片段结束时间，停止播放
    if (currentTimeMs >= activeClip.timeRange.end) {
      video.pause();
      setIsPlaying(false);
      onPlayingChange?.(false);
      // 跳回片段开始
      video.currentTime = msToSec(activeClip.timeRange.start);
    }
  }, [isFocusMode, isPlaying, activeClip, currentTimeMs, onPlayingChange]);
  
  // ★ 当选中新片段时，自动跳转到该片段开始
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    
    // 跳转到片段开始
    video.currentTime = msToSec(activeClip.timeRange.start);
    setCurrentTimeMs(activeClip.timeRange.start);
    onTimeChange?.(activeClip.timeRange.start);
  }, [activeClipId]); // 只依赖 activeClipId 变化
  
  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);
  
  // 跳转到指定片段
  const seekToClip = useCallback((clip: BRollClip) => {
    const video = videoRef.current;
    if (!video) return;
    
    video.currentTime = msToSec(clip.timeRange.start);
    onClipClick?.(clip.clipId);
  }, [onClipClick]);
  
  // ★ 进度条点击 - 聚焦模式下只在片段范围内跳转
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    
    let targetTimeMs: number;
    if (isFocusMode) {
      // 聚焦模式：在片段范围内跳转
      targetTimeMs = focusRange.start + percentage * focusDuration;
    } else {
      // 完整模式：在完整视频范围内跳转
      targetTimeMs = percentage * duration;
    }
    
    video.currentTime = msToSec(targetTimeMs);
    setCurrentTimeMs(targetTimeMs);
    onTimeChange?.(targetTimeMs);
  }, [duration, onTimeChange, isFocusMode, focusRange, focusDuration]);
  
  // 格式化时间
  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };
  
  // ★ 格式化时间（秒，保留1位小数）
  const formatTimeSec = (ms: number) => {
    return `${(ms / 1000).toFixed(1)}s`;
  };
  
  // ★ 进度百分比 - 聚焦模式下基于片段范围计算
  const progressPercent = useMemo(() => {
    if (isFocusMode && focusDuration > 0) {
      return (focusCurrentTime / focusDuration) * 100;
    }
    return duration > 0 ? (currentTimeMs / duration) * 100 : 0;
  }, [isFocusMode, focusCurrentTime, focusDuration, currentTimeMs, duration]);
  
  // ★ 退出聚焦模式（查看完整视频）
  const exitFocusMode = useCallback(() => {
    onClipClick?.(''); // 清除选中
  }, [onClipClick]);
  
  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 视频预览区域 */}
      <div 
        ref={containerRef}
        className="flex-1 relative flex items-center justify-center bg-black overflow-hidden"
      >
        {/* 视频容器 - 保持宽高比 */}
        <div 
          className="video-wrapper relative bg-black rounded-lg overflow-hidden shadow-2xl"
          style={{
            width: canvasStyle.width || '100%',
            height: canvasStyle.height || '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: '9 / 16',
          }}
        >
          {/* 视频元素通过 JS 动态插入 */}
        </div>
        
        {/* 加载中 */}
        {!isVideoReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
            <div className="text-center space-y-3">
              <RabbitLoader size={48} />
              <p className="text-sm text-gray-400">视频加载中...</p>
            </div>
          </div>
        )}
        
        {/* 缓冲中 */}
        {isVideoReady && isBuffering && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10 pointer-events-none">
            <RabbitLoader size={32} />
          </div>
        )}
        
        {/* 字幕叠加 */}
        {currentSubtitle && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div className="px-4 py-2 bg-black/70 rounded-lg max-w-[80%] text-center">
              <p className="text-white text-sm leading-relaxed">
                {currentSubtitle.text}
              </p>
            </div>
          </div>
        )}
        
        {/* 播放按钮覆盖 */}
        {isVideoReady && !isPlaying && !isBuffering && (
          <div 
            className="absolute inset-0 flex items-center justify-center z-10 cursor-pointer bg-black/20 hover:bg-black/30 transition-colors"
            onClick={togglePlay}
          >
            <div className="w-16 h-16 rounded-full bg-white/30 backdrop-blur-sm flex items-center justify-center hover:bg-white/40 transition-colors">
              <Play size={32} className="text-white ml-1" />
            </div>
          </div>
        )}
        
        {/* 当前片段指示 */}
        {currentClip && activeClipId === currentClip.clipId && (
          <div className="absolute top-3 left-3 z-20">
            <div className="px-2 py-1 bg-purple-600 text-white text-xs rounded">
              SLOT {currentClip.clipNumber}
            </div>
          </div>
        )}
      </div>
      
      {/* 控制栏 */}
      <div className="bg-gray-900 px-4 py-3 space-y-2">
        {/* ★ 聚焦模式标题栏 */}
        {isFocusMode && activeClip && (
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded">
                B-ROLL {activeClip.clipNumber}
              </span>
              <span className="text-xs text-gray-400">
                {formatTimeSec(activeClip.timeRange.start)} - {formatTimeSec(activeClip.timeRange.end)}
              </span>
            </div>
            <button
              onClick={exitFocusMode}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            >
              <Maximize2 size={12} />
              查看完整
            </button>
          </div>
        )}
        
        {/* 进度条 */}
        <div 
          className="relative h-2 bg-gray-700 rounded-full cursor-pointer group"
          onClick={handleProgressClick}
        >
          {/* 已播放进度 */}
          <div 
            className="absolute h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
          
          {/* ★ 非聚焦模式：显示所有片段标记 */}
          {!isFocusMode && clips.map(clip => {
            const startPercent = (clip.timeRange.start / duration) * 100;
            const widthPercent = ((clip.timeRange.end - clip.timeRange.start) / duration) * 100;
            const isActive = activeClipId === clip.clipId;
            
            return (
              <div
                key={clip.clipId}
                className={`absolute top-0 h-full rounded-full transition-colors ${
                  isActive ? 'bg-blue-400/60' : 'bg-blue-600/30'
                } hover:bg-blue-400/50`}
                style={{
                  left: `${startPercent}%`,
                  width: `${widthPercent}%`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  seekToClip(clip);
                }}
              />
            );
          })}
          
          {/* 播放头 */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg transition-all"
            style={{ left: `calc(${progressPercent}% - 6px)` }}
          />
        </div>
        
        {/* 控制按钮和时间 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* 播放/暂停 */}
            <button 
              onClick={togglePlay}
              className="p-2 rounded-full hover:bg-gray-800 transition-colors"
              disabled={!isVideoReady}
            >
              {isPlaying ? (
                <Pause size={20} className="text-white" />
              ) : (
                <Play size={20} className="text-white" />
              )}
            </button>
            
            {/* 静音 */}
            <button 
              onClick={toggleMute}
              className="p-2 rounded-full hover:bg-gray-800 transition-colors"
            >
              {isMuted ? (
                <VolumeX size={18} className="text-gray-400" />
              ) : (
                <Volume2 size={18} className="text-white" />
              )}
            </button>
            
            {/* ★ 时间显示 - 聚焦模式显示片段时间，否则显示完整时间 */}
            {isFocusMode ? (
              <span className="text-sm text-blue-400 font-mono">
                {formatTimeSec(focusCurrentTime)} / {formatTimeSec(focusDuration)}
              </span>
            ) : (
              <span className="text-sm text-gray-400 font-mono">
                {formatTime(currentTimeMs)} / {formatTime(duration)}
              </span>
            )}
          </div>
          
          {/* ★ 非聚焦模式：显示当前片段信息 */}
          {!isFocusMode && currentClip && (
            <div className="text-xs text-gray-500">
              B-ROLL {currentClip.clipNumber}: {currentClip.text.slice(0, 20)}...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BRollVideoPreview;
