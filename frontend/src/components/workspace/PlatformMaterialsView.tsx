'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Upload,
  Search,
  RefreshCw,
  Trash2,
  X,
  Plus,
  Image as ImageIcon,
  Film,
  Archive,
  Tag,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  Wand2,
  ExternalLink,
  CheckSquare,
  Square,
  Send,
  ArrowDownCircle,
  Globe,
  User,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import {
  fetchTemplates,
  createIngestJob,
  getIngestJobStatus,
  deleteTemplate,
  batchDeleteTemplates,
  renderTemplate,
  replicateTransitionTemplate,
  uploadTemplateSourceFile,
  publishTemplate,
  unpublishTemplate,
  batchPublishTemplates,
  type TemplateApiItem,
  type TemplateIngestJob,
  type TemplatePromptPolicy,
} from '@/lib/api/templates';
import { TemplatePublishPanel } from './TemplatePublishPanel';
import { DigitalAvatarManager } from './DigitalAvatarManager';
import { QualityReferenceManager } from './QualityReferenceManager';
import { PromptLibraryManager } from './PromptLibraryManager';
import { taskApi } from '@/lib/api/tasks';
import {
  fetchModelCatalog,
  checkCompatibility,
  flattenModels,
  type ModelCatalog,
  type ModelOption,
  type ParamSpec,
} from '@/lib/api/models';

// ==================== 调试开关 ====================
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[PlatformMaterials]', ...args); };

// ==================== 类型定义 ====================

interface IngestTask {
  jobId: string;
  status: TemplateIngestJob['status'];
  progress: number;
  sourceUrl: string;
  error?: string;
  result?: TemplateIngestJob['result'];
}

interface TemplateRenderTask {
  id: string;
  templateId: string;
  templateName: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  taskId?: string;
  endpoint?: string;
  resultUrl?: string;
  prompt?: string;
  error?: string;
  createdAt: number;
}



// ==================== 辅助函数 ====================

function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(' ');
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ==================== 上传弹窗组件 ====================

type MaterialSourceType = 'video' | 'image' | 'zip';
type UploadSourceMode = 'url' | 'file';

interface UploadSubmitData {
  uploadMode: UploadSourceMode;
  sourceUrl: string;
  localFile?: File;
  sourceType: MaterialSourceType;
  tags: string[];
}

type ApplyMode = 'single' | 'transition';
type TransitionInputMode = 'image_pair' | 'template_pair';
type TransitionFocusMode = 'outfit_change' | 'subject_preserve' | 'scene_shift';
type TransitionGoldenPreset = 'spin_occlusion_outfit' | 'whip_pan_outfit' | 'space_warp_outfit';

const DEFAULT_NEGATIVE_PROMPT =
  'blurry, distorted, low quality, watermark, text overlay, extra limbs, deformed face, artifacts, flickering';

const PROMPT_POLICY_OPTIONS: Array<{ value: TemplatePromptPolicy; label: string; desc: string }> = [
  { value: 'auto_only', label: '仅自动合成', desc: '只使用系统自动合成 Prompt（最稳定）' },
  { value: 'auto_plus_default', label: '自动 + 模板预设', desc: '使用系统 Prompt + 模板预设，不叠加用户输入' },
  { value: 'auto_plus_default_plus_user', label: '自动 + 预设 + 用户增强', desc: '允许在模板预设基础上追加你的自定义描述' },
];

interface ApplyTemplatePayload {
  mode: ApplyMode;
  transitionInputMode?: TransitionInputMode;
  fromTemplateId?: string;
  toTemplateId?: string;
  fromImageUrl?: string;
  toImageUrl?: string;
  fromImageFile?: File;
  toImageFile?: File;
  focusModes?: TransitionFocusMode[];
  goldenPreset?: TransitionGoldenPreset;
  variantCount?: number;
  boundaryMs: number;
  // ── 多模型支持 ──
  selectedProvider?: string;
  selectedEndpoint?: string;
  selectedModel?: string;
  modelParams?: Record<string, unknown>;
  prompt?: string;
  negativePrompt?: string;
  promptPolicy?: TemplatePromptPolicy;
  allowPromptOverride?: boolean;
}

const SOURCE_TYPE_ACCEPT: Record<MaterialSourceType, string> = {
  image: 'image/*,.jpg,.jpeg,.png,.webp,.heic,.heif',
  video: 'video/*,.mp4,.mov,.avi,.webm,.m4v',
  zip: '.zip,application/zip,application/x-zip-compressed',
};

function matchesSourceTypeFile(file: File, sourceType: MaterialSourceType): boolean {
  const fileName = (file.name || '').toLowerCase();
  const contentType = (file.type || '').toLowerCase();

  if (sourceType === 'image') {
    return contentType.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic|heif)$/.test(fileName);
  }

  if (sourceType === 'video') {
    return contentType.startsWith('video/') || /\.(mp4|mov|avi|webm|m4v)$/.test(fileName);
  }

  return fileName.endsWith('.zip') || contentType.includes('zip') || contentType === 'application/octet-stream';
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024 * 1024) {
    return (size / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }
  if (size >= 1024 * 1024) {
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }
  return Math.max(1, Math.round(size / 1024)) + " KB";
}

async function resolveApplyImageUrl(inputUrl: string | undefined, localFile: File | undefined, label: string): Promise<string> {
  const trimmed = (inputUrl || '').trim();
  if (trimmed) return trimmed;
  if (!localFile) {
    throw new Error(`请提供${label}图片链接或上传本地文件`);
  }
  const uploaded = await uploadTemplateSourceFile(localFile, 'template-replica-inputs');
  return uploaded.url;
}

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: UploadSubmitData) => void;
  isSubmitting: boolean;
}

function UploadModal({ isOpen, onClose, onSubmit, isSubmitting }: UploadModalProps) {
  const [uploadMode, setUploadMode] = useState<UploadSourceMode>('url');
  const [sourceUrl, setSourceUrl] = useState('');
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<MaterialSourceType>('image');
  const [tagsInput, setTagsInput] = useState('');

  // Reset form on open
  useEffect(() => {
    if (!isOpen) return;
    setUploadMode('url');
    setSourceUrl('');
    setLocalFile(null);
    setFileError(null);
    setSourceType('image');
    setTagsInput('');
  }, [isOpen]);

  useEffect(() => {
    if (!localFile) return;
    if (matchesSourceTypeFile(localFile, sourceType)) {
      setFileError(null);
      return;
    }
    setLocalFile(null);
    setFileError('已选文件与素材类型不匹配，请重新选择。');
  }, [localFile, sourceType]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setLocalFile(null);
      setFileError(null);
      return;
    }

    if (!matchesSourceTypeFile(file, sourceType)) {
      setLocalFile(null);
      setFileError('文件类型不匹配当前素材类型，请调整后重试。');
      return;
    }

    setLocalFile(file);
    setFileError(null);
  };

  const canSubmit = uploadMode === 'url'
    ? Boolean(sourceUrl.trim())
    : Boolean(localFile && !fileError);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const tags = tagsInput
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    onSubmit({
      uploadMode,
      sourceUrl: sourceUrl.trim(),
      localFile: localFile ?? undefined,
      sourceType,
      tags,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">上传平台素材</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* 输入方式 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">输入方式</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setUploadMode('url')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                  uploadMode === 'url'
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                URL 链接
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('file')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                  uploadMode === 'file'
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                本地文件
              </button>
            </div>
          </div>

          {/* 素材来源 */}
          {uploadMode === 'url' ? (
            <div key="url-section">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                素材 URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://example.com/video.mp4"
                className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200"
                required={uploadMode === 'url'}
              />
              <p className="mt-1 text-xs text-gray-400">支持视频、图片或 ZIP 压缩包的公开链接</p>
            </div>
          ) : (
            <div key="file-section">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                本地文件 <span className="text-red-500">*</span>
              </label>
              <input
                id="platform-material-file"
                type="file"
                accept={SOURCE_TYPE_ACCEPT[sourceType]}
                onChange={handleFileSelect}
                className="hidden"
              />
              <label
                htmlFor="platform-material-file"
                className="h-10 px-3 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-gray-400 transition-colors flex items-center justify-center cursor-pointer"
              >
                {localFile ? '重新选择文件' : '点击选择本地文件'}
              </label>
              {localFile && (
                <p className="mt-2 text-xs text-gray-600">
                  已选择：{localFile.name}（{formatFileSize(localFile.size)}）
                </p>
              )}
              <p className="mt-1 text-xs text-gray-400">图片 ≤50MB，视频 ≤500MB，ZIP ≤1GB</p>
              {fileError && <p className="mt-1 text-xs text-red-500">{fileError}</p>}
            </div>
          )}

          {/* 素材类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">素材类型</label>
            <div className="flex gap-2">
              {[
                { value: 'image', label: '图片', icon: ImageIcon },
                { value: 'video', label: '视频', icon: Film },
                { value: 'zip', label: 'ZIP 包', icon: Archive },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSourceType(item.value as MaterialSourceType)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-all text-sm',
                      sourceType === item.value
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    )}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 视频入库参数 — 统一自动分镜检测 */}
          {sourceType === 'video' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                AI 自动分镜检测
              </div>
              <p className="mt-1 text-xs text-gray-500">
                系统会自动分析视频中的场景变化与关键帧，智能识别镜头切换和画面变化，无需手动指定。
              </p>
            </div>
          )}

          {/* 标签 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              标签提示 <span className="text-gray-400 font-normal">(可选)</span>
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="科技, 商务, 简约 (用逗号分隔)"
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200"
            />
          </div>

          {/* 提交按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !canSubmit}
              className="flex-1 h-10 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {uploadMode === 'file' ? '上传并提交中...' : '提交中...'}
                </>
              ) : (
                <>
                  <Upload size={14} />
                  开始入库
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== 任务进度组件 ====================

interface TaskProgressProps {
  tasks: IngestTask[];
  onDismiss: (jobId: string) => void;
}

function TaskProgress({ tasks, onDismiss }: TaskProgressProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
      <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
        <Clock size={14} />
        入库任务进度
      </h4>
      <div className="space-y-3">
        {tasks.map((task) => (
          <div key={task.jobId} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
            {/* 状态图标 */}
            <div className="flex-none">
              {task.status === 'processing' && (
                <Loader2 size={18} className="text-gray-500 animate-spin" />
              )}
              {task.status === 'queued' && (
                <Clock size={18} className="text-gray-400" />
              )}
              {task.status === 'succeeded' && (
                <CheckCircle size={18} className="text-gray-500" />
              )}
              {task.status === 'failed' && (
                <AlertCircle size={18} className="text-red-500" />
              )}
            </div>

            {/* 信息 */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700 truncate">{task.sourceUrl}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-400">自动分镜</span>
                {task.status === 'processing' && (
                  <span className="text-xs text-gray-500">{Math.round(task.progress * 100)}%</span>
                )}
                {task.status === 'failed' && task.error && (
                  <span className="text-xs text-red-500">{task.error}</span>
                )}
                {task.status === 'succeeded' && task.result?.templates && (
                  <>
                    <span className="text-xs text-gray-600">
                      {task.result.pack_id
                        ? `模板包 ${task.result.pack_id} · 检测 ${task.result.detected_segments ?? task.result.templates.length} 段，已发布 ${task.result.published_templates ?? task.result.templates.length} 个模板`
                        : `已生成 ${task.result.templates.length} 个模板`}
                    </span>
                    {task.result.detection_debug?.selected_peak_count !== undefined && (
                      <span className="text-xs text-gray-500">
                        峰值 {task.result.detection_debug.selected_peak_count} · 阈值 {task.result.detection_debug.peak_threshold ?? '-'} · 窗口 {task.result.detection_debug.transition_duration_ms ?? '-'}ms
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 进度条 */}
            {(task.status === 'processing' || task.status === 'queued') && (
              <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gray-500 transition-all duration-300"
                  style={{ width: `${task.progress * 100}%` }}
                />
              </div>
            )}

            {/* 关闭按钮（仅完成或失败时） */}
            {(task.status === 'succeeded' || task.status === 'failed') && (
              <button
                onClick={() => onDismiss(task.jobId)}
                className="p-1 hover:bg-gray-200 rounded transition-colors"
              >
                <X size={14} className="text-gray-400" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== 渲染任务进度组件 ====================

interface RenderTaskProgressProps {
  tasks: TemplateRenderTask[];
  onDismiss: (taskId: string) => void;
}

function RenderTaskProgress({ tasks, onDismiss }: RenderTaskProgressProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
      <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
        <Wand2 size={14} />
        模板生成任务
      </h4>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
            <div className="flex-none">
              {task.status === 'failed' ? (
                <AlertCircle size={16} className="text-red-500" />
              ) : task.status === 'succeeded' ? (
                <CheckCircle size={16} className="text-gray-500" />
              ) : (
                <Loader2 size={16} className="text-gray-500 animate-spin" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700 truncate">{task.templateName}</p>
              <p className={cn(
                'text-xs mt-0.5',
                task.status === 'failed' ? 'text-red-500' : 
                task.status === 'succeeded' ? 'text-gray-600' : 'text-gray-500'
              )}>
                {task.status === 'pending' && '准备中...'}
                {task.status === 'processing' && (
                  <>
                    生成中
                    {task.taskId && <span className="text-gray-400"> · {task.taskId.slice(0, 8)}...</span>}
                  </>
                )}
                {task.status === 'succeeded' && '生成完成'}
                {task.status === 'failed' && (task.error || '生成失败')}
              </p>
              {task.prompt && (
                <p className="text-[11px] mt-1 text-gray-500 break-all">
                  Prompt: {task.prompt}
                </p>
              )}
            </div>
            {task.resultUrl && (
              <a
                href={task.resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                title="查看结果"
              >
                <ExternalLink size={14} className="text-gray-500" />
              </a>
            )}
            <button
              onClick={() => onDismiss(task.id)}
              className="p-1 hover:bg-gray-200 rounded transition-colors"
            >
              <X size={14} className="text-gray-400" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ApplyTemplateModalProps {
  template: TemplateApiItem | null;
  templates: TemplateApiItem[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (payload: ApplyTemplatePayload) => void;
}

function ApplyTemplateModal({ template, templates, isSubmitting, onClose, onSubmit }: ApplyTemplateModalProps) {
  const [mode, setMode] = useState<ApplyMode>('transition');
  const [transitionInputMode, setTransitionInputMode] = useState<TransitionInputMode>('image_pair');
  const [fromTemplateId, setFromTemplateId] = useState<string>('');
  const [toTemplateId, setToTemplateId] = useState<string>('');
  const [fromImageUrl, setFromImageUrl] = useState<string>('');
  const [toImageUrl, setToImageUrl] = useState<string>('');
  const [fromImageFile, setFromImageFile] = useState<File | null>(null);
  const [toImageFile, setToImageFile] = useState<File | null>(null);
  // template_pair 模式下 A/B 各自的本地文件
  const [fromTemplateFile, setFromTemplateFile] = useState<File | null>(null);
  const [toTemplateFile, setToTemplateFile] = useState<File | null>(null);
  const fromTemplateFileRef = useRef<HTMLInputElement>(null);
  const toTemplateFileRef = useRef<HTMLInputElement>(null);
  const [focusModes, setFocusModes] = useState<TransitionFocusMode[]>(['outfit_change']);
  const [goldenPreset, setGoldenPreset] = useState<TransitionGoldenPreset>('spin_occlusion_outfit');
  const [variantCount, setVariantCount] = useState<number>(1);
  const [boundaryMs, setBoundaryMs] = useState<number>(1200);
  const [defaultPromptPreset, setDefaultPromptPreset] = useState<string>('');
  const [defaultNegativePromptPreset, setDefaultNegativePromptPreset] = useState<string>(DEFAULT_NEGATIVE_PROMPT);
  const [promptPolicy, setPromptPolicy] = useState<TemplatePromptPolicy>('auto_plus_default_plus_user');
  const [allowPromptOverride, setAllowPromptOverride] = useState<boolean>(true);
  const [promptInput, setPromptInput] = useState<string>('');
  const [negativePromptInput, setNegativePromptInput] = useState<string>(DEFAULT_NEGATIVE_PROMPT);

  // ── 多模型选择状态 ──
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const [modelParams, setModelParams] = useState<Record<string, unknown>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const stripPromptParams = useCallback((params: Record<string, unknown>) => {
    const sanitized = { ...params };
    delete sanitized.prompt;
    delete sanitized.negative_prompt;
    return sanitized;
  }, []);

  useEffect(() => {
    if (!template) return;
    const others = templates.filter((item) => item.id !== template.id);
    const fromId = template.id;
    const toId = others[0]?.id || '';
    setMode('transition');
    setTransitionInputMode('image_pair');
    setFromTemplateId(fromId);
    setToTemplateId(toId);
    setFromImageUrl('');
    setToImageUrl('');
    setFromImageFile(null);
    setToImageFile(null);
    setFromTemplateFile(null);
    setToTemplateFile(null);

    const pc = template.publish_config || {};

    const pcFocus = pc.default_focus_modes as string[] | undefined;
    if (pcFocus && pcFocus.length > 0) {
      setFocusModes(pcFocus.filter((m): m is TransitionFocusMode =>
        ['outfit_change', 'subject_preserve', 'scene_shift'].includes(m)
      ));
    } else {
      setFocusModes(['outfit_change']);
    }

    const pcPreset = pc.default_golden_preset as string | undefined;
    if (pcPreset && ['spin_occlusion_outfit', 'whip_pan_outfit', 'space_warp_outfit'].includes(pcPreset)) {
      setGoldenPreset(pcPreset as TransitionGoldenPreset);
    } else {
      setGoldenPreset('spin_occlusion_outfit');
    }

    setVariantCount(typeof pc.default_variant_count === 'number' ? pc.default_variant_count : 1);
    setBoundaryMs(typeof pc.default_boundary_ms === 'number' ? pc.default_boundary_ms : 1200);

    const parsedPolicy = (pc.prompt_policy as TemplatePromptPolicy) || 'auto_plus_default_plus_user';
    if (['auto_only', 'auto_plus_default', 'auto_plus_default_plus_user'].includes(parsedPolicy)) {
      setPromptPolicy(parsedPolicy);
    } else {
      setPromptPolicy('auto_plus_default_plus_user');
    }

    const allowOverride = pc.allow_prompt_override !== false;
    setAllowPromptOverride(allowOverride);

    const isTransitionTemplate = template.type === 'transition';

    const promptPreset =
      (typeof pc.default_prompt === 'string' && pc.default_prompt.trim())
      // 转场模板：不用 recommended_prompt 做预设（那是模板源视频的内容描述，会污染渲染）
      || (!isTransitionTemplate ? (template.transition_spec?.recommended_prompt?.trim() || '') : '');
    setDefaultPromptPreset(promptPreset);
    // 转场模板：prompt 留空，让用户可选填自己的描述；非转场模板：保持原有预填行为
    setPromptInput(isTransitionTemplate ? '' : promptPreset);

    const negativePreset =
      (typeof pc.default_negative_prompt === 'string' && pc.default_negative_prompt.trim())
      || DEFAULT_NEGATIVE_PROMPT;
    setDefaultNegativePromptPreset(negativePreset);
    setNegativePromptInput(negativePreset);
  }, [template, templates]);

  // ── 加载模型目录 + 兼容性检查 ──
  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    setCatalogLoading(true);

    (async () => {
      try {
        // 判断模板需要的能力
        const isTransition = template.type === 'transition';
        const requiredCaps = isTransition ? ['image_tail'] : ['single_image'];

        const [catalog, compat] = await Promise.all([
          fetchModelCatalog(),
          checkCompatibility(requiredCaps),
        ]);

        if (cancelled) return;
        setModelCatalog(catalog);

        // 转场模板主要走 image_to_video（image_tail），非转场走 image_to_video 或 text_to_video
        const endpointFilter = isTransition ? 'image_to_video' : undefined;
        const options = flattenModels(catalog, compat, endpointFilter);
        setModelOptions(options);

        // 默认选第一个兼容且 active 的
        const defaultOpt = options.find(o => o.compatible && o.status === 'active')
          || options.find(o => o.compatible)
          || options[0];
        if (defaultOpt) {
          setSelectedModelKey(defaultOpt.key);
          setModelParams(stripPromptParams(defaultOpt.defaults));
        }
      } catch (err) {
        debugLog('Failed to load model catalog:', err);
        // 降级：不影响原有流程
        setModelOptions([]);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [template]);

  // 选中模型变更时，重新填充默认值
  const handleModelChange = useCallback((key: string) => {
    setSelectedModelKey(key);
    const opt = modelOptions.find(o => o.key === key);
    if (opt) {
      setModelParams(stripPromptParams(opt.defaults));
    }
  }, [modelOptions]);

  // 更新单个模型参数
  const updateModelParam = useCallback((name: string, value: unknown) => {
    setModelParams(prev => ({ ...prev, [name]: value }));
  }, []);

  const selectedModelOpt = modelOptions.find(o => o.key === selectedModelKey);

  if (!template) return null;

  const hasPublishConfig = Boolean(template.publish_config && Object.keys(template.publish_config).length > 0);

  // A/B 候选列表包含所有模板（包括当前模板）
  const candidates = templates;
  const hasFromImage = Boolean(fromImageUrl.trim() || fromImageFile);
  const hasToImage = Boolean(toImageUrl.trim() || toImageFile);
  const hasFromTemplate = Boolean(fromTemplateId || fromTemplateFile);
  const hasToTemplate = Boolean(toTemplateId || toTemplateFile);
  const canSubmit = mode === 'single'
    ? true
    : transitionInputMode === 'template_pair'
      ? Boolean(hasFromTemplate && hasToTemplate && !(fromTemplateId && toTemplateId && fromTemplateId === toTemplateId))
      : Boolean(hasFromImage && hasToImage);

  const resolvePromptValue = (): string | undefined => {
    const defaultPrompt = defaultPromptPreset.trim();
    const userPrompt = promptInput.trim();

    if (promptPolicy === 'auto_only') {
      return undefined;
    }
    if (promptPolicy === 'auto_plus_default') {
      return defaultPrompt || undefined;
    }
    if (!allowPromptOverride) {
      return defaultPrompt || undefined;
    }
    return userPrompt || defaultPrompt || undefined;
  };

  const resolveNegativePromptValue = (): string | undefined => {
    const defaultNegative = defaultNegativePromptPreset.trim();
    const userNegative = negativePromptInput.trim();
    if (!allowPromptOverride) {
      return defaultNegative || undefined;
    }
    return userNegative || defaultNegative || undefined;
  };

  const effectivePrompt = resolvePromptValue();
  const effectiveNegativePrompt = resolveNegativePromptValue();
  const promptInputDisabled = promptPolicy !== 'auto_plus_default_plus_user' || !allowPromptOverride;
  const negativePromptInputDisabled = !allowPromptOverride;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isSubmitting) return;

    // template_pair 模式混合场景：一边选模板，一边上传文件
    // 需要把模板侧的 thumbnail_url 传给 fromImageUrl/toImageUrl
    const resolveTemplatePairImageUrl = (side: 'from' | 'to'): string | undefined => {
      if (transitionInputMode !== 'template_pair') return undefined;
      const file = side === 'from' ? fromTemplateFile : toTemplateFile;
      const tid = side === 'from' ? fromTemplateId : toTemplateId;
      if (file) return undefined; // 有文件走 file 通道
      if (tid) {
        const tpl = candidates.find(c => c.id === tid);
        return tpl?.thumbnail_url || tpl?.url || undefined;
      }
      return undefined;
    };

    onSubmit({
      mode,
      transitionInputMode: mode === 'transition' ? transitionInputMode : undefined,
      fromTemplateId: mode === 'transition' && transitionInputMode === 'template_pair' && !fromTemplateFile ? fromTemplateId : undefined,
      toTemplateId: mode === 'transition' && transitionInputMode === 'template_pair' && !toTemplateFile ? toTemplateId : undefined,
      fromImageUrl: mode === 'transition' ? (transitionInputMode === 'image_pair' ? fromImageUrl : resolveTemplatePairImageUrl('from')) : undefined,
      toImageUrl: mode === 'transition' ? (transitionInputMode === 'image_pair' ? toImageUrl : resolveTemplatePairImageUrl('to')) : undefined,
      fromImageFile: mode === 'transition' ? (transitionInputMode === 'image_pair' ? (fromImageFile || undefined) : (fromTemplateFile || undefined)) : undefined,
      toImageFile: mode === 'transition' ? (transitionInputMode === 'image_pair' ? (toImageFile || undefined) : (toTemplateFile || undefined)) : undefined,
      focusModes: mode === 'transition' ? focusModes : undefined,
      goldenPreset: mode === 'transition' ? goldenPreset : undefined,
      variantCount: mode === 'transition' ? variantCount : undefined,
      boundaryMs,
      // 多模型参数
      selectedProvider: selectedModelOpt?.provider,
      selectedEndpoint: selectedModelOpt?.endpoint,
      selectedModel: selectedModelOpt?.modelName,
      modelParams: selectedModelOpt ? modelParams : undefined,
      prompt: effectivePrompt,
      negativePrompt: effectiveNegativePrompt,
      promptPolicy,
      allowPromptOverride,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">使用模板</h3>
            <p className="text-xs text-gray-500 mt-1">
              当前模板：{template.publish_config?.display_name || template.name}
              {template.publish_config?.description && (
                <span className="ml-1 text-gray-400">— {template.publish_config.description}</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* 效果预览视频 */}
          {template.preview_video_url && (
            <div className="px-6 pt-4">
              <div className="rounded-xl overflow-hidden bg-black aspect-video relative">
                <video
                  src={template.preview_video_url}
                  controls
                  muted
                  loop
                  playsInline
                  className="w-full h-full object-contain"
                  poster={template.thumbnail_url}
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5 text-center">管理员精选效果预览</p>
            </div>
          )}

          {/* 推荐配置提示 */}
          {hasPublishConfig && (
            <div className="mx-6 mt-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 flex items-center gap-1.5">
              <CheckCircle size={12} />
              参数已按管理员推荐配置预填，可直接使用或自行微调
            </div>
          )}

          <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* ── 模型选择 ── */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">生成模型</label>
            {catalogLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <Loader2 size={12} className="animate-spin" />
                加载模型目录...
              </div>
            ) : modelOptions.length > 0 ? (
              <>
                <select
                  value={selectedModelKey}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400"
                >
                  {modelOptions.map((opt) => (
                    <option key={opt.key} value={opt.key} disabled={!opt.compatible}>
                      {opt.providerDisplay} — {opt.modelName}
                      {opt.status === 'beta' ? ' (Beta)' : opt.status === 'planned' ? ' (即将)' : ''}
                      {!opt.compatible ? ` [不支持: ${opt.missingCapabilities.join(', ')}]` : ''}
                    </option>
                  ))}
                </select>
                {selectedModelOpt?.notes && (
                  <p className="mt-1 text-[10px] text-gray-400">{selectedModelOpt.notes}</p>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400">默认使用 Kling</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">应用方式</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('transition')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                  mode === 'transition'
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                A-&gt;B 转场复刻
              </button>
              <button
                type="button"
                onClick={() => setMode('single')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                  mode === 'single'
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                单镜头生成
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-400">复刻模式支持直接上传首尾两张图，一键生成多个候选结果。</p>
          </div>

          {mode === 'transition' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">输入来源</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTransitionInputMode('image_pair')}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                      transitionInputMode === 'image_pair'
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    )}
                  >
                    上传首尾两图
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransitionInputMode('template_pair')}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                      transitionInputMode === 'template_pair'
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    )}
                  >
                    选择模板 A/B
                  </button>
                </div>
              </div>

              {transitionInputMode === 'image_pair' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">首帧（A）图片 URL（可选）</label>
                    <input
                      value={fromImageUrl}
                      onChange={(e) => setFromImageUrl(e.target.value)}
                      placeholder="https://.../from.jpg"
                      className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400"
                    />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setFromImageFile(e.target.files?.[0] || null)}
                      className="mt-2 w-full text-xs text-gray-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">尾帧（B）图片 URL（可选）</label>
                    <input
                      value={toImageUrl}
                      onChange={(e) => setToImageUrl(e.target.value)}
                      placeholder="https://.../to.jpg"
                      className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400"
                    />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setToImageFile(e.target.files?.[0] || null)}
                      className="mt-2 w-full text-xs text-gray-600"
                    />
                  </div>

                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">前镜头（A）</label>
                    <select
                      value={fromTemplateFile ? '__local__' : fromTemplateId}
                      onChange={(e) => {
                        if (e.target.value === '__upload__') {
                          fromTemplateFileRef.current?.click();
                          return;
                        }
                        setFromTemplateId(e.target.value);
                        setFromTemplateFile(null);
                      }}
                      className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400"
                    >
                      <option value="">请选择前镜头模板</option>
                      {candidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                      <option value="__upload__">📁 上传本地文件…</option>
                      {fromTemplateFile && <option value="__local__">📎 {fromTemplateFile.name}</option>}
                    </select>
                    <input
                      ref={fromTemplateFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setFromTemplateFile(f);
                          setFromTemplateId('');
                        }
                        e.target.value = '';
                      }}
                    />
                    {fromTemplateFile && (
                      <div className="mt-2 flex items-center gap-2">
                        <img
                          src={URL.createObjectURL(fromTemplateFile)}
                          alt="前镜头预览"
                          className="w-20 h-14 object-cover rounded border border-gray-200"
                          onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                        />
                        <span className="text-xs text-gray-500 truncate flex-1">{fromTemplateFile.name}</span>
                        <button
                          type="button"
                          onClick={() => setFromTemplateFile(null)}
                          className="p-0.5 text-gray-400 hover:text-red-500"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">后镜头（B）</label>
                    <select
                      value={toTemplateFile ? '__local__' : toTemplateId}
                      onChange={(e) => {
                        if (e.target.value === '__upload__') {
                          toTemplateFileRef.current?.click();
                          return;
                        }
                        setToTemplateId(e.target.value);
                        setToTemplateFile(null);
                      }}
                      className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400"
                    >
                      <option value="">请选择后镜头模板</option>
                      {candidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                      <option value="__upload__">📁 上传本地文件…</option>
                      {toTemplateFile && <option value="__local__">📎 {toTemplateFile.name}</option>}
                    </select>
                    <input
                      ref={toTemplateFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setToTemplateFile(f);
                          setToTemplateId('');
                        }
                        e.target.value = '';
                      }}
                    />
                    {toTemplateFile && (
                      <div className="mt-2 flex items-center gap-2">
                        <img
                          src={URL.createObjectURL(toTemplateFile)}
                          alt="后镜头预览"
                          className="w-20 h-14 object-cover rounded border border-gray-200"
                          onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                        />
                        <span className="text-xs text-gray-500 truncate flex-1">{toTemplateFile.name}</span>
                        <button
                          type="button"
                          onClick={() => setToTemplateFile(null)}
                          className="p-0.5 text-gray-400 hover:text-red-500"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">复刻重点（可多选）</label>
                <div className="flex flex-wrap gap-2">
                  {([
                    { value: 'outfit_change' as TransitionFocusMode, label: '服装变装' },
                    { value: 'subject_preserve' as TransitionFocusMode, label: '人物一致' },
                    { value: 'scene_shift' as TransitionFocusMode, label: '场景切换' },
                  ]).map(({ value, label }) => {
                    const checked = focusModes.includes(value);
                    return (
                      <label
                        key={value}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                          checked
                            ? 'bg-gray-100 border-gray-400 text-gray-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              // 至少保留一个
                              if (focusModes.length > 1) {
                                setFocusModes(focusModes.filter(m => m !== value));
                              }
                            } else {
                              setFocusModes([...focusModes, value]);
                            }
                          }}
                        />
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                          checked ? 'bg-gray-800 border-gray-800' : 'border-gray-300'
                        }`}>
                          {checked && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">黄金转场模版</label>
                <select
                  value={goldenPreset}
                  onChange={(e) => setGoldenPreset(e.target.value as TransitionGoldenPreset)}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400"
                >
                  <option value="spin_occlusion_outfit">旋转遮挡（推荐）</option>
                  <option value="whip_pan_outfit">快甩变装</option>
                  <option value="space_warp_outfit">空间穿梭</option>
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  会写入导演级 prompt（含遮挡缓冲、运镜逻辑、A/B 场景差异）。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">生成数量</label>
                <select
                  value={variantCount}
                  onChange={(e) => setVariantCount(Number(e.target.value))}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400"
                >
                  <option value={1}>1 次（均衡模式）</option>
                  <option value={2}>2 次（精准 vs 创意对比）</option>
                  <option value={3}>3 次（全参数对比）</option>
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  多次生成会以不同 cfg_scale 参数对比效果，编舞脚本保持一致
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">转场时长: {boundaryMs}ms</label>
                <input
                  type="range"
                  min={200}
                  max={1200}
                  step={20}
                  value={boundaryMs}
                  onChange={(e) => setBoundaryMs(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-900"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>200ms</span>
                  <span>1200ms</span>
                </div>
              </div>
            </>
          )}

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Prompt 策略</label>
              <label className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                <input
                  type="checkbox"
                  checked={allowPromptOverride}
                  onChange={(e) => setAllowPromptOverride(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                />
                允许用户覆盖
              </label>
            </div>
            <select
              value={promptPolicy}
              onChange={(e) => setPromptPolicy(e.target.value as TemplatePromptPolicy)}
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400"
            >
              {PROMPT_POLICY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400">{PROMPT_POLICY_OPTIONS.find((opt) => opt.value === promptPolicy)?.desc}</p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Prompt
                {template.type === 'transition' && (
                  <span className="ml-1 text-[10px] text-gray-400 font-normal">（可选，转场由编舞脚本驱动，留空即可）</span>
                )}
              </label>
              <textarea
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                disabled={promptInputDisabled}
                rows={3}
                placeholder={template.type === 'transition'
                  ? '可选：描述你的画面风格，如 cyberpunk neon style。留空则纯用编舞脚本驱动'
                  : '不输入则使用模板预设；若模板无预设则走系统自动合成'
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400 disabled:bg-gray-50 resize-none"
              />
              {promptInputDisabled && (
                <p className="mt-1 text-[11px] text-gray-500">
                  {promptPolicy === 'auto_plus_default_plus_user'
                    ? '当前关闭覆盖，Prompt 已锁定为模板预设/自动策略'
                    : '当前策略不使用用户 Prompt 输入'}
                </p>
              )}
              {defaultPromptPreset.trim() && (
                <p className="mt-1 text-[11px] text-gray-400">模板预设：{defaultPromptPreset.slice(0, 120)}{defaultPromptPreset.length > 120 ? '...' : ''}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">反向提示词</label>
              <textarea
                value={negativePromptInput}
                onChange={(e) => setNegativePromptInput(e.target.value)}
                disabled={negativePromptInputDisabled}
                rows={2}
                placeholder={DEFAULT_NEGATIVE_PROMPT}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-gray-400 disabled:bg-gray-50 resize-none"
              />
              {negativePromptInputDisabled && (
                <p className="mt-1 text-[11px] text-gray-500">当前关闭覆盖，反向提示词将使用模板预设</p>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600 space-y-1">
              <p>最终 Prompt：{effectivePrompt || '（空，使用系统自动合成）'}</p>
              <p>最终反向 Prompt：{effectiveNegativePrompt || '（空，使用模型默认）'}</p>
            </div>
          </div>

          {/* ── 模型参数（动态渲染） ── */}
          {selectedModelOpt && selectedModelOpt.params.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
                模型参数
                <span className="text-xs text-gray-400 font-normal">
                  ({selectedModelOpt.providerDisplay} · {selectedModelOpt.params.filter(p => p.ui_hint !== 'hidden' && p.name !== 'prompt' && p.name !== 'negative_prompt').length} 项，已预填默认值)
                </span>
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3">
                  {selectedModelOpt.params
                    .filter(p => p.ui_hint !== 'hidden' && p.name !== 'prompt' && p.name !== 'negative_prompt')
                    .map((param) => {
                      const value = modelParams[param.name] ?? param.default;
                      const isLocked = param.locked_when?.some(cond =>
                        modelParams[cond] !== undefined && modelParams[cond] !== null
                      );

                      return (
                        <div key={param.name} className={isLocked ? 'opacity-50' : ''}>
                          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                            {param.label_zh || param.name}
                            {param.group === 'advanced' && (
                              <span className="px-1 py-0.5 bg-gray-100 text-[10px] text-gray-400 rounded">高级</span>
                            )}
                            {isLocked && (
                              <span className="text-[10px] text-gray-500">🔒 锁定</span>
                            )}
                          </label>

                          {/* select */}
                          {param.ui_hint === 'select' && param.options && (
                            <select
                              value={String(value ?? '')}
                              onChange={(e) => updateModelParam(param.name, e.target.value)}
                              disabled={isLocked}
                              className="w-full h-9 px-2.5 border border-gray-200 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-gray-400 disabled:bg-gray-50"
                            >
                              {param.options.map((opt) => (
                                <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
                              ))}
                            </select>
                          )}

                          {/* slider */}
                          {param.ui_hint === 'slider' && (
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min={Number(param.constraints?.min ?? 0)}
                                max={Number(param.constraints?.max ?? 1)}
                                step={Number(param.constraints?.step ?? 0.01)}
                                value={Number(value ?? param.default ?? 0)}
                                onChange={(e) => updateModelParam(param.name, Number(e.target.value))}
                                disabled={isLocked}
                                className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-700 disabled:accent-gray-300"
                              />
                              <span className="text-xs text-gray-500 w-10 text-right tabular-nums">
                                {typeof value === 'number' ? value.toFixed(2) : String(value ?? '')}
                              </span>
                            </div>
                          )}

                          {/* textarea (prompt) */}
                          {param.ui_hint === 'textarea' && (
                            <textarea
                              value={String(value ?? '')}
                              onChange={(e) => updateModelParam(param.name, e.target.value)}
                              disabled={isLocked}
                              rows={2}
                              placeholder={param.desc_zh}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-gray-400 disabled:bg-gray-50 resize-none"
                            />
                          )}

                          {/* text */}
                          {param.ui_hint === 'text' && (
                            <input
                              value={String(value ?? '')}
                              onChange={(e) => updateModelParam(param.name, e.target.value)}
                              disabled={isLocked}
                              placeholder={param.desc_zh}
                              className="w-full h-9 px-2.5 border border-gray-200 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-gray-400 disabled:bg-gray-50"
                            />
                          )}

                          {/* toggle */}
                          {param.ui_hint === 'toggle' && (
                            <button
                              type="button"
                              onClick={() => updateModelParam(param.name, !value)}
                              disabled={isLocked}
                              className={`relative w-10 h-5 rounded-full transition-colors ${
                                value ? 'bg-gray-700' : 'bg-gray-200'
                              } disabled:opacity-50`}
                            >
                              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                value ? 'translate-x-5' : 'translate-x-0.5'
                              }`} />
                            </button>
                          )}

                          {param.desc_zh && (
                            <p className="mt-0.5 text-[10px] text-gray-400">{param.desc_zh}</p>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit || isSubmitting}
              className="flex-1 h-10 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Wand2 size={14} />
                  创建任务
                </>
              )}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}

// ==================== 配方摘要组件 ====================

const GOLDEN_PROFILE_NAMES: Record<string, string> = {
  spin_occlusion_outfit: '旋转遮挡换装',
  whip_pan_outfit: '快甩变装',
  space_warp_outfit: '空间扭曲换装',
  scene_shift_cinematic: '电影感场景切换',
};

interface RecipeDigestBadgesProps {
  digest: NonNullable<TemplateApiItem['recipe_digest']>;
  transitionSpec?: TemplateApiItem['transition_spec'];
}

function RecipeDigestBadges({ digest, transitionSpec }: RecipeDigestBadgesProps) {
  const analysis = digest.analysis_summary;
  const match = digest.golden_match;
  const prov = digest.provenance;

  // 就绪指示器
  const readinessConfig = {
    ready: { color: 'bg-gray-500', text: '就绪', title: '已分析 + 已配置，可发布' },
    partial: { color: 'bg-gray-400', text: '部分', title: '已分析但配置不完整' },
    pending: { color: 'bg-gray-300', text: '待分析', title: '尚未提取指纹分析' },
  };
  const readiness = readinessConfig[digest.readiness];

  return (
    <div className="mt-2 space-y-1.5">
      {/* 就绪状态 + 分析标签 */}
      <div className="flex flex-wrap items-center gap-1">
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold text-white rounded-full ${readiness.color}`} title={readiness.title}>
          <span className="w-1 h-1 rounded-full bg-white/80" />
          {readiness.text}
        </span>
        {analysis?.family && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-full">
            {analysis.family}
          </span>
        )}
        {analysis?.camera_movement && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-full">
            {analysis.camera_movement}
          </span>
        )}
        {analysis?.duration_ms && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded-full">
            {analysis.duration_ms}ms
          </span>
        )}
      </div>

      {/* 多维度评分迷你条 */}
      {digest.dimension_scores && (
        <div className="flex items-center gap-1.5 px-1">
          {(['outfit_change', 'subject_preserve', 'scene_shift'] as const).map((dim) => {
            const score = (digest.dimension_scores as Record<string, number>)?.[dim] ?? 0;
            const labels: Record<string, string> = { outfit_change: '换装', subject_preserve: '人物', scene_shift: '场景' };
            const colors: Record<string, string> = { outfit_change: 'bg-gray-400', subject_preserve: 'bg-gray-400', scene_shift: 'bg-gray-400' };
            const isActive = (digest.recommended_focus_modes || []).includes(dim);
            return (
              <div key={dim} className="flex items-center gap-0.5" title={`${labels[dim]}: ${(score * 100).toFixed(0)}%${isActive ? ' (推荐)' : ''}`}>
                <span className={`text-[8px] ${isActive ? 'text-gray-600 font-semibold' : 'text-gray-400'}`}>{labels[dim]}</span>
                <div className="w-8 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${colors[dim]} ${score < 0.5 ? 'opacity-40' : ''}`} style={{ width: `${Math.round(score * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 匹配的 Golden Profile */}
      {match && (
        <div
          className={cn(
            'flex items-center justify-between px-2 py-1 rounded-md text-[10px]',
            match.match_level === 'high' ? 'bg-gray-50 text-gray-700' :
            match.match_level === 'medium' ? 'bg-gray-100 text-gray-700' :
            'bg-gray-50 text-gray-500'
          )}
          title={`匹配 ${match.profile_name}，得分 ${(match.score * 100).toFixed(0)}%`}
        >
          <span className="font-medium truncate">
            🧬 {GOLDEN_PROFILE_NAMES[match.profile_name] || match.profile_name}
          </span>
          <span className={cn(
            'font-bold ml-1.5 flex-shrink-0',
            match.match_level === 'high' ? 'text-gray-600' :
            match.match_level === 'medium' ? 'text-gray-600' :
            'text-gray-400'
          )}>
            {(match.score * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {/* 参数溯源简要 */}
      {prov && (prov.auto_filled_keys?.length || prov.admin_overrides?.length) ? (
        <div className="flex items-center gap-1.5 text-[9px] text-gray-400">
          {prov.auto_filled_keys && prov.auto_filled_keys.length > 0 && (
            <span className="inline-flex items-center gap-0.5" title={`AI 自动填充: ${prov.auto_filled_keys.join(', ')}`}>
              <span className="text-gray-400">⚡</span>
              自动×{prov.auto_filled_keys.length}
            </span>
          )}
          {prov.admin_overrides && prov.admin_overrides.length > 0 && (
            <span className="inline-flex items-center gap-0.5" title={`管理员覆盖: ${prov.admin_overrides.join(', ')}`}>
              <span className="text-gray-400">✏️</span>
              手动×{prov.admin_overrides.length}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ==================== 素材卡片组件 ====================

interface MaterialCardProps {
  template: TemplateApiItem;
  onDelete: () => void;
  onPreview: () => void;
  onUse: () => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
  onOpenPublishPanel?: () => void;
  using: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}

function MaterialCard({ template, onDelete, onPreview, onUse, onPublish, onUnpublish, onOpenPublishPanel, using, selectionMode, selected, onToggleSelect }: MaterialCardProps) {
  const isDraft = template.status === 'draft';
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasPreviewVideo = Boolean(template.preview_video_url);

  const handleMouseEnter = () => {
    if (hasPreviewVideo && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  };
  const handleMouseLeave = () => {
    if (hasPreviewVideo && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const qualityBadge = template.quality_label && template.quality_label !== 'average' ? (
    template.quality_label === 'golden' ? { text: '🏆', cls: 'bg-gray-700' } :
    template.quality_label === 'good' ? { text: '✅', cls: 'bg-gray-500' } :
    template.quality_label === 'poor' ? { text: '❌', cls: 'bg-red-500' } : null
  ) : null;

  return (
    <div 
      className={cn(
        "group relative bg-white border rounded-xl hover:shadow-sm transition-all flex flex-col",
        selected ? "border-gray-800 ring-2 ring-gray-200" : "border-gray-200 hover:border-gray-300"
      )}
      onClick={selectionMode ? onToggleSelect : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 选择复选框 */}
      {selectionMode && (
        <div 
          className="absolute top-2 left-2 z-10"
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
        >
          {selected ? (
            <CheckSquare size={20} className="text-gray-600" />
          ) : (
            <Square size={20} className="text-gray-400 hover:text-gray-600" />
          )}
        </div>
      )}

      {/* 缩略图 + 视频预览 */}
      <div
        className={cn(
          "aspect-video bg-gray-100 relative overflow-hidden rounded-t-xl",
          !selectionMode && "cursor-pointer"
        )}
        onClick={selectionMode ? undefined : onPreview}
      >
        {template.thumbnail_url ? (
          <img
            src={template.thumbnail_url}
            alt={template.name}
            className={cn(
              "w-full h-full object-cover transition-all duration-300",
              hasPreviewVideo ? "group-hover:opacity-0" : "group-hover:scale-105"
            )}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon size={32} className="text-gray-300" />
          </div>
        )}
        {/* Hover 时自动播放预览视频 */}
        {hasPreviewVideo && (
          <video
            ref={videoRef}
            src={template.preview_video_url!}
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          />
        )}
        {/* Hover Overlay（无预览视频时显示 Eye 图标）*/}
        {!selectionMode && !hasPreviewVideo && (
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Eye size={24} className="text-white" />
          </div>
        )}
        {/* 删除按钮 - 右上角（非选择模式） */}
        {!selectionMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-all"
            title="删除"
          >
            <Trash2 size={12} className="text-white" />
          </button>
        )}
        {/* 状态标记 */}
        {isDraft && (
          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-gray-700 text-white text-[10px] font-medium rounded-full">
            草稿
          </div>
        )}
        {/* 质量标签 */}
        {qualityBadge && (
          <div className={cn("absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs", qualityBadge.cls)}>
            {qualityBadge.text}
          </div>
        )}
      </div>

      {/* 信息 */}
      <div className="p-3 flex-1 flex flex-col">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-gray-800 truncate">{template.name}</h4>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded">
              {template.category}
            </span>
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded">
              {template.type}
            </span>
          </div>
        </div>

        {/* ── 配方摘要（直接展示在卡片上） ── */}
        {template.recipe_digest ? (
          <RecipeDigestBadges digest={template.recipe_digest} transitionSpec={template.transition_spec} />
        ) : template.tags && template.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 mt-2">
            {template.tags.slice(0, 3).map((tag, i) => (
              <span key={i} className="px-1.5 py-0.5 text-[10px] bg-gray-50 text-gray-500 rounded">
                {tag}
              </span>
            ))}
            {template.tags.length > 3 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-gray-50 text-gray-400 rounded">
                +{template.tags.length - 3}
              </span>
            )}
          </div>
        ) : null}

        {/* 操作按钮 */}
        <div className="mt-3 flex gap-2">
          {isDraft && onOpenPublishPanel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenPublishPanel();
              }}
              className="flex-1 py-2 text-sm font-medium text-gray-600 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              title="试渲染 & 发布"
            >
              <Send size={14} />
              发布
            </button>
          )}
          {!isDraft && onUnpublish && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnpublish();
              }}
              className="flex-shrink-0 py-2 px-3 text-sm font-medium text-gray-500 hover:text-gray-600 bg-gray-50 hover:bg-gray-50 rounded-lg transition-colors flex items-center justify-center gap-1"
              title="下架模板"
            >
              <ArrowDownCircle size={14} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUse();
            }}
            disabled={using}
            className="flex-1 py-2 text-sm font-medium text-gray-600 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {using ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Wand2 size={14} />
                使用模板
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 预览弹窗 ====================

interface PreviewModalProps {
  template: TemplateApiItem | null;
  onClose: () => void;
}

function PreviewModal({ template, onClose }: PreviewModalProps) {
  if (!template) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{template.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">
                {template.category}
              </span>
              <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">
                {template.type}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* 内容区域 - 可滚动 */}
        <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 80px)' }}>
          <div className="bg-gray-100 rounded-xl overflow-hidden">
            <img
              src={template.url || template.thumbnail_url}
              alt={template.name}
              className="w-full h-auto max-h-[60vh] object-contain"
            />
          </div>

          {/* 标签 */}
          {template.tags && template.tags.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                <Tag size={14} />
                标签
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {template.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-lg"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── 配方详情（在预览弹窗中完整展示） ── */}
          {template.recipe_digest && template.recipe_digest.has_analysis && (
            <div className="mt-4 border border-gray-100 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-gray-700 flex items-center gap-1.5">📋 智能配方卡</h4>

              {/* 转场分析 */}
              {template.recipe_digest.analysis_summary && (
                <div className="bg-slate-50 rounded-lg p-3 space-y-1.5">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">🔬 AI 转场分析</div>
                  <div className="flex flex-wrap gap-1.5">
                    {template.recipe_digest.analysis_summary.transition_category && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700">
                        {template.recipe_digest.analysis_summary.transition_category}
                      </span>
                    )}
                    {template.recipe_digest.analysis_summary.family && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700">
                        {template.recipe_digest.analysis_summary.family}
                      </span>
                    )}
                    {template.recipe_digest.analysis_summary.camera_movement && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700">
                        {template.recipe_digest.analysis_summary.camera_movement}
                      </span>
                    )}
                    {template.recipe_digest.analysis_summary.duration_ms && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
                        {template.recipe_digest.analysis_summary.duration_ms}ms
                      </span>
                    )}
                  </div>
                  {template.recipe_digest.analysis_summary.motion_pattern && (
                    <p className="text-[11px] text-gray-400">{template.recipe_digest.analysis_summary.motion_pattern}</p>
                  )}
                </div>
              )}

              {/* 多维度评分 */}
              {template.recipe_digest.dimension_scores && (
                <div className="bg-gray-50/60 rounded-lg p-3 space-y-2">
                  <div className="text-[10px] font-medium text-gray-600 uppercase tracking-wider">🎯 多维度分析</div>
                  {(['outfit_change', 'subject_preserve', 'scene_shift'] as const).map((dim) => {
                    const score = (template.recipe_digest!.dimension_scores as Record<string, number>)?.[dim] ?? 0;
                    const labels: Record<string, string> = { outfit_change: '换装变装', subject_preserve: '人物保持', scene_shift: '场景切换' };
                    const colors: Record<string, string> = { outfit_change: 'bg-gray-400', subject_preserve: 'bg-gray-400', scene_shift: 'bg-gray-400' };
                    const isActive = (template.recipe_digest!.recommended_focus_modes || []).includes(dim);
                    return (
                      <div key={dim} className="flex items-center gap-2">
                        <span className={`text-[11px] w-16 ${isActive ? 'font-semibold text-gray-700' : 'text-gray-400'}`}>{labels[dim]}</span>
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${colors[dim]} ${score < 0.5 ? 'opacity-40' : ''}`} style={{ width: `${Math.round(score * 100)}%` }} />
                        </div>
                        <span className={`text-[11px] w-8 text-right font-mono ${score >= 0.5 ? 'text-gray-700 font-semibold' : 'text-gray-400'}`}>{(score * 100).toFixed(0)}%</span>
                        {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-medium">推荐</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Golden Profile 匹配 */}
              {template.recipe_digest.golden_match && (
                <div
                  className={cn(
                    'rounded-lg p-3 border',
                    template.recipe_digest.golden_match.match_level === 'high'
                      ? 'bg-gray-50/80 border-gray-200'
                      : template.recipe_digest.golden_match.match_level === 'medium'
                        ? 'bg-gray-100/80 border-gray-200'
                        : 'bg-gray-50 border-gray-200'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-gray-500">🧬 匹配 Profile</span>
                      <span className="text-xs font-semibold text-gray-700">
                        {GOLDEN_PROFILE_NAMES[template.recipe_digest.golden_match.profile_name] || template.recipe_digest.golden_match.profile_name}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'text-sm font-bold',
                        template.recipe_digest.golden_match.match_level === 'high'
                          ? 'text-gray-600'
                          : template.recipe_digest.golden_match.match_level === 'medium'
                            ? 'text-gray-600'
                            : 'text-gray-400'
                      )}
                    >
                      {(template.recipe_digest.golden_match.score * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}

              {/* 参数溯源 */}
              {template.recipe_digest.provenance && (template.recipe_digest.provenance.auto_filled_keys?.length || template.recipe_digest.provenance.admin_overrides?.length) ? (
                <div className="bg-gray-50/60 rounded-lg p-3 space-y-1.5">
                  <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">⚙️ 参数溯源</div>
                  {template.recipe_digest.provenance.focus_modes_source && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-gray-500">focus_modes 来源:</span>
                      <span className={`px-1.5 py-0.5 rounded font-medium ${template.recipe_digest.provenance.focus_modes_source === 'llm_dimension_analysis' ? 'bg-gray-100 text-gray-700' : 'bg-gray-100 text-gray-600'}`}>
                        {template.recipe_digest.provenance.focus_modes_source === 'llm_dimension_analysis' ? '🎯 LLM 多维度分析' : '📋 Profile 默认'}
                      </span>
                    </div>
                  )}
                  <div className="space-y-1">
                    {template.recipe_digest.provenance.auto_filled_keys?.map((key) => (
                      <div key={key} className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-500">{key.replace('default_', '')}</span>
                        <span className="text-[10px] text-gray-400 font-medium">← AI 自动推算</span>
                      </div>
                    ))}
                    {template.recipe_digest.provenance.admin_overrides?.map((key) => (
                      <div key={key} className="flex items-center justify-between text-[11px]">
                        <span className="text-gray-500">{key.replace('default_', '')}</span>
                        <span className="text-[10px] text-gray-400 font-medium">← 管理员手动</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Publish Config 摘要 */}
              {template.publish_config && Object.keys(template.publish_config).filter(k => k.startsWith('default_')).length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">📦 发布配置</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(template.publish_config)
                      .filter(([k]) => k.startsWith('default_'))
                      .map(([k, v]) => {
                        const name = k.replace('default_', '');
                        const isModeLocked = name === 'mode';
                        const isCfgLocked = name === 'cfg_scale';
                        const isPresetInactive = name === 'golden_preset' && Boolean(
                          template.transition_spec?.recommended_prompt && template.transition_spec.recommended_prompt.length > 20
                        );
                        const locked = isModeLocked || isCfgLocked;
                        const inactive = isPresetInactive;
                        return (
                          <div key={k} className="flex items-center justify-between text-[11px]">
                            <span className={`${locked ? 'text-gray-400 line-through' : inactive ? 'text-gray-400' : 'text-gray-500'}`}>{name}</span>
                            <span className="flex items-center gap-1">
                              <span className={`font-medium ${locked ? 'text-gray-400' : inactive ? 'text-gray-400' : 'text-gray-700'}`}>{String(v)}</span>
                              {locked && <span className="text-[9px] px-1 py-0.5 rounded bg-gray-200 text-gray-500">🔒 锁定</span>}
                              {inactive && <span className="text-[9px] px-1 py-0.5 rounded bg-gray-200 text-gray-500">⚠️ 未生效</span>}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                  <p className="text-[9px] text-gray-400 mt-2">🔒 image_tail 模式下 mode 锁定为 pro，cfg_scale 锁定为 0.3-0.5</p>
                </div>
              )}
            </div>
          )}

          {/* Workflow 信息 */}
          {template.workflow && Object.keys(template.workflow).length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Workflow 配置</h4>
              <pre className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 overflow-auto max-h-40">
                {JSON.stringify(template.workflow, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== 主组件 ====================

interface PlatformMaterialsViewProps {
  autoOpenUpload?: boolean;
  /** 由侧边栏二级导航控制的初始 Tab */
  initialTopTab?: 'templates' | 'avatars' | 'references' | 'prompts';
}

export function PlatformMaterialsView({ autoOpenUpload, initialTopTab }: PlatformMaterialsViewProps) {
  const [templates, setTemplates] = useState<TemplateApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  const [showUploadModal, setShowUploadModal] = useState(autoOpenUpload ?? false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [ingestTasks, setIngestTasks] = useState<IngestTask[]>([]);
  const [renderTasks, setRenderTasks] = useState<TemplateRenderTask[]>([]);
  const [useTemplateDraft, setUseTemplateDraft] = useState<TemplateApiItem | null>(null);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);

  const [previewTemplate, setPreviewTemplate] = useState<TemplateApiItem | null>(null);

  // 批量选择状态
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // 顶层 Tab：视频模板 vs 数字人形象 vs 质量参考图 vs Prompt 库
  const [topTab, setTopTab] = useState<'templates' | 'avatars' | 'references' | 'prompts'>(initialTopTab || 'templates');

  // 侧边栏切换子功能时同步 topTab
  useEffect(() => {
    if (initialTopTab && initialTopTab !== topTab) {
      setTopTab(initialTopTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTopTab]);

  // 发布状态 Tab
  const [publishTab, setPublishTab] = useState<'draft' | 'published'>('draft');

  // 发布面板
  const [publishPanelTemplate, setPublishPanelTemplate] = useState<TemplateApiItem | null>(null);

  // 加载模板列表
  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchTemplates({ include_workflow: true, status: publishTab });
      setTemplates(response.items);
      debugLog('Loaded templates:', response.items.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [publishTab]);

  useEffect(() => {
    loadTemplates();
    // 切换 tab 时重置批量选择
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [loadTemplates]);

  // 轮询入库任务状态
  useEffect(() => {
    const pendingTasks = ingestTasks.filter(
      (t) => t.status === 'queued' || t.status === 'processing'
    );
    if (pendingTasks.length === 0) return;

    const interval = setInterval(async () => {
      for (const task of pendingTasks) {
        try {
          const job = await getIngestJobStatus(task.jobId);
          setIngestTasks((prev) =>
            prev.map((t) =>
              t.jobId === task.jobId
                ? {
                    ...t,
                    status: job.status,
                    progress: job.progress,
                    error: job.error_message,
                    result: job.result,
                  }
                : t
            )
          );

          // 任务完成后刷新列表
          if (job.status === 'succeeded') {
            loadTemplates();
          }
        } catch (err) {
          debugLog('Failed to poll task:', task.jobId, err);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [ingestTasks, loadTemplates]);

  // 轮询渲染任务状态
  useEffect(() => {
    const activeTasks = renderTasks.filter(
      (t) => t.status === 'pending' || t.status === 'processing'
    );
    if (activeTasks.length === 0) return;

    const interval = setInterval(async () => {
      for (const task of activeTasks) {
        if (!task.taskId) continue;
        try {
          const resp = await taskApi.getTaskStatus(task.taskId);
          const job = resp.data;
          if (!job) continue;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const jobAny = job as any;
          let newStatus: TemplateRenderTask['status'] = 'processing';
          if (job.status === 'completed') newStatus = 'succeeded';
          else if (job.status === 'failed' || job.status === 'cancelled') newStatus = 'failed';

          const outputUrl: string | undefined = jobAny.output_url || jobAny.result_url;

          if (newStatus !== task.status || outputUrl) {
            setRenderTasks((prev) =>
              prev.map((t) =>
                t.id === task.id
                  ? {
                      ...t,
                      status: newStatus,
                      resultUrl: outputUrl ?? t.resultUrl,
                      error: job.error ?? t.error,
                    }
                  : t
              )
            );
          }
        } catch (err) {
          debugLog('Failed to poll render task:', task.taskId, err);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [renderTasks]);

  // 提交入库任务
  const handleSubmitIngest = async (data: UploadSubmitData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      let sourceUrl = data.sourceUrl;
      let sourceLabel = data.sourceUrl;

      if (data.uploadMode === 'file') {
        if (!data.localFile) {
          throw new Error('请先选择本地文件');
        }

        const uploadResult = await uploadTemplateSourceFile(data.localFile, 'platform-materials');
        sourceUrl = uploadResult.url;
        sourceLabel = data.localFile.name;
        debugLog('Uploaded source file:', uploadResult.path);
      }

      if (!sourceUrl || !sourceUrl.trim()) {
        throw new Error('素材地址为空，请检查后重试');
      }

      const response = await createIngestJob({
        source_url: sourceUrl,
        source_type: data.sourceType,
        tags_hint: data.tags,
      });

      setIngestTasks((prev) => [
        {
          jobId: response.job_id,
          status: 'queued',
          progress: 0,
          sourceUrl: sourceLabel || sourceUrl,
        },
        ...prev,
      ]);

      setShowUploadModal(false);
      debugLog('Created ingest job:', response.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建任务失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 使用模板生成
  const handleUseTemplate = (template: TemplateApiItem) => {
    if (isApplyingTemplate) return;
    setUseTemplateDraft(template);
  };

  const handleSubmitApplyTemplate = async (payload: ApplyTemplatePayload) => {
    const template = useTemplateDraft;
    if (!template || isApplyingTemplate) return;

    setIsApplyingTemplate(true);
    setError(null);

    const taskId = `render-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    setRenderTasks((prev) => [
      {
        id: taskId,
        templateId: template.id,
        templateName: template.name,
        status: 'pending' as const,
        createdAt: Date.now(),
      },
      ...prev,
    ].slice(0, 10));

    try {
      const transitionDurationMs = typeof template.transition_spec?.duration_ms === 'number'
        ? template.transition_spec.duration_ms
        : 1200;

      const transitionInputMode = payload.transitionInputMode || 'image_pair';

      // template_pair 模式下若有本地文件上传，也走 image_pair 通道
      const hasLocalFileOverride = transitionInputMode === 'template_pair' && (payload.fromImageFile || payload.toImageFile);

      if (payload.mode === 'transition' && (transitionInputMode === 'image_pair' || hasLocalFileOverride)) {
        const fromImageUrl = await resolveApplyImageUrl(payload.fromImageUrl, payload.fromImageFile, '首帧');
        const toImageUrl = await resolveApplyImageUrl(payload.toImageUrl, payload.toImageFile, '尾帧');

        const response = await replicateTransitionTemplate(template.id, {
          from_image_url: fromImageUrl,
          to_image_url: toImageUrl,
          prompt: payload.prompt,
          negative_prompt: payload.negativePrompt,
          boundary_ms: payload.boundaryMs || transitionDurationMs || 1200,
          quality_tier: 'template_match',
          focus_modes: payload.focusModes?.length ? payload.focusModes : ['outfit_change'],
          golden_preset: payload.goldenPreset || 'spin_occlusion_outfit',
          variant_count: payload.variantCount || 1,
          // 模型参数：用户在 UI 里选的 duration / mode / cfg_scale 等必须传过去
          duration: payload.modelParams?.duration as string | undefined,
          mode: payload.modelParams?.mode as string | undefined,
          aspect_ratio: payload.modelParams?.aspect_ratio as string | undefined,
          overrides: {
            kling_endpoint: 'multi_image_to_video',
            ...(payload.selectedModel ? { model_name: payload.selectedModel } : {}),
            ...(payload.modelParams?.cfg_scale != null ? { cfg_scale: payload.modelParams.cfg_scale } : {}),
          },
        });

        setRenderTasks((prev) => {
          const remaining = prev.filter((t) => t.id !== taskId);
          const createdAt = Date.now();
          const replicaRows: TemplateRenderTask[] = (response.tasks || []).map((task, idx) => ({
            id: `${taskId}-${idx}`,
            templateId: template.id,
            templateName: `${template.name} · ${task.variant_label}`,
            status: task.status === 'failed' ? 'failed' : task.status === 'completed' ? 'succeeded' : 'processing',
            taskId: task.task_id,
            endpoint: response.endpoint,
            prompt: task.prompt,
            createdAt,
          }));
          return [...replicaRows, ...remaining].slice(0, 12);
        });

        setUseTemplateDraft(null);
        debugLog('Template replicate tasks created:', template.id, response.replica_group_id, response.task_count);
        return;
      }

      const overrides: Record<string, unknown> = {};
      const renderPayload: Record<string, unknown> = {
        write_clip_metadata: false,
        duration: '5',
        prompt: payload.prompt,
        negative_prompt: payload.negativePrompt,
      };

      // ── 多模型参数注入 ──
      if (payload.selectedModel) {
        renderPayload.model_name = payload.selectedModel;
      }
      if (payload.modelParams) {
        // 将模型特定参数平铺到 renderPayload
        for (const [key, val] of Object.entries(payload.modelParams)) {
          if (val !== undefined && val !== null && key !== 'model_name' && key !== 'prompt' && key !== 'negative_prompt') {
            renderPayload[key] = val;
          }
        }
      }

      if (payload.mode === 'transition') {
        overrides.kling_endpoint = 'multi_image_to_video';
        overrides.transition_duration_ms = payload.boundaryMs || transitionDurationMs;
        renderPayload.from_template_id = payload.fromTemplateId;
        renderPayload.to_template_id = payload.toTemplateId;
        renderPayload.boundary_ms = payload.boundaryMs || 1200;
        renderPayload.quality_tier = 'template_match';
        renderPayload.focus_modes = payload.focusModes?.length ? payload.focusModes : ['outfit_change'];
        renderPayload.golden_preset = payload.goldenPreset || 'spin_occlusion_outfit';
      } else if (template.type === 'transition') {
        overrides.kling_endpoint = 'image_to_video';
        overrides.transition_duration_ms = transitionDurationMs;
      }

      if (Object.keys(overrides).length > 0) {
        renderPayload.overrides = overrides;
      }

      const response = await renderTemplate(template.id, renderPayload);

      setRenderTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'processing' as const,
                taskId: response.task_id,
                endpoint: response.endpoint,
                prompt: response.prompt,
              }
            : t
        )
      );

      setUseTemplateDraft(null);
      debugLog('Template render task created:', template.id, response.task_id, payload.mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成失败';
      setRenderTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: 'failed' as const, error: message }
            : t
        )
      );
      setError(message);
    } finally {
      setIsApplyingTemplate(false);
    }
  };

  // 关闭渲染任务提示
  const handleDismissRenderTask = (taskId: string) => {
    setRenderTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  // 删除模板
  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('确定要删除这个模板吗？')) return;

    try {
      await deleteTemplate(templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      debugLog('Deleted template:', templateId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 批量删除模板
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个模板吗？`)) return;

    setIsBatchDeleting(true);
    try {
      const result = await batchDeleteTemplates(Array.from(selectedIds));
      debugLog('Batch delete result:', result);
      
      // 从列表中移除已删除的模板
      setTemplates((prev) => prev.filter((t) => !result.deleted.includes(t.id)));
      
      // 清除选择
      setSelectedIds(new Set());
      setSelectionMode(false);
      
      // 如果有失败的，显示错误
      if (result.failed_count > 0) {
        setError(`${result.deleted_count} 个删除成功，${result.failed_count} 个删除失败`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量删除失败');
    } finally {
      setIsBatchDeleting(false);
    }
  };

  // 切换选择
  const toggleSelect = (templateId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(templateId)) {
        next.delete(templateId);
      } else {
        next.add(templateId);
      }
      return next;
    });
  };

  // 发布模板
  const handlePublishTemplate = async (templateId: string) => {
    try {
      await publishTemplate(templateId);
      // 从当前列表移除（因为 tab 是 draft，发布后不再显示）
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    }
  };

  // 下架模板
  const handleUnpublishTemplate = async (templateId: string) => {
    try {
      await unpublishTemplate(templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '下架失败');
    }
  };

  // 批量发布
  const handleBatchPublish = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定要发布选中的 ${selectedIds.size} 个模板吗？`)) return;

    try {
      const result = await batchPublishTemplates(Array.from(selectedIds));
      debugLog('Batch publish result:', result);
      setTemplates((prev) => prev.filter((t) => !result.published.includes(t.id)));
      setSelectedIds(new Set());
      setSelectionMode(false);
      if (result.failed_count > 0) {
        setError(`${result.published_count} 个发布成功，${result.failed_count} 个发布失败`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量发布失败');
    }
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTemplates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTemplates.map((t) => t.id)));
    }
  };

  // 退出选择模式
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // 移除已完成的任务提示
  const handleDismissTask = (jobId: string) => {
    setIngestTasks((prev) => prev.filter((t) => t.jobId !== jobId));
  };

  // 筛选模板
  const filteredTemplates = templates.filter((t) => {
    if (filterCategory !== 'all' && t.category !== filterCategory) return false;
    if (filterType !== 'all' && t.type !== filterType) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchName = t.name.toLowerCase().includes(query);
      const matchTags = t.tags?.some((tag) => tag.toLowerCase().includes(query));
      if (!matchName && !matchTags) return false;
    }
    return true;
  });

  // 统计
  const categories = Array.from(new Set(templates.map((t) => t.category)));
  const types = Array.from(new Set(templates.map((t) => t.type)));

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">模板库</h1>
          <p className="text-sm text-gray-500 mt-1">
            管理视觉模板素材，用于 AI 视频生成
          </p>
        </div>
      </div>

      {/* 顶层 Tab 切换：视频模板 / 数字人形象 / 质量参考图 */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setTopTab('templates')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
            topTab === 'templates'
              ? 'bg-gray-900 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Film size={16} />
          视频模板
        </button>
        <button
          onClick={() => setTopTab('avatars')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
            topTab === 'avatars'
              ? 'bg-gray-900 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <User size={16} />
          数字人形象
        </button>
        <button
          onClick={() => setTopTab('references')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
            topTab === 'references'
              ? 'bg-gray-900 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Sparkles size={16} />
          质量参考图
        </button>
        <button
          onClick={() => setTopTab('prompts')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
            topTab === 'prompts'
              ? 'bg-gray-900 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <BookOpen size={16} />
          Prompt 库
        </button>
      </div>

      {/* 质量参考图 / Prompt 库 / 数字人形象 管理 */}
      {topTab === 'references' ? (
        <QualityReferenceManager />
      ) : topTab === 'prompts' ? (
        <PromptLibraryManager />
      ) : topTab === 'avatars' ? (
        <DigitalAvatarManager />
      ) : (
      /* 视频模板管理 */
      <>

      {/* Header Actions */}
      <div className="flex items-center justify-end mb-6">
        <div className="flex items-center gap-2">
          {/* 批量选择按钮 */}
          {!selectionMode ? (
            <button
              onClick={() => setSelectionMode(true)}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <CheckSquare size={16} />
              批量选择
            </button>
          ) : (
            <>
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                {selectedIds.size === filteredTemplates.length ? '取消全选' : '全选'}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0 || isBatchDeleting}
                className="flex items-center gap-2 px-3 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBatchDeleting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                删除 ({selectedIds.size})
              </button>
              {publishTab === 'draft' && (
                <button
                  onClick={handleBatchPublish}
                  disabled={selectedIds.size === 0}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send size={14} />
                  发布 ({selectedIds.size})
                </button>
              )}
              <button
                onClick={exitSelectionMode}
                className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                <X size={14} />
                取消
              </button>
            </>
          )}
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            <Plus size={16} />
            上传模板
          </button>
        </div>
      </div>

      {/* 入库任务进度 */}
      <TaskProgress tasks={ingestTasks} onDismiss={handleDismissTask} />

      {/* 渲染任务进度 */}
      <RenderTaskProgress tasks={renderTasks} onDismiss={handleDismissRenderTask} />

      {/* 发布状态 Tab */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
        <button
          onClick={() => setPublishTab('draft')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            publishTab === 'draft'
              ? 'border-gray-900 text-gray-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Clock size={14} />
          预发布
        </button>
        <button
          onClick={() => setPublishTab('published')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            publishTab === 'published'
              ? 'border-gray-900 text-gray-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Globe size={14} />
          已发布
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* 搜索 */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索素材..."
            className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
          />
        </div>

        {/* 分类筛选 */}
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:border-gray-400 bg-white"
        >
          <option value="all">全部分类</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        {/* 类型筛选 */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:border-gray-400 bg-white"
        >
          <option value="all">全部类型</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        {/* 刷新 */}
        <button
          onClick={loadTemplates}
          disabled={loading}
          className="h-9 px-3 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>

        {/* 统计 */}
        <div className="ml-auto text-sm text-gray-500">
          共 <span className="font-medium text-gray-700">{filteredTemplates.length}</span> 个素材
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 加载状态 */}
      {loading && templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 size={32} className="text-gray-400 animate-spin mb-4" />
          <p className="text-sm text-gray-500">加载中...</p>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
            <ImageIcon size={28} className="text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-700 mb-1">暂无素材</h3>
          <p className="text-sm text-gray-500 mb-4">
            {searchQuery || filterCategory !== 'all' || filterType !== 'all'
              ? '没有找到匹配的素材，试试其他筛选条件'
              : '点击上方按钮上传第一个平台素材'}
          </p>
          {!searchQuery && filterCategory === 'all' && filterType === 'all' && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              <Upload size={14} />
              上传素材
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredTemplates.map((template) => (
            <MaterialCard
              key={template.id}
              template={template}
              onDelete={() => handleDeleteTemplate(template.id)}
              onPreview={() => setPreviewTemplate(template)}
              onUse={() => handleUseTemplate(template)}
              onPublish={() => handlePublishTemplate(template.id)}
              onUnpublish={() => handleUnpublishTemplate(template.id)}
              onOpenPublishPanel={() => setPublishPanelTemplate(template)}
              using={isApplyingTemplate && useTemplateDraft?.id === template.id}
              selectionMode={selectionMode}
              selected={selectedIds.has(template.id)}
              onToggleSelect={() => toggleSelect(template.id)}
            />
          ))}
        </div>
      )}

      {/* 上传弹窗 */}
      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSubmit={handleSubmitIngest}
        isSubmitting={isSubmitting}
      />

      {/* 使用模板弹窗 */}
      <ApplyTemplateModal
        template={useTemplateDraft}
        templates={templates}
        isSubmitting={isApplyingTemplate}
        onClose={() => {
          if (!isApplyingTemplate) setUseTemplateDraft(null);
        }}
        onSubmit={handleSubmitApplyTemplate}
      />

      {/* 预览弹窗 */}
      <PreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(null)} />

      {/* 发布面板（试渲染 + 参数调优 + 质量标注） */}
      <TemplatePublishPanel
        template={publishPanelTemplate}
        onClose={() => setPublishPanelTemplate(null)}
        onPublished={(templateId) => {
          setTemplates((prev) => prev.filter((t) => t.id !== templateId));
          setPublishPanelTemplate(null);
        }}
      />
      </>
      )}
    </div>
  );
}

export default PlatformMaterialsView;
