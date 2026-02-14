/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
    './src/stores/**/*.{js,ts,jsx,tsx,mdx}',
    './src/hooks/**/*.{js,ts,jsx,tsx,mdx}',
    './src/types/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  safelist: [
    // Clip type colors - 确保这些动态类名被生成
    'bg-blue-600',
    'bg-green-600',
    'bg-purple-600',
    'bg-yellow-600',
    'bg-teal-600',
    'bg-red-600',
    'bg-pink-600',
    'bg-orange-600',
    'bg-cyan-600',
  ],
  theme: {
    extend: {
      colors: {
        // CapCut 风格色板 (Dark Mode) — 保留兼容
        editor: {
          'bg-primary': '#0E0E10',
          'bg-secondary': '#121214',
          'bg-panel': '#18181C',
          'bg-elevated': '#1F2329',
          'accent': '#3B82F6',
          'accent-dim': 'rgba(59, 130, 246, 0.1)',
          'text': '#E5E7EB',
          'text-muted': '#6B7280',
          'border': 'rgba(255, 255, 255, 0.05)',
          'border-active': 'rgba(255, 255, 255, 0.10)',
          'danger': '#EF4444',
          'warning': '#F97316',
          'success': '#22C55E',
        },

        // =============================================
        // Delos Design System — "西部世界" 极简白灰未来感
        // =============================================

        // Surface 层级（由浅到深的白灰层次）
        surface: {
          base:     '#FFFFFF',     // 纯白底层
          raised:   '#FAFBFC',     // 微微抬起（卡片/区块底色）
          overlay:  '#F3F5F7',     // 浮层/面板
          muted:    '#EBEEF2',     // 非激活区域
          hover:    '#E3E7EC',     // Hover 态
        },

        // Glass 层级（白色毛玻璃面板）
        glass: {
          subtle:  'rgba(255,255,255, 0.60)',
          light:   'rgba(255,255,255, 0.72)',
          medium:  'rgba(255,255,255, 0.82)',
          heavy:   'rgba(255,255,255, 0.92)',
        },

        // 边框（极细灰线）
        'hr-border': {
          dim:    'rgba(0,0,0, 0.06)',       // 静态边框
          DEFAULT:'rgba(0,0,0, 0.10)',       // 常规边框
          strong: 'rgba(0,0,0, 0.15)',       // 强调边框
          accent: 'rgba(99,102,241, 0.35)',  // Accent 焦点态
        },

        // 文字（深灰层级，不用纯黑）
        'hr-text': {
          primary:   '#111827',     // Gray-900（主文字）
          secondary: '#6B7280',     // Gray-500（辅助）
          tertiary:  '#9CA3AF',     // Gray-400（占位/禁用）
          accent:    '#6366F1',     // Indigo-500
        },

        // Accent（品牌色 — 整个界面唯一的彩色）
        accent: {
          core:  '#6366F1',          // Indigo-500
          soft:  'rgba(99,102,241, 0.08)',  // 淡底色
          glow:  'rgba(99,102,241, 0.12)',  // 发光/选中底
          hover: '#4F46E5',          // Indigo-600（hover 加深）
        },

        // 语义色（极少使用，背景态用淡色）
        semantic: {
          success:    '#16A34A',
          'success-bg': 'rgba(34,197,94, 0.08)',
          error:      '#DC2626',
          'error-bg': 'rgba(239,68,68, 0.08)',
          warning:    '#EA580C',
          'warning-bg':'rgba(249,115,22, 0.08)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'cap': ['10px', { letterSpacing: '0.12em', fontWeight: '500' }],
      },
      borderRadius: {
        'delos': '16px',
        'delos-sm': '8px',
        'delos-lg': '20px',
      },
      boxShadow: {
        // 保留旧的
        'glow-cyan': '0 0 25px rgba(59, 130, 246, 0.6)',
        'glow-cyan-sm': '0 0 10px rgba(59, 130, 246, 0.4)',
        'elevated': '0 20px 50px rgba(0, 0, 0, 0.5)',
        'panel': '0 -20px 50px rgba(0, 0, 0, 0.6)',
        // Delos 新增（白底适配）
        'accent-glow': '0 0 0 1px rgba(99,102,241,0.15), 0 0 16px rgba(99,102,241,0.08)',
        'accent-glow-lg': '0 0 0 1px rgba(99,102,241,0.2), 0 0 24px rgba(99,102,241,0.12)',
        'glass': '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)',
        'glass-lg': '0 2px 6px rgba(0,0,0,0.04), 0 16px 48px rgba(0,0,0,0.08)',
        'subtle': '0 1px 2px rgba(0,0,0,0.04)',
        'card': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)',
        'modal': '0 24px 48px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.06)',
        'topbar': '0 1px 0 rgba(0,0,0,0.06)',
        'inner': 'inset 0 1px 2px rgba(0,0,0,0.06)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'breathe': 'breathe 2s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'generating-progress': 'generating-progress 2s ease-in-out infinite',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(99,102,241,0.1)' },
          '50%': { boxShadow: '0 0 30px rgba(99,102,241,0.25)' },
        },
        'generating-progress': {
          '0%': { transform: 'translateX(-100%)' },
          '50%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      backdropBlur: {
        'xs': '2px',
      },
    },
  },
  plugins: [],
};
