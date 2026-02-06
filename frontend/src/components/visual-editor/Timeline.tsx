'use client';

import React, { useState } from 'react';
import { useVisualEditorStore, useCurrentShot } from '@/stores/visualEditorStore';
import { Shot } from '@/types/visual-editor';
import { Plus, ChevronRight, ZoomIn, ZoomOut, LayoutGrid, LayoutList } from 'lucide-react';

// ==========================================
// 工具函数
// ==========================================

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

// 缩放等级配置
const ZOOM_LEVELS = [
  { scale: 0.5, cardWidth: 64, cardHeight: 48, label: 'XS' },
  { scale: 0.75, cardWidth: 80, cardHeight: 60, label: 'S' },
  { scale: 1, cardWidth: 128, cardHeight: 72, label: 'M' },
  { scale: 1.25, cardWidth: 160, cardHeight: 90, label: 'L' },
  { scale: 1.5, cardWidth: 192, cardHeight: 108, label: 'XL' },
];

// ==========================================
// 分镜缩略图
// ==========================================

interface ShotThumbnailProps {
  shotId: string;
  index: number;
  thumbnail?: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
  onClick: () => void;
  zoomLevel: typeof ZOOM_LEVELS[number];
  compact: boolean;
}

function ShotThumbnail({ 
  index, 
  thumbnail, 
  startTime, 
  endTime, 
  isActive, 
  onClick,
  zoomLevel,
  compact
}: ShotThumbnailProps) {
  const duration = endTime - startTime;
  const isSmall = zoomLevel.scale <= 0.75;
  
  return (
    <button
      onClick={onClick}
      style={{ width: zoomLevel.cardWidth }}
      className={`flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all shadow-sm ${
        isActive
          ? 'border-gray-800 shadow-lg ring-2 ring-gray-400'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      {/* 缩略图 */}
      <div 
        className="relative bg-gray-100"
        style={{ height: zoomLevel.cardHeight }}
      >
        {thumbnail ? (
          <img 
            src={thumbnail} 
            alt={`Shot ${index + 1}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-50">
            <span className={`text-gray-300 font-black ${isSmall ? 'text-lg' : 'text-2xl'}`}>
              {index + 1}
            </span>
          </div>
        )}
        
        {/* 分镜序号标签 */}
        <div className={`absolute top-0.5 left-0.5 px-1 py-0.5 rounded font-bold ${
          isActive ? 'bg-gray-800 text-white' : 'bg-white/90 text-gray-700'
        } ${isSmall ? 'text-[10px]' : 'text-xs'}`}>
          #{index + 1}
        </div>
      </div>
      
      {/* 时间信息 - 紧凑模式隐藏 */}
      {!compact && (
        <div className={`bg-white flex items-center justify-center text-gray-500 ${
          isSmall ? 'h-5 text-[10px]' : 'h-6 text-xs'
        }`}>
          {isSmall ? `${duration.toFixed(1)}s` : `${formatTime(startTime)} - ${duration.toFixed(1)}s`}
        </div>
      )}
    </button>
  );
}

// ==========================================
// 添加分镜按钮
// ==========================================

interface AddShotButtonProps {
  zoomLevel: typeof ZOOM_LEVELS[number];
}

function AddShotButton({ zoomLevel }: AddShotButtonProps) {
  const isSmall = zoomLevel.scale <= 0.75;
  
  return (
    <button
      style={{ width: zoomLevel.cardWidth, height: zoomLevel.cardHeight + 20 }}
      className="flex-shrink-0 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors bg-white/50"
    >
      <Plus size={isSmall ? 14 : 20} />
      {!isSmall && <span className="text-xs">添加</span>}
    </button>
  );
}

// ==========================================
// 主组件
// ==========================================

export default function Timeline() {
  const { shots, currentShotId, setCurrentShot } = useVisualEditorStore();
  const currentShot = useCurrentShot();
  
  // 状态：缩放等级和布局模式
  const [zoomIndex, setZoomIndex] = useState(0); // 默认最小 (XS)
  const [isWrapMode, setIsWrapMode] = useState(true); // 默认换行
  
  const zoomLevel = ZOOM_LEVELS[zoomIndex];
  
  // 缩放控制
  const zoomIn = () => setZoomIndex(Math.min(zoomIndex + 1, ZOOM_LEVELS.length - 1));
  const zoomOut = () => setZoomIndex(Math.max(zoomIndex - 1, 0));
  
  // 计算总时长
  const totalDuration = shots.length > 0 
    ? shots[shots.length - 1].endTime 
    : 0;
  
  // 根据模式计算高度
  const containerHeight = isWrapMode ? 'max-h-64' : 'h-32';
    
  return (
    <div className={`bg-white border-t border-gray-200 flex flex-col ${isWrapMode ? '' : 'h-32'}`}>
      {/* 顶部：时间信息和控制栏 */}
      <div className="h-8 border-b border-gray-100 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="font-medium">分镜时间轴</span>
          <ChevronRight size={14} />
          <span className="text-gray-900 font-bold">{shots.length} 个分镜</span>
        </div>
        
        <div className="flex items-center gap-4">
          {/* 缩放控制 */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={zoomOut}
              disabled={zoomIndex === 0}
              className="p-1 rounded hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="缩小"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-xs font-medium w-6 text-center text-gray-600">
              {zoomLevel.label}
            </span>
            <button
              onClick={zoomIn}
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              className="p-1 rounded hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="放大"
            >
              <ZoomIn size={14} />
            </button>
          </div>
          
          {/* 布局切换 */}
          <button
            onClick={() => setIsWrapMode(!isWrapMode)}
            className={`p-1 rounded transition-colors ${
              isWrapMode ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title={isWrapMode ? '切换为单行' : '切换为换行'}
          >
            {isWrapMode ? <LayoutGrid size={14} /> : <LayoutList size={14} />}
          </button>
          
          {/* 时间信息 */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-400">
              当前: <span className="text-gray-600">{currentShot ? formatTime(currentShot.startTime) : '--:--'}</span>
            </span>
            <span className="text-gray-400">
              总时长: <span className="text-gray-600 font-medium">{formatTime(totalDuration)}</span>
            </span>
          </div>
        </div>
      </div>
      
      {/* 底部：分镜缩略图列表 */}
      <div className={`flex-1 px-4 py-2 overflow-auto ${containerHeight}`}>
        <div className={`flex gap-2 ${isWrapMode ? 'flex-wrap content-start' : 'items-center'}`}>
          {shots.map((shot: Shot, index: number) => (
            <ShotThumbnail
              key={shot.id}
              shotId={shot.id}
              index={index}
              thumbnail={shot.thumbnail}
              startTime={shot.startTime}
              endTime={shot.endTime}
              isActive={shot.id === currentShotId}
              onClick={() => setCurrentShot(shot.id)}
              zoomLevel={zoomLevel}
              compact={zoomLevel.scale <= 0.5}
            />
          ))}
          
          <AddShotButton zoomLevel={zoomLevel} />
        </div>
      </div>
    </div>
  );
}
