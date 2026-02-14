/**
 * Canvas Session API — 画布会话服务 (PRD v1.1)
 * 
 * PRD §7: /api/v2/canvas/*
 * 管理画布 session、上传素材、保存状态
 */
import { ApiClient, API_BASE_URL, getAuthToken } from './client';
import type { ApiResponse } from './types';

/** Canvas Session */
export interface CanvasSession {
  id: string;
  user_id: string;
  template_id?: string;
  /** 画布状态 JSON（节点 + 连接） */
  state: Record<string, unknown>;
  /** Session 状态 */
  status: 'draft' | 'processing' | 'done';
  created_at: string;
  updated_at: string;
}

class CanvasApi extends ApiClient {
  /** 创建新 session */
  async createSession(templateId?: string): Promise<ApiResponse<CanvasSession>> {
    return this.request<CanvasSession>('/v2/canvas/sessions', {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId }),
    });
  }

  /** 获取 session 详情 */
  async getSession(sessionId: string): Promise<ApiResponse<CanvasSession>> {
    return this.request<CanvasSession>(`/v2/canvas/sessions/${sessionId}`);
  }

  /** 保存 session 状态 */
  async saveState(sessionId: string, state: Record<string, unknown>): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>(`/v2/canvas/sessions/${sessionId}/state`, {
      method: 'PUT',
      body: JSON.stringify({ state }),
    });
  }

  /** 上传素材图片到 session */
  async uploadReference(sessionId: string, file: File): Promise<{ upload_id: string; url: string }> {
    const formData = new FormData();
    formData.append('file', file);

    const token = getAuthToken();
    const res = await fetch(`${API_BASE_URL}/v2/canvas/sessions/${sessionId}/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Upload failed: ${res.status}`);
    }

    return res.json();
  }

  /** 获取用户的 session 列表 */
  async listSessions(limit = 20): Promise<ApiResponse<CanvasSession[]>> {
    return this.request<CanvasSession[]>(`/v2/canvas/sessions?limit=${limit}`);
  }

  /** 删除 session */
  async deleteSession(sessionId: string): Promise<ApiResponse<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>(`/v2/canvas/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  /** 一键创建会话 + 自动分析 → session_id + route_result (PRD §3.3) */
  async openCanvas(req: OpenCanvasRequest): Promise<ApiResponse<OpenCanvasResponse>> {
    return this.request<OpenCanvasResponse>('/v2/canvas/open-canvas', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  /** 导出 session 结果 */
  async exportSession(
    sessionId: string,
    options: { format?: string; resolution?: string } = {},
  ): Promise<ApiResponse<ExportSessionResponse>> {
    return this.request<ExportSessionResponse>(`/v2/canvas/sessions/${sessionId}/export`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /** 发布 session 为社区作品 */
  async publishSession(
    sessionId: string,
    req: PublishSessionRequest,
  ): Promise<ApiResponse<PublishSessionResponse>> {
    return this.request<PublishSessionResponse>(`/v2/canvas/sessions/${sessionId}/publish`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }
}

/** 一键开画布请求 */
export interface OpenCanvasRequest {
  template_id?: string;
  subject_url?: string;
  reference_url?: string;
  text?: string;
}

/** 一键开画布结果 */
export interface OpenCanvasResponse {
  session_id: string;
  route_result?: Record<string, unknown> | null;
}

/** 导出结果 */
export interface ExportSessionResponse {
  export_id: string;
  session_id: string;
  format: string;
  status: string;
  download_url: string | null;
}

/** 发布请求 */
export interface PublishSessionRequest {
  name: string;
  tags?: string[];
  visibility?: 'public' | 'private';
}

/** 发布结果 */
export interface PublishSessionResponse {
  publish_id: string;
  session_id: string;
  name: string;
  status: string;
  share_url: string;
}

export const canvasApi = new CanvasApi();
