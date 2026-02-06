/**
 * 模版注册中心
 */

import type { TemplateConfig } from '../types/visual';
import { whiteboardTemplate } from './whiteboard';
import { talkingHeadTemplate } from './talkingHead';

// 支持的模版 ID
export type TemplateId = 'whiteboard' | 'talking-head';

// 模版注册表
const templates: Record<TemplateId, TemplateConfig> = {
  'whiteboard': whiteboardTemplate,
  'talking-head': talkingHeadTemplate,
};

/**
 * 获取指定模版配置
 * @param id 模版 ID，默认 whiteboard
 */
export function getTemplate(id: TemplateId = 'whiteboard'): TemplateConfig {
  return templates[id] || whiteboardTemplate;
}

/**
 * 获取所有模版列表
 */
export function getAllTemplates(): TemplateConfig[] {
  return Object.values(templates);
}

/**
 * 检查模版是否存在
 */
export function hasTemplate(id: string): id is TemplateId {
  return id in templates;
}
