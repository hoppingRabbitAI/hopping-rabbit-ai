/**
 * 项目管理 API
 */
import type { Project, Asset, Timeline, TranscriptSegment, SaveStateRequest } from '@/types/editor';
import type {
  ApiResponse,
  PaginatedResponse,
  SaveStateResponse,
  VersionConflictError,
  ProjectHistoryItem,
  HistoryVersionDetail,
} from './types';
import { ApiClient } from './client';

class ProjectApi extends ApiClient {
  /**
   * 获取项目列表
   */
  async getProjects(params?: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<ApiResponse<PaginatedResponse<Project>>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.status) searchParams.set('status', params.status);
    
    const query = searchParams.toString();
    return this.request(`/projects${query ? `?${query}` : ''}`);
  }

  /**
   * 创建项目
   */
  async createProject(data: {
    name: string;
    video_asset_id?: string;
    settings?: {
      resolution?: { width: number; height: number };
      fps?: number;
    };
  }): Promise<ApiResponse<Project>> {
    return this.request('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 获取项目详情
   */
  async getProject(projectId: string): Promise<ApiResponse<Project & { assets: Asset[] }>> {
    return this.request(`/projects/${projectId}`);
  }

  /**
   * 更新项目
   */
  async updateProject(
    projectId: string,
    data: {
      name?: string;
      description?: string;
      settings?: Record<string, unknown>;
      status?: string;
      wizard_completed?: boolean;
    }
  ): Promise<ApiResponse<Project>> {
    return this.request(`/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * 删除项目
   */
  async deleteProject(projectId: string): Promise<ApiResponse<{ message: string }>> {
    return this.request(`/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 保存项目状态（核心接口）
   */
  async saveProjectState(
    projectId: string,
    request: SaveStateRequest
  ): Promise<ApiResponse<SaveStateResponse | VersionConflictError>> {
    return this.request(`/projects/${projectId}/state`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });
  }

  /**
   * 获取项目历史版本列表
   */
  async getProjectHistory(
    projectId: string,
    limit: number = 20
  ): Promise<ApiResponse<{ snapshots: ProjectHistoryItem[] }>> {
    return this.request(`/projects/${projectId}/history?limit=${limit}`);
  }

  /**
   * 获取指定历史版本详情
   */
  async getHistoryVersion(
    projectId: string,
    version: number
  ): Promise<ApiResponse<HistoryVersionDetail>> {
    return this.request(`/projects/${projectId}/history/${version}`);
  }

  /**
   * 恢复到指定历史版本
   */
  async restoreVersion(
    projectId: string,
    version: number
  ): Promise<ApiResponse<{ message: string; new_version: number }>> {
    return this.request(`/projects/${projectId}/restore/${version}`, {
      method: 'POST',
    });
  }
}

export const projectApi = new ProjectApi();
