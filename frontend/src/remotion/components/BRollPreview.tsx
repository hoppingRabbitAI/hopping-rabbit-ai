/**
 * B-Roll 预览播放器组件
 * 
 * 用于在 WorkflowModal 的 broll_config 步骤中预览
 * 口播视频 + B-Roll + 字幕的合成效果
 */
'use client';

import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { BRollComposition } from '../compositions/BRollComposition';
import type { BRollCompositionProps, BRollClip, Subtitle, PipConfig } from '../compositions/BRollComposition';

// ============================================
// 类型定义
// ============================================

export interface BRollPreviewClip {
  clipId: string;
  clipNumber: number;
  text: string;
  timeRange: { start: number; end: number };
  selectedAssetId?: string;
  brollUrl?: string;
  brollThumbnail?: string;
  source?: 'pexels' | 'local' | 'ai-generated';
}

export interface BRollPreviewSubtitle {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface BRollPreviewProps {
  // 源视频
  mainVideoUrl: string;
  
  // B-Roll 配置
  clips: BRollPreviewClip[];
  
  // 字幕（可选）
  subtitles?: BRollPreviewSubtitle[];
  
  // 画中画配置
  pipEnabled?: boolean;
  pipPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  pipSize?: 'small' | 'medium' | 'large';
  
  // 视频配置
  duration: number; // ms
  width?: number;
  height?: number;
  fps?: number;
  
  // 播放控制
  currentTime?: number; // ms
  isPlaying?: boolean;
  onTimeChange?: (timeMs: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  
  // 当前选中的片段（高亮显示）
  activeClipId?: string;
  onClipClick?: (clipId: string) => void;
  
  // 样式
  className?: string;
  style?: React.CSSProperties;
  
  // 字幕样式
  subtitleStyle?: {
    fontSize?: number;
    fontColor?: string;
    backgroundColor?: string;
  };
}

// ============================================
// 主组件
// ============================================

// 调试日志
const DEBUG = true;
function log(...args: unknown[]) {
  if (DEBUG) {
    console.log('[BRollPreview]', ...args);
  }
}

export function BRollPreview({
  mainVideoUrl,
  clips,
  subtitles = [],
  pipEnabled = true,
  pipPosition = 'bottom-right',
  pipSize = 'medium',
  duration,
  width = 1080,
  height = 1920,
  fps = 30,
  currentTime = 0,
  isPlaying = false,
  onTimeChange,
  onPlayingChange,
  activeClipId,
  onClipClick,
  className,
  style,
  subtitleStyle,
}: BRollPreviewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const lastSyncedTimeRef = useRef(currentTime);
  const [isReady, setIsReady] = useState(false);
  
  // ★ 详细日志：组件挂载
  useEffect(() => {
    log('🎬 组件挂载', {
      mainVideoUrl: mainVideoUrl?.slice(0, 50) + '...',
      clipsCount: clips.length,
      duration,
      width,
      height,
      fps,
    });
    return () => log('🛑 组件卸载');
  }, []);
  
  // ★ 详细日志：props 变化
  useEffect(() => {
    log('📦 Props 更新', {
      mainVideoUrl: !!mainVideoUrl,
      clipsCount: clips.length,
      clipsWithBroll: clips.filter(c => c.brollUrl).length,
      subtitlesCount: subtitles.length,
      pipEnabled,
      duration,
    });
  }, [mainVideoUrl, clips, subtitles, pipEnabled, duration]);
  
  // 计算总帧数
  const durationInFrames = useMemo(() => {
    const frames = Math.max(1, Math.ceil((duration / 1000) * fps));
    log('⏱️ 计算帧数:', { duration, fps, durationInFrames: frames });
    return frames;
  }, [duration, fps]);
  
  // 转换 clips 为 Remotion 格式
  const brollClips: BRollClip[] = useMemo(() => {
    return clips.map(clip => ({
      id: clip.clipId,
      clipNumber: clip.clipNumber,
      text: clip.text,
      timeRange: clip.timeRange,
      brollUrl: clip.brollUrl,
      brollThumbnail: clip.brollThumbnail,
      source: clip.source,
    }));
  }, [clips]);
  
  // 转换字幕
  const remotionSubtitles: Subtitle[] = useMemo(() => {
    return subtitles.map(s => ({
      id: s.id,
      text: s.text,
      start: s.start,
      end: s.end,
    }));
  }, [subtitles]);
  
  // PiP 配置
  const pipConfig: PipConfig = useMemo(() => ({
    enabled: pipEnabled,
    position: pipPosition,
    size: pipSize,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ffffff',
  }), [pipEnabled, pipPosition, pipSize]);
  
  // 构建合成 props
  const compositionProps: BRollCompositionProps = useMemo(() => ({
    mainVideoUrl,
    brollClips,
    subtitles: remotionSubtitles,
    pip: pipConfig,
    duration,
    width,
    height,
    fps,
    backgroundColor: '#000000',
    subtitleStyle: subtitleStyle ? {
      fontSize: subtitleStyle.fontSize,
      fontColor: subtitleStyle.fontColor,
      backgroundColor: subtitleStyle.backgroundColor,
    } : undefined,
  }), [mainVideoUrl, brollClips, remotionSubtitles, pipConfig, duration, width, height, fps, subtitleStyle]);
  
  // 同步外部 currentTime 到 Player
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isReady) return;
    
    // 避免循环更新
    const timeDiff = Math.abs(currentTime - lastSyncedTimeRef.current);
    if (timeDiff < 100) return; // 100ms 容差
    
    const targetFrame = Math.round((currentTime / 1000) * fps);
    player.seekTo(targetFrame);
    lastSyncedTimeRef.current = currentTime;
  }, [currentTime, fps, isReady]);
  
  // 同步播放状态
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isReady) return;
    
    if (isPlaying) {
      player.play();
    } else {
      player.pause();
    }
  }, [isPlaying, isReady]);
  
  // 处理帧变化
  const handleFrameChange = useCallback((frame: number) => {
    const timeMs = (frame / fps) * 1000;
    lastSyncedTimeRef.current = timeMs;
    onTimeChange?.(timeMs);
  }, [fps, onTimeChange]);
  
  // 处理播放状态变化
  const handlePlayingChange = useCallback((playing: boolean) => {
    onPlayingChange?.(playing);
  }, [onPlayingChange]);
  
  // 轮询同步状态
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    
    let lastFrame = -1;
    let wasPlaying = false;
    
    const interval = setInterval(() => {
      if (!player) return;
      
      // 检查帧变化
      const currentFrame = player.getCurrentFrame();
      if (currentFrame !== lastFrame) {
        lastFrame = currentFrame;
        handleFrameChange(currentFrame);
      }
      
      // 检查播放状态变化
      const isCurrentlyPlaying = player.isPlaying();
      if (isCurrentlyPlaying !== wasPlaying) {
        wasPlaying = isCurrentlyPlaying;
        handlePlayingChange(isCurrentlyPlaying);
      }
    }, 33); // ~30fps
    
    return () => clearInterval(interval);
  }, [handleFrameChange, handlePlayingChange]);
  
  // 处理点击 - 跳转到对应片段
  const handleClick = useCallback(() => {
    if (!playerRef.current) return;
    
    const currentFrame = playerRef.current.getCurrentFrame();
    const currentTimeMs = (currentFrame / fps) * 1000;
    
    // 找到当前时间点的片段
    const clickedClip = clips.find(
      clip => currentTimeMs >= clip.timeRange.start && currentTimeMs < clip.timeRange.end
    );
    
    if (clickedClip && onClipClick) {
      onClipClick(clickedClip.clipId);
    }
  }, [clips, fps, onClipClick]);

  // 检测视频是否准备好
  useEffect(() => {
    if (mainVideoUrl) {
      // 简单的准备检测
      const timer = setTimeout(() => setIsReady(true), 500);
      return () => clearTimeout(timer);
    }
  }, [mainVideoUrl]);

  if (!mainVideoUrl) {
    return (
      <div className={className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
        <p className="text-gray-400 text-sm">请先上传视频</p>
      </div>
    );
  }

  // 调试信息
  console.log('[BRollPreview] Rendering with:', {
    mainVideoUrl,
    clipsCount: clips.length,
    durationInFrames,
    fps,
    width,
    height,
  });

  return (
    <div className={className} style={style} onClick={handleClick}>
      {/* 调试标记 - 确认 Remotion 组件已加载 */}
      <div className="absolute top-2 right-2 z-50 px-2 py-1 bg-gray-700 text-white text-xs rounded opacity-80">
        Remotion
      </div>
      <Player
        ref={playerRef}
        component={BRollComposition}
        inputProps={compositionProps}
        durationInFrames={durationInFrames}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        style={{
          width: 'auto',
          height: '100%',
          maxWidth: '100%',
          aspectRatio: `${width} / ${height}`,
        }}
        controls={false}
        loop={false}
        showVolumeControls={false}
        allowFullscreen={false}
        clickToPlay={false}
        renderLoading={() => (
          <div className="w-full h-full flex items-center justify-center bg-black">
            <div className="text-white text-sm">加载中...</div>
          </div>
        )}
      />
    </div>
  );
}

export default BRollPreview;
