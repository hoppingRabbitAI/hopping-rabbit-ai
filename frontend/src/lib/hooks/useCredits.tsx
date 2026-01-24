'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// Supabase 客户端
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * 安全获取 session，不抛出错误
 */
async function getSessionSafe() {
  try {
    const supabase = getSupabaseClient();
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Session check warning:', error.message);
      return null;
    }
    return session;
  } catch (err) {
    // 忽略 AuthSessionMissingError
    console.warn('Session not available');
    return null;
  }
}

/**
 * 用户积分信息
 */
export interface UserCredits {
  credits_balance: number;        // 当前可用积分
  monthly_credits_limit: number;  // 月度配额上限
  monthly_credits_used: number;   // 本月已用
  paid_credits: number;           // 充值积分 (永不过期)
  free_trial_credits: number;     // 剩余试用积分
  tier: 'free' | 'pro' | 'enterprise';  // 会员等级
  storage_limit_mb: number;
  storage_used_mb: number;
  max_projects: number;
  monthly_reset_at: string | null;
  credits_total_granted?: number;
  credits_total_consumed?: number;
}

/**
 * 模型定价信息
 */
export interface ModelPricing {
  model_key: string;
  model_name: string;
  provider: string;
  category: string;
  description: string | null;
  pricing_type: 'per_call' | 'per_second' | 'per_minute' | 'fixed';
  credits_rate: number;
  min_credits: number;
  max_credits: number | null;
}

/**
 * 交易记录
 */
export interface CreditTransaction {
  id: string;
  transaction_type: 'consume' | 'grant' | 'refund' | 'purchase' | 'expire' | 'adjust';
  credits_amount: number;
  credits_before: number;
  credits_after: number;
  model_key: string | null;
  model_name: string | null;
  ai_task_id: string | null;
  description: string | null;
  created_at: string;
}

/**
 * useCredits Hook
 * 管理用户积分状态
 */
export function useCredits() {
  const [credits, setCredits] = useState<UserCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const session = await getSessionSafe();

      if (!session) {
        setCredits(null);
        setLoading(false);
        return;
      }

      const response = await fetch('/api/credits', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取积分失败');
      }

      const data = await response.json();
      setCredits(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取积分失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  /**
   * 计算操作所需积分
   */
  const calculateCredits = useCallback(async (
    modelKey: string,
    params?: { duration_seconds?: number; duration_minutes?: number; count?: number }
  ): Promise<{ credits_required: number; pricing_type: string }> => {
    const session = await getSessionSafe();

    if (!session) {
      throw new Error('请先登录');
    }

    const response = await fetch('/api/credits/calculate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_key: modelKey,
        ...params,
      }),
    });

    if (!response.ok) {
      throw new Error('计算积分失败');
    }

    return response.json();
  }, []);

  /**
   * 检查积分是否充足
   */
  const checkCredits = useCallback(async (
    creditsRequired: number
  ): Promise<{ allowed: boolean; message: string }> => {
    const session = await getSessionSafe();

    if (!session) {
      return { allowed: false, message: '请先登录' };
    }

    const response = await fetch('/api/credits/check', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credits_required: creditsRequired,
      }),
    });

    if (!response.ok) {
      throw new Error('检查积分失败');
    }

    return response.json();
  }, []);

  /**
   * 消耗积分
   */
  const consumeCredits = useCallback(async (
    modelKey: string,
    credits: number,
    options?: { ai_task_id?: string; description?: string }
  ): Promise<{ success: boolean; credits_after: number }> => {
    const session = await getSessionSafe();

    if (!session) {
      throw new Error('请先登录');
    }

    const response = await fetch('/api/credits/consume', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_key: modelKey,
        credits,
        ...options,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      if (response.status === 402) {
        throw new Error(error.detail?.message || '积分不足');
      }
      throw new Error('消耗积分失败');
    }

    const result = await response.json();
    
    // 刷新积分
    await fetchCredits();
    
    return result;
  }, [fetchCredits]);

  /**
   * 冻结积分 (任务开始时)
   */
  const holdCredits = useCallback(async (
    credits: number,
    aiTaskId: string,
    modelKey?: string
  ): Promise<{ success: boolean; transaction_id: string }> => {
    const session = await getSessionSafe();

    if (!session) {
      throw new Error('请先登录');
    }

    const response = await fetch('/api/credits/hold', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credits,
        ai_task_id: aiTaskId,
        model_key: modelKey,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      if (response.status === 402) {
        throw new Error(error.detail?.message || '积分不足');
      }
      throw new Error('冻结积分失败');
    }

    const result = await response.json();
    await fetchCredits();
    return result;
  }, [fetchCredits]);

  return {
    credits,
    loading,
    error,
    refetch: fetchCredits,
    calculateCredits,
    checkCredits,
    consumeCredits,
    holdCredits,
  };
}

/**
 * useModelPricing Hook
 * 获取模型定价信息
 */
export function useModelPricing(category?: string) {
  const [pricing, setPricing] = useState<ModelPricing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const url = category 
          ? `/api/credits/pricing/public?category=${category}`
          : '/api/credits/pricing/public';
        
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          setPricing(data);
        }
      } catch (err) {
        console.error('获取定价失败:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPricing();
  }, [category]);

  return { pricing, loading };
}

/**
 * useCreditTransactions Hook
 * 获取交易记录
 */
export function useCreditTransactions(limit = 50) {
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const fetchTransactions = useCallback(async (offset = 0) => {
    try {
      setLoading(true);

      const session = await getSessionSafe();

      if (!session) {
        return;
      }

      const response = await fetch(
        `/api/credits/transactions?limit=${limit}&offset=${offset}`,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (offset === 0) {
          setTransactions(data.transactions);
        } else {
          setTransactions(prev => [...prev, ...data.transactions]);
        }
        setTotal(data.total);
        setHasMore(data.has_more);
      }
    } catch (err) {
      console.error('获取交易记录失败:', err);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchTransactions(0);
  }, [fetchTransactions]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchTransactions(transactions.length);
    }
  }, [loading, hasMore, transactions.length, fetchTransactions]);

  return {
    transactions,
    total,
    loading,
    hasMore,
    loadMore,
    refetch: () => fetchTransactions(0),
  };
}
