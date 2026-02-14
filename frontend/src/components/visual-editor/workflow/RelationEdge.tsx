/**
 * RelationEdge — 带有关联关系类型的自定义 Edge
 * 
 * 与 AddButtonEdge 不同，RelationEdge 用于展示节点之间的来源/溯源关系：
 * - 不同颜色表示不同关系类型（拆分、AI 生成、换背景、提取帧、抠图等）
 * - 带方向性箭头（从来源指向派生）
 * - 中间显示关系类型标签
 * - 虚线/实线区分直接/间接关系
 */

'use client';

import React, { useMemo, CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
} from '@xyflow/react';
import type { LucideIcon } from 'lucide-react';
import {
  Scissors,
  Sparkles,
  ImagePlus,
  Frame,
  Layers,
  Link,
  Combine,
  Copy,
  ArrowRightLeft,
  Palette,
  Link2,
  ArrowRight,
} from 'lucide-react';
import { RELATION_TYPE_CONFIGS, type NodeRelationType } from '@/types/visual-editor';

// ==========================================
// 关联关系 Edge 数据
// ==========================================

export interface RelationEdgeData extends Record<string, unknown> {
  relationType: NodeRelationType;
  relationLabel?: string;    // 自定义标签，覆盖默认
  onRemoveRelation?: (edgeId: string) => void;
}

interface RelationEdgeProps {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  style?: CSSProperties;
  data?: RelationEdgeData;
  source: string;
  target: string;
  selected?: boolean;
}

// ==========================================
// Icon 映射
// ==========================================

const ICON_MAP: Record<string, LucideIcon> = {
  Scissors,
  Sparkles,
  ImagePlus,
  Frame,
  Layers,
  Link,
  Combine,
  Copy,
  ArrowRightLeft,
  Palette,
  Link2,
};

export function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
  selected,
}: RelationEdgeProps) {
  const relationType = data?.relationType || 'reference';
  const config = RELATION_TYPE_CONFIGS[relationType];
  const label = data?.relationLabel || config.label;
  const IconComponent = ICON_MAP[config.icon] || Link2;

  // ★ 贝塞尔曲线路径（与 AddButtonEdge 保持一致的曲线风格）
  const { edgePath, labelX, labelY, arrowAngle } = useMemo(() => {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const minOffset = 50;
    const offset = Math.max(minOffset, dist * 0.35);

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

    // 标签位置 t=0.5
    const t = 0.5;
    const mt = 1 - t;
    const lx = mt*mt*mt*sourceX + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*targetX;
    const ly = mt*mt*mt*sourceY + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*targetY;

    // 箭头方向：在 t=0.85 处的切线方向
    const at = 0.85;
    const amt = 1 - at;
    // 一阶导数在 t=at 处
    const tdx = 3*amt*amt*(cp1.x-sourceX) + 6*amt*at*(cp2.x-cp1.x) + 3*at*at*(targetX-cp2.x);
    const tdy = 3*amt*amt*(cp1.y-sourceY) + 6*amt*at*(cp2.y-cp1.y) + 3*at*at*(targetY-cp2.y);
    const angle = Math.atan2(tdy, tdx) * (180 / Math.PI);

    return { edgePath: path, labelX: lx, labelY: ly, arrowAngle: angle };
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  // ★ SVG marker ID（每种关系类型一个颜色的箭头）
  const markerId = `relation-arrow-${relationType}`;

  // 边样式
  const edgeStyle: CSSProperties = {
    stroke: config.color,
    strokeWidth: selected ? 2.5 : 2,
    strokeLinecap: 'round' as const,
    strokeDasharray: config.dashArray || undefined,
    filter: selected ? `drop-shadow(0 0 4px ${config.color}60)` : undefined,
    transition: 'stroke-width 0.2s, filter 0.2s',
    ...(style as CSSProperties || {}),
  };

  return (
    <>
      {/* SVG 箭头标记定义 */}
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
          <path
            d="M 2 2 L 10 6 L 2 10 z"
            fill={config.color}
            stroke="none"
          />
        </marker>
      </defs>

      {/* 关联线条 */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={edgeStyle}
        markerEnd={`url(#${markerId})`}
      />

      {/* 关系类型标签 */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <div
            className={`
              flex items-center gap-1.5 px-2.5 py-1 rounded-full
              text-[11px] font-medium whitespace-nowrap
              border shadow-sm backdrop-blur-sm
              transition-all duration-200 cursor-default
              ${selected ? 'scale-110 shadow-md' : 'hover:scale-105'}
            `}
            style={{
              backgroundColor: `${config.color}15`,
              borderColor: `${config.color}40`,
              color: config.color,
            }}
            title={config.description}
          >
            <IconComponent size={12} />
            <span>{label}</span>
            <ArrowRight size={10} className="opacity-60" />
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default RelationEdge;
