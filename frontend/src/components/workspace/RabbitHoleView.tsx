'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import heic2any from 'heic2any';
import type { LucideIcon } from 'lucide-react';
import { 
  Sparkles,
  Wand2,
  ArrowLeft,
  Mic,
  Film,
  Images,
  Move,
  Clock,
  UserCircle,
  Layers,
  Upload,
  Loader2,
  X,
  FileVideo,
  FileAudio,
  FileImage,
  Download,
  AlertCircle,
  Image as ImageIcon
} from 'lucide-react';
import {
  createLipSyncTask,
  createTextToVideoTask,
  createImageToVideoTask,
  createMultiImageToVideoTask,
  createMotionControlTask,
  createVideoExtendTask,
  createImageGenerationTask,
  createOmniImageTask,
  createFaceSwapTask,
  pollTaskStatus,
} from '@/features/editor/lib/rabbit-hole-api';
import { createClient } from '@supabase/supabase-js';

// Supabase client for realtime
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// 辅助函数：上传文件并获取公开 URL
async function uploadAndGetUrl(file: File, prefix: string): Promise<string> {
  const timestamp = Date.now();
  const ext = file.name.split('.').pop() || 'bin';
  const path = `rabbit-hole/${prefix}/${timestamp}.${ext}`;
  
  const { error } = await supabase.storage
    .from('ai-creations')
    .upload(path, file, { upsert: true });
  
  if (error) throw new Error(`上传失败: ${error.message}`);
  
  const { data } = supabase.storage.from('ai-creations').getPublicUrl(path);
  return data.publicUrl;
}

// ============================================
// 类型定义
// ============================================

type FeatureId = 
  | 'lip-sync' 
  | 'text-to-video' 
  | 'image-to-video' 
  | 'multi-image-to-video'
  | 'motion-control'
  | 'video-extend'
  | 'image-generation'
  | 'omni-image'
  | 'face-swap';

interface Feature {
  id: FeatureId;
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  category: 'video' | 'image';
  badge?: 'new' | 'hot';
  previewType: 'video' | 'image';
}

// ============================================
// 功能配置
// ============================================

const features: Feature[] = [
  // 视频生成
  {
    id: 'lip-sync',
    title: '口型同步',
    subtitle: 'Lip Sync',
    description: '上传视频和音频，AI 自动同步口型',
    icon: Mic,
    category: 'video',
    badge: 'hot',
    previewType: 'video',
  },
  {
    id: 'text-to-video',
    title: '文生视频',
    subtitle: 'Text to Video',
    description: '输入文字，生成高质量视频',
    icon: Wand2,
    category: 'video',
    badge: 'new',
    previewType: 'video',
  },
  {
    id: 'image-to-video',
    title: '图生视频',
    subtitle: 'Image to Video',
    description: '让静态图片动起来',
    icon: Film,
    category: 'video',
    previewType: 'video',
  },
  {
    id: 'multi-image-to-video',
    title: '多图生视频',
    subtitle: 'Multi-Image',
    description: '多图平滑过渡生成视频',
    icon: Images,
    category: 'video',
    previewType: 'video',
  },
  {
    id: 'motion-control',
    title: '动作控制',
    subtitle: 'Motion Control',
    description: '将动作迁移到图片人物',
    icon: Move,
    category: 'video',
    badge: 'new',
    previewType: 'video',
  },
  {
    id: 'video-extend',
    title: '视频延长',
    subtitle: 'Video Extend',
    description: '延长已生成的视频',
    icon: Clock,
    category: 'video',
    previewType: 'video',
  },
  {
    id: 'face-swap',
    title: 'AI 换脸',
    subtitle: 'Face Swap',
    description: '视频换脸，多形象版本',
    icon: UserCircle,
    category: 'video',
    previewType: 'video',
  },
  // 图像生成
  {
    id: 'image-generation',
    title: '图像生成',
    subtitle: 'Image Gen',
    description: '文字或参考图生成图像',
    icon: ImageIcon,
    category: 'image',
    previewType: 'image',
  },
  {
    id: 'omni-image',
    title: 'Omni-Image',
    subtitle: '多模态图像',
    description: '图像融合、风格迁移',
    icon: Layers,
    category: 'image',
    badge: 'new',
    previewType: 'image',
  },
];

// ============================================
// 主组件
// ============================================

interface RabbitHoleViewProps {
  initialFeatureId?: string | null;
  onFeatureChange?: (featureId: string | null) => void;
}

export function RabbitHoleView({ initialFeatureId, onFeatureChange }: RabbitHoleViewProps) {
  const [selectedFeature, setSelectedFeature] = useState<FeatureId | null>(
    (initialFeatureId as FeatureId) || null
  );

  // 当外部 initialFeatureId 变化时同步
  React.useEffect(() => {
    if (initialFeatureId) {
      setSelectedFeature(initialFeatureId as FeatureId);
    }
  }, [initialFeatureId]);
  
  const handleBack = useCallback(() => {
    setSelectedFeature(null);
    onFeatureChange?.(null);
  }, [onFeatureChange]);

  // 如果选中了功能，显示详情页
  if (selectedFeature) {
    const feature = features.find(f => f.id === selectedFeature);
    if (feature) {
      return <FeatureDetail feature={feature} onBack={handleBack} />;
    }
  }

  // 没有选中功能时，显示引导
  return (
    <div className="flex-1 flex flex-col bg-[#FAFAFA] items-center justify-center">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <Sparkles size={28} className="text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">Rabbit Hole</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          将鼠标悬停在左侧导航栏的 Rabbit Hole 上，<br />选择一个 AI 创作工具开始使用
        </p>
      </div>
    </div>
  );
}

// ============================================
// 功能详情页
// ============================================

interface FeatureDetailProps {
  feature: Feature;
  onBack: () => void;
}

// 表单数据类型
interface FormData {
  // 通用
  prompt?: string;
  negativePrompt?: string;
  // 文件
  videoFile?: File | null;
  audioFile?: File | null;
  imageFile?: File | null;
  faceImageFile?: File | null;
  images?: (File | null)[];
  // 选项
  duration?: string;
  aspectRatio?: string;
  faceIndex?: string;
  mode?: string;
  resolution?: string;
  count?: string;
  direction?: string;
  videoId?: string;
  // 图生图选项
  imageReference?: string;  // 'subject' | 'face'
  imageFidelity?: string;   // 0-1 的字符串
}

function FeatureDetail({ feature, onBack }: FeatureDetailProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [taskProgress, setTaskProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({});
  const Icon = feature.icon;

  // 更新表单数据
  const updateForm = useCallback((updates: Partial<FormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  }, []);

  // 上传文件并获取 URL
  const uploadFileAndGetUrl = async (file: File, prefix: string): Promise<string> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const timestamp = Date.now();
    const ext = file.name.split('.').pop() || 'bin';
    const path = `rabbit-hole/${prefix}/${timestamp}.${ext}`;
    
    const { error } = await supabase.storage
      .from('ai-creations')
      .upload(path, file, { upsert: true });
    
    if (error) throw new Error(`上传失败: ${error.message}`);
    
    const { data } = supabase.storage.from('ai-creations').getPublicUrl(path);
    return data.publicUrl;
  };

  // 生成处理
  const handleGenerate = useCallback(async () => {
    setError(null);
    setIsGenerating(true);
    setIsUploading(true);
    setUploadProgress(0);
    setTaskProgress(0);
    setStatusMessage('准备上传文件...');

    try {
      let taskId: string | null = null;

      // 根据不同功能调用不同 API
      switch (feature.id) {
        case 'lip-sync': {
          if (!formData.videoFile || !formData.audioFile) {
            throw new Error('请上传视频和音频文件');
          }
          setStatusMessage('上传视频...');
          setUploadProgress(20);
          const videoUrl = await uploadFileAndGetUrl(formData.videoFile, 'video');
          setStatusMessage('上传音频...');
          setUploadProgress(50);
          const audioUrl = await uploadFileAndGetUrl(formData.audioFile, 'audio');
          setIsUploading(false);
          setUploadProgress(100);
          setStatusMessage('创建口型同步任务...');
          
          const response = await createLipSyncTask({
            video_url: videoUrl,
            audio_url: audioUrl,
            face_index: parseInt(formData.faceIndex || '0'),
          });
          taskId = response.task_id;
          break;
        }

        case 'text-to-video': {
          if (!formData.prompt) {
            throw new Error('请输入提示词');
          }
          setIsUploading(false);
          setStatusMessage('创建文生视频任务...');
          
          const response = await createTextToVideoTask({
            prompt: formData.prompt,
            negative_prompt: formData.negativePrompt,
            duration: (formData.duration || '5') as '5' | '10',
            aspect_ratio: (formData.aspectRatio || '16:9') as '16:9' | '9:16' | '1:1',
          });
          taskId = response.task_id;
          break;
        }

        case 'image-to-video': {
          if (!formData.imageFile) {
            throw new Error('请上传图片');
          }
          setStatusMessage('上传图片...');
          setUploadProgress(50);
          const imageUrl = await uploadFileAndGetUrl(formData.imageFile, 'image');
          setIsUploading(false);
          setUploadProgress(100);
          setStatusMessage('创建图生视频任务...');
          
          const response = await createImageToVideoTask({
            image: imageUrl,
            prompt: formData.prompt,
            duration: (formData.duration || '5') as '5' | '10',
          });
          taskId = response.task_id;
          break;
        }

        case 'multi-image-to-video': {
          const validImages = (formData.images || []).filter((f): f is File => f !== null);
          if (validImages.length < 2) {
            throw new Error('请至少上传 2 张图片');
          }
          setStatusMessage('上传图片...');
          const imageUrls: string[] = [];
          for (let i = 0; i < validImages.length; i++) {
            setUploadProgress(Math.round((i / validImages.length) * 80));
            const url = await uploadFileAndGetUrl(validImages[i], 'image');
            imageUrls.push(url);
          }
          setIsUploading(false);
          setUploadProgress(100);
          setStatusMessage('创建多图生视频任务...');
          
          const response = await createMultiImageToVideoTask({
            images: imageUrls,
            prompt: formData.prompt,
            duration: (formData.duration || '5') as '5' | '10',
          });
          taskId = response.task_id;
          break;
        }

        case 'motion-control': {
          if (!formData.imageFile || !formData.videoFile) {
            throw new Error('请上传图片和动作视频');
          }
          setStatusMessage('上传图片...');
          setUploadProgress(30);
          const imageUrl = await uploadFileAndGetUrl(formData.imageFile, 'image');
          setStatusMessage('上传动作视频...');
          setUploadProgress(60);
          const videoUrl = await uploadFileAndGetUrl(formData.videoFile, 'video');
          setIsUploading(false);
          setUploadProgress(100);
          setStatusMessage('创建动作控制任务...');
          
          const response = await createMotionControlTask({
            image: imageUrl,
            video_url: videoUrl,
            prompt: formData.prompt,
            mode: (formData.mode || 'pro') as 'normal' | 'pro',
          });
          taskId = response.task_id;
          break;
        }

        case 'video-extend': {
          if (!formData.videoId) {
            throw new Error('请输入视频 ID');
          }
          setIsUploading(false);
          setStatusMessage('创建视频延长任务...');
          
          const response = await createVideoExtendTask({
            video_id: formData.videoId,
            prompt: formData.prompt,
            extend_direction: (formData.direction || 'end') as 'start' | 'end',
          });
          taskId = response.task_id;
          break;
        }

        case 'image-generation': {
          if (!formData.prompt) {
            throw new Error('请输入提示词');
          }
          let imageUrl: string | undefined;
          if (formData.imageFile) {
            setStatusMessage('上传参考图片...');
            setUploadProgress(50);
            imageUrl = await uploadFileAndGetUrl(formData.imageFile, 'image');
          }
          setIsUploading(false);
          setUploadProgress(100);
          setStatusMessage('创建图像生成任务...');
          
          const response = await createImageGenerationTask({
            prompt: formData.prompt,
            negative_prompt: formData.negativePrompt,
            aspect_ratio: formData.aspectRatio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '2:3' | '3:2',
            n: parseInt(formData.count || '1'),
            image: imageUrl,
            // 图生图时，自动使用 subject 模式保留人物特征
            image_reference: imageUrl ? (formData.imageReference as 'subject' | 'face' || 'subject') : undefined,
            image_fidelity: imageUrl ? parseFloat(formData.imageFidelity || '0.5') : undefined,
          });
          taskId = response.task_id;
          break;
        }

        case 'omni-image': {
          if (!formData.prompt) {
            throw new Error('请输入提示词');
          }
          const validImages = (formData.images || []).filter((f): f is File => f !== null);
          if (validImages.length === 0) {
            throw new Error('请至少上传 1 张图片');
          }
          setStatusMessage('上传图片...');
          const imageList: { image: string; var?: string }[] = [];
          for (let i = 0; i < validImages.length; i++) {
            setUploadProgress(Math.round((i / validImages.length) * 80));
            const url = await uploadFileAndGetUrl(validImages[i], 'image');
            imageList.push({ image: url });
          }
          setIsUploading(false);
          setUploadProgress(100);
          setStatusMessage('创建 Omni-Image 任务...');
          
          const response = await createOmniImageTask({
            prompt: formData.prompt,
            image_list: imageList,
            resolution: (formData.resolution || '1k') as '1k' | '1.5k' | '2k',
          });
          taskId = response.task_id;
          break;
        }

        case 'face-swap': {
          if (!formData.videoFile || !formData.faceImageFile) {
            throw new Error('请上传视频和人脸图片');
          }
          setStatusMessage('上传视频...');
          setUploadProgress(30);
          const videoUrl = await uploadFileAndGetUrl(formData.videoFile, 'video');
          setStatusMessage('上传人脸图片...');
          setUploadProgress(60);
          const faceImageUrl = await uploadFileAndGetUrl(formData.faceImageFile, 'image');
          setIsUploading(false);
          setUploadProgress(100);
          setStatusMessage('创建换脸任务...');
          
          const response = await createFaceSwapTask({
            video_url: videoUrl,
            face_image_url: faceImageUrl,
            face_index: parseInt(formData.faceIndex || '0'),
          });
          taskId = response.task_id;
          break;
        }

        default:
          throw new Error('暂不支持此功能');
      }

      // 轮询任务状态
      if (taskId) {
        setStatusMessage('AI 正在处理中...');
        const result = await pollTaskStatus(taskId, {
          interval: 3000,
          maxAttempts: 200,
          onProgress: (task) => {
            setTaskProgress(task.progress);
            setStatusMessage(task.status_message || `处理中 ${task.progress}%`);
          },
        });

        if (result.status === 'completed' && result.output_url) {
          setGeneratedUrl(result.output_url);
          setStatusMessage('生成完成！');
        } else if (result.status === 'failed') {
          throw new Error(result.error_message || '生成失败');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
      setIsUploading(false);
    }
  }, [feature.id, formData]);

  return (
    <div className="flex-1 flex flex-col bg-[#FAFAFA]">
      {/* Header */}
      <header className="h-14 px-4 flex items-center border-b border-gray-200/60">
        <button 
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[14px] font-semibold text-gray-800">{feature.title}</span>
        </div>
        <div className="w-9" />
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧 - 输入区 */}
        <div className="w-[360px] border-r border-gray-200/60 flex flex-col bg-white">
          {/* 表单区 */}
          <div className="flex-1 overflow-auto p-5">
            <FeatureForm featureId={feature.id} formData={formData} updateForm={updateForm} />
          </div>
          
          {/* Generate 按钮 */}
          <div className="p-4 border-t border-gray-100">
            {error && (
              <div className="mb-3 p-3 bg-red-50 rounded-lg flex items-center gap-2 text-red-600 text-[13px]">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            <button 
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full h-11 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-[13px] shadow-sm"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>{isUploading ? `上传中 ${uploadProgress}%` : `生成中 ${taskProgress}%`}</span>
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  <span>生成</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 右侧 - 预览区 */}
        <div className="flex-1 flex flex-col bg-[#F5F5F5]">
          <div className="flex-1 flex items-center justify-center p-10">
            <PreviewArea 
              feature={feature} 
              generatedUrl={generatedUrl}
              isGenerating={isGenerating}
              statusMessage={statusMessage}
              progress={isUploading ? uploadProgress : taskProgress}
            />
          </div>
          
          {/* 功能说明 */}
          <div className="px-10 pb-10">
            <div className="max-w-md mx-auto text-center">
              <p className="text-[13px] text-gray-400 leading-relaxed">
                {feature.description}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// 预览区组件
// ============================================

interface PreviewAreaProps {
  feature: Feature;
  generatedUrl: string | null;
  isGenerating: boolean;
  statusMessage?: string;
  progress?: number;
}

function PreviewArea({ feature, generatedUrl, isGenerating, statusMessage, progress }: PreviewAreaProps) {
  const Icon = feature.icon;

  if (isGenerating) {
    return (
      <div className="w-full max-w-lg aspect-video bg-white rounded-2xl flex flex-col items-center justify-center border border-gray-200 shadow-sm">
        <Loader2 size={36} className="text-gray-300 animate-spin mb-4" />
        <p className="text-[13px] text-gray-600 mb-2">{statusMessage || 'AI 正在创作中...'}</p>
        {progress !== undefined && progress > 0 && (
          <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gray-800 transition-all duration-300" 
              style={{ width: `${progress}%` }} 
            />
          </div>
        )}
      </div>
    );
  }

  if (generatedUrl) {
    return (
      <div className="w-full max-w-lg aspect-video bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-sm relative group">
        {feature.previewType === 'video' ? (
          <video src={generatedUrl} controls className="w-full h-full object-contain" />
        ) : (
          <img src={generatedUrl} alt="Generated" className="w-full h-full object-contain" />
        )}
        <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <a 
            href={generatedUrl} 
            download 
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-[13px] rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Download size={14} />
            下载
          </a>
        </div>
      </div>
    );
  }

  // 空状态
  return (
    <div className="w-full max-w-lg aspect-video bg-white rounded-2xl flex flex-col items-center justify-center border border-gray-200 shadow-sm">
      <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mb-4">
        <Icon size={28} className="text-gray-300" />
      </div>
      <p className="text-[13px] text-gray-400 mb-1">预览区域</p>
      <p className="text-[12px] text-gray-300">生成的内容将在此显示</p>
    </div>
  );
}

// ============================================
// 功能表单路由
// ============================================

interface FeatureFormProps {
  featureId: FeatureId;
  formData: FormData;
  updateForm: (updates: Partial<FormData>) => void;
}

function FeatureForm({ featureId, formData, updateForm }: FeatureFormProps) {
  switch (featureId) {
    case 'lip-sync':
      return <LipSyncForm formData={formData} updateForm={updateForm} />;
    case 'text-to-video':
      return <TextToVideoForm formData={formData} updateForm={updateForm} />;
    case 'image-to-video':
      return <ImageToVideoForm formData={formData} updateForm={updateForm} />;
    case 'multi-image-to-video':
      return <MultiImageToVideoForm formData={formData} updateForm={updateForm} />;
    case 'motion-control':
      return <MotionControlForm formData={formData} updateForm={updateForm} />;
    case 'video-extend':
      return <VideoExtendForm formData={formData} updateForm={updateForm} />;
    case 'image-generation':
      return <ImageGenerationForm formData={formData} updateForm={updateForm} />;
    case 'omni-image':
      return <OmniImageForm formData={formData} updateForm={updateForm} />;
    case 'face-swap':
      return <FaceSwapForm formData={formData} updateForm={updateForm} />;
    default:
      return null;
  }
}

// ============================================
// 通用组件
// ============================================

interface FileUploadProps {
  label: string;
  accept: string;
  hint?: string;
  icon?: React.ReactNode;
  value?: File | null;
  onChange?: (file: File | null) => void;
}

// 检查是否为需要转换的非标准图片格式
function isNonStandardImageFormat(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif') || 
         file.type === 'image/heic' || file.type === 'image/heif';
}

function FileUpload({ label, accept, hint, icon, value, onChange }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // 生成图片预览 URL（非标准格式先转换）
  useEffect(() => {
    if (value && accept.includes('image')) {
      // 检查是否为 HEIC/HEIF 等非标准格式
      if (isNonStandardImageFormat(value)) {
        setIsConverting(true);
        heic2any({ blob: value, toType: 'image/jpeg', quality: 0.8 })
          .then((result) => {
            const blob = Array.isArray(result) ? result[0] : result;
            const url = URL.createObjectURL(blob);
            setPreviewUrl(url);
          })
          .catch((err) => {
            console.error('图片格式转换失败:', err);
            // 降级：显示文件名而非预览
            setPreviewUrl(null);
          })
          .finally(() => setIsConverting(false));
      } else {
        // 标准格式直接渲染
        const url = URL.createObjectURL(value);
        setPreviewUrl(url);
      }
      return () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      };
    } else {
      setPreviewUrl(null);
    }
  }, [value, accept]);

  const handleClick = () => inputRef.current?.click();
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    onChange?.(file);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  // 已上传文件 - 图片显示预览
  if (value) {
    const isImage = accept.includes('image');
    const hasPreview = previewUrl !== null;
    
    return (
      <div className="relative">
        {isImage && (hasPreview || isConverting) ? (
          // 图片预览 - 自适应长宽
          <div className="relative rounded-xl overflow-hidden border border-gray-200">
            {isConverting ? (
              // 转换中显示加载状态
              <div className="w-full h-32 bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                  <Loader2 size={24} className="text-gray-400 animate-spin mx-auto mb-2" />
                  <p className="text-xs text-gray-400">转换中...</p>
                </div>
              </div>
            ) : (
              <img 
                src={previewUrl!} 
                alt={value.name}
                className="w-full max-h-64 object-contain bg-gray-50"
              />
            )}
            <button
              onClick={handleRemove}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              <X size={14} className="text-white" />
            </button>
          </div>
        ) : (
          // 非图片文件显示文件名
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
            <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow-sm">
              {icon || <FileVideo size={16} className="text-gray-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-gray-700 truncate font-medium">{value.name}</p>
              <p className="text-[11px] text-gray-400">{(value.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button
              onClick={handleRemove}
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-200 transition-colors"
            >
              <X size={14} className="text-gray-400" />
            </button>
          </div>
        )}
        <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={handleClick}
        className="w-full p-5 border-2 border-dashed border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-all duration-200 text-center"
      >
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-2.5">
          {icon || <Upload size={18} className="text-gray-400" />}
        </div>
        <p className="text-[13px] text-gray-600 font-medium mb-0.5">{label}</p>
        {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
      </button>
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
    </div>
  );
}

interface TextInputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  multiline?: boolean;
  hint?: string;
}

function TextInput({ label, placeholder, value, onChange, multiline, hint }: TextInputProps) {
  const baseClasses = "w-full px-3.5 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[13px] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-300 focus:bg-white transition-all";
  
  return (
    <div className="space-y-2">
      {label && <label className="block text-[12px] text-gray-500 font-medium">{label}</label>}
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          rows={4}
          className={`${baseClasses} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className={baseClasses}
        />
      )}
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

interface SelectInputProps {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string }[];
}

function SelectInput({ label, value, onChange, options }: SelectInputProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-[12px] text-gray-600 focus:outline-none focus:border-gray-300 transition-colors"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

interface ToggleGroupProps {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string }[];
}

function ToggleGroup({ label, value, onChange, options }: ToggleGroupProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-gray-500">{label}</span>
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange?.(opt.value)}
            className={`px-3 py-1.5 text-[12px] rounded-md transition-all duration-200 ${
              value === opt.value
                ? 'bg-white text-gray-800 font-medium shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-gray-100 my-5" />;
}

// ============================================
// 各功能表单
// ============================================

interface FormProps {
  formData: FormData;
  updateForm: (updates: Partial<FormData>) => void;
}

function LipSyncForm({ formData, updateForm }: FormProps) {
  return (
    <div className="space-y-4">
      <FileUpload 
        label="上传视频"
        accept="video/*"
        hint="时长 3-60 秒"
        icon={<FileVideo size={18} className="text-gray-400" />}
        value={formData.videoFile}
        onChange={(file) => updateForm({ videoFile: file })}
      />
      <FileUpload 
        label="上传音频"
        accept="audio/*"
        hint="MP3, WAV, M4A"
        icon={<FileAudio size={18} className="text-gray-400" />}
        value={formData.audioFile}
        onChange={(file) => updateForm({ audioFile: file })}
      />
      <Divider />
      <SelectInput
        label="人脸索引"
        value={formData.faceIndex || '0'}
        onChange={(v) => updateForm({ faceIndex: v })}
        options={[
          { value: '0', label: '第 1 张脸' },
          { value: '1', label: '第 2 张脸' },
        ]}
      />
    </div>
  );
}

function TextToVideoForm({ formData, updateForm }: FormProps) {
  return (
    <div className="space-y-4">
      <TextInput
        label="提示词"
        placeholder="描述你想生成的视频内容..."
        value={formData.prompt || ''}
        onChange={(v) => updateForm({ prompt: v })}
        multiline
      />
      <TextInput
        label="负面提示词"
        placeholder="不想出现的内容（可选）"
        value={formData.negativePrompt || ''}
        onChange={(v) => updateForm({ negativePrompt: v })}
        hint="可选"
      />
      <Divider />
      <ToggleGroup
        label="视频时长"
        value={formData.duration || '5'}
        onChange={(v) => updateForm({ duration: v })}
        options={[
          { value: '5', label: '5 秒' },
          { value: '10', label: '10 秒' },
        ]}
      />
      <SelectInput
        label="宽高比"
        value={formData.aspectRatio || '16:9'}
        onChange={(v) => updateForm({ aspectRatio: v })}
        options={[
          { value: '16:9', label: '16:9 横屏' },
          { value: '9:16', label: '9:16 竖屏' },
          { value: '1:1', label: '1:1 方形' },
        ]}
      />
    </div>
  );
}

function ImageToVideoForm({ formData, updateForm }: FormProps) {
  return (
    <div className="space-y-4">
      <FileUpload 
        label="上传图片"
        accept="image/*"
        hint="JPG, PNG, 建议 1024×1024 以上"
        icon={<FileImage size={18} className="text-gray-400" />}
        value={formData.imageFile}
        onChange={(file) => updateForm({ imageFile: file })}
      />
      <TextInput
        label="提示词"
        placeholder="描述图片动起来的方式..."
        value={formData.prompt || ''}
        onChange={(v) => updateForm({ prompt: v })}
        multiline
        hint="可选"
      />
      <Divider />
      <ToggleGroup
        label="视频时长"
        value={formData.duration || '5'}
        onChange={(v) => updateForm({ duration: v })}
        options={[
          { value: '5', label: '5 秒' },
          { value: '10', label: '10 秒' },
        ]}
      />
    </div>
  );
}

function MultiImageToVideoForm({ formData, updateForm }: FormProps) {
  const images = formData.images || [null, null, null, null];
  
  const updateImage = (index: number, file: File | null) => {
    const newImages = [...images];
    newImages[index] = file;
    updateForm({ images: newImages });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <FileUpload
            key={i}
            label={`图片 ${i + 1}`}
            accept="image/*"
            hint={i < 2 ? '必需' : '可选'}
            icon={<FileImage size={16} className="text-gray-400" />}
            value={images[i]}
            onChange={(file) => updateImage(i, file)}
          />
        ))}
      </div>
      <TextInput
        label="提示词"
        placeholder="描述场景过渡方式..."
        value={formData.prompt || ''}
        onChange={(v) => updateForm({ prompt: v })}
        multiline
        hint="可选"
      />
      <Divider />
      <ToggleGroup
        label="视频时长"
        value={formData.duration || '5'}
        onChange={(v) => updateForm({ duration: v })}
        options={[
          { value: '5', label: '5 秒' },
          { value: '10', label: '10 秒' },
        ]}
      />
    </div>
  );
}

function MotionControlForm({ formData, updateForm }: FormProps) {
  return (
    <div className="space-y-4">
      <FileUpload 
        label="人物图片"
        accept="image/*"
        hint="要驱动的人物照片"
        icon={<FileImage size={18} className="text-gray-400" />}
        value={formData.imageFile}
        onChange={(file) => updateForm({ imageFile: file })}
      />
      <FileUpload 
        label="动作视频"
        accept="video/*"
        hint="动作参考视频"
        icon={<FileVideo size={18} className="text-gray-400" />}
        value={formData.videoFile}
        onChange={(file) => updateForm({ videoFile: file })}
      />
      <TextInput
        label="提示词"
        placeholder="补充描述..."
        value={formData.prompt || ''}
        onChange={(v) => updateForm({ prompt: v })}
        hint="可选"
      />
      <Divider />
      <ToggleGroup
        label="模式"
        value={formData.mode || 'pro'}
        onChange={(v) => updateForm({ mode: v })}
        options={[
          { value: 'normal', label: '普通' },
          { value: 'pro', label: '专业' },
        ]}
      />
    </div>
  );
}

function VideoExtendForm({ formData, updateForm }: FormProps) {
  return (
    <div className="space-y-4">
      <TextInput
        label="视频 ID"
        placeholder="输入可灵生成的视频 ID"
        value={formData.videoId || ''}
        onChange={(v) => updateForm({ videoId: v })}
        hint="仅支持可灵 AI 生成的视频"
      />
      <TextInput
        label="提示词"
        placeholder="描述延长内容..."
        value={formData.prompt || ''}
        onChange={(v) => updateForm({ prompt: v })}
        multiline
        hint="可选"
      />
      <Divider />
      <ToggleGroup
        label="延长方向"
        value={formData.direction || 'end'}
        onChange={(v) => updateForm({ direction: v })}
        options={[
          { value: 'start', label: '向前' },
          { value: 'end', label: '向后' },
        ]}
      />
    </div>
  );
}

function ImageGenerationForm({ formData, updateForm }: FormProps) {
  const hasImage = !!formData.imageFile;
  
  return (
    <div className="space-y-4">
      <TextInput
        label="提示词"
        placeholder={hasImage ? "描述你想要的变化，如：背景换成夜晚" : "描述你想生成的图像..."}
        value={formData.prompt || ''}
        onChange={(v) => updateForm({ prompt: v })}
        multiline
      />
      <FileUpload 
        label="参考图片"
        accept="image/*"
        hint="可选，用于图生图（保留人物/背景替换等）"
        icon={<FileImage size={18} className="text-gray-400" />}
        value={formData.imageFile}
        onChange={(file) => updateForm({ imageFile: file })}
      />
      
      {/* 图生图高级选项 */}
      {hasImage && (
        <>
          <Divider />
          <div className="text-xs text-gray-500 mb-2">图生图选项</div>
          <SelectInput
            label="参考模式"
            value={formData.imageReference || 'subject'}
            onChange={(v) => updateForm({ imageReference: v })}
            options={[
              { value: 'subject', label: '人物特征（保留人物外观）' },
              { value: 'face', label: '人脸特征（仅保留脸部）' },
            ]}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              参考强度: {formData.imageFidelity || '0.5'}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={formData.imageFidelity || '0.5'}
              onChange={(e) => updateForm({ imageFidelity: e.target.value })}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>创意更多</span>
              <span>更像原图</span>
            </div>
          </div>
        </>
      )}
      
      <Divider />
      <SelectInput
        label="宽高比"
        value={formData.aspectRatio || '1:1'}
        onChange={(v) => updateForm({ aspectRatio: v })}
        options={[
          { value: '1:1', label: '1:1 方形' },
          { value: '16:9', label: '16:9 横屏' },
          { value: '9:16', label: '9:16 竖屏' },
          { value: '4:3', label: '4:3' },
          { value: '3:4', label: '3:4' },
        ]}
      />
      <SelectInput
        label="生成数量"
        value={formData.count || '1'}
        onChange={(v) => updateForm({ count: v })}
        options={[
          { value: '1', label: '1 张' },
          { value: '4', label: '4 张' },
          { value: '9', label: '9 张' },
        ]}
      />
    </div>
  );
}

function OmniImageForm({ formData, updateForm }: FormProps) {
  const images = formData.images || [null, null, null, null];
  
  const updateImage = (index: number, file: File | null) => {
    const newImages = [...images];
    newImages[index] = file;
    updateForm({ images: newImages });
  };

  return (
    <div className="space-y-4">
      <TextInput
        label="提示词"
        placeholder="使用 <<<image_1>>> <<<image_2>>> 引用图片..."
        value={formData.prompt || ''}
        onChange={(v) => updateForm({ prompt: v })}
        multiline
      />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <FileUpload
            key={i}
            label={`图片 ${i + 1}`}
            accept="image/*"
            hint={i < 1 ? '必需' : '可选'}
            icon={<FileImage size={16} className="text-gray-400" />}
            value={images[i]}
            onChange={(file) => updateImage(i, file)}
          />
        ))}
      </div>
      <Divider />
      <SelectInput
        label="分辨率"
        value={formData.resolution || '1k'}
        onChange={(v) => updateForm({ resolution: v })}
        options={[
          { value: '1k', label: '1K' },
          { value: '1.5k', label: '1.5K' },
          { value: '2k', label: '2K' },
        ]}
      />
    </div>
  );
}

function FaceSwapForm({ formData, updateForm }: FormProps) {
  return (
    <div className="space-y-4">
      <FileUpload 
        label="源视频"
        accept="video/*"
        hint="要换脸的视频"
        icon={<FileVideo size={18} className="text-gray-400" />}
        value={formData.videoFile}
        onChange={(file) => updateForm({ videoFile: file })}
      />
      <FileUpload 
        label="人脸照片"
        accept="image/*"
        hint="目标人脸图片"
        icon={<FileImage size={18} className="text-gray-400" />}
        value={formData.faceImageFile}
        onChange={(file) => updateForm({ faceImageFile: file })}
      />
      <Divider />
      <SelectInput
        label="人脸索引"
        value={formData.faceIndex || '0'}
        onChange={(v) => updateForm({ faceIndex: v })}
        options={[
          { value: '0', label: '第 1 张脸' },
          { value: '1', label: '第 2 张脸' },
          { value: '2', label: '第 3 张脸' },
        ]}
      />
    </div>
  );
}
