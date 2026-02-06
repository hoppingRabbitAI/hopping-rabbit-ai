'use client';

import React, { useState, useCallback } from 'react';
import { 
    ArrowLeft, 
    X, 
    Sparkles,
    Wand2,
    Pencil,
    ImageIcon,
    Check,
    Upload,
    Eraser,
    Square,
    Circle,
    Type,
    Palette,
    Undo,
    Trash2,
    Play,
    Search,
    Loader2,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { 
    VisualStudioConfig, 
    VisualStudioPanelProps,
    BackgroundSource,
    ShotBackground,
    Shot,
    TEMPLATE_CATEGORIES,
    QUICK_PROMPTS,
    TemplateItem,
} from './types';

// ==========================================
// 工具函数
// ==========================================

function cn(...classes: (string | undefined | false)[]) {
    return classes.filter(Boolean).join(' ');
}

function formatDuration(seconds?: number): string {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}分${secs.toString().padStart(2, '0')}秒`;
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ==========================================
// 模拟数据
// ==========================================

const MOCK_TEMPLATES: TemplateItem[] = [
    { id: '1', name: '极简白', url: '/templates/bg-minimal-white.jpg', thumbnailUrl: '/templates/bg-minimal-white-thumb.jpg', category: 'solid' },
    { id: '2', name: '渐变蓝', url: '/templates/bg-gradient-blue.jpg', thumbnailUrl: '/templates/bg-gradient-blue-thumb.jpg', category: 'solid' },
    { id: '3', name: '科技感', url: '/templates/bg-tech.jpg', thumbnailUrl: '/templates/bg-tech-thumb.jpg', category: 'tech' },
    { id: '4', name: '暖色调', url: '/templates/bg-warm.jpg', thumbnailUrl: '/templates/bg-warm-thumb.jpg', category: 'life' },
    { id: '5', name: '城市夜景', url: '/templates/bg-city-night.jpg', thumbnailUrl: '/templates/bg-city-night-thumb.jpg', category: 'life' },
    { id: '6', name: '书房', url: '/templates/bg-study.jpg', thumbnailUrl: '/templates/bg-study-thumb.jpg', category: 'office' },
];

// ==========================================
// 背景定制源选项
// ==========================================

const BACKGROUND_SOURCES: Array<{
    source: BackgroundSource;
    icon: React.ReactNode;
    title: string;
}> = [
    { source: 'ai-generate', icon: <Wand2 size={14} />, title: 'AI 生成' },
    { source: 'canvas', icon: <Pencil size={14} />, title: '画布绘制' },
    { source: 'template', icon: <ImageIcon size={14} />, title: '选择模板' },
];

// ==========================================
// 子组件：未分析状态
// ==========================================

function IdleState({ onStartAnalysis }: { onStartAnalysis: () => void }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                <Search size={28} className="text-gray-400" />
            </div>
            <h4 className="text-lg font-medium text-gray-900 mb-2">准备分析视频</h4>
            <p className="text-sm text-gray-500 text-center mb-6 max-w-xs">
                AI 将自动识别视频分镜、最佳切换点，并检测人物前景用于背景替换
            </p>
            <button
                onClick={onStartAnalysis}
                className="px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-xl transition-all flex items-center gap-2"
            >
                <Search size={16} />
                开始 AI 分析
            </button>
        </div>
    );
}

// ==========================================
// 子组件：分析中状态
// ==========================================

function AnalyzingState() {
    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center mb-4">
                <Loader2 size={28} className="text-white animate-spin" />
            </div>
            <h4 className="text-lg font-medium text-gray-900 mb-2">正在分析视频...</h4>
            <p className="text-sm text-gray-500 text-center mb-4">
                识别分镜、检测人物、分析切换点
            </p>
            <div className="w-48 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gray-900 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
        </div>
    );
}

// ==========================================
// 子组件：分镜时间轴
// ==========================================

function ShotTimeline({ 
    shots, 
    selectedId, 
    onSelect 
}: { 
    shots: Shot[]; 
    selectedId: string | null;
    onSelect: (id: string) => void;
}) {
    return (
        <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-900">
                    已识别 {shots.length} 个分镜
                </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
                {shots.map((shot) => (
                    <button
                        key={shot.id}
                        onClick={() => onSelect(shot.id)}
                        className={cn(
                            "flex-shrink-0 w-20 rounded-lg overflow-hidden border-2 transition-all",
                            selectedId === shot.id
                                ? "border-gray-900 ring-2 ring-gray-900/20"
                                : "border-gray-200 hover:border-gray-400"
                        )}
                    >
                        <div className="aspect-video bg-gray-200 relative">
                            {shot.thumbnailUrl ? (
                                <img src={shot.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                    #{shot.index + 1}
                                </div>
                            )}
                            {shot.background && (
                                <div className="absolute top-0.5 right-0.5 w-3 h-3 bg-green-500 rounded-full border border-white" />
                            )}
                        </div>
                        <div className="px-1 py-0.5 bg-gray-50 text-center">
                            <span className="text-[10px] text-gray-500">
                                {formatTime(shot.startTime)}
                            </span>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ==========================================
// 子组件：背景编辑器
// ==========================================

function BackgroundEditor({ 
    background,
    onChange,
    applyScope,
    onApplyScopeChange,
}: { 
    background: ShotBackground | null;
    onChange: (bg: ShotBackground | null) => void;
    applyScope: 'current' | 'all';
    onApplyScopeChange: (scope: 'current' | 'all') => void;
}) {
    const [activeSource, setActiveSource] = useState<BackgroundSource>(
        background?.source || 'ai-generate'
    );
    const [prompt, setPrompt] = useState(background?.aiGenerate?.prompt || '');
    const [selectedTemplateId, setSelectedTemplateId] = useState(background?.template?.selectedId);
    const [activeCategory, setActiveCategory] = useState('all');
    
    const isCustomizing = background !== null;
    
    const handleToggleCustomize = (customize: boolean) => {
        if (customize) {
            onChange({
                source: activeSource,
                aiGenerate: { prompt: '' },
            });
        } else {
            onChange(null);
        }
    };
    
    const handleSourceChange = (source: BackgroundSource) => {
        setActiveSource(source);
        onChange({
            ...background,
            source,
        });
    };
    
    const handlePromptChange = (newPrompt: string) => {
        setPrompt(newPrompt);
        onChange({
            ...background,
            source: 'ai-generate',
            aiGenerate: { prompt: newPrompt },
        });
    };
    
    const handleTemplateSelect = (template: TemplateItem) => {
        setSelectedTemplateId(template.id);
        onChange({
            source: 'template',
            template: { selectedId: template.id, selectedTemplate: template },
        });
    };
    
    const filteredTemplates = activeCategory === 'all' 
        ? MOCK_TEMPLATES 
        : MOCK_TEMPLATES.filter(t => t.category === activeCategory);
    
    return (
        <div className="space-y-4">
            {/* 是否自定义背景 */}
            <div className="flex gap-2">
                <button
                    onClick={() => handleToggleCustomize(false)}
                    className={cn(
                        "flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all border",
                        !isCustomizing
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                    )}
                >
                    保持原始背景
                </button>
                <button
                    onClick={() => handleToggleCustomize(true)}
                    className={cn(
                        "flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all border",
                        isCustomizing
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                    )}
                >
                    自定义背景
                </button>
            </div>
            
            {/* 自定义背景内容 */}
            {isCustomizing && (
                <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
                    {/* 应用范围 */}
                    <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <span className="text-xs text-gray-500 mr-2">应用范围：</span>
                        <button
                            onClick={() => onApplyScopeChange('current')}
                            className={cn(
                                "px-3 py-1 text-xs rounded-md transition-all",
                                applyScope === 'current'
                                    ? "bg-gray-900 text-white"
                                    : "text-gray-500 hover:bg-gray-200"
                            )}
                        >
                            仅此分镜
                        </button>
                        <button
                            onClick={() => onApplyScopeChange('all')}
                            className={cn(
                                "px-3 py-1 text-xs rounded-md transition-all",
                                applyScope === 'all'
                                    ? "bg-gray-900 text-white"
                                    : "text-gray-500 hover:bg-gray-200"
                            )}
                        >
                            应用全部
                        </button>
                    </div>
                    
                    {/* 背景源选择 */}
                    <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                        {BACKGROUND_SOURCES.map((item) => (
                            <button
                                key={item.source}
                                onClick={() => handleSourceChange(item.source)}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all",
                                    activeSource === item.source
                                        ? "bg-white text-gray-900 shadow-sm"
                                        : "text-gray-500 hover:text-gray-700"
                                )}
                            >
                                {item.icon}
                                {item.title}
                            </button>
                        ))}
                    </div>
                    
                    {/* AI 生成 */}
                    {activeSource === 'ai-generate' && (
                        <div className="space-y-3">
                            <textarea
                                value={prompt}
                                onChange={(e) => handlePromptChange(e.target.value)}
                                placeholder="描述你想要的背景，如：简约科技感办公室"
                                className="w-full h-20 px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                            />
                            <div className="flex flex-wrap gap-1.5">
                                {QUICK_PROMPTS.slice(0, 4).map((p) => (
                                    <button
                                        key={p}
                                        onClick={() => handlePromptChange(p)}
                                        className={cn(
                                            "px-2 py-1 text-xs rounded-md border transition-all",
                                            prompt === p
                                                ? "bg-gray-900 text-white border-gray-900"
                                                : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                                        )}
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                            <button
                                disabled={!prompt.trim()}
                                className={cn(
                                    "w-full py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2",
                                    prompt.trim()
                                        ? "bg-gray-900 text-white hover:bg-gray-800"
                                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                )}
                            >
                                <Sparkles size={14} />
                                生成背景
                            </button>
                        </div>
                    )}
                    
                    {/* 画布绘制 */}
                    {activeSource === 'canvas' && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-1 p-1.5 bg-gray-50 rounded-lg">
                                {[
                                    { icon: <Pencil size={14} />, label: '画笔' },
                                    { icon: <Eraser size={14} />, label: '橡皮' },
                                    { icon: <Square size={14} />, label: '矩形' },
                                    { icon: <Type size={14} />, label: '文字' },
                                ].map((tool, i) => (
                                    <button
                                        key={i}
                                        className={cn(
                                            "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                                            i === 0 ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-200"
                                        )}
                                        title={tool.label}
                                    >
                                        {tool.icon}
                                    </button>
                                ))}
                                <div className="w-px h-5 bg-gray-200 mx-1" />
                                <div className="flex gap-1">
                                    {['#000', '#EF4444', '#3B82F6', '#10B981'].map((color) => (
                                        <button
                                            key={color}
                                            className="w-5 h-5 rounded-full border-2 border-gray-200"
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div className="aspect-video bg-white border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center cursor-crosshair">
                                <span className="text-xs text-gray-400">点击开始绘制</span>
                            </div>
                        </div>
                    )}
                    
                    {/* 模板选择 */}
                    {activeSource === 'template' && (
                        <div className="space-y-3">
                            <div className="flex gap-1.5 overflow-x-auto pb-1">
                                {TEMPLATE_CATEGORIES.slice(0, 5).map((cat) => (
                                    <button
                                        key={cat.id}
                                        onClick={() => setActiveCategory(cat.id)}
                                        className={cn(
                                            "px-2.5 py-1 text-xs rounded-md whitespace-nowrap transition-all",
                                            activeCategory === cat.id
                                                ? "bg-gray-900 text-white"
                                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                        )}
                                    >
                                        {cat.name}
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {filteredTemplates.map((template) => (
                                    <button
                                        key={template.id}
                                        onClick={() => handleTemplateSelect(template)}
                                        className={cn(
                                            "aspect-video rounded-lg overflow-hidden border-2 transition-all relative",
                                            selectedTemplateId === template.id
                                                ? "border-gray-900 ring-2 ring-gray-900/20"
                                                : "border-gray-200 hover:border-gray-400"
                                        )}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                                            <span className="text-[10px] text-gray-400">{template.name}</span>
                                        </div>
                                        {selectedTemplateId === template.id && (
                                            <div className="absolute top-1 right-1 w-4 h-4 bg-gray-900 rounded-full flex items-center justify-center">
                                                <Check size={10} className="text-white" />
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ==========================================
// 子组件：分析完成状态
// ==========================================

function AnalysisDoneState({ 
    config, 
    onChange,
    mainVideoInfo,
}: { 
    config: VisualStudioConfig;
    onChange: (config: VisualStudioConfig) => void;
    mainVideoInfo?: VisualStudioPanelProps['mainVideoInfo'];
}) {
    const selectedShot = config.shots.find(s => s.id === config.selectedShotId);
    const [applyScope, setApplyScope] = useState<'current' | 'all'>('all');
    
    const handleShotSelect = (shotId: string) => {
        onChange({ ...config, selectedShotId: shotId });
    };
    
    const handleBackgroundChange = (bg: ShotBackground | null) => {
        if (applyScope === 'all') {
            // 应用到全部分镜
            const updatedShots = config.shots.map(shot => ({
                ...shot,
                background: bg,
            }));
            onChange({
                ...config,
                shots: updatedShots,
                globalBackground: bg,
                useGlobalBackground: true,
            });
        } else {
            // 只应用到当前分镜
            const updatedShots = config.shots.map(shot => 
                shot.id === config.selectedShotId
                    ? { ...shot, background: bg }
                    : shot
            );
            onChange({
                ...config,
                shots: updatedShots,
                useGlobalBackground: false,
            });
        }
    };
    
    const currentBackground = applyScope === 'all' 
        ? config.globalBackground 
        : selectedShot?.background || null;
    
    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* 分镜时间轴 */}
            <div className="px-6 pt-4">
                <ShotTimeline 
                    shots={config.shots}
                    selectedId={config.selectedShotId}
                    onSelect={handleShotSelect}
                />
            </div>
            
            {/* 当前选中分镜信息 */}
            {selectedShot && (
                <div className="px-6 pb-2">
                    <div className="text-xs text-gray-500">
                        当前：分镜 #{selectedShot.index + 1}（{formatTime(selectedShot.startTime)} - {formatTime(selectedShot.endTime)}）
                    </div>
                </div>
            )}
            
            {/* 背景编辑器 */}
            <div className="flex-1 px-6 pb-4 overflow-y-auto">
                <BackgroundEditor
                    background={currentBackground}
                    onChange={handleBackgroundChange}
                    applyScope={applyScope}
                    onApplyScopeChange={setApplyScope}
                />
            </div>
        </div>
    );
}

// ==========================================
// 主组件
// ==========================================

export default function VisualStudioPanel({
    config,
    onChange,
    mainVideoInfo,
    onComplete,
    onBack,
    onClose,
}: VisualStudioPanelProps) {
    
    // 模拟 AI 分析
    const handleStartAnalysis = useCallback(async () => {
        onChange({ ...config, analysisStatus: 'analyzing' });
        
        // 模拟分析过程
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 模拟分析结果 - 根据视频时长生成分镜
        const duration = mainVideoInfo?.duration || 60;
        const shotCount = Math.max(3, Math.min(12, Math.floor(duration / 10)));
        const shotDuration = duration / shotCount;
        
        const shots: Shot[] = Array.from({ length: shotCount }, (_, i) => ({
            id: `shot-${i}`,
            index: i,
            startTime: i * shotDuration,
            endTime: (i + 1) * shotDuration,
            thumbnailUrl: mainVideoInfo?.thumbnailUrl || '',
            background: null,
        }));
        
        onChange({
            ...config,
            analysisStatus: 'done',
            shots,
            selectedShotId: shots[0]?.id || null,
        });
    }, [config, mainVideoInfo, onChange]);
    
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div className="w-11 h-11 bg-gray-900 rounded-xl flex items-center justify-center">
                            <Sparkles size={22} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">AI 视觉工作室</h3>
                            <p className="text-gray-500 text-sm">
                                {config.analysisStatus === 'done' 
                                    ? `已识别 ${config.shots.length} 个分镜` 
                                    : '智能分析 · 分镜规划 · 背景定制'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors"
                        title="暂时关闭"
                    >
                        <X size={20} />
                    </button>
                </div>
                
                {/* 内容区域 */}
                <div className="flex flex-1 overflow-hidden">
                    {/* 左侧：主内容 */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {config.analysisStatus === 'idle' && (
                            <IdleState onStartAnalysis={handleStartAnalysis} />
                        )}
                        {config.analysisStatus === 'analyzing' && (
                            <AnalyzingState />
                        )}
                        {config.analysisStatus === 'done' && (
                            <AnalysisDoneState 
                                config={config} 
                                onChange={onChange}
                                mainVideoInfo={mainVideoInfo}
                            />
                        )}
                    </div>
                    
                    {/* 右侧：视频预览 */}
                    <div className="w-[280px] p-4 border-l border-gray-100 bg-gray-50/30 flex flex-col">
                        <h4 className="text-sm font-medium text-gray-900 mb-3">视频预览</h4>
                        
                        {/* 视频缩略图 - 按原始比例 */}
                        <div 
                            className="bg-gray-900 rounded-xl overflow-hidden relative group"
                            style={{
                                aspectRatio: mainVideoInfo ? `${mainVideoInfo.width} / ${mainVideoInfo.height}` : '9 / 16'
                            }}
                        >
                            {mainVideoInfo?.thumbnailUrl ? (
                                <img 
                                    src={mainVideoInfo.thumbnailUrl} 
                                    alt="Video preview"
                                    className="w-full h-full object-contain"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <Play size={32} className="text-white/50" />
                                </div>
                            )}
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Play size={32} className="text-white" />
                            </div>
                        </div>
                        
                        {/* 视频信息 */}
                        <div className="mt-3 text-sm text-gray-500">
                            时长：{formatDuration(mainVideoInfo?.duration)}
                        </div>
                        
                        {/* 分析状态提示 */}
                        {config.analysisStatus === 'done' && (
                            <div className="mt-4 p-3 bg-green-50 rounded-lg">
                                <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
                                    <Check size={14} />
                                    分析完成
                                </div>
                                <p className="text-xs text-green-600 mt-1">
                                    已识别 {config.shots.length} 个分镜
                                </p>
                            </div>
                        )}
                    </div>
                </div>
                
                {/* Footer */}
                <div className="px-6 pb-6 pt-4 border-t border-gray-100">
                    <button
                        onClick={onComplete}
                        disabled={config.analysisStatus !== 'done'}
                        className={cn(
                            "w-full h-12 text-sm font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2",
                            config.analysisStatus === 'done'
                                ? "bg-gray-900 hover:bg-gray-800 text-white"
                                : "bg-gray-100 text-gray-400 cursor-not-allowed"
                        )}
                    >
                        <Sparkles size={16} />
                        {config.analysisStatus === 'done' ? '进入编辑器' : '请先完成 AI 分析'}
                    </button>
                </div>
            </div>
        </div>
    );
}
