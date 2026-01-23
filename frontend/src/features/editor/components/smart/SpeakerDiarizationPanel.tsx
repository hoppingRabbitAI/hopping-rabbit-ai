/**
 * 说话人分离面板
 */
'use client';

import React, { useState, useMemo } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { 
  Users, Wand2, Check, Scissors, Settings, 
  User, UserPlus, Palette 
} from 'lucide-react';
import type { Speaker, SpeakerSegment, EditAction } from './types';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

interface SpeakerDiarizationPanelProps {
  projectId: string;
  audioUrl?: string;
  onApplyEdits?: (edits: EditAction[]) => void;
}

const SPEAKER_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', 
  '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
];

export function SpeakerDiarizationPanel({ projectId, audioUrl, onApplyEdits }: SpeakerDiarizationPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [segments, setSegments] = useState<SpeakerSegment[]>([]);
  const [selectedSpeakers, setSelectedSpeakers] = useState<Set<string>>(new Set());
  
  // 配置
  const [numSpeakers, setNumSpeakers] = useState<number | 'auto'>('auto');
  const [minSpeakers, setMinSpeakers] = useState(1);
  const [maxSpeakers, setMaxSpeakers] = useState(5);

  const runDiarization = async () => {
    if (!audioUrl) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/ai/diarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          audio_url: audioUrl,
          num_speakers: numSpeakers === 'auto' ? null : numSpeakers,
          min_speakers: minSpeakers,
          max_speakers: maxSpeakers
        })
      });
      
      const data = await response.json();
      
      // 处理说话人
      const speakerList: Speaker[] = (data.speakers || []).map((s: any, i: number) => ({
        id: s.id || `speaker_${i}`,
        name: s.name || `说话人 ${i + 1}`,
        color: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
        totalDuration: 0
      }));
      
      // 处理片段
      const segmentList: SpeakerSegment[] = (data.segments || []).map((seg: any) => ({
        start: seg.start,
        end: seg.end,
        speakerId: seg.speaker_id
      }));
      
      // 计算每个说话人的总时长
      segmentList.forEach(seg => {
        const speaker = speakerList.find(s => s.id === seg.speakerId);
        if (speaker) {
          speaker.totalDuration += seg.end - seg.start;
        }
      });
      
      setSpeakers(speakerList);
      setSegments(segmentList);
      setSelectedSpeakers(new Set(speakerList.map(s => s.id)));
    } catch (error) {
      debugError('说话人分离失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSpeaker = (speakerId: string) => {
    const newSelected = new Set(selectedSpeakers);
    if (newSelected.has(speakerId)) {
      newSelected.delete(speakerId);
    } else {
      newSelected.add(speakerId);
    }
    setSelectedSpeakers(newSelected);
  };

  const keepOnlySelected = () => {
    // 删除未选中说话人的所有片段
    const edits = segments
      .filter(seg => !selectedSpeakers.has(seg.speakerId))
      .map(seg => ({
        type: 'cut',
        start: seg.start,
        end: seg.end,
        reason: `删除说话人片段`
      }));
    
    onApplyEdits?.(edits);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  };

  return (
    <div className="space-y-4">
      {/* 配置区 */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          检测配置
        </h4>
        
        {/* 说话人数量 */}
        <div>
          <label className="text-xs text-gray-500">说话人数量</label>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => setNumSpeakers('auto')}
              className={`flex-1 py-1.5 rounded text-sm transition-colors
                         ${numSpeakers === 'auto' 
                           ? 'bg-gray-700 text-white' 
                           : 'bg-white border border-gray-200 hover:bg-gray-200'}`}
            >
              自动检测
            </button>
            <button
              onClick={() => setNumSpeakers(2)}
              className={`flex-1 py-1.5 rounded text-sm transition-colors
                         ${numSpeakers !== 'auto' 
                           ? 'bg-gray-700 text-white' 
                           : 'bg-white border border-gray-200 hover:bg-gray-200'}`}
            >
              手动指定
            </button>
          </div>
        </div>
        
        {numSpeakers !== 'auto' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">最少</label>
              <input
                type="number"
                min="1"
                max="10"
                value={minSpeakers}
                onChange={(e) => setMinSpeakers(Number(e.target.value))}
                className="w-full mt-1 px-3 py-1.5 bg-white border border-gray-200 rounded text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">最多</label>
              <input
                type="number"
                min="1"
                max="10"
                value={maxSpeakers}
                onChange={(e) => setMaxSpeakers(Number(e.target.value))}
                className="w-full mt-1 px-3 py-1.5 bg-white border border-gray-200 rounded text-sm"
              />
            </div>
          </div>
        )}
        
        <button
          onClick={runDiarization}
          disabled={isLoading || !audioUrl}
          className="w-full py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-300 
                     rounded-lg flex items-center justify-center gap-2 text-sm"
        >
          {isLoading ? (
            <>
              <RabbitLoader size={16} />
              分析中...
            </>
          ) : (
            <>
              <Users className="w-4 h-4" />
              开始分离
            </>
          )}
        </button>
      </div>

      {/* 结果区 */}
      {speakers.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
          {/* 统计信息 */}
          <div className="text-sm text-gray-500">
            检测到 <span className="text-gray-900 font-medium">{speakers.length}</span> 位说话人，
            共 <span className="text-gray-900 font-medium">{segments.length}</span> 个片段
          </div>
          
          {/* 说话人列表 */}
          <div className="space-y-2">
            {speakers.map(speaker => (
              <div
                key={speaker.id}
                onClick={() => toggleSpeaker(speaker.id)}
                className={`flex items-center gap-3 p-3 rounded cursor-pointer transition-colors
                           ${selectedSpeakers.has(speaker.id) 
                             ? 'bg-white border border-gray-200' 
                             : 'bg-gray-100 opacity-50'}`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center
                               ${selectedSpeakers.has(speaker.id) 
                                 ? 'border-white' 
                                 : 'border-gray-500'}`}
                     style={{ backgroundColor: speaker.color }}>
                  {selectedSpeakers.has(speaker.id) && <Check className="w-3 h-3" />}
                </div>
                
                <User className="w-4 h-4" style={{ color: speaker.color }} />
                
                <span className="font-medium">{speaker.name}</span>
                
                <div className="flex-1 text-right text-sm text-gray-500">
                  {formatDuration(speaker.totalDuration)}
                </div>
              </div>
            ))}
          </div>
          
          {/* 操作按钮 */}
          <button
            onClick={keepOnlySelected}
            disabled={selectedSpeakers.size === 0 || selectedSpeakers.size === speakers.length}
            className="w-full py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-300 
                       rounded-lg flex items-center justify-center gap-2 text-sm"
          >
            <Scissors className="w-4 h-4" />
            仅保留选中说话人
          </button>
        </div>
      )}
    </div>
  );
}

export default SpeakerDiarizationPanel;
