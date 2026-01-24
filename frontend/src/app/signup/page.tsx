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
  Rabbit,
  Check,
  X
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

export default function SignupPage() {
  const router = useRouter();
  const { signUp, isAuthenticated } = useAuthStore();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const passwordStrength = checkPasswordStrength(password);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  // 已登录则跳转
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/workspace');
    }
  }, [isAuthenticated, router]);

  const handleSignup = async (e: React.FormEvent) => {
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

    if (!agreedToTerms) {
      setError('请阅读并同意服务条款');
      return;
    }

    setIsLoading(true);
    
    try {
      await signUp(email, password);
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请重试');
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

      <div className="w-full max-w-[1100px] grid grid-cols-1 md:grid-cols-2 gap-0 z-10 mx-4 shadow-[0_0_100px_rgba(0,0,0,0.5)] rounded-[2.5rem] overflow-hidden border border-white/5">
        
        {/* 左侧：品牌展示区 */}
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
              加入我们，<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-300 to-white">开启 AI 剪辑新纪元</span>
            </h1>
            <p className="text-gray-500 text-sm max-w-sm leading-relaxed">
              注册后即可获得 6 次免费 AI 处理额度，体验极速智能剪辑的魅力。无需信用卡，立即开始创作。
            </p>
            
            <div className="space-y-4 pt-4">
              <FeatureItem icon={<Zap size={14} />} text="6 次免费 AI 处理额度" />
              <FeatureItem icon={<Play size={14} />} text="支持多种视频格式导入" />
              <FeatureItem icon={<ShieldCheck size={14} />} text="数据安全加密存储" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 text-[10px] text-gray-600 font-bold uppercase tracking-widest">
              <span>RABBIT ENGINE v2.5</span>
              <div className="w-1 h-1 rounded-full bg-gray-800" />
              <span>HYPER-SPEED</span>
            </div>
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

        {/* 右侧：注册表单区 */}
        <div className="bg-[#121214] p-10 md:p-16 flex flex-col justify-center relative">
          
          {isSuccess ? (
            <div className="text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-20 h-20 bg-gray-600/10 border border-gray-500/30 rounded-full flex items-center justify-center mx-auto text-gray-400 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
                <Mail size={40} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white">验证邮件已发送</h2>
                <p className="text-gray-500 text-sm max-w-xs mx-auto">
                  我们已向 <span className="text-white">{email}</span> 发送了一封验证邮件，请查收并点击链接完成注册。
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
                  没收到邮件？检查垃圾邮件箱或 <button className="text-gray-400 hover:text-white transition-colors">重新发送</button>
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <div className="md:hidden flex items-center space-x-2 mb-8">
                  <div className="w-10 h-10 flex items-center justify-center">
                    <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
                  </div>
                  <span className="text-lg font-black tracking-tighter italic text-white">HOPPINGRABBIT AI</span>
                </div>
                <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">注 册</h2>
                <p className="text-gray-500 text-sm font-medium">创建账号，开启智能剪辑之旅</p>
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

              <form onSubmit={handleSignup} className="space-y-4">
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
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">密码</label>
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
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest ml-1">确认密码</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-gray-500 transition-colors">
                      <Lock size={18} />
                    </div>
                    <input 
                      type={showConfirmPassword ? "text" : "password"} 
                      required
                      placeholder="再次输入密码"
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

                {/* 服务条款 */}
                <div className="flex items-start space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setAgreedToTerms(!agreedToTerms)}
                    className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-all mt-0.5 ${
                      agreedToTerms 
                        ? 'bg-gray-600 border-gray-600' 
                        : 'bg-transparent border-white/20 hover:border-white/40'
                    }`}
                  >
                    {agreedToTerms && <Check size={14} className="text-white" />}
                  </button>
                  <span className="text-xs text-gray-500 leading-relaxed">
                    我已阅读并同意 <a href="/terms" className="text-gray-400 hover:text-white transition-colors">服务条款</a> 和 <a href="/privacy" className="text-gray-400 hover:text-white transition-colors">隐私政策</a>
                  </span>
                </div>

                <div className="pt-4">
                  <button 
                    type="submit"
                    disabled={isLoading || !agreedToTerms}
                    className="w-full bg-gray-700 text-white font-black py-4 rounded-2xl flex items-center justify-center space-x-2 hover:bg-gray-600 transition-all shadow-xl shadow-gray-900/20 group disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span className="tracking-widest uppercase text-xs">创建账号</span>
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              </form>

              <div className="mt-8 text-center text-sm text-gray-500">
                已有账号？
                <Link href="/login" className="text-gray-400 hover:text-white transition-colors ml-1 font-medium">
                  立即登录
                </Link>
              </div>

              <div className="mt-auto pt-8 border-t border-white/5 flex justify-between items-center text-[10px] text-gray-600 font-bold uppercase tracking-widest">
                <span>© 2026 HoppingRabbit AI</span>
                <div className="flex space-x-6">
                  <a href="/terms" className="hover:text-gray-400 transition-colors">使用条款</a>
                  <a href="/privacy" className="hover:text-gray-400 transition-colors">隐私声明</a>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
