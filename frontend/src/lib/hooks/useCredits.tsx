'use client';

import { useState, useEffect, useCallback } from 'react';
import { getSessionSafe } from '@/lib/supabase';
import { useCreditsStore } from '@/lib/stores/credits-store';

/**
 * 用户积分信息 - 简化版
 * credits_balance 是唯一的真实余额
 */
export interface UserCredits {
  credits_balance: number;        // 当前可用积分 (唯一真实来源)
  tier: 'free' | 'pro' | 'enterprise';  // 会员等级
  credits_total_granted?: number; // 累计获得 (统计用)
  credits_total_consumed?: number; // 累计消耗 (统计用)
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
 * 管理用户积分状态 - 使用全局 store 实现跨组件同步
 */
export function useCredits() {
  // 使用全局 store
  const { credits, loading, error, initCredits, refetchCredits } = useCreditsStore();

  useEffect(() => {
    // 初始化积分（内部会判断是否已加载，不会重复请求）
    initCredits();
  }, [initCredits]);

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
    await refetchCredits();
    
    return result;
  }, [refetchCredits]);

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
    await refetchCredits();
    return result;
  }, [refetchCredits]);

  return {
    credits,
    loading,
    error,
    refetch: refetchCredits,
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
