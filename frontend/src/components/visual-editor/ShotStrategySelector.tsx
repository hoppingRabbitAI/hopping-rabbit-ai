'use client';

import React, { useState } from 'react';
import { 
  Film, 
  MessageSquare, 
  FileText, 
  Sparkles,
  ArrowRight,
  Loader2,
  Video,
  CheckCircle2,
} from 'lucide-react';

// ==========================================
// 类型定义
// ==========================================

export type ShotStrategy = 'scene' | 'sentence' | 'paragraph';

interface StrategyOption {
  id: ShotStrategy;
  icon: React.ReactNode;
  title: string;
  description: string;
  details: string[];
  recommended?: boolean;
}

interface ShotStrategySelectorProps {
  onSelect: (strategy: ShotStrategy) => void;
  isAnalyzing: boolean;
  videoName?: string;
  videoDuration?: number;
}

// ==========================================
// 策略选项定义
// ==========================================

const STRATEGIES: StrategyOption[] = [
  {
    id: 'scene',
    icon: <Film size={20} />,
    title: '场景拆分',
    description: '根据视频画面变化自动检测镜头切换',
    details: [
      '适合多场景、多机位视频',
      '自动识别画面转场点',
      '保持场景完整性',
    ],
    recommended: true,
  },
  {
    id: 'sentence',
    icon: <MessageSquare size={20} />,
    title: '按句拆分',
    description: '根据语音转写结果，每句话一个分镜',
    details: [
      '适合口播、演讲类视频',
      '精细到每句话的控制',
      '便于逐句调整背景',
    ],
  },
  {
    id: 'paragraph',
    icon: <FileText size={20} />,
    title: '按段落拆分',
    description: '按语义分析，根据内容主题拆分',
    details: [
      '适合长视频、课程内容',
      '按主题自动分组',
      '减少分镜数量',
    ],
  },
];

// ==========================================
// 工具函数
// ==========================================

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ==========================================
// 主组件
// ==========================================

export default function ShotStrategySelector({
  onSelect,
  isAnalyzing,
  videoName,
  videoDuration,
}: ShotStrategySelectorProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<ShotStrategy | null>(null);
  
  const handleConfirm = () => {
    if (selectedStrategy) {
      onSelect(selectedStrategy);
    }
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      
      {/* 弹窗内容 */}
      <div className="relative w-full max-w-2xl bg-white border border-gray-200 rounded-3xl p-8 space-y-6 animate-in zoom-in-95 fade-in duration-300 shadow-2xl mx-4">
        {/* 标题 */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-100 rounded-2xl mb-4">
            <Sparkles size={24} className="text-gray-700" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">
            选择分镜拆分策略
          </h2>
          <p className="text-gray-500 text-sm">
            根据视频内容类型，选择最适合的分镜方式
          </p>
          
          {/* 视频信息 */}
          {(videoName || videoDuration) && (
            <div className="mt-4 inline-flex items-center gap-3 px-4 py-2 bg-gray-50 border border-gray-200 rounded-full">
              <Video size={16} className="text-gray-500" />
              {videoName && (
                <span className="text-gray-700 text-sm font-medium">{videoName}</span>
              )}
              {videoDuration && (
                <span className="text-gray-400 text-sm">
                  {formatDuration(videoDuration)}
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* 策略选项 */}
        <div className="space-y-3">
          {STRATEGIES.map((strategy) => (
            <button
              key={strategy.id}
              onClick={() => setSelectedStrategy(strategy.id)}
              disabled={isAnalyzing}
              className={`relative w-full p-4 rounded-2xl border text-left transition-all ${
                selectedStrategy === strategy.id
                  ? 'bg-gray-50 border-gray-800 ring-1 ring-gray-800/50'
                  : 'bg-gray-50 border-gray-200 hover:border-gray-300'
              } ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-start gap-4">
                {/* 图标 */}
                <div className={`p-2.5 rounded-xl transition-colors ${
                  selectedStrategy === strategy.id
                    ? 'bg-gray-800 text-white shadow-lg shadow-gray-800/20'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {strategy.icon}
                </div>
                
                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-gray-900 text-sm">
                      {strategy.title}
                    </h4>
                    {strategy.recommended && (
                      <span className="text-[8px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded uppercase font-black">
                        推荐
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {strategy.description}
                  </p>
                  
                  {/* 详情 - 选中时显示 */}
                  {selectedStrategy === strategy.id && (
                    <ul className="mt-3 space-y-1">
                      {strategy.details.map((detail, index) => (
                        <li key={index} className="flex items-center gap-2 text-xs text-gray-600">
                          <div className="w-1 h-1 bg-gray-400 rounded-full" />
                          {detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                
                {/* 选中指示器 */}
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selectedStrategy === strategy.id
                    ? 'border-gray-800 bg-gray-800'
                    : 'border-gray-300'
                }`}>
                  {selectedStrategy === strategy.id && (
                    <CheckCircle2 size={12} className="text-white" />
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
        
        {/* 操作按钮 */}
        <button
          onClick={handleConfirm}
          disabled={!selectedStrategy || isAnalyzing}
          className={`w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-xl active:scale-[0.98] ${
            selectedStrategy && !isAnalyzing
              ? 'bg-gray-800 hover:bg-gray-700 text-white shadow-gray-900/20'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
          }`}
        >
          {isAnalyzing ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>正在分析视频...</span>
            </>
          ) : (
            <>
              <Sparkles size={16} />
              <span>开始拆分</span>
              <ArrowRight size={16} />
            </>
          )}
        </button>
        
        {/* 提示 */}
        <p className="text-center text-gray-400 text-xs">
          分析完成后，你可以在编辑器中调整每个分镜的背景和元素
        </p>
      </div>
    </div>
  );
}
