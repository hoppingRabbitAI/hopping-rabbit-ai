/**
 * QuestionHook - 问题钩子组件
 * 
 * 用于开场吸引注意力的问题展示
 * 通常红色文字 + 边框
 */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import type { QuestionHookProps } from '../../types/visual';

const positionStyles: Record<string, React.CSSProperties> = {
  center: { justifyContent: 'center', alignItems: 'center' },
  top: { justifyContent: 'flex-start', alignItems: 'center', paddingTop: 120 },
  bottom: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 200 },
};

export const QuestionHook: React.FC<QuestionHookProps> = ({
  question,
  position = 'center',
  animation = { enter: 'zoom', exit: 'fade' },
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  const posStyle = positionStyles[position] || positionStyles.center;
  
  // Spring 动画
  const springProgress = spring({
    frame,
    fps,
    config: {
      mass: 0.6,
      stiffness: 100,
      damping: 12,
    },
  });
  
  // 入场
  let opacity = springProgress;
  let scale = 1;
  let translateY = 0;
  
  switch (animation.enter) {
    case 'zoom':
      scale = interpolate(springProgress, [0, 1], [0.7, 1]);
      break;
    case 'slide-up':
      translateY = interpolate(springProgress, [0, 1], [60, 0]);
      break;
    case 'bounce':
      scale = spring({
        frame,
        fps,
        config: {
          mass: 0.4,
          stiffness: 200,
          damping: 8,
        },
      });
      break;
  }
  
  // 出场
  const exitDuration = Math.ceil(fps * 0.3);
  const exitOpacity = interpolate(
    frame,
    [durationInFrames - exitDuration, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp' }
  );
  
  opacity = Math.min(opacity, exitOpacity);
  
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        ...posStyle,
      }}
    >
      <div
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          border: '4px solid #E53935',
          borderRadius: 16,
          padding: '32px 48px',
          maxWidth: '85%',
          boxShadow: '0 12px 40px rgba(229, 57, 53, 0.25)',
          opacity,
          transform: `scale(${scale}) translateY(${translateY}px)`,
        }}
      >
        <div
          style={{
            fontSize: 40,
            fontWeight: 700,
            color: '#E53935',
            lineHeight: 1.4,
            textAlign: 'center',
            fontFamily: '"Noto Sans SC", sans-serif',
          }}
        >
          {question}
        </div>
      </div>
    </AbsoluteFill>
  );
};
