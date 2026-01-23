'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { Toggle } from '@/components/common/Toggle';
import {
  Search,
  Copy,
  Download,
  Filter,
  Scissors,
  Trash2,
  Plus,
  Settings2,
  Mic,
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { formatTimeSec } from '../lib/time-utils';
import { getVideoDuration } from '../lib/media-cache';
import { uploadVideo, assetApi } from '@/lib/api/assets';
import type { Clip } from '../types/clip';
import type { Asset } from '../types/asset';

// 调试日志
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[ClipListPanel]', ...args); };

interface ClipItemProps {
  clip: Clip;
  index: number;
  isPlaying: boolean;
  isSelected: boolean;
  isFocused: boolean;  // 当前聚焦（键盘导航）
  onDoubleClick: () => void;  // 双击选中
  onEdit: () => void;
  onTextChange: (text: string) => void;
  onDelete: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;  // 键盘导航
  setItemRef: (el: HTMLDivElement | null) => void;  // ref 回调
}

function ClipItem({
  clip, index, isPlaying, isSelected, isFocused,
  onDoubleClick, onEdit, onTextChange, onDelete, onNavigate, setItemRef
}: ClipItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayText = clip.contentText || '';
  const [localText, setLocalText] = useState(displayText);
  const [isEditing, setIsEditing] = useState(false);  // ★ 新增：编辑模式状态
  const isCurrent = isPlaying;

  // 同步外部变化（右侧面板编辑时同步到左侧）
  useEffect(() => {
    // 只有当输入框没有焦点时才同步外部变化，避免覆盖用户输入
    if (document.activeElement !== inputRef.current) {
      setLocalText(displayText);
    }
  }, [displayText]);

  // ★ 取消选中时退出编辑模式
  useEffect(() => {
    if (!isSelected) {
      setIsEditing(false);
    }
  }, [isSelected]);

  // ★ 进入编辑模式时聚焦输入框
  useEffect(() => {
    if (isEditing && inputRef.current) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(localText.length, localText.length);
      });
    }
  }, [isEditing]);

  // ★ 双击进入编辑模式
  const handleDoubleClick = () => {
    onDoubleClick();  // 先选中
    setIsEditing(true);  // 再进入编辑模式
  };

  // ★ 输入时实时同步到 store（右侧面板会实时显示）
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    setLocalText(newText);
    // 实时同步到 store
    onTextChange(newText);
  };

  // 键盘导航（只有编辑模式时生效）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isEditing) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      // 退出编辑模式
      setIsEditing(false);
    } else if (e.key === 'Escape') {
      // 取消编辑，恢复原值
      setLocalText(displayText);
      setIsEditing(false);
    }
  };

  return (
    <div
      ref={setItemRef}
      onDoubleClick={handleDoubleClick}
      className={`group relative rounded-md transition-all duration-150 cursor-pointer ${isSelected
          ? 'bg-yellow-50 border border-yellow-400 shadow-sm'
          : isCurrent
            ? 'bg-blue-50 border border-blue-200'
            : 'bg-white hover:bg-gray-50 border border-transparent hover:border-gray-200'
        }`}
    >
      {/* 播放中指示器 */}
      {isCurrent && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l" />
      )}

      {/* 单行布局：序号时间 + 文本显示/输入 + 操作按钮 */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        {/* 序号 + 时间（紧凑） */}
        <div
          className="flex items-center gap-1 flex-shrink-0 text-[10px] text-gray-400 font-mono min-w-[90px]"
          title={`${formatTimeSec(clip.start / 1000)} - ${formatTimeSec((clip.start + clip.duration) / 1000)}`}
        >
          <span className="font-bold text-gray-500 w-4">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span>{formatTimeSec(clip.start / 1000)}</span>
        </div>

        {/* 文本：编辑模式时显示输入框，否则只读显示 */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={localText}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setIsEditing(false)}
            onClick={(e) => e.stopPropagation()}
            placeholder="输入字幕..."
            className="flex-1 text-sm bg-white border border-yellow-300 rounded px-1.5 py-0.5
                       outline-none focus:ring-1 focus:ring-yellow-400
                       placeholder:text-gray-300 min-w-0
                       text-gray-800"
          />
        ) : (
          <span className={`flex-1 text-sm truncate min-w-0 py-0.5 ${displayText ? 'text-gray-700' : 'text-gray-400 italic'
            }`}>
            {displayText || '双击编辑...'}
          </span>
        )}

        {/* 操作按钮（选中时显示） */}
        <div className={`flex items-center gap-0.5 flex-shrink-0 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'
          }`}>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1 hover:bg-gray-200 rounded transition-colors"
            title="编辑片段"
          >
            <Scissors size={12} className="text-gray-400 hover:text-gray-700" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 hover:bg-red-100 rounded transition-colors"
            title="删除片段"
          >
            <Trash2 size={12} className="text-gray-400 hover:text-red-500" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 素材列表项组件
// ==========================================
interface AssetItemProps {
  asset: Asset;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  setItemRef: (el: HTMLDivElement | null) => void;
}

function AssetItem({ asset, index, isSelected, onSelect, setItemRef }: AssetItemProps) {
  // 格式化文件大小
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 格式化时长
  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 获取类型图标
  const getTypeIcon = () => {
    switch (asset.type) {
      case 'video': return '🎬';
      case 'audio': return '🎵';
      case 'image': return '🖼️';
      default: return '📄';
    }
  };

  return (
    <div
      ref={setItemRef}
      onClick={onSelect}
      className={`group relative rounded-md transition-all duration-150 cursor-pointer ${isSelected
          ? 'bg-blue-50 border border-blue-400 shadow-sm'
          : 'bg-white hover:bg-gray-50 border border-transparent hover:border-gray-200'
        }`}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        {/* 序号 */}
        <span className="flex-shrink-0 text-[10px] font-bold text-gray-400 w-5">
          {String(index + 1).padStart(2, '0')}
        </span>

        {/* 缩略图或类型图标 */}
        <div className="flex-shrink-0 w-10 h-10 rounded bg-gray-100 flex items-center justify-center overflow-hidden">
          {asset.thumbnail_url ? (
            <img src={asset.thumbnail_url} alt={asset.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg">{getTypeIcon()}</span>
          )}
        </div>

        {/* 素材信息 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-800 truncate" title={asset.name}>
            {asset.name}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            {asset.metadata?.duration && (
              <span>{formatDuration(asset.metadata.duration)}</span>
            )}
            {asset.file_size && (
              <span>{formatFileSize(asset.file_size)}</span>
            )}
            {asset.subtype && asset.subtype !== 'original' && (
              <span className="px-1 py-0.5 bg-gray-100 rounded text-[9px]">
                {asset.subtype}
              </span>
            )}
          </div>
        </div>

        {/* 状态指示器 */}
        {asset.status === 'processing' && (
          <div className="flex-shrink-0 w-2 h-2 bg-yellow-400 rounded-full animate-pulse" title="处理中" />
        )}
        {asset.status === 'error' && (
          <div className="flex-shrink-0 w-2 h-2 bg-red-500 rounded-full" title="错误" />
        )}
      </div>
    </div>
  );
}

export function ClipListPanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'asset' | 'subtitle'>('subtitle');
  const [currentPlayingClipId, setCurrentPlayingClipId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);  // 键盘导航焦点

  // 用于滚动定位的 refs
  const clipRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Add outro 相关状态
  const [isAddingOutro, setIsAddingOutro] = useState(false);
  const [outroUploadProgress, setOutroUploadProgress] = useState(0);
  const [processingStep, setProcessingStep] = useState<string>(''); // 当前处理步骤描述
  const outroFileInputRef = useRef<HTMLInputElement>(null);

  // 添加素材选项弹窗
  const [showAddOptionsDialog, setShowAddOptionsDialog] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [addOptions, setAddOptions] = useState({
    enableAsr: false,
    enableSmartCamera: false,
  });

  // 使用细粒度 selector 订阅，避免 currentTime 变化导致整个组件重渲染
  const clips = useEditorStore((s) => s.clips);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setSelectedClipId = useEditorStore((s) => s.setSelectedClipId);
  const selectClip = useEditorStore((s) => s.selectClip);
  const updateClip = useEditorStore((s) => s.updateClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const addClip = useEditorStore((s) => s.addClip);
  const projectId = useEditorStore((s) => s.projectId);
  const tracks = useEditorStore((s) => s.tracks);
  const loadClips = useEditorStore((s) => s.loadClips);
  const loadAssets = useEditorStore((s) => s.loadAssets);  // ★ 刷新素材列表
  const loadKeyframes = useEditorStore((s) => s.loadKeyframes);  // ★ 刷新关键帧
  const assets = useEditorStore((s) => s.assets);  // ★ 获取素材列表
  const requestCleanupWizard = useEditorStore((s) => s.requestCleanupWizard);  // ★ 触发清理向导

  // 使用 subscribe 订阅 currentTime，不触发组件重渲染
  // 只在需要更新 currentPlayingClipId 时才更新 state
  useEffect(() => {
    let lastPlayingId: string | null = null;
    const unsubscribe = useEditorStore.subscribe(
      (state) => state.currentTime,
      (currentTime) => {
        const playing = clips.find(c => currentTime >= c.start && currentTime < c.start + c.duration);
        const newPlayingId = playing?.id || null;
        // 只有当播放的 clip 变化时才更新 state
        if (newPlayingId !== lastPlayingId) {
          lastPlayingId = newPlayingId;
          setCurrentPlayingClipId(newPlayingId);
        }
      }
    );
    return unsubscribe;
  }, [clips]);

  // ★ 播放时自动滚动到当前片段
  useEffect(() => {
    if (currentPlayingClipId) {
      const element = clipRefs.current.get(currentPlayingClipId);
      if (element && listContainerRef.current) {
        // 平滑滚动到视野中心
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentPlayingClipId]);

  // 筛选字幕类型的 clips，并按 start 时间排序
  const subtitleClips = useMemo(() => {
    return clips
      .filter(c => c.clipType === 'subtitle')
      .sort((a, b) => a.start - b.start);
  }, [clips]);

  // 筛选素材列表，按创建时间排序
  const sortedAssets = useMemo(() => {
    return [...assets].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [assets]);

  // 当前 tab 显示的 clips（仅字幕 tab 使用）
  const currentClips = subtitleClips;

  // 搜索过滤（字幕）
  const filteredClips = useMemo(() => {
    if (!searchQuery.trim()) return currentClips;
    const query = searchQuery.toLowerCase();
    return currentClips.filter(c =>
      c.contentText?.toLowerCase().includes(query) ||
      c.name?.toLowerCase().includes(query)
    );
  }, [currentClips, searchQuery]);

  // 搜索过滤（素材）
  const filteredAssets = useMemo(() => {
    if (!searchQuery.trim()) return sortedAssets;
    const query = searchQuery.toLowerCase();
    return sortedAssets.filter(a =>
      a.name?.toLowerCase().includes(query)
    );
  }, [sortedAssets, searchQuery]);

  // 选中片段（联动 Timeline）
  const handleSelect = useCallback((clip: Clip) => {
    selectClip(clip.id, false); // 单选，不多选
  }, [selectClip]);

  // 播放指定片段
  const handlePlay = useCallback((clip: Clip) => {
    setCurrentTime(clip.start);
    setSelectedClipId(clip.id);
  }, [setCurrentTime, setSelectedClipId]);

  // 编辑片段（选中并可能打开属性面板）
  const handleEdit = useCallback((clip: Clip) => {
    setSelectedClipId(clip.id);
    setCurrentTime(clip.start);
  }, [setSelectedClipId, setCurrentTime]);

  // 更新片段文案（统一使用 contentText）
  const handleTextChange = useCallback((clipId: string, text: string) => {
    updateClip(clipId, { contentText: text });
  }, [updateClip]);

  // 删除片段
  const handleDelete = useCallback((clipId: string) => {
    if (confirm('确定要删除这个片段吗？')) {
      removeClip(clipId);
    }
  }, [removeClip]);

  // ★ 键盘导航：切换到上/下一个片段
  const handleNavigate = useCallback((index: number, direction: 'prev' | 'next') => {
    const newIndex = direction === 'next'
      ? Math.min(index + 1, filteredClips.length - 1)
      : Math.max(index - 1, 0);

    if (newIndex !== index && filteredClips[newIndex]) {
      const nextClip = filteredClips[newIndex];
      setFocusedIndex(newIndex);
      handlePlay(nextClip);
      handleSelect(nextClip);
    }
  }, [filteredClips, handlePlay, handleSelect]);

  // 复制所有文案
  const copyAllText = () => {
    const allText = filteredClips
      .map(c => c.contentText || '')
      .filter(Boolean)
      .join('\n\n');
    navigator.clipboard.writeText(allText);
  };

  // 导出文案
  const exportTranscript = () => {
    const content = filteredClips
      .map((c, i) => `[${formatTimeSec(c.start / 1000)}] ${c.contentText || ''}`)
      .join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Add outro - 在时间轴末尾添加新素材
  // 新流程：上传文件 → 调用 processAdditions API → 轮询进度 → 刷新 clips
  // ★ 治本方案：通过参数传入选项，避免闭包陷阱
  const handleAddOutroMultiple = useCallback(async (
    files: File[],
    options: { enableAsr: boolean; enableSmartCamera: boolean }
  ) => {
    if (!projectId) {
      console.error('[AddOutro] 无法添加素材：projectId 为空');
      return;
    }

    if (files.length === 0) return;

    setIsAddingOutro(true);
    setOutroUploadProgress(0);
    setProcessingStep('正在上传文件...');

    try {
      const uploadedAssetIds: string[] = [];
      const totalFiles = files.length;

      // 1. 上传所有文件
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProcessingStep(`正在上传 (${i + 1}/${totalFiles}): ${file.name}`);

        const durationMs = await getVideoDuration(file);
        debugLog(`文件 ${i + 1} 时长:`, durationMs, 'ms');

        const result = await uploadVideo(
          file,
          projectId,
          durationMs,
          (progress) => {
            // 总进度 = (已完成文件数 + 当前进度) / 总文件数 * 上传阶段占比(50%)
            const totalProgress = ((i + progress.percentage / 100) / totalFiles) * 50;
            setOutroUploadProgress(Math.round(totalProgress));
          }
        );

        uploadedAssetIds.push(result.asset_id);
        debugLog(`文件 ${i + 1} 上传完成:`, result.asset_id);
      }

      debugLog('所有文件上传完成，开始处理...', { enableAsr: options.enableAsr, enableSmartCamera: options.enableSmartCamera });
      setProcessingStep(options.enableAsr ? '正在处理素材 (ASR转写)...' : '正在处理素材...');
      setOutroUploadProgress(50);

      // 2. 调用 processAdditions API
      const processResponse = await assetApi.processAdditions({
        project_id: projectId,
        asset_ids: uploadedAssetIds,
        enable_asr: options.enableAsr,
        enable_smart_camera: options.enableSmartCamera,
      });

      if (processResponse.error || !processResponse.data) {
        throw new Error(processResponse.error?.message || '启动处理任务失败');
      }

      const taskId = processResponse.data.task_id;
      debugLog('处理任务已创建:', taskId);

      // 3. 轮询处理进度
      let completed = false;
      let pollCount = 0;
      const maxPolls = 600; // 最多轮询 10 分钟 (600 * 1s)

      while (!completed && pollCount < maxPolls) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 每秒轮询一次
        pollCount++;

        const statusResponse = await assetApi.getProcessAdditionsStatus(taskId);

        if (statusResponse.error || !statusResponse.data) {
          debugLog('获取状态失败:', statusResponse.error);
          continue;
        }

        const status = statusResponse.data;
        debugLog('处理状态:', status.status, status.progress + '%', status.current_step);

        // 更新进度：50% + (处理进度 * 50%)
        const totalProgress = 50 + (status.progress * 0.5);
        setOutroUploadProgress(Math.round(totalProgress));

        // 更新步骤描述
        if (status.current_step) {
          if (status.current_step.startsWith('asr_')) {
            const assetNum = status.current_step.replace('asr_', '');
            setProcessingStep(`正在转写第 ${assetNum} 个素材...`);
          } else if (status.current_step === 'saving_clips') {
            setProcessingStep('正在保存片段...');
          } else if (status.current_step.startsWith('processing_asset_')) {
            const assetNum = status.current_step.replace('processing_asset_', '');
            setProcessingStep(`正在处理第 ${assetNum} 个素材...`);
          }
        }

        if (status.status === 'completed') {
          completed = true;
          debugLog('处理完成，创建了', status.created_clips, '个片段');
        } else if (status.status === 'failed') {
          throw new Error(status.error || '处理失败');
        }
      }

      if (!completed) {
        throw new Error('处理超时');
      }

      // 4. 刷新 clips 和 assets 列表
      setProcessingStep('正在刷新...');

      // ★ 注意：不要调用 clearHlsCache()！
      // 新素材是全新的 assetId，不会与现有缓存冲突
      // 清除缓存会导致现有视频需要重新加载，影响播放体验

      await Promise.all([loadClips(), loadAssets(), loadKeyframes()]);

      debugLog('添加素材完成');
      setOutroUploadProgress(100);

      // ★ 触发清理向导检测（治本方案：通过 store 通知 EditorPage 检测换气片段）
      requestCleanupWizard();

    } catch (err) {
      console.error('[AddOutro] 添加素材失败:', err);
      alert('添加素材失败: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setIsAddingOutro(false);
      setOutroUploadProgress(0);
      setProcessingStep('');
    }
  }, [projectId, loadClips, loadAssets, loadKeyframes, requestCleanupWizard]);

  // 选择文件后，显示选项弹窗
  const handleOutroFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // 转换为数组
    const files = Array.from(fileList);
    e.target.value = ''; // 重置以允许选择相同文件

    // ★ 清除选中状态，避免弹窗和属性面板同时显示
    setSelectedClipId(null);

    // 暂存文件，显示选项弹窗
    setPendingFiles(files);
    setShowAddOptionsDialog(true);
  }, [setSelectedClipId]);

  // 确认添加素材选项后，开始处理
  // ★ 调用时传入当前选项值，确保使用最新状态
  const handleConfirmAddOptions = useCallback(async () => {
    if (pendingFiles.length === 0) return;
    const currentOptions = { ...addOptions }; // 捕获当前值
    setShowAddOptionsDialog(false);
    await handleAddOutroMultiple(pendingFiles, currentOptions);
    setPendingFiles([]);
  }, [pendingFiles, handleAddOutroMultiple, addOptions]);

  // 取消添加素材
  const handleCancelAddOptions = useCallback(() => {
    setShowAddOptionsDialog(false);
    setPendingFiles([]);
  }, []);

  return (
    <div className="w-full h-full bg-white flex flex-col">
      {/* 添加素材选项弹窗 */}
      {showAddOptionsDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 max-w-[90vw]">
            <h3 className="text-base font-semibold text-gray-900 mb-5">
              添加 {pendingFiles.length} 个素材
            </h3>

            <div className="space-y-4 mb-6">
              {/* ASR 选项 */}
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Mic size={18} className="text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">ASR 语音转写</div>
                  <div className="text-xs text-gray-400 mt-0.5">生成带时间戳的语音文案</div>
                </div>
                <Toggle
                  checked={addOptions.enableAsr}
                  onChange={(checked) => setAddOptions(prev => ({ ...prev, enableAsr: checked }))}
                />
              </div>

              {/* 智能运镜选项 */}
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Settings2 size={18} className="text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">智能切片与运镜</div>
                  <div className="text-xs text-gray-400 mt-0.5">自动提取高光时刻并优化画面</div>
                </div>
                <Toggle
                  checked={addOptions.enableSmartCamera}
                  onChange={(checked) => setAddOptions(prev => ({ ...prev, enableSmartCamera: checked }))}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancelAddOptions}
                className="flex-1 py-2.5 px-4 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmAddOptions}
                className="flex-1 py-2.5 px-4 text-sm font-medium text-white bg-gray-700 hover:bg-gray-600 rounded-xl transition-colors"
              >
                开始处理
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 标签切换 */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('subtitle')}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${activeTab === 'subtitle'
              ? 'text-gray-900 border-b-2 border-gray-500'
              : 'text-gray-500 hover:text-gray-700'
            }`}
        >
          字幕 ({subtitleClips.length})
        </button>
        <button
          onClick={() => setActiveTab('asset')}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${activeTab === 'asset'
              ? 'text-gray-900 border-b-2 border-gray-500'
              : 'text-gray-500 hover:text-gray-700'
            }`}
        >
          素材 ({assets.length})
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-gray-50 text-sm text-gray-900 placeholder-gray-400 
                       rounded-lg pl-9 pr-3 py-2 border border-gray-200
                       focus:border-gray-500 focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <button
            onClick={copyAllText}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
            title="复制所有文案"
          >
            <Copy size={14} className="text-gray-500" />
          </button>
          <button
            onClick={exportTranscript}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
            title="导出文案"
          >
            <Download size={14} className="text-gray-500" />
          </button>
          <button
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
            title="筛选"
          >
            <Filter size={14} className="text-gray-500" />
          </button>
        </div>
        <span className="text-[10px] text-gray-500">
          {activeTab === 'asset' ? `${filteredAssets.length} 个素材` : `${filteredClips.length} 个片段`}
        </span>
      </div>

      {/* 列表内容 */}
      <div
        ref={listContainerRef}
        className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar"
      >
        {activeTab === 'asset' ? (
          // ★ 素材列表
          filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
              <div className="p-4 rounded-full border-2 border-dashed border-gray-300 mb-4">
                <Plus size={24} className="text-gray-400" />
              </div>
              <p className="text-xs text-gray-500">
                {searchQuery ? '没有匹配的素材' : '暂无素材，点击下方添加'}
              </p>
            </div>
          ) : (
            filteredAssets.map((asset, index) => {
              const setRef = (el: HTMLDivElement | null) => {
                if (el) {
                  clipRefs.current.set(asset.id, el);
                } else {
                  clipRefs.current.delete(asset.id);
                }
              };

              return (
                <AssetItem
                  key={asset.id}
                  asset={asset}
                  index={index}
                  isSelected={false}  // TODO: 可以添加素材选中状态
                  onSelect={() => {
                    // TODO: 可以添加素材选中/预览功能
                    debugLog('选中素材:', asset.name);
                  }}
                  setItemRef={setRef}
                />
              );
            })
          )
        ) : (
          // ★ 字幕列表
          filteredClips.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
              <div className="p-4 rounded-full border-2 border-dashed border-gray-300 mb-4">
                <Scissors size={24} className="text-gray-400" />
              </div>
              <p className="text-xs text-gray-500">
                {searchQuery ? '没有匹配的片段' : '暂无字幕片段'}
              </p>
            </div>
          ) : (
            filteredClips.map((clip, index) => {
              const setRef = (el: HTMLDivElement | null) => {
                if (el) {
                  clipRefs.current.set(clip.id, el);
                } else {
                  clipRefs.current.delete(clip.id);
                }
              };

              return (
                <ClipItem
                  key={clip.id}
                  clip={clip}
                  index={index}
                  isPlaying={currentPlayingClipId === clip.id}
                  isSelected={selectedClipIds.has(clip.id)}
                  isFocused={focusedIndex === index}
                  onDoubleClick={() => {
                    handleSelect(clip);
                    handlePlay(clip);
                  }}
                  onEdit={() => handleEdit(clip)}
                  onTextChange={(text) => handleTextChange(clip.id, text)}
                  onDelete={() => handleDelete(clip.id)}
                  onNavigate={(direction) => handleNavigate(index, direction)}
                  setItemRef={setRef}
                />
              );
            })
          )
        )}
      </div>

      {/* 底部：添加素材 */}
      <div className="p-3 border-t border-gray-200">
        <input
          ref={outroFileInputRef}
          type="file"
          accept="video/*,.mp4,.mov,.webm,.avi,.mkv"
          multiple
          className="hidden"
          onChange={handleOutroFileSelect}
        />

        {/* 处理中显示进度条和步骤 */}
        {isAddingOutro && (
          <div className="mb-2">
            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
              <span>{processingStep || '处理中...'}</span>
              <span>{outroUploadProgress}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gray-600 transition-all duration-300"
                style={{ width: `${outroUploadProgress}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={() => outroFileInputRef.current?.click()}
          disabled={isAddingOutro}
          className={`w-full flex items-center justify-center gap-2 py-2.5 
                      text-xs font-medium rounded-lg transition-all
                      ${isAddingOutro
              ? 'bg-gray-100 text-gray-700 cursor-wait'
              : 'text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 hover:shadow-sm'
            }`}
        >
          {isAddingOutro ? (
            <>
              <RabbitLoader size={14} />
              <span>处理中...</span>
            </>
          ) : (
            <>
              <Plus size={14} />
              <span>添加素材</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
