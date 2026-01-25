/**
 * 音频分轨面板
 */
'use client';

import React, { useState } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { 
  Music, Wand2, Settings, 
  Volume2, VolumeX, Download, Play, Pause, AlertCircle, X 
} from 'lucide-react';
import { getSessionSafe } from '@/lib/supabase';
import type { StemTrack } from './types';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[StemSeparation]', ...args); };

interface StemSeparationPanelProps {
  projectId: string;
  audioUrl?: string;
  onApplyStems?: (stems: StemTrack[]) => void;
}

const STEM_CONFIGS = {
  '2stems': { name: '2轨 (人声/伴奏)', stems: ['vocals', 'accompaniment'] },
  '4stems': { name: '4轨 (人声/鼓/贝斯/其他)', stems: ['vocals', 'drums', 'bass', 'other'] },
  '5stems': { name: '5轨 (人声/鼓/贝斯/钢琴/其他)', stems: ['vocals', 'drums', 'bass', 'piano', 'other'] },
};

const STEM_NAMES: Record<string, string> = {
  vocals: '人声',
  accompaniment: '伴奏',
  drums: '鼓',
  bass: '贝斯',
  piano: '钢琴',
  other: '其他'
};

const STEM_COLORS: Record<string, string> = {
  vocals: '#3B82F6',
  accompaniment: '#10B981',
  drums: '#F59E0B',
  bass: '#EF4444',
  piano: '#8B5CF6',
  other: '#6B7280'
};

export function StemSeparationPanel({ projectId, audioUrl, onApplyStems }: StemSeparationPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [stems, setStems] = useState<StemTrack[]>([]);
  const [mutedStems, setMutedStems] = useState<Set<string>>(new Set());
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  
  // 配置
  const [model, setModel] = useState<'spleeter' | 'demucs'>('demucs');
  const [stemConfig, setStemConfig] = useState<'2stems' | '4stems' | '5stems'>('2stems');

  const separateStems = async () => {
    if (!audioUrl) return;
    
    setIsLoading(true);
    setAuthError(null);
    try {
      const session = await getSessionSafe();
      if (!session) {
        setAuthError('请先登录后再进行音轨分离');
        debugLog('未登录，无法分离音轨');
        return;
      }

      const response = await fetch('/api/ai/separate-stems', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: projectId,
          audio_url: audioUrl,
          model,
          num_stems: stemConfig
        })
      });
      
      const data = await response.json();
      
      const stemList: StemTrack[] = (data.stems || []).map((s: any) => ({
        name: s.name,
        url: s.url,
        volume: 1.0
      }));
      
      setStems(stemList);
      setMutedStems(new Set());
    } catch (error) {
      debugLog('音轨分离失败:', error);
      setAuthError('音轨分离失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMute = (stemName: string) => {
    const newMuted = new Set(mutedStems);
    if (newMuted.has(stemName)) {
      newMuted.delete(stemName);
    } else {
      newMuted.add(stemName);
    }
    setMutedStems(newMuted);
  };

  const soloStem = (stemName: string) => {
    // 静音所有其他音轨
    const newMuted = new Set(stems.map(s => s.name).filter(n => n !== stemName));
    setMutedStems(newMuted);
  };

  const unmuteAll = () => {
    setMutedStems(new Set());
  };

  const applyStems = () => {
    // 返回未静音的音轨
    const activeStems = stems.filter(s => !mutedStems.has(s.name));
    onApplyStems?.(activeStems);
  };

  const previewStem = (stemName: string) => {
    if (playingPreview === stemName) {
      setPlayingPreview(null);
    } else {
      setPlayingPreview(stemName);
    }
  };

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
          分离配置
        </h4>
        
        {/* 模型选择 */}
        <div>
          <label className="text-xs text-gray-500">分离模型</label>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => setModel('demucs')}
              className={`flex-1 py-1.5 rounded text-sm transition-colors
                         ${model === 'demucs' 
                           ? 'bg-gray-700 text-white' 
                           : 'bg-white border border-gray-200 hover:bg-gray-200'}`}
            >
              Demucs (高质量)
            </button>
            <button
              onClick={() => setModel('spleeter')}
              className={`flex-1 py-1.5 rounded text-sm transition-colors
                         ${model === 'spleeter' 
                           ? 'bg-gray-700 text-white' 
                           : 'bg-white border border-gray-200 hover:bg-gray-200'}`}
            >
              Spleeter (快速)
            </button>
          </div>
        </div>
        
        {/* 音轨数量 */}
        <div>
          <label className="text-xs text-gray-500">分离模式</label>
          <select
            value={stemConfig}
            onChange={(e) => setStemConfig(e.target.value as any)}
            className="w-full mt-1 px-3 py-1.5 bg-white border border-gray-200 rounded text-sm"
          >
            {Object.entries(STEM_CONFIGS).map(([key, config]) => (
              <option key={key} value={key}>{config.name}</option>
            ))}
          </select>
        </div>
        
        <button
          onClick={separateStems}
          disabled={isLoading || !audioUrl}
          className="w-full py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-300 
                     rounded-lg flex items-center justify-center gap-2 text-sm"
        >
          {isLoading ? (
            <>
              <RabbitLoader size={16} />
              分离中... (可能需要几分钟)
            </>
          ) : (
            <>
              <Music className="w-4 h-4" />
              开始分离
            </>
          )}
        </button>
      </div>

      {/* 结果区 */}
      {stems.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              分离完成: <span className="text-gray-900 font-medium">{stems.length}</span> 个音轨
            </span>
            <button
              onClick={unmuteAll}
              className="text-xs text-gray-500 hover:text-gray-400"
            >
              取消所有静音
            </button>
          </div>
          
          {/* 音轨列表 */}
          <div className="space-y-2">
            {stems.map(stem => (
              <div
                key={stem.name}
                className={`flex items-center gap-3 p-3 rounded transition-colors
                           ${mutedStems.has(stem.name) 
                             ? 'bg-gray-100 opacity-50' 
                             : 'bg-white border border-gray-200'}`}
              >
                {/* 音轨颜色指示 */}
                <div 
                  className="w-3 h-8 rounded"
                  style={{ backgroundColor: STEM_COLORS[stem.name] || '#6B7280' }}
                />
                
                {/* 音轨名称 */}
                <div className="flex-1">
                  <span className="font-medium">
                    {STEM_NAMES[stem.name] || stem.name}
                  </span>
                </div>
                
                {/* 操作按钮 */}
                <div className="flex gap-1">
                  {/* 预览 */}
                  <button
                    onClick={() => previewStem(stem.name)}
                    className="p-1.5 hover:bg-gray-200 rounded"
                    title="预览"
                  >
                    {playingPreview === stem.name ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </button>
                  
                  {/* 静音/取消静音 */}
                  <button
                    onClick={() => toggleMute(stem.name)}
                    className={`p-1.5 rounded transition-colors
                               ${mutedStems.has(stem.name) 
                                 ? 'bg-red-600 hover:bg-red-700' 
                                 : 'hover:bg-gray-200'}`}
                    title={mutedStems.has(stem.name) ? '取消静音' : '静音'}
                  >
                    {mutedStems.has(stem.name) ? (
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  
                  {/* 独奏 */}
                  <button
                    onClick={() => soloStem(stem.name)}
                    className="px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-700 rounded"
                    title="独奏"
                  >
                    S
                  </button>
                  
                  {/* 下载 */}
                  <a
                    href={stem.url}
                    download
                    className="p-1.5 hover:bg-gray-200 rounded"
                    title="下载"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>
          
          {/* 应用按钮 */}
          <button
            onClick={applyStems}
            className="w-full py-2 bg-green-600 hover:bg-green-700 
                       rounded-lg flex items-center justify-center gap-2 text-sm"
          >
            <Wand2 className="w-4 h-4" />
            应用选中音轨到时间线
          </button>
        </div>
      )}
    </div>
  );
}

export default StemSeparationPanel;
