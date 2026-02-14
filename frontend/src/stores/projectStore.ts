import { create } from 'zustand';
import { projectApi } from '../lib/api/projects';
import { API_BASE_URL, getAuthToken } from '../lib/api/client';

/** 简单的认证 fetch */
async function authFetch(path: string, init: RequestInit = {}) {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string> || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

export interface ProjectRecord {
  id: string;
  name: string;
  duration?: number;
  thumbnailUrl?: string;
  thumbnailAssetId?: string;  // 用于动态加载封面的 asset ID
  updatedAt: string;
  createdAt?: string;  // 创建时间
  status?: 'processing' | 'completed' | 'archived';  // 项目状态
}

interface ProjectStoreState {
  projects: ProjectRecord[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean; // 标记是否已获取过
  
  // Actions
  fetchProjects: (force?: boolean) => Promise<void>;
  addProject: (project: ProjectRecord) => void;
  updateProject: (id: string, updates: Partial<ProjectRecord>) => void;
  removeProject: (id: string) => Promise<void>;
  removeProjects: (ids: string[]) => Promise<{ success: number; failed: number }>;
  archiveProject: (id: string) => Promise<void>;
  getProject: (id: string) => ProjectRecord | undefined;
}

export const useProjectStore = create<ProjectStoreState>()((set, get) => ({
  projects: [],
  loading: false,
  error: null,
  hasFetched: false,
  
  fetchProjects: async (force = false) => {
    // 防止重复请求（但允许强制刷新）
    if (get().loading) return;
    if (!force && get().hasFetched) return;
    
    set({ loading: true, error: null });
    try {
      const response = await projectApi.getProjects({ limit: 50 });
      if (response.error || !response.data) {
        throw new Error(response.error?.message || '获取项目列表失败');
      }
      const items = (response.data as any).items ?? (Array.isArray(response.data) ? response.data : []);
      const projects: ProjectRecord[] = items.map((item: any) => ({
        id: item.id,
        name: item.name,
        duration: item.duration,
        thumbnailUrl: item.thumbnail_url,
        thumbnailAssetId: item.thumbnail_asset_id,
        updatedAt: item.updated_at,
      }));
      set({ projects, loading: false, hasFetched: true });
    } catch (error) {
      debugError('获取项目列表失败:', error);
      set({ 
        error: error instanceof Error ? error.message : '获取项目列表失败', 
        loading: false 
      });
    }
  },
  
  addProject: (project) => {
    set((state) => ({
      projects: [project, ...state.projects],
    }));
  },
  
  updateProject: (id, updates) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id 
          ? { ...p, ...updates, updatedAt: new Date().toISOString() } 
          : p
      ),
    }));
  },
  
  removeProject: async (id) => {
    try {
      await projectApi.deleteProject(id);
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
      }));
    } catch (error) {
      debugError('删除项目失败:', error);
      throw error;
    }
  },
  
  removeProjects: async (ids) => {
    try {
      const result = await authFetch('/projects/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ project_ids: ids }),
      });
      // 从列表中移除成功删除的项目
      const successIds = (result.results || [])
        .filter((r: any) => r.success)
        .map((r: any) => r.id);
      
      set((state) => ({
        projects: state.projects.filter((p) => !successIds.includes(p.id)),
      }));
      
      return { success: result.success_count, failed: result.fail_count };
    } catch (error) {
      debugError('批量删除项目失败:', error);
      throw error;
    }
  },
  
  archiveProject: async (id) => {
    try {
      await projectApi.updateProject(id, { status: 'archived' });
      get().updateProject(id, { status: 'archived' });
    } catch (error) {
      debugError('归档项目失败:', error);
    }
  },
  
  getProject: (id) => {
    return get().projects.find((p) => p.id === id);
  },
}));
