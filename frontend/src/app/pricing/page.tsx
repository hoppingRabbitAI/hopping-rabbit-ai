'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, 
  Check, 
  X,
  Zap, 
  Crown, 
  Gem,
  Rocket,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { getSessionSafe } from '@/lib/supabase/session';

// ============================================
// 类型定义
// ============================================

interface PlanFeature {
  text: string;
  included: boolean;
  badge?: string;
  badgeColor?: 'green' | 'yellow' | 'pink';
}

interface UnlimitedFeature {
  name: string;
  badge?: string;
  badgeColor?: 'green' | 'yellow' | 'pink';
  included: boolean;
}

interface PricingPlan {
  name: string;
  slug: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  originalMonthly?: number;
  creditsPerMonth: number;
  bonusText?: string;
  icon: React.ReactNode;
  features: PlanFeature[];
  unlimitedAccess: UnlimitedFeature[];
  isPopular?: boolean;
  isSpecial?: boolean;
  specialLabel?: string;
  ctaText: string;
  ctaVariant: 'primary' | 'secondary' | 'outline' | 'pink';
  savingsYearly?: number;
}

// ============================================
// 计划数据 (参考 Nano Banana Pro 结构)
// ============================================

const PLANS: PricingPlan[] = [
  {
    name: 'Basic',
    slug: 'basic',
    description: '适合初次体验 AI 视频创作',
    priceMonthly: 9,
    priceYearly: 108,
    creditsPerMonth: 150,
    icon: <Zap className="w-6 h-6 text-gray-400" />,
    features: [
      { text: '访问基础模型', included: true },
      { text: '同时处理: 2 视频, 2 图像', included: true },
      { text: 'AI 智能剪辑', included: true, badge: '8 FREE', badgeColor: 'green' },
      { text: '访问全部功能', included: false },
      { text: '优先使用高级 AI 功能', included: false },
      { text: '额外积分折扣', included: false },
    ],
    unlimitedAccess: [
      { name: '无限图像生成', included: false },
      { name: 'AI 智能剪辑', included: false },
      { name: 'Kling 2.6', included: false },
      { name: 'Kling 口型同步', included: false },
      { name: 'Kling 运动控制', included: false },
    ],
    ctaText: '选择 Basic',
    ctaVariant: 'outline',
  },
  {
    name: 'Pro',
    slug: 'pro',
    description: '适合日常内容创作者',
    priceMonthly: 29,
    priceYearly: 208.8,
    originalMonthly: 29,
    creditsPerMonth: 600,
    bonusText: '= 300 Kling 标准',
    savingsYearly: 139,
    icon: <Crown className="w-6 h-6 text-amber-400" />,
    features: [
      { text: '访问全部模型', included: true },
      { text: '同时处理: 3 视频, 4 图像, 2 角色', included: true },
      { text: 'AI 智能剪辑', included: true, badge: '13 FREE', badgeColor: 'green' },
      { text: '访问全部功能', included: true },
      { text: '优先使用高级 AI 功能', included: false },
      { text: '额外积分折扣', included: false },
    ],
    unlimitedAccess: [
      { name: '图像生成', included: true, badge: '365 UNLIMITED', badgeColor: 'green' },
      { name: 'AI 智能剪辑', included: true, badge: '365 UNLIMITED', badgeColor: 'green' },
      { name: 'Kling 2.6', included: false },
      { name: 'Kling 口型同步', included: false },
      { name: 'Kling 运动控制', included: false },
    ],
    ctaText: '选择 Pro',
    ctaVariant: 'outline',
  },
  {
    name: 'Ultimate',
    slug: 'ultimate',
    description: '专业创作者的明智之选',
    priceMonthly: 49,
    priceYearly: 294,
    originalMonthly: 49,
    creditsPerMonth: 1200,
    bonusText: '+ 365 UNLIMITED AI 智能剪辑',
    savingsYearly: 294,
    icon: <Gem className="w-6 h-6 text-pink-400" />,
    isPopular: true,
    features: [
      { text: '访问全部模型', included: true },
      { text: '同时处理: 4 视频, 8 图像, 3 角色', included: true },
      { text: 'AI 智能剪辑', included: true, badge: '35 FREE', badgeColor: 'green' },
      { text: '访问全部功能', included: true },
      { text: '优先使用高级 AI 功能', included: true },
      { text: '额外积分折扣', included: true },
    ],
    unlimitedAccess: [
      { name: '图像生成', included: true, badge: '365 UNLIMITED', badgeColor: 'green' },
      { name: 'AI 智能剪辑', included: true, badge: '365 UNLIMITED', badgeColor: 'green' },
      { name: 'Kling 2.6', included: true, badge: 'UNLIMITED', badgeColor: 'yellow' },
      { name: 'Kling 口型同步', included: true, badge: 'UNLIMITED', badgeColor: 'yellow' },
      { name: 'Kling 运动控制', included: true, badge: 'UNLIMITED', badgeColor: 'yellow' },
    ],
    ctaText: '选择 Ultimate',
    ctaVariant: 'pink',
  },
  {
    name: 'Creator',
    slug: 'creator',
    description: '专家级大规模生产',
    priceMonthly: 249,
    priceYearly: 448.8,
    originalMonthly: 249,
    creditsPerMonth: 6000,
    bonusText: '+ 2 Year UNLIMITED AI 智能剪辑',
    savingsYearly: 2702,
    icon: <Rocket className="w-6 h-6 text-pink-400" />,
    isSpecial: true,
    specialLabel: '⭐ 2 YEAR PERSONAL ONE TIME OFFER',
    features: [
      { text: '访问全部模型', included: true },
      { text: '同时处理: 8 视频, 8 图像, 6 角色', included: true },
      { text: 'AI 智能剪辑', included: true, badge: '35 FREE', badgeColor: 'green' },
      { text: '访问全部功能', included: true },
      { text: '优先使用高级 AI 功能', included: true },
      { text: '15% 额外积分折扣', included: true, badge: 'EXTRA', badgeColor: 'yellow' },
      { text: '额外 Unlimited 模型', included: true, badge: 'SPECIAL', badgeColor: 'pink' },
    ],
    unlimitedAccess: [
      { name: '图像生成', included: true, badge: '2 YEAR UNLIMITED', badgeColor: 'pink' },
      { name: 'AI 智能剪辑', included: true, badge: '2 YEAR UNLIMITED', badgeColor: 'pink' },
      { name: 'Kling 2.6', included: true, badge: 'UNLIMITED', badgeColor: 'yellow' },
      { name: 'Kling 口型同步', included: true, badge: 'UNLIMITED', badgeColor: 'yellow' },
      { name: 'Kling 运动控制', included: true, badge: 'UNLIMITED', badgeColor: 'yellow' },
    ],
    ctaText: '选择 Creator',
    ctaVariant: 'pink',
  },
];

// ============================================
// Badge 组件
// ============================================

function Badge({ text, color = 'green' }: { text: string; color?: 'green' | 'yellow' | 'pink' }) {
  const colorClasses = {
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
    yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  };
  
  return (
    <span className={`ml-2 px-1.5 py-0.5 text-[10px] font-medium rounded border ${colorClasses[color]}`}>
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
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/subscriptions/subscribe`, {
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
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/subscriptions/current`, {
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
// 定价卡片组件
// ============================================

interface PricingCardProps {
  plan: PricingPlan;
  isYearly: boolean;
  currentPlan?: string;
  onSubscribe: (planSlug: string) => Promise<void>;
  isSubscribing: boolean;
  subscribingPlan: string | null;
}

function PricingCard({ plan, isYearly, currentPlan, onSubscribe, isSubscribing, subscribingPlan }: PricingCardProps) {
  const price = isYearly ? plan.priceYearly / 12 : plan.priceMonthly;
  const isCurrent = currentPlan === plan.slug;
  const isLoading = isSubscribing && subscribingPlan === plan.slug;

  return (
    <div
      className={`relative bg-[#121214] rounded-2xl flex flex-col h-full
                  border transition-all duration-300 ${
                    plan.isPopular
                      ? 'border-pink-500/50 shadow-lg shadow-pink-500/10'
                      : plan.isSpecial
                      ? 'border-pink-500/30 bg-gradient-to-b from-pink-500/5 to-transparent'
                      : 'border-gray-800 hover:border-gray-700'
                  }`}
    >
      {/* 热门标签 */}
      {plan.isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 bg-gradient-to-r from-pink-500 to-rose-500 
                         text-white text-xs font-bold rounded-full whitespace-nowrap">
            ◆ MOST POPULAR
          </span>
        </div>
      )}
      
      {/* 特殊标签 */}
      {plan.isSpecial && plan.specialLabel && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 bg-gradient-to-r from-pink-500 to-rose-500 
                         text-white text-[10px] font-bold rounded-full whitespace-nowrap">
            {plan.specialLabel}
          </span>
        </div>
      )}

      {/* 头部 */}
      <div className="p-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-xl font-bold text-gray-200">{plan.name}</h3>
          {plan.isSpecial && (
            <span className="px-2 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] font-bold rounded">
              85% OFF
            </span>
          )}
          {plan.isPopular && (
            <span className="px-2 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] font-bold rounded">
              85% OFF
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">{plan.description}</p>
      </div>

      {/* 价格 */}
      <div className="px-6 pb-4">
        <div className="flex items-baseline gap-1">
          {plan.originalMonthly && isYearly && (
            <span className="text-lg text-gray-500 line-through">
              ${plan.originalMonthly}
            </span>
          )}
          <span className="text-3xl font-bold text-gray-100">
            ${price.toFixed(1)}
          </span>
          <span className="text-gray-500 text-sm">/mo</span>
        </div>
        {isYearly && (
          <p className="text-xs text-gray-500 mt-1">按 12 个月计费</p>
        )}
      </div>

      {/* CTA 按钮 */}
      <div className="px-6 pb-4">
        <button
          onClick={() => !isCurrent && !isLoading && onSubscribe(plan.slug)}
          disabled={isCurrent || isLoading || isSubscribing}
          className={`w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
            plan.ctaVariant === 'pink'
              ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90'
              : plan.ctaVariant === 'primary'
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90'
              : plan.ctaVariant === 'secondary'
              ? 'bg-white text-black hover:bg-gray-100'
              : 'bg-white text-black hover:bg-gray-100'
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
        
        {/* 节省金额 */}
        {plan.savingsYearly && isYearly && (
          <div className="mt-2 text-center">
            <span className="inline-flex items-center px-2 py-1 bg-yellow-500/20 text-yellow-400 text-[10px] font-medium rounded">
              💰 Save ${plan.savingsYearly} compared to monthly
            </span>
          </div>
        )}
      </div>

      {/* 积分信息 */}
      <div className="px-6 pb-4 border-t border-gray-800 pt-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-yellow-400" />
          <span className="text-pink-400 font-bold text-sm">
            {plan.creditsPerMonth.toLocaleString()} credits per month
          </span>
        </div>
        {plan.bonusText && (
          <p className="text-[11px] text-gray-500 mt-1 ml-6">{plan.bonusText}</p>
        )}
      </div>

      {/* 功能列表 */}
      <div className="px-6 pb-4 flex-1">
        <ul className="space-y-2">
          {plan.features.map((feature, index) => (
            <li
              key={index}
              className={`flex items-center gap-2 text-xs ${
                feature.included ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              {feature.included ? (
                <Check className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
              ) : (
                <X className="w-3.5 h-3.5 flex-shrink-0 text-gray-600" />
              )}
              <span>{feature.text}</span>
              {feature.badge && (
                <Badge text={feature.badge} color={feature.badgeColor} />
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* UNLIMITED ACCESS */}
      <div className="px-6 pb-6 border-t border-gray-800 pt-4">
        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
          UNLIMITED ACCESS
        </h4>
        <ul className="space-y-2">
          {plan.unlimitedAccess.map((item, index) => (
            <li
              key={index}
              className={`flex items-center gap-2 text-xs ${
                item.included ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              {item.included ? (
                <Check className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
              ) : (
                <X className="w-3.5 h-3.5 flex-shrink-0 text-gray-600" />
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
}

// ============================================
// 主页面
// ============================================

export default function PricingPage() {
  const router = useRouter();
  const [isYearly, setIsYearly] = useState(true);
  const [activeTab, setActiveTab] = useState<'upgrade' | 'topup'>('upgrade');
  const [currentPlan, setCurrentPlan] = useState<string>('free');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [subscribingPlan, setSubscribingPlan] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 获取当前订阅状态
  useEffect(() => {
    async function loadSubscription() {
      const session = await getSessionSafe();
      if (!session) {
        return;
      }
      
      setAccessToken(session.access_token);
      
      try {
        const subscription = await getCurrentSubscription(session.access_token);
        if (subscription?.plan?.slug) {
          setCurrentPlan(subscription.plan.slug);
        }
      } catch (e) {
        console.error('获取订阅信息失败:', e);
      }
    }
    
    loadSubscription();
  }, []);

  // 订阅处理
  const handleSubscribe = async (planSlug: string) => {
    // 检查登录
    if (!accessToken) {
      router.push('/login?redirect=/pricing');
      return;
    }

    setIsSubscribing(true);
    setSubscribingPlan(planSlug);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await subscribeToplan(
        planSlug,
        isYearly ? 'yearly' : 'monthly',
        accessToken
      );

      if (result.success) {
        setCurrentPlan(planSlug);
        setSuccessMessage(`🎉 ${result.message}`);
        
        // 3秒后跳转到 workspace
        setTimeout(() => {
          router.push('/workspace?subscription=success');
        }, 2000);
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '订阅失败，请重试');
    } finally {
      setIsSubscribing(false);
      setSubscribingPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* 顶部导航 */}
      <header className="border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/workspace"
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-400" />
            </Link>
            <h1 className="text-xl font-semibold text-gray-200">定价方案</h1>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto px-4 py-12">
        {/* 标题区 */}
        <div className="text-center mb-8">
          <h2 className="text-3xl md:text-4xl font-black text-gray-100 mb-4 tracking-tight">
            UPGRADE PLAN OR BUY CREDITS
          </h2>
          <p className="text-gray-400">
            Choose a higher plan for increased limits, or add extra credits
          </p>
        </div>

        {/* 成功/错误消息 */}
        {successMessage && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
            <p className="text-green-400 font-medium flex items-center justify-center gap-2">
              <Check className="w-5 h-5" />
              {successMessage}
            </p>
          </div>
        )}
        {errorMessage && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
            <p className="text-red-400 font-medium flex items-center justify-center gap-2">
              <X className="w-5 h-5" />
              {errorMessage}
            </p>
            <button
              onClick={() => setErrorMessage(null)}
              className="mt-2 text-sm text-gray-400 hover:text-gray-300"
            >
              关闭
            </button>
          </div>
        )}

        {/* Tab 切换 */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <button
            onClick={() => setActiveTab('upgrade')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'upgrade'
                ? 'bg-white text-black'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            🚀 Upgrade
          </button>
          <button
            onClick={() => setActiveTab('topup')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'topup'
                ? 'bg-white text-black'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            💎 Top-up Credits
          </button>
        </div>

        {activeTab === 'upgrade' && (
          <>
            {/* 月付/年付切换 */}
            <div className="flex items-center justify-center gap-3 mb-10">
              <span className={`text-sm ${!isYearly ? 'text-gray-200' : 'text-gray-500'}`}>
                Monthly
              </span>
              <button
                onClick={() => setIsYearly(!isYearly)}
                className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${
                  isYearly ? 'bg-green-500' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                    isYearly ? 'translate-x-8' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className={`text-sm ${isYearly ? 'text-gray-200' : 'text-gray-500'}`}>
                Annual
              </span>
              {isYearly && (
                <span className="px-2 py-1 bg-pink-500 text-white text-xs font-bold rounded-full">
                  85% OFF
                </span>
              )}
            </div>

            {/* 定价卡片 - 4列 */}
            <div className="grid lg:grid-cols-4 md:grid-cols-2 gap-6 mb-16">
              {PLANS.map((plan) => (
                <PricingCard
                  key={plan.slug}
                  plan={plan}
                  isYearly={isYearly}
                  currentPlan={currentPlan}
                  onSubscribe={handleSubscribe}
                  isSubscribing={isSubscribing}
                  subscribingPlan={subscribingPlan}
                />
              ))}
            </div>
          </>
        )}

        {activeTab === 'topup' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-[#121214] rounded-2xl border border-gray-800 p-8">
              <h3 className="text-xl font-bold text-gray-200 mb-6 text-center">
                购买额外积分
              </h3>
              
              <div className="grid grid-cols-2 gap-4">
                {[
                  { credits: 100, price: 5, bonus: 0 },
                  { credits: 500, price: 20, bonus: 50 },
                  { credits: 1000, price: 35, bonus: 150 },
                  { credits: 5000, price: 150, bonus: 1000 },
                ].map((pack) => (
                  <button
                    key={pack.credits}
                    className="p-4 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-pink-500/50 transition-all text-left"
                  >
                    <div className="text-2xl font-bold text-gray-200">
                      {pack.credits.toLocaleString()}
                      {pack.bonus > 0 && (
                        <span className="text-pink-400 text-sm ml-2">
                          +{pack.bonus} bonus
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-400">积分</div>
                    <div className="mt-2 text-lg font-bold text-pink-400">
                      ${pack.price}
                    </div>
                  </button>
                ))}
              </div>
              
              <p className="text-center text-xs text-gray-500 mt-6">
                积分永不过期 · 可用于所有 AI 功能
              </p>
            </div>
          </div>
        )}

        {/* FAQ 入口 */}
        <div className="text-center mt-12 pt-8 border-t border-gray-800">
          <p className="text-gray-500">
            有疑问？查看我们的{' '}
            <Link href="/faq" className="text-pink-400 hover:underline">
              常见问题
            </Link>{' '}
            或{' '}
            <Link href="mailto:support@hoppingrabbit.ai" className="text-pink-400 hover:underline">
              联系我们
            </Link>
          </p>
        </div>
      </main>

      {/* 底部 */}
      <footer className="border-t border-gray-800 py-6">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>支付由 Stripe 安全处理 · 支持信用卡、借记卡</p>
          <p className="mt-2">
            © {new Date().getFullYear()} HoppingRabbit AI. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
