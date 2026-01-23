/**
 * 关键帧插值算法 V3
 * 支持复合属性（position/scale 同时控制 x,y）
 */

import type { CSSProperties } from 'react';
import type { 
  Keyframe, 
  EasingType, 
  KeyframeProperty, 
  CompoundValue,
  CompoundKeyframeProperty,
  LegacyKeyframeProperty 
} from '../types';
import { 
  PROPERTY_CONFIGS, 
  isCompoundProperty, 
  isCompoundValue,
  LEGACY_PROPERTY_MAP,
  getPropertyDefaultValue as getTypeDefaultValue
} from '../types';

// ========== 缓动函数 ==========

/**
 * 应用缓动函数
 * @param t 进度 (0-1)
 * @param easing 缓动类型
 * @returns 缓动后的进度 (0-1)
 */
export function applyEasing(t: number, easing: EasingType): number {
  switch (easing) {
    case 'ease_in':
      return t * t;
    case 'ease_out':
      return 1 - (1 - t) * (1 - t);
    case 'ease_in_out':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    case 'hold':
      return 0; // 保持前值
    default: // linear
      return t;
  }
}

/**
 * 缓动类型的显示名称
 */
export const EASING_LABELS: Record<EasingType, string> = {
  linear: '线性',
  ease_in: '缓入',
  ease_out: '缓出',
  ease_in_out: '缓入缓出',
  hold: '保持',
};

// ========== 简单值插值 ==========

/**
 * 精度常量：4位小数，足够视觉平滑且避免浮点误差累积
 * 例如：缩放 1.0001 和位置 0.0001 像素的精度
 */
const PRECISION = 4;
const PRECISION_FACTOR = Math.pow(10, PRECISION);

/**
 * 高精度四舍五入，消除浮点误差
 */
function roundToPrecision(value: number): number {
  return Math.round(value * PRECISION_FACTOR) / PRECISION_FACTOR;
}

/**
 * 计算两个数值之间的插值
 * 使用高精度四舍五入确保动画平滑
 */
function interpolateNumber(
  v1: number,
  v2: number,
  progress: number,
  easing: EasingType
): number {
  if (easing === 'hold') return v1;
  const easedProgress = applyEasing(progress, easing);
  const result = v1 + (v2 - v1) * easedProgress;
  return roundToPrecision(result);
}

/**
 * 计算两个复合值之间的插值
 * 使用高精度四舍五入确保动画平滑
 */
function interpolateCompound(
  v1: CompoundValue,
  v2: CompoundValue,
  progress: number,
  easing: EasingType
): CompoundValue {
  if (easing === 'hold') return v1;
  const easedProgress = applyEasing(progress, easing);
  return {
    x: roundToPrecision(v1.x + (v2.x - v1.x) * easedProgress),
    y: roundToPrecision(v1.y + (v2.y - v1.y) * easedProgress),
  };
}

// ========== 通用关键帧插值 ==========

// ★ DEBUG 开关（调试时设为 true）
const DEBUG_INTERPOLATION = false;
function debugLog(...args: unknown[]) {
  if (DEBUG_INTERPOLATION) {
    console.log('[KF-Interpolate]', ...args);
  }
}

/**
 * 计算两个关键帧之间的插值（支持简单值和复合值）
 */
export function interpolateKeyframes(
  kf1: Keyframe,
  kf2: Keyframe,
  offset: number
): number | CompoundValue {
  // 边界情况
  if (offset <= kf1.offset) return kf1.value;
  if (offset >= kf2.offset) return kf2.value;
  
  // 计算进度 (0-1)
  const progress = (offset - kf1.offset) / (kf2.offset - kf1.offset);
  
  // 根据值类型选择插值方式
  if (isCompoundValue(kf1.value) && isCompoundValue(kf2.value)) {
    const result = interpolateCompound(kf1.value, kf2.value, progress, kf1.easing);
    debugLog('compound interpolate:', { 
      from: kf1.value, 
      to: kf2.value, 
      progress: progress.toFixed(3), 
      result 
    });
    return result;
  }
  
  const result = interpolateNumber(kf1.value as number, kf2.value as number, progress, kf1.easing);
  debugLog('number interpolate:', { 
    from: kf1.value, 
    to: kf2.value, 
    progress: progress.toFixed(3), 
    result 
  });
  return result;
}

/**
 * 获取指定 offset 位置的属性值
 * @param keyframes - 该属性的所有关键帧
 * @param offset - 归一化时间 (0-1)
 * @param defaultValue - 默认值
 */
export function getValueAtOffset<T extends number | CompoundValue>(
  keyframes: Keyframe[],
  offset: number,
  defaultValue: T
): T {
  debugLog('getValueAtOffset called:', { 
    keyframeCount: keyframes.length, 
    offset: offset.toFixed(4),
    keyframes: keyframes.map(kf => ({ offset: kf.offset, value: kf.value }))
  });
  
  if (keyframes.length === 0) return defaultValue;
  if (keyframes.length === 1) return keyframes[0].value as T;
  
  // 确保按 offset 排序
  const sorted = [...keyframes].sort((a, b) => a.offset - b.offset);
  
  debugLog('sorted keyframes:', sorted.map(kf => ({ offset: kf.offset, value: kf.value })));
  
  // 超出范围：使用边界值
  if (offset <= sorted[0].offset) {
    debugLog('offset <= first keyframe, returning first value:', sorted[0].value);
    return sorted[0].value as T;
  }
  if (offset >= sorted[sorted.length - 1].offset) {
    debugLog('offset >= last keyframe, returning last value:', sorted[sorted.length - 1].value);
    return sorted[sorted.length - 1].value as T;
  }
  
  // 找到 offset 所在的区间
  for (let i = 0; i < sorted.length - 1; i++) {
    const inRange = offset >= sorted[i].offset && offset <= sorted[i + 1].offset;
    debugLog(`checking interval ${i}: [${sorted[i].offset}, ${sorted[i + 1].offset}], offset=${offset}, inRange=${inRange}`);
    if (inRange) {
      debugLog(`found interval: kf${i} -> kf${i+1}`);
      return interpolateKeyframes(sorted[i], sorted[i + 1], offset) as T;
    }
  }
  
  debugLog('no interval found, returning default');
  return defaultValue;
}

/**
 * 获取属性的默认值
 */
export function getPropertyDefaultValue(property: KeyframeProperty): number | CompoundValue {
  return getTypeDefaultValue(property);
}

// ========== Clip 变换计算 ==========

/**
 * Clip 变换属性 (所有属性可为 undefined，表示没有关键帧)
 */
export interface ClipTransform {
  positionX?: number;
  positionY?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  opacity?: number;
  volume?: number;
  pan?: number;
}

/**
 * 根据关键帧计算 clip 在指定 offset 的完整变换
 * 支持新的复合属性（position/scale）和旧的分离属性（兼容模式）
 * @param keyframesByProperty - 按属性分组的关键帧 Map
 * @param offset - 归一化时间 (0-1)
 */
export function getClipTransformAtOffset(
  keyframesByProperty: Map<string, Keyframe[]> | undefined,
  offset: number
): ClipTransform {
  const result: ClipTransform = {};
  
  if (!keyframesByProperty) {
    debugLog('getClipTransformAtOffset: no keyframes map');
    return result;
  }
  
  debugLog('getClipTransformAtOffset called:', {
    offset: offset.toFixed(4),
    properties: Array.from(keyframesByProperty.keys()),
    scaleKfsCount: keyframesByProperty.get('scale')?.length ?? 0,
    positionKfsCount: keyframesByProperty.get('position')?.length ?? 0,
  });
  
  // ★ 新版复合属性优先
  const positionKfs = keyframesByProperty.get('position');
  if (positionKfs && positionKfs.length > 0) {
    const defaultPos = getPropertyDefaultValue('position') as CompoundValue;
    const pos = getValueAtOffset(positionKfs, offset, defaultPos);
    result.positionX = (pos as CompoundValue).x;
    result.positionY = (pos as CompoundValue).y;
    debugLog('position result:', { x: result.positionX, y: result.positionY });
  }
  
  const scaleKfs = keyframesByProperty.get('scale');
  if (scaleKfs && scaleKfs.length > 0) {
    const defaultScale = getPropertyDefaultValue('scale') as CompoundValue;
    const scale = getValueAtOffset(scaleKfs, offset, defaultScale);
    result.scaleX = (scale as CompoundValue).x;
    result.scaleY = (scale as CompoundValue).y;
    debugLog('scale result:', { x: result.scaleX, y: result.scaleY });
  }
  
  // ★ 兼容旧版分离属性（如果没有新版属性）
  if (result.positionX === undefined) {
    const kfs = keyframesByProperty.get('position_x');
    if (kfs && kfs.length > 0) {
      result.positionX = getValueAtOffset(kfs, offset, 0);
    }
  }
  if (result.positionY === undefined) {
    const kfs = keyframesByProperty.get('position_y');
    if (kfs && kfs.length > 0) {
      result.positionY = getValueAtOffset(kfs, offset, 0);
    }
  }
  if (result.scaleX === undefined) {
    const kfs = keyframesByProperty.get('scale_x');
    if (kfs && kfs.length > 0) {
      result.scaleX = getValueAtOffset(kfs, offset, 1);
    }
  }
  if (result.scaleY === undefined) {
    const kfs = keyframesByProperty.get('scale_y');
    if (kfs && kfs.length > 0) {
      result.scaleY = getValueAtOffset(kfs, offset, 1);
    }
  }
  
  // ★ 简单属性
  const rotationKfs = keyframesByProperty.get('rotation');
  if (rotationKfs && rotationKfs.length > 0) {
    result.rotation = getValueAtOffset(rotationKfs, offset, 0);
  }
  
  const opacityKfs = keyframesByProperty.get('opacity');
  if (opacityKfs && opacityKfs.length > 0) {
    result.opacity = getValueAtOffset(opacityKfs, offset, 1);
  }
  
  const volumeKfs = keyframesByProperty.get('volume');
  if (volumeKfs && volumeKfs.length > 0) {
    result.volume = getValueAtOffset(volumeKfs, offset, 1);
  }
  
  const panKfs = keyframesByProperty.get('pan');
  if (panKfs && panKfs.length > 0) {
    result.pan = getValueAtOffset(panKfs, offset, 0);
  }
  
  return result;
}

/**
 * 将 ClipTransform 转换为 CSS transform 样式
 */
export function transformToCSS(transform: ClipTransform): CSSProperties {
  const { 
    positionX = 0, 
    positionY = 0, 
    scaleX = 1, 
    scaleY = 1, 
    rotation = 0, 
    opacity = 1 
  } = transform;
  
  const transforms: string[] = [];
  
  if (positionX !== 0 || positionY !== 0) {
    transforms.push(`translate(${positionX}px, ${positionY}px)`);
  }
  
  if (rotation !== 0) {
    transforms.push(`rotate(${rotation}deg)`);
  }
  
  if (scaleX !== 1 || scaleY !== 1) {
    transforms.push(`scale(${scaleX}, ${scaleY})`);
  }
  
  const style: CSSProperties = {};
  
  if (transforms.length > 0) {
    style.transform = transforms.join(' ');
  }
  
  if (opacity !== 1) {
    style.opacity = opacity;
  }
  
  return style;
}
