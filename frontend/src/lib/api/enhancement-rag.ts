/**
 * 增强参考图管理 API
 */
import { ApiClient, getAuthToken, ensureValidToken } from './client';
import type { ApiResponse } from './types';

// ── 类型 ──────────────────────────────────────

export type ReferenceCategory =
  | 'face_portrait'
  | 'garment'
  | 'accessory'
  | 'product'
  | 'scene'
  | 'generic';

export type SourceType =
  | 'ecommerce'
  | 'social_ugc'
  | 'kol_content'
  | 'fashion_media'
  | 'brand_official'
  | 'studio_professional'
  | 'user_review'
  | 'unknown';

export type ApplicablePlatform =
  | 'douyin'
  | 'xiaohongshu'
  | 'bilibili'
  | 'weibo'
  | 'ecommerce'
  | 'universal';

export interface ReferenceAnalysisResult {
  category: string;
  source_type: string;
  applicable_platforms: string[];
  style: string;
  description: string;
  quality_score: number;
  quality_reasoning: string;
  image_base64: string;
  file_name: string;
  content_type: string;
}

export interface QualityReferenceItem {
  id: string;
  category: string;
  style: string;
  image_url: string;
  description: string;
  quality_score: number;
  source: 'manual' | 'auto';
  created_at: string;
}

export const REFERENCE_CATEGORY_LABELS: Record<ReferenceCategory, string> = {
  face_portrait: '人脸 / 人像',
  garment: '服装',
  accessory: '配饰',
  product: '产品',
  scene: '场景',
  generic: '通用',
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  ecommerce: '电商平台',
  social_ugc: '社交UGC',
  kol_content: 'KOL/博主',
  fashion_media: '时尚媒体',
  brand_official: '品牌官方',
  studio_professional: '影棚专业',
  user_review: '买家评价',
  unknown: '未知来源',
};

export const PLATFORM_LABELS: Record<ApplicablePlatform, string> = {
  douyin: '抖音/快手',
  xiaohongshu: '小红书',
  bilibili: 'B站',
  weibo: '微博',
  ecommerce: '电商',
  universal: '通用',
};

// ── API ───────────────────────────────────────

class EnhancementRagApi extends ApiClient {
  /** 列出参考图 */
  async listReferences(
    category?: string,
    page = 1,
    pageSize = 50,
  ): Promise<ApiResponse<QualityReferenceItem[]>> {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    params.set('page', String(page));
    params.set('page_size', String(pageSize));
    return this.request(`/enhancement-rag/references?${params.toString()}`);
  }

  /** LLM 自动分析图片（返回分类、描述、质量分） */
  async analyzeImage(file: File): Promise<ApiResponse<ReferenceAnalysisResult>> {
    const formData = new FormData();
    formData.append('file', file);

    const token = await ensureValidToken();
    const res = await fetch(`${this.baseUrl}/enhancement-rag/references/analyze`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: '分析失败' }));
      return { error: { code: 'ANALYZE_FAILED', message: err.detail || `分析失败: ${res.status}` } };
    }

    return res.json();
  }

  /** 确认分析结果并入库（base64 传回避免重复上传） */
  async confirmReference(params: {
    category: string;
    description: string;
    style: string;
    quality_score: number;
    source_type: string;
    applicable_platforms: string[];
    image_base64: string;
    file_name: string;
    content_type: string;
  }): Promise<ApiResponse<{ id: string; image_url: string }>> {
    const formData = new FormData();
    formData.append('category', params.category);
    formData.append('description', params.description);
    formData.append('style', params.style);
    formData.append('quality_score', String(params.quality_score));
    formData.append('source_type', params.source_type);
    formData.append('applicable_platforms', params.applicable_platforms.join(','));
    formData.append('image_base64', params.image_base64);
    formData.append('file_name', params.file_name);
    formData.append('content_type', params.content_type);

    const token = await ensureValidToken();
    const res = await fetch(`${this.baseUrl}/enhancement-rag/references/confirm`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: '入库失败' }));
      return { error: { code: 'CONFIRM_FAILED', message: err.detail || `入库失败: ${res.status}` } };
    }

    return res.json();
  }

  /** 上传参考图（multipart, legacy） */
  async uploadReference(
    file: File,
    category: string,
    description: string,
    style = 'auto_detected',
    qualityScore = 0.9,
  ): Promise<ApiResponse<{ id: string; image_url: string }>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('style', style);
    formData.append('quality_score', String(qualityScore));

    const token = await ensureValidToken();
    const res = await fetch(`${this.baseUrl}/enhancement-rag/references/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: '上传失败' }));
      return { error: { code: 'UPLOAD_FAILED', message: err.detail || `上传失败: ${res.status}` } };
    }

    return res.json();
  }

  /** 删除参考图 */
  async deleteReference(refId: string): Promise<ApiResponse<{ id: string }>> {
    return this.request(`/enhancement-rag/references/${refId}`, { method: 'DELETE' });
  }

  /** 种子策略入库 */
  async seedStrategies(): Promise<ApiResponse<{ count: number }>> {
    return this.request('/enhancement-rag/seed', { method: 'POST' });
  }
}

export const enhancementRagApi = new EnhancementRagApi();
