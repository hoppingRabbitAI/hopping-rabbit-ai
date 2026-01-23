/**
 * 媒体代理工具
 * 解决 Supabase Storage CORS 问题
 */

import { API_BASE_URL } from './client';

// Supabase 项目 ID (从 URL 提取)
const SUPABASE_PROJECT_REF = 'rduiyxvzknaxomrrehzs';

/**
 * 将媒体 URL 转换为代理 URL（用于解决 CORS 问题）
 * 
 * @param url - 原始 URL (可能是 Supabase Storage URL 或其他)
 * @param assetId - 可选的 asset ID，用于后端代理
 * @returns 代理后的 URL 或原始 URL
 */
export function getProxyUrl(url: string | undefined, assetId?: string): string {
  if (!url) return '';
  
  // 如果提供了 assetId，使用后端流式代理
  if (assetId) {
    return `${API_BASE_URL}/assets/stream/${assetId}`;
  }
  
  // 检查是否是 Supabase Storage URL
  if (url.includes('.supabase.co/storage/')) {
    // 提取 storage 路径并使用代理
    // 原始 URL 格式: https://xxx.supabase.co/storage/v1/object/sign/bucket/path?token=xxx
    try {
      const urlObj = new URL(url);
      // 获取 /storage/v1/ 之后的部分
      const pathMatch = urlObj.pathname.match(/\/storage\/v1\/(.*)/);
      if (pathMatch) {
        const storagePath = pathMatch[1] + urlObj.search;
        // 使用 Next.js 代理
        return `/api/storage/${storagePath}`;
      }
    } catch {
      // URL 解析失败，返回原始 URL
    }
  }
  
  return url;
}

/**
 * 检查 URL 是否需要代理
 */
export function needsProxy(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes('.supabase.co/storage/');
}

/**
 * 为 asset 获取流式代理 URL
 * 这是最可靠的方式，因为后端会处理签名 URL 的获取
 */
export function getAssetStreamUrl(assetId: string): string {
  return `${API_BASE_URL}/assets/stream/${assetId}`;
}

/**
 * 获取代理视频 URL（720p 低码率版本，用于编辑预览）
 * 如果代理视频不存在，返回原始视频 URL
 */
export function getAssetProxyUrl(assetId: string): string {
  return `${API_BASE_URL}/assets/proxy/${assetId}`;
}

/**
 * 智能获取视频 URL
 * 优先使用代理视频（加载快），如果不存在则使用原始视频
 * @param assetId - 资源 ID
 * @param preferProxy - 是否优先使用代理视频（默认 true）
 */
export function getSmartVideoUrl(assetId: string, preferProxy: boolean = true): string {
  if (preferProxy) {
    return getAssetProxyUrl(assetId);
  }
  return getAssetStreamUrl(assetId);
}

// ============================================
// HLS 流式播放 API
// ============================================

/**
 * 获取 HLS 播放列表 URL
 * @param assetId - 资源 ID
 */
export function getHlsPlaylistUrl(assetId: string): string {
  return `${API_BASE_URL}/assets/hls/${assetId}/playlist.m3u8`;
}

/**
 * 获取 HLS 状态检查 URL
 * @param assetId - 资源 ID  
 */
export function getHlsStatusUrl(assetId: string): string {
  return `${API_BASE_URL}/assets/hls/${assetId}/status`;
}

// 调试开关 - ★ 已关闭，视频缓冲日志在 VideoCanvasStore 中
const DEBUG_ENABLED = false;
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[MediaProxy]', ...args); };

/**
 * 检查资源是否有 HLS 流可用
 * @param assetId - 资源 ID
 * @returns Promise<HlsStatus>
 */
export interface HlsStatus {
  available: boolean;
  playlistUrl: string | null;
  assetStatus: string | null;
  needsTranscode: boolean;  // ★ 是否需要转码（ProRes 等）
  hlsStatus: string | null;  // ★ HLS 生成状态: pending/processing/ready/failed
  canPlayMp4: boolean;       // ★ 是否可以直接播放 MP4
}

export async function checkHlsAvailable(assetId: string): Promise<HlsStatus> {
  const url = getHlsStatusUrl(assetId);
  debugLog('🔍 检查 HLS 可用性:', url);
  
  try {
    const response = await fetch(url);
    debugLog('📡 HLS 状态响应:', response.status, response.ok);
    
    if (!response.ok) {
      debugLog('⚠️ HLS 状态非 OK:', response.status);
      return { 
        available: false, 
        playlistUrl: null, 
        assetStatus: null,
        needsTranscode: false,
        hlsStatus: null,
        canPlayMp4: true,
      };
    }
    const data = await response.json();
    debugLog('✅ HLS 状态:', data);
    return {
      available: data.available ?? false,
      playlistUrl: data.playlist_url ?? null,
      assetStatus: data.asset_status ?? null,
      needsTranscode: data.needs_transcode ?? false,
      hlsStatus: data.hls_status ?? null,
      canPlayMp4: data.can_play_mp4 ?? true,
    };
  } catch (error) {
    debugLog('❌ HLS 检查失败:', error);
    return { 
      available: false, 
      playlistUrl: null, 
      assetStatus: null,
      needsTranscode: false,
      hlsStatus: null,
      canPlayMp4: true,
    };
  }
}

/**
 * 智能获取视频播放 URL（优先 HLS）
 * 
 * 决策逻辑：
 * 1. 如果 HLS 可用 → 返回 HLS playlist URL
 * 2. 否则回退到代理视频 URL
 * 
 * @param assetId - 资源 ID
 * @returns Promise<{ url: string, type: 'hls' | 'mp4' }>
 */
export async function getSmartPlaybackUrl(assetId: string): Promise<{
  url: string;
  type: 'hls' | 'mp4';
}> {
  const hlsStatus = await checkHlsAvailable(assetId);
  
  if (hlsStatus.available && hlsStatus.playlistUrl) {
    return {
      url: hlsStatus.playlistUrl,
      type: 'hls',
    };
  }
  
  // 回退到代理视频
  return {
    url: getAssetProxyUrl(assetId),
    type: 'mp4',
  };
}
