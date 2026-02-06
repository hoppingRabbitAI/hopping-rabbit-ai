/**
 * Remotion 模块导出
 */
export { RemotionRoot } from './Root';

// 通用视频合成
export { VideoComposition, VideoCompositionSchema } from './compositions/VideoComposition';
export type { VideoCompositionProps, ClipData, TrackData } from './compositions/VideoComposition';

// B-Roll 合成（旧版，clip 维度）
export { BRollComposition, BRollCompositionSchema } from './compositions/BRollComposition';
export type { 
  BRollCompositionProps, 
  BRollClip, 
  Subtitle, 
  PipConfig 
} from './compositions/BRollComposition';

// ★ 内容可视化合成（新版，内容维度）
export { ContentComposition, ContentCompositionSchema } from './compositions/ContentComposition';
export type { ContentCompositionProps } from './compositions/ContentComposition';

// ★ 内容类型定义
export type {
  ContentSegment,
  ContentAnalysis,
  VisualizationType,
  VisualizationConfig,
  Sentiment,
  BRollAsset,
  ContentAnalysisResponse,
} from './types/content';
export { 
  DEFAULT_VISUALIZATION_CONFIG, 
  getDefaultConfigForType 
} from './types/content';

// 预览组件
export { 
  RemotionPreview,
  convertClipToRemotionFormat,
  convertTrackToRemotionFormat,
} from './components/RemotionPreview';

export { BRollPreview } from './components/BRollPreview';
export type { 
  BRollPreviewProps, 
  BRollPreviewClip, 
  BRollPreviewSubtitle 
} from './components/BRollPreview';

// ★ V2: Remotion 配置预览（基于 LLM 生成的配置）
export { RemotionConfigComposition } from './compositions/RemotionConfigComposition';
export type {
  TextComponent,
  BRollComponent,
  ChapterComponent,
  RemotionConfig,
  RemotionConfigCompositionProps,
} from './compositions/RemotionConfigComposition';

export { RemotionConfigPreview } from './components/RemotionConfigPreview';
export type { RemotionConfigPreviewProps } from './components/RemotionConfigPreview';
