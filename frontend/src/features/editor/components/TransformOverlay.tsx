'use client';

import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useEditorStore } from '../store/editor-store';
import type { Clip } from '../types/clip';

interface TransformOverlayProps {
  /** 视频容器宽度 */
  containerWidth: number;
  /** 视频容器高度 */
  containerHeight: number;
  /** 当前选中的 clip */
  clip: Clip | null;
  /** 变换更新回调 */
  onTransformChange: (updates: Partial<NonNullable<Clip['transform']>>) => void;
  /** 当前应用的缩放值（考虑关键帧插值后的实际值） */
  currentScale?: number;
  /** 当前应用的 X 偏移（考虑关键帧插值后的实际值） */
  currentOffsetX?: number;
  /** 当前应用的 Y 偏移（考虑关键帧插值后的实际值） */
  currentOffsetY?: number;
  /** 画布缩放比例（用于调整拖拽灵敏度） */
  zoom?: number;
}

type HandlePosition = 'tl' | 'tr' | 'bl' | 'br' | 'move';

interface DragState {
  handle: HandlePosition;
  startX: number;
  startY: number;
  startScale: number;
  startX_offset: number;
  startY_offset: number;
}

/**
 * 变换控制覆盖层
 * 
 * 在视频上显示一个带四角控制点的选择框：
 * - 四角拖拽：等比缩放
 * - 整体拖拽：移动位置
 * - 实时更新 clip 的 transform 属性
 */
export function TransformOverlay({
  containerWidth,
  containerHeight,
  clip,
  onTransformChange,
  currentScale,
  currentOffsetX,
  currentOffsetY,
  zoom = 1,
}: TransformOverlayProps) {
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [snapState, setSnapState] = useState<{ centerX: boolean; centerY: boolean }>({ centerX: false, centerY: false });
  const overlayRef = useRef<HTMLDivElement>(null);

  // clip 的静态 transform 值（用于拖拽起始点计算）
  const transform = clip?.transform || {};
  const staticScale = transform.scale ?? 1;
  const staticOffsetX = transform.x ?? 0;
  const staticOffsetY = transform.y ?? 0;
  
  // 显示用的缩放值 - 优先使用传入的关键帧插值后的值
  const displayScale = currentScale ?? staticScale;

  // ★ 青色框固定为画布边界（不随视频内容变换而变化）
  // 画布就是 containerWidth x containerHeight，青色框完全覆盖
  const boxStyle = useMemo(() => {
    return {
      width: `${containerWidth}px`,
      height: `${containerHeight}px`,
      left: '0px',
      top: '0px',
    };
  }, [containerWidth, containerHeight]);

  // 控制点位置
  const handleSize = 12;
  const handleOffset = -handleSize / 2;

  // 开始拖拽
  const handleMouseDown = useCallback((e: React.MouseEvent, handle: HandlePosition) => {
    e.preventDefault();
    e.stopPropagation();
    
    saveToHistory();
    
    // ★ 使用实际显示位置作为拖拽起始点（关键帧插值后的值）
    // 如果有关键帧覆盖，使用关键帧的值；否则用静态值
    const effectiveX = currentOffsetX ?? staticOffsetX;
    const effectiveY = currentOffsetY ?? staticOffsetY;
    
    setDragState({
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startScale: staticScale,
      startX_offset: effectiveX,
      startY_offset: effectiveY,
    });
  }, [staticScale, staticOffsetX, staticOffsetY, currentOffsetX, currentOffsetY, displayScale, saveToHistory]);

  // 吸附阈值（像素）
  const SNAP_THRESHOLD = 10;

  // 拖拽移动
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      // ★ 关键：delta 需要除以 zoom，因为画布被缩放了
      const deltaX = (e.clientX - dragState.startX) / zoom;
      const deltaY = (e.clientY - dragState.startY) / zoom;

      if (dragState.handle === 'move') {
        // 移动整体
        let newX = dragState.startX_offset + deltaX;
        let newY = dragState.startY_offset + deltaY;
        
        // ★★★ 调试：吸附前的原始位置 ★★★
        const originalX = newX;
        const originalY = newY;
        
        // 跟踪吸附状态
        let snappedCenterX = false;
        let snappedCenterY = false;
        let snapReason = '';
        
        // ★ 计算视频边缘位置（使用 displayScale 考虑关键帧）
        const scale = displayScale;
        const videoHalfW = (containerWidth * scale) / 2;
        const videoHalfH = (containerHeight * scale) / 2;
        const canvasHalfW = containerWidth / 2;
        const canvasHalfH = containerHeight / 2;
        
        // 视频边缘相对于画布中心的位置
        const videoLeft = newX - videoHalfW;
        const videoRight = newX + videoHalfW;
        const videoTop = newY - videoHalfH;
        const videoBottom = newY + videoHalfH;
        
        // ★ X 方向吸附检测（按优先级）
        // 1. 视频中心对齐画布中心
        if (Math.abs(newX) < SNAP_THRESHOLD) {
          newX = 0;
          snappedCenterX = true;
          snapReason = 'X: 中心对齐';
        }
        // 2. 视频左边缘对齐画布左边缘
        else if (Math.abs(videoLeft - (-canvasHalfW)) < SNAP_THRESHOLD) {
          newX = -canvasHalfW + videoHalfW;
          snapReason = 'X: 左边缘对齐';
        }
        // 3. 视频右边缘对齐画布右边缘
        else if (Math.abs(videoRight - canvasHalfW) < SNAP_THRESHOLD) {
          newX = canvasHalfW - videoHalfW;
          snapReason = 'X: 右边缘对齐';
        }
        // 4. 视频左边缘对齐画布中心线
        else if (Math.abs(videoLeft) < SNAP_THRESHOLD) {
          newX = videoHalfW;
          snapReason = 'X: 左边缘贴中心';
        }
        // 5. 视频右边缘对齐画布中心线
        else if (Math.abs(videoRight) < SNAP_THRESHOLD) {
          newX = -videoHalfW;
          snapReason = 'X: 右边缘贴中心';
        }
        
        // ★ Y 方向吸附检测（按优先级）
        // 1. 视频中心对齐画布中心
        if (Math.abs(newY) < SNAP_THRESHOLD) {
          newY = 0;
          snappedCenterY = true;
          snapReason += ' Y: 中心对齐';
        }
        // 2. 视频上边缘对齐画布上边缘
        else if (Math.abs(videoTop - (-canvasHalfH)) < SNAP_THRESHOLD) {
          newY = -canvasHalfH + videoHalfH;
          snapReason += ' Y: 上边缘对齐';
        }
        // 3. 视频下边缘对齐画布下边缘
        else if (Math.abs(videoBottom - canvasHalfH) < SNAP_THRESHOLD) {
          newY = canvasHalfH - videoHalfH;
          snapReason += ' Y: 下边缘对齐';
        }
        // 4. 视频上边缘对齐画布中心线
        else if (Math.abs(videoTop) < SNAP_THRESHOLD) {
          newY = videoHalfH;
          snapReason += ' Y: 上边缘贴中心';
        }
        // 5. 视频下边缘对齐画布中心线
        else if (Math.abs(videoBottom) < SNAP_THRESHOLD) {
          newY = -videoHalfH;
          snapReason += ' Y: 下边缘贴中心';
        }
        
        // 更新吸附状态（用于显示辅助线）
        setSnapState({ centerX: snappedCenterX, centerY: snappedCenterY });
        
        onTransformChange({
          x: newX,
          y: newY,
        });
      } else {
        // 缩放（从角拖拽）
        // 计算缩放比例变化
        const diagonal = Math.sqrt(containerWidth ** 2 + containerHeight ** 2);
        let scaleDelta = 0;
        
        // 根据拖拽方向计算缩放
        switch (dragState.handle) {
          case 'br': // 右下角：向右下拖拽增大
            scaleDelta = (deltaX + deltaY) / diagonal;
            break;
          case 'bl': // 左下角：向左下拖拽增大
            scaleDelta = (-deltaX + deltaY) / diagonal;
            break;
          case 'tr': // 右上角：向右上拖拽增大
            scaleDelta = (deltaX - deltaY) / diagonal;
            break;
          case 'tl': // 左上角：向左上拖拽增大
            scaleDelta = (-deltaX - deltaY) / diagonal;
            break;
        }
        
        const newScale = Math.max(0.1, Math.min(5, dragState.startScale + scaleDelta * 2));
        onTransformChange({ scale: newScale });
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
      setSnapState({ centerX: false, centerY: false });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, containerWidth, containerHeight, onTransformChange, zoom]);

  if (!clip) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none z-20"
    >
      {/* 中心线辅助线 - 垂直线（水平居中时显示） */}
      {snapState.centerX && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 z-30"
          style={{ left: '50%', transform: 'translateX(-50%)' }}
        />
      )}
      
      {/* 中心线辅助线 - 水平线（垂直居中时显示） */}
      {snapState.centerY && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-yellow-400 z-30"
          style={{ top: '50%', transform: 'translateY(-50%)' }}
        />
      )}

      {/* 选择框 */}
      <div
        className="absolute border-2 border-blue-500 pointer-events-auto cursor-move"
        style={boxStyle}
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      >
        {/* 边框虚线装饰 */}
        <div className="absolute inset-0 border border-dashed border-blue-500/50" />
        
        {/* 四角控制点 */}
        {/* 左上 */}
        <div
          className="absolute bg-white border-2 border-blue-500 rounded-sm cursor-nwse-resize pointer-events-auto hover:bg-blue-500 transition-colors"
          style={{
            width: handleSize,
            height: handleSize,
            left: handleOffset,
            top: handleOffset,
          }}
          onMouseDown={(e) => handleMouseDown(e, 'tl')}
        />
        {/* 右上 */}
        <div
          className="absolute bg-white border-2 border-blue-500 rounded-sm cursor-nesw-resize pointer-events-auto hover:bg-blue-500 transition-colors"
          style={{
            width: handleSize,
            height: handleSize,
            right: handleOffset,
            top: handleOffset,
          }}
          onMouseDown={(e) => handleMouseDown(e, 'tr')}
        />
        {/* 左下 */}
        <div
          className="absolute bg-white border-2 border-blue-500 rounded-sm cursor-nesw-resize pointer-events-auto hover:bg-blue-500 transition-colors"
          style={{
            width: handleSize,
            height: handleSize,
            left: handleOffset,
            bottom: handleOffset,
          }}
          onMouseDown={(e) => handleMouseDown(e, 'bl')}
        />
        {/* 右下 */}
        <div
          className="absolute bg-white border-2 border-blue-500 rounded-sm cursor-nwse-resize pointer-events-auto hover:bg-blue-500 transition-colors"
          style={{
            width: handleSize,
            height: handleSize,
            right: handleOffset,
            bottom: handleOffset,
          }}
          onMouseDown={(e) => handleMouseDown(e, 'br')}
        />

        {/* 中心点指示 */}
        <div
          className="absolute w-3 h-3 border-2 border-blue-500 rounded-full bg-white/50"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />

        {/* 缩放百分比显示 */}
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-black/80 text-blue-400 text-[10px] font-mono rounded whitespace-nowrap">
          {Math.round(displayScale * 100)}%
        </div>
      </div>
    </div>
  );
}

export default TransformOverlay;
