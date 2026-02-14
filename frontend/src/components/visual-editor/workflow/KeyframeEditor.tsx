/**
 * 关键帧编辑器组件
 * 用于 AI 处理前的关键帧编辑和 Prompt 输入
 * 支持多次生成预览，确认后才应用
 * ★ 治标治本：持久化历史记录，打开时加载已生成的图片
 * ★ 新增：横向缩略图列表样式，生成后自动选中
 */

'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  X, 
  Wand2, 
  Loader2, 
  ChevronLeft, 
  ChevronRight,
  ChevronDown,
  Image as ImageIcon,
  Sparkles,
  Check,
  History,
  Upload,
  Trash2,
  Lightbulb
} from 'lucide-react';
import { DrawingCanvas } from './DrawingCanvas';
import type { ClipNodeData, AICapability } from './types';
import { useTaskHistoryStore } from '@/stores/taskHistoryStore';
import { getPresetsForCapability } from '@/lib/prompt-presets';

// ★ 生成版本类型（包含完整生成参数）
interface GenerationVersion {
  id: string;
  previewUrl: string;
  prompt: string;
  promptImageUrl: string | null;
  maskDataUrl: string | null;
  taskId?: string;
  createdAt: Date;
  isFromHistory?: boolean;  // ★ 标记是否来自持久化历史
}

interface KeyframeEditorProps {
  clip: ClipNodeData;
  capability: AICapability;
  keyframeUrl: string;
  projectId?: string;  // ★ 新增：用于加载历史记录
  onClose: () => void;
  onGenerate: (params: GenerateParams) => Promise<GenerateResult>;
  onConfirm: (params: ConfirmParams) => Promise<void>;
}

export interface GenerateParams {
  clipId: string;
  capabilityId: string;
  prompt: string;
  promptImageUrl?: string | null;  // ★ 参考图 URL
  maskDataUrl?: string | null;
  keyframeUrl: string;
  provider?: 'doubao' | 'kling';   // ★ 模型提供商
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
  projectId,
  onClose,
  onGenerate,
  onConfirm,
}: KeyframeEditorProps) {
  const [prompt, setPrompt] = useState('');
  const [promptImageUrl, setPromptImageUrl] = useState<string | null>(null);
  const [promptImageFile, setPromptImageFile] = useState<File | null>(null);
  const promptImageInputRef = useRef<HTMLInputElement>(null);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageProvider, setImageProvider] = useState<'doubao' | 'kling'>('doubao');
  
  // ★★★ 治标治本：从 store 加载历史记录 ★★★
  const tasks = useTaskHistoryStore(state => state.tasks);
  
  // ★ 生成历史：包含持久化历史 + 本次会话新生成的
  const [sessionHistory, setSessionHistory] = useState<GenerationVersion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const historyContainerRef = useRef<HTMLDivElement>(null);
  
  // ★ 意图识别结果
  const [detectedIntent, setDetectedIntent] = useState<IntentInfo | null>(null);

  // ★ 实际使用的关键帧 URL
  const actualKeyframeUrl = clip.thumbnail || keyframeUrl;
  
  // ★★★ 核心：从任务历史中加载该 clip 的已完成生成记录 ★★★
  useEffect(() => {
    // 筛选该 clip 的已完成任务（有 output_url 的）
    const clipTasks = tasks.filter(task => {
      const taskClipId = task.clip_id || (task.input_params as { clip_id?: string })?.clip_id;
      return taskClipId === clip.clipId && 
             task.status === 'completed' && 
             task.output_url;
    });
    
    // 转换为 GenerationVersion 格式
    const historyVersions: GenerationVersion[] = clipTasks.map(task => ({
      id: task.id,
      previewUrl: task.output_url!,
      prompt: (task.input_params as { prompt?: string })?.prompt || '',
      promptImageUrl: null,
      maskDataUrl: null,
      taskId: task.id,
      createdAt: new Date(task.created_at),
      isFromHistory: true,
    }));
    
    // 按创建时间排序（最新的在后面）
    historyVersions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    
    // 合并历史记录（避免重复）
    setSessionHistory(prev => {
      const existingIds = new Set(prev.map(v => v.id));
      const newFromHistory = historyVersions.filter(v => !existingIds.has(v.id));
      
      if (newFromHistory.length === 0) return prev;
      
      // 历史记录在前，本次会话生成的在后
      const merged = [...newFromHistory, ...prev.filter(v => !v.isFromHistory)];
      
      // 如果有历史且当前未选中，自动选中最新的
      if (merged.length > 0 && selectedIndex === -1) {
        setSelectedIndex(merged.length - 1);
      }
      
      return merged;
    });
  }, [tasks, clip.clipId, selectedIndex]);
  
  // ★ 当前选中的预览
  const currentPreview = selectedIndex >= 0 && selectedIndex < sessionHistory.length 
    ? sessionHistory[selectedIndex] 
    : null;

  // ★ 处理参考图上传
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

  // ★ 移除参考图
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

  // ★★★ 处理生成预览 - 生成后添加到历史并自动选中 ★★★
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
        promptImageUrl,
        maskDataUrl,
        keyframeUrl: actualKeyframeUrl,
        provider: imageProvider,
      });
      
      // 保存意图识别结果
      if (result.intent) {
        setDetectedIntent(result.intent);
      }
      
      // ★★★ 核心：添加到历史并自动选中 ★★★
      const newVersion: GenerationVersion = {
        id: `session-${Date.now()}`,
        previewUrl: result.previewUrl,
        prompt: prompt.trim(),
        promptImageUrl: promptImageUrl,
        maskDataUrl: maskDataUrl,
        taskId: result.taskId,
        createdAt: new Date(),
        isFromHistory: false,
      };
      
      setSessionHistory(prev => {
        const updated = [...prev, newVersion];
        // 自动选中新生成的（最后一个）
        setSelectedIndex(updated.length - 1);
        return updated;
      });
      
      // ★ 滚动到最新生成的图片
      setTimeout(() => {
        historyContainerRef.current?.scrollTo({
          left: historyContainerRef.current.scrollWidth,
          behavior: 'smooth'
        });
      }, 100);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, promptImageUrl, maskDataUrl, actualKeyframeUrl, clip.clipId, capability.id, onGenerate, imageProvider]);

  // ★ 确认应用 - 使用当前选中的版本
  const handleConfirm = useCallback(async () => {
    if (!currentPreview) {
      setError('请先生成或选择一个预览');
      return;
    }

    setError(null);

    try {
      await onConfirm({
        clipId: clip.clipId,
        capabilityId: capability.id,
        previewUrl: currentPreview.previewUrl,
        prompt: currentPreview.prompt,
        promptImageUrl: currentPreview.promptImageUrl,
        taskId: currentPreview.taskId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认失败');
    }
  }, [currentPreview, clip.clipId, capability.id, onConfirm]);

  // ★ 选择历史版本
  const handleSelectVersion = useCallback((index: number) => {
    if (index >= 0 && index < sessionHistory.length) {
      setSelectedIndex(index);
      // 恢复该版本的 prompt
      const version = sessionHistory[index];
      setPrompt(version.prompt);
    }
  }, [sessionHistory]);

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
            <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
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

        {/* ★★★ 主内容区 - 新布局：左侧画布+历史，右侧输入 ★★★ */}
        <div className="flex-1 p-6 overflow-hidden">
          <div className="flex gap-6 h-full">
            {/* 左侧：关键帧编辑 + 底部历史记录缩略图条 */}
            <div className="flex-1 min-w-0 flex flex-col gap-4">
              {/* 标题栏 */}
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-gray-500" />
                <h3 className="font-medium text-gray-700">关键帧编辑</h3>
                {maskDataUrl && (
                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                    ✓ 已标注修改区域
                  </span>
                )}
              </div>
              
              {/* ★ 绘图画布 - 始终显示，用于涂抹修改区域 */}
              <div className="flex-1 min-h-0">
                <DrawingCanvas
                  imageUrl={actualKeyframeUrl}
                  onMaskChange={setMaskDataUrl}
                />
              </div>
              
              {/* ★★★ 核心改造：底部横向缩略图历史记录条（类似图2样式）★★★ */}
              {sessionHistory.length > 0 && (
                <div className="flex-shrink-0 pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <History className="w-3.5 h-3.5" />
                      <span>生成记录 ({sessionHistory.length})</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => selectedIndex > 0 && handleSelectVersion(selectedIndex - 1)}
                        disabled={selectedIndex <= 0}
                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-4 h-4 text-gray-500" />
                      </button>
                      <button
                        onClick={() => selectedIndex < sessionHistory.length - 1 && handleSelectVersion(selectedIndex + 1)}
                        disabled={selectedIndex >= sessionHistory.length - 1}
                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>
                  </div>
                  
                  {/* ★ 横向滚动的缩略图列表 - 类似图2的样式 */}
                  <div 
                    ref={historyContainerRef}
                    className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
                  >
                    {sessionHistory.map((version, idx) => (
                      <button
                        key={version.id}
                        onClick={() => handleSelectVersion(idx)}
                        className={`relative flex-shrink-0 rounded-xl overflow-hidden border-2 transition-all hover:scale-105 ${
                          idx === selectedIndex 
                            ? 'border-gray-900 ring-2 ring-gray-200 shadow-lg' 
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        style={{ width: '100px', height: '140px' }}
                      >
                        <img 
                          src={version.previewUrl} 
                          alt={`生成 ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        {/* 选中指示器 */}
                        {idx === selectedIndex && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-gray-800 rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                        {/* 底部标签 */}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                          <div className="text-white text-[10px] truncate">
                            {version.prompt || '无描述'}
                          </div>
                        </div>
                        {/* 历史来源标记 */}
                        {version.isFromHistory && (
                          <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-gray-800/60 text-white text-[9px] rounded">
                            历史
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 右侧：Prompt 输入区 */}
            <div className="w-[280px] flex-shrink-0 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-gray-500" />
                  <h3 className="font-medium text-gray-700">描述效果</h3>
                </div>
                {(() => {
                  const presets = getPresetsForCapability(capability.id);
                  return presets.length > 0 ? (
                    <div className="relative group">
                      <button type="button" className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors">
                        <Lightbulb className="h-3 w-3" />
                        推荐
                        <ChevronDown className="h-2.5 w-2.5" />
                      </button>
                      <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block w-64 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                        {presets.map((preset, idx) => (
                          <button key={idx} type="button" onClick={() => setPrompt(preset.prompt)}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                            <div className="text-xs font-medium text-gray-700">{preset.label}</div>
                            <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{preset.prompt}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>

              {/* Prompt 输入框 */}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`描述你想要的${capability.name}效果...`}
                className="w-full h-28 px-4 py-3 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent text-sm"
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
                  <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-gray-400 hover:bg-gray-50/50 transition-colors">
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

              {/* ★ 模型选择器 */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500">模型</span>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  {([
                    { value: 'doubao' as const, label: 'Doubao' },
                    { value: 'kling' as const, label: 'Kling' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setImageProvider(opt.value)}
                      className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        imageProvider === opt.value
                          ? 'bg-gray-800 text-white'
                          : 'bg-white text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 生成按钮 */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || (!prompt.trim() && !promptImageUrl)}
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-800 text-white text-sm font-medium rounded-xl hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    {sessionHistory.length > 0 ? '再生成一个' : '生成'}
                  </>
                )}
              </button>

              {/* 错误提示 */}
              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}
              
              {/* ★ 当前选中的预览大图 */}
              {currentPreview && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">当前选中</span>
                    {detectedIntent && (
                      <span className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                        detectedIntent.type === 'add_element' ? 'bg-gray-100 text-gray-600' :
                        detectedIntent.type === 'local_edit' ? 'bg-gray-100 text-gray-600' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {detectedIntent.type === 'add_element' ? '添加元素' :
                         detectedIntent.type === 'local_edit' ? '局部修改' :
                         '换背景'}
                      </span>
                    )}
                  </div>
                  <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <img
                      src={currentPreview.previewUrl}
                      alt="当前选中"
                      className="w-full h-auto object-contain"
                      style={{ maxHeight: '200px' }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <div className="text-xs text-gray-500">
            {sessionHistory.length > 0
              ? `✓ 共 ${sessionHistory.length} 个版本${selectedIndex >= 0 ? ` · 已选第 ${selectedIndex + 1} 个` : ''}` 
              : maskDataUrl 
                ? '✓ 已标注修改区域 · 输入描述后点击生成' 
                : '💡 可选：涂抹要修改的区域，然后描述想要的效果'
            }
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-xl transition-colors"
            >
              取消
            </button>
            
            {/* 确认按钮 */}
            <button
              onClick={handleConfirm}
              disabled={isGenerating || !currentPreview}
              className="flex items-center gap-2 px-6 py-2.5 bg-gray-800 text-white text-sm font-medium rounded-xl hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
