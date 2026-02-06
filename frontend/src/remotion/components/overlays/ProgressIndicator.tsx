/**
 * ProgressIndicator - 进度指示组件
 * 
 * 显示当前进度，如 "2 / 5"
 */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ProgressIndicatorProps } from '../../types/visual';

const positionStyles: Record<string, React.CSSProperties> = {
  'top-left': { top: 40, left: 40 },
  'top-right': { top: 40, right: 40 },
  'bottom-left': { bottom: 200, left: 40 },
  'bottom-right': { bottom: 200, right: 40 },
};

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  current,
  total,
  position = 'top-left',
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  const posStyle = positionStyles[position] || positionStyles['top-left'];
  
  // 入场动画
  const enterProgress = interpolate(
    frame,
    [0, Math.ceil(fps * 0.3)],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );
  
  // 出场动画
  const exitProgress = interpolate(
    frame,
    [durationInFrames - Math.ceil(fps * 0.2), durationInFrames],
    [0, 1],
    { extrapolateLeft: 'clamp' }
  );
  
  const opacity = Math.min(enterProgress, 1 - exitProgress);
  
  // 进度条
  const progress = current / total;
  
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          ...posStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          opacity,
        }}
      >
        {/* 数字指示 */}
        <div
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderRadius: 12,
            padding: '12px 20px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          }}
        >
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#3B82F6',
              fontFamily: '"Inter", sans-serif',
            }}
          >
            {current}
          </span>
          <span
            style={{
              fontSize: 24,
              fontWeight: 400,
              color: '#9CA3AF',
              margin: '0 8px',
              fontFamily: '"Inter", sans-serif',
            }}
          >
            /
          </span>
          <span
            style={{
              fontSize: 24,
              fontWeight: 500,
              color: '#6B7280',
              fontFamily: '"Inter", sans-serif',
            }}
          >
            {total}
          </span>
        </div>
        
        {/* 进度条 */}
        <div
          style={{
            width: 80,
            height: 6,
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            borderRadius: 3,
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              backgroundColor: '#3B82F6',
              borderRadius: 3,
              transition: 'width 0.3s ease-out',
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
