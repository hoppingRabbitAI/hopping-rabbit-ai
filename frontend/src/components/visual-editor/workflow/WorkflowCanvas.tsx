/**
 * 工作流画布
 * 使用 React Flow 展示视频分镜工作流
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  Panel,
  ConnectionMode,
} from '@xyflow/react';
import type { Node, Edge, EdgeChange, NodeChange, NodeMouseHandler, ReactFlowInstance, Connection, OnSelectionChangeFunc } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ClipNode } from './ClipNode';
import { FileUploadNode, type UploadResult } from './FileUploadNode';
import { PromptNode, type PromptNodeData, type PromptVariant } from './PromptNode';
import { AddButtonEdge, type AddButtonEdgeData } from './AddButtonEdge';
import { MaterialPickerModal, type SelectedMaterial, type PlacementStrategy } from './MaterialPickerModal';
import { materialsApi } from '@/lib/api';
import { extractFramesFromClip } from '@/lib/api/shot-segmentation';
import { startSeparation, pollSeparationUntilDone } from '@/lib/api/separation';
// AICapabilityPanel 已移除，能力直接在右键菜单中触发
import { KeyframeEditor } from './KeyframeEditor';
import { TemplateCandidateModal } from './TemplateCandidateModal';
import { GenerationComposerModal, type GenerationInputPair, type GenerationCapabilityId } from './GenerationComposerModal';
import { CompositorModal } from './CompositorModal';
import { NodeSelectionToolbar } from './NodeSelectionToolbar';
// TaskProgressPanel 已废弃，使用 TaskHistorySidebar 替代
import { BackgroundReplaceProgress } from './BackgroundReplaceProgress';
import { useTaskProgress } from './useTaskProgress';
import { useBackgroundReplaceWorkflow } from './useBackgroundReplaceWorkflow';
import { useNodeAlignment } from './useNodeAlignment';

import { AlignmentGuides } from './AlignmentGuides';
import type { ClipNodeData, AICapability } from './types';
import { AI_CAPABILITIES } from './types';
import type { GenerateParams, GenerateResult, ConfirmParams } from './KeyframeEditor';
import { getSessionSafe } from '@/lib/supabase/session';
import { useTaskHistoryStore } from '@/stores/taskHistoryStore';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import { DEFAULT_ARTBOARD } from '@/types/visual-editor';
import type { FreeNode } from '@/types/visual-editor';
import { toast } from '@/lib/stores/toast-store';
import { Plus, ImagePlus, Upload, FolderOpen, MousePointer2, Hand, Undo2, Redo2, ChevronDown, Sparkles, ShieldOff, Trash2, Lock, LockOpen, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, X } from 'lucide-react';
import { useMenuCoordination } from './useMenuCoordination';
import { useCycleDetection } from './useCycleDetection';
import { useCycleAutoLayout } from './useCycleAutoLayout';
import { CycleCenterButton } from './CycleCenterButton';
import { RelationEdge, type RelationEdgeData } from './RelationEdge';
import { RelationTypePicker } from './RelationTypePicker';
import { SimpleEdge } from './SimpleEdge';
import { useNodeRelations } from './useNodeRelations';
import type { NodeRelationType } from '@/types/visual-editor';

// 注册自定义节点类型
const nodeTypes = {
  clip: ClipNode,
  fileUpload: FileUploadNode,
  prompt: PromptNode,
};

// ★ 注册自定义边类型
const edgeTypes = {
  addButton: AddButtonEdge,
  relation: RelationEdge,
  simple: SimpleEdge,
};

// Shot 数据类型（从 VisualEditor 传入）
interface Shot {
  id: string;
  index: number;
  mediaType?: 'video' | 'image';  // ★ 媒体类型
  startTime: number;
  endTime: number;
  sourceStart?: number;    // ★ 源视频位置（毫秒），用于 HLS 播放定位
  sourceEnd?: number;      // ★ 源视频位置（毫秒）
  thumbnail?: string;
  transcript?: string;
  assetId?: string; // ★ 素材 ID，用于播放
  videoUrl?: string;       // ★ 替换后的视频 URL
  replacedVideoUrl?: string;  // ★ 已替换的视频 URL（兼容）
  canvasPosition?: { x: number; y: number };  // ★ 画布位置（持久化，刷新后恢复）
  generatingTaskId?: string;       // ★ AI 生成中的任务 ID
  generatingCapability?: string;   // ★ AI 生成中的能力标签
  background?: {
    templateId?: string;
  };
}

interface WorkflowCanvasProps {
  shots: Shot[];
  projectId?: string;  // ★ 项目 ID
  aspectRatio?: '16:9' | '9:16' | 'vertical' | 'horizontal';  // 视频比例
  onShotSelect?: (shot: Shot | null) => void;
}

interface InsertActionMenuState {
  x: number;
  y: number;
  sourceId: string;
  targetId: string;
}

type CanvasInteractionMode = 'select' | 'pan';

const ZOOM_PRESETS = [25, 42, 50, 67, 75, 100, 125, 150, 200];

function createAssetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function WorkflowCanvas({ shots, projectId, aspectRatio = '16:9', onShotSelect }: WorkflowCanvasProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  
  // ★ 节点关联关系系统
  const {
    addRelation,
    getUpstreamChain,
  } = useNodeRelations();
  // ★ 关联类型选择器状态（连线后弹出）
  const [relationPicker, setRelationPicker] = useState<{
    position: { x: number; y: number };
    sourceId: string;
    targetId: string;
    sourceHandle?: string;
    targetHandle?: string;
  } | null>(null);
  
  const [showKeyframeEditor, setShowKeyframeEditor] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedCapability, setSelectedCapability] = useState<AICapability | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);  // ★ 当前进行中的任务 ID
  
  // ★ 自由节点 & 画布连线：从 Zustand store 获取（实时持久化）
  const freeNodes = useVisualEditorStore(state => state.freeNodes);
  const canvasEdges = useVisualEditorStore(state => state.canvasEdges);
  const addFreeNodes = useVisualEditorStore(state => state.addFreeNodes);
  const removeFreeNode = useVisualEditorStore(state => state.removeFreeNode);
  const updateFreeNodePosition = useVisualEditorStore(state => state.updateFreeNodePosition);
  const updateFreeNode = useVisualEditorStore(state => state.updateFreeNode);
  const persistNodePosition = useVisualEditorStore(state => state.persistNodePosition);
  const addCanvasEdge = useVisualEditorStore(state => state.addCanvasEdge);
  const removeCanvasEdge = useVisualEditorStore(state => state.removeCanvasEdge);
  
  // ★ Prompt 节点：从 Zustand store 获取（持久化）
  const promptNodes = useVisualEditorStore(state => state.promptNodes);
  const addPromptNode = useVisualEditorStore(state => state.addPromptNode);
  const removePromptNodeFromStore = useVisualEditorStore(state => state.removePromptNode);
  const updatePromptNode = useVisualEditorStore(state => state.updatePromptNode);
  
  // ★ 画布右键菜单
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
  // ★ 节点左右 + 号菜单（先选动作，再决定是素材库还是本地上传）
  const [insertActionMenu, setInsertActionMenu] = useState<InsertActionMenuState | null>(null);
  const quickInsertInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingQuickInsert, setPendingQuickInsert] = useState<{ sourceId: string; targetId: string } | null>(null);
  
  // ★ ReactFlow 实例引用（用于坐标转换）
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  // ★ FileUploadNode 临时节点（上传完成后转化为 FreeNode/ClipNode）
  const [uploadNodes, setUploadNodes] = useState<Array<{ id: string; position: { x: number; y: number } }>>([]);
  // ★ Refs for upload handlers（避免 useEffect 中引用 stale closure）
  const handleUploadCompleteRef = useRef<(nodeId: string, result: UploadResult) => void>(() => {});
  const handleRemoveUploadNodeRef = useRef<(nodeId: string) => void>(() => {});

  // ★ Refs for prompt handlers
  const handlePromptTextChangeRef = useRef<(nodeId: string, text: string) => void>(() => {});
  const handleRemovePromptNodeRef = useRef<(nodeId: string) => void>(() => {});

  // ★ 素材选择弹窗状态
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [insertPosition, setInsertPosition] = useState<{ sourceId: string; targetId: string } | null>(null);
  // ★ 是否为自由添加模式（画布右键添加，非插入到序列中）
  const [isFreeAddMode, setIsFreeAddMode] = useState(false);
  const [transitionPair, setTransitionPair] = useState<{ fromClipId: string; toClipId: string; fromThumbnail?: string; toThumbnail?: string } | null>(null);
  const [showGenerationComposer, setShowGenerationComposer] = useState(false);
  const [generationTemplateId, setGenerationTemplateId] = useState<string | undefined>(undefined);
  const [generationPair, setGenerationPair] = useState<GenerationInputPair | null>(null);
  const [generationInitCapability, setGenerationInitCapability] = useState<string | undefined>(undefined);
  // ★ 连线的 Prompt 目标节点 ID（用于 reactive 计算 connectedPrompt）
  const [generationTargetClipId, setGenerationTargetClipId] = useState<string | null>(null);
  // ★ Reactive: 连线 Prompt 实时跟随 PromptNode 编辑更新
  const generationConnectedPrompt = useMemo(() => {
    if (!generationTargetClipId || !showGenerationComposer) return undefined;
    const result: { prompt?: string; negativePrompt?: string } = {};
    for (const edge of canvasEdges) {
      if (edge.target !== generationTargetClipId) continue;
      const pn = promptNodes.find(p => p.id === edge.source);
      if (!pn || !pn.text.trim()) continue;
      if (pn.variant === 'prompt') result.prompt = pn.text.trim();
      else if (pn.variant === 'negative') result.negativePrompt = pn.text.trim();
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }, [generationTargetClipId, showGenerationComposer, canvasEdges, promptNodes]);

  // ★ Compositor 全屏合成编辑器状态
  const [showCompositor, setShowCompositor] = useState(false);
  const [compositorClipId, setCompositorClipId] = useState<string | null>(null);

  // ★ 媒体预览弹窗
  const [previewMedia, setPreviewMedia] = useState<{ url: string; mediaType: string } | null>(null);

  // ★ 侧边栏统一管理
  const activeSidebar = useVisualEditorStore(state => state.activeSidebar);
  const selectedClipIdForAI = useVisualEditorStore(state => state.selectedClipIdForAI);
  const closeSidebar = useVisualEditorStore(state => state.closeSidebar);
  const insertShotsAfter = useVisualEditorStore(state => state.insertShotsAfter);
  const replaceShotVideo = useVisualEditorStore(state => state.replaceShotVideo);  // ★★★ 治本：用于更新 shot 视频 ★★★
  const updateShot = useVisualEditorStore(state => state.updateShot);
  const deleteShot = useVisualEditorStore(state => state.deleteShot);
  const showCapabilityPanel = activeSidebar === 'aiCapability';

  // ★ 任务历史侧边栏（包含乐观更新）
  const { fetch: fetchTasks, addOptimisticTask, updateTask } = useTaskHistoryStore();
  const openSidebar = useVisualEditorStore(state => state.openSidebar);

  // ★ 画布交互工具栏状态
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>('select');
  const [viewportZoom, setViewportZoom] = useState(1);
  const setCanvasZoom = useVisualEditorStore(state => state.setZoom);
  const setCanvasPan = useVisualEditorStore(state => state.setPan);
  const undo = useVisualEditorStore(state => state.undo);
  const redo = useVisualEditorStore(state => state.redo);
  const canUndo = useVisualEditorStore(state => state.historyIndex > 0);
  const canRedo = useVisualEditorStore(state => state.historyIndex < state.history.length - 1);
  const timelinePanelState = useVisualEditorStore(state => state.timeline.panelState);
  const batchDeleteNodes = useVisualEditorStore(state => state.batchDeleteNodes);
  const toggleNodeLock = useVisualEditorStore(state => state.toggleNodeLock);

  // ★ 多选状态追踪
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [showAlignMenu, setShowAlignMenu] = useState(false);

  // ★ 背景替换工作流状态
  const backgroundWorkflow = useBackgroundReplaceWorkflow();

  // SSE 任务进度 (仅保留 addTask 用于添加任务追踪)
  const { addTask } = useTaskProgress({
    subscriberId: projectId || '',
    onTaskComplete: async (taskId: string, resultUrl?: string) => {
      console.log('[WorkflowCanvas] 任务完成:', taskId, resultUrl);

      // ★ 任务完成时刷新任务列表（使用 projectId）
      if (projectId) fetchTasks(projectId);

      // ★ 自动更新画布上的占位节点 — 将 AI 生成结果渲染到节点上
      const latestFreeNodes = useVisualEditorStore.getState().freeNodes;
      const placeholderFreeNode = latestFreeNodes.find(n => n.generatingTaskId === taskId);
      if (placeholderFreeNode && resultUrl) {
        console.log('[WorkflowCanvas] ✅ AI 任务完成，更新占位节点:', placeholderFreeNode.id, resultUrl);
        // ★ 根据 URL 类型决定：图片设 thumbnail（不设 videoUrl），视频设 videoUrl（不设 thumbnail）
        const isVideoUrl = /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(resultUrl);
        updateFreeNode(placeholderFreeNode.id, {
          videoUrl: isVideoUrl ? resultUrl : undefined,
          thumbnail: isVideoUrl ? undefined : resultUrl,
          mediaType: isVideoUrl ? 'video' : 'image',
          generatingTaskId: undefined,
          generatingCapability: undefined,
        });

        // ★★★ 将占位 asset 标记为 ready，写入真实 URL ★★★
        if (placeholderFreeNode.assetId) {
          try {
            const { assetApi } = await import('@/lib/api/assets');
            await assetApi.finalizePlaceholderAsset(placeholderFreeNode.assetId, {
              result_url: resultUrl,
            });
            console.log('[WorkflowCanvas] ✅ 占位 asset 已更新为 ready');
          } catch (err) {
            console.warn('[WorkflowCanvas] ⚠️ 更新占位 asset 失败:', err);
          }
        }
      } else if (placeholderFreeNode && !resultUrl) {
        // 任务完成但没有 resultUrl，清除生成状态
        updateFreeNode(placeholderFreeNode.id, {
          generatingTaskId: undefined,
          generatingCapability: undefined,
        });
      }
    },
    onTaskFailed: (taskId: string, error: string) => {
      console.error('[WorkflowCanvas] 任务失败:', taskId, error);

      // ★ 任务失败时，更新占位节点的生成状态并显示失败
      const latestFreeNodes = useVisualEditorStore.getState().freeNodes;
      const placeholderFreeNode = latestFreeNodes.find(n => n.generatingTaskId === taskId);
      if (placeholderFreeNode) {
        console.log('[WorkflowCanvas] ❌ AI 任务失败，清除占位节点生成状态:', placeholderFreeNode.id);
        updateFreeNode(placeholderFreeNode.id, {
          generatingTaskId: undefined,
          generatingCapability: undefined,
        });
      }

      // ★ 任务失败时也刷新任务列表（使用 projectId）
      if (projectId) fetchTasks(projectId);
    },
  });

  // ★ 轮询补偿：定期检查正在生成的节点，SSE 可能丢失 completed 事件（回调模式）
  React.useEffect(() => {
    const generatingNodes = freeNodes.filter(n => n.generatingTaskId);
    if (generatingNodes.length === 0 || !projectId) return;
    
    const pollInterval = setInterval(async () => {
      try {
        const { authFetch } = await import('@/lib/supabase/session');
        for (const node of generatingNodes) {
          const taskId = node.generatingTaskId!;
          const resp = await authFetch(`/api/ai-capabilities/tasks/${taskId}/status`);
          if (!resp.ok) continue;
          const data = await resp.json();
          if (data.status === 'completed' && data.output_url) {
            console.log('[WorkflowCanvas] 轮询发现任务完成:', taskId, data.output_url);
            // ★ 图片→只设 thumbnail，视频→只设 videoUrl（避免图片被当视频探测）
            const isVideoResult = /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(data.output_url);
            updateFreeNode(node.id, {
              videoUrl: isVideoResult ? data.output_url : undefined,
              thumbnail: isVideoResult ? undefined : data.output_url,
              mediaType: isVideoResult ? 'video' : 'image',
              generatingTaskId: undefined,
              generatingCapability: undefined,
            });

            // ★★★ 将占位 asset 标记为 ready ★★★
            if (node.assetId) {
              try {
                const { assetApi } = await import('@/lib/api/assets');
                await assetApi.finalizePlaceholderAsset(node.assetId, {
                  result_url: data.output_url,
                  output_asset_id: data.output_asset_id || undefined,
                });
              } catch (err) {
                console.warn('[WorkflowCanvas] ⚠️ 轮询：更新占位 asset 失败:', err);
              }
            }

            fetchTasks(projectId);
          } else if (data.status === 'failed') {
            console.log('[WorkflowCanvas] 轮询发现任务失败:', taskId);
            updateFreeNode(node.id, {
              generatingTaskId: undefined,
              generatingCapability: undefined,
            });
            fetchTasks(projectId);
          }
        }
      } catch (err) {
        // 静默忽略轮询错误
      }
    }, 10000); // 每 10 秒轮询一次
    
    return () => clearInterval(pollInterval);
  }, [freeNodes, projectId, updateFreeNode, fetchTasks]);

  // ★ 辅助函数：根据 aspectRatio 计算节点宽度
  const getNodeWidth = (shotAspectRatio?: string) => {
    const isVert = shotAspectRatio === 'vertical' || shotAspectRatio === '9:16';
    return isVert ? 160 : 320;
  };

  // ★ 节点对齐与整理 Hook
  const getNodeWidthById = useCallback((nodeId: string) => {
    const shot = shots.find(s => s.id === nodeId);
    return getNodeWidth((shot as any)?.aspectRatio || aspectRatio);
  }, [shots, aspectRatio]);
  const {
    guideLines,
    mergePositions,
    onNodeDrag,
    onNodeDragStop: onAlignmentDragStop,
    clearAllUserPositions,
    saveUserPosition,
  } = useNodeAlignment(getNodeWidthById);

  // ★ 包装 onNodeDragStop：所有节点保存到 alignment + 持久化到后端
  // 根据 node.type 区分节点类型，避免用 ID 前缀判断
  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    onAlignmentDragStop(_event, node);
    const isFree = freeNodes.some(fn => fn.id === node.id);
    if (isFree) {
      // 自由节点：更新 store 状态 + 防抖持久化
      updateFreeNodePosition(node.id, node.position);
    } else if (node.type === 'prompt') {
      // ★ PromptNode：更新 store 位置 + 持久化
      updatePromptNode(node.id, { position: node.position });
    } else if (node.type === 'fileUpload') {
      // ★ FileUploadNode：同样非 UUID，跳过后端持久化
      // upload 节点位置由 uploadNodes state 管理
    } else {
      // 序列节点（clipNode）：防抖持久化画布位置
      persistNodePosition(node.id, node.position);
    }
  }, [onAlignmentDragStop, freeNodes, updateFreeNodePosition, persistNodePosition, updatePromptNode]);

  // ★ 抠图分层：后台静默执行，完成后自动插入子节点
  const handleSeparate = useCallback(async (clipId: string) => {
    const store = useVisualEditorStore.getState();
    const parentShot = store.shots.find(s => s.id === clipId);
    const parentFreeNode = !parentShot ? store.freeNodes.find(n => n.id === clipId) : null;
    const imageUrl = parentShot?.thumbnail || parentFreeNode?.thumbnail;

    if (!imageUrl) {
      toast.error('没有可用的图片，无法抠图');
      return;
    }

    // 持久 toast：任务完成前一直显示，不阻塞画布任何操作
    const progressToast = toast.persistent('🔄 智能分层中：AI 正在分析图像内容…');

    try {
      // 1. 提交分离任务（传 project_id 使任务在任务历史中可见）
      const { task_id } = await startSeparation({
        image_url: imageUrl,
        separation_type: 'person_background',
        clip_id: clipId,
        project_id: projectId,
      });

      // 2. 轮询等待完成
      const result = await pollSeparationUntilDone(task_id);

      // 关闭进度 toast
      progressToast.dismiss();

      if (result.status === 'failed') {
        toast.error(result.error_message || '抠图分层失败');
        return;
      }

      // 3. 提取语义标签（LLM 分析结果）
      const labels = result.semantic_labels;
      const fgLabel = labels?.foreground
        ? (labels.foreground_clothing
          ? `${labels.foreground}，${labels.foreground_clothing}`
          : labels.foreground)
        : '[前景人物]';
      const bgLabel = labels?.background || '[背景场景]';
      const sceneInfo = labels?.scene ? `（${labels.scene}）` : '';

      // 4. 获取最新 store，区分 shot vs freeNode
      const freshStore = useVisualEditorStore.getState();
      const freshShot = freshStore.shots.find(s => s.id === clipId);
      const freshFreeNode = !freshShot ? freshStore.freeNodes.find(n => n.id === clipId) : null;
      const now = Date.now();

      if (freshShot) {
        // ── 序列节点（Shot）：更新 mask + 插入子 shot ──
        if (result.mask_url) {
          freshStore.updateShotMask(clipId, result.mask_url);
        }

        const baseDuration = freshShot.endTime - freshShot.startTime;
        const childShots = [
          {
            id: `${clipId}-fg-${now}`,
            mediaType: 'image' as const,
            startTime: 0,
            endTime: baseDuration,
            thumbnail: result.enhanced_foreground_url || result.foreground_url,
            thumbnailUrl: result.enhanced_foreground_url || result.foreground_url,
            foregroundMaskUrl: result.mask_url,
            transcript: `[前景] ${fgLabel}`,
            background: { type: 'original' as const },
            layers: [],
            artboard: { ...freshShot.artboard },
            aspectRatio: freshShot.aspectRatio,
          },
          {
            id: `${clipId}-bg-${now}`,
            mediaType: 'image' as const,
            startTime: 0,
            endTime: baseDuration,
            thumbnail: result.background_url,
            thumbnailUrl: result.background_url,
            transcript: `[背景] ${bgLabel}`,
            background: { type: 'original' as const },
            layers: [],
            artboard: { ...freshShot.artboard },
            aspectRatio: freshShot.aspectRatio,
          },
        ];
        freshStore.insertShotsAfter(clipId, childShots, { persist: false });
        toast.success(`✅ 智能分层完成${sceneInfo}`);

      } else if (freshFreeNode) {
        // ── 自由节点（FreeNode）：在父节点右侧创建前景 + 背景子节点 ──
        const parentPos = freshFreeNode.position || { x: 400, y: 100 };
        const fgNode: FreeNode = {
          id: `${clipId}-fg-${now}`,
          mediaType: 'image',
          thumbnail: result.enhanced_foreground_url || result.foreground_url,
          assetId: createAssetId(),
          duration: freshFreeNode.duration || 0,
          aspectRatio: freshFreeNode.aspectRatio,
          position: { x: parentPos.x + 300, y: parentPos.y - 80 },
        };
        const bgNode: FreeNode = {
          id: `${clipId}-bg-${now}`,
          mediaType: 'image',
          thumbnail: result.background_url,
          assetId: createAssetId(),
          duration: freshFreeNode.duration || 0,
          aspectRatio: freshFreeNode.aspectRatio,
          position: { x: parentPos.x + 300, y: parentPos.y + 120 },
        };
        await addFreeNodes([fgNode, bgNode]);

        // 创建分层关联边（父 → 前景、父 → 背景）
        addRelation(clipId, fgNode.id, 'separation', '[前景]');
        addRelation(clipId, bgNode.id, 'separation', '[背景]');

        toast.success(`✅ 智能分层完成${sceneInfo}`);
      } else {
        // 源节点已被删除，仅显示结果
        toast.success(`✅ 智能分层完成${sceneInfo}（源节点已移除，结果未插入画布）`);
      }

      // 刷新任务历史
      if (projectId) fetchTasks(projectId);

    } catch (err) {
      progressToast.dismiss();
      console.error('[WorkflowCanvas] 抠图分层失败:', err);
      toast.error(err instanceof Error ? err.message : '抠图分层失败');
    }
  }, [projectId, addFreeNodes, addRelation, fetchTasks]);

  // ★★ 构建带上游节点信息的 GenerationInputPair
  // 用于 AI 任务：自动收集连线路径上的上游节点作为参考/输入
  const buildUpstreamGenerationPair = useCallback((clipId: string): GenerationInputPair => {
    // 查找当前节点信息
    const sourceShot = shots.find(s => s.id === clipId);
    const sourceFreeNode = !sourceShot ? freeNodes.find(n => n.id === clipId) : null;
    const isEmptyNode = sourceFreeNode?.isEmpty;
    const thumbnail = sourceShot?.thumbnail || sourceFreeNode?.thumbnail;
    const videoUrl = sourceShot?.videoUrl || sourceShot?.replacedVideoUrl || sourceFreeNode?.videoUrl;
    const mediaType = (sourceShot?.mediaType || sourceFreeNode?.mediaType || 'image') as 'image' | 'video';
    const transcript = sourceShot?.transcript;

    // ★ 获取上游链：从近到远排列（BFS）
    const rawUpstreamIds = getUpstreamChain(clipId);
    // ★ 过滤掉 PromptNode ID（Prompt 是文本指令节点，不是图片素材）
    const promptNodeIdSet = new Set(promptNodes.map(p => p.id));
    const upstreamIds = rawUpstreamIds.filter(id => !promptNodeIdSet.has(id));

    if (upstreamIds.length === 0) {
      // 没有上游：只传当前节点自身
      return {
        fromClipId: clipId,
        fromThumbnail: thumbnail,
        fromVideoUrl: videoUrl,
        inputMediaTypes: [mediaType],
        inputDescriptions: transcript ? [transcript] : [],
      };
    }

    // ★ 有上游：构建 allInputNodes
    // 空节点：只包含上游节点（空节点本身无内容，排除）
    // 普通节点：上游从远到近 + 当前节点在最后
    const orderedUpstream = [...upstreamIds].reverse(); // 远到近 → 正序
    const allNodeIds = isEmptyNode ? orderedUpstream : [...orderedUpstream, clipId];
    const allInputNodes: Array<{ clipId: string; thumbnail?: string; videoUrl?: string }> = [];
    const inputMediaTypes: Array<'image' | 'video'> = [];
    const inputDescriptions: string[] = [];

    for (const nid of allNodeIds) {
      const shot = shots.find(s => s.id === nid);
      const fn = !shot ? freeNodes.find(n => n.id === nid) : null;
      allInputNodes.push({
        clipId: nid,
        thumbnail: shot?.thumbnail || fn?.thumbnail,
        videoUrl: shot?.videoUrl || shot?.replacedVideoUrl || fn?.videoUrl,
      });
      inputMediaTypes.push((shot?.mediaType || fn?.mediaType || 'image') as 'image' | 'video');
      const desc = shot?.transcript;
      if (desc) inputDescriptions.push(desc);
    }

    // ★ 最近的直接上游作为 from（来源），当前节点作为 to（目标）
    const nearestUpstreamId = upstreamIds[0];
    const nearestShot = shots.find(s => s.id === nearestUpstreamId);
    const nearestFn = !nearestShot ? freeNodes.find(n => n.id === nearestUpstreamId) : null;

    return {
      fromClipId: nearestUpstreamId,
      toClipId: clipId,
      fromThumbnail: nearestShot?.thumbnail || nearestFn?.thumbnail,
      toThumbnail: thumbnail,
      fromVideoUrl: nearestShot?.videoUrl || nearestShot?.replacedVideoUrl || nearestFn?.videoUrl,
      toVideoUrl: videoUrl,
      allInputNodes,
      inputMediaTypes,
      inputDescriptions,
    };
  }, [shots, freeNodes, promptNodes, getUpstreamChain]);

  // 将 shots 转换为 React Flow 节点
  const initialNodes = useMemo((): Node[] => {
    const GAP_X = 50;
    const START_X = 50;
    const START_Y = 50;

    // 计算每个节点的 x 位置（考虑不同宽度）
    let currentX = START_X;
    
    // ★ 调试日志：检查 shots 数据
    if (shots.length > 0) {
      console.log('[WorkflowCanvas] 创建节点, shots 数据样例:', {
        shotId: shots[0].id,
        startTime: shots[0].startTime,
        endTime: shots[0].endTime,
        duration: shots[0].endTime - shots[0].startTime,
      });
    }
    
    return shots.map((shot, index) => {
      const shotAspectRatio = (shot as any).aspectRatio || aspectRatio;
      const nodeWidth = getNodeWidth(shotAspectRatio);
      const nodeX = currentX;
      currentX += nodeWidth + GAP_X;
      
      // ★ 优先使用保存的画布位置（刷新后恢复），否则用线性布局
      const savedPosition = shot.canvasPosition;
      
      return {
        id: shot.id,
        type: 'clip',
        position: savedPosition || {
          x: nodeX,
          y: START_Y,
        },
        data: {
          clipId: (shot as any).clipId || shot.id,  // ★ 优先用 clips 表 ID，split/extractFrames 需要
          index: shot.index,
          mediaType: shot.mediaType || 'video',   // ★ 传递媒体类型
          thumbnail: shot.thumbnail,
          duration: shot.endTime - shot.startTime,
          startTime: shot.startTime,
          endTime: shot.endTime,
          sourceStart: shot.sourceStart,  // ★ 源视频位置（毫秒），用于 HLS 播放
          sourceEnd: shot.sourceEnd,      // ★ 源视频位置（毫秒）
          transcript: shot.transcript,
          aspectRatio: (shot as any).aspectRatio || aspectRatio,  // ★ 优先使用 shot 自己的 aspectRatio
          assetId: shot.assetId, // ★ 素材 ID，用于播放
          videoUrl: shot.videoUrl || shot.replacedVideoUrl,  // ★ 替换后的视频 URL
          generatingTaskId: shot.generatingTaskId,
          generatingCapability: shot.generatingCapability,
          onOpenGeneration: (clipId: string, capabilityId?: string) => {
            const sourceShot = shots.find((item) => item.id === clipId);
            // ★★ 自动收集连线上游节点，优先选择最近的连线路径
            setGenerationPair(buildUpstreamGenerationPair(clipId));
            setGenerationTemplateId(sourceShot?.background?.templateId || undefined);
            // ★ 设置目标 clipId，connectedPrompt 由 useMemo 自动计算
            setGenerationTargetClipId(clipId);
            setGenerationInitCapability(capabilityId);
            setShowGenerationComposer(true);
            closeSidebar();
          },
          onOpenCompositor: (clipId: string) => {
            setCompositorClipId(clipId);
            setShowCompositor(true);
          },
          onSeparate: handleSeparate,
        } as ClipNodeData,
      };
    });
  }, [shots, aspectRatio, handleSeparate, closeSidebar, buildUpstreamGenerationPair]);

  // ★ 删除自由节点
  const handleDeleteFreeNode = useCallback((nodeId: string) => {
    removeFreeNode(nodeId);
  }, [removeFreeNode]);

  // ★ 自由节点转为 ReactFlow Node（独立于线性序列）
  const freeReactFlowNodes = useMemo((): Node[] => {
    return freeNodes.map((fn) => {
      const nodeWidth = getNodeWidth(fn.aspectRatio || aspectRatio);
      // 空节点：计算上游素材连线数量（排除 PromptNode 连线）
      const promptNodeIdSet = new Set(promptNodes.map(p => p.id));
      const upstreamCount = fn.isEmpty
        ? canvasEdges.filter(e => e.target === fn.id && !promptNodeIdSet.has(e.source)).length
        : 0;
      return {
        id: fn.id,
        type: 'clip',
        position: fn.position,
        data: {
          clipId: fn.id,
          index: -1,  // 自由节点无序号
          mediaType: fn.mediaType,
          thumbnail: fn.thumbnail,
          duration: fn.duration,
          startTime: 0,
          endTime: fn.duration,
          aspectRatio: fn.aspectRatio || aspectRatio,
          assetId: fn.assetId,
          videoUrl: fn.videoUrl,
          isFreeNode: true,
          isEmpty: fn.isEmpty,
          upstreamCount,
          generatingTaskId: fn.generatingTaskId,
          generatingCapability: fn.generatingCapability,
          onDeleteFreeNode: handleDeleteFreeNode,
          onGenerateFromEmpty: (clipId: string) => {
            setGenerationPair(buildUpstreamGenerationPair(clipId));
            setGenerationTargetClipId(clipId);
            setGenerationInitCapability(undefined);
            setShowGenerationComposer(true);
            closeSidebar();
          },
          onOpenGeneration: (clipId: string, capabilityId?: string) => {
            // ★★ 自动收集连线上游节点，优先选择最近的连线路径
            setGenerationPair(buildUpstreamGenerationPair(clipId));
            // ★ 设置目标 clipId，connectedPrompt 由 useMemo 自动计算
            setGenerationTargetClipId(clipId);
            setGenerationInitCapability(capabilityId);
            setShowGenerationComposer(true);
            closeSidebar();
          },
          onOpenCompositor: (clipId: string) => {
            setCompositorClipId(clipId);
            setShowCompositor(true);
          },
          onSeparate: handleSeparate,
        } as ClipNodeData,
      };
    });
  }, [freeNodes, aspectRatio, canvasEdges, promptNodes, handleDeleteFreeNode, handleSeparate, closeSidebar, buildUpstreamGenerationPair]);

  // ★ 合并后的所有节点（uploadReactFlowNodes 在下方定义后与此合并）
  const allInitialNodes = useMemo(() => {
    return [...initialNodes, ...freeReactFlowNodes];
  }, [initialNodes, freeReactFlowNodes]);

  // ★ Edge 上的加号按钮回调
  const handleAddMaterial = useCallback((sourceId: string, targetId: string) => {
    console.log('[WorkflowCanvas] 点击添加素材:', { sourceId, targetId });
    setIsFreeAddMode(false);
    setInsertPosition({ sourceId, targetId });
    setInsertActionMenu(null);
    setShowMaterialPicker(true);
  }, []);

  const handleApplyTransitionTemplate = useCallback((sourceId: string, targetId: string) => {
    console.log('[WorkflowCanvas] 点击应用转场模板:', { sourceId, targetId });
    const sourceShot = shots.find((s) => s.id === sourceId);
    const targetShot = shots.find((s) => s.id === targetId);
    const sourceFn = !sourceShot ? freeNodes.find(n => n.id === sourceId) : null;
    const targetFn = !targetShot ? freeNodes.find(n => n.id === targetId) : null;
    setTransitionPair({
      fromClipId: sourceId,
      toClipId: targetId,
      fromThumbnail: sourceShot?.thumbnail || sourceFn?.thumbnail,
      toThumbnail: targetShot?.thumbnail || targetFn?.thumbnail,
    });
    setShowTemplateModal(true);
    closeSidebar();
  }, [closeSidebar, shots, freeNodes]);

  const handleOpenGenerationComposer = useCallback((sourceId: string, targetId: string) => {
    const sourceShot = shots.find((shot) => shot.id === sourceId);
    const targetShot = shots.find((shot) => shot.id === targetId);
    // P1: 收集媒体类型和内容描述
    const sourceFn = !sourceShot ? freeNodes.find(n => n.id === sourceId) : null;
    const targetFn = !targetShot ? freeNodes.find(n => n.id === targetId) : null;
    const mediaTypes: Array<'image' | 'video'> = [
      (sourceShot?.mediaType || sourceFn?.mediaType || 'image') as 'image' | 'video',
      (targetShot?.mediaType || targetFn?.mediaType || 'image') as 'image' | 'video',
    ];
    const descriptions = [sourceShot?.transcript, targetShot?.transcript].filter(Boolean) as string[];

    setGenerationPair({
      fromClipId: sourceId,
      toClipId: targetId,
      fromThumbnail: sourceShot?.thumbnail || sourceFn?.thumbnail,
      toThumbnail: targetShot?.thumbnail || targetFn?.thumbnail,
      fromVideoUrl: sourceShot?.videoUrl || sourceShot?.replacedVideoUrl || sourceFn?.videoUrl,
      toVideoUrl: targetShot?.videoUrl || targetShot?.replacedVideoUrl || targetFn?.videoUrl,
      inputMediaTypes: mediaTypes,
      inputDescriptions: descriptions,
    });
    setGenerationTemplateId(sourceShot?.background?.templateId || targetShot?.background?.templateId || undefined);
    setShowGenerationComposer(true);
    closeSidebar();
  }, [closeSidebar, shots, freeNodes]);

  // ★ 快速上传：拖放/选文件 → 上传 → 直接变成节点（零确认）
  const handleQuickUpload = useCallback(async (sourceId: string, _targetId: string, files: File[]) => {
    console.log('[WorkflowCanvas] 快速上传:', { sourceId, fileCount: files.length });
    
    const newShots: Parameters<typeof insertShotsAfter>[1] = [];

    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;

      try {
        const result = await materialsApi.uploadMaterial(file, 'general', {
          displayName: file.name,
          assetCategory: 'project_asset',
        });

        if (result.data) {
          const mat = result.data;
          const isImage = mat.file_type === 'image';
          const defaultDurationMs = isImage ? 3000 : 5000;
          const durationMs = mat.duration || defaultDurationMs;
          const duration = durationMs / 1000;

          let materialAspectRatio: '16:9' | '9:16' | 'vertical' | 'horizontal' | undefined;
          if (mat.width && mat.height) {
            materialAspectRatio = mat.height > mat.width ? '9:16' : '16:9';
          }

          newShots.push({
            id: crypto.randomUUID(),
            mediaType: isImage ? 'image' as const : 'video' as const,
            startTime: 0,
            endTime: duration,
            sourceStart: 0,
            sourceEnd: durationMs,
            assetId: mat.id,
            thumbnail: mat.thumbnail_url || (isImage ? mat.url : undefined),  // ★ 图片用原图做缩略图
            videoUrl: isImage ? undefined : mat.url,
            aspectRatio: materialAspectRatio,
            background: { type: 'original' as const },
            layers: [],
            artboard: DEFAULT_ARTBOARD,
          });
        }
      } catch (err) {
        console.error('[WorkflowCanvas] 快速上传失败:', file.name, err);
      }
    }

    if (newShots.length > 0) {
      await insertShotsAfter(sourceId, newShots);
    }
  }, [insertShotsAfter]);

  const handleInsertMenuChooseMaterial = useCallback(() => {
    if (!insertActionMenu) return;
    setIsFreeAddMode(false);
    setInsertPosition({ sourceId: insertActionMenu.sourceId, targetId: insertActionMenu.targetId });
    setInsertActionMenu(null);
    setShowMaterialPicker(true);
  }, [insertActionMenu]);

  const handleInsertMenuChooseUpload = useCallback(() => {
    if (!insertActionMenu) return;
    setPendingQuickInsert({ sourceId: insertActionMenu.sourceId, targetId: insertActionMenu.targetId });
    setInsertActionMenu(null);
    window.setTimeout(() => quickInsertInputRef.current?.click(), 0);
  }, [insertActionMenu]);

  const handleQuickInsertFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';

    if (files.length === 0) {
      setPendingQuickInsert(null);
      return;
    }
    if (!pendingQuickInsert) return;

    await handleQuickUpload(pendingQuickInsert.sourceId, pendingQuickInsert.targetId, files);
    setPendingQuickInsert(null);
    setInsertPosition(null);
  }, [pendingQuickInsert, handleQuickUpload]);

  // ★ 断开连线：canvas edge → 仅移除连线；sequence edge → 删除后方节点
  const handleDisconnectEdge = useCallback((sourceId: string, targetId: string) => {
    const { canvasEdges: currentCanvasEdges } = useVisualEditorStore.getState();
    const canvasEdge = currentCanvasEdges.find(
      ce => ce.source === sourceId && ce.target === targetId
    );
    if (canvasEdge) {
      // Canvas edge（用户手动连线）：仅移除连线，保留节点
      console.log('[WorkflowCanvas] 断开 canvas 连线:', canvasEdge.id);
      removeCanvasEdge(canvasEdge.id);
    } else {
      // Sequence edge（分镜序列边）：移除后方节点
      console.log('[WorkflowCanvas] 断开序列连线，移除节点:', targetId);
      deleteShot(targetId);
    }
  }, [deleteShot, removeCanvasEdge]);

  // 创建连接边（★ 使用自定义边类型，带加号按钮）
  const initialEdges = useMemo((): Edge<AddButtonEdgeData>[] => {
    return shots.slice(0, -1).map((shot, index) => ({
      id: `edge-${shot.id}-${shots[index + 1].id}`,
      source: shot.id,
      target: shots[index + 1].id,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'addButton',  // ★ 使用自定义边类型
      animated: false,
      data: {
        onAddMaterial: handleAddMaterial,  // ★ 传入回调
        onApplyTransition: handleApplyTransitionTemplate,
        onOpenGeneration: handleOpenGenerationComposer,
        onQuickUpload: handleQuickUpload,  // ★ 快速上传
        onDisconnect: handleDisconnectEdge,  // ★ 断开连线
      },
    }));
  }, [shots, handleAddMaterial, handleApplyTransitionTemplate, handleOpenGenerationComposer, handleQuickUpload, handleDisconnectEdge]);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState(allInitialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // ★ 使用 ref 引用最新 nodes，避免 pickSmartHandles 依赖 nodes 导致连锁重渲染
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // ★★★ 智能 handle 选择：根据两个节点的相对位置 + 节点类型，选择最优的 sourceHandle / targetHandle
  // - ClipNode / freeNode：4 方向 handle（source/source-top/source-bottom/source-left + 对应 target）
  // - PromptNode：只有 1 个 source handle（prompt-out / negative-prompt-out）
  // - FileUploadNode：只有基本的 source/target
  // 使用 nodesRef 而非 nodes，保持 callback 引用稳定，防止拖拽时 userEdges 重算触发 setNodes 重置位置

  /** 根据节点类型获取该节点实际可用的 source handle ID */
  const getSourceHandleForNode = useCallback((node: Node): string => {
    if (node.type === 'prompt') {
      const variant = (node.data as PromptNodeData)?.variant;
      return variant === 'negative' ? 'negative-prompt-out' : 'prompt-out';
    }
    // clipNode / fileUpload / 其他：都有标准 source handle
    return 'source';
  }, []);

  /** 根据目标节点类型 + 源节点类型获取 target handle ID */
  const getTargetHandleForNode = useCallback((tgtNode: Node, srcNode?: Node): string => {
    if (tgtNode.type === 'clip' && srcNode?.type === 'prompt') {
      // PromptNode → ClipNode：映射到 ClipNode 上的 prompt-in / negative-prompt-in
      const variant = (srcNode.data as PromptNodeData)?.variant;
      return variant === 'negative' ? 'negative-prompt-in' : 'prompt-in';
    }
    // 默认 target handle
    return 'target';
  }, []);

  const pickSmartHandles = useCallback((srcId: string, tgtId: string): { sourceHandle: string; targetHandle: string } => {
    const currentNodes = nodesRef.current;
    const srcNode = currentNodes.find(n => n.id === srcId);
    const tgtNode = currentNodes.find(n => n.id === tgtId);
    if (!srcNode || !tgtNode) return { sourceHandle: 'source', targetHandle: 'target' };

    // ★ 非标准多 handle 节点：直接返回该节点类型唯一的 handle
    const srcType = srcNode.type;
    if (srcType === 'prompt') {
      return {
        sourceHandle: getSourceHandleForNode(srcNode),
        targetHandle: getTargetHandleForNode(tgtNode, srcNode),
      };
    }

    // ★ 标准多 handle 节点（clipNode / fileUpload 等）：根据相对位置选最优方向
    const srcW = (srcNode.measured?.width ?? 160) / 2;
    const srcH = (srcNode.measured?.height ?? 280) / 2;
    const tgtW = (tgtNode.measured?.width ?? 160) / 2;
    const tgtH = (tgtNode.measured?.height ?? 280) / 2;

    const srcCx = srcNode.position.x + srcW;
    const srcCy = srcNode.position.y + srcH;
    const tgtCx = tgtNode.position.x + tgtW;
    const tgtCy = tgtNode.position.y + tgtH;

    const dx = tgtCx - srcCx;
    const dy = tgtCy - srcCy;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI); // -180 ~ 180

    // 根据角度选择最优出/入方向
    // 右: -45~45°, 下: 45~135°, 左: |angle|>135°, 上: -135~-45°
    let srcHandle: string;
    let tgtHandle: string;

    if (angle >= -45 && angle < 45) {
      srcHandle = 'source';        // Right
      tgtHandle = 'target';        // Left
    } else if (angle >= 45 && angle < 135) {
      srcHandle = 'source-bottom'; // Bottom
      tgtHandle = 'target-top';    // Top
    } else if (angle >= -135 && angle < -45) {
      srcHandle = 'source-top';    // Top
      tgtHandle = 'target-bottom'; // Bottom
    } else {
      srcHandle = 'source-left';   // Left
      tgtHandle = 'target-right';  // Right
    }

    // ★ 如果目标是 prompt 节点（极少见，prompt 通常只做 source），修正 target handle
    if (tgtNode.type === 'prompt') {
      tgtHandle = getSourceHandleForNode(tgtNode); // prompt 节点只暴露 source handle
    }

    return { sourceHandle: srcHandle, targetHandle: tgtHandle };
  }, [getSourceHandleForNode, getTargetHandleForNode]); // ★ 通过 nodesRef 读取最新状态，保持引用稳定

  // ★ 用户手动创建的连线 — 使用 AddButtonEdge 渲染（保留➕按钮功能 + 方向箭头）
  // ★ 用户创建的关联边 → 统一使用简单箭头线（V1）
  // ★ 设置 selectable + deletable 使边可被点击选中、键盘 Delete 删除
  const userEdges = useMemo((): Edge[] => {
    return canvasEdges.map(ce => {
      // ★ 优先使用存储的 handle ID（PromptNode 等特殊节点），否则用 pickSmartHandles 智能选择
      const handles = (ce.sourceHandle && ce.targetHandle)
        ? { sourceHandle: ce.sourceHandle, targetHandle: ce.targetHandle }
        : pickSmartHandles(ce.source, ce.target);
      return {
        id: ce.id,
        source: ce.source,
        target: ce.target,
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        type: 'simple' as const,
        selectable: true,
        deletable: true,
        reconnectable: true,
      };
    });
  }, [canvasEdges, pickSmartHandles]);

  // ★ 拦截节点的 remove 操作：节点删除只允许通过右键菜单触发，不允许通过 Delete/Backspace 键直接删除
  // ★ 拦截锁定节点的 position 变更：锁定节点不可拖拽
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const { lockedNodeIds } = useVisualEditorStore.getState();
    const filtered = changes.filter(c => {
      if (c.type === 'remove') return false;
      if (c.type === 'position' && 'id' in c && lockedNodeIds.includes(c.id)) return false;
      return true;
    });
    onNodesChangeRaw(filtered);
  }, [onNodesChangeRaw]);

  // ★ 用户拖拽连线 → 直接创建关联边（V1：纯关联，不弹选择器）
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    // 避免自连接
    if (connection.source === connection.target) return;
    
    // ★ V1：直接创建 reference 类型的关联边（携带 handle 信息以便持久化）
    addRelation(
      connection.source,
      connection.target,
      'reference',
      undefined,
      connection.sourceHandle || undefined,
      connection.targetHandle || undefined,
    );
  }, [addRelation]);

  // 当 shots / freeNodes / uploadNodes / promptNodes / canvasEdges 变化时，更新节点和边
  React.useEffect(() => {
    const mergedSequenceNodes = mergePositions(initialNodes);
    // 内联构建上传占位节点（handlers 通过 ref 获取最新值）
    const uploadFlowNodes: Node[] = uploadNodes.map((un) => ({
      id: un.id,
      type: 'fileUpload' as const,
      position: un.position,
      data: {
        onUploadComplete: handleUploadCompleteRef.current,
        onRemove: handleRemoveUploadNodeRef.current,
      },
    }));
    // ★ 内联构建 Prompt 节点（handlers 通过 ref 获取最新值）
    const promptFlowNodes: Node[] = promptNodes.map((pn) => ({
      id: pn.id,
      type: 'prompt' as const,
      position: pn.position,
      data: {
        variant: pn.variant,
        initialText: pn.text,
        onTextChange: handlePromptTextChangeRef.current,
        onRemove: handleRemovePromptNodeRef.current,
      } as PromptNodeData,
    }));
    setNodes([...mergedSequenceNodes, ...freeReactFlowNodes, ...uploadFlowNodes, ...promptFlowNodes]);
    // ★ 所有 canvas edge 统一由 userEdges 以 RelationEdge（带箭头）渲染
    // 延迟设置边，确保节点已渲染完成
    const timer = setTimeout(() => {
      setEdges([...initialEdges, ...userEdges]);
    }, 100);
    return () => clearTimeout(timer);
  }, [shots, freeNodes, canvasEdges, uploadNodes, promptNodes, initialNodes, freeReactFlowNodes, initialEdges, userEdges, setNodes, setEdges, mergePositions, pickSmartHandles]);

  // ★ onBeforeDelete：阻止键盘 Delete 删除节点，仅允许删除 canvas edge
  const handleBeforeDelete = useCallback(async ({ nodes: delNodes, edges: delEdges }: { nodes: Node[]; edges: Edge[] }) => {
    // 有节点要删除 → 阻止（节点删除只允许通过右键菜单）
    if (delNodes.length > 0) return false;
    // 检查是否有 sequence edge（非 canvas edge）要删除 → 阻止
    const { canvasEdges: currentCanvasEdges } = useVisualEditorStore.getState();
    const hasSequenceEdge = delEdges.some(e => !currentCanvasEdges.some(ce => ce.id === e.id));
    if (hasSequenceEdge) return false;
    // 只有 canvas edge 允许通过键盘删除
    return true;
  }, []);

  // ★ 包装 onEdgesChange：拦截 canvas edge 的删除，持久化到后端
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const change of changes) {
      if (change.type === 'remove') {
        const isCanvas = canvasEdges.some(ce => ce.id === change.id);
        if (isCanvas) {
          removeCanvasEdge(change.id);
        }
      }
    }
    onEdgesChange(changes);
  }, [onEdgesChange, canvasEdges, removeCanvasEdge]);

  // ★ 拖拽重连线：用户从已连接的边端点拖到新节点时，删除旧边并创建新边
  const edgeReconnectSuccessful = useRef(true);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    edgeReconnectSuccessful.current = true;
    if (!newConnection.source || !newConnection.target) return;
    // 避免自连接
    if (newConnection.source === newConnection.target) return;
    // 删除旧边，创建新边（携带 handle 信息）
    removeCanvasEdge(oldEdge.id);
    addRelation(
      newConnection.source, newConnection.target, 'reference', undefined,
      newConnection.sourceHandle || undefined,
      newConnection.targetHandle || undefined,
    );
  }, [removeCanvasEdge, addRelation]);

  const onReconnectEnd = useCallback((_event: MouseEvent | TouchEvent, edge: Edge) => {
    // 如果拖拽结束时没有成功连接到新节点 → 删除原边（表达用户"拔掉线"的意图）
    if (!edgeReconnectSuccessful.current) {
      removeCanvasEdge(edge.id);
    }
  }, [removeCanvasEdge]);

  // ★ 闭环检测：canvasEdges 形成闭环时，在几何中心显示 + 按钮
  const detectedCycles = useCycleDetection(canvasEdges, nodes);

  // ★ 闭环自动布局：新闭环出现时，自动将节点排列为正多边形（三角形、正方形、N 边形）
  const { relayoutCycle } = useCycleAutoLayout({
    detectedCycles,
    nodes,
    setNodes,
    saveUserPosition,
    persistPosition: persistNodePosition,
  });

  // ★ 闭环中心 + 按钮点击：打开多图生成（传递所有节点信息）
  // P1: 几何顺时针排序 — 按节点相对于中心的角度排序
  const handleCycleGeneration = useCallback((nodeIds: string[]) => {
    if (nodeIds.length < 2) return;

    // 收集所有参与节点的缩略图信息 + 位置
    const rawNodes: Array<{ clipId: string; thumbnail?: string; videoUrl?: string; mediaType?: 'image' | 'video'; transcript?: string; x: number; y: number }> = [];
    for (const nid of nodeIds) {
      const rfNode = nodes.find(n => n.id === nid);
      const pos = rfNode?.position || { x: 0, y: 0 };
      const shot = shots.find(s => s.id === nid);
      if (shot) {
        rawNodes.push({ clipId: nid, thumbnail: shot.thumbnail, videoUrl: shot.videoUrl || shot.replacedVideoUrl, mediaType: shot.mediaType || 'video', transcript: shot.transcript, x: pos.x, y: pos.y });
      } else {
        const fn = freeNodes.find(n => n.id === nid);
        if (fn) {
          rawNodes.push({ clipId: nid, thumbnail: fn.thumbnail, videoUrl: fn.videoUrl, mediaType: fn.mediaType, x: pos.x, y: pos.y });
        }
      }
    }

    // P1: 几何顺时针排序（按相对于重心的角度 atan2）
    if (rawNodes.length >= 3) {
      const cx = rawNodes.reduce((s, n) => s + n.x, 0) / rawNodes.length;
      const cy = rawNodes.reduce((s, n) => s + n.y, 0) / rawNodes.length;
      rawNodes.sort((a, b) => {
        const angleA = Math.atan2(a.y - cy, a.x - cx);
        const angleB = Math.atan2(b.y - cy, b.x - cx);
        return angleA - angleB;
      });
    }

    const allInputNodes = rawNodes.map(({ clipId, thumbnail, videoUrl }) => ({ clipId, thumbnail, videoUrl }));
    const inputMediaTypes = rawNodes.map(n => n.mediaType || 'image' as const);
    const inputDescriptions = rawNodes.map(n => n.transcript || '').filter(Boolean);

    const first = allInputNodes[0];
    const last = allInputNodes[allInputNodes.length - 1];
    setGenerationPair({
      fromClipId: first?.clipId || nodeIds[0],
      toClipId: last?.clipId || nodeIds[nodeIds.length - 1],
      fromThumbnail: first?.thumbnail,
      toThumbnail: last?.thumbnail,
      fromVideoUrl: first?.videoUrl,
      toVideoUrl: last?.videoUrl,
      allInputNodes,
      inputMediaTypes: inputMediaTypes as Array<'image' | 'video'>,
      inputDescriptions,
    });
    setGenerationTemplateId(undefined);
    // ★ 设置触发节点的 clipId，用于 Prompt 同步（最后一个节点通常是触发生成的目标节点）
    setGenerationTargetClipId(nodeIds[nodeIds.length - 1]);
    setShowGenerationComposer(true);
    closeSidebar();
  }, [shots, freeNodes, nodes, closeSidebar]);

  // ★ 素材选择确认处理
  const handleMaterialConfirm = useCallback(async (materials: SelectedMaterial[], _placement: PlacementStrategy) => {
    if (!insertPosition || materials.length === 0) return;
    
    console.log('[WorkflowCanvas] 确认添加素材:', {
      afterShotId: insertPosition.sourceId,
      materials: materials.map(m => ({ id: m.material.id, name: m.material.name })),
    });
    
    // 将素材转换为 Shot 格式
    const newShots = materials.map((m, idx) => {
      const mat = m.material;
      // ★ 判断媒体类型：image / video
      const isImage = mat.file_type === 'image';
      const defaultDurationMs = isImage ? 3000 : 5000;  // 图片3秒，视频5秒
      const durationMs = mat.duration || defaultDurationMs;
      const duration = durationMs / 1000;  // 毫秒转秒
      
      // ★ 根据素材的 width/height 判断比例
      let materialAspectRatio: '16:9' | '9:16' | 'vertical' | 'horizontal' | undefined;
      if (mat.width && mat.height) {
        materialAspectRatio = mat.height > mat.width ? '9:16' : '16:9';
      }
      
      return {
        id: crypto.randomUUID(),  // ★ 使用标准 UUID
        mediaType: isImage ? 'image' as const : 'video' as const,  // ★ 媒体类型
        startTime: 0,  // 会在 insertShotsAfter 中计算
        endTime: duration,
        sourceStart: 0,
        sourceEnd: durationMs,  // 毫秒
        assetId: mat.id,
        thumbnail: mat.thumbnail_url || (isImage ? mat.url : undefined),  // ★ 图片用原图做缩略图
        videoUrl: isImage ? undefined : mat.url,  // ★ 图片不需要 videoUrl
        aspectRatio: materialAspectRatio,  // ★ 保存素材比例
        background: { type: 'original' as const },
        layers: [],
        artboard: DEFAULT_ARTBOARD,
      };
    });
    
    // 调用 store 方法插入
    await insertShotsAfter(insertPosition.sourceId, newShots);
    
    // 重置状态
    setShowMaterialPicker(false);
    setInsertPosition(null);
  }, [insertPosition, insertShotsAfter]);

  // 节点点击处理
  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    setSelectedNodeId(node.id);
    // ★ 使用统一的侧边栏管理
    useVisualEditorStore.getState().openSidebar('aiCapability', node.id);
    
    // 通知父组件
    const shot = shots.find(s => s.id === node.id);
    onShotSelect?.(shot || null);
  }, [shots, onShotSelect]);

  // 画布空白区域点击 — 关闭所有菜单
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    useVisualEditorStore.getState().closeSidebar();
    onShotSelect?.(null);
    setPaneMenu(null);
    setInsertActionMenu(null);
    setPendingQuickInsert(null);
    // ★ 通知所有菜单关闭（AddButtonEdge popover、ClipNode 右键菜单等）
    window.dispatchEvent(new CustomEvent('workflow-close-all-menus'));
  }, [onShotSelect]);

  // ★ 双击画布空白处 → 创建空节点
  const handlePaneDoubleClick = useCallback((event: React.MouseEvent) => {
    let flowX = 200, flowY = 200;
    if (rfInstanceRef.current) {
      const pos = rfInstanceRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      flowX = pos.x;
      flowY = pos.y;
    }
    const emptyNode: FreeNode = {
      id: crypto.randomUUID(),
      mediaType: 'image',
      duration: 0,
      position: { x: flowX, y: flowY },
      isEmpty: true,
    };
    addFreeNodes([emptyNode]);
  }, [addFreeNodes]);

  // ★ 右键菜单 → 创建空节点
  const handlePaneCreateEmptyNode = useCallback(() => {
    const pos = paneMenu || { flowX: 200, flowY: 100 };
    const emptyNode: FreeNode = {
      id: crypto.randomUUID(),
      mediaType: 'image',
      duration: 0,
      position: { x: pos.flowX, y: pos.flowY },
      isEmpty: true,
    };
    addFreeNodes([emptyNode]);
    setPaneMenu(null);
  }, [paneMenu, addFreeNodes]);

  // ★ 多选状态追踪：当框选/Shift 多选时触发
  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: selectedNodes }) => {
    // 只追踪 clip 类型节点（排除 fileUpload / prompt 临时节点）
    const clipIds = selectedNodes
      .filter(n => n.type === 'clip')
      .map(n => n.id);
    setSelectedNodeIds(clipIds);
    setShowAlignMenu(false);  // 选区变化时收起对齐菜单
  }, []);

  // ★ 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (selectedNodeIds.length === 0) return;
    const count = selectedNodeIds.length;
    await batchDeleteNodes(selectedNodeIds);
    setSelectedNodeIds([]);
    toast.success(`已删除 ${count} 个节点`);
  }, [selectedNodeIds, batchDeleteNodes]);

  // ★ 批量锁定/解锁
  const handleBatchToggleLock = useCallback((lock: boolean) => {
    for (const id of selectedNodeIds) {
      toggleNodeLock(id, lock);
    }
    toast.success(lock ? `已锁定 ${selectedNodeIds.length} 个节点` : `已解锁 ${selectedNodeIds.length} 个节点`);
  }, [selectedNodeIds, toggleNodeLock]);

  // ★ 批量对齐
  const handleBatchAlign = useCallback((direction: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => {
    if (selectedNodeIds.length < 2) return;
    // 从当前 nodes 中获取选中节点的位置
    const selectedNodes = nodes.filter(n => selectedNodeIds.includes(n.id));
    if (selectedNodes.length < 2) return;

    const positions = selectedNodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y, width: n.measured?.width ?? 160, height: n.measured?.height ?? 284 }));

    let updates: Array<{ id: string; x: number; y: number }> = [];

    switch (direction) {
      case 'left': {
        const minX = Math.min(...positions.map(p => p.x));
        updates = positions.map(p => ({ id: p.id, x: minX, y: p.y }));
        break;
      }
      case 'right': {
        const maxRight = Math.max(...positions.map(p => p.x + p.width));
        updates = positions.map(p => ({ id: p.id, x: maxRight - p.width, y: p.y }));
        break;
      }
      case 'center-h': {
        const centerX = positions.reduce((sum, p) => sum + p.x + p.width / 2, 0) / positions.length;
        updates = positions.map(p => ({ id: p.id, x: centerX - p.width / 2, y: p.y }));
        break;
      }
      case 'top': {
        const minY = Math.min(...positions.map(p => p.y));
        updates = positions.map(p => ({ id: p.id, x: p.x, y: minY }));
        break;
      }
      case 'bottom': {
        const maxBottom = Math.max(...positions.map(p => p.y + p.height));
        updates = positions.map(p => ({ id: p.id, x: p.x, y: maxBottom - p.height }));
        break;
      }
      case 'center-v': {
        const centerY = positions.reduce((sum, p) => sum + p.y + p.height / 2, 0) / positions.length;
        updates = positions.map(p => ({ id: p.id, x: p.x, y: centerY - p.height / 2 }));
        break;
      }
    }

    // 更新节点位置
    setNodes(nds => nds.map(n => {
      const update = updates.find(u => u.id === n.id);
      if (update) return { ...n, position: { x: update.x, y: update.y } };
      return n;
    }));
    // 持久化位置（区分自由节点和序列节点）
    const { freeNodes: currentFreeNodes } = useVisualEditorStore.getState();
    const freeNodeIdSet = new Set(currentFreeNodes.map(n => n.id));
    for (const u of updates) {
      if (freeNodeIdSet.has(u.id)) {
        updateFreeNodePosition(u.id, { x: u.x, y: u.y });
      } else {
        persistNodePosition(u.id, { x: u.x, y: u.y });
      }
    }
    setShowAlignMenu(false);
    toast.success('已对齐');
  }, [selectedNodeIds, nodes, setNodes, updateFreeNodePosition, persistNodePosition]);

  // ★ 取消多选
  const handleClearSelection = useCallback(() => {
    setSelectedNodeIds([]);
    // 清除 ReactFlow 内部选中状态
    setNodes(nds => nds.map(n => ({ ...n, selected: false })));
  }, [setNodes]);

  // ★ 批量操作栏中的锁定状态判断
  const batchLockStatus = useMemo(() => {
    const { lockedNodeIds } = useVisualEditorStore.getState();
    const lockedCount = selectedNodeIds.filter(id => lockedNodeIds.includes(id)).length;
    if (lockedCount === 0) return 'all-unlocked';
    if (lockedCount === selectedNodeIds.length) return 'all-locked';
    return 'mixed';
  }, [selectedNodeIds]);

  // ★ 菜单协调：打开画布菜单时关闭其他菜单，收到关闭事件时关闭自己
  const { broadcastCloseMenus } = useMenuCoordination(() => {
    setPaneMenu(null);
    setInsertActionMenu(null);
  });

  // ★ 画布空白区域右键 → 弹出上下文菜单
  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    broadcastCloseMenus();  // ★ 通知其他菜单关闭
    setInsertActionMenu(null);
    // 获取画布坐标
    let flowX = 200, flowY = 200;
    if (rfInstanceRef.current) {
      const pos = rfInstanceRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      flowX = pos.x;
      flowY = pos.y;
    }
    setPaneMenu({ x: event.clientX, y: event.clientY, flowX, flowY });
  }, [broadcastCloseMenus]);

  // ★ 画布右键菜单 → 添加素材（打开素材侧边栏）
  const handlePaneAddMaterial = useCallback(() => {
    openSidebar('materialPicker');
    setPaneMenu(null);
  }, [openSidebar]);

  // ★ 画布右键菜单 → Import（创建 FileUploadNode）
  const handlePaneImport = useCallback(() => {
    const pos = paneMenu || { flowX: 200, flowY: 100 };
    const newUploadNode = {
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: { x: pos.flowX, y: pos.flowY },
    };
    setUploadNodes((prev) => [...prev, newUploadNode]);
    setPaneMenu(null);
  }, [paneMenu]);

  // ★ FileUploadNode 上传完成 → 替换为 FreeNode
  const handleUploadComplete = useCallback((nodeId: string, result: UploadResult) => {
    let materialAspectRatio: '16:9' | '9:16' | 'vertical' | 'horizontal' | undefined;
    if (result.width && result.height) {
      materialAspectRatio = result.height > result.width ? '9:16' : '16:9';
    }

    // 找到上传节点的位置
    const uploadNode = uploadNodes.find((n) => n.id === nodeId);
    const position = uploadNode?.position || { x: 200, y: 100 };

    const newFreeNode = {
      id: crypto.randomUUID(),
      mediaType: result.mediaType,
      thumbnail: result.thumbnailUrl,
      videoUrl: result.mediaType === 'video' ? result.url : undefined,
      assetId: result.assetId,
      duration: result.duration,
      aspectRatio: materialAspectRatio,
      position,
    };

    addFreeNodes([newFreeNode]);
    // 移除上传节点
    setUploadNodes((prev) => prev.filter((n) => n.id !== nodeId));
  }, [uploadNodes, addFreeNodes]);

  // ★ FileUploadNode 删除（取消上传）
  const handleRemoveUploadNode = useCallback((nodeId: string) => {
    setUploadNodes((prev) => prev.filter((n) => n.id !== nodeId));
  }, []);

  // ★ 保持 refs 与最新 handler 同步
  handleUploadCompleteRef.current = handleUploadComplete;
  handleRemoveUploadNodeRef.current = handleRemoveUploadNode;

  // ★ PromptNode 文本变更处理
  const handlePromptTextChange = useCallback((nodeId: string, text: string) => {
    updatePromptNode(nodeId, { text });
  }, [updatePromptNode]);

  // ★ PromptNode 删除处理
  const handleRemovePromptNode = useCallback((nodeId: string) => {
    removePromptNodeFromStore(nodeId);
  }, [removePromptNodeFromStore]);

  // ★ 保持 prompt refs 与最新 handler 同步
  handlePromptTextChangeRef.current = handlePromptTextChange;
  handleRemovePromptNodeRef.current = handleRemovePromptNode;

  // ★ 画布右键菜单 → 创建 Prompt 节点
  const handlePaneCreatePrompt = useCallback((variant: PromptVariant) => {
    const pos = paneMenu || { flowX: 200, flowY: 100 };
    const newPromptNode = {
      id: crypto.randomUUID(),
      variant,
      text: '',
      position: { x: pos.flowX, y: pos.flowY },
    };
    addPromptNode(newPromptNode);
    setPaneMenu(null);
  }, [paneMenu, addPromptNode]);

  // ★ 自由添加素材确认 → 创建独立节点（持久化到后端）
  const handleFreeAddConfirm = useCallback((materials: SelectedMaterial[], _placement: PlacementStrategy) => {
    if (materials.length === 0) return;
    const basePos = paneMenu || { flowX: 200, flowY: 100 };
    
    const newFreeNodes = materials.map((m, idx) => {
      const mat = m.material;
      const isImage = mat.file_type === 'image';
      const defaultDurationMs = isImage ? 3000 : 5000;
      const durationMs = mat.duration || defaultDurationMs;
      
      let materialAspectRatio: '16:9' | '9:16' | 'vertical' | 'horizontal' | undefined;
      if (mat.width && mat.height) {
        materialAspectRatio = mat.height > mat.width ? '9:16' : '16:9';
      }
      const nodeWidth = getNodeWidth(materialAspectRatio || aspectRatio);
      
      return {
        id: crypto.randomUUID(),
        mediaType: isImage ? 'image' as const : 'video' as const,
        thumbnail: mat.thumbnail_url || (isImage ? mat.url : undefined),
        videoUrl: isImage ? undefined : mat.url,
        assetId: mat.id,
        duration: durationMs / 1000,
        aspectRatio: materialAspectRatio,
        position: {
          x: basePos.flowX + idx * (nodeWidth + 40),
          y: basePos.flowY,
        },
      };
    });
    
    addFreeNodes(newFreeNodes);
    setShowMaterialPicker(false);
    setIsFreeAddMode(false);
  }, [paneMenu, aspectRatio, addFreeNodes]);

  // 获取选中的 Clip 数据
  const selectedClipData = useMemo((): ClipNodeData | null => {
    if (!selectedNodeId) return null;
    const node = nodes.find(n => n.id === selectedNodeId);
    return (node?.data as ClipNodeData) || null;
  }, [selectedNodeId, nodes]);

  // AI 能力选择处理
  const handleSelectCapability = useCallback((capability: AICapability) => {
    console.log('选择 AI 能力:', capability.id, '应用到 Clip:', selectedNodeId);
    
    // 需要配置的能力，打开关键帧编辑器
    if (capability.requiresConfig) {
      setSelectedCapability(capability);
      setShowKeyframeEditor(true);
      closeSidebar();
    } else {
      // 不需要配置的能力，直接执行
      alert(`即将直接执行: ${capability.name}`);
    }
  }, [selectedNodeId, closeSidebar]);

  // ★ 监听右键菜单直接触发的 AI 能力事件
  useEffect(() => {
    const handleOpenCapability = (e: Event) => {
      const { clipId, capabilityId } = (e as CustomEvent).detail;
      console.log('[WorkflowCanvas] 收到 open-capability 事件:', capabilityId, clipId);
      setSelectedNodeId(clipId);
      const cap = AI_CAPABILITIES.find(c => c.id === capabilityId);
      if (cap) {
        handleSelectCapability(cap);
      }
    };
    window.addEventListener('open-capability', handleOpenCapability);
    return () => window.removeEventListener('open-capability', handleOpenCapability);
  }, [handleSelectCapability]);

  // ★ 监听 "多图生成" 右键菜单事件：收集该节点的上游连线链，打开 GenerationComposer
  // 例：图1→图2→图3，图3触发多图生成 → 输入为 [图1, 图2, 图3]
  // 例：图1→图2，图2触发多图生成 → 输入为 [图1, 图2]
  useEffect(() => {
    const handleMultiGeneration = (e: Event) => {
      const { clipId } = (e as CustomEvent).detail;
      // ★★ 只取上游节点（沿箭头方向回溯），不取下游
      const rawUpstreamIds = getUpstreamChain(clipId);
      // ★ 过滤掉 PromptNode ID（文本指令节点不参与素材排列）
      const pnIds = new Set(useVisualEditorStore.getState().promptNodes.map(p => p.id));
      const upstreamIds = rawUpstreamIds.filter(id => !pnIds.has(id));
      // 上游从远到近 → 反转为正序（远的排前面），再加上当前节点
      const nodeIds = [...[...upstreamIds].reverse(), clipId];
      if (nodeIds.length >= 2) {
        handleCycleGeneration(nodeIds);
      } else {
        // 没有上游连线，只有自身 → 弹出普通 AI 生成
        setGenerationPair(buildUpstreamGenerationPair(clipId));
        setGenerationTargetClipId(clipId);
        setGenerationInitCapability(undefined);
        setShowGenerationComposer(true);
        closeSidebar();
      }
    };
    window.addEventListener('open-multi-generation', handleMultiGeneration);
    return () => window.removeEventListener('open-multi-generation', handleMultiGeneration);
  }, [getUpstreamChain, handleCycleGeneration, buildUpstreamGenerationPair, closeSidebar]);

  // ★ 监听 "复制节点" 右键菜单事件
  useEffect(() => {
    const handleDuplicateNode = (e: Event) => {
      const { clipId, isFreeNode } = (e as CustomEvent).detail;
      if (isFreeNode) {
        // 自由节点：从 store 中找到原节点数据，添加一个新的自由节点（偏移 30px）
        const fn = freeNodes.find(n => n.id === clipId);
        if (fn) {
          const newNode: FreeNode = {
            id: `free-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            mediaType: fn.mediaType,
            thumbnail: fn.thumbnail,
            videoUrl: fn.videoUrl,
            assetId: fn.assetId,
            duration: fn.duration,
            aspectRatio: fn.aspectRatio,
            position: { x: fn.position.x + 30, y: fn.position.y + 30 },
          };
          addFreeNodes([newNode]);
        }
      } else {
        // 序列节点：将其作为自由节点副本放到画布上（偏移到右下方）
        const shot = shots.find(s => s.id === clipId);
        if (shot) {
          // 获取该节点在画布上的大致位置
          const nodeElem = document.querySelector(`[data-id="${clipId}"]`);
          let posX = 200;
          let posY = 300;
          if (nodeElem && rfInstanceRef.current) {
            const rect = nodeElem.getBoundingClientRect();
            const flowPos = rfInstanceRef.current.screenToFlowPosition({ x: rect.right + 20, y: rect.top + 20 });
            posX = flowPos.x;
            posY = flowPos.y;
          }
          const newNode: FreeNode = {
            id: `free-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            mediaType: (shot.mediaType as 'video' | 'image') || 'video',
            thumbnail: shot.thumbnail,
            videoUrl: shot.videoUrl || shot.replacedVideoUrl,
            assetId: shot.assetId || createAssetId(),
            duration: shot.endTime - shot.startTime,
            aspectRatio: (shot as any).aspectRatio,
            position: { x: posX, y: posY },
          };
          addFreeNodes([newNode]);
        }
      }
    };
    window.addEventListener('duplicate-node', handleDuplicateNode);
    return () => window.removeEventListener('duplicate-node', handleDuplicateNode);
  }, [freeNodes, shots, addFreeNodes]);

  // ★ 监听「抽帧」事件：视频节点 -> 多个图片自由节点
  useEffect(() => {
    const extractingClipIds = new Set<string>();

    const handleExtractFrames = async (e: Event) => {
      const { clipId } = (e as CustomEvent<{ clipId?: string }>).detail || {};
      if (!clipId) return;

      if (extractingClipIds.has(clipId)) {
        toast.info('该节点正在抽帧，请稍候');
        return;
      }

      extractingClipIds.add(clipId);
      toast.info('正在抽帧，请稍候...');

      try {
        const sourceNode = nodes.find((n) => n.id === clipId || (n.data as ClipNodeData)?.clipId === clipId);
        const sourceWidth = sourceNode?.measured?.width || 220;
        const baseX = (sourceNode?.position?.x ?? 180) + sourceWidth + 50;
        const baseY = sourceNode?.position?.y ?? 140;

        const sourceShot = shots.find((s) => s.id === clipId);
        const sourceFreeNode = freeNodes.find((n) => n.id === clipId);
        const sourceAspectRatio = ((sourceShot as any)?.aspectRatio || sourceFreeNode?.aspectRatio || aspectRatio) as FreeNode['aspectRatio'];
        const sourceDuration = sourceShot
          ? Math.max(sourceShot.endTime - sourceShot.startTime, 1.5)
          : Math.max(sourceFreeNode?.duration || 3, 1.5);

        const result = await extractFramesFromClip(clipId, { frame_count: 6 });
        if (!result.frames?.length) {
          toast.warning('未提取到可用画面帧');
          return;
        }

        const columnCount = 4;
        const gapX = 180;
        const gapY = 120;

        const frameNodes: FreeNode[] = result.frames.map((frame, idx) => {
          const col = idx % columnCount;
          const row = Math.floor(idx / columnCount);
          const nodeId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
              const r = Math.floor(Math.random() * 16);
              const v = ch === 'x' ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            });

          return {
            id: nodeId,
            mediaType: 'image',
            thumbnail: frame.image_url,
            assetId: frame.asset_id,
            duration: sourceDuration,
            aspectRatio: sourceAspectRatio,
            position: {
              x: baseX + col * gapX,
              y: baseY + row * gapY,
            },
          };
        });

        await addFreeNodes(frameNodes);
        toast.success(`抽帧完成，已添加 ${frameNodes.length} 张画面`);
      } catch (error) {
        console.error('[WorkflowCanvas] 抽帧失败:', error);
        toast.error(error instanceof Error ? error.message : '抽帧失败，请重试');
      } finally {
        extractingClipIds.delete(clipId);
      }
    };

    window.addEventListener('extract-frames', handleExtractFrames);
    return () => window.removeEventListener('extract-frames', handleExtractFrames);
  }, [nodes, shots, freeNodes, aspectRatio, addFreeNodes]);

  // ★ 监听「打开/预览」事件
  useEffect(() => {
    const handlePreviewMedia = (e: Event) => {
      const { url, mediaType } = (e as CustomEvent).detail;
      if (url) {
        setPreviewMedia({ url, mediaType: mediaType || 'video' });
      }
    };
    window.addEventListener('preview-media', handlePreviewMedia);
    return () => window.removeEventListener('preview-media', handlePreviewMedia);
  }, []);

  // ★ 监听「锁定/解锁」事件
  useEffect(() => {
    const handleToggleLock = (e: Event) => {
      const { clipId, locked } = (e as CustomEvent).detail;
      if (clipId) {
        useVisualEditorStore.getState().toggleNodeLock(clipId, locked);
      }
    };
    window.addEventListener('toggle-lock-node', handleToggleLock);
    return () => window.removeEventListener('toggle-lock-node', handleToggleLock);
  }, []);

  // ★ 监听节点右键「添加素材」事件 → 打开 MaterialPickerModal（自由模式，定位到该节点附近）
  useEffect(() => {
    const handleAddMaterialNear = (e: Event) => {
      const { clipId } = (e as CustomEvent).detail;
      // 找到该节点的位置，以便把新素材放在它旁边
      const sourceNode = nodes.find(n => n.id === clipId || (n.data as ClipNodeData)?.clipId === clipId);
      if (sourceNode) {
        const nodeWidth = sourceNode.measured?.width || 200;
        setPaneMenu({ x: 0, y: 0, flowX: (sourceNode.position?.x ?? 200) + nodeWidth + 40, flowY: sourceNode.position?.y ?? 100 });
      }
      setIsFreeAddMode(true);
      setShowMaterialPicker(true);
    };
    window.addEventListener('add-material-near-node', handleAddMaterialNear);
    return () => window.removeEventListener('add-material-near-node', handleAddMaterialNear);
  }, [nodes]);

  // ★ 监听节点左右 + 号添加节点事件（先弹选择框：素材库 or 本地上传）
  useEffect(() => {
    const handleAddBefore = (e: Event) => {
      const { clipId, anchorX, anchorY } = (e as CustomEvent<{ clipId: string; anchorX?: number; anchorY?: number }>).detail;
      console.log('[WorkflowCanvas] 添加节点（左侧）, before:', clipId);

      const idx = shots.findIndex((s) => s.id === clipId);
      if (idx < 0) return;

      window.dispatchEvent(new CustomEvent('workflow-close-all-menus'));

      const sourceId = idx === 0 ? '__before_first__' : shots[idx - 1].id;
      const targetId = clipId;

      setIsFreeAddMode(false);
      setInsertPosition(null);
      setPendingQuickInsert(null);
      setInsertActionMenu({
        x: typeof anchorX === 'number' ? anchorX : window.innerWidth / 2,
        y: typeof anchorY === 'number' ? anchorY : window.innerHeight / 2,
        sourceId,
        targetId,
      });
    };

    const handleAddAfter = (e: Event) => {
      const { clipId, anchorX, anchorY } = (e as CustomEvent<{ clipId: string; anchorX?: number; anchorY?: number }>).detail;
      console.log('[WorkflowCanvas] 添加节点（右侧）, after:', clipId);

      const idx = shots.findIndex((s) => s.id === clipId);
      if (idx < 0) return;

      window.dispatchEvent(new CustomEvent('workflow-close-all-menus'));

      const sourceId = clipId;
      const targetId = idx === shots.length - 1 ? '__after_last__' : shots[idx + 1].id;

      setIsFreeAddMode(false);
      setInsertPosition(null);
      setPendingQuickInsert(null);
      setInsertActionMenu({
        x: typeof anchorX === 'number' ? anchorX : window.innerWidth / 2,
        y: typeof anchorY === 'number' ? anchorY : window.innerHeight / 2,
        sourceId,
        targetId,
      });
    };

    window.addEventListener('add-node-before', handleAddBefore);
    window.addEventListener('add-node-after', handleAddAfter);
    return () => {
      window.removeEventListener('add-node-before', handleAddBefore);
      window.removeEventListener('add-node-after', handleAddAfter);
    };
  }, [shots]);

  // 关键帧编辑器生成预览处理 - ★ 治标治本：添加任务到历史
  const handleGenerate = useCallback(async (params: GenerateParams): Promise<GenerateResult> => {
    console.log('[WorkflowCanvas] 生成预览参数:', params);
    
    // ★ 治本：获取 session token 用于鉴权
    const session = await getSessionSafe();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    
    // 调用后端 API 生成预览
    const response = await fetch('/api/ai-capabilities/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        capability_type: params.capabilityId,
        clip_id: params.clipId,
        project_id: projectId,
        prompt: params.prompt,
        keyframe_url: params.keyframeUrl,
        mask_data_url: params.maskDataUrl,
        provider: params.provider,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '预览生成失败');
    }
    
    const task = await response.json();
    console.log('[WorkflowCanvas] 预览任务已创建:', task);
    
    const taskId = task.id;
    
    // ★ 治标治本：立即添加任务到历史侧边栏（乐观更新）
    const taskType = params.capabilityId.replace(/-/g, '_');
    console.log('[WorkflowCanvas] ★ 添加预览任务到历史:', taskId, '类型:', taskType);
    addOptimisticTask({
      id: taskId,
      task_type: taskType,
      status: 'processing',
      progress: 0,
      status_message: '正在生成预览...',
      clip_id: params.clipId,
      project_id: projectId,
      input_params: {
        prompt: params.prompt,
        clip_id: params.clipId,
        project_id: projectId,
      },
    });
    
    // 轮询等待任务完成
    const maxWaitTime = 120000; // 2 分钟超时
    const pollInterval = 2000; // 2 秒轮询一次
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // 查询任务状态（复用相同的 headers）
      const statusResponse = await fetch(`/api/ai-capabilities/tasks/${taskId}`, { headers });
      if (!statusResponse.ok) {
        throw new Error('查询任务状态失败');
      }
      
      const taskStatus = await statusResponse.json();
      console.log('[WorkflowCanvas] 任务状态:', taskStatus.status, taskStatus.result_url);
      
      // ★ 治本：更新任务进度
      if (taskStatus.progress) {
        updateTask(taskId, {
          progress: taskStatus.progress,
          status_message: taskStatus.status_message || `${taskStatus.progress}%`,
        });
      }
      
      if (taskStatus.status === 'completed' && taskStatus.result_url) {
        // ★ 治本：更新任务为完成状态
        updateTask(taskId, {
          status: 'completed',
          progress: 100,
          output_url: taskStatus.result_url,
          completed_at: new Date().toISOString(),
        });
        
        // ★ 返回意图信息给前端显示
        return {
          previewUrl: taskStatus.result_url,
          taskId: taskId,
          intent: taskStatus.intent,  // ★ 新增：意图分类信息
        };
      }
      
      if (taskStatus.status === 'failed') {
        // ★ 治本：更新任务为失败状态
        updateTask(taskId, {
          status: 'failed',
          error_message: taskStatus.error || 'AI 生成失败',
        });
        throw new Error(taskStatus.error || 'AI 生成失败');
      }
    }
    
    // ★ 超时也要更新任务状态
    updateTask(taskId, {
      status: 'failed',
      error_message: '生成超时，请重试',
    });
    throw new Error('生成超时，请重试');
  }, [projectId, addOptimisticTask, updateTask]);

  // 确认应用处理 - ★ 治标治本：所有能力统一走异步流程
  const handleConfirm = useCallback(async (params: ConfirmParams): Promise<void> => {
    console.log('[WorkflowCanvas] 确认应用参数:', params);
    
    if (!params.taskId) {
      throw new Error('缺少任务 ID，无法应用预览结果');
    }

    const taskType = selectedCapability?.id || 'unknown';
    const isBackgroundReplace = taskType === 'background-replace';
    
    // ★ 治本：在关闭弹窗前保存需要的数据（避免闭包问题）
    console.log('[WorkflowCanvas] ★ 调试 selectedClipData (关闭前):', {
      hasData: !!selectedClipData,
      clipId: selectedClipData?.clipId,
      duration: selectedClipData?.duration,
      startTime: selectedClipData?.startTime,
      endTime: selectedClipData?.endTime,
    });
    const clipData = selectedClipData;
    const currentProjectId = projectId;
    
    // ★ 核心：先关闭弹窗，再异步执行任务（用户体验优先）
    setShowKeyframeEditor(false);
    setSelectedCapability(null);
    
    // ★ 乐观更新 - 立即在侧边栏显示任务
    const localTaskId = params.taskId || `optimistic-${Date.now()}`;
    console.log('[WorkflowCanvas] ★ 添加乐观任务:', localTaskId, '类型:', taskType);
    setActiveTaskId(localTaskId);  // ★ 保存任务 ID，供 BackgroundReplaceProgress 使用
    addOptimisticTask({
      id: localTaskId,
      task_type: taskType.replace(/-/g, '_'),  // 转换为下划线格式
      status: 'pending',
      progress: 0,
      status_message: '正在处理...',
      clip_id: params.clipId,
      project_id: projectId,
    });
    
    // ★ Toast 通知代替自动弹出侧边栏（画布上已有 loading 节点）
    console.log('[WorkflowCanvas] ★ 任务已提交，显示 Toast');
    toast.info('🎨 AI 生成任务已提交，请稍候...');

    // 后台异步执行任务（不阻塞UI）- 使用已保存的变量
    (async () => {
      try {
        if (isBackgroundReplace) {
          // 背景替换专用工作流
          console.log('[WorkflowCanvas] 启动背景替换 Agent Workflow');
          
          const videoUrl = clipData?.assetId 
            ? `${process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:8000'}/api/assets/${clipData.assetId}/video`
            : '';
          
          if (!videoUrl) {
            throw new Error('无法获取视频 URL');
          }

          // ★★★ 智能分片：传递时长和转写文本 ★★★
          // 计算 clip 时长（毫秒）- 必须有值
          if (!clipData?.duration || clipData.duration <= 0) {
            console.error('[WorkflowCanvas] ❌ clipData 缺少 duration:', clipData);
            throw new Error('无法获取 clip 时长信息，请刷新页面重试');
          }
          const durationMs = Math.round(clipData.duration * 1000);  // 秒转毫秒
          
          console.log('[WorkflowCanvas] ★ 调试 clipData:', {
            clipId: clipData.clipId,
            duration: clipData.duration,
            startTime: clipData.startTime,
            endTime: clipData.endTime,
            durationMs,
            transcript: clipData.transcript?.slice(0, 30),
          });

          await backgroundWorkflow.startWorkflow({
            clipId: params.clipId,
            projectId: currentProjectId,
            videoUrl,
            backgroundImageUrl: params.previewUrl,
            originalPrompt: params.prompt,
            previewImageUrl: params.previewUrl,
            // ★★★ 智能分片参数 ★★★
            durationMs,
            transcript: clipData?.transcript,
          });
        } else {
          // 其他能力：调用 apply API
          const applySession = await getSessionSafe();
          const applyHeaders: HeadersInit = {
            'Content-Type': 'application/json',
          };
          if (applySession?.access_token) {
            applyHeaders['Authorization'] = `Bearer ${applySession.access_token}`;
          }
          
          const response = await fetch(`/api/ai-capabilities/tasks/${params.taskId}/apply`, {
            method: 'POST',
            headers: applyHeaders,
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '应用预览失败');
          }
          
          const task = await response.json();
          console.log('[WorkflowCanvas] 任务应用成功:', task);
          
          // 添加到 SSE 任务追踪
          addTask(task.id);
        }

        // 刷新任务列表获取真实状态
        if (currentProjectId) {
          setTimeout(() => fetchTasks(currentProjectId), 500);
        }
      } catch (error) {
        console.error('[WorkflowCanvas] 任务执行失败:', error);
        // ★★★ 治本修复：更新乐观任务为失败状态 ★★★
        const errorMessage = error instanceof Error ? error.message : '任务执行失败';
        updateTask(localTaskId, {
          status: 'failed',
          error_message: errorMessage,
        });
        // 刷新任务列表获取真实状态
        if (currentProjectId) {
          fetchTasks(currentProjectId);
        }
      }
    })();

  }, [addTask, selectedCapability, selectedClipData, projectId, backgroundWorkflow, fetchTasks, addOptimisticTask, updateTask]);

  // 获取关键帧 URL（★ 优先使用 thumbnail，否则尝试其他来源）
  const getKeyframeUrl = useCallback(() => {
    // 1. 优先使用 clip 的 thumbnail
    if (selectedClipData?.thumbnail) {
      console.log('[WorkflowCanvas] 使用 clip thumbnail:', selectedClipData.thumbnail);
      return selectedClipData.thumbnail;
    }
    
    // 2. 尝试从 shots 获取
    const shot = shots.find(s => s.id === selectedNodeId);
    if (shot?.thumbnail) {
      console.log('[WorkflowCanvas] 使用 shot thumbnail:', shot.thumbnail);
      return shot.thumbnail;
    }
    
    // 3. 没有可用的关键帧
    console.warn('[WorkflowCanvas] 没有找到可用的关键帧 URL, clipData:', selectedClipData);
    return '';  // 返回空字符串，让 DrawingCanvas 显示错误状态
  }, [selectedClipData, shots, selectedNodeId]);

  // ★ 画布级拖放：文件拖到画布空白区域 → 追加到最后一个节点之后
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    // 只在拖入文件时响应（排除 ReactFlow 节点拖拽）
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      setIsCanvasDragOver(true);
    }
  }, []);

  const handleCanvasDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsCanvasDragOver(false);
  }, []);

  const handleCanvasDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsCanvasDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(
      f => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (files.length === 0) return;

    // 找到最后一个 shot 的 id，追加在其后
    const lastShotId = shots.length > 0 ? shots[shots.length - 1].id : null;
    if (!lastShotId) return;

    await handleQuickUpload(lastShotId, '', files);
  }, [shots, handleQuickUpload]);

  const syncViewportToStore = useCallback((zoom: number, x: number, y: number) => {
    setViewportZoom(zoom);
    setCanvasZoom(zoom);
    setCanvasPan(x, y);
  }, [setCanvasZoom, setCanvasPan]);

  const handleMoveEnd = useCallback((_: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
    syncViewportToStore(viewport.zoom, viewport.x, viewport.y);
  }, [syncViewportToStore]);

  const toolbarBottomOffset = useMemo(() => {
    if (timelinePanelState === 'expanded') return 140;
    if (timelinePanelState === 'half') return 104;
    return 72;
  }, [timelinePanelState]);

  const currentZoomPercent = Math.round(viewportZoom * 100);
  const zoomOptions = useMemo(() => {
    return Array.from(new Set([...ZOOM_PRESETS, currentZoomPercent])).sort((a, b) => a - b);
  }, [currentZoomPercent]);

  const applyZoomPercent = useCallback((targetPercent: number) => {
    const instance = rfInstanceRef.current;
    if (!instance) return;
    const clampedPercent = Math.max(20, Math.min(200, targetPercent));
    const targetZoom = clampedPercent / 100;
    const viewport = instance.getViewport();
    instance.setViewport({ ...viewport, zoom: targetZoom }, { duration: 120 });
    syncViewportToStore(targetZoom, viewport.x, viewport.y);
  }, [syncViewportToStore]);

  const applyFitView = useCallback(() => {
    const instance = rfInstanceRef.current;
    if (!instance) return;
    instance.fitView({
      padding: 0.2,
      maxZoom: 1,
      duration: 160,
    });
    const viewport = instance.getViewport();
    syncViewportToStore(viewport.zoom, viewport.x, viewport.y);
  }, [syncViewportToStore]);

  const handleZoomPresetChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value === 'fit') {
      applyFitView();
      return;
    }
    const nextPercent = Number(value);
    if (!Number.isFinite(nextPercent)) return;
    applyZoomPercent(nextPercent);
  }, [applyFitView, applyZoomPercent]);

  return (
    <div
      className={`relative w-full h-full bg-gray-50 transition-colors duration-150 ${isCanvasDragOver ? 'ring-2 ring-gray-400 ring-inset bg-gray-50/50' : ''}`}
      onDragOver={handleCanvasDragOver}
      onDragLeave={handleCanvasDragLeave}
      onDrop={handleCanvasDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={handleEdgesChange}
        onBeforeDelete={handleBeforeDelete}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onDoubleClick={handlePaneDoubleClick}
        onSelectionChange={onSelectionChange}
        onInit={(instance) => {
          rfInstanceRef.current = instance;
          const viewport = instance.getViewport();
          syncViewportToStore(viewport.zoom, viewport.x, viewport.y);
        }}
        onMoveEnd={handleMoveEnd}
        onNodeDrag={(e, node) => onNodeDrag(e, node, nodes)}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        panOnDrag={interactionMode === 'pan'}
        selectionOnDrag={interactionMode === 'select'}
        nodesDraggable={interactionMode === 'select'}
        elementsSelectable={interactionMode === 'select'}
        edgesFocusable
        style={interactionMode === 'pan' ? { cursor: 'grab' } : undefined}
        snapToGrid
        snapGrid={[20, 20]}
        fitView
        fitViewOptions={{
          padding: 0.2,
          maxZoom: 1,
        }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'simple',
          interactionWidth: 20,
        }}
        proOptions={{ hideAttribution: true }}
      >
        {/* 背景网格 */}
        <Background 
          variant={BackgroundVariant.Dots} 
          gap={20}
          size={1}
          color="#cbd5e1"
        />
        
        {/* ★ 对齐参考线 */}
        <AlignmentGuides guideLines={guideLines} />

        {/* ★ 闭环中心 + 按钮 */}
        {detectedCycles.map(cycle => (
          <CycleCenterButton
            key={cycle.key}
            cycle={cycle}
            onOpenGeneration={handleCycleGeneration}
            onRelayout={relayoutCycle}
          />
        ))}
        
        {/* 画布交互工具栏（框选 / 拖动画布 / 撤销重做 / 缩放） */}
        <Panel
          position="bottom-center"
          className="!m-0 !z-30"
          style={{ bottom: `${toolbarBottomOffset}px` }}
        >
          <div className="flex items-center gap-1 rounded-2xl border border-gray-200/90 bg-white/95 px-2 py-1.5 text-gray-700 shadow-xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => setInteractionMode('select')}
              className={`h-9 w-9 rounded-lg border transition-colors ${
                interactionMode === 'select'
                  ? 'border-gray-300 bg-gray-100 text-gray-900'
                  : 'border-transparent text-gray-500 hover:bg-gray-100'
              }`}
              title="框选模式"
            >
              <MousePointer2 size={16} className="mx-auto" />
            </button>
            <button
              type="button"
              onClick={() => setInteractionMode('pan')}
              className={`h-9 w-9 rounded-lg border transition-colors ${
                interactionMode === 'pan'
                  ? 'border-gray-300 bg-gray-100 text-gray-900'
                  : 'border-transparent text-gray-500 hover:bg-gray-100'
              }`}
              title="拉动画布"
            >
              <Hand size={16} className="mx-auto" />
            </button>

            <div className="mx-1 h-6 w-px bg-gray-200" />

            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              className="h-9 w-9 rounded-lg text-gray-500 transition-colors enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
              title="撤销"
            >
              <Undo2 size={16} className="mx-auto" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              className="h-9 w-9 rounded-lg text-gray-500 transition-colors enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
              title="前进一步"
            >
              <Redo2 size={16} className="mx-auto" />
            </button>

            <div className="mx-1 h-6 w-px bg-gray-200" />

            <div className="relative">
              <select
                value={String(currentZoomPercent)}
                onChange={handleZoomPresetChange}
                className="h-9 appearance-none rounded-lg bg-transparent pl-2.5 pr-7 text-sm font-medium text-gray-700 outline-none hover:bg-gray-100"
                title="画布缩放"
              >
                {zoomOptions.map((percent) => (
                  <option key={percent} value={String(percent)} className="bg-white text-gray-700">{percent}%</option>
                ))}
                <option value="fit" className="bg-white text-gray-700">适配屏幕</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>

          </div>
        </Panel>

        {/* ★ 批量操作浮动工具栏 — 多选 ≥2 个 clip 节点时显示 */}
        {selectedNodeIds.length >= 2 && (
          <Panel
            position="bottom-center"
            className="!m-0 !z-40"
            style={{ bottom: `${toolbarBottomOffset + 52}px` }}
          >
            <div className="flex items-center gap-1 rounded-2xl border border-gray-300/80 bg-white/95 px-3 py-1.5 shadow-xl backdrop-blur-md animate-slide-up-fade-in">
              {/* 选中计数 */}
              <span className="text-xs font-medium text-gray-700 tabular-nums mr-1">
                已选 {selectedNodeIds.length} 项
              </span>

              <div className="mx-1 h-6 w-px bg-gray-200" />

              {/* 对齐 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAlignMenu(!showAlignMenu)}
                  className="h-8 px-2.5 rounded-lg text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors flex items-center gap-1"
                  title="对齐"
                >
                  <AlignCenterVertical size={14} />
                  <span>对齐</span>
                  <ChevronDown size={12} />
                </button>
                {showAlignMenu && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-xl border border-gray-200 bg-white shadow-xl p-1.5 grid grid-cols-3 gap-0.5 w-[144px] animate-fade-in-zoom">
                    <button onClick={() => handleBatchAlign('left')} className="h-9 w-10 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors" title="左对齐">
                      <AlignStartVertical size={15} className="text-gray-600" />
                    </button>
                    <button onClick={() => handleBatchAlign('center-h')} className="h-9 w-10 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors" title="水平居中">
                      <AlignCenterVertical size={15} className="text-gray-600" />
                    </button>
                    <button onClick={() => handleBatchAlign('right')} className="h-9 w-10 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors" title="右对齐">
                      <AlignEndVertical size={15} className="text-gray-600" />
                    </button>
                    <button onClick={() => handleBatchAlign('top')} className="h-9 w-10 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors" title="顶对齐">
                      <AlignStartHorizontal size={15} className="text-gray-600" />
                    </button>
                    <button onClick={() => handleBatchAlign('center-v')} className="h-9 w-10 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors" title="垂直居中">
                      <AlignCenterHorizontal size={15} className="text-gray-600" />
                    </button>
                    <button onClick={() => handleBatchAlign('bottom')} className="h-9 w-10 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors" title="底对齐">
                      <AlignEndHorizontal size={15} className="text-gray-600" />
                    </button>
                  </div>
                )}
              </div>

              {/* 锁定 / 解锁 */}
              {batchLockStatus !== 'all-locked' && (
                <button
                  type="button"
                  onClick={() => handleBatchToggleLock(true)}
                  className="h-8 px-2.5 rounded-lg text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors flex items-center gap-1"
                  title="锁定选中节点"
                >
                  <Lock size={14} />
                  <span>锁定</span>
                </button>
              )}
              {batchLockStatus !== 'all-unlocked' && (
                <button
                  type="button"
                  onClick={() => handleBatchToggleLock(false)}
                  className="h-8 px-2.5 rounded-lg text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors flex items-center gap-1"
                  title="解锁选中节点"
                >
                  <LockOpen size={14} />
                  <span>解锁</span>
                </button>
              )}

              <div className="mx-1 h-6 w-px bg-gray-200" />

              {/* 批量删除 */}
              <button
                type="button"
                onClick={handleBatchDelete}
                className="h-8 px-2.5 rounded-lg text-red-500 text-xs font-medium hover:bg-red-50 transition-colors flex items-center gap-1"
                title="删除选中节点"
              >
                <Trash2 size={14} />
                <span>删除</span>
              </button>

              <div className="mx-1 h-6 w-px bg-gray-200" />

              {/* 取消选择 */}
              <button
                type="button"
                onClick={handleClearSelection}
                className="h-8 w-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors flex items-center justify-center"
                title="取消选择"
              >
                <X size={14} />
              </button>
            </div>
          </Panel>
        )}

        {/* 控制按钮 */}
        <Controls
          showInteractive={false}
          className="!bg-white !border-gray-200 !shadow-lg !rounded-xl overflow-hidden"
        />
        
        {/* 小地图 */}
        <MiniMap 
          nodeColor={(node) => {
            if (node.id === selectedNodeId) return '#3b82f6';
            return '#e2e8f0';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          className="!bg-white !border-gray-200 !shadow-lg !rounded-xl"
        />

        {/* ★ 选中节点时的 AI 能力工具栏 */}
        {selectedNodeIds.length === 1 && (() => {
          const selId = selectedNodeIds[0];
          const selNode = nodes.find(n => n.id === selId && n.type === 'clip');
          const selData = selNode?.data as ClipNodeData | undefined;
          if (!selData || !selData.clipId || selData.isEmpty || selData.generatingTaskId) return null;
          // 只有有内容的节点才显示工具栏
          if (!selData.thumbnail && !selData.videoUrl) return null;
          return (
            <Panel position="top-center" className="!m-0 !mt-2 !z-30">
              <NodeSelectionToolbar
                clipId={selData.clipId}
                mediaType={selData.mediaType}
                thumbnail={selData.thumbnail}
                videoUrl={selData.videoUrl}
                duration={selData.duration}
                transcript={selData.transcript}
                isFreeNode={selData.isFreeNode}
                onOpenGeneration={(clipId: string, capabilityId?: string) => {
                  setGenerationPair(buildUpstreamGenerationPair(clipId));
                  const sourceShot = shots.find(s => s.id === clipId);
                  setGenerationTemplateId(sourceShot?.background?.templateId || undefined);
                  setGenerationTargetClipId(clipId);
                  setGenerationInitCapability(capabilityId);
                  setShowGenerationComposer(true);
                  closeSidebar();
                }}
                onSeparate={handleSeparate}
                onOpenCompositor={(clipId: string) => {
                  setCompositorClipId(clipId);
                  setShowCompositor(true);
                }}
              />
            </Panel>
          );
        })()}
        

      </ReactFlow>

      {/* ★ 关联类型选择器（关联模式下连线后弹出） */}
      {relationPicker && (
        <RelationTypePicker
          position={relationPicker.position}
          onSelect={(relationType: NodeRelationType) => {
            addRelation(
              relationPicker.sourceId,
              relationPicker.targetId,
              relationType,
            );
            setRelationPicker(null);
          }}
          onClose={() => setRelationPicker(null)}
        />
      )}
      
      {/* ★ 画布拖放提示覆盖层 */}
      {isCanvasDragOver && (
        <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl px-8 py-5 shadow-xl border-2 border-dashed border-gray-400 flex flex-col items-center gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="text-sm font-medium text-gray-700">松开以添加到画布末尾</span>
            <span className="text-xs text-gray-400">支持图片和视频文件</span>
          </div>
        </div>
      )}

      {/* AI 能力通过右键菜单直接触发，不再使用侧边栏 */}

      {/* 关键帧编辑器 */}
      {showKeyframeEditor && selectedCapability && selectedClipData && (
        <KeyframeEditor
          clip={selectedClipData}
          capability={selectedCapability}
          keyframeUrl={getKeyframeUrl()}
          projectId={projectId}
          onClose={() => {
            setShowKeyframeEditor(false);
            setSelectedCapability(null);
          }}
          onGenerate={handleGenerate}
          onConfirm={handleConfirm}
        />
      )}

      {/* ★ 媒体预览弹窗 */}
      {previewMedia && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPreviewMedia(null)}
        >
          <div
            className="relative max-w-[85vw] max-h-[85vh] rounded-xl overflow-hidden shadow-2xl bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
              onClick={() => setPreviewMedia(null)}
            >
              ✕
            </button>
            {previewMedia.mediaType === 'image' ? (
              <img
                src={previewMedia.url}
                alt="预览"
                className="max-w-[85vw] max-h-[85vh] object-contain"
              />
            ) : (
              <video
                src={previewMedia.url}
                controls
                autoPlay
                className="max-w-[85vw] max-h-[85vh]"
              />
            )}
          </div>
        </div>,
        document.body
      )}

      {/* AI 生成编排弹窗（边中 +） */}
      {showGenerationComposer && generationPair && (
        <GenerationComposerModal
          isOpen={showGenerationComposer}
          projectId={projectId}
          templateId={generationTemplateId}
          inputPair={generationPair}
          initialCapabilityId={generationInitCapability as GenerationCapabilityId}
          connectedPrompt={generationConnectedPrompt}
          onExtractPrompt={(text, variant) => {
            // ★ 在画布上创建 PromptNode，位置偏移到当前操作节点的左上方
            const basePos = { flowX: 100, flowY: 100 };
            // 尝试获取 fromClipId 节点的位置
            if (generationPair?.fromClipId) {
              const rfNode = nodes.find(n => n.id === generationPair.fromClipId);
              if (rfNode) {
                basePos.flowX = rfNode.position.x - 300;
                basePos.flowY = rfNode.position.y + (variant === 'negative' ? 180 : 0);
              }
            }
            const newPromptNode = {
              id: crypto.randomUUID(),
              variant,
              text,
              position: { x: basePos.flowX, y: basePos.flowY },
            };
            addPromptNode(newPromptNode);
          }}
          onClose={() => {
            setShowGenerationComposer(false);
            setGenerationPair(null);
            setGenerationTemplateId(undefined);
            setGenerationInitCapability(undefined);
            setGenerationTargetClipId(null);
          }}
          onSubmitted={async (event) => {
            console.log('[WorkflowCanvas] onSubmitted 触发，创建占位节点:', { taskId: event.taskId, capability: event.capabilityLabel });
            const eventClipId = event.sourceClipId || selectedClipData?.clipId || null;
            addOptimisticTask({
              id: event.taskId,
              task_type: event.capabilityId,
              status: 'pending',
              progress: 0,
              status_message: `AI 生成已提交：${event.capabilityLabel}`,
              clip_id: eventClipId || undefined,
              project_id: projectId,
              input_params: {
                clip_id: eventClipId || undefined,
                prompt: event.prompt,
                final_prompt: event.finalPrompt,
                capability_id: event.capabilityId,
                source_clip_id: event.sourceClipId,
                target_clip_id: event.targetClipId,
                input_nodes: event.inputNodes,
                payload_snapshot: event.payloadSnapshot,
              },
            });

            // ★ 立即在画布上创建一个"AI 生成中"的 FreeNode（或更新空节点）
            const sourceNode = nodesRef.current.find(n => n.id === eventClipId);
            const outputMediaType = event.outputType === 'image' ? 'image' : 'video';
            const sourceShot = shots.find(s => s.id === eventClipId);
            const sourceFreeNode = freeNodes.find(n => n.id === eventClipId);

            // ★ 检查是否从空节点触发 → 更新空节点而非创建新节点
            const emptyNodeId = generationPair?.toClipId;
            const emptyNode = emptyNodeId ? freeNodes.find(n => n.id === emptyNodeId && n.isEmpty) : null;

            if (emptyNode) {
              // ★ 空节点 → 转为 generating 状态
              let placeholderAssetId = createAssetId();
              if (projectId) {
                try {
                  const { assetApi } = await import('@/lib/api/assets');
                  const resp = await assetApi.createPlaceholderAsset({
                    project_id: projectId,
                    file_type: outputMediaType as 'video' | 'image',
                    name: `AI 生成：${event.capabilityLabel}`,
                  });
                  if (resp.data?.asset_id) placeholderAssetId = resp.data.asset_id;
                } catch (err) {
                  console.error('[WorkflowCanvas] ⚠️ 创建占位 asset 失败:', err);
                }
              }
              updateFreeNode(emptyNode.id, {
                isEmpty: false,
                mediaType: outputMediaType as 'video' | 'image',
                assetId: placeholderAssetId,
                generatingTaskId: event.taskId,
                generatingCapability: event.capabilityLabel,
              });
              console.log('[WorkflowCanvas] ✅ 空节点已转为生成中:', emptyNode.id);
            } else {
              // ★ 普通生成 → 创建新占位节点
              // ★★★ 先创建占位 asset 记录，获取真实 asset_id，避免 FK 约束报错 ★★★
              let placeholderAssetId = createAssetId(); // fallback
              if (projectId) {
                try {
                  const { assetApi } = await import('@/lib/api/assets');
                  const resp = await assetApi.createPlaceholderAsset({
                    project_id: projectId,
                    file_type: outputMediaType as 'video' | 'image',
                    name: `AI 生成：${event.capabilityLabel}`,
                  });
                  if (resp.data?.asset_id) {
                    placeholderAssetId = resp.data.asset_id;
                    console.log('[WorkflowCanvas] ✅ 占位 asset 已创建:', placeholderAssetId);
                  }
                } catch (err) {
                  console.error('[WorkflowCanvas] ⚠️ 创建占位 asset 失败，使用本地 UUID:', err);
                }
              }

              // ★ 优先使用 AI 生成请求中的 aspectRatio（用户选的），其次从 payloadSnapshot 中取，最后 fallback 到源节点
              const requestedAspectRatio = event.aspectRatio
                || (event.payloadSnapshot?.aspect_ratio as string)
                || (sourceShot as any)?.aspectRatio
                || sourceFreeNode?.aspectRatio
                || aspectRatio;
              const placeholderNode: FreeNode = {
                id: createAssetId(),
                mediaType: outputMediaType as 'video' | 'image',
                thumbnail: sourceShot?.thumbnail || sourceFreeNode?.thumbnail,
                assetId: placeholderAssetId,
                duration: 0,
                aspectRatio: requestedAspectRatio as any,
                position: {
                  x: (sourceNode?.position?.x ?? 400) + 360,
                  y: (sourceNode?.position?.y ?? 100),
                },
                generatingTaskId: event.taskId,
                generatingCapability: event.capabilityLabel,
              };
              addFreeNodes([placeholderNode]);
            }
            addTask(event.taskId);

            toast.info(`🎨 ${event.capabilityLabel} 任务已提交`);
            if (projectId) {
              fetchTasks(projectId);
            }
          }}
        />
      )}

      {/* ★ Compositor 全屏合成编辑器 */}
      {showCompositor && compositorClipId && (() => {
        // 查找对应素材的信息 — 从 store 中获取完整 Shot（包含 layers/artboard）
        const storeShots = useVisualEditorStore.getState().shots;
        const storeShot = storeShots.find(s => s.id === compositorClipId);
        const freeNode = freeNodes.find(n => n.id === compositorClipId);
        const compositorThumbnail = storeShot?.thumbnail || freeNode?.thumbnail;
        const compositorVideoUrl = storeShot?.videoUrl || storeShot?.replacedVideoUrl || freeNode?.videoUrl;
        const compositorMediaType = (storeShot?.mediaType || freeNode?.mediaType || 'image') as 'video' | 'image';
        const compositorLayers = storeShot?.layers;
        const compositorArtboard = storeShot?.artboard;
        return (
          <CompositorModal
            isOpen={showCompositor}
            clipId={compositorClipId}
            mediaType={compositorMediaType}
            thumbnail={compositorThumbnail}
            videoUrl={compositorVideoUrl}
            initialLayers={compositorLayers}
            artboardWidth={compositorArtboard?.width}
            artboardHeight={compositorArtboard?.height}
            projectId={projectId}
            onClose={() => {
              setShowCompositor(false);
              setCompositorClipId(null);
            }}
            onSave={(layers, artboardWidth, artboardHeight) => {
              // 将图层数据回写到 shot
              if (storeShot) {
                const { updateShotArtboard } = useVisualEditorStore.getState();
                // ★ 更新 artboard
                updateShotArtboard(compositorClipId, { x: 0, y: 0, width: artboardWidth, height: artboardHeight });
                // ★ 更新 layers — 直接通过 setShots 更新
                const currentShots = useVisualEditorStore.getState().shots;
                const updatedShots = currentShots.map(s =>
                  s.id === compositorClipId ? { ...s, layers } : s
                );
                useVisualEditorStore.getState().setShots(updatedShots);
              }
            }}
            onGenerate={handleGenerate}
            onConfirm={async (params) => {
              // 关闭合成器
              setShowCompositor(false);
              setCompositorClipId(null);
              // 更新素材缩略图为生成结果
              if (storeShot && params.previewUrl) {
                const currentShots = useVisualEditorStore.getState().shots;
                const updatedShots = currentShots.map(s =>
                  s.id === compositorClipId ? { ...s, thumbnail: params.previewUrl } : s
                );
                useVisualEditorStore.getState().setShots(updatedShots);
              }
            }}
          />
        );
      })()}

      {/* 模板候选弹窗 */}
      {showTemplateModal && (
        <TemplateCandidateModal
          isOpen={showTemplateModal}
          clipId={selectedClipData?.clipId || transitionPair?.fromClipId}
          projectId={projectId}
          transitionPair={transitionPair || undefined}
          onClose={() => {
            setShowTemplateModal(false);
            setSelectedCapability(null);
            setTransitionPair(null);
          }}
          onRendered={async (event) => {
            console.log('[WorkflowCanvas] onRendered 触发，创建占位节点:', { taskId: event.taskId, templateName: event.templateName });
            const eventClipId = event.sourceClipId || selectedClipData?.clipId || transitionPair?.fromClipId || null;
            if (event.templateId) {
              setGenerationTemplateId(event.templateId);
            }
            addOptimisticTask({
              id: event.taskId,
              task_type: event.endpoint,
              status: event.status as 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled',
              progress: 0,
              status_message: "模板生成已提交：" + (event.templateName || event.templateId),
              clip_id: eventClipId || undefined,
              project_id: projectId,
              input_params: {
                clip_id: eventClipId || undefined,
                template_id: event.templateId,
                template_name: event.templateName,
              },
            });

            // ★ 立即在画布上创建「AI 生成中」占位节点（与 GenerationComposerModal 路径一致）
            const sourceNode = nodesRef.current.find(n => n.id === eventClipId);
            const sourceShot = shots.find(s => s.id === eventClipId);
            const sourceFreeNode = freeNodes.find(n => n.id === eventClipId);
            // 多 variant 任务时，Y 方向错开避免重叠
            const existingGenCount = useVisualEditorStore.getState().freeNodes.filter(n => !!n.generatingTaskId).length;

            // ★★★ 先创建占位 asset 记录，获取真实 asset_id ★★★
            let placeholderAssetId = createAssetId(); // fallback
            if (projectId) {
              try {
                const { assetApi } = await import('@/lib/api/assets');
                const resp = await assetApi.createPlaceholderAsset({
                  project_id: projectId,
                  file_type: 'video',
                  name: `模板生成：${event.templateName || event.templateId}`,
                });
                if (resp.data?.asset_id) {
                  placeholderAssetId = resp.data.asset_id;
                  console.log('[WorkflowCanvas] ✅ 占位 asset 已创建:', placeholderAssetId);
                }
              } catch (err) {
                console.error('[WorkflowCanvas] ⚠️ 创建占位 asset 失败，使用本地 UUID:', err);
              }
            }

            const placeholderNode: FreeNode = {
              id: createAssetId(),
              mediaType: 'video',
              thumbnail: sourceShot?.thumbnail || sourceFreeNode?.thumbnail,
              assetId: placeholderAssetId,
              duration: 0,
              aspectRatio: (sourceShot as any)?.aspectRatio || sourceFreeNode?.aspectRatio || aspectRatio as any,
              position: {
                x: (sourceNode?.position?.x ?? 400) + 360,
                y: (sourceNode?.position?.y ?? 100) + existingGenCount * 260,
              },
              generatingTaskId: event.taskId,
              generatingCapability: event.templateName || event.templateId,
            };
            addFreeNodes([placeholderNode]);
            addTask(event.taskId);

            toast.info(`🎨 ${event.templateName || '模板'} 生成任务已提交`);
            if (projectId) {
              fetchTasks(projectId);
            }
          }}
        />
      )}

      {/* ★ 背景替换工作流进度 */}
      {backgroundWorkflow.state.isActive && backgroundWorkflow.state.workflowId && (
        <BackgroundReplaceProgress
          workflowId={backgroundWorkflow.state.workflowId}
          projectId={projectId || ''}
          taskId={activeTaskId || undefined}
          onComplete={async (resultUrl) => {
            console.log('[WorkflowCanvas] 背景替换完成:', resultUrl);
            
            // ★★★ 治本：更新 shot 的视频 URL，无需刷新页面 ★★★
            const clipId = backgroundWorkflow.state.clipId;
            if (clipId && resultUrl) {
              console.log('[WorkflowCanvas] ★ 更新 shot 视频:', { clipId, resultUrl: resultUrl.substring(0, 60) + '...' });
              try {
                // 从视频 URL 截取缩略图（可选，但推荐）
                await replaceShotVideo(clipId, resultUrl);
                console.log('[WorkflowCanvas] ✅ Shot 视频已更新');
              } catch (error) {
                console.error('[WorkflowCanvas] 更新 shot 视频失败:', error);
              }
            }
            
            backgroundWorkflow.reset();
            setActiveTaskId(null);
            // ★ 刷新任务列表获取最终状态
            if (projectId) fetchTasks(projectId);
          }}
          onError={(error) => {
            console.error('[WorkflowCanvas] 背景替换失败:', error);
            setActiveTaskId(null);
            if (projectId) fetchTasks(projectId);
          }}
          onClose={() => {
            backgroundWorkflow.reset();
          }}
        />
      )}

      {/* ★ TaskProgressPanel 已废弃，改用 TaskHistorySidebar 展示任务进度 */}

      {/* ★ 节点 + 号动作菜单：先选素材库 or 本地上传 */}
      <input
        ref={quickInsertInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={handleQuickInsertFileSelect}
      />
      {insertActionMenu && createPortal(
        <>
          <div
            className="fixed inset-0 z-[120]"
            onClick={() => setInsertActionMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setInsertActionMenu(null);
            }}
          />
          <div
            className="fixed z-[121] min-w-[220px] rounded-xl border border-gray-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur-sm"
            style={{ left: insertActionMenu.x, top: insertActionMenu.y }}
          >
            <button
              onClick={handleInsertMenuChooseMaterial}
              className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-50 group"
            >
              <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">选择素材</div>
              <div className="text-[11px] text-gray-400">从素材库中挑选并插入</div>
            </button>
            <button
              onClick={handleInsertMenuChooseUpload}
              className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-50 group"
            >
              <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">本地上传</div>
              <div className="text-[11px] text-gray-400">上传图片或视频并直接插入</div>
            </button>
          </div>
        </>,
        document.body
      )}

      {/* ★ 素材选择弹窗 */}
      <MaterialPickerModal
        isOpen={showMaterialPicker}
        onClose={() => {
          setShowMaterialPicker(false);
          setInsertPosition(null);
          setInsertActionMenu(null);
          setPendingQuickInsert(null);
          setIsFreeAddMode(false);
        }}
        onConfirm={isFreeAddMode ? handleFreeAddConfirm : handleMaterialConfirm}
        projectId={projectId}
        title={isFreeAddMode ? '添加素材到画布' : '选择要插入的素材'}
        showPlacement={!isFreeAddMode}
        defaultPlacement="canvas"
      />

      {/* ★ 画布右键菜单 — ComfyUI 风格 */}
      {paneMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setPaneMenu(null)} onContextMenu={(e) => { e.preventDefault(); setPaneMenu(null); }} />
          <div
            className="fixed z-[101] bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-200/80 py-1.5 min-w-[200px] animate-in fade-in-0 zoom-in-95 duration-150"
            style={{ left: paneMenu.x, top: paneMenu.y }}
          >
            {/* Import — 创建上传节点 */}
            <button
              onClick={handlePaneImport}
              className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <Upload size={15} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                  Import
                </div>
                <div className="text-[11px] text-gray-400">
                  上传本地文件到画布
                </div>
              </div>
            </button>

            <div className="mx-3 border-t border-gray-100" />

            {/* ★ Prompt 模板节点 */}
            <button
              onClick={() => handlePaneCreatePrompt('prompt')}
              className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <Sparkles size={15} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                  Prompt
                </div>
                <div className="text-[11px] text-gray-400">
                  创建可复用的提示词模板
                </div>
              </div>
            </button>

            {/* ★ Negative Prompt 模板节点 */}
            <button
              onClick={() => handlePaneCreatePrompt('negative')}
              className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <ShieldOff size={15} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                  Negative Prompt
                </div>
                <div className="text-[11px] text-gray-400">
                  创建排除关键词模板
                </div>
              </div>
            </button>

            {/* ★ 空节点 — 创建占位节点等待连线 */}
            <button
              onClick={handlePaneCreateEmptyNode}
              className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <Plus size={15} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                  空节点
                </div>
                <div className="text-[11px] text-gray-400">
                  创建占位节点，连线后生成
                </div>
              </div>
            </button>

            <div className="mx-3 border-t border-gray-100" />

            {/* 素材库 — 打开简化版素材选择弹窗 */}
            <button
              onClick={handlePaneAddMaterial}
              className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <FolderOpen size={15} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                  素材库
                </div>
                <div className="text-[11px] text-gray-400">
                  从已有素材中选择
                </div>
              </div>
            </button>

            {shots.length > 0 && (
              <>
                <div className="mx-3 border-t border-gray-100" />
                {/* 添加到序列末尾 */}
                <button
                  onClick={() => {
                    setPaneMenu(null);
                    const lastShot = shots[shots.length - 1];
                    setInsertPosition({ sourceId: lastShot.id, targetId: '' });
                    setShowMaterialPicker(true);
                  }}
                  className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                    <Plus size={15} className="text-gray-500" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                      添加到序列末尾
                    </div>
                    <div className="text-[11px] text-gray-400">
                      插入到主序列最后
                    </div>
                  </div>
                </button>
              </>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
