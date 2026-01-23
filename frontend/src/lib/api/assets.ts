/**
 * 资源管理 API
 */
import type { Asset } from '@/features/editor/types';
import type {
  ApiResponse,
  PresignUploadResponse,
  ConfirmUploadResponse,
  WaveformData,
  ProcessAdditionsStatus,
} from './types';
import { ApiClient } from './client';
import { getAssetStreamUrl } from './media-proxy';
import * as tus from 'tus-js-client';

// ==================== 调试开关 ====================
const DEBUG_UPLOAD = false;  // 上传日志开关
const uploadLog = (...args: unknown[]) => { if (DEBUG_UPLOAD) console.log(...args); };

// Supabase 配置
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// 大文件阈值：超过此大小使用分片上传 (50MB)
const CHUNK_UPLOAD_THRESHOLD = 50 * 1024 * 1024;

// ★★★ 分片大小优化 ★★★
// Supabase 支持最大 50MB/分片，更大的分片 = 更少的请求 = 更快的上传
// 50MB 适合稳定网络，失败重传代价可接受
const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB

// 进度日志节流间隔（毫秒）
const PROGRESS_LOG_THROTTLE = 500;

export class AssetApi extends ApiClient {
  /**
   * 获取资源列表
   */
  async getAssets(params?: {
    project_id?: string;
    type?: string;
    limit?: number;
  }): Promise<ApiResponse<{ items: Asset[] }>> {
    const searchParams = new URLSearchParams();
    if (params?.project_id) searchParams.set('project_id', params.project_id);
    if (params?.type) searchParams.set('type', params.type);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    
    const query = searchParams.toString();
    return this.request(`/assets${query ? `?${query}` : ''}`);
  }

  /**
   * 获取预签名上传 URL
   */
  async presignUpload(data: {
    project_id: string;
    file_name: string;
    file_size: number;
    content_type: string;
  }): Promise<ApiResponse<PresignUploadResponse>> {
    return this.request('/assets/presign-upload', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 确认上传完成
   */
  async confirmUpload(data: {
    asset_id: string;
    project_id: string;
    file_name: string;
    file_size: number;
    content_type: string;
    storage_path: string;
    duration?: number;  // 毫秒
  }): Promise<ApiResponse<ConfirmUploadResponse>> {
    return this.request('/assets/confirm-upload', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 获取资源详情
   */
  async getAsset(assetId: string): Promise<ApiResponse<Asset>> {
    return this.request(`/assets/${assetId}`);
  }

  /**
   * 删除资源
   */
  async deleteAsset(assetId: string): Promise<ApiResponse<{ message: string }>> {
    return this.request(`/assets/${assetId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 获取波形数据
   */
  async getWaveform(assetId: string): Promise<ApiResponse<WaveformData>> {
    return this.request(`/assets/${assetId}/waveform`);
  }

  /**
   * 处理编辑器内添加的新素材
   * 会执行 ASR 转写并将 clips 追加到时间轴末尾
   */
  async processAdditions(data: {
    project_id: string;
    asset_ids: string[];
    enable_asr?: boolean;
    enable_smart_camera?: boolean;
  }): Promise<ApiResponse<{ task_id: string; status: string }>> {
    return this.request('/assets/process-additions', {
      method: 'POST',
      body: JSON.stringify({
        project_id: data.project_id,
        asset_ids: data.asset_ids,
        enable_asr: data.enable_asr ?? true,
        enable_smart_camera: data.enable_smart_camera ?? false,
      }),
    });
  }

  /**
   * 获取素材处理任务状态
   */
  async getProcessAdditionsStatus(taskId: string): Promise<ApiResponse<ProcessAdditionsStatus>> {
    return this.request(`/assets/process-additions/${taskId}`);
  }
}

export const assetApi = new AssetApi();

/**
 * 上传进度回调
 */
export type UploadProgressCallback = (progress: {
  bytesUploaded: number;
  bytesTotal: number;
  percentage: number;
}) => void;

/**
 * 生成唯一的 asset ID
 */
function generateAssetId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 使用 TUS 协议分片上传大文件
 */
async function uploadWithTus(
  file: File,
  storagePath: string,
  onProgress?: UploadProgressCallback
): Promise<void> {
  uploadLog('[TUS Upload] 开始上传:', storagePath, '文件大小:', (file.size / 1024 / 1024).toFixed(1) + 'MB');
  
  const endpoint = `${SUPABASE_URL}/storage/v1/upload/resumable`;
  
  // 进度日志节流
  let lastLogTime = 0;
  let lastPercentage = -1;

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'x-upsert': 'true',  // 允许覆盖已存在的文件
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: 'clips',
        objectName: storagePath,
        contentType: file.type,
        cacheControl: '3600',
      },
      chunkSize: CHUNK_SIZE,
      // ★ 并行上传分片数（提高带宽利用率）
      parallelUploads: 2,
      onError: (error: Error | tus.DetailedError) => {
        console.error('[TUS Upload] 上传失败:', error.message);
        
        // 检查是否是 DetailedError
        if ('originalResponse' in error) {
          const detailedError = error as tus.DetailedError;
          if (detailedError.originalResponse) {
            console.error('[TUS Upload] 状态码:', detailedError.originalResponse.getStatus());
          }
        }
        reject(new Error(`分片上传失败: ${error.message}`));
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const percentage = Math.round((bytesUploaded / bytesTotal) * 100);
        const now = Date.now();
        
        // 节流日志：每 500ms 或进度变化 5% 以上才打印
        if (now - lastLogTime >= PROGRESS_LOG_THROTTLE || 
            percentage - lastPercentage >= 5 || 
            percentage === 100) {
          uploadLog(`[TUS Upload] 进度: ${percentage}%`);
          lastLogTime = now;
          lastPercentage = percentage;
        }
        
        onProgress?.({
          bytesUploaded,
          bytesTotal,
          percentage,
        });
      },
      onSuccess: () => {
        uploadLog('[TUS Upload] ✅ 上传完成');
        resolve();
      },
    });

    // 检查是否有之前未完成的上传可以恢复
    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0) {
        uploadLog('[TUS Upload] 恢复之前的上传...');
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    });
  });
}

/**
 * 使用预签名 URL 直接上传小文件
 */
async function uploadWithPresignedUrl(
  file: File,
  uploadUrl: string,
  onProgress?: UploadProgressCallback
): Promise<void> {
  // 使用 XMLHttpRequest 以支持进度回调
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentage = Math.round((event.loaded / event.total) * 100);
        onProgress?.({
          bytesUploaded: event.loaded,
          bytesTotal: event.total,
          percentage,
        });
      }
    };
    
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`上传失败: HTTP ${xhr.status}`));
      }
    };
    
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.ontimeout = () => reject(new Error('上传超时'));
    
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

/**
 * 便捷函数：上传视频文件
 * - 小文件 (<50MB)：使用预签名 URL 直接上传
 * - 大文件 (>=50MB)：使用 TUS 协议分片上传，支持断点续传
 * 
 * @param file 视频文件
 * @param projectId 项目ID
 * @param duration 视频时长（毫秒），前端本地提取
 * @param onProgress 上传进度回调
 */
export async function uploadVideo(
  file: File,
  projectId?: string,
  duration?: number,
  onProgress?: UploadProgressCallback
): Promise<{
  asset_id: string;
  url: string;
}> {
  const api = new AssetApi();
  const pid = projectId || 'temp-project';
  const useChunkUpload = file.size >= CHUNK_UPLOAD_THRESHOLD;
  
  uploadLog(`[Upload] 文件: ${file.name}, 大小: ${(file.size / 1024 / 1024).toFixed(2)}MB, 使用${useChunkUpload ? '分片' : '直接'}上传`);

  // 1. 获取预签名 URL 和存储路径
  const presignResult = await api.presignUpload({
    project_id: pid,
    file_name: file.name,
    file_size: file.size,
    content_type: file.type,
  });

  if (presignResult.error || !presignResult.data) {
    throw new Error(presignResult.error?.message || '获取上传URL失败');
  }

  const { asset_id, upload_url, storage_path } = presignResult.data;

  // 2. 上传文件
  if (useChunkUpload) {
    // 大文件：使用 TUS 分片上传
    await uploadWithTus(file, storage_path, onProgress);
  } else {
    // 小文件：使用预签名 URL 直接上传
    await uploadWithPresignedUrl(file, upload_url, onProgress);
  }

  // 3. 确认上传完成
  const confirmResult = await api.confirmUpload({
    asset_id,
    project_id: pid,
    file_name: file.name,
    file_size: file.size,
    content_type: file.type,
    storage_path,
    duration,  // 传递视频时长（毫秒）
  });

  if (confirmResult.error || !confirmResult.data) {
    throw new Error(confirmResult.error?.message || '确认上传失败');
  }

  // 使用代理 URL 解决 CORS 问题
  return {
    asset_id: confirmResult.data.id,
    url: getAssetStreamUrl(confirmResult.data.id),
  };
}
