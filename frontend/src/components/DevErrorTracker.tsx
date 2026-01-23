'use client';

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';

/**
 * 错误提示 Modal 组件
 */
function ErrorModal({
  errorCount,
  onConfirm,
  onCancel,
}: {
  errorCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-700 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* 头部 */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-700 bg-zinc-800/50">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/20">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">检测到多个错误</h3>
            <p className="text-sm text-zinc-400">{errorCount} 个错误</p>
          </div>
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-5">
          <p className="text-zinc-300 mb-4">这可能是由于：</p>
          <ul className="space-y-2 text-sm text-zinc-400">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              代码语法错误
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              资源加载失败
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              缓存问题
            </li>
          </ul>
        </div>

        {/* 按钮 */}
        <div className="flex gap-3 px-6 py-4 border-t border-zinc-700 bg-zinc-800/30">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-zinc-300 bg-zinc-700 hover:bg-zinc-600 transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            清除缓存并刷新
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * 开发环境错误追踪组件
 * 在开发模式下显示详细的错误信息和日志
 */
export function DevErrorTracker() {
  const [showModal, setShowModal] = useState(false);
  const [currentErrorCount, setCurrentErrorCount] = useState(0);

  const handleConfirm = useCallback(() => {
    // 清除所有缓存
    if ('caches' in window) {
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
      });
    }
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  }, []);

  const handleCancel = useCallback(() => {
    setShowModal(false);
    // 通过 window 事件通知重置计数
    window.dispatchEvent(new CustomEvent('dev-error-reset'));
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    let errorCount = 0;
    const MAX_ERRORS = 5;

    // 监听重置事件
    const handleReset = () => {
      errorCount = 0;
    };
    window.addEventListener('dev-error-reset', handleReset);

    // 增强的错误处理
    const originalError = console.error;
    console.error = (...args) => {
      originalError.apply(console, args);

      errorCount++;
      if (errorCount >= MAX_ERRORS) {
        setCurrentErrorCount(errorCount);
        setShowModal(true);
      }
    };

    // 监控长时间的 fetch 请求
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const startTime = Date.now();
      const input = args[0];
      const url = typeof input === 'string' 
        ? input 
        : input instanceof Request 
          ? input.url 
          : input.toString();

      const timeoutWarning = setTimeout(() => {
        console.warn(`[DevTracker] Slow request detected (>10s): ${url}`);
      }, 10000);

      return originalFetch.apply(this, args).finally(() => {
        clearTimeout(timeoutWarning);
        const duration = Date.now() - startTime;
        if (duration > 5000) {
          console.warn(`[DevTracker] Slow request completed (${duration}ms): ${url}`);
        }
      });
    };

    return () => {
      console.error = originalError;
      window.fetch = originalFetch;
      window.removeEventListener('dev-error-reset', handleReset);
    };
  }, []);

  return showModal ? (
    <ErrorModal
      errorCount={currentErrorCount}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;
}
