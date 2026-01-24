'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  MousePointer2,
  Trash2,
  Magnet,
  Layers,
  Minus,
  Plus,
  Film,
  Music,
  GripVertical,
  Type,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Image,
  Diamond,
  X,
  Wind,         // For Breath
  Settings,     // For cleanup settings
} from 'lucide-react';
import { useEditorStore, TICK_WIDTH, TOTAL_DURATION } from '../store/editor-store';
import type { Track, ClipType, Clip } from '../types';
import { CLIP_TYPE_COLORS } from '../types';
import { KeyframeDiamond, KeyframePanel } from './keyframes';
import { SmartCleanupWizard } from './SmartCleanupWizard';
import { ClipThumbnail } from './TimelineComponents';
import { msToSec, secToMs } from '../lib/time-utils';
import {
  TRACK_HEIGHT,
  VIDEO_TRACK_HEIGHT,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  SNAP_THRESHOLD_MS,
  formatMasterTime,
  getTickInterval as getTickIntervalUtil,
  type DragState as DragStateType,
  type ResizeState as ResizeStateType,
} from '../lib/timeline-utils';

// 获取轨道高度的辅助函数（视频轨道更高）
const getTrackHeight = (trackId: string, clips: { trackId: string; clipType: string }[]) => {
  const hasVideoClip = clips.some(c => c.trackId === trackId && c.clipType === 'video');
  return hasVideoClip ? VIDEO_TRACK_HEIGHT : TRACK_HEIGHT;
};

// 扩展 DragState 接口，添加多选拖动支持
interface DragState extends DragStateType {
  selectedClipsOriginalStarts?: Map<string, number>;
  selectedClipsOriginalTrackIds?: Map<string, string>; // 记录每个选中 clip 的原始轨道 ID
}

// 扩展 ResizeState 接口
interface ResizeState extends ResizeStateType { }

// 拉伸预览状态（用于临时显示，不触发同步）
interface ResizePreview {
  clipId: string;
  start: number;
  duration: number;
  sourceStart: number;
}

/**
 * 将毫秒转为像素（用于 UI 渲染）
 * TICK_WIDTH 是每秒的像素数，所以需要先转秒
 */
function msToPixels(ms: number, zoomLevel: number): number {
  return msToSec(ms) * TICK_WIDTH * zoomLevel;
}

/**
 * 将像素转为毫秒（用于拖拽计算）
 */
function pixelsToMs(px: number, zoomLevel: number): number {
  return secToMs(px / (TICK_WIDTH * zoomLevel));
}

// 内容块类型图标
const CLIP_TYPE_ICONS: Record<ClipType, React.ReactNode> = {
  video: <Film size={14} />,
  audio: <Music size={14} />,
  image: <Image size={14} />,   // 图片
  text: <Type size={14} />,
  subtitle: <Type size={14} />,
  voice: <Music size={14} />,   // 配音
  effect: <Sparkles size={14} />,  // 特效
  filter: <Sparkles size={14} />,
  transition: <Layers size={14} />,
  sticker: <Image size={14} />,
};

// 使用导入的 getTickIntervalUtil，包装成本地函数
const getTickInterval = (zoom: number) => getTickIntervalUtil(zoom, TICK_WIDTH);

// 淡入淡出可视化和拖拽点组件
interface FadeHandlesProps {
  clip: Clip;
  clipWidth: number;
  onFadeStart: (e: React.MouseEvent, clipId: string, type: 'fadeIn' | 'fadeOut') => void;
}

function FadeHandles({ clip, clipWidth, onFadeStart }: FadeHandlesProps) {
  const fadeIn = clip.metadata?.fadeIn ?? 0; // 毫秒
  const fadeOut = clip.metadata?.fadeOut ?? 0; // 毫秒

  // 计算淡入淡出的像素宽度
  const fadeInWidth = (fadeIn / clip.duration) * clipWidth;
  const fadeOutWidth = (fadeOut / clip.duration) * clipWidth;

  // 最小显示宽度
  const showFadeIn = fadeIn > 0 || fadeInWidth > 0;
  const showFadeOut = fadeOut > 0 || fadeOutWidth > 0;

  return (
    <>
      {/* 淡入区域遮罩 */}
      {showFadeIn && fadeInWidth > 2 && (
        <div
          className="absolute top-0 left-0 h-full pointer-events-none z-10"
          style={{ width: fadeInWidth }}
        >
          {/* 渐变遮罩 */}
          <div
            className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent"
          />
          {/* 斜线指示 */}
          <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            <line
              x1="0" y1="100%"
              x2="100%" y2="0"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
          </svg>
        </div>
      )}

      {/* 淡入拖拽圆点 - 位于 clip 顶部，小圆点 */}
      <div
        className="fade-handle absolute z-30 cursor-ew-resize group/fade pointer-events-auto"
        style={{
          left: Math.max(0, fadeInWidth - 4),
          top: 0,
          height: '16px',
          width: '8px',
        }}
        onMouseDown={(e) => onFadeStart(e, clip.id, 'fadeIn')}
      >
        {/* 小拖拽圆点 - 顶部居中 */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white shadow border border-gray-400 opacity-0 group-hover:opacity-100 group-hover/fade:opacity-100 transition-opacity" />
      </div>

      {/* 淡出区域遮罩 */}
      {showFadeOut && fadeOutWidth > 2 && (
        <div
          className="absolute top-0 right-0 h-full pointer-events-none z-10"
          style={{ width: fadeOutWidth }}
        >
          {/* 渐变遮罩 */}
          <div
            className="absolute inset-0 bg-gradient-to-l from-black/60 to-transparent"
          />
          {/* 斜线指示 */}
          <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            <line
              x1="0" y1="0"
              x2="100%" y2="100%"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
          </svg>
        </div>
      )}

      {/* 淡出拖拽圆点 - 位于 clip 顶部，小圆点 */}
      <div
        className="fade-handle absolute z-30 cursor-ew-resize group/fade pointer-events-auto"
        style={{
          right: Math.max(0, fadeOutWidth - 4),
          top: 0,
          height: '16px',
          width: '8px',
        }}
        onMouseDown={(e) => onFadeStart(e, clip.id, 'fadeOut')}
      >
        {/* 小拖拽圆点 - 顶部居中 */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white shadow border border-gray-400 opacity-0 group-hover:opacity-100 group-hover/fade:opacity-100 transition-opacity" />
      </div>
    </>
  );
}

export function Timeline() {

  // ========== 性能优化：currentTime 使用 ref + 订阅，避免触发重渲染 ==========
  const currentTimeRef = useRef(useEditorStore.getState().currentTime);

  // ========== 细粒度 Store 订阅（只订阅状态数据，方法使用 getState() 获取）==========
  // 状态数据订阅
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const transcript = useEditorStore((s) => s.transcript);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const zoomLevel = useEditorStore((s) => s.zoomLevel);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const trackContextMenu = useEditorStore((s) => s.trackContextMenu);
  const keyframes = useEditorStore((s) => s.keyframes);
  const selectedKeyframeIds = useEditorStore((s) => s.selectedKeyframeIds);
  const projectId = useEditorStore((s) => s.projectId);  // 用于清理向导

  // 方法引用通过 getState() 获取（避免重渲染）
  const getStore = useEditorStore.getState;
  const setCurrentTime = getStore().setCurrentTime;
  const setIsPlaying = getStore().setIsPlaying;
  const setZoomLevel = getStore().setZoomLevel;
  const selectClip = getStore().selectClip;
  const selectClipsByIds = getStore().selectClipsByIds;
  const clearSelection = getStore().clearSelection;
  const openContextMenu = getStore().openContextMenu;
  const updateClip = getStore().updateClip;
  const removeClip = getStore().removeClip;
  const saveToHistory = getStore().saveToHistory;
  const findOrCreateTrack = getStore().findOrCreateTrack;
  const addTrack = getStore().addTrack;
  const openTrackContextMenu = getStore().openTrackContextMenu;
  const closeTrackContextMenu = getStore().closeTrackContextMenu;
  const updateTrackOrder = getStore().updateTrackOrder;
  const setActiveSidebarPanel = getStore().setActiveSidebarPanel;
  const getClipKeyframes = getStore().getClipKeyframes;

  // Helper to check if clip has any keyframes
  const clipHasKeyframes = (clipId: string): boolean => {
    const clipKfs = keyframes.get(clipId);
    if (!clipKfs) return false;
    let count = 0;
    clipKfs.forEach(kfList => count += kfList.length);
    return count > 0;
  };

  const timelineRef = useRef<HTMLDivElement>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [targetTrackId, setTargetTrackId] = useState<string | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);

  // ========== Asset 拖放状态 ==========
  const [assetDropState, setAssetDropState] = useState<{
    isOver: boolean;
    dropX: number;
    dropTrackId: string | null;
  } | null>(null);

  // ========== 静音清理对话框状态 ==========
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);

  // ========== 播放头 DOM 直接更新（性能优化）==========
  const playheadRef = useRef<HTMLDivElement>(null);
  const playheadLabelRef = useRef<HTMLDivElement>(null);

  // ========== 框选状态 ==========
  const [marqueeState, setMarqueeState] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // ========== 播放头拖动状态 ==========
  const [isScrubbingPlayhead, setIsScrubbingPlayhead] = useState(false);

  // ========== 淡入淡出拖动状态 ==========
  const [fadeState, setFadeState] = useState<{
    clipId: string;
    type: 'fadeIn' | 'fadeOut';
    startX: number;
    originalValue: number; // 毫秒
  } | null>(null);
  const fadeStateRef = useRef(fadeState);
  useEffect(() => { fadeStateRef.current = fadeState; }, [fadeState]);

  // 使用 ref 存储最新状态，避免事件处理器的闭包问题
  const resizeStateRef = useRef(resizeState);
  const resizePreviewRef = useRef(resizePreview);
  const dragStateRef = useRef(dragState);
  const targetTrackIdRef = useRef(targetTrackId);

  // 同步 ref 和 state
  useEffect(() => { resizeStateRef.current = resizeState; }, [resizeState]);
  useEffect(() => { resizePreviewRef.current = resizePreview; }, [resizePreview]);
  useEffect(() => { dragStateRef.current = dragState; }, [dragState]);
  useEffect(() => { targetTrackIdRef.current = targetTrackId; }, [targetTrackId]);

  // ========== 播放头 DOM 直接更新（使用 subscribe 避免重渲染）==========
  useEffect(() => {
    // 更新播放头位置的函数
    const updatePlayhead = (time: number, zoom: number) => {
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${msToPixels(time, zoom)}px)`;
      }
      if (playheadLabelRef.current) {
        playheadLabelRef.current.textContent = `${msToSec(time).toFixed(2)}s`;
      }
    };

    // 初始更新
    updatePlayhead(currentTimeRef.current, zoomLevel);

    // 订阅 currentTime 变化，直接更新 DOM 而不触发重渲染
    // 注意：使用 selector 形式订阅，避免每次 store 任何变化都触发
    const unsubscribe = useEditorStore.subscribe(
      (state) => ({ time: state.currentTime, zoom: state.zoomLevel }),
      (curr, prev) => {
        if (curr.time !== prev.time || curr.zoom !== prev.zoom) {
          currentTimeRef.current = curr.time;
          updatePlayhead(curr.time, curr.zoom);
        }
      },
      { equalityFn: (a, b) => a.time === b.time && a.zoom === b.zoom }
    );

    return unsubscribe;
  }, []); // 空依赖，只在挂载时执行

  // zoomLevel 变化时也需要更新播放头位置
  useEffect(() => {
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${msToPixels(currentTimeRef.current, zoomLevel)}px)`;
    }
  }, [zoomLevel]);

  // 计算轨道最长长度作为总时长
  const totalDuration = useMemo(() => {
    if (clips.length === 0) return 0;
    return Math.max(...clips.map(c => c.start + c.duration));
  }, [clips]);

  // 按层级排序的轨道列表
  const sortedTracks = [...tracks].sort((a, b) => b.orderIndex - a.orderIndex);

  // 获取选中的片段（第一个选中的）
  const selectedClip = clips.find(c => c.id === selectedClipId);
  const selectedCount = selectedClipIds.size;

  // ========== 换气片段统计（死寂/卡顿已在 ASR 阶段自动切除）==========
  // ★ 只统计视频类型的换气片段，音频类型不需要换气检测
  const silenceStats = useMemo(() => {
    let breath = 0;

    clips.forEach(c => {
      // ★ 只有视频类型才需要统计换气
      if (c.clipType !== 'video') return;

      const silenceInfo = c.silenceInfo || c.metadata?.silence_info;
      if (silenceInfo) {
        const cls = silenceInfo.classification;
        if (cls === 'breath') {
          breath++;
        }
      }
    });

    return { total: breath, breath };
  }, [clips]);

  // ========== 拖拽功能 ==========
  const handleDragStart = useCallback((e: React.MouseEvent, clipId: string, clipStart: number, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // 拖动开始时暂停播放，保持播放头在原位
    if (isPlaying) {
      setIsPlaying(false);
    }

    // 判断是否为多选拖动：只有当前 clip 已经在选中列表中，才使用多选拖动
    const isMultiDrag = selectedClipIds.has(clipId) && selectedClipIds.size > 1;

    // 如果当前 clip 不在选中列表中，清除之前的选中状态，只选中当前 clip
    if (!selectedClipIds.has(clipId)) {
      selectClip(clipId, false);
    }

    // 获取片段类型
    const clip = clips.find(c => c.id === clipId);
    if (!clip) {
      return;
    }

    saveToHistory();

    // 记录需要拖动的 clips 的原始位置和轨道
    const selectedClipsOriginalStarts = new Map<string, number>();
    const selectedClipsOriginalTrackIds = new Map<string, string>();

    if (isMultiDrag) {
      // 多选拖动：记录所有已选中 clips 的位置和轨道
      clips.forEach(c => {
        if (selectedClipIds.has(c.id)) {
          selectedClipsOriginalStarts.set(c.id, c.start);
          selectedClipsOriginalTrackIds.set(c.id, c.trackId);
        }
      });
    } else {
      // 单选拖动：只记录当前 clip
      selectedClipsOriginalStarts.set(clipId, clipStart);
      selectedClipsOriginalTrackIds.set(clipId, trackId);
    }

    const newDragState = {
      clipId,
      startX: e.clientX,
      startY: e.clientY,
      originalStart: clipStart,
      originalTrackId: trackId,
      clipType: clip.clipType,
      isDragging: true,
      selectedClipsOriginalStarts,
      selectedClipsOriginalTrackIds,
    };
    setDragState(newDragState);
    setTargetTrackId(trackId);
  }, [selectedClipIds, selectClip, saveToHistory, clips, tracks, isPlaying, setIsPlaying]);

  // 拖拽中 - 支持水平和垂直方向
  const handleDragMove = useCallback((e: MouseEvent) => {
    const currentDragState = dragStateRef.current;
    if (!currentDragState?.isDragging) {
      return;
    }
    if (!tracksContainerRef.current) {
      return;
    }

    const currentClip = clips.find(c => c.id === currentDragState.clipId);
    if (!currentClip) {
      return;
    }

    // 水平移动（时间）- deltaTime 现在是毫秒
    const deltaX = e.clientX - currentDragState.startX;
    const deltaTimeMs = pixelsToMs(deltaX, zoomLevel);
    let newStart = Math.max(0, currentDragState.originalStart + deltaTimeMs);

    // 垂直移动（轨道）
    const deltaY = e.clientY - currentDragState.startY;

    // 找到原始轨道的索引
    const originalTrackIndex = sortedTracks.findIndex(t => t.id === currentDragState.originalTrackId);

    // 根据Y轴偏移计算目标轨道索引
    const trackIndexDelta = Math.round(deltaY / TRACK_HEIGHT);
    const newTrackIndex = Math.max(0, Math.min(originalTrackIndex + trackIndexDelta, sortedTracks.length));

    // 确定目标轨道
    const newTargetTrackId = newTrackIndex >= sortedTracks.length
      ? `__NEW_TRACK_${sortedTracks.length + 1}`
      : sortedTracks[newTrackIndex]?.id || currentDragState.originalTrackId;

    // 检查是否为多选拖动
    const isMultiDrag = currentDragState.selectedClipsOriginalStarts && currentDragState.selectedClipsOriginalStarts.size > 1;

    setTargetTrackId(newTargetTrackId);

    // 🎯 视频类型 clip 的约束：不允许向右拖动产生空隙
    // 注意：多选拖动时暂时跳过此约束，因为整体移动不会产生间隙
    // ⚠️ 重要：使用当前目标轨道（newTargetTrackId）来判断约束，而不是原始轨道
    const effectiveTrackId = newTargetTrackId.startsWith('__NEW_') ? null : newTargetTrackId;

    if (currentDragState.clipType === 'video' && !isMultiDrag && effectiveTrackId) {
      // 获取目标轨道中的所有视频 clips（排除正在拖拽的 clip）
      const targetTrackClips = clips.filter(c =>
        c.id !== currentDragState.clipId &&
        c.trackId === effectiveTrackId &&
        c.clipType === 'video'
      );

      // 如果目标轨道是空的（或只有当前clip），允许自由移动
      if (targetTrackClips.length > 0) {
        // 找到目标轨道中在当前位置左侧的 clips
        const leftClips = targetTrackClips.filter(c => c.start + c.duration <= newStart + 10); // 10ms 容差
        if (leftClips.length > 0) {
          // 有左侧 clip，当前 clip 需要紧贴左侧 clip 的右边缘
          const leftMostEnd = Math.max(...leftClips.map(c => c.start + c.duration));
          // 只限制向右移动，允许向左贴紧
          if (newStart > leftMostEnd) {
            newStart = leftMostEnd;
          }
        } else {
          // 目标轨道有 clips 但都在右侧，当前 clip 应该贴紧时间轴起点
          const earliestClip = Math.min(...targetTrackClips.map(c => c.start));
          // 只有当 newStart 会产生空隙时才限制
          if (newStart > 0 && newStart + currentClip.duration < earliestClip) {
            // 允许向左移动到 0，或者紧贴右侧 clip
            // 不做限制，让用户自由调整
          }
        }
      }
      // 如果目标轨道是空的，不做任何约束，允许自由移动
    }

    // 水平吸附逻辑 - 跨轨道检测所有 clips 的边界（毫秒）
    const allOtherClips = clips.filter(c => c.id !== currentDragState.clipId);

    const currentEnd = newStart + currentClip.duration;
    let snapped = false;

    // 跨轨道磁吸：检测所有其他 clip 的边界（使用毫秒阈值）
    for (const other of allOtherClips) {
      const otherEnd = other.start + other.duration;

      // 当前 clip 左边缘吸附到其他 clip 右边缘
      if (Math.abs(newStart - otherEnd) < SNAP_THRESHOLD_MS) {
        newStart = otherEnd;
        snapped = true;
        break;
      }
      // 当前 clip 右边缘吸附到其他 clip 左边缘
      if (Math.abs(currentEnd - other.start) < SNAP_THRESHOLD_MS) {
        newStart = other.start - currentClip.duration;
        snapped = true;
        break;
      }
      // 当前 clip 左边缘吸附到其他 clip 左边缘（对齐）
      if (Math.abs(newStart - other.start) < SNAP_THRESHOLD_MS) {
        newStart = other.start;
        snapped = true;
        break;
      }
      // 当前 clip 右边缘吸附到其他 clip 右边缘（对齐）
      if (Math.abs(currentEnd - otherEnd) < SNAP_THRESHOLD_MS) {
        newStart = otherEnd - currentClip.duration;
        snapped = true;
        break;
      }
    }

    // 吸附到播放头
    const currentTime = currentTimeRef.current;
    if (Math.abs(newStart - currentTime) < SNAP_THRESHOLD_MS) {
      newStart = currentTime;
    }
    if (Math.abs(currentEnd - currentTime) < SNAP_THRESHOLD_MS) {
      newStart = currentTime - currentClip.duration;
    }

    // 计算主 clip 的位移
    const deltaMs = newStart - currentDragState.originalStart;

    // 多选拖动：同时移动所有选中的 clips 的时间位置
    // 注意：只更新 start 位置，trackId 在 handleDragEnd 中处理
    if (currentDragState.selectedClipsOriginalStarts && currentDragState.selectedClipsOriginalStarts.size > 1) {
      currentDragState.selectedClipsOriginalStarts.forEach((originalStart, cid) => {
        const newClipStart = Math.max(0, originalStart + deltaMs);
        // 只更新时间位置，不在拖动过程中改变轨道
        updateClip(cid, { start: newClipStart });
      });
    } else {
      // 单个拖动：只更新时间位置
      updateClip(currentDragState.clipId, { start: Math.max(0, newStart) });
    }
  }, [zoomLevel, updateClip, clips, sortedTracks]); // 移除 currentTime 依赖

  // 检查片段与轨道上其他片段是否重叠（使用容差避免精度问题）
  const checkOverlap = useCallback((clipId: string, trackId: string, start: number, duration: number) => {
    const OVERLAP_TOLERANCE = 1; // 1ms 容差，边界对齐不算重叠
    const trackClips = clips.filter(c => c.id !== clipId && c.trackId === trackId);
    return trackClips.some(other => {
      const clipEnd = start + duration;
      const otherEnd = other.start + other.duration;
      // 只有真正重叠超过容差才算重叠（边界对齐或微小交叉不算）
      const overlapAmount = Math.min(clipEnd, otherEnd) - Math.max(start, other.start);
      return overlapAmount > OVERLAP_TOLERANCE;
    });
  }, [clips]);

  // 检查目标轨道是否有不同类型的 clips（不同类型不能共存于同一轨道）
  const hasIncompatibleClipType = useCallback((clipId: string, clipType: string, targetTrackId: string) => {
    const trackClips = clips.filter(c => c.id !== clipId && c.trackId === targetTrackId);
    if (trackClips.length === 0) return false;
    // 检查是否存在类型不同的 clip
    return trackClips.some(c => c.clipType !== clipType);
  }, [clips]);

  /**
   * 为拖入的 clip 挤开空间 - 只推移真正重叠的 clips
   * @param draggedClipId 正在拖动的 clip ID
   * @param targetTrackId 目标轨道 ID
   * @param insertStart 插入位置的起始时间
   * @param insertDuration 插入 clip 的时长
   */
  const makeRoomForClip = useCallback((draggedClipId: string, targetTrackId: string, insertStart: number, insertDuration: number) => {
    const OVERLAP_TOLERANCE = 1; // 1ms 容差，边界对齐不算重叠

    // 获取目标轨道上的所有其他 clips，按时间排序
    const trackClips = clips
      .filter(c => c.id !== draggedClipId && c.trackId === targetTrackId)
      .sort((a, b) => a.start - b.start);

    if (trackClips.length === 0) return;

    const insertEnd = insertStart + insertDuration;

    // 只找真正与插入区域重叠的 clips（超过容差才算重叠）
    const overlappingClips = trackClips.filter(clip => {
      const clipEnd = clip.start + clip.duration;
      const overlapAmount = Math.min(clipEnd, insertEnd) - Math.max(clip.start, insertStart);
      return overlapAmount > OVERLAP_TOLERANCE;
    });

    if (overlappingClips.length === 0) return;

    // 计算需要推移的量：确保插入区域完全空出
    const shiftAmount = insertEnd - Math.min(...overlappingClips.map(c => c.start));

    // 推移所有重叠的 clips 及其后面紧邻的 clips（连锁推移）
    let lastEnd = insertEnd;

    for (const clip of trackClips) {
      const clipEnd = clip.start + clip.duration;
      const overlapAmount = Math.min(clipEnd, insertEnd) - Math.max(clip.start, insertStart);

      if (overlapAmount > OVERLAP_TOLERANCE) {
        // 这个 clip 与插入区域真正重叠，需要推移
        const newStart = clip.start + shiftAmount;
        updateClip(clip.id, { start: Math.round(newStart) });
        lastEnd = newStart + clip.duration;
      } else if (clip.start >= insertStart && clip.start < lastEnd - OVERLAP_TOLERANCE) {
        // 这个 clip 与前一个推移后的 clip 重叠，连锁推移
        const newStart = lastEnd;
        updateClip(clip.id, { start: Math.round(newStart) });
        lastEnd = newStart + clip.duration;
      }
    }
  }, [clips, updateClip]);

  /**
   * 自动贴紧视频 clips - 移除同轨道视频片段之间的空隙
   * 视频 clips 必须紧密排列，不允许有空隙
   * 使用 1ms 容差来处理浮点精度问题
   * 注意：使用 getState() 获取最新 clips 数据，避免闭包问题
   */
  const compactVideoClips = useCallback(() => {
    const GAP_TOLERANCE = 1; // 1ms 容差，小于此值的间隙会被自动修复

    // 使用 getState() 获取最新的 clips 和 updateClip
    const latestClips = useEditorStore.getState().clips;
    const latestUpdateClip = useEditorStore.getState().updateClip;

    // 获取所有视频轨道
    const videoTracks = new Set<string>();
    latestClips.forEach(c => {
      if (c.clipType === 'video') {
        videoTracks.add(c.trackId);
      }
    });

    // 对每个视频轨道进行贴紧处理
    videoTracks.forEach(trackId => {
      const trackVideoClips = latestClips
        .filter(c => c.trackId === trackId && c.clipType === 'video')
        .sort((a, b) => a.start - b.start);

      if (trackVideoClips.length === 0) return;

      // ★ 关键修复：视频 clips 必须从 0 开始，紧密排列
      let expectedStart = 0;
      for (const clip of trackVideoClips) {
        if (clip.start !== expectedStart) {
          latestUpdateClip(clip.id, { start: Math.round(expectedStart) });
        }
        expectedStart = expectedStart + clip.duration;
      }
    });
  }, []); // 移除依赖，使用 getState() 获取最新数据

  // 结束拖拽 - 处理跨轨道移动和创建新轨道（支持多选）
  const handleDragEnd = useCallback(() => {
    const currentDragState = dragStateRef.current;
    const currentTargetTrackId = targetTrackIdRef.current;

    if (!currentDragState || !currentTargetTrackId) {
      setDragState(null);
      setTargetTrackId(null);
      return;
    }

    const clip = clips.find(c => c.id === currentDragState.clipId);
    if (!clip) {
      setDragState(null);
      setTargetTrackId(null);
      return;
    }

    // 检查是否为多选拖动
    const isMultiDrag = currentDragState.selectedClipsOriginalStarts && currentDragState.selectedClipsOriginalStarts.size > 1;

    // 计算主 clip 的轨道偏移量（用于多选跨轨道拖动）
    const originalTrackIdx = sortedTracks.findIndex(t => t.id === currentDragState.originalTrackId);
    const targetTrackIdx = currentTargetTrackId.startsWith('__NEW_')
      ? sortedTracks.length
      : sortedTracks.findIndex(t => t.id === currentTargetTrackId);
    const trackIndexDelta = targetTrackIdx - originalTrackIdx;

    if (isMultiDrag) {
      // 多选拖动：处理跨轨道移动
      // 时间位置已在 handleDragMove 中更新，这里只处理轨道变更
      if (trackIndexDelta !== 0 && currentDragState.selectedClipsOriginalTrackIds) {
        currentDragState.selectedClipsOriginalTrackIds.forEach((origTrackId, cid) => {
          const origIdx = sortedTracks.findIndex(t => t.id === origTrackId);
          if (origIdx !== -1) {
            const newIdx = Math.max(0, Math.min(origIdx + trackIndexDelta, sortedTracks.length - 1));
            const targetTrack = sortedTracks[newIdx];
            if (targetTrack && targetTrack.id !== origTrackId) {
              updateClip(cid, { trackId: targetTrack.id });
            }
          }
        });
      }
    } else {
      // 单选拖动：处理跨轨道移动
      const originalTrackId = currentDragState.originalTrackId;
      const isVideoClip = clip.clipType === 'video';

      if (currentTargetTrackId.startsWith('__NEW_')) {
        // 用户明确拖到新轨道区域，强制创建新轨道
        const newTrackId = addTrack();
        updateClip(clip.id, { trackId: newTrackId });

        // 如果是视频 clip 且从其他轨道移来，原轨道需要紧凑化
        if (isVideoClip) {
          setTimeout(() => compactVideoClips(), 0);
        }
      } else if (currentTargetTrackId !== originalTrackId) {
        // 跨轨道移动 - 首先检查类型兼容性
        const incompatible = hasIncompatibleClipType(clip.id, clip.clipType, currentTargetTrackId);

        if (incompatible) {
          // 目标轨道有不同类型的 clip，必须创建新轨道
          const newTrackId = addTrack();
          updateClip(clip.id, { trackId: newTrackId });
          if (isVideoClip) {
            setTimeout(() => compactVideoClips(), 0);
          }
        } else if (isVideoClip) {
          // 视频 clip：检查目标轨道是否有重合，有则挤开空间
          const hasOverlap = checkOverlap(clip.id, currentTargetTrackId, clip.start, clip.duration);
          if (hasOverlap) {
            makeRoomForClip(clip.id, currentTargetTrackId, clip.start, clip.duration);
          }
          // 移动到目标轨道
          updateClip(clip.id, { trackId: currentTargetTrackId });
          // 原轨道和目标轨道都需要紧凑化
          setTimeout(() => compactVideoClips(), 0);
        } else {
          // 非视频 clip：检查是否有重合
          if (checkOverlap(clip.id, currentTargetTrackId, clip.start, clip.duration)) {
            // 有重合，创建新轨道
            const newTrackId = addTrack();
            updateClip(clip.id, { trackId: newTrackId });
          } else {
            // 无重合，正常移动到目标轨道
            updateClip(clip.id, { trackId: currentTargetTrackId });
          }
        }
      } else {
        // 同轨道内移动
        if (isVideoClip) {
          // 视频 clip：检查是否有重合，有则挤开空间
          const hasOverlap = checkOverlap(clip.id, clip.trackId, clip.start, clip.duration);
          if (hasOverlap) {
            makeRoomForClip(clip.id, clip.trackId, clip.start, clip.duration);
          }
          // 紧凑化移除空隙
          setTimeout(() => compactVideoClips(), 0);
        } else {
          // 非视频 clip：检查是否有重合
          if (checkOverlap(clip.id, clip.trackId, clip.start, clip.duration)) {
            // 有重合，创建新轨道
            const newTrackId = addTrack();
            updateClip(clip.id, { trackId: newTrackId });
          }
        }
        // 无重合则保持在当前轨道，位置已在 handleDragMove 中更新
      }
    }

    setDragState(null);
    setTargetTrackId(null);
  }, [clips, sortedTracks, checkOverlap, hasIncompatibleClipType, makeRoomForClip, addTrack, updateClip, compactVideoClips]);

  // ========== 边界拖拽功能 (Resize) ==========
  const handleResizeStart = useCallback((e: React.MouseEvent, clipId: string, edge: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    // 拉伸开始时暂停播放，保持播放头在原位
    if (isPlaying) {
      setIsPlaying(false);
    }

    const clip = clips.find(c => c.id === clipId);
    if (!clip) {
      return;
    }

    saveToHistory();

    // 确保 originDuration 有效值
    // 只有 video 受 originDuration 限制，其他类型给 24 小时上限
    const effectiveOriginDuration = clip.clipType === 'video'
      ? Math.max(clip.originDuration ?? clip.duration, clip.duration, 100)
      : 86400000;

    setResizeState({
      clipId,
      edge,
      startX: e.clientX,
      originalStart: clip.start,
      originalDuration: clip.duration,
      originalTrimStart: clip.sourceStart ?? 0,
      originDuration: effectiveOriginDuration,
    });
  }, [clips, saveToHistory, isPlaying, setIsPlaying]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    const currentResizeState = resizeStateRef.current;
    if (!currentResizeState) {
      return;
    }

    const deltaX = e.clientX - currentResizeState.startX;
    const deltaTimeMs = pixelsToMs(deltaX, zoomLevel);

    // 确保 originDuration 是有效的正数
    const safeOriginDuration = Math.max(currentResizeState.originDuration, currentResizeState.originalDuration, 100);
    const minDurationMs = 100; // 最小时长 100 毫秒

    // 获取所有其他 clips 用于跨轨道吸附
    const allOtherClips = clips.filter(c => c.id !== currentResizeState.clipId);
    const currentTime = currentTimeRef.current;

    /**
     * 跨轨道吸附辅助函数
     * @param edgeTime - 当前边缘的时间位置（毫秒）
     * @returns 吸附后的时间位置
     */
    const snapEdgeToClips = (edgeTime: number): number => {
      // 检测所有其他 clip 的边界
      for (const other of allOtherClips) {
        const otherStart = other.start;
        const otherEnd = other.start + other.duration;

        // 吸附到其他 clip 的左边缘
        if (Math.abs(edgeTime - otherStart) < SNAP_THRESHOLD_MS) {
          return otherStart;
        }
        // 吸附到其他 clip 的右边缘
        if (Math.abs(edgeTime - otherEnd) < SNAP_THRESHOLD_MS) {
          return otherEnd;
        }
      }

      // 吸附到播放头
      if (Math.abs(edgeTime - currentTime) < SNAP_THRESHOLD_MS) {
        return currentTime;
      }

      return edgeTime;
    };

    if (currentResizeState.edge === 'left') {
      // 拉左边界：调整 start 和 trimStart，duration 随之变化
      let newTrimStart = currentResizeState.originalTrimStart + deltaTimeMs;

      // 限制 trimStart 范围：[0, originDuration - minDuration]
      newTrimStart = Math.max(0, newTrimStart);
      newTrimStart = Math.min(safeOriginDuration - minDurationMs, newTrimStart);

      // 计算 start 和 duration 的变化
      const trimDelta = newTrimStart - currentResizeState.originalTrimStart;
      let newStart = currentResizeState.originalStart + trimDelta;
      let newDuration = currentResizeState.originalDuration - trimDelta;

      // 确保 start 不为负
      if (newStart < 0) {
        newTrimStart = currentResizeState.originalTrimStart - currentResizeState.originalStart;
        newStart = 0;
        newDuration = currentResizeState.originalDuration + currentResizeState.originalStart;
      }

      // 跨轨道吸附：左边缘吸附
      const snappedStart = snapEdgeToClips(newStart);
      if (snappedStart !== newStart) {
        const snapDelta = snappedStart - newStart;
        newStart = snappedStart;
        newDuration = newDuration - snapDelta;
        newTrimStart = newTrimStart + snapDelta;
      }

      // 最终校验：确保所有值都是有效正数
      newStart = Math.max(0, newStart);
      newDuration = Math.max(minDurationMs, newDuration);
      newTrimStart = Math.max(0, Math.min(newTrimStart, safeOriginDuration - minDurationMs));

      // 使用预览状态（不触发同步）
      setResizePreview({
        clipId: currentResizeState.clipId,
        start: newStart,
        duration: newDuration,
        sourceStart: newTrimStart,
      });
    } else {
      // 拉右边界：只调整 duration
      const currentTrimStart = currentResizeState.originalTrimStart;
      // 最大 duration = originDuration - trimStart
      const maxDuration = Math.max(minDurationMs, safeOriginDuration - currentTrimStart);

      let newDuration = currentResizeState.originalDuration + deltaTimeMs;

      // 跨轨道吸附：右边缘吸附
      const newEnd = currentResizeState.originalStart + newDuration;
      const snappedEnd = snapEdgeToClips(newEnd);
      if (snappedEnd !== newEnd) {
        newDuration = snappedEnd - currentResizeState.originalStart;
      }

      // 最终校验：确保 duration 在有效范围内
      newDuration = Math.max(minDurationMs, newDuration);
      newDuration = Math.min(maxDuration, newDuration);

      // 使用预览状态（不触发同步）
      setResizePreview({
        clipId: currentResizeState.clipId,
        start: currentResizeState.originalStart,
        duration: newDuration,
        sourceStart: currentTrimStart,
      });
    }
  }, [zoomLevel, clips]); // 添加 clips 依赖用于跨轨道吸附

  const handleResizeEnd = useCallback(() => {
    const currentResizeState = resizeStateRef.current;
    const currentResizePreview = resizePreviewRef.current;

    // 在结束时提交最终更改
    if (currentResizeState && currentResizePreview) {
      updateClip(currentResizeState.clipId, {
        start: currentResizePreview.start,
        duration: currentResizePreview.duration,
        sourceStart: currentResizePreview.sourceStart,
      });

      // 视频 clip 自动贴紧 - 移除间隙
      const clip = clips.find(c => c.id === currentResizeState.clipId);
      if (clip?.clipType === 'video') {
        setTimeout(() => compactVideoClips(), 0);
      }
    }
    setResizeState(null);
    setResizePreview(null);
  }, [updateClip, clips, compactVideoClips]); // 添加 clips 和 compactVideoClips 依赖

  // 使用 ref 存储事件处理器，避免闭包问题
  const handleResizeMoveRef = useRef(handleResizeMove);
  const handleResizeEndRef = useRef(handleResizeEnd);
  const handleDragMoveRef = useRef(handleDragMove);
  const handleDragEndRef = useRef(handleDragEnd);

  // 同步最新的处理器到 ref
  useEffect(() => { handleResizeMoveRef.current = handleResizeMove; }, [handleResizeMove]);
  useEffect(() => { handleResizeEndRef.current = handleResizeEnd; }, [handleResizeEnd]);
  useEffect(() => { handleDragMoveRef.current = handleDragMove; }, [handleDragMove]);
  useEffect(() => { handleDragEndRef.current = handleDragEnd; }, [handleDragEnd]);

  // 记录是否刚完成拖拽/resize操作，用于阻止 click 事件
  const justFinishedDragOrResize = useRef(false);

  useEffect(() => {
    if (dragState?.isDragging) {
      const onMouseMove = (e: MouseEvent) => handleDragMoveRef.current(e);
      const onMouseUp = () => {
        justFinishedDragOrResize.current = true;
        handleDragEndRef.current();
        // 短暂延迟后重置标志
        setTimeout(() => { justFinishedDragOrResize.current = false; }, 100);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    }
  }, [dragState?.isDragging]); // 只依赖 isDragging

  useEffect(() => {
    if (resizeState) {
      const onMouseMove = (e: MouseEvent) => handleResizeMoveRef.current(e);
      const onMouseUp = () => {
        justFinishedDragOrResize.current = true;
        handleResizeEndRef.current();
        // 短暂延迟后重置标志
        setTimeout(() => { justFinishedDragOrResize.current = false; }, 100);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    }
  }, [!!resizeState]); // 只依赖 resizeState 是否存在

  // ========== 框选功能 ==========
  // 获取鼠标在 timeline 容器内的坐标（包含滚动偏移）
  const getMarqueeCoords = useCallback((e: MouseEvent | React.MouseEvent) => {
    const container = timelineRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left + container.scrollLeft,
      y: e.clientY - rect.top + container.scrollTop,
    };
  }, []);

  // 框选开始 - Mac: Command + 拖拽, Windows: Ctrl + 拖拽
  const handleMarqueeStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if ((e.target as HTMLElement).closest('.track-clip')) return;

    e.preventDefault();
    e.stopPropagation();

    const coords = getMarqueeCoords(e);
    if (!coords) return;

    setMarqueeState({ startX: coords.x, startY: coords.y, currentX: coords.x, currentY: coords.y });
    clearSelection();
  }, [clearSelection, getMarqueeCoords]);

  // 计算框选矩形的边界
  const getMarqueeBounds = useCallback((state: NonNullable<typeof marqueeState>) => ({
    left: Math.min(state.startX, state.currentX),
    right: Math.max(state.startX, state.currentX),
    top: Math.min(state.startY, state.currentY),
    bottom: Math.max(state.startY, state.currentY),
  }), []);

  // 框选事件监听 - 合并 move 和 end 处理
  useEffect(() => {
    if (!marqueeState) return;

    const handleMove = (e: MouseEvent) => {
      const coords = getMarqueeCoords(e);
      if (coords) {
        setMarqueeState(prev => prev ? { ...prev, currentX: coords.x, currentY: coords.y } : null);
      }
    };

    const handleEnd = () => {
      // 获取当前 state 快照用于计算选中
      const currentState = marqueeState;
      if (!currentState) return;

      const bounds = getMarqueeBounds(currentState);
      const selectedIds: string[] = [];

      // 刻度尺高度 40px + py-2 padding 8px
      const TRACK_OFFSET = 48;

      sortedTracks.forEach((track, trackIndex) => {
        const trackTop = TRACK_OFFSET + trackIndex * 48;
        const trackBottom = trackTop + 48;

        // Y 方向交集检测
        if (trackBottom < bounds.top || trackTop > bounds.bottom) return;

        clips.filter(c => c.trackId === track.id).forEach(clip => {
          const clipLeft = msToPixels(clip.start, zoomLevel);
          const clipRight = msToPixels(clip.start + clip.duration, zoomLevel);

          // X 方向交集检测（碰到即选中）
          if (clipRight >= bounds.left && clipLeft <= bounds.right) {
            selectedIds.push(clip.id);
          }
        });
      });

      setMarqueeState(null);

      if (selectedIds.length > 0) {
        setTimeout(() => useEditorStore.getState().selectClipsByIds(selectedIds), 0);
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
    };
  }, [marqueeState, clips, sortedTracks, zoomLevel, getMarqueeCoords, getMarqueeBounds]);

  // 计算框选矩形的样式
  const marqueeStyle = useMemo(() => {
    if (!marqueeState) return null;
    const bounds = getMarqueeBounds(marqueeState);
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    };
  }, [marqueeState, getMarqueeBounds]);

  // ========== 鼠标滚轮缩放 ==========
  const handleWheel = useCallback((e: WheelEvent) => {
    // Mac: Command(metaKey) + 滚轮
    // Windows: Ctrl(ctrlKey) + 滚轮
    const isZoomModifier = e.metaKey || e.ctrlKey;

    if (!isZoomModifier) return;

    // 阻止浏览器默认的页面缩放行为
    e.preventDefault();
    e.stopPropagation();

    if (!timelineRef.current) return;

    // 获取鼠标在时间轴上的位置
    const rect = timelineRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const scrollLeft = timelineRef.current.scrollLeft;

    // 计算鼠标指向的时间点（毫秒）
    const mouseTimeMs = pixelsToMs(mouseX + scrollLeft, zoomLevel);

    // 计算新的缩放级别（向上滚动放大，向下滚动缩小）
    const delta = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel * delta));

    // 设置新的缩放级别
    setZoomLevel(newZoom);

    // 调整滚动位置，保持鼠标指向的时间点不变
    requestAnimationFrame(() => {
      if (timelineRef.current) {
        const newScrollLeft = msToPixels(mouseTimeMs, newZoom) - mouseX;
        timelineRef.current.scrollLeft = Math.max(0, newScrollLeft);
      }
    });
  }, [zoomLevel, setZoomLevel]);

  // 绑定滚轮事件
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    // 使用 passive: false 以便可以 preventDefault
    timeline.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      timeline.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // ========== Asset 拖放处理 ==========
  // 处理 Asset 从素材面板拖入时间轴
  const handleAssetDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 检查是否是 asset 拖放
    const types = e.dataTransfer.types;
    if (!types.includes('application/json')) return;
    
    e.dataTransfer.dropEffect = 'copy';
    
    if (!timelineRef.current) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const dropX = e.clientX - rect.left + timelineRef.current.scrollLeft;
    
    // 找到鼠标下方的轨道
    const trackElement = (e.target as HTMLElement).closest('[data-track-id]');
    const dropTrackId = trackElement?.getAttribute('data-track-id') || null;
    
    setAssetDropState({
      isOver: true,
      dropX,
      dropTrackId,
    });
  }, []);

  const handleAssetDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // 只有当离开整个轨道容器时才清除状态
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!tracksContainerRef.current?.contains(relatedTarget)) {
      setAssetDropState(null);
    }
  }, []);

  const handleAssetDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setAssetDropState(null);
    
    // 解析拖放数据
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type !== 'asset' || !data.asset) return;
      
      const asset = data.asset;
      
      // 处理视频、音频和图片素材
      if (asset.type !== 'video' && asset.type !== 'audio' && asset.type !== 'image') return;
      
      if (!timelineRef.current) return;
      
      const rect = timelineRef.current.getBoundingClientRect();
      const dropX = e.clientX - rect.left + timelineRef.current.scrollLeft;
      const dropTimeMs = pixelsToMs(dropX, zoomLevel);
      
      // 计算素材时长（秒转毫秒）
      // 图片默认显示 3 秒
      const isImage = asset.type === 'image';
      const durationMs = isImage ? 3000 : (asset.metadata?.duration || 10) * 1000;
      
      // 获取素材的宽高比
      let aspectRatio: '16:9' | '9:16' | '1:1' | undefined;
      if (asset.metadata?.width && asset.metadata?.height) {
        const ratio = asset.metadata.width / asset.metadata.height;
        if (ratio > 1.5) aspectRatio = '16:9';
        else if (ratio < 0.7) aspectRatio = '9:16';
        else aspectRatio = '1:1';
      }
      
      // 确定 clip 类型 (video/audio/image)
      let clipType: ClipType;
      if (asset.type === 'video') clipType = 'video';
      else if (asset.type === 'audio') clipType = 'audio';
      else clipType = 'image';
      
      // 创建新的 clip ID（必须是 UUID 格式，后端会验证）
      const clipId = crypto.randomUUID();
      
      // 找到或创建合适的轨道
      const trackId = findOrCreateTrack(clipType, clipId, dropTimeMs, durationMs);
      
      // 保存历史记录
      saveToHistory();
      
      // 创建新的 clip
      const newClip: Clip = {
        id: clipId,
        trackId,
        clipType,
        start: dropTimeMs,
        duration: durationMs,
        sourceStart: 0,
        originDuration: durationMs,
        name: asset.name,
        color: CLIP_TYPE_COLORS[clipType],
        isLocal: false,
        assetId: asset.id,
        thumbnail: asset.thumbnail_url,
        mediaUrl: asset.url,
        uploadStatus: 'uploaded',
        volume: 1.0,
        isMuted: false,
        speed: 1.0,
        aspectRatio,
      };
      
      // 添加 clip 到 store
      const addClip = getStore().addClip;
      addClip(newClip);
      
      // 选中新创建的 clip
      selectClip(clipId, false);
      
      console.log('[Timeline] Asset dropped, created clip:', clipId, 'at', dropTimeMs, 'ms');
    } catch (err) {
      console.error('[Timeline] Failed to handle asset drop:', err);
    }
  }, [zoomLevel, findOrCreateTrack, saveToHistory, selectClip, getStore]);

  // 点击时间轴跳转（只在非框选时生效）
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    // 如果刚完成拖拽或resize操作，忽略这次点击
    if (justFinishedDragOrResize.current) {
      return;
    }
    // 框选模式下不改变播放头
    if (e.metaKey || e.ctrlKey) return;
    if ((e.target as HTMLElement).closest('.track-clip')) return;
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    if ((e.target as HTMLElement).closest('.playhead-handle')) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const timeMs = pixelsToMs(clickX, zoomLevel);
    setCurrentTime(timeMs);
    // 只更新播放头位置，不清除选择 - 让用户可以在选中clip时自由移动播放头
    // clearSelection(); // 移除：操作播放头不应该取消clip选择
  };

  // ========== 播放头拖动 ==========
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsScrubbingPlayhead(true);

    // 暂停播放
    if (isPlaying) {
      setIsPlaying(false);
    }
  }, [isPlaying, setIsPlaying]);

  // 播放头拖动事件监听
  useEffect(() => {
    if (!isScrubbingPlayhead) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left + timelineRef.current.scrollLeft;
      const timeMs = Math.max(0, pixelsToMs(clickX, zoomLevel));
      setCurrentTime(timeMs);
    };

    const handleMouseUp = () => {
      setIsScrubbingPlayhead(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbingPlayhead, zoomLevel, setCurrentTime]);

  // ========== 淡入淡出拖动 ==========
  const handleFadeStart = useCallback((e: React.MouseEvent, clipId: string, type: 'fadeIn' | 'fadeOut') => {
    e.preventDefault();
    e.stopPropagation();

    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    saveToHistory();
    const originalValue = type === 'fadeIn'
      ? (clip.metadata?.fadeIn ?? 0)
      : (clip.metadata?.fadeOut ?? 0);

    setFadeState({
      clipId,
      type,
      startX: e.clientX,
      originalValue,
    });
  }, [clips, saveToHistory]);

  // 淡入淡出拖动事件监听
  useEffect(() => {
    if (!fadeState) return;

    const handleFadeMove = (e: MouseEvent) => {
      const currentFadeState = fadeStateRef.current;
      if (!currentFadeState) return;

      const clip = clips.find(c => c.id === currentFadeState.clipId);
      if (!clip) return;

      const deltaX = e.clientX - currentFadeState.startX;
      const deltaTimeMs = pixelsToMs(deltaX, zoomLevel);

      // 计算新值
      let newValue: number;
      if (currentFadeState.type === 'fadeIn') {
        // 向右拖增加淡入
        newValue = Math.max(0, Math.min(10000, currentFadeState.originalValue + deltaTimeMs));
      } else {
        // 向左拖增加淡出（负方向）
        newValue = Math.max(0, Math.min(10000, currentFadeState.originalValue - deltaTimeMs));
      }

      // 限制不超过 clip 时长的一半
      newValue = Math.min(newValue, clip.duration / 2);

      updateClip(clip.id, {
        metadata: {
          ...clip.metadata,
          [currentFadeState.type]: newValue,
        },
      });
    };

    const handleFadeEnd = () => {
      setFadeState(null);
    };

    window.addEventListener('mousemove', handleFadeMove);
    window.addEventListener('mouseup', handleFadeEnd);
    return () => {
      window.removeEventListener('mousemove', handleFadeMove);
      window.removeEventListener('mouseup', handleFadeEnd);
    };
  }, [fadeState, clips, zoomLevel, updateClip]);

  // 片段点击处理
  const handleClipClick = (e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    const isMultiSelect = e.shiftKey;
    selectClip(clipId, isMultiSelect);

    // 如果是字幕或文本类型，自动打开对应面板
    const clip = clips.find(c => c.id === clipId);
    if (clip) {
      if (clip.clipType === 'subtitle') {
        setActiveSidebarPanel('subtitle');
      } else if (clip.clipType === 'text') {
        setActiveSidebarPanel('text');
      }
    }
  };

  // 右键菜单
  const handleContextMenu = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedClipIds.has(clipId)) {
      selectClip(clipId, false);
    }
    openContextMenu(e.clientX, e.clientY, clipId);
  };

  // 轨道右键菜单
  const handleTrackContextMenu = (e: React.MouseEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    openTrackContextMenu(e.clientX, e.clientY, trackId);
  };

  // 渲染删除区域遮罩
  const renderClipContent = (clip: typeof clips[0], clipWidth: number, isSelected?: boolean) => {
    const deletedSegments = transcript.filter(
      (t) => t.deleted && t.start >= clip.start && t.end <= clip.start + clip.duration
    );

    // 检查是否是换气片段（死寂/卡顿已在 ASR 阶段自动切除）
    const silenceInfo = clip.silenceInfo || clip.metadata?.silence_info;
    const silenceType = silenceInfo?.classification;

    // 只有换气片段会显示标签
    let silenceLabel = '';
    let silenceColor = '';
    if (silenceType === 'breath') {
      silenceLabel = '🫁 换气';
      silenceColor = 'text-emerald-300';
    }

    // ★★★ 视频片段：显示缩略图序列 ★★★
    if (clip.clipType === 'video') {
      return (
        <div className="relative w-full h-full overflow-hidden pointer-events-none rounded-sm">
          <ClipThumbnail clip={clip} width={clipWidth} height={68} />
          {/* 删除区域遮罩 */}
          {deletedSegments.map((ds) => (
            <div
              key={ds.id}
              className="absolute h-full bg-gray-500/60 backdrop-blur-[2px] z-10 flex items-center justify-center border-x border-gray-300"
              style={{
                left: `${((ds.start - clip.start) / clip.duration) * 100}%`,
                width: `${((ds.end - ds.start) / clip.duration) * 100}%`,
              }}
            >
              <div className="scale-75 opacity-50">
                <Trash2 size={12} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    // 音频片段：使用 ClipThumbnail 渲染波形
    if (clip.clipType === 'audio') {
      return (
        <div className="relative w-full h-full overflow-hidden pointer-events-none">
          <ClipThumbnail clip={clip} width={clipWidth} height={44} />
          {/* 音频名称覆盖层 */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-0.5">
            <span className="text-[9px] font-medium text-white/90 truncate block">
              {clip.name}
            </span>
          </div>
        </div>
      );
    }

    // 字幕片段：黄色主题显示字幕文本
    if (clip.clipType === 'subtitle') {
      return (
        <div className={`relative w-full h-full overflow-hidden pointer-events-none ${isSelected ? 'bg-amber-300' : 'bg-amber-400'}`}>
          <div className="absolute inset-0 flex items-center px-2">
            <span className={`text-xs font-medium truncate ${isSelected ? 'text-amber-950' : 'text-amber-900'}`}>
              {clip.contentText || clip.name}
            </span>
          </div>
        </div>
      );
    }

    // 文本片段：灰色主题显示文本
    if (clip.clipType === 'text') {
      return (
        <div className={`relative w-full h-full overflow-hidden pointer-events-none ${isSelected ? 'bg-gray-300' : 'bg-gray-400'}`}>
          <div className="absolute inset-0 flex items-center px-2">
            <span className={`text-xs font-medium truncate ${isSelected ? 'text-gray-950' : 'text-gray-900'}`}>
              {clip.contentText || clip.name}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="relative w-full h-full overflow-hidden pointer-events-none">
        {deletedSegments.map((ds) => (
          <div
            key={ds.id}
            className="absolute h-full bg-gray-500/60 backdrop-blur-[2px] z-10 flex items-center justify-center border-x border-gray-300"
            style={{
              left: `${((ds.start - clip.start) / clip.duration) * 100}%`,
              width: `${((ds.end - ds.start) / clip.duration) * 100}%`,
            }}
          >
            <div className="scale-75 opacity-50">
              <Trash2 size={12} />
            </div>
          </div>
        ))}
        <div className="absolute inset-0 flex items-center px-2">
          <span className={`text-[10px] font-bold truncate drop-shadow-md uppercase tracking-wider ${silenceLabel ? silenceColor : 'text-white/90'}`}>
            {/* 静音片段显示类型标签，其他显示名称 */}
            {silenceLabel || clip.name}
          </span>
        </div>
      </div>
    );
  };

  // 渲染单个轨道的片段
  const renderTrackClips = (track: Track) => {
    // 获取属于这个轨道的片段
    // 多选拖拽时，需要计算每个选中 clip 的目标轨道
    const trackClips = clips.filter(c => {
      const isSelected = selectedClipIds.has(c.id);
      const isDraggingThisClip = dragState?.clipId === c.id;
      const isMultiDrag = dragState && dragState.selectedClipsOriginalStarts && dragState.selectedClipsOriginalStarts.size > 1;

      // 多选拖动时，检查此 clip 是否是选中的一部分
      if (isMultiDrag && isSelected && dragState.selectedClipsOriginalTrackIds) {
        // 计算这个 clip 应该显示在哪个轨道
        const origTrackId = dragState.selectedClipsOriginalTrackIds.get(c.id);
        if (origTrackId) {
          const origIdx = sortedTracks.findIndex(t => t.id === origTrackId);
          const mainOrigIdx = sortedTracks.findIndex(t => t.id === dragState.originalTrackId);
          const mainTargetIdx = targetTrackId?.startsWith('__NEW_')
            ? sortedTracks.length
            : sortedTracks.findIndex(t => t.id === targetTrackId);
          const trackDelta = mainTargetIdx - mainOrigIdx;
          const thisTargetIdx = Math.max(0, Math.min(origIdx + trackDelta, sortedTracks.length - 1));

          // 如果目标是新轨道区域
          if (targetTrackId?.startsWith('__NEW_')) {
            // 主 clip 不在任何现有轨道渲染
            return isDraggingThisClip ? false : c.trackId === track.id;
          }

          const thisTargetTrack = sortedTracks[thisTargetIdx];
          return thisTargetTrack?.id === track.id;
        }
      }

      if (isDraggingThisClip) {
        // 正在拖拽的片段：根据目标轨道决定是否在当前轨道显示
        if (targetTrackId?.startsWith('__NEW_')) {
          // 目标是新轨道，不在任何现有轨道渲染（会在新轨道占位符中渲染）
          return false;
        }
        return targetTrackId === track.id;
      }
      // 非拖拽中的片段：正常按 trackId 过滤
      return c.trackId === track.id;
    });

    return trackClips.map((c) => {
      const isSelected = selectedClipIds.has(c.id);
      const isDragging = dragState?.clipId === c.id;
      const isResizing = resizeState?.clipId === c.id;
      // 所有类型的 clip 都可以 resize
      const canResize = true;
      const hasKeyframes = clipHasKeyframes(c.id);

      // Silence Handling
      const silenceInfo = c.silenceInfo || c.metadata?.silence_info;
      const isSilence = !!silenceInfo;
      const silenceType = silenceInfo?.classification;

      // 现在只有换气片段（死寂/卡顿已在 ASR 阶段自动切除）
      const isBreath = silenceType === 'breath';

      // 是否是视频clip（用于高度样式）
      const isVideoClip = c.clipType === 'video';

      // Dynamic Styling for Silence Clips
      let clipClasses = `track-clip group ${isVideoClip ? 'video-clip' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''} `;

      if (isSilence && isBreath) {
        // Breath: 纯色绿色背景 + 虚线边框
        clipClasses += 'bg-emerald-600/50 border-2 border-dashed border-emerald-400 ';
      } else {
        // Normal Clip
        clipClasses += CLIP_TYPE_COLORS[c.clipType] || c.color;
      }

      // 如果正在拉伸，使用预览值渲染
      const displayStart = isResizing && resizePreview ? resizePreview.start : c.start;
      const displayDuration = isResizing && resizePreview ? resizePreview.duration : c.duration;

      // Get all keyframes for this clip (V2: 始终显示)
      const clipKeyframes = getClipKeyframes(c.id);

      // 计算clip的垂直位置：居中显示，留2px上下边距
      const trackHeight = isVideoClip ? VIDEO_TRACK_HEIGHT : TRACK_HEIGHT;
      const clipHeight = isVideoClip ? 68 : 44;  // 轨道高度 - 4px 边距
      const topOffset = (trackHeight - clipHeight) / 2;

      return (
        <div
          key={c.id}
          data-clip-id={c.id}
          onContextMenu={(e) => handleContextMenu(e, c.id)}
          onClick={(e) => !dragState && !resizeState && handleClipClick(e, c.id)}
          onMouseDown={(e) => {
            // 阻止冒泡，防止触发框选
            e.stopPropagation();
            // 只有点击中间区域才触发拖拽（排除 resize handle、delete button 和 fade handle）
            const target = e.target as HTMLElement;
            if (!target.closest('.resize-handle') && !target.closest('.delete-btn') && !target.closest('.fade-handle')) {
              handleDragStart(e, c.id, c.start, track.id);
            }
          }}
          className={clipClasses}
          style={{
            left: msToPixels(displayStart, zoomLevel),
            width: msToPixels(displayDuration, zoomLevel),
            top: `${topOffset}px`,
            cursor: isDragging ? 'grabbing' : isResizing ? 'ew-resize' : 'grab',
            zIndex: isDragging || isResizing ? 50 : isSelected ? 10 : 1,
          }}
          title={isBreath ? `换气 (${silenceInfo?.duration_ms}ms)` : undefined}
        >
          {/* 左边界拖拽手柄 */}
          {canResize && (
            <div
              className="resize-handle absolute left-0 top-0 w-2 h-full cursor-ew-resize z-20 hover:bg-white/30 transition-colors"
              onMouseDown={(e) => handleResizeStart(e, c.id, 'left')}
            >
              <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}

          {/* Visual Indicator for Breath (only type remaining) */}
          {isBreath ? (
            <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-80 group-hover:opacity-100 transition-opacity flex items-center space-x-1 pointer-events-none z-20">
              <Wind size={12} className="text-emerald-400" />
            </div>
          ) : (
            <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-30 transition-opacity pointer-events-none">
              <GripVertical size={12} />
            </div>
          )}

          {/* 换气片段删除交互层 - 确保小片段也能点击删除 */}
          {isBreath && (
            <>
              {/* 浮动删除按钮 - 悬浮在片段上方，确保总是可点击 */}
              <div
                className="delete-btn absolute -top-5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all z-[60] pointer-events-auto"
              >
                <button
                  className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded-md shadow-lg flex items-center space-x-1 text-[10px] font-bold whitespace-nowrap"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    removeClip(c.id);
                  }}
                  title="删除此片段"
                >
                  <X size={10} strokeWidth={3} />
                  <span>删除</span>
                </button>
              </div>
              {/* 整个片段可点击删除（对于极小片段） */}
              <div
                className="absolute inset-0 z-[55] cursor-pointer pointer-events-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  // 只有非常小的片段才直接删除，大片段保持正常交互
                  const widthPx = msToPixels(displayDuration, zoomLevel);
                  if (widthPx < 30) {
                    removeClip(c.id);
                  }
                }}
                onDoubleClick={(e) => {
                  // 双击删除（作为备用方式）
                  e.stopPropagation();
                  e.preventDefault();
                  removeClip(c.id);
                }}
              />
            </>
          )}

          {renderClipContent(c, msToPixels(displayDuration, zoomLevel), isSelected)}
          {isSelected && selectedCount > 1 && (
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-gray-700 text-white text-[8px] font-black rounded-full flex items-center justify-center shadow-lg">
              ✓
            </div>
          )}

          {/* Keyframe diamonds - 始终显示关键帧标记 (V2: 使用 offset) */}
          {hasKeyframes && clipKeyframes.map((kf) => (
            <KeyframeDiamond
              key={kf.id}
              keyframe={kf}
              clipWidth={msToPixels(c.duration, zoomLevel)}
              isSelected={selectedKeyframeIds.has(kf.id)}
            />
          ))}

          {/* 右边界拖拽手柄 */}
          {canResize && (
            <div
              className="resize-handle absolute right-0 top-0 w-2 h-full cursor-ew-resize z-20 hover:bg-white/30 transition-colors"
              onMouseDown={(e) => handleResizeStart(e, c.id, 'right')}
            >
              <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}

          {/* 淡入淡出可视化和拖拽点 - 仅音频/配音类型（视频不需要） */}
          {(c.clipType === 'audio' || c.clipType === 'voice') && (
            <FadeHandles
              clip={c}
              clipWidth={msToPixels(displayDuration, zoomLevel)}
              onFadeStart={handleFadeStart}
            />
          )}
        </div>
      );
    });
  };

  // 渲染拖拽到新轨道时的片段
  const renderDraggingClipInNewTrack = () => {
    if (!dragState || !targetTrackId?.startsWith('__NEW_')) return null;

    const clip = clips.find(c => c.id === dragState.clipId);
    if (!clip) return null;

    return (
      <div
        className={`track-clip dragging ${CLIP_TYPE_COLORS[clip.clipType] || clip.color}`}
        style={{
          left: msToPixels(clip.start, zoomLevel),
          width: msToPixels(clip.duration, zoomLevel),
          top: '4px',
          cursor: 'grabbing',
          zIndex: 50,
        }}
      >
        <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-30 transition-opacity">
          <GripVertical size={12} />
        </div>
        {renderClipContent(clip, msToPixels(clip.duration, zoomLevel), true)}
      </div>
    );
  };

  return (
    <div className="w-full flex-1 bg-white flex flex-col z-40 overflow-hidden relative">
      {/* 关键帧属性面板 */}
      <KeyframePanel />

      {/* 时间轴工具栏 - 简化版本 */}
      <div className="h-10 flex items-center justify-between px-4 bg-white flex-shrink-0 overflow-hidden">
        <div className="flex items-center space-x-3 flex-shrink-0 min-w-0">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-gray-100 rounded-lg">
            <Magnet size={12} className="text-gray-600" />
            <span className="text-[9px] font-medium text-gray-600">Snap</span>
          </div>
          {selectedCount > 0 && (
            <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-gray-900 rounded-lg">
              <span className="text-[9px] font-medium text-white">{selectedCount} 选中</span>
            </div>
          )}
          {/* 换气片段统计与操作 */}
          {silenceStats.breath > 0 && (
            <div className="flex items-center space-x-2 px-2.5 py-1 bg-emerald-50 rounded-lg">
              <Wind size={12} className="text-emerald-600" />
              <span className="text-[9px] font-medium text-emerald-600">
                {silenceStats.breath} 换气
              </span>
              <button
                onClick={() => setShowCleanupDialog(true)}
                className="ml-1 px-1.5 py-0.5 text-[9px] bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors flex items-center space-x-1"
                title="查看换气片段，选择是否删除"
              >
                <Settings size={10} />
                <span>管理</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3 flex-shrink-0">
          {/* 缩放控制 */}
          <div className="flex items-center space-x-2 text-gray-500">
            <button onClick={() => setZoomLevel(zoomLevel / ZOOM_STEP)} className="hover:text-gray-900 p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="缩小">
              <Minus size={14} />
            </button>
            <div className="w-20 h-1 bg-gray-200 rounded-full relative overflow-hidden">
              <div
                className="absolute h-full bg-gray-400 rounded-full transition-all duration-300"
                style={{ width: `${(Math.log(zoomLevel / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * 100}%` }}
              />
            </div>
            <button onClick={() => setZoomLevel(zoomLevel * ZOOM_STEP)} className="hover:text-gray-900 p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="放大">
              <Plus size={14} />
            </button>
            <span className="text-[10px] font-mono text-gray-500 w-10">{zoomLevel >= 10 ? zoomLevel.toFixed(0) : zoomLevel.toFixed(1)}x</span>
          </div>
        </div>
      </div>

      {/* 轨道编辑核心 - 隐藏左侧Track标签列，只显示clips */}
      <div className="flex-1 flex overflow-hidden">
        {/* 轨道时间网格 - 占据全部宽度 */}
        <div
          ref={timelineRef}
          onClick={handleTimelineClick}
          onMouseDown={handleMarqueeStart}
          className="flex-1 relative overflow-x-auto overflow-y-auto custom-scrollbar bg-[#F8F8F8] scroll-smooth"
        >
          {/* 刻度尺 - 动态调整 */}
          <div className="h-8 sticky top-0 bg-white z-20 border-b border-gray-100">
            {(() => {
              const tick = getTickInterval(zoomLevel);
              // totalDuration 是毫秒，转成秒来计算刻度
              const totalDurationSec = msToSec(totalDuration);
              const maxTimeSec = Math.max(TOTAL_DURATION, totalDurationSec + 10);
              const ticks: JSX.Element[] = [];

              // 渲染次刻度（t 是秒）
              for (let t = 0; t <= maxTimeSec; t += tick.minor) {
                const isMajor = Math.abs(t % tick.major) < 0.001 || Math.abs(t % tick.major - tick.major) < 0.001;
                if (!isMajor) {
                  ticks.push(
                    <div
                      key={`minor-${t}`}
                      className="absolute border-l border-gray-200 h-2 bottom-0"
                      style={{ left: t * TICK_WIDTH * zoomLevel }}
                    />
                  );
                }
              }

              // 渲染主刻度（t 是秒）
              for (let t = 0; t <= maxTimeSec; t += tick.major) {
                ticks.push(
                  <div
                    key={`major-${t}`}
                    className="absolute border-l border-gray-300 h-full"
                    style={{ left: t * TICK_WIDTH * zoomLevel }}
                  >
                    <span className="text-[10px] ml-1.5 font-medium font-mono text-gray-500">
                      {tick.format(t)}
                    </span>
                  </div>
                );
              }

              return ticks;
            })()}
          </div>

          {/* 轨道内容绘制 - 去掉轨道间的分隔线 */}
          <div
            ref={tracksContainerRef}
            className={`min-w-max px-0 py-1 pr-16 relative ${
              assetDropState?.isOver ? 'ring-2 ring-blue-400 ring-inset bg-blue-50/30' : ''
            }`}
            onDragOver={handleAssetDragOver}
            onDragLeave={handleAssetDragLeave}
            onDrop={handleAssetDrop}
          >
            {/* Asset 拖放位置指示器 */}
            {assetDropState?.isOver && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-50 pointer-events-none"
                style={{ left: assetDropState.dropX }}
              >
                <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-blue-500 rounded-full" />
              </div>
            )}
            {/* 所有轨道 */}
            {sortedTracks.map((track, index) => {
              const trackHeight = getTrackHeight(track.id, clips);
              return (
                <div
                  key={track.id}
                  className={`relative group transition-colors ${targetTrackId === track.id ? 'bg-gray-200/50' : ''
                    }`}
                  style={{ height: `${trackHeight}px` }}
                  data-track-id={track.id}
                  data-track-index={index}
                >
                  {renderTrackClips(track)}
                </div>
              );
            })}
            {/* 新建轨道区域提示 */}
            {dragState && targetTrackId?.startsWith('__NEW_TRACK') && (
              <div className="relative bg-gray-200/30" style={{ height: `${VIDEO_TRACK_HEIGHT}px` }}>
                {renderDraggingClipInNewTrack()}
              </div>
            )}
          </div>

          {/* 框选矩形 - 渲染在 timelineRef 容器内，使用绝对定位 */}
          {marqueeStyle && (
            <div
              className="absolute pointer-events-none border-2 border-gray-500/70 bg-gray-1000/10 z-50"
              style={{
                left: marqueeStyle.left,
                top: marqueeStyle.top,
                width: marqueeStyle.width,
                height: marqueeStyle.height,
              }}
            />
          )}

          {/* 播放头 - 可拖动，使用 ref 直接更新 DOM 避免重渲染 */}
          <div
            ref={playheadRef}
            className="absolute top-0 w-[2px] bg-gray-800 z-30 pointer-events-none"
            style={{
              transform: `translateX(${msToPixels(currentTimeRef.current, zoomLevel)}px)`,
              height: `calc(32px + ${sortedTracks.reduce((sum, track) => sum + getTrackHeight(track.id, clips), 0) + 8}px)`, // 刻度尺高度 + 动态轨道高度 + padding
            }}
          >
            {/* 播放头手柄 - 可拖动 */}
            <div
              className="playhead-handle w-4 h-6 bg-gray-800 absolute top-0 -left-[7px] clip-path-playhead flex items-center justify-center cursor-grab active:cursor-grabbing hover:bg-gray-900 transition-colors z-50 rounded-b"
              style={{ pointerEvents: 'auto' }}
              onMouseDown={handlePlayheadMouseDown}
            >
              <div className="w-[1px] h-2 bg-white/40 rounded-full" />
            </div>
            <div
              ref={playheadLabelRef}
              className="absolute top-[26px] left-2 bg-gray-800 text-white text-[9px] font-medium px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap pointer-events-none"
            >
              {msToSec(currentTimeRef.current).toFixed(2)}s
            </div>
          </div>
        </div>
      </div>

      {/* 轨道右键菜单 - 保留逻辑但不显示左侧Track标签 */}
      {trackContextMenu.visible && (
        <TrackContextMenu
          x={trackContextMenu.x}
          y={trackContextMenu.y}
          trackId={trackContextMenu.trackId}
          onClose={closeTrackContextMenu}
          onUpdateOrder={updateTrackOrder}
          tracks={tracks}
        />
      )}

      {/* 智能清理向导（统一换气清理 + 智能分析） */}
      <SmartCleanupWizard
        isOpen={showCleanupDialog}
        analysisId=""
        projectId={projectId || ''}
        assetId={clips.find(c => c.clipType === 'video')?.assetId}
        onClose={() => setShowCleanupDialog(false)}
        onConfirm={() => setShowCleanupDialog(false)}
      />
    </div>
  );
}

// 轨道标签子组件
function TrackLabel({
  track,
  clips,
  onContextMenu,
}: {
  track: Track;
  clips: Clip[];
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  // 获取该轨道上的内容块类型
  const trackClips = clips.filter(c => c.trackId === track.id);
  const clipTypes = new Set(trackClips.map(c => c.clipType));

  // 获取轨道动态高度
  const trackHeight = getTrackHeight(track.id, clips);

  // 统一显示 Layers 图标
  const getTrackIcon = () => {
    return <Layers size={14} />;
  };

  return (
    <div
      className="border-b border-gray-200 flex items-center px-2 space-x-2 text-gray-600 hover:bg-gray-100 cursor-pointer group transition-colors"
      style={{ height: `${trackHeight}px` }}
      onContextMenu={onContextMenu}
    >
      {/* 层级控制区域 */}
      <div
        className="w-6 h-full flex flex-col items-center justify-center border-r border-gray-200 pr-2 hover:bg-gray-200 rounded-l"
        title="右键调整层级"
      >
        <span className="text-[8px] font-bold text-gray-500">L{track.orderIndex}</span>
      </div>

      <div className={`group-hover:scale-110 transition-transform ${track.color}`}>{getTrackIcon()}</div>
      <div className="flex flex-col overflow-hidden flex-1">
        <span className="text-[10px] font-black uppercase tracking-tighter truncate text-gray-700 group-hover:text-gray-900">
          Track {track.orderIndex + 1}
        </span>
        <span className="text-[8px] text-gray-400 font-mono tracking-widest uppercase">
          {trackClips.length} clips
        </span>
      </div>
    </div>
  );
}

// 轨道右键菜单
function TrackContextMenu({
  x,
  y,
  trackId,
  onClose,
  onUpdateOrder,
  tracks,
}: {
  x: number;
  y: number;
  trackId: string | null;
  onClose: () => void;
  onUpdateOrder: (trackId: string, orderIndex: number) => void;
  tracks: Track[];
}) {
  const track = tracks.find(t => t.id === trackId);
  if (!track) return null;

  const handleLayerUp = () => {
    onUpdateOrder(track.id, track.orderIndex + 1);
    onClose();
  };

  const handleLayerDown = () => {
    onUpdateOrder(track.id, Math.max(0, track.orderIndex - 1));
    onClose();
  };

  // 计算位置防止溢出
  const menuStyle: React.CSSProperties = {
    top: Math.min(y, window.innerHeight - 150),
    left: Math.min(x, window.innerWidth - 200),
  };

  return (
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div
        className="fixed bg-white border border-gray-200 rounded-xl shadow-xl py-2 w-48 z-[100] animate-fade-in-zoom"
        style={menuStyle}
      >
        <div className="px-3 py-2 border-b border-gray-100 mb-2">
          <div className="text-[10px] font-bold text-gray-900 uppercase">{track.name}</div>
          <div className="text-[8px] text-gray-500">当前层级: {track.orderIndex}</div>
        </div>

        <button
          onClick={handleLayerUp}
          className="w-full px-3 py-2 text-xs flex items-center space-x-3 hover:bg-gray-100 text-gray-700"
        >
          <ChevronUp size={14} />
          <span>层级上移</span>
        </button>
        <button
          onClick={handleLayerDown}
          disabled={track.orderIndex === 0}
          className={`w-full px-3 py-2 text-xs flex items-center space-x-3 hover:bg-gray-100 ${track.orderIndex === 0 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700'}`}
        >
          <ChevronDown size={14} />
          <span>层级下移</span>
        </button>
      </div>
    </>
  );
}
