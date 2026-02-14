'use client';

import React, { useCallback } from 'react';
import { cn } from '@/lib/cn';

/* ================================================================
   Delos Slider — 极简白灰滑块
   ================================================================ */

interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  /** 右侧显示当前值 */
  showValue?: boolean;
  /** 值格式化 */
  formatValue?: (v: number) => string;
  disabled?: boolean;
  className?: string;
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  showValue = true,
  formatValue,
  disabled = false,
  className,
}: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
    },
    [onChange]
  );

  const displayValue = formatValue ? formatValue(value) : String(value);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && (
            <span className="cap-label">{label}</span>
          )}
          {showValue && (
            <span className="text-xs font-medium text-hr-text-secondary tabular-nums">
              {displayValue}
            </span>
          )}
        </div>
      )}
      <div className="relative flex items-center h-5">
        {/* Track background */}
        <div className="absolute inset-x-0 h-1 rounded-full bg-surface-muted" />
        {/* Active track */}
        <div
          className="absolute left-0 h-1 rounded-full bg-accent-core transition-all"
          style={{ width: `${percent}%` }}
        />
        {/* Native input */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className={cn(
            'delos-slider relative w-full h-1 appearance-none bg-transparent cursor-pointer z-10',
            disabled && 'opacity-40 cursor-not-allowed'
          )}
        />
      </div>
    </div>
  );
}
