'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { X, Search, Copy, Download, Filter, Scissors } from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { formatTimeSec } from '../lib/time-utils';
import type { Clip } from '../types/clip';

interface ClipItemProps {
  clip: Clip;
  index: number;
  isPlaying: boolean;
  isSelected: boolean;
  isFocused: boolean;
  onDoubleClick: () => void;
  onEdit: () => void;
  onTextChange: (text: string) => void;
  onDelete: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  setItemRef: (el: HTMLDivElement | null) => void;
}

function ClipItem({
  clip, index, isPlaying, isSelected, isFocused,
  onDoubleClick, onEdit, onTextChange, onDelete, onNavigate, setItemRef
}: ClipItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayText = clip.contentText || '';
  const [localText, setLocalText] = useState(displayText);
  const [isEditing, setIsEditing] = useState(false);
  const isCurrent = isPlaying;

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setLocalText(displayText);
    }
  }, [displayText]);

  useEffect(() => {
    if (!isSelected) {
      setIsEditing(false);
    }
  }, [isSelected]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(localText.length, localText.length);
      });
    }
  }, [isEditing, localText.length]);

  const handleDoubleClick = () => {
    onDoubleClick();
    setIsEditing(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    setLocalText(newText);
    onTextChange(newText);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isEditing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      setIsEditing(false);
    } else if (e.key === 'Escape') {
      setLocalText(displayText);
      setIsEditing(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setIsEditing(false);
      onNavigate(e.shiftKey ? 'prev' : 'next');
    }
  };

  return (
    <div
      ref={setItemRef}
      onDoubleClick={handleDoubleClick}
      className={`group relative rounded-md transition-all duration-150 cursor-pointer ${
        isSelected
          ? 'bg-blue-50 border border-blue-400 shadow-sm'
          : isCurrent
            ? 'bg-green-50 border border-green-200'
            : 'bg-white hover:bg-gray-50 border border-transparent hover:border-gray-200'
      }`}
    >
      <div className="flex items-start gap-2 px-2 py-2.5">
        <span className={`flex-shrink-0 text-[10px] font-bold w-5 pt-0.5 ${
          isCurrent ? 'text-green-500' : 'text-gray-400'
        }`}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="flex-shrink-0 text-[10px] text-gray-400 pt-0.5 w-10">
          {formatTimeSec(clip.start / 1000)}
        </span>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              value={localText}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onBlur={() => setIsEditing(false)}
              className="w-full text-sm text-gray-800 bg-white border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          ) : (
            <p className={`text-sm leading-relaxed ${
              isCurrent ? 'text-green-800 font-medium' : 'text-gray-800'
            }`}>
              {displayText || <span className="text-gray-300 italic">空白片段</span>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface SubtitlesPanelProps {
  onClose: () => void;
}

export function SubtitlesPanel({ onClose }: SubtitlesPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPlayingClipId, setCurrentPlayingClipId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const clipRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const listContainerRef = useRef<HTMLDivElement>(null);

  const clips = useEditorStore((s) => s.clips);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setSelectedClipId = useEditorStore((s) => s.setSelectedClipId);
  const selectClip = useEditorStore((s) => s.selectClip);
  const updateClip = useEditorStore((s) => s.updateClip);
  const removeClip = useEditorStore((s) => s.removeClip);

  // 监听播放时间，更新当前播放片段
  useEffect(() => {
    let lastPlayingId: string | null = null;
    const unsubscribe = useEditorStore.subscribe(
      (state) => state.currentTime,
      (currentTime) => {
        const playing = clips.find(c => currentTime >= c.start && currentTime < c.start + c.duration);
        const newPlayingId = playing?.id || null;
        if (newPlayingId !== lastPlayingId) {
          lastPlayingId = newPlayingId;
          setCurrentPlayingClipId(newPlayingId);
        }
      }
    );
    return unsubscribe;
  }, [clips]);

  // 播放时自动滚动
  useEffect(() => {
    if (currentPlayingClipId) {
      const element = clipRefs.current.get(currentPlayingClipId);
      if (element && listContainerRef.current) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentPlayingClipId]);

  // 字幕 clips
  const subtitleClips = useMemo(() => {
    return clips
      .filter(c => c.clipType === 'subtitle')
      .sort((a, b) => a.start - b.start);
  }, [clips]);

  // 搜索过滤
  const filteredClips = useMemo(() => {
    if (!searchQuery.trim()) return subtitleClips;
    const query = searchQuery.toLowerCase();
    return subtitleClips.filter(c =>
      c.contentText?.toLowerCase().includes(query) ||
      c.name?.toLowerCase().includes(query)
    );
  }, [subtitleClips, searchQuery]);

  const handleSelect = useCallback((clip: Clip) => {
    selectClip(clip.id, false);
  }, [selectClip]);

  const handlePlay = useCallback((clip: Clip) => {
    setCurrentTime(clip.start);
    setSelectedClipId(clip.id);
  }, [setCurrentTime, setSelectedClipId]);

  const handleEdit = useCallback((clip: Clip) => {
    setSelectedClipId(clip.id);
    setCurrentTime(clip.start);
  }, [setSelectedClipId, setCurrentTime]);

  const handleTextChange = useCallback((clipId: string, text: string) => {
    updateClip(clipId, { contentText: text });
  }, [updateClip]);

  const handleDelete = useCallback((clipId: string) => {
    if (confirm('确定要删除这个片段吗？')) {
      removeClip(clipId);
    }
  }, [removeClip]);

  const handleNavigate = useCallback((index: number, direction: 'prev' | 'next') => {
    const newIndex = direction === 'next'
      ? Math.min(index + 1, filteredClips.length - 1)
      : Math.max(index - 1, 0);

    if (newIndex !== index && filteredClips[newIndex]) {
      const nextClip = filteredClips[newIndex];
      setFocusedIndex(newIndex);
      handlePlay(nextClip);
      handleSelect(nextClip);
    }
  }, [filteredClips, handlePlay, handleSelect]);

  const copyAllText = () => {
    const allText = filteredClips
      .map(c => c.contentText || '')
      .filter(Boolean)
      .join('\n\n');
    navigator.clipboard.writeText(allText);
  };

  const exportTranscript = () => {
    const content = filteredClips
      .map((c) => `[${formatTimeSec(c.start / 1000)}] ${c.contentText || ''}`)
      .join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full h-full bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-900">字幕 ({subtitleClips.length})</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          title="关闭"
        >
          <X size={16} className="text-gray-500" />
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-gray-50 text-sm text-gray-900 placeholder-gray-400 
                       rounded-lg pl-9 pr-3 py-2 border border-gray-200
                       focus:border-gray-500 focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <button
            onClick={copyAllText}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
            title="复制所有文案"
          >
            <Copy size={14} className="text-gray-500" />
          </button>
          <button
            onClick={exportTranscript}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
            title="导出文案"
          >
            <Download size={14} className="text-gray-500" />
          </button>
          <button
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
            title="筛选"
          >
            <Filter size={14} className="text-gray-500" />
          </button>
        </div>
        <span className="text-[10px] text-gray-500">{filteredClips.length} 个片段</span>
      </div>

      {/* 列表 */}
      <div
        ref={listContainerRef}
        className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 custom-scrollbar"
      >
        {filteredClips.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
            <div className="p-4 rounded-full border-2 border-dashed border-gray-300 mb-4">
              <Scissors size={24} className="text-gray-400" />
            </div>
            <p className="text-xs text-gray-500">
              {searchQuery ? '没有匹配的片段' : '暂无字幕片段'}
            </p>
          </div>
        ) : (
          filteredClips.map((clip, index) => {
            const setRef = (el: HTMLDivElement | null) => {
              if (el) {
                clipRefs.current.set(clip.id, el);
              } else {
                clipRefs.current.delete(clip.id);
              }
            };

            return (
              <ClipItem
                key={clip.id}
                clip={clip}
                index={index}
                isPlaying={currentPlayingClipId === clip.id}
                isSelected={selectedClipIds.has(clip.id)}
                isFocused={focusedIndex === index}
                onDoubleClick={() => {
                  handleSelect(clip);
                  handlePlay(clip);
                }}
                onEdit={() => handleEdit(clip)}
                onTextChange={(text) => handleTextChange(clip.id, text)}
                onDelete={() => handleDelete(clip.id)}
                onNavigate={(direction) => handleNavigate(index, direction)}
                setItemRef={setRef}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
