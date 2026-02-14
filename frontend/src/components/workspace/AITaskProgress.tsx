'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Loader2, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Download,
  ExternalLink,
  X,
  RefreshCw,
  FolderPlus,
  ChevronDown,
  Plus
} from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/session';
import { 
  getAITaskStatus, 
  AITaskResponse, 
  AITaskStatus,
  AITaskType,
  addAITaskToProject
} from '@/lib/api/kling-tasks';
import { projectApi } from '@/lib/api';

// 使用单例 Supabase 客户端（用于 Realtime 订阅）
const supabase = getSupabaseClient();

// ============================================
// 类型定义
// ============================================

interface Project {
  id: string;
  name: string;
}

interface AITaskProgressProps {
  taskId: string;
  onComplete?: (task: AITaskResponse) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  autoClose?: boolean;
  onAddedToProject?: (assetId: string, projectId: string) => void;
}

// ============================================
// 任务类型配置
// ============================================

const TASK_TYPE_CONFIG: Record<AITaskType, { label: string; color: string }> = {
  lip_sync: { label: '口型同步', color: 'violet' },
  text_to_video: { label: '文生视频', color: 'blue' },
  image_to_video: { label: '图生视频', color: 'cyan' },
  multi_image_to_video: { label: '多图生视频', color: 'teal' },
  motion_control: { label: '动作控制', color: 'green' },
  video_extend: { label: '视频延长', color: 'amber' },
  image_generation: { label: '图像生成', color: 'pink' },
  omni_image: { label: 'Omni-Image', color: 'fuchsia' },
  face_swap: { label: 'AI换脸', color: 'orange' },
  skin_enhance: { label: '皮肤增强', color: 'rose' },
  relight: { label: '重新打光', color: 'yellow' },
  outfit_swap: { label: '换装', color: 'indigo' },
  ai_stylist: { label: 'AI造型师', color: 'purple' },
  outfit_shot: { label: '穿搭展示', color: 'emerald' },
  doubao_image: { label: 'Doubao生图', color: 'sky' },
};

// ============================================
// 状态图标组件
// ============================================

function StatusIcon({ status }: { status: AITaskStatus }) {
  switch (status) {
    case 'pending':
      return <Clock size={20} className="text-gray-400" />;
    case 'processing':
      return <Loader2 size={20} className="text-gray-500 animate-spin" />;
    case 'completed':
      return <CheckCircle size={20} className="text-gray-500" />;
    case 'failed':
      return <XCircle size={20} className="text-red-500" />;
    case 'cancelled':
      return <XCircle size={20} className="text-gray-400" />;
    default:
      return <Clock size={20} className="text-gray-400" />;
  }
}

// ============================================
// 进度条组件
// ============================================

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const colorClasses: Record<string, string> = {
    violet: 'bg-gray-500',
    blue: 'bg-gray-500',
    cyan: 'bg-gray-500',
    teal: 'bg-gray-500',
    green: 'bg-gray-500',
    amber: 'bg-gray-500',
    pink: 'bg-gray-500',
    fuchsia: 'bg-gray-500',
    orange: 'bg-gray-500',
  };
  
  return (
    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
      <div 
        className={`h-full ${colorClasses[color] || 'bg-gray-500'} transition-all duration-300`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// ============================================
// 主组件
// ============================================

export function AITaskProgress({
  taskId,
  onComplete,
  onError,
  onClose,
  autoClose = false,
  onAddedToProject,
}: AITaskProgressProps) {
  const [task, setTask] = useState<AITaskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  
  // 添加到项目相关状态
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [addingToProject, setAddingToProject] = useState(false);
  const [addedProjectId, setAddedProjectId] = useState<string | null>(null);
  const [stuckWarning, setStuckWarning] = useState<string | null>(null);

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const response = await projectApi.getProjects({ limit: 50 });
      if (response.data?.items) {
        setProjects(response.data.items);
      }
    } catch (err) {
      console.error('加载项目列表失败:', err);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  // 添加到项目
  const handleAddToProject = useCallback(async (projectId: string | null) => {
    if (!taskId || addingToProject) return;
    
    setAddingToProject(true);
    try {
      const result = await addAITaskToProject(taskId, projectId);
      if (result.success) {
        setAddedProjectId(result.project_id);
        setShowProjectSelector(false);
        onAddedToProject?.(result.asset_id, result.project_id);
        
        // 添加成功后跳转到视觉编辑器页面
        window.location.href = `/visual-editor?project=${result.project_id}`;
      }
    } catch (err) {
      console.error('添加到项目失败:', err);
      setError(err instanceof Error ? err.message : '添加到项目失败');
    } finally {
      setAddingToProject(false);
    }
  }, [taskId, addingToProject, onAddedToProject]);

  // Supabase Realtime 订阅任务状态变化
  useEffect(() => {
    if (!taskId) return;

    let mounted = true;

    // 首次加载任务状态
    const loadInitialTask = async () => {
      try {
        const taskData = await getAITaskStatus(taskId);
        if (!mounted) return;
        
        setTask(taskData);
        setError(null);

        // 如果已经完成，不需要订阅
        if (taskData.status === 'completed') {
          onComplete?.(taskData);
          if (autoClose) {
            setTimeout(() => onClose?.(), 2000);
          }
          return;
        }
        
        if (taskData.status === 'failed' || taskData.status === 'cancelled') {
          if (taskData.error_message) {
            setError(taskData.error_message);
          }
          return;
        }

        // 未完成，开始订阅
        setIsSubscribed(true);
      } catch (err) {
        if (!mounted) return;
        const errorMessage = err instanceof Error ? err.message : '查询任务状态失败';
        setError(errorMessage);
        onError?.(err instanceof Error ? err : new Error(errorMessage));
      }
    };

    loadInitialTask();

    return () => {
      mounted = false;
    };
  }, [taskId, onComplete, onError, onClose, autoClose]);

  // Realtime 订阅
  useEffect(() => {
    if (!taskId || !isSubscribed) return;

    console.log('[AITaskProgress] 开始订阅任务状态:', taskId);

    const channel = supabase
      .channel(`ai_task_${taskId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tasks',
          filter: `id=eq.${taskId}`,
        },
        (payload) => {
          console.log('[AITaskProgress] 收到任务更新:', payload.new);
          const newTask = payload.new as AITaskResponse;
          setTask(newTask);

          // 检查是否完成
          if (newTask.status === 'completed') {
            setIsSubscribed(false);
            onComplete?.(newTask);
            if (autoClose) {
              setTimeout(() => onClose?.(), 2000);
            }
          } else if (newTask.status === 'failed' || newTask.status === 'cancelled') {
            setIsSubscribed(false);
            if (newTask.error_message) {
              setError(newTask.error_message);
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('[AITaskProgress] 订阅状态:', status);
      });

    return () => {
      console.log('[AITaskProgress] 取消订阅:', taskId);
      supabase.removeChannel(channel);
    };
  }, [taskId, isSubscribed, onComplete, onClose, autoClose]);

  // 卡住检测：任务 pending 超过 30 秒 或 processing 超过 10 分钟，提示用户
  useEffect(() => {
    if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      setStuckWarning(null);
      return;
    }
    const timer = setInterval(() => {
      if (!task.created_at) return;
      const elapsed = (Date.now() - new Date(task.created_at).getTime()) / 1000;
      if (task.status === 'pending' && elapsed > 30) {
        setStuckWarning(`任务已等待 ${Math.floor(elapsed / 60)} 分钟，Celery Worker 可能未监听对应队列。请检查后台服务。`);
      } else if (task.status === 'processing' && elapsed > 600) {
        setStuckWarning(`任务已处理 ${Math.floor(elapsed / 60)} 分钟，可能卡住。可尝试关闭后重新提交。`);
      } else {
        setStuckWarning(null);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [task]);

  // 重试（重新加载初始状态）
  const handleRetry = useCallback(async () => {
    setError(null);
    try {
      const taskData = await getAITaskStatus(taskId);
      setTask(taskData);
      if (taskData.status !== 'completed' && taskData.status !== 'failed' && taskData.status !== 'cancelled') {
        setIsSubscribed(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询任务状态失败');
    }
  }, [taskId]);

  // 渲染
  if (!task && !error) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 size={24} className="animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">加载中...</span>
      </div>
    );
  }

  const taskConfig = task?.task_type ? TASK_TYPE_CONFIG[task.task_type] : null;
  const statusLabel = getStatusLabel(task?.status);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <StatusIcon status={task?.status || 'pending'} />
          <span className="font-medium text-gray-900">
            {taskConfig?.label || '任务处理'}
          </span>
          <span className={`px-2 py-0.5 text-xs rounded-full ${getStatusBadgeClass(task?.status)}`}>
            {statusLabel}
          </span>
        </div>
        {onClose && (
          <button 
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X size={16} className="text-gray-400" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* 进度条 */}
        {task && task.status !== 'failed' && task.status !== 'cancelled' && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{task.status_message || '处理中...'}</span>
              <span className="text-gray-500">{task.progress}%</span>
            </div>
            <ProgressBar progress={task.progress} color={taskConfig?.color || 'blue'} />
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg">
            <XCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-700">{error}</p>
              <button 
                onClick={handleRetry}
                className="mt-2 flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
              >
                <RefreshCw size={12} />
                重试
              </button>
            </div>
          </div>
        )}

        {/* 卡住警告 */}
        {stuckWarning && (
          <div className="flex items-start gap-2 p-3 bg-gray-100 rounded-lg">
            <Clock size={16} className="text-gray-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-gray-600">{stuckWarning}</p>
          </div>
        )}

        {/* 完成结果 */}
        {task?.status === 'completed' && task.output_url && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <CheckCircle size={16} className="text-gray-500" />
              <span className="text-sm text-gray-700">生成完成！</span>
            </div>
            
            {/* 预览/下载/添加到项目 */}
            <div className="flex gap-2">
              <a
                href={task.output_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors"
              >
                <ExternalLink size={16} />
                预览
              </a>
              <a
                href={task.output_url}
                download
                className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors"
              >
                <Download size={16} />
                下载
              </a>
            </div>
            
            {/* 添加到项目按钮 */}
            <div className="relative">
              {addedProjectId ? (
                <div className="flex items-center justify-center gap-2 py-2 px-4 bg-gray-100 rounded-lg text-sm text-gray-700">
                  <CheckCircle size={16} />
                  已添加到项目
                </div>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setShowProjectSelector(!showProjectSelector);
                      if (!showProjectSelector && projects.length === 0) {
                        loadProjects();
                      }
                    }}
                    disabled={addingToProject}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-300 rounded-lg text-sm text-white transition-colors"
                  >
                    {addingToProject ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <FolderPlus size={16} />
                    )}
                    添加到项目
                    <ChevronDown size={14} className={`transition-transform ${showProjectSelector ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {/* 项目选择下拉 */}
                  {showProjectSelector && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                      {/* 新建项目按钮 - 始终显示在最上面 */}
                      <button
                        onClick={() => handleAddToProject(null)}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors border-b border-gray-200 flex items-center gap-2 text-gray-600 font-medium"
                      >
                        <Plus size={16} />
                        新建项目并编辑
                      </button>
                      
                      {loadingProjects ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 size={16} className="animate-spin text-gray-400" />
                          <span className="ml-2 text-sm text-gray-500">加载中...</span>
                        </div>
                      ) : projects.length === 0 ? (
                        <div className="py-3 text-center text-sm text-gray-500">
                          暂无其他项目
                        </div>
                      ) : (
                        <>
                          <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50">
                            添加到现有项目
                          </div>
                          {projects.map((project) => (
                            <button
                              key={project.id}
                              onClick={() => handleAddToProject(project.id)}
                              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                            >
                              {project.name}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* 任务信息 */}
        <div className="text-xs text-gray-400 space-y-1">
          <p>任务 ID: {taskId.slice(0, 8)}...</p>
          {task?.created_at && (
            <p>创建时间: {new Date(task.created_at).toLocaleString()}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// 辅助函数
// ============================================

function getStatusLabel(status?: AITaskStatus): string {
  switch (status) {
    case 'pending': return '等待中';
    case 'processing': return '处理中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
    default: return '未知';
  }
}

function getStatusBadgeClass(status?: AITaskStatus): string {
  switch (status) {
    case 'pending': return 'bg-gray-100 text-gray-600';
    case 'processing': return 'bg-gray-100 text-gray-600';
    case 'completed': return 'bg-gray-100 text-gray-600';
    case 'failed': return 'bg-red-100 text-red-600';
    case 'cancelled': return 'bg-gray-100 text-gray-500';
    default: return 'bg-gray-100 text-gray-600';
  }
}

// ============================================
// 导出任务列表组件
// ============================================

interface AITaskListProps {
  tasks: AITaskResponse[];
  onTaskClick?: (taskId: string) => void;
}

export function AITaskList({ tasks, onTaskClick }: AITaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        暂无任务
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const config = TASK_TYPE_CONFIG[task.task_type];
        return (
          <div
            key={task.task_id}
            onClick={() => task.task_id && onTaskClick?.(task.task_id)}
            className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300 cursor-pointer transition-colors"
          >
            <StatusIcon status={task.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{config?.label || task.task_type}</span>
                <span className={`px-2 py-0.5 text-xs rounded-full ${getStatusBadgeClass(task.status)}`}>
                  {getStatusLabel(task.status)}
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate">
                {task.status_message || `创建于 ${new Date(task.created_at).toLocaleString()}`}
              </p>
            </div>
            {task.status === 'processing' && (
              <span className="text-sm text-gray-500">{task.progress}%</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
