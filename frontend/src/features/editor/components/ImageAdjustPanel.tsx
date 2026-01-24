'use client';

import { useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '../store/editor-store';
import { X, RotateCcw } from 'lucide-react';

interface ImageAdjustments {
  // 色彩
  temperature: number;      // 色温 -100~100
  tint: number;            // 色调 -100~100
  saturation: number;      // 饱和度 -100~100
  naturalSaturation: number; // 自然饱和度 -100~100
  
  // 明度
  brightness: number;      // 亮度 -100~100
  contrast: number;        // 对比度 -100~100
  highlights: number;      // 高光 -100~100
  shadows: number;         // 阴影 -100~100
  whites: number;          // 白色 -100~100
  blacks: number;          // 黑色 -100~100
  luminance: number;       // 光感 -100~100
  
  // 效果
  sharpness: number;       // 锐化 0~100
  clarity: number;         // 清晰 -100~100
  grain: number;           // 颗粒 0~100
  fade: number;            // 褪色 0~100
  vignette: number;        // 暗角 -100~100
  chromatic: number;       // 色差 -100~100
}

const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  temperature: 0,
  tint: 0,
  saturation: 0,
  naturalSaturation: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  luminance: 0,
  sharpness: 0,
  clarity: 0,
  grain: 0,
  fade: 0,
  vignette: 0,
  chromatic: 0,
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

  // 获取选中的图片 clip
  const selectedClip = useMemo(() => {
    if (selectedClipId) {
      const clip = clips.find(c => c.id === selectedClipId);
      if (clip?.clipType === 'image') return clip;
    }
    
    // 如果没有选中，找播放头位置的图片 clip
    const imageClips = clips.filter(c => c.clipType === 'image');
    return imageClips.find(c => 
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
    <div className="w-full h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-gray-900">调节</h3>
          <button
            onClick={handleReset}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 hover:text-gray-900"
            title="重置所有"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 hover:text-gray-900"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
            {/* 色彩 */}
            <Section title="色彩">
              <SliderControl
                label="色温"
                value={adjustments.temperature}
                onChange={(v) => handleAdjustmentChange('temperature', v)}
                onReset={() => handleResetSingle('temperature')}
                min={-100}
                max={100}
                gradient="linear-gradient(to right, #4a90e2, transparent, #ff9500)"
              />
              
              <SliderControl
                label="色调"
                value={adjustments.tint}
                onChange={(v) => handleAdjustmentChange('tint', v)}
                onReset={() => handleResetSingle('tint')}
                min={-100}
                max={100}
                gradient="linear-gradient(to right, #00ff00, transparent, #ff00ff)"
              />
              
              <SliderControl
                label="饱和度"
                value={adjustments.saturation}
                onChange={(v) => handleAdjustmentChange('saturation', v)}
                onReset={() => handleResetSingle('saturation')}
                min={-100}
                max={100}
                gradient="linear-gradient(to right, #808080, #ff0000)"
              />
              
              <SliderControl
                label="自然饱和度"
                value={adjustments.naturalSaturation}
                onChange={(v) => handleAdjustmentChange('naturalSaturation', v)}
                onReset={() => handleResetSingle('naturalSaturation')}
                min={-100}
                max={100}
                gradient="linear-gradient(to right, #808080, #ff6b6b)"
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
              
              <SliderControl
                label="高光"
                value={adjustments.highlights}
                onChange={(v) => handleAdjustmentChange('highlights', v)}
                onReset={() => handleResetSingle('highlights')}
                min={-100}
                max={100}
              />
              
              <SliderControl
                label="阴影"
                value={adjustments.shadows}
                onChange={(v) => handleAdjustmentChange('shadows', v)}
                onReset={() => handleResetSingle('shadows')}
                min={-100}
                max={100}
              />
              
              <SliderControl
                label="白色"
                value={adjustments.whites}
                onChange={(v) => handleAdjustmentChange('whites', v)}
                onReset={() => handleResetSingle('whites')}
                min={-100}
                max={100}
              />
              
              <SliderControl
                label="黑色"
                value={adjustments.blacks}
                onChange={(v) => handleAdjustmentChange('blacks', v)}
                onReset={() => handleResetSingle('blacks')}
                min={-100}
                max={100}
              />
              
              <SliderControl
                label="光感"
                value={adjustments.luminance}
                onChange={(v) => handleAdjustmentChange('luminance', v)}
                onReset={() => handleResetSingle('luminance')}
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
              
              <SliderControl
                label="清晰"
                value={adjustments.clarity}
                onChange={(v) => handleAdjustmentChange('clarity', v)}
                onReset={() => handleResetSingle('clarity')}
                min={-100}
                max={100}
              />
              
              <SliderControl
                label="颗粒"
                value={adjustments.grain}
                onChange={(v) => handleAdjustmentChange('grain', v)}
                onReset={() => handleResetSingle('grain')}
                min={0}
                max={100}
              />
              
              <SliderControl
                label="褪色"
                value={adjustments.fade}
                onChange={(v) => handleAdjustmentChange('fade', v)}
                onReset={() => handleResetSingle('fade')}
                min={0}
                max={100}
              />
              
              <SliderControl
                label="暗角"
                value={adjustments.vignette}
                onChange={(v) => handleAdjustmentChange('vignette', v)}
                onReset={() => handleResetSingle('vignette')}
                min={-100}
                max={100}
              />
              
              <SliderControl
                label="色差"
                value={adjustments.chromatic}
                onChange={(v) => handleAdjustmentChange('chromatic', v)}
                onReset={() => handleResetSingle('chromatic')}
                min={-100}
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
    <div className="space-y-4">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h4>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

// Slider Control Component
interface SliderControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onReset: () => void;
  min?: number;
  max?: number;
  step?: number;
  gradient?: string;
}

function SliderControl({
  label,
  value,
  onChange,
  onReset,
  min = -100,
  max = 100,
  step = 1,
  gradient,
}: SliderControlProps) {
  const isDefault = value === 0 || (min === 0 && value === 0);
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <div className="flex items-center space-x-2">
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-16 px-2 py-1 text-xs bg-white border border-gray-300 rounded text-gray-900 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            min={min}
            max={max}
          />
          {!isDefault && (
            <button
              onClick={onReset}
              className="p-1 hover:bg-gray-100 rounded transition-colors text-gray-500 hover:text-gray-700"
              title="重置"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      
      <div className="relative h-2">
        {gradient && (
          <div
            className="absolute inset-0 rounded-full opacity-40"
            style={{ background: gradient }}
          />
        )}
        <input
          type="range"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          className="w-full h-2 rounded-full appearance-none cursor-pointer slider-thumb bg-gray-200"
          style={{
            background: gradient ? 'transparent' : undefined,
          }}
        />
      </div>
    </div>
  );
}
