/* ================================================================
   类型定义 — PRD §3.2 / §3.3 / §4 / §5
   
   TrendTemplate · RouteStep · CapabilityType · Node 类型
   ================================================================ */

// ---- 能力类型枚举 ----

export type CapabilityType =
  | 'hair_color'       // 换发色
  | 'outfit'           // 换穿搭
  | 'background'       // 换场景/背景
  | 'lighting'         // 换打光
  | 'style_transfer'   // 风格变换
  | 'action_transfer'  // 动作迁移
  | 'angle'            // 角度变换
  | 'enhance'          // 质感增强
  | 'image_to_video';  // 图转视频

// ---- 模板分类 ----

export type TemplateCategory =
  | 'hair'
  | 'outfit'
  | 'scene'       // PRD 用 scene，对齐
  | 'lighting'
  | 'style'
  | 'action'
  | 'mixed';      // PRD §3.2: mixed（综合）

// ---- Golden Preset ----

export type GoldenPreset =
  | 'spin_occlusion_outfit'   // 360°旋转遮挡变身
  | 'whip_pan_outfit'         // 快速横移模糊变身
  | 'space_warp_outfit';      // 空间穿越门变身

// ---- 链路步骤 (PRD §3.2 RouteStep) ----

export interface RouteStep {
  /** 使用的能力 */
  capability: CapabilityType;
  /** 能力参数 */
  params: Record<string, unknown>;
  /** 带 {placeholder} 的prompt模板 */
  prompt_template: string;
  /** AI 给出的原因说明 */
  reason?: string;
  /** 预计消耗 credits */
  estimated_credits?: number;
}

// ---- 可编辑参数 (PRD §3.3.3 EditableParam) ----

export interface EditableParam {
  key: string;
  label: string;
  type: 'color' | 'text' | 'select' | 'image' | 'slider';
  value: unknown;
  options?: { label: string; value: unknown }[];
  min?: number;
  max?: number;
  step?: number;
}

// ---- TrendTemplate (PRD §3.2 数据结构) ----

export interface TrendTemplate {
  id: string;
  name: string;
  category: TemplateCategory;

  // 展示
  preview_video_url?: string;     // 示范视频
  thumbnail_url: string;
  usage_count: number;

  // 能力链路 — 模板本质是预设的节点图
  route: RouteStep[];

  // 过渡配置（Golden Preset）
  golden_preset?: GoldenPreset;

  // 生成参数
  output_duration: number;        // 秒
  output_aspect_ratio: '16:9' | '9:16';

  // 来源
  author_type: 'official' | 'ugc';
  author_id?: string;

  // 元数据
  tags: string[];
  created_at: string;
  updated_at?: string;

  // 状态
  status: 'draft' | 'published' | 'archived';
}

// ---- 画布节点数据 (PRD §3.3.3) ----

/** 源节点 */
export interface SourceNodeData {
  type: 'source';
  media_type: 'image' | 'video';
  url: string;
  thumbnail_url?: string;
  role: 'user_photo' | 'reference' | 'material';
  analysis?: {
    skin_tone?: string;
    hair_color?: string;
    clothing?: string;
    lighting?: string;
    scene?: string;
    pose?: string;
    style_tags?: string[];
  };
}

/** 能力节点 */
export interface ProcessorNodeData {
  type: 'processor';
  capability: CapabilityType;
  params: Record<string, unknown>;
  prompt: string;
  status: 'draft' | 'pending' | 'processing' | 'completed' | 'error';
  editable_params: EditableParam[];
  ai_reason?: string;
}

/** 结果节点 */
export interface ResultNodeData {
  type: 'result';
  media_type: 'image' | 'video';
  url?: string;
  thumbnail_url?: string;
  status: 'waiting' | 'generating' | 'completed' | 'error';
  generation_time?: number;
}

// ---- IntentRouter 输出 (PRD §4.2) ----

export interface RouteResult {
  route: RouteStep[];
  overall_description: string;
  suggested_golden_preset?: GoldenPreset;
  suggested_output_duration: number;
  total_estimated_credits: number;
  confidence: number;
}

// ---- 元数据 ----

export const CATEGORY_META: Record<TemplateCategory, { label: string; emoji: string; color: string }> = {
  hair:       { label: '发型发色',  emoji: '💇', color: 'bg-gray-100 text-gray-600' },
  outfit:     { label: '穿搭换装',  emoji: '👗', color: 'bg-gray-50 text-gray-600' },
  scene:      { label: '场景背景',  emoji: '🌄', color: 'bg-gray-50 text-gray-600' },
  lighting:   { label: '光影氛围',  emoji: '✨', color: 'bg-gray-100 text-gray-600' },
  style:      { label: '风格迁移',  emoji: '🎨', color: 'bg-gray-50 text-gray-600' },
  action:     { label: '动作模仿',  emoji: '🏃', color: 'bg-gray-50 text-gray-600' },
  mixed:      { label: '综合变身',  emoji: '🦋', color: 'bg-gray-100 text-gray-600' },
};

export const CAPABILITY_LABELS: Record<CapabilityType, string> = {
  hair_color:      '换发色',
  outfit:          '换穿搭',
  background:      '换场景',
  lighting:        '换打光',
  style_transfer:  '风格变换',
  action_transfer: '动作迁移',
  angle:           '角度变换',
  enhance:         '质感增强',
  image_to_video:  '图转视频',
};

/** 能力图标映射 */
export const CAPABILITY_ICONS: Record<CapabilityType, string> = {
  hair_color:      '💇',
  outfit:          '👗',
  background:      '🏙️',
  lighting:        '💡',
  style_transfer:  '🎨',
  action_transfer: '🏃',
  angle:           '📐',
  enhance:         '✨',
  image_to_video:  '📹',
};
