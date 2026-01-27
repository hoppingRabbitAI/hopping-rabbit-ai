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
import { SubscriptionStatus } from '@/components/subscription/SubscriptionStatus';
import { pricingModal } from '@/lib/stores/pricing-modal-store';
import { toast } from '@/lib/stores/toast-store';
import { useCreditTransactions, useModelPricing, CreditTransaction, ModelPricing } from '@/lib/hooks/useCredits';
import { useCreditsStore } from '@/lib/stores/credits-store';

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
  accessToken?: string | null;
}

function AvatarUpload({ currentUrl, onUpload, disabled, accessToken }: AvatarUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 清除之前的错误
    setError(null);

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }

    // 验证文件大小 (最大 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError('图片大小不能超过 2MB');
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

      const headers: HeadersInit = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/api/users/me/avatar', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: formData,
      });

      if (!response.ok) {
        // 尝试从响应中获取错误信息
        const errorData = await response.json().catch(() => null);
        const errorMessage = errorData?.detail || errorData?.message || '上传失败，请重试';
        throw new Error(errorMessage);
      }

      const { url } = await response.json();
      onUpload(url);
      setError(null);
    } catch (err) {
      console.error('Avatar upload failed:', err);
      setError(err instanceof Error ? err.message : '头像上传失败，请重试');
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
        <div className={`w-24 h-24 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center border-2 ${error ? 'border-red-300' : 'border-gray-200'}`}>
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
          className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 
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
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* 错误提示 */}
      {error ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg max-w-xs">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
          <button 
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-600 text-lg leading-none"
          >
            ×
          </button>
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          点击上传头像 (支持 jpg, png, gif, webp，最大 2MB)
        </p>
      )}
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
  accessToken?: string | null;
}

function ProfileTab({ profile, email, onChange, onSave, saving, saved, accessToken }: ProfileTabProps) {
  return (
    <div className="space-y-6">
      {/* 头像 */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">头像</h3>
        <AvatarUpload
          currentUrl={profile.avatar_url}
          onUpload={(url) => onChange('avatar_url', url)}
          accessToken={accessToken}
        />
      </div>

      {/* 基本信息 */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">基本信息</h3>
        
        <div className="space-y-4">
          {/* 邮箱 (只读) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Mail className="w-4 h-4 inline mr-1" />
              邮箱
            </label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg 
                         text-gray-500 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">邮箱地址无法修改</p>
          </div>

          {/* 显示名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <User className="w-4 h-4 inline mr-1" />
              显示名称
            </label>
            <input
              type="text"
              value={profile.display_name}
              onChange={(e) => onChange('display_name', e.target.value)}
              placeholder="输入您的名称"
              maxLength={50}
              className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg 
                         text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 
                         focus:ring-gray-900/10 focus:border-gray-400 transition-all"
            />
          </div>

          {/* 个人简介 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">个人简介</label>
            <textarea
              value={profile.bio}
              onChange={(e) => onChange('bio', e.target.value)}
              placeholder="介绍一下自己..."
              maxLength={200}
              rows={3}
              className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg 
                         text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 
                         focus:ring-gray-900/10 focus:border-gray-400 transition-all resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">{profile.bio.length}/200</p>
          </div>
        </div>

        {/* 保存按钮 */}
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white font-medium 
                       rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50
                       disabled:cursor-not-allowed shadow-sm"
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
  refreshTrigger?: number;
}

function SubscriptionTab({ onUpgradeClick, refreshTrigger = 0 }: SubscriptionTabProps) {
  const { transactions, loading: txLoading, hasMore, loadMore, refetch } = useCreditTransactions(30);
  const { pricing, loading: pricingLoading } = useModelPricing();
  const { credits, initCredits } = useCreditsStore();

  useEffect(() => {
    initCredits();
  }, [initCredits]);

  // 获取交易类型图标和颜色
  const getTransactionStyle = (type: string) => {
    switch (type) {
      case 'consume':
        return { icon: <TrendingDown className="w-4 h-4" />, color: 'text-red-500', bg: 'bg-red-50' };
      case 'grant':
        return { icon: <Gift className="w-4 h-4" />, color: 'text-green-500', bg: 'bg-green-50' };
      case 'refund':
        return { icon: <RefreshCw className="w-4 h-4" />, color: 'text-blue-500', bg: 'bg-blue-50' };
      case 'purchase':
        return { icon: <ShoppingCart className="w-4 h-4" />, color: 'text-purple-500', bg: 'bg-purple-50' };
      case 'expire':
        return { icon: <Clock className="w-4 h-4" />, color: 'text-gray-500', bg: 'bg-gray-100' };
      default:
        return { icon: <Gem className="w-4 h-4" />, color: 'text-gray-500', bg: 'bg-gray-100' };
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
      {/* 当前订阅状态（已整合积分余额） */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">当前订阅</h3>
        <SubscriptionStatus onUpgradeClick={onUpgradeClick} showManagement={true} refreshTrigger={refreshTrigger} />
      </div>

      {/* 积分明细 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">积分明细</h3>
          <button
            onClick={() => refetch()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 text-gray-500 ${txLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {txLoading && transactions.length === 0 ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-12 text-center">
            <Gem className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">暂无积分记录</p>
            <p className="text-sm text-gray-400 mt-1">使用 AI 功能后会产生积分消耗记录</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedTransactions).map(([date, txs]) => (
              <div key={date}>
                <p className="text-xs text-gray-400 mb-2 font-medium">{date}</p>
                <div className="space-y-2">
                  {txs.map((tx) => {
                    const style = getTransactionStyle(tx.transaction_type);
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg ${style.bg} flex items-center justify-center ${style.color}`}>
                            {style.icon}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {tx.description || tx.model_name || tx.model_key || '积分变动'}
                            </p>
                            <p className="text-xs text-gray-400">
                              {formatTime(tx.created_at)}
                            </p>
                          </div>
                        </div>
                        <span className={`text-sm font-semibold ${
                          tx.credits_amount > 0 ? 'text-green-500' : 'text-red-500'
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
                disabled={txLoading}
                className="w-full py-3 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 
                           rounded-lg transition-colors"
              >
                {txLoading ? '加载中...' : '加载更多'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 功能消耗参考 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">功能消耗参考</h3>
        
        {pricingLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pricing.slice(0, 8).map((item) => {
              const isFree = item.credits_rate === 0 && (!item.min_credits || item.min_credits === 0);
              
              return (
                <div
                  key={item.model_key}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.model_name}</p>
                    <p className="text-xs text-gray-400">{item.description}</p>
                  </div>
                  <div className="text-right">
                    {isFree ? (
                      <span className="text-sm font-semibold text-green-600">
                        ✨ 免费
                      </span>
                    ) : (
                      <>
                        <span className="text-sm font-semibold text-gray-700">
                          {item.pricing_type === 'per_call' && `${item.credits_rate} 积分/次`}
                          {item.pricing_type === 'per_second' && `${item.credits_rate} 积分/秒`}
                          {item.pricing_type === 'per_minute' && `${item.credits_rate} 积分/分钟`}
                          {item.pricing_type === 'fixed' && `${item.min_credits} 积分`}
                        </span>
                        {item.min_credits > 1 && item.pricing_type !== 'per_call' && (
                          <p className="text-xs text-gray-400">最低 {item.min_credits}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
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
    <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">通知偏好</h3>
      
      <div className="space-y-3">
        {/* 邮件通知 */}
        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors">
          <div>
            <p className="text-gray-900 font-medium">任务完成通知</p>
            <p className="text-sm text-gray-500">AI 任务完成后发送邮件通知</p>
          </div>
          <input
            type="checkbox"
            checked={settings.taskCompletionAlerts}
            onChange={(e) => setSettings({ ...settings, taskCompletionAlerts: e.target.checked })}
            className="w-5 h-5 rounded bg-white border-gray-300 text-gray-900 
                       focus:ring-gray-900 focus:ring-offset-0"
          />
        </label>

        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors">
          <div>
            <p className="text-gray-900 font-medium">产品更新</p>
            <p className="text-sm text-gray-500">接收新功能和更新通知</p>
          </div>
          <input
            type="checkbox"
            checked={settings.emailNotifications}
            onChange={(e) => setSettings({ ...settings, emailNotifications: e.target.checked })}
            className="w-5 h-5 rounded bg-white border-gray-300 text-gray-900 
                       focus:ring-gray-900 focus:ring-offset-0"
          />
        </label>

        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors">
          <div>
            <p className="text-gray-900 font-medium">营销邮件</p>
            <p className="text-sm text-gray-500">接收优惠和促销信息</p>
          </div>
          <input
            type="checkbox"
            checked={settings.marketingEmails}
            onChange={(e) => setSettings({ ...settings, marketingEmails: e.target.checked })}
            className="w-5 h-5 rounded bg-white border-gray-300 text-gray-900 
                       focus:ring-gray-900 focus:ring-offset-0"
          />
        </label>
      </div>

      <p className="text-sm text-gray-400 mt-4">
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
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">修改密码</h3>
        
        <p className="text-gray-500 text-sm mb-4">
          通过邮箱重置密码来更改您的登录密码。
        </p>

        <Link
          href="/forgot-password"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 
                     font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          <Shield className="w-4 h-4" />
          重置密码
        </Link>
      </div>

      {/* 登录设备 */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">登录会话</h3>
        
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-900 font-medium">当前设备</p>
              <p className="text-sm text-gray-500">活跃中</p>
            </div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          </div>
        </div>
      </div>

      {/* 危险区域 */}
      <div className="bg-white rounded-xl p-6 border border-red-200 shadow-sm">
        <h3 className="text-lg font-semibold text-red-600 mb-4">危险区域</h3>
        
        <div className="space-y-4">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 
                       border border-red-200 rounded-lg hover:bg-red-100 transition-colors font-medium"
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
  const { user, accessToken, isAuthenticated, isLoading } = useAuthStore();
  const { refetchCredits } = useCreditsStore();
  
  const [activeTab, setActiveTab] = useState('profile');
  const [profile, setProfile] = useState<UserProfile>({
    display_name: '',
    bio: '',
    avatar_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [subscriptionRefreshTrigger, setSubscriptionRefreshTrigger] = useState(0);

  // 订阅成功后刷新积分和订阅状态
  const handleSubscriptionSuccess = () => {
    refetchCredits();
    setSubscriptionRefreshTrigger(prev => prev + 1);
  };

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
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers,
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
      toast.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  // 加载中
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/workspace"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </Link>
            <h1 className="text-xl font-bold text-gray-900">账户设置</h1>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex gap-8">
          {/* 侧边栏 Tab */}
          <nav className="w-52 flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-200 p-2 shadow-sm">
              <ul className="space-y-1">
                {TABS.map((tab) => (
                  <li key={tab.id}>
                    <button
                      onClick={() => setActiveTab(tab.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                                 transition-colors text-sm font-medium ${
                                   activeTab === tab.id
                                     ? 'bg-gray-900 text-white'
                                     : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                 }`}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
                accessToken={accessToken}
              />
            )}

            {activeTab === 'subscription' && (
              <SubscriptionTab 
                onUpgradeClick={() => pricingModal.open({ triggerReason: 'upgrade', onSuccess: handleSubscriptionSuccess })} 
                refreshTrigger={subscriptionRefreshTrigger}
              />
            )}

            {activeTab === 'notifications' && <NotificationsTab />}

            {activeTab === 'security' && <SecurityTab />}
          </main>
        </div>
      </div>
    </div>
  );
}
