'use client';

/**
 * 用户素材库视图组件
 * 显示用户上传的数字人形象和声音样本
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  User,
  Mic2,
  Upload,
  Heart,
  MoreVertical,
  Trash2,
  Edit3,
  Loader2,
  Image as ImageIcon,
  Music,
  Play,
  Pause,
  CheckCircle,
  AlertCircle,
  Plus
} from 'lucide-react';
import { 
  materialsApi, 
  type UserMaterial, 
  type AvatarItem, 
  type VoiceSampleItem,
  type MaterialType 
} from '@/lib/api/materials';
import { LepusLoader } from '@/components/common/LepusLoader';
import { toast } from '@/lib/stores/toast-store';

// ============================================
// 类型定义
// ============================================

type SubTab = 'avatars' | 'voices' | 'general';

interface UploadState {
  uploading: boolean;
  progress: number;
  materialType: MaterialType | null;
}

// ============================================
// 数字人形象卡片
// ============================================

interface AvatarCardProps {
  avatar: AvatarItem;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string, current: boolean) => void;
  onSetDefault: (id: string) => void;
  isDefault?: boolean;
}

function AvatarCard({ avatar, onDelete, onToggleFavorite, onSetDefault, isDefault }: AvatarCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  
  return (
    <div className="group relative bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-gray-300 hover:shadow-lg transition-all">
      {/* 图片预览 */}
      <div className="aspect-square bg-gray-100 relative">
        <img 
          src={avatar.url} 
          alt={avatar.name}
          className="w-full h-full object-cover"
        />
        
        {/* 默认标记 */}
        {isDefault && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-gray-700 text-white text-xs rounded-full">
            默认
          </div>
        )}
        
        {/* 收藏按钮 */}
        <button
          onClick={() => onToggleFavorite(avatar.id, avatar.is_favorite)}
          className="absolute top-2 right-2 p-1.5 bg-white/80 rounded-full hover:bg-white transition-colors"
        >
          <Heart 
            size={14} 
            className={avatar.is_favorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}
          />
        </button>
        
        {/* 操作菜单 */}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 bg-white/80 rounded-full hover:bg-white transition-colors"
            >
              <MoreVertical size={14} className="text-gray-600" />
            </button>
            
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute bottom-full right-0 mb-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20 min-w-[120px]">
                  <button
                    onClick={() => { onSetDefault(avatar.id); setShowMenu(false); }}
                    className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <CheckCircle size={14} />
                    设为默认
                  </button>
                  <button
                    onClick={() => { onDelete(avatar.id); setShowMenu(false); }}
                    className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* 信息 */}
      <div className="p-3">
        <h3 className="text-sm font-medium text-gray-900 truncate">{avatar.name}</h3>
        <p className="text-xs text-gray-500 mt-0.5">使用 {avatar.usage_count} 次</p>
      </div>
    </div>
  );
}

// ============================================
// 声音样本卡片
// ============================================

interface VoiceSampleCardProps {
  voice: VoiceSampleItem;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
  onSetDefault: (id: string, type: 'sample' | 'clone') => void;
  isDefault?: boolean;
}

function VoiceSampleCard({ voice, onDelete, onClone, onSetDefault, isDefault }: VoiceSampleCardProps) {
  const [playing, setPlaying] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  const togglePlay = () => {
    if (!audioRef.current) return;
    
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };
  
  const audioUrl = voice.type === 'sample' ? voice.url : voice.preview_url;
  
  return (
    <div className="group flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-md transition-all">
      {/* 播放按钮 */}
      <button
        onClick={togglePlay}
        disabled={!audioUrl}
        className="w-12 h-12 flex-shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors disabled:opacity-50"
      >
        {playing ? (
          <Pause size={20} className="text-gray-700" />
        ) : (
          <Play size={20} className="text-gray-700 ml-0.5" />
        )}
      </button>
      
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
        />
      )}
      
      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-900 truncate">{voice.name}</h3>
          {voice.type === 'clone' && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">
              已克隆
            </span>
          )}
          {isDefault && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">
              默认
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          {voice.duration && <span>{Math.round(voice.duration)}秒</span>}
          {voice.language && <span>{voice.language === 'zh' ? '中文' : voice.language}</span>}
          {voice.usage_count !== undefined && <span>使用 {voice.usage_count} 次</span>}
        </div>
      </div>
      
      {/* 操作按钮 */}
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {voice.type === 'sample' && !voice.is_cloned && (
          <button
            onClick={() => onClone(voice.id)}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            克隆声音
          </button>
        )}
        
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <MoreVertical size={16} className="text-gray-500" />
          </button>
          
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20 min-w-[120px]">
                <button
                  onClick={() => { onSetDefault(voice.id, voice.type); setShowMenu(false); }}
                  className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <CheckCircle size={14} />
                  设为默认
                </button>
                <button
                  onClick={() => { onDelete(voice.id); setShowMenu(false); }}
                  className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 size={14} />
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// 上传区域组件
// ============================================

interface UploadAreaProps {
  materialType: MaterialType;
  acceptTypes: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  onUpload: (file: File, type: MaterialType) => void;
  uploading: boolean;
  progress: number;
}

function UploadArea({ materialType, acceptTypes, icon, title, description, onUpload, uploading, progress }: UploadAreaProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file, materialType);
  };
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file, materialType);
    e.target.value = '';
  };
  
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !uploading && inputRef.current?.click()}
      className={`
        relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
        ${dragOver ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
        ${uploading ? 'pointer-events-none' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptTypes}
        onChange={handleFileSelect}
        className="hidden"
      />
      
      {uploading ? (
        <div className="py-4">
          <LepusLoader size={32} />
          <p className="text-sm text-gray-600 mt-3">上传中 {progress}%</p>
          <div className="w-full h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden">
            <div 
              className="h-full bg-gray-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-3">
            {icon}
          </div>
          <p className="text-sm font-medium text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 mt-1">{description}</p>
        </>
      )}
    </div>
  );
}

// ============================================
// 主组件
// ============================================

export function UserMaterialsView() {
  // 当前子标签
  const [subTab, setSubTab] = useState<SubTab>('avatars');
  
  // 数据状态
  const [avatars, setAvatars] = useState<AvatarItem[]>([]);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSampleItem[]>([]);
  const [defaultAvatarId, setDefaultAvatarId] = useState<string | null>(null);
  const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(null);
  const [defaultVoiceType, setDefaultVoiceType] = useState<'preset' | 'cloned'>('preset');
  
  // 加载状态
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 上传状态
  const [uploadState, setUploadState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    materialType: null,
  });
  
  // 克隆状态
  const [cloning, setCloning] = useState<string | null>(null);
  
  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // 并行加载
      const [avatarsRes, voicesRes, prefsRes] = await Promise.all([
        materialsApi.getAvatars(50),
        materialsApi.getVoiceSamples({ include_clones: true, limit: 50 }),
        materialsApi.getPreferences(),
      ]);
      
      if (avatarsRes.data) {
        setAvatars(avatarsRes.data.items);
      }
      if (voicesRes.data) {
        setVoiceSamples(voicesRes.data.items);
      }
      if (prefsRes.data) {
        setDefaultAvatarId(prefsRes.data.default_avatar_id || null);
        setDefaultVoiceId(prefsRes.data.default_voice_id || null);
        setDefaultVoiceType(prefsRes.data.default_voice_type || 'preset');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    loadData();
  }, [loadData]);
  
  // 上传素材
  const handleUpload = async (file: File, materialType: MaterialType) => {
    setUploadState({ uploading: true, progress: 0, materialType });
    
    try {
      const result = await materialsApi.uploadMaterial(file, materialType, {
        displayName: file.name.replace(/\.[^/.]+$/, ''),
        onProgress: (progress) => {
          setUploadState(prev => ({ ...prev, progress }));
        },
      });
      
      if (result.error) {
        toast.error(`上传失败: ${result.error.message}`);
      } else {
        toast.success('上传成功');
        // 刷新列表
        if (materialType === 'avatar') {
          const res = await materialsApi.getAvatars(50);
          if (res.data) setAvatars(res.data.items);
        } else if (materialType === 'voice_sample') {
          const res = await materialsApi.getVoiceSamples({ include_clones: true, limit: 50 });
          if (res.data) setVoiceSamples(res.data.items);
        }
      }
    } catch (err) {
      toast.error(`上传失败: ${String(err)}`);
    } finally {
      setUploadState({ uploading: false, progress: 0, materialType: null });
    }
  };
  
  // 删除素材
  const handleDelete = async (id: string, type: 'avatar' | 'voice') => {
    if (!confirm('确定要删除这个素材吗？')) return;
    
    try {
      const result = await materialsApi.deleteMaterial(id);
      if (result.error) {
        toast.error(`删除失败: ${result.error.message}`);
      } else {
        toast.success('已删除');
        if (type === 'avatar') {
          setAvatars(prev => prev.filter(a => a.id !== id));
        } else {
          setVoiceSamples(prev => prev.filter(v => v.id !== id));
        }
      }
    } catch (err) {
      toast.error(`删除失败: ${String(err)}`);
    }
  };
  
  // 切换收藏
  const handleToggleFavorite = async (id: string, current: boolean) => {
    try {
      const result = await materialsApi.updateMaterial(id, { is_favorite: !current });
      if (result.error) {
        toast.error('操作失败');
      } else {
        setAvatars(prev => prev.map(a => 
          a.id === id ? { ...a, is_favorite: !current } : a
        ));
      }
    } catch (err) {
      toast.error('操作失败');
    }
  };
  
  // 设置默认素材
  const handleSetDefault = async (id: string, type: 'avatar' | 'voice', voiceType?: 'sample' | 'clone') => {
    try {
      const result = await materialsApi.setDefaultMaterial({
        material_type: type,
        asset_id: id,
        voice_type: voiceType === 'clone' ? 'cloned' : 'preset',
      });
      
      if (result.error) {
        toast.error('设置失败');
      } else {
        toast.success('已设为默认');
        if (type === 'avatar') {
          setDefaultAvatarId(id);
        } else {
          setDefaultVoiceId(id);
          setDefaultVoiceType(voiceType === 'clone' ? 'cloned' : 'preset');
        }
      }
    } catch (err) {
      toast.error('设置失败');
    }
  };
  
  // 克隆声音
  const handleCloneVoice = async (assetId: string) => {
    const name = prompt('请输入克隆后的声音名称：');
    if (!name) return;
    
    setCloning(assetId);
    
    try {
      const result = await materialsApi.cloneVoice({
        asset_id: assetId,
        voice_name: name,
        language: 'zh',
      });
      
      if (result.error) {
        toast.error(`克隆失败: ${result.error.message}`);
      } else {
        toast.success('声音克隆成功');
        // 刷新列表
        const res = await materialsApi.getVoiceSamples({ include_clones: true, limit: 50 });
        if (res.data) setVoiceSamples(res.data.items);
      }
    } catch (err) {
      toast.error(`克隆失败: ${String(err)}`);
    } finally {
      setCloning(null);
    }
  };
  
  // Tab 配置
  const tabs: { key: SubTab; label: string; icon: React.ReactNode }[] = [
    { key: 'avatars', label: '数字人形象', icon: <User size={16} /> },
    { key: 'voices', label: '声音样本', icon: <Mic2 size={16} /> },
  ];
  
  return (
    <div className="h-full flex flex-col">
      {/* 子标签 */}
      <div className="flex-shrink-0 px-6 pt-4 border-b border-gray-200">
        <div className="flex gap-6">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setSubTab(tab.key)}
              className={`
                pb-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors
                ${subTab === tab.key 
                  ? 'text-gray-900 border-gray-900' 
                  : 'text-gray-500 border-transparent hover:text-gray-700'}
              `}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      
      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={32} className="animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <AlertCircle size={48} className="text-red-400 mb-4" />
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={loadData}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm"
            >
              重试
            </button>
          </div>
        ) : (
          <>
            {/* 数字人形象 */}
            {subTab === 'avatars' && (
              <div className="space-y-6">
                {/* 上传区域 */}
                <UploadArea
                  materialType="avatar"
                  acceptTypes="image/png,image/jpeg,image/webp"
                  icon={<ImageIcon size={24} className="text-gray-400" />}
                  title="上传数字人形象"
                  description="支持 PNG、JPG、WebP 格式，建议正面人像照片"
                  onUpload={handleUpload}
                  uploading={uploadState.uploading && uploadState.materialType === 'avatar'}
                  progress={uploadState.progress}
                />
                
                {/* 形象列表 */}
                {avatars.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <User size={48} className="mx-auto text-gray-300 mb-4" />
                    <p>暂无数字人形象</p>
                    <p className="text-sm mt-1">上传一张照片作为你的数字人形象</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {avatars.map(avatar => (
                      <AvatarCard
                        key={avatar.id}
                        avatar={avatar}
                        onDelete={(id) => handleDelete(id, 'avatar')}
                        onToggleFavorite={handleToggleFavorite}
                        onSetDefault={(id) => handleSetDefault(id, 'avatar')}
                        isDefault={avatar.id === defaultAvatarId}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* 声音样本 */}
            {subTab === 'voices' && (
              <div className="space-y-6">
                {/* 上传区域 */}
                <UploadArea
                  materialType="voice_sample"
                  acceptTypes="audio/mpeg,audio/wav,audio/ogg,audio/mp3"
                  icon={<Music size={24} className="text-gray-400" />}
                  title="上传声音样本"
                  description="支持 MP3、WAV、OGG 格式，建议 10-60 秒清晰人声"
                  onUpload={handleUpload}
                  uploading={uploadState.uploading && uploadState.materialType === 'voice_sample'}
                  progress={uploadState.progress}
                />
                
                {/* 声音列表 */}
                {voiceSamples.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Mic2 size={48} className="mx-auto text-gray-300 mb-4" />
                    <p>暂无声音样本</p>
                    <p className="text-sm mt-1">上传一段音频作为声音克隆的样本</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {voiceSamples.map(voice => (
                      <VoiceSampleCard
                        key={voice.id}
                        voice={voice}
                        onDelete={(id) => handleDelete(id, 'voice')}
                        onClone={handleCloneVoice}
                        onSetDefault={(id, type) => handleSetDefault(id, 'voice', type)}
                        isDefault={voice.id === defaultVoiceId}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
