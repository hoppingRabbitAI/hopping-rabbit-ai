'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Input, Slider, Select } from '@/components/ui';
import { CapLabel } from '@/components/ui/CapLabel';
import { CAPABILITY_LABELS, CAPABILITY_ICONS } from '@/types/discover';
import type { CapabilityType, EditableParam } from '@/types/discover';
import { delosTransition } from '@/lib/motion';

/* ================================================================
   ParamEditor — PRD §8.3
   
   画布右侧滑入面板（300px）
   选中 ProcessorNode 时展开，显示可编辑参数 + AI Insight
   
   参考: Stability.ai Dream Studio 参数面板
   ================================================================ */

interface ParamEditorProps {
  /** 是否展开 */
  isOpen: boolean;
  /** 能力类型 */
  capability?: CapabilityType;
  /** 可编辑参数列表 */
  params: EditableParam[];
  /** Prompt 文本 */
  prompt?: string;
  /** AI 建议原因 */
  aiReason?: string;

  onClose: () => void;
  onParamChange: (key: string, value: unknown) => void;
  onPromptChange: (prompt: string) => void;
  onApply: () => void;
}

export function ParamEditor({
  isOpen,
  capability,
  params,
  prompt = '',
  aiReason,
  onClose,
  onParamChange,
  onPromptChange,
  onApply,
}: ParamEditorProps) {
  const capLabel = capability ? CAPABILITY_LABELS[capability] : '';
  const capIcon = capability ? CAPABILITY_ICONS[capability] : '◇';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 300, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={delosTransition.panel}
          className={cn(
            'h-full flex-shrink-0 overflow-hidden',
            'bg-white/80 backdrop-blur-xl border-l border-hr-border-dim',
          )}
        >
          <div className="w-[300px] h-full overflow-y-auto delos-scrollbar">
            <div className="p-5 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{capIcon}</span>
                    <h3 className="text-[15px] font-semibold text-hr-text-primary">{capLabel}</h3>
                  </div>
                  <CapLabel as="div" className="mt-0.5">
                    {capability?.replace('_', ' ').toUpperCase()}
                  </CapLabel>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-surface-hover text-hr-text-tertiary hover:text-hr-text-secondary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Dynamic Params */}
              {params.map((param, i) => (
                <motion.div
                  key={param.key}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, ...delosTransition.enter }}
                >
                  <CapLabel as="div" className="mb-2">{param.label.toUpperCase()}</CapLabel>

                  {param.type === 'select' && param.options && (
                    <Select
                      value={String(param.value)}
                      onChange={(v) => onParamChange(param.key, v)}
                      options={param.options.map((o) => ({
                        value: String(o.value),
                        label: o.label,
                      }))}
                    />
                  )}

                  {param.type === 'slider' && (
                    <Slider
                      value={Number(param.value)}
                      onChange={(v) => onParamChange(param.key, v)}
                      min={param.min ?? 0}
                      max={param.max ?? 1}
                      step={param.step ?? 0.1}
                      label=""
                    />
                  )}

                  {param.type === 'text' && (
                    <Input
                      value={String(param.value)}
                      onChange={(e) => onParamChange(param.key, e.target.value)}
                      placeholder={param.label}
                    />
                  )}

                  {param.type === 'color' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={String(param.value)}
                        onChange={(e) => onParamChange(param.key, e.target.value)}
                        className="w-10 h-10 rounded-lg border border-hr-border-dim cursor-pointer"
                      />
                      <span className="text-[11px] font-mono text-hr-text-secondary">
                        {String(param.value)}
                      </span>
                    </div>
                  )}

                  {param.type === 'image' && (
                    <div className="aspect-[4/3] rounded-xl border border-dashed border-hr-border flex items-center justify-center bg-surface-raised/30 cursor-pointer hover:border-hr-border-strong transition-colors">
                      <span className="text-xs text-hr-text-tertiary">点击选择参考图</span>
                    </div>
                  )}
                </motion.div>
              ))}

              {/* Prompt */}
              <div>
                <CapLabel as="div" className="mb-2">PROMPT</CapLabel>
                <textarea
                  value={prompt}
                  onChange={(e) => onPromptChange(e.target.value)}
                  rows={3}
                  className={cn(
                    'w-full rounded-xl px-3 py-2.5 text-sm resize-none',
                    'bg-surface-raised border border-hr-border-dim',
                    'focus:border-accent-core focus:ring-1 focus:ring-accent-soft',
                    'placeholder:text-hr-text-tertiary text-hr-text-primary',
                    'outline-none transition-all'
                  )}
                />
              </div>

              {/* Divider */}
              <div className="border-t border-hr-border-dim" />

              {/* AI Insight */}
              {aiReason && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="px-3 py-2.5 rounded-xl bg-accent-soft/50 border border-accent-core/10"
                >
                  <CapLabel as="div" className="text-accent-core mb-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    AI INSIGHT
                  </CapLabel>
                  <p className="text-[12px] text-hr-text-secondary italic leading-relaxed">{aiReason}</p>
                </motion.div>
              )}

              {/* Apply Button */}
              <Button variant="primary" className="w-full" onClick={onApply}>
                <Sparkles className="w-4 h-4" />
                APPLY
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
