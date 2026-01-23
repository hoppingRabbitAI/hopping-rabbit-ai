/**
 * 智能编辑面板 - 主容器组件
 * 整合静音检测、填充词检测、说话人分离、音轨分离功能
 * 新增: 一键 AI 成片功能
 */
'use client';

import React, { useState } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { 
  VolumeX, MessageSquare, Users, Music,
  ChevronDown, Sparkles, Wand2, CheckCircle2, XCircle, Video, RefreshCw, ChevronRight
} from 'lucide-react';
import { SilenceDetectionPanel } from './SilenceDetectionPanel';
import { FillerDetectionPanel } from './FillerDetectionPanel';
import { SpeakerDiarizationPanel } from './SpeakerDiarizationPanel';
import { StemSeparationPanel } from './StemSeparationPanel';
import { useAIVideoCreate } from '../../hooks/useAIVideoCreate';
import type { EditAction, StemTrack } from './types';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

interface SmartPanelProps {
  projectId: string;
  audioUrl?: string;
  videoPath?: string; // 视频源文件路径（AI成片需要）
  onApplyEdits?: (edits: EditAction[]) => void;
  onApplyStems?: (stems: StemTrack[]) => void;
  onAICreateComplete?: () => void; // AI成片完成后回调（刷新时间轴）
}

type TabType = 'silence' | 'filler' | 'speaker' | 'stem';

interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ElementType;
  description: string;
}

const TABS: TabConfig[] = [
  { 
    id: 'silence', 
    label: '静音检测', 
    icon: VolumeX,
    description: '自动检测并删除视频中的静音片段'
  },
  { 
    id: 'filler', 
    label: '填充词', 
    icon: MessageSquare,
    description: '检测并删除"嗯"、"啊"等填充词'
  },
  { 
    id: 'speaker', 
    label: '说话人分离', 
    icon: Users,
    description: '识别不同说话人，可选择保留特定说话人'
  },
  { 
    id: 'stem', 
    label: '音轨分离', 
    icon: Music,
    description: '分离人声、伴奏、鼓点等音轨'
  },
];

export function SmartPanel({ 
  projectId, 
  audioUrl, 
  videoPath,
  onApplyEdits,
  onApplyStems,
  onAICreateComplete
}: SmartPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('silence');
  const [expandedTab, setExpandedTab] = useState<TabType | null>('silence');

  // AI 成片 hook
  const {
    status: aiStatus,
    progress: aiProgress,
    message: aiMessage,
    result: aiResult,
    isProcessing: aiIsProcessing,
    isCompleted: aiIsCompleted,
    isFailed: aiIsFailed,
    startAICreate,
    reset: resetAICreate,
  } = useAIVideoCreate();

  const handleAICreate = async () => {
    if (!videoPath || !audioUrl) return;
    try {
      await startAICreate(projectId, videoPath, audioUrl);
      onAICreateComplete?.();
    } catch (error) {
      debugError('AI 智能剪辑失败:', error);
    }
  };

  const toggleExpand = (tabId: TabType) => {
    if (expandedTab === tabId) {
      setExpandedTab(null);
    } else {
      setExpandedTab(tabId);
      setActiveTab(tabId);
    }
  };

  const renderTabContent = (tabId: TabType) => {
    switch (tabId) {
      case 'silence':
        return (
          <SilenceDetectionPanel
            projectId={projectId}
            audioUrl={audioUrl}
            onApplyEdits={onApplyEdits}
          />
        );
      case 'filler':
        return (
          <FillerDetectionPanel
            projectId={projectId}
            audioUrl={audioUrl}
            onApplyEdits={onApplyEdits}
          />
        );
      case 'speaker':
        return (
          <SpeakerDiarizationPanel
            projectId={projectId}
            audioUrl={audioUrl}
            onApplyEdits={onApplyEdits}
          />
        );
      case 'stem':
        return (
          <StemSeparationPanel
            projectId={projectId}
            audioUrl={audioUrl}
            onApplyStems={onApplyStems}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* 面板标题 */}
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-gray-400" />
          智能编辑
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          AI 驱动的视频编辑辅助工具
        </p>
      </div>

      {/* ★ AI 智能剪辑区域 */}
      <div className="p-4 border-b border-gray-700 bg-gradient-to-br from-gray-800/20 to-gray-700/20">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2.5 bg-gradient-to-br from-gray-500/30 to-gray-600/30 rounded-xl">
            <Wand2 size={18} className="text-gray-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">AI 智能剪辑</h3>
            <p className="text-[10px] text-gray-500">自动剪辑 · 智能运镜 · 字幕生成</p>
          </div>
        </div>

        {/* 处理状态 */}
        {aiStatus === 'idle' && (
          <>
            {/* 功能简介 */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="p-2 bg-gray-50 rounded-lg text-center border border-gray-100">
                <Video size={14} className="mx-auto text-gray-600 mb-1" />
                <span className="text-[10px] text-gray-600">智能切片</span>
              </div>
              <div className="p-2 bg-gray-50 rounded-lg text-center border border-gray-100">
                <RefreshCw size={14} className="mx-auto text-green-500 mb-1" />
                <span className="text-[10px] text-gray-600">自动运镜</span>
              </div>
              <div className="p-2 bg-gray-50 rounded-lg text-center border border-gray-100">
                <MessageSquare size={14} className="mx-auto text-gray-500 mb-1" />
                <span className="text-[10px] text-gray-600">字幕生成</span>
              </div>
            </div>

            {/* 开始按钮 */}
            <button
              onClick={handleAICreate}
              disabled={!videoPath || !audioUrl}
              className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-gray-900/30 active:scale-[0.98]"
            >
              <Sparkles size={14} />
              <span>开始 AI 智能剪辑</span>
              <ChevronRight size={14} />
            </button>

            {!videoPath && (
              <p className="text-[10px] text-gray-500 text-center mt-2">请先上传视频文件</p>
            )}
          </>
        )}

        {/* 处理中 */}
        {aiIsProcessing && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <RabbitLoader size={16} />
              <p className="text-xs text-gray-700 flex-1">{aiMessage}</p>
              <span className="text-xs text-gray-600 font-mono">{aiProgress}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-gray-600 to-gray-400 transition-all duration-300"
                style={{ width: `${aiProgress}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-500 text-center">处理中，请勿关闭页面...</p>
          </div>
        )}

        {/* 完成 */}
        {aiIsCompleted && aiResult && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle2 size={18} />
              <span className="text-sm font-bold">AI 智能剪辑完成！</span>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900">{aiResult.clips_count}</p>
                <p className="text-[10px] text-gray-500">视频片段</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900">{aiResult.subtitles_count}</p>
                <p className="text-[10px] text-gray-500">字幕条目</p>
              </div>
            </div>
            <button
              onClick={resetAICreate}
              className="w-full py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium transition-colors text-gray-700"
            >
              完成
            </button>
          </div>
        )}

        {/* 失败 */}
        {aiIsFailed && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-red-500">
              <XCircle size={18} />
              <span className="text-sm font-bold">处理失败</span>
            </div>
            <p className="text-xs text-gray-600 p-2 bg-red-50 border border-red-200 rounded-lg">
              {aiMessage}
            </p>
            <div className="flex gap-2">
              <button
                onClick={resetAICreate}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium transition-colors text-gray-700"
              >
                关闭
              </button>
              <button
                onClick={handleAICreate}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-medium transition-colors"
              >
                重试
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 功能选项卡 */}
      <div className="flex-1 overflow-y-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isExpanded = expandedTab === tab.id;
          
          return (
            <div key={tab.id} className="border-b border-gray-200">
              {/* Tab 头部 */}
              <button
                onClick={() => toggleExpand(tab.id)}
                className={`w-full p-4 flex items-center gap-3 hover:bg-gray-100 transition-colors
                           ${isExpanded ? 'bg-gray-100' : ''}`}
              >
                <div className={`p-2 rounded-lg ${isExpanded ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-900">{tab.label}</div>
                  <div className="text-xs text-gray-500">{tab.description}</div>
                </div>
                
                <ChevronDown 
                  className={`w-4 h-4 text-gray-500 transition-transform
                             ${isExpanded ? 'rotate-180' : ''}`}
                />
              </button>
              
              {/* Tab 内容 */}
              {isExpanded && (
                <div className="p-4 bg-gray-850 border-t border-gray-700">
                  {renderTabContent(tab.id)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部提示 */}
      <div className="p-4 border-t border-gray-700 text-center">
        <p className="text-xs text-gray-500">
          {!audioUrl 
            ? '请先上传包含音频的视频文件' 
            : '选择一个功能开始智能编辑'}
        </p>
      </div>
    </div>
  );
}

export default SmartPanel;
