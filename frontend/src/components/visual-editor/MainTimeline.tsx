'use client';

/**
 * 主线 Timeline — 连续色带条设计
 *
 * 交互模型：
 *   收起态  → 底部一根 8px 高的"胶片条"，每段按时长比例着色
 *   半展开  → 36px 高，段内嵌缩略图 + 序号
 *   全展开  → 80px 高，显示缩略图 + 标签 + 时长 + hover 操作
 *   点击条可切换展开/收起，双击段可高亮对应画布节点
 *
 * 功能：
 *   - 拖拽重排段
 *   - 右键菜单：拆分 / 复制 / 左移 / 右移 / 删除
 *   - Trim 手柄：拖拽段两侧边缘调整时长
 *
 * 核心概念：画布节点驱动 → 导出只认主线
 */

import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronUp,
  ChevronDown,
  Film,
  Image as ImageIcon,
  Trash2,
  Plus,
  Download,
  ListVideo,
  X,
  Clock,
  Sparkles,
  Play,
  Scissors,
  Copy,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import type { TimelineSegment, TimelinePanelState } from '@/types/visual-editor';
import ExportModal from './ExportModal';

// ==========================================
// 工具
// ==========================================

function fmtMs(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// 段类型 → 色系（渐变起止色）
const SEGMENT_COLORS: Record<string, { from: string; to: string; ring: string; text: string }> = {
  video:        { from: '#6b7280', to: '#4b5563', ring: 'ring-gray-400',  text: 'text-gray-100' },
  image:        { from: '#6b7280', to: '#4b5563', ring: 'ring-gray-400', text: 'text-gray-100' },
  'ai-generated': { from: '#6b7280', to: '#4b5563', ring: 'ring-gray-400', text: 'text-gray-100' },
  transition:   { from: '#6b7280', to: '#4b5563', ring: 'ring-gray-400', text: 'text-gray-100' },
};

function colorFor(type: string) {
  return SEGMENT_COLORS[type] || SEGMENT_COLORS.video;
}

// 每段最小像素宽度（防止极短段不可见）
const MIN_SEG_PX = 32;

// ==========================================
// 右键菜单组件
// ==========================================

interface ContextMenuProps {
  x: number;
  y: number;
  segmentId: string;
  segmentIndex: number;
  segmentCount: number;
  canSplit: boolean;
  onClose: () => void;
}

function SegmentContextMenu({ x, y, segmentId, segmentIndex, segmentCount, canSplit, onClose }: ContextMenuProps) {
  const splitSegment = useVisualEditorStore((s) => s.splitSegment);
  const duplicateSegment = useVisualEditorStore((s) => s.duplicateSegment);
  const removeFromTimeline = useVisualEditorStore((s) => s.removeFromTimeline);
  const moveSegmentLeft = useVisualEditorStore((s) => s.moveSegmentLeft);
  const moveSegmentRight = useVisualEditorStore((s) => s.moveSegmentRight);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const items: { label: string; icon: React.ReactNode; action: () => void; disabled?: boolean; danger?: boolean }[] = [
    {
      label: '拆分片段',
      icon: <Scissors size={13} />,
      action: () => { splitSegment(segmentId); onClose(); },
      disabled: !canSplit,
    },
    {
      label: '复制片段',
      icon: <Copy size={13} />,
      action: () => { duplicateSegment(segmentId); onClose(); },
    },
    {
      label: '前移',
      icon: <ArrowLeft size={13} />,
      action: () => { moveSegmentLeft(segmentId); onClose(); },
      disabled: segmentIndex === 0,
    },
    {
      label: '后移',
      icon: <ArrowRight size={13} />,
      action: () => { moveSegmentRight(segmentId); onClose(); },
      disabled: segmentIndex >= segmentCount - 1,
    },
    {
      label: '删除片段',
      icon: <Trash2 size={13} />,
      action: () => { removeFromTimeline(segmentId); onClose(); },
      danger: true,
    },
  ];

  // 确保菜单不超出视窗
  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36 - 16);

  return createPortal(
    <>
      {/* 透明遮罩 */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      {/* 菜单面板 */}
      <div
        ref={menuRef}
        className="fixed z-[9999] bg-white rounded-lg shadow-xl border border-gray-200/80 py-1.5 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
        style={{ left: adjustedX, top: adjustedY }}
      >
        {items.map((item, i) => (
          <React.Fragment key={item.label}>
            {item.danger && i > 0 && <div className="my-1 border-t border-gray-100" />}
            <button
              onClick={item.action}
              disabled={item.disabled}
              className={`
                w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors
                ${item.disabled
                  ? 'text-gray-300 cursor-not-allowed'
                  : item.danger
                    ? 'text-red-500 hover:bg-red-50'
                    : 'text-gray-600 hover:bg-gray-100'
                }
              `}
            >
              {item.icon}
              {item.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </>,
    document.body,
  );
}

// ==========================================
// 单个段条（含 Trim 手柄 + 右键菜单触发）
// ==========================================

interface SegmentBarProps {
  segment: TimelineSegment;
  index: number;
  totalCount: number;
  widthPercent: number;
  panelState: TimelinePanelState;
  isActive: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onRemove: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, segmentId: string, index: number) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, targetId: string) => void;
}

function SegmentBar({
  segment,
  index,
  totalCount,
  widthPercent,
  panelState,
  isActive,
  isDragging,
  isDragOver,
  onRemove,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: SegmentBarProps) {
  const c = colorFor(segment.mediaType);
  const isCollapsed = panelState === 'collapsed';
  const isExpanded = panelState === 'expanded';
  const isVideo = segment.mediaType === 'video' || segment.mediaType === 'ai-generated';
  const isAI = segment.mediaType === 'ai-generated';

  const updateSegmentDuration = useVisualEditorStore((s) => s.updateSegmentDuration);

  // -------- Trim 手柄（仅展开态可用） --------
  const trimRef = useRef<{
    side: 'left' | 'right';
    startX: number;
    startDuration: number;
  } | null>(null);

  const handleTrimStart = useCallback((e: React.MouseEvent, side: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();
    trimRef.current = {
      side,
      startX: e.clientX,
      startDuration: segment.durationMs,
    };

    const handleTrimMove = (ev: MouseEvent) => {
      if (!trimRef.current) return;
      const dx = ev.clientX - trimRef.current.startX;
      // 1px ≈ 50ms
      const msDelta = dx * 50;
      const newDuration = trimRef.current.side === 'right'
        ? trimRef.current.startDuration + msDelta
        : trimRef.current.startDuration - msDelta;
      updateSegmentDuration(segment.id, Math.round(newDuration));
    };

    const handleTrimEnd = () => {
      trimRef.current = null;
      window.removeEventListener('mousemove', handleTrimMove);
      window.removeEventListener('mouseup', handleTrimEnd);
    };

    window.addEventListener('mousemove', handleTrimMove);
    window.addEventListener('mouseup', handleTrimEnd);
  }, [segment.id, segment.durationMs, updateSegmentDuration]);

  return (
    <div
      draggable={!isCollapsed}
      onDragStart={(e) => onDragStart(e, segment.id)}
      onDragOver={(e) => onDragOver(e, segment.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, segment.id)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, segment.id, index); }}
      className={`
        group relative overflow-hidden transition-all duration-200
        ${isCollapsed ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}
        ${isDragging ? 'opacity-40 scale-95' : ''}
        ${isDragOver ? 'ring-2 ring-white ring-offset-1' : ''}
        ${isActive && !isCollapsed ? `ring-2 ${c.ring} ring-offset-1` : ''}
      `}
      style={{
        width: `${widthPercent}%`,
        minWidth: isCollapsed ? 4 : MIN_SEG_PX,
        background: `linear-gradient(135deg, ${c.from}, ${c.to})`,
        borderRadius: isCollapsed ? 0 : 6,
      }}
      title={isCollapsed ? `#${index + 1} ${segment.label || ''} (${fmtMs(segment.durationMs)})` : undefined}
    >
      {/* ——— 收起态：纯色条 ——— */}
      {isCollapsed && (
        <div className="w-full h-full" />
      )}

      {/* ——— 半展开态：缩略图 + 序号 ——— */}
      {panelState === 'half' && (
        <div className="relative w-full h-full flex items-center px-1.5 gap-1.5">
          {/* 缩略图圆角小方块 */}
          {segment.thumbnail && (
            <img
              src={segment.thumbnail}
              className="h-6 w-6 rounded object-cover flex-shrink-0 border border-white/30"
              alt=""
            />
          )}
          {/* 序号 + 时长 */}
          <span className={`text-[10px] font-bold ${c.text} drop-shadow-sm truncate`}>
            {index + 1}
          </span>
          <span className={`text-[10px] ${c.text} opacity-80 truncate hidden sm:inline`}>
            {fmtMs(segment.durationMs)}
          </span>
        </div>
      )}

      {/* ——— 全展开态：完整信息 ——— */}
      {isExpanded && (
        <div className="relative w-full h-full flex items-stretch">
          {/* 缩略图区域 */}
          <div className="relative h-full aspect-video flex-shrink-0 overflow-hidden">
            {segment.thumbnail ? (
              <img
                src={segment.thumbnail}
                className="w-full h-full object-cover"
                alt=""
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-black/20">
                {isAI ? <Sparkles size={16} className="text-white/60" />
                  : isVideo ? <Film size={16} className="text-white/60" />
                  : <ImageIcon size={16} className="text-white/60" />}
              </div>
            )}
            {/* 序号角标 */}
            <div className="absolute top-0.5 left-0.5 min-w-[16px] h-4 px-1 rounded bg-black/50 flex items-center justify-center">
              <span className="text-[10px] font-bold text-white leading-none">{index + 1}</span>
            </div>
          </div>

          {/* 文字信息 */}
          <div className="flex-1 min-w-0 flex flex-col justify-center px-2 py-1">
            <div className={`text-[11px] font-semibold ${c.text} truncate leading-tight`}>
              {segment.label || `片段 ${index + 1}`}
            </div>
            <div className={`text-[10px] ${c.text} opacity-70 flex items-center gap-1 mt-0.5`}>
              <Clock size={9} />
              {fmtMs(segment.durationMs)}
            </div>
          </div>

          {/* hover 删除按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(segment.id);
            }}
            className="absolute top-1 right-1 p-0.5 rounded-full bg-black/40 text-white/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white z-10"
          >
            <X size={10} />
          </button>

          {/* —— Trim 手柄：左侧 —— */}
          <div
            onMouseDown={(e) => handleTrimStart(e, 'left')}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/50 z-10"
            title="拖拽调整起点"
          >
            <div className="absolute top-1/2 left-0 -translate-y-1/2 w-0.5 h-4 bg-white/80 rounded-full" />
          </div>
          {/* —— Trim 手柄：右侧 —— */}
          <div
            onMouseDown={(e) => handleTrimStart(e, 'right')}
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/50 z-10"
            title="拖拽调整终点"
          >
            <div className="absolute top-1/2 right-0 -translate-y-1/2 w-0.5 h-4 bg-white/80 rounded-full" />
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 主组件
// ==========================================

export default function MainTimeline() {
  const timeline = useVisualEditorStore((s) => s.timeline);
  const shots = useVisualEditorStore((s) => s.shots);
  const toggleTimelinePanel = useVisualEditorStore((s) => s.toggleTimelinePanel);
  const removeFromTimeline = useVisualEditorStore((s) => s.removeFromTimeline);
  const reorderTimeline = useVisualEditorStore((s) => s.reorderTimeline);
  const clearTimeline = useVisualEditorStore((s) => s.clearTimeline);
  const addAllToTimeline = useVisualEditorStore((s) => s.addAllToTimeline);
  const currentShotId = useVisualEditorStore((s) => s.currentShotId);

  const { segments, panelState, totalDurationMs } = timeline;
  const isCollapsed = panelState === 'collapsed';
  const isExpanded = panelState === 'expanded';

  // 拖拽
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDragId(id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }, []);

  const handleDragLeave = useCallback(() => setDragOverId(null), []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    setDragId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    const ids = segments.map(s => s.id);
    const fromIdx = ids.indexOf(sourceId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const newIds = [...ids];
    newIds.splice(fromIdx, 1);
    newIds.splice(toIdx, 0, sourceId);
    reorderTimeline(newIds);
  }, [segments, reorderTimeline]);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; segmentId: string; index: number;
  } | null>(null);

  const handleSegmentContextMenu = useCallback((e: React.MouseEvent, segmentId: string, index: number) => {
    setContextMenu({ x: e.clientX, y: e.clientY, segmentId, index });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // 各段宽度百分比 — 基于时间线刻度，而非填满整个容器
  // 时间线总刻度 = max(实际总时长, 60s)，这样少量短片段不会撑满
  const segPercents = useMemo(() => {
    if (segments.length === 0) return [];
    const TIMELINE_MIN_SCALE_MS = 60_000; // 时间线最小刻度 60 秒
    const scaleMs = Math.max(totalDurationMs, TIMELINE_MIN_SCALE_MS);
    return segments.map(s => Math.max((s.durationMs / scaleMs) * 100, 2));
  }, [segments, totalDurationMs]);

  // 导出弹窗
  const [showExportModal, setShowExportModal] = useState(false);

  // 导出类型推断
  const hasVideo = segments.some(s => s.mediaType === 'video' || s.mediaType === 'ai-generated');
  const exportType = segments.length === 0 ? null
    : segments.length === 1 && !hasVideo ? 'image' : 'video';

  // 条高度
  const barHeight = isCollapsed ? 8 : isExpanded ? 72 : 36;

  return (
    <div className="select-none flex flex-col rounded-xl overflow-hidden shadow-lg border border-gray-200/80 bg-white">
      {/* ========= 顶部信息栏 ========= */}
      <div
        className="h-9 flex items-center justify-between px-4 bg-white cursor-pointer hover:bg-gray-50/80 transition-colors"
        onClick={toggleTimelinePanel}
      >
        {/* 左侧 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Play size={12} className="text-gray-500" fill="currentColor" />
            <span className="text-xs font-semibold text-gray-700 tracking-wide">主线</span>
          </div>

          {segments.length > 0 && (
            <div className="flex items-center gap-2 ml-1">
              <span className="text-[11px] text-gray-400 tabular-nums">
                {segments.length} 段
              </span>
              <span className="text-gray-200">·</span>
              <span className="text-[11px] text-gray-400 tabular-nums flex items-center gap-0.5">
                <Clock size={10} />
                {fmtMs(totalDurationMs)}
              </span>
              {exportType && (
                <>
                  <span className="text-gray-200">·</span>
                  <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${
                    exportType === 'video'
                      ? 'bg-gray-500/10 text-gray-600'
                      : 'bg-gray-500/10 text-gray-600'
                  }`}>
                    {exportType === 'video' ? '视频' : '图片'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* 右侧操作 */}
        <div className="flex items-center gap-1.5">
          {segments.length > 0 && !isCollapsed && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); clearTimeline(); }}
                className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="清空主线"
              >
                <Trash2 size={13} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowExportModal(true); }}
                className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 text-white text-[11px] rounded-md hover:bg-gray-700 transition-colors font-medium"
              >
                <Download size={11} />
                导出
              </button>
            </>
          )}
          <div className="p-0.5 text-gray-300 ml-1">
            {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>
      </div>

      {/* ========= 色带条区域 ========= */}
      <div
        className="transition-all duration-300 ease-[cubic-bezier(.4,0,.2,1)] overflow-hidden bg-gray-100/60"
        style={{ height: segments.length === 0 && !isCollapsed ? Math.max(barHeight, 48) : barHeight }}
      >
        {segments.length === 0 ? (
          /* 空状态 */
          !isCollapsed && (
            <div className="h-full flex items-center justify-center gap-3 px-4">
              <ListVideo size={15} className="text-gray-300" />
              <span className="text-xs text-gray-400">右键画布节点 →「加入主线」构建你的成片</span>
              {shots.length > 0 && (
                <button
                  onClick={addAllToTimeline}
                  className="ml-2 flex items-center gap-1 px-2.5 py-1 bg-gray-800 text-white text-[11px] rounded-md hover:bg-gray-700 transition-colors"
                >
                  <Plus size={11} />
                  全部加入（{shots.length}）
                </button>
              )}
            </div>
          )
        ) : (
          /* 段条列表 */
          <div
            className={`
              h-full flex items-stretch
              ${isCollapsed ? 'gap-px px-0' : 'gap-1 px-3 py-1.5'}
            `}
          >
            {segments.map((seg, i) => (
              <SegmentBar
                key={seg.id}
                segment={seg}
                index={i}
                totalCount={segments.length}
                widthPercent={segPercents[i]}
                panelState={panelState}
                isActive={seg.sourceNodeId === currentShotId}
                isDragging={dragId === seg.id}
                isDragOver={dragOverId === seg.id}
                onRemove={removeFromTimeline}
                onContextMenu={handleSegmentContextMenu}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />
            ))}

            {/* 末尾 + 号 (非收起态) */}
            {!isCollapsed && (
              <div
                className={`
                  flex-shrink-0 flex items-center justify-center rounded-md
                  border-2 border-dashed border-gray-300/60 text-gray-300
                  hover:border-gray-400 hover:text-gray-400 transition-colors cursor-pointer
                  ${isExpanded ? 'w-14' : 'w-8'}
                `}
              >
                <Plus size={isExpanded ? 16 : 12} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <SegmentContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          segmentId={contextMenu.segmentId}
          segmentIndex={contextMenu.index}
          segmentCount={segments.length}
          canSplit={(() => {
            const seg = segments.find(s => s.id === contextMenu.segmentId);
            return !!seg && seg.durationMs >= 1000;
          })()}
          onClose={closeContextMenu}
        />
      )}

      {/* 导出弹窗 */}
      {showExportModal && (
        <ExportModal onClose={() => setShowExportModal(false)} />
      )}
    </div>
  );
}
