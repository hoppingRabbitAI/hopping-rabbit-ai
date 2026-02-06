/**
 * 视频播放系统类型定义
 * 
 * 设计原则：
 * - 全程 clip 维度操作，与 asset 解耦
 * - 单一数据源，避免多个池的状态不一致
 * - 简单状态机：loading -> ready -> error
 */

/**
 * Clip 视频加载状态
 * - loading: 正在加载视频元数据或缓冲数据
 * - ready: 视频已缓冲足够数据，可以流畅播放
 * - error: 加载失败
 */
export type ClipVideoStatus = 'loading' | 'ready' | 'error';

/**
 * 缓冲范围（秒）
 * 表示视频中已缓冲的时间区间
 */
export interface BufferedRange {
  start: number;  // 开始时间（秒）
  end: number;    // 结束时间（秒）
}

/**
 * 视频源类型
 * - mp4: 使用 MP4 代理直接加载
 * - hls: 使用 HLS.js 流式加载
 */
export type VideoSourceType = 'mp4' | 'hls';

/**
 * Clip 视频状态（单一数据源）
 * 
 * 每个 clip 对应一个 ClipVideoState
 * clipId 是唯一标识，与 assetId 无关
 */
export interface ClipVideoState {
  /** Clip 唯一标识 */
  clipId: string;
  
  /** 对应的 asset ID（用于构建 MP4 URL） */
  assetId: string;
  
  /** HTMLVideoElement 实例 */
  element: HTMLVideoElement;
  
  /** 视频源 URL（MP4 代理或 HLS） */
  src: string;
  
  /** 视频源类型 */
  sourceType: VideoSourceType;
  
  /** HLS.js 实例（仅 sourceType === 'hls' 时有值） */
  hls?: import('hls.js').default;
  
  /** 当前加载状态 */
  status: ClipVideoStatus;
  
  /** 已缓冲的时间范围列表 */
  bufferedRanges: BufferedRange[];
  
  /** 最后访问时间（用于 LRU 淘汰） */
  lastAccessTime: number;
  
  /** clip 在素材中的起止时间（用于判断需要缓冲的范围） */
  clipStartInAsset: number;  // inPoint（秒）
  clipEndInAsset: number;    // outPoint（秒）
  
  /** 是否是 B-Roll（B-Roll 强制使用 MP4） */
  isBRoll: boolean;
  
  /** 错误信息（status === 'error' 时有值） */
  errorMessage?: string;
}

/**
 * 视频资源管理器配置
 */
export interface VideoResourceConfig {
  /** 最大活跃视频元素数量（超过会触发 LRU 淘汰） */
  maxActiveVideos: number;
  
  /** 预热窗口大小（秒）- 当前播放位置前后多少秒的 clip 需要预热 */
  preheatWindowSec: number;
  
  /** 同步阈值（秒）- 视频 currentTime 与目标时间差超过此值才 seek */
  seekThreshold: number;
  
  /** 缓冲阈值（秒）- 需要多少秒的缓冲才认为 ready */
  bufferThreshold: number;
  
  /** HLS 阈值（秒）- clip 时长超过此值使用 HLS，否则用 MP4 */
  hlsThreshold: number;
  
  /** 调试模式 */
  debug: boolean;
}

/**
 * 默认配置
 * 
 * 视频类型分流策略：
 * - 短 clip (< 10秒)：MP4 proxy（更快，无 HLS 开销）
 * - 长视频 (≥ 10秒)：HLS（流式加载优势明显）
 * - B-Roll：强制 MP4（需要精确 seek）
 */
export const DEFAULT_VIDEO_RESOURCE_CONFIG: VideoResourceConfig = {
  maxActiveVideos: 10,
  preheatWindowSec: 15,
  seekThreshold: 0.3,
  bufferThreshold: 2,
  hlsThreshold: 10, // 10秒阈值
  debug: process.env.NODE_ENV === 'development',
};

/**
 * Clip 调度优先级
 */
export interface ClipScheduleItem {
  clipId: string;
  assetId: string;
  priority: number;           // 数字越小优先级越高
  startTimeInTimeline: number; // 在时间线中的开始时间（秒）
  endTimeInTimeline: number;   // 在时间线中的结束时间（秒）
  inPoint: number;            // 素材内起点（秒）
  outPoint: number;           // 素材内终点（秒）
  isCurrent: boolean;         // 是否是当前正在播放的 clip
  distance: number;           // 与当前播放头的距离（秒），负数表示已过
}

/**
 * 播放控制器状态
 */
export interface PlaybackState {
  /** 是否正在播放 */
  isPlaying: boolean;
  
  /** 当前播放头位置（秒） */
  playhead: number;
  
  /** 当前正在播放的 clip ID */
  currentClipId: string | null;
  
  /** 是否正在等待加载 */
  isWaitingForLoad: boolean;
  
  /** 等待加载的 clip ID */
  waitingForClipId: string | null;
}

/**
 * 资源层事件类型
 */
export type VideoResourceEvent = 
  | { type: 'load-start'; clipId: string }
  | { type: 'load-ready'; clipId: string }
  | { type: 'load-error'; clipId: string; error: string }
  | { type: 'evicted'; clipId: string }
  | { type: 'seek'; clipId: string; time: number };
