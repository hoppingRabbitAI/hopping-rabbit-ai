'use client';

/**
 * 导出弹窗 — 从主线 Timeline 导出视频/图片
 *
 * 功能：
 *   1. 导出前预检（空主线、缺资源等）
 *   2. 分辨率/格式/帧率选择
 *   3. 导出类型判定说明（图片 or 视频 + 原因）
 *   4. 进度轮询 + 下载
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  X,
  Download,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Film,
  Image as ImageIcon,
  Settings2,
  FileVideo,
  FileImage,
  ExternalLink,
  RefreshCw,
  Info,
} from 'lucide-react';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import { exportApi } from '@/lib/api/export';
import type { ExportJob } from '@/lib/api/types';

// ==========================================
// 常量
// ==========================================

const RESOLUTION_PRESETS = [
  { id: '720p',  label: '720p',  desc: '1280×720 · 适合快速预览',       icon: '📱' },
  { id: '1080p', label: '1080p', desc: '1920×1080 · 推荐社交媒体发布',   icon: '🖥️' },
  { id: '2k',    label: '2K',    desc: '2560×1440 · 高清质量',           icon: '🎬' },
  { id: '4k',    label: '4K',    desc: '3840×2160 · 专业级',             icon: '🎞️' },
] as const;

const FORMAT_OPTIONS = [
  { id: 'mp4', label: 'MP4', desc: 'H.264 · 兼容性最佳，适合社交媒体' },
  { id: 'mov', label: 'MOV', desc: 'ProRes · 专业剪辑，文件较大' },
] as const;

const FPS_OPTIONS = [
  { value: 24, label: '24 fps', desc: '电影感' },
  { value: 30, label: '30 fps', desc: '标准（推荐）' },
  { value: 60, label: '60 fps', desc: '流畅' },
] as const;

type ExportPhase = 'settings' | 'precheck-fail' | 'exporting' | 'completed' | 'failed';

interface PreCheckIssue {
  level: 'error' | 'warning';
  message: string;
}

// ==========================================
// 组件
// ==========================================

interface ExportModalProps {
  onClose: () => void;
}

export default function ExportModal({ onClose }: ExportModalProps) {
  const { timeline, projectId, shots } = useVisualEditorStore();
  const { segments, totalDurationMs } = timeline;

  // ——— 设置 ———
  const [resolution, setResolution] = useState('1080p');
  const [format, setFormat] = useState('mp4');
  const [fps, setFps] = useState(30);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ——— 状态 ———
  const [phase, setPhase] = useState<ExportPhase>('settings');
  const [preCheckIssues, setPreCheckIssues] = useState<PreCheckIssue[]>([]);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [exportResult, setExportResult] = useState<ExportJob | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const pollRef = useRef(false);

  // ——— 导出类型推断 ———
  const hasVideo = segments.some(s => s.mediaType === 'video' || s.mediaType === 'ai-generated');
  const exportType: 'video' | 'image' =
    segments.length === 1 && !hasVideo ? 'image' : 'video';

  const exportTypeReason = exportType === 'image'
    ? '主线仅包含 1 个静态图片段，将导出为图片'
    : segments.length === 0
      ? '主线为空'
      : hasVideo
        ? '主线包含视频段，将导出为视频'
        : `主线包含 ${segments.length} 个图片段，将合成为视频`;

  // ==========================================
  // 预检
  // ==========================================

  const runPreCheck = useCallback((): PreCheckIssue[] => {
    const issues: PreCheckIssue[] = [];

    // 空主线
    if (segments.length === 0) {
      issues.push({ level: 'error', message: '主线为空，请先将画布节点加入主线' });
    }

    // 检查缺资源
    const missingMedia = segments.filter(seg => {
      if (seg.mediaType === 'transition') return false; // 过渡段可能没有独立资源
      return !seg.mediaUrl && !seg.thumbnail;
    });
    if (missingMedia.length > 0) {
      issues.push({
        level: 'error',
        message: `${missingMedia.length} 个片段缺少媒体资源（${missingMedia.map((_, i) => `片段${i + 1}`).join('、')}）`,
      });
    }

    // 检查时长异常
    const tooShort = segments.filter(s => s.durationMs < 100);
    if (tooShort.length > 0) {
      issues.push({
        level: 'warning',
        message: `${tooShort.length} 个片段时长过短（<0.1s），可能导致导出异常`,
      });
    }

    // 超长检查
    if (totalDurationMs > 30 * 60 * 1000) {
      issues.push({
        level: 'warning',
        message: `主线时长 ${(totalDurationMs / 60000).toFixed(1)} 分钟，导出可能耗时较长`,
      });
    }

    // 检查 projectId
    if (!projectId) {
      issues.push({ level: 'error', message: '无法获取项目 ID，请刷新页面重试' });
    }

    return issues;
  }, [segments, totalDurationMs, projectId]);

  // ==========================================
  // 开始导出
  // ==========================================

  const handleStartExport = useCallback(async () => {
    // 1. 预检
    const issues = runPreCheck();
    setPreCheckIssues(issues);

    const hasError = issues.some(i => i.level === 'error');
    if (hasError) {
      setPhase('precheck-fail');
      return;
    }

    // 2. 开始导出
    setPhase('exporting');
    setProgress(0);
    setStatusText('正在创建导出任务...');

    try {
      const response = await exportApi.startExport({
        project_id: projectId!,
        preset: resolution,
        custom_settings: {
          resolution: undefined, // 用 preset 控制
          fps,
          format,
        },
      });

      if (response.error || !response.data) {
        throw new Error(response.error?.message || '创建导出任务失败');
      }

      const jobId = response.data.job_id;
      setExportJobId(jobId);
      setStatusText('任务已创建，正在渲染...');

      // 3. 轮询状态
      pollRef.current = true;
      const pollResult = await exportApi.pollExportUntilComplete(jobId, {
        interval: 2000,
        timeout: 30 * 60 * 1000, // 30 min
        onProgress: (prog, status) => {
          if (!pollRef.current) return;
          setProgress(prog);
          const statusLabels: Record<string, string> = {
            pending: '排队中...',
            rendering: '正在渲染...',
            uploading: '上传中...',
            queued: '排队中...',
          };
          setStatusText(statusLabels[status] || `${status}...`);
        },
      });

      if (pollResult.error) {
        throw new Error(pollResult.error.message);
      }

      // 4. 完成
      setExportResult(pollResult.data!);
      setPhase('completed');
      setProgress(100);
      setStatusText('导出完成！');

      // 获取下载链接
      try {
        const dl = await exportApi.getDownloadUrl(jobId);
        setDownloadUrl(dl.url);
      } catch {
        // 下载链接获取失败不影响成功状态
        console.warn('[Export] 获取下载链接失败');
      }
    } catch (err) {
      console.error('[Export] 导出失败:', err);
      setErrorMessage(err instanceof Error ? err.message : '导出失败');
      setPhase('failed');
    }
  }, [projectId, resolution, fps, format, runPreCheck]);

  // ——— 取消导出 ———
  const handleCancelExport = useCallback(async () => {
    pollRef.current = false;
    if (exportJobId) {
      try {
        await exportApi.cancelExport(exportJobId);
      } catch {}
    }
    setPhase('settings');
    setProgress(0);
  }, [exportJobId]);

  // ——— 重试 ———
  const handleRetry = useCallback(() => {
    setPhase('settings');
    setProgress(0);
    setErrorMessage('');
    setExportResult(null);
    setDownloadUrl(null);
  }, []);

  // ——— 下载 ———
  const handleDownload = useCallback(() => {
    const url = downloadUrl || exportResult?.output_url;
    if (url) {
      window.open(url, '_blank');
    }
  }, [downloadUrl, exportResult]);

  // 清理轮询
  useEffect(() => {
    return () => { pollRef.current = false; };
  }, []);

  // ==========================================
  // 渲染
  // ==========================================

  const fmtDuration = (ms: number) => {
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const fmtFileSize = (bytes?: number) => {
    if (!bytes) return '--';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={phase === 'exporting' ? undefined : onClose} />

      {/* 弹窗 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-[520px] max-h-[85vh] overflow-hidden flex flex-col">
        {/* ——— Header ——— */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {exportType === 'video' ? (
              <div className="w-9 h-9 rounded-xl bg-gray-500/10 flex items-center justify-center">
                <Film size={18} className="text-gray-500" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-xl bg-gray-500/10 flex items-center justify-center">
                <ImageIcon size={18} className="text-gray-500" />
              </div>
            )}
            <div>
              <h2 className="text-base font-semibold text-gray-900">导出{exportType === 'video' ? '视频' : '图片'}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{segments.length} 段 · {fmtDuration(totalDurationMs)}</p>
            </div>
          </div>
          {phase !== 'exporting' && (
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <X size={18} />
            </button>
          )}
        </div>

        {/* ——— Body ——— */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ===== 设置阶段 ===== */}
          {(phase === 'settings' || phase === 'precheck-fail') && (
            <>
              {/* 导出类型说明 */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-gray-50 border border-gray-100">
                <Info size={15} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-600 leading-relaxed">{exportTypeReason}</p>
                  <p className="text-[11px] text-gray-400 mt-1">导出只包含主线中的内容，画布上未加入主线的节点不会被导出</p>
                </div>
              </div>

              {/* 预检错误 */}
              {phase === 'precheck-fail' && preCheckIssues.length > 0 && (
                <div className="space-y-2">
                  {preCheckIssues.map((issue, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 p-3 rounded-lg text-xs ${
                        issue.level === 'error'
                          ? 'bg-red-50 text-red-700 border border-red-100'
                          : 'bg-gray-50 text-gray-700 border border-gray-200'
                      }`}
                    >
                      {issue.level === 'error' ? <XCircle size={14} className="flex-shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />}
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 分辨率选择 */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2.5 block">分辨率</label>
                <div className="grid grid-cols-2 gap-2">
                  {RESOLUTION_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setResolution(preset.id)}
                      className={`flex items-center gap-2.5 p-3 rounded-xl border-2 text-left transition-all ${
                        resolution === preset.id
                          ? 'border-gray-900 bg-gray-50/50 ring-1 ring-gray-200'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-lg">{preset.icon}</span>
                      <div>
                        <div className={`text-sm font-semibold ${resolution === preset.id ? 'text-gray-800' : 'text-gray-800'}`}>
                          {preset.label}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{preset.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 高级选项折叠 */}
              <div>
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <Settings2 size={13} />
                  高级选项
                  <span className="text-[10px]">{showAdvanced ? '▲' : '▼'}</span>
                </button>

                {showAdvanced && (
                  <div className="mt-3 space-y-4 pl-1">
                    {/* 格式 */}
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1.5 block">输出格式</label>
                      <div className="flex gap-2">
                        {FORMAT_OPTIONS.map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => setFormat(opt.id)}
                            className={`flex-1 p-2.5 rounded-lg border text-left transition-all ${
                              format === opt.id
                                ? 'border-gray-900 bg-gray-50/50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className={`text-xs font-semibold ${format === opt.id ? 'text-gray-800' : 'text-gray-700'}`}>
                              {opt.label}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 帧率 */}
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1.5 block">帧率</label>
                      <div className="flex gap-2">
                        {FPS_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setFps(opt.value)}
                            className={`flex-1 p-2 rounded-lg border text-center transition-all ${
                              fps === opt.value
                                ? 'border-gray-900 bg-gray-50/50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className={`text-xs font-semibold ${fps === opt.value ? 'text-gray-800' : 'text-gray-700'}`}>
                              {opt.label}
                            </div>
                            <div className="text-[10px] text-gray-400">{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ===== 导出中 ===== */}
          {phase === 'exporting' && (
            <div className="flex flex-col items-center py-8 gap-5">
              <div className="relative w-20 h-20">
                {/* 进度环 */}
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="35" fill="none" stroke="#e5e7eb" strokeWidth="5" />
                  <circle
                    cx="40" cy="40" r="35" fill="none"
                    stroke="#6b7280" strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 35}`}
                    strokeDashoffset={`${2 * Math.PI * 35 * (1 - progress / 100)}`}
                    className="transition-all duration-500"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold text-gray-800 tabular-nums">{progress}%</span>
                </div>
              </div>

              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">{statusText}</p>
                <p className="text-xs text-gray-400 mt-1.5">
                  {exportType === 'video' ? `${fmtDuration(totalDurationMs)} 视频 · ${resolution} · ${format.toUpperCase()}` : '图片导出中'}
                </p>
              </div>

              <button
                onClick={handleCancelExport}
                className="mt-2 px-4 py-1.5 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                取消导出
              </button>
            </div>
          )}

          {/* ===== 完成 ===== */}
          {phase === 'completed' && exportResult && (
            <div className="flex flex-col items-center py-6 gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center">
                <CheckCircle2 size={32} className="text-gray-500" />
              </div>

              <div className="text-center">
                <p className="text-base font-semibold text-gray-900">导出成功！</p>
                <p className="text-xs text-gray-400 mt-1">
                  {resolution} · {format.toUpperCase()} · {fmtFileSize(exportResult.output_file_size)}
                </p>
              </div>

              {/* 下载按钮 */}
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-6 py-2.5 bg-gray-800 text-white rounded-xl hover:bg-gray-700 transition-colors font-medium text-sm shadow-lg shadow-gray-500/20"
              >
                <Download size={16} />
                下载文件
              </button>

              {exportResult.output_url && (
                <a
                  href={exportResult.output_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <ExternalLink size={11} />
                  在新标签页打开
                </a>
              )}
            </div>
          )}

          {/* ===== 失败 ===== */}
          {phase === 'failed' && (
            <div className="flex flex-col items-center py-6 gap-4">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                <XCircle size={32} className="text-red-500" />
              </div>

              <div className="text-center">
                <p className="text-base font-semibold text-gray-900">导出失败</p>
                <p className="text-xs text-red-500 mt-1.5 max-w-[360px]">{errorMessage}</p>
              </div>

              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2 text-sm text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-medium"
              >
                <RefreshCw size={14} />
                重新设置
              </button>
            </div>
          )}
        </div>

        {/* ——— Footer ——— */}
        {(phase === 'settings' || phase === 'precheck-fail') && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleStartExport}
              disabled={segments.length === 0}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg ${
                segments.length === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                  : 'bg-gray-900 text-white hover:bg-gray-800 shadow-gray-900/20'
              }`}
            >
              {exportType === 'video' ? <FileVideo size={15} /> : <FileImage size={15} />}
              开始导出
            </button>
          </div>
        )}

        {/* 完成/失败阶段的关闭按钮 */}
        {(phase === 'completed' || phase === 'failed') && (
          <div className="px-6 py-4 border-t border-gray-100 flex justify-center">
            <button
              onClick={onClose}
              className="px-6 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg transition-colors"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
