/**
 * PointListCanvas - 要点列表画布
 * 
 * 用于展示知识要点列表，支持手写风格和渐进式揭示
 * 
 * 特性:
 * - 标题 + 副标题
 * - 要点逐条揭示 (typewriter 效果)
 * - 关键词高亮框
 * - 手写/现代/极简风格
 */

import React from 'react';
import { 
  AbsoluteFill, 
  interpolate, 
  useCurrentFrame, 
  useVideoConfig,
  spring 
} from 'remotion';
import type { PointListCanvasProps, PointListItem } from '../../types/visual';

// 预设高亮颜色
const highlightColors: Record<string, string> = {
  green: '#22C55E',
  red: '#EF4444',
  yellow: '#FBBF24',
  blue: '#3B82F6',
};

// 风格配置
interface StyleConfig {
  fontFamily: string;
  titleSize: number;
  itemSize: number;
  itemSpacing: number;
  bulletStyle: (index: number) => string;
  bgColor: string;
}

const styleConfigs: Record<string, StyleConfig> = {
  handwritten: {
    fontFamily: '"Comic Sans MS", "Ma Shan Zheng", cursive, sans-serif',
    titleSize: 48,
    itemSize: 32,
    itemSpacing: 60,
    bulletStyle: () => '•',
    bgColor: '#FDF6E3', // warm paper
  },
  numbered: {
    fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
    titleSize: 44,
    itemSize: 28,
    itemSpacing: 56,
    bulletStyle: (i: number) => `${i + 1}.`,
    bgColor: '#FFFFFF',
  },
  bulleted: {
    fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
    titleSize: 44,
    itemSize: 28,
    itemSpacing: 56,
    bulletStyle: () => '→',
    bgColor: '#FFFFFF',
  },
  checked: {
    fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
    titleSize: 44,
    itemSize: 28,
    itemSpacing: 56,
    bulletStyle: () => '✓',
    bgColor: '#FFFFFF',
  },
};

// 手绘下划线 SVG
const HanddrawnUnderline: React.FC<{ width: number; color: string; progress: number }> = ({
  width,
  color,
  progress,
}) => {
  // 生成略微不规则的路径
  const points = [];
  const segments = 8;
  for (let i = 0; i <= segments; i++) {
    const x = (width / segments) * i;
    const y = 4 + Math.sin(i * 0.8) * 2 + (Math.random() - 0.5) * 1;
    points.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
  }
  const path = points.join(' ');
  const pathLength = width * 1.1;

  return (
    <svg
      width={width}
      height={12}
      style={{
        position: 'absolute',
        bottom: -4,
        left: 0,
      }}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={pathLength}
        strokeDashoffset={pathLength * (1 - progress)}
      />
    </svg>
  );
};

// 高亮框组件
const InlineHighlight: React.FC<{
  word: string;
  color: string;
  progress: number;
}> = ({ word, color, progress }) => {
  const borderColor = highlightColors[color] || color;
  
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        padding: '2px 8px',
        margin: '0 4px',
      }}
    >
      {/* 手绘边框 */}
      <svg
        style={{
          position: 'absolute',
          top: -4,
          left: -4,
          width: 'calc(100% + 8px)',
          height: 'calc(100% + 8px)',
          pointerEvents: 'none',
        }}
      >
        <rect
          x={2}
          y={2}
          width="calc(100% - 4px)"
          height="calc(100% - 4px)"
          fill="none"
          stroke={borderColor}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          rx={4}
          opacity={progress}
          style={{
            transform: `scale(${0.9 + progress * 0.1})`,
            transformOrigin: 'center',
          }}
        />
      </svg>
      <span style={{ position: 'relative', zIndex: 1 }}>{word}</span>
    </span>
  );
};

// 单个列表项组件
const ListItem: React.FC<{
  item: PointListItem;
  index: number;
  styleConfig: StyleConfig;
  frame: number;
  fps: number;
  style: string;
}> = ({ item, index, styleConfig, frame, fps, style }) => {
  const revealFrame = Math.ceil((item.revealAtMs / 1000) * fps);
  const localFrame = frame - revealFrame;
  
  // 入场动画
  const enterProgress = spring({
    frame: Math.max(0, localFrame),
    fps,
    config: {
      mass: 0.8,
      stiffness: 100,
      damping: 15,
    },
  });

  // 打字机效果 - 逐字显示
  const textLength = item.text.length;
  const typewriterDuration = Math.ceil(fps * 0.8); // 0.8秒完成打字
  const charsToShow = Math.min(
    textLength,
    Math.floor(
      interpolate(
        localFrame,
        [0, typewriterDuration],
        [0, textLength],
        { extrapolateRight: 'clamp' }
      )
    )
  );

  // 高亮动画进度
  const highlightProgress = item.highlight
    ? interpolate(
        localFrame,
        [typewriterDuration, typewriterDuration + fps * 0.3],
        [0, 1],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      )
    : 0;

  if (localFrame < 0) return null;

  // 渲染文本（带高亮）
  const renderText = () => {
    const displayText = item.text.slice(0, charsToShow);
    
    if (!item.highlight) {
      return <span>{displayText}</span>;
    }

    const { word, color } = item.highlight;
    const wordIndex = item.text.indexOf(word);
    
    if (wordIndex === -1 || charsToShow <= wordIndex) {
      return <span>{displayText}</span>;
    }

    const beforeHighlight = displayText.slice(0, wordIndex);
    const highlightedWord = displayText.slice(wordIndex, Math.min(wordIndex + word.length, charsToShow));
    const afterHighlight = displayText.slice(wordIndex + word.length);

    return (
      <>
        <span>{beforeHighlight}</span>
        {highlightedWord.length > 0 && (
          <InlineHighlight
            word={highlightedWord}
            color={color}
            progress={highlightProgress}
          />
        )}
        <span>{afterHighlight}</span>
      </>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        opacity: enterProgress,
        transform: `translateY(${(1 - enterProgress) * 20}px)`,
        marginBottom: styleConfig.itemSpacing,
      }}
    >
      {/* 序号/符号 */}
      <span
        style={{
          fontSize: styleConfig.itemSize,
          fontFamily: styleConfig.fontFamily,
          color: style === 'checked' ? '#22C55E' : '#6B7280',
          minWidth: 40,
          fontWeight: 600,
        }}
      >
        {styleConfig.bulletStyle(index)}
      </span>
      
      {/* 文本内容 */}
      <span
        style={{
          fontSize: styleConfig.itemSize,
          fontFamily: styleConfig.fontFamily,
          color: '#1F2937',
          lineHeight: 1.5,
          flex: 1,
        }}
      >
        {renderText()}
        {/* 打字机光标 */}
        {charsToShow < textLength && (
          <span
            style={{
              opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
              color: '#3B82F6',
            }}
          >
            |
          </span>
        )}
      </span>
    </div>
  );
};

export const PointListCanvas: React.FC<PointListCanvasProps> = ({
  title,
  subtitle,
  items,
  style = 'numbered',
  position = 'left',
  background = 'paper',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const styleConfig = styleConfigs[style] || styleConfigs.numbered;

  // 背景色
  const bgColor = background === 'paper' 
    ? '#FDF6E3' 
    : background === 'gradient'
    ? 'linear-gradient(135deg, #F3F4F6 0%, #E5E7EB 100%)'
    : '#FFFFFF';

  // 位置样式
  const positionStyle: React.CSSProperties = {
    left: position === 'left' ? 80 : position === 'center' ? '50%' : 'auto',
    right: position === 'right' ? 80 : 'auto',
    transform: position === 'center' ? 'translateX(-50%)' : 'none',
    width: position === 'center' ? '70%' : '55%',
  };

  // 标题入场动画
  const titleProgress = spring({
    frame,
    fps,
    config: {
      mass: 0.6,
      stiffness: 120,
      damping: 14,
    },
  });

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
          top: 80,
          ...positionStyle,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 标题 */}
        {title && (
          <div
            style={{
              opacity: titleProgress,
              transform: `translateY(${(1 - titleProgress) * -20}px)`,
              marginBottom: subtitle ? 8 : 40,
            }}
          >
            <h1
              style={{
                fontSize: styleConfig.titleSize,
                fontFamily: styleConfig.fontFamily,
                fontWeight: 700,
                color: '#111827',
                margin: 0,
                position: 'relative',
                display: 'inline-block',
              }}
            >
              {title}
              {style === 'handwritten' && (
                <HanddrawnUnderline
                  width={title.length * styleConfig.titleSize * 0.6}
                  color="#3B82F6"
                  progress={titleProgress}
                />
              )}
            </h1>
          </div>
        )}

        {/* 副标题 */}
        {subtitle && (
          <div
            style={{
              opacity: titleProgress,
              marginBottom: 40,
            }}
          >
            <p
              style={{
                fontSize: styleConfig.itemSize * 0.85,
                fontFamily: styleConfig.fontFamily,
                color: '#6B7280',
                margin: 0,
              }}
            >
              {subtitle}
            </p>
          </div>
        )}

        {/* 列表项 */}
        <div>
          {items.map((item, index) => (
            <ListItem
              key={item.id}
              item={item}
              index={index}
              styleConfig={styleConfig}
              frame={frame}
              fps={fps}
              style={style}
            />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
