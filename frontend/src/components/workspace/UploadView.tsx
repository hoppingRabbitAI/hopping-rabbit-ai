'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { RabbitLoader } from '../common/RabbitLoader';
import { 
  Upload, 
  ChevronRight, 
  FileVideo, 
  Youtube, 
  Clock,
  Sparkles,
  MoreHorizontal,
  Filter,
  History as HistoryIcon,
  X,
  Trash2,
  CheckSquare,
  Square,
  CheckCheck
} from 'lucide-react';

// ==================== 调试开关 ====================
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log(...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };
import { useProjectStore, type ProjectRecord } from '@/features/editor/store/project-store';
import { useRouter } from 'next/navigation';

interface UploadViewProps {
  onComplete: (type: 'file' | 'link', data: { file?: File; link?: string }) => void;
}

export function UploadView({ onComplete }: UploadViewProps) {
  const [link, setLink] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { projects, fetchProjects, loading } = useProjectStore();
  
  // 初始化时获取项目列表
  useEffect(() => {
    fetchProjects();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file && (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm|avi|mkv)$/i))) {
      setUploadingFile(file);
      onComplete('file', { file });
    }
  }, [onComplete]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadingFile(file);
      onComplete('file', { file });
    }
  }, [onComplete]);

  const handleLinkSubmit = useCallback(() => {
    if (link.trim()) {
      onComplete('link', { link: link.trim() });
    }
  }, [link, onComplete]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && link.trim()) {
      handleLinkSubmit();
    }
  }, [link, handleLinkSubmit]);

  return (
    <div className="w-full max-w-5xl space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* 顶部上传区域 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 本地上传卡片 */}
        <div 
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`group relative h-48 bg-white border rounded-3xl flex items-center p-8 space-x-6 cursor-pointer transition-all duration-500 overflow-hidden shadow-sm
            ${isDragging 
              ? 'border-gray-800 bg-gray-50 scale-[1.02]' 
              : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
            }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mp4,.mov,.webm,.avi,.mkv"
            className="hidden"
            onChange={handleFileSelect}
          />
          
          <div className="absolute inset-0 bg-gradient-to-br from-gray-100/0 to-gray-100/30 opacity-0 group-hover:opacity-100 transition-opacity" />
          
          <div className={`w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center transition-all duration-500 flex-none border border-gray-100
            ${isDragging ? 'text-gray-800 scale-110' : 'text-gray-400 group-hover:text-gray-800 group-hover:scale-110'}`}
          >
            <Upload size={28} />
          </div>
          
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900 group-hover:text-gray-700">上传本地视频</h3>
            <p className="text-xs text-gray-500 mt-1">支持 MP4, MOV, WebM (最大 2GB)</p>
            <div className="mt-4 flex items-center space-x-2 text-[10px] font-bold text-gray-600 opacity-0 group-hover:opacity-100 transition-all">
              <span>立即上传并定制 AI 计划</span>
              <ChevronRight size={12} />
            </div>
          </div>
        </div>

        {/* YouTube 链接解析卡片 */}
        <div className="h-48 bg-white border border-gray-200 rounded-3xl p-8 flex items-center space-x-6 hover:border-red-300 transition-all duration-500 group shadow-sm">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 group-focus-within:text-red-500 transition-colors flex-none border border-gray-100">
            <Youtube size={28} />
          </div>
          
          <div className="flex-1 space-y-3">
            <div>
              <h3 className="text-lg font-bold text-gray-900">YouTube 链接解析</h3>
              <p className="text-xs text-gray-500">粘贴 URL 自动下载并识别字幕</p>
            </div>
            
            <div className="flex items-center space-x-2">
              <input 
                type="text" 
                placeholder="https://youtube.com/watch?v=..."
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl py-2 px-4 text-xs text-gray-900 outline-none focus:border-gray-400 focus:bg-white transition-all placeholder:text-gray-400"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button 
                onClick={handleLinkSubmit}
                disabled={!link.trim()}
                className="bg-gray-800 hover:bg-gray-700 disabled:opacity-20 disabled:cursor-not-allowed px-3 py-2 rounded-xl text-white transition-all active:scale-90"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 历史记录板块 */}
      <ProjectHistory projects={projects} loading={loading} />
    </div>
  );
}

// 项目历史记录组件
function ProjectHistory({ projects, loading }: { projects: ProjectRecord[]; loading: boolean }) {
  const { removeProjects } = useProjectStore();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // 退出选择模式时清空选择
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // 切换单个项目选择
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
    if (selectedIds.size === projects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(projects.map(p => p.id)));
    }
  };

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    
    setBatchDeleting(true);
    try {
      const result = await removeProjects(Array.from(selectedIds));
      debugLog(`批量删除完成: 成功 ${result.success}，失败 ${result.failed}`);
      setShowBatchDeleteConfirm(false);
      exitSelectMode();
    } catch (error) {
      debugError('批量删除失败:', error);
    } finally {
      setBatchDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 pt-4">
        <div className="flex items-center space-x-3 border-b border-gray-200 pb-4">
          <HistoryIcon size={18} className="text-gray-600" />
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">项目历史记录</h2>
        </div>
        <div className="text-center py-12">
          <RabbitLoader size={64} className="mx-auto" />
          <p className="text-sm text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }
  
  if (projects.length === 0) {
    return (
      <div className="space-y-6 pt-4">
        <div className="flex items-center space-x-3 border-b border-gray-200 pb-4">
          <HistoryIcon size={18} className="text-gray-600" />
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">项目历史记录</h2>
        </div>
        
        <div className="text-center py-12">
          <div className="inline-flex w-16 h-16 bg-gray-100 rounded-2xl items-center justify-center mb-4">
            <FileVideo size={28} className="text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">暂无历史项目</p>
          <p className="text-xs text-gray-400 mt-1">上传视频或解析链接开始您的第一个项目</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between border-b border-gray-200 pb-4">
        <div className="flex items-center space-x-3">
          <HistoryIcon size={18} className="text-gray-600" />
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">项目历史记录</h2>
          <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-mono">
            {projects.length}
          </span>
        </div>
        <div className="flex items-center space-x-4">
          {selectMode ? (
            <>
              {/* 选择模式工具栏 */}
              <button 
                onClick={toggleSelectAll}
                className="text-[10px] text-gray-500 hover:text-gray-900 flex items-center space-x-1 font-bold uppercase transition-colors"
              >
                <CheckCheck size={12} />
                <span>{selectedIds.size === projects.length ? '取消全选' : '全选'}</span>
              </button>
              <button 
                onClick={() => selectedIds.size > 0 && setShowBatchDeleteConfirm(true)}
                disabled={selectedIds.size === 0}
                className="text-[10px] text-red-500 hover:text-red-600 flex items-center space-x-1 font-bold uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={12} />
                <span>删除 ({selectedIds.size})</span>
              </button>
              <button 
                onClick={exitSelectMode}
                className="text-[10px] text-gray-500 hover:text-gray-900 font-bold uppercase transition-colors"
              >
                取消
              </button>
            </>
          ) : (
            <>
              {/* 正常模式工具栏 */}
              <button 
                onClick={() => setSelectMode(true)}
                className="text-[10px] text-gray-500 hover:text-gray-900 flex items-center space-x-1 font-bold uppercase transition-colors"
              >
                <CheckSquare size={12} />
                <span>批量管理</span>
              </button>
              <button className="text-[10px] text-gray-500 hover:text-gray-900 flex items-center space-x-1 font-bold uppercase transition-colors">
                <Filter size={12} />
                <span>筛选</span>
              </button>
              <button className="text-[10px] text-gray-600 hover:text-gray-800 font-bold uppercase transition-colors">
                查看全部
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {projects.map((project) => (
          <ProjectCard 
            key={project.id} 
            project={project}
            selectMode={selectMode}
            isSelected={selectedIds.has(project.id)}
            onToggleSelect={() => toggleSelect(project.id)}
          />
        ))}
      </div>

      {/* 底部提示 */}
      <div className="pt-4 text-center">
        <p className="text-[10px] text-gray-400 font-medium">
          所有历史文件都会通过 <span className="text-gray-500">AES-256</span> 加密安全保存，仅您可见。
        </p>
      </div>

      {/* 批量删除确认弹窗 */}
      {showBatchDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-base font-bold text-gray-900 mb-2">确认批量删除</h3>
            <p className="text-sm text-gray-500 mb-6">
              确定要删除选中的 <span className="text-red-500 font-bold">{selectedIds.size}</span> 个项目吗？此操作将删除所有关联数据，且无法恢复。
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 transition-colors"
                disabled={batchDeleting}
              >
                取消
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
              >
                {batchDeleting ? (
                  <>
                    <RabbitLoader size={14} />
                    <span>删除中...</span>
                  </>
                ) : (
                  <span>确认删除</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 单个项目卡片
interface ProjectCardProps {
  project: ProjectRecord;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

function ProjectCard({ project, selectMode = false, isSelected = false, onToggleSelect }: ProjectCardProps) {
  const router = useRouter();
  const { removeProject } = useProjectStore();
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  const statusColors: Record<string, string> = {
    draft: 'bg-gray-500/10 text-gray-400',
    processing: 'bg-gray-600/10 text-gray-500',
    completed: 'bg-green-500/10 text-green-500',
    archived: 'text-gray-700',
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await removeProject(project.id);
      setShowDeleteConfirm(false);
    } catch (error) {
      debugError('删除失败:', error);
    } finally {
      setDeleting(false);
    }
  };
  
  const handleCardClick = () => {
    // 选择模式下点击卡片切换选中状态
    if (selectMode) {
      onToggleSelect?.();
      return;
    }
    // 所有非归档状态都可以进入编辑器
    if (project.status !== 'archived') {
      router.push(`/editor?project=${project.id}`);
    }
  };

  return (
    <>
    <div 
      className={`group bg-white border rounded-2xl p-4 flex items-center justify-between hover:bg-gray-50 transition-all cursor-pointer shadow-sm ${
        isSelected 
          ? 'border-gray-800 bg-gray-50' 
          : 'border-gray-200 hover:border-gray-300'
      }`}
      onClick={handleCardClick}
    >
      <div className="flex items-center space-x-4 flex-1 min-w-0">
        {/* 选择模式下显示勾选框 */}
        {selectMode && (
          <div 
            className="flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.();
            }}
          >
            {isSelected ? (
              <div className="w-5 h-5 rounded bg-gray-800 flex items-center justify-center">
                <CheckSquare size={14} className="text-white" />
              </div>
            ) : (
              <div className="w-5 h-5 rounded border border-gray-300 hover:border-gray-400 flex items-center justify-center transition-colors">
                <Square size={14} className="text-gray-400" />
              </div>
            )}
          </div>
        )}
        
        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-gray-100 text-gray-600">
          <FileVideo size={20} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <h4 className="text-sm font-bold text-gray-900 truncate">{project.name}</h4>
            {project.status === 'processing' && (
              <span className="flex items-center space-x-1 text-[8px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-black uppercase animate-pulse">
                <RabbitLoader size={8} />
                <span>处理中</span>
              </span>
            )}
          </div>
          
          <div className="flex items-center space-x-3 mt-1 text-[10px] text-gray-500 font-medium">
            <span className="flex items-center space-x-1">
              <Clock size={10} />
              <span>{formatDuration(project.duration)}</span>
            </span>
            <span>•</span>
            <span className="flex items-center space-x-1">
              <Sparkles size={10} className="text-gray-600" />
              <span>AI Clips</span>
            </span>
            <span>•</span>
            <span>{new Date(project.createdAt || project.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* 选择模式下隐藏右侧操作按钮 */}
      {!selectMode && (
        <div className="flex items-center space-x-3 ml-4" onClick={(e) => e.stopPropagation()}>
          {project.status === 'completed' ? (
            <button 
              className="px-4 py-1.5 bg-gray-100 hover:bg-gray-800 hover:text-white border border-gray-200 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all text-gray-700"
              onClick={() => router.push(`/editor?project=${project.id}`)}
            >
              查看结果
            </button>
          ) : project.status === 'archived' ? (
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest px-4">已归档</span>
          ) : null}
          
          {/* 更多操作下拉菜单 */}
          <div className="relative">
            <button 
              className="p-2 text-gray-400 hover:text-gray-900 transition-colors"
              onClick={() => setShowMenu(!showMenu)}
            >
              <MoreHorizontal size={16} />
            </button>
            
            {showMenu && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
                  <button
                    onClick={() => {
                      router.push(`/editor?project=${project.id}`);
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-100 flex items-center space-x-2 transition-colors"
                  >
                    <span>打开编辑器</span>
                  </button>
                  <button
                    onClick={() => {
                    setShowDeleteConfirm(true);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left text-xs text-red-500 hover:bg-red-50 flex items-center space-x-2 transition-colors"
                >
                  <X size={12} />
                  <span>删除项目</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </div>
    
    {/* 删除确认弹窗 */}
    {showDeleteConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
          <h3 className="text-base font-bold text-gray-900 mb-2">确认删除</h3>
          <p className="text-sm text-gray-500 mb-6">
            确定要删除项目「{project.name}」吗？此操作将删除所有关联数据，且无法恢复。
          </p>
          <div className="flex space-x-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 transition-colors"
              disabled={deleting}
            >
              取消
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              {deleting ? (
                <>
                  <RabbitLoader size={14} />
                  <span>删除中...</span>
                </>
              ) : (
                <span>确认删除</span>
              )}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
