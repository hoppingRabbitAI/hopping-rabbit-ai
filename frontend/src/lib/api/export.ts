/**
 * 导出 API — Visual Editor 主线导出
 */
import type { ApiResponse } from './types';
import type { ExportJob, ExportStartResponse } from './types';
import { ApiClient } from './client';

class ExportApi extends ApiClient {
  /**
   * 创建导出任务
   */
  async startExport(params: {
    project_id: string;
    preset?: string;
    custom_settings?: {
      resolution?: string;
      fps?: number;
      format?: string;
    };
  }): Promise<ApiResponse<ExportStartResponse>> {
    return this.request('/exports', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * 查询导出状态
   */
  async getExportStatus(jobId: string): Promise<ApiResponse<ExportJob>> {
    return this.request(`/exports/${jobId}`);
  }

  /**
   * 轮询导出直到完成
   */
  async pollExportUntilComplete(
    jobId: string,
    options: {
      interval?: number;
      timeout?: number;
      onProgress?: (progress: number, status: string) => void;
    } = {},
  ): Promise<ApiResponse<ExportJob>> {
    const { interval = 2000, timeout = 30 * 60 * 1000, onProgress } = options;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const res = await this.getExportStatus(jobId);

      if (res.error) return res;
      if (!res.data) return { error: { code: 'NO_DATA', message: '无数据' } };

      const { status, progress } = res.data;
      onProgress?.(progress, status);

      if (status === 'completed') return res;
      if (status === 'failed') {
        return {
          error: {
            code: 'EXPORT_FAILED',
            message: res.data.error_message || '导出失败',
          },
        };
      }
      if (status === 'cancelled') {
        return {
          error: { code: 'EXPORT_CANCELLED', message: '导出已取消' },
        };
      }

      await new Promise((r) => setTimeout(r, interval));
    }

    return { error: { code: 'TIMEOUT', message: '导出超时' } };
  }

  /**
   * 获取下载链接
   */
  async getDownloadUrl(jobId: string): Promise<{ url: string }> {
    const res = await this.request<{ url: string }>(`/exports/${jobId}/download`);
    if (res.error || !res.data) {
      throw new Error(res.error?.message || '获取下载链接失败');
    }
    return res.data;
  }

  /**
   * 获取当前用户的导出列表
   */
  async getUserExports(): Promise<ApiResponse<ExportJob[]>> {
    return this.request('/exports');
  }

  /**
   * 取消导出任务
   */
  async cancelExport(jobId: string): Promise<void> {
    await this.request(`/exports/${jobId}/cancel`, { method: 'POST' });
  }

  /**
   * 删除导出记录
   */
  async deleteExport(jobId: string): Promise<void> {
    await this.request(`/exports/${jobId}`, { method: 'DELETE' });
  }
}

export const exportApi = new ExportApi();
