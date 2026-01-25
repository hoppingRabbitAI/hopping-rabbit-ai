'use client';

import { useState, useCallback, useEffect, createContext, useContext, ReactNode } from 'react';
import { getSessionSafe } from '@/lib/supabase';

// ============================================
// 类型定义
// ============================================

interface QuotaData {
  user_id: string;
  tier: 'free' | 'pro' | 'enterprise';
  free_trials_total: number;
  free_trials_used: number;
  free_trials_remaining: number;
  ai_tasks_daily_limit: number;
  ai_tasks_used_today: number;
  ai_tasks_remaining_today: number;
  storage_limit_mb: number;
  storage_used_mb: number;
  storage_remaining_mb: number;
  max_projects: number;
  monthly_credits: number;
  credits_used_this_month: number;
}

interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  message: string;
}

type QuotaType = 'free_trial' | 'ai_task' | 'storage' | 'project';

interface QuotaContextValue {
  quota: QuotaData | null;
  loading: boolean;
  error: string | null;
  refreshQuota: () => Promise<void>;
  checkQuota: (type: QuotaType, amount?: number) => Promise<QuotaCheckResult>;
  hasQuota: (type: QuotaType) => boolean;
}

// ============================================
// Context
// ============================================

const QuotaContext = createContext<QuotaContextValue | null>(null);

// ============================================
// Provider
// ============================================

interface QuotaProviderProps {
  children: ReactNode;
}

export function QuotaProvider({ children }: QuotaProviderProps) {
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshQuota = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const session = await getSessionSafe();
      if (!session) {
        setQuota(null);
        setLoading(false);
        return;
      }

      const response = await fetch('/api/users/me/quota', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取配额信息失败');
      }

      const data = await response.json();
      setQuota(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  // 检查配额是否充足
  const checkQuota = useCallback(async (type: QuotaType, amount: number = 1): Promise<QuotaCheckResult> => {
    try {
      const session = await getSessionSafe();
      if (!session) {
        return { allowed: false, remaining: 0, message: '请先登录' };
      }

      const response = await fetch('/api/users/me/quota/check', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quota_type: type, amount }),
      });

      if (!response.ok) {
        throw new Error('配额检查失败');
      }

      return await response.json();
    } catch {
      return {
        allowed: false,
        remaining: 0,
        message: '配额检查失败，请稍后重试',
      };
    }
  }, []);

  // 快速检查本地配额（不发送请求）
  const hasQuota = useCallback((type: QuotaType): boolean => {
    if (!quota) return false;

    switch (type) {
      case 'free_trial':
        return quota.free_trials_remaining > 0;
      case 'ai_task':
        return quota.ai_tasks_daily_limit === -1 || quota.ai_tasks_remaining_today > 0;
      case 'storage':
        return quota.storage_remaining_mb > 0;
      case 'project':
        return quota.max_projects === -1 || true; // 需要实际项目数来判断
      default:
        return false;
    }
  }, [quota]);

  // 初始加载
  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  return (
    <QuotaContext.Provider
      value={{
        quota,
        loading,
        error,
        refreshQuota,
        checkQuota,
        hasQuota,
      }}
    >
      {children}
    </QuotaContext.Provider>
  );
}

// ============================================
// Hook
// ============================================

export function useQuota() {
  const context = useContext(QuotaContext);
  
  if (!context) {
    throw new Error('useQuota must be used within a QuotaProvider');
  }
  
  return context;
}

// ============================================
// 独立 Hook（无需 Provider）
// ============================================

export function useQuotaStandalone() {
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshQuota = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const session = await getSessionSafe();
      if (!session) {
        setQuota(null);
        setLoading(false);
        return;
      }

      const response = await fetch('/api/users/me/quota', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取配额信息失败');
      }

      const data = await response.json();
      setQuota(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  const checkQuota = useCallback(async (type: QuotaType, amount: number = 1): Promise<QuotaCheckResult> => {
    try {
      const session = await getSessionSafe();
      if (!session) {
        return { allowed: false, remaining: 0, message: '请先登录' };
      }

      const response = await fetch('/api/users/me/quota/check', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quota_type: type, amount }),
      });

      if (!response.ok) throw new Error('配额检查失败');
      return await response.json();
    } catch {
      return { allowed: false, remaining: 0, message: '配额检查失败' };
    }
  }, []);

  const hasQuota = useCallback((type: QuotaType): boolean => {
    if (!quota) return false;
    switch (type) {
      case 'free_trial':
        return quota.free_trials_remaining > 0;
      case 'ai_task':
        return quota.ai_tasks_daily_limit === -1 || quota.ai_tasks_remaining_today > 0;
      case 'storage':
        return quota.storage_remaining_mb > 0;
      case 'project':
        return quota.max_projects === -1 || true;
      default:
        return false;
    }
  }, [quota]);

  return { quota, loading, error, refreshQuota, checkQuota, hasQuota };
}

export default useQuota;
