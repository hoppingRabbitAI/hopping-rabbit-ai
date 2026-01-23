/**
 * HoppingRabbit AI - 智能一键成片 V2 API
 * 智能内容分析、脚本管理、审核确认
 */

import { API_BASE_URL, getAuthToken, handleAuthExpired, ensureValidToken } from '@/lib/api/client';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[SmartV2 API]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[SmartV2 API]', ...args); };

// ============================================
// 类型定义
// ============================================

/** 处理阶段 */
export type ProcessingStage = 
  | 'pending'       // 等待处理
  | 'uploading'     // 上传中
  | 'transcribing'  // 语音转写中
  | 'analyzing'     // AI 智能分析中
  | 'generating'    // 生成推荐方案
  | 'completed'     // 分析完成
  | 'failed';       // 失败

/** 阶段进度信息 */
export interface ProcessingProgress {
  id: string;
  stage: ProcessingStage;
  progress: number;  // 0-100
  message: string;
  status: string;
}

/** 阶段配置 */
export interface StageConfig {
  id: ProcessingStage;
  icon: string;
  text: string;
  progress: number;
}

/** 阶段列表 */
export const STAGES: StageConfig[] = [
  { id: 'uploading', icon: '📤', text: '上传中...', progress: 10 },
  { id: 'transcribing', icon: '🎤', text: '语音转写中...', progress: 30 },
  { id: 'analyzing', icon: '🧠', text: 'AI 智能分析中...', progress: 60 },
  { id: 'generating', icon: '✨', text: '生成推荐方案...', progress: 85 },
  { id: 'completed', icon: '✅', text: '分析完成！', progress: 100 },
];

/** 质量评分 */
export interface QualityScores {
  clarity: number;   // 清晰度
  fluency: number;   // 流畅度
  emotion: number;   // 情感表达
  speed: number;     // 语速适中程度
}

/** 分析后的片段 */
export interface AnalyzedSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  action: 'keep' | 'delete' | 'choose';
  classification: 'matched' | 'deviation' | 'filler' | 'repeat' | 'improvisation' | 'valuable' | 'noise';
  confidence: number;
  repeat_group_id?: string;
  script_match?: string;
  is_recommended: boolean;
  asset_id?: string;  // 来源素材 ID（多素材场景）
  filler_words: string[];
  reason?: string;
  quality_score: number;
  quality_scores?: QualityScores;
  quality_notes?: string;
}

/** 重复片段组 */
export interface RepeatGroup {
  id: string;
  intent: string;
  script_match?: string;
  segment_ids: string[];
  segments: AnalyzedSegment[];  // 关联的片段列表
  recommended_id: string;
  recommendation_reason?: string;
  recommend_reason?: string;  // 保持向后兼容
}

/** 缩放推荐 */
export interface ZoomRecommendation {
  rhythm: 'punchy' | 'smooth' | 'minimal';
  scale_range: [number, number];
  duration_ms: number;
  easing: string;
  triggers: string[];
}

/** 风格分析 */
export interface StyleAnalysis {
  detected_style: string;
  style_icon?: string;
  style_confidence: number;
  confidence?: number;  // 保持向后兼容
  description?: string;
  reasoning?: string;
  zoom_recommendation?: ZoomRecommendation;
}

/** 分析摘要 */
export interface AnalysisSummary {
  total_segments: number;
  keep_count: number;
  delete_count: number;
  choose_count: number;
  repeat_groups_count: number;
  estimated_duration_after: number;
  reduction_percent: number;
  script_coverage?: number;
}

/** 完整分析结果 */
export interface AnalysisResult {
  id: string;
  project_id: string;
  mode: 'with_script' | 'without_script';
  segments: AnalyzedSegment[];
  repeat_groups: RepeatGroup[];
  style_analysis?: StyleAnalysis;
  summary: AnalysisSummary;
  status: string;
}

/** 片段选择 */
export interface SegmentSelection {
  segment_id: string;
  action: 'keep' | 'delete';
  selected_from_group?: string;
}

/** 脚本信息 */
export interface ProjectScript {
  id: string;
  project_id: string;
  content: string;
  title?: string;
  word_count: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// API 请求封装
// ============================================

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // ★ 在请求前确保 token 有效（会自动刷新即将过期的 token）
  const token = await ensureValidToken();
  
  if (!token) {
    handleAuthExpired();
    throw new Error('认证已过期，请重新登录');
  }
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // ★ 如果刷新后还是 401，说明 session 真的无效了
    debugError('Got 401 even after token refresh');
    handleAuthExpired();
    throw new Error('认证已过期，请重新登录');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `请求失败: ${response.status}`);
  }

  return response.json();
}

// ============================================
// 智能分析 API
// ============================================

export interface ContentAnalysisRequest {
  project_id: string;
  script?: string;
  transcript_id?: string;
  options?: {
    detect_repeats?: boolean;
    analyze_style?: boolean;
    generate_zoom_recommendations?: boolean;
    filler_sensitivity?: number;
  };
}

export interface ContentAnalysisResponse {
  analysis_id: string;
  status: string;
  message: string;
}

/**
 * 开始智能内容分析
 */
export async function startContentAnalysis(
  req: ContentAnalysisRequest
): Promise<ContentAnalysisResponse> {
  debugLog('开始智能分析:', req);
  
  return await apiRequest<ContentAnalysisResponse>('/ai/v2/analyze-content', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/**
 * 获取分析进度
 */
export async function getAnalysisProgress(
  analysisId: string
): Promise<ProcessingProgress> {
  return await apiRequest<ProcessingProgress>(`/ai/v2/analysis/${analysisId}/progress`);
}

/**
 * 获取分析结果
 */
export async function getAnalysisResult(
  analysisId: string
): Promise<AnalysisResult> {
  return await apiRequest<AnalysisResult>(`/ai/v2/analysis/${analysisId}/result`);
}

/**
 * 根据项目 ID 获取最新的分析结果
 * 用于弹窗打开时没有 analysis_id 的场景
 */
export interface LatestAnalysisResponse {
  has_analysis: boolean;
  analysis: AnalysisResult | null;
}

export async function getLatestAnalysisByProject(
  projectId: string
): Promise<LatestAnalysisResponse> {
  debugLog('根据项目获取最新分析:', projectId);
  return await apiRequest<LatestAnalysisResponse>(`/ai/v2/project/${projectId}/latest-analysis`);
}

/**
 * 确认选择
 */
export interface ConfirmSelectionRequest {
  analysis_id: string;
  selections: SegmentSelection[];
  apply_zoom_recommendations?: boolean;
}

export interface ConfirmSelectionResponse {
  success: boolean;
  selection_id: string;
  clips_created: number;
  message: string;
}

export async function confirmSelectionApi(
  req: ConfirmSelectionRequest
): Promise<ConfirmSelectionResponse> {
  debugLog('🚀 [confirmSelectionApi] 发送确认请求:', {
    analysis_id: req.analysis_id,
    selectionsCount: req.selections.length,
    keepCount: req.selections.filter(s => s.action === 'keep').length,
    deleteCount: req.selections.filter(s => s.action === 'delete').length,
    apply_zoom: req.apply_zoom_recommendations,
  });
  
  const result = await apiRequest<ConfirmSelectionResponse>('/ai/v2/confirm-selection', {
    method: 'POST',
    body: JSON.stringify(req),
  });
  
  debugLog('✅ [confirmSelectionApi] 收到响应:', result);
  
  return result;
}

// ============================================
// 脚本管理 API
// ============================================

/**
 * 上传脚本
 */
export async function uploadScript(
  projectId: string,
  content: string,
  title?: string
): Promise<{ id: string; word_count: number }> {
  return await apiRequest('/ai/v2/scripts', {
    method: 'POST',
    body: JSON.stringify({
      project_id: projectId,
      content,
      title,
    }),
  });
}

/**
 * 获取脚本
 */
export async function getScript(projectId: string): Promise<ProjectScript | null> {
  try {
    return await apiRequest<ProjectScript>(`/ai/v2/scripts/${projectId}`);
  } catch (e) {
    // 404 表示没有脚本
    return null;
  }
}

// ============================================
// 轮询 Hook
// ============================================

/**
 * 轮询分析进度
 * @param analysisId 分析 ID
 * @param onProgress 进度回调
 * @param onComplete 完成回调
 * @param onError 错误回调
 * @param intervalMs 轮询间隔（默认 3000ms，减少服务器负载）
 */
export function pollAnalysisProgress(
  analysisId: string,
  onProgress: (progress: ProcessingProgress) => void,
  onComplete: (result: AnalysisResult) => void,
  onError: (error: Error) => void,
  intervalMs: number = 3000
): () => void {
  let stopped = false;
  
  const poll = async () => {
    if (stopped) return;
    
    try {
      const progress = await getAnalysisProgress(analysisId);
      onProgress(progress);
      
      if (progress.stage === 'completed') {
        // 获取完整结果
        const result = await getAnalysisResult(analysisId);
        onComplete(result);
        return;
      }
      
      if (progress.stage === 'failed') {
        onError(new Error(progress.message || '分析失败'));
        return;
      }
      
      // 继续轮询
      if (!stopped) {
        setTimeout(poll, intervalMs);
      }
    } catch (e) {
      if (!stopped) {
        onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  };
  
  // 开始轮询
  poll();
  
  // 返回停止函数
  return () => {
    stopped = true;
  };
}

// ============================================
// 辅助函数
// ============================================

/**
 * 获取阶段显示信息
 */
export function getStageInfo(stage: ProcessingStage): StageConfig {
  return STAGES.find(s => s.id === stage) || STAGES[0];
}

/**
 * 格式化时间
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 格式化时长
 */
export function formatDuration(seconds: number): string {
  if (seconds < 1) {
    return `${Math.round(seconds * 1000)}ms`;
  }
  return `${seconds.toFixed(1)}s`;
}

/**
 * 获取分类标签
 */
export function getClassificationLabel(classification: string): { text: string; color: string } {
  const labels: Record<string, { text: string; color: string }> = {
    matched: { text: '匹配', color: 'green' },
    deviation: { text: '偏离', color: 'yellow' },
    filler: { text: '废话', color: 'red' },
    repeat: { text: '重复', color: 'orange' },
    improvisation: { text: '即兴', color: 'blue' },
  };
  return labels[classification] || { text: classification, color: 'gray' };
}

/**
 * 获取动作标签
 */
export function getActionLabel(action: string): { text: string; color: string; icon: string } {
  const labels: Record<string, { text: string; color: string; icon: string }> = {
    keep: { text: '保留', color: 'green', icon: '✓' },
    delete: { text: '删除', color: 'red', icon: '✗' },
    choose: { text: '待选', color: 'orange', icon: '?' },
  };
  return labels[action] || { text: action, color: 'gray', icon: '?' };
}
