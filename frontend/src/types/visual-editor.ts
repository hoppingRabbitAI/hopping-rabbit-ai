'use client';

/**
 * 视觉编辑器 - 类型定义
 */

// ==========================================
// 工具类型
// ==========================================

export type ToolType = 
  | 'select'      // 选择/移动
  | 'pencil'      // 画笔
  | 'eraser'      // 橡皮擦
  | 'rect'        // 矩形
  | 'circle'      // 圆形
  | 'line'        // 线条
  | 'text'        // 文字
  | 'image'       // 图片
  | 'pan';        // 平移画布

// ==========================================
// 图层类型
// ==========================================

export type LayerType = 'background' | 'foreground' | 'decoration' | 'text' | 'shape';

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  objects: CanvasObject[];
}

// ==========================================
// 画布对象
// ==========================================

export interface CanvasObjectBase {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  locked: boolean;
}

export interface ImageObject extends CanvasObjectBase {
  type: 'image';
  src: string;
}

export interface RectObject extends CanvasObjectBase {
  type: 'rect';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius?: number;
}

export interface CircleObject extends CanvasObjectBase {
  type: 'circle';
  radius: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface TextObject extends CanvasObjectBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
  fontWeight?: string;
  fontStyle?: string;
}

export interface PathObject extends CanvasObjectBase {
  type: 'path';
  path: string;  // SVG path data
  stroke: string;
  strokeWidth: number;
  fill?: string;
}

export type CanvasObject = ImageObject | RectObject | CircleObject | TextObject | PathObject;

// ==========================================
// 画板 (Artboard) - 每个分镜的工作区域
// ==========================================

export interface Artboard {
  x: number;              // 画板在无限画布中的 X 位置
  y: number;              // 画板在无限画布中的 Y 位置
  width: number;          // 画板宽度 (默认 1920)
  height: number;         // 画板高度 (默认 1080)
}

export const DEFAULT_ARTBOARD: Artboard = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
};

// ==========================================
// 分镜
// ==========================================

export type BackgroundType = 'original' | 'color' | 'image' | 'prompt' | 'template';

export interface ShotBackground {
  type: BackgroundType;
  color?: string;
  imageUrl?: string;
  prompt?: string;
  generatedImageUrl?: string;
  templateId?: string;
  canvasDataUrl?: string;
}

export interface Shot {
  id: string;
  index: number;
  startTime: number;       // 时间轴位置（秒）
  endTime: number;         // 时间轴位置（秒）
  sourceStart?: number;    // ★ 源视频位置（毫秒），用于 HLS 播放定位
  sourceEnd?: number;      // ★ 源视频位置（毫秒）
  assetId?: string;        // ★ 素材 ID，用于获取视频播放 URL
  transcript?: string;     // ★ 文字稿
  thumbnail?: string;
  thumbnailUrl?: string;
  foregroundMaskUrl?: string;  // 人物前景蒙版
  background: ShotBackground;
  layers: Layer[];
  // 画板状态 - 每个分镜独立维护
  artboard: Artboard;
  // 画布视口状态 - 每个分镜独立维护
  viewportTransform?: number[];  // Fabric.js viewport transform [a, b, c, d, e, f]
}

// ==========================================
// 历史记录
// ==========================================

export type HistoryActionType = 
  | 'add-object'
  | 'remove-object'
  | 'modify-object'
  | 'add-layer'
  | 'remove-layer'
  | 'modify-layer'
  | 'change-background'
  | 'batch';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  action: HistoryActionType;
  description: string;
  shotId: string;
  before: unknown;
  after: unknown;
}

// ==========================================
// 编辑器状态
// ==========================================

export interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  selectedObjectIds: string[];
}

export interface ToolState {
  activeTool: ToolType;
  brushColor: string;
  brushSize: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  fontSize: number;
  fontFamily: string;
}

export interface VisualEditorState {
  // 项目信息
  projectId: string | null;
  sessionId: string | null;
  projectName: string;
  
  // 加载状态
  isLoading: boolean;
  isAnalyzing: boolean;
  isSaving: boolean;
  error: string | null;
  
  // 分镜数据
  shots: Shot[];
  currentShotId: string | null;
  
  // 画布状态
  canvas: CanvasState;
  
  // 工具状态
  tool: ToolState;
  
  // 历史记录
  history: HistoryEntry[];
  historyIndex: number;
  
  // UI 状态
  leftPanelTab: 'layers' | 'history';
  rightPanelTab: 'background' | 'properties';
  isPlaying: boolean;
}

// ==========================================
// 默认值
// ==========================================

export const DEFAULT_TOOL_STATE: ToolState = {
  activeTool: 'select',
  brushColor: '#000000',
  brushSize: 4,
  fillColor: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 2,
  fontSize: 24,
  fontFamily: 'Inter',
};

export const DEFAULT_CANVAS_STATE: CanvasState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  selectedObjectIds: [],
};

export const DEFAULT_VISUAL_EDITOR_STATE: VisualEditorState = {
  projectId: null,
  sessionId: null,
  projectName: '未命名项目',
  isLoading: true,
  isAnalyzing: false,
  isSaving: false,
  error: null,
  shots: [],
  currentShotId: null,
  canvas: DEFAULT_CANVAS_STATE,
  tool: DEFAULT_TOOL_STATE,
  history: [],
  historyIndex: -1,
  leftPanelTab: 'layers',
  rightPanelTab: 'background',
  isPlaying: false,
};

// ==========================================
// 模板
// ==========================================

export interface BackgroundTemplate {
  id: string;
  name: string;
  category: string;
  thumbnailUrl: string;
  imageUrl: string;
}

export const TEMPLATE_CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'office', name: '办公' },
  { id: 'nature', name: '自然' },
  { id: 'tech', name: '科技' },
  { id: 'life', name: '生活' },
  { id: 'solid', name: '纯色' },
];

export const QUICK_PROMPTS = [
  '简约科技感办公室',
  '温馨书房',
  '城市天际线',
  '自然风光',
  '渐变蓝色',
  '极简白色',
];
