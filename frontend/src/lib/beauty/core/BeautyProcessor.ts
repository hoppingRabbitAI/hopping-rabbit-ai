/**
 * 美颜主处理器
 * 协调人脸检测、身体检测和WebGL渲染
 */

import type {
  BeautySettings,
  BodySettings,
  FilterSettings,
  BeautyConfig,
  FaceDetectionResult,
  PoseDetectionResult,
  ProcessorConfig,
  ProcessorState,
  ProcessorEvent,
  ProcessorEventListener,
  FrameData,
  ProcessingResult,
  WarpRegion,
  Point2D,
} from '../types';

import { FaceDetector } from './FaceDetector';
import { PoseDetector } from './PoseDetector';
import { WebGLRenderer } from './WebGLRenderer';
import { BEAUTY_SHADERS } from '../shaders';
import {
  DEFAULT_BEAUTY_SETTINGS,
  DEFAULT_BODY_SETTINGS,
  DEFAULT_FILTER_SETTINGS,
  DEFAULT_PROCESSOR_CONFIG,
  FACE_OVAL_INDICES,
  LEFT_EYE_INDICES,
  RIGHT_EYE_INDICES,
  NOSE_INDICES,
  CHIN_INDICES,
  CHEEKBONE_INDICES,
  PERFORMANCE_CONFIG,
} from '../constants';

export class BeautyProcessor {
  private faceDetector: FaceDetector;
  private poseDetector: PoseDetector;
  private renderer: WebGLRenderer;
  
  private config: ProcessorConfig;
  private beautySettings: BeautySettings;
  private bodySettings: BodySettings;
  private filterSettings: FilterSettings;
  
  private state: ProcessorState = 'idle';
  private listeners: Set<ProcessorEventListener> = new Set();
  
  private lastFaces: FaceDetectionResult[] = [];
  private lastPoses: PoseDetectionResult[] = [];
  private frameCount = 0;
  
  private processingCanvas: HTMLCanvasElement | null = null;
  private processingCtx: CanvasRenderingContext2D | null = null;
  
  constructor(config?: Partial<ProcessorConfig>) {
    this.config = { ...DEFAULT_PROCESSOR_CONFIG, ...config };
    this.beautySettings = { ...DEFAULT_BEAUTY_SETTINGS };
    this.bodySettings = { ...DEFAULT_BODY_SETTINGS };
    this.filterSettings = { ...DEFAULT_FILTER_SETTINGS };
    
    this.faceDetector = new FaceDetector({
      maxFaces: this.config.maxFaces,
      minDetectionConfidence: this.config.minDetectionConfidence,
      minTrackingConfidence: this.config.minTrackingConfidence,
    });
    
    this.poseDetector = new PoseDetector({
      maxPoses: this.config.maxPoses,
      minDetectionConfidence: this.config.minDetectionConfidence,
      minTrackingConfidence: this.config.minTrackingConfidence,
    });
    
    this.renderer = new WebGLRenderer(
      PERFORMANCE_CONFIG.maxProcessingWidth,
      PERFORMANCE_CONFIG.maxProcessingHeight
    );
  }
  
  /**
   * 初始化处理器
   */
  async initialize(): Promise<void> {
    if (this.state !== 'idle') return;
    
    this.setState('initializing');
    
    try {
      // 并行初始化各组件
      const initTasks: Promise<void | boolean>[] = [];
      
      if (this.config.enableFaceDetection) {
        initTasks.push(this.faceDetector.initialize());
      }
      
      if (this.config.enablePoseDetection) {
        initTasks.push(this.poseDetector.initialize());
      }
      
      initTasks.push(Promise.resolve(this.renderer.initialize()));
      
      await Promise.all(initTasks);
      
      // 编译着色器程序
      this.compileShaders();
      
      // 创建处理用的Canvas
      this.processingCanvas = document.createElement('canvas');
      this.processingCtx = this.processingCanvas.getContext('2d');
      
      this.setState('ready');
      console.log('[BeautyProcessor] 初始化完成');
    } catch (error) {
      this.setState('error');
      console.error('[BeautyProcessor] 初始化失败:', error);
      throw error;
    }
  }
  
  /**
   * 编译所有着色器程序
   */
  private compileShaders(): void {
    // 磨皮程序
    this.renderer.compileProgram(
      'skinSmooth',
      BEAUTY_SHADERS.vertex,
      BEAUTY_SHADERS.skinSmooth
    );
    
    // 美白程序
    this.renderer.compileProgram(
      'whitening',
      BEAUTY_SHADERS.vertex,
      BEAUTY_SHADERS.whitening
    );
    
    // 锐化程序
    this.renderer.compileProgram(
      'sharpen',
      BEAUTY_SHADERS.vertex,
      BEAUTY_SHADERS.sharpen
    );
    
    // 颜色调整程序
    this.renderer.compileProgram(
      'colorAdjust',
      BEAUTY_SHADERS.vertex,
      BEAUTY_SHADERS.colorAdjust
    );
    
    // 单点变形程序
    this.renderer.compileProgram(
      'warp',
      BEAUTY_SHADERS.vertex,
      BEAUTY_SHADERS.warp
    );
    
    // 多点变形程序
    this.renderer.compileProgram(
      'multiWarp',
      BEAUTY_SHADERS.vertex,
      BEAUTY_SHADERS.multiWarp
    );
    
    // LUT滤镜程序
    this.renderer.compileProgram(
      'lut',
      BEAUTY_SHADERS.vertex,
      BEAUTY_SHADERS.lut
    );
  }
  
  /**
   * 处理单帧
   */
  async processFrame(frameData: FrameData): Promise<ProcessingResult> {
    const startTime = performance.now();
    
    if (this.state !== 'ready') {
      throw new Error('处理器未就绪');
    }
    
    this.setState('processing');
    this.frameCount++;
    
    const { source, timestamp, width, height } = frameData;
    
    // 调整渲染器尺寸
    this.renderer.resize(width, height);
    
    // 检测控制 (每N帧检测一次以提高性能)
    const shouldDetect = this.frameCount % PERFORMANCE_CONFIG.detectionInterval === 0;
    
    // 人脸检测
    if (this.config.enableFaceDetection && shouldDetect) {
      const faces = this.faceDetector.detect(source, timestamp);
      if (faces.length > 0) {
        this.lastFaces = faces;
        this.emit({ type: 'faceDetected', faces });
      }
    }
    
    // 身体检测
    if (this.config.enablePoseDetection && shouldDetect) {
      const poses = this.poseDetector.detect(source, timestamp);
      if (poses.length > 0) {
        this.lastPoses = poses;
        this.emit({ type: 'poseDetected', poses });
      }
    }
    
    // 创建输入纹理
    this.renderer.updateTexture('input', source);
    
    // 创建中间帧缓冲
    this.renderer.createFramebuffer('temp1', width, height);
    this.renderer.createFramebuffer('temp2', width, height);
    
    let currentInput = 'input';
    let currentOutput = 'temp1';
    
    // 应用美颜效果
    if (this.hasBeautyEffects()) {
      // 1. 磨皮
      if (this.beautySettings.smoothSkin > 0) {
        this.applySkinSmooth(currentInput, currentOutput, width, height);
        [currentInput, currentOutput] = this.swapBuffers(currentInput, currentOutput);
      }
      
      // 2. 美白
      if (this.beautySettings.whitening > 0) {
        this.applyWhitening(currentInput, currentOutput);
        [currentInput, currentOutput] = this.swapBuffers(currentInput, currentOutput);
      }
      
      // 3. 锐化
      if (this.beautySettings.sharpness > 0) {
        this.applySharpen(currentInput, currentOutput, width, height);
        [currentInput, currentOutput] = this.swapBuffers(currentInput, currentOutput);
      }
      
      // 4. 脸型调整 (基于人脸检测结果)
      if (this.lastFaces.length > 0 && this.hasFaceReshapeEffects()) {
        this.applyFaceReshape(currentInput, currentOutput, this.lastFaces[0]);
        [currentInput, currentOutput] = this.swapBuffers(currentInput, currentOutput);
      }
    }
    
    // 应用美体效果
    if (this.hasBodyEffects() && this.lastPoses.length > 0) {
      this.applyBodyReshape(currentInput, currentOutput, this.lastPoses[0]);
      [currentInput, currentOutput] = this.swapBuffers(currentInput, currentOutput);
    }
    
    // 应用滤镜
    if (this.filterSettings.filterId && this.filterSettings.intensity > 0) {
      this.applyFilter(currentInput, currentOutput);
      [currentInput, currentOutput] = this.swapBuffers(currentInput, currentOutput);
    }
    
    // 最终渲染到画布
    const inputTexture = this.renderer.getTexture(currentInput === 'input' ? 'input' : `${currentInput}_texture`);
    this.renderer.render('passthrough', { u_texture: inputTexture || null });
    
    this.setState('ready');
    
    const processingTime = performance.now() - startTime;
    
    return {
      outputCanvas: this.renderer.getCanvas(),
      faces: this.lastFaces,
      poses: this.lastPoses,
      processingTime,
    };
  }
  
  /**
   * 交换缓冲
   */
  private swapBuffers(current: string, next: string): [string, string] {
    if (next === 'temp1') {
      return ['temp1', 'temp2'];
    } else {
      return ['temp2', 'temp1'];
    }
  }
  
  /**
   * 应用磨皮效果
   */
  private applySkinSmooth(input: string, output: string, width: number, height: number): void {
    const inputTexture = this.renderer.getTexture(input === 'input' ? 'input' : `${input}_texture`);
    
    this.renderer.render('skinSmooth', {
      u_texture: inputTexture || null,
      u_texelSize: [1.0 / width, 1.0 / height],
      u_intensity: this.beautySettings.smoothSkin / 100,
      u_threshold: 0.15,
    }, output);
  }
  
  /**
   * 应用美白效果
   */
  private applyWhitening(input: string, output: string): void {
    const inputTexture = this.renderer.getTexture(input === 'input' ? 'input' : `${input}_texture`);
    
    this.renderer.render('whitening', {
      u_texture: inputTexture || null,
      u_intensity: this.beautySettings.whitening / 100,
    }, output);
  }
  
  /**
   * 应用锐化效果
   */
  private applySharpen(input: string, output: string, width: number, height: number): void {
    const inputTexture = this.renderer.getTexture(input === 'input' ? 'input' : `${input}_texture`);
    
    this.renderer.render('sharpen', {
      u_texture: inputTexture || null,
      u_texelSize: [1.0 / width, 1.0 / height],
      u_intensity: this.beautySettings.sharpness / 100,
    }, output);
  }
  
  /**
   * 应用脸型调整
   */
  private applyFaceReshape(input: string, output: string, face: FaceDetectionResult): void {
    const inputTexture = this.renderer.getTexture(input === 'input' ? 'input' : `${input}_texture`);
    const landmarks = face.landmarks;
    
    // 收集所有变形区域
    const warpRegions: WarpRegion[] = [];
    
    // 瘦脸
    if (this.beautySettings.faceSlim > 0) {
      const leftCheek = FaceDetector.calculateCenter(
        FaceDetector.getLandmarksByIndices(landmarks, CHEEKBONE_INDICES.slice(0, 10))
      );
      const rightCheek = FaceDetector.calculateCenter(
        FaceDetector.getLandmarksByIndices(landmarks, CHEEKBONE_INDICES.slice(10))
      );
      
      warpRegions.push({
        center: { x: leftCheek.x, y: leftCheek.y },
        radius: 0.1,
        direction: { x: 0.05, y: 0 },
        strength: this.beautySettings.faceSlim / 100 * 0.3,
      });
      
      warpRegions.push({
        center: { x: rightCheek.x, y: rightCheek.y },
        radius: 0.1,
        direction: { x: -0.05, y: 0 },
        strength: this.beautySettings.faceSlim / 100 * 0.3,
      });
    }
    
    // 大眼
    if (this.beautySettings.eyeEnlarge > 0) {
      const leftEye = FaceDetector.calculateCenter(
        FaceDetector.getLandmarksByIndices(landmarks, LEFT_EYE_INDICES)
      );
      const rightEye = FaceDetector.calculateCenter(
        FaceDetector.getLandmarksByIndices(landmarks, RIGHT_EYE_INDICES)
      );
      
      // 膨胀类型 (type=1)
      warpRegions.push({
        center: { x: leftEye.x, y: leftEye.y },
        radius: 0.05,
        direction: { x: 0, y: 0 },
        strength: this.beautySettings.eyeEnlarge / 100 * 0.4,
      });
      
      warpRegions.push({
        center: { x: rightEye.x, y: rightEye.y },
        radius: 0.05,
        direction: { x: 0, y: 0 },
        strength: this.beautySettings.eyeEnlarge / 100 * 0.4,
      });
    }
    
    // 瘦鼻
    if (this.beautySettings.noseSlim > 0) {
      const noseCenter = FaceDetector.calculateCenter(
        FaceDetector.getLandmarksByIndices(landmarks, NOSE_INDICES)
      );
      
      warpRegions.push({
        center: { x: noseCenter.x - 0.02, y: noseCenter.y },
        radius: 0.03,
        direction: { x: 0.02, y: 0 },
        strength: this.beautySettings.noseSlim / 100 * 0.2,
      });
      
      warpRegions.push({
        center: { x: noseCenter.x + 0.02, y: noseCenter.y },
        radius: 0.03,
        direction: { x: -0.02, y: 0 },
        strength: this.beautySettings.noseSlim / 100 * 0.2,
      });
    }
    
    // 下巴调整
    if (this.beautySettings.chinLength !== 0) {
      const chin = FaceDetector.calculateCenter(
        FaceDetector.getLandmarksByIndices(landmarks, CHIN_INDICES)
      );
      
      warpRegions.push({
        center: { x: chin.x, y: chin.y },
        radius: 0.08,
        direction: { x: 0, y: this.beautySettings.chinLength > 0 ? 0.03 : -0.03 },
        strength: Math.abs(this.beautySettings.chinLength) / 50 * 0.2,
      });
    }
    
    // 应用多点变形
    if (warpRegions.length > 0) {
      this.applyMultiWarp(inputTexture, output, warpRegions);
    }
  }
  
  /**
   * 应用多点变形
   */
  private applyMultiWarp(inputTexture: WebGLTexture | undefined, output: string, regions: WarpRegion[]): void {
    const centers: number[] = [];
    const directions: number[] = [];
    const radii: number[] = [];
    const strengths: number[] = [];
    const types: number[] = [];
    
    for (const region of regions.slice(0, 16)) {
      centers.push(region.center.x, region.center.y);
      directions.push(region.direction.x, region.direction.y);
      radii.push(region.radius);
      strengths.push(region.strength);
      // 根据direction判断类型: (0,0)=膨胀, 其他=移动
      types.push(region.direction.x === 0 && region.direction.y === 0 ? 1 : 2);
    }
    
    // 填充到16个点
    while (centers.length < 32) centers.push(0, 0);
    while (directions.length < 32) directions.push(0, 0);
    while (radii.length < 16) radii.push(0);
    while (strengths.length < 16) strengths.push(0);
    while (types.length < 16) types.push(0);
    
    this.renderer.render('multiWarp', {
      u_texture: inputTexture || null,
      u_warpCenters: centers,
      u_warpDirections: directions,
      u_warpRadii: radii,
      u_warpStrengths: strengths,
      u_warpTypes: types,
      u_warpCount: Math.min(regions.length, 16),
    }, output);
  }
  
  /**
   * 应用美体调整
   */
  private applyBodyReshape(input: string, output: string, pose: PoseDetectionResult): void {
    const inputTexture = this.renderer.getTexture(input === 'input' ? 'input' : `${input}_texture`);
    const landmarks = pose.landmarks;
    
    const warpRegions: WarpRegion[] = [];
    
    // 瘦腰
    if (this.bodySettings.slimWaist > 0) {
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];
      
      if (leftHip && rightHip) {
        const waistY = (leftHip.y + rightHip.y) / 2 - 0.1;
        
        warpRegions.push({
          center: { x: leftHip.x, y: waistY },
          radius: 0.08,
          direction: { x: 0.03, y: 0 },
          strength: this.bodySettings.slimWaist / 100 * 0.3,
        });
        
        warpRegions.push({
          center: { x: rightHip.x, y: waistY },
          radius: 0.08,
          direction: { x: -0.03, y: 0 },
          strength: this.bodySettings.slimWaist / 100 * 0.3,
        });
      }
    }
    
    // 长腿 (向下拉伸)
    if (this.bodySettings.longLeg > 0) {
      const leftKnee = landmarks[25];
      const rightKnee = landmarks[26];
      
      if (leftKnee && rightKnee) {
        warpRegions.push({
          center: { x: leftKnee.x, y: leftKnee.y },
          radius: 0.15,
          direction: { x: 0, y: 0.05 },
          strength: this.bodySettings.longLeg / 100 * 0.3,
        });
        
        warpRegions.push({
          center: { x: rightKnee.x, y: rightKnee.y },
          radius: 0.15,
          direction: { x: 0, y: 0.05 },
          strength: this.bodySettings.longLeg / 100 * 0.3,
        });
      }
    }
    
    // 窄肩
    if (this.bodySettings.slimShoulder > 0) {
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      
      if (leftShoulder && rightShoulder) {
        warpRegions.push({
          center: { x: leftShoulder.x, y: leftShoulder.y },
          radius: 0.1,
          direction: { x: 0.03, y: 0 },
          strength: this.bodySettings.slimShoulder / 100 * 0.25,
        });
        
        warpRegions.push({
          center: { x: rightShoulder.x, y: rightShoulder.y },
          radius: 0.1,
          direction: { x: -0.03, y: 0 },
          strength: this.bodySettings.slimShoulder / 100 * 0.25,
        });
      }
    }
    
    if (warpRegions.length > 0) {
      this.applyMultiWarp(inputTexture, output, warpRegions);
    }
  }
  
  /**
   * 应用滤镜
   */
  private applyFilter(input: string, output: string): void {
    // TODO: 加载LUT纹理并应用
    // 暂时使用颜色调整代替
    const inputTexture = this.renderer.getTexture(input === 'input' ? 'input' : `${input}_texture`);
    
    this.renderer.render('colorAdjust', {
      u_texture: inputTexture || null,
      u_brightness: 0,
      u_contrast: 0.05,
      u_saturation: 0.1,
      u_temperature: 0,
      u_tint: 0,
      u_shadows: 0,
      u_highlights: 0,
      u_vibrance: 0.1,
    }, output);
  }
  
  /**
   * 检查是否有美颜效果
   */
  private hasBeautyEffects(): boolean {
    return (
      this.beautySettings.smoothSkin > 0 ||
      this.beautySettings.whitening > 0 ||
      this.beautySettings.sharpness > 0 ||
      this.hasFaceReshapeEffects()
    );
  }
  
  /**
   * 检查是否有脸型调整效果
   */
  private hasFaceReshapeEffects(): boolean {
    return (
      this.beautySettings.faceSlim > 0 ||
      this.beautySettings.faceShort > 0 ||
      this.beautySettings.cheekboneSlim > 0 ||
      this.beautySettings.jawSlim > 0 ||
      this.beautySettings.foreheadHeight !== 0 ||
      this.beautySettings.chinLength !== 0 ||
      this.beautySettings.eyeEnlarge > 0 ||
      this.beautySettings.eyeDistance !== 0 ||
      this.beautySettings.eyeAngle !== 0 ||
      this.beautySettings.noseSlim > 0 ||
      this.beautySettings.noseTip !== 0 ||
      this.beautySettings.noseBridge > 0 ||
      this.beautySettings.mouthSize !== 0 ||
      this.beautySettings.lipThickness !== 0
    );
  }
  
  /**
   * 检查是否有美体效果
   */
  private hasBodyEffects(): boolean {
    return (
      this.bodySettings.slimBody > 0 ||
      this.bodySettings.longLeg > 0 ||
      this.bodySettings.slimWaist > 0 ||
      this.bodySettings.slimArm > 0 ||
      this.bodySettings.slimShoulder > 0 ||
      this.bodySettings.hipEnlarge > 0 ||
      this.bodySettings.headSlim > 0
    );
  }
  
  // ==================== 设置管理 ====================
  
  /**
   * 设置美颜参数
   */
  setBeautySettings(settings: Partial<BeautySettings>): void {
    this.beautySettings = { ...this.beautySettings, ...settings };
  }
  
  /**
   * 设置美体参数
   */
  setBodySettings(settings: Partial<BodySettings>): void {
    this.bodySettings = { ...this.bodySettings, ...settings };
  }
  
  /**
   * 设置滤镜参数
   */
  setFilterSettings(settings: Partial<FilterSettings>): void {
    this.filterSettings = { ...this.filterSettings, ...settings };
  }
  
  /**
   * 应用预设
   */
  applyPreset(presetId: string, presets: { id: string; settings: Partial<BeautySettings> }[]): void {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      this.beautySettings = { ...DEFAULT_BEAUTY_SETTINGS, ...preset.settings };
    }
  }
  
  /**
   * 重置所有设置
   */
  resetSettings(): void {
    this.beautySettings = { ...DEFAULT_BEAUTY_SETTINGS };
    this.bodySettings = { ...DEFAULT_BODY_SETTINGS };
    this.filterSettings = { ...DEFAULT_FILTER_SETTINGS };
  }
  
  /**
   * 获取当前设置
   */
  getSettings(): BeautyConfig {
    return {
      enabled: true,
      beauty: { ...this.beautySettings },
      body: { ...this.bodySettings },
      filter: { ...this.filterSettings },
    };
  }
  
  // ==================== 状态管理 ====================
  
  private setState(state: ProcessorState): void {
    this.state = state;
    this.emit({ type: 'stateChange', state });
  }
  
  /**
   * 添加事件监听
   */
  addEventListener(listener: ProcessorEventListener): void {
    this.listeners.add(listener);
  }
  
  /**
   * 移除事件监听
   */
  removeEventListener(listener: ProcessorEventListener): void {
    this.listeners.delete(listener);
  }
  
  private emit(event: ProcessorEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (e) {
        console.error('[BeautyProcessor] 事件处理错误:', e);
      }
    });
  }
  
  /**
   * 获取当前状态
   */
  getState(): ProcessorState {
    return this.state;
  }
  
  /**
   * 是否就绪
   */
  get ready(): boolean {
    return this.state === 'ready';
  }
  
  // ==================== 生命周期 ====================
  
  /**
   * 销毁处理器
   */
  dispose(): void {
    this.faceDetector.dispose();
    this.poseDetector.dispose();
    this.renderer.dispose();
    this.listeners.clear();
    this.lastFaces = [];
    this.lastPoses = [];
    this.state = 'idle';
  }
}
