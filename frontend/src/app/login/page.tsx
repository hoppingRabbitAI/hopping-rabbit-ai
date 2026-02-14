'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  ShieldCheck,
  Zap,
  Sparkles,
  Image,
  Video,
  Wand2,
  Layers,
  X,
  Play,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { GoogleLoginButton, AuthDivider } from '@/components/auth/GoogleLoginButton';

/* ================================================================
   Lepus AI — Landing Page + Login Dialog
   Minimalist black / white / gray
   ================================================================ */

const capabilities = [
  {
    icon: Image,
    title: 'Visual Understanding',
    description: 'Upload a reference image. AI deconstructs style, composition, and tone — understanding your creative intent instantly.',
  },
  {
    icon: Wand2,
    title: 'Intelligent Generation',
    description: 'Text prompts or reference-driven. Generate high-quality images with local editing, inpainting, and style transfer.',
  },
  {
    icon: Video,
    title: 'Video Creation',
    description: 'Image-to-video, smooth transitions, talking head avatars — turn stills into cinematic motion in seconds.',
  },
  {
    icon: Layers,
    title: 'Template Engine',
    description: 'Trending templates from real creators. Upload your photo, apply a template, export in 60 seconds.',
  },
];

const stats = [
  { value: '15+', label: 'AI Capabilities' },
  { value: '60s', label: 'Avg. Creation Time' },
  { value: '2K', label: 'Output Resolution' },
  { value: '99.5%', label: 'Uptime' },
];

/* ---------- Login Dialog ---------- */

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

function LoginDialog({ open, onClose }: LoginDialogProps) {
  const router = useRouter();
  const { login, loginWithGoogle } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email, password);
      setIsSuccess(true);
      setTimeout(() => router.push('/p'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = useCallback(async () => {
    setIsGoogleLoading(true);
    setError('');
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed');
      setIsGoogleLoading(false);
    }
  }, [loginWithGoogle]);

  // Reset form when closing
  useEffect(() => {
    if (!open) {
      setEmail('');
      setPassword('');
      setError('');
      setIsSuccess(false);
      setIsLoading(false);
      setIsGoogleLoading(false);
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Dialog */}
          <motion.div
            className="relative w-full max-w-[420px] bg-white rounded-2xl shadow-glass-lg border border-hr-border-dim overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="p-8">
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-hr-text-tertiary hover:text-hr-text-primary hover:bg-surface-overlay transition-all"
              >
                <X size={18} />
              </button>

              <AnimatePresence mode="wait">
                {isSuccess ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center space-y-5 py-4"
                  >
                    <div className="w-14 h-14 bg-green-50 border border-green-200 rounded-2xl flex items-center justify-center mx-auto text-green-600">
                      <CheckCircle2 size={28} />
                    </div>
                    <div className="space-y-1.5">
                      <h2 className="text-lg font-semibold text-hr-text-primary">Welcome back</h2>
                      <p className="text-hr-text-secondary text-[13px]">Opening your workspace...</p>
                    </div>
                    <div className="w-full h-1 bg-surface-overlay rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: '100%' }}
                        transition={{ duration: 1, ease: 'easeInOut' }}
                        className="h-full bg-hr-text-primary rounded-full"
                      />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {/* Header */}
                    <div className="flex items-center space-x-3 mb-6">
                      <div className="w-10 h-10 flex items-center justify-center -rotate-6">
                        <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-hr-text-primary leading-tight">Welcome back</h2>
                        <p className="text-hr-text-secondary text-[12px]">Sign in to Lepus AI</p>
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

                    <form onSubmit={handleLogin} className="space-y-3.5">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-hr-text-secondary tracking-wide uppercase ml-0.5">Email</label>
                        <div className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-hr-text-tertiary group-focus-within:text-hr-text-secondary transition-colors">
                            <Mail size={16} />
                          </div>
                          <input
                            type="email"
                            required
                            placeholder="email@example.com"
                            className="w-full bg-surface-raised border border-hr-border-dim rounded-xl py-3 pl-10 pr-4 outline-none focus:border-hr-text-primary focus:bg-white focus:ring-2 focus:ring-black/5 transition-all text-[13px] placeholder:text-hr-text-tertiary text-hr-text-primary"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center ml-0.5">
                          <label className="text-[11px] font-medium text-hr-text-secondary tracking-wide uppercase">Password</label>
                          <Link href="/forgot-password" className="text-[11px] text-hr-text-tertiary hover:text-hr-text-primary transition-colors font-medium">
                            Forgot?
                          </Link>
                        </div>
                        <div className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-hr-text-tertiary group-focus-within:text-hr-text-secondary transition-colors">
                            <Lock size={16} />
                          </div>
                          <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            placeholder="••••••••"
                            className="w-full bg-surface-raised border border-hr-border-dim rounded-xl py-3 pl-10 pr-12 outline-none focus:border-hr-text-primary focus:bg-white focus:ring-2 focus:ring-black/5 transition-all text-[13px] placeholder:text-hr-text-tertiary text-hr-text-primary"
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
                      </div>

                      <div className="pt-2">
                        <motion.button
                          type="submit"
                          disabled={isLoading || isGoogleLoading}
                          whileHover={isLoading ? undefined : { scale: 1.01 }}
                          whileTap={isLoading ? undefined : { scale: 0.98 }}
                          className="w-full bg-hr-text-primary text-white font-medium py-3 rounded-xl flex items-center justify-center space-x-2 hover:bg-gray-800 transition-all group disabled:opacity-50"
                        >
                          {isLoading ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <>
                              <span className="text-[13px]">Sign in</span>
                              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                            </>
                          )}
                        </motion.button>
                      </div>
                    </form>

                    <AuthDivider />
                    <GoogleLoginButton onClick={handleGoogleLogin} isLoading={isGoogleLoading} />

                    <p className="mt-5 text-center text-[13px] text-hr-text-secondary">
                      Don&apos;t have an account?
                      <Link href="/signup" className="text-hr-text-primary hover:underline transition-colors ml-1 font-semibold">
                        Sign up free
                      </Link>
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Landing Page ---------- */

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/p');
    }
  }, [isAuthenticated, router]);

  return (
    <div className="min-h-screen bg-white text-hr-text-primary font-sans antialiased">

      {/* ── Navbar ── */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 h-16">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 flex items-center justify-center -rotate-6">
              <img src="/rabbit-logo.png" alt="Lepus AI" className="w-full h-full object-contain" />
            </div>
            <span className="text-lg font-black tracking-tight text-hr-text-primary">LEPUS</span>
          </div>

          <button
            onClick={() => setShowLogin(true)}
            className="px-6 py-2 text-[13px] font-semibold text-white bg-hr-text-primary hover:bg-gray-800 rounded-full transition-all"
          >
            Sign in
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-24 md:pt-44 md:pb-32 overflow-hidden">
        {/* Subtle dot-grid background */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative mx-auto max-w-4xl px-6">
          <div className="flex flex-col items-center text-center">
            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
              className="space-y-6"
            >
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-gray-200 bg-gray-50/80 text-[12px] font-medium text-hr-text-secondary tracking-wide">
                <Sparkles size={13} className="text-hr-text-tertiary" />
                REFERENCE-DRIVEN AI CREATION
              </div>

              {/* Heading */}
              <h1 className="text-5xl md:text-7xl lg:text-[80px] font-bold leading-[1.05] tracking-[-0.035em]">
                The image
                <br />
                <span className="text-hr-text-tertiary">is the prompt.</span>
              </h1>

              {/* Subtitle */}
              <p className="max-w-xl mx-auto text-lg md:text-xl text-hr-text-secondary leading-relaxed font-light">
                Drop a reference photo. AI reads the style, fills the gap,
                and creates what you envisioned — in seconds.
              </p>
            </motion.div>

            {/* CTA Buttons */}
            <motion.div
              className="mt-10 flex flex-col sm:flex-row items-center gap-3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.15 }}
            >
              <button
                onClick={() => setShowLogin(true)}
                className="px-8 py-3.5 text-sm font-semibold text-white bg-hr-text-primary hover:bg-gray-800 rounded-full transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center space-x-2.5 group"
              >
                <span>Start Creating</span>
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button
                onClick={() => {
                  const el = document.getElementById('capabilities');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-8 py-3.5 text-sm font-medium text-hr-text-secondary hover:text-hr-text-primary border border-gray-200 hover:border-gray-300 rounded-full transition-all flex items-center space-x-2"
              >
                <Play size={14} />
                <span>See how it works</span>
              </button>
            </motion.div>

            {/* Trust badges */}
            <motion.div
              className="mt-14 flex items-center gap-8 text-hr-text-tertiary"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.35 }}
            >
              <div className="flex items-center gap-1.5">
                <ShieldCheck size={14} />
                <span className="text-[12px] font-medium">Encrypted</span>
              </div>
              <div className="w-px h-3 bg-gray-200" />
              <div className="flex items-center gap-1.5">
                <Zap size={14} />
                <span className="text-[12px] font-medium">Instant Output</span>
              </div>
              <div className="w-px h-3 bg-gray-200" />
              <div className="flex items-center gap-1.5">
                <Sparkles size={14} />
                <span className="text-[12px] font-medium">15+ AI Tools</span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Stats Bar ── */}
      <section className="border-y border-gray-100 bg-gray-50/50">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                className="text-center"
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
              >
                <div className="text-3xl md:text-4xl font-bold tracking-tight text-hr-text-primary">{stat.value}</div>
                <div className="mt-1 text-[13px] text-hr-text-tertiary font-medium">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Capabilities ── */}
      <section id="capabilities" className="py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div
            className="max-w-2xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-hr-text-tertiary mb-4">Capabilities</p>
            <h2 className="text-3xl md:text-[42px] font-bold leading-[1.1] tracking-[-0.02em]">
              Full-stack AI creation.
              <br />
              <span className="text-hr-text-tertiary">From idea to final cut.</span>
            </h2>
            <p className="mt-5 text-base text-hr-text-secondary leading-relaxed max-w-lg">
              Visual understanding, image generation, video synthesis, and template application — one platform, every creative step.
            </p>
          </motion.div>

          <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((cap, i) => (
              <motion.div
                key={cap.title}
                className="group rounded-2xl border border-gray-100 bg-white p-7 transition-all hover:shadow-card hover:border-gray-200"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
              >
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-hr-text-secondary group-hover:bg-hr-text-primary group-hover:text-white transition-all duration-300">
                  <cap.icon size={20} />
                </div>
                <h3 className="mt-5 text-[15px] font-semibold text-hr-text-primary">{cap.title}</h3>
                <p className="mt-2.5 text-[13px] leading-[1.6] text-hr-text-secondary">{cap.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-24 md:py-32 bg-gray-50/50 border-y border-gray-100">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div
            className="text-center max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-hr-text-tertiary mb-4">How It Works</p>
            <h2 className="text-3xl md:text-[42px] font-bold leading-[1.1] tracking-[-0.02em]">
              Three steps. That&apos;s it.
            </h2>
          </motion.div>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Upload a reference',
                desc: 'Drop your photo alongside a reference image — the style you want, the look you\'re going for.',
              },
              {
                step: '02',
                title: 'AI understands the gap',
                desc: 'Our AI analyzes the differences in style, composition, lighting, and generates a transformation plan.',
              },
              {
                step: '03',
                title: 'Get your result',
                desc: 'Receive a high-quality image or video in seconds. Fine-tune with 15+ AI tools if needed.',
              },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                className="relative"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.12 }}
              >
                <div className="text-[64px] font-bold leading-none text-gray-100 select-none">{item.step}</div>
                <h3 className="mt-2 text-lg font-semibold text-hr-text-primary">{item.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-hr-text-secondary">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Highlight Cards ── */}
      <section className="py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div
            className="max-w-2xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-hr-text-tertiary mb-4">Why Lepus</p>
            <h2 className="text-3xl md:text-[42px] font-bold leading-[1.1] tracking-[-0.02em]">
              Not just tools.
              <br />
              <span className="text-hr-text-tertiary">Your creative partner.</span>
            </h2>
          </motion.div>

          <div className="mt-14 grid gap-5 md:grid-cols-2">
            <motion.div
              className="rounded-2xl bg-hr-text-primary p-10 md:p-12"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <span className="text-[11px] font-semibold tracking-[0.15em] uppercase text-white/40">Reference-Driven</span>
              <h3 className="mt-4 text-2xl md:text-3xl font-bold text-white leading-snug">
                See it. Become it.
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-white/50">
                No more describing from scratch. Upload a reference image, and AI
                understands the style gap — makeup, outfit, scene. What you see is what you get.
              </p>
              <button
                onClick={() => setShowLogin(true)}
                className="mt-8 inline-flex items-center space-x-2 rounded-full bg-white px-6 py-2.5 text-[13px] font-semibold text-hr-text-primary transition-all hover:bg-gray-100 hover:scale-[1.02] active:scale-[0.98]"
              >
                <span>Try it free</span>
                <ArrowRight size={14} />
              </button>
            </motion.div>

            <motion.div
              className="rounded-2xl border border-gray-200 bg-gray-50 p-10 md:p-12"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <span className="text-[11px] font-semibold tracking-[0.15em] uppercase text-hr-text-tertiary">Narrative Creation</span>
              <h3 className="mt-4 text-2xl md:text-3xl font-bold text-hr-text-primary leading-snug">
                Not just a photo.
                <br />A story.
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-hr-text-secondary">
                From single frames to multi-shot narratives with auto-arranged transitions and pacing.
                Canvas + timeline — let AI tell your whole story.
              </p>
              <button
                onClick={() => setShowLogin(true)}
                className="mt-8 inline-flex items-center space-x-2 rounded-full bg-hr-text-primary px-6 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-gray-800 hover:scale-[1.02] active:scale-[0.98]"
              >
                <span>Try it free</span>
                <ArrowRight size={14} />
              </button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-24 md:py-32 border-t border-gray-100">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
            className="space-y-5"
          >
            <h2 className="text-3xl md:text-5xl font-bold leading-tight tracking-[-0.03em]">
              Ready to create?
            </h2>
            <p className="mx-auto max-w-md text-lg text-hr-text-secondary leading-relaxed font-light">
              Free credits on signup. No credit card required.
              Start creating professional content with AI today.
            </p>
            <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => setShowLogin(true)}
                className="px-8 py-3.5 text-sm font-semibold text-white bg-hr-text-primary hover:bg-gray-800 rounded-full transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Get Started — It&apos;s Free
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 flex items-center justify-center -rotate-6">
                <img src="/rabbit-logo.png" alt="Lepus" className="w-full h-full object-contain" />
              </div>
              <span className="text-[13px] font-bold text-hr-text-primary">LEPUS AI</span>
            </div>
            <div className="flex items-center space-x-6 text-[12px] text-hr-text-tertiary">
              <Link href="/terms" className="hover:text-hr-text-secondary transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-hr-text-secondary transition-colors">Privacy</Link>
              <span>© 2026 Lepus AI. All rights reserved.</span>
            </div>
          </div>
        </div>
      </footer>

      {/* ── Login Dialog ── */}
      <LoginDialog open={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );
}
