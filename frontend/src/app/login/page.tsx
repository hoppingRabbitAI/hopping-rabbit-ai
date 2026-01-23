'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

function FeatureItem({ text, icon }: { text: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center space-x-4 group">
      <div className="w-7 h-7 rounded-lg bg-gray-600/10 flex items-center justify-center text-gray-500 group-hover:bg-gray-600 group-hover:text-white transition-all duration-300 shadow-lg shadow-gray-500/5">
        {icon}
      </div>
      <span className="text-sm text-gray-400 group-hover:text-gray-200 transition-colors font-medium">{text}</span>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading: authLoading } = useAuthStore();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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
    <div className="min-h-screen w-full bg-[#050505] text-[#E5E7EB] font-sans flex items-center justify-center relative overflow-hidden">
      
      {/* 背景动态光源 - 采用深蓝色调营造沉浸感 */}
      <div className="absolute top-[-15%] left-[-10%] w-[50%] h-[50%] bg-gray-600/10 blur-[140px] rounded-full animate-pulse" />
      <div 
        className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] bg-gray-500/10 blur-[140px] rounded-full animate-pulse" 
        style={{ animationDelay: '3s' }} 
      />

      <div className="w-full max-w-[1100px] grid grid-cols-1 md:grid-cols-2 gap-0 z-10 mx-4 shadow-[0_0_100px_rgba(0,0,0,0.5)] rounded-[2.5rem] overflow-hidden border border-white/5">
        
        {/* 左侧：品牌展示区 - HoppingRabbit AI 专属设计 */}
        <div className="hidden md:flex bg-[#0D0D0F] p-12 flex-col justify-between relative border-r border-white/5">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 flex items-center justify-center transform -rotate-6">
              <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black tracking-tighter italic text-white leading-none">HOPPINGRABBIT</span>
              <span className="text-[10px] font-bold text-gray-500 tracking-[0.3em] uppercase">AI Intelligent</span>
            </div>
          </div>

          <div className="space-y-6">
            <h1 className="text-4xl font-black leading-tight tracking-tight text-white">
              灵感跃动，<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-300 to-white">瞬间完成精彩剪辑</span>
            </h1>
            <p className="text-gray-500 text-sm max-w-sm leading-relaxed">
              HoppingRabbit AI 是为追求速度的创作者打造的智能剪辑引擎。像兔子般敏捷，通过 AI 逻辑让繁琐的后期工作一跃而就。
            </p>
            
            <div className="space-y-4 pt-4">
              <FeatureItem icon={<Zap size={14} />} text="极速 AI 冗余分析与自动剔除" />
              <FeatureItem icon={<Play size={14} />} text="文字驱动轨道，即改即看" />
              <FeatureItem icon={<ShieldCheck size={14} />} text="全链路云端加密与安全协作" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 text-[10px] text-gray-600 font-bold uppercase tracking-widest">
              <span>RABBIT ENGINE v2.5</span>
              <div className="w-1 h-1 rounded-full bg-gray-800" />
              <span>HYPER-SPEED</span>
            </div>
            {/* 装饰性小兔子剪影 */}
            <Rabbit className="text-white/[0.03] absolute bottom-10 right-10" size={120} strokeWidth={0.5} />
          </div>

          {/* 装饰性背景网格 */}
          <div 
            className="absolute inset-0 opacity-[0.02] pointer-events-none" 
            style={{ 
              backgroundImage: 'linear-gradient(#fff 1px, transparent 0), linear-gradient(90deg, #fff 1px, transparent 0)', 
              backgroundSize: '40px 40px' 
            }} 
          />
        </div>

        {/* 右侧：登录表单区 */}
        <div className="bg-[#121214] p-10 md:p-16 flex flex-col justify-center relative">
          
          {isSuccess ? (
            <div className="text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-20 h-20 bg-gray-600/10 border border-gray-500/30 rounded-full flex items-center justify-center mx-auto text-gray-400 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
                <CheckCircle2 size={40} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white">认证成功</h2>
                <p className="text-gray-500 text-sm">正在为您加速开启创作空间...</p>
              </div>
              <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gray-600 animate-pulse" style={{ width: '100%' }} />
              </div>
            </div>
          ) : (
            <>
              <div className="mb-10">
                <div className="md:hidden flex items-center space-x-2 mb-8">
                  <div className="w-10 h-10 flex items-center justify-center">
                    <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
                  </div>
                  <span className="text-lg font-black tracking-tighter italic text-white">HOPPINGRABBIT AI</span>
                </div>
                <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">登 录</h2>
                <p className="text-gray-500 text-sm font-medium">输入账号进入高效剪辑时代</p>
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

              <form onSubmit={handleLogin} className="space-y-5">
                {/* 邮箱输入 */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">邮箱地址</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gray-500 transition-colors">
                      <Mail size={18} />
                    </div>
                    <input 
                      type="email" 
                      required
                      placeholder="email@example.com"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-4 pl-11 pr-4 outline-none focus:border-gray-500/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-gray-500/5 transition-all text-sm placeholder:text-gray-700 text-white"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                {/* 密码输入 */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center ml-1">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">密码</label>
                    <a href="#" className="text-[10px] text-gray-500/60 hover:text-gray-400 transition-colors font-bold uppercase tracking-tighter">找回密码?</a>
                  </div>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gray-500 transition-colors">
                      <Lock size={18} />
                    </div>
                    <input 
                      type={showPassword ? "text" : "password"} 
                      required
                      placeholder="••••••••"
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
                </div>

                <div className="pt-6">
                  <button 
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gray-700 text-white font-black py-4 rounded-2xl flex items-center justify-center space-x-2 hover:bg-gray-600 transition-all shadow-xl shadow-gray-900/20 group disabled:opacity-50 relative overflow-hidden"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span className="tracking-widest uppercase text-xs">进入实验室</span>
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              </form>

              <div className="mt-10 flex items-center justify-center space-x-3 text-[11px] text-gray-600 bg-white/[0.02] py-2.5 rounded-full border border-white/5">
                <ShieldCheck size={14} className="text-gray-500/50" />
                <span className="font-medium">HoppingRabbit 保护您的每一帧创意安全</span>
              </div>

              <div className="mt-auto pt-10 border-t border-white/5 flex justify-between items-center text-[10px] text-gray-600 font-bold uppercase tracking-widest">
                <span>© 2026 HoppingRabbit AI</span>
                <div className="flex space-x-6">
                  <a href="#" className="hover:text-gray-400 transition-colors">使用条款</a>
                  <a href="#" className="hover:text-gray-400 transition-colors">隐私声明</a>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
