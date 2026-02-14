import { authFetch } from '@/lib/supabase/session';

export interface ExtractClipFramesRequest {
  frame_count?: number;
  start_offset_ms?: number;
  end_offset_ms?: number;
}

export interface ExtractedFrame {
  index: number;
  timestamp_sec: number;
  image_url: string;
  asset_id: string;
  storage_path: string;
}

export interface ExtractClipFramesResponse {
  success: boolean;
  clip_id: string;
  frame_count: number;
  window_start_sec: number;
  window_end_sec: number;
  frames: ExtractedFrame[];
}

export async function extractFramesFromClip(
  clipId: string,
  payload: ExtractClipFramesRequest = {},
): Promise<ExtractClipFramesResponse> {
  const response = await authFetch(`/api/shot-segmentation/clips/${clipId}/extract-frames`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = (data && typeof data === 'object' && 'detail' in data)
      ? String((data as { detail?: unknown }).detail || '')
      : '';
    throw new Error(detail || `抽帧失败: ${response.status}`);
  }

  return response.json() as Promise<ExtractClipFramesResponse>;
}
