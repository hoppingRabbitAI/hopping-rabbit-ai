/**
 * usePlaybackController - 播放控制层 Hook
 * 
 * Layer 1: 播放控制层
 * 职责：
 * - 播放/暂停状态管理
 * - playhead 推进（RAF）
 * - clip 边界检测与切换
 * - 等待加载逻辑（pause-and-wait）
 * 
 * 设计原则：
 * - 协调调度层和资源层
 * - 简单的状态机
 * - 明确的等待加载策略
 */

import { useRef, useCallback, useEffect } from 'react';
import type { Clip } from '../types/clip';
import type { PlaybackState, VideoResourceConfig } from '../types/video';
import type { UseVideoResourceReturn } from './useVideoResource';
import type { UseClipSchedulerReturn } from './useClipScheduler';
import { msToSec, secToMs } from '../lib/time-utils';

// 日志工具
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEBUG) console.log('[PlaybackController]', ...args); };

export interface UsePlaybackControllerOptions {
  /** 视频资源层 */
  videoResource: UseVideoResourceReturn;
  
  /** 调度层 */
  clipScheduler: UseClipSchedulerReturn;
  
  /** 获取当前 clips 列表 */
  getClips: () => Clip[];
  
  /** 获取当前播放头位置（毫秒） */
  getPlayheadMs: () => number;
  
  /** 设置播放头位置（毫秒） */
  setPlayheadMs: (ms: number) => void;
  
  /** 获取是否正在播放 */
  getIsPlaying: () => boolean;
  
  /** 设置播放状态 */
  setIsPlaying: (playing: boolean) => void;
  
  /** 获取总时长（毫秒） */
  getTotalDurationMs: () => number;
  
  /** 播放结束回调 */
  onPlaybackEnd?: () => void;
  
  /** 配置 */
  config?: Partial<VideoResourceConfig>;
}

export interface UsePlaybackControllerReturn {
  /** 开始播放 */
  play: () => void;
  
  /** 暂停播放 */
  pause: () => void;
  
  /** 切换播放/暂停 */
  toggle: () => void;
  
  /** 跳转到指定时间 */
  seekTo: (timeMs: number) => void;
  
  /** 获取当前播放状态 */
  getPlaybackState: () => PlaybackState;
  
  /** 同步视频到当前播放头 */
  syncCurrentVideo: () => void;
  
  /** 调度预热（应在 playhead 变化时调用） */
  schedulePreheating: () => void;
  
  /** 清理资源 */
  cleanup: () => void;
}

/**
 * 播放控制层 Hook
 */
export function usePlaybackController(
  options: UsePlaybackControllerOptions
): UsePlaybackControllerReturn {
  const {
    videoResource,
    clipScheduler,
    getClips,
    getPlayheadMs,
    setPlayheadMs,
    getIsPlaying,
    setIsPlaying,
    getTotalDurationMs,
    onPlaybackEnd,
  } = options;
  
  const config = {
    seekThreshold: 0.3,
    bufferThreshold: 2,
    ...options.config,
  };
  
  // RAF 相关
  const rafIdRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  
  // 等待加载状态
  const waitingForLoadRef = useRef<{
    isWaiting: boolean;
    clipId: string | null;
    checkInterval: NodeJS.Timeout | null;
  }>({
    isWaiting: false,
    clipId: null,
    checkInterval: null,
  });
  
  // 当前同步的 clip
  const currentSyncedClipRef = useRef<string | null>(null);
  
  /**
   * 获取当前播放状态
   */
  const getPlaybackState = useCallback((): PlaybackState => {
    const clips = getClips();
    const playheadMs = getPlayheadMs();
    const currentClip = clipScheduler.getCurrentClip(clips, playheadMs);
    
    return {
      isPlaying: getIsPlaying(),
      playhead: msToSec(playheadMs),
      currentClipId: currentClip?.id || null,
      isWaitingForLoad: waitingForLoadRef.current.isWaiting,
      waitingForClipId: waitingForLoadRef.current.clipId,
    };
  }, [getClips, getPlayheadMs, getIsPlaying, clipScheduler]);
  
  /**
   * 同步视频到当前播放头
   */
  const syncCurrentVideo = useCallback(() => {
    const clips = getClips();
    const playheadMs = getPlayheadMs();
    const currentClip = clipScheduler.getCurrentClip(clips, playheadMs);
    
    if (!currentClip || (currentClip.clipType !== 'video' && currentClip.clipType !== 'broll') || !currentClip.assetId) {
      return;
    }
    
    const clipVideo = videoResource.getClipVideo(currentClip.id);
    if (!clipVideo || clipVideo.status === 'error') {
      return;
    }
    
    // 计算视频应该在的时间
    const clipStartSec = msToSec(currentClip.start);
    const playheadSec = msToSec(playheadMs);
    const offsetInClip = playheadSec - clipStartSec;
    const inPointSec = msToSec(currentClip.sourceStart || 0);
    const targetVideoTime = inPointSec + offsetInClip;
    
    const video = clipVideo.element;
    const currentVideoTime = video.currentTime;
    const drift = Math.abs(currentVideoTime - targetVideoTime);
    
    // 只有漂移超过阈值才 seek
    if (drift > config.seekThreshold) {
      video.currentTime = targetVideoTime;
      videoResource.touchClip(currentClip.id);
      log('同步视频:', currentClip.id.slice(-8), 
        '| 目标:', targetVideoTime.toFixed(2), 
        '| 当前:', currentVideoTime.toFixed(2),
        '| 漂移:', drift.toFixed(2));
    }
    
    // 更新当前同步的 clip
    currentSyncedClipRef.current = currentClip.id;
  }, [getClips, getPlayheadMs, clipScheduler, videoResource, config.seekThreshold]);
  
  /**
   * 等待 clip 加载完成
   */
  const waitForClipReady = useCallback((clipId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      // 检查是否已经 ready
      if (videoResource.isClipReady(clipId)) {
        resolve(true);
        return;
      }
      
      // 设置等待状态
      waitingForLoadRef.current = {
        isWaiting: true,
        clipId,
        checkInterval: null,
      };
      
      log('等待 clip 加载:', clipId.slice(-8));
      
      // 定期检查是否 ready
      let checkCount = 0;
      const maxChecks = 100; // 最多检查 10 秒
      
      const checkInterval = setInterval(() => {
        checkCount++;
        
        if (videoResource.isClipReady(clipId)) {
          clearInterval(checkInterval);
          waitingForLoadRef.current = {
            isWaiting: false,
            clipId: null,
            checkInterval: null,
          };
          log('clip 加载完成:', clipId.slice(-8));
          resolve(true);
          return;
        }
        
        // 超时
        if (checkCount >= maxChecks) {
          clearInterval(checkInterval);
          waitingForLoadRef.current = {
            isWaiting: false,
            clipId: null,
            checkInterval: null,
          };
          log('clip 加载超时，继续播放:', clipId.slice(-8));
          resolve(false);
        }
      }, 100);
      
      waitingForLoadRef.current.checkInterval = checkInterval;
    });
  }, [videoResource]);
  
  /**
   * RAF 播放循环
   */
  const updatePlayhead = useCallback((timestamp: number) => {
    if (!getIsPlaying()) {
      rafIdRef.current = null;
      return;
    }
    
    // 如果正在等待加载，不推进时间
    if (waitingForLoadRef.current.isWaiting) {
      rafIdRef.current = requestAnimationFrame(updatePlayhead);
      return;
    }
    
    // 计算时间增量
    const deltaMs = lastFrameTimeRef.current > 0 
      ? timestamp - lastFrameTimeRef.current 
      : 16.67; // 默认 60fps
    lastFrameTimeRef.current = timestamp;
    
    // 更新播放头
    const currentMs = getPlayheadMs();
    const totalMs = getTotalDurationMs();
    let newMs = currentMs + deltaMs;
    
    // 检查是否播放结束
    if (newMs >= totalMs) {
      newMs = totalMs;
      setPlayheadMs(newMs);
      setIsPlaying(false);
      if (onPlaybackEnd) {
        onPlaybackEnd();
      }
      rafIdRef.current = null;
      return;
    }
    
    // 检查 clip 边界
    const clips = getClips();
    const currentClip = clipScheduler.getCurrentClip(clips, currentMs);
    const newClip = clipScheduler.getCurrentClip(clips, newMs);
    
    // 如果切换到了新 clip
    if (newClip && currentClip && newClip.id !== currentClip.id) {
      log('边界切换:', currentClip.id.slice(-8), '->', newClip.id.slice(-8));
      
      // 检查新 clip 是否 ready
      if (!videoResource.isClipReady(newClip.id)) {
        // 暂停在边界，等待加载
        setPlayheadMs(newMs);
        
        // 异步等待加载
        waitForClipReady(newClip.id).then(() => {
          // 加载完成，继续播放
          if (getIsPlaying()) {
            syncCurrentVideo();
          }
        });
        
        rafIdRef.current = requestAnimationFrame(updatePlayhead);
        return;
      }
    }
    
    // 更新播放头
    setPlayheadMs(newMs);
    
    // 同步视频
    syncCurrentVideo();
    
    // 继续下一帧
    rafIdRef.current = requestAnimationFrame(updatePlayhead);
  }, [
    getIsPlaying,
    getPlayheadMs,
    setPlayheadMs,
    getTotalDurationMs,
    setIsPlaying,
    getClips,
    clipScheduler,
    videoResource,
    syncCurrentVideo,
    waitForClipReady,
    onPlaybackEnd,
  ]);
  
  /**
   * 调度预热
   */
  const schedulePreheating = useCallback(() => {
    const clips = getClips();
    const playheadMs = getPlayheadMs();
    
    // 获取需要加载的 clips
    const toLoad = clipScheduler.getClipsToLoad(
      clips,
      playheadMs,
      videoResource.config.maxActiveVideos
    );
    
    // 获取当前活跃的 clip IDs
    const activeIds = videoResource.getActiveClipIds();
    const activeSet = new Set(activeIds);
    
    // 加载新的 clips
    for (const item of toLoad) {
      if (!activeSet.has(item.clipId)) {
        // 查找原始 clip 信息判断是否是 B-Roll
        const clip = clips.find(c => c.id === item.clipId);
        const isBRoll = clip?.clipType === 'broll';
        
        videoResource.createVideoForClip(
          item.clipId,
          item.assetId,
          item.inPoint,
          item.outPoint,
          isBRoll
        );
      } else {
        // 已存在，更新访问时间
        videoResource.touchClip(item.clipId);
      }
    }
    
    // 执行 LRU 淘汰
    const keepIds = toLoad.map(item => item.clipId);
    videoResource.evictLRU(keepIds);
  }, [getClips, getPlayheadMs, clipScheduler, videoResource]);
  
  /**
   * 开始播放
   */
  const play = useCallback(() => {
    if (getIsPlaying()) return;
    
    const clips = getClips();
    const playheadMs = getPlayheadMs();
    const currentClip = clipScheduler.getCurrentClip(clips, playheadMs);
    
    // 确保当前 clip 的视频已创建
    if (currentClip && (currentClip.clipType === 'video' || currentClip.clipType === 'broll') && currentClip.assetId) {
      let clipVideo = videoResource.getClipVideo(currentClip.id);
      
      if (!clipVideo) {
        // 创建视频
        const clipDurationSec = msToSec(currentClip.duration);
        const sourceStartSec = msToSec(currentClip.sourceStart || 0);
        const isBRoll = currentClip.clipType === 'broll';
        
        clipVideo = videoResource.createVideoForClip(
          currentClip.id,
          currentClip.assetId,
          sourceStartSec,
          sourceStartSec + clipDurationSec,
          isBRoll
        );
      }
      
      // 同步视频位置
      syncCurrentVideo();
      
      // 开始播放视频
      clipVideo.element.muted = false;
      clipVideo.element.play().catch(() => {
        // 自动播放被阻止，静音重试
        clipVideo!.element.muted = true;
        clipVideo!.element.play().catch(() => {});
      });
    }
    
    // 开始 RAF 循环
    setIsPlaying(true);
    lastFrameTimeRef.current = 0;
    rafIdRef.current = requestAnimationFrame(updatePlayhead);
    
    log('开始播放');
  }, [
    getIsPlaying,
    setIsPlaying,
    getClips,
    getPlayheadMs,
    clipScheduler,
    videoResource,
    syncCurrentVideo,
    updatePlayhead,
  ]);
  
  /**
   * 暂停播放
   */
  const pause = useCallback(() => {
    if (!getIsPlaying()) return;
    
    // 停止 RAF
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // 清除等待状态
    if (waitingForLoadRef.current.checkInterval) {
      clearInterval(waitingForLoadRef.current.checkInterval);
    }
    waitingForLoadRef.current = {
      isWaiting: false,
      clipId: null,
      checkInterval: null,
    };
    
    // 暂停当前视频
    const clips = getClips();
    const playheadMs = getPlayheadMs();
    const currentClip = clipScheduler.getCurrentClip(clips, playheadMs);
    
    if (currentClip) {
      const clipVideo = videoResource.getClipVideo(currentClip.id);
      if (clipVideo) {
        clipVideo.element.pause();
      }
    }
    
    setIsPlaying(false);
    log('暂停播放');
  }, [
    getIsPlaying,
    setIsPlaying,
    getClips,
    getPlayheadMs,
    clipScheduler,
    videoResource,
  ]);
  
  /**
   * 切换播放/暂停
   */
  const toggle = useCallback(() => {
    if (getIsPlaying()) {
      pause();
    } else {
      play();
    }
  }, [getIsPlaying, play, pause]);
  
  /**
   * 跳转到指定时间
   */
  const seekTo = useCallback((timeMs: number) => {
    const totalMs = getTotalDurationMs();
    const clampedMs = Math.max(0, Math.min(timeMs, totalMs));
    
    setPlayheadMs(clampedMs);
    
    // 触发预热调度
    schedulePreheating();
    
    // 同步视频
    syncCurrentVideo();
    
    log('跳转到:', msToSec(clampedMs).toFixed(2), 's');
  }, [getTotalDurationMs, setPlayheadMs, schedulePreheating, syncCurrentVideo]);
  
  /**
   * 清理资源
   */
  const cleanup = useCallback(() => {
    // 停止 RAF
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    // 清除等待状态
    if (waitingForLoadRef.current.checkInterval) {
      clearInterval(waitingForLoadRef.current.checkInterval);
    }
    
    // 销毁所有视频资源
    videoResource.destroyAll();
    
    log('清理完成');
  }, [videoResource]);
  
  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);
  
  return {
    play,
    pause,
    toggle,
    seekTo,
    getPlaybackState,
    syncCurrentVideo,
    schedulePreheating,
    cleanup,
  };
}
