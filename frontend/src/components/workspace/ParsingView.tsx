'use client';

import React, { useState, useEffect } from 'react';
import { Sparkles, Layers, Check, Loader2 } from 'lucide-react';

interface ParsingViewProps {
    mode: 'ai-talk' | 'refine';
    sessionId: string;
    onComplete: () => void;
    onCancel: () => void;
}

interface ParsingStep {
    id: string;
    label: string;
    detail: string;
}

export function ParsingView({ mode, sessionId, onComplete, onCancel }: ParsingViewProps) {
    const [progress, setProgress] = useState(0);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);

    // 根据模式定义不同的解析步骤
    const steps: ParsingStep[] = mode === 'ai-talk'
        ? [
            { id: 'extract', label: '正在提取语义核心...', detail: 'AI 分析文案结构' },
            { id: 'slotting', label: 'AI 正在拆分 Clip...', detail: '按语义单元切分内容' },
            { id: 'matching', label: '正在匹配 B-roll 模版...', detail: '智能推荐素材' },
            { id: 'complete', label: '解析完成', detail: '准备进入编辑器' },
        ]
        : [
            { id: 'extract', label: '正在提取语音文本...', detail: 'ASR 语音识别中' },
            { id: 'detect', label: '正在识别口癖废话...', detail: '检测"嗯"、"啊"等停顿词' },
            { id: 'slotting', label: 'AI 正在拆分 Clip...', detail: '按语义单元切分内容' },
            { id: 'complete', label: '解析完成', detail: '准备进入精修模式' },
        ];

    // 模拟解析过程
    useEffect(() => {
        const progressInterval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(progressInterval);
                    return 100;
                }
                return prev + 2;
            });
        }, 60);

        return () => clearInterval(progressInterval);
    }, []);

    // 根据进度更新当前步骤
    useEffect(() => {
        const stepProgress = 100 / steps.length;
        const newStepIndex = Math.min(
            Math.floor(progress / stepProgress),
            steps.length - 1
        );
        setCurrentStepIndex(newStepIndex);

        // 完成后触发回调
        if (progress >= 100) {
            const timer = setTimeout(() => {
                onComplete();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [progress, steps.length, onComplete]);

    const currentStep = steps[currentStepIndex];

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 p-8">
                {/* 顶部动画区域 */}
                <div className="flex flex-col items-center mb-8">
                    {/* 旋转动画 */}
                    <div className="relative inline-block mb-6">
                        <div className={`w-24 h-24 border-4 rounded-full animate-spin ${mode === 'ai-talk'
                                ? 'border-indigo-500/20 border-t-indigo-500'
                                : 'border-emerald-500/20 border-t-emerald-500'
                            }`} />
                        <div className="absolute inset-0 flex items-center justify-center">
                            {mode === 'ai-talk' ? (
                                <Sparkles className="text-indigo-500 animate-pulse" size={32} />
                            ) : (
                                <Layers className="text-emerald-500 animate-pulse" size={32} />
                            )}
                        </div>
                    </div>

                    {/* 当前步骤文案 */}
                    <h2 className="text-xl font-black text-gray-900 text-center mb-1">
                        {currentStep.label}
                    </h2>
                    <p className="text-sm text-gray-500">{currentStep.detail}</p>
                </div>

                {/* 进度条 */}
                <div className="space-y-2 mb-6">
                    <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-500 font-medium">处理进度</span>
                        <span className="text-gray-900 font-bold">{progress}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all duration-300 ${mode === 'ai-talk'
                                    ? 'bg-gradient-to-r from-indigo-500 to-purple-500'
                                    : 'bg-gradient-to-r from-emerald-500 to-teal-500'
                                }`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* 步骤列表 */}
                <div className="space-y-3">
                    {steps.map((step, index) => {
                        const isCompleted = index < currentStepIndex;
                        const isCurrent = index === currentStepIndex;

                        return (
                            <div
                                key={step.id}
                                className={`flex items-center space-x-3 transition-all duration-300 ${isCompleted ? 'opacity-50' : isCurrent ? 'opacity-100' : 'opacity-30'
                                    }`}
                            >
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${isCompleted
                                        ? 'bg-gray-200 text-gray-500'
                                        : isCurrent
                                            ? mode === 'ai-talk' ? 'bg-indigo-500 text-white' : 'bg-emerald-500 text-white'
                                            : 'bg-gray-100 text-gray-400'
                                    }`}>
                                    {isCompleted ? (
                                        <Check size={12} />
                                    ) : isCurrent ? (
                                        <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                        <span className="text-[10px] font-bold">{index + 1}</span>
                                    )}
                                </div>
                                <span className={`text-sm ${isCurrent ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
                                    {step.label.replace('...', '')}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* 底部提示 */}
                <div className="mt-8 text-center">
                    <p className="text-[10px] text-gray-400">
                        HoppingRabbit Agent 正在处理中，预计很快完成
                    </p>
                    <button
                        onClick={onCancel}
                        className="mt-3 text-xs text-gray-500 hover:text-gray-900 transition-colors"
                    >
                        取消处理
                    </button>
                </div>
            </div>
        </div>
    );
}
