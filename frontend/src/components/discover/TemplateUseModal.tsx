'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowRight, Sparkles, Coins, Loader2, CheckCircle, AlertCircle, Download, Share2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { CapLabel } from '@/components/ui/CapLabel';
import { PhotoUploader } from '@/components/common/PhotoUploader';
import type { TrendTemplate } from '@/types/discover';
import { CATEGORY_META, CAPABILITY_LABELS, CAPABILITY_ICONS } from '@/types/discover';
import { createFaceSwapTask, getAITaskStatus } from '@/lib/api/kling-tasks';
import type { AITaskResponse } from '@/lib/api/kling-tasks';
import { API_BASE_URL, ensureValidToken } from '@/lib/api/client';

/* ================================================================
   TemplateUseModal — PRD §3.2 使用模板弹窗
   
   STEP 1 → 选择照片（PhotoUploader）
   STEP 2 → AI 换脸生成 → 展示结果
   
   链路：上传照片 → face_swap API → 轮询任务 → 展示结果视频
   ================================================================ */

type ModalStep = 'upload' | 'processing' | 'result' | 'error';

interface TemplateUseModalProps {
  template: TrendTemplate | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (template: TrendTemplate, referenceFile: File) => void;
}

/** 上传图片到后端并返回公网 URL */
async function uploadImageFile(file: File): Promise<string> {
  let uploadFile: File | Blob = file;
  let ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';

  // 非标准格式转 JPEG
  const SUPPORTED = ['png', 'jpg', 'jpeg', 'webp'];
  if (!SUPPORTED.includes(ext)) {
    const canvas = document.createElement('canvas');
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = objectUrl;
    });
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    URL.revokeObjectURL(objectUrl);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('转换失败'))), 'image/jpeg', 0.92);
    });
    uploadFile = blob;
    ext = 'jpg';
  }

  const formData = new FormData();
  formData.append('file', uploadFile, `face_photo.${ext}`);
  formData.append('prefix', 'face-swap');

  const token = await ensureValidToken();
  const response = await fetch(`${API_BASE_URL}/upload/image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || '照片上传失败');
  }

  const data = await response.json();
  return data.url;
}

export function TemplateUseModal({ template, isOpen, onClose, onConfirm }: TemplateUseModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [step, setStep] = useState<ModalStep>('upload');
  const [statusMessage, setStatusMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 清理轮询定时器
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }, []);

  const handleClear = useCallback(() => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }, [previewUrl]);

  const resetState = useCallback(() => {
    setStep('upload');
    setStatusMessage('');
    setProgress(0);
    setResultVideoUrl(null);
    setErrorMessage('');
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    handleClear();
    resetState();
    onClose();
  }, [onClose, handleClear, resetState]);

  /** 轮询任务状态 */
  const pollTaskStatus = useCallback((taskId: string) => {
    let attempts = 0;
    const MAX_ATTEMPTS = 120; // 最多轮询 4 分钟（2s间隔）

    pollTimerRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setStep('error');
        setErrorMessage('生成超时，请稍后重试');
        return;
      }

      try {
        const task: AITaskResponse = await getAITaskStatus(taskId);

        if (task.status === 'processing') {
          setProgress(Math.min(task.progress * 100, 95));
          setStatusMessage(task.status_message || 'AI 正在生成你的专属视频…');
        } else if (task.status === 'completed') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setProgress(100);
          setResultVideoUrl(task.output_url || null);
          setStep('result');
        } else if (task.status === 'failed') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setStep('error');
          setErrorMessage(task.error_message || '生成失败，请重试');
        }
      } catch {
        // 网络错误不中断轮询，等下次重试
      }
    }, 2000);
  }, []);

  /** 核心流程：上传照片 → 调用换脸 → 轮询结果 */
  const handleStartGeneration = useCallback(async () => {
    if (!template || !selectedFile) return;

    // 需要模板缩略图作为源图片
    if (!template.thumbnail_url) {
      // 没有缩略图，回退到旧逻辑（跳转画布）
      onConfirm(template, selectedFile);
      return;
    }

    setStep('processing');
    setProgress(5);
    setStatusMessage('正在上传你的照片…');

    try {
      // Step 1: 上传照片
      const faceImageUrl = await uploadImageFile(selectedFile);
      setProgress(20);
      setStatusMessage('照片已上传，正在启动 AI 换脸…');

      // Step 2: 调用换脸 API（使用模板缩略图作为源图片）
      const result = await createFaceSwapTask({
        source_image_url: template.thumbnail_url,
        face_image_url: faceImageUrl,
        generate_video: !!template.preview_video_url,
      });

      if (!result.success || !result.task_id) {
        throw new Error(result.message || '创建换脸任务失败');
      }

      setProgress(30);
      setStatusMessage('AI 正在处理，请稍候…');

      // Step 3: 轮询任务状态
      pollTaskStatus(result.task_id);
    } catch (err) {
      setStep('error');
      setErrorMessage(err instanceof Error ? err.message : '处理失败，请重试');
    }
  }, [template, selectedFile, onConfirm, pollTaskStatus]);

  /** 重试 */
  const handleRetry = useCallback(() => {
    resetState();
    // 保留已选照片，回到上传步骤
    setStep('upload');
  }, [resetState]);

  /** 下载结果 */
  const handleDownload = useCallback(() => {
    if (!resultVideoUrl) return;
    const a = document.createElement('a');
    a.href = resultVideoUrl;
    a.download = `lepus-${template?.name || 'result'}.mp4`;
    a.click();
  }, [resultVideoUrl, template]);

  if (!template) return null;

  const meta = CATEGORY_META[template.category];
  const totalCredits = template.route.reduce((sum, s) => sum + (s.estimated_credits ?? 0), 0);

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
            onClick={step === 'processing' ? undefined : handleClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className={cn(
              'relative w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-modal',
              'border border-hr-border-dim overflow-hidden'
            )}
          >
            {/* Close button (隐藏在处理中) */}
            {step !== 'processing' && (
              <button
                onClick={handleClose}
                className="absolute top-4 right-4 z-10 p-1.5 rounded-lg hover:bg-surface-hover text-hr-text-tertiary hover:text-hr-text-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* ======== STEP: upload ======== */}
            {step === 'upload' && (
              <div className="flex flex-col sm:flex-row">
                {/* Left: Template Info */}
                <div className="sm:w-1/2 p-6">
                  <div className="aspect-[4/5] rounded-xl bg-surface-muted overflow-hidden mb-4">
                    {template.preview_video_url ? (
                      <video
                        src={template.preview_video_url}
                        muted loop playsInline autoPlay
                        poster={template.thumbnail_url}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-surface-overlay to-surface-muted flex items-center justify-center">
                        <span className="text-4xl">{meta.emoji}</span>
                      </div>
                    )}
                  </div>

                  <h3 className="text-lg font-semibold text-hr-text-primary">{template.name}</h3>

                  {/* Route steps chain */}
                  <div className="mt-3 space-y-1.5">
                    <CapLabel>ROUTE · {template.route.length} STEPS</CapLabel>
                    {template.route.map((step, i) => (
                      <div key={`${step.capability}-${i}`} className="flex items-center gap-2">
                        <span className="w-5 h-5 flex items-center justify-center rounded-full bg-surface-raised text-[10px] font-mono text-hr-text-tertiary border border-hr-border-dim">
                          {i + 1}
                        </span>
                        <span className="text-xs">{CAPABILITY_ICONS[step.capability]}</span>
                        <span className="text-[12px] text-hr-text-secondary">{CAPABILITY_LABELS[step.capability]}</span>
                        {step.estimated_credits && (
                          <span className="text-[10px] font-mono text-hr-text-tertiary ml-auto">{step.estimated_credits}cr</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {totalCredits > 0 && (
                    <div className="flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg bg-accent-soft">
                      <Coins className="w-3.5 h-3.5 text-accent-core" />
                      <span className="text-[12px] font-medium text-accent-core">预计 {totalCredits} Credits</span>
                    </div>
                  )}
                </div>

                {/* Right: Upload Zone */}
                <div className="sm:w-1/2 p-6 bg-surface-raised border-t sm:border-t-0 sm:border-l border-hr-border-dim">
                  <CapLabel as="div" className="mb-3 flex items-center gap-1.5">
                    <span className="w-4 h-4 flex items-center justify-center rounded-full bg-accent-core text-white text-[9px] font-bold">1</span>
                    UPLOAD YOUR PHOTO
                  </CapLabel>

                  <PhotoUploader
                    onFileSelect={handleFileSelect}
                    previewUrl={previewUrl}
                    onClear={handleClear}
                    label="我的照片"
                    sublabel="上传一张你自己的照片"
                    aspectRatio="aspect-[4/5]"
                    requireFace
                  />

                  <div className="mt-4 mb-3">
                    <CapLabel as="div" className="flex items-center gap-1.5">
                      <span className={cn(
                        'w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold',
                        selectedFile ? 'bg-accent-core text-white' : 'bg-surface-muted text-hr-text-tertiary'
                      )}>2</span>
                      START TRANSFORMATION
                    </CapLabel>
                  </div>

                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleStartGeneration}
                    disabled={!selectedFile}
                    className="w-full"
                  >
                    <Sparkles className="w-4 h-4" />
                    {template.preview_video_url ? '用我的脸生成' : '开始变身'}
                    <ArrowRight className="w-4 h-4" />
                  </Button>

                  {!template.preview_video_url && (
                    <p className="text-[11px] text-hr-text-tertiary mt-2 text-center">
                      此模板暂无预览视频，将跳转画布编辑
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ======== STEP: processing ======== */}
            {step === 'processing' && (
              <div className="p-8 flex flex-col items-center justify-center min-h-[400px]">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="w-16 h-16 rounded-full bg-accent-soft flex items-center justify-center mb-6"
                >
                  <Loader2 className="w-8 h-8 text-accent-core animate-spin" />
                </motion.div>

                <h3 className="text-lg font-semibold text-hr-text-primary mb-2">AI 正在为你生成</h3>
                <p className="text-sm text-hr-text-secondary mb-6 text-center max-w-xs">{statusMessage}</p>

                {/* Progress bar */}
                <div className="w-full max-w-xs">
                  <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-accent-core rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[11px] text-hr-text-tertiary">处理中</span>
                    <span className="text-[11px] font-mono text-hr-text-secondary">{Math.round(progress)}%</span>
                  </div>
                </div>

                <p className="text-[11px] text-hr-text-tertiary mt-6">
                  预计需要 30-120 秒，请耐心等待
                </p>
              </div>
            )}

            {/* ======== STEP: result ======== */}
            {step === 'result' && (
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle className="w-5 h-5 text-semantic-success" />
                  <h3 className="text-lg font-semibold text-hr-text-primary">生成完成！</h3>
                </div>

                {/* Result video */}
                <div className="aspect-video rounded-xl bg-surface-muted overflow-hidden mb-4 border border-hr-border-dim">
                  {resultVideoUrl ? (
                    <video
                      src={resultVideoUrl}
                      controls
                      autoPlay
                      loop
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-hr-text-tertiary">
                      <p className="text-sm">视频加载中…</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <Button variant="primary" size="lg" className="flex-1" onClick={handleDownload}>
                    <Download className="w-4 h-4" />
                    下载视频
                  </Button>
                  <Button variant="secondary" size="lg" className="flex-1" onClick={handleRetry}>
                    <RotateCcw className="w-4 h-4" />
                    换张照片再试
                  </Button>
                </div>
              </div>
            )}

            {/* ======== STEP: error ======== */}
            {step === 'error' && (
              <div className="p-8 flex flex-col items-center justify-center min-h-[300px]">
                <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
                  <AlertCircle className="w-7 h-7 text-red-500" />
                </div>
                <h3 className="text-lg font-semibold text-hr-text-primary mb-2">生成失败</h3>
                <p className="text-sm text-hr-text-secondary mb-6 text-center max-w-xs">{errorMessage}</p>
                <div className="flex items-center gap-3">
                  <Button variant="primary" onClick={handleRetry}>
                    <RotateCcw className="w-4 h-4" />
                    重试
                  </Button>
                  <Button variant="secondary" onClick={handleClose}>
                    关闭
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
