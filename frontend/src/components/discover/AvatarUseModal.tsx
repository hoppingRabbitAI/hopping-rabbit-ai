'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sparkles,
  Loader2,
  CheckCircle,
  AlertCircle,
  Download,
  RotateCcw,
  Mic,
  FileText,
  Upload,
  Camera,
  User,
  Volume2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { PhotoUploader } from '@/components/common/PhotoUploader';
import { digitalAvatarApi } from '@/lib/api/digital-avatars';
import type {
  DigitalAvatarTemplate,
  AvatarGeneration,
  GenerationInputType,
  AVATAR_STYLE_META,
} from '@/types/digital-avatar';

/* ================================================================
   AvatarUseModal — 数字人口播视频生成弹窗
   
   用户流程:
   Step 1: 选形象 (已在外部完成) → 输入脚本或上传音频
   Step 2: (可选) 上传人脸照片用于换脸
   Step 3: 提交 → 生成中 (轮询)
   Step 4: 展示结果
   ================================================================ */

type ModalStep = 'input' | 'processing' | 'result' | 'error';

interface AvatarUseModalProps {
  avatar: DigitalAvatarTemplate | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AvatarUseModal({ avatar, isOpen, onClose }: AvatarUseModalProps) {
  // 步骤
  const [step, setStep] = useState<ModalStep>('input');
  
  // 输入方式
  const [inputType, setInputType] = useState<'script' | 'audio'>('script');
  
  // 脚本输入
  const [script, setScript] = useState('');
  
  // 音频上传
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  
  // 换脸（可选）
  const [enableFaceSwap, setEnableFaceSwap] = useState(false);
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [facePreviewUrl, setFacePreviewUrl] = useState<string | null>(null);
  
  // 时长
  const [duration, setDuration] = useState<'5' | '10'>('5');
  
  // Kling 参数
  const [prompt, setPrompt] = useState('');  // Kling prompt: 动作/表情/运镜
  const [mode, setMode] = useState<'std' | 'pro'>('std');  // Kling mode
  
  // 生成状态
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [generation, setGeneration] = useState<AvatarGeneration | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusText, setStatusText] = useState('准备中…');
  
  // 轮询
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- 重置 ----
  const resetState = useCallback(() => {
    setStep('input');
    setInputType('script');
    setScript('');
    setAudioFile(null);
    setAudioPreviewUrl(null);
    setEnableFaceSwap(false);
    setFaceFile(null);
    setFacePreviewUrl(null);
    setDuration('5');
    setPrompt('');
    setMode('std');
    setGenerationId(null);
    setGeneration(null);
    setErrorMsg('');
    setStatusText('准备中…');
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // 关闭时重置
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(resetState, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, resetState]);

  // 从形象默认配置初始化 prompt/mode
  useEffect(() => {
    if (isOpen && avatar?.generation_config) {
      const cfg = avatar.generation_config;
      if (cfg.image_gen_prompt) setPrompt(cfg.image_gen_prompt);
      if (cfg.broadcast_mode) setMode(cfg.broadcast_mode);
      if (cfg.broadcast_duration) setDuration(cfg.broadcast_duration);
    }
  }, [isOpen, avatar]);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ---- 上传文件到后端 ----
  const uploadFile = async (file: File, type: 'image' | 'audio'): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    const { ensureValidToken, API_BASE_URL } = await import('@/lib/api/client');
    const token = await ensureValidToken();
    const res = await fetch(`${API_BASE_URL}/upload/${type}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!res.ok) throw new Error(`上传失败: ${res.statusText}`);
    const data = await res.json();
    return data.url;
  };

  // ---- 轮询生成进度 ----
  const startPolling = useCallback((genId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await digitalAvatarApi.getGeneration(genId);
        if (!res.data) return;

        const gen = res.data;
        setGeneration(gen);

        switch (gen.status) {
          case 'pending':
            setStatusText('任务排队中…');
            break;
          case 'broadcasting':
            setStatusText('正在生成口播视频…');
            break;
          case 'swapping':
            setStatusText('正在换脸处理…');
            break;
          case 'completed':
            setStep('result');
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            break;
          case 'failed':
            setErrorMsg(gen.error_message || '生成失败');
            setStep('error');
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            break;
        }
      } catch {
        // 网络错误，继续轮询
      }
    }, 3000);
  }, []);

  // ---- 提交生成 ----
  const handleSubmit = async () => {
    if (!avatar) return;

    try {
      setStep('processing');
      setStatusText('准备提交…');

      // 上传音频（如果有）
      let audioUrl: string | undefined;
      if (inputType === 'audio' && audioFile) {
        setStatusText('上传音频中…');
        audioUrl = await uploadFile(audioFile, 'audio');
      }

      // 上传人脸照片（如果有）
      let faceImageUrl: string | undefined;
      if (enableFaceSwap && faceFile) {
        setStatusText('上传照片中…');
        faceImageUrl = await uploadFile(faceFile, 'image');
      }

      setStatusText('提交生成任务…');

      const res = await digitalAvatarApi.generateWithAvatar(avatar.id, {
        ...(inputType === 'script' ? { script } : { audio_url: audioUrl }),
        voice_id: avatar.default_voice_id,
        face_image_url: faceImageUrl,
        duration,
        prompt: prompt.trim() || undefined,  // Kling prompt
        mode,                                 // Kling mode
      });

      if (!res.data?.success) {
        throw new Error('提交失败');
      }

      setGenerationId(res.data.generation_id);
      setStatusText('任务已提交，等待处理…');
      startPolling(res.data.generation_id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '提交失败');
      setStep('error');
    }
  };

  // ---- 音频文件处理 ----
  const handleAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    setAudioPreviewUrl(URL.createObjectURL(file));
  };

  // ---- 验证 ----
  const canSubmit =
    (inputType === 'script' && script.trim().length >= 2) ||
    (inputType === 'audio' && audioFile !== null);

  if (!avatar) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && step !== 'processing') onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                {avatar.thumbnail_url || avatar.portrait_url ? (
                  <img
                    src={avatar.thumbnail_url || avatar.portrait_url}
                    alt={avatar.name}
                    className="w-10 h-10 rounded-full object-cover ring-2 ring-gray-100"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-500 flex items-center justify-center">
                    <User size={18} className="text-white" />
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{avatar.name}</h2>
                  <p className="text-xs text-gray-500">数字人口播</p>
                </div>
              </div>
              {step !== 'processing' && (
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X size={18} className="text-gray-400" />
                </button>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5">
              <AnimatePresence mode="wait">
                {/* ====== Step: Input ====== */}
                {step === 'input' && (
                  <motion.div
                    key="input"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-5"
                  >
                    {/* 输入方式切换 */}
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-2 block">输入方式</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setInputType('script')}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all border-2',
                            inputType === 'script'
                              ? 'border-gray-900 bg-gray-50 text-gray-700'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          )}
                        >
                          <FileText size={16} />
                          文字脚本
                        </button>
                        <button
                          onClick={() => setInputType('audio')}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all border-2',
                            inputType === 'audio'
                              ? 'border-gray-900 bg-gray-50 text-gray-700'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          )}
                        >
                          <Mic size={16} />
                          上传音频
                        </button>
                      </div>
                    </div>

                    {/* 文字脚本输入 */}
                    {inputType === 'script' && (
                      <div>
                        <label className="text-sm font-medium text-gray-700 mb-2 block">
                          口播脚本
                          <span className="text-gray-400 font-normal ml-2">
                            {script.length}/500 字
                          </span>
                        </label>
                        <textarea
                          value={script}
                          onChange={(e) => setScript(e.target.value.slice(0, 500))}
                          placeholder="输入你想让数字人说的话…"
                          rows={5}
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100 transition-all"
                        />
                        {avatar.default_voice_name && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                            <Volume2 size={12} />
                            音色: {avatar.default_voice_name}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 音频上传 */}
                    {inputType === 'audio' && (
                      <div>
                        <label className="text-sm font-medium text-gray-700 mb-2 block">上传音频</label>
                        {audioFile ? (
                          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                              <Mic size={18} className="text-gray-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-700 truncate">{audioFile.name}</p>
                              <p className="text-xs text-gray-500">
                                {(audioFile.size / 1024 / 1024).toFixed(1)} MB
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                setAudioFile(null);
                                if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
                                setAudioPreviewUrl(null);
                              }}
                              className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              <X size={14} className="text-gray-400" />
                            </button>
                          </div>
                        ) : (
                          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-gray-300 hover:bg-gray-50/50 transition-all">
                            <Upload size={24} className="text-gray-400" />
                            <span className="text-sm text-gray-500">点击上传 MP3 / WAV 音频</span>
                            <span className="text-xs text-gray-400">最大 20MB</span>
                            <input
                              type="file"
                              accept="audio/mp3,audio/wav,audio/mpeg,.mp3,.wav"
                              onChange={handleAudioSelect}
                              className="hidden"
                            />
                          </label>
                        )}
                        {audioPreviewUrl && (
                          <audio src={audioPreviewUrl} controls className="w-full mt-2 rounded-lg" />
                        )}
                      </div>
                    )}

                    {/* 时长选择 */}
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-2 block">视频时长</label>
                      <div className="flex gap-2">
                        {(['5', '10'] as const).map((d) => (
                          <button
                            key={d}
                            onClick={() => setDuration(d)}
                            className={cn(
                              'px-4 py-2 rounded-lg text-sm font-medium transition-all border',
                              duration === d
                                ? 'border-gray-900 bg-gray-50 text-gray-700'
                                : 'border-gray-200 text-gray-500 hover:border-gray-300'
                            )}
                          >
                            {d}s
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Kling 生成模式 */}
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-2 block">生成模式</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setMode('std')}
                          className={cn(
                            'flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border-2',
                            mode === 'std'
                              ? 'border-gray-900 bg-gray-50 text-gray-700'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          )}
                        >
                          <span className="block">标准</span>
                          <span className="text-xs opacity-60">速度快 · 性价比高</span>
                        </button>
                        <button
                          onClick={() => setMode('pro')}
                          className={cn(
                            'flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border-2',
                            mode === 'pro'
                              ? 'border-gray-900 bg-gray-50 text-gray-700'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          )}
                        >
                          <span className="block">专家</span>
                          <span className="text-xs opacity-60">高画质 · 更自然</span>
                        </button>
                      </div>
                    </div>

                    {/* Kling 动作提示词 (可选) */}
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                        动作提示（可选）
                        <span className="text-gray-400 font-normal ml-2">
                          {prompt.length}/200
                        </span>
                      </label>
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value.slice(0, 200))}
                        placeholder="描述数字人的动作、表情或运镜，如：微笑点头，手势自然…"
                        rows={2}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100 transition-all"
                      />
                    </div>

                    {/* 可选换脸 */}
                    <div className="border-t border-gray-100 pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <label className="text-sm font-medium text-gray-700">换脸（可选）</label>
                          <p className="text-xs text-gray-400 mt-0.5">上传你的照片，将数字人的脸替换为你</p>
                        </div>
                        <button
                          onClick={() => {
                            setEnableFaceSwap(!enableFaceSwap);
                            if (enableFaceSwap) {
                              setFaceFile(null);
                              if (facePreviewUrl) URL.revokeObjectURL(facePreviewUrl);
                              setFacePreviewUrl(null);
                            }
                          }}
                          className={cn(
                            'relative w-11 h-6 rounded-full transition-colors',
                            enableFaceSwap ? 'bg-gray-800' : 'bg-gray-200'
                          )}
                        >
                          <span
                            className={cn(
                              'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                              enableFaceSwap ? 'translate-x-5' : 'translate-x-0.5'
                            )}
                          />
                        </button>
                      </div>

                      {enableFaceSwap && (
                        <PhotoUploader
                          onFileSelect={(file) => {
                            setFaceFile(file);
                            setFacePreviewUrl(URL.createObjectURL(file));
                          }}
                          previewUrl={facePreviewUrl}
                          onClear={() => {
                            setFaceFile(null);
                            if (facePreviewUrl) URL.revokeObjectURL(facePreviewUrl);
                            setFacePreviewUrl(null);
                          }}
                          label="上传正脸照片"
                          sublabel="正面清晰大头照效果最佳"
                          aspectRatio="1/1"
                          requireFace
                        />
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ====== Step: Processing ====== */}
                {step === 'processing' && (
                  <motion.div
                    key="processing"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col items-center justify-center py-12"
                  >
                    <div className="relative mb-6">
                      <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center">
                        <Loader2 size={32} className="text-gray-500 animate-spin" />
                      </div>
                      {avatar.thumbnail_url && (
                        <img
                          src={avatar.thumbnail_url || avatar.portrait_url}
                          alt=""
                          className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full ring-2 ring-white object-cover"
                        />
                      )}
                    </div>

                    <h3 className="text-lg font-semibold text-gray-900 mb-1">生成中</h3>
                    <p className="text-sm text-gray-500 mb-4">{statusText}</p>

                    {/* 进度指示 */}
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className={cn(
                        'w-2 h-2 rounded-full',
                        generation?.status === 'pending' ? 'bg-gray-400 animate-pulse' : 'bg-gray-300'
                      )} />
                      <span>排队</span>
                      <span className="text-gray-300">→</span>
                      <span className={cn(
                        'w-2 h-2 rounded-full',
                        generation?.status === 'broadcasting' ? 'bg-gray-500 animate-pulse' : 'bg-gray-300'
                      )} />
                      <span>口播</span>
                      {enableFaceSwap && (
                        <>
                          <span className="text-gray-300">→</span>
                          <span className={cn(
                            'w-2 h-2 rounded-full',
                            generation?.status === 'swapping' ? 'bg-gray-500 animate-pulse' : 'bg-gray-300'
                          )} />
                          <span>换脸</span>
                        </>
                      )}
                      <span className="text-gray-300">→</span>
                      <span className={cn(
                        'w-2 h-2 rounded-full bg-gray-300'
                      )} />
                      <span>完成</span>
                    </div>

                    <p className="text-xs text-gray-400 mt-6">预计需要 1-3 分钟，请勿关闭弹窗</p>
                  </motion.div>
                )}

                {/* ====== Step: Result ====== */}
                {step === 'result' && generation?.output_video_url && (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col items-center"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <CheckCircle size={20} className="text-gray-500" />
                      <h3 className="text-lg font-semibold text-gray-900">生成完成！</h3>
                    </div>

                    <div className="w-full rounded-xl overflow-hidden bg-gray-900 mb-4">
                      <video
                        src={generation.output_video_url}
                        controls
                        autoPlay
                        className="w-full aspect-[9/16] object-contain"
                      />
                    </div>

                    <div className="flex gap-2 w-full">
                      <a
                        href={generation.output_video_url}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors"
                      >
                        <Download size={16} />
                        下载视频
                      </a>
                      <button
                        onClick={resetState}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                      >
                        <RotateCcw size={16} />
                        再来一次
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* ====== Step: Error ====== */}
                {step === 'error' && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col items-center py-8"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
                      <AlertCircle size={28} className="text-red-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">生成失败</h3>
                    <p className="text-sm text-gray-500 mb-6 text-center max-w-sm">{errorMsg}</p>
                    <button
                      onClick={resetState}
                      className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors"
                    >
                      <RotateCcw size={16} />
                      重试
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer — 只在输入步骤显示 */}
            {step === 'input' && (
              <div className="p-5 border-t border-gray-100 flex items-center justify-between">
                <div className="text-xs text-gray-400">
                  每次生成消耗约 10 积分
                </div>
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="flex items-center gap-2 px-6 py-2.5 bg-gray-800 text-white rounded-xl text-sm font-medium hover:bg-gray-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-gray-200"
                >
                  <Sparkles size={16} />
                  开始生成
                </Button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
