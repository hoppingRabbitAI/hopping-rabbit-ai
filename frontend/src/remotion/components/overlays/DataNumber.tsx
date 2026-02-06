/**
 * DataNumber - 数字动画组件
 * 
 * 用于强调数据、百分比、增长率等
 * 
 * 特性:
 * - 数字滚动动画
 * - 趋势箭头 (上升/下降)
 * - 多种尺寸
 */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import type { DataNumberProps, TrendDirection } from '../../types/visual';

// 尺寸配置
const sizeConfig = {
  small: { valueFontSize: 48, labelFontSize: 20, padding: '16px 24px', arrowSize: 24 },
  medium: { valueFontSize: 72, labelFontSize: 28, padding: '24px 36px', arrowSize: 32 },
  large: { valueFontSize: 96, labelFontSize: 36, padding: '32px 48px', arrowSize: 40 },
};

// 趋势颜色
const trendColors: Record<TrendDirection, { arrow: string; bg: string }> = {
  up: { arrow: '#22C55E', bg: 'rgba(34, 197, 94, 0.1)' },
  down: { arrow: '#EF4444', bg: 'rgba(239, 68, 68, 0.1)' },
  neutral: { arrow: '#6B7280', bg: 'rgba(107, 114, 128, 0.1)' },
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

// 解析数字值用于动画
function parseNumericValue(value: string): { num: number; prefix: string; suffix: string } {
  const match = value.match(/^([^\d]*)([\d.]+)(.*)$/);
  if (match) {
    return {
      prefix: match[1] || '',
      num: parseFloat(match[2]),
      suffix: match[3] || '',
    };
  }
  return { prefix: '', num: 0, suffix: value };
}

// 箭头组件
const TrendArrow: React.FC<{ direction: TrendDirection; size: number; color: string }> = ({
  direction,
  size,
  color,
}) => {
  if (direction === 'neutral') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12H19"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  
  const rotation = direction === 'down' ? 180 : 0;
  
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path
        d="M12 4L12 20M12 4L6 10M12 4L18 10"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const DataNumber: React.FC<DataNumberProps> = ({
  value,
  label,
  trend = 'neutral',
  color,
  size = 'medium',
  position = 'center',
  animation = { enter: 'zoom', exit: 'fade' },
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  const sizeStyle = sizeConfig[size];
  const trendStyle = trendColors[trend];
  const posStyle = positionStyles[position] || positionStyles.center;
  
  // 解析数字
  const { prefix, num, suffix } = parseNumericValue(value);
  
  // Spring 动画配置
  const springConfig = {
    mass: 0.5,
    stiffness: 100,
    damping: 15,
  };
  
  // 入场动画
  const enterProgress = spring({
    frame,
    fps,
    config: springConfig,
    durationInFrames: Math.ceil(fps * 0.5),
  });
  
  // 数字滚动动画
  const numberProgress = spring({
    frame: frame - Math.ceil(fps * 0.1), // 稍微延迟
    fps,
    config: springConfig,
    durationInFrames: Math.ceil(fps * 0.8),
  });
  
  // 当前显示的数字
  const displayNum = interpolate(
    numberProgress,
    [0, 1],
    [0, num],
    { extrapolateRight: 'clamp' }
  );
  
  // 格式化显示数字
  const formatNumber = (n: number): string => {
    if (num >= 1) {
      // 整数或一位小数
      if (num % 1 === 0) {
        return Math.round(n).toString();
      }
      return n.toFixed(1);
    }
    // 小于1的数
    return n.toFixed(2);
  };
  
  // 出场动画
  const exitDuration = Math.ceil(fps * 0.2);
  const exitProgress = interpolate(
    frame,
    [durationInFrames - exitDuration, durationInFrames],
    [0, 1],
    { extrapolateLeft: 'clamp' }
  );
  
  // 计算透明度和缩放
  let scale = 1;
  let opacity = 1;
  
  switch (animation.enter) {
    case 'zoom':
      scale = interpolate(enterProgress, [0, 1], [0.5, 1]);
      opacity = enterProgress;
      break;
    case 'bounce':
      scale = spring({
        frame,
        fps,
        config: {
          mass: 0.3,
          stiffness: 200,
          damping: 10,
        },
      });
      opacity = enterProgress;
      break;
    default:
      opacity = enterProgress;
  }
  
  // 出场淡出
  opacity = Math.min(opacity, 1 - exitProgress);
  
  // 主颜色
  const mainColor = color || (trend === 'up' ? '#22C55E' : trend === 'down' ? '#EF4444' : '#3B82F6');
  
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
          backgroundColor: trendStyle.bg,
          borderRadius: 20,
          padding: sizeStyle.padding,
          opacity,
          transform: `scale(${scale})`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
        }}
      >
        {/* 数字 + 箭头 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: sizeStyle.valueFontSize,
              fontWeight: 800,
              color: mainColor,
              fontFamily: '"Inter", "Noto Sans SC", sans-serif',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {prefix}
            {formatNumber(displayNum)}
            {suffix}
          </span>
          
          {trend !== 'neutral' && (
            <TrendArrow
              direction={trend}
              size={sizeStyle.arrowSize}
              color={trendStyle.arrow}
            />
          )}
        </div>
        
        {/* 标签 */}
        <div
          style={{
            fontSize: sizeStyle.labelFontSize,
            fontWeight: 500,
            color: '#6B7280',
            marginTop: 8,
            fontFamily: '"Noto Sans SC", sans-serif',
          }}
        >
          {label}
        </div>
      </div>
    </AbsoluteFill>
  );
};
