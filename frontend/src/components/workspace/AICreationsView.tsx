'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Sparkles,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Download,
  ExternalLink,
  FolderPlus,
  Video,
  Image,
  RefreshCw,
  Trash2,
  Filter,
  ChevronDown
} from 'lucide-react';
import { 
  getAITaskList, 
  addAITaskToProject,
  AITaskResponse,
  AITaskStatus,
  AITaskType 
} from '@/features/editor/lib/rabbit-hole-api';
import { projectApi } from '@/lib/api';

// ============================================
// 类型定义
// ============================================

interface Project {
  id: string;
  name: string;
}

// 任务类型配置
const TASK_TYPE_CONFIG: Record<AITaskType, { label: string; color: string; icon: typeof Video }> = {
  lip_sync: { label: '口型同步', color: 'violet', icon: Video },
  text_to_video: { label: '文生视频', color: 'blue', icon: Video },
  image_to_video: { label: '图生视频', color: 'cyan', icon: Video },
  multi_image_to_video: { label: '多图生视频', color: 'teal', icon: Video },
  motion_control: { label: '动作控制', color: 'green', icon: Video },
  video_extend: { label: '视频延长', color: 'amber', icon: Video },
  image_generation: { label: '图像生成', color: 'pink', icon: Image },
  omni_image: { label: 'Omni-Image', color: 'fuchsia', icon: Image },
  face_swap: { label: 'AI换脸', color: 'orange', icon: Video },
};

// ============================================
// 状态标签组件
// ============================================

function StatusBadge({ status }: { status: AITaskStatus }) {
  const config = {
    pending: { label: '等待中', className: 'bg-gray-100 text-gray-600' },
    processing: { label: '处理中', className: 'bg-blue-100 text-blue-600' },
    completed: { label: '已完成', className: 'bg-green-100 text-green-600' },
    failed: { label: '失败', className: 'bg-red-100 text-red-600' },
    cancelled: { label: '已取消', className: 'bg-gray-100 text-gray-500' },
  };
  const { label, className } = config[status] || config.pending;
  
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full ${className}`}>
      {label}
    </span>
  );
}

// ============================================
// 单个任务卡片
// ============================================

interface TaskCardProps {
  task: AITaskResponse;
  onAddToProject: (taskId: string) => void;
  addedTaskIds: Set<string>;
}

function TaskCard({ task, onAddToProject, addedTaskIds }: TaskCardProps) {
  const config = TASK_TYPE_CONFIG[task.task_type];
  const isImage = ['image_generation', 'omni_image'].includes(task.task_type);
  const isCompleted = task.status === 'completed';
  const isAdded = addedTaskIds.has(task.task_id);
  
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-gray-300 transition-colors">
      {/* 预览区域 */}
      <div className="aspect-video bg-gray-100 relative overflow-hidden">
        {task.output_url && isCompleted ? (
          isImage ? (
            <img 
              src={task.output_url} 
              alt={config?.label}
              className="w-full h-full object-cover"
            />
          ) : (
            <video 
              src={task.output_url}
              className="w-full h-full object-cover"
              muted
              loop
              onMouseEnter={(e) => e.currentTarget.play()}
              onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {task.status === 'processing' ? (
              <div className="text-center">
                <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
                <span className="text-sm text-gray-500">{task.progress}%</span>
              </div>
            ) : task.status === 'failed' ? (
              <XCircle size={24} className="text-red-400" />
            ) : (
              <Clock size={24} className="text-gray-400" />
            )}
          </div>
        )}
        
        {/* 类型标签 */}
        <div className="absolute top-2 left-2">
          <span className={`px-2 py-1 text-xs font-medium rounded-md bg-black/60 text-white`}>
            {config?.label || task.task_type}
          </span>
        </div>
        
        {/* 状态标签 */}
        <div className="absolute top-2 right-2">
          <StatusBadge status={task.status} />
        </div>
      </div>
      
      {/* 信息区域 */}
      <div className="p-3 space-y-2">
        <div className="text-xs text-gray-500">
          {new Date(task.created_at).toLocaleString()}
        </div>
        
        {/* 操作按钮 */}
        {isCompleted && task.output_url && (
          <div className="flex gap-2">
            <a
              href={task.output_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-700 transition-colors"
            >
              <ExternalLink size={12} />
              预览
            </a>
            <a
              href={task.output_url}
              download
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-700 transition-colors"
            >
              <Download size={12} />
              下载
            </a>
            {isAdded ? (
              <div className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-green-100 rounded-lg text-xs text-green-700">
                <CheckCircle size={12} />
                已添加
              </div>
            ) : (
              <button
                onClick={() => onAddToProject(task.task_id)}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-violet-500 hover:bg-violet-600 rounded-lg text-xs text-white transition-colors"
              >
                <FolderPlus size={12} />
                添加
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// 主组件
// ============================================

export function AICreationsView() {
  const [tasks, setTasks] = useState<AITaskResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AITaskStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  
  // 项目选择相关
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [addingToProject, setAddingToProject] = useState(false);
  const [addedTaskIds, setAddedTaskIds] = useState<Set<string>>(new Set());

  // 加载任务列表
  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getAITaskList({
        status: statusFilter || undefined,
        task_type: typeFilter || undefined,
        page_size: 50,
      });
      setTasks(response.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

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

  // 处理添加到项目
  const handleAddToProject = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setShowProjectSelector(true);
    if (projects.length === 0) {
      loadProjects();
    }
  }, [projects.length, loadProjects]);

  // 确认添加到项目
  const confirmAddToProject = useCallback(async (projectId: string) => {
    if (!selectedTaskId || addingToProject) return;
    
    setAddingToProject(true);
    try {
      const result = await addAITaskToProject(selectedTaskId, projectId);
      if (result.success) {
        setAddedTaskIds(prev => new Set(prev).add(selectedTaskId));
        setShowProjectSelector(false);
        setSelectedTaskId(null);
      }
    } catch (err) {
      console.error('添加到项目失败:', err);
    } finally {
      setAddingToProject(false);
    }
  }, [selectedTaskId, addingToProject]);

  // 统计数据
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const processingCount = tasks.filter(t => t.status === 'processing').length;

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">AI 创作</h1>
              <p className="text-sm text-gray-500">
                {completedCount} 个完成 · {processingCount} 个处理中
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* 筛选器 */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AITaskStatus | '')}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">全部状态</option>
              <option value="completed">已完成</option>
              <option value="processing">处理中</option>
              <option value="pending">等待中</option>
              <option value="failed">失败</option>
            </select>
            
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">全部类型</option>
              {Object.entries(TASK_TYPE_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
            
            <button
              onClick={loadTasks}
              disabled={loading}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin text-gray-400' : 'text-gray-600'} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={32} className="animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <XCircle size={48} className="text-red-400 mb-4" />
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={loadTasks}
              className="px-4 py-2 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-sm"
            >
              重试
            </button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Sparkles size={48} className="text-gray-300 mb-4" />
            <p className="text-gray-600 mb-2">暂无 AI 创作</p>
            <p className="text-sm text-gray-400">
              使用 Rabbit Hole 生成视频或图片后，会在这里显示
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tasks.map((task) => (
              <TaskCard
                key={task.task_id}
                task={task}
                onAddToProject={handleAddToProject}
                addedTaskIds={addedTaskIds}
              />
            ))}
          </div>
        )}
      </div>

      {/* 项目选择弹窗 */}
      {showProjectSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-96 max-h-[60vh] overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">选择项目</h3>
              <button
                onClick={() => { setShowProjectSelector(false); setSelectedTaskId(null); }}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
              >
                <XCircle size={18} className="text-gray-400" />
              </button>
            </div>
            
            <div className="max-h-80 overflow-y-auto">
              {loadingProjects ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-gray-400" />
                </div>
              ) : projects.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  暂无项目
                </div>
              ) : (
                <div className="py-2">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => confirmAddToProject(project.id)}
                      disabled={addingToProject}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-3 disabled:opacity-50"
                    >
                      <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                        <Video size={16} className="text-gray-600" />
                      </div>
                      <span className="text-sm text-gray-900">{project.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
