'use client';

import { useState, useEffect } from 'react';
import { 
  Zap, 
  HardDrive, 
  FolderOpen, 
  Sparkles,
  ChevronRight,
  RefreshCw
} from 'lucide-react';

// ============================================
// 类型定义
// ============================================

interface QuotaData {
  user_id: string;
  tier: 'free' | 'pro' | 'enterprise';
  free_trials_total: number;
  free_trials_used: number;
  free_trials_remaining: number;
  ai_tasks_daily_limit: number;
  ai_tasks_used_today: number;
  ai_tasks_remaining_today: number;
  storage_limit_mb: number;
  storage_used_mb: number;
  storage_remaining_mb: number;
  max_projects: number;
  monthly_credits: number;
  credits_used_this_month: number;
}

interface QuotaDisplayProps {
  onUpgradeClick?: () => void;
  compact?: boolean;
  className?: string;
}

// ============================================
// 工具函数
// ============================================

function formatStorage(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

function getTierLabel(tier: string): string {
  switch (tier) {
    case 'pro':
      return 'Pro';
    case 'enterprise':
      return 'Enterprise';
    default:
      return '免费版';
  }
}

function getTierBadgeStyle(tier: string): string {
  switch (tier) {
    case 'pro':
      return 'bg-gradient-to-r from-amber-500 to-orange-500 text-white';
    case 'enterprise':
      return 'bg-gradient-to-r from-purple-500 to-pink-500 text-white';
    default:
      return 'bg-gray-600 text-gray-200';
  }
}

// ============================================
// 进度条组件
// ============================================

interface ProgressBarProps {
  used: number;
  total: number;
  colorClass?: string;
  showWarning?: boolean;
}

function ProgressBar({ used, total, colorClass = 'bg-blue-500', showWarning = true }: ProgressBarProps) {
  // -1 表示无限制
  if (total === -1) {
    return (
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full bg-green-500 w-1/4" />
      </div>
    );
  }

  const percentage = Math.min((used / total) * 100, 100);
  const isWarning = percentage >= 80;
  const isDanger = percentage >= 95;

  let barColor = colorClass;
  if (showWarning) {
    if (isDanger) barColor = 'bg-red-500';
    else if (isWarning) barColor = 'bg-amber-500';
  }

  return (
    <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
      <div
        className={`h-full transition-all duration-300 ${barColor}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

// ============================================
// 配额项组件
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
        <div className="flex items-center gap-2 text-gray-400">
          {icon}
          <span className="text-sm">{label}</span>
        </div>
        <span className="text-sm text-gray-300">
          {displayUsed} / {displayTotal}
        </span>
      </div>
      <ProgressBar used={used} total={total} colorClass={colorClass} />
    </div>
  );
}

// ============================================
// 主组件
// ============================================

export function QuotaDisplay({ onUpgradeClick, compact = false, className = '' }: QuotaDisplayProps) {
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuota = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/users/me/quota', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('获取配额信息失败');
      }

      const data = await response.json();
      setQuota(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuota();
  }, []);

  // 加载状态
  if (loading) {
    return (
      <div className={`bg-[#121214] rounded-lg p-4 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-700 rounded w-1/3" />
          <div className="h-2 bg-gray-700 rounded" />
          <div className="h-2 bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className={`bg-[#121214] rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-between text-gray-400">
          <span className="text-sm">{error}</span>
          <button
            onClick={fetchQuota}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (!quota) return null;

  // 紧凑模式 - 只显示最关键的信息
  if (compact) {
    return (
      <div className={`bg-[#121214] rounded-lg p-3 ${className}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${getTierBadgeStyle(quota.tier)}`}>
              {getTierLabel(quota.tier)}
            </span>
          </div>
          {quota.tier === 'free' && onUpgradeClick && (
            <button
              onClick={onUpgradeClick}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              升级
            </button>
          )}
        </div>

        {/* 免费试用 */}
        {quota.free_trials_remaining > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">免费试用</span>
            <span className="text-gray-300">
              {quota.free_trials_remaining} 次剩余
            </span>
          </div>
        )}

        {/* AI 任务 */}
        <div className="flex items-center justify-between text-sm mt-1">
          <span className="text-gray-400">今日 AI 任务</span>
          <span className="text-gray-300">
            {quota.ai_tasks_daily_limit === -1 
              ? '无限' 
              : `${quota.ai_tasks_remaining_today} / ${quota.ai_tasks_daily_limit}`
            }
          </span>
        </div>
      </div>
    );
  }

  // 完整模式
  return (
    <div className={`bg-[#121214] rounded-lg p-4 ${className}`}>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${getTierBadgeStyle(quota.tier)}`}>
            {getTierLabel(quota.tier)}
          </span>
          <span className="text-gray-300 text-sm">当前套餐</span>
        </div>
        {quota.tier === 'free' && onUpgradeClick && (
          <button
            onClick={onUpgradeClick}
            className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-blue-500 to-purple-500 
                       text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            升级 Pro
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 配额列表 */}
      <div className="space-y-4">
        {/* 免费试用 */}
        {quota.free_trials_total > 0 && (
          <QuotaItem
            icon={<Sparkles className="w-4 h-4" />}
            label="免费试用"
            used={quota.free_trials_used}
            total={quota.free_trials_total}
            colorClass="bg-purple-500"
          />
        )}

        {/* 每日 AI 任务 */}
        <QuotaItem
          icon={<Zap className="w-4 h-4" />}
          label="今日 AI 任务"
          used={quota.ai_tasks_used_today}
          total={quota.ai_tasks_daily_limit}
          colorClass="bg-blue-500"
        />

        {/* 存储空间 */}
        <QuotaItem
          icon={<HardDrive className="w-4 h-4" />}
          label="存储空间"
          used={quota.storage_used_mb}
          total={quota.storage_limit_mb}
          format={formatStorage}
          colorClass="bg-green-500"
        />

        {/* 项目数 */}
        <QuotaItem
          icon={<FolderOpen className="w-4 h-4" />}
          label="项目数量"
          used={0} // TODO: 从 API 获取实际项目数
          total={quota.max_projects}
          colorClass="bg-amber-500"
        />
      </div>

      {/* 底部提示 */}
      {quota.tier === 'free' && quota.free_trials_remaining <= 2 && (
        <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <p className="text-amber-400 text-sm">
            ⚡ 免费试用即将用尽，升级 Pro 解锁更多功能！
          </p>
        </div>
      )}
    </div>
  );
}

export default QuotaDisplay;
