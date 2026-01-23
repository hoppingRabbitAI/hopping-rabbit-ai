/**
 * HoppingRabbit AI - 波形可视化组件
 * 高性能 Canvas 渲染，支持缩放和交互
 */
'use client';

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { assetApi } from '@/lib/api';

// 调试开关
const DEBUG_ENABLED = process.env.NODE_ENV === 'development';
const debugError = (...args: unknown[]) => { if (DEBUG_ENABLED) console.error(...args); };

// ============================================
// 类型定义
// ============================================

interface WaveformProps {
  /** 资源 ID */
  assetId?: string;
  /** 预加载的波形数据 */
  data?: number[];
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** 当前播放时间 (秒) */
  currentTime?: number;
  /** 总时长 (秒) */
  duration?: number;
  /** 波形颜色 */
  color?: string;
  /** 进度颜色 */
  progressColor?: string;
  /** 背景颜色 */
  backgroundColor?: string;
  /** 点击回调 */
  onClick?: (time: number) => void;
  /** 是否显示进度条 */
  showProgress?: boolean;
  /** 采样密度 (每像素采样数) */
  samplesPerPixel?: number;
  /** 选区开始 */
  selectionStart?: number;
  /** 选区结束 */
  selectionEnd?: number;
  /** 选区颜色 */
  selectionColor?: string;
}

interface WaveformData {
  peaks: number[];
  duration: number;
  sampleRate: number;
}

// ============================================
// 波形组件
// ============================================

export const Waveform: React.FC<WaveformProps> = ({
  assetId,
  data,
  width,
  height,
  currentTime = 0,
  duration = 0,
  color = '#22c55e',
  progressColor = '#16a34a',
  backgroundColor = 'transparent',
  onClick,
  showProgress = true,
  samplesPerPixel = 2,
  selectionStart,
  selectionEnd,
  selectionColor = 'rgba(59, 130, 246, 0.3)',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveformData, setWaveformData] = React.useState<number[]>(data || []);
  const [isLoading, setIsLoading] = React.useState(!data && !!assetId);

  // 加载波形数据
  useEffect(() => {
    if (data) {
      setWaveformData(data);
      return;
    }

    if (!assetId) return;

    const loadWaveform = async () => {
      setIsLoading(true);
      try {
        const response = await assetApi.getWaveform(assetId);
        if (response.data?.data?.left) {
          setWaveformData(response.data.data.left);
        }
      } catch (error) {
        debugError('加载波形数据失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadWaveform();
  }, [assetId, data]);

  // 重采样波形数据以适应画布宽度
  const resampledData = useMemo(() => {
    if (!waveformData.length) return [];

    const targetSamples = Math.floor(width / samplesPerPixel);
    if (targetSamples <= 0) return [];

    const samplesPerBin = waveformData.length / targetSamples;
    const result: number[] = [];

    for (let i = 0; i < targetSamples; i++) {
      const start = Math.floor(i * samplesPerBin);
      const end = Math.floor((i + 1) * samplesPerBin);
      
      let max = 0;
      for (let j = start; j < end && j < waveformData.length; j++) {
        const val = Math.abs(waveformData[j]);
        if (val > max) max = val;
      }
      
      result.push(max);
    }

    return result;
  }, [waveformData, width, samplesPerPixel]);

  // 绘制波形
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置高清晰度
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // 清空画布
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    if (!resampledData.length) {
      // 显示占位符（底部对齐）
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, height * 0.5, width, height * 0.5);
      return;
    }

    // 使用 85% 高度作为最大波形高度，留出底部边距
    const maxHeight = height * 0.85;

    // 计算进度位置
    const progressX = duration > 0 ? (currentTime / duration) * width : 0;

    // 绘制选区
    if (selectionStart !== undefined && selectionEnd !== undefined && duration > 0) {
      const selStartX = (selectionStart / duration) * width;
      const selEndX = (selectionEnd / duration) * width;
      ctx.fillStyle = selectionColor;
      ctx.fillRect(selStartX, 0, selEndX - selStartX, height);
    }

    // 绘制波形（仅上半段，从底部向上，类似 CapCut 风格）
    const barWidth = Math.max(1, samplesPerPixel - 1);
    
    resampledData.forEach((amplitude, index) => {
      const x = index * samplesPerPixel;
      const barHeight = amplitude * maxHeight;
      
      // 根据进度选择颜色
      if (showProgress && x < progressX) {
        ctx.fillStyle = progressColor;
      } else {
        ctx.fillStyle = color;
      }

      // 绘制单边波形（从底部向上）
      ctx.fillRect(
        x,
        height - barHeight,
        barWidth,
        barHeight || 1
      );
    });

    // 绘制进度线
    if (showProgress && progressX > 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(progressX, 0);
      ctx.lineTo(progressX, height);
      ctx.stroke();
    }
  }, [
    resampledData, 
    width, 
    height, 
    currentTime, 
    duration, 
    color, 
    progressColor, 
    backgroundColor,
    showProgress,
    samplesPerPixel,
    selectionStart,
    selectionEnd,
    selectionColor,
  ]);

  // 监听变化重新绘制
  useEffect(() => {
    draw();
  }, [draw]);

  // 点击处理
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onClick || !duration) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / width) * duration;
    
    onClick(Math.max(0, Math.min(duration, time)));
  }, [onClick, width, duration]);

  if (isLoading) {
    return (
      <div 
        ref={containerRef}
        className="flex items-center justify-center bg-gray-200/50 rounded"
        style={{ width, height }}
      >
        <div className="animate-pulse text-gray-500 text-xs">加载波形...</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width, height }}>
      <canvas
        ref={canvasRef}
        style={{ 
          width, 
          height,
          cursor: onClick ? 'pointer' : 'default',
        }}
        onClick={handleClick}
      />
    </div>
  );
};

// ============================================
// 迷你波形组件（用于片段预览）
// ============================================

interface MiniWaveformProps {
  data?: number[];
  width: number;
  height: number;
  color?: string;
  className?: string;
}

export const MiniWaveform: React.FC<MiniWaveformProps> = ({
  data = [],
  width,
  height,
  color = 'rgba(255, 255, 255, 0.6)',
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 高清晰度
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // 清空
    ctx.clearRect(0, 0, width, height);

    if (!data.length) {
      // 绘制占位波形（仅上半段，从底部向上）
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      const placeholderBars = Math.floor(width / 3);
      for (let i = 0; i < placeholderBars; i++) {
        const barHeight = (Math.sin(i * 0.5) * 0.3 + 0.5) * height * 0.6;
        ctx.fillRect(i * 3, height - barHeight, 2, barHeight);
      }
      return;
    }

    // 重采样
    const targetBars = Math.floor(width / 3);
    const samplesPerBar = data.length / targetBars;
    
    ctx.fillStyle = color;

    // 绘制波形（仅上半段，从底部向上，类似 CapCut 风格）
    for (let i = 0; i < targetBars; i++) {
      const start = Math.floor(i * samplesPerBar);
      const end = Math.floor((i + 1) * samplesPerBar);
      
      let max = 0;
      for (let j = start; j < end && j < data.length; j++) {
        const val = Math.abs(data[j]);
        if (val > max) max = val;
      }
      
      const barHeight = max * height * 0.85;
      ctx.fillRect(i * 3, height - barHeight, 2, barHeight || 1);
    }
  }, [data, width, height, color]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height }}
    />
  );
};

// ============================================
// 波形生成工具函数
// ============================================

/**
 * 从 AudioBuffer 生成波形数据
 */
export function generateWaveformFromAudioBuffer(
  audioBuffer: AudioBuffer,
  targetSamples: number = 1000
): number[] {
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerBin = Math.floor(channelData.length / targetSamples);
  const peaks: number[] = [];

  for (let i = 0; i < targetSamples; i++) {
    const start = i * samplesPerBin;
    const end = Math.min(start + samplesPerBin, channelData.length);
    
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > max) max = val;
    }
    
    peaks.push(max);
  }

  return peaks;
}

/**
 * 从文件生成波形数据
 */
export async function generateWaveformFromFile(
  file: File,
  targetSamples: number = 1000
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const peaks = generateWaveformFromAudioBuffer(audioBuffer, targetSamples);
        resolve(peaks);
      } catch (error) {
        reject(error);
      } finally {
        audioContext.close();
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 从 URL 生成波形数据
 */
export async function generateWaveformFromURL(
  url: string,
  targetSamples: number = 1000
): Promise<number[]> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return generateWaveformFromAudioBuffer(audioBuffer, targetSamples);
  } finally {
    audioContext.close();
  }
}

export default Waveform;
