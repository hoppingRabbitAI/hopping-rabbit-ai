/**
 * NodeLineagePanel — 节点溯源面板
 *
 * 显示选中节点的完整来源关系图：
 * - 上游（谁产生了它）
 * - 下游（它派生了什么）
 * - 树状结构，带颜色标记关系类型
 * - 点击跳转/高亮对应节点
 */

'use client';

import React, { useMemo, useCallback } from 'react';
import {
  X,
  ChevronRight,
  ChevronDown,
  GitBranch,
  Scissors,
  Sparkles,
  ImagePlus,
  Frame,
  Layers as LayersIcon,
  Link,
  Combine,
  Copy,
  ArrowRightLeft,
  Palette,
  Link2,
  ArrowUp,
  ArrowDown,
  Image as ImageIcon,
  Video,
  Circle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  type CanvasEdge,
  type NodeRelationType,
  RELATION_TYPE_CONFIGS,
} from '@/types/visual-editor';

// ==========================================
// 类型
// ==========================================

/** 可用于溯源的节点信息（从外部传入） */
export interface LineageNodeInfo {
  id: string;
  label: string;
  thumbnail?: string;
  mediaType: 'video' | 'image';
  isFreeNode?: boolean;
}

interface NodeLineagePanelProps {
  /** 当前选中节点 ID */
  selectedNodeId: string;
  /** 所有关联连线（含 relationType） */
  canvasEdges: CanvasEdge[];
  /** 节点信息映射（id → info） */
  nodeInfoMap: Record<string, LineageNodeInfo>;
  /** 关闭面板 */
  onClose: () => void;
  /** 点击节点 → 跳转高亮 */
  onFocusNode: (nodeId: string) => void;
}

// ==========================================
// Icon 映射
// ==========================================

const ICON_MAP: Record<string, LucideIcon> = {
  Scissors,
  Sparkles,
  ImagePlus,
  Frame,
  Layers: LayersIcon,
  Link,
  Combine,
  Copy,
  ArrowRightLeft,
  Palette,
  Link2,
};

// ==========================================
// 组件
// ==========================================

export function NodeLineagePanel({
  selectedNodeId,
  canvasEdges,
  nodeInfoMap,
  onClose,
  onFocusNode,
}: NodeLineagePanelProps) {
  const selectedNode = nodeInfoMap[selectedNodeId];

  // ★ 构建上游 & 下游关系列表
  const { upstream, downstream } = useMemo(() => {
    // 只看有 relationType 的边
    const relationEdges = canvasEdges.filter(e => e.relationType);

    // 上游：target === selectedNodeId（谁指向了我）
    const up = relationEdges
      .filter(e => e.target === selectedNodeId)
      .map(e => ({
        edge: e,
        nodeId: e.source,
        nodeInfo: nodeInfoMap[e.source],
        relationType: e.relationType!,
        relationLabel: e.relationLabel,
      }))
      .filter(item => item.nodeInfo); // 只保留有信息的

    // 下游：source === selectedNodeId（我指向了谁）
    const down = relationEdges
      .filter(e => e.source === selectedNodeId)
      .map(e => ({
        edge: e,
        nodeId: e.target,
        nodeInfo: nodeInfoMap[e.target],
        relationType: e.relationType!,
        relationLabel: e.relationLabel,
      }))
      .filter(item => item.nodeInfo);

    return { upstream: up, downstream: down };
  }, [selectedNodeId, canvasEdges, nodeInfoMap]);

  // ★ 递归查找完整溯源链（从选中节点一直追溯到最初来源）
  const fullLineageChain = useMemo(() => {
    const relationEdges = canvasEdges.filter(e => e.relationType);
    const chain: { nodeId: string; relationType: NodeRelationType; depth: number }[] = [];
    const visited = new Set<string>();

    function traceUpstream(nodeId: string, depth: number) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const parents = relationEdges.filter(e => e.target === nodeId);
      for (const parent of parents) {
        chain.push({ nodeId: parent.source, relationType: parent.relationType!, depth });
        traceUpstream(parent.source, depth + 1);
      }
    }

    traceUpstream(selectedNodeId, 0);
    return chain.reverse(); // 最远的祖先在前
  }, [selectedNodeId, canvasEdges]);

  const handleNodeClick = useCallback((nodeId: string) => {
    onFocusNode(nodeId);
  }, [onFocusNode]);

  if (!selectedNode) return null;

  return (
    <div className="absolute right-4 top-16 z-50 w-80 max-h-[calc(100vh-200px)] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col animate-in slide-in-from-right-5 duration-200">
      {/* ★ 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/80">
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-800">节点溯源</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-gray-200 transition-colors text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 p-4 space-y-4">
        {/* ★ 当前节点信息 */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
          {selectedNode.thumbnail ? (
            <img
              src={selectedNode.thumbnail}
              alt={selectedNode.label}
              className="w-12 h-12 rounded-lg object-cover ring-2 ring-gray-300"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center ring-2 ring-gray-300">
              {selectedNode.mediaType === 'video' ? (
                <Video size={18} className="text-gray-400" />
              ) : (
                <ImageIcon size={18} className="text-gray-400" />
              )}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">
              {selectedNode.label}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <Circle size={6} className="text-gray-400 fill-gray-400" />
              <span className="text-[11px] text-gray-600">当前选中</span>
            </div>
          </div>
        </div>

        {/* ★ 完整溯源链 */}
        {fullLineageChain.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <ArrowUp size={14} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                溯源链（{fullLineageChain.length} 层）
              </span>
            </div>
            <div className="relative pl-4 border-l-2 border-gray-200 space-y-1.5">
              {fullLineageChain.map((item, idx) => {
                const nodeInfo = nodeInfoMap[item.nodeId];
                const config = RELATION_TYPE_CONFIGS[item.relationType];
                if (!nodeInfo) return null;
                return (
                  <div
                    key={`chain-${item.nodeId}-${idx}`}
                    className="relative flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group"
                    onClick={() => handleNodeClick(item.nodeId)}
                  >
                    {/* 连接线上的圆点 */}
                    <div
                      className="absolute -left-[21px] w-3 h-3 rounded-full border-2 bg-white"
                      style={{ borderColor: config.color }}
                    />
                    {/* 缩略图 */}
                    {nodeInfo.thumbnail ? (
                      <img
                        src={nodeInfo.thumbnail}
                        alt={nodeInfo.label}
                        className="w-8 h-8 rounded object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                        {nodeInfo.mediaType === 'video' ? (
                          <Video size={12} className="text-gray-400" />
                        ) : (
                          <ImageIcon size={12} className="text-gray-400" />
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-700 truncate group-hover:text-gray-700">
                        {nodeInfo.label}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: `${config.color}15`,
                            color: config.color,
                          }}
                        >
                          {config.label}
                        </span>
                      </div>
                    </div>
                    <ChevronRight size={12} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                );
              })}
              {/* 最底部指向当前节点 */}
              <div className="relative flex items-center gap-2 py-1.5 px-2">
                <div className="absolute -left-[21px] w-3 h-3 rounded-full border-2 border-gray-800 bg-gray-800" />
                <span className="text-[11px] text-gray-600 font-medium">← 当前节点</span>
              </div>
            </div>
          </div>
        )}

        {/* ★ 直接上游 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ArrowUp size={14} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              来源 · 上游 ({upstream.length})
            </span>
          </div>
          {upstream.length === 0 ? (
            <div className="text-xs text-gray-400 italic px-2 py-3 text-center bg-gray-50 rounded-lg">
              无上游来源 — 这是原始素材
            </div>
          ) : (
            <div className="space-y-1.5">
              {upstream.map(item => {
                const config = RELATION_TYPE_CONFIGS[item.relationType];
                const Icon = ICON_MAP[config.icon] || Link2;
                return (
                  <div
                    key={item.edge.id}
                    className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group border border-transparent hover:border-gray-200"
                    onClick={() => handleNodeClick(item.nodeId)}
                  >
                    {item.nodeInfo.thumbnail ? (
                      <img
                        src={item.nodeInfo.thumbnail}
                        alt={item.nodeInfo.label}
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                        {item.nodeInfo.mediaType === 'video' ? (
                          <Video size={14} className="text-gray-400" />
                        ) : (
                          <ImageIcon size={14} className="text-gray-400" />
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-700 truncate group-hover:text-gray-700">
                        {item.nodeInfo.label}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <Icon size={10} style={{ color: config.color }} />
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: config.color }}
                        >
                          {item.relationLabel || config.label}
                        </span>
                        <span className="text-[10px] text-gray-400">→ 当前</span>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ★ 直接下游 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ArrowDown size={14} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              派生 · 下游 ({downstream.length})
            </span>
          </div>
          {downstream.length === 0 ? (
            <div className="text-xs text-gray-400 italic px-2 py-3 text-center bg-gray-50 rounded-lg">
              暂无派生节点
            </div>
          ) : (
            <div className="space-y-1.5">
              {downstream.map(item => {
                const config = RELATION_TYPE_CONFIGS[item.relationType];
                const Icon = ICON_MAP[config.icon] || Link2;
                return (
                  <div
                    key={item.edge.id}
                    className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group border border-transparent hover:border-gray-200"
                    onClick={() => handleNodeClick(item.nodeId)}
                  >
                    {item.nodeInfo.thumbnail ? (
                      <img
                        src={item.nodeInfo.thumbnail}
                        alt={item.nodeInfo.label}
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                        {item.nodeInfo.mediaType === 'video' ? (
                          <Video size={14} className="text-gray-400" />
                        ) : (
                          <ImageIcon size={14} className="text-gray-400" />
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-700 truncate group-hover:text-gray-700">
                        {item.nodeInfo.label}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-gray-400">当前 →</span>
                        <Icon size={10} style={{ color: config.color }} />
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: config.color }}
                        >
                          {item.relationLabel || config.label}
                        </span>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ★ 关系图例 */}
        {(upstream.length > 0 || downstream.length > 0) && (
          <div className="pt-2 border-t border-gray-100">
            <div className="text-[10px] text-gray-400 font-medium mb-2 uppercase tracking-wide">图例</div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(new Set([
                ...upstream.map(i => i.relationType),
                ...downstream.map(i => i.relationType),
              ])).map(type => {
                const cfg = RELATION_TYPE_CONFIGS[type];
                const Icon = ICON_MAP[cfg.icon] || Link2;
                return (
                  <div
                    key={type}
                    className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px]"
                    style={{ backgroundColor: `${cfg.color}10`, color: cfg.color }}
                  >
                    <Icon size={10} />
                    <span>{cfg.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default NodeLineagePanel;
