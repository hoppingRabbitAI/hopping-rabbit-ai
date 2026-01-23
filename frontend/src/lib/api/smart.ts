/**
 * 智能剪辑 API
 */
import type { ApiResponse, SmartCleanSuggestion, TaskStartResponse } from './types';
import { ApiClient, API_BASE_URL, getAuthToken } from './client';

// ============================================
// 一键 AI 成片 类型定义
// ============================================

export interface AIVideoCreateRequest {
  project_id: string;
  video_path: string;
  audio_url: string;
  options?: {
    enable_llm?: boolean;
    style?: string;
  };
}

export interface AIVideoCreateResponse {
  task_id: string;
  status: string;
  message: string;
}

export interface AIVideoCreateResult {
  clips_count: number;
  total_duration: number;
  speech_duration: number;
  subtitles_count: number;
}

export class SmartApi extends ApiClient {
  /**
   * 智能清洗分析
   */
  async smartClean(data: {
    project_id: string;
    max_silence_duration?: number;
    remove_filler_words?: boolean;
    remove_duplicates?: boolean;
  }): Promise<ApiResponse<TaskStartResponse>> {
    return this.request('/tasks/smart-clean', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 应用智能清洗建议
   */
  async applySuggestions(
    projectId: string,
    suggestionIds: string[]
  ): Promise<ApiResponse<{ message: string; new_version: number }>> {
    return this.request(
      `/smart/apply-suggestions?project_id=${projectId}`,
      {
        method: 'POST',
        body: JSON.stringify(suggestionIds),
      }
    );
  }

  /**
   * 一键 AI 成片
   * 
   * 自动完成:
   * 1. 语音识别 (ASR) 切片
   * 2. 人脸检测 (MediaPipe) 定位焦点
   * 3. 智能运镜 (Zoom/Pan) 生成
   * 4. 字幕生成
   */
  async aiVideoCreate(data: AIVideoCreateRequest): Promise<ApiResponse<AIVideoCreateResponse>> {
    return this.request('/ai/ai-create', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

export const smartApi = new SmartApi();

// ============================================
// 智能切片 API
// ============================================

export interface SmartSliceRequest {
  project_id: string;
  enable_llm?: boolean;
}

export interface SliceInfo {
  slice_id: string;
  subtitle_ids: string[];
  start_time: number;
  end_time: number;
  reason: string;
  emotions: string[];
  transform_hint: string;
  is_highlight: boolean;
}

export interface SmartSliceResponse {
  success: boolean;
  project_id: string;
  total_subtitles: number;
  total_slices: number;
  statistics: {
    isolated_slices: number;
    merged_slices: number;
    highlight_slices: number;
  };
  slices: SliceInfo[];
}

/**
 * 智能切片决策
 * 根据字幕的情绪分析结果，智能决定视频片段的划分
 */
export async function getSmartSlice(request: SmartSliceRequest): Promise<SmartSliceResponse> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_BASE_URL}/ai/smart-slice`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `请求失败: ${response.status}`);
  }
  
  return response.json();
}
