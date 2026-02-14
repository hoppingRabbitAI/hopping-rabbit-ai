/**
 * Prompt Library API
 * 时尚垂类 prompt 向量库管理
 */
import { ApiClient } from './client';
import type { ApiResponse } from './types';

// ── 类型 ──────────────────────────────────────

export type PromptCapability =
  | 'omni_image'
  | 'face_swap'
  | 'skin_enhance'
  | 'relight'
  | 'outfit_swap'
  | 'ai_stylist'
  | 'outfit_shot'
  | 'text_to_video'
  | 'image_to_video';

export type PromptPlatform =
  | 'douyin'
  | 'xiaohongshu'
  | 'bilibili'
  | 'weibo'
  | 'universal';

export type PromptInputType =
  | 'ecommerce'
  | 'selfie'
  | 'street_snap'
  | 'runway'
  | 'universal';

export interface PromptLibraryItem {
  id: string;
  capability: string;
  platform: string;
  input_type: string;
  prompt: string;
  negative_prompt: string;
  label: string;
  source: string;
  quality_score: number;
  similarity?: number;
  created_at?: string;
}

export interface PromptLibraryStats {
  total: number;
  by_capability: Record<string, number>;
  by_platform: Record<string, number>;
}

// ── 标签映射 ──────────────────────────────────

export const CAPABILITY_LABELS: Record<PromptCapability, string> = {
  omni_image: '图像生成',
  face_swap: 'AI 换脸',
  skin_enhance: '皮肤美化',
  relight: 'AI 打光',
  outfit_swap: '换装',
  ai_stylist: 'AI 穿搭师',
  outfit_shot: 'AI 穿搭内容',
  text_to_video: '文生视频',
  image_to_video: '图生视频',
};

export const PLATFORM_LABELS: Record<PromptPlatform, string> = {
  douyin: '抖音/快手',
  xiaohongshu: '小红书',
  bilibili: 'B站',
  weibo: '微博',
  universal: '通用',
};

export const INPUT_TYPE_LABELS: Record<PromptInputType, string> = {
  ecommerce: '电商主图',
  selfie: '社交自拍',
  street_snap: '街拍/KOL',
  runway: '秀场/大片',
  universal: '通用',
};

export const SOURCE_LABELS: Record<string, string> = {
  scraped: '自动采集',
  manual: '手动添加',
  llm_generated: 'LLM 生成',
};

// ── API ───────────────────────────────────────

class PromptLibraryApi extends ApiClient {
  /** 列出 prompt（分页 + 三维筛选） */
  async listPrompts(params?: {
    capability?: string;
    platform?: string;
    input_type?: string;
    source?: string;
    page?: number;
    page_size?: number;
  }): Promise<ApiResponse<PromptLibraryItem[]>> {
    const searchParams = new URLSearchParams();
    if (params?.capability) searchParams.set('capability', params.capability);
    if (params?.platform) searchParams.set('platform', params.platform);
    if (params?.input_type) searchParams.set('input_type', params.input_type);
    if (params?.source) searchParams.set('source', params.source);
    searchParams.set('page', String(params?.page ?? 1));
    searchParams.set('page_size', String(params?.page_size ?? 50));
    return this.request(`/prompt-library?${searchParams.toString()}`);
  }

  /** 统计各维度数量 */
  async getStats(): Promise<ApiResponse<PromptLibraryStats>> {
    return this.request('/prompt-library/stats');
  }

  /** 语义检索 */
  async searchPrompts(params: {
    query: string;
    capability?: string;
    platform?: string;
    input_type?: string;
    top_k?: number;
  }): Promise<ApiResponse<PromptLibraryItem[]>> {
    const searchParams = new URLSearchParams();
    searchParams.set('query', params.query);
    if (params.capability) searchParams.set('capability', params.capability);
    if (params.platform) searchParams.set('platform', params.platform);
    if (params.input_type) searchParams.set('input_type', params.input_type);
    if (params.top_k) searchParams.set('top_k', String(params.top_k));
    return this.request(`/prompt-library/search?${searchParams.toString()}`);
  }

  /** 手动添加 */
  async addPrompt(params: {
    capability: string;
    platform?: string;
    input_type?: string;
    prompt: string;
    negative_prompt?: string;
    label?: string;
    source?: string;
    quality_score?: number;
  }): Promise<ApiResponse<{ id: string }>> {
    return this.request('/prompt-library', {
      method: 'POST',
      body: JSON.stringify({
        capability: params.capability,
        platform: params.platform ?? 'universal',
        input_type: params.input_type ?? 'universal',
        prompt: params.prompt,
        negative_prompt: params.negative_prompt ?? '',
        label: params.label ?? '',
        source: params.source ?? 'manual',
        quality_score: params.quality_score ?? 0.8,
      }),
    });
  }

  /** 删除 */
  async deletePrompt(promptId: string): Promise<ApiResponse<{ id: string }>> {
    return this.request(`/prompt-library/${promptId}`, { method: 'DELETE' });
  }

  /** 种子入库（从 JSON 批量导入） */
  async seedPrompts(): Promise<ApiResponse<{ total_inserted: number; errors: number }>> {
    return this.request('/prompt-library/seed', { method: 'POST' });
  }
}

export const promptLibraryApi = new PromptLibraryApi();
