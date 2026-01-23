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
        // CapCut 风格色板 (Dark Mode)
        editor: {
          // 背景层级
          'bg-primary': '#0E0E10',      // 主背景 (时间轴、主工作区)
          'bg-secondary': '#121214',     // 次级背景 (底部时间轴容器)
          'bg-panel': '#18181C',         // 面板背景 (侧边栏、顶栏)
          'bg-elevated': '#1F2329',      // 悬浮层/右键菜单背景
          
          // 品牌强调色 - HoppingRabbit Blue
          'accent': '#3B82F6',           // Blue-500 (高亮、活动状态)
          'accent-dim': 'rgba(59, 130, 246, 0.1)', // 蓝色低透明度
          
          // 文字
          'text': '#E5E7EB',             // 主要文字
          'text-muted': '#6B7280',       // 次要/禁用文字
          
          // 边框
          'border': 'rgba(255, 255, 255, 0.05)',  // 微弱边框
          'border-active': 'rgba(255, 255, 255, 0.10)', // 活动边框
          
          // 语义色
          'danger': '#EF4444',           // 删除/静音标记
          'warning': '#F97316',          // 口癖/警告标记
          'success': '#22C55E',          // 音频波形/成功状态
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 25px rgba(59, 130, 246, 0.6)',
        'glow-cyan-sm': '0 0 10px rgba(59, 130, 246, 0.4)',
        'elevated': '0 20px 50px rgba(0, 0, 0, 0.5)',
        'panel': '0 -20px 50px rgba(0, 0, 0, 0.6)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
