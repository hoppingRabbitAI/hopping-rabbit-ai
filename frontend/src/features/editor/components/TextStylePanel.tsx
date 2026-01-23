'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  X,
  Bold,
  Underline,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  ChevronDown,
  Plus,
  Check,
  Diamond,
  Move,
  RotateCw,
  Maximize2,
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import type { Clip } from '../types/clip';
import {
  TextStyle,
  DEFAULT_TEXT_STYLE,
  FONT_FAMILIES,
  FontConfig,
  getFontsByCategory,
  loadFont,
  isFontLoaded,
  TEXT_PRESETS,
  getPresetStyle,
} from '../types/text';
import { KeyframeAddDeleteButtons, CompoundKeyframeControls } from './keyframes/PropertyKeyframeButton';

interface TextStylePanelProps {
  onClose: () => void;
  /** 添加新文本的回调 */
  onAddText?: () => void;
  /** 仅编辑特定类型的 clip: 'text' 或 'subtitle'，不设置则都支持 */
  clipTypeFilter?: 'text' | 'subtitle';
}

/**
 * 文本属性编辑面板
 * 对标剪映的文本编辑功能
 * 支持多选批量编辑
 */
export function TextStylePanel({ onClose, onAddText, clipTypeFilter }: TextStylePanelProps) {
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const updateClip = useEditorStore((s) => s.updateClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const currentTime = useEditorStore((s) => s.currentTime);

  // 字体选择器展开状态
  const [fontSelectorOpen, setFontSelectorOpen] = useState(false);

  // 根据 clipTypeFilter 筛选的类型
  const matchClipType = useCallback((clipType: string) => {
    if (clipTypeFilter) {
      return clipType === clipTypeFilter;
    }
    return clipType === 'text' || clipType === 'subtitle';
  }, [clipTypeFilter]);

  // 获取所有选中的文本/字幕 Clips（支持多选，根据 clipTypeFilter 筛选）
  const selectedTextClips = useMemo(() => {
    const textClips: Clip[] = [];
    
    // 优先检查多选
    if (selectedClipIds.size > 0) {
      selectedClipIds.forEach(id => {
        const clip = clips.find(c => c.id === id);
        if (clip && matchClipType(clip.clipType)) {
          textClips.push(clip);
        }
      });
    }
    
    // 如果多选中没有匹配的 clip，则检查单选
    if (textClips.length === 0 && selectedClipId) {
      const clip = clips.find((c) => c.id === selectedClipId);
      if (clip && matchClipType(clip.clipType)) {
        textClips.push(clip);
      }
    }
    
    // 如果还是没有，尝试找当前播放头位置的匹配 clip
    if (textClips.length === 0) {
      const allMatchingClips = clips.filter((c) => matchClipType(c.clipType));
      const atPlayhead = allMatchingClips.find((c) => currentTime >= c.start && currentTime < c.start + c.duration);
      if (atPlayhead) {
        textClips.push(atPlayhead);
      }
    }
    
    return textClips;
  }, [clips, selectedClipId, selectedClipIds, currentTime, matchClipType]);

  // 获取第一个选中的文本 Clip（用于显示当前样式）
  const selectedTextClip = selectedTextClips[0] || null;
  
  // 选中的文本 clip 数量
  const selectedCount = selectedTextClips.length;

  // 当前文本样式
  const currentStyle: TextStyle = useMemo(() => {
    if (!selectedTextClip?.textStyle) return DEFAULT_TEXT_STYLE;
    return {
      ...DEFAULT_TEXT_STYLE,
      ...selectedTextClip.textStyle,
    } as TextStyle;
  }, [selectedTextClip]);

  // 更新文本样式（支持批量更新所有选中的文本/字幕）
  const updateStyle = useCallback(
    (updates: Partial<TextStyle>) => {
      if (selectedTextClips.length === 0) return;
      saveToHistory();
      
      // 批量更新所有选中的文本 clip
      selectedTextClips.forEach(clip => {
        const clipStyle = {
          ...DEFAULT_TEXT_STYLE,
          ...(clip.textStyle as Partial<TextStyle>),
        };
        updateClip(clip.id, {
          textStyle: {
            ...clipStyle,
            ...updates,
          },
        });
      });
    },
    [selectedTextClips, updateClip, saveToHistory]
  );

  // 更新文本内容（只对单个 clip 生效）
  const updateContent = useCallback(
    (text: string) => {
      if (!selectedTextClip) return;
      saveToHistory();
      updateClip(selectedTextClip.id, {
        contentText: text,
      });
    },
    [selectedTextClip, updateClip, saveToHistory]
  );

  // 获取当前 transform
  const currentTransform = useMemo(() => {
    return {
      x: selectedTextClip?.transform?.x ?? 0,
      y: selectedTextClip?.transform?.y ?? 0,
      scale: selectedTextClip?.transform?.scale ?? 1,
      scaleX: selectedTextClip?.transform?.scaleX ?? selectedTextClip?.transform?.scale ?? 1,
      scaleY: selectedTextClip?.transform?.scaleY ?? selectedTextClip?.transform?.scale ?? 1,
      rotation: selectedTextClip?.transform?.rotation ?? 0,
      opacity: selectedTextClip?.transform?.opacity ?? 1,
    };
  }, [selectedTextClip]);

  // 更新 transform（支持批量更新所有选中的文本/字幕）
  const updateTransform = useCallback(
    (updates: Partial<typeof currentTransform>) => {
      if (selectedTextClips.length === 0) return;
      saveToHistory();
      
      // 批量更新所有选中的文本 clip
      selectedTextClips.forEach(clip => {
        updateClip(clip.id, {
          transform: {
            ...clip.transform,
            ...updates,
          },
        });
      });
    },
    [selectedTextClips, updateClip, saveToHistory]
  );

  // 选择字体
  const handleFontSelect = useCallback(
    async (font: FontConfig) => {
      await loadFont(font.id);
      updateStyle({ fontFamily: font.name });
      setFontSelectorOpen(false);
    },
    [updateStyle]
  );

  // 应用预设 - 只修改外观样式，保留用户的基础属性（字号、字体等）
  const handlePresetSelect = useCallback(
    (presetId: string) => {
      const presetStyle = getPresetStyle(presetId);
      loadFont(presetStyle.fontFamily);
      
      // 只应用外观相关的样式，保留当前的基础属性
      // 外观样式：颜色、描边、阴影、背景
      // 保留属性：字号、字体、间距、对齐等
      const styleUpdates: Partial<TextStyle> = {};
      
      // 颜色相关
      if (presetStyle.fontColor !== DEFAULT_TEXT_STYLE.fontColor) {
        styleUpdates.fontColor = presetStyle.fontColor;
      }
      if (presetStyle.backgroundColor !== DEFAULT_TEXT_STYLE.backgroundColor) {
        styleUpdates.backgroundColor = presetStyle.backgroundColor;
      }
      
      // 描边相关
      styleUpdates.strokeEnabled = presetStyle.strokeEnabled;
      if (presetStyle.strokeEnabled) {
        styleUpdates.strokeColor = presetStyle.strokeColor;
        styleUpdates.strokeWidth = presetStyle.strokeWidth;
      }
      
      // 阴影相关
      styleUpdates.shadowEnabled = presetStyle.shadowEnabled;
      if (presetStyle.shadowEnabled) {
        styleUpdates.shadowColor = presetStyle.shadowColor;
        styleUpdates.shadowBlur = presetStyle.shadowBlur;
        styleUpdates.shadowOffsetX = presetStyle.shadowOffsetX;
        styleUpdates.shadowOffsetY = presetStyle.shadowOffsetY;
      }
      
      // 如果是 "none" 预设，重置为默认外观
      if (presetId === 'none') {
        styleUpdates.fontColor = '#FFFFFF';
        styleUpdates.backgroundColor = 'transparent';
        styleUpdates.strokeEnabled = false;
        styleUpdates.shadowEnabled = false;
      }
      
      updateStyle(styleUpdates);
    },
    [updateStyle]
  );

  // 按类别分组的字体
  const fontsByCategory = useMemo(() => getFontsByCategory(), []);

  // 当前选中的字体配置
  const currentFontConfig = useMemo(() => {
    return FONT_FAMILIES.find((f) => f.name === currentStyle.fontFamily) || FONT_FAMILIES[0];
  }, [currentStyle.fontFamily]);

  // 预加载当前字体
  useEffect(() => {
    if (currentStyle.fontFamily) {
      loadFont(currentFontConfig.id);
    }
  }, [currentStyle.fontFamily, currentFontConfig.id]);

  return (
    <div className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-900">
            {clipTypeFilter === 'subtitle' ? '字幕属性' : '文本属性'}
          </h3>
          {selectedCount > 1 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-200 text-gray-700 rounded">
              已选 {selectedCount} 个
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded-md transition-colors"
        >
          <X size={16} className="text-gray-500" />
        </button>
      </div>

      <div className="flex-1 min-h-0 p-4 pb-8 space-y-4 overflow-y-auto overflow-x-visible custom-scrollbar">
        {/* 没有选中内容时显示提示 */}
        {!selectedTextClip ? (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm mb-4">
              {clipTypeFilter === 'subtitle' ? '选择字幕片段进行编辑' : '选择文本片段进行编辑'}
            </p>
            {onAddText && clipTypeFilter !== 'subtitle' && (
              <button
                onClick={onAddText}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
              >
                <Plus size={16} />
                添加文本
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 预设模板 - 剪映风格网格 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">预设样式</label>
              <div className="grid grid-cols-8 gap-1.5">
                {TEXT_PRESETS.map((preset) => {
                  const previewStyle = getPresetStyle(preset.id);
                  const isNone = preset.id === 'none';
                  
                  return (
                    <button
                      key={preset.id}
                      onClick={() => handlePresetSelect(preset.id)}
                      className="aspect-square rounded-lg flex items-center justify-center transition-all hover:scale-105 hover:ring-2 hover:ring-blue-500/50"
                      style={{
                        backgroundColor: previewStyle.backgroundColor || '#3a3a3a',
                      }}
                      title={preset.name}
                    >
                      {isNone ? (
                        <div className="w-6 h-6 rounded-full border-2 border-gray-600 flex items-center justify-center relative">
                          <div className="w-5 h-0.5 bg-gray-500 rotate-45 absolute" />
                        </div>
                      ) : (
                        <span
                          className="text-lg font-bold select-none"
                          style={{
                            color: previewStyle.fontColor,
                            WebkitTextStroke: previewStyle.strokeEnabled
                              ? `${previewStyle.strokeWidth}px ${previewStyle.strokeColor}`
                              : undefined,
                            textShadow: previewStyle.shadowEnabled
                              ? `0 0 ${previewStyle.shadowBlur}px ${previewStyle.shadowColor}`
                              : undefined,
                          }}
                        >
                          T
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 文本内容 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">文本内容</label>
              <textarea
                value={selectedTextClip.contentText || ''}
                onChange={(e) => updateContent(e.target.value)}
                placeholder="请输入文字"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm resize-none focus:outline-none focus:border-gray-500"
                rows={3}
              />
            </div>

            {/* 字体选择 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">字体</label>
              <div className="relative">
                <button
                  onClick={() => setFontSelectorOpen(!fontSelectorOpen)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm flex items-center justify-between hover:bg-gray-100 transition-colors"
                >
                  <span style={{ fontFamily: currentStyle.fontFamily }}>
                    {currentFontConfig.displayName}
                  </span>
                  <ChevronDown size={16} className={`text-gray-500 transition-transform ${fontSelectorOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* 字体下拉列表 */}
                {fontSelectorOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-64 overflow-y-auto z-10">
                    {Object.entries(fontsByCategory).map(([category, fonts]) => {
                      if (fonts.length === 0) return null;
                      const categoryNames: Record<string, string> = {
                        system: '系统字体',
                        'sans-serif': '无衬线',
                        serif: '衬线',
                        handwriting: '手写体',
                        display: '展示体',
                        monospace: '等宽',
                      };
                      return (
                        <div key={category}>
                          <div className="px-3 py-1.5 text-xs text-gray-500 bg-gray-50 sticky top-0">
                            {categoryNames[category] || category}
                          </div>
                          {fonts.map((font) => (
                            <button
                              key={font.id}
                              onClick={() => handleFontSelect(font)}
                              className="w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors flex items-center justify-between"
                            >
                              <span
                                className="text-gray-900 text-sm"
                                style={{ fontFamily: font.name }}
                              >
                                {font.previewText || font.displayName}
                              </span>
                              {currentStyle.fontFamily === font.name && (
                                <Check size={14} className="text-gray-700" />
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 字号 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">字号</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={4}
                  max={200}
                  step={1}
                  value={currentStyle.fontSize}
                  onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
                  className="flex-1 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full"
                />
                <input
                  type="number"
                  min={4}
                  max={200}
                  value={currentStyle.fontSize}
                  onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
                  className="w-16 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>

            {/* 样式按钮 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">样式</label>
              <div className="flex gap-2">
                <button
                  onClick={() => updateStyle({ bold: !currentStyle.bold })}
                  className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                    currentStyle.bold ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Bold size={18} />
                </button>
                <button
                  onClick={() => updateStyle({ underline: !currentStyle.underline })}
                  className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                    currentStyle.underline ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Underline size={18} />
                </button>
                <button
                  onClick={() => updateStyle({ italic: !currentStyle.italic })}
                  className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                    currentStyle.italic ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Italic size={18} />
                </button>
              </div>
            </div>

            {/* 颜色 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">颜色</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={currentStyle.fontColor}
                  onChange={(e) => updateStyle({ fontColor: e.target.value })}
                  className="w-10 h-10 rounded-lg cursor-pointer border border-gray-200 bg-transparent"
                />
                <input
                  type="text"
                  value={currentStyle.fontColor}
                  onChange={(e) => updateStyle({ fontColor: e.target.value })}
                  className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>

            {/* 字间距 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">字间距</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={-20}
                  max={50}
                  step={1}
                  value={currentStyle.letterSpacing}
                  onChange={(e) => updateStyle({ letterSpacing: Number(e.target.value) })}
                  className="flex-1 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full"
                />
                <input
                  type="number"
                  value={currentStyle.letterSpacing}
                  onChange={(e) => updateStyle({ letterSpacing: Number(e.target.value) })}
                  className="w-16 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>

            {/* 行间距 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">行间距</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.5}
                  max={3}
                  step={0.1}
                  value={currentStyle.lineHeight}
                  onChange={(e) => updateStyle({ lineHeight: Number(e.target.value) })}
                  className="flex-1 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full"
                />
                <input
                  type="number"
                  step={0.1}
                  min={0.5}
                  max={3}
                  value={currentStyle.lineHeight}
                  onChange={(e) => updateStyle({ lineHeight: Number(e.target.value) })}
                  className="w-16 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>

            {/* 对齐方式 */}
            <div>
              <label className="block text-xs text-gray-500 mb-2">对齐方式</label>
              <div className="flex gap-2">
                {/* 水平对齐 */}
                <div className="flex bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => updateStyle({ textAlign: 'left' })}
                    className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                      currentStyle.textAlign === 'left' ? 'bg-gray-700 text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <AlignLeft size={16} />
                  </button>
                  <button
                    onClick={() => updateStyle({ textAlign: 'center' })}
                    className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                      currentStyle.textAlign === 'center' ? 'bg-gray-700 text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <AlignCenter size={16} />
                  </button>
                  <button
                    onClick={() => updateStyle({ textAlign: 'right' })}
                    className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                      currentStyle.textAlign === 'right' ? 'bg-gray-700 text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <AlignRight size={16} />
                  </button>
                </div>

                {/* 垂直对齐 */}
                <div className="flex bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => updateStyle({ verticalAlign: 'top' })}
                    className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                      currentStyle.verticalAlign === 'top' ? 'bg-gray-700 text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <AlignVerticalJustifyStart size={16} />
                  </button>
                  <button
                    onClick={() => updateStyle({ verticalAlign: 'center' })}
                    className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                      currentStyle.verticalAlign === 'center' ? 'bg-gray-700 text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <AlignVerticalJustifyCenter size={16} />
                  </button>
                  <button
                    onClick={() => updateStyle({ verticalAlign: 'bottom' })}
                    className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                      currentStyle.verticalAlign === 'bottom' ? 'bg-gray-700 text-white' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <AlignVerticalJustifyEnd size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* 分隔线 */}
            <div className="border-t border-gray-200" />

            {/* 描边 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-500">描边</label>
                <button
                  onClick={() => updateStyle({ strokeEnabled: !currentStyle.strokeEnabled })}
                  className={`w-10 h-5 rounded-full transition-colors ${
                    currentStyle.strokeEnabled ? 'bg-gray-700' : 'bg-gray-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      currentStyle.strokeEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              {currentStyle.strokeEnabled && (
                <div className="space-y-3 pl-2 border-l-2 border-gray-200">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12">颜色</span>
                    <input
                      type="color"
                      value={currentStyle.strokeColor}
                      onChange={(e) => updateStyle({ strokeColor: e.target.value })}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-200 bg-transparent"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12">宽度</span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={currentStyle.strokeWidth}
                      onChange={(e) => updateStyle({ strokeWidth: Number(e.target.value) })}
                      className="w-20 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 阴影 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-500">阴影</label>
                <button
                  onClick={() => updateStyle({ shadowEnabled: !currentStyle.shadowEnabled })}
                  className={`w-10 h-5 rounded-full transition-colors ${
                    currentStyle.shadowEnabled ? 'bg-gray-700' : 'bg-gray-200'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      currentStyle.shadowEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              {currentStyle.shadowEnabled && (
                <div className="space-y-3 pl-2 border-l-2 border-gray-200">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12">颜色</span>
                    <input
                      type="color"
                      value={currentStyle.shadowColor.startsWith('rgba') ? '#000000' : currentStyle.shadowColor}
                      onChange={(e) => updateStyle({ shadowColor: e.target.value })}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-200 bg-transparent"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12">模糊</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={currentStyle.shadowBlur}
                      onChange={(e) => updateStyle({ shadowBlur: Number(e.target.value) })}
                      className="w-20 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12">偏移</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">X</span>
                      <input
                        type="number"
                        value={currentStyle.shadowOffsetX}
                        onChange={(e) => updateStyle({ shadowOffsetX: Number(e.target.value) })}
                        className="w-14 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                      />
                      <span className="text-xs text-gray-500">Y</span>
                      <input
                        type="number"
                        value={currentStyle.shadowOffsetY}
                        onChange={(e) => updateStyle({ shadowOffsetY: Number(e.target.value) })}
                        className="w-14 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 分隔线 */}
            <div className="border-t border-gray-200" />

            {/* 变换属性 - 文本专属 */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Move size={14} className="text-gray-500" />
                <span className="text-xs text-gray-600 font-medium">变换</span>
              </div>

              {/* 位置 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-500">位置</label>
                  {selectedTextClip && (
                    <CompoundKeyframeControls
                      clipId={selectedTextClip.id}
                      property="position"
                      currentValue={{ x: currentTransform.x, y: currentTransform.y }}
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-4">X</span>
                    <input
                      type="number"
                      value={Math.round(currentTransform.x)}
                      onChange={(e) => updateTransform({ x: Number(e.target.value) })}
                      className="flex-1 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-4">Y</span>
                    <input
                      type="number"
                      value={Math.round(currentTransform.y)}
                      onChange={(e) => updateTransform({ y: Number(e.target.value) })}
                      className="flex-1 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                    />
                  </div>
                </div>
              </div>

              {/* 缩放 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-500">缩放</label>
                  {selectedTextClip && (
                    <CompoundKeyframeControls
                      clipId={selectedTextClip.id}
                      property="scale"
                      currentValue={{ x: currentTransform.scaleX, y: currentTransform.scaleY }}
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-4">X</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0.1}
                      max={5}
                      value={currentTransform.scaleX.toFixed(1)}
                      onChange={(e) => updateTransform({ scaleX: Number(e.target.value) })}
                      className="flex-1 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-4">Y</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0.1}
                      max={5}
                      value={currentTransform.scaleY.toFixed(1)}
                      onChange={(e) => updateTransform({ scaleY: Number(e.target.value) })}
                      className="flex-1 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                    />
                  </div>
                </div>
              </div>

              {/* 旋转 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-500">旋转</label>
                  {selectedTextClip && (
                    <KeyframeAddDeleteButtons
                      clipId={selectedTextClip.id}
                      property="rotation"
                      currentValue={currentTransform.rotation}
                    />
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={currentTransform.rotation}
                    onChange={(e) => updateTransform({ rotation: Number(e.target.value) })}
                    className="flex-1 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={Math.round(currentTransform.rotation)}
                      onChange={(e) => updateTransform({ rotation: Number(e.target.value) })}
                      className="w-14 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-gray-900 text-sm text-center focus:outline-none focus:border-gray-500"
                    />
                    <span className="text-xs text-gray-500">°</span>
                  </div>
                </div>
              </div>

              {/* 不透明度 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-500">不透明度</label>
                  {selectedTextClip && (
                    <KeyframeAddDeleteButtons
                      clipId={selectedTextClip.id}
                      property="opacity"
                      currentValue={currentTransform.opacity}
                    />
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={currentTransform.opacity}
                    onChange={(e) => updateTransform({ opacity: Number(e.target.value) })}
                    className="flex-1 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full"
                  />
                  <span className="text-xs text-gray-500 w-12 text-right">
                    {Math.round(currentTransform.opacity * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
