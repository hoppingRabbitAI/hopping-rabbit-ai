/**
 * KeywordCard - 关键词卡片组件
 * 
 * 用于强调核心观点、关键概念
 * 
 * 样式变体 (共 9 种):
 * 
 * 基础变体:
 * - tip: 💡 提示（黄色调）
 * - warning: ⚠️ 警告（橙色调）
 * - key: 🔑 关键（蓝色调）
 * - quote: 💬 引用（灰色调）
 * 
 * 🆕 Week 3 新增变体:
 * - dark-solid: 深色实心（高对比度）
 * - light-solid: 浅色实心（柔和）
 * - semi-transparent: 半透明毛玻璃效果
 * - gradient: 渐变背景
 * - numbered: 带序号的步骤卡片
 */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { KeywordCardProps, KeywordCardVariant, AnimationConfig } from '../../types/visual';

// 变体样式配置
interface VariantStyle {
  icon: string;
  bgColor: string;
  borderColor: string;
  titleColor: string;
  textColor: string;
  // 🆕 新增属性
  bgGradient?: string;
  backdropFilter?: string;
  boxShadow?: string;
}

const variantStyles: Record<KeywordCardVariant, VariantStyle> = {
  // === 基础变体 ===
  tip: {
    icon: '💡',
    bgColor: 'rgba(255, 243, 205, 0.95)',
    borderColor: '#FFD93D',
    titleColor: '#B8860B',
    textColor: '#5D4E37',
  },
  warning: {
    icon: '⚠️',
    bgColor: 'rgba(255, 237, 213, 0.95)',
    borderColor: '#FF9F43',
    titleColor: '#D35400',
    textColor: '#5D4037',
  },
  key: {
    icon: '🔑',
    bgColor: 'rgba(219, 234, 254, 0.95)',
    borderColor: '#3B82F6',
    titleColor: '#1D4ED8',
    textColor: '#1E3A5F',
  },
  quote: {
    icon: '💬',
    bgColor: 'rgba(243, 244, 246, 0.95)',
    borderColor: '#9CA3AF',
    titleColor: '#4B5563',
    textColor: '#374151',
  },
  
  // === 🆕 Week 3 新增变体 ===
  'dark-solid': {
    icon: '✨',
    bgColor: '#1F2937',
    borderColor: '#374151',
    titleColor: '#F9FAFB',
    textColor: '#E5E7EB',
    boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
  },
  'light-solid': {
    icon: '📌',
    bgColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    titleColor: '#111827',
    textColor: '#374151',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
  },
  'semi-transparent': {
    icon: '💎',
    bgColor: 'rgba(255, 255, 255, 0.15)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
    titleColor: '#FFFFFF',
    textColor: '#F3F4F6',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
  gradient: {
    icon: '🌈',
    bgColor: 'transparent',
    bgGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderColor: 'transparent',
    titleColor: '#FFFFFF',
    textColor: '#F3F4F6',
    boxShadow: '0 10px 40px rgba(102, 126, 234, 0.4)',
  },
  numbered: {
    icon: '', // 序号由 number prop 提供
    bgColor: '#FFFFFF',
    borderColor: '#3B82F6',
    titleColor: '#1D4ED8',
    textColor: '#1E3A5F',
    boxShadow: '0 6px 24px rgba(59, 130, 246, 0.2)',
  },
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

// 默认动画配置
const defaultAnimation: AnimationConfig = { enter: 'zoom', exit: 'fade' };

export const KeywordCard: React.FC<KeywordCardProps> = ({
  title,
  text,
  variant = 'key',
  position = 'center',
  animation = defaultAnimation,
  number,        // 🆕 用于 numbered 变体
  accentColor,   // 🆕 自定义强调色
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  const style = variantStyles[variant];
  const posStyle = positionStyles[position] || positionStyles.center;
  
  // 动画时长（帧数）
  const enterDuration = animation.durationMs 
    ? Math.ceil((animation.durationMs / 1000) * fps) 
    : Math.ceil(fps * 0.3); // 默认 0.3 秒
  const exitDuration = Math.ceil(fps * 0.2);
  
  // 计算动画进度
  const enterProgress = interpolate(
    frame,
    [0, enterDuration],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );
  
  const exitProgress = interpolate(
    frame,
    [durationInFrames - exitDuration, durationInFrames],
    [0, 1],
    { extrapolateLeft: 'clamp' }
  );
  
  // 入场动画
  let enterScale = 1;
  let enterOpacity = 1;
  let enterTranslateY = 0;
  
  switch (animation.enter) {
    case 'zoom':
      enterScale = interpolate(enterProgress, [0, 1], [0.5, 1]);
      enterOpacity = enterProgress;
      break;
    case 'fade':
      enterOpacity = enterProgress;
      break;
    case 'slide-up':
      enterTranslateY = interpolate(enterProgress, [0, 1], [50, 0]);
      enterOpacity = enterProgress;
      break;
    case 'slide-down':
      enterTranslateY = interpolate(enterProgress, [0, 1], [-50, 0]);
      enterOpacity = enterProgress;
      break;
    case 'bounce':
      enterScale = interpolate(
        enterProgress,
        [0, 0.6, 0.8, 1],
        [0.3, 1.1, 0.95, 1]
      );
      enterOpacity = enterProgress;
      break;
    default:
      enterOpacity = enterProgress;
  }
  
  // 出场动画
  const exitOpacity = interpolate(exitProgress, [0, 1], [1, 0]);
  
  // 最终样式
  const opacity = Math.min(enterOpacity, exitOpacity);
  const scale = enterScale;
  const translateY = enterTranslateY;
  
  // 🆕 计算背景样式
  const bgStyle: React.CSSProperties = {
    backgroundColor: style.bgColor,
    ...(style.bgGradient && { background: style.bgGradient }),
    ...(accentColor && variant === 'gradient' && { 
      background: `linear-gradient(135deg, ${accentColor} 0%, ${adjustColor(accentColor, -30)} 100%)` 
    }),
  };
  
  // 🆕 计算边框颜色（支持自定义强调色）
  const borderColor = accentColor && ['key', 'numbered'].includes(variant) 
    ? accentColor 
    : style.borderColor;
  
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        ...posStyle,
      }}
    >
      <div
        style={{
          ...bgStyle,
          border: borderColor !== 'transparent' ? `3px solid ${borderColor}` : 'none',
          borderRadius: 16,
          padding: '24px 36px',
          maxWidth: '80%',
          minWidth: 300,
          boxShadow: style.boxShadow || '0 8px 32px rgba(0,0,0,0.15)',
          backdropFilter: style.backdropFilter,
          opacity,
          transform: `scale(${scale}) translateY(${translateY}px)`,
        }}
      >
        {/* 🆕 Numbered 变体的序号显示 */}
        {variant === 'numbered' && number !== undefined && (
          <div
            style={{
              position: 'absolute',
              top: -16,
              left: -16,
              width: 48,
              height: 48,
              borderRadius: '50%',
              backgroundColor: accentColor || '#3B82F6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 24,
              fontWeight: 700,
              fontFamily: '"Noto Sans SC", sans-serif',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            }}
          >
            {number}
          </div>
        )}
        
        {/* 标题行 */}
        {title && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 16,
              marginLeft: variant === 'numbered' ? 24 : 0,
            }}
          >
            {style.icon && <span style={{ fontSize: 28 }}>{style.icon}</span>}
            <span
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: accentColor && ['key', 'numbered'].includes(variant) 
                  ? accentColor 
                  : style.titleColor,
                fontFamily: '"Noto Sans SC", sans-serif',
              }}
            >
              {title}
            </span>
          </div>
        )}
        
        {/* 内容 */}
        <div
          style={{
            fontSize: title ? 28 : 32,
            fontWeight: 500,
            color: style.textColor,
            lineHeight: 1.5,
            fontFamily: '"Noto Sans SC", sans-serif',
            textAlign: title ? 'left' : 'center',
            marginLeft: variant === 'numbered' && !title ? 24 : 0,
          }}
        >
          {!title && style.icon && <span style={{ marginRight: 12 }}>{style.icon}</span>}
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// 🆕 辅助函数：调整颜色亮度
function adjustColor(color: string, amount: number): string {
  // 简单的颜色调整，支持 hex 格式
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const num = parseInt(hex, 16);
    const r = Math.max(0, Math.min(255, ((num >> 16) & 0xFF) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + amount));
    const b = Math.max(0, Math.min(255, (num & 0xFF) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
  return color;
}
