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
      return <Loader2 size={12} className="text-gray-500 animate-spin" />;
    case 'completed':
      return <CheckCircle size={12} className="text-gray-500" />;
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
  onDelete,
}: { 
  task: TaskHistoryItem; 
  shots: Array<{ id: string; index: number; transcript?: string }>;
  onPreview?: (url: string) => void;
  onDelete?: (taskId: string) => void;
}) {
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false);
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  
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

  const inputParams = (task.input_params || {}) as Record<string, unknown>;
  const finalPrompt = (inputParams.final_prompt as string | undefined)
    || (inputParams.prompt as string | undefined);
  const payloadSnapshot = (inputParams.payload_snapshot || {}) as Record<string, unknown>;
  const focusModes = Array.isArray(payloadSnapshot.focus_modes)
    ? (payloadSnapshot.focus_modes as string[]).join('+')
    : undefined;
  const payloadSummaryParts: string[] = [];
  if (typeof payloadSnapshot.duration === 'string') payloadSummaryParts.push(`时长 ${payloadSnapshot.duration}s`);
  if (typeof payloadSnapshot.aspect_ratio === 'string') payloadSummaryParts.push(`比例 ${payloadSnapshot.aspect_ratio}`);
  if (typeof payloadSnapshot.boundary_ms === 'number') payloadSummaryParts.push(`边界 ${payloadSnapshot.boundary_ms}ms`);
  if (typeof payloadSnapshot.variant_count === 'number') payloadSummaryParts.push(`变体 ${payloadSnapshot.variant_count}`);
  if (typeof payloadSnapshot.golden_preset === 'string') payloadSummaryParts.push(`预设 ${payloadSnapshot.golden_preset}`);
  if (focusModes) payloadSummaryParts.push(`焦点 ${focusModes}`);
  if (typeof inputParams.capability_id === 'string') payloadSummaryParts.push(inputParams.capability_id);
  const payloadSummary = payloadSummaryParts.join(' · ');
  
  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasResult && onPreview) {
      onPreview(resultUrl);
    }
  };
  
  // ★ 保存到素材库
  const handleSaveToLibrary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasResult || isSavingToLibrary || savedToLibrary) return;
    
    setIsSavingToLibrary(true);
    try {
      const materialsApi = new MaterialsApi();
      const result = await materialsApi.importFromUrl(resultUrl);
      
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
  
  // ★ 删除任务
  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeleting || !onDelete) return;
    
    // 确认删除
    if (!window.confirm('确定要删除这条任务记录吗？')) return;
    
    setIsDeleting(true);
    await onDelete(task.id);
    setIsDeleting(false);
  };
  
  return (
    <div 
      className="p-3 bg-white border border-gray-100 rounded-lg transition-colors hover:border-gray-200 group relative"
    >
      {/* ★ 删除按钮 - 悬停时显示 */}
      {onDelete && (
        <button
          onClick={handleDeleteClick}
          disabled={isDeleting}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-all"
          title="删除任务"
        >
          {isDeleting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <X size={14} />
          )}
        </button>
      )}
      
      {/* 顶部：类型 + 状态 */}
      <div className="flex items-center justify-between mb-2 pr-6">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 flex items-center justify-center bg-gray-50 rounded text-gray-600">
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

      {finalPrompt && (
        <div
          className="mb-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 cursor-pointer hover:bg-gray-100/60 transition-colors"
          onClick={() => setPromptExpanded(prev => !prev)}
          title={promptExpanded ? '点击收起' : '点击展开完整 Prompt'}
        >
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium text-gray-700">Prompt</div>
            <span className="text-[10px] text-gray-400">{promptExpanded ? '收起' : '展开'}</span>
          </div>
          <div className={`mt-0.5 text-[11px] text-gray-900 ${promptExpanded ? '' : 'line-clamp-3'}`}>{finalPrompt}</div>
        </div>
      )}

      {/* ★ 多输入节点缩略图 */}
      {(() => {
        const inputNodes = (inputParams.input_nodes as Array<{ clipId?: string; url?: string; role?: string }> | undefined);
        if (!inputNodes || inputNodes.length === 0) return null;
        return (
          <div className="mb-2 flex items-center gap-1.5 overflow-x-auto">
            {inputNodes.map((node, idx) => (
              <div key={node.clipId || idx} className="flex-shrink-0 w-8 h-8 rounded border border-gray-200 overflow-hidden bg-gray-100">
                {node.url ? (
                  <img src={node.url} alt={`Input ${idx + 1}`} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-400">
                    {idx + 1}
                  </div>
                )}
              </div>
            ))}
            <span className="text-[10px] text-gray-400 ml-0.5">{inputNodes.length} 输入</span>
          </div>
        );
      })()}

      {payloadSummary && (
        <div className="mb-2 text-[11px] text-gray-500">参数: {payloadSummary}</div>
      )}
      
      {/* 进度条 (仅处理中显示) */}
      {task.status === 'processing' && (
        <div className="mb-2">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gray-800 rounded-full transition-all duration-300"
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
      
      {/* 底部：时间 + 日志入口 */}
      <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
        <span>{formatTime(task.created_at)}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              const logUrl = `/api/tasks/${task.id}/logs`;
              window.open(logUrl, '_blank', 'noopener,noreferrer');
            }}
            className="text-[10px] text-gray-400 hover:text-gray-600 hover:underline transition-colors"
            title="查看任务运行日志"
          >
            日志
          </button>
          {task.completed_at && task.status === 'completed' && (
            <span className="text-gray-500">
              ✓ {formatTime(task.completed_at)}
            </span>
          )}
        </div>
      </div>
      
      {/* ★ 结果预览 + 操作按钮区域（紧凑单行） */}
      {hasResult && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          {/* 内联缩略图预览 */}
          <div 
            className="flex-shrink-0 w-14 h-10 rounded-md overflow-hidden border border-gray-200 cursor-pointer hover:border-gray-400 transition-colors group/preview relative"
            onClick={handlePreviewClick}
            title="点击预览"
          >
            {/\.(mp4|webm|mov)(\?|$)/i.test(resultUrl) ? (
              <video
                src={resultUrl}
                className="w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
                onLoadedData={(e) => { e.currentTarget.currentTime = 0.1; e.currentTarget.pause(); }}
              />
            ) : (
              <img src={resultUrl} alt="结果" className="w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 bg-black/0 group-hover/preview:bg-black/30 transition-colors flex items-center justify-center">
              <Play size={14} className="text-white opacity-0 group-hover/preview:opacity-100 transition-opacity" />
            </div>
          </div>
          
          {/* 已完成标记 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <CheckCircle size={12} />
              <span>已完成</span>
            </div>
          </div>
          
          {/* 保存到素材库按钮 */}
          <button
            onClick={handleSaveToLibrary}
            disabled={isSavingToLibrary || savedToLibrary}
            className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
              savedToLibrary 
                ? 'text-gray-600 bg-gray-50' 
                : 'text-gray-800 bg-gray-100 hover:bg-gray-200'
            }`}
            title="保存到素材库"
          >
            {isSavingToLibrary ? (
              <Loader2 size={12} className="animate-spin" />
            ) : savedToLibrary ? (
              <><Check size={12} />已保存</>
            ) : (
              <><Plus size={12} />保存</>
            )}
          </button>
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
  // ★ 使用统一的侧边栏管理
  const activeSidebar = useVisualEditorStore(state => state.activeSidebar);
  const closeSidebar = useVisualEditorStore(state => state.closeSidebar);
  const isOpen = activeSidebar === 'taskHistory';
  
  const { 
    tasks, 
    isLoading, 
    error,
    fetch,
    deleteTask,
  } = useTaskHistoryStore();
  
  // ★ 获取 shots 信息用于显示关联的 clip
  const shots = useVisualEditorStore(state => state.shots);
  
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
      {/* ★ 移除遮罩层，让侧边栏不影响画布操作 */}
      
      {/* 侧边栏 - top-14 避免溢出到导航栏 */}
      <div className="fixed right-0 top-14 bottom-0 w-96 bg-gray-50 shadow-xl z-40 flex flex-col animate-slide-in-right pointer-events-auto">
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
                onDelete={deleteTask}
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
        @keyframes fade-in {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.2s ease-out;
        }
      `}</style>
    </>
  );
}
