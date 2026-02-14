/**
 * Capability API — AI 能力注册与执行服务 (PRD v1.1)
 * 
 * PRD §5 + §7: /api/v2/capabilities/*
 * 查询能力列表、获取参数 schema、执行能力
 */
import { ApiClient } from './client';
import type { ApiResponse } from './types';
import type { CapabilityType } from '@/types/discover';

/** 能力定义 */
export interface CapabilityDefinition {
  type: CapabilityType;
  name: string;
  description: string;
  /** 参数 JSON Schema */
  param_schema: Record<string, unknown>;
  /** 是否需要人脸 */
  requires_face: boolean;
  /** 预计耗时（秒） */
  estimated_time: number;
  /** 消耗积分 */
  credit_cost: number;
}

/** 能力执行请求 */
export interface CapabilityExecuteRequest {
  session_id: string;
  capability: CapabilityType;
  /** 输入图 URL 列表 */
  input_urls: string[];
  /** 用户设置的参数 */
  params: Record<string, unknown>;
}

/** 能力执行结果 */
export interface CapabilityExecuteResponse {
  execution_id: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  result_url?: string;
  error?: string;
}

/** 能力注册表项（含完整 param_schema） */
export interface CapabilityRegistryItem {
  type: CapabilityType;
  name: string;
  description: string;
  icon: string;
  requires_face: boolean;
  estimated_time: number;
  credit_cost: number;
  param_schema: Record<string, {
    type: 'color' | 'text' | 'select' | 'image' | 'slider';
    label: string;
    default?: unknown;
    min?: number;
    max?: number;
    options?: { label: string; value: string }[];
  }>;
  sort_order: number;
  enabled: boolean;
}

class CapabilityApi extends ApiClient {
  /** 获取完整能力注册表（含 param_schema · 画布渲染用） */
  async registry(): Promise<ApiResponse<CapabilityRegistryItem[]>> {
    return this.request<CapabilityRegistryItem[]>('/v2/capabilities/registry');
  }

  /** 获取所有可用能力 */
  async list(): Promise<ApiResponse<CapabilityDefinition[]>> {
    return this.request<CapabilityDefinition[]>('/v2/capabilities');
  }

  /** 获取单个能力定义 + 参数 schema */
  async getDefinition(type: CapabilityType): Promise<ApiResponse<CapabilityDefinition>> {
    return this.request<CapabilityDefinition>(`/v2/capabilities/${type}`);
  }

  /** 执行 AI 能力 */
  async execute(req: CapabilityExecuteRequest): Promise<ApiResponse<CapabilityExecuteResponse>> {
    return this.request<CapabilityExecuteResponse>('/v2/capabilities/execute', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  /** 查询执行状态 */
  async getStatus(executionId: string): Promise<ApiResponse<CapabilityExecuteResponse>> {
    return this.request<CapabilityExecuteResponse>(`/v2/capabilities/executions/${executionId}`);
  }

  /** 按序执行整条能力链路 (PRD §5.2) */
  async executeChain(req: ExecuteChainRequest): Promise<ApiResponse<ExecuteChainResponse>> {
    return this.request<ExecuteChainResponse>('/v2/capabilities/execute-chain', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }
}

/** 链路执行请求 */
export interface ExecuteChainRequest {
  session_id: string;
  route: { capability: CapabilityType; params: Record<string, unknown>; prompt_template?: string }[];
  input_urls: string[];
}

/** 链路执行结果 */
export interface ExecuteChainResponse {
  chain_id: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  steps: {
    order: number;
    capability: string;
    execution_id: string | null;
    status: string;
    error?: string;
  }[];
}

export const capabilityApi = new CapabilityApi();
