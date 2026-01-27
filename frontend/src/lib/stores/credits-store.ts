/**
 * Credits 积分状态管理
 * 全局管理用户积分状态，支持跨组件刷新
 */
import { create } from 'zustand';
import { getSessionSafe } from '@/lib/supabase';

export interface UserCredits {
  credits_balance: number;        // 当前可用积分 (唯一真实来源)
  tier: string;                   // 会员等级
  credits_total_granted?: number; // 累计获得
  credits_total_consumed?: number; // 累计消耗
}

interface CreditsStore {
  credits: UserCredits | null;
  loading: boolean;
  error: string | null;
  // 是否已初始化（防止重复请求）
  initialized: boolean;
  // 初始化（只请求一次）
  initCredits: () => Promise<void>;
  // 强制刷新
  refetchCredits: () => Promise<void>;
  setCredits: (credits: UserCredits | null) => void;
  clearCredits: () => void;
}

export const useCreditsStore = create<CreditsStore>((set, get) => ({
  credits: null,
  loading: true,
  error: null,
  initialized: false,

  // 初始化：只在首次调用时请求，后续直接返回
  initCredits: async () => {
    const { initialized, credits } = get();
    
    // 已初始化且有数据，跳过
    if (initialized && credits !== null) {
      return;
    }

    // 正在加载中，跳过
    if (get().loading && initialized) {
      return;
    }

    set({ loading: true, initialized: true });

    try {
      const session = await getSessionSafe();

      if (!session) {
        set({ credits: null, loading: false });
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
      set({ credits: data, loading: false });
    } catch (err) {
      set({ 
        error: err instanceof Error ? err.message : '获取积分失败',
        loading: false 
      });
    }
  },

  // 强制刷新（操作后需要更新余额时调用）
  refetchCredits: async () => {
    set({ loading: true, error: null });

    try {
      const session = await getSessionSafe();

      if (!session) {
        set({ credits: null, loading: false });
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
      set({ credits: data, loading: false });
    } catch (err) {
      set({ 
        error: err instanceof Error ? err.message : '获取积分失败',
        loading: false 
      });
    }
  },

  setCredits: (credits) => {
    set({ credits });
  },

  clearCredits: () => {
    set({ credits: null, loading: false, error: null, initialized: false });
  },
}));
