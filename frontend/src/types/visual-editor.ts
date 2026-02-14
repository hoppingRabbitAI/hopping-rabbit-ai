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

/** 分镜媒体类型 */
export type ShotMediaType = 'video' | 'image';

export interface Shot {
  id: string;
  index: number;
  /** 媒体类型：video 有播放/时长，image 只有静态画面 */
  mediaType: ShotMediaType;
  startTime: number;       // 时间轴位置（秒）
  endTime: number;         // 时间轴位置（秒）
  sourceStart?: number;    // ★ 源视频位置（毫秒），用于 HLS 播放定位
  sourceEnd?: number;      // ★ 源视频位置（毫秒）
  assetId?: string;        // ★ 素材 ID，用于获取视频播放 URL
  /** ★ 关联的 clips 表 ID（canvas_nodes.clip_id），split/extractFrames 等需要 */
  clipId?: string;
  videoUrl?: string;       // ★ 视频 URL（替换后或从 clips 表加载）
  replacedVideoUrl?: string;  // ★ 替换后的视频 URL（AI 生成的新视频）
  transcript?: string;     // ★ 文字稿
  thumbnail?: string;
  thumbnailUrl?: string;
  foregroundMaskUrl?: string;  // 人物前景蒙版
  aspectRatio?: '16:9' | '9:16' | 'vertical' | 'horizontal';  // ★ 素材比例
  canvasPosition?: { x: number; y: number };  // ★ 画布上的位置（持久化，刷新后恢复）
  /** ★ AI 生成中的任务 ID — 非空表示此节点正在等待 AI 生成结果 */
  generatingTaskId?: string;
  /** ★ AI 生成中的能力标签（用于 loading UI 显示） */
  generatingCapability?: string;
  background: ShotBackground;
  layers: Layer[];
  // 画板状态 - 每个分镜独立维护
  artboard: Artboard;
  // 画布视口状态 - 每个分镜独立维护
  viewportTransform?: number[];  // Fabric.js viewport transform [a, b, c, d, e, f]
}

// ==========================================
// 自由节点 & 画布连线（工作流画布上的独立素材）
// ==========================================

/** 自由节点：画布上独立于线性序列的素材 */
export interface FreeNode {
  id: string;
  mediaType: ShotMediaType;
  thumbnail?: string;
  videoUrl?: string;
  assetId?: string;
  duration: number;          // 秒
  aspectRatio?: '16:9' | '9:16' | 'vertical' | 'horizontal';
  position: { x: number; y: number };
  /** ★ AI 生成中的任务 ID — 非空表示此节点正在等待 AI 生成结果 */
  generatingTaskId?: string;
  /** ★ AI 生成中的能力标签（用于 loading UI 显示） */
  generatingCapability?: string;
  /** ★ 空节点标记 — 用户创建的占位节点，等待连线输入后触发 AI 生成 */
  isEmpty?: boolean;
}

/** 画布上的 Prompt 节点（可复用的提示词模板，持久化到 canvas_nodes） */
export interface CanvasPromptNode {
  id: string;              // UUID 格式
  variant: 'prompt' | 'negative';
  text: string;
  position: { x: number; y: number };
}

/** 画布上用户手动创建的连线（自由节点之间，或自由节点与序列节点之间） */
export interface CanvasEdge {
  id: string;
  source: string;         // 源节点 ID
  target: string;         // 目标节点 ID
  sourceHandle?: string;  // 源 Handle ID（PromptNode 等特殊节点需要）
  targetHandle?: string;  // 目标 Handle ID（PromptNode 等特殊节点需要）
  /** ★ 关联关系类型（可选，无则为普通连线） */
  relationType?: NodeRelationType;
  /** ★ 关联关系说明标签 */
  relationLabel?: string;
}

// ==========================================
// 节点关联关系（溯源 / Lineage）
// ==========================================

/** 节点关联关系类型 */
export type NodeRelationType =
  | 'split'            // 视频拆分：A 拆出 B
  | 'ai-generated'     // AI 生成：A 通过 AI 生成 B
  | 'bg-replace'       // 背景替换：A 换背景生成 B
  | 'extract-frame'    // 提取帧：从视频 A 中提取关键帧 B
  | 'separation'       // 抠图分层：A 分离前景/背景得到 B
  | 'reference'        // 参考引用：B 参考了 A 的内容
  | 'composite'        // 合成：A + B → C（多输入合成）
  | 'duplicate'        // 复制：A 复制为 B
  | 'transition'       // 转场生成：A 和 C 之间生成转场 B
  | 'style-transfer'   // 风格迁移：A 风格应用到 B
  | 'custom';          // 自定义关联

/** 关联关系的视觉配置 */
export interface RelationTypeConfig {
  type: NodeRelationType;
  label: string;
  color: string;
  icon: string;          // Lucide icon name
  dashArray?: string;    // SVG stroke-dasharray
  description: string;
}

/** 预定义的关联关系视觉配置 */
export const RELATION_TYPE_CONFIGS: Record<NodeRelationType, RelationTypeConfig> = {
  'split':           { type: 'split',          label: '拆分',     color: '#3b82f6', icon: 'Scissors',     description: '从源视频拆分而来' },
  'ai-generated':    { type: 'ai-generated',   label: 'AI 生成',  color: '#8b5cf6', icon: 'Sparkles',     description: '通过 AI 能力生成' },
  'bg-replace':      { type: 'bg-replace',     label: '换背景',   color: '#06b6d4', icon: 'ImagePlus',    description: '更换背景后生成' },
  'extract-frame':   { type: 'extract-frame',  label: '提取帧',   color: '#f59e0b', icon: 'Frame',        description: '从视频中提取关键帧' },
  'separation':      { type: 'separation',     label: '抠图',     color: '#10b981', icon: 'Layers',       description: '前景/背景分离生成' },
  'reference':       { type: 'reference',      label: '参考',     color: '#6b7280', icon: 'Link',         dashArray: '6 3', description: '引用参考关系' },
  'composite':       { type: 'composite',      label: '合成',     color: '#ec4899', icon: 'Combine',      description: '多素材合成生成' },
  'duplicate':       { type: 'duplicate',       label: '复制',     color: '#78716c', icon: 'Copy',         dashArray: '4 2', description: '从源节点复制' },
  'transition':      { type: 'transition',     label: '转场',     color: '#a855f7', icon: 'ArrowRightLeft', description: '转场效果生成' },
  'style-transfer':  { type: 'style-transfer', label: '风格迁移', color: '#f43f5e', icon: 'Palette',      description: '风格迁移生成' },
  'custom':          { type: 'custom',         label: '关联',     color: '#64748b', icon: 'Link2',        dashArray: '8 4', description: '自定义关联关系' },
};

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
  | 'insert-shot'
  | 'delete-shot'
  | 'replace-video'
  | 'reorder-layers'
  | 'add-to-timeline'
  | 'remove-from-timeline'
  | 'reorder-timeline'
  | 'replace-timeline-segment'
  | 'clear-timeline'
  | 'split-segment'
  | 'duplicate-segment'
  | 'trim-segment'
  | 'add-free-node'
  | 'remove-free-node'
  | 'add-canvas-edge'
  | 'remove-canvas-edge'
  | 'add-prompt-node'
  | 'remove-prompt-node'
  | 'batch'
  | 'initial';

/** 可撤销状态的快照（仅包含数据部分，不含 UI 状态） */
export interface UndoableSnapshot {
  shots: Shot[];
  timeline: ProjectTimeline;
  freeNodes: FreeNode[];
  canvasEdges: CanvasEdge[];
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  action: HistoryActionType;
  description: string;
  /** 此操作执行后的状态快照 */
  snapshot: UndoableSnapshot;
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
  
  // ★ 侧边栏状态 - 统一管理，同时只显示一个
  activeSidebar: 'taskHistory' | 'aiCapability' | 'materialPicker' | null;
  selectedClipIdForAI: string | null;  // 当前选中要应用 AI 能力的 clip
  
  // ★ 主线 Timeline
  timeline: ProjectTimeline;
  
  // ★ 自由节点 & 画布连线
  freeNodes: FreeNode[];
  canvasEdges: CanvasEdge[];

  // ★ Prompt 节点（可复用的提示词模板）
  promptNodes: CanvasPromptNode[];

  // ★ 锁定节点（不可拖拽）
  lockedNodeIds: string[];
}

// ==========================================
// 主线 Timeline（画布节点 → 成片编排）
// ==========================================

/** Timeline 段的媒体类型 */
export type SegmentMediaType = 'video' | 'image' | 'transition' | 'ai-generated';

/** Timeline 面板折叠状态 */
export type TimelinePanelState = 'expanded' | 'half' | 'collapsed';

/**
 * 主线 Timeline 段
 * 每段由画布上的一个节点“加入主线”产生
 */
export interface TimelineSegment {
  id: string;
  /** 来源节点 ID（画布中的 shot/clip） */
  sourceNodeId: string;
  /** 段在主线中的排列顺序（0-based） */
  order: number;
  /** 媒体类型 */
  mediaType: SegmentMediaType;
  /** 段时长（毫秒） */
  durationMs: number;
  /** 缩略图 */
  thumbnail?: string;
  /** 标签/名称 */
  label?: string;
  /** 对应的视频/图片 URL */
  mediaUrl?: string;
  /** 来源节点的文字稿 */
  transcript?: string;
}

/**
 * 项目主线 Timeline
 * 每个项目只有一条主线，所有导出基于此
 */
export interface ProjectTimeline {
  /** 是否为主线（永远 true，预留多线扩展） */
  isPrimary: true;
  /** 面板折叠状态 */
  panelState: TimelinePanelState;
  /** 段列表（有序） */
  segments: TimelineSegment[];
  /** 总时长（毫秒，自动计算） */
  totalDurationMs: number;
}

export const DEFAULT_PROJECT_TIMELINE: ProjectTimeline = {
  isPrimary: true,
  panelState: 'collapsed',
  segments: [],
  totalDurationMs: 0,
};

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
  activeSidebar: null,
  selectedClipIdForAI: null,
  timeline: DEFAULT_PROJECT_TIMELINE,
  freeNodes: [],
  canvasEdges: [],
  promptNodes: [],
  lockedNodeIds: [],
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
