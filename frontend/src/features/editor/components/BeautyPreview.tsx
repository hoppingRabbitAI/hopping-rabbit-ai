/**
 * 美颜预览组件
 * 用于在编辑器中实时预览美颜效果
 */

'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Loader2, Play, Pause, RefreshCw } from 'lucide-react';
import { useVideoBeauty } from '@/lib/beauty';
import type { BeautySettings, BodySettings, FilterSettings } from '@/lib/beauty';

interface BeautyPreviewProps {
  videoSrc: string;
  beautySettings: BeautySettings;
  bodySettings: BodySettings;
  filterSettings: FilterSettings;
  onReady?: () => void;
}

export function BeautyPreview({
  videoSrc,
  beautySettings,
  bodySettings,
  filterSettings,
  onReady,
}: BeautyPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  
  const {
    isReady,
    isProcessing,
    fps,
    outputCanvasRef,
    startProcessing,
    stopProcessing,
    setBeautySettings,
    setBodySettings,
    setFilterSettings,
  } = useVideoBeauty({
    enabled: true,
    targetFPS: 30,
  });
  
  // 同步设置
  useEffect(() => {
    setBeautySettings(beautySettings);
  }, [beautySettings, setBeautySettings]);
  
  useEffect(() => {
    setBodySettings(bodySettings);
  }, [bodySettings, setBodySettings]);
  
  useEffect(() => {
    setFilterSettings(filterSettings);
  }, [filterSettings, setFilterSettings]);
  
  // 视频加载完成
  const handleVideoLoaded = useCallback(() => {
    setIsVideoLoaded(true);
    onReady?.();
  }, [onReady]);
  
  // 开始/停止播放
  const togglePlayback = useCallback(() => {
    if (!videoRef.current || !isReady) return;
    
    if (isPlaying) {
      videoRef.current.pause();
      stopProcessing();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      startProcessing(videoRef.current);
      setIsPlaying(true);
    }
  }, [isPlaying, isReady, startProcessing, stopProcessing]);
  
  // 视频播放结束
  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
    stopProcessing();
  }, [stopProcessing]);
  
  // 重播
  const handleReplay = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current.play();
    startProcessing(videoRef.current);
    setIsPlaying(true);
  }, [startProcessing]);
  
  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      {/* 隐藏的原始视频 */}
      <video
        ref={videoRef}
        src={videoSrc}
        className="hidden"
        onLoadedData={handleVideoLoaded}
        onEnded={handleVideoEnded}
        playsInline
        muted
      />
      
      {/* 输出画布 */}
      <canvas
        ref={outputCanvasRef}
        className="w-full h-full object-contain"
      />
      
      {/* 加载状态 */}
      {(!isReady || !isVideoLoaded) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-white animate-spin mx-auto mb-2" />
            <p className="text-white/80 text-sm">
              {!isReady ? '初始化美颜引擎...' : '加载视频...'}
            </p>
          </div>
        </div>
      )}
      
      {/* 控制栏 */}
      {isReady && isVideoLoaded && (
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
          <div className="flex items-center justify-between">
            {/* 播放控制 */}
            <div className="flex items-center gap-2">
              <button
                onClick={togglePlayback}
                className="w-10 h-10 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-full transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 text-white" />
                ) : (
                  <Play className="w-5 h-5 text-white ml-0.5" />
                )}
              </button>
              <button
                onClick={handleReplay}
                className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
              >
                <RefreshCw className="w-4 h-4 text-white" />
              </button>
            </div>
            
            {/* 状态信息 */}
            <div className="flex items-center gap-4 text-white/70 text-xs">
              {isProcessing && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  处理中
                </span>
              )}
              <span>{fps} FPS</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
