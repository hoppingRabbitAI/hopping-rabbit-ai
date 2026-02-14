'use client';

import React from 'react';
import { cn } from '@/lib/cn';

/* ================================================================
   CapLabel — PRD §8.0
   10px / 500 / uppercase / tracking 0.12em / text-tertiary
   ================================================================ */

interface CapLabelProps {
  children: React.ReactNode;
  className?: string;
  as?: 'span' | 'div' | 'p' | 'label';
}

export function CapLabel({ children, className, as: Tag = 'span' }: CapLabelProps) {
  return (
    <Tag
      className={cn(
        'text-[10px] font-medium uppercase tracking-[0.12em] text-hr-text-tertiary select-none',
        className
      )}
    >
      {children}
    </Tag>
  );
}
