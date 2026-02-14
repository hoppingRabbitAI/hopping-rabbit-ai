/**
 * Lepus AI - 多模型参数目录 API
 *
 * 对接后端 /models/* 端点，供 ApplyTemplateModal 动态渲染参数表单。
 */

import { authFetch } from '@/lib/supabase/session';

// ── 类型定义 ──

export interface ParamSpec {
  name: string;
  type: 'string' | 'float' | 'int' | 'bool' | 'select' | 'json';
  required: boolean;
  default: unknown;
  options?: (string | number)[];
  constraints?: Record<string, unknown>;
  ui_hint: 'slider' | 'select' | 'text' | 'textarea' | 'toggle' | 'hidden';
  label_zh: string;
  label_en: string;
  desc_zh: string;
  desc_en: string;
  group: 'core' | 'quality' | 'advanced';
  locked_when?: string[];
}

export interface EndpointSpec {
  name: string;
  display_name_zh: string;
  display_name_en: string;
  capabilities: string[];
  models: string[];
  params: ParamSpec[];
  notes_zh: string;
}

export interface ProviderSpec {
  provider: string;
  display_name: string;
  status: 'active' | 'beta' | 'planned';
  api_doc_url: string;
  endpoints: EndpointSpec[];
}

export interface CompatibilityResult {
  provider: string;
  provider_display: string;
  endpoint: string;
  endpoint_display: string;
  models: string[];
  compatible: boolean;
  missing_capabilities: string[];
  status: 'active' | 'beta' | 'planned';
}

/** provider key → ProviderSpec */
export type ModelCatalog = Record<string, ProviderSpec>;

// ── 扁平化：前端渲染模型选择器用的简化结构 ──

export interface ModelOption {
  /** 唯一标识，如 "kling:image_to_video:kling-v2-6" */
  key: string;
  provider: string;
  providerDisplay: string;
  endpoint: string;
  endpointDisplay: string;
  modelName: string;
  status: 'active' | 'beta' | 'planned';
  compatible: boolean;
  missingCapabilities: string[];
  params: ParamSpec[];
  defaults: Record<string, unknown>;
  notes: string;
}

// ── API 调用 ──

export async function fetchModelCatalog(): Promise<ModelCatalog> {
  const res = await authFetch('/api/models/catalog');
  if (!res.ok) throw new Error(`Failed to fetch model catalog: ${res.status}`);
  return res.json();
}

export async function fetchProviderCatalog(provider: string): Promise<ProviderSpec> {
  const res = await authFetch(`/api/models/catalog/${provider}`);
  if (!res.ok) throw new Error(`Provider not found: ${provider}`);
  return res.json();
}

export async function checkCompatibility(capabilities: string[]): Promise<CompatibilityResult[]> {
  const res = await authFetch(`/api/models/compatibility?capabilities=${capabilities.join(',')}`);
  if (!res.ok) throw new Error(`Compatibility check failed: ${res.status}`);
  return res.json();
}

export async function fetchDefaults(provider: string, endpoint: string): Promise<Record<string, unknown>> {
  const res = await authFetch(`/api/models/defaults/${provider}/${endpoint}`);
  if (!res.ok) return {};
  return res.json();
}

// ── 工具函数 ──

/**
 * 把 catalog + compatibility 数据合并成扁平 ModelOption 列表，
 * 给前端 <select> 用。
 */
export function flattenModels(
  catalog: ModelCatalog,
  compatibility?: CompatibilityResult[],
  endpointFilter?: string,
): ModelOption[] {
  const compatMap = new Map<string, CompatibilityResult>();
  if (compatibility) {
    for (const c of compatibility) {
      compatMap.set(`${c.provider}:${c.endpoint}`, c);
    }
  }

  const results: ModelOption[] = [];

  for (const [providerKey, spec] of Object.entries(catalog)) {
    for (const ep of spec.endpoints) {
      if (endpointFilter && ep.name !== endpointFilter) continue;

      const compatKey = `${providerKey}:${ep.name}`;
      const compat = compatMap.get(compatKey);

      for (const modelName of ep.models) {
        // 构建默认值 dict
        const defaults: Record<string, unknown> = {};
        for (const p of ep.params) {
          if (p.default !== null && p.default !== undefined) {
            defaults[p.name] = p.default;
          }
        }
        // model_name 用当前遍历到的
        defaults['model_name'] = modelName;

        results.push({
          key: `${providerKey}:${ep.name}:${modelName}`,
          provider: providerKey,
          providerDisplay: spec.display_name,
          endpoint: ep.name,
          endpointDisplay: ep.display_name_zh,
          modelName,
          status: spec.status,
          compatible: compat ? compat.compatible : true,
          missingCapabilities: compat?.missing_capabilities ?? [],
          params: ep.params,
          defaults,
          notes: ep.notes_zh,
        });
      }
    }
  }

  return results;
}
