"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowLeftRight, Loader2, Sparkles, X, CheckCircle2 } from "lucide-react";
import {
  fetchTemplateCandidates,
  renderTemplate,
  replicateTransitionTemplate,
  uploadTemplateSourceFile,
  type TemplateCandidateItem,
} from "@/lib/api/templates";

/* ── shared interfaces (unchanged for WorkflowCanvas) ── */

interface TemplateRenderedEvent {
  taskId: string;
  status: string;
  endpoint: string;
  templateId: string;
  templateName?: string;
  sourceClipId?: string;
  targetClipId?: string;
}

interface TransitionPairInput {
  fromClipId: string;
  toClipId: string;
  fromThumbnail?: string;
  toThumbnail?: string;
}

interface TemplateCandidateModalProps {
  isOpen: boolean;
  clipId?: string;
  projectId?: string;
  transitionPair?: TransitionPairInput;
  onClose: () => void;
  onRendered?: (event: TemplateRenderedEvent) => void;
}

/* ── local types ── */

type CandidateMode = "background" | "transition";
type FocusMode = "outfit_change" | "subject_preserve" | "scene_shift";
type TransitionGoldenPreset =
  | "spin_occlusion_outfit"
  | "whip_pan_outfit"
  | "space_warp_outfit";

const FOCUS_MODE_OPTIONS: { value: FocusMode; label: string }[] = [
  { value: "outfit_change", label: "服装变装" },
  { value: "subject_preserve", label: "人物一致" },
  { value: "scene_shift", label: "场景切换" },
];

const GOLDEN_PRESET_OPTIONS: { value: TransitionGoldenPreset; label: string }[] = [
  { value: "spin_occlusion_outfit", label: "旋转遮挡" },
  { value: "whip_pan_outfit", label: "快甩变装" },
  { value: "space_warp_outfit", label: "空间穿梭" },
];

async function resolveImageUrl(
  localFile: File | null,
  carriedUrl: string,
  label: string,
): Promise<string> {
  if (localFile) {
    const uploaded = await uploadTemplateSourceFile(localFile, "template-replica-inputs");
    return uploaded.url;
  }
  if (carriedUrl) return carriedUrl;
  throw new Error(`请提供${label}图片`);
}

/* ================================================================
   Component
   ================================================================ */

export function TemplateCandidateModal({
  isOpen,
  clipId,
  projectId,
  transitionPair,
  onClose,
  onRendered,
}: TemplateCandidateModalProps) {
  /* ── step control: 1 = pick template,  2 = configure & render ── */
  const [step, setStep] = useState<1 | 2>(1);

  /* ── shared state ── */
  const [mode, setMode] = useState<CandidateMode>("background");
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  /* ── step 1 ── */
  const [candidates, setCandidates] = useState<TemplateCandidateItem[]>([]);
  const [searchPrompt, setSearchPrompt] = useState("");

  /* -- step 2 (all derived from selected template) -- */
  const [selectedCandidate, setSelectedCandidate] = useState<TemplateCandidateItem | null>(null);
  const [prompt, setPrompt] = useState("");
  const [fromImageUrl, setFromImageUrl] = useState("");
  const [toImageUrl, setToImageUrl] = useState("");
  const [fromImageFile, setFromImageFile] = useState<File | null>(null);
  const [toImageFile, setToImageFile] = useState<File | null>(null);
  const [focusModes, setFocusModes] = useState<FocusMode[]>(["outfit_change"]);
  const [goldenPreset, setGoldenPreset] = useState<TransitionGoldenPreset>("spin_occlusion_outfit");
  const [variantCount, setVariantCount] = useState(1);
  const [boundaryMs, setBoundaryMs] = useState(480);
  const fromFileRef = useRef<HTMLInputElement>(null);
  const toFileRef = useRef<HTMLInputElement>(null);

  /* ================================================================
     Effects
     ================================================================ */

  // Reset on open
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setSearchPrompt("");
    setError(null);
    setStatusMessage(null);
    setRendering(false);
    setLoading(false);
    setCandidates([]);
    setSelectedCandidate(null);
    // Initialize from/to images from canvas thumbnails
    setFromImageUrl(transitionPair?.fromThumbnail || "");
    setToImageUrl(transitionPair?.toThumbnail || "");
    setFromImageFile(null);
    setToImageFile(null);
  }, [isOpen, transitionPair]);

  // Auto-detect mode and fetch on open
  useEffect(() => {
    if (!isOpen) return;
    const m: CandidateMode = transitionPair ? "transition" : "background";
    setMode(m);
    void doFetch(m, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, transitionPair]);

  /* ================================================================
     Handlers
     ================================================================ */

  const doFetch = useCallback(async (m: CandidateMode, q: string) => {
    setLoading(true);
    setError(null);
    setCandidates([]);
    try {
      const result = await fetchTemplateCandidates({
        scope: "visual-studio",
        template_kind: m === "transition" ? "transition" : "background",
        limit: 6,
        prompt: q.trim() || undefined,
      });
      const list = result.candidates || [];
      setCandidates(list);
      if (list.length === 0) {
        setError(m === "transition"
          ? "没有找到转场模板，先去模板库导入"
          : "没有找到匹配模板，换个描述再试");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取推荐模板失败");
    } finally {
      setLoading(false);
    }
  }, []);

  /** Select a template → pre-fill step 2 with its defaults */
  const handleSelectCandidate = useCallback((c: TemplateCandidateItem) => {
    setSelectedCandidate(c);
    setError(null);
    setStatusMessage(null);
    setFromImageFile(null);
    setToImageFile(null);
    // Restore original thumbnails from canvas (clear any previous local overrides)
    setFromImageUrl(transitionPair?.fromThumbnail || "");
    setToImageUrl(transitionPair?.toThumbnail || "");

    // Pre-fill from template’s publish_config
    const pc = c.publish_config || {};
    const ts = c.transition_spec || {};

    // prompt: 转场模板不预填 recommended_prompt（那是模板源视频的内容描述，不是用户的）
    // 用户可以选择性描述自己的画面内容，也可以留空（后端仅用编舞脚本驱动渲染）
    if (mode === "transition") {
      setPrompt("");
    } else {
      setPrompt(ts.recommended_prompt || pc.default_prompt || c.render_spec?.prompt || "");
    }

    // focus_modes
    const fm = (pc.default_focus_modes || []).filter(
      (m: string): m is FocusMode =>
        m === "outfit_change" || m === "subject_preserve" || m === "scene_shift",
    );
    setFocusModes(fm.length > 0 ? fm : ["outfit_change"]);

    // golden_preset
    const gp = pc.default_golden_preset;
    setGoldenPreset(
      gp === "spin_occlusion_outfit" || gp === "whip_pan_outfit" || gp === "space_warp_outfit"
        ? gp
        : "spin_occlusion_outfit",
    );

    // variant_count
    setVariantCount(typeof pc.default_variant_count === "number" ? pc.default_variant_count : 1);

    // boundary_ms: prefer publish_config, then transition_spec.duration_ms
    const bms = pc.default_boundary_ms ?? ts.duration_ms;
    setBoundaryMs(typeof bms === "number" && bms >= 200 ? bms : 480);

    setStep(2);
  }, [transitionPair]);

  const handleBack = useCallback(() => {
    setStep(1);
    setSelectedCandidate(null);
    setError(null);
    setStatusMessage(null);
    setRendering(false);
  }, []);

  const handleRender = useCallback(async () => {
    if (!selectedCandidate) return;
    setRendering(true);
    setError(null);
    setStatusMessage("正在触发生成...");

    try {
      const spec = selectedCandidate.render_spec;

      if (mode === "transition") {
        const fromUrl = await resolveImageUrl(fromImageFile, fromImageUrl, "首帧");
        const toUrl = await resolveImageUrl(toImageFile, toImageUrl, "尾帧");

        const response = await replicateTransitionTemplate(selectedCandidate.template_id, {
          from_image_url: fromUrl,
          to_image_url: toUrl,
          prompt: prompt.trim(),  // 转场：仅传用户主动输入的内容，留空则后端纯用编舞脚本
          negative_prompt: spec.negative_prompt,
          duration: spec.duration,
          mode: spec.mode,
          aspect_ratio: spec.aspect_ratio,
          boundary_ms: boundaryMs,
          quality_tier: "template_match",
          focus_modes: focusModes.length ? focusModes : ["outfit_change"],
          golden_preset: goldenPreset,
          apply_mode: "insert_between",
          variant_count: variantCount,
          project_id: projectId,
          clip_id: transitionPair?.fromClipId || clipId,
          overrides: { kling_endpoint: "multi_image_to_video" },
        });

        for (const task of response.tasks || []) {
          onRendered?.({
            taskId: task.task_id,
            status: task.status,
            endpoint: response.endpoint,
            templateId: selectedCandidate.template_id,
            templateName: `${selectedCandidate.name} · ${task.variant_label}`,
            sourceClipId: transitionPair?.fromClipId,
            targetClipId: transitionPair?.toClipId,
          });
        }
      } else {
        const response = await renderTemplate(selectedCandidate.template_id, {
          prompt: prompt || spec.prompt,
          negative_prompt: spec.negative_prompt,
          duration: spec.duration,
          model_name: spec.model_name,
          cfg_scale: spec.cfg_scale,
          mode: spec.mode,
          aspect_ratio: spec.aspect_ratio,
          images: spec.images,
          video_url: spec.video_url,
          project_id: projectId,
          clip_id: clipId,
          write_clip_metadata: true,
          overrides: { kling_endpoint: spec.endpoint },
        });

        onRendered?.({
          taskId: response.task_id,
          status: response.status,
          endpoint: response.endpoint,
          templateId: selectedCandidate.template_id,
          templateName: selectedCandidate.name,
        });
      }

      setStatusMessage("✓ 已提交生成任务");
      setRendering(false);
      setTimeout(() => onClose(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "触发模板生成失败");
      setRendering(false);
      setStatusMessage(null);
    }
  }, [
    selectedCandidate, mode, boundaryMs, clipId,
    fromImageUrl, toImageUrl, focusModes, fromImageFile,
    goldenPreset, onClose, onRendered, projectId, prompt,
    toImageFile, transitionPair, variantCount,
  ]);

  /* ================================================================
     Render
     ================================================================ */

  if (!isOpen) return null;

  const fromPreview = fromImageFile ? URL.createObjectURL(fromImageFile) : fromImageUrl;
  const toPreview = toImageFile ? URL.createObjectURL(toImageFile) : toImageUrl;

  /** Swap the two images (both URL and file) */
  const handleSwapImages = useCallback(() => {
    setFromImageUrl(prev => {
      const oldTo = toImageUrl;
      setToImageUrl(prev);
      return oldTo;
    });
    setFromImageFile(prev => {
      const oldTo = toImageFile;
      setToImageFile(prev);
      return oldTo;
    });
  }, [toImageUrl, toImageFile]);

  /** Clear one side's image, triggering file picker */
  const handleClearFromImage = useCallback(() => {
    setFromImageUrl("");
    setFromImageFile(null);
    // Trigger file picker
    setTimeout(() => fromFileRef.current?.click(), 50);
  }, []);
  const handleClearToImage = useCallback(() => {
    setToImageUrl("");
    setToImageFile(null);
    setTimeout(() => toFileRef.current?.click(), 50);
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[760px] max-w-[96vw] max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col">
        {/* ── header ── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button onClick={handleBack} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 mr-1">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <Sparkles className="h-5 w-5 text-gray-500" />
            <h3 className="text-base font-semibold text-gray-900">
              {step === 1 ? "选择推荐模板" : `${selectedCandidate?.name ?? "模板"} · 参数配置`}
            </h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── body ── */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* ========== STEP 1: pick template ========== */}
          {step === 1 && (
            <>
              {/* mode toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setMode("background"); void doFetch("background", searchPrompt); }}
                  className={`h-9 rounded-lg border text-sm font-medium transition-colors ${mode === "background" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}
                >背景模板</button>
                <button
                  onClick={() => { setMode("transition"); void doFetch("transition", searchPrompt); }}
                  className={`h-9 rounded-lg border text-sm font-medium transition-colors ${mode === "transition" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}
                >两图转场复刻</button>
              </div>

              {/* search */}
              <div className="flex gap-2">
                <input
                  value={searchPrompt}
                  onChange={(e) => setSearchPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void doFetch(mode, searchPrompt); }}
                  placeholder={mode === "transition" ? "搜索转场模板，如：变装、甩头" : "搜索模板，如：科技感背景"}
                  className="h-10 flex-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 outline-none focus:border-gray-400"
                />
                <button
                  onClick={() => void doFetch(mode, searchPrompt)}
                  disabled={loading}
                  className="h-10 px-4 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex-shrink-0"
                >{loading ? "搜索中…" : "搜索"}</button>
              </div>

              {/* loading */}
              {loading && candidates.length === 0 && (
                <div className="flex items-center justify-center py-16 text-sm text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  正在获取推荐模板…
                </div>
              )}

              {/* candidate cards */}
              {!loading && candidates.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {candidates.map((c) => {
                    const displayName = c.publish_config?.display_name || c.name;
                    const description = c.publish_config?.description || c.transition_spec?.transition_description;
                    const bestFor = c.publish_config?.best_for;
                    return (
                      <button
                        key={c.template_id}
                        onClick={() => handleSelectCandidate(c)}
                        className="group relative rounded-xl border border-gray-200 bg-white overflow-hidden text-left hover:border-gray-300 hover:shadow-md transition-all"
                      >
                        {/* thumbnail with preview video on hover */}
                        <div className="relative w-full h-32 overflow-hidden">
                          {c.preview_video_url ? (
                            <>
                              <img src={c.thumbnail_url || ''} alt={displayName} className="w-full h-full object-cover group-hover:opacity-0 transition-opacity" />
                              <video
                                src={c.preview_video_url}
                                muted
                                loop
                                playsInline
                                className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity"
                                onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                                onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                              />
                            </>
                          ) : c.thumbnail_url ? (
                            <img src={c.thumbnail_url} alt={displayName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center">
                              <Sparkles className="h-8 w-8 text-gray-300" />
                            </div>
                          )}
                        </div>
                        {/* quality badge */}
                        {c.quality_label === "golden" && (
                          <span className="absolute top-2 left-2 bg-gray-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow">
                            ⭐ 精选
                          </span>
                        )}
                        {/* info — user-friendly */}
                        <div className="px-2.5 py-2">
                          <div className="text-xs font-medium text-gray-900 truncate">{displayName}</div>
                          {description && (
                            <div className="mt-0.5 text-[10px] text-gray-500 line-clamp-2">{description}</div>
                          )}
                          {bestFor && bestFor.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {bestFor.slice(0, 2).map((tag: string) => (
                                <span key={tag} className="inline-block rounded-full bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">{tag}</span>
                              ))}
                            </div>
                          )}
                          {!description && !bestFor?.length && (c.tags || []).slice(0, 2).map((t) => (
                            <span key={t} className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 mt-1 mr-1">{t}</span>
                          ))}
                        </div>
                        {/* hover overlay */}
                        {!c.preview_video_url && (
                          <div className="absolute inset-0 flex items-center justify-center bg-gray-600/0 group-hover:bg-gray-600/10 transition-colors pointer-events-none">
                            <span className="opacity-0 group-hover:opacity-100 text-xs font-medium text-gray-700 bg-white/90 px-3 py-1.5 rounded-full shadow transition-opacity">
                              使用此模板
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ========== STEP 2: configure selected template ========== */}
          {step === 2 && selectedCandidate && (
            <>
              {/* ── 效果预览 ── */}
              {(() => {
                const displayName = selectedCandidate.publish_config?.display_name || selectedCandidate.name;
                const description = selectedCandidate.publish_config?.description || selectedCandidate.transition_spec?.transition_description;
                return (
                  <div className="rounded-xl border border-gray-200 bg-gray-50/30 overflow-hidden">
                    {/* preview video or thumbnail */}
                    {selectedCandidate.preview_video_url ? (
                      <video
                        src={selectedCandidate.preview_video_url}
                        autoPlay muted loop playsInline
                        className="w-full h-40 object-cover bg-black"
                      />
                    ) : selectedCandidate.thumbnail_url ? (
                      <img src={selectedCandidate.thumbnail_url} alt={displayName} className="w-full h-40 object-cover" />
                    ) : null}
                    <div className="px-4 py-3">
                      <div className="text-sm font-semibold text-gray-900">{displayName}</div>
                      {description && (
                        <div className="mt-1 text-xs text-gray-500 leading-relaxed">{description}</div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── 素材选择 (transition mode) ── */}
              {mode === "transition" && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">

                  {/* from / to image — compact row */}
                  <div className="flex items-center justify-center gap-3">
                    {/* from image */}
                    <div className="space-y-1 w-[140px] flex-shrink-0">
                      <label className="text-[11px] text-gray-500 font-medium">首帧</label>
                      <div className="relative group aspect-[4/3] rounded-lg overflow-hidden border border-gray-200 bg-white">
                        {fromPreview ? (
                          <>
                            <img src={fromPreview} alt="首帧" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={handleClearFromImage}
                              className="absolute top-1 right-1 rounded-full bg-black/50 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                              title="重新选择图片"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => fromFileRef.current?.click()}
                            className="w-full h-full flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-gray-700 transition-colors border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-300"
                          >
                            <span className="text-lg leading-none">+</span>
                            <span className="text-[10px]">选择图片</span>
                          </button>
                        )}
                        <input
                          ref={fromFileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) { setFromImageFile(f); setFromImageUrl(""); }
                            e.target.value = "";
                          }}
                        />
                      </div>
                    </div>

                    {/* swap button */}
                    <button
                      type="button"
                      onClick={handleSwapImages}
                      className="mt-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors flex-shrink-0"
                      title="调换首尾帧"
                    >
                      <ArrowLeftRight className="h-4 w-4" />
                    </button>

                    {/* to image */}
                    <div className="space-y-1 w-[140px] flex-shrink-0">
                      <label className="text-[11px] text-gray-500 font-medium">尾帧</label>
                      <div className="relative group aspect-[4/3] rounded-lg overflow-hidden border border-gray-200 bg-white">
                        {toPreview ? (
                          <>
                            <img src={toPreview} alt="尾帧" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={handleClearToImage}
                              className="absolute top-1 right-1 rounded-full bg-black/50 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                              title="重新选择图片"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toFileRef.current?.click()}
                            className="w-full h-full flex flex-col items-center justify-center gap-0.5 text-gray-400 hover:text-gray-700 transition-colors border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-300"
                          >
                            <span className="text-lg leading-none">+</span>
                            <span className="text-[10px]">选择图片</span>
                          </button>
                        )}
                        <input
                          ref={toFileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) { setToImageFile(f); setToImageUrl(""); }
                            e.target.value = "";
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* ── 效果调整 ── */}
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
                      {/* 转场风格 */}
                      <div className="space-y-1">
                        <label className="text-xs text-gray-600">转场风格</label>
                        <select value={goldenPreset} onChange={(e) => setGoldenPreset(e.target.value as TransitionGoldenPreset)} className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs text-gray-800">
                          {GOLDEN_PRESET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      {/* 生成数量 */}
                      <div className="space-y-1">
                        <label className="text-xs text-gray-600">生成数量</label>
                        <select value={variantCount} onChange={(e) => setVariantCount(Number(e.target.value))} className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs text-gray-800">
                          <option value={1}>1 次</option>
                          <option value={2}>2 次（对比）</option>
                          <option value={3}>3 次（全对比）</option>
                        </select>
                      </div>
                    </div>

                    {/* 保留要素 */}
                    <div className="space-y-1">
                      <label className="text-xs text-gray-600">保留要素</label>
                      <div className="flex flex-wrap gap-1.5">
                        {FOCUS_MODE_OPTIONS.map(({ value, label }) => {
                          const checked = focusModes.includes(value);
                          return (
                            <label key={value} className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${checked ? "bg-gray-50 border-gray-300 text-gray-700" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                              <input type="checkbox" className="sr-only" checked={checked} onChange={() => {
                                if (checked) { if (focusModes.length > 1) setFocusModes(focusModes.filter(m => m !== value)); }
                                else { setFocusModes([...focusModes, value]); }
                              }} />
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${checked ? "bg-gray-800 border-gray-800" : "border-gray-300"}`}>
                                {checked && <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                              </span>
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* 转场时长 */}
                    <div className="space-y-1">
                      <label className="text-xs text-gray-600">转场时长 <span className="text-gray-400">{boundaryMs}ms</span></label>
                      <input type="range" min={200} max={1200} step={20} value={boundaryMs} onChange={(e) => setBoundaryMs(Number(e.target.value))} className="w-full accent-gray-500" />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Prompt ── */}
              <div className="space-y-1">
                <label className="text-xs text-gray-600">
                  {mode === "transition" ? "补充描述" : "风格描述"}
                  {selectedCandidate.publish_config?.allow_prompt_override === false && (
                    <span className="ml-1 text-[10px] text-gray-500">(此模板不允许覆盖)</span>
                  )}
                  {mode === "transition" && (
                    <span className="ml-1 text-[10px] text-gray-400">可选，留空自动生成</span>
                  )}
                </label>
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={selectedCandidate.publish_config?.allow_prompt_override === false}
                  placeholder={mode === "transition" ? "可选：描述你想要的画面风格" : (selectedCandidate.render_spec?.prompt || "使用模板默认描述")}
                  className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>
            </>
          )}

          {/* ── error / status ── */}
          {error && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}
          {statusMessage && !error && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 flex items-center gap-2">
              {(loading || rendering) ? <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" /> : <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
              {statusMessage}
            </div>
          )}

          {/* ── step 2 render button ── */}
          {step === 2 && selectedCandidate && (
            <button
              onClick={handleRender}
              disabled={rendering || (mode === "transition" && !fromPreview && !toPreview)}
              className="w-full h-11 rounded-lg bg-gray-800 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {rendering ? (
                <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
              ) : (
                <><Sparkles className="h-4 w-4" />使用「{selectedCandidate.name}」生成</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
