'use client';

import { useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '../store/editor-store';
import { X, RotateCcw } from 'lucide-react';

interface ImageAdjustments {
  // 色彩
  temperature: number;      // 色温 -100~100
  tint: number;            // 色调 -100~100
  saturation: number;      // 饱和度 -100~100
  
  // 明度
  brightness: number;      // 亮度 -100~100
  contrast: number;        // 对比度 -100~100
  
  // 效果
  sharpness: number;       // 锐化 0~100
}

const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  temperature: 0,
  tint: 0,
  saturation: 0,
  brightness: 0,
  contrast: 0,
  sharpness: 0,
};

interface ImageAdjustPanelProps {
  onClose: () => void;
}

export function ImageAdjustPanel({ onClose }: ImageAdjustPanelProps) {
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const updateClip = useEditorStore((s) => s.updateClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const currentTime = useEditorStore((s) => s.currentTime);

  // 获取选中的图片或视频 clip
  const selectedClip = useMemo(() => {
    if (selectedClipId) {
      const clip = clips.find(c => c.id === selectedClipId);
      if (clip?.clipType === 'image' || clip?.clipType === 'video') return clip;
    }
    
    // 如果没有选中，找播放头位置的图片或视频 clip
    const adjustableClips = clips.filter(c => c.clipType === 'image' || c.clipType === 'video');
    return adjustableClips.find(c => 
      currentTime >= c.start && currentTime < c.start + c.duration
    );
  }, [clips, selectedClipId, currentTime]);
  
  // 从 clip.metadata 中获取调节参数
  const adjustments: ImageAdjustments = useMemo(() => ({
    ...DEFAULT_ADJUSTMENTS,
    ...(selectedClip?.metadata?.imageAdjustments || {}),
  }), [selectedClip]);

  const handleAdjustmentChange = useCallback((key: keyof ImageAdjustments, value: number) => {
    if (!selectedClip) return;
    
    const newAdjustments = { ...adjustments, [key]: value };
    saveToHistory();
    updateClip(selectedClip.id, {
      metadata: {
        ...selectedClip.metadata,
        imageAdjustments: newAdjustments,
      },
    });
  }, [selectedClip, adjustments, updateClip, saveToHistory]);

  const handleReset = useCallback(() => {
    if (!selectedClip) return;
    
    saveToHistory();
    updateClip(selectedClip.id, {
      metadata: {
        ...selectedClip.metadata,
        imageAdjustments: DEFAULT_ADJUSTMENTS,
      },
    });
  }, [selectedClip, updateClip, saveToHistory]);

  const handleResetSingle = useCallback((key: keyof ImageAdjustments) => {
    handleAdjustmentChange(key, DEFAULT_ADJUSTMENTS[key]);
  }, [handleAdjustmentChange]);

  if (!selectedClip) return null;

  return (
    <div className="w-full h-full flex flex-col bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">调节</h3>
          <button
            onClick={handleReset}
            className="p-1 hover:bg-gray-100 rounded transition-colors text-gray-500 hover:text-gray-700"
            title="重置所有"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
        <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 rounded transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
            {/* 色彩 */}
            <Section title="色彩">
              <SliderControl
                label="色温"
                value={adjustments.temperature}
                onChange={(v) => handleAdjustmentChange('temperature', v)}
                onReset={() => handleResetSingle('temperature')}
                min={-100}
                max={100}
              />
              
              <SliderControl
                label="色调"
                value={adjustments.tint}
                onChange={(v) => handleAdjustmentChange('tint', v)}
                onReset={() => handleResetSingle('tint')}
                min={-100}
                max={100}
              />
              
              <SliderControl
                label="饱和度"
                value={adjustments.saturation}
                onChange={(v) => handleAdjustmentChange('saturation', v)}
                onReset={() => handleResetSingle('saturation')}
                min={-100}
                max={100}
              />
            </Section>

            {/* 明度 */}
            <Section title="明度">
              <SliderControl
                label="亮度"
                value={adjustments.brightness}
                onChange={(v) => handleAdjustmentChange('brightness', v)}
                onReset={() => handleResetSingle('brightness')}
                min={-100}
                max={100}
              />
              
              <SliderControl
                label="对比度"
                value={adjustments.contrast}
                onChange={(v) => handleAdjustmentChange('contrast', v)}
                onReset={() => handleResetSingle('contrast')}
                min={-100}
                max={100}
              />
            </Section>

            {/* 效果 */}
            <Section title="效果">
              <SliderControl
                label="锐化"
                value={adjustments.sharpness}
                onChange={(v) => handleAdjustmentChange('sharpness', v)}
                onReset={() => handleResetSingle('sharpness')}
                min={0}
                max={100}
              />
            </Section>
      </div>
    </div>
  );
}

// Section Component
interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-gray-500">{title}</h4>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );
}

// Slider Control Component - 统一样式
interface SliderControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onReset: () => void;
  min?: number;
  max?: number;
  step?: number;
}

function SliderControl({
  label,
  value,
  onChange,
  onReset,
  min = -100,
  max = 100,
  step = 1,
}: SliderControlProps) {
  const isDefault = value === 0 || (min === 0 && value === 0);
  const percentage = ((value - min) / (max - min)) * 100;
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-gray-600">{label}</label>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-14 px-2 py-1 text-xs bg-gray-100 border border-gray-200 rounded text-gray-700 text-center focus:border-gray-400 focus:outline-none"
          min={min}
          max={max}
        />
      </div>
      
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-gray-600"
        style={{
          background: `linear-gradient(to right, #4B5563 0%, #4B5563 ${percentage}%, #E5E7EB ${percentage}%, #E5E7EB 100%)`
        }}
      />
    </div>
  );
}
