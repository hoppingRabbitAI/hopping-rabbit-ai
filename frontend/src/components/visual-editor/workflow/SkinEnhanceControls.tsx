'use client';

import React from 'react';

// ── 预设选项 ──────────────────────────────────────
const INTENSITY_OPTIONS: { value: 'natural' | 'moderate' | 'max'; label: string; desc: string }[] = [
  { value: 'natural', label: '自然', desc: '轻微磨皮，保留纹理' },
  { value: 'moderate', label: '适中', desc: '均匀肤色，细化毛孔' },
  { value: 'max', label: '精致', desc: '最大美化，精修级效果' },
];

interface SkinEnhanceControlsProps {
  intensity: 'natural' | 'moderate' | 'max';
  onIntensityChange: (v: 'natural' | 'moderate' | 'max') => void;
}

/**
 * 皮肤美化参数面板
 * PRD §2.1.4 — 三档强度选择（natural / moderate / max）
 */
export default function SkinEnhanceControls({
  intensity,
  onIntensityChange,
}: SkinEnhanceControlsProps) {
  return (
    <div className="space-y-4">
      {/* ── 标题 ── */}
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">美化强度</div>

      {/* ── 三档按钮组 ── */}
      <div className="grid grid-cols-3 gap-2">
        {INTENSITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onIntensityChange(opt.value)}
            className={`
              flex flex-col items-center gap-1 rounded-lg border px-3 py-2.5 text-sm transition-all
              ${intensity === opt.value
                ? 'border-gray-900 bg-gray-50 text-gray-800 ring-1 ring-gray-200'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }
            `}
          >
            <span className="font-medium">{opt.label}</span>
            <span className="text-[10px] text-gray-400 leading-tight">{opt.desc}</span>
          </button>
        ))}
      </div>

      {/* ── 说明 ── */}
      <p className="text-[11px] text-gray-400 leading-relaxed">
        AI 将自动检测人脸区域并进行皮肤优化。建议使用正面清晰人像获得最佳效果。
      </p>
    </div>
  );
}
