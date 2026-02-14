/**
 * AI 能力任务进度 Hook
 * 使用 SSE 接收实时任务更新
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface TaskEvent {
  task_id: string;
  session_id: string;
  event_type: 'progress' | 'completed' | 'failed' | 'connected' | 'heartbeat';
  status: string;
  progress: number;
  message?: string;
  result_url?: string;
  error?: string;
  timestamp?: string;
}

export interface Task {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  message?: string;
  resultUrl?: string;
  error?: string;
}

interface UseTaskProgressOptions {
  /** SSE 订阅标识（通常传入 projectId） */
  subscriberId: string;
  onTaskComplete?: (taskId: string, resultUrl?: string) => void;
  onTaskFailed?: (taskId: string, error: string) => void;
}

export function useTaskProgress({ subscriberId, onTaskComplete, onTaskFailed }: UseTaskProgressOptions) {
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 用 ref 存储回调，避免 useEffect 依赖变化
  const onTaskCompleteRef = useRef(onTaskComplete);
  const onTaskFailedRef = useRef(onTaskFailed);
  
  // 更新 ref
  useEffect(() => {
    onTaskCompleteRef.current = onTaskComplete;
    onTaskFailedRef.current = onTaskFailed;
  }, [onTaskComplete, onTaskFailed]);

  // 连接 SSE - 只在 subscriberId 变化时重新连接
  useEffect(() => {
    if (!subscriberId) return;
    
    // 关闭现有连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    let isMounted = true;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    const connect = () => {
      if (!isMounted) return;
      
      // SSE 需要直接连接后端，不能通过 Next.js 代理
      // NEXT_PUBLIC_API_URL 可能包含 /api，需要去掉后再添加正确路径
      let backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      backendUrl = backendUrl.replace(/\/api\/?$/, ''); // 去掉末尾的 /api
      const eventSource = new EventSource(`${backendUrl}/api/ai-capabilities/events/${subscriberId}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[SSE] 连接已建立');
        setIsConnected(true);
        reconnectAttempts = 0;
      };

      eventSource.onerror = (error) => {
        console.error('[SSE] 连接错误:', error);
        setIsConnected(false);
        eventSource.close();
        
        // 限制重连次数
        if (isMounted && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = Math.min(3000 * reconnectAttempts, 15000);
          console.log(`[SSE] ${delay/1000}s 后尝试重连 (${reconnectAttempts}/${maxReconnectAttempts})...`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          console.warn('[SSE] 达到最大重连次数，停止重连');
        }
      };
      
      // 处理事件的内部函数
      const handleTaskEvent = (event: TaskEvent) => {
        setTasks((prev) => {
          const newTasks = new Map(prev);
          const existing = newTasks.get(event.task_id);
          
          newTasks.set(event.task_id, {
            id: event.task_id,
            status: event.status as Task['status'],
            progress: event.progress,
            message: event.message || existing?.message,
            resultUrl: event.result_url || existing?.resultUrl,
            error: event.error || existing?.error,
          });
          
          return newTasks;
        });

        // 触发回调 - 使用 ref 获取最新的回调函数
        if (event.event_type === 'completed') {
          onTaskCompleteRef.current?.(event.task_id, event.result_url);
        } else if (event.event_type === 'failed') {
          onTaskFailedRef.current?.(event.task_id, event.error || '未知错误');
        }
      };

      // 监听不同事件类型
      eventSource.addEventListener('connected', (e) => {
        console.log('[SSE] 连接确认:', e.data);
        setIsConnected(true);
      });

      eventSource.addEventListener('progress', (e) => {
        try {
          const event: TaskEvent = JSON.parse(e.data);
          console.log('[SSE] 进度更新:', event);
          handleTaskEvent(event);
        } catch (err) {
          console.error('[SSE] 解析进度事件失败:', err);
        }
      });

      eventSource.addEventListener('completed', (e) => {
        try {
          const event: TaskEvent = JSON.parse(e.data);
          console.log('[SSE] 任务完成:', event);
          handleTaskEvent(event);
        } catch (err) {
          console.error('[SSE] 解析完成事件失败:', err);
        }
      });

      eventSource.addEventListener('failed', (e) => {
        try {
          const event: TaskEvent = JSON.parse(e.data);
          console.log('[SSE] 任务失败:', event);
          handleTaskEvent(event);
        } catch (err) {
          console.error('[SSE] 解析失败事件失败:', err);
        }
      });

      eventSource.addEventListener('heartbeat', () => {
        // 心跳保持连接
      });
    };

    connect();
    
    return () => {
      isMounted = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [subscriberId]);

  // 添加新任务到追踪列表
  const addTask = useCallback((taskId: string) => {
    setTasks((prev) => {
      const newTasks = new Map(prev);
      newTasks.set(taskId, {
        id: taskId,
        status: 'pending',
        progress: 0,
      });
      return newTasks;
    });
  }, []);

  // 获取单个任务
  const getTask = useCallback((taskId: string) => {
    return tasks.get(taskId);
  }, [tasks]);

  // 清理完成的任务
  const clearCompletedTasks = useCallback(() => {
    setTasks((prev) => {
      const newTasks = new Map(prev);
      Array.from(newTasks.entries()).forEach(([id, task]) => {
        if (task.status === 'completed' || task.status === 'failed') {
          newTasks.delete(id);
        }
      });
      return newTasks;
    });
  }, []);

  return {
    tasks: Array.from(tasks.values()),
    isConnected,
    addTask,
    getTask,
    clearCompletedTasks,
  };
}
