'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Type,
  ChevronDown,
  ChevronUp,
  Settings2,
  Eye,
  EyeOff,
  Palette,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Plus,
  Trash2,
  Copy,
  Edit3,
  Check,
  X,
  Wand2,
  Download,
  Upload,
  LayoutTemplate,
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import type { TranscriptSegment } from '../types';
import {
  SubtitleStyle,
  SubtitlePosition,
  SubtitleAnimation,
  SubtitleTrack,
  Subtitle,
  SubtitlePreset,
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_PRESETS,
  AVAILABLE_FONTS,
} from '../types/subtitle';

// ============================================
// 字幕编辑器组件
// ============================================

export function SubtitleEditor() {
  // 使用细粒度 selector 订阅，避免不必要的重渲染（不订阅 currentTime）
  const transcript = useEditorStore((s) => s.transcript);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  
  // 使用 ref 存储 currentTime，避免订阅导致重渲染
  const currentTimeRef = useRef(useEditorStore.getState().currentTime);
  
  // 字幕轨道状态
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [currentSubtitleId, setCurrentSubtitleId] = useState<string | null>(null);
  
  // UI 状态
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [showPresetPanel, setShowPresetPanel] = useState(false);
  const [editingSubtitleId, setEditingSubtitleId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  
  // 获取当前活动轨道
  const activeTrack = subtitleTracks.find(t => t.id === activeTrackId);
  const selectedSubtitle = activeTrack?.subtitles.find(s => s.id === selectedSubtitleId);
  
  // 根据转写结果生成字幕
  const generateSubtitlesFromTranscript = useCallback(() => {
    const subtitles: Subtitle[] = transcript
      .filter(seg => !seg.deleted && !seg.is_deleted)
      .map(seg => ({
        id: `sub_${seg.id}`,
        text: seg.text,
        start: seg.start,
        end: seg.end,
        speakerId: seg.speaker,
        segmentId: seg.id,
        isManuallyEdited: false,
      }));
    
    const newTrack: SubtitleTrack = {
      id: `track_${Date.now()}`,
      name: '字幕轨道 1',
      language: 'zh-CN',
      isPrimary: true,
      style: DEFAULT_SUBTITLE_STYLE,
      position: 'bottom',
      verticalOffset: 10,
      subtitles,
      visible: true,
    };
    
    setSubtitleTracks([newTrack]);
    setActiveTrackId(newTrack.id);
  }, [transcript]);
  
  // 更新字幕文本
  const updateSubtitleText = useCallback((subtitleId: string, text: string) => {
    setSubtitleTracks(tracks => 
      tracks.map(track => ({
        ...track,
        subtitles: track.subtitles.map(sub =>
          sub.id === subtitleId
            ? { ...sub, text, isManuallyEdited: true }
            : sub
        ),
      }))
    );
  }, []);
  
  // 更新字幕时间
  const updateSubtitleTime = useCallback((subtitleId: string, start: number, end: number) => {
    setSubtitleTracks(tracks =>
      tracks.map(track => ({
        ...track,
        subtitles: track.subtitles.map(sub =>
          sub.id === subtitleId
            ? { ...sub, start, end }
            : sub
        ),
      }))
    );
  }, []);
  
  // 更新轨道样式
  const updateTrackStyle = useCallback((style: Partial<SubtitleStyle>) => {
    if (!activeTrackId) return;
    
    setSubtitleTracks(tracks =>
      tracks.map(track =>
        track.id === activeTrackId
          ? { ...track, style: { ...track.style, ...style } }
          : track
      )
    );
  }, [activeTrackId]);
  
  // 应用预设
  const applyPreset = useCallback((preset: SubtitlePreset) => {
    if (!activeTrackId) return;
    
    setSubtitleTracks(tracks =>
      tracks.map(track =>
        track.id === activeTrackId
          ? {
              ...track,
              style: preset.style,
              position: preset.position,
              subtitles: track.subtitles.map(sub => ({
                ...sub,
                animation: preset.animation,
              })),
            }
          : track
      )
    );
    setShowPresetPanel(false);
  }, [activeTrackId]);
  
  // 删除字幕
  const deleteSubtitle = useCallback((subtitleId: string) => {
    setSubtitleTracks(tracks =>
      tracks.map(track => ({
        ...track,
        subtitles: track.subtitles.filter(sub => sub.id !== subtitleId),
      }))
    );
    if (selectedSubtitleId === subtitleId) {
      setSelectedSubtitleId(null);
    }
  }, [selectedSubtitleId]);
  
  // 分割字幕
  const splitSubtitle = useCallback((subtitleId: string, splitTime: number) => {
    if (!activeTrackId) return;
    
    setSubtitleTracks(tracks =>
      tracks.map(track => {
        if (track.id !== activeTrackId) return track;
        
        const subIndex = track.subtitles.findIndex(s => s.id === subtitleId);
        if (subIndex === -1) return track;
        
        const sub = track.subtitles[subIndex];
        if (splitTime <= sub.start || splitTime >= sub.end) return track;
        
        // 简单按比例分割文本
        const totalDuration = sub.end - sub.start;
        const splitRatio = (splitTime - sub.start) / totalDuration;
        const splitIndex = Math.round(sub.text.length * splitRatio);
        
        const firstPart: Subtitle = {
          ...sub,
          id: `${sub.id}_a`,
          text: sub.text.slice(0, splitIndex),
          end: splitTime,
        };
        
        const secondPart: Subtitle = {
          ...sub,
          id: `${sub.id}_b`,
          text: sub.text.slice(splitIndex),
          start: splitTime,
        };
        
        const newSubtitles = [...track.subtitles];
        newSubtitles.splice(subIndex, 1, firstPart, secondPart);
        
        return { ...track, subtitles: newSubtitles };
      })
    );
  }, [activeTrackId]);
  
  // 合并相邻字幕
  const mergeWithNext = useCallback((subtitleId: string) => {
    if (!activeTrackId) return;
    
    setSubtitleTracks(tracks =>
      tracks.map(track => {
        if (track.id !== activeTrackId) return track;
        
        const subIndex = track.subtitles.findIndex(s => s.id === subtitleId);
        if (subIndex === -1 || subIndex >= track.subtitles.length - 1) return track;
        
        const current = track.subtitles[subIndex];
        const next = track.subtitles[subIndex + 1];
        
        const merged: Subtitle = {
          ...current,
          text: current.text + ' ' + next.text,
          end: next.end,
          isManuallyEdited: true,
        };
        
        const newSubtitles = [...track.subtitles];
        newSubtitles.splice(subIndex, 2, merged);
        
        return { ...track, subtitles: newSubtitles };
      })
    );
  }, [activeTrackId]);
  
  // 导出 SRT 格式
  const exportSRT = useCallback(() => {
    if (!activeTrack) return;
    
    const formatTime = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.round((seconds % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    
    const srtContent = activeTrack.subtitles
      .map((sub, index) => 
        `${index + 1}\n${formatTime(sub.start)} --> ${formatTime(sub.end)}\n${sub.text}\n`
      )
      .join('\n');
    
    const blob = new Blob([srtContent], { type: 'text/srt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTrack.name}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeTrack]);
  
  // 获取当前时间的字幕（使用 state 而不是 useMemo with currentTime）
  const currentSubtitle = useMemo(() => {
    if (!activeTrack || !currentSubtitleId) return null;
    return activeTrack.subtitles.find(sub => sub.id === currentSubtitleId);
  }, [activeTrack, currentSubtitleId]);
  
  // 订阅 currentTime，只在当前字幕变化时更新 state
  useEffect(() => {
    let lastSubtitleId: string | null = null;
    const unsubscribe = useEditorStore.subscribe(
      (state) => state.currentTime,
      (currentTime) => {
        currentTimeRef.current = currentTime;
        if (!activeTrack) return;
        const current = activeTrack.subtitles.find(
          sub => currentTime >= sub.start && currentTime < sub.end
        );
        const newId = current?.id || null;
        if (newId !== lastSubtitleId) {
          lastSubtitleId = newId;
          setCurrentSubtitleId(newId);
        }
      }
    );
    return unsubscribe;
  }, [activeTrack]);
  
  // 开始编辑
  const startEditing = (subtitle: Subtitle) => {
    setEditingSubtitleId(subtitle.id);
    setEditingText(subtitle.text);
  };
  
  // 保存编辑
  const saveEditing = () => {
    if (editingSubtitleId && editingText.trim()) {
      updateSubtitleText(editingSubtitleId, editingText.trim());
    }
    setEditingSubtitleId(null);
    setEditingText('');
  };
  
  // 取消编辑
  const cancelEditing = () => {
    setEditingSubtitleId(null);
    setEditingText('');
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 头部工具栏 */}
      <div className="h-12 border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <Type size={18} className="text-gray-700" />
          <span className="text-sm font-medium text-gray-900">字幕编辑器</span>
          
          {subtitleTracks.length === 0 ? (
            <button
              onClick={generateSubtitlesFromTranscript}
              className="flex items-center space-x-1 px-3 py-1.5 bg-gray-700 text-white text-xs font-medium rounded-md hover:bg-gray-600 transition-colors"
            >
              <Wand2 size={14} />
              <span>从转写生成字幕</span>
            </button>
          ) : (
            <span className="text-xs text-gray-500">
              {activeTrack?.subtitles.length || 0} 条字幕
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {activeTrack && (
            <>
              <button
                onClick={() => setShowPresetPanel(!showPresetPanel)}
                className={`p-2 rounded-md transition-colors ${
                  showPresetPanel ? 'bg-gray-700 text-white' : 'hover:bg-gray-100'
                }`}
                title="样式预设"
              >
                <LayoutTemplate size={16} />
              </button>
              <button
                onClick={() => setShowStylePanel(!showStylePanel)}
                className={`p-2 rounded-md transition-colors ${
                  showStylePanel ? 'bg-gray-700 text-white' : 'hover:bg-gray-100'
                }`}
                title="样式设置"
              >
                <Palette size={16} />
              </button>
              <button
                onClick={exportSRT}
                className="p-2 rounded-md hover:bg-gray-100 transition-colors"
                title="导出 SRT"
              >
                <Download size={16} />
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* 预设面板 */}
      {showPresetPanel && (
        <div className="border-b border-gray-200 p-4 bg-white">
          <h4 className="text-xs font-medium text-gray-600 mb-3">样式预设</h4>
          <div className="grid grid-cols-3 gap-2">
            {SUBTITLE_PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors text-left border border-gray-200"
              >
                <div
                  className="text-sm font-medium mb-1"
                  style={{
                    color: preset.style.fontColor,
                    textShadow: preset.style.strokeWidth > 0
                      ? `0 0 ${preset.style.strokeWidth}px ${preset.style.strokeColor}`
                      : undefined,
                  }}
                >
                  示例文字
                </div>
                <div className="text-xs text-gray-500">{preset.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* 样式面板 */}
      {showStylePanel && activeTrack && (
        <StylePanel
          style={activeTrack.style}
          position={activeTrack.position}
          onStyleChange={updateTrackStyle}
          onPositionChange={(position) => {
            setSubtitleTracks(tracks =>
              tracks.map(t =>
                t.id === activeTrackId
                  ? { ...t, position }
                  : t
              )
            );
          }}
        />
      )}
      
      {/* 字幕列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {activeTrack?.subtitles.map((subtitle, index) => (
          <div
            key={subtitle.id}
            onClick={() => {
              setSelectedSubtitleId(subtitle.id);
              setCurrentTime(subtitle.start);
            }}
            className={`p-3 rounded-lg cursor-pointer transition-all ${
              selectedSubtitleId === subtitle.id
                ? 'bg-gray-100 border border-gray-500'
                : currentSubtitle?.id === subtitle.id
                ? 'bg-gray-100 border border-gray-300'
                : 'bg-white border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2 text-xs text-gray-500 mb-1">
                  <span>{index + 1}</span>
                  <span>|</span>
                  <span>{formatTime(subtitle.start)} - {formatTime(subtitle.end)}</span>
                  {subtitle.speakerId && (
                    <>
                      <span>|</span>
                      <span className="text-editor-accent">{subtitle.speakerId}</span>
                    </>
                  )}
                </div>
                
                {editingSubtitleId === subtitle.id ? (
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="flex-1 bg-white border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEditing();
                        if (e.key === 'Escape') cancelEditing();
                      }}
                    />
                    <button onClick={saveEditing} className="p-1 hover:bg-gray-100 rounded">
                      <Check size={14} className="text-green-500" />
                    </button>
                    <button onClick={cancelEditing} className="p-1 hover:bg-gray-100 rounded">
                      <X size={14} className="text-red-500" />
                    </button>
                  </div>
                ) : (
                  <p className="text-sm">{subtitle.text}</p>
                )}
              </div>
              
              {selectedSubtitleId === subtitle.id && editingSubtitleId !== subtitle.id && (
                <div className="flex items-center space-x-1 ml-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(subtitle);
                    }}
                    className="p-1 hover:bg-gray-100 rounded"
                    title="编辑"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      splitSubtitle(subtitle.id, currentTimeRef.current);
                    }}
                    className="p-1 hover:bg-gray-100 rounded"
                    title="分割"
                    disabled={currentTimeRef.current <= subtitle.start || currentTimeRef.current >= subtitle.end}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSubtitle(subtitle.id);
                    }}
                    className="p-1 hover:bg-gray-100 rounded text-red-500"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        
        {subtitleTracks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-500">
            <Type size={48} className="mb-4 opacity-50" />
            <p className="text-sm">暂无字幕</p>
            <p className="text-xs mt-1">点击上方按钮从转写结果生成字幕</p>
          </div>
        )}
      </div>
      
      {/* 预览区域 */}
      {currentSubtitle && activeTrack && (
        <div className="h-24 border-t border-gray-200 flex items-center justify-center bg-gray-100">
          <SubtitlePreview
            text={currentSubtitle.text}
            style={activeTrack.style}
            animation={currentSubtitle.animation}
          />
        </div>
      )}
    </div>
  );
}

// ============================================
// 样式面板组件
// ============================================

interface StylePanelProps {
  style: SubtitleStyle;
  position: SubtitlePosition;
  onStyleChange: (style: Partial<SubtitleStyle>) => void;
  onPositionChange: (position: SubtitlePosition) => void;
}

function StylePanel({ style, position, onStyleChange, onPositionChange }: StylePanelProps) {
  return (
    <div className="border-b border-gray-200 p-4 bg-white max-h-64 overflow-y-auto">
      <div className="grid grid-cols-2 gap-4">
        {/* 字体 */}
        <div>
          <label className="text-xs text-gray-600 block mb-1">字体</label>
          <select
            value={style.fontFamily}
            onChange={(e) => onStyleChange({ fontFamily: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
          >
            {AVAILABLE_FONTS.map(font => (
              <option key={font.name} value={font.name}>{font.label}</option>
            ))}
          </select>
        </div>
        
        {/* 字号 */}
        <div>
          <label className="text-xs text-gray-600 block mb-1">字号</label>
          <input
            type="number"
            value={style.fontSize}
            onChange={(e) => onStyleChange({ fontSize: Number(e.target.value) })}
            className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
            min={4}
            max={200}
          />
        </div>
        
        {/* 颜色 */}
        <div>
          <label className="text-xs text-gray-600 block mb-1">字体颜色</label>
          <input
            type="color"
            value={style.fontColor}
            onChange={(e) => onStyleChange({ fontColor: e.target.value })}
            className="w-full h-8 rounded cursor-pointer"
          />
        </div>
        
        {/* 描边颜色 */}
        <div>
          <label className="text-xs text-gray-600 block mb-1">描边颜色</label>
          <div className="flex items-center space-x-2">
            <input
              type="color"
              value={style.strokeColor}
              onChange={(e) => onStyleChange({ strokeColor: e.target.value })}
              className="w-full h-8 rounded cursor-pointer"
            />
            <input
              type="number"
              value={style.strokeWidth}
              onChange={(e) => onStyleChange({ strokeWidth: Number(e.target.value) })}
              className="w-16 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-sm text-gray-900"
              min={0}
              max={10}
            />
          </div>
        </div>
        
        {/* 位置 */}
        <div>
          <label className="text-xs text-gray-600 block mb-1">位置</label>
          <select
            value={position}
            onChange={(e) => onPositionChange(e.target.value as SubtitlePosition)}
            className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
          >
            <option value="top">顶部</option>
            <option value="middle">中间</option>
            <option value="bottom">底部</option>
            <option value="top-left">左上</option>
            <option value="top-right">右上</option>
            <option value="bottom-left">左下</option>
            <option value="bottom-right">右下</option>
          </select>
        </div>
        
        {/* 对齐 */}
        <div>
          <label className="text-xs text-gray-600 block mb-1">对齐</label>
          <div className="flex space-x-1">
            {(['left', 'center', 'right'] as const).map(align => (
              <button
                key={align}
                onClick={() => onStyleChange({ textAlign: align })}
                className={`flex-1 p-2 rounded ${
                  style.textAlign === align ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {align === 'left' && <AlignLeft size={14} />}
                {align === 'center' && <AlignCenter size={14} />}
                {align === 'right' && <AlignRight size={14} />}
              </button>
            ))}
          </div>
        </div>
        
        {/* 粗体/斜体 */}
        <div className="col-span-2">
          <label className="text-xs text-gray-600 block mb-1">样式</label>
          <div className="flex space-x-2">
            <button
              onClick={() => onStyleChange({ fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold' })}
              className={`px-3 py-1.5 rounded flex items-center space-x-1 ${
                style.fontWeight === 'bold' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              <Bold size={14} />
              <span className="text-xs">粗体</span>
            </button>
            <button
              onClick={() => onStyleChange({ italic: !style.italic })}
              className={`px-3 py-1.5 rounded flex items-center space-x-1 ${
                style.italic ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              <Italic size={14} />
              <span className="text-xs">斜体</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// 字幕预览组件
// ============================================

interface SubtitlePreviewProps {
  text: string;
  style: SubtitleStyle;
  animation?: SubtitleAnimation;
}

function SubtitlePreview({ text, style, animation }: SubtitlePreviewProps) {
  const textStyle: React.CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize * 0.5, // 缩小预览
    color: style.fontColor,
    fontWeight: style.fontWeight,
    fontStyle: style.italic ? 'italic' : 'normal',
    textAlign: style.textAlign,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    WebkitTextStroke: style.strokeWidth > 0
      ? `${style.strokeWidth * 0.5}px ${style.strokeColor}`
      : undefined,
    textShadow: style.shadowBlur > 0
      ? `${style.shadowOffsetX}px ${style.shadowOffsetY}px ${style.shadowBlur}px ${style.shadowColor}`
      : undefined,
    backgroundColor: style.backgroundOpacity > 0
      ? `${style.backgroundColor}${Math.round(style.backgroundOpacity * 255).toString(16).padStart(2, '0')}`
      : undefined,
    padding: style.backgroundOpacity > 0 ? style.backgroundPadding * 0.5 : 0,
    borderRadius: style.backgroundRadius * 0.5,
  };

  return (
    <div style={textStyle} className="max-w-md text-center">
      {text}
    </div>
  );
}

// ============================================
// 辅助函数
// ============================================

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 100);
  return `${mins}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}
