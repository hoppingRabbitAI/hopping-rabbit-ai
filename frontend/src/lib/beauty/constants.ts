/**
 * 美颜美体系统常量配置
 */

import type { 
  BeautySettings, 
  BodySettings, 
  FilterSettings, 
  BeautyPreset,
  FilterPreset,
  ProcessorConfig 
} from './types';

// ==================== 默认设置 ====================

/** 默认美颜设置 */
export const DEFAULT_BEAUTY_SETTINGS: BeautySettings = {
  // 基础美颜
  smoothSkin: 0,
  whitening: 0,
  sharpness: 0,
  
  // 脸型调整
  faceSlim: 0,
  faceShort: 0,
  cheekboneSlim: 0,
  jawSlim: 0,
  foreheadHeight: 0,
  chinLength: 0,
  
  // 眼部调整
  eyeEnlarge: 0,
  eyeDistance: 0,
  eyeAngle: 0,
  
  // 鼻子调整
  noseSlim: 0,
  noseTip: 0,
  noseBridge: 0,
  
  // 嘴巴调整
  mouthSize: 0,
  lipThickness: 0,
};

/** 默认美体设置 */
export const DEFAULT_BODY_SETTINGS: BodySettings = {
  autoBody: false,
  slimBody: 0,
  longLeg: 0,
  slimWaist: 0,
  slimArm: 0,
  slimShoulder: 0,
  hipEnlarge: 0,
  headSlim: 0,
};

/** 默认滤镜设置 */
export const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  filterId: null,
  intensity: 100,
};

/** 默认处理器配置 */
export const DEFAULT_PROCESSOR_CONFIG: ProcessorConfig = {
  mode: 'video',
  enableFaceDetection: true,
  enablePoseDetection: true,
  maxFaces: 1,
  maxPoses: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

// ==================== 美颜预设 ====================

export const BEAUTY_PRESETS: BeautyPreset[] = [
  {
    id: 'natural',
    name: '自然',
    icon: '🌿',
    settings: {
      smoothSkin: 30,
      whitening: 15,
      sharpness: 10,
    },
  },
  {
    id: 'sweet',
    name: '甜美',
    icon: '🍬',
    settings: {
      smoothSkin: 50,
      whitening: 30,
      sharpness: 15,
      faceSlim: 15,
      eyeEnlarge: 20,
      chinLength: -10,
    },
  },
  {
    id: 'goddess',
    name: '女神',
    icon: '👸',
    settings: {
      smoothSkin: 60,
      whitening: 40,
      sharpness: 20,
      faceSlim: 25,
      cheekboneSlim: 15,
      jawSlim: 20,
      eyeEnlarge: 30,
      noseSlim: 20,
    },
  },
  {
    id: 'handsome',
    name: '帅气',
    icon: '😎',
    settings: {
      smoothSkin: 40,
      whitening: 20,
      sharpness: 25,
      faceSlim: 10,
      jawSlim: 15,
      noseBridge: 15,
    },
  },
  {
    id: 'baby',
    name: '幼态',
    icon: '👶',
    settings: {
      smoothSkin: 70,
      whitening: 35,
      faceShort: 20,
      eyeEnlarge: 40,
      noseSlim: 25,
      chinLength: -15,
    },
  },
];

// ==================== 滤镜预设 ====================

export const FILTER_PRESETS: FilterPreset[] = [
  // 自然风格
  {
    id: 'none',
    name: '原图',
    category: 'natural',
  },
  {
    id: 'natural_fresh',
    name: '清新',
    category: 'natural',
    adjustments: {
      brightness: 5,
      contrast: 5,
      saturation: 10,
      vibrance: 15,
    },
  },
  {
    id: 'natural_warm',
    name: '暖阳',
    category: 'natural',
    adjustments: {
      temperature: 15,
      brightness: 5,
      saturation: 5,
    },
  },
  {
    id: 'natural_cool',
    name: '清冷',
    category: 'natural',
    adjustments: {
      temperature: -10,
      brightness: 3,
      contrast: 8,
    },
  },
  
  // 人像风格
  {
    id: 'portrait_soft',
    name: '柔光',
    category: 'portrait',
    adjustments: {
      brightness: 8,
      contrast: -5,
      highlights: -10,
      shadows: 10,
    },
  },
  {
    id: 'portrait_pink',
    name: '粉嫩',
    category: 'portrait',
    adjustments: {
      tint: 10,
      saturation: 15,
      brightness: 5,
    },
  },
  {
    id: 'portrait_cream',
    name: '奶油',
    category: 'portrait',
    adjustments: {
      contrast: -8,
      brightness: 10,
      saturation: -10,
      temperature: 8,
    },
  },
  
  // 风格化
  {
    id: 'style_film',
    name: '胶片',
    category: 'style',
    adjustments: {
      contrast: 15,
      saturation: -10,
      shadows: 20,
      highlights: -15,
    },
  },
  {
    id: 'style_bw',
    name: '黑白',
    category: 'style',
    adjustments: {
      saturation: -100,
      contrast: 20,
    },
  },
  {
    id: 'style_dramatic',
    name: '戏剧',
    category: 'style',
    adjustments: {
      contrast: 30,
      saturation: 15,
      shadows: -15,
      highlights: 10,
    },
  },
  
  // 复古风格
  {
    id: 'retro_vintage',
    name: '复古',
    category: 'retro',
    adjustments: {
      saturation: -15,
      contrast: 10,
      temperature: 10,
      tint: 5,
    },
  },
  {
    id: 'retro_faded',
    name: '褪色',
    category: 'retro',
    adjustments: {
      contrast: -10,
      saturation: -20,
      shadows: 25,
    },
  },
];

// ==================== MediaPipe 人脸特征点索引 ====================

/** 人脸轮廓关键点索引 */
export const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];

/** 左眼关键点索引 */
export const LEFT_EYE_INDICES = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
];

/** 右眼关键点索引 */
export const RIGHT_EYE_INDICES = [
  362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398
];

/** 左眉毛关键点索引 */
export const LEFT_EYEBROW_INDICES = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];

/** 右眉毛关键点索引 */
export const RIGHT_EYEBROW_INDICES = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];

/** 鼻子关键点索引 */
export const NOSE_INDICES = [
  1, 2, 98, 327, 4, 5, 6, 168, 197, 195, 5, 4, 
  19, 94, 2, 164, 0, 11, 12, 13, 14, 15, 16, 17, 18, 200
];

/** 嘴唇关键点索引 */
export const LIPS_INDICES = [
  // 上嘴唇外轮廓
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291,
  // 下嘴唇外轮廓
  146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
  // 内轮廓
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308
];

/** 下巴关键点索引 */
export const CHIN_INDICES = [152, 377, 400, 378, 379, 365, 397, 288, 361, 323];

/** 颧骨关键点索引 */
export const CHEEKBONE_INDICES = [
  // 左颧骨
  116, 117, 118, 119, 120, 121, 128, 245, 193, 55,
  // 右颧骨
  345, 346, 347, 348, 349, 350, 357, 465, 417, 285
];

// ==================== MediaPipe 身体特征点索引 ====================

/** 身体部位索引 */
export const POSE_LANDMARK_INDICES = {
  // 头部
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  
  // 上身
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  
  // 下身
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

// ==================== WebGL 常量 ====================

/** 顶点着色器源码 */
export const DEFAULT_VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  
  varying vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

/** 直通片段着色器 */
export const PASSTHROUGH_FRAGMENT_SHADER = `
  precision mediump float;
  
  uniform sampler2D u_texture;
  varying vec2 v_texCoord;
  
  void main() {
    gl_FragColor = texture2D(u_texture, v_texCoord);
  }
`;

// ==================== 模型路径 ====================

export const MODEL_PATHS = {
  faceLandmarker: '/models/face_landmarker.task',
  poseLandmarker: '/models/pose_landmarker.task',
  // CDN备用路径
  faceLandmarkerCDN: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  poseLandmarkerCDN: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};

/** WASM路径 */
export const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

// ==================== 性能配置 ====================

export const PERFORMANCE_CONFIG = {
  /** 目标帧率 */
  targetFPS: 30,
  /** 最大处理分辨率 */
  maxProcessingWidth: 1280,
  maxProcessingHeight: 720,
  /** 检测间隔 (每N帧检测一次) */
  detectionInterval: 2,
  /** 启用GPU加速 */
  useGPU: true,
  /** 启用Web Worker */
  useWorker: true,
};
