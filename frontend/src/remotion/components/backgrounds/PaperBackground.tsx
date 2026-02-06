/**
 * PaperBackground - 纸张纹理背景
 * 
 * 白板讲解风的默认背景
 * 支持多种纹理：paper, grid, dots
 */

import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { BackgroundTexture } from '../../types/visual';

interface PaperBackgroundProps {
  color?: string;
  texture?: BackgroundTexture;
}

// 生成纸张噪点纹理的 SVG
const PaperTextureSvg = () => (
  <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="paper-noise">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.04"
          numOctaves="5"
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR type="linear" slope="0.1" />
          <feFuncG type="linear" slope="0.1" />
          <feFuncB type="linear" slope="0.1" />
          <feFuncA type="linear" slope="0.15" intercept="0" />
        </feComponentTransfer>
        <feBlend in="SourceGraphic" mode="multiply" />
      </filter>
    </defs>
    <rect width="100%" height="100%" filter="url(#paper-noise)" />
  </svg>
);

// 网格纹理
const GridTexture: React.FC<{ size?: number; color?: string }> = ({
  size = 40,
  color = 'rgba(0,0,0,0.05)',
}) => (
  <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="grid" width={size} height={size} patternUnits="userSpaceOnUse">
        <path
          d={`M ${size} 0 L 0 0 0 ${size}`}
          fill="none"
          stroke={color}
          strokeWidth="1"
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid)" />
  </svg>
);

// 点阵纹理
const DotsTexture: React.FC<{ size?: number; dotSize?: number; color?: string }> = ({
  size = 30,
  dotSize = 2,
  color = 'rgba(0,0,0,0.08)',
}) => (
  <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="dots" width={size} height={size} patternUnits="userSpaceOnUse">
        <circle cx={size / 2} cy={size / 2} r={dotSize} fill={color} />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#dots)" />
  </svg>
);

export const PaperBackground: React.FC<PaperBackgroundProps> = ({
  color = '#FFFEF5',
  texture = 'paper',
}) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: color,
      }}
    >
      {/* 纹理层 */}
      {texture === 'paper' && (
        <AbsoluteFill style={{ opacity: 1 }}>
          <PaperTextureSvg />
        </AbsoluteFill>
      )}
      
      {texture === 'grid' && (
        <AbsoluteFill>
          <GridTexture />
        </AbsoluteFill>
      )}
      
      {texture === 'dots' && (
        <AbsoluteFill>
          <DotsTexture />
        </AbsoluteFill>
      )}
      
      {/* 边缘渐变阴影（可选，增加质感） */}
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.03) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
