/**
 * 闭环自动布局 Hook
 *
 * 当画布连线形成闭环时，自动将环中节点重排为正多边形：
 *   - 3 节点 → 等边三角形（顶点在上）
 *   - 4 节点 → 正方形
 *   - N 节点 → 正 N 边形
 *
 * 布局以环中节点当前位置的重心为中心，半径根据节点尺寸自动计算。
 * 只在**新环首次出现时**触发一次自动布局，之后用户可自由拖拽。
 */

import { useRef, useCallback, useEffect } from 'react';
import type { Node } from '@xyflow/react';
import type { DetectedCycle } from './useCycleDetection';

// 默认节点尺寸（用于半径计算）
const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 284;
// 最小半径（防止节点重叠）
const MIN_RADIUS = 180;

interface UseCycleAutoLayoutOptions {
  /** 检测到的闭环 */
  detectedCycles: DetectedCycle[];
  /** 当前所有节点 */
  nodes: Node[];
  /** 更新节点位置 */
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  /** 保存用户位置到对齐缓存（确保 mergePositions 不会覆盖） */
  saveUserPosition?: (nodeId: string, position: { x: number; y: number }) => void;
  /** 持久化位置到后端（刷新后可恢复） */
  persistPosition?: (nodeId: string, position: { x: number; y: number }) => void;
}

/**
 * 计算正多边形顶点坐标（以 center 为圆心，radius 为外接圆半径）
 * 起始角度为 -π/2（顶点在正上方）
 */
function regularPolygonPositions(
  n: number,
  center: { x: number; y: number },
  radius: number,
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const startAngle = -Math.PI / 2; // 第一个顶点在正上方
  for (let i = 0; i < n; i++) {
    const angle = startAngle + (2 * Math.PI * i) / n;
    positions.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return positions;
}

/**
 * 根据节点数量和尺寸计算合适的多边形半径
 * 确保相邻节点之间有足够间距不重叠
 */
function computeRadius(nodeCount: number, avgNodeWidth: number, avgNodeHeight: number): number {
  // 相邻顶点间的弦长应 >= 节点对角线 + 间距
  const diagonal = Math.sqrt(avgNodeWidth ** 2 + avgNodeHeight ** 2);
  const minChord = diagonal * 0.8 + 40; // 节点对角线的 80% + 40px 间距
  // 正多边形中：chord = 2 * r * sin(π/n)
  const sinHalfAngle = Math.sin(Math.PI / nodeCount);
  const radiusFromChord = sinHalfAngle > 0.01 ? minChord / (2 * sinHalfAngle) : MIN_RADIUS;
  return Math.max(radiusFromChord, MIN_RADIUS);
}

export function useCycleAutoLayout({
  detectedCycles,
  nodes,
  setNodes,
  saveUserPosition,
  persistPosition,
}: UseCycleAutoLayoutOptions) {
  // 记录已经自动布局过的闭环 key，避免重复触发
  const layoutDoneCycles = useRef<Set<string>>(new Set());

  /**
   * 对指定闭环执行自动布局
   */
  const layoutCycle = useCallback((cycle: DetectedCycle) => {
    const { nodeIds, key } = cycle;
    const n = nodeIds.length;
    if (n < 2) return;

    // 收集环中节点的当前位置和尺寸
    const cycleNodes: Array<{ id: string; node: Node; cx: number; cy: number; w: number; h: number }> = [];
    for (const nid of nodeIds) {
      const rfNode = nodes.find(nd => nd.id === nid);
      if (!rfNode) continue;
      const w = rfNode.measured?.width ?? (rfNode.width as number | undefined) ?? DEFAULT_NODE_WIDTH;
      const h = rfNode.measured?.height ?? (rfNode.height as number | undefined) ?? DEFAULT_NODE_HEIGHT;
      cycleNodes.push({
        id: nid,
        node: rfNode,
        cx: rfNode.position.x + w / 2,
        cy: rfNode.position.y + h / 2,
        w,
        h,
      });
    }

    if (cycleNodes.length < 2) return;

    // 计算当前重心作为多边形中心
    const centroid = {
      x: cycleNodes.reduce((sum, n) => sum + n.cx, 0) / cycleNodes.length,
      y: cycleNodes.reduce((sum, n) => sum + n.cy, 0) / cycleNodes.length,
    };

    // 计算平均尺寸
    const avgW = cycleNodes.reduce((s, n) => s + n.w, 0) / cycleNodes.length;
    const avgH = cycleNodes.reduce((s, n) => s + n.h, 0) / cycleNodes.length;

    // 计算半径
    const radius = computeRadius(n, avgW, avgH);

    // 按当前角度排序节点（保持用户的大致空间关系）
    const sorted = [...cycleNodes].sort((a, b) => {
      const angleA = Math.atan2(a.cy - centroid.y, a.cx - centroid.x);
      const angleB = Math.atan2(b.cy - centroid.y, b.cx - centroid.x);
      return angleA - angleB;
    });

    // 计算正多边形顶点
    const polyPositions = regularPolygonPositions(n, centroid, radius);

    // 生成 id → 新位置映射（position 是节点左上角，所以要减去半个宽高）
    const positionMap = new Map<string, { x: number; y: number }>();
    sorted.forEach((item, i) => {
      const newPos = {
        x: polyPositions[i].x - item.w / 2,
        y: polyPositions[i].y - item.h / 2,
      };
      positionMap.set(item.id, newPos);
    });

    // 应用新位置
    setNodes(prev => prev.map(node => {
      const newPos = positionMap.get(node.id);
      if (newPos) {
        // 同步到用户位置缓存 + 持久化到后端
        saveUserPosition?.(node.id, newPos);
        persistPosition?.(node.id, newPos);
        return { ...node, position: newPos };
      }
      return node;
    }));

    layoutDoneCycles.current.add(key);
  }, [nodes, setNodes, saveUserPosition, persistPosition]);

  // 当检测到新闭环时，自动布局
  useEffect(() => {
    for (const cycle of detectedCycles) {
      if (!layoutDoneCycles.current.has(cycle.key)) {
        // 延迟一帧执行，确保节点已渲染
        requestAnimationFrame(() => {
          layoutCycle(cycle);
        });
      }
    }
  }, [detectedCycles, layoutCycle]);

  /**
   * 手动触发重新布局（可通过 UI 按钮调用）
   */
  const relayoutCycle = useCallback((cycleKey: string) => {
    const cycle = detectedCycles.find(c => c.key === cycleKey);
    if (cycle) {
      layoutDoneCycles.current.delete(cycleKey);
      layoutCycle(cycle);
    }
  }, [detectedCycles, layoutCycle]);

  /**
   * 重置所有已布局记录（闭环解散后清理）
   */
  const resetLayoutHistory = useCallback(() => {
    layoutDoneCycles.current.clear();
  }, []);

  return {
    relayoutCycle,
    resetLayoutHistory,
  };
}
