'use client';

import React, { useState, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass, FolderOpen, Settings, User, Sparkles, Image,
  LogOut, FolderOpenDot, Upload, ListTodo, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useCredits } from '@/lib/hooks/useCredits';

/* ================================================================
   Delos TopBar — 顶部导航 · glass-subtle · h-14
   
   PRD §8.4: 水平导航
   Nav Tabs: EXPLORE / ASSETS / TEMPLATES / WORKSPACE
   左侧 Logo · 右侧 用户菜单（额度 + 设置 + 退出）
   ================================================================ */

const NAV_TABS = [
  { key: 'explore',   label: 'EXPLORE',   href: '/p',  icon: Compass },
  { key: 'assets',    label: 'ASSETS',    href: '/p',  icon: Image },
  { key: 'workspace', label: 'WORKSPACE', href: '/p', icon: FolderOpen },
] as const;

const TEMPLATE_WORKSPACE_TABS = new Set(['platform-materials', 'render-tasks']);

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, logout } = useAuthStore();
  const { credits } = useCredits();

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const userCloseTimer = useRef<NodeJS.Timeout | null>(null);
  const templateCloseTimer = useRef<NodeJS.Timeout | null>(null);

  const workspaceTab = searchParams.get('tab');
  const isTemplateActive =
    pathname.startsWith('/template')
    || pathname.startsWith('/templates')
    || (pathname.startsWith('/workspace') && workspaceTab !== null && TEMPLATE_WORKSPACE_TABS.has(workspaceTab));

  const activeKey = NAV_TABS.find((t) => pathname.startsWith(t.href))?.key ?? 'discover';

  const userEmail = user?.email || 'User';
  const userInitials = userEmail.substring(0, 2).toUpperCase();

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logout();
    router.push('/login');
  };

  /* ---- hover helpers (delayed close) ---- */
  const openUser = () => { if (userCloseTimer.current) clearTimeout(userCloseTimer.current); setShowUserMenu(true); };
  const closeUser = () => { userCloseTimer.current = setTimeout(() => setShowUserMenu(false), 160); };
  const openTemplate = () => { if (templateCloseTimer.current) clearTimeout(templateCloseTimer.current); setShowTemplateMenu(true); };
  const closeTemplate = () => { templateCloseTimer.current = setTimeout(() => setShowTemplateMenu(false), 160); };

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 h-14',
        'bg-glass-heavy backdrop-blur-md',
        'border-b border-hr-border-dim',
        'shadow-topbar',
        'flex items-center justify-between px-5'
      )}
    >
      {/* ---- Left: Logo ---- */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => router.push('/p')}
          className="flex items-center gap-2 group"
        >
          <div className="w-8 h-8 rounded-lg bg-hr-text-primary flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold text-hr-text-primary tracking-tight hidden sm:block">
            Lepus
          </span>
        </button>
      </div>

      {/* ---- Center: Nav Tabs ---- */}
      <nav className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
        {NAV_TABS.map((tab) => {
          const active = tab.key === activeKey && !isTemplateActive;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => router.push(tab.href)}
              className={cn(
                'relative flex items-center gap-1.5 px-4 h-14 text-[13px] font-semibold tracking-[0.08em] transition-colors',
                active
                  ? 'text-hr-text-primary'
                  : 'text-hr-text-tertiary hover:text-hr-text-secondary'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}

              {active && (
                <motion.div
                  layoutId="topbar-indicator"
                  className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full bg-hr-text-primary"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}

        {/* ---- 模板库 Dropdown Tab ---- */}
        <div
          ref={templateMenuRef}
          className="relative"
          onMouseEnter={openTemplate}
          onMouseLeave={closeTemplate}
        >
          <button
            className={cn(
              'relative flex items-center gap-1.5 px-4 h-14 text-[13px] font-semibold tracking-[0.08em] transition-colors',
              isTemplateActive
                ? 'text-hr-text-primary'
                : 'text-hr-text-tertiary hover:text-hr-text-secondary'
            )}
          >
            <FolderOpenDot className="w-4 h-4" />
            TEMPLATES
            <ChevronDown className={cn('w-3 h-3 transition-transform', showTemplateMenu && 'rotate-180')} />

            {isTemplateActive && (
              <motion.div
                layoutId="topbar-indicator"
                className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full bg-hr-text-primary"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
          </button>

          {/* Template Dropdown */}
          <AnimatePresence>
            {showTemplateMenu && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 pt-1.5 w-48 z-50"
              >
                <div className="bg-white border border-hr-border-dim rounded-xl shadow-lg overflow-hidden py-1">
                  <button
                    onClick={() => { setShowTemplateMenu(false); router.push('/p'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-hr-text-secondary hover:bg-surface-hover hover:text-hr-text-primary transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                    浏览模板
                  </button>
                  <button
                    onClick={() => { setShowTemplateMenu(false); router.push('/p'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-hr-text-secondary hover:bg-surface-hover hover:text-hr-text-primary transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    上传模板
                  </button>
                  <button
                    onClick={() => { setShowTemplateMenu(false); router.push('/p'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-hr-text-secondary hover:bg-surface-hover hover:text-hr-text-primary transition-colors"
                  >
                    <ListTodo className="w-4 h-4" />
                    生成任务
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* ---- Right: User Area ---- */}
      <div className="flex items-center gap-2 shrink-0">
        <Tooltip content="设置" side="bottom">
          <button
            onClick={() => router.push('/settings')}
            className="p-2 rounded-lg text-hr-text-tertiary hover:text-hr-text-secondary hover:bg-surface-hover transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </Tooltip>

        {/* User Avatar + Dropdown */}
        <div
          ref={userMenuRef}
          className="relative"
          onMouseEnter={openUser}
          onMouseLeave={closeUser}
        >
          <button className="w-8 h-8 rounded-full bg-surface-muted flex items-center justify-center hover:bg-surface-hover transition-colors text-xs font-bold text-hr-text-tertiary">
            {user ? userInitials : <User className="w-4 h-4" />}
          </button>

          {/* User Dropdown Menu */}
          <AnimatePresence>
            {showUserMenu && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full right-0 pt-1.5 w-60 z-50"
              >
                <div className="bg-white border border-hr-border-dim rounded-xl shadow-lg overflow-hidden">
                  {/* User Info */}
                  <div className="px-4 py-3 border-b border-hr-border-dim">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-surface-muted flex items-center justify-center text-hr-text-tertiary">
                        <User className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-hr-text-primary truncate">{userEmail}</p>
                        <p className="text-xs text-hr-text-tertiary">个人账户</p>
                      </div>
                    </div>

                    {/* Credits progress */}
                    {credits && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-hr-text-tertiary mb-1">
                          <span>剩余额度</span>
                          <span className="text-hr-text-secondary font-medium font-mono">
                            {credits.credits_balance.toLocaleString()}
                            {(credits.credits_total_granted ?? 0) > 0 && (
                              <span className="text-hr-text-tertiary"> / {(credits.credits_total_granted ?? 0).toLocaleString()}</span>
                            )}
                          </span>
                        </div>
                        {(credits.credits_total_granted ?? 0) > 0 && (
                          <div className="w-full h-1.5 bg-surface-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent-core rounded-full transition-all"
                              style={{
                                width: `${Math.min((credits.credits_balance / (credits.credits_total_granted ?? 1)) * 100, 100).toFixed(0)}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Menu Items */}
                  <div className="py-1">
                    <Link
                      href="/settings"
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-hr-text-secondary hover:bg-surface-hover transition-colors"
                      onClick={() => setShowUserMenu(false)}
                    >
                      <Settings className="w-4 h-4" />
                      <span>设置</span>
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-semantic-error hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>退出登录</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
