'use client';

import { useMemo } from 'react';
import { useEditorStore } from '../store/editor-store';
import { TransformPanel } from './TransformPanel';
import { TextStylePanel } from './TextStylePanel';
import { AudioPanel } from './AudioPanel';
import { AIToolsPanel } from './AIToolsPanel';
import { SpeedPanel } from './SpeedPanel';
import { ImageAdjustPanel } from './ImageAdjustPanel';
import { BeautyPanel } from './BeautyPanel';
import { BackgroundPanel } from './BackgroundPanel';

export function PropertyPanels() {
  const activeSidebarPanel = useEditorStore((s) => s.activeSidebarPanel);
  const setActiveSidebarPanel = useEditorStore((s) => s.setActiveSidebarPanel);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const clips = useEditorStore((s) => s.clips);

  // 检查是否选中了可变速的 clip
  const selectedSpeedableClip = useMemo(() => {
    if (!selectedClipId) return null;
    const clip = clips.find(c => c.id === selectedClipId);
    const speedableTypes = ['video', 'audio', 'voice'];
    return clip && speedableTypes.includes(clip.clipType) ? clip : null;
  }, [selectedClipId, clips]);

  // 获取所有选中的视频 clips
  const selectedVideoClips = useMemo(() => {
    const allSelectedIds = selectedClipIds.size > 0 ? Array.from(selectedClipIds) : (selectedClipId ? [selectedClipId] : []);
    return allSelectedIds
      .map(id => clips.find(c => c.id === id))
      .filter(c => c && c.clipType === 'video') as typeof clips;
  }, [selectedClipId, selectedClipIds, clips]);

  const closePanel = () => {
    setActiveSidebarPanel(null);
  };

  // 如果没有激活的面板，不渲染任何内容
  if (!activeSidebarPanel) return null;

  return (
    <div className="relative w-full h-full">
      {/* 变换与动画面板 */}
      {activeSidebarPanel === 'transform' && (
        <TransformPanel onClose={closePanel} />
      )}

      {/* 文本属性面板 */}
      {activeSidebarPanel === 'text' && (
        <TextStylePanel onClose={closePanel} clipTypeFilter="text" />
      )}

      {/* 字幕属性面板 */}
      {activeSidebarPanel === 'subtitle' && (
        <TextStylePanel onClose={closePanel} clipTypeFilter="subtitle" />
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

      {/* 图片调节面板 */}
      {activeSidebarPanel === 'image-adjust' && (
        <ImageAdjustPanel onClose={closePanel} />
      )}

      {/* 美颜美体面板 */}
      {activeSidebarPanel === 'beauty' && (
        <BeautyPanel onClose={closePanel} />
      )}

      {/* 背景设置面板 */}
      {activeSidebarPanel === 'background' && (
        <BackgroundPanel onClose={closePanel} />
      )}
    </div>
  );
}
