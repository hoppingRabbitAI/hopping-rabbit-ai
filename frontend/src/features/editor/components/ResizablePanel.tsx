'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';

interface ResizablePanelProps {
  children: React.ReactNode;
  direction: 'horizontal' | 'vertical';
  defaultSize: number;
  minSize: number;
  maxSize: number;
  className?: string;
  resizerPosition?: 'start' | 'end';
  onResize?: (size: number) => void;
}

/**
 * 可调整大小的面板组件
 * - horizontal: 左右拖拽调整宽度
 * - vertical: 上下拖拽调整高度
 */
export function ResizablePanel({
  children,
  direction,
  defaultSize,
  minSize,
  maxSize,
  className = '',
  resizerPosition = 'end',
  onResize,
}: ResizablePanelProps) {
  const [size, setSize] = useState(defaultSize);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSizeRef.current = size;
  }, [direction, size]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = resizerPosition === 'end' 
      ? currentPos - startPosRef.current
      : startPosRef.current - currentPos;
    
    let newSize = startSizeRef.current + delta;
    newSize = Math.max(minSize, Math.min(maxSize, newSize));
    
    setSize(newSize);
    onResize?.(newSize);
  }, [isResizing, direction, minSize, maxSize, resizerPosition, onResize]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = direction === 'horizontal' ? 'ew-resize' : 'ns-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp, direction]);

  const sizeStyle = direction === 'horizontal' 
    ? { width: size } 
    : { height: size };

  const resizerClasses = direction === 'horizontal'
    ? 'w-1 cursor-ew-resize hover:bg-gray-1000/50 active:bg-gray-1000/70'
    : 'h-1 cursor-ns-resize hover:bg-gray-1000/50 active:bg-gray-1000/70';

  const resizerHitArea = direction === 'horizontal'
    ? 'w-3 -ml-1.5 h-full'
    : 'h-3 -mt-1.5 w-full';

  return (
    <div 
      ref={containerRef}
      className={`relative flex-shrink-0 ${className}`}
      style={sizeStyle}
    >
      {resizerPosition === 'start' && (
        <div 
          className={`absolute z-50 ${direction === 'horizontal' ? 'left-0 top-0 bottom-0' : 'top-0 left-0 right-0'} ${resizerHitArea} flex items-center justify-center group`}
          onMouseDown={handleMouseDown}
        >
          <div className={`${resizerClasses} ${direction === 'horizontal' ? 'h-full' : 'w-full'} transition-colors ${isResizing ? 'bg-gray-1000/70' : 'bg-transparent'}`} />
        </div>
      )}
      
      {children}
      
      {resizerPosition === 'end' && (
        <div 
          className={`absolute z-50 ${direction === 'horizontal' ? 'right-0 top-0 bottom-0' : 'bottom-0 left-0 right-0'} ${resizerHitArea} flex items-center justify-center group`}
          onMouseDown={handleMouseDown}
        >
          <div className={`${resizerClasses} ${direction === 'horizontal' ? 'h-full' : 'w-full'} transition-colors ${isResizing ? 'bg-gray-1000/70' : 'bg-transparent'}`} />
        </div>
      )}
    </div>
  );
}

/**
 * 简化版：仅提供拖拽条，不包装子元素
 */
interface ResizerProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  className?: string;
}

export function Resizer({ direction, onResize, className = '' }: ResizerProps) {
  const [isResizing, setIsResizing] = useState(false);
  const startPosRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
  }, [direction]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = currentPos - startPosRef.current;
    startPosRef.current = currentPos;
    
    onResize(delta);
  }, [isResizing, direction, onResize]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = direction === 'horizontal' ? 'ew-resize' : 'ns-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp, direction]);

  const baseClasses = direction === 'horizontal'
    ? 'w-1 cursor-ew-resize flex-shrink-0'
    : 'h-1 cursor-ns-resize flex-shrink-0';

  return (
    <div 
      className={`${baseClasses} ${className} group relative`}
      onMouseDown={handleMouseDown}
    >
      {/* 隐藏的更大点击区域 */}
      <div 
        className={`absolute ${direction === 'horizontal' ? 'w-3 h-full -left-1' : 'h-3 w-full -top-1'} z-10`}
      />
      {/* 可见的拖拽条 */}
      <div 
        className={`${direction === 'horizontal' ? 'w-full h-full' : 'h-full w-full'} 
          bg-gray-200 group-hover:bg-gray-400 transition-colors
          ${isResizing ? 'bg-gray-1000' : ''}`}
      />
    </div>
  );
}
