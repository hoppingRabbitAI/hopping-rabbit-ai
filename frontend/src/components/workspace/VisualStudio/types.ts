'use client';

/**
 * AI 视觉工作室 - 类型定义 v3
 * 
 * 设计理念：
 * 1. 先让 AI 分析视频，识别分镜
 * 2. 用户基于分镜结果，逐镜或全局定制背景
 * 3. 渐进式交互，降低用户认知负担
 */

// ==========================================
// 分析状态
// ==========================================

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error';

// ==========================================
// 分镜 (Shot)
// ==========================================

export interface Shot {
    id: string;
    index: number;
    startTime: number;      // 秒
    endTime: number;        // 秒
    thumbnailUrl: string;   // 关键帧缩略图
    background?: ShotBackground | null;  // null 表示保持原始
}

export interface ShotBackground {
    source: BackgroundSource;
    aiGenerate?: AIGenerateConfig;
    canvas?: CanvasConfig;
    template?: TemplateConfig;
}

// ==========================================
// 背景定制
// ==========================================

export type BackgroundSource = 'ai-generate' | 'canvas' | 'template';

export interface AIGenerateConfig {
    prompt: string;
    referenceImageUrl?: string;
    generatedImageUrl?: string;
    isGenerating?: boolean;
}

export interface CanvasElement {
    id: string;
    type: 'path' | 'rect' | 'circle' | 'text';
    data: unknown;
    color: string;
    strokeWidth?: number;
}

export interface CanvasConfig {
    dataUrl?: string;
    elements: CanvasElement[];
    backgroundColor?: string;
}

export interface TemplateItem {
    id: string;
    name: string;
    url: string;
    thumbnailUrl: string;
    category: string;
}

export interface TemplateConfig {
    selectedId?: string;
    selectedTemplate?: TemplateItem;
}

// ==========================================
// 模板分类 & 快捷提示词
// ==========================================

export const TEMPLATE_CATEGORIES = [
    { id: 'all', name: '全部' },
    { id: 'office', name: '办公' },
    { id: 'life', name: '生活' },
    { id: 'nature', name: '自然' },
    { id: 'tech', name: '科技' },
    { id: 'festival', name: '节日' },
    { id: 'solid', name: '纯色' },
];

export const QUICK_PROMPTS = [
    '简约科技感办公室',
    '温馨书房',
    '城市天际线',
    '自然风光',
    '渐变蓝色',
    '极简白色',
];

// ==========================================
// 完整配置
// ==========================================

export interface VisualStudioConfig {
    analysisStatus: AnalysisStatus;
    shots: Shot[];
    selectedShotId: string | null;
    
    // 全局背景设置（应用到所有分镜）
    globalBackground: ShotBackground | null;
    
    // 是否使用全局背景
    useGlobalBackground: boolean;
}

// ==========================================
// 默认配置
// ==========================================

export const DEFAULT_VISUAL_STUDIO_CONFIG: VisualStudioConfig = {
    analysisStatus: 'idle',
    shots: [],
    selectedShotId: null,
    globalBackground: null,
    useGlobalBackground: true,
};

// ==========================================
// 组件 Props
// ==========================================

export interface VisualStudioPanelProps {
    config: VisualStudioConfig;
    onChange: (config: VisualStudioConfig) => void;
    mainVideoInfo?: {
        thumbnailUrl?: string;
        width: number;
        height: number;
        duration?: number;
    };
    onComplete: () => void;
    onBack: () => void;
    onClose: () => void;
}
