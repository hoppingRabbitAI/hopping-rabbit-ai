/**
 * 背景替换工作流 Hook
 * 管理工作流的创建、状态监听和结果处理
 */

'use client';

import { useState, useCallback } from 'react';
import { getSessionSafe } from '@/lib/supabase/session';

export interface WorkflowState {
  isActive: boolean;
  workflowId: string | null;
  clipId: string | null;  // ★★★ 治本：保存 clipId，用于任务完成后更新 shot ★★★
  status: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
  currentStage: string;
  stageProgress: number;
  overallProgress: number;
  message?: string;
  error?: string;
  resultUrl?: string;
  
  // [新增] 策略相关
  detectedStrategy?: 'background_only' | 'person_minor_edit' | 'person_major_edit';
  strategyConfidence?: number;
  strategyRecommendation?: string;
}

const initialState: WorkflowState = {
  isActive: false,
  workflowId: null,
  clipId: null,  // ★★★ 治本：初始化 clipId ★★★
  status: 'idle',
  currentStage: '',
  stageProgress: 0,
  overallProgress: 0,
};

export function useBackgroundReplaceWorkflow() {
  const [state, setState] = useState<WorkflowState>(initialState);

  /**
   * 启动背景替换工作流
   */
  const startWorkflow = useCallback(async (params: {
    clipId: string;
    projectId?: string;
    videoUrl: string;
    backgroundImageUrl: string;
    originalPrompt?: string;
    previewImageUrl?: string;
    // [新增] 智能分片参数
    durationMs?: number;    // 视频时长（毫秒），用于智能分片
    transcript?: string;    // 转写文本，用于分句策略
    // [新增] 编辑相关参数
    editMaskUrl?: string;
    editedFrameUrl?: string;
    originalAudioUrl?: string;
    forceStrategy?: 'background_only' | 'person_minor_edit' | 'person_major_edit';
  }): Promise<string> => {
    setState(prev => ({
      ...prev,
      isActive: true,
      status: 'pending',
      currentStage: 'created',
      stageProgress: 0,
      overallProgress: 0,
      error: undefined,
      resultUrl: undefined,
      detectedStrategy: undefined,
      strategyConfidence: undefined,
      strategyRecommendation: undefined,
    }));

    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:8000';
      
      // ★ 治本：获取 session token 用于鉴权
      const session = await getSessionSafe();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      
      // [改造] 传递新参数到后端（包含智能分片参数）
      const requestBody = {
        clip_id: params.clipId,
        project_id: params.projectId,
        video_url: params.videoUrl,
        background_image_url: params.backgroundImageUrl,
        prompt: params.originalPrompt,
        // ★★★ 智能分片参数 ★★★
        duration_ms: params.durationMs,
        transcript: params.transcript,
        // [新增] 编辑相关
        edit_mask_url: params.editMaskUrl,
        edited_frame_url: params.editedFrameUrl,
        original_audio_url: params.originalAudioUrl,
        force_strategy: params.forceStrategy,
      };
      
      const response = await fetch(`${backendUrl}/api/background-replace/workflows`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '创建工作流失败');
      }

      const data = await response.json();
      const workflowId = data.workflow_id;

      setState(prev => ({
        ...prev,
        workflowId,
        clipId: params.clipId,  // ★★★ 治本：保存 clipId ★★★
        status: 'running',
      }));

      return workflowId;
    } catch (err) {
      setState(prev => ({
        ...prev,
        status: 'failed',
        error: err instanceof Error ? err.message : '启动工作流失败',
      }));
      throw err;
    }
  }, []);

  /**
   * 更新工作流状态（用于 SSE 事件处理）
   */
  const updateProgress = useCallback((data: {
    stage?: string;
    stage_progress?: number;
    overall_progress?: number;
    message?: string;
  }) => {
    setState(prev => ({
      ...prev,
      currentStage: data.stage || prev.currentStage,
      stageProgress: data.stage_progress ?? prev.stageProgress,
      overallProgress: data.overall_progress ?? prev.overallProgress,
      message: data.message,
    }));
  }, []);

  /**
   * [新增] 更新策略检测结果
   */
  const updateStrategy = useCallback((data: {
    strategy?: string;
    confidence?: number;
    recommendation?: string;
  }) => {
    setState(prev => ({
      ...prev,
      detectedStrategy: data.strategy as WorkflowState['detectedStrategy'],
      strategyConfidence: data.confidence,
      strategyRecommendation: data.recommendation,
    }));
  }, []);

  /**
   * 标记工作流完成
   */
  const markCompleted = useCallback((resultUrl: string) => {
    setState(prev => ({
      ...prev,
      status: 'completed',
      currentStage: 'completed',
      overallProgress: 100,
      resultUrl,
    }));
  }, []);

  /**
   * 标记工作流失败
   */
  const markFailed = useCallback((error: string) => {
    setState(prev => ({
      ...prev,
      status: 'failed',
      error,
    }));
  }, []);

  /**
   * 重置工作流状态
   */
  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  /**
   * 取消工作流
   */
  const cancel = useCallback(async () => {
    if (!state.workflowId) return;

    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:8000';
      
      // ★ 治本：获取 session token 用于鉴权
      const session = await getSessionSafe();
      const headers: HeadersInit = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      
      await fetch(`${backendUrl}/api/background-replace/workflows/${state.workflowId}/cancel`, {
        method: 'POST',
        headers,
      });

      setState(prev => ({
        ...prev,
        status: 'failed',
        error: '已取消',
      }));
    } catch {
      // 忽略取消错误
    }
  }, [state.workflowId]);

  return {
    state,
    startWorkflow,
    updateProgress,
    updateStrategy,  // [新增]
    markCompleted,
    markFailed,
    reset,
    cancel,
  };
}
