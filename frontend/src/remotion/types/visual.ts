/**
 * Remotion Agent 视觉组件类型定义
 * 
 * 对应设计文档: docs/REMOTION_AGENT_SPEC.md
 */

// ============================================
// 动画配置
// ============================================

export type EnterAnimation = 
  | 'fade' 
  | 'slide-up' 
  | 'slide-down' 
  | 'zoom' 
  | 'typewriter' 
  | 'bounce' 
  | 'draw';

export type ExitAnimation = 
  | 'fade' 
  | 'slide-up' 
  | 'slide-down' 
  | 'zoom';

export interface AnimationConfig {
  enter: EnterAnimation;
  exit: ExitAnimation;
  durationMs?: number;
}

// ============================================
// 位置配置
// ============================================

export type OverlayPosition = 
  | 'center' 
  | 'top' 
  | 'bottom'
  | 'top-left' 
  | 'top-right'
  | 'bottom-left' 
  | 'bottom-right'
  | 'bottom-center';

export type PipPosition = 
  | 'bottom-right' 
  | 'bottom-left'
  | 'top-right' 
  | 'top-left'
  | 'bottom-center';

// ============================================
// 画布组件 (Canvas)
// ============================================

// --- 要点列表 ---

export interface HighlightConfig {
  word: string;
  color: 'green' | 'red' | 'yellow' | 'blue' | string;
}

export interface PointListItem {
  id: string;
  text: string;
  revealAtMs: number;
  highlight?: HighlightConfig;
}

export interface PointListCanvasProps {
  title?: string;
  subtitle?: string;
  items: PointListItem[];
  style: 'numbered' | 'bulleted' | 'checked' | 'handwritten';
  position: 'left' | 'right' | 'center';
  background?: 'paper' | 'white' | 'gradient';
}

// --- 流程图/递进图 ---

export type ProcessStepType = 'question' | 'concept' | 'explanation' | 'conclusion';

export interface ProcessStepStyle {
  bordered?: boolean;
  color?: string;
}

export interface ProcessFlowStep {
  id: string;
  text: string;
  subText?: string;
  type: ProcessStepType;
  style?: ProcessStepStyle;
  activateAtMs: number;
}

export interface ProcessFlowCanvasProps {
  title?: string;
  steps: ProcessFlowStep[];
  direction: 'horizontal' | 'vertical';
  connector: 'arrow' | 'line' | 'none';
  background?: 'paper' | 'white' | 'cream';
}

// --- 对比表格 ---

export interface ComparisonRow {
  left: string;
  right: string;
  revealAtMs: number;
}

export interface ComparisonCanvasProps {
  leftTitle: string;
  rightTitle: string;
  rows: ComparisonRow[];
}

// --- 概念卡片 ---

export interface ConceptCardProps {
  term: string;
  definition: string;
  keyPoints?: string[];
  revealAtMs: number;
}

// --- 画布总配置 ---

export type CanvasType = 'point-list' | 'process-flow' | 'comparison-table' | 'concept-card';

export interface CanvasConfig {
  type: CanvasType;
  pointList?: PointListCanvasProps;
  processFlow?: ProcessFlowCanvasProps;
  comparisonTable?: ComparisonCanvasProps;
  conceptCard?: ConceptCardProps;
}

// ============================================
// 叠加组件 (Overlays)
// ============================================

export type OverlayType = 
  | 'chapter-title'
  | 'keyword-card'
  | 'data-number'
  | 'quote-block'
  | 'highlight-box'
  | 'progress-indicator'
  | 'definition-card'
  | 'question-hook';

// --- KeywordCard ---

// 🆕 扩展的 5 种变体
export type KeywordCardVariant = 
  | 'tip' 
  | 'warning' 
  | 'key' 
  | 'quote'
  | 'dark-solid'      // 深色实心
  | 'light-solid'     // 浅色实心  
  | 'semi-transparent' // 半透明
  | 'gradient'        // 渐变
  | 'numbered';       // 带序号

export interface KeywordCardProps {
  title?: string;
  text: string;
  variant?: KeywordCardVariant;
  position?: OverlayPosition;
  animation?: AnimationConfig;
  number?: number;     // 🆕 用于 numbered 变体
  accentColor?: string; // 🆕 自定义强调色
}

// --- DataNumber ---

export type TrendDirection = 'up' | 'down' | 'neutral';

export interface DataNumberProps {
  value: string;
  label: string;
  trend?: TrendDirection;
  color?: string;
  size?: 'small' | 'medium' | 'large';
  position?: OverlayPosition;
  animation?: AnimationConfig;
}

// --- HighlightBox ---

export type HighlightBoxStyle = 'solid' | 'dashed' | 'handdrawn';

export interface HighlightBoxProps {
  text: string;
  color?: string;
  boxStyle?: HighlightBoxStyle;
  position?: OverlayPosition;
  animation?: AnimationConfig;
}

// --- QuestionHook ---

export interface QuestionHookProps {
  question: string;
  position?: OverlayPosition;
  animation?: AnimationConfig;
}

// --- ChapterTitle ---

export interface ChapterTitleProps {
  number?: number;
  title: string;
  position?: OverlayPosition;
  animation?: AnimationConfig;
}

// --- ProgressIndicator ---

export interface ProgressIndicatorProps {
  current: number;
  total: number;
  position?: OverlayPosition;
}

// --- QuoteBlock ---

export interface QuoteBlockProps {
  text: string;
  source?: string;
  position?: OverlayPosition;
  animation?: AnimationConfig;
}

// --- 叠加组件通用配置 ---

export interface OverlayConfig {
  id: string;
  type: OverlayType;
  startMs: number;
  endMs: number;
  content: 
    | KeywordCardProps 
    | DataNumberProps 
    | HighlightBoxProps 
    | QuestionHookProps 
    | ChapterTitleProps 
    | ProgressIndicatorProps 
    | QuoteBlockProps;
  position: OverlayPosition;
  animation: AnimationConfig;
}

// ============================================
// 主视频配置
// ============================================

export interface PipConfig {
  position: PipPosition;
  size: 'small' | 'medium' | 'large';
  shape: 'rectangle' | 'circle';
}

export interface MainVideoConfig {
  url?: string;
  defaultMode: 'fullscreen' | 'pip';
  pip: PipConfig;
}

// ============================================
// 字幕配置
// ============================================

export type SubtitleStyle = 'modern' | 'classic' | 'minimal' | 'handwritten';

export interface SubtitleConfig {
  enabled: boolean;
  style: SubtitleStyle;
  position: 'bottom' | 'top';
  highlightKeywords: boolean;
  highlightColor?: string;
  background?: 'blur' | 'solid' | 'none';
}

// ============================================
// 背景配置
// ============================================

export type BackgroundType = 'solid' | 'gradient' | 'paper' | 'whiteboard';
export type BackgroundTexture = 'none' | 'paper' | 'grid' | 'dots';

export interface BackgroundConfig {
  type: BackgroundType;
  color?: string;
  colors?: string[];  // 渐变色数组
  gradientColors?: string[];  // 向后兼容
  direction?: number;  // 渐变角度
  texture?: BackgroundTexture;
}

// ============================================
// 带时间轴的画布配置 (用于渲染)
// ============================================

export interface CanvasConfigWithTiming extends CanvasConfig {
  segmentId: string;
  startMs: number;
  endMs: number;
}

// ============================================
// 带时间轴的叠加组件配置 (用于渲染)
// ============================================

export interface OverlayConfigWithTiming {
  type: OverlayType;
  startMs: number;
  endMs: number;
  
  // 具体组件 props（根据 type 选择一个）
  keywordCard?: KeywordCardProps;
  dataNumber?: DataNumberProps;
  highlightBox?: HighlightBoxProps;
  questionHook?: QuestionHookProps;
  chapterTitle?: ChapterTitleProps;
  progressIndicator?: ProgressIndicatorProps;
  quoteBlock?: QuoteBlockProps;
}

// ============================================
// PiP 配置 (视觉配置中使用)
// ============================================

export interface PipConfigForVisual {
  position: PipPosition;
  size?: {
    width: number;
    height: number;
  };
  visible?: boolean;
}

// ============================================
// 完整视觉配置 (Remotion Agent 输出)
// ============================================

export interface VisualConfig {
  version: string;
  template: string;
  durationMs: number;
  fps: number;
  
  background?: BackgroundConfig;
  mainVideo?: MainVideoConfig;
  canvas: CanvasConfigWithTiming[];  // ★ 画布数组
  overlays: OverlayConfigWithTiming[];  // ★ 叠加组件数组
  subtitles?: SubtitleConfig;
  pip?: PipConfigForVisual;  // ★ PiP 配置
}

// ============================================
// 模版配置
// ============================================

export type PresentationMode = 'canvas' | 'talking-head' | 'split' | 'cinematic';
export type TalkingHeadRole = 'main' | 'pip' | 'hidden';
export type InfoRevealMode = 'progressive' | 'all-at-once' | 'narrative';
export type CanvasPersistence = 'persistent' | 'segment-based' | 'none';

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  category: 'knowledge' | 'story' | 'review' | 'news';
  
  presentationMode: {
    primary: PresentationMode;
    talkingHeadRole: TalkingHeadRole;
    infoReveal: InfoRevealMode;
    canvasPersistence: CanvasPersistence;
  };
  
  style: {
    primary: string;
    secondary: string;
    accent: string;
    background: BackgroundConfig;
    typography: {
      fontFamily: string;
      headingWeight: number;
      bodyWeight: number;
    };
    animation: {
      duration: 'fast' | 'normal' | 'slow';
      easing: string;
    };
    borderRadius: 'none' | 'small' | 'medium' | 'large';
  };
  
  components: {
    canvas: {
      defaultPosition: 'left' | 'right' | 'center';
      listStyle: 'numbered' | 'bulleted' | 'checked' | 'handwritten';
      flowConnector: 'arrow' | 'line' | 'none';
    };
    overlay: {
      defaultAnimation: AnimationConfig;
      highlightBoxStyle: HighlightBoxStyle;
    };
    subtitle: {
      style: SubtitleStyle;
      background: 'blur' | 'solid' | 'none';
      highlightColor: string;
    };
    pip: PipConfig;
  };
}

// ============================================
// 🆕 PiP 组件配置 (Week 3)
// ============================================

export type PipShape = 'rectangle' | 'circle' | 'rounded';

export type ExtendedPipPosition = 
  | 'bottom-right' 
  | 'bottom-left'
  | 'bottom-center'
  | 'top-right' 
  | 'top-left';

export type PipSize = 'small' | 'medium' | 'large';

// 人物画中画
export interface PersonPipProps {
  videoSrc: string;
  position: ExtendedPipPosition;
  size: PipSize;
  shape: PipShape;
  borderColor?: string;
  borderWidth?: number;
  shadow?: boolean;
  visible?: boolean;
}

// B-Roll 画中画
export interface BrollPipProps {
  mediaSrc: string;          // 图片或视频 URL
  mediaType: 'image' | 'video';
  position: ExtendedPipPosition;
  size: PipSize;
  shape?: PipShape;
  borderColor?: string;
  borderWidth?: number;
  shadow?: boolean;
  caption?: string;          // 可选标题
  visible?: boolean;
}

// 布局切换配置
export type LayoutTransition = 'smooth' | 'cut' | 'fade';

export interface LayoutSwitchEvent {
  timeMs: number;
  fromLayout: 'fullscreen' | 'pip' | 'split';
  toLayout: 'fullscreen' | 'pip' | 'split';
  transition: LayoutTransition;
  transitionDurationMs?: number;
}

// 动态布局配置
export interface DynamicLayoutProps {
  mainVideoSrc: string;
  brollSrc?: string;
  brollType?: 'image' | 'video';
  initialLayout: 'fullscreen' | 'pip' | 'split';
  switches: LayoutSwitchEvent[];
  personPipConfig?: Omit<PersonPipProps, 'videoSrc'>;
  brollPipConfig?: Omit<BrollPipProps, 'mediaSrc' | 'mediaType'>;
}
