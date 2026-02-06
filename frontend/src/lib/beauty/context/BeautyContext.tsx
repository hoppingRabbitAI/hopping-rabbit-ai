/**
 * 美颜全局上下文
 * 提供跨组件的美颜状态管理，连接 BeautyPanel 与 VideoCanvas
 */

'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { BeautyProcessor } from '../core/BeautyProcessor';
import type { BeautySettings, BodySettings, FilterSettings } from '../types';
import { DEFAULT_BEAUTY_SETTINGS, DEFAULT_BODY_SETTINGS, DEFAULT_FILTER_SETTINGS } from '../constants';

interface ClipBeautySettings {
  beauty: BeautySettings;
  body: BodySettings;
  filter: FilterSettings;
}

interface BeautyContextValue {
  // 全局处理器（单例）
  processor: BeautyProcessor | null;
  isReady: boolean;
  
  // 当前活跃 clip 的美颜设置
  activeClipId: string | null;
  activeSettings: ClipBeautySettings;
  
  // 设置方法
  setActiveClip: (clipId: string | null, settings?: ClipBeautySettings) => void;
  updateBeautySettings: (settings: Partial<BeautySettings>) => void;
  updateBodySettings: (settings: Partial<BodySettings>) => void;
  updateFilterSettings: (settings: Partial<FilterSettings>) => void;
  
  // 检查是否有活跃效果
  hasActiveEffects: () => boolean;
  
  // 处理视频帧（返回处理后的 Canvas）
  processVideoFrame: (
    video: HTMLVideoElement,
    timestamp: number
  ) => Promise<HTMLCanvasElement | null>;
}

const BeautyContext = createContext<BeautyContextValue | null>(null);

const DEFAULT_SETTINGS: ClipBeautySettings = {
  beauty: DEFAULT_BEAUTY_SETTINGS,
  body: DEFAULT_BODY_SETTINGS,
  filter: DEFAULT_FILTER_SETTINGS,
};

export function BeautyProvider({ children }: { children: React.ReactNode }) {
  const processorRef = useRef<BeautyProcessor | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [activeSettings, setActiveSettings] = useState<ClipBeautySettings>(DEFAULT_SETTINGS);
  
  // 初始化处理器
  useEffect(() => {
    const initProcessor = async () => {
      try {
        const processor = new BeautyProcessor({
          maxFaces: 1,
          enablePoseDetection: false, // 美体需要更多资源，按需开启
          minDetectionConfidence: 0.5,
        });
        
        await processor.initialize();
        processorRef.current = processor;
        setIsReady(true);
        console.log('[BeautyContext] 处理器初始化成功');
      } catch (error) {
        console.error('[BeautyContext] 处理器初始化失败:', error);
      }
    };
    
    initProcessor();
    
    return () => {
      if (processorRef.current) {
        processorRef.current.dispose();
        processorRef.current = null;
      }
    };
  }, []);
  
  // 同步设置到处理器
  useEffect(() => {
    if (!processorRef.current) return;
    
    processorRef.current.setBeautySettings(activeSettings.beauty);
    processorRef.current.setBodySettings(activeSettings.body);
    processorRef.current.setFilterSettings(activeSettings.filter);
  }, [activeSettings]);
  
  // 设置活跃 clip
  const setActiveClip = useCallback((clipId: string | null, settings?: ClipBeautySettings) => {
    setActiveClipId(clipId);
    if (settings) {
      setActiveSettings(settings);
    } else {
      setActiveSettings(DEFAULT_SETTINGS);
    }
  }, []);
  
  // 更新美颜设置
  const updateBeautySettings = useCallback((settings: Partial<BeautySettings>) => {
    setActiveSettings(prev => ({
      ...prev,
      beauty: { ...prev.beauty, ...settings },
    }));
  }, []);
  
  // 更新美体设置
  const updateBodySettings = useCallback((settings: Partial<BodySettings>) => {
    setActiveSettings(prev => ({
      ...prev,
      body: { ...prev.body, ...settings },
    }));
  }, []);
  
  // 更新滤镜设置
  const updateFilterSettings = useCallback((settings: Partial<FilterSettings>) => {
    setActiveSettings(prev => ({
      ...prev,
      filter: { ...prev.filter, ...settings },
    }));
  }, []);
  
  // 检查是否有活跃效果
  const hasActiveEffects = useCallback((): boolean => {
    const { beauty, body, filter } = activeSettings;
    
    // 检查美颜
    const hasBeauty = Object.values(beauty).some(v => typeof v === 'number' && v > 0);
    
    // 检查美体
    const hasBody = Object.values(body).some(v => typeof v === 'number' && v > 0);
    
    // 检查滤镜
    const hasFilter = filter.filterId !== undefined && 
                      filter.filterId !== 'none' && 
                      filter.intensity > 0;
    
    return hasBeauty || hasBody || hasFilter;
  }, [activeSettings]);
  
  // 处理视频帧
  const processVideoFrame = useCallback(async (
    video: HTMLVideoElement,
    timestamp: number
  ): Promise<HTMLCanvasElement | null> => {
    if (!processorRef.current || !isReady) {
      return null;
    }
    
    // 如果没有活跃效果，返回 null（使用原始视频）
    if (!hasActiveEffects()) {
      return null;
    }
    
    try {
      const result = await processorRef.current.processFrame({
        source: video,
        timestamp,
        width: video.videoWidth,
        height: video.videoHeight,
      });
      
      return result.outputCanvas as HTMLCanvasElement;
    } catch (error) {
      console.error('[BeautyContext] 处理帧失败:', error);
      return null;
    }
  }, [isReady, hasActiveEffects]);
  
  return (
    <BeautyContext.Provider
      value={{
        processor: processorRef.current,
        isReady,
        activeClipId,
        activeSettings,
        setActiveClip,
        updateBeautySettings,
        updateBodySettings,
        updateFilterSettings,
        hasActiveEffects,
        processVideoFrame,
      }}
    >
      {children}
    </BeautyContext.Provider>
  );
}

export function useBeautyContext(): BeautyContextValue {
  const context = useContext(BeautyContext);
  if (!context) {
    throw new Error('useBeautyContext must be used within BeautyProvider');
  }
  return context;
}

// 可选 Hook：不抛错版本，用于非必需场景
export function useBeautyContextOptional(): BeautyContextValue | null {
  return useContext(BeautyContext);
}
