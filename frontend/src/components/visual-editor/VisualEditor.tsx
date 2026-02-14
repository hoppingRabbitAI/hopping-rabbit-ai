'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import Header from './Header';
import { WorkflowCanvas } from './workflow';
import MainTimeline from './MainTimeline';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { listCanvasNodes } from '@/lib/api/canvas-nodes';
import type { ListCanvasNodesResponse } from '@/lib/api/canvas-nodes';

// ==========================================
// Props — 支持 URL 参数模式 & Props 传入模式
// ==========================================

export interface VisualEditorProps {
  /** 项目 ID（由 WorkspaceLayout 传入） */
  projectId: string;
  /** 是否隐藏顶部 Header（嵌入其他页面时使用） */
  hideHeader?: boolean;
  /** 选中 shot 回调 */
  onShotSelect?: (shot: import('@/types/visual-editor').Shot | null) => void;
  /** 额外的 CSS 类名 */
  className?: string;
}

// ==========================================
// 主组件
// ==========================================

export default function VisualEditor(props: VisualEditorProps) {
  const { projectId } = props;

  // 加载状态 — 用 ref 防止重复加载
  const [hasLoaded, setHasLoaded] = useState(false);
  const loadingRef = React.useRef(false);
  
  const {
    isLoading,
    error,
    shots,
    initialize,
    setShots,
    setFreeNodes,
    setCanvasEdges,
    setPromptNodes,
    setCurrentShot,
    setIsLoading,
    setError,
    undo,
    redo,
  } = useVisualEditorStore();
  
  // ★ 全局键盘快捷键：⌘Z 撤销 / ⌘⇧Z 重做
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) { redo(); } else { undo(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);
  
  // 初始化
  useEffect(() => {
    if (projectId) {
      initialize(projectId);
      setHasLoaded(false);
    }
  }, [projectId]);
  
  // ★ 处理 canvas_nodes 结果 → 转为 shots
  const processCanvasNodes = useCallback(async (result: ListCanvasNodesResponse) => {
    if (!result || (result.sequence_nodes.length === 0 && result.free_nodes.length === 0)) {
      console.warn('[VisualEditor] 画布节点为空，可能还在上传中');
      return;
    }
    
    console.log('[VisualEditor] 加载 canvas_nodes:', {
      sequence: result.sequence_nodes.length,
      free: result.free_nodes.length,
    });
    
    // sequence_nodes → shots（时间已经是秒）
    const formattedShots = result.sequence_nodes.map((node, index) => {
      const meta = (node.metadata || {}) as Record<string, unknown>;
      return {
        id: node.id,
        index,
        clipId: node.clip_id || undefined,   // ★ 关联 clips 表 ID
        mediaType: node.media_type === 'image' ? 'image' as const : 'video' as const,
        startTime: node.start_time,
        endTime: node.end_time,
        sourceStart: node.source_start,
        sourceEnd: node.source_end,
        thumbnail: node.thumbnail_url ?? undefined,
        transcript: (meta.transcript as string) || undefined,
        assetId: node.asset_id,
        videoUrl: node.video_url ?? undefined,
        canvasPosition: node.canvas_position || undefined,
        background: { type: 'original' as const },
        artboard: { x: 0, y: 0, width: 1920, height: 1080 },
        layers: [
          { id: `layer-bg-${index}`, type: 'background' as const, name: '背景', visible: true, locked: false, opacity: 1, objects: [] },
          { id: `layer-fg-${index}`, type: 'foreground' as const, name: '人物', visible: true, locked: true, opacity: 1, objects: [] },
          { id: `layer-dec-${index}`, type: 'decoration' as const, name: '装饰', visible: true, locked: false, opacity: 1, objects: [] },
        ],
      };
    });
    
    setShots(formattedShots);
    
    // ★ 加载自由节点
    if (result.free_nodes && result.free_nodes.length > 0) {
      const freeNodes = result.free_nodes.map((fn) => {
        const meta = (fn.metadata || {}) as Record<string, unknown>;
        return {
          id: fn.id,
          mediaType: fn.media_type === 'image' ? 'image' as const : 'video' as const,
          thumbnail: fn.thumbnail_url ?? undefined,
          videoUrl: fn.video_url ?? undefined,
          assetId: fn.asset_id,
          duration: fn.duration,
          aspectRatio: ((meta.aspect_ratio as string) || undefined) as any,
          position: fn.canvas_position || { x: 200, y: 200 },
          generatingTaskId: (meta.generating_task_id as string) || undefined,
          generatingCapability: (meta.generating_capability as string) || undefined,
          isEmpty: (meta.is_empty as boolean) || false,
        };
      });
      setFreeNodes(freeNodes);
      console.log(`[VisualEditor] 加载 ${freeNodes.length} 个自由节点`);
    } else {
      setFreeNodes([]);
    }
    
    // ★ 加载画布连线（字段名映射: source_node_id → source, 含关联关系类型）
    if (result.canvas_edges && result.canvas_edges.length > 0) {
      setCanvasEdges(result.canvas_edges.map(e => ({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        sourceHandle: e.source_handle || undefined,
        targetHandle: e.target_handle || undefined,
        relationType: (e.relation_type as any) || undefined,
        relationLabel: e.relation_label || undefined,
      })));
    } else {
      setCanvasEdges([]);
    }
    
    // ★ 加载 Prompt 节点
    if (result.prompt_nodes && result.prompt_nodes.length > 0) {
      const promptNodes = result.prompt_nodes.map((pn) => {
        const meta = (pn.metadata || {}) as Record<string, unknown>;
        return {
          id: pn.id,
          variant: (meta.variant as 'prompt' | 'negative') || 'prompt',
          text: (meta.text as string) || '',
          position: pn.canvas_position || { x: 200, y: 200 },
        };
      });
      setPromptNodes(promptNodes);
      console.log(`[VisualEditor] 加载 ${promptNodes.length} 个 Prompt 节点`);
    } else {
      setPromptNodes([]);
    }
    
    console.log(`[VisualEditor] ✅ 加载完成: ${formattedShots.length} 个片段`);
  }, [setShots, setFreeNodes, setCanvasEdges, setPromptNodes]);
  
  // ★ 加载画布节点（直接从 canvas_nodes 表读取，不再走 workspace/clips 中间层）
  const loadClips = useCallback(async () => {
    if (!projectId) return;
    
    try {
      const data = await listCanvasNodes(projectId);
      
      if (data.sequence_nodes.length > 0 || data.free_nodes.length > 0 || (data.prompt_nodes && data.prompt_nodes.length > 0)) {
        await processCanvasNodes(data);
      } else {
        console.warn('[VisualEditor] 项目暂无画布节点');
      }
    } catch (err) {
      console.error('[VisualEditor] 加载画布节点失败:', err);
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [projectId, processCanvasNodes, setError]);
  
  // ★ 自动加载画布节点 — projectId 变化时一次性加载
  useEffect(() => {
    if (!projectId || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    loadClips().finally(() => {
      setIsLoading(false);
      setHasLoaded(true);
      loadingRef.current = false;
    });
  }, [projectId, loadClips, setIsLoading]);
  
  // ★ 监听 clips-updated 事件（拆分、AI 生成等后触发刷新）
  useEffect(() => {
    const handleClipsUpdated = () => {
      console.log('[VisualEditor] 收到 clips-updated 事件，刷新数据...');
      loadClips();
    };
    window.addEventListener('clips-updated', handleClipsUpdated);
    return () => window.removeEventListener('clips-updated', handleClipsUpdated);
  }, [loadClips]);
  
  // 错误状态
  if (error) {
    return (
      <div className={cn("bg-gray-100 flex items-center justify-center", props.hideHeader ? "h-full w-full" : "h-screen w-screen")}>
        <div className="text-center bg-white p-8 rounded-2xl shadow-lg border border-gray-200 max-w-md">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-500 text-xl">!</span>
          </div>
          <p className="text-red-600 text-lg font-medium mb-2">加载失败</p>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button 
              onClick={() => {
                setError?.('');
                setHasLoaded(false);
              }}
              className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              重试
            </button>
            <button 
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-gray-800 text-white rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // 加载状态
  if (isLoading) {
    return (
      <div className={cn("bg-gray-100 flex items-center justify-center", props.hideHeader ? "h-full w-full" : "h-screen w-screen")}>
        <div className="text-center bg-white p-8 rounded-2xl shadow-lg border border-gray-200">
          <Loader2 className="w-8 h-8 text-gray-800 animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm font-medium">加载中...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className={cn("bg-gray-50 flex flex-col overflow-hidden", props.hideHeader ? "h-full w-full" : "h-screen w-screen", props.className)}>
      {/* 顶部栏 — 嵌入模式下隐藏 */}
      {!props.hideHeader && <Header />}
      
      {/* 工作流画布 + 浮动 Timeline */}
      <div className="flex-1 overflow-hidden relative">
        <WorkflowCanvas 
          shots={shots}
          projectId={projectId}
          onShotSelect={(shot) => {
            if (shot) setCurrentShot?.(shot.id);
            props.onShotSelect?.(shot as any);
          }}
        />
        
        {/* ★ 主线 Timeline（底部浮动卡片） */}
        <div className="absolute bottom-6 left-[12%] right-[12%] z-10 pointer-events-none">
          <div className="pointer-events-auto">
            <MainTimeline />
          </div>
        </div>
      </div>
    </div>
  );
}
