/**
 * 绘画画布组件
 * 支持在关键帧图片上绘画标注
 * 自动适应图片比例
 */

'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Brush, Eraser, RotateCcw, Download, Loader2, AlertCircle, ImageIcon } from 'lucide-react';

interface DrawingCanvasProps {
  imageUrl: string;
  onMaskChange?: (maskDataUrl: string | null) => void;
  /** [新增] 导出 mask 的 ref 回调 */
  onExportMask?: (exportFn: () => string | null) => void;
  /** [新增] 导出合成帧 (背景图 + 涂抹区域) 的回调 */
  onExportCompositeFrame?: (exportFn: () => string | null) => void;
}

type Tool = 'brush' | 'eraser';
type LoadState = 'loading' | 'loaded' | 'error';

export function DrawingCanvas({ 
  imageUrl, 
  onMaskChange,
  onExportMask,
  onExportCompositeFrame,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>('brush');
  const brushSize = 10; // 固定画笔大小
  const [hasDrawing, setHasDrawing] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null); // 跟踪上一个点，用于连续线条
  const [canvasSize, setCanvasSize] = useState({ width: 400, height: 400 });
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 }); // 图片原始尺寸
  // ★ 新增：加载状态
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  // 初始化画布 - 根据图片实际比例和容器可用空间自适应
  useEffect(() => {
    // ★ 检查 URL 是否有效
    if (!imageUrl || imageUrl.trim() === '') {
      setLoadState('error');
      setErrorMessage('关键帧图片 URL 为空');
      return;
    }
    
    console.log('[DrawingCanvas] 开始加载图片:', imageUrl);
    setLoadState('loading');
    setErrorMessage('');
    
    // ★ 使用 fetch 加载图片，避免 CORS 问题
    fetch(imageUrl, { mode: 'cors' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        
        img.onload = () => {
          console.log('[DrawingCanvas] ✅ 图片加载成功:', img.width, 'x', img.height);
          
          // 保存原始尺寸
          setImageNaturalSize({ width: img.width, height: img.height });
          
          // ★ 在 onload 内部获取 canvas 和 context
          const canvas = canvasRef.current;
          const maskCanvas = maskCanvasRef.current;
          const container = containerRef.current;
          if (!canvas || !maskCanvas || !container) {
            console.error('[DrawingCanvas] Canvas ref 不存在');
            URL.revokeObjectURL(objectUrl);
            return;
          }
          
          const ctx = canvas.getContext('2d');
          const maskCtx = maskCanvas.getContext('2d');
          if (!ctx || !maskCtx) {
            console.error('[DrawingCanvas] 无法获取 canvas context');
            URL.revokeObjectURL(objectUrl);
            return;
          }
          
          // 获取容器可用空间，自适应计算
          const containerRect = container.getBoundingClientRect();
          const availableWidth = containerRect.width || 600;
          const availableHeight = window.innerHeight * 0.55; // 最大占屏幕 55%
          
          // 计算缩放比例保持宽高比
          const scale = Math.min(availableWidth / img.width, availableHeight / img.height, 1);
          const scaledWidth = Math.round(img.width * scale);
          const scaledHeight = Math.round(img.height * scale);
          
          console.log('[DrawingCanvas] 容器:', availableWidth, 'x', availableHeight, ' 缩放后:', scaledWidth, 'x', scaledHeight);
          
          // 设置画布尺寸
          canvas.width = scaledWidth;
          canvas.height = scaledHeight;
          maskCanvas.width = scaledWidth;
          maskCanvas.height = scaledHeight;
          
          // ★ 绘制图片
          ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
          console.log('[DrawingCanvas] ✅ 图片已绘制到 canvas');
          
          // 初始化遮罩画布为透明
          maskCtx.clearRect(0, 0, scaledWidth, scaledHeight);
          
          // 更新状态
          setCanvasSize({ width: scaledWidth, height: scaledHeight });
          setLoadState('loaded');
          URL.revokeObjectURL(objectUrl);
        };
        
        img.onerror = () => {
          console.error('[DrawingCanvas] 图片解码失败');
          setLoadState('error');
          setErrorMessage('图片解码失败');
          URL.revokeObjectURL(objectUrl);
        };
        
        img.src = objectUrl;
      })
      .catch(error => {
        console.error('[DrawingCanvas] 图片加载失败:', error);
        setLoadState('error');
        setErrorMessage(`加载失败: ${error.message}`);
      });
  }, [imageUrl]);
  
  // 获取画布坐标
  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);
  
  // 绘制 - 用线条连接点，避免不连续
  const draw = useCallback((x: number, y: number, isStart: boolean = false) => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;
    
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (tool === 'brush') {
      // ★★★ 治本方案：直接使用白色画笔 ★★★
      // AI API 标准：白色 = 编辑区域，不需要后端再转换
      const brushColor = 'rgba(255, 255, 255, 1)';
      ctx.strokeStyle = brushColor;
      ctx.fillStyle = brushColor;
      ctx.globalCompositeOperation = 'source-over';
    } else {
      // 橡皮擦模式 - 透明（擦除）
      ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.globalCompositeOperation = 'destination-out';
    }
    
    const lastPoint = lastPointRef.current;
    
    if (isStart || !lastPoint) {
      // 起始点，画一个圆点
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();  // 现在正确使用 fillStyle
    } else {
      // 用线条连接上一个点和当前点
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    
    // 更新上一个点
    lastPointRef.current = { x, y };
    
    ctx.globalCompositeOperation = 'source-over';
    setHasDrawing(true);
  }, [tool, brushSize]);
  
  // 鼠标事件
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    lastPointRef.current = null; // 重置上一个点
    const coords = getCanvasCoords(e);
    draw(coords.x, coords.y, true); // isStart = true
  }, [getCanvasCoords, draw]);
  
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const coords = getCanvasCoords(e);
    draw(coords.x, coords.y);
  }, [isDrawing, getCanvasCoords, draw]);
  
  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
    lastPointRef.current = null; // 重置上一个点
    
    // 通知父组件遮罩变化
    if (onMaskChange && maskCanvasRef.current) {
      const maskDataUrl = maskCanvasRef.current.toDataURL('image/png');
      onMaskChange(maskDataUrl);
    }
  }, [onMaskChange]);
  
  // 清除遮罩
  const clearMask = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    setHasDrawing(false);
    onMaskChange?.(null);
  }, [onMaskChange]);
  
  // 导出遮罩
  const exportMask = useCallback(() => {
    if (!maskCanvasRef.current) return null;
    return maskCanvasRef.current.toDataURL('image/png');
  }, []);
  
  // [新增] 导出合成帧 (原始图片 + 涂抹区域叠加)
  const exportCompositeFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !maskCanvas) return null;
    
    // 创建临时 canvas 合成
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return null;
    
    // 先绘制原始图片
    ctx.drawImage(canvas, 0, 0);
    
    // 再叠加涂抹层
    ctx.drawImage(maskCanvas, 0, 0);
    
    return tempCanvas.toDataURL('image/png');
  }, []);
  
  // [新增] 注册导出函数到父组件
  useEffect(() => {
    onExportMask?.(exportMask);
  }, [onExportMask, exportMask]);
  
  useEffect(() => {
    onExportCompositeFrame?.(exportCompositeFrame);
  }, [onExportCompositeFrame, exportCompositeFrame]);

  return (
    <div className="flex gap-3">
      {/* 左侧工具栏 - 竖排 */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setTool('brush')}
            className={`p-2 rounded-md transition-colors ${
              tool === 'brush' 
                ? 'bg-white shadow text-gray-800' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title="画笔"
          >
            <Brush className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTool('eraser')}
            className={`p-2 rounded-md transition-colors ${
              tool === 'eraser' 
                ? 'bg-white shadow text-gray-800' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title="橡皮擦"
          >
            <Eraser className="w-4 h-4" />
          </button>
        </div>
        
        {/* 清除按钮 */}
        <button
          onClick={clearMask}
          disabled={!hasDrawing}
          className="flex flex-col items-center gap-0.5 p-2 text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg hover:bg-gray-100"
          title="清除涂抹"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
      
      {/* 画布容器 - 根据图片比例自适应，不裁剪 */}
      <div 
        ref={containerRef}
        className="relative rounded-xl border border-gray-200 bg-gray-900"
        style={{ 
          width: canvasSize.width, 
          height: canvasSize.height,
          minHeight: 200,
        }}
      >
        {/* ★ 加载状态 - 覆盖在 canvas 上方 */}
        {loadState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-10">
            <Loader2 className="w-8 h-8 text-gray-500 animate-spin mb-2" />
            <span className="text-sm text-gray-400">加载关键帧...</span>
          </div>
        )}
        
        {/* ★ 错误状态 */}
        {loadState === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 p-4 z-10">
            <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
            <span className="text-sm text-red-400 text-center">关键帧加载失败</span>
            <span className="text-xs text-gray-500 mt-1 text-center max-w-[280px] break-all">
              {errorMessage || '请检查图片 URL 是否有效'}
            </span>
          </div>
        )}
        
        {/* ★ Canvas 始终存在，不根据 loadState 条件渲染 */}
        <canvas
          ref={canvasRef}
          style={{ width: canvasSize.width, height: canvasSize.height }}
          className="absolute inset-0 rounded-xl"
        />
        
        {/* 遮罩绘制层 */}
        <canvas
          ref={maskCanvasRef}
          style={{ width: canvasSize.width, height: canvasSize.height }}
          className="absolute inset-0 cursor-crosshair rounded-xl"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        
      </div>
    </div>
  );
}
