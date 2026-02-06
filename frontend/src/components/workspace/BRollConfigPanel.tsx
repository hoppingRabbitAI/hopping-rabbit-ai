'use client';

import React, { useRef, useState, useCallback } from 'react';
import { 
    Monitor, 
    PictureInPicture2, 
    Shuffle,
    User,
    Move,
} from 'lucide-react';

// ==========================================
// 类型定义
// ==========================================

export type BRollDisplayMode = 'fullscreen' | 'pip' | 'mixed';
export type PipSize = 'small' | 'medium' | 'large';

// ★★★ 新增：自由位置坐标 (0-1 范围) ★★★
export interface PipFreePosition {
    x: number;  // 0-1，表示 PiP 左边距占画布宽度的比例
    y: number;  // 0-1，表示 PiP 上边距占画布高度的比例
}

// 保留旧类型兼容
export type PipPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface PipConfig {
    size: PipSize;
    defaultPosition: PipPosition;  // 保留兼容
    freePosition?: PipFreePosition;  // ★ 新增：自由位置
    faceAvoidance: boolean;
    margin: number;
    borderRadius: number;
}

export interface MixedConfig {
    fullscreenMinDuration: number;
    pipMinDuration: number;
    pipRatio: number;
}

export interface BRollConfigState {
    enabled: boolean;
    displayMode: BRollDisplayMode;
    pipConfig: PipConfig;
    mixedConfig: MixedConfig;
}

// ★★★ 主视频信息（用于位置预览）★★★
export interface MainVideoInfo {
    thumbnailUrl?: string;    // 封面图 URL
    width: number;            // 视频宽度
    height: number;           // 视频高度
    isVertical: boolean;      // 是否竖屏
    duration?: number;        // 视频时长（秒）
}

interface BRollConfigPanelProps {
    config: BRollConfigState;
    onChange: (config: BRollConfigState) => void;
    mainVideoInfo?: MainVideoInfo;  // ★ 新增：主视频信息
    faceDetectionResult?: {
        dominantRegion?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        safePipPositions: string[];
    };
}

// ==========================================
// 默认配置
// ==========================================

export const DEFAULT_BROLL_CONFIG: BRollConfigState = {
    enabled: false,
    displayMode: 'fullscreen',
    pipConfig: {
        size: 'medium',
        defaultPosition: 'bottom-right',
        faceAvoidance: true,
        margin: 20,
        borderRadius: 12,
    },
    mixedConfig: {
        fullscreenMinDuration: 3000,
        pipMinDuration: 1500,
        pipRatio: 0.4,
    },
};

// ==========================================
// 工具函数
// ==========================================

function cn(...classes: (string | undefined | false)[]) {
    return classes.filter(Boolean).join(' ');
}

// ==========================================
// 子组件：显示模式选择
// ==========================================

interface DisplayModeCardProps {
    mode: BRollDisplayMode;
    title: string;
    description: string;
    icon: React.ReactNode;
    selected: boolean;
    onClick: () => void;
}

function DisplayModeCard({ mode, title, description, icon, selected, onClick }: DisplayModeCardProps) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex flex-col items-center p-3 rounded-lg border-2 transition-all",
                "hover:border-blue-400 hover:bg-blue-50",
                selected ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white"
            )}
        >
            <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center mb-2",
                selected ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"
            )}>
                {icon}
            </div>
            <span className={cn(
                "text-sm font-medium",
                selected ? "text-blue-700" : "text-gray-700"
            )}>
                {title}
            </span>
            <span className="text-xs text-gray-500 text-center mt-1">
                {description}
            </span>
        </button>
    );
}

// ==========================================
// 子组件：PiP 位置预览（可拖拽）
// ==========================================

interface PipPositionPreviewProps {
    pipSize: PipSize;
    freePosition: PipFreePosition;  // ★ 改为自由位置
    mainVideoInfo?: MainVideoInfo;
    faceRegion?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    onPositionChange: (position: PipFreePosition) => void;  // ★ 改为自由位置
}

function PipPositionPreview({ 
    pipSize, 
    freePosition,
    mainVideoInfo,
    faceRegion, 
    onPositionChange 
}: PipPositionPreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    
    const sizeToPercent: Record<PipSize, number> = {
        small: 20,
        medium: 30,
        large: 40,
    };
    const pipPercent = sizeToPercent[pipSize] / 100;
    
    // 使用真实视频宽高计算比例
    const videoWidth = mainVideoInfo?.width || 1920;
    const videoHeight = mainVideoInfo?.height || 1080;
    const videoAspectRatio = videoWidth / videoHeight;
    
    // 容器自适应
    // 增大预览容器尺寸
    const containerMaxHeight = 400;
    const containerMaxWidth = 300;
    
    let canvasWidth: number;
    let canvasHeight: number;
    
    if (videoAspectRatio >= 1) {
        canvasWidth = Math.min(containerMaxWidth, containerMaxHeight * videoAspectRatio);
        canvasHeight = canvasWidth / videoAspectRatio;
    } else {
        canvasHeight = Math.min(containerMaxHeight, containerMaxWidth / videoAspectRatio);
        canvasWidth = canvasHeight * videoAspectRatio;
    }
    
    // 计算位置（限制在边界内）
    const clampPosition = useCallback((x: number, y: number): PipFreePosition => {
        const maxX = 1 - pipPercent;
        const maxY = 1 - pipPercent;
        return {
            x: Math.max(0, Math.min(maxX, x)),
            y: Math.max(0, Math.min(maxY, y)),
        };
    }, [pipPercent]);
    
    // 处理拖拽
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);
    
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging || !containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - pipPercent / 2;
        const y = (e.clientY - rect.top) / rect.height - pipPercent / 2;
        
        onPositionChange(clampPosition(x, y));
    }, [isDragging, pipPercent, onPositionChange, clampPosition]);
    
    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);
    
    // 点击直接定位
    const handleClick = useCallback((e: React.MouseEvent) => {
        if (!containerRef.current || isDragging) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - pipPercent / 2;
        const y = (e.clientY - rect.top) / rect.height - pipPercent / 2;
        
        onPositionChange(clampPosition(x, y));
    }, [pipPercent, onPositionChange, clampPosition, isDragging]);
    
    return (
        <div 
            ref={containerRef}
            className="relative bg-gray-800 rounded-lg overflow-hidden cursor-crosshair select-none"
            style={{ 
                width: canvasWidth,
                height: canvasHeight,
            }}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* 封面图背景 */}
            {mainVideoInfo?.thumbnailUrl && (
                <img
                    src={mainVideoInfo.thumbnailUrl}
                    alt="视频预览"
                    className="absolute inset-0 w-full h-full object-cover opacity-70 pointer-events-none"
                    draggable={false}
                />
            )}
            
            {/* 无封面时的占位背景 */}
            {!mainVideoInfo?.thumbnailUrl && (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-700 to-gray-900 pointer-events-none" />
            )}
            
            {/* 视频比例标识 */}
            <div className="absolute top-1 left-1 text-[10px] text-white/50 bg-black/30 px-1 rounded pointer-events-none">
                {videoWidth}×{videoHeight}
            </div>
            
            {/* 人脸区域指示 */}
            {faceRegion && (
                <div
                    className="absolute border border-dashed border-yellow-400/60 bg-yellow-400/10 rounded pointer-events-none"
                    style={{
                        left: `${faceRegion.x * 100}%`,
                        top: `${faceRegion.y * 100}%`,
                        width: `${faceRegion.width * 100}%`,
                        height: `${faceRegion.height * 100}%`,
                    }}
                />
            )}
            
            {/* ★★★ 可拖拽的 PiP 窗口 ★★★ */}
            <div
                className={cn(
                    "absolute rounded-lg flex items-center justify-center cursor-move transition-shadow",
                    isDragging 
                        ? "bg-blue-500 shadow-lg shadow-blue-500/50 ring-2 ring-white" 
                        : "bg-blue-500/90 hover:bg-blue-500 ring-2 ring-blue-300"
                )}
                style={{
                    left: `${freePosition.x * 100}%`,
                    top: `${freePosition.y * 100}%`,
                    width: `${pipPercent * 100}%`,
                    height: `${pipPercent * 100}%`,
                }}
                onMouseDown={handleMouseDown}
            >
                <Move size={16} className="text-white/80" />
            </div>
            
            {/* 拖拽提示 */}
            <div className="absolute bottom-1 right-1 text-[10px] text-white/40 pointer-events-none">
                拖拽调整位置
            </div>
        </div>
    );
}

// ==========================================
// ★★★ 独立组件：画中画设置面板（供外部使用）★★★
// ==========================================

interface PiPSettingsPanelProps {
    config: BRollConfigState;
    onChange: (config: BRollConfigState) => void;
    mainVideoInfo?: MainVideoInfo;
    faceDetectionResult?: {
        dominantRegion?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        safePipPositions: string[];
    };
}

export function PiPSettingsPanel({ config, onChange, mainVideoInfo, faceDetectionResult }: PiPSettingsPanelProps) {
    const updatePipConfig = (updates: Partial<PipConfig>) => {
        onChange({
            ...config,
            pipConfig: { ...config.pipConfig, ...updates },
        });
    };
    
    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <PictureInPicture2 size={16} />
                画中画设置
            </div>
            
            {/* 位置预览 */}
            <div className="flex-1 min-h-0">
                <label className="block text-xs text-gray-500 mb-1">
                    默认位置（拖拽调整）
                </label>
                <PipPositionPreview
                    pipSize={config.pipConfig.size}
                    freePosition={config.pipConfig.freePosition || { x: 0.65, y: 0.65 }}
                    mainVideoInfo={mainVideoInfo}
                    faceRegion={faceDetectionResult?.dominantRegion}
                    onPositionChange={(pos) => updatePipConfig({ freePosition: pos })}
                />
            </div>
            
            {config.pipConfig.faceAvoidance && (
                <p className="text-[10px] text-gray-400 mt-2 text-center">
                    PiP 窗口会自动选择不遮挡人脸的位置
                </p>
            )}
        </div>
    );
}

// ==========================================
// 主组件：B-Roll 配置面板
// ==========================================

export function BRollConfigPanel({ config, onChange, mainVideoInfo, faceDetectionResult }: BRollConfigPanelProps) {
    const updateConfig = (updates: Partial<BRollConfigState>) => {
        onChange({ ...config, ...updates });
    };
    
    const updatePipConfig = (updates: Partial<PipConfig>) => {
        onChange({
            ...config,
            pipConfig: { ...config.pipConfig, ...updates },
        });
    };
    
    // 是否显示画中画相关设置（画中画或智能混合模式）
    const showPipOptions = config.displayMode === 'pip' || config.displayMode === 'mixed';
    
    return (
        <div className="space-y-4">
            {/* 显示模式选择 */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    显示模式
                </label>
                <div className="grid grid-cols-3 gap-3">
                    <DisplayModeCard
                        mode="fullscreen"
                        title="全屏"
                        description="B-Roll 完全覆盖画面"
                        icon={<Monitor size={20} />}
                        selected={config.displayMode === 'fullscreen'}
                        onClick={() => updateConfig({ displayMode: 'fullscreen' })}
                    />
                    <DisplayModeCard
                        mode="pip"
                        title="画中画"
                        description="B-Roll 在角落显示"
                        icon={<PictureInPicture2 size={20} />}
                        selected={config.displayMode === 'pip'}
                        onClick={() => updateConfig({ displayMode: 'pip' })}
                    />
                    <DisplayModeCard
                        mode="mixed"
                        title="智能混合"
                        description="AI 自动选择模式"
                        icon={<Shuffle size={20} />}
                        selected={config.displayMode === 'mixed'}
                        onClick={() => updateConfig({ displayMode: 'mixed' })}
                    />
                </div>
                
                {/* 混合模式说明 */}
                {config.displayMode === 'mixed' && (
                    <div className="mt-3 p-3 bg-purple-50 rounded-lg">
                        <p className="text-xs text-purple-600">
                            AI 会根据内容自动选择：产品展示 → 全屏，补充说明 → 画中画
                        </p>
                    </div>
                )}
            </div>
            
            {/* 画中画设置：窗口大小 + 自动避开人脸（仅在 pip/mixed 模式下显示）*/}
            {showPipOptions && (
                <div className="flex items-center gap-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
                    {/* 窗口大小 */}
                    <div className="flex items-center gap-3">
                        <label className="text-sm text-gray-600 whitespace-nowrap">
                            窗口大小
                        </label>
                        <div className="flex gap-1.5">
                            {(['small', 'medium', 'large'] as PipSize[]).map((size) => (
                                <button
                                    key={size}
                                    onClick={() => updatePipConfig({ size })}
                                    className={cn(
                                        "py-1.5 px-3 text-xs rounded-lg transition-colors font-medium",
                                        config.pipConfig.size === size
                                            ? "bg-blue-500 text-white"
                                            : "bg-white text-gray-600 border border-gray-200 hover:border-blue-300"
                                    )}
                                >
                                    {size === 'small' ? '小' : size === 'medium' ? '中' : '大'}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {/* 分隔线 */}
                    <div className="h-6 w-px bg-gray-200" />
                    
                    {/* 自动避开人脸 */}
                    <div className="flex items-center gap-2">
                        <User size={14} className="text-gray-400" />
                        <span className="text-sm text-gray-600">自动避开人脸</span>
                        <button
                            onClick={() => updatePipConfig({ faceAvoidance: !config.pipConfig.faceAvoidance })}
                            className={cn(
                                "relative w-9 h-5 rounded-full transition-colors",
                                config.pipConfig.faceAvoidance ? "bg-blue-500" : "bg-gray-300"
                            )}
                        >
                            <div className={cn(
                                "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                                config.pipConfig.faceAvoidance ? "translate-x-4" : "translate-x-0.5"
                            )} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default BRollConfigPanel;
