'use client';

import { useCallback, useMemo } from 'react';
import {
  Sparkles,
  Palette,
  LayoutTemplate,
  Subtitles,
  Upload,
  Film,
  ArrowRightLeft,
  Type,
  Sticker,
  Music,
  ImagePlus,
  Move,
  Gauge,
  X,
  Smile,
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { TransformPanel } from './TransformPanel';
import { TextStylePanel } from './TextStylePanel';
import { AudioPanel } from './AudioPanel';
import { AIToolsPanel } from './AIToolsPanel';
import { SpeedPanel } from './SpeedPanel';
import { BeautyPanel } from './BeautyPanel';
import { CLIP_TYPE_COLORS, createDefaultClip } from '../types/clip';
import { DEFAULT_TEXT_STYLE } from '../types/text';

interface Tool {
  id: string;
  name: string;
  icon: React.ReactNode;
  description?: string;
  disabled?: boolean;
}

const TOOLS: Tool[] = [
  { id: 'ai-tools', name: 'AI tools', icon: <Sparkles size={22} />, description: '智能剪辑助手' },
  { id: 'beauty', name: 'Beauty', icon: <Smile size={22} />, description: '美颜美体' },
  { id: 'transform', name: 'Transform', icon: <Move size={22} />, description: '变换与动画（支持关键帧）' },
  { id: 'text', name: 'Text', icon: <Type size={22} />, description: '添加文字' },
  { id: 'subtitles', name: 'Subtitles', icon: <Subtitles size={22} />, description: '编辑字幕样式' },
  { id: 'audio', name: 'Audio', icon: <Music size={22} />, description: '音频调节（支持关键帧）' },
  { id: 'speed', name: 'Speed', icon: <Gauge size={22} />, description: '视频变速' },
  { id: 'brand-kit', name: 'Brand kit', icon: <Palette size={22} />, description: '品牌素材库', disabled: true },
  { id: 'template', name: 'Template', icon: <LayoutTemplate size={22} />, description: '模板库', disabled: true },
  { id: 'upload', name: 'Upload', icon: <Upload size={22} />, description: '上传素材' },
  { id: 'b-roll', name: 'B-roll', icon: <Film size={22} />, description: 'B-roll 素材', disabled: true },
  { id: 'transition', name: 'Transition', icon: <ArrowRightLeft size={22} />, description: '转场效果', disabled: true },
  { id: 'sticker', name: 'Sticker', icon: <Sticker size={22} />, description: '贴纸表情', disabled: true },
  { id: 'image', name: 'Image', icon: <ImagePlus size={22} />, description: '图片素材', disabled: true },
];

interface ToolsSidebarProps {
  onToolClick?: (toolId: string) => void;
  onUploadClick?: () => void;
}

export function ToolsSidebar({ onToolClick, onUploadClick }: ToolsSidebarProps) {
  const activeSidebarPanel = useEditorStore((s) => s.activeSidebarPanel);
  const setActiveSidebarPanel = useEditorStore((s) => s.setActiveSidebarPanel);
  const addClip = useEditorStore((s) => s.addClip);
  const findOrCreateTrack = useEditorStore((s) => s.findOrCreateTrack);
  const currentTime = useEditorStore((s) => s.currentTime);
  const selectClip = useEditorStore((s) => s.selectClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.clips);

  // 检查是否选中了视频 clip（单选）
  const selectedVideoClip = useMemo(() => {
    if (!selectedClipId) return null;
    const clip = clips.find(c => c.id === selectedClipId);
    return clip?.clipType === 'video' ? clip : null;
  }, [selectedClipId, clips]);

  // 获取所有选中的视频 clips（多选支持）
  const selectedVideoClips = useMemo(() => {
    const allSelectedIds = selectedClipIds.size > 0 ? Array.from(selectedClipIds) : (selectedClipId ? [selectedClipId] : []);
    return allSelectedIds
      .map(id => clips.find(c => c.id === id))
      .filter(c => c && c.clipType === 'video') as typeof clips;
  }, [selectedClipId, selectedClipIds, clips]);

  // 检查是否选中了可变速的 clip（video、audio、voice）
  const selectedSpeedableClip = useMemo(() => {
    if (!selectedClipId) return null;
    const clip = clips.find(c => c.id === selectedClipId);
    const speedableTypes = ['video', 'audio', 'voice'];
    return clip && speedableTypes.includes(clip.clipType) ? clip : null;
  }, [selectedClipId, clips]);

  // 检查是否选中了 subtitle clip（仅字幕）
  const hasSelectedSubtitleClip = useMemo(() => {
    const allSelectedIds = selectedClipIds.size > 0 ? Array.from(selectedClipIds) : (selectedClipId ? [selectedClipId] : []);
    if (allSelectedIds.length === 0) return false;

    return allSelectedIds.some(id => {
      const clip = clips.find(c => c.id === id);
      return clip?.clipType === 'subtitle';
    });
  }, [selectedClipId, selectedClipIds, clips]);

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

    // 默认文本持续 5 秒
    const duration = 5000;

    // 找到或创建文本轨道
    const trackId = findOrCreateTrack('text', crypto.randomUUID(), currentTime, duration);

    // 创建文本 Clip
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
    // 自动打开字幕编辑面板
    setActiveSidebarPanel('text');
  }, [saveToHistory, findOrCreateTrack, currentTime, addClip, selectClip, setActiveSidebarPanel]);

  // 关闭面板
  const closePanel = useCallback(() => {
    setActiveSidebarPanel(null);
  }, [setActiveSidebarPanel]);

  const handleToolClick = (tool: Tool) => {
    if (tool.disabled) return;

    // AI Tools 需要选中视频 clip 才能使用
    if (tool.id === 'ai-tools') {
      if (!selectedVideoClip) return; // 没选中视频则不响应
      setActiveSidebarPanel(activeSidebarPanel === 'ai-tools' ? null : 'ai-tools');
      return;
    }

    if (tool.id === 'upload') {
      onUploadClick?.();
      return;
    }

    // Beauty 美颜美体
    if (tool.id === 'beauty') {
      setActiveSidebarPanel(activeSidebarPanel === 'beauty' ? null : 'beauty');
      return;
    }

    if (tool.id === 'transform') {
      setActiveSidebarPanel(activeSidebarPanel === 'transform' ? null : 'transform');
      return;
    }

    if (tool.id === 'text') {
      // Text 按钮：如果已选中 text clip，打开面板；否则新建文本
      if (hasSelectedTextClip) {
        setActiveSidebarPanel(activeSidebarPanel === 'text' ? null : 'text');
      } else {
        handleAddText();
      }
      return;
    }

    if (tool.id === 'subtitles') {
      // Subtitles 按钮：打开字幕样式面板，编辑选中的 subtitle clip
      if (!hasSelectedSubtitleClip) return;
      setActiveSidebarPanel(activeSidebarPanel === 'subtitle' ? null : 'subtitle');
      return;
    }

    if (tool.id === 'audio') {
      setActiveSidebarPanel(activeSidebarPanel === 'audio' ? null : 'audio');
      return;
    }

    if (tool.id === 'speed') {
      if (!selectedSpeedableClip) return; // 速度面板需要选中视频/音频
      setActiveSidebarPanel(activeSidebarPanel === 'speed' ? null : 'speed');
      return;
    }

    // 关闭面板
    setActiveSidebarPanel(null);
    onToolClick?.(tool.id);
  };

  return (
    <aside className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col flex-none relative min-w-[5rem]">
      {/* 变换与动画面板（支持关键帧） */}
      {activeSidebarPanel === 'transform' && (
        <TransformPanel onClose={closePanel} />
      )}

      {/* 文本属性面板 */}
      {activeSidebarPanel === 'text' && (
        <TextStylePanel
          onClose={closePanel}
          onAddText={handleAddText}
          clipTypeFilter="text"
        />
      )}

      {/* 字幕属性面板 */}
      {activeSidebarPanel === 'subtitle' && (
        <TextStylePanel
          onClose={closePanel}
          clipTypeFilter="subtitle"
        />
      )}

      {/* 音频属性面板 */}
      {activeSidebarPanel === 'audio' && (
        <AudioPanel onClose={closePanel} />
      )}

      {/* 变速面板 */}
      {activeSidebarPanel === 'speed' && selectedSpeedableClip && (
        <SpeedPanel onClose={closePanel} />
      )}

      {/* AI 工具面板 */}
      {activeSidebarPanel === 'ai-tools' && selectedVideoClips.length > 0 && (
        <AIToolsPanel onClose={closePanel} clipIds={selectedVideoClips.map(c => c.id)} />
      )}

      {/* 美颜美体面板 */}
      {activeSidebarPanel === 'beauty' && (
        <BeautyPanel onClose={closePanel} />
      )}

      {/* 工具列表 */}
      <div className="flex-1 py-3 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col items-center space-y-1">
          {TOOLS.map((tool) => {
            // AI Tools 需要选中视频才能点击
            const isAiToolsDisabled = tool.id === 'ai-tools' && !selectedVideoClip;
            // Speed 需要选中视频/音频才能点击
            const isSpeedDisabled = tool.id === 'speed' && !selectedSpeedableClip;
            // Subtitles 需要选中 subtitle clip 才能点击
            const isSubtitlesDisabled = tool.id === 'subtitles' && !hasSelectedSubtitleClip;
            const isDisabled = tool.disabled || isAiToolsDisabled || isSpeedDisabled || isSubtitlesDisabled;

            // 根据工具类型确定提示信息
            let tooltipText = tool.description;
            if (isAiToolsDisabled) {
              tooltipText = '请先选中一个视频片段';
            } else if (isSpeedDisabled) {
              tooltipText = '请先选中一个视频或音频片段';
            } else if (isSubtitlesDisabled) {
              tooltipText = '请先选中一个字幕片段';
            }

            return (
              <button
                key={tool.id}
                onClick={() => handleToolClick(tool)}
                disabled={isDisabled}
                className={`
                  w-16 py-2.5 flex flex-col items-center justify-center space-y-1 rounded-lg transition-all
                  ${(activeSidebarPanel === tool.id || (tool.id === 'subtitles' && activeSidebarPanel === 'subtitle'))
                    ? 'bg-gray-100 text-gray-700'
                    : isDisabled
                      ? 'text-gray-300 cursor-not-allowed opacity-50'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }
                `}
                title={tooltipText}
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
