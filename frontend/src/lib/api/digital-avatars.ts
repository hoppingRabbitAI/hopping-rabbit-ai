/**
 * Digital Avatar API — 数字人形象服务
 * 
 * System C: 独立于 video templates (System A) 和 trend templates (System B)
 * 
 * 管理端: CRUD + 发布
 * 消费端: 画廊浏览 + 生成口播视频
 */
import { ApiClient } from './client';
import type { ApiResponse } from './types';
import type {
  DigitalAvatarTemplate,
  AvatarGeneration,
  CreateAvatarRequest,
  UpdateAvatarRequest,
  GenerateWithAvatarRequest,
  GenerateWithAvatarResponse,
  AvatarStyle,
  AvatarGender,
} from '@/types/digital-avatar';

// ---- 列表响应 ----

interface AvatarListResponse {
  avatars: DigitalAvatarTemplate[];
  total: number;
  offset: number;
  limit: number;
}

interface GenerationListResponse {
  generations: AvatarGeneration[];
  total: number;
}

// ---- 列表参数 ----

interface AvatarListParams {
  status?: string;
  gender?: AvatarGender;
  style?: AvatarStyle;
  search?: string;
  is_featured?: boolean;
  limit?: number;
  offset?: number;
}

interface GalleryParams {
  gender?: AvatarGender;
  style?: AvatarStyle;
  search?: string;
  limit?: number;
  offset?: number;
}

class DigitalAvatarApi extends ApiClient {

  // ==========================================
  // 管理端 (Admin)
  // ==========================================

  /** 列出形象 (管理端，所有状态) */
  async listAvatars(params: AvatarListParams = {}): Promise<ApiResponse<AvatarListResponse>> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.gender) query.set('gender', params.gender);
    if (params.style) query.set('style', params.style);
    if (params.search) query.set('search', params.search);
    if (params.is_featured !== undefined) query.set('is_featured', String(params.is_featured));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));

    const qs = query.toString();
    return this.request<AvatarListResponse>(`/v2/avatars${qs ? `?${qs}` : ''}`);
  }

  /** 获取形象详情 */
  async getAvatar(id: string): Promise<ApiResponse<DigitalAvatarTemplate>> {
    return this.request<DigitalAvatarTemplate>(`/v2/avatars/${id}`);
  }

  /** 创建形象 */
  async createAvatar(data: CreateAvatarRequest): Promise<ApiResponse<{ success: boolean; avatar: DigitalAvatarTemplate }>> {
    return this.request(`/v2/avatars`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** 更新形象 */
  async updateAvatar(id: string, data: UpdateAvatarRequest): Promise<ApiResponse<{ success: boolean; avatar: DigitalAvatarTemplate }>> {
    return this.request(`/v2/avatars/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /** 删除形象 */
  async deleteAvatar(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request(`/v2/avatars/${id}`, { method: 'DELETE' });
  }

  /** 发布形象 */
  async publishAvatar(id: string): Promise<ApiResponse<{ success: boolean; avatar: DigitalAvatarTemplate }>> {
    return this.request(`/v2/avatars/${id}/publish`, { method: 'POST' });
  }

  /** 取消发布 */
  async unpublishAvatar(id: string): Promise<ApiResponse<{ success: boolean; avatar: DigitalAvatarTemplate }>> {
    return this.request(`/v2/avatars/${id}/unpublish`, { method: 'POST' });
  }

  // ==========================================
  // 消费端 (User)
  // ==========================================

  /** 用户画廊 — 仅已发布形象 */
  async getGallery(params: GalleryParams = {}): Promise<ApiResponse<AvatarListResponse>> {
    const query = new URLSearchParams();
    if (params.gender) query.set('gender', params.gender);
    if (params.style) query.set('style', params.style);
    if (params.search) query.set('search', params.search);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));

    const qs = query.toString();
    return this.request<AvatarListResponse>(`/v2/avatars/gallery${qs ? `?${qs}` : ''}`);
  }

  /** 使用形象生成口播视频 */
  async generateWithAvatar(
    avatarId: string,
    params: GenerateWithAvatarRequest,
  ): Promise<ApiResponse<GenerateWithAvatarResponse>> {
    return this.request<GenerateWithAvatarResponse>(`/v2/avatars/${avatarId}/generate`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /** 生成确认肖像 — 上传照片后 AI 生成 4 张白底标准肖像 */
  async confirmPortraits(
    sourceImageUrls: string[],
    engine: 'doubao' | 'kling' = 'doubao',
  ): Promise<ApiResponse<{ success: boolean; task_id: string; status: string }>> {
    return this.request(`/v2/avatars/confirm-portraits`, {
      method: 'POST',
      body: JSON.stringify({ source_image_urls: sourceImageUrls, engine }),
    });
  }

  /** 查询生成进度 */
  async getGeneration(genId: string): Promise<ApiResponse<AvatarGeneration>> {
    return this.request<AvatarGeneration>(`/v2/avatars/generations/${genId}`);
  }

  /** 我的生成历史 */
  async myGenerations(limit = 20, offset = 0): Promise<ApiResponse<GenerationListResponse>> {
    return this.request<GenerationListResponse>(
      `/v2/avatars/generations?limit=${limit}&offset=${offset}`
    );
  }
}

export const digitalAvatarApi = new DigitalAvatarApi();
