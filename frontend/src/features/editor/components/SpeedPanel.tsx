/**
 * 变速面板
 * 
 * 功能：
 * 1. 适用于 video、audio、voice clip
 * 2. 变速会改变 clip 的时长（duration = originalDuration / speed）
 * 3. 变速后需要维护与其他 clip 的关联规则（字幕同步等）
 * 
 * 注意：
 * - 变速会改变时长
 * - 变速后需要处理后续 clips 的位置调整（如果有吸附关系）
 */
'use client';

import { useCallback, useMemo } from 'react';
import {
  X,
  Gauge,
  Film,
  AlertTriangle,
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import type { Clip } from '../types/clip';

interface SpeedPanelProps {
  onClose: () => void;
}

// 变速预设档位
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/**
 * 变速面板
 * 适用于 video、audio、voice clip，变速会改变 clip 时长
 */
export function SpeedPanel({ onClose }: SpeedPanelProps) {
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const updateClip = useEditorStore((s) => s.updateClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const currentTime = useEditorStore((s) => s.currentTime);

  // 获取选中的媒体 Clips（video、audio、voice 类型）
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
      const allMediaClips = clips.filter((c) => supportedTypes.includes(c.clipType));
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

  // 当前速度
  const currentSpeed = selectedClip?.speed ?? 1;
  
  // 智能补帧开关
  const smartInterpolation = selectedClip?.metadata?.smartInterpolation ?? false;
  
  // 判断是否为慢速
  const isSlowMotion = currentSpeed < 1;

  // 计算变速后的时长变化
  const durationChange = useMemo(() => {
    if (!selectedClip) return null;
    const originalDuration = selectedClip.duration * currentSpeed; // 还原原始时长
    return {
      original: originalDuration,
      current: selectedClip.duration,
    };
  }, [selectedClip, currentSpeed]);

  /**
   * 更新速度
   * 
   * 关键逻辑：
   * 1. 计算新时长 = 原始时长 / 新速度
   * 2. 查找与该 clip 有吸附关系的后续 clips（同轨道、紧跟在后面的）
   * 3. 更新这些后续 clips 的起始位置，保持吸附关系
   * 4. 对于关联的字幕 clips，需要同步调整时间
   */
  const updateSpeed = useCallback(
    (speed: number) => {
      if (selectedMediaClips.length === 0) return;
      saveToHistory();
      
      const newSpeed = Math.max(0.1, Math.min(4, speed));
      
      selectedMediaClips.forEach(clip => {
        // 计算原始时长（当前时长 * 当前速度）
        const originalDuration = clip.duration * (clip.speed ?? 1);
        // 计算新时长
        const newDuration = originalDuration / newSpeed;
        // 计算时长变化量
        const durationDelta = newDuration - clip.duration;
        
        // 更新当前 clip
        updateClip(clip.id, {
          speed: newSpeed,
          duration: newDuration,
        });
        
        // 如果时长变化了，需要调整后续同轨道的 clips 位置
        if (Math.abs(durationDelta) > 1) { // 忽略极小的变化
          const sameTrackClips = clips
            .filter(c => c.trackId === clip.trackId && c.id !== clip.id)
            .sort((a, b) => a.start - b.start);
          
          // 找到紧跟在后面的 clips（吸附的）
          const clipEnd = clip.start + clip.duration;
          const followingClips = sameTrackClips.filter(c => {
            // 判断是否吸附（起始位置在当前 clip 结束位置附近）
            const gap = c.start - clipEnd;
            return gap >= -10 && gap <= 10; // 10ms 容差
          });
          
          // 递归更新后续 clips 的位置
          let accumulatedDelta = durationDelta;
          followingClips.forEach(followClip => {
            const newStart = followClip.start + accumulatedDelta;
            updateClip(followClip.id, { start: Math.max(0, newStart) });
          });
          
          // 查找与该视频关联的字幕 clips（通过 assetId 或时间重叠判断）
          const relatedSubtitles = clips.filter(c => {
            if (c.clipType !== 'subtitle') return false;
            // 检查时间重叠
            const subtitleInClipRange = 
              c.start >= clip.start && c.start < clip.start + clip.duration;
            return subtitleInClipRange;
          });
          
          // 更新字幕时间（按比例缩放）
          if (relatedSubtitles.length > 0) {
            const speedRatio = (clip.speed ?? 1) / newSpeed;
            relatedSubtitles.forEach(subtitle => {
              // 计算字幕在 clip 内的相对位置
              const relativeStart = subtitle.start - clip.start;
              const relativeDuration = subtitle.duration;
              
              // 按速度比例调整
              const newSubtitleStart = clip.start + (relativeStart * speedRatio);
              const newSubtitleDuration = relativeDuration * speedRatio;
              
              updateClip(subtitle.id, {
                start: Math.max(0, newSubtitleStart),
                duration: newSubtitleDuration,
              });
            });
          }
        }
      });
    },
    [selectedMediaClips, clips, updateClip, saveToHistory]
  );
  
  // 切换智能补帧
  const toggleSmartInterpolation = useCallback(() => {
    if (!selectedClip) return;
    saveToHistory();
    updateClip(selectedClip.id, {
      metadata: {
        ...selectedClip.metadata,
        smartInterpolation: !smartInterpolation,
      },
    });
  }, [selectedClip, smartInterpolation, updateClip, saveToHistory]);

  return (
    <div className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Gauge size={18} className="text-orange-600" />
          <span className="text-sm font-medium text-gray-900">视频变速</span>
          {selectedCount > 1 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-orange-100 text-orange-600 rounded">
              已选 {selectedCount} 个
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 p-4 space-y-5 overflow-y-auto custom-scrollbar">
        {/* 没有选中视频时显示提示 */}
        {!selectedClip ? (
          <div className="text-center py-8">
            <Film size={32} className="mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 text-sm">选择一个视频片段</p>
            <p className="text-gray-400 text-xs mt-1">以调节其播放速度</p>
          </div>
        ) : (
          <>
            {/* 警告提示 */}
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-amber-700 font-medium">变速会改变片段时长</p>
                <p className="text-[10px] text-amber-600 mt-0.5">
                  后续片段位置会自动调整以保持吸附关系
                </p>
              </div>
            </div>

            {/* 变速区块 */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-orange-100 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-orange-500" />
                </div>
                <span className="text-xs text-gray-600 font-medium">速度控制</span>
              </div>

              {/* 倍数滑块 */}
              <div>
                <label className="block text-xs text-gray-600 mb-2">倍数</label>
                <div className="relative">
                  {/* 滑块带刻度 */}
                  <div className="relative h-6">
                    {/* 刻度线 */}
                    <div className="absolute inset-x-0 top-1/2 flex justify-between items-center pointer-events-none px-1">
                      {SPEED_PRESETS.map((preset) => (
                        <div
                          key={preset}
                          className={`w-px h-2 ${
                            preset === 1 ? 'bg-gray-400 h-3' : 'bg-gray-300'
                          }`}
                        />
                      ))}
                    </div>
                    {/* 滑块 */}
                    <input
                      type="range"
                      min={0.25}
                      max={4}
                      step={0.05}
                      value={currentSpeed}
                      onChange={(e) => updateSpeed(Number(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    {/* 自定义滑块轨道 */}
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-gray-200 rounded-full pointer-events-none">
                      <div
                        className="h-full bg-orange-500 rounded-full"
                        style={{
                          width: `${((currentSpeed - 0.25) / (4 - 0.25)) * 100}%`,
                        }}
                      />
                      {/* 滑块手柄 */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border border-gray-300 rounded-full shadow-sm pointer-events-none"
                        style={{
                          left: `calc(${((currentSpeed - 0.25) / (4 - 0.25)) * 100}% - 6px)`,
                        }}
                      />
                    </div>
                  </div>
                  
                  {/* 速度值输入 */}
                  <div className="flex justify-end mt-2">
                    <div className="flex items-center bg-gray-100 rounded px-2 py-1">
                      <input
                        type="number"
                        step={0.05}
                        min={0.1}
                        max={4}
                        value={currentSpeed.toFixed(2)}
                        onChange={(e) => updateSpeed(Number(e.target.value))}
                        className="w-14 bg-transparent text-gray-900 text-sm text-right focus:outline-none"
                      />
                      <span className="text-xs text-gray-500 ml-1">x</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 时长预览 */}
              {durationChange && (
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">原始时长</span>
                    <span className="font-mono text-gray-700">
                      {(durationChange.original / 1000).toFixed(2)}s
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-gray-500">变速后时长</span>
                    <span className={`font-mono font-medium ${
                      currentSpeed > 1 ? 'text-green-600' : currentSpeed < 1 ? 'text-orange-600' : 'text-gray-700'
                    }`}>
                      {(durationChange.current / 1000).toFixed(2)}s
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 分隔线 */}
            <div className="border-t border-gray-200" />

            {/* 智能补帧 - 仅慢速时显示 */}
            {isSlowMotion && (
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">智能补帧</span>
                    <span className="text-[10px] text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">Pro</span>
                  </div>
                  <button
                    onClick={toggleSmartInterpolation}
                    className={`w-10 h-5 rounded-full transition-colors relative ${
                      smartInterpolation ? 'bg-orange-500' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        smartInterpolation ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[10px] text-gray-500">
                  开启后使用 AI 算法在帧间生成平滑过渡，让慢动作更流畅
                </p>
              </div>
            )}

            {/* 快捷预设 */}
            <div className="space-y-3">
              <span className="text-xs text-gray-500">快捷预设</span>
              <div className="grid grid-cols-5 gap-1">
                {[0.5, 0.75, 1, 1.5, 2].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => updateSpeed(preset)}
                    className={`py-2 text-xs rounded-lg transition-colors ${
                      Math.abs(currentSpeed - preset) < 0.01
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {preset}x
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default SpeedPanel;
