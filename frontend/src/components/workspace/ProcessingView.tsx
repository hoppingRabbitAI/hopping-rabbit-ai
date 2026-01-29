'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import {
  CheckCircle2,
  Clock,
  Sparkles,
  AlertCircle,
  X,
  ArrowLeft,
  Upload,
  Mic,
  VolumeX,
  Video,
  Loader2
} from 'lucide-react';
import {
  pollSessionStatus,
  cancelSession,
  uploadFile,
  uploadMultipleFiles,
  confirmUpload,
  type SessionStatusResponse,
  type ProcessingStep
} from '@/features/editor/lib/workspace-api';
// ★ startContentAnalysis 已移除 - 智能分析不再由前端触发，避免 ASR 重复执行
import type { SessionData } from '@/app/workspace/page';

// ==================== 调试开关 ====================
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const DEBUG_TIMING = false; // 性能时间统计开关（按需开启）
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[ProcessingView]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[ProcessingView]', ...args); };
const timingLog = (...args: unknown[]) => { if (DEBUG_TIMING) console.log(...args); };

// ==================== 端到端时间统计 ====================
interface TimingStats {
  startTime: number;
  uploadStartTime?: number;
  uploadEndTime?: number;
  processingStartTime?: number;
  processingEndTime?: number;
  lastStep?: string;
  stepTimes: Record<string, { start: number; end?: number }>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

function logTimingStats(stats: TimingStats, label: string) {
  if (!DEBUG_TIMING) return;  // 性能日志默认关闭

  const now = Date.now();
  const totalTime = now - stats.startTime;
  const uploadTime = stats.uploadEndTime && stats.uploadStartTime
    ? stats.uploadEndTime - stats.uploadStartTime : 0;
  const processingTime = stats.processingEndTime && stats.processingStartTime
    ? stats.processingEndTime - stats.processingStartTime : 0;

  timingLog(`\n📊 [Timing] ========== ${label} ==========`);
  timingLog(`⏱️  总耗时: ${formatDuration(totalTime)}`);
  if (uploadTime > 0) {
    timingLog(`📤 上传耗时: ${formatDuration(uploadTime)}`);
  }
  if (processingTime > 0) {
    timingLog(`⚙️  处理耗时: ${formatDuration(processingTime)}`);
  }

  // 输出各步骤耗时
  const stepEntries = Object.entries(stats.stepTimes);
  if (stepEntries.length > 0) {
    timingLog('📋 各步骤耗时:');
    for (const [step, times] of stepEntries) {
      const stepDuration = (times.end || now) - times.start;
      const status = times.end ? '✅' : '⏳';
      timingLog(`   ${status} ${step}: ${formatDuration(stepDuration)}`);
    }
  }
  timingLog('==========================================\n');
}

interface ProcessingViewProps {
  sourceType: 'file' | 'link' | null;
  taskType: 'clips' | 'summary' | 'ai-create' | 'voice-extract';
  sessionData: SessionData;
  onComplete: (projectId: string) => void;
  onCancel: () => void;
}

export function ProcessingView({
  sourceType,
  taskType,
  sessionData,
  onComplete,
  onCancel
}: ProcessingViewProps) {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProcessingStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // 上传阶段状态
  const [uploadPhase, setUploadPhase] = useState<'pending' | 'uploading' | 'confirming' | 'done'>('pending');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileProgresses, setFileProgresses] = useState<Map<string, number>>(new Map());
  const uploadStartedRef = useRef(false);

  // ★★★ 端到端时间统计 ★★★
  const timingRef = useRef<TimingStats>({
    startTime: Date.now(),
    stepTimes: {},
  });

  // 记录开始时间
  useEffect(() => {
    if (!DEBUG_TIMING) return;
    const fileInfo = sessionData.files?.length
      ? `${sessionData.files.length} 个文件, 总大小 ${(sessionData.files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(1)}MB`
      : '无文件';
    timingLog(`\n🚀 [Timing] ========== 开始处理 ==========`);
    timingLog(`📁 文件: ${fileInfo}`);
    timingLog(`🎯 任务类型: ${taskType}`);
    timingLog(`⏰ 开始时间: ${new Date().toLocaleTimeString()}`);
    timingLog('==========================================\n');
  }, []);

  // 先执行文件上传（如果需要）
  useEffect(() => {
    // 防止重复执行 - 立即设置标记
    if (uploadStartedRef.current) return;
    uploadStartedRef.current = true;

    const doUpload = async () => {
      // ★ 记录上传开始时间
      timingRef.current.uploadStartTime = Date.now();

      debugLog('🚀 doUpload 开始, sessionData:', {
        filesCount: sessionData.files?.length,
        assetsCount: sessionData.assets?.length,
        uploadComplete: sessionData.uploadComplete,  // ★ 新增日志
      });

      // ★★★ 修复：如果文件已在 page.tsx 上传完成，跳过上传阶段 ★★★
      if (sessionData.uploadComplete) {
        debugLog('✅ 文件已上传完成（uploadComplete=true），跳过上传阶段');
        setUploadPhase('done');
        setProgress(40);
        timingRef.current.uploadEndTime = Date.now();
        timingRef.current.processingStartTime = Date.now();
        return;
      }

      // === 文件上传模式（统一用 assets 数组）===
      if (sessionData.files && sessionData.files.length > 0 && sessionData.assets && sessionData.assets.length > 0) {
        debugLog('📤 进入文件上传模式, 文件数:', sessionData.files.length);
        setUploadPhase('uploading');
        setCurrentStep('upload');

        try {
          await uploadMultipleFiles(
            sessionData.files,
            sessionData.assets,
            sessionData.sessionId,
            // 单文件进度回调
            (assetId, percent) => {
              setFileProgresses(prev => {
                const next = new Map(prev);
                next.set(assetId, percent);
                return next;
              });
            },
            // 整体进度回调 - ★ 上传占 40%
            (percent) => {
              setUploadProgress(percent);
              setProgress(Math.floor(percent * 0.4));
            }
          );

          // 确认上传完成，触发后台处理
          debugLog('📤 所有文件上传完成，调用 confirmUpload...');
          setUploadPhase('confirming');
          const confirmResult = await confirmUpload(sessionData.sessionId);
          debugLog('✅ confirmUpload 返回:', confirmResult);

          // ★ 移除：不再在这里触发智能分析
          // 后端 _process_session_multi_assets 已经包含完整的 ASR + AI 成片流程
          // 智能分析应该在后端处理完成后，由用户手动触发或自动集成到后端流程中
          // 之前的设计会导致 ASR 重复执行两次

          setUploadPhase('done');
          setProgress(40);

          // ★ 记录上传完成时间
          timingRef.current.uploadEndTime = Date.now();
          timingRef.current.processingStartTime = Date.now();
          const uploadDuration = timingRef.current.uploadEndTime - (timingRef.current.uploadStartTime || timingRef.current.startTime);
          timingLog(`📤 [Timing] 上传完成，耗时: ${formatDuration(uploadDuration)}`);

          debugLog('🎉 上传阶段完成，进入后台处理阶段');

        } catch (err) {
          debugError('❌ 文件上传失败:', err);
          setError(err instanceof Error ? err.message : '文件上传失败');
          setUploadPhase('pending');
        }
        return;
      }

      // === 链接模式：无需上传 ===
      setUploadPhase('done');
      setProgress(40);
    };

    doUpload();
  }, [sessionData.files, sessionData.assets, sessionData.sessionId]);

  // 上传完成后启动轮询
  useEffect(() => {
    if (uploadPhase !== 'done') return;

    debugLog('🔄 开始轮询后台处理状态, sessionId:', sessionData.sessionId);

    // ★ 上传占 40%，后端处理占 60%（让进度更平滑）
    const UPLOAD_WEIGHT = 40;
    const PROCESSING_WEIGHT = 60;

    const stopPolling = pollSessionStatus(
      sessionData.sessionId,
      {
        onProgress: (status: SessionStatusResponse) => {
          // 后端进度 0-100% 映射到 40%-100%
          const processingProgress = UPLOAD_WEIGHT + Math.floor(status.progress * PROCESSING_WEIGHT / 100);
          debugLog(`📊 轮询进度: ${status.progress}% -> UI ${processingProgress}%, step: ${status.current_step}, status: ${status.status}`);
          setProgress(processingProgress);
          setCurrentStep(status.current_step || null);

          // ★ 记录步骤切换时间
          const step = status.current_step;
          if (step && step !== timingRef.current.lastStep) {
            // 结束上一个步骤
            if (timingRef.current.lastStep && timingRef.current.stepTimes[timingRef.current.lastStep]) {
              timingRef.current.stepTimes[timingRef.current.lastStep].end = Date.now();
            }
            // 开始新步骤
            if (!timingRef.current.stepTimes[step]) {
              timingRef.current.stepTimes[step] = { start: Date.now() };
              timingLog(`⏳ [Timing] 进入步骤: ${step}`);
            }
            timingRef.current.lastStep = step;
          }
        },
        onComplete: (status: SessionStatusResponse) => {
          // ★ 记录处理完成时间
          timingRef.current.processingEndTime = Date.now();
          if (timingRef.current.lastStep && timingRef.current.stepTimes[timingRef.current.lastStep]) {
            timingRef.current.stepTimes[timingRef.current.lastStep].end = Date.now();
          }

          // ★ 输出完整时间统计
          logTimingStats(timingRef.current, '处理完成 - 进入编辑器');

          // ★ HLS 模式：无需预加载，直接跳转
          // HLS 流式播放只缓冲几个分片，不需要等待完整下载
          debugLog('✅ 处理完成，直接跳转编辑器（HLS 模式）');
          setProgress(100);
          onComplete(status.project_id);
        },
        onError: (err: Error) => {
          // ★ 错误时也输出时间统计
          logTimingStats(timingRef.current, '处理失败');
          setError(err.message);
        },
        onCancel: () => {
          // ★ 用户取消时直接返回，不显示错误
          debugLog('🛑 后端确认会话已取消，返回主页');
          onCancel();
        },
      },
      1500 // 每 1.5 秒轮询一次
    );

    return () => {
      stopPolling();
    };
  }, [uploadPhase, sessionData.sessionId, onComplete]);

  // 初始化步骤列表（根据 taskType 一次性生成）
  useEffect(() => {
    if (steps.length > 0) return; // 已初始化

    const hasFiles = sessionData.files && sessionData.files.length > 0;
    const fileCount = sessionData.files?.length || 0;

    const allSteps: ProcessingStep[] = [];

    // 1. 上传步骤
    if (hasFiles) {
      allSteps.push({
        id: 'upload',
        label: fileCount > 1 ? `上传 ${fileCount} 个视频` : '上传视频',
        detail: '正在传输视频文件...'
      });
    }

    // 2. 后端处理步骤（根据 taskType 决定）
    if (taskType === 'ai-create') {
      // 一键成片流程
      allSteps.push(
        { id: 'fetch', label: '解析视频', detail: '读取编码格式与音轨信息...' },
        { id: 'transcribe', label: '语音识别', detail: 'Whisper AI 转写生成文案...' },
        { id: 'segment', label: '智能分段', detail: '语义分析与场景切分...' },
        { id: 'vision', label: '视觉分析', detail: '人脸检测与画面构图...' },
        { id: 'transform', label: '运镜生成', detail: 'AI 生成镜头动画...' },
        { id: 'subtitle', label: '字幕铺设', detail: '生成同步字幕...' },
        { id: 'prepare', label: '准备编辑器', detail: '生成预览流...' },
      );
    } else if (taskType === 'summary') {
      // 内容总结流程
      allSteps.push(
        { id: 'fetch', label: '解析视频', detail: '读取编码格式与音轨...' },
        { id: 'transcribe', label: '语音转写', detail: '生成完整文案...' },
        { id: 'summarize', label: 'AI 内容分析', detail: '提取核心观点与摘要...' },
        { id: 'prepare', label: '准备编辑器', detail: '生成预览流...' },
      );
    } else if (taskType === 'voice-extract') {
      // 仅提取字幕/音频流程
      allSteps.push(
        { id: 'fetch', label: '解析视频', detail: '读取编码格式与音轨...' },
        { id: 'transcribe', label: '语音转写', detail: '提取音频并生成字幕...' },
        { id: 'prepare', label: '准备工作台', detail: '生成音频与字幕轨道...' },
      );
    } else {
      // clips: 基础剪辑流程
      allSteps.push(
        { id: 'fetch', label: '解析视频', detail: '读取编码格式与音轨信息...' },
        { id: 'transcribe', label: '语音识别', detail: 'Whisper AI 转写生成文案...' },
        { id: 'prepare', label: '准备编辑器', detail: '生成预览流...' },
      );
    }

    setSteps(allSteps);
    setCurrentStep(hasFiles ? 'upload' : allSteps[0]?.id || 'fetch');
  }, [taskType, sessionData.files, steps.length]);

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await cancelSession(sessionData.sessionId);
    } catch (err) {
      // ★ 取消 API 失败也不阻止用户返回（治本）
      // 后端可能已经完成处理或会话不存在
      debugLog('取消 API 调用失败，但仍然返回主页:', err);
    } finally {
      setIsCancelling(false);
      // ★ 无论取消 API 是否成功，都返回主页面
      onCancel();
    }
  };

  // 返回项目列表
  const handleBackToProjects = () => {
    router.push('/workspace');
  };

  // 根据当前步骤计算每个步骤的状态
  const getStepStatus = (stepId: string): 'waiting' | 'processing' | 'completed' => {
    // 特殊处理 upload 步骤
    if (stepId === 'upload') {
      if (uploadPhase === 'done') return 'completed';
      if (uploadPhase === 'uploading' || uploadPhase === 'confirming') return 'processing';
      return 'waiting';
    }

    // 如果上传还没完成，其他步骤都是等待状态
    if (uploadPhase !== 'done') return 'waiting';

    const stepIndex = steps.findIndex(s => s.id === stepId);
    const currentIndex = steps.findIndex(s => s.id === currentStep);

    // ★ 处理 extract_audio/upload_audio 等子步骤 -> 归类到 transcribe
    // 后端实际 step: fetch -> extract_audio -> upload_audio -> transcribe -> segment -> vision -> transform -> subtitle -> prepare
    // 前端展示 step: fetch -> transcribe -> segment -> vision -> transform -> subtitle -> prepare
    const stepGroupMapping: Record<string, string> = {
      'extract_audio': 'transcribe',
      'upload_audio': 'transcribe',
    };

    const normalizedCurrentStep = stepGroupMapping[currentStep || ''] || currentStep;
    const normalizedCurrentIndex = steps.findIndex(s => s.id === normalizedCurrentStep);

    if (normalizedCurrentIndex >= 0) {
      if (stepIndex < normalizedCurrentIndex) return 'completed';
      if (stepIndex === normalizedCurrentIndex) return 'processing';
      return 'waiting';
    }

    // 回退到默认逻辑
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'processing';
    return 'waiting';
  };

  return (
    <div className="w-full max-w-lg space-y-12 animate-in fade-in duration-1000">
      {/* 顶部标题 */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
          AI 正在跳跃式处理...
        </h2>
        <p className="text-gray-500 text-xs font-medium">
          HoppingRabbit 正在优化您的视频流程，请稍候片刻
        </p>
      </div>

      {/* 自定义动画样式 */}
      <style jsx>{`
        @keyframes vivid-hop {
          0%, 100% { transform: translateY(0) scaleX(1) scaleY(1); }
          15% { transform: translateY(0) scaleX(1.15) scaleY(0.85); }
          45% { transform: translateY(-30px) scaleX(0.9) scaleY(1.15); }
          85% { transform: translateY(0) scaleX(1.05) scaleY(0.95); }
        }
        @keyframes hop-shadow {
          0%, 100%, 15%, 85% { transform: scale(1); opacity: 0.3; }
          45% { transform: scale(0.5); opacity: 0.1; }
        }
      `}</style>

      {/* 进度条 + 跳跃兔子 */}
      <div className="space-y-8">
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <span className="text-sm font-mono font-bold text-gray-900">{progress}%</span>
          </div>

          {/* 进度条容器 - 包含兔子 */}
          <div className="relative">
            {/* 跳跃的兔子 - 跟随进度条移动 */}
            <div
              className="absolute -top-12 transition-all duration-300 ease-out"
              style={{
                left: `${progress}%`,
                transform: 'translateX(-50%)'
              }}
            >
              <div className="flex flex-col items-center">
                {/* 兔子本体 - 使用 GIF 动画 */}
                <div className="origin-bottom">
                  <img
                    src="/rabbit-loading.gif"
                    width={48}
                    height={48}
                    className="drop-shadow-sm"
                    alt="Loading Rabbit"
                  />
                </div>
              </div>
            </div>

            {/* 进度条轨道 */}
            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-gray-700 to-gray-900 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* 处理步骤列表 */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex items-center space-x-2 pb-2 border-b border-gray-100">
            <Sparkles size={14} className="text-gray-600" />
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
              AI 实时处理日志
            </span>
          </div>

          <div className="space-y-4">
            {steps.map((step) => {
              const status = getStepStatus(step.id);

              // 根据 step.icon 渲染对应图标
              const renderStepIcon = () => {
                if (status === 'completed') return <CheckCircle2 size={12} />;
                if (status === 'processing') return <Loader2 size={12} className="animate-spin" />;
                // waiting 状态根据 icon 类型显示
                switch (step.icon) {
                  case 'mic': return <Mic size={10} />;
                  case 'volume-x': return <VolumeX size={10} />;
                  default: return <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" />;
                }
              };

              // 根据 step.icon 确定颜色 - 使用黑白灰调性
              const getStepColor = () => {
                if (status === 'completed') return 'bg-gray-100 text-gray-600';
                if (status === 'processing') {
                  return 'bg-gray-900 text-white';
                }
                return 'bg-gray-100 text-gray-400';
              };

              return (
                <div
                  key={step.id}
                  className={`flex items-start space-x-4 transition-all duration-500 ${status === 'completed'
                    ? 'opacity-40'
                    : status === 'processing'
                      ? 'opacity-100 scale-[1.02]'
                      : 'opacity-20'
                    }`}
                >
                  <div className={`mt-1 w-5 h-5 rounded-full flex items-center justify-center flex-none transition-colors ${getStepColor()}`}>
                    {renderStepIcon()}
                  </div>

                  <div className="flex-1">
                    <h5 className={`text-[11px] font-bold ${status === 'processing' ? 'text-gray-900' : 'text-gray-700'
                      }`}>
                      {step.label}
                      {/* 上传进度显示 - 只在上传时显示百分比 */}
                      {step.id === 'upload' && status === 'processing' && uploadProgress > 0 && (
                        <span className="ml-2 font-mono text-gray-600">{uploadProgress}%</span>
                      )}
                    </h5>
                    <p className="text-[9px] text-gray-500 mt-0.5">
                      {step.id === 'upload' && uploadPhase === 'confirming'
                        ? '正在确认上传...'
                        : step.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 底部提示和按钮 */}
      <div className="flex flex-col items-center space-y-4">
        {!error && (
          <div className="flex items-center justify-center space-x-3 text-[10px] text-gray-600 animate-pulse">
            <Clock size={12} />
            <span>预计完成后将自动开启工作台页面</span>
          </div>
        )}

        {/* 按钮组 */}
        <div className="flex items-center space-x-6">
          {/* 返回项目列表按钮 */}
          <button
            type="button"
            onClick={() => {
              debugLog('点击返回项目列表按钮');
              router.push('/workspace');
            }}
            className="text-[10px] text-gray-500 hover:text-gray-900 transition-colors flex items-center space-x-1 py-2 px-3 cursor-pointer"
          >
            <ArrowLeft size={10} />
            <span>返回项目列表</span>
          </button>

          {/* 取消处理按钮 */}
          <button
            type="button"
            onClick={handleCancel}
            disabled={isCancelling}
            className="text-[10px] text-gray-500 hover:text-red-600 transition-colors flex items-center space-x-1 py-2 px-3 cursor-pointer disabled:cursor-not-allowed"
          >
            {isCancelling ? (
              <RabbitLoader size={10} />
            ) : (
              <X size={10} />
            )}
            <span>取消处理</span>
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
          <div className="flex items-start space-x-2">
            <AlertCircle size={14} className="text-red-600 flex-none mt-0.5" />
            <div>
              <p className="text-xs font-bold text-red-600">处理出错</p>
              <p className="text-[10px] text-red-500 mt-1">{error}</p>
              <p className="text-[10px] text-red-400 mt-1">如视频无法播放，请重试或检查资源。</p>
            </div>
          </div>
          <div className="flex items-center space-x-4 pt-2 border-t border-red-200">
            <button
              type="button"
              onClick={onCancel}
              className="text-[10px] text-red-600 hover:text-red-700 flex items-center space-x-1 py-2 px-3 cursor-pointer"
            >
              <ArrowLeft size={10} />
              <span>返回重选文件</span>
            </button>
            <button
              type="button"
              onClick={() => {
                debugLog('点击返回项目列表按钮（错误状态）');
                router.push('/workspace');
              }}
              className="text-[10px] text-gray-500 hover:text-gray-900 flex items-center space-x-1 py-2 px-3 cursor-pointer"
            >
              <span>返回项目列表</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
