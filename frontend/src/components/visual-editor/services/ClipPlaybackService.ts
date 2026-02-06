/**
 * Clip 播放服务
 * 全局单例，提供视频片段播放能力
 * 
 * 核心功能：
 * - 获取视频播放 URL（HLS 优先，MP4 回退）
 * - 管理轻量级 video 元素
 * - 支持片段播放（startTime → endTime）
 */

import Hls from 'hls.js';

interface PlaybackState {
  assetId: string;
  video: HTMLVideoElement;
  hls?: Hls;
  isPlaying: boolean;
  startTime: number;
  endTime: number;
}

interface HlsStatus {
  available: boolean;
  playlistUrl?: string;
}

class ClipPlaybackService {
  private urlCache: Map<string, string> = new Map();
  private hlsStatusCache: Map<string, HlsStatus> = new Map();
  private currentPlayback: PlaybackState | null = null;

  /**
   * 获取 HLS 状态（带缓存）
   */
  async getHlsStatus(assetId: string): Promise<HlsStatus> {
    if (this.hlsStatusCache.has(assetId)) {
      return this.hlsStatusCache.get(assetId)!;
    }

    try {
      // ★ 正确的 API 路径: /api/assets/hls/{assetId}/status
      const response = await fetch(`/api/assets/hls/${assetId}/status`);
      if (!response.ok) {
        throw new Error(`HLS status check failed: ${response.status}`);
      }
      
      const data = await response.json();
      const status: HlsStatus = {
        available: data.available === true,
        playlistUrl: data.playlist_url || data.playlistUrl,
      };
      
      this.hlsStatusCache.set(assetId, status);
      return status;
    } catch (error) {
      console.warn('[ClipPlaybackService] HLS status check failed:', error);
      const fallbackStatus: HlsStatus = { available: false };
      this.hlsStatusCache.set(assetId, fallbackStatus);
      return fallbackStatus;
    }
  }

  /**
   * 获取播放 URL（HLS 优先，MP4 回退）
   */
  async getPlaybackUrl(assetId: string): Promise<{ url: string; isHls: boolean }> {
    const cacheKey = assetId;
    
    if (this.urlCache.has(cacheKey)) {
      const url = this.urlCache.get(cacheKey)!;
      const isHls = url.includes('.m3u8');
      return { url, isHls };
    }

    const hlsStatus = await this.getHlsStatus(assetId);
    
    let url: string;
    let isHls: boolean;
    
    if (hlsStatus.available && hlsStatus.playlistUrl) {
      url = hlsStatus.playlistUrl;
      isHls = true;
    } else {
      // 回退到流式代理（后端统一处理 Cloudflare 和 Supabase）
      url = `/api/assets/stream/${assetId}`;
      isHls = false;
    }
    
    this.urlCache.set(cacheKey, url);
    return { url, isHls };
  }

  /**
   * 创建并配置 video 元素
   */
  private createVideoElement(): HTMLVideoElement {
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = false;  // 有声音
    video.preload = 'auto';
    video.style.cssText = 'width: 100%; height: 100%; object-fit: contain; background: black;';
    return video;
  }

  /**
   * 播放指定片段
   */
  async playClip(
    assetId: string,
    startTime: number,  // 秒
    endTime: number,    // 秒
    container: HTMLElement,
    onEnded?: () => void
  ): Promise<void> {
    // 停止当前播放
    this.stopCurrentPlayback();

    const { url, isHls } = await this.getPlaybackUrl(assetId);
    const video = this.createVideoElement();
    
    // 清空容器并添加 video
    container.innerHTML = '';
    container.appendChild(video);

    // HLS 处理
    let hls: Hls | undefined;
    
    if (isHls && Hls.isSupported()) {
      hls = new Hls({
        startPosition: startTime,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
      });
      
      hls.loadSource(url);
      hls.attachMedia(video);
      
      await new Promise<void>((resolve, reject) => {
        const onManifest = () => {
          hls?.off(Hls.Events.MANIFEST_PARSED, onManifest);
          resolve();
        };
        const onError = (_: unknown, data: { fatal: boolean }) => {
          if (data.fatal) {
            hls?.off(Hls.Events.ERROR, onError);
            reject(new Error('HLS load failed'));
          }
        };
        hls!.on(Hls.Events.MANIFEST_PARSED, onManifest);
        hls!.on(Hls.Events.ERROR, onError);
      });
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生 HLS
      video.src = url;
      await new Promise<void>((resolve) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
    } else {
      // MP4
      video.src = url;
      await new Promise<void>((resolve) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
    }

    // Seek 到起始位置
    video.currentTime = startTime;
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
    });

    // 保存播放状态
    this.currentPlayback = {
      assetId,
      video,
      hls,
      isPlaying: true,
      startTime,
      endTime,
    };

    // 监听时间更新，到 endTime 停止
    const handleTimeUpdate = () => {
      if (video.currentTime >= endTime) {
        this.stopCurrentPlayback();
        onEnded?.();
      }
    };
    video.addEventListener('timeupdate', handleTimeUpdate);

    // 监听播放结束
    video.addEventListener('ended', () => {
      this.stopCurrentPlayback();
      onEnded?.();
    }, { once: true });

    // 开始播放
    try {
      await video.play();
    } catch (error) {
      console.error('[ClipPlaybackService] Play failed:', error);
      // 如果自动播放失败（可能需要用户交互），静音重试
      video.muted = true;
      await video.play();
    }
  }

  /**
   * 停止当前播放
   */
  stopCurrentPlayback(): void {
    if (!this.currentPlayback) return;

    const { video, hls } = this.currentPlayback;
    
    video.pause();
    video.src = '';
    video.load();
    
    if (hls) {
      hls.destroy();
    }
    
    // 从 DOM 移除
    video.parentElement?.removeChild(video);
    
    this.currentPlayback = null;
  }

  /**
   * 暂停/恢复播放
   */
  togglePlayback(): boolean {
    if (!this.currentPlayback) return false;
    
    const { video } = this.currentPlayback;
    
    if (video.paused) {
      video.play();
      this.currentPlayback.isPlaying = true;
    } else {
      video.pause();
      this.currentPlayback.isPlaying = false;
    }
    
    return this.currentPlayback.isPlaying;
  }

  /**
   * 检查是否正在播放
   */
  isPlaying(): boolean {
    return this.currentPlayback?.isPlaying ?? false;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.urlCache.clear();
    this.hlsStatusCache.clear();
  }
}

// 导出全局单例
export const clipPlaybackService = new ClipPlaybackService();
