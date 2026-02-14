/**
 * Remotion 渲染 API 客户端
 * 
 * 用于调用服务端 Remotion 渲染，生成带动画效果的视频
 */

import type { RemotionConfig } from '@/remotion/compositions/RemotionConfigComposition';
import { getSessionSafe } from '@/lib/supabase/session';

export interface RenderRemotionRequest {
  mainVideoUrl: string;
  config: RemotionConfig;
  pip?: {
    enabled: boolean;
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    size: 'small' | 'medium' | 'large';
  };
  width?: number;
  height?: number;
  outputFormat?: 'mp4' | 'webm';
}

export interface RenderProgress {
  progress: number; // 0-100
  status: string;
}

/**
 * 渲染 Remotion 配置为视频
 * 
 * @param request 渲染请求参数
 * @param onProgress 进度回调（可选）
 * @returns 渲染后的视频 Blob
 */
async function renderRemotionConfig(
  request: RenderRemotionRequest,
  onProgress?: (progress: RenderProgress) => void
): Promise<Blob> {
  onProgress?.({ progress: 0, status: '准备渲染...' });
  
  // ★ 治本：获取 session token 用于鉴权
  const session = await getSessionSafe();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  
  const response = await fetch('/api/remotion/render', {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '渲染失败' }));
    throw new Error(error.error || `渲染失败: ${response.status}`);
  }
  
  onProgress?.({ progress: 100, status: '渲染完成' });
  
  return response.blob();
}

/**
 * 渲染并下载视频
 */
export async function renderAndDownload(
  request: RenderRemotionRequest,
  filename: string = 'remotion-video.mp4',
  onProgress?: (progress: RenderProgress) => void
): Promise<void> {
  const blob = await renderRemotionConfig(request, onProgress);
  
  // 创建下载链接
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
