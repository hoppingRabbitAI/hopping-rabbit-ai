'use client';

/**
 * SmartBroadcastStep - AI 智能播报步骤组件
 * 支持从素材库选择数字人形象和声音样本
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    ArrowLeft,
    X,
    ImageIcon,
    Volume2,
    Sparkles,
    FileAudio,
    FileText,
    Mic2,
    User,
    ChevronRight,
    Check,
    Play,
    Pause,
    Upload,
    Loader2,
    Plus,
    Heart
} from 'lucide-react';
import { 
    materialsApi, 
    type AvatarItem, 
    type VoiceSampleItem,
    type MaterialPreferences 
} from '@/lib/api/materials';
import { getPresetVoices, createSmartBroadcastTask, type PresetVoice } from '@/features/editor/lib/rabbit-hole-api';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { toast } from '@/lib/stores/toast-store';

// ============================================
// 类型定义
// ============================================

type AudioInputMode = 'upload' | 'script' | 'clone';

interface SmartBroadcastStepProps {
    onClose: () => void;
    onBack: () => void;
    isUploading: boolean;
    currentStep: string;
    entryMode: string;
}

// ============================================
// StepIndicator 组件（复用）
// ============================================

function StepIndicator({ currentStep, mode }: { currentStep: string; mode: string }) {
    const steps = mode === 'ai-talk'
        ? [
            { key: 'mode', label: '选择模式' },
            { key: 'upload', label: '上传素材' },
            { key: 'processing', label: '生成中' },
        ]
        : [
            { key: 'mode', label: '选择模式' },
            { key: 'upload', label: '上传视频' },
            { key: 'config', label: '配置选项' },
            { key: 'processing', label: '处理中' },
        ];

    const currentIndex = steps.findIndex((s) => s.key === currentStep);

    return (
        <div className="flex items-center justify-center py-3 px-6 bg-gray-50 border-b border-gray-100">
            {steps.map((step, index) => (
                <React.Fragment key={step.key}>
                    <div className="flex items-center">
                        <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors
                                ${index <= currentIndex
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-gray-200 text-gray-500'
                                }`}
                        >
                            {index < currentIndex ? <Check size={12} /> : index + 1}
                        </div>
                        <span
                            className={`ml-2 text-xs font-medium ${
                                index <= currentIndex ? 'text-gray-900' : 'text-gray-400'
                            }`}
                        >
                            {step.label}
                        </span>
                    </div>
                    {index < steps.length - 1 && (
                        <ChevronRight size={14} className="mx-3 text-gray-300" />
                    )}
                </React.Fragment>
            ))}
        </div>
    );
}

// ============================================
// 数字人形象选择器
// ============================================

interface AvatarSelectorProps {
    avatars: AvatarItem[];
    selectedId: string | null;
    onSelect: (id: string, url: string) => void;
    onUploadNew: (file: File) => void;
    loading: boolean;
}

function AvatarSelector({ avatars, selectedId, onSelect, onUploadNew, loading }: AvatarSelectorProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onUploadNew(file);
        e.target.value = '';
    };
    
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">从素材库选择或上传新图片</span>
            </div>
            
            <div className="flex gap-3 overflow-x-auto pb-2">
                {/* 上传新图片按钮 */}
                <button
                    onClick={() => inputRef.current?.click()}
                    className="flex-shrink-0 w-20 h-20 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center hover:border-gray-400 hover:bg-gray-50 transition-all"
                >
                    <Plus size={20} className="text-gray-400" />
                    <span className="text-[10px] text-gray-500 mt-1">上传</span>
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleFileChange}
                />
                
                {loading ? (
                    <div className="flex items-center justify-center w-20 h-20">
                        <Loader2 size={20} className="animate-spin text-gray-400" />
                    </div>
                ) : (
                    avatars.map(avatar => (
                        <button
                            key={avatar.id}
                            onClick={() => onSelect(avatar.id, avatar.url)}
                            className={`
                                flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-all relative
                                ${selectedId === avatar.id 
                                    ? 'border-violet-500 ring-2 ring-violet-200' 
                                    : 'border-gray-200 hover:border-gray-300'}
                            `}
                        >
                            <img 
                                src={avatar.url} 
                                alt={avatar.name}
                                className="w-full h-full object-cover"
                            />
                            {selectedId === avatar.id && (
                                <div className="absolute top-1 right-1 w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center">
                                    <Check size={12} className="text-white" />
                                </div>
                            )}
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}

// ============================================
// 声音选择器（预设 + 用户样本）
// ============================================

interface VoiceSelectorProps {
    presetVoices: PresetVoice[];
    userVoices: VoiceSampleItem[];
    selectedId: string | null;
    selectedType: 'preset' | 'user';
    onSelect: (id: string, type: 'preset' | 'user') => void;
    loading: boolean;
}

function VoiceSelector({ presetVoices, userVoices, selectedId, selectedType, onSelect, loading }: VoiceSelectorProps) {
    const [playingId, setPlayingId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    
    const handlePlay = (url: string | undefined, id: string) => {
        if (!url || !audioRef.current) return;
        
        if (playingId === id) {
            audioRef.current.pause();
            setPlayingId(null);
        } else {
            audioRef.current.src = url;
            audioRef.current.play();
            setPlayingId(id);
        }
    };
    
    return (
        <div className="space-y-4">
            <audio 
                ref={audioRef} 
                onEnded={() => setPlayingId(null)}
                className="hidden"
            />
            
            {/* 预设声音 */}
            <div>
                <h4 className="text-xs font-medium text-gray-700 mb-2">预设声音</h4>
                <div className="grid grid-cols-3 gap-2">
                    {loading ? (
                        <div className="col-span-3 flex justify-center py-4">
                            <Loader2 size={20} className="animate-spin text-gray-400" />
                        </div>
                    ) : (
                        presetVoices.map(voice => (
                            <button
                                key={voice.id}
                                onClick={() => onSelect(voice.id, 'preset')}
                                className={`
                                    p-3 rounded-lg border text-left transition-all
                                    ${selectedId === voice.id && selectedType === 'preset'
                                        ? 'border-violet-500 bg-violet-50'
                                        : 'border-gray-200 hover:border-gray-300'}
                                `}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">{voice.gender === 'female' ? '👩' : '👨'}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">{voice.name}</p>
                                        <p className="text-[10px] text-gray-500">{voice.language === 'zh' ? '中文' : '英文'}</p>
                                    </div>
                                    {selectedId === voice.id && selectedType === 'preset' && (
                                        <Check size={14} className="text-violet-500" />
                                    )}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
            
            {/* 用户声音样本 */}
            {userVoices.length > 0 && (
                <div>
                    <h4 className="text-xs font-medium text-gray-700 mb-2">我的声音</h4>
                    <div className="space-y-2">
                        {userVoices.filter(v => v.type === 'clone' || v.is_cloned).map(voice => (
                            <button
                                key={voice.id}
                                onClick={() => onSelect(voice.id, 'user')}
                                className={`
                                    w-full p-3 rounded-lg border text-left transition-all flex items-center gap-3
                                    ${selectedId === voice.id && selectedType === 'user'
                                        ? 'border-violet-500 bg-violet-50'
                                        : 'border-gray-200 hover:border-gray-300'}
                                `}
                            >
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handlePlay(voice.preview_url || voice.url, voice.id);
                                    }}
                                    className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200"
                                >
                                    {playingId === voice.id ? (
                                        <Pause size={14} className="text-gray-600" />
                                    ) : (
                                        <Play size={14} className="text-gray-600 ml-0.5" />
                                    )}
                                </button>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">{voice.name}</p>
                                    <p className="text-[10px] text-gray-500">
                                        {voice.type === 'clone' ? '已克隆' : '声音样本'}
                                    </p>
                                </div>
                                {selectedId === voice.id && selectedType === 'user' && (
                                    <Check size={14} className="text-violet-500" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// 主组件
// ============================================

export function SmartBroadcastStep({
    onClose,
    onBack,
    isUploading,
    currentStep,
    entryMode,
}: SmartBroadcastStepProps) {
    // 状态
    const [audioMode, setAudioMode] = useState<AudioInputMode>('upload');
    const [avatars, setAvatars] = useState<AvatarItem[]>([]);
    const [presetVoices, setPresetVoices] = useState<PresetVoice[]>([]);
    const [userVoices, setUserVoices] = useState<VoiceSampleItem[]>([]);
    const [loadingAvatars, setLoadingAvatars] = useState(true);
    const [loadingVoices, setLoadingVoices] = useState(true);
    
    // 选中状态
    const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
    const [selectedAvatarUrl, setSelectedAvatarUrl] = useState<string | null>(null);
    const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
    const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
    
    const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
    const [selectedVoiceType, setSelectedVoiceType] = useState<'preset' | 'user'>('preset');
    const [uploadedAudioFile, setUploadedAudioFile] = useState<File | null>(null);
    const [scriptText, setScriptText] = useState('');
    
    // 提交状态
    const [submitting, setSubmitting] = useState(false);
    
    // 加载数据
    useEffect(() => {
        const loadData = async () => {
            // 加载数字人形象
            setLoadingAvatars(true);
            try {
                const res = await materialsApi.getAvatars(20);
                if (res.data) setAvatars(res.data.items);
            } catch (e) {
                console.error('加载数字人形象失败:', e);
            } finally {
                setLoadingAvatars(false);
            }
            
            // 加载预设声音
            setLoadingVoices(true);
            try {
                const res = await getPresetVoices();
                setPresetVoices(res.voices);
            } catch (e) {
                console.error('加载预设声音失败:', e);
            }
            
            // 加载用户声音
            try {
                const res = await materialsApi.getVoiceSamples({ include_clones: true, limit: 20 });
                if (res.data) setUserVoices(res.data.items);
            } catch (e) {
                console.error('加载用户声音失败:', e);
            } finally {
                setLoadingVoices(false);
            }
        };
        
        loadData();
    }, []);
    
    // 选择数字人
    const handleSelectAvatar = (id: string, url: string) => {
        setSelectedAvatarId(id);
        setSelectedAvatarUrl(url);
        setUploadedImageFile(null);
        setUploadedImagePreview(null);
    };
    
    // 上传新图片
    const handleUploadNewImage = (file: File) => {
        setUploadedImageFile(file);
        setUploadedImagePreview(URL.createObjectURL(file));
        setSelectedAvatarId(null);
        setSelectedAvatarUrl(null);
    };
    
    // 上传音频
    const handleUploadAudio = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) setUploadedAudioFile(file);
        e.target.value = '';
    };
    
    // 选择声音
    const handleSelectVoice = (id: string, type: 'preset' | 'user') => {
        setSelectedVoiceId(id);
        setSelectedVoiceType(type);
    };
    
    // 检查是否可以提交
    const canSubmit = () => {
        const hasImage = selectedAvatarUrl || uploadedImageFile;
        
        if (audioMode === 'upload') {
            return hasImage && uploadedAudioFile;
        } else if (audioMode === 'script') {
            return hasImage && scriptText.trim().length > 0 && selectedVoiceId;
        } else if (audioMode === 'clone') {
            return hasImage && scriptText.trim().length > 0 && selectedVoiceId && selectedVoiceType === 'user';
        }
        
        return false;
    };
    
    // 提交生成
    const handleSubmit = async () => {
        if (!canSubmit() || submitting) return;
        
        setSubmitting(true);
        
        try {
            // TODO: 实现完整的提交逻辑
            // 1. 如果是新上传的图片，先上传到存储
            // 2. 如果是上传音频模式，先上传音频
            // 3. 调用 createSmartBroadcastTask API
            
            toast.info('功能开发中，AI 智能播报功能即将上线');
        } catch (e) {
            toast.error(`生成失败: ${String(e)}`);
        } finally {
            setSubmitting(false);
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
                {/* Step Indicator */}
                <div className="rounded-t-2xl overflow-hidden">
                    <StepIndicator currentStep={currentStep} mode={entryMode} />
                </div>

                {/* Header */}
                <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={onBack}
                            disabled={isUploading || submitting}
                            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <h2 className="text-base font-bold text-gray-900">🎙️ 智能播报</h2>
                            <p className="text-[11px] text-gray-500">
                                上传图片和配音，一键生成会说话的数字人视频
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

                {/* 内容区 */}
                <div className="flex-1 px-5 py-4 space-y-5 overflow-y-auto">
                    {/* Step 1: 选择数字人形象 */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold">1</div>
                            <h3 className="font-medium text-gray-900">选择数字人形象</h3>
                            <span className="text-xs text-gray-400">（需包含清晰人脸）</span>
                        </div>
                        
                        {/* 已选中的图片预览 */}
                        {(uploadedImagePreview || selectedAvatarUrl) && (
                            <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl">
                                <img 
                                    src={uploadedImagePreview || selectedAvatarUrl!}
                                    alt="选中的形象"
                                    className="w-16 h-16 rounded-lg object-cover"
                                />
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-900">
                                        {uploadedImageFile ? uploadedImageFile.name : '已选择素材库形象'}
                                    </p>
                                    <p className="text-xs text-green-600 flex items-center gap-1">
                                        <Check size={12} />
                                        已选中
                                    </p>
                                </div>
                                <button
                                    onClick={() => {
                                        setSelectedAvatarId(null);
                                        setSelectedAvatarUrl(null);
                                        setUploadedImageFile(null);
                                        setUploadedImagePreview(null);
                                    }}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                >
                                    更换
                                </button>
                            </div>
                        )}
                        
                        {/* 形象选择器 */}
                        {!uploadedImagePreview && !selectedAvatarUrl && (
                            <AvatarSelector
                                avatars={avatars}
                                selectedId={selectedAvatarId}
                                onSelect={handleSelectAvatar}
                                onUploadNew={handleUploadNewImage}
                                loading={loadingAvatars}
                            />
                        )}
                    </div>

                    {/* Step 2: 选择配音方式 */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold">2</div>
                            <h3 className="font-medium text-gray-900">选择配音方式</h3>
                        </div>

                        {/* 三种模式切换 */}
                        <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
                            <button
                                onClick={() => setAudioMode('upload')}
                                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                                    audioMode === 'upload' 
                                        ? 'bg-white text-gray-900 shadow-sm' 
                                        : 'text-gray-500 hover:text-gray-900'
                                }`}
                            >
                                <FileAudio size={16} />
                                上传音频
                            </button>
                            <button
                                onClick={() => setAudioMode('script')}
                                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                                    audioMode === 'script' 
                                        ? 'bg-white text-gray-900 shadow-sm' 
                                        : 'text-gray-500 hover:text-gray-900'
                                }`}
                            >
                                <FileText size={16} />
                                输入脚本
                            </button>
                            <button
                                onClick={() => setAudioMode('clone')}
                                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                                    audioMode === 'clone' 
                                        ? 'bg-white text-gray-900 shadow-sm' 
                                        : 'text-gray-500 hover:text-gray-900'
                                }`}
                            >
                                <Mic2 size={16} />
                                克隆声音
                            </button>
                        </div>

                        <p className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                            {audioMode === 'upload' && '📁 直接上传录制好的配音音频，AI 同步口型'}
                            {audioMode === 'script' && '✨ 输入文字脚本，AI 使用预设声音朗读并同步口型'}
                            {audioMode === 'clone' && '🎤 使用你的声音克隆，输入脚本自动生成配音'}
                        </p>
                    </div>

                    {/* Step 3: 根据模式显示不同内容 */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold">3</div>
                            <h3 className="font-medium text-gray-900">
                                {audioMode === 'upload' && '上传配音音频'}
                                {audioMode === 'script' && '输入播报脚本'}
                                {audioMode === 'clone' && '选择克隆声音'}
                            </h3>
                        </div>
                        
                        {/* 上传音频模式 */}
                        {audioMode === 'upload' && (
                            <>
                                {uploadedAudioFile ? (
                                    <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl">
                                        <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center">
                                            <Volume2 size={20} className="text-violet-600" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-gray-900">{uploadedAudioFile.name}</p>
                                            <p className="text-xs text-gray-500">
                                                {(uploadedAudioFile.size / 1024 / 1024).toFixed(1)} MB
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => setUploadedAudioFile(null)}
                                            className="text-xs text-gray-500 hover:text-gray-700"
                                        >
                                            更换
                                        </button>
                                    </div>
                                ) : (
                                    <label className="border-2 border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all">
                                        <input
                                            type="file"
                                            accept="audio/*"
                                            className="hidden"
                                            onChange={handleUploadAudio}
                                        />
                                        <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mb-2">
                                            <Volume2 size={24} className="text-gray-400" />
                                        </div>
                                        <p className="text-sm text-gray-600">点击上传音频文件</p>
                                        <p className="text-xs text-gray-400 mt-1">支持 MP3、WAV、M4A</p>
                                    </label>
                                )}
                            </>
                        )}
                        
                        {/* 脚本输入模式 */}
                        {audioMode === 'script' && (
                            <div className="space-y-4">
                                <textarea
                                    value={scriptText}
                                    onChange={(e) => setScriptText(e.target.value)}
                                    placeholder="请输入播报脚本，AI 将自动朗读..."
                                    className="w-full h-32 px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                />
                                <p className="text-xs text-gray-500">已输入 {scriptText.length} 字</p>
                                
                                <div className="pt-2">
                                    <h4 className="text-sm font-medium text-gray-900 mb-3">选择声音</h4>
                                    <VoiceSelector
                                        presetVoices={presetVoices}
                                        userVoices={userVoices}
                                        selectedId={selectedVoiceId}
                                        selectedType={selectedVoiceType}
                                        onSelect={handleSelectVoice}
                                        loading={loadingVoices}
                                    />
                                </div>
                            </div>
                        )}
                        
                        {/* 声音克隆模式 */}
                        {audioMode === 'clone' && (
                            <div className="space-y-4">
                                <div className="pt-2">
                                    <h4 className="text-sm font-medium text-gray-900 mb-3">选择我的克隆声音</h4>
                                    {userVoices.filter(v => v.type === 'clone' || v.is_cloned).length === 0 ? (
                                        <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
                                            <Mic2 size={32} className="mx-auto text-gray-300 mb-2" />
                                            <p className="text-sm text-gray-500">暂无克隆声音</p>
                                            <p className="text-xs text-gray-400 mt-1">
                                                前往「我的素材 → 声音样本」上传并克隆声音
                                            </p>
                                        </div>
                                    ) : (
                                        <VoiceSelector
                                            presetVoices={[]}
                                            userVoices={userVoices}
                                            selectedId={selectedVoiceId}
                                            selectedType={selectedVoiceType}
                                            onSelect={(id, type) => {
                                                if (type === 'user') handleSelectVoice(id, type);
                                            }}
                                            loading={loadingVoices}
                                        />
                                    )}
                                </div>
                                
                                <textarea
                                    value={scriptText}
                                    onChange={(e) => setScriptText(e.target.value)}
                                    placeholder="请输入播报脚本，AI 将用你的声音朗读..."
                                    className="w-full h-32 px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                />
                                <p className="text-xs text-gray-500">已输入 {scriptText.length} 字</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 pt-3 border-t border-gray-100">
                    <button
                        onClick={handleSubmit}
                        disabled={!canSubmit() || submitting}
                        className={`w-full h-10 text-sm font-bold text-white rounded-xl flex items-center justify-center transition-all ${
                            canSubmit() && !submitting
                                ? 'bg-gray-900 hover:bg-gray-800'
                                : 'bg-gray-300 cursor-not-allowed'
                        }`}
                    >
                        {submitting ? (
                            <RabbitLoader size={20} />
                        ) : (
                            <>
                                <Sparkles size={16} className="mr-2" />
                                开始生成
                            </>
                        )}
                    </button>
                    <p className="text-[10px] text-gray-400 text-center mt-2">
                        预计耗时 3-8 分钟，生成期间请勿关闭页面
                    </p>
                </div>
            </div>
        </div>
    );
}
