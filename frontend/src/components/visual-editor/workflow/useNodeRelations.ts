/**
 * useNodeRelations — 节点关联关系管理 Hook
 *
 * 提供：
 * - 关联关系的创建/删除
 * - 关联模式 toggle（overlay 开关）
 * - 从 canvasEdges 中提取有 relationType 的边
 * - 构建 nodeInfoMap（用于 NodeLineagePanel）
 */

'use client';

import { useCallback, useMemo, useState } from 'react';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import type {
  CanvasEdge,
  NodeRelationType,
  Shot,
  FreeNode,
} from '@/types/visual-editor';
import type { LineageNodeInfo } from './NodeLineagePanel';

export function useNodeRelations() {
  // ★ 关联模式开关：默认开启箭头模式，所有连线带方向箭头
  const [showRelations, setShowRelations] = useState(true);
  // ★ 溯源面板选中的节点
  const [lineageNodeId, setLineageNodeId] = useState<string | null>(null);

  const {
    shots,
    freeNodes,
    canvasEdges,
    addCanvasEdge,
    removeCanvasEdge,
    setCanvasEdges,
  } = useVisualEditorStore();

  // ★ 筛选出有关联关系的边
  const relationEdges = useMemo(() => {
    return canvasEdges.filter(e => e.relationType);
  }, [canvasEdges]);

  // ★ 筛选出没有关联关系的普通边
  const plainEdges = useMemo(() => {
    return canvasEdges.filter(e => !e.relationType);
  }, [canvasEdges]);

  // ★ 构建 nodeInfoMap — 将 Shot 和 FreeNode 统一为 LineageNodeInfo
  const nodeInfoMap = useMemo<Record<string, LineageNodeInfo>>(() => {
    const map: Record<string, LineageNodeInfo> = {};

    shots.forEach((shot: Shot, index: number) => {
      map[shot.id] = {
        id: shot.id,
        label: shot.transcript
          ? `${shot.transcript.slice(0, 20)}${shot.transcript.length > 20 ? '...' : ''}`
          : `镜头 ${index + 1}`,
        thumbnail: shot.thumbnailUrl || shot.thumbnail,
        mediaType: shot.mediaType || 'video',
        isFreeNode: false,
      };
    });

    freeNodes.forEach((node: FreeNode, index: number) => {
      map[node.id] = {
        id: node.id,
        label: `素材 ${index + 1}`,
        thumbnail: node.thumbnail,
        mediaType: node.mediaType || 'image',
        isFreeNode: true,
      };
    });

    return map;
  }, [shots, freeNodes]);

  // ★ 添加关联关系
  const addRelation = useCallback((
    sourceId: string,
    targetId: string,
    relationType: NodeRelationType,
    relationLabel?: string,
    sourceHandle?: string,
    targetHandle?: string,
  ) => {
    const edge: CanvasEdge = {
      id: `relation-${sourceId}-${targetId}-${relationType}`,
      source: sourceId,
      target: targetId,
      relationType,
      relationLabel,
      sourceHandle,
      targetHandle,
    };
    addCanvasEdge(edge);
  }, [addCanvasEdge]);

  // ★ 删除关联关系
  const removeRelation = useCallback((edgeId: string) => {
    removeCanvasEdge(edgeId);
  }, [removeCanvasEdge]);

  // ★ 批量设置关联关系（用于 AI 自动推断场景）
  const setRelations = useCallback((newRelationEdges: CanvasEdge[]) => {
    // 保留原有的 plain edges，替换 relation edges
    const plain = canvasEdges.filter(e => !e.relationType);
    setCanvasEdges([...plain, ...newRelationEdges]);
  }, [canvasEdges, setCanvasEdges]);

  // ★ 获取某个节点的所有关联边
  const getNodeRelations = useCallback((nodeId: string) => {
    return relationEdges.filter(e => e.source === nodeId || e.target === nodeId);
  }, [relationEdges]);

  // ★ 检查两个节点之间是否已有关联关系
  const hasRelation = useCallback((sourceId: string, targetId: string): boolean => {
    return relationEdges.some(
      e => (e.source === sourceId && e.target === targetId) ||
           (e.source === targetId && e.target === sourceId)
    );
  }, [relationEdges]);

  // ★ 获取某个节点的上游链（从近到远 BFS，沿 edge.target→edge.source 方向回溯）
  // 例：图1 → 图2 → 图3，getUpstreamChain('图3') = ['图2', '图1']
  const getUpstreamChain = useCallback((nodeId: string): string[] => {
    const result: string[] = [];
    const visited = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      // 找所有 target === current 的边，其 source 就是上游
      for (const edge of canvasEdges) {
        if (edge.target === current && !visited.has(edge.source)) {
          visited.add(edge.source);
          result.push(edge.source);
          queue.push(edge.source);
        }
      }
    }
    return result;
  }, [canvasEdges]);

  // ★ 获取某个节点的直接上游（最近一层，不递归）
  const getDirectUpstream = useCallback((nodeId: string): string[] => {
    return canvasEdges
      .filter(e => e.target === nodeId)
      .map(e => e.source);
  }, [canvasEdges]);

  // ★ 获取某个节点的下游链
  const getDownstreamChain = useCallback((nodeId: string): string[] => {
    const result: string[] = [];
    const visited = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of canvasEdges) {
        if (edge.source === current && !visited.has(edge.target)) {
          visited.add(edge.target);
          result.push(edge.target);
          queue.push(edge.target);
        }
      }
    }
    return result;
  }, [canvasEdges]);

  // ★ Toggle 关联模式
  const toggleRelations = useCallback(() => {
    setShowRelations(prev => {
      if (prev) setLineageNodeId(null); // 关闭时同时关闭溯源面板
      return !prev;
    });
  }, []);

  // ★ 打开溯源面板
  const openLineage = useCallback((nodeId: string) => {
    setLineageNodeId(nodeId);
    if (!showRelations) setShowRelations(true);
  }, [showRelations]);

  // ★ 关闭溯源面板
  const closeLineage = useCallback(() => {
    setLineageNodeId(null);
  }, []);

  return {
    // 状态
    showRelations,
    lineageNodeId,
    relationEdges,
    plainEdges,
    nodeInfoMap,

    // 操作
    addRelation,
    removeRelation,
    setRelations,
    getNodeRelations,
    hasRelation,
    getUpstreamChain,
    getDirectUpstream,
    getDownstreamChain,
    toggleRelations,
    openLineage,
    closeLineage,
  };
}
