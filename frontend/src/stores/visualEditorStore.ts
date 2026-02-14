'use client';

import { create } from 'zustand';
import {
  VisualEditorState,
  DEFAULT_VISUAL_EDITOR_STATE,
  Shot,
  Layer,
  CanvasObject,
  ToolType,
  HistoryEntry,
  HistoryActionType,
  UndoableSnapshot,
  ShotBackground,
  Artboard,
  DEFAULT_ARTBOARD,
  TimelineSegment,
  TimelinePanelState,
  ProjectTimeline,
  DEFAULT_PROJECT_TIMELINE,
  SegmentMediaType,
  FreeNode,
  CanvasEdge,
  CanvasPromptNode,
} from '@/types/visual-editor';

// ==========================================
// Store 类型
// ==========================================

interface VisualEditorActions {
  // 初始化
  initialize: (projectId: string) => void;
  reset: () => void;
  
  // 分镜操作
  setShots: (shots: Shot[]) => void;
  setCurrentShot: (shotId: string) => void;
  updateShotBackground: (shotId: string, background: Partial<ShotBackground>) => void;
  updateShotArtboard: (shotId: string, artboard: Partial<Artboard>) => void;
  updateShotViewport: (shotId: string, viewportTransform: number[]) => void;
  // ★ 更新分镜的任意字段（如 generatingTaskId、thumbnail 等）
  updateShot: (shotId: string, updates: Partial<Shot>) => void;
  // ★ 替换分镜的视频 URL（可选同时更新缩略图）
  replaceShotVideo: (shotId: string, newVideoUrl: string, newThumbnailUrl?: string) => Promise<void>;
  // ★ 在指定位置插入新分镜（从素材库添加）
  insertShotsAfter: (afterShotId: string, newShots: Omit<Shot, 'index'>[], options?: { persist?: boolean }) => Promise<void>;
  // ★ 删除分镜
  deleteShot: (shotId: string) => Promise<void>;
  // ★ 更新分镜的前景蒙版 URL
  updateShotMask: (shotId: string, foregroundMaskUrl: string) => void;
  
  // ★ 批量删除节点（分镜 + 自由节点混合）
  batchDeleteNodes: (nodeIds: string[]) => Promise<void>;
  
  // ★ 自由节点操作（画布上独立于线性序列的素材）
  setFreeNodes: (nodes: FreeNode[]) => void;
  addFreeNodes: (nodes: FreeNode[]) => Promise<void>;
  removeFreeNode: (nodeId: string) => Promise<void>;
  updateFreeNode: (nodeId: string, updates: Partial<FreeNode>) => void;
  updateFreeNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  persistNodePosition: (nodeId: string, position: { x: number; y: number }) => void;  // ★ 仅持久化（序列节点用）

  // ★ 节点锁定
  isNodeLocked: (nodeId: string) => boolean;
  toggleNodeLock: (nodeId: string, locked: boolean) => void;
  
  // ★ 画布连线操作（自由节点间 / 自由节点与序列节点间）
  setCanvasEdges: (edges: CanvasEdge[]) => void;
  addCanvasEdge: (edge: CanvasEdge) => void;
  removeCanvasEdge: (edgeId: string) => void;
  
  // ★ Prompt 节点操作
  setPromptNodes: (nodes: CanvasPromptNode[]) => void;
  addPromptNode: (node: CanvasPromptNode) => Promise<void>;
  removePromptNode: (nodeId: string) => Promise<void>;
  updatePromptNode: (nodeId: string, updates: Partial<CanvasPromptNode>) => void;
  
  // 图层操作
  addLayer: (shotId: string, layer: Layer) => void;
  removeLayer: (shotId: string, layerId: string) => void;
  updateLayer: (shotId: string, layerId: string, updates: Partial<Layer>) => void;
  reorderLayers: (shotId: string, layerIds: string[]) => void;
  
  // 画布对象操作
  addObject: (shotId: string, layerId: string, object: CanvasObject) => void;
  removeObject: (shotId: string, layerId: string, objectId: string) => void;
  updateObject: (shotId: string, layerId: string, objectId: string, updates: Partial<CanvasObject>) => void;
  
  // 选择操作
  selectObjects: (objectIds: string[]) => void;
  clearSelection: () => void;
  
  // 工具操作
  setActiveTool: (tool: ToolType) => void;
  setBrushColor: (color: string) => void;
  setBrushSize: (size: number) => void;
  setFillColor: (color: string) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  
  // 画布操作
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;
  
  // 历史记录
  pushHistory: (action: HistoryActionType, description: string) => void;
  undo: () => void;
  redo: () => void;
  /** 跳转到历史中的指定位置 */
  jumpToHistory: (index: number) => void;
  /** 是否可撤销 */
  canUndo: () => boolean;
  /** 是否可重做 */
  canRedo: () => boolean;
  
  // UI 状态
  setLeftPanelTab: (tab: 'layers' | 'history') => void;
  setRightPanelTab: (tab: 'background' | 'properties') => void;
  setIsPlaying: (playing: boolean) => void;
  
  // ★ 侧边栏统一管理 - 同时只显示一个
  openSidebar: (sidebar: 'taskHistory' | 'aiCapability' | 'materialPicker', clipId?: string) => void;
  closeSidebar: () => void;
  toggleSidebar: (sidebar: 'taskHistory' | 'aiCapability' | 'materialPicker', clipId?: string) => void;
  
  // ==========================================
  // 主线 Timeline 操作
  // ==========================================
  
  /** 将画布节点加入主线末尾 */
  addToTimeline: (shotId: string) => void;
  /** 将画布节点插入主线指定位置之后 */
  insertIntoTimeline: (shotId: string, afterSegmentId: string) => void;
  /** 从主线移除段 */
  removeFromTimeline: (segmentId: string) => void;
  /** 拖拽重排主线段 */
  reorderTimeline: (segmentIds: string[]) => void;
  /** 替换主线段的来源节点 */
  replaceTimelineSegment: (segmentId: string, newShotId: string) => void;
  /** 切换 Timeline 面板折叠状态 */
  setTimelinePanelState: (state: TimelinePanelState) => void;
  /** 切换 Timeline 面板（展开/收起） */
  toggleTimelinePanel: () => void;
  /** 将所有画布节点按顺序加入主线 */
  addAllToTimeline: () => void;
  /** 清空主线 */
  clearTimeline: () => void;
  /** 检查某个 shot 是否已在主线中 */
  isInTimeline: (shotId: string) => boolean;
  /** 拆分段：在中点将一段拆为两段 */
  splitSegment: (segmentId: string) => void;
  /** 复制段：在原段后插入一份副本 */
  duplicateSegment: (segmentId: string) => void;
  /** 修改段时长 */
  updateSegmentDuration: (segmentId: string, newDurationMs: number) => void;
  /** 向前移动段（order - 1） */
  moveSegmentLeft: (segmentId: string) => void;
  /** 向后移动段（order + 1） */
  moveSegmentRight: (segmentId: string) => void;
  
  // 加载状态
  setIsLoading: (loading: boolean) => void;
  setIsAnalyzing: (analyzing: boolean) => void;
  setIsSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
}

type VisualEditorStore = VisualEditorState & VisualEditorActions;

// ==========================================
// 辅助函数
// ==========================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateUuidLike(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ensureNodeAssetId(node: FreeNode): FreeNode {
  // 空节点无需 assetId
  if (node.isEmpty) return node;
  // assetId 必须已存在（由调用方确保，AI 生成路径提前创建 placeholder asset）
  if (!node.assetId) {
    console.error('[VisualEditorStore] FreeNode 缺少 assetId, 这不应发生:', node.id);
  }
  return node;
}

/** 内部标记：当正在执行 undo/redo 恢复时为 true，此时 pushHistory 不应触发 */
let _isRestoring = false;

/** 从 store 中提取可撤销的状态快照 */
function _takeSnapshot(state: VisualEditorState): UndoableSnapshot {
  return {
    shots: JSON.parse(JSON.stringify(state.shots)),
    timeline: JSON.parse(JSON.stringify(state.timeline)),
    freeNodes: JSON.parse(JSON.stringify(state.freeNodes)),
    canvasEdges: JSON.parse(JSON.stringify(state.canvasEdges)),
  };
}

/** 将快照恢复到 store */
function _restoreSnapshot(snapshot: UndoableSnapshot): Partial<VisualEditorState> {
  return {
    shots: JSON.parse(JSON.stringify(snapshot.shots)),
    timeline: JSON.parse(JSON.stringify(snapshot.timeline)),
    freeNodes: JSON.parse(JSON.stringify(snapshot.freeNodes || [])),
    canvasEdges: JSON.parse(JSON.stringify(snapshot.canvasEdges || [])),
  };
}

// ==========================================
// ★ 节点位置防抖保存（自由节点 + 序列节点共用）
// ==========================================

const _positionTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function _debouncedPositionSave(projectId: string, nodeId: string, position: { x: number; y: number }) {
  const key = `${projectId}:${nodeId}`;
  const existing = _positionTimers.get(key);
  if (existing) clearTimeout(existing);
  
  _positionTimers.set(key, setTimeout(async () => {
    _positionTimers.delete(key);
    try {
      const { updateCanvasNode } = await import('@/lib/api/canvas-nodes');
      await updateCanvasNode(nodeId, { canvas_position: position });
    } catch (error) {
      console.error('[VisualEditorStore] 位置保存失败:', error);
    }
  }, 500));
}

// ==========================================
// ★ 画布连线持久化（保存到 canvas_edges 表）
// ==========================================

let _edgeSaveTimer: ReturnType<typeof setTimeout> | null = null;

async function _saveCanvasEdges(projectId: string, edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; relationType?: string; relationLabel?: string }[]) {
  if (_edgeSaveTimer) clearTimeout(_edgeSaveTimer);
  _edgeSaveTimer = setTimeout(async () => {
    try {
      const { syncCanvasEdges } = await import('@/lib/api/canvas-nodes');
      await syncCanvasEdges(projectId, edges.map(e => ({
        source_node_id: e.source,
        target_node_id: e.target,
        source_handle: e.sourceHandle || null,
        target_handle: e.targetHandle || null,
        relation_type: e.relationType || null,
        relation_label: e.relationLabel || null,
      })));
    } catch (error) {
      console.error('[VisualEditorStore] 连线保存失败:', error);
    }
  }, 300);
}

// ==========================================
// ★ Prompt 节点持久化（防抖）
// ==========================================

const _promptSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function _debouncedUpdatePromptNode(nodeId: string, getNode: () => CanvasPromptNode | undefined) {
  const existing = _promptSaveTimers.get(nodeId);
  if (existing) clearTimeout(existing);
  _promptSaveTimers.set(nodeId, setTimeout(async () => {
    _promptSaveTimers.delete(nodeId);
    const node = getNode();
    if (!node) return;
    try {
      const { updateCanvasNode } = await import('@/lib/api/canvas-nodes');
      await updateCanvasNode(nodeId, {
        canvas_position: node.position,
        metadata: { variant: node.variant, text: node.text },
      });
    } catch (err) {
      console.warn('[VisualEditorStore] Prompt 节点更新失败:', err);
    }
  }, 500));
}

// ==========================================
// Store 实现
// ==========================================

export const useVisualEditorStore = create<VisualEditorStore>()((set, get) => ({
  ...DEFAULT_VISUAL_EDITOR_STATE,
  
  // ==========================================
  // 初始化
  // ==========================================
  
  initialize: (projectId) => {
    // ★ 切换项目时必须清空所有旧数据，防止缓存污染
    set({
      ...DEFAULT_VISUAL_EDITOR_STATE,  // 重置为初始状态
      projectId,
      isLoading: false,  // 初始化时不设置 loading，由 loadProjectData 控制
      error: null,
    });
  },
  
  reset: () => {
    set(DEFAULT_VISUAL_EDITOR_STATE);
  },
  
  // ==========================================
  // 分镜操作
  // ==========================================
  
  setShots: (shots) => {
    set({
      shots,
      currentShotId: shots.length > 0 ? shots[0].id : null,
      isLoading: false,
    });
    // ★ 初始状态快照（作为历史记录的第 0 项，即“原始状态”）
    const state = get();
    const snapshot = _takeSnapshot(state);
    set({
      history: [{
        id: generateId(),
        timestamp: Date.now(),
        action: 'initial' as HistoryActionType,
        description: '初始状态',
        snapshot,
      }],
      historyIndex: 0,
    });
  },
  
  setCurrentShot: (shotId) => {
    set({ currentShotId: shotId });
  },
  
  updateShotBackground: (shotId, backgroundUpdates) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? { ...shot, background: { ...shot.background, ...backgroundUpdates } }
          : shot
      ),
    });
    get().pushHistory('change-background', '修改背景');
  },
  
  // ★ 通用分镜字段更新（用于 AI 生成完成后更新 thumbnail、videoUrl、清除 generatingTaskId 等）
  updateShot: (shotId, updates) => {
    const { shots } = get();
    set({
      shots: shots.map(shot =>
        shot.id === shotId ? { ...shot, ...updates } : shot
      ),
    });
  },
  
  updateShotArtboard: (shotId, artboardUpdates) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? { ...shot, artboard: { ...shot.artboard, ...artboardUpdates } }
          : shot
      ),
    });
  },
  
  updateShotViewport: (shotId, viewportTransform) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? { ...shot, viewportTransform }
          : shot
      ),
    });
  },
  
  // ★ 更新分镜的前景蒙版 URL
  updateShotMask: (shotId, foregroundMaskUrl) => {
    const { shots } = get();
    set({
      shots: shots.map(shot =>
        shot.id === shotId
          ? { ...shot, foregroundMaskUrl }
          : shot
      ),
    });
    get().pushHistory('modify-object', '更新前景蒙版');
  },
  
  // ==========================================
  // ★ 自由节点操作
  // ==========================================
  
  setFreeNodes: (nodes) => {
    set({ freeNodes: nodes.map(ensureNodeAssetId) });
  },
  
  addFreeNodes: async (nodes) => {
    const { freeNodes, projectId } = get();

    const normalizedNodes = nodes.map(ensureNodeAssetId);
    const generatedCount = normalizedNodes.filter((n, idx) => {
      const original = (nodes[idx].assetId || '').trim();
      return !original && !!n.assetId;
    }).length;
    if (generatedCount > 0) {
      console.warn(`[VisualEditorStore] 为 ${generatedCount} 个新节点自动补全 assetId`);
    }

    const merged = [...freeNodes, ...normalizedNodes];
    set({ freeNodes: merged });
    get().pushHistory('add-free-node', `添加 ${normalizedNodes.length} 个自由节点`);
    
    // 持久化到后端（带重试，canvas_nodes 必须创建成功）
    if (projectId) {
      const { batchCreateCanvasNodes } = await import('@/lib/api/canvas-nodes');
      const payload = normalizedNodes.map(n => ({
        id: n.id,
        asset_id: n.assetId || undefined,
        node_type: 'free' as const,
        media_type: n.mediaType,
        order_index: 0,
        start_time: 0,
        end_time: n.duration,
        duration: n.duration,
        canvas_position: n.position,
        video_url: n.videoUrl || null,
        thumbnail_url: n.thumbnail || null,
        metadata: {
          aspect_ratio: n.aspectRatio || null,
          generating_task_id: n.generatingTaskId || null,
          generating_capability: n.generatingCapability || null,
          is_empty: n.isEmpty || false,
        },
      }));

      let persisted = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await batchCreateCanvasNodes(projectId, payload);
          console.log('[VisualEditorStore] ✅ 自由节点持久化成功');
          persisted = true;
          break;
        } catch (error) {
          console.error(`[VisualEditorStore] 自由节点持久化失败 (attempt ${attempt}/3):`, error);
          if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
      if (!persisted) {
        // 持久化彻底失败 → 回滚前端状态，避免幽灵节点
        const nodeIds = new Set(normalizedNodes.map(n => n.id));
        set({ freeNodes: get().freeNodes.filter(n => !nodeIds.has(n.id)) });
        console.error('[VisualEditorStore] ❌ 自由节点持久化 3 次均失败，已回滚前端状态');
      }
    }
  },
  
  removeFreeNode: async (nodeId) => {
    const { freeNodes, canvasEdges, projectId } = get();
    // 同时移除相关连线
    set({
      freeNodes: freeNodes.filter(n => n.id !== nodeId),
      canvasEdges: canvasEdges.filter(e => e.source !== nodeId && e.target !== nodeId),
    });
    get().pushHistory('remove-free-node', '移除自由节点');
    
    // 持久化删除
    if (projectId) {
      try {
        const { deleteCanvasNode } = await import('@/lib/api/canvas-nodes');
        await deleteCanvasNode(nodeId);
      } catch (error) {
        console.error('[VisualEditorStore] 删除自由节点失败:', error);
      }
    }
  },
  
  // ★ 更新自由节点的任意属性（AI 任务完成后更新缩略图、URL 等）
  updateFreeNode: (nodeId, updates) => {
    const { freeNodes, projectId } = get();
    set({
      freeNodes: freeNodes.map(n =>
        n.id === nodeId ? { ...n, ...updates } : n
      ),
    });
    // ★ 当关键属性变化时，持久化到后端（含自愈：canvas_node 不存在时自动补建）
    if (projectId && (updates.videoUrl !== undefined || updates.thumbnail !== undefined || updates.generatingTaskId !== undefined || updates.duration !== undefined || updates.aspectRatio !== undefined || updates.assetId !== undefined || updates.isEmpty !== undefined)) {
      (async () => {
        try {
          const { updateCanvasNode, batchCreateCanvasNodes } = await import('@/lib/api/canvas-nodes');
          const updateData: Record<string, unknown> = {};
          if (updates.videoUrl !== undefined) updateData.video_url = updates.videoUrl;
          if (updates.thumbnail !== undefined) updateData.thumbnail_url = updates.thumbnail;
          if (updates.duration !== undefined) updateData.duration = updates.duration;
          if (updates.assetId !== undefined) updateData.asset_id = updates.assetId || null;
          const metaUpdates: Record<string, unknown> = {};
          if (updates.generatingTaskId !== undefined) metaUpdates.generating_task_id = updates.generatingTaskId || null;
          if (updates.generatingCapability !== undefined) metaUpdates.generating_capability = updates.generatingCapability || null;
          if (updates.aspectRatio !== undefined) metaUpdates.aspect_ratio = updates.aspectRatio;
          if (updates.isEmpty !== undefined) metaUpdates.is_empty = updates.isEmpty;
          if (Object.keys(metaUpdates).length > 0) updateData.metadata = metaUpdates;
          try {
            await updateCanvasNode(nodeId, updateData as any);
          } catch (updateErr: any) {
            // ★ 自愈：canvas_node 不存在（404）→ 从前端 state 重建
            const is404 = updateErr?.message?.includes('404') || updateErr?.status === 404;
            if (is404) {
              console.warn('[VisualEditorStore] canvas_node 不存在，自愈补建:', nodeId);
              const currentNode = get().freeNodes.find(n => n.id === nodeId);
              if (currentNode) {
                await batchCreateCanvasNodes(projectId, [{
                  id: currentNode.id,
                  asset_id: currentNode.assetId || undefined,
                  node_type: 'free',
                  media_type: currentNode.mediaType,
                  order_index: 0,
                  start_time: 0,
                  end_time: currentNode.duration,
                  duration: currentNode.duration,
                  canvas_position: currentNode.position,
                  video_url: currentNode.videoUrl || null,
                  thumbnail_url: currentNode.thumbnail || null,
                  metadata: {
                    aspect_ratio: currentNode.aspectRatio || null,
                    generating_task_id: currentNode.generatingTaskId || null,
                    generating_capability: currentNode.generatingCapability || null,
                    is_empty: currentNode.isEmpty || false,
                  },
                }]);
                // 补建后重试 update
                await updateCanvasNode(nodeId, updateData as any);
                console.log('[VisualEditorStore] ✅ canvas_node 自愈成功:', nodeId);
              }
            } else {
              throw updateErr;
            }
          }
        } catch (err) {
          console.warn('[VisualEditorStore] updateFreeNode 持久化失败:', err);
        }
      })();
    }
  },
  
  updateFreeNodePosition: (nodeId, position) => {
    const { freeNodes, projectId } = get();
    set({
      freeNodes: freeNodes.map(n =>
        n.id === nodeId ? { ...n, position } : n
      ),
    });
    // 防抖持久化位置（不记入 history，太频繁了）
    if (projectId) {
      _debouncedPositionSave(projectId, nodeId, position);
    }
  },
  
  // ★ 仅持久化节点位置到后端（序列节点用，不更新 store state）
  persistNodePosition: (nodeId, position) => {
    const { projectId } = get();
    if (projectId) {
      _debouncedPositionSave(projectId, nodeId, position);
    }
  },
  
  // ★ 节点锁定
  isNodeLocked: (nodeId) => {
    return get().lockedNodeIds.includes(nodeId);
  },
  toggleNodeLock: (nodeId, locked) => {
    const { lockedNodeIds } = get();
    if (locked) {
      if (!lockedNodeIds.includes(nodeId)) {
        set({ lockedNodeIds: [...lockedNodeIds, nodeId] });
      }
    } else {
      set({ lockedNodeIds: lockedNodeIds.filter(id => id !== nodeId) });
    }
  },

  // ★ 画布连线操作
  setCanvasEdges: (edges) => {
    set({ canvasEdges: edges });
  },
  
  addCanvasEdge: (edge) => {
    const { canvasEdges, projectId } = get();
    // 避免重复连线
    const exists = canvasEdges.some(e => e.source === edge.source && e.target === edge.target);
    if (exists) return;
    const merged = [...canvasEdges, edge];
    set({ canvasEdges: merged });
    get().pushHistory('add-canvas-edge', '创建连线');
    // 持久化
    if (projectId) {
      _saveCanvasEdges(projectId, merged);
    }
  },
  
  removeCanvasEdge: (edgeId) => {
    const { canvasEdges, projectId } = get();
    const filtered = canvasEdges.filter(e => e.id !== edgeId);
    set({ canvasEdges: filtered });
    get().pushHistory('remove-canvas-edge', '移除连线');
    // 持久化
    if (projectId) {
      _saveCanvasEdges(projectId, filtered);
    }
  },
  
  // ★ Prompt 节点操作
  setPromptNodes: (nodes) => {
    set({ promptNodes: nodes });
  },
  
  addPromptNode: async (node) => {
    const { promptNodes, projectId } = get();
    set({ promptNodes: [...promptNodes, node] });
    get().pushHistory('add-prompt-node', '创建 Prompt 节点');
    // 持久化到 canvas_nodes
    if (projectId) {
      try {
        const { batchCreateCanvasNodes } = await import('@/lib/api/canvas-nodes');
        await batchCreateCanvasNodes(projectId, [{
          id: node.id,
          node_type: 'prompt',
          media_type: 'image',
          order_index: 0,
          start_time: 0,
          end_time: 0,
          duration: 0,
          canvas_position: node.position,
          metadata: { variant: node.variant, text: node.text },
        }]);
      } catch (err) {
        console.error('[VisualEditorStore] Prompt 节点持久化失败:', err);
      }
    }
  },
  
  removePromptNode: async (nodeId) => {
    const { promptNodes, canvasEdges, projectId } = get();
    set({
      promptNodes: promptNodes.filter(n => n.id !== nodeId),
      canvasEdges: canvasEdges.filter(e => e.source !== nodeId && e.target !== nodeId),
    });
    get().pushHistory('remove-prompt-node', '删除 Prompt 节点');
    if (projectId) {
      try {
        const { deleteCanvasNode } = await import('@/lib/api/canvas-nodes');
        await deleteCanvasNode(nodeId);
      } catch (err) {
        console.error('[VisualEditorStore] Prompt 节点删除失败:', err);
      }
      _saveCanvasEdges(projectId, get().canvasEdges);
    }
  },
  
  updatePromptNode: (nodeId, updates) => {
    const { promptNodes, projectId } = get();
    set({
      promptNodes: promptNodes.map(n =>
        n.id === nodeId ? { ...n, ...updates } : n
      ),
    });
    // 防抖持久化文本/位置变更
    if (projectId && (updates.text !== undefined || updates.position !== undefined)) {
      _debouncedUpdatePromptNode(nodeId, () => get().promptNodes.find(n => n.id === nodeId));
    }
  },
  
  // ★ 替换分镜的视频 URL（同步更新前端 + 后端，可选更新缩略图）
  replaceShotVideo: async (shotId, newVideoUrl, newThumbnailUrl) => {
    const { shots } = get();
    console.log('[VisualEditorStore] 替换分镜视频:', { shotId, newVideoUrl, newThumbnailUrl });
    
    // 1. 立即更新前端状态
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? { 
              ...shot, 
              videoUrl: newVideoUrl, 
              replacedVideoUrl: newVideoUrl,
              thumbnail: newThumbnailUrl || shot.thumbnail,  // ★ 更新缩略图
            }
          : shot
      ),
    });
    get().pushHistory('replace-video', '替换视频');
    
    // 2. 调用后端接口持久化
    try {
      const { updateCanvasNode } = await import('@/lib/api/canvas-nodes');
      const updateData: Record<string, string> = { video_url: newVideoUrl };
      if (newThumbnailUrl) {
        updateData.thumbnail_url = newThumbnailUrl;  // ★ 同时保存缩略图
      }
      await updateCanvasNode(shotId, updateData);
      console.log('[VisualEditorStore] 替换成功');
    } catch (error) {
      console.error('[VisualEditorStore] 替换失败:', error);
    }
  },

  // ★ 在指定分镜之后插入新分镜
  insertShotsAfter: async (afterShotId, newShots, options) => {
    const { shots } = get();
    console.log('[VisualEditorStore] 插入分镜:', { afterShotId, count: newShots.length });
    
    // ★ 支持在最前面插入（__before_first__ 哨兵值）
    const isPrepend = afterShotId === '__before_first__';
    
    // 1. 找到插入位置
    const insertIndex = isPrepend ? -1 : shots.findIndex(s => s.id === afterShotId);
    if (!isPrepend && insertIndex === -1) {
      console.error('[VisualEditorStore] 找不到插入位置:', afterShotId);
      return;
    }
    
    // 2. 计算新分镜的时间位置
    let currentTime = isPrepend ? 0 : shots[insertIndex].endTime;
    
    // 3. 构建带索引的新分镜
    const shotsWithIndex: Shot[] = newShots.map((shot, idx) => {
      const duration = shot.endTime - shot.startTime;
      const newShot: Shot = {
        ...shot,
        index: insertIndex + 1 + idx,  // 临时索引，会在下面重新计算
        startTime: currentTime,
        endTime: currentTime + duration,
      };
      currentTime += duration;
      return newShot;
    });
    
    // 4. 合并并重新计算所有索引
    const before = shots.slice(0, insertIndex + 1);
    const after = shots.slice(insertIndex + 1);
    
    // 调整后面分镜的时间
    const timeShift = shotsWithIndex.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
    const adjustedAfter = after.map(s => ({
      ...s,
      startTime: s.startTime + timeShift,
      endTime: s.endTime + timeShift,
    }));
    
    // 合并所有分镜并重新编号
    const mergedShots = [...before, ...shotsWithIndex, ...adjustedAfter].map((s, idx) => ({
      ...s,
      index: idx,
    }));
    
    // 5. 立即更新前端
    set({ shots: mergedShots });
    get().pushHistory('insert-shot', `插入 ${newShots.length} 个分镜`);
    
    const shouldPersist = options?.persist !== false;
    if (!shouldPersist) {
      return;
    }

    // 6. 调用后端持久化（批量创建 canvas_nodes）
    try {
      const { projectId } = get();
      if (!projectId) throw new Error('projectId 未设置');
      const { batchCreateCanvasNodes } = await import('@/lib/api/canvas-nodes');
      
      // 计算插入位置的 order_index
      const baseOrderIndex = isPrepend ? 0 : insertIndex + 1;
      
      const result = await batchCreateCanvasNodes(projectId, newShots.map((shot, idx) => ({
        id: shot.id,
        asset_id: shot.assetId,
        node_type: 'sequence',
        media_type: shot.mediaType || 'video',
        order_index: baseOrderIndex + idx,
        start_time: shot.startTime,
        end_time: shot.endTime,
        duration: shot.endTime - shot.startTime,
        source_start: shot.sourceStart,
        source_end: shot.sourceEnd,
        thumbnail_url: shot.thumbnail || null,
        video_url: shot.videoUrl || null,
        // ★ 保留元数据（transcript 等）和 clip 关联
        metadata: (shot as any).transcript
          ? { transcript: (shot as any).transcript }
          : undefined,
        clip_id: (shot as any).clipId || undefined,
      })));
      
      console.log('[VisualEditorStore] 批量创建 canvas_nodes 成功:', result);
    } catch (error) {
      console.error('[VisualEditorStore] 批量创建 clips 失败:', error);
      // 回滚
      set({ shots });
    }
  },
  
  // ★ 删除分镜
  deleteShot: async (shotId) => {
    const { shots } = get();
    const shotToDelete = shots.find(s => s.id === shotId);
    if (!shotToDelete) {
      console.error('[VisualEditorStore] 找不到要删除的分镜:', shotId);
      return;
    }
    
    console.log('[VisualEditorStore] 删除分镜:', { shotId, index: shotToDelete.index });
    
    // 1. 计算删除后的时间调整
    const deletedDuration = shotToDelete.endTime - shotToDelete.startTime;
    
    // 2. 过滤掉被删除的分镜，并调整后续分镜的时间
    const updatedShots = shots
      .filter(s => s.id !== shotId)
      .map((s, idx) => {
        if (s.startTime > shotToDelete.startTime) {
          // 后面的分镜需要前移
          return {
            ...s,
            index: idx,
            startTime: s.startTime - deletedDuration,
            endTime: s.endTime - deletedDuration,
          };
        }
        return { ...s, index: idx };
      });
    
    // 3. 立即更新前端
    set({ shots: updatedShots });
    get().pushHistory('delete-shot', '删除分镜');
    
    // 4. 调用后端删除
    try {
      const { deleteCanvasNode } = await import('@/lib/api/canvas-nodes');
      await deleteCanvasNode(shotId);
      
      console.log('[VisualEditorStore] 删除分镜成功');
      
      // 通知刷新
      window.dispatchEvent(new CustomEvent('clips-updated'));
    } catch (error) {
      console.error('[VisualEditorStore] 删除分镜失败:', error);
      // 回滚
      set({ shots });
    }
  },
  
  // ★ 批量删除节点（分镜 + 自由节点混合）
  batchDeleteNodes: async (nodeIds) => {
    if (nodeIds.length === 0) return;
    
    const { shots, freeNodes, promptNodes, canvasEdges } = get();
    const shotIds = new Set(shots.map(s => s.id));
    const freeNodeIds = new Set(freeNodes.map(n => n.id));
    const promptNodeIds = new Set(promptNodes.map(n => n.id));
    
    // 分类：哪些是序列节点（shots），哪些是自由节点，哪些是 Prompt 节点
    const shotIdsToDelete = nodeIds.filter(id => shotIds.has(id));
    const freeNodeIdsToDelete = nodeIds.filter(id => freeNodeIds.has(id));
    const promptNodeIdsToDelete = nodeIds.filter(id => promptNodeIds.has(id));
    
    console.log('[VisualEditorStore] 批量删除:', { shotIdsToDelete, freeNodeIdsToDelete, promptNodeIdsToDelete });
    
    // 1. 先更新前端状态
    const deleteSet = new Set(nodeIds);
    
    // 移除序列节点并重新计算时间
    const remainingShots = shots.filter(s => !deleteSet.has(s.id));
    let cumTime = 0;
    const updatedShots = remainingShots.map((s, idx) => {
      const duration = s.endTime - s.startTime;
      const updated = { ...s, index: idx, startTime: cumTime, endTime: cumTime + duration };
      cumTime += duration;
      return updated;
    });
    
    // 移除自由节点 + Prompt 节点 + 相关连线
    const updatedFreeNodes = freeNodes.filter(n => !deleteSet.has(n.id));
    const updatedPromptNodes = promptNodes.filter(n => !deleteSet.has(n.id));
    const updatedCanvasEdges = canvasEdges.filter(
      e => !deleteSet.has(e.source) && !deleteSet.has(e.target)
    );
    
    set({
      shots: updatedShots,
      freeNodes: updatedFreeNodes,
      promptNodes: updatedPromptNodes,
      canvasEdges: updatedCanvasEdges,
    });
    get().pushHistory('batch', `批量删除 ${nodeIds.length} 个节点`);
    
    // 2. 后端批量删除
    try {
      const { deleteCanvasNode } = await import('@/lib/api/canvas-nodes');
      await Promise.allSettled(nodeIds.map(id => deleteCanvasNode(id)));
      console.log('[VisualEditorStore] 批量删除成功');
      window.dispatchEvent(new CustomEvent('clips-updated'));
    } catch (error) {
      console.error('[VisualEditorStore] 批量删除后端失败:', error);
    }
  },
  
  // ==========================================
  // 图层操作
  // ==========================================
  
  addLayer: (shotId, layer) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? { ...shot, layers: [...shot.layers, layer] }
          : shot
      ),
    });
    get().pushHistory('add-layer', `添加图层: ${layer.name}`);
  },
  
  removeLayer: (shotId, layerId) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? { ...shot, layers: shot.layers.filter(l => l.id !== layerId) }
          : shot
      ),
    });
    get().pushHistory('remove-layer', '删除图层');
  },
  
  updateLayer: (shotId, layerId, updates) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? {
              ...shot,
              layers: shot.layers.map(layer => 
                layer.id === layerId ? { ...layer, ...updates } : layer
              ),
            }
          : shot
      ),
    });
    get().pushHistory('modify-layer', '修改图层');
  },
  
  reorderLayers: (shotId, layerIds) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => {
        if (shot.id !== shotId) return shot;
        
        const layerMap = new Map(shot.layers.map(l => [l.id, l]));
        const reorderedLayers = layerIds
          .map(id => layerMap.get(id))
          .filter((l): l is Layer => l !== undefined);
        
        return { ...shot, layers: reorderedLayers };
      }),
    });
    get().pushHistory('reorder-layers', '重排图层');
  },
  
  // ==========================================
  // 画布对象操作
  // ==========================================
  
  addObject: (shotId, layerId, object) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? {
              ...shot,
              layers: shot.layers.map(layer => 
                layer.id === layerId 
                  ? { ...layer, objects: [...layer.objects, object] }
                  : layer
              ),
            }
          : shot
      ),
    });
    get().pushHistory('add-object', `添加${object.type === 'text' ? '文字' : object.type === 'image' ? '图片' : '形状'}`);
  },
  
  removeObject: (shotId, layerId, objectId) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? {
              ...shot,
              layers: shot.layers.map(layer => 
                layer.id === layerId 
                  ? { ...layer, objects: layer.objects.filter(o => o.id !== objectId) }
                  : layer
              ),
            }
          : shot
      ),
    });
    get().pushHistory('remove-object', '删除对象');
  },
  
  updateObject: (shotId, layerId, objectId, updates) => {
    const { shots } = get();
    set({
      shots: shots.map(shot => 
        shot.id === shotId 
          ? {
              ...shot,
              layers: shot.layers.map(layer => 
                layer.id === layerId 
                  ? {
                      ...layer,
                      objects: layer.objects.map(obj => 
                        obj.id === objectId ? { ...obj, ...updates } as CanvasObject : obj
                      ),
                    }
                  : layer
              ),
            }
          : shot
      ),
    });
    get().pushHistory('modify-object', '修改对象');
  },
  
  // ==========================================
  // 选择操作
  // ==========================================
  
  selectObjects: (objectIds) => {
    set(state => ({
      canvas: { ...state.canvas, selectedObjectIds: objectIds },
    }));
  },
  
  clearSelection: () => {
    set(state => ({
      canvas: { ...state.canvas, selectedObjectIds: [] },
    }));
  },
  
  // ==========================================
  // 工具操作
  // ==========================================
  
  setActiveTool: (activeTool) => {
    set(state => ({
      tool: { ...state.tool, activeTool },
    }));
  },
  
  setBrushColor: (brushColor) => {
    set(state => ({
      tool: { ...state.tool, brushColor },
    }));
  },
  
  setBrushSize: (brushSize) => {
    set(state => ({
      tool: { ...state.tool, brushSize },
    }));
  },
  
  setFillColor: (fillColor) => {
    set(state => ({
      tool: { ...state.tool, fillColor },
    }));
  },
  
  setStrokeColor: (strokeColor) => {
    set(state => ({
      tool: { ...state.tool, strokeColor },
    }));
  },
  
  setStrokeWidth: (strokeWidth) => {
    set(state => ({
      tool: { ...state.tool, strokeWidth },
    }));
  },
  
  // ==========================================
  // 画布操作
  // ==========================================
  
  setZoom: (zoom) => {
    const clampedZoom = Math.max(0.1, Math.min(3, zoom));
    set(state => ({
      canvas: { ...state.canvas, zoom: clampedZoom },
    }));
  },
  
  setPan: (panX, panY) => {
    set(state => ({
      canvas: { ...state.canvas, panX, panY },
    }));
  },
  
  resetView: () => {
    set(state => ({
      canvas: { ...state.canvas, zoom: 1, panX: 0, panY: 0 },
    }));
  },
  
  // ==========================================
  // 历史记录（快照式 Undo/Redo）
  // ==========================================
  
  pushHistory: (action, description) => {
    // 恢复快照时不记录历史
    if (_isRestoring) return;
    
    const state = get();
    const snapshot = _takeSnapshot(state);
    const { history, historyIndex } = state;
    
    // 如果在历史中间，删除后面的记录（新操作覆盖redo链）
    const newHistory = history.slice(0, historyIndex + 1);
    
    const newEntry: HistoryEntry = {
      id: generateId(),
      timestamp: Date.now(),
      action,
      description,
      snapshot,
    };
    
    // 限制历史记录数量
    const MAX_HISTORY = 50;
    if (newHistory.length >= MAX_HISTORY) {
      newHistory.shift();
    }
    
    set({
      history: [...newHistory, newEntry],
      historyIndex: newHistory.length, // 指向刚推入的条目
    });
  },
  
  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return; // 0 是初始状态，不能再撤销
    
    const targetIndex = historyIndex - 1;
    const targetEntry = history[targetIndex];
    if (!targetEntry) return;
    
    console.log('[Undo] 撤销到:', targetEntry.description, `(${targetIndex}/${history.length - 1})`);
    
    _isRestoring = true;
    set({
      ..._restoreSnapshot(targetEntry.snapshot),
      historyIndex: targetIndex,
    });
    _isRestoring = false;
  },
  
  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    
    const targetIndex = historyIndex + 1;
    const targetEntry = history[targetIndex];
    if (!targetEntry) return;
    
    console.log('[Redo] 重做到:', targetEntry.description, `(${targetIndex}/${history.length - 1})`);
    
    _isRestoring = true;
    set({
      ..._restoreSnapshot(targetEntry.snapshot),
      historyIndex: targetIndex,
    });
    _isRestoring = false;
  },
  
  jumpToHistory: (index) => {
    const { history } = get();
    if (index < 0 || index >= history.length) return;
    
    const targetEntry = history[index];
    console.log('[History] 跳转到:', targetEntry.description, `(${index}/${history.length - 1})`);
    
    _isRestoring = true;
    set({
      ..._restoreSnapshot(targetEntry.snapshot),
      historyIndex: index,
    });
    _isRestoring = false;
  },
  
  canUndo: () => {
    return get().historyIndex > 0;
  },
  
  canRedo: () => {
    const { history, historyIndex } = get();
    return historyIndex < history.length - 1;
  },
  
  // ==========================================
  // UI 状态
  // ==========================================
  
  setLeftPanelTab: (leftPanelTab) => {
    set({ leftPanelTab });
  },
  
  setRightPanelTab: (rightPanelTab) => {
    set({ rightPanelTab });
  },
  
  setIsPlaying: (isPlaying) => {
    set({ isPlaying });
  },
  
  // ==========================================
  // 侧边栏统一管理 - 同时只显示一个
  // ==========================================
  
  openSidebar: (sidebar, clipId) => {
    set({ 
      activeSidebar: sidebar,
      selectedClipIdForAI: clipId || null,
    });
  },
  
  closeSidebar: () => {
    set({ 
      activeSidebar: null,
      selectedClipIdForAI: null,
    });
  },
  
  toggleSidebar: (sidebar, clipId) => {
    const { activeSidebar } = get();
    if (activeSidebar === sidebar) {
      set({ activeSidebar: null, selectedClipIdForAI: null });
    } else {
      set({ activeSidebar: sidebar, selectedClipIdForAI: clipId || null });
    }
  },
  
  // ==========================================
  // 主线 Timeline 操作
  // ==========================================
  
  addToTimeline: (shotId) => {
    const { shots, timeline } = get();
    const shot = shots.find(s => s.id === shotId);
    if (!shot) return;
    
    // 检查是否已在主线中
    if (timeline.segments.some(seg => seg.sourceNodeId === shotId)) {
      console.log('[Timeline] 节点已在主线中:', shotId);
      return;
    }
    
    const durationMs = (shot.endTime - shot.startTime) * 1000;
    const newSegment: TimelineSegment = {
      id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      sourceNodeId: shotId,
      order: timeline.segments.length,
      mediaType: shot.mediaType || (shot.videoUrl || shot.replacedVideoUrl ? 'video' : 'image'),  // ★ 优先用 shot.mediaType
      durationMs: shot.mediaType === 'image' ? 3000 : (durationMs > 0 ? durationMs : 3000), // ★ 图片固定 3 秒
      thumbnail: shot.thumbnail,
      label: shot.transcript?.slice(0, 30) || `片段 ${timeline.segments.length + 1}`,
      mediaUrl: shot.replacedVideoUrl || shot.videoUrl,
      transcript: shot.transcript,
    };
    
    const newSegments = [...timeline.segments, newSegment];
    const totalDurationMs = newSegments.reduce((sum, s) => sum + s.durationMs, 0);
    
    set({
      timeline: {
        ...timeline,
        segments: newSegments,
        totalDurationMs,
        panelState: timeline.panelState === 'collapsed' ? 'half' : timeline.panelState,
      },
    });
    get().pushHistory('add-to-timeline', `加入主线: ${newSegment.label}`);
    console.log('[Timeline] 已加入主线:', newSegment.label, `(${newSegments.length} 段)`);
  },
  
  insertIntoTimeline: (shotId, afterSegmentId) => {
    const { shots, timeline } = get();
    const shot = shots.find(s => s.id === shotId);
    if (!shot) return;
    
    if (timeline.segments.some(seg => seg.sourceNodeId === shotId)) return;
    
    const insertIndex = timeline.segments.findIndex(s => s.id === afterSegmentId);
    if (insertIndex === -1) return;
    
    const durationMs = (shot.endTime - shot.startTime) * 1000;
    const newSegment: TimelineSegment = {
      id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      sourceNodeId: shotId,
      order: 0, // 下面重排
      mediaType: shot.mediaType || (shot.videoUrl || shot.replacedVideoUrl ? 'video' : 'image'),  // ★ 优先用 shot.mediaType
      durationMs: shot.mediaType === 'image' ? 3000 : (durationMs > 0 ? durationMs : 3000),  // ★ 图片固定 3 秒
      thumbnail: shot.thumbnail,
      label: shot.transcript?.slice(0, 30) || `片段`,
      mediaUrl: shot.replacedVideoUrl || shot.videoUrl,
      transcript: shot.transcript,
    };
    
    const newSegments = [
      ...timeline.segments.slice(0, insertIndex + 1),
      newSegment,
      ...timeline.segments.slice(insertIndex + 1),
    ].map((s, i) => ({ ...s, order: i }));
    
    set({
      timeline: {
        ...timeline,
        segments: newSegments,
        totalDurationMs: newSegments.reduce((sum, s) => sum + s.durationMs, 0),
      },
    });
    get().pushHistory('add-to-timeline', '插入主线');
  },
  
  removeFromTimeline: (segmentId) => {
    const { timeline } = get();
    const newSegments = timeline.segments
      .filter(s => s.id !== segmentId)
      .map((s, i) => ({ ...s, order: i }));
    
    set({
      timeline: {
        ...timeline,
        segments: newSegments,
        totalDurationMs: newSegments.reduce((sum, s) => sum + s.durationMs, 0),
      },
    });
    get().pushHistory('remove-from-timeline', '从主线移除');
  },
  
  reorderTimeline: (segmentIds) => {
    const { timeline } = get();
    const segmentMap = new Map(timeline.segments.map(s => [s.id, s]));
    const newSegments = segmentIds
      .map(id => segmentMap.get(id))
      .filter((s): s is TimelineSegment => s !== undefined)
      .map((s, i) => ({ ...s, order: i }));
    
    set({
      timeline: {
        ...timeline,
        segments: newSegments,
        totalDurationMs: newSegments.reduce((sum, s) => sum + s.durationMs, 0),
      },
    });
    get().pushHistory('reorder-timeline', '重排主线');
  },
  
  replaceTimelineSegment: (segmentId, newShotId) => {
    const { shots, timeline } = get();
    const shot = shots.find(s => s.id === newShotId);
    if (!shot) return;
    
    const durationMs = (shot.endTime - shot.startTime) * 1000;
    const newSegments = timeline.segments.map(seg =>
      seg.id === segmentId
        ? {
            ...seg,
            sourceNodeId: newShotId,
            mediaType: (shot.videoUrl || shot.replacedVideoUrl ? 'video' : 'image') as SegmentMediaType,
            durationMs: durationMs > 0 ? durationMs : seg.durationMs,
            thumbnail: shot.thumbnail,
            label: shot.transcript?.slice(0, 30) || seg.label,
            mediaUrl: shot.replacedVideoUrl || shot.videoUrl,
            transcript: shot.transcript,
          }
        : seg
    );
    
    set({
      timeline: {
        ...timeline,
        segments: newSegments,
        totalDurationMs: newSegments.reduce((sum, s) => sum + s.durationMs, 0),
      },
    });
    get().pushHistory('replace-timeline-segment', '替换主线段');
  },
  
  setTimelinePanelState: (panelState) => {
    set(state => ({
      timeline: { ...state.timeline, panelState },
    }));
  },
  
  toggleTimelinePanel: () => {
    const { timeline } = get();
    const next: TimelinePanelState = 
      timeline.panelState === 'collapsed' ? 'expanded' 
      : timeline.panelState === 'half' ? 'expanded'
      : 'collapsed';
    set({ timeline: { ...timeline, panelState: next } });
  },
  
  addAllToTimeline: () => {
    const { shots, timeline } = get();
    const existingNodeIds = new Set(timeline.segments.map(s => s.sourceNodeId));
    
    const newSegments: TimelineSegment[] = shots
      .filter(shot => !existingNodeIds.has(shot.id))
      .map((shot, idx) => {
        const durationMs = (shot.endTime - shot.startTime) * 1000;
        return {
          id: `seg-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 6)}`,
          sourceNodeId: shot.id,
          order: timeline.segments.length + idx,
          mediaType: (shot.videoUrl || shot.replacedVideoUrl ? 'video' : 'image') as SegmentMediaType,
          durationMs: durationMs > 0 ? durationMs : 3000,
          thumbnail: shot.thumbnail,
          label: shot.transcript?.slice(0, 30) || `片段 ${timeline.segments.length + idx + 1}`,
          mediaUrl: shot.replacedVideoUrl || shot.videoUrl,
          transcript: shot.transcript,
        };
      });
    
    const allSegments = [...timeline.segments, ...newSegments].map((s, i) => ({ ...s, order: i }));
    
    set({
      timeline: {
        ...timeline,
        segments: allSegments,
        totalDurationMs: allSegments.reduce((sum, s) => sum + s.durationMs, 0),
        panelState: allSegments.length > 0 ? 'expanded' : timeline.panelState,
      },
    });
    if (newSegments.length > 0) {
      get().pushHistory('add-to-timeline', `全部加入主线 (${newSegments.length} 段)`);
    }
  },
  
  clearTimeline: () => {
    set(state => ({
      timeline: { ...state.timeline, segments: [], totalDurationMs: 0 },
    }));
    get().pushHistory('clear-timeline', '清空主线');
  },
  
  isInTimeline: (shotId) => {
    return get().timeline.segments.some(seg => seg.sourceNodeId === shotId);
  },
  
  splitSegment: (segmentId) => {
    const { timeline } = get();
    const idx = timeline.segments.findIndex(s => s.id === segmentId);
    if (idx === -1) return;
    const seg = timeline.segments[idx];
    
    // 最短 500ms，不允许拆分过短的段
    if (seg.durationMs < 1000) return;
    
    const halfDuration = Math.round(seg.durationMs / 2);
    const firstHalf: TimelineSegment = {
      ...seg,
      durationMs: halfDuration,
      label: `${seg.label || '片段'} (前)`,
    };
    const secondHalf: TimelineSegment = {
      ...seg,
      id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      durationMs: seg.durationMs - halfDuration,
      label: `${seg.label || '片段'} (后)`,
    };
    
    const newSegments = [
      ...timeline.segments.slice(0, idx),
      firstHalf,
      secondHalf,
      ...timeline.segments.slice(idx + 1),
    ].map((s, i) => ({ ...s, order: i }));
    
    set({
      timeline: {
        ...timeline,
        segments: newSegments,
        totalDurationMs: newSegments.reduce((sum, s) => sum + s.durationMs, 0),
      },
    });
    get().pushHistory('split-segment', '拆分片段');
  },
  
  duplicateSegment: (segmentId) => {
    const { timeline } = get();
    const idx = timeline.segments.findIndex(s => s.id === segmentId);
    if (idx === -1) return;
    const seg = timeline.segments[idx];
    
    const duplicate: TimelineSegment = {
      ...seg,
      id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      label: `${seg.label || '片段'} (副本)`,
    };
    
    const newSegments = [
      ...timeline.segments.slice(0, idx + 1),
      duplicate,
      ...timeline.segments.slice(idx + 1),
    ].map((s, i) => ({ ...s, order: i }));
    
    set({
      timeline: {
        ...timeline,
        segments: newSegments,
        totalDurationMs: newSegments.reduce((sum, s) => sum + s.durationMs, 0),
      },
    });
    get().pushHistory('duplicate-segment', '复制片段');
  },
  
  updateSegmentDuration: (segmentId, newDurationMs) => {
    const { timeline } = get();
    // 最短 200ms，最长 5 分钟
    const clamped = Math.max(200, Math.min(newDurationMs, 300_000));
    
    const newSegments = timeline.segments.map(s =>
      s.id === segmentId ? { ...s, durationMs: clamped } : s
    );
    
    set({
      timeline: {
        ...timeline,
        segments: newSegments,
        totalDurationMs: newSegments.reduce((sum, s) => sum + s.durationMs, 0),
      },
    });
    get().pushHistory('trim-segment', '调整片段时长');
  },
  
  moveSegmentLeft: (segmentId) => {
    const { timeline } = get();
    const ids = timeline.segments.map(s => s.id);
    const idx = ids.indexOf(segmentId);
    if (idx <= 0) return;
    // swap with previous
    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
    get().reorderTimeline(ids);
  },
  
  moveSegmentRight: (segmentId) => {
    const { timeline } = get();
    const ids = timeline.segments.map(s => s.id);
    const idx = ids.indexOf(segmentId);
    if (idx === -1 || idx >= ids.length - 1) return;
    // swap with next
    [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
    get().reorderTimeline(ids);
  },
  
  // ==========================================
  // 加载状态
  // ==========================================
  
  setIsLoading: (isLoading) => {
    set({ isLoading });
  },
  
  setIsAnalyzing: (isAnalyzing) => {
    set({ isAnalyzing });
  },
  
  setIsSaving: (isSaving) => {
    set({ isSaving });
  },
  
  setError: (error) => {
    set({ error });
  },
}));

// ==========================================
// 选择器 Hooks
// ==========================================

export function useCurrentShot(): Shot | null {
  const { shots, currentShotId } = useVisualEditorStore();
  return shots.find(s => s.id === currentShotId) || null;
}

export function useSelectedObjects(): CanvasObject[] {
  const { shots, currentShotId, canvas } = useVisualEditorStore();
  const currentShot = shots.find(s => s.id === currentShotId);
  
  if (!currentShot) return [];
  
  const allObjects: CanvasObject[] = [];
  for (const layer of currentShot.layers) {
    allObjects.push(...layer.objects);
  }
  
  return allObjects.filter(obj => canvas.selectedObjectIds.includes(obj.id));
}
