'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, Mic, Volume2, VolumeX, Trash2, RectangleHorizontal, RectangleVertical, Square, ChevronRight } from 'lucide-react';
import { useEditorStore } from '../store/editor-store';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

export function ContextMenu() {
  // 使用细粒度 selector 订阅
  const contextMenu = useEditorStore((s) => s.contextMenu);
  const clips = useEditorStore((s) => s.clips);
  const closeContextMenu = useEditorStore((s) => s.closeContextMenu);
  const extractSpeechFromClip = useEditorStore((s) => s.extractSpeechFromClip);
  const extractAudio = useEditorStore((s) => s.extractAudio);
  const removeClip = useEditorStore((s) => s.removeClip);
  const updateClip = useEditorStore((s) => s.updateClip);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [showAspectRatioMenu, setShowAspectRatioMenu] = useState(false);
  const [subMenuOnLeft, setSubMenuOnLeft] = useState(false);

  // 计算菜单位置，防止溢出屏幕边界
  useEffect(() => {
    if (!contextMenu.visible || !menuRef.current) return;

    const menuWidth = 256; // w-64 = 16rem = 256px
    const menuHeight = menuRef.current.offsetHeight || 300;
    const padding = 16; // 距离屏幕边缘的最小距离

    let x = contextMenu.x;
    let y = contextMenu.y;

    // 防止右侧溢出
    if (x + menuWidth + padding > window.innerWidth) {
      x = window.innerWidth - menuWidth - padding;
    }
    // 检测子菜单是否需要在左侧显示
    const subMenuWidth = 140;
    if (x + menuWidth + subMenuWidth + padding > window.innerWidth) {
      setSubMenuOnLeft(true);
    } else {
      setSubMenuOnLeft(false);
    }
    // 防止左侧溢出
    if (x < padding) {
      x = padding;
    }
    // 防止底部溢出
    if (y + menuHeight + padding > window.innerHeight) {
      y = window.innerHeight - menuHeight - padding;
    }
    // 防止顶部溢出
    if (y < padding) {
      y = padding;
    }

    setPosition({ x, y });
  }, [contextMenu.visible, contextMenu.x, contextMenu.y]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu.visible, closeContextMenu]);

  if (!contextMenu.visible) return null;

  const clip = clips.find((c) => c.id === contextMenu.clipId);

  const handleExtractSpeech = async () => {
    if (contextMenu.clipId) {
      closeContextMenu();
      try {
        await extractSpeechFromClip(contextMenu.clipId);
      } catch (error) {
        debugError('提取语音文案失败:', error);
        alert('提取语音文案失败：' + (error instanceof Error ? error.message : '未知错误'));
      }
    }
  };

  const handleExtractAudio = async () => {
    if (!contextMenu.clipId) return;
    
    // 检查是否是视频片段
    const clip = clips.find((c) => c.id === contextMenu.clipId);
    if (!clip || clip.clipType !== 'video') {
      alert('只能对视频片段进行音频提取');
      return;
    }
    
    closeContextMenu();
    
    try {
      await extractAudio(contextMenu.clipId);
    } catch (error) {
      debugError('音频提取失败:', error);
      alert('音频提取失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const handleDelete = () => {
    if (contextMenu.clipId) {
      removeClip(contextMenu.clipId);
      closeContextMenu();
    }
  };

  const handleSetAspectRatio = (ratio: '16:9' | '9:16' | '1:1') => {
    if (contextMenu.clipId) {
      updateClip(contextMenu.clipId, { aspectRatio: ratio });
      closeContextMenu();
    }
  };

  const handleToggleMute = () => {
    if (!contextMenu.clipId || !clip || clip.clipType !== 'video') return;
    updateClip(contextMenu.clipId, { isMuted: !clip.isMuted });
    closeContextMenu();
  };

  const currentAspectRatio = clip?.aspectRatio || '16:9';

  return (
    <div
      ref={menuRef}
      className="fixed bg-white border border-gray-200 rounded-2xl shadow-xl py-2 w-64 z-[100] animate-fade-in-zoom"
      style={{ top: position.y, left: position.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 头部信息 */}
      <div className="px-4 py-3 flex items-center space-x-3 border-b border-gray-100 mb-2">
        <div className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center text-gray-700">
          <Film size={14} />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-gray-900 uppercase truncate w-32">
            {clip?.name || 'Unknown'}
          </span>
          <span className="text-[8px] text-gray-500 font-bold">SOURCE CLIP</span>
        </div>
      </div>

      {/* 菜单项 */}
      <ContextMenuItem
        icon={<Mic size={16} />}
        label="识别字幕"
        onClick={handleExtractSpeech}
        primary
      />
      <ContextMenuItem
        icon={<Volume2 size={16} />}
        label="分离视频声音"
        onClick={handleExtractAudio}
      />
      
      {/* 静音/还原音频 - 只对视频片段显示 */}
      {clip?.clipType === 'video' && (
        <ContextMenuItem
          icon={clip.isMuted ? <Volume2 size={16} /> : <VolumeX size={16} />}
          label={clip.isMuted ? '还原音频' : '静音视频'}
          onClick={handleToggleMute}
        />
      )}
      
      {/* 视频比例设置 */}
      <div className="h-px bg-gray-100 my-2" />
      <div 
        className="relative"
        onMouseEnter={() => setShowAspectRatioMenu(true)}
        onMouseLeave={() => setShowAspectRatioMenu(false)}
      >
        <button className="context-menu-item w-full flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <RectangleHorizontal size={16} />
            <span className="tracking-tight">视频比例</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-[9px] text-gray-500">{currentAspectRatio}</span>
            <ChevronRight size={12} className="text-gray-500" />
          </div>
        </button>
        
        {/* 子菜单 */}
        {showAspectRatioMenu && (
          <div className={`absolute top-0 bg-white border border-gray-200 rounded-xl shadow-xl py-1 w-28 z-[101] ${subMenuOnLeft ? 'right-full mr-1' : 'left-full ml-1'}`}>
            <button
              onClick={() => handleSetAspectRatio('16:9')}
              className={`w-full px-3 py-1.5 text-[11px] flex items-center space-x-2 hover:bg-gray-100 transition-colors ${currentAspectRatio === '16:9' ? 'text-gray-700' : 'text-gray-700'}`}
            >
              <RectangleHorizontal size={12} />
              <span>16:9 横屏</span>
            </button>
            <button
              onClick={() => handleSetAspectRatio('9:16')}
              className={`w-full px-3 py-1.5 text-[11px] flex items-center space-x-2 hover:bg-gray-100 transition-colors ${currentAspectRatio === '9:16' ? 'text-gray-700' : 'text-gray-700'}`}
            >
              <RectangleVertical size={12} />
              <span>9:16 竖屏</span>
            </button>
            <button
              onClick={() => handleSetAspectRatio('1:1')}
              className={`w-full px-3 py-1.5 text-[11px] flex items-center space-x-2 hover:bg-gray-100 transition-colors ${currentAspectRatio === '1:1' ? 'text-gray-700' : 'text-gray-700'}`}
            >
              <Square size={12} />
              <span>1:1 方形</span>
            </button>
          </div>
        )}
      </div>

      <div className="h-px bg-gray-100 my-2" />
      <ContextMenuItem
        icon={<Trash2 size={16} />}
        label="删除此片段"
        onClick={handleDelete}
        danger
      />
    </div>
  );
}

// 菜单项子组件
function ContextMenuItem({
  icon,
  label,
  onClick,
  danger,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`context-menu-item ${danger ? 'danger' : ''} ${primary ? 'primary' : ''}`}
    >
      <div className={primary ? 'animate-pulse' : ''}>{icon}</div>
      <span className="tracking-tight">{label}</span>
    </button>
  );
}
