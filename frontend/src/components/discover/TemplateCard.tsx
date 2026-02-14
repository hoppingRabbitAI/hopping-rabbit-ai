'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Flame, Users, Play, Sparkles, Layers } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CapLabel } from '@/components/ui/CapLabel';
import type { TrendTemplate } from '@/types/discover';
import { CATEGORY_META, CAPABILITY_LABELS } from '@/types/discover';

/* ================================================================
   TemplateCard — PRD §3.2 模板卡片
   
   视频预览(自动播放) + 使用计数 + hover双按钮
   [✦ 用我的脸]  +  [◇ 在画布中打开]
   ================================================================ */

interface TemplateCardProps {
  template: TrendTemplate;
  onUse: (template: TrendTemplate) => void;
  onOpenCanvas: (template: TrendTemplate) => void;
}

export function TemplateCard({ template, onUse, onOpenCanvas }: TemplateCardProps) {
  const router = useRouter();
  const meta = CATEGORY_META[template.category];
  const formattedCount = template.usage_count >= 10000
    ? `${(template.usage_count / 10000).toFixed(1)}w`
    : template.usage_count >= 1000
      ? `${(template.usage_count / 1000).toFixed(1)}k`
      : String(template.usage_count);

  const totalCredits = template.route.reduce((sum, s) => sum + (s.estimated_credits ?? 0), 0);

  return (
    <motion.div
      whileHover={{ y: -3, transition: { duration: 0.3 } }}
      onClick={() => router.push(`/template/${template.id}`)}
      className={cn(
        'group relative flex flex-col rounded-2xl overflow-hidden cursor-pointer',
        'bg-white border border-hr-border-dim',
        'shadow-card hover:shadow-card-hover hover:border-hr-border',
        'transition-all duration-300',
      )}
    >
      {/* Cover — video or image */}
      <div className="relative aspect-[4/5] bg-surface-muted overflow-hidden">
        {template.preview_video_url ? (
          <video
            src={template.preview_video_url}
            muted
            loop
            playsInline
            autoPlay
            className="w-full h-full object-cover"
            poster={template.thumbnail_url}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-surface-overlay to-surface-muted">
            <span className="absolute inset-0 flex items-center justify-center text-5xl opacity-20">
              {meta.emoji}
            </span>
          </div>
        )}

        {/* Category badge (Cap 字体) */}
        <div className="absolute top-3 left-3">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
              'text-[10px] font-medium uppercase tracking-wider',
              meta.color
            )}
          >
            {meta.emoji} {meta.label}
          </span>
        </div>

        {/* Trending badge */}
        {template.usage_count >= 30000 && (
          <div className="absolute top-3 right-3">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-600">
              <Flame className="w-3 h-3" />
              热门
            </span>
          </div>
        )}

        {/* Hover overlay — 双按钮从底部滑入 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onUse(template); }}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl',
              'bg-accent-core text-white text-sm font-medium',
              'hover:bg-accent-hover transition-colors shadow-accent-glow'
            )}
          >
            <Sparkles className="w-4 h-4" />
            用我的脸
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenCanvas(template); }}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2 rounded-xl',
              'bg-white/15 backdrop-blur-sm text-white text-[13px] font-medium',
              'hover:bg-white/25 transition-colors border border-white/20'
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            在画布中打开
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-hr-text-primary line-clamp-1">
          {template.name}
        </h3>
        <div className="flex items-center justify-between">
          {/* Route steps summary */}
          <div className="flex items-center gap-1 overflow-hidden">
            {template.route.slice(0, 3).map((step, i) => (
              <span
                key={`${step.capability}-${i}`}
                className="text-[10px] px-1.5 py-0 rounded bg-surface-raised text-hr-text-secondary border border-hr-border-dim"
              >
                {CAPABILITY_LABELS[step.capability]}
              </span>
            ))}
            {template.route.length > 3 && (
              <span className="text-[10px] text-hr-text-tertiary">+{template.route.length - 3}</span>
            )}
          </div>
          {/* Use count (JetBrains Mono) */}
          <span className="flex items-center gap-1 text-[11px] text-hr-text-tertiary font-mono shrink-0">
            <Users className="w-3 h-3" />
            {formattedCount}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
