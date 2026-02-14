/**
 * NodeSelectionToolbar — 选中节点时的画布顶部 AI 能力工具栏
 *
 * 设计语言：白灰主色调，与画布底部工具栏一致
 *
 * 交互设计：
 *   选中一个 Clip 节点 → 画布顶部出现浮动工具栏（slide-down 入场）
 *   • 左侧：特殊操作（抠图分层、拆镜头、抽关键帧、提取旁白）
 *   • 中间：AI 能力按钮（单图可用 → 直接点击，多图需求 → 淡化 + 连线提示）
 *   • 右侧：画笔(Compositor)、下载
 *
 * 多图能力（如换脸、换装）仍然可见但淡化，hover 提示用户「需要在画布连线」，
 * 这样用户知道平台有这些能力，但需要通过画布工作流触发。
 */

'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Layers,
  Scissors,
  Image as ImageIcon,
  AudioLines,
  PenSquare,
  Download,
  Link2,
} from 'lucide-react';
import { CAPABILITIES, type CapabilityDefinition, type GenerationCapabilityId } from './GenerationComposerModal';
import { toast } from '@/lib/stores/toast-store';

// ============================================
// Props
// ============================================

export interface NodeSelectionToolbarProps {
  clipId: string;
  mediaType: 'video' | 'image';
  thumbnail?: string;
  videoUrl?: string;
  duration?: number;
  transcript?: string;
  isFreeNode?: boolean;
  /** 打开 AI 生成弹窗 */
  onOpenGeneration: (clipId: string, capabilityId?: string) => void;
  /** 抠图分层 */
  onSeparate?: (clipId: string) => void;
  /** 打开 Compositor 画笔编辑器 */
  onOpenCompositor?: (clipId: string) => void;
}

// ============================================
// 组件
// ============================================

export function NodeSelectionToolbar({
  clipId,
  mediaType,
  thumbnail,
  videoUrl,
  duration,
  transcript,
  isFreeNode,
  onOpenGeneration,
  onSeparate,
  onOpenCompositor,
}: NodeSelectionToolbarProps) {
  const [hoveredCap, setHoveredCap] = useState<string | null>(null);
  const isImageNode = mediaType === 'image';

  // ★ 过滤兼容的 AI 能力
  const compatibleCapabilities = useMemo(() => {
    return CAPABILITIES.filter(c => {
      if (!c.available) return false;
      return c.allowedMediaTypes.includes(mediaType) || c.allowedMediaTypes.includes('text');
    });
  }, [mediaType]);

  // ★ 点击 AI 能力
  const handleCapabilityClick = useCallback((cap: CapabilityDefinition) => {
    if (cap.minInputs > 1) {
      toast.info(`「${cap.label}」需要 ${cap.minInputs} 张图片输入，请在画布中连线后使用`);
      return;
    }
    onOpenGeneration(clipId, cap.id);
  }, [clipId, onOpenGeneration]);

  // ★ 下载
  const handleDownload = useCallback(() => {
    const url = videoUrl || thumbnail;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clipId}.${isImageNode ? 'png' : 'mp4'}`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [videoUrl, thumbnail, clipId, isImageNode]);

  // 判断是否有特殊操作按钮（决定分隔线是否渲染）
  const hasSpecialOps = !!(onSeparate)
    || (!isImageNode && (duration ?? 0) > 3)
    || (!isImageNode && !isFreeNode)
    || (!isImageNode && transcript);

  return (
    <div className="flex items-center gap-0.5 rounded-2xl border border-gray-200/90 bg-white/95 px-2.5 py-1.5 shadow-xl backdrop-blur-md animate-slide-up-fade-in">
      {/* ★ 特殊操作 */}
      {onSeparate && (
        <ToolbarButton
          icon={Layers}
          label="抠图"
          onClick={() => onSeparate(clipId)}
        />
      )}
      {!isImageNode && (duration ?? 0) > 3 && (
        <ToolbarButton
          icon={Scissors}
          label="拆镜头"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('split-clip', { detail: { clipId } }));
          }}
        />
      )}
      {!isImageNode && !isFreeNode && (
        <ToolbarButton
          icon={ImageIcon}
          label="抽帧"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('extract-frames', { detail: { clipId } }));
          }}
        />
      )}
      {!isImageNode && transcript && (
        <ToolbarButton
          icon={AudioLines}
          label="旁白"
          onClick={() => {
            navigator.clipboard.writeText(transcript).then(() => {
              toast.success('旁白文案已复制到剪贴板');
            }).catch(() => {
              toast.info(transcript.slice(0, 100) + '...');
            });
          }}
        />
      )}

      {/* 分隔线 — 只在有特殊操作时渲染 */}
      {hasSpecialOps && (
        <div className="mx-1 h-5 w-px bg-gray-200" />
      )}

      {/* ★ AI 能力按钮 */}
      {compatibleCapabilities.map(cap => {
        const Icon = cap.icon;
        const isMultiInput = cap.minInputs > 1;
        return (
          <div key={cap.id} className="relative">
            <button
              onClick={() => handleCapabilityClick(cap)}
              onMouseEnter={() => setHoveredCap(cap.id)}
              onMouseLeave={() => setHoveredCap(null)}
              className={`
                flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150
                ${isMultiInput
                  ? 'text-gray-400 hover:text-gray-500 hover:bg-gray-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 active:bg-gray-200/70'
                }
              `}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isMultiInput ? 'opacity-40' : 'opacity-70'}`} />
              <span className={isMultiInput ? 'opacity-50' : ''}>{cap.label}</span>
              {isMultiInput && <Link2 size={10} className="opacity-30" />}
            </button>
            {/* Tooltip — 多图需求提示 */}
            {isMultiInput && hoveredCap === cap.id && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 pointer-events-none">
                <div className="bg-white text-gray-600 text-[11px] px-2.5 py-1.5 rounded-lg shadow-lg border border-gray-200 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <Link2 size={10} className="text-blue-500 shrink-0" />
                    <span>需要 {cap.minInputs} 张图片，请在画布连线</span>
                  </div>
                </div>
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45 border-l border-t border-gray-200" />
              </div>
            )}
          </div>
        );
      })}

      {/* 分隔线 */}
      <div className="mx-1 h-5 w-px bg-gray-200" />

      {/* ★ 工具按钮 */}
      {onOpenCompositor && (
        <ToolbarButton
          icon={PenSquare}
          label="画笔"
          onClick={() => onOpenCompositor(clipId)}
        />
      )}
      <ToolbarButton
        icon={Download}
        label="下载"
        onClick={handleDownload}
      />
    </div>
  );
}

// ============================================
// 内部组件：工具栏按钮
// ============================================

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<any>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 active:bg-gray-200/70 text-xs font-medium whitespace-nowrap transition-all duration-150"
      title={label}
    >
      <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />
      <span>{label}</span>
    </button>
  );
}
