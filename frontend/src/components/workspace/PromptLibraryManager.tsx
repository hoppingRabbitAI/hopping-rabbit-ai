'use client';

/**
 * Prompt Library Manager
 * 时尚垂类 prompt 向量库管理界面
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Trash2, Database, Filter, X, Sparkles, Copy, Check,
} from 'lucide-react';
import {
  promptLibraryApi,
  CAPABILITY_LABELS,
  PLATFORM_LABELS,
  INPUT_TYPE_LABELS,
  SOURCE_LABELS,
} from '@/lib/api/prompt-library';
import type {
  PromptLibraryItem,
  PromptLibraryStats,
  PromptCapability,
  PromptPlatform,
  PromptInputType,
} from '@/lib/api/prompt-library';

// ── 筛选选项 ──────────────────────────────────

const CAPABILITIES: { id: PromptCapability | 'all'; label: string; icon: string }[] = [
  { id: 'all', label: '全部', icon: '📋' },
  { id: 'omni_image', label: '图像生成', icon: '🖼️' },
  { id: 'relight', label: 'AI 打光', icon: '💡' },
  { id: 'outfit_swap', label: '换装', icon: '👗' },
  { id: 'ai_stylist', label: '穿搭师', icon: '🎨' },
  { id: 'skin_enhance', label: '美肤', icon: '✨' },
  { id: 'face_swap', label: '换脸', icon: '🎭' },
  { id: 'outfit_shot', label: '穿搭内容', icon: '📸' },
  { id: 'image_to_video', label: '图生视频', icon: '🎬' },
  { id: 'text_to_video', label: '文生视频', icon: '📹' },
];

const PLATFORMS: { id: PromptPlatform | 'all'; label: string }[] = [
  { id: 'all', label: '全部平台' },
  { id: 'universal', label: '通用' },
  { id: 'douyin', label: '抖音/快手' },
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'bilibili', label: 'B站' },
  { id: 'weibo', label: '微博' },
];

const INPUT_TYPES: { id: PromptInputType | 'all'; label: string }[] = [
  { id: 'all', label: '全部输入' },
  { id: 'universal', label: '通用' },
  { id: 'ecommerce', label: '电商主图' },
  { id: 'selfie', label: '社交自拍' },
  { id: 'street_snap', label: '街拍/KOL' },
  { id: 'runway', label: '秀场/大片' },
];

export function PromptLibraryManager() {
  // ── 状态 ────────────────────────────────────
  const [prompts, setPrompts] = useState<PromptLibraryItem[]>([]);
  const [stats, setStats] = useState<PromptLibraryStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);

  // 筛选
  const [filterCap, setFilterCap] = useState<string>('all');
  const [filterPlat, setFilterPlat] = useState<string>('all');
  const [filterInput, setFilterInput] = useState<string>('all');

  // 搜索
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  // 添加
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    capability: 'omni_image',
    platform: 'universal',
    input_type: 'universal',
    prompt: '',
    negative_prompt: '',
    label: '',
  });
  const [adding, setAdding] = useState(false);

  // 复制
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── 数据加载 ────────────────────────────────

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await promptLibraryApi.listPrompts({
        capability: filterCap === 'all' ? undefined : filterCap,
        platform: filterPlat === 'all' ? undefined : filterPlat,
        input_type: filterInput === 'all' ? undefined : filterInput,
        page_size: 100,
      });
      if (resp.data) {
        setPrompts(resp.data);
      }
    } catch (err) {
      console.error('Failed to fetch prompts:', err);
    } finally {
      setLoading(false);
    }
  }, [filterCap, filterPlat, filterInput]);

  const fetchStats = useCallback(async () => {
    try {
      const resp = await promptLibraryApi.getStats();
      if (resp.data) {
        setStats(resp.data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
    fetchStats();
  }, [fetchPrompts, fetchStats]);

  // ── 语义搜索 ────────────────────────────────

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const resp = await promptLibraryApi.searchPrompts({
        query: searchQuery,
        capability: filterCap === 'all' ? undefined : filterCap,
        platform: filterPlat === 'all' ? undefined : filterPlat,
        input_type: filterInput === 'all' ? undefined : filterInput,
        top_k: 20,
      });
      if (resp.data) {
        setPrompts(resp.data);
        setSearchMode(true);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchMode(false);
    setSearchQuery('');
    fetchPrompts();
  };

  // ── 种子入库 ────────────────────────────────

  const handleSeed = async () => {
    setSeeding(true);
    setSeedResult(null);
    try {
      const resp = await promptLibraryApi.seedPrompts();
      if (resp.data) {
        const seedData = resp.data as { total_inserted: number; errors: number };
        setSeedResult(`✅ 入库 ${seedData.total_inserted} 条${seedData.errors > 0 ? `，${seedData.errors} 条失败` : ''}`);
        fetchPrompts();
        fetchStats();
      } else {
        setSeedResult(`❌ ${resp.error?.message || '入库失败'}`);
      }
    } catch (err) {
      setSeedResult(`❌ ${err instanceof Error ? err.message : '入库失败'}`);
    } finally {
      setSeeding(false);
    }
  };

  // ── 添加 ────────────────────────────────────

  const handleAdd = async () => {
    if (!addForm.prompt.trim()) return;
    setAdding(true);
    try {
      const resp = await promptLibraryApi.addPrompt({
        capability: addForm.capability,
        platform: addForm.platform,
        input_type: addForm.input_type,
        prompt: addForm.prompt,
        negative_prompt: addForm.negative_prompt,
        label: addForm.label,
      });
      if (resp.data) {
        setShowAdd(false);
        setAddForm({ capability: 'omni_image', platform: 'universal', input_type: 'universal', prompt: '', negative_prompt: '', label: '' });
        fetchPrompts();
        fetchStats();
      }
    } catch (err) {
      console.error('Add failed:', err);
    } finally {
      setAdding(false);
    }
  };

  // ── 删除 ────────────────────────────────────

  const handleDelete = async (id: string) => {
    try {
      const resp = await promptLibraryApi.deletePrompt(id);
      if (resp.data) {
        setPrompts(prev => prev.filter(p => p.id !== id));
        fetchStats();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // ── 复制 ────────────────────────────────────

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // ── 渲染 ────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* 头部：统计 + 操作按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-zinc-300">
            Prompt 向量库
          </h3>
          {stats && (
            <span className="text-xs text-zinc-500">
              共 {stats.total} 条
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            添加 Prompt
          </button>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-1 rounded-md bg-indigo-600/80 px-3 py-1.5 text-xs text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
          >
            <Database className="h-3.5 w-3.5" />
            {seeding ? '入库中...' : '种子入库'}
          </button>
        </div>
      </div>

      {seedResult && (
        <div className="rounded-md bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
          {seedResult}
        </div>
      )}

      {/* 能力筛选 Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {CAPABILITIES.map(cap => {
          const count = cap.id === 'all'
            ? stats?.total ?? 0
            : stats?.by_capability?.[cap.id] ?? 0;
          return (
            <button
              key={cap.id}
              onClick={() => { setFilterCap(cap.id); setSearchMode(false); }}
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors ${
                filterCap === cap.id
                  ? 'bg-indigo-600/80 text-white'
                  : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-300'
              }`}
            >
              <span>{cap.icon}</span>
              <span>{cap.label}</span>
              {count > 0 && (
                <span className={`ml-0.5 text-[10px] ${filterCap === cap.id ? 'text-indigo-200' : 'text-zinc-500'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 平台 + 输入类型 + 搜索 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Filter className="h-3.5 w-3.5 text-zinc-500" />
          <select
            value={filterPlat}
            onChange={e => { setFilterPlat(e.target.value); setSearchMode(false); }}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 border border-zinc-700 focus:border-indigo-500 outline-none"
          >
            {PLATFORMS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <select
            value={filterInput}
            onChange={e => { setFilterInput(e.target.value); setSearchMode(false); }}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 border border-zinc-700 focus:border-indigo-500 outline-none"
          >
            {INPUT_TYPES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        {/* 语义搜索 */}
        <div className="flex items-center gap-1">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="语义搜索 prompt..."
              className="w-56 rounded bg-zinc-800 px-3 py-1.5 pl-8 text-xs text-zinc-300 border border-zinc-700 focus:border-indigo-500 outline-none placeholder:text-zinc-600"
            />
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          </div>
          {searchMode && (
            <button onClick={clearSearch} className="rounded bg-zinc-800 p-1.5 text-zinc-400 hover:text-zinc-200">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {searchMode && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-400">
          <Sparkles className="h-3.5 w-3.5" />
          语义搜索结果：「{searchQuery}」— {prompts.length} 条匹配
        </div>
      )}

      {/* Prompt 列表 */}
      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        {loading || searching ? (
          <div className="flex items-center justify-center py-12 text-xs text-zinc-500">
            加载中...
          </div>
        ) : prompts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500 gap-2">
            <Database className="h-8 w-8 text-zinc-600" />
            <p className="text-xs">暂无 Prompt</p>
            <p className="text-[10px] text-zinc-600">点击「种子入库」从 JSON 批量导入</p>
          </div>
        ) : (
          prompts.map(item => (
            <div
              key={item.id}
              className="group rounded-lg bg-zinc-800/40 border border-zinc-700/50 px-4 py-3 hover:border-zinc-600/50 transition-colors"
            >
              {/* 标签行 */}
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="rounded bg-indigo-600/20 px-1.5 py-0.5 text-[10px] text-indigo-400">
                  {CAPABILITY_LABELS[item.capability as PromptCapability] ?? item.capability}
                </span>
                {item.platform !== 'universal' && (
                  <span className="rounded bg-emerald-600/20 px-1.5 py-0.5 text-[10px] text-emerald-400">
                    {PLATFORM_LABELS[item.platform as PromptPlatform] ?? item.platform}
                  </span>
                )}
                {item.input_type !== 'universal' && (
                  <span className="rounded bg-amber-600/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                    {INPUT_TYPE_LABELS[item.input_type as PromptInputType] ?? item.input_type}
                  </span>
                )}
                <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  {SOURCE_LABELS[item.source] ?? item.source}
                </span>
                {item.similarity != null && (
                  <span className="rounded bg-purple-600/20 px-1.5 py-0.5 text-[10px] text-purple-400">
                    匹配 {(item.similarity * 100).toFixed(0)}%
                  </span>
                )}
                <span className="text-[10px] text-zinc-600 ml-auto">
                  Q: {(item.quality_score * 100).toFixed(0)}%
                </span>
              </div>

              {/* Prompt 文本 */}
              <p className="text-xs text-zinc-300 leading-relaxed line-clamp-3 mb-1">
                {item.prompt}
              </p>

              {/* Negative (如有) */}
              {item.negative_prompt && (
                <p className="text-[10px] text-zinc-500 line-clamp-1 mt-1">
                  <span className="text-red-400/60">neg:</span> {item.negative_prompt.slice(0, 80)}...
                </p>
              )}

              {/* 操作 */}
              <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleCopy(item.prompt, item.id)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200"
                >
                  {copiedId === item.id ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                  {copiedId === item.id ? '已复制' : '复制'}
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-red-900/30 hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 添加弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[520px] rounded-xl bg-zinc-900 border border-zinc-700 p-6 shadow-2xl">
            <h3 className="text-sm font-medium text-zinc-200 mb-4">添加 Prompt</h3>

            <div className="space-y-3">
              {/* 三维选择 */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block">能力</label>
                  <select
                    value={addForm.capability}
                    onChange={e => setAddForm(f => ({ ...f, capability: e.target.value }))}
                    className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 border border-zinc-700"
                  >
                    {Object.entries(CAPABILITY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block">平台</label>
                  <select
                    value={addForm.platform}
                    onChange={e => setAddForm(f => ({ ...f, platform: e.target.value }))}
                    className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 border border-zinc-700"
                  >
                    {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block">输入类型</label>
                  <select
                    value={addForm.input_type}
                    onChange={e => setAddForm(f => ({ ...f, input_type: e.target.value }))}
                    className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 border border-zinc-700"
                  >
                    {Object.entries(INPUT_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 中文标签 */}
              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">中文标签（可选）</label>
                <input
                  type="text"
                  value={addForm.label}
                  onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="如：法式慵懒金色夕阳"
                  className="w-full rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 border border-zinc-700 placeholder:text-zinc-600"
                />
              </div>

              {/* Prompt */}
              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">Prompt</label>
                <textarea
                  value={addForm.prompt}
                  onChange={e => setAddForm(f => ({ ...f, prompt: e.target.value }))}
                  placeholder="English prompt for AI model..."
                  rows={4}
                  className="w-full rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-300 border border-zinc-700 resize-none placeholder:text-zinc-600"
                />
              </div>

              {/* Negative Prompt */}
              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">Negative Prompt</label>
                <textarea
                  value={addForm.negative_prompt}
                  onChange={e => setAddForm(f => ({ ...f, negative_prompt: e.target.value }))}
                  placeholder="What to avoid..."
                  rows={2}
                  className="w-full rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-300 border border-zinc-700 resize-none placeholder:text-zinc-600"
                />
              </div>
            </div>

            {/* 按钮 */}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-md bg-zinc-800 px-4 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700"
              >
                取消
              </button>
              <button
                onClick={handleAdd}
                disabled={adding || !addForm.prompt.trim()}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {adding ? '添加中...' : '添加并入库'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
