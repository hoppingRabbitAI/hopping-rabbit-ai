/**
 * 预览侧边栏
 * 播放完整视频预览
 * 
 * ★ 参考 VideoPreviewPanel 实现，支持 HLS 流和缓冲状态管理
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, AlertCircle } from 'lucide-react';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import { clipPlaybackService } from './services/ClipPlaybackService';
import Hls from 'hls.js';

interface PreviewSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PreviewSidebar({ isOpen, onClose }: PreviewSidebarProps) {
  const { shots } = useVisualEditorStore();
  
  // ★ 参考 VideoPreviewPanel：使用容器 ref，动态创建视频元素
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);1
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentShotIndex, setCurrentShotIndex] = useState(0);
  
  // 判断是否是 HLS 流
  const isHlsUrl = videoUrl?.includes('.m3u8');
  
  // ★★★ 创建和销毁视频元素 - 参考 VideoPreviewPanel ★★★
  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container || !videoUrl) return;
    
    // 清理旧的 HLS 实例
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    
    setIsVideoReady(false);
    setIsBuffering(false);
    setError(null);
    
    // 创建新的视频元素
    const video = document.createElement('video');
    video.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
    video.playsInline = true;
    video.muted = isMuted;
    video.preload = 'auto';
    
    container.innerHTML = '';
    container.appendChild(video);
    videoRef.current = video;
    
    // 通用事件处理
    const handleVideoReady = () => {
      console.log('[PreviewSidebar] ✅ 视频就绪');
      setIsVideoReady(true);
      setIsLoading(false);
      setDuration(video.duration || 0);
    };
    
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };
    
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => setIsBuffering(false);
    const handleCanPlay = () => setIsBuffering(false);
    const handleError = () => {
      console.error('[PreviewSidebar] 视频加载失败');
      setError('视频加载失败');
      setIsLoading(false);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      // 自动播放下一个分镜
      if (currentShotIndex < shots.length - 1) {
        loadVideoForIndex(currentShotIndex + 1);
      }
    };
    
    // 绑定事件
    video.addEventListener('canplay', handleVideoReady);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('canplaythrough', handleCanPlay);
    video.addEventListener('error', handleError);
    video.addEventListener('ended', handleEnded);
    
    // 加载视频源
    if (isHlsUrl) {
      if (Hls.isSupported()) {
        console.log('[PreviewSidebar] 使用 HLS.js 加载');
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
        });
        hlsRef.current = hls;
        
        hls.loadSource(videoUrl);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            console.error('[PreviewSidebar] HLS 致命错误:', data);
            setError('视频流加载失败');
            setIsLoading(false);
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari 原生 HLS 支持
        console.log('[PreviewSidebar] 使用原生 HLS 支持 (Safari)');
        video.src = videoUrl;
      } else {
        setError('浏览器不支持此视频格式');
        setIsLoading(false);
      }
    } else {
      console.log('[PreviewSidebar] 加载普通视频');
      video.src = videoUrl;
    }
    
    return () => {
      video.removeEventListener('canplay', handleVideoReady);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplaythrough', handleCanPlay);
      video.removeEventListener('error', handleError);
      video.removeEventListener('ended', handleEnded);
      
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
    };
  }, [videoUrl, isHlsUrl]);
  
  // ★ 计算 shots 的唯一标识，用于检测数组内容变化
  const shotsKey = shots.map(s => `${s.id}:${s.replacedVideoUrl || s.videoUrl || s.assetId}`).join('|');
  
  // 获取第一个 shot 的视频 URL 用于预览
  useEffect(() => {
    if (isOpen && shots.length > 0) {
      // 检查当前索引是否还有效
      if (currentShotIndex >= shots.length) {
        // 索引越界（可能是删除了 clip），重置到第一个
        loadVideoForIndex(0);
      } else {
        // 重新加载当前索引的视频（内容可能已变化）
        loadVideoForIndex(currentShotIndex);
      }
    }
    // 关闭时重置状态
    if (!isOpen) {
      setVideoUrl(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setCurrentShotIndex(0);
      setError(null);
    }
  }, [isOpen, shotsKey]); // ★ 使用 shotsKey 替代 shots.length，检测内容变化
  
  // ★★★ 关键修复：监听当前分镜的视频 URL 变化，自动刷新 ★★★
  // 当 shot 的 videoUrl/replacedVideoUrl 变化时（如 AI 生成完成），需要重新加载
  const currentShot = shots[currentShotIndex];
  const currentShotVideoUrl = currentShot?.replacedVideoUrl || currentShot?.videoUrl;
  
  useEffect(() => {
    // 只在侧边栏打开且有 shot 时处理
    if (!isOpen || !currentShot) return;
    
    // 如果当前 shot 的视频 URL 变化了，重新加载
    const newVideoUrl = currentShot.replacedVideoUrl || currentShot.videoUrl;
    if (newVideoUrl && newVideoUrl !== videoUrl) {
      console.log('[PreviewSidebar] 检测到分镜视频 URL 变化，重新加载');
      setVideoUrl(newVideoUrl);
    }
  }, [isOpen, currentShotVideoUrl]);
  
  // ★★★ 核心修复：优先使用 clip 自己的视频 URL（AI生成后的），否则才用 assetId 获取原始视频 ★★★
  const loadVideoForIndex = async (shotIndex: number) => {
    if (shotIndex < 0 || shotIndex >= shots.length) return;
    
    const shot = shots[shotIndex];
    
    setIsLoading(true);
    setIsVideoReady(false);
    setCurrentShotIndex(shotIndex);
    setError(null);
    
    // ★ 优先级：replacedVideoUrl > videoUrl > assetId 获取
    // replacedVideoUrl: AI 生成的替换视频
    // videoUrl: clip 表中保存的视频 URL
    // assetId: 原始素材的视频
    const directVideoUrl = shot.replacedVideoUrl || shot.videoUrl;
    
    if (directVideoUrl) {
      // 直接使用 clip 的视频 URL
      console.log('[PreviewSidebar] 使用 clip 视频 URL (完整):', directVideoUrl);
      setVideoUrl(directVideoUrl);
      setIsLoading(false);
      return;
    }
    
    // 没有直接的视频 URL，使用 assetId 获取原始素材
    if (!shot.assetId) {
      setError('此分镜没有视频');
      setIsLoading(false);
      return;
    }
    
    try {
      console.log('[PreviewSidebar] 通过 assetId 获取视频:', shot.assetId);
      const result = await clipPlaybackService.getPlaybackUrl(shot.assetId);
      setVideoUrl(result.url);
    } catch (err) {
      console.error('[PreviewSidebar] 加载视频失败:', err);
      setError('加载视频失败');
      setIsLoading(false);
    }
  };
  
  // 播放/暂停
  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !isVideoReady) return;
    
    try {
      if (isPlaying) {
        video.pause();
      } else {
        await video.play();
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[PreviewSidebar] 播放失败:', err);
      }
    }
  }, [isPlaying, isVideoReady]);
  
  // 静音切换
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);
  
  // 上一个分镜
  const prevShot = useCallback(() => {
    if (currentShotIndex > 0) {
      loadVideoForIndex(currentShotIndex - 1);
    }
  }, [currentShotIndex, shots]);
  
  // 下一个分镜
  const nextShot = useCallback(() => {
    if (currentShotIndex < shots.length - 1) {
      loadVideoForIndex(currentShotIndex + 1);
    }
  }, [currentShotIndex, shots]);
  
  // 进度条点击
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration || !isVideoReady) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = percent * duration;
    video.currentTime = time;
    setCurrentTime(time);
  }, [duration, isVideoReady]);
  
  // 格式化时间
  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // 计算总时长
  const totalDuration = shots.reduce((sum, shot) => sum + (shot.endTime - shot.startTime), 0);
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed left-0 top-14 bottom-0 w-[420px] bg-white border-r border-gray-200 shadow-sm z-40 flex flex-col animate-slide-in-left overflow-hidden">
      {/* 头部 */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">视频预览</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {shots.length} 个分镜 · 总时长 {formatTime(totalDuration)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* 视频播放区域 - 使用flex-1和max-h约束 */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-3 bg-gray-50">
        <div 
          className="relative bg-gray-950 rounded-xl overflow-hidden"
          style={{ 
            aspectRatio: '9/16',
            height: '100%',
            maxHeight: 'calc(100vh - 280px)',
            width: 'auto'
          }}
        >
          {/* ★ 动态视频容器：视频元素通过 JS 动态插入 */}
          <div
            ref={videoContainerRef}
            className="w-full h-full flex items-center justify-center"
          />

            {/* 加载中 */}
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/90 z-10">
                <div className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-400 mt-3">加载中...</span>
              </div>
            )}

            {/* ★ 缓冲中提示 */}
            {isVideoReady && isBuffering && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/70 pointer-events-none z-10">
                <div className="w-7 h-7 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-400 mt-2">缓冲中...</span>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/90 z-10">
                <AlertCircle size={28} className="text-red-400 mb-2" />
                <span className="text-xs text-red-400">{error}</span>
              </div>
            )}

            {/* 无视频时的占位 */}
            {!videoUrl && !isLoading && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-gray-500 text-xs">无可用视频</span>
              </div>
            )}

            {/* 当前分镜指示 */}
            {shots.length > 0 && (
              <div className="absolute top-3 left-3 px-2.5 py-1 bg-black/40 backdrop-blur-sm rounded-md text-[11px] text-white/80 z-20">
                分镜 {currentShotIndex + 1}/{shots.length}
              </div>
            )}

            {/* ★ 播放控制覆盖层 */}
            {isVideoReady && !isBuffering && !error && (
              <div
                className={`absolute inset-0 flex items-center justify-center cursor-pointer transition-opacity z-10 ${
                  isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100 bg-black/20'
                }`}
                onClick={togglePlay}
              >
                <div className="w-14 h-14 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm">
                  {isPlaying ? (
                    <Pause size={24} className="text-gray-800" />
                  ) : (
                    <Play size={24} className="text-gray-800 ml-0.5" />
                  )}
                </div>
              </div>
            )}
        </div>
      </div>

      {/* 控制栏 - 固定在底部 */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
        {/* 进度条 */}
        <div
          className="h-1 bg-gray-200 rounded-full cursor-pointer group relative"
          onClick={handleProgressClick}
        >
          <div
            className="h-full bg-gray-800 rounded-full relative transition-all"
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-gray-800 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* 时间显示 */}
        <div className="flex items-center justify-between text-[11px] text-gray-400 mt-2 mb-2">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center justify-center gap-4">
          {/* 上一个 */}
          <button
            onClick={prevShot}
            disabled={currentShotIndex === 0}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="上一个分镜"
          >
            <SkipBack size={16} />
          </button>

          {/* 播放/暂停 */}
          <button
            onClick={togglePlay}
            disabled={!isVideoReady || isBuffering}
            className="w-10 h-10 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={isPlaying ? '暂停' : '播放'}
          >
            {isBuffering ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause size={18} />
            ) : (
              <Play size={18} className="ml-0.5" />
            )}
          </button>

          {/* 下一个 */}
          <button
            onClick={nextShot}
            disabled={currentShotIndex >= shots.length - 1}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="下一个分镜"
          >
            <SkipForward size={16} />
          </button>
        </div>
      </div>

      {/* 分镜列表 - 固定高度 */}
      <div className="flex-shrink-0 border-t border-gray-100 overflow-x-auto bg-white">
        <div className="flex gap-2 px-4 py-3">
          {shots.map((shot, index) => (
            <button
              key={shot.id}
              onClick={() => loadVideoForIndex(index)}
              className={`flex-shrink-0 w-[60px] h-[80px] rounded-lg overflow-hidden border-2 transition-all ${
                index === currentShotIndex
                  ? 'border-gray-800 shadow-sm'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
            >
              {shot.thumbnail ? (
                <img
                  src={shot.thumbnail}
                  alt={`分镜 ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gray-50 flex items-center justify-center">
                  <Play size={12} className="text-gray-300" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 动画样式 */}
      <style jsx>{`
        @keyframes slide-in-left {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-left {
          animation: slide-in-left 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
