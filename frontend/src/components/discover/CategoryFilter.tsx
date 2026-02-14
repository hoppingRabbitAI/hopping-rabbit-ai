'use client';

import React from 'react';
import { cn } from '@/lib/cn';
import type { TemplateCategory } from '@/types/discover';
import { CATEGORY_META } from '@/types/discover';

/* ================================================================
   CategoryFilter — PRD §3.2 分类过滤标签栏
   
   CAP 字体 chips，横向滚动
   ================================================================ */

interface CategoryFilterProps {
  selected: TemplateCategory | 'all';
  onChange: (cat: TemplateCategory | 'all') => void;
  className?: string;
}

const ALL_CATEGORIES: (TemplateCategory | 'all')[] = [
  'all',
  'hair',
  'outfit',
  'scene',
  'lighting',
  'style',
  'action',
  'mixed',
];

export function CategoryFilter({ selected, onChange, className }: CategoryFilterProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 overflow-x-auto pb-1 delos-scrollbar',
        className
      )}
    >
      {ALL_CATEGORIES.map((cat) => {
        const active = cat === selected;
        const meta = cat === 'all' ? { label: '全部', emoji: '🔥', color: '' } : CATEGORY_META[cat];

        return (
          <button
            key={cat}
            onClick={() => onChange(cat)}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-1.5 rounded-full',
              'text-[10px] font-medium uppercase tracking-[0.12em]',
              'whitespace-nowrap transition-all duration-200 shrink-0',
              active
                ? 'bg-accent-core text-white shadow-accent-glow'
                : 'bg-surface-raised text-hr-text-secondary hover:bg-surface-hover hover:text-hr-text-primary border border-hr-border-dim'
            )}
          >
            <span className="text-[13px]">{meta.emoji}</span>
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
