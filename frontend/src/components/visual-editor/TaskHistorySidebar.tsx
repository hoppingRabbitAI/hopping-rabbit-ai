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
  Replace,
  Play,
  Film,
  Plus,
  Check,
} from 'lucide-react';
import { 
  useTaskHistoryStore, 
  TaskHistoryItem,
  TASK_TYPE_LABELS,
  TASK_STATUS_CONFIG,
} from '@/stores/taskHistoryStore';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import { MaterialsApi } from '@/lib/api/materials';

interface TaskHistorySidebarProps {
  projectId?: string;
  onReplaceClip?: (clipId: string, newVideoUrl: string, taskId: string) => void;
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
function TaskItem({ 
  task, 
  shots,
  onPreview,
  onReplace,
}: { 
  task: TaskHistoryItem; 
  shots: Array<{ id: string; index: number; transcript?: string }>;
  onPreview?: (url: string) => void;
  onReplace?: (clipId: string, videoUrl: string, taskId: string) => void;
}) {
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false);
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  
  const typeLabel = TASK_TYPE_LABELS[task.task_type] || task.task_type;
  const statusConfig = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG['pending'];
  
  // 获取结果 URL（图片或视频）- ★ 统一使用 tasks 表
  const resultUrl = task.output_url 
    || (task as unknown as { result_url?: string }).result_url  // tasks 表使用 result_url
    || (task.result_metadata as { result_url?: string })?.result_url;
  const hasResult = task.status === 'completed' && resultUrl;
  
  // ★ 获取关联的 clip 信息
  const clipId = task.clip_id || (task.input_params as { clip_id?: string })?.clip_id;
  const relatedShot = clipId ? shots.find(s => s.id === clipId) : null;
  
  // ★ 格式化 clip 标识
  const getClipLabel = () => {
    if (!clipId) return null;
    if (relatedShot) {
      // 显示分镜序号和部分文稿
      const transcript = relatedShot.transcript || '';
      const shortTranscript = transcript.length > 20 
        ? transcript.substring(0, 20) + '...' 
        : transcript;
      return `分镜 ${relatedShot.index + 1}${shortTranscript ? `: ${shortTranscript}` : ''}`;
    }
    // 只显示 clip ID 的前 8 位
    return `Clip ${clipId.substring(0, 8)}`;
  };
  
  const clipLabel = getClipLabel();
  
  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasResult && onPreview) {
      onPreview(resultUrl);
    }
  };
  
  const handleReplaceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasResult && clipId && onReplace) {
      onReplace(clipId, resultUrl, task.id);
    }
  };
  
  // ★ 保存到素材库
  const handleSaveToLibrary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasResult || isSavingToLibrary || savedToLibrary) return;
    
    setIsSavingToLibrary(true);
    try {
      const materialsApi = new MaterialsApi();
      const result = await materialsApi.importFromUrl({
        source_url: resultUrl,
        display_name: `${typeLabel} - ${formatTime(task.created_at)}`,
        material_type: 'general',
        tags: ['ai-generated', task.task_type],
        source_task_id: task.id,
      });
      
      if (result.data?.success) {
        setSavedToLibrary(true);
        // 3秒后重置状态，允许再次保存
        setTimeout(() => setSavedToLibrary(false), 3000);
      } else {
        console.error('保存到素材库失败:', result.error);
      }
    } catch (error) {
      console.error('保存到素材库失败:', error);
    } finally {
      setIsSavingToLibrary(false);
    }
  };
  
  return (
    <div 
      className="p-3 bg-white border border-gray-100 rounded-lg transition-colors hover:border-gray-200"
    >
      {/* 顶部：类型 + 状态 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 flex items-center justify-center bg-blue-50 rounded text-blue-600">
            <Film size={14} />
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
      
      {/* ★ 关联的 Clip 信息 */}
      {clipLabel && (
        <div className="mb-2 px-2 py-1.5 bg-gray-50 rounded-md">
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <Video size={12} className="text-gray-400" />
            <span className="font-medium">来源:</span>
            <span className="text-gray-700 truncate">{clipLabel}</span>
          </div>
        </div>
      )}
      
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
      <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
        <span>{formatTime(task.created_at)}</span>
        {task.completed_at && task.status === 'completed' && (
          <span className="text-green-500">
            ✓ {formatTime(task.completed_at)}
          </span>
        )}
      </div>
      
      {/* ★ 操作按钮区域 */}
      {hasResult && (
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={handlePreviewClick}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-md transition-colors"
          >
            <Play size={12} />
            预览
          </button>
          
          {/* ★ 保存到素材库按钮 */}
          <button
            onClick={handleSaveToLibrary}
            disabled={isSavingToLibrary || savedToLibrary}
            className={`flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-medium rounded-md transition-colors ${
              savedToLibrary 
                ? 'text-green-600 bg-green-50' 
                : 'text-purple-600 bg-purple-50 hover:bg-purple-100'
            }`}
            title="保存到素材库"
          >
            {isSavingToLibrary ? (
              <Loader2 size={12} className="animate-spin" />
            ) : savedToLibrary ? (
              <Check size={12} />
            ) : (
              <Plus size={12} />
            )}
          </button>
          
          {clipId && onReplace && (
            <button
              onClick={handleReplaceClick}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
            >
              <Replace size={12} />
              替换原视频
            </button>
          )}
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

export default function TaskHistorySidebar({ projectId, onReplaceClip }: TaskHistorySidebarProps) {
  // ★ 使用统一的侧边栏管理
  const activeSidebar = useVisualEditorStore(state => state.activeSidebar);
  const closeSidebar = useVisualEditorStore(state => state.closeSidebar);
  const isOpen = activeSidebar === 'taskHistory';
  
  const { 
    tasks, 
    isLoading, 
    error,
    fetch,
  } = useTaskHistoryStore();
  
  // ★ 获取 shots 信息用于显示关联的 clip
  const shots = useVisualEditorStore(state => state.shots);
  
  // 预览状态
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // ★ 替换确认状态
  const [replaceConfirm, setReplaceConfirm] = useState<{
    clipId: string;
    videoUrl: string;
    taskId: string;
    clipLabel: string;
  } | null>(null);
  
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
  
  // ★ 处理替换请求
  const handleReplace = (clipId: string, videoUrl: string, taskId: string) => {
    const shot = shots.find(s => s.id === clipId);
    const clipLabel = shot 
      ? `分镜 ${shot.index + 1}` 
      : `Clip ${clipId.substring(0, 8)}`;
    
    setReplaceConfirm({ clipId, videoUrl, taskId, clipLabel });
  };
  
  // ★ 确认替换
  const confirmReplace = () => {
    if (replaceConfirm && onReplaceClip) {
      onReplaceClip(replaceConfirm.clipId, replaceConfirm.videoUrl, replaceConfirm.taskId);
      setReplaceConfirm(null);
    }
  };
  
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
              onClick={closeSidebar}
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
              <TaskItem 
                key={task.id} 
                task={task} 
                shots={shots.map(s => ({ id: s.id, index: s.index, transcript: s.transcript }))}
                onPreview={setPreviewUrl}
                onReplace={onReplaceClip ? handleReplace : undefined}
              />
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
      
      {/* ★ 替换确认对话框 */}
      {replaceConfirm && (
        <div 
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
          onClick={() => setReplaceConfirm(null)}
        >
          <div 
            className="bg-white rounded-xl shadow-2xl p-6 max-w-md mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Replace size={20} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">确认替换视频</h3>
                <p className="text-sm text-gray-500">此操作将替换原始视频片段</p>
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <p className="text-sm text-gray-700">
                将用生成的视频替换 <span className="font-semibold text-blue-600">{replaceConfirm.clipLabel}</span> 的原始视频。
              </p>
              <p className="text-xs text-gray-500 mt-2">
                替换后可以通过撤销操作恢复原视频。
              </p>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setReplaceConfirm(null)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmReplace}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
              >
                确认替换
              </button>
            </div>
          </div>
        </div>
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
