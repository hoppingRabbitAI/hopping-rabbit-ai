'use client';

import { useEffect, useState } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { CheckCircle2, XCircle, Mic } from 'lucide-react';

export type ASRProgressStatus = 'idle' | 'processing' | 'completed' | 'error';

interface ASRProgressToastProps {
  visible: boolean;
  status: ASRProgressStatus;
  progress: number;
  message?: string;
  error?: string;
  onClose?: () => void;
}

export function ASRProgressToast({
  visible,
  status,
  progress,
  message,
  error,
  onClose,
}: ASRProgressToastProps) {
  const [show, setShow] = useState(false);

  // 动画控制
  useEffect(() => {
    if (visible) {
      setShow(true);
    } else {
      // 延迟隐藏以显示退出动画
      const timer = setTimeout(() => setShow(false), 300);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  // 完成或错误后自动关闭
  useEffect(() => {
    if (status === 'completed' || status === 'error') {
      const timer = setTimeout(() => {
        onClose?.();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status, onClose]);

  if (!show) return null;

  const getStatusIcon = () => {
    switch (status) {
      case 'processing':
        return <RabbitLoader size={20} />;
      case 'completed':
        return <CheckCircle2 size={20} className="text-green-400" />;
      case 'error':
        return <XCircle size={20} className="text-red-400" />;
      default:
        return <Mic size={20} className="text-gray-400" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'processing':
        return message || '正在提取语音文案...';
      case 'completed':
        return '语音文案提取完成';
      case 'error':
        return error || '提取失败，请重试';
      default:
        return '准备中...';
    }
  };

  const getProgressColor = () => {
    switch (status) {
      case 'processing':
        return 'bg-gray-600';
      case 'completed':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div
      className={`
        fixed bottom-6 right-6 z-[200]
        transition-all duration-300 ease-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
      `}
    >
      <div className="bg-white/95 backdrop-blur-xl border border-gray-200 rounded-xl shadow-2xl p-4 min-w-[280px] max-w-[360px]">
        {/* 头部 */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center">
            {getStatusIcon()}
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-gray-900">AI 语音识别</h4>
            <p className="text-xs text-gray-500 mt-0.5">{getStatusText()}</p>
          </div>
          {/* 关闭按钮（仅完成或错误时显示） */}
          {(status === 'completed' || status === 'error') && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <XCircle size={16} className="text-gray-400 hover:text-gray-600" />
            </button>
          )}
        </div>

        {/* 进度条 */}
        {status === 'processing' && (
          <div className="relative h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`absolute top-0 left-0 h-full ${getProgressColor()} rounded-full transition-all duration-300`}
              style={{ width: `${Math.max(progress, 5)}%` }}
            />
            {/* 流动动画效果 */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
          </div>
        )}

        {/* 进度百分比 */}
        {status === 'processing' && (
          <div className="flex justify-between items-center mt-2">
            <span className="text-[10px] text-gray-500">识别进度</span>
            <span className="text-[10px] text-gray-500 font-mono">{Math.round(progress)}%</span>
          </div>
        )}

        {/* 完成后的提示 */}
        {status === 'completed' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-green-400/80">
            <CheckCircle2 size={12} />
            <span>已自动创建字幕片段</span>
          </div>
        )}
      </div>
    </div>
  );
}

// 自定义动画样式（需要在 globals.css 中添加）
// @keyframes shimmer {
//   0% { transform: translateX(-100%); }
//   100% { transform: translateX(100%); }
// }
// .animate-shimmer { animation: shimmer 1.5s infinite; }
