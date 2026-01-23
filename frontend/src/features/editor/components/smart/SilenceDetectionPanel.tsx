/**
 * 静音检测面板
 */
'use client';

import React, { useState, useMemo } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { 
  VolumeX, Wand2, Check,
  Scissors, Settings 
} from 'lucide-react';
import type { SilenceSegment, EditAction } from './types';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

interface SilenceDetectionPanelProps {
  projectId: string;
  audioUrl?: string;
  onApplyEdits?: (edits: EditAction[]) => void;
}

export function SilenceDetectionPanel({ projectId, audioUrl, onApplyEdits }: SilenceDetectionPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [silences, setSilences] = useState<SilenceSegment[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [selectedSilences, setSelectedSilences] = useState<Set<number>>(new Set());
  
  // 配置
  const [threshold, setThreshold] = useState(-35);
  const [minDuration, setMinDuration] = useState(0.5);
  const [method, setMethod] = useState<'energy' | 'silero' | 'ffmpeg'>('energy');

  const detectSilence = async () => {
    if (!audioUrl) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/ai/detect-silence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          audio_url: audioUrl,
          method,
          silence_threshold_db: threshold,
          min_silence_duration: minDuration
        })
      });
      
      const data = await response.json();
      setSilences(data.silences || []);
      setStats(data.stats);
      setSelectedSilences(new Set(data.silences?.map((_: any, i: number) => i) || []));
    } catch (error) {
      debugError('静音检测失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSilence = (index: number) => {
    const newSelected = new Set(selectedSilences);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedSilences(newSelected);
  };

  const selectAll = () => {
    setSelectedSilences(new Set(silences.map((_, i) => i)));
  };

  const deselectAll = () => {
    setSelectedSilences(new Set());
  };

  const applyDeletion = () => {
    const edits = silences
      .filter((_, i) => selectedSilences.has(i))
      .map(s => ({
        type: 'cut',
        start: s.start,
        end: s.end,
        reason: `删除静音 (${s.duration.toFixed(2)}s)`
      }));
    
    onApplyEdits?.(edits);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const totalSelectedDuration = useMemo(() => {
    return silences
      .filter((_, i) => selectedSilences.has(i))
      .reduce((sum, s) => sum + s.duration, 0);
  }, [silences, selectedSilences]);

  return (
    <div className="space-y-4">
      {/* 配置区 */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          检测配置
        </h4>
        
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">静音阈值 (dB)</label>
            <input
              type="range"
              min="-50"
              max="-20"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full accent-gray-600"
            />
            <div className="text-xs text-gray-500 text-center">{threshold} dB</div>
          </div>
          
          <div>
            <label className="text-xs text-gray-500">最小时长 (秒)</label>
            <input
              type="range"
              min="0.1"
              max="2"
              step="0.1"
              value={minDuration}
              onChange={(e) => setMinDuration(Number(e.target.value))}
              className="w-full accent-gray-600"
            />
            <div className="text-xs text-gray-500 text-center">{minDuration}s</div>
          </div>
        </div>
        
        <div>
          <label className="text-xs text-gray-500">检测方法</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as any)}
            className="w-full mt-1 px-3 py-1.5 bg-white border border-gray-200 rounded text-sm text-gray-900"
          >
            <option value="energy">能量检测 (快速)</option>
            <option value="silero">Silero VAD (准确)</option>
            <option value="ffmpeg">FFmpeg (无依赖)</option>
          </select>
        </div>
        
        <button
          onClick={detectSilence}
          disabled={isLoading || !audioUrl}
          className="w-full py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-300 text-white
                     rounded-lg flex items-center justify-center gap-2 text-sm"
        >
          {isLoading ? (
            <>
              <RabbitLoader size={16} />
              检测中...
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4" />
              开始检测
            </>
          )}
        </button>
      </div>

      {/* 结果区 */}
      {silences.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-200">
          {/* 统计信息 */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              检测到 <span className="text-gray-900 font-medium">{silences.length}</span> 段静音
            </span>
            <span className="text-gray-500">
              可节省 <span className="text-green-600 font-medium">
                {totalSelectedDuration.toFixed(1)}s
              </span>
            </span>
          </div>
          
          {/* 操作按钮 */}
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
            >
              全选
            </button>
            <button
              onClick={deselectAll}
              className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
            >
              取消全选
            </button>
            <button
              onClick={applyDeletion}
              disabled={selectedSilences.size === 0}
              className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white
                         rounded flex items-center gap-1"
            >
              <Scissors className="w-3 h-3" />
              删除选中 ({selectedSilences.size})
            </button>
          </div>
          
          {/* 静音列表 */}
          <div className="max-h-60 overflow-y-auto space-y-1">
            {silences.map((silence, index) => (
              <div
                key={index}
                onClick={() => toggleSilence(index)}
                className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors
                           ${selectedSilences.has(index) 
                             ? 'bg-gray-100 border border-gray-300' 
                             : 'bg-gray-100 hover:bg-gray-200'}`}
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center
                               ${selectedSilences.has(index) 
                                 ? 'bg-gray-600 border-gray-500 text-white' 
                                 : 'border-gray-400'}`}>
                  {selectedSilences.has(index) && <Check className="w-3 h-3" />}
                </div>
                
                <VolumeX className="w-4 h-4 text-gray-500" />
                
                <div className="flex-1 text-sm">
                  <span className="text-gray-700">
                    {formatTime(silence.start)} - {formatTime(silence.end)}
                  </span>
                </div>
                
                <span className="text-xs text-gray-500">
                  {silence.duration.toFixed(2)}s
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SilenceDetectionPanel;
