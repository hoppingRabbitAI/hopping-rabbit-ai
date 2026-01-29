'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    X,
    Check,
    Scissors,
    AlertCircle,
    Clock,
    Loader2
} from 'lucide-react';
import type { Clip } from '@/features/editor/types/clip';

// ==========================================
// 调试日志（仅开发环境）
// ==========================================
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => DEBUG && console.log('[DefillerModal]', ...args);

// ==========================================
// 口癖词汇类型
// ==========================================
export interface FillerWord {
    word: string;           // 口癖词汇（如"嗯..."、"那个"）
    count: number;          // 出现次数
    checked: boolean;       // 是否勾选删除
    totalDuration?: number; // 总时长（毫秒）
}

interface DefillerModalProps {
    isOpen: boolean;
    onClose: () => void;
    clips: Clip[];
    fillerWords: FillerWord[];
    sessionId: string;      // 会话 ID，用于调用 apply-trimming
    projectId: string;      // 项目 ID，用于跳转编辑器
    onComplete?: () => void; // ★ 新增：完成后回调（用于显示下一个弹窗）
}

// ==========================================
// 智能修剪弹窗组件
// ★ 参考 SmartCleanupWizard 的模式：
//   - 组件内部处理 API 调用
//   - 组件内部处理跳转逻辑
//   - 错误状态内部管理
// ==========================================
export function DefillerModal({
    isOpen,
    onClose,
    clips,
    fillerWords: initialFillerWords,
    sessionId,
    projectId,
    onComplete,
}: DefillerModalProps) {
    const router = useRouter();
    const [fillerWords, setFillerWords] = useState<FillerWord[]>(initialFillerWords);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 计算统计数据
    const stats = useMemo(() => {
        const checkedFillers = fillerWords.filter(f => f.checked);
        const totalCount = checkedFillers.reduce((sum, f) => sum + f.count, 0);
        const totalDuration = checkedFillers.reduce((sum, f) => sum + (f.totalDuration || 0), 0);
        return { totalCount, totalDuration };
    }, [fillerWords]);

    // 切换口癖选中状态
    const toggleFiller = (word: string) => {
        setFillerWords(prev =>
            prev.map(f => f.word === word ? { ...f, checked: !f.checked } : f)
        );
    };

    // 全选/取消全选
    const toggleAll = () => {
        const allChecked = fillerWords.every(f => f.checked);
        setFillerWords(prev => prev.map(f => ({ ...f, checked: !allChecked })));
    };

    // 格式化时间
    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms}毫秒`;
        const seconds = (ms / 1000).toFixed(1);
        return `${seconds}秒`;
    };

    // ★ 处理确认 - 调用后端 apply-trimming 接口（参考 SmartCleanupWizard.handleFinalConfirm）
    const handleConfirm = useCallback(async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            const removedFillers = fillerWords.filter(f => f.checked).map(f => f.word);
            log('确认修剪, 删除口癖:', removedFillers);

            // ★ 动态导入 API，避免循环依赖
            const { applyTrimming } = await import('@/features/editor/lib/workspace-api');
            const result = await applyTrimming(sessionId, {
                removed_fillers: removedFillers,
                create_clips_from_segments: true,
            });

            log('修剪完成:', result);

            // ★ 如果有 onComplete 回调，调用它（用于显示下一个弹窗）
            if (onComplete) {
                onComplete();
                return;
            }

            // ★ 否则直接进入编辑器（参考 SmartCleanupWizard.onConfirm）
            const targetProjectId = result.project_id || projectId;
            if (targetProjectId) {
                router.push(`/editor?project=${targetProjectId}`);
            } else {
                setError('无法获取项目 ID，请重试');
                setIsSubmitting(false);
            }
        } catch (err: unknown) {
            log('修剪失败:', err);
            const error = err as { message?: string; detail?: string };
            setError(error.detail || error.message || '修剪失败，请重试');
            setIsSubmitting(false);
        }
    }, [fillerWords, sessionId, projectId, router, onComplete]);

    // 生成预览文本（带删除线标记）
    const generatePreviewText = () => {
        // 模拟文案预览（实际应从 clips 的 transcript 中提取）
        const sampleText = clips
            .filter(c => c.contentText || c.transcript)
            .map(c => c.contentText || c.transcript?.map(t => t.text).join('') || '')
            .join(' ');

        if (!sampleText) {
            return (
                <div className="text-gray-400 italic text-center py-8">
                    暂无文案预览
                </div>
            );
        }

        // 高亮标记口癖词汇
        const checkedWords = fillerWords.filter(f => f.checked).map(f => f.word);

        return (
            <div className="text-base leading-[2rem] text-gray-700">
                {sampleText.split(/(\s+)/).map((segment, i) => {
                    const isFillerWord = checkedWords.some(w =>
                        segment.toLowerCase().includes(w.toLowerCase().replace('...', ''))
                    );

                    if (isFillerWord) {
                        return (
                            <span
                                key={i}
                                className="bg-emerald-100 text-emerald-600 line-through px-1 rounded mx-0.5"
                            >
                                {segment}
                            </span>
                        );
                    }
                    return <span key={i}>{segment}</span>;
                })}
            </div>
        );
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in fade-in zoom-in duration-300">
            <div className="bg-white w-full max-w-4xl rounded-3xl border border-gray-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-emerald-50 to-teal-50">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
                            <Scissors size={24} />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-gray-900">语义修剪 (AI Trimmer)</h3>
                            <p className="text-gray-600 text-sm mt-1">智能识别口癖废话，一键清理</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-3 bg-white hover:bg-gray-100 rounded-full transition-colors shadow-sm"
                    >
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* 左侧：口癖列表 */}
                    <div className="w-72 border-r border-gray-100 p-6 space-y-4 bg-gray-50/50">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest">
                                检测到的口癖
                            </label>
                            <button
                                onClick={toggleAll}
                                className="text-[10px] text-gray-500 hover:text-gray-900 font-bold"
                            >
                                {fillerWords.every(f => f.checked) ? '取消全选' : '全选'}
                            </button>
                        </div>

                        <div className="space-y-2">
                            {fillerWords.map((filler) => (
                                <div
                                    key={filler.word}
                                    onClick={() => toggleFiller(filler.word)}
                                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${filler.checked
                                            ? 'bg-emerald-50 border-emerald-200'
                                            : 'bg-white border-gray-200 hover:border-gray-300'
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${filler.checked
                                                ? 'bg-emerald-500 border-emerald-500'
                                                : 'border-gray-300'
                                            }`}>
                                            {filler.checked && <Check size={12} className="text-white" />}
                                        </div>
                                        <span className={`text-sm font-medium ${filler.checked ? 'text-emerald-700' : 'text-gray-700'}`}>
                                            {filler.word}
                                        </span>
                                    </div>
                                    <span className={`text-xs font-bold ${filler.checked ? 'text-emerald-600' : 'text-gray-400'}`}>
                                        {filler.count}次
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* 语义重复警告 */}
                        {fillerWords.length > 0 && (
                            <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-xl flex items-start gap-2">
                                <AlertCircle size={14} className="text-orange-500 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-orange-700">
                                    检测到 <span className="font-bold">{fillerWords.length}</span> 类口癖词汇，
                                    建议删除以提升内容流畅度
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 右侧：文案预览 */}
                    <div className="flex-1 p-6 overflow-y-auto">
                        <label className="text-xs font-black text-gray-500 uppercase tracking-widest mb-4 block">
                            文案预览（删除线标记将被移除）
                        </label>
                        <div className="bg-gray-50 rounded-xl p-6 min-h-[200px]">
                            {generatePreviewText()}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 bg-white flex flex-col gap-3">
                    {/* 错误提示 */}
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                            <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        {/* 统计信息 */}
                        <div className="flex items-center gap-6 text-sm text-gray-500">
                            <div className="flex items-center gap-2">
                                <Scissors size={14} className="text-emerald-500" />
                                <span>将删除 <span className="font-bold text-emerald-600">{stats.totalCount}</span> 处口癖</span>
                            </div>
                            {stats.totalDuration > 0 && (
                                <div className="flex items-center gap-2">
                                    <Clock size={14} className="text-emerald-500" />
                                    <span>预计节省 <span className="font-bold text-emerald-600">{formatDuration(stats.totalDuration)}</span></span>
                                </div>
                            )}
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={onClose}
                                disabled={isSubmitting}
                                className="px-6 py-3 text-gray-600 hover:text-gray-900 font-bold text-sm transition-colors disabled:opacity-50"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={isSubmitting}
                                className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        处理中...
                                    </>
                                ) : (
                                    <>
                                        {stats.totalCount > 0 ? '确认修剪并进入编辑器' : '直接进入编辑器'}
                                        <Check size={16} />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
