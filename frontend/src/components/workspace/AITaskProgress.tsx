'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  ChevronDown
} from 'lucide-react';
import { 
  getAITaskStatus, 
  AITaskResponse, 
  AITaskStatus,
  AITaskType,
  addAITaskToProject
} from '@/features/editor/lib/rabbit-hole-api';
import { projectApi } from '@/lib/api';

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
  pollInterval?: number;
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
};

// ============================================
// 状态图标组件
// ============================================

function StatusIcon({ status }: { status: AITaskStatus }) {
  switch (status) {
    case 'pending':
      return <Clock size={20} className="text-gray-400" />;
    case 'processing':
      return <Loader2 size={20} className="text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle size={20} className="text-green-500" />;
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
    violet: 'bg-violet-500',
    blue: 'bg-blue-500',
    cyan: 'bg-cyan-500',
    teal: 'bg-teal-500',
    green: 'bg-green-500',
    amber: 'bg-amber-500',
    pink: 'bg-pink-500',
    fuchsia: 'bg-fuchsia-500',
    orange: 'bg-orange-500',
  };
  
  return (
    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
      <div 
        className={`h-full ${colorClasses[color] || 'bg-blue-500'} transition-all duration-300`}
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
  pollInterval = 3000,
  onAddedToProject,
}: AITaskProgressProps) {
  const [task, setTask] = useState<AITaskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  
  // 添加到项目相关状态
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [addingToProject, setAddingToProject] = useState(false);
  const [addedProjectId, setAddedProjectId] = useState<string | null>(null);

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
  const handleAddToProject = useCallback(async (projectId: string) => {
    if (!taskId || addingToProject) return;
    
    setAddingToProject(true);
    try {
      const result = await addAITaskToProject(taskId, projectId);
      if (result.success) {
        setAddedProjectId(projectId);
        setShowProjectSelector(false);
        onAddedToProject?.(result.asset_id, projectId);
      }
    } catch (err) {
      console.error('添加到项目失败:', err);
      setError(err instanceof Error ? err.message : '添加到项目失败');
    } finally {
      setAddingToProject(false);
    }
  }, [taskId, addingToProject, onAddedToProject]);

  // 轮询任务状态
  useEffect(() => {
    if (!taskId || !isPolling) return;

    let mounted = true;
    let timeoutId: NodeJS.Timeout;

    const poll = async () => {
      try {
        const taskData = await getAITaskStatus(taskId);
        
        if (!mounted) return;
        
        setTask(taskData);
        setError(null);

        // 检查是否完成
        if (taskData.status === 'completed') {
          setIsPolling(false);
          onComplete?.(taskData);
          if (autoClose) {
            setTimeout(() => onClose?.(), 2000);
          }
        } else if (taskData.status === 'failed' || taskData.status === 'cancelled') {
          setIsPolling(false);
          if (taskData.error_message) {
            setError(taskData.error_message);
          }
        } else {
          // 继续轮询
          timeoutId = setTimeout(poll, pollInterval);
        }
      } catch (err) {
        if (!mounted) return;
        const errorMessage = err instanceof Error ? err.message : '查询任务状态失败';
        setError(errorMessage);
        onError?.(err instanceof Error ? err : new Error(errorMessage));
        // 出错后继续尝试
        timeoutId = setTimeout(poll, pollInterval * 2);
      }
    };

    poll();

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [taskId, isPolling, pollInterval, onComplete, onError, onClose, autoClose]);

  // 重试
  const handleRetry = useCallback(() => {
    setError(null);
    setIsPolling(true);
  }, []);

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

        {/* 完成结果 */}
        {task?.status === 'completed' && task.output_url && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
              <CheckCircle size={16} className="text-green-500" />
              <span className="text-sm text-green-700">生成完成！</span>
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
                <div className="flex items-center justify-center gap-2 py-2 px-4 bg-green-100 rounded-lg text-sm text-green-700">
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
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-violet-500 hover:bg-violet-600 disabled:bg-violet-300 rounded-lg text-sm text-white transition-colors"
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
                      {loadingProjects ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 size={16} className="animate-spin text-gray-400" />
                          <span className="ml-2 text-sm text-gray-500">加载中...</span>
                        </div>
                      ) : projects.length === 0 ? (
                        <div className="py-4 text-center text-sm text-gray-500">
                          暂无项目
                        </div>
                      ) : (
                        projects.map((project) => (
                          <button
                            key={project.id}
                            onClick={() => handleAddToProject(project.id)}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                          >
                            {project.name}
                          </button>
                        ))
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
    case 'processing': return 'bg-blue-100 text-blue-600';
    case 'completed': return 'bg-green-100 text-green-600';
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
            onClick={() => onTaskClick?.(task.task_id)}
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
              <span className="text-sm text-blue-500">{task.progress}%</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
