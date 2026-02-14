/**
 * Intent Router API — AI 意图路由服务 (PRD v1.1)
 * 
 * PRD §4: /api/v2/intent/*
 * 用户上传参考图 + 文字描述 → 解析意图 → 推荐能力组合
 */
import { ApiClient } from './client';
import type { ApiResponse } from './types';
import type { CapabilityType, RouteStep, RouteResult } from '@/types/discover';

/** 意图解析请求 (旧接口) */
export interface IntentParseRequest {
  text?: string;
  reference_url?: string;
  subject_url?: string;
  template_id?: string;
}

/** 意图解析结果 (旧接口) */
export interface IntentParseResponse {
  intent_id: string;
  capabilities: CapabilityRecommendation[];
  confidence: number;
  explanation: string;
}

/** 单个能力推荐 */
export interface CapabilityRecommendation {
  capability: CapabilityType;
  suggested_params: Record<string, unknown>;
  importance: number;
  order: number;
}

/** 完整分析请求 (新接口 — PRD §4) */
export interface AnalyzeRequest {
  subject_url?: string;
  reference_url?: string;
  text?: string;
  template_id?: string;
}

/** 仅文字分析请求 */
export interface AnalyzeTextRequest {
  text: string;
  subject_url?: string;
  template_id?: string;
}

class IntentRouterApi extends ApiClient {
  /** 解析用户意图 (旧) */
  async parse(request: IntentParseRequest): Promise<ApiResponse<IntentParseResponse>> {
    return this.request<IntentParseResponse>('/v2/intent/parse', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /** 确认意图 → 生成 canvas pipeline (旧) */
  async confirm(intentId: string): Promise<ApiResponse<{ session_id: string; pipeline: unknown }>> {
    return this.request<{ session_id: string; pipeline: unknown }>('/v2/intent/confirm', {
      method: 'POST',
      body: JSON.stringify({ intent_id: intentId }),
    });
  }

  /** 完整分析: 照片 + 参考图 + 文字 → RouteResult */
  async analyze(request: AnalyzeRequest): Promise<ApiResponse<RouteResult>> {
    return this.request<RouteResult>('/v2/intent/analyze', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /** 仅文字分析 → RouteResult */
  async analyzeText(request: AnalyzeTextRequest): Promise<ApiResponse<RouteResult>> {
    return this.request<RouteResult>('/v2/intent/analyze-text', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }
}

export const intentRouterApi = new IntentRouterApi();
