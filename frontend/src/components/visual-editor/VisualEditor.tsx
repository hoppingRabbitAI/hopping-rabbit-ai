'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useVisualEditorStore } from '@/stores/visualEditorStore';
import Header from './Header';
import ShotStrategySelector, { ShotStrategy } from './ShotStrategySelector';
import { WorkflowCanvas } from './workflow';
import { Loader2 } from 'lucide-react';

// ==========================================
// 类型定义
// ==========================================

interface ClipItem {
  id: string;
  asset_id: string;
  start_time: number;   // 毫秒
  end_time: number;
  source_start: number;
  source_end: number;
  parent_clip_id?: string;
  thumbnail_url?: string;
  transcript?: string;
  name?: string;
}

interface SegmentationResponse {
  session_id: string;
  strategy?: string;
  status: 'pending' | 'analyzing' | 'completed' | 'error';
  clips: ClipItem[];
  total_duration_ms: number;
  error_message?: string;
}

// ==========================================
// 主组件
// ==========================================

export default function VisualEditor() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('project');
  const sessionId = searchParams.get('session');
  const strategyFromUrl = searchParams.get('strategy') as ShotStrategy | null;
  
  // 分镜策略状态 - 从 URL 参数读取，如果有则直接使用
  const [selectedStrategy, setSelectedStrategy] = useState<ShotStrategy | null>(strategyFromUrl);
  const [isStrategyAnalyzing, setIsStrategyAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string>('');
  const [hasAutoStarted, setHasAutoStarted] = useState(false);  // 防止重复启动
  
  const {
    isLoading,
    isAnalyzing,
    error,
    shots,
    initialize,
    setShots,
    setIsLoading,
    setIsAnalyzing,
    setError,
  } = useVisualEditorStore();
  
  // 初始化
  useEffect(() => {
    if (projectId && sessionId) {
      initialize(projectId, sessionId);
      // ★ 切换项目时重置自动启动标志，确保新项目会重新分析
      setHasAutoStarted(false);
      setSelectedStrategy(strategyFromUrl);
    }
  }, [projectId, sessionId]);
  
  // ★ 提取：处理 clips 结果的公共逻辑（需要在 refreshClips 之前定义）
  const processClipsResult = useCallback(async (result: SegmentationResponse, _strategy: ShotStrategy) => {
    if (!result || result.clips.length === 0) {
      throw new Error('分镜结果为空');
    }
    
    console.log('[VisualEditor] API 返回的 clips:', result.clips.map(c => ({
      id: c.id.substring(0, 8),
      thumbnail_url: c.thumbnail_url || '(空)'
    })));
    
    const formattedShots = result.clips.map((clip, index) => ({
      id: clip.id,
      index,
      startTime: clip.start_time / 1000,
      endTime: clip.end_time / 1000,
      sourceStart: clip.source_start,  // ★ 源视频位置（毫秒）
      sourceEnd: clip.source_end,      // ★ 源视频位置（毫秒）
      thumbnail: clip.thumbnail_url,
      transcript: clip.transcript,
      assetId: clip.asset_id,
      background: { type: 'original' as const },
      artboard: { x: 0, y: 0, width: 1920, height: 1080 },
      layers: [
        { id: `layer-bg-${index}`, type: 'background' as const, name: '背景', visible: true, locked: false, opacity: 1, objects: [] },
        { id: `layer-fg-${index}`, type: 'foreground' as const, name: '人物', visible: true, locked: true, opacity: 1, objects: [] },
        { id: `layer-dec-${index}`, type: 'decoration' as const, name: '装饰', visible: true, locked: false, opacity: 1, objects: [] },
      ],
    }));
    
    setShots(formattedShots);
    console.log(`[VisualEditor] 分镜完成: ${formattedShots.length} 个分镜`);
  }, [setShots]);
  
  // ★ 刷新 clips 数据（用于拆分后刷新）
  const refreshClips = useCallback(async () => {
    if (!sessionId) return;
    
    try {
      const { authFetch } = await import('@/lib/supabase/session');
      const response = await authFetch(`/api/shot-segmentation/sessions/${sessionId}/clips`);
      
      if (response.ok) {
        const data: SegmentationResponse = await response.json();
        if (data.status === 'completed' && data.clips.length > 0) {
          await processClipsResult(data, selectedStrategy || 'sentence');
        }
      }
    } catch (err) {
      console.error('[VisualEditor] 刷新 clips 失败:', err);
    }
  }, [sessionId, selectedStrategy, processClipsResult]);
  
  // ★ 监听 clips-updated 事件（拆分后触发）
  useEffect(() => {
    const handleClipsUpdated = () => {
      console.log('[VisualEditor] 收到 clips-updated 事件，刷新数据...');
      refreshClips();
    };
    
    window.addEventListener('clips-updated', handleClipsUpdated);
    return () => window.removeEventListener('clips-updated', handleClipsUpdated);
  }, [refreshClips]);
  
  // 轮询分镜状态
  const pollSegmentationStatus = useCallback(async (expectedStrategy?: ShotStrategy): Promise<SegmentationResponse | null> => {
    const { authFetch } = await import('@/lib/supabase/session');
    
    const maxRetries = 60; // 最多轮询60次，每次2秒
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        const response = await authFetch(`/api/shot-segmentation/sessions/${sessionId}/clips`);
        
        if (!response.ok) {
          throw new Error(`获取分镜状态失败: ${response.status}`);
        }
        
        const data: SegmentationResponse = await response.json();
        
        if (data.status === 'completed') {
          // 如果指定了期望策略，检查策略是否匹配
          if (expectedStrategy && data.strategy !== expectedStrategy) {
            console.log(`[VisualEditor] 轮询: 策略不匹配 (got: ${data.strategy}, expected: ${expectedStrategy})，继续等待...`);
            // 策略不匹配说明新分镜还没完成，继续轮询
            setAnalysisStatus('正在等待新策略分镜完成...');
          } else if (data.clips.length > 1 || (data.clips.length > 0 && data.strategy === expectedStrategy)) {
            // 策略匹配或有多个 clips（说明分镜完成）
            return data;
          } else {
            console.log(`[VisualEditor] 轮询: clips 数量 ${data.clips.length}，策略 ${data.strategy}，继续等待...`);
          }
        } else if (data.status === 'error') {
          throw new Error(data.error_message || '分镜分析失败');
        } else if (data.status === 'analyzing') {
          setAnalysisStatus('正在分析视频内容...');
        }
        
        // 等待2秒后重试
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries++;
      } catch (err) {
        console.error('轮询分镜状态失败:', err);
        throw err;
      }
    }
    
    throw new Error('分镜分析超时');
  }, [sessionId]);
  
  // 处理策略选择并开始分析
  const handleStrategySelect = async (strategy: ShotStrategy) => {
    setSelectedStrategy(strategy);
    setIsStrategyAnalyzing(true);
    setAnalysisStatus('正在启动分镜分析...');
    
    try {
      await loadProjectData(strategy);
    } catch (err) {
      console.error('分镜分析失败:', err);
      setError?.(err instanceof Error ? err.message : '分镜分析失败');
    } finally {
      setIsStrategyAnalyzing(false);
      setAnalysisStatus('');
    }
  };
  
  // ★ 简化：加载项目数据（幂等逻辑由后端处理）
  const loadProjectData = async (strategy: ShotStrategy) => {
    console.log('[VisualEditor] loadProjectData 开始, strategy:', strategy, 'sessionId:', sessionId);
    
    if (!sessionId) {
      setError('缺少 session 参数，请从项目页面进入');
      setIsLoading(false);
      setIsAnalyzing(false);
      return;
    }
    
    setIsLoading(true);
    setIsAnalyzing(true);
    
    try {
      const { authFetch } = await import('@/lib/supabase/session');
      
      // ★ 治标治本：先尝试直接获取已完成的 clips（避免不必要的 POST）
      setAnalysisStatus('正在检查分镜状态...');
      const existingResponse = await authFetch(`/api/shot-segmentation/sessions/${sessionId}/clips`);
      
      if (existingResponse.ok) {
        const existingData = await existingResponse.json();
        
        // 如果已有相同策略的 clips，直接使用
        if (existingData.status === 'completed' && 
            existingData.clips?.length > 0 && 
            existingData.strategy === strategy) {
          console.log('[VisualEditor] ✅ 已有相同策略的分镜结果，直接使用');
          await processClipsResult(existingData, strategy);
          return;
        }
        
        console.log('[VisualEditor] 现有分镜状态:', existingData.status, '策略:', existingData.strategy);
      }
      
      // 1. 调用后端启动分镜（后端处理幂等：已完成/进行中会直接返回对应状态）
      setAnalysisStatus('正在提交分镜任务...');
      const startResponse = await authFetch(`/api/shot-segmentation/sessions/${sessionId}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy }),
      });
      
      if (!startResponse.ok) {
        const errorData = await startResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || `启动分镜失败: ${startResponse.status}`);
      }
      
      const startData = await startResponse.json();
      console.log('[VisualEditor] 分镜响应:', startData);
      
      // 2. 根据后端返回的状态处理
      if (startData.status === 'completed') {
        // 已完成，直接获取结果
        console.log('[VisualEditor] 后端返回已完成，直接获取结果');
      } else if (startData.status === 'analyzing') {
        // 正在进行中，等待完成
        console.log('[VisualEditor] 后端返回进行中，等待完成');
        setAnalysisStatus('正在分析视频...');
      } else {
        // pending，刚启动，等待完成
        console.log('[VisualEditor] 后端返回 pending，等待完成');
        setAnalysisStatus('正在分析视频...');
      }
      
      // 3. 轮询获取最终结果
      const result = await pollSegmentationStatus(strategy);
      
      // 4. 处理分镜结果（复用公共逻辑）
      await processClipsResult(result!, strategy);
      
    } catch (err) {
      console.error('[VisualEditor] 分镜失败:', err);
      setError(err instanceof Error ? err.message : '分镜失败');
    } finally {
      setIsLoading(false);
      setIsAnalyzing(false);
    }
  };
  
  // 如果 URL 中有策略参数，自动开始分析（放在函数定义之后）
  useEffect(() => {
    console.log('[VisualEditor] 检查自动启动条件:', {
      strategyFromUrl,
      sessionId,
      hasAutoStarted,
      shotsLength: shots.length,
      isAnalyzing,
      isLoading,
    });
    
    // 只在有策略、有 sessionId、没有开始过、没有分镜结果、不在分析中时启动
    if (strategyFromUrl && sessionId && !hasAutoStarted && shots.length === 0 && !isAnalyzing && !isLoading) {
      console.log('[VisualEditor] ✅ 自动启动分镜分析, strategy:', strategyFromUrl);
      setHasAutoStarted(true);
      handleStrategySelect(strategyFromUrl);
    } else {
      console.log('[VisualEditor] ⏸️ 自动启动条件不满足');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyFromUrl, sessionId, hasAutoStarted, shots.length, isAnalyzing, isLoading]);
  
  // 如果还没选择策略（且 URL 中也没有），显示策略选择界面
  if (!selectedStrategy) {
    return (
      <ShotStrategySelector 
        onSelect={handleStrategySelect}
        isAnalyzing={isStrategyAnalyzing}
        videoName="未命名视频"
        videoDuration={120}
      />
    );
  }
  
  // 错误状态
  if (error) {
    return (
      <div className="h-screen w-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-2xl shadow-lg border border-gray-200 max-w-md">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-500 text-xl">!</span>
          </div>
          <p className="text-red-600 text-lg font-medium mb-2">分镜分析失败</p>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button 
              onClick={() => {
                setError?.('');
                setSelectedStrategy(null);
              }}
              className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              重新选择策略
            </button>
            <button 
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-gray-800 text-white rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // 加载状态 - 包括正在加载或准备开始加载
  const isWaitingToLoad = selectedStrategy && !hasAutoStarted && shots.length === 0;
  
  if (isLoading || isWaitingToLoad) {
    return (
      <div className="h-screen w-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-2xl shadow-lg border border-gray-200">
          <Loader2 className="w-8 h-8 text-gray-800 animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm font-medium">
            {analysisStatus || (isAnalyzing ? '正在分析视频...' : '加载中...')}
          </p>
          <p className="text-gray-400 text-xs mt-2">
            策略: {
              selectedStrategy === 'scene' ? '场景拆分' : 
              selectedStrategy === 'sentence' ? '按句拆分' : 
              '按段落拆分'
            }
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-screen w-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <Header />
      
      {/* 工作流画布 */}
      <div className="flex-1 overflow-hidden">
        <WorkflowCanvas 
          shots={shots}
          sessionId={sessionId || ''}
          projectId={projectId || undefined}
          onShotSelect={(shot) => {
            console.log('Selected shot:', shot);
          }}
        />
      </div>
    </div>
  );
}
