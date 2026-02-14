'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { delosTransition } from '@/lib/motion';

/* ================================================================
   SidebarPanel — Figma 式二级面板

   从 Sidebar 右侧滑出的面板，用于展示 Explore / Templates /
   Assets 的内容。

   - 宽度 360px
   - 紧贴 sidebar 右边缘（支持动态 sidebar 宽度）
   - 带标题栏和关闭按钮
   - 内容区域可滚动
   - 支持 Esc 键关闭
   ================================================================ */

interface SidebarPanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** 面板宽度（像素），默认 360 */
  width?: number;
  /** Sidebar 宽度（像素），默认 256 */
  sidebarWidth?: number;
}

export function SidebarPanel({
  open,
  title,
  onClose,
  children,
  className,
  width = 360,
  sidebarWidth = 256,
}: SidebarPanelProps) {
  // Esc 键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 点击遮罩关闭 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={delosTransition.exit}
            className="fixed inset-0 z-30 bg-black/5"
            onClick={onClose}
          />

          {/* 面板本体 */}
          <motion.div
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            transition={delosTransition.panel}
            className={cn(
              'fixed top-0 bottom-0 z-40',
              'bg-white border-r border-hr-border-dim',
              'shadow-glass-lg',
              'flex flex-col',
              className,
            )}
            style={{ width, left: sidebarWidth }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-14 shrink-0 border-b border-hr-border-dim">
              <h2 className="text-sm font-semibold text-hr-text-primary">{title}</h2>
              <button
                onClick={onClose}
                className={cn(
                  'p-1.5 rounded-md text-hr-text-tertiary',
                  'hover:text-hr-text-primary hover:bg-surface-hover',
                  'transition-colors duration-150',
                )}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content — scrollable */}
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
