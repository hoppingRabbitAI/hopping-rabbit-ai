/**
 * BeautyVideoContext - 美颜视频处理上下文
 * 
 * 在编辑器层面提供美颜视频处理能力
 * 管理 BeautyProcessor 实例的生命周期
 */

'use client';

import React, { createContext, useContext, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { BeautyProcessor } from '@/lib/beauty/core/BeautyProcessor';
import type { BeautySettings, BodySettings, FilterSettings, ProcessorConfig, ProcessingResult } from '@/lib/beauty/types';

// 日志控制
const DEBUG_BEAUTY_CONTEXT = false;
const beautyCtxLog = (...args: unknown[]) => { if (DEBUG_BEAUTY_CONTEXT) console.log('[BeautyContext]', ...args); };

// BeautyPanel 参数名 -> BeautyProcessor 参数名映射
interface PanelBeautySettings {
  smoothSkin?: number;
  whitening?: number;
  sharpness?: number;
  removeAcne?: number;
  removeDarkCircle?: number;
  removeWrinkle?: number;
  thinFace?: number;
  smallFace?: number;
  vFace?: number;
  chin?: number;
  forehead?: number;
  cheekbone?: number;
  jawbone?: number;
  bigEye?: number;
  eyeDistance?: number;
  eyeAngle?: number;
  brightenEye?: number;
  thinNose?: number;
  noseWing?: number;
  noseTip?: number;
  noseBridge?: number;
  mouthSize?: number;
  lipThickness?: number;
  smile?: number;
  teethWhiten?: number;
}

interface PanelBodySettings {
  autoBody?: number;
  slimBody?: number;
  longLeg?: number;
  slimLeg?: number;
  slimWaist?: number;
  slimArm?: number;
  shoulder?: number;
  hip?: number;
  swanNeck?: number;
}

interface PanelFilterSettings {
  id?: string;
  intensity?: number;
}

// 映射函数
function mapPanelBeautyToProcessor(panel: PanelBeautySettings): Partial<BeautySettings> {
  return {
    smoothSkin: panel.smoothSkin ?? 0,
    whitening: panel.whitening ?? 0,
    sharpness: panel.sharpness ?? 0,
    faceSlim: panel.thinFace ?? 0,
    faceShort: panel.smallFace ?? 0,
    cheekboneSlim: panel.cheekbone ?? 0,
    jawSlim: panel.jawbone ?? 0,
    foreheadHeight: panel.forehead ?? 0,
    chinLength: panel.chin ?? 0,
    eyeEnlarge: panel.bigEye ?? 0,
    eyeDistance: panel.eyeDistance ?? 0,
    eyeAngle: panel.eyeAngle ?? 0,
    noseSlim: panel.thinNose ?? 0,
    noseTip: panel.noseTip ?? 0,
    noseBridge: panel.noseBridge ?? 0,
    mouthSize: panel.mouthSize ?? 0,
    lipThickness: panel.lipThickness ?? 0,
  };
}

function mapPanelBodyToProcessor(panel: PanelBodySettings): Partial<BodySettings> {
  return {
    autoBody: (panel.autoBody ?? 0) > 0,
    slimBody: panel.slimBody ?? 0,
    longLeg: panel.longLeg ?? 0,
    slimWaist: panel.slimWaist ?? 0,
    slimArm: panel.slimArm ?? 0,
    slimShoulder: panel.shoulder ? Math.abs(panel.shoulder) : 0,
    hipEnlarge: panel.hip ?? 0,
    headSlim: 0,
  };
}

function mapPanelFilterToProcessor(panel: PanelFilterSettings): Partial<FilterSettings> {
  return {
    filterId: panel.id || null,
    intensity: panel.intensity ?? 100,
  };
}

// Context 类型
interface BeautyVideoContextValue {
  // 状态
  isReady: boolean;
  isProcessing: boolean;
  isInitializing: boolean;
  fps: number;
  
  // 处理器实例
  processor: BeautyProcessor | null;
  
  // 方法
  initialize: () => Promise<void>;
  dispose: () => void;
  
  // 处理帧
  processFrame: (
    source: HTMLVideoElement | HTMLCanvasElement,
    settings: {
      beauty?: PanelBeautySettings;
      body?: PanelBodySettings;
      filter?: PanelFilterSettings;
    }
  ) => Promise<ProcessingResult | null>;
  
  // 获取输出 Canvas
  getOutputCanvas: () => HTMLCanvasElement | null;
  
  // 检查是否需要 AI 美颜（用于决定是否启用复杂处理）
  needsAIProcessing: (settings: {
    beauty?: PanelBeautySettings;
    body?: PanelBodySettings;
  }) => boolean;
}

const BeautyVideoContext = createContext<BeautyVideoContextValue | null>(null);

// Provider Props
interface BeautyVideoProviderProps {
  children: React.ReactNode;
  enabled?: boolean;
}

/**
 * 美颜视频处理 Provider
 */
export function BeautyVideoProvider({ children, enabled = true }: BeautyVideoProviderProps) {
  const processorRef = useRef<BeautyProcessor | null>(null);
  const isInitializingRef = useRef(false);
  
  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [fps, setFps] = useState(0);
  
  // FPS 计数
  const fpsCounterRef = useRef({ frames: 0, lastTime: 0 });

  // 初始化处理器
  const initialize = useCallback(async () => {
    if (!enabled) return;
    if (isInitializingRef.current) return;
    if (processorRef.current) return;
    
    isInitializingRef.current = true;
    setIsInitializing(true);
    
    try {
      beautyCtxLog('初始化 BeautyProcessor...');
      
      const config: Partial<ProcessorConfig> = {
        mode: 'video',
        enableFaceDetection: true,
        enablePoseDetection: true,
        maxFaces: 3,
        maxPoses: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      
      const processor = new BeautyProcessor(config);
      await processor.initialize();
      
      processorRef.current = processor;
      setIsReady(true);
      setIsInitializing(false);
      isInitializingRef.current = false;
      
      beautyCtxLog('BeautyProcessor 初始化完成');
    } catch (error) {
      console.error('[BeautyContext] 初始化失败:', error);
      setIsInitializing(false);
      isInitializingRef.current = false;
    }
  }, [enabled]);

  // 销毁处理器
  const dispose = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.dispose();
      processorRef.current = null;
    }
    setIsReady(false);
    setIsProcessing(false);
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      dispose();
    };
  }, [dispose]);

  // 检查是否需要 AI 处理
  const needsAIProcessing = useCallback((settings: {
    beauty?: PanelBeautySettings;
    body?: PanelBodySettings;
  }) => {
    const { beauty = {}, body = {} } = settings;
    
    // 基础美颜（磨皮、美白、锐化）可以用 CSS filter 实现
    // 面部变形功能需要 AI 处理
    return (
      (beauty.thinFace ?? 0) > 0 ||
      (beauty.smallFace ?? 0) > 0 ||
      (beauty.vFace ?? 0) > 0 ||
      (beauty.chin ?? 0) !== 0 ||
      (beauty.forehead ?? 0) !== 0 ||
      (beauty.cheekbone ?? 0) > 0 ||
      (beauty.jawbone ?? 0) > 0 ||
      (beauty.bigEye ?? 0) > 0 ||
      (beauty.eyeDistance ?? 0) !== 0 ||
      (beauty.eyeAngle ?? 0) !== 0 ||
      (beauty.thinNose ?? 0) > 0 ||
      (beauty.noseTip ?? 0) !== 0 ||
      (beauty.noseBridge ?? 0) > 0 ||
      (beauty.mouthSize ?? 0) !== 0 ||
      (beauty.lipThickness ?? 0) !== 0 ||
      (beauty.smile ?? 0) > 0 ||
      (body.slimBody ?? 0) > 0 ||
      (body.longLeg ?? 0) > 0 ||
      (body.slimLeg ?? 0) > 0 ||
      (body.slimWaist ?? 0) > 0 ||
      (body.slimArm ?? 0) > 0
    );
  }, []);

  // 处理帧
  const processFrame = useCallback(async (
    source: HTMLVideoElement | HTMLCanvasElement,
    settings: {
      beauty?: PanelBeautySettings;
      body?: PanelBodySettings;
      filter?: PanelFilterSettings;
    }
  ): Promise<ProcessingResult | null> => {
    if (!processorRef.current || !isReady) {
      return null;
    }
    
    const { beauty = {}, body = {}, filter = {} } = settings;
    
    // 映射参数
    const mappedBeauty = mapPanelBeautyToProcessor(beauty);
    const mappedBody = mapPanelBodyToProcessor(body);
    const mappedFilter = mapPanelFilterToProcessor(filter);
    
    // 更新处理器设置
    processorRef.current.setBeautySettings(mappedBeauty);
    processorRef.current.setBodySettings(mappedBody);
    processorRef.current.setFilterSettings(mappedFilter);
    
    setIsProcessing(true);
    
    try {
      const timestamp = performance.now();
      const width = source instanceof HTMLVideoElement 
        ? source.videoWidth 
        : source.width;
      const height = source instanceof HTMLVideoElement 
        ? source.videoHeight 
        : source.height;
      
      const result = await processorRef.current.processFrame({
        source,
        timestamp,
        width,
        height,
      });
      
      // 计算 FPS
      fpsCounterRef.current.frames++;
      if (timestamp - fpsCounterRef.current.lastTime >= 1000) {
        setFps(fpsCounterRef.current.frames);
        fpsCounterRef.current.frames = 0;
        fpsCounterRef.current.lastTime = timestamp;
      }
      
      setIsProcessing(false);
      return result;
    } catch (error) {
      console.error('[BeautyContext] 处理帧失败:', error);
      setIsProcessing(false);
      return null;
    }
  }, [isReady]);

  // 获取输出 Canvas
  const getOutputCanvas = useCallback(() => {
    if (!processorRef.current) return null;
    // BeautyProcessor 内部的 WebGLRenderer 有 getCanvas 方法
    return (processorRef.current as { getCanvas?: () => HTMLCanvasElement }).getCanvas?.() || null;
  }, []);

  const value = useMemo<BeautyVideoContextValue>(() => ({
    isReady,
    isProcessing,
    isInitializing,
    fps,
    processor: processorRef.current,
    initialize,
    dispose,
    processFrame,
    getOutputCanvas,
    needsAIProcessing,
  }), [isReady, isProcessing, isInitializing, fps, initialize, dispose, processFrame, getOutputCanvas, needsAIProcessing]);

  return (
    <BeautyVideoContext.Provider value={value}>
      {children}
    </BeautyVideoContext.Provider>
  );
}

/**
 * 使用美颜视频上下文
 */
export function useBeautyVideo(): BeautyVideoContextValue {
  const context = useContext(BeautyVideoContext);
  if (!context) {
    throw new Error('useBeautyVideo must be used within BeautyVideoProvider');
  }
  return context;
}

/**
 * 安全使用美颜视频上下文（不抛出错误）
 */
export function useBeautyVideoSafe(): BeautyVideoContextValue | null {
  return useContext(BeautyVideoContext);
}

export default BeautyVideoContext;
