'use client';

import { useMemo, useState } from 'react';
import { X, Trash2, Sliders } from 'lucide-react';
import type { Keyframe, CompoundValue } from '../../types';
import { useEditorStore } from '../../store/editor-store';
import { getPropertyConfig, isCompoundValue, isCompoundProperty } from '../../types';
import { InlineEasingSelector } from './EasingSelector';

/**
 * 格式化关键帧值（支持复合值）
 */
function formatKeyframeValue(value: number | CompoundValue, decimals = 2): string {
  if (isCompoundValue(value)) {
    return `(${value.x.toFixed(decimals)}, ${value.y.toFixed(decimals)})`;
  }
  return value.toFixed(decimals);
}

/**
 * 关键帧属性面板 (V2)
 * 显示选中关键帧的详细信息并允许编辑
 * 使用 offset (0-1) 而非 time (ms)
 */
export function KeyframePanel() {
  const selectedKeyframeIds = useEditorStore((s) => s.selectedKeyframeIds);
  const keyframes = useEditorStore((s) => s.keyframes);
  const clips = useEditorStore((s) => s.clips);
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);
  const deleteKeyframe = useEditorStore((s) => s.deleteKeyframe);
  const clearKeyframeSelection = useEditorStore((s) => s.clearKeyframeSelection);
  
  // 获取选中的关键帧
  const selectedKeyframes = useMemo(() => {
    const result: Keyframe[] = [];
    
    keyframes.forEach((clipMap) => {
      clipMap.forEach((kfList) => {
        kfList.forEach(kf => {
          if (selectedKeyframeIds.has(kf.id)) {
            result.push(kf);
          }
        });
      });
    });
    
    return result.sort((a, b) => a.offset - b.offset);
  }, [keyframes, selectedKeyframeIds]);
  
  // 没有选中关键帧时不显示
  if (selectedKeyframes.length === 0) {
    return null;
  }
  
  const singleKeyframe = selectedKeyframes.length === 1 ? selectedKeyframes[0] : null;
  const propConfig = singleKeyframe ? getPropertyConfig(singleKeyframe.property) : null;
  const isCompound = singleKeyframe ? isCompoundProperty(singleKeyframe.property) : false;
  
  // 获取关键帧所属的 clip 信息
  const clipInfo = singleKeyframe 
    ? clips.find(c => c.id === singleKeyframe.clipId)
    : null;
  
  const handleValueChange = (value: number) => {
    if (!singleKeyframe || isCompound) return;
    updateKeyframe(singleKeyframe.id, { value });
  };
  
  const handleCompoundValueChange = (component: 'x' | 'y', newVal: number) => {
    if (!singleKeyframe || !isCompoundValue(singleKeyframe.value)) return;
    const currentValue = singleKeyframe.value;
    const updatedValue: CompoundValue = {
      x: component === 'x' ? newVal : currentValue.x,
      y: component === 'y' ? newVal : currentValue.y,
    };
    updateKeyframe(singleKeyframe.id, { value: updatedValue });
  };
  
  const handleOffsetChange = (offset: number) => {
    if (!singleKeyframe) return;
    // 限制在 0-1 范围
    const clampedOffset = Math.max(0, Math.min(1, offset));
    updateKeyframe(singleKeyframe.id, { offset: clampedOffset });
  };
  
  const handleDeleteSelected = () => {
    selectedKeyframes.forEach(kf => deleteKeyframe(kf.id));
  };
  
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 mx-4 z-50">
      <div className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rotate-45 bg-blue-500" />
            <span className="text-xs font-medium text-gray-900">
              {selectedKeyframes.length === 1 
                ? `关键帧 - ${propConfig?.label || singleKeyframe?.property}` 
                : `${selectedKeyframes.length} 个关键帧`
              }
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleDeleteSelected}
              className="p-1 text-gray-400 hover:text-red-400 transition-colors"
              title="删除选中"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={clearKeyframeSelection}
              className="p-1 text-gray-400 hover:text-white transition-colors"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        
        {/* Content */}
        {singleKeyframe && propConfig && (
          <div className="p-3 space-y-3">
            {/* Clip 信息 */}
            {clipInfo && (
              <div className="text-[10px] text-gray-500">
                Clip: <span className="text-gray-300">{clipInfo.name}</span>
              </div>
            )}
            
            {/* 位置 (offset 0-100%) */}
            <div className="flex items-center gap-3">
              <label className="text-[10px] text-gray-500 w-12">位置</label>
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="number"
                  value={(singleKeyframe.offset * 100).toFixed(1)}
                  onChange={(e) => handleOffsetChange(parseFloat(e.target.value) / 100)}
                  step={0.1}
                  min={0}
                  max={100}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-500"
                />
                <span className="text-[10px] text-gray-500">%</span>
              </div>
            </div>
            
            {/* 值 - 复合属性显示 X/Y 两行 */}
            {isCompound && isCompoundValue(singleKeyframe.value) ? (
              <>
                <div className="flex items-center gap-3">
                  <label className="text-[10px] text-gray-500 w-12">X</label>
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="number"
                      value={singleKeyframe.value.x.toFixed(2)}
                      onChange={(e) => handleCompoundValueChange('x', parseFloat(e.target.value))}
                      step={propConfig.xConfig?.step ?? 0.01}
                      className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-500"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[10px] text-gray-500 w-12">Y</label>
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="number"
                      value={singleKeyframe.value.y.toFixed(2)}
                      onChange={(e) => handleCompoundValueChange('y', parseFloat(e.target.value))}
                      step={propConfig.yConfig?.step ?? 0.01}
                      className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-500"
                    />
                  </div>
                </div>
              </>
            ) : (
              /* 简单属性显示单行 */
              <div className="flex items-center gap-3">
                <label className="text-[10px] text-gray-500 w-12">值</label>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="range"
                    min={propConfig.min ?? 0}
                    max={propConfig.max ?? 100}
                    step={propConfig.step ?? 0.01}
                    value={singleKeyframe.value as number}
                    onChange={(e) => handleValueChange(parseFloat(e.target.value))}
                    className="flex-1 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-600"
                  />
                  <input
                    type="number"
                    value={(singleKeyframe.value as number).toFixed((propConfig.step ?? 1) < 1 ? 2 : 0)}
                    onChange={(e) => handleValueChange(parseFloat(e.target.value))}
                    min={propConfig.min ?? 0}
                    max={propConfig.max ?? 100}
                    step={propConfig.step ?? 0.01}
                    className="w-16 bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-500"
                  />
                </div>
              </div>
            )}
            
            {/* 缓动 */}
            <div className="flex items-center gap-3">
              <label className="text-[10px] text-gray-400 w-12">缓动</label>
              <InlineEasingSelector
                value={singleKeyframe.easing}
                onChange={(easing) => updateKeyframe(singleKeyframe.id, { easing })}
              />
            </div>
          </div>
        )}
        
        {/* 多选状态 */}
        {selectedKeyframes.length > 1 && (
          <div className="p-3">
            <div className="text-xs text-gray-600 mb-2">选中的关键帧:</div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {selectedKeyframes.map((kf) => {
                const config = getPropertyConfig(kf.property);
                return (
                  <div 
                    key={kf.id}
                    className="flex items-center justify-between px-2 py-1 bg-gray-50 rounded text-[10px]"
                  >
                    <span className="text-gray-700">{config?.label || kf.property}</span>
                    <span className="text-gray-500">
                      {formatKeyframeValue(kf.value)} @ {(kf.offset * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
