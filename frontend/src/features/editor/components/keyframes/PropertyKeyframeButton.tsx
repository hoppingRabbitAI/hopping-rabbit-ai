'use client';

import { useMemo, useCallback } from 'react';
import { Diamond, Plus, Minus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEditorStore } from '../../store/editor-store';
import type { KeyframeProperty, Keyframe, KeyframeStatus, CompoundKeyframeProperty, CompoundValue } from '../../types';
import { getPropertyConfig, getKeyframeStatus, isCompoundProperty, isCompoundValue, PROPERTY_CONFIGS } from '../../types';

// ==================== 调试开关 ====================
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log(...args); };

// ==========================================
// CompoundKeyframeControls - 复合属性关键帧控制
// 适用于 position (x,y) 和 scale (x,y)
// ==========================================

interface CompoundKeyframeControlsProps {
  /** 目标 clip ID */
  clipId: string;
  /** 复合关键帧属性 (position 或 scale) */
  property: CompoundKeyframeProperty;
  /** 当前复合值 {x, y} */
  currentValue: CompoundValue;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * ★ 新增：复合属性关键帧控制按钮组
 * 一个按钮同时添加/删除包含 x,y 两个分量的关键帧
 */
export function CompoundKeyframeControls({
  clipId,
  property,
  currentValue,
  disabled = false,
}: CompoundKeyframeControlsProps) {
  const currentTime = useEditorStore((s) => s.currentTime);
  const clips = useEditorStore((s) => s.clips);
  const keyframes = useEditorStore((s) => s.keyframes);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const deleteKeyframe = useEditorStore((s) => s.deleteKeyframe);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);

  // 获取当前 clip
  const clip = useMemo(() => clips.find(c => c.id === clipId), [clips, clipId]);
  
  // 计算当前 offset (0-1)
  const currentOffset = useMemo(() => {
    if (!clip || clip.duration <= 0) return 0;
    const relativeTime = currentTime - clip.start;
    return Math.max(0, Math.min(1, relativeTime / clip.duration));
  }, [currentTime, clip]);

  // 检查播放头是否在 clip 范围内
  const isInRange = useMemo(() => {
    if (!clip) return false;
    return currentTime >= clip.start && currentTime <= clip.start + clip.duration;
  }, [currentTime, clip]);

  // 获取该复合属性的所有关键帧
  const propertyKeyframes = useMemo(() => {
    const clipMap = keyframes.get(clipId);
    if (!clipMap) return [];
    return clipMap.get(property) || [];
  }, [keyframes, clipId, property]);

  // 检查关键帧状态
  const { status, activeKeyframe, count } = useMemo(() => {
    return getKeyframeStatus(propertyKeyframes, currentOffset);
  }, [propertyKeyframes, currentOffset]);

  // 添加复合关键帧
  const handleAdd = useCallback(() => {
    if (disabled || !clip || !isInRange) return;
    
    saveToHistory();
    
    debugLog('[CompoundKeyframe] ADD:', {
      property,
      currentTime,
      clipStart: clip.start,
      clipDuration: clip.duration,
      offset: currentOffset,
      value: currentValue,
    });
    
    // 添加复合属性关键帧（值为 {x, y} 对象）
    addKeyframe(clipId, property, currentOffset, currentValue);
  }, [disabled, clip, isInRange, saveToHistory, addKeyframe, clipId, property, currentOffset, currentValue, currentTime]);

  // 删除复合关键帧
  const handleDelete = useCallback(() => {
    if (disabled || !activeKeyframe) return;
    
    saveToHistory();
    
    debugLog('[CompoundKeyframe] DELETE:', activeKeyframe.id);
    
    deleteKeyframe(activeKeyframe.id);
  }, [disabled, activeKeyframe, saveToHistory, deleteKeyframe]);

  const config = PROPERTY_CONFIGS[property];
  const isDisabled = disabled || !isInRange;
  const hasKeyframeAtCurrent = status === 'active';

  return (
    <div className="flex items-center gap-1">
      {/* 添加按钮 */}
      <button
        type="button"
        onClick={handleAdd}
        disabled={isDisabled}
        className={`px-2 py-1 text-[10px] font-medium rounded flex items-center gap-1 transition-colors
          ${isDisabled 
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
            : 'bg-gray-700 text-white hover:bg-gray-600'}`}
        title={`添加${config?.label || property}关键帧`}
      >
        <Plus size={10} />
        添加
      </button>

      {/* 删除按钮 */}
      <button
        type="button"
        onClick={handleDelete}
        disabled={isDisabled || !hasKeyframeAtCurrent}
        className={`px-2 py-1 text-[10px] font-medium rounded flex items-center gap-1 transition-colors
          ${isDisabled || !hasKeyframeAtCurrent 
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        title={!hasKeyframeAtCurrent ? '当前位置没有关键帧' : `删除${config?.label || property}关键帧`}
      >
        <Minus size={10} />
        删除
      </button>

      {/* 关键帧计数 */}
      {count > 0 && (
        <span className="text-[10px] text-gray-500 flex items-center gap-0.5 ml-1">
          <Diamond size={8} className="fill-current" />
          {count}
        </span>
      )}
    </div>
  );
}

// ==========================================
// KeyframeAddDeleteButtons - 简洁的添加/删除两个按钮
// ==========================================

interface KeyframeAddDeleteButtonsProps {
  /** 目标 clip ID */
  clipId: string;
  /** 关键帧属性 */
  property: KeyframeProperty;
  /** 当前属性值 */
  currentValue: number;
  /** 联动属性 - 添加/删除关键帧时会同时操作这些属性 */
  linkedProperties?: KeyframeProperty[];
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 简洁的添加/删除关键帧按钮组
 * [ + 添加 ] [ - 删除 ] [计数]
 */
export function KeyframeAddDeleteButtons({
  clipId,
  property,
  currentValue,
  linkedProperties,
  disabled = false,
}: KeyframeAddDeleteButtonsProps) {
  const currentTime = useEditorStore((s) => s.currentTime);
  const clips = useEditorStore((s) => s.clips);
  const keyframes = useEditorStore((s) => s.keyframes);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const deleteKeyframe = useEditorStore((s) => s.deleteKeyframe);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);

  // 获取当前 clip
  const clip = useMemo(() => clips.find(c => c.id === clipId), [clips, clipId]);
  
  // 计算当前 offset (0-1)
  const currentOffset = useMemo(() => {
    if (!clip || clip.duration <= 0) return 0;
    const relativeTime = currentTime - clip.start;
    return Math.max(0, Math.min(1, relativeTime / clip.duration));
  }, [currentTime, clip]);

  // 检查播放头是否在 clip 范围内
  const isInRange = useMemo(() => {
    if (!clip) return false;
    return currentTime >= clip.start && currentTime <= clip.start + clip.duration;
  }, [currentTime, clip]);

  // 获取该属性的所有关键帧
  const propertyKeyframes = useMemo(() => {
    const clipMap = keyframes.get(clipId);
    if (!clipMap) return [];
    return clipMap.get(property) || [];
  }, [keyframes, clipId, property]);

  // 获取联动属性当前位置的关键帧
  const linkedKeyframesAtOffset = useMemo(() => {
    if (!linkedProperties || linkedProperties.length === 0) return [];
    const clipMap = keyframes.get(clipId);
    if (!clipMap) return [];
    
    const TOLERANCE = 0.005;
    const result: { property: KeyframeProperty; keyframe: Keyframe }[] = [];
    
    for (const prop of linkedProperties) {
      const kfs = clipMap.get(prop) || [];
      const kf = kfs.find(k => Math.abs(k.offset - currentOffset) <= TOLERANCE);
      if (kf) {
        result.push({ property: prop, keyframe: kf });
      }
    }
    
    return result;
  }, [linkedProperties, keyframes, clipId, currentOffset]);

  // 检查关键帧状态
  const { status, activeKeyframe, count } = useMemo(() => {
    return getKeyframeStatus(propertyKeyframes, currentOffset);
  }, [propertyKeyframes, currentOffset]);

  // 添加关键帧
  const handleAdd = useCallback(() => {
    if (disabled || !clip || !isInRange) return;
    
    saveToHistory();
    
    debugLog('[KeyframeButtons] ADD:', {
      property,
      currentTime,
      clipStart: clip.start,
      clipDuration: clip.duration,
      offset: currentOffset,
      value: currentValue,
    });
    
    // 添加主属性关键帧
    addKeyframe(clipId, property, currentOffset, currentValue);
    
    // 添加联动属性关键帧
    if (linkedProperties) {
      for (const prop of linkedProperties) {
        addKeyframe(clipId, prop, currentOffset, currentValue);
      }
    }
  }, [disabled, clip, isInRange, saveToHistory, addKeyframe, clipId, property, currentOffset, currentValue, linkedProperties, currentTime]);

  // 删除关键帧
  const handleDelete = useCallback(() => {
    if (disabled || !activeKeyframe) return;
    
    saveToHistory();
    
    debugLog('[KeyframeButtons] DELETE:', activeKeyframe.id);
    
    // 删除主属性关键帧
    deleteKeyframe(activeKeyframe.id);
    
    // 删除联动属性关键帧
    for (const { keyframe } of linkedKeyframesAtOffset) {
      deleteKeyframe(keyframe.id);
    }
  }, [disabled, activeKeyframe, saveToHistory, deleteKeyframe, linkedKeyframesAtOffset]);

  const config = getPropertyConfig(property);
  const isDisabled = disabled || !isInRange;
  const hasKeyframeAtCurrent = status === 'active';

  return (
    <div className="flex items-center gap-1">
      {/* 添加按钮 */}
      <button
        type="button"
        onClick={handleAdd}
        disabled={isDisabled}
        className={`px-2 py-1 text-[10px] font-medium rounded flex items-center gap-1 transition-colors
          ${isDisabled 
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
            : 'bg-gray-700 text-white hover:bg-gray-600'}`}
        title={`添加关键帧 (${config?.label || property})`}
      >
        <Plus size={10} />
        添加
      </button>

      {/* 删除按钮 */}
      <button
        type="button"
        onClick={handleDelete}
        disabled={isDisabled || !hasKeyframeAtCurrent}
        className={`px-2 py-1 text-[10px] font-medium rounded flex items-center gap-1 transition-colors
          ${isDisabled || !hasKeyframeAtCurrent 
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        title={!hasKeyframeAtCurrent ? '当前位置没有关键帧' : `删除关键帧 (${config?.label || property})`}
      >
        <Minus size={10} />
        删除
      </button>

      {/* 关键帧计数 */}
      {count > 0 && (
        <span className="text-[10px] text-gray-500 flex items-center gap-0.5 ml-1">
          <Diamond size={8} className="fill-current" />
          {count}
        </span>
      )}
    </div>
  );
}
