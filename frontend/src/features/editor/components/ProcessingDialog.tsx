'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useEditorStore } from '../store/editor-store';

/**
 * 通用处理进度弹窗
 * 显示跳跃的兔子动画和进度条
 * 支持取消操作
 */
export function ProcessingDialog() {
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const processingType = useEditorStore((s) => s.processType);
  const processingProgress = useEditorStore((s) => s.processProgress);
  const setProcessing = useEditorStore((s) => s.setProcessing);
  const cancelCurrentTask = useEditorStore((s) => s.cancelCurrentTask);

  // 处理取消
  const handleCancel = async () => {
    if (cancelCurrentTask) {
      await cancelCurrentTask();
    }
    setProcessing(false);
  };

  // ESC 键取消
  useEffect(() => {
    if (!isProcessing) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProcessing]);

  if (!isProcessing) return null;

  // 根据处理类型显示不同的文案
  const getTitle = () => {
    switch (processingType) {
      case 'extract': return '正在提取音频...';
      case 'clean': return '正在智能清理...';
      case 'stt': return '正在转写文案...';
      case 'stem': return '正在分离音轨...';
      case 'export': return '正在导出...';
      default: return '正在处理...';
    }
  };

  const getSubtitle = () => {
    switch (processingType) {
      case 'extract': return '从视频中分离音轨，请稍候';
      case 'clean': return '智能识别并清理无效片段';
      case 'stt': return 'AI 正在识别语音内容';
      case 'stem': return '分离人声、音乐和背景音';
      case 'export': return '正在渲染并导出视频';
      default: return 'HoppingRabbit 正在处理您的请求';
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-white/80 backdrop-blur-sm animate-in fade-in duration-200">
      {/* 弹窗内容 */}
      <div className="relative bg-white border border-gray-200 rounded-2xl p-8 w-[400px] shadow-2xl animate-in zoom-in-95 duration-300">
        {/* 关闭按钮 */}
        <button
          onClick={handleCancel}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors group"
          title="取消 (ESC)"
        >
          <X size={16} className="text-gray-500 group-hover:text-gray-900" />
        </button>

        {/* 标题 */}
        <div className="text-center mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-2">{getTitle()}</h3>
          <p className="text-gray-500 text-sm">{getSubtitle()}</p>
        </div>

        {/* 跳跃兔子动画 + 进度条 */}
        <div className="space-y-6">
          {/* 进度数字 */}
          <div className="text-center">
            <span className="text-3xl font-mono font-bold text-gray-900">{processingProgress}%</span>
          </div>

          {/* 进度条容器 */}
          <div className="relative">
            {/* 跳跃的兔子 */}
            <div 
              className="absolute -top-14 transition-all duration-300 ease-out"
              style={{ 
                left: `${processingProgress}%`,
                transform: 'translateX(-50%)'
              }}
            >
              <div className="flex flex-col items-center">
                <div className="origin-bottom">
                  <img 
                    src="/rabbit-loading.gif" 
                    width={36} 
                    height={36} 
                    className="drop-shadow-sm" 
                    alt="Loading"
                  />
                </div>
              </div>
            </div>
            
            {/* 进度条轨道 */}
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-gray-700 to-gray-900 transition-all duration-300"
                style={{ width: `${processingProgress}%` }}
              />
            </div>
          </div>

          {/* 取消提示 */}
          <p className="text-center text-gray-500 text-xs">
            按 ESC 或点击 × 取消
          </p>
        </div>
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
        .animate-hop {
          animation: hop 0.7s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .animate-hop-shadow {
          animation: hop-shadow 0.7s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
    </div>
  );
}
