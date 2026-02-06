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
  ShotBackground,
  Artboard,
  DEFAULT_ARTBOARD,
} from '@/types/visual-editor';

// ==========================================
// Store 类型
// ==========================================

interface VisualEditorActions {
  // 初始化
  initialize: (projectId: string, sessionId: string) => void;
  reset: () => void;
  
  // 分镜操作
  setShots: (shots: Shot[]) => void;
  setCurrentShot: (shotId: string) => void;
  updateShotBackground: (shotId: string, background: Partial<ShotBackground>) => void;
  updateShotArtboard: (shotId: string, artboard: Partial<Artboard>) => void;
  updateShotViewport: (shotId: string, viewportTransform: number[]) => void;
  
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
  pushHistory: (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => void;
  undo: () => void;
  redo: () => void;
  
  // UI 状态
  setLeftPanelTab: (tab: 'layers' | 'history') => void;
  setRightPanelTab: (tab: 'background' | 'properties') => void;
  setIsPlaying: (playing: boolean) => void;
  
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

// ==========================================
// Store 实现
// ==========================================

export const useVisualEditorStore = create<VisualEditorStore>()((set, get) => ({
  ...DEFAULT_VISUAL_EDITOR_STATE,
  
  // ==========================================
  // 初始化
  // ==========================================
  
  initialize: (projectId, sessionId) => {
    // ★ 切换项目时必须清空所有旧数据，防止缓存污染
    set({
      ...DEFAULT_VISUAL_EDITOR_STATE,  // 重置为初始状态
      projectId,
      sessionId,
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
  // 历史记录
  // ==========================================
  
  pushHistory: (entry) => {
    const { history, historyIndex } = get();
    
    // 如果在历史中间，删除后面的记录
    const newHistory = history.slice(0, historyIndex + 1);
    
    const newEntry: HistoryEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
    };
    
    // 限制历史记录数量
    const MAX_HISTORY = 50;
    if (newHistory.length >= MAX_HISTORY) {
      newHistory.shift();
    }
    
    set({
      history: [...newHistory, newEntry],
      historyIndex: newHistory.length,
    });
  },
  
  undo: () => {
    const { historyIndex } = get();
    if (historyIndex >= 0) {
      set({ historyIndex: historyIndex - 1 });
      // TODO: 实际恢复状态
    }
  },
  
  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      set({ historyIndex: historyIndex + 1 });
      // TODO: 实际恢复状态
    }
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
