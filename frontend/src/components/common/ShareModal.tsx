'use client';

import React, { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Share2, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { CapLabel } from '@/components/ui/CapLabel';
import { delosTransition } from '@/lib/motion';

/* ================================================================
   ShareModal — PRD §8.2 common
   
   分享/导出弹窗：下载到本地 / 复制链接 / 分享到社交平台
   ================================================================ */

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 可下载的资源 URL */
  resourceUrl?: string;
  /** 资源类型 */
  resourceType?: 'image' | 'video';
  /** 分享标题 */
  title?: string;
}

const SHARE_PLATFORMS = [
  { id: 'douyin', label: '抖音', icon: '🎵' },
  { id: 'xiaohongshu', label: '小红书', icon: '📕' },
  { id: 'wechat', label: '微信', icon: '💬' },
  { id: 'weibo', label: '微博', icon: '📢' },
] as const;

export function ShareModal({ isOpen, onClose, resourceUrl, resourceType = 'video', title }: ShareModalProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopyLink = useCallback(async () => {
    if (!resourceUrl) return;
    try {
      await navigator.clipboard.writeText(resourceUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [resourceUrl]);

  const handleDownload = useCallback(() => {
    if (!resourceUrl) return;
    const a = document.createElement('a');
    a.href = resourceUrl;
    a.download = `lepus-${Date.now()}.${resourceType === 'video' ? 'mp4' : 'png'}`;
    a.click();
  }, [resourceUrl, resourceType]);

  const handleShare = useCallback((platformId: string) => {
    // TODO: 实际的社交分享逻辑
    console.log('Share to:', platformId, resourceUrl);
  }, [resourceUrl]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={delosTransition.enter}
            className={cn(
              'relative w-full max-w-md mx-4 bg-white rounded-2xl shadow-modal',
              'border border-hr-border-dim overflow-hidden p-6'
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-hr-text-primary">分享你的作品</h3>
                {title && <p className="text-sm text-hr-text-secondary mt-0.5">{title}</p>}
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-surface-hover text-hr-text-tertiary hover:text-hr-text-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Download */}
            <Button variant="primary" className="w-full mb-4" onClick={handleDownload} disabled={!resourceUrl}>
              <Download className="w-4 h-4" />
              下载到本地
            </Button>

            {/* Copy link */}
            <Button variant="secondary" className="w-full mb-6" onClick={handleCopyLink} disabled={!resourceUrl}>
              {copied ? <Check className="w-4 h-4 text-semantic-success" /> : <Copy className="w-4 h-4" />}
              {copied ? '已复制' : '复制链接'}
            </Button>

            {/* Social platforms */}
            <CapLabel as="div" className="mb-3">分享到社交平台</CapLabel>
            <div className="grid grid-cols-4 gap-3">
              {SHARE_PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleShare(p.id)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 p-3 rounded-xl',
                    'bg-surface-raised border border-hr-border-dim',
                    'hover:bg-surface-hover hover:border-hr-border transition-all'
                  )}
                >
                  <span className="text-2xl">{p.icon}</span>
                  <span className="text-[10px] font-medium text-hr-text-secondary">{p.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
