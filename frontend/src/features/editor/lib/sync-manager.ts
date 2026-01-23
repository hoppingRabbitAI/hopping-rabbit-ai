/**
 * HoppingRabbit AI - SyncManager
 * 毫秒级自动保存与离线同步管理器
 * 
 * 核心功能：
 * 1. 操作队列：收集用户操作，批量发送
 * 2. 防抖保存：300ms 防抖，避免频繁请求
 * 3. IndexedDB 缓存：离线状态下保存到本地
 * 4. 版本冲突处理：乐观锁机制
 * 5. 自动重连：网络恢复后自动同步
 */

import { projectApi, SaveStateResponse, VersionConflictError } from '@/lib/api';
import { Timeline, TranscriptSegment, Track, Clip, Keyframe } from '../types';

// ============================================
// 类型定义
// ============================================

/**
 * 状态快照 - 用于构建同步 payload
 */
export interface StateSnapshot {
  tracks: Track[];
  clips: Clip[];
  /** 关键帧数据：Map<clipId, Map<property, Keyframe[]>> 转为数组 */
  keyframes: Keyframe[];
}

/**
 * 获取状态回调函数类型
 */
export type GetStateCallback = () => StateSnapshot;

export type OperationType = 
  | 'ADD_TRACK' 
  | 'REMOVE_TRACK' 
  | 'UPDATE_TRACK'
  | 'ADD_CLIP' 
  | 'REMOVE_CLIP' 
  | 'UPDATE_CLIP' 
  | 'MOVE_CLIP'
  | 'SPLIT_CLIP' 
  | 'UPDATE_SEGMENT' 
  | 'BATCH_UPDATE'
  | 'ADD_KEYFRAME'
  | 'UPDATE_KEYFRAME'
  | 'DELETE_KEYFRAME';

export interface Operation {
  type: OperationType;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface SyncState {
  projectId: string;
  version: number;
  timeline: Timeline;
  segments: TranscriptSegment[];
  pendingOperations: Operation[];
  lastSyncedAt: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'conflict' | 'error';

export interface SyncManagerOptions {
  debounceMs?: number;
  maxBatchSize?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  /** 获取当前状态的回调，用于构建同步 payload */
  getState?: GetStateCallback;
  onStatusChange?: (status: SyncStatus) => void;
  onVersionConflict?: (serverVersion: number) => void;
  onError?: (error: Error) => void;
  onSynced?: (version: number) => void;
}

// ============================================
// 调试开关
// ============================================
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[SyncManager]', ...args); };
const debugWarn = (...args: unknown[]) => { if (DEBUG_ENABLED) console.warn('[SyncManager]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[SyncManager]', ...args); };

// ============================================
// IndexedDB 存储
// ============================================

const DB_NAME = 'hoppingrabbit_sync';
const DB_VERSION = 1;
const STORE_NAME = 'sync_state';

class IndexedDBStorage {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
        }
      };
    });
  }

  async get(projectId: string): Promise<SyncState | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(projectId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async set(state: SyncState): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(state);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(projectId: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(projectId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

// ============================================
// SyncManager 主类
// ============================================

export class SyncManager {
  private projectId: string;
  private version: number;
  private pendingOperations: Operation[] = [];
  private storage: IndexedDBStorage;
  private options: Required<Omit<SyncManagerOptions, 'getState'>>;
  private getState?: GetStateCallback;
  private status: SyncStatus = 'idle';
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;
  private isOnline = true;
  private isDestroyed = false;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastErrorTime = 0;
  private consecutiveErrors = 0;
  private static readonly ERROR_COOLDOWN_MS = 30000; // 连续错误后冷却 30 秒
  private static readonly MAX_CONSECUTIVE_ERRORS = 5; // 最多连续 5 次错误后停止

  constructor(projectId: string, initialVersion: number, options: SyncManagerOptions = {}) {
    this.projectId = projectId;
    this.version = initialVersion;
    this.storage = new IndexedDBStorage();
    
    // 保存 getState 回调
    this.getState = options.getState;
    
    this.options = {
      debounceMs: options.debounceMs ?? 300,
      maxBatchSize: options.maxBatchSize ?? 100,
      retryAttempts: options.retryAttempts ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      onStatusChange: options.onStatusChange ?? (() => {}),
      onVersionConflict: options.onVersionConflict ?? (() => {}),
      onError: options.onError ?? (() => {}),
      onSynced: options.onSynced ?? (() => {}),
    };

    // 监听网络状态
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      this.isOnline = navigator.onLine;
    }

    // 初始化存储并恢复未同步的操作
    this.init();
  }

  private async init(): Promise<void> {
    try {
      await this.storage.init();
      
      // 检查是否有未同步的操作
      const cached = await this.storage.get(this.projectId);
      if (cached && cached.pendingOperations.length > 0) {
        debugLog(`恢复 ${cached.pendingOperations.length} 个未同步操作`);
        this.pendingOperations = cached.pendingOperations;
        this.version = cached.version;
        
        // 尝试同步
        if (this.isOnline) {
          this.scheduleSync();
        }
      }
    } catch (error) {
      debugError('初始化失败:', error);
    }
  }

  // ============================================
  // 公共方法
  // ============================================

  /**
   * 添加操作到队列
   */
  addOperation(type: OperationType, payload: Record<string, unknown>): void {
    const operation: Operation = {
      type,
      timestamp: Date.now(),
      payload,
    };

    this.pendingOperations.push(operation);

    // 持久化到 IndexedDB
    this.persistState();

    // 触发防抖同步
    this.scheduleSync();
  }

  /**
   * 批量添加操作
   */
  addOperations(operations: Array<{ type: OperationType; payload: Record<string, unknown> }>): void {
    const timestamp = Date.now();
    
    for (const op of operations) {
      this.pendingOperations.push({
        type: op.type,
        timestamp,
        payload: op.payload,
      });
    }

    this.persistState();
    this.scheduleSync();
  }

  /**
   * 全量保存（用于重大操作或手动保存）
   */
  async saveFullState(timeline: Timeline, segments: TranscriptSegment[]): Promise<boolean> {
    if (!this.isOnline) {
      // 离线模式：保存到本地
      await this.storage.set({
        projectId: this.projectId,
        version: this.version,
        timeline,
        segments,
        pendingOperations: [],
        lastSyncedAt: Date.now(),
      });
      return false;
    }

    try {
      this.setStatus('syncing');

      const response = await projectApi.saveProjectState(this.projectId, {
        version: this.version,
        changes: {
          tracks: timeline.tracks,
          clips: timeline.clips,
        },
      });

      if (response.error) {
        const errorData = response.error as unknown as { error?: string };
        if (errorData.error === 'version_conflict') {
          this.handleVersionConflict(response.error as unknown as VersionConflictError);
          return false;
        }
        throw new Error(response.error.message);
      }

      const result = response.data as SaveStateResponse;
      this.version = result.new_version;
      this.pendingOperations = [];
      
      // 清除本地缓存
      await this.storage.delete(this.projectId);

      this.setStatus('idle');
      this.options.onSynced(this.version);
      
      return true;
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }

  /**
   * 强制同步（跳过防抖）
   */
  async forceSync(): Promise<boolean> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    return this.sync();
  }

  /**
   * 获取当前版本
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * 获取待同步操作数量
   */
  getPendingCount(): number {
    return this.pendingOperations.length;
  }

  /**
   * 获取当前状态
   */
  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * 更新版本号（用于外部同步）
   */
  setVersion(version: number): void {
    this.version = version;
  }

  /**
   * 清理并销毁
   */
  destroy(): void {
    this.isDestroyed = true;
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }
  
  /**
   * 重置错误状态（用于用户手动重试）
   */
  resetErrorState(): void {
    this.consecutiveErrors = 0;
    this.retryCount = 0;
    this.lastErrorTime = 0;
    if (this.status === 'error') {
      this.setStatus('idle');
    }
  }
  
  /**
   * 手动重试同步（用于用户触发）
   */
  async manualRetry(): Promise<boolean> {
    this.resetErrorState();
    return this.forceSync();
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 构建同步 payload - 转换为后端期望的 changes 格式
   */
  private buildChangesPayload(): { tracks: Track[]; clips: Clip[]; keyframes: Keyframe[] } | null {
    if (!this.getState) {
      debugWarn('getState 未配置，无法构建 changes payload');
      return null;
    }
    
    try {
      const state = this.getState();
      return {
        tracks: state.tracks,
        clips: state.clips,
        keyframes: state.keyframes,
      };
    } catch (error) {
      debugError('获取状态失败:', error);
      return null;
    }
  }

  private scheduleSync(): void {
    // 如果已销毁或在冷却期，不调度新的同步
    if (this.isDestroyed) return;
    
    // 检查是否在错误冷却期
    if (this.consecutiveErrors >= SyncManager.MAX_CONSECUTIVE_ERRORS) {
      const timeSinceLastError = Date.now() - this.lastErrorTime;
      if (timeSinceLastError < SyncManager.ERROR_COOLDOWN_MS) {
        debugLog(`在错误冷却期，${Math.ceil((SyncManager.ERROR_COOLDOWN_MS - timeSinceLastError) / 1000)}s 后可重试`);
        return;
      } else {
        // 冷却期过后重置错误计数
        this.consecutiveErrors = 0;
      }
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.sync();
    }, this.options.debounceMs);
  }

  private async sync(): Promise<boolean> {
    // 检查是否应该停止同步
    if (this.isDestroyed) return false;
    
    // 检查是否有待同步的操作
    if (this.isSyncing || this.pendingOperations.length === 0) {
      return true;
    }

    if (!this.isOnline) {
      this.setStatus('offline');
      return false;
    }
    
    // 检查连续错误次数
    if (this.consecutiveErrors >= SyncManager.MAX_CONSECUTIVE_ERRORS) {
      debugWarn(`连续 ${this.consecutiveErrors} 次错误，停止自动同步。请手动重试。`);
      return false;
    }

    this.isSyncing = true;
    this.setStatus('syncing');

    try {
      // 构建 changes payload
      const changes = this.buildChangesPayload();
      
      if (!changes) {
        debugError('无法构建 changes payload，跳过同步');
        this.isSyncing = false;
        this.setStatus('error');
        return false;
      }

      // 记录本次同步的操作数量
      const syncedOperationsCount = this.pendingOperations.length;
      
      debugLog(`同步中: ${syncedOperationsCount} 个操作, 版本 ${this.version}`);

      const response = await projectApi.saveProjectState(this.projectId, {
        version: this.version,
        changes: changes,
      });

      if (response.error) {
        const errorData = response.error as unknown as { error?: string };
        if (errorData.error === 'version_conflict') {
          this.handleVersionConflict(response.error as unknown as VersionConflictError);
          return false;
        }
        throw new Error(response.error.message);
      }

      const result = response.data as SaveStateResponse;

      // 更新版本并清除已同步的操作
      this.version = result.new_version;
      this.pendingOperations = []; // 全量同步，清空所有操作
      
      // 同步成功，重置错误计数
      this.consecutiveErrors = 0;
      this.retryCount = 0;
      
      debugLog(`同步成功: 新版本 ${this.version}`);

      // 清除本地缓存
      await this.storage.delete(this.projectId);

      this.setStatus('idle');
      this.options.onSynced(this.version);
      
      return true;
    } catch (error) {
      this.handleError(error as Error);
      return false;
    } finally {
      this.isSyncing = false;
    }
  }

  private async persistState(): Promise<void> {
    try {
      await this.storage.set({
        projectId: this.projectId,
        version: this.version,
        timeline: {} as Timeline, // 增量模式不需要完整数据
        segments: [],
        pendingOperations: this.pendingOperations,
        lastSyncedAt: Date.now(),
      });
    } catch (error) {
      debugError('持久化失败:', error);
    }
  }

  private setStatus(status: SyncStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatusChange(status);
    }
  }

  private handleVersionConflict(error: VersionConflictError): void {
    debugWarn('版本冲突:', error);
    this.setStatus('conflict');
    this.options.onVersionConflict(error.server_version);
  }

  private handleError(error: Error): void {
    debugError('同步错误:', error);
    this.consecutiveErrors++;
    this.lastErrorTime = Date.now();
    this.setStatus('error');
    this.options.onError(error);

    // 只在错误次数未超限时重试
    if (this.consecutiveErrors < SyncManager.MAX_CONSECUTIVE_ERRORS) {
      this.retryWithBackoff();
    } else {
      debugWarn(`连续 ${this.consecutiveErrors} 次错误，停止自动重试。用户可调用 manualRetry() 手动重试。`);
    }
  }

  private async retryWithBackoff(attempt = 1): Promise<void> {
    // 检查是否应该停止
    if (this.isDestroyed) return;
    if (attempt > this.options.retryAttempts) {
      debugError('重试次数已用尽');
      return;
    }
    if (this.consecutiveErrors >= SyncManager.MAX_CONSECUTIVE_ERRORS) {
      debugWarn('错误次数过多，停止重试');
      return;
    }

    const delay = this.options.retryDelayMs * Math.pow(2, attempt - 1);
    debugLog(`${delay}ms 后重试 (${attempt}/${this.options.retryAttempts})`);

    // 清除之前的重试定时器
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    this.retryTimer = setTimeout(async () => {
      if (this.isDestroyed) return;
      
      if (this.isOnline && this.pendingOperations.length > 0) {
        this.retryCount = attempt;
        const success = await this.sync();
        if (!success && attempt < this.options.retryAttempts && !this.isDestroyed) {
          // 不再递归调用，让下次 sync 失败时自然触发 handleError
        }
      }
    }, delay);
  }

  private handleOnline = (): void => {
    debugLog('网络已恢复');
    this.isOnline = true;

    if (this.pendingOperations.length > 0) {
      this.scheduleSync();
    } else {
      this.setStatus('idle');
    }
  };

  private handleOffline = (): void => {
    debugLog('网络已断开');
    this.isOnline = false;
    this.setStatus('offline');
  };
}

// ============================================
// React Hook
// ============================================

import { useEffect, useState, useCallback, useRef } from 'react';

export interface UseSyncManagerResult {
  syncManager: SyncManager | null;
  status: SyncStatus;
  pendingCount: number;
  version: number;
  addOperation: (type: OperationType, payload: Record<string, unknown>) => void;
  saveFullState: (timeline: Timeline, segments: TranscriptSegment[]) => Promise<boolean>;
  forceSync: () => Promise<boolean>;
}

export function useSyncManager(
  projectId: string | null,
  initialVersion: number = 1,
  options: SyncManagerOptions = {}
): UseSyncManagerResult {
  const [syncManager, setSyncManager] = useState<SyncManager | null>(null);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [version, setVersion] = useState(initialVersion);
  
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!projectId) {
      setSyncManager(null);
      return;
    }

    const manager = new SyncManager(projectId, initialVersion, {
      ...optionsRef.current,
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
        optionsRef.current.onStatusChange?.(newStatus);
      },
      onSynced: (newVersion) => {
        setVersion(newVersion);
        setPendingCount(manager.getPendingCount());
        optionsRef.current.onSynced?.(newVersion);
      },
      onVersionConflict: (serverVersion) => {
        optionsRef.current.onVersionConflict?.(serverVersion);
      },
      onError: (error) => {
        optionsRef.current.onError?.(error);
      },
    });

    setSyncManager(manager);

    return () => {
      manager.destroy();
    };
  }, [projectId, initialVersion]);

  const addOperation = useCallback(
    (type: OperationType, payload: Record<string, unknown>) => {
      if (syncManager) {
        syncManager.addOperation(type, payload);
        setPendingCount(syncManager.getPendingCount());
      }
    },
    [syncManager]
  );

  const saveFullState = useCallback(
    async (timeline: Timeline, segments: TranscriptSegment[]) => {
      if (syncManager) {
        const result = await syncManager.saveFullState(timeline, segments);
        setPendingCount(syncManager.getPendingCount());
        return result;
      }
      return false;
    },
    [syncManager]
  );

  const forceSync = useCallback(async () => {
    if (syncManager) {
      const result = await syncManager.forceSync();
      setPendingCount(syncManager.getPendingCount());
      return result;
    }
    return false;
  }, [syncManager]);

  return {
    syncManager,
    status,
    pendingCount,
    version,
    addOperation,
    saveFullState,
    forceSync,
  };
}

export default SyncManager;
