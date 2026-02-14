'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, Check, AlertCircle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CapLabel } from '@/components/ui/CapLabel';
import { CAPABILITY_LABELS, CAPABILITY_ICONS } from '@/types/discover';
import type { CapabilityType, ProcessorNodeData, EditableParam } from '@/types/discover';
import { Handle, Position, type NodeProps } from '@xyflow/react';

/* ================================================================
   ProcessorNode — PRD §8.3
   
   能力节点（glass-light 卡片、状态条、hover 操作栏、预览缩略图）
   Compatible with ReactFlow nodeTypes registration.
   ================================================================ */

/** Data bag passed through ReactFlow node.data */
interface ProcessorNodeDataBag extends ProcessorNodeData {
  onEdit?: () => void;
  onReplace?: () => void;
  onDelete?: () => void;
  [key: string]: unknown;
}

const STATUS_CONFIG = {
  draft:      { icon: '○', color: 'text-hr-text-tertiary',  label: 'READY' },
  pending:    { icon: '◎', color: 'text-hr-text-secondary', label: 'QUEUED' },
  processing: { icon: null, color: 'text-accent-core',      label: 'PROCESSING' },
  completed:  { icon: null, color: 'text-semantic-success',  label: 'COMPLETE' },
  error:      { icon: null, color: 'text-semantic-error',    label: 'FAILED' },
} as const;

export function ProcessorNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ProcessorNodeDataBag;
  const { onEdit, onReplace, onDelete } = nodeData;
  const capability = nodeData.capability;
  const capLabel = CAPABILITY_LABELS[capability] || capability;
  const capIcon = CAPABILITY_ICONS[capability] || '◇';
  const status = STATUS_CONFIG[nodeData.status];

  // 参数摘要（显示前2个参数键值）
  const paramSummary = Object.entries(nodeData.params)
    .slice(0, 2)
    .map(([k, v]) => `${String(v)}`)
    .join(' · ');

  return (
    <div
      className={cn(
        'relative w-[200px] rounded-2xl overflow-hidden',
        'bg-white/95 backdrop-blur-sm border transition-all duration-300',
        selected
          ? 'border-accent-core shadow-accent-glow'
          : 'border-hr-border-dim shadow-card hover:shadow-card-hover hover:border-hr-border',
      )}
    >
      {/* 输入 Handle */}
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-accent-core !border-2 !border-white" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-raised/50 border-b border-hr-border-dim">
        <span className="text-base">{capIcon}</span>
        <span className="text-[13px] font-medium text-hr-text-primary flex-1 truncate">{capLabel}</span>
        <CapLabel className="text-hr-text-tertiary shrink-0">
          {capability.replace('_', ' ').toUpperCase()}
        </CapLabel>
      </div>

      {/* Preview Thumbnail */}
      <div className="mx-3 mt-3">
        {nodeData.status === 'completed' ? (
          <div className="aspect-[4/3] rounded-xl bg-surface-muted overflow-hidden">
            {/* TODO: 实际预览图 */}
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent-soft to-surface-overlay">
              <Check className="w-6 h-6 text-accent-core" />
            </div>
          </div>
        ) : (
          <div className="aspect-[4/3] rounded-xl border border-dashed border-hr-border flex items-center justify-center bg-surface-raised/30">
            <span className="text-2xl opacity-30">{capIcon}</span>
          </div>
        )}
      </div>

      {/* Param Summary */}
      {paramSummary && (
        <div className="px-3 mt-2">
          <p className="text-[11px] font-mono text-hr-text-secondary truncate">{paramSummary}</p>
        </div>
      )}

      {/* Status Bar */}
      <div className="px-3 py-2 mt-1">
        <div className={cn('flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider', status.color)}>
          {nodeData.status === 'processing' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : nodeData.status === 'completed' ? (
            <Check className="w-3 h-3" />
          ) : nodeData.status === 'error' ? (
            <AlertCircle className="w-3 h-3" />
          ) : (
            <span className="text-[10px]">{status.icon}</span>
          )}
          <span>{status.label}</span>
          {nodeData.status === 'processing' && (
            <div className="flex-1 h-1 bg-surface-muted rounded-full overflow-hidden ml-1">
              <motion.div
                className="h-full bg-accent-core rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: '60%' }}
                transition={{ duration: 2, ease: 'easeInOut' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Hover Actions */}
      <div className="absolute bottom-0 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-center gap-1 px-3 py-2 bg-white/95 border-t border-hr-border-dim">
          {onEdit && (
            <button onClick={onEdit} className="text-[11px] text-hr-text-secondary hover:text-hr-text-primary px-2 py-0.5">
              编辑
            </button>
          )}
          {onReplace && (
            <button onClick={onReplace} className="text-[11px] text-hr-text-secondary hover:text-hr-text-primary px-2 py-0.5">
              替换
            </button>
          )}
          {nodeData.status === 'error' && (
            <button className="text-[11px] text-semantic-error hover:text-red-700 px-2 py-0.5 flex items-center gap-0.5">
              <RotateCcw className="w-3 h-3" />
              重试
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="text-[11px] text-semantic-error hover:text-red-700 px-2 py-0.5">
              删除
            </button>
          )}
        </div>
      </div>

      {/* 输出 Handle */}
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-accent-core !border-2 !border-white" />
    </div>
  );
}
