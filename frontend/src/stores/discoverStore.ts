'use client';

import { create } from 'zustand';
import type { TrendTemplate, TemplateCategory } from '@/types/discover';

/* ================================================================
   Discover Store — 发现页状态管理
   
   PRD §3.2: TrendFeed 状态 + 模板缓存 + 筛选
   ================================================================ */

interface DiscoverState {
  /** 模板列表 */
  templates: TrendTemplate[];
  /** 当前选中的分类过滤 */
  selectedCategory: TemplateCategory | 'all';
  /** 搜索关键词 */
  searchQuery: string;
  /** 加载中 */
  isLoading: boolean;
  /** 错误 */
  error: string | null;
  /** 分页游标 */
  cursor: string | null;
  /** 是否有更多 */
  hasMore: boolean;
}

interface DiscoverActions {
  setTemplates: (templates: TrendTemplate[]) => void;
  appendTemplates: (templates: TrendTemplate[]) => void;
  setSelectedCategory: (cat: TemplateCategory | 'all') => void;
  setSearchQuery: (q: string) => void;
  setLoading: (v: boolean) => void;
  setError: (err: string | null) => void;
  setCursor: (cursor: string | null) => void;
  reset: () => void;
}

const initialState: DiscoverState = {
  templates: [],
  selectedCategory: 'all',
  searchQuery: '',
  isLoading: false,
  error: null,
  cursor: null,
  hasMore: true,
};

export const useDiscoverStore = create<DiscoverState & DiscoverActions>((set) => ({
  ...initialState,

  setTemplates: (templates) => set({ templates, cursor: null }),
  appendTemplates: (templates) =>
    set((s) => ({ templates: [...s.templates, ...templates] })),
  setSelectedCategory: (selectedCategory) =>
    set({ selectedCategory, templates: [], cursor: null, hasMore: true }),
  setSearchQuery: (searchQuery) =>
    set({ searchQuery, templates: [], cursor: null, hasMore: true }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setCursor: (cursor) => set({ cursor, hasMore: cursor !== null }),
  reset: () => set(initialState),
}));
