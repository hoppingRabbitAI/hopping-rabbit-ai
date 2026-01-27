'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { X, Download, Film, Check, ChevronDown, ExternalLink } from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { exportApi } from '@/lib/api';
import { toast } from '@/lib/stores/toast-store';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[ExportDialog]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[ExportDialog]', ...args); };

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// 分辨率选项 - 根据截图，都是正方形
const RESOLUTION_OPTIONS = [
  { id: '480p', label: '480P', description: '480×480', size: 480 },
  { id: '720p', label: '720P', description: '720×720', size: 720 },
  { id: '1080p', label: '1080P', description: '1080×1080', size: 1080 },
  { id: '2k', label: '2K', description: '1440×1440', size: 1440 },
  { id: '4k', label: '4K', description: '2160×2160', size: 2160 },
] as const;

// 帧率选项
const FPS_OPTIONS = [
  { value: 24, label: '24 fps' },
  { value: 25, label: '25 fps' },
  { value: 29.97, label: '29.97 fps' },
  { value: 30, label: '30 fps' },
  { value: 50, label: '50 fps' },
  { value: 59.94, label: '59.94 fps' },
  { value: 60, label: '60 fps' },
] as const;

// 格式化时长
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// 估算文件大小 (基于时长和分辨率)
function estimateFileSize(durationMs: number, resolution: string, fps: number): string {
  // 基础码率 (Mbps) - 根据分辨率
  const bitrateMap: Record<string, number> = {
    '480p': 2,
    '720p': 5,
    '1080p': 10,
    '2k': 20,
    '4k': 40,
    '8k': 80,
    'original': 10, // 默认按 1080p 估算
  };
  
  const bitrate = bitrateMap[resolution] || 10;
  const durationSec = durationMs / 1000;
  // 文件大小 = 码率(Mbps) * 时长(s) / 8 = MB
  const sizeMB = (bitrate * durationSec) / 8;
  
  if (sizeMB < 1) {
    return `${Math.round(sizeMB * 1024)} KB`;
  } else if (sizeMB < 1024) {
    return `${Math.round(sizeMB)} MB`;
  } else {
    return `${(sizeMB / 1024).toFixed(1)} GB`;
  }
}

// 下拉菜单组件
function Select({
  value,
  options,
  onChange,
}: {
  value: string | number;
  options: readonly { value?: string | number; id?: string; label: string; description?: string }[];
  onChange: (value: string | number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  
  const selectedOption = options.find(o => (o.value ?? o.id) === value);
  
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-lg text-gray-900 hover:border-gray-300 transition-colors"
      >
        <span className="text-sm">
          {selectedOption?.label}
          {selectedOption?.description && (
            <span className="text-gray-500 ml-2">{selectedOption.description}</span>
          )}
        </span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-64 overflow-y-auto">
            {options.map((option) => {
              const optionValue = option.value ?? option.id;
              const isSelected = optionValue === value;
              return (
                <button
                  key={String(optionValue)}
                  onClick={() => {
                    onChange(optionValue!);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                    isSelected ? 'bg-gray-50' : ''
                  }`}
                >
                  <div>
                    <span className="text-sm text-gray-900">{option.label}</span>
                    {option.description && (
                      <span className="text-xs text-gray-500 ml-2">{option.description}</span>
                    )}
                  </div>
                  {isSelected && <Check size={16} className="text-gray-900" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// 根据视频尺寸获取对应的分辨率选项
function getResolutionFromSize(width?: number, height?: number): string {
  if (!width && !height) return '1080p';
  const maxDim = Math.max(width || 0, height || 0);
  // 找到最接近的分辨率
  const sorted = [...RESOLUTION_OPTIONS].sort((a, b) => 
    Math.abs(a.size - maxDim) - Math.abs(b.size - maxDim)
  );
  return sorted[0]?.id || '1080p';
}

// 根据原始帧率获取最接近的标准帧率
function getNearestFps(originalFps?: number): number {
  if (!originalFps) return 30;
  const fpsValues = FPS_OPTIONS.map(o => o.value);
  return fpsValues.reduce((prev, curr) => 
    Math.abs(curr - originalFps) < Math.abs(prev - originalFps) ? curr : prev
  );
}

export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const router = useRouter();
  const projectId = useEditorStore((s) => s.projectId);
  const projectName = useEditorStore((s) => s.projectName);
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const clips = useEditorStore((s) => s.clips);
  const duration = useEditorStore((s) => s.duration);
  const assets = useEditorStore((s) => s.assets);
  
  // 获取第一个视频资源的原始分辨率和帧率
  const videoAsset = useMemo(() => {
    return assets.find(a => a.type === 'video');
  }, [assets]);
  
  const defaultResolution = useMemo(() => {
    return getResolutionFromSize(videoAsset?.metadata?.width, videoAsset?.metadata?.height);
  }, [videoAsset]);
  
  const defaultFps = useMemo(() => {
    return getNearestFps(videoAsset?.metadata?.fps);
  }, [videoAsset]);
  
  // 表单状态
  const [title, setTitle] = useState('');
  const [enableVideoExport, setEnableVideoExport] = useState(true);
  const [resolution, setResolution] = useState<string>(defaultResolution);
  const [fps, setFps] = useState<number>(defaultFps);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);  // 显示成功提示
  
  // 用于取消导出
  const currentJobIdRef = useRef<string | null>(null);
  const isCancelledRef = useRef(false);
  
  // 当默认值变化时更新（首次加载 assets 时）
  useEffect(() => {
    setResolution(defaultResolution);
  }, [defaultResolution]);
  
  useEffect(() => {
    setFps(defaultFps);
  }, [defaultFps]);
  
  // 计算时间轴总时长（基于 clips）
  const timelineDuration = useMemo(() => {
    if (duration > 0) return duration;
    // 如果没有 duration，从 clips 计算
    const videoClips = clips.filter(c => c.clipType === 'video');
    if (videoClips.length === 0) return 0;
    return Math.max(...videoClips.map(c => c.start + c.duration));
  }, [clips, duration]);
  
  // 获取封面（第一个视频 clip 的缩略图）
  const coverThumbnail = useMemo(() => {
    const videoClips = clips.filter(c => c.clipType === 'video');
    if (videoClips.length === 0) return null;
    // 按 start 排序取第一个
    const firstClip = videoClips.sort((a, b) => a.start - b.start)[0];
    return firstClip?.thumbnail || null;
  }, [clips]);
  
  // 估算文件大小
  const estimatedSize = useMemo(() => {
    if (timelineDuration <= 0) return '--';
    return estimateFileSize(timelineDuration, resolution, fps);
  }, [timelineDuration, resolution, fps]);
  
  // 初始化标题
  useEffect(() => {
    if (isOpen && projectName) {
      // 使用项目名称 + 日期作为默认标题
      const date = new Date();
      const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`;
      setTitle(`${dateStr}(${Math.floor(Math.random() * 10)})`);
    }
  }, [isOpen, projectName]);
  
  const handleExport = async () => {
    if (!enableVideoExport || !projectId) {
      toast.warning('请至少选择一种导出方式');
      return;
    }
    
    try {
      setIsExporting(true);
      setExportProgress(0);
      isCancelledRef.current = false;
      
      debugLog('开始导出', { title, resolution, fps });
      
      // 1. 启动导出任务
      const startResult = await exportApi.startExport({
        project_id: projectId,
        preset: resolution,
        custom_settings: { fps, format: 'mp4' },  // 显式指定 mp4 格式
      });
      
      if (startResult.error || !startResult.data) {
        throw new Error(startResult.error?.message || '启动导出失败');
      }
      
      const jobId = startResult.data.job_id;
      currentJobIdRef.current = jobId;
      debugLog('导出任务已创建', jobId);
      
      // 任务创建成功，显示成功提示，不再等待完成
      setIsExporting(false);
      setShowSuccess(true);
      
    } catch (error) {
      debugError('导出失败:', error);
      toast.error(error instanceof Error ? error.message : '导出失败');
      setIsExporting(false);
      setExportProgress(0);
      currentJobIdRef.current = null;
    }
  };
  
  const handleViewExports = () => {
    // 跳转到 workspace 的导出列表
    router.push('/workspace?tab=exports');
    onClose();
  };
  
  const handleCancel = async () => {
    if (isExporting && currentJobIdRef.current) {
      debugLog('取消导出任务', currentJobIdRef.current);
      isCancelledRef.current = true;
      
      try {
        await exportApi.cancelExport(currentJobIdRef.current);
        debugLog('导出任务已取消');
      } catch (error) {
        debugError('取消失败:', error);
      }
      
      setIsExporting(false);
      setExportProgress(0);
      currentJobIdRef.current = null;
    }
    setShowSuccess(false);
    onClose();
  };
  
  const handleClose = () => {
    setShowSuccess(false);
    onClose();
  };
  
  if (!isOpen) return null;
  
  // 显示成功提示
  if (showSuccess) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div 
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={handleClose}
        />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
          {/* 头部 */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">导出任务已创建</h2>
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          
          {/* 内容 */}
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
              <Check size={32} className="text-green-600" />
            </div>
            <p className="text-gray-700 mb-2">导出任务已提交，正在后台处理中</p>
            <p className="text-sm text-gray-500">你可以继续编辑，导出完成后可在导出记录中下载</p>
          </div>
          
          {/* 按钮 */}
          <div className="flex gap-3 px-6 pb-6">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              继续编辑
            </button>
            <button
              onClick={handleViewExports}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ExternalLink size={16} />
              查看导出记录
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 - 导出中点击也可以取消 */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleCancel}
      />
      
      {/* 对话框 - 黑白灰调性 */}
      <div className="relative w-full max-w-2xl bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden flex">
        {/* 左侧：预览封面 */}
        <div className="w-[320px] p-6 flex flex-col bg-gray-50 border-r border-gray-200">
          {/* 封面预览 */}
          <div className="aspect-[9/16] bg-gray-900 rounded-xl flex items-center justify-center overflow-hidden mb-4">
            {coverThumbnail ? (
              <img 
                src={coverThumbnail} 
                alt="封面" 
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center">
                {/* 兔子 Logo */}
                <div className="w-24 h-24 mx-auto mb-2 opacity-40">
                  <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain opacity-50" />
                </div>
                <p className="text-xs text-gray-500">暂无封面</p>
              </div>
            )}
          </div>
          
          {/* 底部信息 */}
          <div className="mt-auto pt-4 flex items-center gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <Film size={14} />
              <span>时长: {timelineDuration > 0 ? formatDuration(timelineDuration) : '--'}</span>
            </div>
            <span>|</span>
            <span>大小: {estimatedSize} (估计)</span>
          </div>
        </div>
        
        {/* 右侧：设置面板 */}
        <div className="flex-1 p-6">
          {/* 头部 */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900">导出视频</h2>
            <button
              onClick={onClose}
              disabled={isExporting}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <X size={18} className="text-gray-500" />
            </button>
          </div>
          
          {/* 设置内容 */}
          <div className="space-y-5">
            {/* 标题 */}
            <div className="flex items-center">
              <label className="w-20 text-sm text-gray-500 flex-shrink-0">标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入导出文件名"
                className="flex-1 px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:border-gray-400 focus:outline-none"
              />
            </div>
            
            {/* 视频导出 */}
            <div className="flex items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <div 
                  onClick={() => setEnableVideoExport(!enableVideoExport)}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    enableVideoExport 
                      ? 'bg-gray-900 border-gray-900' 
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {enableVideoExport && <Check size={14} className="text-white" />}
                </div>
                <span className="text-sm text-gray-900 font-medium">视频导出</span>
              </label>
            </div>
            
            {/* 分辨率 */}
            <div className="flex items-center">
              <label className="w-20 text-sm text-gray-500 flex-shrink-0">分辨率</label>
              <div className="flex-1">
                <Select
                  value={resolution}
                  options={RESOLUTION_OPTIONS}
                  onChange={(v) => setResolution(v as string)}
                />
              </div>
            </div>
            
            {/* 格式 */}
            <div className="flex items-center">
              <label className="w-20 text-sm text-gray-500 flex-shrink-0">格式</label>
              <div className="flex-1">
                <div className="px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-lg text-gray-900 text-sm">
                  mp4
                </div>
              </div>
            </div>
            
            {/* 帧率 */}
            <div className="flex items-center">
              <label className="w-20 text-sm text-gray-500 flex-shrink-0">帧率</label>
              <div className="flex-1">
                <Select
                  value={fps}
                  options={FPS_OPTIONS}
                  onChange={(v) => setFps(v as number)}
                />
              </div>
            </div>
          </div>
          
          {/* 导出进度条 */}
          {isExporting && (
            <div className="mt-6">
              <div className="flex justify-between text-xs text-gray-500 mb-2">
                <span>正在导出...</span>
                <span>{exportProgress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gray-900 transition-all duration-300"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            </div>
          )}
          
          {/* 底部按钮 */}
          <div className="mt-8 flex justify-end gap-3">
            <button
              onClick={handleCancel}
              className="px-6 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {isExporting ? '取消导出' : '取消'}
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || isProcessing || !enableVideoExport}
              className="flex items-center gap-2 px-8 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? (
                <>
                  <RabbitLoader size={16} />
                  <span>导出中...</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span>导出</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
