'use client';

import { useState, useEffect } from 'react';
import { X, Check, Zap, Crown, Building2, Loader2 } from 'lucide-react';

// ============================================
// 类型定义
// ============================================

interface PlanFeatures {
  free_trials?: number;
  ai_tasks_daily: number;
  storage_mb: number;
  max_projects: number;
  watermark_free?: boolean;
  priority_support?: boolean;
  api_access?: boolean;
}

interface SubscriptionPlan {
  id?: string;
  name: string;
  slug: string;
  price_monthly: number;
  price_yearly: number;
  features: PlanFeatures;
  is_popular?: boolean;
}

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTier?: string;
  triggerReason?: 'quota_exceeded' | 'feature_locked' | 'manual';
  quotaType?: string;
}

// ============================================
// 计划图标
// ============================================

function getPlanIcon(slug: string) {
  switch (slug) {
    case 'pro':
      return <Crown className="w-6 h-6 text-amber-400" />;
    case 'enterprise':
      return <Building2 className="w-6 h-6 text-purple-400" />;
    default:
      return <Zap className="w-6 h-6 text-gray-400" />;
  }
}

// ============================================
// 功能项
// ============================================

interface FeatureItemProps {
  included: boolean;
  children: React.ReactNode;
}

function FeatureItem({ included, children }: FeatureItemProps) {
  return (
    <li className="flex items-center gap-2">
      {included ? (
        <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
      ) : (
        <X className="w-4 h-4 text-gray-600 flex-shrink-0" />
      )}
      <span className={included ? 'text-gray-300' : 'text-gray-600'}>
        {children}
      </span>
    </li>
  );
}

// ============================================
// 主组件
// ============================================

export function UpgradeModal({ 
  isOpen, 
  onClose, 
  currentTier = 'free',
  triggerReason = 'manual',
  quotaType
}: UpgradeModalProps) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  // 获取订阅计划
  useEffect(() => {
    if (isOpen) {
      fetchPlans();
    }
  }, [isOpen]);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/users/plans', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setPlans(data.plans || []);
      } else {
        // 使用默认计划
        setPlans(getDefaultPlans());
      }
    } catch {
      setPlans(getDefaultPlans());
    } finally {
      setLoading(false);
    }
  };

  const getDefaultPlans = (): SubscriptionPlan[] => [
    {
      name: 'Free',
      slug: 'free',
      price_monthly: 0,
      price_yearly: 0,
      features: {
        free_trials: 6,
        ai_tasks_daily: 10,
        storage_mb: 500,
        max_projects: 3,
      },
    },
    {
      name: 'Pro',
      slug: 'pro',
      price_monthly: 19.99,
      price_yearly: 199.99,
      features: {
        ai_tasks_daily: 100,
        storage_mb: 10240,
        max_projects: 20,
        watermark_free: true,
      },
      is_popular: true,
    },
    {
      name: 'Enterprise',
      slug: 'enterprise',
      price_monthly: 49.99,
      price_yearly: 499.99,
      features: {
        ai_tasks_daily: -1,
        storage_mb: 102400,
        max_projects: -1,
        watermark_free: true,
        priority_support: true,
        api_access: true,
      },
    },
  ];

  const handleUpgrade = async (planSlug: string) => {
    // TODO: 实现支付流程
    setSelectedPlan(planSlug);
    setUpgrading(true);

    // 模拟支付流程
    setTimeout(() => {
      alert('支付功能开发中，敬请期待！');
      setUpgrading(false);
      setSelectedPlan(null);
    }, 1000);
  };

  const getQuotaMessage = () => {
    if (triggerReason === 'quota_exceeded') {
      switch (quotaType) {
        case 'free_trial':
          return '您的免费试用次数已用完';
        case 'ai_task':
          return '您今日的 AI 任务配额已用完';
        case 'storage':
          return '您的存储空间已满';
        case 'project':
          return '您的项目数已达上限';
        default:
          return '您的配额已用完';
      }
    }
    if (triggerReason === 'feature_locked') {
      return '此功能需要升级才能使用';
    }
    return null;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 模态框 */}
      <div className="relative bg-[#0a0a0a] border border-gray-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-auto mx-4">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white 
                     hover:bg-gray-800 rounded-lg transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 md:p-8">
          {/* 头部 */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">
              升级您的计划
            </h2>
            {getQuotaMessage() && (
              <p className="text-amber-400 mb-2">{getQuotaMessage()}</p>
            )}
            <p className="text-gray-400">
              选择适合您的计划，解锁更多强大功能
            </p>
          </div>

          {/* 计费周期切换 */}
          <div className="flex justify-center mb-8">
            <div className="bg-gray-800/50 rounded-lg p-1 inline-flex">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  billingCycle === 'monthly'
                    ? 'bg-white text-black'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                月付
              </button>
              <button
                onClick={() => setBillingCycle('yearly')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  billingCycle === 'yearly'
                    ? 'bg-white text-black'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                年付
                <span className="ml-1 text-green-400">-17%</span>
              </button>
            </div>
          </div>

          {/* 计划列表 */}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              {plans.map((plan) => {
                const price = billingCycle === 'monthly' 
                  ? plan.price_monthly 
                  : plan.price_yearly;
                const isCurrentPlan = plan.slug === currentTier;
                const canUpgrade = !isCurrentPlan && plan.slug !== 'free';
                const features = plan.features;

                return (
                  <div
                    key={plan.slug}
                    className={`relative rounded-xl p-6 border transition-all ${
                      plan.is_popular
                        ? 'border-blue-500 bg-blue-500/5'
                        : 'border-gray-800 bg-gray-900/30'
                    } ${
                      isCurrentPlan ? 'ring-2 ring-green-500' : ''
                    }`}
                  >
                    {/* 热门标签 */}
                    {plan.is_popular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="px-3 py-1 bg-blue-500 text-white text-xs font-medium rounded-full">
                          最受欢迎
                        </span>
                      </div>
                    )}

                    {/* 当前计划标签 */}
                    {isCurrentPlan && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="px-3 py-1 bg-green-500 text-white text-xs font-medium rounded-full">
                          当前计划
                        </span>
                      </div>
                    )}

                    {/* 计划名称 */}
                    <div className="flex items-center gap-3 mb-4">
                      {getPlanIcon(plan.slug)}
                      <h3 className="text-xl font-semibold text-white">
                        {plan.name}
                      </h3>
                    </div>

                    {/* 价格 */}
                    <div className="mb-6">
                      <span className="text-4xl font-bold text-white">
                        ${price === 0 ? '0' : price.toFixed(2)}
                      </span>
                      {price > 0 && (
                        <span className="text-gray-400 ml-1">
                          /{billingCycle === 'monthly' ? '月' : '年'}
                        </span>
                      )}
                    </div>

                    {/* 功能列表 */}
                    <ul className="space-y-3 mb-6 text-sm">
                      <FeatureItem included>
                        每日 {features.ai_tasks_daily === -1 
                          ? '无限' 
                          : features.ai_tasks_daily} 次 AI 任务
                      </FeatureItem>
                      <FeatureItem included>
                        {features.storage_mb >= 1024
                          ? `${features.storage_mb / 1024} GB`
                          : `${features.storage_mb} MB`} 存储空间
                      </FeatureItem>
                      <FeatureItem included>
                        {features.max_projects === -1
                          ? '无限'
                          : features.max_projects} 个项目
                      </FeatureItem>
                      <FeatureItem included={!!features.watermark_free}>
                        无水印导出
                      </FeatureItem>
                      <FeatureItem included={!!features.priority_support}>
                        优先客服支持
                      </FeatureItem>
                      <FeatureItem included={!!features.api_access}>
                        API 访问权限
                      </FeatureItem>
                    </ul>

                    {/* 操作按钮 */}
                    <button
                      onClick={() => canUpgrade && handleUpgrade(plan.slug)}
                      disabled={!canUpgrade || upgrading}
                      className={`w-full py-3 px-4 rounded-lg font-medium transition-all ${
                        canUpgrade
                          ? plan.is_popular
                            ? 'bg-blue-500 hover:bg-blue-600 text-white'
                            : 'bg-white hover:bg-gray-100 text-black'
                          : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {upgrading && selectedPlan === plan.slug ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          处理中...
                        </span>
                      ) : isCurrentPlan ? (
                        '当前计划'
                      ) : plan.slug === 'free' ? (
                        '免费使用'
                      ) : (
                        '立即升级'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 底部说明 */}
          <div className="mt-8 text-center text-sm text-gray-500">
            <p>所有计划均支持 7 天无理由退款</p>
            <p className="mt-1">
              如有任何问题，请联系 support@hoppingrabbit.ai
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UpgradeModal;
