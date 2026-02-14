'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Lock,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  Check,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

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

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/p');
    }
  }, [isAuthenticated, router]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

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
    <div className="min-h-screen w-full bg-surface-base text-hr-text-primary font-sans flex items-center justify-center relative overflow-hidden">
      {/* 背景点阵 */}
      <div className="absolute inset-0 delos-dots opacity-30 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-full max-w-[460px] z-10 mx-4"
      >
        <div className="bg-white shadow-glass-lg rounded-2xl border border-hr-border-dim overflow-hidden">
          <div className="p-8 md:p-10">
            <AnimatePresence mode="wait">
              {isSuccess ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center space-y-5 py-4"
                >
                  <div className="w-14 h-14 bg-accent-soft border border-accent-core/20 rounded-2xl flex items-center justify-center mx-auto text-accent-core">
                    <Mail size={28} />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-lg font-semibold text-hr-text-primary">验证邮件已发送</h2>
                    <p className="text-hr-text-secondary text-[13px] max-w-xs mx-auto">
                      我们已向 <span className="font-semibold text-hr-text-primary">{email}</span> 发送了一封验证邮件，请查收并点击链接完成注册。
                    </p>
                  </div>
                  <div className="pt-3 space-y-3">
                    <Link
                      href="/login"
                      className="block w-full bg-accent-core text-white font-medium py-3 rounded-xl text-center hover:bg-accent-hover transition-all text-[13px]"
                    >
                      返回登录
                    </Link>
                    <p className="text-hr-text-tertiary text-[12px]">
                      没收到邮件？检查垃圾邮件箱或{' '}
                      <button className="text-accent-core hover:text-accent-hover transition-colors font-medium">重新发送</button>
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {/* Header */}
                  <div className="flex items-center space-x-3 mb-7">
                    <div className="w-10 h-10 flex items-center justify-center -rotate-6">
                      <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-hr-text-primary leading-tight">创建账号</h2>
                      <p className="text-hr-text-secondary text-[12px]">注册 Lepus AI，开启智能创作</p>
                    </div>
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-[13px] flex items-center justify-between"
                    >
                      <span>{error}</span>
                      <button type="button" onClick={() => setError('')} className="ml-3 text-red-300 hover:text-red-500 transition-colors">
                        <X size={14} />
                      </button>
                    </motion.div>
                  )}

                  <form onSubmit={handleSignup} className="space-y-3.5">
                    {/* 邮箱 */}
                    <div className="space-y-1.5">
                      <label className="cap-label ml-0.5">邮箱地址</label>
                      <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-hr-text-tertiary group-focus-within:text-hr-text-secondary transition-colors">
                          <Mail size={16} />
                        </div>
                        <input
                          type="email"
                          required
                          placeholder="email@example.com"
                          className="w-full bg-surface-raised border border-hr-border-dim rounded-xl py-3 pl-10 pr-4 outline-none focus:border-accent-core focus:bg-white focus:ring-2 focus:ring-accent-soft transition-all text-[13px] placeholder:text-hr-text-tertiary text-hr-text-primary"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* 密码 */}
                    <div className="space-y-1.5">
                      <label className="cap-label ml-0.5">密码</label>
                      <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-hr-text-tertiary group-focus-within:text-hr-text-secondary transition-colors">
                          <Lock size={16} />
                        </div>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          placeholder="至少6位字符"
                          className="w-full bg-surface-raised border border-hr-border-dim rounded-xl py-3 pl-10 pr-12 outline-none focus:border-accent-core focus:bg-white focus:ring-2 focus:ring-accent-soft transition-all text-[13px] placeholder:text-hr-text-tertiary text-hr-text-primary"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-hr-text-tertiary hover:text-hr-text-secondary transition-colors"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {password.length > 0 && (
                        <div className="space-y-1.5 pt-0.5">
                          <div className="flex gap-1">
                            {[1, 2, 3, 4].map((level) => (
                              <div
                                key={level}
                                className={`h-1 flex-1 rounded-full transition-all ${
                                  passwordStrength.score >= level ? passwordStrength.color : 'bg-surface-muted'
                                }`}
                              />
                            ))}
                          </div>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-hr-text-tertiary">
                              密码强度: <span className="text-hr-text-secondary">{passwordStrength.label}</span>
                            </span>
                            <div className="flex items-center gap-2 text-hr-text-tertiary">
                              <span className={passwordStrength.checks.length ? 'text-green-500' : ''}>8+ 字符</span>
                              <span className={passwordStrength.checks.number ? 'text-green-500' : ''}>数字</span>
                              <span className={passwordStrength.checks.uppercase ? 'text-green-500' : ''}>大写</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 确认密码 */}
                    <div className="space-y-1.5">
                      <label className="cap-label ml-0.5">确认密码</label>
                      <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-hr-text-tertiary group-focus-within:text-hr-text-secondary transition-colors">
                          <Lock size={16} />
                        </div>
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          required
                          placeholder="再次输入密码"
                          className={`w-full bg-surface-raised border rounded-xl py-3 pl-10 pr-12 outline-none focus:bg-white focus:ring-2 focus:ring-accent-soft transition-all text-[13px] placeholder:text-hr-text-tertiary text-hr-text-primary ${
                            confirmPassword.length > 0
                              ? passwordsMatch
                                ? 'border-green-400 focus:border-green-400'
                                : 'border-red-400 focus:border-red-400'
                              : 'border-hr-border-dim focus:border-accent-core'
                          }`}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-hr-text-tertiary hover:text-hr-text-secondary transition-colors"
                        >
                          {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {confirmPassword.length > 0 && (
                        <div className="flex items-center gap-1 text-[10px] ml-0.5">
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
                    <div className="flex items-start space-x-3 pt-1">
                      <button
                        type="button"
                        onClick={() => setAgreedToTerms(!agreedToTerms)}
                        className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-all mt-0.5 ${
                          agreedToTerms
                            ? 'bg-accent-core border-accent-core'
                            : 'bg-transparent border-hr-border hover:border-hr-border-strong'
                        }`}
                      >
                        {agreedToTerms && <Check size={14} className="text-white" />}
                      </button>
                      <span className="text-[12px] text-hr-text-secondary leading-relaxed">
                        我已阅读并同意{' '}
                        <Link href="/terms" className="text-accent-core hover:text-accent-hover transition-colors">服务条款</Link>
                        {' '}和{' '}
                        <Link href="/privacy" className="text-accent-core hover:text-accent-hover transition-colors">隐私政策</Link>
                      </span>
                    </div>

                    <div className="pt-2">
                      <motion.button
                        type="submit"
                        disabled={isLoading || !agreedToTerms}
                        whileHover={isLoading ? undefined : { scale: 1.01 }}
                        whileTap={isLoading ? undefined : { scale: 0.98 }}
                        className="w-full bg-accent-core text-white font-medium py-3 rounded-xl flex items-center justify-center space-x-2 hover:bg-accent-hover transition-all shadow-subtle group disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <>
                            <span className="text-[13px]">创建账号</span>
                            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                          </>
                        )}
                      </motion.button>
                    </div>
                  </form>

                  <p className="mt-6 text-center text-[13px] text-hr-text-secondary">
                    已有账号？
                    <Link href="/login" className="text-accent-core hover:text-accent-hover transition-colors ml-1 font-semibold">
                      立即登录
                    </Link>
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-between items-center px-2 cap-label">
          <span>© 2026 Lepus AI</span>
          <div className="flex space-x-4">
            <Link href="/terms" className="hover:text-hr-text-secondary transition-colors">使用条款</Link>
            <Link href="/privacy" className="hover:text-hr-text-secondary transition-colors">隐私声明</Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
