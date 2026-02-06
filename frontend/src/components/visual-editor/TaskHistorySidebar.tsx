'use client';

import React, { useEffect, useState } from 'react';
import { 
  X, 
  Clock, 
  Loader2, 
  CheckCircle, 
  XCircle, 
  Ban,
  RefreshCw,
  ImageIcon,
  Video,
  Mic,
  Sparkles,
  Palette,
  UserCircle,
  Music,
  FileText,
} from 'lucide-react';
import { 
  useTaskHistoryStore, 
  TaskHistoryItem,
  TASK_TYPE_LABELS,
  TASK_STATUS_CONFIG,
} from '@/stores/taskHistoryStore';

interface TaskHistorySidebarProps {
  projectId?: string;
}

// 获取任务类型图标
function getTaskIcon(taskType: string) {
  switch (taskType) {
    case 'background_replace':
    case 'omni_image':
    case 'image_generation':
      return <ImageIcon size={14} />;
    case 'text_to_video':
    case 'image_to_video':
    case 'multi_image_to_video':
    case 'motion_control':
    case 'video_extend':
      return <Video size={14} />;
    case 'lip_sync':
    case 'face_swap':
      return <UserCircle size={14} />;
    case 'voice_enhance':
    case 'stem_separation':
    case 'extract_audio':
      return <Music size={14} />;
    case 'asr':
      return <FileText size={14} />;
    case 'style_transfer':
      return <Palette size={14} />;
    default:
      return <Sparkles size={14} />;
  }
}

// 获取状态图标
function getStatusIcon(status: string) {
  switch (status) {
    case 'pending':
      return <Clock size={12} className="text-gray-400" />;
    case 'processing':
      return <Loader2 size={12} className="text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle size={12} className="text-green-500" />;
    case 'failed':
      return <XCircle size={12} className="text-red-500" />;
    case 'cancelled':
      return <Ban size={12} className="text-gray-400" />;
    default:
      return <Clock size={12} className="text-gray-400" />;
  }
}

// 格式化时间
function formatTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  // 1分钟内
  if (diff < 60 * 1000) {
    return '刚刚';
  }
  
  // 1小时内
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  }
  
  // 24小时内
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  }
  
  // 超过24小时
  return date.toLocaleDateString('zh-CN', { 
    month: 'numeric', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 单个任务项组件
function TaskItem({ task, onPreview }: { task: TaskHistoryItem; onPreview?: (url: string) => void }) {
  const typeLabel = TASK_TYPE_LABELS[task.task_type] || task.task_type;
  const statusConfig = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG['pending'];
  
  // 获取结果 URL（图片或视频）- ★ 兼容 tasks 表和 ai_tasks 表的不同字段名
  const resultUrl = task.output_url 
    || (task as unknown as { result_url?: string }).result_url  // tasks 表使用 result_url
    || (task.result_metadata as { result_url?: string })?.result_url;
  const hasResult = task.status === 'completed' && resultUrl;
  
  const handleClick = () => {
    if (hasResult && onPreview) {
      onPreview(resultUrl);
    }
  };
  
  return (
    <div 
      className={`p-3 bg-white border border-gray-100 rounded-lg transition-colors ${
        hasResult ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30' : 'hover:border-gray-200'
      }`}
      onClick={handleClick}
    >
      {/* 顶部：类型 + 状态 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 flex items-center justify-center bg-gray-100 rounded text-gray-600">
            {getTaskIcon(task.task_type)}
          </div>
          <span className="text-sm font-medium text-gray-900">{typeLabel}</span>
        </div>
        
        <div className="flex items-center gap-1">
          {getStatusIcon(task.status)}
          <span className={`text-xs ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
        </div>
      </div>
      
      {/* 进度条 (仅处理中显示) */}
      {task.status === 'processing' && (
        <div className="mb-2">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${task.progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {task.status_message || `${task.progress}%`}
          </p>
        </div>
      )}
      
      {/* 错误信息 */}
      {task.status === 'failed' && task.error_message && (
        <p className="text-xs text-red-500 mb-2 line-clamp-2">
          {task.error_message}
        </p>
      )}
      
      {/* 底部：时间 */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{formatTime(task.created_at)}</span>
        {task.completed_at && task.status === 'completed' && (
          <span className="text-green-500">
            ✓ {formatTime(task.completed_at)}
          </span>
        )}
      </div>
      
      {/* 预览提示 */}
      {hasResult && (
        <div className="mt-2 text-xs text-blue-500 flex items-center gap-1">
          <span>👆 点击预览结果</span>
        </div>
      )}
    </div>
  );
}

// 预览弹窗组件
function PreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  const isVideo = url.includes('.mp4') || url.includes('.webm') || url.includes('.mov') || url.includes('/video');
  
  return (
    <div 
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div 
        className="relative max-w-4xl max-h-[90vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white hover:text-gray-300"
        >
          <X size={24} />
        </button>
        
        {isVideo ? (
          <video 
            src={url} 
            controls 
            autoPlay 
            className="max-w-full max-h-[80vh] rounded-lg"
          />
        ) : (
          <img 
            src={url} 
            alt="预览" 
            className="max-w-full max-h-[80vh] rounded-lg"
          />
        )}
      </div>
    </div>
  );
}

export default function TaskHistorySidebar({ projectId }: TaskHistorySidebarProps) {
  const { 
    isOpen, 
    close, 
    tasks, 
    isLoading, 
    error,
    fetch,
  } = useTaskHistoryStore();
  
  // 预览状态
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  // ★ 治本：打开侧边栏时立即获取任务列表
  useEffect(() => {
    if (isOpen && projectId) {
      fetch(projectId);
    }
  }, [isOpen, projectId, fetch]);
  
  // 定时刷新进行中的任务 - ★ 3秒刷新一次，确保进度及时更新
  useEffect(() => {
    if (!isOpen || !projectId) return;
    
    const hasProcessing = tasks.some(
      t => t.status === 'pending' || t.status === 'processing'
    );
    
    if (!hasProcessing) return;
    
    const interval = setInterval(() => {
      fetch(projectId);
    }, 3000);  // 3秒刷新
    
    return () => clearInterval(interval);
  }, [isOpen, projectId, tasks, fetch]);
  
  if (!isOpen) return null;
  
  return (
    <>
      {/* 遮罩层 */}
      <div 
        className="fixed inset-0 bg-black/20 z-40"
        onClick={close}
      />
      
      {/* 侧边栏 */}
      <div className="fixed right-0 top-0 h-full w-96 bg-gray-50 shadow-xl z-50 flex flex-col animate-slide-in-right">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
          <h2 className="text-base font-bold text-gray-900">任务历史</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => projectId && fetch(projectId)}
              disabled={isLoading}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              title="刷新"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={close}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        
        {/* 任务列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading && tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={24} className="text-gray-400 animate-spin mb-2" />
              <p className="text-sm text-gray-500">加载中...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <XCircle size={24} className="text-red-400 mb-2" />
              <p className="text-sm text-red-500">{error}</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Clock size={24} className="text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">暂无任务记录</p>
            </div>
          ) : (
            tasks.map(task => (
              <TaskItem key={task.id} task={task} onPreview={setPreviewUrl} />
            ))
          )}
        </div>
        
        {/* 底部统计 */}
        {tasks.length > 0 && (
          <div className="p-3 border-t border-gray-200 bg-white">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>共 {tasks.length} 个任务</span>
              <span>
                {tasks.filter(t => t.status === 'completed').length} 完成 · 
                {tasks.filter(t => t.status === 'processing' || t.status === 'pending').length} 进行中
              </span>
            </div>
          </div>
        )}
      </div>
      
      {/* 预览弹窗 */}
      {previewUrl && (
        <PreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
      )}
      
      {/* 动画样式 */}
      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.2s ease-out;
        }
      `}</style>
    </>
  );
}
