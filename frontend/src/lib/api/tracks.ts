/**
 * Tracks API
 * 独立的 Tracks 管理接口
 */
import type { ApiResponse } from './types';
import { ApiClient } from './client';
import type { Track } from '@/features/editor/types';

// API 响应类型
interface TracksListResponse {
  items: TrackResponse[];
  total: number;
}

interface TrackResponse {
  id: string;
  project_id: string;
  name: string;
  order_index: number;
  is_visible: boolean;
  is_muted: boolean;
  is_locked: boolean;
  adjustment_params?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

// 转换后端响应为前端 Track 类型
function transformTrack(t: TrackResponse): Track {
  return {
    id: t.id,
    name: t.name,
    orderIndex: t.order_index,
    isVisible: t.is_visible,
    isMuted: t.is_muted,
    isLocked: t.is_locked,
    color: getTrackColor(t.name),
  };
}

// 根据 track 名称获取颜色
function getTrackColor(name: string): string {
  if (name.toLowerCase().includes('b-roll') || name.toLowerCase().includes('broll')) {
    return 'text-sky-400';
  }
  if (name.toLowerCase().includes('subtitle')) {
    return 'text-yellow-400';
  }
  if (name.toLowerCase().includes('audio')) {
    return 'text-green-400';
  }
  if (name.toLowerCase().includes('video')) {
    return 'text-blue-400';
  }
  return 'text-gray-400';
}

export class TracksApi extends ApiClient {
  /**
   * 获取项目的所有轨道
   */
  async getTracksByProject(projectId: string): Promise<ApiResponse<Track[]>> {
    const response = await this.request<TracksListResponse>(`/tracks?project_id=${projectId}`);
    
    if (response.error) {
      return { data: undefined, error: response.error };
    }
    
    const tracks = (response.data?.items || []).map(transformTrack);
    return { data: tracks, error: undefined };
  }
}

// 导出单例
export const tracksApi = new TracksApi();
