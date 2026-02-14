'use client';

/**
 * 质量参考图管理
 *
 * 功能：
 *   1. 按类别分组展示参考图
 *   2. 拖拽/选择上传图片 → 自动上传到 Storage → 生成 embedding → 入库
 *   3. 卡片预览 + 删除
 *   4. 种子策略一键入库
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Upload,
  Trash2,
  Loader2,
  ImageIcon,
  RefreshCw,
  Sparkles,
  Plus,
  X,
  Database,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  enhancementRagApi,
  REFERENCE_CATEGORY_LABELS,
  SOURCE_TYPE_LABELS,
  PLATFORM_LABELS,
  type QualityReferenceItem,
  type ReferenceCategory,
  type ReferenceAnalysisResult,
  type SourceType,
  type ApplicablePlatform,
} from '@/lib/api/enhancement-rag';

// ── 类别配置 ──────────────────────────────────

const CATEGORIES: { key: ReferenceCategory; emoji: string }[] = [
  { key: 'face_portrait', emoji: '👤' },
  { key: 'garment', emoji: '👗' },
  { key: 'accessory', emoji: '💎' },
  { key: 'product', emoji: '📦' },
  { key: 'scene', emoji: '🏞️' },
  { key: 'generic', emoji: '🎨' },
];

// ── 上传表单状态 ──────────────────────────────

type UploadPhase = 'pick' | 'analyzing' | 'review' | 'confirming';

interface UploadForm {
  file: File | null;
  preview: string;
  // LLM 分析结果（可编辑）
  category: ReferenceCategory;
  sourceType: SourceType;
  applicablePlatforms: ApplicablePlatform[];
  description: string;
  style: string;
  qualityScore: number;
  qualityReasoning: string;
  // base64（从 analyze 返回，confirm 时传回）
  imageBase64: string;
  fileName: string;
  contentType: string;
}

const INITIAL_FORM: UploadForm = {
  file: null,
  preview: '',
  category: 'face_portrait',
  sourceType: 'unknown',
  applicablePlatforms: ['universal'],
  description: '',
  style: '',
  qualityScore: 0.9,
  qualityReasoning: '',
  imageBase64: '',
  fileName: '',
  contentType: '',
};

// ── 组件 ──────────────────────────────────────

export function QualityReferenceManager() {
  // 数据
  const [references, setReferences] = useState<QualityReferenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<ReferenceCategory | 'all'>('all');

  // 上传
  const [showUpload, setShowUpload] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('pick');
  const [form, setForm] = useState<UploadForm>(INITIAL_FORM);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 种子入库
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState('');

  // 删除
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── 加载数据 ────────────────────────────────

  const loadReferences = useCallback(async () => {
    setLoading(true);
    try {
      const category = activeCategory === 'all' ? undefined : activeCategory;
      const res = await enhancementRagApi.listReferences(category);
      if (res.data) {
        // ApiClient 包装: res.data = { success, data: [...] }，需取内层 .data
        const payload = res.data as any;
        const items = Array.isArray(payload) ? payload : (payload?.data ?? []);
        setReferences(Array.isArray(items) ? items : []);
      }
    } catch (e) {
      console.error('[QualityRef] 加载失败:', e);
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    loadReferences();
  }, [loadReferences]);

  // ── 文件选择 → 自动分析 ──────────────────────

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const preview = URL.createObjectURL(file);
    setForm(prev => ({ ...prev, file, preview }));
    setUploadError('');

    // 自动触发 LLM 分析
    setUploadPhase('analyzing');
    try {
      const res = await enhancementRagApi.analyzeImage(file);
      if (res.error) {
        setUploadError(res.error.message);
        setUploadPhase('pick');
        return;
      }
      const data = res.data as ReferenceAnalysisResult;
      setForm(prev => ({
        ...prev,
        category: (data.category || 'generic') as ReferenceCategory,
        sourceType: (data.source_type || 'unknown') as SourceType,
        applicablePlatforms: (data.applicable_platforms || ['universal']) as ApplicablePlatform[],
        description: data.description || '',
        style: data.style || '',
        qualityScore: data.quality_score ?? 0.7,
        qualityReasoning: data.quality_reasoning || '',
        imageBase64: data.image_base64 || '',
        fileName: data.file_name || file.name,
        contentType: data.content_type || file.type,
      }));
      setUploadPhase('review');
    } catch (e: any) {
      setUploadError(e.message || '分析失败');
      setUploadPhase('pick');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  // ── 确认入库 ────────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (!form.imageBase64 || !form.description.trim()) {
      setUploadError('分析数据不完整');
      return;
    }

    setUploadPhase('confirming');
    setUploadError('');

    try {
      const res = await enhancementRagApi.confirmReference({
        category: form.category,
        description: form.description.trim(),
        style: form.style.trim() || 'auto_detected',
        quality_score: form.qualityScore,
        source_type: form.sourceType,
        applicable_platforms: form.applicablePlatforms,
        image_base64: form.imageBase64,
        file_name: form.fileName,
        content_type: form.contentType,
      });

      if (res.error) {
        setUploadError(res.error.message);
        setUploadPhase('review');
        return;
      }

      // 成功
      if (form.preview) URL.revokeObjectURL(form.preview);
      setForm(INITIAL_FORM);
      setUploadPhase('pick');
      setShowUpload(false);
      await loadReferences();
    } catch (e: any) {
      setUploadError(e.message || '入库失败');
      setUploadPhase('review');
    }
  }, [form, loadReferences]);

  // ── 删除 ────────────────────────────────────

  const handleDelete = useCallback(async (refId: string) => {
    if (!confirm('确定删除这张参考图？')) return;
    setDeletingId(refId);
    try {
      await enhancementRagApi.deleteReference(refId);
      setReferences(prev => prev.filter(r => r.id !== refId));
    } catch (e) {
      console.error('[QualityRef] 删除失败:', e);
    } finally {
      setDeletingId(null);
    }
  }, []);

  // ── 种子入库 ────────────────────────────────

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    setSeedResult('');
    try {
      const res = await enhancementRagApi.seedStrategies();
      if (res.data) {
        setSeedResult(`✅ 成功入库 ${(res.data as any).count} 条增强策略`);
      } else {
        setSeedResult(`❌ ${res.error?.message || '入库失败'}`);
      }
    } catch (e: any) {
      setSeedResult(`❌ ${e.message || '入库失败'}`);
    } finally {
      setSeeding(false);
    }
  }, []);

  // ── 过滤 ────────────────────────────────────

  const safeRefs = Array.isArray(references) ? references : [];

  const filteredRefs = activeCategory === 'all'
    ? safeRefs
    : safeRefs.filter(r => r.category === activeCategory);

  const categoryCounts = safeRefs.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {});

  // ── 渲染 ────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors shadow-sm"
          >
            <Plus size={16} />
            上传参考图
          </button>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            {seeding ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
            种子策略入库
          </button>
        </div>
        <button
          onClick={loadReferences}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="text-xs">刷新</span>
        </button>
      </div>

      {seedResult && (
        <div className={`px-4 py-2.5 rounded-lg text-sm ${
          seedResult.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {seedResult}
        </div>
      )}

      {/* 类别 Tab */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeCategory === 'all'
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          全部 ({references.length})
        </button>
        {CATEGORIES.map(({ key, emoji }) => (
          <button
            key={key}
            onClick={() => setActiveCategory(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeCategory === key
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {emoji} {REFERENCE_CATEGORY_LABELS[key]} ({categoryCounts[key] || 0})
          </button>
        ))}
      </div>

      {/* 上传弹窗 */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl w-[520px] max-h-[90vh] overflow-y-auto shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">
                {uploadPhase === 'pick' && '上传质量参考图'}
                {uploadPhase === 'analyzing' && 'AI 正在分析...'}
                {uploadPhase === 'review' && '确认分析结果'}
                {uploadPhase === 'confirming' && '入库中...'}
              </h3>
              <button onClick={() => { setShowUpload(false); setUploadError(''); setUploadPhase('pick'); setForm(INITIAL_FORM); }} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-5">
              {/* Phase 1: 选择图片 */}
              {uploadPhase === 'pick' && (
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center cursor-pointer hover:border-gray-400 hover:bg-gray-50/50 transition-colors"
                >
                  <Upload size={36} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-sm text-gray-500 font-medium">拖拽图片到这里，或点击选择</p>
                  <p className="text-xs text-gray-400 mt-1.5">支持 JPG、PNG、WebP · AI 将自动分析类别和质量</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleInputChange}
                  />
                </div>
              )}

              {/* Phase 2: 分析中 */}
              {uploadPhase === 'analyzing' && (
                <div className="flex flex-col items-center py-10">
                  {form.preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.preview} alt="预览" className="w-32 h-32 object-cover rounded-xl mb-5 shadow-sm" />
                  )}
                  <Loader2 size={28} className="animate-spin text-indigo-500 mb-3" />
                  <p className="text-sm text-gray-600 font-medium">AI 正在分析图片质量与内容...</p>
                  <p className="text-xs text-gray-400 mt-1">识别类别 · 评估质量 · 生成描述</p>
                </div>
              )}

              {/* Phase 3: 审核结果（可编辑） */}
              {(uploadPhase === 'review' || uploadPhase === 'confirming') && (
                <>
                  {/* 图片预览 + 质量评分 */}
                  <div className="flex gap-4">
                    {form.preview && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.preview} alt="预览" className="w-28 h-28 object-cover rounded-xl shadow-sm flex-shrink-0" />
                    )}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-bold ${
                          form.qualityScore >= 0.90 ? 'text-green-600' :
                          form.qualityScore >= 0.75 ? 'text-blue-600' :
                          form.qualityScore >= 0.60 ? 'text-yellow-600' : 'text-red-500'
                        }`}>
                          {Math.round(form.qualityScore * 100)}
                        </span>
                        <span className="text-xs text-gray-400">/ 100 AI参考价值分</span>
                      </div>
                      {form.qualityReasoning && (
                        <p className="text-xs text-gray-500 leading-relaxed">{form.qualityReasoning}</p>
                      )}
                    </div>
                  </div>

                  {/* 类别（可切换） */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">内容类别</label>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORIES.map(({ key, emoji }) => (
                        <button
                          key={key}
                          onClick={() => setForm(prev => ({ ...prev, category: key }))}
                          disabled={uploadPhase === 'confirming'}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            form.category === key
                              ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {emoji} {REFERENCE_CATEGORY_LABELS[key]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 素材来源 + 适用平台 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">素材来源</label>
                      <select
                        value={form.sourceType}
                        onChange={(e) => setForm(prev => ({ ...prev, sourceType: e.target.value as SourceType }))}
                        disabled={uploadPhase === 'confirming'}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50 bg-white"
                      >
                        {(Object.entries(SOURCE_TYPE_LABELS) as [SourceType, string][]).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">适用平台</label>
                      <div className="flex flex-wrap gap-1.5">
                        {(Object.entries(PLATFORM_LABELS) as [ApplicablePlatform, string][]).map(([k, v]) => (
                          <button
                            key={k}
                            onClick={() => setForm(prev => {
                              const has = prev.applicablePlatforms.includes(k);
                              return {
                                ...prev,
                                applicablePlatforms: has
                                  ? prev.applicablePlatforms.filter(p => p !== k)
                                  : [...prev.applicablePlatforms, k],
                              };
                            })}
                            disabled={uploadPhase === 'confirming'}
                            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                              form.applicablePlatforms.includes(k)
                                ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 描述（可编辑） */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">图片描述（用于语义检索）</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                      disabled={uploadPhase === 'confirming'}
                      rows={3}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 resize-none disabled:opacity-50"
                    />
                  </div>

                  {/* 风格标签 + 质量分 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">风格标签</label>
                      <input
                        value={form.style}
                        onChange={(e) => setForm(prev => ({ ...prev, style: e.target.value }))}
                        disabled={uploadPhase === 'confirming'}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">AI参考价值分</label>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={form.qualityScore}
                        onChange={(e) => setForm(prev => ({ ...prev, qualityScore: parseFloat(e.target.value) || 0.7 }))}
                        disabled={uploadPhase === 'confirming'}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50"
                      />
                    </div>
                  </div>
                </>
              )}

              {uploadError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm">
                  <AlertTriangle size={14} />
                  {uploadError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setShowUpload(false); setUploadError(''); setUploadPhase('pick'); setForm(INITIAL_FORM); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              {uploadPhase === 'review' && (
                <button
                  onClick={handleConfirm}
                  disabled={!form.description.trim()}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all shadow-sm ${
                    !form.description.trim()
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-900 text-white hover:bg-gray-800 active:scale-[0.98]'
                  }`}
                >
                  <CheckCircle2 size={14} />
                  确认入库
                </button>
              )}
              {uploadPhase === 'confirming' && (
                <button disabled className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-gray-200 text-gray-400 cursor-not-allowed">
                  <Loader2 size={14} className="animate-spin" />
                  入库中...
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 参考图网格 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : filteredRefs.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-gray-400">
          <ImageIcon size={40} className="mb-3 text-gray-300" />
          <p className="text-sm font-medium">暂无参考图</p>
          <p className="text-xs mt-1">上传高质量标杆图片，用于增强管线的视觉标准</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredRefs.map((ref) => (
            <div
              key={ref.id}
              className="group relative rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* 图片 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ref.image_url}
                alt={ref.description}
                className="w-full h-36 object-cover bg-gray-50"
              />

              {/* 信息 */}
              <div className="p-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium">
                    {REFERENCE_CATEGORY_LABELS[ref.category as ReferenceCategory] || ref.category}
                  </span>
                  {ref.source === 'auto' && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded">
                      自动
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 ml-auto">
                    {Math.round(ref.quality_score * 100)}%
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">
                  {ref.description}
                </p>
              </div>

              {/* 删除按钮 */}
              <button
                onClick={() => handleDelete(ref.id)}
                disabled={deletingId === ref.id}
                className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-lg opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-all"
              >
                {deletingId === ref.id
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Trash2 size={12} />
                }
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
