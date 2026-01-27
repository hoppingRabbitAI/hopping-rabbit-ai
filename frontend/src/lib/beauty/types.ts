/**
 * 美颜美体系统类型定义
 * MediaPipe + WebGL 实现
 */

// ==================== 美颜设置 ====================

/** 美颜参数 */
export interface BeautySettings {
  // 基础美颜
  smoothSkin: number;      // 磨皮 0-100
  whitening: number;       // 美白 0-100
  sharpness: number;       // 锐化 0-100
  
  // 脸型调整
  faceSlim: number;        // 瘦脸 0-100
  faceShort: number;       // 短脸 0-100
  cheekboneSlim: number;   // 瘦颧骨 0-100
  jawSlim: number;         // 瘦下颌 0-100
  foreheadHeight: number;  // 额头高度 -50 to 50
  chinLength: number;      // 下巴长度 -50 to 50
  
  // 眼部调整
  eyeEnlarge: number;      // 大眼 0-100
  eyeDistance: number;     // 眼距 -50 to 50
  eyeAngle: number;        // 眼角 -50 to 50
  
  // 鼻子调整
  noseSlim: number;        // 瘦鼻 0-100
  noseTip: number;         // 鼻头 -50 to 50
  noseBridge: number;      // 鼻梁 0-100
  
  // 嘴巴调整
  mouthSize: number;       // 嘴巴大小 -50 to 50
  lipThickness: number;    // 嘴唇厚度 -50 to 50
}

/** 美体参数 */
export interface BodySettings {
  autoBody: boolean;       // 智能美体
  slimBody: number;        // 瘦身 0-100
  longLeg: number;         // 长腿 0-100
  slimWaist: number;       // 瘦腰 0-100
  slimArm: number;         // 瘦手臂 0-100
  slimShoulder: number;    // 窄肩 0-100
  hipEnlarge: number;      // 美臀 0-100
  headSlim: number;        // 小头 0-100
}

/** 滤镜参数 */
export interface FilterSettings {
  filterId: string | null; // 当前滤镜ID
  intensity: number;       // 滤镜强度 0-100
}

/** 完整美颜配置 */
export interface BeautyConfig {
  enabled: boolean;
  beauty: BeautySettings;
  body: BodySettings;
  filter: FilterSettings;
}

// ==================== 滤镜预设 ====================

/** 滤镜类型 */
export type FilterCategory = 'natural' | 'portrait' | 'style' | 'retro';

/** 滤镜预设 */
export interface FilterPreset {
  id: string;
  name: string;
  category: FilterCategory;
  thumbnail?: string;
  // LUT数据或调整参数
  lut?: string;            // LUT图片路径
  adjustments?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    tint?: number;
    shadows?: number;
    highlights?: number;
    vibrance?: number;
  };
}

/** 美颜预设 */
export interface BeautyPreset {
  id: string;
  name: string;
  icon: string;
  settings: Partial<BeautySettings>;
}

// ==================== MediaPipe 相关 ====================

/** 人脸特征点 (478个) */
export interface FaceLandmark {
  x: number;  // 0-1 归一化坐标
  y: number;
  z: number;
}

/** 人脸检测结果 */
export interface FaceDetectionResult {
  landmarks: FaceLandmark[];
  blendshapes?: FaceBlendshape[];
  transformationMatrix?: number[];
}

/** 面部表情融合形状 */
export interface FaceBlendshape {
  categoryName: string;
  score: number;
}

/** 身体特征点 (33个) */
export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence: number;
}

/** 身体检测结果 */
export interface PoseDetectionResult {
  landmarks: PoseLandmark[];
  worldLandmarks?: PoseLandmark[];
  segmentationMask?: ImageData;
}

// ==================== 处理器相关 ====================

/** 处理模式 */
export type ProcessingMode = 'image' | 'video';

/** 处理器状态 */
export type ProcessorState = 'idle' | 'initializing' | 'ready' | 'processing' | 'error';

/** 处理器配置 */
export interface ProcessorConfig {
  mode: ProcessingMode;
  enableFaceDetection: boolean;
  enablePoseDetection: boolean;
  maxFaces: number;
  maxPoses: number;
  minDetectionConfidence: number;
  minTrackingConfidence: number;
}

/** 处理帧数据 */
export interface FrameData {
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  timestamp: number;
  width: number;
  height: number;
}

/** 处理结果 */
export interface ProcessingResult {
  outputCanvas: HTMLCanvasElement | OffscreenCanvas;
  faces: FaceDetectionResult[];
  poses: PoseDetectionResult[];
  processingTime: number;
}

// ==================== WebGL 相关 ====================

/** WebGL 着色器类型 */
export type ShaderType = 'vertex' | 'fragment';

/** WebGL 效果类型 */
export type EffectType = 
  | 'skinSmooth'    // 磨皮
  | 'whitening'     // 美白
  | 'sharpen'       // 锐化
  | 'faceWarp'      // 脸部变形
  | 'bodyWarp'      // 身体变形
  | 'lut'           // LUT滤镜
  | 'colorAdjust';  // 颜色调整

/** WebGL Uniform 参数 */
export interface ShaderUniforms {
  [key: string]: number | number[] | Float32Array | WebGLTexture | null;
}

/** WebGL 程序信息 */
export interface ProgramInfo {
  program: WebGLProgram;
  attribLocations: { [key: string]: number };
  uniformLocations: { [key: string]: WebGLUniformLocation | null };
}

// ==================== 事件类型 ====================

/** 处理器事件 */
export type ProcessorEvent = 
  | { type: 'stateChange'; state: ProcessorState }
  | { type: 'progress'; progress: number }
  | { type: 'faceDetected'; faces: FaceDetectionResult[] }
  | { type: 'poseDetected'; poses: PoseDetectionResult[] }
  | { type: 'error'; error: Error };

/** 事件监听器 */
export type ProcessorEventListener = (event: ProcessorEvent) => void;

// ==================== 工具类型 ====================

/** 2D点 */
export interface Point2D {
  x: number;
  y: number;
}

/** 3D点 */
export interface Point3D extends Point2D {
  z: number;
}

/** 矩形区域 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 变形网格点 */
export interface WarpPoint {
  original: Point2D;
  warped: Point2D;
  weight: number;
}

/** 变形区域 */
export interface WarpRegion {
  center: Point2D;
  radius: number;
  direction: Point2D;
  strength: number;
}
