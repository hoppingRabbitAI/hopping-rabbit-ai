/**
 * MediaPipe 身体姿势检测器封装
 * 检测 33 个身体特征点
 */

import {
  PoseLandmarker,
  FilesetResolver,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

import type {
  PoseDetectionResult,
  PoseLandmark,
  ProcessingMode,
} from '../types';

import { MODEL_PATHS, WASM_PATH } from '../constants';

export interface PoseDetectorOptions {
  maxPoses?: number;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
  outputSegmentationMasks?: boolean;
}

export class PoseDetector {
  private poseLandmarker: PoseLandmarker | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private mode: ProcessingMode = 'video';
  
  constructor(private options: PoseDetectorOptions = {}) {
    this.options = {
      maxPoses: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
      ...options,
    };
  }
  
  /**
   * 初始化身体检测器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }
  
  private async _doInitialize(): Promise<void> {
    try {
      console.log('[PoseDetector] 开始初始化...');
      
      // 加载 WASM 模块
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      
      // 尝试加载本地模型，失败则使用CDN
      let modelPath = MODEL_PATHS.poseLandmarker;
      try {
        const response = await fetch(modelPath, { method: 'HEAD' });
        if (!response.ok) {
          console.log('[PoseDetector] 本地模型不存在，使用CDN');
          modelPath = MODEL_PATHS.poseLandmarkerCDN;
        }
      } catch {
        console.log('[PoseDetector] 无法访问本地模型，使用CDN');
        modelPath = MODEL_PATHS.poseLandmarkerCDN;
      }
      
      // 创建身体检测器
      this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU',
        },
        runningMode: this.mode === 'video' ? 'VIDEO' : 'IMAGE',
        numPoses: this.options.maxPoses,
        minPoseDetectionConfidence: this.options.minDetectionConfidence,
        minPosePresenceConfidence: this.options.minDetectionConfidence,
        minTrackingConfidence: this.options.minTrackingConfidence,
        outputSegmentationMasks: this.options.outputSegmentationMasks,
      });
      
      this.isInitialized = true;
      console.log('[PoseDetector] 初始化完成');
    } catch (error) {
      console.error('[PoseDetector] 初始化失败:', error);
      throw error;
    }
  }
  
  /**
   * 设置运行模式
   */
  async setMode(mode: ProcessingMode): Promise<void> {
    if (this.mode === mode) return;
    
    this.mode = mode;
    
    if (this.poseLandmarker) {
      await this.poseLandmarker.setOptions({
        runningMode: mode === 'video' ? 'VIDEO' : 'IMAGE',
      });
    }
  }
  
  /**
   * 检测身体姿势
   */
  detect(
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap,
    timestamp?: number
  ): PoseDetectionResult[] {
    if (!this.poseLandmarker || !this.isInitialized) {
      console.warn('[PoseDetector] 检测器未初始化');
      return [];
    }
    
    let result: PoseLandmarkerResult;
    
    if (this.mode === 'video') {
      const ts = timestamp ?? performance.now();
      result = this.poseLandmarker.detectForVideo(source as HTMLVideoElement, ts);
    } else {
      result = this.poseLandmarker.detect(source as HTMLImageElement);
    }
    
    return this.processResult(result);
  }
  
  /**
   * 处理检测结果
   */
  private processResult(result: PoseLandmarkerResult): PoseDetectionResult[] {
    const poses: PoseDetectionResult[] = [];
    
    if (!result.landmarks || result.landmarks.length === 0) {
      return poses;
    }
    
    for (let i = 0; i < result.landmarks.length; i++) {
      const landmarks: PoseLandmark[] = result.landmarks[i].map(lm => ({
        x: lm.x,
        y: lm.y,
        z: lm.z ?? 0,
        visibility: lm.visibility ?? 0,
        presence: 1.0, // landmarks存在则presence为1
      }));
      
      const poseResult: PoseDetectionResult = {
        landmarks,
      };
      
      // 添加世界坐标
      if (result.worldLandmarks && result.worldLandmarks[i]) {
        poseResult.worldLandmarks = result.worldLandmarks[i].map(lm => ({
          x: lm.x,
          y: lm.y,
          z: lm.z ?? 0,
          visibility: lm.visibility ?? 0,
          presence: 1.0,
        }));
      }
      
      poses.push(poseResult);
    }
    
    return poses;
  }
  
  /**
   * 获取身体关键部位坐标
   */
  static getBodyPart(landmarks: PoseLandmark[], partIndex: number): PoseLandmark | null {
    if (partIndex >= 0 && partIndex < landmarks.length) {
      return landmarks[partIndex];
    }
    return null;
  }
  
  /**
   * 计算躯干中心
   */
  static calculateTorsoCenter(landmarks: PoseLandmark[]): PoseLandmark | null {
    // 使用肩膀和髋部计算躯干中心
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
      return null;
    }
    
    return {
      x: (leftShoulder.x + rightShoulder.x + leftHip.x + rightHip.x) / 4,
      y: (leftShoulder.y + rightShoulder.y + leftHip.y + rightHip.y) / 4,
      z: (leftShoulder.z + rightShoulder.z + leftHip.z + rightHip.z) / 4,
      visibility: Math.min(
        leftShoulder.visibility,
        rightShoulder.visibility,
        leftHip.visibility,
        rightHip.visibility
      ),
      presence: 1.0,
    };
  }
  
  /**
   * 计算肩宽
   */
  static calculateShoulderWidth(landmarks: PoseLandmark[]): number {
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    
    if (!leftShoulder || !rightShoulder) {
      return 0;
    }
    
    return Math.sqrt(
      Math.pow(rightShoulder.x - leftShoulder.x, 2) +
      Math.pow(rightShoulder.y - leftShoulder.y, 2)
    );
  }
  
  /**
   * 计算腰宽 (近似使用髋部)
   */
  static calculateWaistWidth(landmarks: PoseLandmark[]): number {
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    
    if (!leftHip || !rightHip) {
      return 0;
    }
    
    return Math.sqrt(
      Math.pow(rightHip.x - leftHip.x, 2) +
      Math.pow(rightHip.y - leftHip.y, 2)
    );
  }
  
  /**
   * 计算腿长比例
   */
  static calculateLegRatio(landmarks: PoseLandmark[]): number {
    const leftHip = landmarks[23];
    const leftKnee = landmarks[25];
    const leftAnkle = landmarks[27];
    
    if (!leftHip || !leftKnee || !leftAnkle) {
      return 1.0;
    }
    
    const upperLeg = Math.sqrt(
      Math.pow(leftKnee.x - leftHip.x, 2) +
      Math.pow(leftKnee.y - leftHip.y, 2)
    );
    
    const lowerLeg = Math.sqrt(
      Math.pow(leftAnkle.x - leftKnee.x, 2) +
      Math.pow(leftAnkle.y - leftKnee.y, 2)
    );
    
    return upperLeg + lowerLeg;
  }
  
  /**
   * 销毁检测器
   */
  dispose(): void {
    if (this.poseLandmarker) {
      this.poseLandmarker.close();
      this.poseLandmarker = null;
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
