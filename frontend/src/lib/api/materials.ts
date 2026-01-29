/**
 * 用户素材库 API
 * 管理数字人形象、声音样本等用户素材
 */
import type { ApiResponse } from './types';
import { ApiClient } from './client';

// ============================================
// 类型定义
// ============================================

/** 素材分类 */
export type AssetCategory = 'ai_generated' | 'user_material' | 'project_asset';

/** 用户素材类型 */
export type MaterialType = 'avatar' | 'voice_sample' | 'general';

/** 用户素材项 */
export interface UserMaterial {
  id: string;
  name: string;
  display_name?: string;
  original_filename?: string;
  file_type: 'video' | 'audio' | 'image' | 'subtitle';
  mime_type?: string;
  file_size?: number;
  storage_path: string;
  url?: string;
  thumbnail_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  asset_category: AssetCategory;
  material_type: MaterialType;
  material_metadata?: Record<string, unknown>;
  tags?: string[];
  is_favorite?: boolean;
  usage_count?: number;
  last_used_at?: string;
  created_at: string;
  updated_at?: string;
}

/** 数字人形象 */
export interface AvatarItem {
  id: string;
  name: string;
  url: string;
  is_favorite: boolean;
  usage_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** 声音样本 */
export interface VoiceSampleItem {
  id: string;
  type: 'sample' | 'clone';
  name: string;
  url?: string;
  duration?: number;
  is_cloned?: boolean;
  fish_audio_reference_id?: string;
  language?: string;
  gender?: string;
  preview_url?: string;
  usage_count?: number;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/** 素材上传请求 */
export interface MaterialUploadRequest {
  file_name: string;
  content_type: string;
  file_size: number;
  material_type: MaterialType;
  display_name?: string;
  tags?: string[];
  material_metadata?: Record<string, unknown>;
}

/** 素材上传响应 */
export interface MaterialUploadResponse {
  asset_id: string;
  upload_url: string;
  storage_path: string;
}

/** 声音克隆请求 */
export interface VoiceCloneRequest {
  asset_id: string;
  voice_name: string;
  language?: string;
}

/** 声音克隆响应 */
export interface VoiceCloneResponse {
  clone_id: string;
  name: string;
  fish_audio_reference_id: string;
  status: 'created' | 'exists' | 'failed';
}

/** 用户素材偏好设置 */
export interface MaterialPreferences {
  default_avatar_id?: string;
  default_voice_type: 'preset' | 'cloned';
  default_voice_id?: string;
  default_broadcast_settings: {
    aspect_ratio: string;
    model: string;
    lip_sync_mode: string;
  };
}

/** 设置默认素材请求 */
export interface SetDefaultMaterialRequest {
  material_type: 'avatar' | 'voice';
  asset_id?: string;
  voice_type?: 'preset' | 'cloned';
}

// ============================================
// API Client
// ============================================

export class MaterialsApi extends ApiClient {
  /**
   * 获取用户素材列表
   */
  async getMaterials(params?: {
    material_type?: MaterialType;
    file_type?: string;
    is_favorite?: boolean;
    tags?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<{ items: UserMaterial[]; total: number }>> {
    const searchParams = new URLSearchParams();
    if (params?.material_type) searchParams.set('material_type', params.material_type);
    if (params?.file_type) searchParams.set('file_type', params.file_type);
    if (params?.is_favorite !== undefined) searchParams.set('is_favorite', String(params.is_favorite));
    if (params?.tags) searchParams.set('tags', params.tags);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    
    const query = searchParams.toString();
    return this.request(`/materials${query ? `?${query}` : ''}`);
  }

  /**
   * 获取数字人形象列表
   */
  async getAvatars(limit = 20): Promise<ApiResponse<{ items: AvatarItem[] }>> {
    return this.request(`/materials/avatars?limit=${limit}`);
  }

  /**
   * 获取声音样本列表（包含已克隆的声音）
   */
  async getVoiceSamples(params?: {
    include_clones?: boolean;
    limit?: number;
  }): Promise<ApiResponse<{ items: VoiceSampleItem[] }>> {
    const searchParams = new URLSearchParams();
    if (params?.include_clones !== undefined) searchParams.set('include_clones', String(params.include_clones));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    
    const query = searchParams.toString();
    return this.request(`/materials/voice-samples${query ? `?${query}` : ''}`);
  }

  /**
   * 获取预签名上传 URL
   */
  async presignUpload(data: MaterialUploadRequest): Promise<ApiResponse<MaterialUploadResponse>> {
    return this.request('/materials/presign-upload', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 确认素材上传完成
   */
  async confirmUpload(data: {
    asset_id: string;
    storage_path: string;
    material_type: MaterialType;
    file_name: string;
    content_type: string;
    file_size: number;
    display_name?: string;
    tags?: string;
    duration?: number;
    width?: number;
    height?: number;
  }): Promise<ApiResponse<UserMaterial>> {
    const params = new URLSearchParams({
      material_type: data.material_type,
      file_name: data.file_name,
      content_type: data.content_type,
      file_size: String(data.file_size),
    });
    if (data.display_name) params.set('display_name', data.display_name);
    if (data.tags) params.set('tags', data.tags);

    return this.request(`/materials/confirm-upload?${params.toString()}`, {
      method: 'POST',
      body: JSON.stringify({
        asset_id: data.asset_id,
        storage_path: data.storage_path,
        duration: data.duration,
        width: data.width,
        height: data.height,
      }),
    });
  }

  /**
   * 更新素材信息
   */
  async updateMaterial(assetId: string, data: {
    display_name?: string;
    tags?: string[];
    is_favorite?: boolean;
    material_metadata?: Record<string, unknown>;
  }): Promise<ApiResponse<UserMaterial>> {
    return this.request(`/materials/${assetId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  /**
   * 删除素材
   */
  async deleteMaterial(assetId: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return this.request(`/materials/${assetId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 记录素材使用
   */
  async recordUsage(assetId: string): Promise<ApiResponse<{ success: boolean; usage_count: number }>> {
    return this.request(`/materials/${assetId}/use`, {
      method: 'POST',
    });
  }

  /**
   * 克隆声音
   */
  async cloneVoice(data: VoiceCloneRequest): Promise<ApiResponse<VoiceCloneResponse>> {
    return this.request('/materials/voice-clone', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 获取用户素材偏好设置
   */
  async getPreferences(): Promise<ApiResponse<MaterialPreferences>> {
    return this.request('/materials/preferences');
  }

  /**
   * 设置默认素材
   */
  async setDefaultMaterial(data: SetDefaultMaterialRequest): Promise<ApiResponse<{ success: boolean }>> {
    return this.request('/materials/preferences/default', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 一站式上传素材
   * 包含：presign -> upload -> confirm 完整流程
   */
  async uploadMaterial(
    file: File,
    materialType: MaterialType,
    options?: {
      displayName?: string;
      tags?: string[];
      onProgress?: (progress: number) => void;
    }
  ): Promise<ApiResponse<UserMaterial>> {
    try {
      // 1. 获取预签名URL
      const presignResult = await this.presignUpload({
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        material_type: materialType,
        display_name: options?.displayName,
        tags: options?.tags,
      });

      if (presignResult.error || !presignResult.data) {
        return { error: presignResult.error || { code: 'presign_failed', message: '获取上传URL失败' } };
      }

      const { asset_id, upload_url, storage_path } = presignResult.data;

      // 2. 上传文件
      options?.onProgress?.(10);
      
      const uploadResponse = await fetch(upload_url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadResponse.ok) {
        return { error: { code: 'upload_failed', message: '文件上传失败' } };
      }

      options?.onProgress?.(80);

      // 3. 提取媒体元数据（如果是音频/视频）
      let duration: number | undefined;
      let width: number | undefined;
      let height: number | undefined;

      if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
        const mediaInfo = await this.extractMediaInfo(file);
        duration = mediaInfo.duration;
        width = mediaInfo.width;
        height = mediaInfo.height;
      } else if (file.type.startsWith('image/')) {
        const imageInfo = await this.extractImageInfo(file);
        width = imageInfo.width;
        height = imageInfo.height;
      }

      // 4. 确认上传
      const confirmResult = await this.confirmUpload({
        asset_id,
        storage_path,
        material_type: materialType,
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        display_name: options?.displayName,
        tags: options?.tags?.join(','),
        duration,
        width,
        height,
      });

      options?.onProgress?.(100);

      return confirmResult;
    } catch (error) {
      return { error: { code: 'upload_error', message: String(error) } };
    }
  }

  /**
   * 提取媒体文件信息
   */
  private async extractMediaInfo(file: File): Promise<{ duration?: number; width?: number; height?: number }> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const media = file.type.startsWith('video/') 
        ? document.createElement('video')
        : document.createElement('audio');
      
      media.onloadedmetadata = () => {
        const info: { duration?: number; width?: number; height?: number } = {
          duration: media.duration,
        };
        if (media instanceof HTMLVideoElement) {
          info.width = media.videoWidth;
          info.height = media.videoHeight;
        }
        URL.revokeObjectURL(url);
        resolve(info);
      };
      
      media.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      
      media.src = url;
    });
  }

  /**
   * 提取图片信息
   */
  private async extractImageInfo(file: File): Promise<{ width?: number; height?: number }> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      
      img.src = url;
    });
  }
}

// 导出单例
export const materialsApi = new MaterialsApi();
