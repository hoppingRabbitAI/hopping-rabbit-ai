/**
 * Lepus AI - Rabbit Hole API Client
 * 可灵 AI 全功能 API 接口
 * 
 * 支持功能:
 * - 口型同步 (Lip Sync)
 * - 文生视频 (Text-to-Video)
 * - 图生视频 (Image-to-Video)
 * - 多图生视频 (Multi-Image-to-Video)
 * - 动作控制 (Motion Control)
 * - 视频延长 (Video Extend)
 * - 图像生成 (Image Generation)
 * - Omni-Image (多模态图像)
 * - AI换脸 (Face Swap)
 */

import { API_BASE_URL, getAuthToken, ensureValidToken } from '@/lib/api/client';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[RabbitHole API]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[RabbitHole API]', ...args); };

/** 在 endpoint 后追加 project_id 查询参数 */
function withProjectId(endpoint: string, projectId?: string): string {
  if (!projectId) return endpoint;
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${sep}project_id=${encodeURIComponent(projectId)}`;
}

// ============================================
// 通用类型定义
// ============================================

export type AITaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type AITaskType = 
  | 'lip_sync' 
  | 'text_to_video' 
  | 'image_to_video' 
  | 'multi_image_to_video'
  | 'motion_control'
  | 'video_extend'
  | 'image_generation'
  | 'omni_image'
  | 'face_swap'
  // 🆕 Enhance & Style
  | 'skin_enhance'
  | 'relight'
  | 'outfit_swap'
  | 'ai_stylist'
  | 'outfit_shot'
  // 🆕 豆包图像生成
  | 'doubao_image';

export interface AITaskResponse {
  id: string;  // 后端返回的是 id
  task_id?: string;  // 兼容旧字段（部分接口可能返回这个）
  task_type: AITaskType;
  status: AITaskStatus;
  progress: number;
  status_message?: string;
  output_url?: string;
  output_asset_id?: string;
  result_metadata?: Record<string, unknown>;
  error_code?: string;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface AITaskCreateResponse {
  success: boolean;
  task_id: string;
  status: string;
  message?: string;
}

export interface AITaskListResponse {
  tasks: AITaskResponse[];
  page: number;
  page_size: number;
  total: number;
}

// ============================================
// 1. 口型同步 (Lip Sync) 类型
// ============================================

export interface LipSyncRequest {
  video_url: string;
  audio_url: string;
  face_index?: number;
  sound_volume?: number;
  original_audio_volume?: number;
}

/** 口型同步任务响应 */
export type LipSyncResponse = AITaskResponse;

// ============================================
// 2. 文生视频 (Text-to-Video) 类型
// ============================================

export interface TextToVideoRequest {
  prompt: string;
  negative_prompt?: string;
  model_name?: 'kling-v1' | 'kling-v1-5' | 'kling-v1-6';
  duration?: '5' | '10';
  aspect_ratio?: '16:9' | '9:16';  // ★ 仅支持 16:9 和 9:16
  cfg_scale?: number;
  /** 🆕 数字人角色 ID — 传入后自动带入 face reference */
  avatar_id?: string;
}

// ============================================
// 3. 图生视频 (Image-to-Video) 类型
// ============================================

export interface ImageToVideoRequest {
  image: string;
  prompt?: string;
  negative_prompt?: string;
  model_name?: 'kling-v1' | 'kling-v1-5' | 'kling-v1-6';
  duration?: '5' | '10';
  cfg_scale?: number;
  /** 🆕 数字人角色 ID — 传入后自动带入 face reference */
  avatar_id?: string;
}

// ============================================
// 4. 多图生视频 (Multi-Image-to-Video) 类型
// ============================================

export interface MultiImageToVideoRequest {
  images: string[];
  prompt?: string;
  negative_prompt?: string;
  model_name?: 'kling-v1-5' | 'kling-v1-6';
  duration?: '5' | '10';
  cfg_scale?: number;
}

// ============================================
// 5. 动作控制 (Motion Control) 类型
// ============================================

export interface MotionControlRequest {
  image: string;
  video_url: string;
  prompt?: string;
  negative_prompt?: string;
  mode?: 'normal' | 'pro';
  duration?: '5' | '10';
  cfg_scale?: number;
}

// ============================================
// 6. 视频延长 (Video Extend) 类型
// ============================================

export interface VideoExtendRequest {
  video_id: string;
  prompt?: string;
  negative_prompt?: string;
  extend_direction?: 'start' | 'end';
  cfg_scale?: number;
}

// ============================================
// 7. 图像生成 (Image Generation) 类型
// ============================================

export interface ImageGenerationRequest {
  prompt: string;
  negative_prompt?: string;
  model_name?: 'kling-v1' | 'kling-v1-5' | 'kling-v2' | 'kling-v2-new' | 'kling-v2-1';
  resolution?: '1k' | '1.5k' | '2k';
  n?: number;
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '2:3' | '3:2';
  image?: string;
  image_reference?: 'subject' | 'face';  // subject: 保留人物特征, face: 保留人脸
  image_fidelity?: number;
  human_fidelity?: number;
  /** 🆕 数字人角色 ID — 传入后自动带入 face reference */
  avatar_id?: string;
}

// ============================================
// 8. Omni-Image (多模态图像) 类型
// ============================================

export interface OmniImageItem {
  image: string;
  var?: string;
}

export interface OmniImageRequest {
  prompt: string;
  image_list?: OmniImageItem[];
  model_name?: 'kling-image-o1';
  resolution?: '1k' | '1.5k' | '2k';
  n?: number;
  aspect_ratio?: string;
}

// ============================================
// 9. AI换脸 (Face Swap) — 基于 Omni-Image
// ============================================

export interface FaceSwapRequest {
  source_image_url: string;       // 源图片（要被换脸的图片）
  face_image_url: string;         // 目标人脸图片
  custom_prompt?: string;         // 额外提示词
  resolution?: '1k' | '2k';      // 清晰度
  generate_video?: boolean;       // 是否联动生成视频
  video_prompt?: string;          // 视频生成提示词
  video_duration?: '5' | '10';    // 视频时长（秒）
}

// ============================================
// API 请求函数
// ============================================

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // 确保 token 有效
  await ensureValidToken();
  const token = getAuthToken();

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  debugLog(`Request: ${options.method || 'GET'} ${url}`);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    debugError(`Request failed: ${response.status}`, errorData);
    throw new Error(errorData.detail || `请求失败: ${response.status}`);
  }

  const data = await response.json();
  debugLog('Response:', data);
  return data as T;
}

// ============================================
// Rabbit Hole API
// ============================================

/**
 * 创建口型同步任务
 */
export async function createLipSyncTask(params: LipSyncRequest, projectId?: string): Promise<LipSyncResponse> {
  return request<LipSyncResponse>(withProjectId('/kling/lip-sync', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * 查询 AI 任务状态
 */
export async function getAITaskStatus(taskId: string): Promise<AITaskResponse> {
  return request<AITaskResponse>(`/kling/ai-task/${taskId}`);
}

/**
 * 获取 AI 任务列表
 */
export async function getAITaskList(params?: {
  status?: AITaskStatus;
  task_type?: string;
  page?: number;
  page_size?: number;
}): Promise<AITaskListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.task_type) searchParams.set('task_type', params.task_type);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.page_size) searchParams.set('page_size', String(params.page_size));

  const queryString = searchParams.toString();
  const url = queryString ? `/kling/ai-tasks?${queryString}` : '/kling/ai-tasks';
  
  return request<AITaskListResponse>(url);
}

/**
 * 取消 AI 任务
 */
export async function cancelAITask(taskId: string): Promise<{ success: boolean; message: string }> {
  return request(`/kling/ai-task/${taskId}/cancel`, {
    method: 'POST',
  });
}

/**
 * 添加 AI 任务到项目
 * @param taskId - AI 任务 ID
 * @param projectId - 项目 ID（为空则创建新项目）
 * @param options - 可选配置
 */
export async function addAITaskToProject(
  taskId: string, 
  projectId?: string | null, 
  options?: {
    name?: string;
    createClip?: boolean;
  }
): Promise<{ 
  success: boolean; 
  project_id: string;
  asset_id: string; 
  clip_id?: string;
  track_id?: string;
  is_new_project: boolean;
  message: string;
}> {
  return request(`/kling/ai-task/${taskId}/add-to-project`, {
    method: 'POST',
    body: JSON.stringify({ 
      project_id: projectId || null,
      name: options?.name,
      create_clip: options?.createClip ?? true,
    }),
  });
}

/**
 * 删除单个 AI 任务
 */
export async function deleteAITask(taskId: string): Promise<{ success: boolean; deleted_count: number }> {
  return request(`/kling/ai-task/${taskId}`, {
    method: 'DELETE',
  });
}

/**
 * 批量删除 AI 任务
 */
export async function batchDeleteAITasks(
  taskIds: string[]
): Promise<{ success: boolean; deleted_count: number; requested_count: number }> {
  return request('/kling/ai-tasks/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ task_ids: taskIds }),
  });
}

// ============================================
// 2. 文生视频 (Text-to-Video)
// ============================================

/**
 * 创建文生视频任务
 */
export async function createTextToVideoTask(params: TextToVideoRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/kling/text-to-video', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 3. 图生视频 (Image-to-Video)
// ============================================

/**
 * 创建图生视频任务
 */
export async function createImageToVideoTask(params: ImageToVideoRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/kling/image-to-video', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 4. 多图生视频 (Multi-Image-to-Video)
// ============================================

/**
 * 创建多图生视频任务
 */
export async function createMultiImageToVideoTask(params: MultiImageToVideoRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/kling/multi-image-to-video', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 5. 动作控制 (Motion Control)
// ============================================

/**
 * 创建动作控制任务
 */
export async function createMotionControlTask(params: MotionControlRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/kling/motion-control', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 6. 视频延长 (Video Extend)
// ============================================

/**
 * 创建视频延长任务
 */
export async function createVideoExtendTask(params: VideoExtendRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/kling/video-extend', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 7. 图像生成 (Image Generation)
// ============================================

/**
 * 创建图像生成任务
 */
export async function createImageGenerationTask(params: ImageGenerationRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/kling/image-generation', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 8. Omni-Image (多模态图像)
// ============================================

/**
 * 创建 Omni-Image 任务
 */
export async function createOmniImageTask(params: OmniImageRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/kling/omni-image', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 9. AI换脸 (Face Swap)
// ============================================

/**
 * 创建 AI 换脸任务
 */
export async function createFaceSwapTask(params: FaceSwapRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/kling/face-swap', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 🆕 10-14. Enhance & Style 五大能力
// ============================================

export interface SkinEnhanceRequest {
  image_url: string;
  intensity?: 'natural' | 'moderate' | 'max';
  custom_prompt?: string;
}

export interface RelightRequest {
  image_url: string;
  light_type?: 'natural' | 'studio' | 'golden_hour' | 'dramatic' | 'neon' | 'soft';
  light_direction?: 'front' | 'left' | 'right' | 'back' | 'top' | 'bottom';
  light_color?: string;
  light_intensity?: number;
  custom_prompt?: string;
}

export interface OutfitSwapRequest {
  person_image_url: string;
  garment_image_url: string;
  garment_type?: 'upper' | 'lower' | 'full';
  custom_prompt?: string;
}

export interface AIStylistRequest {
  garment_image_url: string;
  style_tags?: string[];
  occasion?: 'daily' | 'work' | 'date' | 'travel' | 'party';
  season?: 'spring' | 'summer' | 'autumn' | 'winter';
  gender?: 'male' | 'female';
  num_variations?: number;
  custom_prompt?: string;
}

export interface OutfitShotRequest {
  garment_images: string[];
  mode?: 'content' | 'try_on';
  content_type?: 'cover' | 'streetsnap' | 'lifestyle' | 'flat_lay' | 'comparison';
  platform_preset?: 'xiaohongshu' | 'douyin' | 'instagram' | 'custom';
  gender?: 'male' | 'female';
  scene_prompt?: string;
  num_variations?: number;
  avatar_id?: string;
  body_type?: string;
  pose?: string;
  lighting_style?: string;
  camera_angle?: string;
}

/** 皮肤美化 */
export async function createSkinEnhanceTask(params: SkinEnhanceRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/enhance-style/skin-enhance', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** AI 打光 */
export async function createRelightTask(params: RelightRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/enhance-style/relight', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** 换装 */
export async function createOutfitSwapTask(params: OutfitSwapRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/enhance-style/outfit-swap', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** AI 穿搭师 */
export async function createAIStylistTask(params: AIStylistRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/enhance-style/ai-stylist', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** AI 穿搭内容生成 */
export async function createOutfitShotTask(params: OutfitShotRequest, projectId?: string): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/enhance-style/outfit-shot', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 能力查询
// ============================================

export interface AICapability {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  status: 'available' | 'coming_soon';
}

export interface AICapabilitiesResponse {
  video_generation: AICapability[];
  image_generation: AICapability[];
  workflows: AICapability[];
  task_management: string[];
}

/**
 * 获取可用能力列表
 */
export async function getCapabilities(): Promise<AICapabilitiesResponse> {
  return request<AICapabilitiesResponse>('/kling/capabilities');
}

/**
 * 轮询任务状态直到完成
 */
export async function pollTaskStatus(
  taskId: string,
  options?: {
    interval?: number;
    maxAttempts?: number;
    onProgress?: (task: AITaskResponse) => void;
  }
): Promise<AITaskResponse> {
  const { interval = 3000, maxAttempts = 100, onProgress } = options || {};
  
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    const task = await getAITaskStatus(taskId);
    
    if (onProgress) {
      onProgress(task);
    }
    
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return task;
    }
    
    attempts++;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error('任务轮询超时');
}

// ============================================
// 统一图像生成（多 Provider）
// ============================================

export type ImageGenerationProvider = 'doubao' | 'kling';

export interface UnifiedImageGenRequest {
  provider: ImageGenerationProvider;
  capability: string;
  prompt: string;
  negative_prompt?: string;
  image_urls?: string[];
  n?: number;
  aspect_ratio?: string;
  size?: string;
  avatar_id?: string;
  extra_params?: Record<string, unknown>;
}

/**
 * 统一图像生成入口 — 后端根据 provider 分发到 Doubao / Kling
 */
export async function createUnifiedImageTask(
  params: UnifiedImageGenRequest,
  projectId?: string,
): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>(withProjectId('/image-generation', projectId), {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
