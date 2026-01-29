/**
 * HoppingRabbit AI - Rabbit Hole API Client
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
  | 'face_swap';

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

// ============================================
// 2. 文生视频 (Text-to-Video) 类型
// ============================================

export interface TextToVideoRequest {
  prompt: string;
  negative_prompt?: string;
  model_name?: 'kling-v1' | 'kling-v1-5' | 'kling-v1-6';
  duration?: '5' | '10';
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  cfg_scale?: number;
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
  image_list: OmniImageItem[];
  model_name?: 'kling-image-o1';
  resolution?: '1k' | '1.5k' | '2k';
  n?: number;
  aspect_ratio?: string;
}

// ============================================
// 9. AI换脸 (Face Swap) 类型
// ============================================

export interface FaceSwapRequest {
  video_url: string;
  face_image_url: string;
  face_index?: number;
}

// ============================================
// 10. 智能播报 (Smart Broadcast) 类型
// ============================================

export interface PresetVoice {
  id: string;
  name: string;
  description: string;
  language: 'zh' | 'en';
  gender: 'male' | 'female';
  style: string;
  sample_url?: string;
  model_id: string;
}

export interface GetVoicesResponse {
  success: boolean;
  voices: PresetVoice[];
  total: number;
}

export interface SmartBroadcastRequest {
  // 必填 - 人物图片
  image_url: string;
  
  // 模式 1: 图片 + 音频
  audio_url?: string;
  
  // 模式 2/3: 图片 + 脚本
  script?: string;
  voice_id?: string;  // 预设音色 ID (模式2)
  voice_clone_audio_url?: string;  // 声音样本 (模式3: 克隆声音)
  
  // 视频选项
  duration?: '5' | '10';
  image_prompt?: string;
  
  // 音频选项
  sound_volume?: number;
  original_audio_volume?: number;
}

export interface SmartBroadcastResponse extends AITaskCreateResponse {
  mode: 'audio' | 'tts' | 'voice_clone';
  mode_description: string;
  estimated_time: string;
}

// ============================================
// 口播工作流类型
// ============================================

export interface DigitalHumanRequest {
  audio_url: string;
  avatar_id: string;
  background_url?: string;
}

export interface BatchAvatarsRequest {
  video_url: string;
  face_images: string[];
}

export interface ProductShowcaseRequest {
  images: string[];
  duration?: number;
  motion_style?: 'zoom' | 'pan' | 'rotate';
}

// 兼容旧接口
export type LipSyncResponse = AITaskCreateResponse;

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
export async function createLipSyncTask(params: LipSyncRequest): Promise<LipSyncResponse> {
  return request<LipSyncResponse>('/kling/lip-sync', {
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
export async function createTextToVideoTask(params: TextToVideoRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/text-to-video', {
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
export async function createImageToVideoTask(params: ImageToVideoRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/image-to-video', {
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
export async function createMultiImageToVideoTask(params: MultiImageToVideoRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/multi-image-to-video', {
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
export async function createMotionControlTask(params: MotionControlRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/motion-control', {
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
export async function createVideoExtendTask(params: VideoExtendRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/video-extend', {
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
export async function createImageGenerationTask(params: ImageGenerationRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/image-generation', {
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
export async function createOmniImageTask(params: OmniImageRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/omni-image', {
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
export async function createFaceSwapTask(params: FaceSwapRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/face-swap', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 10. 智能播报 (Smart Broadcast)
// ============================================

/**
 * 获取预设音色列表
 */
export async function getPresetVoices(params?: {
  language?: 'zh' | 'en';
  gender?: 'male' | 'female';
}): Promise<GetVoicesResponse> {
  const searchParams = new URLSearchParams();
  if (params?.language) searchParams.set('language', params.language);
  if (params?.gender) searchParams.set('gender', params.gender);
  
  const queryString = searchParams.toString();
  const url = queryString ? `/kling/smart-broadcast/voices?${queryString}` : '/kling/smart-broadcast/voices';
  
  return request<GetVoicesResponse>(url);
}

/**
 * 创建智能播报任务
 * 
 * 三种模式:
 * 1. 图片 + 音频: { image_url, audio_url }
 * 2. 图片 + 脚本 + 预设音色: { image_url, script, voice_id }
 * 3. 图片 + 脚本 + 声音克隆: { image_url, script, voice_clone_audio_url }
 */
export async function createSmartBroadcastTask(params: SmartBroadcastRequest): Promise<SmartBroadcastResponse> {
  return request<SmartBroadcastResponse>('/kling/smart-broadcast', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ============================================
// 口播工作流 (Koubo Workflows)
// ============================================

/**
 * 数字人口播
 */
export async function createDigitalHumanTask(params: DigitalHumanRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/koubo/digital-human', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * 批量换脸
 */
export async function createBatchAvatarsTask(params: BatchAvatarsRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/koubo/batch-avatars', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * 产品展示
 */
export async function createProductShowcaseTask(params: ProductShowcaseRequest): Promise<AITaskCreateResponse> {
  return request<AITaskCreateResponse>('/kling/koubo/product-showcase', {
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
