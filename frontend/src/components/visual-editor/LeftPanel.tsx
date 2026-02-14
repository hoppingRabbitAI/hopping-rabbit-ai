'use client';

import React from 'react';
import { useVisualEditorStore, useCurrentShot } from '@/stores/visualEditorStore';
import { Layer, HistoryEntry } from '@/types/visual-editor';
import { 
  Layers, 
  History, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock,
  ChevronRight,
  Undo,
  Redo,
} from 'lucide-react';

// ==========================================
// 图层列表
// ==========================================

function LayerList() {
  const currentShot = useCurrentShot();
  const { updateLayer } = useVisualEditorStore();
  
  if (!currentShot) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        无分镜数据
      </div>
    );
  }
  
  const toggleVisibility = (layerId: string, visible: boolean) => {
    updateLayer(currentShot.id, layerId, { visible: !visible });
  };
  
  const toggleLock = (layerId: string, locked: boolean) => {
    updateLayer(currentShot.id, layerId, { locked: !locked });
  };
  
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-2 space-y-1">
        {currentShot.layers.map((layer: Layer) => (
          <div
            key={layer.id}
            className="group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors hover:bg-gray-100 cursor-pointer"
          >
            {/* 展开图标（预留） */}
            <ChevronRight size={12} className="text-gray-400" />
            
            {/* 图层名称 */}
            <span className={`flex-1 text-sm truncate ${
              layer.visible ? 'text-gray-700' : 'text-gray-400'
            }`}>
              {layer.name}
            </span>
            
            {/* 锁定 */}
            <button
              onClick={() => toggleLock(layer.id, layer.locked)}
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                layer.locked 
                  ? 'text-gray-500' 
                  : 'text-gray-400 opacity-0 group-hover:opacity-100 hover:text-gray-600'
              }`}
            >
              {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            
            {/* 可见性 */}
            <button
              onClick={() => toggleVisibility(layer.id, layer.visible)}
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                !layer.visible 
                  ? 'text-gray-400' 
                  : 'text-gray-500 opacity-0 group-hover:opacity-100 hover:text-gray-700'
              }`}
            >
              {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==========================================
// 历史记录
// ==========================================

function HistoryList() {
  const { history, historyIndex, undo, redo, jumpToHistory, canUndo, canRedo } = useVisualEditorStore();
  
  if (history.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        暂无历史记录
      </div>
    );
  }
  
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 撤销/重做按钮栏 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-100">
        <button
          onClick={undo}
          disabled={!canUndo()}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
            canUndo()
              ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              : 'text-gray-300 cursor-not-allowed'
          }`}
          title="撤销 (⌘Z)"
        >
          <Undo size={12} />
          撤销
        </button>
        <button
          onClick={redo}
          disabled={!canRedo()}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
            canRedo()
              ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              : 'text-gray-300 cursor-not-allowed'
          }`}
          title="重做 (⌘⇧Z)"
        >
          <Redo size={12} />
          重做
        </button>
        <span className="ml-auto text-[10px] text-gray-400">
          {historyIndex + 1}/{history.length}
        </span>
      </div>
      
      {/* 历史列表 */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-0.5">
          {history.map((entry: HistoryEntry, index: number) => (
            <button
              key={entry.id}
              onClick={() => jumpToHistory(index)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                index === historyIndex 
                  ? 'bg-gray-100 text-gray-800 font-medium ring-1 ring-gray-200' 
                  : index > historyIndex
                    ? 'text-gray-400 hover:bg-gray-50'
                    : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                index === historyIndex ? 'bg-gray-800' : index > historyIndex ? 'bg-gray-300' : 'bg-gray-400'
              }`} />
              <span className="flex-1 text-xs truncate">{entry.description}</span>
              <span className="text-[10px] text-gray-400 flex-shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 主组件
// ==========================================

export default function LeftPanel() {
  const { leftPanelTab, setLeftPanelTab } = useVisualEditorStore();
  
  return (
    <div className="w-52 bg-white border-r border-gray-200 flex flex-col">
      {/* Tab 切换 */}
      <div className="h-10 border-b border-gray-200 flex">
        <button
          onClick={() => setLeftPanelTab('layers')}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
            leftPanelTab === 'layers'
              ? 'text-gray-900 bg-gray-50'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Layers size={14} />
          图层
        </button>
        <button
          onClick={() => setLeftPanelTab('history')}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
            leftPanelTab === 'history'
              ? 'text-gray-900 bg-gray-50'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <History size={14} />
          历史
        </button>
      </div>
      
      {/* 内容 */}
      {leftPanelTab === 'layers' ? <LayerList /> : <HistoryList />}
    </div>
  );
}
