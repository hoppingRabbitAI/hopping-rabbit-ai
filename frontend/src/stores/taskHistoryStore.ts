import { create } from 'zustand';
import { authFetch } from '@/lib/supabase/session';

// ============================================
// 类型定义
// ============================================

export interface TaskHistoryItem {
  id: string;
  task_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  status_message?: string;
  error_message?: string;
  output_url?: string;
  output_asset_id?: string;
  input_params?: Record<string, unknown>;
  result_metadata?: Record<string, unknown>;
  asset_id?: string;
  clip_id?: string;
  project_id?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface TaskHistoryFilter {
  status?: string;
  taskType?: string;
}

// ============================================
// 任务类型配置
// ============================================

export const TASK_TYPE_LABELS: Record<string, string> = {
  'background_replace': '视频生成',  // ★ 更明确的描述
  'lip_sync': '口型同步',
  'text_to_video': '文生视频',
  'image_to_video': '图生视频',
  'multi_image_to_video': '多图生视频',
  'motion_control': '动作控制',
  'video_extend': '视频延长',
  'image_generation': '图片生成',
  'omni_image': '图像编辑',
  'face_swap': '换脸',
  'voice_enhance': '声音优化',
  'style_transfer': '风格迁移',
  'asr': '语音转文字',
  'stem_separation': '人声分离',
  'smart_clean': '智能清理',
  'extract_audio': '音频提取',
};

export const TASK_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  'pending': { label: '排队中', color: 'text-gray-500' },
  'processing': { label: '处理中', color: 'text-blue-500' },
  'completed': { label: '已完成', color: 'text-green-500' },
  'failed': { label: '失败', color: 'text-red-500' },
  'cancelled': { label: '已取消', color: 'text-gray-400' },
};

// ============================================
// Store 定义
// ============================================

interface TaskHistoryState {
  // 状态
  isOpen: boolean;
  tasks: TaskHistoryItem[];
  isLoading: boolean;
  error: string | null;
  filter: TaskHistoryFilter;
  processingCount: number;
  
  // Actions
  toggle: () => void;
  open: () => void;
  close: () => void;
  fetch: (projectId: string) => Promise<void>;
  setFilter: (filter: Partial<TaskHistoryFilter>) => void;
  updateTask: (taskId: string, updates: Partial<TaskHistoryItem>) => void;
  // ★ 治本：乐观更新 - 立即添加任务到列表
  addOptimisticTask: (task: Partial<TaskHistoryItem>) => void;
}

export const useTaskHistoryStore = create<TaskHistoryState>((set, get) => ({
  // 初始状态
  isOpen: false,
  tasks: [],
  isLoading: false,
  error: null,
  filter: {},
  processingCount: 0,
  
  // 切换侧边栏
  toggle: () => set(state => ({ isOpen: !state.isOpen })),
  
  // 打开侧边栏
  open: () => set({ isOpen: true }),
  
  // 关闭侧边栏
  close: () => set({ isOpen: false }),
  
  // 获取任务列表
  fetch: async (projectId: string) => {
    set({ isLoading: true, error: null });
    
    try {
      const params = new URLSearchParams();
      if (projectId) params.set('project_id', projectId);
      params.set('limit', '50');
      
      const { filter } = get();
      if (filter.status) params.set('status', filter.status);
      
      const response = await authFetch(`/api/tasks?${params.toString()}`);
      const data = await response.json();
      
      const tasks = data.tasks || [];
      const processingCount = tasks.filter(
        (t: TaskHistoryItem) => t.status === 'pending' || t.status === 'processing'
      ).length;
      
      set({ tasks, processingCount, isLoading: false });
    } catch (error) {
      console.error('[TaskHistory] 获取任务失败:', error);
      set({ 
        error: error instanceof Error ? error.message : '获取任务失败', 
        isLoading: false 
      });
    }
  },
  
  // 设置筛选条件
  setFilter: (filter) => set(state => ({ 
    filter: { ...state.filter, ...filter } 
  })),
  
  // 更新单个任务
  updateTask: (taskId, updates) => set(state => ({
    tasks: state.tasks.map(t => 
      t.id === taskId ? { ...t, ...updates } : t
    ),
    processingCount: state.tasks.filter(
      t => (t.id === taskId ? updates.status : t.status) === 'pending' || 
           (t.id === taskId ? updates.status : t.status) === 'processing'
    ).length,
  })),
  
  // ★ 治本：乐观更新 - 立即添加任务到列表顶部
  addOptimisticTask: (task) => set(state => {
    const newTask: TaskHistoryItem = {
      id: task.id || `optimistic-${Date.now()}`,
      task_type: task.task_type || 'background_replace',
      status: 'pending',
      progress: 0,
      status_message: '正在创建任务...',
      created_at: new Date().toISOString(),
      ...task,
    };
    
    // 避免重复添加
    const exists = state.tasks.some(t => t.id === newTask.id);
    if (exists) return state;
    
    return {
      tasks: [newTask, ...state.tasks],
      processingCount: state.processingCount + 1,
    };
  }),
}));
