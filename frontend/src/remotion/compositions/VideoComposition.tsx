/**
 * 视频合成组件
 * 将编辑器的 clips/tracks 数据渲染为视频
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
} from 'remotion';
import { z } from 'zod';

// ============================================
// 类型定义 (与编辑器 Clip 类型对应)
// ============================================

export const ClipDataSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  clipType: z.enum(['video', 'audio', 'image', 'text', 'subtitle']),
  start: z.number(), // 时间线位置 (ms)
  duration: z.number(), // 持续时间 (ms)
  sourceStart: z.number().optional(), // 媒体内部起始点 (ms)
  originDuration: z.number().optional(), // 原始时长 (ms)
  
  // 媒体 URL
  sourceUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  
  // 变换属性
  transform: z.object({
    x: z.number(),
    y: z.number(),
    scale: z.number(),
    rotation: z.number(),
    opacity: z.number(),
  }).optional(),
  
  // ★★★ B-Roll metadata（包含 letterbox 信息）★★★
  metadata: z.object({
    is_broll: z.boolean().optional(),
    letterbox_params: z.object({
      video_width: z.number(),
      video_height: z.number(),
      padding_top: z.number(),
      padding_bottom: z.number(),
      background_color: z.string(),
    }).optional(),
  }).optional(),
  
  // 文字属性
  text: z.string().optional(),
  fontSize: z.number().optional(),
  fontColor: z.string().optional(),
  fontFamily: z.string().optional(),
  
  // 淡入淡出
  fadeIn: z.number().optional(), // ms
  fadeOut: z.number().optional(), // ms
  
  // 音量 (0-1)
  volume: z.number().optional(),
});

export const TrackDataSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.enum(['video', 'audio', 'text', 'subtitle']).optional(),
  orderIndex: z.number(),
  muted: z.boolean().optional(),
  visible: z.boolean().optional(),
});

export const VideoCompositionSchema = z.object({
  clips: z.array(ClipDataSchema),
  tracks: z.array(TrackDataSchema),
  duration: z.number(), // 总时长 (ms)
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  backgroundColor: z.string().optional(),
});

export type ClipData = z.infer<typeof ClipDataSchema>;
export type TrackData = z.infer<typeof TrackDataSchema>;
export type VideoCompositionProps = z.infer<typeof VideoCompositionSchema>;

// ============================================
// 辅助函数
// ============================================

/** 毫秒转帧数 */
function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

/** 计算淡入淡出透明度 */
function calculateFadeOpacity(
  frame: number,
  startFrame: number,
  durationFrames: number,
  fadeInFrames: number,
  fadeOutFrames: number,
): number {
  const localFrame = frame - startFrame;
  
  // 淡入
  if (fadeInFrames > 0 && localFrame < fadeInFrames) {
    return interpolate(localFrame, [0, fadeInFrames], [0, 1], {
      extrapolateRight: 'clamp',
    });
  }
  
  // 淡出
  const fadeOutStart = durationFrames - fadeOutFrames;
  if (fadeOutFrames > 0 && localFrame > fadeOutStart) {
    return interpolate(localFrame, [fadeOutStart, durationFrames], [1, 0], {
      extrapolateLeft: 'clamp',
    });
  }
  
  return 1;
}

// ============================================
// 片段渲染组件
// ============================================

interface ClipRendererProps {
  clip: ClipData;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
}

function VideoClip({ clip, fps, canvasWidth, canvasHeight }: ClipRendererProps) {
  const frame = useCurrentFrame();
  const startFrame = msToFrames(clip.start, fps);
  const durationFrames = msToFrames(clip.duration, fps);
  
  const fadeInFrames = msToFrames(clip.fadeIn || 0, fps);
  const fadeOutFrames = msToFrames(clip.fadeOut || 0, fps);
  const opacity = calculateFadeOpacity(frame, startFrame, durationFrames, fadeInFrames, fadeOutFrames);
  
  // 变换
  const transform = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
  const finalOpacity = opacity * (transform.opacity ?? 1);
  
  // 媒体内部时间
  const startFromSec = (clip.sourceStart || 0) / 1000;
  
  if (!clip.sourceUrl) {
    return null;
  }
  
  // ★★★ B-Roll Letterbox 处理 ★★★
  const metadata = clip.metadata;
  const isBroll = metadata?.is_broll;
  const letterboxParams = metadata?.letterbox_params;
  
  // 如果是 B-Roll 且有 letterbox 参数，添加黑色背景
  if (isBroll && letterboxParams) {
    const { padding_top, padding_bottom, background_color } = letterboxParams;
    const paddingTopPercent = (padding_top / canvasHeight) * 100;
    const paddingBottomPercent = (padding_bottom / canvasHeight) * 100;
    const videoHeightPercent = 100 - paddingTopPercent - paddingBottomPercent;
    
    return (
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          backgroundColor: background_color || '#000000',  // ★ 黑色背景
          opacity: finalOpacity,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
        }}
      >
        {/* 视频居中显示，上下留黑边 */}
        <div
          style={{
            position: 'absolute',
            top: `${paddingTopPercent}%`,
            left: 0,
            width: '100%',
            height: `${videoHeightPercent}%`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Video
            src={clip.sourceUrl}
            startFrom={startFromSec * fps}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',  // ★ cover 填满区域
            }}
            volume={clip.volume ?? 1}
          />
        </div>
      </div>
    );
  }
  
  // 普通视频（非 B-Roll）
  return (
    <div
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: finalOpacity,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
      }}
    >
      <Video
        src={clip.sourceUrl}
        startFrom={startFromSec * fps}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
        }}
        volume={clip.volume ?? 1}
      />
    </div>
  );
}

function ImageClip({ clip, fps }: ClipRendererProps) {
  const frame = useCurrentFrame();
  const startFrame = msToFrames(clip.start, fps);
  const durationFrames = msToFrames(clip.duration, fps);
  
  const fadeInFrames = msToFrames(clip.fadeIn || 0, fps);
  const fadeOutFrames = msToFrames(clip.fadeOut || 0, fps);
  const opacity = calculateFadeOpacity(frame, startFrame, durationFrames, fadeInFrames, fadeOutFrames);
  
  const transform = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
  const finalOpacity = opacity * (transform.opacity ?? 1);
  
  if (!clip.sourceUrl) {
    return null;
  }
  
  return (
    <div
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: finalOpacity,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
      }}
    >
      <Img
        src={clip.sourceUrl}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
        }}
      />
    </div>
  );
}

function AudioClip({ clip, fps }: ClipRendererProps) {
  const startFromSec = (clip.sourceStart || 0) / 1000;
  
  if (!clip.sourceUrl) {
    return null;
  }
  
  return (
    <Audio
      src={clip.sourceUrl}
      startFrom={startFromSec * fps}
      volume={clip.volume ?? 1}
    />
  );
}

function TextClip({ clip, fps, canvasWidth, canvasHeight }: ClipRendererProps) {
  const frame = useCurrentFrame();
  const startFrame = msToFrames(clip.start, fps);
  const durationFrames = msToFrames(clip.duration, fps);
  
  const fadeInFrames = msToFrames(clip.fadeIn || 0, fps);
  const fadeOutFrames = msToFrames(clip.fadeOut || 0, fps);
  const opacity = calculateFadeOpacity(frame, startFrame, durationFrames, fadeInFrames, fadeOutFrames);
  
  const transform = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
  const finalOpacity = opacity * (transform.opacity ?? 1);
  
  return (
    <div
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: finalOpacity,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
      }}
    >
      <p
        style={{
          fontSize: clip.fontSize || 48,
          color: clip.fontColor || '#ffffff',
          fontFamily: clip.fontFamily || 'sans-serif',
          textAlign: 'center',
          textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
          margin: 0,
          padding: '0 20px',
          wordBreak: 'break-word',
        }}
      >
        {clip.text || ''}
      </p>
    </div>
  );
}

function SubtitleClip({ clip, fps, canvasWidth, canvasHeight }: ClipRendererProps) {
  const frame = useCurrentFrame();
  const startFrame = msToFrames(clip.start, fps);
  const durationFrames = msToFrames(clip.duration, fps);
  
  const fadeInFrames = msToFrames(clip.fadeIn || 0, fps);
  const fadeOutFrames = msToFrames(clip.fadeOut || 0, fps);
  const opacity = calculateFadeOpacity(frame, startFrame, durationFrames, fadeInFrames, fadeOutFrames);
  
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 60,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity,
      }}
    >
      <p
        style={{
          fontSize: clip.fontSize || 32,
          color: clip.fontColor || '#ffffff',
          fontFamily: clip.fontFamily || 'sans-serif',
          textAlign: 'center',
          backgroundColor: 'rgba(0,0,0,0.7)',
          padding: '8px 16px',
          borderRadius: 4,
          margin: 0,
          maxWidth: '90%',
        }}
      >
        {clip.text || ''}
      </p>
    </div>
  );
}

// ============================================
// 主合成组件
// ============================================

export const VideoComposition: React.FC<VideoCompositionProps> = ({
  clips,
  tracks,
  duration,
  width,
  height,
  fps,
  backgroundColor = '#000000',
}) => {
  const { fps: configFps } = useVideoConfig();
  const effectiveFps = fps || configFps;
  
  // ★★★ 渲染层级优先级（数字越大越在上面）★★★
  // 层级设计：主视频 → B-Roll → 图片 → 文本/字幕（字幕永远在最上层）
  const getClipLayerPriority = (clip: ClipData): number => {
    const isBroll = clip.metadata?.is_broll;
    
    switch (clip.clipType) {
      case 'video':
        // B-Roll 在主视频之上，但在文本/字幕之下
        return isBroll ? 10 : 0;
      case 'audio':
        return 0; // 音频不可见，层级无所谓
      case 'image':
        return 20; // 图片在 B-Roll 之上
      case 'text':
        return 100; // 文本在最上层
      case 'subtitle':
        return 100; // 字幕在最上层
      default:
        return 50;
    }
  };
  
  // 按【类型优先级 + 轨道 orderIndex】排序
  // 优先级：clipType layer priority > track orderIndex
  const trackOrderMap = new Map(tracks.map(t => [t.id, t.orderIndex]));
  const sortedClips = [...clips].sort((a, b) => {
    const priorityA = getClipLayerPriority(a);
    const priorityB = getClipLayerPriority(b);
    
    // 1. 先按类型优先级排序
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // 2. 同优先级内，按轨道 orderIndex 排序
    const orderA = trackOrderMap.get(a.trackId) ?? 0;
    const orderB = trackOrderMap.get(b.trackId) ?? 0;
    return orderA - orderB;
  });
  
  // 获取轨道静音/可见状态
  const trackStateMap = new Map(tracks.map(t => [t.id, { muted: t.muted, visible: t.visible !== false }]));
  
  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {sortedClips.map((clip) => {
        const trackState = trackStateMap.get(clip.trackId);
        
        // 检查轨道是否可见
        if (!trackState?.visible) {
          return null;
        }
        
        const startFrame = msToFrames(clip.start, effectiveFps);
        const durationFrames = msToFrames(clip.duration, effectiveFps);
        
        // 音频轨道静音处理
        const effectiveClip = { 
          ...clip,
          volume: trackState?.muted ? 0 : (clip.volume ?? 1),
        };
        
        return (
          <Sequence
            key={clip.id}
            from={startFrame}
            durationInFrames={durationFrames}
            name={`${clip.clipType}-${clip.id.slice(0, 8)}`}
          >
            {clip.clipType === 'video' && (
              <VideoClip clip={effectiveClip} fps={effectiveFps} canvasWidth={width} canvasHeight={height} />
            )}
            {clip.clipType === 'audio' && (
              <AudioClip clip={effectiveClip} fps={effectiveFps} canvasWidth={width} canvasHeight={height} />
            )}
            {clip.clipType === 'image' && (
              <ImageClip clip={effectiveClip} fps={effectiveFps} canvasWidth={width} canvasHeight={height} />
            )}
            {clip.clipType === 'text' && (
              <TextClip clip={effectiveClip} fps={effectiveFps} canvasWidth={width} canvasHeight={height} />
            )}
            {clip.clipType === 'subtitle' && (
              <SubtitleClip clip={effectiveClip} fps={effectiveFps} canvasWidth={width} canvasHeight={height} />
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
