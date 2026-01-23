'use client';

import { useEffect, useState } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { Video, Music, FileText } from 'lucide-react';

// ============================================
// 类型定义
// ============================================

export type LoadingType = 'video' | 'audio' | 'assets' | 'project' | 'general';

export interface BlockingLoaderProps {
  /** 是否显示加载弹窗 */
  isLoading: boolean;
  /** 加载类型，决定图标和文案 */
  type?: LoadingType;
  /** 加载进度 (0-100)，不传则显示无限加载动画 */
  progress?: number;
  /** 自定义标题 */
  title?: string;
  /** 自定义副标题 */
  subtitle?: string;
  /** 当前阶段描述（如 "加载中..." "缓冲中..."） */
  stage?: string;
  /** 加载完成后的回调 */
  onLoadComplete?: () => void;
}

// ============================================
// 配置
// ============================================

const LOADING_CONFIG: Record<LoadingType, { 
  icon: typeof Video | null; 
  title: string; 
  subtitle: string;
  color: string;
  useRabbitLoader?: boolean;
}> = {
  video: {
    icon: null,
    title: '视频准备中...',
    subtitle: '正在加载视频资源',
    color: 'text-gray-700',
  },
  audio: {
    icon: Music,
    title: '音频加载中...',
    subtitle: '正在准备音频资源，请稍候',
    color: 'text-green-500',
  },
  assets: {
    icon: FileText,
    title: '资源加载中...',
    subtitle: '正在加载项目资源，请稍候',
    color: 'text-gray-500',
  },
  project: {
    icon: null,
    useRabbitLoader: true,
    title: '项目加载中...',
    subtitle: '正在恢复您的项目状态',
    color: 'text-orange-500',
  },
  general: {
    icon: null,
    useRabbitLoader: true,
    title: '加载中...',
    subtitle: '请稍候',
    color: 'text-gray-400',
  },
};

// ============================================
// 组件
// ============================================

/**
 * 阻塞性加载弹窗
 * 
 * 用于在关键资源（如视频）未准备好时阻止用户操作
 * 
 * 使用场景：
 * - 刷新页面后等待视频加载
 * - 切换项目时等待资源加载
 * - 任何需要阻塞用户操作的加载场景
 * 
 * 特性：
 * - 全屏遮罩，阻止所有用户交互
 * - 支持进度条（有明确进度）或无限加载动画（无明确进度）
 * - 跳跃兔子动画，与品牌一致
 */
export function BlockingLoader({
  isLoading,
  type = 'general',
  progress,
  title,
  subtitle,
  stage,
  onLoadComplete,
}: BlockingLoaderProps) {
  const [showContent, setShowContent] = useState(false);
  
  const config = LOADING_CONFIG[type];
  const Icon = config.icon;
  const displayTitle = title || config.title;
  const displaySubtitle = subtitle || config.subtitle;
  const hasProgress = progress !== undefined;
  
  // 延迟显示内容，避免闪烁
  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => setShowContent(true), 100);
      return () => clearTimeout(timer);
    } else {
      setShowContent(false);
      onLoadComplete?.();
    }
  }, [isLoading, onLoadComplete]);

  if (!isLoading) return null;

  return (
    <div 
      className="fixed inset-0 z-[300] flex items-center justify-center bg-white/90 backdrop-blur-md"
      style={{ 
        opacity: showContent ? 1 : 0,
        transition: 'opacity 0.2s ease-out',
      }}
    >
      {/* 弹窗内容 */}
      <div 
        className="relative bg-white border border-gray-200 rounded-2xl p-8 w-[400px] shadow-2xl"
        style={{
          transform: showContent ? 'scale(1)' : 'scale(0.95)',
          opacity: showContent ? 1 : 0,
          transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
        }}
      >
        {/* 顶部图标动画 */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            {/* 主图标 */}
            <div className={`animate-bounce-gentle ${config.color}`}>
              {config.useRabbitLoader ? (
                <RabbitLoader size={48} />
              ) : Icon ? (
                <Icon size={48} strokeWidth={1.5} />
              ) : null}
            </div>
            {/* 光晕效果 */}
            <div 
              className={`absolute inset-0 blur-xl opacity-30 ${config.color}`}
              style={{ transform: 'scale(1.5)' }}
            >
              {config.useRabbitLoader ? (
                <RabbitLoader size={48} />
              ) : Icon ? (
                <Icon size={48} strokeWidth={1.5} />
              ) : null}
            </div>
          </div>
        </div>

        {/* 标题 */}
        <div className="text-center mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-2">{displayTitle}</h3>
          <p className="text-gray-500 text-sm">{displaySubtitle}</p>
          {stage && (
            <p className="text-gray-700 text-xs mt-2 font-medium">{stage}</p>
          )}
        </div>

        {/* 进度区域 */}
        <div className="space-y-6">
          {hasProgress ? (
            <>
              {/* 有进度：显示进度数字 */}
              <div className="text-center">
                <span className="text-3xl font-mono font-bold text-gray-900">{Math.round(progress)}%</span>
              </div>

              {/* 进度条容器 */}
              <div className="relative">
                {/* 跳跃的兔子 */}
                <div 
                  className="absolute -top-14 transition-all duration-300 ease-out"
                  style={{ 
                    left: `${progress}%`,
                    transform: 'translateX(-50%)'
                  }}
                >
                  <div className="flex flex-col items-center">
                    <div>
                      <img 
                        src="/rabbit-loading.gif"
                        width={36}
                        height={36}
                        alt="Rabbit"
                        className="drop-shadow-sm" 
                      />
                    </div>
                    <div className="w-6 h-1 bg-gray-700/30 rounded-full blur-sm animate-hop-shadow -mt-1" />
                  </div>
                </div>
                
                {/* 进度条轨道 */}
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-gray-700 to-gray-500 shadow-[0_0_20px_rgba(100,100,100,0.4)] transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* 无进度：显示无限加载动画 */}
              <div className="flex justify-center">
                <div className="flex flex-col items-center">
                  <div>
                    <img 
                      src="/rabbit-loading.gif" 
                      width={48} 
                      height={48} 
                      className="drop-shadow-sm" 
                      alt="Rabbit"
                    />
                  </div>
                </div>
              </div>

              {/* 无限进度条 */}
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-gray-500 to-transparent animate-shimmer rounded-full" />
              </div>
            </>
          )}
        </div>

        {/* 底部提示 */}
        <p className="text-center text-gray-600 text-xs mt-6">
          {hasProgress && progress && progress >= 99 
            ? '即将完成...' 
            : '首次加载可能需要几秒钟'
          }
        </p>
      </div>

      {/* 动画样式 */}
      <style jsx>{`
        @keyframes hop {
          0%, 100% { transform: translateY(0) scaleX(1) scaleY(1); }
          15% { transform: translateY(0) scaleX(1.1) scaleY(0.9); }
          45% { transform: translateY(-20px) scaleX(0.95) scaleY(1.1); }
          85% { transform: translateY(0) scaleX(1.05) scaleY(0.95); }
        }
        @keyframes hop-shadow {
          0%, 100%, 15%, 85% { transform: scale(1); opacity: 0.3; }
          45% { transform: scale(0.6); opacity: 0.1; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes bounce-gentle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .animate-hop {
          animation: hop 0.7s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .animate-hop-shadow {
          animation: hop-shadow 0.7s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .animate-shimmer {
          animation: shimmer 1.5s ease-in-out infinite;
        }
        .animate-bounce-gentle {
          animation: bounce-gentle 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export default BlockingLoader;
