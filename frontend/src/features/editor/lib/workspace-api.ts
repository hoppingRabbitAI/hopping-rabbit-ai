/**
 * HoppingRabbit AI - Workspace API Client
 * 处理从上传到进入编辑器的完整流程
 */

import { API_BASE_URL, getAuthToken, handleAuthExpired, ensureValidToken } from '@/lib/api/client';
import * as tus from 'tus-js-client';
import { uploadToCloudflare, type UploadProgressCallback as CFProgressCallback } from '@/lib/api/cloudflare-stream';

// Supabase 配置（备用，暂时保留）
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// 大文件阈值：超过此大小使用分片上传 (50MB)
const CHUNK_UPLOAD_THRESHOLD = 50 * 1024 * 1024;
// 分片大小：50MB（更大的分片 = 更少的 HTTP 请求 = 更快的上传）
// 注意：Supabase 支持最大 50MB 分片
const CHUNK_SIZE = 50 * 1024 * 1024;

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[Workspace API]', ...args); };
const debugWarn = (...args: unknown[]) => { if (DEBUG_ENABLED) console.warn('[Workspace API]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[Workspace API]', ...args); };

// ============================================
// 类型定义
// ============================================

export type SourceType = 'local' | 'youtube' | 'url';
export type TaskType = 'clips' | 'summary' | 'ai-create' | 'voice-extract';  // ★ Added voice-extract
export type SessionStatus = 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled';

// === 多文件上传支持 ===
export interface FileInfo {
  name: string;
  size: number;
  content_type: string;
  duration?: number;    // 视频时长（秒）
  order_index: number;  // 排序索引
}

export interface AssetUploadInfo {
  asset_id: string;
  order_index: number;
  upload_url: string;
  storage_path: string;
  file_name?: string;  // 文件名
}

export interface CreateSessionRequest {
  source_type: SourceType;
  task_type?: TaskType;
  // === 单文件模式（兼容旧版）===
  file_name?: string;
  file_size?: number;
  content_type?: string;
  duration?: number;  // 视频时长（秒），前端本地提取
  // === 多文件模式 ===
  files?: FileInfo[];  // 新增：多文件信息
  // 链接解析
  source_url?: string;
}

export interface CreateSessionResponse {
  session_id: string;
  project_id: string;
  // ★ 统一用 assets 数组（即使单文件也是一个元素的数组）
  assets?: AssetUploadInfo[];
}

export interface ProcessingStep {
  id: string;
  label: string;
  detail: string;
  icon?: 'mic' | 'volume-x' | 'upload' | 'sparkles';  // 可选的图标类型
}

export interface SessionStatusResponse {
  session_id: string;
  project_id: string;
  status: SessionStatus;
  current_step?: string;
  progress: number;
  steps: ProcessingStep[];
  error?: string;
  transcript_segments?: number;
  marked_clips?: number;
}

// ============================================
// API 函数
// ============================================

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  ensureToken: boolean = false  // 是否在请求前确保 token 有效
): Promise<T> {
  // ★ 关键请求前主动检查并刷新 token
  let token: string | null;
  if (ensureToken) {
    token = await ensureValidToken();
    if (!token) {
      debugWarn('Token invalid and refresh failed');
      handleAuthExpired();
      throw new Error('登录已过期，请重新登录');
    }
  } else {
    token = getAuthToken();
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // 处理认证失败
  if (response.status === 401) {
    // ★ 401 时尝试刷新 token 后重试一次
    if (!ensureToken) {
      debugWarn('Got 401, trying to refresh token and retry...');
      const newToken = await ensureValidToken();
      if (newToken) {
        // 重试请求
        const retryHeaders: HeadersInit = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newToken}`,
          ...options.headers,
        };
        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...options,
          headers: retryHeaders,
        });
        if (retryResponse.ok) {
          return retryResponse.json();
        }
      }
    }
    debugWarn('Unauthorized after retry, redirecting to login');
    handleAuthExpired();
    throw new Error('登录已过期，请重新登录');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    // ★★★ 保留 HTTP 状态码和详细错误信息 ★★★
    const err = new Error(error.detail?.message || error.detail || `HTTP ${response.status}`) as Error & {
      status?: number;
      detail?: unknown;
    };
    err.status = response.status;
    err.detail = error.detail;
    throw err;
  }

  return response.json();
}

/**
 * 创建处理会话
 */
export async function createSession(
  data: Omit<CreateSessionRequest, 'source_type'> & { source_type?: SourceType }
): Promise<CreateSessionResponse> {
  // ★ 流程开始前主动刷新 token，确保整个处理过程中 token 有足够有效期
  debugLog('[createSession] 确保 token 有效...');

  // 确定 source_type
  let source_type: SourceType = data.source_type || 'local';

  // 如果有 source_url，根据 URL 判断类型
  if (data.source_url) {
    source_type = data.source_url.includes('youtube') ? 'youtube' : 'url';
  }

  const requestBody = {
    source_type,
    task_type: data.task_type,
    // 单文件模式
    file_name: data.file_name,
    file_size: data.file_size,
    content_type: data.content_type,
    duration: data.duration,  // 视频时长（秒）
    // 多文件模式
    files: data.files,  // ✅ 新增：多文件信息
    // 其他
    source_url: data.source_url,
  };

  debugLog('[createSession] 请求体:', requestBody);

  // ★ 使用 ensureToken=true 确保 token 有效
  return request('/workspace/sessions', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  }, true);
}

/**
 * 使用 TUS 协议分片上传大文件
 */
async function uploadWithTus(
  file: File,
  storagePath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  debugLog('[TUS Upload] 开始分片上传...');
  debugLog('[TUS Upload] storagePath:', storagePath);
  debugLog('[TUS Upload] file.size:', (file.size / 1024 / 1024).toFixed(2), 'MB');

  const endpoint = `${SUPABASE_URL}/storage/v1/upload/resumable`;

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'x-upsert': 'true',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: 'clips',
        objectName: storagePath,
        contentType: file.type || 'video/mp4',
        cacheControl: '3600',
      },
      chunkSize: CHUNK_SIZE,
      onError: (error: Error | tus.DetailedError) => {
        debugError('[TUS Upload] 上传失败:', error.message);
        if ('originalResponse' in error && error.originalResponse) {
          debugError('[TUS Upload] response.status:', error.originalResponse.getStatus());
          debugError('[TUS Upload] response.body:', error.originalResponse.getBody());
        }
        reject(new Error(`分片上传失败: ${error.message}`));
      },
      onProgress: (() => {
        // 节流：只在进度变化 ≥1% 时触发，避免频繁更新
        let lastReportedPercent = -1;
        return (bytesUploaded: number, bytesTotal: number) => {
          const percent = Math.round((bytesUploaded / bytesTotal) * 100);
          if (percent !== lastReportedPercent) {
            lastReportedPercent = percent;
            debugLog(`[TUS Upload] 进度: ${percent}%`);
            onProgress?.(percent);
          }
        };
      })(),
      onSuccess: () => {
        debugLog('[TUS Upload] 上传完成');
        resolve();
      },
    });

    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0) {
        debugLog('[TUS Upload] 恢复之前的上传...');
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    });
  });
}

/**
 * 使用预签名 URL 直接上传小文件
 */
async function uploadWithPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`上传失败: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('网络错误'));
    });

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.send(file);
  });
}

/**
 * 上传文件到 Cloudflare Stream
 * 
 * ★★★ 治本方案：直接走 Cloudflare，不经过 Supabase ★★★
 */
export async function uploadFile(
  uploadUrl: string,  // 保留参数兼容性（暂不使用）
  file: File,
  onProgress?: (percent: number) => void,
  storagePath?: string,  // 保留参数兼容性（暂不使用）
  assetId?: string  // ★ 新增：asset_id 用于 Cloudflare 上传
): Promise<void> {
  debugLog(`[Upload] 🌩️ Cloudflare Stream 上传: ${file.name}, ${(file.size / 1024 / 1024).toFixed(2)}MB`);

  if (!assetId) {
    throw new Error('Cloudflare 上传需要 assetId');
  }

  // 适配进度回调类型
  const cfProgress: CFProgressCallback = (p) => {
    onProgress?.(p.percentage);
  };

  // ★ waitForReady=true：等待 Cloudflare 转码完成，进度条会显示"转码中"
  await uploadToCloudflare(file, assetId, cfProgress, true);
}

/**
 * 确认上传完成，开始处理
 */
export async function confirmUpload(
  sessionId: string
): Promise<{ status: string; message: string; asset_count?: number }> {
  return request(`/workspace/sessions/${sessionId}/confirm-upload`, {
    method: 'POST',
  });
}

/**
 * 通知单个资源上传完成（多文件模式）
 */
export async function notifyAssetUploaded(
  sessionId: string,
  assetId: string
): Promise<{ status: string; progress: { completed: number; total: number; all_completed: boolean } }> {
  return request(`/workspace/sessions/${sessionId}/asset/${assetId}/uploaded`, {
    method: 'POST',
  });
}

/**
 * ★ 完成上传，创建基础项目结构 (track + video clips)
 * 
 * 上传完成后调用此接口，会：
 * 1. 创建视频轨道和字幕轨道
 * 2. 将上传的视频放到时间轴上（创建 video clip）
 * 3. 此时用户可以在编辑器中预览和编辑
 * 4. 后续 AI 处理是可选的增值功能
 */
export interface FinalizeUploadResponse {
  status: string;
  project_id: string;
  tracks: Array<{ id: string; name?: string; order_index?: number }>;
  clips: Array<{ id: string; asset_id: string; start_time: number; end_time: number }>;
  message: string;
}

export async function finalizeUpload(
  sessionId: string
): Promise<FinalizeUploadResponse> {
  debugLog(`[Finalize] 完成上传，创建基础项目结构: session=${sessionId}`);
  return request(`/workspace/sessions/${sessionId}/finalize-upload`, {
    method: 'POST',
  });
}

/**
 * 上传多个文件（并行上传，分别报告进度）
 * @param files 文件列表
 * @param assets 后端返回的资源上传信息
 * @param sessionId 会话 ID
 * @param onFileProgress 单个文件进度回调 (assetId, percent)
 * @param onAllProgress 整体进度回调 (percent)
 */
export async function uploadMultipleFiles(
  files: File[],
  assets: AssetUploadInfo[],
  sessionId: string,
  onFileProgress?: (assetId: string, percent: number) => void,
  onAllProgress?: (percent: number) => void
): Promise<void> {
  debugLog(`[Multi-Upload] 开始上传 ${files.length} 个文件`);

  const fileMap = new Map<number, File>();
  files.forEach((file, idx) => fileMap.set(idx, file));

  const progresses = new Map<string, number>();
  assets.forEach(a => progresses.set(a.asset_id, 0));

  const updateAllProgress = () => {
    const total = Array.from(progresses.values()).reduce((sum, p) => sum + p, 0);
    const avgPercent = Math.round(total / progresses.size);
    onAllProgress?.(avgPercent);
  };

  // 并行上传所有文件
  await Promise.all(
    assets.map(async (asset) => {
      const file = fileMap.get(asset.order_index);
      if (!file) {
        debugError(`[Multi-Upload] 未找到索引为 ${asset.order_index} 的文件`);
        return;
      }

      try {
        await uploadFile(
          asset.upload_url,
          file,
          (percent) => {
            progresses.set(asset.asset_id, percent);
            onFileProgress?.(asset.asset_id, percent);
            updateAllProgress();
          },
          asset.storage_path,
          asset.asset_id  // ★ 传入 asset_id 用于 Cloudflare 上传
        );

        // 上传完成后通知后端
        await notifyAssetUploaded(sessionId, asset.asset_id);
        debugLog(`[Multi-Upload] ✅ 文件 ${file.name} 上传完成`);

      } catch (error) {
        debugError(`[Multi-Upload] ❌ 文件 ${file.name} 上传失败:`, error);
        throw error;
      }
    })
  );

  debugLog(`[Multi-Upload] 所有文件上传完成`);
}

/**
 * 获取会话状态
 */
export async function getSessionStatus(
  sessionId: string
): Promise<SessionStatusResponse> {
  return request(`/workspace/sessions/${sessionId}`);
}

/**
 * 取消会话
 */
export async function cancelSession(
  sessionId: string
): Promise<{ message: string }> {
  return request(`/workspace/sessions/${sessionId}`, {
    method: 'DELETE',
  });
}

/**
 * 轮询会话状态直到完成
 * @param intervalMs 轮询间隔（默认 2000ms，减少服务器负载）
 */
export function pollSessionStatus(
  sessionId: string,
  callbacks: {
    onProgress: (status: SessionStatusResponse) => void;
    onComplete: (status: SessionStatusResponse) => void;
    onError: (error: Error) => void;
    onCancel?: () => void;  // ★ 新增：取消回调，与错误分开处理
  },
  intervalMs: number = 2000
): () => void {
  let stopped = false;

  const poll = async () => {
    if (stopped) return;

    try {
      const status = await getSessionStatus(sessionId);
      callbacks.onProgress(status);

      if (status.status === 'completed') {
        callbacks.onComplete(status);
        return;
      }

      if (status.status === 'failed') {
        callbacks.onError(new Error(status.error || '处理失败'));
        return;
      }

      if (status.status === 'cancelled') {
        // ★ 取消是用户主动操作，调用 onCancel 而不是 onError
        if (callbacks.onCancel) {
          callbacks.onCancel();
        }
        return;
      }

      // 继续轮询
      setTimeout(poll, intervalMs);

    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  poll();

  // 返回停止函数
  return () => {
    stopped = true;
  };
}

// ============================================
// 项目历史 API
// ============================================

export interface ProjectRecord {
  id: string;
  name: string;
  updated_at: string;
  // 关联资源信息
  thumbnail_url?: string;
  thumbnail_asset_id?: string;  // 项目第一个视频 asset 的 ID，用于动态生成封面
  duration?: number;
  // 以下字段列表接口不返回，仅项目详情接口返回
  status?: 'draft' | 'processing' | 'completed' | 'archived';
  resolution?: { width: number; height: number };
  fps?: number;
  created_at?: string;
}

export interface ProjectListResponse {
  items: ProjectRecord[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * 获取项目列表（历史记录）
 */
export async function getProjects(
  params: { limit?: number; offset?: number; status?: string } = {}
): Promise<ProjectListResponse> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());
  if (params.status) query.set('status', params.status);

  const endpoint = `/projects${query.toString() ? `?${query}` : ''}`;
  return request(endpoint);
}

/**
 * 删除项目
 */
export async function deleteProject(projectId: string): Promise<void> {
  return request(`/projects/${projectId}`, { method: 'DELETE' });
}

/**
 * 批量删除项目
 */
export interface BatchDeleteResult {
  success: boolean;
  message: string;
  results: Array<{ id: string; success: boolean; error?: string }>;
  success_count: number;
  fail_count: number;
}

export async function batchDeleteProjects(projectIds: string[]): Promise<BatchDeleteResult> {
  return request('/projects/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ project_ids: projectIds }),
  });
}

/**
 * 归档项目（更新状态为 archived）
 */
export async function archiveProject(projectId: string): Promise<ProjectRecord> {
  return request(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'archived' }),
  });
}

// ============================================
// ★ 渐进式两步流程: 启动 AI 处理 API
// ============================================

export interface StartAIProcessingRequest {
  task_type: TaskType;
  output_ratio?: string;  // 输出比例: "9:16", "16:9", "1:1"
  template_id?: string;   // 模板 ID
  options?: Record<string, unknown>;  // 其他 AI 选项
}

export interface StartAIProcessingResponse {
  status: string;
  message: string;
  credits_consumed: number;
  credits_remaining: number;
}

/**
 * 启动 AI 处理 (步骤2: 检查积分 + 扣除积分 + 开始处理)
 * 
 * ★ 渐进式两步流程:
 * 1. createSession - 创建会话 + 上传视频 (不扣积分)
 * 2. startAIProcessing - 用户确认配置后启动 AI 处理 (本函数，扣积分)
 */
export async function startAIProcessing(
  sessionId: string,
  options: StartAIProcessingRequest
): Promise<StartAIProcessingResponse> {
  debugLog('[startAIProcessing] 启动 AI 处理:', sessionId, options);

  return request(`/workspace/sessions/${sessionId}/start-ai-processing`, {
    method: 'POST',
    body: JSON.stringify(options),
  }, true);  // ★ 使用 ensureToken=true 确保 token 有效
}


// ============================================
// ★ 口播视频精修: 口癖/废话检测 API
// ============================================

export interface FillerWord {
  word: string;                 // 口癖词汇（如"嗯..."、"那个"）
  count: number;                // 出现次数
  total_duration_ms: number;    // 总时长（毫秒）
  occurrences: Array<{          // 出现位置
    start: number;
    end: number;
    asset_id?: string;
    text?: string;
  }>;
}

export interface DetectFillersResponse {
  status: string;
  session_id: string;
  project_id: string;
  filler_words: FillerWord[];           // 检测到的口癖词汇
  silence_segments: Array<{             // 静音片段列表
    id: string;
    start: number;
    end: number;
    silence_info?: {
      classification: string;
      duration_ms: number;
      reason: string;
    };
  }>;
  transcript_segments: Array<{          // 完整转写结果
    id: string;
    text: string;
    start: number;
    end: number;
    asset_id?: string;
    silence_info?: {
      classification: string;
      duration_ms: number;
      reason: string;
    };
  }>;
  total_filler_duration_ms: number;     // 废话总时长
  original_duration_ms: number;         // 原视频时长
  estimated_savings_percent: number;    // 预计节省百分比
}

/**
 * 口癖/废话检测 (口播视频精修模式)
 * 
 * ★ 复用 ASR + 静音检测逻辑，返回废话片段供 DefillerModal 使用
 */
export interface DetectFillersOptions {
  detect_fillers?: boolean;      // 识别口癖（含重复词）
  detect_breaths?: boolean;      // 识别换气
}

export async function detectFillers(
  sessionId: string,
  options?: DetectFillersOptions
): Promise<DetectFillersResponse> {
  debugLog('[detectFillers] 开始口癖检测:', sessionId, options);

  return request(`/workspace/sessions/${sessionId}/detect-fillers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options || {}),
  }, true);  // ★ 使用 ensureToken=true 确保 token 有效
}


// ============================================
// ★ 口播视频精修: 应用修剪 API
// ============================================

export interface TrimSegment {
  start: number;              // 开始时间（毫秒）
  end: number;                // 结束时间（毫秒）
  asset_id?: string;          // 所属资源 ID
  reason?: string;            // 删除原因
}

export interface ApplyTrimmingRequest {
  removed_fillers: string[];                // 用户选择删除的口癖词汇
  trim_segments?: TrimSegment[];            // 可选：具体要删除的片段
  create_clips_from_segments?: boolean;     // 是否根据保留片段创建 clips
}

export interface ApplyTrimmingResponse {
  status: string;
  session_id: string;
  project_id: string;
  clips_created: number;              // 创建的 clip 数量
  total_duration_ms: number;          // 修剪后的总时长
  removed_duration_ms: number;        // 被删除的时长
  clips: Array<{                      // 创建的 clips 列表
    id: string;
    start: number;
    duration: number;
    source_start: number;
    source_end: number;
  }>;
}

/**
 * 应用口癖修剪 (口播视频精修模式)
 * 
 * ★ 根据用户在 DefillerModal 中的选择，执行实际的修剪操作
 * ★ 创建新的 clips 并更新 project
 */
export async function applyTrimming(
  sessionId: string,
  options: ApplyTrimmingRequest
): Promise<ApplyTrimmingResponse> {
  debugLog('[applyTrimming] 应用修剪:', sessionId, options);

  return request(`/workspace/sessions/${sessionId}/apply-trimming`, {
    method: 'POST',
    body: JSON.stringify(options),
  }, true);  // ★ 使用 ensureToken=true 确保 token 有效
}
