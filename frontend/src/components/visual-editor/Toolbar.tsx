'use client';

import React from 'react';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import { ToolType } from '@/types/visual-editor';
import { 
  MousePointer2,
  Pencil,
  Eraser,
  Square,
  Circle,
  Minus,
  Type,
  Image,
  Sparkles,
  Undo,
  Redo,
  ZoomIn,
  ZoomOut,
  Maximize,
} from 'lucide-react';

// ==========================================
// 工具定义
// ==========================================

const TOOLS: Array<{
  id: ToolType;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}> = [
  { id: 'select', icon: <MousePointer2 size={18} />, label: '选择', shortcut: 'V' },
  { id: 'pencil', icon: <Pencil size={18} />, label: '画笔', shortcut: 'B' },
  { id: 'eraser', icon: <Eraser size={18} />, label: '橡皮', shortcut: 'E' },
  { id: 'rect', icon: <Square size={18} />, label: '矩形', shortcut: 'R' },
  { id: 'circle', icon: <Circle size={18} />, label: '圆形', shortcut: 'O' },
  { id: 'line', icon: <Minus size={18} />, label: '线条', shortcut: 'L' },
  { id: 'text', icon: <Type size={18} />, label: '文字', shortcut: 'T' },
  { id: 'image', icon: <Image size={18} />, label: '图片', shortcut: 'I' },
];

const COLORS = [
  '#FFFFFF',
  '#000000',
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
];

// ==========================================
// 主组件
// ==========================================

export default function Toolbar() {
  const {
    tool,
    canvas,
    history,
    historyIndex,
    setActiveTool,
    setBrushColor,
    setZoom,
    resetView,
    undo,
    redo,
  } = useVisualEditorStore();
  
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;
  
  return (
    <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4">
      {/* 左侧：工具按钮 */}
      <div className="flex items-center gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTool(t.id)}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
              tool.activeTool === t.id
                ? 'bg-gray-800 text-white'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            }`}
            title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
          >
            {t.icon}
          </button>
        ))}
        
        {/* 分隔线 */}
        <div className="w-px h-6 bg-gray-200 mx-2" />
        
        {/* AI 生成 */}
        <button
          className="h-9 px-3 flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Sparkles size={16} />
          AI 生成
        </button>
      </div>
      
      {/* 中间：颜色选择 */}
      <div className="flex items-center gap-1">
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => setBrushColor(color)}
            className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
              tool.brushColor === color
                ? 'border-gray-800 scale-110'
                : 'border-gray-200'
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
      
      {/* 右侧：撤销/重做 + 缩放 */}
      <div className="flex items-center gap-1">
        {/* 撤销/重做 */}
        <button
          onClick={undo}
          disabled={!canUndo}
          className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
            canUndo
              ? 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              : 'text-gray-300 cursor-not-allowed'
          }`}
          title="撤销 (Cmd+Z)"
        >
          <Undo size={18} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
            canRedo
              ? 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              : 'text-gray-300 cursor-not-allowed'
          }`}
          title="重做 (Cmd+Shift+Z)"
        >
          <Redo size={18} />
        </button>
        
        {/* 分隔线 */}
        <div className="w-px h-6 bg-gray-200 mx-2" />
        
        {/* 缩放控制 */}
        <button
          onClick={() => setZoom(canvas.zoom - 0.1)}
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          title="缩小"
        >
          <ZoomOut size={18} />
        </button>
        
        <span className="w-12 text-center text-sm text-gray-600 font-medium">
          {Math.round(canvas.zoom * 100)}%
        </span>
        
        <button
          onClick={() => setZoom(canvas.zoom + 0.1)}
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          title="放大"
        >
          <ZoomIn size={18} />
        </button>
        
        <button
          onClick={resetView}
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          title="适应窗口"
        >
          <Maximize size={18} />
        </button>
      </div>
    </div>
  );
}
