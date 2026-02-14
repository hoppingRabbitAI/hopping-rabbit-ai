/**
 * 素材选择侧边栏 — Lookbook Grid 风格
 * 左侧常驻面板，分类展示素材，支持拖拽/点击添加到画布
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Plus,
  Upload,
  Search,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Video,
  Star,
  Loader2,
  FolderHeart,
  Sparkles,
  MapPin,
  User,
  Shirt,
  Palette,
  Camera,
  StickyNote,
  Check,
} from 'lucide-react';
import { materialsApi } from '@/lib/api';
import type { UserMaterial } from '@/lib/api/materials';
import { useVisualEditorStore } from '@/stores/visualEditorStore';

// ============================================
// 类型定义
// ============================================

/** 素材分类 */
interface MaterialCategory {
  id: string;
  label: string;
  icon: React.ReactNode;
  fileType?: 'video' | 'image';
  tag?: string;
  maxSlots: number;
  optional?: boolean;
}

/** 分类下已选素材 */
interface CategorySelection {
  categoryId: string;
  materials: UserMaterial[];
}

interface MaterialSidebarProps {
  projectId?: string;
  onSelectMaterial?: (material: UserMaterial) => void;
  onAddToCanvas?: (materials: UserMaterial[]) => void;
}

// ============================================
// 默认分类配置
// ============================================

const DEFAULT_CATEGORIES: MaterialCategory[] = [
  {
    id: 'model',
    label: '模特 / 人物',
    icon: <User size={14} />,
    fileType: 'image',
    tag: 'model',
    maxSlots: 5,
  },
  {
    id: 'outfit',
    label: '服装 / 道具',
    icon: <Shirt size={14} />,
    fileType: 'image',
    tag: 'outfit',
    maxSlots: 4,
  },
  {
    id: 'style',
    label: '风格 / 氛围',
    icon: <Palette size={14} />,
    fileType: 'image',
    tag: 'style',
    maxSlots: 3,
  },
  {
    id: 'location',
    label: '场景 / 地点',
    icon: <MapPin size={14} />,
    fileType: 'image',
    tag: 'location',
    maxSlots: 2,
    optional: true,
  },
  {
    id: 'composition',
    label: '构图 / 姿态',
    icon: <Camera size={14} />,
    fileType: 'image',
    tag: 'composition',
    maxSlots: 3,
    optional: true,
  },
];

// ============================================
// 素材缩略图卡片
// ============================================

function MaterialThumb({
  material,
  size = 'sm',
  isSelected,
  onRemove,
}: {
  material: UserMaterial;
  size?: 'sm' | 'md';
  isSelected?: boolean;
  onRemove?: () => void;
}) {
  const [error, setError] = useState(false);
  const isVideo = material.file_type === 'video';
  const thumbUrl = material.thumbnail_url || (!isVideo ? material.url : undefined);
  const dim = size === 'sm' ? 'w-16 h-16' : 'w-20 h-20';

  return (
    <div className={`relative group ${dim} rounded-lg overflow-hidden border border-gray-200 flex-shrink-0 cursor-pointer`}>
      {!error && thumbUrl ? (
        <img
          src={thumbUrl}
          alt={material.display_name || material.name}
          className="w-full h-full object-cover"
          onError={() => setError(true)}
          draggable={false}
        />
      ) : (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center">
          {isVideo ? <Video size={16} className="text-gray-300" /> : <ImageIcon size={16} className="text-gray-300" />}
        </div>
      )}
      {isSelected && (
        <div className="absolute inset-0 bg-gray-500/20 border-2 border-gray-900 rounded-lg">
          <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-gray-800 rounded-full flex items-center justify-center">
            <Check size={10} className="text-white" />
          </div>
        </div>
      )}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 rounded-full items-center justify-center text-white hidden group-hover:flex"
        >
          <X size={10} />
        </button>
      )}
      {isVideo && material.duration && (
        <div className="absolute bottom-0.5 right-0.5 px-1 py-px bg-black/70 rounded text-[9px] text-white leading-none">
          {formatDuration(material.duration)}
        </div>
      )}
    </div>
  );
}

// ============================================
// 添加占位按钮
// ============================================

function AddSlot({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-0.5 hover:border-gray-400 hover:bg-gray-50 transition-colors flex-shrink-0"
    >
      <Upload size={14} className="text-gray-400" />
      <span className="text-[10px] text-gray-400 uppercase font-medium">Add</span>
    </button>
  );
}

// ============================================
// 分类区块组件
// ============================================

function CategorySection({
  category,
  materials,
  selectedIds,
  onToggle,
  onOpenPicker,
}: {
  category: MaterialCategory;
  materials: UserMaterial[];
  selectedIds: Set<string>;
  onToggle: (material: UserMaterial) => void;
  onOpenPicker: (categoryId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const selectedCount = materials.filter(m => selectedIds.has(m.id)).length;
  const selectedMaterials = materials.filter(m => selectedIds.has(m.id));
  const remainingSlots = Math.max(0, category.maxSlots - selectedCount);

  return (
    <div className="px-4 py-3">
      {/* 分类标题 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between mb-2 group"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400">{category.icon}</span>
          <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wider">
            {category.label}
            {category.optional && (
              <span className="text-gray-400 normal-case font-normal ml-1">(可选)</span>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">
            {selectedCount}/{category.maxSlots}
          </span>
          {collapsed ? (
            <ChevronRight size={14} className="text-gray-400" />
          ) : (
            <ChevronDown size={14} className="text-gray-400" />
          )}
        </div>
      </button>

      {/* 素材网格 */}
      {!collapsed && (
        <div className="flex flex-wrap gap-2">
          {/* 已选素材 */}
          {selectedMaterials.map((mat) => (
            <MaterialThumb
              key={mat.id}
              material={mat}
              isSelected
              onRemove={() => onToggle(mat)}
            />
          ))}
          {/* 未选素材（按 tag 过滤的候选） */}
          {materials
            .filter(m => !selectedIds.has(m.id))
            .slice(0, Math.max(0, 6 - selectedCount))
            .map((mat) => (
              <div key={mat.id} onClick={() => onToggle(mat)}>
                <MaterialThumb material={mat} />
              </div>
            ))}
          {/* 添加按钮 */}
          {remainingSlots > 0 && (
            <AddSlot onClick={() => onOpenPicker(category.id)} />
          )}
        </div>
      )}
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

// ============================================
// 主组件
// ============================================

export default function MaterialSidebar({ projectId, onSelectMaterial, onAddToCanvas }: MaterialSidebarProps) {
  const activeSidebar = useVisualEditorStore(state => state.activeSidebar);
  const closeSidebar = useVisualEditorStore(state => state.closeSidebar);
  const addFreeNodes = useVisualEditorStore(state => state.addFreeNodes);
  const isOpen = activeSidebar === 'materialPicker';

  // 素材数据
  const [allMaterials, setAllMaterials] = useState<UserMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // 搜索
  const [search, setSearch] = useState('');

  // 各分类已选素材 ID
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 备注文本
  const [notes, setNotes] = useState('');

  // 当前打开的内部选择面板（某个分类的全部素材浏览）
  const [activePicker, setActivePicker] = useState<string | null>(null);

  // 上传
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // 加载素材
  const loadMaterials = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await materialsApi.getMaterials({ limit: 200 });
      if (res.data) {
        setAllMaterials(res.data.items || []);
      }
    } catch (err) {
      console.error('[MaterialSidebar] 加载素材失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadMaterials();
    }
  }, [isOpen, loadMaterials]);

  // 按分类过滤素材
  const getMaterialsForCategory = useCallback((category: MaterialCategory) => {
    let filtered = allMaterials;
    if (category.fileType) {
      filtered = filtered.filter(m => m.file_type === category.fileType);
    }
    if (category.tag) {
      // 有 tag 的优先匹配 tag，否则显示全部
      const tagged = filtered.filter(m => m.tags?.includes(category.tag!));
      if (tagged.length > 0) return tagged;
    }
    // 搜索过滤
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(m =>
        (m.display_name || m.name || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allMaterials, search]);

  // 切换选择
  const handleToggle = useCallback((material: UserMaterial) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(material.id)) {
        next.delete(material.id);
      } else {
        next.add(material.id);
      }
      return next;
    });
    onSelectMaterial?.(material);
  }, [onSelectMaterial]);

  // 添加到画布
  const handleAddToCanvas = useCallback(() => {
    const selected = allMaterials.filter(m => selectedIds.has(m.id));
    if (selected.length > 0) {
      // 直接添加为 FreeNode 到画布
      const newFreeNodes = selected.map((mat, i) => ({
        id: `mat-${mat.id}-${Date.now()}`,
        mediaType: (mat.file_type === 'video' ? 'video' : 'image') as 'video' | 'image',
        thumbnail: mat.thumbnail_url || mat.url,
        videoUrl: mat.file_type === 'video' ? mat.url : undefined,
        assetId: mat.id,
        duration: mat.duration ? mat.duration / 1000 : 0,
        position: { x: 100 + i * 200, y: 200 + i * 30 },
      }));
      addFreeNodes(newFreeNodes);
      onAddToCanvas?.(selected);
      setSelectedIds(new Set());
      closeSidebar();
    }
  }, [allMaterials, selectedIds, addFreeNodes, onAddToCanvas, closeSidebar]);

  // 本地上传
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await materialsApi.uploadMaterial(file, 'general');
      }
      await loadMaterials();
    } catch (err) {
      console.error('[MaterialSidebar] 上传失败:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [loadMaterials]);

  if (!isOpen) return null;

  return (
    <>
      {/* 侧边栏 — 左侧定位 */}
      <div className="fixed left-0 top-14 bottom-0 w-72 bg-white shadow-xl z-40 flex flex-col border-r border-gray-200 animate-slide-in-left">
        {/* ═══ 头部 ═══ */}
        <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-base font-bold text-gray-900">素材面板</h2>
              <p className="text-[11px] text-gray-400 uppercase tracking-wider mt-0.5">Material Library</p>
            </div>
            <button
              onClick={closeSidebar}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X size={16} className="text-gray-500" />
            </button>
          </div>

          {/* 搜索框 */}
          <div className="relative mt-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索素材..."
              className="w-full h-8 pl-8 pr-3 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300"
            />
          </div>
        </div>

        {/* ═══ 分类列表 ═══ */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="text-gray-500 animate-spin" />
            </div>
          ) : (
            <>
              {DEFAULT_CATEGORIES.map((cat) => (
                <CategorySection
                  key={cat.id}
                  category={cat}
                  materials={getMaterialsForCategory(cat)}
                  selectedIds={selectedIds}
                  onToggle={handleToggle}
                  onOpenPicker={(catId) => {
                    fileInputRef.current?.click();
                  }}
                />
              ))}

              {/* 分隔线 */}
              <div className="mx-4 border-t border-gray-100" />

              {/* ═══ 备注区 ═══ */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <StickyNote size={14} className="text-gray-400" />
                  <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wider">
                    备注
                  </h3>
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="添加创作备注或说明..."
                  className="w-full h-20 p-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 placeholder:text-gray-400"
                />
              </div>

              {/* ═══ 全部素材概览 ═══ */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FolderHeart size={14} className="text-gray-400" />
                    <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wider">
                      全部素材
                    </h3>
                  </div>
                  <span className="text-[11px] text-gray-400">{allMaterials.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allMaterials.slice(0, 12).map((mat) => (
                    <div
                      key={mat.id}
                      onClick={() => handleToggle(mat)}
                      className="cursor-pointer"
                    >
                      <MaterialThumb
                        material={mat}
                        size="sm"
                        isSelected={selectedIds.has(mat.id)}
                      />
                    </div>
                  ))}
                  {allMaterials.length > 12 && (
                    <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-sm text-gray-400 font-medium">
                      +{allMaterials.length - 12}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ═══ 底部操作栏 ═══ */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-gray-100 bg-gray-50/80 space-y-2">
          {/* 上传按钮 */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full h-9 flex items-center justify-center gap-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            {uploading ? '上传中...' : '上传素材'}
          </button>

          {/* 添加到画布 */}
          {selectedIds.size > 0 && (
            <button
              onClick={handleAddToCanvas}
              className="w-full h-9 flex items-center justify-center gap-2 text-sm font-medium text-white bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors shadow-sm"
            >
              <Plus size={14} />
              添加到画布 ({selectedIds.size})
            </button>
          )}
        </div>

        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>

      {/* 滑入动画 */}
      <style jsx global>{`
        @keyframes slide-in-left {
          from {
            transform: translateX(-100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in-left {
          animation: slide-in-left 0.2s ease-out;
        }
      `}</style>
    </>
  );
}
