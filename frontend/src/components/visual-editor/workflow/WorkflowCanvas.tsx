/**
 * 工作流画布
 * 使用 React Flow 展示视频分镜工作流
 */

'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import type { Node, Edge, NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ClipNode } from './ClipNode';
import { AICapabilityPanel } from './AICapabilityPanel';
import { KeyframeEditor } from './KeyframeEditor';
// TaskProgressPanel 已废弃，使用 TaskHistorySidebar 替代
import { BackgroundReplaceProgress } from './BackgroundReplaceProgress';
import { useTaskProgress } from './useTaskProgress';
import { useBackgroundReplaceWorkflow } from './useBackgroundReplaceWorkflow';
import type { ClipNodeData, AICapability } from './types';
import type { GenerateParams, GenerateResult, ConfirmParams } from './KeyframeEditor';
import { getSessionSafe } from '@/lib/supabase/session';
import { useTaskHistoryStore } from '@/stores/taskHistoryStore';

// 注册自定义节点类型
const nodeTypes = {
  clip: ClipNode,
};

// Shot 数据类型（从 VisualEditor 传入）
interface Shot {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  sourceStart?: number;    // ★ 源视频位置（毫秒），用于 HLS 播放定位
  sourceEnd?: number;      // ★ 源视频位置（毫秒）
  thumbnail?: string;
  transcript?: string;
  assetId?: string; // ★ 素材 ID，用于播放
}

interface WorkflowCanvasProps {
  shots: Shot[];
  sessionId: string;
  projectId?: string;  // ★ 项目 ID，用于任务查询
  aspectRatio?: '16:9' | '9:16' | 'vertical' | 'horizontal';  // 视频比例
  onShotSelect?: (shot: Shot | null) => void;
}

export function WorkflowCanvas({ shots, sessionId, projectId, aspectRatio = '16:9', onShotSelect }: WorkflowCanvasProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showCapabilityPanel, setShowCapabilityPanel] = useState(false);
  const [showKeyframeEditor, setShowKeyframeEditor] = useState(false);
  const [selectedCapability, setSelectedCapability] = useState<AICapability | null>(null);

  // ★ 任务历史侧边栏（包含乐观更新）
  const { open: openTaskHistory, fetch: fetchTasks, addOptimisticTask } = useTaskHistoryStore();

  // ★ 背景替换工作流状态
  const backgroundWorkflow = useBackgroundReplaceWorkflow();

  // SSE 任务进度 (仅保留 addTask 用于添加任务追踪)
  const { addTask } = useTaskProgress({
    sessionId,
    onTaskComplete: (taskId: string, resultUrl?: string) => {
      console.log('任务完成:', taskId, resultUrl);
      // TODO: 可以在这里更新 clip 的状态
      // ★ 任务完成时刷新任务列表（使用 projectId）
      if (projectId) fetchTasks(projectId);
    },
    onTaskFailed: (taskId: string, error: string) => {
      console.error('任务失败:', taskId, error);
      // ★ 任务失败时也刷新任务列表（使用 projectId）
      if (projectId) fetchTasks(projectId);
    },
  });

  // 根据视频比例计算节点尺寸
  const isVertical = aspectRatio === 'vertical' || aspectRatio === '9:16';
  // 竖屏: 160宽, 横屏: 320宽
  const NODE_WIDTH = isVertical ? 160 : 320;

  // 将 shots 转换为 React Flow 节点
  const initialNodes = useMemo((): Node[] => {
    const GAP_X = 50;
    const START_X = 50;
    const START_Y = 50;

    return shots.map((shot, index) => ({
      id: shot.id,
      type: 'clip',
      position: {
        x: START_X + index * (NODE_WIDTH + GAP_X),
        y: START_Y,
      },
      data: {
        clipId: shot.id,
        index: shot.index,
        thumbnail: shot.thumbnail,
        duration: shot.endTime - shot.startTime,
        startTime: shot.startTime,
        endTime: shot.endTime,
        sourceStart: shot.sourceStart,  // ★ 源视频位置（毫秒），用于 HLS 播放
        sourceEnd: shot.sourceEnd,      // ★ 源视频位置（毫秒）
        transcript: shot.transcript,
        aspectRatio,
        assetId: shot.assetId, // ★ 素材 ID，用于播放
      } as ClipNodeData,
    }));
  }, [shots, NODE_WIDTH, aspectRatio]);

  // 创建连接边
  const initialEdges = useMemo((): Edge[] => {
    return shots.slice(0, -1).map((shot, index) => ({
      id: `edge-${shot.id}-${shots[index + 1].id}`,
      source: shot.id,
      target: shots[index + 1].id,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'smoothstep',
      animated: false,
      style: { stroke: '#94a3b8', strokeWidth: 2 },
    }));
  }, [shots]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);  // 初始为空，延迟设置

  // 当 shots 变化时，先更新节点，延迟设置边（等节点渲染完成）
  React.useEffect(() => {
    setNodes(initialNodes);
    // 延迟设置边，确保节点已渲染完成
    const timer = setTimeout(() => {
      setEdges(initialEdges);
    }, 100);
    return () => clearTimeout(timer);
  }, [shots, initialNodes, initialEdges, setNodes, setEdges]);

  // 节点点击处理
  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    setSelectedNodeId(node.id);
    setShowCapabilityPanel(true);
    
    // 通知父组件
    const shot = shots.find(s => s.id === node.id);
    onShotSelect?.(shot || null);
  }, [shots, onShotSelect]);

  // 画布空白区域点击
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setShowCapabilityPanel(false);
    onShotSelect?.(null);
  }, [onShotSelect]);

  // 获取选中的 Clip 数据
  const selectedClipData = useMemo((): ClipNodeData | null => {
    if (!selectedNodeId) return null;
    const node = nodes.find(n => n.id === selectedNodeId);
    return (node?.data as ClipNodeData) || null;
  }, [selectedNodeId, nodes]);

  // AI 能力选择处理
  const handleSelectCapability = useCallback((capability: AICapability) => {
    console.log('选择 AI 能力:', capability.id, '应用到 Clip:', selectedNodeId);
    
    // 需要配置的能力，打开关键帧编辑器
    if (capability.requiresConfig) {
      setSelectedCapability(capability);
      setShowKeyframeEditor(true);
      setShowCapabilityPanel(false);
    } else {
      // 不需要配置的能力，直接执行
      alert(`即将直接执行: ${capability.name}`);
    }
  }, [selectedNodeId]);

  // 关键帧编辑器生成预览处理
  const handleGenerate = useCallback(async (params: GenerateParams): Promise<GenerateResult> => {
    console.log('生成预览参数:', params);
    
    // ★ 治本：获取 session token 用于鉴权
    const session = await getSessionSafe();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    
    // 调用后端 API 生成预览
    const response = await fetch('/api/ai-capabilities/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        capability_type: params.capabilityId,
        clip_id: params.clipId,
        session_id: sessionId,
        prompt: params.prompt,
        keyframe_url: params.keyframeUrl,
        mask_data_url: params.maskDataUrl,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '预览生成失败');
    }
    
    const task = await response.json();
    console.log('预览任务已创建:', task);
    
    const taskId = task.id;
    
    // 轮询等待任务完成
    const maxWaitTime = 120000; // 2 分钟超时
    const pollInterval = 2000; // 2 秒轮询一次
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // 查询任务状态（复用相同的 headers）
      const statusResponse = await fetch(`/api/ai-capabilities/tasks/${taskId}`, { headers });
      if (!statusResponse.ok) {
        throw new Error('查询任务状态失败');
      }
      
      const taskStatus = await statusResponse.json();
      console.log('任务状态:', taskStatus.status, taskStatus.result_url);
      
      if (taskStatus.status === 'completed' && taskStatus.result_url) {
        // ★ 返回意图信息给前端显示
        return {
          previewUrl: taskStatus.result_url,
          taskId: taskId,
          intent: taskStatus.intent,  // ★ 新增：意图分类信息
        };
      }
      
      if (taskStatus.status === 'failed') {
        throw new Error(taskStatus.error || 'AI 生成失败');
      }
    }
    
    throw new Error('生成超时，请重试');
  }, [sessionId]);

  // 确认应用处理 - ★ 治标治本：所有能力统一走异步流程
  const handleConfirm = useCallback(async (params: ConfirmParams): Promise<void> => {
    console.log('[WorkflowCanvas] 确认应用参数:', params);
    
    if (!params.taskId) {
      throw new Error('缺少任务 ID，无法应用预览结果');
    }

    const taskType = selectedCapability?.id || 'unknown';
    const isBackgroundReplace = taskType === 'background-replace';
    
    // ★ 治本：在关闭弹窗前保存需要的数据（避免闭包问题）
    const clipData = selectedClipData;
    const currentSessionId = sessionId;
    const currentProjectId = projectId;
    
    // ★ 核心：先关闭弹窗，再异步执行任务（用户体验优先）
    setShowKeyframeEditor(false);
    setSelectedCapability(null);
    
    // ★ 乐观更新 - 立即在侧边栏显示任务
    const optimisticTaskId = params.taskId || `optimistic-${Date.now()}`;
    console.log('[WorkflowCanvas] ★ 添加乐观任务:', optimisticTaskId, '类型:', taskType);
    addOptimisticTask({
      id: optimisticTaskId,
      task_type: taskType.replace(/-/g, '_'),  // 转换为下划线格式
      status: 'pending',
      progress: 0,
      status_message: '正在处理...',
      clip_id: params.clipId,
      project_id: projectId,
    });
    
    // ★ 立即打开侧边栏显示任务进度
    console.log('[WorkflowCanvas] ★ 打开侧边栏');
    openTaskHistory();

    // 后台异步执行任务（不阻塞UI）- 使用已保存的变量
    (async () => {
      try {
        if (isBackgroundReplace) {
          // 背景替换专用工作流
          console.log('[WorkflowCanvas] 启动背景替换 Agent Workflow');
          
          const videoUrl = clipData?.assetId 
            ? `${process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:8000'}/api/assets/${clipData.assetId}/video`
            : '';
          
          if (!videoUrl) {
            throw new Error('无法获取视频 URL');
          }

          await backgroundWorkflow.startWorkflow({
            sessionId: currentSessionId,
            clipId: params.clipId,
            projectId: currentProjectId,
            videoUrl,
            backgroundImageUrl: params.previewUrl,
            originalPrompt: params.prompt,
            previewImageUrl: params.previewUrl,
          });
        } else {
          // 其他能力：调用 apply API
          const applySession = await getSessionSafe();
          const applyHeaders: HeadersInit = {
            'Content-Type': 'application/json',
          };
          if (applySession?.access_token) {
            applyHeaders['Authorization'] = `Bearer ${applySession.access_token}`;
          }
          
          const response = await fetch(`/api/ai-capabilities/tasks/${params.taskId}/apply`, {
            method: 'POST',
            headers: applyHeaders,
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '应用预览失败');
          }
          
          const task = await response.json();
          console.log('[WorkflowCanvas] 任务应用成功:', task);
          
          // 添加到 SSE 任务追踪
          addTask(task.id);
        }

        // 刷新任务列表获取真实状态
        if (currentProjectId) {
          setTimeout(() => fetchTasks(currentProjectId), 500);
        }
      } catch (error) {
        console.error('[WorkflowCanvas] 任务执行失败:', error);
        // 更新乐观任务为失败状态
        if (currentProjectId) {
          fetchTasks(currentProjectId);  // 刷新以获取真实状态
        }
      }
    })();

  }, [addTask, selectedCapability, selectedClipData, sessionId, projectId, backgroundWorkflow, openTaskHistory, fetchTasks, addOptimisticTask]);

  // 获取关键帧 URL（★ 优先使用 thumbnail，否则尝试其他来源）
  const getKeyframeUrl = useCallback(() => {
    // 1. 优先使用 clip 的 thumbnail
    if (selectedClipData?.thumbnail) {
      console.log('[WorkflowCanvas] 使用 clip thumbnail:', selectedClipData.thumbnail);
      return selectedClipData.thumbnail;
    }
    
    // 2. 尝试从 shots 获取
    const shot = shots.find(s => s.id === selectedNodeId);
    if (shot?.thumbnail) {
      console.log('[WorkflowCanvas] 使用 shot thumbnail:', shot.thumbnail);
      return shot.thumbnail;
    }
    
    // 3. 没有可用的关键帧
    console.warn('[WorkflowCanvas] 没有找到可用的关键帧 URL, clipData:', selectedClipData);
    return '';  // 返回空字符串，让 DrawingCanvas 显示错误状态
  }, [selectedClipData, shots, selectedNodeId]);

  return (
    <div className="relative w-full h-full bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{
          padding: 0.2,
          maxZoom: 1,
        }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
        proOptions={{ hideAttribution: true }}
      >
        {/* 背景网格 */}
        <Background 
          variant={BackgroundVariant.Dots} 
          gap={20} 
          size={1}
          color="#cbd5e1"
        />
        
        {/* 控制按钮 */}
        <Controls 
          showInteractive={false}
          className="!bg-white !border-gray-200 !shadow-lg !rounded-xl overflow-hidden"
        />
        
        {/* 小地图 */}
        <MiniMap 
          nodeColor={(node) => {
            if (node.id === selectedNodeId) return '#3b82f6';
            return '#e2e8f0';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          className="!bg-white !border-gray-200 !shadow-lg !rounded-xl"
        />
        
        {/* 顶部信息栏 */}
        <Panel position="top-left" className="!m-4">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg px-4 py-2 border border-gray-200">
            <span className="text-sm text-gray-600">
              分镜时间轴 · <span className="font-medium text-gray-800">{shots.length} 个分镜</span>
            </span>
          </div>
        </Panel>
      </ReactFlow>
      
      {/* AI 能力面板 */}
      {showCapabilityPanel && (
        <AICapabilityPanel
          selectedClip={selectedClipData}
          onClose={() => setShowCapabilityPanel(false)}
          onSelectCapability={handleSelectCapability}
        />
      )}

      {/* 关键帧编辑器 */}
      {showKeyframeEditor && selectedCapability && selectedClipData && (
        <KeyframeEditor
          clip={selectedClipData}
          capability={selectedCapability}
          keyframeUrl={getKeyframeUrl()}
          onClose={() => {
            setShowKeyframeEditor(false);
            setSelectedCapability(null);
          }}
          onGenerate={handleGenerate}
          onConfirm={handleConfirm}
        />
      )}

      {/* ★ 背景替换工作流进度 */}
      {backgroundWorkflow.state.isActive && backgroundWorkflow.state.workflowId && (
        <BackgroundReplaceProgress
          workflowId={backgroundWorkflow.state.workflowId}
          sessionId={sessionId}
          onComplete={(resultUrl) => {
            console.log('[WorkflowCanvas] 背景替换完成:', resultUrl);
            // TODO: 更新 clip 的视频 URL
            backgroundWorkflow.reset();
          }}
          onError={(error) => {
            console.error('[WorkflowCanvas] 背景替换失败:', error);
          }}
          onClose={() => {
            backgroundWorkflow.reset();
          }}
        />
      )}

      {/* ★ TaskProgressPanel 已废弃，改用 TaskHistorySidebar 展示任务进度 */}
    </div>
  );
}
