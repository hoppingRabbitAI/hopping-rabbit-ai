'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { User, Sparkles, Loader2, ArrowRight, Play } from 'lucide-react';
import { cn } from '@/lib/cn';
import { digitalAvatarApi } from '@/lib/api/digital-avatars';
import { delosVariants } from '@/lib/motion';
import type { DigitalAvatarTemplate } from '@/types/digital-avatar';
import { AVATAR_STYLE_META } from '@/types/digital-avatar';

/* ================================================================
   AvatarGallerySection — Discover 页中的数字人形象展区
   
   横向滚动 row，点击形象打开 AvatarUseModal
   ================================================================ */

interface AvatarGallerySectionProps {
  onUseAvatar: (avatar: DigitalAvatarTemplate) => void;
}

export function AvatarGallerySection({ onUseAvatar }: AvatarGallerySectionProps) {
  const [avatars, setAvatars] = useState<DigitalAvatarTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    digitalAvatarApi
      .getGallery({ limit: 20 })
      .then((res) => {
        if (res.data?.avatars) {
          setAvatars(res.data.avatars);
        }
      })
      .catch(() => {
        // API 不可用，静默忽略
      })
      .finally(() => setLoading(false));
  }, []);

  // 如果没有已发布的数字人，不渲染这个区块
  if (!loading && avatars.length === 0) return null;

  return (
    <motion.div {...delosVariants.fadeUp} className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h2 className="text-sm font-semibold text-hr-text-primary tracking-wider uppercase">
            AI 数字人
          </h2>
          <span className="px-2 py-0.5 bg-gray-50 text-gray-600 text-xs font-medium rounded-full">
            NEW
          </span>
        </div>
        <p className="text-xs text-hr-text-tertiary">
          选择形象 → 输入脚本 → 生成口播视频
        </p>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="text-gray-400 animate-spin" />
        </div>
      ) : (
        /* Avatar Grid — 横向滚动 */
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-hide">
          {avatars.map((avatar) => (
            <AvatarCard
              key={avatar.id}
              avatar={avatar}
              onClick={() => onUseAvatar(avatar)}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ---- Avatar Card ---- */

interface AvatarCardProps {
  avatar: DigitalAvatarTemplate;
  onClick: () => void;
}

function AvatarCard({ avatar, onClick }: AvatarCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const styleMeta = avatar.style ? AVATAR_STYLE_META[avatar.style] : null;

  return (
    <motion.div
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onClick={onClick}
      className="flex-shrink-0 w-44 cursor-pointer group"
    >
      {/* Portrait */}
      <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-gray-100 mb-3 ring-1 ring-gray-200/50">
        {avatar.portrait_url ? (
          <img
            src={avatar.thumbnail_url || avatar.portrait_url}
            alt={avatar.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-100">
            <User size={36} className="text-gray-300" />
          </div>
        )}

        {/* Hover overlay */}
        <motion.div
          initial={false}
          animate={{ opacity: isHovered ? 1 : 0 }}
          className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent flex items-end p-3"
        >
          <div className="flex items-center gap-1.5 text-white text-xs font-medium">
            <Sparkles size={12} />
            开始制作
            <ArrowRight size={12} />
          </div>
        </motion.div>

        {/* Featured badge */}
        {avatar.is_featured && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-gray-700 text-white text-xs font-bold rounded-full shadow-sm">
            HOT
          </div>
        )}

        {/* Demo video play icon */}
        {avatar.demo_video_url && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-white/90 rounded-full flex items-center justify-center shadow-sm">
            <Play size={10} className="text-gray-700 ml-0.5" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-1">
        <h3 className="text-sm font-medium text-hr-text-primary truncate">
          {avatar.name}
        </h3>
        <div className="flex items-center gap-1.5 mt-1">
          {styleMeta && (
            <span className={cn('text-xs px-1.5 py-0.5 rounded-full', styleMeta.color)}>
              {styleMeta.emoji} {styleMeta.label}
            </span>
          )}
          {avatar.usage_count > 0 && (
            <span className="text-xs text-hr-text-tertiary">
              {avatar.usage_count} 次使用
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
