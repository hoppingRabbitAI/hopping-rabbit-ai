/**
 * Remotion Agent 视觉组件导出
 * 
 * 提供所有知识类视频视觉编排组件
 */

// 画布组件 (Canvas)
export { PointListCanvas, ProcessFlowCanvas, ComparisonCanvas, ConceptCard } from './canvas';

// 叠加组件 (Overlays)
export {
  KeywordCard,
  DataNumber,
  HighlightBox,
  QuestionHook,
  ChapterTitle,
  ProgressIndicator,
  QuoteBlock,
} from './overlays';

// 🆕 画中画组件 (PiP) - Week 3
export { PersonPip, BrollPip, DynamicLayout } from './pip';

// 背景组件 (Backgrounds)
export { PaperBackground, GradientBackground } from './backgrounds';

// 渲染器
export { VisualRenderer } from './VisualRenderer';
