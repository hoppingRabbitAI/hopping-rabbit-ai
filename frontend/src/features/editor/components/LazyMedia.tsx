'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';

/**
 * 懒加载图片组件
 * 只有当图片进入视口时才开始加载
 */
interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholder?: React.ReactNode;
  onLoad?: () => void;
  onError?: () => void;
}

export const LazyImage = memo(function LazyImage({
  src,
  alt,
  className = '',
  placeholder,
  onLoad,
  onError,
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = imgRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '50px', // 提前 50px 开始加载
        threshold: 0,
      }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setHasError(true);
    onError?.();
  }, [onError]);

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {/* 占位符：显示在图片加载前或加载失败时 */}
      {(!isLoaded || hasError) && (
        <div className="absolute inset-0">
          {placeholder || (
            <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 animate-pulse" />
          )}
        </div>
      )}
      
      {/* 实际图片：只在进入视口后加载 */}
      {isInView && !hasError && (
        <img
          src={src}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
          decoding="async"
        />
      )}
    </div>
  );
});

/**
 * 缩略图缓存 - 避免重复生成
 */
const thumbnailCache = new Map<string, string[]>();

/**
 * 生成缩略图的 key
 */
function getThumbnailCacheKey(clipId: string, count: number): string {
  return `${clipId}:${count}`;
}

/**
 * 从缓存获取缩略图
 */
export function getCachedThumbnails(clipId: string, count: number): string[] | undefined {
  return thumbnailCache.get(getThumbnailCacheKey(clipId, count));
}

/**
 * 缓存缩略图
 */
export function setCachedThumbnails(clipId: string, count: number, thumbnails: string[]): void {
  thumbnailCache.set(getThumbnailCacheKey(clipId, count), thumbnails);
}

/**
 * 清理缩略图缓存
 */
export function clearThumbnailCache(): void {
  thumbnailCache.clear();
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
