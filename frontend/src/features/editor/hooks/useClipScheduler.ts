/**
 * useClipScheduler - Clip 调度层 Hook
 * 
 * Layer 2: Clip 调度层
 * 职责：
 * - 当前 clip + 预热窗口 clip 计算
 * - clip 优先级排序
 * - 决定哪些 clip 需要加载/卸载
 * - 维护 ~10 个活跃 video element
 * 
 * 设计原则：
 * - 纯函数计算，不持有状态
 * - 基于 playhead 和 clips 列表计算调度
 */

import { useCallback, useMemo } from 'react';
import type { Clip } from '../types/clip';
import type { ClipScheduleItem, VideoResourceConfig, DEFAULT_VIDEO_RESOURCE_CONFIG } from '../types/video';
import { msToSec } from '../lib/time-utils';

// 日志工具
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEBUG) console.log('[ClipScheduler]', ...args); };

export interface UseClipSchedulerOptions {
  config?: Partial<VideoResourceConfig>;
}

export interface UseClipSchedulerReturn {
  /**
   * 获取当前播放位置对应的 clip
   */
  getCurrentClip: (clips: Clip[], playheadMs: number) => Clip | null;
  
  /**
   * 获取需要预热的 clip 列表（按优先级排序）
   */
  getClipsToLoad: (
    clips: Clip[],
    playheadMs: number,
    maxCount: number
  ) => ClipScheduleItem[];
  
  /**
   * 获取可以卸载的 clip 列表
   */
  getClipsToUnload: (
    clips: Clip[],
    playheadMs: number,
    activeClipIds: string[]
  ) => string[];
  
  /**
   * 计算 clip 的调度信息
   */
  computeScheduleInfo: (
    clip: Clip,
    playheadSec: number,
    isCurrent: boolean
  ) => ClipScheduleItem;
  
  /**
   * 获取下一个 clip（用于边界切换预检查）
   */
  getNextClip: (clips: Clip[], currentClipId: string) => Clip | null;
  
  /**
   * 获取前一个 clip（用于回退预检查）
   */
  getPrevClip: (clips: Clip[], currentClipId: string) => Clip | null;
  
  /** 配置 */
  config: VideoResourceConfig;
}

/**
 * Clip 调度层 Hook
 */
export function useClipScheduler(options: UseClipSchedulerOptions = {}): UseClipSchedulerReturn {
  // 合并配置
  const config = useMemo<VideoResourceConfig>(() => ({
    maxActiveVideos: 10,
    preheatWindowSec: 15,
    seekThreshold: 0.3,
    bufferThreshold: 2,
    hlsThreshold: 10,
    debug: process.env.NODE_ENV === 'development',
    ...options.config,
  }), [options.config]);
  
  /**
   * 获取当前播放位置对应的 clip
   */
  const getCurrentClip = useCallback((clips: Clip[], playheadMs: number): Clip | null => {
    if (!clips || clips.length === 0) return null;
    
    const playheadSec = msToSec(playheadMs);
    
    for (const clip of clips) {
      const startSec = msToSec(clip.start);
      const endSec = msToSec(clip.start + clip.duration);
      
      if (playheadSec >= startSec && playheadSec < endSec) {
        return clip;
      }
    }
    
    // 如果没找到，返回最后一个 clip（播放到末尾的情况）
    const lastClip = clips[clips.length - 1];
    const lastEndSec = msToSec(lastClip.start + lastClip.duration);
    if (playheadSec >= lastEndSec - 0.1) {
      return lastClip;
    }
    
    return null;
  }, []);
  
  /**
   * 计算 clip 的调度信息
   */
  const computeScheduleInfo = useCallback((
    clip: Clip,
    playheadSec: number,
    isCurrent: boolean
  ): ClipScheduleItem => {
    const startSec = msToSec(clip.start);
    const endSec = msToSec(clip.start + clip.duration);
    const inPointSec = msToSec(clip.sourceStart || 0);
    const outPointSec = inPointSec + (endSec - startSec); // 计算 outPoint = inPoint + clip 时长
    
    // 计算与播放头的距离
    let distance: number;
    if (playheadSec < startSec) {
      // 播放头在 clip 之前
      distance = startSec - playheadSec;
    } else if (playheadSec > endSec) {
      // 播放头在 clip 之后
      distance = playheadSec - endSec;
    } else {
      // 播放头在 clip 内
      distance = 0;
    }
    
    // 计算优先级（数字越小优先级越高）
    // 当前正在播放的 clip 优先级最高 (0)
    // 其他按距离排序
    let priority: number;
    if (isCurrent) {
      priority = 0;
    } else if (playheadSec < startSec) {
      // 未来的 clip，按距离排优先级
      priority = 1 + distance;
    } else {
      // 过去的 clip，优先级较低但保留（用于回退）
      priority = 100 + distance;
    }
    
    return {
      clipId: clip.id,
      assetId: clip.assetId || '',
      priority,
      startTimeInTimeline: startSec,
      endTimeInTimeline: endSec,
      inPoint: inPointSec,
      outPoint: outPointSec,
      isCurrent,
      distance,
    };
  }, []);
  
  /**
   * 获取需要预热的 clip 列表（按优先级排序）
   */
  const getClipsToLoad = useCallback((
    clips: Clip[],
    playheadMs: number,
    maxCount: number
  ): ClipScheduleItem[] => {
    if (!clips || clips.length === 0) return [];
    
    const playheadSec = msToSec(playheadMs);
    const windowStart = playheadSec - 5; // 往前看 5 秒（支持回退）
    const windowEnd = playheadSec + config.preheatWindowSec;
    
    // 只处理视频类型的 clip（video 和 broll）
    const videoClips = clips.filter(clip => 
      (clip.clipType === 'video' || clip.clipType === 'broll') && clip.assetId
    );
    
    // 找到当前 clip
    const currentClip = getCurrentClip(videoClips, playheadMs);
    
    // 计算每个 clip 的调度信息
    const scheduleItems: ClipScheduleItem[] = [];
    
    for (const clip of videoClips) {
      const startSec = msToSec(clip.start);
      const endSec = msToSec(clip.start + clip.duration);
      
      // 只处理窗口内的 clip
      if (endSec < windowStart || startSec > windowEnd) {
        continue;
      }
      
      const isCurrent = currentClip?.id === clip.id;
      const info = computeScheduleInfo(clip, playheadSec, isCurrent);
      scheduleItems.push(info);
    }
    
    // 按优先级排序
    scheduleItems.sort((a, b) => a.priority - b.priority);
    
    // 限制数量
    return scheduleItems.slice(0, maxCount);
  }, [config.preheatWindowSec, getCurrentClip, computeScheduleInfo]);
  
  /**
   * 获取可以卸载的 clip 列表
   */
  const getClipsToUnload = useCallback((
    clips: Clip[],
    playheadMs: number,
    activeClipIds: string[]
  ): string[] => {
    if (!clips || clips.length === 0 || activeClipIds.length === 0) return [];
    
    const playheadSec = msToSec(playheadMs);
    const windowStart = playheadSec - 10; // 保留往前 10 秒
    const windowEnd = playheadSec + config.preheatWindowSec + 5; // 预热窗口 + 5 秒缓冲
    
    // 构建 clip 位置映射
    const clipPositions = new Map<string, { start: number; end: number }>();
    for (const clip of clips) {
      if ((clip.clipType === 'video' || clip.clipType === 'broll') && clip.assetId) {
        clipPositions.set(clip.id, {
          start: msToSec(clip.start),
          end: msToSec(clip.start + clip.duration),
        });
      }
    }
    
    // 找出窗口外的活跃 clip
    const toUnload: string[] = [];
    for (const clipId of activeClipIds) {
      const pos = clipPositions.get(clipId);
      if (!pos) {
        // clip 不存在了，应该卸载
        toUnload.push(clipId);
        continue;
      }
      
      // 检查是否在窗口外
      if (pos.end < windowStart || pos.start > windowEnd) {
        toUnload.push(clipId);
      }
    }
    
    return toUnload;
  }, [config.preheatWindowSec]);
  
  /**
   * 获取下一个 clip
   */
  const getNextClip = useCallback((clips: Clip[], currentClipId: string): Clip | null => {
    if (!clips || clips.length === 0) return null;
    
    const videoClips = clips
      .filter(clip => (clip.clipType === 'video' || clip.clipType === 'broll') && clip.assetId)
      .sort((a, b) => a.start - b.start);
    
    const currentIndex = videoClips.findIndex(c => c.id === currentClipId);
    if (currentIndex === -1 || currentIndex >= videoClips.length - 1) {
      return null;
    }
    
    return videoClips[currentIndex + 1];
  }, []);
  
  /**
   * 获取前一个 clip
   */
  const getPrevClip = useCallback((clips: Clip[], currentClipId: string): Clip | null => {
    if (!clips || clips.length === 0) return null;
    
    const videoClips = clips
      .filter(clip => (clip.clipType === 'video' || clip.clipType === 'broll') && clip.assetId)
      .sort((a, b) => a.start - b.start);
    
    const currentIndex = videoClips.findIndex(c => c.id === currentClipId);
    if (currentIndex <= 0) {
      return null;
    }
    
    return videoClips[currentIndex - 1];
  }, []);
  
  return {
    getCurrentClip,
    getClipsToLoad,
    getClipsToUnload,
    computeScheduleInfo,
    getNextClip,
    getPrevClip,
    config,
  };
}
