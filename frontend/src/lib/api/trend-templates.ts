/**
 * Trend Template API — 热门模板服务 (PRD v1.1)
 * 
 * PRD §7: /api/v2/templates/*
 * 区别于旧 templates.ts 的视频模板系统
 */
import { ApiClient } from './client';
import type { ApiResponse } from './types';
import type { TrendTemplate, TemplateCategory } from '@/types/discover';

interface TrendListParams {
  category?: TemplateCategory;
  search?: string;
  cursor?: string;
  limit?: number;
}

interface TrendListResponse {
  templates: TrendTemplate[];
  next_cursor: string | null;
  total: number;
}

class TrendTemplateApi extends ApiClient {
  /** 获取热门模板列表 */
  async listTrending(params: TrendListParams = {}): Promise<ApiResponse<TrendListResponse>> {
    const query = new URLSearchParams();
    if (params.category) query.set('category', params.category);
    if (params.search) query.set('search', params.search);
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.limit) query.set('limit', String(params.limit));

    const qs = query.toString();
    return this.request<TrendListResponse>(`/v2/templates/trending${qs ? `?${qs}` : ''}`);
  }

  /** 获取单个模板详情 */
  async getTemplate(id: string): Promise<ApiResponse<TrendTemplate>> {
    return this.request<TrendTemplate>(`/v2/templates/${id}`);
  }

  /** 使用模板（创建 canvas session / 增加使用次数） */
  async useTemplate(templateId: string, referenceUploadId?: string): Promise<ApiResponse<{ session_id: string }>> {
    return this.request<{ session_id: string }>('/v2/templates/use', {
      method: 'POST',
      body: JSON.stringify({
        template_id: templateId,
        reference_upload_id: referenceUploadId ?? undefined,
      }),
    });
  }

  /** 获取分类统计 */
  async getCategoryStats(): Promise<ApiResponse<Record<TemplateCategory, number>>> {
    return this.request<Record<TemplateCategory, number>>('/v2/templates/categories/stats');
  }
}

export const trendTemplateApi = new TrendTemplateApi();
