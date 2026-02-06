/**
 * BrollPip - B-Roll 画中画组件
 * 
 * 用于在人物全屏时显示 B-Roll 素材小窗口
 * 支持图片和视频两种媒体类型
 * 
 * 特性:
 * - 5 种位置: bottom-right, bottom-left, bottom-center, top-right, top-left
 * - 3 种尺寸: small, medium, large
 * - 3 种形状: rectangle, circle, rounded
 * - 可选标题字幕
 * - 支持图片和视频
 */

import React from 'react';
import { Img, Video, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { BrollPipProps, ExtendedPipPosition, PipSize, PipShape } from '../../types/visual';

// 尺寸配置 (16:9 比例)
const sizeConfigs: Record<PipSize, { width: number; height: number }> = {
  small: { width: 240, height: 135 },
  medium: { width: 320, height: 180 },
  large: { width: 420, height: 236 },
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

export const BrollPip: React.FC<BrollPipProps> = ({
  mediaSrc,
  mediaType,
  position = 'top-right',
  size = 'medium',
  shape = 'rounded',
  borderColor = 'rgba(255,255,255,0.8)',
  borderWidth = 2,
  shadow = true,
  caption,
  visible = true,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  if (!visible) return null;
  
  const sizeConfig = sizeConfigs[size];
  const positionStyle = positionConfigs[position];
  const borderRadius = shapeRadius[shape];
  
  // 入场动画 (前 20 帧，slide + fade)
  const enterProgress = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });
  
  // 出场动画 (最后 15 帧)
  const exitProgress = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp' }
  );
  
  const opacity = Math.min(enterProgress, exitProgress);
  
  // 根据位置决定滑入方向
  let slideOffset = 0;
  if (position.includes('right')) {
    slideOffset = interpolate(enterProgress, [0, 1], [50, 0]);
  } else if (position.includes('left')) {
    slideOffset = interpolate(enterProgress, [0, 1], [-50, 0]);
  }
  
  // 对于 circle 形状，使用正方形容器
  const containerSize = shape === 'circle' 
    ? { width: sizeConfig.height, height: sizeConfig.height }
    : sizeConfig;
  
  // 有标题时需要额外的高度
  const totalHeight = caption 
    ? containerSize.height + 36 
    : containerSize.height;
  
  return (
    <div
      style={{
        position: 'absolute',
        ...positionStyle,
        width: containerSize.width,
        height: totalHeight,
        opacity,
        transform: `translateX(${slideOffset}px)`,
        zIndex: 90,
      }}
    >
      {/* 媒体容器 */}
      <div
        style={{
          width: containerSize.width,
          height: containerSize.height,
          borderRadius,
          border: `${borderWidth}px solid ${borderColor}`,
          boxShadow: shadow ? '0 6px 24px rgba(0,0,0,0.25)' : 'none',
          overflow: 'hidden',
          backgroundColor: '#000',
        }}
      >
        {mediaType === 'video' ? (
          <Video
            src={mediaSrc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <Img
            src={mediaSrc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        )}
      </div>
      
      {/* 可选标题 */}
      {caption && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 12px',
            backgroundColor: 'rgba(0,0,0,0.7)',
            borderRadius: 8,
            textAlign: 'center',
          }}
        >
          <span
            style={{
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: '"Noto Sans SC", sans-serif',
            }}
          >
            {caption}
          </span>
        </div>
      )}
    </div>
  );
};

export default BrollPip;
