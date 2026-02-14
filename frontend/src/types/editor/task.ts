// ==========================================
// 任务相关类型 (Task Types)
// ==========================================

import type { TranscriptSegment } from './transcript';
import type { ClipType, Clip, Track } from './clip';

/**
 * 后端 API 响应
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * 上传任务状态
 */
export interface UploadTask {
  taskId: string;
  progress: number; // 0-100
  status: 'pending' | 'processing' | 'completed' | 'failed';
  message?: string;
}

/**
 * 任务状态
 */
export interface TaskStatus {
  id: string;
  type: string;
  project_id?: string;
  asset_id?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  current_step?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// AI 任务相关类型
// ============================================

/**
 * AI 任务类型
 */
export type AITaskType = 
  | 'asr'              // 语音转文字
  | 'stem_separation'  // 人声分离
  | 'diarization';     // 说话人分离

/**
 * 人声分离结果
 */
export interface StemSeparationResult {
  /** 人声音频资源 */
  vocals: {
    asset_id: string;
    url: string;
    duration: number;
  };
  /** 背景音/伴奏音频资源 */
  accompaniment: {
    asset_id: string;
    url: string;
    duration: number;
  };
  /** 原始资源ID */
  source_asset_id: string;
}

/**
 * ASR 转写结果
 */
export interface ASRResult {
  /** 转写片段 */
  segments: TranscriptSegment[];
  /** 总词数 */
  total_words: number;
  /** 平均置信度 */
  average_confidence: number;
  /** 检测到的语言 */
  detected_language?: string;
  /** 是否包含说话人分离 */
  has_diarization: boolean;
}

/**
 * 创建轨道Clip的请求
 */
export interface CreateTrackClipRequest {
  /** 内容块类型 */
  clipType: ClipType;
  /** 名称 */
  name: string;
  /** 起始时间 */
  start: number;
  /** 时长 */
  duration: number;
  /** 媒体URL */
  mediaUrl?: string;
  /** 文本内容（文字轨道） */
  text?: string;
  /** 来源资源ID */
  sourceAssetId?: string;
  /** 优先放置的轨道ID（可选） */
  preferredTrackId?: string;
}

/**
 * 创建轨道Clip的结果
 */
export interface CreateTrackClipResult {
  /** 创建的 Clip */
  clip: Clip;
  /** 所在轨道 */
  track: Track;
  /** 是否新建了轨道 */
  isNewTrack: boolean;
}

/**
 * AI 任务完成后的处理结果
 */
export interface AITaskProcessResult {
  /** 是否成功 */
  success: boolean;
  /** 任务类型 */
  taskType: AITaskType;
  /** 创建的 Clip 列表 */
  createdClips: CreateTrackClipResult[];
  /** 错误信息 */
  error?: string;
}
