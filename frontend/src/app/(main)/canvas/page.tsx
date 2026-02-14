'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, Wand2, Layers, Loader2, Type, Image as ImageIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { CapLabel } from '@/components/ui/CapLabel';
import { PhotoUploader } from '@/components/common/PhotoUploader';
import { canvasApi } from '@/lib/api';
import { delosVariants } from '@/lib/motion';

/* ================================================================
   Canvas Entry Page — PRD §3.3

   优先级:
   1. URL 带 ?new=1 → 跳过自动跳转，直接显示创建流程
   2. 否则尝试获取最近一个 session → 自动跳转 /canvas/[id]
   3. 无历史 session → 显示双上传创建流程
   ================================================================ */

export default function CanvasPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('template');
  const forceNew = searchParams.get('new') === '1';

  // --- 自动跳转到最近 session ---
  const [checkingRecent, setCheckingRecent] = useState(!forceNew && !templateId);

  useEffect(() => {
    // 如果带 ?new=1 或 ?template=xxx，直接走创建流程
    if (forceNew || templateId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await canvasApi.listSessions(1);
        if (!cancelled && res.data?.length) {
          router.replace(`/canvas/${res.data[0].id}`);
          return;
        }
      } catch {
        // 忽略错误，走创建流程
      }
      if (!cancelled) setCheckingRecent(false);
    })();
    return () => { cancelled = true; };
  }, [forceNew, templateId, router]);

  // --- 创建流程状态 ---

  const [userPhoto, setUserPhoto] = useState<File | null>(null);
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [referenceMode, setReferenceMode] = useState<'image' | 'text'>('image');

  const handleUserPhotoSelect = useCallback((file: File) => {
    setUserPhoto(file);
    setUserPhotoUrl(URL.createObjectURL(file));
  }, []);

  const handleReferenceSelect = useCallback((file: File) => {
    setReferenceFile(file);
    setReferenceUrl(URL.createObjectURL(file));
  }, []);

  const handleStart = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);

    try {
      // Phase 0: 创建 session（后续上传需要真实 URL）
      const res = await canvasApi.openCanvas({
        template_id: templateId ?? undefined,
        subject_url: userPhotoUrl ?? undefined,
        reference_url: referenceUrl ?? undefined,
        text: textInput || undefined,
      });

      const sessionId = res.data?.session_id ?? `session_${Date.now()}`;
      const query = templateId ? `?template=${templateId}` : '';
      router.push(`/canvas/${sessionId}${query}`);
    } catch (err) {
      console.error('Failed to create canvas session:', err);
      // Fallback: 创建本地 session
      const fallbackId = `local_${Date.now()}`;
      router.push(`/canvas/${fallbackId}`);
    } finally {
      setIsCreating(false);
    }
  }, [router, templateId, userPhotoUrl, referenceUrl, textInput, isCreating]);

  // --- 正在检查最近 session，显示加载 ---
  if (checkingRecent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-accent-core" />
        <p className="text-sm text-hr-text-tertiary">正在加载画布…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-6">
      <motion.div
        {...delosVariants.fadeUp}
        className="flex flex-col items-center max-w-3xl w-full"
      >
        {/* Title */}
        <div className="w-16 h-16 rounded-2xl bg-accent-soft flex items-center justify-center mb-6">
          <Layers className="w-7 h-7 text-accent-core" />
        </div>
        <h1 className="text-2xl font-bold text-hr-text-primary text-center">
          开始你的创作
        </h1>
        <p className="text-sm text-hr-text-secondary mt-2 text-center max-w-sm">
          上传你的照片和一张参考图，AI 会分析差异并为你规划变身路径
        </p>

        {templateId && (
          <div className="flex items-center gap-2 mt-3 px-3 py-1.5 rounded-full bg-accent-soft text-accent-core text-xs font-medium">
            <Wand2 className="w-3.5 h-3.5" />
            已选择模板 · 上传照片即可开始
          </div>
        )}

        {/* Dual Upload Zones */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-10 w-full">
          {/* Zone 1: My Photo */}
          <div>
            <CapLabel as="div" className="mb-3 flex items-center gap-1.5">
              <span className="w-5 h-5 flex items-center justify-center rounded-full bg-accent-core text-white text-[10px] font-bold">1</span>
              MY PHOTO
            </CapLabel>
            <PhotoUploader
              onFileSelect={handleUserPhotoSelect}
              previewUrl={userPhotoUrl}
              onClear={() => { setUserPhoto(null); setUserPhotoUrl(null); }}
              label="我的照片"
              sublabel="上传一张你自己的照片"
              aspectRatio="aspect-[3/4]"
              requireFace
            />
          </div>

          {/* Zone 2: Reference */}
          <div>
            <CapLabel as="div" className="mb-3 flex items-center gap-1.5">
              <span className={cn(
                'w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold',
                userPhoto ? 'bg-accent-core text-white' : 'bg-surface-muted text-hr-text-tertiary'
              )}>2</span>
              REFERENCE
            </CapLabel>

            {/* Mode toggle */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-surface-raised mb-3">
              <button
                onClick={() => setReferenceMode('image')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all',
                  referenceMode === 'image'
                    ? 'bg-white text-hr-text-primary shadow-sm'
                    : 'text-hr-text-tertiary hover:text-hr-text-secondary'
                )}
              >
                <ImageIcon className="w-3 h-3" />
                参考图
              </button>
              <button
                onClick={() => setReferenceMode('text')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all',
                  referenceMode === 'text'
                    ? 'bg-white text-hr-text-primary shadow-sm'
                    : 'text-hr-text-tertiary hover:text-hr-text-secondary'
                )}
              >
                <Type className="w-3 h-3" />
                文字描述
              </button>
            </div>

            {referenceMode === 'image' ? (
              <PhotoUploader
                onFileSelect={handleReferenceSelect}
                previewUrl={referenceUrl}
                onClear={() => { setReferenceFile(null); setReferenceUrl(null); }}
                label="参考图"
                sublabel="想变成什么样？放一张参考"
                aspectRatio="aspect-[3/4]"
              />
            ) : (
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={"描述你想要的效果…\n例如：日系杂志感、冷棕色头发、电影光影"}
                rows={6}
                className={cn(
                  'w-full rounded-xl px-4 py-3 text-sm resize-none',
                  'bg-surface-raised border border-hr-border-dim',
                  'focus:border-accent-core focus:ring-1 focus:ring-accent-soft',
                  'placeholder:text-hr-text-tertiary text-hr-text-primary',
                  'outline-none transition-all aspect-[3/4] flex'
                )}
              />
            )}
          </div>
        </div>

        {/* Start Button */}
        <Button
          variant="primary"
          size="lg"
          onClick={handleStart}
          disabled={!userPhoto || isCreating}
          className="mt-8 px-8"
        >
          {isCreating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              正在创建…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              进入 AI 画布
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </Button>

        {/* Browse templates */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/p')}
          className="mt-3 text-hr-text-tertiary"
        >
          或者浏览热门模板 →
        </Button>
      </motion.div>
    </div>
  );
}
