'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, RefreshCw, Trash2, Globe, Clock, Star,
  Loader2, X, Upload, Send,
  User2, ImageIcon, Sparkles, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { digitalAvatarApi } from '@/lib/api/digital-avatars';
import { createImageGenerationTask, getAITaskStatus } from '@/lib/api/kling-tasks';
import { API_BASE_URL, ensureValidToken } from '@/lib/api/client';
import type {
  DigitalAvatarTemplate,
  CreateAvatarRequest,
} from '@/types/digital-avatar';
import {
  AVATAR_STYLE_META,
  AVATAR_GENDER_LABELS,
} from '@/types/digital-avatar';

/* ================================================================
   引导式 AI 生成 — 真实感人像选项
   
   核心理念: Focus on Realism
   - 胶片质感 / 自然光 / 皮肤瑕疵 / 真实场景
   - 拒绝"影楼风""磨皮""过度完美"
   ================================================================ */

interface GuidedFormState {
  gender: string;
  ageRange: string;
  ethnicity: string;
  filmStyle: string;      // 摄影风格 (影响整体质感)
  lighting: string;       // 光线条件 (影响真实感)
  scene: string;          // 场景环境 (真实背景 vs 干净背景)
  expression: string;
  extra: string;
}

const GUIDED_DEFAULTS: GuidedFormState = {
  gender: 'female',
  ageRange: 'young_adult',
  ethnicity: 'east_asian',
  filmStyle: 'film_portra',
  lighting: 'golden_hour',
  scene: 'cafe',
  expression: 'slight_smile',
  extra: '',
};

const GENDER_OPTIONS = [
  { value: 'female', label: '女性', emoji: '👩' },
  { value: 'male', label: '男性', emoji: '👨' },
];

const AGE_OPTIONS = [
  { value: 'young_adult', label: '20-25 岁' },
  { value: 'late_twenties', label: '26-32 岁' },
  { value: 'thirties', label: '33-40 岁' },
  { value: 'forties', label: '40-50 岁' },
  { value: 'teenager', label: '16-19 岁' },
];

const ETHNICITY_OPTIONS = [
  { value: 'east_asian', label: '东亚' },
  { value: 'southeast_asian', label: '东南亚' },
  { value: 'caucasian', label: '欧美' },
  { value: 'south_asian', label: '南亚' },
  { value: 'latin', label: '拉美' },
  { value: 'mixed', label: '混血' },
];

const FILM_STYLE_OPTIONS = [
  { value: 'film_portra', label: '📷 胶片人像', desc: 'Kodak Portra 400 质感，自然颗粒' },
  { value: 'film_fuji', label: '🎞️ 富士胶片', desc: 'Fujifilm Pro 400H，清透绿调' },
  { value: 'raw_digital', label: '📸 数码直出', desc: 'RAW 未修图，所见即所得' },
  { value: 'documentary', label: '🎥 纪实抓拍', desc: '35mm 街拍风，自然随性' },
];

const LIGHTING_OPTIONS = [
  { value: 'golden_hour', label: '🌅 黄金时段', desc: '日落前柔和暖光' },
  { value: 'window_light', label: '🪟 窗户侧光', desc: '室内自然光，一侧明一侧暗' },
  { value: 'overcast', label: '☁️ 阴天柔光', desc: '均匀散射光，无硬阴影' },
  { value: 'shade', label: '🌳 树荫斑驳', desc: '户外光影交错，有光斑' },
];

const SCENE_OPTIONS = [
  { value: 'cafe', label: '☕ 咖啡馆' },
  { value: 'street', label: '🏙️ 城市街头' },
  { value: 'office', label: '🏢 办公室' },
  { value: 'park', label: '🌿 公园绿地' },
  { value: 'home', label: '🏠 居家' },
  { value: 'neutral', label: '⬜ 简洁背景' },
];

const EXPRESSION_OPTIONS = [
  { value: 'slight_smile', label: '微微一笑' },
  { value: 'natural_relaxed', label: '自然放松' },
  { value: 'looking_away', label: '不经意侧目' },
  { value: 'direct_gaze', label: '直视镜头' },
  { value: 'mid_laugh', label: '笑到一半' },
  { value: 'thoughtful', label: '若有所思' },
];

/** 合成真实感人像 prompt — 核心是反"AI感" */
function composePromptFromGuided(form: GuidedFormState): string {
  const genderMap: Record<string, string> = {
    female: 'woman', male: 'man',
  };
  const ageMap: Record<string, string> = {
    teenager: '18 year old', young_adult: '24 year old',
    late_twenties: '29 year old', thirties: '36 year old',
    forties: '45 year old',
  };
  const ethnicityMap: Record<string, string> = {
    east_asian: 'East Asian', southeast_asian: 'Southeast Asian',
    south_asian: 'South Asian', caucasian: 'Caucasian',
    latin: 'Latin American', mixed: 'mixed ethnicity',
  };

  // 摄影风格 → 决定整体媒介质感
  const filmMap: Record<string, string> = {
    film_portra: 'Candid 35mm film photograph, shot on Kodak Portra 400, natural film grain, warm color cast',
    film_fuji: 'Candid medium format photograph, shot on Fujifilm Pro 400H, subtle green undertones, fine grain',
    raw_digital: 'Raw unedited digital photograph, Canon EOS R5, no post-processing, true-to-life colors',
    documentary: 'Candid 35mm street photograph, Leica M6, documentary style, unposed moment captured',
  };

  // 光线 → 决定真实感立体度
  const lightingMap: Record<string, string> = {
    golden_hour: 'natural golden hour sunlight, warm directional light casting soft shadows on face',
    window_light: 'natural window light from one side, Rembrandt lighting pattern, soft shadow on opposite cheek',
    overcast: 'overcast daylight, even soft diffused light, no harsh shadows',
    shade: 'dappled light through trees, natural bokeh light spots, outdoor shade',
  };

  // 场景 → 真实环境而非"干净背景"
  const sceneMap: Record<string, string> = {
    cafe: 'sitting in a real café, blurred coffee shop interior in background, shallow depth of field f/1.8',
    street: 'standing on a real city sidewalk, urban environment bokeh background, shallow depth of field f/2.0',
    office: 'in a real modern office space, glass and desk elements blurred in background, shallow depth of field',
    park: 'in a real park with natural greenery, trees and grass blurred in background, shallow depth of field f/1.8',
    home: 'in a real living room, warm interior with furniture soft-focused in background, cozy atmosphere',
    neutral: 'plain muted background, environmental portrait, subtle tonal variation, not pure white',
  };

  // 表情 → 微妙真实，不要"标准微笑"
  const expressionMap: Record<string, string> = {
    slight_smile: 'subtle asymmetric half-smile, relaxed jaw, natural mouth shape',
    natural_relaxed: 'neutral relaxed expression, lips slightly parted, natural resting face',
    looking_away: 'looking slightly off-camera, candid unposed moment, three-quarter profile',
    direct_gaze: 'looking directly into camera lens, calm steady gaze, slight squint from natural light',
    mid_laugh: 'caught mid-laugh, genuine spontaneous expression, crow feet wrinkles around eyes',
    thoughtful: 'pensive thoughtful expression, slight furrow between brows, eyes looking down',
  };

  const subject = `${ageMap[form.ageRange] || '25 year old'} ${ethnicityMap[form.ethnicity] || 'East Asian'} ${genderMap[form.gender] || 'person'}`;

  const parts = [
    filmMap[form.filmStyle] || filmMap.film_portra,
    subject,
    // 真实感皮肤 — 这是最关键的部分
    'visible skin pores, vellus hair on face (peach fuzz), slight imperfections, uneven skin texture, no airbrushing, no retouching, no skin smoothing',
    expressionMap[form.expression] || expressionMap.slight_smile,
    lightingMap[form.lighting] || lightingMap.golden_hour,
    sceneMap[form.scene] || sceneMap.cafe,
    // 技术参数强化真实感
    'photorealistic, hyperdetailed skin texture, shot at eye level, 85mm focal length',
  ];

  if (form.extra.trim()) {
    parts.push(form.extra.trim());
  }

  return parts.filter(Boolean).join(', ');
}

/* ================================================================
   DigitalAvatarManager — 数字人形象管理面板
   
   嵌入 PlatformMaterialsView 的「数字人」Tab
   
   功能:
   1. 形象列表 (draft/published 分标签)
   2. 创建形象 (上传照片或 AI 生成 → 配置音色 → 保存)
   3. 发布/取消发布/删除
   ================================================================ */

// ---- 上传辅助 ----

async function uploadImage(file: File, prefix = 'avatar'): Promise<string> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('prefix', prefix);

  const token = await ensureValidToken();
  const res = await fetch(`${API_BASE_URL}/upload/image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!res.ok) throw new Error('上传失败');
  const data = await res.json();
  return data.url;
}

// ============================================
// AvatarCreateModal — 创建形象弹窗
// ============================================

interface AvatarCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function AvatarCreateModal({ isOpen, onClose, onCreated }: AvatarCreateModalProps) {
  const [portraitMode, setPortraitMode] = useState<'upload' | 'generate'>('upload');

  // 引导式 vs 自由描述
  const [generateMode, setGenerateMode] = useState<'guided' | 'freeform'>('guided');
  const [guidedForm, setGuidedForm] = useState<GuidedFormState>(GUIDED_DEFAULTS);

  // Portrait state
  const [portraitUrl, setPortraitUrl] = useState('');
  const [portraitPrompt, setPortraitPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState('');
  // 共用：AI 生成的多张 or 上传的多张
  const [candidateImages, setCandidateImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // 🆕 上传模式步骤状态
  const [uploadStep, setUploadStep] = useState<'upload' | 'confirming' | 'confirmed'>('upload');
  const [originalUploadUrls, setOriginalUploadUrls] = useState<string[]>([]);  // 用户原始上传照片（支持多张）
  const [confirmCandidates, setConfirmCandidates] = useState<string[]>([]);  // AI 生成的 4 张确认肖像
  const [confirmSelectedIndex, setConfirmSelectedIndex] = useState(-1);
  const [regenCount, setRegenCount] = useState(0);  // 重新生成次数
  const MAX_REGEN = 3;
  const [portraitEngine, setPortraitEngine] = useState<'doubao' | 'kling'>('doubao');  // 胶像生成引擎

  // Config state
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 合成 prompt 实时预览
  const composedPrompt = useMemo(
    () => generateMode === 'guided' ? composePromptFromGuided(guidedForm) : portraitPrompt,
    [generateMode, guidedForm, portraitPrompt]
  );

  const resetForm = useCallback(() => {
    setPortraitMode('upload');
    setGenerateMode('guided');
    setGuidedForm(GUIDED_DEFAULTS);
    setPortraitUrl('');
    setPortraitPrompt('');
    setIsGenerating(false);
    setIsUploading(false);
    setGenProgress('');
    setCandidateImages([]);
    setSelectedImageIndex(0);
    setName('');
    setIsSaving(false);
    setUploadStep('upload');
    setOriginalUploadUrls([]);
    setConfirmCandidates([]);
    setConfirmSelectedIndex(-1);
    setRegenCount(0);
    setPortraitEngine('doubao');
  }, []);

  // ---- 上传照片（支持多张）→ 用户确认后再触发 AI 生成 ----
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setGenProgress(`上传中… 0/${files.length}`);

    const uploaded: string[] = [...originalUploadUrls];
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      try {
        setGenProgress(`上传中… ${i + 1}/${files.length}`);
        const url = await uploadImage(files[i], 'avatar-portrait');
        uploaded.push(url);
      } catch {
        failCount++;
      }
    }

    setOriginalUploadUrls(uploaded);
    setGenProgress(
      failCount > 0
        ? `已上传 ${uploaded.length} 张，${failCount} 张失败`
        : `已上传 ${uploaded.length} 张`
    );
    setIsUploading(false);
    e.target.value = '';
  }, [originalUploadUrls]);

  // ---- 用户点击"生成确认肖像"后触发 ----
  const handleStartConfirm = useCallback(async () => {
    if (originalUploadUrls.length === 0) return;
    await generateConfirmPortraits(originalUploadUrls, portraitEngine);
  }, [originalUploadUrls, portraitEngine]);

  // ---- AI 生成 4 张白底确认肖像（通过 avatar 专属 API）----
  const generateConfirmPortraits = useCallback(async (sourceUrls: string[], engine: 'doubao' | 'kling' = 'doubao') => {
    setUploadStep('confirming');
    setIsGenerating(true);
    setConfirmCandidates([]);
    setConfirmSelectedIndex(-1);
    setGenProgress('AI 正在分析你的外貌特征…');

    try {
      // 调用 avatar 专属端点，前端指定引擎
      const res = await digitalAvatarApi.confirmPortraits(sourceUrls, engine);
      if (!res.data?.task_id) throw new Error(res.error?.message || '确认肖像任务创建失败');

      const taskId = res.data.task_id;
      setGenProgress('AI 正在生成你的数字人形象…');

      // 轮询任务状态
      const poll = setInterval(async () => {
        try {
          const task = await getAITaskStatus(taskId);
          if (task.status === 'completed') {
            clearInterval(poll);
            setIsGenerating(false);
            const urls: string[] = [];
            if (task.output_url) urls.push(task.output_url);
            if (task.result_metadata?.images) {
              (task.result_metadata.images as Array<{ url: string }>).forEach(img => {
                if (img.url && !urls.includes(img.url)) urls.push(img.url);
              });
            }
            if (urls.length > 0) {
              setConfirmCandidates(urls);
              setGenProgress('选择一张最像你的作为数字人形象');
            } else {
              setGenProgress('生成完成但未获取到图片，请重试');
              setUploadStep('upload');
            }
          } else if (task.status === 'failed') {
            clearInterval(poll);
            setIsGenerating(false);
            setGenProgress(`生成失败: ${task.error_message || '未知错误'}`);
            setUploadStep('upload');
          } else {
            setGenProgress(task.status_message || 'AI 正在生成…');
          }
        } catch { /* retry */ }
      }, 3000);
    } catch (err) {
      setIsGenerating(false);
      setGenProgress(err instanceof Error ? err.message : '确认肖像生成失败');
      setUploadStep('upload');
    }
  }, []);

  // ---- 重新生成确认肖像 ----
  const handleRegenConfirm = useCallback(async () => {
    if (originalUploadUrls.length === 0 || regenCount >= MAX_REGEN) return;
    setRegenCount(prev => prev + 1);
    await generateConfirmPortraits(originalUploadUrls, portraitEngine);
  }, [originalUploadUrls, regenCount, generateConfirmPortraits, portraitEngine]);

  // ---- 确认选中肖像 ----
  const handleConfirmPortrait = useCallback((index: number) => {
    setConfirmSelectedIndex(index);
    setPortraitUrl(confirmCandidates[index]);
    setUploadStep('confirmed');
  }, [confirmCandidates]);

  // ---- AI 生成人像 ----
  const handleGenerate = useCallback(async () => {
    const prompt = generateMode === 'guided' ? composePromptFromGuided(guidedForm) : portraitPrompt;
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setGenProgress('提交生成任务…');
    setCandidateImages([]);

    try {
      const res = await createImageGenerationTask({
        prompt,
        aspect_ratio: '3:4',
        n: 4,
        model_name: 'kling-v2-1',
        resolution: '2k',
      });

      if (!res.success || !res.task_id) throw new Error('任务创建失败');
      setGenProgress('AI 正在生成人像…');

      // 轮询
      const poll = setInterval(async () => {
        try {
          const task = await getAITaskStatus(res.task_id);
          if (task.status === 'completed') {
            clearInterval(poll);
            setIsGenerating(false);
            // output_url 可能是单图或多图
            const urls: string[] = [];
            if (task.output_url) urls.push(task.output_url);
            if (task.result_metadata?.images) {
              (task.result_metadata.images as Array<{url: string}>).forEach(img => {
                if (img.url && !urls.includes(img.url)) urls.push(img.url);
              });
            }
            setCandidateImages(urls.length > 0 ? urls : task.output_url ? [task.output_url] : []);
            setGenProgress(urls.length > 0 ? `生成了 ${urls.length} 张` : '完成');
          } else if (task.status === 'failed') {
            clearInterval(poll);
            setIsGenerating(false);
            setGenProgress(`失败: ${task.error_message || '未知错误'}`);
          } else {
            setGenProgress(task.status_message || 'AI 正在生成…');
          }
        } catch { /* retry */ }
      }, 3000);
    } catch (err) {
      setIsGenerating(false);
      setGenProgress(err instanceof Error ? err.message : '生成失败');
    }
  }, [generateMode, guidedForm, portraitPrompt]);

  // ---- 变体生成: 基于选中图再生成 4 张类似的 ----
  const handleVariantGenerate = useCallback(async () => {
    if (!portraitUrl) return;
    setIsGenerating(true);
    setGenProgress('基于选中形象生成变体…');

    try {
      const prompt = generateMode === 'guided' ? composePromptFromGuided(guidedForm) : portraitPrompt;
      const res = await createImageGenerationTask({
        prompt: prompt || 'Cinematic portrait photograph, same person, different angle and expression, photorealistic',
        image: portraitUrl,
        image_reference: 'subject',
        image_fidelity: 0.7,
        aspect_ratio: '3:4',
        n: 4,
        model_name: 'kling-v2-1',
        resolution: '2k',
      });

      if (!res.success || !res.task_id) throw new Error('变体任务创建失败');
      setGenProgress('AI 正在生成变体…');

      const poll = setInterval(async () => {
        try {
          const task = await getAITaskStatus(res.task_id);
          if (task.status === 'completed') {
            clearInterval(poll);
            setIsGenerating(false);
            const urls: string[] = [];
            if (task.output_url) urls.push(task.output_url);
            if (task.result_metadata?.images) {
              (task.result_metadata.images as Array<{url: string}>).forEach(img => {
                if (img.url && !urls.includes(img.url)) urls.push(img.url);
              });
            }
            // 追加到现有候选列表，保留已有的
            setCandidateImages(prev => {
              const combined = [...prev, ...urls.filter(u => !prev.includes(u))];
              return combined;
            });
            setGenProgress(`追加了 ${urls.length} 张变体`);
          } else if (task.status === 'failed') {
            clearInterval(poll);
            setIsGenerating(false);
            setGenProgress(`变体生成失败: ${task.error_message || '未知错误'}`);
          } else {
            setGenProgress(task.status_message || 'AI 正在生成变体…');
          }
        } catch { /* retry */ }
      }, 3000);
    } catch (err) {
      setIsGenerating(false);
      setGenProgress(err instanceof Error ? err.message : '变体生成失败');
    }
  }, [portraitUrl, generateMode, guidedForm, portraitPrompt]);

  const selectCandidateImage = useCallback((index: number) => {
    setSelectedImageIndex(index);
    setPortraitUrl(candidateImages[index]);
  }, [candidateImages]);

  // ---- 保存 ----
  const handleSave = useCallback(async () => {
    if (!portraitUrl || !name.trim()) return;
    setIsSaving(true);

    const finalPrompt = generateMode === 'guided' ? composePromptFromGuided(guidedForm) : portraitPrompt;

    try {
      // 上传模式：原始上传照片保留在 reference_images 中
      const refImages: string[] = [];
      if (portraitMode === 'upload' && originalUploadUrls.length > 0) {
        refImages.push(...originalUploadUrls);
      } else if (portraitMode === 'upload' && candidateImages.length > 1) {
        refImages.push(...candidateImages);
      }

      const data: CreateAvatarRequest = {
        name: name.trim(),
        portrait_url: portraitUrl,
        portrait_prompt: finalPrompt || undefined,
        reference_images: refImages,
        generation_config: {
          broadcast_mode: 'pro',
        },
        // 引导式表单的选择存入后端字段
        ...(portraitMode === 'generate' && generateMode === 'guided' ? {
          gender: guidedForm.gender as 'male' | 'female' | 'neutral',
          age_range: guidedForm.ageRange,
          ethnicity: guidedForm.ethnicity,
          style: guidedForm.filmStyle,
          tags: [guidedForm.lighting, guidedForm.scene, guidedForm.expression],
        } : {}),
      };

      await digitalAvatarApi.createAvatar(data);
      resetForm();
      onCreated();
      onClose();
    } catch (err) {
      setGenProgress(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  }, [portraitUrl, name, portraitPrompt, resetForm, onCreated, onClose, generateMode, guidedForm, portraitMode, originalUploadUrls, candidateImages]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
              <User2 className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">创建数字人形象</h2>
              <p className="text-xs text-gray-500">选择照片或 AI 生成，取个名字即可保存</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5">
          {/* ---- Portrait ---- */}
            <div className="space-y-5">
              {/* Mode toggle */}
              <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
                <button
                  onClick={() => {
                    if (portraitMode !== 'upload') {
                      setPortraitMode('upload');
                      setCandidateImages([]);
                      setPortraitUrl('');
                      setSelectedImageIndex(0);
                      setGenProgress('');
                      setUploadStep('upload');
                      setOriginalUploadUrls([]);
                      setConfirmCandidates([]);
                      setConfirmSelectedIndex(-1);
                      setRegenCount(0);
                    }
                  }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition',
                    portraitMode === 'upload' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  )}
                >
                  <Upload className="w-4 h-4" /> 上传照片
                </button>
                <button
                  onClick={() => {
                    if (portraitMode !== 'generate') {
                      setPortraitMode('generate');
                      setCandidateImages([]);
                      setPortraitUrl('');
                      setSelectedImageIndex(0);
                      setGenProgress('');
                    }
                  }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition',
                    portraitMode === 'generate' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  )}
                >
                  <Sparkles className="w-4 h-4" /> AI 生成
                </button>
              </div>

              {/* Upload mode — 上传照片 → AI 确认肖像 → 选择 */}
              {portraitMode === 'upload' && (
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  {/* Step 1: 上传照片（支持多张） */}
                  {uploadStep === 'upload' && (
                    <div className="space-y-3">
                      {/* 已上传图片网格 */}
                      {originalUploadUrls.length > 0 && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-4 gap-2">
                            {originalUploadUrls.map((url, i) => (
                              <div key={i} className="aspect-[3/4] rounded-lg overflow-hidden border-2 border-gray-200 relative group">
                                <img src={url} alt={`upload-${i}`} className="w-full h-full object-cover" />
                                <span
                                  onClick={() => {
                                    setOriginalUploadUrls(prev => prev.filter((_, idx) => idx !== i));
                                  }}
                                  className="absolute top-1 right-1 p-0.5 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                >
                                  <X className="w-3 h-3 text-white" />
                                </span>
                              </div>
                            ))}
                            {/* 继续添加按钮 */}
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isUploading}
                              className="aspect-[3/4] rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50/30 flex flex-col items-center justify-center transition"
                            >
                              {isUploading ? (
                                <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                              ) : (
                                <>
                                  <Plus className="w-5 h-5 text-gray-400" />
                                  <span className="text-xs text-gray-400 mt-1">添加更多</span>
                                </>
                              )}
                            </button>
                          </div>
                          <p className="text-xs text-center text-gray-400">
                            已上传 {originalUploadUrls.length} 张 · 多张照片可让 AI 更精准地理解你的外貌
                          </p>
                          {/* 模型选择 */}
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-xs text-gray-400 shrink-0">模型</span>
                            <div className="flex gap-1.5 flex-1 p-0.5 bg-gray-100 rounded-lg">
                              <button
                                type="button"
                                onClick={() => setPortraitEngine('doubao')}
                                className={cn(
                                  'flex-1 py-1.5 rounded-md text-xs font-medium transition',
                                  portraitEngine === 'doubao'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                )}
                              >
                                Seedream 4.0
                              </button>
                              <button
                                type="button"
                                onClick={() => setPortraitEngine('kling')}
                                className={cn(
                                  'flex-1 py-1.5 rounded-md text-xs font-medium transition',
                                  portraitEngine === 'kling'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                )}
                              >
                                Kling
                              </button>
                            </div>
                          </div>
                          {/* 生成确认肖像按钮 */}
                          <button
                            onClick={handleStartConfirm}
                            disabled={isUploading}
                            className="w-full py-2.5 rounded-xl bg-gray-800 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition"
                          >
                            <Sparkles className="w-4 h-4" /> 生成我的数字人形象
                          </button>
                        </div>
                      )}

                      {/* 空状态：首次上传 */}
                      {originalUploadUrls.length === 0 && (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploading}
                          className="w-full aspect-[3/4] max-w-xs mx-auto flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50/30 transition"
                        >
                          {isUploading ? (
                            <Loader2 className="w-8 h-8 text-gray-400 animate-spin mb-2" />
                          ) : (
                            <ImageIcon className="w-8 h-8 text-gray-300 mb-2" />
                          )}
                          <span className="text-sm text-gray-500">点击上传人像照片</span>
                          <span className="text-xs text-gray-400 mt-1">支持多张，不同角度效果更佳</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Step 2: AI 生成确认肖像中 */}
                  {uploadStep === 'confirming' && (
                    <div className="space-y-4">
                      {/* 原图小预览 */}
                      {originalUploadUrls.length > 0 && (
                        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                          <div className="flex -space-x-2">
                            {originalUploadUrls.slice(0, 3).map((url, i) => (
                              <img key={i} src={url} alt={`ref-${i}`} className="w-10 h-13 object-cover rounded-lg border-2 border-white" />
                            ))}
                            {originalUploadUrls.length > 3 && (
                              <div className="w-10 h-13 rounded-lg border-2 border-white bg-gray-200 flex items-center justify-center text-xs text-gray-500 font-medium">
                                +{originalUploadUrls.length - 3}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-700">你的 {originalUploadUrls.length} 张照片</p>
                            <p className="text-xs text-gray-400">AI 正在综合分析你的外貌特征…</p>
                          </div>
                        </div>
                      )}

                      {/* 生成中 loading */}
                      {isGenerating && (
                        <div className="flex flex-col items-center justify-center py-8">
                          <div className="relative">
                            <Loader2 className="w-10 h-10 text-gray-500 animate-spin" />
                            <Sparkles className="w-4 h-4 text-gray-400 absolute -top-1 -right-1" />
                          </div>
                          <p className="text-sm text-gray-500 mt-3">AI 正在理解你的外貌特征…</p>
                          <p className="text-xs text-gray-400 mt-1">预计 15-30 秒</p>
                        </div>
                      )}

                      {/* 生成完成，展示 4 张白底肖像 */}
                      {!isGenerating && confirmCandidates.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-sm font-medium text-gray-700 text-center">
                            🎭 选择一张最像你的作为数字人形象
                          </p>
                          <div className="grid grid-cols-4 gap-2">
                            {confirmCandidates.map((url, i) => (
                              <button
                                key={i}
                                onClick={() => handleConfirmPortrait(i)}
                                className={cn(
                                  'aspect-[3/4] rounded-lg overflow-hidden border-2 transition relative',
                                  confirmSelectedIndex === i
                                    ? 'border-gray-900 ring-2 ring-gray-300'
                                    : 'border-gray-200 hover:border-gray-300'
                                )}
                              >
                                <img src={url} alt={`confirm-${i}`} className="w-full h-full object-cover" />
                                {confirmSelectedIndex === i && (
                                  <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-gray-800 text-white text-[10px] font-medium rounded">✓ 选中</span>
                                )}
                              </button>
                            ))}
                          </div>
                          {/* 重新生成 + 重新上传 */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleRegenConfirm}
                              disabled={regenCount >= MAX_REGEN || isGenerating}
                              className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              {regenCount >= MAX_REGEN
                                ? '已达重新生成上限'
                                : `都不太像？重新生成 (${MAX_REGEN - regenCount})`}
                            </button>
                            <button
                              onClick={() => {
                                setUploadStep('upload');
                                setConfirmCandidates([]);
                                setConfirmSelectedIndex(-1);
                                setPortraitUrl('');
                                setGenProgress('');
                              }}
                              className="py-2 px-3 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 flex items-center gap-1.5 transition"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              换照片
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 3: 已确认（显示选中的肖像） */}
                  {uploadStep === 'confirmed' && portraitUrl && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 bg-gray-50/50 rounded-xl border border-gray-200">
                        <img src={portraitUrl} alt="confirmed" className="w-16 h-20 object-cover rounded-lg border border-gray-200" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-700">✅ 数字人形象已确认</p>
                          <p className="text-xs text-gray-400 mt-0.5">系统将基于此形象保持人物一致性</p>
                        </div>
                        <button
                          onClick={() => {
                            setUploadStep('confirming');
                            setPortraitUrl('');
                            setConfirmSelectedIndex(-1);
                          }}
                          className="text-xs text-gray-500 hover:text-gray-700 font-medium whitespace-nowrap"
                        >
                          重新选择
                        </button>
                      </div>
                    </div>
                  )}

                  {genProgress && <p className="text-xs text-center text-gray-500">{genProgress}</p>}
                </div>
              )}

              {/* Generate mode — 引导式 / 自由描述 */}
              {portraitMode === 'generate' && (
                <div className="space-y-3">
                  {/* 生成模式子选项: 引导式 vs 自由描述 */}
                  <div className="flex gap-1 p-0.5 bg-gray-50 rounded-lg">
                    <button
                      onClick={() => setGenerateMode('guided')}
                      className={cn(
                        'flex-1 py-1.5 rounded-md text-xs font-medium transition',
                        generateMode === 'guided'
                          ? 'bg-white text-gray-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      )}
                    >
                      ✨ 引导式生成
                    </button>
                    <button
                      onClick={() => setGenerateMode('freeform')}
                      className={cn(
                        'flex-1 py-1.5 rounded-md text-xs font-medium transition',
                        generateMode === 'freeform'
                          ? 'bg-white text-gray-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      )}
                    >
                      📝 自由描述
                    </button>
                  </div>

                  {/* 引导式生成表单 */}
                  {generateMode === 'guided' && (
                    <div className="space-y-3">
                      {/* 性别 — 按钮组 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">性别</label>
                        <div className="flex gap-2">
                          {GENDER_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setGuidedForm(f => ({ ...f, gender: opt.value }))}
                              className={cn(
                                'flex-1 py-2 rounded-lg text-sm font-medium border-2 transition',
                                guidedForm.gender === opt.value
                                  ? 'border-gray-900 bg-gray-50 text-gray-700'
                                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
                              )}
                            >
                              {opt.emoji} {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 年龄 + 面孔 — 并排 */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">年龄段</label>
                          <select
                            value={guidedForm.ageRange}
                            onChange={e => setGuidedForm(f => ({ ...f, ageRange: e.target.value }))}
                            className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-gray-400"
                          >
                            {AGE_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">面孔类型</label>
                          <select
                            value={guidedForm.ethnicity}
                            onChange={e => setGuidedForm(f => ({ ...f, ethnicity: e.target.value }))}
                            className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-gray-400"
                          >
                            {ETHNICITY_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* 摄影风格 — 2列选择 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">📷 摄影风格</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {FILM_STYLE_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setGuidedForm(f => ({ ...f, filmStyle: opt.value }))}
                              className={cn(
                                'text-left px-3 py-2 rounded-lg border transition',
                                guidedForm.filmStyle === opt.value
                                  ? 'border-gray-900 bg-gray-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              )}
                            >
                              <span className="text-xs font-medium text-gray-800">{opt.label}</span>
                              <span className="block text-[10px] text-gray-400 mt-0.5">{opt.desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 光线条件 — 2列选择 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">💡 光线</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {LIGHTING_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setGuidedForm(f => ({ ...f, lighting: opt.value }))}
                              className={cn(
                                'text-left px-3 py-2 rounded-lg border transition',
                                guidedForm.lighting === opt.value
                                  ? 'border-gray-900 bg-gray-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              )}
                            >
                              <span className="text-xs font-medium text-gray-800">{opt.label}</span>
                              <span className="block text-[10px] text-gray-400 mt-0.5">{opt.desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 场景 + 表情 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">🏙️ 场景</label>
                        <div className="flex flex-wrap gap-1.5">
                          {SCENE_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setGuidedForm(f => ({ ...f, scene: opt.value }))}
                              className={cn(
                                'px-3 py-1.5 rounded-full text-xs font-medium border transition',
                                guidedForm.scene === opt.value
                                  ? 'border-gray-900 bg-gray-50 text-gray-700'
                                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 表情 — 横排选择 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">😊 表情</label>
                        <div className="flex flex-wrap gap-1.5">
                          {EXPRESSION_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setGuidedForm(f => ({ ...f, expression: opt.value }))}
                              className={cn(
                                'px-3 py-1.5 rounded-full text-xs font-medium border transition',
                                guidedForm.expression === opt.value
                                  ? 'border-gray-900 bg-gray-50 text-gray-700'
                                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 补充描述 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">
                          补充描述 <span className="font-normal text-gray-400">(可选)</span>
                        </label>
                        <textarea
                          value={guidedForm.extra}
                          onChange={e => setGuidedForm(f => ({ ...f, extra: e.target.value }))}
                          placeholder="例如: 戴黑框眼镜, 短发有碎发, 穿灰色卫衣, 手里拿着咖啡杯…"
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:border-gray-400"
                        />
                      </div>

                      {/* Prompt 预览 (可折叠) */}
                      <details className="text-xs">
                        <summary className="text-gray-400 cursor-pointer hover:text-gray-600">
                          查看生成的 Prompt
                        </summary>
                        <p className="mt-1.5 p-2.5 bg-gray-50 rounded-lg text-gray-500 leading-relaxed break-all">
                          {composedPrompt}
                        </p>
                      </details>
                    </div>
                  )}

                  {/* 自由描述模式 — 保留原始 textarea */}
                  {generateMode === 'freeform' && (
                    <textarea
                      value={portraitPrompt}
                      onChange={(e) => setPortraitPrompt(e.target.value)}
                      placeholder="描述你想要的数字人形象，例如:&#10;&#10;Candid 35mm film photograph, shot on Kodak Portra 400, 25 year old East Asian woman, visible skin pores, peach fuzz, slight imperfections, natural golden hour side lighting, sitting in a real café, shallow depth of field f/1.8, subtle half-smile, unedited raw photo..."
                      className="w-full h-40 px-3 py-2.5 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-gray-400"
                    />
                  )}

                  {/* 生成按钮 */}
                  <button
                    onClick={handleGenerate}
                    disabled={
                      isGenerating ||
                      (generateMode === 'freeform' && !portraitPrompt.trim())
                    }
                    className="w-full py-2.5 rounded-xl bg-gray-800 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition"
                  >
                    {isGenerating ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> 生成中…</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> 生成人像 (4 张)</>
                    )}
                  </button>
                  {genProgress && <p className="text-xs text-center text-gray-500">{genProgress}</p>}

                  {/* Generated results + 变体按钮 */}
                  {candidateImages.length > 0 && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-4 gap-2">
                        {candidateImages.map((url, i) => (
                          <button
                            key={i}
                            onClick={() => selectCandidateImage(i)}
                            className={cn(
                              'aspect-[3/4] rounded-lg overflow-hidden border-2 transition',
                              selectedImageIndex === i && portraitUrl === url
                                ? 'border-gray-900 ring-2 ring-gray-200'
                                : 'border-gray-200 hover:border-gray-300'
                            )}
                          >
                            <img src={url} alt={`gen-${i}`} className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                      {/* 变体生成按钮 */}
                      {portraitUrl && !isGenerating && (
                        <button
                          onClick={handleVariantGenerate}
                          className="w-full py-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-600 text-xs font-medium hover:bg-gray-100 flex items-center justify-center gap-1.5 transition"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          再来 4 张类似的 (基于选中图)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 选好图后: 名称输入 + 保存 */}
              {portraitUrl && (
                <div className="flex gap-2 items-center">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="给 TA 取个名字"
                    className="flex-1 h-10 px-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400"
                    onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleSave(); }}
                  />
                  <button
                    onClick={handleSave}
                    disabled={!name.trim() || isSaving}
                    className="h-10 px-5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition whitespace-nowrap"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : '保存形象'}
                  </button>
                </div>
              )}

              {genProgress && isSaving && <p className="text-xs text-center text-red-500">{genProgress}</p>}
            </div>
        </div>
      </motion.div>
    </div>
  );
}

// ============================================
// AvatarCard — 单个形象卡片
// ============================================

interface AvatarCardProps {
  avatar: DigitalAvatarTemplate;
  onPublish: (id: string) => void;
  onUnpublish: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (avatar: DigitalAvatarTemplate) => void;
}

function AvatarCard({ avatar, onPublish, onUnpublish, onDelete }: AvatarCardProps) {
  const styleMeta = avatar.style ? AVATAR_STYLE_META[avatar.style] : null;

  return (
    <div className="group relative bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      {/* Portrait */}
      <div className="aspect-[3/4] bg-gray-100 overflow-hidden">
        <img
          src={avatar.thumbnail_url || avatar.portrait_url}
          alt={avatar.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="absolute bottom-3 left-3 right-3 flex gap-2">
            {avatar.status === 'draft' ? (
              <button
                onClick={() => onPublish(avatar.id)}
                className="flex-1 py-1.5 bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-700 flex items-center justify-center gap-1"
              >
                <Send className="w-3 h-3" /> 发布
              </button>
            ) : (
              <button
                onClick={() => onUnpublish(avatar.id)}
                className="flex-1 py-1.5 bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-700 flex items-center justify-center gap-1"
              >
                <Clock className="w-3 h-3" /> 撤回
              </button>
            )}
            <button
              onClick={() => onDelete(avatar.id)}
              className="py-1.5 px-2.5 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-medium text-gray-900 truncate flex-1">{avatar.name}</h3>
          {avatar.is_featured && <Star className="w-3.5 h-3.5 text-gray-500 fill-gray-500 flex-shrink-0" />}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {styleMeta && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', styleMeta.color)}>
              {styleMeta.emoji} {styleMeta.label}
            </span>
          )}
          {avatar.gender && (
            <span className="text-[10px] text-gray-400">
              {AVATAR_GENDER_LABELS[avatar.gender]}
            </span>
          )}
          <span className="text-[10px] text-gray-400 ml-auto">
            {avatar.usage_count} 次使用
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// DigitalAvatarManager — 主组件
// ============================================

export function DigitalAvatarManager() {
  const [avatars, setAvatars] = useState<DigitalAvatarTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishTab, setPublishTab] = useState<'draft' | 'published'>('draft');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');

  const loadAvatars = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await digitalAvatarApi.listAvatars({
        status: publishTab,
        search: searchQuery || undefined,
        limit: 100,
      });
      setAvatars(res.data?.avatars || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [publishTab, searchQuery]);

  useEffect(() => {
    loadAvatars();
  }, [loadAvatars]);

  const handlePublish = useCallback(async (id: string) => {
    try {
      await digitalAvatarApi.publishAvatar(id);
      loadAvatars();
    } catch { /* ignore */ }
  }, [loadAvatars]);

  const handleUnpublish = useCallback(async (id: string) => {
    try {
      await digitalAvatarApi.unpublishAvatar(id);
      loadAvatars();
    } catch { /* ignore */ }
  }, [loadAvatars]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确定删除该形象？')) return;
    try {
      await digitalAvatarApi.deleteAvatar(id);
      loadAvatars();
    } catch { /* ignore */ }
  }, [loadAvatars]);

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <User2 className="w-5 h-5 text-gray-600" />
            数字人形象库
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">管理 AI 数字人形象，用于口播视频生成</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition"
        >
          <Plus className="w-4 h-4" />
          创建形象
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
        <button
          onClick={() => setPublishTab('draft')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition',
            publishTab === 'draft'
              ? 'border-gray-900 text-gray-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          <Clock className="w-3.5 h-3.5" /> 草稿
        </button>
        <button
          onClick={() => setPublishTab('published')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition',
            publishTab === 'published'
              ? 'border-gray-900 text-gray-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          <Globe className="w-3.5 h-3.5" /> 已发布
        </button>
      </div>

      {/* Search + refresh */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索形象…"
            className="w-full h-9 pl-9 pr-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
          />
        </div>
        <button
          onClick={loadAvatars}
          disabled={loading}
          className="h-9 px-3 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 text-sm"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> 刷新
        </button>
        <span className="text-xs text-gray-400 ml-auto">共 {avatars.length} 个</span>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      ) : avatars.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <User2 className="w-12 h-12 text-gray-200 mb-3" />
          <p className="text-sm text-gray-500">
            {publishTab === 'draft' ? '暂无草稿形象' : '暂无已发布形象'}
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-3 text-sm text-gray-600 hover:text-gray-700"
          >
            + 创建第一个数字人
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {avatars.map((avatar) => (
            <AvatarCard
              key={avatar.id}
              avatar={avatar}
              onPublish={handlePublish}
              onUnpublish={handleUnpublish}
              onDelete={handleDelete}
              onEdit={() => {}}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      <AvatarCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={loadAvatars}
      />
    </div>
  );
}

export default DigitalAvatarManager;
