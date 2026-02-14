'use client';

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, Image as ImageIcon, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { delosTransition } from '@/lib/motion';

/* ================================================================
   PhotoUploader — PRD §8.2 common
   
   可复用的拖入/上传/粘贴组件
   虚线边框 → hover: border-accent 发光
   ================================================================ */

interface PhotoUploaderProps {
  /** 选中文件后的回调 */
  onFileSelect: (file: File) => void;
  /** 当前预览 URL */
  previewUrl?: string | null;
  /** 清除预览 */
  onClear?: () => void;
  /** 占位提示 */
  label?: string;
  /** 副标签 */
  sublabel?: string;
  /** 宽高比 */
  aspectRatio?: string;
  /** 是否需要人脸 */
  requireFace?: boolean;
  /** 接受的文件类型 */
  accept?: string;
  /** 自定义样式 */
  className?: string;
}

export function PhotoUploader({
  onFileSelect,
  previewUrl,
  onClear,
  label = '拖拽照片到此处',
  sublabel = '或点击选择文件 · 支持 JPG、PNG',
  aspectRatio = 'aspect-[4/5]',
  requireFace = false,
  accept = 'image/*',
  className,
}: PhotoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) handleFile(file);
          break;
        }
      }
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // 有预览时显示预览状态
  if (previewUrl) {
    return (
      <div className={cn('relative rounded-xl overflow-hidden bg-surface-muted', aspectRatio, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="预览" className="w-full h-full object-cover" />
        {onClear && (
          <button
            onClick={onClear}
            className="absolute top-2 right-2 p-1 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-semantic-success/90 text-white text-[11px] font-medium">
          <Check className="w-3 h-3" />
          已选择
        </div>
      </div>
    );
  }

  // 空状态：上传区
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      onPaste={handlePaste}
      tabIndex={0}
      className={cn(
        'flex flex-col items-center justify-center gap-3 cursor-pointer transition-all',
        'rounded-xl border-2 border-dashed',
        aspectRatio,
        dragActive
          ? 'border-accent-core bg-accent-soft scale-[1.01]'
          : 'border-hr-border hover:border-hr-border-strong hover:bg-surface-hover',
        className
      )}
    >
      <motion.div
        animate={dragActive ? { scale: 1.1 } : { scale: 1 }}
        transition={delosTransition.micro}
        className="w-12 h-12 rounded-full bg-surface-overlay flex items-center justify-center"
      >
        <Upload className={cn('w-5 h-5', dragActive ? 'text-accent-core' : 'text-hr-text-tertiary')} />
      </motion.div>
      <div className="text-center px-4">
        <p className="text-sm font-medium text-hr-text-primary">{label}</p>
        <p className="text-xs text-hr-text-tertiary mt-1">{sublabel}</p>
      </div>
      {requireFace && (
        <p className="flex items-center gap-1 text-[10px] text-hr-text-tertiary">
          <ImageIcon className="w-3 h-3" />
          需要包含清晰人脸的照片
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleInputChange}
      />
    </label>
  );
}
