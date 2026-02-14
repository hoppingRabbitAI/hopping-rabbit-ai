/**
 * CompositorModal — 全屏单图编辑器
 *
 * 集成功能：
 *   • 左侧：图层面板 (Layers)
 *   • 中间：DrawingCanvas（画笔涂抹 + 图片预览）+ 底部生成历史
 *   • 右侧：Canvas 属性 + Prompt 输入 + AI Generate
 *
 * 白灰主色调，与项目整体风格一致
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Plus,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Layers,
  Image as ImageIcon,
  Type,
  Square,
  Circle,
  Wand2,
  Loader2,
  Sparkles,
  Check,
  History,
  ChevronLeft,
  ChevronRight,
  Brush,
  Lightbulb,
  ChevronDown,
} from 'lucide-react';
import { DrawingCanvas } from './DrawingCanvas';
import type { Layer, CanvasObject, ImageObject, LayerType } from '@/types/visual-editor';
import { useTaskHistoryStore } from '@/stores/taskHistoryStore';
import type { GenerateParams, GenerateResult, ConfirmParams } from './KeyframeEditor';
import { getPresetsForCapability, type PromptPreset } from '@/lib/prompt-presets';

// ============================================
// Props
// ============================================

export interface CompositorModalProps {
  isOpen: boolean;
  /** 当前操作的素材信息 */
  clipId: string;
  mediaType: 'video' | 'image';
  thumbnail?: string;
  videoUrl?: string;
  /** 初始图层数据（如果 shot 已有 layers） */
  initialLayers?: Layer[];
  /** 画板尺寸 */
  artboardWidth?: number;
  artboardHeight?: number;
  /** 项目 ID — 用于任务查询 */
  projectId?: string;
  onClose: () => void;
  /** 保存时回调 — 将编辑好的图层数据回传 */
  onSave?: (layers: Layer[], artboardWidth: number, artboardHeight: number) => void;
  /** AI 生成回调 — 复用 KeyframeEditor 的生成流程 */
  onGenerate?: (params: GenerateParams) => Promise<GenerateResult>;
  /** AI 确认回调 — 将生成的图应用为新的素材 */
  onConfirm?: (params: ConfirmParams) => Promise<void>;
}

// ============================================
// 内部类型
// ============================================

/** 生成版本 */
interface GenerationVersion {
  id: string;
  previewUrl: string;
  prompt: string;
  maskDataUrl: string | null;
  taskId?: string;
  createdAt: Date;
  isFromHistory?: boolean;
}

// ============================================
// 辅助函数
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getLayerIcon(type: LayerType) {
  switch (type) {
    case 'background': return ImageIcon;
    case 'foreground': return ImageIcon;
    case 'decoration': return Square;
    case 'text': return Type;
    case 'shape': return Circle;
    default: return Layers;
  }
}

const LAYER_NAMES: Record<LayerType, string> = {
  background: '背景',
  foreground: '人物',
  decoration: '装饰',
  text: '文字',
  shape: '形状',
};

// ============================================
// 组件
// ============================================

export function CompositorModal({
  isOpen,
  clipId,
  mediaType,
  thumbnail,
  videoUrl,
  initialLayers,
  artboardWidth: initW = 1920,
  artboardHeight: initH = 1080,
  projectId,
  onClose,
  onSave,
  onGenerate,
  onConfirm,
}: CompositorModalProps) {
  // ============ 图层状态 ============
  const [layers, setLayers] = useState<Layer[]>(() => {
    if (initialLayers && initialLayers.length > 0) return initialLayers;
    // 默认三图层：背景 / 人物 / 装饰
    return [
      {
        id: generateId(),
        type: 'decoration' as LayerType,
        name: '装饰',
        visible: true,
        locked: false,
        opacity: 1,
        objects: [],
      },
      {
        id: generateId(),
        type: 'foreground' as LayerType,
        name: '人物',
        visible: true,
        locked: false,
        opacity: 1,
        objects: [],
      },
      {
        id: generateId(),
        type: 'background' as LayerType,
        name: '背景',
        visible: true,
        locked: false,
        opacity: 1,
        objects: thumbnail ? [{
          id: generateId(),
          type: 'image' as const,
          src: thumbnail,
          x: 0,
          y: 0,
          width: initW,
          height: initH,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          locked: false,
        }] : [],
      },
    ];
  });

  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [artboardWidth, setArtboardWidth] = useState(initW);
  const [artboardHeight, setArtboardHeight] = useState(initH);

  // ============ DrawingCanvas 涂抹状态 ============
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);

  // ============ Prompt / 生成状态 ============
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [imageProvider, setImageProvider] = useState<'doubao' | 'kling'>('doubao');

  // ============ 生成历史 ============
  const tasks = useTaskHistoryStore(state => state.tasks);
  const [sessionHistory, setSessionHistory] = useState<GenerationVersion[]>([]);
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState<number>(-1);
  const historyContainerRef = useRef<HTMLDivElement>(null);

  // ============ 当前画布显示的图片（可以是原图或某个生成结果） ============
  const [activeImageUrl, setActiveImageUrl] = useState<string | undefined>(thumbnail);

  // ============ 图片自然尺寸 ============
  useEffect(() => {
    const imgUrl = activeImageUrl;
    if (!imgUrl) return;
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setArtboardWidth(img.naturalWidth);
        setArtboardHeight(img.naturalHeight);
      }
    };
    img.src = imgUrl;
  }, [activeImageUrl]);

  // ============ 从历史记录加载 ============
  useEffect(() => {
    const clipTasks = tasks.filter(task => {
      const taskClipId = task.clip_id || (task.input_params as { clip_id?: string })?.clip_id;
      return taskClipId === clipId &&
             task.status === 'completed' &&
             task.output_url;
    });

    const historyVersions: GenerationVersion[] = clipTasks.map(task => ({
      id: task.id,
      previewUrl: task.output_url!,
      prompt: (task.input_params as { prompt?: string })?.prompt || '',
      maskDataUrl: null,
      taskId: task.id,
      createdAt: new Date(task.created_at),
      isFromHistory: true,
    }));
    historyVersions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    setSessionHistory(prev => {
      const existingIds = new Set(prev.map(v => v.id));
      const newFromHistory = historyVersions.filter(v => !existingIds.has(v.id));
      if (newFromHistory.length === 0) return prev;
      return [...newFromHistory, ...prev.filter(v => !v.isFromHistory)];
    });
  }, [tasks, clipId]);

  const currentPreview = selectedHistoryIdx >= 0 && selectedHistoryIdx < sessionHistory.length
    ? sessionHistory[selectedHistoryIdx]
    : null;

  // ============ 图层操作 ============
  const addLayer = useCallback((type: LayerType = 'decoration') => {
    const count = layers.filter(l => l.type === type).length;
    const newLayer: Layer = {
      id: generateId(),
      type,
      name: `${LAYER_NAMES[type]} ${count + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      objects: [],
    };
    setLayers(prev => [newLayer, ...prev]);
    setSelectedLayerId(newLayer.id);
  }, [layers]);

  const removeLayer = useCallback((layerId: string) => {
    setLayers(prev => prev.filter(l => l.id !== layerId));
    if (selectedLayerId === layerId) setSelectedLayerId(null);
  }, [selectedLayerId]);

  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? { ...l, visible: !l.visible } : l
    ));
  }, []);

  const toggleLayerLock = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? { ...l, locked: !l.locked } : l
    ));
  }, []);

  // ============ AI 生成 ============
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setGenError('请输入描述');
      return;
    }
    if (!onGenerate) {
      setGenError('生成功能暂不可用');
      return;
    }

    setIsGenerating(true);
    setGenError(null);

    try {
      const result = await onGenerate({
        clipId,
        capabilityId: 'omni_image',
        prompt: prompt.trim(),
        maskDataUrl: maskDataUrl,
        keyframeUrl: activeImageUrl || thumbnail || '',
        provider: imageProvider,
      });

      const newVersion: GenerationVersion = {
        id: `session-${Date.now()}`,
        previewUrl: result.previewUrl,
        prompt: prompt.trim(),
        maskDataUrl,
        taskId: result.taskId,
        createdAt: new Date(),
        isFromHistory: false,
      };

      setSessionHistory(prev => {
        const updated = [...prev, newVersion];
        setSelectedHistoryIdx(updated.length - 1);
        return updated;
      });

      // 滚动到最新
      setTimeout(() => {
        historyContainerRef.current?.scrollTo({
          left: historyContainerRef.current.scrollWidth,
          behavior: 'smooth',
        });
      }, 100);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, maskDataUrl, activeImageUrl, thumbnail, clipId, onGenerate, imageProvider]);

  // ============ 选择历史版本 ============
  const handleSelectVersion = useCallback((idx: number) => {
    if (idx < 0 || idx >= sessionHistory.length) return;
    setSelectedHistoryIdx(idx);
    const version = sessionHistory[idx];
    setPrompt(version.prompt);
    // 将选中的生成结果设置为画布当前图片
    setActiveImageUrl(version.previewUrl);
    setMaskDataUrl(null); // 清除涂抹
  }, [sessionHistory]);

  // ============ 应用选中结果 ============
  const handleApplyResult = useCallback(async () => {
    if (!currentPreview || !onConfirm) return;
    try {
      await onConfirm({
        clipId,
        capabilityId: 'omni_image',
        previewUrl: currentPreview.previewUrl,
        prompt: currentPreview.prompt,
        taskId: currentPreview.taskId,
      });
      // 更新背景图层
      setLayers(prev => prev.map(l => {
        if (l.type === 'background') {
          return {
            ...l,
            objects: [{
              id: generateId(),
              type: 'image' as const,
              src: currentPreview.previewUrl,
              x: 0,
              y: 0,
              width: artboardWidth,
              height: artboardHeight,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
              locked: false,
            }],
          };
        }
        return l;
      }));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '应用失败');
    }
  }, [currentPreview, clipId, artboardWidth, artboardHeight, onConfirm]);

  // ============ 回到原图 ============
  const handleResetToOriginal = useCallback(() => {
    setActiveImageUrl(thumbnail);
    setSelectedHistoryIdx(-1);
    setMaskDataUrl(null);
  }, [thumbnail]);

  // ============ 保存 ============
  const handleSave = useCallback(() => {
    onSave?.(layers, artboardWidth, artboardHeight);
    onClose();
  }, [layers, artboardWidth, artboardHeight, onSave, onClose]);

  // ============ 键盘快捷键 ============
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hasHistory = sessionHistory.length > 0;

  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-gray-50">
      {/* ==================== 顶栏 ==================== */}
      <div className="h-12 flex items-center justify-between px-4 bg-white border-b border-gray-200 shrink-0">
        {/* 左 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} className="text-gray-500" />
          </button>
          <span className="text-sm font-semibold text-gray-800">Compositor</span>
          <span className="text-xs text-gray-400 ml-1">{artboardWidth} × {artboardHeight}</span>
        </div>

        {/* 中 — 工具提示 */}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Brush size={14} />
          <span>在图上涂抹想修改的区域，然后在右侧输入 Prompt 生成</span>
        </div>

        {/* 右 — 保存 */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            className="px-4 h-8 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 transition-colors"
          >
            保存
          </button>
        </div>
      </div>

      {/* ==================== 主体 ==================== */}
      <div className="flex-1 flex overflow-hidden">
        {/* -------- 左侧：图层面板 -------- */}
        <div className="w-44 bg-white border-r border-gray-200 flex flex-col shrink-0">
          <div className="h-10 flex items-center justify-between px-3 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Layers</span>
            <button
              onClick={() => addLayer('decoration')}
              title="添加图层"
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {layers.map((layer) => {
              const LayerIcon = getLayerIcon(layer.type);
              const isSelected = selectedLayerId === layer.id;
              return (
                <div
                  key={layer.id}
                  className={`
                    group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors
                    ${isSelected ? 'bg-gray-50 border-l-2 border-gray-900' : 'border-l-2 border-transparent hover:bg-gray-50'}
                  `}
                  onClick={() => setSelectedLayerId(layer.id)}
                >
                  <LayerIcon size={14} className={isSelected ? 'text-gray-500' : 'text-gray-400'} />
                  <span
                    className={`flex-1 text-xs truncate ${isSelected ? 'text-gray-800 font-medium' : 'text-gray-600'} ${!layer.visible ? 'opacity-40' : ''}`}
                  >
                    {layer.name}
                  </span>

                  {layer.objects.length > 0 && (
                    <span className="text-[10px] text-gray-400 tabular-nums">{layer.objects.length}</span>
                  )}

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                      className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600"
                    >
                      {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }}
                      className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600"
                    >
                      {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </button>
                    {layer.type !== 'background' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
                        className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-gray-100 p-2">
            <button
              onClick={() => addLayer('decoration')}
              className="w-full py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus size={12} />
              Add another layer
            </button>
          </div>
        </div>

        {/* -------- 中间：画布 + DrawingCanvas + 历史 -------- */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 画布区域 */}
          <div className="flex-1 flex items-center justify-center bg-gray-100 overflow-hidden p-6 min-h-0">
            {activeImageUrl ? (
              <DrawingCanvas
                imageUrl={activeImageUrl}
                onMaskChange={setMaskDataUrl}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-gray-400">
                <ImageIcon size={48} />
                <span className="text-sm">暂无画面</span>
              </div>
            )}
          </div>

          {/* 底部：生成历史缩略图条 */}
          {hasHistory && (
            <div className="shrink-0 bg-white border-t border-gray-200 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <History size={14} />
                  <span>生成记录 ({sessionHistory.length})</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleResetToOriginal()}
                    className="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                  >
                    回到原图
                  </button>
                  <button
                    onClick={() => selectedHistoryIdx > 0 && handleSelectVersion(selectedHistoryIdx - 1)}
                    disabled={selectedHistoryIdx <= 0}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={16} className="text-gray-500" />
                  </button>
                  <button
                    onClick={() => selectedHistoryIdx < sessionHistory.length - 1 && handleSelectVersion(selectedHistoryIdx + 1)}
                    disabled={selectedHistoryIdx >= sessionHistory.length - 1}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={16} className="text-gray-500" />
                  </button>
                </div>
              </div>

              <div
                ref={historyContainerRef}
                className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
              >
                {/* 原图 */}
                <button
                  onClick={handleResetToOriginal}
                  className={`relative flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                    selectedHistoryIdx === -1
                      ? 'border-gray-900 ring-2 ring-gray-200 shadow-lg'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  style={{ width: 72, height: 72 }}
                >
                  {thumbnail ? (
                    <img src={thumbnail} alt="原图" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                      <ImageIcon size={20} className="text-gray-400" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1 py-0.5">
                    <span className="text-white text-[9px]">原图</span>
                  </div>
                </button>

                {/* 生成历史 */}
                {sessionHistory.map((version, idx) => (
                  <button
                    key={version.id}
                    onClick={() => handleSelectVersion(idx)}
                    className={`relative flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                      idx === selectedHistoryIdx
                        ? 'border-gray-900 ring-2 ring-gray-200 shadow-lg'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    style={{ width: 72, height: 72 }}
                  >
                    <img
                      src={version.previewUrl}
                      alt={`生成 ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    {idx === selectedHistoryIdx && (
                      <div className="absolute top-1 right-1 w-4 h-4 bg-gray-800 rounded-full flex items-center justify-center">
                        <Check size={10} className="text-white" />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1 py-0.5">
                      <span className="text-white text-[9px] truncate block">{version.prompt || `#${idx + 1}`}</span>
                    </div>
                    {version.isFromHistory && (
                      <div className="absolute top-1 left-1 px-1 py-0.5 bg-gray-800/60 text-white text-[8px] rounded">
                        历史
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* -------- 右侧：属性 + Prompt + Generate -------- */}
        <div className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0">
          {/* CANVAS 属性 */}
          <div className="h-10 flex items-center px-3 border-b border-gray-100">
            <Layers size={14} className="text-gray-400 mr-2" />
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Canvas</span>
          </div>

          <div className="p-3 space-y-3 border-b border-gray-100">
            <div>
              <label className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">Dimensions</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-gray-400 block mb-0.5">W</span>
                  <input
                    type="number"
                    value={artboardWidth}
                    onChange={(e) => setArtboardWidth(Math.max(1, Number(e.target.value)))}
                    className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs text-gray-800 focus:border-gray-300 focus:outline-none"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block mb-0.5">H</span>
                  <input
                    type="number"
                    value={artboardHeight}
                    onChange={(e) => setArtboardHeight(Math.max(1, Number(e.target.value)))}
                    className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs text-gray-800 focus:border-gray-300 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">Layers</label>
              <p className="text-xs text-gray-400 mt-1">
                {layers.length} 个图层, {layers.reduce((s, l) => s + l.objects.length, 0)} 个对象
              </p>
            </div>
          </div>

          {/* ===== AI 生成区域 ===== */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="h-10 flex items-center justify-between px-3 border-b border-gray-100">
              <div className="flex items-center">
                <Sparkles size={14} className="text-gray-400 mr-2" />
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">AI Generate</span>
              </div>
              {/* ★ 模型选择器 */}
              <div className="flex items-center gap-0.5 rounded-md border border-gray-200 overflow-hidden">
                {([
                  { value: 'doubao' as const, label: 'Doubao' },
                  { value: 'kling' as const, label: 'Kling' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setImageProvider(opt.value)}
                    className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
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

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* 涂抹提示 */}
              <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg">
                <Brush size={12} className="text-gray-500 shrink-0" />
                <span className="text-[11px] text-gray-600 leading-tight">
                  {maskDataUrl
                    ? '✓ 已标注修改区域'
                    : '可选：先在左侧画布涂抹要修改的区域'
                  }
                </span>
              </div>

              {/* Prompt 输入 + 预设 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">Prompt</label>
                  {(() => {
                    const presets = getPresetsForCapability('omni_image');
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
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述你想要的效果..."
                  className="w-full h-24 px-3 py-2 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent text-xs text-gray-800 placeholder:text-gray-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                />
                <p className="text-[10px] text-gray-400 mt-1">⌘+Enter 快速生成</p>
              </div>

              {/* 生成按钮 */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim() || !onGenerate}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Wand2 size={14} />
                    {hasHistory ? '再生成一个' : '生成'}
                  </>
                )}
              </button>

              {/* 错误提示 */}
              {genError && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-[11px] text-red-600">{genError}</p>
                </div>
              )}

              {/* 当前选中预览 */}
              {currentPreview && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 font-medium">当前选中</span>
                  </div>
                  <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <img
                      src={currentPreview.previewUrl}
                      alt="当前选中"
                      className="w-full h-auto object-contain"
                      style={{ maxHeight: 180 }}
                    />
                  </div>
                  {currentPreview.prompt && (
                    <p className="text-[10px] text-gray-500 leading-tight italic">
                      &ldquo;{currentPreview.prompt}&rdquo;
                    </p>
                  )}

                  {/* 应用按钮 */}
                  {onConfirm && (
                    <button
                      onClick={handleApplyResult}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <Check size={14} />
                      应用此结果
                    </button>
                  )}
                </div>
              )}

              {/* 无生成能力时的提示 */}
              {!onGenerate && (
                <div className="px-3 py-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-xs text-gray-500">AI 生成功能需要连接后端</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CompositorModal;
