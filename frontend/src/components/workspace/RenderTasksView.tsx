'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ListTodo,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  Trash2,
  Filter,
  X,
  Play,
  Video,
  Image as ImageIcon,
  Wand2,
  Mic,
  Film,
  LucideIcon,
} from 'lucide-react';
import { authFetch } from '@/lib/supabase/session';

// 简单的 cn 函数
function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ');
}

// ==================== 类型定义 ====================

interface RenderTask {
  id: string;
  task_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  status_message?: string;
  error_message?: string;
  output_url?: string;
  output_asset_id?: string;
  asset_id?: string;
  clip_id?: string;
  project_id?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

// 任务类型配置
const TASK_TYPE_CONFIG: Record<string, { label: string; icon: LucideIcon }> = {
  'background_replace': { label: '视频生成', icon: Video },
  'lip_sync': { label: '口型同步', icon: Mic },
  'text_to_video': { label: '文生视频', icon: Wand2 },
  'image_to_video': { label: '图生视频', icon: Film },
  'multi_image_to_video': { label: '多图生视频', icon: Film },
  'motion_control': { label: '动作控制', icon: Play },
  'video_extend': { label: '视频延长', icon: Clock },
  'image_generation': { label: '图片生成', icon: ImageIcon },
  'omni_image': { label: '图像编辑', icon: ImageIcon },
  'face_swap': { label: '换脸', icon: Wand2 },
};

// 状态配置
const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: LucideIcon }> = {
  'pending': { label: '排队中', color: 'text-gray-600', bgColor: 'bg-gray-100', icon: Clock },
  'processing': { label: '处理中', color: 'text-gray-600', bgColor: 'bg-gray-50', icon: Loader2 },
  'completed': { label: '已完成', color: 'text-gray-600', bgColor: 'bg-gray-100', icon: CheckCircle },
  'failed': { label: '失败', color: 'text-red-600', bgColor: 'bg-red-50', icon: XCircle },
  'cancelled': { label: '已取消', color: 'text-gray-500', bgColor: 'bg-gray-50', icon: X },
};

// ==================== 主组件 ====================

export function RenderTasksView() {
  const [tasks, setTasks] = useState<RenderTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 缓存已加载的任务详情（含 input_params）
  const [taskDetails, setTaskDetails] = useState<Record<string, Record<string, unknown>>>({});

  // 获取任务列表（轻量查询，不含 input_params）
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (filterStatus !== 'all') {
        params.set('status', filterStatus);
      }
      if (filterType !== 'all') {
        params.set('task_type', filterType);
      }

      const response = await authFetch(`/api/tasks?${params.toString()}`);
      if (!response.ok) {
        throw new Error('获取任务列表失败');
      }

      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取任务失败');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterType]);

  // 按需加载任务详情（含 input_params，用于 hover 显示）
  const loadTaskDetail = useCallback(async (taskId: string) => {
    if (taskDetails[taskId]) return; // 已缓存
    try {
      const response = await authFetch(`/api/tasks/${taskId}`);
      if (response.ok) {
        const data = await response.json();
        setTaskDetails(prev => ({
          ...prev,
          [taskId]: data.input_params || {},
        }));
      }
    } catch {
      // 静默失败
    }
  }, [taskDetails]);

  // 初始加载
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // 自动刷新（有进行中的任务时）
  useEffect(() => {
    const hasProcessing = tasks.some(t => t.status === 'pending' || t.status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [tasks, fetchTasks]);

  // 删除任务
  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('确定要删除这个任务吗？')) return;

    setDeletingId(taskId);
    try {
      const response = await authFetch(`/api/kling/ai-task/${taskId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setTasks(prev => prev.filter(t => t.id !== taskId));
      } else {
        throw new Error('删除失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  // 筛选任务（只需对 filterType 二次筛选，filterStatus 已在服务端处理）
  const filteredTasks = filterType === 'all'
    ? tasks
    : tasks.filter(task => task.task_type === filterType);

  // 获取已出现的任务类型列表
  const taskTypes = Array.from(new Set(tasks.map(t => t.task_type)));

  // 统计
  const stats = {
    total: tasks.length,
    processing: tasks.filter(t => t.status === 'pending' || t.status === 'processing').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  };

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListTodo size={24} />
            生成任务
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            查看所有 AI 生成任务的状态和结果
          </p>
        </div>
        <button
          onClick={fetchTasks}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-500">全部任务</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-600">进行中</p>
          <p className="text-2xl font-bold text-gray-700 mt-1">{stats.processing}</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-600">已完成</p>
          <p className="text-2xl font-bold text-gray-700 mt-1">{stats.completed}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-600">失败</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{stats.failed}</p>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-3 mb-6">
        <Filter size={16} className="text-gray-400" />
        
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:border-gray-400 bg-white"
        >
          <option value="all">全部状态</option>
          <option value="pending">排队中</option>
          <option value="processing">处理中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:border-gray-400 bg-white"
        >
          <option value="all">全部类型</option>
          {taskTypes.map(type => (
            <option key={type} value={type}>
              {TASK_TYPE_CONFIG[type]?.label || type}
            </option>
          ))}
        </select>

        <span className="ml-auto text-sm text-gray-500">
          显示 <span className="font-medium text-gray-700">{filteredTasks.length}</span> 个任务
        </span>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 任务列表 */}
      {loading && tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 size={32} className="text-gray-400 animate-spin mb-4" />
          <p className="text-sm text-gray-500">加载中...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
            <ListTodo size={28} className="text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-700 mb-1">暂无任务</h3>
          <p className="text-sm text-gray-500">
            {filterStatus !== 'all' || filterType !== 'all'
              ? '没有找到匹配的任务，试试其他筛选条件'
              : '使用模板生成视频后，任务会显示在这里'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">任务类型</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">状态</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">进度</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">生成参数</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">创建时间</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">详情</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredTasks.map(task => {
                const typeConfig = TASK_TYPE_CONFIG[task.task_type] || { label: task.task_type, icon: Wand2 };
                const statusConfig = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
                const TypeIcon = typeConfig.icon;
                const StatusIcon = statusConfig.icon;

                return (
                  <tr key={task.id} className="hover:bg-gray-50 transition-colors">
                    {/* 任务类型 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <TypeIcon size={16} className="text-gray-500" />
                        <span className="text-sm font-medium text-gray-700">{typeConfig.label}</span>
                      </div>
                    </td>

                    {/* 状态 */}
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                        statusConfig.bgColor,
                        statusConfig.color
                      )}>
                        <StatusIcon size={12} className={task.status === 'processing' ? 'animate-spin' : ''} />
                        {statusConfig.label}
                      </span>
                    </td>

                    {/* 进度 */}
                    <td className="px-4 py-3">
                      {(task.status === 'pending' || task.status === 'processing') ? (
                        <div className="w-24">
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gray-500 rounded-full transition-all"
                              style={{ width: `${task.progress}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{task.progress}%</p>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">—</span>
                      )}
                    </td>

                    {/* 生成参数（hover 时按需加载） */}
                    <td className="px-4 py-3">
                      <div 
                        className="text-xs text-gray-500 space-y-0.5 max-w-[240px] group relative"
                        onMouseEnter={() => loadTaskDetail(task.id)}
                      >
                        {taskDetails[task.id] ? (
                          <>
                            {taskDetails[task.id].model_name != null && (
                              <p><span className="text-gray-400">模型:</span> {String(taskDetails[task.id].model_name)}</p>
                            )}
                            {taskDetails[task.id].duration != null && (
                              <p><span className="text-gray-400">时长:</span> {String(taskDetails[task.id].duration)}s</p>
                            )}
                            {taskDetails[task.id].prompt != null && (
                              <div className="relative">
                                <p className="truncate cursor-pointer text-gray-600 hover:text-gray-800">
                                  <span className="text-gray-400">提示:</span> {String(taskDetails[task.id].prompt).slice(0, 20)}...
                                </p>
                                {/* Hover tooltip */}
                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-xl whitespace-pre-wrap break-words">
                                  <p className="font-medium text-gray-300 mb-1">完整提示词:</p>
                                  <p>{String(taskDetails[task.id].prompt)}</p>
                                  {taskDetails[task.id].negative_prompt != null && (
                                    <>
                                      <p className="font-medium text-gray-300 mt-2 mb-1">负面提示词:</p>
                                      <p>{String(taskDetails[task.id].negative_prompt)}</p>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                            {taskDetails[task.id].template_name != null && (
                              <p><span className="text-gray-400">模板:</span> {String(taskDetails[task.id].template_name)}</p>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-400 cursor-default">悬停查看</span>
                        )}
                      </div>
                    </td>

                    {/* 创建时间 */}
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500">
                        {new Date(task.created_at).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>

                    {/* 详情 */}
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-500 truncate max-w-[200px]" title={task.status_message || task.error_message}>
                        {task.error_message || task.status_message || '—'}
                      </p>
                    </td>

                    {/* 操作 */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {task.output_url ? (
                          <a
                            href={task.output_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                            title="查看结果"
                          >
                            <ExternalLink size={14} className="text-gray-500" />
                          </a>
                        ) : task.status === 'completed' ? (
                          <span className="text-xs text-gray-500" title="output_url 缺失">⚠️</span>
                        ) : null}
                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          disabled={deletingId === task.id}
                          className="p-1.5 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="删除任务"
                        >
                          {deletingId === task.id ? (
                            <Loader2 size={14} className="text-gray-400 animate-spin" />
                          ) : (
                            <Trash2 size={14} className="text-gray-400 hover:text-red-500" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default RenderTasksView;
