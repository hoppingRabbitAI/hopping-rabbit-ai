/**
 * useVideoPlaybackSystem - 视频播放系统入口 Hook
 * 
 * 整合三层架构：
 * - Layer 1: PlaybackController (播放控制)
 * - Layer 2: ClipScheduler (Clip 调度)
 * - Layer 3: VideoResource (视频资源)
 * 
 * 这个 hook 提供统一的 API，用于逐步替换 VideoCanvasStore.tsx 中的旧逻辑
 */

import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useEditorStore } from '../store/editor-store';
import { useVideoResource } from './useVideoResource';
import { useClipScheduler } from './useClipScheduler';
import { usePlaybackController } from './usePlaybackController';
import type { Clip } from '../types/clip';
import type { VideoResourceConfig } from '../types/video';
import { msToSec, secToMs } from '../lib/time-utils';

// 日志工具
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEBUG) console.log('[VideoSystem]', ...args); };

export interface UseVideoPlaybackSystemOptions {
  /** 配置覆盖 */
  config?: Partial<VideoResourceConfig>;
  /** 是否启用（可用于延迟初始化） */
  enabled?: boolean;
}

export interface UseVideoPlaybackSystemReturn {
  // ========== 播放控制 ==========
  /** 开始播放 */
  play: () => void;
  /** 暂停播放 */
  pause: () => void;
  /** 切换播放/暂停 */
  toggle: () => void;
  /** 跳转到指定时间（毫秒） */
  seekTo: (timeMs: number) => void;
  
  // ========== 状态查询 ==========
  /** 获取当前 clip 的视频元素 */
  getCurrentVideoElement: () => HTMLVideoElement | null;
  /** 检查 clip 是否已 ready */
  isClipReady: (clipId: string) => boolean;
  /** 获取活跃的 clip 视频元素 */
  getClipVideoElement: (clipId: string) => HTMLVideoElement | null;
  
  // ========== 预热管理 ==========
  /** 手动触发预热调度 */
  schedulePreheating: () => void;
  /** 检查是否有足够的预热（用于 UI 显示） */
  hasMinimalPreheating: () => boolean;
  
  // ========== 资源管理 ==========
  /** 清理所有资源 */
  cleanup: () => void;
  /** 获取活跃视频数量 */
  getActiveVideoCount: () => number;
  
  // ========== 底层访问（用于渐进迁移） ==========
  videoResource: ReturnType<typeof useVideoResource>;
  clipScheduler: ReturnType<typeof useClipScheduler>;
}

/**
 * 视频播放系统入口 Hook
 */
export function useVideoPlaybackSystem(
  options: UseVideoPlaybackSystemOptions = {}
): UseVideoPlaybackSystemReturn {
  const { config, enabled = true } = options;
  
  // Store 状态
  const clips = useEditorStore((s) => s.clips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  
  // 计算总时长
  const totalDuration = useMemo(() => {
    if (clips.length === 0) return 0;
    return Math.max(...clips.map(c => c.start + c.duration));
  }, [clips]);
  
  // 过滤视频 clips
  const videoClips = useMemo(() => {
    return clips.filter(c => 
      (c.clipType === 'video' || c.clipType === 'broll') && 
      (c.mediaUrl || c.assetId)
    );
  }, [clips]);
  
  // 初始化三层架构
  const videoResource = useVideoResource({
    config,
    onEvent: (event) => {
      log('ResourceEvent:', event.type, event.clipId.slice(-8));
    },
  });
  
  const clipScheduler = useClipScheduler({ config });
  
  // Store 访问函数
  const getClips = useCallback(() => videoClips, [videoClips]);
  const getPlayheadMs = useCallback(() => currentTime, [currentTime]);
  const setPlayheadMs = useCallback((ms: number) => setCurrentTime(ms), [setCurrentTime]);
  const getIsPlaying = useCallback(() => isPlaying, [isPlaying]);
  const getTotalDurationMs = useCallback(() => totalDuration, [totalDuration]);
  
  // 播放控制器
  const playbackController = usePlaybackController({
    videoResource,
    clipScheduler,
    getClips,
    getPlayheadMs,
    setPlayheadMs,
    getIsPlaying,
    setIsPlaying,
    getTotalDurationMs,
    config,
    onPlaybackEnd: () => {
      log('播放结束');
    },
  });
  
  // ========== 预热调度 ==========
  // 当 currentTime 变化时，触发预热调度（节流）
  const lastScheduleTimeRef = useRef(0);
  const SCHEDULE_THROTTLE_MS = 500;
  
  useEffect(() => {
    if (!enabled) return;
    
    const now = performance.now();
    if (now - lastScheduleTimeRef.current < SCHEDULE_THROTTLE_MS) {
      return;
    }
    lastScheduleTimeRef.current = now;
    
    playbackController.schedulePreheating();
  }, [enabled, currentTime, playbackController]);
  
  // ========== 公共 API ==========
  
  const getCurrentVideoElement = useCallback((): HTMLVideoElement | null => {
    const currentClip = clipScheduler.getCurrentClip(videoClips, currentTime);
    if (!currentClip) return null;
    
    const clipVideo = videoResource.getClipVideo(currentClip.id);
    return clipVideo?.element || null;
  }, [videoClips, currentTime, clipScheduler, videoResource]);
  
  const isClipReady = useCallback((clipId: string): boolean => {
    return videoResource.isClipReady(clipId);
  }, [videoResource]);
  
  const getClipVideoElement = useCallback((clipId: string): HTMLVideoElement | null => {
    const clipVideo = videoResource.getClipVideo(clipId);
    return clipVideo?.element || null;
  }, [videoResource]);
  
  const hasMinimalPreheating = useCallback((): boolean => {
    // 检查当前 clip 和下一个 clip 是否已预热
    const currentClip = clipScheduler.getCurrentClip(videoClips, currentTime);
    if (!currentClip) return true; // 没有视频 clip
    
    const currentReady = videoResource.isClipReady(currentClip.id);
    if (!currentReady) return false;
    
    const nextClip = clipScheduler.getNextClip(videoClips, currentClip.id);
    if (!nextClip) return true; // 没有下一个 clip
    
    // 下一个 clip 至少已创建
    const nextVideo = videoResource.getClipVideo(nextClip.id);
    return !!nextVideo;
  }, [videoClips, currentTime, clipScheduler, videoResource]);
  
  const getActiveVideoCount = useCallback((): number => {
    return videoResource.getActiveCount();
  }, [videoResource]);
  
  return {
    // 播放控制
    play: playbackController.play,
    pause: playbackController.pause,
    toggle: playbackController.toggle,
    seekTo: playbackController.seekTo,
    
    // 状态查询
    getCurrentVideoElement,
    isClipReady,
    getClipVideoElement,
    
    // 预热管理
    schedulePreheating: playbackController.schedulePreheating,
    hasMinimalPreheating,
    
    // 资源管理
    cleanup: playbackController.cleanup,
    getActiveVideoCount,
    
    // 底层访问
    videoResource,
    clipScheduler,
  };
}
