'use client';

import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useEditorStore } from '../store/editor-store';
import type { Clip } from '../types/clip';
import { TextStyle, DEFAULT_TEXT_STYLE, loadFont } from '../types/text';

// 调试日志开关
const DEBUG_TEXT_OVERLAY = false;  // 关闭调试
const debugLog = (...args: unknown[]) => {
  if (DEBUG_TEXT_OVERLAY) console.log('[TextOverlay]', ...args);
};

// ★ 吸附阈值（像素）- 与 TransformOverlay 保持一致
const SNAP_THRESHOLD = 10;

/**
 * 解析 maxWidth 值（支持数字和百分比格式）
 * @param maxWidth - maxWidth 值，可以是数字或百分比字符串
 * @param containerWidth - 容器宽度（用于计算百分比）
 * @returns 解析后的像素值
 */
function parseMaxWidth(maxWidth: number | string | undefined, containerWidth: number): number {
  if (typeof maxWidth === 'number') {
    return maxWidth;
  }
  if (typeof maxWidth === 'string') {
    // 处理百分比格式，如 "85%"
    if (maxWidth.endsWith('%')) {
      const percent = parseFloat(maxWidth);
      if (!isNaN(percent)) {
        return Math.round(containerWidth * percent / 100);
      }
    }
    // 处理纯数字字符串，如 "400"
    const num = parseFloat(maxWidth);
    if (!isNaN(num)) {
      return num;
    }
  }
  // 默认值：85% 容器宽度
  return Math.round(containerWidth * 0.85);
}

interface TextOverlayProps {
  /** 视频画布容器宽度 */
  containerWidth: number;
  /** 视频画布容器高度 */
  containerHeight: number;
  /** 画布缩放比例 */
  zoom?: number;
  /** 是否显示控制点（选中状态） */
  showControls?: boolean;
}

type HandlePosition = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | 'rotate' | 'move';

interface DragState {
  clipId: string;
  handle: HandlePosition;
  startX: number;
  startY: number;
  startTransformX: number;
  startTransformY: number;
  startScale: number;
  startScaleX: number;
  startScaleY: number;
  startRotation: number;
  startMaxWidth: number;  // 初始 maxWidth（用于左右拉伸改变字幕宽度）
  // 多选拖拽：记录所有选中文本 clip 的初始 transform
  selectedClipsTransforms?: Map<string, {
    x: number;
    y: number;
    scale: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    maxWidth: number;
  }>;
}

/**
 * 文本覆盖层组件
 * 在画布上渲染文本 clip，支持拖拽移动、缩放、旋转、双击编辑
 * 支持多选批量拖拽
 */
export function TextOverlay({
  containerWidth,
  containerHeight,
  zoom = 1,
  showControls = true,
}: TextOverlayProps) {
  const clips = useEditorStore((s) => s.clips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const selectClip = useEditorStore((s) => s.selectClip);
  const updateClip = useEditorStore((s) => s.updateClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const setActiveSidebarPanel = useEditorStore((s) => s.setActiveSidebarPanel);
  const canvasEditMode = useEditorStore((s) => s.canvasEditMode);
  const setCanvasEditMode = useEditorStore((s) => s.setCanvasEditMode);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  // ★ 吸附状态（用于显示辅助线）
  const [snapState, setSnapState] = useState<{ centerX: boolean; centerY: boolean }>({ centerX: false, centerY: false });
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  // 获取当前播放头位置的所有文本 clip
  const visibleTextClips = useMemo(() => {
    return clips.filter(
      (c) =>
        (c.clipType === 'text' || c.clipType === 'subtitle') &&
        currentTime >= c.start &&
        currentTime < c.start + c.duration
    );
  }, [clips, currentTime]);

  // 获取所有选中的文本/字幕 clip（不限于当前可见，用于批量操作）
  const allSelectedTextClips = useMemo(() => {
    return clips.filter(c => 
      (c.clipType === 'text' || c.clipType === 'subtitle') && 
      selectedClipIds.has(c.id)
    );
  }, [clips, selectedClipIds]);

  // 获取所有选中的可见文本 clip
  const selectedVisibleTextClips = useMemo(() => {
    return visibleTextClips.filter(c => selectedClipIds.has(c.id));
  }, [visibleTextClips, selectedClipIds]);

  // 预加载所有可见文本的字体
  useEffect(() => {
    visibleTextClips.forEach((clip) => {
      const style = clip.textStyle as TextStyle | undefined;
      if (style?.fontFamily) {
        loadFont(style.fontFamily);
      }
    });
  }, [visibleTextClips]);

  // 获取文本的完整样式
  const getTextStyle = useCallback((clip: Clip): TextStyle => {
    return {
      ...DEFAULT_TEXT_STYLE,
      ...(clip.textStyle as Partial<TextStyle>),
    };
  }, []);

  // 获取文本的变换属性
  const getTransform = useCallback((clip: Clip) => {
    const scale = clip.transform?.scale ?? 1;
    // 字幕默认位置往上偏移（居中基础上往上移 35%）
    // y 正值往下，负值往上，默认往上移一点（-35% 画布高度）
    const defaultY = clip.clipType === 'subtitle' && clip.transform?.y === undefined 
      ? -containerHeight * 0.35
      : 0;
    return {
      x: clip.transform?.x ?? 0,
      y: clip.transform?.y ?? defaultY,
      scale,
      scaleX: clip.transform?.scaleX ?? scale,
      scaleY: clip.transform?.scaleY ?? scale,
      rotation: clip.transform?.rotation ?? 0,
      opacity: clip.transform?.opacity ?? 1,
    };
  }, [containerHeight]);

  // 点击文本选中
  const handleTextClick = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      e.stopPropagation();
      selectClip(clipId);
      // ★ 如果不在 text 模式，自动切换到 text 模式
      if (canvasEditMode !== 'text') {
        setCanvasEditMode('text');
      }
      // 根据 clipType 自动打开对应面板
      const clip = clips.find(c => c.id === clipId);
      if (clip) {
        if (clip.clipType === 'subtitle') {
          setActiveSidebarPanel('subtitle');
        } else if (clip.clipType === 'text') {
          setActiveSidebarPanel('text');
        }
      }
    },
    [selectClip, canvasEditMode, setCanvasEditMode, clips, setActiveSidebarPanel]
  );

  // 双击打开对应的编辑面板
  const handleTextDoubleClick = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      e.stopPropagation();
      // 先选中该 clip
      selectClip(clipId);
      // 根据 clipType 打开对应面板
      const clip = clips.find(c => c.id === clipId);
      if (clip) {
        if (clip.clipType === 'subtitle') {
          setActiveSidebarPanel('subtitle');
        } else {
          setActiveSidebarPanel('text');
        }
      }
    },
    [selectClip, setActiveSidebarPanel, clips]
  );

  // 退出编辑模式
  const handleEditBlur = useCallback(() => {
    setEditingClipId(null);
  }, []);

  // 更新文本内容
  const handleTextChange = useCallback(
    (clipId: string, newText: string) => {
      updateClip(clipId, { contentText: newText });
    },
    [updateClip]
  );

  // 开始拖拽
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, clipId: string, handle: HandlePosition) => {
      e.preventDefault();
      e.stopPropagation();

      if (editingClipId) return; // 编辑模式下不允许拖拽

      saveToHistory();
      
      // 如果当前 clip 不在选中列表中，清除之前的选中状态，只选中当前 clip
      if (!selectedClipIds.has(clipId)) {
        selectClip(clipId, false);
      }

      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      const transform = getTransform(clip);
      const textStyle = getTextStyle(clip);
      // 获取当前 maxWidth，支持数字或百分比格式
      const currentMaxWidth = parseMaxWidth(textStyle.maxWidth, containerWidth);

      debugLog('handleMouseDown', {
        clipId,
        handle,
        currentTransform: clip.transform,
        parsedTransform: transform,
        maxWidth: currentMaxWidth,
        '★ startScale 将设为': transform.scale,
        '★ startScaleX 将设为': transform.scaleX,
        '★ startScaleY 将设为': transform.scaleY,
      });

      // 记录所有选中的文本 clip 的初始 transform（用于批量拖拽）
      // 使用 allSelectedTextClips 而非 visibleTextClips，确保所有选中的字幕都会被批量移动
      const selectedClipsTransforms = new Map<string, {
        x: number;
        y: number;
        scale: number;
        scaleX: number;
        scaleY: number;
        rotation: number;
        maxWidth: number;
      }>();
      
      // 记录所有选中的文本/字幕 clip（包括不在当前时间点可见的）
      allSelectedTextClips.forEach(c => {
        const t = getTransform(c);
        const style = getTextStyle(c);
        const mw = parseMaxWidth(style.maxWidth, containerWidth);
        selectedClipsTransforms.set(c.id, {
          x: t.x,
          y: t.y,
          scale: t.scale,
          scaleX: t.scaleX,
          scaleY: t.scaleY,
          rotation: t.rotation,
          maxWidth: mw,
        });
      });
      
      // 如果当前拖拽的 clip 不在选中列表中，也记录它
      if (!selectedClipsTransforms.has(clipId)) {
        selectedClipsTransforms.set(clipId, {
          x: transform.x,
          y: transform.y,
          scale: transform.scale,
          scaleX: transform.scaleX,
          scaleY: transform.scaleY,
          rotation: transform.rotation,
          maxWidth: currentMaxWidth,
        });
      }

      setDragState({
        clipId,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startTransformX: transform.x,
        startTransformY: transform.y,
        startScale: transform.scale,
        startScaleX: transform.scaleX,
        startScaleY: transform.scaleY,
        startRotation: transform.rotation,
        startMaxWidth: currentMaxWidth,
        selectedClipsTransforms,
      });
    },
    [allSelectedTextClips, clips, editingClipId, getTransform, saveToHistory, selectClip, selectedClipIds]
  );

  // 拖拽移动
  useEffect(() => {
    if (!dragState) return;

    debugLog('拖拽 useEffect 启动', {
      handle: dragState.handle,
      clipId: dragState.clipId,
      startScale: dragState.startScale,
    });

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = (e.clientX - dragState.startX) / zoom;
      const deltaY = (e.clientY - dragState.startY) / zoom;

      debugLog('handleMouseMove', {
        handle: dragState.handle,
        clientX: e.clientX,
        clientY: e.clientY,
        startX: dragState.startX,
        startY: dragState.startY,
        deltaX,
        deltaY,
        zoom,
      });

      // 获取当前 clip 的完整 transform，确保不丢失其他属性
      const clip = clips.find((c) => c.id === dragState.clipId);
      const currentTransform = clip?.transform || {};
      
      // 检查是否有多个选中的 clip 需要批量更新
      const hasMultiSelect = dragState.selectedClipsTransforms && dragState.selectedClipsTransforms.size > 1;

      if (dragState.handle === 'move') {
        // 移动整体 - 支持批量移动 + 吸附到中心线
        // ★ 计算吸附后的位置（针对主 clip）
        let newX = dragState.startTransformX + deltaX;
        let newY = dragState.startTransformY + deltaY;
        
        // 跟踪吸附状态
        let snappedCenterX = false;
        let snappedCenterY = false;
        
        // 获取文本框实际尺寸（估算）
        const textClip = clips.find(c => c.id === dragState.clipId);
        const textScale = textClip?.transform?.scale || 1;
        const fontSize = 48 * textScale; // 默认字体大小
        // 估算文本宽度（基于 maxWidth 或默认值）
        const textWidth = (dragState.startMaxWidth || 600) * textScale;
        const textHeight = fontSize * 1.5; // 估算高度
        const textHalfW = textWidth / 2;
        const textHalfH = textHeight / 2;
        
        // 画布边界
        const canvasHalfW = containerWidth / 2;
        const canvasHalfH = containerHeight / 2;
        
        // 文本框边缘位置
        const textLeft = newX - textHalfW;
        const textRight = newX + textHalfW;
        const textTop = newY - textHalfH;
        const textBottom = newY + textHalfH;
        
        // ★ X 方向吸附（优先级：中心 > 边缘对齐 > 边缘贴中心）
        if (Math.abs(newX) < SNAP_THRESHOLD) {
          newX = 0;
          snappedCenterX = true;
        }
        // 左边缘对齐画布左边缘
        else if (Math.abs(textLeft - (-canvasHalfW)) < SNAP_THRESHOLD) {
          newX = -canvasHalfW + textHalfW;
        }
        // 右边缘对齐画布右边缘
        else if (Math.abs(textRight - canvasHalfW) < SNAP_THRESHOLD) {
          newX = canvasHalfW - textHalfW;
        }
        // 左边缘贴画布中心
        else if (Math.abs(textLeft) < SNAP_THRESHOLD) {
          newX = textHalfW;
        }
        // 右边缘贴画布中心
        else if (Math.abs(textRight) < SNAP_THRESHOLD) {
          newX = -textHalfW;
        }
        
        // ★ Y 方向吸附
        if (Math.abs(newY) < SNAP_THRESHOLD) {
          newY = 0;
          snappedCenterY = true;
        }
        // 上边缘对齐画布上边缘
        else if (Math.abs(textTop - (-canvasHalfH)) < SNAP_THRESHOLD) {
          newY = -canvasHalfH + textHalfH;
        }
        // 下边缘对齐画布下边缘
        else if (Math.abs(textBottom - canvasHalfH) < SNAP_THRESHOLD) {
          newY = canvasHalfH - textHalfH;
        }
        // 上边缘贴画布中心
        else if (Math.abs(textTop) < SNAP_THRESHOLD) {
          newY = textHalfH;
        }
        // 下边缘贴画布中心
        else if (Math.abs(textBottom) < SNAP_THRESHOLD) {
          newY = -textHalfH;
        }
        
        // 更新吸附状态（用于显示辅助线）
        setSnapState({ centerX: snappedCenterX, centerY: snappedCenterY });
        
        // 计算吸附后的 delta（用于批量移动时应用相同的吸附效果）
        const snappedDeltaX = newX - dragState.startTransformX;
        const snappedDeltaY = newY - dragState.startTransformY;
        
        if (hasMultiSelect) {
          // 批量移动所有选中的文本 clip（使用吸附后的 delta）
          dragState.selectedClipsTransforms!.forEach((startTransform, cid) => {
            const c = clips.find(cl => cl.id === cid);
            if (c) {
              updateClip(cid, {
                transform: {
                  ...c.transform,
                  x: startTransform.x + snappedDeltaX,
                  y: startTransform.y + snappedDeltaY,
                },
              });
            }
          });
        } else {
          // 单个移动
          const newTransform = {
            ...currentTransform,
            x: newX,
            y: newY,
          };
          debugLog('move', {
            deltaX,
            deltaY,
            currentTransform,
            newTransform,
            startScale: dragState.startScale,
          });
          updateClip(dragState.clipId, { transform: newTransform });
        }
      } else if (dragState.handle === 'rotate') {
        // 旋转 - 保留其他 transform 属性
        const centerX = containerWidth / 2 + dragState.startTransformX;
        const centerY = containerHeight / 2 + dragState.startTransformY;
        const startAngle = Math.atan2(
          dragState.startY - centerY * zoom,
          dragState.startX - centerX * zoom
        );
        const currentAngle = Math.atan2(
          e.clientY - centerY * zoom,
          e.clientX - centerX * zoom
        );
        const angleDiff = ((currentAngle - startAngle) * 180) / Math.PI;

        // 批量旋转
        if (hasMultiSelect) {
          dragState.selectedClipsTransforms!.forEach((startTransform, cid) => {
            const c = clips.find(cl => cl.id === cid);
            if (c) {
              updateClip(cid, {
                transform: {
                  ...c.transform,
                  rotation: startTransform.rotation + angleDiff,
                },
              });
            }
          });
        } else {
          const newTransform = {
            ...currentTransform,
            rotation: dragState.startRotation + angleDiff,
          };
          debugLog('rotate', { angleDiff, currentTransform, newTransform });
          updateClip(dragState.clipId, { transform: newTransform });
        }
      } else if (dragState.handle === 'l' || dragState.handle === 'r') {
        // ★ 水平拉伸 → 改变 maxWidth（增加一行能放的字数），而不是拉伸字体
        const widthDelta = dragState.handle === 'r' ? deltaX : -deltaX;
        // 放开限制：最小50px，无最大限制（想拉多长拉多长）
        const newMaxWidth = Math.max(50, dragState.startMaxWidth + widthDelta);
        
        // 批量更新 maxWidth
        if (hasMultiSelect) {
          const widthChange = newMaxWidth - dragState.startMaxWidth;
          dragState.selectedClipsTransforms!.forEach((startTransform, cid) => {
            const c = clips.find(cl => cl.id === cid);
            if (c) {
              const newClipMaxWidth = Math.max(50, startTransform.maxWidth + widthChange);
              updateClip(cid, {
                textStyle: {
                  ...(c.textStyle as object),
                  maxWidth: newClipMaxWidth,
                },
              });
            }
          });
        } else {
          const clip = clips.find(c => c.id === dragState.clipId);
          debugLog('maxWidth change', {
            handle: dragState.handle,
            deltaX,
            startMaxWidth: dragState.startMaxWidth,
            newMaxWidth,
          });
          updateClip(dragState.clipId, {
            textStyle: {
              ...(clip?.textStyle as object),
              maxWidth: newMaxWidth,
            },
          });
        }
      } else if (dragState.handle === 't' || dragState.handle === 'b') {
        // 垂直缩放（上/下边中点）
        const scaleFactor = 200;
        let scaleYDelta = 0;
        
        if (dragState.handle === 'b') {
          scaleYDelta = deltaY / scaleFactor;
        } else {
          scaleYDelta = -deltaY / scaleFactor;
        }
        
        const newScaleY = Math.max(0.1, Math.min(5, dragState.startScaleY + scaleYDelta));
        
        // 批量垂直缩放
        if (hasMultiSelect) {
          const scaleRatio = newScaleY / dragState.startScaleY;
          dragState.selectedClipsTransforms!.forEach((startTransform, cid) => {
            const c = clips.find(cl => cl.id === cid);
            if (c) {
              const newClipScaleY = Math.max(0.1, Math.min(5, startTransform.scaleY * scaleRatio));
              updateClip(cid, {
                transform: {
                  ...c.transform,
                  scaleY: newClipScaleY,
                },
              });
            }
          });
        } else {
          const newTransform = {
            ...currentTransform,
            scaleY: newScaleY,
          };
          debugLog('scaleY', {
            handle: dragState.handle,
            deltaY,
            startScaleY: dragState.startScaleY,
            newScaleY,
          });
          updateClip(dragState.clipId, { transform: newTransform });
        }
      } else {
        // 等比缩放（四角）- 保留其他 transform 属性
        const diagonal = Math.sqrt(containerWidth ** 2 + containerHeight ** 2);
        let scaleDelta = 0;

        debugLog('四角缩放计算', {
          handle: dragState.handle,
          deltaX,
          deltaY,
          containerWidth,
          containerHeight,
          diagonal,
          zoom,
          startScale: dragState.startScale,
        });

        switch (dragState.handle) {
          case 'br':
            scaleDelta = (deltaX + deltaY) / diagonal;
            break;
          case 'bl':
            scaleDelta = (-deltaX + deltaY) / diagonal;
            break;
          case 'tr':
            scaleDelta = (deltaX - deltaY) / diagonal;
            break;
          case 'tl':
            scaleDelta = (-deltaX - deltaY) / diagonal;
            break;
        }

        const newScale = Math.max(0.1, Math.min(5, dragState.startScale + scaleDelta * 2));
        
        debugLog('四角缩放结果', {
          scaleDelta,
          'scaleDelta * 2': scaleDelta * 2,
          startScale: dragState.startScale,
          newScale,
          '变化量': newScale - dragState.startScale,
        });
        
        // 批量等比缩放
        if (hasMultiSelect) {
          const scaleRatio = newScale / dragState.startScale;
          dragState.selectedClipsTransforms!.forEach((startTransform, cid) => {
            const c = clips.find(cl => cl.id === cid);
            if (c) {
              const newClipScale = Math.max(0.1, Math.min(5, startTransform.scale * scaleRatio));
              updateClip(cid, {
                transform: {
                  ...c.transform,
                  scale: newClipScale,
                  scaleX: newClipScale,
                  scaleY: newClipScale,
                },
              });
            }
          });
        } else {
          const newTransform = {
            ...currentTransform,
            scale: newScale,
            scaleX: newScale,
            scaleY: newScale,
          };
          debugLog('scale 单选更新', {
            handle: dragState.handle,
            scaleDelta,
            startScale: dragState.startScale,
            newScale,
            currentTransform,
            newTransform,
            clipId: dragState.clipId,
          });
          updateClip(dragState.clipId, { transform: newTransform });
          
          // 验证更新后的结果
          setTimeout(() => {
            const updatedClip = useEditorStore.getState().clips.find(c => c.id === dragState.clipId);
            debugLog('更新后验证', {
              clipId: dragState.clipId,
              updatedTransform: updatedClip?.transform,
            });
          }, 0);
        }
      }
    };

    const handleMouseUp = () => {
      debugLog('handleMouseUp', { dragState });
      setDragState(null);
      // ★ 清除吸附状态
      setSnapState({ centerX: false, centerY: false });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, containerWidth, containerHeight, zoom, updateClip, clips]);

  // 渲染单个文本
  const renderText = useCallback(
    (clip: Clip) => {
      const style = getTextStyle(clip);
      const transform = getTransform(clip);
      const isSelected = selectedClipId === clip.id;
      const isHovered = hoveredClipId === clip.id;
      const isEditing = editingClipId === clip.id;

      // 调试日志：渲染时的 transform 值
      debugLog('renderText', {
        clipId: clip.id,
        rawTransform: clip.transform,
        parsedTransform: transform,
        fontSize: style.fontSize,
      });

      // 构建 CSS 样式 - 字体大小使用原始值，整体缩放通过 CSS transform 实现
      // ★ 使用 parseMaxWidth 支持百分比格式
      const currentMaxWidth = parseMaxWidth(style.maxWidth, containerWidth);
      const textCssStyle: React.CSSProperties = {
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize}px`,
        fontWeight: style.bold ? 'bold' : 'normal',
        fontStyle: style.italic ? 'italic' : 'normal',
        textDecoration: style.underline ? 'underline' : 'none',
        color: style.fontColor,
        backgroundColor: style.backgroundColor,
        letterSpacing: `${style.letterSpacing}px`,
        lineHeight: style.lineHeight,
        textAlign: style.textAlign,
        opacity: transform.opacity,
        // ★ 文本宽度使用 100%，由容器的 width 控制
        width: '100%',
        // 描边使用 text-stroke（WebKit）+ 备用方案
        WebkitTextStroke: style.strokeEnabled
          ? `${style.strokeWidth}px ${style.strokeColor}`
          : undefined,
        // 阴影
        textShadow: style.shadowEnabled
          ? `${style.shadowOffsetX}px ${style.shadowOffsetY}px ${style.shadowBlur}px ${style.shadowColor}`
          : undefined,
      };

      // 文本框位置（相对于画布中心）- 使用 scaleX/scaleY 实现独立缩放
      // ★ 使用固定宽度，确保边框能反映可编辑区域（maxWidth）
      const boxStyle: React.CSSProperties = {
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
        transformOrigin: 'center center',
        cursor: isEditing ? 'text' : 'move',
        userSelect: isEditing ? 'text' : 'none',
        pointerEvents: 'auto',
        // ★ 使用固定宽度，让边框能反映 maxWidth
        width: `${currentMaxWidth}px`,
        minWidth: `${currentMaxWidth}px`,
      };

      const handleSize = 10;

      return (
        <div
          key={clip.id}
          style={boxStyle}
          onClick={(e) => handleTextClick(e, clip.id)}
          onDoubleClick={(e) => handleTextDoubleClick(e, clip.id)}
          onMouseDown={(e) => handleMouseDown(e, clip.id, 'move')}
          onMouseEnter={() => setHoveredClipId(clip.id)}
          onMouseLeave={() => setHoveredClipId(null)}
        >
          {/* Hover 边框 - 即使不在 text 模式也显示 */}
          {isHovered && !isSelected && !isEditing && (
            <div
              className="absolute inset-0 border-2 border-blue-500/50 border-dashed pointer-events-none"
              style={{ margin: '-8px' }}
            />
          )}

          {/* 选中边框 */}
          {isSelected && showControls && !isEditing && (
            <>
              {/* 边框 */}
              <div
                className="absolute inset-0 border-2 border-blue-500 pointer-events-none"
                style={{ margin: '-8px' }}
              />

              {/* 四角控制点 */}
              {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => {
                const posStyle: React.CSSProperties = {
                  position: 'absolute',
                  width: handleSize,
                  height: handleSize,
                  backgroundColor: 'white',
                  border: '2px solid #3B82F6',
                  borderRadius: '2px',
                  cursor:
                    pos === 'tl' || pos === 'br' ? 'nwse-resize' : 'nesw-resize',
                };

                if (pos === 'tl') {
                  posStyle.top = -handleSize / 2 - 8;
                  posStyle.left = -handleSize / 2 - 8;
                } else if (pos === 'tr') {
                  posStyle.top = -handleSize / 2 - 8;
                  posStyle.right = -handleSize / 2 - 8;
                } else if (pos === 'bl') {
                  posStyle.bottom = -handleSize / 2 - 8;
                  posStyle.left = -handleSize / 2 - 8;
                } else {
                  posStyle.bottom = -handleSize / 2 - 8;
                  posStyle.right = -handleSize / 2 - 8;
                }

                return (
                  <div
                    key={pos}
                    style={posStyle}
                    onMouseDown={(e) => handleMouseDown(e, clip.id, pos)}
                  />
                );
              })}

              {/* 四边中点控制点 */}
              {(['t', 'b', 'l', 'r'] as const).map((pos) => {
                const posStyle: React.CSSProperties = {
                  position: 'absolute',
                  backgroundColor: 'white',
                  border: '2px solid #3B82F6',
                  borderRadius: '2px',
                };

                if (pos === 't' || pos === 'b') {
                  // 上下边中点 - 横向矩形，用于垂直缩放
                  posStyle.width = handleSize * 1.5;
                  posStyle.height = handleSize;
                  posStyle.left = '50%';
                  posStyle.transform = 'translateX(-50%)';
                  posStyle.cursor = 'ns-resize';
                  if (pos === 't') {
                    posStyle.top = -handleSize / 2 - 8;
                  } else {
                    posStyle.bottom = -handleSize / 2 - 8;
                  }
                } else {
                  // 左右边中点 - 纵向矩形，用于水平缩放
                  posStyle.width = handleSize;
                  posStyle.height = handleSize * 1.5;
                  posStyle.top = '50%';
                  posStyle.transform = 'translateY(-50%)';
                  posStyle.cursor = 'ew-resize';
                  if (pos === 'l') {
                    posStyle.left = -handleSize / 2 - 8;
                  } else {
                    posStyle.right = -handleSize / 2 - 8;
                  }
                }

                return (
                  <div
                    key={pos}
                    style={posStyle}
                    onMouseDown={(e) => handleMouseDown(e, clip.id, pos)}
                  />
                );
              })}

              {/* 旋转控制点 */}
              <div
                style={{
                  position: 'absolute',
                  bottom: -30 - 8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 12,
                  height: 12,
                  backgroundColor: 'white',
                  border: '2px solid #3B82F6',
                  borderRadius: '50%',
                  cursor: 'grab',
                }}
                onMouseDown={(e) => handleMouseDown(e, clip.id, 'rotate')}
              />
              {/* 旋转连接线 */}
              <div
                style={{
                  position: 'absolute',
                  bottom: -18 - 8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 1,
                  height: 18,
                  backgroundColor: '#3B82F6',
                  pointerEvents: 'none',
                }}
              />
            </>
          )}

          {/* 文本内容 */}
          {isEditing ? (
            <textarea
              ref={editInputRef}
              value={clip.contentText || ''}
              onChange={(e) => handleTextChange(clip.id, e.target.value)}
              onBlur={handleEditBlur}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  handleEditBlur();
                }
              }}
              style={{
                ...textCssStyle,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                overflow: 'hidden',
                minWidth: '100px',
                minHeight: '1em',
              }}
              className="focus:ring-2 focus:ring-blue-500 rounded"
            />
          ) : (
            <div
              style={{
                ...textCssStyle,
                whiteSpace: 'pre-wrap',
                padding: '4px 8px',
                minWidth: '50px',
                minHeight: '1em',
              }}
            >
              {clip.contentText || '双击编辑文字'}
            </div>
          )}
        </div>
      );
    },
    [
      getTextStyle,
      getTransform,
      selectedClipId,
      editingClipId,
      showControls,
      handleTextClick,
      handleTextDoubleClick,
      handleMouseDown,
      handleTextChange,
      handleEditBlur,
    ]
  );

  // 如果没有可见的文本 clip，不渲染任何内容
  if (visibleTextClips.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ width: containerWidth, height: containerHeight }}
    >
      {/* ★ 吸附辅助线 - 中心线 */}
      {snapState.centerX && (
        <div
          className="absolute top-0 bottom-0 w-px bg-blue-500 z-50 pointer-events-none"
          style={{ left: '50%' }}
        />
      )}
      {snapState.centerY && (
        <div
          className="absolute left-0 right-0 h-px bg-blue-500 z-50 pointer-events-none"
          style={{ top: '50%' }}
        />
      )}
      {visibleTextClips.map(renderText)}
    </div>
  );
}

export default TextOverlay;
