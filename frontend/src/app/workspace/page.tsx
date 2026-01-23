'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sidebar, type SidebarTab } from '../../components/workspace/Sidebar';
import { AssetsView } from '../../components/workspace/AssetsView';
import { RabbitHoleView } from '../../components/workspace/RabbitHoleView';
import { ExportsView } from '../../components/workspace/ExportsView';
import { AICreationsView } from '../../components/workspace/AICreationsView';
import { ProcessingView } from '../../components/workspace/ProcessingView';
import { SmartProcessingView } from '../../components/workspace/SmartProcessingView';
import { ReviewView } from '../../components/workspace/ReviewView';
import { AnalysisResult, startContentAnalysis } from '@/features/editor/lib/smart-v2-api';
import {
  createSession,
  type TaskType as ApiTaskType,
  type FileInfo
} from '@/features/editor/lib/workspace-api';
import { getVideoDuration } from '@/features/editor/lib/media-cache';
import {
  Upload,
  X,
  FileVideo,
  Trash2,
  Wand2,
  Mic,
  MessageSquare
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
    if (tabParam && ['home', 'videos', 'ai-creations', 'trash', 'rabbit-hole', 'exports'].includes(tabParam)) {
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

  const handleCreateProject = () => {
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
              />
            )}
            {activeTab === 'rabbit-hole' && (
              <RabbitHoleView 
                initialFeatureId={selectedRabbitHoleFeature}
                onFeatureChange={setSelectedRabbitHoleFeature}
              />
            )}
            {activeTab === 'ai-creations' && (
              <AICreationsView />
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

      {/* 统一新建项目弹窗 */}
      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onStart={handleStartProcessing}
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
  // === 步骤1: 上传相关状态 ===
  const [link, setLink] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === 步骤2: 配置相关状态 ===
  const [scriptText, setScriptText] = useState('');
  // ★ 模式选择: ai-create (智能剪辑) | voice-extract (仅提字幕)
  const [selectedMode, setSelectedMode] = useState<'ai-create' | 'voice-extract'>('ai-create');

  // === 提交状态 ===
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // === 开始处理 ===
  const handleStart = async () => {
    if (selectedFiles.length === 0 && !link.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const taskType = selectedMode; // 使用选择的模式

      // 确定 Source Type
      const currentSourceType: SourceType = selectedFiles.length > 0 ? 'file' : 'link';
      const currentSourceData: SourceData = {
        files: selectedFiles.length > 0 ? selectedFiles : undefined,
        file: selectedFiles.length === 1 ? selectedFiles[0] : undefined,
        link: link.trim() || undefined
      };

      // === 多文件模式 ===
      if (selectedFiles.length > 0) {
        debugLog('[CreateProject] 多文件模式, 文件数:', selectedFiles.length);

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

        const sessionResponse = await createSession({
          source_type: 'local',
          task_type: selectedMode,  // ★ 使用选择的模式
          files: filesInfo,
        });

        const sessionData: SessionData = {
          sessionId: sessionResponse.session_id,
          projectId: sessionResponse.project_id,
          assets: sessionResponse.assets,
          files: selectedFiles,
        };

        // ★ V2 智能分析移到 ProcessingView 上传完成后触发
        // 避免在视频还在上传时就开始等待，导致超时

        onStart(taskType, sessionData, currentSourceType, currentSourceData);
        return;
      }

      // === 链接模式 (YouTube / URL) ===
      // 链接模式主要用于视频文本总结，后台会自动下载视频
      if (link.trim()) {
        const sessionResponse = await createSession({
          source_type: link.includes('youtube') ? 'youtube' : 'url',
          task_type: 'summary',  // ★ 链接模式用于总结
          source_url: link.trim(),
        });

        const sessionData: SessionData = {
          sessionId: sessionResponse.session_id,
          projectId: sessionResponse.project_id,
          // 链接模式无需上传，后台会自动下载处理
        };

        onStart('summary', sessionData, currentSourceType, currentSourceData);
      }

    } catch (err) {
      console.error('创建会话失败:', err);
      setError(err instanceof Error ? err.message : '创建会话失败');
      setIsLoading(false);
    }
  };

  const hasContent = selectedFiles.length > 0 || link.trim().length > 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col md:flex-row overflow-hidden animate-in zoom-in-95 duration-200">

        {/* Left Side: Upload (Fixed Width) */}
        <div className="flex-1 min-w-[360px] flex flex-col border-r border-gray-100 bg-white">
          <div className="p-6 pb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">新建项目</h2>
          </div>

          <div className="flex-1 p-6 pt-0 overflow-y-auto space-y-4">
            {/* Upload Dropzone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "relative border-2 border-dashed rounded-xl py-12 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 group",
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
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {selectedFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center p-3 bg-gray-50 rounded-xl border border-gray-100 group hover:border-gray-200 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center border border-gray-200 flex-shrink-0 text-gray-400">
                      <FileVideo size={16} />
                    </div>
                    <div className="ml-3 flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                    </div>
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: AI Settings */}
        <div className="flex-1 bg-gray-50/50 flex flex-col min-w-[320px]">
          <div className="p-6 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
              <span className="w-5 h-5 rounded-full bg-black text-white flex items-center justify-center text-xs">AI</span>
              <span>智能处理选项</span>
            </h3>
            <button
              onClick={onClose}
              className="w-8 h-8 flex md:hidden items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X size={20} />
            </button>
            <button
              onClick={onClose}
              className="hidden md:flex w-8 h-8 items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 p-6 pt-0 overflow-y-auto">
            <div className={cn("space-y-4 transition-all duration-300", !hasContent ? "opacity-50 pointer-events-none grayscale" : "opacity-100")}>

              <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm space-y-4">
                <div className="flex items-center space-x-3 pb-3 border-b border-gray-100">
                  <div className="p-2 bg-black rounded-lg text-white shadow-md">
                    <Wand2 size={16} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-gray-900 text-sm">AI 智能剪辑</h4>
                    <p className="text-xs text-gray-500 font-medium">自动识别精彩片段、运镜与字幕</p>
                  </div>
                </div>

                {/* ★ 处理流程由 task_type 控制，无需用户配置 */}
                {/* ★ 模式选择 */}
                <div className="space-y-2 py-2">
                  {/* 选项 1: 智能剪辑 */}
                  <div
                    onClick={() => setSelectedMode('ai-create')}
                    className={cn(
                      "flex items-center space-x-3 p-3 rounded-xl border transition-all cursor-pointer",
                      selectedMode === 'ai-create'
                        ? "bg-black/5 border-black/10 ring-1 ring-black/5"
                        : "bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                      selectedMode === 'ai-create' ? "bg-black text-white" : "bg-gray-100 text-gray-400"
                    )}>
                      <Wand2 size={14} />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-bold text-gray-900">AI 智能剪辑</div>
                      <div className="text-[10px] text-gray-500">自动识别精彩片段、运镜与字幕</div>
                    </div>
                    {selectedMode === 'ai-create' && (
                      <div className="w-4 h-4 rounded-full bg-black text-white flex items-center justify-center">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* 选项 2: 仅提取字幕 */}
                  <div
                    onClick={() => setSelectedMode('voice-extract')}
                    className={cn(
                      "flex items-center space-x-3 p-3 rounded-xl border transition-all cursor-pointer",
                      selectedMode === 'voice-extract'
                        ? "bg-black/5 border-black/10 ring-1 ring-black/5"
                        : "bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                      selectedMode === 'voice-extract' ? "bg-black text-white" : "bg-gray-100 text-gray-400"
                    )}>
                      <Mic size={14} />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-bold text-gray-900">仅提取字幕/音频</div>
                      <div className="text-[10px] text-gray-500">保留完整音频用于口播/vlog创作</div>
                    </div>
                    {selectedMode === 'voice-extract' && (
                      <div className="w-4 h-4 rounded-full bg-black text-white flex items-center justify-center">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>

                {/* Script Input */}
                <div className="relative pt-2">
                  <div className="absolute top-5 left-3 text-gray-400">
                    <MessageSquare size={14} />
                  </div>
                  <textarea
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    placeholder="[可选] 粘贴原始脚本/文案，AI 将对比实际口播内容..."
                    rows={3}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 resize-none transition-all"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer Action */}
          <div className="p-6 border-t border-gray-200 bg-white">
            {error && (
              <div className="mb-4 p-3 bg-gray-50 border border-gray-200 text-red-600 text-xs rounded-lg flex items-center">
                <span className="mr-2">⚠️</span> {error}
              </div>
            )}

            <button
              onClick={handleStart}
              disabled={!hasContent || isLoading}
              className={cn(
                "w-full h-11 text-sm font-bold text-white rounded-xl shadow-lg transition-all flex items-center justify-center",
                hasContent && !isLoading
                  ? "bg-black hover:bg-gray-800 hover:scale-[1.02] shadow-gray-200"
                  : "bg-gray-200 cursor-not-allowed text-gray-400"
              )}
            >
              {isLoading ? '解析中...' : '开始处理'}
              {!isLoading && <Wand2 size={16} className="ml-2" />}
            </button>
            <p className="text-center text-[10px] text-gray-400 mt-3">
              预计消耗 1 个点数
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
