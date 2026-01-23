/**
 * HoppingRabbit AI - 字幕类型定义
 */

/**
 * 字幕样式配置
 */
export interface SubtitleStyle {
  /** 字体族 */
  fontFamily: string;
  /** 字体大小 (px) */
  fontSize: number;
  /** 字体颜色 */
  fontColor: string;
  /** 字体粗细 */
  fontWeight: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  /** 是否斜体 */
  italic: boolean;
  /** 文本对齐 */
  textAlign: 'left' | 'center' | 'right';
  
  /** 描边颜色 */
  strokeColor: string;
  /** 描边宽度 */
  strokeWidth: number;
  
  /** 背景颜色 */
  backgroundColor: string;
  /** 背景透明度 0-1 */
  backgroundOpacity: number;
  /** 背景圆角 */
  backgroundRadius: number;
  /** 背景内边距 */
  backgroundPadding: number;
  
  /** 阴影颜色 */
  shadowColor: string;
  /** 阴影模糊 */
  shadowBlur: number;
  /** 阴影 X 偏移 */
  shadowOffsetX: number;
  /** 阴影 Y 偏移 */
  shadowOffsetY: number;
  
  /** 字间距 */
  letterSpacing: number;
  /** 行高 */
  lineHeight: number;
}

/**
 * 字幕位置
 */
export type SubtitlePosition = 
  | 'top'
  | 'middle' 
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/**
 * 字幕动画类型
 */
export type SubtitleAnimation = 
  | 'none'
  | 'fade'
  | 'typewriter'
  | 'slide-up'
  | 'slide-down'
  | 'scale'
  | 'bounce'
  | 'word-by-word';

/**
 * 单条字幕
 */
export interface Subtitle {
  /** 字幕 ID */
  id: string;
  /** 字幕文本 */
  text: string;
  /** 开始时间 (秒) */
  start: number;
  /** 结束时间 (秒) */
  end: number;
  /** 说话人 ID */
  speakerId?: string;
  /** 样式覆盖（合并到全局样式） */
  style?: Partial<SubtitleStyle>;
  /** 位置覆盖 */
  position?: SubtitlePosition;
  /** 动画类型 */
  animation?: SubtitleAnimation;
  /** 原始片段 ID */
  segmentId?: string;
  /** 是否手动编辑过 */
  isManuallyEdited?: boolean;
}

/**
 * 字幕轨道
 */
export interface SubtitleTrack {
  /** 轨道 ID */
  id: string;
  /** 轨道名称 */
  name: string;
  /** 语言代码 */
  language: string;
  /** 是否为主字幕轨 */
  isPrimary: boolean;
  /** 全局样式 */
  style: SubtitleStyle;
  /** 位置 */
  position: SubtitlePosition;
  /** 垂直偏移 (%) */
  verticalOffset: number;
  /** 字幕列表 */
  subtitles: Subtitle[];
  /** 是否可见 */
  visible: boolean;
}

/**
 * 字幕预设
 */
export interface SubtitlePreset {
  id: string;
  name: string;
  style: SubtitleStyle;
  position: SubtitlePosition;
  animation: SubtitleAnimation;
  thumbnail?: string;
}

/**
 * 默认字幕样式
 */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'Noto Sans SC',
  fontSize: 13,
  fontColor: '#FFFFFF',
  fontWeight: 'bold',
  italic: false,
  textAlign: 'center',
  
  strokeColor: '#000000',
  strokeWidth: 2,
  
  backgroundColor: 'transparent',
  backgroundOpacity: 0,
  backgroundRadius: 4,
  backgroundPadding: 8,
  
  shadowColor: '#000000',
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  
  letterSpacing: 0,
  lineHeight: 1.4,
};

/**
 * 内置字幕预设
 */
export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  {
    id: 'classic',
    name: '经典白字',
    style: DEFAULT_SUBTITLE_STYLE,
    position: 'bottom',
    animation: 'fade',
  },
  {
    id: 'youtube',
    name: 'YouTube 风格',
    style: {
      ...DEFAULT_SUBTITLE_STYLE,
      fontSize: 36,
      fontWeight: 'normal',
      backgroundColor: '#000000',
      backgroundOpacity: 0.75,
      backgroundRadius: 4,
      strokeWidth: 0,
    },
    position: 'bottom',
    animation: 'none',
  },
  {
    id: 'tiktok',
    name: '抖音风格',
    style: {
      ...DEFAULT_SUBTITLE_STYLE,
      fontSize: 56,
      fontWeight: 'bold',
      fontColor: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 3,
      backgroundColor: 'transparent',
      backgroundOpacity: 0,
      shadowBlur: 8,
    },
    position: 'middle',
    animation: 'word-by-word',
  },
  {
    id: 'bilibili',
    name: 'B站风格',
    style: {
      ...DEFAULT_SUBTITLE_STYLE,
      fontSize: 42,
      fontWeight: '600',
      fontColor: '#FFFFFF',
      strokeColor: '#00A1D6',
      strokeWidth: 1.5,
      backgroundColor: 'transparent',
      backgroundOpacity: 0,
    },
    position: 'bottom',
    animation: 'fade',
  },
  {
    id: 'minimal',
    name: '简约风格',
    style: {
      ...DEFAULT_SUBTITLE_STYLE,
      fontSize: 32,
      fontWeight: 'normal',
      fontColor: '#FFFFFF',
      strokeWidth: 0,
      backgroundColor: 'transparent',
      backgroundOpacity: 0,
      shadowColor: '#000000',
      shadowBlur: 2,
      shadowOffsetX: 1,
      shadowOffsetY: 1,
    },
    position: 'bottom',
    animation: 'fade',
  },
  {
    id: 'highlight',
    name: '高亮背景',
    style: {
      ...DEFAULT_SUBTITLE_STYLE,
      fontSize: 40,
      fontWeight: 'bold',
      fontColor: '#000000',
      strokeWidth: 0,
      backgroundColor: '#FFEB3B',
      backgroundOpacity: 1,
      backgroundRadius: 8,
      backgroundPadding: 12,
    },
    position: 'bottom',
    animation: 'scale',
  },
];

/**
 * 可用字体列表
 */
export const AVAILABLE_FONTS = [
  { name: 'Noto Sans SC', label: '思源黑体' },
  { name: 'Noto Serif SC', label: '思源宋体' },
  { name: 'ZCOOL XiaoWei', label: '站酷小薇' },
  { name: 'ZCOOL QingKe HuangYou', label: '站酷庆科黄油体' },
  { name: 'Ma Shan Zheng', label: '马善政楷书' },
  { name: 'Liu Jian Mao Cao', label: '刘建毛草' },
  { name: 'Long Cang', label: '龙藏体' },
  { name: 'Zhi Mang Xing', label: '芝麻行' },
  { name: 'Arial', label: 'Arial' },
  { name: 'Helvetica', label: 'Helvetica' },
  { name: 'Times New Roman', label: 'Times New Roman' },
  { name: 'Georgia', label: 'Georgia' },
];
