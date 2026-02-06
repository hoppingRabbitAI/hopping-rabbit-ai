'use client';

import { useCallback, useState, useEffect, useMemo } from 'react';
import { useEditorStore } from '../store/editor-store';
import type { Clip } from '../types/clip';

// 吸附阈值（像素）
const SNAP_THRESHOLD = 10;

interface ImageOverlayProps {
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
  startWidth: number;  // 初始宽度
  startHeight: number; // 初始高度
  // 多选拖拽：记录所有选中图片 clip 的初始 transform
  selectedClipsTransforms?: Map<string, {
    x: number;
    y: number;
    scale: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    width: number;
    height: number;
  }>;
}

/**
 * 图片覆盖层组件
 * 在画布上渲染图片 clip，支持拖拽移动、缩放、旋转
 * 支持多选批量拖拽
 */
export function ImageOverlay({
  containerWidth,
  containerHeight,
  zoom = 1,
  showControls = true,
}: ImageOverlayProps) {
  const clips = useEditorStore((s) => s.clips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const selectClip = useEditorStore((s) => s.selectClip);
  const updateClip = useEditorStore((s) => s.updateClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const setActiveSidebarPanel = useEditorStore((s) => s.setActiveSidebarPanel);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [snapState, setSnapState] = useState<{ centerX: boolean; centerY: boolean }>({ centerX: false, centerY: false });
  // 图片自然尺寸缓存：clipId -> { width, height }
  const [imageSizes, setImageSizes] = useState<Record<string, { width: number; height: number }>>({}); 

  // 获取当前播放头位置的所有图片 clip
  const visibleImageClips = useMemo(() => {
    return clips.filter(
      (c) =>
        c.clipType === 'image' &&
        currentTime >= c.start &&
        currentTime < c.start + c.duration
    );
  }, [clips, currentTime]);

  // 获取所有选中的图片 clip（不限于当前可见）
  const allSelectedImageClips = useMemo(() => {
    return clips.filter(c => 
      c.clipType === 'image' && 
      selectedClipIds.has(c.id)
    );
  }, [clips, selectedClipIds]);

  // 获取图片的变换属性
  const getTransform = useCallback((clip: Clip) => {
    const scale = clip.transform?.scale ?? 1;
    return {
      x: clip.transform?.x ?? 0,
      y: clip.transform?.y ?? 0,
      scale,
      scaleX: clip.transform?.scaleX ?? scale,
      scaleY: clip.transform?.scaleY ?? scale,
      rotation: clip.transform?.rotation ?? 0,
      opacity: clip.transform?.opacity ?? 1,
    };
  }, []);

  // 获取图片的尺寸（优先使用缓存的自然尺寸，其次是 metadata，最后是默认值）
  const getImageSize = useCallback((clip: Clip) => {
    // 优先使用已加载的自然尺寸
    if (imageSizes[clip.id]) {
      return imageSizes[clip.id];
    }
    // 其次使用 metadata 中的尺寸
    if (clip.metadata?.width && clip.metadata?.height) {
      return { width: clip.metadata.width, height: clip.metadata.height };
    }
    // 默认值：使用较小的尺寸避免选择框过大
    return { width: 200, height: 200 };
  }, [imageSizes]);

  // 点击图片选中
  const handleImageClick = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      e.stopPropagation();
      selectClip(clipId);
      setActiveSidebarPanel('image-adjust');
    },
    [selectClip, setActiveSidebarPanel]
  );

  // 开始拖拽
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, clipId: string, handle: HandlePosition) => {
      e.preventDefault();
      e.stopPropagation();

      saveToHistory();
      
      // 如果当前 clip 不在选中列表中，清除之前的选中状态，只选中当前 clip
      if (!selectedClipIds.has(clipId)) {
        selectClip(clipId, false);
      }

      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      const transform = getTransform(clip);
      const { width, height } = getImageSize(clip);

      // 记录所有选中的图片 clip 的初始 transform
      const selectedClipsTransforms = new Map<string, {
        x: number;
        y: number;
        scale: number;
        scaleX: number;
        scaleY: number;
        rotation: number;
        width: number;
        height: number;
      }>();
      
      allSelectedImageClips.forEach(c => {
        const t = getTransform(c);
        const size = getImageSize(c);
        selectedClipsTransforms.set(c.id, {
          x: t.x,
          y: t.y,
          scale: t.scale,
          scaleX: t.scaleX,
          scaleY: t.scaleY,
          rotation: t.rotation,
          width: size.width,
          height: size.height,
        });
      });
      
      if (!selectedClipsTransforms.has(clipId)) {
        selectedClipsTransforms.set(clipId, {
          x: transform.x,
          y: transform.y,
          scale: transform.scale,
          scaleX: transform.scaleX,
          scaleY: transform.scaleY,
          rotation: transform.rotation,
          width,
          height,
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
        startWidth: width,
        startHeight: height,
        selectedClipsTransforms,
      });
    },
    [allSelectedImageClips, clips, getTransform, getImageSize, saveToHistory, selectClip, selectedClipIds]
  );

  // 拖拽移动
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = (e.clientX - dragState.startX) / zoom;
      const deltaY = (e.clientY - dragState.startY) / zoom;

      const clip = clips.find((c) => c.id === dragState.clipId);
      const currentTransform = clip?.transform || {};
      
      const hasMultiSelect = dragState.selectedClipsTransforms && dragState.selectedClipsTransforms.size > 1;

      if (dragState.handle === 'move') {
        // 移动整体 - 支持批量移动 + 吸附到中心线和边缘
        let newX = dragState.startTransformX + deltaX;
        let newY = dragState.startTransformY + deltaY;
        
        let snappedCenterX = false;
        let snappedCenterY = false;
        
        // 获取图片实际尺寸（考虑 scale）
        const imgClip = clips.find(c => c.id === dragState.clipId);
        const imgScale = imgClip?.transform?.scale || 1;
        // 使用默认尺寸，因为 Clip 类型没有 width/height 属性
        const imgWidth = 200 * imgScale; // 默认宽度
        const imgHeight = 200 * imgScale; // 默认高度
        const imgHalfW = imgWidth / 2;
        const imgHalfH = imgHeight / 2;
        
        // 画布边界（中心坐标系）
        const canvasHalfW = containerWidth / 2;
        const canvasHalfH = containerHeight / 2;
        
        // 图片边缘位置
        const imgLeft = newX - imgHalfW;
        const imgRight = newX + imgHalfW;
        const imgTop = newY - imgHalfH;
        const imgBottom = newY + imgHalfH;
        
        // ★ X 方向吸附（优先级：中心 > 边缘对齐 > 边缘贴中心）
        if (Math.abs(newX) < SNAP_THRESHOLD) {
          newX = 0;
          snappedCenterX = true;
        }
        // 左边缘对齐画布左边缘
        else if (Math.abs(imgLeft - (-canvasHalfW)) < SNAP_THRESHOLD) {
          newX = -canvasHalfW + imgHalfW;
        }
        // 右边缘对齐画布右边缘
        else if (Math.abs(imgRight - canvasHalfW) < SNAP_THRESHOLD) {
          newX = canvasHalfW - imgHalfW;
        }
        // 左边缘贴画布中心
        else if (Math.abs(imgLeft) < SNAP_THRESHOLD) {
          newX = imgHalfW;
        }
        // 右边缘贴画布中心
        else if (Math.abs(imgRight) < SNAP_THRESHOLD) {
          newX = -imgHalfW;
        }
        
        // ★ Y 方向吸附
        if (Math.abs(newY) < SNAP_THRESHOLD) {
          newY = 0;
          snappedCenterY = true;
        }
        // 上边缘对齐画布上边缘
        else if (Math.abs(imgTop - (-canvasHalfH)) < SNAP_THRESHOLD) {
          newY = -canvasHalfH + imgHalfH;
        }
        // 下边缘对齐画布下边缘
        else if (Math.abs(imgBottom - canvasHalfH) < SNAP_THRESHOLD) {
          newY = canvasHalfH - imgHalfH;
        }
        // 上边缘贴画布中心
        else if (Math.abs(imgTop) < SNAP_THRESHOLD) {
          newY = imgHalfH;
        }
        // 下边缘贴画布中心
        else if (Math.abs(imgBottom) < SNAP_THRESHOLD) {
          newY = -imgHalfH;
        }
        
        setSnapState({ centerX: snappedCenterX, centerY: snappedCenterY });
        
        const snappedDeltaX = newX - dragState.startTransformX;
        const snappedDeltaY = newY - dragState.startTransformY;
        
        if (hasMultiSelect) {
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
          updateClip(dragState.clipId, { 
            transform: {
              ...currentTransform,
              x: newX,
              y: newY,
            }
          });
        }
      } else if (dragState.handle === 'rotate') {
        // 旋转
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
          updateClip(dragState.clipId, { 
            transform: {
              ...currentTransform,
              rotation: dragState.startRotation + angleDiff,
            }
          });
        }
      } else if (['tl', 'tr', 'bl', 'br'].includes(dragState.handle)) {
        // 四角缩放 - 等比例缩放
        const handle = dragState.handle;
        let scaleDelta = 0;
        
        // 根据不同角落计算缩放因子
        if (handle === 'br') {
          scaleDelta = (deltaX + deltaY) / 200;
        } else if (handle === 'tr') {
          scaleDelta = (deltaX - deltaY) / 200;
        } else if (handle === 'bl') {
          scaleDelta = (-deltaX + deltaY) / 200;
        } else if (handle === 'tl') {
          scaleDelta = (-deltaX - deltaY) / 200;
        }
        
        const newScale = Math.max(0.1, Math.min(5, dragState.startScale + scaleDelta));
        
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
          updateClip(dragState.clipId, {
            transform: {
              ...currentTransform,
              scale: newScale,
              scaleX: newScale,
              scaleY: newScale,
            },
          });
        }
      } else if (dragState.handle === 'l' || dragState.handle === 'r') {
        // 水平缩放
        const scaleFactor = 200;
        let scaleXDelta = 0;
        
        if (dragState.handle === 'r') {
          scaleXDelta = deltaX / scaleFactor;
        } else {
          scaleXDelta = -deltaX / scaleFactor;
        }
        
        const newScaleX = Math.max(0.1, Math.min(5, dragState.startScaleX + scaleXDelta));
        
        if (hasMultiSelect) {
          const scaleRatio = newScaleX / dragState.startScaleX;
          dragState.selectedClipsTransforms!.forEach((startTransform, cid) => {
            const c = clips.find(cl => cl.id === cid);
            if (c) {
              const newClipScaleX = Math.max(0.1, Math.min(5, startTransform.scaleX * scaleRatio));
              updateClip(cid, {
                transform: {
                  ...c.transform,
                  scaleX: newClipScaleX,
                },
              });
            }
          });
        } else {
          updateClip(dragState.clipId, {
            transform: {
              ...currentTransform,
              scaleX: newScaleX,
            },
          });
        }
      } else if (dragState.handle === 't' || dragState.handle === 'b') {
        // 垂直缩放
        const scaleFactor = 200;
        let scaleYDelta = 0;
        
        if (dragState.handle === 'b') {
          scaleYDelta = deltaY / scaleFactor;
        } else {
          scaleYDelta = -deltaY / scaleFactor;
        }
        
        const newScaleY = Math.max(0.1, Math.min(5, dragState.startScaleY + scaleYDelta));
        
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
          updateClip(dragState.clipId, {
            transform: {
              ...currentTransform,
              scaleY: newScaleY,
            },
          });
        }
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
      setSnapState({ centerX: false, centerY: false });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, clips, updateClip, zoom, containerWidth, containerHeight]);

  // 渲染单个图片
  const renderImage = useCallback(
    (clip: Clip) => {
      const transform = getTransform(clip);
      const { width, height } = getImageSize(clip);
      const isSelected = selectedClipIds.has(clip.id);
      const isHovered = hoveredClipId === clip.id;
      const handleSize = 12;

      // 应用 CSS 滤镜
      const adjustments = clip.metadata?.imageAdjustments || {};
      const cssFilter = [
        `brightness(${(adjustments.brightness ?? 0) + 100}%)`,
        `contrast(${(adjustments.contrast ?? 0) + 100}%)`,
        `saturate(${(adjustments.saturation ?? 0) + 100}%)`,
        `hue-rotate(${adjustments.hue ?? 0}deg)`,
      ].join(' ');

      return (
        <div
          key={clip.id}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width,
            height,
            transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
            transformOrigin: 'center center',
            opacity: transform.opacity,
            cursor: isSelected ? 'move' : 'pointer',
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => handleMouseDown(e, clip.id, 'move')}
          onMouseEnter={() => setHoveredClipId(clip.id)}
          onMouseLeave={() => setHoveredClipId(null)}
          onClick={(e) => handleImageClick(e, clip.id)}
        >
          {/* 图片内容 */}
          <img
            src={clip.mediaUrl || clip.thumbnail}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              filter: cssFilter,
              pointerEvents: 'none',
            }}
            onLoad={(e) => {
              // 图片加载完成后，获取自然尺寸并更新状态
              const img = e.target as HTMLImageElement;
              const naturalWidth = img.naturalWidth;
              const naturalHeight = img.naturalHeight;
              
              // 计算适合容器的尺寸（最大60%宽度，70%高度，保持比例）
              const maxWidth = containerWidth * 0.6;
              const maxHeight = containerHeight * 0.7;
              const ratio = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
              const displayWidth = naturalWidth * ratio;
              const displayHeight = naturalHeight * ratio;
              
              setImageSizes(prev => ({
                ...prev,
                [clip.id]: { width: displayWidth, height: displayHeight }
              }));
            }}
          />

          {/* 选中边框 */}
          {isSelected && showControls && (
            <>
              {/* 边框 - 紧贴图片 */}
              <div
                className="absolute inset-0 border-2 border-purple-500 pointer-events-none"
              />

              {/* 四角控制点 */}
              {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => {
                const posStyle: React.CSSProperties = {
                  position: 'absolute',
                  width: handleSize,
                  height: handleSize,
                  backgroundColor: 'white',
                  border: '2px solid #A855F7',
                  borderRadius: '2px',
                  cursor: pos === 'tl' || pos === 'br' ? 'nwse-resize' : 'nesw-resize',
                };

                if (pos === 'tl') {
                  posStyle.top = -handleSize / 2;
                  posStyle.left = -handleSize / 2;
                } else if (pos === 'tr') {
                  posStyle.top = -handleSize / 2;
                  posStyle.right = -handleSize / 2;
                } else if (pos === 'bl') {
                  posStyle.bottom = -handleSize / 2;
                  posStyle.left = -handleSize / 2;
                } else {
                  posStyle.bottom = -handleSize / 2;
                  posStyle.right = -handleSize / 2;
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
                  border: '2px solid #A855F7',
                  borderRadius: '2px',
                };

                if (pos === 't' || pos === 'b') {
                  posStyle.width = handleSize * 1.5;
                  posStyle.height = handleSize;
                  posStyle.left = '50%';
                  posStyle.transform = 'translateX(-50%)';
                  posStyle.cursor = 'ns-resize';
                  if (pos === 't') {
                    posStyle.top = -handleSize / 2;
                  } else {
                    posStyle.bottom = -handleSize / 2;
                  }
                } else {
                  posStyle.width = handleSize;
                  posStyle.height = handleSize * 1.5;
                  posStyle.top = '50%';
                  posStyle.transform = 'translateY(-50%)';
                  posStyle.cursor = 'ew-resize';
                  if (pos === 'l') {
                    posStyle.left = -handleSize / 2;
                  } else {
                    posStyle.right = -handleSize / 2;
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
                  bottom: -30,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 12,
                  height: 12,
                  backgroundColor: 'white',
                  border: '2px solid #A855F7',
                  borderRadius: '50%',
                  cursor: 'grab',
                }}
                onMouseDown={(e) => handleMouseDown(e, clip.id, 'rotate')}
              />
              {/* 旋转连接线 */}
              <div
                style={{
                  position: 'absolute',
                  bottom: -18,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 1,
                  height: 18,
                  backgroundColor: '#A855F7',
                  pointerEvents: 'none',
                }}
              />
            </>
          )}

          {/* hover 提示边框 */}
          {!isSelected && isHovered && (
            <div
              className="absolute inset-0 border-2 border-purple-300 pointer-events-none"
            />
          )}
        </div>
      );
    },
    [getTransform, getImageSize, selectedClipIds, hoveredClipId, showControls, handleMouseDown, handleImageClick, containerWidth, containerHeight]
  );

  if (visibleImageClips.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ width: containerWidth, height: containerHeight, zIndex: 30 }}
    >
      {/* 吸附辅助线 - 中心线 */}
      {snapState.centerX && (
        <div
          className="absolute top-0 bottom-0 w-px bg-purple-500 z-50 pointer-events-none"
          style={{ left: '50%' }}
        />
      )}
      {snapState.centerY && (
        <div
          className="absolute left-0 right-0 h-px bg-purple-500 z-50 pointer-events-none"
          style={{ top: '50%' }}
        />
      )}
      {visibleImageClips.map(renderImage)}
    </div>
  );
}

export default ImageOverlay;
