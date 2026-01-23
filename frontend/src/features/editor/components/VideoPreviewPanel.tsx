/**
 * 视频预览面板组件
 * 复用于多个弹窗：换气清理、智能分析等
 * 支持前后上下文预览，高亮显示目标片段区域
 * 
 * ★ 注意：创建独立的视频实例，避免与主画布预热池冲突
 */
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import Hls from 'hls.js';
import { msToSec, secToMs } from '../lib/time-utils';

// 调试开关 - ★ 已关闭，视频缓冲日志在 VideoCanvasStore 中
const DEBUG_ENABLED = false;
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[VideoPreviewPanel]', ...args); };

// 预览上下文时长（毫秒）- 前后各2秒
const CONTEXT_DURATION = 2000;

export interface PreviewSegment {
  id: string;
  text?: string;
  // 原始视频时间（毫秒）
  sourceStart: number;
  sourceEnd: number;
  // 片段类型/分类
  classification?: string;
  // 显示用的标签
  label?: string;
}

interface VideoPreviewPanelProps {
  videoUrl: string;
  segment: PreviewSegment | null;
  // ★ 新增：资源ID，用于从预热池获取已缓冲的视频
  assetId?: string;
  // 片段类型配色
  segmentColor?: string; // 默认 emerald
  // 标签图标
  icon?: React.ReactNode;
  // 空状态提示
  emptyTitle?: string;
  emptyDesc?: string;
}

export function VideoPreviewPanel({
  videoUrl,
  segment,
  assetId,
  segmentColor = 'emerald',
  icon,
  emptyTitle = '点击右侧预览按钮',
  emptyDesc = '查看片段的前后2秒上下文',
}: VideoPreviewPanelProps) {
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const animationRef = useRef<number | null>(null);
  const seekedHandledRef = useRef<boolean>(false);
  const usingPreheatedRef = useRef<boolean>(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [isInSegmentZone, setIsInSegmentZone] = useState(false);

  // 计算预览范围
  const previewStart = segment ? Math.max(0, segment.sourceStart - CONTEXT_DURATION) : 0;
  const previewEnd = segment ? segment.sourceEnd + CONTEXT_DURATION : 0;
  const totalDuration = previewEnd - previewStart;
  const segmentDuration = segment ? segment.sourceEnd - segment.sourceStart : 0;

  // 判断是否是 HLS 流
  const isHlsUrl = videoUrl?.includes('.m3u8');

  // ★★★ 创建独立的视频实例，避免与主画布冲突 ★★★
  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container || !videoUrl) return;

    // 清理旧的 HLS 实例（如果有）
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setIsVideoReady(false);
    usingPreheatedRef.current = false;

    // 创建新的视频元素（不复用预热池，避免与主画布冲突）
    debugLog('📦 创建新视频元素，加载:', videoUrl.slice(-30));
    const video = document.createElement('video');
    video.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
    video.playsInline = true;
    video.muted = false;
    video.preload = 'auto';
    
    container.innerHTML = '';
    container.appendChild(video);
    videoRef.current = video;

    // 通用的视频就绪处理
    const handleVideoReady = () => {
      debugLog('✅ 视频就绪, readyState:', video.readyState, 'duration:', video.duration);
      setIsVideoReady(true);
    };

    if (isHlsUrl) {
      if (Hls.isSupported()) {
        debugLog('使用 HLS.js 加载');
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
        });
        hlsRef.current = hls;

        hls.loadSource(videoUrl);
        hls.attachMedia(video);

        video.addEventListener('canplay', handleVideoReady);

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            debugLog('HLS 致命错误:', data);
            setIsVideoReady(false);
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        debugLog('使用原生 HLS 支持 (Safari)');
        video.src = videoUrl;
        // ★★★ Safari 原生 HLS：需要额外监听 loadeddata 确保画面就绪 ★★★
        video.addEventListener('canplay', handleVideoReady);
        video.addEventListener('loadeddata', () => {
          debugLog('📺 loadeddata 事件 (Safari):', video.readyState, video.videoWidth, 'x', video.videoHeight);
        });
      }
    } else {
      debugLog('加载普通视频');
      video.src = videoUrl;
      video.addEventListener('canplay', handleVideoReady);
    }

    return () => {
      video.removeEventListener('canplay', handleVideoReady);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      // 销毁创建的视频元素
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
    };
  }, [videoUrl, isHlsUrl]);

  // ★★★ 监听视频缓冲状态 ★★★
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleWaiting = () => {
      debugLog('⏳ 缓冲中...');
      setIsBuffering(true);
    };

    const handlePlaying = () => {
      debugLog('▶ 缓冲恢复，继续播放');
      setIsBuffering(false);
    };

    const handleCanPlay = () => {
      setIsBuffering(false);
    };

    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('canplay', handleCanPlay);

    return () => {
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplay', handleCanPlay);
    };
  }, [isVideoReady]);

  // 当 segment 变化时重置播放状态并设置起始时间
  useEffect(() => {
    if (segment && videoRef.current) {
      setIsPlaying(false);
      setPlaybackProgress(0);
      setIsInSegmentZone(false);
      
      const video = videoRef.current;
      video.pause();
      
      const startTime = msToSec(Math.max(0, segment.sourceStart - CONTEXT_DURATION));
      
      // 设置视频时间的函数
      const setVideoTime = () => {
        debugLog('🎯 设置 segment 起始时间:', startTime, '秒, readyState:', video.readyState);
        debugLog('   视频尺寸:', video.videoWidth, 'x', video.videoHeight, '| 容器:', videoContainerRef.current?.clientWidth, 'x', videoContainerRef.current?.clientHeight);
        debugLog('   paused:', video.paused, '| muted:', video.muted, '| src:', video.src?.slice(-30) || video.currentSrc?.slice(-30));
        
        // ★★★ 添加 seeked 事件监听，确保 seek 完成后画面更新 ★★★
        const handleSeeked = () => {
          debugLog('✅ seeked 完成, currentTime:', video.currentTime);
          video.removeEventListener('seeked', handleSeeked);
        };
        video.addEventListener('seeked', handleSeeked);
        
        video.currentTime = startTime;
      };
      
      // 如果视频已经就绪，直接设置时间
      if (video.readyState >= 2) {
        setVideoTime();
      } else {
        // 等待 canplay 事件
        debugLog('⏳ 等待视频就绪...');
        const handleCanPlay = () => {
          debugLog('📺 canplay 事件触发, 设置时间');
          video.removeEventListener('canplay', handleCanPlay);
          setVideoTime();
        };
        video.addEventListener('canplay', handleCanPlay);
        
        return () => {
          video.removeEventListener('canplay', handleCanPlay);
        };
      }
    }
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [segment?.id, isVideoReady]);

  // 播放/暂停控制
  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !segment || !isVideoReady) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    } else {
      seekedHandledRef.current = false;
      
      const startPlayback = async () => {
        if (seekedHandledRef.current) return;
        seekedHandledRef.current = true;
        
        debugLog('开始播放, currentTime =', video.currentTime);
        
        try {
          await video.play();
          setIsPlaying(true);
          
          const checkPlayback = () => {
            if (!video || !segment) return;
            
            const currentMs = secToMs(video.currentTime);
            const elapsed = currentMs - previewStart;
            
            // 更新进度
            const progress = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
            setPlaybackProgress(progress);
            
            // 检查是否在目标片段区域
            const inZone = currentMs >= segment.sourceStart && currentMs <= segment.sourceEnd;
            setIsInSegmentZone(inZone);
            
            // 到达预览结束点时停止
            if (currentMs >= previewEnd) {
              video.pause();
              video.currentTime = msToSec(previewStart);
              setIsPlaying(false);
              setPlaybackProgress(0);
              setIsInSegmentZone(false);
              return;
            }
            
            animationRef.current = requestAnimationFrame(checkPlayback);
          };
          animationRef.current = requestAnimationFrame(checkPlayback);
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            debugLog('播放失败:', err);
          }
        }
      };
      
      const handleSeeked = () => {
        video.removeEventListener('seeked', handleSeeked);
        startPlayback();
      };
      
      video.addEventListener('seeked', handleSeeked);
      video.currentTime = msToSec(previewStart);
      
      setTimeout(() => {
        if (!seekedHandledRef.current && Math.abs(video.currentTime - msToSec(previewStart)) < 0.1) {
          video.removeEventListener('seeked', handleSeeked);
          startPlayback();
        }
      }, 300);
    }
  }, [isPlaying, isVideoReady, segment, previewStart, previewEnd, totalDuration]);

  // 点击时间轴跳转
  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !segment) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    
    const targetTime = previewStart + percentage * totalDuration;
    video.currentTime = msToSec(targetTime);
    setPlaybackProgress(percentage * 100);
    
    // 更新区域状态
    const inZone = targetTime >= segment.sourceStart && targetTime <= segment.sourceEnd;
    setIsInSegmentZone(inZone);
  }, [segment, previewStart, totalDuration]);

  // 格式化时间
  const formatTime = (ms: number) => {
    const sec = msToSec(ms);
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(2);
    return `${m}:${s.padStart(5, '0')}`;
  };

  // 颜色配置映射
  const colorMap: Record<string, { bg: string; bgActive: string; border: string; borderActive: string; shadow: string }> = {
    emerald: {
      bg: 'bg-emerald-500/60',
      bgActive: 'bg-emerald-400',
      border: 'border-emerald-400',
      borderActive: 'border-emerald-300',
      shadow: 'shadow-emerald-500/50',
    },
    red: {
      bg: 'bg-red-500/60',
      bgActive: 'bg-red-400',
      border: 'border-red-400',
      borderActive: 'border-red-300',
      shadow: 'shadow-red-500/50',
    },
    amber: {
      bg: 'bg-amber-500/60',
      bgActive: 'bg-amber-400',
      border: 'border-amber-400',
      borderActive: 'border-amber-300',
      shadow: 'shadow-amber-500/50',
    },
  };
  const colorClasses = colorMap[segmentColor] || colorMap.emerald;

  if (!segment) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 bg-black/30">
        {icon && <div className="text-gray-700 mb-3">{icon}</div>}
        <p className="text-sm">{emptyTitle}</p>
        <p className="text-xs text-gray-600 mt-1">{emptyDesc}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-black/30">
      {/* 视频预览区域 */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="relative w-full max-w-[400px] aspect-video bg-black rounded-lg overflow-hidden shadow-xl">
          {/* ★ 动态视频容器：视频元素通过 JS 动态插入/复用 */}
          <div 
            ref={videoContainerRef}
            className="w-full h-full"
          />
          
          {/* 视频加载中提示 */}
          {!isVideoReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="text-center space-y-2">
                <RabbitLoader size={48} />
                <p className="text-xs text-gray-400">
                  {assetId ? '加载预热视频...' : '视频加载中...'}
                </p>
              </div>
            </div>
          )}
          
          {/* ★ 缓冲中提示（视频已就绪但正在缓冲） */}
          {isVideoReady && isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
              <div className="text-center space-y-2">
                <RabbitLoader size={48} />
                <p className="text-xs text-gray-400">缓冲中...</p>
              </div>
            </div>
          )}
          
          {/* 目标片段区域提示 */}
          {isInSegmentZone && isPlaying && (
            <div className="absolute inset-0 pointer-events-none">
              <div className={`absolute inset-0 border-4 ${colorClasses.borderActive} animate-pulse rounded-lg`} />
              <div className={`absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 ${colorClasses.bgActive} text-white text-sm font-bold rounded-full shadow-lg flex items-center space-x-2 animate-bounce`}>
                {icon}
                <span>{segment.label || '片段播放中'}</span>
              </div>
            </div>
          )}
          
          {/* 播放控制覆盖层 */}
          <div 
            className={`absolute inset-0 flex items-center justify-center transition-opacity ${
              !isVideoReady || isBuffering ? 'pointer-events-none' : 'cursor-pointer'
            } ${
              isPlaying && !isInSegmentZone ? 'opacity-0 hover:opacity-100' : 
              isPlaying ? 'opacity-0' : 
              isVideoReady && !isBuffering ? 'opacity-100 bg-black/30' : 'opacity-0'
            }`}
            onClick={isVideoReady && !isBuffering ? togglePlay : undefined}
          >
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              {isBuffering ? (
                <RabbitLoader size={28} />
              ) : isPlaying ? (
                <Pause size={28} className="text-white" />
              ) : (
                <Play size={28} className="text-white ml-1" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 预览信息和时间轴 */}
      <div className="px-4 pb-4">
        {/* 片段文本 */}
        {segment.text && (
          <div className="mb-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-900">"{segment.text}"</p>
          </div>
        )}
        
        <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
          {/* 可拖动时间轴 */}
          <div 
            className="relative h-12 bg-gray-200 rounded overflow-hidden cursor-pointer group"
            onClick={handleSeek}
          >
            {/* 前2秒区域 */}
            <div 
              className="absolute h-full bg-gray-300 transition-colors hover:bg-gray-400"
              style={{ 
                left: 0, 
                width: `${(CONTEXT_DURATION / totalDuration) * 100}%` 
              }}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-600">
                前2秒
              </span>
            </div>
            
            {/* 目标片段区域（中间高亮） */}
            <div 
              className={`absolute h-full border-x-2 transition-all ${
                isInSegmentZone 
                  ? `${colorClasses.bgActive} ${colorClasses.borderActive} shadow-lg ${colorClasses.shadow}` 
                  : `${colorClasses.bg} ${colorClasses.border} hover:opacity-80`
              }`}
              style={{ 
                left: `${(CONTEXT_DURATION / totalDuration) * 100}%`,
                width: `${(segmentDuration / totalDuration) * 100}%` 
              }}
            >
              <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold transition-colors ${
                isInSegmentZone ? 'text-white' : 'text-white/80'
              }`}>
                {segment.label || '片段'} {(segmentDuration / 1000).toFixed(2)}s
              </span>
            </div>
            
            {/* 后2秒区域 */}
            <div 
              className="absolute h-full bg-gray-300 right-0 transition-colors hover:bg-gray-400"
              style={{ 
                width: `${(CONTEXT_DURATION / totalDuration) * 100}%` 
              }}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-600">
                后2秒
              </span>
            </div>
            
            {/* 播放进度指示器（播放头） */}
            <div 
              className="absolute top-0 bottom-0 w-1 bg-white shadow-lg shadow-white/50 z-10"
              style={{ 
                left: `${playbackProgress}%`,
                transform: 'translateX(-50%)'
              }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-white" />
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[8px] border-l-transparent border-r-transparent border-b-white" />
            </div>
            
            {/* 悬浮提示 */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-black/80 text-white text-[9px] rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
              点击或拖动调整播放位置
            </div>
          </div>

          {/* 说明 */}
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>播放范围：{formatTime(previewStart)} - {formatTime(previewEnd)}</span>
            <div className="flex items-center space-x-1">
              <Volume2 size={12} />
              <span>请开启声音</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VideoPreviewPanel;
