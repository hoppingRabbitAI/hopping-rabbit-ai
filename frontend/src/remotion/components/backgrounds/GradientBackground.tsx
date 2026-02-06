/**
 * GradientBackground - 渐变背景
 * 
 * 支持多种渐变方向和颜色
 */

import React from 'react';
import { AbsoluteFill } from 'remotion';

interface GradientBackgroundProps {
  colors: string[];
  direction?: 'to-bottom' | 'to-right' | 'to-bottom-right' | 'radial';
}

export const GradientBackground: React.FC<GradientBackgroundProps> = ({
  colors,
  direction = 'to-bottom',
}) => {
  // 构建渐变 CSS
  const getGradient = () => {
    if (colors.length === 0) return 'transparent';
    if (colors.length === 1) return colors[0];
    
    const colorStops = colors.join(', ');
    
    switch (direction) {
      case 'to-bottom':
        return `linear-gradient(to bottom, ${colorStops})`;
      case 'to-right':
        return `linear-gradient(to right, ${colorStops})`;
      case 'to-bottom-right':
        return `linear-gradient(to bottom right, ${colorStops})`;
      case 'radial':
        return `radial-gradient(ellipse at center, ${colorStops})`;
      default:
        return `linear-gradient(to bottom, ${colorStops})`;
    }
  };
  
  return (
    <AbsoluteFill
      style={{
        background: getGradient(),
      }}
    />
  );
};
