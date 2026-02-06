/**
 * PersonPip - 人物画中画组件
 * 
 * 用于在 B-Roll 全屏时显示说话人小窗口
 * 
 * 特性:
 * - 5 种位置: bottom-right, bottom-left, bottom-center, top-right, top-left
 * - 3 种尺寸: small (200x112), medium (280x158), large (360x202)
 * - 3 种形状: rectangle, circle, rounded
 * - 可选边框和阴影
 */

import React from 'react';
import { AbsoluteFill, Video, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { PersonPipProps, ExtendedPipPosition, PipSize, PipShape } from '../../types/visual';

// 尺寸配置 (16:9 比例)
const sizeConfigs: Record<PipSize, { width: number; height: number }> = {
  small: { width: 200, height: 112 },
  medium: { width: 280, height: 158 },
  large: { width: 360, height: 202 },
};

// 位置配置
const positionConfigs: Record<ExtendedPipPosition, React.CSSProperties> = {
  'bottom-right': { bottom: 40, right: 40 },
  'bottom-left': { bottom: 40, left: 40 },
  'bottom-center': { bottom: 40, left: '50%', transform: 'translateX(-50%)' },
  'top-right': { top: 40, right: 40 },
  'top-left': { top: 40, left: 40 },
};

// 形状对应的圆角
const shapeRadius: Record<PipShape, string | number> = {
  rectangle: 8,
  rounded: 16,
  circle: '50%',
};

export const PersonPip: React.FC<PersonPipProps> = ({
  videoSrc,
  position = 'bottom-right',
  size = 'medium',
  shape = 'rounded',
  borderColor = '#FFFFFF',
  borderWidth = 3,
  shadow = true,
  visible = true,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  if (!visible) return null;
  
  const sizeConfig = sizeConfigs[size];
  const positionStyle = positionConfigs[position];
  const borderRadius = shapeRadius[shape];
  
  // 入场动画 (前 15 帧)
  const enterProgress = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
  });
  
  // 出场动画 (最后 10 帧)
  const exitProgress = interpolate(
    frame,
    [durationInFrames - 10, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp' }
  );
  
  const opacity = Math.min(enterProgress, exitProgress);
  const scale = interpolate(enterProgress, [0, 1], [0.8, 1]);
  
  // 对于 circle 形状，使用正方形容器
  const containerSize = shape === 'circle' 
    ? { width: sizeConfig.height, height: sizeConfig.height }
    : sizeConfig;
  
  return (
    <div
      style={{
        position: 'absolute',
        ...positionStyle,
        ...containerSize,
        borderRadius,
        border: `${borderWidth}px solid ${borderColor}`,
        boxShadow: shadow ? '0 8px 32px rgba(0,0,0,0.3)' : 'none',
        overflow: 'hidden',
        opacity,
        transform: `scale(${scale})`,
        zIndex: 100,
      }}
    >
      <Video
        src={videoSrc}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </div>
  );
};

export default PersonPip;
