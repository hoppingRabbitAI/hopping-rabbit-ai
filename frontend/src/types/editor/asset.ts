// ==========================================
// 资源相关类型 (Asset Types)
// ==========================================

/**
 * 资源元数据
 */
export interface AssetMetadata {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  bitrate?: number;
  sample_rate?: number;
  channels?: number;
  has_audio?: boolean;
}

/**
 * 资源
 */
export interface Asset {
  id: string;
  project_id?: string;
  user_id?: string;
  
  // 类型: video | audio | image | text
  type: 'video' | 'audio' | 'image' | 'text';
  
  // 子类型: original | vocals | accompaniment | ...
  subtype?: string;
  
  // 存储
  storage_path?: string;
  url: string;
  thumbnail_url?: string;
  
  // 文件信息
  name: string;
  file_size?: number;
  mime_type?: string;
  
  // 元数据 (可扩展)
  metadata: AssetMetadata;
  
  // 来源关联
  parent_id?: string;
  
  // 状态: uploading | processing | ready | error
  status: string;
  
  // 时间戳
  created_at: string;
  updated_at: string;
}

/**
 * 波形数据
 */
export interface WaveformData {
  asset_id: string;
  duration: number;
  sample_rate: number;
  channels: number;
  data: { left: number[]; right?: number[] };
  peaks: { min: number; max: number };
}
