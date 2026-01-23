'use client';

import { useState, useCallback } from 'react';
import { X, Sparkles, Mic, Settings2, MessageSquare } from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { Toggle } from '@/components/common/Toggle';
import { AIToolsWizard } from './AIToolsWizard';

// 调试日志
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[AIToolsPanel]', ...args); };

interface AIToolsPanelProps {
  onClose: () => void;
  clipIds: string[];  // 支持多选
}

export function AIToolsPanel({ onClose, clipIds }: AIToolsPanelProps) {
  const clips = useEditorStore((s) => s.clips);
  const selectedClips = clips.filter(c => clipIds.includes(c.id));
  
  const [options, setOptions] = useState({
    enableAsr: false,
    enableSmartCamera: false,
  });
  const [scriptText, setScriptText] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  
  const handleApply = useCallback(() => {
    if (selectedClips.length === 0) return;
    
    debugLog('打开 AI 工具向导:', {
      clipIds,
      clipsCount: selectedClips.length,
      options,
      scriptText,
    });
    
    // 打开处理向导
    setShowWizard(true);
  }, [selectedClips, clipIds, options, scriptText]);
  
  const handleWizardComplete = useCallback(() => {
    debugLog('AI 工具处理完成');
    onClose();
  }, [onClose]);
  
  if (selectedClips.length === 0) {
    return null;
  }

  return (
    <div className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-gray-700" />
          <span className="text-sm font-medium text-gray-900">AI 工具</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* 选项列表 */}
      <div className="flex-1 min-h-0 px-4 py-4 space-y-4 overflow-y-auto custom-scrollbar">
        {/* ASR 选项 */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
            <Mic size={18} className="text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900">ASR 语音转写</div>
            <div className="text-xs text-gray-400 mt-0.5">生成带时间戳的语音文案</div>
          </div>
          <Toggle
            checked={options.enableAsr}
            onChange={(checked) => setOptions(prev => ({ ...prev, enableAsr: checked }))}
          />
        </div>

        {/* 智能切片与运镜选项 */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
            <Settings2 size={18} className="text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900">智能切片与运镜</div>
            <div className="text-xs text-gray-400 mt-0.5">自动提取高光时刻并优化画面</div>
          </div>
          <Toggle
            checked={options.enableSmartCamera}
            onChange={(checked) => setOptions(prev => ({ ...prev, enableSmartCamera: checked }))}
          />
        </div>

        {/* 原始脚本输入框 */}
        <div className="mt-6">
          <div className="relative">
            <div className="absolute left-3 top-3 text-gray-400">
              <MessageSquare size={16} />
            </div>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder="[可选] 粘贴原始脚本/文案，AI 将对比实际口播内容..."
              className="w-full pl-10 pr-3 py-3 text-sm text-gray-700 placeholder-gray-400 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-gray-500/20 focus:border-gray-400 transition-all"
              rows={4}
            />
          </div>
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="px-4 py-4 border-t border-gray-100">
        <button
          onClick={handleApply}
          disabled={!options.enableAsr && !options.enableSmartCamera}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all
            ${!options.enableAsr && !options.enableSmartCamera
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-gray-700 text-white hover:bg-gray-600'
            }`}
        >
          <Sparkles size={16} />
          <span>应用 AI 工具</span>
        </button>
      </div>

      {/* AI 工具处理向导 */}
      <AIToolsWizard
        isOpen={showWizard}
        clipIds={clipIds}
        options={{
          enableAsr: options.enableAsr,
          enableSmartCamera: options.enableSmartCamera,
          scriptText,
        }}
        onClose={() => setShowWizard(false)}
        onComplete={handleWizardComplete}
      />
    </div>
  );
}
