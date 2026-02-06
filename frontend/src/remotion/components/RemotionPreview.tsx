/**
 * Remotion 播放器预览组件
 * 用于在编辑器中实时预览视频合成效果
 */
'use client';

import { useMemo, useRef, useEffect, useCallback } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { VideoComposition } from '../compositions/VideoComposition';
import type { VideoCompositionProps, ClipData, TrackData } from '../compositions/VideoComposition';

// ============================================
// 类型定义
// ============================================

interface RemotionPreviewProps {
  // 编辑器数据
  clips: ClipData[];
  tracks: TrackData[];
  duration: number; // ms
  
  // 画布尺寸
  width?: number;
  height?: number;
  fps?: number;
  
  // 播放控制
  currentTime?: number; // ms
  isPlaying?: boolean;
  onTimeChange?: (timeMs: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  
  // 样式
  className?: string;
  style?: React.CSSProperties;
}

// ============================================
// 主组件
// ============================================

export function RemotionPreview({
  clips,
  tracks,
  duration,
  width = 1080,
  height = 1080,
  fps = 30,
  currentTime = 0,
  isPlaying = false,
  onTimeChange,
  onPlayingChange,
  className,
  style,
}: RemotionPreviewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const lastSyncedTimeRef = useRef(currentTime);
  
  // 计算总帧数
  const durationInFrames = useMemo(() => {
    return Math.max(1, Math.ceil((duration / 1000) * fps));
  }, [duration, fps]);
  
  // 构建 props
  const compositionProps: VideoCompositionProps = useMemo(() => ({
    clips,
    tracks,
    duration,
    width,
    height,
    fps,
    backgroundColor: '#000000',
  }), [clips, tracks, duration, width, height, fps]);
  
  // 同步外部 currentTime 到 Player
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    
    // 避免循环更新
    const timeDiff = Math.abs(currentTime - lastSyncedTimeRef.current);
    if (timeDiff < 50) return; // 50ms 容差
    
    const targetFrame = Math.round((currentTime / 1000) * fps);
    player.seekTo(targetFrame);
    lastSyncedTimeRef.current = currentTime;
  }, [currentTime, fps]);
  
  // 同步播放状态
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    
    if (isPlaying) {
      player.play();
    } else {
      player.pause();
    }
  }, [isPlaying]);
  
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
  
  // 注册事件监听 - 使用轮询方式代替事件监听（更兼容）
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
    }, 33); // ~30fps 轮询
    
    return () => clearInterval(interval);
  }, [handleFrameChange, handlePlayingChange]);
  
  return (
    <div className={className} style={style}>
      <Player
        ref={playerRef}
        component={VideoComposition}
        inputProps={compositionProps}
        durationInFrames={durationInFrames}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        style={{
          width: '100%',
          height: '100%',
        }}
        // 控制面板配置
        controls={false} // 使用自定义控制
        loop={false}
        showVolumeControls={false}
        allowFullscreen={false}
        clickToPlay={false}
        // 性能优化
        renderLoading={() => (
          <div className="w-full h-full flex items-center justify-center bg-black">
            <div className="text-white text-sm">加载中...</div>
          </div>
        )}
      />
    </div>
  );
}

// ============================================
// 工具函数：转换编辑器数据为 Remotion 格式
// ============================================

import type { Clip, Track } from '@/features/editor/types';

/**
 * 将编辑器 Clip 转换为 Remotion ClipData
 */
export function convertClipToRemotionFormat(clip: Clip, getSourceUrl: (assetId: string) => string | undefined): ClipData {
  const sourceUrl = clip.assetId ? getSourceUrl(clip.assetId) : undefined;
  
  return {
    id: clip.id,
    trackId: clip.trackId,
    clipType: clip.clipType as ClipData['clipType'],
    start: clip.start,
    duration: clip.duration,
    sourceStart: clip.sourceStart,
    originDuration: clip.originDuration,
    sourceUrl,
    thumbnailUrl: clip.thumbnail,
    transform: clip.transform ? {
      x: clip.transform.x || 0,
      y: clip.transform.y || 0,
      scale: clip.transform.scale || 1,
      rotation: clip.transform.rotation || 0,
      opacity: clip.transform.opacity ?? 1,
    } : undefined,
    text: (clip as any).text || (clip as any).content,
    fontSize: (clip as any).fontSize,
    fontColor: (clip as any).fontColor,
    fontFamily: (clip as any).fontFamily,
    fadeIn: (clip as any).fadeIn,
    fadeOut: (clip as any).fadeOut,
    volume: clip.volume,
    // ★★★ 传递 metadata（包含 B-Roll 的 letterbox_params）★★★
    metadata: clip.metadata ? {
      is_broll: clip.metadata.is_broll,
      letterbox_params: clip.metadata.letterbox_params,
    } : undefined,
  };
}

/**
 * 将编辑器 Track 转换为 Remotion TrackData
 */
export function convertTrackToRemotionFormat(track: Track): TrackData {
  return {
    id: track.id,
    name: track.name,
    type: (track as any).type,
    orderIndex: track.orderIndex,
    muted: track.isMuted,
    visible: track.isVisible,
  };
}
