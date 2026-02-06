/**
 * Remotion 入口文件
 * 定义所有可用的视频合成组件
 */
import { Composition } from 'remotion';
import { VideoComposition, VideoCompositionSchema } from './compositions/VideoComposition';
import { BRollComposition, BRollCompositionSchema } from './compositions/BRollComposition';
import { 
  RemotionConfigComposition, 
  RemotionConfigCompositionPropsSchema 
} from './compositions/RemotionConfigComposition';

// 默认配置
const DEFAULT_FPS = 30;
const DEFAULT_DURATION_FRAMES = 300; // 10秒

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* 主视频合成 - 用于时间线渲染 */}
      <Composition
        id="VideoComposition"
        component={VideoComposition}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={DEFAULT_FPS}
        width={1080}
        height={1080}
        schema={VideoCompositionSchema}
        defaultProps={{
          clips: [],
          tracks: [],
          duration: 10000,
          width: 1080,
          height: 1080,
          fps: 30,
        }}
        calculateMetadata={async ({ props }) => {
          // 根据 props 动态计算时长和尺寸
          const fps = props.fps || DEFAULT_FPS;
          const durationMs = props.duration || 10000;
          const durationInFrames = Math.ceil((durationMs / 1000) * fps);
          
          return {
            durationInFrames,
            fps,
            width: props.width || 1080,
            height: props.height || 1080,
          };
        }}
      />
      
      {/* B-Roll 合成 - 用于口播视频 + B-Roll 叠加 */}
      <Composition
        id="BRollComposition"
        component={BRollComposition}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={DEFAULT_FPS}
        width={1080}
        height={1920}
        schema={BRollCompositionSchema}
        defaultProps={{
          mainVideoUrl: '',
          brollClips: [],
          subtitles: [],
          pip: {
            enabled: true,
            position: 'bottom-right',
            size: 'medium',
            borderRadius: 12,
          },
          duration: 10000,
          width: 1080,
          height: 1920,
          fps: 30,
        }}
        calculateMetadata={async ({ props }) => {
          const fps = props.fps || DEFAULT_FPS;
          const durationMs = props.duration || 10000;
          const durationInFrames = Math.ceil((durationMs / 1000) * fps);
          
          return {
            durationInFrames,
            fps,
            width: props.width || 1080,
            height: props.height || 1920,
          };
        }}
      />
      
      {/* 预览合成 - 用于 Player 实时预览 */}
      <Composition
        id="Preview"
        component={VideoComposition}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={DEFAULT_FPS}
        width={1080}
        height={1080}
        schema={VideoCompositionSchema}
        defaultProps={{
          clips: [],
          tracks: [],
          duration: 10000,
          width: 1080,
          height: 1080,
          fps: 30,
        }}
      />
      
      {/* V2: Remotion 配置合成 - 用于口播视频 + 文字动画 + B-Roll 导出 */}
      <Composition
        id="RemotionConfigComposition"
        component={RemotionConfigComposition}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={DEFAULT_FPS}
        width={1080}
        height={1920}
        schema={RemotionConfigCompositionPropsSchema}
        defaultProps={{
          mainVideoUrl: '',
          config: {
            version: '2.0',
            total_duration_ms: 10000,
            fps: 30,
            theme: 'minimalist',
            color_palette: ['#1a1a1a', '#ffffff', '#3b82f6'],
            font_family: 'Inter',
            text_components: [],
            broll_components: [],
            chapter_components: [],
          },
          pip: {
            enabled: true,
            position: 'bottom-right',
            size: 'medium',
          },
          width: 1080,
          height: 1920,
        }}
        calculateMetadata={async ({ props }) => {
          const fps = props.config?.fps || DEFAULT_FPS;
          const durationMs = props.config?.total_duration_ms || 10000;
          const durationInFrames = Math.ceil((durationMs / 1000) * fps);
          
          return {
            durationInFrames,
            fps,
            width: props.width || 1080,
            height: props.height || 1920,
          };
        }}
      />
    </>
  );
};
