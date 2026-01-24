import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createClient, SupabaseClient, User, Session } from '@supabase/supabase-js';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

// Supabase 客户端
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return supabase;
}

export interface AuthUser {
  id: string;
  email: string;
  created_at?: string;
  user_metadata?: {
    display_name?: string;
    bio?: string;
    avatar_url?: string;
    [key: string]: unknown;
  };
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  clearError: () => void;
}

// 错误信息映射：将 Supabase 错误转换为用户友好的提示
function mapAuthError(errorMessage: string): string {
  const errorMap: Record<string, string> = {
    'Invalid login credentials': 'The user does not exist.',
    'Email not confirmed': '邮箱未验证，请先验证邮箱',
    'User already registered': '该邮箱已注册',
    'Password should be at least 6 characters': '密码至少需要6位',
    'Unable to validate email address: invalid format': '邮箱格式不正确',
    'Network request failed': '网络连接失败，请检查网络',
  };

  // 查找匹配的错误
  for (const [key, value] of Object.entries(errorMap)) {
    if (errorMessage.includes(key)) {
      return value;
    }
  }

  // 如果没有匹配，返回原始错误
  return errorMessage;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        
        try {
          const supabase = getSupabase();
          
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (error) {
            throw new Error(error.message);
          }

          if (!data.user || !data.session) {
            throw new Error('登录失败：未获取到用户信息');
          }

          const authUser: AuthUser = {
            id: data.user.id,
            email: data.user.email || '',
            created_at: data.user.created_at,
          };

          set({
            user: authUser,
            accessToken: data.session.access_token,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (err) {
          const rawMessage = err instanceof Error ? err.message : '登录失败';
          const message = mapAuthError(rawMessage);
          set({ 
            isLoading: false, 
            error: message,
            user: null,
            accessToken: null,
            isAuthenticated: false,
          });
          throw new Error(message);
        }
      },

      loginWithGoogle: async () => {
        set({ isLoading: true, error: null });
        
        try {
          const supabase = getSupabase();
          
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: `${window.location.origin}/workspace`,
              queryParams: {
                access_type: 'offline',
                prompt: 'consent',
              },
            },
          });

          if (error) {
            throw new Error(error.message);
          }

          // OAuth 会重定向，所以这里不需要设置状态
          // 用户会在回调后通过 checkSession 获取状态
        } catch (err) {
          const rawMessage = err instanceof Error ? err.message : 'Google 登录失败';
          const message = mapAuthError(rawMessage);
          set({ 
            isLoading: false, 
            error: message,
          });
          throw new Error(message);
        }
      },

      signUp: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        
        try {
          const supabase = getSupabase();
          
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/login?verified=true`,
            },
          });

          if (error) {
            throw new Error(error.message);
          }

          // 注册成功但需要验证邮箱
          // Supabase 会自动发送验证邮件
          set({
            isLoading: false,
            error: null,
          });
        } catch (err) {
          const rawMessage = err instanceof Error ? err.message : '注册失败';
          const message = mapAuthError(rawMessage);
          set({ 
            isLoading: false, 
            error: message,
          });
          throw new Error(message);
        }
      },

      logout: async () => {
        set({ isLoading: true });
        
        try {
          const supabase = getSupabase();
          await supabase.auth.signOut();
        } catch (err) {
          debugError('Logout error:', err);
        } finally {
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          });
        }
      },

      checkSession: async () => {
        set({ isLoading: true });
        
        try {
          const supabase = getSupabase();
          
          // 添加超时机制，防止 Supabase 请求卡住
          const timeoutPromise = new Promise<{ data: { session: null }, error: Error }>((_, reject) => {
            setTimeout(() => reject(new Error('Session check timeout')), 5000);
          });
          
          // 先尝试刷新 session（会自动续期 token）
          const refreshPromise = supabase.auth.refreshSession();
          
          const { data: { session }, error } = await Promise.race([
            refreshPromise,
            timeoutPromise
          ]);

          if (error) {
            // 刷新失败，尝试获取现有 session
            console.warn('[AuthStore] Refresh failed, trying getSession:', error.message);
            try {
              const { data: { session: existingSession } } = await supabase.auth.getSession();
              
              if (existingSession?.user) {
                const authUser: AuthUser = {
                  id: existingSession.user.id,
                  email: existingSession.user.email || '',
                  created_at: existingSession.user.created_at,
                };

                set({
                  user: authUser,
                  accessToken: existingSession.access_token,
                  isAuthenticated: true,
                  isLoading: false,
                });
                return;
              }
            } catch (sessionErr) {
              // 忽略 AuthSessionMissingError，用户未登录时正常情况
              console.warn('[AuthStore] getSession failed:', sessionErr);
            }
            // 没有有效 session，清除状态
            set({
              user: null,
              accessToken: null,
              isAuthenticated: false,
              isLoading: false,
            });
            return;
          }

          if (session?.user) {
            const authUser: AuthUser = {
              id: session.user.id,
              email: session.user.email || '',
              created_at: session.user.created_at,
            };

            set({
              user: authUser,
              accessToken: session.access_token,
              isAuthenticated: true,
              isLoading: false,
            });
          } else {
            // Session 无效或过期，清除本地状态
            set({
              user: null,
              accessToken: null,
              isAuthenticated: false,
              isLoading: false,
            });
          }
        } catch (err) {
          debugError('Session check error:', err);
          set({
            user: null,
            accessToken: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },

      resetPasswordForEmail: async (email: string) => {
        set({ isLoading: true, error: null });
        
        try {
          const supabase = getSupabase();
          
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
          });

          if (error) {
            throw new Error(error.message);
          }

          set({ isLoading: false, error: null });
        } catch (err) {
          const rawMessage = err instanceof Error ? err.message : '发送重置邮件失败';
          const message = mapAuthError(rawMessage);
          set({ 
            isLoading: false, 
            error: message,
          });
          throw new Error(message);
        }
      },

      updatePassword: async (newPassword: string) => {
        set({ isLoading: true, error: null });
        
        try {
          const supabase = getSupabase();
          
          const { error } = await supabase.auth.updateUser({
            password: newPassword,
          });

          if (error) {
            throw new Error(error.message);
          }

          set({ isLoading: false, error: null });
        } catch (err) {
          const rawMessage = err instanceof Error ? err.message : '更新密码失败';
          const message = mapAuthError(rawMessage);
          set({ 
            isLoading: false, 
            error: message,
          });
          throw new Error(message);
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'hoppingrabbit-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// 获取当前 token 的辅助函数（供 API 调用使用）
export function getAuthToken(): string | null {
  return useAuthStore.getState().accessToken;
}

// 获取当前用户 ID 的辅助函数
export function getCurrentUserId(): string | null {
  return useAuthStore.getState().user?.id || null;
}

/**
 * ★ 确保 token 有效 - 在关键 API 调用前使用
 * 如果 token 即将过期或已过期，会尝试刷新
 * @returns 有效的 token 或 null（如果无法获取有效 token）
 */
export async function ensureValidToken(): Promise<string | null> {
  const state = useAuthStore.getState();
  const currentToken = state.accessToken;
  
  // 如果没有 token，尝试检查 session
  if (!currentToken) {
    console.log('[AuthStore] No token, checking session...');
    try {
      await state.checkSession();
      return useAuthStore.getState().accessToken;
    } catch {
      return null;
    }
  }
  
  // 检查 token 是否即将过期（解析 JWT）
  try {
    const payload = JSON.parse(atob(currentToken.split('.')[1]));
    const expiresAt = payload.exp * 1000; // 转为毫秒
    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;
    
    // 如果 token 在 5 分钟内过期，主动刷新
    if (timeUntilExpiry < 5 * 60 * 1000) {
      console.log(`[AuthStore] Token expires in ${Math.round(timeUntilExpiry / 1000)}s, refreshing...`);
      try {
        await state.checkSession();
        const newToken = useAuthStore.getState().accessToken;
        if (newToken) {
          console.log('[AuthStore] Token refreshed successfully');
          return newToken;
        }
      } catch (e) {
        console.warn('[AuthStore] Token refresh failed:', e);
      }
    }
  } catch (e) {
    // JWT 解析失败，可能格式不正确，尝试刷新
    console.warn('[AuthStore] Token parse error, refreshing...', e);
    try {
      await state.checkSession();
      return useAuthStore.getState().accessToken;
    } catch {
      return null;
    }
  }
  
  return currentToken;
}
