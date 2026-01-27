/**
 * Toast 通知状态管理
 * 用于全局显示通知消息，替代浏览器原生 alert
 */
import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;  // 自动关闭时间（毫秒），默认 4000
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearAllToasts: () => void;
}

// 生成唯一 ID
const generateId = () => `toast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  
  addToast: (toast) => {
    const id = generateId();
    const newToast: Toast = {
      id,
      duration: 4000, // 默认 4 秒
      ...toast,
    };
    
    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));
  },
  
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
  
  clearAllToasts: () => {
    set({ toasts: [] });
  },
}));

// 便捷方法，可以直接导入使用
export const toast = {
  success: (message: string, duration?: number) => {
    useToastStore.getState().addToast({ type: 'success', message, duration });
  },
  error: (message: string, duration?: number) => {
    useToastStore.getState().addToast({ type: 'error', message, duration: duration ?? 6000 });
  },
  warning: (message: string, duration?: number) => {
    useToastStore.getState().addToast({ type: 'warning', message, duration });
  },
  info: (message: string, duration?: number) => {
    useToastStore.getState().addToast({ type: 'info', message, duration });
  },
};
