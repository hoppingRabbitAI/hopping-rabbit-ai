'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, Layers } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TemplateCard } from '@/components/discover/TemplateCard';
import { TemplateUseModal } from '@/components/discover/TemplateUseModal';
import { trendTemplateApi } from '@/lib/api';
import { useDiscoverStore } from '@/stores/discoverStore';
import { MOCK_TEMPLATES } from '@/lib/mock-templates';
import type { TrendTemplate } from '@/types/discover';

/* ================================================================
   TemplatesPanel — Sidebar 二级面板中的模板管理

   展示用户可用的模板列表（官方 + UGC）
   ================================================================ */

interface TemplatesPanelProps {
  /** 紧凑模式 — 嵌入 sidebar 时单列展示 */
  compact?: boolean;
}

export function TemplatesPanel({ compact = false }: TemplatesPanelProps) {
  const router = useRouter();
  const discoverStore = useDiscoverStore();
  const [search, setSearch] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<TrendTemplate | null>(null);
  const [showUseModal, setShowUseModal] = useState(false);

  const templates = discoverStore.templates.length > 0
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
        .catch(() => {})
        .finally(() => discoverStore.setLoading(false));
    }
  }, []);

  const filtered = templates.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleUse = useCallback((template: TrendTemplate) => {
    setSelectedTemplate(template);
    setShowUseModal(true);
  }, []);

  const handleOpenCanvas = useCallback((template: TrendTemplate) => {
    router.push(`/canvas?template=${template.id}`);
  }, [router]);

  return (
    <div className="flex flex-col h-full">
      {/* Header Info */}
      <div className={cn('pt-3 pb-2', compact ? 'px-3' : 'px-4')}>
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-accent-core" />
          <span className="text-xs text-hr-text-secondary">
            {templates.length} templates
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-hr-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模板..."
            className={cn(
              'w-full pl-9 pr-3 py-2 rounded-lg text-xs',
              'bg-surface-overlay border border-hr-border-dim',
              'text-hr-text-primary placeholder:text-hr-text-tertiary',
              'focus:outline-none focus:border-hr-border-accent',
              'transition-colors',
            )}
          />
        </div>
      </div>

      {/* Template List */}
      <div className={cn('flex-1 overflow-y-auto pb-4', compact ? 'px-3' : 'px-4')}>
        {discoverStore.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 text-hr-text-tertiary animate-spin" />
          </div>
        ) : (
          <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-2')}>
            {filtered.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onUse={handleUse}
                onOpenCanvas={handleOpenCanvas}
              />
            ))}
          </div>
        )}
      </div>

      {selectedTemplate && (
        <TemplateUseModal
          template={selectedTemplate}
          isOpen={showUseModal}
          onClose={() => {
            setShowUseModal(false);
            setSelectedTemplate(null);
          }}
          onConfirm={(template, file) => {
            setShowUseModal(false);
            setSelectedTemplate(null);
          }}
        />
      )}
    </div>
  );
}
