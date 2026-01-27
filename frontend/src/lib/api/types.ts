/**
 * API 客户端 - 类型定义
 */
import type { Project, Timeline, Asset, TranscriptSegment, SaveStateRequest, TaskStatus } from '@/features/editor/types';

// ============================================
// 基础类型
// ============================================

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================
// 资源相关
// ============================================

export interface PresignUploadResponse {
  asset_id: string;
  upload_url: string;
  storage_path: string;
  expires_at: string;
}

export interface ConfirmUploadResponse {
  id: string;
  url: string;
  status: string;
}

export interface WaveformData {
  asset_id: string;
  duration: number;
  sample_rate: number;
  channels: number;
  data: { left: number[]; right?: number[] };
  peaks: { min: number; max: number };
}

// ============================================
// 项目相关
// ============================================

export interface SaveStateResponse {
  success: boolean;
  version: number;
  saved_at: string;
}

export interface VersionConflictError {
  error: 'version_conflict';
  message: string;
  server_version: number;
  suggestion: string;
}

export interface ProjectHistoryItem {
  version: number;
  created_at: string;
  snapshot_type: 'auto' | 'manual' | 'checkpoint';
  description?: string;
}

export interface HistoryVersionDetail {
  version: number;
  timeline: Timeline;
  segments: TranscriptSegment[];
  created_at: string;
}

// ============================================
// 任务相关
// ============================================

export interface TaskStartResponse {
  task_id: string;
  status: string;
}

export interface TaskResultWithData<T = unknown> extends TaskStatus {
  result?: T;
}

// ============================================
// 素材处理相关
// ============================================

export interface ProcessAdditionsStatus {
  task_id: string;
  project_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  current_step?: string;
  progress: number;
  total_assets: number;
  processed_assets: number;
  created_clips: number;
  error?: string;
}

// ============================================
// 导出相关
// ============================================

export interface ExportJob {
  id: string;
  project_id: string;
  status: 'queued' | 'rendering' | 'uploading' | 'completed' | 'failed';
  progress: number;
  output_url?: string;
  output_file_size?: number;
  error_message?: string;
  created_at: string;
  completed_at?: string;
}

export interface ExportStartResponse {
  job_id: string;
  status: string;
}

// ============================================
// 智能功能相关
// ============================================

export interface SmartCleanSuggestion {
  segment_id?: string;
  time_range?: [number, number];
  reason: 'filler_word' | 'long_silence' | 'duplicate';
  confidence: number;
  description: string;
}

// ============================================
// 健康检查
// ============================================

export interface HealthCheckResponse {
  status: string;
  timestamp: string;
  version: string;
}
