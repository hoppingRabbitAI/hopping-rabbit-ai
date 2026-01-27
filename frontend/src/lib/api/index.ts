/**
 * API 模块统一导出
 * 
 * 模块化 API 客户端，按功能域组织：
 * - types: 类型定义
 * - client: 基础客户端
 * - projects: 项目管理
 * - assets: 资源管理
 * - clips: 片段管理
 * - tasks: AI 任务
 * - export: 导出功能
 * - smart: 智能剪辑
 */

// 类型导出
export * from './types';

// 基础客户端
export { ApiClient, API_BASE_URL, getAuthToken, handleAuthExpired } from './client';

// 媒体代理
export { getAssetStreamUrl, getProxyUrl, needsProxy } from './media-proxy';

// 模块化 API
export { projectApi, ProjectApi } from './projects';
export { assetApi, AssetApi, uploadVideo } from './assets';
export { clipsApi, ClipsApi } from './clips';
export { taskApi, TaskApi, transcribeVideo } from './tasks';
export { exportApi, ExportApi, exportVideo } from './export';
export { smartApi, SmartApi } from './smart';
export { brollApi, BRollApi } from './broll';
