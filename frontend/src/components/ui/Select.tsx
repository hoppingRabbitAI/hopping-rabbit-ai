'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ================================================================
   Delos Select — 极简白灰下拉选择器
   ================================================================ */

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = '请选择…',
  label,
  disabled = false,
  className,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleSelect = useCallback(
    (opt: SelectOption) => {
      if (opt.disabled) return;
      onChange(opt.value);
      setIsOpen(false);
    },
    [onChange]
  );

  return (
    <div ref={ref} className={cn('relative', className)}>
      {label && <label className="cap-label mb-1.5 block">{label}</label>}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        className={cn(
          'flex items-center justify-between w-full h-10 px-3 rounded-xl',
          'bg-white border border-hr-border-dim text-sm text-hr-text-primary',
          'transition-all duration-200',
          isOpen && 'border-accent-core shadow-accent-glow',
          !isOpen && 'hover:border-hr-border',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span className={cn(!selected && 'text-hr-text-tertiary')}>
          {selected ? (
            <span className="flex items-center gap-2">
              {selected.icon}
              {selected.label}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-hr-text-tertiary transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute z-50 w-full mt-1.5 py-1 rounded-xl',
              'bg-white border border-hr-border-dim shadow-glass',
              'max-h-60 overflow-y-auto delos-scrollbar'
            )}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt)}
                disabled={opt.disabled}
                className={cn(
                  'flex items-center justify-between w-full px-3 py-2 text-sm text-left transition-colors',
                  opt.value === value
                    ? 'bg-accent-soft text-accent-core font-medium'
                    : 'text-hr-text-primary hover:bg-surface-hover',
                  opt.disabled && 'opacity-40 cursor-not-allowed'
                )}
              >
                <span className="flex items-center gap-2">
                  {opt.icon}
                  {opt.label}
                </span>
                {opt.value === value && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
