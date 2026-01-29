'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  X,
  Eye,
  Moon,
  Sun,
  Heart,
  Ruler,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Sliders,
  Smile,
  User,
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';

// 美颜参数类型
interface BeautySettings {
  // 基础美颜
  smoothSkin: number;      // 磨皮 0-100
  whitening: number;       // 美白 0-100
  sharpness: number;       // 锐化 0-100
  
  // 祛瑕疵
  removeAcne: number;      // 祛痘 0-100
  removeDarkCircle: number; // 去黑眼圈 0-100
  removeWrinkle: number;   // 去皱纹 0-100
  
  // 微整形 - 脸型
  thinFace: number;        // 瘦脸 0-100
  smallFace: number;       // 小脸 0-100
  vFace: number;           // V脸 0-100
  chin: number;            // 下巴 -50 to 50
  forehead: number;        // 额头 -50 to 50
  cheekbone: number;       // 颧骨 0-100
  jawbone: number;         // 下颌骨 0-100
  
  // 微整形 - 眼睛
  bigEye: number;          // 大眼 0-100
  eyeDistance: number;     // 眼距 -50 to 50
  eyeAngle: number;        // 眼角 -50 to 50
  brightenEye: number;     // 亮眼 0-100
  
  // 微整形 - 鼻子
  thinNose: number;        // 瘦鼻 0-100
  noseWing: number;        // 鼻翼 0-100
  noseTip: number;         // 鼻尖 -50 to 50
  noseBridge: number;      // 山根 0-100
  
  // 微整形 - 嘴巴
  mouthSize: number;       // 嘴型 -50 to 50
  lipThickness: number;    // 嘴唇 -50 to 50
  smile: number;           // 微笑 0-100
  teethWhiten: number;     // 白牙 0-100
}

// 美体参数类型
interface BodySettings {
  // 一键美体
  autoBody: number;        // 一键美体 0-100
  
  // 身材调整
  slimBody: number;        // 瘦身 0-100
  longLeg: number;         // 长腿 0-100
  slimLeg: number;         // 瘦腿 0-100
  slimWaist: number;       // 瘦腰 0-100
  slimArm: number;         // 瘦手臂 0-100
  
  // 身形优化
  shoulder: number;        // 肩宽 -50 to 50
  hip: number;             // 美胯 0-100
  swanNeck: number;        // 天鹅颈 0-100
}

// 滤镜预设
interface FilterPreset {
  id: string;
  name: string;
  category: 'natural' | 'portrait' | 'style' | 'retro';
  thumbnail?: string;
}

const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', name: '原图', category: 'natural' },
  { id: 'natural', name: '自然', category: 'natural' },
  { id: 'fresh', name: '清透', category: 'natural' },
  { id: 'soft', name: '柔和', category: 'natural' },
  { id: 'warmwhite', name: '暖白', category: 'portrait' },
  { id: 'coldwhite', name: '冷白', category: 'portrait' },
  { id: 'pinkwhite', name: '粉白', category: 'portrait' },
  { id: 'peach', name: '蜜桃', category: 'portrait' },
  { id: 'ins', name: 'INS风', category: 'style' },
  { id: 'film', name: '胶片', category: 'style' },
  { id: 'vintage', name: '复古', category: 'retro' },
  { id: 'blackwhite', name: '黑白', category: 'retro' },
];

// 美颜预设套装
interface BeautyPreset {
  id: string;
  name: string;
  description: string;
  settings: Partial<BeautySettings>;
}

const BEAUTY_PRESETS: BeautyPreset[] = [
  {
    id: 'natural',
    name: '自然',
    description: '轻微调整，保持真实',
    settings: { smoothSkin: 30, whitening: 20, sharpness: 10 }
  },
  {
    id: 'sweet',
    name: '甜美',
    description: '柔和甜美的少女感',
    settings: { smoothSkin: 50, whitening: 40, bigEye: 20, thinFace: 15, smile: 10 }
  },
  {
    id: 'goddess',
    name: '女神',
    description: '精致立体的高级感',
    settings: { smoothSkin: 60, whitening: 50, thinFace: 25, vFace: 20, bigEye: 25, thinNose: 20 }
  },
  {
    id: 'handsome',
    name: '帅气',
    description: '清爽阳刚的男性美颜',
    settings: { smoothSkin: 25, sharpness: 30, chin: 10 }
  },
  {
    id: 'baby',
    name: '幼态',
    description: '圆润可爱的童颜效果',
    settings: { smoothSkin: 55, whitening: 45, bigEye: 35, smallFace: 20 }
  },
];

const DEFAULT_BEAUTY: BeautySettings = {
  smoothSkin: 0, whitening: 0, sharpness: 0,
  removeAcne: 0, removeDarkCircle: 0, removeWrinkle: 0,
  thinFace: 0, smallFace: 0, vFace: 0, chin: 0, forehead: 0, cheekbone: 0, jawbone: 0,
  bigEye: 0, eyeDistance: 0, eyeAngle: 0, brightenEye: 0,
  thinNose: 0, noseWing: 0, noseTip: 0, noseBridge: 0,
  mouthSize: 0, lipThickness: 0, smile: 0, teethWhiten: 0,
};

const DEFAULT_BODY: BodySettings = {
  autoBody: 0,
  slimBody: 0, longLeg: 0, slimLeg: 0, slimWaist: 0, slimArm: 0,
  shoulder: 0, hip: 0, swanNeck: 0,
};

// 滑块控件
function SliderControl({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  showValue = true,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  showValue?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-xs text-gray-500 w-16 flex-shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-600"
        style={{
          background: `linear-gradient(to right, #4B5563 0%, #4B5563 ${((value - min) / (max - min)) * 100}%, #E5E7EB ${((value - min) / (max - min)) * 100}%, #E5E7EB 100%)`
        }}
      />
      {showValue && (
        <span className="text-xs text-gray-600 w-8 text-right tabular-nums">{value}</span>
      )}
    </div>
  );
}

// 可折叠区块
function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400">{icon}</span>
          <span className="text-sm font-medium text-gray-700">{title}</span>
        </div>
        {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

// Tab 类型
type TabType = 'beauty' | 'body' | 'filter';

interface BeautyPanelProps {
  onClose: () => void;
}

/**
 * 美颜美体面板
 * 提供专业级的人像美化功能
 */
export function BeautyPanel({ onClose }: BeautyPanelProps) {
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const updateClip = useEditorStore((s) => s.updateClip);
  const saveToHistory = useEditorStore((s) => s.saveToHistory);

  // 当前 Tab
  const [activeTab, setActiveTab] = useState<TabType>('beauty');

  // 美颜设置
  const [beautySettings, setBeautySettings] = useState<BeautySettings>(DEFAULT_BEAUTY);
  const [bodySettings, setBodySettings] = useState<BodySettings>(DEFAULT_BODY);
  const [selectedFilter, setSelectedFilter] = useState<string>('none');
  const [filterIntensity, setFilterIntensity] = useState(100);

  // 获取选中的视频 clip
  const selectedVideoClip = useMemo(() => {
    if (!selectedClipId) return null;
    const clip = clips.find(c => c.id === selectedClipId);
    return clip?.clipType === 'video' ? clip : null;
  }, [selectedClipId, clips]);

  // 从 clip.effectParams 加载初始设置
  useEffect(() => {
    if (!selectedVideoClip) return;
    
    const effectParams = selectedVideoClip.effectParams as Record<string, unknown> | undefined;
    if (effectParams?.beauty) {
      setBeautySettings(prev => ({ ...prev, ...(effectParams.beauty as BeautySettings) }));
    }
    if (effectParams?.body) {
      setBodySettings(prev => ({ ...prev, ...(effectParams.body as BodySettings) }));
    }
    if (effectParams?.filter) {
      const filterData = effectParams.filter as { id?: string; intensity?: number };
      if (filterData.id) setSelectedFilter(filterData.id);
      if (filterData.intensity !== undefined) setFilterIntensity(filterData.intensity);
    }
  }, [selectedVideoClip?.id]); // 只在 clip ID 变化时加载

  // 保存设置到 clip（防抖）
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const saveSettingsToClip = useCallback(() => {
    if (!selectedVideoClip) return;
    
    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // 防抖保存
    saveTimeoutRef.current = setTimeout(() => {
      updateClip(selectedVideoClip.id, {
        effectParams: {
          ...((selectedVideoClip.effectParams as Record<string, unknown>) || {}),
          beauty: beautySettings,
          body: bodySettings,
          filter: {
            id: selectedFilter,
            intensity: filterIntensity,
          },
        },
      });
    }, 100); // 100ms 防抖
  }, [selectedVideoClip, beautySettings, bodySettings, selectedFilter, filterIntensity, updateClip]);

  // 设置变化时自动保存
  useEffect(() => {
    saveSettingsToClip();
  }, [beautySettings, bodySettings, selectedFilter, filterIntensity, saveSettingsToClip]);

  // 更新美颜参数
  const updateBeauty = useCallback((key: keyof BeautySettings, value: number) => {
    setBeautySettings(prev => ({ ...prev, [key]: value }));
  }, []);

  // 更新美体参数
  const updateBody = useCallback((key: keyof BodySettings, value: number) => {
    setBodySettings(prev => ({ ...prev, [key]: value }));
  }, []);

  // 应用预设
  const applyPreset = useCallback((preset: BeautyPreset) => {
    setBeautySettings(prev => ({
      ...DEFAULT_BEAUTY,
      ...preset.settings,
    }));
  }, []);

  // 重置所有设置
  const resetAll = useCallback(() => {
    setBeautySettings(DEFAULT_BEAUTY);
    setBodySettings(DEFAULT_BODY);
    setSelectedFilter('none');
    setFilterIntensity(100);
  }, []);

  // 保存设置到 clip
  const applyToClip = useCallback(() => {
    if (!selectedVideoClip) return;
    saveToHistory();
    
    // 将美颜美体设置保存到 clip 的 effectParams 中
    updateClip(selectedVideoClip.id, {
      effectParams: {
        ...selectedVideoClip.effectParams,
        beauty: beautySettings,
        body: bodySettings,
        filter: {
          id: selectedFilter,
          intensity: filterIntensity,
        },
      },
    });
  }, [selectedVideoClip, beautySettings, bodySettings, selectedFilter, filterIntensity, saveToHistory, updateClip]);

  return (
    <div className="w-full h-full bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">美颜美体</h3>
        <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900 rounded transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-gray-200">
        {[
          { id: 'beauty' as TabType, label: '美颜' },
          { id: 'body' as TabType, label: '美体' },
          { id: 'filter' as TabType, label: '滤镜' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 text-xs font-medium transition-all ${
              activeTab === tab.id
                ? 'text-gray-900 border-b-2 border-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* 美颜 Tab */}
        {activeTab === 'beauty' && (
          <div>
            {/* 预设套装 */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-600">一键美颜</span>
                <button
                  onClick={resetAll}
                  className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1"
                >
                  <RefreshCw size={10} />
                  重置
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {BEAUTY_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    className="flex-shrink-0 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <span className="text-xs font-medium text-gray-700 whitespace-nowrap">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 基础美颜 */}
            <CollapsibleSection title="基础美颜" icon={<Sun size={14} />} defaultOpen>
              <SliderControl label="磨皮" value={beautySettings.smoothSkin} onChange={(v) => updateBeauty('smoothSkin', v)} />
              <SliderControl label="美白" value={beautySettings.whitening} onChange={(v) => updateBeauty('whitening', v)} />
              <SliderControl label="锐化" value={beautySettings.sharpness} onChange={(v) => updateBeauty('sharpness', v)} />
            </CollapsibleSection>

            {/* 祛瑕疵 */}
            <CollapsibleSection title="祛瑕疵" icon={<Moon size={14} />}>
              <SliderControl label="祛痘" value={beautySettings.removeAcne} onChange={(v) => updateBeauty('removeAcne', v)} />
              <SliderControl label="去黑眼圈" value={beautySettings.removeDarkCircle} onChange={(v) => updateBeauty('removeDarkCircle', v)} />
              <SliderControl label="去皱纹" value={beautySettings.removeWrinkle} onChange={(v) => updateBeauty('removeWrinkle', v)} />
            </CollapsibleSection>

            {/* 脸型调整 */}
            <CollapsibleSection title="脸型调整" icon={<Heart size={14} />}>
              <SliderControl label="瘦脸" value={beautySettings.thinFace} onChange={(v) => updateBeauty('thinFace', v)} />
              <SliderControl label="小脸" value={beautySettings.smallFace} onChange={(v) => updateBeauty('smallFace', v)} />
              <SliderControl label="V脸" value={beautySettings.vFace} onChange={(v) => updateBeauty('vFace', v)} />
              <SliderControl label="下巴" value={beautySettings.chin} onChange={(v) => updateBeauty('chin', v)} min={-50} max={50} />
              <SliderControl label="额头" value={beautySettings.forehead} onChange={(v) => updateBeauty('forehead', v)} min={-50} max={50} />
              <SliderControl label="颧骨" value={beautySettings.cheekbone} onChange={(v) => updateBeauty('cheekbone', v)} />
              <SliderControl label="下颌骨" value={beautySettings.jawbone} onChange={(v) => updateBeauty('jawbone', v)} />
            </CollapsibleSection>

            {/* 眼睛调整 */}
            <CollapsibleSection title="眼睛调整" icon={<Eye size={14} />}>
              <SliderControl label="大眼" value={beautySettings.bigEye} onChange={(v) => updateBeauty('bigEye', v)} />
              <SliderControl label="眼距" value={beautySettings.eyeDistance} onChange={(v) => updateBeauty('eyeDistance', v)} min={-50} max={50} />
              <SliderControl label="眼角" value={beautySettings.eyeAngle} onChange={(v) => updateBeauty('eyeAngle', v)} min={-50} max={50} />
              <SliderControl label="亮眼" value={beautySettings.brightenEye} onChange={(v) => updateBeauty('brightenEye', v)} />
            </CollapsibleSection>

            {/* 鼻子调整 */}
            <CollapsibleSection title="鼻子调整" icon={<Sliders size={14} />}>
              <SliderControl label="瘦鼻" value={beautySettings.thinNose} onChange={(v) => updateBeauty('thinNose', v)} />
              <SliderControl label="鼻翼" value={beautySettings.noseWing} onChange={(v) => updateBeauty('noseWing', v)} />
              <SliderControl label="鼻尖" value={beautySettings.noseTip} onChange={(v) => updateBeauty('noseTip', v)} min={-50} max={50} />
              <SliderControl label="山根" value={beautySettings.noseBridge} onChange={(v) => updateBeauty('noseBridge', v)} />
            </CollapsibleSection>

            {/* 嘴巴调整 */}
            <CollapsibleSection title="嘴巴调整" icon={<Smile size={14} />}>
              <SliderControl label="嘴型" value={beautySettings.mouthSize} onChange={(v) => updateBeauty('mouthSize', v)} min={-50} max={50} />
              <SliderControl label="嘴唇" value={beautySettings.lipThickness} onChange={(v) => updateBeauty('lipThickness', v)} min={-50} max={50} />
              <SliderControl label="微笑" value={beautySettings.smile} onChange={(v) => updateBeauty('smile', v)} />
              <SliderControl label="白牙" value={beautySettings.teethWhiten} onChange={(v) => updateBeauty('teethWhiten', v)} />
            </CollapsibleSection>
          </div>
        )}

        {/* 美体 Tab */}
        {activeTab === 'body' && (
          <div>
            {/* 一键美体 */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-600">一键美体</span>
                <button
                  onClick={() => setBodySettings(DEFAULT_BODY)}
                  className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1"
                >
                  <RefreshCw size={10} />
                  重置
                </button>
              </div>
              <SliderControl label="智能美体" value={bodySettings.autoBody} onChange={(v) => updateBody('autoBody', v)} />
            </div>

            {/* 身材调整 */}
            <CollapsibleSection title="身材调整" icon={<User size={14} />} defaultOpen>
              <SliderControl label="瘦身" value={bodySettings.slimBody} onChange={(v) => updateBody('slimBody', v)} />
              <SliderControl label="长腿" value={bodySettings.longLeg} onChange={(v) => updateBody('longLeg', v)} />
              <SliderControl label="瘦腿" value={bodySettings.slimLeg} onChange={(v) => updateBody('slimLeg', v)} />
              <SliderControl label="瘦腰" value={bodySettings.slimWaist} onChange={(v) => updateBody('slimWaist', v)} />
              <SliderControl label="瘦手臂" value={bodySettings.slimArm} onChange={(v) => updateBody('slimArm', v)} />
            </CollapsibleSection>

            {/* 身形优化 */}
            <CollapsibleSection title="身形优化" icon={<Ruler size={14} />}>
              <SliderControl label="肩宽" value={bodySettings.shoulder} onChange={(v) => updateBody('shoulder', v)} min={-50} max={50} />
              <SliderControl label="美胯" value={bodySettings.hip} onChange={(v) => updateBody('hip', v)} />
              <SliderControl label="天鹅颈" value={bodySettings.swanNeck} onChange={(v) => updateBody('swanNeck', v)} />
            </CollapsibleSection>

            {/* 提示信息 */}
            <div className="p-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  💡 美体功能基于 AI 人体关键点检测，建议在人物清晰、全身入镜的视频中使用效果更佳。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 滤镜 Tab */}
        {activeTab === 'filter' && (
          <div className="p-4">
            {/* 滤镜强度 */}
            <div className="mb-4">
              <SliderControl 
                label="滤镜强度" 
                value={filterIntensity} 
                onChange={setFilterIntensity}
              />
            </div>

            {/* 滤镜分类 */}
            {['natural', 'portrait', 'style', 'retro'].map(category => {
              const categoryFilters = FILTER_PRESETS.filter(f => f.category === category || (category === 'natural' && f.id === 'none'));
              const categoryNames: Record<string, string> = {
                natural: '自然',
                portrait: '人像',
                style: '风格',
                retro: '复古',
              };

              return (
                <div key={category} className="mb-4">
                  <span className="text-xs font-medium text-gray-500 mb-2 block">{categoryNames[category]}</span>
                  <div className="grid grid-cols-4 gap-2">
                    {categoryFilters.map(filter => (
                      <button
                        key={filter.id}
                        onClick={() => setSelectedFilter(filter.id)}
                        className={`aspect-square rounded-lg border-2 transition-all flex flex-col items-center justify-center ${
                          selectedFilter === filter.id
                            ? 'border-gray-900 bg-gray-100'
                            : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                        }`}
                      >
                        <div className="w-8 h-8 rounded bg-gradient-to-br from-gray-200 to-gray-300 mb-1" />
                        <span className="text-[10px] text-gray-600">{filter.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default BeautyPanel;
