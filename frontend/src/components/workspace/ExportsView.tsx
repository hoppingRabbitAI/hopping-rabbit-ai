'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Download, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Loader2,
  RefreshCw,
  FileVideo,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Check
} from 'lucide-react';
import { exportApi } from '@/lib/api/export';

// 后端返回的导出记录类型
interface ExportRecord {
  id: string;
  project_id: string;
  user_id?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  format?: string;
  resolution?: {
    width: number;
    height: number;
  } | null;
  output_path?: string;
  file_size?: number;
  error_message?: string;
  created_at: string;
  updated_at?: string;
  project_name?: string;
}

// 状态图标
function StatusIcon({ status }: { status: ExportRecord['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    case 'failed':
    case 'cancelled':
      return <XCircle className="w-5 h-5 text-red-500" />;
    case 'processing':
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    case 'pending':
    default:
      return <Clock className="w-5 h-5 text-gray-400" />;
  }
}

// 状态文本
function getStatusText(status: ExportRecord['status']): string {
  const statusMap: Record<ExportRecord['status'], string> = {
    pending: '等待中',
    processing: '导出中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return statusMap[status] || status;
}

// 格式化文件大小
function formatFileSize(bytes?: number): string {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// 格式化时间
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ExportsView() {
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 多选状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  
  // 可删除的记录（已完成/失败/已取消）
  const deletableExports = useMemo(() => 
    exports.filter(e => e.status === 'completed' || e.status === 'failed' || e.status === 'cancelled'),
    [exports]
  );
  
  // 全选状态
  const isAllSelected = deletableExports.length > 0 && 
    deletableExports.every(e => selectedIds.has(e.id));
  const hasSelected = selectedIds.size > 0;
  
  // 确认弹窗状态
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // 获取导出列表
  const fetchExports = useCallback(async () => {
    try {
      setError(null);
      const response = await exportApi.getUserExports();
      if (response.error) {
        throw new Error(response.error.message || '获取导出列表失败');
      }
      // 将 API 响应映射到本地类型
      const records: ExportRecord[] = (response.data?.exports || []).map((item: any) => ({
        id: item.id,
        project_id: item.project_id,
        user_id: item.user_id,
        status: item.status,
        progress: item.progress || 0,
        format: item.format,
        resolution: item.resolution,
        output_path: item.output_path || item.output_url,
        file_size: item.file_size || item.output_file_size,
        error_message: item.error_message,
        created_at: item.created_at,
        updated_at: item.updated_at,
        project_name: item.project_name,
      }));
      setExports(records);
    } catch (err) {
      console.error('获取导出列表失败:', err);
      setError('获取导出列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExports();
  }, [fetchExports]);

  // 自动刷新处理中的任务
  useEffect(() => {
    const hasProcessing = exports.some(e => e.status === 'processing' || e.status === 'pending');
    if (!hasProcessing) return;

    const interval = setInterval(fetchExports, 3000);
    return () => clearInterval(interval);
  }, [exports, fetchExports]);

  // 展开的错误信息
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  // 下载文件
  const handleDownload = async (item: ExportRecord) => {
    if (!item.output_path) return;
    
    try {
      const { url } = await exportApi.getDownloadUrl(item.id);
      // 创建临时链接下载
      const link = document.createElement('a');
      link.href = url;
      link.download = `export_${item.id}.${item.format || 'mp4'}`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('获取下载链接失败:', err);
      alert('获取下载链接失败');
    }
  };

  // 取消导出
  const handleCancel = async (item: ExportRecord) => {
    setConfirmDialog({
      open: true,
      title: '取消导出',
      message: '确定要取消这个导出任务吗？',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await exportApi.cancelExport(item.id);
          fetchExports();
        } catch (err) {
          console.error('取消导出失败:', err);
        }
      }
    });
  };

  // 删除记录
  const handleDelete = async (item: ExportRecord) => {
    setConfirmDialog({
      open: true,
      title: '删除记录',
      message: '确定要删除这条导出记录吗？',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await exportApi.deleteExport(item.id);
          setExports(prev => prev.filter(e => e.id !== item.id));
        } catch (err) {
          console.error('删除记录失败:', err);
        }
      }
    });
  };

  // 重试导出
  const [retrying, setRetrying] = useState<string | null>(null);
  
  const handleRetry = async (item: ExportRecord) => {
    try {
      setRetrying(item.id);
      const response = await exportApi.retryExport(item.id);
      if (response.error) {
        throw new Error(response.error.message || '重试失败');
      }
      // 刷新列表以显示新任务
      await fetchExports();
    } catch (err) {
      console.error('重试导出失败:', err);
      alert(err instanceof Error ? err.message : '重试失败');
    } finally {
      setRetrying(null);
    }
  };

  // 切换错误信息展开状态
  const toggleErrorExpand = (id: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 切换单个选中
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deletableExports.map(e => e.id)));
    }
  };

  // 批量删除
  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    
    setConfirmDialog({
      open: true,
      title: '批量删除',
      message: `确定要删除选中的 ${selectedIds.size} 条导出记录吗？`,
      onConfirm: async () => {
        setConfirmDialog(null);
        setIsDeleting(true);
        
        try {
          // 并行删除所有选中的记录
          const deletePromises = Array.from(selectedIds).map(id => 
            exportApi.deleteExport(id).catch(() => ({ failed: id }))
          );
          await Promise.all(deletePromises);
          
          // 更新列表
          setExports(prev => prev.filter(e => !selectedIds.has(e.id)));
          setSelectedIds(new Set());
        } catch (err) {
          console.error('批量删除失败:', err);
        } finally {
          setIsDeleting(false);
        }
      }
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
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
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 头部 */}
      <header className="h-14 px-6 flex items-center justify-between border-b border-gray-200 bg-white">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900">导出记录</h1>
          {/* 批量删除按钮 */}
          {hasSelected && (
            <button
              onClick={handleBatchDelete}
              disabled={isDeleting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:bg-red-300 rounded-lg transition-colors"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              删除 ({selectedIds.size})
            </button>
          )}
        </div>
        <button
          onClick={fetchExports}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-6">
        {error ? (
          <div className="text-center py-12">
            <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
            <p className="text-gray-500">{error}</p>
            <button
              onClick={fetchExports}
              className="mt-4 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              重试
            </button>
          </div>
        ) : exports.length === 0 ? (
          <div className="text-center py-12">
            <FileVideo className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">暂无导出记录</p>
            <p className="text-sm text-gray-400 mt-1">
              在编辑器中导出视频后，记录会显示在这里
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-3">
            {/* 提示信息和全选 */}
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs text-gray-400">
                导出文件将保留 7 天，请及时下载保存
              </div>
              {deletableExports.length > 0 && (
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700"
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    isAllSelected 
                      ? 'bg-gray-900 border-gray-900' 
                      : 'border-gray-300 hover:border-gray-400'
                  }`}>
                    {isAllSelected && <Check size={12} className="text-white" />}
                  </div>
                  全选
                </button>
              )}
            </div>

            {/* 导出列表 */}
            {exports.map((item) => {
              const isDeletable = item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled';
              const isSelected = selectedIds.has(item.id);
              
              return (
              <div
                key={item.id}
                className={`bg-white rounded-xl border p-4 hover:shadow-sm transition-shadow ${
                  isSelected ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* 复选框 - 只有可删除的记录显示 */}
                  {isDeletable ? (
                    <button
                      onClick={() => toggleSelect(item.id)}
                      className="pt-0.5"
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected 
                          ? 'bg-gray-900 border-gray-900' 
                          : 'border-gray-300 hover:border-gray-400'
                      }`}>
                        {isSelected && <Check size={14} className="text-white" />}
                      </div>
                    </button>
                  ) : (
                    <div className="pt-0.5 w-5" />
                  )}

                  {/* 状态图标 */}
                  <div className="pt-0.5">
                    <StatusIcon status={item.status} />
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">
                        {item.project_name || `项目 ${item.project_id.slice(0, 8)}`}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                        {(item.format || 'mp4').toUpperCase()}
                      </span>
                      {item.resolution && (
                        <span className="text-xs text-gray-400">
                          {item.resolution.width}×{item.resolution.height}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                      <span>{getStatusText(item.status)}</span>
                      {item.file_size && (
                        <span>{formatFileSize(item.file_size)}</span>
                      )}
                      <span>{formatTime(item.created_at)}</span>
                    </div>

                    {/* 进度条 */}
                    {item.status === 'processing' && (
                      <div className="mt-2">
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-300"
                            style={{ width: `${item.progress || 0}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {item.progress || 0}%
                        </div>
                      </div>
                    )}

                    {/* 错误信息 - 限制展示 */}
                    {item.status === 'failed' && item.error_message && (
                      <div className="mt-2">
                        <div className="text-sm text-red-500">
                          {expandedErrors.has(item.id) 
                            ? item.error_message 
                            : item.error_message.length > 100 
                              ? item.error_message.slice(0, 100) + '...' 
                              : item.error_message
                          }
                        </div>
                        {item.error_message.length > 100 && (
                          <button
                            onClick={() => toggleErrorExpand(item.id)}
                            className="flex items-center gap-1 mt-1 text-xs text-gray-500 hover:text-gray-700"
                          >
                            {expandedErrors.has(item.id) ? (
                              <><ChevronUp className="w-3 h-3" /> 收起</>
                            ) : (
                              <><ChevronDown className="w-3 h-3" /> 展开详情</>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2">
                    {/* 下载按钮 */}
                    {item.status === 'completed' && item.output_path && (
                      <button
                        onClick={() => handleDownload(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        下载
                      </button>
                    )}
                    {/* 重试按钮 - 仅失败任务显示 */}
                    {item.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(item)}
                        disabled={retrying === item.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 rounded-lg transition-colors"
                      >
                        {retrying === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4" />
                        )}
                        重试
                      </button>
                    )}
                    {/* 取消按钮 */}
                    {(item.status === 'pending' || item.status === 'processing') && (
                      <button
                        onClick={() => handleCancel(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                        取消
                      </button>
                    )}
                    {/* 删除按钮 */}
                    {(item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') && (
                      <button
                        onClick={() => handleDelete(item)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除记录"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
