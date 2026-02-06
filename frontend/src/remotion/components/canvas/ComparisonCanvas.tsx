/**
 * ComparisonCanvas - 对比表格画布
 * 
 * 用于展示两个方案/选项的对比
 * 
 * 特性:
 * - 左右双列布局
 * - 逐行揭示动画
 * - 优缺点图标指示
 */

import React from 'react';
import { 
  AbsoluteFill, 
  interpolate, 
  useCurrentFrame, 
  useVideoConfig,
  spring 
} from 'remotion';
import type { ComparisonCanvasProps, ComparisonRow } from '../../types/visual';

// 行图标
const CheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
    <path
      d="M5 12L10 17L20 7"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CrossIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
    <path
      d="M6 6L18 18M18 6L6 18"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
    />
  </svg>
);

// 判断文本内容的正负性
function getRowSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const positiveMarkers = ['✓', '✔', '√', '优', '好', '高', '快', '低成本', '简单'];
  const negativeMarkers = ['✗', '✘', '×', '缺', '差', '慢', '高成本', '复杂', '难'];
  
  for (const marker of positiveMarkers) {
    if (text.includes(marker)) return 'positive';
  }
  for (const marker of negativeMarkers) {
    if (text.includes(marker)) return 'negative';
  }
  return 'neutral';
}

// 清理文本（移除标记符号）
function cleanText(text: string): string {
  return text
    .replace(/^[✓✔√✗✘×]\s*/, '')
    .trim();
}

// 单行组件
const ComparisonRowItem: React.FC<{
  row: ComparisonRow;
  index: number;
  frame: number;
  fps: number;
}> = ({ row, index, frame, fps }) => {
  const revealFrame = Math.ceil((row.revealAtMs / 1000) * fps);
  const localFrame = frame - revealFrame;
  
  // 入场动画
  const enterProgress = spring({
    frame: Math.max(0, localFrame),
    fps,
    config: {
      mass: 0.6,
      stiffness: 120,
      damping: 14,
    },
  });

  const leftSentiment = getRowSentiment(row.left);
  const rightSentiment = getRowSentiment(row.right);

  if (localFrame < 0) return null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        padding: '16px 0',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        opacity: enterProgress,
        transform: `translateY(${(1 - enterProgress) * 20}px)`,
      }}
    >
      {/* 左列 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          borderRadius: 8,
          backgroundColor: leftSentiment === 'positive' 
            ? 'rgba(34, 197, 94, 0.1)' 
            : leftSentiment === 'negative'
            ? 'rgba(239, 68, 68, 0.1)'
            : 'transparent',
        }}
      >
        {leftSentiment === 'positive' && <CheckIcon color="#22C55E" />}
        {leftSentiment === 'negative' && <CrossIcon color="#EF4444" />}
        <span
          style={{
            fontSize: 22,
            color: leftSentiment === 'positive' 
              ? '#15803D' 
              : leftSentiment === 'negative'
              ? '#DC2626'
              : '#374151',
            fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
          }}
        >
          {cleanText(row.left)}
        </span>
      </div>

      {/* 右列 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          borderRadius: 8,
          backgroundColor: rightSentiment === 'positive' 
            ? 'rgba(34, 197, 94, 0.1)' 
            : rightSentiment === 'negative'
            ? 'rgba(239, 68, 68, 0.1)'
            : 'transparent',
        }}
      >
        {rightSentiment === 'positive' && <CheckIcon color="#22C55E" />}
        {rightSentiment === 'negative' && <CrossIcon color="#EF4444" />}
        <span
          style={{
            fontSize: 22,
            color: rightSentiment === 'positive' 
              ? '#15803D' 
              : rightSentiment === 'negative'
              ? '#DC2626'
              : '#374151',
            fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
          }}
        >
          {cleanText(row.right)}
        </span>
      </div>
    </div>
  );
};

export const ComparisonCanvas: React.FC<ComparisonCanvasProps> = ({
  leftTitle,
  rightTitle,
  rows,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 标题入场动画
  const titleProgress = spring({
    frame,
    fps,
    config: {
      mass: 0.5,
      stiffness: 100,
      damping: 12,
    },
  });

  return (
    <AbsoluteFill
      style={{
        background: '#FFFFFF',
        padding: 60,
      }}
    >
      {/* 表格容器 */}
      <div
        style={{
          maxWidth: 900,
          margin: '0 auto',
          padding: 40,
          backgroundColor: '#FAFAFA',
          borderRadius: 16,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
      >
        {/* 表头 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            marginBottom: 24,
            paddingBottom: 16,
            borderBottom: '2px solid #E5E7EB',
            opacity: titleProgress,
            transform: `translateY(${(1 - titleProgress) * -20}px)`,
          }}
        >
          {/* 左标题 */}
          <div
            style={{
              textAlign: 'center',
              padding: '12px 20px',
              backgroundColor: '#3B82F6',
              borderRadius: 12,
            }}
          >
            <h2
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: '#FFFFFF',
                margin: 0,
                fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
              }}
            >
              {leftTitle}
            </h2>
          </div>

          {/* 右标题 */}
          <div
            style={{
              textAlign: 'center',
              padding: '12px 20px',
              backgroundColor: '#8B5CF6',
              borderRadius: 12,
            }}
          >
            <h2
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: '#FFFFFF',
                margin: 0,
                fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
              }}
            >
              {rightTitle}
            </h2>
          </div>
        </div>

        {/* 表格行 */}
        <div>
          {rows.map((row, index) => (
            <ComparisonRowItem
              key={`row-${index}`}
              row={row}
              index={index}
              frame={frame}
              fps={fps}
            />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
