'use client';

import React from 'react';

// ── 衣物区域选项 ──────────────────────────────────
const GARMENT_TYPES: { value: 'upper' | 'lower' | 'full'; label: string; emoji: string }[] = [
  { value: 'upper', label: '上装', emoji: '👕' },
  { value: 'lower', label: '下装', emoji: '👖' },
  { value: 'full', label: '全身', emoji: '👗' },
];

interface OutfitSwapControlsProps {
  garmentType: 'upper' | 'lower' | 'full';
  onGarmentTypeChange: (v: 'upper' | 'lower' | 'full') => void;
}

/**
 * 换装试穿参数面板
 * PRD §2.3.4 — 衣物区域选择
 *
 * 注意：人像图和衣物图由 GenerationComposerModal 的双输入区处理（Image A / Image B），
 * 此组件仅负责附加参数。
 */
export default function OutfitSwapControls({
  garmentType,
  onGarmentTypeChange,
}: OutfitSwapControlsProps) {
  return (
    <div className="space-y-4">
      {/* ── 衣物区域 ── */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">衣物区域</div>
        <div className="grid grid-cols-3 gap-2">
          {GARMENT_TYPES.map((gt) => (
            <button
              key={gt.value}
              onClick={() => onGarmentTypeChange(gt.value)}
              className={`
                flex flex-col items-center gap-1 rounded-lg border px-3 py-2.5 text-sm transition-all
                ${garmentType === gt.value
                  ? 'border-gray-900 bg-gray-50 text-gray-800 ring-1 ring-gray-200'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }
              `}
            >
              <span className="text-lg">{gt.emoji}</span>
              <span className="font-medium">{gt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 使用说明 ── */}
      <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-1.5">
        <p className="text-xs font-medium text-gray-600">使用方法</p>
        <ul className="text-[11px] text-gray-400 space-y-0.5 leading-relaxed">
          <li>• <strong>图片 A</strong>：人物全身/半身照</li>
          <li>• <strong>图片 B</strong>：目标服装图片</li>
          <li>• AI 会自动识别衣物区域并完成换装合成</li>
        </ul>
      </div>
    </div>
  );
}
