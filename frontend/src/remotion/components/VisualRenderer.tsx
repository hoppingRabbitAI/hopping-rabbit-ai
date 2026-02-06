/**
 * VisualRenderer - 视觉配置渲染器
 * 
 * 根据后端返回的 VisualConfig 渲染所有视觉组件
 * 
 * 用法:
 * <VisualRenderer config={visualConfig} />
 */

import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import type { 
  VisualConfig, 
  CanvasConfigWithTiming, 
  OverlayConfigWithTiming,
  PointListCanvasProps,
  ProcessFlowCanvasProps,
} from '../types/visual';

// Canvas 组件
import { PointListCanvas, ProcessFlowCanvas, ComparisonCanvas, ConceptCard } from './canvas';

// Overlay 组件
import {
  KeywordCard,
  DataNumber,
  HighlightBox,
  QuestionHook,
  ChapterTitle,
  ProgressIndicator,
  QuoteBlock,
} from './overlays';

// Background 组件
import { PaperBackground, GradientBackground } from './backgrounds';

interface VisualRendererProps {
  config: VisualConfig;
}

/**
 * 渲染单个画布组件
 */
const CanvasRenderer: React.FC<{ canvas: CanvasConfigWithTiming }> = ({ canvas }) => {
  switch (canvas.type) {
    case 'point-list':
      if (canvas.pointList) {
        return <PointListCanvas {...canvas.pointList} />;
      }
      break;
    case 'process-flow':
      if (canvas.processFlow) {
        return <ProcessFlowCanvas {...canvas.processFlow} />;
      }
      break;
    case 'comparison-table':
      if (canvas.comparisonTable) {
        return <ComparisonCanvas {...canvas.comparisonTable} />;
      }
      break;
    case 'concept-card':
      if (canvas.conceptCard) {
        return <ConceptCard {...canvas.conceptCard} />;
      }
      break;
    default:
      console.warn(`[VisualRenderer] Unknown canvas type: ${canvas.type}`);
  }
  return null;
};

/**
 * 渲染单个叠加组件
 */
const OverlayRenderer: React.FC<{ overlay: OverlayConfigWithTiming }> = ({ overlay }) => {
  switch (overlay.type) {
    case 'keyword-card':
      if (overlay.keywordCard) {
        return <KeywordCard {...overlay.keywordCard} />;
      }
      break;
    case 'data-number':
      if (overlay.dataNumber) {
        return <DataNumber {...overlay.dataNumber} />;
      }
      break;
    case 'highlight-box':
      if (overlay.highlightBox) {
        return <HighlightBox {...overlay.highlightBox} />;
      }
      break;
    case 'question-hook':
      if (overlay.questionHook) {
        return <QuestionHook {...overlay.questionHook} />;
      }
      break;
    case 'chapter-title':
      if (overlay.chapterTitle) {
        return <ChapterTitle {...overlay.chapterTitle} />;
      }
      break;
    case 'progress-indicator':
      if (overlay.progressIndicator) {
        return <ProgressIndicator {...overlay.progressIndicator} />;
      }
      break;
    case 'quote-block':
      if (overlay.quoteBlock) {
        return <QuoteBlock {...overlay.quoteBlock} />;
      }
      break;
    default:
      console.warn(`[VisualRenderer] Unknown overlay type: ${overlay.type}`);
  }
  return null;
};

/**
 * 渲染背景组件
 */
const BackgroundRenderer: React.FC<{ 
  background?: VisualConfig['background'];
}> = ({ background }) => {
  if (!background) return null;
  
  switch (background.type) {
    case 'paper':
      return (
        <PaperBackground 
          color={background.color || '#FDF6E3'}
          texture={background.texture || 'paper'}
        />
      );
    case 'gradient':
      // 将数字角度转换为方向字符串
      const directionMap: Record<number, 'to-bottom' | 'to-right' | 'to-bottom-right'> = {
        0: 'to-bottom',
        90: 'to-right',
        135: 'to-bottom-right',
        180: 'to-bottom',
      };
      const gradientDirection = typeof background.direction === 'number' 
        ? directionMap[background.direction] || 'to-bottom-right'
        : 'to-bottom-right';
      return (
        <GradientBackground
          colors={background.colors || ['#F3F4F6', '#E5E7EB']}
          direction={gradientDirection}
        />
      );
    case 'solid':
      return (
        <AbsoluteFill style={{ backgroundColor: background.color || '#FFFFFF' }} />
      );
    default:
      return null;
  }
};

/**
 * 主渲染器组件
 */
export const VisualRenderer: React.FC<VisualRendererProps> = ({ config }) => {
  const { canvas, overlays, background, pip, fps = 30 } = config;
  
  return (
    <AbsoluteFill>
      {/* 1. 背景层 */}
      <BackgroundRenderer background={background} />
      
      {/* 2. 画布层 (Canvas) - 知识内容主体 */}
      {canvas.map((canvasItem, index) => {
        const startFrame = Math.ceil((canvasItem.startMs / 1000) * fps);
        const endFrame = Math.ceil((canvasItem.endMs / 1000) * fps);
        const duration = endFrame - startFrame;
        
        return (
          <Sequence
            key={`canvas-${canvasItem.segmentId}-${index}`}
            from={startFrame}
            durationInFrames={duration}
            name={`Canvas: ${canvasItem.type}`}
          >
            <CanvasRenderer canvas={canvasItem} />
          </Sequence>
        );
      })}
      
      {/* 3. 叠加层 (Overlays) - 强调和辅助元素 */}
      {overlays.map((overlay, index) => {
        const startFrame = Math.ceil((overlay.startMs / 1000) * fps);
        const endFrame = Math.ceil((overlay.endMs / 1000) * fps);
        const duration = endFrame - startFrame;
        
        return (
          <Sequence
            key={`overlay-${overlay.type}-${index}`}
            from={startFrame}
            durationInFrames={duration}
            name={`Overlay: ${overlay.type}`}
          >
            <OverlayRenderer overlay={overlay} />
          </Sequence>
        );
      })}
      
      {/* 4. PiP 层 - 口播小窗 (由外部视频轨道控制，这里只预留位置) */}
      {pip && (
        <div
          style={{
            position: 'absolute',
            ...getPipPositionStyle(pip.position),
            width: pip.size?.width || 280,
            height: pip.size?.height || 158,
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            // PiP 视频由外部渲染，这里只是占位
            backgroundColor: 'rgba(0,0,0,0.1)',
          }}
        />
      )}
    </AbsoluteFill>
  );
};

/**
 * 获取 PiP 位置样式
 */
function getPipPositionStyle(position: string): React.CSSProperties {
  const margin = 24;
  
  switch (position) {
    case 'top-left':
      return { top: margin, left: margin };
    case 'top-right':
      return { top: margin, right: margin };
    case 'bottom-left':
      return { bottom: margin, left: margin };
    case 'bottom-center':
      return { bottom: margin, left: '50%', transform: 'translateX(-50%)' };
    case 'bottom-right':
    default:
      return { bottom: margin, right: margin };
  }
}
