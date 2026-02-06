/**
 * B-Roll 视频合成组件
 * 
 * 用于渲染口播视频 + B-Roll 叠加效果
 * 支持：
 * - 主口播视频作为背景/PiP
 * - B-Roll 片段在指定时间范围内叠加
 * - 字幕渲染
 * - 画中画（PiP）模式
 */
import {
  AbsoluteFill,
  Sequence,
  Video,
  Audio,
  Img,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  OffthreadVideo,
} from 'remotion';
import { z } from 'zod';

// ============================================
// 类型定义
// ============================================

// B-Roll 片段
export const BRollClipSchema = z.object({
  id: z.string(),
  clipNumber: z.number(),
  text: z.string(), // 对应的口播文字
  timeRange: z.object({
    start: z.number(), // ms
    end: z.number(),   // ms
  }),
  brollUrl: z.string().optional(), // B-Roll 视频 URL
  brollThumbnail: z.string().optional(),
  source: z.enum(['pexels', 'local', 'ai-generated']).optional(),
});

// 字幕
export const SubtitleSchema = z.object({
  id: z.string(),
  text: z.string(),
  start: z.number(), // ms
  end: z.number(),   // ms
});

// PiP 配置
export const PipConfigSchema = z.object({
  enabled: z.boolean(),
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
  size: z.enum(['small', 'medium', 'large']), // 10%, 15%, 20% of canvas
  borderRadius: z.number().optional(), // 圆角
  borderWidth: z.number().optional(),
  borderColor: z.string().optional(),
});

// 主合成 Props
export const BRollCompositionSchema = z.object({
  // 源视频
  mainVideoUrl: z.string(),
  mainAudioUrl: z.string().optional(), // 如果音频分离
  
  // B-Roll 片段列表
  brollClips: z.array(BRollClipSchema),
  
  // 字幕
  subtitles: z.array(SubtitleSchema).optional(),
  
  // 画中画配置
  pip: PipConfigSchema,
  
  // 视频配置
  duration: z.number(), // 总时长 ms
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  
  // 样式
  backgroundColor: z.string().optional(),
  subtitleStyle: z.object({
    fontSize: z.number().optional(),
    fontColor: z.string().optional(),
    fontFamily: z.string().optional(),
    backgroundColor: z.string().optional(),
    position: z.enum(['bottom', 'top', 'center']).optional(),
  }).optional(),
});

export type BRollClip = z.infer<typeof BRollClipSchema>;
export type Subtitle = z.infer<typeof SubtitleSchema>;
export type PipConfig = z.infer<typeof PipConfigSchema>;
export type BRollCompositionProps = z.infer<typeof BRollCompositionSchema>;

// ============================================
// 辅助函数
// ============================================

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

// PiP 尺寸映射
const PIP_SIZE_MAP = {
  small: 0.15,   // 15% of canvas
  medium: 0.20,  // 20%
  large: 0.25,   // 25%
};

// PiP 位置计算
function getPipPosition(
  position: PipConfig['position'],
  canvasWidth: number,
  canvasHeight: number,
  pipWidth: number,
  pipHeight: number,
  padding: number = 20
): { x: number; y: number } {
  switch (position) {
    case 'top-left':
      return { x: padding, y: padding };
    case 'top-right':
      return { x: canvasWidth - pipWidth - padding, y: padding };
    case 'bottom-left':
      return { x: padding, y: canvasHeight - pipHeight - padding };
    case 'bottom-right':
    default:
      return { x: canvasWidth - pipWidth - padding, y: canvasHeight - pipHeight - padding };
  }
}

// ============================================
// 子组件
// ============================================

/** 主视频层（全屏或 PiP 模式） */
function MainVideoLayer({
  videoUrl,
  pip,
  canvasWidth,
  canvasHeight,
  isPipMode,
}: {
  videoUrl: string;
  pip: PipConfig;
  canvasWidth: number;
  canvasHeight: number;
  isPipMode: boolean;
}) {
  if (!isPipMode) {
    // 全屏模式
    return (
      <AbsoluteFill>
        <OffthreadVideo
          src={videoUrl}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </AbsoluteFill>
    );
  }

  // PiP 模式
  const sizeRatio = PIP_SIZE_MAP[pip.size];
  const pipWidth = canvasWidth * sizeRatio;
  const pipHeight = canvasHeight * sizeRatio;
  const { x, y } = getPipPosition(pip.position, canvasWidth, canvasHeight, pipWidth, pipHeight);

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: pipWidth,
        height: pipHeight,
        borderRadius: pip.borderRadius ?? 12,
        overflow: 'hidden',
        border: pip.borderWidth ? `${pip.borderWidth}px solid ${pip.borderColor || '#fff'}` : undefined,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        zIndex: 10,
      }}
    >
      <OffthreadVideo
        src={videoUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </div>
  );
}

/** B-Roll 视频层 */
function BRollLayer({
  brollUrl,
  fadeIn = 200,
  fadeOut = 200,
  fps,
  durationFrames,
}: {
  brollUrl: string;
  fadeIn?: number;
  fadeOut?: number;
  fps: number;
  durationFrames: number;
}) {
  const frame = useCurrentFrame();
  
  const fadeInFrames = msToFrames(fadeIn, fps);
  const fadeOutFrames = msToFrames(fadeOut, fps);
  
  // 计算淡入淡出透明度
  let opacity = 1;
  if (frame < fadeInFrames) {
    opacity = interpolate(frame, [0, fadeInFrames], [0, 1], { extrapolateRight: 'clamp' });
  } else if (frame > durationFrames - fadeOutFrames) {
    opacity = interpolate(frame, [durationFrames - fadeOutFrames, durationFrames], [1, 0], { extrapolateLeft: 'clamp' });
  }

  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo
        src={brollUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </AbsoluteFill>
  );
}

/** 字幕层 */
function SubtitleLayer({
  text,
  style,
  fps,
  durationFrames,
}: {
  text: string;
  style?: BRollCompositionProps['subtitleStyle'];
  fps: number;
  durationFrames: number;
}) {
  const frame = useCurrentFrame();
  
  // 淡入效果
  const fadeFrames = Math.min(5, durationFrames / 4);
  const opacity = interpolate(
    frame,
    [0, fadeFrames, durationFrames - fadeFrames, durationFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const position = style?.position || 'bottom';
  const positionStyle = {
    bottom: { bottom: 60, top: 'auto' },
    top: { top: 60, bottom: 'auto' },
    center: { top: '50%', transform: 'translateY(-50%)' },
  }[position];

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity,
        ...positionStyle,
      }}
    >
      <p
        style={{
          fontSize: style?.fontSize || 36,
          color: style?.fontColor || '#ffffff',
          fontFamily: style?.fontFamily || 'sans-serif',
          fontWeight: 600,
          textAlign: 'center',
          backgroundColor: style?.backgroundColor || 'rgba(0,0,0,0.7)',
          padding: '12px 24px',
          borderRadius: 8,
          margin: 0,
          maxWidth: '85%',
          textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
        }}
      >
        {text}
      </p>
    </div>
  );
}

// ============================================
// 主合成组件
// ============================================

export const BRollComposition: React.FC<BRollCompositionProps> = ({
  mainVideoUrl,
  mainAudioUrl,
  brollClips,
  subtitles = [],
  pip,
  duration,
  width,
  height,
  fps,
  backgroundColor = '#000000',
  subtitleStyle,
}) => {
  const frame = useCurrentFrame();
  const currentTimeMs = (frame / fps) * 1000;
  
  // 找到当前时间点的 B-Roll（如果有）
  const currentBRoll = brollClips.find(
    clip => clip.brollUrl && currentTimeMs >= clip.timeRange.start && currentTimeMs < clip.timeRange.end
  );
  
  // 是否处于 PiP 模式（有 B-Roll 在播放且 PiP 已启用）
  const isPipMode = pip.enabled && !!currentBRoll;

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {/* 层级从下到上：
          1. B-Roll 背景（当有 B-Roll 时）
          2. 主视频（全屏或 PiP）
          3. 字幕
      */}
      
      {/* B-Roll 层 */}
      {brollClips.map((clip) => {
        if (!clip.brollUrl) return null;
        
        const startFrame = msToFrames(clip.timeRange.start, fps);
        const endFrame = msToFrames(clip.timeRange.end, fps);
        const durationFrames = endFrame - startFrame;
        
        return (
          <Sequence
            key={clip.id}
            from={startFrame}
            durationInFrames={durationFrames}
            name={`broll-${clip.clipNumber}`}
          >
            <BRollLayer
              brollUrl={clip.brollUrl}
              fps={fps}
              durationFrames={durationFrames}
            />
          </Sequence>
        );
      })}
      
      {/* 主视频层 */}
      <MainVideoLayer
        videoUrl={mainVideoUrl}
        pip={pip}
        canvasWidth={width}
        canvasHeight={height}
        isPipMode={isPipMode}
      />
      
      {/* 音频层（如果分离） */}
      {mainAudioUrl && (
        <Audio src={mainAudioUrl} volume={1} />
      )}
      
      {/* 字幕层 */}
      {subtitles.map((subtitle) => {
        const startFrame = msToFrames(subtitle.start, fps);
        const endFrame = msToFrames(subtitle.end, fps);
        const durationFrames = endFrame - startFrame;
        
        return (
          <Sequence
            key={subtitle.id}
            from={startFrame}
            durationInFrames={durationFrames}
            name={`subtitle-${subtitle.id.slice(0, 8)}`}
          >
            <SubtitleLayer
              text={subtitle.text}
              style={subtitleStyle}
              fps={fps}
              durationFrames={durationFrames}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export default BRollComposition;
