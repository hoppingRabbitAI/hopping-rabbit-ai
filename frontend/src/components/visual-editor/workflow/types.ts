/**
 * AI 视频工作流类型定义
 */

import type { Node, Edge } from '@xyflow/react';

// ==========================================
// 节点类型
// ==========================================

export type NodeType = 'clip' | 'processor' | 'output' | 'prompt';

// Clip 节点数据
export interface ClipNodeData extends Record<string, unknown> {
  clipId: string;
  assetId?: string;        // ★ 素材 ID（空节点可无 assetId）
  index: number;
  /** 媒体类型：video 有播放器、image 只显示静态图 */
  mediaType: 'video' | 'image';
  thumbnail?: string;
  duration: number;        // 秒
  startTime: number;       // 时间轴上的起点（秒）
  endTime: number;         // 时间轴上的终点（秒）
  sourceStart?: number;    // ★ 源视频中的起点（毫秒），用于 HLS 播放定位
  sourceEnd?: number;      // ★ 源视频中的终点（毫秒）
  transcript?: string;
  name?: string;
  isSelected?: boolean;
  aspectRatio?: '16:9' | '9:16' | 'vertical' | 'horizontal';  // 素材比例
  videoUrl?: string;       // ★ 替换后的视频 URL（直接播放）
  /** ★ AI 生成中的任务 ID — 非空表示此节点正在等待 AI 生成结果 */
  generatingTaskId?: string;
  /** ★ AI 生成中的能力标签（用于 loading UI 显示） */
  generatingCapability?: string;
  onOpenGeneration?: (clipId: string, capabilityId?: string) => void;  // ★ 右键直接打开生成弹窗，可指定能力
  onOpenCompositor?: (clipId: string) => void;  // ★ Edit 按钮 → 打开 Compositor 全屏合成编辑器
  onSeparate?: (clipId: string) => void;  // ★ 右键「抠图分层」→ 后台静默分离
  isFreeNode?: boolean;    // ★ 是否为自由节点（画布右键添加的独立素材）
  onDeleteFreeNode?: (nodeId: string) => void;  // ★ 删除自由节点回调
  /** ★ 空节点标记 — 等待上游连线后触发 AI 生成 */
  isEmpty?: boolean;
  /** ★ 空节点有上游连线时的生成回调 */
  onGenerateFromEmpty?: (clipId: string) => void;
  /** ★ 空节点上游连线数量（用于显示"生成"按钮） */
  upstreamCount?: number;
}

// Processor 节点数据（AI 处理）
export interface ProcessorNodeData extends Record<string, unknown> {
  capabilityId: string;    // AI 能力 ID
  name: string;
  icon?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  config?: Record<string, unknown>;
  inputClipId: string;
  outputClipId?: string;
}

// Output 节点数据
export interface OutputNodeData extends Record<string, unknown> {
  clipId: string;
  thumbnail?: string;
  duration: number;
  sourceProcessorId: string;
}

// ==========================================
// 工作流节点
// ==========================================

export type ClipNode = Node<ClipNodeData, 'clip'>;
export type ProcessorNode = Node<ProcessorNodeData, 'processor'>;
export type OutputNode = Node<OutputNodeData, 'output'>;

export type WorkflowNode = ClipNode | ProcessorNode | OutputNode;
export type WorkflowEdge = Edge;

// ==========================================
// AI 能力定义
// ==========================================

export interface AICapability {
  id: string;
  name: string;
  description: string;
  icon: string;            // Lucide icon name
  category: 'visual' | 'audio' | 'text' | 'effect';
  
  // 输入输出
  inputType: 'clip' | 'frame' | 'audio';
  outputType: 'clip' | 'frame' | 'audio';
  
  // 是否需要配置面板
  requiresConfig: boolean;
}

// 预定义的 AI 能力
export const AI_CAPABILITIES: AICapability[] = [
  {
    id: 'background-replace',
    name: '换背景',
    description: '使用 AI 替换视频背景',
    icon: 'ImagePlus',
    category: 'visual',
    inputType: 'clip',
    outputType: 'clip',
    requiresConfig: true,
  },
  {
    id: 'add-broll',
    name: '插入 B-Roll',
    description: '智能插入相关素材',
    icon: 'Film',
    category: 'visual',
    inputType: 'clip',
    outputType: 'clip',
    requiresConfig: true,
  },
  {
    id: 'add-subtitle',
    name: '添加字幕',
    description: '自动生成动态字幕',
    icon: 'Subtitles',
    category: 'text',
    inputType: 'clip',
    outputType: 'clip',
    requiresConfig: true,
  },
  {
    id: 'voice-enhance',
    name: '声音优化',
    description: '降噪、音量均衡',
    icon: 'AudioLines',
    category: 'audio',
    inputType: 'clip',
    outputType: 'clip',
    requiresConfig: false,
  },
];

// ==========================================
// 工作流状态
// ==========================================

export interface WorkflowState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
}
