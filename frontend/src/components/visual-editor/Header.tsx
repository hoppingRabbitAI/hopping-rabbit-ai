'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import { 
  ArrowLeft, 
  Play, 
  Save, 
  ArrowRight,
  Loader2,
  Sparkles,
} from 'lucide-react';
import TaskHistoryButton from './TaskHistoryButton';
import TaskHistorySidebar from './TaskHistorySidebar';
import PreviewSidebar from './PreviewSidebar';

export default function Header() {
  const router = useRouter();
  const { 
    projectId, 
    projectName, 
    isSaving,
  } = useVisualEditorStore();
  
  // ★ 预览侧边栏状态
  const [showPreview, setShowPreview] = useState(false);
  
  const handleBack = () => {
    router.back();
  };
  
  const handlePreview = () => {
    setShowPreview(true);
  };
  
  const handleSave = async () => {
    console.log('Save');
  };
  

  const handleExportToEditor = async () => {
    if (projectId) {
      // ★ 工作流配置保存（将来可直接存到 project 表的 metadata 字段）
      router.push('/p');
    }
  };
  
  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
      {/* 左侧：返回 + Logo + 项目名 */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBack}
          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gray-800 rounded-lg flex items-center justify-center">
            <Sparkles size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900">{projectName}</h1>
            <p className="text-[10px] text-gray-400">视觉编辑器</p>
          </div>
        </div>
        
      </div>
      
      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2">
        {/* 任务历史 */}
        <TaskHistoryButton projectId={projectId ?? undefined} />
        
        {/* 预览 */}
        <button
          onClick={handlePreview}
          className="h-8 px-3 flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Play size={14} />
          预览
        </button>
        
        {/* 保存 */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="h-8 px-3 flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          保存
        </button>
        
        {/* 分隔线 */}
        <div className="w-px h-6 bg-gray-200 mx-1" />
        
        {/* 导出到编辑器 */}
        <button
          onClick={handleExportToEditor}
          className="h-8 px-4 flex items-center gap-1.5 text-sm font-bold text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors shadow-lg shadow-gray-800/20"
        >
          导出到编辑器
          <ArrowRight size={14} />
        </button>
      </div>
      
      {/* 任务历史侧边栏 */}
      <TaskHistorySidebar 
        projectId={projectId ?? undefined} 
      />

      {/* ★ 预览侧边栏 */}
      <PreviewSidebar 
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
      />
    </header>
  );
}
