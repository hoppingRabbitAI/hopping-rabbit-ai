/**
 * 内容可视化类型定义
 * 
 * 核心理念：按内容语义切分，而非时间机械切分
 * 每个 ContentSegment 代表一个完整的"主题"或"论点"
 */

// ============================================
// 可视化类型
// ============================================

/**
 * 可视化类型枚举
 * 定义了口播视频中可用的各种展示方式
 */
export type VisualizationType = 
  | 'talking-head'      // 纯口播，无叠加（适合开场/总结）
  | 'broll-overlay'     // B-Roll 叠加 + PiP（适合案例/场景描述）
  | 'text-highlight'    // 关键词/标题动画浮现（适合强调概念）
  | 'list-animation'    // 要点列表逐条展示（适合论点罗列）
  | 'quote-display'     // 引用/金句展示（适合名言/结论）
  | 'split-screen'      // 分屏：左口播右内容（适合对比/展示）
  | 'fullscreen-text'   // 全屏文字（适合过渡/章节标题）
  | 'number-highlight'  // 数字强调（适合数据/统计）
  | 'icon-text';        // 图标 + 文字动画（适合概念解释）

/**
 * 情感类型
 */
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'inspiring' | 'warning';

// ============================================
// 内容结构
// ============================================

/**
 * 内容分析结果
 */
export interface ContentAnalysis {
  topic: string;             // 主题标题（AI 生成，如"开场引入"）
  summary: string;           // 内容摘要（1-2 句话）
  keyPoints: string[];       // 关键要点列表（用于 list-animation）
  keywords: string[];        // 关键词（用于 text-highlight）
  sentiment: Sentiment;      // 情感倾向
  highlightNumber?: {        // 数字高亮（用于 number-highlight）
    value: string;
    label: string;
  };
  quote?: string;            // 金句（用于 quote-display）
}

/**
 * 可视化配置
 */
export interface VisualizationConfig {
  // 过渡动画
  transition: 'fade' | 'slide' | 'zoom' | 'none';
  transitionDuration: number; // ms
  
  // 文字样式（用于 text-highlight, quote-display 等）
  textStyle?: {
    fontSize: number;
    fontFamily: string;
    color: string;
    backgroundColor?: string;
    position: 'center' | 'bottom' | 'top';
    shadowEnabled?: boolean;
  };
  
  // 列表动画配置（用于 list-animation）
  listConfig?: {
    animationType: 'fade-in' | 'slide-up' | 'typewriter' | 'check-mark';
    staggerDelay: number; // 每项间隔 ms
    bulletStyle: 'number' | 'dot' | 'check' | 'arrow';
  };
  
  // B-Roll 配置（用于 broll-overlay）
  brollConfig?: {
    opacity: number;        // B-Roll 不透明度
    pipEnabled: boolean;    // 是否显示 PiP
    pipPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    pipSize: 'small' | 'medium' | 'large';
    fadeIn: number;         // 淡入时长 ms
    fadeOut: number;        // 淡出时长 ms
  };
  
  // 分屏配置（用于 split-screen）
  splitConfig?: {
    ratio: '50-50' | '40-60' | '60-40' | '30-70';
    contentPosition: 'left' | 'right';
  };
}

/**
 * B-Roll 素材
 */
export interface BRollAsset {
  id: string;
  url: string;
  thumbnailUrl?: string;
  source: 'pexels' | 'local' | 'ai-generated' | 'user-upload';
  duration?: number;
  keywords?: string[];
}

// ============================================
// 核心类型：ContentSegment
// ============================================

/**
 * 内容片段（核心类型）
 * 
 * 一个 ContentSegment 代表视频中一个完整的"主题单元"
 * 例如：开场白、论点1、案例说明、总结等
 */
export interface ContentSegment {
  id: string;
  segmentNumber: number;     // 片段序号
  
  // 时间范围（从 ASR 推断）
  timeRange: {
    start: number;           // ms
    end: number;             // ms
  };
  
  // 原始文本
  rawText: string;           // ASR 转写的原始文本
  
  // AI 分析的内容结构
  content: ContentAnalysis;
  
  // AI 推荐的可视化方式
  visualization: {
    type: VisualizationType;
    confidence: number;      // AI 推荐置信度 0-1
    config: VisualizationConfig;
  };
  
  // B-Roll 素材（可选，type=broll-overlay 时使用）
  brollAsset?: BRollAsset;
  
  // 用户是否手动调整过
  userModified?: boolean;
}

// ============================================
// API 响应类型
// ============================================

/**
 * 内容分析 API 响应
 */
export interface ContentAnalysisResponse {
  sessionId: string;
  projectId: string;
  
  // 视频整体信息
  videoTitle: string;        // AI 生成的视频标题
  videoSummary: string;      // 视频内容摘要
  totalDuration: number;     // 总时长 ms
  
  // 内容片段列表
  segments: ContentSegment[];
  
  // 统计信息
  stats: {
    totalSegments: number;
    brollSegments: number;
    listSegments: number;
    textHighlightSegments: number;
  };
}

// ============================================
// 默认配置
// ============================================

export const DEFAULT_VISUALIZATION_CONFIG: VisualizationConfig = {
  transition: 'fade',
  transitionDuration: 300,
  textStyle: {
    fontSize: 48,
    fontFamily: 'system-ui, sans-serif',
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.7)',
    position: 'bottom',
    shadowEnabled: true,
  },
  listConfig: {
    animationType: 'slide-up',
    staggerDelay: 600,
    bulletStyle: 'check',
  },
  brollConfig: {
    opacity: 1,
    pipEnabled: true,
    pipPosition: 'bottom-right',
    pipSize: 'medium',
    fadeIn: 300,
    fadeOut: 300,
  },
};

/**
 * 根据可视化类型获取默认配置
 */
export function getDefaultConfigForType(type: VisualizationType): Partial<VisualizationConfig> {
  switch (type) {
    case 'talking-head':
      return { transition: 'none', transitionDuration: 0 };
    
    case 'broll-overlay':
      return {
        transition: 'fade',
        transitionDuration: 300,
        brollConfig: DEFAULT_VISUALIZATION_CONFIG.brollConfig,
      };
    
    case 'list-animation':
      return {
        transition: 'fade',
        transitionDuration: 200,
        listConfig: DEFAULT_VISUALIZATION_CONFIG.listConfig,
        textStyle: {
          ...DEFAULT_VISUALIZATION_CONFIG.textStyle!,
          fontSize: 36,
          position: 'center',
        },
      };
    
    case 'text-highlight':
      return {
        transition: 'zoom',
        transitionDuration: 400,
        textStyle: {
          ...DEFAULT_VISUALIZATION_CONFIG.textStyle!,
          fontSize: 64,
          position: 'center',
        },
      };
    
    case 'quote-display':
      return {
        transition: 'fade',
        transitionDuration: 500,
        textStyle: {
          ...DEFAULT_VISUALIZATION_CONFIG.textStyle!,
          fontSize: 42,
          position: 'center',
          backgroundColor: 'rgba(0,0,0,0.85)',
        },
      };
    
    case 'fullscreen-text':
      return {
        transition: 'slide',
        transitionDuration: 400,
        textStyle: {
          ...DEFAULT_VISUALIZATION_CONFIG.textStyle!,
          fontSize: 72,
          position: 'center',
          backgroundColor: '#1a1a1a',
        },
      };
    
    case 'number-highlight':
      return {
        transition: 'zoom',
        transitionDuration: 300,
        textStyle: {
          ...DEFAULT_VISUALIZATION_CONFIG.textStyle!,
          fontSize: 96,
          position: 'center',
        },
      };
    
    default:
      return DEFAULT_VISUALIZATION_CONFIG;
  }
}
