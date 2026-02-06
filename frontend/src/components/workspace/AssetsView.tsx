'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import NextLink from 'next/link';
import { RabbitLoader } from '../common/RabbitLoader';
import { TopNav } from '../common/TopNav';
import { 
  Plus,
  Search,
  Grid3X3,
  List,
  Clock,
  MoreVertical,
  Trash2,
  CheckSquare,
  Square,
  CheckCheck,
  FileVideo,
  Play,
  ChevronRight,
  Link,
  Sparkles,
  FileText,
  Upload,
  X,
} from 'lucide-react';
import { useProjectStore, type ProjectRecord } from '@/features/editor/store/project-store';
import { useAuthStore } from '@/features/editor/store/auth-store';
import { useCredits } from '@/lib/hooks/useCredits';
import { useRouter } from 'next/navigation';

// ==================== 调试开关 ====================
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[AssetsView]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[AssetsView]', ...args); };

// 获取 asset stream URL
const getAssetStreamUrl = (assetId: string) => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
  return `${apiUrl}/assets/stream/${assetId}`;
};

// 项目封面组件
interface ProjectThumbnailProps {
  thumbnailUrl?: string;
  thumbnailAssetId?: string;
  projectName: string;
  className?: string;
}

function ProjectThumbnail({ thumbnailUrl, thumbnailAssetId, projectName, className = '' }: ProjectThumbnailProps) {
  const [thumbnail, setThumbnail] = useState<string | null>(thumbnailUrl || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  
  useEffect(() => {
    if (thumbnailUrl || !thumbnailAssetId || thumbnail) return;
    
    setLoading(true);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    
    const handleLoadedData = () => {
      try {
        video.currentTime = 0.1;
      } catch {
        setError(true);
        setLoading(false);
      }
    };
    
    const handleSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setThumbnail(dataUrl);
        }
      } catch (e) {
        debugError('Failed to extract thumbnail:', e);
        setError(true);
      } finally {
        setLoading(false);
        video.src = '';
      }
    };
    
    const handleError = () => {
      debugError('Failed to load video for thumbnail');
      setError(true);
      setLoading(false);
    };
    
    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);
    
    video.src = getAssetStreamUrl(thumbnailAssetId);
    video.load();
    
    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      video.src = '';
    };
  }, [thumbnailUrl, thumbnailAssetId, thumbnail]);
  
  if (thumbnail) {
    return <img src={thumbnail} alt={projectName} className={`w-full h-full object-cover ${className}`} />;
  }
  
  if (loading) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-gray-100 ${className}`}>
        <RabbitLoader size={24} />
      </div>
    );
  }
  
  return (
    <div className={`w-full h-full flex items-center justify-center bg-gray-100 ${className}`}>
      <FileVideo size={32} className="text-gray-400" />
    </div>
  );
}

// ==================== 主组件 ====================
interface AssetsViewProps {
  onCreateProject: () => void;
  activeTab?: 'home' | 'videos';  // 区分首页和视频 tab
  onResumeWorkflow?: (data: {
    sessionId: string;
    projectId: string;
    step: string;
    mode: string;
    // ★★★ 功能开关状态（用于动态步骤恢复）★★★
    enableSmartClip?: boolean;
    enableBroll?: boolean;
  }) => void;
}

export function AssetsView({ onCreateProject, activeTab = 'home', onResumeWorkflow }: AssetsViewProps) {
  const router = useRouter();
  const { projects, fetchProjects, loading, removeProject, removeProjects } = useProjectStore();
  const { isAuthenticated, accessToken, user } = useAuthStore();
  const { credits } = useCredits();
  
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showSummaryDialog, setShowSummaryDialog] = useState(false);
  const [summaryLink, setSummaryLink] = useState('');
  const [summaryFile, setSummaryFile] = useState<File | null>(null);
  const summaryFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAuthenticated && accessToken) {
      fetchProjects(true);
    }
  }, [isAuthenticated, accessToken, fetchProjects]);

  // 根据 activeTab 过滤项目
  const filteredProjects = useMemo(() => {
    if (activeTab === 'videos') {
      // 视频 tab 显示所有项目
      return projects;
    }
    // 首页只显示近一周的项目
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return projects.filter(p => new Date(p.updatedAt || p.createdAt || Date.now()) >= oneWeekAgo);
  }, [projects, activeTab]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProjects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProjects.map(p => p.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchDeleting(true);
    try {
      await removeProjects(Array.from(selectedIds));
      setSelectedIds(new Set());
      setSelectMode(false);
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await removeProject(deleteTarget);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    if (selectMode) {
      toggleSelect(projectId);
      return;
    }
    
    // ★ 检查项目是否有未完成的工作流
    try {
      const { authFetch } = await import('@/lib/supabase/session');
      const response = await authFetch(`/api/workspace/sessions/by-project/${projectId}/workflow-step`);
      
      if (response.ok) {
        const data = await response.json();
        
        // ★ 修复：以 workflow_step 为准，只要不是 "completed" 就显示弹窗
        // status="completed" 只表示上传完成，不是工作流完成
        if (data.workflow_step && data.workflow_step !== 'completed') {
          // 调用恢复工作流回调
          if (onResumeWorkflow) {
            onResumeWorkflow({
              sessionId: data.session_id,
              projectId: data.project_id || projectId,
              step: data.workflow_step,
              mode: data.entry_mode || 'refine',
              // ★★★ 传递开关状态用于动态步骤恢复 ★★★
              enableSmartClip: data.enable_smart_clip,
              enableBroll: data.enable_broll,
            });
            return;
          }
        }
      }
    } catch (err) {
      debugLog('检查工作流状态失败，直接进入编辑器:', err);
    }
    
    // 没有未完成的工作流，直接进入编辑器
    router.push(`/editor?project=${projectId}`);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  return (
    <div className="flex-1 flex flex-col bg-[#FAFAFA]">
      {/* 通用顶部导航栏 */}
      <TopNav
        showSearch={true}
        searchPlaceholder="Search"
        rightActions={
          <button
            onClick={onCreateProject}
            className="h-8 px-4 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            Create
          </button>
        }
      />

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1400px] mx-auto p-8">
          {/* Create Cards - 多入口 */}
          <div className="grid grid-cols-2 gap-4 mb-10">
            {/* 创建视频 */}
            <button
              onClick={onCreateProject}
              className="flex items-center space-x-3 px-5 py-4 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 hover:border-gray-300 hover:shadow-md transition-all duration-200 text-left group"
            >
              <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Plus size={20} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">创建视频</h3>
                <p className="text-xs text-gray-500 mt-0.5">上传素材，可选择 AI 智能处理</p>
              </div>
            </button>

            {/* AI 内容总结 */}
            <button
              onClick={() => setShowSummaryDialog(true)}
              className="flex items-center space-x-3 px-5 py-4 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 hover:border-gray-300 hover:shadow-md transition-all duration-200 text-left group"
            >
              <div className="w-10 h-10 rounded-lg bg-gray-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                <FileText size={20} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">AI 内容总结</h3>
                <p className="text-xs text-gray-500 mt-0.5">输入链接或上传文档，智能提炼核心观点</p>
              </div>
            </button>
          </div>

          {/* My Recents Section */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-4">
                <h2 className="text-xl font-bold text-gray-900">
                  {activeTab === 'home' ? 'My recents' : '所有视频'}
                </h2>
                
                {/* View Toggle */}
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <Grid3X3 size={16} />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <List size={16} />
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {/* Batch Mode */}
                {!selectMode ? (
                  <button
                    onClick={() => setSelectMode(true)}
                    className="h-8 px-3 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    批量管理
                  </button>
                ) : (
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={toggleSelectAll}
                      className="h-8 px-3 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center space-x-1.5"
                    >
                      <CheckCheck size={16} />
                      <span>{selectedIds.size === filteredProjects.length ? '取消全选' : '全选'}</span>
                    </button>
                    <button
                      onClick={handleBatchDelete}
                      disabled={selectedIds.size === 0 || isBatchDeleting}
                      className="h-8 px-3 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors flex items-center space-x-1.5 disabled:opacity-50"
                    >
                      {isBatchDeleting ? <RabbitLoader size={16} /> : <Trash2 size={16} />}
                      <span>删除 ({selectedIds.size})</span>
                    </button>
                    <button
                      onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
                      className="h-8 px-3 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Projects Grid/List */}
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RabbitLoader size={64} />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <div className="w-24 h-24 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                  <FileVideo size={40} className="text-gray-300" />
                </div>
                <p className="text-lg font-medium text-gray-600 mb-1">
                  {activeTab === 'home' ? '近一周无编辑记录' : '还没有视频'}
                </p>
                <p className="text-sm text-gray-400">
                  {activeTab === 'home' ? '创建新项目或查看所有视频' : '这里将显示你所有的视频项目'}
                </p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    selectMode={selectMode}
                    isSelected={selectedIds.has(project.id)}
                    onToggleSelect={() => toggleSelect(project.id)}
                    onClick={() => handleOpenProject(project.id)}
                    onDelete={() => { setDeleteTarget(project.id); setShowDeleteConfirm(true); }}
                    formatTime={formatTime}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredProjects.map((project) => (
                  <ProjectListItem
                    key={project.id}
                    project={project}
                    selectMode={selectMode}
                    isSelected={selectedIds.has(project.id)}
                    onToggleSelect={() => toggleSelect(project.id)}
                    onClick={() => handleOpenProject(project.id)}
                    onDelete={() => { setDeleteTarget(project.id); setShowDeleteConfirm(true); }}
                    formatTime={formatTime}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 w-[400px] shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">确认删除</h3>
            <p className="text-gray-500 text-sm mb-6">删除后项目将无法恢复，确定要删除吗？</p>
            <div className="flex space-x-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}
                className="flex-1 h-10 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={isDeleting}
                className="flex-1 h-10 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
              >
                {isDeleting ? <RabbitLoader size={18} /> : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 内容总结弹窗 */}
      {showSummaryDialog && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-2xl w-[480px] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">AI 内容总结</h3>
              <button
                onClick={() => {
                  setShowSummaryDialog(false);
                  setSummaryLink('');
                  setSummaryFile(null);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* 链接输入 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  输入链接
                </label>
                <div className="relative">
                  <Link size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="url"
                    value={summaryLink}
                    onChange={(e) => setSummaryLink(e.target.value)}
                    placeholder="粘贴 YouTube / Bilibili / 文章链接..."
                    className="w-full h-11 pl-10 pr-4 bg-gray-50 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {/* 分隔线 */}
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-gray-200"></div>
                <span className="text-xs text-gray-400">或</span>
                <div className="flex-1 h-px bg-gray-200"></div>
              </div>

              {/* 文件上传 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  上传文档
                </label>
                <input
                  ref={summaryFileInputRef}
                  type="file"
                  accept=".txt,.md,.pdf,.doc,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setSummaryFile(file);
                  }}
                />
                <button
                  onClick={() => summaryFileInputRef.current?.click()}
                  className="w-full h-24 border-2 border-dashed border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-all flex flex-col items-center justify-center gap-2"
                >
                  {summaryFile ? (
                    <>
                      <FileText size={24} className="text-gray-600" />
                      <span className="text-sm text-gray-700 font-medium">{summaryFile.name}</span>
                      <span className="text-xs text-gray-400">点击更换文件</span>
                    </>
                  ) : (
                    <>
                      <Upload size={24} className="text-gray-400" />
                      <span className="text-sm text-gray-500">点击上传文档</span>
                      <span className="text-xs text-gray-400">支持 TXT、MD、PDF、Word</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="flex space-x-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => {
                  setShowSummaryDialog(false);
                  setSummaryLink('');
                  setSummaryFile(null);
                }}
                className="flex-1 h-10 bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 font-medium rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                disabled={!summaryLink && !summaryFile}
                onClick={() => {
                  // TODO: 调用 AI 总结接口
                  debugLog('Generate summary:', { link: summaryLink, file: summaryFile?.name });
                  setShowSummaryDialog(false);
                  setSummaryLink('');
                  setSummaryFile(null);
                }}
                className="flex-1 h-10 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles size={16} />
                开始总结
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 项目卡片组件 ====================
interface ProjectCardProps {
  project: ProjectRecord;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onDelete: () => void;
  formatTime: (dateStr: string) => string;
}

function ProjectCard({ project, selectMode, isSelected, onToggleSelect, onClick, onDelete, formatTime }: ProjectCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  return (
    <div
      onClick={onClick}
      className={`group relative bg-white border rounded-xl cursor-pointer transition-all duration-200 hover:border-gray-300 hover:shadow-lg
        ${isSelected ? 'border-gray-800 ring-2 ring-gray-800/20' : 'border-gray-200'}`}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-gray-100 relative rounded-t-xl overflow-hidden">
        <ProjectThumbnail 
          thumbnailUrl={project.thumbnailUrl} 
          thumbnailAssetId={project.thumbnailAssetId}
          projectName={project.name} 
        />
        
        {/* Select Checkbox */}
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
        
        {/* Duration Badge */}
        {project.duration && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm rounded text-xs text-white font-medium">
            {Math.floor(project.duration / 1000 / 60)}:{String(Math.floor((project.duration / 1000) % 60)).padStart(2, '0')}
          </div>
        )}

        {/* Hover Play Button */}
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
            <Play size={20} className="text-gray-900 ml-1" fill="currentColor" />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-900 truncate">{project.name}</h3>
            <p className="text-xs text-gray-500 mt-1 flex items-center">
              <span>编辑于 {formatTime(project.updatedAt)}</span>
            </p>
          </div>
          
          {/* Menu */}
          {!selectMode && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <MoreVertical size={16} />
              </button>
              
              {showMenu && (
                <div className="absolute top-full right-0 mt-1 py-1 bg-white border border-gray-200 rounded-lg shadow-xl min-w-[120px] z-50">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete(); }}
                    className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2"
                  >
                    <Trash2 size={14} />
                    <span>删除</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== 项目列表项组件 ====================
interface ProjectListItemProps {
  project: ProjectRecord;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onDelete: () => void;
  formatTime: (dateStr: string) => string;
}

function ProjectListItem({ project, selectMode, isSelected, onToggleSelect, onClick, onDelete, formatTime }: ProjectListItemProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center space-x-4 p-3 bg-white border rounded-xl cursor-pointer transition-all duration-200 hover:border-gray-300 hover:shadow-md
        ${isSelected ? 'border-gray-800 ring-2 ring-gray-800/20' : 'border-gray-200'}`}
    >
      {/* Checkbox */}
      {selectMode && (
        <div onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}>
          {isSelected ? (
            <CheckSquare size={20} className="text-gray-800" />
          ) : (
            <Square size={20} className="text-gray-400" />
          )}
        </div>
      )}

      {/* Thumbnail */}
      <div className="w-24 h-14 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
        <ProjectThumbnail 
          thumbnailUrl={project.thumbnailUrl} 
          thumbnailAssetId={project.thumbnailAssetId}
          projectName={project.name} 
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-gray-900 truncate">{project.name}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{formatTime(project.updatedAt)}</p>
      </div>

      {/* Delete */}
      {!selectMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}
