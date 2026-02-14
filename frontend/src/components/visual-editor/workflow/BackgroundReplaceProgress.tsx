/**
 * 背景替换工作流进度组件
 * 显示5阶段 Agent Workflow 的实时进度
 */

'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { 
  Loader2, 
  Check, 
  X,
  Video,
  Scissors,
  ImagePlus,
  Layers,
  Sparkles,
  AlertCircle,
  Scan,       // [新增]
  Move,       // [新增]
  Mic,        // [新增]
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';

// 工作流阶段定义
interface WorkflowStage {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  progressRange: [number, number];
}

// 策略A: 纯背景替换阶段
const STRATEGY_A_STAGES: WorkflowStage[] = [
  {
    id: 'detecting',
    name: '编辑检测',
    description: '分析编辑区域与人物的交集',
    icon: Scan,
    progressRange: [0, 5],
  },
  {
    id: 'analyzing',
    name: '视频分析',
    description: '分析原视频的光线、运动、场景',
    icon: Video,
    progressRange: [5, 15],
  },
  {
    id: 'separating',
    name: '前景分离',
    description: '高精度提取人物（含头发丝）',
    icon: Scissors,
    progressRange: [15, 35],
  },
  {
    id: 'generating',
    name: '背景生成',
    description: '将静态背景转换为动态视频',
    icon: ImagePlus,
    progressRange: [35, 65],
  },
  {
    id: 'compositing',
    name: '智能合成',
    description: '光影匹配、边缘融合、阴影生成',
    icon: Layers,
    progressRange: [65, 85],
  },
  {
    id: 'enhancing',
    name: '质量增强',
    description: '去闪烁、AI痕迹修复',
    icon: Sparkles,
    progressRange: [85, 100],
  },
];

// 策略B: 人物编辑阶段
const STRATEGY_B_STAGES: WorkflowStage[] = [
  {
    id: 'detecting',
    name: '编辑检测',
    description: '分析编辑区域与人物的交集',
    icon: Scan,
    progressRange: [0, 5],
  },
  {
    id: 'analyzing',
    name: '视频分析',
    description: '分析原视频的光线、运动、场景',
    icon: Video,
    progressRange: [5, 15],
  },
  {
    id: 'motion_control',
    name: '动作迁移',
    description: 'AI 让编辑后的人物动起来',
    icon: Move,
    progressRange: [15, 40],
  },
  {
    id: 'lip_sync',
    name: '口型同步',
    description: 'AI 重建口型与音频同步',
    icon: Mic,
    progressRange: [40, 55],
  },
  {
    id: 'compositing',
    name: '背景合成',
    description: '合成新背景',
    icon: Layers,
    progressRange: [55, 80],
  },
  {
    id: 'enhancing',
    name: '质量增强',
    description: '去闪烁、AI痕迹修复',
    icon: Sparkles,
    progressRange: [80, 100],
  },
];

// [保留兼容] 默认阶段
const WORKFLOW_STAGES: WorkflowStage[] = STRATEGY_A_STAGES;

interface WorkflowProgressProps {
  workflowId: string;
  projectId: string;
  taskId?: string;  // ★ 关联的任务 ID，用于同步进度到 taskHistoryStore
  onComplete?: (resultUrl: string) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

interface WorkflowStatus {
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStage: string;
  stageProgress: number;
  overallProgress: number;
  message?: string;
  error?: string;
  resultUrl?: string;
  // [新增] 策略信息
  detectedStrategy?: 'background_only' | 'person_minor_edit' | 'person_major_edit';
  strategyConfidence?: number;
  strategyRecommendation?: string;
}

import { useTaskHistoryStore } from '@/stores/taskHistoryStore';

export function BackgroundReplaceProgress({
  workflowId,
  projectId,
  taskId,
  onComplete,
  onError,
  onClose,
}: WorkflowProgressProps) {
  const updateTask = useTaskHistoryStore(state => state.updateTask);
  const [status, setStatus] = useState<WorkflowStatus>({
    status: 'pending',
    currentStage: 'created',
    stageProgress: 0,
    overallProgress: 0,
  });
  const [isConnected, setIsConnected] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // [新增] 根据策略选择阶段列表
  const workflowStages = useMemo(() => {
    if (status.detectedStrategy === 'background_only') {
      return STRATEGY_A_STAGES;
    } else if (status.detectedStrategy === 'person_minor_edit' || status.detectedStrategy === 'person_major_edit') {
      return STRATEGY_B_STAGES;
    }
    return STRATEGY_A_STAGES; // 默认
  }, [status.detectedStrategy]);

  // ★★★ 轮询获取任务状态（作为 SSE 的后备方案）★★★
  const pollWorkflowStatus = useCallback(async () => {
    if (!workflowId) return;
    
    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:8000';
      const response = await fetch(`${backendUrl}/api/background-replace/workflows/${workflowId}`);
      
      if (!response.ok) {
        console.warn('[WorkflowProgress] 轮询失败:', response.status);
        return;
      }
      
      const data = await response.json();
      console.log('[WorkflowProgress] 轮询结果:', data);
      
      // 更新状态
      if (data.status === 'completed') {
        setStatus(prev => ({
          ...prev,
          status: 'completed',
          currentStage: 'completed',
          overallProgress: 100,
          resultUrl: data.result_url,
        }));
        if (taskId) {
          updateTask(taskId, {
            status: 'completed',
            progress: 100,
            status_message: '处理完成',
            output_url: data.result_url,
            completed_at: new Date().toISOString(),
          });
        }
        onComplete?.(data.result_url);
        return true; // 停止轮询
      } else if (data.status === 'failed') {
        setStatus(prev => ({
          ...prev,
          status: 'failed',
          error: data.error || '处理失败',
        }));
        if (taskId) {
          updateTask(taskId, {
            status: 'failed',
            error_message: data.error || '处理失败',
          });
        }
        onError?.(data.error || '处理失败');
        return true; // 停止轮询
      } else {
        // 进行中
        setStatus(prev => ({
          ...prev,
          status: 'running',
          overallProgress: data.progress || prev.overallProgress,
        }));
        if (taskId) {
          updateTask(taskId, {
            status: 'processing',
            progress: data.progress || 0,
          });
        }
        return false; // 继续轮询
      }
    } catch (err) {
      console.error('[WorkflowProgress] 轮询出错:', err);
      return false;
    }
  }, [workflowId, taskId, updateTask, onComplete, onError]);

  // 连接 SSE，失败时回退到轮询
  useEffect(() => {
    if (!workflowId) return;

    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let usePolling = false;

    const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:8000';
    const eventSource = new EventSource(
      `${backendUrl}/api/background-replace/workflows/${workflowId}/events`
    );

    eventSource.onopen = () => {
      console.log('[WorkflowProgress] SSE 连接已建立');
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[WorkflowProgress] 收到事件:', data);

        if (data.event_type === 'progress' || data.event_type === 'stage_change') {
          const progress = data.data?.overall_progress || 0;
          const message = data.data?.message || data.data?.stage || '';
          setStatus(prev => ({
            ...prev,
            status: 'running',
            currentStage: data.data?.stage || prev.currentStage,
            stageProgress: data.data?.stage_progress || prev.stageProgress,
            overallProgress: progress,
            message,
          }));
          // ★ 同步进度到 taskHistoryStore
          if (taskId) {
            updateTask(taskId, {
              status: 'processing',
              progress,
              status_message: message,
            });
          }
        } else if (data.event_type === 'strategy_detected') {
          setStatus(prev => ({
            ...prev,
            detectedStrategy: data.data?.strategy,
            strategyConfidence: data.data?.confidence,
            strategyRecommendation: data.data?.recommendation,
          }));
        } else if (data.event_type === 'completed') {
          setStatus(prev => ({
            ...prev,
            status: 'completed',
            currentStage: 'completed',
            overallProgress: 100,
            resultUrl: data.data?.result_url,
          }));
          // ★ 同步完成状态到 taskHistoryStore
          if (taskId) {
            updateTask(taskId, {
              status: 'completed',
              progress: 100,
              status_message: '处理完成',
              output_url: data.data?.result_url,
              completed_at: new Date().toISOString(),
            });
          }
          onComplete?.(data.data?.result_url);
          eventSource.close();
        } else if (data.event_type === 'failed') {
          setStatus(prev => ({
            ...prev,
            status: 'failed',
            error: data.data?.error || '处理失败',
          }));
          // ★ 同步失败状态到 taskHistoryStore
          if (taskId) {
            updateTask(taskId, {
              status: 'failed',
              error_message: data.data?.error || '处理失败',
            });
          }
          onError?.(data.data?.error || '处理失败');
          eventSource.close();
        }
      } catch (err) {
        console.error('[WorkflowProgress] 解析事件失败:', err);
      }
    };

    eventSource.onerror = () => {
      console.error('[WorkflowProgress] SSE 连接错误，切换到轮询模式');
      setIsConnected(false);
      eventSource.close();
      
      // ★★★ 回退到轮询模式 ★★★
      if (!usePolling) {
        usePolling = true;
        console.log('[WorkflowProgress] 启动轮询...');
        pollingTimer = setInterval(async () => {
          const shouldStop = await pollWorkflowStatus();
          if (shouldStop && pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = null;
          }
        }, 3000); // 每3秒轮询一次
      }
    };

    return () => {
      eventSource.close();
      if (pollingTimer) {
        clearInterval(pollingTimer);
      }
    };
  }, [workflowId, taskId, updateTask, onComplete, onError, pollWorkflowStatus]);

  // 计时器
  useEffect(() => {
    if (status.status !== 'running') return;

    const timer = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [status.status]);

  // 获取当前阶段索引
  const getCurrentStageIndex = useCallback(() => {
    return workflowStages.findIndex(s => s.id === status.currentStage);
  }, [status.currentStage, workflowStages]);

  // 获取阶段状态
  const getStageStatus = useCallback((stageIndex: number) => {
    const currentIndex = getCurrentStageIndex();
    
    if (status.status === 'completed') return 'completed';
    if (status.status === 'failed' && stageIndex === currentIndex) return 'failed';
    if (stageIndex < currentIndex) return 'completed';
    if (stageIndex === currentIndex) return 'active';
    return 'pending';
  }, [status.status, getCurrentStageIndex]);

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-w-[95vw] overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">AI 背景替换</h2>
            <p className="text-sm text-gray-500">
              {status.status === 'running' && `处理中... ${formatTime(elapsedTime)}`}
              {status.status === 'completed' && '处理完成！'}
              {status.status === 'failed' && '处理失败'}
            </p>
          </div>
          {status.status !== 'running' && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          )}
        </div>

        {/* 进度条 */}
        <div className="px-6 py-4 bg-gray-50">
          <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${
                status.status === 'failed' ? 'bg-red-500' : 'bg-gray-800'
              }`}
              style={{ width: `${status.overallProgress}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>{status.overallProgress}%</span>
            <span>预计 2-4 分钟</span>
          </div>
        </div>
        
        {/* [新增] 策略提示 */}
        {status.detectedStrategy && (
          <div className={`mx-6 mb-3 p-3 rounded-lg flex items-start gap-3 ${
            status.detectedStrategy === 'background_only' 
              ? 'bg-gray-50 border border-gray-200' 
              : 'bg-gray-50 border border-gray-200'
          }`}>
            {status.detectedStrategy === 'background_only' ? (
              <CheckCircle className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <div className={`text-sm font-medium ${
                status.detectedStrategy === 'background_only' ? 'text-gray-700' : 'text-gray-700'
              }`}>
                {status.detectedStrategy === 'background_only' 
                  ? '检测到仅编辑背景' 
                  : '检测到编辑了人物区域'}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                {status.strategyRecommendation || (
                  status.detectedStrategy === 'background_only'
                    ? '将保持原始口型和动作'
                    : '将使用 AI 重建口型和动作'
                )}
              </div>
            </div>
          </div>
        )}

        {/* 阶段列表 */}
        <div className="px-6 py-4 space-y-3">
          {workflowStages.map((stage, index) => {
            const stageStatus = getStageStatus(index);
            const Icon = stage.icon;
            
            return (
              <div
                key={stage.id}
                className={`flex items-center gap-4 p-3 rounded-xl transition-all ${
                  stageStatus === 'active' ? 'bg-gray-50 border border-gray-200' :
                  stageStatus === 'completed' ? 'bg-gray-50' :
                  stageStatus === 'failed' ? 'bg-red-50' :
                  'bg-gray-50'
                }`}
              >
                {/* 图标 */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  stageStatus === 'active' ? 'bg-gray-800 text-white' :
                  stageStatus === 'completed' ? 'bg-gray-500 text-white' :
                  stageStatus === 'failed' ? 'bg-red-500 text-white' :
                  'bg-gray-200 text-gray-400'
                }`}>
                  {stageStatus === 'active' ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : stageStatus === 'completed' ? (
                    <Check className="w-5 h-5" />
                  ) : stageStatus === 'failed' ? (
                    <AlertCircle className="w-5 h-5" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>

                {/* 文字 */}
                <div className="flex-1">
                  <div className={`font-medium ${
                    stageStatus === 'active' ? 'text-gray-800' :
                    stageStatus === 'completed' ? 'text-gray-700' :
                    stageStatus === 'failed' ? 'text-red-700' :
                    'text-gray-400'
                  }`}>
                    {stage.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {stageStatus === 'active' && status.message ? status.message : stage.description}
                  </div>
                </div>

                {/* 阶段进度 */}
                {stageStatus === 'active' && (
                  <div className="text-sm font-medium text-gray-600">
                    {status.stageProgress}%
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 错误信息 */}
        {status.status === 'failed' && status.error && (
          <div className="px-6 pb-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center gap-2 text-red-700">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">处理失败</span>
              </div>
              <p className="mt-1 text-sm text-red-600">{status.error}</p>
            </div>
          </div>
        )}

        {/* 完成状态 */}
        {status.status === 'completed' && (
          <div className="px-6 pb-4">
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
              <div className="flex items-center gap-2 text-gray-700">
                <Check className="w-5 h-5" />
                <span className="font-medium">背景替换完成！</span>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                视频已更新，可以在时间轴中预览效果
              </p>
            </div>
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          {status.status === 'running' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
            >
              最小化（后台处理）
            </button>
          )}
          {status.status === 'completed' && (
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-xl transition-all"
            >
              完成
            </button>
          )}
          {status.status === 'failed' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                关闭
              </button>
              <button
                className="px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-xl transition-all"
                disabled
              >
                重试（开发中）
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default BackgroundReplaceProgress;
