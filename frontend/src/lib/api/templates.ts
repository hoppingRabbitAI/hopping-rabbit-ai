import { authFetch } from '@/lib/supabase/session';

export interface TemplateWorkflowStyle {
  color?: string;
  light?: string;
  [key: string]: unknown;
}

export interface TemplateWorkflow {
  kling_endpoint?: string;
  prompt_seed?: string;
  negative_prompt?: string;
  duration?: string;
  model_name?: string;
  cfg_scale?: number;
  mode?: string;
  shot_type?: string;
  camera_move?: string;
  transition?: string;
  pacing?: string;
  style?: TemplateWorkflowStyle | string;
  camera_control?: Record<string, unknown>;
  [key: string]: unknown;
}

export type TemplatePromptPolicy = 'auto_only' | 'auto_plus_default' | 'auto_plus_default_plus_user';

export interface TemplateApiItem {
  id: string;
  name: string;
  category: string;
  type: string;
  url: string;
  thumbnail_url: string;
  storage_path?: string;
  thumbnail_storage_path?: string | null;
  scopes?: string[];
  tags?: string[];
  workflow?: TemplateWorkflow;
  pack_id?: string;
  status?: 'draft' | 'published' | 'archived';
  quality_label?: 'golden' | 'good' | 'average' | 'poor' | null;
  publish_config?: {
    default_focus_modes?: string[];
    default_golden_preset?: string;
    default_duration?: string;
    default_mode?: string;
    default_cfg_scale?: number;
    default_boundary_ms?: number;
    default_variant_count?: number;
    default_prompt?: string;
    default_negative_prompt?: string;
    prompt_policy?: TemplatePromptPolicy;
    allow_prompt_override?: boolean;
    display_name?: string;
    description?: string;
    best_for?: string[];
    [key: string]: unknown;
  };
  preview_video_url?: string | null;
  transition_spec?: {
    version?: string;
    family?: string;
    duration_ms?: number;
    quality_tier?: string;
    transition_category?: string;
    transition_description?: string;
    motion_pattern?: string;
    camera_movement?: string;
    scene_a_description?: string;
    scene_b_description?: string;
    recommended_prompt?: string;
    motion_prompt?: string;
    camera_compound?: string;
    background_motion?: string;
    subject_motion?: string;
    _analysis_method?: string;
    transition_window?: {
      effect_start_sec?: number;
      effect_end_sec?: number;
      effect_duration_sec?: number;
      confidence?: number;
    };
    technical_dissection?: {
      subject_anchoring?: string;
      trigger_mechanism?: string;
      spatial_perspective_shift?: string;
      asset_replacement?: string;
      motion_dynamics?: string;
    };
  };
  recipe_digest?: {
    has_analysis: boolean;
    has_match: boolean;
    has_config: boolean;
    readiness: 'ready' | 'partial' | 'pending';
    analysis_summary?: {
      family?: string;
      transition_category?: string;
      camera_movement?: string;
      duration_ms?: number;
      motion_pattern?: string;
    };
    dimension_scores?: {
      outfit_change: number;
      subject_preserve: number;
      scene_shift: number;
    };
    recommended_focus_modes?: string[];
    golden_match?: {
      profile_name: string;
      score: number;
      match_level: 'high' | 'medium' | 'low';
    };
    provenance?: {
      source_profile?: string;
      auto_filled_keys?: string[];
      admin_overrides?: string[];
      focus_modes_source?: 'llm_dimension_analysis' | 'profile_default';
    };
  };
}

export interface TemplateApiResponse {
  bucket: string;
  prefix: string;
  items: TemplateApiItem[];
}

export interface TemplateRenderSpec {
  endpoint: string;
  prompt: string;
  negative_prompt?: string;
  model_name?: string;
  duration?: string;
  cfg_scale?: number;
  mode?: string;
  camera_control?: Record<string, unknown> | null;
  aspect_ratio?: string;
  images?: string[];
  video_url?: string;
  workflow?: TemplateWorkflow;
}

export interface TemplateCandidateItem {
  template_id: string;
  name: string;
  category?: string;
  type?: string;
  tags?: string[];
  thumbnail_url?: string;
  preview_video_url?: string;
  quality_label?: 'golden' | 'good' | 'average' | 'poor' | null;
  pack_id?: string;
  transition_spec?: {
    version?: string;
    family?: string;
    duration_ms?: number;
    quality_tier?: string;
    transition_category?: string;
    transition_description?: string;
    motion_pattern?: string;
    camera_movement?: string;
    scene_a_description?: string;
    scene_b_description?: string;
    recommended_prompt?: string;
    motion_prompt?: string;
    camera_compound?: string;
    background_motion?: string;
    subject_motion?: string;
    _analysis_method?: string;
    transition_window?: {
      effect_start_sec?: number;
      effect_end_sec?: number;
      effect_duration_sec?: number;
      confidence?: number;
    };
    technical_dissection?: {
      subject_anchoring?: string;
      trigger_mechanism?: string;
      spatial_perspective_shift?: string;
      asset_replacement?: string;
      motion_dynamics?: string;
    };
  };
  publish_config?: {
    default_focus_modes?: string[];
    default_golden_preset?: string;
    default_duration?: string;
    default_mode?: string;
    default_cfg_scale?: number;
    default_boundary_ms?: number;
    default_variant_count?: number;
    default_prompt?: string;
    default_negative_prompt?: string;
    prompt_policy?: TemplatePromptPolicy;
    allow_prompt_override?: boolean;
    display_name?: string;
    description?: string;
    best_for?: string[];
    [key: string]: unknown;
  };
  render_spec: TemplateRenderSpec;
}

export interface TemplateCandidateRequest {
  category?: string;
  template_kind?: string;
  scope?: string;
  pack_id?: string;
  limit?: number;
  prompt?: string;
  negative_prompt?: string;
  duration?: string;
  model_name?: string;
  cfg_scale?: number;
  mode?: string;
  aspect_ratio?: string;
  character_orientation?: string;
  images?: string[];
  video_url?: string;
  clip_id?: string;
  project_id?: string;
  overrides?: Record<string, unknown>;
  auto_render?: boolean;
}

export interface TemplateCandidateResponse {
  candidates: TemplateCandidateItem[];
  auto_render: boolean;
}

export interface TemplateRenderRequest {
  prompt?: string;
  negative_prompt?: string;
  images?: string[];
  video_url?: string;
  duration?: string;
  model_name?: string;
  cfg_scale?: number;
  mode?: string;
  aspect_ratio?: string;
  character_orientation?: string;
  from_template_id?: string;
  to_template_id?: string;
  boundary_ms?: number;
  quality_tier?: 'style_match' | 'template_match' | 'pixel_match';
  focus_modes?: ('outfit_change' | 'subject_preserve' | 'scene_shift')[];
  golden_preset?: 'spin_occlusion_outfit' | 'whip_pan_outfit' | 'space_warp_outfit';
  project_id?: string;
  clip_id?: string;
  write_clip_metadata?: boolean;
  overrides?: Record<string, unknown>;
}

export interface TemplateRenderResponse {
  success: boolean;
  task_id: string;
  status: string;
  endpoint: string;
  prompt?: string;
  negative_prompt?: string;
  transition_inputs?: Record<string, unknown>;
}

export interface TransitionReplicaRequest {
  from_image_url: string;
  to_image_url: string;
  prompt?: string;
  negative_prompt?: string;
  duration?: string;
  mode?: string;
  aspect_ratio?: string;
  boundary_ms?: number;
  quality_tier?: "style_match" | "template_match" | "pixel_match";
  focus_modes?: ("outfit_change" | "subject_preserve" | "scene_shift")[];
  golden_preset?: 'spin_occlusion_outfit' | 'whip_pan_outfit' | 'space_warp_outfit';
  apply_mode?: "insert_between" | "merge_clips";
  variant_count?: number;
  project_id?: string;
  clip_id?: string;
  overrides?: Record<string, unknown>;
}

export interface TransitionReplicaTask {
  task_id: string;
  status: string;
  attempt_index: number;
  variant_label: string;
  prompt: string;
}

export interface TransitionReplicaResponse {
  success: boolean;
  template_id: string;
  endpoint: string;
  replica_group_id: string;
  focus_modes: ("outfit_change" | "subject_preserve" | "scene_shift")[];
  golden_preset: 'spin_occlusion_outfit' | 'whip_pan_outfit' | 'space_warp_outfit';
  apply_mode: "insert_between" | "merge_clips";
  task_count: number;
  tasks: TransitionReplicaTask[];
}

function buildQuery(params?: {
  category?: string;
  type?: string;
  scope?: string;
  pack_id?: string;
  include_workflow?: boolean;
  status?: string;
}): string {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.type) searchParams.set('type', params.type);
  if (params?.scope) searchParams.set('scope', params.scope);
  if (params?.pack_id) searchParams.set('pack_id', params.pack_id);
  if (params?.include_workflow) searchParams.set('include_workflow', 'true');
  if (params?.status) searchParams.set('status', params.status);
  return searchParams.toString();
}

export async function fetchTemplates(params?: {
  category?: string;
  type?: string;
  scope?: string;
  pack_id?: string;
  include_workflow?: boolean;
  status?: string;
}): Promise<TemplateApiResponse> {
  const query = buildQuery(params);
  const response = await fetch(`/api/templates${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch templates: ${response.status}`);
  }
  const data = await response.json() as TemplateApiResponse;

  if (params?.scope && (!data.items || data.items.length === 0)) {
    const fallbackQuery = buildQuery({ ...params, scope: undefined });
    const fallbackResp = await fetch(`/api/templates${fallbackQuery ? `?${fallbackQuery}` : ''}`);
    if (fallbackResp.ok) {
      return fallbackResp.json() as Promise<TemplateApiResponse>;
    }
  }

  return data;
}

async function requestCandidates(payload: TemplateCandidateRequest): Promise<TemplateCandidateResponse> {
  const response = await authFetch('/api/templates/candidates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to fetch template candidates: ${response.status}`);
  }

  return response.json() as Promise<TemplateCandidateResponse>;
}

export async function fetchTemplateCandidates(
  payload: TemplateCandidateRequest,
): Promise<TemplateCandidateResponse> {
  const requestPayload: TemplateCandidateRequest = {
    limit: 5,
    ...payload,
  };

  const data = await requestCandidates(requestPayload);
  if ((data.candidates?.length || 0) > 0 || !requestPayload.scope) {
    return data;
  }

  return requestCandidates({
    ...requestPayload,
    scope: undefined,
  });
}

export async function renderTemplate(
  templateId: string,
  payload: TemplateRenderRequest,
): Promise<TemplateRenderResponse> {
  const response = await authFetch(`/api/templates/${templateId}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to render template: ${response.status}`);
  }

  return response.json() as Promise<TemplateRenderResponse>;
}

export async function replicateTransitionTemplate(
  templateId: string,
  payload: TransitionReplicaRequest,
): Promise<TransitionReplicaResponse> {
  const response = await authFetch(`/api/templates/${templateId}/replicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to replicate transition template: ${response.status}`);
  }

  return response.json() as Promise<TransitionReplicaResponse>;
}


export interface TransitionBoundaryFramesRequest {
  from_clip_id: string;
  to_clip_id: string;
  tail_offset_ms?: number;
  head_offset_ms?: number;
}

export interface TransitionBoundaryFramesResponse {
  success: boolean;
  from_clip_id: string;
  to_clip_id: string;
  from_image_url: string;
  to_image_url: string;
  from_timestamp_sec: number;
  to_timestamp_sec: number;
}


export async function extractTransitionBoundaryFrames(
  payload: TransitionBoundaryFramesRequest,
): Promise<TransitionBoundaryFramesResponse> {
  const response = await authFetch('/api/templates/transition/clip-boundary-frames', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to extract transition boundary frames: ${response.status}`);
  }

  return response.json() as Promise<TransitionBoundaryFramesResponse>;
}

export interface TemplateSourceUploadResponse {
  url: string;
  path: string;
  content_type?: string;
  size?: number;
}

export async function uploadTemplateSourceFile(
  file: File,
  prefix: string = 'platform-materials',
): Promise<TemplateSourceUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('prefix', prefix);

  const fileName = (file.name || '').toLowerCase();
  const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic|heif)$/.test(fileName);
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|avi|webm|m4v)$/.test(fileName);
  const isZip = (
    file.type === 'application/zip'
    || file.type === 'application/x-zip-compressed'
    || fileName.endsWith('.zip')
  );

  let endpoint: string;
  if (isImage) {
    endpoint = '/api/upload/image';
  } else if (isVideo) {
    endpoint = '/api/upload/video';
  } else if (isZip) {
    endpoint = '/api/upload/file';
  } else {
    throw new Error('Unsupported template source file type');
  }

  const response = await authFetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to upload template source: ${response.status}`);
  }

  return response.json() as Promise<TemplateSourceUploadResponse>;
}

// ============================================
// 模板发布/下架 API
// ============================================

export interface PublishResult {
  success: boolean;
  template_id: string;
  status: string;
  message?: string;
}

/**
 * 发布模板（draft → published）
 */
export async function publishTemplate(templateId: string): Promise<PublishResult> {
  const response = await authFetch(`/api/templates/${templateId}/publish`, {
    method: 'POST',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to publish template: ${response.status}`);
  }

  return response.json() as Promise<PublishResult>;
}

/**
 * 下架模板（published → draft）
 */
export async function unpublishTemplate(templateId: string): Promise<PublishResult> {
  const response = await authFetch(`/api/templates/${templateId}/unpublish`, {
    method: 'POST',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to unpublish template: ${response.status}`);
  }

  return response.json() as Promise<PublishResult>;
}

export interface BatchPublishResult {
  success: boolean;
  published: string[];
  published_count: number;
  failed: Array<{ template_id: string; error: string }>;
  failed_count: number;
}

/**
 * 批量发布模板
 */
export async function batchPublishTemplates(templateIds: string[]): Promise<BatchPublishResult> {
  const response = await authFetch('/api/templates/batch-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_ids: templateIds }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to batch publish templates: ${response.status}`);
  }

  return response.json();
}

// ============================================
// Phase 2：试渲染 + 参数调优 + 质量标注 API
// ============================================

export type TransitionFocusMode = 'outfit_change' | 'subject_preserve' | 'scene_shift';
export type TransitionGoldenPreset = 'spin_occlusion_outfit' | 'whip_pan_outfit' | 'space_warp_outfit';
export type QualityLabel = 'golden' | 'good' | 'average' | 'poor';

export interface PreviewRenderRequest {
  from_image_url: string;
  to_image_url: string;
  prompt?: string;
  negative_prompt?: string;
  focus_modes?: TransitionFocusMode[];
  golden_preset?: TransitionGoldenPreset;
  duration?: string;
  mode?: string;
  cfg_scale?: number;
  boundary_ms?: number;
  variant_count?: number;
}

export interface PreviewRenderResult {
  success: boolean;
  template_id: string;
  replica_group_id: string;
  task_count: number;
  tasks: Array<{
    task_id: string;
    status: string;
    attempt_index: number;
    variant_label: string;
    prompt: string;
  }>;
  preview_render_ids: string[];
}

export interface PreviewRenderItem {
  id: string;
  template_id: string;
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  video_url?: string | null;
  thumbnail_url?: string | null;
  render_params?: Record<string, unknown>;
  is_featured?: boolean;
  admin_rating?: number | null;
  admin_comment?: string | null;
  created_at: string;
}

export interface PreviewRenderListResponse {
  template_id: string;
  renders: PreviewRenderItem[];
  total: number;
}

export interface PreviewRenderRatingRequest {
  admin_rating?: number;
  admin_comment?: string;
  is_featured?: boolean;
}

export interface QualityLabelRequest {
  quality_label: QualityLabel;
  admin_notes?: string;
}

export interface PublishConfigUpdateRequest {
  default_focus_modes?: string[];
  default_golden_preset?: string;
  default_duration?: string;
  default_mode?: string;
  default_cfg_scale?: number;
  default_boundary_ms?: number;
  default_variant_count?: number;
  default_prompt?: string;
  default_negative_prompt?: string;
  prompt_policy?: TemplatePromptPolicy;
  allow_prompt_override?: boolean;
  display_name?: string;
  description?: string;
  best_for?: string[];
}

/**
 * 创建试渲染任务
 */
export async function createPreviewRender(
  templateId: string,
  payload: PreviewRenderRequest,
): Promise<PreviewRenderResult> {
  const response = await authFetch(`/api/templates/${templateId}/preview-render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to create preview render: ${response.status}`);
  }
  return response.json() as Promise<PreviewRenderResult>;
}

/**
 * 获取试渲染列表
 */
export async function fetchPreviewRenders(
  templateId: string,
): Promise<PreviewRenderListResponse> {
  const response = await authFetch(`/api/templates/${templateId}/preview-renders`, {
    method: 'GET',
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to fetch preview renders: ${response.status}`);
  }
  return response.json() as Promise<PreviewRenderListResponse>;
}

/**
 * 更新试渲染评分/Featured
 */
export async function updatePreviewRender(
  templateId: string,
  renderId: string,
  payload: PreviewRenderRatingRequest,
): Promise<{ success: boolean; render_id: string; updated: Record<string, unknown> }> {
  const response = await authFetch(`/api/templates/${templateId}/preview-renders/${renderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to update preview render: ${response.status}`);
  }
  return response.json();
}

/**
 * 设置模板质量标签
 */
export async function updateQualityLabel(
  templateId: string,
  payload: QualityLabelRequest,
): Promise<{ success: boolean; template_id: string; quality_label: QualityLabel }> {
  const response = await authFetch(`/api/templates/${templateId}/quality-label`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to update quality label: ${response.status}`);
  }
  return response.json();
}

/**
 * 更新发布配置
 */
export async function updatePublishConfig(
  templateId: string,
  payload: PublishConfigUpdateRequest,
): Promise<{ success: boolean; template_id: string; publish_config: Record<string, unknown> }> {
  const response = await authFetch(`/api/templates/${templateId}/publish-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to update publish config: ${response.status}`);
  }
  return response.json();
}

// ============================================
// 平台素材入库 (Ingest) API
// ============================================

export interface TemplateIngestRequest {
  source_url: string;
  source_type: 'video' | 'image' | 'zip';
  extract_frames?: number;
  clip_ranges?: Array<{
    start?: number;
    end?: number;
    start_sec?: number;
    end_sec?: number;
    start_ms?: number;
    end_ms?: number;
  }>;
  tags_hint?: string[];
  project_id?: string;
  metadata?: Record<string, unknown>;
}

export interface TemplateIngestResponse {
  job_id: string;
  status: string;
  estimated_time_sec: number;
}

export interface TemplateIngestJob {
  id: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  source_url: string;
  source_type: string;
  template_type?: string;
  extract_frames: number;
  clip_ranges?: unknown[];
  tags_hint?: string[];
  params?: Record<string, unknown>;
  result?: {
    templates?: Array<{
      template_id: string;
      name: string;
      category: string;
      type: string;
      storage_path: string;
      thumbnail_path?: string;
      url: string;
      thumbnail_url: string;
    }>;
    pack_id?: string;
    detected_segments?: number;
    published_templates?: number;
    deduped_templates?: number;
    detection_debug?: {
      duration_sec?: number;
      transition_duration_ms?: number;
      scene_event_count?: number;
      peak_threshold?: number;
      peak_min_spacing_sec?: number;
      selected_peak_count?: number;
      deduped_range_count?: number;
      ranges_source?: string;
      selected_ranges?: Array<{ start: number; end: number }>;
      published_ranges?: Array<{ start: number; end: number }>;
      selected_peaks?: Array<{ ts: number; score: number }>;
      top_scene_events?: Array<{ ts: number; score: number }>;
    };
  };
  error_code?: string;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

/**
 * 创建素材入库任务
 */
export async function createIngestJob(
  payload: TemplateIngestRequest,
): Promise<TemplateIngestResponse> {
  const response = await authFetch('/api/templates/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to create ingest job: ${response.status}`);
  }

  return response.json() as Promise<TemplateIngestResponse>;
}

/**
 * 查询入库任务状态
 */
export async function getIngestJobStatus(jobId: string): Promise<TemplateIngestJob> {
  const response = await authFetch(`/api/templates/ingest/${jobId}`, {
    method: 'GET',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to get ingest job: ${response.status}`);
  }

  return response.json() as Promise<TemplateIngestJob>;
}

/**
 * 删除模板（平台素材）
 */
export async function deleteTemplate(templateId: string): Promise<void> {
  const response = await authFetch(`/api/templates/${templateId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to delete template: ${response.status}`);
  }
}

/**
 * 批量删除模板结果
 */
export interface BatchDeleteResult {
  success: boolean;
  deleted: string[];
  deleted_count: number;
  failed: Array<{ template_id: string; error: string }>;
  failed_count: number;
}

/**
 * 批量删除模板（平台素材）
 */
export async function batchDeleteTemplates(templateIds: string[]): Promise<BatchDeleteResult> {
  const response = await authFetch('/api/templates/batch', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_ids: templateIds }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to batch delete templates: ${response.status}`);
  }

  return response.json();
}

// ============================================================
// Phase 4a: Golden Fingerprint
// ============================================================

/** 指纹数据 */
export interface GoldenFingerprint {
  version: string;
  extracted_at: string;
  source: string;
  transition_category: string;
  family: string;
  motion_pattern: string;
  camera_movement: string;
  duration_ms: number;
  transition_description: string;
  scene_a_description: string;
  scene_b_description: string;
  recommended_prompt: string;
}

/** 单个 Profile 匹配详情 */
export interface FingerprintMatchItem {
  profile_name: string;
  display_name: string;
  description: string;
  score: number;
  match_level: 'high' | 'medium' | 'low';
  recommended_config?: Record<string, unknown>;
}

/** 指纹匹配响应 */
export interface FingerprintMatchResponse {
  template_id: string;
  fingerprint: GoldenFingerprint;
  matches: FingerprintMatchItem[];
}

/** 指纹提取响应 */
export interface FingerprintExtractResponse {
  template_id: string;
  fingerprint: GoldenFingerprint;
  fingerprint_saved: boolean;
  best_match: {
    profile_name: string | null;
    score: number;
    match_level: 'high' | 'medium' | 'low';
    recommended_config: Record<string, unknown> | null;
  };
  auto_fill: {
    matched: boolean;
    profile_name: string | null;
    score: number;
    match_level: 'high' | 'medium' | 'low';
    config_applied: boolean;
  };
}

/** Golden Profile */
export interface GoldenProfile {
  name: string;
  display_name: string;
  description: string;
  match_criteria: Record<string, unknown>;
  recommended_config: Record<string, unknown>;
  sample_count?: number;
  source: 'manual' | 'data_driven';
}

/** 获取指纹匹配详情 */
export async function fetchFingerprintMatch(
  templateId: string,
): Promise<FingerprintMatchResponse> {
  const response = await authFetch(`/api/templates/${templateId}/fingerprint-match`);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to get fingerprint match: ${response.status}`);
  }
  return response.json() as Promise<FingerprintMatchResponse>;
}

/** 手动触发指纹提取 */
export async function extractFingerprint(
  templateId: string,
): Promise<FingerprintExtractResponse> {
  const response = await authFetch(`/api/templates/${templateId}/extract-fingerprint`, {
    method: 'POST',
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to extract fingerprint: ${response.status}`);
  }
  return response.json() as Promise<FingerprintExtractResponse>;
}

/** 获取所有 Golden Profile */
export async function fetchGoldenProfiles(): Promise<{
  profiles: GoldenProfile[];
  count: number;
}> {
  const response = await authFetch('/api/templates/golden-profiles');
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to fetch golden profiles: ${response.status}`);
  }
  return response.json();
}

/** 重建 Golden Profile（从历史数据） */
export async function rebuildGoldenProfiles(): Promise<{
  success: boolean;
  error?: string;
  sample_count: number;
  family_groups?: Record<string, number>;
  rebuilt_count?: number;
  total_profiles?: number;
  profile_names?: string[];
}> {
  const response = await authFetch('/api/templates/golden-profiles/rebuild', {
    method: 'POST',
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to rebuild golden profiles: ${response.status}`);
  }
  return response.json();
}

// ─── Phase 5a: 配方溯源 ────────────────────────────────

/** 配方卡类型 */
export interface TemplateRecipe {
  template_id: string;
  template_name: string;
  template_type: string;
  category: string;
  status: string;
  quality_label: string | null;

  analysis: {
    transition_category?: string;
    family?: string;
    camera_movement?: string;
    motion_pattern?: string;
    duration_ms?: number;
    recommended_prompt?: string;
    transition_description?: string;
    scene_description?: string;
    motion_prompt?: string;
    camera_compound?: string;
    background_motion?: string;
    subject_motion?: string;
    _analysis_method?: string;
    transition_window?: {
      effect_start_sec?: number;
      effect_end_sec?: number;
      effect_duration_sec?: number;
      confidence?: number;
    };
    technical_dissection?: {
      subject_anchoring?: string;
      trigger_mechanism?: string;
      spatial_perspective_shift?: string;
      asset_replacement?: string;
      motion_dynamics?: string;
    };
  };

  fingerprint: GoldenFingerprint | null;
  golden_match: {
    profile_name: string | null;
    score: number;
    match_level: 'high' | 'medium' | 'low';
    matched_at: string;
  } | null;

  publish_config: Record<string, unknown>;
  provenance: {
    auto_filled_at?: string;
    source_profile?: string;
    match_score?: number;
    auto_filled_keys?: string[];
    admin_overrides?: string[];
  };

  usage: {
    total_renders: number;
    succeeded: number;
    failed: number;
    success_rate?: number;
    preview_renders: number;
  };

  workflow_summary: {
    kling_endpoint?: string;
    shot_type?: string;
    camera_move?: string;
    transition?: string;
    pacing?: string;
  };
}

/** 获取模板完整配方卡 */
export async function fetchTemplateRecipe(
  templateId: string,
): Promise<TemplateRecipe> {
  const response = await authFetch(`/api/templates/${templateId}/recipe`);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to fetch template recipe: ${response.status}`);
  }
  return response.json() as Promise<TemplateRecipe>;
}
