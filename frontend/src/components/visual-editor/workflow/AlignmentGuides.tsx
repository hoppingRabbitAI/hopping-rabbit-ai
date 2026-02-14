'use client';

/**
 * 对齐参考线覆盖层
 * 在 ReactFlow 画布上渲染对齐吸附线（使用 SVG）
 */

import React from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import type { GuideLine } from './useNodeAlignment';

interface AlignmentGuidesProps {
  guideLines: GuideLine[];
}

export function AlignmentGuides({ guideLines }: AlignmentGuidesProps) {
  const { zoom, x: vpX, y: vpY } = useViewport();

  if (guideLines.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-50"
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
    >
      {guideLines.map((line, i) => {
        // 将 flow 坐标转换为屏幕坐标
        if (line.type === 'vertical') {
          const screenX = line.position * zoom + vpX;
          return (
            <line
              key={`v-${i}`}
              x1={screenX}
              y1={0}
              x2={screenX}
              y2="100%"
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.7}
            />
          );
        } else {
          const screenY = line.position * zoom + vpY;
          return (
            <line
              key={`h-${i}`}
              x1={0}
              y1={screenY}
              x2="100%"
              y2={screenY}
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.7}
            />
          );
        }
      })}
    </svg>
  );
}
