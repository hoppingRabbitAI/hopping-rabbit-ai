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
import { usePricingModalStore, PricingModalTrigger } from '@/lib/stores/pricing-modal-store';
import { 
  useSubscriptionPlans, 
  transformPlansToDisplayPlans,
  DisplayPlan,
} from '@/lib/hooks/useSubscriptionPlans';

// ============================================
// 图标渲染器
// ============================================

function getPlanIcon(slug: string) {
  switch (slug) {
    case 'basic': return <Zap className="w-5 h-5 text-gray-400" />;
    case 'pro': return <Crown className="w-5 h-5 text-gray-400" />;
    case 'ultimate': return <Gem className="w-5 h-5 text-gray-400" />;
    case 'creator': return <Rocket className="w-5 h-5 text-gray-400" />;
    default: return <Zap className="w-5 h-5 text-gray-400" />;
  }
}

// ============================================
// Badge 组件 (白灰风格)
// ============================================

function Badge({ text, color = 'green' }: { text: string; color?: 'green' | 'yellow' | 'pink' }) {
  const colorClasses = {
    green: 'bg-gray-100 text-gray-700 border-gray-200',
    yellow: 'bg-gray-100 text-gray-700 border-gray-200',
    pink: 'bg-gray-100 text-gray-700 border-gray-200',
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

async function getCurrentSubscription(accessToken: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/subscriptions/current`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.subscription;
}

// ============================================
// 主组件
// ============================================

export function PricingModal() {
  const router = useRouter();
  const { isOpen, triggerReason, quotaType, currentTier, onSuccess, closePricingModal } = usePricingModalStore();
  const [activeTab, setActiveTab] = useState<'upgrade' | 'topup'>('upgrade');
  const [subscribingPlan, setSubscribingPlan] = useState<string | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string>(currentTier || 'free');

  // 从 API 获取订阅计划 - 只在弹窗打开时才请求
  const { plans: apiPlans, loading: plansLoading, error: plansError } = useSubscriptionPlans(isOpen);
  const displayPlans = transformPlansToDisplayPlans(apiPlans, getPlanIcon, true);

  useEffect(() => {
    if (isOpen) {
      getSessionSafe().then(async session => {
        if (session) {
          setAccessToken(session.access_token);
          // 获取当前订阅状态
          try {
            const subscription = await getCurrentSubscription(session.access_token);
            if (subscription?.plan?.slug) {
              setCurrentPlan(subscription.plan.slug);
            }
          } catch (e) {
            console.error('获取订阅信息失败:', e);
          }
        }
      });
    }
  }, [isOpen]);

  // 使用传入的 currentTier
  useEffect(() => {
    if (currentTier) {
      setCurrentPlan(currentTier);
    }
  }, [currentTier]);

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
      router.push('/login?redirect=/p');
      closePricingModal();
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
        toast.success('🎉 订阅成功！');
        setCurrentPlan(planSlug);
        // 调用成功回调，刷新积分等状态
        if (onSuccess) {
          onSuccess();
        }
        closePricingModal();
        
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
        onClick={closePricingModal}
      />
      
      {/* 模态框 */}
      <div className="relative bg-white border border-gray-200 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-auto mx-4 shadow-xl">
        {/* 关闭按钮 */}
        <button
          onClick={closePricingModal}
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
              <p className="text-gray-600 mb-2">{getQuotaMessage()}</p>
            )}
            <p className="text-gray-500">
              选择适合您的计划，解锁更多强大功能
            </p>
          </div>

          {/* Tab 切换 */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <button
              onClick={() => setActiveTab('upgrade')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'upgrade'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              🚀 Upgrade
            </button>
            <button
              onClick={() => setActiveTab('topup')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'topup'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              💎 Top-up Credits
            </button>
          </div>

          {activeTab === 'upgrade' && (
            <>
              {/* 计划列表 - 动态显示 */}
              {plansLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                  <span className="ml-2 text-gray-500">加载中...</span>
                </div>
              ) : plansError ? (
                <div className="text-center py-20 text-red-500">
                  加载计划失败，请刷新重试
                </div>
              ) : (
                <div className={`grid gap-4 grid-cols-1 ${
                  displayPlans.length >= 5 ? 'lg:grid-cols-5 md:grid-cols-3' :
                  displayPlans.length === 4 ? 'lg:grid-cols-4 md:grid-cols-2' :
                  displayPlans.length === 3 ? 'lg:grid-cols-3 md:grid-cols-2' :
                  displayPlans.length === 2 ? 'lg:grid-cols-2 md:grid-cols-2' :
                  'max-w-md mx-auto'
                }`}>
                  {displayPlans.map((plan) => {
                    const price = plan.priceMonthly;
                    const isCurrent = currentPlan === plan.slug;
                    const isLoading = isSubscribing && subscribingPlan === plan.slug;

                    return (
                      <div
                        key={plan.slug}
                        className={`relative bg-white rounded-xl flex flex-col
                                    border transition-all duration-300 shadow-sm ${
                                      plan.isPopular
                                        ? 'border-gray-400 shadow-gray-100'
                                        : plan.isSpecial
                                        ? 'border-gray-300'
                                        : isCurrent
                                        ? 'border-gray-400'
                                        : 'border-gray-200 hover:border-gray-300'
                                    }`}
                      >
                        {/* 热门标签 */}
                        {plan.isPopular && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                            <span className="px-2 py-1 bg-gray-800 
                                           text-white text-[10px] font-bold rounded-full whitespace-nowrap">
                              ◆ MOST POPULAR
                            </span>
                          </div>
                        )}
                        
                        {/* 特殊标签 */}
                        {plan.isSpecial && plan.specialLabel && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                            <span className="px-2 py-1 bg-gray-700 
                                           text-white text-[9px] font-bold rounded-full whitespace-nowrap">
                              {plan.specialLabel}
                            </span>
                          </div>
                        )}

                        {/* 当前计划标签 */}
                        {isCurrent && !plan.isPopular && !plan.isSpecial && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                            <span className="px-2 py-1 bg-gray-700 text-white text-[10px] font-bold rounded-full">
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
                              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[9px] font-bold rounded">
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
                                ? 'bg-gray-800 text-white hover:bg-gray-700'
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
                            <Sparkles className="w-3.5 h-3.5 text-gray-500" />
                            <span className="text-gray-600 font-bold text-xs">
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
                                  <Check className="w-3 h-3 flex-shrink-0 text-gray-500 mt-0.5" />
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
                                  <Check className="w-3 h-3 flex-shrink-0 text-gray-500 mt-0.5" />
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
            </>
          )}

          {activeTab === 'topup' && (
            <div className="max-w-2xl mx-auto">
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4 text-center">
                  购买额外积分
                </h3>
                
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { credits: 100, price: 5, bonus: 0 },
                    { credits: 500, price: 20, bonus: 50 },
                    { credits: 1000, price: 35, bonus: 150 },
                    { credits: 5000, price: 150, bonus: 1000 },
                  ].map((pack) => (
                    <button
                      key={pack.credits}
                      onClick={async () => {
                        if (!accessToken) {
                          router.push('/login?redirect=/settings?tab=billing');
                          closePricingModal();
                          return;
                        }
                        
                        setIsSubscribing(true);
                        try {
                          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/subscriptions/topup`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${accessToken}`,
                            },
                            body: JSON.stringify({
                              credits_amount: pack.credits,
                              dev_mode: true,  // 开发模式直接发放
                            }),
                          });
                          
                          const result = await response.json();
                          
                          if (result.success) {
                            if (result.mode === 'stripe' && result.checkout_url) {
                              // 跳转到 Stripe 支付页面
                              window.location.href = result.checkout_url;
                            } else {
                              // 开发模式直接成功
                              toast.success(`🎉 充值成功！获得 ${result.total_credits} 积分`);
                              if (onSuccess) onSuccess();
                              closePricingModal();
                              window.location.reload();
                            }
                          } else {
                            toast.error(result.detail || '充值失败');
                          }
                        } catch (error) {
                          console.error('充值失败:', error);
                          toast.error('充值失败，请稍后重试');
                        } finally {
                          setIsSubscribing(false);
                        }
                      }}
                      disabled={isSubscribing}
                      className="p-4 bg-white rounded-xl border border-gray-200 hover:border-gray-400 hover:shadow-md transition-all text-left disabled:opacity-50"
                    >
                      <div className="text-xl font-bold text-gray-800">
                        {pack.credits.toLocaleString()}
                        {pack.bonus > 0 && (
                          <span className="text-gray-500 text-sm ml-2">
                            +{pack.bonus} bonus
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">积分</div>
                      <div className="mt-2 text-lg font-bold text-gray-600">
                        ${pack.price}
                      </div>
                    </button>
                  ))}
                </div>
                
                <p className="text-center text-xs text-gray-500 mt-4">
                  积分永不过期 · 可用于所有 AI 功能
                </p>
              </div>
            </div>
          )}

          {/* 底部说明 */}
          <div className="mt-6 text-center text-sm text-gray-400">
            <p>所有计划均支持 7 天无理由退款</p>
            <p className="mt-1">
              如有任何问题，请联系 support@lepus.ai
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PricingModal;
