/**
 * 智能清理向导 - 统一的清理流程
 * Step 1: 片段审核 - 统一展示换气片段和废片，用户选择保留或删除
 * Step 2: 重复选择 - 选择最佳版本（如果有重复组）
 * Step 3: 确认 - 查看统计并确认
 * 
 * 核心设计：
 * - 换气片段和废片统一展示，避免用户重复勾选
 * - 自动检测并去重：如果换气片段与分析片段时间重叠，只展示一次
 */
'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Wind, CheckCircle2, Trash2, Play,
  Sparkles, RefreshCw, ChevronDown, ChevronUp, ChevronRight,
  Star, AlertTriangle, Zap, Volume2, Scissors, CheckSquare, Square,
  Edit3, Check, SkipForward
} from 'lucide-react';
import { useEditorStore } from '../store/editor-store';
import { msToSec } from '../lib/time-utils';
import { checkHlsAvailable, getHlsPlaylistUrl, getAssetProxyUrl } from '@/lib/api/media-proxy';
import type { 
  AnalysisResult, 
  AnalyzedSegment, 
  RepeatGroup,
  SegmentSelection 
} from '../lib/smart-v2-api';
import { confirmSelectionApi, getAnalysisResult, getAnalysisProgress, getLatestAnalysisByProject } from '../lib/smart-v2-api';
import { toast } from '@/lib/stores/toast-store';
import { VideoPreviewPanel, type PreviewSegment } from './VideoPreviewPanel';
import { projectApi } from '@/lib/api/projects';

// ============================================================
// 常量和工具
// ============================================================
const CONTEXT_DURATION = 2000; // 预览上下文时长（毫秒）- 前后各2秒
const DEBUG = false; // ★ 已关闭，视频缓冲日志在 VideoCanvasStore 中
const log = (...args: unknown[]) => DEBUG && console.log('[SmartCleanupWizard]', ...args);

// 检测 Safari 原生 HLS 支持
const isSafariNativeHls = (): boolean => {
  const video = document.createElement('video');
  return !!video.canPlayType('application/vnd.apple.mpegurl');
};

// 时间格式化
const formatTime = (ms: number): string => {
  const sec = msToSec(ms);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms100 = Math.floor((sec % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${ms100.toString().padStart(2, '0')}`;
};

// ============================================================
// 类型定义
// ============================================================

/** 统一的待处理片段类型 */
interface UnifiedSegment {
  id: string;
  type: 'breath' | 'analysis';  // 来源类型
  sourceStart: number;  // 素材时间（毫秒）
  sourceEnd: number;    // 素材时间（毫秒）
  duration: number;     // 时长（毫秒）
  text?: string;        // 文字内容（换气片段可能没有）
  classification: 'breath' | 'matched' | 'deviation' | 'filler' | 'repeat' | 'improvisation' | 'valuable' | 'noise';
  defaultAction: 'keep' | 'delete';  // 默认推荐动作
  qualityScore?: number;  // 质量评分
  isRecommended?: boolean;
  reason?: string;
  // 原始数据引用
  breathClipId?: string;  // 换气片段对应的 clip id（用于删除）
  analysisSegmentId?: string;  // 分析片段 id（用于 API 提交）
  assetId?: string;
  // 重复组相关
  repeatGroupId?: string;  // 所属重复组 ID
  repeatGroupIntent?: string;  // 重复组意图描述
}

interface SilenceClip {
  id: string;
  name: string;
  start: number;
  duration: number;
  sourceStart: number;
  sourceEnd: number;
  assetId: string;
}

interface Props {
  isOpen: boolean;
  analysisId: string;
  projectId: string;
  assetId?: string; // 主素材ID，用于视频预览
  onClose: () => void;
  onConfirm: () => void;
}

// ============================================================
// 步骤指示器
// ============================================================
interface StepIndicatorProps {
  currentStep: number;
  steps: { num: number; label: string }[];
}

function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0 px-6 py-4 bg-gray-50 border-b border-gray-200">
      {steps.map((step, index) => (
        <div key={step.num} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
              currentStep > step.num 
                ? 'bg-emerald-500 text-white' 
                : currentStep === step.num 
                  ? 'bg-gray-1000 text-white ring-4 ring-gray-500/20' 
                  : 'bg-gray-200 text-gray-500'
            }`}>
              {currentStep > step.num ? '✓' : step.num}
            </div>
            <span className={`mt-1.5 text-xs font-medium ${
              currentStep >= step.num ? 'text-gray-900' : 'text-gray-500'
            }`}>
              {step.label}
            </span>
          </div>
          
          {index < steps.length - 1 && (
            <div className={`w-16 h-0.5 mx-2 transition-colors ${
              currentStep > step.num ? 'bg-emerald-500' : 'bg-gray-200'
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================
export function SmartCleanupWizard({ 
  isOpen, 
  analysisId,
  projectId,
  assetId,
  onClose, 
  onConfirm 
}: Props) {
  // Store
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const removeClip = useEditorStore((s) => s.removeClip);
  const compactVideoTrack = useEditorStore((s) => s.compactVideoTrack);
  const mergeAdjacentClips = useEditorStore((s) => s.mergeAdjacentClips);

  // ============================================================
  // 步骤状态
  // ============================================================
  const [currentStep, setCurrentStep] = useState(1);
  
  // 统一的选择状态：key = UnifiedSegment.id, value = 'keep' | 'delete'
  const [selectedActions, setSelectedActions] = useState<Map<string, 'keep' | 'delete'>>(new Map());
  const [repeatGroupSelections, setRepeatGroupSelections] = useState<Map<string, string>>(new Map());
  const [activePreviewSegment, setActivePreviewSegment] = useState<UnifiedSegment | null>(null);
  
  // 文本编辑状态：key = segment id, value = edited text
  const [editedTexts, setEditedTexts] = useState<Map<string, string>>(new Map());
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  
  // 智能分析状态
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  
  // ★ HLS 可用性状态（用于视频预览 fallback）
  const [hlsAvailable, setHlsAvailable] = useState<Map<string, boolean>>(new Map());
  
  // 确认状态
  const [isConfirming, setIsConfirming] = useState(false);

  // ============================================================
  // 步骤定义（简化后的流程）
  // ============================================================
  const steps = useMemo(() => {
    const hasRepeatGroups = analysisResult?.repeat_groups && analysisResult.repeat_groups.length > 0;
    return [
      { num: 1, label: '片段审核' },      // 统一展示换气和废片
      { num: 2, label: hasRepeatGroups ? '重复选择' : '确认' },
      { num: 3, label: '确认' },
    ].slice(0, hasRepeatGroups ? 3 : 2);
  }, [analysisResult]);

  // ============================================================
  // 换气片段（原始数据）
  // ============================================================
  const silenceClips = useMemo((): SilenceClip[] => {
    return clips
      .filter(c => {
        const silenceInfo = c.silenceInfo || c.metadata?.silence_info;
        return silenceInfo?.classification === 'breath';
      })
      .map(c => {
        const sourceStart = c.sourceStart ?? c.start;
        return {
          id: c.id,
          name: c.name,
          start: c.start,
          duration: c.duration,
          sourceStart,
          sourceEnd: sourceStart + c.duration,
          assetId: c.assetId || '',
        };
      })
      .sort((a, b) => a.start - b.start);
  }, [clips]);

  // 获取默认 assetId（第一个视频素材，用于片段预览）
  const defaultAssetId = useMemo(() => {
    // 优先从 props 中的 assetId 获取
    if (assetId) return assetId;
    // 否则从 clips 中找第一个视频片段
    const videoClip = clips.find(c => c.clipType === 'video' && c.assetId);
    if (videoClip?.assetId) return videoClip.assetId;
    // 最后从 assets 中找
    const videoAsset = assets.find(a => a.type === 'video');
    return videoAsset?.id || '';
  }, [assetId, clips, assets]);

  // 获取视频 URL（使用默认 assetId 作为 fallback）
  // ★ 优先使用 HLS，如果 HLS 不可用则回退到代理视频
  const getVideoUrl = useCallback((clipAssetId: string): string => {
    const effectiveAssetId = clipAssetId || defaultAssetId;
    if (!effectiveAssetId) {
      log('⚠️ 无法获取有效的 assetId');
      return '';
    }
    
    // 检查缓存的 HLS 可用性
    const isHlsAvailable = hlsAvailable.get(effectiveAssetId);
    if (isHlsAvailable === true) {
      return getHlsPlaylistUrl(effectiveAssetId);
    } else if (isHlsAvailable === false) {
      // HLS 不可用，使用代理视频
      return getAssetProxyUrl(effectiveAssetId);
    }
    
    // 还没检查过，默认使用代理视频（更可靠）
    return getAssetProxyUrl(effectiveAssetId);
  }, [defaultAssetId, hlsAvailable]);

  // ★ 组件加载时检查 HLS 可用性
  useEffect(() => {
    if (!isOpen || !defaultAssetId) return;
    
    const checkHls = async () => {
      try {
        const status = await checkHlsAvailable(defaultAssetId);
        log('🎬 HLS 可用性检查:', defaultAssetId, status.available);
        setHlsAvailable(prev => new Map(prev).set(defaultAssetId, status.available));
      } catch (error) {
        log('❌ HLS 检查失败:', error);
        setHlsAvailable(prev => new Map(prev).set(defaultAssetId, false));
      }
    };
    
    checkHls();
  }, [isOpen, defaultAssetId]);

  // ============================================================
  // 统一片段列表（核心：合并换气片段和分析片段，去重）
  // ============================================================
  const unifiedSegments = useMemo((): UnifiedSegment[] => {
    const segments: UnifiedSegment[] = [];
    
    // 构建重复组映射：segment_id -> { groupId, intent }
    const repeatGroupMap = new Map<string, { groupId: string; intent: string }>();
    for (const group of analysisResult?.repeat_groups || []) {
      for (const segId of group.segment_ids || []) {
        repeatGroupMap.set(segId, { groupId: group.id, intent: group.intent });
      }
    }
    
    // 1. 从分析结果中提取片段（如果有）
    const analysisSegments: UnifiedSegment[] = (analysisResult?.segments || []).map(seg => {
      const repeatInfo = repeatGroupMap.get(seg.id);
      return {
        id: `analysis-${seg.id}`,
        type: 'analysis' as const,
        sourceStart: seg.start * 1000,  // 秒转毫秒
        sourceEnd: seg.end * 1000,
        duration: (seg.end - seg.start) * 1000,
        text: seg.text,
        classification: seg.classification,
        defaultAction: seg.action === 'keep' || seg.is_recommended ? 'keep' : 'delete',
        qualityScore: seg.quality_score,
        isRecommended: seg.is_recommended,
        reason: seg.reason,
        analysisSegmentId: seg.id,
        assetId: seg.asset_id || defaultAssetId,  // 优先使用 segment 自己的 asset_id
        // 重复组信息
        repeatGroupId: repeatInfo?.groupId,
        repeatGroupIntent: repeatInfo?.intent,
      };
    });
    
    // 2. 从换气片段中提取（检查是否与分析片段重叠）
    const breathSegments: UnifiedSegment[] = [];
    for (const clip of silenceClips) {
      // 检查是否与某个分析片段时间重叠（重叠阈值：50%）
      const overlapsWithAnalysis = analysisSegments.some(seg => {
        const overlapStart = Math.max(clip.sourceStart, seg.sourceStart);
        const overlapEnd = Math.min(clip.sourceEnd, seg.sourceEnd);
        const overlapDuration = Math.max(0, overlapEnd - overlapStart);
        // 如果重叠超过换气片段时长的50%，视为重叠
        return overlapDuration > clip.duration * 0.5;
      });
      
      if (!overlapsWithAnalysis) {
        breathSegments.push({
          id: `breath-${clip.id}`,
          type: 'breath',
          sourceStart: clip.sourceStart,
          sourceEnd: clip.sourceEnd,
          duration: clip.duration,
          text: undefined,
          classification: 'breath',
          defaultAction: 'delete',  // 换气片段默认建议删除
          breathClipId: clip.id,
          assetId: clip.assetId || defaultAssetId,
        });
      } else {
        log(`换气片段 ${clip.id} 与分析片段重叠，已去重`);
      }
    }
    
    // 3. 合并并按时间排序
    segments.push(...analysisSegments, ...breathSegments);
    segments.sort((a, b) => a.sourceStart - b.sourceStart);
    
    // 详细日志：按分类统计
    const classificationStats: Record<string, number> = {};
    for (const seg of segments) {
      const cls = seg.classification || 'unknown';
      classificationStats[cls] = (classificationStats[cls] || 0) + 1;
    }
    log(`统一片段: ${segments.length} 个 (分析: ${analysisSegments.length}, 换气: ${breathSegments.length})`);
    log(`分类统计:`, classificationStats);
    
    return segments;
  }, [analysisResult, silenceClips, defaultAssetId]);

  // ============================================================
  // 初始化选择状态（当统一片段列表变化时）
  // ============================================================
  useEffect(() => {
    if (unifiedSegments.length === 0) return;
    
    // 只在首次加载时初始化，避免覆盖用户的选择
    setSelectedActions(prev => {
      if (prev.size > 0) return prev;
      
      const initial = new Map<string, 'keep' | 'delete'>();
      for (const seg of unifiedSegments) {
        initial.set(seg.id, seg.defaultAction);
      }
      return initial;
    });
  }, [unifiedSegments]);

  // ============================================================
  // 加载分析结果
  // ============================================================
  useEffect(() => {
    if (!isOpen) return;
    
    let cancelled = false;
    let pollTimeout: NodeJS.Timeout | null = null;
    
    const loadAnalysisResult = async (result: AnalysisResult) => {
      // 填充 repeat_groups 中的 segments 数据
      if (result.segments && result.repeat_groups) {
        const segmentMap = new Map(result.segments.map(s => [s.id, s]));
        result.repeat_groups.forEach(group => {
          if ((!group.segments || group.segments.length === 0) && group.segment_ids) {
            group.segments = group.segment_ids
              .map(id => segmentMap.get(id))
              .filter((s): s is AnalyzedSegment => !!s);
          }
        });
      }
      
      setAnalysisResult(result);
      
      // 详细日志：分析结果内容
      const segmentClassifications = result.segments?.map(s => s.classification) || [];
      const classificationCounts: Record<string, number> = {};
      for (const cls of segmentClassifications) {
        classificationCounts[cls] = (classificationCounts[cls] || 0) + 1;
      }
      log('分析结果 segments 分类统计:', classificationCounts);
      log('分析结果 segments 总数:', result.segments?.length || 0);
      
      // 初始化重复组选择
      const initialGroupSelections = new Map<string, string>();
      for (const group of result.repeat_groups || []) {
        if (group.recommended_id) {
          initialGroupSelections.set(group.id, group.recommended_id);
        }
      }
      setRepeatGroupSelections(initialGroupSelections);
      
      // ★ 同步更新 selectedActions，确保 repeat group 成员的初始状态正确
      // 当 repeat group 有 recommended_id 时，只有推荐的 segment 应为 keep，其余为 delete
      if (result.repeat_groups && result.repeat_groups.length > 0) {
        setSelectedActions(prev => {
          const next = new Map(prev);
          for (const group of result.repeat_groups!) {
            for (const seg of group.segments || []) {
              const segKey = `analysis-${seg.id}`;
              if (group.recommended_id) {
                // 有推荐选择时：推荐的保留，其他删除
                next.set(segKey, seg.id === group.recommended_id ? 'keep' : 'delete');
              } else {
                // 没有推荐时：全部保留（用户需要手动选择）
                next.set(segKey, 'keep');
              }
            }
          }
          log('同步 repeat group 初始选择:', Array.from(next.entries()).filter(([k]) => k.includes('analysis-seg_00')));
          return next;
        });
      }
      
      log('加载分析结果:', result);
      setIsLoadingAnalysis(false);
    };
    
    const pollAndLoad = async () => {
      setIsLoadingAnalysis(true);
      setAnalysisError(null);
      
      try {
        // ★ 如果有 analysisId，通过 analysisId 加载
        if (analysisId) {
          const progressResult = await getAnalysisProgress(analysisId);
          if (cancelled) return;
          
          log('分析进度:', progressResult);
          
          if (progressResult.stage === 'failed') {
            setAnalysisError(progressResult.message || '分析失败');
            setIsLoadingAnalysis(false);
            return;
          }
          
          if (progressResult.stage !== 'completed') {
            pollTimeout = setTimeout(pollAndLoad, 2000);
            return;
          }
          
          const result = await getAnalysisResult(analysisId);
          if (cancelled) return;
          
          await loadAnalysisResult(result);
        } 
        // ★ 如果没有 analysisId，尝试根据 projectId 获取最新分析
        else if (projectId) {
          log('尝试根据 projectId 获取最新分析:', projectId);
          const latestResult = await getLatestAnalysisByProject(projectId);
          if (cancelled) return;
          
          if (latestResult.has_analysis && latestResult.analysis) {
            log('找到项目的最新分析结果');
            await loadAnalysisResult(latestResult.analysis);
          } else {
            log('项目没有分析记录，仅显示换气片段');
            setIsLoadingAnalysis(false);
          }
        } else {
          setIsLoadingAnalysis(false);
        }
      } catch (e) {
        if (!cancelled) {
          log('加载分析结果失败:', e);
          // 加载失败时仍然显示换气片段，不报错
          setIsLoadingAnalysis(false);
        }
      }
    };
    
    pollAndLoad();
    
    return () => {
      cancelled = true;
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [isOpen, analysisId, projectId]);

  // ============================================================
  // 统计数据（基于统一片段列表）
  // ============================================================
  const stats = useMemo(() => {
    let keep = 0, del = 0, deleteDuration = 0;
    
    for (const seg of unifiedSegments) {
      const action = selectedActions.get(seg.id) || seg.defaultAction;
      if (action === 'keep') {
        keep++;
      } else {
        del++;
        deleteDuration += seg.duration;
      }
    }
    
    // 计算时长减少百分比
    const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);
    const reductionPercent = totalDuration > 0 ? (deleteDuration / totalDuration) * 100 : 0;
    
    // 分类统计
    const breathCount = unifiedSegments.filter(s => s.type === 'breath').length;
    const analysisCount = unifiedSegments.filter(s => s.type === 'analysis').length;
    
    return {
      keep,
      delete: del,
      total: unifiedSegments.length,
      deleteDuration,
      reductionPercent,
      breathCount,
      analysisCount,
    };
  }, [unifiedSegments, selectedActions, clips]);

  // ============================================================
  // 操作函数
  // ============================================================
  const toggleSegmentAction = useCallback((segmentId: string) => {
    setSelectedActions(prev => {
      const next = new Map(prev);
      const current = next.get(segmentId) || 'keep';
      next.set(segmentId, current === 'keep' ? 'delete' : 'keep');
      return next;
    });
  }, []);

  const selectInRepeatGroup = useCallback((groupId: string, segmentId: string) => {
    setRepeatGroupSelections(prev => {
      const next = new Map(prev);
      next.set(groupId, segmentId);
      return next;
    });
    
    const group = analysisResult?.repeat_groups?.find(g => g.id === groupId);
    if (group) {
      setSelectedActions(prev => {
        const next = new Map(prev);
        for (const seg of group.segments) {
          // 使用统一的 id 格式
          next.set(`analysis-${seg.id}`, seg.id === segmentId ? 'keep' : 'delete');
        }
        return next;
      });
    }
  }, [analysisResult]);

  // 跳过重复组（保留所有版本）
  const skipRepeatGroup = useCallback((groupId: string) => {
    const group = analysisResult?.repeat_groups?.find(g => g.id === groupId);
    if (group) {
      setSelectedActions(prev => {
        const next = new Map(prev);
        for (const seg of group.segments) {
          // 跳过时保留所有版本
          next.set(`analysis-${seg.id}`, 'keep');
        }
        return next;
      });
      // 标记为已处理但无选择
      setRepeatGroupSelections(prev => {
        const next = new Map(prev);
        next.set(groupId, '__skipped__');
        return next;
      });
    }
  }, [analysisResult]);

  // 编辑片段文本
  const handleEditText = useCallback((segmentId: string, text: string) => {
    setEditedTexts(prev => {
      const next = new Map(prev);
      next.set(segmentId, text);
      return next;
    });
  }, []);

  const acceptAllRecommendations = useCallback(() => {
    const newActions = new Map<string, 'keep' | 'delete'>();
    for (const seg of unifiedSegments) {
      newActions.set(seg.id, seg.defaultAction);
    }
    setSelectedActions(newActions);
    
    // 重置重复组选择
    const newGroupSelections = new Map<string, string>();
    for (const group of analysisResult?.repeat_groups || []) {
      if (group.recommended_id) {
        newGroupSelections.set(group.id, group.recommended_id);
      }
    }
    setRepeatGroupSelections(newGroupSelections);
  }, [unifiedSegments, analysisResult]);
  
  // 全选删除/全选保留
  const selectAllDelete = useCallback(() => {
    const newActions = new Map<string, 'keep' | 'delete'>();
    for (const seg of unifiedSegments) {
      newActions.set(seg.id, 'delete');
    }
    setSelectedActions(newActions);
  }, [unifiedSegments]);
  
  const selectAllKeep = useCallback(() => {
    const newActions = new Map<string, 'keep' | 'delete'>();
    for (const seg of unifiedSegments) {
      newActions.set(seg.id, 'keep');
    }
    setSelectedActions(newActions);
  }, [unifiedSegments]);

  // ============================================================
  // 确认并提交
  // ============================================================
  const handleFinalConfirm = async () => {
    setIsConfirming(true);
    
    try {
      // 1. 处理换气片段（前端直接删除）
      const breathToDelete: string[] = [];
      const breathToKeep: string[] = [];
      
      for (const seg of unifiedSegments) {
        if (seg.type === 'breath' && seg.breathClipId) {
          const action = selectedActions.get(seg.id) || seg.defaultAction;
          log(`换气片段 ${seg.id}: action=${action}, clipId=${seg.breathClipId}`);
          if (action === 'delete') {
            breathToDelete.push(seg.breathClipId);
          } else {
            breathToKeep.push(seg.breathClipId);
          }
        }
      }
      
      log('换气片段处理汇总:', {
        toDelete: breathToDelete.length,
        toKeep: breathToKeep.length,
        deleteIds: breathToDelete,
      });
      
      if (breathToDelete.length > 0) {
        log('删除换气片段:', breathToDelete.length);
        for (const clipId of breathToDelete) {
          log(`  - 删除 clip: ${clipId}`);
          removeClip(clipId);
        }
        mergeAdjacentClips(breathToKeep);
        compactVideoTrack();
      }
      
      // 2. 处理分析片段（提交到后端 API）
      if (analysisResult) {
        const selections: SegmentSelection[] = [];
        
        log('🔍 selectedActions Map 内容:', Array.from(selectedActions.entries()));
        log('🔍 unifiedSegments 详情:', unifiedSegments.map(s => ({
          id: s.id,
          type: s.type,
          classification: s.classification,
          analysisSegmentId: s.analysisSegmentId,
          defaultAction: s.defaultAction,
        })));
        
        for (const seg of unifiedSegments) {
          if (seg.type === 'analysis' && seg.analysisSegmentId) {
            const action = selectedActions.get(seg.id) || seg.defaultAction;
            log(`  📌 片段 ${seg.id}: selectedAction=${selectedActions.get(seg.id)}, defaultAction=${seg.defaultAction}, 最终action=${action}`);
            selections.push({ segment_id: seg.analysisSegmentId, action });
          }
        }
        
        log('分析片段提交汇总:', {
          total: selections.length,
          deleteCount: selections.filter(s => s.action === 'delete').length,
          keepCount: selections.filter(s => s.action === 'keep').length,
          selections: selections,
        });
        
        if (selections.length > 0) {
          // ★ 优先使用 analysisResult.id，如果没有才用 props 传入的 analysisId
          const effectiveAnalysisId = analysisResult.id || analysisId;
          
          if (!effectiveAnalysisId) {
            throw new Error('缺少分析 ID，无法确认选择');
          }
          
          const result = await confirmSelectionApi({
            analysis_id: effectiveAnalysisId,
            selections,
            apply_zoom_recommendations: true
          });
          
          // ★ 获取项目详情，检查生成的关键帧
          try {
            const projectResponse = await projectApi.getProject(projectId);
            if (projectResponse.data) {
              const project = projectResponse.data;
              const timeline = project.timeline as {
                tracks?: Array<{ clips?: unknown[] }>;
                keyframes?: Array<{
                  id: string;
                  clipId: string;
                  property: string;
                  offset: number;
                  value: unknown;
                }>;
              };
              
              // 统计 clips 数量
              let totalClips = 0;
              timeline?.tracks?.forEach(track => {
                totalClips += track.clips?.length || 0;
              });
              
              // 统计 keyframes
              const keyframes = timeline?.keyframes || [];
              const keyframesByClip: Record<string, number> = {};
              const keyframesByProperty: Record<string, number> = {};
              
              keyframes.forEach(kf => {
                keyframesByClip[kf.clipId] = (keyframesByClip[kf.clipId] || 0) + 1;
                keyframesByProperty[kf.property] = (keyframesByProperty[kf.property] || 0) + 1;
              });
              
              // 项目状态检查（调试用，生产环境静默）
            }
          } catch (projectErr) {
            // 获取项目详情失败（不影响流程）
          }
        }
      }
      
      log('✅ 确认成功，准备调用 onConfirm() 刷新编辑器');
      onConfirm();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : '确认失败';
      console.error('❌ 确认选择失败:', errorMessage, e);
      setAnalysisError(errorMessage);
      toast.error(`确认选择失败: ${errorMessage}`);
    } finally {
      setIsConfirming(false);
    }
  };

  // ============================================================
  // 渲染
  // ============================================================
  if (!isOpen) return null;

  const hasRepeatGroups = analysisResult?.repeat_groups && analysisResult.repeat_groups.length > 0;
  const isReviewStep = currentStep === 1;
  const isRepeatStep = hasRepeatGroups && currentStep === 2;
  const isConfirmStep = hasRepeatGroups ? currentStep === 3 : currentStep === 2;

  // 使用 Portal 渲染到 body，确保弹窗在最上层
  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-white/60 backdrop-blur-sm" onClick={onClose} />
      
      {/* 弹窗内容 */}
      <div className="relative w-full max-w-5xl max-h-[90vh] bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 fade-in duration-300">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-xl">
              <Sparkles size={20} className="text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">智能清理向导</h2>
              <p className="text-xs text-gray-500">
                {stats.total} 个待处理片段
                {stats.breathCount > 0 && stats.analysisCount > 0 && (
                  <span className="ml-1 text-gray-400">
                    (换气 {stats.breathCount} + 废片 {stats.analysisCount})
                  </span>
                )}
              </p>
            </div>
          </div>
          
          {/* 统计 */}
          <div className="flex items-center gap-4 text-sm">
            <span className="text-emerald-600">
              <CheckCircle2 size={14} className="inline mr-1" />
              保留 {stats.keep}
            </span>
            <span className="text-red-400">
              <Trash2 size={14} className="inline mr-1" />
              删除 {stats.delete}
            </span>
            <span className="text-gray-500">
              约 {(stats.deleteDuration / 1000).toFixed(1)}s
            </span>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-900 transition-colors rounded-lg hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* 步骤指示器 */}
        <StepIndicator currentStep={currentStep} steps={steps} />
        
        {/* 内容区域 */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Step 1: 统一片段审核 */}
          {isReviewStep && (
            <UnifiedReviewStep
              segments={unifiedSegments}
              selectedActions={selectedActions}
              repeatGroupSelections={repeatGroupSelections}
              analysisResult={analysisResult}
              activePreviewSegment={activePreviewSegment}
              isLoading={isLoadingAnalysis}
              error={analysisError}
              stats={stats}
              onToggleAction={toggleSegmentAction}
              onSelectInRepeatGroup={selectInRepeatGroup}
              onPreview={setActivePreviewSegment}
              onAcceptAll={acceptAllRecommendations}
              onSelectAllDelete={selectAllDelete}
              onSelectAllKeep={selectAllKeep}
              assetId={defaultAssetId}
              getVideoUrl={getVideoUrl}
            />
          )}
          
          {/* Step 2: 重复选择（如果有） */}
          {isRepeatStep && (
            <RepeatGroupStep
              analysisResult={analysisResult}
              repeatGroupSelections={repeatGroupSelections}
              activePreviewSegment={activePreviewSegment}
              editedTexts={editedTexts}
              editingSegmentId={editingSegmentId}
              onSelectInGroup={selectInRepeatGroup}
              onSkipGroup={skipRepeatGroup}
              onPreview={(seg) => {
                if (seg) {
                  setActivePreviewSegment({
                    id: `analysis-${seg.id}`,
                    type: 'analysis',
                    sourceStart: seg.start * 1000,
                    sourceEnd: seg.end * 1000,
                    duration: (seg.end - seg.start) * 1000,
                    text: seg.text,
                    classification: seg.classification,
                    defaultAction: seg.is_recommended ? 'keep' : 'delete',
                    analysisSegmentId: seg.id,
                    assetId: defaultAssetId,
                  });
                } else {
                  setActivePreviewSegment(null);
                }
              }}
              onAcceptAll={acceptAllRecommendations}
              onEditText={handleEditText}
              onStartEdit={setEditingSegmentId}
              assetId={defaultAssetId}
              getVideoUrl={getVideoUrl}
            />
          )}
          
          {/* 确认步骤 */}
          {isConfirmStep && (
            <ConfirmStep
              stats={stats}
              assetId={defaultAssetId}
              getVideoUrl={getVideoUrl}
            />
          )}
        </div>
        
        {/* 底部操作栏 */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← 上一步
          </button>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              取消
            </button>
            
            {currentStep < steps.length ? (
              <button
                onClick={() => setCurrentStep(currentStep + 1)}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white bg-gray-700 rounded-xl hover:bg-gray-1000 transition-colors"
              >
                下一步 →
              </button>
            ) : (
              <button
                onClick={handleFinalConfirm}
                disabled={isConfirming}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-500 transition-colors disabled:opacity-50"
              >
                {isConfirming ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    处理中...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    确认清理
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // 在客户端渲染时使用 Portal
  if (typeof window === 'undefined') return null;
  return createPortal(modalContent, document.body);
}

// ============================================================
// 分类标签配置
// ============================================================
interface ClassificationConfig {
  label: string;
  color: string;
  icon: typeof Wind;
  category: 'cleanup' | 'content';
  reason: string;  // 删除/保留原因
  description: string;  // 详细描述
}

const CLASSIFICATION_LABELS: Record<string, ClassificationConfig> = {
  // 待清理类型（默认建议删除）
  breath: { 
    label: '换气', 
    color: 'emerald', 
    icon: Wind, 
    category: 'cleanup',
    reason: '无意义换气声',
    description: '检测到呼吸或换气声，通常不影响内容理解'
  },
  filler: { 
    label: '填充词', 
    color: 'orange', 
    icon: Volume2, 
    category: 'cleanup',
    reason: '无实际意义',
    description: '如"嗯"、"啊"、"那个"等口癖或语气词'
  },
  noise: { 
    label: '噪音', 
    color: 'red', 
    icon: AlertTriangle, 
    category: 'cleanup',
    reason: '影响观看体验',
    description: '背景噪音、杂音等干扰片段'
  },
  repeat: { 
    label: '重复', 
    color: 'gray', 
    icon: RefreshCw, 
    category: 'cleanup',
    reason: '内容重复',
    description: '与其他片段内容重复，可删除保持精简'
  },
  dead_air: { 
    label: '静默', 
    color: 'gray', 
    icon: Volume2, 
    category: 'cleanup',
    reason: '无声静默',
    description: '无声音的静默片段'
  },
  hesitation: { 
    label: '犹豫', 
    color: 'yellow', 
    icon: AlertTriangle, 
    category: 'cleanup',
    reason: '犹豫停顿',
    description: '说话时的犹豫或停顿'
  },
  long_pause: { 
    label: '长停顿', 
    color: 'gray', 
    icon: Volume2, 
    category: 'cleanup',
    reason: '过长停顿',
    description: '时间较长的停顿'
  },
  uncertain: { 
    label: '待确认', 
    color: 'yellow', 
    icon: AlertTriangle, 
    category: 'content',
    reason: '需人工确认',
    description: 'AI 无法确定的片段，需人工判断'
  },
  // 内容类型（默认保留）
  matched: { 
    label: '匹配', 
    color: 'blue', 
    icon: CheckCircle2, 
    category: 'content',
    reason: '与脚本匹配',
    description: '口播内容与脚本高度匹配'
  },
  deviation: { 
    label: '偏离', 
    color: 'yellow', 
    icon: AlertTriangle, 
    category: 'content',
    reason: '偏离脚本',
    description: '口播内容与脚本有所偏离，但可能有价值'
  },
  improvisation: { 
    label: '即兴', 
    color: 'cyan', 
    icon: Sparkles, 
    category: 'content',
    reason: '即兴发挥',
    description: '非脚本内容，但包含有价值的即兴表达'
  },
  valuable: { 
    label: '有价值', 
    color: 'green', 
    icon: Star, 
    category: 'content',
    reason: '重要内容',
    description: '包含重要信息或精彩表达'
  },
};

// 分类分组配置
const CATEGORY_GROUPS = [
  { 
    id: 'cleanup', 
    label: '待清理', 
    description: '建议删除',
    icon: Trash2,
    color: 'red',
    types: ['breath', 'filler', 'noise', 'repeat', 'dead_air', 'hesitation', 'long_pause'] 
  },
  { 
    id: 'content', 
    label: '有效内容', 
    description: '建议保留',
    icon: CheckCircle2,
    color: 'emerald',
    types: ['matched', 'deviation', 'improvisation', 'valuable', 'uncertain'] 
  },
];

// 筛选选项
type FilterType = 'all' | 'cleanup' | 'content';

// ============================================================
// Step 1: 统一片段审核
// ============================================================
interface UnifiedReviewStepProps {
  segments: UnifiedSegment[];
  selectedActions: Map<string, 'keep' | 'delete'>;
  repeatGroupSelections: Map<string, string>;  // 用于判断重复组选择状态
  analysisResult: AnalysisResult | null;  // 用于获取重复组完整信息
  activePreviewSegment: UnifiedSegment | null;
  isLoading: boolean;
  error: string | null;
  stats: { keep: number; delete: number; total: number; breathCount: number; analysisCount: number };
  onToggleAction: (id: string) => void;
  onSelectInRepeatGroup: (groupId: string, segmentId: string) => void;  // 重复组内选择
  onPreview: (segment: UnifiedSegment | null) => void;
  onAcceptAll: () => void;
  onSelectAllDelete: () => void;
  onSelectAllKeep: () => void;
  assetId: string;
  getVideoUrl: (assetId: string) => string;
}

function UnifiedReviewStep({
  segments,
  selectedActions,
  repeatGroupSelections,
  analysisResult,
  activePreviewSegment,
  isLoading,
  error,
  stats,
  onToggleAction,
  onSelectInRepeatGroup,
  onPreview,
  onAcceptAll,
  onSelectAllDelete,
  onSelectAllKeep,
  assetId,
  getVideoUrl,
}: UnifiedReviewStepProps) {
  // 入口日志
  log('🚀 UnifiedReviewStep 渲染, segments 数量:', segments.length);
  
  // 筛选状态
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  // 分组折叠状态
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // 分离：重复组片段 vs 普通片段
  const { repeatGroupSegments, normalSegments, repeatGroups } = useMemo(() => {
    // 收集所有重复组的 segment ids
    const repeatSegmentIds = new Set<string>();
    const groups = analysisResult?.repeat_groups || [];
    
    for (const group of groups) {
      for (const segId of group.segment_ids || []) {
        repeatSegmentIds.add(`analysis-${segId}`);
      }
    }
    
    log('🔄 分离片段:', {
      totalSegments: segments.length,
      repeatGroups: groups.length,
      repeatSegmentIds: Array.from(repeatSegmentIds),
    });
    
    // 分离片段
    const repeatSegs: UnifiedSegment[] = [];
    const normalSegs: UnifiedSegment[] = [];
    
    for (const seg of segments) {
      if (repeatSegmentIds.has(seg.id)) {
        repeatSegs.push(seg);
      } else {
        normalSegs.push(seg);
      }
    }
    
    log('🔄 分离结果:', {
      repeatSegs: repeatSegs.length,
      normalSegs: normalSegs.length,
      normalClassifications: normalSegs.map(s => s.classification),
    });
    
    return {
      repeatGroupSegments: repeatSegs,
      normalSegments: normalSegs,
      repeatGroups: groups,
    };
  }, [segments, analysisResult]);

  // 普通片段按分类分组（不包含重复组片段）
  const groupedSegments = useMemo(() => {
    const groups: Record<string, UnifiedSegment[]> = {};
    
    // 初始化所有分类
    for (const [key] of Object.entries(CLASSIFICATION_LABELS)) {
      groups[key] = [];
    }
    
    // 只分配普通片段
    for (const seg of normalSegments) {
      const cls = seg.classification || 'matched';
      if (!groups[cls]) {
        groups[cls] = [];
      }
      groups[cls].push(seg);
    }
    
    return groups;
  }, [normalSegments]);

  // 按大类统计（普通片段 + 重复组）
  const categoryStats = useMemo(() => {
    // 注意：repeat 在这里不计入，因为重复组片段在 repeatGroupSegments 中单独处理
    // 这里只统计普通片段的分类
    const cleanupTypes = ['breath', 'filler', 'noise', 'repeat', 'dead_air', 'hesitation', 'long_pause'];
    const contentTypes = ['matched', 'deviation', 'improvisation', 'valuable', 'uncertain'];
    
    let cleanupCount = 0;
    let contentCount = 0;
    
    // 统计普通片段（包括非重复组的 repeat 类型片段）
    for (const seg of normalSegments) {
      const cls = seg.classification || 'matched';
      if (cleanupTypes.includes(cls)) {
        cleanupCount++;
      } else if (contentTypes.includes(cls)) {
        contentCount++;
      }
    }
    
    // 重复组：被选中的算内容，未选中的算清理
    for (const seg of repeatGroupSegments) {
      const selectedId = repeatGroupSelections.get(seg.repeatGroupId || '');
      if (selectedId === seg.analysisSegmentId) {
        contentCount++;
      } else {
        cleanupCount++;
      }
    }
    
    log('📊 categoryStats 计算:', {
      normalSegments: normalSegments.length,
      repeatGroupSegments: repeatGroupSegments.length,
      normalClassifications: normalSegments.map(s => s.classification),
      cleanupCount,
      contentCount,
    });
    
    return { 
      cleanup: cleanupCount, 
      content: contentCount,
      repeatGroups: repeatGroups.length,
    };
  }, [normalSegments, repeatGroupSegments, repeatGroupSelections, repeatGroups]);

  // 过滤后的分组（不含重复组，重复组单独展示）
  const filteredGroups = useMemo(() => {
    // 只有当 repeat_groups 不为空时，才从普通分组中移除 'repeat' 类型
    // 否则 repeat 类型的片段会无处可显示
    const hasRealRepeatGroups = repeatGroups.length > 0;
    
    const modifiedCategoryGroups = CATEGORY_GROUPS.map(group => ({
      ...group,
      types: hasRealRepeatGroups 
        ? group.types.filter(t => t !== 'repeat')  // 有重复组时，repeat 单独展示
        : group.types  // 没有重复组时，repeat 作为普通分类展示
    }));
    
    const result = modifiedCategoryGroups.filter(group => {
      if (activeFilter === 'all') return true;
      return group.id === activeFilter;
    }).map(group => ({
      ...group,
      segments: group.types.flatMap(type => groupedSegments[type] || [])
    })).filter(group => group.segments.length > 0);
    
    log('📊 filteredGroups:', {
      activeFilter,
      hasRealRepeatGroups,
      groupCount: result.length,
      groups: result.map(g => ({ id: g.id, types: g.types, segmentCount: g.segments.length }))
    });
    
    return result;
  }, [groupedSegments, activeFilter, repeatGroups]);

  // 切换分组折叠状态
  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // 转换为 PreviewSegment 格式
  const previewSegment: PreviewSegment | null = activePreviewSegment ? {
    id: activePreviewSegment.id,
    text: activePreviewSegment.text,
    sourceStart: activePreviewSegment.sourceStart,
    sourceEnd: activePreviewSegment.sourceEnd,
    classification: activePreviewSegment.classification,
    label: activePreviewSegment.text?.slice(0, 20) || (activePreviewSegment.classification === 'breath' ? '换气' : ''),
  } : null;

  const videoUrl = activePreviewSegment ? getVideoUrl(activePreviewSegment.assetId || assetId) : '';

  // Early returns - 必须在所有 hooks 之后
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto mb-4" />
          <p className="text-gray-600">正在加载分析结果...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={48} className="mx-auto mb-4 text-red-400" />
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* 左侧列表 */}
      <div className="w-1/2 p-4 border-r border-gray-200 flex flex-col">
        {/* 筛选 Tab */}
        <div className="flex items-center gap-1 mb-3 p-1 bg-gray-100 rounded-lg">
          <button
            onClick={() => setActiveFilter('all')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeFilter === 'all' 
                ? 'bg-white text-gray-900 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            全部 ({segments.length})
          </button>
          <button
            onClick={() => setActiveFilter('cleanup')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeFilter === 'cleanup' 
                ? 'bg-white text-red-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            待清理 ({categoryStats.cleanup})
          </button>
          <button
            onClick={() => setActiveFilter('content')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeFilter === 'content' 
                ? 'bg-white text-emerald-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            有效内容 ({categoryStats.content})
          </button>
        </div>

        {/* 快捷操作 */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button
            onClick={onAcceptAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-600 bg-emerald-100 rounded-lg hover:bg-emerald-200 transition-colors"
          >
            <Star size={14} />
            接受推荐
          </button>
          <button
            onClick={onSelectAllDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
          >
            <Trash2 size={14} />
            全部删除
          </button>
          <button
            onClick={onSelectAllKeep}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <CheckCircle2 size={14} />
            全部保留
          </button>
        </div>
        
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
          <Scissors size={16} className="text-gray-600" />
          <span>片段审核</span>
          <span className="text-gray-500 font-normal text-xs">
            保留 {stats.keep} · 删除 {stats.delete}
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-3">
          {segments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Scissors size={32} className="mb-2 opacity-50" />
              <p className="text-sm">没有待处理的片段</p>
            </div>
          ) : (
            <>
              {/* ========== 重复组区块：所有版本放在一起对比 ========== */}
              {repeatGroups.length > 0 && (activeFilter === 'all' || activeFilter === 'content') && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <Zap size={14} />
                      <span>重复片段选择</span>
                      <span className="text-xs opacity-70">({repeatGroups.length}组)</span>
                      <span className="text-xs opacity-50">· 同一句话多个版本，选择最佳</span>
                    </div>
                  </div>
                  
                  <div className="p-2 space-y-3 bg-white">
                    {repeatGroups.map((group) => {
                      const selectedSegId = repeatGroupSelections.get(group.id);
                      const groupSegments = segments.filter(s => s.repeatGroupId === group.id);
                      
                      return (
                        <div key={group.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                          {/* 重复组标题 */}
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                📝 {group.intent}
                              </p>
                              <p className="text-xs text-gray-500">
                                {group.segments?.length || groupSegments.length} 个版本 · 选择一个保留，其他删除
                              </p>
                            </div>
                            {group.recommend_reason && (
                              <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                                推荐理由: {group.recommend_reason}
                              </span>
                            )}
                          </div>
                          
                          {/* 所有版本列表 */}
                          <div className="space-y-2">
                            {(group.segments || []).map((seg, idx) => {
                              const isSelected = selectedSegId === seg.id;
                              const isRecommended = group.recommended_id === seg.id;
                              const unifiedSeg = segments.find(s => s.analysisSegmentId === seg.id);
                              const isPreviewing = activePreviewSegment?.analysisSegmentId === seg.id;
                              
                              return (
                                <div
                                  key={seg.id}
                                  onClick={() => onSelectInRepeatGroup(group.id, seg.id)}
                                  className={`p-2.5 rounded-lg cursor-pointer transition-all border-2 ${
                                    isSelected 
                                      ? 'bg-emerald-50 border-emerald-400' 
                                      : 'bg-white border-gray-200 hover:border-gray-400'
                                  }`}
                                >
                                  <div className="flex items-start gap-2">
                                    {/* 选择指示器 */}
                                    <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                      isSelected 
                                        ? 'bg-emerald-500 border-emerald-500' 
                                        : 'border-gray-300'
                                    }`}>
                                      {isSelected && <CheckCircle2 size={12} className="text-white" />}
                                    </div>
                                    
                                    <div className="flex-1 min-w-0">
                                      {/* 版本标签 */}
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs text-gray-500">版本 {idx + 1}</span>
                                        {isRecommended && (
                                          <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-[10px]">
                                            ☆ AI推荐
                                          </span>
                                        )}
                                        {isSelected ? (
                                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px]">
                                            ✓ 保留
                                          </span>
                                        ) : (
                                          <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[10px]">
                                            ✗ 删除
                                          </span>
                                        )}
                                        {seg.quality_score && (
                                          <span className="text-xs text-gray-400">
                                            质量: {Math.round(seg.quality_score * 100)}%
                                          </span>
                                        )}
                                      </div>
                                      
                                      {/* 文字内容 */}
                                      <p className={`text-sm mb-1 ${isSelected ? 'text-gray-900' : 'text-gray-600'}`}>
                                        "{seg.text || '（无文字）'}"
                                      </p>
                                      
                                      {/* 时间和口癖词 */}
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-400">
                                          {formatTime(seg.start * 1000)} - {formatTime(seg.end * 1000)}
                                          <span className="ml-1">({((seg.end - seg.start)).toFixed(2)}s)</span>
                                        </span>
                                        
                                        <button
                                          onClick={(e) => { 
                                            e.stopPropagation(); 
                                            if (unifiedSeg) {
                                              onPreview(isPreviewing ? null : unifiedSeg);
                                            }
                                          }}
                                          className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                                            isPreviewing ? 'bg-gray-1000 text-white' : 'text-gray-600 hover:bg-gray-100'
                                          }`}
                                        >
                                          {isPreviewing ? '预览中' : '预览'}
                                        </button>
                                      </div>
                                      
                                      {/* 口癖词警告 */}
                                      {seg.filler_words && seg.filler_words.length > 0 && (
                                        <p className="text-[10px] text-orange-500 mt-1">
                                          ⚠️ 存在口癖词: {seg.filler_words.join(', ')}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* ========== 普通片段分类 ========== */}
              {filteredGroups.length === 0 && repeatGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                  <p className="text-sm">当前筛选无结果</p>
                </div>
              ) : (
                filteredGroups.map((group) => {
                  const GroupIcon = group.icon;
                  const isCollapsed = collapsedGroups.has(group.id);
                  
                  return (
                    <div key={group.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      {/* 分组标题 */}
                      <button
                        onClick={() => toggleGroupCollapse(group.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium transition-colors ${
                          group.id === 'cleanup' 
                            ? 'bg-red-50 text-red-700 hover:bg-red-100' 
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <GroupIcon size={14} />
                          <span>{group.label}</span>
                          <span className="text-xs opacity-70">({group.segments.length})</span>
                          <span className="text-xs opacity-50">· {group.description}</span>
                        </div>
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      
                      {/* 分组内容 */}
                      {!isCollapsed && (
                        <div className="p-2 space-y-2 bg-white">
                          {/* 按具体分类再细分 */}
                          {group.types.map(classType => {
                            const segsOfType = groupedSegments[classType] || [];
                            if (segsOfType.length === 0) return null;
                            
                            const classConfig = CLASSIFICATION_LABELS[classType];
                            if (!classConfig) return null;
                        
                        return (
                          <div key={classType} className="space-y-1.5">
                            {/* 子分类标题 */}
                            <div className="flex items-center gap-1.5 px-2 py-1">
                              <span className={`w-2 h-2 rounded-full bg-${classConfig.color}-400`} />
                              <span className="text-xs font-medium text-gray-600">{classConfig.label}</span>
                              <span className="text-xs text-gray-400">({segsOfType.length})</span>
                            </div>
                            
                            {/* 片段列表（普通片段，不含重复组）*/}
                            {segsOfType.map((seg) => {
                              const action = selectedActions.get(seg.id) || seg.defaultAction;
                              const isKeep = action === 'keep';
                              const isPreviewing = activePreviewSegment?.id === seg.id;
                              const segConfig = CLASSIFICATION_LABELS[seg.classification] || CLASSIFICATION_LABELS['matched'];
                              const SegIcon = segConfig?.icon || CheckCircle2;
                              
                              return (
                                <div
                                  key={seg.id}
                                  className={`p-2.5 rounded-lg cursor-pointer transition-all ml-3 ${
                                    isPreviewing
                                      ? 'bg-gray-200 border border-gray-400'
                                      : isKeep 
                                        ? 'bg-emerald-50 border border-emerald-200' 
                                        : 'bg-red-50 border border-red-200'
                                  }`}
                                  onClick={() => onToggleAction(seg.id)}
                                >
                                  {/* 分类标签行 */}
                                  <div className="flex items-center gap-2 mb-1.5">
                                    {/* 分类徽章 */}
                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
                                      ${segConfig?.category === 'cleanup' 
                                        ? 'bg-orange-100 text-orange-700' 
                                        : 'bg-gray-200 text-gray-700'
                                      }`}
                                    >
                                      <SegIcon size={10} />
                                      {segConfig?.label}
                                    </span>
                                    {/* 原因说明 */}
                                    <span className="text-[10px] text-gray-500">
                                      {segConfig?.reason}
                                    </span>
                                    {seg.isRecommended && (
                                      <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-[10px]">
                                        ☆ 推荐
                                      </span>
                                    )}
                                  </div>
                                  
                                  {seg.text ? (
                                    <p className="text-sm text-gray-900 truncate">"{seg.text}"</p>
                                  ) : (
                                    <p className="text-sm text-gray-500 italic">（无文字内容）</p>
                                  )}
                                  
                                  <div className="flex items-center justify-between mt-1">
                                    <span className="text-xs text-gray-500">
                                      {formatTime(seg.sourceStart)} - {formatTime(seg.sourceEnd)}
                                      <span className="ml-1 text-gray-400">({(seg.duration / 1000).toFixed(2)}s)</span>
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-xs ${isKeep ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {isKeep ? '✓ 保留' : '✗ 删除'}
                                      </span>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); onPreview(isPreviewing ? null : seg); }}
                                        className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                                          isPreviewing ? 'bg-gray-1000 text-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                                        }`}
                                      >
                                        {isPreviewing ? '预览中' : '预览'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
              )}
            </>
          )}
        </div>
      </div>
      
      {/* 右侧视频预览 */}
      <div className="w-1/2 flex flex-col p-4">
        <VideoPreviewPanel
          videoUrl={videoUrl}
          segment={previewSegment}
          assetId={assetId}
          segmentColor="blue"
          icon={<Scissors size={14} />}
          emptyTitle="点击左侧预览按钮"
          emptyDesc="查看片段的前后2秒上下文"
        />
      </div>
    </div>
  );
}

// ============================================================
// Step 2: 重复选择（如果有重复组）
// - 每个重复组单独展示，对比多个版本
// - 支持选择版本、跳过、修改文本
// ============================================================
interface RepeatGroupStepProps {
  analysisResult: AnalysisResult | null;
  repeatGroupSelections: Map<string, string>;
  activePreviewSegment: UnifiedSegment | null;
  editedTexts: Map<string, string>;
  editingSegmentId: string | null;
  onSelectInGroup: (groupId: string, segmentId: string) => void;
  onSkipGroup: (groupId: string) => void;
  onPreview: (segment: AnalyzedSegment | null) => void;
  onAcceptAll: () => void;
  onEditText: (segmentId: string, text: string) => void;
  onStartEdit: (segmentId: string | null) => void;
  assetId: string;
  getVideoUrl: (assetId: string) => string;
}

function RepeatGroupStep({
  analysisResult,
  repeatGroupSelections,
  activePreviewSegment,
  editedTexts,
  editingSegmentId,
  onSelectInGroup,
  onSkipGroup,
  onPreview,
  onAcceptAll,
  onEditText,
  onStartEdit,
  assetId,
  getVideoUrl,
}: RepeatGroupStepProps) {
  // 当前聚焦的重复组（默认第一个未选择的）
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  
  const groups = analysisResult?.repeat_groups || [];
  const currentGroup = groups[currentGroupIndex];
  
  // 进度统计
  const completedCount = groups.filter(g => repeatGroupSelections.has(g.id)).length;
  const progressPercent = groups.length > 0 ? (completedCount / groups.length) * 100 : 0;

  // 转换为 PreviewSegment 格式
  const previewSegment: PreviewSegment | null = activePreviewSegment ? {
    id: activePreviewSegment.id,
    text: activePreviewSegment.text,
    sourceStart: activePreviewSegment.sourceStart,
    sourceEnd: activePreviewSegment.sourceEnd,
    classification: activePreviewSegment.classification,
    label: activePreviewSegment.text?.slice(0, 20),
  } : null;

  const videoUrl = activePreviewSegment ? getVideoUrl(assetId) : '';

  // 处理选择后自动跳转到下一个
  const handleSelect = (groupId: string, segmentId: string) => {
    onSelectInGroup(groupId, segmentId);
    // 选择后自动跳转到下一个未选择的组
    const nextUnselectedIndex = groups.findIndex((g, idx) => 
      idx > currentGroupIndex && !repeatGroupSelections.has(g.id)
    );
    if (nextUnselectedIndex >= 0) {
      setCurrentGroupIndex(nextUnselectedIndex);
    } else if (currentGroupIndex < groups.length - 1) {
      setCurrentGroupIndex(currentGroupIndex + 1);
    }
  };

  // 跳过当前组
  const handleSkip = (groupId: string) => {
    onSkipGroup(groupId);
    if (currentGroupIndex < groups.length - 1) {
      setCurrentGroupIndex(currentGroupIndex + 1);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>没有需要处理的重复片段</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* 左侧：重复组对比 */}
      <div className="w-1/2 p-4 border-r border-gray-200 flex flex-col">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">
              重复组 {currentGroupIndex + 1} / {groups.length}
            </span>
            <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gray-600 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          <button
            onClick={onAcceptAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-600 bg-emerald-100 rounded-lg hover:bg-emerald-200 transition-colors"
          >
            <Star size={14} />
            接受所有推荐
          </button>
        </div>

        {/* 组导航 */}
        <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
          {groups.map((group, idx) => {
            const isSelected = repeatGroupSelections.has(group.id);
            const isCurrent = idx === currentGroupIndex;
            return (
              <button
                key={group.id}
                onClick={() => setCurrentGroupIndex(idx)}
                className={`flex-shrink-0 w-7 h-7 rounded-full text-xs font-medium transition-all ${
                  isCurrent
                    ? 'bg-gray-800 text-white ring-2 ring-gray-400'
                    : isSelected
                      ? 'bg-emerald-100 text-emerald-600 border border-emerald-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {isSelected ? '✓' : idx + 1}
              </button>
            );
          })}
        </div>

        {/* 当前组详情 */}
        {currentGroup && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 组标题 */}
            <div className="p-3 bg-gray-50 rounded-t-xl border border-gray-200 border-b-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Zap size={16} />
                <span>表达意图</span>
              </div>
              <p className="text-sm text-gray-900 mt-1">"{currentGroup.intent}"</p>
              <p className="text-xs text-gray-500 mt-1">
                {currentGroup.segments?.length || 0} 个版本可选 · 
                {repeatGroupSelections.has(currentGroup.id) 
                  ? <span className="text-emerald-600"> 已选择</span>
                  : <span className="text-orange-500"> 待选择</span>
                }
              </p>
            </div>

            {/* 版本列表 - 对比卡片 */}
            <div className="flex-1 overflow-y-auto p-3 bg-white border border-gray-200 rounded-b-xl space-y-3">
              {currentGroup.segments?.map((seg, idx) => {
                const isSelected = repeatGroupSelections.get(currentGroup.id) === seg.id;
                const isPreviewing = activePreviewSegment?.analysisSegmentId === seg.id;
                const isEditing = editingSegmentId === seg.id;
                const displayText = editedTexts.get(seg.id) || seg.text;
                
                return (
                  <div
                    key={seg.id}
                    className={`p-4 rounded-xl transition-all border-2 ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-400 shadow-md'
                        : isPreviewing
                          ? 'bg-gray-100 border-gray-400'
                          : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {/* 版本标题行 */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          isSelected ? 'bg-emerald-500 text-white' : 'bg-gray-300 text-gray-600'
                        }`}>
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-gray-700">版本 {idx + 1}</span>
                        {seg.is_recommended && (
                          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-[10px] font-medium">
                            ⭐ AI 推荐
                          </span>
                        )}
                        {isSelected && (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-medium">
                            ✓ 已选择
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{(seg.end - seg.start).toFixed(1)}s</span>
                        <span className={`font-medium ${
                          seg.quality_score >= 0.8 ? 'text-emerald-600' :
                          seg.quality_score >= 0.6 ? 'text-yellow-600' : 'text-red-500'
                        }`}>
                          质量 {(seg.quality_score * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>

                    {/* 文本内容（可编辑） */}
                    {isEditing ? (
                      <div className="mb-3">
                        <textarea
                          autoFocus
                          className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
                          rows={3}
                          defaultValue={displayText}
                          onBlur={(e) => {
                            onEditText(seg.id, e.target.value);
                            onStartEdit(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              onEditText(seg.id, e.currentTarget.value);
                              onStartEdit(null);
                            }
                            if (e.key === 'Escape') {
                              onStartEdit(null);
                            }
                          }}
                        />
                        <p className="text-xs text-gray-400 mt-1">Enter 保存 · Esc 取消</p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-900 mb-3 leading-relaxed">
                        "{displayText}"
                        {editedTexts.has(seg.id) && (
                          <span className="ml-1 text-xs text-gray-500">(已编辑)</span>
                        )}
                      </p>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSelect(currentGroup.id, seg.id)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isSelected
                            ? 'bg-emerald-500 text-white'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        }`}
                      >
                        <Check size={14} />
                        {isSelected ? '已选择此版本' : '选择此版本'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onPreview(isPreviewing ? null : seg); }}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isPreviewing
                            ? 'bg-gray-1000 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        <Play size={14} />
                      </button>
                      <button
                        onClick={() => onStartEdit(isEditing ? null : seg.id)}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                        title="修改文本"
                      >
                        <Edit3 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 跳过按钮 */}
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => handleSkip(currentGroup.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <SkipForward size={14} />
                跳过此组（保留所有版本）
              </button>
              {currentGroupIndex < groups.length - 1 && (
                <button
                  onClick={() => setCurrentGroupIndex(currentGroupIndex + 1)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  下一组 →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* 右侧视频预览 */}
      <div className="w-1/2 flex flex-col p-4">
        <VideoPreviewPanel
          videoUrl={videoUrl}
          segment={previewSegment}
          assetId={assetId}
          segmentColor="gray"
          icon={<Zap size={14} />}
          emptyTitle="点击预览按钮"
          emptyDesc="对比不同版本的表达效果"
        />
        
        {/* 选择结果摘要 */}
        {completedCount > 0 && (
          <div className="mt-4 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
            <p className="text-sm font-medium text-emerald-700">
              已完成 {completedCount} / {groups.length} 个重复组选择
            </p>
            <p className="text-xs text-gray-500 mt-1">
              选中的版本将作为有效内容保留，未选中的将被删除
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 确认步骤
// ============================================================
interface ConfirmStepProps {
  stats: { keep: number; delete: number; deleteDuration: number; reductionPercent: number };
  assetId: string;
  getVideoUrl: (assetId: string) => string;
}

function ConfirmStep({ stats, assetId, getVideoUrl }: ConfirmStepProps) {
  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-full p-6 flex flex-col items-center justify-center">
        <div className="w-full max-w-md">
          <div className="p-6 bg-gray-50 rounded-xl border border-gray-200 mb-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center justify-center gap-2">
              <CheckCircle2 size={20} className="text-emerald-600" />
              确认清理结果
            </h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-emerald-100 rounded-lg border border-emerald-200">
                <div className="text-3xl font-bold text-emerald-600">{stats.keep}</div>
                <div className="text-sm text-gray-600 mt-1">保留</div>
              </div>
              <div className="p-4 bg-red-100 rounded-lg border border-red-200">
                <div className="text-3xl font-bold text-red-500">{stats.delete}</div>
                <div className="text-sm text-gray-600 mt-1">删除</div>
              </div>
              <div className="p-4 bg-gray-200 rounded-lg border border-gray-300">
                <div className="text-3xl font-bold text-gray-700">
                  {stats.reductionPercent.toFixed(1)}%
                </div>
                <div className="text-sm text-gray-600 mt-1">时长减少</div>
              </div>
            </div>
            {stats.deleteDuration > 0 && (
              <p className="text-center text-gray-500 text-sm mt-4">
                将删除约 <span className="font-semibold">{(stats.deleteDuration / 1000).toFixed(1)}</span> 秒内容
              </p>
            )}
          </div>
          <p className="text-center text-gray-500 text-sm">
            点击"确认清理"应用所有选择
          </p>
        </div>
      </div>
    </div>
  );
}
