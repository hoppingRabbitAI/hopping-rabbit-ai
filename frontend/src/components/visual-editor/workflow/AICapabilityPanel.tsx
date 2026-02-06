/**
 * AI 能力面板
 * 选中 Clip 后显示可用的 AI 处理选项
 */

'use client';

import React from 'react';
import { 
  ImagePlus, 
  Film, 
  Subtitles, 
  Palette, 
  AudioLines,
  X,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { AI_CAPABILITIES, AICapability, ClipNodeData } from './types';

// 图标映射
const IconMap: Record<string, React.FC<{ className?: string }>> = {
  ImagePlus,
  Film,
  Subtitles,
  Palette,
  AudioLines,
};

interface AICapabilityPanelProps {
  selectedClip: ClipNodeData | null;
  onClose: () => void;
  onSelectCapability: (capability: AICapability) => void;
}

export function AICapabilityPanel({ 
  selectedClip, 
  onClose, 
  onSelectCapability 
}: AICapabilityPanelProps) {
  if (!selectedClip) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 按分类分组
  const groupedCapabilities = AI_CAPABILITIES.reduce((acc, cap) => {
    if (!acc[cap.category]) {
      acc[cap.category] = [];
    }
    acc[cap.category].push(cap);
    return acc;
  }, {} as Record<string, AICapability[]>);

  const categoryLabels: Record<string, string> = {
    visual: '视觉效果',
    audio: '音频处理',
    text: '文本/字幕',
    effect: '特效滤镜',
  };

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col">
      {/* 头部 */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-gray-800">AI 能力</h3>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        
        {/* 选中的 Clip 信息 */}
        <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
          {selectedClip.thumbnail ? (
            <img 
              src={selectedClip.thumbnail} 
              alt="Clip"
              className="w-12 h-12 rounded object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center">
              <Film className="w-5 h-5 text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800">
              分镜 #{selectedClip.index + 1}
            </p>
            <p className="text-xs text-gray-500">
              {formatTime(selectedClip.startTime)} - {formatTime(selectedClip.endTime)}
            </p>
          </div>
        </div>
      </div>
      
      {/* 能力列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {Object.entries(groupedCapabilities).map(([category, capabilities]) => (
          <div key={category}>
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              {categoryLabels[category] || category}
            </h4>
            <div className="space-y-1">
              {capabilities.map((cap) => {
                const Icon = IconMap[cap.icon] || Sparkles;
                return (
                  <button
                    key={cap.id}
                    onClick={() => onSelectCapability(cap)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group text-left"
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{cap.name}</p>
                      <p className="text-xs text-gray-500 truncate">{cap.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      
      {/* 底部提示 */}
      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <p className="text-xs text-gray-500 text-center">
          选择一个 AI 能力来处理这个分镜
        </p>
      </div>
    </div>
  );
}
