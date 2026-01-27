'use client';

import { useCallback, useMemo } from 'react';
import {
  X,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import type { Clip } from '../types/clip';
import { KeyframeAddDeleteButtons } from './keyframes/PropertyKeyframeButton';

interface AudioPanelProps {
  onClose: () => void;
}

// 音量转换工具函数（组件外定义，避免每次渲染重新创建）
const volumeToDb = (vol: number): number => {
  if (vol <= 0) return -Infinity;
  return 20 * Math.log10(vol);
};

const dbToVolume = (db: number): number => {
  return Math.pow(10, db / 20);
};

/**
 * 音频属性面板
 * 适用于 video、audio、voice clip 的音量调节
 * 支持多选批量编辑
 */
export function AudioPanel({ onClose }: AudioPanelProps) {
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const updateClip = useEditorStore((s) => s.updateClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const currentTime = useEditorStore((s) => s.currentTime);

  // 获取所有选中的媒体 Clips（video、audio、voice）
  const selectedMediaClips = useMemo(() => {
    const mediaClips: typeof clips = [];
    const supportedTypes = ['video', 'audio', 'voice'];
    
    // 优先检查多选
    if (selectedClipIds.size > 0) {
      selectedClipIds.forEach(id => {
        const clip = clips.find(c => c.id === id);
        if (clip && supportedTypes.includes(clip.clipType)) {
          mediaClips.push(clip);
        }
      });
    }
    
    // 如果多选中没有媒体 clip，则检查单选
    if (mediaClips.length === 0 && selectedClipId) {
      const clip = clips.find((c) => c.id === selectedClipId);
      if (clip && supportedTypes.includes(clip.clipType)) {
        mediaClips.push(clip);
      }
    }
    
    // 如果还是没有，尝试找当前播放头位置的媒体 clip
    if (mediaClips.length === 0) {
      const allMediaClips = clips.filter(
        (c) => supportedTypes.includes(c.clipType)
      );
      const atPlayhead = allMediaClips.find(
        (c) => currentTime >= c.start && currentTime < c.start + c.duration
      );
      if (atPlayhead) {
        mediaClips.push(atPlayhead);
      }
    }
    
    return mediaClips;
  }, [clips, selectedClipId, selectedClipIds, currentTime]);

  // 获取第一个选中的媒体 Clip（用于显示当前值）
  const selectedClip = selectedMediaClips[0] || null;
  
  // 选中的媒体 clip 数量
  const selectedCount = selectedMediaClips.length;

  // 当前音量值 (0-2，1 为原始音量)
  const currentVolume = selectedClip?.volume ?? 1;
  
  const currentDb = volumeToDb(currentVolume);
  const displayDb = isFinite(currentDb) ? currentDb.toFixed(1) : '-∞';

  // 是否静音
  const isMuted = selectedClip?.isMuted ?? false;

  // 淡入淡出时长 (毫秒转秒显示)
  const fadeIn = (selectedClip?.metadata?.fadeIn ?? 0) / 1000;
  const fadeOut = (selectedClip?.metadata?.fadeOut ?? 0) / 1000;

  // 更新音量（支持批量更新所有选中的媒体 clip）
  const updateVolume = useCallback(
    (volume: number) => {
      if (selectedMediaClips.length === 0) return;
      saveToHistory();
      const clampedVolume = Math.max(0, Math.min(2, volume));
      selectedMediaClips.forEach(clip => {
        updateClip(clip.id, { volume: clampedVolume });
      });
    },
    [selectedMediaClips, updateClip, saveToHistory]
  );

  // 更新静音状态（支持批量更新所有选中的媒体 clip）
  const toggleMute = useCallback(() => {
    if (selectedMediaClips.length === 0) return;
    saveToHistory();
    const newMuted = !isMuted;
    selectedMediaClips.forEach(clip => {
      updateClip(clip.id, { isMuted: newMuted });
    });
  }, [selectedMediaClips, isMuted, updateClip, saveToHistory]);

  // 更新淡入时长（支持批量更新所有选中的媒体 clip）
  const updateFadeIn = useCallback(
    (seconds: number) => {
      if (selectedMediaClips.length === 0) return;
      saveToHistory();
      const ms = Math.max(0, seconds * 1000);
      selectedMediaClips.forEach(clip => {
        updateClip(clip.id, {
          metadata: {
            ...clip.metadata,
            fadeIn: ms,
          },
        });
      });
    },
    [selectedMediaClips, updateClip, saveToHistory]
  );

  // 更新淡出时长（支持批量更新所有选中的媒体 clip）
  const updateFadeOut = useCallback(
    (seconds: number) => {
      if (selectedMediaClips.length === 0) return;
      saveToHistory();
      const ms = Math.max(0, seconds * 1000);
      selectedMediaClips.forEach(clip => {
        updateClip(clip.id, {
          metadata: {
            ...clip.metadata,
            fadeOut: ms,
          },
        });
      });
    },
    [selectedMediaClips, updateClip, saveToHistory]
  );

  return (
    <div className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">音频</h3>
          {selectedCount > 1 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">
              已选 {selectedCount} 个
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 rounded transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 p-4 space-y-5 overflow-y-auto custom-scrollbar">
        {/* 没有选中媒体时显示提示 */}
        {!selectedClip ? (
          <div className="text-center py-8">
            <VolumeX size={32} className="mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 text-sm">选择一个视频或音频片段</p>
            <p className="text-gray-400 text-xs mt-1">以调节其音频属性</p>
          </div>
        ) : (
          <>
            {/* 基础区块 */}
            <div className="space-y-4">
              <span className="text-xs font-medium text-gray-500">基础</span>

              {/* 音量 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-500">音量</label>
                  <div className="flex items-center gap-2">
                    {selectedClip && (
                      <KeyframeAddDeleteButtons
                        clipId={selectedClip.id}
                        property="volume"
                        currentValue={currentVolume}
                      />
                    )}
                    <div className="flex items-center gap-1 bg-gray-100 rounded px-2 py-1">
                      <input
                        type="number"
                        step={0.1}
                        value={displayDb}
                        onChange={(e) => {
                          const db = parseFloat(e.target.value);
                          if (!isNaN(db)) {
                            updateVolume(dbToVolume(db));
                          }
                        }}
                        disabled={isMuted}
                        className="w-10 bg-transparent text-gray-700 text-xs text-right focus:outline-none"
                      />
                      <span className="text-[10px] text-gray-500">dB</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* 静音按钮 */}
                  <button
                    onClick={toggleMute}
                    className={`p-1 rounded transition-colors ${
                      isMuted 
                        ? 'bg-gray-200 text-gray-700' 
                        : 'bg-gray-100 text-gray-500 hover:text-gray-700'
                    }`}
                    title={isMuted ? '取消静音' : '静音'}
                  >
                    {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  
                  {/* 音量滑块 */}
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.01}
                    value={currentVolume}
                    onChange={(e) => updateVolume(Number(e.target.value))}
                    disabled={isMuted}
                    className={`flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer ${isMuted ? 'opacity-50' : ''}`}
                  />
                </div>
              </div>

              {/* 淡入时长 */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500 w-14 flex-shrink-0">淡入</label>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.1}
                  value={fadeIn}
                  onChange={(e) => updateFadeIn(Number(e.target.value))}
                  className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer"
                />
                <span className="text-xs text-gray-600 w-10 text-right">{fadeIn.toFixed(1)}s</span>
              </div>

              {/* 淡出时长 */}
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500 w-14 flex-shrink-0">淡出</label>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.1}
                  value={fadeOut}
                  onChange={(e) => updateFadeOut(Number(e.target.value))}
                  className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer"
                />
                <span className="text-xs text-gray-600 w-10 text-right">{fadeOut.toFixed(1)}s</span>
              </div>
            </div>

          </>
        )}
      </div>
    </div>
  );
}
