'use client';

/**
 * 节点位置管理与对齐辅助 Hook
 * 
 * 功能：
 *  - 保存/恢复用户手动拖拽的节点位置（不被 shots 变化覆盖）
 *  - onNodeDragStop 持久化位置到 Map
 *  - 计算对齐吸附线（中心线、边缘线）
 *  - "一键整理" 布局算法（横排、纵排、网格）
 */

import { useCallback, useRef, useState } from 'react';
import type { Node, NodeChange, XYPosition } from '@xyflow/react';

// ==========================================
// 常量
// ==========================================

/** 吸附阈值（px） */
const SNAP_THRESHOLD = 8;

/** 默认节点高度（用于对齐计算） */
const DEFAULT_NODE_HEIGHT = 200;

/** 整理布局模式 */
export type TidyMode = 'horizontal' | 'vertical' | 'grid' | 'distribute-h' | 'distribute-v';

/** 等间距提示线阈值（px） */
const EQUAL_SPACING_THRESHOLD = 12;

/** 对齐参考线 */
export interface GuideLine {
  /** 线的类型 */
  type: 'horizontal' | 'vertical';
  /** 线的位置（屏幕坐标） */
  position: number;
  /** 参考的来源节点 ID */
  sourceNodeId: string;
}

// ==========================================
// Hook
// ==========================================

export function useNodeAlignment(
  getNodeWidth: (id: string) => number,
  nodeHeight: number = DEFAULT_NODE_HEIGHT,
) {
  /** 用户手动拖拽过的位置缓存：nodeId → position */
  const userPositionsRef = useRef<Map<string, XYPosition>>(new Map());

  /** 当前对齐参考线 */
  const [guideLines, setGuideLines] = useState<GuideLine[]>([]);

  // ==========================================
  // 位置持久化
  // ==========================================

  /**
   * 合并计算位置（如果用户手动拖过就用用户位置，否则用自动布局位置）
   */
  const mergePositions = useCallback((autoNodes: Node[]): Node[] => {
    return autoNodes.map(node => {
      const userPos = userPositionsRef.current.get(node.id);
      if (userPos) {
        return { ...node, position: userPos };
      }
      return node;
    });
  }, []);

  /**
   * 拖拽结束 → 保存用户位置
   */
  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    userPositionsRef.current.set(node.id, { ...node.position });
  }, []);

  /**
   * 保存指定节点的用户位置（供外部布局算法同步缓存）
   */
  const saveUserPosition = useCallback((nodeId: string, position: XYPosition) => {
    userPositionsRef.current.set(nodeId, { ...position });
  }, []);

  /**
   * 清除指定节点的用户位置缓存（如被删除时）
   */
  const clearUserPosition = useCallback((nodeId: string) => {
    userPositionsRef.current.delete(nodeId);
  }, []);

  /**
   * 清除所有用户位置（整理/重置时）
   */
  const clearAllUserPositions = useCallback(() => {
    userPositionsRef.current.clear();
  }, []);

  // ==========================================
  // 对齐参考线
  // ==========================================

  /**
   * 拖拽过程中计算对齐参考线
   */
  const onNodeDrag = useCallback((_event: React.MouseEvent, draggedNode: Node, allNodes: Node[]) => {
    const lines: GuideLine[] = [];
    const dragX = draggedNode.position.x;
    const dragY = draggedNode.position.y;
    const dragW = getNodeWidth(draggedNode.id);
    const dragH = nodeHeight;
    const dragCenterX = dragX + dragW / 2;
    const dragCenterY = dragY + dragH / 2;
    const dragRight = dragX + dragW;
    const dragBottom = dragY + dragH;

    for (const node of allNodes) {
      if (node.id === draggedNode.id) continue;

      const nx = node.position.x;
      const ny = node.position.y;
      const nw = getNodeWidth(node.id);
      const nh = nodeHeight;
      const ncx = nx + nw / 2;
      const ncy = ny + nh / 2;
      const nRight = nx + nw;
      const nBottom = ny + nh;

      // 垂直对齐线（X 轴方向）
      // 左边对齐
      if (Math.abs(dragX - nx) < SNAP_THRESHOLD) {
        lines.push({ type: 'vertical', position: nx, sourceNodeId: node.id });
      }
      // 右边对齐
      if (Math.abs(dragRight - nRight) < SNAP_THRESHOLD) {
        lines.push({ type: 'vertical', position: nRight, sourceNodeId: node.id });
      }
      // 中心 X 对齐
      if (Math.abs(dragCenterX - ncx) < SNAP_THRESHOLD) {
        lines.push({ type: 'vertical', position: ncx, sourceNodeId: node.id });
      }
      // 左→右对齐
      if (Math.abs(dragX - nRight) < SNAP_THRESHOLD) {
        lines.push({ type: 'vertical', position: nRight, sourceNodeId: node.id });
      }
      // 右→左对齐
      if (Math.abs(dragRight - nx) < SNAP_THRESHOLD) {
        lines.push({ type: 'vertical', position: nx, sourceNodeId: node.id });
      }

      // 水平对齐线（Y 轴方向）
      // 顶部对齐
      if (Math.abs(dragY - ny) < SNAP_THRESHOLD) {
        lines.push({ type: 'horizontal', position: ny, sourceNodeId: node.id });
      }
      // 底部对齐
      if (Math.abs(dragBottom - nBottom) < SNAP_THRESHOLD) {
        lines.push({ type: 'horizontal', position: nBottom, sourceNodeId: node.id });
      }
      // 中心 Y 对齐
      if (Math.abs(dragCenterY - ncy) < SNAP_THRESHOLD) {
        lines.push({ type: 'horizontal', position: ncy, sourceNodeId: node.id });
      }
    }

    // ★ 等间距提示线：检测拖拽节点与相邻节点是否构成等间距
    const others = allNodes.filter(n => n.id !== draggedNode.id);
    // 水平等间距：找到与被拖拽节点 Y 对齐的节点，按 X 排序
    const sameRowNodes = others.filter(n => Math.abs(n.position.y - dragY) < nodeHeight * 0.5);
    if (sameRowNodes.length >= 2) {
      const allInRow = [...sameRowNodes, { id: draggedNode.id, position: { x: dragX, y: dragY } }]
        .sort((a, b) => a.position.x - b.position.x);
      for (let i = 0; i < allInRow.length - 2; i++) {
        const gap1 = allInRow[i + 1].position.x - allInRow[i].position.x;
        const gap2 = allInRow[i + 2].position.x - allInRow[i + 1].position.x;
        if (Math.abs(gap1 - gap2) < EQUAL_SPACING_THRESHOLD && gap1 > 10) {
          const midX = allInRow[i + 1].position.x;
          lines.push({ type: 'vertical', position: midX, sourceNodeId: 'equal-spacing' });
        }
      }
    }
    // 垂直等间距：找到与被拖拽节点 X 对齐的节点，按 Y 排序
    const sameColNodes = others.filter(n => Math.abs(n.position.x - dragX) < dragW * 0.5);
    if (sameColNodes.length >= 2) {
      const allInCol = [...sameColNodes, { id: draggedNode.id, position: { x: dragX, y: dragY } }]
        .sort((a, b) => a.position.y - b.position.y);
      for (let i = 0; i < allInCol.length - 2; i++) {
        const gap1 = allInCol[i + 1].position.y - allInCol[i].position.y;
        const gap2 = allInCol[i + 2].position.y - allInCol[i + 1].position.y;
        if (Math.abs(gap1 - gap2) < EQUAL_SPACING_THRESHOLD && gap1 > 10) {
          const midY = allInCol[i + 1].position.y;
          lines.push({ type: 'horizontal', position: midY, sourceNodeId: 'equal-spacing' });
        }
      }
    }

    // 去重（相同方向 + 位置只保留一条）
    const unique = lines.filter((line, index, arr) =>
      arr.findIndex(l => l.type === line.type && Math.abs(l.position - line.position) < 1) === index
    );

    setGuideLines(unique);
  }, [getNodeWidth, nodeHeight]);

  /**
   * 拖拽结束 → 清除参考线
   */
  const onNodeDragStopWithGuides = useCallback((_event: React.MouseEvent, node: Node) => {
    userPositionsRef.current.set(node.id, { ...node.position });
    setGuideLines([]);
  }, []);

  // ==========================================
  // 一键整理
  // ==========================================

  /**
   * 自动整理布局
   * 
   * @param nodes 当前所有节点
   * @param mode 整理模式
   * @param gap 节点间距（px）
   * @returns 新的节点数组（已更新位置）
   */
  const tidyLayout = useCallback((nodes: Node[], mode: TidyMode, gap: number = 50): Node[] => {
    if (nodes.length === 0) return nodes;

    // 清除所有用户位置缓存
    clearAllUserPositions();

    const startX = 50;
    const startY = 50;

    switch (mode) {
      case 'horizontal': {
        let currentX = startX;
        return nodes.map(node => {
          const w = getNodeWidth(node.id);
          const newNode = { ...node, position: { x: currentX, y: startY } };
          currentX += w + gap;
          // 同时缓存新位置
          userPositionsRef.current.set(node.id, newNode.position);
          return newNode;
        });
      }

      case 'vertical': {
        let currentY = startY;
        return nodes.map(node => {
          const newNode = { ...node, position: { x: startX, y: currentY } };
          currentY += nodeHeight + gap;
          userPositionsRef.current.set(node.id, newNode.position);
          return newNode;
        });
      }

      case 'grid': {
        // 自动确定列数（根据节点数量）
        const cols = Math.ceil(Math.sqrt(nodes.length));
        let colX = startX;
        let rowY = startY;
        let colIndex = 0;

        return nodes.map(node => {
          const w = getNodeWidth(node.id);
          const newNode = { ...node, position: { x: colX, y: rowY } };
          userPositionsRef.current.set(node.id, newNode.position);

          colIndex++;
          if (colIndex >= cols) {
            colIndex = 0;
            colX = startX;
            rowY += nodeHeight + gap;
          } else {
            colX += w + gap;
          }
          return newNode;
        });
      }

      case 'distribute-h': {
        // 等间距水平分布：保持 Y 不变，在最左到最右之间均匀分布
        if (nodes.length <= 1) return nodes;
        const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);
        const minX = sorted[0].position.x;
        const maxX = sorted[sorted.length - 1].position.x;
        const totalSpan = maxX - minX;
        const spacing = totalSpan / (sorted.length - 1);
        return sorted.map((node, i) => {
          const newNode = { ...node, position: { x: minX + spacing * i, y: node.position.y } };
          userPositionsRef.current.set(node.id, newNode.position);
          return newNode;
        });
      }

      case 'distribute-v': {
        // 等间距垂直分布：保持 X 不变，在最上到最下之间均匀分布
        if (nodes.length <= 1) return nodes;
        const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
        const minY = sorted[0].position.y;
        const maxY = sorted[sorted.length - 1].position.y;
        const totalSpan = maxY - minY;
        const spacing = totalSpan / (sorted.length - 1);
        return sorted.map((node, i) => {
          const newNode = { ...node, position: { x: node.position.x, y: minY + spacing * i } };
          userPositionsRef.current.set(node.id, newNode.position);
          return newNode;
        });
      }
    }
  }, [getNodeWidth, nodeHeight, clearAllUserPositions]);

  return {
    guideLines,
    mergePositions,
    onNodeDrag,
    onNodeDragStop: onNodeDragStopWithGuides,
    clearUserPosition,
    clearAllUserPositions,
    saveUserPosition,
    tidyLayout,
  };
}
