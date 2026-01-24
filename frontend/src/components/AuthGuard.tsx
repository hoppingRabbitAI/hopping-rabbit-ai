'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/features/editor/store/auth-store';

interface AuthGuardProps {
  children: React.ReactNode;
}

// 不需要认证的公开路由
const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password', '/reset-password', '/settings', '/pricing'];

// 加载超时时间（毫秒）
const HYDRATION_TIMEOUT = 3000;  // 3秒（缩短超时）
const SESSION_CHECK_TIMEOUT = 10000;  // 10秒

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, checkSession } = useAuthStore();
  const [isHydrated, setIsHydrated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const checkDoneRef = useRef(false);
  const sessionCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 等待 Zustand persist hydration 完成
  useEffect(() => {
    // 立即检查是否已经 hydrated
    const alreadyHydrated = useAuthStore.persist?.hasHydrated?.() ?? true;
    
    if (alreadyHydrated) {
      setIsHydrated(true);
      return;
    }
    
    // 订阅 hydration 完成事件
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = useAuthStore.persist.onFinishHydration(() => {
        setIsHydrated(true);
      });
    } catch (e) {
      console.warn('[AuthGuard] Failed to subscribe to hydration:', e);
      setIsHydrated(true);
    }
    
    // 兜底超时：3秒后强制继续
    const timeout = setTimeout(() => {
      setIsHydrated(true);
    }, HYDRATION_TIMEOUT);

    return () => {
      unsubscribe?.();
      clearTimeout(timeout);
    };
  }, []);


  // Hydration 完成后检查 session
  useEffect(() => {
    if (!isHydrated) return;
    if (checkDoneRef.current) return;
    
    checkDoneRef.current = true;
    
    // 设置 session 检查超时
    sessionCheckTimeoutRef.current = setTimeout(() => {
      setLoadingError('登录验证超时，请检查网络连接');
      setIsChecking(false);
    }, SESSION_CHECK_TIMEOUT);
    
    // 始终验证 session（即使本地有缓存状态）
    checkSession()
      .catch(() => {
        setLoadingError('登录验证失败，请稍后重试');
      })
      .finally(() => {
        if (sessionCheckTimeoutRef.current) {
          clearTimeout(sessionCheckTimeoutRef.current);
          sessionCheckTimeoutRef.current = null;
        }
        setIsChecking(false);
      });
    
    return () => {
      if (sessionCheckTimeoutRef.current) {
        clearTimeout(sessionCheckTimeoutRef.current);
      }
    };
  }, [isHydrated, checkSession]);

  // 路由保护
  useEffect(() => {
    if (!isHydrated || isChecking) return;

    const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

    if (!isAuthenticated && !isPublicRoute) {
      router.push('/login');
    } else if (isAuthenticated && pathname === '/login') {
      router.push('/');
    }
  }, [isAuthenticated, pathname, router, isHydrated, isChecking]);

  // 等待 hydration 和 session 检查完成
  if (!isHydrated || isChecking) {
    // 如果有错误，显示错误页面而不是无限加载
    if (loadingError) {
      return (
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
          <div className="text-center space-y-6 max-w-md px-6">
            <div className="w-16 h-16 mx-auto bg-yellow-500/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">加载出错</h2>
              <p className="text-gray-400 text-sm">{loadingError}</p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                刷新页面
              </button>
              <button
                onClick={() => {
                  // 清除所有缓存
                  if ('caches' in window) {
                    caches.keys().then((names) => {
                      names.forEach((name) => caches.delete(name));
                    });
                  }
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                清除缓存并刷新
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-gray-500/20 border-t-gray-500 rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">验证登录状态...</span>
          <span className="text-gray-600 text-xs">如果长时间无响应，请刷新页面</span>
        </div>
      </div>
    );
  }

  // 未登录且不在公开页面，显示空白（等待跳转）
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  if (!isAuthenticated && !isPublicRoute) {
    return null;
  }

  return <>{children}</>;
}

export default AuthGuard;
