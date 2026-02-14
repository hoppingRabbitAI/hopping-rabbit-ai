/**
 * Canvas Nodes API — Visual Editor 专用
 *
 * 直接操作 canvas_nodes / canvas_edges 表，
 * 不再通过 shot-segmentation 中间层。
 */

import { authFetch } from '@/lib/supabase/session';

// ============================================
// 类型
// ============================================

export interface CanvasNodeRow {
  id: string;
  project_id: string;
  asset_id: string;
  node_type: 'sequence' | 'free' | 'prompt';
  media_type: 'video' | 'image';
  order_index: number;
  start_time: number;   // 秒 (float)
  end_time: number;     // 秒 (float)
  duration: number;     // 秒 (float)
  source_start: number; // 毫秒
  source_end: number;   // 毫秒
  canvas_position: { x: number; y: number } | null;
  video_url: string | null;
  thumbnail_url: string | null;
  metadata: Record<string, unknown> | null;
  clip_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CanvasEdgeRow {
  id: string;
  project_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  target_handle: string | null;
  relation_type: string | null;    // ★ 关联关系类型
  relation_label: string | null;   // ★ 关联关系标签
  created_at: string;
}

export interface ListCanvasNodesResponse {
  project_id: string;
  sequence_nodes: CanvasNodeRow[];
  free_nodes: CanvasNodeRow[];
  prompt_nodes?: CanvasNodeRow[];
  canvas_edges: CanvasEdgeRow[];
  total_count: number;
}

export interface BatchCreateNodeItem {
  id?: string;
  asset_id?: string;
  node_type?: 'sequence' | 'free' | 'prompt';
  media_type?: 'video' | 'image';
  order_index?: number;
  start_time?: number;
  end_time?: number;
  duration?: number;
  source_start?: number;
  source_end?: number;
  canvas_position?: { x: number; y: number };
  video_url?: string | null;
  thumbnail_url?: string | null;
  metadata?: Record<string, unknown>;
  clip_id?: string | null;
}

export interface BatchCreateResponse {
  success: boolean;
  created_count: number;
  nodes: CanvasNodeRow[];
}

export interface EdgeSyncItem {
  source_node_id: string;
  target_node_id: string;
  source_handle?: string | null;
  target_handle?: string | null;
  relation_type?: string | null;   // ★ 关联关系类型
  relation_label?: string | null;  // ★ 关联关系标签
}

// ============================================
// API 方法
// ============================================

const PREFIX = '/api/canvas-nodes';

/** GET /projects/{projectId} — 获取所有画布节点 + 边 */
export async function listCanvasNodes(projectId: string): Promise<ListCanvasNodesResponse> {
  const res = await authFetch(`${PREFIX}/projects/${projectId}`);
  if (!res.ok) throw new Error(`获取画布节点失败: ${res.status}`);
  return res.json();
}

/** PUT /{nodeId} — 更新画布节点 */
export async function updateCanvasNode(
  nodeId: string,
  data: Partial<{
    node_type: string;
    order_index: number;
    start_time: number;
    end_time: number;
    duration: number;
    canvas_position: { x: number; y: number };
    video_url: string;
    thumbnail_url: string;
    metadata: Record<string, unknown>;
  }>,
): Promise<CanvasNodeRow> {
  const res = await authFetch(`${PREFIX}/${nodeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`更新画布节点失败: ${res.status}`);
  return res.json();
}

/** DELETE /{nodeId} — 删除画布节点 + 关联边 */
export async function deleteCanvasNode(nodeId: string): Promise<void> {
  const res = await authFetch(`${PREFIX}/${nodeId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`删除画布节点失败: ${res.status}`);
}

/** POST /projects/{projectId}/batch — 批量创建画布节点 */
export async function batchCreateCanvasNodes(
  projectId: string,
  nodes: BatchCreateNodeItem[],
): Promise<BatchCreateResponse> {
  const res = await authFetch(`${PREFIX}/projects/${projectId}/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes }),
  });
  if (!res.ok) throw new Error(`批量创建画布节点失败: ${res.status}`);
  return res.json();
}

/** PUT /projects/{projectId}/reorder — 重新排序序列节点 */
export async function reorderCanvasNodes(
  projectId: string,
  nodeIds: string[],
): Promise<{ success: boolean; count: number }> {
  const res = await authFetch(`${PREFIX}/projects/${projectId}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nodeIds),
  });
  if (!res.ok) throw new Error(`重排序失败: ${res.status}`);
  return res.json();
}

/** PUT /projects/{projectId}/edges/sync — 全量同步画布连线 */
export async function syncCanvasEdges(
  projectId: string,
  edges: EdgeSyncItem[],
): Promise<{ success: boolean; count: number }> {
  const res = await authFetch(`${PREFIX}/projects/${projectId}/edges/sync`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(edges),
  });
  if (!res.ok) throw new Error(`同步连线失败: ${res.status}`);
  return res.json();
}
