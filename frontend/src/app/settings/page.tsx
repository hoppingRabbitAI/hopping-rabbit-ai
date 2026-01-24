'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, 
  User, 
  Mail, 
  Camera, 
  Save, 
  Loader2,
  CreditCard,
  Bell,
  Shield,
  LogOut,
  Check,
  AlertCircle,
  Gem,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Gift,
  ShoppingCart,
  Clock
} from 'lucide-react';
import { useAuthStore } from '@/features/editor/store/auth-store';
import { QuotaDisplay } from '@/components/subscription/QuotaDisplay';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { CreditsDisplay } from '@/components/subscription/CreditsDisplay';
import { useCreditTransactions, useModelPricing, CreditTransaction, ModelPricing } from '@/lib/hooks/useCredits';

// ============================================
// 类型定义
// ============================================

interface UserProfile {
  display_name: string;
  bio: string;
  avatar_url: string;
}

interface TabItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

// ============================================
// 常量
// ============================================

const TABS: TabItem[] = [
  { id: 'profile', label: '个人资料', icon: <User className="w-4 h-4" /> },
  { id: 'credits', label: '积分明细', icon: <Gem className="w-4 h-4" /> },
  { id: 'subscription', label: '订阅与配额', icon: <CreditCard className="w-4 h-4" /> },
  { id: 'notifications', label: '通知设置', icon: <Bell className="w-4 h-4" /> },
  { id: 'security', label: '安全设置', icon: <Shield className="w-4 h-4" /> },
];

// ============================================
// 头像上传组件
// ============================================

interface AvatarUploadProps {
  currentUrl: string;
  onUpload: (url: string) => void;
  disabled?: boolean;
}

function AvatarUpload({ currentUrl, onUpload, disabled }: AvatarUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    // 验证文件大小 (最大 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('图片大小不能超过 2MB');
      return;
    }

    // 创建预览
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // 上传到 Supabase Storage
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/users/me/avatar', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('上传失败');
      }

      const { url } = await response.json();
      onUpload(url);
    } catch (error) {
      console.error('Avatar upload failed:', error);
      alert('头像上传失败，请重试');
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const displayUrl = preview || currentUrl;
  const initials = 'U'; // 默认头像字母

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative group">
        {/* 头像显示 */}
        <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center">
          {displayUrl ? (
            <img 
              src={displayUrl} 
              alt="Avatar" 
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-3xl text-gray-400 font-medium">{initials}</span>
          )}
        </div>

        {/* 上传遮罩 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 
                     transition-opacity flex items-center justify-center cursor-pointer
                     disabled:cursor-not-allowed"
        >
          {uploading ? (
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          ) : (
            <Camera className="w-6 h-6 text-white" />
          )}
        </button>

        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <p className="text-sm text-gray-500">
        点击上传头像 (最大 2MB)
      </p>
    </div>
  );
}

// ============================================
// 个人资料 Tab
// ============================================

interface ProfileTabProps {
  profile: UserProfile;
  email: string;
  onChange: (field: keyof UserProfile, value: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}

function ProfileTab({ profile, email, onChange, onSave, saving, saved }: ProfileTabProps) {
  return (
    <div className="space-y-6">
      {/* 头像 */}
      <div className="bg-[#121214] rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-200 mb-4">头像</h3>
        <AvatarUpload
          currentUrl={profile.avatar_url}
          onUpload={(url) => onChange('avatar_url', url)}
        />
      </div>

      {/* 基本信息 */}
      <div className="bg-[#121214] rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-200 mb-4">基本信息</h3>
        
        <div className="space-y-4">
          {/* 邮箱 (只读) */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              <Mail className="w-4 h-4 inline mr-1" />
              邮箱
            </label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg 
                         text-gray-400 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">邮箱地址无法修改</p>
          </div>

          {/* 显示名称 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              <User className="w-4 h-4 inline mr-1" />
              显示名称
            </label>
            <input
              type="text"
              value={profile.display_name}
              onChange={(e) => onChange('display_name', e.target.value)}
              placeholder="输入您的名称"
              maxLength={50}
              className="w-full px-4 py-2 bg-[#050505] border border-gray-700 rounded-lg 
                         text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500
                         transition-colors"
            />
          </div>

          {/* 个人简介 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">个人简介</label>
            <textarea
              value={profile.bio}
              onChange={(e) => onChange('bio', e.target.value)}
              placeholder="介绍一下自己..."
              maxLength={200}
              rows={3}
              className="w-full px-4 py-2 bg-[#050505] border border-gray-700 rounded-lg 
                         text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500
                         transition-colors resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">{profile.bio.length}/200</p>
          </div>
        </div>

        {/* 保存按钮 */}
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-white text-black font-medium 
                       rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50
                       disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <Check className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? '保存中...' : saved ? '已保存' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// 订阅与配额 Tab
// ============================================

interface SubscriptionTabProps {
  onUpgradeClick: () => void;
}

function SubscriptionTab({ onUpgradeClick }: SubscriptionTabProps) {
  return (
    <div className="space-y-6">
      {/* 当前配额 */}
      <div>
        <h3 className="text-lg font-medium text-gray-200 mb-4">当前配额</h3>
        <QuotaDisplay onUpgradeClick={onUpgradeClick} />
      </div>

      {/* 订阅管理 */}
      <div className="bg-[#121214] rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-200 mb-4">订阅管理</h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-[#050505] rounded-lg border border-gray-700">
            <div>
              <p className="text-gray-200 font-medium">当前计划</p>
              <p className="text-sm text-gray-500">免费版</p>
            </div>
            <button
              onClick={onUpgradeClick}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 
                         text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              升级 Pro
            </button>
          </div>

          <p className="text-sm text-gray-500">
            升级到 Pro 版本，解锁更多 AI 功能和存储空间。
          </p>
        </div>
      </div>

      {/* 使用历史 */}
      <div className="bg-[#121214] rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-200 mb-4">使用统计</h3>
        <p className="text-gray-500 text-sm">使用统计功能即将上线...</p>
      </div>
    </div>
  );
}

// ============================================
// 积分明细 Tab
// ============================================

function CreditsTab() {
  const { transactions, total, loading, hasMore, loadMore, refetch } = useCreditTransactions(30);
  const { pricing, loading: pricingLoading } = useModelPricing();

  // 获取交易类型图标和颜色
  const getTransactionStyle = (type: string) => {
    switch (type) {
      case 'consume':
        return { icon: <TrendingDown className="w-4 h-4" />, color: 'text-red-400', bg: 'bg-red-500/10' };
      case 'grant':
        return { icon: <Gift className="w-4 h-4" />, color: 'text-green-400', bg: 'bg-green-500/10' };
      case 'refund':
        return { icon: <RefreshCw className="w-4 h-4" />, color: 'text-blue-400', bg: 'bg-blue-500/10' };
      case 'purchase':
        return { icon: <ShoppingCart className="w-4 h-4" />, color: 'text-purple-400', bg: 'bg-purple-500/10' };
      case 'expire':
        return { icon: <Clock className="w-4 h-4" />, color: 'text-gray-400', bg: 'bg-gray-500/10' };
      default:
        return { icon: <Gem className="w-4 h-4" />, color: 'text-gray-400', bg: 'bg-gray-500/10' };
    }
  };

  // 格式化时间
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (days === 1) {
      return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (days < 7) {
      return `${days}天前`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    }
  };

  // 按日期分组交易
  const groupedTransactions = transactions.reduce((groups, tx) => {
    const date = new Date(tx.created_at).toLocaleDateString('zh-CN');
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(tx);
    return groups;
  }, {} as Record<string, CreditTransaction[]>);

  return (
    <div className="space-y-6">
      {/* 积分概览 */}
      <CreditsDisplay />

      {/* 交易记录 */}
      <div className="bg-[#121214] border border-[#2a2a2c] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">积分明细</h3>
          <button
            onClick={() => refetch()}
            className="p-2 hover:bg-[#2a2a2c] rounded-lg transition-colors"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading && transactions.length === 0 ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-12 text-center">
            <Gem className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">暂无积分记录</p>
            <p className="text-sm text-gray-500 mt-1">使用 AI 功能后会产生积分消耗记录</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedTransactions).map(([date, txs]) => (
              <div key={date}>
                <p className="text-xs text-gray-500 mb-2">{date}</p>
                <div className="space-y-2">
                  {txs.map((tx) => {
                    const style = getTransactionStyle(tx.transaction_type);
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between p-3 bg-[#1a1a1c] rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg ${style.bg} flex items-center justify-center ${style.color}`}>
                            {style.icon}
                          </div>
                          <div>
                            <p className="text-sm text-white">
                              {tx.description || tx.model_name || tx.model_key || '积分变动'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatTime(tx.created_at)}
                            </p>
                          </div>
                        </div>
                        <span className={`text-sm font-medium ${
                          tx.credits_amount > 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {tx.credits_amount > 0 ? '+' : ''}{tx.credits_amount}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loading}
                className="w-full py-3 text-sm text-gray-400 hover:text-white transition-colors"
              >
                {loading ? '加载中...' : '加载更多'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 积分定价表 */}
      <div className="bg-[#121214] border border-[#2a2a2c] rounded-xl p-5">
        <h3 className="text-lg font-semibold text-white mb-4">功能消耗参考</h3>
        
        {pricingLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pricing.slice(0, 8).map((item) => (
              <div
                key={item.model_key}
                className="flex items-center justify-between p-3 bg-[#1a1a1c] rounded-lg"
              >
                <div>
                  <p className="text-sm text-white">{item.model_name}</p>
                  <p className="text-xs text-gray-500">{item.description}</p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium text-purple-400">
                    {item.pricing_type === 'per_call' && `${item.credits_rate} 积分/次`}
                    {item.pricing_type === 'per_second' && `${item.credits_rate} 积分/秒`}
                    {item.pricing_type === 'per_minute' && `${item.credits_rate} 积分/分钟`}
                    {item.pricing_type === 'fixed' && `${item.min_credits} 积分`}
                  </span>
                  {item.min_credits > 1 && item.pricing_type !== 'per_call' && (
                    <p className="text-xs text-gray-500">最低 {item.min_credits}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// 通知设置 Tab
// ============================================

function NotificationsTab() {
  const [settings, setSettings] = useState({
    emailNotifications: true,
    marketingEmails: false,
    taskCompletionAlerts: true,
  });

  return (
    <div className="bg-[#121214] rounded-lg p-6">
      <h3 className="text-lg font-medium text-gray-200 mb-4">通知偏好</h3>
      
      <div className="space-y-4">
        {/* 邮件通知 */}
        <label className="flex items-center justify-between p-4 bg-[#050505] rounded-lg border border-gray-700 cursor-pointer">
          <div>
            <p className="text-gray-200">任务完成通知</p>
            <p className="text-sm text-gray-500">AI 任务完成后发送邮件通知</p>
          </div>
          <input
            type="checkbox"
            checked={settings.taskCompletionAlerts}
            onChange={(e) => setSettings({ ...settings, taskCompletionAlerts: e.target.checked })}
            className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 
                       focus:ring-blue-500 focus:ring-offset-gray-900"
          />
        </label>

        <label className="flex items-center justify-between p-4 bg-[#050505] rounded-lg border border-gray-700 cursor-pointer">
          <div>
            <p className="text-gray-200">产品更新</p>
            <p className="text-sm text-gray-500">接收新功能和更新通知</p>
          </div>
          <input
            type="checkbox"
            checked={settings.emailNotifications}
            onChange={(e) => setSettings({ ...settings, emailNotifications: e.target.checked })}
            className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 
                       focus:ring-blue-500 focus:ring-offset-gray-900"
          />
        </label>

        <label className="flex items-center justify-between p-4 bg-[#050505] rounded-lg border border-gray-700 cursor-pointer">
          <div>
            <p className="text-gray-200">营销邮件</p>
            <p className="text-sm text-gray-500">接收优惠和促销信息</p>
          </div>
          <input
            type="checkbox"
            checked={settings.marketingEmails}
            onChange={(e) => setSettings({ ...settings, marketingEmails: e.target.checked })}
            className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 
                       focus:ring-blue-500 focus:ring-offset-gray-900"
          />
        </label>
      </div>

      <p className="text-sm text-gray-500 mt-4">
        * 通知设置功能即将上线
      </p>
    </div>
  );
}

// ============================================
// 安全设置 Tab
// ============================================

function SecurityTab() {
  const router = useRouter();
  const { logout } = useAuthStore();

  const handleLogout = async () => {
    if (confirm('确定要退出登录吗？')) {
      await logout();
      router.push('/login');
    }
  };

  return (
    <div className="space-y-6">
      {/* 修改密码 */}
      <div className="bg-[#121214] rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-200 mb-4">修改密码</h3>
        
        <p className="text-gray-500 text-sm mb-4">
          通过邮箱重置密码来更改您的登录密码。
        </p>

        <Link
          href="/forgot-password"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 
                     rounded-lg hover:bg-gray-600 transition-colors"
        >
          <Shield className="w-4 h-4" />
          重置密码
        </Link>
      </div>

      {/* 登录设备 */}
      <div className="bg-[#121214] rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-200 mb-4">登录会话</h3>
        
        <div className="p-4 bg-[#050505] rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-200">当前设备</p>
              <p className="text-sm text-gray-500">活跃中</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-green-500" />
          </div>
        </div>
      </div>

      {/* 危险区域 */}
      <div className="bg-[#121214] rounded-lg p-6 border border-red-900/30">
        <h3 className="text-lg font-medium text-red-400 mb-4">危险区域</h3>
        
        <div className="space-y-4">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 
                       border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>

          <p className="text-sm text-gray-500">
            退出后需要重新登录才能访问您的账户。
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// 主页面组件
// ============================================

export default function SettingsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuthStore();
  
  const [activeTab, setActiveTab] = useState('profile');
  const [profile, setProfile] = useState<UserProfile>({
    display_name: '',
    bio: '',
    avatar_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // 权限检查
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // 加载用户资料
  useEffect(() => {
    if (user) {
      // 从 user 对象获取初始数据
      setProfile({
        display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || '',
        bio: user.user_metadata?.bio || '',
        avatar_url: user.user_metadata?.avatar_url || '',
      });
    }
  }, [user]);

  // 处理字段变更
  const handleChange = (field: keyof UserProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  // 保存资料
  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(profile),
      });

      if (!response.ok) {
        throw new Error('保存失败');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Save profile failed:', error);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  // 加载中
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* 顶部导航 */}
      <header className="border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/workspace"
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-400" />
            </Link>
            <h1 className="text-xl font-semibold text-gray-200">账户设置</h1>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex gap-8">
          {/* 侧边栏 Tab */}
          <nav className="w-48 flex-shrink-0">
            <ul className="space-y-1">
              {TABS.map((tab) => (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left
                               transition-colors ${
                                 activeTab === tab.id
                                   ? 'bg-gray-800 text-white'
                                   : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-300'
                               }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* 内容区 */}
          <main className="flex-1 min-w-0">
            {activeTab === 'profile' && (
              <ProfileTab
                profile={profile}
                email={user?.email || ''}
                onChange={handleChange}
                onSave={handleSave}
                saving={saving}
                saved={saved}
              />
            )}

            {activeTab === 'credits' && <CreditsTab />}

            {activeTab === 'subscription' && (
              <SubscriptionTab onUpgradeClick={() => setShowUpgradeModal(true)} />
            )}

            {activeTab === 'notifications' && <NotificationsTab />}

            {activeTab === 'security' && <SecurityTab />}
          </main>
        </div>
      </div>

      {/* 升级弹窗 */}
      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        triggerReason="manual"
      />
    </div>
  );
}
