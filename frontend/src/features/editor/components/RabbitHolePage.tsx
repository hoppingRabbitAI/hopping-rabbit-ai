/**
 * HoppingRabbit AI - Rabbit Hole 口型同步页面
 * Phase 1 MVP: 用户上传视频 + 音频 → AI 口型同步 → 存入素材库
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Upload, 
  Video, 
  Music, 
  Sparkles, 
  ChevronLeft,
  CheckCircle,
  AlertCircle,
  Loader2,
  Play,
  Pause,
  RotateCcw,
  Download,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { 
  createLipSyncTask, 
  getAITaskStatus, 
  AITaskStatus,
  AITaskResponse 
} from '@/features/editor/lib/rabbit-hole-api';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[RabbitHole]', ...args); };

// ============================================
// 类型定义
// ============================================

interface UploadedFile {
  file: File;
  url: string;
  previewUrl: string;
}

type PageStep = 'upload' | 'processing' | 'result';

// ============================================
// 辅助函数
// ============================================

function getStatusMessage(status: AITaskStatus, progress: number): string {
  switch (status) {
    case 'pending':
      return '等待处理...';
    case 'processing':
      if (progress < 20) return '正在分析视频人脸...';
      if (progress < 50) return '正在处理音频...';
      if (progress < 80) return '正在同步口型...';
      return '正在生成视频...';
    case 'completed':
      return '处理完成！';
    case 'failed':
      return '处理失败';
    case 'cancelled':
      return '已取消';
    default:
      return '处理中...';
  }
}

// ============================================
// 主组件
// ============================================

export function RabbitHolePage() {
  const router = useRouter();
  
  // 上传状态
  const [videoFile, setVideoFile] = useState<UploadedFile | null>(null);
  const [audioFile, setAudioFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  // 处理状态
  const [step, setStep] = useState<PageStep>('upload');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<AITaskResponse | null>(null);
  
  // 预览状态
  const [isPlaying, setIsPlaying] = useState(false);
  const resultVideoRef = useRef<HTMLVideoElement>(null);
  
  // 轮询定时器
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // 处理视频上传
  const handleVideoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith('video/')) {
      alert('请上传视频文件');
      return;
    }

    // 创建预览 URL
    const previewUrl = URL.createObjectURL(file);
    
    setVideoFile({
      file,
      url: '', // 上传后填充
      previewUrl,
    });
    
    debugLog('视频文件已选择:', file.name, file.size);
  }, []);

  // 处理音频上传
  const handleAudioUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith('audio/')) {
      alert('请上传音频文件');
      return;
    }

    // 创建预览 URL
    const previewUrl = URL.createObjectURL(file);
    
    setAudioFile({
      file,
      url: '', // 上传后填充
      previewUrl,
    });
    
    debugLog('音频文件已选择:', file.name, file.size);
  }, []);

  // 开始任务轮询
  const startPolling = useCallback((id: string) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await getAITaskStatus(id);
        setTaskStatus(status);
        
        debugLog('任务状态更新:', status);

        if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          
          if (status.status === 'completed') {
            setStep('result');
          }
        }
      } catch (error) {
        debugLog('轮询状态失败:', error);
      }
    }, 3000);
  }, []);

  // 提交任务
  const handleSubmit = useCallback(async () => {
    if (!videoFile || !audioFile) {
      alert('请先上传视频和音频文件');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // 上传视频文件到存储
      debugLog('开始上传视频...');
      setUploadProgress(10);
      
      // TODO: 使用真实的上传函数
      // 这里模拟上传，实际需要调用 Supabase Storage
      const videoUrl = videoFile.previewUrl; // 临时使用本地 URL
      const audioUrl = audioFile.previewUrl;
      
      setUploadProgress(50);
      debugLog('文件上传完成，创建任务...');

      // 创建口型同步任务
      const response = await createLipSyncTask({
        video_url: videoUrl,
        audio_url: audioUrl,
        enhance_face: true,
        expression_scale: 1.0,
      });

      if (response.success) {
        setTaskId(response.task_id);
        setStep('processing');
        setTaskStatus({
          task_id: response.task_id,
          task_type: 'lip_sync',
          status: 'pending',
          progress: 0,
          created_at: new Date().toISOString(),
        });
        
        // 开始轮询
        startPolling(response.task_id);
      } else {
        throw new Error(response.message || '创建任务失败');
      }
    } catch (error) {
      debugLog('提交任务失败:', error);
      alert(error instanceof Error ? error.message : '提交任务失败');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [videoFile, audioFile, startPolling]);

  // 重新开始
  const handleReset = useCallback(() => {
    setVideoFile(null);
    setAudioFile(null);
    setStep('upload');
    setTaskId(null);
    setTaskStatus(null);
    
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // 视频播放控制
  const handlePlayPause = useCallback(() => {
    if (resultVideoRef.current) {
      if (isPlaying) {
        resultVideoRef.current.pause();
      } else {
        resultVideoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  // 下载结果
  const handleDownload = useCallback(() => {
    if (taskStatus?.output_url) {
      const link = document.createElement('a');
      link.href = taskStatus.output_url;
      link.download = `lip-sync-${Date.now()}.mp4`;
      link.click();
    }
  }, [taskStatus]);

  // 返回工作台
  const handleBack = useCallback(() => {
    router.push('/workspace');
  }, [router]);

  // ============================================
  // 渲染
  // ============================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 头部 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={handleBack}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Rabbit Hole</h1>
              <p className="text-sm text-gray-500">AI 口型同步</p>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* 上传步骤 */}
        {step === 'upload' && (
          <div className="space-y-6">
            {/* 说明卡片 */}
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-2">
                上传你的视频和音频
              </h2>
              <p className="text-gray-600">
                AI 会将你的音频与视频中人物的口型进行同步，生成自然流畅的口播视频。
              </p>
            </div>

            {/* 视频上传区 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <Video size={20} className="text-blue-600" />
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">原始视频</h3>
                  <p className="text-sm text-gray-500">包含人脸的视频文件</p>
                </div>
              </div>

              {videoFile ? (
                <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                  <video
                    src={videoFile.previewUrl}
                    className="w-full h-full object-contain"
                    controls
                  />
                  <button
                    onClick={() => setVideoFile(null)}
                    className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-black/70 rounded-lg text-white transition-colors"
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                  <Upload size={32} className="text-gray-400 mb-3" />
                  <span className="text-gray-600 font-medium">点击上传视频</span>
                  <span className="text-sm text-gray-400 mt-1">支持 MP4, MOV, WebM</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleVideoUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* 音频上传区 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <Music size={20} className="text-green-600" />
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">目标音频</h3>
                  <p className="text-sm text-gray-500">要同步口型的音频</p>
                </div>
              </div>

              {audioFile ? (
                <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                  <audio
                    src={audioFile.previewUrl}
                    controls
                    className="flex-1"
                  />
                  <button
                    onClick={() => setAudioFile(null)}
                    className="p-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-600 transition-colors"
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-green-400 hover:bg-green-50/50 transition-colors">
                  <Upload size={28} className="text-gray-400 mb-2" />
                  <span className="text-gray-600 font-medium">点击上传音频</span>
                  <span className="text-sm text-gray-400 mt-1">支持 MP3, WAV, M4A</span>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* 提交按钮 */}
            <button
              onClick={handleSubmit}
              disabled={!videoFile || !audioFile || uploading}
              className={`
                w-full py-4 rounded-xl font-medium text-lg transition-all
                ${videoFile && audioFile && !uploading
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 shadow-lg shadow-purple-500/25'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }
              `}
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={20} className="animate-spin" />
                  上传中 ({uploadProgress}%)
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Sparkles size={20} />
                  开始 AI 口型同步
                </span>
              )}
            </button>
          </div>
        )}

        {/* 处理中步骤 */}
        {step === 'processing' && taskStatus && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-full max-w-md">
              {/* 动画 */}
              <div className="flex justify-center mb-8">
                <RabbitLoader />
              </div>

              {/* 状态信息 */}
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  {getStatusMessage(taskStatus.status, taskStatus.progress)}
                </h2>
                <p className="text-gray-500">
                  {taskStatus.status_message || '请耐心等待，AI 正在努力工作...'}
                </p>
              </div>

              {/* 进度条 */}
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                  style={{ width: `${taskStatus.progress}%` }}
                />
              </div>
              <div className="text-center mt-2 text-sm text-gray-500">
                {taskStatus.progress}%
              </div>

              {/* 失败提示 */}
              {taskStatus.status === 'failed' && (
                <div className="mt-6 p-4 bg-red-50 rounded-xl">
                  <div className="flex items-center gap-3 text-red-600">
                    <AlertCircle size={20} />
                    <span>{taskStatus.error_message || '处理失败，请重试'}</span>
                  </div>
                  <button
                    onClick={handleReset}
                    className="mt-4 w-full py-2 bg-red-100 text-red-600 rounded-lg font-medium hover:bg-red-200 transition-colors"
                  >
                    重新开始
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 结果步骤 */}
        {step === 'result' && taskStatus && (
          <div className="space-y-6">
            {/* 成功提示 */}
            <div className="bg-green-50 rounded-2xl p-6 flex items-center gap-4">
              <CheckCircle size={32} className="text-green-500 flex-shrink-0" />
              <div>
                <h2 className="text-lg font-medium text-gray-900">处理完成！</h2>
                <p className="text-gray-600">AI 口型同步已完成，视频已保存到你的素材库</p>
              </div>
            </div>

            {/* 结果预览 */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="relative aspect-video bg-black">
                {taskStatus.output_url ? (
                  <>
                    <video
                      ref={resultVideoRef}
                      src={taskStatus.output_url}
                      className="w-full h-full object-contain"
                      onEnded={() => setIsPlaying(false)}
                    />
                    <button
                      onClick={handlePlayPause}
                      className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
                    >
                      {isPlaying ? (
                        <Pause size={48} className="text-white" />
                      ) : (
                        <Play size={48} className="text-white" />
                      )}
                    </button>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400">
                    视频加载中...
                  </div>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-4">
              <button
                onClick={handleDownload}
                disabled={!taskStatus.output_url}
                className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                <Download size={20} />
                下载视频
              </button>
              <button
                onClick={handleReset}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw size={20} />
                再做一个
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default RabbitHolePage;
