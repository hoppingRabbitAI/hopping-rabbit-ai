'use client';

import React from 'react';
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

const TEMPLATE_BACKGROUNDS = [
  { id: 'office', name: '现代办公室', preview: '/templates/office.jpg' },
  { id: 'studio', name: '专业演播室', preview: '/templates/studio.jpg' },
  { id: 'nature', name: '自然风景', preview: '/templates/nature.jpg' },
  { id: 'abstract', name: '抽象纹理', preview: '/templates/abstract.jpg' },
];

// ==========================================
// 背景面板
// ==========================================

function BackgroundPanel() {
  const currentShot = useCurrentShot();
  const { updateShotBackground } = useVisualEditorStore();
  
  if (!currentShot) {
    return (
      <div className="p-4 text-center text-gray-400 text-sm">
        请先选择一个分镜
      </div>
    );
  }
  
  const background = currentShot.background;
  
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
        <div className="space-y-2">
          <label className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            选择模板
          </label>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATE_BACKGROUNDS.map((template) => (
              <button
                key={template.id}
                onClick={() => updateShotBackground(currentShot.id, { templateId: template.id })}
                className={`relative h-20 rounded-xl overflow-hidden border-2 transition-all ${
                  background.templateId === template.id
                    ? 'border-gray-800'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                  {template.name}
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-white/90 text-xs text-gray-700 text-center font-medium">
                  {template.name}
                </div>
              </button>
            ))}
          </div>
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
