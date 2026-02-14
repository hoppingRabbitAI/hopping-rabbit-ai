'use client';

import React from 'react';

// ── 预设选项 ──────────────────────────────────────
const CONTENT_TYPES: { value: string; label: string; desc: string; emoji: string }[] = [
  { value: 'cover', label: '封面图', desc: '大字标题构图', emoji: '🖼️' },
  { value: 'streetsnap', label: '街拍', desc: '城市背景、自然姿态', emoji: '📸' },
  { value: 'lifestyle', label: 'Lifestyle', desc: '咖啡厅、家居、旅行', emoji: '🌿' },
  { value: 'flat_lay', label: '平铺摆拍', desc: '仰视角度、多单品', emoji: '🧲' },
  { value: 'comparison', label: '对比图', desc: '换装前后并排', emoji: '↔️' },
];

const PLATFORMS: { value: string; label: string; ratio: string }[] = [
  { value: 'xiaohongshu', label: '小红书', ratio: '3:4' },
  { value: 'douyin', label: '抖音', ratio: '9:16' },
  { value: 'instagram', label: 'Instagram', ratio: '1:1' },
  { value: 'custom', label: '自定义', ratio: '' },
];

interface OutfitShotControlsProps {
  mode: 'content' | 'try_on';
  contentType: string;
  platformPreset: string;
  gender: string;
  variantCount: number;
  onModeChange: (v: 'content' | 'try_on') => void;
  onContentTypeChange: (v: string) => void;
  onPlatformPresetChange: (v: string) => void;
  onGenderChange: (v: string) => void;
  onVariantCountChange: (v: number) => void;
}

/**
 * AI 穿搭内容生成参数面板
 * PRD §2.5.4 — 双 Tab（📸 内容素材 / 🪞 虚拟试穿）+ 内容类型 + 平台 + 变体数
 */
export default function OutfitShotControls({
  mode,
  contentType,
  platformPreset,
  gender,
  variantCount,
  onModeChange,
  onContentTypeChange,
  onPlatformPresetChange,
  onGenderChange,
  onVariantCountChange,
}: OutfitShotControlsProps) {
  return (
    <div className="space-y-4">
      {/* ── 模式切换 Tab ── */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        <button
          onClick={() => onModeChange('content')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all ${
            mode === 'content'
              ? 'bg-gray-800 text-white'
              : 'bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >
          📸 内容素材
        </button>
        <button
          onClick={() => onModeChange('try_on')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all ${
            mode === 'try_on'
              ? 'bg-gray-800 text-white'
              : 'bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >
          🪞 虚拟试穿
        </button>
      </div>

      {mode === 'content' ? (
        <>
          {/* ── 内容类型 ── */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">内容类型</div>
            <div className="space-y-1.5">
              {CONTENT_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  onClick={() => onContentTypeChange(ct.value)}
                  className={`
                    w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all
                    ${contentType === ct.value
                      ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-200'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                    }
                  `}
                >
                  <span className="text-base">{ct.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <span className={`text-xs font-medium ${contentType === ct.value ? 'text-gray-800' : 'text-gray-600'}`}>
                      {ct.label}
                    </span>
                    <span className={`ml-1.5 text-[10px] ${contentType === ct.value ? 'text-gray-400' : 'text-gray-400'}`}>
                      {ct.desc}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── 发布平台 ── */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">发布平台（自动适配比例）</div>
            <div className="grid grid-cols-4 gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => onPlatformPresetChange(p.value)}
                  className={`
                    flex flex-col items-center gap-0.5 rounded-md border px-2 py-2 text-xs transition-all
                    ${platformPreset === p.value
                      ? 'border-gray-900 bg-gray-50 text-gray-800 ring-1 ring-gray-200'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                    }
                  `}
                >
                  <span className="font-medium">{p.label}</span>
                  {p.ratio && <span className="text-[10px] text-gray-400">{p.ratio}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* ── 模特性别 ── */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">模特</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'female', label: '女性', emoji: '👩' },
                { value: 'male', label: '男性', emoji: '👨' },
              ].map((g) => (
                <button
                  key={g.value}
                  onClick={() => onGenderChange(gender === g.value ? '' : g.value)}
                  className={`
                    flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all
                    ${gender === g.value
                      ? 'border-gray-900 bg-gray-50 text-gray-800 ring-1 ring-gray-200'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                    }
                  `}
                >
                  <span>{g.emoji}</span>
                  <span className="font-medium">{g.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── 变体数量 ── */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">生成变体</div>
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => onVariantCountChange(n)}
                  className={`
                    rounded-md border py-1.5 text-xs font-medium transition-all
                    ${variantCount === n
                      ? 'border-gray-900 bg-gray-50 text-gray-800 ring-1 ring-gray-200'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                    }
                  `}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* ── 虚拟试穿模式（V1.5 占位） ── */
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-center space-y-2">
          <p className="text-sm text-gray-700 font-medium">🪞 虚拟试穿模式</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            此模式依赖「数字人资产体系」，将在 V1.5 版本上线。<br />
            当前请使用「📸 内容素材」模式生成穿搭内容图。
          </p>
          <button
            onClick={() => onModeChange('content')}
            className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            切换到内容素材模式
          </button>
        </div>
      )}

      {/* ── 说明 ── */}
      <p className="text-[11px] text-gray-400 leading-relaxed">
        上传 1-3 张衣物图片。AI 将生成可直接发布到社交平台的穿搭内容图。
        {variantCount > 1 && ` 将生成 ${variantCount} 个不同角度/构图的变体。`}
      </p>
    </div>
  );
}
