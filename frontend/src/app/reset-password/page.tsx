'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  Lock, 
  ArrowRight, 
  Eye, 
  EyeOff, 
  CheckCircle2,
  Check,
  X,
  AlertTriangle
} from 'lucide-react';
import { useAuthStore } from '@/features/editor/store/auth-store';
import { getSupabaseClient } from '@/lib/supabase/session';

// 密码强度检查
function checkPasswordStrength(password: string) {
  const checks = {
    length: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
  };
  
  const score = Object.values(checks).filter(Boolean).length;
  
  return {
    checks,
    score,
    label: score <= 1 ? '弱' : score <= 2 ? '中' : score <= 3 ? '强' : '很强',
    color: score <= 1 ? 'bg-red-500' : score <= 2 ? 'bg-yellow-500' : score <= 3 ? 'bg-green-500' : 'bg-green-400',
  };
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { updatePassword } = useAuthStore();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');
  const [isValidLink, setIsValidLink] = useState(true);
  const [isCheckingLink, setIsCheckingLink] = useState(true);

  const passwordStrength = checkPasswordStrength(password);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  // 检查重置链接有效性
  useEffect(() => {
    const checkResetLink = async () => {
      try {
        // Supabase 会通过 URL hash 传递 access_token
        // 检查 URL 中是否有相关参数
        const hash = window.location.hash;
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get('access_token');
        const type = params.get('type');
        
        if (type === 'recovery' && accessToken) {
          // 有效的重置链接
          // Supabase 会自动处理 session
          const supabase = getSupabaseClient();
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: params.get('refresh_token') || '',
          });
          
          if (error) {
            console.error('Session error:', error);
            setIsValidLink(false);
          }
        } else if (!hash.includes('access_token')) {
          // 没有 token，可能是直接访问页面
          setIsValidLink(false);
        }
      } catch (err) {
        console.error('Check reset link error:', err);
        setIsValidLink(false);
      } finally {
        setIsCheckingLink(false);
      }
    };

    checkResetLink();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // 验证
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码至少需要6位');
      return;
    }

    setIsLoading(true);
    
    try {
      await updatePassword(password);
      setIsSuccess(true);
      
      // 3秒后跳转到登录页
      setTimeout(() => {
        router.push('/login');
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败，请重试');
      setIsLoading(false);
    }
  };

  // 检查中状态
  if (isCheckingLink) {
    return (
      <div className="min-h-screen w-full bg-[#050505] text-[#E5E7EB] font-sans flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">验证重置链接...</p>
        </div>
      </div>
    );
  }

  // 链接无效状态
  if (!isValidLink) {
    return (
      <div className="min-h-screen w-full bg-[#050505] text-[#E5E7EB] font-sans flex items-center justify-center relative overflow-hidden">
        <div className="absolute top-[-15%] left-[-10%] w-[50%] h-[50%] bg-gray-600/10 blur-[140px] rounded-full animate-pulse" />
        
        <div className="w-full max-w-md z-10 mx-4">
          <div className="bg-[#121214] p-10 rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/5">
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-yellow-500/10 border border-yellow-500/30 rounded-full flex items-center justify-center mx-auto text-yellow-500">
                <AlertTriangle size={40} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white">链接已失效</h2>
                <p className="text-gray-500 text-sm max-w-xs mx-auto">
                  密码重置链接已过期或无效。请重新申请密码重置。
                </p>
              </div>
              <div className="pt-4 space-y-3">
                <Link 
                  href="/forgot-password"
                  className="block w-full bg-gray-700 text-white font-black py-4 rounded-2xl text-center hover:bg-gray-600 transition-all shadow-xl shadow-gray-900/20 tracking-widest uppercase text-xs"
                >
                  重新发送重置邮件
                </Link>
                <Link 
                  href="/login"
                  className="block text-gray-500 hover:text-white transition-colors text-sm"
                >
                  返回登录
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#050505] text-[#E5E7EB] font-sans flex items-center justify-center relative overflow-hidden">
      
      {/* 背景动态光源 */}
      <div className="absolute top-[-15%] left-[-10%] w-[50%] h-[50%] bg-gray-600/10 blur-[140px] rounded-full animate-pulse" />
      <div 
        className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] bg-gray-500/10 blur-[140px] rounded-full animate-pulse" 
        style={{ animationDelay: '3s' }} 
      />

      <div className="w-full max-w-md z-10 mx-4">
        <div className="bg-[#121214] p-10 rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/5">
          
          {/* Logo */}
          <div className="flex items-center justify-center space-x-2 mb-10">
            <div className="w-10 h-10 flex items-center justify-center">
              <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-lg font-black tracking-tighter italic text-white">HOPPINGRABBIT</span>
          </div>

          {isSuccess ? (
            <div className="text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-20 h-20 bg-gray-600/10 border border-gray-500/30 rounded-full flex items-center justify-center mx-auto text-gray-400 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
                <CheckCircle2 size={40} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white">密码已重置</h2>
                <p className="text-gray-500 text-sm">
                  您的密码已成功更新，正在跳转到登录页面...
                </p>
              </div>
              <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-gray-600 animate-pulse" style={{ width: '100%' }} />
              </div>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">重置密码</h2>
                <p className="text-gray-500 text-sm">请输入您的新密码</p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-sm flex items-center justify-between">
                  <span>{error}</span>
                  <button 
                    type="button"
                    onClick={() => setError('')}
                    className="ml-3 text-red-400/60 hover:text-red-400 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* 新密码输入 */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">新密码</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gray-500 transition-colors">
                      <Lock size={18} />
                    </div>
                    <input 
                      type={showPassword ? "text" : "password"} 
                      required
                      placeholder="至少6位字符"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-4 pl-11 pr-12 outline-none focus:border-gray-500/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-gray-500/5 transition-all text-sm placeholder:text-gray-700 text-white"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button 
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-600 hover:text-gray-400 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  
                  {/* 密码强度指示器 */}
                  {password.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map((level) => (
                          <div 
                            key={level}
                            className={`h-1 flex-1 rounded-full transition-all ${
                              passwordStrength.score >= level ? passwordStrength.color : 'bg-gray-800'
                            }`}
                          />
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-gray-600">密码强度: <span className="text-gray-400">{passwordStrength.label}</span></span>
                        <div className="flex items-center gap-2 text-gray-600">
                          <span className={passwordStrength.checks.length ? 'text-green-500' : ''}>8+ 字符</span>
                          <span className={passwordStrength.checks.number ? 'text-green-500' : ''}>数字</span>
                          <span className={passwordStrength.checks.uppercase ? 'text-green-500' : ''}>大写</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 确认密码输入 */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">确认新密码</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gray-500 transition-colors">
                      <Lock size={18} />
                    </div>
                    <input 
                      type={showConfirmPassword ? "text" : "password"} 
                      required
                      placeholder="再次输入新密码"
                      className={`w-full bg-white/[0.03] border rounded-2xl py-4 pl-11 pr-12 outline-none focus:bg-white/[0.06] focus:ring-4 focus:ring-gray-500/5 transition-all text-sm placeholder:text-gray-700 text-white ${
                        confirmPassword.length > 0
                          ? passwordsMatch 
                            ? 'border-green-500/50 focus:border-green-500/50' 
                            : 'border-red-500/50 focus:border-red-500/50'
                          : 'border-white/10 focus:border-gray-500/50'
                      }`}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    <button 
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-600 hover:text-gray-400 transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] ml-1">
                      {passwordsMatch ? (
                        <>
                          <Check size={12} className="text-green-500" />
                          <span className="text-green-500">密码匹配</span>
                        </>
                      ) : (
                        <>
                          <X size={12} className="text-red-500" />
                          <span className="text-red-500">密码不匹配</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-4">
                  <button 
                    type="submit"
                    disabled={isLoading || !passwordsMatch}
                    className="w-full bg-gray-700 text-white font-black py-4 rounded-2xl flex items-center justify-center space-x-2 hover:bg-gray-600 transition-all shadow-xl shadow-gray-900/20 group disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span className="tracking-widest uppercase text-xs">确认重置</span>
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>

        {/* 底部链接 */}
        <div className="mt-8 flex justify-center items-center text-[10px] text-gray-600 font-bold uppercase tracking-widest">
          <span>© 2026 HoppingRabbit AI</span>
        </div>
      </div>
    </div>
  );
}
