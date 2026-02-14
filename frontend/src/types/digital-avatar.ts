/* ================================================================
   类型定义 — 数字人形象模板 (System C)
   
   对齐 Kling 智能播报 API 参数:
     image     — 数字人参考图 (portrait_url)
     audio_id / sound_file — 音频来源 (voice_id / audio_url)
     prompt    — 动作/表情/运镜提示词 (generation_config.image_gen_prompt)
     mode      — std / pro (generation_config.broadcast_mode)
   
   数据流:
     Admin: 上传/生成人像 → 配置音色 + prompt + mode → 发布形象
     User:  选形象 → 输入脚本/音频 → 生成口播视频 → (可选换脸)
   ================================================================ */

// ---- Kling 生成配置 ----

export interface AvatarGenerationConfig {
  /** Kling mode: std (标准/性价比) / pro (专家/高品质) */
  broadcast_mode?: 'std' | 'pro';
  /** Kling prompt: 图生视频时的动作/表情/运镜提示词 */
  image_gen_prompt?: string;
  /** 视频默认时长 */
  broadcast_duration?: '5' | '10';
}

// ---- 旧字段类型 (向后兼容, DB 中可能存在) ----

export type AvatarStyle =
  | 'professional' | 'casual' | 'creative'
  | 'elegant' | 'energetic' | 'warm';

export type AvatarGender = 'male' | 'female' | 'neutral';

// ---- 数字人形象模板 ----

export interface DigitalAvatarTemplate {
  id: string;
  
  // 基本信息
  name: string;
  description?: string;
  
  // 形象资产 — 对应 Kling image 参数
  portrait_url: string;          // 主图 (正面照)
  reference_images?: string[];   // 多角度参考图 URL (含主图，3-5 张)
  portrait_prompt?: string;
  thumbnail_url?: string;
  demo_video_url?: string;
  
  // 音色配置 — 对应 Kling audio_id / sound_file
  default_voice_id: string;
  default_voice_name?: string;
  voice_sample_url?: string;
  
  // Kling 生成配置
  generation_config: AvatarGenerationConfig;
  
  // 旧字段 (向后兼容, 仅展示用)
  gender?: AvatarGender;
  style?: AvatarStyle;
  age_range?: string;
  ethnicity?: string;
  tags?: string[];
  
  // 运营数据
  usage_count: number;
  trending_score: number;
  is_featured: boolean;
  
  // 状态
  status: 'draft' | 'published' | 'archived';
  created_by?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
}

// ---- 用户生成记录 ----

export type GenerationStatus = 
  | 'pending'          // 刚创建
  | 'broadcasting'     // 正在生成口播视频
  | 'swapping'         // 正在换脸
  | 'completed'        // 完成
  | 'failed';          // 失败

export type GenerationInputType = 'script' | 'audio' | 'voice_clone';

export interface AvatarGeneration {
  id: string;
  user_id: string;
  avatar_id: string;
  
  // 输入
  input_type: GenerationInputType;
  script?: string;
  audio_url?: string;
  voice_id?: string;
  
  // 链路任务
  broadcast_task_id?: string;
  face_swap_task_id?: string;
  
  // 输出
  output_video_url?: string;
  
  // 状态
  status: GenerationStatus;
  error_message?: string;
  
  created_at: string;
  completed_at?: string;
  
  // 关联形象 (join)
  digital_avatar_templates?: Pick<DigitalAvatarTemplate, 'id' | 'name' | 'portrait_url' | 'thumbnail_url'>;
}

// ---- 生成请求 ----

export interface GenerateWithAvatarRequest {
  // 音频来源三选一 → Kling audio_id / sound_file
  script?: string;
  audio_url?: string;
  voice_clone_audio_url?: string;
  
  // TTS 配置
  voice_id?: string;
  
  // 可选换脸
  face_image_url?: string;
  
  // Kling 参数
  duration?: '5' | '10';
  prompt?: string;        // Kling: prompt (动作/表情/运镜)
  mode?: 'std' | 'pro';   // Kling: mode
}

export interface GenerateWithAvatarResponse {
  success: boolean;
  generation_id: string;
  broadcast_task_id: string;
  mode: GenerationInputType;
  has_face_swap: boolean;
  estimated_time: string;
}

// ---- 创建/更新请求 ----

export interface CreateAvatarRequest {
  name: string;
  description?: string;
  portrait_url: string;
  reference_images?: string[];
  portrait_prompt?: string;
  thumbnail_url?: string;
  demo_video_url?: string;
  default_voice_id?: string;
  default_voice_name?: string;
  voice_sample_url?: string;
  generation_config?: AvatarGenerationConfig;
  /** 🆕 P1: 引导式生成的角色属性 */
  gender?: 'male' | 'female' | 'neutral';
  age_range?: string;
  ethnicity?: string;
  style?: string;
  tags?: string[];
}

export interface UpdateAvatarRequest {
  name?: string;
  description?: string;
  portrait_url?: string;
  reference_images?: string[];
  portrait_prompt?: string;
  thumbnail_url?: string;
  demo_video_url?: string;
  default_voice_id?: string;
  default_voice_name?: string;
  voice_sample_url?: string;
  generation_config?: AvatarGenerationConfig;
  trending_score?: number;
  is_featured?: boolean;
}

// ---- UI 元数据 (向后兼容: 卡片展示旧数据) ----

export const AVATAR_STYLE_META: Record<AvatarStyle, { label: string; emoji: string; color: string }> = {
  professional:  { label: '职业',   emoji: '💼', color: 'bg-slate-50 text-slate-600' },
  casual:        { label: '休闲',   emoji: '☕', color: 'bg-gray-100 text-gray-600' },
  creative:      { label: '创意',   emoji: '🎨', color: 'bg-gray-50 text-gray-600' },
  elegant:       { label: '优雅',   emoji: '✨', color: 'bg-gray-100 text-gray-600' },
  energetic:     { label: '活力',   emoji: '⚡', color: 'bg-gray-100 text-gray-600' },
  warm:          { label: '温暖',   emoji: '🌸', color: 'bg-gray-50 text-gray-600' },
};

export const AVATAR_GENDER_LABELS: Record<AvatarGender, string> = {
  male: '男性',
  female: '女性',
  neutral: '中性',
};
