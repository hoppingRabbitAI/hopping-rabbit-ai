/**
 * HighlightBox - 高亮框组件
 * 
 * 在关键词周围绘制边框，强调重点
 * 
 * 样式:
 * - solid: 实线边框
 * - dashed: 虚线边框
 * - handdrawn: 手绘风格边框
 */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import type { HighlightBoxProps, HighlightBoxStyle, AnimationConfig } from '../../types/visual';

// 预设颜色
const presetColors: Record<string, string> = {
  green: '#22C55E',
  red: '#EF4444',
  yellow: '#FBBF24',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  orange: '#F97316',
};

// 位置映射
const positionStyles: Record<string, React.CSSProperties> = {
  center: { justifyContent: 'center', alignItems: 'center' },
  top: { justifyContent: 'flex-start', alignItems: 'center', paddingTop: 80 },
  bottom: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 200 },
  'top-left': { justifyContent: 'flex-start', alignItems: 'flex-start', padding: 60 },
  'top-right': { justifyContent: 'flex-start', alignItems: 'flex-end', padding: 60 },
  'bottom-left': { justifyContent: 'flex-end', alignItems: 'flex-start', padding: 60 },
  'bottom-right': { justifyContent: 'flex-end', alignItems: 'flex-end', padding: 60 },
  'bottom-center': { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 200 },
};

// 手绘 SVG 边框路径
const HanddrawnBorder: React.FC<{
  width: number;
  height: number;
  color: string;
  progress: number;
}> = ({ width, height, color, progress }) => {
  // 生成一个稍微不规则的矩形路径
  const padding = 8;
  const w = width + padding * 2;
  const h = height + padding * 2;
  
  // 手绘风格的路径点（带一些随机偏移）
  const path = `
    M ${4} ${6}
    Q ${w * 0.25} ${2}, ${w * 0.5} ${4}
    Q ${w * 0.75} ${6}, ${w - 4} ${5}
    Q ${w - 2} ${h * 0.25}, ${w - 3} ${h * 0.5}
    Q ${w - 5} ${h * 0.75}, ${w - 4} ${h - 5}
    Q ${w * 0.75} ${h - 3}, ${w * 0.5} ${h - 4}
    Q ${w * 0.25} ${h - 6}, ${5} ${h - 4}
    Q ${3} ${h * 0.75}, ${4} ${h * 0.5}
    Q ${6} ${h * 0.25}, ${4} ${6}
  `;
  
  // 路径总长度（估算）
  const pathLength = (w + h) * 2 + 40;
  const strokeDashoffset = pathLength * (1 - progress);
  
  return (
    <svg
      width={w}
      height={h}
      style={{
        position: 'absolute',
        top: -padding,
        left: -padding,
        pointerEvents: 'none',
      }}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={pathLength}
        strokeDashoffset={strokeDashoffset}
        style={{
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
        }}
      />
    </svg>
  );
};

// 默认动画配置
const defaultAnimation: AnimationConfig = { enter: 'draw', exit: 'fade' };

export const HighlightBox: React.FC<HighlightBoxProps> = ({
  text,
  color = 'green',
  boxStyle = 'handdrawn',
  position = 'center',
  animation = defaultAnimation,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  // 解析颜色
  const borderColor = presetColors[color] || color;
  const posStyle = positionStyles[position] || positionStyles.center;
  
  // 文本测量（估算）
  const textWidth = text.length * 36 + 32;
  const textHeight = 56;
  
  // 动画进度
  const enterDuration = animation.durationMs 
    ? Math.ceil((animation.durationMs / 1000) * fps) 
    : Math.ceil(fps * 0.5);
  const exitDuration = Math.ceil(fps * 0.2);
  
  // Draw 动画特殊处理
  const drawProgress = animation.enter === 'draw'
    ? spring({
        frame,
        fps,
        config: {
          mass: 0.5,
          stiffness: 80,
          damping: 15,
        },
        durationInFrames: enterDuration,
      })
    : 1;
  
  // 入场动画
  let opacity = 1;
  let scale = 1;
  
  if (animation.enter === 'draw') {
    opacity = interpolate(frame, [0, fps * 0.1], [0, 1], { extrapolateRight: 'clamp' });
  } else if (animation.enter === 'zoom') {
    const progress = spring({
      frame,
      fps,
      config: {
        mass: 0.5,
        stiffness: 100,
        damping: 15,
      },
    });
    scale = interpolate(progress, [0, 1], [0.8, 1]);
    opacity = progress;
  } else if (animation.enter === 'fade') {
    opacity = interpolate(frame, [0, enterDuration], [0, 1], { extrapolateRight: 'clamp' });
  }
  
  // 出场动画
  const exitOpacity = interpolate(
    frame,
    [durationInFrames - exitDuration, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp' }
  );
  
  opacity = Math.min(opacity, exitOpacity);
  
  // 边框样式
  const getBorderStyle = (): React.CSSProperties => {
    if (boxStyle === 'solid') {
      return {
        border: `4px solid ${borderColor}`,
        borderRadius: 8,
      };
    }
    if (boxStyle === 'dashed') {
      return {
        border: `4px dashed ${borderColor}`,
        borderRadius: 8,
      };
    }
    // handdrawn 由 SVG 处理
    return {};
  };
  
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
          display: 'inline-block',
          padding: '12px 24px',
          opacity,
          transform: `scale(${scale})`,
          ...getBorderStyle(),
        }}
      >
        {/* 手绘边框 */}
        {boxStyle === 'handdrawn' && (
          <HanddrawnBorder
            width={textWidth}
            height={textHeight}
            color={borderColor}
            progress={drawProgress}
          />
        )}
        
        {/* 文本 */}
        <span
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: '#333',
            fontFamily: '"Noto Sans SC", sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {text}
        </span>
      </div>
    </AbsoluteFill>
  );
};
