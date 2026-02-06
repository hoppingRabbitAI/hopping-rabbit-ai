/**
 * Editor Hooks 导出
 */
export { useAIVideoCreate } from './useAIVideoCreate';

// ★★★ 视频播放系统重构 - 分层架构 ★★★
export { useVideoResource } from './useVideoResource';
export type { UseVideoResourceOptions, UseVideoResourceReturn } from './useVideoResource';

export { useClipScheduler } from './useClipScheduler';
export type { UseClipSchedulerOptions, UseClipSchedulerReturn } from './useClipScheduler';

export { usePlaybackController } from './usePlaybackController';
export type { UsePlaybackControllerOptions, UsePlaybackControllerReturn } from './usePlaybackController';

// ★★★ 统一入口 Hook ★★★
export { useVideoPlaybackSystem } from './useVideoPlaybackSystem';
export type { UseVideoPlaybackSystemOptions, UseVideoPlaybackSystemReturn } from './useVideoPlaybackSystem';
