'use client';

import React from 'react';
import { TopBar } from './TopBar';
import { cn } from '@/lib/cn';

/* ================================================================
   Delos AppShell — TopBar + Content Area
   
   所有主页面 (Explore / Canvas / Workspace) 共用
   ================================================================ */

interface AppShellProps {
  children: React.ReactNode;
  /** 是否隐藏 TopBar（全屏 Canvas 模式） */
  hideTopBar?: boolean;
  className?: string;
}

export function AppShell({ children, hideTopBar = false, className }: AppShellProps) {
  return (
    <div className="min-h-screen bg-surface-base text-hr-text-primary">
      {!hideTopBar && <TopBar />}
      <main className={cn(!hideTopBar && 'pt-14', className)}>
        {children}
      </main>
    </div>
  );
}
