'use client';

import React, { useState } from 'react';

// ── 预设选项 ──────────────────────────────────────
const OCCASIONS: { value: string; label: string; emoji: string }[] = [
  { value: 'daily', label: '日常', emoji: '🏠' },
  { value: 'work', label: '通勤', emoji: '💼' },
  { value: 'date', label: '约会', emoji: '💕' },
  { value: 'travel', label: '旅行', emoji: '✈️' },
  { value: 'party', label: '派对', emoji: '🎉' },
];

const SEASONS: { value: string; label: string; emoji: string }[] = [
  { value: 'spring', label: '春', emoji: '🌸' },
  { value: 'summer', label: '夏', emoji: '☀️' },
  { value: 'autumn', label: '秋', emoji: '🍂' },
  { value: 'winter', label: '冬', emoji: '❄️' },
];

const POPULAR_TAGS = [
  '极简', '韩系', '日系', '街头', '复古',
  'Y2K', '学院风', '法式', '工装', '运动',
];

interface StylistControlsProps {
  styleTags: string[];
  occasion: string;
  season: string;
  gender: string;
  onStyleTagsChange: (tags: string[]) => void;
  onOccasionChange: (v: string) => void;
  onSeasonChange: (v: string) => void;
  onGenderChange: (v: string) => void;
}

/**
 * AI 穿搭师参数面板
 * PRD §2.4.4 — 风格标签 / 场合 / 季节 / 性别
 * V1: 引导上传衣物 + 标签选择（无 Gallery）
 */
export default function StylistControls({
  styleTags,
  occasion,
  season,
  gender,
  onStyleTagsChange,
  onOccasionChange,
  onSeasonChange,
  onGenderChange,
}: StylistControlsProps) {
  const [customTag, setCustomTag] = useState('');

  const toggleTag = (tag: string) => {
    if (styleTags.includes(tag)) {
      onStyleTagsChange(styleTags.filter((t) => t !== tag));
    } else {
      onStyleTagsChange([...styleTags, tag]);
    }
  };

  const addCustomTag = () => {
    const trimmed = customTag.trim();
    if (trimmed && !styleTags.includes(trimmed)) {
      onStyleTagsChange([...styleTags, trimmed]);
      setCustomTag('');
    }
  };

  return (
    <div className="space-y-4">
      {/* ── 性别 ── */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">模特性别</div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'female', label: '女性', emoji: '👩' },
            { value: 'male', label: '男性', emoji: '👨' },
          ].map((g) => (
            <button
              key={g.value}
              onClick={() => onGenderChange(gender === g.value ? '' : g.value)}
              className={`
                flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-all
                ${gender === g.value
                  ? 'border-gray-900 bg-gray-50 text-gray-800 ring-1 ring-gray-200'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }
              `}
            >
              <span>{g.emoji}</span>
              <span className="font-medium">{g.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 场合 ── */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">穿搭场合</div>
        <div className="flex flex-wrap gap-1.5">
          {OCCASIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => onOccasionChange(occasion === o.value ? '' : o.value)}
              className={`
                flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-all
                ${occasion === o.value
                  ? 'border-gray-900 bg-gray-50 text-gray-800'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                }
              `}
            >
              <span>{o.emoji}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 季节 ── */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">季节</div>
        <div className="grid grid-cols-4 gap-1.5">
          {SEASONS.map((s) => (
            <button
              key={s.value}
              onClick={() => onSeasonChange(season === s.value ? '' : s.value)}
              className={`
                flex flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-xs transition-all
                ${season === s.value
                  ? 'border-gray-900 bg-gray-50 text-gray-800'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                }
              `}
            >
              <span>{s.emoji}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 风格标签 ── */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">风格标签</div>
        <div className="flex flex-wrap gap-1.5">
          {POPULAR_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`
                rounded-full border px-2.5 py-1 text-xs transition-all
                ${styleTags.includes(tag)
                  ? 'border-gray-900 bg-gray-50 text-gray-800'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                }
              `}
            >
              {tag}
            </button>
          ))}
        </div>
        {/* 自定义标签输入 */}
        <div className="flex gap-1.5 mt-2">
          <input
            type="text"
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCustomTag()}
            placeholder="自定义标签..."
            className="flex-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 placeholder:text-gray-300 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
          />
          <button
            onClick={addCustomTag}
            disabled={!customTag.trim()}
            className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40"
          >
            添加
          </button>
        </div>
        {/* 已选标签 */}
        {styleTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {styleTags.filter((t) => !POPULAR_TAGS.includes(t)).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-full bg-gray-50 border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600"
              >
                {tag}
                <button onClick={() => toggleTag(tag)} className="ml-0.5 text-gray-400 hover:text-gray-600">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── 说明 ── */}
      <p className="text-[11px] text-gray-400 leading-relaxed">
        上传服装图片作为输入素材。AI 将根据风格标签和场合生成搭配效果图。
      </p>
    </div>
  );
}
