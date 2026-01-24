// ==========================================
// 内容块相关类型 (Clip & Track Types)
// 前端使用驼峰命名（JS/TS 惯例），API 层负责与后端下划线命名转换
// ==========================================

/**
 * 内容块类型 - 所有类型都挂载在轨道上
 */
export type ClipType = 'video' | 'image' | 'audio' | 'text' | 'subtitle' | 'voice' | 'effect' | 'filter' | 'transition' | 'sticker';

/**
 * 素材类型颜色映射
 */
export const CLIP_TYPE_COLORS: Record<ClipType, string> = {
  video: 'bg-transparent',  // 视频使用透明背景显示缩略图
  image: 'bg-violet-600',   // 图片使用紫色背景
  audio: 'bg-green-600',
  text: 'bg-purple-600',
  subtitle: 'bg-yellow-600',
  voice: 'bg-teal-600',
  effect: 'bg-red-600',
  filter: 'bg-pink-600',
  transition: 'bg-orange-600',
  sticker: 'bg-cyan-600',
};

/**
 * 轨道定义
 * Track 是通用容器，不区分类型
 * 素材类型由 Clip.clipType 决定
 */
export interface Track {
  id: string;
  name: string;
  /** 顺序索引（越大越上层） */
  orderIndex: number;
  color: string;
  isVisible: boolean;
  isLocked: boolean;
  isMuted: boolean;
  adjustmentParams?: Record<string, unknown>;
}

/**
 * 内容块（轨道上的 Clip）
 * 核心概念：所有类型的内容都是 Clip
 * 
 * ⚠️ 时间单位统一：所有时间字段都使用【毫秒】(milliseconds)
 * 在 UI 显示时转换为秒，使用 msToSec() 工具函数
 */
export interface Clip {
  id: string;
  trackId: string;
  clipType: ClipType;
  
  // ============ 时间信息（毫秒 ms） ============
  /** 起始时间 (毫秒) */
  start: number;
  /** 时长 (毫秒) */
  duration: number;
  /** 片段在原始媒体中的起始偏移时间 (毫秒) */
  sourceStart: number;
  /** 原始素材总时长（毫秒） */
  originDuration?: number;
  
  // ============ 元数据 ============
  name: string;
  color: string;
  isLocal: boolean;
  
  // ============ 素材源信息 ============
  assetId?: string;
  thumbnail?: string;
  mediaUrl?: string;
  uploadStatus?: 'pending' | 'uploading' | 'uploaded' | 'failed';
  
  // ============ 分割追溯 ============
  parentClipId?: string;
  
  // ============ 音频属性 ============
  volume: number;
  isMuted: boolean;
  waveformData?: number[];
  
  // ============ 文本/字幕内容（统一字段，由 clipType 区分用途）============
  /** 文本内容 (text/subtitle 类型共用) */
  contentText?: string;
  /** 文本样式 */
  textStyle?: {
    fontFamily?: string;
    fontSize?: number;
    fontColor?: string;
    backgroundColor?: string;
    alignment?: 'left' | 'center' | 'right';
    /** 字幕特有：位置 */
    position?: 'top' | 'center' | 'bottom';
    /** 字幕特有：描边 */
    outline?: boolean;
    outlineColor?: string;
    /** 最大宽度（像素数字或百分比字符串），控制一行能放多少字 */
    maxWidth?: number | string;
  };

  // ============ 通用元数据 ============
  metadata?: Record<string, any>;

  // ============ 静音/智能处理元数据 (兼容性字段，通常存在于 metadata.silence_info) ============
  silenceInfo?: {
    classification: 'breath' | 'hesitation' | 'dead_air' | 'long_pause' | 'uncertain' | 'micro';
    duration_ms: number;
    reason: string;
    prev_ends_with_punct: boolean;
  };
  
  // ============ 配音属性 ============
  voiceParams?: {
    voiceId?: string;
    speed?: number;
    pitch?: number;
    emotion?: string;
  };
  
  // ============ 特效/滤镜属性 ============
  effectType?: string;
  effectParams?: Record<string, unknown>;
  
  // ============ 贴纸属性 ============
  stickerId?: string;
  
  // ============ 变换属性 ============
  transform?: {
    // 位置偏移 (像素或百分比)
    x?: number;
    y?: number;
    // 缩放 (1 = 100%)
    scale?: number;
    // 独立缩放 (用于文本框等需要非等比缩放的场景)
    scaleX?: number;  // 水平缩放
    scaleY?: number;  // 垂直缩放
    // 旋转角度 (度数)
    rotation?: number;
    // 不透明度 (0-1)
    opacity?: number;
    // 变换原点 (0-1, 默认0.5居中)
    // 用于AI智能缩放时，以人脸位置为中心放大
    anchorX?: number;
    anchorY?: number;
    // 翻转
    flipH?: boolean;  // 水平翻转
    flipV?: boolean;  // 垂直翻转
    // 裁剪区域 (相对于原始尺寸的百分比 0-1)
    cropRect?: {
      x: number;      // 左边起点
      y: number;      // 顶部起点
      width: number;  // 宽度
      height: number; // 高度
    };
  };
  
  // ============ 转场属性 ============
  transitionIn?: {
    type: string;
    duration: number;
    params?: Record<string, unknown>;
  };
  transitionOut?: {
    type: string;
    duration: number;
    params?: Record<string, unknown>;
  };
  
  // ============ 播放控制 ============
  speed: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  
  // ============ 转写内容（ASR 结果）============
  /** 该 clip 的语音转写结果 */
  transcript?: import('./transcript').TranscriptSegment[];
  /** 转写状态 */
  transcriptStatus?: 'pending' | 'processing' | 'completed' | 'failed';
}

/**
 * 右键菜单状态
 */
export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  clipId: string | null;
}

/**
 * 创建默认 Clip
 */
export function createDefaultClip(partial: Partial<Clip> & { id: string; trackId: string; clipType: ClipType }): Clip {
  return {
    start: partial.start ?? 0,
    duration: partial.duration ?? 0,
    sourceStart: partial.sourceStart ?? 0,
    name: partial.name ?? 'Clip',
    color: partial.color ?? CLIP_TYPE_COLORS[partial.clipType] ?? 'bg-blue-600',
    isLocal: partial.isLocal ?? false,
    volume: partial.volume ?? 1.0,
    isMuted: partial.isMuted ?? false,
    speed: partial.speed ?? 1.0,
    ...partial,
    // 必需字段放最后确保不被覆盖
    id: partial.id,
    trackId: partial.trackId,
    clipType: partial.clipType,
  };
}

/**
 * 创建默认 Track
 * Track 是通用容器，不区分类型
 */
export function createDefaultTrack(partial: Partial<Track> & { id: string }): Track {
  return {
    name: partial.name ?? 'Track',
    orderIndex: partial.orderIndex ?? 0,
    color: partial.color ?? 'text-blue-400',
    isVisible: partial.isVisible ?? true,
    isLocked: partial.isLocked ?? false,
    isMuted: partial.isMuted ?? false,
    ...partial,
    // 必需字段放最后确保不被覆盖
    id: partial.id,
  };
}
