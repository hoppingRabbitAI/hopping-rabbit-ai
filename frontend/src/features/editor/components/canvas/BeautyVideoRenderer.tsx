/**
 * BeautyVideoRenderer - AI 美颜视频渲染器
 * 
 * 使用 MediaPipe + WebGL 实现真正的 AI 美颜效果：
 * - 人脸检测与关键点提取
 * - 面部网格变形（瘦脸、大眼、瘦鼻等）
 * - 皮肤美化（磨皮、美白）
 * - 实时滤镜应用
 */

'use client';

import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { BeautyProcessor } from '@/lib/beauty/core/BeautyProcessor';
import type { BeautySettings, BodySettings, FilterSettings, ProcessorConfig } from '@/lib/beauty/types';

// 日志控制
const DEBUG_BEAUTY = false;
const beautyLog = (...args: unknown[]) => { if (DEBUG_BEAUTY) console.log('[BeautyRenderer]', ...args); };

// 默认设置
const DEFAULT_BEAUTY_SETTINGS: BeautySettings = {
  smoothSkin: 0, whitening: 0, sharpness: 0,
  faceSlim: 0, faceShort: 0, cheekboneSlim: 0, jawSlim: 0,
  foreheadHeight: 0, chinLength: 0,
  eyeEnlarge: 0, eyeDistance: 0, eyeAngle: 0,
  noseSlim: 0, noseTip: 0, noseBridge: 0,
  mouthSize: 0, lipThickness: 0,
};

const DEFAULT_BODY_SETTINGS: BodySettings = {
  autoBody: false,
  slimBody: 0, longLeg: 0, slimWaist: 0, slimArm: 0,
  slimShoulder: 0, hipEnlarge: 0, headSlim: 0,
};

const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  filterId: null,
  intensity: 100,
};

// BeautyPanel 参数名 -> BeautyProcessor 参数名映射
// BeautyPanel 使用更口语化的名称，BeautyProcessor 使用更技术化的名称
interface PanelBeautySettings {
  // 基础美颜
  smoothSkin?: number;
  whitening?: number;
  sharpness?: number;
  // 祛瑕疵
  removeAcne?: number;
  removeDarkCircle?: number;
  removeWrinkle?: number;
  // 脸型
  thinFace?: number;
  smallFace?: number;
  vFace?: number;
  chin?: number;
  forehead?: number;
  cheekbone?: number;
  jawbone?: number;
  // 眼睛
  bigEye?: number;
  eyeDistance?: number;
  eyeAngle?: number;
  brightenEye?: number;
  // 鼻子
  thinNose?: number;
  noseWing?: number;
  noseTip?: number;
  noseBridge?: number;
  // 嘴巴
  mouthSize?: number;
  lipThickness?: number;
  smile?: number;
  teethWhiten?: number;
}

// 将 BeautyPanel 的设置转换为 BeautyProcessor 格式
function mapPanelToProcessorSettings(panel: PanelBeautySettings): BeautySettings {
  return {
    // 基础美颜（名称相同）
    smoothSkin: panel.smoothSkin ?? 0,
    whitening: panel.whitening ?? 0,
    sharpness: panel.sharpness ?? 0,
    // 脸型映射
    faceSlim: panel.thinFace ?? 0,
    faceShort: panel.smallFace ?? 0,
    cheekboneSlim: panel.cheekbone ?? 0,
    jawSlim: panel.jawbone ?? 0,
    foreheadHeight: panel.forehead ?? 0,
    chinLength: panel.chin ?? 0,
    // 眼睛映射
    eyeEnlarge: panel.bigEye ?? 0,
    eyeDistance: panel.eyeDistance ?? 0,
    eyeAngle: panel.eyeAngle ?? 0,
    // 鼻子映射
    noseSlim: panel.thinNose ?? 0,
    noseTip: panel.noseTip ?? 0,
    noseBridge: panel.noseBridge ?? 0,
    // 嘴巴映射
    mouthSize: panel.mouthSize ?? 0,
    lipThickness: panel.lipThickness ?? 0,
  };
}

export interface BeautyVideoRendererProps {
  // 视频源
  videoElement: HTMLVideoElement | null;
  
  // 尺寸
  width: number;
  height: number;
  
  // 美颜设置（来自 clip.effectParams）
  beautySettings?: Partial<BeautySettings>;
  bodySettings?: Partial<BodySettings>;
  filterSettings?: Partial<FilterSettings>;
  
  // 是否启用
  enabled?: boolean;
  
  // 目标帧率
  targetFPS?: number;
  
  // CSS 类名
  className?: string;
  
  // 回调
  onReady?: () => void;
  onError?: (error: Error) => void;
  onFPSUpdate?: (fps: number) => void;
}

export interface BeautyVideoRendererHandle {
  getCanvas: () => HTMLCanvasElement | null;
  captureFrame: () => ImageData | null;
  isProcessing: () => boolean;
  getProcessor: () => BeautyProcessor | null;
}

/**
 * AI 美颜视频渲染器组件
 */
export const BeautyVideoRenderer = forwardRef<BeautyVideoRendererHandle, BeautyVideoRendererProps>(
  function BeautyVideoRenderer(
    {
      videoElement,
      width,
      height,
      beautySettings = {},
      bodySettings = {},
      filterSettings = {},
      enabled = true,
      targetFPS = 30,
      className = '',
      onReady,
      onError,
      onFPSUpdate,
    },
    ref
  ) {
    // Canvas refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    
    // 处理器
    const processorRef = useRef<BeautyProcessor | null>(null);
    const isInitializingRef = useRef(false);
    
    // 动画帧
    const rafRef = useRef<number | null>(null);
    const lastFrameTimeRef = useRef<number>(0);
    const frameInterval = 1000 / targetFPS;
    
    // FPS 计数
    const fpsCounterRef = useRef({ frames: 0, lastTime: 0 });
    
    // 状态
    const [isReady, setIsReady] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    
    // 将 BeautyPanel 设置映射为 BeautyProcessor 格式
    const mappedBeautySettings = mapPanelToProcessorSettings(beautySettings as PanelBeautySettings);
    
    const mergedBeautySettings: BeautySettings = {
      ...DEFAULT_BEAUTY_SETTINGS,
      ...mappedBeautySettings,
    };
    
    const mergedBodySettings: BodySettings = {
      ...DEFAULT_BODY_SETTINGS,
      ...bodySettings,
    };
    
    const mergedFilterSettings: FilterSettings = {
      ...DEFAULT_FILTER_SETTINGS,
      ...filterSettings,
    };

    // 检查是否需要 AI 处理（有面部变形设置时需要）
    const needsAIProcessing = useCallback(() => {
      const beauty = mergedBeautySettings;
      // 面部变形功能需要 AI 处理
      return (
        beauty.faceSlim > 0 ||
        beauty.faceShort > 0 ||
        beauty.cheekboneSlim > 0 ||
        beauty.jawSlim > 0 ||
        beauty.foreheadHeight !== 0 ||
        beauty.chinLength !== 0 ||
        beauty.eyeEnlarge > 0 ||
        beauty.eyeDistance !== 0 ||
        beauty.eyeAngle !== 0 ||
        beauty.noseSlim > 0 ||
        beauty.noseTip !== 0 ||
        beauty.noseBridge > 0 ||
        beauty.mouthSize !== 0 ||
        beauty.lipThickness !== 0 ||
        mergedBodySettings.slimBody > 0 ||
        mergedBodySettings.longLeg > 0 ||
        mergedBodySettings.slimWaist > 0
      );
    }, [mergedBeautySettings, mergedBodySettings]);

    // 初始化处理器
    useEffect(() => {
      if (!enabled) return;
      if (isInitializingRef.current) return;
      if (processorRef.current) return;
      
      isInitializingRef.current = true;
      
      const initProcessor = async () => {
        try {
          beautyLog('初始化 BeautyProcessor...');
          
          const processorConfig: Partial<ProcessorConfig> = {
            mode: 'video',
            enableFaceDetection: true,
            enablePoseDetection: needsAIProcessing(), // 只有美体时才启用
            maxFaces: 3,
            maxPoses: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          };
          
          const processor = new BeautyProcessor(processorConfig);
          
          await processor.initialize();
          
          processorRef.current = processor;
          setIsReady(true);
          isInitializingRef.current = false;
          
          beautyLog('BeautyProcessor 初始化完成');
          onReady?.();
        } catch (error) {
          console.error('[BeautyRenderer] 初始化失败:', error);
          isInitializingRef.current = false;
          onError?.(error as Error);
        }
      };
      
      initProcessor();
      
      return () => {
        if (processorRef.current) {
          processorRef.current.dispose?.();
          processorRef.current = null;
        }
      };
    }, [enabled, needsAIProcessing, onReady, onError]);

    // 更新处理器设置
    useEffect(() => {
      if (!processorRef.current) return;
      
      processorRef.current.setBeautySettings(mergedBeautySettings);
      processorRef.current.setBodySettings(mergedBodySettings);
      processorRef.current.setFilterSettings(mergedFilterSettings);
      
      beautyLog('更新美颜设置:', mergedBeautySettings);
    }, [mergedBeautySettings, mergedBodySettings, mergedFilterSettings]);

    // 处理循环
    const processLoop = useCallback(async (timestamp: number) => {
      if (!enabled || !videoElement || !processorRef.current || !canvasRef.current) {
        rafRef.current = requestAnimationFrame(processLoop);
        return;
      }
      
      // 帧率控制
      const elapsed = timestamp - lastFrameTimeRef.current;
      if (elapsed < frameInterval) {
        rafRef.current = requestAnimationFrame(processLoop);
        return;
      }
      lastFrameTimeRef.current = timestamp;
      
      // 检查视频是否可播放
      if (videoElement.readyState < 2) {
        rafRef.current = requestAnimationFrame(processLoop);
        return;
      }
      
      try {
        setIsProcessing(true);
        
        // 调整 canvas 尺寸
        if (canvasRef.current.width !== width || canvasRef.current.height !== height) {
          canvasRef.current.width = width;
          canvasRef.current.height = height;
        }
        
        // 处理帧
        const result = await processorRef.current.processFrame({
          source: videoElement,
          timestamp,
          width: videoElement.videoWidth || width,
          height: videoElement.videoHeight || height,
        });
        
        // 绘制到输出 canvas
        if (result.outputCanvas && canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            ctx.drawImage(result.outputCanvas, 0, 0, width, height);
          }
        }
        
        // 计算 FPS
        fpsCounterRef.current.frames++;
        if (timestamp - fpsCounterRef.current.lastTime >= 1000) {
          const fps = fpsCounterRef.current.frames;
          onFPSUpdate?.(fps);
          beautyLog('FPS:', fps);
          fpsCounterRef.current.frames = 0;
          fpsCounterRef.current.lastTime = timestamp;
        }
        
        setIsProcessing(false);
      } catch (error) {
        console.error('[BeautyRenderer] 处理帧失败:', error);
        setIsProcessing(false);
      }
      
      rafRef.current = requestAnimationFrame(processLoop);
    }, [enabled, videoElement, width, height, frameInterval, onFPSUpdate]);

    // 开始/停止处理循环
    useEffect(() => {
      if (!enabled || !isReady || !videoElement) {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        return;
      }
      
      // 开始处理
      fpsCounterRef.current = { frames: 0, lastTime: performance.now() };
      rafRef.current = requestAnimationFrame(processLoop);
      
      return () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [enabled, isReady, videoElement, processLoop]);

    // 暴露给父组件的方法
    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current,
      captureFrame: () => {
        if (!canvasRef.current) return null;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return null;
        return ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      },
      isProcessing: () => isProcessing,
      getProcessor: () => processorRef.current,
    }), [isProcessing]);

    return (
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className={`${className}`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />
    );
  }
);

export default BeautyVideoRenderer;
