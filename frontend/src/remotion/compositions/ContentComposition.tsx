/**
 * 内容可视化合成组件
 * 
 * 核心理念：按内容语义渲染，支持多种可视化类型
 * 不只是 B-Roll 叠加，而是智能的内容展示
 */
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  OffthreadVideo,
} from 'remotion';
import { z } from 'zod';
import type { 
  ContentSegment, 
  VisualizationType, 
  VisualizationConfig,
  ContentAnalysis,
} from '../types/content';

// ============================================
// Schema 定义
// ============================================

export const ContentCompositionSchema = z.object({
  mainVideoUrl: z.string(),
  segments: z.array(z.object({
    id: z.string(),
    segmentNumber: z.number(),
    timeRange: z.object({ start: z.number(), end: z.number() }),
    rawText: z.string(),
    content: z.object({
      topic: z.string(),
      summary: z.string(),
      keyPoints: z.array(z.string()),
      keywords: z.array(z.string()),
      sentiment: z.enum(['positive', 'neutral', 'negative', 'inspiring', 'warning']),
      highlightNumber: z.object({ value: z.string(), label: z.string() }).optional(),
      quote: z.string().optional(),
    }),
    visualization: z.object({
      type: z.string(),
      confidence: z.number(),
      config: z.any(),
    }),
    brollAsset: z.object({
      id: z.string(),
      url: z.string(),
      thumbnailUrl: z.string().optional(),
      source: z.string(),
    }).optional(),
  })),
  duration: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  showSubtitles: z.boolean().optional(),
  pipEnabled: z.boolean().optional(),
  pipPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  pipSize: z.enum(['small', 'medium', 'large']).optional(),
});

export type ContentCompositionProps = z.infer<typeof ContentCompositionSchema>;

// ============================================
// 辅助函数
// ============================================

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

const PIP_SIZE_MAP = { small: 0.15, medium: 0.20, large: 0.25 };

// ============================================
// 子组件：各种可视化类型
// ============================================

/** 纯口播模式 - 无叠加 */
function TalkingHeadMode({ videoUrl }: { videoUrl: string }) {
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={videoUrl}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  );
}

/** B-Roll 叠加模式 */
function BRollOverlayMode({
  mainVideoUrl,
  brollUrl,
  config,
  durationFrames,
  fps,
  canvasWidth,
  canvasHeight,
}: {
  mainVideoUrl: string;
  brollUrl: string;
  config: VisualizationConfig;
  durationFrames: number;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const frame = useCurrentFrame();
  const brollConfig = config.brollConfig || { 
    opacity: 1, 
    pipEnabled: true, 
    pipPosition: 'bottom-right' as const, 
    pipSize: 'medium' as const,
    fadeIn: 300,
    fadeOut: 300,
  };
  
  const fadeInFrames = msToFrames(brollConfig.fadeIn || 300, fps);
  const fadeOutFrames = msToFrames(brollConfig.fadeOut || 300, fps);
  
  // 淡入淡出
  let opacity = brollConfig.opacity;
  if (frame < fadeInFrames) {
    opacity = interpolate(frame, [0, fadeInFrames], [0, brollConfig.opacity]);
  } else if (frame > durationFrames - fadeOutFrames) {
    opacity = interpolate(frame, [durationFrames - fadeOutFrames, durationFrames], [brollConfig.opacity, 0]);
  }
  
  // PiP 位置计算
  const pipSize = PIP_SIZE_MAP[brollConfig.pipSize || 'medium'];
  const pipWidth = canvasWidth * pipSize;
  const pipHeight = canvasHeight * pipSize;
  const padding = 20;
  
  const pipPositions = {
    'top-left': { x: padding, y: padding },
    'top-right': { x: canvasWidth - pipWidth - padding, y: padding },
    'bottom-left': { x: padding, y: canvasHeight - pipHeight - padding },
    'bottom-right': { x: canvasWidth - pipWidth - padding, y: canvasHeight - pipHeight - padding },
  };
  const pipPos = pipPositions[brollConfig.pipPosition || 'bottom-right'];
  
  return (
    <AbsoluteFill>
      {/* B-Roll 背景 */}
      <AbsoluteFill style={{ opacity }}>
        <OffthreadVideo
          src={brollUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>
      
      {/* PiP 口播 */}
      {brollConfig.pipEnabled && (
        <div
          style={{
            position: 'absolute',
            left: pipPos.x,
            top: pipPos.y,
            width: pipWidth,
            height: pipHeight,
            borderRadius: 12,
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,0.8)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            zIndex: 10,
          }}
        >
          <OffthreadVideo
            src={mainVideoUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}
    </AbsoluteFill>
  );
}

/** 关键词高亮模式 */
function TextHighlightMode({
  keywords,
  config,
  durationFrames,
  fps,
}: {
  keywords: string[];
  config: VisualizationConfig;
  durationFrames: number;
  fps: number;
}) {
  const frame = useCurrentFrame();
  const { fps: configFps } = useVideoConfig();
  
  const textStyle = config.textStyle || {
    fontSize: 64,
    fontFamily: 'system-ui, sans-serif',
    color: '#ffffff',
    position: 'center' as const,
  };
  
  // 关键词逐个出现
  const keywordsToShow = keywords.slice(0, 3); // 最多显示3个
  const perKeywordFrames = Math.floor(durationFrames / (keywordsToShow.length || 1));
  
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
      }}
    >
      {keywordsToShow.map((keyword, index) => {
        const startFrame = index * perKeywordFrames;
        const progress = interpolate(
          frame - startFrame,
          [0, 15],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
        
        const scale = spring({
          frame: frame - startFrame,
          fps: configFps,
          config: { damping: 10, stiffness: 100 },
        });
        
        if (frame < startFrame) return null;
        
        return (
          <div
            key={keyword}
            style={{
              opacity: progress,
              transform: `scale(${scale})`,
              fontSize: textStyle.fontSize,
              fontFamily: textStyle.fontFamily,
              color: textStyle.color,
              fontWeight: 700,
              textShadow: '2px 2px 8px rgba(0,0,0,0.5)',
              backgroundColor: textStyle.backgroundColor || 'rgba(0,0,0,0.6)',
              padding: '12px 32px',
              borderRadius: 8,
            }}
          >
            {keyword}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/** 列表动画模式 */
function ListAnimationMode({
  keyPoints,
  topic,
  config,
  durationFrames,
  fps,
}: {
  keyPoints: string[];
  topic: string;
  config: VisualizationConfig;
  durationFrames: number;
  fps: number;
}) {
  const frame = useCurrentFrame();
  const { fps: configFps } = useVideoConfig();
  
  const listConfig = config.listConfig || {
    animationType: 'slide-up' as const,
    staggerDelay: 600,
    bulletStyle: 'check' as const,
  };
  
  const staggerFrames = msToFrames(listConfig.staggerDelay, fps);
  
  const bulletIcons = {
    number: (i: number) => `${i + 1}.`,
    dot: () => '•',
    check: () => '✓',
    arrow: () => '→',
  };
  
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 60px',
        backgroundColor: 'rgba(0,0,0,0.75)',
      }}
    >
      {/* 主题标题 */}
      <h2
        style={{
          fontSize: 42,
          fontWeight: 700,
          color: '#ffffff',
          marginBottom: 32,
          opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        {topic}
      </h2>
      
      {/* 要点列表 */}
      {keyPoints.map((point, index) => {
        const startFrame = 10 + index * staggerFrames;
        
        let animStyle = {};
        if (listConfig.animationType === 'slide-up') {
          const slideProgress = interpolate(
            frame - startFrame,
            [0, 15],
            [30, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
          animStyle = { transform: `translateY(${slideProgress}px)` };
        }
        
        const opacity = interpolate(
          frame - startFrame,
          [0, 12],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
        
        return (
          <div
            key={point}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginBottom: 20,
              opacity,
              ...animStyle,
            }}
          >
            <span
              style={{
                fontSize: 28,
                color: '#22c55e',
                fontWeight: 700,
                width: 32,
              }}
            >
              {bulletIcons[listConfig.bulletStyle](index)}
            </span>
            <span
              style={{
                fontSize: 28,
                color: '#ffffff',
                fontWeight: 500,
              }}
            >
              {point}
            </span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/** 金句展示模式 */
function QuoteDisplayMode({
  quote,
  config,
  durationFrames,
}: {
  quote: string;
  config: VisualizationConfig;
  durationFrames: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const scale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });
  
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.85)',
        padding: 60,
      }}
    >
      <div
        style={{
          opacity: fadeIn,
          transform: `scale(${scale})`,
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: 72, color: '#fbbf24' }}>"</span>
        <p
          style={{
            fontSize: 36,
            color: '#ffffff',
            fontWeight: 500,
            lineHeight: 1.6,
            maxWidth: 800,
            margin: '0 auto',
          }}
        >
          {quote}
        </p>
        <span style={{ fontSize: 72, color: '#fbbf24' }}>"</span>
      </div>
    </AbsoluteFill>
  );
}

/** 数字高亮模式 */
function NumberHighlightMode({
  value,
  label,
  config,
  durationFrames,
}: {
  value: string;
  label: string;
  config: VisualizationConfig;
  durationFrames: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  
  const scale = spring({
    frame,
    fps,
    config: { damping: 8, stiffness: 120 },
  });
  
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.8)',
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: 120,
            fontWeight: 800,
            color: '#3b82f6',
            margin: 0,
            textShadow: '0 4px 20px rgba(59,130,246,0.5)',
          }}
        >
          {value}
        </p>
        <p
          style={{
            fontSize: 32,
            color: '#ffffff',
            marginTop: 16,
            opacity: 0.9,
          }}
        >
          {label}
        </p>
      </div>
    </AbsoluteFill>
  );
}

// ============================================
// 字幕层
// ============================================

function SubtitleLayer({
  text,
  durationFrames,
}: {
  text: string;
  durationFrames: number;
}) {
  const frame = useCurrentFrame();
  
  const fadeIn = 5;
  const fadeOut = 5;
  
  let opacity = 1;
  if (frame < fadeIn) {
    opacity = frame / fadeIn;
  } else if (frame > durationFrames - fadeOut) {
    opacity = (durationFrames - frame) / fadeOut;
  }
  
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity,
      }}
    >
      <p
        style={{
          fontSize: 28,
          color: '#ffffff',
          fontWeight: 600,
          textAlign: 'center',
          backgroundColor: 'rgba(0,0,0,0.7)',
          padding: '12px 24px',
          borderRadius: 8,
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

export const ContentComposition: React.FC<ContentCompositionProps> = ({
  mainVideoUrl,
  segments,
  duration,
  width,
  height,
  fps,
  showSubtitles = true,
  pipEnabled = true,
  pipPosition = 'bottom-right',
  pipSize = 'medium',
}) => {
  const frame = useCurrentFrame();
  const currentTimeMs = (frame / fps) * 1000;
  
  // 找到当前片段
  const currentSegment = segments.find(
    seg => currentTimeMs >= seg.timeRange.start && currentTimeMs < seg.timeRange.end
  );
  
  console.log('[ContentComposition] 渲染帧:', frame, '当前片段:', currentSegment?.content.topic);
  
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* 基础口播视频层（始终播放） */}
      <AbsoluteFill>
        <OffthreadVideo
          src={mainVideoUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>
      
      {/* 各片段的可视化层 */}
      {segments.map((segment) => {
        const startFrame = msToFrames(segment.timeRange.start, fps);
        const endFrame = msToFrames(segment.timeRange.end, fps);
        const segmentDuration = endFrame - startFrame;
        
        const visType = segment.visualization.type as VisualizationType;
        const visConfig = segment.visualization.config as VisualizationConfig;
        
        // 根据可视化类型渲染不同内容
        let visualContent = null;
        
        switch (visType) {
          case 'talking-head':
            // 纯口播，不需要额外层
            break;
            
          case 'broll-overlay':
            if (segment.brollAsset?.url) {
              visualContent = (
                <BRollOverlayMode
                  mainVideoUrl={mainVideoUrl}
                  brollUrl={segment.brollAsset.url}
                  config={{
                    ...visConfig,
                    brollConfig: {
                      opacity: visConfig.brollConfig?.opacity ?? 1,
                      fadeIn: visConfig.brollConfig?.fadeIn ?? 300,
                      fadeOut: visConfig.brollConfig?.fadeOut ?? 300,
                      pipEnabled,
                      pipPosition,
                      pipSize,
                    },
                  }}
                  durationFrames={segmentDuration}
                  fps={fps}
                  canvasWidth={width}
                  canvasHeight={height}
                />
              );
            }
            break;
            
          case 'text-highlight':
            if (segment.content.keywords.length > 0) {
              visualContent = (
                <TextHighlightMode
                  keywords={segment.content.keywords}
                  config={visConfig}
                  durationFrames={segmentDuration}
                  fps={fps}
                />
              );
            }
            break;
            
          case 'list-animation':
            if (segment.content.keyPoints.length > 0) {
              visualContent = (
                <ListAnimationMode
                  keyPoints={segment.content.keyPoints}
                  topic={segment.content.topic}
                  config={visConfig}
                  durationFrames={segmentDuration}
                  fps={fps}
                />
              );
            }
            break;
            
          case 'quote-display':
            if (segment.content.quote) {
              visualContent = (
                <QuoteDisplayMode
                  quote={segment.content.quote}
                  config={visConfig}
                  durationFrames={segmentDuration}
                />
              );
            }
            break;
            
          case 'number-highlight':
            if (segment.content.highlightNumber) {
              visualContent = (
                <NumberHighlightMode
                  value={segment.content.highlightNumber.value}
                  label={segment.content.highlightNumber.label}
                  config={visConfig}
                  durationFrames={segmentDuration}
                />
              );
            }
            break;
        }
        
        if (!visualContent) return null;
        
        return (
          <Sequence
            key={segment.id}
            from={startFrame}
            durationInFrames={segmentDuration}
            name={`${visType}-${segment.segmentNumber}`}
          >
            {visualContent}
          </Sequence>
        );
      })}
      
      {/* 字幕层 */}
      {showSubtitles && segments.map((segment) => {
        const startFrame = msToFrames(segment.timeRange.start, fps);
        const endFrame = msToFrames(segment.timeRange.end, fps);
        const segmentDuration = endFrame - startFrame;
        
        // 只在 talking-head 模式显示字幕
        if (segment.visualization.type !== 'talking-head') return null;
        
        return (
          <Sequence
            key={`sub-${segment.id}`}
            from={startFrame}
            durationInFrames={segmentDuration}
            name={`subtitle-${segment.segmentNumber}`}
          >
            <SubtitleLayer
              text={segment.rawText}
              durationFrames={segmentDuration}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export default ContentComposition;
