'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sidebar, type SidebarTab } from '../../components/workspace/Sidebar';
import { AssetsView } from '../../components/workspace/AssetsView';
import { RabbitHoleView } from '../../components/workspace/RabbitHoleView';
import { ExportsView } from '../../components/workspace/ExportsView';
import { MyMaterialsView } from '../../components/workspace/MyMaterialsView';
import { ProcessingView } from '../../components/workspace/ProcessingView';
import { SmartProcessingView } from '../../components/workspace/SmartProcessingView';
import { ReviewView } from '../../components/workspace/ReviewView';
import { DefillerModal, type FillerWord } from '../../components/workspace/DefillerModal';
import { WorkflowModal, type WorkflowStep, type EntryMode, type WorkflowPauseData } from '../../components/workspace/WorkflowModal';
import { AnalysisResult, startContentAnalysis } from '@/features/editor/lib/smart-v2-api';
import {
  createSession,
  type TaskType as ApiTaskType,
  type FileInfo
} from '@/features/editor/lib/workspace-api';
import { getVideoDuration } from '@/features/editor/lib/media-cache';
import { useCredits } from '@/lib/hooks/useCredits';
import {
  Upload,
  X,
  FileVideo,
  Trash2,
  Wand2,
  Mic,
  MessageSquare,
  Sparkles,
  ArrowLeft
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// ==================== 调试开关 ====================
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log(...args); };
const debugWarn = (...args: unknown[]) => { if (DEBUG_ENABLED) console.warn(...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

export type SourceType = 'file' | 'link' | null;
export type TaskType = 'clips' | 'summary' | 'ai-create' | 'voice-extract';
export type ViewType = 'main' | 'processing' | 'smart-processing' | 'review';

export interface SourceData {
  file?: File;
  files?: File[];  // 新增：多文件模式
  link?: string;
}

export interface SessionData {
  sessionId: string;
  projectId: string;
  // ★ 统一用 assets 数组（即使单文件也是一个元素的数组）
  assets?: Array<{
    asset_id: string;
    order_index: number;
    upload_url: string;
    storage_path: string;
    file_name?: string;
  }>;
  // 异步上传：文件在 ProcessingView 中上传
  files?: File[];
  // ★ 标记：文件是否已在 page.tsx 中完成上传（避免 ProcessingView 重复上传）
  uploadComplete?: boolean;
  // === 智能分析 V2 ===
  analysisId?: string;  // 智能分析 ID
}

export default function WorkspacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 侧边栏 tab
  const [activeTab, setActiveTab] = useState<SidebarTab>('home');

  // 根据 URL 参数初始化 tab
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['home', 'videos', 'my-materials', 'trash', 'rabbit-hole', 'exports'].includes(tabParam)) {
      setActiveTab(tabParam as SidebarTab);
    }
  }, [searchParams]);

  // 处理流程状态
  const [view, setView] = useState<ViewType>('main');
  const [sourceType, setSourceType] = useState<SourceType>(null);
  const [taskType, setTaskType] = useState<TaskType>('ai-create');  // 默认选择一键成片
  const [sourceData, setSourceData] = useState<SourceData>({});
  const [sessionData, setSessionData] = useState<SessionData | null>(null);

  // 智能分析 V2 状态
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // 是否显示新建项目弹窗（合并了上传和配置）
  const [showCreateModal, setShowCreateModal] = useState(false);

  // ★ 工作流恢复数据（用于从项目列表点击恢复到具体步骤）
  const [workflowResumeData, setWorkflowResumeData] = useState<{
    sessionId: string;
    projectId: string;
    step: WorkflowStep;
    mode: EntryMode;
    enableSmartClip?: boolean;
    enableBroll?: boolean;
  } | undefined>(undefined);

  const handleCreateProject = () => {
    setWorkflowResumeData(undefined); // 新建项目时清除恢复数据
    setShowCreateModal(true);
  };

  // ★ 恢复到指定工作流步骤（从项目列表点击时调用）
  const handleResumeWorkflow = (data: {
    sessionId: string;
    projectId: string;
    step: string;
    mode: string;
    enableSmartClip?: boolean;
    enableBroll?: boolean;
  }) => {
    setWorkflowResumeData(data as { sessionId: string; projectId: string; step: WorkflowStep; mode: EntryMode; enableSmartClip?: boolean; enableBroll?: boolean });
    setShowCreateModal(true);
  };

  const handleStartProcessing = (task: TaskType, session: SessionData, type?: SourceType, data?: SourceData) => {
    setTaskType(task);
    setSessionData(session);
    if (type) setSourceType(type);
    if (data) setSourceData(data);

    setShowCreateModal(false);

    // V1 和 V2 都需要先经过 ProcessingView 完成上传和转写
    // V2 的智能分析会在后台等待转写完成后自动执行
    setView('processing');
  };

  const handleSmartAnalysisComplete = (result: AnalysisResult) => {
    setAnalysisResult(result);
    setView('review');
  };

  const handleSmartAnalysisError = (error: string) => {
    console.error('智能分析失败:', error);
    // 可以显示错误提示或返回主页面
    handleBack();
  };

  const handleReviewConfirm = () => {
    // 审核完成，进入编辑器
    if (sessionData?.projectId) {
      router.push(`/editor?project=${sessionData.projectId}`);
    }
  };

  const handleProcessingComplete = (projectId: string) => {
    // 检查是否是 V2 智能分析流程
    if (sessionData?.analysisId) {
      // V2 流程：直接进入编辑器，带上 analysis 参数，弹窗在编辑器内显示
      router.push(`/editor?project=${projectId}&analysis=${sessionData.analysisId}`);
    } else {
      // V1 流程：直接进入编辑器
      router.push(`/editor?project=${projectId}`);
    }
  };

  const handleBack = () => {
    setView('main');
    setShowCreateModal(false);
    setSourceType(null);
    setSourceData({});
    setSessionData(null);
    setAnalysisResult(null);
  };

  // Rabbit Hole 功能选择
  const [selectedRabbitHoleFeature, setSelectedRabbitHoleFeature] = useState<string | null>(null);

  const handleRabbitHoleFeatureSelect = (featureId: string) => {
    setSelectedRabbitHoleFeature(featureId);
  };

  return (
    <div className="min-h-screen w-full bg-[#FAFAFA] text-gray-900 font-sans">
      {/* 侧边栏 */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          // 切换 tab 时清除选中的功能
          if (tab !== 'rabbit-hole') {
            setSelectedRabbitHoleFeature(null);
          }
        }}
        onRabbitHoleFeatureSelect={handleRabbitHoleFeatureSelect}
      />

      {/* 主内容区 */}
      <main className="ml-56 min-h-screen flex flex-col">
        {view === 'main' ? (
          <>
            {(activeTab === 'home' || activeTab === 'videos') && (
              <AssetsView
                onCreateProject={handleCreateProject}
                activeTab={activeTab as 'home' | 'videos'}
                onResumeWorkflow={handleResumeWorkflow}
              />
            )}
            {activeTab === 'rabbit-hole' && (
              <RabbitHoleView
                initialFeatureId={selectedRabbitHoleFeature}
                onFeatureChange={setSelectedRabbitHoleFeature}
              />
            )}
            {activeTab === 'my-materials' && (
              <MyMaterialsView />
            )}
            {activeTab === 'exports' && (
              <ExportsView />
            )}
          </>
        ) : view === 'processing' ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <ProcessingView
              sourceType={sourceType}
              taskType={taskType}
              sessionData={sessionData!}
              onComplete={handleProcessingComplete}
              onCancel={handleBack}
            />
          </div>
        ) : view === 'smart-processing' && sessionData?.analysisId ? (
          <SmartProcessingView
            analysisId={sessionData.analysisId}
            onComplete={handleSmartAnalysisComplete}
            onError={handleSmartAnalysisError}
            onCancel={handleBack}
          />
        ) : view === 'review' && analysisResult ? (
          <ReviewView
            analysisResult={analysisResult}
            projectId={sessionData?.projectId || ''}
            onConfirm={handleReviewConfirm}
            onBack={handleBack}
          />
        ) : null}
      </main>

      {/* ★ 新版统一工作流弹窗 */}
      {showCreateModal && (
        <WorkflowModal
          isOpen={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
            setWorkflowResumeData(undefined); // 完全关闭时清除状态
          }}
          onPause={(data: WorkflowPauseData) => {
            // 暂停时保存状态，下次打开可恢复
            setWorkflowResumeData(data);
            setShowCreateModal(false);
          }}
          resumeData={workflowResumeData}
        />
      )}
    </div>
  );
}

// ==========================================
// 统一新建项目弹窗 (包含上传 + 配置)
// ==========================================

// ★ AIProcessingSteps 已删除，由 taskType 决定处理流程

interface CreateProjectModalProps {
  onClose: () => void;
  onStart: (
    taskType: 'clips' | 'summary' | 'ai-create' | 'voice-extract',
    sessionData: SessionData,
    sourceType: SourceType,
    sourceData: SourceData
  ) => void;
}

function CreateProjectModal({ onClose, onStart }: CreateProjectModalProps) {
  // === 积分（从全局 store 获取，不会重复请求）===
  const { credits, refetch: refetchCredits } = useCredits();

  // ★★★ 渐进式两步流程状态（configure 已移除）★★★
  type Step = 'entry' | 'upload';
  const [currentStep, setCurrentStep] = useState<Step>('entry');

  // ★ 入口模式选择：ai-talk（智能播报）或 refine（口播精修）
  type EntryMode = 'ai-talk' | 'refine';
  const [entryMode, setEntryMode] = useState<EntryMode>('refine');

  // === 步骤1: 上传相关状态 ===
  const [link, setLink] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ★ 上传进度状态
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<'uploading' | 'processing' | 'ready'>('uploading');
  const [uploadedSession, setUploadedSession] = useState<{
    sessionId: string;
    projectId: string;
    assets?: Array<{ asset_id: string; order_index: number; upload_url: string; storage_path: string; file_name?: string }>;
  } | null>(null);

  // === 步骤2: 配置相关状态 ===
  const [scriptText, setScriptText] = useState('');
  // ★ 模式选择: ai-create (智能剪辑) | voice-extract (仅提字幕)
  const [selectedMode, setSelectedMode] = useState<'ai-create' | 'voice-extract'>('ai-create');

  // AI 智能剪辑消耗固定 100 积分（与后端 ai_model_credits 表一致）
  const aiCreateCredits = 100;

  // === 提交状态 ===
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // === 口癖检测弹窗状态 (refine 模式) ===
  const [showDefillerModal, setShowDefillerModal] = useState(false);
  const [defillerData, setDefillerData] = useState<{
    fillerWords: Array<{ word: string; count: number; total_duration_ms: number }>;
    transcriptSegments: Array<{ id: string; text: string; start: number; end: number; silence_info?: { classification: string } }>;
  } | null>(null);

  // === 拖拽处理 ===
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(
      file => file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm|avi|mkv)$/i)
    );
    if (files.length > 0) setSelectedFiles(prev => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) setSelectedFiles(prev => [...prev, ...files]);
    e.target.value = '';
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleMoveFile = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= selectedFiles.length) return;
    setSelectedFiles(prev => {
      const newFiles = [...prev];
      const [removed] = newFiles.splice(fromIndex, 1);
      newFiles.splice(toIndex, 0, removed);
      return newFiles;
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ★★★ 步骤1: 上传视频 (不扣积分) ★★★
  const handleUpload = async () => {
    if (selectedFiles.length === 0 && !link.trim()) return;

    setIsUploading(true);
    setError(null);
    setUploadProgress(0);
    setUploadPhase('uploading');

    try {
      // 导入上传相关函数 (notifyAssetUploaded 已在 uploadMultipleFiles 内部调用)
      const { uploadMultipleFiles, finalizeUpload } = await import('@/features/editor/lib/workspace-api');

      // === 多文件模式 ===
      if (selectedFiles.length > 0) {
        debugLog('[Upload] 多文件模式, 文件数:', selectedFiles.length);

        // 并行提取所有视频时长
        const filesInfo: FileInfo[] = await Promise.all(
          selectedFiles.map(async (file, index) => {
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

        // ★ 创建会话 (不扣积分，仅创建 session + assets)
        const sessionResponse = await createSession({
          source_type: 'local',
          task_type: 'voice-extract',  // ★ 默认使用不消耗积分的模式
          files: filesInfo,
        });

        debugLog('[Upload] 会话创建成功:', sessionResponse);

        // ★ 上传文件 (uploadMultipleFiles 内部会自动调用 notifyAssetUploaded)
        // ★ waitForReady=true: 等待 Cloudflare 转码完成
        if (sessionResponse.assets && sessionResponse.assets.length > 0) {
          await uploadMultipleFiles(
            selectedFiles,
            sessionResponse.assets,
            sessionResponse.session_id,
            undefined, // onFileProgress
            (percent) => {
              setUploadProgress(percent);
              // 上传完成后自动切换到处理中状态
              if (percent >= 100) {
                setUploadPhase('processing');
              }
            }
          );
          // 转码完成
          setUploadPhase('ready');
          // 注意: notifyAssetUploaded 已在 uploadMultipleFiles 内部调用，无需重复调用
        }

        // ★★★ 关键: 完成上传，创建基础项目结构 (track + clips) ★★★
        debugLog('[Upload] 调用 finalize-upload 创建基础项目结构...');
        const finalizeResult = await finalizeUpload(sessionResponse.session_id);
        debugLog('[Upload] 基础项目结构创建完成:', finalizeResult);

        // ★ 上传成功，保存会话信息
        setUploadedSession({
          sessionId: sessionResponse.session_id,
          projectId: sessionResponse.project_id,
          assets: sessionResponse.assets,
        });
        setIsUploading(false);

        // ★★★ 根据入口模式直接启动处理，跳过 configure 步骤 ★★★
        const sessionData: SessionData = {
          sessionId: sessionResponse.session_id,
          projectId: sessionResponse.project_id,
          assets: sessionResponse.assets,
          files: selectedFiles,
          uploadComplete: true,
        };

        if (entryMode === 'refine') {
          // 口播精修：调用 detectFillers 检测口癖
          try {
            const { detectFillers } = await import('@/features/editor/lib/workspace-api');
            const result = await detectFillers(sessionResponse.session_id);
            debugLog('[Refine] 口癖检测完成:', result);

            // 存储检测结果并弹出 DefillerModal
            setDefillerData({
              fillerWords: result.filler_words.map(f => ({
                word: f.word,
                count: f.count,
                total_duration_ms: f.total_duration_ms,
              })),
              transcriptSegments: result.transcript_segments,
            });
            setShowDefillerModal(true);
          } catch (err: unknown) {
            console.error('口癖检测失败:', err);
            // 失败时直接进入编辑器
            onStart('voice-extract', sessionData, 'file', { files: selectedFiles });
          }
        } else {
          // AI 智能播报：调用 startAIProcessing
          try {
            const { startAIProcessing } = await import('@/features/editor/lib/workspace-api');
            const result = await startAIProcessing(sessionResponse.session_id, {
              task_type: 'ai-create',
            });
            debugLog('[AI Talk] AI 处理已启动:', result);
            if (result.credits_consumed > 0) {
              refetchCredits();
            }
            onStart('ai-create', sessionData, 'file', { files: selectedFiles });
          } catch (err: unknown) {
            console.error('AI 处理启动失败:', err);
            const error = err as { status?: number; detail?: { error?: string } };
            if (error.status === 402 || error.detail?.error === 'insufficient_credits') {
              const { pricingModal } = await import('@/lib/stores/pricing-modal-store');
              pricingModal.open({ triggerReason: 'quota_exceeded', quotaType: 'credits' });
            }
          }
        }

        debugLog('[Upload] 上传完成，已启动处理');
        return;
      }

      // === 链接模式 (YouTube / URL) ===
      if (link.trim()) {
        const sessionResponse = await createSession({
          source_type: link.includes('youtube') ? 'youtube' : 'url',
          task_type: 'summary',
          source_url: link.trim(),
        });

        // 链接模式直接开始处理，无需配置步骤
        const sessionData: SessionData = {
          sessionId: sessionResponse.session_id,
          projectId: sessionResponse.project_id,
        };

        onStart('summary', sessionData, 'link', { link: link.trim() });
      }

    } catch (err: unknown) {
      console.error('上传失败:', err);
      const error = err as { status?: number; message?: string; detail?: unknown };
      setError(error.message || '上传失败');
      setIsUploading(false);
    }
  };

  // ★★★ 步骤2: 开始 AI 处理 (检查积分 + 扣积分) ★★★
  const handleStartAI = async () => {
    if (!uploadedSession) return;

    // ★★★ 口播精修模式：调用 detectFillers 而非 startAIProcessing ★★★
    if (entryMode === 'refine') {
      setIsLoading(true);
      setError(null);

      try {
        const { detectFillers } = await import('@/features/editor/lib/workspace-api');
        const result = await detectFillers(uploadedSession.sessionId);

        debugLog('[Refine] 口癖检测完成:', result);

        // 将检测结果存储，准备弹出 DefillerModal
        setDefillerData({
          fillerWords: result.filler_words.map(f => ({
            word: f.word,
            count: f.count,
            total_duration_ms: f.total_duration_ms,
          })),
          transcriptSegments: result.transcript_segments,
        });

        setShowDefillerModal(true);
        setIsLoading(false);
        return;

      } catch (err: unknown) {
        console.error('口癖检测失败:', err);
        const error = err as { message?: string };
        setError(error.message || '口癖检测失败');
        setIsLoading(false);
        return;
      }
    }

    // ★ AI 智能剪辑需要检查积分（前端快速校验）
    if (selectedMode === 'ai-create') {
      if (credits === null) {
        setError('正在加载积分信息，请稍后重试');
        return;
      }

      const { checkCreditsAndProceed } = await import('@/lib/utils/credits-guard');
      if (!checkCreditsAndProceed(credits.credits_balance, aiCreateCredits)) {
        return; // 积分不足，已弹出 pricing 框
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      // 导入启动 AI 处理的函数
      const { startAIProcessing } = await import('@/features/editor/lib/workspace-api');

      // ★ 调用新的 start-ai-processing 接口 (会扣积分)
      const result = await startAIProcessing(uploadedSession.sessionId, {
        task_type: selectedMode,
        // output_ratio 已移除，后端会使用默认值或自动检测
        options: scriptText ? { script: scriptText } : undefined,
      });

      debugLog('[StartAI] AI 处理已启动:', result);

      // ★ 刷新积分显示
      if (result.credits_consumed > 0) {
        refetchCredits();
      }

      // 构建 session 数据并进入处理视图
      // ★ uploadComplete: true 表示文件已在 page.tsx 上传完成，ProcessingView 无需重复上传
      const sessionData: SessionData = {
        sessionId: uploadedSession.sessionId,
        projectId: uploadedSession.projectId,
        assets: uploadedSession.assets,
        files: selectedFiles,
        uploadComplete: true,  // ★★★ 标记：文件已上传完成 ★★★
      };

      onStart(selectedMode, sessionData, 'file', { files: selectedFiles });

    } catch (err: unknown) {
      console.error('启动 AI 处理失败:', err);

      const error = err as { status?: number; message?: string; detail?: { error?: string; message?: string } };
      debugLog('[handleStartAI] 错误对象:', { status: error.status, message: error.message, detail: error.detail });

      // 处理 402 积分不足错误
      if (error.status === 402 || error.detail?.error === 'insufficient_credits') {
        const { pricingModal } = await import('@/lib/stores/pricing-modal-store');
        pricingModal.open({
          triggerReason: 'quota_exceeded',
          quotaType: 'credits',
          onSuccess: () => {
            refetchCredits();
          },
        });
        setIsLoading(false);
        return;
      }

      setError(error.detail?.message || error.message || '启动 AI 处理失败');
      setIsLoading(false);
    }
  };

  // ★ 返回上传步骤
  const handleBackToUpload = () => {
    setCurrentStep('upload');
    setUploadedSession(null);
    setUploadProgress(0);
  };

  // ★ 返回入口选择
  const handleBackToEntry = () => {
    setCurrentStep('entry');
    setSelectedFiles([]);
    setLink('');
    setUploadProgress(0);
    setIsUploading(false);
    setError(null);
  };

  const hasContent = selectedFiles.length > 0 || link.trim().length > 0;

  // ★★★ 渲染入口选择页 ★★★
  if (currentStep === 'entry') {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
        <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="p-8 pb-6 flex items-center justify-between">
            <div className="text-center flex-1">
              <h2 className="text-2xl font-black text-gray-900">选择创作模式</h2>
              <p className="text-sm text-gray-500 mt-1">AI 将根据您的选择优化处理流程</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors absolute right-6 top-6"
            >
              <X size={20} />
            </button>
          </div>

          {/* Entry Mode Cards */}
          <div className="px-8 pb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* AI 智能播报卡片 */}
            <div
              onClick={() => {
                setEntryMode('ai-talk');
                setCurrentStep('upload');
              }}
              className="group relative p-6 bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-transparent hover:border-indigo-400 rounded-2xl cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02]"
            >
              <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform">
                <Sparkles size={28} className="text-white" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">AI 智能播报</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                喂入文案，AI 将自动切分 Clip 并匹配 B-roll 素材。适合图文转视频。
              </p>
              <div className="mt-4 flex items-center text-xs text-indigo-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                <span>开始创作</span>
                <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>

            {/* 口播视频精修卡片 */}
            <div
              onClick={() => {
                setEntryMode('refine');
                setCurrentStep('upload');
              }}
              className="group relative p-6 bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-transparent hover:border-emerald-400 rounded-2xl cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02]"
            >
              <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform">
                <FileVideo size={28} className="text-white" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">口播视频精修</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                上传真人口播视频，AI 识别口癖废话并按语义智能切片、去除停顿。
              </p>
              <div className="mt-4 flex items-center text-xs text-emerald-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                <span>开始精修</span>
                <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ★★★ 渲染步骤1: 上传视频 ★★★
  if (currentStep === 'upload') {
    return (
      <>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-6 pb-4 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleBackToEntry}
                  disabled={isUploading}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">上传视频</h2>
                  <p className="text-xs text-gray-500">
                    {entryMode === 'ai-talk' ? 'AI 智能播报模式' : '口播视频精修模式'}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Upload Area */}
            <div className="flex-1 p-6 space-y-4">
              {/* Upload Dropzone */}
              <div
                onClick={() => !isUploading && fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "relative border-2 border-dashed rounded-xl py-12 flex flex-col items-center justify-center transition-all duration-200 group",
                  isUploading ? "pointer-events-none" : "cursor-pointer",
                  isDragging ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:border-gray-400 hover:bg-gray-50",
                  selectedFiles.length > 0 ? "py-6 border-solid border-gray-200 bg-gray-50" : ""
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,.mp4,.mov,.webm,.avi,.mkv"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={isUploading}
                />

                {selectedFiles.length === 0 ? (
                  <>
                    <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-white group-hover:scale-110 transition-all">
                      <Upload size={20} className="text-gray-900" />
                    </div>
                    <p className="text-sm text-gray-900 font-medium">点击或拖拽上传视频</p>
                    <p className="text-xs text-gray-500 mt-1">支持多文件拼接</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center">
                    <p className="text-sm font-medium text-gray-900 flex items-center">
                      <Upload size={14} className="mr-1.5" />
                      继续添加文件
                    </p>
                  </div>
                )}
              </div>

              {/* Selected File List */}
              {selectedFiles.length > 0 && (
                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                  {selectedFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center p-3 bg-gray-50 rounded-xl border border-gray-100 group hover:border-gray-200 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center border border-gray-200 flex-shrink-0 text-gray-400">
                        <FileVideo size={16} />
                      </div>
                      <div className="ml-3 flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                      </div>
                      {!isUploading && (
                        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveFile(index, index - 1); }}
                            disabled={index === 0}
                            className="p-1.5 text-gray-400 hover:bg-white hover:shadow-sm rounded-md disabled:opacity-30"
                          >▲</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveFile(index, index + 1); }}
                            disabled={index === selectedFiles.length - 1}
                            className="p-1.5 text-gray-400 hover:bg-white hover:shadow-sm rounded-md disabled:opacity-30"
                          >▼</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveFile(index); }}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors ml-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Upload Progress */}
              {isUploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 font-medium">
                      {uploadPhase === 'uploading' && '上传中...'}
                      {uploadPhase === 'processing' && '✨ 视频处理中，请稍候...'}
                      {uploadPhase === 'ready' && '✅ 处理完成'}
                    </span>
                    <span className="text-gray-900 font-bold">
                      {uploadPhase === 'uploading' ? `${uploadProgress}%` : ''}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${uploadPhase === 'processing'
                        ? 'bg-gradient-to-r from-yellow-400 to-orange-500 animate-pulse'
                        : 'bg-gradient-to-r from-purple-500 to-pink-500'
                        }`}
                      style={{ width: uploadPhase === 'uploading' ? `${uploadProgress}%` : '100%' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 pt-0">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 text-xs rounded-lg flex items-center">
                  <span className="mr-2">⚠️</span> {error}
                </div>
              )}

              <button
                onClick={handleUpload}
                disabled={!hasContent || isUploading}
                className={cn(
                  "w-full h-11 text-sm font-bold text-white rounded-xl shadow-lg transition-all flex items-center justify-center",
                  hasContent && !isUploading
                    ? "bg-black hover:bg-gray-800 hover:scale-[1.02] shadow-gray-200"
                    : "bg-gray-200 cursor-not-allowed text-gray-400"
                )}
              >
                {isUploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    {uploadPhase === 'uploading' && '上传中...'}
                    {uploadPhase === 'processing' && '视频处理中...'}
                    {uploadPhase === 'ready' && '准备就绪'}
                  </>
                ) : (
                  <>
                    <Upload size={16} className="mr-2" />
                    上传视频
                  </>
                )}
              </button>

              <p className="text-[10px] text-gray-400 text-center mt-3">
                上传视频不消耗积分，AI 处理时消耗
              </p>
            </div>
          </div>
        </div>
        {/* ★ 口癖检测弹窗 (refine 模式) - 完成后显示 B-Roll 配置弹窗 */}
        {showDefillerModal && defillerData && uploadedSession && (
          <DefillerModal
            isOpen={showDefillerModal}
            onClose={() => setShowDefillerModal(false)}
            clips={[]}
            sessionId={uploadedSession.sessionId}
            projectId={uploadedSession.projectId}
            fillerWords={defillerData.fillerWords.map(f => ({
              word: f.word,
              count: f.count,
              checked: true,
              totalDuration: f.total_duration_ms,
            }))}
            onComplete={() => {
              // ★ 口癖修剪完成
              setShowDefillerModal(false);
            }}
          />
        )}

      </>
    );
  }

  // ★ 不应该到达这里，返回 null
  return null;
}
