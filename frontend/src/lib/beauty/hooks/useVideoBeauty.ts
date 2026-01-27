/**
 * 视频美颜 React Hook
 * 用于实时处理视频流
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useBeautyProcessor } from './useBeautyProcessor';
import type {
  BeautySettings,
  BodySettings,
  FilterSettings,
  ProcessorConfig,
} from '../types';

export interface UseVideoBeautyOptions {
  enabled?: boolean;
  config?: Partial<ProcessorConfig>;
  targetFPS?: number;
}

export interface UseVideoBeautyReturn {
  // 状态
  isReady: boolean;
  isProcessing: boolean;
  fps: number;
  
  // Canvas引用
  outputCanvasRef: React.RefObject<HTMLCanvasElement>;
  
  // 方法
  startProcessing: (video: HTMLVideoElement) => void;
  stopProcessing: () => void;
  
  // 设置方法
  setBeautySettings: (settings: Partial<BeautySettings>) => void;
  setBodySettings: (settings: Partial<BodySettings>) => void;
  setFilterSettings: (settings: Partial<FilterSettings>) => void;
  applyPreset: (presetId: string) => void;
  resetSettings: () => void;
  
  // 当前设置
  beautySettings: BeautySettings;
  bodySettings: BodySettings;
  filterSettings: FilterSettings;
}

export function useVideoBeauty(
  options: UseVideoBeautyOptions = {}
): UseVideoBeautyReturn {
  const { enabled = true, config, targetFPS = 30 } = options;
  
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const fpsCounterRef = useRef({ frames: 0, lastTime: 0 });
  
  const [isProcessingActive, setIsProcessingActive] = useState(false);
  const [fps, setFps] = useState(0);
  
  const processor = useBeautyProcessor({
    autoInitialize: true,
    config,
  });
  
  const frameInterval = 1000 / targetFPS;
  
  // 处理循环
  const processLoop = useCallback(async (timestamp: number) => {
    if (!isProcessingActive || !videoRef.current || !processor.isReady) {
      return;
    }
    
    const video = videoRef.current;
    
    // 帧率控制
    const elapsed = timestamp - lastFrameTimeRef.current;
    if (elapsed < frameInterval) {
      animationFrameRef.current = requestAnimationFrame(processLoop);
      return;
    }
    lastFrameTimeRef.current = timestamp;
    
    // 检查视频是否可以播放
    if (video.readyState < 2 || video.paused) {
      animationFrameRef.current = requestAnimationFrame(processLoop);
      return;
    }
    
    try {
      // 处理帧
      const outputCanvas = await processor.processFrame(video, timestamp);
      
      // 绘制到输出Canvas
      if (outputCanvas && outputCanvasRef.current) {
        const ctx = outputCanvasRef.current.getContext('2d');
        if (ctx) {
          // 调整输出Canvas尺寸
          if (
            outputCanvasRef.current.width !== video.videoWidth ||
            outputCanvasRef.current.height !== video.videoHeight
          ) {
            outputCanvasRef.current.width = video.videoWidth;
            outputCanvasRef.current.height = video.videoHeight;
          }
          
          ctx.drawImage(outputCanvas, 0, 0);
        }
      }
      
      // 计算FPS
      fpsCounterRef.current.frames++;
      if (timestamp - fpsCounterRef.current.lastTime >= 1000) {
        setFps(fpsCounterRef.current.frames);
        fpsCounterRef.current.frames = 0;
        fpsCounterRef.current.lastTime = timestamp;
      }
    } catch (error) {
      console.error('[useVideoBeauty] 处理帧失败:', error);
    }
    
    // 继续循环
    animationFrameRef.current = requestAnimationFrame(processLoop);
  }, [isProcessingActive, processor, frameInterval]);
  
  // 开始处理
  const startProcessing = useCallback((video: HTMLVideoElement) => {
    if (!enabled || !processor.isReady) {
      console.warn('[useVideoBeauty] 处理器未就绪');
      return;
    }
    
    videoRef.current = video;
    setIsProcessingActive(true);
    lastFrameTimeRef.current = performance.now();
    fpsCounterRef.current = { frames: 0, lastTime: performance.now() };
    
    animationFrameRef.current = requestAnimationFrame(processLoop);
  }, [enabled, processor.isReady, processLoop]);
  
  // 停止处理
  const stopProcessing = useCallback(() => {
    setIsProcessingActive(false);
    
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    videoRef.current = null;
    setFps(0);
  }, []);
  
  // 监听enabled变化
  useEffect(() => {
    if (!enabled && isProcessingActive) {
      stopProcessing();
    }
  }, [enabled, isProcessingActive, stopProcessing]);
  
  // 监听处理状态变化，启动循环
  useEffect(() => {
    if (isProcessingActive && processor.isReady && !animationFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(processLoop);
    }
  }, [isProcessingActive, processor.isReady, processLoop]);
  
  // 清理
  useEffect(() => {
    return () => {
      stopProcessing();
      processor.dispose();
    };
  }, [stopProcessing, processor]);
  
  return {
    // 状态
    isReady: processor.isReady,
    isProcessing: isProcessingActive && processor.isProcessing,
    fps,
    
    // Canvas引用
    outputCanvasRef,
    
    // 方法
    startProcessing,
    stopProcessing,
    
    // 设置方法
    setBeautySettings: processor.setBeautySettings,
    setBodySettings: processor.setBodySettings,
    setFilterSettings: processor.setFilterSettings,
    applyPreset: processor.applyPreset,
    resetSettings: processor.resetSettings,
    
    // 当前设置
    beautySettings: processor.beautySettings,
    bodySettings: processor.bodySettings,
    filterSettings: processor.filterSettings,
  };
}
