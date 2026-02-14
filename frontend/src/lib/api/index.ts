/**
 * API 模块统一导出
 * 
 * 模块化 API 客户端，按功能域组织：
 * - types: 类型定义
 * - client: 基础客户端
 * - projects: 项目管理
 * - assets: 资源管理
 * - tasks: AI 任务
 * - materials: 素材管理
 */

// 类型导出
export * from './types';

// 基础客户端
export { ApiClient, API_BASE_URL, getAuthToken, handleAuthExpired } from './client';

// 媒体代理
export { getAssetStreamUrl } from './media-proxy';

// 核心 API
export { projectApi } from './projects';
export { assetApi, uploadVideo } from './assets';
export { taskApi } from './tasks';
export { materialsApi, MaterialsApi } from './materials';
export { exportApi } from './export';
export type {
  UserMaterial,
  AvatarItem,
  VoiceSampleItem,
} from './materials';

// ---- Lepus AI 核心 API (PRD v1.1) ----
export { intentRouterApi } from './intent-router';
export type { AnalyzeRequest, AnalyzeTextRequest, IntentParseRequest } from './intent-router';
export { capabilityApi } from './capabilities';
export type { CapabilityDefinition, ExecuteChainRequest } from './capabilities';
export { canvasApi } from './canvas';
export type { CanvasSession, OpenCanvasRequest, OpenCanvasResponse } from './canvas';
export { trendTemplateApi } from './trend-templates';
export { digitalAvatarApi } from './digital-avatars';

// ---- Canvas Nodes API (Visual Editor 直连) ----
export {
  listCanvasNodes,
  updateCanvasNode,
  deleteCanvasNode,
  batchCreateCanvasNodes,
  reorderCanvasNodes,
  syncCanvasEdges,
} from './canvas-nodes';
export type {
  CanvasNodeRow,
  CanvasEdgeRow,
  ListCanvasNodesResponse,
  BatchCreateNodeItem,
} from './canvas-nodes';

// ---- Prompt Library API ----
export { promptLibraryApi } from './prompt-library';
