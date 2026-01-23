'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { X, Search, Plus, Mic, Settings2 } from 'lucide-react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { Toggle } from '@/components/common/Toggle';
import { useEditorStore } from '../store/editor-store';
import { getVideoDuration } from '../lib/media-cache';
import { uploadVideo, assetApi } from '@/lib/api/assets';
import type { Asset } from '../types/asset';

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

interface AssetItemProps {
  asset: Asset;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  setItemRef: (el: HTMLDivElement | null) => void;
}

function AssetItem({ asset, index, isSelected, onSelect, setItemRef }: AssetItemProps) {
  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTypeIcon = () => {
    switch (asset.type) {
      case 'video': return '🎬';
      case 'audio': return '🎵';
      case 'image': return '🖼️';
      default: return '📄';
    }
  };

  // 处理拖拽开始
  const handleDragStart = (e: React.DragEvent) => {
    // 只允许视频和音频素材拖拽到时间轴
    if (asset.type !== 'video' && asset.type !== 'audio') {
      e.preventDefault();
      return;
    }
    
    // 设置拖拽数据
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'asset',
      asset: asset,
    }));
    e.dataTransfer.effectAllowed = 'copy';
    
    // 设置拖拽图片（可选，使用缩略图）
    if (asset.thumbnail_url) {
      const img = new Image();
      img.src = asset.thumbnail_url;
      e.dataTransfer.setDragImage(img, 20, 20);
    }
  };

  // 判断是否可拖拽
  const isDraggable = asset.type === 'video' || asset.type === 'audio';

  return (
    <div
      ref={setItemRef}
      onClick={onSelect}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      className={`group relative rounded-md transition-all duration-150 ${
        isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${
        isSelected
          ? 'bg-blue-50 border border-blue-400 shadow-sm'
          : 'bg-white hover:bg-gray-50 border border-transparent hover:border-gray-200'
      }`}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <span className="flex-shrink-0 text-[10px] font-bold text-gray-400 w-5">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="flex-shrink-0 w-10 h-10 rounded bg-gray-100 flex items-center justify-center overflow-hidden">
          {asset.thumbnail_url ? (
            <img src={asset.thumbnail_url} alt={asset.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg">{getTypeIcon()}</span>
          )}
        </div>
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

interface AssetsPanelProps {
  onClose: () => void;
}

export function AssetsPanel({ onClose }: AssetsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddingOutro, setIsAddingOutro] = useState(false);
  const [outroUploadProgress, setOutroUploadProgress] = useState(0);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [showAddOptionsDialog, setShowAddOptionsDialog] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [addOptions, setAddOptions] = useState({
    enableAsr: false,
    enableSmartCamera: false,
  });

  const outroFileInputRef = useRef<HTMLInputElement>(null);
  const clipRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const projectId = useEditorStore((s) => s.projectId);
  const assets = useEditorStore((s) => s.assets);
  const loadClips = useEditorStore((s) => s.loadClips);
  const loadAssets = useEditorStore((s) => s.loadAssets);
  const loadKeyframes = useEditorStore((s) => s.loadKeyframes);
  const requestCleanupWizard = useEditorStore((s) => s.requestCleanupWizard);
  const setSelectedClipId = useEditorStore((s) => s.setSelectedClipId);

  // 筛选素材
  const sortedAssets = useMemo(() => {
    return [...assets].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [assets]);

  const filteredAssets = useMemo(() => {
    if (!searchQuery.trim()) return sortedAssets;
    const query = searchQuery.toLowerCase();
    return sortedAssets.filter(a =>
      a.name?.toLowerCase().includes(query)
    );
  }, [sortedAssets, searchQuery]);

  // 添加素材处理
  const handleAddOutroMultiple = useCallback(async (
    files: File[],
    options: { enableAsr: boolean; enableSmartCamera: boolean }
  ) => {
    if (!projectId || files.length === 0) return;

    setIsAddingOutro(true);
    setOutroUploadProgress(0);
    setProcessingStep('正在上传文件...');

    try {
      const uploadedAssetIds: string[] = [];
      const totalFiles = files.length;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProcessingStep(`正在上传 (${i + 1}/${totalFiles}): ${file.name}`);

        const durationMs = await getVideoDuration(file);

        const result = await uploadVideo(
          file,
          projectId,
          durationMs,
          (progress) => {
            const totalProgress = ((i + progress.percentage / 100) / totalFiles) * 50;
            setOutroUploadProgress(Math.round(totalProgress));
          }
        );

        uploadedAssetIds.push(result.asset_id);
      }

      setProcessingStep(options.enableAsr ? '正在处理素材 (ASR转写)...' : '正在处理素材...');
      setOutroUploadProgress(50);

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

      let completed = false;
      let pollCount = 0;
      const maxPolls = 600;

      while (!completed && pollCount < maxPolls) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        pollCount++;

        const statusResponse = await assetApi.getProcessAdditionsStatus(taskId);

        if (statusResponse.error || !statusResponse.data) continue;

        const status = statusResponse.data;
        const totalProgress = 50 + (status.progress * 0.5);
        setOutroUploadProgress(Math.round(totalProgress));

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
        } else if (status.status === 'failed') {
          throw new Error(status.error || '处理失败');
        }
      }

      if (!completed) {
        throw new Error('处理超时');
      }

      setProcessingStep('正在刷新...');
      await Promise.all([loadClips(), loadAssets(), loadKeyframes()]);
      setOutroUploadProgress(100);
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

  const handleOutroFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    e.target.value = '';

    setSelectedClipId(null);
    setPendingFiles(files);
    setShowAddOptionsDialog(true);
  }, [setSelectedClipId]);

  const handleConfirmAddOptions = useCallback(async () => {
    if (pendingFiles.length === 0) return;
    const currentOptions = { ...addOptions };
    setShowAddOptionsDialog(false);
    await handleAddOutroMultiple(pendingFiles, currentOptions);
    setPendingFiles([]);
  }, [pendingFiles, handleAddOutroMultiple, addOptions]);

  const handleCancelAddOptions = useCallback(() => {
    setShowAddOptionsDialog(false);
    setPendingFiles([]);
  }, []);

  return (
    <div className="w-full h-full bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* 添加素材选项弹窗 */}
      {showAddOptionsDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 max-w-[90vw]">
            <h3 className="text-base font-semibold text-gray-900 mb-5">
              添加 {pendingFiles.length} 个素材
            </h3>

            <div className="space-y-4 mb-6">
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

      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-900">素材 ({assets.length})</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          title="关闭"
        >
          <X size={16} className="text-gray-500" />
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

      {/* 列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        {filteredAssets.length === 0 ? (
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
                isSelected={false}
                onSelect={() => {}}
                setItemRef={setRef}
              />
            );
          })
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
