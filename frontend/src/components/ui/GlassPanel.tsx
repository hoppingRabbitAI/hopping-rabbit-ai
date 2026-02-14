'use client';

import React from 'react';
import { cn } from '@/lib/cn';

/* ================================================================
   Delos GlassPanel — 白色毛玻璃容器
   ================================================================ */

type GlassLevel = 'subtle' | 'light' | 'medium' | 'strong';

interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  level?: GlassLevel;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  rounded?: 'md' | 'lg' | 'xl' | '2xl';
}

const levelMap: Record<GlassLevel, string> = {
  subtle: 'glass-panel',
  light:  'glass-panel',
  medium: 'glass-panel-strong',
  strong: 'glass-panel-strong shadow-glass',
};

const paddingMap = { none: '', sm: 'p-3', md: 'p-5', lg: 'p-7' };
const roundedMap = { md: 'rounded-lg', lg: 'rounded-xl', xl: 'rounded-2xl', '2xl': 'rounded-[20px]' };

export function GlassPanel({
  level = 'subtle',
  padding = 'md',
  rounded = 'xl',
  className,
  children,
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={cn(levelMap[level], paddingMap[padding], roundedMap[rounded], className)}
      {...props}
    >
      {children}
    </div>
  );
}
