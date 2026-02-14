/**
 * Cloudflare Stream 上传模块
 * 使用 TUS 协议直传视频到 Cloudflare，无需经过 Supabase
 */
import * as tus from 'tus-js-client';
import { ApiClient } from './client';

// ==================== 调试开关 ====================
const DEBUG_CF = false;  // ★ 关闭上传进度日志
const cfLog = (...args: unknown[]) => { if (DEBUG_CF) console.log('[CF Stream]', ...args); };

// 进度日志节流间隔（毫秒）
const PROGRESS_LOG_THROTTLE = 500;

// TUS 分片大小（Cloudflare 建议 5-200MB）
// 大分片减少 HTTP 开销，但断点续传粒度变粗
const CF_CHUNK_SIZE = 100 * 1024 * 1024;  // 100MB - 稳定网络用大分片

// ==================== API 响应类型 ====================
interface CreateUploadResponse {
  upload_url: string;
  video_uid: string;
  asset_id: string;
}

interface VideoStatusResponse {
  asset_id: string;
  cloudflare_uid: string | null;
  cloudflare_status: 'none' | 'uploading' | 'processing' | 'ready' | 'error';
  hls_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  is_ready: boolean;
}

interface CloudflareServiceStatus {
  configured: boolean;
  service: string;
}

// ==================== API 客户端 ====================
class CloudflareStreamApi extends ApiClient {
  /**
   * 检查 Cloudflare Stream 服务状态
   */
  async getServiceStatus(): Promise<CloudflareServiceStatus | null> {
    const result = await this.request<CloudflareServiceStatus>('/cloudflare/status');
    return result.data || null;
  }

  /**
   * 创建直传上传 URL
   * @param assetId 关联的 asset ID
   * @param fileSize 文件大小（字节）- TUS 协议必须
   * @param maxDurationSeconds 最大视频时长
   */
  async createUpload(assetId: string, fileSize: number, maxDurationSeconds: number = 3600): Promise<CreateUploadResponse | null> {
    const result = await this.request<CreateUploadResponse>('/cloudflare/upload/create', {
      method: 'POST',
      body: JSON.stringify({
        asset_id: assetId,
        file_size: fileSize,
        max_duration_seconds: maxDurationSeconds,
      }),
    });
    return result.data || null;
  }

  /**
   * 通知上传完成
   */
  async notifyUploadComplete(assetId: string): Promise<boolean> {
    const result = await this.request<{ status: string }>(`/cloudflare/upload/complete/${assetId}`, {
      method: 'POST',
    });
    return result.data?.status === 'ok';
  }

  /**
   * 获取视频状态
   */
  async getVideoStatus(assetId: string): Promise<VideoStatusResponse | null> {
    const result = await this.request<VideoStatusResponse>(`/cloudflare/video/${assetId}`);
    return result.data || null;
  }

  /**
   * 从 URL 上传（用于迁移现有视频）
   */
  async uploadFromUrl(assetId: string, videoUrl: string): Promise<boolean> {
    const result = await this.request<{ status: string }>('/cloudflare/upload/from-url', {
      method: 'POST',
      body: JSON.stringify({
        asset_id: assetId,
        video_url: videoUrl,
      }),
    });
    return result.data?.status === 'ok';
  }
}

const cloudflareApi = new CloudflareStreamApi();

// ==================== 上传进度回调 ====================
export type UploadProgressCallback = (progress: {
  bytesUploaded: number;
  bytesTotal: number;
  percentage: number;
  phase: 'uploading' | 'processing' | 'ready';
}) => void;

// ==================== TUS 上传到 Cloudflare ====================
/**
 * 使用 TUS 协议上传视频到 Cloudflare Stream
 */
async function uploadWithCloudflareTus(
  file: File,
  uploadUrl: string,
  onProgress?: UploadProgressCallback
): Promise<void> {
  cfLog('开始 TUS 上传到 Cloudflare:', uploadUrl.substring(0, 50) + '...');
  cfLog('文件大小:', (file.size / 1024 / 1024).toFixed(1) + 'MB');

  let lastLogTime = 0;
  let lastPercentage = -1;

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: uploadUrl,
      uploadUrl: uploadUrl,  // Cloudflare 返回的就是完整 URL
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: CF_CHUNK_SIZE,
      metadata: {
        filename: file.name,
        filetype: file.type,
      },
      onError: (error: Error | tus.DetailedError) => {
        console.error('[CF Stream] 上传失败:', error.message);
        reject(new Error(`Cloudflare 上传失败: ${error.message}`));
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const percentage = Math.round((bytesUploaded / bytesTotal) * 100);
        const now = Date.now();

        // 节流日志
        if (now - lastLogTime >= PROGRESS_LOG_THROTTLE ||
            percentage - lastPercentage >= 5 ||
            percentage === 100) {
          cfLog(`上传进度: ${percentage}%`);
          lastLogTime = now;
          lastPercentage = percentage;
        }

        onProgress?.({
          bytesUploaded,
          bytesTotal,
          percentage,
          phase: 'uploading',
        });
      },
      onSuccess: () => {
        cfLog('✅ TUS 上传完成');
        resolve();
      },
    });

    // 直接开始上传（Cloudflare 不需要查找之前的上传）
    upload.start();
  });
}

// ==================== 等待视频就绪 ====================
/**
 * 轮询等待 Cloudflare 转码完成
 */
async function waitForVideoReady(
  assetId: string,
  onProgress?: UploadProgressCallback,
  timeoutMs: number = 600000  // 10分钟超时
): Promise<VideoStatusResponse> {
  const startTime = Date.now();
  const pollInterval = 2000;  // 2秒轮询

  cfLog('等待视频转码完成...');

  // 显示处理中状态
  onProgress?.({
    bytesUploaded: 100,
    bytesTotal: 100,
    percentage: 100,
    phase: 'processing',
  });

  while (Date.now() - startTime < timeoutMs) {
    const status = await cloudflareApi.getVideoStatus(assetId);
    
    if (!status) {
      throw new Error('获取视频状态失败');
    }

    cfLog('视频状态:', status.cloudflare_status);

    if (status.cloudflare_status === 'ready') {
      onProgress?.({
        bytesUploaded: 100,
        bytesTotal: 100,
        percentage: 100,
        phase: 'ready',
      });
      return status;
    }

    if (status.cloudflare_status === 'error') {
      throw new Error('Cloudflare 转码失败');
    }

    // 等待后继续轮询
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('等待视频转码超时');
}

// ==================== 主上传函数 ====================
/**
 * 上传视频到 Cloudflare Stream
 * 
 * 流程：
 * 1. 创建 asset 记录并获取 Cloudflare 上传 URL
 * 2. 使用 TUS 协议直传到 Cloudflare
 * 3. 通知后端上传完成
 * 4. (可选) 等待转码完成
 * 
 * @param file 视频文件
 * @param assetId 预先创建的 asset ID
 * @param onProgress 进度回调
 * @param waitForReady 是否等待转码完成（默认 false，后台处理）
 */
export async function uploadToCloudflare(
  file: File,
  assetId: string,
  onProgress?: UploadProgressCallback,
  waitForReady: boolean = false
): Promise<{
  asset_id: string;
  cloudflare_uid: string;
  hls_url: string | null;
  is_ready: boolean;
}> {
  cfLog('开始 Cloudflare Stream 上传流程');
  cfLog('Asset ID:', assetId);
  cfLog('文件:', file.name, '大小:', (file.size / 1024 / 1024).toFixed(1) + 'MB');

  // 1. 创建上传 URL（传入文件大小，TUS 协议必须）
  const uploadInfo = await cloudflareApi.createUpload(assetId, file.size);
  if (!uploadInfo) {
    throw new Error('创建 Cloudflare 上传 URL 失败');
  }

  cfLog('获取到上传 URL, video_uid:', uploadInfo.video_uid);

  // 2. TUS 上传
  await uploadWithCloudflareTus(file, uploadInfo.upload_url, onProgress);

  // 3. 通知后端上传完成
  const notified = await cloudflareApi.notifyUploadComplete(assetId);
  if (!notified) {
    console.warn('[CF Stream] 通知后端上传完成失败，但文件已上传');
  }

  // 4. 等待转码完成（可选）
  if (waitForReady) {
    const status = await waitForVideoReady(assetId, onProgress);
    return {
      asset_id: assetId,
      cloudflare_uid: uploadInfo.video_uid,
      hls_url: status.hls_url,
      is_ready: true,
    };
  }

  // 不等待，返回处理中状态
  return {
    asset_id: assetId,
    cloudflare_uid: uploadInfo.video_uid,
    hls_url: null,
    is_ready: false,
  };
}
