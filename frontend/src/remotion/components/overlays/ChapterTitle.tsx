/**
 * ChapterTitle - 章节标题组件
 * 
 * 用于显示章节标题，支持带序号
 */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import type { ChapterTitleProps } from '../../types/visual';

const positionStyles: Record<string, React.CSSProperties> = {
  center: { justifyContent: 'center', alignItems: 'center' },
  top: { justifyContent: 'flex-start', alignItems: 'center', paddingTop: 200 },
  bottom: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 250 },
};

export const ChapterTitle: React.FC<ChapterTitleProps> = ({
  number,
  title,
  position = 'center',
  animation = { enter: 'fade', exit: 'fade' },
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  const posStyle = positionStyles[position] || positionStyles.center;
  
  // 入场动画
  const enterDuration = Math.ceil(fps * 0.5);
  const enterProgress = interpolate(
    frame,
    [0, enterDuration],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );
  
  // 出场动画
  const exitDuration = Math.ceil(fps * 0.3);
  const exitProgress = interpolate(
    frame,
    [durationInFrames - exitDuration, durationInFrames],
    [0, 1],
    { extrapolateLeft: 'clamp' }
  );
  
  let opacity = enterProgress;
  let translateY = 0;
  let scale = 1;
  
  switch (animation.enter) {
    case 'slide-up':
      translateY = interpolate(enterProgress, [0, 1], [40, 0]);
      break;
    case 'zoom':
      scale = interpolate(enterProgress, [0, 1], [0.8, 1]);
      break;
  }
  
  opacity = Math.min(opacity, 1 - exitProgress);
  
  // 分隔线动画
  const lineProgress = interpolate(
    frame,
    [enterDuration * 0.3, enterDuration],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        ...posStyle,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity,
          transform: `translateY(${translateY}px) scale(${scale})`,
        }}
      >
        {/* 章节编号 */}
        {number !== undefined && (
          <div
            style={{
              fontSize: 24,
              fontWeight: 500,
              color: '#9CA3AF',
              marginBottom: 12,
              letterSpacing: 4,
              fontFamily: '"Inter", sans-serif',
            }}
          >
            第 {number} 部分
          </div>
        )}
        
        {/* 分隔线 */}
        <div
          style={{
            width: interpolate(lineProgress, [0, 1], [0, 120]),
            height: 3,
            backgroundColor: '#E5E7EB',
            marginBottom: 20,
            borderRadius: 2,
          }}
        />
        
        {/* 标题 */}
        <div
          style={{
            fontSize: 48,
            fontWeight: 700,
            color: '#1F2937',
            textAlign: 'center',
            fontFamily: '"Noto Sans SC", sans-serif',
            maxWidth: '80%',
            lineHeight: 1.3,
          }}
        >
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};
