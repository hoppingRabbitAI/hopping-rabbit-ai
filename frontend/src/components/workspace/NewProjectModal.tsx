'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  Upload,
  FileVideo,
  ImageIcon,
  Loader2,
  Trash2,
  Plus,
} from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';

// ==========================================
// NewProjectModal — 创建新项目弹窗
// 选择图片/视频 → 创建 project → 上传 → finalize → 跳转
// ==========================================

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
}

interface SelectedFile {
  file: File;
  previewUrl: string;
  type: 'image' | 'video';
}

const ACCEPTED_TYPES = 'image/*,video/*';
const MAX_FILES = 20;

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addProject } = useProjectStore();

  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ---------- 文件选择 ----------

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const valid = arr.filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (valid.length === 0) return;

    setSelectedFiles((prev) => {
      const combined = [...prev];
      for (const file of valid) {
        if (combined.length >= MAX_FILES) break;
        // 去重
        if (combined.some((s) => s.file.name === file.name && s.file.size === file.size)) continue;
        combined.push({
          file,
          previewUrl: URL.createObjectURL(file),
          type: file.type.startsWith('video/') ? 'video' : 'image',
        });
      }
      return combined;
    });
    setError(null);
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }, []);

  // ---------- 拖放 ----------

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFiles(e.target.files);
      e.target.value = '';
    },
    [addFiles]
  );

  // ---------- 创建项目 ----------

  const handleCreate = useCallback(async () => {
    if (selectedFiles.length === 0 || isCreating) return;
    setIsCreating(true);
    setError(null);

    try {
      const { authFetch } = await import('@/lib/supabase/session');

      // 1. 创建项目
      setProgress('创建项目...');
      const projectName = `新项目 - ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
      const createRes = await authFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName }),
      });

      if (!createRes.ok) {
        throw new Error(`创建项目失败: ${createRes.status}`);
      }
      const projectData = await createRes.json();
      const project_id = projectData.id;

      // 2. 批量上传所有文件（一次请求）
      setProgress(`上传 ${selectedFiles.length} 个文件...`);
      const formData = new FormData();
      formData.append('project_id', project_id);
      for (const sf of selectedFiles) {
        formData.append('files', sf.file);
      }

      const uploadRes = await authFetch('/api/upload/batch', {
        method: 'POST',
        body: formData,
        // 不设 Content-Type，让浏览器自动加 boundary
      });

      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error(errData.detail || `上传失败: ${uploadRes.status}`);
      }

      const uploadResult = await uploadRes.json();
      if (uploadResult.fail_count > 0) {
        console.warn('[NewProjectModal] 部分文件上传失败:', uploadResult.failed);
      }

      // 3. 添加到项目列表
      const now = new Date().toISOString();
      addProject({
        id: project_id,
        name: projectName,
        updatedAt: now,
        createdAt: now,
        status: 'completed',
      });

      // 4. 跳转到视觉编辑器
      setProgress('即将进入编辑器...');
      router.push(`/visual-editor?project=${project_id}`);
      onClose();
    } catch (err) {
      console.error('[NewProjectModal] 创建失败:', err);
      setError(err instanceof Error ? err.message : '创建失败，请重试');
    } finally {
      setIsCreating(false);
      setProgress('');
    }
  }, [selectedFiles, isCreating, router, onClose, addProject]);

  // ---------- 关闭时清理 ----------

  const handleClose = useCallback(() => {
    if (isCreating) return;
    selectedFiles.forEach((sf) => URL.revokeObjectURL(sf.previewUrl));
    setSelectedFiles([]);
    setError(null);
    onClose();
  }, [isCreating, selectedFiles, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* 弹窗内容 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">创建新项目</h2>
          <button
            onClick={handleClose}
            disabled={isCreating}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* 拖放上传区域 */}
          {selectedFiles.length === 0 ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                flex flex-col items-center justify-center h-64 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200
                ${isDragging
                  ? 'border-gray-800 bg-gray-50 scale-[1.01]'
                  : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                }
              `}
            >
              <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <Upload size={24} className="text-gray-500" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">
                拖放图片或视频到这里
              </p>
              <p className="text-xs text-gray-400">
                支持 JPG、PNG、MP4、MOV 等格式，最多 {MAX_FILES} 个文件
              </p>
            </div>
          ) : (
            <>
              {/* 文件预览网格 */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {selectedFiles.map((sf, index) => (
                  <div
                    key={`${sf.file.name}-${index}`}
                    className="relative group aspect-square rounded-xl overflow-hidden bg-gray-100 border border-gray-200"
                  >
                    {sf.type === 'image' ? (
                      <img
                        src={sf.previewUrl}
                        alt={sf.file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-900">
                        <video
                          src={sf.previewUrl}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          onLoadedData={(e) => {
                            (e.target as HTMLVideoElement).currentTime = 0.5;
                          }}
                        />
                        <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 bg-black/60 rounded text-[10px] text-white flex items-center gap-1">
                          <FileVideo size={10} />
                          视频
                        </div>
                      </div>
                    )}

                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                      className="absolute top-1.5 right-1.5 p-1 bg-black/50 hover:bg-black/70 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={12} />
                    </button>

                    {/* 类型图标 */}
                    {sf.type === 'image' && (
                      <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 bg-black/60 rounded text-[10px] text-white flex items-center gap-1">
                        <ImageIcon size={10} />
                        图片
                      </div>
                    )}
                  </div>
                ))}

                {/* 添加更多 */}
                {selectedFiles.length < MAX_FILES && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-xl border-2 border-dashed border-gray-200 hover:border-gray-400 hover:bg-gray-50 flex flex-col items-center justify-center gap-1 transition-colors"
                  >
                    <Plus size={20} className="text-gray-400" />
                    <span className="text-[10px] text-gray-400">添加</span>
                  </button>
                )}
              </div>

              <p className="mt-3 text-xs text-gray-400 text-center">
                已选择 {selectedFiles.length} 个文件
              </p>
            </>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={handleClose}
            disabled={isCreating}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={selectedFiles.length === 0 || isCreating}
            className={`
              px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
              ${selectedFiles.length > 0 && !isCreating
                ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }
            `}
          >
            {isCreating ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                {progress || '创建中...'}
              </span>
            ) : (
              `创建项目 (${selectedFiles.length})`
            )}
          </button>
        </div>

        {/* 隐藏的文件选择器 */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
      </div>
    </div>
  );
}
