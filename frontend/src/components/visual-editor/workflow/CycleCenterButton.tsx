/**
 * 闭环中心 + 按钮组件
 * 当画布连线形成闭环时，在几何中心显示一个 + 按钮
 * 点击后触发多图 AI 生成（传入环中所有节点）
 */

'use client';

import React, { useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useViewport } from '@xyflow/react';
import { useMenuCoordination } from './useMenuCoordination';
import { Plus, Sparkles, Video, Wand2, Image as ImageIcon, RotateCcw } from 'lucide-react';
import type { DetectedCycle } from './useCycleDetection';

interface CycleCenterButtonProps {
  cycle: DetectedCycle;
  /** 打开多图生成弹窗 */
  onOpenGeneration?: (nodeIds: string[]) => void;
  /** 重新布局此闭环（排列为正多边形） */
  onRelayout?: (cycleKey: string) => void;
}

export function CycleCenterButton({ cycle, onOpenGeneration, onRelayout }: CycleCenterButtonProps) {
  const [showMenu, setShowMenu] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { broadcastCloseMenus } = useMenuCoordination(() => setShowMenu(false));
  // 将 flow 坐标转换为屏幕坐标（与 AlignmentGuides 同样方式）
  const { zoom, x: vpX, y: vpY } = useViewport();
  const screenX = cycle.center.x * zoom + vpX;
  const screenY = cycle.center.y * zoom + vpY;

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showMenu) broadcastCloseMenus();
    setShowMenu(prev => !prev);
  }, [showMenu, broadcastCloseMenus]);

  const handleGenerate = useCallback((mode: 'multi_image_video' | 'multi_image_image' | 'transition_batch') => {
    setShowMenu(false);
    if (onOpenGeneration) {
      onOpenGeneration(cycle.nodeIds);
    }
  }, [onOpenGeneration, cycle.nodeIds]);

  return (
    <div
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'all',
        zIndex: 5,
      }}
      className="nodrag nopan"
    >
      {/* 中心 + 按钮 */}
      <button
        ref={buttonRef}
        onClick={handleClick}
        className={`
          w-10 h-10 rounded-full flex items-center justify-center
          transition-all duration-200 shadow-lg
          ${showMenu 
            ? 'bg-gray-800 text-white scale-110 ring-4 ring-gray-200' 
            : 'bg-white text-gray-700 hover:bg-gray-800 hover:text-white hover:scale-110 hover:ring-4 hover:ring-gray-200'
          }
          border-2 border-gray-300 hover:border-gray-400
        `}
        title={`${cycle.nodeIds.length} 个节点闭环 · 点击触发多图生成`}
      >
        <Plus size={20} className={showMenu ? 'rotate-45' : ''} style={{ transition: 'transform 0.2s' }} />
      </button>

      {/* 节点数量指示器 */}
      <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gray-800 text-white text-[10px] font-bold flex items-center justify-center shadow-sm border border-white">
        {cycle.nodeIds.length}
      </div>

      {/* Portal 弹窗 */}
      {showMenu && createPortal(
        <>
          <div 
            className="fixed inset-0 z-[200]" 
            onClick={() => setShowMenu(false)}
            onContextMenu={(e) => { e.preventDefault(); setShowMenu(false); }}
          />
          <div
            className="fixed z-[201] bg-white rounded-xl shadow-xl border border-gray-200 py-2 min-w-[240px] animate-in fade-in-0 zoom-in-95 duration-150"
            style={(() => {
              const rect = buttonRef.current?.getBoundingClientRect();
              if (!rect) return { top: 0, left: 0 };
              return {
                top: rect.bottom + 8,
                left: rect.left + rect.width / 2 - 120,
              };
            })()}
          >
            {/* 标题 */}
            <div className="px-3 pb-2 border-b border-gray-100 mb-1">
              <div className="text-xs font-medium text-gray-500">
                闭环生成 · {cycle.nodeIds.length} 个节点
              </div>
            </div>

            {/* 多图生视频 */}
            <button
              onClick={() => handleGenerate('multi_image_video')}
              className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <Video size={16} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                  多图生视频
                </div>
                <div className="text-[11px] text-gray-400">
                  {cycle.nodeIds.length} 张图合成一段视频
                </div>
              </div>
            </button>

            {/* 多图生图 */}
            <button
              onClick={() => handleGenerate('multi_image_image')}
              className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <ImageIcon size={16} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                  多图生图
                </div>
                <div className="text-[11px] text-gray-400">
                  多角度融合 / 品牌 KV
                </div>
              </div>
            </button>

            {/* 批量转场 */}
            <button
              onClick={() => handleGenerate('transition_batch')}
              className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <Sparkles size={16} className="text-gray-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                  批量转场
                </div>
                <div className="text-[11px] text-gray-400">
                  一次生成多段转场模板
                </div>
              </div>
            </button>

            {/* 分隔线 */}
            <div className="border-t border-gray-100 my-1" />

            {/* 重排布局 */}
            <button
              onClick={() => {
                setShowMenu(false);
                onRelayout?.(cycle.key);
              }}
              className="w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <RotateCcw size={16} className="text-gray-600" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                  重排布局
                </div>
                <div className="text-[11px] text-gray-400">
                  将节点排列为正多边形
                </div>
              </div>
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
