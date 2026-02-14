/**
 * 自定义 Edge 组件
 * 在两个 Clip 节点之间显示一条线，中间有一个加号按钮
 * 
 * ★★★ 重新设计的交互：
 * 1. 点击 + 弹出轻量 popover（非全屏 modal）
 * 2. 顶部是拖放/点击上传区 → 文件上传后直接变成节点（零确认）
 * 3. 下方保留"从素材库选择""转场模板""AI 生成"入口
 * 4. 单个文件 = 单节点，多文件 = 批量插入
 */

'use client';

import React, { useState, useCallback, useRef, useMemo, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useMenuCoordination } from './useMenuCoordination';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
} from '@xyflow/react';
import { Plus, Video, FileText, Sparkles, Wand2, UploadCloud, Loader2, Image as ImageIcon, Unlink } from 'lucide-react';
import { RELATION_TYPE_CONFIGS, type NodeRelationType } from '@/types/visual-editor';

export interface AddButtonEdgeData extends Record<string, unknown> {
  onAddMaterial?: (sourceId: string, targetId: string) => void;
  onAddText?: (sourceId: string, targetId: string) => void;
  onApplyTransition?: (sourceId: string, targetId: string) => void;
  onOpenGeneration?: (sourceId: string, targetId: string) => void;
  /** ★ 新增：快速上传（拖放/选文件 → 直接变节点） */
  onQuickUpload?: (sourceId: string, targetId: string, files: File[]) => void;
  /** ★ 新增：断开连线（删除目标节点） */
  onDisconnect?: (sourceId: string, targetId: string) => void;
  /** ★ 关联关系类型（箭头边用） */
  relationType?: NodeRelationType;
  /** ★ 关联关系自定义标签 */
  relationLabel?: string;
}

// ★ 自定义 Edge Props（不使用 EdgeProps 泛型，避免类型问题）
interface AddButtonEdgeProps {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  style?: CSSProperties;
  markerEnd?: string;
  data?: AddButtonEdgeData;
  source: string;
  target: string;
}

export function AddButtonEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  source,
  target,
}: AddButtonEdgeProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ★ 菜单协调：打开自己时关闭其他菜单，收到关闭事件时关闭自己
  const { broadcastCloseMenus } = useMenuCoordination(() => setShowMenu(false));
  
  // ★★★ 智能曲线路径：根据 handle position 生成优美的贝塞尔曲线
  // 核心思路：让控制点偏移足够远，使曲线弧度大，不穿过节点
  const { edgePath, labelX, labelY } = useMemo(() => {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 计算贝塞尔控制点偏移量 — 距离越近偏移越大，确保弧度足够
    const minOffset = 60;
    const offset = Math.max(minOffset, dist * 0.4);

    // 根据 handle position 确定控制点方向
    const getControlPoint = (x: number, y: number, pos: Position, off: number) => {
      switch (pos) {
        case Position.Right:  return { x: x + off, y };
        case Position.Left:   return { x: x - off, y };
        case Position.Bottom: return { x, y: y + off };
        case Position.Top:    return { x, y: y - off };
        default:              return { x: x + off, y };
      }
    };

    const cp1 = getControlPoint(sourceX, sourceY, sourcePosition, offset);
    const cp2 = getControlPoint(targetX, targetY, targetPosition, offset);

    // 生成三次贝塞尔路径
    const path = `M ${sourceX},${sourceY} C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${targetX},${targetY}`;

    // 标签位置取曲线中点（三次贝塞尔 t=0.5）
    const t = 0.5;
    const mt = 1 - t;
    const lx = mt*mt*mt*sourceX + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*targetX;
    const ly = mt*mt*mt*sourceY + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*targetY;

    return { edgePath: path, labelX: lx, labelY: ly };
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  // + 按钮的屏幕坐标（用于 portal 定位菜单）
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 处理加号按钮点击
  const handlePlusClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(prev => {
      if (!prev) broadcastCloseMenus();  // ★ 打开时通知其他菜单关闭
      return !prev;
    });
  }, [broadcastCloseMenus]);

  // 处理菜单项点击
  const handleMenuItemClick = useCallback((action: 'material' | 'text' | 'transition' | 'generate' | 'disconnect') => {
    setShowMenu(false);
    if (action === 'material' && data?.onAddMaterial) {
      data.onAddMaterial(source, target);
    } else if (action === 'transition' && data?.onApplyTransition) {
      data.onApplyTransition(source, target);
    } else if (action === 'generate' && data?.onOpenGeneration) {
      data.onOpenGeneration(source, target);
    } else if (action === 'text' && data?.onAddText) {
      data.onAddText(source, target);
    } else if (action === 'disconnect' && data?.onDisconnect) {
      data.onDisconnect(source, target);
    }
  }, [data, source, target]);

  // 关闭菜单
  const handleCloseMenu = useCallback(() => {
    setShowMenu(false);
  }, []);

  // ★ 快速上传：将文件直接变成节点
  const handleQuickFiles = useCallback((files: File[]) => {
    const mediaFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (mediaFiles.length === 0) return;
    
    if (data?.onQuickUpload) {
      setIsUploading(true);
      data.onQuickUpload(source, target, mediaFiles);
      // 关闭菜单，上传由父组件异步处理
      setTimeout(() => {
        setShowMenu(false);
        setIsUploading(false);
      }, 300);
    }
  }, [data, source, target]);

  // ★ 拖放处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleQuickFiles(files);
  }, [handleQuickFiles]);

  // ★ 点击选择文件
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    handleQuickFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleQuickFiles]);

  // ★ 关联关系配置（有关联类型时使用对应颜色/虚线）
  const relationConfig = data?.relationType ? RELATION_TYPE_CONFIGS[data.relationType] : null;
  const edgeColor = relationConfig?.color || '#a5b4cb';
  const markerId = `add-edge-arrow-${id}`;

  // 合并样式 — 半透明柔和线条 + 关联类型样式
  const edgeStyle: CSSProperties = {
    stroke: edgeColor,
    strokeWidth: relationConfig ? 2 : 1.5,
    strokeLinecap: 'round' as const,
    strokeDasharray: relationConfig?.dashArray || undefined,
    ...(style as CSSProperties || {}),
  };

  return (
    <>
      {/* ★ SVG 箭头标记 */}
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path
            d="M 2 2 L 10 6 L 2 10 z"
            fill={edgeColor}
            stroke="none"
          />
        </marker>
      </defs>

      {/* 基础边 — 带箭头 */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={`url(#${markerId})`}
        style={edgeStyle}
      />

      {/* 加号按钮和菜单 */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          {/* ★ 关联类型小标签（在 ➕ 按钮上方） */}
          {relationConfig && (
            <div
              className="flex items-center justify-center mb-1"
            >
              <span
                className="text-[9px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap leading-none"
                style={{
                  backgroundColor: `${edgeColor}18`,
                  color: edgeColor,
                  border: `1px solid ${edgeColor}30`,
                }}
              >
                {data?.relationLabel || relationConfig.label}
              </span>
            </div>
          )}

          {/* 加号按钮 */}
          <button
            ref={buttonRef}
            onClick={handlePlusClick}
            className={`
              w-7 h-7 rounded-full flex items-center justify-center
              transition-all duration-200 shadow-md
              ${showMenu 
                ? 'bg-gray-800 text-white scale-110' 
                : 'bg-white text-gray-400 hover:bg-gray-50 hover:text-gray-700 hover:scale-110'
              }
              border border-gray-200 hover:border-gray-400
            `}
          >
            <Plus size={16} className={showMenu ? 'rotate-45' : ''} style={{ transition: 'transform 0.2s' }} />
          </button>

          {/* ★ 重新设计的操作菜单 — portal 到 body 确保在节点之上 */}
          {showMenu && createPortal(
            <>
              {/* 遮罩层 - 点击/右键关闭菜单 */}
              <div 
                className="fixed inset-0 z-[200]" 
                onClick={handleCloseMenu}
                onContextMenu={(e) => { e.preventDefault(); handleCloseMenu(); }}
              />
              
              {/* 菜单面板 — 基于按钮位置定位 */}
              <div 
                className="fixed z-[201]
                  bg-white rounded-xl shadow-xl border border-gray-200
                  py-2 min-w-[220px]
                  animate-in fade-in-0 zoom-in-95 duration-150"
                style={(() => {
                  const rect = buttonRef.current?.getBoundingClientRect();
                  if (!rect) return { top: 0, left: 0 };
                  return {
                    top: rect.bottom + 8,
                    left: rect.left + rect.width / 2 - 110,
                  };
                })()}
              >
                {/* ★★★ 快速上传区域 — 核心交互 ★★★ */}
                <div className="px-2 pb-2">
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => !isUploading && fileInputRef.current?.click()}
                    className={`
                      relative flex flex-col items-center justify-center gap-1.5
                      rounded-lg border-2 border-dashed cursor-pointer
                      transition-all duration-150 py-4 px-3
                      ${isUploading 
                        ? 'border-gray-400 bg-gray-50'
                        : isDragOver 
                          ? 'border-gray-400 bg-gray-50 scale-[1.02]' 
                          : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                      }
                    `}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    {isUploading ? (
                      <>
                        <Loader2 size={20} className="text-gray-500 animate-spin" />
                        <span className="text-xs text-gray-600 font-medium">上传中...</span>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <UploadCloud size={18} className={isDragOver ? 'text-gray-700' : 'text-gray-400'} />
                          <span className={`text-sm font-medium ${isDragOver ? 'text-gray-700' : 'text-gray-600'}`}>
                            拖放或点击上传
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                          <ImageIcon size={10} />
                          <span>图片</span>
                          <span className="text-gray-300">·</span>
                          <Video size={10} />
                          <span>视频</span>
                          <span className="text-gray-300">·</span>
                          <span>直接变为节点</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* 分隔线 */}
                <div className="my-1 border-t border-gray-100" />
                
                {/* 从素材库选择（打开完整弹窗） */}
                <button
                  onClick={() => handleMenuItemClick('material')}
                  className="w-full px-3 py-2 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
                >
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                    <Video size={14} className="text-gray-500" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                      从素材库选择
                    </div>
                    <div className="text-[11px] text-gray-400">
                      批量浏览和筛选已有素材
                    </div>
                  </div>
                </button>

                {/* 转场模板 */}
                <button
                  onClick={() => handleMenuItemClick('transition')}
                  className="w-full px-3 py-2 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
                >
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                    <Sparkles size={14} className="text-gray-500" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                      转场模板
                    </div>
                    <div className="text-[11px] text-gray-400">
                      首尾帧自动生成
                    </div>
                  </div>
                </button>

                {/* AI 生成 */}
                <button
                  onClick={() => handleMenuItemClick('generate')}
                  className="w-full px-3 py-2 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors group"
                >
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                    <Wand2 size={14} className="text-gray-500" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                      AI 生成
                    </div>
                    <div className="text-[11px] text-gray-400">
                      多图生视频 / 图像生成
                    </div>
                  </div>
                </button>

                {/* 分隔线 */}
                <div className="my-1 border-t border-gray-100" />

                {/* 断开连线 */}
                <button
                  onClick={() => handleMenuItemClick('disconnect')}
                  className="w-full px-3 py-2 text-left flex items-center gap-3 hover:bg-red-50 transition-colors group"
                >
                  <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center group-hover:bg-red-200 transition-colors">
                    <Unlink size={14} className="text-red-500" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-700 group-hover:text-red-700">
                      断开连线
                    </div>
                    <div className="text-[11px] text-gray-400">
                      移除后方节点
                    </div>
                  </div>
                </button>

                {/* 添加文字（预留） */}
                <button
                  onClick={() => handleMenuItemClick('text')}
                  disabled
                  className="w-full px-3 py-2 text-left flex items-center gap-3 opacity-40 cursor-not-allowed"
                >
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                    <FileText size={14} className="text-gray-400" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-400">
                      添加文字
                    </div>
                    <div className="text-[11px] text-gray-300">
                      敬请期待
                    </div>
                  </div>
                </button>
              </div>
            </>,
            document.body
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default AddButtonEdge;
