/**
 * 智能功能面板 - 共享类型定义
 */

export interface SilenceSegment {
  start: number;
  end: number;
  duration: number;
  type?: 'silence';
}

export interface FillerWord {
  word: string;          // 填充词文本
  start: number;
  end: number;
  confidence: number;
  category?: 'hesitation' | 'filler' | 'repetition';
  language?: 'zh' | 'en';
}

export interface Speaker {
  id: string;
  name: string;          // 说话人名称
  color: string;
  totalDuration: number; // 总时长
  segment_count?: number;
}

export interface SpeakerSegment {
  speakerId: string;     // 说话人 ID
  start: number;
  end: number;
  duration?: number;
  confidence?: number;
}

export interface StemTrack {
  name: string;          // 音轨名称 (vocals, drums, bass, etc.)
  url: string;
  volume?: number;
  duration?: number;
}

export interface SmartPanelProps {
  projectId: string;
  audioUrl?: string;
  transcript?: {
    text: string;
    words?: Array<{
      word: string;
      start: number;
      end: number;
      confidence: number;
    }>;
  };
  onApplyEdits?: (edits: EditAction[]) => void;
  onApplyStems?: (stems: StemTrack[]) => void;
}

/** 编辑操作 */
export interface EditAction {
  type: string;
  start: number;
  end: number;
  reason?: string;
}
