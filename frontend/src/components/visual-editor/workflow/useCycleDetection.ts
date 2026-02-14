/**
 * 闭环检测 Hook
 * 检测画布连线中的闭环（cycle），计算几何中心，用于渲染中心 + 按钮
 * 
 * 算法：DFS 检测有向图中的所有简单环
 * P0：支持 2-节点环和 3-节点环
 */

import { useMemo } from 'react';
import type { Node } from '@xyflow/react';

export interface CanvasEdgeInput {
  id: string;
  source: string;
  target: string;
}

export interface DetectedCycle {
  /** 环中包含的节点 ID（按路径顺序） */
  nodeIds: string[];
  /** 环中包含的边 ID */
  edgeIds: string[];
  /** 环的几何中心（flow 坐标） */
  center: { x: number; y: number };
  /** 唯一标识（排序后的节点 ID 拼接） */
  key: string;
}

/**
 * 检测闭环并计算几何中心
 */
export function useCycleDetection(
  canvasEdges: CanvasEdgeInput[],
  nodes: Node[],
): DetectedCycle[] {
  return useMemo(() => {
    if (canvasEdges.length < 2) return [];

    // 构建邻接表
    const adj = new Map<string, { target: string; edgeId: string }[]>();
    for (const edge of canvasEdges) {
      if (!adj.has(edge.source)) adj.set(edge.source, []);
      adj.get(edge.source)!.push({ target: edge.target, edgeId: edge.id });
    }

    // 获取所有节点 ID
    const allNodeIds = new Set<string>();
    for (const edge of canvasEdges) {
      allNodeIds.add(edge.source);
      allNodeIds.add(edge.target);
    }

    // 节点位置映射
    const nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const node of nodes) {
      // 使用节点中心点
      const w = (node.measured?.width ?? node.width ?? 160);
      const h = (node.measured?.height ?? node.height ?? 284);
      nodePositions.set(node.id, {
        x: node.position.x + w / 2,
        y: node.position.y + h / 2,
        width: w,
        height: h,
      });
    }

    // DFS 寻找简单环（P0: 限制长度 2~4）
    const foundCycles: DetectedCycle[] = [];
    const cycleKeys = new Set<string>();

    for (const startId of Array.from(allNodeIds)) {
      // DFS
      const stack: { nodeId: string; path: string[]; edgePath: string[] }[] = [
        { nodeId: startId, path: [startId], edgePath: [] },
      ];

      while (stack.length > 0) {
        const { nodeId, path, edgePath } = stack.pop()!;

        // 限制路径长度（P0: 最多 4 节点）
        if (path.length > 4) continue;

        const neighbors = adj.get(nodeId) || [];
        for (const { target, edgeId } of neighbors) {
          // 找到环：目标是起点
          if (target === startId && path.length >= 2) {
            // 生成唯一 key（排序后的节点 ID）
            const sorted = [...path].sort();
            const key = sorted.join('|');
            if (!cycleKeys.has(key)) {
              cycleKeys.add(key);

              // 计算几何中心
              let cx = 0, cy = 0, count = 0;
              for (const nid of path) {
                const pos = nodePositions.get(nid);
                if (pos) {
                  cx += pos.x;
                  cy += pos.y;
                  count++;
                }
              }
              if (count > 0) {
                foundCycles.push({
                  nodeIds: [...path],
                  edgeIds: [...edgePath, edgeId],
                  center: { x: cx / count, y: cy / count },
                  key,
                });
              }
            }
            continue;
          }

          // 避免重复访问（非起点）
          if (path.includes(target)) continue;

          stack.push({
            nodeId: target,
            path: [...path, target],
            edgePath: [...edgePath, edgeId],
          });
        }
      }
    }

    return foundCycles;
  }, [canvasEdges, nodes]);
}
