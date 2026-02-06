'use client';

import { useMemo, useCallback } from 'react';
import {
  X,
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  RotateCcw,
  Maximize2,
  Move,
  Eye,
  ChevronDown,
  ChevronRight,
  PictureInPicture2,
  Square,
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { CompoundKeyframeControls, KeyframeAddDeleteButtons } from './keyframes/PropertyKeyframeButton';
import { getClipTransformAtOffset } from '../lib/keyframe-interpolation';
import type { Clip } from '../types/clip';
import type { KeyframeProperty, CompoundValue } from '../types';

// 画布比例预设 - 青色框的固定比例选项（仅支持 16:9 和 9:16）
const CANVAS_ASPECT_PRESETS: { label: '16:9' | '9:16' }[] = [
  { label: '16:9' },
  { label: '9:16' },
];

/**
 * 计算裁剪区域 - 居中裁剪到目标比例（保留用于视频内容适配）
 */
function calculateCropRect(sourceRatio: number, targetRatio: number): { x: number; y: number; width: number; height: number } {
  if (targetRatio > sourceRatio) {
    const height = sourceRatio / targetRatio;
    const y = (1 - height) / 2;
    return { x: 0, y, width: 1, height };
  } else {
    const width = targetRatio / sourceRatio;
    const x = (1 - width) / 2;
    return { x, y: 0, width, height: 1 };
  }
}

interface TransformPanelProps {
  onClose: () => void;
}

/**
 * 变换面板 V2 - 集成复合关键帧功能
 * 
 * ★ 重构：
 * 1. 位置（X+Y）共用一组关键帧
 * 2. 缩放（X+Y）共用一组关键帧
 * 3. 点击关键帧按钮在当前播放头位置添加/删除复合关键帧
 */
export function TransformPanel({ onClose }: TransformPanelProps) {
  // Store hooks
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const updateClip = useEditorStore((s) => s.updateClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const assets = useEditorStore((s) => s.assets);
  const keyframes = useEditorStore((s) => s.keyframes);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const currentTime = useEditorStore((s) => s.currentTime);
  const canvasAspectRatio = useEditorStore((s) => s.canvasAspectRatio);
  const setCanvasAspectRatio = useEditorStore((s) => s.setCanvasAspectRatio);

  // ★ 核心逻辑：优先显示播放头位置的 video clip，其次是选中的 clip
  // 这样可以确保面板始终显示与画面对应的 clip 信息
  const activeVideoClip = useMemo(() => {
    // 找到当前播放头位置的 video clip
    const videoClips = clips.filter(c => c.clipType === 'video');
    const clipAtPlayhead = videoClips.find(c => 
      currentTime >= c.start && currentTime < c.start + c.duration
    );
    
    if (clipAtPlayhead) return clipAtPlayhead;
    
    // 如果播放头不在任何 video clip 上，回退到选中的 clip
    if (selectedClipId) {
      const selected = clips.find(c => c.id === selectedClipId);
      if (selected?.clipType === 'video') return selected;
    }
    
    return null;
  }, [clips, currentTime, selectedClipId]);

  // 用于操作的 clipId（使用 activeVideoClip）
  const targetClipId = activeVideoClip?.id || null;
  const targetClip = activeVideoClip;

  // 计算当前 offset (0-1)
  const currentOffset = useMemo(() => {
    if (!targetClip || targetClip.duration <= 0) return 0;
    const relativeTime = currentTime - targetClip.start;
    return Math.max(0, Math.min(1, relativeTime / targetClip.duration));
  }, [currentTime, targetClip]);

  // 检查是否在 clip 范围内
  const isInRange = useMemo(() => {
    if (!targetClip) return false;
    const relativeTime = currentTime - targetClip.start;
    return relativeTime >= 0 && relativeTime <= targetClip.duration;
  }, [targetClip, currentTime]);

  // 获取原始视频的宽高比
  const sourceAspectRatio = useMemo(() => {
    if (!targetClip?.assetId) return 9/16;
    const asset = assets.find(a => a.id === targetClip.assetId);
    if (asset?.metadata?.width && asset?.metadata?.height) {
      return asset.metadata.width / asset.metadata.height;
    }
    if (targetClip.aspectRatio === '16:9') return 16/9;
    if (targetClip.aspectRatio === '9:16') return 9/16;
    return 9/16;  // 默认竖屏
  }, [targetClip?.assetId, targetClip?.aspectRatio, assets]);

  // 获取当前 clip 的关键帧 Map
  const clipKeyframes = useMemo(() => {
    if (!targetClipId) return undefined;
    return keyframes.get(targetClipId);
  }, [keyframes, targetClipId]);

  // ★ 核心：计算当前播放头位置的关键帧插值值
  const interpolatedTransform = useMemo(() => {
    return getClipTransformAtOffset(clipKeyframes, currentOffset);
  }, [clipKeyframes, currentOffset]);

  // 当前 transform 状态
  // ★ 优先使用关键帧插值值，没有关键帧时才用静态 transform
  const currentTransform = targetClip?.transform || {};
  
  // 缩放：优先关键帧值
  const scaleX = interpolatedTransform.scaleX ?? currentTransform.scale ?? 1;
  const scaleY = interpolatedTransform.scaleY ?? currentTransform.scale ?? 1;
  const scale = (scaleX + scaleY) / 2;  // 显示平均值
  
  // 位置：优先关键帧值
  const offsetX = interpolatedTransform.positionX ?? currentTransform.x ?? 0;
  const offsetY = interpolatedTransform.positionY ?? currentTransform.y ?? 0;
  
  // 旋转：优先关键帧值
  const rotation = interpolatedTransform.rotation ?? currentTransform.rotation ?? 0;
  
  // 不透明度：优先关键帧值
  const opacity = interpolatedTransform.opacity ?? currentTransform.opacity ?? 1;
  
  // 翻转：只有静态值（不支持关键帧）
  const flipH = currentTransform.flipH ?? false;
  const flipV = currentTransform.flipV ?? false;

  // 获取属性的关键帧状态
  const getPropertyKeyframes = useCallback((property: KeyframeProperty) => {
    if (!targetClipId) return [];
    const clipMap = keyframes.get(targetClipId);
    if (!clipMap) return [];
    return clipMap.get(property) || [];
  }, [keyframes, targetClipId]);

  // 获取 updateKeyframe 方法
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);

  // 检查属性是否有关键帧
  const hasKeyframes = useCallback((property: KeyframeProperty) => {
    return getPropertyKeyframes(property).length > 0;
  }, [getPropertyKeyframes]);

  // 更新 transform - 支持关键帧自动创建和更新
  const handleTransformUpdate = useCallback((
    updates: Partial<NonNullable<Clip['transform']>>,
    keyframeProperty?: KeyframeProperty,
    keyframeValue?: number | CompoundValue,
    skipKeyframeUpdate?: boolean
  ) => {
    if (!targetClipId || !targetClip) return;
    
    // 如果提供了关键帧属性，检查是否需要处理关键帧
    if (keyframeProperty && keyframeValue !== undefined && isInRange) {
      const propertyKfs = getPropertyKeyframes(keyframeProperty);
      
      if (propertyKfs.length > 0) {
        // 已有关键帧，检查当前位置是否有
        const TOLERANCE = 0.005; // 0.5% 容差
        const existingKf = propertyKfs.find(
          kf => Math.abs(kf.offset - currentOffset) <= TOLERANCE
        );
        
        if (existingKf) {
          // 当前位置已有关键帧，更新其值
          updateKeyframe(existingKf.id, { value: keyframeValue });
        } else if (!skipKeyframeUpdate) {
          // 当前位置没有关键帧，且不在拖动中，自动添加
          addKeyframe(targetClipId, keyframeProperty, currentOffset, keyframeValue);
        }
        
        // 属性有关键帧时，不需要更新静态 transform
        if (!skipKeyframeUpdate) {
          saveToHistory();
        }
        return;
      }
    }
    
    // 没有关键帧时，更新静态 transform
    if (!skipKeyframeUpdate) {
      saveToHistory();
    }
    updateClip(targetClipId, {
      transform: { ...currentTransform, ...updates }
    });
  }, [targetClipId, targetClip, currentTransform, updateClip, saveToHistory, isInRange, currentOffset, getPropertyKeyframes, addKeyframe, updateKeyframe]);

  // 选择画面比例 - ★ 修改画布比例，而非 clip 的 cropRect
  const handleAspectSelect = useCallback((ratioLabel: '16:9' | '9:16') => {
    setCanvasAspectRatio(ratioLabel);
  }, [setCanvasAspectRatio]);

  // 重置所有变换
  const handleReset = useCallback(() => {
    if (!targetClipId) return;
    saveToHistory();
    updateClip(targetClipId, { transform: undefined });
  }, [targetClipId, updateClip, saveToHistory]);

  // 快捷操作
  const handleFlipH = () => handleTransformUpdate({ flipH: !flipH });
  const handleFlipV = () => handleTransformUpdate({ flipV: !flipV });
  const handleRotate90 = () => handleTransformUpdate({ rotation: (rotation + 90) % 360 }, 'rotation', (rotation + 90) % 360);

  // ========== 复合属性处理（V2 重构）==========

  // 缩放处理 - 使用复合属性 scale（同时存储 x, y）
  const handleScaleChange = useCallback((value: number, isDragging = false) => {
    const compoundValue: CompoundValue = { x: value, y: value };
    handleTransformUpdate({ scale: value }, 'scale', compoundValue, isDragging);
  }, [handleTransformUpdate]);

  // 位置 X 处理 - 使用复合属性 position
  const handleOffsetXChange = useCallback((value: number, isDragging = false) => {
    const compoundValue: CompoundValue = { x: value, y: offsetY };
    handleTransformUpdate({ x: value }, 'position', compoundValue, isDragging);
  }, [handleTransformUpdate, offsetY]);

  // 位置 Y 处理 - 使用复合属性 position
  const handleOffsetYChange = useCallback((value: number, isDragging = false) => {
    const compoundValue: CompoundValue = { x: offsetX, y: value };
    handleTransformUpdate({ y: value }, 'position', compoundValue, isDragging);
  }, [handleTransformUpdate, offsetX]);

  // 旋转处理 - 简单属性
  const handleRotationChange = useCallback((value: number, isDragging = false) => {
    handleTransformUpdate({ rotation: value }, 'rotation', value, isDragging);
  }, [handleTransformUpdate]);

  // 不透明度处理 - 简单属性
  const handleOpacityChange = useCallback((value: number, isDragging = false) => {
    handleTransformUpdate({ opacity: value }, 'opacity', value, isDragging);
  }, [handleTransformUpdate]);

  // 未选中 clip 的提示
  if (!targetClip) {
    return (
      <div className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">变换与动画</h3>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 rounded transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-gray-500 text-center">
            请先在时间轴上选择一个<br/>视频片段
          </p>
        </div>
      </div>
    );
  }
  // 此时 targetClipId 必定非空
  const clipId = targetClipId!;

  return (
    <div className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">变换与动画</h3>
        <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 rounded transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {/* 当前片段信息 */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">当前片段</p>
          <p className="text-xs text-gray-700 mt-1 truncate">{targetClip.name}</p>
          {!isInRange && (
            <p className="text-[10px] text-yellow-600 mt-1">
              ⚠️ 播放头不在片段范围内，关键帧功能已禁用
            </p>
          )}
        </div>

        {/* ★ 缩放 - 使用复合属性 scale（一个关键帧同时控制 X/Y）*/}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Maximize2 size={14} className="text-gray-500" />
              <span className="text-xs font-medium text-gray-600">缩放</span>
            </div>
            <div className="flex items-center gap-2">
              <CompoundKeyframeControls
                clipId={clipId}
                property="scale"
                currentValue={{ x: scaleX, y: scaleY }}
                disabled={!isInRange}
              />
              <span className="text-xs text-gray-500 font-mono w-16 text-right">
                {(scale * 100).toFixed(1)}%
              </span>
            </div>
          </div>
          
          {/* 步长 0.1（0.1%），与位置精度统一，确保动画流畅 */}
          <input
            type="range"
            min={10}
            max={300}
            step={0.1}
            value={scale * 100}
            onChange={(e) => handleScaleChange(Number(e.target.value) / 100, true)}
            onMouseUp={(e) => handleScaleChange(Number((e.target as HTMLInputElement).value) / 100, false)}
            onTouchEnd={(e) => handleScaleChange(Number((e.target as HTMLInputElement).value) / 100, false)}
            className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-600"
          />
          {hasKeyframes('scale') && (
            <p className="text-[10px] text-gray-500 mt-2">
              ◆ 已启用关键帧动画
            </p>
          )}
        </div>

        {/* ★ 位置 - 使用复合属性 position（一个关键帧同时控制 X/Y）*/}
        <div className="p-4 border-b border-gray-100">
          {/* X 位置 */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Move size={14} className="text-gray-500" />
              <span className="text-xs font-medium text-gray-600">位置 X</span>
            </div>
            <div className="flex items-center gap-2">
              <CompoundKeyframeControls
                clipId={clipId}
                property="position"
                currentValue={{ x: offsetX, y: offsetY }}
                disabled={!isInRange}
              />
              <span className="text-xs text-gray-500 font-mono w-12 text-right">
                {offsetX.toFixed(1)}
              </span>
            </div>
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            step={0.1}
            value={offsetX}
            onChange={(e) => handleOffsetXChange(Number(e.target.value))}
            className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-600"
          />
          
          {/* Y 位置 */}
          <div className="flex items-center justify-between mt-4 mb-2">
            <span className="text-xs font-medium text-gray-600 ml-6">位置 Y</span>
            <span className="text-xs text-gray-500 font-mono w-12 text-right">
              {offsetY.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            step={0.1}
            value={offsetY}
            onChange={(e) => handleOffsetYChange(Number(e.target.value))}
            className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-600"
          />
          
          {hasKeyframes('position') && (
            <p className="text-[10px] text-gray-500 mt-2">
              ◆ 已启用关键帧动画
            </p>
          )}
        </div>

        {/* 旋转 - 带关键帧 */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <RotateCw size={14} className="text-gray-500" />
              <span className="text-xs font-medium text-gray-600">旋转</span>
            </div>
            <div className="flex items-center gap-2">
              <KeyframeAddDeleteButtons
                clipId={clipId}
                property="rotation"
                currentValue={rotation}
                disabled={!isInRange}
              />
              <span className="text-xs text-gray-500 font-mono w-12 text-right">
                {rotation}°
              </span>
            </div>
          </div>
          
          <input
            type="range"
            min={-360}
            max={360}
            step={1}
            value={rotation}
            onChange={(e) => handleRotationChange(Number(e.target.value), true)}
            onMouseUp={(e) => handleRotationChange(Number((e.target as HTMLInputElement).value), false)}
            onTouchEnd={(e) => handleRotationChange(Number((e.target as HTMLInputElement).value), false)}
            className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-600"
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleRotate90}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            >
              <RotateCw size={12} />
              <span>+90°</span>
            </button>
            <button
              onClick={() => handleRotationChange((rotation - 90 + 360) % 360)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            >
              <RotateCcw size={12} />
              <span>-90°</span>
            </button>
          </div>
          {hasKeyframes('rotation') && (
            <p className="text-[10px] text-gray-500 mt-2">
              ◆ 已启用关键帧动画
            </p>
          )}
        </div>

        {/* 不透明度 - 带关键帧 */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Eye size={14} className="text-gray-500" />
              <span className="text-xs font-medium text-gray-600">不透明度</span>
            </div>
            <div className="flex items-center gap-2">
              <KeyframeAddDeleteButtons
                clipId={clipId}
                property="opacity"
                currentValue={opacity}
                disabled={!isInRange}
              />
              <span className="text-xs text-gray-500 font-mono w-12 text-right">
                {Math.round(opacity * 100)}%
              </span>
            </div>
          </div>
          
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={opacity * 100}
            onChange={(e) => handleOpacityChange(Number(e.target.value) / 100, true)}
            onMouseUp={(e) => handleOpacityChange(Number((e.target as HTMLInputElement).value) / 100, false)}
            onTouchEnd={(e) => handleOpacityChange(Number((e.target as HTMLInputElement).value) / 100, false)}
            className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-600"
          />
          {hasKeyframes('opacity') && (
            <p className="text-[10px] text-gray-500 mt-2">
              ◆ 已启用关键帧动画
            </p>
          )}
        </div>

        {/* 翻转 */}
        <div className="p-4 border-b border-gray-100">
          <h4 className="text-xs font-medium text-gray-600 mb-3">翻转</h4>
          <div className="flex gap-2">
            <button
              onClick={handleFlipH}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs rounded-md transition-colors ${
                flipH 
                  ? 'bg-gray-200 text-gray-700 border border-gray-400' 
                  : 'text-gray-700 bg-gray-100 hover:bg-gray-200 border border-transparent'
              }`}
            >
              <FlipHorizontal size={14} />
              <span>水平</span>
            </button>
            <button
              onClick={handleFlipV}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs rounded-md transition-colors ${
                flipV 
                  ? 'bg-gray-200 text-gray-700 border border-gray-400' 
                  : 'text-gray-700 bg-gray-100 hover:bg-gray-200 border border-transparent'
              }`}
            >
              <FlipVertical size={14} />
              <span>垂直</span>
            </button>
          </div>
        </div>

        {/* 画面比例 - 控制画布/导出比例（青色框的固定比例） */}
        <div className="p-4 border-b border-gray-100">
          <h4 className="text-xs font-medium text-gray-600 mb-3">画面比例</h4>
          <div className="grid grid-cols-3 gap-2">
            {CANVAS_ASPECT_PRESETS.map((preset) => {
              const isSelected = canvasAspectRatio === preset.label;
              return (
                <button
                  key={preset.label}
                  onClick={() => handleAspectSelect(preset.label)}
                  className={`py-2 px-3 text-xs rounded-md border transition-all ${
                    isSelected
                      ? 'bg-gray-200 text-gray-700 border-gray-400 font-medium'
                      : 'text-gray-700 bg-gray-100 hover:bg-gray-200 border-gray-200'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            导出视频将使用此比例
          </p>
        </div>

        {/* 显示模式 - B-roll 画中画/全屏切换 */}
        <div className="p-4 border-b border-gray-100">
          <h4 className="text-xs font-medium text-gray-600 mb-3">显示模式</h4>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                if (!targetClipId) return;
                saveToHistory();
                updateClip(targetClipId, {
                  metadata: {
                    ...targetClip?.metadata,
                    displayMode: 'fullscreen',
                  },
                });
              }}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-xs rounded-md border transition-all ${
                (targetClip?.metadata?.displayMode || 'fullscreen') === 'fullscreen'
                  ? 'bg-gray-200 text-gray-700 border-gray-400 font-medium'
                  : 'text-gray-700 bg-gray-100 hover:bg-gray-200 border-gray-200'
              }`}
            >
              <Square size={14} />
              <span>全屏</span>
            </button>
            <button
              onClick={() => {
                if (!targetClipId) return;
                saveToHistory();
                updateClip(targetClipId, {
                  metadata: {
                    ...targetClip?.metadata,
                    displayMode: 'pip',
                  },
                });
              }}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-xs rounded-md border transition-all ${
                targetClip?.metadata?.displayMode === 'pip'
                  ? 'bg-gray-200 text-gray-700 border-gray-400 font-medium'
                  : 'text-gray-700 bg-gray-100 hover:bg-gray-200 border-gray-200'
              }`}
            >
              <PictureInPicture2 size={14} />
              <span>画中画</span>
            </button>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            画中画模式时，视频将作为小窗口显示在画面角落
          </p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="p-4 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={handleReset}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
        >
          <RotateCcw size={14} />
          <span>重置所有变换</span>
        </button>
      </div>
    </div>
  );
}

export default TransformPanel;
