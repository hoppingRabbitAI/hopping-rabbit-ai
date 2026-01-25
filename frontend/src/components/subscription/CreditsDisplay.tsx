'use client';

import { useCredits } from '@/lib/hooks/useCredits';
import { Gem, Zap, TrendingUp, AlertCircle, ChevronRight } from 'lucide-react';

/**
 * 积分显示组件
 * 显示用户当前积分余额和使用情况
 * 
 * 样式风格: 白灰为主 (与 workspace 一致)
 */
interface CreditsDisplayProps {
  compact?: boolean;
  onUpgradeClick?: () => void;
}

export function CreditsDisplay({ compact = false, onUpgradeClick }: CreditsDisplayProps) {
  const { credits, loading, error } = useCredits();

  if (loading) {
    return (
      <div className={`animate-pulse ${compact ? 'h-8' : 'h-24'} bg-gray-100 rounded-lg`} />
    );
  }

  if (error || !credits) {
    return null;
  }

  // 紧凑模式 - 用于导航栏
  if (compact) {
    return (
      <button
        onClick={onUpgradeClick}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
      >
        <Gem className="w-4 h-4 text-purple-500" />
        <span className="text-sm font-medium text-gray-900">
          {credits.credits_balance.toLocaleString()}
        </span>
      </button>
    );
  }

  // 完整模式 - 用于设置页面 (白灰风格)
  const usagePercent = credits.monthly_credits_limit > 0
    ? Math.round((credits.monthly_credits_used / credits.monthly_credits_limit) * 100)
    : 0;

  const monthlyRemaining = credits.monthly_credits_limit - credits.monthly_credits_used;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
            <Gem className="w-4 h-4 text-purple-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">积分余额</h3>
        </div>
        {onUpgradeClick && (
          <button
            onClick={onUpgradeClick}
            className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 transition-colors"
          >
            获取更多
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 主要数字 */}
      <div className="flex items-end gap-2 mb-4">
        <span className="text-4xl font-bold text-gray-900">
          {credits.credits_balance.toLocaleString()}
        </span>
        <span className="text-gray-500 mb-1">积分</span>
      </div>

      {/* 进度条 */}
      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-500">本月已用</span>
          <span className="text-gray-700">
            {credits.monthly_credits_used.toLocaleString()} / {credits.monthly_credits_limit.toLocaleString()}
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              usagePercent > 90 ? 'bg-red-500' :
              usagePercent > 70 ? 'bg-yellow-500' :
              'bg-purple-500'
            }`}
            style={{ width: `${Math.min(usagePercent, 100)}%` }}
          />
        </div>
      </div>

      {/* 详细信息 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-3.5 h-3.5 text-yellow-500" />
            <span className="text-xs text-gray-500">月度剩余</span>
          </div>
          <span className="text-lg font-semibold text-gray-900">
            {monthlyRemaining.toLocaleString()}
          </span>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-green-500" />
            <span className="text-xs text-gray-500">充值积分</span>
          </div>
          <span className="text-lg font-semibold text-gray-900">
            {credits.paid_credits.toLocaleString()}
          </span>
        </div>
      </div>

      {/* 会员等级 */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">当前等级</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              credits.tier === 'enterprise' ? 'bg-amber-100 text-amber-600' :
              credits.tier === 'pro' ? 'bg-purple-100 text-purple-600' :
              'bg-gray-100 text-gray-600'
            }`}>
              {credits.tier === 'enterprise' ? 'Enterprise' :
               credits.tier === 'pro' ? 'Pro' : 'Free'}
            </span>
          </div>
          {credits.tier === 'free' && onUpgradeClick && (
            <button
              onClick={onUpgradeClick}
              className="text-sm text-purple-600 hover:text-purple-700 transition-colors"
            >
              升级解锁更多
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 积分预估显示组件
 * 在执行 AI 操作前显示预估消耗
 */
interface CreditsEstimateProps {
  modelKey: string;
  credits: number;
  userBalance?: number;
  className?: string;
}

export function CreditsEstimate({
  modelKey,
  credits,
  userBalance,
  className = '',
}: CreditsEstimateProps) {
  const { credits: userCredits } = useCredits();
  const balance = userBalance ?? userCredits?.credits_balance ?? 0;
  const insufficient = balance < credits;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Gem className={`w-3.5 h-3.5 ${insufficient ? 'text-red-500' : 'text-purple-500'}`} />
      <span className={`text-xs ${insufficient ? 'text-red-500' : 'text-gray-500'}`}>
        约消耗 {credits} 积分
        {insufficient && ' (余额不足)'}
      </span>
    </div>
  );
}

/**
 * 积分不足提示组件
 */
interface InsufficientCreditsAlertProps {
  required: number;
  available: number;
  onUpgrade?: () => void;
}

export function InsufficientCreditsAlert({
  required,
  available,
  onUpgrade,
}: InsufficientCreditsAlertProps) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-sm font-medium text-red-600 mb-1">积分不足</h4>
          <p className="text-sm text-gray-600">
            此操作需要 <span className="text-gray-900 font-medium">{required}</span> 积分，
            当前余额 <span className="text-gray-900 font-medium">{available}</span> 积分。
          </p>
          {onUpgrade && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={onUpgrade}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors"
              >
                升级获取更多
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 迷你积分显示 - 用于按钮旁边
 */
export function CreditsBadge({ credits, className = '' }: { credits: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-100 rounded text-xs text-purple-600 ${className}`}>
      <Gem className="w-3 h-3" />
      {credits}
    </span>
  );
}
