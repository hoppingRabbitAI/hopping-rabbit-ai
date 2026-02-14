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
import { useMenuCoordination } from './useMenuCoordination';
import type { NodeProps } from '@xyflow/react';
import { Play, Pause, Loader2, AlertCircle, RefreshCw, X, Scissors, Trash2, ListVideo, Check, ImagePlus, Plus, Layers, Sparkles, Copy, Eye, Lock, LockOpen, PenSquare, FolderHeart, StopCircle } from 'lucide-react';
import type { ClipNodeData } from './types';
import { clipPlaybackService } from '../services/ClipPlaybackService';
import { useTaskHistoryStore } from '@/stores/taskHistoryStore';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import { MaterialsApi } from '@/lib/api/materials';
import { toast } from '@/lib/stores/toast-store';
import { cancelAITask } from '@/lib/api/kling-tasks';
import Hls from 'hls.js';

// 图片比例缓存 - 存储实际宽高比（width / height），精确自适应
const imageRatioCache = new Map<string, number>();

// 播放状态类型
type PlaybackState = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'error';

// 拆分状态类型（简化版：直接拆分，无预览）
type SplitState = 'idle' | 'menu' | 'analyzing' | 'error';

function ClipNodeComponent({ data, selected }: NodeProps & { data: ClipNodeData }) {
  // ★ 判断媒体类型：图片节点 vs 视频节点
  const isImageNode = data.mediaType === 'image';
  
  // ★ 统一的播放状态机
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // ★ 拆分状态
  const [splitState, setSplitState] = useState<SplitState>('idle');
  const [splitErrorMsg, setSplitErrorMsg] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  
  // ★ 保存到素材库状态
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  
  // 视频相关
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isHls, setIsHls] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 预加载状态 - 提前获取 URL
  const [preloadedUrl, setPreloadedUrl] = useState<{ url: string; isHls: boolean } | null>(null);
  const preloadAttempted = useRef(false);
  
  // ★ 图片实际宽高比（width / height），用于精确自适应卡片尺寸
  const aspectRatioVertical = data.aspectRatio === '9:16' || data.aspectRatio === 'vertical';
  const hasExplicitAspectRatio = !!data.aspectRatio;
  const cachedWHRatio = (!hasExplicitAspectRatio && data.thumbnail) ? imageRatioCache.get(data.thumbnail) : undefined;
  // 从 data.aspectRatio 推断默认数值比例
  const defaultWHRatio = aspectRatioVertical ? 9 / 16 : 16 / 9;
  const [whRatio, setWhRatio] = useState<number | null>(
    hasExplicitAspectRatio ? defaultWHRatio : (cachedWHRatio ?? (data.thumbnail ? null : defaultWHRatio))
  );
  // 向后兼容：isVertical 从 whRatio 派生
  const isVertical = whRatio !== null ? whRatio < 1 : null;
  const hasChecked = useRef(false);
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    // 精确到毫秒：0:01.234
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };
  
  // ★★★ 自动检测视频元数据：当 duration=0 或 aspectRatio 可能不准时，通过加载 metadata 获取真实时长和比例 ★★★
  const metadataProbed = useRef(false);
  useEffect(() => {
    if (metadataProbed.current) return;
    if (!data.isFreeNode || !data.videoUrl || isImageNode) return;
    const needsDuration = !data.duration || data.duration <= 0;
    // ★★★ 关键修复：始终探测 aspectRatio（不信任已有值），因为占位创建时可能继承了源节点的错误比例
    // HLS 视频无法通过 video 元素探测
    if (data.videoUrl.includes('.m3u8')) return;
    // 如果 duration 已正确且已跳过探测一次，才跳过（首次始终探测 aspectRatio）
    if (!needsDuration && metadataProbed.current) return;
    
    metadataProbed.current = true;
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = data.videoUrl;
    probe.onloadedmetadata = () => {
      const updates: Record<string, unknown> = {};
      
      // ★ 探测时长
      const realDuration = probe.duration;
      if (needsDuration && realDuration && isFinite(realDuration) && realDuration > 0) {
        updates.duration = realDuration;
      }
      
      // ★ 探测宽高比 — 始终以实际视频像素为准（治本）
      const vw = probe.videoWidth;
      const vh = probe.videoHeight;
      if (vw > 0 && vh > 0) {
        const detectedRatio: '9:16' | '16:9' = vh > vw ? '9:16' : '16:9';
        if (detectedRatio !== data.aspectRatio) {
          updates.aspectRatio = detectedRatio;
          console.log(`[ClipNode] ★ aspectRatio 纠正: ${data.aspectRatio} → ${detectedRatio} (实际 ${vw}x${vh})`);
        }
      }
      
      if (Object.keys(updates).length > 0) {
        console.log(`[ClipNode] ★ 视频元数据探测:`, {
          clipId: data.clipId,
          duration: (updates.duration as number)?.toFixed(2) || '(unchanged)',
          aspectRatio: updates.aspectRatio || '(unchanged)',
          videoSize: `${vw}x${vh}`,
        });
        const { updateFreeNode } = useVisualEditorStore.getState();
        updateFreeNode(data.clipId, updates as any);
      }
      
      probe.removeAttribute('src');
      probe.load();
    };
    probe.onerror = () => {
      console.warn('[ClipNode] 探测视频元数据失败');
      probe.removeAttribute('src');
    };
  }, [data.isFreeNode, data.duration, data.aspectRatio, data.videoUrl, data.clipId]);
  
  // ★ 菜单协调：打开自己时关闭其他菜单，收到关闭事件时关闭自己
  const { broadcastCloseMenus } = useMenuCoordination(() => {
    setSplitState('idle');
    setMenuPosition(null);
  });

  // ★ 右键菜单处理 — 不需要先左键选中
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!data.clipId) return;
    
    broadcastCloseMenus();  // ★ 通知其他菜单关闭
    // ★ 使用鼠标位置而非节点位置，更直观
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setSplitState('menu');
  }, [data.clipId, broadcastCloseMenus]);
  
  // ★ 关闭菜单
  const closeMenu = useCallback(() => {
    setSplitState('idle');
    setMenuPosition(null);
  }, []);

  // ★ 取消生成任务 + 删除节点
  const handleCancelAndDelete = useCallback(async () => {
    closeMenu();
    if (!data.clipId) return;
    
    // 1. 取消关联的 AI 任务
    if (data.generatingTaskId) {
      try {
        await cancelAITask(data.generatingTaskId as string);
        console.log('[ClipNode] ✅ 已取消 AI 任务:', data.generatingTaskId);
      } catch (err) {
        console.warn('[ClipNode] ⚠️ 取消任务失败（可能已完成）:', err);
        // 即使取消失败也继续删除节点
      }
    }
    
    // 2. 删除节点
    if (data.isFreeNode && data.onDeleteFreeNode) {
      (data.onDeleteFreeNode as (id: string) => void)(data.clipId);
    } else {
      useVisualEditorStore.getState().deleteShot(data.clipId);
    }
    
    toast.success('已取消任务并删除');
  }, [closeMenu, data.clipId, data.generatingTaskId, data.isFreeNode, data.onDeleteFreeNode]);

  const emitInsertMenuEvent = useCallback((direction: 'before' | 'after', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!data.clipId) return;

    window.dispatchEvent(new CustomEvent('workflow-close-all-menus'));
    window.dispatchEvent(new CustomEvent(direction === 'before' ? 'add-node-before' : 'add-node-after', {
      detail: {
        clipId: data.clipId,
        anchorX: e.clientX,
        anchorY: e.clientY,
      },
    }));
  }, [data.clipId]);
  
  // ★ 一键拆镜头（场景检测）
  const handleSplit = useCallback(async () => {
    setSplitState('analyzing');
    setMenuPosition(null);
    setSplitErrorMsg(null);
    
    if (!data.clipId) return;
    
    const { addOptimisticTask, updateTask, open: openTaskHistory } = useTaskHistoryStore.getState();
    
    try {
      const { authFetch } = await import('@/lib/supabase/session');
      
      const response = await authFetch(`/api/clips/${data.clipId}/split`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error(`拆分失败: ${response.status}`);
      }
      
      const { task_id } = await response.json();
      console.log('[ClipNode] 创建拆分任务:', task_id);
      
      addOptimisticTask({
        id: task_id,
        task_type: 'clip_split',
        status: 'processing',
        progress: 0,
        status_message: '场景检测中...',
        clip_id: data.clipId,
        input_params: { clip_id: data.clipId },
      });
      openTaskHistory();
      
      // 轮询任务状态
      const maxAttempts = 90; // 最多等待 180 秒（场景检测可能较慢）
      const pollInterval = 2000;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        const statusResponse = await authFetch(`/api/tasks/${task_id}`);
        if (!statusResponse.ok) {
          throw new Error(`获取任务状态失败: ${statusResponse.status}`);
        }
        
        const task = await statusResponse.json();
        
        if (task.progress !== undefined) {
          updateTask(task_id, {
            progress: task.progress,
            status_message: task.progress < 50 ? '场景检测中...' : '拆分中...',
          });
        }
        
        if (task.status === 'completed') {
          const result = task.result;
          updateTask(task_id, {
            status: 'completed',
            progress: 100,
            completed_at: new Date().toISOString(),
          });
          
          if (result.success) {
            console.log('[ClipNode] ✅ 拆分成功:', result.message);
            window.dispatchEvent(new CustomEvent('clips-updated'));
            setSplitState('idle');
          } else {
            console.warn('[ClipNode] ⚠️ 无法拆分:', result.reason);
            setSplitErrorMsg(result.reason || '无法拆分此片段');
            setSplitState('error');
          }
          return;
        } else if (task.status === 'failed') {
          updateTask(task_id, {
            status: 'failed',
            progress: 100,
            error_message: task.error_message || '拆分任务失败'
          });
          throw new Error(task.error_message || '拆分任务失败');
        }
      }
      
      updateTask(task_id, {
        status: 'failed',
        progress: 100,
        error_message: '拆分超时，请重试'
      });
      throw new Error('拆分超时，请重试');
    } catch (error) {
      console.error('[ClipNode] 拆分失败:', error);
      setSplitErrorMsg(error instanceof Error ? error.message : '拆分失败');
      setSplitState('error');
    }
  }, [data.clipId]);
  
  // ★ 取消拆分（关闭错误提示）
  const handleCancelSplit = useCallback(() => {
    setSplitState('idle');
    setSplitErrorMsg(null);
  }, []);
  
  // ★★★ 关键修复：当 data.videoUrl 变化时（视频替换后），重置预加载状态和播放状态 ★★★
  // ★ 用 ref 追踪上一次的 videoUrl，只在 URL 真正变化时才执行重置，避免 playbackState 触发无限循环
  const prevVideoUrlRef = useRef(data.videoUrl);
  useEffect(() => {
    // ★ 图片节点不需要视频相关逻辑
    if (isImageNode) return;
    
    const prevUrl = prevVideoUrlRef.current;
    prevVideoUrlRef.current = data.videoUrl;
    
    // ★ 只有 URL 真正变化时才处理（防止 playbackState 变化触发的无限循环）
    if (data.videoUrl === prevUrl) return;
    
    // 如果有直接的 videoUrl，清除预加载缓存（确保使用新 URL）
    if (data.videoUrl) {
      console.log('[ClipNode] 检测到 videoUrl 变化，清除预加载缓存:', data.videoUrl.slice(-50));
      setPreloadedUrl(null);
      preloadAttempted.current = true;  // 不再预加载原始视频
      
      // 如果正在播放，停止并重置状态（切换了视频源，需要重新开始）
      if (videoRef.current && videoRef.current.src) {
        console.log('[ClipNode] 视频 URL 变化，重置播放状态');
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      // 内联清理 HLS
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      setVideoUrl(null);
      setPlaybackState('idle');
    }
  }, [data.videoUrl]);
  
  // ★ 预加载：组件挂载或 assetId 变化时提前获取 URL
  // ★★★ 注意：如果已有 data.videoUrl，跳过预加载（替换视频后优先使用直接 URL）
  useEffect(() => {
    // ★ 图片节点不需要预加载视频
    if (isImageNode) return;
    // 如果已有直接 videoUrl，不需要预加载原始素材
    if (data.videoUrl) return;
    if (!data.assetId || preloadAttempted.current) return;
    preloadAttempted.current = true;
    
    clipPlaybackService.getPlaybackUrl(data.assetId)
      .then(result => {
        setPreloadedUrl(result);
        console.log(`[ClipNode] 预加载完成: ${data.assetId!.slice(0, 8)}`, result.isHls ? 'HLS' : 'MP4');
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
    
    // 检查是否有 assetId 或直接 videoUrl
    if (!data.assetId && !data.videoUrl) {
      console.warn('[ClipNode] 无法播放：缺少 assetId 或 videoUrl');
      setPlaybackState('error');
      setErrorMessage('缺少视频资源');
      return;
    }
    
    // 开始加载
    setPlaybackState('loading');
    setErrorMessage(null);
    
    try {
      // ★★★ 关键修复：始终优先使用直接 videoUrl（替换后的视频）
      if (data.videoUrl) {
        console.log('[ClipNode] 使用替换后的视频 URL (完整):', data.videoUrl);
        setVideoUrl(data.videoUrl);
        // 根据 URL 判断是否是 HLS（与其他 clip 一致的逻辑）
        setIsHls(data.videoUrl.includes('.m3u8'));
        return;
      }
      
      // 否则使用预加载的 URL 或从服务获取
      const result = preloadedUrl || await clipPlaybackService.getPlaybackUrl(data.assetId!);
      console.log('[ClipNode] 使用原始素材 URL:', result.url.slice(-50));
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
    // ★ 图片节点不需要视频播放
    if (isImageNode) return;
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
      // ★★★ 关键修复：当 endTime 为 0（AI 生成视频 duration 未知时），不自动停止，让视频自然播完
      if (videoEndPosition && videoEndPosition > 0 && video.currentTime >= videoEndPosition) {
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

  // 从缩略图自动检测比例（只检测一次）
  // ★ 优先使用 data.aspectRatio → 图片缓存 → 图片加载探测
  useEffect(() => {
    // ★ 如果有明确的 aspectRatio，直接使用（最高优先级）
    if (data.aspectRatio) {
      const ratio = (data.aspectRatio === '9:16' || data.aspectRatio === 'vertical') ? 9 / 16 : 16 / 9;
      setWhRatio(ratio);
      return;
    }
    
    if (!data.thumbnail) {
      // 没有缩略图也没有 aspectRatio，默认横屏
      setWhRatio(16 / 9);
      return;
    }
    
    // 已有缓存或已检测过，跳过
    if (imageRatioCache.has(data.thumbnail) || hasChecked.current) {
      if (imageRatioCache.has(data.thumbnail)) {
        setWhRatio(imageRatioCache.get(data.thumbnail)!);
      }
      return;
    }
    
    hasChecked.current = true;
    
    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight;
      imageRatioCache.set(data.thumbnail!, ratio);
      setWhRatio(ratio);
    };
    img.onerror = () => {
      // 加载失败时使用 aspectRatio 推断
      const ratio = (data.aspectRatio === '9:16' || data.aspectRatio === 'vertical') ? 9 / 16 : 16 / 9;
      imageRatioCache.set(data.thumbnail!, ratio);
      setWhRatio(ratio);
    };
    img.src = data.thumbnail;
  }, [data.thumbnail, data.aspectRatio]);

  // 等待检测完成 - ★ 仍然需要渲染 Handle，否则边无法连接
  if (whRatio === null) {
    return (
      <div className="relative w-40 h-60 bg-gray-200 rounded-xl animate-pulse flex items-center justify-center">
        <Handle type="target" position={Position.Left} id="target" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" />
        <Handle type="source" position={Position.Right} id="source" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" />
        <Handle type="target" position={Position.Top} id="target-top" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" />
        <Handle type="source" position={Position.Bottom} id="source-bottom" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" />
        <Handle type="target" position={Position.Bottom} id="target-bottom" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" />
        <Handle type="source" position={Position.Top} id="source-top" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" />
        <Handle type="source" position={Position.Left} id="source-left" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" />
        <Handle type="target" position={Position.Right} id="target-right" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" />
        {/* ★ Prompt 输入 handles（PromptNode 连线用） */}
        <Handle type="target" position={Position.Left} id="prompt-in" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" style={{ top: '30%' }} />
        <Handle type="target" position={Position.Left} id="negative-prompt-in" className="!w-1 !h-1 !bg-transparent !border-0 !rounded-full" style={{ top: '70%' }} />
        <Play className="w-8 h-8 text-gray-400" />
      </div>
    );
  }

  // ★ 根据实际宽高比自适应卡片尺寸
  // 竖屏基准宽160，横屏基准宽320，高度从真实比例计算
  const cardWidth = isVertical ? 160 : 320;
  const rawHeight = whRatio ? Math.round(cardWidth / whRatio) : (isVertical ? 284 : 180);
  // 限制高度范围，避免极端比例导致卡片过高或过矮
  const previewHeight = Math.max(120, Math.min(400, rawHeight));
  
  // ★ AI 生成中状态
  const isGenerating = !!data.generatingTaskId;

  // ★ 空节点渲染 — 虚线框 + 连接提示
  if (data.isEmpty && !isGenerating) {
    const hasUpstream = (data.upstreamCount || 0) > 0;
    return (
      <>
      <div
        ref={containerRef}
        className={`
          group relative rounded-xl transition-all duration-200
          ${selected ? 'shadow-lg shadow-gray-300' : 'shadow-sm'}
          overflow-hidden
        `}
        style={{ width: 200 }}
        onContextMenu={handleContextMenu}
      >
        {/* 连接 handles */}
        <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 transition-all duration-200">
          <Handle type="target" position={Position.Left} id="target" className="!w-4 !h-4 !bg-white !border-[1.5px] !border-gray-300 hover:!border-gray-800 hover:!bg-gray-50 !rounded-full !cursor-pointer !shadow-sm transition-all" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Plus size={8} className="text-gray-400" /></div>
        </div>
        <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 transition-all duration-200">
          <Handle type="source" position={Position.Right} id="source" className="!w-4 !h-4 !bg-white !border-[1.5px] !border-gray-300 hover:!border-gray-800 hover:!bg-gray-50 !rounded-full !cursor-pointer !shadow-sm transition-all" />
        </div>
        <Handle type="target" position={Position.Top} id="target-top" className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle type="source" position={Position.Bottom} id="source-bottom" className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle type="target" position={Position.Bottom} id="target-bottom" className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle type="source" position={Position.Top} id="source-top" className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle type="source" position={Position.Left} id="source-left" className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle type="target" position={Position.Right} id="target-right" className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle type="target" position={Position.Left} id="prompt-in" className="!w-1 !h-1 !bg-transparent !border-0" style={{ top: '30%' }} />
        <Handle type="target" position={Position.Left} id="negative-prompt-in" className="!w-1 !h-1 !bg-transparent !border-0" style={{ top: '70%' }} />

        {/* 空节点主体 */}
        <div
          className={`
            flex flex-col items-center justify-center gap-3 py-8
            border-2 border-dashed rounded-xl transition-all duration-200
            ${selected ? 'border-gray-900 bg-gray-50' : 'border-gray-300 bg-gray-50/80 hover:border-gray-400 hover:bg-gray-100/60'}
          `}
        >
          {hasUpstream ? (
            <>
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                <Sparkles size={18} className="text-gray-500" />
              </div>
              <div className="text-center px-3">
                <div className="text-xs font-medium text-gray-600 mb-1">
                  {data.upstreamCount} 个输入已连接
                </div>
                <button
                  onClick={() => data.onGenerateFromEmpty?.(data.clipId)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                >
                  ✨ 选择 AI 能力
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                <Plus size={18} className="text-gray-400" />
              </div>
              <div className="text-center px-3">
                <div className="text-xs text-gray-400">
                  连接素材到此节点
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ★ 空节点右键菜单 — 精简版：只保留有意义的操作 */}
      {splitState === 'menu' && menuPosition && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
          <div
            ref={(el) => {
              if (!el) return;
              const rect = el.getBoundingClientRect();
              const pad = 8;
              let x = menuPosition.x;
              let y = menuPosition.y;
              if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad);
              if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - rect.height - pad);
              el.style.left = `${x}px`;
              el.style.top = `${y}px`;
              el.style.opacity = '1';
            }}
            className="fixed z-[101] bg-white/95 backdrop-blur-lg rounded-lg shadow-xl border border-gray-200/80 py-1 w-[180px] opacity-0"
            style={{ left: -9999, top: -9999 }}
          >
            {/* 选择 AI 能力（有上游连接时显示） */}
            {(data.upstreamCount || 0) > 0 && (
              <>
                <button
                  className="w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 hover:bg-gray-100 transition-colors"
                  onClick={() => { closeMenu(); data.onGenerateFromEmpty?.(data.clipId); }}
                >
                  <Sparkles size={15} className="text-gray-500 shrink-0" />
                  <span className="text-[13px] text-gray-700">选择 AI 能力</span>
                </button>
                <div className="my-1 mx-2.5 border-t border-gray-100" />
              </>
            )}
            {/* 删除节点 */}
            <button
              className="w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 hover:bg-red-50 transition-colors"
              onClick={() => {
                closeMenu();
                if (data.clipId) {
                  if (data.isFreeNode && data.onDeleteFreeNode) {
                    (data.onDeleteFreeNode as (id: string) => void)(data.clipId);
                  } else {
                    useVisualEditorStore.getState().deleteShot(data.clipId);
                  }
                }
              }}
            >
              <Trash2 size={15} className="text-red-500 shrink-0" />
              <span className="text-[13px] text-red-600">删除节点</span>
            </button>
          </div>
        </>,
        document.body
      )}
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`
        group relative bg-white rounded-xl shadow-lg border-2 transition-all duration-200
        ${isGenerating 
          ? 'border-gray-300 shadow-sm'
          : selected ? 'border-gray-900 shadow-gray-200' : 'border-gray-200 hover:border-gray-300'}
        overflow-hidden
      `}
      style={{ width: cardWidth }}
      onContextMenu={handleContextMenu}
    >
      {/* 连接点 - 左侧输入（hover 时显示） */}
      <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-200">
        <Handle
          type="target"
          position={Position.Left}
          id="target"
          className="!w-4 !h-4 !bg-white !border-[1.5px] !border-gray-300 hover:!border-gray-800 hover:!bg-gray-50 !rounded-full !cursor-pointer !shadow-sm transition-all"
          onClick={(e) => emitInsertMenuEvent('before', e)}
          onContextMenu={(e) => emitInsertMenuEvent('before', e)}
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Plus size={8} className="text-gray-400" />
        </div>
      </div>
      
      {/* 缩略图 / 视频播放区域 */}
      <div 
        className="relative overflow-hidden"
        style={{ height: previewHeight }}
      >
        {/* ===== 图片节点：只显示静态图片 ===== */}
        {isImageNode ? (
          <>
            {data.thumbnail ? (
              <img
                src={data.thumbnail}
                alt={`Image ${data.index + 1}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center gap-2">
                <ImagePlus className="w-8 h-8 text-gray-400" />
                <span className="text-xs text-gray-500">图片</span>
              </div>
            )}
            {/* 图片类型标签 */}
            <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-white text-xs font-medium">
              图片
            </div>
          </>
        ) : (
          <>
            {/* ===== 视频节点：完整播放功能 ===== */}
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
          /\.(mp4|webm|mov)(\?|$)/i.test(data.thumbnail) ? (
            <video
              src={data.thumbnail}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
              onLoadedData={(e) => {
                const video = e.currentTarget;
                video.currentTime = 0;
                video.pause();
              }}
            />
          ) : (
            <img
              src={data.thumbnail}
              alt={`Clip ${data.index + 1}`}
              className="w-full h-full object-cover"
            />
          )
        )}
        
        {/* ★ 无缩略图时：优先用 videoUrl 首帧 → 预加载 URL → 加载中 */}
        {(playbackState === 'idle' || playbackState === 'error') && !data.thumbnail && (
          data.videoUrl ? (
            <video
              src={data.videoUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
              onLoadedData={(e) => {
                const video = e.currentTarget;
                video.currentTime = 0;
                video.pause();
              }}
            />
          ) : preloadedUrl ? (
            <video
              src={preloadedUrl.url}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
              onLoadedData={(e) => {
                // 暂停在首帧
                const video = e.currentTarget;
                video.currentTime = 0;
                video.pause();
              }}
            />
          ) : (
            <div className="w-full h-full bg-gray-800 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
              <span className="text-xs text-gray-500">加载中...</span>
            </div>
          )
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
        
        {/* 播放按钮 — idle/loading: hover 时居中显示; playing: 右下角小按钮不遮挡; paused: 居中半透明 */}
        {selected && playbackState !== 'error' && (
          playbackState === 'playing' ? (
            // ★ 播放中：右下角小按钮，不遮挡视频画面
            <div
              className="absolute bottom-2 right-2 cursor-pointer z-10"
              onClick={handlePlayClick}
            >
              <div className="w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center shadow transition-colors">
                <Pause className="w-4 h-4 text-white" />
              </div>
            </div>
          ) : playbackState === 'paused' ? (
            // ★ 暂停中：居中显示，轻遮罩
            <div 
              className="absolute inset-0 flex items-center justify-center bg-black/10 cursor-pointer"
              onClick={handlePlayClick}
            >
              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
                <Play className="w-6 h-6 text-gray-800 ml-0.5" />
              </div>
            </div>
          ) : (
            // ★ idle / loading / buffering：hover 时居中显示
            <div 
              className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 cursor-pointer opacity-0 group-hover:opacity-100 transition-all"
              onClick={handlePlayClick}
            >
              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
                {playbackState === 'loading' ? (
                  <Loader2 className="w-6 h-6 text-gray-800 animate-spin" />
                ) : playbackState === 'buffering' ? (
                  <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
                ) : (
                  <Play className="w-6 h-6 text-gray-800 ml-0.5" />
                )}
              </div>
            </div>
          )
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
          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/70 rounded text-white text-xs">
            已暂停
          </div>
        )}
          </>
        )}

        {/* ★ AI 生成中遮罩层 — 当 generatingTaskId 存在时显示 */}
        {isGenerating && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-100/90 backdrop-blur-[1px]">
            <img
              src="/rabbit-loading.gif"
              alt="loading"
              className="w-12 h-12 mb-2 opacity-70"
            />
            <span className="text-gray-500 text-xs">
              {data.generatingCapability || 'AI 生成中'}
            </span>
            <span className="text-gray-400 text-[10px] mt-0.5">处理中，请稍候...</span>
          </div>
        )}

        {/* ★ Edit 按钮 — 底部右侧，hover 显示，点击打开 Compositor 全屏合成编辑器 */}
        {data.onOpenCompositor && (
          <button
            className="absolute bottom-2 right-2 z-10 flex items-center gap-1 px-2 py-1 bg-white/90 hover:bg-white rounded-md shadow-md border border-gray-200 text-gray-700 text-xs font-medium opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-105 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              (data.onOpenCompositor as (id: string) => void)(data.clipId);
            }}
            title="打开合成编辑器"
          >
            <PenSquare size={12} />
            Edit
          </button>
        )}
      </div>
      
      {/* ★ 右键菜单 — Figma/Linear 风格紧凑菜单，viewport-aware 定位 */}
      {splitState === 'menu' && menuPosition && createPortal(
        <>
          {/* 遮罩层 - 点击/右键关闭菜单 */}
          <div className="fixed inset-0 z-[100]" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
          {/* 菜单面板 — 紧凑单行样式，viewport-aware 自动翻转 */}
          <div 
            ref={(el) => {
              if (!el) return;
              // ★ viewport-aware：渲染后检测溢出，自动翻转位置
              const rect = el.getBoundingClientRect();
              const pad = 8;
              let x = menuPosition.x;
              let y = menuPosition.y;
              if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad);
              if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - rect.height - pad);
              el.style.left = `${x}px`;
              el.style.top = `${y}px`;
              el.style.opacity = '1';
            }}
            className="fixed z-[101] bg-white/95 backdrop-blur-lg rounded-lg shadow-xl border border-gray-200/80 py-1 w-[200px] max-h-[min(420px,80vh)] overflow-y-auto opacity-0 [scrollbar-width:thin] [scrollbar-color:rgba(0,0,0,0.1)_transparent]"
            style={{ left: -9999, top: -9999 }}
          >
            {/* ★ 生成中：只显示「取消任务」，不提供其他操作 */}
            {isGenerating ? (
              <button
                className="w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 hover:bg-red-50 transition-colors"
                onClick={handleCancelAndDelete}
              >
                <StopCircle size={15} className="text-red-500 shrink-0" />
                <span className="text-[13px] text-red-600">取消任务</span>
              </button>
            ) : (
            <>
            {/* ★ 打开/预览 */}
            <button
              className="w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 hover:bg-gray-100 transition-colors"
              onClick={() => {
                closeMenu();
                if (data.thumbnail || data.videoUrl) {
                  window.dispatchEvent(new CustomEvent('preview-media', { detail: { clipId: data.clipId, url: data.videoUrl || data.thumbnail, mediaType: data.mediaType } }));
                }
              }}
            >
              <Eye size={15} className="text-gray-500 shrink-0" />
              <span className="text-[13px] text-gray-700">打开 / 预览</span>
            </button>

            {/* 分隔线 */}
            <div className="my-1 mx-2.5 border-t border-gray-100" />

            {/* 复制 */}
            <button
              className="w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 hover:bg-gray-100 transition-colors"
              onClick={() => {
                closeMenu();
                if (data.clipId) {
                  window.dispatchEvent(new CustomEvent('duplicate-node', { detail: { clipId: data.clipId, isFreeNode: !!data.isFreeNode } }));
                }
              }}
            >
              <Copy size={15} className="text-gray-500 shrink-0" />
              <span className="text-[13px] text-gray-700">复制</span>
            </button>

            {/* 锁定/解锁 */}
            {(() => {
              const store = useVisualEditorStore.getState();
              const isLocked = data.clipId ? store.isNodeLocked?.(data.clipId) ?? false : false;
              return (
                <button
                  className="w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 hover:bg-gray-100 transition-colors"
                  onClick={() => {
                    closeMenu();
                    if (data.clipId) {
                      window.dispatchEvent(new CustomEvent('toggle-lock-node', { detail: { clipId: data.clipId, locked: !isLocked } }));
                    }
                  }}
                >
                  {isLocked ? <LockOpen size={15} className="text-gray-500 shrink-0" /> : <Lock size={15} className="text-gray-500 shrink-0" />}
                  <span className="text-[13px] text-gray-700">{isLocked ? '解锁' : '锁定'}</span>
                </button>
              );
            })()}

            {/* 加入主线 */}
            {(() => {
              const isInTimeline = data.clipId ? useVisualEditorStore.getState().isInTimeline(data.clipId) : false;
              return (
                <button
                  className={`w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 transition-colors ${
                    isInTimeline ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'
                  }`}
                  disabled={isInTimeline}
                  onClick={() => {
                    closeMenu();
                    if (data.clipId && !isInTimeline) {
                      const store = useVisualEditorStore.getState();
                      store.addToTimeline(data.clipId);
                    }
                  }}
                >
                  {isInTimeline 
                    ? <Check size={15} className="text-gray-500 shrink-0" />
                    : <ListVideo size={15} className="text-gray-500 shrink-0" />
                  }
                  <span className={`text-[13px] ${isInTimeline ? 'text-gray-400' : 'text-gray-700'}`}>
                    {isInTimeline ? '已在主线中' : '加入主线'}
                  </span>
                </button>
              );
            })()}
            
            {/* ★ 保存到素材库 */}
            <button
              className={`w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 transition-colors ${
                savingToLibrary || savedToLibrary ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-100'
              }`}
              disabled={savingToLibrary || savedToLibrary}
              onClick={async () => {
                if (savingToLibrary || savedToLibrary) return;
                setSavingToLibrary(true);
                try {
                  const api = new MaterialsApi();
                  if (data.assetId) {
                    const result = await api.promoteToLibrary(data.assetId);
                    if (result.data?.success) {
                      setSavedToLibrary(true);
                      toast.success('已保存到素材库');
                      setTimeout(() => setSavedToLibrary(false), 5000);
                    } else {
                      toast.error(result.error?.message || '保存失败');
                    }
                  } else {
                    const url = data.videoUrl || data.thumbnail;
                    if (!url) {
                      toast.error('没有可保存的素材');
                      return;
                    }
                    const result = await api.importFromUrl(url, 'user_material');
                    if (result.data?.success) {
                      setSavedToLibrary(true);
                      toast.success('已保存到素材库');
                      setTimeout(() => setSavedToLibrary(false), 5000);
                    } else {
                      toast.error('保存失败');
                    }
                  }
                } catch (err) {
                  toast.error('保存到素材库失败');
                } finally {
                  setSavingToLibrary(false);
                  closeMenu();
                }
              }}
            >
              {savingToLibrary ? (
                <Loader2 size={15} className="text-gray-500 animate-spin shrink-0" />
              ) : savedToLibrary ? (
                <Check size={15} className="text-gray-500 shrink-0" />
              ) : (
                <FolderHeart size={15} className="text-gray-500 shrink-0" />
              )}
              <span className={`text-[13px] ${savedToLibrary ? 'text-gray-500' : 'text-gray-700'}`}>
                {savedToLibrary ? '已保存' : '保存到素材库'}
              </span>
            </button>

            {/* 分隔线 */}
            <div className="my-1 mx-2.5 border-t border-gray-100" />

            {/* 删除 */}
            <button
              className="w-full px-2.5 py-1.5 text-left flex items-center gap-2.5 hover:bg-red-50 transition-colors"
              onClick={() => {
                closeMenu();
                if (data.clipId) {
                  if (data.isFreeNode && data.onDeleteFreeNode) {
                    data.onDeleteFreeNode(data.clipId);
                  } else {
                    useVisualEditorStore.getState().deleteShot(data.clipId);
                  }
                }
              }}
            >
              <Trash2 size={15} className="text-red-500 shrink-0" />
              <span className="text-[13px] text-red-600">{data.isFreeNode ? '移除素材' : '删除分镜'}</span>
            </button>
            </>
            )}
          </div>
        </>,
        document.body
      )}
      
      {/* 拆分分析中 */}
      {splitState === 'analyzing' && (
        <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center gap-2 rounded-xl">
          <Loader2 className="w-8 h-8 text-gray-500 animate-spin" />
          <span className="text-sm text-gray-600">拆分中...</span>
        </div>
      )}
      
      {/* 拆分失败/无法拆分 */}
      {splitState === 'error' && splitErrorMsg && (
        <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center gap-2 rounded-xl p-3">
          <AlertCircle className="w-8 h-8 text-red-500" />
          <span className="text-sm text-gray-700 text-center">{splitErrorMsg}</span>
          <button 
            onClick={handleCancelSplit}
            className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-600 hover:bg-gray-200"
          >
            关闭
          </button>
        </div>
      )}
      
      {/* 连接点 - 右侧输出（hover 时显示） */}
      <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-200">
        <Handle
          type="source"
          position={Position.Right}
          id="source"
          className="!w-4 !h-4 !bg-white !border-[1.5px] !border-gray-300 hover:!border-gray-800 hover:!bg-gray-50 !rounded-full !cursor-pointer !shadow-sm transition-all"
          onClick={(e) => emitInsertMenuEvent('after', e)}
          onContextMenu={(e) => emitInsertMenuEvent('after', e)}
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Plus size={8} className="text-gray-400" />
        </div>
      </div>

      {/* ★ 隐藏的 4 方向 handles — 供 canvas 自由连线智能选择最优方向 */}
      <Handle type="target" position={Position.Top} id="target-top" className="!w-1 !h-1 !bg-transparent !border-0" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" className="!w-1 !h-1 !bg-transparent !border-0" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" className="!w-1 !h-1 !bg-transparent !border-0" />
      <Handle type="source" position={Position.Top} id="source-top" className="!w-1 !h-1 !bg-transparent !border-0" />
      <Handle type="source" position={Position.Left} id="source-left" className="!w-1 !h-1 !bg-transparent !border-0" />
      <Handle type="target" position={Position.Right} id="target-right" className="!w-1 !h-1 !bg-transparent !border-0" />

      {/* ★ Prompt 输入 handles（hover 时显示，PromptNode 连线用） */}
      <div className="absolute left-0 -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-all duration-200" style={{ top: '30%' }}>
        <Handle
          type="target"
          position={Position.Left}
          id="prompt-in"
          className="!w-3 !h-3 !rounded-full !cursor-pointer !shadow-sm transition-all"
          style={{ background: '#9ca3af', border: '1.5px solid rgba(0,0,0,0.3)', position: 'relative' }}
          title="Prompt 输入"
        />
      </div>
      <div className="absolute left-0 -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-all duration-200" style={{ top: '70%' }}>
        <Handle
          type="target"
          position={Position.Left}
          id="negative-prompt-in"
          className="!w-3 !h-3 !rounded-full !cursor-pointer !shadow-sm transition-all"
          style={{ background: '#d1d5db', border: '1.5px solid rgba(0,0,0,0.3)', position: 'relative' }}
          title="Negative Prompt 输入"
        />
      </div>
      
    </div>
  );
}

// ★★★ 关键修复：自定义 memo 比较函数，确保 data.videoUrl 变化时重新渲染 ★★★
function arePropsEqual(prevProps: NodeProps & { data: ClipNodeData }, nextProps: NodeProps & { data: ClipNodeData }) {
  // 如果 mediaType 变化了，必须重新渲染
  if (prevProps.data.mediaType !== nextProps.data.mediaType) {
    return false;
  }
  // 如果 videoUrl 变化了，必须重新渲染
  if (prevProps.data.videoUrl !== nextProps.data.videoUrl) {
    console.log('[ClipNode memo] videoUrl 变化，触发重新渲染:', prevProps.data.videoUrl?.slice(-30), '->', nextProps.data.videoUrl?.slice(-30));
    return false;
  }
  // 如果选中状态变化，重新渲染
  if (prevProps.selected !== nextProps.selected) {
    return false;
  }
  // 如果 thumbnail 变化，重新渲染
  if (prevProps.data.thumbnail !== nextProps.data.thumbnail) {
    return false;
  }
  // 如果 clipId 变化，重新渲染
  if (prevProps.data.clipId !== nextProps.data.clipId) {
    return false;
  }
  // ★ 如果 generatingTaskId 变化，重新渲染（影响右键菜单内容）
  if (prevProps.data.generatingTaskId !== nextProps.data.generatingTaskId) {
    return false;
  }
  // 其他情况使用默认的浅比较
  return true;
}

export const ClipNode = memo(ClipNodeComponent, arePropsEqual);
