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
    Film,
    Check,
    Loader2,
    Sparkles,
    User,
    Palette,
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
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { SmartBroadcastStep } from './SmartBroadcastStep';

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
export type WorkflowStep = 'entry' | 'upload' | 'config' | 'processing' | 'defiller' | 'broll_config';

export type EntryMode = 'ai-talk' | 'refine';

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

interface WorkflowModalProps {
    isOpen: boolean;
    onClose: () => void;
    // 如果有 resumeData，则从指定步骤恢复
    resumeData?: {
        sessionId: string;
        projectId: string;
        step: WorkflowStep;
        mode: EntryMode;
    };
}

// ==========================================
// 步骤指示器组件
// ==========================================
function StepIndicator({ 
    currentStep, 
    mode 
}: { 
    currentStep: WorkflowStep; 
    mode: EntryMode;
}) {
    const steps = mode === 'refine' 
        ? [
            { key: 'upload', label: '上传视频', icon: Upload },
            { key: 'config', label: '分析配置', icon: Palette },
            { key: 'processing', label: '智能分析', icon: Sparkles },
            { key: 'defiller', label: '口癖修剪', icon: Scissors },
            { key: 'broll_config', label: 'B-Roll', icon: Film },
        ]
        : [
            { key: 'upload', label: '上传素材', icon: Upload },
            { key: 'processing', label: 'AI 处理', icon: Sparkles },
        ];

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
export function WorkflowModal({ isOpen, onClose, resumeData }: WorkflowModalProps) {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // === 流程状态 ===
    const [currentStep, setCurrentStep] = useState<WorkflowStep>(resumeData?.step || 'entry');
    const [entryMode, setEntryMode] = useState<EntryMode>(resumeData?.mode || 'refine');

    // === Session 数据 ===
    const [sessionId, setSessionId] = useState<string>(resumeData?.sessionId || '');
    const [projectId, setProjectId] = useState<string>(resumeData?.projectId || '');

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
    const [showBRollChoice, setShowBRollChoice] = useState(false); // 显示B-Roll选择弹窗
    const [assetId, setAssetId] = useState<string>(''); // 视频资源ID用于预览
    const [videoUrl, setVideoUrl] = useState<string>(''); // 视频URL用于预览
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [videoProgress, setVideoProgress] = useState(0);

    // === Step Config: 分析配置选项 ===
    const [configEnableBroll, setConfigEnableBroll] = useState(true);
    const [configDetectFillers, setConfigDetectFillers] = useState(true);  // 识别口癖（含重复词）
    const [configDetectBreaths, setConfigDetectBreaths] = useState(true);  // 识别换气

    // === Step 4: B-Roll Config 状态 ===
    const [pipEnabled, setPipEnabled] = useState(true);
    const [brollEnabled, setBrollEnabled] = useState(true);
    const [clips, setClips] = useState<ClipSuggestion[]>([]);
    const [activeClipId, setActiveClipId] = useState<string | null>(null);
    const [isLoadingClips, setIsLoadingClips] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // === 通用状态 ===
    const [error, setError] = useState<string | null>(null);

    // 恢复流程
    useEffect(() => {
        if (resumeData) {
            setCurrentStep(resumeData.step);
            setEntryMode(resumeData.mode);
            setSessionId(resumeData.sessionId);
            setProjectId(resumeData.projectId);

            // 根据步骤加载数据
            if (resumeData.step === 'defiller') {
                loadDefillerData(resumeData.sessionId);
            } else if (resumeData.step === 'broll_config') {
                loadBRollData(resumeData.sessionId);
            }
        }
    }, [resumeData]);

    // 加载口癖数据
    const loadDefillerData = async (sid: string, options?: {
        detect_fillers?: boolean;
        detect_breaths?: boolean;
    }) => {
        try {
            const { detectFillers } = await import('@/features/editor/lib/workspace-api');
            const result = await detectFillers(sid, options);
            
            log('[Defiller] 后端返回:', {
                filler_words: result.filler_words?.length,
                silence_segments: result.silence_segments?.length,
                transcript_segments: result.transcript_segments?.length,
            });
            
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

    // 加载 B-Roll 数据
    const loadBRollData = async (sid: string) => {
        setIsLoadingClips(true);
        try {
            const { authFetch } = await import('@/lib/supabase/session');
            const response = await authFetch(`/api/workspace/sessions/${sid}/clip-suggestions`, {
                method: 'POST',
            });
            if (!response.ok) throw new Error('获取片段建议失败');
            const data = await response.json();
            setClips(data.clips?.map((clip: { clip_id: string; clip_number: number; text: string; time_range: { start: number; end: number }; suggested_assets?: { id: string; thumbnail_url: string; video_url: string; source: string; duration: number; width: number; height: number; relevance_score?: number }[]; selected_asset_id?: string }) => ({
                clipId: clip.clip_id,
                clipNumber: clip.clip_number,
                text: clip.text,
                timeRange: clip.time_range,
                suggestedAssets: (clip.suggested_assets || []).map((asset: { id: string; thumbnail_url: string; video_url: string; source: string; duration: number; width: number; height: number; relevance_score?: number }) => ({
                    id: asset.id,
                    thumbnailUrl: asset.thumbnail_url,
                    videoUrl: asset.video_url,
                    source: asset.source,
                    duration: asset.duration,
                    width: asset.width,
                    height: asset.height,
                    relevanceScore: asset.relevance_score,
                })),
                selectedAssetId: clip.selected_asset_id,
            })) || []);
        } catch (err) {
            log('加载 B-Roll 数据失败:', err);
        } finally {
            setIsLoadingClips(false);
        }
    };

    // 更新后端步骤状态
    const updateWorkflowStep = async (sid: string, step: WorkflowStep) => {
        try {
            const { authFetch } = await import('@/lib/supabase/session');
            await authFetch(`/api/workspace/sessions/${sid}/workflow-step`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow_step: step, entry_mode: entryMode }),
            });
        } catch (err) {
            log('更新工作流步骤失败:', err);
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

            // ★ 口播精修模式：进入配置步骤；AI模式：直接处理
            if (entryMode === 'refine') {
                setCurrentStep('config');
            } else {
                // 更新步骤状态
                await updateWorkflowStep(sessionResponse.session_id, 'processing');
                setCurrentStep('processing');
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
        detect_fillers?: boolean;
        detect_breaths?: boolean;
    }) => {
        setProcessingStatus('正在转写音频...');
        
        try {
            if (entryMode === 'refine') {
                // 口播精修：调用 detectFillers
                setProcessingStatus('正在检测口癖废话...');
                
                // 直接调用 loadDefillerData 来加载所有数据，传递配置选项
                await loadDefillerData(sid, analysisOptions);

                // 更新步骤状态并进入 defiller
                await updateWorkflowStep(sid, 'defiller');
                setCurrentStep('defiller');
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
        const checkedFillers = fillerWords.filter(f => f.checked);
        // 统计对应的 fillerSegments（使用精确匹配）
        const checkedSegments = fillerSegments.filter(seg => 
            checkedFillers.some(f => seg.word === f.word)
        );
        return {
            totalCount: checkedFillers.reduce((sum, f) => sum + f.count, 0),
            totalDuration: checkedFillers.reduce((sum, f) => sum + (f.totalDuration || 0), 0),
            segmentCount: checkedSegments.length,
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

    // 监听视频播放进度，到 end + 2s 时停止
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !activeFillerSegment) return;

        const handleTimeUpdate = () => {
            const currentMs = video.currentTime * 1000;
            const previewStart = Math.max(0, activeFillerSegment.start - CONTEXT_DURATION);
            const previewEnd = activeFillerSegment.end + CONTEXT_DURATION;
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
    }, [activeFillerSegment]);

    const handleApplyTrim = async () => {
        setIsApplyingTrim(true);
        setError(null);

        try {
            const removedFillers = fillerWords.filter(f => f.checked).map(f => f.word);
            const { applyTrimming } = await import('@/features/editor/lib/workspace-api');
            await applyTrimming(sessionId, {
                removed_fillers: removedFillers,
                create_clips_from_segments: true,
            });

            // 根据 config 步骤的 configEnableBroll 状态决定下一步
            if (configEnableBroll) {
                // 进入 B-Roll 配置
                await updateWorkflowStep(sessionId, 'broll_config');
                setCurrentStep('broll_config');
                await loadBRollData(sessionId);
            } else {
                // 直接进入编辑器
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

    // 选择配置 B-Roll（保留兼容）
    const handleChooseBRoll = async () => {
        setShowBRollChoice(false);
        await updateWorkflowStep(sessionId, 'broll_config');
        setCurrentStep('broll_config');
        await loadBRollData(sessionId);
    };

    // 跳过 B-Roll 直接进入编辑器
    const handleSkipBRollToEditor = () => {
        router.push(`/editor?project=${projectId}`);
    };

    // ==========================================
    // Step 4: B-Roll Config handlers
    // ==========================================
    const handleSelectAsset = (clipId: string, assetId: string) => {
        setClips(prev => prev.map(clip =>
            clip.clipId === clipId ? { ...clip, selectedAssetId: assetId } : clip
        ));
    };

    const handleRefreshClips = async () => {
        await loadBRollData(sessionId);
    };

    const handleConfirmBRoll = async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            // ★ 保存工作流配置到后端（编辑器将读取并应用）
            const { authFetch } = await import('@/lib/supabase/session');
            
            // 构建 B-Roll 选择数据
            const brollSelections = clips
                .filter(c => c.selectedAssetId)
                .map(c => ({
                    clip_id: c.clipId,
                    selected_asset_id: c.selectedAssetId,
                    time_range: c.timeRange,
                    text: c.text,
                }));
            
            const configResponse = await authFetch(`/api/workspace/sessions/${sessionId}/workflow-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pip_enabled: pipEnabled,
                    pip_position: 'bottom-right',  // TODO: 让用户选择位置
                    pip_size: 'medium',
                    broll_enabled: brollEnabled,
                    broll_selections: brollSelections,
                }),
            });
            
            if (!configResponse.ok) {
                throw new Error('保存配置失败');
            }
            
            log('✅ 工作流配置已保存:', { pipEnabled, brollEnabled, brollSelections });

            // 进入编辑器
            router.push(`/editor?project=${projectId}`);
        } catch (err: unknown) {
            log('保存配置失败:', err);
            const error = err as { message?: string };
            setError(error.message || '保存配置失败');
            setIsSubmitting(false);
        }
    };

    const handleSkipBRoll = () => {
        router.push(`/editor?project=${projectId}`);
    };

    // ==========================================
    // Navigation
    // ==========================================
    const handleBack = () => {
        if (currentStep === 'upload') {
            setCurrentStep('entry');
            setSelectedFiles([]);
        } else if (currentStep === 'config') {
            // 从配置返回上传
            setCurrentStep('upload');
        } else if (currentStep === 'processing') {
            // 处理中不允许返回
        } else if (currentStep === 'defiller') {
            // ★ 允许返回到配置步骤
            setCurrentStep('config');
        } else if (currentStep === 'broll_config') {
            setCurrentStep('defiller');
        }
    };

    // ==========================================
    // Config Step: 开始分析
    // ==========================================
    const handleStartAnalysis = async () => {
        try {
            // 更新步骤状态
            await updateWorkflowStep(sessionId, 'processing');
            setCurrentStep('processing');
            
            // 启动处理，传递配置选项
            await startProcessing(sessionId, {
                detect_fillers: configDetectFillers,
                detect_breaths: configDetectBreaths,
            });
        } catch (err: unknown) {
            log('启动分析失败:', err);
            const error = err as { message?: string };
            setError(error.message || '启动分析失败');
        }
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
                        <StepIndicator currentStep={currentStep} mode={entryMode} />
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
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors"
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
                                "w-full h-10 text-sm font-bold text-white rounded-xl shadow-lg transition-all flex items-center justify-center",
                                selectedFiles.length > 0 && !isUploading
                                    ? "bg-gray-900 hover:bg-gray-800"
                                    : "bg-gray-300 cursor-not-allowed"
                            )}
                        >
                            {isUploading ? (
                                <>
                                    <Loader2 size={16} className="mr-2 animate-spin" />
                                    {uploadPhase === 'uploading' && '上传中...'}
                                    {uploadPhase === 'processing' && '处理中...'}
                                    {uploadPhase === 'ready' && '准备就绪'}
                                </>
                            ) : (
                                <>
                                    <Upload size={16} className="mr-2" />
                                    上传视频
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
    // Render Config Step (分析配置)
    // ==========================================
    if (currentStep === 'config') {
        return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
                    {/* Step Indicator */}
                    <div className="rounded-t-2xl overflow-hidden">
                        <StepIndicator currentStep={currentStep} mode={entryMode} />
                    </div>

                    {/* Header */}
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-4">
                        <button
                            onClick={handleBack}
                            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div className="w-11 h-11 bg-gray-800 rounded-xl flex items-center justify-center">
                            <Palette size={22} className="text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">分析配置</h3>
                            <p className="text-gray-500 text-sm">选择您需要的智能分析功能</p>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-4">
                        {/* B-Roll 素材 */}
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                    <Film size={20} className="text-purple-600" />
                                </div>
                                <div>
                                    <p className="font-medium text-gray-900">启用 B-Roll</p>
                                    <p className="text-xs text-gray-500">AI 推荐相关画面素材</p>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                checked={configEnableBroll}
                                onChange={(e) => setConfigEnableBroll(e.target.checked)}
                                className="w-5 h-5 accent-gray-900 rounded"
                            />
                        </label>

                        {/* 分隔线 */}
                        <div className="border-t border-gray-100 pt-2">
                            <p className="text-xs text-gray-400 mb-3 px-1">语义清理选项</p>
                        </div>

                        {/* 识别口癖（含重复词） */}
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                    <Scissors size={20} className="text-blue-600" />
                                </div>
                                <div>
                                    <p className="font-medium text-gray-900">识别口癖</p>
                                    <p className="text-xs text-gray-500">嗯、啊、那个、重复词等</p>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                checked={configDetectFillers}
                                onChange={(e) => setConfigDetectFillers(e.target.checked)}
                                className="w-5 h-5 accent-gray-900 rounded"
                            />
                        </label>

                        {/* 识别换气 */}
                        <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                    <Wind size={20} className="text-green-600" />
                                </div>
                                <div>
                                    <p className="font-medium text-gray-900">识别换气</p>
                                    <p className="text-xs text-gray-500">长时间停顿和吸气声</p>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                checked={configDetectBreaths}
                                onChange={(e) => setConfigDetectBreaths(e.target.checked)}
                                className="w-5 h-5 accent-gray-900 rounded"
                            />
                        </label>
                    </div>

                    {/* Footer */}
                    <div className="px-6 pb-6">
                        {error && (
                            <div className="mb-3 p-2.5 bg-red-50 border border-red-100 text-red-600 text-xs rounded-lg">
                                ⚠️ {error}
                            </div>
                        )}
                        <button
                            onClick={handleStartAnalysis}
                            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white text-sm font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                        >
                            <Sparkles size={16} />
                            开始智能分析
                        </button>
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
                        <StepIndicator currentStep={currentStep} mode={entryMode} />
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
                        <StepIndicator currentStep={currentStep} mode={entryMode} />
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
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
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
                                        <span className="text-sm font-bold text-gray-800">待删除片段</span>
                                        <span className="text-xs text-gray-400 ml-2">({displaySegments.length})</span>
                                    </div>
                                </div>
                                <div className="text-sm text-gray-500 font-medium">
                                    {formatDuration(stats.totalDuration)}
                                </div>
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
                                        return (
                                            <div
                                                key={seg.id}
                                                onClick={() => handlePreviewSegment(isActive ? null : seg)}
                                                className={cn(
                                                    "p-4 rounded-xl border-2 cursor-pointer transition-all",
                                                    isActive
                                                        ? "bg-gray-50 border-gray-800 shadow-lg"
                                                        : "bg-white border-gray-100 hover:border-gray-300 hover:shadow-md"
                                                )}
                                            >
                                                <div className="flex items-start gap-4">
                                                    {/* 序号 */}
                                                    <div className={cn(
                                                        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0",
                                                        isActive ? "bg-gray-800 text-white" : "bg-red-100 text-red-600"
                                                    )}>
                                                        {idx + 1}
                                                    </div>
                                                    
                                                    <div className="flex-1 min-w-0">
                                                        {/* 口癖词标签 + 时长 */}
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="px-2 py-1 bg-red-100 text-red-600 text-xs rounded-md font-bold">
                                                                {seg.word}
                                                            </span>
                                                            <span className="text-sm text-gray-500 font-medium">
                                                                {formatDuration(seg.duration)}
                                                            </span>
                                                        </div>
                                                        
                                                        {/* 文字内容 */}
                                                        {seg.text && (
                                                            <p className="text-sm text-gray-600 mb-2 line-clamp-2">
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
                                onClick={handleSkipBRollToEditor}
                                disabled={isApplyingTrim}
                                className="px-5 py-2.5 text-gray-500 hover:text-gray-900 text-sm font-medium transition-colors"
                            >
                                跳过，直接编辑
                            </button>
                            <button
                                onClick={handleApplyTrim}
                                disabled={isApplyingTrim || stats.totalCount === 0}
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
    // Render B-Roll Config Step
    // ==========================================
    if (currentStep === 'broll_config') {
        return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
                    {/* Step Indicator */}
                    <div className="rounded-t-2xl overflow-hidden flex-shrink-0">
                        <StepIndicator currentStep={currentStep} mode={entryMode} />
                    </div>

                    {/* Header - 带返回按钮 */}
                    <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
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
                                <Film size={22} className="text-white" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">B-Roll 智能配置</h3>
                                <p className="text-gray-500 text-sm">
                                    共 <span className="font-bold text-gray-700">{clips.length}</span> 个片段，
                                    已选 <span className="font-bold text-gray-700">{clips.filter(c => c.selectedAssetId).length}</span> 个素材
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X size={20} className="text-gray-500" />
                        </button>
                    </div>

                    {/* Content - 左宽右窄布局 */}
                    <div className="flex-1 flex overflow-hidden min-h-0">
                        {/* 左侧：预览画布 + 配置开关 (60%) */}
                        <div className="w-[60%] border-r border-gray-200 flex flex-col bg-gray-900 flex-shrink-0">
                            {/* 预览区域 */}
                            <div className="flex-1 relative flex items-center justify-center">
                                <div className="relative w-full max-w-lg aspect-video bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800 rounded-xl overflow-hidden mx-6 border border-gray-600 shadow-2xl">
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="text-7xl font-black text-gray-600 tracking-tighter">AI</div>
                                    </div>
                                    {pipEnabled && (
                                        <div className="absolute bottom-4 right-4 w-16 h-16 bg-gray-500 rounded-full border-3 border-gray-400 flex items-center justify-center shadow-lg">
                                            <span className="text-3xl">😊</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 配置开关区域 - 底部白色区域 */}
                            <div className="p-4 bg-white border-t border-gray-200 space-y-3">
                                {/* 两个主要开关 */}
                                <div className="grid grid-cols-2 gap-3">
                                    {/* PiP 开关 */}
                                    <button
                                        onClick={() => setPipEnabled(!pipEnabled)}
                                        className={cn(
                                            "flex items-center gap-3 p-3 rounded-xl transition-all text-left",
                                            pipEnabled 
                                                ? "bg-gray-100 border border-gray-300" 
                                                : "bg-gray-50 border border-gray-200"
                                        )}
                                    >
                                        <div className={cn(
                                            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                                            pipEnabled ? "bg-gray-800" : "bg-gray-200"
                                        )}>
                                            <User size={18} className={pipEnabled ? "text-white" : "text-gray-500"} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-800 truncate">挂角人像</p>
                                            <p className="text-xs text-gray-500">
                                                {pipEnabled ? '已开启' : '已关闭'}
                                            </p>
                                        </div>
                                        <div className={cn(
                                            "w-10 h-6 rounded-full transition-colors flex-shrink-0",
                                            pipEnabled ? "bg-gray-800" : "bg-gray-300"
                                        )}>
                                            <span className={cn(
                                                "block w-4 h-4 mt-1 rounded-full bg-white shadow transition-transform",
                                                pipEnabled ? "translate-x-5" : "translate-x-1"
                                            )} />
                                        </div>
                                    </button>

                                    {/* 背景定制按钮 */}
                                    <button className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-all text-left">
                                        <div className="w-9 h-9 bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                                            <Palette size={18} className="text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-800 truncate">背景定制</p>
                                            <p className="text-xs text-gray-500">配置画布</p>
                                        </div>
                                    </button>
                                </div>

                                {/* B-Roll 增强开关 */}
                                <button
                                    onClick={() => setBrollEnabled(!brollEnabled)}
                                    className={cn(
                                        "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left",
                                        brollEnabled 
                                            ? "bg-gray-100 border border-gray-400" 
                                            : "bg-gray-50 border border-gray-200"
                                    )}
                                >
                                    <div className={cn(
                                        "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                                        brollEnabled ? "bg-gray-800" : "bg-gray-200"
                                    )}>
                                        <Sparkles size={18} className={brollEnabled ? "text-white" : "text-gray-500"} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800">智能 B-Roll 增强</p>
                                        <p className="text-xs text-gray-500">AI 自动匹配场景素材</p>
                                    </div>
                                    <div className={cn(
                                        "w-10 h-6 rounded-full transition-colors flex-shrink-0",
                                        brollEnabled ? "bg-gray-800" : "bg-gray-300"
                                    )}>
                                        <span className={cn(
                                            "block w-4 h-4 mt-1 rounded-full bg-white shadow transition-transform",
                                            brollEnabled ? "translate-x-5" : "translate-x-1"
                                        )} />
                                    </div>
                                </button>
                            </div>
                        </div>

                        {/* 右侧：字幕片段 + AI B-Roll 建议列表 */}
                        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
                            {/* 列表头部 */}
                            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0">
                                <div className="flex items-center gap-2">
                                    <Sparkles size={16} className="text-gray-600" />
                                    <span className="text-sm font-bold text-gray-800">AI 片段建议</span>
                                </div>
                                <button
                                    onClick={handleRefreshClips}
                                    disabled={isLoadingClips}
                                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                                >
                                    <RefreshCw size={12} className={isLoadingClips ? 'animate-spin' : ''} />
                                    刷新
                                </button>
                            </div>

                            {/* 片段列表 */}
                            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                                {isLoadingClips ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Loader2 size={28} className="text-gray-400 animate-spin mb-3" />
                                        <p className="text-gray-500 text-sm">生成建议中...</p>
                                    </div>
                                ) : clips.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Film size={40} className="text-gray-300 mb-3" />
                                        <p className="text-gray-500 text-sm">暂无片段建议</p>
                                    </div>
                                ) : (
                                    clips.map(clip => {
                                        const isActive = activeClipId === clip.clipId;
                                        return (
                                            <div
                                                key={clip.clipId}
                                                onClick={() => setActiveClipId(isActive ? null : clip.clipId)}
                                                className={cn(
                                                    "p-3 rounded-xl border cursor-pointer transition-all",
                                                    isActive
                                                        ? "bg-white border-gray-400 shadow-md"
                                                        : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"
                                                )}
                                            >
                                                {/* 片段标题 */}
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                                        SLOT {clip.clipNumber}
                                                    </span>
                                                    {clip.selectedAssetId && (
                                                        <span className="text-[10px] text-green-600 font-medium">✓ 已选</span>
                                                    )}
                                                </div>
                                                
                                                {/* 字幕文本 */}
                                                <p className="text-sm text-gray-700 leading-relaxed mb-2 line-clamp-2">
                                                    "{clip.text}"
                                                </p>
                                                
                                                {/* 素材选择 */}
                                                <div className="flex gap-1.5 flex-wrap">
                                                    {clip.suggestedAssets.slice(0, 3).map((asset) => (
                                                        <button
                                                            key={asset.id}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleSelectAsset(clip.clipId, asset.id);
                                                            }}
                                                            className={cn(
                                                                "relative w-14 h-10 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0",
                                                                clip.selectedAssetId === asset.id
                                                                    ? "border-gray-800"
                                                                    : "border-gray-200 hover:border-gray-400"
                                                            )}
                                                        >
                                                            <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
                                                                <ImageIcon size={14} className="text-gray-400" />
                                                            </div>
                                                            {clip.selectedAssetId === asset.id && (
                                                                <div className="absolute inset-0 bg-gray-800/30 flex items-center justify-center">
                                                                    <Check size={12} className="text-white" />
                                                                </div>
                                                            )}
                                                        </button>
                                                    ))}
                                                    <button className="w-14 h-10 rounded-lg border-2 border-dashed border-gray-300 hover:border-gray-400 flex items-center justify-center text-gray-400 hover:text-gray-500 transition-colors flex-shrink-0">
                                                        <Plus size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-5 py-3 border-t border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
                        {error && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                                ⚠️ {error}
                            </div>
                        )}
                        <div className="flex-1" />
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleSkipBRoll}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-gray-500 hover:text-gray-800 font-medium text-sm transition-colors disabled:opacity-50"
                            >
                                跳过
                            </button>
                            <button
                                onClick={handleConfirmBRoll}
                                disabled={isSubmitting}
                                className="px-5 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium text-sm transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        保存中...
                                    </>
                                ) : (
                                    <>
                                        进入编辑器
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

    return null;
}
