'use client';

/**
 * 智能一键成片 V2 - 阶段进度展示组件
 * 显示分析处理的各个阶段和当前进度
 * 复用 HoppingRabbit 品牌风格的跳跃兔子动画
 */

import React, { useEffect, useState, useCallback } from 'react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { 
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  ProcessingStage,
  ProcessingProgress,
  STAGES,
  getStageInfo,
  pollAnalysisProgress,
  AnalysisResult
} from '@/features/editor/lib/smart-v2-api';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => { if (DEBUG_ENABLED) console.log('[SmartProcessingView]', ...args); };

interface SmartProcessingViewProps {
  analysisId: string;
  onComplete: (result: AnalysisResult) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

export function SmartProcessingView({
  analysisId,
  onComplete,
  onError,
  onCancel
}: SmartProcessingViewProps) {
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // 开始轮询
  useEffect(() => {
    debugLog('开始轮询分析进度:', analysisId);
    
    const stopPolling = pollAnalysisProgress(
      analysisId,
      // 进度更新
      (newProgress) => {
        debugLog('进度更新:', newProgress);
        setProgress(newProgress);
      },
      // 完成
      (result) => {
        debugLog('分析完成:', result);
        onComplete(result);
      },
      // 错误
      (err) => {
        debugLog('分析错误:', err);
        setError(err.message);
        onError(err.message);
      },
      2000  // 2秒轮询
    );
    
    return () => {
      debugLog('停止轮询');
      stopPolling();
    };
  }, [analysisId, onComplete, onError]);
  
  const currentStage = progress?.stage || 'pending';
  const currentProgress = progress?.progress || 0;
  const currentMessage = progress?.message || '准备中...';
  
  return (
    <div className="smart-processing-view min-h-screen bg-[#FAFAFA] flex items-center justify-center">
      <div className="max-w-lg w-full mx-auto px-6 space-y-12 animate-in fade-in duration-1000">
        {/* 标题 */}
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
            AI 智能分析中...
          </h2>
          <p className="text-gray-500 text-xs font-medium">
            HoppingRabbit 正在识别废话和重复片段，请稍候片刻
          </p>
        </div>
        
        {/* 跳跃兔子动画样式 */}
        <style jsx>{`
          @keyframes vivid-hop {
            0%, 100% { transform: translateY(0) scaleX(1) scaleY(1); }
            15% { transform: translateY(0) scaleX(1.15) scaleY(0.85); }
            45% { transform: translateY(-30px) scaleX(0.9) scaleY(1.15); }
            85% { transform: translateY(0) scaleX(1.05) scaleY(0.95); }
          }
          @keyframes hop-shadow {
            0%, 100%, 15%, 85% { transform: scale(1); opacity: 0.3; }
            45% { transform: scale(0.5); opacity: 0.1; }
          }
        `}</style>
        
        {/* 进度条 + 跳跃兔子 */}
        <div className="space-y-8">
          <div className="space-y-2">
            <div className="flex justify-between items-end">
              <span className="text-sm font-mono font-bold text-gray-900">{currentProgress}%</span>
              <span className="text-xs text-gray-500">{currentMessage}</span>
            </div>
            
            {/* 进度条容器 - 包含兔子 */}
            <div className="relative">
              {/* 跳跃的兔子 - 跟随进度条移动 */}
              <div 
                className="absolute -top-12 transition-all duration-300 ease-out"
                style={{ 
                  left: `${currentProgress}%`,
                  transform: 'translateX(-50%)'
                }}
              >
                <div className="flex flex-col items-center">
                  {/* 兔子本体 */}
                  <div className="animate-[vivid-hop_0.8s_cubic-bezier(0.4,0,0.6,1)_infinite] origin-bottom">
                    <img 
                      src="/rabbit-logo.png"
                      width={40}
                      height={40}
                      className="drop-shadow-[0_0_15px_rgba(100,100,100,0.6)]" 
                      alt="Rabbit"
                    />
                  </div>
                  {/* 同步阴影 */}
                  <div className="w-8 h-1.5 bg-gray-600/30 rounded-full blur-sm animate-[hop-shadow_0.8s_cubic-bezier(0.4,0,0.6,1)_infinite] -mt-1" />
                </div>
              </div>
              
              {/* 进度条轨道 */}
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-gray-700 to-gray-500 shadow-[0_0_20px_rgba(100,100,100,0.4)] transition-all duration-300"
                  style={{ width: `${currentProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
        
        {/* 阶段列表 */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4 shadow-sm">
          {STAGES.map((stage, index) => {
            const isCompleted = stage.progress < currentProgress;
            const isCurrent = stage.id === currentStage;
            const isPending = stage.progress > currentProgress;
            
            return (
              <div 
                key={stage.id}
                className={`
                  flex items-center gap-3 py-2 transition-all
                  ${isCompleted ? 'opacity-60' : ''}
                  ${isPending ? 'opacity-40' : ''}
                `}
              >
                {/* 状态图标 */}
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100">
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : isCurrent ? (
                    <RabbitLoader size={16} />
                  ) : (
                    <span className="text-base opacity-50">{stage.icon}</span>
                  )}
                </div>
                
                {/* 阶段文本 */}
                <div className="flex-1">
                  <span className={`
                    text-sm
                    ${isCurrent ? 'text-gray-900 font-medium' : ''}
                    ${isCompleted ? 'text-gray-500' : ''}
                    ${isPending ? 'text-gray-400' : ''}
                  `}>
                    {stage.text}
                  </span>
                </div>
                
                {/* 完成标记 */}
                {isCompleted && (
                  <span className="text-xs text-green-600">✓</span>
                )}
              </div>
            );
          })}
        </div>
        
        {/* 错误提示 */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          </div>
        )}
        
        {/* 取消按钮 */}
        <div className="text-center">
          <button
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            取消
          </button>
        </div>
        
        {/* 提示信息 */}
        <div className="text-center text-xs text-gray-500">
          <p>智能分析通常需要 30-60 秒，请耐心等待</p>
        </div>
      </div>
    </div>
  );
}

export default SmartProcessingView;
