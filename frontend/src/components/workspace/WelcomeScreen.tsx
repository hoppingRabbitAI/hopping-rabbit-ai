'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, Layers } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { TemplateUseModal } from '@/components/discover/TemplateUseModal';
import { trendTemplateApi } from '@/lib/api';
import { useDiscoverStore } from '@/stores/discoverStore';
import { MOCK_TEMPLATES } from '@/lib/mock-templates';
import { delosTransition } from '@/lib/motion';
import type { TrendTemplate } from '@/types/discover';

/* ================================================================
   WelcomeScreen — Explore 主页面（极简封面墙）

   ★ 只展示封面瀑布流，无 hero / 搜索 / 分类
   - 4 列 masonry grid，铺满主内容区
   - 卡片：封面图 + 名称，hover 操作
   - 临时占位图：/mock-cover.jpg
   ================================================================ */

/** ★ 开发阶段占位封面 — 后续替换为真实模板缩略图 */
const PLACEHOLDER_COVER = '/mock-cover.jpg';

interface WelcomeScreenProps {
  projectId?: string;
  onOpenExplore?: () => void;
  autoScrollToGrid?: boolean;
}

export function WelcomeScreen(_props: WelcomeScreenProps = {}) {
  const router = useRouter();
  const discoverStore = useDiscoverStore();

  const [selectedTemplate, setSelectedTemplate] = useState<TrendTemplate | null>(null);
  const [showUseModal, setShowUseModal] = useState(false);

  // 获取模板数据 — mock 时复制 3 遍凑 30 条
  const allTemplates = useMemo(() => {
    const base = discoverStore.templates.length > 0
      ? discoverStore.templates
      : MOCK_TEMPLATES;
    // 开发阶段多铺点数据
    return [
      ...base,
      ...base.map(t => ({ ...t, id: `${t.id}-b` })),
      ...base.map(t => ({ ...t, id: `${t.id}-c` })),
    ];
  }, [discoverStore.templates]);

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

  // 瀑布流分列 — 5 列（xl 以下 CSS 自动隐藏多余列）
  const columns = useMemo(() => {
    const cols: TrendTemplate[][] = [[], [], [], [], []];
    allTemplates.forEach((item, i) => cols[i % 5].push(item));
    return cols;
  }, [allTemplates]);

  const handleUseTemplate = useCallback((template: TrendTemplate) => {
    setSelectedTemplate(template);
    setShowUseModal(true);
  }, []);

  const handleOpenCanvas = useCallback((template: TrendTemplate) => {
    router.push(`/canvas?template=${template.id}`);
  }, [router]);

  return (
    <div className="h-full overflow-y-auto">
      {/* Masonry Grid — 紧凑铺满 */}
      <div className="p-2">
        <div>
          {discoverStore.isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-5 h-5 text-hr-text-tertiary animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5">
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="flex flex-col gap-1.5">
                  {col.map((template, rowIdx) => (
                    <CoverCard
                      key={template.id}
                      template={template}
                      index={colIdx * 10 + rowIdx}
                      onUse={handleUseTemplate}
                      onOpenCanvas={handleOpenCanvas}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
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
   CoverCard — 极简封面卡片

   - 封面图（统一占位）
   - 底部：名称
   - hover：暗色遮罩 + 操作按钮
   ================================================================ */

/** 随机高度比例 — 模拟真实瀑布流的参差感 */
const ASPECT_RATIOS = [
  'aspect-[3/4]',
  'aspect-[4/5]',
  'aspect-[2/3]',
  'aspect-[3/4]',
  'aspect-[5/6]',
  'aspect-[4/5]',
  'aspect-[3/5]',
  'aspect-[4/5]',
];

interface CoverCardProps {
  template: TrendTemplate;
  index: number;
  onUse: (template: TrendTemplate) => void;
  onOpenCanvas: (template: TrendTemplate) => void;
}

function CoverCard({ template, index, onUse, onOpenCanvas }: CoverCardProps) {
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const aspectClass = ASPECT_RATIOS[index % ASPECT_RATIOS.length];
  // ★ 开发阶段：mock thumbnail 路径不存在，统一用占位图
  const coverUrl = PLACEHOLDER_COVER;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...delosTransition.micro, delay: index * 0.03 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => router.push(`/template/${template.id}`)}
      className={cn(
        'group relative rounded-lg overflow-hidden cursor-pointer',
        'bg-surface-muted',
        'transition-shadow duration-300',
        'hover:shadow-md hover:shadow-black/8',
      )}
    >
      {/* Cover Image */}
      <div className={cn('relative w-full overflow-hidden', aspectClass)}>
        <img
          src={coverUrl}
          alt={template.name}
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
          className={cn(
            'absolute inset-0 w-full h-full object-cover',
            'transition-all duration-500',
            !imageLoaded && 'opacity-0 scale-105',
            isHovered && 'scale-105',
          )}
        />

        {/* Skeleton */}
        {!imageLoaded && (
          <div className="absolute inset-0 bg-surface-muted animate-pulse" />
        )}

        {/* Hover overlay */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent flex flex-col justify-end p-2.5 gap-1.5"
            >
              <button
                onClick={(e) => { e.stopPropagation(); onUse(template); }}
                className={cn(
                  'w-full flex items-center justify-center gap-1.5 py-2 rounded-lg',
                  'bg-white text-hr-text-primary text-xs font-medium',
                  'hover:bg-gray-50 transition-colors',
                )}
              >
                <Sparkles className="w-3.5 h-3.5" />
                使用模板
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Name — minimal */}
      <div className="px-1.5 py-1">
        <p className="text-[11px] text-hr-text-primary font-medium line-clamp-1 leading-tight">
          {template.name}
        </p>
      </div>
    </motion.div>
  );
}
