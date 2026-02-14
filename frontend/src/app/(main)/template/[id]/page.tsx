'use client';

import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Users, Coins, Clock, ChevronRight, Sparkles, Layers, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { CapLabel } from '@/components/ui/CapLabel';
import { MOCK_TEMPLATES } from '@/lib/mock-templates';
import { trendTemplateApi } from '@/lib/api';
import { CATEGORY_META, CAPABILITY_LABELS, CAPABILITY_ICONS } from '@/types/discover';
import type { TrendTemplate } from '@/types/discover';
import { delosVariants } from '@/lib/motion';
import { TemplateUseModal } from '@/components/discover/TemplateUseModal';

/* ================================================================
   Template Detail Page — PRD §3.2
   
   模板详情: 预览 + 完整链路说明 + [用我的脸] / [在画布中打开]
   ================================================================ */

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [template, setTemplate] = useState<TrendTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showUseModal, setShowUseModal] = useState(false);

  useEffect(() => {
    if (!id) return;
    setIsLoading(true);

    trendTemplateApi.getTemplate(id)
      .then((res) => {
        if (res.data) {
          setTemplate(res.data as TrendTemplate);
        } else {
          // Fallback to mock
          const mock = MOCK_TEMPLATES.find((t) => t.id === id) ?? null;
          setTemplate(mock);
        }
      })
      .catch(() => {
        // API unavailable — fallback to mock
        const mock = MOCK_TEMPLATES.find((t) => t.id === id) ?? null;
        setTemplate(mock);
      })
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
        <Loader2 className="w-6 h-6 text-accent-core animate-spin" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
        <p className="text-hr-text-tertiary">模板未找到</p>
      </div>
    );
  }

  const meta = CATEGORY_META[template.category];
  const totalCredits = template.route.reduce((sum, s) => sum + (s.estimated_credits ?? 0), 0);
  const formattedCount = template.usage_count >= 10000
    ? `${(template.usage_count / 10000).toFixed(1)}w`
    : String(template.usage_count);

  return (
    <div className="min-h-screen pb-20">
      {/* Back */}
      <div className="max-w-4xl mx-auto px-6 pt-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-hr-text-secondary hover:text-hr-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
      </div>

      <motion.div {...delosVariants.fadeUp} className="max-w-4xl mx-auto px-6 mt-6">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Left: Preview */}
          <div className="md:w-1/2">
            <div className="aspect-[4/5] rounded-2xl bg-surface-muted overflow-hidden border border-hr-border-dim">
              {template.preview_video_url ? (
                <video
                  src={template.preview_video_url}
                  muted loop playsInline autoPlay
                  poster={template.thumbnail_url}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-surface-overlay to-surface-muted flex items-center justify-center">
                  <span className="text-6xl">{meta.emoji}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Info */}
          <div className="md:w-1/2 space-y-5">
            <div>
              <span className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider',
                meta.color
              )}>
                {meta.emoji} {meta.label}
              </span>
              <h1 className="text-2xl font-bold text-hr-text-primary mt-2">{template.name}</h1>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-sm text-hr-text-secondary">
                <Users className="w-4 h-4" />
                {formattedCount} 人使用
              </span>
              <span className="flex items-center gap-1.5 text-sm text-hr-text-secondary">
                <Coins className="w-4 h-4" />
                {totalCredits} Credits
              </span>
              <span className="flex items-center gap-1.5 text-sm text-hr-text-secondary">
                <Clock className="w-4 h-4" />
                ~{template.output_duration}s
              </span>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-1.5">
              {template.tags.map((tag) => (
                <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-surface-raised text-hr-text-secondary border border-hr-border-dim">
                  {tag}
                </span>
              ))}
            </div>

            {/* Route Chain */}
            <div>
              <CapLabel as="div" className="mb-3">PROCESSING ROUTE · {template.route.length} STEPS</CapLabel>
              <div className="space-y-2">
                {template.route.map((step, i) => (
                  <div
                    key={`${step.capability}-${i}`}
                    className="flex items-center gap-3 p-3 rounded-xl bg-surface-raised border border-hr-border-dim"
                  >
                    <span className="w-7 h-7 flex items-center justify-center rounded-full bg-white text-[12px] font-mono font-bold text-hr-text-secondary border border-hr-border-dim">
                      {i + 1}
                    </span>
                    <span className="text-lg">{CAPABILITY_ICONS[step.capability]}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-hr-text-primary">{CAPABILITY_LABELS[step.capability]}</p>
                      {step.reason && (
                        <p className="text-[11px] text-hr-text-tertiary mt-0.5">{step.reason}</p>
                      )}
                    </div>
                    {step.estimated_credits && (
                      <span className="text-[11px] font-mono text-hr-text-tertiary">{step.estimated_credits}cr</span>
                    )}
                    {i < template.route.length - 1 && (
                      <ChevronRight className="w-3.5 h-3.5 text-hr-text-tertiary" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={() => setShowUseModal(true)}
              >
                <Sparkles className="w-4 h-4" />
                用我的脸
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => router.push(`/canvas?template=${template.id}`)}
              >
                <Layers className="w-4 h-4" />
                在画布中打开
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Face Swap Modal */}
      <TemplateUseModal
        template={template}
        isOpen={showUseModal}
        onClose={() => setShowUseModal(false)}
        onConfirm={async (t, _file) => {
          setShowUseModal(false);
          try { await trendTemplateApi.useTemplate(t.id); } catch {}
          router.push(`/canvas?template=${t.id}`);
        }}
      />
    </div>
  );
}
