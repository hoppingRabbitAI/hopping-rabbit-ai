/**
 * HoppingRabbit AI - Editor Store V2
 * 集成 SyncManager 实现毫秒级自动保存
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { TranscriptSegment } from '../types/transcript';
import type { Clip, Track, ClipType, ContextMenuState } from '../types/clip';
import type { Timeline, Project, Operation, OperationType } from '../types/project';
import type { Asset } from '../types/asset';
import type { Keyframe, KeyframeProperty, EasingType, CompoundValue } from '../types';
import { KEYFRAME_TOLERANCE } from '../types';
import { SyncManager, SyncStatus } from '../lib/sync-manager';
import { projectApi, assetApi, taskApi, smartApi, exportApi, clipsApi } from '@/lib/api';
import { getAssetStreamUrl } from '@/lib/api/media-proxy';
import { clearHlsCache } from '../components/canvas/VideoCanvasStore';
import { generateId } from '@/lib/utils';

// ==================== 调试开关 ====================
// ★ 已关闭 store 日志，视频缓冲日志在 VideoCanvasStore 中
const DEBUG_ENABLED = false;
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log(...args); };
const debugWarn = (...args: unknown[]) => { if (DEBUG_ENABLED) console.warn(...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

// ==================== 关键帧 Map 深拷贝 ====================
// zustand 使用浅比较，嵌套 Map 必须完全重建才能触发更新
type KeyframeMap = Map<string, Map<string, Keyframe[]>>;
function cloneKeyframeMap(source: KeyframeMap): KeyframeMap {
  const result = new Map<string, Map<string, Keyframe[]>>();
  for (const [clipId, clipMap] of Array.from(source.entries())) {
    const newClipMap = new Map<string, Keyframe[]>();
    for (const [prop, kfList] of Array.from(clipMap.entries())) {
      newClipMap.set(prop, [...kfList]);
    }
    result.set(clipId, newClipMap);
  }
  return result;
}

// ==================== 配置常量 ====================
export const TICK_WIDTH = 80;
export const TOTAL_DURATION = 120;

// ==================== 字段映射常量（前端 camelCase -> 后端 snake_case）====================
const CLIP_FIELD_MAPPING: Record<string, string> = {
  // 核心字段
  trackId: 'track_id',
  clipType: 'clip_type',
  assetId: 'asset_id',
  parentClipId: 'parent_clip_id',
  // 时间字段
  start: 'start_time',
  sourceStart: 'source_start',
  // 音频
  isMuted: 'is_muted',
  // 文本（统一）
  contentText: 'content_text',
  textStyle: 'text_style',
  // 特效
  effectType: 'effect_type',
  effectParams: 'effect_params',
  // 配音
  voiceParams: 'voice_params',
  // 贴纸
  stickerId: 'sticker_id',
  // 转场
  transitionIn: 'transition_in',
  transitionOut: 'transition_out',
  // 缓存
  mediaUrl: 'cached_url',
};

// 前端独有字段（不需要同步到后端）
const FRONTEND_ONLY_FIELDS = new Set([
  'isLocal', 'uploadStatus', 'waveformData', 'thumbnail', 
  'transcript', 'transcriptStatus', 'silenceInfo', 'color'
]);

// ==================== 工具模式类型 ====================
export type ToolMode = 'select' | 'split' | 'delete' | 'copy';

// ==================== ASR 进度状态 ====================
export type ASRProgressStatus = 'idle' | 'processing' | 'completed' | 'error';

export interface ASRProgressState {
  visible: boolean;
  status: ASRProgressStatus;
  progress: number;
  message?: string;
  error?: string;
}

// ==================== 轨道右键菜单状态 ====================
interface TrackContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  trackId: string | null;
}

// ==================== 历史记录类型 ====================
interface HistoryState {
  clips: Clip[];
  transcript: TranscriptSegment[];
  tracks: Track[];
}

// ==================== Store 接口 ====================
interface EditorState {
  // ========== 项目管理 ==========
  projectId: string | null;
  projectName: string;
  projectVersion: number;
  projectStatus: Project['status'];
  wizardCompleted: boolean;
  assets: Asset[];
  
  // ========== 智能清理向导触发（治本方案）==========
  /** 触发清理向导的计数器，每次+1表示需要重新检测换气片段 */
  cleanupWizardTrigger: number;
  /** 请求弹出清理向导（添加素材后调用） */
  requestCleanupWizard: () => void;
  
  // 项目操作
  loadProject: (projectId: string) => Promise<void>;
  createProject: (name: string) => Promise<string>;
  saveProject: (force?: boolean) => Promise<boolean>;
  setWizardCompleted: () => Promise<void>;
  
  // ========== 同步状态 ==========
  syncStatus: SyncStatus;
  pendingChanges: number;
  lastSavedAt: Date | null;
  
  // ========== 轨道管理 ==========
  tracks: Track[];
  addTrack: (name?: string) => string;
  removeTrack: (trackId: string) => void;
  updateTrackOrder: (trackId: string, orderIndex: number) => void;
  findOrCreateTrack: (clipType: ClipType, clipId: string, startTime: number, duration: number) => string;
  
  // ========== 轨道右键菜单 ==========
  trackContextMenu: TrackContextMenuState;
  openTrackContextMenu: (x: number, y: number, trackId: string) => void;
  closeTrackContextMenu: () => void;
  
  // ========== 内容块 (Clips) ==========
  clips: Clip[];
  addClip: (clip: Clip) => void;
  removeClip: (id: string) => void;
  updateClip: (id: string, updates: Partial<Clip>) => void;
  updateClipUrl: (clipId: string, cachedUrl: string, assetId?: string) => void;
  moveClipToTrack: (clipId: string, trackId: string, startTime: number) => void;
  getClipsByType: (clipType: ClipType) => Clip[];
  
  /** 紧凑化视频轨道 - 消除视频 clips 之间的空隙 */
  compactVideoTrack: (trackId?: string) => void;
  
  /** 解决所有轨道上的 clip 重合问题 - 适用于所有类型的 clip */
  resolveClipOverlaps: () => void;
  
  /** 合并相邻的视频片段 - 用于将保留的换气与前后片段融合 */
  mergeAdjacentClips: (keptBreathIds: string[]) => void;
  
  // ========== 多选支持 ==========
  selectedClipIds: Set<string>;
  selectClip: (id: string, multi?: boolean) => void;
  selectClipsByIds: (ids: string[]) => void;  // 批量选择指定的 clips
  selectAllClips: () => void;
  clearSelection: () => void;
  
  // 兼容旧代码
  selectedClipId: string | null;
  setSelectedClipId: (id: string | null) => void;

  // ========== 片段操作 (CapCut 风格) ==========
  splitClip: (clipId: string, splitTime: number) => void;
  splitAllAtTime: (splitTime: number) => void;
  duplicateClip: (clipId: string) => void;
  deleteSelectedClip: () => void;

  // ========== 历史记录 (撤销/重做) ==========
  history: HistoryState[];
  historyIndex: number;
  saveToHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // ========== 工具模式 ==========
  toolMode: ToolMode;
  setToolMode: (mode: ToolMode) => void;

  // ========== 文稿转写 (Transcript) ==========
  transcript: TranscriptSegment[];
  setTranscript: (segments: TranscriptSegment[]) => void;
  toggleSegmentDeleted: (id: string) => void;
  markSegmentsAsDeleted: (type: 'filler' | 'silence') => void;
  updateSegment: (id: string, updates: Partial<TranscriptSegment>) => void;

  // ========== 播放状态 ==========
  currentTime: number;
  isPlaying: boolean;
  isVideoReady: boolean;  // 视频是否加载就绪可播放
  duration: number;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setIsVideoReady: (ready: boolean) => void;
  setDuration: (duration: number) => void;

  // ========== 当前活动视频 ==========
  activeVideoUrl: string | null;
  setActiveVideoUrl: (url: string | null) => void;

  // ========== 时间轴 ==========
  zoomLevel: number;
  setZoomLevel: (level: number) => void;

  // ========== 右键菜单 ==========
  contextMenu: ContextMenuState;
  openContextMenu: (x: number, y: number, clipId: string) => void;
  closeContextMenu: () => void;

  // ========== 处理状态 ==========
  isProcessing: boolean;
  processType: 'stt' | 'clean' | 'export' | 'stem' | 'extract' | '';
  processProgress: number;
  currentTaskId: string | null; // 当前任务 ID，用于取消
  setProcessing: (isProcessing: boolean, type?: 'stt' | 'clean' | 'export' | 'stem' | 'extract' | '', progress?: number) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  cancelCurrentTask: () => Promise<void>;

  // ========== ASR 进度弹窗 ==========
  asrProgress: ASRProgressState;
  setASRProgress: (state: Partial<ASRProgressState>) => void;
  closeASRProgress: () => void;

  // ========== AI 功能 ==========
  extractSpeechFromClip: (clipId: string) => Promise<void>;
  startASR: (assetId: string) => Promise<void>;
  startStemSeparation: (assetId: string) => Promise<void>;
  extractAudio: (clipId: string) => Promise<void>;
  startSmartClean: () => Promise<void>;
  startExport: (config?: { 
    resolution?: string; 
    fps?: number;
    format?: string;
    title?: string;
  }) => Promise<string>;
  
  // ========== Clips 局部刷新 ==========
  loadClips: (clipType?: string) => Promise<void>;
  refreshSubtitleClips: () => Promise<void>;
  loadAssets: () => Promise<void>;  // ★ 新增：刷新素材列表
  loadKeyframes: () => Promise<void>;  // ★ 新增：刷新关键帧
  
  // ========== 内部方法 ==========
  _syncManager: SyncManager | null;
  _initSyncManager: (projectId: string, version: number) => void;
  _addOperation: (type: OperationType, payload: Record<string, unknown>) => void;
  _buildTimeline: () => Timeline;
  
  // ========== 关键帧系统 V2 ==========
  /** 关键帧数据：clipId -> property -> Keyframe[] (使用 offset 存储) */
  keyframes: Map<string, Map<string, Keyframe[]>>;
  /** 选中的关键帧 ID */
  selectedKeyframeIds: Set<string>;
  
  // ========== 画布编辑模式 ==========
  /** 画布编辑模式：null=普通模式, 'transform'=变换模式, 'text'=文本编辑模式, 'subtitle'=字幕编辑模式 */
  canvasEditMode: 'transform' | 'text' | 'subtitle' | null;
  setCanvasEditMode: (mode: 'transform' | 'text' | 'subtitle' | null) => void;
  
  /** 侧边栏激活的面板 */
  activeSidebarPanel: 'transform' | 'text' | 'subtitle' | 'audio' | 'ai-tools' | 'speed' | 'image-adjust' | null;
  setActiveSidebarPanel: (panel: 'transform' | 'text' | 'subtitle' | 'audio' | 'ai-tools' | 'speed' | 'image-adjust' | null) => void;
  
  /** 左侧栏激活的面板 */
  activeLeftPanel: 'subtitles' | 'assets' | null;
  setActiveLeftPanel: (panel: 'subtitles' | 'assets' | null) => void;
  
  /** 画布/导出比例（青色框的比例），默认 9:16 抖音竖屏 */
  canvasAspectRatio: '16:9' | '9:16' | '1:1';
  setCanvasAspectRatio: (ratio: '16:9' | '9:16' | '1:1') => void;
  
  // 关键帧操作 V2（使用 offset 而非 time）
  /** 添加关键帧 @param offset 归一化时间 0-1 @param value 简单值或复合值{x,y} */
  addKeyframe: (clipId: string, property: KeyframeProperty, offset: number, value: number | CompoundValue, easing?: EasingType) => void;
  updateKeyframe: (keyframeId: string, updates: Partial<Keyframe>) => void;
  deleteKeyframe: (keyframeId: string) => void;
  /** 删除某属性的所有关键帧 */
  deletePropertyKeyframes: (clipId: string, property: KeyframeProperty) => void;
  getClipKeyframes: (clipId: string, property?: KeyframeProperty) => Keyframe[];
  selectKeyframe: (keyframeId: string, multi?: boolean) => void;
  clearKeyframeSelection: () => void;
}

// ==================== 默认轨道配置 ====================
// Track 是通用容器，不区分类型，素材类型由 Clip.clipType 决定
const DEFAULT_TRACKS: Track[] = [
  { id: 'track-1', name: 'Track 1', orderIndex: 3, color: 'text-blue-400', isVisible: true, isLocked: false, isMuted: false },
  { id: 'track-2', name: 'Track 2', orderIndex: 2, color: 'text-blue-400', isVisible: true, isLocked: false, isMuted: false },
  { id: 'track-3', name: 'Track 3', orderIndex: 1, color: 'text-blue-400', isVisible: true, isLocked: false, isMuted: false },
  { id: 'track-4', name: 'Track 4', orderIndex: 0, color: 'text-blue-400', isVisible: true, isLocked: false, isMuted: false },
];

// 内容块类型颜色映射 - 按类型区分
const CLIP_TYPE_COLORS: Record<ClipType, string[]> = {
  video: ['from-blue-500/80 to-indigo-600/60', 'from-blue-600/80 to-indigo-700/60', 'from-indigo-500/80 to-blue-600/60'],
  image: ['from-violet-500/80 to-purple-600/60', 'from-purple-500/80 to-violet-600/60', 'from-fuchsia-500/80 to-violet-600/60'],
  audio: ['from-green-500/80 to-emerald-600/60', 'from-emerald-500/80 to-green-600/60', 'from-teal-500/80 to-green-600/60'],
  text: ['from-purple-500/80 to-violet-600/60', 'from-violet-500/80 to-purple-600/60', 'from-fuchsia-500/80 to-purple-600/60'],
  subtitle: ['from-yellow-500/80 to-amber-600/60', 'from-amber-500/80 to-yellow-600/60'],
  voice: ['from-teal-500/80 to-cyan-600/60', 'from-cyan-500/80 to-teal-600/60'],
  effect: ['from-red-500/80 to-rose-600/60', 'from-rose-500/80 to-red-600/60'],
  filter: ['from-pink-500/80 to-rose-600/60', 'from-rose-500/80 to-pink-600/60'],
  transition: ['from-orange-500/80 to-amber-600/60', 'from-amber-500/80 to-orange-600/60'],
  sticker: ['from-cyan-500/80 to-sky-600/60', 'from-sky-500/80 to-cyan-600/60'],
};

// 轨道颜色列表 - 统一蓝色系
const TRACK_COLORS: string[] = [
  'text-blue-400', 'text-blue-400', 'text-blue-400', 'text-blue-400',
  'text-indigo-400', 'text-indigo-400', 'text-sky-400', 'text-sky-400',
];

// ==================== 本地持久化 ====================
const LOCAL_STORAGE_KEY = 'hoppingrabbit_editor_state';

interface LocalState {
  projectId: string;
  clips: Clip[];
  tracks: Track[];
  version: number;
  timestamp: number;
  pendingSync: boolean;  // 是否有未同步的修改
}

/**
 * 保存状态到 localStorage
 * 注意：过滤掉大数据字段（waveformData, transcript）避免超出 localStorage 限制
 */
function saveToLocalStorage(projectId: string, clips: Clip[], tracks: Track[], version: number, pendingSync: boolean = true): void {
  if (typeof window === 'undefined') return;
  
  try {
    // 过滤掉不需要持久化的大数据字段
    const cleanedClips = clips.map(clip => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { waveformData, transcript, thumbnail, ...rest } = clip;
      return rest;
    });
    
    const state: LocalState = {
      projectId,
      clips: cleanedClips as Clip[],
      tracks,
      version,
      timestamp: Date.now(),
      pendingSync,
    };
    localStorage.setItem(`${LOCAL_STORAGE_KEY}_${projectId}`, JSON.stringify(state));
    debugLog(`[LocalStorage] 已保存状态: ${clips.length} clips, pendingSync=${pendingSync}`);
  } catch (e) {
    debugWarn('[LocalStorage] 保存失败:', e);
  }
}

/**
 * 从 localStorage 读取状态
 */
function loadFromLocalStorage(projectId: string): LocalState | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const stored = localStorage.getItem(`${LOCAL_STORAGE_KEY}_${projectId}`);
    if (!stored) return null;
    
    const state: LocalState = JSON.parse(stored);
    
    // 验证 projectId 匹配
    if (state.projectId !== projectId) return null;
    
    // 检查是否过期（24小时）
    const MAX_AGE = 24 * 60 * 60 * 1000;
    if (Date.now() - state.timestamp > MAX_AGE) {
      localStorage.removeItem(`${LOCAL_STORAGE_KEY}_${projectId}`);
      return null;
    }
    
    return state;
  } catch (e) {
    debugWarn('[LocalStorage] 读取失败:', e);
    return null;
  }
}

/**
 * 清除本地缓存（同步成功后调用）
 */
function clearLocalStorage(projectId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`${LOCAL_STORAGE_KEY}_${projectId}`);
}

/**
 * 标记本地状态已同步
 */
function markLocalStorageSynced(projectId: string): void {
  if (typeof window === 'undefined') return;
  
  const state = loadFromLocalStorage(projectId);
  if (state) {
    state.pendingSync = false;
    localStorage.setItem(`${LOCAL_STORAGE_KEY}_${projectId}`, JSON.stringify(state));
  }
}

// ==================== 辅助函数 ====================
function isOverlapping(start1: number, duration1: number, start2: number, duration2: number): boolean {
  const end1 = start1 + duration1;
  const end2 = start2 + duration2;
  return start1 < end2 && start2 < end1;
}

// ==================== Store 实现 ====================
export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set, get) => ({
    // ========== 项目管理 ==========
    projectId: null,
    projectName: '未命名项目',
    projectVersion: 1,
    projectStatus: 'draft',
    wizardCompleted: false,
    assets: [],
    
    // ========== 智能清理向导触发 ==========
    cleanupWizardTrigger: 0,
    requestCleanupWizard: () => {
      // 递增触发器，EditorPage 监听这个值变化来重新检测换气片段
      set(state => ({ cleanupWizardTrigger: state.cleanupWizardTrigger + 1 }));
    },
    
    loadProject: async (projectId: string) => {
      try {
        debugLog('[LoadProject] 🚀 开始加载项目:', projectId);
        
        // ★ 设置加载状态，但保持旧数据显示
        set({ 
          isProcessing: true, 
          processType: '',
        });
        
        const response = await projectApi.getProject(projectId);
        debugLog('[LoadProject] 📥 API 响应:', {
          hasError: !!response.error,
          hasData: !!response.data,
        });
        
        if (response.error || !response.data) {
          throw new Error(response.error?.message || '加载项目失败');
        }
        
        const project = response.data;
        debugLog('[LoadProject] 📦 项目数据概览:', {
          name: project.name,
          status: project.status,
          duration: project.duration,
          assetsCount: project.assets?.length || 0,
        });
        
        const rawTimeline = (project as unknown as { timeline?: { tracks?: unknown[]; clips?: unknown[]; effects?: unknown[]; markers?: unknown[]; duration?: number } }).timeline;
        const timeline = rawTimeline || { tracks: [], clips: [], effects: [], markers: [], duration: 0 };
        
        debugLog('[LoadProject] ⏱️ Timeline 数据:', {
          tracksCount: (timeline.tracks as unknown[])?.length || 0,
        });
        
        // 转换 tracks 格式（后端 snake_case）
        // Track 是通用容器，不区分类型，素材类型由 Clip.clip_type 决定
        const tracks: Track[] = (timeline.tracks as Record<string, unknown>[])?.length > 0 
          ? (timeline.tracks as Record<string, unknown>[]).map((t: Record<string, unknown>, i: number) => ({
              id: t.id as string,
              name: (t.name as string) || `Track ${i + 1}`,
              orderIndex: (t.order_index ?? i) as number,
              color: TRACK_COLORS[i % TRACK_COLORS.length],
              isVisible: (t.is_visible ?? true) as boolean,
              isLocked: (t.is_locked ?? false) as boolean,
              isMuted: (t.is_muted ?? false) as boolean,
            }))
          : DEFAULT_TRACKS;
        
        // 后端返回按 clip_type 分组的对象，需要合并成数组
        // 格式: { video: [...], audio: [...], subtitle: [...], ... }
        const clipsData = timeline.clips as unknown as Record<string, Record<string, unknown>[]>;
        const rawClips: Record<string, unknown>[] = [];
        
        if (clipsData && typeof clipsData === 'object') {
          Object.values(clipsData).forEach((typeClips) => {
            if (Array.isArray(typeClips)) {
              rawClips.push(...typeClips);
            }
          });
        }
        
        const clips: Clip[] = rawClips.map((c: Record<string, unknown>) => {
          // 后端使用 snake_case，前端使用 camelCase
          const startTime = (c.start_time ?? 0) as number;
          const duration = (c.duration ?? 0) as number;
          const clipType = (c.clip_type ?? 'video') as ClipType;
          
          const clip: Clip = {
            id: c.id as string,
            name: (c.name as string) || 'Clip',
            trackId: (c.track_id ?? tracks[0]?.id ?? 'track-1') as string,
            clipType,
            start: startTime,
            duration,
            color: CLIP_TYPE_COLORS[clipType]?.[0] || 'from-blue-500/80 to-indigo-600/60',
            isLocal: false,
            
            // 素材源信息
            // 图片直接使用原始 URL，视频/音频使用代理 URL 解决 CORS 问题
            mediaUrl: clipType === 'image'
              ? (c.url as string | undefined)
              : (c.asset_id ? getAssetStreamUrl(c.asset_id as string) : (c.url as string | undefined)),
            sourceStart: (c.source_start ?? 0) as number,
            originDuration: c.origin_duration as number | undefined,
            assetId: c.asset_id as string | undefined,
            
            // 音频属性 (video, audio, voice)
            volume: (c.volume ?? 1.0) as number,
            isMuted: (c.is_muted ?? false) as boolean,
            
            // 文本/字幕内容 (text, subtitle 共用)
            contentText: c.content_text as string | undefined,
            textStyle: c.text_style as Clip['textStyle'],
            
            // 配音 (voice)
            voiceParams: c.voice_params as Clip['voiceParams'],
            
            // 特效/滤镜 (effect, filter)
            effectType: c.effect_type as string | undefined,
            effectParams: c.effect_params as Record<string, unknown> | undefined,
            
            // 贴纸 (sticker)
            stickerId: c.sticker_id as string | undefined,
            
            // 变换 (video, text, sticker, effect)
            transform: c.transform as Clip['transform'],
            
            // 播放控制
            speed: (c.speed ?? 1.0) as number,
            
            // 追溯
            parentClipId: c.parent_clip_id as string | undefined,
            
            // 元数据（包含 silence_info 等）
            metadata: c.metadata as Record<string, unknown> | undefined,
            // 静音信息（从 metadata 中读取）
            silenceInfo: (c.metadata as Record<string, unknown>)?.silence_info as Clip['silenceInfo'],
          };
          
          return clip;
        });
        
        // 按时间顺序排序 clips
        clips.sort((a, b) => a.start - b.start);
        
        // ★ 检查本地是否有未同步的修改
        const localState = loadFromLocalStorage(projectId);
        let finalClips = clips;
        let finalTracks = tracks;
        let hasLocalChanges = false;
        
        debugLog(`[LoadProject] localState:`, localState ? {
          pendingSync: localState.pendingSync,
          clipsCount: localState.clips?.length,
          timestamp: new Date(localState.timestamp).toLocaleString(),
        } : null);
        
        if (localState && localState.pendingSync) {
          // 本地有未同步的修改，优先使用本地数据
          debugLog('[LoadProject] 使用本地未同步数据');
          finalClips = localState.clips;
          finalTracks = localState.tracks;
          hasLocalChanges = true;
        } else {
          debugLog('[LoadProject] 使用服务器数据');
        }
        
        // 转换 segments 格式
        const rawProject = project as unknown as { segments?: TranscriptSegment[]; version?: number };
        const segments: TranscriptSegment[] = (rawProject.segments || []).map(s => ({
          id: s.id,
          text: s.text,
          start: s.start,
          end: s.end,
          type: 'normal' as const,
          words: s.words || [],
          deleted: s.is_deleted || false,
          autoZoom: s.auto_zoom || false,
          speaker: s.speaker,
        }));
        
        const projectVersion = rawProject.version || 1;
        
        // ★ 加载关键帧数据（从 timeline.keyframes 读取，避免冗余）
        // value 可能是简单数值(rotation/opacity)或复合值{x,y}(scale/position)
        const rawKeyframes = (timeline as { keyframes?: Array<{
          id: string;
          clipId: string;
          property: KeyframeProperty;
          offset: number;
          value: number | { x: number; y: number };  // ★ 支持复合值
          easing: EasingType;
        }> }).keyframes || [];
        
        debugLog('[LoadProject] 🎬 后端返回的关键帧数量:', rawKeyframes.length);
        
        // 详细日志：按 clipId 分组统计
        const kfByClip: Record<string, number> = {};
        for (const kf of rawKeyframes) {
          kfByClip[kf.clipId] = (kfByClip[kf.clipId] || 0) + 1;
        }
        debugLog('[LoadProject] 🎬 关键帧按 clip 分布:', kfByClip);
        
        // 详细日志：每个关键帧的详情
        for (const kf of rawKeyframes) {
          debugLog(`[LoadProject]   kf: clip=${kf.clipId?.slice(0, 8)}, prop=${kf.property}, offset=${kf.offset}, value=${kf.value}`);
        }
        
        const keyframesMap: Map<string, Map<string, Keyframe[]>> = new Map();
        for (const kf of rawKeyframes) {
          if (!keyframesMap.has(kf.clipId)) {
            keyframesMap.set(kf.clipId, new Map());
          }
          const clipMap = keyframesMap.get(kf.clipId)!;
          if (!clipMap.has(kf.property)) {
            clipMap.set(kf.property, []);
          }
          clipMap.get(kf.property)!.push({
            id: kf.id,
            clipId: kf.clipId,
            property: kf.property,
            offset: kf.offset,
            value: kf.value,
            easing: kf.easing || 'linear',
          });
        }
        // 确保每个属性的关键帧按 offset 排序
        for (const [, clipMap] of Array.from(keyframesMap.entries())) {
          for (const [, kfList] of Array.from(clipMap.entries())) {
            kfList.sort((a, b) => a.offset - b.offset);
          }
        }
        
        // ★ 关键帧已统一存储在 keyframes 表，直接使用 keyframesMap
        debugLog('[LoadProject] ✅ 从 keyframes 表加载了', rawKeyframes.length, '个关键帧');
        
        // ★★★ 关键：清理缓存和更新数据必须是原子操作 ★★★
        // 在 set 新数据之前清理，这样视频组件响应的是新数据而不是空数据
        clearHlsCache();
        
        set({
          projectId,
          projectName: project.name,
          projectVersion,
          projectStatus: project.status,
          wizardCompleted: project.wizard_completed ?? false,
          assets: project.assets || [],
          tracks: finalTracks,
          clips: finalClips,
          keyframes: keyframesMap,  // ★ 直接使用 keyframes 表数据
          transcript: segments,
          duration: project.duration || 0,
          activeVideoUrl: project.assets?.find((a: Asset) => a.type === 'video')?.url || null,
          isProcessing: false,
          history: [],
          historyIndex: -1,
          currentTime: 0,  // ★ 重置播放头到开头
        });
        
        debugLog('[LoadProject] ✅ Store 状态已更新');
        
        // 初始化 SyncManager
        get()._initSyncManager(projectId, projectVersion);
        
        // 加载后修复数据完整性：先解决重合，再紧凑视频轨道
        setTimeout(() => {
          get().resolveClipOverlaps();
          get().compactVideoTrack();
          
          // 关键修复：如果第一个 clip 的 start 不是 0，将播放头移动到第一个 clip
          const clipsAfterCompact = get().clips.filter(c => c.clipType === 'video');
          const firstVideoClip = clipsAfterCompact.sort((a, b) => a.start - b.start)[0];
          if (firstVideoClip && firstVideoClip.start > 0 && get().currentTime === 0) {
            get().setCurrentTime(firstVideoClip.start);
          }
        }, 0);
        
        // 如果有本地未同步的修改，立即触发同步
        if (hasLocalChanges) {
          setTimeout(() => {
            get().saveProject(true);
          }, 500);
        }

        
      } catch (error) {
        set({ isProcessing: false });
        debugError('[LoadProject] ❌ 加载项目失败:', error);
        throw error;
      }
    },
    
    createProject: async (name: string) => {
      try {
        const response = await projectApi.createProject({ name });
        if (response.error || !response.data) {
          throw new Error(response.error?.message || '创建项目失败');
        }
        
        const projectId = response.data.id;
        
        set({
          projectId,
          projectName: name,
          projectVersion: 1,
          projectStatus: 'draft',
          wizardCompleted: false,
          assets: [],
          tracks: DEFAULT_TRACKS,
          clips: [],
          transcript: [],
          duration: 0,
          history: [],
          historyIndex: -1,
        });
        
        // 初始化 SyncManager
        get()._initSyncManager(projectId, 1);
        
        return projectId;
      } catch (error) {
        debugError('创建项目失败:', error);
        throw error;
      }
    },
    
    saveProject: async (force = false) => {
      const { projectId, _syncManager, _buildTimeline, transcript } = get();
      if (!projectId) return false;
      
      if (force && _syncManager) {
        const timeline = _buildTimeline();
        return await _syncManager.saveFullState(timeline, transcript);
      }
      
      if (_syncManager) {
        return await _syncManager.forceSync();
      }
      
      return false;
    },
    
    setWizardCompleted: async () => {
      const { projectId } = get();
      if (!projectId) return;
      
      try {
        // 更新后端
        await projectApi.updateProject(projectId, { wizard_completed: true });
        // 更新本地状态
        set({ wizardCompleted: true });
      } catch (error) {
        debugError('更新向导状态失败:', error);
      }
    },
    
    // ========== 同步状态 ==========
    syncStatus: 'idle',
    pendingChanges: 0,
    lastSavedAt: null,
    
    // ========== 轨道管理 ==========
    tracks: DEFAULT_TRACKS,
    
    addTrack: (name) => {
      const { tracks, _addOperation } = get();
      // 从已有轨道名称中提取最大的数字，用于生成新轨道名称
      const existingNumbers = tracks
        .map(t => {
          const match = t.name.match(/Track\s*(\d+)/i);
          return match ? parseInt(match[1], 10) : 0;
        });
      const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
      const newIndex = maxNumber + 1;
      
      // ★ 新 track 使用最高的 orderIndex，放在最上层（最优先显示）
      const maxOrderIndex = tracks.length > 0 
        ? Math.max(...tracks.map(t => t.orderIndex)) 
        : -1;
      
      const newTrack: Track = {
        id: generateId(),
        name: name || `Track ${newIndex}`,
        orderIndex: maxOrderIndex + 1,  // ★ 最高层
        color: 'text-blue-400', // 统一使用蓝色
        isVisible: true,
        isLocked: false,
        isMuted: false,
      };
      
      set((state) => ({ tracks: [...state.tracks, newTrack] }));
      
      // 记录操作
      _addOperation('ADD_TRACK', { 
        id: newTrack.id, 
        name: newTrack.name, 
        order_index: newTrack.orderIndex 
      });
      
      return newTrack.id;
    },
    
    removeTrack: (trackId) => {
      const { clips, _addOperation } = get();
      const hasClips = clips.some(c => c.trackId === trackId);
      if (hasClips) return;
      
      set((state) => ({
        tracks: state.tracks.filter(t => t.id !== trackId),
      }));
      
      _addOperation('REMOVE_TRACK', { track_id: trackId });
    },
    
    updateTrackOrder: (trackId: string, orderIndex: number) => {
      set((state) => ({
        tracks: state.tracks.map(t => 
          t.id === trackId ? { ...t, orderIndex: Math.max(0, orderIndex) } : t
        ),
      }));
      
      get()._addOperation('UPDATE_TRACK', { id: trackId, order_index: orderIndex });
    },
    
    findOrCreateTrack: (clipType, clipId, newStart, duration) => {
      const { tracks, clips, addTrack } = get();
      const sortedTracks = [...tracks].sort((a, b) => b.orderIndex - a.orderIndex);
      
      for (const track of sortedTracks) {
        const trackClips = clips.filter(c => c.trackId === track.id && c.id !== clipId);
        
        // ★ 检查轨道类型是否兼容：
        // 1. 空轨道可以放任何类型
        // 2. 已有 clips 的轨道，新 clip 类型必须与轨道上的 clips 类型一致
        if (trackClips.length > 0) {
          const trackClipTypes = new Set(trackClips.map(c => c.clipType));
          // 如果轨道上有不同类型的 clip，跳过这个轨道
          if (!trackClipTypes.has(clipType)) {
            continue;
          }
        }
        
        const hasOverlap = trackClips.some(c => isOverlapping(newStart, duration, c.start, c.duration));
        
        if (!hasOverlap) {
          return track.id;
        }
      }
      
      return addTrack();
    },
    
    // ========== 轨道右键菜单 ==========
    trackContextMenu: { visible: false, x: 0, y: 0, trackId: null },
    openTrackContextMenu: (x, y, trackId) => {
      set({ trackContextMenu: { visible: true, x, y, trackId } });
    },
    closeTrackContextMenu: () => {
      set((state) => ({ trackContextMenu: { ...state.trackContextMenu, visible: false } }));
    },

    // ========== 内容块 ==========
    clips: [],
    
    addClip: (clip) => {
      const { saveToHistory, _addOperation } = get();
      saveToHistory();
      set((state) => ({ clips: [...state.clips, clip] }));
      
      _addOperation('ADD_CLIP', {
        id: clip.id,
        track_id: clip.trackId,
        asset_id: clip.assetId,
        clip_type: clip.clipType,
        start_time: clip.start,
        end_time: clip.start + clip.duration,
        source_start: clip.sourceStart || 0,
        volume: clip.volume,
        is_muted: clip.isMuted,
        name: clip.name,
        // 文本内容
        content_text: clip.contentText,
        text_style: clip.textStyle,
      });
    },
    
    removeClip: (id) => {
      const { saveToHistory, _addOperation, compactVideoTrack, clips } = get();
      
      // 获取被删除 clip 的信息
      const removedClip = clips.find(c => c.id === id);
      if (!removedClip) return;
      
      const trackId = removedClip.trackId;
      const isVideoClip = removedClip.clipType === 'video';
      
      // 如果是视频 clip，找出关联的字幕一起删除
      let subtitlesToRemove: string[] = [];
      if (isVideoClip) {
        const videoStart = removedClip.start;
        const videoEnd = removedClip.start + removedClip.duration;
        
        // 优先使用 parentClipId 匹配字幕（精确关联）
        // 如果没有 parentClipId，则回退到时间范围匹配
        subtitlesToRemove = clips
          .filter(c => {
            if (c.clipType !== 'subtitle') return false;
            // 精确匹配：parentClipId 等于被删除视频的 id
            if (c.parentClipId === id) return true;
            // 回退匹配：字幕在视频时间范围内（兼容旧数据）
            if (!c.parentClipId && c.start >= videoStart && c.start < videoEnd) return true;
            return false;
          })
          .map(c => c.id);
      }
      
      saveToHistory();
      
      // 删除 video clip 和关联的字幕
      const idsToRemove = new Set([id, ...subtitlesToRemove]);
      
      set((state) => {
        const newSelectedIds = new Set<string>();
        state.selectedClipIds.forEach(cid => {
          if (!idsToRemove.has(cid)) newSelectedIds.add(cid);
        });
        return { 
          clips: state.clips.filter((c) => !idsToRemove.has(c.id)),
          selectedClipIds: newSelectedIds,
        };
      });
      
      // 记录删除操作
      _addOperation('REMOVE_CLIP', { clip_id: id });
      for (const subtitleId of subtitlesToRemove) {
        _addOperation('REMOVE_CLIP', { clip_id: subtitleId });
      }
      
      // 删除视频 clip 后自动紧凑化该轨道
      if (isVideoClip && trackId) {
        // 使用 setTimeout 确保 state 已更新
        setTimeout(() => compactVideoTrack(trackId), 0);
      }
    },
    
    /**
     * 紧凑化视频轨道 - 消除视频 clips 之间的空隙
     * 所有视频 clip 按时间顺序向左合并，确保没有间隙
     * 同时同步移动关联的字幕片段
     */
    compactVideoTrack: (trackId?: string) => {
      const { clips, _addOperation } = get();
      
      debugLog('[compactVideoTrack] ========================================');
      debugLog('[compactVideoTrack] 开始紧凑化视频轨道');
      debugLog('[compactVideoTrack] 当前 clips 总数:', clips.length);
      
      // 获取需要处理的轨道
      const trackIds = trackId 
        ? [trackId] 
        : Array.from(new Set(clips.filter(c => c.clipType === 'video').map(c => c.trackId)));
      
      debugLog('[compactVideoTrack] 要处理的轨道 IDs:', trackIds);
      
      // 记录所有视频片段的旧位置和新位置（包括未移动的）
      const videoMappings: { 
        id: string; 
        oldStart: number; 
        newStart: number; 
        duration: number; 
        moved: boolean;
      }[] = [];
      
      for (const tid of trackIds) {
        // 获取该轨道的所有视频 clips，按开始时间排序
        const videoClips = clips
          .filter(c => c.trackId === tid && c.clipType === 'video')
          .sort((a, b) => a.start - b.start);
        
        debugLog(`[compactVideoTrack] 轨道 ${tid.slice(0,8)}... 视频 clips:`, videoClips.length);
        videoClips.forEach((c, i) => {
          debugLog(`  [${i}] ${c.id.slice(0,8)}... name="${c.name}" start=${c.start} duration=${c.duration} assetId=${c.assetId?.slice(0,8) || 'N/A'}`);
        });
        
        if (videoClips.length === 0) continue;
        
        // 从 0 开始紧凑，确保视频轨道的 clips 全部靠左
        let nextStart = 0;
        
        for (const clip of videoClips) {
          const moved = clip.start !== nextStart;
          videoMappings.push({ 
            id: clip.id, 
            oldStart: clip.start,
            newStart: nextStart,
            duration: clip.duration,
            moved,
          });
          nextStart = nextStart + clip.duration;
        }
      }
      
      // 只有有移动的才需要更新
      const videoUpdates = videoMappings.filter(v => v.moved);
      debugLog('[compactVideoTrack] 需要移动的视频 clips:', videoUpdates.length);
      videoUpdates.forEach(v => {
        debugLog(`  ${v.id.slice(0,8)}... oldStart=${v.oldStart} -> newStart=${v.newStart}`);
      });
      
      if (videoUpdates.length === 0) {
        debugLog('[compactVideoTrack] 无需移动，跳过');
        return;
      }
      
      // 收集所有需要更新的 clips（包括视频和字幕）
      const allUpdates: { id: string; start: number }[] = [];
      
      // 添加视频更新
      for (const vu of videoUpdates) {
        allUpdates.push({ id: vu.id, start: vu.newStart });
      }
      
      // 找出需要移动的字幕
      // 关键：根据字幕当前的 start 位置，找到它属于哪个视频片段的时间范围
      const subtitleClips = clips.filter(c => c.clipType === 'subtitle');
      
      for (const subtitle of subtitleClips) {
        const subtitleStart = subtitle.start;
        
        // 找到字幕所处的视频片段（根据时间轴上的旧位置判断）
        for (const vm of videoMappings) {
          const videoOldEnd = vm.oldStart + vm.duration;
          
          // 字幕起点在这个视频片段的时间范围内
          if (subtitleStart >= vm.oldStart && subtitleStart < videoOldEnd) {
            if (vm.moved) {
              // 计算偏移量并移动字幕
              const delta = vm.newStart - vm.oldStart;
              const newSubtitleStart = subtitleStart + delta;
              
              // 避免重复添加
              if (!allUpdates.find(u => u.id === subtitle.id)) {
                allUpdates.push({ id: subtitle.id, start: newSubtitleStart });
              }
            }
            break;
          }
        }
      }
      
      // 批量更新
      set((state) => ({
        clips: state.clips.map(c => {
          const update = allUpdates.find(u => u.id === c.id);
          if (update) {
            return { ...c, start: update.start };
          }
          return c;
        })
      }));
      
      // 同步到后端
      for (const update of allUpdates) {
        _addOperation('UPDATE_CLIP', { id: update.id, start: update.start });
      }
    },
    
    /**
     * 解决所有轨道上的 clip 重合问题
     * 只适用于 video 类型的 clip
     * 其他类型（subtitle、text、audio 等）允许自由重叠
     */
    resolveClipOverlaps: () => {
      const { clips, _addOperation } = get();
      
      // 只处理 video clips
      const videoClips = clips.filter(c => c.clipType === 'video');
      
      // 获取所有 video 轨道 ID
      const trackIds = Array.from(new Set(videoClips.map(c => c.trackId)));
      
      const allUpdates: { id: string; start: number }[] = [];
      
      for (const trackId of trackIds) {
        // 只获取该轨道的 video clips，按开始时间排序
        const trackClips = videoClips
          .filter(c => c.trackId === trackId)
          .sort((a, b) => a.start - b.start);
        
        if (trackClips.length < 2) continue;
        
        // 检查并修复重合
        let prevEnd = trackClips[0].start + trackClips[0].duration;
        
        for (let i = 1; i < trackClips.length; i++) {
          const clip = trackClips[i];
          
          // 如果当前 clip 的开始时间小于前一个 clip 的结束时间，说明重合了
          if (clip.start < prevEnd) {
            // 将当前 clip 移动到前一个 clip 的结束位置
            allUpdates.push({ id: clip.id, start: prevEnd });
            // 更新 prevEnd 为新位置的结束时间
            prevEnd = prevEnd + clip.duration;
          } else {
            prevEnd = clip.start + clip.duration;
          }
        }
      }
      
      if (allUpdates.length === 0) return;
      
      debugLog('[resolveClipOverlaps] 修复 clip 重合:', allUpdates.length, '个');
      
      // 批量更新
      set((state) => ({
        clips: state.clips.map(c => {
          const update = allUpdates.find(u => u.id === c.id);
          if (update) {
            return { ...c, start: update.start };
          }
          return c;
        })
      }));
      
      // 同步到后端
      for (const update of allUpdates) {
        _addOperation('UPDATE_CLIP', { id: update.id, start: update.start });
      }
    },
    
    /**
     * 合并相邻的视频片段
     * 将保留的换气片段与前后的普通片段合并成一个连续片段
     * 逻辑：将换气片段“吸收”进前一个片段（扩展前一个片段的duration）
     */
    mergeAdjacentClips: (keptBreathIds: string[]) => {
      debugLog('[mergeAdjacentClips] ========================================');
      debugLog('[mergeAdjacentClips] 开始合并相邻片段, 保留换气数:', keptBreathIds.length);
      
      if (keptBreathIds.length === 0) {
        debugLog('[mergeAdjacentClips] 无换气片段需要合并，跳过');
        return;
      }
      
      const { clips, _addOperation } = get();
      
      // 打印当前所有视频 clips
      const allVideoClips = clips.filter(c => c.clipType === 'video');
      debugLog('[mergeAdjacentClips] 当前视频 clips 总数:', allVideoClips.length);
      allVideoClips.forEach((c, i) => {
        const silenceInfo = c.silenceInfo || c.metadata?.silence_info;
        debugLog(`  [${i}] ${c.id.slice(0,8)} name="${c.name}" start=${c.start} dur=${c.duration} type=${silenceInfo?.classification || 'speech'} asset=${c.assetId?.slice(0,8) || 'N/A'}`);
      });
      
      // 获取所有视频轨道的clips，按开始时间排序
      const videoClips = clips
        .filter(c => c.clipType === 'video')
        .sort((a, b) => a.start - b.start);
      
      const toRemove: string[] = [];
      const toUpdate: { id: string; duration: number }[] = [];
      
      for (const breathId of keptBreathIds) {
        const breathClip = videoClips.find(c => c.id === breathId);
        if (!breathClip) continue;
        
        // 找到换气片段的前一个片段（在同一轨道上，紧贴着的）
        const prevClip = videoClips.find(c => 
          c.trackId === breathClip.trackId && 
          c.id !== breathId &&
          Math.abs((c.start + c.duration) - breathClip.start) < 10 // 10ms容差
        );
        
        if (prevClip) {
          // 将换气时长加到前一个片段
          toUpdate.push({
            id: prevClip.id,
            duration: prevClip.duration + breathClip.duration
          });
          // 标记换气片段为待删除
          toRemove.push(breathId);
        } else {
          // 没有前一个片段，尝试合并到后一个
          const nextClip = videoClips.find(c => 
            c.trackId === breathClip.trackId && 
            c.id !== breathId &&
            Math.abs(breathClip.start + breathClip.duration - c.start) < 10
          );
          
          if (nextClip) {
            // 将换气合并到后一个片段（扩展后一个片段的开始时间和时长）
            // 这里我们选择更简单的方式：清除换气片段的silenceInfo，让它变成普通片段
            // 后续由 compactVideoTrack 处理位置
          }
        }
      }
      
      if (toUpdate.length === 0 && toRemove.length === 0) {
        // 没有可合并的，清除换气片段的silenceInfo标记
        set((state) => ({
          clips: state.clips.map(c => {
            if (keptBreathIds.includes(c.id)) {
              // 移除 silenceInfo，让它变成普通片段
              const { silenceInfo, ...rest } = c;
              const metadata = c.metadata ? { ...c.metadata } : undefined;
              if (metadata) {
                delete metadata.silence_info;
              }
              return { ...rest, metadata };
            }
            return c;
          })
        }));
        return;
      }
      
      // 执行合并
      set((state) => {
        let newClips = state.clips.map(c => {
          const update = toUpdate.find(u => u.id === c.id);
          if (update) {
            return { ...c, duration: update.duration };
          }
          return c;
        });
        
        // 删除已合并的换气片段
        newClips = newClips.filter(c => !toRemove.includes(c.id));
        
        return { clips: newClips };
      });
      
      // 同步到后端
      for (const update of toUpdate) {
        _addOperation('UPDATE_CLIP', { id: update.id, duration: update.duration });
      }
      for (const id of toRemove) {
        _addOperation('REMOVE_CLIP', { id });
      }
    },
    
    updateClip: (id, updates) => {
      set((state) => {
        const clip = state.clips.find(c => c.id === id);
        if (!clip) return state;
        
        return {
          clips: state.clips.map((c) => c.id === id ? { ...clip, ...updates } : c),
        };
      });
      
      // 使用预定义的字段映射常量
      const mappedUpdates: Record<string, unknown> = { id };
      
      // 特殊处理：duration -> end_time
      if ('duration' in updates) {
        const clip = get().clips.find(c => c.id === id);
        if (clip) {
          const start = updates.start ?? clip.start;
          const duration = updates.duration as number;
          mappedUpdates['end_time'] = start + duration;
        }
      }
      
      for (const [key, value] of Object.entries(updates)) {
        // 跳过 duration（已转换为 end_time）和前端独有字段
        if (key === 'duration' || FRONTEND_ONLY_FIELDS.has(key)) continue;
        
        const mappedKey = CLIP_FIELD_MAPPING[key] || key;
        mappedUpdates[mappedKey] = value;
      }
      
      get()._addOperation('UPDATE_CLIP', mappedUpdates);
    },
    
    updateClipUrl: (clipId: string, cloudUrl: string, assetId?: string) => {
      // 更新 clip 的云端 URL（上传完成后调用）
      // 同时更新所有分割产生的子 clip（它们共享同一个 parentClipId）
      const { _addOperation } = get();
      
      set((state) => {
        const originalClip = state.clips.find(c => c.id === clipId);
        const updatedClipIds: string[] = [];
        
        const newClips = state.clips.map((c) => {
          // 直接匹配 clipId
          if (c.id === clipId) {
            updatedClipIds.push(c.id);
            return { 
              ...c, 
              mediaUrl: cloudUrl, 
              isLocal: false,
              assetId,
            };
          }
          // 匹配由该 clip 分割产生的子 clip
          if (c.parentClipId === clipId || c.parentClipId === originalClip?.parentClipId) {
            updatedClipIds.push(c.id);
            return { 
              ...c, 
              mediaUrl: cloudUrl, 
              isLocal: false,
              assetId,
            };
          }
          return c;
        });
        
        return { clips: newClips };
      });
      
      // 记录操作，确保云端 URL 被同步
      _addOperation('UPDATE_CLIP', {
        id: clipId,
        url: cloudUrl,
        asset_id: assetId,
        isLocal: false,
      });
    },
    
    moveClipToTrack: (clipId, trackId, newStart) => {
      const { clips, tracks, findOrCreateTrack, _addOperation } = get();
      const clip = clips.find(c => c.id === clipId);
      if (!clip) return;
      
      const track = tracks.find(t => t.id === trackId);
      if (!track) return;
      
      const trackClips = clips.filter(c => c.trackId === trackId && c.id !== clipId);
      const hasOverlap = trackClips.some(c => isOverlapping(newStart, clip.duration, c.start, c.duration));
      
      const finalTrackId = hasOverlap 
        ? findOrCreateTrack(clip.clipType, clipId, newStart, clip.duration)
        : trackId;
      
      set((state) => ({
        clips: state.clips.map(c => 
          c.id === clipId ? { ...c, trackId: finalTrackId, start: newStart } : c
        ),
      }));
      
      _addOperation('MOVE_CLIP', { 
        clip_id: clipId, 
        track_id: finalTrackId, 
        start: newStart 
      });
    },
    
    getClipsByType: (clipType) => {
      const { clips } = get();
      return clips.filter(c => c.clipType === clipType);
    },
    
    // ========== 多选支持 ==========
    selectedClipIds: new Set(),
    selectClip: (id, multi = false) => {
      set((state) => {
        const newSet = new Set<string>();
        if (multi) {
          state.selectedClipIds.forEach(cid => newSet.add(cid));
        }
        if (newSet.has(id) && multi) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        let lastId: string | null = null;
        newSet.forEach(cid => { lastId = cid; });
        
        // ★ 根据 clip 类型自动切换模式和侧边栏
        const selectedClip = state.clips.find(c => c.id === id);
        const clipType = selectedClip?.clipType;
        
        // 确定 canvasEditMode 和 activeSidebarPanel
        let canvasEditMode = state.canvasEditMode;
        let activeSidebarPanel = state.activeSidebarPanel;
        
        if (clipType === 'video') {
          canvasEditMode = 'transform';
          activeSidebarPanel = 'transform';
        } else if (clipType === 'text') {
          canvasEditMode = 'text';
          activeSidebarPanel = 'text';
        } else if (clipType === 'subtitle') {
          canvasEditMode = 'subtitle';
          activeSidebarPanel = 'subtitle';
        }
        
        return { 
          selectedClipIds: newSet,
          selectedClipId: newSet.size === 1 ? id : (newSet.size > 0 ? lastId : null),
          canvasEditMode,
          activeSidebarPanel,
        };
      });
    },
    selectAllClips: () => {
      const { clips } = get();
      set({ 
        selectedClipIds: new Set(clips.map(c => c.id)),
        selectedClipId: clips.length > 0 ? clips[clips.length - 1].id : null,
      });
    },
    selectClipsByIds: (ids: string[]) => {
      if (ids.length === 0) {
        set({ selectedClipIds: new Set(), selectedClipId: null });
        return;
      }
      set({
        selectedClipIds: new Set(ids),
        selectedClipId: ids[ids.length - 1],
      });
    },
    clearSelection: () => set({ selectedClipIds: new Set(), selectedClipId: null }),
    
    selectedClipId: null,
    setSelectedClipId: (id) => {
      const { clips, canvasEditMode, activeSidebarPanel } = get();
      const selectedClip = id ? clips.find(c => c.id === id) : null;
      const clipType = selectedClip?.clipType;
      
      // ★ 根据 clip 类型确定模式和侧边栏
      let newCanvasEditMode = canvasEditMode;
      let newActiveSidebarPanel = activeSidebarPanel;
      
      if (clipType === 'video') {
        newCanvasEditMode = 'transform';
        newActiveSidebarPanel = 'transform';
      } else if (clipType === 'text' || clipType === 'subtitle') {
        newCanvasEditMode = 'text';
        newActiveSidebarPanel = 'text';
      }
      
      set({ 
        selectedClipId: id,
        selectedClipIds: id ? new Set([id]) : new Set(),
        canvasEditMode: newCanvasEditMode,
        activeSidebarPanel: newActiveSidebarPanel,
      });
    },

    // ========== 片段操作 (CapCut 风格) ==========
    splitClip: (clipId, splitTime) => {
      const { clips, saveToHistory, _addOperation } = get();
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      const relativeTime = splitTime - clip.start;
      // 使用毫秒阈值：100ms
      if (relativeTime <= 100 || relativeTime >= clip.duration - 100) return;

      saveToHistory();

      const newClipId = generateId();
      
      // 更新原片段（缩短时长）
      const updatedClip: Clip = {
        ...clip,
        duration: relativeTime,
        // 如果有 sourceEnd，也需要更新
      };

      // 创建新片段（分割后的后半部分）
      const newClip: Clip = {
        ...clip,
        id: newClipId,
        start: clip.start + relativeTime,
        duration: clip.duration - relativeTime,
        sourceStart: (clip.sourceStart || 0) + relativeTime,
        parentClipId: clip.id,  // 用于后端追溯
      };

      set((state) => ({
        clips: state.clips.flatMap((c) =>
          c.id === clipId ? [updatedClip, newClip] : [c]
        ),
      }));
      
      // 发送更新原片段操作
      _addOperation('UPDATE_CLIP', {
        id: clipId,
        end_time: clip.start + relativeTime,
      });
      
      // 发送添加新片段操作（包含完整信息用于后端存储）
      _addOperation('ADD_CLIP', {
        id: newClipId,
        track_id: clip.trackId,
        asset_id: clip.assetId,
        parent_clip_id: clipId,
        clip_type: clip.clipType,
        start_time: clip.start + relativeTime,
        end_time: clip.start + clip.duration,
        source_start: (clip.sourceStart || 0) + relativeTime,
        name: clip.name ? `${clip.name}_split` : undefined,
        volume: clip.volume,
        is_muted: clip.isMuted,
      });
    },

    splitAllAtTime: (splitTime) => {
      const { clips, saveToHistory, _addOperation } = get();
      
      // 使用毫秒阈值：100ms
      const clipsToSplit = clips.filter(
        (c) => splitTime > c.start + 100 && splitTime < c.start + c.duration - 100
      );
      
      if (clipsToSplit.length === 0) return;
      
      saveToHistory();

      const operations: Array<{ type: OperationType; payload: Record<string, unknown> }> = [];
      
      const newClips = clips.flatMap((clip) => {
        const relativeTime = splitTime - clip.start;
        
        // 使用毫秒阈值：100ms
        if (relativeTime <= 100 || relativeTime >= clip.duration - 100) {
          return [clip];
        }

        const newClipId = generateId();
        
        // 更新原片段
        const updatedClip: Clip = {
          ...clip,
          duration: relativeTime,
        };

        // 创建新片段
        const newClip: Clip = {
          ...clip,
          id: newClipId,
          start: clip.start + relativeTime,
          duration: clip.duration - relativeTime,
          sourceStart: (clip.sourceStart || 0) + relativeTime,
          parentClipId: clip.id,
        };

        // 添加更新操作
        operations.push({
          type: 'UPDATE_CLIP',
          payload: { id: clip.id, end_time: clip.start + relativeTime }
        });
        
        // 添加新片段操作
        operations.push({
          type: 'ADD_CLIP',
          payload: { 
            id: newClipId,
            track_id: clip.trackId,
            asset_id: clip.assetId,
            parent_clip_id: clip.id,
            clip_type: clip.clipType,
            start_time: clip.start + relativeTime,
            end_time: clip.start + clip.duration,
            source_start: (clip.sourceStart || 0) + relativeTime,
            name: clip.name ? `${clip.name}_split` : undefined,
          }
        });

        return [updatedClip, newClip];
      });

      set({ clips: newClips });
      
      // 批量记录操作
      operations.forEach(op => _addOperation(op.type, op.payload));
    },

    duplicateClip: (clipId) => {
      const { clips, saveToHistory, findOrCreateTrack, _addOperation } = get();
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      saveToHistory();

      const sameTrackClips = clips.filter((c) => c.trackId === clip.trackId);
      const lastEnd = sameTrackClips.length > 0 
        ? Math.max(...sameTrackClips.map((c) => c.start + c.duration))
        : 0;
      
      // 200ms 间隔
      const newStart = lastEnd + 200;
      const targetTrackId = findOrCreateTrack(clip.clipType, '', newStart, clip.duration);
      const newClipId = generateId();

      const newClip: Clip = {
        ...clip,
        id: newClipId,
        trackId: targetTrackId,
        start: newStart,
        parentClipId: clip.id,
      };

      set((state) => ({ clips: [...state.clips, newClip] }));
      
      _addOperation('ADD_CLIP', {
        id: newClipId,
        track_id: targetTrackId,
        asset_id: clip.assetId,
        parent_clip_id: clip.id,
        clip_type: clip.clipType,
        start_time: newStart,
        end_time: newStart + clip.duration,
        source_start: clip.sourceStart ?? 0,
        name: clip.name,
        volume: clip.volume ?? 1,
        is_muted: clip.isMuted ?? false,
      });
    },

    deleteSelectedClip: () => {
      const { selectedClipIds, clips, saveToHistory, _addOperation } = get();
      if (selectedClipIds.size === 0) return;
      
      saveToHistory();
      
      const idsToDelete = Array.from(selectedClipIds);
      
      set({
        clips: clips.filter((c) => !selectedClipIds.has(c.id)),
        selectedClipIds: new Set(),
        selectedClipId: null,
        toolMode: 'select',
      });
      
      // 记录所有删除操作
      idsToDelete.forEach(id => {
        _addOperation('REMOVE_CLIP', { clip_id: id });
      });
    },

    // ========== 历史记录 (撤销/重做) ==========
    history: [],
    historyIndex: -1,
    
    saveToHistory: () => {
      const { clips, transcript, tracks, history, historyIndex } = get();
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push({
        clips: JSON.parse(JSON.stringify(clips)),
        transcript: JSON.parse(JSON.stringify(transcript)),
        tracks: JSON.parse(JSON.stringify(tracks)),
      });
      if (newHistory.length > 50) {
        newHistory.shift();
      }
      set({
        history: newHistory,
        historyIndex: newHistory.length - 1,
      });
    },

    undo: () => {
      const { history, historyIndex } = get();
      if (historyIndex < 0) return;
      
      const previousState = history[historyIndex];
      set({
        clips: previousState.clips,
        transcript: previousState.transcript,
        tracks: previousState.tracks,
        historyIndex: historyIndex - 1,
        toolMode: 'select',
      });
    },

    redo: () => {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      
      const nextState = history[historyIndex + 1];
      set({
        clips: nextState.clips,
        transcript: nextState.transcript,
        tracks: nextState.tracks,
        historyIndex: historyIndex + 1,
      });
    },

    canUndo: () => get().historyIndex >= 0,
    canRedo: () => {
      const { history, historyIndex } = get();
      return historyIndex < history.length - 1;
    },

    // ========== 工具模式 ==========
    toolMode: 'select',
    setToolMode: (mode) => set({ toolMode: mode }),

    // ========== 文稿转写 ==========
    transcript: [],
    setTranscript: (segments) => set({ transcript: segments }),

    toggleSegmentDeleted: (id) => {
      const { _addOperation } = get();
      set((state) => ({
        transcript: state.transcript.map((t) =>
          t.id === id ? { ...t, deleted: !t.deleted } : t
        ),
      }));
      
      const segment = get().transcript.find(t => t.id === id);
      _addOperation('UPDATE_SEGMENT', { 
        id, 
        is_deleted: segment?.deleted 
      });
    },

    markSegmentsAsDeleted: (type) => {
      const { _addOperation } = get();
      set((state) => ({
        transcript: state.transcript.map((t) =>
          t.type === type ? { ...t, deleted: true } : t
        ),
      }));
      
      _addOperation('BATCH_UPDATE', {
        target: 'segments',
        filter: { type },
        updates: { is_deleted: true }
      });
    },
    
    updateSegment: (id, updates) => {
      const { _addOperation } = get();
      set((state) => ({
        transcript: state.transcript.map((t) =>
          t.id === id ? { ...t, ...updates } : t
        ),
      }));
      
      _addOperation('UPDATE_SEGMENT', { id, ...updates });
    },

    // ========== 播放状态 ==========
    currentTime: 0,
    isPlaying: false,
    isVideoReady: false,
    duration: 0,
    setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),
    setIsPlaying: (playing) => set({ isPlaying: playing }),
    setIsVideoReady: (ready) => set({ isVideoReady: ready }),
    setDuration: (duration) => set({ duration }),

    // ========== 当前活动视频 ==========
    activeVideoUrl: null,
    setActiveVideoUrl: (url) => set({ activeVideoUrl: url }),

    // ========== 时间轴 ==========
    zoomLevel: 1.0,
    // 缩放范围：0.05 (约 15f) 到 20.0 (放大 20 倍，毫秒级精度)
    setZoomLevel: (level) => set({ zoomLevel: Math.max(0.05, Math.min(20, level)) }),

    // ========== 右键菜单 ==========
    contextMenu: { visible: false, x: 0, y: 0, clipId: null },
    openContextMenu: (x, y, clipId) => {
      set({ contextMenu: { visible: true, x, y, clipId }, selectedClipId: clipId });
    },
    closeContextMenu: () => {
      set((state) => ({ contextMenu: { ...state.contextMenu, visible: false } }));
    },

    // ========== 处理状态 ==========
    isProcessing: false,
    processType: '',
    processProgress: 0,
    currentTaskId: null,
    setProcessing: (isProcessing, type = '', progress = 0) => set({ 
      isProcessing, 
      processType: type,
      processProgress: progress,
    }),
    setCurrentTaskId: (taskId) => set({ currentTaskId: taskId }),
    cancelCurrentTask: async () => {
      const { currentTaskId, setProcessing, setCurrentTaskId } = get();
      if (!currentTaskId) {
        setProcessing(false);
        return;
      }
      
      try {
        // 调用后端取消任务 API
        await fetch(`/api/tasks/${currentTaskId}/cancel`, { method: 'POST' });
      } catch (e) {
        debugWarn('取消任务失败:', e);
      }
      
      setCurrentTaskId(null);
      setProcessing(false);
    },

    // ========== ASR 进度弹窗 ==========
    asrProgress: {
      visible: false,
      status: 'idle' as ASRProgressStatus,
      progress: 0,
      message: undefined,
      error: undefined,
    },
    setASRProgress: (state) => set((prev) => ({
      asrProgress: { ...prev.asrProgress, ...state }
    })),
    closeASRProgress: () => set({
      asrProgress: {
        visible: false,
        status: 'idle' as ASRProgressStatus,
        progress: 0,
        message: undefined,
        error: undefined,
      }
    }),

    // ========== AI 功能 ==========
    extractSpeechFromClip: async (clipId) => {
      const { setProcessing, setASRProgress, projectId, loadClips } = get();
      
      try {
        // 显示进度弹窗
        setASRProgress({
          visible: true,
          status: 'processing',
          progress: 0,
          message: '正在启动语音识别...',
        });
        setProcessing(true, 'stt', 0);
        
        // 使用新的 /asr-clip 接口，直接传 clip_id
        const startResult = await taskApi.startASRClipTask({
          clip_id: clipId,
          language: 'zh',
        });
        
        if (startResult.error || !startResult.data) {
          throw new Error(startResult.error?.message || '启动转写失败');
        }
        const taskId = startResult.data.task_id;
        
        setASRProgress({
          progress: 10,
          message: '语音识别处理中...',
        });
        
        // 轮询任务状态
        const result = await taskApi.pollTaskUntilComplete<{ 
          clips_count?: number;
          duration?: number;
        }>(
          taskId,
          {
            interval: 2000,
            timeout: 600000, // 10分钟超时
            onProgress: (progress, step) => {
              setProcessing(true, 'stt', progress);
              setASRProgress({
                progress,
                message: step || '语音识别处理中...',
              });
              debugLog(`ASR 进度: ${progress}%, 步骤: ${step || '处理中'}`);
            }
          }
        );
        
        if (result.error || !result.data?.result) {
          throw new Error(result.error?.message || '转写失败');
        }
        
        // ★ 后端已经自动创建了 subtitle clips，现在刷新前端数据
        const clipsCreated = result.data.result.clips_count || 0;
        debugLog(`ASR 完成，后端创建了 ${clipsCreated} 个字幕片段`);
        
        // 先显示"正在刷新"状态
        setASRProgress({
          progress: 95,
          message: '正在刷新时间轴...',
        });
        
        // ★ 先刷新 clips 列表，再显示完成状态
        if (projectId) {
          await loadClips();
        }
        
        // 刷新完成后再显示成功
        setASRProgress({
          status: 'completed',
          progress: 100,
          message: `成功提取 ${clipsCreated} 个字幕片段`,
        });
        
        setProcessing(false);
        
        // 3秒后自动关闭进度弹窗
        setTimeout(() => {
          get().closeASRProgress();
        }, 3000);
        
      } catch (error) {
        debugError('ASR 失败:', error);
        setProcessing(false);
        setASRProgress({
          status: 'error',
          error: error instanceof Error ? error.message : '未知错误',
        });
        throw error;
      }
    },
    
    startASR: async (assetId: string) => {
      const { setProcessing, setASRProgress, projectId, loadClips } = get();
      
      try {
        setProcessing(true, 'stt', 0);
        setASRProgress({
          visible: true,
          status: 'processing',
          progress: 0,
          message: '正在启动语音识别...',
        });
        
        // 启动 ASR 任务
        const startResult = await taskApi.startASRTask({
          asset_id: assetId,
          language: 'zh',
          enable_word_timestamps: true,
        });
        
        if (startResult.error || !startResult.data) {
          throw new Error(startResult.error?.message || '启动转写失败');
        }
        
        // 轮询任务状态
        const result = await taskApi.pollTaskUntilComplete<{ 
          segments: TranscriptSegment[];
          clips_count?: number;
        }>(
          startResult.data.task_id,
          {
            onProgress: (progress, step) => {
              setProcessing(true, 'stt', progress);
              setASRProgress({
                progress,
                message: step || '语音识别处理中...',
              });
            }
          }
        );
        
        if (result.error || !result.data?.result) {
          throw new Error(result.error?.message || '转写失败');
        }
        
        // 后端已自动创建 clips，刷新前端数据
        const clipsCreated = result.data.result.clips_count || 0;
        
        setASRProgress({
          status: 'completed',
          progress: 100,
          message: `成功提取 ${clipsCreated} 个字幕片段`,
        });
        
        // 局部刷新 clips
        if (projectId) {
          await loadClips();
        }
        
        setProcessing(false);
        
        // 3秒后自动关闭
        setTimeout(() => {
          get().closeASRProgress();
        }, 3000);
        
      } catch (error) {
        debugError('ASR 失败:', error);
        setProcessing(false);
        setASRProgress({
          status: 'error',
          error: error instanceof Error ? error.message : '未知错误',
        });
        throw error;
      }
    },
    
    startStemSeparation: async (assetId: string): Promise<void> => {
      const { setProcessing, clips, assets, findOrCreateTrack, 
              saveToHistory, _addOperation } = get();
      
      // 查找源 asset 信息
      const sourceAsset = assets.find(a => a.id === assetId);
      if (!sourceAsset) {
        throw new Error('未找到源资源');
      }
      
      // 找到使用这个 asset 的 clip
      const sourceClip = clips.find(c => c.mediaUrl === sourceAsset.url);
      const clipStart = sourceClip?.start || 0;
      const clipDuration = sourceClip?.duration || sourceAsset.metadata?.duration || 0;
      
      try {
        setProcessing(true, 'stem', 0);
        
        const startResult = await taskApi.startStemSeparation({
          asset_id: assetId,
          stems: ['vocals', 'accompaniment'],
        });
        
        if (startResult.error || !startResult.data) {
          throw new Error(startResult.error?.message || '启动音频分离失败');
        }
        
        const result = await taskApi.pollTaskUntilComplete<{
          stems: Array<{
            type: string;
            asset_id: string;
            url: string;
            duration: number;
          }>;
        }>(
          startResult.data.task_id,
          {
            interval: 3000,
            timeout: 900000, // 15分钟超时（人声分离耗时长）
            onProgress: (progress) => {
              setProcessing(true, 'stem', progress);
              debugLog(`人声分离进度: ${progress}%`);
            }
          }
        );
        
        if (result.error || !result.data?.result) {
          throw new Error(result.error?.message || '人声分离失败');
        }
        
        saveToHistory();
        
        // 为分离结果创建新的音频轨道 clips
        const stems = result.data.result.stems;
        const newClips: Clip[] = [];
        
        for (const stem of stems) {
          // 找一个可用的轨道或创建新轨道
          const trackId = findOrCreateTrack('audio', '', clipStart, stem.duration || clipDuration);
          
          const stemClip: Clip = {
            id: generateId(),
            name: stem.type === 'vocals' ? '人声' : '背景音',
            trackId,
            clipType: 'audio',
            start: clipStart,
            duration: stem.duration || clipDuration,
            color: stem.type === 'vocals' 
              ? 'from-blue-400/80 to-indigo-500/60' 
              : 'from-indigo-400/80 to-blue-500/60',
            isLocal: false,
            mediaUrl: stem.url,
            sourceStart: 0,
            volume: 1.0,
            isMuted: false,
            speed: 1.0,
          };
          
          newClips.push(stemClip);
          
          // 记录操作
          _addOperation('ADD_CLIP', {
            id: stemClip.id,
            track_id: trackId,
            clip_type: 'audio',
            start_time: stemClip.start,
            end_time: stemClip.start + stemClip.duration,
            name: stemClip.name,
          });
        }
        
        // 批量添加 clips
        set((state) => ({ clips: [...state.clips, ...newClips] }));
        
        // 更新 assets 列表
        const newAssets = stems.map((stem: Record<string, unknown>) => ({
          id: (stem.asset_id ?? stem.assetId) as string,
          project_id: sourceAsset.project_id,
          type: stem.type === 'vocals' ? 'stem_vocals' : 'stem_accompaniment',
          url: stem.url as string,
          storage_path: '',
          file_name: stem.type === 'vocals' ? '人声.wav' : '背景音.wav',
          file_size: 0,
          mime_type: 'audio/wav',
          metadata: { duration: stem.duration as number },
          is_generated: true,
          parent_asset_id: assetId,
          status: 'ready',
          processing_progress: 100,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        
        set((state) => ({ 
          assets: [...state.assets, ...newAssets as unknown as Asset[]] 
        }));
        
        setProcessing(false);
        debugLog(`人声分离完成，创建了 ${newClips.length} 个音频片段`);
        
      } catch (error) {
        debugError('音频分离失败:', error);
        setProcessing(false);
        throw error;
      }
    },
    
    /**
     * 分离视频声音 - 从视频中提取音频轨道
     */
    extractAudio: async (clipId: string) => {
      const { clips, assets, saveToHistory, setProcessing, findOrCreateTrack, _addOperation } = get();
      
      const sourceClip = clips.find(c => c.id === clipId);
      if (!sourceClip) {
        debugError('找不到源片段:', clipId);
        return;
      }
      
      // 只能对视频 clip 进行音频提取
      if (sourceClip.clipType !== 'video') {
        debugError('只能对视频片段进行音频提取');
        return;
      }
      
      // 找到 clip 对应的 asset
      const sourceAsset = assets.find(a => 
        sourceClip.mediaUrl?.includes(a.id) || 
        sourceClip.mediaUrl?.includes(a.storage_path || '')
      );
      
      if (!sourceAsset) {
        debugError('找不到源素材');
        return;
      }
      
      const assetId = sourceAsset.id;
      // sourceStart: 从原视频的哪个位置开始截取（毫秒）
      const sourceStartMs = sourceClip.sourceStart || 0;
      const clipDuration = sourceClip.duration || sourceAsset.metadata?.duration || 0;
      // clipStart: clip 在时间轴上的位置（毫秒）
      const clipStart = sourceClip.start || 0;
      
      try {
        setProcessing(true, 'extract', 0);
        
        const startResult = await taskApi.startExtractAudio({
          asset_id: assetId,
          format: 'wav',
          source_start: sourceStartMs,  // 传递殥秒
          duration: clipDuration,  // 传递殥秒
        });
        
        if (startResult.error || !startResult.data) {
          throw new Error(startResult.error?.message || '启动音频提取失败');
        }
        
        // 保存任务 ID，支持取消
        get().setCurrentTaskId(startResult.data.task_id);
        
        const result = await taskApi.pollTaskUntilComplete<{
          audio: {
            asset_id: string;
            url: string;
            duration: number;
            format: string;
            filename: string;
          };
        }>(
          startResult.data.task_id,
          {
            interval: 2000,
            timeout: 300000, // 5分钟超时
            onProgress: (progress) => {
              setProcessing(true, 'extract', progress);
            }
          }
        );
        
        // 清除任务 ID
        get().setCurrentTaskId(null);
        
        if (result.error || !result.data?.result) {
          throw new Error(result.error?.message || '音频提取失败');
        }
        
        saveToHistory();
        
        // 创建新的音频 clip
        const audioData = result.data.result.audio;
        const trackId = findOrCreateTrack('audio', '', clipStart, audioData.duration || clipDuration);
        
        const audioClip: Clip = {
          id: generateId(),
          name: audioData.filename || '提取的音频',
          trackId,
          clipType: 'audio',
          start: clipStart,
          duration: audioData.duration || clipDuration,
          color: 'from-green-400/80 to-teal-500/60',
          isLocal: false,
          mediaUrl: audioData.url,
          assetId: audioData.asset_id, // 添加 asset_id
          sourceStart: 0,
          volume: 1.0,
          isMuted: false,
          speed: 1.0,
        };
        
        // 记录操作
        _addOperation('ADD_CLIP', {
          id: audioClip.id,
          track_id: trackId,
          asset_id: audioData.asset_id,
          clip_type: 'audio',
          start_time: audioClip.start,
          end_time: audioClip.start + audioClip.duration,
          name: audioClip.name,
        });
        
        // 添加 clip
        set((state) => ({ clips: [...state.clips, audioClip] }));
        
        // ★ 关键：将源视频 clip 静音（音频已提取到单独轨道）
        set((state) => ({
          clips: state.clips.map(c => 
            c.id === clipId ? { ...c, isMuted: true } : c
          )
        }));
        
        // 同步到后端：更新视频 clip 的 is_muted
        _addOperation('UPDATE_CLIP', {
          id: clipId,
          is_muted: true,
        });
        
        // 添加 asset
        const newAsset = {
          id: audioData.asset_id,
          project_id: sourceAsset.project_id,
          type: 'extracted_audio',
          url: audioData.url,
          storage_path: '',
          file_name: audioData.filename,
          file_size: 0,
          mime_type: 'audio/wav',
          metadata: { duration: audioData.duration },
          is_generated: true,
          parent_asset_id: assetId,
          status: 'ready',
          processing_progress: 100,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        
        set((state) => ({ 
          assets: [...state.assets, newAsset as unknown as Asset] 
        }));
        
        setProcessing(false);
        debugLog(`音频提取完成，创建了音频片段: ${audioClip.id}`);
        
      } catch (error) {
        debugError('音频提取失败:', error);
        setProcessing(false);
        throw error;
      }
    },
    
    startSmartClean: async () => {
      const { projectId, setProcessing, transcript, setTranscript } = get();
      if (!projectId) return;
      
      try {
        setProcessing(true, 'clean', 0);
        
        const startResult = await smartApi.smartClean({
          project_id: projectId,
          max_silence_duration: 2.0,
          remove_filler_words: true,
        });
        
        if (startResult.error || !startResult.data) {
          throw new Error(startResult.error?.message || '启动智能清洗失败');
        }
        
        const result = await taskApi.pollTaskUntilComplete<{ suggestions: Array<{ segment_id: string }> }>(
          startResult.data.task_id,
          {
            onProgress: (progress) => {
              setProcessing(true, 'clean', progress);
            }
          }
        );
        
        if (result.error || !result.data?.result) {
          throw new Error(result.error?.message || '智能清洗失败');
        }
        
        // 自动应用建议
        const suggestions = result.data.result.suggestions;
        const segmentIds = suggestions.map(s => s.segment_id).filter(Boolean) as string[];
        
        setTranscript(transcript.map(t => ({
          ...t,
          deleted: segmentIds.includes(t.id) ? true : t.deleted,
        })));
        
        setProcessing(false);
        
      } catch (error) {
        debugError('智能清洗失败:', error);
        setProcessing(false);
        throw error;
      }
    },
    
    startExport: async (config) => {
      const { projectId, setProcessing } = get();
      if (!projectId) throw new Error('没有打开的项目');
      
      try {
        setProcessing(true, 'export', 0);
        
        // ★ 支持自定义参数
        const startResult = await exportApi.startExport({
          project_id: projectId,
          preset: config?.resolution || 'original',
          custom_settings: {
            fps: config?.fps || 30,
          },
        });
        
        if (startResult.error || !startResult.data) {
          throw new Error(startResult.error?.message || '启动导出失败');
        }
        
        const result = await exportApi.pollExportUntilComplete(
          startResult.data.job_id,
          {
            onProgress: (progress) => {
              setProcessing(true, 'export', progress);
            }
          }
        );
        
        if (result.error || !result.data?.output_url) {
          throw new Error(result.error?.message || '导出失败');
        }
        
        setProcessing(false);
        return result.data.output_url;
        
      } catch (error) {
        debugError('导出失败:', error);
        setProcessing(false);
        throw error;
      }
    },

    // ========== Clips 局部刷新 ==========
    loadClips: async (clipType?: string) => {
      const { projectId, tracks } = get();
      if (!projectId) {
        debugWarn('[loadClips] 没有打开的项目');
        return;
      }
      
      try {
        debugLog('[loadClips] 开始加载 clips, projectId:', projectId, 'clipType:', clipType);
        
        const response = await clipsApi.getClipsByProject(projectId, clipType);
        
        if (response.error) {
          debugError('[loadClips] 加载失败:', response.error);
          return;
        }
        
        const newClips = response.data || [];
        debugLog('[loadClips] 加载成功，获取到', newClips.length, '个 clips');
        
        // 如果指定了 clipType，只更新该类型的 clips，保留其他类型
        if (clipType) {
          set((state) => {
            const otherClips = state.clips.filter(c => c.clipType !== clipType);
            return { clips: [...otherClips, ...newClips] };
          });
        } else {
          // 替换所有 clips
          set({ clips: newClips });
        }
        
        // 如果加载了新的 tracks（字幕轨道），也需要更新
        // 检查是否有新的 trackId 需要添加
        const existingTrackIds = new Set(tracks.map(t => t.id));
        const newTrackIds = new Set(newClips.map(c => c.trackId).filter(id => !existingTrackIds.has(id)));
        
        if (newTrackIds.size > 0) {
          // 需要重新加载 tracks（这种情况很少发生）
          debugLog('[loadClips] 发现新的轨道，需要刷新 tracks');
          // 可以调用 projectApi 获取最新的 tracks，但这里简单处理
          // 创建临时的字幕轨道
          const newTracks: Track[] = Array.from(newTrackIds).map((id, index) => ({
            id,
            name: 'Subtitles',
            orderIndex: -1 - index, // 放在底部
            color: 'text-yellow-400',
            isVisible: true,
            isLocked: false,
            isMuted: false,
          }));
          
          set((state) => ({
            tracks: [...state.tracks, ...newTracks]
          }));
        }
        
      } catch (error) {
        debugError('[loadClips] 加载异常:', error);
      }
    },
    
    refreshSubtitleClips: async () => {
      // 只刷新 subtitle 类型的 clips
      await get().loadClips('subtitle');
    },

    // ★ 新增：刷新素材列表
    loadAssets: async () => {
      const { projectId } = get();
      if (!projectId) {
        debugWarn('[loadAssets] 没有打开的项目');
        return;
      }
      
      try {
        debugLog('[loadAssets] 开始加载 assets, projectId:', projectId);
        
        const response = await assetApi.getAssets({ project_id: projectId });
        
        if (response.error) {
          debugError('[loadAssets] 加载失败:', response.error);
          return;
        }
        
        const rawAssets = response.data?.items || [];
        debugLog('[loadAssets] 加载成功，获取到', rawAssets.length, '个 assets');
        
        // 映射字段：后端返回的是 snake_case，前端使用 camelCase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mappedAssets: Asset[] = rawAssets.map((a: any) => ({
          id: a.id as string,
          project_id: a.project_id as string,
          name: (a.name || a.original_filename || 'Asset') as string,
          type: (a.type || a.file_type || 'video') as Asset['type'],
          subtype: a.subtype as string | undefined,
          url: a.url as string,
          thumbnail_url: a.thumbnail_url as string | undefined,
          file_size: a.file_size as number | undefined,
          mime_type: a.mime_type as string | undefined,
          status: (a.status || 'ready') as string,
          metadata: {
            duration: a.duration as number | undefined,
            width: a.width as number | undefined,
            height: a.height as number | undefined,
            fps: a.fps as number | undefined,
            sample_rate: a.sample_rate as number | undefined,
            channels: a.channels as number | undefined,
          },
          created_at: a.created_at as string,
          updated_at: a.updated_at as string,
        }));
        
        set({ assets: mappedAssets });
        
      } catch (error) {
        debugError('[loadAssets] 加载异常:', error);
      }
    },

    // ★ 新增：刷新关键帧
    loadKeyframes: async () => {
      const { projectId } = get();
      if (!projectId) {
        debugWarn('[loadKeyframes] 没有打开的项目');
        return;
      }
      
      try {
        debugLog('[loadKeyframes] 开始加载 keyframes, projectId:', projectId);
        
        // 动态导入避免循环依赖
        const { keyframesApi } = await import('@/lib/api/keyframes');
        const response = await keyframesApi.getProjectKeyframes(projectId);
        
        if (response.error) {
          debugError('[loadKeyframes] 加载失败:', response.error);
          return;
        }
        
        const rawKeyframes = response.data?.keyframes || [];
        debugLog('[loadKeyframes] 加载成功，获取到', rawKeyframes.length, '个关键帧');
        
        // 构建 keyframes Map（与 loadProject 逻辑一致）
        const keyframesMap: Map<string, Map<string, Keyframe[]>> = new Map();
        for (const kf of rawKeyframes) {
          if (!keyframesMap.has(kf.clipId)) {
            keyframesMap.set(kf.clipId, new Map());
          }
          const clipMap = keyframesMap.get(kf.clipId)!;
          const prop = kf.property as KeyframeProperty;
          if (!clipMap.has(prop)) {
            clipMap.set(prop, []);
          }
          
          // ★ 处理 value 类型：将可选属性转换为必填属性
          let keyframeValue: number | { x: number; y: number };
          if (typeof kf.value === 'object' && kf.value !== null) {
            // 复合值（scale/position）
            keyframeValue = {
              x: (kf.value as { x?: number; y?: number }).x ?? 0,
              y: (kf.value as { x?: number; y?: number }).y ?? 0,
            };
          } else {
            // 简单数值（rotation/opacity）
            keyframeValue = typeof kf.value === 'number' ? kf.value : 0;
          }
          
          clipMap.get(prop)!.push({
            id: kf.id,
            clipId: kf.clipId,
            property: prop,
            offset: kf.offset,
            value: keyframeValue,
            easing: (kf.easing as EasingType) || 'linear',
          });
        }
        
        // 按 offset 排序
        for (const [, clipMap] of Array.from(keyframesMap.entries())) {
          for (const [, kfList] of Array.from(clipMap.entries())) {
            kfList.sort((a, b) => a.offset - b.offset);
          }
        }
        
        set({ keyframes: keyframesMap });
        debugLog('[loadKeyframes] ✅ 关键帧加载完成');
        
      } catch (error) {
        debugError('[loadKeyframes] 加载异常:', error);
      }
    },

    // ========== 内部方法 ==========
    _syncManager: null,
    
    _initSyncManager: (projectId: string, version: number) => {
      const currentManager = get()._syncManager;
      if (currentManager) {
        currentManager.destroy();
      }
      
      const manager = new SyncManager(projectId, version, {
        debounceMs: 300,
        // Step 6: 传入 getState 回调，用于构建同步 payload（包含 keyframes）
        getState: () => {
          const state = get();
          // 将 keyframes Map 转为数组
          const keyframesArray: Keyframe[] = [];
          for (const [, clipMap] of Array.from(state.keyframes.entries())) {
            for (const [, kfList] of Array.from(clipMap.entries())) {
              keyframesArray.push(...kfList);
            }
          }
          return {
            tracks: state.tracks,
            clips: state.clips,
            keyframes: keyframesArray,
          };
        },
        onStatusChange: (status) => {
          set({ syncStatus: status });
        },
        onSynced: (newVersion) => {
          set({ 
            projectVersion: newVersion,
            pendingChanges: 0,
            lastSavedAt: new Date(),
          });
          // ★ 同步成功后清除本地缓存
          markLocalStorageSynced(projectId);
        },
        onVersionConflict: (serverVersion) => {
          debugWarn(`版本冲突：服务器版本 ${serverVersion}`);
          // 可以触发 UI 提示
        },
        onError: (error) => {
          debugError('同步错误:', error);
        },
      });
      
      set({ _syncManager: manager });
    },
    
    _addOperation: (type: OperationType, payload: Record<string, unknown>) => {
      const { _syncManager, pendingChanges, projectId, clips, tracks, projectVersion } = get();
      if (_syncManager) {
        _syncManager.addOperation(type, payload);
        set({ pendingChanges: pendingChanges + 1 });
      }
      
      // ★ 立即保存到 localStorage，防止刷新丢失
      if (projectId) {
        saveToLocalStorage(projectId, clips, tracks, projectVersion, true);
      }
    },
    
    // ========== 关键帧系统实现 ==========
    keyframes: new Map(),
    selectedKeyframeIds: new Set(),
    
    // ========== 画布编辑模式实现 ==========
    canvasEditMode: null,
    setCanvasEditMode: (mode) => {
      set({ canvasEditMode: mode });
    },
    
    // ========== 侧边栏面板控制 ==========
    activeSidebarPanel: null,
    setActiveSidebarPanel: (panel) => {
      let canvasEditMode: 'transform' | 'text' | 'subtitle' | null = null;
      if (panel === 'text') canvasEditMode = 'text';
      else if (panel === 'subtitle') canvasEditMode = 'subtitle';
      else if (panel === 'transform') canvasEditMode = 'transform';
      
      set({ activeSidebarPanel: panel, canvasEditMode });
    },
    
    // ========== 左侧栏面板控制 ==========
    activeLeftPanel: null,
    setActiveLeftPanel: (panel) => {
      set({ activeLeftPanel: panel });
    },
    
    // ========== 画布/导出比例（青色框固定比例）==========
    canvasAspectRatio: '9:16',  // 默认抖音竖屏比例
    setCanvasAspectRatio: (ratio) => {
      set({ canvasAspectRatio: ratio });
    },
    
    // ========== 关键帧操作 V2（使用 offset） ==========
    addKeyframe: (clipId, property, offset, value, easing = 'linear') => {
      const { keyframes, _addOperation } = get();
      // 使用 UUID 格式，兼容数据库
      const keyframeId = generateId();
      
      // 确保 offset 在有效范围内
      const clampedOffset = Math.max(0, Math.min(1, offset));
      
      const newKeyframe: Keyframe = {
        id: keyframeId,
        clipId,
        property,
        offset: clampedOffset,
        value,
        easing,
      };
      
      // ★ 深拷贝整个 Map 结构，确保 zustand 能检测到变化
      const newKeyframes = cloneKeyframeMap(keyframes);
      
      // 确保目标 clip 和 property 存在
      if (!newKeyframes.has(clipId)) {
        newKeyframes.set(clipId, new Map());
      }
      const clipKeyframes = newKeyframes.get(clipId)!;
      if (!clipKeyframes.has(property)) {
        clipKeyframes.set(property, []);
      }
      
      // 检查是否已存在相近 offset 的关键帧（使用 MIN_DISTANCE 常量）
      const propertyKeyframes = clipKeyframes.get(property)!;
      const existingIndex = propertyKeyframes.findIndex(
        kf => Math.abs(kf.offset - clampedOffset) < KEYFRAME_TOLERANCE.MIN_DISTANCE
      );
      
      if (existingIndex >= 0) {
        // 更新已存在的关键帧
        propertyKeyframes[existingIndex] = { 
          ...propertyKeyframes[existingIndex], 
          value, 
          easing 
        };
      } else {
        // 添加新关键帧并按 offset 排序
        propertyKeyframes.push(newKeyframe);
        propertyKeyframes.sort((a, b) => a.offset - b.offset);
      }
      
      set({ 
        keyframes: newKeyframes,
        selectedKeyframeIds: new Set([keyframeId]),
      });
      
      // 记录操作
      _addOperation('ADD_KEYFRAME' as OperationType, {
        id: keyframeId,
        clip_id: clipId,
        property,
        offset: clampedOffset,
        value,
        easing,
      });
    },
    
    updateKeyframe: (keyframeId, updates) => {
      const { keyframes, _addOperation } = get();
      
      // ★ 深拷贝并更新
      const newKeyframes = cloneKeyframeMap(keyframes);
      let found = false;
      
      for (const [, clipMap] of Array.from(newKeyframes.entries())) {
        for (const [, kfList] of Array.from(clipMap.entries())) {
          const index = kfList.findIndex((kf: Keyframe) => kf.id === keyframeId);
          if (index >= 0) {
            found = true;
            kfList[index] = { ...kfList[index], ...updates };
            // 如果 offset 变了，重新排序
            if (updates.offset !== undefined) {
              kfList.sort((a: Keyframe, b: Keyframe) => a.offset - b.offset);
            }
            break;
          }
        }
        if (found) break;
      }
      
      if (found) {
        set({ keyframes: newKeyframes });
        _addOperation('UPDATE_KEYFRAME' as OperationType, {
          id: keyframeId,
          ...updates,
        });
      }
    },
    
    deleteKeyframe: (keyframeId) => {
      const { keyframes, selectedKeyframeIds, _addOperation } = get();
      
      // ★ 深拷贝并删除
      const newKeyframes = cloneKeyframeMap(keyframes);
      const newSelectedIds = new Set(selectedKeyframeIds);
      newSelectedIds.delete(keyframeId);
      let found = false;
      
      for (const [, clipMap] of Array.from(newKeyframes.entries())) {
        for (const [, kfList] of Array.from(clipMap.entries())) {
          const index = kfList.findIndex((kf: Keyframe) => kf.id === keyframeId);
          if (index >= 0) {
            found = true;
            kfList.splice(index, 1);
            break;
          }
        }
        if (found) break;
      }
      
      if (found) {
        set({ keyframes: newKeyframes, selectedKeyframeIds: newSelectedIds });
        _addOperation('DELETE_KEYFRAME' as OperationType, {
          id: keyframeId,
        });
      }
    },
    
    deletePropertyKeyframes: (clipId, property) => {
      const { keyframes, selectedKeyframeIds, _addOperation } = get();
      
      const clipMap = keyframes.get(clipId);
      if (!clipMap) return;
      
      const kfList = clipMap.get(property);
      if (!kfList || kfList.length === 0) return;
      
      // ★ 深拷贝并删除指定属性
      const newKeyframes = cloneKeyframeMap(keyframes);
      const newSelectedIds = new Set(selectedKeyframeIds);
      kfList.forEach(kf => newSelectedIds.delete(kf.id));
      
      // 删除该属性
      newKeyframes.get(clipId)?.delete(property);
      
      set({ keyframes: newKeyframes, selectedKeyframeIds: newSelectedIds });
      
      _addOperation('DELETE_PROPERTY_KEYFRAMES' as OperationType, {
        clip_id: clipId,
        property,
      });
    },
    
    getClipKeyframes: (clipId, property) => {
      const { keyframes } = get();
      const clipMap = keyframes.get(clipId);
      if (!clipMap) return [];
      
      if (property) {
        return clipMap.get(property) || [];
      }
      
      // 返回所有属性的关键帧，按 offset 排序
      const allKeyframes: Keyframe[] = [];
      for (const kfList of Array.from(clipMap.values())) {
        allKeyframes.push(...kfList);
      }
      return allKeyframes.sort((a, b) => a.offset - b.offset);
    },
    
    selectKeyframe: (keyframeId, multi = false) => {
      const { selectedKeyframeIds } = get();
      const newSelected = multi ? new Set(selectedKeyframeIds) : new Set<string>();
      
      if (newSelected.has(keyframeId)) {
        newSelected.delete(keyframeId);
      } else {
        newSelected.add(keyframeId);
      }
      
      set({ selectedKeyframeIds: newSelected });
    },
    
    clearKeyframeSelection: () => {
      set({ selectedKeyframeIds: new Set() });
    },
    
    _buildTimeline: (): Timeline => {
      const { tracks, clips } = get();
      
      // 转换为后端格式（Track 不区分类型）
      const timelineTracks: Track[] = tracks.map(t => ({
        id: t.id,
        name: t.name,
        orderIndex: t.orderIndex,
        color: t.color,
        isMuted: t.isMuted ?? false,
        isLocked: t.isLocked ?? false,
        isVisible: t.isVisible ?? true,
      }));
      
      const timelineClips: Clip[] = clips.map(c => ({
        ...c,
      }));
      
      return {
        tracks: timelineTracks,
        clips: timelineClips,
        effects: [],
        markers: [],
        duration: Math.max(...clips.map(c => c.start + c.duration), 0),
      };
    },
  }))
);

// ==================== 自动保存订阅 ====================
// 监听 clips 和 transcript 变化，触发自动保存
if (typeof window !== 'undefined') {
  useEditorStore.subscribe(
    (state) => [state.clips, state.transcript, state.tracks],
    () => {
      const { projectId, _syncManager, _buildTimeline, transcript } = useEditorStore.getState();
      if (projectId && _syncManager) {
        // SyncManager 会自动处理防抖
      }
    },
    { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
  );
  
  // ==================== Video Track 自动紧凑化订阅 ====================
  // ⚠️ 已禁用：改为在 Timeline.tsx 的 handleDragEnd 中精确控制
  // 自动订阅太激进，会在不应该的时候触发
  /*
  let isCompacting = false; // 防止紧凑化过程中的循环触发
  let lastVideoClipsHash = ''; // 用于检测实际变化
  
  useEditorStore.subscribe(
    (state) => state.clips.filter(c => c.clipType === 'video'),
    (videoClips) => {
      // 计算当前 video clips 的 hash（只关心 id 和 start）
      const currentHash = videoClips
        .map(c => `${c.id}:${c.start}:${c.duration}`)
        .sort()
        .join('|');
      
      // 如果正在紧凑化或 hash 没变化，跳过
      if (isCompacting || currentHash === lastVideoClipsHash) {
        return;
      }
      
      // 检查是否有空隙需要紧凑
      const trackIds = Array.from(new Set(videoClips.map(c => c.trackId)));
      let needsCompact = false;
      
      for (const trackId of trackIds) {
        const trackClips = videoClips
          .filter(c => c.trackId === trackId)
          .sort((a, b) => a.start - b.start);
        
        if (trackClips.length === 0) continue;
        
        // 检查第一个是否从 0 开始
        if (trackClips[0].start !== 0) {
          needsCompact = true;
          break;
        }
        
        // 检查是否有空隙
        let expectedStart = 0;
        for (const clip of trackClips) {
          if (clip.start !== expectedStart) {
            needsCompact = true;
            break;
          }
          expectedStart = clip.start + clip.duration;
        }
        
        if (needsCompact) break;
      }
      
      if (needsCompact) {
        isCompacting = true;
        // 使用 setTimeout 确保在当前更新完成后执行
        setTimeout(() => {
          useEditorStore.getState().compactVideoTrack();
          // 更新 hash 防止再次触发
          const newClips = useEditorStore.getState().clips.filter(c => c.clipType === 'video');
          lastVideoClipsHash = newClips
            .map(c => `${c.id}:${c.start}:${c.duration}`)
            .sort()
            .join('|');
          isCompacting = false;
        }, 0);
      } else {
        // 更新 hash
        lastVideoClipsHash = currentHash;
      }
    },
    { equalityFn: (a, b) => a.length === b.length && a.every((clip, i) => clip.id === b[i]?.id) }
  );
  */
  
  // ==================== Video Clip 重合检测订阅 ====================
  // ⚠️ 已禁用：重合检测由 Timeline.tsx 的 handleDragEnd 控制
  // 视频 clips 的重合通过 makeRoomForClip 处理
  // 非视频 clips 的重合通过创建新轨道处理
  /*
  let isResolvingOverlaps = false;
  let lastClipsOverlapHash = '';
  
  useEditorStore.subscribe(
    (state) => state.clips.filter(c => c.clipType === 'video'),
    (clips) => {
      // 计算当前 clips 的 hash（按 track 分组，检查是否有重合）
      const currentHash = clips
        .map(c => `${c.trackId}:${c.id}:${c.start}:${c.duration}`)
        .sort()
        .join('|');
      
      // 如果正在处理或 hash 没变化，跳过
      if (isResolvingOverlaps || currentHash === lastClipsOverlapHash) {
        return;
      }
      
      // 按 track 分组检查是否有重合
      const trackIds = Array.from(new Set(clips.map(c => c.trackId)));
      let hasOverlap = false;
      
      for (const trackId of trackIds) {
        const trackClips = clips
          .filter(c => c.trackId === trackId)
          .sort((a, b) => a.start - b.start);
        
        if (trackClips.length < 2) continue;
        
        // 检查是否有重合
        for (let i = 1; i < trackClips.length; i++) {
          const prevEnd = trackClips[i - 1].start + trackClips[i - 1].duration;
          if (trackClips[i].start < prevEnd) {
            hasOverlap = true;
            break;
          }
        }
        
        if (hasOverlap) break;
      }
      
      if (hasOverlap) {
        isResolvingOverlaps = true;
        setTimeout(() => {
          useEditorStore.getState().resolveClipOverlaps();
          // 更新 hash 防止再次触发 - 只关注 video clips
          const newClips = useEditorStore.getState().clips.filter(c => c.clipType === 'video');
          lastClipsOverlapHash = newClips
            .map(c => `${c.trackId}:${c.id}:${c.start}:${c.duration}`)
            .sort()
            .join('|');
          isResolvingOverlaps = false;
        }, 0);
      } else {
        lastClipsOverlapHash = currentHash;
      }
    },
    { equalityFn: (a, b) => a.length === b.length && a.every((clip, i) => clip.id === b[i]?.id && clip.start === b[i]?.start) }
  );
  */
}

export default useEditorStore;
