/**
 * V2 Remotion 配置渲染合成组件
 * 
 * 支持 LLM 生成的 Remotion 配置：
 * - text_components: 文字动画组件
 * - broll_components: B-Roll 视频组件
 * - chapter_components: 章节标题组件
 * 
 * ★ 优化更新：
 * - 增强文字样式：双重描边、渐变阴影、发光效果
 * - 支持中文字体：Noto Sans SC
 * - 优化 B-Roll 占位符样式
 */
import {
  AbsoluteFill,
  Sequence,
  Video,
  Img,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  OffthreadVideo,
  staticFile,
} from 'remotion';
import { z } from 'zod';

// ============================================
// 字体预加载
// ============================================
const FONTS = {
  'Noto Sans SC': 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&display=swap',
  'Inter': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'ZCOOL KuaiLe': 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap',
};

// 字体预加载（在客户端执行）
if (typeof window !== 'undefined') {
  Object.entries(FONTS).forEach(([name, url]) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  });
}

// ============================================
// 类型定义
// ============================================

// ============================================
// 抖音/小红书风格字幕系统
// ============================================
// 双层字幕结构：
// 1. 主字幕（main_subtitle）：屏幕底部，大字，彩色+白描边
// 2. 关键词高亮（keyword_highlight）：主字幕上方，小字，蓝色背景框

// 文字动画组件
export const TextComponentSchema = z.object({
  id: z.string(),
  type: z.literal('text'),
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
  // ★ 新增 main-subtitle 和 keyword-highlight 两种核心类型
  animation: z.enum([
    'main-subtitle',      // 抖音风格主字幕：大字、彩色、白描边、底部居中
    'keyword-highlight',  // 关键词高亮：蓝色背景框、小字、主字幕上方
    'typewriter', 
    'fade-in', 
    'slide-up', 
    'highlight', 
    'bounce', 
    'zoom-in', 
    'none'
  ]),
  // ★ 位置系统重构：更精确的抖音风格定位
  position: z.enum([
    'subtitle-main',     // 主字幕位置：底部 8%
    'subtitle-keyword',  // 关键词位置：底部 18%（主字幕上方）
    'center', 
    'bottom', 
    'top', 
    'left', 
    'right', 
    'bottom-left', 
    'bottom-right'
  ]),
  style: z.object({
    fontSize: z.number(),
    color: z.string(),
    fontWeight: z.string().optional(),
    backgroundColor: z.string().optional(),
  }),
  // ★ 新增：关键词高亮的关联主字幕（用于同步显示）
  linkedSubtitleId: z.string().optional(),
});

// B-Roll 组件
// ★ display_mode 只有两种：fullscreen（全屏覆盖）或 pip（部分位置/小窗）
export const BRollComponentSchema = z.object({
  id: z.string(),
  type: z.literal('broll'),
  start_ms: z.number(),
  end_ms: z.number(),
  search_keywords: z.array(z.string()),
  display_mode: z.enum(['fullscreen', 'pip']),  // ★ 只有两种模式
  transition_in: z.enum(['fade', 'slide', 'zoom', 'none']),
  transition_out: z.enum(['fade', 'slide', 'zoom', 'none']),
  asset_url: z.string().optional(),
  asset_id: z.string().optional(),
});

// 章节组件
export const ChapterComponentSchema = z.object({
  id: z.string(),
  type: z.literal('chapter'),
  start_ms: z.number(),
  end_ms: z.number(),
  title: z.string(),
  subtitle: z.string().optional(),
  style: z.enum(['minimal', 'bold', 'cinematic']),
});

// 完整配置
export const RemotionConfigSchema = z.object({
  version: z.string(),
  total_duration_ms: z.number(),
  fps: z.number(),
  theme: z.enum(['minimalist', 'dynamic', 'cinematic', 'vlog']),
  color_palette: z.array(z.string()),
  font_family: z.string(),
  text_components: z.array(TextComponentSchema),
  broll_components: z.array(BRollComponentSchema),
  chapter_components: z.array(ChapterComponentSchema),
});

// PiP 配置
export const PipConfigSchema = z.object({
  enabled: z.boolean(),
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
  size: z.enum(['small', 'medium', 'large']),
});

// 合成 Props
export const RemotionConfigCompositionPropsSchema = z.object({
  mainVideoUrl: z.string(),
  config: RemotionConfigSchema,
  pip: PipConfigSchema,
  width: z.number(),
  height: z.number(),
});

export type TextComponent = z.infer<typeof TextComponentSchema>;
export type BRollComponent = z.infer<typeof BRollComponentSchema>;
export type ChapterComponent = z.infer<typeof ChapterComponentSchema>;
export type RemotionConfig = z.infer<typeof RemotionConfigSchema>;
export type PipConfig = z.infer<typeof PipConfigSchema>;
export type RemotionConfigCompositionProps = z.infer<typeof RemotionConfigCompositionPropsSchema>;

// ============================================
// 辅助组件
// ============================================

// ============================================
// 抖音风格位置系统
// ============================================
// 参考抖音/小红书字幕布局：
// - 主字幕：底部 6-10%，居中，大字
// - 关键词：主字幕上方约 10%，通常右侧偏移
// - 抖音互动按钮区域在右侧 15%，字幕要避开

function getPositionStyle(position: string): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px',
  };
  
  switch (position) {
    // ★ 抖音风格：主字幕位置（底部 8%，居中，避开右侧互动按钮）
    case 'subtitle-main':
      return { 
        ...base, 
        bottom: '8%', 
        left: '5%',           // 左边留 5%
        right: '18%',         // 右边留 18%（避开点赞等按钮）
        justifyContent: 'center',
      };
    
    // ★ 抖音风格：关键词位置（主字幕上方，右侧偏移）
    case 'subtitle-keyword':
      return { 
        ...base, 
        bottom: '18%',        // 主字幕上方约 10%
        right: '18%',         // 右侧对齐
        justifyContent: 'flex-end',
      };
    
    case 'center':
      return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    case 'top':
      return { ...base, top: '8%', left: '50%', transform: 'translateX(-50%)' };
    case 'bottom':
      return { ...base, bottom: '8%', left: '5%', right: '18%', justifyContent: 'center' };
    case 'left':
      return { ...base, top: '50%', left: '5%', transform: 'translateY(-50%)' };
    case 'right':
      return { ...base, top: '50%', right: '18%', transform: 'translateY(-50%)' };
    case 'bottom-left':
      return { ...base, bottom: '8%', left: '5%' };
    case 'bottom-right':
      return { ...base, bottom: '18%', right: '18%' };
    default:
      return { ...base, bottom: '8%', left: '5%', right: '18%', justifyContent: 'center' };
  }
}

// ============================================
// 抖音风格字幕组件
// ============================================

// ★★★ 主字幕组件（抖音风格：大字、彩色、白描边）★★★
function MainSubtitle({
  component,
  fps,
  fontFamily,
}: {
  component: TextComponent;
  fps: number;
  fontFamily: string;
}) {
  const frame = useCurrentFrame();
  const durationFrames = ((component.end_ms - component.start_ms) / 1000) * fps;
  
  // 入场动画：从下方滑入
  const enterFrames = Math.min(8, durationFrames * 0.15);
  const exitFrames = Math.min(8, durationFrames * 0.15);
  
  const enterProgress = Math.min(1, frame / enterFrames);
  const exitProgress = Math.max(0, (frame - (durationFrames - exitFrames)) / exitFrames);
  
  const y = (1 - enterProgress) * 30 + exitProgress * -20;
  const opacity = Math.min(enterProgress, 1 - exitProgress);
  
  // 主字幕颜色（支持渐变）
  const textColor = component.style.color || '#FF6B35';  // 默认橙红色
  
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '8%',
        left: '5%',
        right: '18%',  // 避开抖音右侧互动按钮
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      <span
        style={{
          fontFamily,
          fontSize: component.style.fontSize || 52,
          fontWeight: component.style.fontWeight || '900',
          color: textColor,
          textAlign: 'center',
          lineHeight: 1.3,
          letterSpacing: '0.02em',
          // ★★★ 抖音风格核心：白色粗描边 ★★★
          WebkitTextStroke: '3px white',
          paintOrder: 'stroke fill',  // 描边在填充下面
          // 额外阴影增强立体感
          textShadow: `
            0 0 8px rgba(0,0,0,0.5),
            0 4px 12px rgba(0,0,0,0.4)
          `,
          // 抗锯齿
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        }}
      >
        {component.text}
      </span>
    </div>
  );
}

// ★★★ 关键词高亮组件（蓝色背景框）★★★
function KeywordHighlight({
  component,
  fps,
  fontFamily,
}: {
  component: TextComponent;
  fps: number;
  fontFamily: string;
}) {
  const frame = useCurrentFrame();
  const durationFrames = ((component.end_ms - component.start_ms) / 1000) * fps;
  
  // 弹性入场
  const springValue = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 180 },
  });
  
  // 淡出
  const exitFrames = Math.min(10, durationFrames * 0.2);
  const exitProgress = Math.max(0, (frame - (durationFrames - exitFrames)) / exitFrames);
  const opacity = Math.min(springValue, 1 - exitProgress);
  const scale = 0.8 + springValue * 0.2;
  
  // 背景颜色（默认蓝色）
  const bgColor = component.style.backgroundColor || 'rgba(59, 130, 246, 0.95)';  // 蓝色
  
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '18%',          // 主字幕上方
        right: '18%',           // 右侧对齐（避开互动按钮）
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          background: bgColor,
          padding: '10px 20px',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {/* 可选图标 */}
        <span style={{ fontSize: 18 }}>🔄</span>
        <span
          style={{
            fontFamily,
            fontSize: component.style.fontSize || 24,
            fontWeight: component.style.fontWeight || '600',
            color: component.style.color || '#FFFFFF',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          {component.text}
        </span>
      </div>
    </div>
  );
}

// 通用文字动画组件（处理其他动画类型）
function AnimatedText({
  component,
  fps,
  fontFamily = 'Noto Sans SC, Inter, system-ui, sans-serif',
}: {
  component: TextComponent;
  fps: number;
  fontFamily?: string;
}) {
  // ★ 根据动画类型分发到专用组件
  if (component.animation === 'main-subtitle') {
    return <MainSubtitle component={component} fps={fps} fontFamily={fontFamily} />;
  }
  
  if (component.animation === 'keyword-highlight') {
    return <KeywordHighlight component={component} fps={fps} fontFamily={fontFamily} />;
  }
  
  const frame = useCurrentFrame();
  const durationFrames = ((component.end_ms - component.start_ms) / 1000) * fps;
  const progress = frame / durationFrames;
  
  // 根据动画类型计算样式
  let opacity = 1;
  let transform = 'none';
  let clipPath = 'none';
  let highlightWidth = '0%';
  let scale = 1;
  
  // 通用淡出逻辑
  const fadeOutStart = durationFrames - 15;
  const shouldFadeOut = frame > fadeOutStart && durationFrames > 30;
  
  switch (component.animation) {
    case 'fade-in': {
      const fadeFrames = Math.min(15, durationFrames * 0.3);
      opacity = interpolate(frame, [0, fadeFrames], [0, 1], { extrapolateRight: 'clamp' });
      if (shouldFadeOut) {
        opacity = interpolate(frame, [fadeOutStart, durationFrames], [1, 0], { extrapolateRight: 'clamp' });
      }
      break;
    }
    case 'slide-up': {
      const slideFrames = Math.min(20, durationFrames * 0.3);
      const y = interpolate(frame, [0, slideFrames], [50, 0], { extrapolateRight: 'clamp' });
      opacity = interpolate(frame, [0, slideFrames], [0, 1], { extrapolateRight: 'clamp' });
      transform = `translateY(${y}px)`;
      if (shouldFadeOut) {
        const slideOutY = interpolate(frame, [fadeOutStart, durationFrames], [0, -30], { extrapolateRight: 'clamp' });
        opacity = interpolate(frame, [fadeOutStart, durationFrames], [1, 0], { extrapolateRight: 'clamp' });
        transform = `translateY(${slideOutY}px)`;
      }
      break;
    }
    case 'typewriter': {
      const chars = component.text.length;
      const visibleChars = Math.floor(interpolate(frame, [0, durationFrames * 0.6], [0, chars], { extrapolateRight: 'clamp' }));
      clipPath = `inset(0 ${100 - (visibleChars / chars) * 100}% 0 0)`;
      if (shouldFadeOut) {
        opacity = interpolate(frame, [fadeOutStart, durationFrames], [1, 0], { extrapolateRight: 'clamp' });
      }
      break;
    }
    case 'highlight': {
      // 高亮动画：带背景色的弹入效果
      const highlightSpring = spring({
        frame,
        fps,
        config: { damping: 12, stiffness: 150 },
      });
      scale = interpolate(highlightSpring, [0, 1], [0.8, 1]);
      opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
      highlightWidth = `${highlightSpring * 100}%`;
      if (shouldFadeOut) {
        opacity = interpolate(frame, [fadeOutStart, durationFrames], [1, 0], { extrapolateRight: 'clamp' });
      }
      break;
    }
    case 'zoom-in': {
      // 缩放动画：从小到大弹性效果
      const zoomSpring = spring({
        frame,
        fps,
        config: { damping: 15, stiffness: 120 },
      });
      scale = interpolate(zoomSpring, [0, 1], [0.3, 1]);
      opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
      transform = `scale(${scale})`;
      if (shouldFadeOut) {
        const outScale = interpolate(frame, [fadeOutStart, durationFrames], [1, 1.2], { extrapolateRight: 'clamp' });
        opacity = interpolate(frame, [fadeOutStart, durationFrames], [1, 0], { extrapolateRight: 'clamp' });
        transform = `scale(${outScale})`;
      }
      break;
    }
    case 'bounce': {
      const bounceValue = spring({
        frame,
        fps,
        config: { damping: 10, stiffness: 100 },
      });
      transform = `scale(${bounceValue})`;
      if (shouldFadeOut) {
        opacity = interpolate(frame, [fadeOutStart, durationFrames], [1, 0], { extrapolateRight: 'clamp' });
      }
      break;
    }
    default:
      break;
  }
  
  const positionStyle = getPositionStyle(component.position);
  
  // 高亮动画特殊处理背景
  const isHighlight = component.animation === 'highlight';
  const bgColor = isHighlight 
    ? (component.style.backgroundColor || 'linear-gradient(135deg, rgba(251, 191, 36, 0.95) 0%, rgba(245, 158, 11, 0.95) 100%)') 
    : (component.style.backgroundColor || 'transparent');
  
  // ★ 增强文字样式：根据背景计算最佳效果
  const hasBackground = component.style.backgroundColor || isHighlight;
  
  // ★ 双重描边 + 发光效果 (适用于无背景文字)
  const enhancedTextShadow = hasBackground 
    ? 'none' 
    : `
      /* 内描边 */
      -1px -1px 0 rgba(0,0,0,0.8),
       1px -1px 0 rgba(0,0,0,0.8),
      -1px  1px 0 rgba(0,0,0,0.8),
       1px  1px 0 rgba(0,0,0,0.8),
      /* 外发光 */
      0 0 10px rgba(0,0,0,0.6),
      0 0 20px rgba(0,0,0,0.4),
      /* 底部阴影 */
      0 4px 8px rgba(0,0,0,0.5)
    `;
  
  return (
    <div
      style={{
        ...positionStyle,
        opacity,
        transform: isHighlight ? `scale(${scale})` : transform,
        clipPath,
      }}
    >
      <span
        style={{
          fontFamily,
          fontSize: component.style.fontSize,
          color: component.style.color,
          fontWeight: component.style.fontWeight || '700',
          background: isHighlight ? bgColor : (hasBackground ? component.style.backgroundColor : 'transparent'),
          padding: isHighlight ? '16px 32px' : (hasBackground ? '10px 20px' : '4px 8px'),
          borderRadius: isHighlight ? '16px' : (hasBackground ? '12px' : '0'),
          textAlign: 'center',
          maxWidth: '85%',
          lineHeight: 1.5,
          letterSpacing: '0.02em',
          // ★ 增强视觉效果
          boxShadow: isHighlight 
            ? '0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.2)' 
            : (hasBackground ? '0 4px 16px rgba(0,0,0,0.25)' : 'none'),
          textShadow: enhancedTextShadow,
          // ★ 抗锯齿
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          // ★ 高亮动画特效
          ...(isHighlight && {
            border: '2px solid rgba(255,255,255,0.3)',
            backdropFilter: 'blur(4px)',
          }),
        }}
      >
        {component.text}
      </span>
    </div>
  );
}

// B-Roll 视频组件
// ★ 只有两种显示模式：fullscreen（全屏覆盖）或 pip（部分位置）
function BRollVideo({
  component,
  mainVideoUrl,
  pip,
  fps,
}: {
  component: BRollComponent;
  mainVideoUrl: string;
  pip: PipConfig;
  fps: number;
}) {
  const frame = useCurrentFrame();
  const durationFrames = ((component.end_ms - component.start_ms) / 1000) * fps;
  
  // 过渡动画
  let opacity = 1;
  const transitionFrames = Math.min(15, durationFrames * 0.2);
  
  // 淡入
  if (component.transition_in === 'fade') {
    opacity = interpolate(frame, [0, transitionFrames], [0, 1], { extrapolateRight: 'clamp' });
  }
  
  // 淡出
  if (component.transition_out === 'fade') {
    const fadeOutStart = durationFrames - transitionFrames;
    if (frame > fadeOutStart) {
      opacity = interpolate(frame, [fadeOutStart, durationFrames], [1, 0], { extrapolateRight: 'clamp' });
    }
  }
  
  // ★★★ 没有素材 URL 就不渲染任何东西 ★★★
  // 完全隔离，不显示加载状态、不显示占位符
  if (!component.asset_url) {
    return null;
  }
  
  // ★★★ 只有两种模式 ★★★
  // 1. fullscreen: B-Roll 全屏覆盖，主视频变 PiP（如果启用）
  // 2. pip: B-Roll 作为小窗出现在屏幕角落
  
  const isFullscreen = component.display_mode === 'fullscreen';
  
  if (isFullscreen) {
    // 全屏模式：B-Roll 覆盖整个屏幕
    return (
      <AbsoluteFill style={{ opacity }}>
        <OffthreadVideo
          src={component.asset_url}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {/* 主视频变成 PiP 小窗（如果启用） */}
        {pip.enabled && (
          <PipWindow mainVideoUrl={mainVideoUrl} pip={pip} />
        )}
      </AbsoluteFill>
    );
  }
  
  // PiP 模式：B-Roll 作为小窗
  return (
    <div
      style={{
        position: 'absolute',
        ...getPipPosition(pip.position, pip.size),
        opacity,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        border: '2px solid rgba(255,255,255,0.2)',
      }}
    >
      <OffthreadVideo
        src={component.asset_url}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  );
}

// PiP 窗口位置计算
function getPipPosition(position: string, size: string): React.CSSProperties {
  const sizeMap = { small: 20, medium: 25, large: 30 };
  const sizePercent = sizeMap[size as keyof typeof sizeMap] || 25;
  const margin = 20;
  
  const base: React.CSSProperties = {
    width: `${sizePercent}%`,
    aspectRatio: '9/16',
  };
  
  switch (position) {
    case 'top-left':
      return { ...base, top: margin, left: margin };
    case 'top-right':
      return { ...base, top: margin, right: margin };
    case 'bottom-left':
      return { ...base, bottom: margin, left: margin };
    case 'bottom-right':
    default:
      return { ...base, bottom: margin, right: margin };
  }
}

// PiP 窗口组件
function PipWindow({
  mainVideoUrl,
  pip,
}: {
  mainVideoUrl: string;
  pip: PipConfig;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        ...getPipPosition(pip.position, pip.size),
        borderRadius: 12,
        overflow: 'hidden',
        border: '2px solid white',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      <OffthreadVideo
        src={mainVideoUrl}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  );
}

// 章节标题组件 - 仅在 B-Roll 小窗上显示标签
function ChapterTitle({
  component,
  fps,
}: {
  component: ChapterComponent;
  fps: number;
  theme: string;
  colorPalette: string[];
}) {
  const frame = useCurrentFrame();
  const durationFrames = ((component.end_ms - component.start_ms) / 1000) * fps;
  
  // 动画
  const progress = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 80 },
  });
  
  const opacity = interpolate(frame, [0, 10, durationFrames - 10, durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  
  // 不再全屏遮罩，改为底部小标签（增强版）
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 100,
        left: '50%',
        transform: `translateX(-50%) translateY(${(1 - progress) * 20}px)`,
        opacity,
        zIndex: 10,
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
          padding: '20px 40px',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
          backdropFilter: 'blur(12px)',
          textAlign: 'center',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <h1
          style={{
            fontFamily: 'Noto Sans SC, Inter, system-ui',
            fontSize: 42,
            fontWeight: '700',
            color: '#ffffff',
            margin: 0,
            marginBottom: component.subtitle ? 8 : 0,
            textShadow: '0 2px 8px rgba(0,0,0,0.4)',
            letterSpacing: '0.02em',
            // 增强可读性
            WebkitFontSmoothing: 'antialiased',
          }}
        >
          {component.title}
        </h1>
        {component.subtitle && (
          <p
            style={{
              fontFamily: 'Noto Sans SC, Inter, system-ui',
              fontSize: 20,
              color: 'rgba(148, 163, 184, 0.95)',
              margin: 0,
              fontWeight: '400',
            }}
          >
            {component.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================
// 主合成组件
// ============================================

export function RemotionConfigComposition({
  mainVideoUrl,
  config,
  pip,
  width,
  height,
}: RemotionConfigCompositionProps) {
  const { fps, durationInFrames } = useVideoConfig();
  
  // 没有 B-Roll 显示时，是否显示主视频
  const activeBrolls = config.broll_components.filter(b => b.asset_url);
  
  // ★ 配置字体（优先使用配置中的字体，回退到 Noto Sans SC）
  const fontFamily = `${config.font_family || 'Noto Sans SC'}, Inter, system-ui, sans-serif`;
  
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* 主视频层 */}
      <AbsoluteFill>
        <OffthreadVideo
          src={mainVideoUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>
      
      {/* B-Roll 层 */}
      {config.broll_components.map((broll) => {
        const startFrame = Math.floor((broll.start_ms / 1000) * fps);
        const durationFrames = Math.ceil(((broll.end_ms - broll.start_ms) / 1000) * fps);
        
        return (
          <Sequence key={broll.id} from={startFrame} durationInFrames={durationFrames}>
            <BRollVideo
              component={broll}
              mainVideoUrl={mainVideoUrl}
              pip={pip}
              fps={fps}
            />
          </Sequence>
        );
      })}
      
      {/* 章节标题层 */}
      {config.chapter_components.map((chapter) => {
        const startFrame = Math.floor((chapter.start_ms / 1000) * fps);
        const durationFrames = Math.ceil(((chapter.end_ms - chapter.start_ms) / 1000) * fps);
        
        return (
          <Sequence key={chapter.id} from={startFrame} durationInFrames={durationFrames}>
            <ChapterTitle
              component={chapter}
              fps={fps}
              theme={config.theme}
              colorPalette={config.color_palette}
            />
          </Sequence>
        );
      })}
      
      {/* 文字动画层 */}
      {config.text_components.map((text) => {
        const startFrame = Math.floor((text.start_ms / 1000) * fps);
        const durationFrames = Math.ceil(((text.end_ms - text.start_ms) / 1000) * fps);
        
        return (
          <Sequence key={text.id} from={startFrame} durationInFrames={durationFrames}>
            <AnimatedText 
              component={text} 
              fps={fps} 
              fontFamily={fontFamily}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

export default RemotionConfigComposition;
