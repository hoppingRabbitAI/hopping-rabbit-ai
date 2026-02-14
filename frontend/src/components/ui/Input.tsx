'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/* ================================================================
   Delos Input — 极简白灰 · Focus 态 Indigo 环
   ================================================================ */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 左侧图标 */
  icon?: React.ReactNode;
  /** 右侧附加区域（如密码可见切换） */
  suffix?: React.ReactNode;
  /** 错误态 */
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ icon, suffix, error, className, ...props }, ref) => {
    return (
      <div className="relative group">
        {icon && (
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-hr-text-tertiary group-focus-within:text-hr-text-secondary transition-colors">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full bg-surface-raised border text-[13px] text-hr-text-primary rounded-xl',
            'py-2.5 transition-all duration-200',
            'placeholder:text-hr-text-tertiary',
            'focus:outline-none focus:bg-white focus:border-accent-core focus:ring-2 focus:ring-accent-soft',
            'disabled:opacity-45 disabled:cursor-not-allowed',
            icon ? 'pl-10' : 'pl-3.5',
            suffix ? 'pr-10' : 'pr-3.5',
            error
              ? 'border-semantic-error focus:border-semantic-error focus:ring-semantic-error-bg'
              : 'border-hr-border-dim hover:border-hr-border-DEFAULT',
            className
          )}
          {...props}
        />
        {suffix && (
          <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center">
            {suffix}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
