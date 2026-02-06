'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    X,
    ArrowLeft,
    Upload,
    FileVideo,
    Trash2,
    Scissors,
    Check,
    Loader2,
    Sparkles,
    User,
    ChevronRight,
    RefreshCw,
    Layout,
    Plus,
    Image as ImageIcon,
    Clock,
    Play,
    Pause,
    Volume2,
    Wind,
    Search,
    Download,
    Film,
    MessageSquare,
    FileText,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { SmartBroadcastStep } from './SmartBroadcastStep';
import { RemotionConfigPreview } from '@/remotion/components/RemotionConfigPreview';
import { renderAndDownload } from '@/lib/api/remotion-render';
import { 
    BRollConfigPanel, 
    PiPSettingsPanel,
    DEFAULT_BROLL_CONFIG, 
    type BRollConfigState,
    type MainVideoInfo 
} from './BRollConfigPanel';
import VisualStudioPanel from './VisualStudio';
import { 
    DEFAULT_VISUAL_STUDIO_CONFIG,
    type VisualStudioConfig,
} from './VisualStudio/types';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

// ==========================================
// 调试日志
// ==========================================
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => DEBUG && console.log('[WorkflowModal]', ...args);

// ==========================================
// 工作流步骤定义
// ==========================================
export type WorkflowStep = 'entry' | 'upload' | 'processing' | 'defiller' | 'visual-studio' | 'completed';

export type EntryMode = 'ai-talk' | 'refine';
export type AspectRatio = '9:16' | '16:9';

// ==========================================
// 类型定义
// ==========================================
interface FillerWord {
    word: string;
    count: number;
    checked: boolean;
    totalDuration?: number;
    // ★ 后端返回的具体出现位置
    occurrences?: Array<{
        start: number;
        end: number;
        asset_id?: string;
        text?: string;
    }>;
}

interface TranscriptSegment {
    id: string;
    text: string;
    start: number;
    end: number;
    assetId?: string;  // 关联的 asset ID
    silence_info?: { classification: string };
}

// 口癖片段（用于列表和预览）
interface FillerSegment {
    id: string;
    word: string;
    text: string;
    start: number;  // 毫秒
    end: number;    // 毫秒
    duration: number; // 毫秒
}

interface ClipSuggestion {
    clipId: string;
    clipNumber: number;
    text: string;
    timeRange: { start: number; end: number };
    suggestedAssets: BRollAsset[];
    selectedAssetId?: string;
    searchKeywords?: string[];  // ★ V2: LLM 生成的搜索关键词
    isSearching?: boolean;      // 是否正在搜索
}

interface BRollAsset {
    id: string;
    thumbnailUrl: string;
    videoUrl: string;
    source: 'pexels' | 'local' | 'ai-generated';
    duration: number;
    width: number;
    height: number;
    relevanceScore?: number;
}

// ★ V2: 智能分析阶段创建的 clip 信息
interface CreatedClipV2 {
    id: string;
    text: string;
    start_time: number;
    end_time: number;
    is_filler: boolean;
    filler_type?: string;
    filler_reason?: string;
    confidence: number;
}

// ★ V2: Remotion 配置中的 B-Roll 组件
// display_mode 只有两种：fullscreen（全屏覆盖）或 pip（部分位置）
interface BRollComponentV2 {
    id: string;
    type: 'broll';
    start_ms: number;
    end_ms: number;
    search_keywords: string[];
    display_mode: 'fullscreen' | 'pip';  // ★ 只有两种模式
    transition_in: string;
    transition_out: string;
    asset_url?: string;
    asset_id?: string;
}

// 分镜策略类型
export type ShotStrategy = 'scene' | 'sentence' | 'paragraph';

// 暂停时保存的状态数据
export interface WorkflowPauseData {
    sessionId: string;
    projectId: string;
    step: WorkflowStep;
    mode: EntryMode;
    aspectRatio?: AspectRatio;
    // ★★★ 新增：功能开关状态（动态步骤依赖）★★★
    enableSmartClip?: boolean;
    enableBroll?: boolean;
    shotStrategy?: ShotStrategy;  // 分镜策略
}

interface WorkflowModalProps {
    isOpen: boolean;
    onClose: () => void;
    // 暂时关闭弹窗但保留状态（用于右上角 X 按钮）
    onPause?: (data: WorkflowPauseData) => void;
    // 如果有 resumeData，则从指定步骤恢复
    resumeData?: WorkflowPauseData;
}

// ==========================================
// 步骤指示器组件
// ==========================================
function StepIndicator({ 
    currentStep, 
    mode,
    enableSmartClip,
    enableBroll,
}: { 
    currentStep: WorkflowStep; 
    mode: EntryMode;
    enableSmartClip: boolean;
    enableBroll: boolean;
}) {
    // ★★★ 动态计算步骤列表 ★★★
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const steps: Array<{ key: string; label: string; icon: any }> = [];
    
    if (mode === 'refine') {
        // 上传步骤始终存在
        steps.push({ key: 'upload', label: '上传并配置', icon: Upload });
        
        // 智能剪辑开启时添加：智能分析 + 口癖修剪
        if (enableSmartClip) {
            steps.push({ key: 'processing', label: '智能分析', icon: Sparkles });
            steps.push({ key: 'defiller', label: '口癖修剪', icon: Scissors });
        }
        
        // B-Roll 开启时添加：AI 视觉工作室
        if (enableBroll) {
            steps.push({ key: 'visual-studio', label: 'AI 视觉', icon: Sparkles });
        }
    } else {
        // AI 模式保持原样
        steps.push({ key: 'upload', label: '上传素材', icon: Upload });
        steps.push({ key: 'processing', label: 'AI 处理', icon: Sparkles });
    }

    const currentIndex = steps.findIndex(s => s.key === currentStep);

    return (
        <div className="flex items-center justify-center gap-1 px-4 py-3 border-b border-gray-100 bg-gray-50/80 overflow-x-auto">
            {steps.map((step, index) => {
                const Icon = step.icon;
                const isActive = step.key === currentStep;
                const isCompleted = index < currentIndex;
                const isUpcoming = index > currentIndex;

                return (
                    <React.Fragment key={step.key}>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className={cn(
                                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all flex-shrink-0",
                                isActive && "bg-gray-900 text-white",
                                isCompleted && "bg-gray-900 text-white",
                                isUpcoming && "bg-gray-200 text-gray-400"
                            )}>
                                {isCompleted ? (
                                    <Check size={12} />
                                ) : (
                                    <Icon size={12} />
                                )}
                            </div>
                            <span className={cn(
                                "text-[11px] font-medium whitespace-nowrap",
                                isActive && "text-gray-900",
                                isCompleted && "text-gray-600",
                                isUpcoming && "text-gray-400"
                            )}>
                                {step.label}
                            </span>
                        </div>
                        {index < steps.length - 1 && (
                            <div className={cn(
                                "w-4 h-[2px] flex-shrink-0 mx-1",
                                index < currentIndex ? "bg-gray-400" : "bg-gray-200"
                            )} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

// ==========================================
// 主组件
// ==========================================
export function WorkflowModal({ isOpen, onClose, onPause, resumeData }: WorkflowModalProps) {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // === 流程状态 ===
    const [currentStep, setCurrentStep] = useState<WorkflowStep>(resumeData?.step || 'entry');
    const [entryMode, setEntryMode] = useState<EntryMode>(resumeData?.mode || 'refine');
    const [aspectRatio, setAspectRatio] = useState<AspectRatio | null>(resumeData?.aspectRatio || null);
    const [aspectRatioError, setAspectRatioError] = useState<string | null>(null);

    // === Session 数据 ===
    const [sessionId, setSessionId] = useState<string>(resumeData?.sessionId || '');
    const [projectId, setProjectId] = useState<string>(resumeData?.projectId || '');
    
    // 分镜策略状态（需要在 useEffect 之前定义）
    const [shotStrategy, setShotStrategy] = useState<ShotStrategy | null>(resumeData?.shotStrategy ?? null);

    // ★ visual-studio 步骤时，使用 useEffect 跳转到视觉编辑器（避免在渲染时调用 router.push）
    useEffect(() => {
        if (currentStep === 'visual-studio' && sessionId && projectId) {
            const strategy = shotStrategy || 'scene';
            router.push(`/visual-editor?project=${projectId}&session=${sessionId}&strategy=${strategy}`);
        }
    }, [currentStep, sessionId, projectId, router, shotStrategy]);

    // ★ 暂停并保存状态（用于右上角 X 按钮）
    const handlePause = async () => {
        // 只有在有意义的步骤才保存状态（entry 步骤不需要保存）
        if (currentStep !== 'entry' && sessionId && projectId) {
            // ★ 保存到后端数据库，支持刷新页面后恢复
            try {
                const { authFetch } = await import('@/lib/supabase/session');
                await authFetch(`/api/workspace/sessions/${sessionId}/workflow-step`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        workflow_step: currentStep,
                        entry_mode: entryMode,
                        enable_smart_clip: enableSmartClip,
                        enable_broll: enableBroll,
                        aspect_ratio: aspectRatio || undefined,
                    }),
                });
                log('工作流状态已保存到数据库:', { sessionId, step: currentStep, mode: entryMode, enableSmartClip, enableBroll });
            } catch (err) {
                log('保存工作流状态失败（不影响关闭）:', err);
            }
            
            // 通知父组件保存前端状态
            if (onPause) {
                onPause({
                    sessionId,
                    projectId,
                    step: currentStep,
                    mode: entryMode,
                    aspectRatio: aspectRatio || undefined,
                    enableSmartClip,
                    enableBroll,
                });
            }
        }
        onClose();
    };

    // ★ 更新步骤并同步到后端（治本方案）
    const updateStep = async (newStep: WorkflowStep, currentSessionId?: string, strategy?: ShotStrategy | null) => {
        setCurrentStep(newStep);
        
        // ★★★ 如果传入了新的 sessionId，更新状态 ★★★
        if (currentSessionId && currentSessionId !== sessionId) {
            console.log('[Workflow] 更新 sessionId:', sessionId, '->', currentSessionId);
            setSessionId(currentSessionId);
        }
        
        // 同步到后端数据库（entry 步骤不需要保存）
        const sid = currentSessionId || sessionId;
        if (newStep !== 'entry' && sid) {
            try {
                const { authFetch } = await import('@/lib/supabase/session');
                await authFetch(`/api/workspace/sessions/${sid}/workflow-step`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        workflow_step: newStep,
                        entry_mode: entryMode,
                        enable_smart_clip: enableSmartClip,
                        enable_broll: enableBroll,
                        shot_strategy: strategy ?? shotStrategy,
                        aspect_ratio: aspectRatio || undefined,
                    }),
                });
                log('工作流步骤已同步到后端:', { sessionId: sid, step: newStep, enableSmartClip, enableBroll, shotStrategy: strategy ?? shotStrategy });
            } catch (err) {
                log('同步工作流步骤失败（不影响继续）:', err);
            }
        }
    };

    // === Step 1: Upload 状态 ===
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadPhase, setUploadPhase] = useState<'uploading' | 'processing' | 'ready'>('uploading');

    // === Step 2: Processing 状态 ===
    const [processingStatus, setProcessingStatus] = useState<string>('等待处理...');

    // === Step 3: Defiller 状态 ===
    const [fillerWords, setFillerWords] = useState<FillerWord[]>([]);
    const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
    const [fillerSegments, setFillerSegments] = useState<FillerSegment[]>([]); // 所有口癖片段列表
    const [activeFillerSegment, setActiveFillerSegment] = useState<FillerSegment | null>(null); // 当前预览的片段
    const [isApplyingTrim, setIsApplyingTrim] = useState(false);
    const [assetId, setAssetId] = useState<string>(''); // 视频资源ID用于预览
    const [videoUrl, setVideoUrl] = useState<string>(''); // 视频URL用于预览
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [videoProgress, setVideoProgress] = useState(0);
    const [currentTimeMs, setCurrentTimeMs] = useState(0); // Remotion Player 当前时间（毫秒）
    // ★★★ 新增：用户选择的片段ID集合 ★★★
    const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());

    // === Step Config: 分析配置选项 ===
    // ★★★ 两个主开关 ★★★
    const [enableSmartClip, setEnableSmartClip] = useState(resumeData?.enableSmartClip ?? true);   // 智能剪辑总开关
    const [enableBroll, setEnableBroll] = useState(resumeData?.enableBroll ?? false);           // B-Roll 总开关
    // 注意: shotStrategy 已在上方 useEffect 之前定义
    
    // ★★★ 智能清理三选项（仅在 enableSmartClip 为 true 时显示）★★★
    const [configCutSilences, setConfigCutSilences] = useState(true);       // 删除静音片段（换气/停顿/死寂）
    const [configCutBadTakes, setConfigCutBadTakes] = useState(true);       // 删除NG/重复片段
    const [configRemoveFillers, setConfigRemoveFillers] = useState(true);   // 删除口癖词（嗯/那个/就是）
    
    // ★★★ AI 视觉工作室配置（升级版 B-Roll）★★★
    const [visualStudioConfig, setVisualStudioConfig] = useState<VisualStudioConfig>(DEFAULT_VISUAL_STUDIO_CONFIG);
    
    // ★★★ B-Roll 配置选项（保留兼容）★★★
    const [brollConfig, setBrollConfig] = useState<BRollConfigState>(DEFAULT_BROLL_CONFIG);
    const [mainVideoInfo, setMainVideoInfo] = useState<MainVideoInfo | undefined>(undefined);  // ★ 主视频信息
    const [faceDetectionResult, setFaceDetectionResult] = useState<{
        dominantRegion?: { x: number; y: number; width: number; height: number };
        safePipPositions: string[];
    } | undefined>(undefined);

    // ★ V2: 智能分析阶段创建的 clips 和 Remotion 配置
    const [createdClipsV2, setCreatedClipsV2] = useState<CreatedClipV2[]>([]);
    const [brollComponentsV2, setBrollComponentsV2] = useState<BRollComponentV2[]>([]);
    const [remotionConfigV2, setRemotionConfigV2] = useState<{
        version: string;
        total_duration_ms: number;
        fps: number;
        theme: string;
        color_palette: string[];
        font_family: string;
        text_components: Array<{
            id: string;
            type: 'text';
            start_ms: number;
            end_ms: number;
            text: string;
            animation: string;  // main-subtitle, keyword-highlight, 等
            position: string;   // subtitle-main, subtitle-keyword, 等
            style: { 
                fontSize: number; 
                color: string; 
                fontWeight?: string;
                backgroundColor?: string;  // ★ keyword-highlight 需要
            };
            linkedSubtitleId?: string;  // ★ 可选：关联的主字幕 ID
        }>;
        broll_components: BRollComponentV2[];
        chapter_components: Array<{
            id: string;
            type: 'chapter';
            start_ms: number;
            end_ms: number;
            title: string;
            subtitle?: string;
            style: string;
        }>;
    } | null>(null);

    // === 通用状态 ===
    const [error, setError] = useState<string | null>(null);
    
    // === Remotion 渲染导出状态 ===
    const [isRendering, setIsRendering] = useState(false);
    const [renderProgress, setRenderProgress] = useState(0);

    // 恢复流程
    useEffect(() => {
        if (resumeData) {
            setCurrentStep(resumeData.step);
            setEntryMode(resumeData.mode);
            setSessionId(resumeData.sessionId);
            setProjectId(resumeData.projectId);
            if (resumeData.aspectRatio) setAspectRatio(resumeData.aspectRatio);

            // 根据步骤加载数据
            if (resumeData.step === 'defiller') {
                loadDefillerData(resumeData.sessionId);
            }
        }
    }, [resumeData]);

    // ★★★ 选择文件后，自动提取主视频尺寸信息（用于 B-Roll 位置预览）★★★
    useEffect(() => {
        if (selectedFiles.length === 0) {
            setMainVideoInfo(undefined);
            return;
        }

        const file = selectedFiles[0];
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';

        let videoDuration = 0;

        video.onloadedmetadata = () => {
            const width = video.videoWidth;
            const height = video.videoHeight;
            videoDuration = video.duration;

            // 生成封面图
            video.currentTime = 1; // 跳转到 1 秒处
        };

        video.onseeked = () => {
            // 在 canvas 上绘制封面图
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(video, 0, 0);
                const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
                
                setMainVideoInfo({
                    width: video.videoWidth,
                    height: video.videoHeight,
                    isVertical: video.videoHeight > video.videoWidth,
                    thumbnailUrl,
                    duration: videoDuration, // ★ 添加视频时长
                });
            }
            URL.revokeObjectURL(url);
        };

        video.onerror = () => {
            log('获取视频信息失败');
            URL.revokeObjectURL(url);
        };

        video.src = url;

        return () => {
            URL.revokeObjectURL(url);
        };
    }, [selectedFiles]);

    // 加载口癖数据
    const loadDefillerData = async (sid: string, options?: {
        // ★★★ 三选项参数 ★★★
        cut_silences?: boolean;           // 删除静音片段
        cut_bad_takes?: boolean;          // 删除NG/重复片段
        remove_filler_words?: boolean;    // 删除口癖词
    }) => {
        try {
            const { detectFillers } = await import('@/features/editor/lib/workspace-api');
            const result = await detectFillers(sid, options);
            
            log('[Defiller] 后端返回:', {
                filler_words: result.filler_words?.length,
                silence_segments: result.silence_segments?.length,
                transcript_segments: result.transcript_segments?.length,
                // ★ V2: 新增字段
                clips_created: (result as { clips_created?: number }).clips_created,
                filler_clips_count: (result as { filler_clips_count?: number }).filler_clips_count,
            });
            
            // ★ V2: 保存后端直接创建的 clips
            const v2Result = result as { clips?: CreatedClipV2[] };
            if (v2Result.clips && v2Result.clips.length > 0) {
                log('[Defiller] ★ V2 模式：后端已创建 clips:', v2Result.clips.length);
                setCreatedClipsV2(v2Result.clips);
            }
            
            // ★ 后端 filler_words 包含 occurrences 数组，直接使用！
            interface ApiFillerWord {
                word: string;
                count: number;
                total_duration_ms: number;
                occurrences?: Array<{ start: number; end: number; asset_id?: string; text?: string }>;
            }
            
            // 加载口癖词汇统计（保留 occurrences）
            const fillerWordsData = result.filler_words.map((f: ApiFillerWord) => ({
                word: f.word,
                count: f.count,
                checked: true,
                totalDuration: f.total_duration_ms,
                occurrences: f.occurrences || [],
            }));
            setFillerWords(fillerWordsData);
            setTranscriptSegments(result.transcript_segments);
            
            // ★★★ 核心修复：直接从 filler_words.occurrences 生成 FillerSegment ★★★
            const segments: FillerSegment[] = [];
            let segmentIndex = 0;
            
            fillerWordsData.forEach((filler: FillerWord) => {
                // 每个 filler word 可能出现多次，从 occurrences 提取每次出现
                if (filler.occurrences && filler.occurrences.length > 0) {
                    filler.occurrences.forEach((occ: { start: number; end: number; asset_id?: string; text?: string }) => {
                        segments.push({
                            id: `filler-${segmentIndex++}`,
                            word: filler.word,
                            text: occ.text || '',
                            start: occ.start,
                            end: occ.end,
                            duration: occ.end - occ.start,
                        });
                    });
                }
            });
            
            // 补充：从静音片段提取换气/停顿
            result.silence_segments?.forEach((seg: { id?: string; start: number; end: number; silence_info?: { classification?: string; duration_ms?: number } }, idx: number) => {
                const classification = seg.silence_info?.classification;
                // 只收集换气和犹豫停顿
                if (classification === 'breath' || classification === 'hesitation') {
                    const exists = segments.some(s => 
                        Math.abs(s.start - seg.start) < 100 && Math.abs(s.end - seg.end) < 100
                    );
                    if (!exists) {
                        segments.push({
                            id: seg.id || `silence-${idx}`,
                            word: classification === 'breath' ? '换气' : '停顿',
                            text: '',
                            start: seg.start,
                            end: seg.end,
                            duration: seg.end - seg.start,
                        });
                    }
                }
            });
            
            const sortedSegments = segments.sort((a, b) => a.start - b.start);
            log('[Defiller] 生成片段:', sortedSegments.length, sortedSegments.slice(0, 3));
            setFillerSegments(sortedSegments);
            
            // ★★★ 初始化选中状态：默认全选所有片段 ★★★
            setSelectedSegmentIds(new Set(sortedSegments.map(s => s.id)));
            
            // 尝试从结果中获取 asset_id 用于视频预览
            const firstSegment = result.transcript_segments?.[0];
            if (firstSegment?.asset_id) {
                setAssetId(firstSegment.asset_id);
                const { getAssetProxyUrl } = await import('@/lib/api/media-proxy');
                setVideoUrl(getAssetProxyUrl(firstSegment.asset_id));
            }
        } catch (err) {
            log('加载口癖数据失败:', err);
            setError('加载口癖数据失败');
        }
    };

    // ==========================================
    // Step 1: Upload handlers
    // ==========================================
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files).filter(
            file => file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm|avi|mkv)$/i)
        );
        if (files.length > 0) setSelectedFiles(prev => [...prev, ...files]);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) setSelectedFiles(prev => [...prev, ...files]);
        e.target.value = '';
    };

    const handleRemoveFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const handleUpload = async () => {
        if (selectedFiles.length === 0) return;

        // ★ 验证用户已选择比例
        if (!requireAspectRatio()) {
            return;
        }

        setIsUploading(true);
        setError(null);
        setUploadProgress(0);
        setUploadPhase('uploading');

        try {
            const { createSession, uploadMultipleFiles, finalizeUpload } = await import('@/features/editor/lib/workspace-api');
            const { getVideoDuration } = await import('@/features/editor/lib/media-cache');

            // 提取视频时长
            const filesInfo = await Promise.all(
                selectedFiles.map(async (file, index) => {
                    let duration: number | undefined;
                    try {
                        const durationMs = await getVideoDuration(file);
                        duration = durationMs / 1000;
                    } catch (e) {
                        log('无法提取视频时长:', e);
                    }
                    return {
                        name: file.name,
                        size: file.size,
                        content_type: file.type || 'video/mp4',
                        duration,
                        order_index: index,
                    };
                })
            );

            // 创建会话
            const sessionResponse = await createSession({
                source_type: 'local',
                task_type: 'voice-extract',
                files: filesInfo,
                aspect_ratio: aspectRatio!,  // ★ 传递用户选择的目标比例
            });

            setSessionId(sessionResponse.session_id);
            setProjectId(sessionResponse.project_id);

            // 上传文件
            if (sessionResponse.assets && sessionResponse.assets.length > 0) {
                await uploadMultipleFiles(
                    selectedFiles,
                    sessionResponse.assets,
                    sessionResponse.session_id,
                    undefined,
                    (percent: number) => {
                        setUploadProgress(percent);
                        if (percent >= 100) setUploadPhase('processing');
                    }
                );
                setUploadPhase('ready');
            }

            // 完成上传
            await finalizeUpload(sessionResponse.session_id);

            // ★★★ 保存 B-Roll 配置到后端（如果启用）★★★
            if (entryMode === 'refine' && brollConfig.enabled) {
                try {
                    const { authFetch } = await import('@/lib/supabase/session');
                    await authFetch(`/api/workspace/sessions/${sessionResponse.session_id}/workflow-config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            broll_enabled: brollConfig.enabled,
                            broll_display_mode: brollConfig.displayMode,
                            broll_pip_config: brollConfig.displayMode !== 'fullscreen' ? {
                                size: brollConfig.pipConfig.size,
                                default_position: brollConfig.pipConfig.defaultPosition,
                                face_avoidance: brollConfig.pipConfig.faceAvoidance,
                                margin: brollConfig.pipConfig.margin,
                                border_radius: brollConfig.pipConfig.borderRadius,
                            } : null,
                            broll_mixed_config: brollConfig.displayMode === 'mixed' ? {
                                fullscreen_min_duration: brollConfig.mixedConfig.fullscreenMinDuration,
                                pip_min_duration: brollConfig.mixedConfig.pipMinDuration,
                                pip_ratio: brollConfig.mixedConfig.pipRatio,
                            } : null,
                        }),
                    });
                    log('[BRollConfig] 配置已保存:', brollConfig);
                } catch (configErr) {
                    log('[BRollConfig] 保存配置失败（非致命）:', configErr);
                }
            }

            // ★★★ 根据开关状态决定下一步 ★★★
            if (entryMode === 'refine') {
                if (!enableSmartClip && !enableBroll) {
                    // 两个都关：直接进编辑器
                    log('[Workflow] 智能剪辑关 + B-Roll关 → 直接进编辑器');
                    router.push(`/editor?project=${sessionResponse.project_id}`);
                } else if (!enableSmartClip && enableBroll) {
                    // 智能剪辑关，B-Roll开：直接进入 AI 视觉工作室
                    log('[Workflow] 智能剪辑关 + B-Roll开 → AI视觉工作室');
                    // ★★★ 直接跳转，避免 React 状态更新的竞态条件 ★★★
                    const strategy = shotStrategy || 'scene';
                    router.push(`/visual-editor?project=${sessionResponse.project_id}&session=${sessionResponse.session_id}&strategy=${strategy}`);
                } else {
                    // 智能剪辑开：进入分析步骤
                    log('[Workflow] 智能剪辑开 → 智能分析');
                    await updateStep('processing', sessionResponse.session_id);
                    await startProcessing(sessionResponse.session_id, {
                        cut_silences: configCutSilences,
                        cut_bad_takes: configCutBadTakes,
                        remove_filler_words: configRemoveFillers,
                    });
                }
            } else {
                // AI 模式保持原样
                await updateStep('processing', sessionResponse.session_id);
                await startProcessing(sessionResponse.session_id);
            }

        } catch (err: unknown) {
            log('上传失败:', err);
            const error = err as { message?: string };
            setError(error.message || '上传失败');
        } finally {
            setIsUploading(false);
        }
    };

    // ==========================================
    // Step 2: Processing
    // ==========================================
    const startProcessing = async (sid: string, analysisOptions?: {
        // ★★★ 三选项参数 ★★★
        cut_silences?: boolean;           // 删除静音片段
        cut_bad_takes?: boolean;          // 删除NG/重复片段
        remove_filler_words?: boolean;    // 删除口癖词
    }) => {
        setProcessingStatus('正在转写音频...');
        
        try {
            if (entryMode === 'refine') {
                // 口播精修：调用 detectFillers
                setProcessingStatus('正在检测口癖废话...');
                
                // 直接调用 loadDefillerData 来加载所有数据，传递配置选项
                await loadDefillerData(sid, analysisOptions);

                // 进入 defiller 步骤
                await updateStep('defiller', sid);
            } else {
                // AI 智能播报：调用 startAIProcessing
                setProcessingStatus('AI 正在处理...');
                const { startAIProcessing } = await import('@/features/editor/lib/workspace-api');
                await startAIProcessing(sid, { task_type: 'ai-create' });

                // 完成后直接进入编辑器
                router.push(`/editor?project=${projectId}`);
            }
        } catch (err: unknown) {
            log('处理失败:', err);
            const error = err as { message?: string };
            setError(error.message || '处理失败');
        }
    };

    // ==========================================
    // Step 3: Defiller handlers
    // ==========================================
    const toggleFiller = (word: string) => {
        setFillerWords(prev =>
            prev.map(f => f.word === word ? { ...f, checked: !f.checked } : f)
        );
    };

    const toggleAllFillers = () => {
        const allChecked = fillerWords.every(f => f.checked);
        setFillerWords(prev => prev.map(f => ({ ...f, checked: !allChecked })));
    };

    // ★★★ 新增：片段级别的选择函数 ★★★
    const toggleSegmentSelection = (segmentId: string) => {
        setSelectedSegmentIds(prev => {
            const next = new Set(prev);
            if (next.has(segmentId)) {
                next.delete(segmentId);
            } else {
                next.add(segmentId);
            }
            return next;
        });
    };

    // ★★★ 新增：全选/取消全选当前显示的片段 ★★★
    const toggleAllSegments = (displaySegments: FillerSegment[]) => {
        const displayIds = displaySegments.map(s => s.id);
        const allSelected = displayIds.every(id => selectedSegmentIds.has(id));
        
        setSelectedSegmentIds(prev => {
            const next = new Set(prev);
            displayIds.forEach(id => {
                if (allSelected) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
            });
            return next;
        });
    };

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${Math.round(ms)}ms`;
        const totalSec = ms / 1000;
        if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
        const min = Math.floor(totalSec / 60);
        const sec = Math.round(totalSec % 60);
        return `${min}分${sec}秒`;
    };

    const formatTime = (ms: number) => {
        const sec = ms / 1000;
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const ms100 = Math.floor((sec % 1) * 100);
        return `${m}:${s.toString().padStart(2, '0')}.${ms100.toString().padStart(2, '0')}`;
    };

    const getFillerStats = () => {
        // ★★★ 使用 selectedSegmentIds 计算统计 ★★★
        const selectedSegments = fillerSegments.filter(seg => selectedSegmentIds.has(seg.id));
        return {
            totalCount: selectedSegments.length,
            totalDuration: selectedSegments.reduce((sum, seg) => sum + seg.duration, 0),
            segmentCount: selectedSegments.length,
        };
    };

    // 视频预览控制
    const CONTEXT_DURATION = 2000; // 前后各2秒
    
    const handlePreviewSegment = (segment: FillerSegment | null) => {
        setActiveFillerSegment(segment);
        setIsVideoPlaying(false);
        if (segment && videoRef.current) {
            const startTime = Math.max(0, (segment.start - CONTEXT_DURATION) / 1000);
            videoRef.current.currentTime = startTime;
        }
    };

    const handlePlayPreview = () => {
        if (!videoRef.current || !activeFillerSegment) return;
        
        if (isVideoPlaying) {
            videoRef.current.pause();
            setIsVideoPlaying(false);
        } else {
            // 从 start - 2s 开始播放
            const startTime = Math.max(0, (activeFillerSegment.start - CONTEXT_DURATION) / 1000);
            videoRef.current.currentTime = startTime;
            videoRef.current.play();
            setIsVideoPlaying(true);
        }
    };


    // 监听视频播放进度（defiller 步骤）
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        
        // 获取当前预览的时间范围
        let previewStart = 0;
        let previewEnd = 0;
        
        if (currentStep === 'defiller' && activeFillerSegment) {
            previewStart = Math.max(0, activeFillerSegment.start - CONTEXT_DURATION);
            previewEnd = activeFillerSegment.end + CONTEXT_DURATION;
        }
        
        if (previewEnd === 0) return;

        const handleTimeUpdate = () => {
            const currentMs = video.currentTime * 1000;
            const totalDuration = previewEnd - previewStart;
            
            // 计算进度
            const progress = Math.min(100, Math.max(0, ((currentMs - previewStart) / totalDuration) * 100));
            setVideoProgress(progress);
            
            // 到达结束点时停止
            if (currentMs >= previewEnd) {
                video.pause();
                setIsVideoPlaying(false);
            }
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        return () => video.removeEventListener('timeupdate', handleTimeUpdate);
    }, [activeFillerSegment, currentStep]);

    const handleApplyTrim = async () => {
        setIsApplyingTrim(true);
        setError(null);

        try {
            // ★★★ 获取用户选中的片段 ★★★
            const selectedSegments = fillerSegments.filter(seg => selectedSegmentIds.has(seg.id));
            log('[Trim] 用户选中的片段:', selectedSegments.length, selectedSegments.map(s => s.id));
            
            // ★ V2: 检查是否有后端创建的 clips（智能分析阶段已创建）
            if (createdClipsV2.length > 0) {
                log('[V2] 使用 applyTrimmingV2，已有 clips:', createdClipsV2.length);
                
                // ★★★ V2: 基于 selectedSegmentIds 收集需要隐藏的 clip IDs ★★★
                // 需要根据时间匹配 fillerSegments 和 createdClipsV2
                const clipIdsToHide = createdClipsV2
                    .filter(clip => {
                        if (!clip.is_filler) return false;
                        // 查找对应的 fillerSegment
                        const matchingSegment = fillerSegments.find(seg => 
                            Math.abs(seg.start - clip.start_time) < 100 && 
                            Math.abs(seg.end - clip.end_time) < 100
                        );
                        // 只有用户选中的片段才隐藏
                        return matchingSegment && selectedSegmentIds.has(matchingSegment.id);
                    })
                    .map(clip => clip.id);
                
                log('[V2] 需要隐藏的 clips:', clipIdsToHide.length, clipIdsToHide.slice(0, 5));
                
                const { applyTrimmingV2 } = await import('@/features/editor/lib/workspace-api');
                await applyTrimmingV2(sessionId, {
                    clip_ids_to_hide: clipIdsToHide,
                });
            } else {
                // ★ V1 兼容：旧流程（后端未返回 clips）
                log('[V1] 使用 applyTrimming 兼容模式');
                
                // ★★★ 基于 selectedSegmentIds 构建 trim_segments ★★★
                const trimSegments: Array<{ start: number; end: number }> = selectedSegments.map(seg => ({
                    start: seg.start,
                    end: seg.end,
                }));
                
                // 为了兼容性，还需要传递 removed_fillers（词汇列表）
                const removedFillerWords = Array.from(new Set(selectedSegments.map(seg => seg.word)));
                
                log('应用修剪:', { removedFillerWords, trimSegmentsCount: trimSegments.length, trimSegments });
                
                if (trimSegments.length === 0) {
                    log('无需修剪的片段，直接进入编辑器');
                }
                
                // ★ 将 transcriptSegments 传递给后端
                const transcriptSegmentsForApi = transcriptSegments.map(seg => ({
                    id: seg.id,
                    text: seg.text,
                    start: seg.start,
                    end: seg.end,
                    asset_id: seg.assetId || '',  // 后端用 snake_case
                }));
                
                const { applyTrimming } = await import('@/features/editor/lib/workspace-api');
                await applyTrimming(sessionId, {
                    removed_fillers: removedFillerWords,
                    trim_segments: trimSegments,
                    transcript_segments: transcriptSegmentsForApi,
                    create_clips_from_segments: true,
                    // ★★★ 新增：直接传递选中的片段 ID ★★★
                    segment_ids_to_remove: Array.from(selectedSegmentIds),
                });
            }

            // ★★★ 根据 B-Roll 开关决定下一步 ★★★
            if (enableBroll) {
                // B-Roll 开启：进入 AI 视觉工作室
                log('[Workflow] 口癖修剪完成 + B-Roll开 → AI视觉工作室');
                const strategy = shotStrategy || 'scene';
                router.push(`/visual-editor?project=${projectId}&session=${sessionId}&strategy=${strategy}`);
            } else {
                // B-Roll 关闭：直接进入编辑器
                log('[Workflow] 口癖修剪完成 + B-Roll关 → 直接进编辑器');
                router.push(`/editor?project=${projectId}`);
            }

        } catch (err: unknown) {
            log('修剪失败:', err);
            const error = err as { message?: string };
            setError(error.message || '修剪失败');
        } finally {
            setIsApplyingTrim(false);
        }
    };

    // ==========================================
    // Navigation
    // ==========================================
    const handleBack = () => {
        if (currentStep === 'upload') {
            setCurrentStep('entry');
            setSelectedFiles([]);
        } else if (currentStep === 'processing') {
            // 处理中不允许返回
        } else if (currentStep === 'defiller') {
            // ★ 从修剪返回会重新上传，清理状态
            setCurrentStep('upload');
        } else if (currentStep === 'visual-studio') {
            // ★ 从 AI 视觉工作室返回
            if (enableSmartClip) {
                // 如果智能剪辑开启，返回到口癖修剪
                setCurrentStep('defiller');
            } else {
                // 否则返回到上传
                setCurrentStep('upload');
            }
        }
    };

    const requireAspectRatio = () => {
        if (!aspectRatio) {
            setAspectRatioError('请选择视频比例（仅支持 9:16 或 16:9）');
            return false;
        }
        return true;
    };

    if (!isOpen) return null;

    // ==========================================
    // Render Entry Step
    // ==========================================
    if (currentStep === 'entry') {
        return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
                    {/* Header */}
                    <div className="p-8 pb-6 flex items-center justify-between relative">
                        <div className="text-center flex-1">
                            <h2 className="text-2xl font-black text-gray-900">选择创作模式</h2>
                            <p className="text-sm text-gray-500 mt-1">AI 将根据您的选择优化处理流程</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors absolute right-6 top-6"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Entry Mode Cards */}
                    <div className="px-8 pb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* AI 智能播报 */}
                        <div
                            onClick={() => {
                                setEntryMode('ai-talk');
                                setCurrentStep('upload');
                            }}
                            className="group relative p-6 bg-gray-50 border-2 border-transparent hover:border-gray-400 rounded-2xl cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02]"
                        >
                            <div className="w-14 h-14 bg-gray-800 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform">
                                <Sparkles size={28} className="text-white" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">AI 智能播报</h3>
                            <p className="text-sm text-gray-600 leading-relaxed">
                                喂入文案，AI 将自动切分 Clip 并匹配 B-roll 素材
                            </p>
                            <div className="mt-4 flex items-center text-xs text-gray-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                <span>开始创作</span>
                                <ChevronRight size={14} className="ml-1" />
                            </div>
                        </div>

                        {/* 口播视频精修 */}
                        <div
                            onClick={() => {
                                setEntryMode('refine');
                                setCurrentStep('upload');
                            }}
                            className="group relative p-6 bg-gray-50 border-2 border-transparent hover:border-gray-400 rounded-2xl cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02]"
                        >
                            <div className="w-14 h-14 bg-gray-800 rounded-2xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform">
                                <FileVideo size={28} className="text-white" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">口播视频精修</h3>
                            <p className="text-sm text-gray-600 leading-relaxed">
                                上传口播视频，AI 识别口癖废话并智能切片
                            </p>
                            <div className="mt-4 flex items-center text-xs text-gray-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                <span>开始精修</span>
                                <ChevronRight size={14} className="ml-1" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // Render Upload Step - AI 智能播报模式
    // ==========================================
    if (currentStep === 'upload' && entryMode === 'ai-talk') {
        return (
            <SmartBroadcastStep
                onClose={onClose}
                onBack={handleBack}
                isUploading={isUploading}
                currentStep={currentStep}
                entryMode={entryMode}
            />
        );
    }

    // ==========================================
    // Render Upload Step - 口播视频精修模式
    // ==========================================
    if (currentStep === 'upload') {
        return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
                    {/* Step Indicator - 在弹窗内部，带圆角 */}
                    <div className="rounded-t-2xl overflow-hidden">
                        <StepIndicator currentStep={currentStep} mode={entryMode} enableSmartClip={enableSmartClip} enableBroll={enableBroll} />
                    </div>

                    {/* Header */}
                    <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleBack}
                                disabled={isUploading}
                                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
                            >
                                <ArrowLeft size={18} />
                            </button>
                            <div>
                                <h2 className="text-base font-bold text-gray-900">上传视频</h2>
                                <p className="text-[11px] text-gray-500">
                                    {entryMode === 'ai-talk' ? 'AI 智能播报模式' : '口播视频精修模式'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handlePause}
                            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors"
                            title="暂时关闭"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Upload Area */}
                    <div className="flex-1 px-5 py-4 space-y-3">
                        <div
                            onClick={() => !isUploading && fileInputRef.current?.click()}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            className={cn(
                                "relative border-2 border-dashed rounded-xl py-10 flex flex-col items-center justify-center transition-all duration-200 group",
                                isUploading ? "pointer-events-none" : "cursor-pointer",
                                isDragging ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:border-gray-400 hover:bg-gray-50",
                                selectedFiles.length > 0 ? "py-4 border-solid border-gray-200 bg-gray-50" : ""
                            )}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="video/*,.mp4,.mov,.webm,.avi,.mkv"
                                multiple
                                className="hidden"
                                onChange={handleFileSelect}
                                disabled={isUploading}
                            />

                            {selectedFiles.length === 0 ? (
                                <>
                                    <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-white group-hover:scale-110 transition-all">
                                        <Upload size={20} className="text-gray-900" />
                                    </div>
                                    <p className="text-sm text-gray-900 font-medium">点击或拖拽上传视频</p>
                                    <p className="text-xs text-gray-500 mt-1">支持多文件拼接</p>
                                </>
                            ) : (
                                <div className="flex flex-col items-center">
                                    <p className="text-sm font-medium text-gray-900 flex items-center">
                                        <Upload size={14} className="mr-1.5" />
                                        继续添加文件
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* File List */}
                        {selectedFiles.length > 0 && (
                            <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                {selectedFiles.map((file, index) => (
                                    <div key={`${file.name}-${index}`} className="flex items-center p-3 bg-gray-50 rounded-xl border border-gray-100 group hover:border-gray-200 transition-colors">
                                        <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center border border-gray-200 flex-shrink-0 text-gray-400">
                                            <FileVideo size={16} />
                                        </div>
                                        <div className="ml-3 flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                                            <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                                        </div>
                                        {!isUploading && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleRemoveFile(index); }}
                                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Upload Progress */}
                        {isUploading && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-600 font-medium">
                                        {uploadPhase === 'uploading' && '上传中...'}
                                        {uploadPhase === 'processing' && '✨ 视频处理中...'}
                                        {uploadPhase === 'ready' && '✅ 处理完成'}
                                    </span>
                                    <span className="text-gray-900 font-bold">
                                        {uploadPhase === 'uploading' ? `${uploadProgress}%` : ''}
                                    </span>
                                </div>
                                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                        className={cn(
                                            "h-full transition-all duration-300",
                                            uploadPhase === 'processing' ? "bg-gray-400 animate-pulse" : "bg-gray-900"
                                        )}
                                        style={{ width: uploadPhase === 'uploading' ? `${uploadProgress}%` : '100%' }}
                                    />
                                </div>
                            </div>
                        )}
                        
                        {/* ★★★ 视频比例选择 ★★★ */}
                        {!isUploading && (
                            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-bold text-gray-900">选择视频比例</p>
                                        <p className="text-xs text-gray-500 mt-0.5">仅支持 9:16 或 16:9</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAspectRatio('9:16');
                                                setAspectRatioError(null);
                                            }}
                                            className={cn(
                                                "px-4 py-2 rounded-lg text-sm font-bold border transition-all",
                                                aspectRatio === '9:16'
                                                    ? "bg-gray-900 text-white border-gray-900"
                                                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                                            )}
                                        >
                                            9:16 竖屏
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAspectRatio('16:9');
                                                setAspectRatioError(null);
                                            }}
                                            className={cn(
                                                "px-4 py-2 rounded-lg text-sm font-bold border transition-all",
                                                aspectRatio === '16:9'
                                                    ? "bg-gray-900 text-white border-gray-900"
                                                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                                            )}
                                        >
                                            16:9 横屏
                                        </button>
                                    </div>
                                </div>
                                {aspectRatioError && (
                                    <p className="text-xs text-red-500 mt-2">{aspectRatioError}</p>
                                )}
                            </div>
                        )}
                        
                        {/* ★★★ 功能配置区域（两个主开关）★★★ */}
                        {entryMode === 'refine' && !isUploading && (
                            <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                                {/* 主开关1: 智能剪辑 */}
                                <div>
                                    <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 bg-gray-900 rounded-lg flex items-center justify-center">
                                                <Sparkles size={18} className="text-white" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-900">智能剪辑</p>
                                                <p className="text-xs text-gray-400">AI 识别并删除废话、静音、NG 片段</p>
                                            </div>
                                        </div>
                                        <div className={cn(
                                            "w-11 h-6 rounded-full transition-colors relative",
                                            enableSmartClip ? "bg-gray-900" : "bg-gray-300"
                                        )}>
                                            <div className={cn(
                                                "w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform",
                                                enableSmartClip ? "translate-x-[22px]" : "translate-x-0.5"
                                            )} />
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={enableSmartClip}
                                            onChange={(e) => setEnableSmartClip(e.target.checked)}
                                            className="sr-only"
                                        />
                                    </label>
                                    
                                    {/* 智能剪辑子选项（仅当开启时显示）*/}
                                    {enableSmartClip && (
                                        <div className="ml-4 mt-2 pl-4 border-l-2 border-gray-200 space-y-2">
                                            {/* 子选项1: 删除静音 */}
                                            <label className="flex items-center justify-between p-2.5 bg-white rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                                <div className="flex items-center gap-2.5">
                                                    <Volume2 size={16} className="text-gray-500" />
                                                    <span className="text-sm text-gray-700">删除静音片段</span>
                                                </div>
                                                <div className={cn(
                                                    "w-9 h-5 rounded-full transition-colors relative",
                                                    configCutSilences ? "bg-gray-900" : "bg-gray-300"
                                                )}>
                                                    <div className={cn(
                                                        "w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform",
                                                        configCutSilences ? "translate-x-[18px]" : "translate-x-0.5"
                                                    )} />
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={configCutSilences}
                                                    onChange={(e) => setConfigCutSilences(e.target.checked)}
                                                    className="sr-only"
                                                />
                                            </label>
                                            
                                            {/* 子选项2: 删除NG */}
                                            <label className="flex items-center justify-between p-2.5 bg-white rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                                <div className="flex items-center gap-2.5">
                                                    <RefreshCw size={16} className="text-gray-500" />
                                                    <span className="text-sm text-gray-700">删除重复/NG片段</span>
                                                </div>
                                                <div className={cn(
                                                    "w-9 h-5 rounded-full transition-colors relative",
                                                    configCutBadTakes ? "bg-gray-900" : "bg-gray-300"
                                                )}>
                                                    <div className={cn(
                                                        "w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform",
                                                        configCutBadTakes ? "translate-x-[18px]" : "translate-x-0.5"
                                                    )} />
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={configCutBadTakes}
                                                    onChange={(e) => setConfigCutBadTakes(e.target.checked)}
                                                    className="sr-only"
                                                />
                                            </label>
                                            
                                            {/* 子选项3: 删除口癖 */}
                                            <label className="flex items-center justify-between p-2.5 bg-white rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                                <div className="flex items-center gap-2.5">
                                                    <MessageSquare size={16} className="text-gray-500" />
                                                    <span className="text-sm text-gray-700">删除口癖词</span>
                                                </div>
                                                <div className={cn(
                                                    "w-9 h-5 rounded-full transition-colors relative",
                                                    configRemoveFillers ? "bg-gray-900" : "bg-gray-300"
                                                )}>
                                                    <div className={cn(
                                                        "w-4 h-4 bg-white rounded-full shadow absolute top-0.5 transition-transform",
                                                        configRemoveFillers ? "translate-x-[18px]" : "translate-x-0.5"
                                                    )} />
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={configRemoveFillers}
                                                    onChange={(e) => setConfigRemoveFillers(e.target.checked)}
                                                    className="sr-only"
                                                />
                                            </label>
                                        </div>
                                    )}
                                </div>
                                
                                {/* 主开关2: AI 视觉 / 分镜策略选择 */}
                                <div className="bg-gray-50 rounded-xl overflow-hidden">
                                    {/* 总开关 */}
                                    <label className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-100 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 bg-gray-900 rounded-lg flex items-center justify-center">
                                                <Film size={18} className="text-white" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-900">AI 视觉工作室</p>
                                                <p className="text-xs text-gray-400">智能分镜 + 背景替换 + B-Roll</p>
                                            </div>
                                        </div>
                                        <div className={cn(
                                            "w-11 h-6 rounded-full transition-colors relative",
                                            enableBroll ? "bg-gray-900" : "bg-gray-300"
                                        )}>
                                            <div className={cn(
                                                "w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform",
                                                enableBroll ? "translate-x-[22px]" : "translate-x-0.5"
                                            )} />
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={enableBroll}
                                            onChange={(e) => {
                                                setEnableBroll(e.target.checked);
                                                // 默认选择场景拆分
                                                if (e.target.checked && !shotStrategy) {
                                                    setShotStrategy('scene');
                                                }
                                            }}
                                            className="sr-only"
                                        />
                                    </label>
                                    
                                    {/* 分镜策略选择 - 开启时显示 */}
                                    {enableBroll && (
                                        <div className="px-3 pb-3 pt-1 border-t border-gray-100">
                                            <p className="text-xs text-gray-500 mb-2 pl-1">选择分镜拆分策略</p>
                                            <div className="grid grid-cols-3 gap-2">
                                                {/* 场景拆分 */}
                                                <button
                                                    type="button"
                                                    onClick={() => setShotStrategy('scene')}
                                                    className={cn(
                                                        "p-2.5 rounded-lg border text-left transition-all",
                                                        shotStrategy === 'scene'
                                                            ? "bg-gray-900 border-gray-900 text-white"
                                                            : "bg-white border-gray-200 hover:border-gray-400"
                                                    )}
                                                >
                                                    <Film size={16} className={shotStrategy === 'scene' ? "text-white mb-1" : "text-gray-500 mb-1"} />
                                                    <p className={cn("text-xs font-bold", shotStrategy === 'scene' ? "text-white" : "text-gray-900")}>
                                                        场景拆分
                                                    </p>
                                                    <p className={cn("text-[10px] mt-0.5", shotStrategy === 'scene' ? "text-gray-300" : "text-gray-400")}>
                                                        画面变化检测
                                                    </p>
                                                </button>
                                                
                                                {/* 按句拆分 */}
                                                <button
                                                    type="button"
                                                    onClick={() => setShotStrategy('sentence')}
                                                    className={cn(
                                                        "p-2.5 rounded-lg border text-left transition-all",
                                                        shotStrategy === 'sentence'
                                                            ? "bg-gray-900 border-gray-900 text-white"
                                                            : "bg-white border-gray-200 hover:border-gray-400"
                                                    )}
                                                >
                                                    <MessageSquare size={16} className={shotStrategy === 'sentence' ? "text-white mb-1" : "text-gray-500 mb-1"} />
                                                    <p className={cn("text-xs font-bold", shotStrategy === 'sentence' ? "text-white" : "text-gray-900")}>
                                                        按句拆分
                                                    </p>
                                                    <p className={cn("text-[10px] mt-0.5", shotStrategy === 'sentence' ? "text-gray-300" : "text-gray-400")}>
                                                        每句话一分镜
                                                    </p>
                                                </button>
                                                
                                                {/* 按段落拆分 */}
                                                <button
                                                    type="button"
                                                    onClick={() => setShotStrategy('paragraph')}
                                                    className={cn(
                                                        "p-2.5 rounded-lg border text-left transition-all",
                                                        shotStrategy === 'paragraph'
                                                            ? "bg-gray-900 border-gray-900 text-white"
                                                            : "bg-white border-gray-200 hover:border-gray-400"
                                                    )}
                                                >
                                                    <FileText size={16} className={shotStrategy === 'paragraph' ? "text-white mb-1" : "text-gray-500 mb-1"} />
                                                    <p className={cn("text-xs font-bold", shotStrategy === 'paragraph' ? "text-white" : "text-gray-900")}>
                                                        段落拆分
                                                    </p>
                                                    <p className={cn("text-[10px] mt-0.5", shotStrategy === 'paragraph' ? "text-gray-300" : "text-gray-400")}>
                                                        按主题分组
                                                    </p>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-5 pb-5">
                        {error && (
                            <div className="mb-3 p-2.5 bg-red-50 border border-red-100 text-red-600 text-xs rounded-lg">
                                ⚠️ {error}
                            </div>
                        )}

                        <button
                            onClick={handleUpload}
                            disabled={selectedFiles.length === 0 || isUploading}
                            className={cn(
                                "w-full h-10 text-sm font-bold text-white rounded-xl shadow-lg transition-all flex items-center justify-center gap-2",
                                selectedFiles.length > 0 && !isUploading
                                    ? "bg-gray-900 hover:bg-gray-800"
                                    : "bg-gray-300 cursor-not-allowed"
                            )}
                        >
                            {isUploading ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    {uploadPhase === 'uploading' && '上传中...'}
                                    {uploadPhase === 'processing' && '处理中...'}
                                    {uploadPhase === 'ready' && '准备就绪'}
                                </>
                            ) : (
                                <>
                                    <Sparkles size={16} />
                                    {!enableSmartClip && !enableBroll ? '上传并进入编辑器' : '上传并开始处理'}
                                </>
                            )}
                        </button>

                        <p className="text-[10px] text-gray-400 text-center mt-3">
                            上传视频不消耗积分，AI 处理时消耗
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // Render Processing Step
    // ==========================================
    if (currentStep === 'processing') {
        return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
                    {/* Step Indicator */}
                    <div className="rounded-t-2xl overflow-hidden">
                        <StepIndicator currentStep={currentStep} mode={entryMode} enableSmartClip={enableSmartClip} enableBroll={enableBroll} />
                    </div>

                    {/* Content */}
                    <div className="p-10 flex flex-col items-center justify-center">
                        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-6">
                            <Loader2 size={32} className="text-gray-600 animate-spin" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-2">智能分析中</h3>
                        <p className="text-sm text-gray-500 text-center">{processingStatus}</p>
                        
                        {error && (
                            <div className="mt-4 p-3 bg-red-50 border border-red-100 text-red-600 text-xs rounded-lg">
                                ⚠️ {error}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // Render Defiller Step
    // ==========================================
    if (currentStep === 'defiller') {
        const stats = getFillerStats();
        
        // ★ 简化逻辑：直接根据选中的口癖词过滤 fillerSegments
        const checkedWords = fillerWords.filter(f => f.checked).map(f => f.word);
        
        // fillerSegments 已经从 filler_words.occurrences 生成，直接过滤即可
        const displaySegments = fillerSegments.filter(seg => 
            checkedWords.some(word => seg.word === word)
        );
        
        log('[Defiller] displaySegments:', {
            total: fillerSegments.length,
            display: displaySegments.length,
            checkedWords,
        });

        return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
                    {/* Step Indicator */}
                    <div className="rounded-t-2xl overflow-hidden flex-shrink-0">
                        <StepIndicator currentStep={currentStep} mode={entryMode} enableSmartClip={enableSmartClip} enableBroll={enableBroll} />
                    </div>

                    {/* Header - 带返回按钮 */}
                    <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center flex-shrink-0">
                        <div className="flex items-center gap-4">
                            {/* 返回按钮 */}
                            <button
                                onClick={handleBack}
                                className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
                                title="返回上一步"
                            >
                                <ArrowLeft size={20} />
                            </button>
                            <div className="w-11 h-11 bg-gray-800 rounded-xl flex items-center justify-center">
                                <Scissors size={22} className="text-white" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">语义修剪</h3>
                                <p className="text-gray-500 text-sm">
                                    检测到 <span className="font-bold text-gray-700">{stats.totalCount}</span> 处口癖，
                                    预计节省 <span className="font-bold text-gray-700">{formatDuration(stats.totalDuration)}</span>
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handlePause}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="暂时关闭"
                        >
                            <X size={20} className="text-gray-500" />
                        </button>
                    </div>

                    {/* Content - 左宽右窄布局 */}
                    <div className="flex-1 flex overflow-hidden min-h-0">
                        {/* 左侧：视频预览 (60%) */}
                        <div className="w-[60%] border-r border-gray-100 flex flex-col bg-gray-900 flex-shrink-0">
                            {/* 视频预览区域 - 限制最大高度 */}
                            <div className="flex-1 relative flex items-center justify-center min-h-0 max-h-[400px]">
                                {videoUrl ? (
                                    <>
                                        <video
                                            ref={videoRef}
                                            src={videoUrl}
                                            className="max-w-full max-h-full object-contain"
                                            playsInline
                                            preload="auto"
                                        />
                                        {/* 播放控制遮罩 */}
                                        {activeFillerSegment && (
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <button
                                                    onClick={handlePlayPreview}
                                                    className="w-16 h-16 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105"
                                                >
                                                    {isVideoPlaying ? (
                                                        <Pause size={28} className="text-gray-900" />
                                                    ) : (
                                                        <Play size={28} className="text-gray-900 ml-1" />
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                        {/* 进度条 */}
                                        {activeFillerSegment && (
                                            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                                                <div className="flex items-center gap-3 mb-3">
                                                    <span className="text-white/80 text-xs font-mono">
                                                        {formatTime(Math.max(0, activeFillerSegment.start - CONTEXT_DURATION))}
                                                    </span>
                                                    <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                                                        <div className="relative w-full h-full">
                                                            {/* 高亮区域（口癖片段） */}
                                                            <div 
                                                                className="absolute h-full bg-red-500/70"
                                                                style={{
                                                                    left: `${(CONTEXT_DURATION / (activeFillerSegment.duration + CONTEXT_DURATION * 2)) * 100}%`,
                                                                    width: `${(activeFillerSegment.duration / (activeFillerSegment.duration + CONTEXT_DURATION * 2)) * 100}%`,
                                                                }}
                                                            />
                                                            {/* 播放进度 */}
                                                            <div 
                                                                className="absolute h-full bg-white transition-all"
                                                                style={{ width: `${videoProgress}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <span className="text-white/80 text-xs font-mono">
                                                        {formatTime(activeFillerSegment.end + CONTEXT_DURATION)}
                                                    </span>
                                                </div>
                                                <div className="text-center">
                                                    <span className="inline-flex items-center gap-2 px-3 py-1 bg-red-500 text-white text-sm rounded-full font-medium">
                                                        <Wind size={14} />
                                                        {activeFillerSegment.word} · {formatDuration(activeFillerSegment.duration)}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="text-center text-gray-500">
                                        <Volume2 size={64} className="mx-auto mb-4 opacity-30" />
                                        <p className="text-lg font-medium">点击右侧片段预览</p>
                                        <p className="text-sm mt-1 opacity-70">查看前后2秒上下文</p>
                                    </div>
                                )}
                                
                                {!activeFillerSegment && videoUrl && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                        <div className="text-center text-white">
                                            <Play size={64} className="mx-auto mb-4 opacity-50" />
                                            <p className="text-lg font-medium">选择片段开始预览</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 口癖词选择区域 - 底部白色区域 */}
                            <div className="p-4 bg-white border-t border-gray-200">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-sm font-bold text-gray-700">口癖词汇筛选</span>
                                    <button
                                        onClick={toggleAllFillers}
                                        className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
                                    >
                                        {fillerWords.every(f => f.checked) ? '取消全选' : '全选'}
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {fillerWords.map(filler => (
                                        <button
                                            key={filler.word}
                                            onClick={() => toggleFiller(filler.word)}
                                            className={cn(
                                                "px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                                                filler.checked
                                                    ? "bg-gray-800 text-white shadow-md"
                                                    : "bg-gray-100 text-gray-400 line-through"
                                            )}
                                        >
                                            <span>{filler.word}</span>
                                            <span className={cn(
                                                "text-xs px-1.5 py-0.5 rounded",
                                                filler.checked ? "bg-white/20" : "bg-gray-200"
                                            )}>
                                                {filler.count}
                                            </span>
                                        </button>
                                    ))}
                                    {fillerWords.length === 0 && (
                                        <div className="text-sm text-gray-400 py-2">🎉 未检测到口癖词汇</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 右侧：片段列表 (40%) */}
                        <div className="flex-1 flex flex-col bg-white overflow-hidden">
                            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                                        <Trash2 size={16} className="text-red-500" />
                                    </div>
                                    <div>
                                        <span className="text-sm font-bold text-gray-800">检测到的片段</span>
                                        <span className="text-xs text-gray-400 ml-2">
                                            (已选 {displaySegments.filter(s => selectedSegmentIds.has(s.id)).length}/{displaySegments.length})
                                        </span>
                                    </div>
                                </div>
                                {/* ★★★ 全选/取消全选按钮 ★★★ */}
                                <button
                                    onClick={() => toggleAllSegments(displaySegments)}
                                    className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
                                >
                                    {displaySegments.every(s => selectedSegmentIds.has(s.id)) ? '取消全选' : '全选'}
                                </button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                {displaySegments.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
                                        <Check size={48} className="mb-3 opacity-30" />
                                        <p className="text-base font-medium">没有需要删除的片段</p>
                                        <p className="text-sm mt-1 opacity-70">视频内容很干净！</p>
                                    </div>
                                ) : (
                                    displaySegments.map((seg, idx) => {
                                        const isActive = activeFillerSegment?.id === seg.id;
                                        const isSelected = selectedSegmentIds.has(seg.id);
                                        return (
                                            <div
                                                key={seg.id}
                                                onClick={() => toggleSegmentSelection(seg.id)}
                                                className={cn(
                                                    "p-4 rounded-xl border-2 transition-all cursor-pointer",
                                                    isActive
                                                        ? "bg-gray-50 border-gray-800 shadow-lg"
                                                        : isSelected
                                                            ? "bg-white border-red-200 hover:border-red-300"
                                                            : "bg-gray-50 border-gray-100 hover:border-gray-200"
                                                )}
                                            >
                                                <div className="flex items-start gap-3">
                                                    {/* ★★★ 勾选框 ★★★ */}
                                                    <div
                                                        className={cn(
                                                            "w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-1 transition-all",
                                                            isSelected
                                                                ? "bg-red-500 border-red-500 text-white"
                                                                : "border-gray-300"
                                                        )}
                                                    >
                                                        {isSelected && <Check size={14} />}
                                                    </div>
                                                    
                                                    {/* 序号 */}
                                                    <div 
                                                        className={cn(
                                                            "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 cursor-pointer",
                                                            isActive ? "bg-gray-800 text-white" : "bg-red-100 text-red-600"
                                                        )}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handlePreviewSegment(isActive ? null : seg);
                                                        }}
                                                    >
                                                        {idx + 1}
                                                    </div>
                                                    
                                                    <div 
                                                        className="flex-1 min-w-0 cursor-pointer"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handlePreviewSegment(isActive ? null : seg);
                                                        }}
                                                    >
                                                        {/* 口癖词标签 + 时长 */}
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className={cn(
                                                                "px-2 py-1 text-xs rounded-md font-bold",
                                                                isSelected ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-500"
                                                            )}>
                                                                {seg.word}
                                                            </span>
                                                            <span className="text-sm text-gray-500 font-medium">
                                                                {formatDuration(seg.duration)}
                                                            </span>
                                                        </div>
                                                        
                                                        {/* 文字内容 */}
                                                        {seg.text && (
                                                            <p className={cn(
                                                                "text-sm mb-2 line-clamp-2",
                                                                isSelected ? "text-gray-600" : "text-gray-400"
                                                            )}>
                                                                "{seg.text}"
                                                            </p>
                                                        )}
                                                        
                                                        {/* 时间信息 + 预览按钮 */}
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs text-gray-400 font-mono">
                                                                {formatTime(seg.start)} → {formatTime(seg.end)}
                                                            </span>
                                                            <span className={cn(
                                                                "text-xs font-bold px-2 py-1 rounded",
                                                                isActive 
                                                                    ? "bg-gray-800 text-white" 
                                                                    : "bg-gray-100 text-gray-500"
                                                            )}>
                                                                {isActive ? '▶ 预览中' : '预览'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between flex-shrink-0">
                        {/* 左侧：错误提示 */}
                        <div className="flex items-center gap-4">
                            {error && (
                                <div className="text-sm text-red-500">⚠️ {error}</div>
                            )}
                        </div>

                        {/* 右侧：操作按钮 */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => {
                                    // 跳过修剪，直接去编辑器
                                    if (projectId) {
                                        router.push(`/editor?project=${projectId}`);
                                    }
                                }}
                                disabled={isApplyingTrim || !projectId}
                                className="px-5 py-2.5 text-gray-500 hover:text-gray-900 text-sm font-medium transition-colors"
                            >
                                跳过，直接编辑
                            </button>
                            <button
                                onClick={handleApplyTrim}
                                disabled={isApplyingTrim}
                                className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg transition-all"
                            >
                                {isApplyingTrim ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        处理中...
                                    </>
                                ) : (
                                    <>
                                        <Scissors size={18} />
                                        应用修剪
                                        {stats.totalCount > 0 && (
                                            <span className="bg-white/20 px-2 py-0.5 rounded text-xs">
                                                {stats.totalCount}处
                                            </span>
                                        )}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // Render AI Visual Studio Step
    // ==========================================
    if (currentStep === 'visual-studio') {
        // 策略已在上传时选好，显示加载状态，useEffect 会处理跳转
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 text-white animate-spin mx-auto mb-4" />
                    <p className="text-white/60">正在进入视觉编辑器...</p>
                </div>
            </div>
        );
    }

    return null;
}