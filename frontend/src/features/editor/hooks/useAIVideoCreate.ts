/**
 * 一键 AI 成片 Hook
 * 处理 AI 成片的任务提交和状态轮询
 */
import { useState, useCallback } from 'react';
import { smartApi, type AIVideoCreateRequest, type AIVideoCreateResult } from '@/lib/api/smart';
import { taskApi } from '@/lib/api/tasks';

export type AICreateStatus = 'idle' | 'processing' | 'completed' | 'failed';

export interface AICreateState {
  status: AICreateStatus;
  progress: number;
  message: string;
  taskId: string | null;
  result: AIVideoCreateResult | null;
  error: string | null;
}

export function useAIVideoCreate() {
  const [state, setState] = useState<AICreateState>({
    status: 'idle',
    progress: 0,
    message: '',
    taskId: null,
    result: null,
    error: null,
  });

  /**
   * 启动一键成片任务
   */
  const startAICreate = useCallback(async (
    projectId: string,
    videoPath: string,
    audioUrl: string,
    options?: { enable_llm?: boolean }
  ) => {
    setState({
      status: 'processing',
      progress: 0,
      message: '正在启动 AI 成片...',
      taskId: null,
      result: null,
      error: null,
    });

    try {
      // 1. 提交任务
      const response = await smartApi.aiVideoCreate({
        project_id: projectId,
        video_path: videoPath,
        audio_url: audioUrl,
        options,
      });

      if (response.error || !response.data) {
        throw new Error(response.error?.message || '启动任务失败');
      }

      const taskId = response.data.task_id;
      
      setState(prev => ({
        ...prev,
        taskId,
        progress: 5,
        message: response.data?.message || '任务已提交，正在处理...',
      }));

      // 2. 轮询任务状态
      const result = await taskApi.pollTaskUntilComplete<AIVideoCreateResult>(
        taskId,
        {
          interval: 2000,
          timeout: 600000, // 10 分钟超时
          onProgress: (progress, step) => {
            setState(prev => ({
              ...prev,
              progress,
              message: getProgressMessage(progress, step),
            }));
          },
        }
      );

      if (result.error) {
        throw new Error(result.error.message);
      }

      // 3. 完成
      setState({
        status: 'completed',
        progress: 100,
        message: '🎉 AI 成片完成！',
        taskId,
        result: result.data?.result || null,
        error: null,
      });

      return result.data?.result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'AI 成片失败';
      
      setState(prev => ({
        ...prev,
        status: 'failed',
        message: errorMessage,
        error: errorMessage,
      }));

      throw error;
    }
  }, []);

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    setState({
      status: 'idle',
      progress: 0,
      message: '',
      taskId: null,
      result: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    startAICreate,
    reset,
    isProcessing: state.status === 'processing',
    isCompleted: state.status === 'completed',
    isFailed: state.status === 'failed',
  };
}

/**
 * 根据进度生成友好的提示消息
 */
function getProgressMessage(progress: number, step?: string): string {
  if (step) return step;
  
  if (progress < 20) {
    return '正在识别语音内容...';
  } else if (progress < 40) {
    return '正在分析画面主体...';
  } else if (progress < 60) {
    return '正在生成智能运镜...';
  } else if (progress < 80) {
    return '正在生成字幕...';
  } else if (progress < 95) {
    return '正在保存剪辑数据...';
  } else {
    return '即将完成...';
  }
}
