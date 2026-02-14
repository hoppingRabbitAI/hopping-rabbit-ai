'use client';

import React from 'react';

// ── 预设选项 ──────────────────────────────────────
const LIGHT_TYPES: { value: string; label: string; emoji: string }[] = [
  { value: 'natural', label: '自然光', emoji: '☀️' },
  { value: 'studio', label: '影棚光', emoji: '💡' },
  { value: 'golden_hour', label: '黄金时刻', emoji: '🌅' },
  { value: 'dramatic', label: '戏剧光', emoji: '🎭' },
  { value: 'neon', label: '霓虹灯', emoji: '🌈' },
  { value: 'soft', label: '柔光', emoji: '🕯️' },
];

const DIRECTIONS: { value: string; label: string }[] = [
  { value: 'front', label: '正面' },
  { value: 'left', label: '左侧' },
  { value: 'right', label: '右侧' },
  { value: 'back', label: '背光' },
  { value: 'top', label: '顶光' },
  { value: 'bottom', label: '底光' },
];

interface RelightControlsProps {
  lightType: string;
  lightDirection: string;
  lightColor: string;
  lightIntensity: number;
  onLightTypeChange: (v: string) => void;
  onLightDirectionChange: (v: string) => void;
  onLightColorChange: (v: string) => void;
  onLightIntensityChange: (v: number) => void;
}

/**
 * AI 打光参数面板
 * PRD §2.2.4 — 灯光类型 / 方向 / 色温 / 强度
 * V2 才做 3D RelightSphere，V1 用下拉 + 滑条
 */
export default function RelightControls({
  lightType,
  lightDirection,
  lightColor,
  lightIntensity,
  onLightTypeChange,
  onLightDirectionChange,
  onLightColorChange,
  onLightIntensityChange,
}: RelightControlsProps) {
  return (
    <div className="space-y-4">
      {/* ── 灯光类型 ── */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">灯光类型</div>
        <div className="grid grid-cols-3 gap-1.5">
          {LIGHT_TYPES.map((lt) => (
            <button
              key={lt.value}
              onClick={() => onLightTypeChange(lt.value)}
              className={`
                flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs transition-all
                ${lightType === lt.value
                  ? 'border-gray-900 bg-gray-50 text-gray-800 ring-1 ring-gray-200'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }
              `}
            >
              <span>{lt.emoji}</span>
              <span className="font-medium">{lt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 灯光方向 ── */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">灯光方向</div>
        <div className="grid grid-cols-3 gap-1.5">
          {DIRECTIONS.map((d) => (
            <button
              key={d.value}
              onClick={() => onLightDirectionChange(d.value)}
              className={`
                rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all
                ${lightDirection === d.value
                  ? 'border-gray-900 bg-gray-50 text-gray-800 ring-1 ring-gray-200'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }
              `}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 灯光强度 ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">强度</span>
          <span className="text-xs text-gray-400 tabular-nums">{Math.round(lightIntensity * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={lightIntensity}
          onChange={(e) => onLightIntensityChange(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-500"
        />
      </div>

      {/* ── 灯光颜色 ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">灯光颜色</span>
          <span className="text-xs text-gray-400">{lightColor || '默认'}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={lightColor || '#FFFFFF'}
            onChange={(e) => onLightColorChange(e.target.value)}
            className="w-8 h-8 rounded-md border border-gray-200 cursor-pointer"
          />
          {lightColor && (
            <button
              onClick={() => onLightColorChange('')}
              className="text-[11px] text-gray-400 hover:text-gray-600 underline"
            >
              重置
            </button>
          )}
        </div>
      </div>

      {/* ── 说明 ── */}
      <p className="text-[11px] text-gray-400 leading-relaxed">
        AI 将模拟选定的灯光环境对人像重新布光。V2 将支持 3D 球体控件进行精确调光。
      </p>
    </div>
  );
}
