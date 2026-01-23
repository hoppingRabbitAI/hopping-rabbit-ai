/**
 * AI 工具处理向导
 * 
 * 功能：
 * 1. 阻塞式弹窗显示处理进度
 * 2. 展示当前正在执行的操作（ASR、智能切片等）
 * 3. 完成后展示废片段让用户筛选删除/保留
 */
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Sparkles, Mic, Settings2, Loader2, 
  CheckCircle2, AlertCircle, Trash2, CheckSquare, Square,
  Play, ChevronDown, ChevronUp, Volume2
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { msToSec } from '../lib/time-utils';
import { taskApi } from '@/lib/api/tasks';
import { getAnalysisResult, getAnalysisProgress, type AnalysisResult, type AnalyzedSegment } from '../lib/smart-v2-api';

// 调试日志
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[AIToolsWizard]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[AIToolsWizard]', ...args); };

// ============================================
// 类型定义
// ============================================

export interface AIToolsOptions {
  enableAsr: boolean;
  enableSmartCamera: boolean;
  scriptText: string;
}

export interface AIToolsWizardProps {
  isOpen: boolean;
  clipIds: string[];  // 支持多选
  options: AIToolsOptions;
  onClose: () => void;
  onComplete: () => void;
}

type WizardStep = 'processing' | 'review' | 'complete';

interface ProcessingStage {
  id: string;
  label: string;
  icon: typeof Mic;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
}

interface WasteSegment {
  id: string;
  start: number;
  end: number;
  duration: number;
  text?: string;
  classification: string;
  reason?: string;
  selected: boolean; // true = 保留, false = 删除
}

// 时间格式化
const formatTime = (ms: number): string => {
  const sec = msToSec(ms);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms100 = Math.floor((sec % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${ms100.toString().padStart(2, '0')}`;
};

// ============================================
// 主组件
// ============================================

export function AIToolsWizard({
  isOpen,
  clipIds,
  options,
  onClose,
  onComplete,
}: AIToolsWizardProps) {
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const projectId = useEditorStore((s) => s.projectId);
  const loadClips = useEditorStore((s) => s.loadClips);
  
  // 获取所有选中的 clips 和 assets
  const selectedClips = clipIds.map(id => clips.find(c => c.id === id)).filter(Boolean);
  const selectedAssets = selectedClips.map(c => c?.assetId ? assets.find(a => a.id === c.assetId) : null);
  
  // 步骤状态
  const [currentStep, setCurrentStep] = useState<WizardStep>('processing');
  const [error, setError] = useState<string | null>(null);
  
  // 处理阶段
  const [stages, setStages] = useState<ProcessingStage[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [currentMessage, setCurrentMessage] = useState('');
  
  // 废片段
  const [wasteSegments, setWasteSegments] = useState<WasteSegment[]>([]);
  const [expandedSegmentId, setExpandedSegmentId] = useState<string | null>(null);
  
  // 分析结果
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  // 初始化处理阶段
  useEffect(() => {
    if (isOpen) {
      const newStages: ProcessingStage[] = [];
      
      if (options.enableAsr) {
        newStages.push({
          id: 'asr',
          label: 'ASR 语音转写',
          icon: Mic,
          status: 'pending',
          progress: 0,
        });
      }
      
      if (options.enableSmartCamera) {
        newStages.push({
          id: 'smart',
          label: '智能运镜',
          icon: Settings2,
          status: 'pending',
          progress: 0,
        });
      }
      
      setStages(newStages);
      setCurrentStep('processing');
      setError(null);
      setWasteSegments([]);
      setOverallProgress(0);
      setCurrentMessage('准备开始处理...');
      
      // 开始处理
      startProcessing();
    }
  }, [isOpen]);

  // 开始处理
  const startProcessing = useCallback(async () => {
    if (selectedClips.length === 0 || !projectId) {
      setError('缺少必要信息');
      return;
    }
    
    try {
      debugLog('开始 AI 工具处理:', { clipIds, clipsCount: selectedClips.length, options });
      
      let currentStageIndex = 0;
      
      // ========== ASR 阶段（批量处理所有 clips）==========
      if (options.enableAsr) {
        setStages(prev => prev.map((s, i) => 
          i === currentStageIndex ? { ...s, status: 'processing' as const } : s
        ));
        setCurrentMessage(`正在启动语音识别（共 ${clipIds.length} 个片段）...`);
        
        // 批量处理每个 clip 的 ASR
        for (let clipIndex = 0; clipIndex < clipIds.length; clipIndex++) {
          const currentClipId = clipIds[clipIndex];
          setCurrentMessage(`ASR 语音转写中 (${clipIndex + 1}/${clipIds.length})...`);
          
          // 调用 ASR API
          const startResult = await taskApi.startASRClipTask({
            clip_id: currentClipId,
            language: 'zh',
          });
          
          if (startResult.error || !startResult.data) {
            debugLog(`Clip ${currentClipId} ASR 启动失败:`, startResult.error);
            continue; // 单个失败不阻塞其他
          }
          
          const asrTaskId = startResult.data.task_id;
          if (clipIndex === 0) setTaskId(asrTaskId);
          debugLog(`ASR 任务已启动 (${clipIndex + 1}/${clipIds.length}):`, asrTaskId);
          
          // 轮询 ASR 任务状态
          const asrResult = await taskApi.pollTaskUntilComplete<{ 
            clips_count?: number;
            duration?: number;
          }>(
            asrTaskId,
            {
              interval: 2000,
              timeout: 600000,
              onProgress: (progress) => {
                // 计算整体进度
                const clipProgress = ((clipIndex + progress / 100) / clipIds.length) * 100;
                setStages(prev => prev.map((s, i) => 
                  i === currentStageIndex ? { ...s, progress: clipProgress } : s
                ));
                setOverallProgress(Math.round(clipProgress / stages.length));
              }
            }
          );
          
          if (asrResult.error) {
            debugLog(`Clip ${currentClipId} ASR 失败:`, asrResult.error);
          } else {
            debugLog(`Clip ${currentClipId} ASR 完成:`, asrResult.data?.result);
          }
        }
        
        // ASR 完成后刷新前端 clips 数据
        await loadClips();
        
        // 标记 ASR 阶段完成
        setStages(prev => prev.map((s, i) => 
          i === currentStageIndex ? { ...s, status: 'completed' as const, progress: 100 } : s
        ));
        currentStageIndex++;
      }
      
      // ========== 智能运镜阶段（批量处理）==========
      if (options.enableSmartCamera) {
        if (currentStageIndex < stages.length) {
          setStages(prev => prev.map((s, i) => 
            i === currentStageIndex ? { ...s, status: 'processing' as const } : s
          ));
        }
        setCurrentMessage(`正在分析画面，生成智能运镜（共 ${clipIds.length} 个片段）...`);
        
        try {
          // 调用同步智能运镜 API - 一次性传入所有 clip_ids
          const { keyframesApi } = await import('@/lib/api/keyframes');
          const cameraResult = await keyframesApi.smartGenerate({
            clip_ids: clipIds,  // 传入所有选中的 clips
            emotion: 'neutral',
            importance: 'medium',
          });
          
          if (cameraResult.error) {
            throw new Error(cameraResult.error.message || '智能运镜失败');
          }
          
          const response = cameraResult.data;
          debugLog('智能运镜完成:', response);
          
          if (response) {
            debugLog(`成功: ${response.success_count}, 失败: ${response.failed_count}`);
            for (const result of response.results) {
              if (result.success) {
                debugLog(`Clip ${result.clip_id}: 应用规则 ${result.rule_applied}, 创建 ${result.keyframes_count} 个关键帧`);
              } else {
                debugLog(`Clip ${result.clip_id}: 失败 - ${result.error}`);
              }
            }
            // 刷新 clips 数据以获取新的关键帧
            await loadClips();
          }
          
          // 更新进度
          setStages(prev => prev.map((s, i) => 
            i === currentStageIndex ? { ...s, progress: 100 } : s
          ));
          const baseProgress = options.enableAsr ? 50 : 0;
          setOverallProgress(baseProgress + 50);
          
        } catch (cameraErr) {
          // 智能运镜失败不阻塞整个流程
          debugLog('智能运镜出错，继续:', cameraErr);
        }
        
        // 标记智能运镜阶段完成
        setStages(prev => prev.map((s, i) => 
          i === currentStageIndex ? { ...s, status: 'completed' as const, progress: 100 } : s
        ));
      }
      
      setOverallProgress(100);
      setCurrentMessage('处理完成！');
      
      // 使用延时检查废片段状态（等待 state 更新）
      setTimeout(() => {
        // 直接完成，用户可以在编辑器中继续操作
        setCurrentStep('complete');
      }, 500);
      
    } catch (err) {
      debugError('处理失败:', err);
      setError(err instanceof Error ? err.message : '处理失败');
      setStages(prev => prev.map(s => 
        s.status === 'processing' ? { ...s, status: 'failed' as const } : s
      ));
    }
  }, [selectedClips, projectId, clipIds, options, stages, loadClips]);

  // 切换废片段选择
  const toggleSegmentSelection = useCallback((segmentId: string) => {
    setWasteSegments(prev => prev.map(s => 
      s.id === segmentId ? { ...s, selected: !s.selected } : s
    ));
  }, []);

  // 全选/取消全选
  const toggleSelectAll = useCallback(() => {
    const allSelected = wasteSegments.every(s => s.selected);
    setWasteSegments(prev => prev.map(s => ({ ...s, selected: !allSelected })));
  }, [wasteSegments]);

  // 确认删除
  const confirmDeletion = useCallback(async () => {
    const toDelete = wasteSegments.filter(s => !s.selected);
    debugLog('确认删除片段:', toDelete.map(s => s.id));
    
    // TODO: 调用实际的删除 API
    
    setCurrentStep('complete');
  }, [wasteSegments]);

  // 统计信息
  const stats = useMemo(() => {
    const toDelete = wasteSegments.filter(s => !s.selected);
    const toKeep = wasteSegments.filter(s => s.selected);
    const totalDuration = wasteSegments.reduce((sum, s) => sum + s.duration, 0);
    const deleteDuration = toDelete.reduce((sum, s) => sum + s.duration, 0);
    
    return {
      total: wasteSegments.length,
      toDelete: toDelete.length,
      toKeep: toKeep.length,
      totalDuration,
      deleteDuration,
      saveDuration: deleteDuration,
    };
  }, [wasteSegments]);

  if (!isOpen) return null;

  // 使用 Portal 渲染到 body，避免父元素的 transform/overflow 影响 z-index
  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
              <Sparkles size={20} className="text-gray-700" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">AI 工具处理</h2>
              <p className="text-xs text-gray-500">
                {currentStep === 'processing' && '正在处理中...'}
                {currentStep === 'review' && '请审核以下片段'}
                {currentStep === 'complete' && '处理完成'}
              </p>
            </div>
          </div>
          {currentStep !== 'processing' && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto">
          {/* 处理中步骤 */}
          {currentStep === 'processing' && (
            <div className="p-8">
              {/* 主加载动画 */}
              <div className="flex flex-col items-center mb-8">
                <div className="relative mb-4">
                  <RabbitLoader size={64} />
                </div>
                <p className="text-lg font-medium text-gray-900">{currentMessage}</p>
              </div>

              {/* 处理阶段列表 */}
              <div className="space-y-4 mb-8">
                {stages.map((stage, index) => {
                  const Icon = stage.icon;
                  return (
                    <div 
                      key={stage.id}
                      className={`flex items-center gap-4 p-4 rounded-xl transition-all ${
                        stage.status === 'processing' 
                          ? 'bg-gray-50 ring-2 ring-gray-200' 
                          : stage.status === 'completed'
                            ? 'bg-emerald-50'
                            : stage.status === 'failed'
                              ? 'bg-red-50'
                              : 'bg-gray-50/50'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        stage.status === 'completed' 
                          ? 'bg-emerald-500 text-white' 
                          : stage.status === 'failed'
                            ? 'bg-red-500 text-white'
                            : stage.status === 'processing'
                              ? 'bg-gray-700 text-white'
                              : 'bg-gray-200 text-gray-500'
                      }`}>
                        {stage.status === 'completed' ? (
                          <CheckCircle2 size={20} />
                        ) : stage.status === 'failed' ? (
                          <AlertCircle size={20} />
                        ) : stage.status === 'processing' ? (
                          <Loader2 size={20} className="animate-spin" />
                        ) : (
                          <Icon size={20} />
                        )}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`font-medium ${
                            stage.status === 'processing' ? 'text-gray-900' : 'text-gray-600'
                          }`}>
                            {stage.label}
                          </span>
                          {stage.status === 'processing' && (
                            <span className="text-sm text-gray-500">{stage.progress}%</span>
                          )}
                        </div>
                        
                        {stage.status === 'processing' && (
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gray-700 transition-all duration-300"
                              style={{ width: `${stage.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 总体进度 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">总体进度</span>
                  <span className="font-medium text-gray-900">{overallProgress}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-gray-700 to-gray-500 transition-all duration-300"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              </div>

              {/* 错误信息 */}
              {error && (
                <div className="mt-6 p-4 bg-red-50 rounded-xl border border-red-200">
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle size={18} />
                    <span className="font-medium">处理出错</span>
                  </div>
                  <p className="mt-2 text-sm text-red-600">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* 审核步骤 */}
          {currentStep === 'review' && (
            <div className="p-6">
              {/* 统计信息 */}
              <div className="flex items-center justify-between mb-6 p-4 bg-gray-50 rounded-xl">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
                  <div className="text-xs text-gray-500">检测到的片段</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{stats.toDelete}</div>
                  <div className="text-xs text-gray-500">待删除</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-600">{stats.toKeep}</div>
                  <div className="text-xs text-gray-500">保留</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-700">{formatTime(stats.saveDuration)}</div>
                  <div className="text-xs text-gray-500">可节省时长</div>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {wasteSegments.every(s => s.selected) ? (
                    <CheckSquare size={16} />
                  ) : (
                    <Square size={16} />
                  )}
                  <span>{wasteSegments.every(s => s.selected) ? '取消全选' : '全部保留'}</span>
                </button>
                <span className="text-xs text-gray-400">
                  未勾选的片段将被删除
                </span>
              </div>

              {/* 片段列表 */}
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {wasteSegments.map((segment) => (
                  <div 
                    key={segment.id}
                    className={`border rounded-xl transition-all ${
                      segment.selected 
                        ? 'border-emerald-300 bg-emerald-50/50' 
                        : 'border-red-200 bg-red-50/30'
                    }`}
                  >
                    <div 
                      className="flex items-center gap-3 p-3 cursor-pointer"
                      onClick={() => toggleSegmentSelection(segment.id)}
                    >
                      <button className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${
                        segment.selected 
                          ? 'bg-emerald-500 text-white' 
                          : 'bg-gray-200 text-gray-400'
                      }`}>
                        {segment.selected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono text-gray-500">
                            {formatTime(segment.start)} - {formatTime(segment.end)}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            segment.classification === 'filler' 
                              ? 'bg-amber-100 text-amber-700'
                              : segment.classification === 'breath'
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-red-100 text-red-700'
                          }`}>
                            {segment.classification === 'filler' && '口头禅'}
                            {segment.classification === 'breath' && '换气'}
                            {segment.classification === 'noise' && '无关内容'}
                          </span>
                        </div>
                        {segment.text && (
                          <p className="text-sm text-gray-700 truncate">{segment.text}</p>
                        )}
                        {segment.reason && (
                          <p className="text-xs text-gray-400 mt-0.5">{segment.reason}</p>
                        )}
                      </div>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedSegmentId(
                            expandedSegmentId === segment.id ? null : segment.id
                          );
                        }}
                        className="p-1 rounded hover:bg-gray-200 text-gray-400"
                      >
                        {expandedSegmentId === segment.id ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )}
                      </button>
                    </div>
                    
                    {/* 展开的详情 */}
                    {expandedSegmentId === segment.id && (
                      <div className="px-3 pb-3 pt-0 border-t border-gray-100 mt-2">
                        <div className="flex items-center gap-2 mt-2">
                          <button className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-600 transition-colors">
                            <Play size={12} />
                            <span>预览</span>
                          </button>
                          <button className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-600 transition-colors">
                            <Volume2 size={12} />
                            <span>播放音频</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 完成步骤 */}
          {currentStep === 'complete' && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 size={40} className="text-emerald-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">处理完成！</h3>
              <p className="text-gray-500">AI 工具已成功应用到视频片段</p>
              
              {stats.toDelete > 0 && (
                <div className="mt-6 p-4 bg-gray-50 rounded-xl">
                  <div className="text-sm text-gray-600">
                    已删除 <span className="font-bold text-gray-900">{stats.toDelete}</span> 个废片段，
                    节省 <span className="font-bold text-gray-900">{formatTime(stats.saveDuration)}</span> 时长
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-gray-100">
          {currentStep === 'processing' && error && (
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              >
                关闭
              </button>
              <button
                onClick={() => {
                  setError(null);
                  startProcessing();
                }}
                className="flex-1 py-3 rounded-xl text-sm font-medium bg-gray-700 text-white hover:bg-gray-600 transition-colors"
              >
                重试
              </button>
            </div>
          )}
          
          {currentStep === 'review' && (
            <div className="flex gap-3">
              <button
                onClick={() => {
                  // 跳过审核，全部保留
                  setWasteSegments(prev => prev.map(s => ({ ...s, selected: true })));
                  setCurrentStep('complete');
                }}
                className="flex-1 py-3 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              >
                跳过审核
              </button>
              <button
                onClick={confirmDeletion}
                className="flex-1 py-3 rounded-xl text-sm font-medium bg-gray-700 text-white hover:bg-gray-600 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={16} />
                <span>确认删除 {stats.toDelete} 个片段</span>
              </button>
            </div>
          )}
          
          {currentStep === 'complete' && (
            <button
              onClick={() => {
                onComplete();
                onClose();
              }}
              className="w-full py-3 rounded-xl text-sm font-medium bg-gray-700 text-white hover:bg-gray-600 transition-colors"
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // 在客户端渲染时使用 Portal
  if (typeof window === 'undefined') return null;
  return createPortal(modalContent, document.body);
}

export default AIToolsWizard;
