'use client';

import { useCallback, useMemo } from 'react';
import {
  Subtitles,
  FolderOpen,
  Sparkles,
  Move,
  Type,
  Music,
  Gauge,
  Palette,
  LayoutTemplate,
  Upload,
  Film,
  ArrowRightLeft,
  Sticker,
  ImagePlus,
  Smile,
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { CLIP_TYPE_COLORS, createDefaultClip } from '../types/clip';
import { DEFAULT_TEXT_STYLE } from '../types/text';

interface LibraryTool {
  id: string;
  name: string;
  icon: React.ReactNode;
  description?: string;
  disabled?: boolean;
}

const LIBRARY_TOOLS: LibraryTool[] = [
  { id: 'subtitles', name: 'Subtitles', icon: <Subtitles size={22} />, description: '字幕列表' },
  { id: 'assets', name: 'Assets', icon: <FolderOpen size={22} />, description: '素材库' },
  { id: 'ai-tools', name: 'AI tools', icon: <Sparkles size={22} />, description: '智能剪辑助手' },
  { id: 'image-adjust', name: 'Adjust', icon: <Palette size={22} />, description: '调节(图片/视频)' },
  { id: 'beauty', name: 'Beauty', icon: <Smile size={22} />, description: '美颜美体' },
  { id: 'transform', name: 'Transform', icon: <Move size={22} />, description: '变换与动画' },
  { id: 'text', name: 'Text', icon: <Type size={22} />, description: '添加文字' },
  { id: 'audio', name: 'Audio', icon: <Music size={22} />, description: '音频调节' },
  { id: 'speed', name: 'Speed', icon: <Gauge size={22} />, description: '视频变速' },
  { id: 'b-roll', name: 'B-roll', icon: <Film size={22} />, description: 'B-roll 素材库' },
  { id: 'template', name: 'Template', icon: <LayoutTemplate size={22} />, description: '模板库', disabled: true },
  { id: 'upload', name: 'Upload', icon: <Upload size={22} />, description: '上传素材' },
  { id: 'transition', name: 'Transition', icon: <ArrowRightLeft size={22} />, description: '转场效果', disabled: true },
  { id: 'sticker', name: 'Sticker', icon: <Sticker size={22} />, description: '贴纸表情', disabled: true },
  { id: 'image', name: 'Image', icon: <ImagePlus size={22} />, description: '图片素材', disabled: true },
];

interface LibrarySidebarProps {
  onUploadClick?: () => void;
}

export function LibrarySidebar({ onUploadClick }: LibrarySidebarProps) {
  const activeLeftPanel = useEditorStore((s) => s.activeLeftPanel);
  const setActiveLeftPanel = useEditorStore((s) => s.setActiveLeftPanel);
  const activeSidebarPanel = useEditorStore((s) => s.activeSidebarPanel);
  const setActiveSidebarPanel = useEditorStore((s) => s.setActiveSidebarPanel);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.clips);
  const addClip = useEditorStore((s) => s.addClip);
  const findOrCreateTrack = useEditorStore((s) => s.findOrCreateTrack);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectClip = useEditorStore((s) => s.selectClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);

  // 检查是否选中了视频 clip
  const selectedVideoClip = useMemo(() => {
    if (!selectedClipId) return null;
    const clip = clips.find(c => c.id === selectedClipId);
    return clip?.clipType === 'video' ? clip : null;
  }, [selectedClipId, clips]);

  // 获取所有选中的视频 clips
  const selectedVideoClips = useMemo(() => {
    const allSelectedIds = selectedClipIds.size > 0 ? Array.from(selectedClipIds) : (selectedClipId ? [selectedClipId] : []);
    return allSelectedIds
      .map(id => clips.find(c => c.id === id))
      .filter(c => c && c.clipType === 'video') as typeof clips;
  }, [selectedClipId, selectedClipIds, clips]);

  // 检查是否选中了可变速的 clip
  const selectedSpeedableClip = useMemo(() => {
    if (!selectedClipId) return null;
    const clip = clips.find(c => c.id === selectedClipId);
    const speedableTypes = ['video', 'audio', 'voice'];
    return clip && speedableTypes.includes(clip.clipType) ? clip : null;
  }, [selectedClipId, clips]);

  // 检查是否选中了 text clip
  const hasSelectedTextClip = useMemo(() => {
    const allSelectedIds = selectedClipIds.size > 0 ? Array.from(selectedClipIds) : (selectedClipId ? [selectedClipId] : []);
    if (allSelectedIds.length === 0) return false;
    return allSelectedIds.some(id => {
      const clip = clips.find(c => c.id === id);
      return clip?.clipType === 'text';
    });
  }, [selectedClipId, selectedClipIds, clips]);

  // 添加文本 Clip
  const handleAddText = useCallback(() => {
    saveToHistory();
    const duration = 5000;
    const trackId = findOrCreateTrack('text', crypto.randomUUID(), currentTime, duration);
    const clipId = crypto.randomUUID();
    const textClip = createDefaultClip({
      id: clipId,
      trackId,
      clipType: 'text',
      start: currentTime,
      duration,
      sourceStart: 0,
      name: '新建文本',
      contentText: '请输入文字',
      textStyle: DEFAULT_TEXT_STYLE,
      color: CLIP_TYPE_COLORS.text,
      isLocal: true,
    });
    addClip(textClip);
    selectClip(clipId);
    setActiveSidebarPanel('text');
  }, [saveToHistory, findOrCreateTrack, currentTime, addClip, selectClip, setActiveSidebarPanel]);

  const closePanel = () => {
    setActiveLeftPanel(null);
  };

  const handleToolClick = (tool: LibraryTool) => {
    if (tool.disabled) return;

    // 上传素材
    if (tool.id === 'upload') {
      onUploadClick?.();
      return;
    }

    // 字幕列表 - 打开左侧面板 + 右侧字幕样式面板
    if (tool.id === 'subtitles') {
      const newPanel = activeLeftPanel === 'subtitles' ? null : 'subtitles';
      setActiveLeftPanel(newPanel);
      // 同时打开右侧字幕样式面板
      if (newPanel) {
        setActiveSidebarPanel('subtitle');
      } else {
        setActiveSidebarPanel(null);
      }
      return;
    }

    // 素材库
    if (tool.id === 'assets') {
      const newPanel = activeLeftPanel === 'assets' ? null : 'assets';
      setActiveLeftPanel(newPanel);
      return;
    }

    // B-roll 素材库
    if (tool.id === 'b-roll') {
      const newPanel = activeLeftPanel === 'b-roll' ? null : 'b-roll';
      setActiveLeftPanel(newPanel);
      return;
    }

    // AI Tools 需要选中视频 clip
    if (tool.id === 'ai-tools') {
      if (!selectedVideoClip) return;
      setActiveSidebarPanel(activeSidebarPanel === 'ai-tools' ? null : 'ai-tools');
      return;
    }

    // Image Adjust 调节
    if (tool.id === 'image-adjust') {
      setActiveSidebarPanel(activeSidebarPanel === 'image-adjust' ? null : 'image-adjust');
      return;
    }

    // Beauty 美颜美体
    if (tool.id === 'beauty') {
      setActiveSidebarPanel(activeSidebarPanel === 'beauty' ? null : 'beauty');
      return;
    }

    // Transform
    if (tool.id === 'transform') {
      setActiveSidebarPanel(activeSidebarPanel === 'transform' ? null : 'transform');
      return;
    }

    // Text - 如果已选中 text clip，打开面板；否则新建
    if (tool.id === 'text') {
      if (hasSelectedTextClip) {
        setActiveSidebarPanel(activeSidebarPanel === 'text' ? null : 'text');
      } else {
        handleAddText();
      }
      return;
    }

    // Audio
    if (tool.id === 'audio') {
      setActiveSidebarPanel(activeSidebarPanel === 'audio' ? null : 'audio');
      return;
    }

    // Speed
    if (tool.id === 'speed') {
      if (!selectedSpeedableClip) return;
      setActiveSidebarPanel(activeSidebarPanel === 'speed' ? null : 'speed');
      return;
    }
  };

  // 判断按钮是否处于激活状态
  const isToolActive = (toolId: string) => {
    if (toolId === 'subtitles') return activeLeftPanel === 'subtitles';
    if (toolId === 'assets') return activeLeftPanel === 'assets';
    if (toolId === 'ai-tools') return activeSidebarPanel === 'ai-tools';
    if (toolId === 'beauty') return activeSidebarPanel === 'beauty';
    if (toolId === 'transform') return activeSidebarPanel === 'transform';
    if (toolId === 'text') return activeSidebarPanel === 'text';
    if (toolId === 'audio') return activeSidebarPanel === 'audio';
    if (toolId === 'speed') return activeSidebarPanel === 'speed';
    return false;
  };

  // 判断按钮是否禁用
  const isToolDisabled = (tool: LibraryTool) => {
    if (tool.disabled) return true;
    if (tool.id === 'ai-tools' && !selectedVideoClip) return true;
    if (tool.id === 'speed' && !selectedSpeedableClip) return true;
    return false;
  };

  return (
    <aside className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col flex-none relative min-w-[5rem] overflow-hidden">
      {/* 工具列表 */}
      <div className="flex-1 py-3 overflow-y-auto custom-scrollbar min-h-0">
        <div className="flex flex-col items-center space-y-1">
          {LIBRARY_TOOLS.map((tool) => {
            const isDisabled = isToolDisabled(tool);
            const isActive = isToolActive(tool.id);

            return (
              <button
                key={tool.id}
                onClick={() => handleToolClick(tool)}
                disabled={isDisabled}
                className={`
                  w-16 py-2.5 flex flex-col items-center justify-center space-y-1 rounded-lg transition-all
                  ${isActive
                    ? 'bg-gray-100 text-gray-700'
                    : isDisabled
                      ? 'text-gray-300 cursor-not-allowed opacity-50'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }
                `}
                title={tool.description}
              >
                {tool.icon}
                <span className="text-[9px] font-medium tracking-tight">{tool.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
