'use client';

/**
 * 视觉元素分离向导弹窗
 *
 * 功能：
 *   1. 分离类型选择（背景/人物 · 人物/服饰）
 *   2. 源图预览
 *   3. 提交 → 进度轮询（环形进度）
 *   4. 完成 → 三层结果预览（前景 / 背景 / mask）
 *   5. 确认 → 在画布上插入分离后的子节点
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Layers3,
  User,
  Mountain,
  Shirt,
  Gem,
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';
import {
  startSeparation,
  pollSeparationUntilDone,
  SEPARATION_TYPE_LABELS,
  SEPARATION_TYPE_DESCRIPTIONS,
} from '@/lib/api/separation';
import type { SeparationType, SeparationTaskResult } from '@/lib/api/separation';

// ==========================================
// 类型
// ==========================================

type WizardPhase = 'select' | 'processing' | 'completed' | 'failed';

interface SeparationWizardModalProps {
  open: boolean;
  onClose: () => void;
  /** 源图 URL（clip 缩略图或视频帧截图） */
  imageUrl: string;
  /** 关联的 clip ID */
  clipId?: string;
  /** 关联的 shot ID */
  shotId?: string;
  /** 分离完成回调 */
  onComplete?: (result: SeparationTaskResult) => void;
  /** 初始分离类型（从右键菜单选择来的） */
  initialType?: SeparationType;
}

// ==========================================
// 分离类型卡片配置
// ==========================================

const SEPARATION_CARDS: {
  type: SeparationType;
  icon: React.ReactNode;
  layers: { name: string; icon: React.ReactNode; color: string }[];
  ready: boolean;
}[] = [
  {
    type: 'person_background',
    icon: <Layers size={22} className="text-gray-600" />,
    layers: [
      { name: '前景人物', icon: <User size={14} />, color: 'text-gray-600 bg-gray-50' },
      { name: '背景场景', icon: <Mountain size={14} />, color: 'text-gray-600 bg-gray-50' },
    ],
    ready: true,
  },
  {
    type: 'person_clothing',
    icon: <Shirt size={22} className="text-gray-600" />,
    layers: [
      { name: '人物身体', icon: <User size={14} />, color: 'text-gray-600 bg-gray-50' },
      { name: '服饰配件', icon: <Shirt size={14} />, color: 'text-gray-600 bg-gray-50' },
    ],
    ready: true,
  },
  {
    type: 'person_accessory',
    icon: <Gem size={22} className="text-gray-600" />,
    layers: [
      { name: '人物主体', icon: <User size={14} />, color: 'text-gray-600 bg-gray-50' },
      { name: '配饰层', icon: <Gem size={14} />, color: 'text-gray-600 bg-gray-50' },
    ],
    ready: true,
  },
  {
    type: 'layer_separation',
    icon: <Layers3 size={22} className="text-gray-600" />,
    layers: [
      { name: '前景层', icon: <User size={14} />, color: 'text-gray-600 bg-gray-50' },
      { name: '中景层', icon: <Layers size={14} />, color: 'text-gray-600 bg-gray-50' },
      { name: '后景层', icon: <Mountain size={14} />, color: 'text-gray-600 bg-gray-50' },
    ],
    ready: true,
  },
];

// ==========================================
// 组件
// ==========================================

export default function SeparationWizardModal({
  open,
  onClose,
  imageUrl,
  clipId,
  shotId,
  onComplete,
  initialType,
}: SeparationWizardModalProps) {
  // 阶段状态
  const [phase, setPhase] = useState<WizardPhase>('select');
  const [selectedType, setSelectedType] = useState<SeparationType | null>(initialType ?? null);

  // 进度
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  // 结果
  const [result, setResult] = useState<SeparationTaskResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // 预览层可见性
  const [showForeground, setShowForeground] = useState(true);
  const [showBackground, setShowBackground] = useState(true);
  const [showMask, setShowMask] = useState(false);
  // 增强 before/after 对比
  const [showEnhanced, setShowEnhanced] = useState(true);

  // ref 防止重复提交
  const isSubmitting = useRef(false);

  // 如果 initialType 指定了，自动开始
  useEffect(() => {
    if (open && initialType && imageUrl) {
      setSelectedType(initialType);
      // 留一帧让用户看到选中状态后自动开始
      const timer = setTimeout(() => handleStart(initialType), 300);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialType]);

  // 重置状态
  useEffect(() => {
    if (!open) {
      // 延迟重置，等关闭动画结束
      const timer = setTimeout(() => {
        setPhase('select');
        setSelectedType(initialType ?? null);
        setProgress(0);
        setStatusMessage('');
        setResult(null);
        setErrorMessage('');
        setShowForeground(true);
        setShowBackground(true);
        setShowMask(false);
        setShowEnhanced(true);
        isSubmitting.current = false;
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [open, initialType]);

  // ==========================================
  // 开始分离
  // ==========================================
  const handleStart = useCallback(async (type?: SeparationType) => {
    const sepType = type ?? selectedType;
    if (!sepType || !imageUrl || isSubmitting.current) return;

    isSubmitting.current = true;
    setPhase('processing');
    setProgress(5);
    setStatusMessage('正在提交分离任务...');

    try {
      // 1. 提交任务
      const { task_id } = await startSeparation({
        image_url: imageUrl,
        separation_type: sepType,
        clip_id: clipId,
        shot_id: shotId,
      });

      setProgress(10);
      setStatusMessage('任务已创建，正在分析图像...');

      // 2. 轮询直到完成
      const taskResult = await pollSeparationUntilDone(
        task_id,
        (intermediate) => {
          setProgress(intermediate.progress);
          setStatusMessage(intermediate.status_message || '处理中...');
        },
        2000,
        120_000,
      );

      // 3. 处理结果
      if (taskResult.status === 'completed') {
        setResult(taskResult);
        setPhase('completed');
        setProgress(100);
        setStatusMessage('分离完成！');
      } else {
        setErrorMessage(taskResult.error_message || '分离失败，请重试');
        setPhase('failed');
      }
    } catch (err: any) {
      console.error('[SeparationWizard] 分离失败:', err);
      setErrorMessage(err.message || '分离失败');
      setPhase('failed');
    } finally {
      isSubmitting.current = false;
    }
  }, [selectedType, imageUrl, clipId, shotId]);

  // ==========================================
  // 确认使用分离结果
  // ==========================================
  const handleConfirm = useCallback(() => {
    if (result) {
      onComplete?.(result);
    }
    onClose();
  }, [result, onComplete, onClose]);

  // ==========================================
  // 重试
  // ==========================================
  const handleRetry = useCallback(() => {
    isSubmitting.current = false;
    setPhase('select');
    setProgress(0);
    setErrorMessage('');
    setResult(null);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* 弹窗 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-[540px] max-h-[85vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gray-800 flex items-center justify-center shadow-sm">
              <Layers size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800">视觉元素分离</h2>
              <p className="text-xs text-gray-400">
                {phase === 'select' && '选择分离方式'}
                {phase === 'processing' && '正在处理...'}
                {phase === 'completed' && '分离完成'}
                {phase === 'failed' && '分离失败'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ★ 阶段 1: 选择分离类型 */}
          {phase === 'select' && (
            <div className="space-y-5">
              {/* 源图预览 */}
              <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="源图"
                  className="w-full h-48 object-contain bg-checkered"
                />
                <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 rounded-md text-[11px] text-white/80">
                  源素材
                </div>
              </div>

              {/* 分离类型选择 */}
              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-600">选择分离方式</div>
                <div className="grid grid-cols-1 gap-3">
                  {SEPARATION_CARDS.map((card) => (
                    <button
                      key={card.type}
                      className={`
                        w-full text-left px-4 py-4 rounded-xl border-2 transition-all
                        ${selectedType === card.type
                          ? 'border-gray-900 bg-gray-50/50 shadow-sm'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/30'
                        }
                      `}
                      onClick={() => setSelectedType(card.type)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 w-10 h-10 rounded-lg flex items-center justify-center ${
                          selectedType === card.type ? 'bg-gray-100' : 'bg-gray-100'
                        }`}>
                          {card.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-800">
                              {SEPARATION_TYPE_LABELS[card.type]}
                            </span>
                            {!card.ready && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded-full">
                                即将支持
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {SEPARATION_TYPE_DESCRIPTIONS[card.type]}
                          </p>
                          {/* 产出图层预览 */}
                          <div className="flex gap-2 mt-2">
                            {card.layers.map((layer) => (
                              <div key={layer.name} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium ${layer.color}`}>
                                {layer.icon}
                                {layer.name}
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* 选中指示器 */}
                        <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          selectedType === card.type 
                            ? 'border-gray-800 bg-gray-800' 
                            : 'border-gray-300'
                        }`}>
                          {selectedType === card.type && (
                            <CheckCircle2 size={14} className="text-white" />
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 提示信息 */}
              <div className="flex items-start gap-2 px-3 py-2.5 bg-gray-50 rounded-lg">
                <Sparkles size={14} className="text-gray-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-gray-700 leading-relaxed">
                  分离后的图层将作为子节点插入画布，你可以独立编辑前景和背景。
                  预计处理时间 5~15 秒。
                </p>
              </div>
            </div>
          )}

          {/* ★ 阶段 2: 处理中 */}
          {phase === 'processing' && (
            <div className="flex flex-col items-center py-8 space-y-6">
              {/* 源图（缩小） */}
              <div className="relative w-48 h-32 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="源图" className="w-full h-full object-contain bg-gray-50" />
              </div>

              {/* 进度环 */}
              <div className="relative w-28 h-28">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="#e5e7eb" strokeWidth="6" />
                  <circle
                    cx="50" cy="50" r="42" fill="none" stroke="url(#progress-grad)"
                    strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={`${progress * 2.639} 263.9`}
                    className="transition-all duration-500"
                  />
                  <defs>
                    <linearGradient id="progress-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#6b7280" />
                      <stop offset="100%" stopColor="#4b5563" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-gray-800">{progress}%</span>
                </div>
              </div>

              {/* 状态文字 */}
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={14} className="animate-spin text-gray-500" />
                {statusMessage}
              </div>
            </div>
          )}

          {/* ★ 阶段 3: 分离完成 */}
          {phase === 'completed' && result && (
            <div className="space-y-5">
              {/* 成功标识 */}
              <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 rounded-lg">
                <CheckCircle2 size={16} className="text-gray-500" />
                <span className="text-sm text-gray-700 font-medium">分离完成</span>
                <span className="text-xs text-gray-600">
                  {result.original_width}×{result.original_height}
                </span>
              </div>

              {/* 三层预览 */}
              <div className="space-y-3">
                {/* 前景（含增强 before/after 对比） */}
                {result.foreground_url && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-gray-600" />
                        <span className="text-xs font-semibold text-gray-700">前景人物</span>
                        {result.enhanced_foreground_url && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-medium rounded-full">
                            <Sparkles size={10} />
                            已增强
                          </span>
                        )}
                      </div>
                      <button
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                        onClick={() => setShowForeground(!showForeground)}
                      >
                        {showForeground ? <Eye size={14} className="text-gray-500" /> : <EyeOff size={14} className="text-gray-300" />}
                      </button>
                    </div>
                    {showForeground && (
                      <>
                        {result.enhanced_foreground_url ? (
                          <div>
                            {/* Before / After 切换 */}
                            <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-50/80 border-b border-gray-100">
                              <button
                                onClick={() => setShowEnhanced(false)}
                                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                                  !showEnhanced
                                    ? 'bg-white text-gray-800 shadow-sm'
                                    : 'text-gray-400 hover:text-gray-600'
                                }`}
                              >
                                原始
                              </button>
                              <button
                                onClick={() => setShowEnhanced(true)}
                                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                                  showEnhanced
                                    ? 'bg-indigo-50 text-indigo-700 shadow-sm'
                                    : 'text-gray-400 hover:text-gray-600'
                                }`}
                              >
                                <span className="flex items-center gap-1">
                                  <Sparkles size={10} />
                                  增强后
                                </span>
                              </button>
                              {result.enhancement_info?.quality_score != null && (
                                <span className="ml-auto text-[10px] text-gray-400">
                                  质量 {Math.round(result.enhancement_info.quality_score * 100)}%
                                </span>
                              )}
                            </div>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={showEnhanced ? result.enhanced_foreground_url : result.foreground_url}
                              alt={showEnhanced ? '增强后前景' : '原始前景'}
                              className="w-full h-40 object-contain bg-checkered transition-opacity duration-300"
                            />
                            {/* 增强详情 */}
                            {showEnhanced && result.enhancement_info && (
                              <div className="px-3 py-1.5 bg-gray-50/80 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                                {result.enhancement_info.content_category && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                                    {result.enhancement_info.content_category}
                                  </span>
                                )}
                                {result.enhancement_info.steps_executed?.map((step) => (
                                  <span key={step} className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-500 rounded">
                                    {step}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={result.foreground_url}
                            alt="前景"
                            className="w-full h-40 object-contain bg-checkered"
                          />
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* 背景 */}
                {result.background_url && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <Mountain size={14} className="text-gray-600" />
                        <span className="text-xs font-semibold text-gray-700">背景场景</span>
                      </div>
                      <button
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                        onClick={() => setShowBackground(!showBackground)}
                      >
                        {showBackground ? <Eye size={14} className="text-gray-500" /> : <EyeOff size={14} className="text-gray-300" />}
                      </button>
                    </div>
                    {showBackground && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={result.background_url}
                        alt="背景"
                        className="w-full h-40 object-contain bg-gray-50"
                      />
                    )}
                  </div>
                )}

                {/* Mask（默认折叠） */}
                {result.mask_url && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <Layers size={14} className="text-gray-500" />
                        <span className="text-xs font-semibold text-gray-600">蒙版 (Mask)</span>
                      </div>
                      <button
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                        onClick={() => setShowMask(!showMask)}
                      >
                        {showMask ? <Eye size={14} className="text-gray-500" /> : <EyeOff size={14} className="text-gray-300" />}
                      </button>
                    </div>
                    {showMask && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={result.mask_url}
                        alt="蒙版"
                        className="w-full h-40 object-contain bg-gray-100"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ★ 阶段 4: 失败 */}
          {phase === 'failed' && (
            <div className="flex flex-col items-center py-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                <AlertTriangle size={28} className="text-red-500" />
              </div>
              <div className="text-center">
                <div className="text-base font-semibold text-gray-800">分离失败</div>
                <p className="text-sm text-gray-500 mt-1 max-w-[360px]">{errorMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          {phase === 'select' && (
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleStart()}
                disabled={!selectedType}
                className={`
                  flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                  transition-all duration-200 shadow-sm
                  ${selectedType
                    ? 'bg-gray-800 text-white hover:bg-gray-700 active:scale-[0.98]'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }
                `}
              >
                <Sparkles size={14} />
                开始分离
                <ArrowRight size={14} />
              </button>
            </div>
          )}

          {phase === 'processing' && (
            <div className="flex items-center justify-center">
              <span className="text-xs text-gray-400">处理中，请勿关闭此窗口</span>
            </div>
          )}

          {phase === 'completed' && (
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                稍后使用
              </button>
              <button
                onClick={handleConfirm}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 active:scale-[0.98] transition-all shadow-sm"
              >
                <CheckCircle2 size={14} />
                应用分离结果
              </button>
            </div>
          )}

          {phase === 'failed' && (
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                关闭
              </button>
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-gray-800 text-white hover:bg-gray-700 transition-colors shadow-sm"
              >
                重试
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 棋盘格背景 CSS（用于透明图预览） */}
      <style jsx global>{`
        .bg-checkered {
          background-image:
            linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
            linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
            linear-gradient(-45deg, transparent 75%, #f0f0f0 75%);
          background-size: 16px 16px;
          background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
        }
      `}</style>
    </div>
  );
}
