/**
 * 简化边组件 — V1 画布连线系统
 * 箭头线 + 选中时显示删除按钮
 * 用于表达素材之间的关联关系
 * 
 * 交互：
 * - 点击选中（变蓝色 + 加粗）
 * - 选中后显示中点删除按钮（×）
 * - 选中后按 Delete/Backspace 键删除
 * - 拖拽端点可重新连接到其他节点
 */

'use client';

import React, { useMemo, useCallback, CSSProperties } from 'react';
import { BaseEdge, EdgeLabelRenderer, Position, useReactFlow } from '@xyflow/react';

interface SimpleEdgeProps {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  style?: CSSProperties;
  selected?: boolean;
}

export function SimpleEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  selected,
}: SimpleEdgeProps) {
  const { setEdges } = useReactFlow();

  const { edgePath, midX, midY } = useMemo(() => {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const offset = Math.max(60, dist * 0.4);

    const getControlPoint = (x: number, y: number, pos: Position, off: number) => {
      switch (pos) {
        case Position.Right:  return { x: x + off, y };
        case Position.Left:   return { x: x - off, y };
        case Position.Bottom: return { x, y: y + off };
        case Position.Top:    return { x, y: y - off };
        default:              return { x: x + off, y };
      }
    };

    const cp1 = getControlPoint(sourceX, sourceY, sourcePosition, offset);
    const cp2 = getControlPoint(targetX, targetY, targetPosition, offset);
    const path = `M ${sourceX},${sourceY} C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${targetX},${targetY}`;

    // 计算贝塞尔曲线中点（t=0.5）用于放置删除按钮
    const t = 0.5;
    const mx = (1-t)**3*sourceX + 3*(1-t)**2*t*cp1.x + 3*(1-t)*t**2*cp2.x + t**3*targetX;
    const my = (1-t)**3*sourceY + 3*(1-t)**2*t*cp1.y + 3*(1-t)*t**2*cp2.y + t**3*targetY;

    return { edgePath: path, midX: mx, midY: my };
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  // ★ 点击删除按钮：通过 setEdges 移除（会触发 handleEdgesChange → removeCanvasEdge 持久化）
  const onDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEdges(edges => edges.filter(edge => edge.id !== id));
  }, [id, setEdges]);

  const markerId = `simple-arrow-${id}`;
  const edgeColor = selected ? '#3b82f6' : '#94a3b8';

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="10"
          markerHeight="10"
          orient="auto-start-reverse"
        >
          <path d="M 2 2 L 10 6 L 2 10 z" fill={edgeColor} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: edgeColor,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeLinecap: 'round',
          ...style,
        }}
        markerEnd={`url(#${markerId})`}
      />
      {/* ★ 选中时在曲线中点显示删除按钮 */}
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan absolute flex items-center justify-center w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white text-xs font-bold shadow-md cursor-pointer border border-red-600 transition-colors"
            style={{
              transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)`,
              pointerEvents: 'all',
            }}
            onClick={onDelete}
            title="删除连线"
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
