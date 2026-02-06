/**
 * VisualAgentPanel - 智能视觉编排面板
 * 
 * 用于一键生成知识类视频的视觉效果
 * 对应设计文档: docs/REMOTION_AGENT_SPEC.md
 */
'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { 
  X, 
  Wand2, 
  Layout, 
  Layers, 
  Grid3X3, 
  List, 
  GitBranch, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  RefreshCw,
  Settings2,
  ChevronRight,
  Play,
  Download
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import type { VisualConfig, CanvasType, OverlayType } from '@/remotion/types/visual';

// 调试开关
const DEBUG_ENABLED = true;
const debugLog = (...args: unknown[]) => { 
  if (DEBUG_ENABLED) console.log('[VisualAgentPanel]', ...args); 
};

// API 基础路径
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface VisualAgentPanelProps {
  onClose: () => void;
}

// 模板选项
const TEMPLATE_OPTIONS = [
  { 
    id: 'whiteboard', 
    name: '白板讲解', 
    desc: '适合列表、流程、概念展示',
    icon: Layout 
  },
  { 
    id: 'talking-head', 
    name: '口播主导', 
    desc: '视频为主，关键词辅助',
    icon: Grid3X3 
  },
] as const;

// Canvas 类型映射
const CANVAS_TYPE_LABELS: Record<CanvasType, { name: string; IconComponent: typeof List }> = {
  'point-list': { name: '要点列表', IconComponent: List },
  'process-flow': { name: '流程图', IconComponent: GitBranch },
  'comparison-table': { name: '对比表格', IconComponent: Grid3X3 },
  'concept-card': { name: '概念卡片', IconComponent: Layout },
};

// Overlay 类型映射
const OVERLAY_TYPE_LABELS: Record<OverlayType, string> = {
  'chapter-title': '章节标题',
  'keyword-card': '关键词卡片',
  'data-number': '数据数字',
  'quote-block': '引用块',
  'highlight-box': '强调框',
  'progress-indicator': '进度指示',
  'definition-card': '定义卡片',
  'question-hook': '问题钩子',
};

// 生成状态
type GenerationStatus = 'idle' | 'analyzing' | 'generating' | 'success' | 'error';

export function VisualAgentPanel({ onClose }: VisualAgentPanelProps) {
  // Editor state
  const clips = useEditorStore((s) => s.clips);
  const sessionId = useEditorStore((s) => s.projectId);  // 使用 projectId 作为 sessionId
  const storedVisualConfig = useEditorStore((s) => s.visualConfig);
  const setVisualConfig = useEditorStore((s) => s.setVisualConfig);
  const visualConfigApplied = useEditorStore((s) => s.visualConfigApplied);
  const setVisualConfigApplied = useEditorStore((s) => s.setVisualConfigApplied);
  
  // Local state
  const [selectedTemplate, setSelectedTemplate] = useState<'whiteboard' | 'talking-head'>('whiteboard');
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [localConfig, setLocalConfig] = useState<VisualConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'preview'>('config');
  const [isApplying, setIsApplying] = useState(false);

  // 同步 store 中的配置到本地状态
  useEffect(() => {
    if (storedVisualConfig) {
      setLocalConfig(storedVisualConfig);
      setStatus('success');
      setActiveTab('preview');
    }
  }, [storedVisualConfig]);

  // 使用本地配置或 store 配置
  const visualConfig = localConfig || storedVisualConfig;

  // 获取视频片段的字幕内容
  const transcriptContent = useMemo(() => {
    const subtitleClips = clips.filter(c => c.clipType === 'subtitle');
    return subtitleClips
      .map(c => (c as any).subtitleText || (c as any).contentText || '')
      .filter(Boolean)
      .join('\n');
  }, [clips]);

  // 获取总时长（毫秒）
  const totalDurationMs = useMemo(() => {
    const videoClips = clips.filter(c => c.clipType === 'video');
    if (videoClips.length === 0) return 60000;
    return Math.max(...videoClips.map(c => c.start + c.duration));
  }, [clips]);

  // 一键生成视觉配置
  const handleGenerate = useCallback(async () => {
    if (!transcriptContent.trim()) {
      setErrorMessage('未找到字幕内容，请先生成字幕');
      setStatus('error');
      return;
    }

    setStatus('analyzing');
    setErrorMessage('');
    debugLog('开始生成视觉配置...', { template: selectedTemplate, sessionId });

    try {
      // 尝试调用后端 API
      if (sessionId && API_BASE) {
        try {
          const response = await fetch(`${API_BASE}/workspace/sessions/${sessionId}/visual-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transcript: transcriptContent,
              template: selectedTemplate,
              pip_position: selectedTemplate === 'whiteboard' ? 'bottom-right' : 'bottom-center',
            }),
          });

          if (response.ok) {
            const data = await response.json();
            debugLog('后端 API 返回:', data);
            
            setLocalConfig(data.config);
            setVisualConfig(data.config);
            setStatus('success');
            setActiveTab('preview');
            return;
          }
          debugLog('后端 API 失败，使用本地生成:', response.status);
        } catch (apiError) {
          debugLog('后端 API 不可用，使用本地生成:', apiError);
        }
      }

      // 本地生成模拟配置
      setStatus('generating');
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const mockConfig: VisualConfig = {
        version: '1.0',
        template: selectedTemplate,
        durationMs: totalDurationMs,
        fps: 30,
        background: {
          type: 'gradient',
          colors: selectedTemplate === 'whiteboard' 
            ? ['#f8fafc', '#e2e8f0'] 
            : ['#1a1a2e', '#16213e'],
          direction: 135,
        },
        canvas: generateMockCanvas(transcriptContent, selectedTemplate),
        overlays: generateMockOverlays(transcriptContent, selectedTemplate),
        pip: selectedTemplate === 'whiteboard' 
          ? { position: 'bottom-right', size: { width: 320, height: 240 } }
          : { position: 'bottom-center', size: { width: 480, height: 360 } },
      };
      
      setLocalConfig(mockConfig);
      setVisualConfig(mockConfig);
      setStatus('success');
      setActiveTab('preview');
      debugLog('本地视觉配置生成成功:', mockConfig);
    } catch (err) {
      console.error('生成视觉配置失败:', err);
      setErrorMessage(err instanceof Error ? err.message : '生成失败');
      setStatus('error');
    }
  }, [transcriptContent, selectedTemplate, sessionId, totalDurationMs, setVisualConfig]);

  // 应用视觉配置
  const handleApply = useCallback(async () => {
    if (!visualConfig) return;
    
    setIsApplying(true);
    debugLog('应用视觉配置到时间线...', visualConfig);

    try {
      // 标记配置已应用
      setVisualConfigApplied(true);
      
      // TODO: 将视觉配置转换为 Remotion 可渲染的格式
      // 当前仅保存配置，实际渲染在导出时处理
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      debugLog('视觉配置已应用');
      onClose();
    } catch (err) {
      console.error('应用视觉配置失败:', err);
      setErrorMessage(err instanceof Error ? err.message : '应用失败');
    } finally {
      setIsApplying(false);
    }
  }, [visualConfig, setVisualConfigApplied, onClose]);

  // 重置状态
  const handleReset = useCallback(() => {
    setLocalConfig(null);
    setVisualConfig(null);
    setVisualConfigApplied(false);
    setStatus('idle');
    setErrorMessage('');
    setActiveTab('config');
  }, [setVisualConfig, setVisualConfigApplied]);

  // 统计视觉配置
  const configStats = useMemo(() => {
    if (!visualConfig) return null;
    const canvasTypes = visualConfig.canvas?.map(c => c.type) || [];
    const overlayTypes = visualConfig.overlays?.map(o => o.type) || [];
    return {
      canvasCount: visualConfig.canvas?.length || 0,
      overlayCount: visualConfig.overlays?.length || 0,
      canvasTypes: Array.from(new Set(canvasTypes)),
      overlayTypes: Array.from(new Set(overlayTypes)),
    };
  }, [visualConfig]);

  return (
    <div className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-600" />
          <span className="text-sm font-medium text-gray-900">智能视觉编排</span>
          <span className="px-1.5 py-0.5 text-[10px] font-medium text-purple-600 bg-purple-50 rounded">
            Beta
          </span>
          {visualConfigApplied && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium text-green-600 bg-green-50 rounded">
              已应用
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        <button
          onClick={() => setActiveTab('config')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'config'
              ? 'text-gray-900 border-b-2 border-gray-900'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Settings2 size={14} />
            配置
          </div>
        </button>
        <button
          onClick={() => visualConfig && setActiveTab('preview')}
          disabled={!visualConfig}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'preview'
              ? 'text-gray-900 border-b-2 border-gray-900'
              : visualConfig
                ? 'text-gray-400 hover:text-gray-600'
                : 'text-gray-300 cursor-not-allowed'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Layers size={14} />
            预览
            {configStats && (
              <span className="text-[10px] text-purple-500">
                ({configStats.canvasCount + configStats.overlayCount})
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {activeTab === 'config' ? (
          <div className="p-4 space-y-5">
            {/* 模板选择 */}
            <div>
              <h3 className="text-xs font-medium text-gray-500 mb-3">选择风格模板</h3>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATE_OPTIONS.map((tpl) => {
                  const Icon = tpl.icon;
                  const isSelected = selectedTemplate === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => setSelectedTemplate(tpl.id)}
                      disabled={status === 'analyzing' || status === 'generating'}
                      className={`
                        p-3 rounded-lg border transition-all text-left
                        ${isSelected 
                          ? 'border-purple-500 bg-purple-50' 
                          : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                        }
                        disabled:opacity-50 disabled:cursor-not-allowed
                      `}
                    >
                      <Icon size={20} className={`mb-1.5 ${isSelected ? 'text-purple-600' : 'text-gray-400'}`} />
                      <div className={`text-sm font-medium ${isSelected ? 'text-purple-700' : 'text-gray-700'}`}>
                        {tpl.name}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{tpl.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 内容预览 */}
            <div>
              <h3 className="text-xs font-medium text-gray-500 mb-2">字幕内容</h3>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                {transcriptContent ? (
                  <p className="text-xs text-gray-600 line-clamp-4">
                    {transcriptContent.slice(0, 200)}
                    {transcriptContent.length > 200 && '...'}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    未检测到字幕内容，请先生成字幕
                  </p>
                )}
              </div>
            </div>

            {/* 错误提示 */}
            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} className="text-red-500" />
                  <p className="text-xs text-red-600">{errorMessage}</p>
                </div>
              </div>
            )}

            {/* 成功提示 */}
            {status === 'success' && configStats && (
              <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={14} className="text-green-500" />
                  <span className="text-xs font-medium text-green-700">视觉配置生成成功</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500">
                  <div>Canvas: {configStats.canvasCount} 个</div>
                  <div>Overlay: {configStats.overlayCount} 个</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Preview Tab */
          <div className="p-4 space-y-4">
            {visualConfig ? (
              <>
                {/* Canvas 列表 */}
                <div>
                  <h3 className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5">
                    <Layout size={12} />
                    Canvas 画布 ({visualConfig.canvas?.length || 0})
                  </h3>
                  <div className="space-y-2">
                    {visualConfig.canvas?.map((canvas, idx) => {
                      const typeInfo = CANVAS_TYPE_LABELS[canvas.type];
                      const IconComponent = typeInfo?.IconComponent || List;
                      return (
                        <div 
                          key={`canvas-${idx}`}
                          className="p-3 rounded-lg bg-gray-50 border border-gray-200"
                        >
                          <div className="flex items-center gap-2">
                            <IconComponent size={14} className="text-purple-500" />
                            <span className="text-sm font-medium text-gray-700">
                              {typeInfo?.name || canvas.type}
                            </span>
                            <span className="text-[10px] text-gray-400 ml-auto">
                              {Math.round(canvas.startMs / 1000)}s - {Math.round(canvas.endMs / 1000)}s
                            </span>
                          </div>
                          {canvas.pointList?.title && (
                            <p className="text-[11px] text-gray-500 mt-1.5 truncate">
                              {canvas.pointList.title}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    {(!visualConfig.canvas || visualConfig.canvas.length === 0) && (
                      <p className="text-xs text-gray-400 text-center py-4">
                        无 Canvas 画布
                      </p>
                    )}
                  </div>
                </div>

                {/* Overlay 列表 */}
                <div>
                  <h3 className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5">
                    <Layers size={12} />
                    Overlay 叠加层 ({visualConfig.overlays?.length || 0})
                  </h3>
                  <div className="space-y-2">
                    {visualConfig.overlays?.map((overlay, idx) => (
                      <div 
                        key={`overlay-${idx}`}
                        className="p-3 rounded-lg bg-gray-50 border border-gray-200"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700">
                            {OVERLAY_TYPE_LABELS[overlay.type] || overlay.type}
                          </span>
                          <span className="text-[10px] text-gray-400 ml-auto">
                            {Math.round(overlay.startMs / 1000)}s - {Math.round(overlay.endMs / 1000)}s
                          </span>
                        </div>
                        {overlay.keywordCard?.text && (
                          <p className="text-[11px] text-gray-500 mt-1.5 truncate">
                            {overlay.keywordCard.text}
                          </p>
                        )}
                      </div>
                    ))}
                    {(!visualConfig.overlays || visualConfig.overlays.length === 0) && (
                      <p className="text-xs text-gray-400 text-center py-4">
                        无 Overlay 叠加层
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                <Layers size={32} className="mb-3 opacity-30" />
                <p className="text-xs">请先生成视觉配置</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Buttons */}
      <div className="px-4 py-3 border-t border-gray-100 space-y-2">
        {activeTab === 'config' && (
          <button
            onClick={handleGenerate}
            disabled={status === 'analyzing' || status === 'generating' || !transcriptContent}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all
              ${status === 'analyzing' || status === 'generating' || !transcriptContent
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-purple-600 text-white hover:bg-purple-500'
              }`}
          >
            {status === 'idle' && (
              <>
                <Wand2 size={16} />
                一键生成视觉效果
              </>
            )}
            {status === 'analyzing' && (
              <>
                <Loader2 size={16} className="animate-spin" />
                分析内容结构...
              </>
            )}
            {status === 'generating' && (
              <>
                <Loader2 size={16} className="animate-spin" />
                生成视觉配置...
              </>
            )}
            {status === 'success' && (
              <>
                <CheckCircle2 size={16} />
                查看预览
                <ChevronRight size={14} />
              </>
            )}
            {status === 'error' && (
              <>
                <RefreshCw size={16} />
                重新生成
              </>
            )}
          </button>
        )}

        {activeTab === 'preview' && visualConfig && (
          <>
            <button
              onClick={handleApply}
              disabled={isApplying}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all
                ${isApplying
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : visualConfigApplied
                    ? 'bg-green-600 text-white hover:bg-green-500'
                    : 'bg-purple-600 text-white hover:bg-purple-500'
                }`}
            >
              {isApplying ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  应用中...
                </>
              ) : visualConfigApplied ? (
                <>
                  <CheckCircle2 size={16} />
                  已应用到项目
                </>
              ) : (
                <>
                  <Play size={16} />
                  应用视觉效果
                </>
              )}
            </button>
            <button
              onClick={handleReset}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
            >
              <RefreshCw size={14} />
              重新配置
            </button>
          </>
        )}

        <p className="text-[10px] text-gray-400 text-center">
          基于 AI 智能分析内容结构，自动生成知识类视频视觉效果
        </p>
      </div>
    </div>
  );
}

// ==================== 辅助函数：生成模拟配置 ====================

function generateMockCanvas(transcript: string, template: 'whiteboard' | 'talking-head'): VisualConfig['canvas'] {
  // 简单分析内容，生成合适的 Canvas
  const lines = transcript.split('\n').filter(l => l.trim());
  const duration = lines.length * 5000; // 假设每行 5 秒

  if (template === 'whiteboard') {
    // 白板模式：生成要点列表
    const items = lines.slice(0, 5).map((line, i) => ({
      id: `item-${i + 1}`,
      text: line.slice(0, 50),
      revealAtMs: (i + 1) * 3000,
    }));

    return [{
      type: 'point-list',
      segmentId: 'seg-main',
      startMs: 0,
      endMs: Math.min(duration, 30000),
      pointList: {
        title: '核心要点',
        items,
        style: 'numbered',
        position: 'left',
      },
    }];
  } else {
    // 口播模式：生成简单的流程图
    const steps = lines.slice(0, 4).map((line, i) => ({
      id: `step-${i + 1}`,
      text: line.slice(0, 30),
      type: (['question', 'concept', 'explanation', 'conclusion'] as const)[i % 4],
      activateAtMs: (i + 1) * 4000,
    }));

    return [{
      type: 'process-flow',
      segmentId: 'seg-main',
      startMs: 0,
      endMs: Math.min(duration, 20000),
      processFlow: {
        title: '内容结构',
        steps,
        direction: 'vertical',
        connector: 'arrow',
      },
    }];
  }
}

function generateMockOverlays(transcript: string, template: 'whiteboard' | 'talking-head'): VisualConfig['overlays'] {
  const overlays: VisualConfig['overlays'] = [];

  // 提取关键词（简单实现：找出引号内的内容或较短的句子）
  const keywords = transcript
    .match(/"([^"]+)"/g)
    ?.map(s => s.replace(/"/g, ''))
    .slice(0, 3) || [];

  // 添加关键词卡片
  keywords.forEach((keyword, i) => {
    overlays.push({
      type: 'keyword-card',
      startMs: (i + 1) * 8000,
      endMs: (i + 1) * 8000 + 4000,
      keywordCard: {
        text: keyword,
        variant: 'key',
        position: template === 'whiteboard' ? 'top-right' : 'bottom-left',
      },
    });
  });

  // 添加章节标题
  overlays.push({
    type: 'chapter-title',
    startMs: 0,
    endMs: 3000,
    chapterTitle: {
      title: '内容概述',
      number: 1,
      position: 'center',
    },
  });

  return overlays;
}
