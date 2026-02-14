'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Star,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Send,
  Image as ImageIcon,
  Upload,
  Award,
  Eye,
} from 'lucide-react';
import {
  createPreviewRender,
  fetchPreviewRenders,
  updatePreviewRender,
  updateQualityLabel,
  updatePublishConfig,
  publishTemplate,
  uploadTemplateSourceFile,
  fetchFingerprintMatch,
  extractFingerprint,
  fetchTemplateRecipe,
  type TemplateApiItem,
  type TemplateRecipe,
  type PreviewRenderItem,
  type PreviewRenderRequest,
  type TransitionFocusMode,
  type TransitionGoldenPreset,
  type QualityLabel,
  type FingerprintMatchItem,
  type GoldenFingerprint,
  type TemplatePromptPolicy,
} from '@/lib/api/templates';

// ==================== 常量 ====================

const FOCUS_MODE_OPTIONS: { value: TransitionFocusMode; label: string; desc: string }[] = [
  { value: 'outfit_change', label: '换装强调', desc: '聚焦服装变化' },
  { value: 'subject_preserve', label: '主体保持', desc: '保持人物连贯性' },
  { value: 'scene_shift', label: '场景切换', desc: '聚焦场景变化' },
];

const GOLDEN_PRESET_OPTIONS: { value: TransitionGoldenPreset; label: string; desc: string }[] = [
  { value: 'spin_occlusion_outfit', label: '旋转遮挡换装', desc: '360° 旋转 + 遮挡 + 换装' },
  { value: 'whip_pan_outfit', label: '甩镜换装', desc: '快速甩镜头 + 换装' },
  { value: 'space_warp_outfit', label: '空间扭曲换装', desc: '空间扭曲效果 + 换装' },
];

const QUALITY_LABEL_OPTIONS: { value: QualityLabel; label: string; color: string }[] = [
  { value: 'golden', label: '🏆 黄金', color: 'bg-gray-100 text-gray-700 border-gray-300' },
  { value: 'good', label: '✅ 优秀', color: 'bg-gray-100 text-gray-700 border-gray-300' },
  { value: 'average', label: '➡️ 一般', color: 'bg-gray-100 text-gray-600 border-gray-300' },
  { value: 'poor', label: '❌ 较差', color: 'bg-red-100 text-red-700 border-red-300' },
];

const DEFAULT_NEGATIVE_PROMPT =
  'blurry, distorted, low quality, watermark, text overlay, extra limbs, deformed face, artifacts, flickering';

const PROMPT_POLICY_OPTIONS: Array<{ value: TemplatePromptPolicy; label: string; desc: string }> = [
  { value: 'auto_only', label: '仅自动合成', desc: '完全使用系统策略，不使用自定义 Prompt' },
  { value: 'auto_plus_default', label: '自动 + 模板预设', desc: '使用系统策略叠加模板预设 Prompt' },
  { value: 'auto_plus_default_plus_user', label: '自动 + 预设 + 用户增强', desc: '允许在模板预设基础上进一步增强' },
];

// ==================== Props ====================

interface TemplatePublishPanelProps {
  template: TemplateApiItem | null;
  onClose: () => void;
  onPublished?: (templateId: string) => void;
}

// ==================== 组件 ====================

export function TemplatePublishPanel({ template, onClose, onPublished }: TemplatePublishPanelProps) {
  // — 试渲染参数 —
  const [fromImageUrl, setFromImageUrl] = useState('');
  const [toImageUrl, setToImageUrl] = useState('');
  const [fromImageFile, setFromImageFile] = useState<File | null>(null);
  const [toImageFile, setToImageFile] = useState<File | null>(null);
  const [focusModes, setFocusModes] = useState<TransitionFocusMode[]>(['outfit_change']);
  const [goldenPreset, setGoldenPreset] = useState<TransitionGoldenPreset>('spin_occlusion_outfit');
  const [variantCount, setVariantCount] = useState(1);
  const [boundaryMs, setBoundaryMs] = useState(480);
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [defaultNegativePrompt, setDefaultNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  const [promptPolicy, setPromptPolicy] = useState<TemplatePromptPolicy>('auto_plus_default_plus_user');
  const [allowPromptOverride, setAllowPromptOverride] = useState(true);

  // — 试渲染结果 —
  const [previewRenders, setPreviewRenders] = useState<PreviewRenderItem[]>([]);
  const [loadingRenders, setLoadingRenders] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  // — 质量标注 —
  const [qualityLabel, setQualityLabel] = useState<QualityLabel | null>(null);

  // — 指纹匹配 —
  const [fingerprint, setFingerprint] = useState<GoldenFingerprint | null>(null);
  const [fingerprintMatches, setFingerprintMatches] = useState<FingerprintMatchItem[]>([]);
  const [loadingFingerprint, setLoadingFingerprint] = useState(false);
  const [extractingFingerprint, setExtractingFingerprint] = useState(false);

  // — 配方卡 —
  const [recipe, setRecipe] = useState<TemplateRecipe | null>(null);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [recipeExpanded, setRecipeExpanded] = useState(false);

  // — 视频预览 —
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);

  // — UI 状态 —
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // — 初始化 —
  useEffect(() => {
    if (!template) return;
    const pc = template.publish_config || {};

    setQualityLabel((template.quality_label as QualityLabel) || null);

    const parsedFocusModes = Array.isArray(pc.default_focus_modes)
      ? pc.default_focus_modes.filter((mode): mode is TransitionFocusMode =>
          ['outfit_change', 'subject_preserve', 'scene_shift'].includes(String(mode))
        )
      : [];
    setFocusModes(parsedFocusModes.length > 0 ? parsedFocusModes : ['outfit_change']);

    const parsedPreset = typeof pc.default_golden_preset === 'string' &&
      ['spin_occlusion_outfit', 'whip_pan_outfit', 'space_warp_outfit'].includes(pc.default_golden_preset)
      ? (pc.default_golden_preset as TransitionGoldenPreset)
      : 'spin_occlusion_outfit';
    setGoldenPreset(parsedPreset);

    setVariantCount(typeof pc.default_variant_count === 'number' ? pc.default_variant_count : 1);

    if (typeof pc.default_boundary_ms === 'number') {
      setBoundaryMs(pc.default_boundary_ms);
    } else if (typeof template.transition_spec?.duration_ms === 'number') {
      setBoundaryMs(template.transition_spec.duration_ms);
    } else {
      setBoundaryMs(480);
    }

    const templateSuggestedPrompt =
      (typeof pc.default_prompt === 'string' && pc.default_prompt.trim())
      || (template.transition_spec?.recommended_prompt?.trim() || '');
    setDefaultPrompt(templateSuggestedPrompt);

    const templateSuggestedNegative =
      (typeof pc.default_negative_prompt === 'string' && pc.default_negative_prompt.trim())
      || DEFAULT_NEGATIVE_PROMPT;
    setDefaultNegativePrompt(templateSuggestedNegative);

    const parsedPolicy = (pc.prompt_policy as TemplatePromptPolicy) || 'auto_plus_default_plus_user';
    if (['auto_only', 'auto_plus_default', 'auto_plus_default_plus_user'].includes(parsedPolicy)) {
      setPromptPolicy(parsedPolicy);
    } else {
      setPromptPolicy('auto_plus_default_plus_user');
    }

    setAllowPromptOverride(pc.allow_prompt_override !== false);

    loadPreviewRenders();
    loadFingerprint();
    loadRecipe();

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  // — 加载指纹匹配 —
  const loadFingerprint = useCallback(async () => {
    if (!template) return;
    setLoadingFingerprint(true);
    try {
      const resp = await fetchFingerprintMatch(template.id);
      setFingerprint(resp.fingerprint);
      setFingerprintMatches(resp.matches);
    } catch {
      // 404 表示尚无指纹，不报错
      setFingerprint(null);
      setFingerprintMatches([]);
    } finally {
      setLoadingFingerprint(false);
    }
  }, [template]);

  // — 手动提取指纹 —
  const handleExtractFingerprint = async () => {
    if (!template || extractingFingerprint) return;
    setExtractingFingerprint(true);
    try {
      const result = await extractFingerprint(template.id);
      setFingerprint(result.fingerprint);
      // 重新加载匹配结果 + 配方
      await Promise.all([loadFingerprint(), loadRecipe()]);
      if (result.auto_fill.config_applied) {
        setSuccessMsg('指纹提取成功，已自动预填推荐配置');
      } else {
        setSuccessMsg('指纹提取成功');
      }
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '指纹提取失败');
    } finally {
      setExtractingFingerprint(false);
    }
  };

  // — 加载配方卡 —
  const loadRecipe = useCallback(async () => {
    if (!template) return;
    setLoadingRecipe(true);
    try {
      const data = await fetchTemplateRecipe(template.id);
      setRecipe(data);
    } catch {
      setRecipe(null);
    } finally {
      setLoadingRecipe(false);
    }
  }, [template]);

  // — 加载试渲染列表 —
  const loadPreviewRenders = useCallback(async () => {
    if (!template) return;
    setLoadingRenders(true);
    try {
      const resp = await fetchPreviewRenders(template.id);
      setPreviewRenders(resp.renders);
    } catch {
      // silent
    } finally {
      setLoadingRenders(false);
    }
  }, [template]);

  // — 轮询进行中的渲染 —
  useEffect(() => {
    const hasPending = previewRenders.some((r) => r.status === 'pending' || r.status === 'processing');
    if (!hasPending) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return; // 已有定时器
    pollRef.current = setInterval(() => {
      loadPreviewRenders();
    }, 4000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [previewRenders, loadPreviewRenders]);

  // — 解析图片 URL（支持本地上传） —
  async function resolveImageUrl(url: string, file: File | null, label: string): Promise<string> {
    const trimmed = url.trim();
    if (trimmed) return trimmed;
    if (!file) throw new Error(`请提供${label}图片链接或上传本地文件`);
    const uploaded = await uploadTemplateSourceFile(file, 'template-preview-inputs');
    return uploaded.url;
  }

  // — 提交试渲染 —
  const handleSubmitRender = async () => {
    if (!template || isRendering) return;
    setError(null);
    setIsRendering(true);
    try {
      const fromUrl = await resolveImageUrl(fromImageUrl, fromImageFile, '首帧');
      const toUrl = await resolveImageUrl(toImageUrl, toImageFile, '尾帧');

      const payload: PreviewRenderRequest = {
        from_image_url: fromUrl,
        to_image_url: toUrl,
        prompt: defaultPrompt.trim() || undefined,
        negative_prompt: defaultNegativePrompt.trim() || undefined,
        focus_modes: focusModes.length > 0 ? focusModes : ['outfit_change'],
        golden_preset: goldenPreset,
        variant_count: variantCount,
        boundary_ms: boundaryMs,
      };

      await createPreviewRender(template.id, payload);
      setSuccessMsg(`已创建 ${variantCount} 个试渲染任务`);
      setTimeout(() => setSuccessMsg(null), 3000);
      // 立即刷新列表
      await loadPreviewRenders();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建试渲染失败');
    } finally {
      setIsRendering(false);
    }
  };

  // — 更新评分 —
  const handleRate = async (renderId: string, rating: number) => {
    if (!template) return;
    try {
      await updatePreviewRender(template.id, renderId, { admin_rating: rating });
      setPreviewRenders((prev) =>
        prev.map((r) => (r.id === renderId ? { ...r, admin_rating: rating } : r))
      );
    } catch {
      // silent
    }
  };

  // — 设为主预览 —
  const handleSetFeatured = async (renderId: string) => {
    if (!template) return;
    try {
      await updatePreviewRender(template.id, renderId, { is_featured: true });
      setPreviewRenders((prev) =>
        prev.map((r) => ({
          ...r,
          is_featured: r.id === renderId,
        }))
      );
      setSuccessMsg('已设为主预览视频');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      setError('设为主预览失败');
    }
  };

  // — 设置质量标签 —
  const handleSetQualityLabel = async (label: QualityLabel) => {
    if (!template) return;
    try {
      await updateQualityLabel(template.id, { quality_label: label });
      setQualityLabel(label);
      setSuccessMsg(`质量标签已设为「${QUALITY_LABEL_OPTIONS.find((o) => o.value === label)?.label}」`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      setError('设置质量标签失败');
    }
  };

  // — 发布 —
  const handlePublish = async () => {
    if (!template || isPublishing) return;

    // 检查前置条件
    if (!qualityLabel) {
      setError('请先设置质量标签');
      return;
    }

    const hasFeatured = previewRenders.some((r) => r.is_featured && r.video_url);
    if (!hasFeatured) {
      const confirmed = confirm('尚未设置主预览视频，确定要发布吗？');
      if (!confirmed) return;
    }

    setIsPublishing(true);
    setError(null);
    try {
      // 保存发布配置
      await updatePublishConfig(template.id, {
        default_focus_modes: focusModes,
        default_golden_preset: goldenPreset,
        default_boundary_ms: boundaryMs,
        default_variant_count: variantCount,
        default_prompt: defaultPrompt.trim() || undefined,
        default_negative_prompt: defaultNegativePrompt.trim() || undefined,
        prompt_policy: promptPolicy,
        allow_prompt_override: allowPromptOverride,
      });

      await publishTemplate(template.id);
      setSuccessMsg('模板已发布！');
      setTimeout(() => {
        onPublished?.(template.id);
        onClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setIsPublishing(false);
    }
  };

  if (!template) return null;

  const completedRenders = previewRenders.filter((r) => r.status === 'completed' && r.video_url);
  const pendingRenders = previewRenders.filter((r) => r.status === 'pending' || r.status === 'processing');

  const promptPolicySummary = promptPolicy === 'auto_only'
    ? '发布后：仅系统自动 Prompt 生效，用户输入会被忽略。'
    : promptPolicy === 'auto_plus_default'
      ? '发布后：系统 Prompt + 模板默认 Prompt 生效，用户输入会被忽略。'
      : allowPromptOverride
        ? '发布后：系统 Prompt + 模板默认 Prompt + 用户输入增强。'
        : '发布后：系统 Prompt + 模板默认 Prompt 生效，关闭用户覆盖。';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ========== Header ========== */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
              {template.thumbnail_url ? (
                <img src={template.thumbnail_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={20} className="m-auto text-gray-300 mt-2.5" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{template.name}</h2>
              <p className="text-xs text-gray-500">
                {template.category} · {template.type}
                {template.transition_spec?.duration_ms && ` · ${template.transition_spec.duration_ms}ms`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* ========== Body ========== */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:divide-x lg:divide-gray-200">

            {/* ===== 左栏：参数配置 + 试渲染 ===== */}
            <div className="p-5 space-y-5">
              <h3 className="text-sm font-semibold text-gray-800">试渲染参数</h3>

              {/* 首帧图片 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">首帧图片</label>
                <input
                  type="text"
                  value={fromImageUrl}
                  onChange={(e) => setFromImageUrl(e.target.value)}
                  placeholder="图片 URL..."
                  className="w-full h-8 px-3 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400"
                />
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer hover:text-gray-700">
                  <Upload size={12} />
                  或上传本地图片
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { setFromImageFile(e.target.files?.[0] || null); setFromImageUrl(''); }}
                  />
                </label>
                {fromImageFile && (
                  <p className="text-[10px] text-gray-500 mt-0.5 truncate">{fromImageFile.name}</p>
                )}
              </div>

              {/* 尾帧图片 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">尾帧图片</label>
                <input
                  type="text"
                  value={toImageUrl}
                  onChange={(e) => setToImageUrl(e.target.value)}
                  placeholder="图片 URL..."
                  className="w-full h-8 px-3 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400"
                />
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer hover:text-gray-700">
                  <Upload size={12} />
                  或上传本地图片
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { setToImageFile(e.target.files?.[0] || null); setToImageUrl(''); }}
                  />
                </label>
                {toImageFile && (
                  <p className="text-[10px] text-gray-500 mt-0.5 truncate">{toImageFile.name}</p>
                )}
              </div>

              {/* Focus Modes 多选 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">复刻重点</label>
                <div className="space-y-1.5">
                  {FOCUS_MODE_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={focusModes.includes(opt.value)}
                        onChange={() => {
                          setFocusModes((prev) =>
                            prev.includes(opt.value)
                              ? prev.filter((m) => m !== opt.value)
                              : [...prev, opt.value]
                          );
                        }}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-gray-600 focus:ring-gray-400"
                      />
                      <span className="text-xs text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                      <span className="text-[10px] text-gray-400">{opt.desc}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Golden Preset */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">黄金预设</label>
                <div className="space-y-1.5">
                  {GOLDEN_PRESET_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="radio"
                        name="goldenPreset"
                        checked={goldenPreset === opt.value}
                        onChange={() => setGoldenPreset(opt.value)}
                        className="w-3.5 h-3.5 border-gray-300 text-gray-600 focus:ring-gray-400"
                      />
                      <span className="text-xs text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Prompt 预设策略 */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">Prompt 预设策略</label>
                <select
                  value={promptPolicy}
                  onChange={(e) => setPromptPolicy(e.target.value as TemplatePromptPolicy)}
                  className="w-full h-8 px-2 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:border-gray-400"
                >
                  {PROMPT_POLICY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400">
                  {PROMPT_POLICY_OPTIONS.find((opt) => opt.value === promptPolicy)?.desc}
                </p>
                <p className="text-[10px] text-gray-500">{promptPolicySummary}</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600">默认 Prompt（可选）</label>
                  <label className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                    <input
                      type="checkbox"
                      checked={allowPromptOverride}
                      onChange={(e) => setAllowPromptOverride(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-gray-600 focus:ring-gray-400"
                    />
                    用户可覆盖
                  </label>
                </div>
                <textarea
                  value={defaultPrompt}
                  onChange={(e) => setDefaultPrompt(e.target.value)}
                  rows={3}
                  placeholder="不填则仅使用系统自动合成的 Prompt"
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400 resize-none"
                />
                <p className="mt-1 text-[10px] text-gray-400">模板用户不写 Prompt 时，将默认使用这里的预设值。</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">默认反向提示词（可选）</label>
                <textarea
                  value={defaultNegativePrompt}
                  onChange={(e) => setDefaultNegativePrompt(e.target.value)}
                  rows={2}
                  placeholder={DEFAULT_NEGATIVE_PROMPT}
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400 resize-none"
                />
              </div>

              {/* 并发数 + 边界时长 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">生成数量</label>
                  <select
                    value={variantCount}
                    onChange={(e) => setVariantCount(Number(e.target.value))}
                    className="w-full h-8 px-2 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:border-gray-400"
                  >
                    <option value={1}>1 次</option>
                    <option value={2}>2 次（对比）</option>
                    <option value={3}>3 次（全对比）</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">边界 (ms)</label>
                  <input
                    type="number"
                    min={200}
                    max={2000}
                    step={40}
                    value={boundaryMs}
                    onChange={(e) => setBoundaryMs(Number(e.target.value))}
                    className="w-full h-8 px-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-gray-400"
                  />
                </div>
              </div>

              {/* 提交试渲染 */}
              <button
                onClick={handleSubmitRender}
                disabled={isRendering}
                className="w-full py-2.5 bg-gray-800 text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isRendering ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    创建中...
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    开始试渲染
                  </>
                )}
              </button>
            </div>

            {/* ===== 中栏：试渲染结果 ===== */}
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">
                  试渲染结果
                  {previewRenders.length > 0 && (
                    <span className="ml-1.5 text-xs text-gray-400 font-normal">({previewRenders.length})</span>
                  )}
                </h3>
                <button
                  onClick={loadPreviewRenders}
                  disabled={loadingRenders}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  title="刷新"
                >
                  <RefreshCw size={14} className={loadingRenders ? 'animate-spin text-gray-400' : 'text-gray-500'} />
                </button>
              </div>

              {/* 进行中的渲染 */}
              {pendingRenders.length > 0 && (
                <div className="px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-600 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  {pendingRenders.length} 个任务渲染中...
                </div>
              )}

              {/* 已完成的渲染结果 */}
              {completedRenders.length === 0 && pendingRenders.length === 0 ? (
                <div className="py-10 text-center text-xs text-gray-400">
                  暂无试渲染结果
                  <br />
                  <span className="text-gray-300">配置参数后点击"开始试渲染"</span>
                </div>
              ) : (
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {previewRenders.map((render) => (
                    <PreviewRenderCard
                      key={render.id}
                      render={render}
                      onPlay={(url) => setPlayingVideoUrl(url)}
                      onRate={(rating) => handleRate(render.id, rating)}
                      onSetFeatured={() => handleSetFeatured(render.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ===== 右栏：质量标注 + 发布 ===== */}
            <div className="p-5 space-y-5">
              <h3 className="text-sm font-semibold text-gray-800">质量评估 & 发布</h3>

              {/* 质量标签 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">质量标签</label>
                <div className="grid grid-cols-2 gap-2">
                  {QUALITY_LABEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleSetQualityLabel(opt.value)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                        qualityLabel === opt.value
                          ? `${opt.color} ring-2 ring-offset-1`
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── 配方溯源卡 ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">📋 配方溯源</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExtractFingerprint}
                      disabled={extractingFingerprint}
                      className="text-[10px] text-gray-600 hover:text-gray-700 flex items-center gap-0.5 disabled:opacity-50"
                    >
                      {extractingFingerprint ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <RefreshCw size={10} />
                      )}
                      {fingerprint ? '重新分析' : '提取指纹'}
                    </button>
                  </div>
                </div>

                {loadingRecipe || loadingFingerprint ? (
                  <div className="py-4 text-center text-xs text-gray-400 flex items-center justify-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    加载配方...
                  </div>
                ) : recipe ? (
                  <div className="space-y-2.5">
                    {/* 分析结果 */}
                    {recipe.analysis.family && (
                      <div className="bg-gray-50 rounded-lg p-2.5 space-y-1.5">
                        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">🔬 转场分析</div>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { label: recipe.analysis.transition_category, color: 'bg-gray-100 text-gray-700' },
                            { label: recipe.analysis.family, color: 'bg-gray-100 text-gray-700' },
                            { label: recipe.analysis.camera_movement, color: 'bg-gray-100 text-gray-700' },
                            { label: recipe.analysis.duration_ms ? `${recipe.analysis.duration_ms}ms` : null, color: 'bg-gray-100 text-gray-600' },
                            { label: recipe.analysis.transition_window?.effect_duration_sec ? `🤖 ${(recipe.analysis.transition_window.effect_duration_sec * 1000).toFixed(0)}ms` : null, color: 'bg-gray-100 text-gray-700' },
                          ]
                            .filter((t) => t.label)
                            .map((tag, i) => (
                              <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tag.color}`}>
                                {tag.label}
                              </span>
                            ))}
                        </div>
                        {recipe.analysis.motion_pattern && (
                          <p className="text-[10px] text-gray-400 truncate">{recipe.analysis.motion_pattern}</p>
                        )}
                        {recipe.analysis.transition_description && (
                          <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{recipe.analysis.transition_description}</p>
                        )}
                        {recipe.analysis.motion_prompt && (
                          <div className="mt-1.5 pt-1.5 border-t border-gray-200">
                            <div className="flex items-center gap-1">
                              <span className="text-[9px] font-medium text-gray-500">🎬 编舞脚本</span>
                              {recipe.analysis._analysis_method && (
                                <span className="rounded-full bg-gray-100 px-1 py-0 text-[8px] text-gray-600">
                                  {recipe.analysis._analysis_method === 'video_clip' ? '视频分析' : '帧分析'}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-3">{recipe.analysis.motion_prompt}</p>
                          </div>
                        )}
                        {(recipe.analysis.camera_compound || recipe.analysis.background_motion || recipe.analysis.subject_motion) && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {recipe.analysis.camera_compound && (
                              <span className="text-[9px] px-1 py-0 rounded bg-gray-50 text-gray-600">📷 {recipe.analysis.camera_compound}</span>
                            )}
                            {recipe.analysis.background_motion && (
                              <span className="text-[9px] px-1 py-0 rounded bg-gray-50 text-gray-600">🌄 {recipe.analysis.background_motion}</span>
                            )}
                            {recipe.analysis.subject_motion && (
                              <span className="text-[9px] px-1 py-0 rounded bg-gray-50 text-gray-600">🧑 {recipe.analysis.subject_motion}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 匹配 Profile */}
                    {recipe.golden_match?.profile_name && (
                      <div
                        className={`rounded-lg p-2.5 border ${
                          recipe.golden_match.match_level === 'high'
                            ? 'bg-gray-50/80 border-gray-200'
                            : recipe.golden_match.match_level === 'medium'
                              ? 'bg-gray-50/80 border-gray-200'
                              : 'bg-gray-50 border-gray-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium text-gray-500">🧬 匹配</span>
                            <span className="text-[11px] font-semibold text-gray-700">
                              {fingerprintMatches.find((m) => m.profile_name === recipe.golden_match?.profile_name)?.display_name ||
                                recipe.golden_match.profile_name}
                            </span>
                          </div>
                          <span
                            className={`text-xs font-bold ${
                              recipe.golden_match.match_level === 'high'
                                ? 'text-gray-600'
                                : recipe.golden_match.match_level === 'medium'
                                  ? 'text-gray-600'
                                  : 'text-gray-400'
                            }`}
                          >
                            {(recipe.golden_match.score * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 其他匹配候选 */}
                    {fingerprintMatches.length > 1 && (
                      <div className="space-y-1">
                        {fingerprintMatches
                          .filter((m) => m.profile_name !== recipe?.golden_match?.profile_name)
                          .slice(0, 2)
                          .map((match) => (
                            <div
                              key={match.profile_name}
                              className="flex items-center justify-between px-2.5 py-1 text-[10px] text-gray-400"
                            >
                              <span className="truncate">{match.display_name}</span>
                              <span>{(match.score * 100).toFixed(0)}%</span>
                            </div>
                          ))}
                      </div>
                    )}

                    {/* 参数溯源 */}
                    {recipe.provenance.source_profile && (
                      <div className="bg-gray-50/60 rounded-lg p-2.5 space-y-1.5">
                        <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">⚙️ 参数来源</div>
                        <div className="space-y-0.5">
                          {recipe.provenance.auto_filled_keys?.map((key) => (
                            <div key={key} className="flex items-center justify-between text-[10px]">
                              <span className="text-gray-500">{key.replace('default_', '')}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-gray-600 font-medium">
                                  {String(recipe.publish_config[key] ?? '-')}
                                </span>
                                <span className="text-[9px] text-gray-400">← 自动</span>
                              </div>
                            </div>
                          ))}
                          {recipe.provenance.admin_overrides && recipe.provenance.admin_overrides.length > 0 && (
                            <>
                              {recipe.provenance.admin_overrides.map((key) => (
                                <div key={key} className="flex items-center justify-between text-[10px]">
                                  <span className="text-gray-500">{key.replace('default_', '')}</span>
                                  <div className="flex items-center gap-1">
                                    <span className="text-gray-600 font-medium">
                                      {String(recipe.publish_config[key] ?? '-')}
                                    </span>
                                    <span className="text-[9px] text-gray-400">← 手动</span>
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 使用统计 */}
                    <div className="bg-gray-50 rounded-lg p-2.5">
                      <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">📊 使用统计</div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-sm font-bold text-gray-700">{recipe.usage.total_renders}</div>
                          <div className="text-[9px] text-gray-400">总渲染</div>
                        </div>
                        <div>
                          <div className="text-sm font-bold text-gray-600">{recipe.usage.succeeded}</div>
                          <div className="text-[9px] text-gray-400">成功</div>
                        </div>
                        <div>
                          <div className="text-sm font-bold text-gray-700">
                            {recipe.usage.success_rate != null ? `${recipe.usage.success_rate}%` : '-'}
                          </div>
                          <div className="text-[9px] text-gray-400">成功率</div>
                        </div>
                      </div>
                    </div>

                    {/* 展开详情 */}
                    {recipeExpanded && (
                      <div className="bg-gray-50/60 rounded-lg p-2.5 space-y-1.5 text-[10px] text-gray-500">
                        <div className="font-medium text-gray-600">Workflow</div>
                        {Object.entries(recipe.workflow_summary)
                          .filter(([, v]) => v)
                          .map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                              <span>{k}</span>
                              <span className="text-gray-700">{String(v)}</span>
                            </div>
                          ))}
                        {recipe.analysis.recommended_prompt && (
                          <>
                            <div className="font-medium text-gray-600 mt-1.5">Prompt (LLM)</div>
                            <p className="text-[9px] text-gray-400 break-words">{recipe.analysis.recommended_prompt}</p>
                          </>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => setRecipeExpanded(!recipeExpanded)}
                      className="w-full text-[10px] text-gray-400 hover:text-gray-600 text-center py-0.5"
                    >
                      {recipeExpanded ? '收起详情 ▲' : '展开详情 ▼'}
                    </button>
                  </div>
                ) : fingerprint ? (
                  /* 有指纹但无配方（兼容旧数据） */
                  <div className="space-y-2">
                    <div className="bg-gray-50/60 rounded-lg p-2.5 space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                        <span className="font-medium text-gray-600">{fingerprint.family}</span>
                        <span>·</span>
                        <span>{fingerprint.transition_category}</span>
                        <span>·</span>
                        <span>{fingerprint.camera_movement}</span>
                        <span>·</span>
                        <span>{fingerprint.duration_ms}ms</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-3 text-center text-[11px] text-gray-400">
                    尚无配方数据
                    <br />
                    <span className="text-gray-300">新入库模板会自动分析</span>
                  </div>
                )}
              </div>

              {/* 统计摘要 */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">总试渲染</span>
                  <span className="text-gray-700 font-medium">{previewRenders.length} 个</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">已完成</span>
                  <span className="text-gray-600 font-medium">{completedRenders.length} 个</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">主预览</span>
                  <span className="text-gray-700 font-medium">
                    {previewRenders.some((r) => r.is_featured) ? '✅ 已设置' : '❌ 未设置'}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">质量标签</span>
                  <span className="text-gray-700 font-medium">
                    {qualityLabel
                      ? QUALITY_LABEL_OPTIONS.find((o) => o.value === qualityLabel)?.label
                      : '未设置'}
                  </span>
                </div>
              </div>

              {/* 消息提示 */}
              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  {error}
                  <button onClick={() => setError(null)} className="ml-auto">
                    <X size={10} />
                  </button>
                </div>
              )}
              {successMsg && (
                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 flex items-center gap-1.5">
                  <CheckCircle size={12} />
                  {successMsg}
                </div>
              )}

              {/* 发布按钮 */}
              <button
                onClick={handlePublish}
                disabled={isPublishing}
                className="w-full py-3 bg-gray-800 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-gray-100"
              >
                {isPublishing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    发布中...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    发布模板
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ========== 视频播放弹窗 ========== */}
        {playingVideoUrl && (
          <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]"
            onClick={() => setPlayingVideoUrl(null)}
          >
            <div className="relative max-w-3xl w-full mx-4" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setPlayingVideoUrl(null)}
                className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white"
              >
                <X size={24} />
              </button>
              <video
                src={playingVideoUrl}
                controls
                autoPlay
                className="w-full rounded-xl shadow-2xl"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 单条试渲染卡片 ====================

interface PreviewRenderCardProps {
  render: PreviewRenderItem;
  onPlay: (url: string) => void;
  onRate: (rating: number) => void;
  onSetFeatured: () => void;
}

function PreviewRenderCard({ render, onPlay, onRate, onSetFeatured }: PreviewRenderCardProps) {
  const params = render.render_params || {};
  const variantLabel = (params as Record<string, unknown>).variant_label as string | undefined;

  const statusConfig: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    pending: { color: 'bg-gray-100 text-gray-500', label: '等待中', icon: <Loader2 size={10} /> },
    processing: { color: 'bg-gray-100 text-gray-600', label: '渲染中', icon: <Loader2 size={10} className="animate-spin" /> },
    completed: { color: 'bg-gray-100 text-gray-600', label: '完成', icon: <CheckCircle size={10} /> },
    failed: { color: 'bg-red-100 text-red-600', label: '失败', icon: <AlertCircle size={10} /> },
  };

  const st = statusConfig[render.status] || statusConfig.pending;

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${render.is_featured ? 'border-gray-400 ring-2 ring-gray-100' : 'border-gray-200'}`}>
      {/* 视频缩略图 / 状态 */}
      <div className="aspect-video bg-gray-100 relative">
        {render.status === 'completed' && render.video_url ? (
          <>
            <video src={render.video_url} className="w-full h-full object-cover" muted preload="metadata" />
            <div
              className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
              onClick={() => onPlay(render.video_url!)}
            >
              <div className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center">
                <Play size={16} className="text-gray-800 ml-0.5" />
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
            <div className={`px-2 py-1 rounded-full text-[10px] font-medium flex items-center gap-1 ${st.color}`}>
              {st.icon}
              {st.label}
            </div>
          </div>
        )}
        {/* Featured 标记 */}
        {render.is_featured && (
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-gray-700 text-white text-[10px] font-medium rounded-full flex items-center gap-0.5">
            <Award size={10} />
            主预览
          </div>
        )}
      </div>

      {/* 操作栏 */}
      <div className="p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400 truncate flex-1">
            {variantLabel || render.id.slice(0, 8)}
          </span>
          <span className="text-[10px] text-gray-300">
            {new Date(render.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {render.status === 'completed' && (
          <div className="flex items-center justify-between">
            {/* 星级评分 */}
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => onRate(star)}
                  className="p-0.5 transition-colors"
                >
                  <Star
                    size={14}
                    className={
                      render.admin_rating && star <= render.admin_rating
                        ? 'text-gray-400 fill-gray-400'
                        : 'text-gray-300'
                    }
                  />
                </button>
              ))}
            </div>
            {/* 设为主预览 */}
            {!render.is_featured && (
              <button
                onClick={onSetFeatured}
                className="text-[10px] text-gray-600 hover:text-gray-700 flex items-center gap-0.5"
              >
                <Eye size={10} />
                设为主预览
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TemplatePublishPanel;
