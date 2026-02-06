'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Search, Film, Download, Loader2, Sparkles, Check, AlertCircle, Target, Wand2, RefreshCw } from 'lucide-react';
import { RabbitLoader } from '@/components/common/RabbitLoader';
import { useEditorStore } from '../store/editor-store';
import { toast } from '@/lib/stores/toast-store';
import { brollApi, type BRollVideo, type KlingTask } from '@/lib/api/broll';
import { generateBRollClips, getSessionByProject } from '../lib/workspace-api';
import { clipsApi } from '@/lib/api';

interface BRollPanelProps {
  onClose: () => void;
}

type SourceType = 'pexels' | 'kling';

export function BRollPanel({ onClose }: BRollPanelProps) {
  // 状态
  const [activeSource, setActiveSource] = useState<SourceType>('pexels');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [videos, setVideos] = useState<BRollVideo[]>([]);
  const [page, setPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [downloadingIds, setDownloadingIds] = useState<Set<number>>(new Set());
  const [downloadedIds, setDownloadedIds] = useState<Set<number>>(new Set());
  
  // Kling AI 相关状态
  const [klingPrompt, setKlingPrompt] = useState('');
  const [klingDuration, setKlingDuration] = useState('5');
  const [klingAspectRatio, setKlingAspectRatio] = useState('16:9');
  const [klingTasks, setKlingTasks] = useState<KlingTask[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // AI 生成 B-Roll 相关状态
  const [isGeneratingBRoll, setIsGeneratingBRoll] = useState(false);
  
  const projectId = useEditorStore((s) => s.projectId);
  const loadClips = useEditorStore((s) => s.loadClips);
  
  // B-Roll placeholder 相关状态
  const brollInitialKeywords = useEditorStore((s) => s.brollInitialKeywords);
  const activeBrollPlaceholderId = useEditorStore((s) => s.activeBrollPlaceholderId);
  const setBrollInitialKeywords = useEditorStore((s) => s.setBrollInitialKeywords);
  const setActiveBrollPlaceholderId = useEditorStore((s) => s.setActiveBrollPlaceholderId);
  const updateClip = useEditorStore((s) => s.updateClip);
  const clips = useEditorStore((s) => s.clips);
  
  // 获取当前激活的 placeholder clip
  const activePlaceholderClip = activeBrollPlaceholderId 
    ? clips.find(c => c.id === activeBrollPlaceholderId) 
    : null;
  
  // 初始化搜索关键词（从 placeholder 点击传入）
  const initializedRef = useRef(false);
  useEffect(() => {
    if (brollInitialKeywords.length > 0 && !initializedRef.current) {
      const query = brollInitialKeywords.join(' ');
      setSearchQuery(query);
      // 自动触发搜索
      searchBRoll(query, activeSource, 1);
      initializedRef.current = true;
    }
  }, [brollInitialKeywords, activeSource]);
  
  // 面板关闭时清理状态
  const handleClose = useCallback(() => {
    setBrollInitialKeywords([]);
    setActiveBrollPlaceholderId(null);
    initializedRef.current = false;
    onClose();
  }, [onClose, setBrollInitialKeywords, setActiveBrollPlaceholderId]);

  // 获取 loadAssets 用于刷新素材列表
  const loadAssets = useEditorStore((s) => s.loadAssets);
  
  // ★ 获取 loadTracks 用于刷新轨道列表（确保新建的 B-Roll track 同步）
  const loadTracks = useEditorStore((s) => s.loadTracks);

  // ★★★ AI 自动生成 B-Roll ★★★
  const handleGenerateBRoll = useCallback(async () => {
    if (!projectId) {
      toast.error('请先打开一个项目');
      return;
    }
    
    setIsGeneratingBRoll(true);
    toast.info('🎬 正在 AI 分析视频内容，生成 B-Roll...');
    
    try {
      // 1. 获取 sessionId
      const sessionInfo = await getSessionByProject(projectId);
      const sessionId = sessionInfo.session_id;
      
      if (!sessionId) {
        throw new Error('未找到关联的会话');
      }
      
      console.log('[BRollPanel] 获取到 sessionId:', sessionId);
      
      // 2. 调用生成 B-Roll API
      const result = await generateBRollClips(sessionId);
      
      console.log('[BRollPanel] B-Roll 生成结果:', result);
      
      // ★ 后端返回 status: "completed"，不是 "success"
      if ((result.status === 'completed' || result.status === 'success') && result.broll_clips_created > 0) {
        toast.success(`✅ 成功启动 ${result.broll_clips_created} 个 B-Roll 下载任务，请在素材面板查看进度`);
        
        // ★ 立即刷新一次 assets，让用户看到正在下载的素材
        await loadAssets?.();
        
        // 3. 启动轮询检测新 B-Roll clips
        // ★★★ 优化：轮询期间只通过 API 检查 clips 数量，不更新 store ★★★
        // 避免频繁刷新导致视频播放器重新初始化
        let pollCount = 0;
        const maxPolls = 60;
        let lastBrollCount = 0;
        
        const pollInterval = setInterval(async () => {
          pollCount++;
          console.log(`[BRollPanel] 轮询 B-Roll 创建状态 (${pollCount}/${maxPolls})...`);
          
          try {
            // ★★★ 通过 API 直接查询 clips，不更新 store ★★★
            // 这样不会触发视频播放器重新初始化
            const response = await clipsApi.getClipsByProject(projectId!);
            const allClips = response.data || [];
            
            // 计算 B-Roll clips 数量
            const brollClips = allClips.filter(
              c => c.clipType === 'video' && c.metadata?.is_broll === true
            );
            
            const currentBrollCount = brollClips.length;
            console.log(`[BRollPanel] 当前 B-Roll clips: ${currentBrollCount}`);
            
            // 检测是否有新的 B-Roll 添加
            if (currentBrollCount > lastBrollCount) {
              console.log(`[BRollPanel] ✅ 新增 ${currentBrollCount - lastBrollCount} 个 B-Roll`);
              lastBrollCount = currentBrollCount;
              // ★ 只刷新 assets 面板，让用户看到下载进度
              await loadAssets?.();
            }
            
            // 检查是否所有任务都完成（当前 broll 数量 >= 启动的任务数）
            if (currentBrollCount >= result.broll_clips_created) {
              clearInterval(pollInterval);
              // ★★★ 所有下载完成后，一次性刷新 clips 和 tracks ★★★
              await Promise.all([loadClips?.(), loadTracks?.()]);
              toast.success(`✅ 所有 ${currentBrollCount} 个 B-Roll 下载完成！`);
              console.log('[BRollPanel] ✅ 所有 B-Roll 下载完成，停止轮询');
              return;
            }
            
            // 超时检查
            if (pollCount >= maxPolls) {
              clearInterval(pollInterval);
              // ★ 超时也要刷新一次 clips 和 tracks
              await Promise.all([loadClips?.(), loadTracks?.()]);
              toast.warning(`已创建 ${currentBrollCount}/${result.broll_clips_created} 个 B-Roll，部分仍在下载中`);
              console.log('[BRollPanel] ⏱️ 轮询超时，停止');
            }
          } catch (pollError) {
            console.error('[BRollPanel] 轮询失败:', pollError);
          }
        }, 3000);
        
      } else if (result.broll_clips_created === 0) {
        toast.info('AI 分析后未找到适合插入 B-Roll 的位置');
      } else {
        toast.warning(result.message || 'B-Roll 生成完成');
      }
      
    } catch (error) {
      console.error('[BRollPanel] 生成 B-Roll 失败:', error);
      toast.error('生成 B-Roll 失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setIsGeneratingBRoll(false);
    }
  }, [projectId, loadClips, loadAssets, loadTracks]);

  // 搜索 B roll
  const searchBRoll = useCallback(async (query: string, source: SourceType, pageNum: number = 1) => {
    if (source === 'kling') return; // Kling不支持搜索
    if (!query.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await brollApi.searchVideos(query, pageNum, 20);
      
      if (response.error || !response.data) {
        throw new Error(response.error?.message || '搜索失败');
      }
      
      const data = response.data;
      
      if (pageNum === 1) {
        setVideos(data.videos || []);
      } else {
        setVideos(prev => [...prev, ...(data.videos || [])]);
      }
      setTotalResults(data.total_results || 0);
      setPage(pageNum);
    } catch (error) {
      console.error('搜索B roll失败:', error);
      toast.error('搜索失败，请重试');
      setVideos([]);
      setTotalResults(0);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // 处理搜索
  const handleSearch = useCallback(() => {
    searchBRoll(searchQuery, activeSource, 1);
  }, [searchQuery, activeSource, searchBRoll]);

  // 加载更多
  const handleLoadMore = useCallback(() => {
    searchBRoll(searchQuery, activeSource, page + 1);
  }, [searchQuery, activeSource, page, searchBRoll]);

  // 下载视频
  const handleDownload = useCallback(async (video: BRollVideo) => {
    if (downloadingIds.has(video.id) || downloadedIds.has(video.id)) return;
    if (!projectId) {
      toast.error('请先打开一个项目');
      return;
    }

    setDownloadingIds(prev => new Set(prev).add(video.id));
    
    try {
      const videoUrl = getBestVideoUrl(video);
      
      const response = await brollApi.downloadBRoll({
        project_id: projectId,
        video: {
          id: video.id,
          url: videoUrl,
          width: video.width,
          height: video.height,
          duration: video.duration,
          thumbnail: video.image,
          source: activeSource,
          author: video.user.name,
          author_url: video.user.url,
          original_url: video.url,
        },
      });
      
      if (response.error || !response.data) {
        throw new Error(response.error?.message || '下载失败');
      }
      
      toast.info('视频正在下载中...');
      
      // 使用 waitForDownload 轮询下载状态
      const taskId = response.data.task_id;
      
      try {
        const finalStatus = await brollApi.waitForDownload(
          taskId,
          (status) => {
            // 更新进度提示（可选）
            if (status.status === 'downloading' && status.progress) {
              console.log(`[BRollPanel] 下载进度: ${status.progress}%`);
            }
          }
        );
        
        if (finalStatus.status === 'failed') {
          throw new Error(finalStatus.error || '下载失败');
        }
        
        const assetId = finalStatus.asset_id;
        console.log('[BRollPanel] ✅ B-roll 下载完成，asset_id:', assetId);
        
        // 从后端获取完整的 asset 信息
        const { getSupabaseClient } = await import('@/lib/supabase/session');
        const supabase = getSupabaseClient();
        
        const { data: assetData, error: fetchError } = await supabase
          .from('assets')
          .select('*')
          .eq('id', assetId)
          .single();
        
        if (fetchError || !assetData) {
          console.error('[BRollPanel] 获取 asset 信息失败:', fetchError);
          throw new Error('无法获取 asset 信息');
        }
        
        // 类型断言
        const asset = assetData as {
          id: string;
          storage_path: string;
          original_filename?: string;
          name?: string;
          file_size?: number;
          duration?: number;
          width?: number;
          height?: number;
          created_at: string;
          updated_at: string;
        };
        
        // 计算宽高比（仅支持 16:9 和 9:16，其他比例归类到最接近的）
        let aspectRatio: '16:9' | '9:16' | undefined;
        if (asset.width && asset.height) {
          const ratio = asset.width / asset.height;
          aspectRatio = ratio > 1 ? '16:9' : '9:16';
        }
        
        // 使用后端代理 URL（和正常上传一样，避免 CORS 问题）
        const { getAssetStreamUrl } = await import('@/lib/api/media-proxy');
        const assetUrl = getAssetStreamUrl(assetId);
        console.log('[BRollPanel] 生成代理 URL:', assetUrl);
        
        // 添加 asset 到 store
        const brollAsset = {
          id: assetId,
          project_id: projectId,
          type: 'video' as const,
          url: assetUrl,  // 使用后端代理 URL，和正常上传完全一样
          storage_path: asset.storage_path,
          file_name: asset.original_filename || asset.name || `broll-${video.id}.mp4`,
          file_size: asset.file_size || 0,
          mime_type: 'video/mp4',
          duration: asset.duration,
          width: asset.width,
          height: asset.height,
          metadata: {
            source: activeSource,
            sourceId: video.id,
            photographer: video.user.name,
            thumbnail: video.image,
            aspectRatio,
          },
          is_generated: false,
          status: 'ready' as const,
          processing_progress: 100,
          created_at: asset.created_at,
          updated_at: asset.updated_at,
        };
        
        // 添加到 editor store（资源库会自动更新）
        useEditorStore.setState((state) => ({ 
          assets: [...(state.assets || []), brollAsset as any] 
        }));
        
        console.log('[BRollPanel] ✅ B-roll asset 已添加到资源库:', assetId);
        
        // ★★★ 如果有激活的 placeholder，自动替换素材 ★★★
        if (activeBrollPlaceholderId && activePlaceholderClip) {
          console.log('[BRollPanel] 🔄 替换 placeholder clip:', activeBrollPlaceholderId);
          updateClip(activeBrollPlaceholderId, {
            assetId: assetId,
            mediaUrl: assetUrl,
            thumbnail: video.image,
            name: `B-Roll: ${video.user.name}`,
            metadata: {
              ...activePlaceholderClip.metadata,
              is_placeholder: false,  // 不再是占位符
              source: activeSource,
              sourceId: video.id,
              photographer: video.user.name,
            },
          });
          
          // 清理 placeholder 状态
          setActiveBrollPlaceholderId(null);
          setBrollInitialKeywords([]);
          
          toast.success('B-Roll 素材已替换！');
        } else {
          toast.success('视频已添加到资源库！可拖拽到时间线使用');
        }
        
        setDownloadingIds(prev => {
          const next = new Set(prev);
          next.delete(video.id);
          return next;
        });
        setDownloadedIds(prev => new Set(prev).add(video.id));
        
      } catch (pollError) {
        console.error('[BRollPanel] 轮询下载状态失败:', pollError);
        throw pollError;
      }
      
    } catch (error) {
      console.error('下载视频失败:', error);
      toast.error(`下载失败: ${error instanceof Error ? error.message : '请重试'}`);
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(video.id);
        return next;
      });
    }
  }, [downloadingIds, downloadedIds, projectId, activeSource, activeBrollPlaceholderId, activePlaceholderClip, updateClip, setActiveBrollPlaceholderId, setBrollInitialKeywords]);

  // Kling AI 生成视频
  const handleKlingGenerate = useCallback(async () => {
    if (!klingPrompt.trim()) {
      toast.error('请输入场景描述');
      return;
    }
    if (!projectId) {
      toast.error('请先打开一个项目');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await brollApi.klingTextToVideo({
        project_id: projectId,
        prompt: klingPrompt,
        duration: parseInt(klingDuration),
        aspect_ratio: klingAspectRatio,
        mode: 'standard',
      });
      
      if (response.error || !response.data) {
        throw new Error(response.error?.message || '生成失败');
      }
      
      toast.success('AI 视频生成已开始，请在任务列表查看进度');
      
      // 刷新任务列表
      await loadKlingTasks();
      setKlingPrompt('');
      
    } catch (error) {
      console.error('生成视频失败:', error);
      toast.error('生成失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  }, [klingPrompt, klingDuration, klingAspectRatio, projectId]);

  // 加载 Kling 任务列表
  const loadKlingTasks = useCallback(async () => {
    if (!projectId) return;
    
    try {
      const response = await brollApi.getKlingTasks(projectId);
      if (response.error || !response.data) return;
      
      setKlingTasks(response.data.tasks || []);
    } catch (error) {
      console.error('加载 Kling 任务失败:', error);
    }
  }, [projectId]);

  // 切换来源时加载数据
  const handleSourceChange = useCallback((source: SourceType) => {
    setActiveSource(source);
    setVideos([]);
    setTotalResults(0);
    setPage(1);
    
    if (source === 'kling') {
      loadKlingTasks();
    }
  }, [loadKlingTasks]);

  // 格式化时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 获取最佳质量视频链接
  const getBestVideoUrl = (video: BRollVideo): string => {
    const hdVideo = video.video_files.find(f => f.quality === 'hd');
    if (hdVideo) return hdVideo.link;
    const sorted = [...video.video_files].sort((a, b) => b.width - a.width);
    return sorted[0]?.link || '';
  };

  // 处理拖拽开始
  const handleDragStart = (e: React.DragEvent, video: BRollVideo) => {
    const videoUrl = getBestVideoUrl(video);
    
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'b-roll',
      video: {
        id: video.id,
        url: videoUrl,
        duration: video.duration,
        width: video.width,
        height: video.height,
        thumbnail: video.image,
        source: activeSource,
        photographer: video.user.name,
        pexelsUrl: video.url,
      },
    }));
    e.dataTransfer.effectAllowed = 'copy';
    
    const img = new Image();
    img.src = video.image;
    e.dataTransfer.setDragImage(img, 20, 20);
  };

  // 默认热门关键词
  const popularKeywords = ['nature', 'city', 'business', 'technology', 'people', 'food', 'travel', 'sunset'];

  return (
    <div className="w-full h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Film className="w-5 h-5" />
            B-roll 素材库
            {activePlaceholderClip && (
              <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full flex items-center gap-1">
                <Target size={12} />
                替换模式
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {/* ★ AI 生成 B-Roll 按钮 */}
            <button
              onClick={handleGenerateBRoll}
              disabled={isGeneratingBRoll}
              className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-blue-500 text-white text-sm font-medium rounded-lg hover:from-purple-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
              title="AI 自动分析视频内容并生成 B-Roll"
            >
              {isGeneratingBRoll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  AI 生成
                </>
              )}
            </button>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 hover:text-gray-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* 替换模式提示 */}
        {activePlaceholderClip && (
          <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            <span className="font-medium">正在为 B-Roll 选择素材</span>
            <span className="mx-1">•</span>
            <span>选择素材后将自动替换到时间线</span>
          </div>
        )}

        {/* 来源选择器 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => handleSourceChange('pexels')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSource === 'pexels'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Pexels
          </button>
          <button
            onClick={() => handleSourceChange('kling')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              activeSource === 'kling'
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Kling AI
          </button>
        </div>

        {/* 搜索框（仅 Pexels/Pixabay） */}
        {activeSource !== 'kling' && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索 Pexels 视频..."
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* 快捷关键词 */}
            <div className="flex flex-wrap gap-2 mt-3">
              {popularKeywords.map((keyword) => (
                <button
                  key={keyword}
                  onClick={() => {
                    setSearchQuery(keyword);
                    searchBRoll(keyword, activeSource, 1);
                  }}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors"
                >
                  {keyword}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {activeSource === 'kling' ? (
          <KlingAIInterface
            prompt={klingPrompt}
            setPrompt={setKlingPrompt}
            duration={klingDuration}
            setDuration={setKlingDuration}
            aspectRatio={klingAspectRatio}
            setAspectRatio={setKlingAspectRatio}
            isGenerating={isGenerating}
            onGenerate={handleKlingGenerate}
            tasks={klingTasks}
            onRefresh={loadKlingTasks}
          />
        ) : (
          <VideoGrid
            videos={videos}
            isSearching={isSearching}
            totalResults={totalResults}
            source={activeSource}
            downloadingIds={downloadingIds}
            downloadedIds={downloadedIds}
            onDownload={handleDownload}
            onDragStart={handleDragStart}
            onLoadMore={handleLoadMore}
            formatDuration={formatDuration}
          />
        )}
      </div>
    </div>
  );
}

// Kling AI 生成界面组件
function KlingAIInterface({
  prompt,
  setPrompt,
  duration,
  setDuration,
  aspectRatio,
  setAspectRatio,
  isGenerating,
  onGenerate,
  tasks,
  onRefresh,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  duration: string;
  setDuration: (v: string) => void;
  aspectRatio: string;
  setAspectRatio: (v: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  tasks: KlingTask[];
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* 生成表单 */}
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          AI 视频生成
        </h4>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              描述场景
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如: A beautiful sunset over the ocean with birds flying..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                时长
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="5">5 秒</option>
                <option value="10">10 秒</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                比例
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="16:9">16:9 横屏</option>
                <option value="9:16">9:16 竖屏</option>
              </select>
            </div>
          </div>

          <button
            onClick={onGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg font-medium hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                生成视频
              </>
            )}
          </button>
        </div>
      </div>

      {/* 生成历史 */}
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-semibold text-gray-900">生成历史</h4>
          <button
            onClick={onRefresh}
            className="text-sm text-blue-500 hover:text-blue-600"
          >
            刷新
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            暂无生成记录
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.task_id}
                className="p-3 bg-gray-50 rounded-lg flex items-start gap-3"
              >
                <div className="flex-shrink-0 mt-1">
                  {task.status === 'completed' ? (
                    <Check className="w-5 h-5 text-green-500" />
                  ) : task.status === 'failed' ? (
                    <AlertCircle className="w-5 h-5 text-red-500" />
                  ) : (
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {task.prompt}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {task.status === 'completed' && '已完成'}
                    {task.status === 'processing' && '生成中...'}
                    {task.status === 'failed' && '生成失败'}
                  </p>
                </div>
                {task.status === 'completed' && task.video_url && (
                  <button
                    className="flex-shrink-0 px-3 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    onClick={() => {
                      // 可以添加预览或下载逻辑
                      window.open(task.video_url, '_blank');
                    }}
                  >
                    查看
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 视频网格组件
function VideoGrid({
  videos,
  isSearching,
  totalResults,
  source,
  downloadingIds,
  downloadedIds,
  onDownload,
  onDragStart,
  onLoadMore,
  formatDuration,
}: {
  videos: BRollVideo[];
  isSearching: boolean;
  totalResults: number;
  source: SourceType;
  downloadingIds: Set<number>;
  downloadedIds: Set<number>;
  onDownload: (video: BRollVideo) => void;
  onDragStart: (e: React.DragEvent, video: BRollVideo) => void;
  onLoadMore: () => void;
  formatDuration: (seconds: number) => string;
}) {
  if (isSearching && videos.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <RabbitLoader size={64} />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <Film className="w-16 h-16 mb-4 text-gray-300" />
        <p className="text-sm">搜索免费高质量 B-roll 视频</p>
        <p className="text-xs mt-1">由 Pexels 提供</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 text-sm text-gray-600">
        找到 {totalResults} 个结果
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        {videos.map((video) => (
          <div
            key={video.id}
            draggable
            onDragStart={(e) => onDragStart(e, video)}
            className="group relative bg-white rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all cursor-move"
          >
            <div className="aspect-video relative overflow-hidden bg-gray-100">
              <img
                src={video.image}
                alt=""
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all" />
              
              {/* 时长标签 */}
              <div className="absolute bottom-2 right-2 px-2 py-1 bg-black bg-opacity-75 text-white text-xs rounded">
                {formatDuration(video.duration)}
              </div>

              {/* 下载按钮 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(video);
                }}
                disabled={downloadingIds.has(video.id) || downloadedIds.has(video.id)}
                className="absolute top-2 right-2 p-2 bg-white rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
              >
                {downloadingIds.has(video.id) ? (
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                ) : downloadedIds.has(video.id) ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Download className="w-4 h-4 text-gray-700" />
                )}
              </button>
            </div>

            <div className="p-3">
              <div className="text-xs text-gray-600">
                {video.width} × {video.height} · {video.user.name}
              </div>
            </div>
          </div>
        ))}
      </div>

      {videos.length < totalResults && (
        <div className="mt-6 text-center">
          <button
            onClick={onLoadMore}
            disabled={isSearching}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {isSearching ? '加载中...' : '加载更多'}
          </button>
        </div>
      )}
    </>
  );
}
