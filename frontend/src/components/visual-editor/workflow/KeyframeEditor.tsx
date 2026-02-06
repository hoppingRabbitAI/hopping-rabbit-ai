/**
 * 关键帧编辑器组件
 * 用于 AI 处理前的关键帧编辑和 Prompt 输入
 * 支持多次生成预览，确认后才应用
 * ★ 新增：预览历史功能，支持多版本对比选择
 * ★ 新增：Prompt 支持图片上传，支持图片+文字组合
 */

'use client';

import React, { useState, useCallback, useRef } from 'react';
import { 
  X, 
  Wand2, 
  Loader2, 
  ChevronLeft, 
  ChevronRight,
  Image as ImageIcon,
  Sparkles,
  RefreshCw,
  Check,
  RotateCcw,
  History,
  Shuffle,
  Upload,
  Trash2
} from 'lucide-react';
import { DrawingCanvas } from './DrawingCanvas';
import type { ClipNodeData, AICapability } from './types';

// ★ 新增：生成版本类型（包含完整生成参数）
interface GenerationVersion {
  id: string;
  previewUrl: string;
  prompt: string;
  promptImageUrl: string | null;  // ★ 新增：保存 prompt 参考图
  maskDataUrl: string | null;  // ★ 新增：保存当时使用的 mask
  taskId?: string;
  createdAt: Date;
}

interface KeyframeEditorProps {
  clip: ClipNodeData;
  capability: AICapability;
  keyframeUrl: string;
  onClose: () => void;
  onGenerate: (params: GenerateParams) => Promise<GenerateResult>;
  onConfirm: (params: ConfirmParams) => Promise<void>;
}

export interface GenerateParams {
  clipId: string;
  capabilityId: string;
  prompt: string;
  promptImageUrl?: string | null;  // ★ 新增：参考图 URL
  maskDataUrl?: string | null;
  keyframeUrl: string;
}

// ★ 新增：意图分类信息
export interface IntentInfo {
  type: 'add_element' | 'local_edit' | 'full_replace';
  confidence: number;
  reasoning: string;
  suggested_api: string;
}

export interface GenerateResult {
  previewUrl: string;
  taskId?: string;
  intent?: IntentInfo;  // ★ 新增：后端识别的意图
}

export interface ConfirmParams {
  clipId: string;
  capabilityId: string;
  previewUrl: string;
  prompt: string;
  promptImageUrl?: string | null;  // ★ 新增：参考图 URL
  taskId?: string;
}

// 不再使用预设 Prompt 模板

export function KeyframeEditor({
  clip,
  capability,
  keyframeUrl,
  onClose,
  onGenerate,
  onConfirm,
}: KeyframeEditorProps) {
  const [prompt, setPrompt] = useState('');
  const [promptImageUrl, setPromptImageUrl] = useState<string | null>(null);  // ★ 新增：参考图
  const [promptImageFile, setPromptImageFile] = useState<File | null>(null);  // ★ 新增：参考图文件
  const promptImageInputRef = useRef<HTMLInputElement>(null);  // ★ 新增：文件输入引用
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTaskId, setPreviewTaskId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [generateCount, setGenerateCount] = useState(0);
  
  // ★★★ 新增：意图识别结果 ★★★
  const [detectedIntent, setDetectedIntent] = useState<IntentInfo | null>(null);
  
  // ★ 新增：编辑模式（即使有预览也可以重新编辑 mask）
  const [isEditingMask, setIsEditingMask] = useState(false);
  
  // ★ 新增：预览历史
  const [previewHistory, setPreviewHistory] = useState<GenerationVersion[]>([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);

  // ★ 实际使用的关键帧 URL（优先 clip.thumbnail，其次 keyframeUrl prop）
  const actualKeyframeUrl = clip.thumbnail || keyframeUrl;
  
  // ★ 调试日志
  console.log('[KeyframeEditor] 渲染:', { 
    clipId: clip.clipId, 
    capability: capability.id, 
    actualKeyframeUrl: actualKeyframeUrl ? actualKeyframeUrl.substring(0, 80) + '...' : '(空)',
    clipThumbnail: clip.thumbnail ? '有' : '无',
    keyframeUrlProp: keyframeUrl ? '有' : '无'
  });

  // ★ 新增：处理参考图上传
  const handlePromptImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        setError('请上传图片文件');
        return;
      }
      // 验证文件大小 (最大 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError('图片大小不能超过 10MB');
        return;
      }
      
      setPromptImageFile(file);
      const objectUrl = URL.createObjectURL(file);
      setPromptImageUrl(objectUrl);
      setError(null);
    }
  }, []);

  // ★ 新增：移除参考图
  const handleRemovePromptImage = useCallback(() => {
    if (promptImageUrl) {
      URL.revokeObjectURL(promptImageUrl);
    }
    setPromptImageUrl(null);
    setPromptImageFile(null);
    if (promptImageInputRef.current) {
      promptImageInputRef.current.value = '';
    }
  }, [promptImageUrl]);

  // 处理生成预览
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() && !promptImageUrl) {
      setError('请输入描述或上传参考图');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const result = await onGenerate({
        clipId: clip.clipId,
        capabilityId: capability.id,
        prompt: prompt.trim(),
        promptImageUrl,  // ★ 传递参考图
        maskDataUrl,
        keyframeUrl: actualKeyframeUrl,  // ★ 使用 actualKeyframeUrl
      });
      
      // ★★★ 新增：保存意图识别结果 ★★★
      if (result.intent) {
        setDetectedIntent(result.intent);
        console.log('[KeyframeEditor] 意图识别:', result.intent);
      }
      
      // ★ 新增：保存到历史（包含 mask 和参考图信息）
      const newVersion: GenerationVersion = {
        id: `v${Date.now()}`,
        previewUrl: result.previewUrl,
        prompt: prompt.trim(),
        promptImageUrl: promptImageUrl,  // ★ 保存当时使用的参考图
        maskDataUrl: maskDataUrl,  // ★ 保存当时使用的 mask
        taskId: result.taskId,
        createdAt: new Date(),
      };
      
      setPreviewHistory(prev => [...prev, newVersion]);
      setCurrentVersionIndex(previewHistory.length); // 指向新添加的版本
      
      // 更新预览图
      setPreviewUrl(result.previewUrl);
      setPreviewTaskId(result.taskId);
      setGenerateCount(prev => prev + 1);
      
      // ★ 生成后退出编辑模式
      setIsEditingMask(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, promptImageUrl, maskDataUrl, actualKeyframeUrl, clip.clipId, capability.id, onGenerate]);

  // 确认应用 - ★ 治标治本：立即触发，不等待结果
  const handleConfirm = useCallback(async () => {
    if (!previewUrl) {
      setError('请先生成预览');
      return;
    }

    setError(null);

    try {
      // 调用父组件的 onConfirm，它会立即关闭弹窗并异步处理任务
      await onConfirm({
        clipId: clip.clipId,
        capabilityId: capability.id,
        previewUrl,
        prompt: prompt.trim(),
        promptImageUrl,
        taskId: previewTaskId,
      });
      // 父组件会关闭弹窗，这里不需要 onClose
    } catch (err) {
      // 如果立即出错（如参数验证），显示错误
      setError(err instanceof Error ? err.message : '确认失败');
    }
  }, [previewUrl, previewTaskId, prompt, promptImageUrl, clip.clipId, capability.id, onConfirm]);

  // 重置预览
  const handleReset = useCallback(() => {
    setPreviewUrl(null);
    setPreviewTaskId(undefined);
    setGenerateCount(0);
    setPreviewHistory([]);
    setCurrentVersionIndex(-1);
    setIsEditingMask(false);
  }, []);

  // ★ 新增：进入重绘模式（保留历史，但可以重新画 mask）
  const handleEditMask = useCallback(() => {
    setIsEditingMask(true);
  }, []);

  // ★ 新增：退出重绘模式，回到预览
  const handleExitEditMask = useCallback(() => {
    setIsEditingMask(false);
  }, []);

  // ★ 新增：切换历史版本
  const handleSelectVersion = useCallback((index: number) => {
    if (index >= 0 && index < previewHistory.length) {
      const version = previewHistory[index];
      setCurrentVersionIndex(index);
      setPreviewUrl(version.previewUrl);
      setPreviewTaskId(version.taskId);
      setPrompt(version.prompt);
    }
  }, [previewHistory]);

  // ★ 新增：上一个版本
  const handlePrevVersion = useCallback(() => {
    if (currentVersionIndex > 0) {
      handleSelectVersion(currentVersionIndex - 1);
    }
  }, [currentVersionIndex, handleSelectVersion]);

  // ★ 新增：下一个版本
  const handleNextVersion = useCallback(() => {
    if (currentVersionIndex < previewHistory.length - 1) {
      handleSelectVersion(currentVersionIndex + 1);
    }
  }, [currentVersionIndex, previewHistory.length, handleSelectVersion]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[1100px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">{capability.name}</h2>
              <p className="text-sm text-gray-500">
                分镜 #{clip.index + 1} · {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 主内容区 - 画布居中为视觉中心，不允许滚动 */}
        <div className="flex-1 p-6 overflow-hidden">
          <div className="flex gap-6 h-full">
            {/* 左侧 + 中间：关键帧画布区 - 占据主要空间 */}
            <div className="flex-1 min-w-0 space-y-3 flex flex-col">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-gray-500" />
                  <h3 className="font-medium text-gray-700">
                    {previewUrl ? '生成预览' : '关键帧编辑'}
                  </h3>
                  {generateCount > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-600 rounded-full">
                      第 {generateCount} 次生成
                    </span>
                  )}
                </div>
                {previewUrl && (
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    重新编辑
                  </button>
                )}
              </div>
              
              {/* 预览图或绘画画布 - 限制高度确保一页展示 */}
              {previewUrl && !isEditingMask ? (
                <div className="space-y-3 w-full flex-1 flex flex-col">
                  {/* 主预览图 - 限制最大高度 */}
                  <div 
                    className="relative rounded-xl overflow-hidden border-2 border-blue-200 bg-gray-900 flex items-center justify-center flex-1"
                    style={{
                      width: '100%',
                      minHeight: '300px',
                      maxHeight: '50vh',
                    }}
                  >
                    <img
                      src={previewUrl}
                      alt="生成预览"
                      className="max-w-full max-h-full object-contain"
                      style={{ 
                        maxHeight: '50vh',
                      }}
                    />
                    {/* 预览标识 + 意图提示 */}
                    <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                      <div className="px-2.5 py-1 bg-blue-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" />
                        AI 生成预览
                      </div>
                      {/* ★★★ 新增：意图识别提示 ★★★ */}
                      {detectedIntent && (
                        <div className={`px-2.5 py-1 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 ${
                          detectedIntent.type === 'add_element' ? 'bg-green-500' :
                          detectedIntent.type === 'local_edit' ? 'bg-orange-500' :
                          'bg-purple-500'
                        }`}>
                          {detectedIntent.type === 'add_element' ? '🎯 添加元素' :
                           detectedIntent.type === 'local_edit' ? '✏️ 局部修改' :
                           '🖼️ 换背景'}
                          <span className="opacity-75">({Math.round(detectedIntent.confidence * 100)}%)</span>
                        </div>
                      )}
                    </div>
                    {/* 版本号标识 */}
                    {previewHistory.length > 1 && (
                      <div className="absolute top-3 right-3 px-2.5 py-1 bg-gray-800/80 text-white text-xs font-medium rounded-lg">
                        {currentVersionIndex + 1} / {previewHistory.length}
                      </div>
                    )}
                  </div>
                  
                  {/* 重绘区域按钮 */}
                  <button
                    onClick={handleEditMask}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg border border-dashed border-gray-300 transition-colors"
                  >
                    <ImageIcon className="w-4 h-4" />
                    重新涂抹修改区域
                  </button>
                  
                  {/* 历史版本缩略图条 */}
                  {previewHistory.length > 1 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <History className="w-3.5 h-3.5" />
                          历史版本
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={handlePrevVersion}
                            disabled={currentVersionIndex <= 0}
                            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <ChevronLeft className="w-4 h-4 text-gray-500" />
                          </button>
                          <button
                            onClick={handleNextVersion}
                            disabled={currentVersionIndex >= previewHistory.length - 1}
                            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <ChevronRight className="w-4 h-4 text-gray-500" />
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {previewHistory.map((version, idx) => (
                          <button
                            key={version.id}
                            onClick={() => handleSelectVersion(idx)}
                            className={`relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                              idx === currentVersionIndex 
                                ? 'border-blue-500 ring-2 ring-blue-200' 
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <img 
                              src={version.previewUrl} 
                              alt={`版本 ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5">
                              v{idx + 1}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex items-start">
                  {/* 编辑 mask 模式 - 自适应容器尺寸 */}
                  <DrawingCanvas
                    imageUrl={actualKeyframeUrl}
                    onMaskChange={setMaskDataUrl}
                  />
                  
                  {/* 如果是从预览切换回来的，显示返回按钮 */}
                  {previewUrl && isEditingMask && (
                    <button
                      onClick={handleExitEditMask}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      返回查看预览
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 右侧：Prompt 输入区 */}
            <div className="w-[280px] flex-shrink-0 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-gray-500" />
                <h3 className="font-medium text-gray-700">描述效果</h3>
              </div>

              {/* Prompt 输入框 */}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`描述你想要的${capability.name}效果...`}
                className="w-full h-28 px-4 py-3 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />

              {/* 参考图上传区域 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-600">参考图（可选）</span>
                </div>
                
                {promptImageUrl ? (
                  <div className="relative group">
                    <div className="relative w-full h-20 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                      <img
                        src={promptImageUrl}
                        alt="参考图"
                        className="w-full h-full object-contain"
                      />
                      <button
                        onClick={handleRemovePromptImage}
                        className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        title="移除参考图"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                    <div className="flex flex-col items-center justify-center py-2">
                      <Upload className="w-4 h-4 text-gray-400 mb-1" />
                      <span className="text-xs text-gray-500">上传参考图</span>
                    </div>
                    <input
                      ref={promptImageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePromptImageUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* 生成按钮 */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || (!prompt.trim() && !promptImageUrl)}
                  className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-medium rounded-xl hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      生成中...
                    </>
                  ) : previewUrl ? (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      重新生成
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      生成
                    </>
                  )}
                </button>
                
                {/* 换一个按钮 */}
                {previewUrl && (
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    title="保持相同描述，换一个结果"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Shuffle className="w-4 h-4" />
                    )}
                    换一个
                  </button>
                )}
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <div className="text-xs text-gray-500">
            {previewUrl && !isEditingMask
              ? `✓ 已生成 ${generateCount} 个版本 · 可修改描述或重绘区域后重新生成` 
              : isEditingMask
                ? '🎨 正在编辑修改区域 · 涂抹后点击生成'
                : maskDataUrl 
                  ? '✓ 已标注修改区域' 
                  : '💡 可选：涂抹要修改的区域'
            }
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-xl transition-colors"
            >
              取消
            </button>
            
            {/* 确认按钮 - ★ 点击后立即关闭弹窗，任务在后台异步执行 */}
            <button
              onClick={handleConfirm}
              disabled={isGenerating || !previewUrl}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-medium rounded-xl hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <Check className="w-4 h-4" />
              确认
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
