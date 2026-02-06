'use client';

import React from 'react';
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

export default function Header() {
  const router = useRouter();
  const { 
    projectId, 
    projectName, 
    isSaving,
    shots,
  } = useVisualEditorStore();
  
  const handleBack = () => {
    router.back();
  };
  
  const handlePreview = () => {
    console.log('Preview');
  };
  
  const handleSave = async () => {
    console.log('Save');
  };
  
  const handleExportToEditor = async () => {
    if (projectId) {
      try {
        const { sessionId } = useVisualEditorStore.getState();
        if (sessionId) {
          const { authFetch } = await import('@/lib/supabase/session');
          await authFetch(`/api/workspace/sessions/${sessionId}/workflow-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shots: shots.map(shot => ({
                id: shot.id,
                index: shot.index,
                startTime: shot.startTime,
                endTime: shot.endTime,
                background: shot.background,
              })),
            }),
          });
        }
      } catch (err) {
        console.error('Failed to save config:', err);
      }
      router.push(`/editor?project=${projectId}`);
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
        
        {/* 分镜数量 */}
        {shots.length > 0 && (
          <div className="ml-4 px-2.5 py-1 bg-gray-100 rounded-lg text-xs text-gray-600 font-medium">
            {shots.length} 个分镜
          </div>
        )}
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
      <TaskHistorySidebar projectId={projectId ?? undefined} />
    </header>
  );
}
