// ==========================================
// 关键帧系统类型 V3 (Keyframe System Types)
// 重构：复合属性关键帧（position/scale 共用一个关键帧）
// ==========================================

/**
 * 复合关键帧属性（一个关键帧同时控制多个值）
 * - position: 同时控制 x 和 y
 * - scale: 同时控制 scaleX 和 scaleY（支持等比/非等比）
 */
export type CompoundKeyframeProperty = 
  | 'position'     // 位置 (x, y) - 像素值
  | 'scale';       // 缩放 (x, y) - 比例值

/**
 * 简单关键帧属性（一个关键帧只控制一个值）
 */
export type SimpleKeyframeProperty = 
  | 'rotation'     // 旋转 (-360~360°)
  | 'opacity'      // 不透明度 (0-1)
  | 'volume'       // 音量 (0-2)
  | 'pan';         // 声像 (-1~1)

/**
 * 所有关键帧属性（复合 + 简单）
 */
export type KeyframeProperty = CompoundKeyframeProperty | SimpleKeyframeProperty;

/**
 * 兼容旧属性名（渐进式迁移）
 * @deprecated 使用 CompoundKeyframeProperty 代替
 */
export type LegacyKeyframeProperty = 
  | 'scale_x' | 'scale_y' 
  | 'position_x' | 'position_y';

/**
 * 插值类型
 */
export type EasingType = 
  | 'linear'       // 线性
  | 'ease_in'      // 缓入（慢→快）
  | 'ease_out'     // 缓出（快→慢）
  | 'ease_in_out'  // 缓入缓出
  | 'hold';        // 保持（不插值，跳变）

/**
 * 复合关键帧值（支持 x/y 两个分量）
 */
export interface CompoundValue {
  x: number;
  y: number;
}

/**
 * 关键帧数据结构 V3
 * - 复合属性使用 CompoundValue
 * - 简单属性使用 number
 */
export interface Keyframe {
  id: string;
  clipId: string;
  property: KeyframeProperty;
  offset: number;          // 归一化时间 0.0-1.0
  value: number | CompoundValue;  // 简单值或复合值
  easing: EasingType;
}

/**
 * 类型守卫：检查是否为复合属性
 */
export function isCompoundProperty(property: KeyframeProperty | LegacyKeyframeProperty): property is CompoundKeyframeProperty {
  return property === 'position' || property === 'scale';
}

/**
 * 类型守卫：检查是否为复合值
 */
export function isCompoundValue(value: number | CompoundValue): value is CompoundValue {
  return typeof value === 'object' && 'x' in value && 'y' in value;
}

/**
 * 获取关键帧的数值（兼容简单值和复合值）
 */
export function getKeyframeNumericValue(keyframe: Keyframe, component?: 'x' | 'y'): number {
  if (isCompoundValue(keyframe.value)) {
    return component === 'y' ? keyframe.value.y : keyframe.value.x;
  }
  return keyframe.value;
}

/**
 * 属性配置（用于 UI 显示）
 */
export interface PropertyConfig {
  property: KeyframeProperty;
  label: string;
  isCompound: boolean;
  // 复合属性的分量配置
  xConfig?: { label: string; min: number; max: number; step: number; defaultValue: number; format: (v: number) => string };
  yConfig?: { label: string; min: number; max: number; step: number; defaultValue: number; format: (v: number) => string };
  // 简单属性的配置
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number | CompoundValue;
  format?: (v: number) => string;
  category: 'transform' | 'visual' | 'audio';
}

/**
 * 属性配置表
 */
export const PROPERTY_CONFIGS: Record<KeyframeProperty, PropertyConfig> = {
  // ★ 复合属性
  position: {
    property: 'position',
    label: '位置',
    isCompound: true,
    xConfig: { label: 'X', min: -1920, max: 1920, step: 1, defaultValue: 0, format: v => `${Math.round(v)}` },
    yConfig: { label: 'Y', min: -1080, max: 1080, step: 1, defaultValue: 0, format: v => `${Math.round(v)}` },
    defaultValue: { x: 0, y: 0 },
    category: 'transform',
  },
  scale: {
    property: 'scale',
    label: '缩放',
    isCompound: true,
    xConfig: { label: 'X', min: 0.1, max: 5, step: 0.01, defaultValue: 1, format: v => `${Math.round(v * 100)}%` },
    yConfig: { label: 'Y', min: 0.1, max: 5, step: 0.01, defaultValue: 1, format: v => `${Math.round(v * 100)}%` },
    defaultValue: { x: 1, y: 1 },
    category: 'transform',
  },
  // ★ 简单属性
  rotation: {
    property: 'rotation',
    label: '旋转',
    isCompound: false,
    min: -360, max: 360, step: 1, defaultValue: 0,
    format: v => `${Math.round(v)}°`,
    category: 'transform',
  },
  opacity: {
    property: 'opacity',
    label: '不透明度',
    isCompound: false,
    min: 0, max: 1, step: 0.01, defaultValue: 1,
    format: v => `${Math.round(v * 100)}%`,
    category: 'visual',
  },
  volume: {
    property: 'volume',
    label: '音量',
    isCompound: false,
    min: 0, max: 2, step: 0.01, defaultValue: 1,
    format: v => `${Math.round(v * 100)}%`,
    category: 'audio',
  },
  pan: {
    property: 'pan',
    label: '声像',
    isCompound: false,
    min: -1, max: 1, step: 0.01, defaultValue: 0,
    format: v => v < 0 ? `左${Math.round(-v*100)}%` : v > 0 ? `右${Math.round(v*100)}%` : '中央',
    category: 'audio',
  },
};

/**
 * 旧属性名映射到新复合属性
 */
export const LEGACY_PROPERTY_MAP: Record<LegacyKeyframeProperty, { compound: CompoundKeyframeProperty; component: 'x' | 'y' }> = {
  position_x: { compound: 'position', component: 'x' },
  position_y: { compound: 'position', component: 'y' },
  scale_x: { compound: 'scale', component: 'x' },
  scale_y: { compound: 'scale', component: 'y' },
};

/**
 * 获取属性配置
 */
export function getPropertyConfig(property: KeyframeProperty): PropertyConfig {
  return PROPERTY_CONFIGS[property];
}

/**
 * 获取属性默认值
 */
export function getPropertyDefaultValue(property: KeyframeProperty): number | CompoundValue {
  const config = PROPERTY_CONFIGS[property];
  return config.defaultValue ?? (config.isCompound ? { x: 0, y: 0 } : 0);
}

/**
 * 关键帧状态类型
 * - none: 此属性无关键帧
 * - active: 播放头正好在关键帧位置
 * - between: 播放头在两个关键帧之间
 */
export type KeyframeStatus = 'none' | 'active' | 'between';

/**
 * 关键帧检测容差常量
 */
export const KEYFRAME_TOLERANCE = {
  /** 检测是否在关键帧上的容差（2%，10 秒 clip = ±200ms） */
  DETECTION: 0.02,
  /** 创建关键帧的最小距离（1%，10 秒 clip = 100ms） */
  MIN_DISTANCE: 0.01,
  /** 保存到数据库时的精度 */
  SAVE_PRECISION: 0.005,
};

/**
 * 检查属性在指定 offset 的关键帧状态
 * @param keyframes 关键帧列表
 * @param offset 当前 offset (0-1)
 * @param tolerance 容差（默认使用 KEYFRAME_TOLERANCE.DETECTION）
 */
export function getKeyframeStatus(
  keyframes: Keyframe[],
  offset: number,
  tolerance: number = KEYFRAME_TOLERANCE.DETECTION
): { status: KeyframeStatus; activeKeyframe?: Keyframe; count: number } {
  if (keyframes.length === 0) {
    return { status: 'none', count: 0 };
  }

  // 检查是否正好在关键帧上（使用较大的容差使检测更容易）
  const activeKeyframe = keyframes.find(
    kf => Math.abs(kf.offset - offset) <= tolerance
  );

  if (activeKeyframe) {
    return { status: 'active', activeKeyframe, count: keyframes.length };
  }

  // 有关键帧但不在关键帧位置 = between
  return { status: 'between', count: keyframes.length };
}

/**
 * 检查是否可以在指定 offset 创建关键帧
 * @param keyframes 现有关键帧列表
 * @param offset 要创建的 offset
 * @param minDistance 最小距离（默认使用 KEYFRAME_TOLERANCE.MIN_DISTANCE）
 * @returns { canCreate, reason, nearestKeyframe }
 */
export function canCreateKeyframe(
  keyframes: Keyframe[],
  offset: number,
  minDistance: number = KEYFRAME_TOLERANCE.MIN_DISTANCE
): { canCreate: boolean; reason?: string; nearestKeyframe?: Keyframe } {
  if (keyframes.length === 0) {
    return { canCreate: true };
  }

  // 找到最近的关键帧
  let nearestKeyframe: Keyframe | undefined;
  let minDist = Infinity;
  
  for (const kf of keyframes) {
    const dist = Math.abs(kf.offset - offset);
    if (dist < minDist) {
      minDist = dist;
      nearestKeyframe = kf;
    }
  }

  if (minDist < minDistance) {
    return { 
      canCreate: false, 
      reason: `距离现有关键帧太近（${(minDist * 100).toFixed(1)}%）`,
      nearestKeyframe 
    };
  }

  return { canCreate: true, nearestKeyframe };
}

/**
 * 属性分组（用于 UI 分类显示）
 */
export const PROPERTY_GROUPS = {
  transform: {
    label: '变换',
    properties: ['scale_x', 'scale_y', 'position_x', 'position_y', 'rotation'] as KeyframeProperty[],
  },
  visual: {
    label: '视觉',
    properties: ['opacity'] as KeyframeProperty[],
  },
  audio: {
    label: '音频',
    properties: ['volume', 'pan'] as KeyframeProperty[],
  },
} as const;
