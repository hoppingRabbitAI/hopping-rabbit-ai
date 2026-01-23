/**
 * Clips API
 * 独立的 Clips 管理接口，用于局部刷新而不需要重载整个项目
 */
import type { ApiResponse } from './types';
import type { Clip } from '@/features/editor/types/clip';
import { ApiClient } from './client';

// API 响应类型
interface ClipsListResponse {
  items: ClipResponse[];
  total: number;
}

interface ClipResponse {
  id: string;
  track_id: string;
  trackId?: string;
  asset_id?: string;
  clip_type?: string;
  clipType?: string;
  start_time: number;
  start?: number;
  end_time: number;
  duration?: number;
  source_start?: number;
  sourceStart?: number;
  source_end?: number;
  volume?: number;
  is_muted?: boolean;
  isMuted?: boolean;
  speed?: number;
  // 文本内容
  content_text?: string;
  text_style?: Record<string, unknown>;
  // 变换
  transform?: Record<string, unknown>;
  // URL
  url?: string;
  cached_url?: string;
  // 元数据
  name?: string;
  created_at?: string;
  updated_at?: string;
  // ★ 换气片段信息（后端 camelCase）
  silenceInfo?: Record<string, unknown>;
  // ★ 完整元数据（可能包含 silence_info）
  metadata?: Record<string, unknown>;
}

// 转换后端响应为前端 Clip 类型
function transformClip(c: ClipResponse): Clip {
  const clipType = (c.clipType || c.clip_type || 'video') as Clip['clipType'];
  
  // 直接使用后端返回的签名 URL，不走代理（更快）
  const mediaUrl = c.url || c.cached_url;
  
  // ★ 从后端返回的 silenceInfo 或 metadata.silence_info 中获取换气信息
  const silenceInfo = c.silenceInfo || (c.metadata as Record<string, unknown>)?.silence_info;
  
  return {
    id: c.id,
    name: c.content_text?.slice(0, 20) || c.name || 'Clip',
    trackId: c.trackId || c.track_id,
    clipType,
    start: c.start ?? c.start_time,
    duration: c.duration ?? (c.end_time - c.start_time),
    color: getClipColor(clipType),
    isLocal: false,
    mediaUrl,
    sourceStart: c.sourceStart ?? c.source_start ?? 0,
    assetId: c.asset_id,
    volume: c.volume ?? 1.0,
    isMuted: c.isMuted ?? c.is_muted ?? false,
    // 统一文本字段
    contentText: c.content_text,
    textStyle: c.text_style as Clip['textStyle'],
    transform: c.transform as Clip['transform'],
    speed: c.speed ?? 1.0,
    // ★ 换气片段信息
    silenceInfo: silenceInfo as Clip['silenceInfo'],
    metadata: c.metadata as Clip['metadata'],
  };
}

// 获取 clip 类型对应的颜色
function getClipColor(clipType?: string): string {
  const colors: Record<string, string> = {
    video: 'from-blue-500/80 to-indigo-600/60',
    audio: 'from-green-500/80 to-emerald-600/60',
    text: 'from-purple-500/80 to-violet-600/60',
    subtitle: 'from-yellow-500/80 to-amber-600/60',
    voice: 'from-teal-500/80 to-cyan-600/60',
    effect: 'from-red-500/80 to-rose-600/60',
  };
  return colors[clipType || 'video'] || colors.video;
}

export class ClipsApi extends ApiClient {
  /**
   * 按项目 ID 获取所有 clips
   */
  async getClipsByProject(
    projectId: string,
    clipType?: string
  ): Promise<ApiResponse<Clip[]>> {
    const params = new URLSearchParams();
    if (clipType) {
      params.append('clip_type', clipType);
    }
    
    const url = `/clips/by-project/${projectId}${params.toString() ? '?' + params : ''}`;
    const response = await this.request<ClipsListResponse>(url);
    
    if (response.error) {
      return { error: response.error };
    }
    
    const clips = (response.data?.items || []).map(transformClip);
    return { data: clips };
  }

  /**
   * 按轨道 ID 获取 clips
   */
  async getClipsByTrack(
    trackId: string,
    clipType?: string
  ): Promise<ApiResponse<Clip[]>> {
    const params = new URLSearchParams();
    params.append('track_id', trackId);
    if (clipType) {
      params.append('clip_type', clipType);
    }
    
    const response = await this.request<ClipsListResponse>(`/clips?${params}`);
    
    if (response.error) {
      return { error: response.error };
    }
    
    const clips = (response.data?.items || []).map(transformClip);
    return { data: clips };
  }

  /**
   * 从 ASR 结果批量创建 subtitle clips
   */
  async createFromASR(data: {
    project_id: string;
    track_id: string;
    asset_id?: string;
    segments: Array<{
      id?: string;
      text: string;
      start: number;
      end: number;
      speaker?: string;
    }>;
    clip_type?: string;
  }): Promise<ApiResponse<Clip[]>> {
    const response = await this.request<ClipsListResponse>('/clips/from-asr', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    if (response.error) {
      return { error: response.error };
    }
    
    const clips = (response.data?.items || []).map(transformClip);
    return { data: clips };
  }

  /**
   * 批量操作 clips
   */
  async batchOperation(data: {
    creates?: Array<{
      id?: string;
      track_id: string;
      asset_id?: string;
      start_time: number;
      end_time?: number;
      duration?: number;
      subtitle_text?: string;
    }>;
    updates?: Array<{
      id: string;
      updates: Record<string, unknown>;
    }>;
    deletes?: string[];
  }): Promise<ApiResponse<{
    created: ClipResponse[];
    updated: ClipResponse[];
    deleted: string[];
  }>> {
    return this.request('/clips/batch', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

export const clipsApi = new ClipsApi();
