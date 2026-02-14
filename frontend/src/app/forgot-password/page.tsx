'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Mail, 
  ArrowRight, 
  ArrowLeft,
  CheckCircle2,
  Rabbit
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

export default function ForgotPasswordPage() {
  const { resetPasswordForEmail } = useAuthStore();
  
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    
    try {
      await resetPasswordForEmail(email);
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

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
            <span className="text-lg font-black tracking-tighter italic text-white">LEPUS</span>
          </div>

          {isSuccess ? (
            <div className="text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-20 h-20 bg-gray-600/10 border border-gray-500/30 rounded-full flex items-center justify-center mx-auto text-gray-400 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
                <CheckCircle2 size={40} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white">邮件已发送</h2>
                <p className="text-gray-500 text-sm max-w-xs mx-auto">
                  我们已向 <span className="text-white">{email}</span> 发送了密码重置链接，请查收邮件并点击链接重置密码。
                </p>
              </div>
              <div className="pt-4 space-y-3">
                <Link 
                  href="/login"
                  className="block w-full bg-gray-700 text-white font-black py-4 rounded-2xl text-center hover:bg-gray-600 transition-all shadow-xl shadow-gray-900/20 tracking-widest uppercase text-xs"
                >
                  返回登录
                </Link>
                <p className="text-gray-600 text-xs">
                  没收到邮件？检查垃圾邮件箱或 
                  <button 
                    onClick={() => {
                      setIsSuccess(false);
                      setIsLoading(false);
                    }}
                    className="text-gray-400 hover:text-white transition-colors ml-1"
                  >
                    重新发送
                  </button>
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">忘记密码</h2>
                <p className="text-gray-500 text-sm">输入您的邮箱地址，我们将发送密码重置链接</p>
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

              <form onSubmit={handleSubmit} className="space-y-5">
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

                <div className="pt-4">
                  <button 
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gray-700 text-white font-black py-4 rounded-2xl flex items-center justify-center space-x-2 hover:bg-gray-600 transition-all shadow-xl shadow-gray-900/20 group disabled:opacity-50 relative overflow-hidden"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span className="tracking-widest uppercase text-xs">发送重置链接</span>
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              </form>

              <div className="mt-8">
                <Link 
                  href="/login"
                  className="flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-white transition-colors"
                >
                  <ArrowLeft size={16} />
                  返回登录
                </Link>
              </div>
            </>
          )}

          {/* 装饰性兔子 */}
          <Rabbit className="text-white/[0.02] absolute bottom-4 right-4" size={80} strokeWidth={0.5} />
        </div>

        {/* 底部链接 */}
        <div className="mt-8 flex justify-center items-center text-[10px] text-gray-600 font-bold uppercase tracking-widest">
          <span>© 2026 Lepus AI</span>
        </div>
      </div>
    </div>
  );
}
