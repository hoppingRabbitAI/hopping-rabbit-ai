/**
 * V2 Remotion 配置预览播放器
 * 
 * 用于预览 LLM 生成的 Remotion 配置效果
 * 支持文字动画、B-Roll、章节标题的实时预览
 * 支持 B-Roll 聚焦模式（选中片段时只显示该片段的时间范围）
 */
'use client';

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { Play, Pause, Eye } from 'lucide-react';
import { RemotionConfigComposition, RemotionConfigCompositionPropsSchema } from '../compositions/RemotionConfigComposition';
import type {
  RemotionConfig,
  PipConfig,
  TextComponent,
  BRollComponent,
  ChapterComponent,
} from '../compositions/RemotionConfigComposition';

// ============================================
// 工具函数
// ============================================

// 格式化秒数为 "0.0s" 格式
function formatTimeSec(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  return `${seconds.toFixed(1)}s`;
}

// 格式化毫秒为 "0:00" 格式
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ============================================
// 类型定义
// ============================================

export interface RemotionConfigPreviewProps {
  // 源视频
  mainVideoUrl: string;
  
  // Remotion 配置
  config: {
    version?: string;
    total_duration_ms: number;
    fps?: number;
    theme?: string;
    color_palette?: string[];
    font_family?: string;
    text_components?: Array<{
      id: string;
      type: 'text';
      start_ms: number;
      end_ms: number;
      text: string;
      animation: string;
      position: string;
      style: {
        fontSize: number;
        color: string;
        fontWeight?: string;
        backgroundColor?: string;
      };
    }>;
    broll_components?: Array<{
      id: string;
      type: 'broll';
      start_ms: number;
      end_ms: number;
      search_keywords: string[];
      display_mode: string;
      transition_in: string;
      transition_out: string;
      asset_url?: string;
      asset_id?: string;
    }>;
    chapter_components?: Array<{
      id: string;
      type: 'chapter';
      start_ms: number;
      end_ms: number;
      title: string;
      subtitle?: string;
      style: string;
    }>;
  };
  
  // 画中画配置
  pipEnabled?: boolean;
  pipPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  pipSize?: 'small' | 'medium' | 'large';
  
  // 视频尺寸
  width?: number;
  height?: number;
  
  // 播放控制
  currentTime?: number; // ms
  isPlaying?: boolean;
  onTimeChange?: (timeMs: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  
  // ★ B-Roll 聚焦模式
  activeClipId?: string; // 当前选中的 B-Roll 片段 ID
  onClipClick?: (clipId: string | null) => void; // 点击片段回调
  
  // 样式
  className?: string;
  style?: React.CSSProperties;
}

// ============================================
// 调试日志
// ============================================
const DEBUG = true;
function log(...args: unknown[]) {
  if (DEBUG) {
    console.log('[RemotionConfigPreview]', ...args);
  }
}

// ============================================
// 主组件
// ============================================

export function RemotionConfigPreview({
  mainVideoUrl,
  config,
  pipEnabled = true,
  pipPosition = 'bottom-right',
  pipSize = 'medium',
  width = 1080,
  height = 1920,
  currentTime = 0,
  isPlaying = false,
  onTimeChange,
  onPlayingChange,
  activeClipId,
  onClipClick,
  className,
  style,
}: RemotionConfigPreviewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const lastSyncedTimeRef = useRef(currentTime);
  const [isReady, setIsReady] = useState(false);
  const [internalTime, setInternalTime] = useState(currentTime);
  const [internalPlaying, setInternalPlaying] = useState(isPlaying);
  
  // 配置
  const fps = config.fps || 30;
  const duration = config.total_duration_ms;
  const durationInFrames = useMemo(() => {
    return Math.max(1, Math.ceil((duration / 1000) * fps));
  }, [duration, fps]);
  
  // ★ 聚焦模式：当前选中的 B-Roll 片段
  const activeClip = useMemo(() => {
    if (!activeClipId || !config.broll_components) return null;
    return config.broll_components.find(b => b.id === activeClipId) || null;
  }, [activeClipId, config.broll_components]);
  
  // ★ 是否处于聚焦模式
  const isFocusMode = !!activeClip;
  
  // ★ 聚焦模式下的时间范围
  const focusRange = useMemo(() => {
    if (!activeClip) return { start: 0, end: duration };
    return { start: activeClip.start_ms, end: activeClip.end_ms };
  }, [activeClip, duration]);
  
  // ★ 聚焦模式下的时长
  const focusDuration = focusRange.end - focusRange.start;
  
  // ★ 聚焦模式下的当前时间（相对于片段开始）
  const focusCurrentTime = isFocusMode 
    ? Math.max(0, Math.min(internalTime - focusRange.start, focusDuration))
    : internalTime;
  
  // 规范化配置
  const normalizedConfig: RemotionConfig = useMemo(() => ({
    version: config.version || '1.0',
    total_duration_ms: duration,
    fps,
    theme: (config.theme as 'minimalist' | 'dynamic' | 'cinematic' | 'vlog') || 'minimalist',
    color_palette: config.color_palette || ['#ffffff', '#888888', '#333333'],
    font_family: config.font_family || 'Inter',
    text_components: (config.text_components || []).map(t => ({
      ...t,
      animation: t.animation as TextComponent['animation'],
      position: t.position as TextComponent['position'],
    })),
    broll_components: (config.broll_components || []).map(b => ({
      ...b,
      display_mode: b.display_mode as BRollComponent['display_mode'],
      transition_in: b.transition_in as BRollComponent['transition_in'],
      transition_out: b.transition_out as BRollComponent['transition_out'],
    })),
    chapter_components: (config.chapter_components || []).map(c => ({
      ...c,
      style: c.style as ChapterComponent['style'],
    })),
  }), [config, duration, fps]);
  
  // PiP 配置
  const pipConfig: PipConfig = useMemo(() => ({
    enabled: pipEnabled,
    position: pipPosition,
    size: pipSize,
  }), [pipEnabled, pipPosition, pipSize]);
  
  // 日志
  useEffect(() => {
    log('🎬 组件挂载', {
      mainVideoUrl: mainVideoUrl?.slice(0, 50) + '...',
      duration,
      fps,
      durationInFrames,
      textComponents: normalizedConfig.text_components.length,
      brollComponents: normalizedConfig.broll_components.length,
      chapterComponents: normalizedConfig.chapter_components.length,
    });
    return () => log('🛑 组件卸载');
  }, []);
  
  // ★ 当选中新片段时，自动跳转到该片段开始
  useEffect(() => {
    if (!playerRef.current || !activeClip) return;
    
    // 等待 player 准备好再跳转
    const seekToClip = () => {
      if (!playerRef.current) return;
      const frame = Math.floor((activeClip.start_ms / 1000) * fps);
      log('🎯 跳转到片段:', activeClip.id, 'frame:', frame, 'time:', activeClip.start_ms);
      playerRef.current.seekTo(frame);
      setInternalTime(activeClip.start_ms);
      lastSyncedTimeRef.current = activeClip.start_ms;
      onTimeChange?.(activeClip.start_ms);
    };
    
    // 立即尝试跳转
    seekToClip();
    
    // 如果 player 还没 ready，延迟再试
    if (!isReady) {
      const timer = setTimeout(seekToClip, 100);
      return () => clearTimeout(timer);
    }
  }, [activeClipId, isReady]); // 依赖 activeClipId 和 isReady
  
  // ★ 聚焦模式下，播放到片段结束时自动停止
  useEffect(() => {
    if (!isFocusMode || !internalPlaying || !activeClip || !playerRef.current) return;
    
    if (internalTime >= activeClip.end_ms) {
      playerRef.current.pause();
      setInternalPlaying(false);
      onPlayingChange?.(false);
      // 跳回片段开始
      const frame = Math.floor((activeClip.start_ms / 1000) * fps);
      playerRef.current.seekTo(frame);
      setInternalTime(activeClip.start_ms);
      log('🛑 片段播放结束，跳回开始');
    }
  }, [isFocusMode, internalPlaying, activeClip, internalTime, fps, onPlayingChange]);
  
  // 同步外部 currentTime 到 Player
  useEffect(() => {
    if (!playerRef.current || !isReady) return;
    
    const diff = Math.abs(currentTime - lastSyncedTimeRef.current);
    if (diff > 100) {
      const frame = Math.floor((currentTime / 1000) * fps);
      playerRef.current.seekTo(frame);
      lastSyncedTimeRef.current = currentTime;
    }
  }, [currentTime, fps, isReady]);
  
  // 同步播放状态
  useEffect(() => {
    if (!playerRef.current || !isReady) return;
    
    if (isPlaying) {
      playerRef.current.play();
    } else {
      playerRef.current.pause();
    }
    setInternalPlaying(isPlaying);
  }, [isPlaying, isReady]);
  
  // 处理时间变化
  const handleTimeUpdate = useCallback((e: { frame: number }) => {
    const timeMs = (e.frame / fps) * 1000;
    lastSyncedTimeRef.current = timeMs;
    setInternalTime(timeMs);
    onTimeChange?.(timeMs);
    
    // ★ 第一次触发时标记为 ready
    if (!isReady) {
      setIsReady(true);
      log('✅ Player ready');
    }
  }, [fps, onTimeChange, isReady]);
  
  // 处理播放状态变化
  const handlePlay = useCallback(() => {
    setInternalPlaying(true);
    onPlayingChange?.(true);
  }, [onPlayingChange]);
  
  const handlePause = useCallback(() => {
    setInternalPlaying(false);
    onPlayingChange?.(false);
  }, [onPlayingChange]);
  
  const handleEnded = useCallback(() => {
    setInternalPlaying(false);
    onPlayingChange?.(false);
  }, [onPlayingChange]);
  
  // ★ 退出聚焦模式
  const exitFocusMode = useCallback(() => {
    onClipClick?.(null);
  }, [onClipClick]);
  
  // ★ 聚焦模式下的播放/暂停切换
  const togglePlay = useCallback(() => {
    if (!playerRef.current) return;
    
    if (internalPlaying) {
      playerRef.current.pause();
      setInternalPlaying(false);
      onPlayingChange?.(false);
    } else {
      // 如果已经到了片段结尾，先跳到片段开头
      if (isFocusMode && activeClip && internalTime >= activeClip.end_ms) {
        const frame = Math.floor((activeClip.start_ms / 1000) * fps);
        playerRef.current.seekTo(frame);
        setInternalTime(activeClip.start_ms);
      }
      playerRef.current.play();
      setInternalPlaying(true);
      onPlayingChange?.(true);
    }
  }, [internalPlaying, isFocusMode, activeClip, internalTime, fps, onPlayingChange]);
  
  // ★ 聚焦模式下的进度条点击
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerRef.current || !isFocusMode) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    
    const targetTimeMs = focusRange.start + percentage * focusDuration;
    const frame = Math.floor((targetTimeMs / 1000) * fps);
    playerRef.current.seekTo(frame);
    setInternalTime(targetTimeMs);
    onTimeChange?.(targetTimeMs);
  }, [isFocusMode, focusRange, focusDuration, fps, onTimeChange]);
  
  // ★ 聚焦模式下的进度百分比
  const progressPercent = isFocusMode
    ? Math.min(100, Math.max(0, (focusCurrentTime / focusDuration) * 100))
    : 0;
  
  // 错误处理
  const handleError = useCallback((error: Error) => {
    console.error('[RemotionConfigPreview] 播放错误:', error);
  }, []);
  
  if (!mainVideoUrl) {
    return (
      <div
        className={className}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
          color: '#666',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
          <p>等待视频加载...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div
      className={className}
      style={{
        ...style,
        position: 'relative',
        backgroundColor: '#000',
        overflow: 'hidden',
      }}
    >
      {/* Remotion Player - 聚焦模式下隐藏原生控制条 */}
      <Player
        ref={playerRef}
        component={RemotionConfigComposition}
        schema={RemotionConfigCompositionPropsSchema}
        inputProps={{
          mainVideoUrl,
          config: normalizedConfig,
          pip: pipConfig,
          width,
          height,
        }}
        durationInFrames={durationInFrames}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        style={{
          width: '100%',
          height: '100%',
        }}
        controls={!isFocusMode}
        autoPlay={false}
        loop={false}
        showVolumeControls={!isFocusMode}
        clickToPlay={!isFocusMode}
        doubleClickToFullscreen
        spaceKeyToPlayOrPause
        // @ts-expect-error - Remotion Player event types
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={handleError}
        renderLoading={() => (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#000',
              color: '#fff',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  border: '3px solid #333',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto 16px',
                }}
              />
              <p>加载中...</p>
            </div>
          </div>
        )}
      />
      
      {/* ★ 聚焦模式覆盖层 - 显示片段时间信息 */}
      {isFocusMode && activeClip && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '8px 12px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pointerEvents: 'auto',
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                padding: '2px 8px',
                backgroundColor: '#3b82f6',
                color: 'white',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              B-ROLL {(config.broll_components?.findIndex(b => b.id === activeClipId) ?? 0) + 1}
            </span>
            <span style={{ color: '#93c5fd', fontSize: 12, fontFamily: 'monospace' }}>
              {formatTimeSec(focusCurrentTime)} / {formatTimeSec(focusDuration)}
            </span>
            <span style={{ color: '#6b7280', fontSize: 11 }}>
              ({formatTimeSec(focusRange.start)} - {formatTimeSec(focusRange.end)})
            </span>
          </div>
          <button
            onClick={exitFocusMode}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              backgroundColor: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              fontSize: 11,
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            <Eye size={14} />
            查看完整
          </button>
        </div>
      )}
      
      {/* 配置信息角标 */}
      <div
        style={{
          position: 'absolute',
          top: isFocusMode ? 48 : 10,
          right: 10,
          padding: '4px 8px',
          backgroundColor: 'rgba(0,0,0,0.6)',
          borderRadius: 4,
          fontSize: 10,
          color: '#fff',
          transition: 'top 0.2s ease',
        }}
      >
        {normalizedConfig.text_components.length} 文字 · {normalizedConfig.broll_components.length} B-Roll
      </div>
      
      {/* ★ 聚焦模式底部控制条 - 绝对定位不影响布局 */}
      {isFocusMode && activeClip && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '12px 16px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.7) 70%, transparent 100%)',
            zIndex: 10,
          }}
        >
          {/* 进度条 */}
          <div
            onClick={handleProgressClick}
            style={{
              height: 4,
              backgroundColor: 'rgba(255, 255, 255, 0.3)',
              borderRadius: 2,
              cursor: 'pointer',
              marginBottom: 10,
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: '100%',
                width: `${progressPercent}%`,
                backgroundColor: '#3b82f6',
                borderRadius: 2,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: `calc(${progressPercent}% - 5px)`,
                transform: 'translateY(-50%)',
                width: 10,
                height: 10,
                backgroundColor: '#fff',
                borderRadius: '50%',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
            />
          </div>
          
          {/* 控制按钮和时间 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={togglePlay}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: '50%',
                cursor: 'pointer',
                color: '#fff',
              }}
            >
              {internalPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            
            <span style={{ fontSize: 13, color: '#60a5fa', fontFamily: 'monospace' }}>
              {formatTimeSec(focusCurrentTime)} / {formatTimeSec(focusDuration)}
            </span>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default RemotionConfigPreview;
