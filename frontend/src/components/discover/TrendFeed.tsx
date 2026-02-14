'use client';

import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CapLabel } from '@/components/ui/CapLabel';
import { TemplateCard } from './TemplateCard';
import type { TrendTemplate } from '@/types/discover';
import { delosVariants } from '@/lib/motion';

/* ================================================================
   TrendFeed — PRD §3.2 横向滚动行
   
   标题 (CAP Label) + 横向卡片滚动 + 箭头控制
   ================================================================ */

interface TrendFeedProps {
  title: string;
  templates: TrendTemplate[];
  onUse: (t: TrendTemplate) => void;
  onOpenCanvas: (t: TrendTemplate) => void;
  className?: string;
}

export function TrendFeed({ title, templates, onUse, onOpenCanvas, className }: TrendFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = 280;
    scrollRef.current.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  if (templates.length === 0) return null;

  return (
    <motion.div {...delosVariants.fadeUp} className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <CapLabel as="div" className="text-hr-text-secondary">{title}</CapLabel>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scroll('left')}
            className="p-1 rounded-lg hover:bg-surface-hover text-hr-text-tertiary hover:text-hr-text-secondary transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-1 rounded-lg hover:bg-surface-hover text-hr-text-tertiary hover:text-hr-text-secondary transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Horizontal scroll */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto delos-scrollbar pb-2 -mx-1 px-1"
      >
        {templates.map((template) => (
          <div key={template.id} className="w-[200px] shrink-0">
            <TemplateCard template={template} onUse={onUse} onOpenCanvas={onOpenCanvas} />
          </div>
        ))}
      </div>
    </motion.div>
  );
}
