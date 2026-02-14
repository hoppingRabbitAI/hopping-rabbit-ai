'use client';

import React from 'react';
import { cn } from '@/lib/cn';

/* ================================================================
   Delos Tabs — 顶部导航标签 + 底部指示线
   ================================================================ */

interface Tab {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeKey: string;
  onChange: (key: string) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function Tabs({ tabs, activeKey, onChange, size = 'md', className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              'relative flex items-center gap-1.5 px-3 rounded-lg transition-colors',
              size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm',
              'font-medium tracking-wide uppercase',
              active
                ? 'text-accent-core'
                : 'text-hr-text-secondary hover:text-hr-text-primary hover:bg-surface-hover'
            )}
          >
            {tab.icon}
            {tab.label}
            {/* 底部指示线 */}
            {active && (
              <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-accent-core" />
            )}
          </button>
        );
      })}
    </div>
  );
}
