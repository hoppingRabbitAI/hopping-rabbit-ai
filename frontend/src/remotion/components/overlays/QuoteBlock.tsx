/**
 * QuoteBlock - 引用块组件
 * 
 * 用于显示名言、金句、引用
 */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import type { QuoteBlockProps } from '../../types/visual';

const positionStyles: Record<string, React.CSSProperties> = {
  center: { justifyContent: 'center', alignItems: 'center' },
  top: { justifyContent: 'flex-start', alignItems: 'center', paddingTop: 150 },
  bottom: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 200 },
};

export const QuoteBlock: React.FC<QuoteBlockProps> = ({
  text,
  source,
  position = 'center',
  animation = { enter: 'fade', exit: 'fade' },
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  const posStyle = positionStyles[position] || positionStyles.center;
  
  // 入场动画
  const enterDuration = Math.ceil(fps * 0.6);
  const enterProgress = spring({
    frame,
    fps,
    config: {
      mass: 0.8,
      stiffness: 80,
      damping: 15,
    },
  });
  
  // 出场动画
  const exitDuration = Math.ceil(fps * 0.3);
  const exitProgress = interpolate(
    frame,
    [durationInFrames - exitDuration, durationInFrames],
    [0, 1],
    { extrapolateLeft: 'clamp' }
  );
  
  const opacity = Math.min(enterProgress, 1 - exitProgress);
  
  // 引号动画（延迟出现）
  const quoteProgress = interpolate(
    frame,
    [0, enterDuration * 0.5],
    [0, 1],
    { extrapolateRight: 'clamp' }
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
          position: 'relative',
          backgroundColor: 'rgba(249, 250, 251, 0.98)',
          borderRadius: 20,
          padding: '48px 56px',
          maxWidth: '80%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          borderLeft: '6px solid #9CA3AF',
          opacity,
        }}
      >
        {/* 开引号 */}
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 24,
            fontSize: 72,
            color: '#D1D5DB',
            fontFamily: 'Georgia, serif',
            lineHeight: 1,
            opacity: quoteProgress,
          }}
        >
          "
        </div>
        
        {/* 引用文本 */}
        <div
          style={{
            fontSize: 32,
            fontWeight: 500,
            color: '#374151',
            lineHeight: 1.6,
            fontFamily: '"Noto Serif SC", "Noto Sans SC", serif',
            textAlign: 'center',
            fontStyle: 'italic',
            paddingTop: 20,
          }}
        >
          {text}
        </div>
        
        {/* 闭引号 */}
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            right: 24,
            fontSize: 72,
            color: '#D1D5DB',
            fontFamily: 'Georgia, serif',
            lineHeight: 1,
            opacity: quoteProgress,
          }}
        >
          "
        </div>
        
        {/* 来源 */}
        {source && (
          <div
            style={{
              marginTop: 24,
              fontSize: 22,
              fontWeight: 400,
              color: '#6B7280',
              textAlign: 'right',
              fontFamily: '"Noto Sans SC", sans-serif',
            }}
          >
            —— {source}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
