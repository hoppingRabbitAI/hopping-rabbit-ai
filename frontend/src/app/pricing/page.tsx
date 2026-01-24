'use client';

import { useState } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Check, 
  Zap, 
  Crown, 
  Building2,
  Sparkles,
  HardDrive,
  FolderOpen,
  Palette,
  Headphones,
  Code,
  Infinity
} from 'lucide-react';

// ============================================
// 类型定义
// ============================================

interface PlanFeature {
  text: string;
  included: boolean;
  highlight?: boolean;
}

interface PricingPlan {
  name: string;
  slug: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  icon: React.ReactNode;
  features: PlanFeature[];
  isPopular?: boolean;
  ctaText: string;
  ctaVariant: 'primary' | 'secondary' | 'outline';
}

// ============================================
// 计划数据
// ============================================

const PLANS: PricingPlan[] = [
  {
    name: '免费版',
    slug: 'free',
    description: '适合个人用户体验 AI 视频剪辑',
    priceMonthly: 0,
    priceYearly: 0,
    icon: <Zap className="w-6 h-6 text-gray-400" />,
    features: [
      { text: '6 次免费 AI 试用', included: true, highlight: true },
      { text: '每日 10 次 AI 任务', included: true },
      { text: '500 MB 存储空间', included: true },
      { text: '最多 3 个项目', included: true },
      { text: '带水印导出', included: true },
      { text: '社区支持', included: true },
      { text: '无水印导出', included: false },
      { text: '优先客服支持', included: false },
      { text: 'API 访问', included: false },
    ],
    ctaText: '当前计划',
    ctaVariant: 'outline',
  },
  {
    name: 'Pro',
    slug: 'pro',
    description: '适合创作者和小团队',
    priceMonthly: 19.99,
    priceYearly: 199.99,
    icon: <Crown className="w-6 h-6 text-amber-400" />,
    isPopular: true,
    features: [
      { text: '无限免费试用', included: true, highlight: true },
      { text: '每日 100 次 AI 任务', included: true, highlight: true },
      { text: '10 GB 存储空间', included: true },
      { text: '最多 20 个项目', included: true },
      { text: '无水印导出', included: true, highlight: true },
      { text: '优先客服支持', included: true },
      { text: '高级 AI 模型', included: true },
      { text: 'API 访问', included: false },
      { text: '自定义品牌', included: false },
    ],
    ctaText: '升级 Pro',
    ctaVariant: 'primary',
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: '适合企业和专业团队',
    priceMonthly: 49.99,
    priceYearly: 499.99,
    icon: <Building2 className="w-6 h-6 text-purple-400" />,
    features: [
      { text: '无限免费试用', included: true, highlight: true },
      { text: '无限 AI 任务', included: true, highlight: true },
      { text: '100 GB 存储空间', included: true },
      { text: '无限项目', included: true },
      { text: '无水印导出', included: true },
      { text: '24/7 专属客服', included: true, highlight: true },
      { text: '高级 AI 模型', included: true },
      { text: 'API 访问', included: true },
      { text: '自定义品牌', included: true },
    ],
    ctaText: '联系销售',
    ctaVariant: 'secondary',
  },
];

// ============================================
// 特性亮点
// ============================================

const HIGHLIGHTS = [
  {
    icon: <Sparkles className="w-5 h-5" />,
    title: 'AI 智能剪辑',
    description: '一键去除口误、填充词，智能优化视频节奏',
  },
  {
    icon: <HardDrive className="w-5 h-5" />,
    title: '云端存储',
    description: '安全可靠的云存储，随时随地访问您的项目',
  },
  {
    icon: <Palette className="w-5 h-5" />,
    title: '专业导出',
    description: '支持多种分辨率和格式，满足不同平台需求',
  },
  {
    icon: <Headphones className="w-5 h-5" />,
    title: '技术支持',
    description: '专业团队随时待命，解答您的任何问题',
  },
];

// ============================================
// 定价卡片组件
// ============================================

interface PricingCardProps {
  plan: PricingPlan;
  isYearly: boolean;
  currentPlan?: string;
}

function PricingCard({ plan, isYearly, currentPlan }: PricingCardProps) {
  const price = isYearly ? plan.priceYearly : plan.priceMonthly;
  const isCurrent = currentPlan === plan.slug;

  return (
    <div
      className={`relative bg-[#121214] rounded-2xl p-6 flex flex-col h-full
                  border transition-all duration-300 ${
                    plan.isPopular
                      ? 'border-amber-500/50 shadow-lg shadow-amber-500/10'
                      : 'border-gray-800 hover:border-gray-700'
                  }`}
    >
      {/* 热门标签 */}
      {plan.isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 
                         text-white text-xs font-medium rounded-full">
            最受欢迎
          </span>
        </div>
      )}

      {/* 头部 */}
      <div className="text-center mb-6">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-800 
                        flex items-center justify-center">
          {plan.icon}
        </div>
        <h3 className="text-xl font-semibold text-gray-200">{plan.name}</h3>
        <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
      </div>

      {/* 价格 */}
      <div className="text-center mb-6">
        {price === 0 ? (
          <div className="text-4xl font-bold text-gray-200">免费</div>
        ) : (
          <>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-2xl text-gray-400">$</span>
              <span className="text-4xl font-bold text-gray-200">
                {isYearly ? (price / 12).toFixed(2) : price.toFixed(2)}
              </span>
              <span className="text-gray-500">/月</span>
            </div>
            {isYearly && (
              <p className="text-sm text-green-400 mt-1">
                年付 ${price.toFixed(2)}，省 ${((plan.priceMonthly * 12) - price).toFixed(2)}
              </p>
            )}
          </>
        )}
      </div>

      {/* 功能列表 */}
      <ul className="space-y-3 flex-1 mb-6">
        {plan.features.map((feature, index) => (
          <li
            key={index}
            className={`flex items-start gap-2 text-sm ${
              feature.included ? 'text-gray-300' : 'text-gray-600'
            }`}
          >
            {feature.included ? (
              <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                feature.highlight ? 'text-green-400' : 'text-gray-500'
              }`} />
            ) : (
              <span className="w-4 h-4 flex-shrink-0" />
            )}
            <span className={feature.highlight ? 'font-medium' : ''}>
              {feature.text}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA 按钮 */}
      <button
        disabled={isCurrent}
        className={`w-full py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
          plan.ctaVariant === 'primary'
            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90'
            : plan.ctaVariant === 'secondary'
            ? 'bg-purple-500 text-white hover:bg-purple-600'
            : 'border border-gray-700 text-gray-300 hover:bg-gray-800'
        } ${isCurrent ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isCurrent ? '当前计划' : plan.ctaText}
      </button>
    </div>
  );
}

// ============================================
// 主页面
// ============================================

export default function PricingPage() {
  const [isYearly, setIsYearly] = useState(true);
  const currentPlan = 'free'; // TODO: 从用户状态获取

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* 顶部导航 */}
      <header className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-4">
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
      <main className="max-w-6xl mx-auto px-4 py-12">
        {/* 标题区 */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-100 mb-4">
            选择适合您的方案
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            从免费版开始体验，随时升级解锁更多 AI 能力和专业功能
          </p>
        </div>

        {/* 月付/年付切换 */}
        <div className="flex items-center justify-center gap-4 mb-10">
          <span className={`text-sm ${!isYearly ? 'text-gray-200' : 'text-gray-500'}`}>
            月付
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
            年付
            <span className="ml-1 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
              省 17%
            </span>
          </span>
        </div>

        {/* 定价卡片 */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {PLANS.map((plan) => (
            <PricingCard
              key={plan.slug}
              plan={plan}
              isYearly={isYearly}
              currentPlan={currentPlan}
            />
          ))}
        </div>

        {/* 特性亮点 */}
        <div className="border-t border-gray-800 pt-12">
          <h3 className="text-xl font-semibold text-gray-200 text-center mb-8">
            所有方案均包含
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {HIGHLIGHTS.map((highlight, index) => (
              <div
                key={index}
                className="p-4 bg-[#121214] rounded-xl border border-gray-800"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center 
                                text-gray-400 mb-3">
                  {highlight.icon}
                </div>
                <h4 className="text-gray-200 font-medium mb-1">{highlight.title}</h4>
                <p className="text-sm text-gray-500">{highlight.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ 入口 */}
        <div className="text-center mt-12 pt-8 border-t border-gray-800">
          <p className="text-gray-500">
            有疑问？查看我们的{' '}
            <Link href="/faq" className="text-blue-400 hover:underline">
              常见问题
            </Link>{' '}
            或{' '}
            <Link href="mailto:support@hoppingrabbit.ai" className="text-blue-400 hover:underline">
              联系我们
            </Link>
          </p>
        </div>
      </main>

      {/* 底部 */}
      <footer className="border-t border-gray-800 py-6">
        <div className="max-w-6xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>支付由 Stripe 安全处理 · 支持信用卡、借记卡</p>
          <p className="mt-2">
            © {new Date().getFullYear()} HoppingRabbit AI. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
