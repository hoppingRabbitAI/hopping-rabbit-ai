/**
 * Remotion 服务端渲染 API
 * 
 * 将 Remotion 配置渲染成 MP4 视频文件
 * 可用于：
 * 1. 导出带动画效果的完整视频
 * 2. 生成 B-Roll clip 供编辑器使用
 */
import { NextRequest, NextResponse } from 'next/server';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import os from 'os';

// 渲染请求类型
interface RenderRequest {
  // 源视频 URL
  mainVideoUrl: string;
  
  // Remotion 配置
  config: {
    version?: string;
    total_duration_ms: number;
    fps?: number;
    theme?: string;
    color_palette?: string[];
    font_family?: string;
    text_components?: Array<{
      id: string;
      type: 'text';
      start_ms: number;
      end_ms: number;
      text: string;
      animation: string;
      position: string;
      style: {
        fontSize: number;
        color: string;
        fontWeight?: string;
        backgroundColor?: string;
      };
    }>;
    broll_components?: Array<{
      id: string;
      type: 'broll';
      start_ms: number;
      end_ms: number;
      search_keywords: string[];
      display_mode: string;
      transition_in: string;
      transition_out: string;
      asset_url?: string;
    }>;
    chapter_components?: Array<{
      id: string;
      type: 'chapter';
      start_ms: number;
      end_ms: number;
      title: string;
      subtitle?: string;
      style?: string;
    }>;
  };
  
  // 画中画配置
  pip?: {
    enabled: boolean;
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    size: 'small' | 'medium' | 'large';
  };
  
  // 输出配置
  width?: number;
  height?: number;
  outputFormat?: 'mp4' | 'webm';
}

// 缓存 bundle 路径
let bundleCache: string | null = null;
let bundleCacheTime = 0;
const BUNDLE_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

async function getBundlePath(): Promise<string> {
  const now = Date.now();
  
  // 使用缓存
  if (bundleCache && now - bundleCacheTime < BUNDLE_CACHE_TTL) {
    return bundleCache;
  }
  
  console.log('[Remotion Render] 创建 bundle...');
  
  const entryPoint = path.join(process.cwd(), 'src/remotion/entry.ts');
  
  const bundled = await bundle({
    entryPoint,
    // 启用缓存加速
    onProgress: (progress) => {
      if (progress % 20 === 0) {
        console.log(`[Remotion Render] Bundle 进度: ${progress}%`);
      }
    },
  });
  
  bundleCache = bundled;
  bundleCacheTime = now;
  
  console.log('[Remotion Render] Bundle 完成:', bundled);
  return bundled;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: RenderRequest = await request.json();
    
    console.log('[Remotion Render] 收到渲染请求:', {
      mainVideoUrl: body.mainVideoUrl?.substring(0, 50) + '...',
      duration: body.config.total_duration_ms,
      textComponents: body.config.text_components?.length || 0,
      brollComponents: body.config.broll_components?.length || 0,
      chapterComponents: body.config.chapter_components?.length || 0,
    });
    
    // 验证必要参数
    if (!body.mainVideoUrl) {
      return NextResponse.json({ error: '缺少 mainVideoUrl' }, { status: 400 });
    }
    
    if (!body.config || !body.config.total_duration_ms) {
      return NextResponse.json({ error: '缺少 config 或 total_duration_ms' }, { status: 400 });
    }
    
    // 获取 bundle
    const bundlePath = await getBundlePath();
    
    // 准备 props
    const inputProps = {
      mainVideoUrl: body.mainVideoUrl,
      config: {
        version: body.config.version || '2.0',
        total_duration_ms: body.config.total_duration_ms,
        fps: body.config.fps || 30,
        theme: body.config.theme || 'minimalist',
        color_palette: body.config.color_palette || ['#1a1a1a', '#ffffff', '#3b82f6'],
        font_family: body.config.font_family || 'Inter',
        text_components: (body.config.text_components || []).map(tc => ({
          ...tc,
          type: 'text' as const,
          style: {
            fontSize: tc.style?.fontSize || 48,
            color: tc.style?.color || '#FFFFFF',
            fontWeight: tc.style?.fontWeight || 'bold',
            backgroundColor: tc.style?.backgroundColor,
          },
        })),
        broll_components: (body.config.broll_components || []).map(bc => ({
          ...bc,
          type: 'broll' as const,
          transition_out: bc.transition_out || 'fade',
        })),
        chapter_components: (body.config.chapter_components || []).map(cc => ({
          ...cc,
          type: 'chapter' as const,
          style: cc.style || 'minimal',
        })),
      },
      pip: body.pip || {
        enabled: true,
        position: 'bottom-right' as const,
        size: 'medium' as const,
      },
      width: body.width || 1080,
      height: body.height || 1920,
    };
    
    console.log('[Remotion Render] 选择合成...');
    
    // 选择合成
    const composition = await selectComposition({
      serveUrl: bundlePath,
      id: 'RemotionConfigComposition',
      inputProps,
    });
    
    console.log('[Remotion Render] 合成信息:', {
      id: composition.id,
      durationInFrames: composition.durationInFrames,
      fps: composition.fps,
      width: composition.width,
      height: composition.height,
    });
    
    // 创建临时输出文件
    const outputFormat = body.outputFormat || 'mp4';
    const outputPath = path.join(os.tmpdir(), `remotion-${Date.now()}.${outputFormat}`);
    
    console.log('[Remotion Render] 开始渲染到:', outputPath);
    
    // 执行渲染
    await renderMedia({
      composition,
      serveUrl: bundlePath,
      codec: outputFormat === 'webm' ? 'vp8' : 'h264',
      outputLocation: outputPath,
      inputProps,
      // 性能优化
      concurrency: 2,
      onProgress: ({ progress }) => {
        if (Math.round(progress * 100) % 10 === 0) {
          console.log(`[Remotion Render] 渲染进度: ${Math.round(progress * 100)}%`);
        }
      },
    });
    
    const renderTime = Date.now() - startTime;
    console.log(`[Remotion Render] 渲染完成，耗时: ${renderTime}ms`);
    
    // 读取渲染结果
    const videoBuffer = fs.readFileSync(outputPath);
    const fileSize = videoBuffer.length;
    
    // 清理临时文件
    fs.unlinkSync(outputPath);
    
    console.log(`[Remotion Render] 输出文件大小: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);
    
    // 返回视频文件
    return new NextResponse(videoBuffer, {
      status: 200,
      headers: {
        'Content-Type': outputFormat === 'webm' ? 'video/webm' : 'video/mp4',
        'Content-Length': String(fileSize),
        'Content-Disposition': `attachment; filename="remotion-render.${outputFormat}"`,
        'X-Render-Time': String(renderTime),
      },
    });
    
  } catch (error) {
    console.error('[Remotion Render] 渲染失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '渲染失败' },
      { status: 500 }
    );
  }
}

// 健康检查
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'remotion-render',
    supportedCompositions: ['RemotionConfigComposition'],
    supportedFormats: ['mp4', 'webm'],
  });
}
