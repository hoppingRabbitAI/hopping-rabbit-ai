/**
 * Delos Motion System
 * 
 * 动画语言：慢而自信（Deliberate）
 * 参考：西部世界 Delos 总部的机械精密感
 */

// ---- Transition Presets ----

export const delosTransition = {
  /** 元素进入 — 慢而优雅 */
  enter: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
  /** 元素退出 — 快速消失 */
  exit: { duration: 0.3, ease: 'easeOut' as const },
  /** Hover 反馈 */
  hover: { duration: 0.4, ease: 'easeOut' as const },
  /** 面板展开/收起 */
  panel: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  /** SVG 路径绘制 */
  draw: { duration: 0.8, ease: [0.4, 0, 0.2, 1] as const },
  /** 快速微交互 */
  micro: { duration: 0.2, ease: 'easeOut' as const },
  /** 弹性 */
  spring: { type: 'spring' as const, stiffness: 300, damping: 30 },
};

// ---- Variant Presets ----

export const delosVariants = {
  /** 从下方淡入 */
  fadeUp: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: delosTransition.enter },
    exit: { opacity: 0, transition: delosTransition.exit },
  },
  /** 从下方淡入（更大偏移） */
  fadeUpLarge: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0, transition: delosTransition.enter },
    exit: { opacity: 0, y: 10, transition: delosTransition.exit },
  },
  /** 缩放淡入 */
  scaleIn: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: delosTransition.enter },
    exit: { opacity: 0, scale: 0.98, transition: delosTransition.exit },
  },
  /** 从左侧滑入 */
  slideRight: {
    initial: { opacity: 0, x: -12 },
    animate: { opacity: 1, x: 0, transition: delosTransition.enter },
    exit: { opacity: 0, x: -12, transition: delosTransition.exit },
  },
  /** 面板展开（宽度） */
  panelExpand: {
    initial: { width: 0, opacity: 0 },
    animate: { width: 300, opacity: 1, transition: delosTransition.panel },
    exit: { width: 0, opacity: 0, transition: delosTransition.exit },
  },
  /** 子元素交错动画容器 */
  stagger: {
    animate: {
      transition: { staggerChildren: 0.08 },
    },
  },
  /** 子元素交错动画 item */
  staggerItem: {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0, transition: delosTransition.enter },
  },
  /** 淡入 */
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: delosTransition.enter },
    exit: { opacity: 0, transition: delosTransition.exit },
  },
} as const;

// ---- Hover / Tap 预设 ----

export const delosHover = {
  /** 卡片 hover — 微放大 + 边框发光 */
  card: {
    scale: 1.02,
    transition: delosTransition.hover,
  },
  /** 按钮 hover */
  button: {
    scale: 1.01,
    transition: delosTransition.micro,
  },
  /** 图标按钮 hover */
  icon: {
    scale: 1.1,
    transition: delosTransition.micro,
  },
};

export const delosTap = {
  /** 按钮点击 */
  button: { scale: 0.98 },
  /** 图标点击 */
  icon: { scale: 0.9 },
};
