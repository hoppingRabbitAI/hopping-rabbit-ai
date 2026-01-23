'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { Keyframe, CompoundValue } from '../../types';
import { isCompoundValue } from '../../types';
import { useEditorStore } from '../../store/editor-store';

// ==========================================
// KeyframeDiamond V2
// 使用 offset (0-1) 归一化位置
// ==========================================

/**
 * 格式化关键帧值（支持复合值）
 */
function formatKeyframeValue(value: number | CompoundValue): string {
  if (isCompoundValue(value)) {
    return `(${value.x.toFixed(2)}, ${value.y.toFixed(2)})`;
  }
  return value.toFixed(2);
}

interface KeyframeDiamondProps {
  /** 关键帧数据 */
  keyframe: Keyframe;
  /** 是否选中 */
  isSelected: boolean;
  /** Clip 在时间轴上的像素宽度 */
  clipWidth: number;
}

interface DragState {
  startX: number;
  originalOffset: number;
}

/**
 * 关键帧菱形标记 (V2)
 * 
 * 使用 offset (0-1) 计算位置
 * - offset 0 = clip 开头
 * - offset 1 = clip 结尾
 */
export function KeyframeDiamond({
  keyframe,
  isSelected,
  clipWidth,
}: KeyframeDiamondProps) {
  const selectKeyframe = useEditorStore((s) => s.selectKeyframe);
  const deleteKeyframe = useEditorStore((s) => s.deleteKeyframe);
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // 计算位置（像素） = offset * clipWidth
  const position = useMemo(() => {
    return keyframe.offset * clipWidth;
  }, [keyframe.offset, clipWidth]);
  
  // 点击选中
  const handleSelect = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) {
      selectKeyframe(keyframe.id, e.shiftKey);
    }
  }, [isDragging, selectKeyframe, keyframe.id]);
  
  // 右键删除
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    deleteKeyframe(keyframe.id);
  }, [deleteKeyframe, keyframe.id]);
  
  // 开始拖拽
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    saveToHistory();
    
    setDragState({
      startX: e.clientX,
      originalOffset: keyframe.offset,
    });
    setIsDragging(false);
  }, [saveToHistory, keyframe.offset]);
  
  // 拖拽移动
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState) return;
    
    const deltaX = e.clientX - dragState.startX;
    
    // 超过 3px 才算拖拽
    if (Math.abs(deltaX) > 3) {
      setIsDragging(true);
    }
    
    // 计算新 offset (像素 -> 归一化)
    const deltaOffset = deltaX / clipWidth;
    let newOffset = dragState.originalOffset + deltaOffset;
    
    // 限制在 0-1 范围内
    newOffset = Math.max(0, Math.min(1, newOffset));
    
    // 更新关键帧
    if (Math.abs(newOffset - keyframe.offset) > 0.001) {
      updateKeyframe(keyframe.id, { offset: newOffset });
    }
  }, [dragState, clipWidth, keyframe.id, keyframe.offset, updateKeyframe]);
  
  // 拖拽结束
  const handleMouseUp = useCallback(() => {
    setDragState(null);
    setTimeout(() => setIsDragging(false), 50);
  }, []);
  
  // 绑定全局事件
  useEffect(() => {
    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragState, handleMouseMove, handleMouseUp]);

  // 格式化显示百分比
  const offsetPercent = `${(keyframe.offset * 100).toFixed(0)}%`;
  
  // 根据位置调整 transform，让边缘关键帧保持在 clip 内部
  // offset 接近 0 时向右偏移，接近 1 时向左偏移
  const getTransform = () => {
    if (keyframe.offset <= 0.05) {
      // 左边缘：菱形靠左对齐
      return 'translate(0%, -50%)';
    } else if (keyframe.offset >= 0.95) {
      // 右边缘：菱形靠右对齐
      return 'translate(-100%, -50%)';
    }
    // 中间位置：居中对齐
    return 'translate(-50%, -50%)';
  };
  
  return (
    <div
      className={`keyframe-diamond absolute z-20 ${dragState ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{
        left: `${position}px`,
        top: '50%',
        transform: getTransform(),
      }}
      onClick={handleSelect}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      title={`${keyframe.property}: ${formatKeyframeValue(keyframe.value)} @ ${offsetPercent}\n缓动: ${keyframe.easing}`}
    >
      {/* 扩大的透明点击区域 */}
      <div className="absolute inset-0 w-6 h-6 -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2" />
      {/* 可见的菱形 */}
      <div
        className={`
          relative w-3.5 h-3.5 rotate-45 transition-all
          ${isSelected 
            ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] scale-125' 
            : 'bg-white hover:bg-blue-200 hover:scale-110'
          }
          ${isDragging ? 'scale-150 opacity-80' : ''}
          border-2 border-blue-500/80
          shadow-[0_1px_3px_rgba(0,0,0,0.4)]
        `}
      />
    </div>
  );
}

/**
 * Clip 上的关键帧数量徽章
 * 显示该 clip 上的关键帧总数
 */
interface KeyframeBadgeProps {
  count: number;
}

export function KeyframeBadge({ count }: KeyframeBadgeProps) {
  if (count === 0) return null;
  
  return (
    <div 
      className="absolute top-1 right-1 z-30 bg-blue-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-sm leading-none shadow-md"
      title={`${count} 个关键帧`}
    >
      ◆{count}
    </div>
  );
}

export default KeyframeDiamond;
