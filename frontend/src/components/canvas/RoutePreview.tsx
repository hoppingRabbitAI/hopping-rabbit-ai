'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Play, Clock, Coins, ChevronRight, Share2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { CapLabel } from '@/components/ui/CapLabel';
import { CAPABILITY_ICONS, CAPABILITY_LABELS } from '@/types/discover';
import type { CapabilityType } from '@/types/discover';
import { delosTransition } from '@/lib/motion';

/* ================================================================
   RoutePreview — PRD §3.3.1 底部栏
   
   画布底部固定栏:
   [▶ GENERATE] · 预计 6 Credits · 约 45s · 链路概览
   ================================================================ */

interface RoutePreviewProps {
  /** 链路步骤（能力类型列表） */
  steps: CapabilityType[];
  /** 总 Credits */
  totalCredits: number;
  /** 预计耗时（秒） */
  estimatedTime: number;
  /** 是否正在生成 */
  isGenerating?: boolean;
  /** 进度百分比 0-100 */
  progress?: number;
  /** 是否有完成结果 */
  hasResult?: boolean;

  onGenerate: () => void;
  onExport?: () => void;
  onShare?: () => void;
}

export function RoutePreview({
  steps,
  totalCredits,
  estimatedTime,
  isGenerating = false,
  progress = 0,
  hasResult = false,
  onGenerate,
  onExport,
  onShare,
}: RoutePreviewProps) {
  const formattedTime = estimatedTime >= 60
    ? `~${Math.ceil(estimatedTime / 60)}min`
    : `~${estimatedTime}s`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={delosTransition.panel}
      className={cn(
        'fixed bottom-0 left-0 right-0 z-40',
        'bg-white/90 backdrop-blur-xl border-t border-hr-border-dim',
        'shadow-topbar'
      )}
    >
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
        {/* Generate Button */}
        <Button
          variant="primary"
          size="lg"
          onClick={onGenerate}
          disabled={steps.length === 0 || isGenerating}
          isLoading={isGenerating}
          className="shrink-0 px-6"
        >
          <Play className="w-4 h-4" />
          {isGenerating ? 'GENERATING...' : 'GENERATE'}
        </Button>

        {/* Progress bar when generating */}
        {isGenerating && (
          <div className="flex-1 max-w-[200px]">
            <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-accent-core rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <p className="text-[10px] text-hr-text-tertiary mt-0.5 font-mono">{progress}%</p>
          </div>
        )}

        {/* Divider */}
        <div className="w-px h-6 bg-hr-border-dim" />

        {/* Credits */}
        <div className="flex items-center gap-1.5 text-hr-text-secondary">
          <Coins className="w-3.5 h-3.5" />
          <span className="text-[12px] font-mono font-medium">{totalCredits}</span>
          <CapLabel>CREDITS</CapLabel>
        </div>

        {/* Time */}
        <div className="flex items-center gap-1.5 text-hr-text-secondary">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-[12px] font-mono font-medium">{formattedTime}</span>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-hr-border-dim" />

        {/* Route steps preview */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto delos-scrollbar">
          {steps.map((step, i) => (
            <React.Fragment key={`${step}-${i}`}>
              <div className="flex items-center gap-1 shrink-0 px-2 py-1 rounded-lg bg-surface-raised border border-hr-border-dim">
                <span className="text-xs">{CAPABILITY_ICONS[step]}</span>
                <span className="text-[10px] font-medium text-hr-text-secondary whitespace-nowrap">
                  {CAPABILITY_LABELS[step]}
                </span>
              </div>
              {i < steps.length - 1 && (
                <ChevronRight className="w-3 h-3 text-hr-text-tertiary shrink-0" />
              )}
            </React.Fragment>
          ))}
          <CapLabel className="ml-2 shrink-0">{steps.length} STEPS</CapLabel>
        </div>

        {/* Export/Share when result available */}
        {hasResult && (
          <>
            <div className="w-px h-6 bg-hr-border-dim" />
            {onExport && (
              <Button variant="secondary" size="sm" onClick={onExport}>
                导出
              </Button>
            )}
            {onShare && (
              <Button variant="secondary" size="sm" onClick={onShare}>
                <Share2 className="w-3.5 h-3.5" />
                分享
              </Button>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
