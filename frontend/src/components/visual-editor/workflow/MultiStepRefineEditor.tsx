/**
 * 多步细粒度优化编辑器
 * 支持分步编辑：提取人物 → 优化背景 → 合成
 * 用户可以单独对背景进行多次优化，最后合成最终图
 */

'use client';

import React, { useState, useCallback } from 'react';
import { 
  X, 
  Wand2, 
  Loader2, 
  ChevronLeft, 
  ChevronRight,
  Sparkles,
  RefreshCw,
  Check,
  User,
  Image as ImageIcon,
  Layers,
  ArrowRight,
  Shuffle
} from 'lucide-react';

// 分步流程的步骤
type RefineStep = 'select-mode' | 'refine-bg' | 'preview-result';

interface MultiStepRefineEditorProps {
  originalImageUrl: string;
  clipId: string;
  onClose: () => void;
  onRefineBackground: (params: RefineBackgroundParams) => Promise<RefineResult>;
  onConfirm: (resultUrl: string) => Promise<void>;
}

export interface RefineBackgroundParams {
  clipId: string;
  imageUrl: string;
  prompt: string;
}

export interface RefineResult {
  resultUrl: string;
  taskId?: string;
}

// 预设背景 Prompt
const BACKGROUND_TEMPLATES = [
  '日落海滩，金色阳光洒在海面上，远处有椰子树',
  '现代简约办公室，大落地窗外是城市天际线',
  '温馨咖啡厅，暖色调灯光，木质装修',
  '宇宙星空背景，银河系星云，深邃神秘',
  '绿色森林，阳光透过树叶，自然清新',
  '纯白色简洁背景，专业干净',
];

export function MultiStepRefineEditor({
  originalImageUrl,
  clipId,
  onClose,
  onRefineBackground,
  onConfirm,
}: MultiStepRefineEditorProps) {
  // 当前步骤
  const [step, setStep] = useState<RefineStep>('select-mode');
  
  // 背景优化相关
  const [bgPrompt, setBgPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 生成结果历史
  const [resultHistory, setResultHistory] = useState<RefineResult[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  
  // 当前预览
  const currentResult = currentResultIndex >= 0 ? resultHistory[currentResultIndex] : null;

  // 处理背景优化
  const handleRefineBackground = useCallback(async () => {
    if (!bgPrompt.trim()) {
      setError('请输入背景描述');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const result = await onRefineBackground({
        clipId,
        imageUrl: originalImageUrl,
        prompt: bgPrompt.trim(),
      });
      
      // 保存到历史
      setResultHistory(prev => [...prev, result]);
      setCurrentResultIndex(resultHistory.length);
      
      // 跳转到预览步骤
      setStep('preview-result');
    } catch (err) {
      setError(err instanceof Error ? err.message : '优化失败');
    } finally {
      setIsProcessing(false);
    }
  }, [bgPrompt, clipId, originalImageUrl, onRefineBackground, resultHistory.length]);

  // 换一个（保持 prompt 重新生成）
  const handleShuffle = useCallback(async () => {
    if (!bgPrompt.trim()) return;
    
    setIsProcessing(true);
    setError(null);

    try {
      const result = await onRefineBackground({
        clipId,
        imageUrl: originalImageUrl,
        prompt: bgPrompt.trim(),
      });
      
      setResultHistory(prev => [...prev, result]);
      setCurrentResultIndex(resultHistory.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsProcessing(false);
    }
  }, [bgPrompt, clipId, originalImageUrl, onRefineBackground, resultHistory.length]);

  // 确认应用
  const handleConfirm = useCallback(async () => {
    if (!currentResult) return;
    
    setIsProcessing(true);
    try {
      await onConfirm(currentResult.resultUrl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认失败');
    } finally {
      setIsProcessing(false);
    }
  }, [currentResult, onConfirm, onClose]);

  // 选择历史版本
  const handleSelectResult = useCallback((index: number) => {
    if (index >= 0 && index < resultHistory.length) {
      setCurrentResultIndex(index);
    }
  }, [resultHistory.length]);

  // 返回编辑
  const handleBackToEdit = useCallback(() => {
    setStep('refine-bg');
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[900px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">细粒度背景优化</h2>
              <p className="text-sm text-gray-500">
                保持人物不变，单独优化背景
              </p>
            </div>
          </div>
          
          {/* 步骤指示器 */}
          <div className="flex items-center gap-2">
            <StepIndicator 
              step={1} 
              label="选择模式" 
              active={step === 'select-mode'} 
              completed={step !== 'select-mode'} 
            />
            <ArrowRight className="w-4 h-4 text-gray-300" />
            <StepIndicator 
              step={2} 
              label="优化背景" 
              active={step === 'refine-bg'} 
              completed={step === 'preview-result'} 
            />
            <ArrowRight className="w-4 h-4 text-gray-300" />
            <StepIndicator 
              step={3} 
              label="预览确认" 
              active={step === 'preview-result'} 
              completed={false} 
            />
          </div>
          
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 主内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'select-mode' && (
            <SelectModeStep 
              onSelectDirect={() => setStep('refine-bg')}
            />
          )}
          
          {step === 'refine-bg' && (
            <RefineBackgroundStep
              originalImageUrl={originalImageUrl}
              prompt={bgPrompt}
              onPromptChange={setBgPrompt}
              templates={BACKGROUND_TEMPLATES}
              isProcessing={isProcessing}
              error={error}
              onGenerate={handleRefineBackground}
            />
          )}
          
          {step === 'preview-result' && currentResult && (
            <PreviewResultStep
              originalImageUrl={originalImageUrl}
              resultUrl={currentResult.resultUrl}
              resultHistory={resultHistory}
              currentIndex={currentResultIndex}
              onSelectResult={handleSelectResult}
              onShuffle={handleShuffle}
              isProcessing={isProcessing}
              onBackToEdit={handleBackToEdit}
            />
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <div className="text-xs text-gray-500">
            {step === 'select-mode' && '选择优化模式'}
            {step === 'refine-bg' && '描述你想要的背景效果'}
            {step === 'preview-result' && `已生成 ${resultHistory.length} 个版本`}
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-xl transition-colors"
            >
              取消
            </button>
            
            {step === 'preview-result' && (
              <button
                onClick={handleConfirm}
                disabled={isProcessing || !currentResult}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-500 to-pink-600 text-white text-sm font-medium rounded-xl hover:from-purple-600 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    确认中...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    确认应用
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 步骤指示器
function StepIndicator({ step, label, active, completed }: { 
  step: number; 
  label: string; 
  active: boolean; 
  completed: boolean;
}) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${
      active ? 'bg-purple-100' : completed ? 'bg-green-50' : 'bg-gray-50'
    }`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
        active ? 'bg-purple-500 text-white' : completed ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
      }`}>
        {completed ? '✓' : step}
      </div>
      <span className={`text-xs ${active ? 'text-purple-700 font-medium' : 'text-gray-500'}`}>
        {label}
      </span>
    </div>
  );
}

// 步骤1：选择模式
function SelectModeStep({ onSelectDirect }: { onSelectDirect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <h3 className="text-lg font-semibold text-gray-800 mb-2">选择优化模式</h3>
      <p className="text-sm text-gray-500 mb-8">保持人物位置和姿态不变，只优化背景</p>
      
      <div className="grid grid-cols-1 gap-4 max-w-md w-full">
        <button
          onClick={onSelectDirect}
          className="flex items-center gap-4 p-6 border-2 border-gray-200 rounded-2xl hover:border-purple-300 hover:bg-purple-50 transition-all group"
        >
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Wand2 className="w-7 h-7 text-white" />
          </div>
          <div className="flex-1 text-left">
            <h4 className="font-semibold text-gray-800">智能背景优化</h4>
            <p className="text-sm text-gray-500">AI 自动保持人物，只替换背景</p>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-purple-500" />
        </button>
      </div>
    </div>
  );
}

// 步骤2：优化背景
function RefineBackgroundStep({
  originalImageUrl,
  prompt,
  onPromptChange,
  templates,
  isProcessing,
  error,
  onGenerate,
}: {
  originalImageUrl: string;
  prompt: string;
  onPromptChange: (v: string) => void;
  templates: string[];
  isProcessing: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-6">
      {/* 左侧：原图预览 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-gray-500" />
          <h3 className="font-medium text-gray-700">原始图片</h3>
        </div>
        <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
          <img
            src={originalImageUrl}
            alt="原图"
            className="w-full h-auto max-h-[400px] object-contain"
          />
          <div className="absolute bottom-3 left-3 px-2.5 py-1 bg-gray-800/80 text-white text-xs rounded-lg flex items-center gap-1.5">
            <User className="w-3 h-3" />
            人物将保持不变
          </div>
        </div>
      </div>

      {/* 右侧：Prompt 输入 */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gray-500" />
          <h3 className="font-medium text-gray-700">描述你想要的背景</h3>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="描述你想要的背景效果，人物位置和姿态会保持不变..."
          className="w-full h-32 px-4 py-3 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
        />

        {/* 生成按钮 */}
        <div className="flex justify-end">
          <button
            onClick={onGenerate}
            disabled={isProcessing || !prompt.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-500 to-pink-600 text-white text-sm font-medium rounded-xl hover:from-purple-600 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                生成背景
              </>
            )}
          </button>
        </div>

        {/* 快捷模板 */}
        <div className="space-y-2">
          <p className="text-xs text-gray-500">快捷模板</p>
          <div className="flex flex-wrap gap-2">
            {templates.map((template, index) => (
              <button
                key={index}
                onClick={() => onPromptChange(template)}
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-purple-100 rounded-full text-gray-700 transition-colors truncate max-w-[200px]"
                title={template}
              >
                {template}
              </button>
            ))}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// 步骤3：预览结果
function PreviewResultStep({
  originalImageUrl,
  resultUrl,
  resultHistory,
  currentIndex,
  onSelectResult,
  onShuffle,
  isProcessing,
  onBackToEdit,
}: {
  originalImageUrl: string;
  resultUrl: string;
  resultHistory: RefineResult[];
  currentIndex: number;
  onSelectResult: (idx: number) => void;
  onShuffle: () => void;
  isProcessing: boolean;
  onBackToEdit: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* 对比预览 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 原图 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-gray-500" />
            <h3 className="font-medium text-gray-700">原图</h3>
          </div>
          <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
            <img
              src={originalImageUrl}
              alt="原图"
              className="w-full h-auto max-h-[350px] object-contain"
            />
          </div>
        </div>

        {/* 生成结果 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <h3 className="font-medium text-gray-700">生成结果</h3>
              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-600 rounded-full">
                {currentIndex + 1} / {resultHistory.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onShuffle}
                disabled={isProcessing}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shuffle className="w-3 h-3" />}
                换一个
              </button>
              <button
                onClick={onBackToEdit}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                改描述
              </button>
            </div>
          </div>
          <div className="relative rounded-xl overflow-hidden border-2 border-purple-200 bg-gray-100">
            <img
              src={resultUrl}
              alt="生成结果"
              className="w-full h-auto max-h-[350px] object-contain"
            />
            <div className="absolute top-3 left-3 px-2.5 py-1 bg-purple-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              AI 生成
            </div>
          </div>
        </div>
      </div>

      {/* 历史版本缩略图 */}
      {resultHistory.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">历史版本 (点击切换)</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {resultHistory.map((result, idx) => (
              <button
                key={idx}
                onClick={() => onSelectResult(idx)}
                className={`relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                  idx === currentIndex 
                    ? 'border-purple-500 ring-2 ring-purple-200' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <img 
                  src={result.resultUrl} 
                  alt={`版本 ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5">
                  v{idx + 1}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
