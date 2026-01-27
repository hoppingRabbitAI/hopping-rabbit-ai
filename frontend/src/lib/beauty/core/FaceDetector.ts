/**
 * MediaPipe 人脸检测器封装
 * 检测 478 个人脸特征点
 */

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

import type {
  FaceDetectionResult,
  FaceLandmark,
  ProcessingMode,
} from '../types';

import { MODEL_PATHS, WASM_PATH } from '../constants';

export interface FaceDetectorOptions {
  maxFaces?: number;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
  outputFaceBlendshapes?: boolean;
  outputFacialTransformationMatrixes?: boolean;
}

export class FaceDetector {
  private faceLandmarker: FaceLandmarker | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private mode: ProcessingMode = 'video';
  
  constructor(private options: FaceDetectorOptions = {}) {
    this.options = {
      maxFaces: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      ...options,
    };
  }
  
  /**
   * 初始化人脸检测器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }
  
  private async _doInitialize(): Promise<void> {
    try {
      console.log('[FaceDetector] 开始初始化...');
      
      // 加载 WASM 模块
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      
      // 尝试加载本地模型，失败则使用CDN
      let modelPath = MODEL_PATHS.faceLandmarker;
      try {
        const response = await fetch(modelPath, { method: 'HEAD' });
        if (!response.ok) {
          console.log('[FaceDetector] 本地模型不存在，使用CDN');
          modelPath = MODEL_PATHS.faceLandmarkerCDN;
        }
      } catch {
        console.log('[FaceDetector] 无法访问本地模型，使用CDN');
        modelPath = MODEL_PATHS.faceLandmarkerCDN;
      }
      
      // 创建人脸检测器
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU', // 使用GPU加速
        },
        runningMode: this.mode === 'video' ? 'VIDEO' : 'IMAGE',
        numFaces: this.options.maxFaces,
        minFaceDetectionConfidence: this.options.minDetectionConfidence,
        minFacePresenceConfidence: this.options.minDetectionConfidence,
        minTrackingConfidence: this.options.minTrackingConfidence,
        outputFaceBlendshapes: this.options.outputFaceBlendshapes,
        outputFacialTransformationMatrixes: this.options.outputFacialTransformationMatrixes,
      });
      
      this.isInitialized = true;
      console.log('[FaceDetector] 初始化完成');
    } catch (error) {
      console.error('[FaceDetector] 初始化失败:', error);
      throw error;
    }
  }
  
  /**
   * 设置运行模式
   */
  async setMode(mode: ProcessingMode): Promise<void> {
    if (this.mode === mode) return;
    
    this.mode = mode;
    
    if (this.faceLandmarker) {
      await this.faceLandmarker.setOptions({
        runningMode: mode === 'video' ? 'VIDEO' : 'IMAGE',
      });
    }
  }
  
  /**
   * 检测人脸
   */
  detect(
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap,
    timestamp?: number
  ): FaceDetectionResult[] {
    if (!this.faceLandmarker || !this.isInitialized) {
      console.warn('[FaceDetector] 检测器未初始化');
      return [];
    }
    
    let result: FaceLandmarkerResult;
    
    if (this.mode === 'video') {
      const ts = timestamp ?? performance.now();
      result = this.faceLandmarker.detectForVideo(source as HTMLVideoElement, ts);
    } else {
      result = this.faceLandmarker.detect(source as HTMLImageElement);
    }
    
    return this.processResult(result);
  }
  
  /**
   * 处理检测结果
   */
  private processResult(result: FaceLandmarkerResult): FaceDetectionResult[] {
    const faces: FaceDetectionResult[] = [];
    
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      return faces;
    }
    
    for (let i = 0; i < result.faceLandmarks.length; i++) {
      const landmarks: FaceLandmark[] = result.faceLandmarks[i].map(lm => ({
        x: lm.x,
        y: lm.y,
        z: lm.z ?? 0,
      }));
      
      const faceResult: FaceDetectionResult = {
        landmarks,
      };
      
      // 添加表情混合形状
      if (result.faceBlendshapes && result.faceBlendshapes[i]) {
        faceResult.blendshapes = result.faceBlendshapes[i].categories.map(cat => ({
          categoryName: cat.categoryName,
          score: cat.score,
        }));
      }
      
      // 添加变换矩阵
      if (result.facialTransformationMatrixes && result.facialTransformationMatrixes[i]) {
        faceResult.transformationMatrix = Array.from(result.facialTransformationMatrixes[i].data);
      }
      
      faces.push(faceResult);
    }
    
    return faces;
  }
  
  /**
   * 获取特定区域的特征点
   */
  static getLandmarksByIndices(
    landmarks: FaceLandmark[],
    indices: number[]
  ): FaceLandmark[] {
    return indices.map(i => landmarks[i]).filter(Boolean);
  }
  
  /**
   * 计算两点之间的距离
   */
  static calculateDistance(p1: FaceLandmark, p2: FaceLandmark): number {
    return Math.sqrt(
      Math.pow(p2.x - p1.x, 2) + 
      Math.pow(p2.y - p1.y, 2) + 
      Math.pow(p2.z - p1.z, 2)
    );
  }
  
  /**
   * 计算特征点中心
   */
  static calculateCenter(landmarks: FaceLandmark[]): FaceLandmark {
    if (landmarks.length === 0) {
      return { x: 0, y: 0, z: 0 };
    }
    
    const sum = landmarks.reduce(
      (acc, lm) => ({
        x: acc.x + lm.x,
        y: acc.y + lm.y,
        z: acc.z + lm.z,
      }),
      { x: 0, y: 0, z: 0 }
    );
    
    return {
      x: sum.x / landmarks.length,
      y: sum.y / landmarks.length,
      z: sum.z / landmarks.length,
    };
  }
  
  /**
   * 销毁检测器
   */
  dispose(): void {
    if (this.faceLandmarker) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
    }
    this.isInitialized = false;
    this.initPromise = null;
  }
  
  /**
   * 是否已初始化
   */
  get ready(): boolean {
    return this.isInitialized;
  }
}
