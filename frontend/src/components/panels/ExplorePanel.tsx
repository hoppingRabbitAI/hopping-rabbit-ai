'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Loader2, Flame, Users, Sparkles, Layers, Play, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TemplateUseModal } from '@/components/discover/TemplateUseModal';
import { CategoryFilter } from '@/components/discover/CategoryFilter';
import { trendTemplateApi } from '@/lib/api';
import { useDiscoverStore } from '@/stores/discoverStore';
import { MOCK_TEMPLATES } from '@/lib/mock-templates';
import { CATEGORY_META, CAPABILITY_LABELS } from '@/types/discover';
import { delosTransition } from '@/lib/motion';
import type { TrendTemplate, TemplateCategory } from '@/types/discover';

/* ================================================================
   ExplorePanel — Sidebar 二级面板中的 Explore 内容

   Pinterest / Higgsfield 风格瀑布流:
   - 双列 masonry 布局
   - 卡片高度由内容决定（图片自然比例）
   - hover 展示操作按钮
   - 视频卡片 hover 自动播放
   ================================================================ */

export function ExplorePanel() {
  const router = useRouter();
  const discoverStore = useDiscoverStore();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | 'all'>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<TrendTemplate | null>(null);
  const [showUseModal, setShowUseModal] = useState(false);

  const allTemplates = discoverStore.templates.length > 0
    ? discoverStore.templates
    : MOCK_TEMPLATES;

  useEffect(() => {
    if (discoverStore.templates.length === 0 && !discoverStore.isLoading) {
      discoverStore.setLoading(true);
      trendTemplateApi.listTrending({ limit: 50 })
        .then((res) => {
          if (res.data?.templates?.length) {
            discoverStore.setTemplates(res.data.templates as TrendTemplate[]);
          }
        })
        .catch(() => { /* silent fallback to mock */ })
        .finally(() => discoverStore.setLoading(false));
    }
  }, []);

  const filtered = allTemplates.filter((t) => {
    if (selectedCategory !== 'all' && t.category !== selectedCategory) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // 瀑布流分列：将卡片交替分配到两列（简单高效）
  const { colA, colB } = useMemo(() => {
    const a: TrendTemplate[] = [];
    const b: TrendTemplate[] = [];
    filtered.forEach((item, i) => {
      if (i % 2 === 0) a.push(item);
      else b.push(item);
    });
    return { colA: a, colB: b };
  }, [filtered]);

  const handleUse = useCallback((template: TrendTemplate) => {
    setSelectedTemplate(template);
    setShowUseModal(true);
  }, []);

  const handleOpenCanvas = useCallback((template: TrendTemplate) => {
    router.push(`/canvas?template=${template.id}`);
  }, [router]);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <div
          className={cn(
            'flex items-center gap-2 px-3 h-9 rounded-xl',
            'bg-surface-overlay border border-transparent',
            'focus-within:border-hr-border focus-within:bg-white',
            'transition-all duration-200',
          )}
        >
          <Search className="w-3.5 h-3.5 text-hr-text-tertiary shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="flex-1 bg-transparent text-xs text-hr-text-primary placeholder:text-hr-text-tertiary outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-0.5 rounded text-hr-text-tertiary hover:text-hr-text-primary transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Category Filter — horizontal scroll */}
      <div className="px-4 pb-2 overflow-x-auto scrollbar-none">
        <CategoryFilter
          selected={selectedCategory}
          onChange={setSelectedCategory}
        />
      </div>

      {/* Masonry Grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {discoverStore.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 text-hr-text-tertiary animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-xs text-hr-text-tertiary">没有找到匹配的模板</p>
          </div>
        ) : (
          <div className="flex gap-3">
            {/* Column A */}
            <div className="flex-1 flex flex-col gap-3">
              {colA.map((template) => (
                <MasonryCard
                  key={template.id}
                  template={template}
                  onUse={handleUse}
                  onOpenCanvas={handleOpenCanvas}
                />
              ))}
            </div>
            {/* Column B */}
            <div className="flex-1 flex flex-col gap-3">
              {colB.map((template) => (
                <MasonryCard
                  key={template.id}
                  template={template}
                  onUse={handleUse}
                  onOpenCanvas={handleOpenCanvas}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Use Modal */}
      {selectedTemplate && (
        <TemplateUseModal
          template={selectedTemplate}
          isOpen={showUseModal}
          onClose={() => {
            setShowUseModal(false);
            setSelectedTemplate(null);
          }}
          onConfirm={() => {
            setShowUseModal(false);
            setSelectedTemplate(null);
          }}
        />
      )}
    </div>
  );
}

/* ================================================================
   MasonryCard — 瀑布流卡片

   Higgsfield 风格：
   - 图片/视频自然比例（不固定 aspect-ratio）
   - 圆角卡片 + 微阴影
   - hover: 暗色渐变遮罩 + 操作按钮浮现
   - 视频 hover 自动播放
   - 底部: 模板名称 + 使用计数
   ================================================================ */

interface MasonryCardProps {
  template: TrendTemplate;
  onUse: (template: TrendTemplate) => void;
  onOpenCanvas: (template: TrendTemplate) => void;
}

function MasonryCard({ template, onUse, onOpenCanvas }: MasonryCardProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const meta = CATEGORY_META[template.category];
  const formattedCount = template.usage_count >= 10000
    ? `${(template.usage_count / 10000).toFixed(1)}w`
    : template.usage_count >= 1000
      ? `${(template.usage_count / 1000).toFixed(1)}k`
      : String(template.usage_count);

  // hover 时播放视频
  useEffect(() => {
    if (!videoRef.current) return;
    if (isHovered) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [isHovered]);

  // 根据输出比例决定图片容器比例
  const aspectClass = template.output_aspect_ratio === '9:16'
    ? 'aspect-[9/16]'
    : template.output_aspect_ratio === '16:9'
      ? 'aspect-[16/9]'
      : 'aspect-[4/5]';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={delosTransition.micro}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => router.push(`/template/${template.id}`)}
      className={cn(
        'group relative rounded-2xl overflow-hidden cursor-pointer',
        'bg-surface-overlay',
        'transition-shadow duration-300',
        'hover:shadow-card-hover',
      )}
    >
      {/* Media */}
      <div className={cn('relative w-full overflow-hidden', aspectClass)}>
        {/* Thumbnail image */}
        {template.thumbnail_url && (
          <img
            src={template.thumbnail_url}
            alt={template.name}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            className={cn(
              'absolute inset-0 w-full h-full object-cover',
              'transition-opacity duration-300',
              !imageLoaded && 'opacity-0',
            )}
          />
        )}

        {/* Video overlay (only loads on hover for perf) */}
        {template.preview_video_url && isHovered && (
          <video
            ref={videoRef}
            src={template.preview_video_url}
            muted
            loop
            playsInline
            poster={template.thumbnail_url}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Skeleton placeholder */}
        {!imageLoaded && (
          <div className="absolute inset-0 bg-surface-muted animate-pulse" />
        )}

        {/* Play indicator for video templates */}
        {template.preview_video_url && !isHovered && (
          <div className="absolute top-2.5 right-2.5">
            <div className="w-6 h-6 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
              <Play className="w-3 h-3 text-white fill-white" />
            </div>
          </div>
        )}

        {/* Trending badge */}
        {template.usage_count >= 30000 && (
          <div className="absolute top-2.5 left-2.5">
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/90 text-white backdrop-blur-sm">
              <Flame className="w-2.5 h-2.5" />
              Hot
            </span>
          </div>
        )}

        {/* Hover overlay */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent flex flex-col justify-end p-3 gap-1.5"
            >
              <button
                onClick={(e) => { e.stopPropagation(); onUse(template); }}
                className={cn(
                  'w-full flex items-center justify-center gap-1.5 py-2 rounded-xl',
                  'bg-accent-core text-white text-xs font-medium',
                  'hover:bg-accent-hover transition-colors',
                  'shadow-accent-glow',
                )}
              >
                <Sparkles className="w-3.5 h-3.5" />
                用我的脸
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onOpenCanvas(template); }}
                className={cn(
                  'w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl',
                  'bg-white/15 backdrop-blur-sm text-white text-[11px] font-medium',
                  'hover:bg-white/25 transition-colors border border-white/20',
                )}
              >
                <Layers className="w-3 h-3" />
                在画布中打开
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info — compact */}
      <div className="px-2.5 py-2 flex flex-col gap-1">
        <h3 className="text-xs font-medium text-hr-text-primary line-clamp-1">
          {template.name}
        </h3>
        <div className="flex items-center justify-between">
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
              meta.color,
            )}
          >
            {meta.emoji} {meta.label}
          </span>
          <span className="flex items-center gap-0.5 text-[10px] text-hr-text-tertiary font-mono">
            <Users className="w-2.5 h-2.5" />
            {formattedCount}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
