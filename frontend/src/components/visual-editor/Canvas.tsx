'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { 
  Canvas as FabricCanvas, 
  Rect, 
  Circle, 
  IText, 
  PencilBrush, 
  FabricObject,
  Group,
  Line,
  FabricText,
  TPointerEvent,
  TPointerEventInfo,
  Point,
  TMat2D,
} from 'fabric';
import { useVisualEditorStore, useCurrentShot } from '@/stores/visualEditorStore';
import { DEFAULT_ARTBOARD } from '@/types/visual-editor';

// ==========================================
// 常量
// ==========================================

// 画布背景网格
const GRID_SIZE = 20;
const GRID_COLOR = '#e5e7eb';

// 缩放限制
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

// 画板样式
const ARTBOARD_LABEL_HEIGHT = 24;
const ARTBOARD_BORDER_COLOR = '#3b82f6';  // 蓝色选中边框
const ARTBOARD_BORDER_UNSELECTED = '#d1d5db';  // 灰色未选中边框

// ==========================================
// Canvas 组件
// ==========================================

export default function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const artboardRef = useRef<Rect | null>(null);
  
  const [isReady, setIsReady] = useState(false);
  const isPanningRef = useRef(false);  // 使用 ref 避免闭包陷阱
  const lastPanPosition = useRef({ x: 0, y: 0 });
  
  const { 
    canvas: canvasState, 
    tool,
    setZoom,
    setPan,
    selectObjects,
    clearSelection,
    pushHistory,
    updateShotArtboard,
    updateShotViewport,
  } = useVisualEditorStore();
  
  const currentShot = useCurrentShot();
  
  // ==========================================
  // 初始化 Fabric.js
  // ==========================================
  
  useEffect(() => {
    if (!canvasRef.current || fabricRef.current) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    // 创建 Fabric Canvas
    const fabricCanvas = new FabricCanvas(canvasRef.current, {
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundColor: '#f9fafb',  // 浅灰色无限画布背景
      selection: true,
      preserveObjectStacking: true,
      stopContextMenu: true,
    });
    
    fabricRef.current = fabricCanvas;
    
    // 绘制网格背景
    drawGrid(fabricCanvas, container.clientWidth, container.clientHeight);
    
    // 创建初始画板
    createArtboard(fabricCanvas, currentShot?.artboard || DEFAULT_ARTBOARD);
    
    // 居中视图
    centerView(fabricCanvas, container, currentShot?.artboard || DEFAULT_ARTBOARD);
    
    // 事件监听
    setupEventListeners(fabricCanvas);
    
    setIsReady(true);
    
    // 清理
    return () => {
      fabricCanvas.dispose();
      fabricRef.current = null;
      artboardRef.current = null;
    };
  }, []);
  
  // ==========================================
  // 分镜切换时更新画板
  // ==========================================
  
  useEffect(() => {
    const fabricCanvas = fabricRef.current;
    if (!fabricCanvas || !isReady) return;
    
    const artboard = currentShot?.artboard || DEFAULT_ARTBOARD;
    
    // 更新画板位置和尺寸
    if (artboardRef.current) {
      artboardRef.current.set({
        left: artboard.x,
        top: artboard.y,
        width: artboard.width,
        height: artboard.height,
      });
      artboardRef.current.setCoords();
    }
    
    // 恢复视口变换
    if (currentShot?.viewportTransform && currentShot.viewportTransform.length === 6) {
      fabricCanvas.setViewportTransform(currentShot.viewportTransform as TMat2D);
    } else {
      const container = containerRef.current;
      if (container) {
        centerView(fabricCanvas, container, artboard);
      }
    }
    
    fabricCanvas.renderAll();
  }, [currentShot?.id, isReady]);
  
  // ==========================================
  // 绘制网格
  // ==========================================
  
  const drawGrid = (canvas: FabricCanvas, width: number, height: number) => {
    // 网格作为背景 pattern，不需要单独的对象
    // Fabric.js 会在 backgroundColor 上渲染
  };
  
  // ==========================================
  // 创建画板
  // ==========================================
  
  const createArtboard = (canvas: FabricCanvas, artboard: typeof DEFAULT_ARTBOARD) => {
    // 移除旧的画板
    if (artboardRef.current) {
      canvas.remove(artboardRef.current);
    }
    
    // 创建画板矩形
    const artboardRect = new Rect({
      left: artboard.x,
      top: artboard.y,
      width: artboard.width,
      height: artboard.height,
      fill: '#ffffff',  // 白色画板背景
      stroke: ARTBOARD_BORDER_COLOR,
      strokeWidth: 2,
      strokeUniform: true,
      rx: 0,
      ry: 0,
      shadow: {
        color: 'rgba(0,0,0,0.1)',
        blur: 20,
        offsetX: 0,
        offsetY: 4,
      } as any,
      // 画板可以选择和移动
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      lockRotation: true,  // 禁止旋转
      cornerColor: ARTBOARD_BORDER_COLOR,
      cornerStyle: 'circle',
      cornerSize: 10,
      transparentCorners: false,
      name: 'artboard',
    });
    
    canvas.add(artboardRect);
    canvas.sendObjectToBack(artboardRect);
    artboardRef.current = artboardRect;
  };
  
  // ==========================================
  // 居中视图
  // ==========================================
  
  const centerView = (
    canvas: FabricCanvas, 
    container: HTMLDivElement, 
    artboard: typeof DEFAULT_ARTBOARD
  ) => {
    // 计算缩放以适应容器
    const padding = 100;
    const scaleX = (container.clientWidth - padding * 2) / artboard.width;
    const scaleY = (container.clientHeight - padding * 2) / artboard.height;
    const scale = Math.min(scaleX, scaleY, 1);  // 最大不超过 100%
    
    // 计算居中位置
    const centerX = container.clientWidth / 2;
    const centerY = container.clientHeight / 2;
    const artboardCenterX = artboard.x + artboard.width / 2;
    const artboardCenterY = artboard.y + artboard.height / 2;
    
    const panX = centerX - artboardCenterX * scale;
    const panY = centerY - artboardCenterY * scale;
    
    canvas.setViewportTransform([scale, 0, 0, scale, panX, panY]);
    setZoom(scale);
    setPan(panX, panY);
  };
  
  // ==========================================
  // 设置事件监听
  // ==========================================
  
  const setupEventListeners = (canvas: FabricCanvas) => {
    // 选择事件
    canvas.on('selection:created', (e) => {
      const selected = e.selected || [];
      const ids = selected
        .filter(obj => (obj as any).name !== 'artboard')
        .map(obj => (obj as any).id || '')
        .filter(Boolean);
      if (ids.length > 0) {
        selectObjects(ids);
      }
    });
    
    canvas.on('selection:updated', (e) => {
      const selected = e.selected || [];
      const ids = selected
        .filter(obj => (obj as any).name !== 'artboard')
        .map(obj => (obj as any).id || '')
        .filter(Boolean);
      selectObjects(ids);
    });
    
    canvas.on('selection:cleared', () => {
      clearSelection();
    });
    
    // 对象修改事件
    canvas.on('object:modified', (e) => {
      const target = e.target;
      if (!target) return;
      
      // 如果是画板被移动/缩放
      if ((target as any).name === 'artboard' && currentShot) {
        updateShotArtboard(currentShot.id, {
          x: target.left || 0,
          y: target.top || 0,
          width: (target.width || 1920) * (target.scaleX || 1),
          height: (target.height || 1080) * (target.scaleY || 1),
        });
        
        // 重置缩放比例，保持实际尺寸
        target.set({
          width: (target.width || 1920) * (target.scaleX || 1),
          height: (target.height || 1080) * (target.scaleY || 1),
          scaleX: 1,
          scaleY: 1,
        });
        target.setCoords();
      }
    });
    
    // 鼠标滚轮缩放
    canvas.on('mouse:wheel', (opt) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      
      const delta = e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      
      // 以鼠标位置为中心缩放
      const point = new Point(e.offsetX, e.offsetY);
      canvas.zoomToPoint(point, zoom);
      
      setZoom(zoom);
      
      // 保存视口状态
      if (currentShot) {
        const vt = canvas.viewportTransform;
        if (vt) {
          updateShotViewport(currentShot.id, [...vt]);
        }
      }
    });
    
    // 鼠标按下 - 判断是否在空白区域以决定是否平移
    canvas.on('mouse:down', (opt) => {
      const e = opt.e as MouseEvent;
      
      // 阻止浏览器默认拖拽行为
      e.preventDefault();
      
      // 中键拖拽 或 Alt+左键拖拽 => 强制平移
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanningRef.current = true;
        canvas.selection = false;
        lastPanPosition.current = { x: e.clientX, y: e.clientY };
        canvas.setCursor('grabbing');
        return;
      }
      
      // 左键点击空白区域（没有点击到任何对象）=> 直接平移
      if (e.button === 0 && !opt.target) {
        isPanningRef.current = true;
        canvas.selection = false;
        lastPanPosition.current = { x: e.clientX, y: e.clientY };
        canvas.setCursor('grabbing');
      }
    });
    
    canvas.on('mouse:move', (opt) => {
      if (!isPanningRef.current) return;
      
      const e = opt.e as MouseEvent;
      e.preventDefault();
      
      const vpt = canvas.viewportTransform;
      if (!vpt) return;
      
      const dx = e.clientX - lastPanPosition.current.x;
      const dy = e.clientY - lastPanPosition.current.y;
      
      vpt[4] += dx;
      vpt[5] += dy;
      
      canvas.setViewportTransform(vpt);
      lastPanPosition.current = { x: e.clientX, y: e.clientY };
      
      setPan(vpt[4], vpt[5]);
    });
    
    canvas.on('mouse:up', () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        canvas.selection = true;
        canvas.setCursor('default');
        
        // 保存视口状态
        if (currentShot) {
          const vt = canvas.viewportTransform;
          if (vt) {
            updateShotViewport(currentShot.id, [...vt]);
          }
        }
      }
    });
  };
  
  // ==========================================
  // 响应窗口大小变化
  // ==========================================
  
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const fabricCanvas = fabricRef.current;
      if (!container || !fabricCanvas) return;
      
      fabricCanvas.setDimensions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
      
      fabricCanvas.renderAll();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // ==========================================
  // 工具变化时更新画布模式
  // ==========================================
  
  useEffect(() => {
    const fabricCanvas = fabricRef.current;
    if (!fabricCanvas) return;
    
    // 清除画笔模式
    fabricCanvas.isDrawingMode = false;
    
    switch (tool.activeTool) {
      case 'pencil':
        fabricCanvas.isDrawingMode = true;
        const pencilBrush = new PencilBrush(fabricCanvas);
        pencilBrush.color = tool.brushColor;
        pencilBrush.width = tool.brushSize;
        fabricCanvas.freeDrawingBrush = pencilBrush;
        break;
        
      case 'select':
      default:
        fabricCanvas.selection = true;
        break;
    }
  }, [tool.activeTool, tool.brushColor, tool.brushSize]);
  
  // ==========================================
  // 渲染
  // ==========================================
  
  return (
    <div 
      ref={containerRef} 
      className="flex-1 relative overflow-hidden bg-gray-50"
    >
      <canvas ref={canvasRef} />
      
      {/* 左下角尺寸信息 */}
      <div className="absolute left-4 bottom-4 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 font-medium shadow-sm">
        {currentShot?.artboard.width || 1920} × {currentShot?.artboard.height || 1080}
      </div>
      
      {/* 右下角缩放信息 */}
      <div className="absolute right-4 bottom-4 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 font-medium shadow-sm">
        {Math.round(canvasState.zoom * 100)}%
      </div>
      
      {/* 提示文字 */}
      {tool.activeTool === 'select' && (
        <div className="absolute top-4 right-4 px-3 py-1.5 bg-gray-800/80 text-white text-xs rounded-lg">
          空白区域拖拽平移 · 滚轮缩放 · 点击画板内编辑
        </div>
      )}
    </div>
  );
}
