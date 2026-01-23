/**
 * API 客户端 - 基础类
 */
import type { ApiResponse, ApiError } from './types';
import { 
  getAuthToken as getAuthTokenFromStore, 
  ensureValidToken as ensureValidTokenFromStore,
  useAuthStore 
} from '@/features/editor/store/auth-store';

// ============================================
// 配置
// ============================================

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

// 调试开关
const DEBUG_API = false;
const apiLog = (...args: unknown[]) => { if (DEBUG_API) console.log(...args); };
const apiWarn = (...args: unknown[]) => { if (DEBUG_API) console.warn(...args); };

// 防止并发刷新 token
let isRefreshingToken = false;
let refreshTokenPromise: Promise<boolean> | null = null;

// ============================================
// 认证辅助函数
// ============================================

/** 获取认证 Token - 直接从 auth-store 内存读取 */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  
  // 直接从 zustand store 内存获取（最新值）
  return getAuthTokenFromStore();
}

/** 
 * ★ 确保 token 有效 - 在关键 API 调用前使用
 * 如果 token 即将过期会主动刷新
 */
export async function ensureValidToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  return ensureValidTokenFromStore();
}

/** 
 * 尝试刷新 Token
 * 使用 auth-store 的 Supabase 实例，避免创建多个 GoTrueClient
 */
async function tryRefreshToken(): Promise<boolean> {
  // 防止并发刷新
  if (isRefreshingToken && refreshTokenPromise) {
    return refreshTokenPromise;
  }
  
  isRefreshingToken = true;
  
  refreshTokenPromise = (async () => {
    try {
      apiLog('[API] Attempting to refresh token via auth-store...');
      
      // 调用 checkSession 重新获取 session
      await useAuthStore.getState().checkSession();
      
      // 检查刷新后的 token（直接从内存读取）
      const newToken = useAuthStore.getState().accessToken;
      if (newToken) {
        apiLog('[API] Token refreshed successfully via auth-store');
        return true;
      }
      
      apiWarn('[API] Token refresh failed: no valid session');
      return false;
    } catch (e) {
      console.error('[API] Token refresh error:', e);
      return false;
    } finally {
      isRefreshingToken = false;
      refreshTokenPromise = null;
    }
  })();
  
  return refreshTokenPromise;
}

/** 处理登录过期：清除本地状态并跳转到登录页 */
export function handleAuthExpired() {
  if (typeof window === 'undefined') return;
  
  // 清除认证状态
  localStorage.removeItem('hoppingrabbit-auth');
  
  // 跳转到登录页（如果不在登录页）
  if (!window.location.pathname.includes('/login')) {
    window.location.href = '/login';
  }
}

// ============================================
// API 客户端基类
// ============================================

export class ApiClient {
  protected baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  protected async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOnAuth: boolean = true  // 是否在 401 时尝试刷新 token 后重试
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      
      // 构建请求头，自动注入 Authorization
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      };
      
      // ★★★ 关键修复：请求前先确保 token 有效 ★★★
      // 如果 token 即将过期（<5分钟），会主动刷新
      const token = await ensureValidToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // 处理认证失败 - 尝试刷新 token 后重试
      if (response.status === 401) {
        if (retryOnAuth) {
          apiWarn('[API] Unauthorized request, attempting token refresh...');
          const refreshed = await tryRefreshToken();
          
          if (refreshed) {
            // Token 刷新成功，重试请求（不再尝试刷新）
            apiLog('[API] Retrying request with new token...');
            return this.request<T>(endpoint, options, false);
          }
        }
        
        // Token 刷新失败或已重试过，跳转登录
        apiWarn('[API] Token refresh failed, redirecting to login');
        handleAuthExpired();
        return {
          error: {
            code: 'UNAUTHORIZED',
            message: '登录已过期，请重新登录',
          },
        };
      }

      // 处理权限不足
      if (response.status === 403) {
        apiWarn('[API] Forbidden request');
        return {
          error: {
            code: 'FORBIDDEN',
            message: '无权访问此资源',
          },
        };
      }

      // 处理版本冲突
      if (response.status === 409) {
        const conflictData = await response.json();
        return { error: conflictData };
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          error: {
            code: `HTTP_${response.status}`,
            message: errorData.detail || response.statusText,
            details: errorData,
          },
        };
      }

      const data = await response.json();
      return { data };
    } catch (error) {
      return {
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : '网络请求失败',
        },
      };
    }
  }
}
