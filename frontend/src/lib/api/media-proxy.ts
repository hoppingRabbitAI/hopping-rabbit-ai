/**
 * 媒体代理工具
 * 支持 Cloudflare Stream 和 Supabase Storage
 */

import { API_BASE_URL } from './client';

/**
 * 为 asset 获取流式代理 URL
 * 这是最可靠的方式，因为后端会处理签名 URL 的获取
 */
export function getAssetStreamUrl(assetId: string): string {
  return `${API_BASE_URL}/assets/stream/${assetId}`;
}

/**
 * 获取视频播放 URL
 * ★ 已简化：Cloudflare 视频优先使用 HLS，其他使用流式代理
 * @deprecated 推荐使用 checkHlsAvailable 获取正确的播放 URL
 */
export function getAssetProxyUrl(assetId: string): string {
  // 保留接口兼容性，后端会自动重定向到 Cloudflare
  return `${API_BASE_URL}/assets/proxy/${assetId}`;
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
 * 获取 HLS 播放 URL（别名，用于视频资源层分流）
 * @param assetId - 资源 ID
 */
export const getAssetHlsUrl = getHlsPlaylistUrl;

/**
 * 获取 HLS 状态检查 URL
 * @param assetId - 资源 ID  
 */
function getHlsStatusUrl(assetId: string): string {
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
interface HlsStatus {
  available: boolean;
  playlistUrl: string | null;
  assetStatus: string | null;
  hlsStatus: string | null;  // ★ HLS 生成状态: pending/processing/ready/failed
  isCloudflare: boolean;     // ★ 是否是 Cloudflare 视频
  cloudflareUid: string | null;  // ★ Cloudflare UID
  cloudflareStatus: string | null;  // ★ Cloudflare 状态: uploading/processing/ready/error
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
        hlsStatus: null,
        isCloudflare: false,
        cloudflareUid: null,
        cloudflareStatus: null,
      };
    }
    const data = await response.json();
    debugLog('✅ HLS 状态:', data);
    
    // 检查是否是 Cloudflare 视频
    const storagePath = data.storage_path ?? '';
    const isCloudflare = storagePath.startsWith('cloudflare:');
    const cloudflareUid = isCloudflare ? storagePath.replace('cloudflare:', '') : null;
    
    return {
      available: data.available ?? false,
      playlistUrl: data.playlist_url ?? null,
      assetStatus: data.asset_status ?? null,
      hlsStatus: data.hls_status ?? null,
      isCloudflare,
      cloudflareUid,
      cloudflareStatus: data.cloudflare_status ?? null,
    };
  } catch (error) {
    debugLog('❌ HLS 检查失败:', error);
    return { 
      available: false, 
      playlistUrl: null, 
      assetStatus: null,
      hlsStatus: null,
      isCloudflare: false,
      cloudflareUid: null,
      cloudflareStatus: null,
    };
  }
}
