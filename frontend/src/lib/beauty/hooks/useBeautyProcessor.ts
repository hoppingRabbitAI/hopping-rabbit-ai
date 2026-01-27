/**
 * 美颜处理器 React Hook
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { BeautyProcessor } from '../core/BeautyProcessor';
import type {
  BeautySettings,
  BodySettings,
  FilterSettings,
  BeautyConfig,
  ProcessorState,
  ProcessorEvent,
  FaceDetectionResult,
  PoseDetectionResult,
  ProcessorConfig,
} from '../types';
import {
  DEFAULT_BEAUTY_SETTINGS,
  DEFAULT_BODY_SETTINGS,
  DEFAULT_FILTER_SETTINGS,
  BEAUTY_PRESETS,
} from '../constants';

export interface UseBeautyProcessorOptions {
  autoInitialize?: boolean;
  config?: Partial<ProcessorConfig>;
  onFaceDetected?: (faces: FaceDetectionResult[]) => void;
  onPoseDetected?: (poses: PoseDetectionResult[]) => void;
  onError?: (error: Error) => void;
}

export interface UseBeautyProcessorReturn {
  // 状态
  state: ProcessorState;
  isReady: boolean;
  isProcessing: boolean;
  error: Error | null;
  
  // 检测结果
  faces: FaceDetectionResult[];
  poses: PoseDetectionResult[];
  
  // 设置
  beautySettings: BeautySettings;
  bodySettings: BodySettings;
  filterSettings: FilterSettings;
  
  // 方法
  initialize: () => Promise<void>;
  processFrame: (
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    timestamp?: number
  ) => Promise<HTMLCanvasElement | null>;
  setBeautySettings: (settings: Partial<BeautySettings>) => void;
  setBodySettings: (settings: Partial<BodySettings>) => void;
  setFilterSettings: (settings: Partial<FilterSettings>) => void;
  applyPreset: (presetId: string) => void;
  resetSettings: () => void;
  getSettings: () => BeautyConfig;
  dispose: () => void;
}

export function useBeautyProcessor(
  options: UseBeautyProcessorOptions = {}
): UseBeautyProcessorReturn {
  const {
    autoInitialize = false,
    config,
    onFaceDetected,
    onPoseDetected,
    onError,
  } = options;
  
  const processorRef = useRef<BeautyProcessor | null>(null);
  
  const [state, setState] = useState<ProcessorState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [faces, setFaces] = useState<FaceDetectionResult[]>([]);
  const [poses, setPoses] = useState<PoseDetectionResult[]>([]);
  
  const [beautySettings, setBeautySettingsState] = useState<BeautySettings>(
    DEFAULT_BEAUTY_SETTINGS
  );
  const [bodySettings, setBodySettingsState] = useState<BodySettings>(
    DEFAULT_BODY_SETTINGS
  );
  const [filterSettings, setFilterSettingsState] = useState<FilterSettings>(
    DEFAULT_FILTER_SETTINGS
  );
  
  // 初始化处理器
  const initialize = useCallback(async () => {
    if (processorRef.current) {
      return;
    }
    
    try {
      const processor = new BeautyProcessor(config);
      processorRef.current = processor;
      
      // 监听事件
      processor.addEventListener((event: ProcessorEvent) => {
        switch (event.type) {
          case 'stateChange':
            setState(event.state);
            break;
          case 'faceDetected':
            setFaces(event.faces);
            onFaceDetected?.(event.faces);
            break;
          case 'poseDetected':
            setPoses(event.poses);
            onPoseDetected?.(event.poses);
            break;
          case 'error':
            setError(event.error);
            onError?.(event.error);
            break;
        }
      });
      
      await processor.initialize();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      throw error;
    }
  }, [config, onFaceDetected, onPoseDetected, onError]);
  
  // 处理帧
  const processFrame = useCallback(async (
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    timestamp?: number
  ): Promise<HTMLCanvasElement | null> => {
    if (!processorRef.current || !processorRef.current.ready) {
      return null;
    }
    
    try {
      const width = 'videoWidth' in source ? source.videoWidth : source.width;
      const height = 'videoHeight' in source ? source.videoHeight : source.height;
      
      const result = await processorRef.current.processFrame({
        source,
        timestamp: timestamp ?? performance.now(),
        width,
        height,
      });
      
      return result.outputCanvas as HTMLCanvasElement;
    } catch (err) {
      console.error('[useBeautyProcessor] 处理帧失败:', err);
      return null;
    }
  }, []);
  
  // 设置美颜参数
  const setBeautySettings = useCallback((settings: Partial<BeautySettings>) => {
    setBeautySettingsState(prev => {
      const newSettings = { ...prev, ...settings };
      processorRef.current?.setBeautySettings(newSettings);
      return newSettings;
    });
  }, []);
  
  // 设置美体参数
  const setBodySettings = useCallback((settings: Partial<BodySettings>) => {
    setBodySettingsState(prev => {
      const newSettings = { ...prev, ...settings };
      processorRef.current?.setBodySettings(newSettings);
      return newSettings;
    });
  }, []);
  
  // 设置滤镜参数
  const setFilterSettings = useCallback((settings: Partial<FilterSettings>) => {
    setFilterSettingsState(prev => {
      const newSettings = { ...prev, ...settings };
      processorRef.current?.setFilterSettings(newSettings);
      return newSettings;
    });
  }, []);
  
  // 应用预设
  const applyPreset = useCallback((presetId: string) => {
    const preset = BEAUTY_PRESETS.find(p => p.id === presetId);
    if (preset) {
      const newSettings = { ...DEFAULT_BEAUTY_SETTINGS, ...preset.settings };
      setBeautySettingsState(newSettings);
      processorRef.current?.setBeautySettings(newSettings);
    }
  }, []);
  
  // 重置设置
  const resetSettings = useCallback(() => {
    setBeautySettingsState(DEFAULT_BEAUTY_SETTINGS);
    setBodySettingsState(DEFAULT_BODY_SETTINGS);
    setFilterSettingsState(DEFAULT_FILTER_SETTINGS);
    processorRef.current?.resetSettings();
  }, []);
  
  // 获取当前设置
  const getSettings = useCallback((): BeautyConfig => {
    return {
      enabled: true,
      beauty: beautySettings,
      body: bodySettings,
      filter: filterSettings,
    };
  }, [beautySettings, bodySettings, filterSettings]);
  
  // 销毁处理器
  const dispose = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.dispose();
      processorRef.current = null;
    }
    setState('idle');
    setError(null);
    setFaces([]);
    setPoses([]);
  }, []);
  
  // 自动初始化
  useEffect(() => {
    if (autoInitialize) {
      initialize();
    }
    
    return () => {
      dispose();
    };
  }, [autoInitialize, initialize, dispose]);
  
  return {
    // 状态
    state,
    isReady: state === 'ready',
    isProcessing: state === 'processing',
    error,
    
    // 检测结果
    faces,
    poses,
    
    // 设置
    beautySettings,
    bodySettings,
    filterSettings,
    
    // 方法
    initialize,
    processFrame,
    setBeautySettings,
    setBodySettings,
    setFilterSettings,
    applyPreset,
    resetSettings,
    getSettings,
    dispose,
  };
}
