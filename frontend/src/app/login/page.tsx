'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Mail, 
  Lock, 
  ArrowRight, 
  Eye, 
  EyeOff, 
  CheckCircle2,
  ShieldCheck,
  Zap,
  Play,
  Rabbit
} from 'lucide-react';
import { useAuthStore } from '@/features/editor/store/auth-store';
import { GoogleLoginButton, AuthDivider } from '@/components/auth/GoogleLoginButton';

function FeatureItem({ text, icon }: { text: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center space-x-4 group">
      <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-gray-900 group-hover:text-white transition-all duration-300 shadow-sm">
        {icon}
      </div>
      <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors font-medium">{text}</span>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { login, loginWithGoogle, isAuthenticated, isLoading: authLoading } = useAuthStore();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  // 已登录则跳转
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/workspace');
    }
  }, [isAuthenticated, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    
    try {
      await login(email, password);
      setIsSuccess(true);
      
      // 延迟跳转以显示成功动画
      setTimeout(() => {
        router.push('/workspace');
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#FAFAFA] text-gray-900 font-sans flex items-center justify-center relative overflow-hidden">
      
      {/* 背景装饰 */}
      <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[40%] bg-gray-200/50 blur-[100px] rounded-full" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-gray-300/40 blur-[100px] rounded-full" />

      <div className="w-full max-w-[1000px] grid grid-cols-1 md:grid-cols-2 gap-0 z-10 mx-4 bg-white shadow-xl shadow-gray-200/50 rounded-3xl overflow-hidden border border-gray-200">
        
        {/* 左侧：品牌展示区 */}
        <div className="hidden md:flex bg-gray-50 p-10 flex-col justify-between relative border-r border-gray-100">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 flex items-center justify-center transform -rotate-6">
              <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-black tracking-tight text-gray-900 leading-none">HOPPINGRABBIT</span>
              <span className="text-[10px] font-bold text-gray-400 tracking-[0.2em] uppercase">AI Intelligent</span>
            </div>
          </div>

          <div className="space-y-6">
            <h1 className="text-3xl font-black leading-tight tracking-tight text-gray-900">
              灵感跃动，<br />
              <span className="text-gray-500">瞬间完成精彩剪辑</span>
            </h1>
            <p className="text-gray-500 text-sm max-w-sm leading-relaxed">
              HoppingRabbit AI 是为追求速度的创作者打造的智能剪辑引擎。像兔子般敏捷，通过 AI 逻辑让繁琐的后期工作一跃而就。
            </p>
            
            <div className="space-y-4 pt-4">
              <FeatureItem icon={<Zap size={15} />} text="极速 AI 冗余分析与自动剔除" />
              <FeatureItem icon={<Play size={15} />} text="文字驱动轨道，即改即看" />
              <FeatureItem icon={<ShieldCheck size={15} />} text="全链路云端加密与安全协作" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              <span>RABBIT ENGINE v2.5</span>
              <div className="w-1 h-1 rounded-full bg-gray-300" />
              <span>HYPER-SPEED</span>
            </div>
            {/* 装饰性小兔子剪影 */}
            <Rabbit className="text-gray-100 absolute bottom-8 right-8" size={100} strokeWidth={0.5} />
          </div>

          {/* 装饰性背景网格 */}
          <div 
            className="absolute inset-0 opacity-[0.03] pointer-events-none" 
            style={{ 
              backgroundImage: 'linear-gradient(#000 1px, transparent 0), linear-gradient(90deg, #000 1px, transparent 0)', 
              backgroundSize: '40px 40px' 
            }} 
          />
        </div>

        {/* 右侧：登录表单区 */}
        <div className="bg-white p-8 md:p-12 flex flex-col justify-center relative">
          
          {isSuccess ? (
            <div className="text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-20 h-20 bg-green-50 border border-green-200 rounded-full flex items-center justify-center mx-auto text-green-500 shadow-lg shadow-green-100">
                <CheckCircle2 size={40} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-gray-900">认证成功</h2>
                <p className="text-gray-500 text-sm">正在为您加速开启创作空间...</p>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gray-900 rounded-full animate-pulse" style={{ width: '100%' }} />
              </div>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <div className="md:hidden flex items-center space-x-2 mb-6">
                  <div className="w-9 h-9 flex items-center justify-center">
                    <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
                  </div>
                  <span className="text-base font-black tracking-tight text-gray-900">HOPPINGRABBIT AI</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-1">欢迎回来</h2>
                <p className="text-gray-500 text-sm">输入账号进入高效剪辑时代</p>
              </div>

              {error && (
                <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm flex items-center justify-between">
                  <span>{error}</span>
                  <button 
                    type="button"
                    onClick={() => setError('')}
                    className="ml-3 text-red-400 hover:text-red-600 transition-colors text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                {/* 邮箱输入 */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide ml-1">邮箱地址</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 group-focus-within:text-gray-600 transition-colors">
                      <Mail size={18} />
                    </div>
                    <input 
                      type="email" 
                      required
                      placeholder="email@example.com"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3.5 pl-11 pr-4 outline-none focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-900/5 transition-all text-sm placeholder:text-gray-400 text-gray-900"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                {/* 密码输入 */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center ml-1">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">密码</label>
                    <Link href="/forgot-password" className="text-xs text-gray-400 hover:text-gray-600 transition-colors font-medium">找回密码?</Link>
                  </div>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 group-focus-within:text-gray-600 transition-colors">
                      <Lock size={18} />
                    </div>
                    <input 
                      type={showPassword ? "text" : "password"} 
                      required
                      placeholder="••••••••"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3.5 pl-11 pr-12 outline-none focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-900/5 transition-all text-sm placeholder:text-gray-400 text-gray-900"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button 
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    type="submit"
                    disabled={isLoading || isGoogleLoading}
                    className="w-full bg-gray-900 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center space-x-2 hover:bg-gray-800 transition-all shadow-lg shadow-gray-900/20 group disabled:opacity-50 relative overflow-hidden"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span className="text-sm">登 录</span>
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Google 登录 */}
              <AuthDivider />
              <GoogleLoginButton 
                onClick={async () => {
                  setIsGoogleLoading(true);
                  setError('');
                  try {
                    await loginWithGoogle();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Google 登录失败');
                    setIsGoogleLoading(false);
                  }
                }}
                isLoading={isGoogleLoading}
              />

              <div className="mt-6 text-center text-sm text-gray-500">
                还没有账号？
                <Link href="/signup" className="text-gray-900 hover:underline transition-colors ml-1 font-semibold">
                  立即注册
                </Link>
              </div>

              <div className="mt-5 flex items-center justify-center space-x-2 text-xs text-gray-400 bg-gray-50 py-2.5 rounded-xl border border-gray-100">
                <ShieldCheck size={14} className="text-gray-400" />
                <span className="font-medium">HoppingRabbit 保护您的每一帧创意安全</span>
              </div>

              <div className="mt-auto pt-6 border-t border-gray-100 flex justify-between items-center text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                <span>© 2026 HoppingRabbit AI</span>
                <div className="flex space-x-4">
                  <Link href="/terms" className="hover:text-gray-600 transition-colors">使用条款</Link>
                  <Link href="/privacy" className="hover:text-gray-600 transition-colors">隐私声明</Link>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
