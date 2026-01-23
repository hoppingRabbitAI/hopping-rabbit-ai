// ==========================================
// 转写相关类型 (Transcript Types)
// ==========================================

/**
 * 单个词的转写结果（来自 Whisper）
 */
export interface TranscriptWord {
  /** 词文本 */
  word: string;
  /** 开始时间 (秒) */
  start: number;
  /** 结束时间 (秒) */
  end: number;
  /** 置信度 0-1 */
  confidence: number;
}

/**
 * 片段类型
 */
export type SegmentType = 'normal' | 'filler' | 'silence';

/**
 * 删除原因
 */
export type DeleteReason = 'silence' | 'disfluency' | 'manual' | 'speaker_filter';

/**
 * 一个句子/片段
 */
export interface TranscriptSegment {
  /** 片段唯一 ID */
  id: string;
  /** 完整文本 */
  text: string;
  /** 开始时间 */
  start: number;
  /** 结束时间 */
  end: number;
  /** 片段类型 */
  type?: SegmentType;
  /** 逐词数据 */
  words: TranscriptWord[];
  /** 说话人 ID */
  speaker?: string;
  /** 是否已被用户删除 (软删除) */
  deleted?: boolean;
  /** 新版删除标记 */
  is_deleted?: boolean;
  /** 是否应用智能放大 */
  autoZoom?: boolean;
  auto_zoom?: boolean;
  /** 删除原因 */
  delete_reason?: DeleteReason;
}
