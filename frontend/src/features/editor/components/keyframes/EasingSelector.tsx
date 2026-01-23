'use client';

import { useState, useRef, useEffect } from 'react';
import type { EasingType, Keyframe } from '../../types';
import { useEditorStore } from '../../store/editor-store';
import { applyEasing } from '../../lib/keyframe-interpolation';

interface EasingSelectorProps {
  keyframe: Keyframe;
  onClose?: () => void;
}

// 缓动类型配置
const EASING_OPTIONS: { type: EasingType; label: string; icon: string }[] = [
  { type: 'linear', label: '线性', icon: '/' },
  { type: 'ease_in', label: '缓入', icon: '⌒' },
  { type: 'ease_out', label: '缓出', icon: '⌓' },
  { type: 'ease_in_out', label: '缓入缓出', icon: 'S' },
  { type: 'hold', label: '保持', icon: '⌐' },
];

/**
 * 绘制缓动曲线预览 (V2: 使用 applyEasing)
 */
function EasingPreview({ easing, isActive }: { easing: EasingType; isActive: boolean }) {
  const width = 40;
  const height = 24;
  const padding = 2;
  
  // 生成曲线路径
  const generatePath = () => {
    const points: string[] = [];
    const steps = 20;
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // 使用统一的 applyEasing 函数
      const y = applyEasing(t, easing);
      
      const x = padding + (t * (width - padding * 2));
      const yPos = height - padding - (y * (height - padding * 2));
      
      if (i === 0) {
        points.push(`M ${x} ${yPos}`);
      } else {
        points.push(`L ${x} ${yPos}`);
      }
    }
    
    return points.join(' ');
  };
  
  return (
    <svg width={width} height={height} className="flex-shrink-0">
      {/* 背景网格 */}
      <rect 
        x={padding} 
        y={padding} 
        width={width - padding * 2} 
        height={height - padding * 2} 
        fill="none" 
        stroke={isActive ? 'rgba(0,255,255,0.3)' : 'rgba(255,255,255,0.1)'} 
        strokeWidth={0.5}
      />
      {/* 曲线 */}
      <path 
        d={generatePath()} 
        fill="none" 
        stroke={isActive ? '#00ffff' : 'rgba(255,255,255,0.6)'} 
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 缓动选择器组件
 */
export function EasingSelector({ keyframe, onClose }: EasingSelectorProps) {
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);
  
  const handleSelectEasing = (easing: EasingType) => {
    updateKeyframe(keyframe.id, { easing });
    setIsOpen(false);
  };
  
  const currentOption = EASING_OPTIONS.find(o => o.type === keyframe.easing) || EASING_OPTIONS[0];
  
  return (
    <div ref={containerRef} className="relative">
      {/* 当前选择的缓动 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-1.5 px-2 py-1 rounded text-xs
          ${isOpen 
            ? 'bg-gray-200 text-gray-700 border border-gray-400' 
            : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100'
          }
          transition-all
        `}
      >
        <EasingPreview easing={keyframe.easing} isActive={isOpen} />
        <span>{currentOption.label}</span>
      </button>
      
      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden min-w-[160px]">
          {EASING_OPTIONS.map((option) => (
            <button
              key={option.type}
              onClick={() => handleSelectEasing(option.type)}
              className={`
                w-full flex items-center gap-2 px-3 py-2 text-xs text-left
                ${keyframe.easing === option.type 
                  ? 'bg-gray-100 text-gray-700' 
                  : 'text-gray-700 hover:bg-gray-50'
                }
                transition-colors
              `}
            >
              <EasingPreview easing={option.type} isActive={keyframe.easing === option.type} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 内联缓动选择器（用于属性面板）
 */
export function InlineEasingSelector({ 
  value, 
  onChange 
}: { 
  value: EasingType; 
  onChange: (easing: EasingType) => void;
}) {
  return (
    <div className="flex gap-1">
      {EASING_OPTIONS.map((option) => (
        <button
          key={option.type}
          onClick={() => onChange(option.type)}
          className={`
            p-1 rounded transition-all
            ${value === option.type 
              ? 'bg-gray-200 text-gray-700 ring-1 ring-gray-400' 
              : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }
          `}
          title={option.label}
        >
          <EasingPreview easing={option.type} isActive={value === option.type} />
        </button>
      ))}
    </div>
  );
}
