/**
 * FileUploadNode — ComfyUI 风格的文件上传节点
 * 右键 → Import 后在画布上创建此节点
 * 支持拖放 / 点击上传 / 粘贴 URL
 * 上传完成后自动转化为 ClipNode（FreeNode）
 */

'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { UploadCloud, Link2, Loader2, CheckCircle, XCircle, Image, Film } from 'lucide-react';
import { materialsApi } from '@/lib/api';

// ============================================
// 类型
// ============================================

export interface FileUploadNodeData {
  /** 上传完成后的回调 — 把上传结果传回 WorkflowCanvas */
  onUploadComplete?: (nodeId: string, result: UploadResult) => void;
  /** 删除此占位节点 */
  onRemove?: (nodeId: string) => void;
}

export interface UploadResult {
  assetId: string;
  mediaType: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
  duration: number;       // 秒
  width?: number;
  height?: number;
  displayName?: string;
}

// ============================================
// 组件
// ============================================

export function FileUploadNode({ id, data }: NodeProps) {
  const nodeData = data as FileUploadNodeData;

  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // ---------- 上传逻辑 ----------

  const uploadFile = useCallback(async (file: File) => {
    if (uploading || done) return;

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const result = await materialsApi.uploadMaterial(file, 'general', {
        displayName: file.name,
        onProgress: (p) => setProgress(p),
        assetCategory: 'project_asset',
      });

      if (result.error || !result.data) {
        throw new Error(result.error?.message || '上传失败');
      }

      const mat = result.data;
      const isImage = mat.file_type === 'image';
      const defaultDurationMs = isImage ? 3000 : 5000;
      const durationMs = mat.duration || defaultDurationMs;

      setDone(true);
      nodeData.onUploadComplete?.(id, {
        assetId: mat.id,
        mediaType: isImage ? 'image' : 'video',
        url: mat.url || '',
        thumbnailUrl: mat.thumbnail_url || (isImage ? mat.url : undefined),
        duration: durationMs / 1000,
        width: mat.width,
        height: mat.height,
        displayName: mat.display_name || mat.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }, [id, uploading, done, nodeData]);

  // ---------- URL 导入 ----------

  const importFromUrl = useCallback(async () => {
    const url = urlValue.trim();
    if (!url || importingUrl || done) return;

    setImportingUrl(true);
    setError(null);

    try {
      const response = await materialsApi.importFromUrl(url, 'project_asset');
      if (response.error || !response.data?.asset) {
        throw new Error(response.error?.message || 'URL 导入失败');
      }

      const mat = response.data.asset;
      const isImage = mat.file_type === 'image';
      const defaultDurationMs = isImage ? 3000 : 5000;
      const durationMs = mat.duration || defaultDurationMs;

      setDone(true);
      nodeData.onUploadComplete?.(id, {
        assetId: mat.id,
        mediaType: isImage ? 'image' : 'video',
        url: mat.url || '',
        thumbnailUrl: mat.thumbnail_url || (isImage ? mat.url : undefined),
        duration: durationMs / 1000,
        width: mat.width,
        height: mat.height,
        displayName: mat.display_name || mat.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'URL 导入失败');
    } finally {
      setImportingUrl(false);
    }
  }, [id, urlValue, importingUrl, done, nodeData]);

  // ---------- 事件处理 ----------

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(
      f => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (files.length > 0) {
      void uploadFile(files[0]);
    }
  }, [uploadFile]);

  const handleClick = useCallback(() => {
    if (!uploading && !done) {
      inputRef.current?.click();
    }
  }, [uploading, done]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
      void uploadFile(file);
    }
    e.currentTarget.value = '';
  }, [uploadFile]);

  const handleRemove = useCallback(() => {
    nodeData.onRemove?.(id);
  }, [id, nodeData]);

  // ---------- 渲染 ----------

  const isWorking = uploading || importingUrl;

  return (
    <div className="relative group">
      {/* 输出 Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
      />

      <div
        className={`
          w-[280px] rounded-xl overflow-hidden shadow-lg border-2 transition-all duration-200
          ${isDragOver
            ? 'border-gray-500 bg-gray-50 shadow-gray-200/50'
            : done
              ? 'border-gray-300 bg-white'
              : error
                ? 'border-red-300 bg-white'
                : 'border-gray-200 bg-white hover:border-gray-400'
          }
        `}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <UploadCloud size={14} className="text-gray-500" />
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Import</span>
          </div>
          {!isWorking && !done && (
            <button
              onClick={handleRemove}
              className="text-gray-300 hover:text-red-400 transition-colors p-0.5"
              title="删除"
            >
              <XCircle size={14} />
            </button>
          )}
          {done && <CheckCircle size={14} className="text-gray-500" />}
        </div>

        {/* 主体内容 */}
        <div className="p-3 space-y-2">
          {/* 拖放区域 */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            className={`
              flex flex-col items-center justify-center gap-2 py-6 rounded-lg
              border-2 border-dashed cursor-pointer transition-all
              ${isDragOver
                ? 'border-gray-400 bg-gray-50'
                : done
                  ? 'border-gray-300 bg-gray-50 cursor-default'
                  : isWorking
                    ? 'border-gray-200 bg-gray-50 cursor-wait'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-400 hover:bg-gray-50/50'
              }
            `}
          >
            {done ? (
              <>
                <CheckCircle size={28} className="text-gray-500" />
                <span className="text-sm font-medium text-gray-700">上传完成</span>
                <span className="text-[11px] text-gray-500">节点已转化</span>
              </>
            ) : isWorking ? (
              <>
                <Loader2 size={28} className="text-gray-500 animate-spin" />
                <span className="text-sm font-medium text-gray-600">
                  {uploading ? `上传中 ${progress}%` : '导入中...'}
                </span>
                {uploading && (
                  <div className="w-full max-w-[180px] h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gray-800 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Image size={22} className="text-gray-300" />
                  <Film size={22} className="text-gray-300" />
                </div>
                <span className="text-sm font-medium text-gray-500">拖放或点击上传</span>
                <span className="text-[11px] text-gray-400">支持图片 / 视频</span>
              </>
            )}
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-red-50 border border-red-100">
              <XCircle size={12} className="text-red-400 flex-shrink-0" />
              <span className="text-[11px] text-red-600 truncate">{error}</span>
            </div>
          )}

          {/* URL 导入 */}
          {!done && (
            <div className="space-y-1.5">
              {showUrlInput ? (
                <div className="flex items-center gap-1.5">
                  <input
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void importFromUrl(); }}
                    placeholder="https://..."
                    disabled={isWorking}
                    className="flex-1 h-7 px-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-transparent bg-white disabled:opacity-50"
                  />
                  <button
                    onClick={() => void importFromUrl()}
                    disabled={isWorking || !urlValue.trim()}
                    className="h-7 px-2.5 text-xs font-medium rounded-md bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {importingUrl ? '...' : '导入'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowUrlInput(true)}
                  disabled={isWorking}
                  className="w-full flex items-center justify-center gap-1.5 h-7 text-xs text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-40"
                >
                  <Link2 size={12} />
                  粘贴文件链接
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

export default FileUploadNode;
