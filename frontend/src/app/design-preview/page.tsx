'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import {
  Sparkles, Upload, ArrowRight, Play, Pause, Check,
  ChevronRight, ImageIcon, Wand2, Layers, Settings,
  Search, Bell, Plus, Heart, Share2, MoreHorizontal,
  Zap, Star, Grid3X3
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { delosTransition, delosVariants, delosHover, delosTap } from '@/lib/motion';

/* =================================================================
   Delos Design Preview — 极简白灰未来感
   "看到什么想变成什么，传张照片就能做到。"
   ================================================================= */

// ---- 动画预设 (白底适配) ----
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.06 } },
};

export default function DesignPreviewPage() {
  const [activeTab, setActiveTab] = useState<'discover' | 'canvas'>('discover');
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [sliderValue, setSliderValue] = useState(65);

  return (
    <div className="min-h-screen bg-surface-base text-hr-text-primary delos-scrollbar">

      {/* ===== Top Bar ===== */}
      <header className="sticky top-0 z-50 glass-panel-strong shadow-topbar">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-accent-core flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-[15px] font-semibold tracking-[-0.01em]">
              Lepus
            </span>
          </div>

          {/* Navigation tabs */}
          <nav className="flex items-center gap-1 bg-surface-overlay rounded-full p-1">
            {(['discover', 'canvas'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'relative px-5 py-1.5 text-[13px] font-medium rounded-full transition-all duration-300',
                  activeTab === tab
                    ? 'text-hr-text-primary'
                    : 'text-hr-text-secondary hover:text-hr-text-primary'
                )}
              >
                {activeTab === tab && (
                  <motion.div
                    layoutId="tab-pill"
                    className="absolute inset-0 bg-white rounded-full shadow-card"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10 capitalize">{tab}</span>
              </button>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-lg hover:bg-surface-hover transition-colors">
              <Search className="w-4 h-4 text-hr-text-secondary" />
            </button>
            <button className="p-2 rounded-lg hover:bg-surface-hover transition-colors relative">
              <Bell className="w-4 h-4 text-hr-text-secondary" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent-core" />
            </button>
            <div className="w-7 h-7 rounded-full bg-surface-muted" />
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {activeTab === 'discover' ? (
          <DiscoverView
            key="discover"
            selectedCard={selectedCard}
            onSelectCard={setSelectedCard}
          />
        ) : (
          <CanvasView
            key="canvas"
            sliderValue={sliderValue}
            onSliderChange={setSliderValue}
          />
        )}
      </AnimatePresence>
    </div>
  );
}


/* ============================================================
   Discover Tab — 瀑布流灵感发现
   ============================================================ */
function DiscoverView({
  selectedCard,
  onSelectCard,
}: {
  selectedCard: number | null;
  onSelectCard: (id: number | null) => void;
}) {
  const demoCards = [
    { id: 1, label: 'Portrait → Oil Painting',  color: 'from-gray-100 to-gray-50',     icon: ImageIcon },
    { id: 2, label: 'Photo → Anime Style',       color: 'from-gray-200 to-gray-50',     icon: Wand2 },
    { id: 3, label: 'Street → Cyberpunk',        color: 'from-gray-200 to-gray-100',    icon: Layers },
    { id: 4, label: 'Pet → 3D Render',           color: 'from-gray-100 to-gray-50',     icon: Sparkles },
    { id: 5, label: 'Landscape → Watercolor',    color: 'from-gray-200 to-gray-50',     icon: Star },
    { id: 6, label: 'Selfie → Comic Book',       color: 'from-gray-100 to-gray-50',     icon: Zap },
  ];

  return (
    <motion.main
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={stagger}
      className="max-w-7xl mx-auto px-6 py-10"
    >
      {/* Hero */}
      <motion.section variants={fadeUp} className="text-center mb-14">
        <p className="cap-label mb-3">REFERENCE-DRIVEN AI</p>
        <h1 className="text-4xl font-semibold tracking-[-0.025em] text-hr-text-primary mb-3">
          看到什么，变成什么
        </h1>
        <p className="text-hr-text-secondary text-base max-w-lg mx-auto leading-relaxed">
          传一张参考图，AI 理解风格并精准变换你的素材。
        </p>
      </motion.section>

      {/* Upload CTA */}
      <motion.section variants={fadeUp} className="mb-14">
        <motion.div
          whileHover={{ scale: 1.005, y: -1 }}
          whileTap={{ scale: 0.995 }}
          className={cn(
            'max-w-lg mx-auto rounded-2xl border-2 border-dashed border-hr-border-dim',
            'bg-surface-raised hover:border-hr-border-accent hover:bg-accent-soft',
            'transition-all duration-300 cursor-pointer group p-10 text-center'
          )}
        >
          <div className="w-12 h-12 rounded-xl bg-surface-overlay group-hover:bg-accent-soft flex items-center justify-center mx-auto mb-4 transition-colors">
            <Upload className="w-5 h-5 text-hr-text-tertiary group-hover:text-accent-core transition-colors" />
          </div>
          <p className="text-[15px] font-medium text-hr-text-primary mb-1">
            上传参考图
          </p>
          <p className="text-[13px] text-hr-text-tertiary">
            拖拽或点击选择 · JPG, PNG, WebP
          </p>
        </motion.div>
      </motion.section>

      {/* Card Grid */}
      <motion.section variants={fadeUp}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">热门风格</h2>
          <button className="text-[13px] text-hr-text-secondary hover:text-accent-core transition-colors flex items-center gap-1">
            查看全部 <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <motion.div
          variants={stagger}
          className="grid grid-cols-2 md:grid-cols-3 gap-4"
        >
          {demoCards.map((card) => {
            const Icon = card.icon;
            const isSelected = selectedCard === card.id;
            return (
              <motion.div
                key={card.id}
                variants={fadeUp}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelectCard(isSelected ? null : card.id)}
                className={cn(
                  'group relative rounded-2xl overflow-hidden cursor-pointer',
                  'border transition-all duration-300',
                  isSelected
                    ? 'border-accent-core shadow-accent-glow'
                    : 'border-hr-border-dim hover:border-hr-border shadow-card hover:shadow-card-hover'
                )}
              >
                {/* Gradient thumbnail */}
                <div className={cn(
                  'aspect-[4/3] bg-gradient-to-br',
                  card.color,
                  'flex items-center justify-center'
                )}>
                  <Icon className={cn(
                    'w-8 h-8 transition-all duration-300',
                    isSelected ? 'text-accent-core scale-110' : 'text-hr-text-tertiary group-hover:text-hr-text-secondary'
                  )} />
                </div>

                {/* Info */}
                <div className="p-3.5 bg-white">
                  <p className="text-[13px] font-medium text-hr-text-primary truncate">
                    {card.label}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[11px] text-hr-text-tertiary">2.4k uses</span>
                    <span className="text-hr-text-tertiary">·</span>
                    <div className="flex items-center gap-0.5 text-[11px] text-hr-text-tertiary">
                      <Heart className="w-3 h-3" /> 128
                    </div>
                  </div>
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-3 right-3 w-6 h-6 rounded-full bg-accent-core flex items-center justify-center shadow-lg"
                  >
                    <Check className="w-3.5 h-3.5 text-white" />
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      </motion.section>

      {/* Design System Showcase */}
      <ComponentShowcase />
    </motion.main>
  );
}


/* ============================================================
   Canvas Tab — 工作区
   ============================================================ */
function CanvasView({
  sliderValue,
  onSliderChange,
}: {
  sliderValue: number;
  onSliderChange: (v: number) => void;
}) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35 }}
      className="flex h-[calc(100vh-56px)]"
    >
      {/* Left panel */}
      <aside className="w-64 border-r border-hr-border-dim bg-surface-raised flex flex-col">
        <div className="p-4">
          <p className="cap-label mb-3">LAYERS</p>
          {['Reference Image', 'Source Video', 'AI Transform', 'Background'].map((layer, i) => (
            <motion.div
              key={layer}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 + 0.1, duration: 0.3 }}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-all duration-200',
                i === 2
                  ? 'bg-accent-soft border border-hr-border-accent text-accent-core'
                  : 'hover:bg-surface-hover text-hr-text-secondary hover:text-hr-text-primary'
              )}
            >
              <div className={cn(
                'w-1.5 h-1.5 rounded-full',
                i === 2 ? 'bg-accent-core' : 'bg-hr-text-tertiary'
              )} />
              <span className="text-[13px] font-medium">{layer}</span>
            </motion.div>
          ))}
        </div>

        <div className="delos-divider mx-4" />

        {/* Properties */}
        <div className="p-4 flex-1">
          <p className="cap-label mb-3">PROPERTIES</p>

          {/* Slider */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] text-hr-text-secondary">Intensity</span>
              <span className="text-[12px] font-mono text-hr-text-tertiary">{sliderValue}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={sliderValue}
              onChange={(e) => onSliderChange(Number(e.target.value))}
              className="w-full delos-slider"
            />
          </div>

          {/* Toggle row */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-[12px] text-hr-text-secondary">Preserve Face</span>
            <button className="w-9 h-5 rounded-full bg-accent-core relative transition-colors">
              <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-white shadow-sm" />
            </button>
          </div>

          {/* Small button group */}
          <div className="flex gap-2">
            <button className="flex-1 text-[12px] font-medium py-2 rounded-lg bg-surface-overlay hover:bg-surface-hover text-hr-text-secondary transition-colors">
              Reset
            </button>
            <button className="flex-1 text-[12px] font-medium py-2 rounded-lg bg-accent-core hover:bg-accent-hover text-white transition-colors">
              Apply
            </button>
          </div>
        </div>
      </aside>

      {/* Main canvas area */}
      <div className="flex-1 bg-surface-base delos-grid flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-[480px] h-[320px] rounded-2xl bg-white border border-hr-border-dim shadow-glass flex flex-col items-center justify-center gap-4"
        >
          <div className="w-16 h-16 rounded-2xl bg-surface-overlay flex items-center justify-center">
            <Grid3X3 className="w-7 h-7 text-hr-text-tertiary" />
          </div>
          <p className="text-[15px] text-hr-text-secondary">拖拽素材到画布开始创作</p>
          <button className="flex items-center gap-2 px-5 py-2 rounded-full bg-accent-core text-white text-[13px] font-medium hover:bg-accent-hover transition-colors shadow-subtle">
            <Plus className="w-3.5 h-3.5" />
            导入素材
          </button>
        </motion.div>
      </div>

      {/* Right panel */}
      <aside className="w-72 border-l border-hr-border-dim bg-surface-raised p-4">
        <p className="cap-label mb-3">AI SETTINGS</p>

        {/* Model selector */}
        <div className="mb-4">
          <label className="text-[12px] text-hr-text-secondary mb-1.5 block">Model</label>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-hr-border-dim cursor-pointer hover:border-hr-border transition-colors">
            <span className="text-[13px] text-hr-text-primary">Style Transfer v2</span>
            <ChevronRight className="w-3.5 h-3.5 text-hr-text-tertiary" />
          </div>
        </div>

        {/* Steps */}
        <div className="mb-4">
          <label className="text-[12px] text-hr-text-secondary mb-1.5 block">Steps</label>
          <div className="flex items-center gap-2">
            {[20, 30, 50].map((step) => (
              <button
                key={step}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200',
                  step === 30
                    ? 'bg-accent-core text-white'
                    : 'bg-surface-overlay text-hr-text-secondary hover:bg-surface-hover'
                )}
              >
                {step}
              </button>
            ))}
          </div>
        </div>

        <div className="delos-divider mb-4" />

        {/* Generate button */}
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-3 rounded-xl bg-accent-core text-white text-[14px] font-semibold transition-colors hover:bg-accent-hover shadow-subtle flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          生成变换
        </motion.button>

        {/* Credit info */}
        <div className="mt-3 text-center">
          <span className="text-[11px] text-hr-text-tertiary">消耗 2 Credits · 剩余 48</span>
        </div>
      </aside>
    </motion.main>
  );
}


/* ============================================================
   Component Showcase — 设计系统组件一览
   ============================================================ */
function ComponentShowcase() {
  return (
    <motion.section variants={fadeUp} className="mt-20 mb-16">
      <div className="delos-divider mb-10" />
      <p className="cap-label mb-6">COMPONENT SYSTEM</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Buttons */}
        <div className="rounded-2xl border border-hr-border-dim bg-white p-6 shadow-card">
          <p className="text-[13px] font-semibold mb-4">Buttons</p>
          <div className="flex flex-wrap gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="px-5 py-2 rounded-xl bg-accent-core text-white text-[13px] font-medium hover:bg-accent-hover transition-colors shadow-subtle"
            >
              Primary
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="px-5 py-2 rounded-xl bg-surface-overlay text-hr-text-primary text-[13px] font-medium hover:bg-surface-hover border border-hr-border-dim transition-colors"
            >
              Secondary
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="px-5 py-2 rounded-xl bg-transparent text-accent-core text-[13px] font-medium hover:bg-accent-soft transition-colors"
            >
              Ghost
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="px-5 py-2 rounded-xl bg-surface-muted text-hr-text-tertiary text-[13px] font-medium cursor-not-allowed"
            >
              Disabled
            </motion.button>
          </div>
        </div>

        {/* Input */}
        <div className="rounded-2xl border border-hr-border-dim bg-white p-6 shadow-card">
          <p className="text-[13px] font-semibold mb-4">Inputs</p>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Default input"
              className="w-full px-3.5 py-2 rounded-lg bg-surface-raised border border-hr-border-dim text-[13px] text-hr-text-primary placeholder:text-hr-text-tertiary focus:outline-none focus:border-accent-core focus:ring-2 focus:ring-accent-soft transition-all"
            />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hr-text-tertiary" />
              <input
                type="text"
                placeholder="Search styles..."
                className="w-full pl-9 pr-3.5 py-2 rounded-lg bg-surface-raised border border-hr-border-dim text-[13px] text-hr-text-primary placeholder:text-hr-text-tertiary focus:outline-none focus:border-accent-core focus:ring-2 focus:ring-accent-soft transition-all"
              />
            </div>
          </div>
        </div>

        {/* Cards / Tags */}
        <div className="rounded-2xl border border-hr-border-dim bg-white p-6 shadow-card">
          <p className="text-[13px] font-semibold mb-4">Tags & Badges</p>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 rounded-full bg-accent-soft text-accent-core text-[12px] font-medium">
              Style Transfer
            </span>
            <span className="px-3 py-1 rounded-full bg-surface-overlay text-hr-text-secondary text-[12px] font-medium border border-hr-border-dim">
              Portrait
            </span>
            <span className="px-3 py-1 rounded-full bg-semantic-success-bg text-semantic-success text-[12px] font-medium">
              Complete
            </span>
            <span className="px-3 py-1 rounded-full bg-semantic-error-bg text-semantic-error text-[12px] font-medium">
              Failed
            </span>
            <span className="px-3 py-1 rounded-full bg-semantic-warning-bg text-semantic-warning text-[12px] font-medium">
              Processing
            </span>
          </div>
        </div>

        {/* Typography */}
        <div className="rounded-2xl border border-hr-border-dim bg-white p-6 shadow-card">
          <p className="text-[13px] font-semibold mb-4">Typography</p>
          <div className="space-y-2">
            <p className="text-2xl font-semibold tracking-[-0.02em] text-hr-text-primary">Heading Large</p>
            <p className="text-lg font-semibold tracking-[-0.01em] text-hr-text-primary">Heading Medium</p>
            <p className="text-[15px] text-hr-text-primary">Body text in the primary color.</p>
            <p className="text-[13px] text-hr-text-secondary">Secondary text for descriptions and labels.</p>
            <p className="cap-label">CAP LABEL STYLE</p>
            <p className="text-[13px] font-mono text-hr-text-tertiary">monospace: 0x6366F1</p>
          </div>
        </div>

        {/* Glass panels */}
        <div className="rounded-2xl border border-hr-border-dim bg-white p-6 shadow-card md:col-span-2">
          <p className="text-[13px] font-semibold mb-4">Glass & Surfaces</p>
          <div className="grid grid-cols-4 gap-4 delos-dots rounded-xl p-6 bg-surface-raised">
            <div className="glass-panel rounded-xl p-4 text-center">
              <p className="text-[12px] text-hr-text-secondary">Glass Subtle</p>
            </div>
            <div className="glass-panel-strong rounded-xl p-4 text-center shadow-glass">
              <p className="text-[12px] text-hr-text-secondary">Glass Strong</p>
            </div>
            <div className="rounded-xl p-4 text-center bg-white border border-hr-border-dim shadow-card">
              <p className="text-[12px] text-hr-text-secondary">Card</p>
            </div>
            <div className="rounded-xl p-4 text-center bg-accent-soft border border-hr-border-accent">
              <p className="text-[12px] text-accent-core">Accent Soft</p>
            </div>
          </div>
        </div>

        {/* Colors */}
        <div className="rounded-2xl border border-hr-border-dim bg-white p-6 shadow-card md:col-span-2">
          <p className="text-[13px] font-semibold mb-4">Color Palette</p>
          <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
            {[
              { label: 'Base', color: 'bg-surface-base border border-hr-border-dim' },
              { label: 'Raised', color: 'bg-surface-raised border border-hr-border-dim' },
              { label: 'Overlay', color: 'bg-surface-overlay' },
              { label: 'Muted', color: 'bg-surface-muted' },
              { label: 'Hover', color: 'bg-surface-hover' },
              { label: 'Accent', color: 'bg-accent-core' },
              { label: 'Soft', color: 'bg-accent-soft border border-hr-border-accent' },
              { label: 'Glow', color: 'bg-accent-glow border border-hr-border-accent' },
              { label: 'Text 1', color: 'bg-hr-text-primary' },
              { label: 'Text 2', color: 'bg-hr-text-secondary' },
              { label: 'Text 3', color: 'bg-hr-text-tertiary' },
              { label: 'A.Hover', color: 'bg-accent-hover' },
            ].map((swatch) => (
              <div key={swatch.label} className="text-center">
                <div className={cn('w-full aspect-square rounded-lg mb-1', swatch.color)} />
                <span className="text-[10px] text-hr-text-tertiary">{swatch.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
