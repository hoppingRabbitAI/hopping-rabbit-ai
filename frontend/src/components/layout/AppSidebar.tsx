'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Sparkles,
  Compass,
  Layers,
  Image,
  Settings,
  LogOut,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Trash2,
  Pencil,
  PanelLeftClose,
  PanelLeft,
  Search,
  Check,
  X,
  Film,
  UserRound,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore, type ProjectRecord } from '@/stores/projectStore';
import { useCredits } from '@/lib/hooks/useCredits';
import { projectApi } from '@/lib/api';
import { delosTransition } from '@/lib/motion';

/* ================================================================
   AppSidebar — DeepSeek 式侧边栏

   ┌──────────────────────┐
   │  🐰 Lepus  [⊟] [+]  │
   ├──────────────────────┤
   │  🔍 Search           │
   │  Project 列表 (5+5)  │
   │  ▾ Show more         │
   ├──────────────────────┤
   │  🧭 Explore          │
   │  📐 Templates        │
   │  🖼 Assets           │
   ├──────────────────────┤
   │  👤 User · ⚡ 128    │
   │  ⚙ Settings          │
   └──────────────────────┘
   ================================================================ */

export type SidebarNavItem =
  | 'explore'
  | 'templates' | 'templates:videos' | 'templates:avatars' | 'templates:references' | 'templates:prompts'
  | 'assets'
  | null;

const NAV_ITEMS: { key: SidebarNavItem; label: string; icon: React.ElementType }[] = [
  { key: 'explore', label: 'Explore', icon: Compass },
  { key: 'templates', label: 'Templates', icon: Layers },
  { key: 'assets', label: 'Assets', icon: Image },
];

/** Templates 二级子功能 */
const TEMPLATE_SUB_ITEMS: { key: SidebarNavItem; label: string; icon: React.ElementType }[] = [
  { key: 'templates:videos',     label: '视频模板',   icon: Film },
  { key: 'templates:avatars',    label: '数字人形象', icon: UserRound },
  { key: 'templates:references', label: '质量参考图', icon: Sparkles },
  { key: 'templates:prompts',    label: 'Prompt 库',  icon: BookOpen },
];

const PAGE_SIZE = 5;

interface AppSidebarProps {
  activeProjectId?: string | null;
  activeNav: SidebarNavItem;
  onNavChange: (nav: SidebarNavItem) => void;
  /** 切换项目 — WorkspaceLayout 状态驱动，无路由导航 */
  onProjectSelect: (projectId: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function AppSidebar({
  activeProjectId,
  activeNav,
  onNavChange,
  onProjectSelect,
  collapsed = false,
  onToggleCollapse,
}: AppSidebarProps) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { credits } = useCredits();
  const { projects, loading, fetchProjects } = useProjectStore();

  // 分页展示：默认 5 条，每次 +5
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isCreating, setIsCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Templates 二级展开
  const [templatesExpanded, setTemplatesExpanded] = useState(false);

  // 首次加载项目列表
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // 点击外部关闭 context menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);

  // 聚焦搜索框
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  // Templates 子项激活时自动展开，切到其他顶级 nav 时自动收起
  useEffect(() => {
    if (activeNav?.startsWith('templates')) {
      setTemplatesExpanded(true);
    } else if (activeNav !== null) {
      setTemplatesExpanded(false);
    }
  }, [activeNav]);

  // 过滤项目
  const filteredProjects = searchQuery.trim()
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : projects;

  const visibleProjects = filteredProjects.slice(0, visibleCount);
  const hasMore = filteredProjects.length > visibleCount;

  const handleShowMore = useCallback(() => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  }, []);

  const handleNewProject = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const response = await projectApi.createProject({ name: '新项目' });
      if (response.data) {
        const newProject = response.data;
        useProjectStore.getState().addProject({
          id: newProject.id,
          name: newProject.name || '新项目',
          updatedAt: new Date().toISOString(),
        });
        onProjectSelect(newProject.id);
      }
    } catch (error) {
      console.error('创建项目失败:', error);
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, onProjectSelect]);

  const handleProjectClick = useCallback(
    (projectId: string) => {
      onProjectSelect(projectId);
    },
    [onProjectSelect],
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      setContextMenu(null);
      try {
        await useProjectStore.getState().removeProject(projectId);
        // 如果删除的是当前项目，跳到首页
        if (activeProjectId === projectId) {
          const { projects: remaining } = useProjectStore.getState();
          if (remaining.length > 0) {
            onProjectSelect(remaining[0].id);
          } else {
            handleNewProject();
          }
        }
      } catch (error) {
        console.error('删除项目失败:', error);
      }
    },
    [activeProjectId, onProjectSelect, handleNewProject],
  );

  const handleRenameProject = useCallback(
    async (projectId: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      try {
        await projectApi.updateProject(projectId, { name: trimmed });
        useProjectStore.getState().updateProject(projectId, { name: trimmed });
      } catch (error) {
        console.error('重命名失败:', error);
      }
    },
    [],
  );

  const handleNavClick = useCallback(
    (nav: SidebarNavItem) => {
      // 点击已激活的 nav → 关闭面板
      if (activeNav === nav) {
        onNavChange(null);
      } else {
        onNavChange(nav);
      }
    },
    [activeNav, onNavChange],
  );

  /** Templates 点击 → 展开/收起子功能列表 */
  const handleTemplatesClick = useCallback(() => {
    if (templatesExpanded && activeNav?.startsWith('templates')) {
      // 已展开且在 Templates 功能中 → 收起子项（保持当前视图）
      setTemplatesExpanded(false);
    } else {
      // 展开并默认选中「视频模板」
      setTemplatesExpanded(true);
      if (!activeNav?.startsWith('templates')) {
        onNavChange('templates:videos');
      }
    }
  }, [templatesExpanded, activeNav, onNavChange]);

  const handleLogout = useCallback(async () => {
    await logout();
    router.push('/login');
  }, [logout, router]);

  const userEmail = user?.email || 'User';
  const userInitials = userEmail.substring(0, 2).toUpperCase();

  // 相对时间格式化
  const formatRelativeTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.floor(days / 7)}周前`;
    return `${Math.floor(days / 30)}个月前`;
  };

  return (
    <aside
      className={cn(
        'h-full flex flex-col',
        'bg-surface-raised border-r border-hr-border-dim',
        'transition-all duration-300 ease-out',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* ---- Header: Logo + Collapse + New ---- */}
      <div className="flex items-center justify-between px-3 h-14 shrink-0 border-b border-hr-border-dim">
        <button
          onClick={() => {
            const firstProject = projects[0];
            if (firstProject) {
              onProjectSelect(firstProject.id);
            }
          }}
          className="flex items-center gap-2 group"
        >
          <div className="w-7 h-7 rounded-lg bg-hr-text-primary flex items-center justify-center group-hover:bg-gray-800 transition-colors">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          {!collapsed && (
            <span className="text-sm font-bold text-hr-text-primary tracking-tight">
              Lepus
            </span>
          )}
        </button>

        {!collapsed && (
          <div className="flex items-center gap-1">
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-1.5 rounded-md text-hr-text-tertiary hover:text-hr-text-primary hover:bg-surface-hover transition-colors"
                title="收起侧边栏"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={handleNewProject}
              disabled={isCreating}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium',
                'bg-hr-text-primary text-white',
                'hover:bg-gray-800 active:scale-95',
                'transition-all duration-150',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {isCreating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              New
            </button>
          </div>
        )}

        {/* 折叠状态下只显示展开按钮 */}
        {collapsed && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-hr-text-tertiary hover:text-hr-text-primary hover:bg-surface-hover transition-colors"
            title="展开侧边栏"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ---- Search (expanded only) ---- */}
      {!collapsed && (
        <div className="px-3 pt-2">
          <div
            className={cn(
              'flex items-center gap-2 px-2.5 h-8 rounded-lg',
              'bg-surface-overlay border border-transparent',
              'focus-within:border-hr-border focus-within:bg-white',
              'transition-all duration-200',
            )}
          >
            <Search className="w-3.5 h-3.5 text-hr-text-tertiary shrink-0" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim()) setVisibleCount(50);
                else setVisibleCount(PAGE_SIZE);
              }}
              placeholder="搜索项目..."
              className="flex-1 bg-transparent text-xs text-hr-text-primary placeholder:text-hr-text-tertiary outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setVisibleCount(PAGE_SIZE);
                }}
                className="p-0.5 rounded text-hr-text-tertiary hover:text-hr-text-primary transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- Project List (expanded only) ---- */}
      {!collapsed && (
      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
            {!collapsed && (
              <div className="px-3 mb-1 flex items-center justify-between">
                <span className="text-[10px] font-medium text-hr-text-tertiary uppercase tracking-wider">
                  Projects
                </span>
                {searchQuery && (
                  <span className="text-[10px] text-hr-text-tertiary">
                    {filteredProjects.length} 个结果
                  </span>
                )}
              </div>
            )}

            {loading && projects.length === 0 ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-4 h-4 text-hr-text-tertiary animate-spin" />
              </div>
            ) : filteredProjects.length === 0 && searchQuery ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-hr-text-tertiary">未找到匹配项目</p>
              </div>
            ) : (
              <>
                <AnimatePresence mode="popLayout">
                  {visibleProjects.map((project) => (
                    <motion.div
                      key={project.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={delosTransition.micro}
                    >
                      <ProjectItem
                        project={project}
                        isActive={activeProjectId === project.id && !activeNav}
                        collapsed={collapsed}
                        onSelect={handleProjectClick}
                        onContextMenu={() => setContextMenu(project.id === contextMenu ? null : project.id)}
                        showContextMenu={contextMenu === project.id}
                        onDelete={handleDeleteProject}
                        onRename={handleRenameProject}
                        contextMenuRef={contextMenu === project.id ? contextMenuRef : undefined}
                        formatRelativeTime={formatRelativeTime}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>

                {hasMore && !collapsed && (
                  <button
                    onClick={handleShowMore}
                    className={cn(
                      'w-full flex items-center gap-2 px-4 py-2 text-xs',
                      'text-hr-text-secondary hover:text-hr-text-primary',
                      'hover:bg-surface-hover transition-colors duration-150',
                    )}
                  >
                    <ChevronDown className="w-3 h-3" />
                    还有 {filteredProjects.length - visibleCount} 个项目
                  </button>
                )}
              </>
            )}
      </div>
      )}

      {/* collapsed 时用 flex-1 spacer 顶开底部 nav */}
      {collapsed && <div className="flex-1" />}

      {/* ---- Nav Items ---- */}
      <div className="border-t border-hr-border-dim py-2 shrink-0">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const isTemplates = key === 'templates';
          const isActive = isTemplates
            ? (activeNav?.startsWith('templates') ?? false)
            : activeNav === key;

          return (
            <React.Fragment key={key}>
              <button
                onClick={() => { if (isTemplates) handleTemplatesClick(); else handleNavClick(key); }}
                className={cn(
                  'w-full flex items-center gap-3 py-2 text-sm',
                  'transition-all duration-150 relative',
                  collapsed ? 'justify-center px-0' : 'px-4',
                  isActive
                    ? 'text-hr-text-primary bg-surface-hover font-medium'
                    : 'text-hr-text-secondary hover:text-hr-text-primary hover:bg-surface-hover',
                )}
              >
                {/* 左侧选中指示条（Templates 展开时不显示父级指示条） */}
                {isActive && !(isTemplates && templatesExpanded) && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-hr-text-primary" />
                )}
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && label}
                {/* Templates 展开箭头 */}
                {isTemplates && !collapsed && (
                  <ChevronDown
                    className={cn(
                      'w-3 h-3 ml-auto transition-transform duration-200',
                      templatesExpanded ? 'rotate-0' : '-rotate-90',
                    )}
                  />
                )}
              </button>

              {/* ★ Templates 二级子功能 */}
              {isTemplates && templatesExpanded && !collapsed && (
                <div className="py-0.5">
                  {TEMPLATE_SUB_ITEMS.map(({ key: subKey, label: subLabel, icon: SubIcon }) => (
                    <button
                      key={subKey}
                      onClick={() => onNavChange(subKey)}
                      className={cn(
                        'w-full flex items-center gap-2.5 py-1.5 pl-11 pr-4 text-xs',
                        'transition-all duration-150 relative',
                        activeNav === subKey
                          ? 'text-hr-text-primary font-medium bg-surface-hover/60'
                          : 'text-hr-text-tertiary hover:text-hr-text-secondary hover:bg-surface-hover',
                      )}
                    >
                      {activeNav === subKey && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3 rounded-r-full bg-accent-core" />
                      )}
                      <SubIcon className="w-3.5 h-3.5 shrink-0" />
                      {subLabel}
                    </button>
                  ))}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ---- User Footer ---- */}
      <div className="border-t border-hr-border-dim p-3 shrink-0">
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center text-xs font-semibold text-hr-text-secondary">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-hr-text-primary truncate">
                {userEmail}
              </p>
              <p className="text-[10px] text-hr-text-tertiary">
                ⚡ {credits?.credits_balance ?? '—'} credits
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => router.push('/settings')}
                className="p-1.5 rounded-md text-hr-text-tertiary hover:text-hr-text-primary hover:bg-surface-hover transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-md text-hr-text-tertiary hover:text-semantic-error hover:bg-semantic-error-bg transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center text-xs font-semibold text-hr-text-secondary">
              {userInitials}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/* ---- Project Item Sub-component ---- */

interface ProjectItemProps {
  project: ProjectRecord;
  isActive: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onContextMenu: () => void;
  showContextMenu: boolean;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => Promise<void>;
  contextMenuRef?: React.Ref<HTMLDivElement>;
  formatRelativeTime: (dateStr: string) => string;
}

function ProjectItem({
  project,
  isActive,
  collapsed,
  onSelect,
  onContextMenu,
  showContextMenu,
  onDelete,
  onRename,
  contextMenuRef,
  formatRelativeTime,
}: ProjectItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [isSaving, setIsSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 开启重命名时聚焦并全选
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleStartRename = useCallback(() => {
    setRenameValue(project.name);
    setIsRenaming(true);
  }, [project.name]);

  const handleConfirmRename = useCallback(async () => {
    if (isSaving) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === project.name) {
      setIsRenaming(false);
      return;
    }
    setIsSaving(true);
    try {
      await onRename(project.id, trimmed);
    } finally {
      setIsSaving(false);
      setIsRenaming(false);
    }
  }, [renameValue, project.id, project.name, onRename, isSaving]);

  const handleCancelRename = useCallback(() => {
    setRenameValue(project.name);
    setIsRenaming(false);
  }, [project.name]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirmRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelRename();
      }
    },
    [handleConfirmRename, handleCancelRename],
  );

  return (
    <div className="relative group">
      <button
        onClick={() => !isRenaming && onSelect(project.id)}
        onDoubleClick={() => !collapsed && handleStartRename()}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 text-left',
          'transition-all duration-150 rounded-lg mx-1',
          collapsed && 'justify-center px-2 mx-0',
          isActive
            ? 'bg-accent-soft text-hr-text-primary shadow-sm'
            : 'text-hr-text-secondary hover:bg-surface-hover hover:text-hr-text-primary',
        )}
        style={{ width: collapsed ? undefined : 'calc(100% - 8px)' }}
      >
        {/* 缩略图 */}
        <div
          className={cn(
            'shrink-0 rounded-md bg-surface-overlay overflow-hidden',
            'w-8 h-8',
          )}
        >
          {project.thumbnailUrl ? (
            <img
              src={project.thumbnailUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-hr-text-tertiary">
              <Sparkles className="w-3 h-3" />
            </div>
          )}
        </div>

        {!collapsed && !isRenaming && (
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{project.name}</p>
            <p className="text-[10px] text-hr-text-tertiary">
              {formatRelativeTime(project.updatedAt)}
            </p>
          </div>
        )}

        {/* 内联重命名 */}
        {!collapsed && isRenaming && (
          <div className="flex-1 min-w-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleConfirmRename}
              className={cn(
                'flex-1 min-w-0 text-xs font-medium',
                'bg-white border border-accent-core rounded px-1.5 py-0.5',
                'outline-none text-hr-text-primary',
              )}
              maxLength={50}
            />
            {isSaving && <Loader2 className="w-3 h-3 text-hr-text-tertiary animate-spin shrink-0" />}
          </div>
        )}
      </button>

      {/* More button (visible on hover) */}
      {!collapsed && !isRenaming && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu();
          }}
          className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2',
            'p-1 rounded-md text-hr-text-tertiary',
            'hover:text-hr-text-primary hover:bg-surface-hover',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            showContextMenu && 'opacity-100',
          )}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Context menu dropdown */}
      <AnimatePresence>
        {showContextMenu && !collapsed && (
          <motion.div
            ref={contextMenuRef}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={delosTransition.micro}
            className={cn(
              'absolute right-2 top-full mt-1 z-50',
              'bg-white border border-hr-border rounded-lg shadow-glass',
              'py-1 min-w-[140px]',
            )}
          >
            <button
              onClick={() => {
                onContextMenu(); // close menu
                handleStartRename();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-hr-text-secondary hover:bg-surface-hover hover:text-hr-text-primary transition-colors"
            >
              <Pencil className="w-3 h-3" />
              重命名
            </button>
            <button
              onClick={() => onDelete(project.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-semantic-error hover:bg-semantic-error-bg transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              删除
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
