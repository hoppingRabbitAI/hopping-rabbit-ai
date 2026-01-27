'use client';

import { useState } from 'react';
import { 
  X, 
  AlertTriangle, 
  Check,
  ChevronRight,
  Loader2,
  RefreshCw,
  XCircle,
  Crown,
  Zap,
  Gem,
  Rocket,
} from 'lucide-react';
import { pricingModal } from '@/lib/stores/pricing-modal-store';

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
  slug: string;
  name: string;
  description?: string;
  credits_per_month: number;
  features: PlanFeatures;
}

interface UserSubscription {
  id: string | null;
  status: string;
  is_free: boolean;
  billing_cycle: string;
  current_period_start?: string;
  current_period_end?: string;
  auto_renew: boolean;
  canceled_at?: string;
  plan: SubscriptionPlan;
}

interface SubscriptionManagementProps {
  subscription: UserSubscription;
  accessToken: string;
  onUpdate: () => void;
  onClose?: () => void;
}

// ============================================
// 工具函数
// ============================================

function formatDate(dateString?: string): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getTierIcon(slug: string) {
  switch (slug) {
    case 'creator':
      return <Rocket className="w-5 h-5 text-pink-500" />;
    case 'ultimate':
      return <Gem className="w-5 h-5 text-purple-500" />;
    case 'pro':
      return <Crown className="w-5 h-5 text-amber-500" />;
    case 'basic':
      return <Zap className="w-5 h-5 text-blue-500" />;
    default:
      return <Zap className="w-5 h-5 text-gray-500" />;
  }
}

// ============================================
// API 函数
// ============================================

async function cancelSubscription(
  accessToken: string, 
  immediate: boolean,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/subscriptions/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ immediate, reason }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || '取消订阅失败');
  }
  return data;
}

async function reactivateSubscription(
  accessToken: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/subscriptions/reactivate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || '恢复订阅失败');
  }
  return data;
}

// ============================================
// 主组件
// ============================================

export function SubscriptionManagement({ 
  subscription, 
  accessToken, 
  onUpdate,
  onClose 
}: SubscriptionManagementProps) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isFree = subscription.is_free || subscription.plan.slug === 'free';
  const isCanceled = subscription.canceled_at && subscription.status === 'active';
  const isExpired = subscription.status === 'cancelled' || subscription.status === 'expired';

  // 取消订阅处理 - 只支持到期取消
  const handleCancel = async () => {
    setIsLoading(true);
    setMessage(null);
    
    try {
      // 始终使用到期取消（immediate=false），这是行业标准做法
      const result = await cancelSubscription(accessToken, false, cancelReason);
      setMessage({ type: 'success', text: result.message });
      setShowCancelConfirm(false);
      setCancelReason('');
      onUpdate();
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : '操作失败' });
    } finally {
      setIsLoading(false);
    }
  };

  // 恢复订阅处理
  const handleReactivate = async () => {
    setIsLoading(true);
    setMessage(null);
    
    try {
      const result = await reactivateSubscription(accessToken);
      setMessage({ type: 'success', text: result.message });
      onUpdate();
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : '操作失败' });
    } finally {
      setIsLoading(false);
    }
  };

  // 去升级 - 打开定价弹窗
  const handleUpgrade = () => {
    pricingModal.open({
      triggerReason: 'upgrade',
      currentTier: subscription.plan.slug,
      onSuccess: onUpdate,
    });
    onClose?.();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
      {/* 头部 */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">订阅管理</h3>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        )}
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`mx-6 mt-4 p-3 rounded-lg flex items-center gap-2 ${
          message.type === 'success' 
            ? 'bg-green-50 text-green-700 border border-green-200' 
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.type === 'success' ? (
            <Check className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      {/* 当前订阅信息 */}
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          {getTierIcon(subscription.plan.slug)}
          <div>
            <h4 className="font-semibold text-gray-800">{subscription.plan.name}</h4>
            <p className="text-sm text-gray-500">
              {subscription.plan.credits_per_month} 积分/月
            </p>
          </div>
          {isCanceled && (
            <span className="ml-auto px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded">
              已取消续期
            </span>
          )}
          {isExpired && (
            <span className="ml-auto px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded">
              已过期
            </span>
          )}
        </div>

        {/* 订阅详情 */}
        {!isFree && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">计费周期</span>
              <span className="text-gray-800 font-medium">月付</span>
            </div>
            {subscription.current_period_end && (
              <div className="flex justify-between">
                <span className="text-gray-600">到期时间</span>
                <span className="text-gray-800 font-medium">
                  {formatDate(subscription.current_period_end)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-600">自动续期</span>
              <span className={`font-medium ${subscription.auto_renew ? 'text-green-600' : 'text-gray-500'}`}>
                {subscription.auto_renew ? '已开启' : '已关闭'}
              </span>
            </div>
            {subscription.canceled_at && (
              <div className="flex justify-between">
                <span className="text-gray-600">取消时间</span>
                <span className="text-gray-800 font-medium">
                  {formatDate(subscription.canceled_at)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="mt-6 space-y-3">
          {/* 免费用户 - 显示升级按钮 */}
          {isFree && (
            <button
              onClick={handleUpgrade}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 
                       text-white font-medium rounded-lg hover:opacity-90 transition-opacity
                       flex items-center justify-center gap-2"
            >
              <Crown className="w-5 h-5" />
              升级订阅
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {/* 付费用户 - 显示升级和取消按钮 */}
          {!isFree && !isExpired && (
            <>
              {/* 升级按钮 */}
              {subscription.plan.slug !== 'creator' && (
                <button
                  onClick={handleUpgrade}
                  className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 
                           text-white font-medium rounded-lg hover:opacity-90 transition-opacity
                           flex items-center justify-center gap-2"
                >
                  <Crown className="w-5 h-5" />
                  升级到更高级计划
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}

              {/* 已取消 - 显示恢复按钮 */}
              {isCanceled && (
                <button
                  onClick={handleReactivate}
                  disabled={isLoading}
                  className="w-full py-3 px-4 bg-green-600 text-white font-medium rounded-lg 
                           hover:bg-green-700 transition-colors flex items-center justify-center gap-2
                           disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-5 h-5" />
                  )}
                  恢复自动续期
                </button>
              )}

              {/* 未取消 - 显示取消按钮 */}
              {!isCanceled && (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="w-full py-3 px-4 border border-red-300 text-red-600 font-medium rounded-lg 
                           hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                >
                  <XCircle className="w-5 h-5" />
                  取消订阅
                </button>
              )}
            </>
          )}

          {/* 已过期用户 - 显示重新订阅按钮 */}
          {isExpired && (
            <button
              onClick={handleUpgrade}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 
                       text-white font-medium rounded-lg hover:opacity-90 transition-opacity
                       flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-5 h-5" />
              重新订阅
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {/* 开发调试按钮 */}
          {process.env.NODE_ENV === 'development' && (
            <button
              onClick={async () => {
                if (!confirm('⚠️ 调试功能：确定要重置订阅状态吗？\n\n这将删除所有订阅记录和积分记录，模拟全新用户。')) return;
                setIsLoading(true);
                try {
                  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/subscriptions/debug/reset`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'Content-Type': 'application/json',
                    },
                  });
                  const data = await response.json();
                  if (response.ok) {
                    setMessage({ type: 'success', text: '✅ 已重置为全新用户状态，请刷新页面' });
                    setTimeout(() => window.location.reload(), 1500);
                  } else {
                    setMessage({ type: 'error', text: data.detail || '重置失败' });
                  }
                } catch (e) {
                  setMessage({ type: 'error', text: '重置失败: ' + (e instanceof Error ? e.message : '未知错误') });
                } finally {
                  setIsLoading(false);
                }
              }}
              disabled={isLoading}
              className="w-full py-2 px-4 border-2 border-dashed border-orange-400 text-orange-600 
                       font-mono text-sm rounded-lg hover:bg-orange-50 transition-colors
                       flex items-center justify-center gap-2 disabled:opacity-50"
            >
              🔧 [DEV] 重置订阅状态（模拟新用户）
            </button>
          )}
        </div>
      </div>

      {/* 取消确认弹窗 - 行业标准做法：只支持到期取消 */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-full">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <h4 className="text-lg font-semibold text-gray-800">确认取消订阅？</h4>
            </div>

            {/* 关键信息：服务持续到何时 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-blue-700 text-sm">
                您的 <span className="font-medium">{subscription.plan.name}</span> 会员权益将持续到 <span className="font-medium">{formatDate(subscription.current_period_end)}</span>，届时将自动降级为免费用户。
              </p>
            </div>

            <p className="text-gray-600 text-sm mb-3">
              取消后您将失去：
            </p>

            <ul className="text-sm text-gray-600 space-y-2 mb-4">
              <li className="flex items-center gap-2">
                <X className="w-4 h-4 text-red-500 flex-shrink-0" />
                每月 {subscription.plan.credits_per_month} 积分
              </li>
              <li className="flex items-center gap-2">
                <X className="w-4 h-4 text-red-500 flex-shrink-0" />
                访问高级 AI 功能
              </li>
              <li className="flex items-center gap-2">
                <X className="w-4 h-4 text-red-500 flex-shrink-0" />
                无水印导出
              </li>
            </ul>

            {/* 取消原因 */}
            <div className="mb-5">
              <label className="block text-sm text-gray-600 mb-1.5">取消原因 (可选)</label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-purple-500/30 bg-white"
              >
                <option value="">请选择原因...</option>
                <option value="too_expensive">价格太贵</option>
                <option value="not_using">使用频率不高</option>
                <option value="missing_features">缺少需要的功能</option>
                <option value="found_alternative">找到了其他替代产品</option>
                <option value="temporary">暂时不需要，以后可能回来</option>
                <option value="other">其他原因</option>
              </select>
            </div>

            {/* 提示：可以随时恢复 */}
            <p className="text-xs text-gray-500 mb-4">
              💡 在到期前，您可以随时恢复订阅
            </p>

            {/* 按钮 */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCancelConfirm(false);
                  setCancelReason('');
                }}
                className="flex-1 py-2.5 px-4 bg-gradient-to-r from-purple-600 to-pink-600 
                         text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
              >
                保留订阅
              </button>
              <button
                onClick={handleCancel}
                disabled={isLoading}
                className="flex-1 py-2.5 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg 
                         hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2 transition-colors"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                取消订阅
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SubscriptionManagement;
