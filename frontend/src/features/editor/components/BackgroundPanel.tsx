'use client';

import { useState, useCallback } from 'react';
import { X, Image, Palette, Upload, Loader2, Check } from 'lucide-react';
import { toast } from '@/lib/stores/toast-store';

/**
 * 预设背景颜色列表
 */
const PRESET_COLORS = [
  { id: 'transparent', label: '透明', value: 'transparent', style: 'bg-[url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAIElEQVQoU2NkYGBgOMDAwPAfBqamprAwAAIASUR4AwcHBwwAAAAASUVORK5CYII=")]' },
  { id: 'black', label: '黑色', value: '#000000', style: 'bg-black' },
  { id: 'white', label: '白色', value: '#ffffff', style: 'bg-white border border-gray-200' },
  { id: 'gray', label: '灰色', value: '#6b7280', style: 'bg-gray-500' },
  { id: 'blue', label: '蓝色', value: '#3b82f6', style: 'bg-blue-500' },
  { id: 'green', label: '绿色', value: '#22c55e', style: 'bg-green-500' },
  { id: 'red', label: '红色', value: '#ef4444', style: 'bg-red-500' },
  { id: 'yellow', label: '黄色', value: '#eab308', style: 'bg-yellow-500' },
  { id: 'purple', label: '紫色', value: '#a855f7', style: 'bg-purple-500' },
  { id: 'pink', label: '粉色', value: '#ec4899', style: 'bg-pink-500' },
  { id: 'orange', label: '橙色', value: '#f97316', style: 'bg-orange-500' },
  { id: 'teal', label: '青色', value: '#14b8a6', style: 'bg-teal-500' },
];

/**
 * 渐变背景预设
 */
const GRADIENT_PRESETS = [
  { id: 'sunset', label: '日落', value: 'linear-gradient(135deg, #f97316 0%, #ec4899 100%)', style: 'bg-gradient-to-br from-orange-500 to-pink-500' },
  { id: 'ocean', label: '海洋', value: 'linear-gradient(135deg, #3b82f6 0%, #14b8a6 100%)', style: 'bg-gradient-to-br from-blue-500 to-teal-500' },
  { id: 'forest', label: '森林', value: 'linear-gradient(135deg, #22c55e 0%, #065f46 100%)', style: 'bg-gradient-to-br from-green-500 to-green-900' },
  { id: 'night', label: '夜晚', value: 'linear-gradient(135deg, #1e3a8a 0%, #581c87 100%)', style: 'bg-gradient-to-br from-blue-900 to-purple-900' },
  { id: 'rose', label: '玫瑰', value: 'linear-gradient(135deg, #f43f5e 0%, #d946ef 100%)', style: 'bg-gradient-to-br from-rose-500 to-fuchsia-500' },
  { id: 'gold', label: '金色', value: 'linear-gradient(135deg, #fbbf24 0%, #b45309 100%)', style: 'bg-gradient-to-br from-amber-400 to-amber-700' },
];

interface BackgroundPanelProps {
  onClose: () => void;
}

export function BackgroundPanel({ onClose }: BackgroundPanelProps) {
  // 背景状态（暂时使用本地状态，后续可接入项目 metadata 持久化）
  const [currentBackground, setCurrentBackground] = useState<{
    type: 'color' | 'gradient' | 'image';
    value: string;
  }>({ type: 'color', value: '#000000' });
  
  const [activeTab, setActiveTab] = useState<'color' | 'gradient' | 'image'>('color');
  const [customColor, setCustomColor] = useState(currentBackground.type === 'color' ? currentBackground.value : '#000000');
  const [isUploading, setIsUploading] = useState(false);

  // 更新背景
  const updateBackground = useCallback((type: 'color' | 'gradient' | 'image', value: string) => {
    setCurrentBackground({ type, value });
    // TODO: 将背景设置保存到项目 metadata 持久化
    toast.info(`背景已设置为 ${type === 'color' ? '纯色' : type === 'gradient' ? '渐变' : '图片'}`);
  }, []);

  const handleColorSelect = useCallback((color: typeof PRESET_COLORS[0]) => {
    updateBackground('color', color.value);
  }, [updateBackground]);

  const handleGradientSelect = useCallback((gradient: typeof GRADIENT_PRESETS[0]) => {
    updateBackground('gradient', gradient.value);
  }, [updateBackground]);

  const handleCustomColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCustomColor(value);
    updateBackground('color', value);
  }, [updateBackground]);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }

    setIsUploading(true);
    try {
      // 将图片转为 base64 或上传到服务器
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        updateBackground('image', dataUrl);
        setIsUploading(false);
      };
      reader.onerror = () => {
        toast.error('图片加载失败');
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast.error('上传失败，请重试');
      setIsUploading(false);
    }
  }, [updateBackground]);

  return (
    <div className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">背景设置</h3>
        <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 rounded transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-gray-100 flex-shrink-0">
        <button
          onClick={() => setActiveTab('color')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'color'
              ? 'text-gray-900 border-b-2 border-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Palette size={14} />
          <span>纯色</span>
        </button>
        <button
          onClick={() => setActiveTab('gradient')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'gradient'
              ? 'text-gray-900 border-b-2 border-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="w-3.5 h-3.5 rounded bg-gradient-to-r from-blue-500 to-purple-500" />
          <span>渐变</span>
        </button>
        <button
          onClick={() => setActiveTab('image')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'image'
              ? 'text-gray-900 border-b-2 border-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Image size={14} />
          <span>图片</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {/* 纯色选择 */}
        {activeTab === 'color' && (
          <div className="space-y-4">
            {/* 预设颜色 */}
            <div>
              <h4 className="text-xs font-medium text-gray-600 mb-3">预设颜色</h4>
              <div className="grid grid-cols-4 gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.id}
                    onClick={() => handleColorSelect(color)}
                    className={`relative w-full aspect-square rounded-lg ${color.style} transition-all hover:scale-105 ${
                      currentBackground.value === color.value ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                    }`}
                    title={color.label}
                  >
                    {currentBackground.value === color.value && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Check size={16} className={color.id === 'white' ? 'text-gray-800' : 'text-white'} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* 自定义颜色 */}
            <div>
              <h4 className="text-xs font-medium text-gray-600 mb-3">自定义颜色</h4>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={customColor}
                  onChange={handleCustomColorChange}
                  className="w-10 h-10 rounded-lg cursor-pointer border border-gray-200"
                />
                <input
                  type="text"
                  value={customColor}
                  onChange={handleCustomColorChange}
                  className="flex-1 px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="#000000"
                />
              </div>
            </div>
          </div>
        )}

        {/* 渐变选择 */}
        {activeTab === 'gradient' && (
          <div>
            <h4 className="text-xs font-medium text-gray-600 mb-3">渐变预设</h4>
            <div className="grid grid-cols-2 gap-3">
              {GRADIENT_PRESETS.map((gradient) => (
                <button
                  key={gradient.id}
                  onClick={() => handleGradientSelect(gradient)}
                  className={`relative h-20 rounded-lg ${gradient.style} transition-all hover:scale-[1.02] ${
                    currentBackground.value === gradient.value ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                  }`}
                >
                  <span className="absolute bottom-2 left-2 text-[10px] text-white font-medium drop-shadow">
                    {gradient.label}
                  </span>
                  {currentBackground.value === gradient.value && (
                    <div className="absolute top-2 right-2">
                      <Check size={14} className="text-white drop-shadow" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 图片上传 */}
        {activeTab === 'image' && (
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-medium text-gray-600 mb-3">上传背景图片</h4>
              <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 hover:bg-gray-50 transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={isUploading}
                />
                {isUploading ? (
                  <>
                    <Loader2 size={24} className="text-gray-400 animate-spin mb-2" />
                    <span className="text-xs text-gray-500">上传中...</span>
                  </>
                ) : (
                  <>
                    <Upload size={24} className="text-gray-400 mb-2" />
                    <span className="text-xs text-gray-500">点击上传图片</span>
                    <span className="text-[10px] text-gray-400 mt-1">支持 JPG、PNG、WebP</span>
                  </>
                )}
              </label>
            </div>

            {/* 当前背景图预览 */}
            {currentBackground.type === 'image' && currentBackground.value && (
              <div>
                <h4 className="text-xs font-medium text-gray-600 mb-3">当前背景</h4>
                <div
                  className="h-24 rounded-lg bg-cover bg-center border border-gray-200"
                  style={{ backgroundImage: `url(${currentBackground.value})` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer 提示 */}
      <div className="p-4 border-t border-gray-100 flex-shrink-0">
        <p className="text-[10px] text-gray-500 text-center">
          背景将应用于画布区域，并在导出时作为视频底色
        </p>
      </div>
    </div>
  );
}
