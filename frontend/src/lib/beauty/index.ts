/**
 * 美颜美体系统
 * MediaPipe + WebGL 实现
 * 
 * @example
 * ```tsx
 * import { useVideoBeauty, BEAUTY_PRESETS, FILTER_PRESETS } from '@/lib/beauty';
 * 
 * function VideoEditor() {
 *   const {
 *     outputCanvasRef,
 *     isReady,
 *     startProcessing,
 *     stopProcessing,
 *     setBeautySettings,
 *     applyPreset,
 *   } = useVideoBeauty({ enabled: true });
 *   
 *   // 开始处理视频
 *   const handleVideoLoad = (video: HTMLVideoElement) => {
 *     startProcessing(video);
 *   };
 *   
 *   // 应用美颜预设
 *   const handlePresetClick = (presetId: string) => {
 *     applyPreset(presetId);
 *   };
 *   
 *   // 调整单个参数
 *   const handleSmoothChange = (value: number) => {
 *     setBeautySettings({ smoothSkin: value });
 *   };
 *   
 *   return (
 *     <div>
 *       <canvas ref={outputCanvasRef} />
 *       {BEAUTY_PRESETS.map(preset => (
 *         <button key={preset.id} onClick={() => handlePresetClick(preset.id)}>
 *           {preset.icon} {preset.name}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */

// 类型导出
export * from './types';

// 常量导出
export {
  DEFAULT_BEAUTY_SETTINGS,
  DEFAULT_BODY_SETTINGS,
  DEFAULT_FILTER_SETTINGS,
  DEFAULT_PROCESSOR_CONFIG,
  BEAUTY_PRESETS,
  FILTER_PRESETS,
  FACE_OVAL_INDICES,
  LEFT_EYE_INDICES,
  RIGHT_EYE_INDICES,
  LEFT_EYEBROW_INDICES,
  RIGHT_EYEBROW_INDICES,
  NOSE_INDICES,
  LIPS_INDICES,
  CHIN_INDICES,
  CHEEKBONE_INDICES,
  POSE_LANDMARK_INDICES,
  MODEL_PATHS,
  WASM_PATH,
  PERFORMANCE_CONFIG,
} from './constants';

// 核心模块导出
export {
  FaceDetector,
  PoseDetector,
  WebGLRenderer,
  BeautyProcessor,
} from './core';

// Hooks导出
export {
  useBeautyProcessor,
  useVideoBeauty,
} from './hooks';

export type {
  UseBeautyProcessorOptions,
  UseBeautyProcessorReturn,
  UseVideoBeautyOptions,
  UseVideoBeautyReturn,
} from './hooks';

// 着色器导出
export { BEAUTY_SHADERS } from './shaders';
