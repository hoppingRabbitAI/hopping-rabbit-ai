/**
 * 关键帧 API
 */
import { API_BASE_URL, getAuthToken, handleAuthExpired } from './client';

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

// ========== 类型定义 ==========

export interface KeyframeValue {
  x?: number;
  y?: number;
}

export interface Keyframe {
  id: string;
  clip_id: string;
  property: string;
  time: number;
  value: number | KeyframeValue;
  easing: string;
  bezier_control?: object;
}

export interface SmartGenerateRequest {
  clip_ids: string[];
  emotion?: 'neutral' | 'excited' | 'serious' | 'happy' | 'sad';
  importance?: 'low' | 'medium' | 'high';
}

export interface SmartGenerateResult {
  clip_id: string;
  success: boolean;
  keyframes_count: number;
  rule_applied?: string;
  error?: string;
}

export interface SmartGenerateResponse {
  results: SmartGenerateResult[];
  total_clips: number;
  success_count: number;
  failed_count: number;
}

// ========== API 类 ==========

class KeyframesApi {
  private baseUrl = `${API_BASE_URL}/keyframes`;

  private async request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    try {
      // 构建请求头，自动注入 Authorization
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      };
      
      // 注入认证 Token
      const token = getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        credentials: 'include',
      });

      // 处理认证失败
      if (response.status === 401) {
        console.warn('[KeyframesApi] Unauthorized request, redirecting to login');
        handleAuthExpired();
        return {
          error: {
            code: 'UNAUTHORIZED',
            message: '登录已过期，请重新登录',
          },
        };
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return {
          error: {
            code: `HTTP_${response.status}`,
            message: error.detail || error.message || `请求失败: ${response.status}`,
          },
        };
      }

      const data = await response.json();
      return { data };
    } catch (err) {
      return {
        error: {
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : '网络请求失败',
        },
      };
    }
  }

  /**
   * 获取 clip 的关键帧
   */
  async getClipKeyframes(clipId: string, property?: string): Promise<ApiResponse<{ keyframes: Keyframe[] }>> {
    const query = property ? `?property=${property}` : '';
    return this.request(`/clip/${clipId}${query}`);
  }

  /**
   * 获取项目的所有关键帧
   * 用于添加素材后刷新关键帧数据
   */
  async getProjectKeyframes(projectId: string): Promise<ApiResponse<{ keyframes: Array<{
    id: string;
    clipId: string;
    property: string;
    offset: number;
    value: number | KeyframeValue;
    easing: string;
  }> }>> {
    return this.request(`/project/${projectId}`);
  }

  /**
   * 智能运镜 - 为 1-N 个 clips 生成运镜关键帧
   * 
   * 同步处理，直接返回结果
   */
  async smartGenerate(data: SmartGenerateRequest): Promise<ApiResponse<SmartGenerateResponse>> {
    return this.request('/smart-generate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 删除 clip 的所有关键帧
   */
  async deleteClipKeyframes(clipId: string): Promise<ApiResponse<{ success: boolean; deleted_count: number }>> {
    return this.request(`/clip/${clipId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 删除 clip 某个属性的关键帧
   */
  async deletePropertyKeyframes(clipId: string, property: string): Promise<ApiResponse<{ success: boolean; deleted_count: number }>> {
    return this.request(`/clip/${clipId}/property/${property}`, {
      method: 'DELETE',
    });
  }
}

export const keyframesApi = new KeyframesApi();
