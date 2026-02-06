/**
 * ProcessFlowCanvas - 流程/递进图画布
 * 
 * 用于展示递进式内容，如问题 → 概念 → 解释 → 结论
 * 
 * 特性:
 * - 竖向/横向布局
 * - 箭头连接器
 * - 步骤类型区分 (问题/概念/解释/结论)
 * - 渐进式揭示动画
 */

import React from 'react';
import { 
  AbsoluteFill, 
  interpolate, 
  useCurrentFrame, 
  useVideoConfig,
  spring 
} from 'remotion';
import type { ProcessFlowCanvasProps, ProcessFlowStep } from '../../types/visual';

// 步骤类型样式
interface StepStyleConfig {
  bgColor: string;
  borderColor: string;
  textColor: string;
  icon: string;
  label: string;
}

const stepStyles: Record<string, StepStyleConfig> = {
  question: {
    bgColor: '#FEF2F2',
    borderColor: '#EF4444',
    textColor: '#DC2626',
    icon: '❓',
    label: '问题',
  },
  concept: {
    bgColor: '#EFF6FF',
    borderColor: '#3B82F6',
    textColor: '#2563EB',
    icon: '💡',
    label: '概念',
  },
  explanation: {
    bgColor: '#F0FDF4',
    borderColor: '#22C55E',
    textColor: '#16A34A',
    icon: '📝',
    label: '解释',
  },
  conclusion: {
    bgColor: '#FDF4FF',
    borderColor: '#A855F7',
    textColor: '#9333EA',
    icon: '🎯',
    label: '结论',
  },
};

// 箭头连接器组件
const ArrowConnector: React.FC<{
  direction: 'vertical' | 'horizontal';
  progress: number;
  color?: string;
}> = ({ direction, progress, color = '#9CA3AF' }) => {
  const isVertical = direction === 'vertical';
  const size = isVertical ? 40 : 60;
  
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: isVertical ? '100%' : size,
        height: isVertical ? size : '100%',
        opacity: progress,
        transform: isVertical 
          ? `scaleY(${progress})` 
          : `scaleX(${progress})`,
      }}
    >
      <svg
        width={isVertical ? 24 : size}
        height={isVertical ? size : 24}
        viewBox={isVertical ? '0 0 24 40' : '0 0 60 24'}
      >
        {isVertical ? (
          <>
            {/* 竖向箭头 */}
            <line
              x1={12}
              y1={0}
              x2={12}
              y2={32}
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <polyline
              points="6,26 12,34 18,26"
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            {/* 横向箭头 */}
            <line
              x1={0}
              y1={12}
              x2={50}
              y2={12}
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <polyline
              points="44,6 54,12 44,18"
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}
      </svg>
    </div>
  );
};

// 线条连接器
const LineConnector: React.FC<{
  direction: 'vertical' | 'horizontal';
  progress: number;
  color?: string;
}> = ({ direction, progress, color = '#D1D5DB' }) => {
  const isVertical = direction === 'vertical';
  
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: isVertical ? '100%' : 40,
        height: isVertical ? 30 : '100%',
      }}
    >
      <div
        style={{
          width: isVertical ? 3 : `${progress * 100}%`,
          height: isVertical ? `${progress * 100}%` : 3,
          backgroundColor: color,
          borderRadius: 2,
        }}
      />
    </div>
  );
};

// 单个步骤卡片
const StepCard: React.FC<{
  step: ProcessFlowStep;
  index: number;
  frame: number;
  fps: number;
  direction: 'vertical' | 'horizontal';
}> = ({ step, index, frame, fps, direction }) => {
  const activateFrame = Math.ceil((step.activateAtMs / 1000) * fps);
  const localFrame = frame - activateFrame;
  
  const styleConfig = stepStyles[step.type] || stepStyles.explanation;
  
  // 入场动画
  const enterProgress = spring({
    frame: Math.max(0, localFrame),
    fps,
    config: {
      mass: 0.7,
      stiffness: 100,
      damping: 14,
    },
  });

  // 强调动画（激活后轻微脉冲）
  const pulseProgress = localFrame > 0
    ? interpolate(
        Math.sin(localFrame * 0.1),
        [-1, 1],
        [1, 1.02]
      )
    : 1;

  if (localFrame < -fps * 0.1) return null; // 提前一点点显示容器

  const isVertical = direction === 'vertical';
  const hasBorder = step.style?.bordered !== false;
  const textColor = step.style?.color || styleConfig.textColor;

  return (
    <div
      style={{
        opacity: enterProgress,
        transform: `
          ${isVertical ? `translateY(${(1 - enterProgress) * 30}px)` : `translateX(${(1 - enterProgress) * 30}px)`}
          scale(${pulseProgress})
        `,
        transformOrigin: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          padding: hasBorder ? '20px 32px' : '16px 24px',
          backgroundColor: hasBorder ? styleConfig.bgColor : 'transparent',
          border: hasBorder ? `3px solid ${styleConfig.borderColor}` : 'none',
          borderRadius: 12,
          maxWidth: isVertical ? 600 : 280,
          minWidth: isVertical ? 400 : 200,
        }}
      >
        {/* 类型标签 */}
        {hasBorder && (
          <div
            style={{
              position: 'absolute',
              top: -12,
              right: 20,
              backgroundColor: styleConfig.borderColor,
              color: 'white',
              fontSize: 12,
              fontWeight: 600,
              padding: '2px 10px',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{styleConfig.icon}</span>
            <span>{styleConfig.label}</span>
          </div>
        )}
        
        {/* 文本内容 */}
        <p
          style={{
            fontSize: hasBorder ? 24 : 22,
            fontWeight: hasBorder ? 600 : 500,
            color: textColor,
            margin: 0,
            lineHeight: 1.5,
            textAlign: 'center',
            fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
          }}
        >
          {step.text}
        </p>
      </div>
    </div>
  );
};

export const ProcessFlowCanvas: React.FC<ProcessFlowCanvasProps> = ({
  steps,
  direction = 'vertical',
  connector = 'arrow',
  background = 'paper',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 背景色
  const bgColor = background === 'paper' 
    ? '#FDF6E3' 
    : background === 'cream'
    ? '#FFFBEB'
    : '#FFFFFF';

  const isVertical = direction === 'vertical';

  // 计算连接器动画进度
  const getConnectorProgress = (prevStepMs: number, nextStepMs: number) => {
    const prevFrame = Math.ceil((prevStepMs / 1000) * fps);
    const nextFrame = Math.ceil((nextStepMs / 1000) * fps);
    const midFrame = (prevFrame + nextFrame) / 2;
    
    return interpolate(
      frame,
      [prevFrame + fps * 0.3, midFrame],
      [0, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
    );
  };

  return (
    <AbsoluteFill
      style={{
        background: bgColor,
      }}
    >
      {/* 内容区域 */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          flexDirection: isVertical ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0,
          padding: 40,
        }}
      >
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            {/* 步骤卡片 */}
            <StepCard
              step={step}
              index={index}
              frame={frame}
              fps={fps}
              direction={direction}
            />
            
            {/* 连接器 (除了最后一个) */}
            {index < steps.length - 1 && connector !== 'none' && (
              connector === 'arrow' ? (
                <ArrowConnector
                  direction={direction}
                  progress={getConnectorProgress(
                    step.activateAtMs,
                    steps[index + 1].activateAtMs
                  )}
                />
              ) : (
                <LineConnector
                  direction={direction}
                  progress={getConnectorProgress(
                    step.activateAtMs,
                    steps[index + 1].activateAtMs
                  )}
                />
              )
            )}
          </React.Fragment>
        ))}
      </div>
    </AbsoluteFill>
  );
};
