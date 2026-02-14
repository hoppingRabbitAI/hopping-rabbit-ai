'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, BookOpen, ChevronDown, Image as ImageIcon, Layers, Link2, Loader2, Plus, RefreshCw, Sparkles, Video, Wand2, X } from 'lucide-react';
import {
  createUnifiedImageTask,
  createImageToVideoTask,
  createLipSyncTask,
  createMotionControlTask,
  createMultiImageToVideoTask,
  createOmniImageTask,
  createTextToVideoTask,
  createVideoExtendTask,
  createFaceSwapTask,
  // 🆕 Enhance & Style
  createSkinEnhanceTask,
  createRelightTask,
  createOutfitSwapTask,
  createAIStylistTask,
  createOutfitShotTask,
  type ImageGenerationProvider,
} from '@/lib/api/kling-tasks';
import {
  uploadTemplateSourceFile,
  fetchTemplateCandidates,
  type TemplateCandidateItem,
  type TransitionFocusMode,
  type TransitionGoldenPreset,
} from '@/lib/api/templates';
import SkinEnhanceControls from './SkinEnhanceControls';
import RelightControls from './RelightControls';
import OutfitSwapControls from './OutfitSwapControls';
import StylistControls from './StylistControls';
import OutfitShotControls from './OutfitShotControls';
import AvatarSelector, { type SelectedAvatar } from './AvatarSelector';


export type GenerationCapabilityId =
  | 'lip_sync'
  | 'text_to_video'
  | 'image_to_video'
  | 'multi_image_to_video'
  | 'motion_control'
  | 'video_extend'
  | 'face_swap'
  | 'image_generation'
  | 'omni_image'
  // 🆕 Enhance & Style
  | 'skin_enhance'
  | 'relight'
  | 'outfit_swap'
  | 'ai_stylist'
  | 'outfit_shot';

export interface GenerationInputPair {
  fromClipId: string;
  toClipId?: string;
  fromThumbnail?: string;
  toThumbnail?: string;
  fromVideoUrl?: string;
  toVideoUrl?: string;
  /** ★ 多图生成时，包含所有参与节点（含首尾），按顺序排列 */
  allInputNodes?: Array<{ clipId: string; thumbnail?: string; videoUrl?: string }>;
  /** ★ P1: 输入节点媒体类型（用于 Capability 约束过滤） */
  inputMediaTypes?: Array<'image' | 'video'>;
  /** ★ P1: 输入节点内容描述（transcript/标题，用于 Prompt 自动建议） */
  inputDescriptions?: string[];
}

export interface GenerationComposerSubmitEvent {
  taskId: string;
  capabilityId: GenerationCapabilityId;
  capabilityLabel: string;
  prompt?: string;
  sourceClipId?: string;
  targetClipId?: string;
  finalPrompt?: string;
  inputNodes?: Array<{ role: 'start' | 'end' | 'reference' | 'input'; clipId?: string; url?: string }>;
  payloadSnapshot?: Record<string, unknown>;
  /** ★ P1: 多图任务统一协议字段 */
  ordering?: 'geometric_clockwise' | 'manual' | 'sequence';
  generationMode?: 'single' | 'multi' | 'cycle';
  applyMode?: 'insert_between' | 'replace' | 'branch';
  outputType?: 'video' | 'image';
  aspectRatio?: '16:9' | '9:16';
}

interface GenerationComposerModalProps {
  isOpen: boolean;
  projectId?: string;
  templateId?: string;
  inputPair?: GenerationInputPair;
  initialCapabilityId?: GenerationCapabilityId;
  /** ★ 画布 PromptNode 连线注入的初始提示词 */
  connectedPrompt?: { prompt?: string; negativePrompt?: string };
  /** ★ 从画布提取 Prompt 为模板节点 */
  onExtractPrompt?: (text: string, variant: 'prompt' | 'negative') => void;
  onClose: () => void;
  onSubmitted?: (event: GenerationComposerSubmitEvent) => void;
}

/** 能力分类：PRD 定义的四大类 */
type CapabilityCategory = 'repair' | 'structure' | 'style' | 'dynamic';


export interface CapabilityDefinition {
  id: GenerationCapabilityId;
  label: string;
  subtitle: string;
  group: 'video' | 'image';
  category: CapabilityCategory;
  icon: React.ComponentType<{ className?: string }>;
  promptSupported: boolean;
  available: boolean;
  hint?: string;
  /** Capability Registry 约束（P1） */
  minInputs: number;
  maxInputs: number;
  allowedMediaTypes: Array<'image' | 'video' | 'text'>;
  outputType: 'video' | 'image';
}

interface GenerationComposerPreset {
  duration: '5' | '10';
  aspectRatio: '16:9' | '9:16';
  prompt?: string;
  focusModes?: TransitionFocusMode[];
  goldenPreset?: TransitionGoldenPreset;
  boundaryMs?: number;
  variantCount?: number;
  mode?: 'pro' | 'std';
  cfgScale?: number;
  updatedAt: string;
}

const PRESET_STORAGE_KEY = 'visual-editor-generation-presets-v1';

// 转场 focus_mode / golden_preset 类型定义（参数由模板 publish_config 自动注入）
type TransitionFocusModeValue = 'outfit_change' | 'subject_preserve' | 'scene_shift';
type TransitionGoldenPresetValue = 'spin_occlusion_outfit' | 'whip_pan_outfit' | 'space_warp_outfit';

export const CAPABILITIES: CapabilityDefinition[] = [
  {
    id: 'lip_sync',
    label: '口型同步',
    subtitle: 'Lip Sync',
    group: 'video',
    category: 'repair',
    icon: Video,
    promptSupported: false,
    available: true,
    hint: '需要视频/图片 + 音频输入',
    minInputs: 1, maxInputs: 1, allowedMediaTypes: ['video', 'image'], outputType: 'video',
  },
  {
    id: 'text_to_video',
    label: '文生视频',
    subtitle: 'Text to Video',
    group: 'video',
    category: 'style',
    icon: Wand2,
    promptSupported: true,
    available: true,
    minInputs: 0, maxInputs: 0, allowedMediaTypes: ['text'], outputType: 'video',
  },
  {
    id: 'image_to_video',
    label: '图生视频',
    subtitle: 'Image to Video',
    group: 'video',
    category: 'dynamic',
    icon: Video,
    promptSupported: true,
    available: true,
    minInputs: 1, maxInputs: 1, allowedMediaTypes: ['image'], outputType: 'video',
  },
  {
    id: 'multi_image_to_video',
    label: '多图生视频',
    subtitle: 'Multi-Image',
    group: 'video',
    category: 'dynamic',
    icon: Layers,
    promptSupported: true,
    available: true,
    minInputs: 2, maxInputs: 8, allowedMediaTypes: ['image'], outputType: 'video',
  },
  {
    id: 'motion_control',
    label: '动作控制',
    subtitle: 'Motion Control',
    group: 'video',
    category: 'dynamic',
    icon: Sparkles,
    promptSupported: true,
    available: true,
    minInputs: 1, maxInputs: 2, allowedMediaTypes: ['image', 'video'], outputType: 'video',
  },
  {
    id: 'video_extend',
    label: '视频延长',
    subtitle: 'Video Extend',
    group: 'video',
    category: 'dynamic',
    icon: Video,
    promptSupported: true,
    available: true,
    hint: '延长已有视频的时长',
    minInputs: 1, maxInputs: 1, allowedMediaTypes: ['video'], outputType: 'video',
  },
  {
    id: 'face_swap',
    label: 'AI 换脸',
    subtitle: 'Face Swap',
    group: 'image',
    category: 'structure',
    icon: Sparkles,
    promptSupported: true,
    available: true,
    hint: '需要源图片 + 目标人脸图片，可选联动生成视频',
    minInputs: 2, maxInputs: 2, allowedMediaTypes: ['image'], outputType: 'image',
  },
  {
    id: 'omni_image',
    label: '图像生成',
    subtitle: 'Image Gen',
    group: 'image',
    category: 'structure',
    icon: Layers,
    promptSupported: true,
    available: true,
    minInputs: 0, maxInputs: 4, allowedMediaTypes: ['image'], outputType: 'image',
  },
  // 🆕 Enhance & Style 能力组
  {
    id: 'skin_enhance',
    label: '皮肤美化',
    subtitle: 'Skin Enhance',
    group: 'image',
    category: 'repair',
    icon: Sparkles,
    promptSupported: true,
    available: true,
    hint: '上传人像图 → AI 自动美颜',
    minInputs: 1, maxInputs: 1, allowedMediaTypes: ['image'], outputType: 'image',
  },
  {
    id: 'relight',
    label: 'AI 打光',
    subtitle: 'Relight',
    group: 'image',
    category: 'style',
    icon: Sparkles,
    promptSupported: true,
    available: true,
    hint: '上传图片 → 调整光照氛围',
    minInputs: 1, maxInputs: 1, allowedMediaTypes: ['image'], outputType: 'image',
  },
  {
    id: 'outfit_swap',
    label: '换装',
    subtitle: 'Outfit Swap',
    group: 'image',
    category: 'structure',
    icon: Wand2,
    promptSupported: true,
    available: true,
    hint: '人物图 + 衣物图 → AI 换装',
    minInputs: 2, maxInputs: 2, allowedMediaTypes: ['image'], outputType: 'image',
  },
  {
    id: 'ai_stylist',
    label: 'AI 穿搭师',
    subtitle: 'AI Stylist',
    group: 'image',
    category: 'style',
    icon: Wand2,
    promptSupported: true,
    available: true,
    hint: '上传衣物 → AI 推荐整套搭配',
    minInputs: 1, maxInputs: 3, allowedMediaTypes: ['image'], outputType: 'image',
  },
  {
    id: 'outfit_shot',
    label: 'AI 穿搭内容',
    subtitle: 'Outfit Shot',
    group: 'image',
    category: 'style',
    icon: ImageIcon,
    promptSupported: true,
    available: true,
    hint: '上传衣物 → AI 生成可发布的穿搭内容图',
    minInputs: 1, maxInputs: 3, allowedMediaTypes: ['image'], outputType: 'image',
  },
];

async function resolveInputUrl(localFile: File | null, fallback: string): Promise<string> {
  if (localFile) {
    const uploaded = await uploadTemplateSourceFile(localFile, 'generation-composer-inputs');
    return uploaded.url;
  }
  if (fallback) return fallback;
  throw new Error('请上传图片文件');
}

function hasInputSource(localFile: File | null, fallback?: string): boolean {
  return Boolean(localFile || fallback);
}

export function GenerationComposerModal({
  isOpen,
  projectId,
  templateId,
  inputPair,
  initialCapabilityId,
  connectedPrompt,
  onExtractPrompt,
  onClose,
  onSubmitted,
}: GenerationComposerModalProps) {
  // ★ 自动推断最佳能力：根据输入数量 + 媒体类型选择最匹配的能力
  // 右键菜单已经选好 initialCapabilityId；边 "+" 入口未指定时走此逻辑
  const autoCapability = useMemo((): GenerationCapabilityId => {
    if (initialCapabilityId) return initialCapabilityId;
    const count = inputPair?.allInputNodes?.length
      ?? (inputPair?.toClipId && inputPair.toClipId !== inputPair.fromClipId ? 2 : inputPair?.fromClipId ? 1 : 0);
    const types = inputPair?.inputMediaTypes || [];
    const hasVideo = types.includes('video');
    // 单输入
    if (count <= 1) {
      if (hasVideo) return 'video_extend';
      return 'image_to_video';
    }
    // 多输入
    return 'multi_image_to_video';
  }, [initialCapabilityId, inputPair]);

  const [capabilityId, setCapabilityId] = useState<GenerationCapabilityId>(autoCapability);

  // ★ 当外部能力 ID 变化时同步（右键菜单切换、inputPair 变化）
  useEffect(() => {
    setCapabilityId(autoCapability);
  }, [autoCapability]);

  const [fromImageFile, setFromImageFile] = useState<File | null>(null);
  const [toImageFile, setToImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);  // ★ lip_sync 上传音频文件
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<'5' | '10'>('5');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('9:16');
  const [focusModes, setFocusModes] = useState<TransitionFocusMode[]>(['outfit_change']);
  const [goldenPreset, setGoldenPreset] = useState<TransitionGoldenPreset>('spin_occlusion_outfit');
  const [boundaryMs, setBoundaryMs] = useState(480);
  const [variantCount, setVariantCount] = useState(1);
  const [mode, setMode] = useState<'pro' | 'std'>('pro');
  const [cfgScale, setCfgScale] = useState(0.5);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [quality, setQuality] = useState<'standard' | 'high' | 'ultra'>('high');
  const [enableTransition, setEnableTransition] = useState(false);

  // ★ Prompt 推荐 (L1)
  const [recPrompts, setRecPrompts] = useState<Array<{ id: string; prompt: string; negative_prompt?: string; label?: string; quality_score?: number }>>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [showRecs, setShowRecs] = useState(false);

  // 能力切换时拉取推荐 prompt
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoadingRecs(true);
    import('@/lib/api/prompt-library').then(({ promptLibraryApi }) => {
      return promptLibraryApi.listPrompts({ capability: capabilityId as never, page_size: 8 });
    }).then((resp) => {
      if (cancelled) return;
      if (resp.data) setRecPrompts(resp.data as never[]);
    }).catch(() => {
      // prompt 库不可用时静默失败
    }).finally(() => {
      if (!cancelled) setLoadingRecs(false);
    });
    return () => { cancelled = true; };
  }, [isOpen, capabilityId]);

  // ★ 转场模板选择（真实拉取已发布模板）
  const [transitionTemplates, setTransitionTemplates] = useState<TemplateCandidateItem[]>([]);
  const [selectedTransitionTemplate, setSelectedTransitionTemplate] = useState<TemplateCandidateItem | null>(null);
  const [transitionTemplatesLoading, setTransitionTemplatesLoading] = useState(false);

  // ★ 勾选转场时拉取已发布模板
  useEffect(() => {
    if (!enableTransition) return;
    if (transitionTemplates.length > 0) return; // 已有缓存不重复拉取
    let cancelled = false;
    setTransitionTemplatesLoading(true);
    fetchTemplateCandidates({
      scope: 'visual-studio',
      template_kind: 'transition',
      limit: 8,
    }).then((res) => {
      if (cancelled) return;
      setTransitionTemplates(res.candidates || []);
      // 自动选中第一个模板
      if (res.candidates?.length) {
        handleSelectTransitionTemplate(res.candidates[0]);
      }
    }).catch((err) => {
      if (cancelled) return;
      console.warn('[GenerationComposerModal] 拉取转场模板失败:', err);
    }).finally(() => {
      if (!cancelled) setTransitionTemplatesLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableTransition]);

  // ★ 选中转场模板 → 自动注入 publish_config 默认参数
  const handleSelectTransitionTemplate = useCallback((tpl: TemplateCandidateItem) => {
    setSelectedTransitionTemplate(tpl);
    const pc = tpl.publish_config || {};
    // golden_preset
    const gp = pc.default_golden_preset;
    if (gp === 'spin_occlusion_outfit' || gp === 'whip_pan_outfit' || gp === 'space_warp_outfit') {
      setGoldenPreset(gp);
    }
    // focus_modes
    const fm = (pc.default_focus_modes || []).filter(
      (m: string): m is TransitionFocusMode =>
        m === 'outfit_change' || m === 'subject_preserve' || m === 'scene_shift',
    );
    if (fm.length > 0) setFocusModes(fm);
    // boundary_ms
    const bms = pc.default_boundary_ms ?? tpl.transition_spec?.duration_ms;
    if (typeof bms === 'number' && bms >= 200) setBoundaryMs(bms);
    // cfg_scale
    if (typeof pc.default_cfg_scale === 'number') setCfgScale(pc.default_cfg_scale);
    // variant_count
    if (typeof pc.default_variant_count === 'number') setVariantCount(pc.default_variant_count);
  }, []);

  // ★ Prompt 直接从画布节点读取，弹窗内不可编辑
  useEffect(() => {
    if (!isOpen) return;
    setPrompt(connectedPrompt?.prompt || '');
    setNegativePrompt(connectedPrompt?.negativePrompt || '');
  }, [isOpen, connectedPrompt?.prompt, connectedPrompt?.negativePrompt]);

  // ── Enhance & Style 状态 ───────────────────────────
  const [enhanceIntensity, setEnhanceIntensity] = useState<'natural' | 'moderate' | 'max'>('natural');
  const [relightType, setRelightType] = useState<'natural' | 'studio' | 'golden_hour' | 'dramatic' | 'neon' | 'soft'>('natural');
  const [relightDirection, setRelightDirection] = useState<'front' | 'left' | 'right' | 'back' | 'top' | 'bottom'>('front');
  const [relightColor, setRelightColor] = useState('');
  const [relightIntensity, setRelightIntensity] = useState(0.7);
  const [garmentType, setGarmentType] = useState<'upper' | 'lower' | 'full'>('upper');
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [stylistOccasion, setStylistOccasion] = useState<'daily' | 'work' | 'date' | 'travel' | 'party' | ''>('');
  const [stylistSeason, setStylistSeason] = useState<'spring' | 'summer' | 'autumn' | 'winter' | ''>('');
  const [stylistGender, setStylistGender] = useState<'male' | 'female' | ''>('');
  const [outfitShotMode, setOutfitShotMode] = useState<'content' | 'try_on'>('content');
  const [outfitShotContentType, setOutfitShotContentType] = useState<'cover' | 'streetsnap' | 'lifestyle' | 'flat_lay' | 'comparison'>('cover');
  const [outfitShotPlatform, setOutfitShotPlatform] = useState<'xiaohongshu' | 'douyin' | 'instagram' | 'custom'>('xiaohongshu');

  // ★ 数字人角色选择（保持人物一致性）
  const [selectedAvatar, setSelectedAvatar] = useState<SelectedAvatar | null>(null);

  // ★ 图像生成模型选择（仅 omni_image 能力时显示）
  const [imageProvider, setImageProvider] = useState<ImageGenerationProvider>('doubao');

  /** 支持 face reference 的能力列表（仅 Kling 图像生成 API 支持） */
  const avatarSupported = (
    capabilityId === 'omni_image'
  );

  // ★ 输入节点列表 + 拖拽排序（所有图片平等，无 S/E/ref 角色）
  const [reorderedInputNodes, setReorderedInputNodes] = useState<Array<{ clipId: string; thumbnail?: string; videoUrl?: string }>>([]);
  const dragIdxRef = useRef<number | null>(null);
  // ★ 网格内上传的文件（clipId → File），提交时需上传获取 URL
  const [gridUploadedFiles, setGridUploadedFiles] = useState<Map<string, File>>(new Map());
  const gridUploadRef = useRef<HTMLInputElement>(null);

  // 当 inputPair 变化时同步
  useEffect(() => {
    if (inputPair?.allInputNodes) {
      setReorderedInputNodes([...inputPair.allInputNodes]);
      setGridUploadedFiles(new Map());
    }
  }, [inputPair?.allInputNodes]);

  const handleDragStart = useCallback((idx: number) => {
    dragIdxRef.current = idx;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdxRef.current === null || dragIdxRef.current === idx) return;
    const items = [...reorderedInputNodes];
    const [moved] = items.splice(dragIdxRef.current, 1);
    items.splice(idx, 0, moved);
    dragIdxRef.current = idx;
    setReorderedInputNodes(items);
  }, [reorderedInputNodes]);

  const handleDragEnd = useCallback(() => {
    dragIdxRef.current = null;
  }, []);

  /** 网格内上传图片 — 添加到输入列表末尾 */
  const handleGridUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const id = `upload-${Date.now()}`;
    setReorderedInputNodes(prev => [...prev, { clipId: id, thumbnail: URL.createObjectURL(file) }]);
    setGridUploadedFiles(prev => new Map(prev).set(id, file));
    e.target.value = '';
  }, []);

  /** 从网格中移除图片 */
  const removeGridNode = useCallback((clipId: string) => {
    setReorderedInputNodes(prev => prev.filter(n => n.clipId !== clipId));
    setGridUploadedFiles(prev => { const m = new Map(prev); m.delete(clipId); return m; });
  }, []);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCapPicker, setShowCapPicker] = useState(false);
  const capPickerRef = useRef<HTMLDivElement>(null);

  const capability = useMemo(
    () => CAPABILITIES.find((item) => item.id === capabilityId) || CAPABILITIES[0],
    [capabilityId],
  );

  // ★ P1: Prompt 自动建议（从节点元数据 + 能力上下文拼接）
  const suggestedPrompt = useMemo(() => {
    const parts: string[] = [];
    const descriptions = inputPair?.inputDescriptions?.filter(Boolean) || [];

    // 从节点内容描述中提取关键信息
    if (descriptions.length > 0) {
      parts.push(`节点内容：${descriptions.join(' → ')}`);
    }

    // 根据能力类型生成针对性提示
    switch (capabilityId) {
      case 'multi_image_to_video':
        parts.push('keep subject identity stable, smooth natural transition between scenes');
        if (reorderedInputNodes.length > 2) {
          parts.push(`transition through ${reorderedInputNodes.length} keyframes`);
        }
        break;
      case 'image_to_video':
        parts.push('animate with stable framing and natural cinematic motion, maintain subject details');
        break;
      case 'motion_control':
        parts.push('follow reference motion trajectory while preserving source subject identity');
        break;
      case 'omni_image':
        parts.push('photorealistic, real photograph, preserve subject identity and natural details, professional lighting, no AI artifacts');
        break;
      case 'image_generation':
        parts.push('photorealistic, real photograph, high quality, detailed, professional lighting, no AI artifacts');
        break;
      case 'text_to_video':
        parts.push('cinematic quality, smooth motion, detailed scene');
        break;
      default:
        break;
    }

    return parts.length > 0 ? parts.join('. ') + '.' : '';
  }, [capabilityId, inputPair?.inputDescriptions, reorderedInputNodes.length]);

  const showImageInputs = capabilityId !== 'text_to_video' && capabilityId !== 'video_extend';
  const needsSecondImage = capabilityId === 'multi_image_to_video' || capabilityId === 'omni_image' || capabilityId === 'outfit_swap' || capabilityId === 'face_swap';
  const requiresStartImage = capabilityId === 'image_to_video' || capabilityId === 'multi_image_to_video' || capabilityId === 'motion_control' || capabilityId === 'omni_image' || capabilityId === 'face_swap' || capabilityId === 'skin_enhance' || capabilityId === 'relight' || capabilityId === 'outfit_swap' || capabilityId === 'ai_stylist' || capabilityId === 'outfit_shot';
  const requiresSecondImage = capabilityId === 'multi_image_to_video' || capabilityId === 'outfit_swap' || capabilityId === 'face_swap';
  const requiresPrompt = capabilityId === 'text_to_video' || capabilityId === 'omni_image';

  // ★ 能力级参数可见性 — 只展示该能力实际需要的参数
  const needsDuration = capabilityId === 'image_to_video' || capabilityId === 'multi_image_to_video' || capabilityId === 'text_to_video' || capabilityId === 'motion_control';
  const needsAspectRatio = capabilityId === 'text_to_video' || capabilityId === 'multi_image_to_video' || capabilityId === 'omni_image';
  const needsMode = capabilityId === 'image_to_video' || capabilityId === 'multi_image_to_video' || capabilityId === 'text_to_video';
  const showGenericGrid = needsDuration || needsAspectRatio || needsMode;

  // ★ 统一图片网格：多节点输入时用平等网格代替独立主图/参考图槽
  // face_swap/outfit_swap 有语义化输入（场景图+人脸、人物+服装），保留独立槽
  const useUnifiedGrid = reorderedInputNodes.length >= 2 &&
    !['face_swap', 'outfit_swap'].includes(capabilityId);

  const outputMediaLabel = capability.group === 'video' ? '视频' : '图片';

  const promptPreview = useMemo(() => {
    const trimmed = prompt.trim();
    if (trimmed) return trimmed;

    if (capabilityId === 'multi_image_to_video') {
      return `smooth transition from clip ${inputPair?.fromClipId?.slice(0, 8) || 'A'} to clip ${inputPair?.toClipId?.slice(0, 8) || 'B'}, keep subject identity stable.`;
    }
    if (capabilityId === 'image_to_video') {
      return `animate the source image with stable framing and natural cinematic motion.`;
    }
    if (capabilityId === 'motion_control') {
      return `follow the reference motion trajectory while preserving the source subject.`;
    }
    if (capabilityId === 'omni_image') {
      return `blend input images with consistent identity and clean details.`;
    }
    return '';
  }, [capabilityId, inputPair?.fromClipId, inputPair?.toClipId, prompt]);

  const validateStepOne = useCallback((): string | null => {
    if (!capability.available) {
      return capability.hint || '该能力暂未开放';
    }

    // 统一网格模式：检查图片数量是否满足能力最低要求
    if (useUnifiedGrid) {
      const gridCount = reorderedInputNodes.filter(n => n.thumbnail).length;
      if (gridCount < (capability.minInputs || 1)) {
        return `需要至少 ${capability.minInputs} 张输入图片`;
      }
    }

    const fallbackFrom = inputPair?.fromThumbnail || '';
    const fallbackTo = inputPair?.toThumbnail || fallbackFrom;

    if (!useUnifiedGrid && requiresStartImage && !hasInputSource(fromImageFile, fallbackFrom)) {
      return capabilityId === 'face_swap'
        ? 'AI 换脸需要源图片（场景图）'
        : '请提供输入图片';
    }

    if (!useUnifiedGrid && requiresSecondImage && !hasInputSource(toImageFile, fallbackTo)) {
      return capabilityId === 'face_swap'
        ? 'AI 换脸需要目标人脸照片'
        : '请提供第二张输入图片';
    }

    if ((capabilityId === 'motion_control' || capabilityId === 'lip_sync')) {
      const motionRef = inputPair?.toVideoUrl || inputPair?.fromVideoUrl || '';
      if (!motionRef) {
        return capabilityId === 'lip_sync' ? '口型同步需要视频输入' : '动作控制需要 Motion 视频';
      }
    }

    if (requiresPrompt && !prompt.trim()) {
      return '当前能力需要填写 prompt';
    }

    return null;
  }, [
    capability.available,
    capability.hint,
    capabilityId,
    fromImageFile,
    inputPair?.fromThumbnail,
    inputPair?.fromVideoUrl,
    inputPair?.toThumbnail,
    inputPair?.toVideoUrl,
    prompt,
    requiresPrompt,
    requiresSecondImage,
    requiresStartImage,
    toImageFile,
  ]);

  const loadCapabilityPreset = useCallback((targetCapability: GenerationCapabilityId) => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw) as Record<string, GenerationComposerPreset>;
      const preset = payload[targetCapability];
      if (!preset) return;
      setDuration(preset.duration || '5');
      setAspectRatio(preset.aspectRatio || '9:16');
      if (preset.focusModes?.length) setFocusModes(preset.focusModes);
      if (preset.goldenPreset) setGoldenPreset(preset.goldenPreset);
      if (typeof preset.boundaryMs === 'number') setBoundaryMs(Math.max(200, Math.min(2000, preset.boundaryMs)));
      if (typeof preset.variantCount === 'number') setVariantCount(Math.max(1, Math.min(3, preset.variantCount)));
      if (preset.mode) setMode(preset.mode);
      if (typeof preset.cfgScale === 'number') setCfgScale(Math.max(0, Math.min(1, preset.cfgScale)));
    } catch (err) {
      console.warn('[GenerationComposerModal] 加载模板参数失败:', err);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setDuration('5');
    setAspectRatio('9:16');
    setFocusModes(['outfit_change']);
    setGoldenPreset('spin_occlusion_outfit');
    setBoundaryMs(480);
    setVariantCount(1);
    setMode('pro');
    setCfgScale(0.5);
    setFromImageFile(null);
    setToImageFile(null);
    setAudioFile(null);
    setCapabilityId(autoCapability);
    setSeed(undefined);
    setQuality('high');
    setEnableTransition(false);
    setTransitionTemplates([]);
    setSelectedTransitionTemplate(null);
    setTransitionTemplatesLoading(false);
    setGridUploadedFiles(new Map());
    setShowCapPicker(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, autoCapability]);

  // ★ 点击外部关闭能力选择器
  useEffect(() => {
    if (!showCapPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (capPickerRef.current && !capPickerRef.current.contains(e.target as Node)) {
        setShowCapPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCapPicker]);

  useEffect(() => {
    if (!isOpen) return;
    loadCapabilityPreset(capabilityId);
  }, [capabilityId, isOpen, loadCapabilityPreset]);

  const handleSubmit = useCallback(async () => {
    const validationError = validateStepOne();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const fallbackFrom = inputPair?.fromThumbnail || '';
      const fallbackTo = inputPair?.toThumbnail || fallbackFrom;
      let firstImageUrl = '';
      let secondImageUrl = '';

      const ensureFirstImage = async () => {
        if (!firstImageUrl) {
          firstImageUrl = await resolveInputUrl(fromImageFile, fallbackFrom);
        }
        return firstImageUrl;
      };

      const ensureSecondImage = async () => {
        if (!secondImageUrl) {
          secondImageUrl = await resolveInputUrl(toImageFile, fallbackTo);
        }
        return secondImageUrl;
      };

      const promptText = prompt.trim();
      const finalPrompt = promptText || promptPreview || undefined;
      let taskId = '';
      let payloadSnapshot: Record<string, unknown> = {};

      switch (capabilityId) {
        case 'text_to_video': {
          if (!promptText) throw new Error('文生视频需要输入 prompt');
          const payload = {
            prompt: promptText,
            duration,
            aspect_ratio: aspectRatio,
          };
          payloadSnapshot = payload;
          const result = await createTextToVideoTask(payload, projectId);
          taskId = result.task_id;
          break;
        }
        case 'image_to_video': {
          const payload = {
            image: await ensureFirstImage(),
            prompt: finalPrompt,
            duration,
            cfg_scale: cfgScale,
          };
          payloadSnapshot = payload;
          const result = await createImageToVideoTask(payload, projectId);
          taskId = result.task_id;
          break;
        }
        case 'multi_image_to_video': {
          // ★ 统一网格：收集所有输入图片（含用户上传）
          const images: string[] = [];
          if (reorderedInputNodes.length >= 2) {
            for (const node of reorderedInputNodes) {
              const localFile = gridUploadedFiles.get(node.clipId);
              if (localFile) {
                const uploaded = await uploadTemplateSourceFile(localFile, 'generation-composer-inputs');
                images.push(uploaded.url);
              } else if (node.thumbnail) {
                images.push(node.thumbnail);
              }
            }
          }
          if (images.length < 2) {
            images.length = 0;
            images.push(await ensureFirstImage());
            images.push(await ensureSecondImage());
          }
          const payload = {
            images: images.filter(Boolean),
            prompt: finalPrompt,
            duration,
            cfg_scale: cfgScale,
          };
          payloadSnapshot = {
            ...payload,
            mode,
            ...(enableTransition ? {
              focus_modes: focusModes,
              golden_preset: goldenPreset,
              boundary_ms: boundaryMs,
              variant_count: variantCount,
            } : {}),
          };
          const result = await createMultiImageToVideoTask(payload, projectId);
          taskId = result.task_id;
          break;
        }
        case 'motion_control': {
          const videoUrl = inputPair?.toVideoUrl || inputPair?.fromVideoUrl || '';
          if (!videoUrl) {
            throw new Error('动作控制需要视频参考');
          }
          const payload = {
            image: await ensureFirstImage(),
            video_url: videoUrl,
            prompt: finalPrompt,
            duration,
            cfg_scale: cfgScale,
          };
          payloadSnapshot = payload;
          const result = await createMotionControlTask(payload, projectId);
          taskId = result.task_id;
          break;
        }
        case 'omni_image': {
          if (!promptText) throw new Error('图像生成需要输入 prompt');
          // 收集参考图 URL 列表
          const imageUrls: string[] = [];
          if (fromImageFile || fallbackFrom) {
            imageUrls.push(await ensureFirstImage());
          }
          if (needsSecondImage) {
            imageUrls.push(await ensureSecondImage());
          }

          if (imageProvider === 'kling') {
            // Kling 走原有 omni_image 接口（保留 image_list 格式）
            const imageList = imageUrls.map((url, i) => ({
              image: url,
              var: `image_${String.fromCharCode(97 + i)}`,
            }));
            const payload = {
              prompt: promptText,
              ...(imageList.length > 0 ? { image_list: imageList } : {}),
              n: 1,
              aspect_ratio: aspectRatio,
              ...(selectedAvatar ? { avatar_id: selectedAvatar.id } : {}),
            };
            payloadSnapshot = payload;
            const result = await createOmniImageTask(payload, projectId);
            taskId = result.task_id;
          } else {
            // Doubao / 统一路由
            const payload = {
              provider: imageProvider,
              capability: 'omni_image' as const,
              prompt: promptText,
              ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
              ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
              n: 1,
              aspect_ratio: aspectRatio,
              ...(selectedAvatar ? { avatar_id: selectedAvatar.id } : {}),
            };
            payloadSnapshot = payload;
            const result = await createUnifiedImageTask(payload, projectId);
            taskId = result.task_id;
          }
          break;
        }
        case 'lip_sync': {
          const videoUrl = inputPair?.fromVideoUrl || '';
          if (!videoUrl) throw new Error('口型同步需要视频输入');
          if (!audioFile) throw new Error('口型同步需要上传音频文件');
          // 上传音频文件获取 URL
          const audioFormData = new FormData();
          audioFormData.append('file', audioFile);
          audioFormData.append('prefix', 'visual-editor/audio');
          const audioResp = await (await import('@/lib/supabase/session')).authFetch('/api/upload/audio', { method: 'POST', body: audioFormData });
          if (!audioResp.ok) throw new Error('音频文件上传失败');
          const audioData = await audioResp.json();
          const audioInput = audioData.url as string;
          const payload = {
            video_url: videoUrl,
            audio_url: audioInput,
          };
          payloadSnapshot = payload;
          const result = await createLipSyncTask(payload, projectId);
          taskId = result.task_id || result.id;
          break;
        }
        case 'video_extend': {
          const vid = inputPair?.fromVideoUrl || '';
          if (!vid) throw new Error('视频延长需要源视频输入');
          const payload = {
            video_id: vid,
            prompt: finalPrompt,
            cfg_scale: cfgScale,
          };
          payloadSnapshot = payload;
          const result = await createVideoExtendTask(payload, projectId);
          taskId = result.task_id;
          break;
        }
        case 'face_swap': {
          const sourceImageUrl = await ensureFirstImage();
          if (!sourceImageUrl) throw new Error('AI 换脸需要源图片');
          const faceImageUrl = await ensureSecondImage();
          if (!faceImageUrl) throw new Error('AI 换脸需要目标人脸图片');
          if (imageProvider === 'kling') {
            const payload = {
              source_image_url: sourceImageUrl,
              face_image_url: faceImageUrl,
              custom_prompt: prompt.trim() || undefined,
            };
            payloadSnapshot = payload;
            const result = await createFaceSwapTask(payload, projectId);
            taskId = result.task_id;
          } else {
            const payload = {
              provider: imageProvider,
              capability: 'face_swap' as const,
              prompt: prompt.trim(),
              image_urls: [sourceImageUrl, faceImageUrl],
            };
            payloadSnapshot = payload;
            const result = await createUnifiedImageTask(payload, projectId);
            taskId = result.task_id;
          }
          break;
        }
        // ── Enhance & Style 五大能力 ──────────────────────
        case 'skin_enhance': {
          const imageUrl = await ensureFirstImage();
          if (!imageUrl) throw new Error('皮肤优化需要输入图片');
          if (imageProvider === 'kling') {
            const payload = {
              image_url: imageUrl,
              intensity: (enhanceIntensity || 'natural') as 'natural' | 'moderate' | 'max',
              custom_prompt: prompt.trim() || undefined,
            };
            payloadSnapshot = payload;
            const result = await createSkinEnhanceTask(payload, projectId);
            taskId = result.task_id;
          } else {
            const payload = {
              provider: imageProvider,
              capability: 'skin_enhance' as const,
              prompt: prompt.trim(),
              image_urls: [imageUrl],
              extra_params: { intensity: enhanceIntensity || 'natural' },
            };
            payloadSnapshot = payload;
            const result = await createUnifiedImageTask(payload, projectId);
            taskId = result.task_id;
          }
          break;
        }
        case 'relight': {
          const imageUrl = await ensureFirstImage();
          if (!imageUrl) throw new Error('AI 打光需要输入图片');
          if (imageProvider === 'kling') {
            const payload = {
              image_url: imageUrl,
              light_type: relightType || 'natural',
              light_direction: relightDirection || 'front',
              light_color: relightColor || undefined,
              light_intensity: relightIntensity,
              custom_prompt: prompt.trim() || undefined,
            };
            payloadSnapshot = payload;
            const result = await createRelightTask(payload, projectId);
            taskId = result.task_id;
          } else {
            const payload = {
              provider: imageProvider,
              capability: 'relight' as const,
              prompt: prompt.trim(),
              image_urls: [imageUrl],
              extra_params: {
                light_type: relightType || 'natural',
                light_direction: relightDirection || 'front',
                light_color: relightColor || undefined,
                light_intensity: relightIntensity,
              },
            };
            payloadSnapshot = payload;
            const result = await createUnifiedImageTask(payload, projectId);
            taskId = result.task_id;
          }
          break;
        }
        case 'outfit_swap': {
          const personUrl = await ensureFirstImage();
          if (!personUrl) throw new Error('AI 换装需要人物图片');
          const garmentUrl = await ensureSecondImage();
          if (!garmentUrl) throw new Error('AI 换装需要服装图片');
          if (imageProvider === 'kling') {
            const payload = {
              person_image_url: personUrl,
              garment_image_url: garmentUrl,
              garment_type: (garmentType || 'upper') as 'upper' | 'lower' | 'full',
              custom_prompt: prompt.trim() || undefined,
            };
            payloadSnapshot = payload;
            const result = await createOutfitSwapTask(payload, projectId);
            taskId = result.task_id;
          } else {
            const payload = {
              provider: imageProvider,
              capability: 'outfit_swap' as const,
              prompt: prompt.trim(),
              image_urls: [personUrl, garmentUrl],
              extra_params: { garment_type: garmentType || 'upper' },
            };
            payloadSnapshot = payload;
            const result = await createUnifiedImageTask(payload, projectId);
            taskId = result.task_id;
          }
          break;
        }
        case 'ai_stylist': {
          const garmentUrl = await ensureFirstImage();
          if (!garmentUrl) throw new Error('AI 搭配师需要服装图片');
          if (imageProvider === 'kling') {
            const payload = {
              garment_image_url: garmentUrl,
              style_tags: styleTags.length > 0 ? styleTags : undefined,
              occasion: stylistOccasion || undefined,
              season: stylistSeason || undefined,
              gender: stylistGender || undefined,
              num_variations: variantCount > 1 ? variantCount : undefined,
              custom_prompt: prompt.trim() || undefined,
            };
            payloadSnapshot = payload;
            const result = await createAIStylistTask(payload, projectId);
            taskId = result.task_id;
          } else {
            const payload = {
              provider: imageProvider,
              capability: 'ai_stylist' as const,
              prompt: prompt.trim(),
              image_urls: [garmentUrl],
              extra_params: {
                style_tags: styleTags.length > 0 ? styleTags : undefined,
                occasion: stylistOccasion || undefined,
                season: stylistSeason || undefined,
                gender: stylistGender || undefined,
                num_variations: variantCount > 1 ? variantCount : undefined,
              },
            };
            payloadSnapshot = payload;
            const result = await createUnifiedImageTask(payload, projectId);
            taskId = result.task_id;
          }
          break;
        }
        case 'outfit_shot': {
          // 收集 1~3 张服装图片
          const garmentImages: string[] = [];
          garmentImages.push(await ensureFirstImage());
          if (toImageFile || inputPair?.toThumbnail) {
            garmentImages.push(await ensureSecondImage());
          }
          // 来自 reorderedInputNodes 的额外图片
          for (const node of reorderedInputNodes.slice(2)) {
            if (node.thumbnail) garmentImages.push(node.thumbnail);
          }
          if (garmentImages.length === 0) throw new Error('穿搭内容生成至少需要 1 张服装图片');
          if (imageProvider === 'kling') {
            const payload = {
              garment_images: garmentImages.filter(Boolean),
              mode: (outfitShotMode || 'content') as 'content' | 'try_on',
              content_type: outfitShotContentType || 'cover',
              platform_preset: outfitShotPlatform || 'xiaohongshu',
              gender: stylistGender || undefined,
              scene_prompt: prompt.trim() || undefined,
              num_variations: variantCount > 1 ? variantCount : undefined,
            };
            payloadSnapshot = payload;
            const result = await createOutfitShotTask(payload, projectId);
            taskId = result.task_id;
          } else {
            const payload = {
              provider: imageProvider,
              capability: 'outfit_shot' as const,
              prompt: prompt.trim(),
              image_urls: garmentImages.filter(Boolean),
              extra_params: {
                mode: outfitShotMode || 'content',
                content_type: outfitShotContentType || 'cover',
                platform_preset: outfitShotPlatform || 'xiaohongshu',
                gender: stylistGender || undefined,
                num_variations: variantCount > 1 ? variantCount : undefined,
              },
            };
            payloadSnapshot = payload;
            const result = await createUnifiedImageTask(payload, projectId);
            taskId = result.task_id;
          }
          break;
        }
        default:
          throw new Error('该能力暂未接入到画布工作流');
      }

      // ★ 先触发 onSubmitted，立即在画布上创建占位节点（不依赖 addAITaskToProject 成功）
      onSubmitted?.({
        taskId,
        capabilityId,
        capabilityLabel: capability.label,
        prompt: promptText || undefined,
        finalPrompt,
        sourceClipId: inputPair?.fromClipId,
        targetClipId: inputPair?.toClipId,
        inputNodes: reorderedInputNodes.length > 0
          ? reorderedInputNodes.map((n) => ({
              role: 'input' as const,
              clipId: n.clipId,
              url: n.thumbnail,
            }))
          : [
              { role: 'input' as const, clipId: inputPair?.fromClipId, url: inputPair?.fromThumbnail || undefined },
              ...(inputPair?.toClipId ? [{ role: 'input' as const, clipId: inputPair.toClipId, url: inputPair?.toThumbnail || undefined }] : []),
            ].filter((item) => item.clipId || item.url),
        payloadSnapshot,
        // ★ P1: 多图任务统一协议字段
        ordering: reorderedInputNodes.length > 2 ? 'manual' : 'sequence',
        generationMode: reorderedInputNodes.length > 2 ? 'cycle' : reorderedInputNodes.length === 2 ? 'multi' : 'single',
        applyMode: 'insert_between',
        outputType: capability.outputType,
        aspectRatio,
      });
      onClose();

      // NOTE: 不在此处调用 addAITaskToProject —— 任务刚提交时 status=pending/processing,
      // 后端要求 completed 才能创建 asset。画布占位节点已通过 onSubmitted 创建，
      // 任务完成后由 Realtime 订阅 + 画布节点更新逻辑补全关联。
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交生成任务失败');
    } finally {
      setSubmitting(false);
    }
  }, [
    capability,
    capabilityId,
    duration,
    aspectRatio,
    boundaryMs,
    cfgScale,
    enableTransition,
    focusModes,
    goldenPreset,
    gridUploadedFiles,
    imageProvider,
    mode,
    variantCount,
    fromImageFile,
    inputPair,
    needsSecondImage,
    onClose,
    onSubmitted,
    projectId,
    prompt,
    promptPreview,
    reorderedInputNodes,
    selectedAvatar,
    toImageFile,
    validateStepOne,
    enhanceIntensity,
    relightType,
    relightDirection,
    relightColor,
    relightIntensity,
    garmentType,
    styleTags,
    stylistOccasion,
    stylistSeason,
    stylistGender,
    outfitShotMode,
    outfitShotContentType,
    outfitShotPlatform,
    negativePrompt,
  ]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[860px] max-w-[96vw] max-h-[92vh] overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-3">
            {/* ★ 能力选择器 — 点击切换 AI 能力 */}
            <div className="relative" ref={capPickerRef}>
              <button
                onClick={() => setShowCapPicker(prev => !prev)}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl hover:bg-gray-50 transition-colors group"
              >
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-gray-900 text-white shrink-0">
                  <capability.icon className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-1">
                    <h3 className="text-sm font-semibold text-gray-900">{capability.label}</h3>
                    <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${showCapPicker ? 'rotate-180' : ''}`} />
                  </div>
                  <p className="text-[11px] text-gray-400">{capability.subtitle}</p>
                </div>
              </button>
              {/* ★ 下拉面板 — 所有可用能力 */}
              {showCapPicker && (
                <div className="absolute top-full left-0 mt-1 z-50 w-[340px] max-h-[400px] overflow-y-auto rounded-xl bg-white border border-gray-200 shadow-xl py-1">
                  {(['dynamic', 'structure', 'style', 'repair'] as CapabilityCategory[]).map(cat => {
                    const capsInCat = CAPABILITIES.filter(c => c.available && c.category === cat);
                    if (capsInCat.length === 0) return null;
                    const catLabel = { dynamic: '动态生成', structure: '结构变换', style: '风格调整', repair: '修复增强' }[cat];
                    return (
                      <div key={cat}>
                        <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{catLabel}</div>
                        {capsInCat.map(cap => {
                          const CapIcon = cap.icon;
                          const isSelected = cap.id === capabilityId;
                          return (
                            <button
                              key={cap.id}
                              onClick={() => {
                                setCapabilityId(cap.id);
                                setShowCapPicker(false);
                              }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                                isSelected
                                  ? 'bg-gray-900 text-white'
                                  : 'hover:bg-gray-50 text-gray-700'
                              }`}
                            >
                              <CapIcon className={`h-4 w-4 shrink-0 ${isSelected ? 'text-white' : 'text-gray-400'}`} />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium">{cap.label}</div>
                                <div className={`text-[10px] ${isSelected ? 'text-gray-300' : 'text-gray-400'}`}>
                                  {cap.subtitle}{cap.hint ? ` · ${cap.hint}` : ''}
                                </div>
                              </div>
                              {cap.minInputs > 1 && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${isSelected ? 'bg-white/20 text-gray-200' : 'bg-gray-100 text-gray-400'}`}>
                                  {cap.minInputs}图
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {/* ★ 模型选择器 — 所有 outputType=image 的能力显示 */}
            {capability.outputType === 'image' && (
              <div className="flex items-center gap-1.5 ml-3 rounded-lg border border-gray-200 overflow-hidden">
                {([
                  { value: 'doubao' as const, label: 'Doubao Seedream' },
                  { value: 'kling' as const, label: 'Kling Image' },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setImageProvider(opt.value)}
                    className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                      imageProvider === opt.value
                        ? 'bg-gray-800 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-12 gap-0 max-h-[calc(92vh-56px)]">
          {/* ── 左栏：输入素材 ── */}
          <div className="col-span-4 border-r border-gray-100 p-4 space-y-3 overflow-y-auto">
            <div className="text-xs font-medium text-gray-500">输入素材</div>

            {/* ★ 统一图片网格 — 多节点输入时所有图片平等展示，无 S/E/ref 角色 */}
            {useUnifiedGrid && (
              <div className="space-y-2">
                <div className="text-[11px] text-gray-400">
                  共 {reorderedInputNodes.length} 张图片，拖拽调整顺序
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {reorderedInputNodes.map((node, idx) => (
                    <div
                      key={node.clipId}
                      className="group relative flex-shrink-0 cursor-grab active:cursor-grabbing"
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="w-16 h-16 rounded-lg border-2 border-gray-200 hover:border-gray-400 overflow-hidden transition-colors">
                        {node.thumbnail ? (
                          <img src={node.thumbnail} alt="" className="w-full h-full object-cover pointer-events-none" />
                        ) : (
                          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                            <ImageIcon className="w-4 h-4 text-gray-300" />
                          </div>
                        )}
                      </div>
                      <button type="button" onClick={() => removeGridNode(node.clipId)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-700 text-white flex items-center justify-center text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                        title="移除">×</button>
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] bg-white/90 text-gray-500 rounded px-1 leading-tight">
                        {idx + 1}
                      </span>
                    </div>
                  ))}
                  {/* 添加更多图片 */}
                  <div className="flex-shrink-0">
                    <button type="button" onClick={() => gridUploadRef.current?.click()}
                      className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-400 flex items-center justify-center transition-colors group">
                      <Plus className="w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
                    </button>
                    <input ref={gridUploadRef} type="file" accept="image/*" onChange={handleGridUpload} className="hidden" />
                  </div>
                </div>
              </div>
            )}

            {/* 独立输入槽 — 非网格模式或语义化能力（face_swap/outfit_swap）*/}
            {showImageInputs && !useUnifiedGrid && (
              <div className="space-y-2">
                <ImageInputSlot
                  label={capabilityId === 'face_swap' ? '场景图' : '输入图片'}
                  required={requiresStartImage}
                  thumbnail={fromImageFile ? URL.createObjectURL(fromImageFile) : inputPair?.fromThumbnail}
                  localFile={fromImageFile}
                  onFileChange={(f) => setFromImageFile(f)}
                />
                {needsSecondImage && (
                  <ImageInputSlot
                    label={capabilityId === 'face_swap' ? '人脸照片' : capabilityId === 'outfit_swap' ? '服装图' : '参考图'}
                    required={requiresSecondImage}
                    thumbnail={toImageFile ? URL.createObjectURL(toImageFile) : inputPair?.toThumbnail}
                    localFile={toImageFile}
                    onFileChange={(f) => setToImageFile(f)}
                  />
                )}
              </div>
            )}

            {!showImageInputs && !useUnifiedGrid && (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-xs text-gray-400">
                该能力无需图片输入
              </div>
            )}

            {/* lip_sync 音频 */}
            {capabilityId === 'lip_sync' && (
              <div className="space-y-1.5">
                <div className="text-xs text-gray-500">音频文件 <span className="text-red-400">*</span></div>
                <label className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2.5 cursor-pointer hover:border-gray-300 transition-colors">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <span className="text-xs text-gray-500">{audioFile ? `✓ ${audioFile.name}` : '选择音频'}</span>
                </label>
              </div>
            )}

            {/* 数字人 */}
            {avatarSupported && (
              <AvatarSelector
                disabled={false}
                value={selectedAvatar}
                onChange={setSelectedAvatar}
              />
            )}
          </div>

          {/* ── 右栏：参数 + Prompt + 生成 ── */}
          <div className="col-span-8 p-4 space-y-3 overflow-y-auto">
            {/* 通用参数行 — 按钮组 */}
            {showGenericGrid && (
              <div className="flex items-center gap-3 flex-wrap">
                {needsDuration && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">时长</span>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                      {(['5', '10'] as const).map(v => (
                        <button key={v} onClick={() => setDuration(v)}
                          className={`px-3 py-1.5 text-xs transition-colors ${duration === v ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >{v}s</button>
                      ))}
                    </div>
                  </div>
                )}
                {needsAspectRatio && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">比例</span>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                      {(['9:16', '16:9'] as const).map(v => (
                        <button key={v} onClick={() => setAspectRatio(v)}
                          className={`px-3 py-1.5 text-xs transition-colors ${aspectRatio === v ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >{v}</button>
                      ))}
                    </div>
                  </div>
                )}
                {needsMode && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">模式</span>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                      {(['pro', 'std'] as const).map(v => (
                        <button key={v} onClick={() => setMode(v)}
                          className={`px-3 py-1.5 text-xs transition-colors ${mode === v ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >{v}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 转场效果 — 选模板驱动，参数自动注入 */}
            {capabilityId === 'multi_image_to_video' && (
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <label className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors select-none">
                  <input
                    type="checkbox"
                    checked={enableTransition}
                    onChange={(e) => setEnableTransition(e.target.checked)}
                    className="rounded border-gray-300 text-gray-800 focus:ring-gray-500 h-3.5 w-3.5"
                  />
                  <span className="text-xs font-medium text-gray-700">转场效果</span>
                  <span className="text-[10px] text-gray-400">可选 · 选择模板自动配置</span>
                </label>
                {enableTransition && (
                  <div className="border-t border-gray-100 px-3 pb-3 pt-3 space-y-3">
                    {/* 模板加载中 */}
                    {transitionTemplatesLoading && (
                      <div className="flex items-center justify-center py-6 text-xs text-gray-400">
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        正在加载转场模板…
                      </div>
                    )}

                    {/* 无模板 */}
                    {!transitionTemplatesLoading && transitionTemplates.length === 0 && (
                      <div className="py-4 text-center text-xs text-gray-400">
                        暂无已发布的转场模板
                      </div>
                    )}

                    {/* 模板卡片网格 */}
                    {!transitionTemplatesLoading && transitionTemplates.length > 0 && (
                      <>
                        <div className="grid grid-cols-4 gap-2">
                          {transitionTemplates.slice(0, 8).map((tpl) => {
                            const isSelected = selectedTransitionTemplate?.template_id === tpl.template_id;
                            const displayName = tpl.publish_config?.display_name || tpl.name;
                            return (
                              <button
                                key={tpl.template_id}
                                type="button"
                                onClick={() => handleSelectTransitionTemplate(tpl)}
                                className={`group relative rounded-lg border overflow-hidden text-left transition-all ${
                                  isSelected
                                    ? 'border-gray-800 ring-1 ring-gray-800 shadow-md'
                                    : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                                }`}
                              >
                                {/* 缩略图 / 预览视频 */}
                                <div className="relative aspect-[4/3] bg-gray-50 overflow-hidden">
                                  {tpl.preview_video_url ? (
                                    <>
                                      <img
                                        src={tpl.thumbnail_url || ''}
                                        alt={displayName}
                                        className="w-full h-full object-cover group-hover:opacity-0 transition-opacity"
                                      />
                                      <video
                                        src={tpl.preview_video_url}
                                        muted
                                        loop
                                        playsInline
                                        className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity"
                                        onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                                        onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                                      />
                                    </>
                                  ) : tpl.thumbnail_url ? (
                                    <img src={tpl.thumbnail_url} alt={displayName} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Sparkles className="h-5 w-5 text-gray-300" />
                                    </div>
                                  )}
                                  {/* 选中勾号 */}
                                  {isSelected && (
                                    <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center">
                                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    </div>
                                  )}
                                  {/* 精选标签 */}
                                  {tpl.quality_label === 'golden' && (
                                    <span className="absolute top-1 left-1 bg-gray-800/80 text-white text-[9px] font-medium px-1 py-0.5 rounded">
                                      ⭐
                                    </span>
                                  )}
                                </div>
                                {/* 名称 */}
                                <div className="px-1.5 py-1.5">
                                  <div className={`text-[11px] truncate ${isSelected ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                                    {displayName}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* 选中模板后的简化控制 */}
                        {selectedTransitionTemplate && (
                          <div className="flex items-center gap-3 pt-1">
                            {/* 生成数量 */}
                            <div className="flex items-center gap-1.5">
                              <label className="text-[11px] text-gray-500 whitespace-nowrap">生成数量</label>
                              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                                {[1, 2, 3].map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setVariantCount(n)}
                                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                      variantCount === n
                                        ? 'bg-gray-800 text-white'
                                        : 'bg-white text-gray-500 hover:bg-gray-50'
                                    }`}
                                  >
                                    {n}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* 转场时长 slider */}
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <label className="text-[11px] text-gray-500 whitespace-nowrap">时长</label>
                              <input
                                type="range"
                                min={200} max={1200} step={40}
                                value={boundaryMs}
                                onChange={(e) => setBoundaryMs(Number(e.target.value))}
                                className="flex-1 accent-gray-700 h-1"
                              />
                              <span className="text-[10px] text-gray-400 tabular-nums w-10 text-right">
                                {boundaryMs >= 800 ? '长' : boundaryMs >= 400 ? '中' : '短'}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Enhance & Style 参数 */}
            {capabilityId === 'skin_enhance' && (
              <SkinEnhanceControls intensity={enhanceIntensity} onIntensityChange={setEnhanceIntensity} />
            )}
            {capabilityId === 'relight' && (
              <RelightControls
                lightType={relightType} lightDirection={relightDirection}
                lightColor={relightColor} lightIntensity={relightIntensity}
                onLightTypeChange={(v) => setRelightType(v as typeof relightType)}
                onLightDirectionChange={(v) => setRelightDirection(v as typeof relightDirection)}
                onLightColorChange={setRelightColor} onLightIntensityChange={setRelightIntensity}
              />
            )}
            {capabilityId === 'outfit_swap' && (
              <OutfitSwapControls garmentType={garmentType} onGarmentTypeChange={setGarmentType} />
            )}
            {capabilityId === 'ai_stylist' && (
              <StylistControls
                styleTags={styleTags} occasion={stylistOccasion} season={stylistSeason} gender={stylistGender}
                onStyleTagsChange={setStyleTags}
                onOccasionChange={(v) => setStylistOccasion(v as typeof stylistOccasion)}
                onSeasonChange={(v) => setStylistSeason(v as typeof stylistSeason)}
                onGenderChange={(v) => setStylistGender(v as typeof stylistGender)}
              />
            )}
            {capabilityId === 'outfit_shot' && (
              <OutfitShotControls
                mode={outfitShotMode} contentType={outfitShotContentType}
                platformPreset={outfitShotPlatform} gender={stylistGender} variantCount={variantCount}
                onModeChange={setOutfitShotMode}
                onContentTypeChange={(v) => setOutfitShotContentType(v as typeof outfitShotContentType)}
                onPlatformPresetChange={(v) => setOutfitShotPlatform(v as typeof outfitShotPlatform)}
                onGenderChange={(v) => setStylistGender(v as typeof stylistGender)}
                onVariantCountChange={setVariantCount}
              />
            )}

            {/* ★ Prompt 推荐 (L1) */}
            {recPrompts.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowRecs(prev => !prev)}
                  className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <BookOpen className="h-3 w-3" />
                  <span>Prompt 推荐</span>
                  <span className="text-gray-400">({recPrompts.length})</span>
                  <ChevronDown className={`h-3 w-3 transition-transform ${showRecs ? 'rotate-180' : ''}`} />
                </button>
                {showRecs && (
                  <div className="grid grid-cols-2 gap-1.5 max-h-[140px] overflow-y-auto">
                    {recPrompts.map((rec) => (
                      <button
                        key={rec.id}
                        onClick={() => {
                          setPrompt(rec.prompt);
                          if (rec.negative_prompt) setNegativePrompt(rec.negative_prompt);
                        }}
                        className={`text-left p-2 rounded-lg border text-[11px] leading-relaxed transition-all hover:border-gray-400 hover:bg-gray-50 ${
                          prompt === rec.prompt ? 'border-gray-800 bg-gray-50' : 'border-gray-200'
                        }`}
                        title={rec.prompt}
                      >
                        <div className="font-medium text-gray-700 truncate">
                          {rec.label || rec.prompt.slice(0, 30)}
                        </div>
                        <div className="text-gray-400 line-clamp-2 mt-0.5">
                          {rec.prompt.slice(0, 80)}{rec.prompt.length > 80 ? '…' : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {loadingRecs && (
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                加载推荐 Prompt…
              </div>
            )}

            {/* Seed / Quality */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-gray-500">Seed</label>
                <input type="number" min={0} value={seed ?? ''}
                  onChange={(e) => setSeed(e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="随机"
                  className="h-8 w-full rounded-lg border border-gray-200 px-2 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-gray-500">Quality</label>
                <select value={quality} onChange={(e) => setQuality(e.target.value as 'standard' | 'high' | 'ultra')}
                  className="h-8 w-full rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="standard">Standard</option>
                  <option value="high">High</option>
                  <option value="ultra">Ultra</option>
                </select>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between pt-1">
              <div className="text-[11px] text-gray-400">
                {needsDuration && `⏱ 预计 ${duration === '10' ? '3~5' : '1~3'} 分钟`}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onClose}
                  className="h-9 rounded-lg border border-gray-200 px-4 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
                  取消
                </button>
                <button onClick={handleSubmit} disabled={submitting || !capability.available}
                  className="h-9 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-2 transition-colors">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  生成{outputMediaLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ★ 图片输入槽组件 — 简洁的缩略图 + 替换上传 */
function ImageInputSlot({
  label,
  required,
  thumbnail,
  localFile,
  onFileChange,
}: {
  label: string;
  required: boolean;
  thumbnail?: string;
  localFile: File | null;
  onFileChange: (file: File | null) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center gap-3 p-2">
        <div
          className="w-16 h-16 rounded-md bg-gray-100 flex-shrink-0 overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => inputRef.current?.click()}
        >
          {thumbnail ? (
            <img src={thumbnail} alt={label} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-gray-300" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-gray-700">
            {label}
            {required && <span className="text-red-400 ml-0.5">*</span>}
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5 truncate">
            {localFile ? localFile.name : thumbnail ? '已从画布获取' : '点击上传'}
          </div>
          <button type="button" onClick={() => inputRef.current?.click()}
            className="mt-1 text-[11px] text-gray-500 hover:text-gray-700 underline underline-offset-2">
            {thumbnail || localFile ? '替换' : '上传图片'}
          </button>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*"
        onChange={(e) => onFileChange(e.target.files?.[0] || null)} className="hidden" />
    </div>
  );
}

export default GenerationComposerModal;
