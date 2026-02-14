/**
 * PromptNode — Prompt 模板节点
 *
 * 两种变体：
 *   • prompt       — 正向提示词
 *   • negative     — 反向提示词
 *
 * 用途：
 *   1. 右键 → "Prompt" / "Negative Prompt" 在画布上创建
 *   2. 输出 Handle 连线到 ClipNode 的 prompt-in / negative-prompt-in 输入端
 *   3. AI 能力触发时自动读取连线上游的 prompt 文本
 *   4. 任何 AI 弹窗里的 "提炼为模板" 按钮可直接创建本节点
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Sparkles, ShieldOff, Copy, Trash2 } from 'lucide-react';

// ============================================
// 类型
// ============================================

export type PromptVariant = 'prompt' | 'negative';

export interface PromptNodeData extends Record<string, unknown> {
  variant: PromptVariant;
  /** 初始文本（创建时注入） */
  initialText?: string;
  /** 文本变更回调 — 持久化到 store */
  onTextChange?: (nodeId: string, text: string) => void;
  /** 删除节点 */
  onRemove?: (nodeId: string) => void;
}

// ============================================
// 配色方案
// ============================================

const THEME = {
  prompt: {
    label: 'Prompt',
    icon: Sparkles,
    accent: '#374151',       // gray-700
    accentDim: '#6b7280',    // gray-500
    handleColor: '#9ca3af',  // gray-400
    borderColor: '#e5e7eb',  // gray-200
    bgHeader: '#f9fafb',     // gray-50
    focusRing: 'rgba(107, 114, 128, 0.3)',
  },
  negative: {
    label: 'Negative Prompt',
    icon: ShieldOff,
    accent: '#374151',       // gray-700
    accentDim: '#6b7280',    // gray-500
    handleColor: '#d1d5db',  // gray-300
    borderColor: '#e5e7eb',  // gray-200
    bgHeader: '#f9fafb',     // gray-50
    focusRing: 'rgba(107, 114, 128, 0.3)',
  },
} as const;

// ============================================
// 组件
// ============================================

export function PromptNode({ id, data, selected }: NodeProps) {
  const nodeData = data as PromptNodeData;
  const variant = nodeData.variant || 'prompt';
  const theme = THEME[variant];
  const Icon = theme.icon;

  const [text, setText] = useState(nodeData.initialText || '');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // 自动调整 textarea 高度
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(80, Math.min(ta.scrollHeight, 240))}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  // 同步初始文本
  useEffect(() => {
    if (nodeData.initialText && nodeData.initialText !== text) {
      setText(nodeData.initialText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData.initialText]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    // 防抖持久化
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      nodeData.onTextChange?.(id, val);
    }, 300);
  }, [id, nodeData]);

  const handleCopy = useCallback(() => {
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }, [text]);

  const handleRemove = useCallback(() => {
    nodeData.onRemove?.(id);
  }, [id, nodeData]);

  // 输出 handle ID：供下游 ClipNode 识别
  const handleId = variant === 'prompt' ? 'prompt-out' : 'negative-prompt-out';

  return (
    <div className="relative group">
      {/* 输出 Handle — 右侧 */}
      <Handle
        type="source"
        position={Position.Right}
        id={handleId}
        style={{
          width: 12,
          height: 12,
          background: theme.handleColor,
          border: '2px solid #d1d5db',
          right: -6,
        }}
      />

      {/* 节点主体 */}
      <div
        style={{
          width: 260,
          borderRadius: 12,
          border: `1.5px solid ${selected ? theme.accent : theme.borderColor}`,
          background: '#ffffff',
          boxShadow: selected
            ? `0 0 0 2px ${theme.focusRing}, 0 4px 12px rgba(0,0,0,0.08)`
            : '0 1px 4px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)',
          overflow: 'hidden',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: theme.bgHeader,
            borderBottom: `1px solid ${theme.borderColor}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon size={14} style={{ color: theme.accent }} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: theme.accent,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
              }}
            >
              {theme.label}
            </span>
          </div>

          {/* 工具按钮 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              onClick={handleCopy}
              title="复制文本"
              style={{
                padding: 4,
                borderRadius: 4,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: '#9ca3af',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#374151')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
            >
              <Copy size={12} />
            </button>
            <button
              onClick={handleRemove}
              title="删除节点"
              style={{
                padding: 4,
                borderRadius: 4,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: '#9ca3af',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* 文本区域 */}
        <div style={{ padding: '8px 10px 10px' }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={variant === 'prompt'
              ? '输入提示词...\ne.g. a person walking in sunset'
              : '输入排除关键词...\ne.g. blurry, low quality, watermark'}
            rows={3}
            className="nodrag nowheel"  // 阻止拖拽节点、滚轮缩放
            style={{
              width: '100%',
              minHeight: 80,
              maxHeight: 240,
              padding: '8px 10px',
              fontSize: 13,
              lineHeight: '1.5',
              color: '#1f2937',
              background: '#f9fafb',
              border: `1px solid ${isFocused ? theme.accent : '#e5e7eb'}`,
              borderRadius: 8,
              outline: 'none',
              resize: 'none',
              fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
              transition: 'border-color 0.15s',
            }}
          />

          {/* 字符数 */}
          <div
            style={{
              marginTop: 4,
              display: 'flex',
              justifyContent: 'flex-end',
              fontSize: 10,
              color: '#9ca3af',
            }}
          >
            {text.length > 0 && `${text.length} 字`}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PromptNode;
