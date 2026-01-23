/**
 * 导出 API
 */
import type { Timeline } from '@/features/editor/types';
import type { ApiResponse, ExportJob, ExportStartResponse } from './types';
import { ApiClient } from './client';

export class ExportApi extends ApiClient {
  /**
   * 启动视频导出任务
   */
  async startExport(data: {
    project_id: string;
    preset?: string;
    custom_settings?: {
      resolution?: { width: number; height: number };
      fps?: number;
      video_codec?: string;
      video_bitrate?: string;
      audio_codec?: string;
      audio_bitrate?: string;
      format?: string;  // 输出格式：mp4, mov 等
    };
    timeline?: Timeline;
  }): Promise<ApiResponse<ExportStartResponse>> {
    return this.request('/export', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 获取导出任务状态
   */
  async getExportStatus(jobId: string): Promise<ApiResponse<ExportJob>> {
    return this.request(`/export/${jobId}`);
  }

  /**
   * 取消导出任务（进行中的任务）
   */
  async cancelExport(jobId: string): Promise<ApiResponse<{ message: string }>> {
    return this.request(`/export/${jobId}/cancel`, {
      method: 'POST',
    });
  }

  /**
   * 删除导出记录（已完成/失败的记录）
   */
  async deleteExport(jobId: string): Promise<ApiResponse<{ message: string }>> {
    return this.request(`/export/${jobId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 重试失败的导出任务
   */
  async retryExport(jobId: string): Promise<ApiResponse<{ 
    success: boolean; 
    job_id: string; 
    original_job_id: string;
    status: string;
    message: string;
  }>> {
    return this.request(`/export/${jobId}/retry`, {
      method: 'POST',
    });
  }

  /**
   * 获取导出文件的下载链接
   */
  async getDownloadUrl(jobId: string): Promise<{ url: string; expires_in: number }> {
    const response = await this.request<{ url: string; expires_in: number }>(
      `/export/${jobId}/download-url`
    );
    if (response.error || !response.data) {
      throw new Error(response.error?.message || '获取下载链接失败');
    }
    return response.data;
  }

  /**
   * 获取项目的导出历史
   */
  async getExportList(projectId: string, limit: number = 20): Promise<ApiResponse<{ exports: ExportJob[] }>> {
    return this.request(`/export/list/${projectId}?limit=${limit}`);
  }

  /**
   * 获取用户的所有导出历史（跨项目）
   */
  async getUserExports(limit: number = 50): Promise<ApiResponse<{ exports: (ExportJob & { project_name?: string })[] }>> {
    return this.request(`/export/user-exports?limit=${limit}`);
  }

  /**
   * 轮询导出状态直到完成
   */
  async pollExportUntilComplete(
    jobId: string,
    options: {
      interval?: number;
      timeout?: number;
      onProgress?: (progress: number, status: string) => void;
    } = {}
  ): Promise<ApiResponse<ExportJob>> {
    const { interval = 3000, timeout = 1800000, onProgress } = options;
    const startTime = Date.now();

    while (true) {
      const response = await this.getExportStatus(jobId);
      
      if (response.error) {
        return response;
      }

      const job = response.data;
      if (!job) {
        return { error: { code: 'JOB_NOT_FOUND', message: '导出任务不存在' } };
      }

      // 回调进度
      if (onProgress) {
        onProgress(job.progress, job.status);
      }

      // 检查完成状态
      if (job.status === 'completed') {
        return { data: job };
      }

      if (job.status === 'failed') {
        return {
          error: {
            code: 'EXPORT_FAILED',
            message: job.error_message || '导出失败',
          },
        };
      }

      // 检查超时
      if (Date.now() - startTime > timeout) {
        return {
          error: {
            code: 'EXPORT_TIMEOUT',
            message: '导出超时',
          },
        };
      }

      // 等待下一次轮询
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

export const exportApi = new ExportApi();

/**
 * 便捷函数：导出视频
 */
export async function exportVideo(
  projectId: string,
  config?: {
    resolution?: '1080p' | '720p' | '480p';
    format?: 'mp4' | 'webm';  // 社交媒体发布只需要这两种格式
  }
): Promise<string> {
  const api = new ExportApi();
  
  const resolutionMap = {
    '1080p': { width: 1920, height: 1080 },
    '720p': { width: 1280, height: 720 },
    '480p': { width: 854, height: 480 },
  };

  // 1. 启动导出任务
  const startResult = await api.startExport({
    project_id: projectId,
    custom_settings: config?.resolution
      ? { resolution: resolutionMap[config.resolution] }
      : undefined,
  });

  if (startResult.error || !startResult.data) {
    throw new Error(startResult.error?.message || '启动导出失败');
  }

  // 2. 轮询直到完成
  const result = await api.pollExportUntilComplete(startResult.data.job_id);

  if (result.error || !result.data?.output_url) {
    throw new Error(result.error?.message || '导出失败');
  }

  return result.data.output_url;
}
