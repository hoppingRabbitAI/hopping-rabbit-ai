/**
 * Canvas 模块 - 视频画布组件
 * 
 * 架构设计：
 * - VideoCanvasStore: 主画布组件，集成 EditorStore 状态管理
 * - 视频缓存: preloadVideoToCache, bufferVideoInBackground 等工具函数
 * 
 * 扩展思路（未来可拆分）：
 * - 核心层 (Core): 视频渲染、RAF 时间同步、Transform 插值
 * - 控制层 (Controls): 播放控制、进度条、缩放
 * - 覆盖层 (Overlays): Transform、字幕、标注
 */

export {
  VideoCanvas,
  preloadVideoToCache,
  isVideoCached,
  bufferVideoInBackground,
  getVideoBufferProgress,
  subscribeBufferProgress
} from './VideoCanvasStore';
