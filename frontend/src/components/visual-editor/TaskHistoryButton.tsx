'use client';

import React from 'react';
import { History } from 'lucide-react';
import { useTaskHistoryStore } from '@/stores/taskHistoryStore';

interface TaskHistoryButtonProps {
  projectId?: string;
}

export default function TaskHistoryButton({ projectId }: TaskHistoryButtonProps) {
  const { toggle, fetch, processingCount } = useTaskHistoryStore();
  
  const handleClick = async () => {
    toggle();
    if (projectId) {
      await fetch(projectId);
    }
  };
  
  return (
    <button
      onClick={handleClick}
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
  );
}
