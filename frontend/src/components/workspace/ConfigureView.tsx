'use client';

import React, { useState } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { 
  Sparkles, 
  CheckCircle2, 
  ArrowRight,
  FileVideo,
  Youtube,
  Mic,
  Wand2,
  Video,
  RefreshCw,
  MessageSquare,
  X,
  Settings2
} from 'lucide-react';

// ==================== 调试开关 ====================
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log(...args); };
const debugWarn = (...args: unknown[]) => { if (DEBUG_ENABLED) console.warn(...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };
import { 
  createSession,
  type TaskType as ApiTaskType,
  type FileInfo 
} from '@/features/editor/lib/workspace-api';
import { getVideoDuration } from '@/features/editor/lib/media-cache';
import type { SessionData, SourceData } from '@/app/workspace/page';

// ★ AIProcessingSteps 已删除，由 taskType 决定处理流程

interface ConfigureViewProps {
  sourceType: 'file' | 'link' | null;
  sourceData: SourceData;
  onBack: () => void;
  onStart: (taskType: 'clips' | 'summary' | 'ai-create', sessionData: SessionData) => void;
}

export function ConfigureView({ sourceType, sourceData, onBack, onStart }: ConfigureViewProps) {
  const [selectedTask, setSelectedTask] = useState<'clips' | 'summary' | 'ai-create'>('ai-create');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 脚本输入
  const [scriptText, setScriptText] = useState('');

  const getSourceInfo = () => {
    // 多文件模式
    if (sourceType === 'file' && sourceData.files && sourceData.files.length > 0) {
      const totalSize = sourceData.files.reduce((sum, f) => sum + f.size, 0);
      return {
        icon: <FileVideo size={16} />,
        label: `${sourceData.files.length} 个视频文件`,
        detail: `共 ${(totalSize / (1024 * 1024)).toFixed(1)} MB`,
      };
    }
    // 单文件模式
    if (sourceType === 'file' && sourceData.file) {
      return {
        icon: <FileVideo size={16} />,
        label: sourceData.file.name,
        detail: `${(sourceData.file.size / (1024 * 1024)).toFixed(1)} MB`,
      };
    }
    if (sourceType === 'link' && sourceData.link) {
      return {
        icon: <Youtube size={16} className="text-red-500" />,
        label: 'YouTube 视频',
        detail: sourceData.link.length > 40 
          ? sourceData.link.substring(0, 40) + '...' 
          : sourceData.link,
      };
    }
    return null;
  };

  const handleStart = async () => {
    if (!sourceType) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // === 多文件模式 ===
      if (sourceType === 'file' && sourceData.files && sourceData.files.length > 0) {
        debugLog('[ConfigureView] 多文件模式, 文件数:', sourceData.files.length);
        
        // 并行提取所有视频时长
        const filesInfo: FileInfo[] = await Promise.all(
          sourceData.files.map(async (file, index) => {
            let duration: number | undefined;
            try {
              const durationMs = await getVideoDuration(file);
              duration = durationMs / 1000;
            } catch (e) {
              debugWarn(`无法提取视频时长: ${file.name}`, e);
            }
            return {
              name: file.name,
              size: file.size,
              content_type: file.type || 'video/mp4',
              duration,
              order_index: index,
            };
          })
        );
        
        const sessionResponse = await createSession({
          source_type: 'local',
          task_type: selectedTask as ApiTaskType,
          files: filesInfo,
        });
        
        debugLog('[ConfigureView] 📦 createSession 返回:', sessionResponse);
        debugLog('[ConfigureView]    session_id:', sessionResponse.session_id);
        debugLog('[ConfigureView]    project_id:', sessionResponse.project_id);
        debugLog('[ConfigureView]    assets:', sessionResponse.assets);
        debugLog('[ConfigureView]    assets length:', sessionResponse.assets?.length);
        
        const sessionData: SessionData = {
          sessionId: sessionResponse.session_id,
          projectId: sessionResponse.project_id,
          assets: sessionResponse.assets,
          files: sourceData.files,
        };
        
        debugLog('[ConfigureView] 📦 构建的 sessionData:', sessionData);
        
        // ★ 不在这里触发分析，统一在 ProcessingView 上传完成后触发
        // 把脚本信息带到 sessionData 供后续使用
        (sessionData as any).script = scriptText.trim() || undefined;
        
        onStart(selectedTask, sessionData);
        return;
      }
      
      // === 单文件模式（兼容旧版）===
      let durationSeconds: number | undefined;
      if (sourceType === 'file' && sourceData.file) {
        try {
          const durationMs = await getVideoDuration(sourceData.file);
          durationSeconds = durationMs / 1000;
          debugLog('[ConfigureView] 提取到视频时长:', durationMs, 'ms =>', durationSeconds, '秒');
        } catch (e) {
          debugWarn('无法提取视频时长:', e);
        }
      }
      
      debugLog('[ConfigureView] 创建 session, duration:', durationSeconds, 'task:', selectedTask);
      const sessionResponse = await createSession({
        source_type: sourceType === 'file' ? 'local' : 
                     sourceData.link?.includes('youtube') ? 'youtube' : 'url',
        task_type: selectedTask as ApiTaskType,
        file_name: sourceData.file?.name,
        file_size: sourceData.file?.size,
        content_type: sourceData.file?.type,
        duration: durationSeconds,
        source_url: sourceData.link,
      });
      
      // ★ 统一用 assets 数组
      const sessionData: SessionData = {
        sessionId: sessionResponse.session_id,
        projectId: sessionResponse.project_id,
        assets: sessionResponse.assets,
        files: sourceType === 'file' && sourceData.file ? [sourceData.file] : undefined,
      };
      
      // ★ 不在这里触发分析，统一在 ProcessingView 上传完成后触发
      // 把脚本信息带到 sessionData 供后续使用
      (sessionData as any).script = scriptText.trim() || undefined;
      
      onStart(selectedTask, sessionData);
      
    } catch (err) {
      debugError('创建会话失败:', err);
      setError(err instanceof Error ? err.message : '创建会话失败');
      setIsLoading(false);
    }
  };

  const sourceInfo = getSourceInfo();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onBack}
      />
      
      {/* 弹窗内容 */}
      <div className="relative w-full max-w-xl bg-white border border-gray-200 rounded-3xl p-8 space-y-6 animate-in zoom-in-95 fade-in duration-300 shadow-2xl mx-4">
        {/* 关闭按钮 */}
        <button
          onClick={onBack}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-900 transition-colors rounded-lg hover:bg-gray-100"
        >
          <X size={18} />
        </button>
        
        {/* 标题 */}
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-gray-100 rounded-xl">
            <Settings2 size={18} className="text-gray-600" />
          </div>
          <h2 className="text-xl font-black text-gray-900">您想如何处理这个视频？</h2>
        </div>

        {/* 来源信息 */}
        {sourceInfo && (
          <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
            <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center text-gray-500 border border-gray-200">
              {sourceInfo.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{sourceInfo.label}</p>
              <p className="text-[10px] text-gray-500 truncate">{sourceInfo.detail}</p>
            </div>
          </div>
        )}

        {/* 任务选择 */}
        <div className="space-y-3">
          {/* ★ AI 智能剪辑选项 */}
          <div 
            onClick={() => setSelectedTask('ai-create')}
            className={`p-4 rounded-xl border cursor-pointer transition-all 
              ${selectedTask === 'ai-create' 
                ? 'bg-gray-50 border-gray-800 ring-1 ring-gray-800/50' 
                : 'bg-gray-50 border-gray-200 hover:border-gray-300'
              }`}
          >
            <div className="flex items-start space-x-3">
              <div className={`p-2.5 rounded-lg ${selectedTask === 'ai-create' ? 'bg-gray-800 text-white shadow-lg shadow-gray-800/20' : 'bg-gray-100 text-gray-500'}`}>
                <Wand2 size={18} />
              </div>
              
              <div className="flex-1">
                <h4 className="font-bold text-gray-900 flex items-center text-sm">
                  AI 智能剪辑
                  <span className="ml-2 text-[8px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded uppercase font-black">推荐</span>
                </h4>
                <p className="text-xs text-gray-500 mt-1">
                  自动完成语音识别、智能切片、运镜动画、字幕生成
                </p>
              </div>
              
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selectedTask === 'ai-create' ? 'border-gray-800 bg-gray-800' : 'border-gray-300'}`}>
                {selectedTask === 'ai-create' && <CheckCircle2 size={12} className="text-white" />}
              </div>
            </div>
            
            {/* 功能预览卡片 */}
            {selectedTask === 'ai-create' && (
              <div className="mt-4 ml-11">
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-2 bg-gray-100 rounded-lg text-center">
                    <Mic size={14} className="mx-auto text-gray-600 mb-1" />
                    <span className="text-[9px] text-gray-600">语音识别</span>
                  </div>
                  <div className="p-2 bg-gray-100 rounded-lg text-center">
                    <Video size={14} className="mx-auto text-gray-600 mb-1" />
                    <span className="text-[9px] text-gray-600">智能切片</span>
                  </div>
                  <div className="p-2 bg-green-50 rounded-lg text-center">
                    <RefreshCw size={14} className="mx-auto text-green-600 mb-1" />
                    <span className="text-[9px] text-gray-600">自动运镜</span>
                  </div>
                  <div className="p-2 bg-gray-100 rounded-lg text-center">
                    <MessageSquare size={14} className="mx-auto text-gray-600 mb-1" />
                    <span className="text-[9px] text-gray-600">字幕生成</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 内容总结选项 (即将上线) */}
          <div className="p-4 rounded-xl border bg-gray-50 border-gray-200 flex items-start space-x-3 opacity-50 cursor-not-allowed">
            <div className="p-2.5 rounded-lg bg-gray-100 text-gray-400">
              <Sparkles size={18} />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-500 flex items-center text-sm">
                内容总结与社媒文案
                <span className="ml-2 text-[8px] border border-gray-300 text-gray-400 px-1.5 py-0.5 rounded uppercase">Soon</span>
              </h4>
              <p className="text-xs text-gray-400 mt-1">
                AI 深度理解视频，生成核心摘要及社交媒体配套文案。
              </p>
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* 开始按钮 */}
        <button 
          onClick={handleStart}
          disabled={isLoading}
          className={`w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center space-x-2 transition-all shadow-xl active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
            ${selectedTask === 'ai-create' 
              ? 'bg-gray-800 hover:bg-gray-700 shadow-gray-900/20' 
              : 'bg-gray-700 hover:bg-gray-600 shadow-gray-900/20'
            }`}
        >
          {isLoading ? (
            <>
              <RabbitLoader size={16} />
              <span>创建会话中...</span>
            </>
          ) : selectedTask === 'ai-create' ? (
            <>
              <Wand2 size={16} />
              <span>开始 AI 智能剪辑</span>
              <ArrowRight size={16} />
            </>
          ) : (
            <>
              <span>确认并开始 AI 分析</span>
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
