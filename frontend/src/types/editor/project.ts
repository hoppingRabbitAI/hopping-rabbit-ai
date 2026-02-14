// ==========================================
// 项目相关类型 (Project Types)
// ==========================================

import type { TranscriptSegment } from './transcript';
import type { Track, Clip } from './clip';

export type { Track, Clip, ClipType } from './clip';

/**
 * 分辨率
 */
export interface Resolution {
  width: number;
  height: number;
}

/**
 * 项目设置
 */
export interface ProjectSettings {
  resolution: Resolution;
  fps: number;
  sampleRate?: number;
  backgroundColor?: string;
}

/**
 * 特效配置
 */
export interface Effect {
  type: string;
  params: Record<string, unknown>;
}

/**
 * 标记点
 */
export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
}

/**
 * 时间轴
 */
export interface Timeline {
  tracks: Track[];
  clips: Clip[];
  effects: Effect[];
  markers: Marker[];
  duration: number;
}

/**
 * 完整的项目数据
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  videoUrl?: string;
  duration: number;
  segments?: TranscriptSegment[];
  createdAt?: string;
  updatedAt?: string;
  status: 'draft' | 'uploading' | 'transcribing' | 'ready' | 'exporting' | 'error';
  timeline?: Timeline;
  version?: number;
  settings?: ProjectSettings;
  resolution?: Resolution;
  fps?: number;
  wizard_completed?: boolean;
}

/**
 * 导出配置
 */
export interface ExportConfig {
  resolution: '1080p' | '720p' | '480p';
  format: 'mp4' | 'mov';
  includeSubtitles: boolean;
}

/**
 * 操作类型
 */
export type OperationType = 
  | 'ADD_TRACK' 
  | 'REMOVE_TRACK' 
  | 'UPDATE_TRACK'
  | 'ADD_CLIP' 
  | 'REMOVE_CLIP' 
  | 'UPDATE_CLIP' 
  | 'MOVE_CLIP'
  | 'SPLIT_CLIP' 
  | 'UPDATE_SEGMENT' 
  | 'BATCH_UPDATE'
  | 'ADD_KEYFRAME'
  | 'UPDATE_KEYFRAME'
  | 'DELETE_KEYFRAME';

/**
 * 操作记录
 */
export interface Operation {
  type: OperationType;
  timestamp: number;
  payload: Record<string, unknown>;
}

/**
 * 保存状态请求
 */
export interface SaveStateRequest {
  version: number;
  changes: {
    tracks: Track[];
    clips: Clip[];
  };
  operations?: Operation[];
  forceOverride?: boolean;
}

/**
 * 保存状态响应
 */
export interface SaveStateResponse {
  success: boolean;
  version: number;
  message?: string;
  conflicts?: {
    type: 'version_mismatch';
    serverVersion: number;
    clientVersion: number;
  };
}
