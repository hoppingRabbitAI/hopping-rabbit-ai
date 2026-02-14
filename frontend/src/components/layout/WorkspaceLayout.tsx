'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { AppSidebar, type SidebarNavItem } from '@/components/layout/AppSidebar';
import { WelcomeScreen } from '@/components/workspace/WelcomeScreen';

// 动态导入 VisualEditor — 画布需要浏览器环境
const VisualEditor = dynamic(
  () => import('@/components/visual-editor/VisualEditor'),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-6 h-6 text-hr-text-tertiary animate-spin mx-auto mb-3" />
          <p className="text-xs text-hr-text-tertiary">加载编辑器...</p>
        </div>
      </div>
    ),
  },
);

// ★ PlatformMaterialsView — 完整模板管理（视频模板 / 数字人 / 质量参考图 / Prompt 库）
const PlatformMaterialsView = dynamic(
  () => import('@/components/workspace/PlatformMaterialsView'),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-5 h-5 text-hr-text-tertiary animate-spin" />
    </div>
  )},
);
const AssetsPanel = dynamic(
  () => import('@/components/panels').then((m) => ({ default: m.AssetsPanel })),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-5 h-5 text-hr-text-tertiary animate-spin" />
    </div>
  )},
);

/* ================================================================
   WorkspaceLayout — Sidebar + Main + Secondary Panel
   🎯 治本设计：项目切换 = 状态驱动，不触发路由导航

   - currentProjectId 由内部 state 管理
   - 切换项目 → setState + window.history.replaceState (无 re-mount)
   - 项目加载 + 内容渲染都在本组件内完成

   ┌─────────┬───────────────────────────────┐
   │         │                               │
   │ Sidebar │         Main Content          │
   │  w-64   │         (flex-1)              │
   │ (内嵌   │   WelcomeScreen / Editor      │
   │  面板)  │                               │
   └─────────┴───────────────────────────────┘
   ================================================================ */

interface WorkspaceLayoutProps {
  /** 初始项目 ID（来自路由 /p/[id]） */
  initialProjectId?: string;
  /** 初始视图：explore = Explore 首页, project = 直接进画布 */
  initialView?: 'explore' | 'project';
}

export function WorkspaceLayout({ initialProjectId, initialView = 'explore' }: WorkspaceLayoutProps) {
  // ---- 项目状态 ----
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(initialProjectId);

  // ---- Layout 状态 ----
  // ★ initialView 决定首屏：explore → Explore, project → 画布
  const [activeNav, setActiveNav] = useState<SidebarNavItem>(
    initialView === 'project' ? null : 'explore',
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 防止 initialProjectId prop 更新时与内部 state 冲突
  const isInternalSwitch = useRef(false);

  // ★ 外部 prop 变化时同步（仅限硬导航 / 首次加载）
  useEffect(() => {
    if (isInternalSwitch.current) {
      isInternalSwitch.current = false;
      return;
    }
    if (initialProjectId && initialProjectId !== currentProjectId) {
      setCurrentProjectId(initialProjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProjectId]);

  // ★ currentProjectId 只在用户主动操作时设置：
  //   - 点击 sidebar 项目 → switchProject
  //   - 点击 + New → AppSidebar.handleNewProject → switchProject
  //   - 模板 "使用" → 创建项目后 switchProject
  //   不再自动后台 fetch / 创建项目 — Explore 页就是 Explore，不预加载项目

  // ★ 切换项目 — 退出 Explore，进入画布
  const switchProject = useCallback((id: string) => {
    if (id === currentProjectId && activeNav === null) return;
    isInternalSwitch.current = true;
    setCurrentProjectId(id);
    setActiveNav(null);
    window.history.replaceState(null, '', `/p/${id}`);
  }, [currentProjectId, activeNav]);

  // ---- Layout handlers ----
  const handleNavChange = useCallback((nav: SidebarNavItem) => {
    setActiveNav(nav);
    // ★ URL 同步
    if (nav === 'explore') {
      window.history.replaceState(null, '', '/explore');
    } else if (nav === null && !currentProjectId) {
      // 无项目时 toggle off 任何 nav → 回到 /explore（安全着陆）
      window.history.replaceState(null, '', '/explore');
    }
  }, [currentProjectId]);

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
    setActiveNav(null);
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-surface-base">
      {/* Sidebar */}
      <AppSidebar
        activeProjectId={currentProjectId}
        activeNav={activeNav}
        onNavChange={handleNavChange}
        onProjectSelect={switchProject}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
      />

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-hidden">
        {/* Explore 模式 — 包括显式 explore + 无项目时的安全着陆 */}
        {(activeNav === 'explore' || (activeNav === null && !currentProjectId)) && (
          <WelcomeScreen />
        )}

        {/* Templates 模式 — 4 个子功能由侧边栏二级导航切换 */}
        {activeNav?.startsWith('templates') && (
          <PlatformMaterialsView
            key="platform-materials"
            initialTopTab={
              activeNav === 'templates:avatars' ? 'avatars'
              : activeNav === 'templates:references' ? 'references'
              : activeNav === 'templates:prompts' ? 'prompts'
              : 'templates'
            }
          />
        )}

        {/* Assets 模式 */}
        {activeNav === 'assets' && <AssetsPanel />}

        {/* 项目模式 — VisualEditor 自己处理 loading/error/empty */}
        {activeNav === null && currentProjectId && (
          <VisualEditor
            key={currentProjectId}
            projectId={currentProjectId}
            hideHeader
            className="h-full"
          />
        )}
      </main>
    </div>
  );
}
