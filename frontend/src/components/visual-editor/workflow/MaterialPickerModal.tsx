/**
 * 素材选择弹窗 — 简化版
 * 仅保留素材库网格 + 搜索 + 类型筛选
 * 支持多选、排序，不含本地上传/URL导入/项目分镜等冗余入口
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Video,
  Image,
  Loader2,
  Search,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Layout,
  ListVideo,
  Layers,
} from 'lucide-react';
import { materialsApi } from '@/lib/api';
import type { UserMaterial } from '@/lib/api/materials';

// ============================================
// 类型定义
// ============================================

export interface SelectedMaterial {
  material: UserMaterial;
  order: number; // 排序顺序
}

/** 放置策略：素材添加到画布 / 主线 / 两者都加 */
export type PlacementStrategy = 'canvas' | 'timeline' | 'both';

interface MaterialPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (materials: SelectedMaterial[], placement: PlacementStrategy) => void;
  projectId?: string;
  title?: string;
  maxSelection?: number;
  /** 是否显示放置策略选择器 */
  showPlacement?: boolean;
  /** 默认放置策略 */
  defaultPlacement?: PlacementStrategy;
}

// ============================================
// 素材卡片组件
// ============================================

interface MaterialCardProps {
  material: UserMaterial;
  isSelected: boolean;
  selectionOrder?: number;
  onToggle: () => void;
}

function MaterialCard({ material, isSelected, selectionOrder, onToggle }: MaterialCardProps) {
  const [thumbnailError, setThumbnailError] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const isVideo = material.file_type === 'video';

  // ★ 图片没有独立缩略图时，直接用原图 URL
  const thumbnailUrl = material.thumbnail_url || (!isVideo ? material.url : undefined);
  const videoUrl = material.url;

  const handleVideoLoaded = () => {
    setVideoLoaded(true);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.pause();
    }
  };

  return (
    <div
      onClick={onToggle}
      className={`
        relative group rounded-xl overflow-hidden cursor-pointer
        border-2 transition-all duration-200
        ${isSelected
          ? 'border-gray-900 ring-2 ring-gray-200 scale-[0.98]'
          : 'border-transparent hover:border-gray-300'
        }
      `}
    >
      <div className="aspect-video bg-gray-100 relative">
        {!thumbnailError && thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={material.name}
            className="w-full h-full object-cover"
            onError={() => setThumbnailError(true)}
          />
        ) : isVideo && videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
              onLoadedData={handleVideoLoaded}
              onError={() => setThumbnailError(true)}
            />
            {!videoLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                <Video size={32} className="text-gray-300" />
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {isVideo ? (
              <Video size={32} className="text-gray-300" />
            ) : (
              <Image size={32} className="text-gray-300" />
            )}
          </div>
        )}

        {isVideo && material.duration && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 rounded text-xs text-white">
            {formatDuration(material.duration)}
          </div>
        )}

        {isSelected && (
          <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center text-white text-xs font-bold">
            {selectionOrder}
          </div>
        )}

        {!isSelected && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-white/80 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Plus size={20} className="text-gray-600" />
            </div>
          </div>
        )}
      </div>

      <div className="p-2 bg-white">
        <p className="text-sm text-gray-700 truncate">{material.display_name || material.name}</p>
        <p className="text-xs text-gray-400 capitalize">{material.file_type}</p>
      </div>
    </div>
  );
}

// ============================================
// 已选素材项组件
// ============================================

interface SelectedItemProps {
  material: SelectedMaterial;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

function SelectedItem({ material, index, total, onMoveUp, onMoveDown, onRemove }: SelectedItemProps) {
  const { material: mat } = material;
  const isVideo = mat.file_type === 'video';

  return (
    <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg group">
      <div className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
        {index + 1}
      </div>

      <div className="w-12 h-8 bg-gray-200 rounded overflow-hidden flex-shrink-0">
        {(mat.thumbnail_url || (!isVideo && mat.url)) ? (
          <img src={mat.thumbnail_url || mat.url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {isVideo ? <Video size={16} className="text-gray-400" /> : <Image size={16} className="text-gray-400" />}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 truncate">{mat.display_name || mat.name}</p>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="p-1 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronUp size={16} className="text-gray-500" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="p-1 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronDown size={16} className="text-gray-500" />
        </button>
        <button
          onClick={onRemove}
          className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-500"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// ============================================
// 工具函数
// ============================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function isSupportedMaterialType(fileType: string): fileType is 'video' | 'image' {
  return fileType === 'video' || fileType === 'image';
}

// ============================================
// 主组件
// ============================================

export function MaterialPickerModal({
  isOpen,
  onClose,
  onConfirm,
  projectId,
  title = '选择素材',
  maxSelection = 10,
  showPlacement = false,
  defaultPlacement = 'canvas',
}: MaterialPickerModalProps) {
  const [materials, setMaterials] = useState<UserMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMaterials, setSelectedMaterials] = useState<SelectedMaterial[]>([]);
  const [typeFilter, setTypeFilter] = useState<'all' | 'video' | 'image'>('all');
  const [placement, setPlacement] = useState<PlacementStrategy>(defaultPlacement);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    try {
      const response = await materialsApi.getMaterials({
        file_type: typeFilter !== 'all' ? typeFilter : undefined,
        limit: 100,
      });

      if (response.data?.items) {
        const filtered = response.data.items.filter((m) => isSupportedMaterialType(m.file_type));
        setMaterials(filtered);
      }
    } catch (error) {
      console.error('加载素材失败:', error);
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    if (isOpen) {
      void loadMaterials();
      setSelectedMaterials([]);
    }
  }, [isOpen, loadMaterials]);

  const toggleSelection = useCallback((material: UserMaterial) => {
    setSelectedMaterials((prev) => {
      const existing = prev.find((m) => m.material.id === material.id);
      if (existing) {
        return prev.filter((m) => m.material.id !== material.id);
      }
      if (prev.length >= maxSelection) {
        return prev;
      }
      return [...prev, { material, order: prev.length }];
    });
  }, [maxSelection]);

  const moveItem = useCallback((index: number, direction: 'up' | 'down') => {
    setSelectedMaterials((prev) => {
      const newList = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newList.length) return prev;
      [newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]];
      return newList;
    });
  }, []);

  const removeItem = useCallback((materialId: string) => {
    setSelectedMaterials((prev) => prev.filter((m) => m.material.id !== materialId));
  }, []);

  const handleConfirm = useCallback(() => {
    const ordered = selectedMaterials.map((m, idx) => ({
      ...m,
      order: idx,
    }));
    onConfirm(ordered, placement);
    onClose();
  }, [selectedMaterials, onConfirm, onClose, placement]);

  const filteredMaterials = materials.filter((mat) => {
    if (searchQuery) {
      const name = mat.display_name || mat.name;
      return name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={onClose} />

      <div className="fixed inset-[10%] md:inset-[12%] lg:inset-[15%] bg-white rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* 搜索 + 筛选栏 */}
        <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜索素材..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent bg-gray-50"
            />
          </div>

          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {(['all', 'video', 'image'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  typeFilter === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'all' ? '全部' : t === 'video' ? '视频' : '图片'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* 素材网格 */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 size={28} className="text-gray-500 animate-spin" />
              </div>
            ) : filteredMaterials.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <Image size={40} className="mb-2 opacity-40" />
                <p className="text-sm">暂无素材</p>
                <p className="text-xs mt-1">请先通过 Import 上传素材</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredMaterials.map((mat) => {
                  const selected = selectedMaterials.find((m) => m.material.id === mat.id);
                  const selectionOrder = selected
                    ? selectedMaterials.findIndex((m) => m.material.id === mat.id) + 1
                    : undefined;

                  return (
                    <MaterialCard
                      key={mat.id}
                      material={mat}
                      isSelected={!!selected}
                      selectionOrder={selectionOrder}
                      onToggle={() => toggleSelection(mat)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* 已选侧栏 — 仅在有选中时显示 */}
          {selectedMaterials.length > 0 && (
            <div className="w-64 flex flex-col bg-gray-50/80 border-l border-gray-100">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-medium text-gray-700">
                  已选 <span className="text-gray-600 font-semibold">{selectedMaterials.length}</span>
                  <span className="text-gray-400 font-normal text-xs"> / {maxSelection}</span>
                </h3>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {selectedMaterials.map((material, index) => (
                  <SelectedItem
                    key={material.material.id}
                    material={material}
                    index={index}
                    total={selectedMaterials.length}
                    onMoveUp={() => moveItem(index, 'up')}
                    onMoveDown={() => moveItem(index, 'down')}
                    onRemove={() => removeItem(material.material.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底栏 */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
          {/* 放置策略选择器 */}
          {showPlacement ? (
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setPlacement('canvas')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                  placement === 'canvas'
                    ? 'bg-white text-gray-900 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Layout size={12} />
                画布
              </button>
              <button
                onClick={() => setPlacement('timeline')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                  placement === 'timeline'
                    ? 'bg-white text-gray-900 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <ListVideo size={12} />
                主线
              </button>
              <button
                onClick={() => setPlacement('both')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                  placement === 'both'
                    ? 'bg-white text-gray-900 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Layers size={12} />
                全部
              </button>
            </div>
          ) : <div />}

          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedMaterials.length === 0}
              className={`
                px-5 py-2 rounded-lg text-sm font-medium transition-all
                ${selectedMaterials.length > 0
                  ? 'bg-gray-800 text-white hover:bg-gray-700 shadow-sm'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }
              `}
            >
              确认 {selectedMaterials.length > 0 && `(${selectedMaterials.length})`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default MaterialPickerModal;
