'use client';

import { useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  Scissors,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  Merge,
} from 'lucide-react';
import { useEditorStore, ToolMode } from '../store/editor-store';
import { DirectorModeCompact } from './DirectorModeSwitcher';

// 格式化时间为 00:00:00 格式
function formatTimeHMS(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  variant?: 'default' | 'danger' | 'accent';
  shortcut?: string;
}

function ToolButton({ icon, label, onClick, disabled, active, variant = 'default', shortcut }: ToolButtonProps) {
  const baseStyles = 'relative group flex items-center justify-center space-x-1.5 px-2.5 py-1.5 rounded-lg transition-all';

  const variantStyles = {
    default: active
      ? 'bg-gray-100 text-gray-900'
      : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700',
    danger: active
      ? 'bg-red-100 text-red-600'
      : 'hover:bg-red-50 text-gray-400 hover:text-red-500',
    accent: active
      ? 'bg-gray-100 text-gray-700'
      : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        ${baseStyles}
        ${variantStyles[variant]}
        ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
      `}
      title={shortcut}
    >
      {icon}
      <span className="text-[10px] font-medium hidden sm:inline">{label}</span>
    </button>
  );
}

export function ClipToolbar() {
  // 订阅状态
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.clips);
  const toolMode = useEditorStore((s) => s.toolMode);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLength = useEditorStore((s) => s.history.length);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const splitClip = useEditorStore((s) => s.splitClip);
  const splitAllAtTime = useEditorStore((s) => s.splitAllAtTime);
  const duplicateClip = useEditorStore((s) => s.duplicateClip);
  const deleteSelectedClip = useEditorStore((s) => s.deleteSelectedClip);
  const mergeSelectedClips = useEditorStore((s) => s.mergeSelectedClips);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  // 计算总时长
  const totalDuration = useMemo(() => {
    if (clips.length === 0) return 0;
    return Math.max(...clips.map(c => c.start + c.duration));
  }, [clips]);

  const canUndoNow = historyIndex >= 0;
  const canRedoNow = historyIndex < historyLength - 1;
  const selectedClip = clips.find(c => c.id === selectedClipId);

  // 检查是否可以合并选中的片段
  const canMerge = useMemo(() => {
    // 需要至少选中 2 个片段
    if (selectedClipIds.size < 2) return false;
    
    const selectedClips = Array.from(selectedClipIds)
      .map(id => clips.find(c => c.id === id))
      .filter((c): c is typeof clips[0] => c !== undefined)
      .sort((a, b) => a.start - b.start);
    
    if (selectedClips.length < 2) return false;
    
    // 检查是否在同一轨道且类型相同
    const trackId = selectedClips[0].trackId;
    const clipType = selectedClips[0].clipType;
    
    for (const clip of selectedClips) {
      if (clip.trackId !== trackId || clip.clipType !== clipType) {
        return false;
      }
    }
    
    // 检查是否相邻（允许 100ms 容差）
    for (let i = 1; i < selectedClips.length; i++) {
      const gap = selectedClips[i].start - (selectedClips[i-1].start + selectedClips[i-1].duration);
      if (Math.abs(gap) > 100) {
        return false;
      }
    }
    
    return true;
  }, [selectedClipIds, clips]);

  // 工具操作
  const handleToolModeChange = useCallback((mode: ToolMode) => {
    setToolMode(mode);
  }, [setToolMode]);

  const handleSplit = useCallback(() => {
    const time = useEditorStore.getState().currentTime;
    const canSplitSelected = selectedClip &&
      time > selectedClip.start + 100 &&
      time < selectedClip.start + selectedClip.duration - 100;
    const canSplitAny = clips.some(
      (c) => time > c.start + 100 && time < c.start + c.duration - 100
    );

    if (selectedClipId && canSplitSelected) {
      splitClip(selectedClipId, time);
      setToolMode('select');
    } else if (!selectedClipId && canSplitAny) {
      splitAllAtTime(time);
      setToolMode('select');
    }
  }, [selectedClipId, selectedClip, clips, splitClip, splitAllAtTime, setToolMode]);

  const handleDuplicate = useCallback(() => {
    if (selectedClipId) {
      duplicateClip(selectedClipId);
      setToolMode('select');
    }
  }, [selectedClipId, duplicateClip, setToolMode]);

  const handleDelete = useCallback(() => {
    if (selectedClipId) {
      deleteSelectedClip();
    }
  }, [selectedClipId, deleteSelectedClip]);

  const handleMerge = useCallback(() => {
    if (canMerge) {
      mergeSelectedClips();
    }
  }, [canMerge, mergeSelectedClips]);

  const handleUndo = useCallback(() => {
    if (canUndoNow) undo();
  }, [undo, canUndoNow]);

  const handleRedo = useCallback(() => {
    if (canRedoNow) redo();
  }, [redo, canRedoNow]);

  // 播放/暂停
  const handlePlayPause = useCallback(() => {
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // 空格键播放/暂停
      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); handlePlayPause(); return;
      }
      if (e.shiftKey && e.code === 'KeyF' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); e.stopPropagation(); handleSplit(); return;
      }
      if (e.shiftKey && e.code === 'KeyC' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); e.stopPropagation(); handleDuplicate(); return;
      }
      if (e.shiftKey && e.code === 'KeyD' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); e.stopPropagation(); handleDelete(); return;
      }
      if (e.shiftKey && e.code === 'KeyZ' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); e.stopPropagation(); handleUndo(); return;
      }
      if (e.shiftKey && e.code === 'KeyY' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); e.stopPropagation(); handleRedo(); return;
      }
      if (e.code === 'Escape') {
        e.preventDefault(); setToolMode('select'); return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleSplit, handleDelete, handleDuplicate, handleUndo, handleRedo, handlePlayPause, setToolMode]);

  return (
    <div className="flex items-center justify-between h-11 px-4 bg-white border-b border-gray-100">
      {/* 左侧：时间显示 */}
      <div className="flex items-center space-x-2 text-gray-900">
        <span className="text-lg font-semibold tracking-tight tabular-nums">
          {formatTimeHMS(currentTime)}
        </span>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-400 tabular-nums">
          {formatTimeHMS(totalDuration)}
        </span>
      </div>

      {/* 中间：工具按钮 */}
      <div className="flex items-center space-x-1">
        <ToolButton
          icon={isPlaying ? <Pause size={15} /> : <Play size={15} />}
          label={isPlaying ? '暂停' : '播放'}
          onClick={handlePlayPause}
          shortcut="Space"
        />
        <ToolButton
          icon={<Scissors size={15} />}
          label="分割"
          onClick={handleSplit}
          active={toolMode === 'split'}
        />
        <ToolButton
          icon={<Copy size={15} />}
          label="复制"
          onClick={handleDuplicate}
          disabled={!selectedClipId}
        />
        <ToolButton
          icon={<Trash2 size={15} />}
          label="删除"
          onClick={handleDelete}
          disabled={!selectedClipId}
          variant="danger"
        />
        <ToolButton
          icon={<Merge size={15} />}
          label="合并"
          onClick={handleMerge}
          disabled={!canMerge}
        />
        
        {/* 分隔符 */}
        <div className="w-px h-6 bg-gray-200 mx-1" />
        
        {/* 导演模式切换 */}
        <DirectorModeCompact />
      </div>

      {/* 右侧：撤销/重做 */}
      <div className="flex items-center space-x-1">
        <ToolButton
          icon={<Undo2 size={15} />}
          label="撤销"
          onClick={handleUndo}
          disabled={!canUndoNow}
        />
        <ToolButton
          icon={<Redo2 size={15} />}
          label="重做"
          onClick={handleRedo}
          disabled={!canRedoNow}
        />
      </div>
    </div>
  );
}
