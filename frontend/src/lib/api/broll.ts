/**
 * B-roll API 客户端
 * 提供 B-roll 视频搜索和下载功能
 */

import { ApiClient } from './client';
import type { ApiResponse } from './types';

export interface DownloadBRollRequest {
  project_id: string;
  video: {
    id: number;
    url: string;
    width: number;
    height: number;
    duration: number;
    thumbnail: string;
    source: string;
    author?: string; // 后端使用 author 字段
    author_url?: string;
    original_url?: string;
  };
}

export interface DownloadBRollResponse {
  asset_id: string;
  task_id: string;
  download_status: 'downloading' | 'completed' | 'failed';
}

export interface DownloadStatusResponse {
  status: 'downloading' | 'uploading' | 'completed' | 'failed';
  progress: number;
  total_bytes?: number;
  downloaded_bytes?: number;
  asset_id: string;
  error?: string;
}

// B-roll 搜索相关类型
export interface BRollVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}

export interface BRollVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  image: string;
  video_files: BRollVideoFile[];
  url: string;
  user: {
    id: number;
    name: string;
    url: string;
  };
}

export interface BRollSearchResponse {
  source: string;
  page: number;
  per_page: number;
  total_results: number;
  videos: BRollVideo[];
}

// Kling AI 相关类型
export interface KlingTextToVideoRequest {
  project_id: string;
  prompt: string;
  duration: number;
  aspect_ratio: string;
  mode: string;
}

export interface KlingTextToVideoResponse {
  task_id: string;
  status: string;
}

export interface KlingTask {
  task_id: string;
  prompt: string;
  status: string;
  video_url?: string;
  asset_id?: string;
  created_at: string;
}

export interface KlingTasksResponse {
  tasks: KlingTask[];
}

export class BRollApi extends ApiClient {
  /**
   * 搜索 B-roll 视频
   */
  async searchVideos(query: string, page: number = 1, perPage: number = 20): Promise<ApiResponse<BRollSearchResponse>> {
    const params = new URLSearchParams({
      query,
      page: String(page),
      per_page: String(perPage),
    });
    return this.request<BRollSearchResponse>(`/broll/search?${params.toString()}`);
  }

  /**
   * 下载 B-roll 视频到项目资源库
   * 
   * 将外部 B-roll 视频（如 Pexels）下载到我们的系统，
   * 并创建对应的 asset 记录
   */
  async downloadBRoll(request: DownloadBRollRequest): Promise<ApiResponse<DownloadBRollResponse>> {
    return this.request<DownloadBRollResponse>('/broll/download', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * 查询下载进度
   * 
   * 轮询此 API 获取下载和上传进度
   */
  async getDownloadStatus(taskId: string): Promise<ApiResponse<DownloadStatusResponse>> {
    return this.request<DownloadStatusResponse>(`/broll/download/${taskId}/status`);
  }

  /**
   * 轮询等待下载完成
   * 
   * @param taskId 任务 ID
   * @param onProgress 进度回调
   * @param maxRetries 最大重试次数
   * @param interval 轮询间隔（毫秒）
   * @returns 最终的下载状态
   */
  async waitForDownload(
    taskId: string,
    onProgress?: (status: DownloadStatusResponse) => void,
    maxRetries: number = 60,
    interval: number = 2000
  ): Promise<DownloadStatusResponse> {
    let retries = 0;
    const startTime = Date.now();
    console.log(`[BRollApi] 🚀 开始轮询下载状态: taskId=${taskId}, startTime=${new Date().toISOString()}`);

    while (retries < maxRetries) {
      try {
        const pollStart = Date.now();
        const response = await this.getDownloadStatus(taskId);
        const pollDuration = Date.now() - pollStart;
        
        // 处理错误响应
        if (response.error || !response.data) {
          console.error(`[BRollApi] ❌ 轮询 ${retries}/${maxRetries} 失败 (${pollDuration}ms):`, response.error);
          throw new Error(response.error?.message || '获取下载状态失败');
        }
        
        const status = response.data;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[BRollApi] 📊 轮询 ${retries}/${maxRetries} (${elapsed}s): status=${status.status}, progress=${status.progress}%, pollDuration=${pollDuration}ms, assetId=${status.asset_id || 'N/A'}`);
        
        // 回调进度
        if (onProgress) {
          onProgress(status);
        }

        // 成功或失败，返回结果
        if (status.status === 'completed' || status.status === 'failed') {
          const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[BRollApi] ${status.status === 'completed' ? '✅' : '❌'} 下载${status.status === 'completed' ? '完成' : '失败'}: 总耗时=${totalTime}s, assetId=${status.asset_id}`);
          return status;
        }

        // 等待后继续轮询
        await new Promise(resolve => setTimeout(resolve, interval));
        retries++;
      } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[BRollApi] ⚠️ 轮询异常 ${retries}/${maxRetries} (${elapsed}s):`, error);
        retries++;
        
        // 如果是最后一次重试，抛出错误
        if (retries >= maxRetries) {
          console.error(`[BRollApi] ❌ 轮询超时: 已重试 ${maxRetries} 次`);
          throw new Error('下载超时或失败');
        }
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }

    throw new Error('下载超时');
  }

  /**
   * Kling AI 文生视频
   */
  async klingTextToVideo(request: KlingTextToVideoRequest): Promise<ApiResponse<KlingTextToVideoResponse>> {
    return this.request<KlingTextToVideoResponse>('/kling/text-to-video', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * 获取 Kling 任务列表
   */
  async getKlingTasks(projectId: string): Promise<ApiResponse<KlingTasksResponse>> {
    return this.request<KlingTasksResponse>(`/broll/kling/tasks?project_id=${projectId}`);
  }
}

// 导出单例实例
export const brollApi = new BRollApi();
