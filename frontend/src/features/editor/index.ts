/**
 * 编辑器模块统一导出
 */

// Store
export { useEditorStore } from './store/editor-store';
export { useProjectStore } from './store/project-store';
export { useAuthStore } from './store/auth-store';

// Components - 显式导出避免与类型冲突
export { 
  Header,
  VideoCanvas,
  ClipListPanel,
  Timeline as TimelineComponent,
  ContextMenu,
  ClipToolbar,
  ASRProgressToast,
  SubtitleEditor,
  SmartPanel,
  Waveform,
} from './components';

// Lib
export * from './lib/time-utils';
export * from './lib/timeline-utils';
// 明确导出 keyframe-interpolation 中的导出，排除与 types/keyframe 的冲突
export { 
  applyEasing, 
  EASING_LABELS, 
  interpolateKeyframes, 
  getValueAtOffset, 
  getClipTransformAtOffset, 
  transformToCSS,
  type ClipTransform,
} from './lib/keyframe-interpolation';
export { mediaCache } from './lib/media-cache';
export { SyncManager } from './lib/sync-manager';
export * from './lib/workspace-api';

// Types
export * from './types';
