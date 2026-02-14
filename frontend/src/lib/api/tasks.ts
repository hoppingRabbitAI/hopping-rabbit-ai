/**
 * AI 任务 API
 */
import type { TaskStatus } from '@/types/editor';
import type { ApiResponse, TaskStartResponse, TaskResultWithData } from './types';
import { ApiClient } from './client';

class TaskApi extends ApiClient {
  /**
   * 启动 ASR 语音转写任务（针对整个 asset）
   */
  async startASRTask(data: {
    asset_id: string;
    language?: string;
    model?: string;
    enable_diarization?: boolean;
    enable_word_timestamps?: boolean;
  }): Promise<ApiResponse<TaskStartResponse>> {
    return this.request('/tasks/asr', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 启动 ASR 语音转写任务（针对特定 clip，只转写 clip 时间范围）
   */
  async startASRClipTask(data: {
    clip_id: string;
    language?: string;
    model?: string;
  }): Promise<ApiResponse<TaskStartResponse>> {
    return this.request('/tasks/asr-clip', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 启动音频人声分离任务
   */
  async startStemSeparation(data: {
    asset_id: string;
    model?: string;
    stems?: string[];
  }): Promise<ApiResponse<TaskStartResponse>> {
    return this.request('/tasks/stem-separation', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 启动提取视频音频任务（把视频声音单独抽出来）
   */
  async startExtractAudio(data: {
    asset_id: string;
    format?: 'wav' | 'mp3' | 'aac';
    source_start?: number;  // 殥秒，从原视频哪个位置开始
    duration?: number;  // 殥秒，截取多长
  }): Promise<ApiResponse<TaskStartResponse>> {
    return this.request('/tasks/extract-audio', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 启动说话人分离任务
   */
  async startDiarization(data: {
    asset_id: string;
    num_speakers?: number;
    min_speakers?: number;
    max_speakers?: number;
  }): Promise<ApiResponse<TaskStartResponse>> {
    return this.request('/tasks/diarization', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 获取任务状态
   */
  async getTaskStatus(taskId: string): Promise<ApiResponse<TaskStatus>> {
    return this.request(`/tasks/${taskId}`);
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<ApiResponse<{ message: string }>> {
    return this.request(`/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 轮询任务状态直到完成
   */
  async pollTaskUntilComplete<T = unknown>(
    taskId: string,
    options: {
      interval?: number;
      timeout?: number;
      onProgress?: (progress: number, step?: string) => void;
    } = {}
  ): Promise<ApiResponse<TaskResultWithData<T>>> {
    const { interval = 2000, timeout = 600000, onProgress } = options;
    const startTime = Date.now();

    while (true) {
      const response = await this.getTaskStatus(taskId);
      
      if (response.error) {
        return { error: response.error };
      }

      const task = response.data;
      if (!task) {
        return { error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } };
      }

      // 回调进度
      if (onProgress) {
        onProgress(task.progress || 0, task.current_step);
      }

      // 检查完成状态
      if (task.status === 'completed') {
        return { data: task as TaskResultWithData<T> };
      }

      if (task.status === 'failed') {
        return {
          error: {
            code: 'TASK_FAILED',
            message: task.error || '任务执行失败',
          },
        };
      }

      if (task.status === 'cancelled') {
        return {
          error: {
            code: 'TASK_CANCELLED',
            message: '任务已取消',
          },
        };
      }

      // 检查超时
      if (Date.now() - startTime > timeout) {
        return {
          error: {
            code: 'TASK_TIMEOUT',
            message: '任务执行超时',
          },
        };
      }

      // 等待下一次轮询
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

export const taskApi = new TaskApi();
