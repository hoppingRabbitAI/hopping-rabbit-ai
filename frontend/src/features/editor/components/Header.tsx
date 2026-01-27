'use client';

import { useState } from 'react';
import { Cpu } from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { ExportDialog } from './ExportDialog';
import { TopNav } from '@/components/common/TopNav';

export function Header() {
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const processType = useEditorStore((s) => s.processType);
  const [showExportDialog, setShowExportDialog] = useState(false);

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
    </>
  );
}
