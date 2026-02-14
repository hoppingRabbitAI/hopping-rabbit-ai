'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Type, Layers, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, GlassPanel } from '@/components/ui';
import { CapLabel } from '@/components/ui/CapLabel';
import { PhotoUploader } from '@/components/common/PhotoUploader';
import { CAPABILITY_LABELS, CAPABILITY_ICONS } from '@/types/discover';
import type { CapabilityType } from '@/types/discover';
import { delosVariants, delosTransition } from '@/lib/motion';

/* ================================================================
   IntentPanel — PRD §3.3.1 + §8.2
   
   画布左侧面板（260px）
   · 我的照片上传
   · 参考图上传 / 文字描述
   · AI 分析状态
   · 可用能力列表
   ================================================================ */

interface IntentPanelProps {
  /** 用户照片 URL */
  userPhotoUrl?: string | null;
  /** 参考图 URL */
  referenceUrl?: string | null;
  /** 文字描述 */
  referenceText?: string;
  /** 是否正在分析 */
  isAnalyzing?: boolean;
  /** 分析结果描述 */
  analysisDescription?: string;
  /** 当前输入模式 */
  inputMode?: 'image' | 'text';

  onUserPhotoSelect: (file: File) => void;
  onUserPhotoClear: () => void;
  onReferenceSelect: (file: File) => void;
  onReferenceClear: () => void;
  onReferenceTextChange: (text: string) => void;
  onInputModeChange: (mode: 'image' | 'text') => void;
  onTextSubmit?: () => void;
  onAddCapability?: (type: CapabilityType) => void;
}

const ALL_CAPABILITIES: CapabilityType[] = [
  'hair_color', 'outfit', 'background', 'lighting',
  'style_transfer', 'action_transfer', 'angle', 'enhance', 'image_to_video',
];

export function IntentPanel({
  userPhotoUrl,
  referenceUrl,
  referenceText = '',
  isAnalyzing = false,
  analysisDescription,
  inputMode = 'image',
  onUserPhotoSelect,
  onUserPhotoClear,
  onReferenceSelect,
  onReferenceClear,
  onReferenceTextChange,
  onInputModeChange,
  onTextSubmit,
  onAddCapability,
}: IntentPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={delosTransition.panel}
      className={cn(
        'w-[260px] h-full flex-shrink-0 overflow-y-auto',
        'bg-white/80 backdrop-blur-xl border-r border-hr-border-dim',
        'delos-scrollbar'
      )}
    >
      <div className="p-4 space-y-5">
        {/* ---- 我的照片 ---- */}
        <section>
          <CapLabel as="div" className="mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-core" />
            MY PHOTO
          </CapLabel>
          <PhotoUploader
            onFileSelect={onUserPhotoSelect}
            previewUrl={userPhotoUrl}
            onClear={onUserPhotoClear}
            label="我的照片"
            sublabel="上传一张你自己的照片"
            aspectRatio="aspect-square"
            requireFace
          />
        </section>

        {/* ---- 分隔线 ---- */}
        <div className="border-t border-hr-border-dim" />

        {/* ---- 参考输入 ---- */}
        <section>
          <CapLabel as="div" className="mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-hr-text-tertiary" />
            REFERENCE
          </CapLabel>

          {/* 输入模式切换 */}
          <div className="flex items-center gap-1 mb-3 p-0.5 rounded-lg bg-surface-raised">
            <button
              onClick={() => onInputModeChange('image')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all',
                inputMode === 'image'
                  ? 'bg-white text-hr-text-primary shadow-sm'
                  : 'text-hr-text-tertiary hover:text-hr-text-secondary'
              )}
            >
              <ImageIcon className="w-3 h-3" />
              参考图
            </button>
            <button
              onClick={() => onInputModeChange('text')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all',
                inputMode === 'text'
                  ? 'bg-white text-hr-text-primary shadow-sm'
                  : 'text-hr-text-tertiary hover:text-hr-text-secondary'
              )}
            >
              <Type className="w-3 h-3" />
              文字描述
            </button>
          </div>

          <AnimatePresence mode="wait">
            {inputMode === 'image' ? (
              <motion.div key="image" {...delosVariants.fadeIn}>
                <PhotoUploader
                  onFileSelect={onReferenceSelect}
                  previewUrl={referenceUrl}
                  onClear={onReferenceClear}
                  label="参考图"
                  sublabel="想变成什么样？放一张参考"
                  aspectRatio="aspect-square"
                />
              </motion.div>
            ) : (
              <motion.div key="text" {...delosVariants.fadeIn} className="space-y-2">
                <textarea
                  value={referenceText}
                  onChange={(e) => onReferenceTextChange(e.target.value)}
                  placeholder="描述你想要的效果…&#10;例如：日系杂志感、冷棕色头发、电影光影"
                  rows={4}
                  className={cn(
                    'w-full rounded-xl px-3 py-2.5 text-sm resize-none',
                    'bg-surface-raised border border-hr-border-dim',
                    'focus:border-accent-core focus:ring-1 focus:ring-accent-soft',
                    'placeholder:text-hr-text-tertiary text-hr-text-primary',
                    'outline-none transition-all'
                  )}
                />
                {onTextSubmit && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onTextSubmit}
                    disabled={!referenceText.trim()}
                    className="w-full"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    分析描述
                  </Button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* ---- AI 分析状态 ---- */}
        <AnimatePresence>
          {isAnalyzing && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-accent-soft border border-accent-core/20">
                <Sparkles className="w-4 h-4 text-accent-core animate-breathe" />
                <span className="text-[12px] text-accent-core font-medium">AI 正在分析差异…</span>
              </div>
            </motion.div>
          )}
          {analysisDescription && !isAnalyzing && (
            <motion.div {...delosVariants.fadeUp}>
              <div className="px-3 py-2.5 rounded-xl bg-accent-soft/50 border border-accent-core/10">
                <CapLabel as="div" className="text-accent-core mb-1">AI ANALYSIS</CapLabel>
                <p className="text-[12px] text-hr-text-secondary">{analysisDescription}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---- 分隔线 ---- */}
        <div className="border-t border-hr-border-dim" />

        {/* ---- 能力列表 ---- */}
        <section>
          <CapLabel as="div" className="mb-2">CAPABILITIES</CapLabel>
          <div className="space-y-1">
            {ALL_CAPABILITIES.map((cap) => (
              <button
                key={cap}
                onClick={() => onAddCapability?.(cap)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left',
                  'hover:bg-surface-hover transition-colors group'
                )}
              >
                <span className="text-sm">{CAPABILITY_ICONS[cap]}</span>
                <span className="flex-1 text-[12px] text-hr-text-secondary group-hover:text-hr-text-primary transition-colors">
                  {CAPABILITY_LABELS[cap]}
                </span>
                <Plus className="w-3 h-3 text-hr-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </motion.div>
  );
}
