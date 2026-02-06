/**
 * PlaybackClock - 独立播放时钟（全局单例）
 * 
 * ★★★ 核心设计原则 ★★★
 * 1. 时钟是唯一时间源，视频是从属者
 * 2. 时钟不依赖任何 video 元素
 * 3. 使用 RAF + performance.now() 精确计时
 * 4. 支持 pause-and-wait（等待缓冲）
 * 5. ★ 支持多视频叠加同步（overlay sync）
 * 
 * 这是专业视频编辑器的标准做法：
 * - Premiere、DaVinci 都使用独立时钟
 * - 视频元素只是渲染载体，不是时间源
 */

import { videoResourceManager } from './VideoResourceManager';

type ClockListener = (timeMs: number, isPlaying: boolean) => void;
type WaitingChangeListener = (isWaiting: boolean, reason?: string) => void;

// ★ 用于多视频同步的 clip 信息
interface RegisteredClip {
  clipId: string;
  timelineStart: number;    // clip 在时间轴的开始时间 (ms)
  timelineEnd: number;      // clip 在时间轴的结束时间 (ms)
  sourceStart: number;      // clip 在源视频中的开始时间 (ms)
}

// ★ 同步回调：计算每个 clip 的目标媒体时间
type SyncCallback = (corrections: Map<string, number>) => void;

interface WaitCondition {
  id: string;
  check: () => boolean; // 返回 true 表示可以继续
  reason: string;
}

const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEBUG) console.log('[PlaybackClock]', ...args); };

class PlaybackClock {
  private _currentTimeMs: number = 0;
  private _isPlaying: boolean = false;
  private _durationMs: number = 0;
  
  private rafId: number | null = null;
  private lastTickTime: number = 0;
  
  // 等待条件（pause-and-wait）
  private waitConditions: Map<string, WaitCondition> = new Map();
  private _isWaiting: boolean = false;
  
  // 监听器
  private listeners: Map<string, ClockListener> = new Map();
  private waitingListeners: Map<string, WaitingChangeListener> = new Map();
  
  // 播放速率
  private _playbackRate: number = 1.0;

  // ★★★ 多视频叠加同步 ★★★
  private registeredClips: Map<string, RegisteredClip> = new Map();
  private syncEnabled: boolean = true;
  private lastSyncTime: number = 0;
  private syncIntervalMs: number = 100; // 每 100ms 检查一次同步

  constructor() {
    log('⏱️ PlaybackClock 初始化（全局单例）');
  }

  // ==================== 基本属性 ====================

  get currentTimeMs(): number {
    return this._currentTimeMs;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get isWaiting(): boolean {
    return this._isWaiting;
  }

  get durationMs(): number {
    return this._durationMs;
  }

  get playbackRate(): number {
    return this._playbackRate;
  }

  setDuration(ms: number): void {
    this._durationMs = ms;
  }

  setPlaybackRate(rate: number): void {
    this._playbackRate = Math.max(0.25, Math.min(4, rate));
    log('播放速率:', this._playbackRate);
  }

  // ==================== 播放控制 ====================

  play(): void {
    if (this._isPlaying) return;
    
    // 如果已到结尾，从头开始
    if (this._currentTimeMs >= this._durationMs && this._durationMs > 0) {
      this._currentTimeMs = 0;
    }
    
    this._isPlaying = true;
    this.lastTickTime = performance.now();
    this.startRAF();
    
    log('▶️ 播放', this._currentTimeMs, 'ms');
    this.notifyListeners();
  }

  pause(): void {
    if (!this._isPlaying) return;
    
    this._isPlaying = false;
    this.stopRAF();
    
    log('⏸️ 暂停', this._currentTimeMs, 'ms');
    this.notifyListeners();
  }

  toggle(): void {
    if (this._isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  seek(timeMs: number): void {
    const clampedTime = Math.max(0, Math.min(timeMs, this._durationMs));
    this._currentTimeMs = clampedTime;
    
    log('⏩ Seek', clampedTime, 'ms');
    this.notifyListeners();
  }

  stop(): void {
    this.pause();
    this._currentTimeMs = 0;
    this.notifyListeners();
  }

  // ==================== RAF 循环 ====================

  private startRAF(): void {
    if (this.rafId !== null) return;
    
    const tick = () => {
      // ★★★ 治标治本：必须在每个关键点都检查 isPlaying ★★★
      if (!this._isPlaying) {
        this.rafId = null;
        // 如果在等待状态被暂停了，也要清除等待状态
        if (this._isWaiting) {
          this._isWaiting = false;
          this.notifyWaitingChange(false);
        }
        return;
      }
      
      const now = performance.now();
      const deltaMs = (now - this.lastTickTime) * this._playbackRate;
      this.lastTickTime = now;
      
      // 检查等待条件
      if (this.checkWaitConditions()) {
        // 需要等待，不推进时间
        if (!this._isWaiting) {
          this._isWaiting = true;
          this.notifyWaitingChange(true);
        }
        this.rafId = requestAnimationFrame(tick);
        return;
      } else if (this._isWaiting) {
        // 等待结束
        this._isWaiting = false;
        this.lastTickTime = performance.now(); // 重置时间，避免跳跃
        this.notifyWaitingChange(false);
        
        // ★★★ 治标治本：等待结束后再次检查 isPlaying ★★★
        // 防止用户在等待期间暂停后，等待结束时继续播放
        if (!this._isPlaying) {
          this.rafId = null;
          return;
        }
      }
      
      // 推进时间
      const newTime = this._currentTimeMs + deltaMs;
      
      // 检查是否到达结尾
      if (newTime >= this._durationMs && this._durationMs > 0) {
        this._currentTimeMs = this._durationMs;
        this._isPlaying = false;
        this.rafId = null;
        log('⏹️ 播放结束');
        this.notifyListeners();
        return;
      }
      
      this._currentTimeMs = newTime;
      
      // ★★★ 多视频叠加同步：定期检查并校正漂移 ★★★
      if (this.syncEnabled && now - this.lastSyncTime > this.syncIntervalMs) {
        this.syncAllVideos();
        this.lastSyncTime = now;
      }
      
      this.notifyListeners();
      
      this.rafId = requestAnimationFrame(tick);
    };
    
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRAF(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ==================== 等待条件（pause-and-wait）====================

  /**
   * 添加等待条件
   * 当 check() 返回 false 时，时钟会暂停等待
   */
  addWaitCondition(condition: WaitCondition): void {
    this.waitConditions.set(condition.id, condition);
  }

  removeWaitCondition(id: string): void {
    this.waitConditions.delete(id);
  }

  clearWaitConditions(): void {
    this.waitConditions.clear();
  }

  private checkWaitConditions(): boolean {
    const conditions = Array.from(this.waitConditions.values());
    for (const condition of conditions) {
      if (!condition.check()) {
        return true; // 需要等待
      }
    }
    return false; // 不需要等待
  }

  // ==================== 监听器 ====================

  addListener(id: string, listener: ClockListener): void {
    this.listeners.set(id, listener);
  }

  removeListener(id: string): void {
    this.listeners.delete(id);
  }

  addWaitingListener(id: string, listener: WaitingChangeListener): void {
    this.waitingListeners.set(id, listener);
  }

  removeWaitingListener(id: string): void {
    this.waitingListeners.delete(id);
  }

  // ==================== 多视频叠加同步 ====================

  /**
   * 注册 clip 信息（用于多视频同步）
   */
  registerClip(clip: RegisteredClip): void {
    this.registeredClips.set(clip.clipId, clip);
  }

  /**
   * 批量注册 clips
   */
  registerClips(clips: RegisteredClip[]): void {
    for (const clip of clips) {
      this.registeredClips.set(clip.clipId, clip);
    }
  }

  /**
   * 注销 clip
   */
  unregisterClip(clipId: string): void {
    this.registeredClips.delete(clipId);
  }

  /**
   * 清空所有注册的 clips
   */
  clearRegisteredClips(): void {
    this.registeredClips.clear();
  }

  /**
   * 设置是否启用多视频同步
   */
  setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled;
    log('多视频同步:', enabled ? '启用' : '禁用');
  }

  /**
   * 设置同步检查间隔
   */
  setSyncInterval(intervalMs: number): void {
    this.syncIntervalMs = Math.max(16, intervalMs); // 最小 16ms (约 60fps)
  }

  /**
   * 获取当前可见的 clips（时间轴时间在 clip 范围内的）
   */
  private getVisibleClipIds(): string[] {
    const currentTimeMs = this._currentTimeMs;
    const visibleIds: string[] = [];
    
    this.registeredClips.forEach((clip, clipId) => {
      if (currentTimeMs >= clip.timelineStart && currentTimeMs < clip.timelineEnd) {
        visibleIds.push(clipId);
      }
    });
    
    return visibleIds;
  }

  /**
   * 计算 clip 在当前时间应该显示的媒体时间（秒）
   */
  private calcMediaTimeForClip(clipId: string): number | null {
    const clip = this.registeredClips.get(clipId);
    if (!clip) return null;
    
    const currentTimeMs = this._currentTimeMs;
    if (currentTimeMs < clip.timelineStart || currentTimeMs >= clip.timelineEnd) {
      return null;
    }
    
    // 计算在 clip 内的偏移
    const offsetInClipMs = currentTimeMs - clip.timelineStart;
    // 加上源视频的起始偏移
    const mediaTimeMs = clip.sourceStart + offsetInClipMs;
    // 转换为秒
    return mediaTimeMs / 1000;
  }

  /**
   * ★★★ 核心：同步所有可见视频到正确的时间位置 ★★★
   */
  private syncAllVideos(): void {
    const visibleClipIds = this.getVisibleClipIds();
    if (visibleClipIds.length === 0) return;
    
    // 构建校正 Map
    const corrections = new Map<string, number>();
    
    for (const clipId of visibleClipIds) {
      const targetTime = this.calcMediaTimeForClip(clipId);
      if (targetTime !== null) {
        corrections.set(clipId, targetTime);
      }
    }
    
    // 调用 VideoResourceManager 进行同步校正
    if (corrections.size > 0) {
      videoResourceManager.syncCorrect(corrections);
    }
  }

  /**
   * 立即同步所有视频（用于 seek 后）
   */
  syncNow(): void {
    this.syncAllVideos();
    this.lastSyncTime = performance.now();
  }

  private notifyListeners(): void {
    const time = this._currentTimeMs;
    const playing = this._isPlaying;
    this.listeners.forEach(listener => {
      try {
        listener(time, playing);
      } catch (e) {
        console.error('[PlaybackClock] Listener error:', e);
      }
    });
  }

  private notifyWaitingChange(isWaiting: boolean): void {
    const reasons = isWaiting 
      ? Array.from(this.waitConditions.values())
          .filter(c => !c.check())
          .map(c => c.reason)
          .join(', ')
      : undefined;
    
    log(isWaiting ? '⏳ 等待缓冲:' : '✅ 缓冲完成', reasons || '');
    
    this.waitingListeners.forEach(listener => {
      try {
        listener(isWaiting, reasons);
      } catch (e) {
        console.error('[PlaybackClock] Waiting listener error:', e);
      }
    });
  }

  // ==================== 调试 ====================

  getDebugInfo(): {
    currentTimeMs: number;
    isPlaying: boolean;
    isWaiting: boolean;
    durationMs: number;
    playbackRate: number;
    listenerCount: number;
    waitConditionCount: number;
    registeredClipCount: number;
    visibleClipCount: number;
    syncEnabled: boolean;
  } {
    return {
      currentTimeMs: this._currentTimeMs,
      isPlaying: this._isPlaying,
      isWaiting: this._isWaiting,
      durationMs: this._durationMs,
      playbackRate: this._playbackRate,
      listenerCount: this.listeners.size,
      waitConditionCount: this.waitConditions.size,
      registeredClipCount: this.registeredClips.size,
      visibleClipCount: this.getVisibleClipIds().length,
      syncEnabled: this.syncEnabled,
    };
  }
}

// ==================== 导出全局单例 ====================

export const playbackClock = new PlaybackClock();

// 开发模式下暴露到 window 方便调试
if (typeof window !== 'undefined' && DEBUG) {
  (window as unknown as { __playbackClock: PlaybackClock }).__playbackClock = playbackClock;
}

export type { ClockListener, WaitingChangeListener, WaitCondition, RegisteredClip };
