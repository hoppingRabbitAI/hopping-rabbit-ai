/**
 * Timeline 工具函数和常量
 */
import type { ClipType } from '../types';

// ==================== 常量 ====================

/** 吸附阈值（毫秒）- 较小的值让吸附更精准 */
export const SNAP_THRESHOLD_MS = 50;

/** 吸附阈值（秒）- 兼容旧代码 */
export const SNAP_THRESHOLD = 0.05;

/** 统一轨道高度 */
export const TRACK_HEIGHT = 32;

/** 视频轨道高度 (与普通轨道统一) */
export const VIDEO_TRACK_HEIGHT = 32;

/** 分隔条高度 */
export const DIVIDER_HEIGHT = 8;

/** 容器顶部 padding (py-2 = 0.5rem = 8px) */
export const CONTAINER_PADDING_Y = 8;

/** 最小缩放 */
export const MIN_ZOOM = 0.05;

/** 最大缩放（20x = 毫秒级精度）*/
export const MAX_ZOOM = 20;

/** 每次缩放的比例（降低灵敏度）*/
export const ZOOM_STEP = 1.08;

// ==================== 接口定义 ====================

/** 拖拽状态 */
export interface DragState {
  clipId: string;
  startX: number;
  startY: number;
  originalStart: number;
  originalTrackId: string;
  clipType: ClipType;
  isDragging: boolean;
}

/** 边界调整状态 */
export interface ResizeState {
  clipId: string;
  edge: 'left' | 'right';
  startX: number;
  originalStart: number;
  originalDuration: number;
  originalTrimStart: number;
  originDuration: number;
}

/** 拉伸预览状态 */
export interface ResizePreview {
  clipId: string;
  start: number;
  duration: number;
  sourceStart: number;
}

// ==================== 工具函数 ====================

/**
 * 格式化时间为 HH:MM:SS
 */
export function formatMasterTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 格式化时间为 MM:SS.ms
 */
export function formatTimeWithMs(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/** 刻度间隔配置 */
export interface TickInterval {
  major: number;
  minor: number;
  format: (t: number) => string;
}

/**
 * 根据缩放级别计算刻度间隔
 */
export function getTickInterval(zoom: number, tickWidth: number): TickInterval {
  // 根据缩放级别选择合适的刻度间隔
  // 确保主刻度之间至少有 60px 的间距
  const minPixelGap = 60;
  const pixelsPerSecond = tickWidth * zoom;
  
  // 定义刻度级别（主刻度间隔，次刻度数量，格式化函数）
  const levels: Array<{ major: number; minorCount: number; format: (t: number) => string }> = [
    { major: 0.01, minorCount: 2, format: (t) => `${(t * 1000).toFixed(0)}ms` },
    { major: 0.05, minorCount: 5, format: (t) => `${(t * 1000).toFixed(0)}ms` },
    { major: 0.1, minorCount: 2, format: (t) => `${(t * 1000).toFixed(0)}ms` },
    { major: 0.25, minorCount: 5, format: (t) => `${t.toFixed(2)}s` },
    { major: 0.5, minorCount: 5, format: (t) => `${t.toFixed(1)}s` },
    { major: 1, minorCount: 4, format: (t) => `${t.toFixed(0)}s` },
    { major: 2, minorCount: 4, format: (t) => `${t.toFixed(0)}s` },
    { major: 5, minorCount: 5, format: (t) => `${t.toFixed(0)}s` },
    { major: 10, minorCount: 5, format: (t) => formatMasterTime(t) },
    { major: 30, minorCount: 6, format: (t) => formatMasterTime(t) },
    { major: 60, minorCount: 6, format: (t) => formatMasterTime(t) },
    { major: 300, minorCount: 5, format: (t) => formatMasterTime(t) },
    { major: 600, minorCount: 5, format: (t) => formatMasterTime(t) },
  ];
  
  // 找到合适的刻度级别
  for (const level of levels) {
    const pixelGap = level.major * pixelsPerSecond;
    if (pixelGap >= minPixelGap) {
      return {
        major: level.major,
        minor: level.major / level.minorCount,
        format: level.format,
      };
    }
  }
  
  // 默认返回最大的间隔
  const last = levels[levels.length - 1];
  return {
    major: last.major,
    minor: last.major / last.minorCount,
    format: last.format,
  };
}

/**
 * 计算吸附点
 * @param value 当前值
 * @param snapPoints 吸附点数组
 * @param threshold 吸附阈值
 * @returns 吸附后的值
 */
export function calculateSnapPoint(value: number, snapPoints: number[], threshold: number = SNAP_THRESHOLD): number {
  for (const point of snapPoints) {
    if (Math.abs(value - point) < threshold) {
      return point;
    }
  }
  return value;
}

/**
 * 计算目标轨道索引
 */
export function calculateTargetTrackIndex(
  clientY: number,
  containerRect: DOMRect,
  scrollTop: number,
  trackCount: number
): number {
  const relativeY = clientY - containerRect.top + scrollTop - CONTAINER_PADDING_Y;
  const trackSlotHeight = TRACK_HEIGHT + DIVIDER_HEIGHT;
  const rawIndex = Math.floor(relativeY / trackSlotHeight);
  return Math.max(0, Math.min(trackCount - 1, rawIndex));
}
