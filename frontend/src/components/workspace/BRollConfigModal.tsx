'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    X,
    Check,
    Film,
    User,
    Palette,
    Sparkles,
    Loader2,
    ChevronRight,
    Image,
    Layout,
    Play,
    Plus,
    Search,
    RefreshCw,
} from 'lucide-react';
import { authFetch } from '@/lib/supabase/session';

// ==========================================
// 调试日志
// ==========================================
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => DEBUG && console.log('[BRollConfigModal]', ...args);

// ==========================================
// AI 片段类型
// ==========================================
export interface ClipSuggestion {
    clipId: string;
    clipNumber: number;
    text: string;                    // 该片段的文案内容
    timeRange: { start: number; end: number };
    suggestedAssets: BRollAsset[];   // AI 推荐的素材
    selectedAssetId?: string;        // 用户选中的素材
}

export interface BRollAsset {
    id: string;
    thumbnailUrl: string;
    videoUrl: string;
    source: 'pexels' | 'local' | 'ai-generated';
    duration: number;
    width: number;
    height: number;
    relevanceScore?: number;         // AI 相关度评分
}

// ==========================================
// 组件 Props
// ==========================================
interface BRollConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    sessionId: string;
    projectId: string;
    // 从 ASR 结果传入的片段信息
    transcriptSegments?: Array<{
        id: string;
        text: string;
        start: number;
        end: number;
    }>;
}

// ==========================================
// 背景预设
// ==========================================
const BACKGROUND_PRESETS = [
    { id: 'gradient-1', name: '科技蓝', preview: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
    { id: 'gradient-2', name: '活力橙', preview: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
    { id: 'gradient-3', name: '自然绿', preview: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
    { id: 'gradient-4', name: '优雅紫', preview: 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)' },
    { id: 'gradient-5', name: '暖阳黄', preview: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
    { id: 'solid-black', name: '纯黑', preview: '#000000' },
    { id: 'solid-white', name: '纯白', preview: '#ffffff' },
    { id: 'blur', name: '毛玻璃', preview: 'rgba(255,255,255,0.1)' },
];

// ==========================================
// API 响应类型
// ==========================================
interface ApiAsset {
    id: string;
    thumbnail_url: string;
    video_url: string;
    source: string;
    duration: number;
    width: number;
    height: number;
    relevance_score?: number;
}

interface ApiClipSuggestion {
    clip_id: string;
    clip_number: number;
    text: string;
    time_range: { start: number; end: number };
    suggested_assets: ApiAsset[];
    selected_asset_id?: string;
}

// ==========================================
// API 获取片段建议
// ==========================================
async function fetchClipSuggestions(sessionId: string): Promise<ClipSuggestion[]> {
    // 使用相对路径，让 Next.js 的 rewrite 代理处理
    // 这样可以避免 CORS 问题和双重 /api 问题
    const response = await authFetch(`/api/workspace/sessions/${sessionId}/clip-suggestions`, {
        method: 'POST',
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || '获取片段建议失败');
    }
    
    const data = await response.json();
    
    // 转换后端响应格式到前端格式
    return (data.clips || []).map((clip: ApiClipSuggestion) => ({
        clipId: clip.clip_id,
        clipNumber: clip.clip_number,
        text: clip.text,
        timeRange: clip.time_range,
        suggestedAssets: (clip.suggested_assets || []).map((asset: ApiAsset) => ({
            id: asset.id,
            thumbnailUrl: asset.thumbnail_url,
            videoUrl: asset.video_url,
            source: asset.source as BRollAsset['source'],
            duration: asset.duration,
            width: asset.width,
            height: asset.height,
            relevanceScore: asset.relevance_score,
        })),
        selectedAssetId: clip.selected_asset_id,
    }));
}

// ==========================================
// B-Roll 配置弹窗组件
// ==========================================
export function BRollConfigModal({
    isOpen,
    onClose,
    sessionId,
    projectId,
    transcriptSegments,
}: BRollConfigModalProps) {
    const router = useRouter();

    // === 配置状态 ===
    const [pipEnabled, setPipEnabled] = useState(true);           // 挂角人像
    const [brollEnabled, setBrollEnabled] = useState(true);       // 智能 B-Roll 增强
    const [selectedBackground, setSelectedBackground] = useState('gradient-1');

    // === 片段状态 ===
    const [clips, setClips] = useState<ClipSuggestion[]>([]);
    const [activeClipId, setActiveClipId] = useState<string | null>(null);
    const [isLoadingClips, setIsLoadingClips] = useState(false);

    // === 提交状态 ===
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 初始化时加载片段建议
    useEffect(() => {
        if (isOpen && sessionId) {
            loadClipSuggestions();
        }
    }, [isOpen, sessionId]);

    // 加载片段建议
    const loadClipSuggestions = useCallback(async () => {
        setIsLoadingClips(true);
        setError(null);
        
        try {
            log('开始加载片段建议, sessionId:', sessionId);
            const suggestions = await fetchClipSuggestions(sessionId);
            log('获取到片段建议:', suggestions);
            
            setClips(suggestions);
            
            // 默认选中第一个片段
            if (suggestions.length > 0) {
                setActiveClipId(suggestions[0].clipId);
            }
        } catch (err: unknown) {
            log('加载片段建议失败:', err);
            const e = err as { message?: string };
            setError(e.message || '加载片段建议失败');
        } finally {
            setIsLoadingClips(false);
        }
    }, [sessionId]);

    // 当前激活的片段
    const activeClip = useMemo(() => {
        return clips.find(c => c.clipId === activeClipId);
    }, [clips, activeClipId]);

    // 选择片段的素材
    const handleSelectAsset = useCallback((clipId: string, assetId: string) => {
        setClips(prev => prev.map(clip =>
            clip.clipId === clipId
                ? { ...clip, selectedAssetId: assetId }
                : clip
        ));
    }, []);

    // 刷新片段建议
    const handleRefreshClips = useCallback(async () => {
        await loadClipSuggestions();
    }, [loadClipSuggestions]);

    // 确认并进入编辑器
    const handleConfirm = useCallback(async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            log('确认 B-Roll 配置:', {
                pipEnabled,
                brollEnabled,
                selectedBackground,
                clips: clips.map(c => ({ id: c.clipId, selectedAsset: c.selectedAssetId })),
            });

            // TODO: 调用后端 API 保存配置
            // const { saveBRollConfig } = await import('@/features/editor/lib/workspace-api');
            // await saveBRollConfig(sessionId, { ... });

            // 模拟保存延迟
            await new Promise(resolve => setTimeout(resolve, 500));

            // 跳转到编辑器
            router.push(`/editor?project=${projectId}`);

        } catch (err: unknown) {
            log('保存配置失败:', err);
            const e = err as { message?: string };
            setError(e.message || '保存配置失败，请重试');
            setIsSubmitting(false);
        }
    }, [pipEnabled, brollEnabled, selectedBackground, clips, sessionId, projectId, router]);

    // 跳过配置，直接进入编辑器
    const handleSkip = useCallback(() => {
        router.push(`/editor?project=${projectId}`);
    }, [projectId, router]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in fade-in zoom-in duration-300">
            <div className="bg-white w-full max-w-6xl rounded-2xl border border-gray-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center">
                            <Film size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">B-Roll 智能配置</h3>
                            <p className="text-gray-500 text-sm">AI 自动匹配场景素材，让视频更专业</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* 左侧：预览画布 + 配置开关 */}
                    <div className="w-[400px] border-r border-gray-200 flex flex-col bg-gray-50">
                        {/* 预览区域 */}
                        <div className="flex-1 relative flex items-center justify-center p-6">
                            <div className="relative w-full aspect-video bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 rounded-xl overflow-hidden border border-gray-200 shadow-inner">
                                {/* 模拟视频预览背景 */}
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="text-6xl font-black text-gray-300 tracking-tighter">AI</div>
                                </div>
                                {/* PiP 头像位置 */}
                                {pipEnabled && (
                                    <div className="absolute bottom-4 right-4 w-16 h-16 bg-gray-200 rounded-full border-2 border-gray-300 flex items-center justify-center shadow-md">
                                        <span className="text-2xl">😊</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 配置开关区域 */}
                        <div className="p-4 space-y-3 border-t border-gray-200 bg-white">
                            {/* B-ROLL 挂角人像 & 背景定制 并排 */}
                            <div className="flex gap-3">
                                {/* B-ROLL 挂角人像 */}
                                <button
                                    onClick={() => setPipEnabled(!pipEnabled)}
                                    className={`flex-1 flex items-center gap-3 p-3 rounded-xl transition-all ${
                                        pipEnabled 
                                            ? 'bg-gray-100 border border-gray-300' 
                                            : 'bg-gray-50 border border-gray-200'
                                    }`}
                                >
                                    <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center">
                                        <User size={16} className="text-gray-600" />
                                    </div>
                                    <div className="flex-1 text-left">
                                        <p className="text-xs font-medium text-gray-700">B-ROLL 挂角人像</p>
                                        <p className="text-[10px] text-gray-400">
                                            {pipEnabled ? '已开启 PiP' : '已关闭'}
                                        </p>
                                    </div>
                                    <div className={`w-10 h-6 rounded-full transition-colors ${
                                        pipEnabled ? 'bg-gray-800' : 'bg-gray-300'
                                    }`}>
                                        <span className={`block w-4 h-4 mt-1 rounded-full bg-white shadow transition-transform ${
                                            pipEnabled ? 'translate-x-5' : 'translate-x-1'
                                        }`} />
                                    </div>
                                </button>

                                {/* 背景定制按钮 */}
                                <button
                                    className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-all"
                                >
                                    <div className="w-8 h-8 bg-gray-700 rounded-lg flex items-center justify-center">
                                        <Palette size={16} className="text-white" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-xs font-medium text-gray-700">背景场景定制</p>
                                        <p className="text-[10px] text-gray-400">配置画布背景</p>
                                    </div>
                                </button>
                            </div>

                            {/* 智能 B-ROLL 增强 */}
                            <button
                                onClick={() => setBrollEnabled(!brollEnabled)}
                                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                                    brollEnabled 
                                        ? 'bg-gray-100 border border-gray-400' 
                                        : 'bg-gray-50 border border-gray-200'
                                }`}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                    brollEnabled ? 'bg-gray-800' : 'bg-gray-200'
                                }`}>
                                    <Sparkles size={16} className={brollEnabled ? 'text-white' : 'text-gray-500'} />
                                </div>
                                <div className="flex-1 text-left">
                                    <p className="text-xs font-medium text-gray-700">智能 B-ROLL 增强</p>
                                    <p className="text-[10px] text-gray-400">AI 自动匹配场景素材</p>
                                </div>
                                <div className={`w-10 h-6 rounded-full transition-colors ${
                                    brollEnabled ? 'bg-gray-800' : 'bg-gray-300'
                                }`}>
                                    <span className={`block w-4 h-4 mt-1 rounded-full bg-white shadow transition-transform ${
                                        brollEnabled ? 'translate-x-5' : 'translate-x-1'
                                    }`} />
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* 右侧：AI 片段建议 */}
                    <div className="flex-1 flex flex-col overflow-hidden bg-white">
                        {/* 片段标题栏 */}
                        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                            <div className="flex items-center gap-3">
                                <Sparkles size={18} className="text-gray-600" />
                                <h4 className="font-bold text-gray-800 text-sm">AI 片段建议</h4>
                            </div>
                            <button
                                onClick={handleRefreshClips}
                                disabled={isLoadingClips}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                            >
                                <RefreshCw size={14} className={isLoadingClips ? 'animate-spin' : ''} />
                                刷新建议
                            </button>
                        </div>

                        {/* 片段列表 */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                            {isLoadingClips ? (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Loader2 size={32} className="text-gray-500 animate-spin mb-4" />
                                    <p className="text-gray-500 text-sm">正在生成片段建议...</p>
                                </div>
                            ) : clips.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Film size={48} className="text-gray-300 mb-4" />
                                    <p className="text-gray-500 text-sm">暂无片段建议</p>
                                </div>
                            ) : (
                                clips.map(clip => (
                                    <div
                                        key={clip.clipId}
                                        className={`rounded-xl border transition-all overflow-hidden ${
                                            activeClipId === clip.clipId
                                                ? 'bg-white border-gray-400 shadow-md'
                                                : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
                                        }`}
                                    >
                                        {/* 片段头部 */}
                                        <div
                                            onClick={() => setActiveClipId(activeClipId === clip.clipId ? null : clip.clipId)}
                                            className="p-4 cursor-pointer"
                                        >
                                            {/* CLIP 标签 */}
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                                    SLOT {clip.clipNumber}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <button className="p-1 hover:bg-gray-100 rounded transition-colors">
                                                        <Film size={12} className="text-gray-400" />
                                                    </button>
                                                    <button className="p-1 hover:bg-gray-100 rounded transition-colors">
                                                        <Layout size={12} className="text-gray-400" />
                                                    </button>
                                                </div>
                                            </div>
                                            {/* 文案 */}
                                            <p className="text-sm text-gray-700 leading-relaxed mb-3">
                                                "{clip.text}"
                                            </p>
                                            {/* 素材缩略图 */}
                                            <div className="flex gap-2">
                                                {clip.suggestedAssets.slice(0, 3).map((asset, idx) => (
                                                    <button
                                                        key={asset.id}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSelectAsset(clip.clipId, asset.id);
                                                        }}
                                                        className={`relative w-16 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                                                            clip.selectedAssetId === asset.id
                                                                ? 'border-gray-800'
                                                                : 'border-gray-200 hover:border-gray-400'
                                                        }`}
                                                    >
                                                        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
                                                            <Image size={16} className="text-gray-400" />
                                                        </div>
                                                        {clip.selectedAssetId === asset.id && (
                                                            <div className="absolute inset-0 bg-gray-800/20 flex items-center justify-center">
                                                                <Check size={14} className="text-gray-800" />
                                                            </div>
                                                        )}
                                                    </button>
                                                ))}
                                                {/* 添加更多 */}
                                                <button className="w-16 h-12 rounded-lg border-2 border-dashed border-gray-300 hover:border-gray-400 flex items-center justify-center text-gray-400 hover:text-gray-500 transition-colors">
                                                    <Plus size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
                    {/* 错误提示 */}
                    {error && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                            <X size={14} className="text-red-500 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* 统计信息 */}
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                        <div className="flex items-center gap-2">
                            <Layout size={14} className="text-gray-400" />
                            <span>共 <span className="font-bold text-gray-700">{clips.length}</span> 个片段</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Film size={14} className="text-gray-400" />
                            <span>已选 <span className="font-bold text-gray-700">{clips.filter(c => c.selectedAssetId).length}</span> 个素材</span>
                        </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSkip}
                            disabled={isSubmitting}
                            className="px-5 py-2.5 text-gray-500 hover:text-gray-800 font-medium text-sm transition-colors disabled:opacity-50"
                        >
                            跳过，稍后配置
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={isSubmitting}
                            className="px-6 py-2.5 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium text-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    保存中...
                                </>
                            ) : (
                                <>
                                    确认并进入编辑器
                                    <ChevronRight size={16} />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
