'use client';

import React, { useEffect, useState } from 'react';
import { useVisualEditorStore, useCurrentShot, useSelectedObjects } from '@/stores/visualEditorStore';
import {
  Image,
  Palette,
  Sparkles,
  Upload, 
  Grid3X3, 
  Settings,
  Trash2,
  Copy,
  MoveUp,
  MoveDown,
} from 'lucide-react';
import { ShotBackground } from '@/types/visual-editor';
import {
  fetchTemplateCandidates,
  renderTemplate,
  type TemplateCandidateItem,
  type TemplateWorkflow,
} from '@/lib/api/templates';
import { useTaskHistoryStore } from '@/stores/taskHistoryStore';
import { toast } from '@/lib/stores/toast-store';

// ==========================================
// 背景类型选项
// ==========================================

const BACKGROUND_TYPES: Array<{
  type: ShotBackground['type'];
  icon: React.ReactNode;
  label: string;
  description: string;
}> = [
  { 
    type: 'original', 
    icon: <Image size={18} />, 
    label: '原始背景',
    description: '保持原始视频背景'
  },
  { 
    type: 'color', 
    icon: <Palette size={18} />, 
    label: '纯色背景',
    description: '选择一种颜色作为背景'
  },
  { 
    type: 'image', 
    icon: <Upload size={18} />, 
    label: '图片背景',
    description: '上传图片作为背景'
  },
  { 
    type: 'prompt', 
    icon: <Sparkles size={18} />, 
    label: 'AI 生成',
    description: '使用 AI 生成背景'
  },
  { 
    type: 'template', 
    icon: <Grid3X3 size={18} />, 
    label: '模板背景',
    description: '选择预设模板背景'
  },
];

const PRESET_COLORS = [
  '#FFFFFF',
  '#F3F4F6',
  '#E5E7EB',
  '#000000',
  '#1F2937',
  '#DBEAFE',
  '#D1FAE5',
  '#FEE2E2',
];

function getTemplateTags(candidate: TemplateCandidateItem): string[] {
  const workflow = (candidate.render_spec?.workflow || {}) as TemplateWorkflow;
  const tags: string[] = [];
  for (const key of ['shot_type', 'camera_move', 'pacing'] as const) {
    const value = workflow[key];
    if (value) tags.push(String(value));
  }
  const style = workflow.style;
  if (style && typeof style === 'object') {
    const styleObj = style as Record<string, unknown>;
    if (styleObj.color) tags.push(String(styleObj.color));
    if (styleObj.light) tags.push(String(styleObj.light));
  } else if (style) {
    tags.push(String(style));
  }
  if (tags.length > 0) return tags;
  return (candidate.tags || []).map((item) => String(item));
}


function getRenderSpecSummary(candidate: TemplateCandidateItem): string {
  const spec = candidate.render_spec;
  const parts: string[] = [];
  if (spec.duration) parts.push(`${spec.duration}s`);
  if (spec.aspect_ratio) parts.push(spec.aspect_ratio);
  if (spec.endpoint) parts.push(spec.endpoint);
  return parts.join(' · ');
}

// ==========================================
// 背景面板
// ==========================================

function BackgroundPanel() {
  const currentShot = useCurrentShot();
  const { updateShotBackground, projectId } = useVisualEditorStore();
  const addOptimisticTask = useTaskHistoryStore((state) => state.addOptimisticTask);
  const [templates, setTemplates] = useState<TemplateCandidateItem[]>([]);
  const [templatePrompt, setTemplatePrompt] = useState('');
  const [isTemplateLoading, setIsTemplateLoading] = useState(false);
  const [isTemplateRendering, setIsTemplateRendering] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const loadTemplateCandidates = React.useCallback(async (prompt: string) => {
    setIsTemplateLoading(true);
    setTemplateError(null);
    try {
      const response = await fetchTemplateCandidates({
        scope: 'visual-studio',
        template_kind: 'background',
        limit: 5,
        prompt: prompt || undefined,
      });
      setTemplates(response.candidates || []);
      if (!response.candidates || response.candidates.length === 0) {
        setTemplateError('没有找到匹配模板，换个描述再试试');
      }
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : '加载候选模板失败');
    } finally {
      setIsTemplateLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplateCandidates('');
  }, [loadTemplateCandidates]);
  
  if (!currentShot) {
    return (
      <div className="p-4 text-center text-gray-400 text-sm">
        请先选择一个分镜
      </div>
    );
  }

  const background = currentShot.background;
  const selectedTemplate = templates.find((item) => item.template_id === background.templateId);

  const handleRenderFromTemplate = async () => {
    if (!selectedTemplate || isTemplateRendering) {
      return;
    }
    setIsTemplateRendering(true);
    setTemplateError(null);
    try {
      const spec = selectedTemplate.render_spec;
      const result = await renderTemplate(selectedTemplate.template_id, {
        prompt: templatePrompt || spec.prompt,
        negative_prompt: spec.negative_prompt,
        duration: spec.duration,
        model_name: spec.model_name,
        cfg_scale: spec.cfg_scale,
        mode: spec.mode,
        aspect_ratio: spec.aspect_ratio,
        images: spec.images,
        video_url: spec.video_url,
        project_id: projectId || undefined,
        clip_id: currentShot.id,
        write_clip_metadata: true,
        overrides: {
          kling_endpoint: spec.endpoint,
        },
      });

      addOptimisticTask({
        id: result.task_id,
        task_type: result.endpoint,
        status: result.status as 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled',
        progress: 0,
        status_message: '模板生成已提交：' + selectedTemplate.name,
        clip_id: currentShot.id,
        project_id: projectId || undefined,
        input_params: {
          clip_id: currentShot.id,
          template_id: selectedTemplate.template_id,
          template_name: selectedTemplate.name,
        },
      });
      toast.info(`🎨 模板生成已提交：${selectedTemplate.name}`);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : '模板渲染失败');
    } finally {
      setIsTemplateRendering(false);
    }
  };
  
  return (
    <div className="p-4 space-y-4">
      {/* 背景类型选择 */}
      <div className="space-y-2">
        <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
          背景类型
        </label>
        <div className="space-y-1">
          {BACKGROUND_TYPES.map((bg) => (
            <button
              key={bg.type}
              onClick={() => updateShotBackground(currentShot.id, { type: bg.type })}
              className={`w-full p-2.5 flex items-center gap-3 rounded-xl transition-colors text-left ${
                background.type === bg.type
                  ? 'bg-gray-100 border border-gray-300'
                  : 'hover:bg-gray-50 border border-transparent'
              }`}
            >
              <div className={`p-2 rounded-lg ${
                background.type === bg.type
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {bg.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">{bg.label}</div>
                <div className="text-xs text-gray-400 truncate">{bg.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      
      {/* 根据类型显示不同的配置 */}
      {background.type === 'color' && (
        <div className="space-y-2">
          <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            选择颜色
          </label>
          <div className="grid grid-cols-4 gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => updateShotBackground(currentShot.id, { color })}
                className={`h-10 rounded-lg border-2 transition-transform hover:scale-105 ${
                  background.color === color
                    ? 'border-gray-800'
                    : 'border-gray-200'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          {/* 自定义颜色 */}
          <div className="flex items-center gap-2 mt-2">
            <input
              type="color"
              value={background.color || '#FFFFFF'}
              onChange={(e) => updateShotBackground(currentShot.id, { color: e.target.value })}
              className="w-10 h-10 rounded cursor-pointer bg-transparent border border-gray-200"
            />
            <span className="text-sm text-gray-500">自定义颜色</span>
          </div>
        </div>
      )}
      
      {background.type === 'image' && (
        <div className="space-y-2">
          <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            上传图片
          </label>
          {background.imageUrl ? (
            <div className="relative rounded-xl overflow-hidden border border-gray-200">
              <img 
                src={background.imageUrl} 
                alt="背景预览" 
                className="w-full h-32 object-cover"
              />
              <button
                onClick={() => updateShotBackground(currentShot.id, { imageUrl: undefined })}
                className="absolute top-2 right-2 p-1.5 bg-white/90 rounded-full text-gray-600 hover:text-gray-900 hover:bg-white shadow-sm"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-gray-300 transition-colors bg-gray-50">
              <Upload size={24} className="text-gray-400 mb-2" />
              <span className="text-sm text-gray-500">点击上传图片</span>
              <input type="file" accept="image/*" className="hidden" />
            </label>
          )}
        </div>
      )}
      
      {background.type === 'prompt' && (
        <div className="space-y-2">
          <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            AI 提示词
          </label>
          <textarea
            value={background.prompt || ''}
            onChange={(e) => updateShotBackground(currentShot.id, { prompt: e.target.value })}
            placeholder="描述你想要的背景，例如：现代科技感的办公室，蓝色调..."
            className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
          />
          <button className="w-full py-2.5 bg-gray-800 text-white text-sm font-bold rounded-xl hover:bg-gray-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-gray-800/20">
            <Sparkles size={16} />
            生成背景
          </button>
        </div>
      )}
      
      {background.type === 'template' && (
        <div className="space-y-3">
          <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            模板候选
          </label>

          <div className="flex gap-2">
            <input
              value={templatePrompt}
              onChange={(e) => setTemplatePrompt(e.target.value)}
              placeholder="输入风格关键词，如：科技感产品背景"
              className="h-9 flex-1 rounded-lg border border-gray-200 px-2.5 text-xs text-gray-900 outline-none focus:border-gray-400"
            />
            <button
              onClick={() => loadTemplateCandidates(templatePrompt.trim())}
              disabled={isTemplateLoading}
              className="h-9 rounded-lg bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {isTemplateLoading ? '加载中' : '拉取'}
            </button>
          </div>

          {templateError && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-xs text-red-600">
              {templateError}
            </div>
          )}

          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
            {templates.map((template) => {
              const tags = getTemplateTags(template);
              const summary = getRenderSpecSummary(template);
              return (
                <button
                  key={template.template_id}
                  onClick={() => updateShotBackground(currentShot.id, { templateId: template.template_id })}
                  className={`relative rounded-xl overflow-hidden border-2 text-left transition-all ${
                    background.templateId === template.template_id
                      ? 'border-gray-800'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="h-20 w-full bg-gray-100">
                    {template.thumbnail_url ? (
                      <img src={template.thumbnail_url} alt={template.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">无缩略图</div>
                    )}
                  </div>
                  <div className="space-y-1 bg-white p-1.5">
                    <div className="truncate text-xs font-medium text-gray-800">{template.name}</div>
                    {summary && (
                      <div className="truncate text-[10px] text-gray-500">{summary}</div>
                    )}
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, 3).map((tag) => (
                          <span key={template.template_id + '-' + tag} className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            onClick={handleRenderFromTemplate}
            disabled={!selectedTemplate || isTemplateRendering}
            className="w-full rounded-xl bg-gray-800 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isTemplateRendering ? '正在创建任务...' : '使用模板生成'}
          </button>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 属性面板
// ==========================================

function PropertiesPanel() {
  const selectedObjects = useSelectedObjects();
  
  if (selectedObjects.length === 0) {
    return (
      <div className="p-4 text-center text-gray-400 text-sm">
        选择画布上的元素以编辑属性
      </div>
    );
  }
  
  const obj = selectedObjects[0];
  
  return (
    <div className="p-4 space-y-4">
      {/* 对象操作 */}
      <div className="flex items-center gap-1">
        <button className="flex-1 py-1.5 flex items-center justify-center gap-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
          <Copy size={14} />
          复制
        </button>
        <button className="flex-1 py-1.5 flex items-center justify-center gap-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
          <Trash2 size={14} />
          删除
        </button>
      </div>
      
      {/* 图层顺序 */}
      <div className="flex items-center gap-1">
        <button className="flex-1 py-1.5 flex items-center justify-center gap-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
          <MoveUp size={14} />
          上移
        </button>
        <button className="flex-1 py-1.5 flex items-center justify-center gap-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
          <MoveDown size={14} />
          下移
        </button>
      </div>
      
      {/* 位置 */}
      <div className="space-y-2">
        <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
          位置
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-400">X</label>
            <input
              type="number"
              value={Math.round(obj.x)}
              className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-gray-300"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Y</label>
            <input
              type="number"
              value={Math.round(obj.y)}
              className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-gray-300"
            />
          </div>
        </div>
      </div>
      
      {/* 尺寸 */}
      <div className="space-y-2">
        <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
          尺寸
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-400">宽度</label>
            <input
              type="number"
              value={Math.round(obj.width || 0)}
              className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-gray-300"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">高度</label>
            <input
              type="number"
              value={Math.round(obj.height || 0)}
              className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-gray-300"
            />
          </div>
        </div>
      </div>
      
      {/* 旋转与透明度 */}
      <div className="space-y-2">
        <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
          变换
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-400">旋转</label>
            <input
              type="number"
              value={Math.round(obj.rotation || 0)}
              className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-gray-300"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">透明度</label>
            <input
              type="number"
              value={Math.round((obj.opacity || 1) * 100)}
              min={0}
              max={100}
              className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-gray-300"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 主组件
// ==========================================

type RightTab = 'background' | 'properties';

export default function RightPanel() {
  const [activeTab, setActiveTab] = React.useState<RightTab>('background');
  const selectedObjects = useSelectedObjects();
  
  // 如果有选中的对象，自动切换到属性面板
  React.useEffect(() => {
    if (selectedObjects.length > 0) {
      setActiveTab('properties');
    }
  }, [selectedObjects.length]);
  
  return (
    <div className="w-64 bg-white border-l border-gray-200 flex flex-col">
      {/* Tab 切换 */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('background')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'background'
              ? 'text-gray-900 border-b-2 border-gray-800'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          背景
        </button>
        <button
          onClick={() => setActiveTab('properties')}
          className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'properties'
              ? 'text-gray-900 border-b-2 border-gray-800'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Settings size={14} />
          属性
          {selectedObjects.length > 0 && (
            <span className="w-5 h-5 bg-gray-800 text-white rounded-full text-xs flex items-center justify-center">
              {selectedObjects.length}
            </span>
          )}
        </button>
      </div>
      
      {/* 面板内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'background' ? <BackgroundPanel /> : <PropertiesPanel />}
      </div>
    </div>
  );
}
