'use client';

import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/cn';

/* ================================================================
   Delos Card — 白底卡片 · 精密阴影 · hover 微升
   ================================================================ */

interface CardProps extends HTMLMotionProps<'div'> {
  /** 是否开启 hover 上浮效果 */
  hoverable?: boolean;
  /** 是否处于选中/激活态 */
  active?: boolean;
  /** 内部 padding */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-7',
};

export function Card({
  hoverable = false,
  active = false,
  padding = 'md',
  className,
  children,
  ...props
}: CardProps) {
  return (
    <motion.div
      whileHover={hoverable ? { y: -3, transition: { duration: 0.25 } } : undefined}
      className={cn(
        'rounded-2xl bg-white border transition-all duration-250',
        paddingMap[padding],
        active
          ? 'border-accent-core shadow-accent-glow'
          : 'border-hr-border-dim shadow-card',
        hoverable && !active && 'hover:shadow-card-hover hover:border-hr-border-DEFAULT cursor-pointer',
        className
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/* ================================================================
   Delos Badge / Tag
   ================================================================ */

type BadgeVariant = 'default' | 'accent' | 'success' | 'error' | 'warning';

const badgeStyles: Record<BadgeVariant, string> = {
  default: 'bg-surface-overlay text-hr-text-secondary border border-hr-border-dim',
  accent: 'bg-accent-soft text-accent-core',
  success: 'bg-semantic-success-bg text-semantic-success',
  error: 'bg-semantic-error-bg text-semantic-error',
  warning: 'bg-semantic-warning-bg text-semantic-warning',
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium select-none',
        badgeStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
