'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Home,
  Video,
  Trash2,
  Sparkles,
  ChevronDown,
  Download,
  ChevronRight,
  Mic,
  Wand2,
  Film,
  Images,
  Move,
  Clock,
  UserCircle,
  Image,
  Layers
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export type SidebarTab = 'home' | 'videos' | 'ai-creations' | 'trash' | 'rabbit-hole' | 'exports';

// Rabbit Hole 功能列表配置
const rabbitHoleFeatures = {
  video: [
    { id: 'lip-sync', title: '口型同步', subtitle: 'Lip Sync', icon: Mic, badge: 'hot' as const },
    { id: 'text-to-video', title: '文生视频', subtitle: 'Text to Video', icon: Wand2, badge: 'new' as const },
    { id: 'image-to-video', title: '图生视频', subtitle: 'Image to Video', icon: Film },
    { id: 'multi-image-to-video', title: '多图生视频', subtitle: 'Multi-Image', icon: Images },
    { id: 'motion-control', title: '动作控制', subtitle: 'Motion Control', icon: Move, badge: 'new' as const },
    { id: 'video-extend', title: '视频延长', subtitle: 'Video Extend', icon: Clock },
    { id: 'face-swap', title: 'AI 换脸', subtitle: 'Face Swap', icon: UserCircle },
  ],
  image: [
    { id: 'image-generation', title: '图像生成', subtitle: 'Image Gen', icon: Image },
    { id: 'omni-image', title: 'Omni-Image', subtitle: '多模态图像', icon: Layers, badge: 'new' as const },
  ],
};

interface SidebarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onRabbitHoleFeatureSelect?: (featureId: string) => void;
}

export function Sidebar({ activeTab, onTabChange, onRabbitHoleFeatureSelect }: SidebarProps) {
  const router = useRouter();
  const [isRabbitHoleHovered, setIsRabbitHoleHovered] = useState(false);
  const [flyoutPosition, setFlyoutPosition] = useState({ top: 0, left: 0 });
  const rabbitHoleButtonRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  // 更新 flyout 位置
  useEffect(() => {
    if (isRabbitHoleHovered && rabbitHoleButtonRef.current) {
      const rect = rabbitHoleButtonRef.current.getBoundingClientRect();
      setFlyoutPosition({
        top: rect.top,
        left: rect.right + 8, // 8px gap
      });
    }
  }, [isRabbitHoleHovered]);

  const mainNavItems = [
    {
      id: 'home' as SidebarTab,
      label: '首页',
      icon: Home,
    },
  ];

  const videoNavItems = [
    {
      id: 'videos' as SidebarTab,
      label: '视频',
      icon: Video,
    },
    {
      id: 'ai-creations' as SidebarTab,
      label: 'AI 创作',
      icon: Sparkles,
      badge: 'new',
    },
    {
      id: 'exports' as SidebarTab,
      label: '导出记录',
      icon: Download,
    },
    {
      id: 'trash' as SidebarTab,
      label: '回收站',
      icon: Trash2,
    },
  ];

  const NavItem = ({ item, isActive }: { item: typeof mainNavItems[0] & { badge?: string }, isActive: boolean }) => {
    const Icon = item.icon;
    return (
      <button
        onClick={() => onTabChange(item.id)}
        className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-all duration-150
          ${isActive 
            ? 'bg-gray-100 text-gray-900 font-semibold' 
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
      >
        <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
        <span className="text-sm flex-1">{item.label}</span>
        {item.badge && (
          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded">
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  const handleFeatureClick = (featureId: string) => {
    // 先切换到 rabbit-hole tab，然后传递选中的功能
    onTabChange('rabbit-hole');
    onRabbitHoleFeatureSelect?.(featureId);
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-white border-r border-gray-200 flex flex-col z-50">
      {/* Logo & Workspace Selector */}
      <div className="h-14 px-4 flex items-center border-b border-gray-100">
        <div 
          className="flex items-center space-x-2.5 cursor-pointer group"
          onClick={() => router.push('/workspace')}
        >
          <div className="w-8 h-8 flex items-center justify-center overflow-hidden">
            <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <div className="flex items-center space-x-1">
            <span className="text-sm font-bold tracking-tight text-gray-900">
              Workspace
            </span>
            <ChevronDown size={14} className="text-gray-400" />
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {/* Main */}
        <div className="space-y-0.5">
          {mainNavItems.map((item) => (
            <NavItem key={item.id} item={item} isActive={activeTab === item.id} />
          ))}
        </div>

        {/* Videos Section */}
        <div className="mt-6">
          <p className="px-3 mb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            视频
          </p>
          <div className="space-y-0.5">
            {videoNavItems.map((item) => (
              <NavItem key={item.id} item={item} isActive={activeTab === item.id} />
            ))}
          </div>
        </div>

        {/* Tools Section - Rabbit Hole with Flyout */}
        <div className="mt-6">
          <p className="px-3 mb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            工具
          </p>
          <div className="relative">
            {/* Rabbit Hole Button */}
            <button
              ref={rabbitHoleButtonRef}
              onMouseEnter={() => setIsRabbitHoleHovered(true)}
              onMouseLeave={() => setIsRabbitHoleHovered(false)}
              onClick={() => onTabChange('rabbit-hole')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-all duration-150
                ${activeTab === 'rabbit-hole'
                  ? 'bg-gray-100 text-gray-900 font-semibold' 
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
            >
              <Sparkles size={18} strokeWidth={activeTab === 'rabbit-hole' ? 2.5 : 2} />
              <span className="text-sm flex-1">Rabbit Hole</span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded">
                BETA
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* Flyout Menu - Portal to body */}
      {isRabbitHoleHovered && typeof document !== 'undefined' && createPortal(
        <div 
          ref={flyoutRef}
          className="fixed w-72 bg-white rounded-xl shadow-2xl border border-gray-200 py-3"
          style={{ 
            top: flyoutPosition.top, 
            left: flyoutPosition.left,
            zIndex: 9999,
          }}
          onMouseEnter={() => setIsRabbitHoleHovered(true)}
          onMouseLeave={() => setIsRabbitHoleHovered(false)}
        >
          {/* Video Generation */}
          <div className="px-3 mb-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
              Video Generation
            </p>
          </div>
          <div className="space-y-0.5 px-2">
            {rabbitHoleFeatures.video.map((feature) => {
              const Icon = feature.icon;
              return (
                <button
                  key={feature.id}
                  onClick={() => handleFeatureClick(feature.id)}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors group text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-gray-200 flex items-center justify-center transition-colors">
                    <Icon size={15} className="text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-gray-700">{feature.title}</span>
                      {feature.badge === 'new' && (
                        <span className="px-1 py-0.5 text-[8px] font-bold bg-gray-800 text-white rounded">NEW</span>
                      )}
                      {feature.badge === 'hot' && (
                        <span className="px-1 py-0.5 text-[8px] font-bold bg-orange-500 text-white rounded">HOT</span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400">{feature.subtitle}</p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300" />
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="h-px bg-gray-100 my-3 mx-3" />

          {/* Image Generation */}
          <div className="px-3 mb-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
              Image Generation
            </p>
          </div>
          <div className="space-y-0.5 px-2">
            {rabbitHoleFeatures.image.map((feature) => {
              const Icon = feature.icon;
              return (
                <button
                  key={feature.id}
                  onClick={() => handleFeatureClick(feature.id)}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors group text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-gray-200 flex items-center justify-center transition-colors">
                    <Icon size={15} className="text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-gray-700">{feature.title}</span>
                      {feature.badge === 'new' && (
                        <span className="px-1 py-0.5 text-[8px] font-bold bg-gray-800 text-white rounded">NEW</span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400">{feature.subtitle}</p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300" />
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}


    </aside>
  );
}
