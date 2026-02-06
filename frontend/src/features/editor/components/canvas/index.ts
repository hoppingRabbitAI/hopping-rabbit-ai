/**
 * Canvas 模块 - 视频画布组件
 */

// ★ 旧版组件（保留兼容）
export {
  VideoCanvas,
  clearHlsCache,
  preheatVideo,
  getPreheatedVideo,
} from './VideoCanvasStore';

// ★★★ V2 组件（hooks 架构，有生命周期问题）★★★
export { VideoCanvasV2 } from './VideoCanvasV2';

// ★★★ V3 组件（全局单例架构，推荐使用）★★★
export { VideoCanvasV3 } from './VideoCanvasV3';
