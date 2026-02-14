/**
 * RelationTypePicker — 关联关系类型选择器
 *
 * 当用户在关联模式下连线时，弹出此选择器让用户选择关系类型。
 * 也可用于右键菜单的「添加关联关系」操作。
 */

'use client';

import React, { useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Scissors,
  Sparkles,
  ImagePlus,
  Frame,
  Layers,
  Link,
  Combine,
  Copy,
  ArrowRightLeft,
  Palette,
  Link2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type NodeRelationType, RELATION_TYPE_CONFIGS } from '@/types/visual-editor';

// ==========================================
// Icon 映射
// ==========================================

const ICON_MAP: Record<string, LucideIcon> = {
  Scissors,
  Sparkles,
  ImagePlus,
  Frame,
  Layers,
  Link,
  Combine,
  Copy,
  ArrowRightLeft,
  Palette,
  Link2,
};

// ==========================================
// 类型
// ==========================================

interface RelationTypePickerProps {
  /** 屏幕坐标 */
  position: { x: number; y: number };
  /** 选择回调 */
  onSelect: (relationType: NodeRelationType) => void;
  /** 关闭 */
  onClose: () => void;
}

// ==========================================
// 分组配置
// ==========================================

const RELATION_GROUPS: { label: string; types: NodeRelationType[] }[] = [
  {
    label: '生成关系',
    types: ['ai-generated', 'bg-replace', 'style-transfer', 'transition'],
  },
  {
    label: '提取关系',
    types: ['split', 'extract-frame', 'separation'],
  },
  {
    label: '引用关系',
    types: ['reference', 'duplicate', 'composite', 'custom'],
  },
];

// ==========================================
// 组件
// ==========================================

export function RelationTypePicker({
  position,
  onSelect,
  onClose,
}: RelationTypePickerProps) {
  const handleSelect = useCallback((type: NodeRelationType) => {
    onSelect(type);
    onClose();
  }, [onSelect, onClose]);

  return createPortal(
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-[300]"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />

      {/* 选择器面板 */}
      <div
        className="fixed z-[301] bg-white rounded-xl shadow-2xl border border-gray-200 py-2 w-[240px]
          animate-in fade-in-0 zoom-in-95 duration-150"
        style={{
          top: position.y,
          left: position.x,
          // 防止超出视口
          maxHeight: 'calc(100vh - 40px)',
        }}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-3 pb-2 mb-1 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-500">选择关联类型</span>
          <button
            onClick={onClose}
            className="p-0.5 rounded hover:bg-gray-100 text-gray-400"
          >
            <X size={14} />
          </button>
        </div>

        {/* 分组列表 */}
        {RELATION_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {group.label}
            </div>
            {group.types.map(type => {
              const config = RELATION_TYPE_CONFIGS[type];
              const Icon = ICON_MAP[config.icon] || Link2;
              return (
                <button
                  key={type}
                  onClick={() => handleSelect(type)}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-gray-50 transition-colors group"
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
                    style={{
                      backgroundColor: `${config.color}15`,
                    }}
                  >
                    <Icon size={13} style={{ color: config.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-700 group-hover:text-gray-900">{config.label}</div>
                    <div className="text-[10px] text-gray-400 truncate">{config.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>,
    document.body,
  );
}

export default RelationTypePicker;
