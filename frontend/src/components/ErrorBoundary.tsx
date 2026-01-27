'use client';

import { Component, ReactNode } from 'react';
import { toast } from '@/lib/stores/toast-store';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
  errorCount: number;
}

class ErrorBoundary extends Component<Props, State> {
  private errorTimer?: NodeJS.Timeout;

  constructor(props: Props) {
    super(props);
    this.state = { 
      hasError: false,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    
    this.setState((prev) => ({
      errorInfo,
      errorCount: prev.errorCount + 1,
    }));

    // 如果短时间内发生多次错误，可能是无限循环
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
    }
    
    this.errorTimer = setTimeout(() => {
      this.setState({ errorCount: 0 });
    }, 5000);

    // 上报错误（可以集成 Sentry 等服务）
    if (typeof window !== 'undefined') {
      // 存储错误信息以便调试
      const errorLog = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
      };
      
      try {
        const existingLogs = JSON.parse(localStorage.getItem('error-logs') || '[]');
        existingLogs.push(errorLog);
        // 只保留最近 10 条错误
        localStorage.setItem('error-logs', JSON.stringify(existingLogs.slice(-10)));
      } catch (e) {
        console.error('[ErrorBoundary] Failed to save error log:', e);
      }
    }
  }

  componentWillUnmount() {
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
    }
  }

  handleReload = () => {
    // 清除缓存并刷新
    if ('caches' in window) {
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
      });
    }
    window.location.reload();
  };

  handleClearAndReload = () => {
    // 完全清除所有数据
    if ('caches' in window) {
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
      });
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.error('Failed to clear storage:', e);
    }
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ 
      hasError: false, 
      error: undefined,
      errorInfo: undefined,
      errorCount: 0,
    });
  };

  render() {
    if (this.state.hasError) {
      const isRepeatedError = this.state.errorCount > 2;
      
      return (
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
          <div className="text-center space-y-6 max-w-lg px-6">
            <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${
              isRepeatedError ? 'bg-red-500/10' : 'bg-yellow-500/10'
            }`}>
              <svg 
                className={`w-8 h-8 ${isRepeatedError ? 'text-red-500' : 'text-yellow-500'}`}
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            
            <div>
              <h2 className="text-xl font-bold text-white mb-2">
                {isRepeatedError ? '页面反复出错' : '页面加载出错'}
              </h2>
              <p className="text-gray-400 text-sm">
                {isRepeatedError 
                  ? '检测到反复错误，建议清除所有缓存后重试'
                  : '应用程序遇到了问题，请尝试刷新页面'
                }
              </p>
              {isRepeatedError && (
                <p className="text-gray-500 text-xs mt-2">
                  错误次数: {this.state.errorCount}
                </p>
              )}
            </div>
            
            <div className="flex gap-3 justify-center flex-wrap">
              {!isRepeatedError && (
                <button
                  onClick={this.handleReset}
                  className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                >
                  重试
                </button>
              )}
              <button
                onClick={this.handleReload}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                刷新页面
              </button>
              <button
                onClick={this.handleClearAndReload}
                className={`px-6 py-3 text-white rounded-lg font-medium transition-colors ${
                  isRepeatedError 
                    ? 'bg-red-600 hover:bg-red-700' 
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                清除缓存
              </button>
            </div>
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="text-left mt-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
                <summary className="text-gray-400 text-sm cursor-pointer mb-2">
                  错误详情（开发模式）
                </summary>
                <div className="space-y-2">
                  <div>
                    <p className="text-gray-500 text-xs mb-1">错误信息:</p>
                    <pre className="text-xs text-red-400 overflow-auto p-2 bg-gray-950 rounded">
                      {this.state.error.toString()}
                    </pre>
                  </div>
                  {this.state.error.stack && (
                    <div>
                      <p className="text-gray-500 text-xs mb-1">堆栈跟踪:</p>
                      <pre className="text-xs text-gray-400 overflow-auto p-2 bg-gray-950 rounded max-h-40">
                        {this.state.error.stack}
                      </pre>
                    </div>
                  )}
                  {this.state.errorInfo?.componentStack && (
                    <div>
                      <p className="text-gray-500 text-xs mb-1">组件堆栈:</p>
                      <pre className="text-xs text-gray-400 overflow-auto p-2 bg-gray-950 rounded max-h-40">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
            
            {typeof window !== 'undefined' && (
              <button
                onClick={() => {
                  const logs = localStorage.getItem('error-logs');
                  if (logs) {
                    console.log('Error logs:', JSON.parse(logs));
                    toast.info('错误日志已输出到控制台');
                  } else {
                    toast.info('暂无错误日志');
                  }
                }}
                className="text-gray-500 text-xs hover:text-gray-400 underline"
              >
                查看错误日志
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
