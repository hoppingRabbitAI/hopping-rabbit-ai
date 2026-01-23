/**
 * HoppingRabbit AI - MediaCache
 * IndexedDB 媒体文件缓存层
 * 
 * 解决问题：
 * 1. URL.createObjectURL 刷新后失效
 * 2. 大文件上传期间可以预览
 * 3. 离线时仍可访问已缓存的媒体
 */

// ==================== 调试开关 ====================
// ★ 已关闭缩略图日志，视频缓冲日志在 VideoCanvasStore 中
const DEBUG_ENABLED = false;
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[MediaCache]', ...args); };
const debugWarn = (...args: unknown[]) => { if (DEBUG_ENABLED) console.warn('[MediaCache]', ...args); };
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error('[MediaCache]', ...args); };

// ============================================
// 类型定义
// ============================================

export interface CachedMedia {
  /** 唯一标识符 (可以是 clipId 或 assetId) */
  id: string;
  /** 项目 ID */
  projectId: string;
  /** 文件 Blob */
  blob: Blob;
  /** 文件名 */
  fileName: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小 (bytes) */
  size: number;
  /** 视频时长 (秒) */
  duration?: number;
  /** 缩略图 (base64) */
  thumbnail?: string;
  /** 云端 URL (上传完成后填充) */
  cloudUrl?: string;
  /** 云端 asset_id */
  assetId?: string;
  /** 上传状态 */
  uploadStatus: 'pending' | 'uploading' | 'uploaded' | 'failed';
  /** 上传进度 0-100 */
  uploadProgress: number;
  /** 创建时间 */
  createdAt: number;
  /** 最后访问时间 (用于 LRU 清理) */
  lastAccessedAt: number;
}

export interface MediaCacheOptions {
  /** 最大缓存大小 (bytes), 默认 2GB */
  maxCacheSize?: number;
  /** 单文件最大大小 (bytes), 默认 500MB */
  maxFileSize?: number;
  /** 缓存过期时间 (ms), 默认 7 天 */
  expireTime?: number;
}

// ============================================
// IndexedDB 配置
// ============================================

const DB_NAME = 'hoppingrabbit_media_cache';
const DB_VERSION = 1;
const STORE_NAME = 'media_files';
const META_STORE = 'cache_meta';

// ============================================
// MediaCache 类
// ============================================

class MediaCache {
  private db: IDBDatabase | null = null;
  private options: Required<MediaCacheOptions>;
  private objectUrls: Map<string, string> = new Map();
  private initPromise: Promise<void> | null = null;

  constructor(options: MediaCacheOptions = {}) {
    this.options = {
      maxCacheSize: options.maxCacheSize ?? 2 * 1024 * 1024 * 1024, // 2GB
      maxFileSize: options.maxFileSize ?? 500 * 1024 * 1024, // 500MB
      expireTime: options.expireTime ?? 7 * 24 * 60 * 60 * 1000, // 7 days
    };
  }

  // ============================================
  // 初始化
  // ============================================

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        debugWarn('IndexedDB not available');
        resolve();
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        debugError('Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        debugLog('Database opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 媒体文件存储
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
          store.createIndex('uploadStatus', 'uploadStatus', { unique: false });
          store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        }

        // 缓存元数据
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
    });

    return this.initPromise;
  }

  // ============================================
  // 核心方法
  // ============================================

  /**
   * 缓存媒体文件
   */
  async cacheMedia(
    id: string,
    projectId: string,
    file: File,
    metadata?: {
      duration?: number;
      thumbnail?: string;
    }
  ): Promise<CachedMedia> {
    await this.init();

    if (file.size > this.options.maxFileSize) {
      throw new Error(`文件太大，最大支持 ${this.options.maxFileSize / 1024 / 1024}MB`);
    }

    // 检查缓存空间
    await this.ensureCacheSpace(file.size);

    const now = Date.now();
    const cachedMedia: CachedMedia = {
      id,
      projectId,
      blob: file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      duration: metadata?.duration,
      thumbnail: metadata?.thumbnail,
      uploadStatus: 'pending',
      uploadProgress: 0,
      createdAt: now,
      lastAccessedAt: now,
    };

    await this.saveToStore(cachedMedia);
    debugLog(`Cached media: ${id} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

    return cachedMedia;
  }

  /**
   * 获取媒体文件的可用 URL
   * 优先返回云端 URL，否则返回本地 ObjectURL
   */
  async getMediaUrl(id: string): Promise<string | null> {
    await this.init();

    const cached = await this.getFromStore(id);
    if (!cached) return null;

    // 如果已上传到云端，返回云端 URL
    if (cached.cloudUrl) {
      return cached.cloudUrl;
    }

    // 否则返回本地 ObjectURL
    if (this.objectUrls.has(id)) {
      return this.objectUrls.get(id)!;
    }

    // 创建新的 ObjectURL
    const url = URL.createObjectURL(cached.blob);
    this.objectUrls.set(id, url);

    // 更新访问时间
    await this.updateAccessTime(id);

    return url;
  }

  /**
   * 获取缓存的媒体信息
   */
  async getMedia(id: string): Promise<CachedMedia | null> {
    await this.init();
    return this.getFromStore(id);
  }

  /**
   * 更新上传状态
   */
  async updateUploadStatus(
    id: string,
    status: CachedMedia['uploadStatus'],
    progress?: number,
    cloudData?: { cloudUrl: string; assetId: string }
  ): Promise<void> {
    await this.init();

    const cached = await this.getFromStore(id);
    if (!cached) return;

    cached.uploadStatus = status;
    if (progress !== undefined) {
      cached.uploadProgress = progress;
    }
    if (cloudData) {
      cached.cloudUrl = cloudData.cloudUrl;
      cached.assetId = cloudData.assetId;
    }

    await this.saveToStore(cached);
  }

  /**
   * 获取项目的所有待上传媒体
   */
  async getPendingUploads(projectId: string): Promise<CachedMedia[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const items = request.result as CachedMedia[];
        resolve(items.filter(item => 
          item.uploadStatus === 'pending' || item.uploadStatus === 'failed'
        ));
      };
    });
  }

  /**
   * 删除缓存的媒体
   */
  async deleteMedia(id: string): Promise<void> {
    await this.init();

    // 释放 ObjectURL
    const url = this.objectUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(id);
    }

    await this.deleteFromStore(id);
  }

  /**
   * 清理项目的所有缓存
   */
  async clearProjectCache(projectId: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    const transaction = this.db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('projectId');
    const request = index.getAllKeys(projectId);

    request.onsuccess = () => {
      const keys = request.result;
      keys.forEach(key => {
        store.delete(key);
        const url = this.objectUrls.get(key as string);
        if (url) {
          URL.revokeObjectURL(url);
          this.objectUrls.delete(key as string);
        }
      });
    };
  }

  /**
   * 清理过期缓存
   */
  async cleanupExpired(): Promise<number> {
    await this.init();
    if (!this.db) return 0;

    const expireThreshold = Date.now() - this.options.expireTime;
    let deletedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('lastAccessedAt');
      const range = IDBKeyRange.upperBound(expireThreshold);
      const request = index.openCursor(range);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const media = cursor.value as CachedMedia;
          // 只删除已上传的文件（保留未上传的）
          if (media.uploadStatus === 'uploaded') {
            cursor.delete();
            deletedCount++;
            
            const url = this.objectUrls.get(media.id);
            if (url) {
              URL.revokeObjectURL(url);
              this.objectUrls.delete(media.id);
            }
          }
          cursor.continue();
        } else {
          debugLog(`Cleaned up ${deletedCount} expired items`);
          resolve(deletedCount);
        }
      };
    });
  }

  // ============================================
  // 私有方法
  // ============================================

  private async saveToStore(media: CachedMedia): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(media);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private async getFromStore(id: string): Promise<CachedMedia | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  private async deleteFromStore(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private async updateAccessTime(id: string): Promise<void> {
    const cached = await this.getFromStore(id);
    if (cached) {
      cached.lastAccessedAt = Date.now();
      await this.saveToStore(cached);
    }
  }

  private async ensureCacheSpace(requiredSize: number): Promise<void> {
    if (!this.db) return;

    // 获取当前缓存大小
    const totalSize = await this.getTotalCacheSize();

    if (totalSize + requiredSize <= this.options.maxCacheSize) {
      return; // 空间足够
    }

    // 需要清理空间，按 LRU 策略删除
    const transaction = this.db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('lastAccessedAt');
    const request = index.openCursor();

    let freedSize = 0;
    const neededSize = totalSize + requiredSize - this.options.maxCacheSize;

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && freedSize < neededSize) {
        const media = cursor.value as CachedMedia;
        // 只删除已上传的
        if (media.uploadStatus === 'uploaded') {
          freedSize += media.size;
          cursor.delete();
          
          const url = this.objectUrls.get(media.id);
          if (url) {
            URL.revokeObjectURL(url);
            this.objectUrls.delete(media.id);
          }
        }
        cursor.continue();
      }
    };
  }

  private async getTotalCacheSize(): Promise<number> {
    if (!this.db) return 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const items = request.result as CachedMedia[];
        const totalSize = items.reduce((sum, item) => sum + item.size, 0);
        resolve(totalSize);
      };
    });
  }

  /**
   * 销毁实例，释放资源
   */
  destroy(): void {
    // 释放所有 ObjectURL
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls.clear();

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ============================================
// 导出单例
// ============================================

export const mediaCache = new MediaCache();

// ============================================
// 辅助函数
// ============================================

/**
 * 生成视频缩略图
 */
export function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration / 2);
    };

    video.onseeked = () => {
      canvas.width = 160;
      canvas.height = 90;
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
      URL.revokeObjectURL(video.src);
      resolve(thumbnail);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to generate thumbnail'));
    };

    video.src = URL.createObjectURL(file);
  });
}

/**
 * 从视频 URL 的指定时间点生成缩略图
 * 用于 clip 列表显示，每个 clip 取其 sourceStart 时间点的帧
 * 
 * @param videoUrl - 视频 URL
 * @param timeMs - 时间点（毫秒），默认为 0（首帧）
 * @param width - 缩略图宽度，默认 120
 * @param height - 缩略图高度，默认 68（保持 16:9）
 */
export function generateThumbnailFromUrl(
  videoUrl: string, 
  timeMs: number = 0,
  width: number = 120,
  height: number = 68
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    video.preload = 'auto'; // 改为 auto，确保能加载足够数据
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous'; // 支持跨域视频

    let isResolved = false;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.oncanplay = null;
      // 释放视频资源
      video.src = '';
      video.load();
    };

    // 超时处理（15秒，增加超时时间）
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        reject(new Error('Thumbnail generation timeout'));
      }
    }, 15000);

    const generateThumbnail = () => {
      if (isResolved) return;
      
      try {
        canvas.width = width;
        canvas.height = height;
        
        // 检查视频尺寸是否有效
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          debugWarn('Video dimensions not available yet');
          return; // 等待下一个事件
        }
        
        // 计算等比例缩放
        const videoRatio = video.videoWidth / video.videoHeight;
        const targetRatio = width / height;
        
        let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
        
        if (videoRatio > targetRatio) {
          // 视频更宽，裁剪两侧
          sw = video.videoHeight * targetRatio;
          sx = (video.videoWidth - sw) / 2;
        } else {
          // 视频更高，裁剪上下
          sh = video.videoWidth / targetRatio;
          sy = (video.videoHeight - sh) / 2;
        }
        
        ctx?.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
        
        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        
        isResolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve(thumbnail);
      } catch {
        // 绘制失败，静默处理
      }
    };

    video.onloadedmetadata = () => {
      // 将毫秒转换为秒
      const timeSec = Math.max(0, Math.min(timeMs / 1000, video.duration - 0.1));
      video.currentTime = timeSec;
    };

    video.onloadeddata = () => {
      // 如果 timeMs 为 0，可以直接生成缩略图
      if (timeMs === 0 || Math.abs(video.currentTime - timeMs / 1000) < 0.5) {
        generateThumbnail();
      }
    };

    video.onseeked = () => {
      generateThumbnail();
    };

    video.oncanplay = () => {
      // 备用触发器：如果其他事件没触发，这里也尝试生成
      if (!isResolved && video.readyState >= 2) {
        generateThumbnail();
      }
    };

    video.onerror = () => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeout);
        cleanup();
        reject(new Error('Failed to load video for thumbnail'));
      }
    };

    video.src = videoUrl;
    video.load(); // 显式调用 load
  });
}

// 缩略图缓存（内存级别，页面刷新后失效）
const thumbnailCache = new Map<string, string>();
// 失败记录，避免重复尝试
const thumbnailFailures = new Map<string, number>();
const MAX_THUMBNAIL_RETRIES = 2;

// ★ 缩略图生成队列 - 避免并发请求竞争带宽
let thumbnailQueue: Array<{
  cacheKey: string;
  clipId: string;
  videoUrl: string;
  sourceStartMs: number;
  resolve: (value: string | null) => void;
}> = [];
let isThumbnailProcessing = false;

async function processThumbnailQueue() {
  if (isThumbnailProcessing || thumbnailQueue.length === 0) return;
  
  isThumbnailProcessing = true;
  
  while (thumbnailQueue.length > 0) {
    const task = thumbnailQueue.shift()!;
    const { cacheKey, clipId, videoUrl, sourceStartMs, resolve } = task;
    
    // 再次检查缓存（可能在队列等待期间已生成）
    if (thumbnailCache.has(cacheKey)) {
      resolve(thumbnailCache.get(cacheKey)!);
      continue;
    }
    
    const failCount = thumbnailFailures.get(cacheKey) || 0;
    if (failCount >= MAX_THUMBNAIL_RETRIES) {
      resolve(null);
      continue;
    }
    
    try {
      debugLog(`[Thumbnail] Generating for clip ${clipId} at ${sourceStartMs}ms`);
      const thumbnail = await generateThumbnailFromUrl(videoUrl, sourceStartMs);
      thumbnailCache.set(cacheKey, thumbnail);
      thumbnailFailures.delete(cacheKey);
      debugLog(`[Thumbnail] Successfully generated for clip ${clipId}`);
      resolve(thumbnail);
    } catch {
      thumbnailFailures.set(cacheKey, failCount + 1);
      debugLog(`[Thumbnail] Failed for clip ${clipId} (attempt ${failCount + 1})`);
      resolve(null);
    }
    
    // ★ 每个缩略图生成之间短暂延迟，避免 UI 卡顿
    await new Promise(r => setTimeout(r, 100));
  }
  
  isThumbnailProcessing = false;
}

/**
 * 获取或生成缩略图（带缓存和队列控制）
 * 使用 clipId + sourceStart 作为缓存 key
 */
export async function getOrGenerateThumbnail(
  clipId: string,
  videoUrl: string,
  sourceStartMs: number = 0
): Promise<string | null> {
  const cacheKey = `${clipId}_${Math.floor(sourceStartMs / 1000)}`;
  
  // 检查缓存
  if (thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey)!;
  }
  
  // 检查是否多次失败
  const failCount = thumbnailFailures.get(cacheKey) || 0;
  if (failCount >= MAX_THUMBNAIL_RETRIES) {
    return null;
  }
  
  // ★ 加入队列，避免并发
  return new Promise((resolve) => {
    thumbnailQueue.push({ cacheKey, clipId, videoUrl, sourceStartMs, resolve });
    processThumbnailQueue();
  });
}

/**
 * 清除缩略图缓存
 */
export function clearThumbnailCache(): void {
  thumbnailCache.clear();
}

/**
 * 获取视频时长（返回毫秒）
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      // 返回毫秒（video.duration 是秒）
      const durationMs = Math.round(video.duration * 1000);
      URL.revokeObjectURL(video.src);
      resolve(durationMs);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to get video duration'));
    };

    video.src = URL.createObjectURL(file);
  });
}
