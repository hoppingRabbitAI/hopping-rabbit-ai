/**
 * Clip 节点组件
 * 显示视频分镜，支持选中、点击播放和 AI 能力菜单
 * 
 * 播放状态机：
 * idle -> loading -> buffering -> playing -> paused/idle
 *                      |            |
 *                      +-> error <--+
 */

'use client';

import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Play, Pause, Loader2, AlertCircle, RefreshCw, X } from 'lucide-react';
import type { ClipNodeData } from './types';
import { clipPlaybackService } from '../services/ClipPlaybackService';
import { useTaskHistoryStore } from '@/stores/taskHistoryStore';
import Hls from 'hls.js';

// 拆分片段类型
interface SplitSegment {
  start_ms: number;
  end_ms: number;
  transcript: string;
  confidence: number;
}

interface SplitAnalysisResult {
  can_split: boolean;
  reason: string;
  segment_count: number;
  segments: SplitSegment[];
  split_strategy: string;
}

// 图片比例缓存 - 避免重复检测
const imageRatioCache = new Map<string, boolean>();

// 播放状态类型
type PlaybackState = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'error';

// 拆分状态类型（简化版：直接拆分，无预览）
type SplitState = 'idle' | 'menu' | 'analyzing' | 'error';

// 拆分策略类型
type SplitStrategy = 'sentence' | 'scene' | 'paragraph';

// 策略配置
const SPLIT_STRATEGIES: { id: SplitStrategy; name: string }[] = [
  { id: 'sentence', name: '分句' },
  { id: 'scene', name: '分镜' },
  { id: 'paragraph', name: '分段' },
];

function ClipNodeComponent({ data, selected }: NodeProps & { data: ClipNodeData }) {
  // ★ 统一的播放状态机
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // ★ 拆分状态
  const [splitState, setSplitState] = useState<SplitState>('idle');
  const [splitResult, setSplitResult] = useState<SplitAnalysisResult | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<SplitStrategy | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  
  // 视频相关
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isHls, setIsHls] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 预加载状态 - 提前获取 URL
  const [preloadedUrl, setPreloadedUrl] = useState<{ url: string; isHls: boolean } | null>(null);
  const preloadAttempted = useRef(false);
  
  // 先从缓存读取，如果没有则根据 aspectRatio 预判
  const cachedRatio = data.thumbnail ? imageRatioCache.get(data.thumbnail) : undefined;
  const aspectRatioVertical = data.aspectRatio === '9:16' || data.aspectRatio === 'vertical';
  const [isVertical, setIsVertical] = useState<boolean | null>(cachedRatio ?? (data.thumbnail ? null : aspectRatioVertical));
  const hasChecked = useRef(false);
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    // 精确到毫秒：0:01.234
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };
  
  // ★ 右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!data.clipId) return;
    
    // 计算菜单位置（clip 右侧 8px，与 clip 顶部对齐）
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPosition({ x: rect.right + 8, y: rect.top });
    }
    setSplitState('menu');
  }, [data.clipId]);
  
  // ★ 关闭菜单
  const closeMenu = useCallback(() => {
    setSplitState('idle');
    setMenuPosition(null);
  }, []);
  
  // ★ 选择拆分策略并直接执行拆分（不需要预览）
  const handleSelectStrategy = useCallback(async (strategy: SplitStrategy) => {
    setSelectedStrategy(strategy);
    setSplitState('analyzing');  // 复用 analyzing 状态显示加载中
    setMenuPosition(null);
    
    if (!data.clipId) return;
    
    // ★ 获取任务历史 store 方法
    const { addOptimisticTask, updateTask, open: openTaskHistory } = useTaskHistoryStore.getState();
    
    try {
      const { authFetch } = await import('@/lib/supabase/session');
      
      // Step 1: 创建直接拆分任务（分析+执行一步完成）
      const response = await authFetch(`/api/clips/${data.clipId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy }),
      });
      
      if (!response.ok) {
        throw new Error(`拆分失败: ${response.status}`);
      }
      
      const { task_id } = await response.json();
      console.log('[ClipNode] 创建拆分任务:', task_id);
      
      // ★ 治标治本：添加乐观任务到历史侧边栏
      const strategyLabel = SPLIT_STRATEGIES.find(s => s.id === strategy)?.name || strategy;
      addOptimisticTask({
        id: task_id,
        task_type: 'clip_split',
        status: 'processing',
        progress: 0,
        status_message: `正在${strategyLabel}...`,
        clip_id: data.clipId,
        input_params: {
          clip_id: data.clipId,
          strategy: strategy,
        },
      });
      
      // 打开任务历史侧边栏
      openTaskHistory();
      
      // Step 2: 轮询任务状态
      const maxAttempts = 60; // 最多等待 120 秒
      const pollInterval = 2000;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        const statusResponse = await authFetch(`/api/tasks/${task_id}`);
        if (!statusResponse.ok) {
          throw new Error(`获取任务状态失败: ${statusResponse.status}`);
        }
        
        const task = await statusResponse.json();
        console.log(`[ClipNode] 任务状态 (${attempt + 1}/${maxAttempts}):`, task.status, task.progress);
        
        // ★ 更新任务进度
        if (task.progress !== undefined) {
          updateTask(task_id, {
            progress: task.progress,
            status_message: task.progress < 50 ? '分析中...' : '拆分中...',
          });
        }
        
        if (task.status === 'completed') {
          const result = task.result;
          
          // ★ 更新任务为完成状态
          updateTask(task_id, {
            status: 'completed',
            progress: 100,
            completed_at: new Date().toISOString(),
          });
          
          if (result.success) {
            // 拆分成功，通知父组件刷新
            console.log('[ClipNode] ✅ 拆分成功:', result.message);
            window.dispatchEvent(new CustomEvent('clips-updated'));
            setSplitState('idle');
          } else {
            // 无法拆分
            console.warn('[ClipNode] ⚠️ 无法拆分:', result.reason);
            setSplitResult({
              can_split: false,
              reason: result.reason || '无法拆分此片段',
              segment_count: 0,
              segments: [],
              split_strategy: strategy
            });
            setSplitState('error');
          }
          return;
        } else if (task.status === 'failed') {
          // 更新任务历史为失败状态
          if (taskId) {
            updateTask(taskId, { 
              status: 'failed', 
              progress: 100,
              error: task.error_message || task.error || '拆分任务失败'
            });
          }
          throw new Error(task.error_message || task.error || '拆分任务失败');
        }
        // 继续轮询...
      }
      
      // 超时也更新任务状态
      if (taskId) {
        updateTask(taskId, { 
          status: 'failed', 
          progress: 100,
          error: '拆分超时，请重试'
        });
      }
      throw new Error('拆分超时，请重试');
    } catch (error) {
      console.error('[ClipNode] 拆分失败:', error);
      // 更新任务历史为失败状态
      if (taskId) {
        updateTask(taskId, { 
          status: 'failed', 
          progress: 100,
          error: error instanceof Error ? error.message : '拆分失败'
        });
      }
      setSplitResult({
        can_split: false,
        reason: error instanceof Error ? error.message : '拆分失败',
        segment_count: 0,
        segments: [],
        split_strategy: 'none'
      });
      setSplitState('error');
    }
  }, [data.clipId]);
  
  // ★ 取消拆分（关闭错误提示）
  const handleCancelSplit = useCallback(() => {
    setSplitState('idle');
    setSplitResult(null);
  }, []);
  
  // ★ 取消选中时自动关闭菜单
  useEffect(() => {
    if (!selected && splitState === 'menu') {
      setSplitState('idle');
      setMenuPosition(null);
    }
  }, [selected, splitState]);
  
  // ★ 预加载：组件挂载或 assetId 变化时提前获取 URL
  useEffect(() => {
    if (!data.assetId || preloadAttempted.current) return;
    preloadAttempted.current = true;
    
    clipPlaybackService.getPlaybackUrl(data.assetId)
      .then(result => {
        setPreloadedUrl(result);
        console.log(`[ClipNode] 预加载完成: ${data.assetId.slice(0, 8)}`, result.isHls ? 'HLS' : 'MP4');
      })
      .catch(err => {
        console.warn('[ClipNode] 预加载失败:', err);
      });
  }, [data.assetId]);
  
  // ★ 清理 HLS 实例
  const cleanupHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);
  
  // ★ 停止播放（保留缩略图显示）
  const stopPlayback = useCallback(() => {
    cleanupHls();
    if (videoRef.current) {
      videoRef.current.pause();
      // ★ 使用 removeAttribute 而不是设置空字符串，避免触发资源加载错误
      videoRef.current.removeAttribute('src');
      videoRef.current.load(); // 重置视频元素状态
    }
    setPlaybackState('idle');
    setVideoUrl(null);
  }, [cleanupHls]);
  
  // 播放/暂停点击处理
  const handlePlayClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止触发节点选中
    
    // 根据当前状态决定操作
    if (playbackState === 'playing') {
      // 暂停（不销毁视频，保持画面）
      if (videoRef.current) {
        videoRef.current.pause();
      }
      setPlaybackState('paused');
      return;
    }
    
    if (playbackState === 'paused') {
      // 恢复播放
      if (videoRef.current) {
        try {
          await videoRef.current.play();
          setPlaybackState('playing');
        } catch (error) {
          console.error('[ClipNode] 恢复播放失败:', error);
          setPlaybackState('error');
          setErrorMessage('播放失败');
        }
      }
      return;
    }
    
    if (playbackState === 'loading' || playbackState === 'buffering') {
      // 正在加载中，取消播放
      stopPlayback();
      return;
    }
    
    // 检查是否有 assetId
    if (!data.assetId) {
      console.warn('[ClipNode] 无法播放：缺少 assetId');
      setPlaybackState('error');
      setErrorMessage('缺少视频资源');
      return;
    }
    
    // 开始加载
    setPlaybackState('loading');
    setErrorMessage(null);
    
    try {
      // 优先使用预加载的 URL
      const result = preloadedUrl || await clipPlaybackService.getPlaybackUrl(data.assetId);
      setVideoUrl(result.url);
      setIsHls(result.isHls);
      // 状态会在视频事件中更新为 buffering -> playing
    } catch (error) {
      console.error('[ClipNode] 获取播放 URL 失败:', error);
      setPlaybackState('error');
      setErrorMessage('加载失败，点击重试');
    }
  }, [playbackState, data.assetId, preloadedUrl, stopPlayback]);
  
  // ★ 视频加载和播放控制 - 支持 HLS
  useEffect(() => {
    if (!videoUrl) return;
    
    const video = videoRef.current;
    if (!video) return;
    
    // 清理旧的 HLS 实例
    cleanupHls();
    
    // 设置缓冲状态
    setPlaybackState('buffering');
    
    const startPlayback = async () => {
      try {
        // Seek 到起始位置
        if (data.startTime !== undefined) {
          video.currentTime = data.startTime;
        }
        await video.play();
        setPlaybackState('playing');
      } catch (error) {
        console.error('[ClipNode] 播放失败:', error);
        // 静音重试（处理自动播放限制）
        video.muted = true;
        try {
          await video.play();
          setPlaybackState('playing');
        } catch (retryError) {
          setPlaybackState('error');
          setErrorMessage('播放失败');
        }
      }
    };
    
    // 处理 HLS 或普通视频
    // ★ 使用 sourceStart（毫秒）来定位源视频位置，如果没有则 fallback 到 startTime（秒）
    const videoStartPosition = data.sourceStart !== undefined 
      ? data.sourceStart / 1000  // 毫秒转秒
      : (data.startTime || 0);
    
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        startPosition: videoStartPosition,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
      });
      hlsRef.current = hls;
      
      hls.loadSource(videoUrl);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        startPlayback();
      });
      
      hls.on(Hls.Events.ERROR, (_, hlsData) => {
        if (hlsData.fatal) {
          console.error('[ClipNode] HLS 错误:', hlsData);
          setPlaybackState('error');
          setErrorMessage('视频加载失败');
        }
      });
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生 HLS
      video.src = videoUrl;
      video.addEventListener('loadedmetadata', startPlayback, { once: true });
    } else {
      // MP4 或其他格式
      video.src = videoUrl;
      video.addEventListener('loadedmetadata', startPlayback, { once: true });
    }
    
    // 监听缓冲事件
    const handleWaiting = () => {
      if (playbackState === 'playing') {
        setPlaybackState('buffering');
      }
    };
    const handlePlaying = () => {
      setPlaybackState('playing');
    };
    const handleTimeUpdate = () => {
      // ★ 使用 sourceEnd（毫秒）来判断何时停止，如果没有则 fallback 到 endTime（秒）
      const videoEndPosition = data.sourceEnd !== undefined 
        ? data.sourceEnd / 1000  // 毫秒转秒
        : data.endTime;
      if (videoEndPosition !== undefined && video.currentTime >= videoEndPosition) {
        stopPlayback();
      }
    };
    const handleEnded = () => {
      stopPlayback();
    };
    const handleError = () => {
      console.error('[ClipNode] 视频错误:', video.error);
      setPlaybackState('error');
      setErrorMessage('视频播放出错');
    };
    
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    
    return () => {
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [videoUrl, isHls, data.startTime, data.endTime, cleanupHls, stopPlayback]);
  
  // 组件卸载时停止播放并清理
  useEffect(() => {
    return () => {
      cleanupHls();
      if (videoRef.current) {
        videoRef.current.pause();
        // ★ 使用 removeAttribute 而不是设置空字符串
        videoRef.current.removeAttribute('src');
      }
    };
  }, [cleanupHls]);

  // 从缩略图自动检测视频比例（只检测一次）
  // ★ 如果没有 thumbnail，使用 aspectRatio 属性判断
  useEffect(() => {
    if (!data.thumbnail) {
      // 没有缩略图时，根据 aspectRatio 判断
      const vertical = data.aspectRatio === '9:16' || data.aspectRatio === 'vertical';
      setIsVertical(vertical);
      return;
    }
    
    // 已有缓存或已检测过，跳过
    if (imageRatioCache.has(data.thumbnail) || hasChecked.current) {
      if (imageRatioCache.has(data.thumbnail)) {
        setIsVertical(imageRatioCache.get(data.thumbnail)!);
      }
      return;
    }
    
    hasChecked.current = true;
    
    const img = new Image();
    img.onload = () => {
      const vertical = img.height > img.width;
      imageRatioCache.set(data.thumbnail!, vertical);
      setIsVertical(vertical);
    };
    img.onerror = () => {
      // 加载失败时也使用 aspectRatio
      const vertical = data.aspectRatio === '9:16' || data.aspectRatio === 'vertical';
      imageRatioCache.set(data.thumbnail!, vertical);
      setIsVertical(vertical);
    };
    img.src = data.thumbnail;
  }, [data.thumbnail, data.aspectRatio]);

  // 等待检测完成 - ★ 仍然需要渲染 Handle，否则边无法连接
  if (isVertical === null) {
    return (
      <div className="relative w-40 h-60 bg-gray-200 rounded-xl animate-pulse flex items-center justify-center">
        <Handle
          type="target"
          position={Position.Left}
          id="target"
          className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
        />
        <Play className="w-8 h-8 text-gray-400" />
        <Handle
          type="source"
          position={Position.Right}
          id="source"
          className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white"
        />
      </div>
    );
  }

  // 根据视频比例设置尺寸
  // 竖屏 9:16: 宽160, 高284
  // 横屏 16:9: 宽320, 高180
  const cardWidth = isVertical ? 160 : 320;
  const previewHeight = isVertical ? 284 : 180;

  return (
    <div
      ref={containerRef}
      className={`
        relative bg-white rounded-xl shadow-lg border-2 transition-all duration-200
        ${selected ? 'border-blue-500 shadow-blue-200' : 'border-gray-200 hover:border-gray-300'}
        overflow-hidden
      `}
      style={{ width: cardWidth }}
      onContextMenu={handleContextMenu}
    >
      {/* 连接点 - 左侧输入 */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
      />
      
      {/* 缩略图 / 视频播放区域 */}
      <div 
        className="relative overflow-hidden"
        style={{ height: previewHeight }}
      >
        {/* ★ 视频元素 - 始终存在但按需显示，避免灰屏 */}
        <video
          ref={videoRef}
          className={`w-full h-full object-cover absolute inset-0 ${
            playbackState === 'idle' || playbackState === 'error' ? 'hidden' : ''
          }`}
          playsInline
          preload="metadata"
        />
        
        {/* 缩略图 - 空闲或错误时显示 */}
        {(playbackState === 'idle' || playbackState === 'error') && data.thumbnail && (
          <img
            src={data.thumbnail}
            alt={`Clip ${data.index + 1}`}
            className="w-full h-full object-cover"
          />
        )}
        
        {/* 无缩略图时的占位符 */}
        {(playbackState === 'idle' || playbackState === 'error') && !data.thumbnail && (
          <div className="w-full h-full bg-gray-900 flex items-center justify-center">
            <Play className="w-12 h-12 text-gray-600" />
          </div>
        )}
        
        {/* ★ 缓冲中指示器 - 覆盖在视频上 */}
        {playbackState === 'buffering' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
              <span className="text-white text-xs">缓冲中...</span>
            </div>
          </div>
        )}
        
        {/* ★ 错误状态 - 提供重试选项 */}
        {playbackState === 'error' && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-black/50 cursor-pointer"
            onClick={handlePlayClick}
          >
            <div className="flex flex-col items-center gap-2">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <span className="text-white text-xs">{errorMessage || '播放失败'}</span>
              <div className="flex items-center gap-1 text-white/70 text-xs">
                <RefreshCw className="w-3 h-3" />
                <span>点击重试</span>
              </div>
            </div>
          </div>
        )}
        
        {/* 播放按钮 - 点击触发播放/暂停 */}
        {selected && playbackState !== 'error' && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer"
            onClick={handlePlayClick}
          >
            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
              {playbackState === 'loading' ? (
                <Loader2 className="w-6 h-6 text-gray-800 animate-spin" />
              ) : playbackState === 'buffering' ? (
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              ) : playbackState === 'playing' ? (
                <Pause className="w-6 h-6 text-gray-800" />
              ) : playbackState === 'paused' ? (
                <Play className="w-6 h-6 text-green-600 ml-0.5" />
              ) : (
                <Play className="w-6 h-6 text-gray-800 ml-0.5" />
              )}
            </div>
          </div>
        )}
        
        {/* 时长标签 - 播放时隐藏 */}
        {data.startTime !== undefined && data.endTime !== undefined && 
         playbackState !== 'playing' && playbackState !== 'buffering' && (
          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/70 rounded text-white text-xs">
            {formatTime(data.endTime - data.startTime)}
          </div>
        )}
        
        {/* ★ 暂停状态标签 */}
        {playbackState === 'paused' && (
          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-blue-600 rounded text-white text-xs">
            已暂停
          </div>
        )}
      </div>
      
      {/* ★ 右键菜单 - 使用 Portal 渲染到 body，彻底避免被裁切 */}
      {splitState === 'menu' && menuPosition && createPortal(
        <>
          {/* 遮罩层 - 点击关闭菜单 */}
          <div className="fixed inset-0 z-[100]" onClick={closeMenu} />
          {/* 菜单 */}
          <div 
            className="fixed z-[101] bg-white rounded-md shadow-lg border border-gray-200 py-1"
            style={{ left: menuPosition.x, top: menuPosition.y }}
          >
            {SPLIT_STRATEGIES.map((strategy) => (
              <button
                key={strategy.id}
                className="w-full px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100 text-left whitespace-nowrap"
                onClick={() => handleSelectStrategy(strategy.id)}
              >
                {strategy.name}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
      
      {/* 拆分分析中 */}
      {splitState === 'analyzing' && (
        <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center gap-2 rounded-xl">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-sm text-gray-600">拆分中...</span>
        </div>
      )}
      
      {/* 拆分失败/无法拆分 */}
      {splitState === 'error' && splitResult && (
        <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center gap-2 rounded-xl p-3">
          <AlertCircle className="w-8 h-8 text-orange-500" />
          <span className="text-sm text-gray-700 text-center">{splitResult.reason}</span>
          <button 
            onClick={handleCancelSplit}
            className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-600 hover:bg-gray-200"
          >
            关闭
          </button>
        </div>
      )}
      
      {/* 连接点 - 右侧输出 */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white"
      />
    </div>
  );
}

export const ClipNode = memo(ClipNodeComponent);
