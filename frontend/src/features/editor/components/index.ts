// 核心编辑器组件
export { Header } from './Header';
export { VideoCanvas } from './canvas';  // ★ 使用新架构
export { ClipListPanel } from './ClipListPanel';
export { Timeline } from './Timeline';
export { ContextMenu } from './ContextMenu';
export { ClipToolbar } from './ClipToolbar';
export { ASRProgressToast } from './ASRProgressToast';
export { SmartCleanupWizard } from './SmartCleanupWizard';
export { AIToolsWizard } from './AIToolsWizard';
export { ExportDialog } from './ExportDialog';

// 字幕编辑器
export { SubtitleEditor } from './SubtitleEditor';

// 智能功能面板 (从 smart 子目录导入)
export { 
  SmartPanel,
  SilenceDetectionPanel,
  FillerDetectionPanel,
  SpeakerDiarizationPanel,
  StemSeparationPanel,
} from './smart';

// 波形可视化
export { Waveform, MiniWaveform, generateWaveformFromFile, generateWaveformFromURL } from './Waveform';

// Timeline 子组件
export {
  ClipThumbnail,
  TimeRuler,
  Playhead,
  SnapIndicator,
  SelectionBox,
  TrackHeader,
} from './TimelineComponents';

// 变换面板
export { TransformPanel } from './TransformPanel';

// 音频面板
export { AudioPanel } from './AudioPanel';

// 视频变速面板
export { SpeedPanel } from './SpeedPanel';
