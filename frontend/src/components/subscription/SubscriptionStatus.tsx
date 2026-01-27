'use client';

import { useState, useEffect } from 'react';
import { 
  Zap,
  Gem,
  HardDrive,
  FolderOpen,
  Video,
  Image,
  Users,
  Sparkles,
  ChevronRight,
  RefreshCw,
  Check,
  Crown,
  Rocket,
  Settings,
  AlertCircle
} from 'lucide-react';
import { getSessionSafe } from '@/lib/supabase';
import { SubscriptionManagement } from './SubscriptionManagement';
import { useCreditsStore } from '@/lib/stores/credits-store';

// ============================================
// 类型定义
// ============================================

interface PlanFeatures {
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

interface SubscriptionPlan {
  id: string;
  slug: string;
  name: string;
  description: string;
  price_monthly: number;
  credits_per_month: number;
  bonus_credits: number;
  features: PlanFeatures;
}

interface UserSubscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  billing_cycle: string;
  current_period_start: string;
  current_period_end: string;
  auto_renew: boolean;
  canceled_at?: string;
  plan: SubscriptionPlan;
  is_free?: boolean;
}

interface SubscriptionStatusProps {
  onUpgradeClick?: () => void;
  compact?: boolean;
  className?: string;
  showManagement?: boolean;  // 是否显示管理按钮
  refreshTrigger?: number;   // 外部刷新触发器，变化时重新获取数据
}

// ============================================
// 工具函数
// ============================================

function formatStorage(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  }
  return `${mb} MB`;
}

function getTierIcon(slug: string) {
  switch (slug) {
    case 'creator':
      return <Rocket className="w-4 h-4 text-pink-500" />;
    case 'ultimate':
      return <Gem className="w-4 h-4 text-purple-500" />;
    case 'pro':
      return <Crown className="w-4 h-4 text-amber-500" />;
    case 'basic':
      return <Zap className="w-4 h-4 text-blue-500" />;
    default:
      return <Sparkles className="w-4 h-4 text-gray-500" />;
  }
}

function getTierBadgeStyle(slug: string): string {
  switch (slug) {
    case 'creator':
      return 'bg-gradient-to-r from-pink-500 to-rose-500 text-white';
    case 'ultimate':
      return 'bg-gradient-to-r from-purple-500 to-pink-500 text-white';
    case 'pro':
      return 'bg-gradient-to-r from-amber-500 to-orange-500 text-white';
    case 'basic':
      return 'bg-blue-500 text-white';
    default:
      return 'bg-gray-200 text-gray-700';
  }
}

// ============================================
// 进度条组件 (白灰风格)
// ============================================

interface ProgressBarProps {
  used: number;
  total: number;
  colorClass?: string;
}

function ProgressBar({ used, total, colorClass = 'bg-blue-500' }: ProgressBarProps) {
  if (total === -1) {
    return (
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-green-500 w-1/4" />
      </div>
    );
  }

  const percentage = Math.min((used / total) * 100, 100);
  const isWarning = percentage >= 80;
  const isDanger = percentage >= 95;

  let barColor = colorClass;
  if (isDanger) barColor = 'bg-red-500';
  else if (isWarning) barColor = 'bg-amber-500';

  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full transition-all duration-300 ${barColor}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

// ============================================
// 配额项组件 (白灰风格)
// ============================================

interface QuotaItemProps {
  icon: React.ReactNode;
  label: string;
  used: number;
  total: number;
  format?: (value: number) => string;
  colorClass?: string;
}

function QuotaItem({ icon, label, used, total, format, colorClass }: QuotaItemProps) {
  const displayUsed = format ? format(used) : used.toString();
  const displayTotal = total === -1 ? '无限' : (format ? format(total) : total.toString());

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-600">
          {icon}
          <span className="text-sm">{label}</span>
        </div>
        <span className="text-sm text-gray-700">
          {displayUsed} / {displayTotal}
        </span>
      </div>
      <ProgressBar used={used} total={total} colorClass={colorClass} />
    </div>
  );
}

// ============================================
// 主组件 (白灰风格，与 workspace 统一)
// ============================================

export function SubscriptionStatus({ onUpgradeClick, compact = false, className = '', showManagement = false, refreshTrigger = 0 }: SubscriptionStatusProps) {
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; code?: string; action?: string } | null>(null);
  const [showManagementModal, setShowManagementModal] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  
  // 使用全局积分 store - 用于跨组件同步和独立刷新
  const { credits, setCredits } = useCreditsStore();

  const fetchSubscription = async () => {
    try {
      setLoading(true);
      setError(null);

      const session = await getSessionSafe();
      if (!session) {
        setError({ 
          message: '请先登录查看订阅信息',
          code: 'NOT_LOGGED_IN'
        });
        return;
      }
      
      setAccessToken(session.access_token);

      // 只调用一个接口，同时获取订阅信息和积分信息
      const response = await fetch('/api/subscriptions/current', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
          message: errorData.detail?.message || `请求失败: ${response.status}`,
          code: errorData.detail?.code,
          action: errorData.detail?.action
        };
      }

      const data = await response.json();
      const sub = data.subscription;
      
      if (!sub) {
        throw { message: 'API 返回数据缺少 subscription 字段', code: 'INVALID_RESPONSE' };
      }
      if (!sub.plan) {
        throw { message: 'API 返回数据缺少 plan 字段', code: 'INVALID_RESPONSE' };
      }
      if (!sub.plan.features) {
        throw { message: 'API 返回数据缺少 features 字段', code: 'INVALID_RESPONSE' };
      }
      
      setSubscription(sub);
      
      // 从同一接口更新积分 store (如果 API 返回了积分信息)
      if (data.credits) {
        // ★ 简化: 只设置必要字段
        setCredits({
          credits_balance: data.credits.balance,
          credits_total_granted: data.credits.total_granted,
          credits_total_consumed: data.credits.total_consumed,
          tier: sub.plan.slug,
        });
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string; code?: string; action?: string };
      setError({
        message: errorObj.message || '未知错误',
        code: errorObj.code,
        action: errorObj.action
      });
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  };

  // 初始加载 - 只调用一个接口
  useEffect(() => {
    fetchSubscription();
  }, []);

  // 监听外部刷新触发器
  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchSubscription(); // 这个接口已包含积分信息
    }
  }, [refreshTrigger]);

  // 加载状态 (白灰风格)
  if (loading) {
    return (
      <div className={`bg-white border border-gray-200 rounded-xl p-4 shadow-sm ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-100 rounded w-1/3" />
          <div className="h-2 bg-gray-100 rounded" />
          <div className="h-2 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  // 错误状态 (白灰风格)
  if (error) {
    return (
      <div className={`bg-white border border-gray-200 rounded-xl p-4 shadow-sm ${className}`}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-red-500 text-sm font-medium">订阅加载失败</span>
            <button
              onClick={fetchSubscription}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              <RefreshCw className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          <p className="text-gray-600 text-sm">{error.message}</p>
          {error.code && (
            <p className="text-gray-500 text-xs font-mono">错误代码: {error.code}</p>
          )}
          {error.action && (
            <p className="text-amber-600 text-xs">💡 {error.action}</p>
          )}
        </div>
      </div>
    );
  }

  if (!subscription) return null;

  const plan = subscription.plan;
  const features = plan.features;
  const isFree = subscription.is_free || plan.slug === 'free';
  const isCanceled = subscription.canceled_at && subscription.status === 'active';

  // 紧凑模式 (白灰风格)
  if (compact) {
    return (
      <div className={`bg-white border border-gray-200 rounded-xl p-3 shadow-sm ${className}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {getTierIcon(plan.slug)}
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${getTierBadgeStyle(plan.slug)}`}>
              {plan.name}
            </span>
            {isCanceled && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-700">
                已取消续期
              </span>
            )}
          </div>
          {isFree && onUpgradeClick && (
            <button
              onClick={onUpgradeClick}
              className="text-xs text-purple-600 hover:text-purple-700 transition-colors"
            >
              升级
            </button>
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">月度积分</span>
          <span className="text-gray-700">{plan.credits_per_month} 积分</span>
        </div>
      </div>
    );
  }

  // 完整模式 (白灰风格)
  return (
    <>
      <div className={`bg-white border border-gray-200 rounded-xl p-5 shadow-sm ${className}`}>
        {/* 头部 - 当前套餐 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {getTierIcon(plan.slug)}
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${getTierBadgeStyle(plan.slug)}`}>
              {plan.name}
            </span>
            <span className="text-gray-600 text-sm">当前套餐</span>
            {isCanceled && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-700 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                已取消续期
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isFree ? (
              onUpgradeClick && (
                <button
                  onClick={onUpgradeClick}
                  className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-purple-600 to-pink-600 
                             text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
                >
                  升级 Pro
                  <ChevronRight className="w-4 h-4" />
                </button>
              )
            ) : (
              <>
                {subscription.current_period_end && (
                  <span className="text-xs text-gray-500">
                    到期: {new Date(subscription.current_period_end).toLocaleDateString('zh-CN')}
                  </span>
                )}
              </>
            )}
            {/* 管理按钮 */}
            {showManagement && (
              <button
                onClick={() => setShowManagementModal(true)}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="订阅管理"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 取消续期提示 */}
        {isCanceled && subscription.current_period_end && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-amber-700 text-sm">
              您已取消自动续期，订阅将于 {new Date(subscription.current_period_end).toLocaleDateString('zh-CN')} 到期。
              到期后将降级为免费用户。
            </p>
            {showManagement && (
              <button
                onClick={() => setShowManagementModal(true)}
                className="mt-2 text-amber-700 text-sm font-medium hover:text-amber-800"
              >
                恢复订阅 →
              </button>
            )}
          </div>
        )}

        {/* 积分余额 - 整合显示 */}
        <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Gem className="w-5 h-5 text-purple-500" />
              <span className="font-medium text-gray-900">积分余额</span>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-purple-600">
                {credits?.credits_balance?.toLocaleString() || 0}
              </span>
              <span className="text-gray-500 ml-1">积分</span>
            </div>
          </div>
          
          {/* 进度条：显示已消耗占比 */}
          {credits && (credits.credits_total_granted ?? 0) > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>已消耗 {(credits.credits_total_consumed ?? 0).toLocaleString()}</span>
                <span>累计获得 {(credits.credits_total_granted ?? 0).toLocaleString()}</span>
              </div>
              <div className="h-2 bg-white rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full transition-all duration-500"
                  style={{ 
                    width: `${Math.max(5, (credits.credits_balance / (credits.credits_total_granted ?? 1)) * 100)}%` 
                  }}
                />
              </div>
            </div>
          )}
          
          {/* 订阅权益说明 */}
          <div className="mt-3 pt-3 border-t border-purple-100 flex items-center justify-between text-sm">
            <span className="text-gray-600">订阅权益</span>
            <span className="text-purple-600 font-medium">+{plan.credits_per_month} 积分/月</span>
          </div>
        </div>

        {/* 配额列表 */}
        <div className="space-y-4">
        <QuotaItem
          icon={<Sparkles className="w-4 h-4 text-yellow-500" />}
          label="免费 AI 智能剪辑"
          used={0}
          total={features.ai_create_free_gens}
          colorClass="bg-yellow-500"
        />

        <QuotaItem
          icon={<HardDrive className="w-4 h-4 text-green-500" />}
          label="存储空间"
          used={0}
          total={features.storage_mb}
          format={formatStorage}
          colorClass="bg-green-500"
        />

        <QuotaItem
          icon={<FolderOpen className="w-4 h-4 text-amber-500" />}
          label="项目数量"
          used={0}
          total={features.max_projects}
          colorClass="bg-amber-500"
        />
      </div>

      {/* 同时处理能力 */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500 mb-2">同时处理能力</p>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded text-xs">
            <Video className="w-3 h-3 text-blue-500" />
            <span className="text-gray-700">{features.concurrent_videos} 视频</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded text-xs">
            <Image className="w-3 h-3 text-green-500" />
            <span className="text-gray-700">{features.concurrent_images} 图像</span>
          </div>
          {features.concurrent_characters > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded text-xs">
              <Users className="w-3 h-3 text-pink-500" />
              <span className="text-gray-700">{features.concurrent_characters} 角色</span>
            </div>
          )}
        </div>
      </div>

      {/* 功能标记 */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Check className={`w-3 h-3 ${features.access_all_models ? 'text-green-500' : 'text-gray-300'}`} />
            <span className={features.access_all_models ? 'text-gray-700' : 'text-gray-400'}>
              全部模型
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Check className={`w-3 h-3 ${features.access_all_features ? 'text-green-500' : 'text-gray-300'}`} />
            <span className={features.access_all_features ? 'text-gray-700' : 'text-gray-400'}>
              全部功能
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Check className={`w-3 h-3 ${!features.watermark ? 'text-green-500' : 'text-gray-300'}`} />
            <span className={!features.watermark ? 'text-gray-700' : 'text-gray-400'}>
              无水印
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Check className={`w-3 h-3 ${features.early_access_advanced ? 'text-green-500' : 'text-gray-300'}`} />
            <span className={features.early_access_advanced ? 'text-gray-700' : 'text-gray-400'}>
              优先体验
            </span>
          </div>
        </div>
      </div>

      {/* 免费用户升级提示 */}
      {isFree && onUpgradeClick && (
        <div className="mt-4 p-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg">
          <p className="text-purple-700 text-sm">
            ✨ 升级到 Pro 版本，获得 600 积分/月 + 无水印导出！
          </p>
        </div>
      )}

      {/* 额外积分折扣 */}
      {features.extra_credits_discount > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded font-medium">
            BONUS
          </span>
          <span className="text-gray-600">
            额外积分购买享 {features.extra_credits_discount}% 折扣
          </span>
        </div>
      )}

      {/* 管理订阅按钮 (底部) */}
      {showManagement && !isFree && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={() => setShowManagementModal(true)}
            className="w-full py-2 px-4 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 
                     rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Settings className="w-4 h-4" />
            管理订阅
          </button>
        </div>
      )}
    </div>

    {/* 订阅管理弹窗 */}
    {showManagementModal && accessToken && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="max-w-md w-full">
          <SubscriptionManagement
            subscription={{
              id: subscription.id || '',
              status: subscription.status || 'active',
              is_free: isFree,
              billing_cycle: subscription.billing_cycle || 'monthly',
              current_period_start: subscription.current_period_start,
              current_period_end: subscription.current_period_end,
              auto_renew: subscription.auto_renew ?? true,
              canceled_at: subscription.canceled_at,
              plan: {
                slug: plan.slug,
                name: plan.name,
                credits_per_month: plan.credits_per_month,
                features: features,
              },
            }}
            accessToken={accessToken}
            onUpdate={fetchSubscription}
            onClose={() => setShowManagementModal(false)}
          />
        </div>
      </div>
    )}
    </>
  );
}

export default SubscriptionStatus;
