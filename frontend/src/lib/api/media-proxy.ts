/**
 * 媒体代理工具
 * 支持 Cloudflare Stream 和 Supabase Storage
 */

import { API_BASE_URL } from './client';

// Supabase 项目 ID (从 URL 提取)
const SUPABASE_PROJECT_REF = 'rduiyxvzknaxomrrehzs';

// Cloudflare 通用域名
const CLOUDFLARE_DELIVERY_DOMAIN = 'videodelivery.net';

/**
 * 检查 storage_path 是否是 Cloudflare 视频
 */
export function isCloudflareVideo(storagePath: string | undefined): boolean {
  return storagePath?.startsWith('cloudflare:') ?? false;
}

/**
 * 从 storage_path 提取 Cloudflare UID
 */
export function extractCloudflareUid(storagePath: string): string | null {
  if (storagePath.startsWith('cloudflare:')) {
    return storagePath.replace('cloudflare:', '');
  }
  return null;
}

/**
 * 获取 Cloudflare HLS URL
 */
export function getCloudflareHlsUrl(uid: string): string {
  return `https://${CLOUDFLARE_DELIVERY_DOMAIN}/${uid}/manifest/video.m3u8`;
}

/**
 * 获取 Cloudflare MP4 下载 URL（需先启用）
 */
export function getCloudflareMp4Url(uid: string): string {
  return `https://${CLOUDFLARE_DELIVERY_DOMAIN}/${uid}/downloads/default.mp4`;
}

/**
 * 获取 Cloudflare 缩略图 URL
 */
export function getCloudflareThumbnailUrl(uid: string, timestamp: number = 1): string {
  return `https://${CLOUDFLARE_DELIVERY_DOMAIN}/${uid}/thumbnails/thumbnail.jpg?time=${timestamp}s`;
}

// ============================================
// ★★★ 统一封面图 API ★★★
// ============================================

/**
 * 获取 asset 封面图 URL（统一入口）
 * 
 * 现在后端 API 统一返回 thumbnail_url 字段，前端直接使用即可
 * 这个函数主要用于：
 * 1. 直接使用 API 返回的 thumbnail_url
 * 2. 如果没有 thumbnail_url 但有 assetId，回退到 thumbnail API
 * 
 * @param options - 获取封面图的参数
 * @returns 封面图 URL 或 null
 */
export interface GetThumbnailOptions {
  assetId?: string;           // Asset ID（用于后端 API）
  thumbnailUrl?: string;      // API 返回的 thumbnail_url（直接使用）
}

export function getAssetThumbnailUrl(options: GetThumbnailOptions): string | null {
  const { assetId, thumbnailUrl } = options;
  
  // 1. 优先使用 API 返回的 thumbnail_url
  if (thumbnailUrl) {
    return thumbnailUrl;
  }
  
  // 2. 回退到 thumbnail API
  if (assetId) {
    return `${API_BASE_URL}/assets/${assetId}/thumbnail`;
  }
  
  return null;
}

/**
 * 异步获取 asset 封面图（通过 thumbnail API）
 */
export async function fetchAssetThumbnailUrl(assetId: string): Promise<string | null> {
  return `${API_BASE_URL}/assets/${assetId}/thumbnail`;
}

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
 * 获取视频播放 URL
 * ★ 已简化：Cloudflare 视频优先使用 HLS，其他使用流式代理
 * @deprecated 推荐使用 checkHlsAvailable 获取正确的播放 URL
 */
export function getAssetProxyUrl(assetId: string): string {
  // 保留接口兼容性，后端会自动重定向到 Cloudflare
  return `${API_BASE_URL}/assets/proxy/${assetId}`;
}

/**
 * 智能获取视频 URL
 * ★ 已简化：统一返回流式代理 URL（后端处理 Cloudflare 重定向）
 */
export function getSmartVideoUrl(assetId: string, _preferProxy: boolean = true): string {
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
 * 获取 HLS 播放 URL（别名，用于视频资源层分流）
 * @param assetId - 资源 ID
 */
export const getAssetHlsUrl = getHlsPlaylistUrl;

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
        needsTranscode: false,
        hlsStatus: null,
        canPlayMp4: true,
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
      needsTranscode: data.needs_transcode ?? false,
      hlsStatus: data.hls_status ?? null,
      canPlayMp4: data.can_play_mp4 ?? true,
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
      needsTranscode: false,
      hlsStatus: null,
      canPlayMp4: true,
      isCloudflare: false,
      cloudflareUid: null,
      cloudflareStatus: null,
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
