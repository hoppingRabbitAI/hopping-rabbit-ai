'use client';

import { useState, useEffect } from 'react';
import { Cpu, History } from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { ExportDialog } from './ExportDialog';
import { TopNav } from '@/components/common/TopNav';
import { useTaskHistoryStore } from '@/stores/taskHistoryStore';
import TaskHistorySidebar from '@/components/visual-editor/TaskHistorySidebar';

export function Header() {
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const processType = useEditorStore((s) => s.processType);
  const projectId = useEditorStore((s) => s.projectId);
  const [showExportDialog, setShowExportDialog] = useState(false);
  
  const { toggle, fetch, processingCount } = useTaskHistoryStore();
  
  // 初始加载任务
  useEffect(() => {
    if (projectId) {
      fetch(projectId);
    }
  }, [projectId, fetch]);
  
  const handleTaskHistoryClick = async () => {
    toggle();
    if (projectId) {
      await fetch(projectId);
    }
  };

  // 编辑器特有的右侧操作
  const rightActions = (
    <>
      {/* 处理状态指示器 */}
      {isProcessing && (
        <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-full text-xs text-gray-600 font-medium">
          <Cpu size={14} className="animate-spin" />
          <span>
            {processType === 'stt' ? 'AI 语音转写中...' : '正在优化冗余片段...'}
          </span>
        </div>
      )}
      
      {/* 任务历史按钮 */}
      <button
        onClick={handleTaskHistoryClick}
        className="relative h-8 px-3 flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        title="任务历史"
      >
        <History size={14} />
        <span className="hidden sm:inline">任务</span>
        
        {/* 进行中任务数量徽章 */}
        {processingCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-blue-500 rounded-full px-1 animate-pulse">
            {processingCount > 9 ? '9+' : processingCount}
          </span>
        )}
      </button>

      {/* 导出按钮 */}
      <button
        onClick={() => setShowExportDialog(true)}
        disabled={isProcessing}
        className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        导出
      </button>
    </>
  );

  return (
    <>
      <TopNav
        title="编辑器"
        showBack={true}
        rightActions={rightActions}
      />

      {/* 导出对话框 */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />
      
      {/* 任务历史侧边栏 */}
      <TaskHistorySidebar projectId={projectId ?? undefined} />
    </>
  );
}
