'use client';

/**
 * 智能一键成片 V2 - 审核页面
 * 用户审核 LLM 分析结果，选择保留/删除片段
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  CheckCircle2, 
  Trash2, 
  HelpCircle,
  Sparkles,
  RotateCcw,
  ArrowRight,
  Play,
  Pause,
  Volume2,
  Star
} from 'lucide-react';
import { 
  AnalysisResult, 
  AnalyzedSegment, 
  RepeatGroup,
  SegmentSelection,
  confirmSelectionApi,
  formatTime,
  formatDuration,
  getClassificationLabel,
  getActionLabel
} from '@/features/editor/lib/smart-v2-api';
import { projectApi } from '@/lib/api/projects';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[ReviewView]', ...args); };

interface ReviewViewProps {
  analysisResult: AnalysisResult;
  projectId: string;
  videoUrl?: string;
  onConfirm: () => void;
  onBack: () => void;
}

export function ReviewView({
  analysisResult,
  projectId,
  videoUrl,
  onConfirm,
  onBack
}: ReviewViewProps) {
  // 用户选择状态
  const [selections, setSelections] = useState<Map<string, SegmentSelection>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 视频预览
  const [previewSegmentId, setPreviewSegmentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // 初始化选择（使用推荐值）
  useEffect(() => {
    const initial = new Map<string, SegmentSelection>();
    
    analysisResult.segments.forEach(seg => {
      // 对于重复组，只保留推荐的
      if (seg.repeat_group_id) {
        const group = analysisResult.repeat_groups.find(g => g.id === seg.repeat_group_id);
        const isRecommended = group?.recommended_id === seg.id;
        initial.set(seg.id, {
          segment_id: seg.id,
          action: isRecommended ? 'keep' : 'delete',
          selected_from_group: seg.repeat_group_id,
        });
      } else {
        // 普通片段，按推荐来
        initial.set(seg.id, {
          segment_id: seg.id,
          action: seg.action === 'delete' ? 'delete' : 'keep',
        });
      }
    });
    
    setSelections(initial);
    debugLog('初始化选择:', initial.size, '个片段');
  }, [analysisResult]);
  
  // 计算统计
  const stats = useMemo(() => {
    let keepCount = 0;
    let deleteCount = 0;
    let pendingCount = 0;
    
    selections.forEach((sel, id) => {
      if (sel.action === 'keep') keepCount++;
      else if (sel.action === 'delete') deleteCount++;
    });
    
    // 检查是否有待选择的重复组
    analysisResult.repeat_groups.forEach(group => {
      const groupSelections = group.segment_ids
        .map(id => selections.get(id))
        .filter(s => s?.action === 'keep');
      if (groupSelections.length === 0) {
        pendingCount++;
      }
    });
    
    return { keepCount, deleteCount, pendingCount };
  }, [selections, analysisResult.repeat_groups]);
  
  // 切换片段选择
  const toggleSegment = useCallback((segmentId: string, action: 'keep' | 'delete') => {
    setSelections(prev => {
      const next = new Map(prev);
      const current = next.get(segmentId);
      
      if (current) {
        // 如果是重复组的一部分，选择一个时自动取消其他的
        if (current.selected_from_group && action === 'keep') {
          const group = analysisResult.repeat_groups.find(g => g.id === current.selected_from_group);
          if (group) {
            group.segment_ids.forEach(id => {
              const sel = next.get(id);
              if (sel) {
                next.set(id, { ...sel, action: id === segmentId ? 'keep' : 'delete' });
              }
            });
            return next;
          }
        }
        
        next.set(segmentId, { ...current, action });
      }
      
      return next;
    });
  }, [analysisResult.repeat_groups]);
  
  // 一键接受推荐
  const acceptAllRecommendations = useCallback(() => {
    const next = new Map<string, SegmentSelection>();
    
    analysisResult.segments.forEach(seg => {
      if (seg.repeat_group_id) {
        const group = analysisResult.repeat_groups.find(g => g.id === seg.repeat_group_id);
        const isRecommended = group?.recommended_id === seg.id;
        next.set(seg.id, {
          segment_id: seg.id,
          action: isRecommended ? 'keep' : 'delete',
          selected_from_group: seg.repeat_group_id,
        });
      } else {
        next.set(seg.id, {
          segment_id: seg.id,
          action: seg.action === 'delete' ? 'delete' : 'keep',
        });
      }
    });
    
    setSelections(next);
    debugLog('接受所有推荐');
  }, [analysisResult]);
  
  // 一键删除所有废话
  const deleteAllFillers = useCallback(() => {
    setSelections(prev => {
      const next = new Map(prev);
      
      analysisResult.segments.forEach(seg => {
        if (seg.classification === 'filler') {
          const current = next.get(seg.id);
          if (current) {
            next.set(seg.id, { ...current, action: 'delete' });
          }
        }
      });
      
      return next;
    });
    debugLog('删除所有废话');
  }, [analysisResult.segments]);
  
  // 重置选择
  const resetSelections = useCallback(() => {
    acceptAllRecommendations();
    debugLog('重置选择');
  }, [acceptAllRecommendations]);
  
  // 确认并生成 clips
  const handleConfirm = async () => {
    if (stats.pendingCount > 0) {
      setError(`还有 ${stats.pendingCount} 个重复片段组需要选择`);
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const selectionsArray = Array.from(selections.values());
      
      debugLog('🚀 [一键成片] 开始确认，请求参数:', {
        analysis_id: analysisResult.id,
        selectionsCount: selectionsArray.length,
        keepCount: selectionsArray.filter(s => s.action === 'keep').length,
        deleteCount: selectionsArray.filter(s => s.action === 'delete').length,
        apply_zoom_recommendations: true,
      });
      
      const result = await confirmSelectionApi({
        analysis_id: analysisResult.id,
        selections: selectionsArray,
        apply_zoom_recommendations: true,
      });
      
      debugLog('✅ [一键成片] 确认成功，后端响应:', result);
      
      // 获取项目详情，检查生成的 clips 和 keyframes
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
          
          debugLog('📊 [一键成片] 项目状态检查:', {
            projectId,
            totalClips,
            totalKeyframes: keyframes.length,
            keyframesByClip,
            keyframesByProperty,
          });
          
          // 详细打印每个关键帧
          if (keyframes.length > 0) {
            debugLog('🎬 [一键成片] 关键帧详情:');
            keyframes.forEach((kf, i) => {
              debugLog(`  [${i}] clipId=${kf.clipId?.slice(0, 8)}, prop=${kf.property}, offset=${kf.offset}, value=`, kf.value);
            });
          } else {
            debugLog('⚠️ [一键成片] 警告: 未检测到关键帧!');
          }
        }
      } catch (projectErr) {
        debugLog('⚠️ [一键成片] 获取项目详情失败（不影响跳转）:', projectErr);
      }
      
      debugLog('🎯 [一键成片] 即将进入编辑器');
      onConfirm();
      
    } catch (e) {
      setError(e instanceof Error ? e.message : '确认失败');
      debugLog('❌ [一键成片] 确认失败:', e);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div className="review-view min-h-screen bg-[#FAFAFA] text-gray-900">
      {/* 头部 */}
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                智能分析完成
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {analysisResult.mode === 'with_script' ? '有脚本模式' : '无脚本模式'} · 
                共 {analysisResult.summary.total_segments} 个片段
              </p>
            </div>
            
            {/* 统计摘要 */}
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="w-4 h-4" />
                保留 {stats.keepCount}
              </span>
              <span className="flex items-center gap-1 text-red-500">
                <Trash2 className="w-4 h-4" />
                删除 {stats.deleteCount}
              </span>
              {stats.pendingCount > 0 && (
                <span className="flex items-center gap-1 text-amber-500">
                  <HelpCircle className="w-4 h-4" />
                  待选 {stats.pendingCount}
                </span>
              )}
              <span className="text-gray-500">
                预计减少 {analysisResult.summary.reduction_percent}%
              </span>
            </div>
          </div>
        </div>
      </header>
      
      {/* 主内容区 */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* 快捷操作 */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={acceptAllRecommendations}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors"
          >
            <Star className="w-4 h-4" />
            接受所有推荐
          </button>
          <button
            onClick={deleteAllFillers}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            删除所有废话
          </button>
          <button
            onClick={resetSelections}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            重置
          </button>
        </div>
        
        {/* 重复片段组 */}
        {analysisResult.repeat_groups.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-medium mb-4 flex items-center gap-2 text-gray-900">
              🔄 重复片段选择
              <span className="text-sm text-gray-500 font-normal">
                （同一句话录了多遍，请选择最佳版本）
              </span>
            </h2>
            <div className="space-y-4">
              {analysisResult.repeat_groups.map(group => (
                <RepeatGroupCard
                  key={group.id}
                  group={group}
                  segments={analysisResult.segments.filter(s => 
                    group.segment_ids.includes(s.id)
                  )}
                  selections={selections}
                  onSelect={(segmentId) => toggleSegment(segmentId, 'keep')}
                  videoUrl={videoUrl}
                />
              ))}
            </div>
          </section>
        )}
        
        {/* 片段列表 */}
        <section>
          <h2 className="text-lg font-medium mb-4 text-gray-900">📋 所有片段</h2>
          <div className="space-y-2">
            {analysisResult.segments
              .filter(seg => !seg.repeat_group_id)  // 不在重复组里的
              .map(segment => (
                <SegmentRow
                  key={segment.id}
                  segment={segment}
                  selection={selections.get(segment.id)}
                  onToggle={(action) => toggleSegment(segment.id, action)}
                  videoUrl={videoUrl}
                />
              ))}
          </div>
        </section>
        
        {/* 风格分析 */}
        {analysisResult.style_analysis && (
          <section className="mt-8 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-lg font-medium mb-3 flex items-center gap-2 text-gray-900">
              🎬 风格分析
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">检测风格：</span>
                <span className="ml-2 font-medium text-gray-900">
                  {getStyleLabel(analysisResult.style_analysis.detected_style)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">置信度：</span>
                <span className="ml-2 text-gray-900">
                  {Math.round((analysisResult.style_analysis.confidence ?? analysisResult.style_analysis.style_confidence ?? 0) * 100)}%
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500">分析说明：</span>
                <span className="ml-2 text-gray-700">
                  {analysisResult.style_analysis.reasoning}
                </span>
              </div>
            </div>
          </section>
        )}
      </main>
      
      {/* 底部操作栏 */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={onBack}
              className="px-4 py-2 text-gray-500 hover:text-gray-900 transition-colors"
            >
              ← 返回
            </button>
            
            {error && (
              <span className="text-red-500 text-sm">{error}</span>
            )}
            
            <button
              onClick={handleConfirm}
              disabled={isSubmitting || stats.pendingCount > 0}
              className={`
                flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-colors
                ${isSubmitting || stats.pendingCount > 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600 text-white'
                }
              `}
            >
              {isSubmitting ? (
                <>处理中...</>
              ) : (
                <>
                  确认，进入编辑器
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </footer>
      
      {/* 底部 padding */}
      <div className="h-20" />
    </div>
  );
}


// ============================================
// 子组件
// ============================================

interface RepeatGroupCardProps {
  group: RepeatGroup;
  segments: AnalyzedSegment[];
  selections: Map<string, SegmentSelection>;
  onSelect: (segmentId: string) => void;
  videoUrl?: string;
}

function RepeatGroupCard({
  group,
  segments,
  selections,
  onSelect,
  videoUrl
}: RepeatGroupCardProps) {
  const selectedId = segments.find(s => 
    selections.get(s.id)?.action === 'keep'
  )?.id;
  
  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-sm text-gray-500">表达意图：</span>
          <span className="ml-2 text-gray-900">{group.intent}</span>
        </div>
        <span className="text-xs text-gray-400">
          {segments.length} 个版本
        </span>
      </div>
      
      <div className="grid gap-2">
        {segments.map(seg => (
          <div
            key={seg.id}
            onClick={() => onSelect(seg.id)}
            className={`
              flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors
              ${selectedId === seg.id 
                ? 'bg-green-50 border border-green-300' 
                : 'bg-gray-50 hover:bg-gray-100 border border-gray-200'
              }
            `}
          >
            {/* 选择指示器 */}
            <div className={`
              w-5 h-5 rounded-full border-2 flex items-center justify-center
              ${selectedId === seg.id 
                ? 'border-green-500 bg-green-500' 
                : 'border-gray-300'
              }
            `}>
              {selectedId === seg.id && (
                <CheckCircle2 className="w-3 h-3 text-white" />
              )}
            </div>
            
            {/* 内容 */}
            <div className="flex-1">
              <div className="text-sm text-gray-900">"{seg.text}"</div>
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                <span>{formatTime(seg.start)} - {formatTime(seg.end)}</span>
                <span>·</span>
                <span>质量: {Math.round(seg.quality_score * 100)}%</span>
                {seg.quality_notes && (
                  <>
                    <span>·</span>
                    <span className="text-gray-400">{seg.quality_notes}</span>
                  </>
                )}
              </div>
            </div>
            
            {/* 推荐标记 */}
            {group.recommended_id === seg.id && (
              <span className="flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-600 text-xs rounded">
                <Star className="w-3 h-3" />
                推荐
              </span>
            )}
          </div>
        ))}
      </div>
      
      {group.recommend_reason && (
        <div className="mt-3 text-xs text-gray-500">
          💡 推荐理由：{group.recommend_reason}
        </div>
      )}
    </div>
  );
}


interface SegmentRowProps {
  segment: AnalyzedSegment;
  selection?: SegmentSelection;
  onToggle: (action: 'keep' | 'delete') => void;
  videoUrl?: string;
}

function SegmentRow({
  segment,
  selection,
  onToggle,
  videoUrl
}: SegmentRowProps) {
  const action = selection?.action || 'keep';
  const classLabel = getClassificationLabel(segment.classification);
  
  return (
    <div className={`
      flex items-center gap-3 p-3 rounded-lg transition-colors
      ${action === 'delete' ? 'bg-red-50' : 'bg-white'}
      ${action === 'delete' ? 'border border-red-200' : 'border border-gray-200'}
    `}>
      {/* 时间 */}
      <span className="text-xs text-gray-500 w-20">
        {formatTime(segment.start)}
      </span>
      
      {/* 分类标签 */}
      <span className={`
        px-2 py-0.5 text-xs rounded
        ${classLabel.color === 'green' ? 'bg-green-100 text-green-600' : ''}
        ${classLabel.color === 'red' ? 'bg-red-100 text-red-600' : ''}
        ${classLabel.color === 'yellow' ? 'bg-yellow-100 text-yellow-600' : ''}
        ${classLabel.color === 'orange' ? 'bg-orange-100 text-orange-600' : ''}
        ${classLabel.color === 'blue' ? 'bg-gray-200 text-gray-600' : ''}
      `}>
        {classLabel.text}
      </span>
      
      {/* 文本内容 */}
      <span className={`
        flex-1 text-sm
        ${action === 'delete' ? 'text-gray-400 line-through' : 'text-gray-800'}
      `}>
        "{segment.text}"
      </span>
      
      {/* 废话词高亮 */}
      {segment.filler_words.length > 0 && (
        <span className="text-xs text-red-500">
          {segment.filler_words.join(', ')}
        </span>
      )}
      
      {/* 操作按钮 */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onToggle('keep')}
          className={`
            p-1.5 rounded transition-colors
            ${action === 'keep' 
              ? 'bg-green-500 text-white' 
              : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
            }
          `}
          title="保留"
        >
          <CheckCircle2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => onToggle('delete')}
          className={`
            p-1.5 rounded transition-colors
            ${action === 'delete' 
              ? 'bg-red-500 text-white' 
              : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
            }
          `}
          title="删除"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}


// ============================================
// 辅助函数
// ============================================

function getStyleLabel(style: string): string {
  const labels: Record<string, string> = {
    energetic_vlog: '活力 Vlog 🔥',
    tutorial: '教程讲解 📚',
    storytelling: '故事叙述 📖',
    news_commentary: '新闻评论 📺',
  };
  return labels[style] || style;
}

export default ReviewView;
