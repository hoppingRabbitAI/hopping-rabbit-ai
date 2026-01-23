/**
 * HoppingRabbit AI - 时间单位工具函数
 * 
 * 时间单位规范：
 * - 内部存储/传输：毫秒（int）
 * - UI 展示：秒（float）
 * - 数据库：毫秒（int）
 * - API 交互：毫秒（int）
 */

/**
 * 毫秒转秒（用于 UI 展示）
 */
export function msToSec(ms: number): number {
  return ms / 1000;
}

/**
 * 秒转毫秒（用于存储/传输）
 */
export function secToMs(sec: number): number {
  return Math.round(sec * 1000);
}

/**
 * 格式化毫秒为时间字符串 MM:SS.ms
 */
export function formatTimeMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor((totalSeconds % 1) * 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${milliseconds}`;
}

/**
 * 格式化毫秒为简单时间字符串 MM:SS
 */
export function formatTimeMsSimple(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 格式化秒为时间字符串（兼容旧代码）
 */
export function formatTimeSec(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, '0')}.${ms}`;
}

/**
 * 解析时间字符串为毫秒
 * 支持格式: "1:30", "1:30.5", "90", "90.5"
 */
export function parseTimeToMs(timeStr: string): number {
  const parts = timeStr.split(':');
  let seconds = 0;
  
  if (parts.length === 2) {
    // MM:SS 或 MM:SS.ms
    seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  } else {
    // 纯秒数
    seconds = parseFloat(timeStr);
  }
  
  return Math.round(seconds * 1000);
}

/**
 * 时间单位常量
 */
export const TIME_UNITS = {
  MS_PER_SECOND: 1000,
  MS_PER_MINUTE: 60000,
  MS_PER_HOUR: 3600000,
} as const;
