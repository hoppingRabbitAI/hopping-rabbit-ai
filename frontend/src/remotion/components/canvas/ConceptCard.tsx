/**
 * ConceptCard - 概念定义卡片画布
 * 
 * 用于展示术语定义和关键要点
 * 
 * 特性:
 * - 术语 + 定义布局
 * - 关键要点列表
 * - 渐进式揭示
 */

import React from 'react';
import { 
  AbsoluteFill, 
  interpolate, 
  useCurrentFrame, 
  useVideoConfig,
  spring 
} from 'remotion';
import type { ConceptCardProps } from '../../types/visual';

export const ConceptCard: React.FC<ConceptCardProps> = ({
  term,
  definition,
  keyPoints = [],
  revealAtMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const revealFrame = Math.ceil((revealAtMs / 1000) * fps);
  const localFrame = frame - revealFrame;

  // 卡片入场动画
  const cardProgress = spring({
    frame: Math.max(0, localFrame),
    fps,
    config: {
      mass: 0.7,
      stiffness: 100,
      damping: 14,
    },
  });

  // 定义文本入场
  const defProgress = spring({
    frame: Math.max(0, localFrame - fps * 0.2),
    fps,
    config: {
      mass: 0.5,
      stiffness: 120,
      damping: 12,
    },
  });

  if (localFrame < 0) return null;

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #F8FAFC 0%, #E2E8F0 100%)',
      }}
    >
      {/* 概念卡片 */}
      <div
        style={{
          maxWidth: 600,
          padding: 48,
          backgroundColor: '#FFFFFF',
          borderRadius: 24,
          boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
          opacity: cardProgress,
          transform: `scale(${0.9 + cardProgress * 0.1}) translateY(${(1 - cardProgress) * 30}px)`,
        }}
      >
        {/* 术语 */}
        <div
          style={{
            textAlign: 'center',
            marginBottom: 24,
          }}
        >
          <h1
            style={{
              fontSize: 56,
              fontWeight: 800,
              color: '#1E40AF',
              margin: 0,
              fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
              letterSpacing: '-0.02em',
            }}
          >
            {term}
          </h1>
          
          {/* 装饰线 */}
          <div
            style={{
              width: 80,
              height: 4,
              backgroundColor: '#3B82F6',
              margin: '16px auto',
              borderRadius: 2,
              transform: `scaleX(${cardProgress})`,
            }}
          />
        </div>

        {/* 定义 */}
        <div
          style={{
            textAlign: 'center',
            marginBottom: keyPoints.length > 0 ? 32 : 0,
            opacity: defProgress,
            transform: `translateY(${(1 - defProgress) * 15}px)`,
          }}
        >
          <p
            style={{
              fontSize: 24,
              color: '#4B5563',
              margin: 0,
              lineHeight: 1.6,
              fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
            }}
          >
            {definition}
          </p>
        </div>

        {/* 关键要点 */}
        {keyPoints.length > 0 && (
          <div
            style={{
              borderTop: '1px solid #E5E7EB',
              paddingTop: 24,
            }}
          >
            {keyPoints.map((point, index) => {
              const pointDelay = 0.4 + index * 0.15;
              const pointProgress = spring({
                frame: Math.max(0, localFrame - fps * pointDelay),
                fps,
                config: {
                  mass: 0.4,
                  stiffness: 100,
                  damping: 12,
                },
              });

              return (
                <div
                  key={`point-${index}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: index < keyPoints.length - 1 ? 12 : 0,
                    opacity: pointProgress,
                    transform: `translateX(${(1 - pointProgress) * -20}px)`,
                  }}
                >
                  {/* 圆点 */}
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#3B82F6',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 20,
                      color: '#374151',
                      fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
                    }}
                  >
                    {point}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
