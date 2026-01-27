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
  CheckSquare,
  Square,
  CheckCheck,
  Play,
  Plus
} from 'lucide-react';
import { 
  getAITaskList, 
  addAITaskToProject,
  batchDeleteAITasks,
  AITaskResponse,
  AITaskStatus,
  AITaskType 
} from '@/features/editor/lib/rabbit-hole-api';
import { projectApi } from '@/lib/api';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { toast } from '@/lib/stores/toast-store';

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
// 单个任务卡片 - 复用首页 ProjectCard 样式
// ============================================

interface TaskCardProps {
  task: AITaskResponse;
  onAddToProject: (taskId: string) => void;
  addedTaskIds: Set<string>;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
}

function TaskCard({ task, onAddToProject, addedTaskIds, selectMode, isSelected, onToggleSelect }: TaskCardProps) {
  const config = TASK_TYPE_CONFIG[task.task_type];
  const isImage = ['image_generation', 'omni_image'].includes(task.task_type);
  const isCompleted = task.status === 'completed';
  const isAdded = addedTaskIds.has(task.id);
  
  const handleCardClick = (e: React.MouseEvent) => {
    if (selectMode) {
      e.preventDefault();
      onToggleSelect();
    }
  };
  
  // 格式化时间
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };
  
  return (
    <div
      onClick={handleCardClick}
      className={`group relative bg-white border rounded-xl cursor-pointer transition-all duration-200 hover:border-gray-300 hover:shadow-lg
        ${isSelected ? 'border-gray-800 ring-2 ring-gray-800/20' : 'border-gray-200'}`}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-gray-100 relative rounded-t-xl overflow-hidden">
        {/* 预览内容 */}
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
              onMouseEnter={(e) => { if (!selectMode) e.currentTarget.play(); }}
              onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
            />
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            {task.status === 'processing' ? (
              <>
                <RabbitLoader size={32} />
                <span className="text-xs text-gray-500 mt-2">{task.progress}%</span>
              </>
            ) : task.status === 'failed' ? (
              <XCircle size={32} className="text-red-400" />
            ) : (
              <>
                <RabbitLoader size={32} />
                <span className="text-xs text-gray-400 mt-2">加载中...</span>
              </>
            )}
          </div>
        )}
        
        {/* Select Checkbox - 复用首页样式 */}
        {selectMode && (
          <div 
            className="absolute top-2 left-2 z-10"
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          >
            {isSelected ? (
              <CheckSquare size={22} className="text-gray-800" />
            ) : (
              <Square size={22} className="text-gray-400 bg-white/80 rounded" />
            )}
          </div>
        )}
        
        {/* 类型标签 */}
        <div className="absolute top-2 right-2">
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-black/70 backdrop-blur-sm text-white">
            {config?.label || task.task_type}
          </span>
        </div>
        
        {/* 状态标签 - 失败时显示 */}
        {task.status === 'failed' && (
          <div className="absolute bottom-2 right-2">
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-500 text-white">
              失败
            </span>
          </div>
        )}
        
        {/* 处理中状态 */}
        {task.status === 'processing' && (
          <div className="absolute bottom-2 right-2">
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-500 text-white">
              处理中 {task.progress}%
            </span>
          </div>
        )}
        
        {/* 等待中状态 */}
        {task.status === 'pending' && (
          <div className="absolute bottom-2 right-2">
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-500 text-white">
              等待中
            </span>
          </div>
        )}

        {/* Hover Play Button - 仅完成状态显示 */}
        {isCompleted && task.output_url && !selectMode && (
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
              <Play size={20} className="text-gray-900 ml-1" fill="currentColor" />
            </div>
          </div>
        )}
      </div>

      {/* Info - 复用首页样式 */}
      <div className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-900 truncate">
              {config?.label || task.task_type}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {formatTime(task.created_at)}
            </p>
          </div>
        </div>
        
        {/* 操作按钮 - 仅完成状态显示 */}
        {isCompleted && task.output_url && !selectMode && (
          <div className="flex gap-2 mt-3">
            <a
              href={task.output_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-700 transition-colors"
            >
              <ExternalLink size={12} />
              预览
            </a>
            {isAdded ? (
              <div className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-green-100 rounded-lg text-xs text-green-700">
                <CheckCircle size={12} />
                已添加
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onAddToProject(task.id); }}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-white transition-colors"
              >
                <FolderPlus size={12} />
                添加到项目
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

export function MyMaterialsView() {
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
  
  // 批量选择相关
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  
  // 确认弹窗状态
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

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
  const confirmAddToProject = useCallback(async (projectId: string | null) => {
    if (!selectedTaskId || addingToProject) return;
    
    setAddingToProject(true);
    try {
      const result = await addAITaskToProject(selectedTaskId, projectId);
      if (result.success) {
        setAddedTaskIds(prev => new Set(prev).add(selectedTaskId));
        setShowProjectSelector(false);
        setSelectedTaskId(null);
        
        // 添加成功后跳转到编辑器页面
        window.location.href = `/editor?project=${result.project_id}`;
      }
    } catch (err) {
      console.error('添加到项目失败:', err);
    } finally {
      setAddingToProject(false);
    }
  }, [selectedTaskId, addingToProject]);

  // 切换选择模式
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => !prev);
    setSelectedTaskIds(new Set());
  }, []);

  // 切换单个任务选择
  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  // 全选/取消全选
  const toggleSelectAll = useCallback(() => {
    if (selectedTaskIds.size === tasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(tasks.map(t => t.id)));
    }
  }, [tasks, selectedTaskIds.size]);

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (selectedTaskIds.size === 0 || deleting) return;
    
    setConfirmDialog({
      open: true,
      title: '确认删除',
      message: `确定要删除选中的 ${selectedTaskIds.size} 个素材吗？此操作不可恢复。`,
      onConfirm: async () => {
        setConfirmDialog(null);
        setDeleting(true);
        try {
          const result = await batchDeleteAITasks(Array.from(selectedTaskIds));
          if (result.success) {
            // 从列表中移除已删除的任务
            setTasks(prev => prev.filter(t => !selectedTaskIds.has(t.id)));
            setSelectedTaskIds(new Set());
            setSelectionMode(false);
          }
        } catch (err) {
          console.error('批量删除失败:', err);
          toast.error('删除失败，请重试');
        } finally {
          setDeleting(false);
        }
      }
    });
  }, [selectedTaskIds, deleting]);

  // 统计数据
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const processingCount = tasks.filter(t => t.status === 'processing').length;

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50">
      {/* 自定义确认弹窗 */}
      {confirmDialog?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/50" 
            onClick={() => setConfirmDialog(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-[360px]">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {confirmDialog.title}
            </h3>
            <p className="text-gray-600 mb-6">
              {confirmDialog.message}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                确定删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header - 简洁版 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">我的素材</h1>
            <p className="text-sm text-gray-500">
              {completedCount} 个完成 · {processingCount} 个处理中
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* 列表标题行 - 参考首页样式 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <h2 className="text-lg font-semibold text-gray-900">全部素材</h2>
            
            {/* 筛选器 */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AITaskStatus | '')}
              className="h-8 px-2 bg-gray-100 border-0 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500"
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
              className="h-8 px-2 bg-gray-100 border-0 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">全部类型</option>
              {Object.entries(TASK_TYPE_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
          </div>
          
          {/* 批量操作 - 复用首页样式 */}
          <div className="flex items-center space-x-2">
            {!selectionMode ? (
              <button
                onClick={toggleSelectionMode}
                className="h-8 px-3 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                批量管理
              </button>
            ) : (
              <>
                <button
                  onClick={toggleSelectAll}
                  className="h-8 px-3 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center space-x-1.5"
                >
                  <CheckCheck size={16} />
                  <span>{selectedTaskIds.size === tasks.length && tasks.length > 0 ? '取消全选' : '全选'}</span>
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={selectedTaskIds.size === 0 || deleting}
                  className="h-8 px-3 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {deleting ? <RabbitLoader size={16} /> : <Trash2 size={16} />}
                  <span>删除 ({selectedTaskIds.size})</span>
                </button>
                <button
                  onClick={() => { setSelectionMode(false); setSelectedTaskIds(new Set()); }}
                  className="h-8 px-3 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
              </>
            )}
          </div>
        </div>
        
        {/* 任务列表 */}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onAddToProject={handleAddToProject}
                addedTaskIds={addedTaskIds}
                selectMode={selectionMode}
                isSelected={selectedTaskIds.has(task.id)}
                onToggleSelect={() => toggleTaskSelection(task.id)}
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
              {/* 新建项目按钮 - 始终显示在最上面 */}
              <button
                onClick={() => confirmAddToProject(null)}
                disabled={addingToProject}
                className="w-full px-4 py-3 text-left hover:bg-violet-50 transition-colors flex items-center gap-3 disabled:opacity-50 border-b border-gray-200"
              >
                <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
                  <Plus size={16} className="text-violet-600" />
                </div>
                <span className="text-sm text-violet-600 font-medium">新建项目并编辑</span>
              </button>
              
              {loadingProjects ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-gray-400" />
                </div>
              ) : projects.length === 0 ? (
                <div className="py-6 text-center text-gray-500 text-sm">
                  暂无其他项目
                </div>
              ) : (
                <div className="py-2">
                  <div className="px-4 py-1.5 text-xs text-gray-400 bg-gray-50">
                    添加到现有项目
                  </div>
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
