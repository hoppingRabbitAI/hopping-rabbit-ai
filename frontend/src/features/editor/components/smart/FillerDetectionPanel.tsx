/**
 * 填充词检测面板
 */
'use client';

import React, { useState, useMemo } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { 
  MessageSquare, Wand2, Check,
  Scissors, Settings, Plus, X, AlertCircle 
} from 'lucide-react';
import { getSessionSafe } from '@/lib/supabase';
import type { FillerWord, EditAction } from './types';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[FillerDetection]', ...args); };

interface FillerDetectionPanelProps {
  projectId: string;
  audioUrl?: string;
  onApplyEdits?: (edits: EditAction[]) => void;
}

const DEFAULT_FILLER_WORDS = [
  '嗯', '啊', '呃', '那个', '就是', '然后',
  '对吧', '其实', '所以', '这个', '那么'
];

export function FillerDetectionPanel({ projectId, audioUrl, onApplyEdits }: FillerDetectionPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [fillerWords, setFillerWords] = useState<FillerWord[]>([]);
  const [selectedFillers, setSelectedFillers] = useState<Set<number>>(new Set());
  
  // 配置
  const [targetWords, setTargetWords] = useState<string[]>(DEFAULT_FILLER_WORDS);
  const [customWord, setCustomWord] = useState('');
  const [minConfidence, setMinConfidence] = useState(0.7);

  const [authError, setAuthError] = useState<string | null>(null);

  const detectFillers = async () => {
    if (!audioUrl) return;
    
    setIsLoading(true);
    setAuthError(null);
    try {
      const session = await getSessionSafe();
      if (!session) {
        setAuthError('请先登录后再进行填充词检测');
        debugLog('未登录，无法检测填充词');
        return;
      }

      const response = await fetch('/api/ai/detect-fillers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: projectId,
          audio_url: audioUrl,
          target_words: targetWords,
          min_confidence: minConfidence
        })
      });
      
      const data = await response.json();
      setFillerWords(data.fillers || []);
      setSelectedFillers(new Set(data.fillers?.map((_: any, i: number) => i) || []));
    } catch (error) {
      debugLog('填充词检测失败:', error);
      setAuthError('检测失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  const addCustomWord = () => {
    if (customWord.trim() && !targetWords.includes(customWord.trim())) {
      setTargetWords([...targetWords, customWord.trim()]);
      setCustomWord('');
    }
  };

  const removeWord = (word: string) => {
    setTargetWords(targetWords.filter(w => w !== word));
  };

  const toggleFiller = (index: number) => {
    const newSelected = new Set(selectedFillers);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedFillers(newSelected);
  };

  const selectAll = () => {
    setSelectedFillers(new Set(fillerWords.map((_, i) => i)));
  };

  const deselectAll = () => {
    setSelectedFillers(new Set());
  };

  const applyDeletion = () => {
    const edits = fillerWords
      .filter((_, i) => selectedFillers.has(i))
      .map(f => ({
        type: 'cut',
        start: f.start,
        end: f.end,
        reason: `删除填充词 "${f.word}"`
      }));
    
    onApplyEdits?.(edits);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // 按词汇分组统计
  const wordStats = useMemo(() => {
    const stats: Record<string, number> = {};
    fillerWords.forEach(f => {
      stats[f.word] = (stats[f.word] || 0) + 1;
    });
    return Object.entries(stats).sort((a, b) => b[1] - a[1]);
  }, [fillerWords]);

  const totalSelectedDuration = useMemo(() => {
    return fillerWords
      .filter((_, i) => selectedFillers.has(i))
      .reduce((sum, f) => sum + (f.end - f.start), 0);
  }, [fillerWords, selectedFillers]);

  return (
    <div className="space-y-4">
      {/* 错误提示 */}
      {authError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{authError}</span>
          <button
            onClick={() => setAuthError(null)}
            className="ml-auto p-1 hover:bg-red-100 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      
      {/* 配置区 */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          检测配置
        </h4>
        
        {/* 目标词汇 */}
        <div>
          <label className="text-xs text-gray-500">目标填充词</label>
          <div className="flex flex-wrap gap-1 mt-1 p-2 bg-gray-100 rounded min-h-[60px]">
            {targetWords.map(word => (
              <span
                key={word}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-200 rounded text-xs"
              >
                {word}
                <button
                  onClick={() => removeWord(word)}
                  className="hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={customWord}
              onChange={(e) => setCustomWord(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomWord()}
              placeholder="添加自定义词汇"
              className="flex-1 px-3 py-1.5 bg-white border border-gray-200 rounded text-sm"
            />
            <button
              onClick={addCustomWord}
              className="px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-200 rounded"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* 置信度阈值 */}
        <div>
          <label className="text-xs text-gray-500">最小置信度</label>
          <input
            type="range"
            min="0.5"
            max="1"
            step="0.05"
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-gray-500 text-center">{(minConfidence * 100).toFixed(0)}%</div>
        </div>
        
        <button
          onClick={detectFillers}
          disabled={isLoading || !audioUrl || targetWords.length === 0}
          className="w-full py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-300 
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
      {fillerWords.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
          {/* 统计信息 */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              检测到 <span className="text-gray-900 font-medium">{fillerWords.length}</span> 个填充词
            </span>
            <span className="text-gray-500">
              可节省 <span className="text-green-400 font-medium">
                {totalSelectedDuration.toFixed(1)}s
              </span>
            </span>
          </div>
          
          {/* 词汇分布 */}
          <div className="flex flex-wrap gap-2">
            {wordStats.slice(0, 5).map(([word, count]) => (
              <span key={word} className="px-2 py-1 bg-white border border-gray-200 rounded text-xs">
                {word}: <span className="text-yellow-600">{count}</span>
              </span>
            ))}
          </div>
          
          {/* 操作按钮 */}
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="px-3 py-1 text-xs bg-white border border-gray-200 hover:bg-gray-200 rounded"
            >
              全选
            </button>
            <button
              onClick={deselectAll}
              className="px-3 py-1 text-xs bg-white border border-gray-200 hover:bg-gray-200 rounded"
            >
              取消全选
            </button>
            <button
              onClick={applyDeletion}
              disabled={selectedFillers.size === 0}
              className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 disabled:bg-gray-300 
                         rounded flex items-center gap-1"
            >
              <Scissors className="w-3 h-3" />
              删除选中 ({selectedFillers.size})
            </button>
          </div>
          
          {/* 填充词列表 */}
          <div className="max-h-60 overflow-y-auto space-y-1">
            {fillerWords.map((filler, index) => (
              <div
                key={index}
                onClick={() => toggleFiller(index)}
                className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors
                           ${selectedFillers.has(index) 
                             ? 'bg-gray-700/20 border border-gray-500/50' 
                             : 'bg-gray-100 hover:bg-gray-200'}`}
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center
                               ${selectedFillers.has(index) 
                                 ? 'bg-gray-600 border-gray-500' 
                                 : 'border-gray-500'}`}>
                  {selectedFillers.has(index) && <Check className="w-3 h-3" />}
                </div>
                
                <MessageSquare className="w-4 h-4 text-yellow-500" />
                
                <span className="font-medium text-yellow-600">{filler.word}</span>
                
                <div className="flex-1 text-sm text-gray-500">
                  {formatTime(filler.start)}
                </div>
                
                <span className="text-xs text-gray-500">
                  {(filler.confidence * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default FillerDetectionPanel;
