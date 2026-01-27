'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEditorStore, TICK_WIDTH } from '@/features/editor/store/editor-store';
import { VideoCanvas } from '@/features/editor/components/canvas';  // ★ 新架构
import { Timeline } from '@/features/editor/components/Timeline';
import { ContextMenu } from '@/features/editor/components/ContextMenu';
import { Header } from '@/features/editor/components/Header';
import { ClipToolbar } from '@/features/editor/components/ClipToolbar';
import { LibrarySidebar } from '@/features/editor/components/LibrarySidebar';
import { PropertyPanels } from '@/features/editor/components/PropertyPanels';
import { SubtitlesPanel } from '@/features/editor/components/SubtitlesPanel';
import { AssetsPanel } from '@/features/editor/components/AssetsPanel';
import { BRollPanel } from '@/features/editor/components/BRollPanel';
import { ASRProgressToast } from '@/features/editor/components/ASRProgressToast';
import { ProcessingDialog } from '@/features/editor/components/ProcessingDialog';
import { SmartCleanupWizard } from '@/features/editor/components/SmartCleanupWizard';
import { Resizer } from '@/features/editor/components/ResizablePanel';
import { mediaCache, generateThumbnail, getVideoDuration } from '@/features/editor/lib/media-cache';
import { uploadVideo } from '@/lib/api/assets';
import { clearHlsCache } from '@/features/editor/components/canvas/VideoCanvasStore';
import type { Clip } from '@/features/editor/types';

// ==================== 调试开关 ====================
// ★ 已关闭，视频缓冲日志在 VideoCanvasStore 中单独控制
const DEBUG_ENABLED = false;
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[EditorPage]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[EditorPage]', ...args); };

export default function EditorPage() {
  // 使用细粒度 selector 订阅，避免频繁状态变化导致整个页面重渲染
  const clips = useEditorStore((s) => s.clips);
  const addClip = useEditorStore((s) => s.addClip);
  const findOrCreateTrack = useEditorStore((s) => s.findOrCreateTrack);
  const updateClipUrl = useEditorStore((s) => s.updateClipUrl);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const closeContextMenu = useEditorStore((s) => s.closeContextMenu);
  const setActiveVideoUrl = useEditorStore((s) => s.setActiveVideoUrl);
  const setSelectedClipId = useEditorStore((s) => s.setSelectedClipId);
  const projectId = useEditorStore((s) => s.projectId);
  const createProject = useEditorStore((s) => s.createProject);
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const pendingChanges = useEditorStore((s) => s.pendingChanges);
  const syncStatus = useEditorStore((s) => s.syncStatus);
  const asrProgress = useEditorStore((s) => s.asrProgress);
  const closeASRProgress = useEditorStore((s) => s.closeASRProgress);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const deleteSelectedClip = useEditorStore((s) => s.deleteSelectedClip);
  const duplicateClip = useEditorStore((s) => s.duplicateClip);
  const cleanupWizardTrigger = useEditorStore((s) => s.cleanupWizardTrigger);  // ★ 订阅清理向导触发器
  const activeSidebarPanel = useEditorStore((s) => s.activeSidebarPanel);  // ★ 订阅当前打开的面板
  const setActiveSidebarPanel = useEditorStore((s) => s.setActiveSidebarPanel);  // ★ 设置当前面板
  const activeLeftPanel = useEditorStore((s) => s.activeLeftPanel);  // ★ 订阅左侧面板
  const setActiveLeftPanel = useEditorStore((s) => s.setActiveLeftPanel);  // ★ 设置左侧面板
  // 注意：不订阅 currentTime，在需要时使用 getState() 获取最新值

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const initRef = useRef(false); // 防止重复初始化

  // 智能清理向导状态（统一换气清理 + 智能分析）
  const [showCleanupWizard, setShowCleanupWizard] = useState(false);
  const [smartAnalysisId, setSmartAnalysisId] = useState<string | null>(null);
  const cleanupWizardShownRef = useRef(false); // 防止重复弹出

  // 可调整尺寸的面板状态
  const [timelineHeight, setTimelineHeight] = useState(320); // 时间轴高度（包含工具栏）
  const [sidebarWidth, setSidebarWidth] = useState(400); // 左侧边栏宽度（加宽）
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false); // 左侧折叠

  // 限制范围
  const MIN_TIMELINE_HEIGHT = 220;
  const MAX_TIMELINE_HEIGHT = typeof window !== 'undefined' ? window.innerHeight * 0.5 : 400;
  const MIN_SIDEBAR_WIDTH = 320;
  const MAX_SIDEBAR_WIDTH = 560;

  // 处理时间轴高度调整
  const handleTimelineResize = useCallback((delta: number) => {
    setTimelineHeight(prev => {
      const newHeight = prev - delta; // 向上拖是负的 delta
      return Math.max(MIN_TIMELINE_HEIGHT, Math.min(MAX_TIMELINE_HEIGHT, newHeight));
    });
  }, []);

  // 处理侧边栏宽度调整
  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth(prev => {
      const newWidth = prev + delta;
      return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));
    });
  }, []);

  // ★ 页面关闭前提醒用户保存
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 如果有未同步的修改，提醒用户
      if (pendingChanges > 0 || syncStatus === 'syncing') {
        e.preventDefault();
        e.returnValue = '有未保存的修改，确定要离开吗？';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [pendingChanges, syncStatus]);

  // 初始化项目（进入页面时）
  useEffect(() => {
    const initProject = async () => {
      // 使用 ref 防止重复初始化
      if (initRef.current) return;
      initRef.current = true;

      setIsInitializing(true);
      try {
        // 检查 URL 参数是否有项目 ID
        const urlParams = new URLSearchParams(window.location.search);
        const urlProjectId = urlParams.get('project');

        if (urlProjectId) {
          // 强制加载现有项目（即使 store 中已有 projectId）
          await useEditorStore.getState().loadProject(urlProjectId);
        } else if (!projectId) {
          // 只有 URL 没有参数且 store 也没有 projectId 时才创建新项目
          await createProject('未命名项目');
        }
      } catch (error) {
        debugError('项目初始化失败:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    initProject();
  }, []); // 只在组件挂载时执行一次

  // ★★★ 项目加载完成后，预缓冲所有视频到内存 ★★★
  // 确保播放时 100% 流畅，无任何网络依赖
  // ★★★ HLS 模式：不需要预缓冲，视频会按需加载 ★★★
  // 切换项目时清理 HLS 缓存
  useEffect(() => {
    // ★ 项目切换时重置弹窗标记，允许新项目弹出向导
    cleanupWizardShownRef.current = false;
    setShowCleanupWizard(false);
    setSmartAnalysisId(null);

    return () => {
      clearHlsCache();
    };
  }, [projectId]);

  // 项目加载完成后，检测是否有未确认的智能分析结果
  // 项目加载完成后，检测是否需要显示智能清理向导
  useEffect(() => {
    debugLog('🔍 检查弹窗条件:', {
      cleanupWizardShownRef: cleanupWizardShownRef.current,
      isInitializing,
      projectId,
      clipsLength: clips.length,
    });

    if (cleanupWizardShownRef.current || isInitializing || !projectId) {
      debugLog('⏭️ 跳过弹窗检查:', { reason: cleanupWizardShownRef.current ? 'already shown' : isInitializing ? 'initializing' : 'no projectId' });
      return;
    }

    // ★ 从 store 获取 wizardCompleted 状态（数据库维度）
    const isWizardCompleted = useEditorStore.getState().wizardCompleted;
    debugLog('📋 wizardCompleted:', isWizardCompleted);

    if (isWizardCompleted) {
      cleanupWizardShownRef.current = true;
      debugLog('⏭️ wizardCompleted=true，不弹窗');
      return; // 已完成过，不再弹出
    }

    // 检查 URL 参数是否有 analysis_id
    const urlParams = new URLSearchParams(window.location.search);
    const analysisId = urlParams.get('analysis');

    if (analysisId) {
      debugLog('🎯 发现 analysisId:', analysisId);
      cleanupWizardShownRef.current = true;
      setSmartAnalysisId(analysisId);
      // 延迟一点弹出，让页面先渲染完成
      setTimeout(() => setShowCleanupWizard(true), 500);
      return;
    }

    // 如果没有 analysis_id，检测是否有换气片段需要处理
    if (clips.length === 0) {
      debugLog('⏭️ clips.length === 0，等待加载');
      return;
    }

    // 统计换气片段
    const breathClips = clips.filter((clip) => {
      if (clip.clipType !== 'video') return false;
      const silenceInfo = clip.silenceInfo || clip.metadata?.silence_info;
      if (!silenceInfo) return false;
      return silenceInfo.classification === 'breath';
    });

    debugLog('🫁 换气片段统计:', {
      total: clips.length,
      videoClips: clips.filter(c => c.clipType === 'video').length,
      breathClips: breathClips.length,
      breathIds: breathClips.map(c => c.id.slice(0, 8)),
    });

    if (breathClips.length > 0) {
      debugLog('✅ 发现换气片段，准备弹窗');
      cleanupWizardShownRef.current = true;
      // 延迟一点弹出，让页面先渲染完成
      setTimeout(() => setShowCleanupWizard(true), 500);
    } else {
      debugLog('❌ 没有换气片段，不弹窗');
    }
  }, [projectId, clips, isInitializing]);

  // ★ 监听 cleanupWizardTrigger 变化，添加素材后重新检测换气片段
  useEffect(() => {
    // 初始值为 0 时不触发
    if (cleanupWizardTrigger === 0) return;

    debugLog('🔄 收到添加素材后的清理向导请求，trigger:', cleanupWizardTrigger);

    // 重新检测换气片段
    const latestClips = useEditorStore.getState().clips;
    const breathClips = latestClips.filter((clip) => {
      if (clip.clipType !== 'video') return false;
      const silenceInfo = clip.silenceInfo || clip.metadata?.silence_info;
      if (!silenceInfo) return false;
      return silenceInfo.classification === 'breath';
    });

    debugLog('🫁 添加素材后换气片段统计:', {
      total: latestClips.length,
      breathClips: breathClips.length,
    });

    if (breathClips.length > 0) {
      debugLog('✅ 发现换气片段，弹出清理向导');
      // 无论之前是否弹出过，只要有换气片段就弹出
      setTimeout(() => setShowCleanupWizard(true), 500);
    }
  }, [cleanupWizardTrigger]);
  // 基础键盘快捷键（播放/时间控制）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果在输入框中则忽略
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // 空格键：播放/暂停
      if (e.code === 'Space') {
        e.preventDefault();
        // 如果视频未准备好，不允许播放
        const isVideoReady = useEditorStore.getState().isVideoReady;
        if (!isVideoReady && !isPlaying) return;
        setIsPlaying(!isPlaying);
      }

      // 左右箭头：微调时间（在回调中获取最新值，避免订阅 currentTime）
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const currentTime = useEditorStore.getState().currentTime;
        setCurrentTime(Math.max(0, currentTime - (e.shiftKey ? 1000 : 100))); // 毫秒
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        const currentTime = useEditorStore.getState().currentTime;
        setCurrentTime(currentTime + (e.shiftKey ? 1000 : 100)); // 毫秒
      }

      // Delete/Backspace：删除选中的 clips
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          deleteSelectedClip();
        }
      }

      // Command/Ctrl + D：复制选中的 clip
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyD') {
        if (selectedClipIds.size === 1) {
          e.preventDefault();
          const clipId = Array.from(selectedClipIds)[0];
          duplicateClip(clipId);
        }
      }

      // Command/Ctrl + Z：撤销
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        const { undo, canUndo } = useEditorStore.getState();
        if (canUndo()) undo();
      }

      // Command/Ctrl + Shift + Z 或 Command/Ctrl + Y：重做
      if ((e.metaKey || e.ctrlKey) && ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY')) {
        e.preventDefault();
        const { redo, canRedo } = useEditorStore.getState();
        if (canRedo()) redo();
      }

      // Command/Ctrl + A：全选片段
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyA') {
        e.preventDefault();
        const { selectAllClips } = useEditorStore.getState();
        selectAllClips();
      }

      // Command/Ctrl + S：保存（阻止默认行为，项目自动保存）
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault();
        // 项目自动保存，这里只阻止浏览器默认保存页面行为
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, setIsPlaying, setCurrentTime, selectedClipIds, deleteSelectedClip, duplicateClip]);

  // 注意：播放时间更新由 VideoCanvas 的 handleTimeUpdate 处理
  // 不需要这里的定时器，否则会与 VideoCanvas 产生冲突

  // 文件导入处理
  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 使用 UUID 格式（后端会验证）
    const clipId = crypto.randomUUID();

    try {
      // 1. 生成视频封面和获取时长（本地处理，即时响应）
      const [thumbnail, duration] = await Promise.all([
        generateThumbnail(file),
        getVideoDuration(file),
      ]);

      // 2. 直接创建本地预览 URL（即时可用）
      const localUrl = URL.createObjectURL(file);

      // 3. 后台缓存到 IndexedDB（保证刷新不丢失）
      mediaCache.cacheMedia(clipId, projectId || '', file, { duration, thumbnail }).catch(console.error);

      // 4. 创建 Clip 并添加到时间轴（即时响应）
      // 时间单位：毫秒
      const lastClip = clips[clips.length - 1];
      const startTime = lastClip ? lastClip.start + lastClip.duration + 500 : 0; // 500ms 间隔
      // 使用 findOrCreateTrack 复用空闲轨道，而不是每次都用固定的 track-1
      const trackId = findOrCreateTrack('video', clipId, startTime, duration);
      const newClip: Clip = {
        id: clipId,
        name: file.name,
        trackId,
        start: startTime,
        duration: duration, // 已经是毫秒
        clipType: 'video',
        color: 'from-gray-600 to-gray-800',
        isLocal: true,           // 标记为本地文件，尚未上传
        uploadStatus: 'pending', // 上传状态
        thumbnail: thumbnail,
        mediaUrl: localUrl,
        sourceStart: 0,
        originDuration: duration, // 原始素材总时长（用于限制拉伸范围）
        volume: 1.0,
        isMuted: false,
        speed: 1.0,
      };

      addClip(newClip);
      setActiveVideoUrl(localUrl);
      setSelectedClipId(clipId);

      debugLog('[Import] 素材导入成功:', { clipId, localUrl, duration });

      // 5. 后台上传到云端（不阻塞用户操作）
      uploadToCloud(clipId, file, duration);

    } catch (error) {
      debugError('Failed to process video:', error);
      // 清理缓存
      mediaCache.deleteMedia(clipId);
    }

    // 清空 input 以便再次选择同一文件
    e.target.value = '';
  }, [clips, addClip, setActiveVideoUrl, setSelectedClipId, projectId]);

  // 后台上传到云端
  const uploadToCloud = useCallback(async (clipId: string, file: File, duration: number) => {
    try {
      // 更新上传状态
      await mediaCache.updateUploadStatus(clipId, 'uploading', 0);
      useEditorStore.getState().updateClip(clipId, { uploadStatus: 'uploading' });

      // 调用上传 API，传递 duration 和进度回调
      const { asset_id, url } = await uploadVideo(
        file,
        projectId || undefined,
        duration,
        // 进度回调：更新缓存和 UI
        async (progress) => {
          await mediaCache.updateUploadStatus(clipId, 'uploading', progress.percentage);
          // 可选：更新 store 中的进度（如果需要在 UI 中显示）
          debugLog(`[Upload] ${file.name}: ${progress.percentage}%`);
        }
      );

      // 上传成功，更新缓存和 store
      await mediaCache.updateUploadStatus(clipId, 'uploaded', 100, {
        cloudUrl: url,
        assetId: asset_id
      });

      // 更新 clip URL（包括所有分割产生的子 clip）
      useEditorStore.getState().updateClipUrl(clipId, url, asset_id);
      useEditorStore.getState().updateClip(clipId, {
        uploadStatus: 'uploaded',
        isLocal: false,
      });

      debugLog(`[Upload] 上传完成: ${clipId} -> ${url}`);

    } catch (error) {
      debugError(`[Upload] 上传失败: ${clipId}`, error);

      await mediaCache.updateUploadStatus(clipId, 'failed');
      useEditorStore.getState().updateClip(clipId, { uploadStatus: 'failed' });
    }
  }, [projectId]);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // 显示加载状态
  if (isInitializing || (!projectId && !isProcessing)) {
    return (
      <div className="flex h-screen w-full bg-[#FAFAFA] text-gray-900 items-center justify-center">
        <div className="text-center">
          <img
            src="/rabbit-loading.gif"
            alt="Loading"
            width={64}
            height={64}
            className="mx-auto"
          />
          <p className="text-gray-500 mt-3">正在初始化项目...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-full bg-[#FAFAFA] text-gray-900 font-sans overflow-hidden flex-col select-none relative"
      onClick={closeContextMenu}
    >
      {/* 隐藏的文件选择器 */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileImport}
        className="hidden"
        accept="video/*"
      />

      {/* 左侧折叠按钮 - 绝对定位在页面最外层 */}
      <button
        onClick={(e) => { 
          e.stopPropagation(); 
          const newCollapsed = !isLeftCollapsed;
          // 收起时清除左侧面板状态
          if (newCollapsed) {
            setActiveLeftPanel(null);
          }
          setIsLeftCollapsed(newCollapsed); 
        }}
        className="fixed z-50 w-5 h-14 flex items-center justify-center bg-white border border-gray-200 rounded-r-lg shadow-md hover:bg-gray-50 text-gray-400 hover:text-gray-600 transition-all cursor-pointer"
        style={{ 
          // 计算 left 值：
          // - 收起时：8px
          // - 展开无面板：左侧栏宽度(80px) + 间距(8px) = 88px
          // - 展开有面板：左侧栏(80px) + 面板宽度(384px) + ml-2(8px) + 间距(8px)
          left: isLeftCollapsed 
            ? 8 
            : activeLeftPanel 
              ? 80 + 384 + 8 + 8
              : 80 + 8,
          top: '40%',
        }}
        title={isLeftCollapsed ? "展开侧边栏" : "收起侧边栏"}
      >
        {isLeftCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* 顶部导航栏 */}
      <Header />

      {/* 主工作区 - 使用 flex 布局，面板参与流式布局而非覆盖 */}
      <div className="flex-1 flex overflow-hidden min-h-0 bg-[#F5F5F5] gap-2 p-2">

        {/* 左侧：工具按钮栏 - 固定宽度 */}
        <div
          className="flex-shrink-0 h-full transition-[width] duration-300 ease-in-out overflow-hidden"
          style={{ width: isLeftCollapsed ? 0 : '5rem' }}
        >
          <LibrarySidebar onUploadClick={openFilePicker} />
        </div>

        {/* 左侧面板区域 - 字幕/素材列表（滑出动画） */}
        <div 
          className={`flex-shrink-0 h-full transition-all duration-300 ease-in-out overflow-hidden ${
            activeLeftPanel ? 'w-96 opacity-100' : 'w-0 opacity-0'
          }`}
        >
          <div className="w-96 h-full">
            {activeLeftPanel === 'subtitles' && (
              <SubtitlesPanel onClose={() => setActiveLeftPanel(null)} />
            )}
            {activeLeftPanel === 'assets' && (
              <AssetsPanel onClose={() => setActiveLeftPanel(null)} />
            )}
            {activeLeftPanel === 'b-roll' && (
              <BRollPanel onClose={() => setActiveLeftPanel(null)} />
            )}
          </div>
        </div>

        {/* 中央：预览区 + 时间轴（自适应宽度） */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden gap-2">

          {/* 视频预览区 - 圆角卡片风格 */}
          <div className="flex-1 flex bg-gray-100 min-h-0 overflow-hidden rounded-xl shadow-sm">
            <VideoCanvas />
          </div>

          {/* 时间轴工作台 - 包含拖拽条 */}
          <div
            className="flex-shrink-0 overflow-hidden bg-white rounded-xl shadow-sm flex flex-col"
            style={{ height: timelineHeight }}
          >
            {/* 顶部拖拽条 */}
            <Resizer
              direction="vertical"
              onResize={handleTimelineResize}
            />
            {/* 工具栏 - 时间显示和操作按钮 */}
            <ClipToolbar />
            {/* 时间轴 */}
            <Timeline />
          </div>
        </main>

        {/* 右侧：属性面板（滑出动画） */}
        <div 
          className={`flex-shrink-0 h-full transition-all duration-300 ease-in-out overflow-hidden ${
            activeSidebarPanel ? 'w-80 opacity-100' : 'w-0 opacity-0'
          }`}
        >
          <div className="w-80 h-full">
            <PropertyPanels />
          </div>
        </div>
      </div>

      {/* 自定义右键菜单 */}
      <ContextMenu />

      {/* ASR 进度提示 */}
      <ASRProgressToast
        visible={asrProgress.visible}
        status={asrProgress.status}
        progress={asrProgress.progress}
        message={asrProgress.message}
        error={asrProgress.error}
        onClose={closeASRProgress}
      />

      {/* 通用处理进度弹窗 */}
      <ProcessingDialog />

      {/* 智能清理向导（统一换气清理 + 智能分析） */}
      <SmartCleanupWizard
        isOpen={showCleanupWizard}
        analysisId={smartAnalysisId || ''}
        projectId={projectId || ''}
        assetId={clips.find(c => c.clipType === 'video')?.assetId}
        onClose={() => setShowCleanupWizard(false)}
        onConfirm={async () => {
          setShowCleanupWizard(false);
          // 记录该项目已完成向导（保存到数据库）
          useEditorStore.getState().setWizardCompleted();
          // 刷新编辑器数据
          if (projectId) {
            await useEditorStore.getState().loadProject(projectId);
          }
        }}
      />
    </div>
  );
}
