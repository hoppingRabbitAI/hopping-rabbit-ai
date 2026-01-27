'use client';

import { useState, useEffect, useCallback } from 'react';
import { ReactNode } from 'react';

// ============================================
// 类型定义 - API 返回的数据结构
// ============================================

export interface PlanFeatures {
  concurrent_videos: number;
  concurrent_images: number;
  concurrent_characters: number;
  ai_create_free_gens: number;
  access_all_models: boolean;
  access_all_features: boolean;
  early_access_advanced: boolean;
  extra_credits_discount: number;
  storage_mb: number;
  max_projects: number;
  watermark: boolean;
  unlimited_access: string[];
}

export interface SubscriptionPlan {
  slug: string;
  name: string;
  description: string;
  price_monthly: number;
  credits_per_month: number;
  bonus_credits: number;
  features: PlanFeatures;
  is_popular: boolean;
  badge_text?: string;
  display_order: number;
}

// ============================================
// 类型定义 - 前端显示用的数据结构
// ============================================

export interface DisplayPlanFeature {
  text: string;
  included: boolean;
  badge?: string;
  badgeColor?: 'green' | 'yellow' | 'pink';
}

export interface DisplayUnlimitedFeature {
  name: string;
  badge?: string;
  badgeColor?: 'green' | 'yellow' | 'pink';
  included: boolean;
}

export interface DisplayPlan {
  name: string;
  slug: string;
  description: string;
  priceMonthly: number;
  creditsPerMonth: number;
  bonusText?: string;
  icon: ReactNode;
  features: DisplayPlanFeature[];
  unlimitedAccess: DisplayUnlimitedFeature[];
  isPopular?: boolean;
  isSpecial?: boolean;
  specialLabel?: string;
  ctaText: string;
  ctaVariant: 'primary' | 'secondary' | 'outline' | 'pink';
}

// ============================================
// Hook
// ============================================

export function useSubscriptionPlans(enabled: boolean = true) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/subscriptions/plans');

      if (!response.ok) {
        throw new Error('获取订阅计划失败');
      }

      const data = await response.json();
      
      // 按 display_order 排序
      const sortedPlans = (data.plans || []).sort(
        (a: SubscriptionPlan, b: SubscriptionPlan) => a.display_order - b.display_order
      );
      
      setPlans(sortedPlans);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取订阅计划失败');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  return {
    plans,
    loading,
    error,
    refetch: fetchPlans,
  };
}

// ============================================
// 工具函数
// ============================================

/**
 * 根据 slug 获取计划图标样式
 */
export function getPlanIconStyle(slug: string) {
  switch (slug) {
    case 'free':
      return { color: 'text-gray-400', bg: 'bg-gray-100' };
    case 'basic':
      return { color: 'text-blue-500', bg: 'bg-blue-100' };
    case 'pro':
      return { color: 'text-amber-500', bg: 'bg-amber-100' };
    case 'ultimate':
      return { color: 'text-purple-500', bg: 'bg-purple-100' };
    case 'creator':
      return { color: 'text-pink-500', bg: 'bg-pink-100' };
    default:
      return { color: 'text-gray-400', bg: 'bg-gray-100' };
  }
}

/**
 * 格式化存储空间显示
 */
export function formatStorage(mb: number): string {
  if (mb >= 1000) {
    return `${(mb / 1000).toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

// ============================================
// 转换 API 数据为显示格式
// ============================================

/**
 * 将 API 返回的 SubscriptionPlan 转换为前端 DisplayPlan 格式
 * 这是唯一的转换逻辑，确保前端显示与数据库数据一致
 */
export function transformPlanToDisplayPlan(
  plan: SubscriptionPlan, 
  allPlans: SubscriptionPlan[],
  iconRenderer: (slug: string) => ReactNode
): DisplayPlan {
  // 防御性检查：确保 features 存在
  const features = plan.features || {
    concurrent_videos: 1,
    concurrent_images: 1,
    concurrent_characters: 0,
    ai_create_free_gens: 0,
    access_all_models: false,
    access_all_features: false,
    early_access_advanced: false,
    extra_credits_discount: 0,
    storage_mb: 500,
    max_projects: 3,
    watermark: true,
    unlimited_access: [],
  };
  
  // 构建 features 列表 - 基于数据库中的 features JSONB
  const displayFeatures: DisplayPlanFeature[] = [
    {
      text: features.access_all_models ? '访问全部模型' : '访问基础模型',
      included: true,
    },
    {
      text: `同时处理: ${features.concurrent_videos} 视频, ${features.concurrent_images} 图像${features.concurrent_characters > 0 ? `, ${features.concurrent_characters} 角色` : ''}`,
      included: true,
    },
    {
      text: 'AI 智能剪辑',
      included: true,
      badge: `${features.ai_create_free_gens} FREE`,
      badgeColor: 'green',
    },
    {
      text: '访问全部功能',
      included: features.access_all_features,
    },
    {
      text: '优先使用高级 AI 功能',
      included: features.early_access_advanced,
    },
    {
      text: features.extra_credits_discount > 0 
        ? `${features.extra_credits_discount}% 额外积分折扣`
        : '额外积分折扣',
      included: features.extra_credits_discount > 0,
      badge: features.extra_credits_discount >= 15 ? 'EXTRA' : undefined,
      badgeColor: 'yellow',
    },
  ];

  // 构建 unlimited access 列表
  // 确保 unlimited_access 是数组
  const unlimitedAccessList = Array.isArray(features.unlimited_access) ? features.unlimited_access : [];
  const unlimitedAccess: DisplayUnlimitedFeature[] = [
    {
      name: '图像生成',
      included: unlimitedAccessList.includes('image_generation'),
      badge: unlimitedAccessList.includes('image_generation') 
        ? (plan.slug === 'creator' ? '2 YEAR UNLIMITED' : '365 UNLIMITED')
        : undefined,
      badgeColor: plan.slug === 'creator' ? 'pink' : 'green',
    },
    {
      name: 'AI 智能剪辑',
      included: unlimitedAccessList.includes('ai_create'),
      badge: unlimitedAccessList.includes('ai_create')
        ? (plan.slug === 'creator' ? '2 YEAR UNLIMITED' : '365 UNLIMITED')
        : undefined,
      badgeColor: plan.slug === 'creator' ? 'pink' : 'green',
    },
    {
      name: 'Kling 2.6',
      included: unlimitedAccessList.includes('kling_all'),
      badge: unlimitedAccessList.includes('kling_all') ? 'UNLIMITED' : undefined,
      badgeColor: 'yellow',
    },
    {
      name: 'Kling 口型同步',
      included: unlimitedAccessList.includes('kling_all'),
      badge: unlimitedAccessList.includes('kling_all') ? 'UNLIMITED' : undefined,
      badgeColor: 'yellow',
    },
    {
      name: 'Kling 运动控制',
      included: unlimitedAccessList.includes('kling_all'),
      badge: unlimitedAccessList.includes('kling_all') ? 'UNLIMITED' : undefined,
      badgeColor: 'yellow',
    },
  ];

  // 确定 CTA 变体
  const ctaVariant = (plan.is_popular || plan.slug === 'creator') ? 'pink' : 'outline';

  // 确定是否是特殊计划
  const isSpecial = plan.slug === 'creator';

  // 生成奖励文本
  let bonusText: string | undefined;
  if (plan.slug === 'pro') {
    bonusText = `= ${Math.round(plan.credits_per_month / 2)} Kling 标准`;
  } else if (plan.slug === 'ultimate') {
    bonusText = '+ 365 UNLIMITED AI 智能剪辑';
  } else if (plan.slug === 'creator') {
    bonusText = '+ 2 Year UNLIMITED AI 智能剪辑';
  }

  return {
    name: plan.name,
    slug: plan.slug,
    description: plan.description,
    priceMonthly: plan.price_monthly,
    creditsPerMonth: plan.credits_per_month,
    bonusText,
    icon: iconRenderer(plan.slug),
    features: displayFeatures,
    unlimitedAccess,
    isPopular: plan.is_popular,
    isSpecial,
    specialLabel: isSpecial ? '⭐ 2 YEAR PERSONAL ONE TIME OFFER' : undefined,
    ctaText: `选择 ${plan.name}`,
    ctaVariant,
  };
}

/**
 * 批量转换计划列表
 */
export function transformPlansToDisplayPlans(
  plans: SubscriptionPlan[],
  iconRenderer: (slug: string) => ReactNode,
  excludeFree: boolean = true
): DisplayPlan[] {
  const filteredPlans = excludeFree 
    ? plans.filter(p => p.slug !== 'free')
    : plans;
    
  return filteredPlans.map(plan => 
    transformPlanToDisplayPlan(plan, plans, iconRenderer)
  );
}
