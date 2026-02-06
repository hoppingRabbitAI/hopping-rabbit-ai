/**
 * DynamicLayout - 动态布局切换组件
 * 
 * 根据时间点在不同布局模式之间切换:
 * - fullscreen: 全屏显示主视频
 * - pip: 主视频缩小为画中画
 * - split: 分屏显示
 * 
 * 支持的切换动画:
 * - smooth: 平滑过渡 (缩放 + 位移)
 * - cut: 硬切
 * - fade: 淡入淡出
 */

import React, { useMemo } from 'react';
import { AbsoluteFill, Video, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { 
  DynamicLayoutProps, 
  LayoutSwitchEvent, 
  ExtendedPipPosition,
  PipSize,
} from '../../types/visual';
import { PersonPip } from './PersonPip';
import { BrollPip } from './BrollPip';

// PiP 尺寸配置
const pipSizes: Record<PipSize, { width: number; height: number }> = {
  small: { width: 200, height: 112 },
  medium: { width: 280, height: 158 },
  large: { width: 360, height: 202 },
};

// PiP 位置坐标
const pipPositionCoords: Record<ExtendedPipPosition, { x: number; y: number }> = {
  'bottom-right': { x: 1920 - 280 - 40, y: 1080 - 158 - 40 },
  'bottom-left': { x: 40, y: 1080 - 158 - 40 },
  'bottom-center': { x: (1920 - 280) / 2, y: 1080 - 158 - 40 },
  'top-right': { x: 1920 - 280 - 40, y: 40 },
  'top-left': { x: 40, y: 40 },
};

type LayoutMode = 'fullscreen' | 'pip' | 'split';

interface LayoutState {
  mode: LayoutMode;
  transitionProgress: number; // 0-1
  prevMode?: LayoutMode;
}

export const DynamicLayout: React.FC<DynamicLayoutProps> = ({
  mainVideoSrc,
  brollSrc,
  brollType = 'image',
  initialLayout = 'fullscreen',
  switches,
  personPipConfig,
  brollPipConfig,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  
  const currentTimeMs = (frame / fps) * 1000;
  
  // 计算当前布局状态
  const layoutState = useMemo((): LayoutState => {
    // 找到当前应用的切换事件
    let currentMode = initialLayout;
    let transitionProgress = 1;
    let prevMode: LayoutMode | undefined;
    
    for (let i = 0; i < switches.length; i++) {
      const switchEvent = switches[i];
      const switchTimeMs = switchEvent.timeMs;
      const transitionDuration = switchEvent.transitionDurationMs || 300;
      
      if (currentTimeMs >= switchTimeMs) {
        // 已过切换点
        const timeSinceSwitch = currentTimeMs - switchTimeMs;
        
        if (timeSinceSwitch < transitionDuration) {
          // 正在过渡中
          prevMode = switchEvent.fromLayout;
          currentMode = switchEvent.toLayout;
          transitionProgress = timeSinceSwitch / transitionDuration;
        } else {
          // 过渡完成
          currentMode = switchEvent.toLayout;
          transitionProgress = 1;
        }
      }
    }
    
    return { mode: currentMode, transitionProgress, prevMode };
  }, [currentTimeMs, switches, initialLayout]);
  
  // 计算主视频的变换
  const mainVideoTransform = useMemo(() => {
    const { mode, transitionProgress, prevMode } = layoutState;
    
    // 全屏状态
    const fullscreenState = { x: 0, y: 0, width: 1920, height: 1080, opacity: 1 };
    
    // PiP 状态
    const pipSize = personPipConfig?.size || 'medium';
    const pipPosition = personPipConfig?.position || 'bottom-right';
    const pipDimensions = pipSizes[pipSize];
    const pipCoords = pipPositionCoords[pipPosition];
    const pipState = { 
      x: pipCoords.x, 
      y: pipCoords.y, 
      width: pipDimensions.width, 
      height: pipDimensions.height,
      opacity: 1,
    };
    
    // 分屏状态 (左半边)
    const splitState = { x: 0, y: 0, width: 960, height: 1080, opacity: 1 };
    
    const getStateForMode = (m: LayoutMode) => {
      switch (m) {
        case 'fullscreen': return fullscreenState;
        case 'pip': return pipState;
        case 'split': return splitState;
      }
    };
    
    if (transitionProgress >= 1 || !prevMode) {
      return getStateForMode(mode);
    }
    
    // 过渡中，插值计算
    const from = getStateForMode(prevMode);
    const to = getStateForMode(mode);
    
    return {
      x: interpolate(transitionProgress, [0, 1], [from.x, to.x]),
      y: interpolate(transitionProgress, [0, 1], [from.y, to.y]),
      width: interpolate(transitionProgress, [0, 1], [from.width, to.width]),
      height: interpolate(transitionProgress, [0, 1], [from.height, to.height]),
      opacity: interpolate(transitionProgress, [0, 1], [from.opacity, to.opacity]),
    };
  }, [layoutState, personPipConfig]);
  
  // B-Roll 显示逻辑
  const showBroll = layoutState.mode === 'pip' || layoutState.mode === 'split';
  const brollOpacity = layoutState.transitionProgress < 1 && layoutState.prevMode === 'fullscreen'
    ? layoutState.transitionProgress
    : showBroll ? 1 : 0;
  
  return (
    <AbsoluteFill>
      {/* B-Roll 背景层 (当主视频为 PiP 时全屏显示) */}
      {brollSrc && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            opacity: brollOpacity,
            zIndex: 1,
          }}
        >
          {brollType === 'video' ? (
            <Video
              src={brollSrc}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Img
              src={brollSrc}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </div>
      )}
      
      {/* 主视频层 */}
      <div
        style={{
          position: 'absolute',
          left: mainVideoTransform.x,
          top: mainVideoTransform.y,
          width: mainVideoTransform.width,
          height: mainVideoTransform.height,
          opacity: mainVideoTransform.opacity,
          borderRadius: layoutState.mode === 'pip' ? 16 : 0,
          overflow: 'hidden',
          boxShadow: layoutState.mode === 'pip' ? '0 8px 32px rgba(0,0,0,0.3)' : 'none',
          border: layoutState.mode === 'pip' ? '3px solid rgba(255,255,255,0.9)' : 'none',
          zIndex: 10,
          transition: 'border-radius 0.2s ease',
        }}
      >
        <Video
          src={mainVideoSrc}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      
      {/* 分屏模式下的 B-Roll (右半边) */}
      {layoutState.mode === 'split' && brollSrc && (
        <div
          style={{
            position: 'absolute',
            left: 960,
            top: 0,
            width: 960,
            height: 1080,
            opacity: layoutState.transitionProgress,
            zIndex: 5,
          }}
        >
          {brollType === 'video' ? (
            <Video
              src={brollSrc}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Img
              src={brollSrc}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};

export default DynamicLayout;
