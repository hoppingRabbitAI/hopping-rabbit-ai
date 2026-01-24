'use client';

import { useState } from 'react';
import { useCredits, UserCredits } from '@/lib/hooks/useCredits';
import { Gem, Zap, TrendingUp, AlertCircle, ChevronRight } from 'lucide-react';
import Link from 'next/link';

/**
 * 积分显示组件
 * 显示用户当前积分余额和使用情况
 */
export function CreditsDisplay({ compact = false }: { compact?: boolean }) {
  const { credits, loading, error } = useCredits();

  if (loading) {
    return (
      <div className={`animate-pulse ${compact ? 'h-8' : 'h-24'} bg-[#1a1a1c] rounded-lg`} />
    );
  }

  if (error || !credits) {
    return null;
  }

  // 紧凑模式 - 用于导航栏
  if (compact) {
    return (
      <Link
        href="/settings?tab=credits"
        className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1c] hover:bg-[#252528] rounded-lg transition-colors"
      >
        <Gem className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-white">
          {credits.credits_balance.toLocaleString()}
        </span>
      </Link>
    );
  }

  // 完整模式 - 用于设置页面
  const usagePercent = credits.monthly_credits_limit > 0
    ? Math.round((credits.monthly_credits_used / credits.monthly_credits_limit) * 100)
    : 0;

  const monthlyRemaining = credits.monthly_credits_limit - credits.monthly_credits_used;

  return (
    <div className="bg-[#121214] border border-[#2a2a2c] rounded-xl p-5">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Gem className="w-4 h-4 text-purple-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">积分余额</h3>
        </div>
        <Link
          href="/pricing"
          className="text-sm text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
        >
          获取更多
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* 主要数字 */}
      <div className="flex items-end gap-2 mb-4">
        <span className="text-4xl font-bold text-white">
          {credits.credits_balance.toLocaleString()}
        </span>
        <span className="text-gray-400 mb-1">积分</span>
      </div>

      {/* 进度条 */}
      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-400">本月已用</span>
          <span className="text-gray-300">
            {credits.monthly_credits_used.toLocaleString()} / {credits.monthly_credits_limit.toLocaleString()}
          </span>
        </div>
        <div className="h-2 bg-[#1a1a1c] rounded-full overflow-hidden">
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
        <div className="bg-[#1a1a1c] rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs text-gray-400">月度剩余</span>
          </div>
          <span className="text-lg font-semibold text-white">
            {monthlyRemaining.toLocaleString()}
          </span>
        </div>
        <div className="bg-[#1a1a1c] rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            <span className="text-xs text-gray-400">充值积分</span>
          </div>
          <span className="text-lg font-semibold text-white">
            {credits.paid_credits.toLocaleString()}
          </span>
        </div>
      </div>

      {/* 会员等级 */}
      <div className="mt-4 pt-4 border-t border-[#2a2a2c]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">当前等级</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              credits.tier === 'enterprise' ? 'bg-amber-500/10 text-amber-400' :
              credits.tier === 'pro' ? 'bg-purple-500/10 text-purple-400' :
              'bg-gray-500/10 text-gray-400'
            }`}>
              {credits.tier === 'enterprise' ? 'Enterprise' :
               credits.tier === 'pro' ? 'Pro' : 'Free'}
            </span>
          </div>
          {credits.tier === 'free' && (
            <Link
              href="/pricing"
              className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
            >
              升级解锁更多
            </Link>
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
      <Gem className={`w-3.5 h-3.5 ${insufficient ? 'text-red-400' : 'text-purple-400'}`} />
      <span className={`text-xs ${insufficient ? 'text-red-400' : 'text-gray-400'}`}>
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
    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-sm font-medium text-red-400 mb-1">积分不足</h4>
          <p className="text-sm text-gray-400">
            此操作需要 <span className="text-white font-medium">{required}</span> 积分，
            当前余额 <span className="text-white font-medium">{available}</span> 积分。
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              href="/pricing"
              className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded-lg transition-colors"
            >
              升级获取更多
            </Link>
            {onUpgrade && (
              <button
                onClick={onUpgrade}
                className="px-3 py-1.5 bg-[#2a2a2c] hover:bg-[#3a3a3c] text-white text-sm rounded-lg transition-colors"
              >
                购买积分包
              </button>
            )}
          </div>
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
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-500/10 rounded text-xs text-purple-400 ${className}`}>
      <Gem className="w-3 h-3" />
      {credits}
    </span>
  );
}
