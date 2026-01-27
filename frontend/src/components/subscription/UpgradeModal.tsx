'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  X, 
  Check, 
  Zap, 
  Crown, 
  Gem,
  Rocket,
  Sparkles,
  Loader2 
} from 'lucide-react';
import { getSessionSafe } from '@/lib/supabase';
import { toast } from '@/lib/stores/toast-store';
import { 
  useSubscriptionPlans, 
  transformPlansToDisplayPlans,
  DisplayPlan,
  DisplayPlanFeature,
  DisplayUnlimitedFeature
} from '@/lib/hooks/useSubscriptionPlans';

// ============================================
// 图标渲染器
// ============================================

function getPlanIcon(slug: string) {
  switch (slug) {
    case 'basic': return <Zap className="w-5 h-5 text-gray-400" />;
    case 'pro': return <Crown className="w-5 h-5 text-amber-400" />;
    case 'ultimate': return <Gem className="w-5 h-5 text-pink-400" />;
    case 'creator': return <Rocket className="w-5 h-5 text-pink-400" />;
    default: return <Zap className="w-5 h-5 text-gray-400" />;
  }
}

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTier?: string;
  triggerReason?: 'quota_exceeded' | 'feature_locked' | 'manual';
  quotaType?: string;
  onSuccess?: () => void; // 订阅成功后的回调，用于刷新积分等状态
}

// ============================================
// Badge 组件 (白灰风格)
// ============================================

function Badge({ text, color = 'green' }: { text: string; color?: 'green' | 'yellow' | 'pink' }) {
  const colorClasses = {
    green: 'bg-green-100 text-green-700 border-green-200',
    yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    pink: 'bg-pink-100 text-pink-700 border-pink-200',
  };
  
  return (
    <span className={`ml-1 px-1 py-0.5 text-[9px] font-medium rounded border ${colorClasses[color]}`}>
      {text}
    </span>
  );
}

// ============================================
// 订阅 API
// ============================================

async function subscribeToplan(
  planSlug: string, 
  billingCycle: string,
  accessToken: string
): Promise<{
  success: boolean;
  message: string;
  credits_granted?: number;
}> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/subscriptions/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      plan_slug: planSlug,
      billing_cycle: billingCycle,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || '订阅失败');
  }

  return response.json();
}

// ============================================
// 主组件
// ============================================

export function UpgradeModal({ 
  isOpen, 
  onClose, 
  currentTier = 'free',
  triggerReason = 'manual',
  quotaType,
  onSuccess
}: UpgradeModalProps) {
  const router = useRouter();
  const [subscribingPlan, setSubscribingPlan] = useState<string | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // 从 API 获取订阅计划 - 单一数据源
  const { plans: apiPlans, loading: plansLoading, error: plansError } = useSubscriptionPlans();
  const displayPlans = transformPlansToDisplayPlans(apiPlans, getPlanIcon, true);

  useEffect(() => {
    if (isOpen) {
      getSessionSafe().then(session => {
        if (session) {
          setAccessToken(session.access_token);
        }
      });
    }
  }, [isOpen]);

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
        case 'credits':
          return '您的积分已用完';
        default:
          return '您的配额已用完';
      }
    }
    if (triggerReason === 'feature_locked') {
      return '此功能需要升级才能使用';
    }
    return null;
  };

  const handleSubscribe = async (planSlug: string) => {
    if (!accessToken) {
      router.push('/login?redirect=/pricing');
      onClose();
      return;
    }

    setIsSubscribing(true);
    setSubscribingPlan(planSlug);

    try {
      const result = await subscribeToplan(
        planSlug,
        'monthly',
        accessToken
      );

      if (result.success) {
        toast.success('订阅成功！');
        // 调用成功回调，刷新积分等状态
        if (onSuccess) {
          onSuccess();
        }
        onClose();
        
        // ★ 订阅成功后强制刷新页面，确保所有状态同步
        window.location.reload();
      }
    } catch (error) {
      console.error('订阅失败:', error);
      toast.error(error instanceof Error ? error.message : '订阅失败，请稍后重试');
    } finally {
      setIsSubscribing(false);
      setSubscribingPlan(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 模态框 - 白灰风格 */}
      <div className="relative bg-white border border-gray-200 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-auto mx-4 shadow-xl">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 
                     hover:bg-gray-100 rounded-lg transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 md:p-8">
          {/* 头部 */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              升级您的计划
            </h2>
            {getQuotaMessage() && (
              <p className="text-amber-600 mb-2">{getQuotaMessage()}</p>
            )}
            <p className="text-gray-500">
              选择适合您的计划，解锁更多强大功能
            </p>
          </div>

          {/* 计划列表 - 动态显示 */}
          {plansLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              <span className="ml-2 text-gray-500">加载中...</span>
            </div>
          ) : plansError ? (
            <div className="text-center py-20 text-red-500">
              加载计划失败，请刷新重试
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayPlans.map((plan) => {
              const price = plan.priceMonthly;
              const isCurrent = currentTier === plan.slug;
              const isLoading = isSubscribing && subscribingPlan === plan.slug;

              return (
                <div
                  key={plan.slug}
                  className={`relative bg-white rounded-xl flex flex-col
                              border transition-all duration-300 shadow-sm ${
                                plan.isPopular
                                  ? 'border-purple-400 shadow-purple-100'
                                  : plan.isSpecial
                                  ? 'border-pink-300'
                                  : isCurrent
                                  ? 'border-green-400'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                >
                  {/* 热门标签 */}
                  {plan.isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="px-2 py-1 bg-gradient-to-r from-purple-500 to-pink-500 
                                     text-white text-[10px] font-bold rounded-full whitespace-nowrap">
                        ◆ MOST POPULAR
                      </span>
                    </div>
                  )}
                  
                  {/* 特殊标签 */}
                  {plan.isSpecial && plan.specialLabel && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="px-2 py-1 bg-gradient-to-r from-pink-500 to-rose-500 
                                     text-white text-[9px] font-bold rounded-full whitespace-nowrap">
                        {plan.specialLabel}
                      </span>
                    </div>
                  )}

                  {/* 当前计划标签 */}
                  {isCurrent && !plan.isPopular && !plan.isSpecial && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="px-2 py-1 bg-green-500 text-white text-[10px] font-bold rounded-full">
                        当前计划
                      </span>
                    </div>
                  )}

                  {/* 头部 */}
                  <div className="p-4 pb-2 pt-5">
                    <div className="flex items-center gap-2 mb-1">
                      {plan.icon}
                      <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                      {(plan.isSpecial || plan.isPopular) && (
                        <span className="px-1.5 py-0.5 bg-pink-100 text-pink-600 text-[9px] font-bold rounded">
                          85% OFF
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500">{plan.description}</p>
                  </div>

                  {/* 价格 */}
                  <div className="px-4 pb-3">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-gray-900">
                        ${price.toFixed(1)}
                      </span>
                      <span className="text-gray-500 text-xs">/mo</span>
                    </div>
                  </div>

                  {/* CTA 按钮 */}
                  <div className="px-4 pb-3">
                    <button
                      onClick={() => !isCurrent && !isLoading && handleSubscribe(plan.slug)}
                      disabled={isCurrent || isLoading || isSubscribing}
                      className={`w-full py-2 px-3 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                        plan.ctaVariant === 'pink'
                          ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:opacity-90'
                          : 'bg-gray-900 text-white hover:bg-gray-800'
                      } ${(isCurrent || isLoading || isSubscribing) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          处理中...
                        </>
                      ) : isCurrent ? (
                        '当前计划'
                      ) : (
                        plan.ctaText
                      )}
                    </button>
                  </div>

                  {/* 积分信息 */}
                  <div className="px-4 pb-3 border-t border-gray-100 pt-3">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
                      <span className="text-purple-600 font-bold text-xs">
                        {plan.creditsPerMonth.toLocaleString()} credits/month
                      </span>
                    </div>
                    {plan.bonusText && (
                      <p className="text-[10px] text-gray-400 mt-0.5 ml-5">{plan.bonusText}</p>
                    )}
                  </div>

                  {/* 功能列表 */}
                  <div className="px-4 pb-3 flex-1">
                    <ul className="space-y-1.5">
                      {plan.features.map((feature, index) => (
                        <li
                          key={index}
                          className={`flex items-start gap-1.5 text-[11px] ${
                            feature.included ? 'text-gray-700' : 'text-gray-400'
                          }`}
                        >
                          {feature.included ? (
                            <Check className="w-3 h-3 flex-shrink-0 text-green-500 mt-0.5" />
                          ) : (
                            <X className="w-3 h-3 flex-shrink-0 text-gray-300 mt-0.5" />
                          )}
                          <span className="flex-1">{feature.text}</span>
                          {feature.badge && (
                            <Badge text={feature.badge} color={feature.badgeColor} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* UNLIMITED ACCESS */}
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                    <h4 className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      UNLIMITED ACCESS
                    </h4>
                    <ul className="space-y-1">
                      {plan.unlimitedAccess.map((item, index) => (
                        <li
                          key={index}
                          className={`flex items-start gap-1.5 text-[10px] ${
                            item.included ? 'text-gray-700' : 'text-gray-400'
                          }`}
                        >
                          {item.included ? (
                            <Check className="w-3 h-3 flex-shrink-0 text-green-500 mt-0.5" />
                          ) : (
                            <X className="w-3 h-3 flex-shrink-0 text-gray-300 mt-0.5" />
                          )}
                          <span>{item.name}</span>
                          {item.badge && item.included && (
                            <Badge text={item.badge} color={item.badgeColor} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {/* 底部说明 */}
          <div className="mt-6 text-center text-sm text-gray-400">
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
