/**
 * 视觉元素分离 API 客户端
 * 
 * 端点：
 *  POST /api/visual-separation/separate          → 提交分离任务
 *  GET  /api/visual-separation/tasks/{task_id}    → 获取分离结果（结构化）
 *  GET  /api/tasks/{task_id}                      → 通用任务轮询
 */

import { authFetch } from '@/lib/supabase/session';

// ==========================================
// 类型
// ==========================================

/** 分离类型 */
export type SeparationType = 'person_background' | 'person_clothing' | 'person_accessory' | 'layer_separation';

/** 分离请求参数 */
export interface SeparateRequest {
  image_url: string;
  separation_type: SeparationType;
  clip_id?: string;
  shot_id?: string;
  project_id?: string;
  enhance?: boolean;
}

/** 分离任务创建响应 */
export interface SeparateResponse {
  task_id: string;
  status: string;
  message: string;
}

/** 语义标签 */
export interface SemanticLabels {
  foreground?: string;
  foreground_clothing?: string;
  background?: string;
  scene?: string;
  has_person?: boolean;
}

/** 增强信息 */
export interface EnhancementInfo {
  content_category?: string;
  strategy_used?: string;
  steps_executed?: string[];
  quality_score?: number;
}

/** 分离任务结果 */
export interface SeparationTaskResult {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  status_message?: string;
  error_message?: string;
  mask_url?: string;
  foreground_url?: string;
  background_url?: string;
  enhanced_foreground_url?: string;
  midground_url?: string;
  original_width?: number;
  original_height?: number;
  separation_type?: string;
  layer_count?: number;
  semantic_labels?: SemanticLabels;
  enhancement_info?: EnhancementInfo;
}

// ==========================================
// API 函数
// ==========================================

/**
 * 提交视觉分离任务
 */
export async function startSeparation(params: SeparateRequest): Promise<SeparateResponse> {
  const response = await authFetch('/api/visual-separation/separate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: '提交分离任务失败' }));
    throw new Error(err.detail || `请求失败: ${response.status}`);
  }

  return response.json();
}

/**
 * 获取分离任务结果（结构化）
 */
export async function getSeparationResult(taskId: string): Promise<SeparationTaskResult> {
  const response = await authFetch(`/api/visual-separation/tasks/${taskId}`);

  if (!response.ok) {
    throw new Error(`获取分离结果失败: ${response.status}`);
  }

  return response.json();
}

/**
 * 轮询分离任务直到完成或失败
 * 
 * @param taskId 任务 ID
 * @param onProgress 进度回调
 * @param intervalMs 轮询间隔（默认 2s）
 * @param timeoutMs 超时时间（默认 120s）
 * @returns 完成后的任务结果
 */
export async function pollSeparationUntilDone(
  taskId: string,
  onProgress?: (result: SeparationTaskResult) => void,
  intervalMs = 2000,
  timeoutMs = 120_000,
): Promise<SeparationTaskResult> {
  const startTime = Date.now();

  while (true) {
    const result = await getSeparationResult(taskId);

    // 回调进度
    onProgress?.(result);

    // 终态：完成或失败
    if (result.status === 'completed' || result.status === 'failed') {
      return result;
    }

    // 超时检测
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('分离任务超时，请稍后重试');
    }

    // 等待下一次轮询
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

// ==========================================
// 辅助
// ==========================================

/** 分离类型的中文标签 */
export const SEPARATION_TYPE_LABELS: Record<SeparationType, string> = {
  person_background: '背景 / 人物分离',
  person_clothing: '人物 / 服饰分离',
  person_accessory: '人物 / 配饰分离',
  layer_separation: '前 / 中 / 后景分离',
};

/** 分离类型的描述 */
export const SEPARATION_TYPE_DESCRIPTIONS: Record<SeparationType, string> = {
  person_background: '将画面中的人物与背景分离为独立图层，可单独编辑背景或人物',
  person_clothing: '将人物与服饰分离，用于换装精细编辑',
  person_accessory: '将人物与配饰（眼镜、帽子、首饰等）分离，用于配饰替换',
  layer_separation: '将画面分为前景、中景、后景三个深度层，可独立编辑各层',
};
