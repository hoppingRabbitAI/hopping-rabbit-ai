'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Mic,
  Upload,
  FileAudio,
  FileImage,
  Loader2,
  X,
  Play,
  Pause,
  Volume2,
  Check,
  AlertCircle,
  Sparkles,
  MessageSquare,
  User,
  Wand2,
  Plus,
  Star,
} from 'lucide-react';
import {
  getPresetVoices,
  createSmartBroadcastTask,
  pollTaskStatus,
  type PresetVoice,
  type SmartBroadcastRequest,
  type AITaskResponse,
} from '@/features/editor/lib/rabbit-hole-api';
import { authFetch } from '@/lib/supabase/session';
import { MaterialsApi, type AvatarItem, type VoiceSampleItem } from '@/lib/api/materials';

// ============================================
// 类型定义
// ============================================

type InputMode = 'audio' | 'script' | 'clone';

interface SmartBroadcastPanelProps {
  onBack?: () => void;
  onComplete?: (task: AITaskResponse) => void;
}

// ============================================
// 主组件
// ============================================

export function SmartBroadcastPanel({ onBack, onComplete }: SmartBroadcastPanelProps) {
  // 输入模式：简化为两种
  const [mode, setMode] = useState<InputMode>('audio');
  
  // 数字人形象
  const [avatars, setAvatars] = useState<AvatarItem[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(true);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarItem | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  // 音频文件
  const [audioFile, setAudioFile] = useState<File | null>(null);
  
  // 脚本模式
  const [script, setScript] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<PresetVoice | null>(null);
  const [voices, setVoices] = useState<PresetVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  
  // 克隆声音
  const [clonedVoices, setClonedVoices] = useState<VoiceSampleItem[]>([]);
  const [clonedVoicesLoading, setClonedVoicesLoading] = useState(true);
  const [selectedClonedVoice, setSelectedClonedVoice] = useState<VoiceSampleItem | null>(null);
  
  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  
  // 音频预览
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  const materialsApi = new MaterialsApi();

  // 加载用户的数字人形象
  useEffect(() => {
    const loadAvatars = async () => {
      setAvatarsLoading(true);
      try {
        const response = await materialsApi.getAvatars(20);
        if (response.data?.items) {
          setAvatars(response.data.items);
        }
      } catch (err) {
        console.error('加载数字人形象失败:', err);
      } finally {
        setAvatarsLoading(false);
      }
    };
    loadAvatars();
  }, []);

  // 加载预设音色
  useEffect(() => {
    const loadVoices = async () => {
      setVoicesLoading(true);
      try {
        const presetResponse = await getPresetVoices();
        setVoices(presetResponse.voices);
        const defaultVoice = presetResponse.voices.find(v => v.id === 'zh_female_gentle');
        if (defaultVoice) {
          setSelectedVoice(defaultVoice);
        }
      } catch (err) {
        console.error('加载音色失败:', err);
      } finally {
        setVoicesLoading(false);
      }
    };
    loadVoices();
  }, []);

  // 加载用户克隆的声音
  useEffect(() => {
    const loadClonedVoices = async () => {
      setClonedVoicesLoading(true);
      try {
        const response = await materialsApi.getVoiceSamples({ include_clones: true, limit: 20 });
        if (response.data?.items) {
          const clones = response.data.items.filter(v => v.type === 'clone');
          setClonedVoices(clones);
        }
      } catch (err) {
        console.error('加载克隆声音失败:', err);
      } finally {
        setClonedVoicesLoading(false);
      }
    };
    loadClonedVoices();
  }, []);

  // 图片选择处理
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setSelectedAvatar(null); // 清除已选的素材库图片
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreview(ev.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // 选择已有的数字人形象
  const handleSelectAvatar = (avatar: AvatarItem) => {
    setSelectedAvatar(avatar);
    setImageFile(null);
    setImagePreview(avatar.url);
  };

  // 音频选择处理
  const handleAudioSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file);
    }
  }, []);

  // 上传文件
  const uploadFile = async (file: File, type: 'image' | 'audio'): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('prefix', `smart-broadcast/${type}`);
    
    const endpoint = type === 'image' ? '/api/upload/image' : '/api/upload/audio';
    
    const response = await authFetch(endpoint, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '上传失败');
    }
    
    const data = await response.json();
    return data.url;
  };

  // 生成处理
  const handleGenerate = async () => {
    setError(null);
    setIsGenerating(true);
    setIsUploading(true);
    setProgress(0);
    setStatusMessage('准备上传文件...');

    try {
      // 验证输入
      if (!imagePreview) {
        throw new Error('请选择或上传人物图片');
      }
      
      if (mode === 'audio' && !audioFile) {
        throw new Error('请上传配音音频');
      }
      
      if (mode === 'script' && !script.trim()) {
        throw new Error('请输入播报脚本');
      }
      
      if (mode === 'clone' && !script.trim()) {
        throw new Error('请输入播报脚本');
      }
      
      if (mode === 'clone' && !selectedClonedVoice) {
        throw new Error('请选择克隆声音');
      }

      // 获取图片 URL
      let imageUrl: string;
      if (selectedAvatar) {
        imageUrl = selectedAvatar.url;
        setProgress(20);
      } else if (imageFile) {
        setStatusMessage('上传图片...');
        setProgress(10);
        imageUrl = await uploadFile(imageFile, 'image');
        setProgress(20);
      } else {
        throw new Error('请选择或上传人物图片');
      }
      
      // 构建请求参数
      const params: SmartBroadcastRequest = {
        image_url: imageUrl,
        duration: '5',
      };

      if (mode === 'audio') {
        // 模式1: 图片 + 音频
        setStatusMessage('上传音频...');
        setProgress(30);
        params.audio_url = await uploadFile(audioFile!, 'audio');
      } else if (mode === 'script') {
        // 模式2: 图片 + 脚本 + 预设音色
        params.script = script;
        params.voice_id = selectedVoice?.id || 'zh_female_gentle';
      } else if (mode === 'clone' && selectedClonedVoice?.preview_url) {
        // 模式3: 图片 + 脚本 + 克隆声音（使用已克隆声音的 preview_url 作为音源）
        params.script = script;
        // 使用克隆声音的 fish_audio_reference_id
        // 由于后端目前只支持 voice_clone_audio_url，我们暂用 preview_url
        params.voice_clone_audio_url = selectedClonedVoice.preview_url;
      }

      setIsUploading(false);
      setProgress(40);
      setStatusMessage('创建智能播报任务...');

      // 创建任务
      const response = await createSmartBroadcastTask(params);
      
      setStatusMessage(`任务已创建 (${response.mode_description})，正在处理...`);

      // 轮询状态
      const result = await pollTaskStatus(response.task_id, {
        interval: 3000,
        maxAttempts: 200,
        onProgress: (task) => {
          setProgress(40 + Math.floor(task.progress * 0.55));
          setStatusMessage(task.status_message || '处理中...');
        },
      });

      if (result.status === 'completed' && result.output_url) {
        setGeneratedUrl(result.output_url);
        setProgress(100);
        setStatusMessage('生成完成！');
        onComplete?.(result);
      } else {
        throw new Error(result.error_message || '生成失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setIsGenerating(false);
      setIsUploading(false);
    }
  };

  // 播放音色示例
  const playVoiceSample = (voice: PresetVoice) => {
    if (!voice.sample_url) return;
    
    if (playingVoiceId === voice.id) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = voice.sample_url;
        audioRef.current.play();
      }
      setPlayingVoiceId(voice.id);
    }
  };

  // 模式切换时清空相关数据
  const handleModeChange = (newMode: InputMode) => {
    setMode(newMode);
    setError(null);
  };

  // 判断是否可以生成
  const canGenerate = 
    imagePreview &&
    !isGenerating &&
    (
      (mode === 'audio' && audioFile) ||
      (mode === 'script' && script.trim() && selectedVoice) ||
      (mode === 'clone' && script.trim() && selectedClonedVoice)
    );

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 头部 */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-4">
        {onBack && (
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        )}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles size={20} className="text-purple-500" />
            智能播报
          </h2>
          <p className="text-sm text-gray-500">
            上传图片和配音，一键生成会说话的数字人视频
          </p>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Step 1: 选择数字人形象 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-sm font-medium">1</div>
            <h3 className="font-medium text-gray-900">选择数字人形象</h3>
            <span className="text-xs text-gray-400">（需包含清晰人脸）</span>
          </div>
          
          <p className="text-xs text-gray-500">从素材库选择或上传新图片</p>
          
          {/* 数字人形象网格 */}
          <div className="flex flex-wrap gap-3">
            {/* 上传新图片按钮 */}
            <label className="relative w-20 h-20 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-colors">
              <Plus size={20} className="text-gray-400" />
              <span className="text-xs text-gray-500 mt-1">上传</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
            </label>
            
            {/* 用户已有的数字人形象 */}
            {avatarsLoading ? (
              <div className="w-20 h-20 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            ) : (
              avatars.map((avatar) => (
                <button
                  key={avatar.id}
                  onClick={() => handleSelectAvatar(avatar)}
                  className={`relative w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${
                    selectedAvatar?.id === avatar.id
                      ? 'border-purple-500 ring-2 ring-purple-200'
                      : 'border-gray-200 hover:border-purple-300'
                  }`}
                >
                  <img
                    src={avatar.url}
                    alt={avatar.name}
                    className="w-full h-full object-cover"
                  />
                  {selectedAvatar?.id === avatar.id && (
                    <div className="absolute top-1 right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                  {avatar.is_favorite && (
                    <Star size={12} className="absolute bottom-1 right-1 text-yellow-400 fill-yellow-400" />
                  )}
                </button>
              ))
            )}
            
            {/* 如果上传了新图片，显示预览 */}
            {imageFile && imagePreview && (
              <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-purple-500 ring-2 ring-purple-200">
                <img
                  src={imagePreview}
                  alt="上传预览"
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="absolute top-1 right-1 p-0.5 bg-black/50 hover:bg-black/70 rounded-full text-white"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
          
          {avatars.length === 0 && !avatarsLoading && !imageFile && (
            <p className="text-xs text-gray-400">素材库暂无数字人形象，请点击上传添加</p>
          )}
        </div>

        {/* Step 2: 选择配音方式 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-sm font-medium">2</div>
            <h3 className="font-medium text-gray-900">选择配音方式</h3>
          </div>

          {/* 配音方式卡片 */}
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => handleModeChange('audio')}
              className={`p-3 rounded-xl border-2 text-center transition-all ${
                mode === 'audio'
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
              }`}
            >
              <div className={`w-10 h-10 mx-auto mb-2 rounded-full flex items-center justify-center ${
                mode === 'audio' ? 'bg-purple-100' : 'bg-gray-100'
              }`}>
                <FileAudio size={20} className={mode === 'audio' ? 'text-purple-600' : 'text-gray-500'} />
              </div>
              <p className="text-sm font-medium text-gray-900">上传音频</p>
              <p className="text-xs text-gray-500 mt-0.5">已有配音</p>
            </button>

            <button
              onClick={() => handleModeChange('script')}
              className={`p-3 rounded-xl border-2 text-center transition-all ${
                mode === 'script'
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
              }`}
            >
              <div className={`w-10 h-10 mx-auto mb-2 rounded-full flex items-center justify-center ${
                mode === 'script' ? 'bg-purple-100' : 'bg-gray-100'
              }`}>
                <MessageSquare size={20} className={mode === 'script' ? 'text-purple-600' : 'text-gray-500'} />
              </div>
              <p className="text-sm font-medium text-gray-900">输入脚本</p>
              <p className="text-xs text-gray-500 mt-0.5">AI 配音</p>
            </button>

            <button
              onClick={() => handleModeChange('clone')}
              className={`p-3 rounded-xl border-2 text-center transition-all ${
                mode === 'clone'
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
              }`}
            >
              <div className={`w-10 h-10 mx-auto mb-2 rounded-full flex items-center justify-center ${
                mode === 'clone' ? 'bg-purple-100' : 'bg-gray-100'
              }`}>
                <Mic size={20} className={mode === 'clone' ? 'text-purple-600' : 'text-gray-500'} />
              </div>
              <p className="text-sm font-medium text-gray-900">我的声音</p>
              <p className="text-xs text-gray-500 mt-0.5">声音克隆</p>
            </button>
          </div>
        </div>

        {/* Step 3: 根据模式显示内容 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-sm font-medium">3</div>
            <h3 className="font-medium text-gray-900">
              {mode === 'audio' ? '上传配音音频' : mode === 'script' ? '输入播报脚本' : '选择克隆声音'}
            </h3>
          </div>

          {mode === 'audio' && (
            <div>
              {audioFile ? (
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <FileAudio size={20} className="text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {audioFile.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {(audioFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <button
                    onClick={() => setAudioFile(null)}
                    className="p-1.5 hover:bg-gray-200 rounded-lg"
                  >
                    <X size={16} className="text-gray-500" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-3 p-6 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-colors">
                  <Volume2 size={24} className="text-gray-400" />
                  <div className="text-center">
                    <span className="text-sm text-gray-600">点击上传音频文件</span>
                    <p className="text-xs text-gray-400 mt-1">支持 MP3、WAV、M4A</p>
                  </div>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioSelect}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          )}

          {mode === 'script' && (
            <div className="space-y-4">
              {/* 脚本输入框 */}
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="请输入您想让数字人说的内容...&#10;&#10;例如：大家好，欢迎来到我的频道。"
                className="w-full h-28 px-4 py-3 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
              />
              <div className="text-xs text-gray-400 text-right">{script.length} 字</div>

              {/* 声音选择 */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">选择音色</p>

                {voicesLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="animate-spin text-purple-500" size={24} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {voices.map((voice) => (
                      <button
                        key={voice.id}
                        onClick={() => setSelectedVoice(voice)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          selectedVoice?.id === voice.id
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm text-gray-900">{voice.name}</span>
                          {selectedVoice?.id === voice.id && (
                            <Check size={16} className="text-purple-500" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            voice.gender === 'female' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'
                          }`}>
                            {voice.gender === 'female' ? '女声' : '男声'}
                          </span>
                          {voice.sample_url && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                playVoiceSample(voice);
                              }}
                              className="ml-auto p-1 hover:bg-gray-200 rounded-full"
                            >
                              {playingVoiceId === voice.id ? (
                                <Pause size={14} className="text-purple-600" />
                              ) : (
                                <Play size={14} className="text-gray-500" />
                              )}
                            </button>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {mode === 'clone' && (
            <div className="space-y-4">
              {/* 选择克隆声音 */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">选择我的克隆声音</p>

                {clonedVoicesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin text-purple-500" size={24} />
                  </div>
                ) : clonedVoices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
                    <Mic size={32} className="text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500 mb-1">暂无克隆声音</p>
                    <p className="text-xs text-gray-400">前往「我的素材 → 声音样本」上传并克隆声音</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {clonedVoices.map((voice) => (
                      <button
                        key={voice.id}
                        onClick={() => setSelectedClonedVoice(voice)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          selectedClonedVoice?.id === voice.id
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm text-gray-900">{voice.name}</span>
                          {selectedClonedVoice?.id === voice.id && (
                            <Check size={16} className="text-purple-500" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600">
                            我的声音
                          </span>
                          {voice.preview_url && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (playingVoiceId === voice.id) {
                                  audioRef.current?.pause();
                                  setPlayingVoiceId(null);
                                } else {
                                  if (audioRef.current) {
                                    audioRef.current.src = voice.preview_url!;
                                    audioRef.current.play();
                                  }
                                  setPlayingVoiceId(voice.id);
                                }
                              }}
                              className="ml-auto p-1 hover:bg-gray-200 rounded-full"
                            >
                              {playingVoiceId === voice.id ? (
                                <Pause size={14} className="text-purple-600" />
                              ) : (
                                <Play size={14} className="text-gray-500" />
                              )}
                            </button>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 脚本输入框 - 仅当有克隆声音时显示 */}
              {clonedVoices.length > 0 && (
                <>
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-sm font-medium text-gray-700 mb-2">输入播报脚本</p>
                    <textarea
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                      placeholder="请输入您想让数字人说的内容..."
                      className="w-full h-24 px-4 py-3 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                    />
                    <div className="text-xs text-gray-400 text-right">{script.length} 字</div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
/* 错误提示 */
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* 生成进度 */}
        {isGenerating && (
          <div className="space-y-2 p-4 bg-purple-50 rounded-xl">
            <div className="flex items-center justify-between text-sm">
              <span className="text-purple-700 font-medium">{statusMessage}</span>
              <span className="text-purple-500">{progress}%</span>
            </div>
            <div className="h-2 bg-purple-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* 生成结果 */}
        {generatedUrl && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600">
              <Check size={20} />
              <span className="font-medium">生成成功！</span>
            </div>
            <video
              src={generatedUrl}
              controls
              className="w-full rounded-xl border border-gray-200"
            />
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="px-6 py-4 border-t border-gray-100">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
            canGenerate
              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:shadow-lg'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isGenerating ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Wand2 size={18} />
              开始生成
            </>
          )}
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          预计耗时 3-8 分钟，生成期间请勿关闭页面
        </p>
      </div>

      {/* 隐藏的音频播放器 */}
      <audio
        ref={audioRef}
        onEnded={() => setPlayingVoiceId(null)}
        className="hidden"
      />
    </div>
  );
}

export default SmartBroadcastPanel;
