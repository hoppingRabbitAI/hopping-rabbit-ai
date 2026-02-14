/**
 * 任务进度面板组件
 * 显示正在进行的 AI 任务及其进度
 */

'use client';

import React from 'react';
import { 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  ChevronDown,
  ChevronUp,
  Sparkles,
  Image as ImageIcon,
  Film,
  Subtitles,
  Palette,
  AudioLines
} from 'lucide-react';
import type { Task } from './useTaskProgress';

interface TaskProgressPanelProps {
  tasks: Task[];
  isConnected: boolean;
  onClear?: () => void;
}

// 能力 ID 到图标的映射
const capabilityIcons: Record<string, React.ElementType> = {
  'background-replace': ImageIcon,
  'add-broll': Film,
  'add-subtitle': Subtitles,
  'style-transfer': Palette,
  'voice-enhance': AudioLines,
};

// 能力 ID 到名称的映射
const capabilityNames: Record<string, string> = {
  'background-replace': '换背景',
  'add-broll': 'B-Roll',
  'add-subtitle': '字幕',
  'style-transfer': '风格迁移',
  'voice-enhance': '声音优化',
};

function getStatusIcon(status: Task['status']) {
  switch (status) {
    case 'processing':
      return <Loader2 className="w-4 h-4 animate-spin text-gray-500" />;
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-gray-500" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />;
    default:
      return <Sparkles className="w-4 h-4 text-gray-400" />;
  }
}

function TaskItem({ task }: { task: Task }) {
  const Icon = capabilityIcons[task.id.split('-')[0]] || Sparkles;
  
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
      <div className="flex items-center gap-3">
        {/* 状态图标 */}
        <div className="flex-shrink-0">
          {getStatusIcon(task.status)}
        </div>
        
        {/* 任务信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 truncate">
              {task.message || '处理中...'}
            </span>
          </div>
          
          {/* 进度条 */}
          {task.status === 'processing' && (
            <div className="mt-2">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gray-800 transition-all duration-300"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-gray-500 text-right">
                {task.progress}%
              </div>
            </div>
          )}
          
          {/* 错误信息 */}
          {task.status === 'failed' && task.error && (
            <p className="mt-1 text-xs text-red-500 truncate">
              {task.error}
            </p>
          )}
          
          {/* 完成信息 */}
          {task.status === 'completed' && task.resultUrl && (
            <a 
              href={task.resultUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="mt-1 text-xs text-gray-600 hover:text-gray-800 hover:underline"
            >
              查看结果
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function TaskProgressPanel({ tasks, isConnected, onClear }: TaskProgressPanelProps) {
  const [isExpanded, setIsExpanded] = React.useState(true);
  
  const activeTasks = tasks.filter(t => t.status === 'processing' || t.status === 'pending');
  const completedTasks = tasks.filter(t => t.status === 'completed' || t.status === 'failed');
  
  if (tasks.length === 0) {
    return null;
  }
  
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80">
      {/* 头部 */}
      <div 
        className="bg-white rounded-t-xl border border-gray-200 px-4 py-3 flex items-center justify-between cursor-pointer shadow-lg"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-gray-500" />
          <span className="font-medium text-gray-800">
            AI 任务 ({activeTasks.length} 进行中)
          </span>
          {!isConnected && (
            <span className="text-xs text-gray-600 bg-gray-50 px-2 py-0.5 rounded">
              重连中...
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronUp className="w-5 h-5 text-gray-400" />
        )}
      </div>
      
      {/* 任务列表 */}
      {isExpanded && (
        <div className="bg-gray-50 rounded-b-xl border border-t-0 border-gray-200 p-3 space-y-2 max-h-96 overflow-y-auto shadow-lg">
          {activeTasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
          
          {completedTasks.length > 0 && (
            <>
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-gray-500">
                  已完成 ({completedTasks.length})
                </span>
                {onClear && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onClear();
                    }}
                    className="text-xs text-gray-600 hover:text-gray-800 hover:underline"
                  >
                    清除
                  </button>
                )}
              </div>
              {completedTasks.slice(0, 3).map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
