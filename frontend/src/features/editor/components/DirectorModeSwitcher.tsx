'use client';

import { useMemo } from 'react';
import { User, Film, Image, ToggleLeft, ToggleRight, Info } from 'lucide-react';
import { useEditorStore } from '../store/editor-store';

/**
 * 导演模式配置
 * pure-avatar: 纯人像模式 - 只显示主播人像，适合直播风格
 * intercut: 混剪模式 - 人像+B-roll素材穿插，适合口播+画面讲解
 * pure-broll: 纯素材模式 - 只显示B-roll素材，人声配画面
 */
const DIRECTOR_MODES = [
  {
    id: 'pure-avatar' as const,
    label: '纯人像',
    icon: User,
    description: '只显示主播人像',
    tip: '适合直播、面对面讲解风格',
  },
  {
    id: 'intercut' as const,
    label: '混剪',
    icon: Film,
    description: '人像+B-roll穿插',
    tip: '适合口播+画面讲解，视觉更丰富',
  },
  {
    id: 'pure-broll' as const,
    label: '纯素材',
    icon: Image,
    description: '只显示B-roll素材',
    tip: '适合解说配画面、vlog后期',
  },
] as const;

interface DirectorModeSwitcherProps {
  /** 是否显示详细描述 */
  showDescription?: boolean;
  /** 是否紧凑模式 */
  compact?: boolean;
}

export function DirectorModeSwitcher({ 
  showDescription = true, 
  compact = false 
}: DirectorModeSwitcherProps) {
  const directorMode = useEditorStore((s) => s.directorMode);
  const setDirectorMode = useEditorStore((s) => s.setDirectorMode);
  const globalBrollEnabled = useEditorStore((s) => s.globalBrollEnabled);
  const setGlobalBrollEnabled = useEditorStore((s) => s.setGlobalBrollEnabled);

  const currentMode = useMemo(
    () => DIRECTOR_MODES.find((m) => m.id === directorMode) || DIRECTOR_MODES[1],
    [directorMode]
  );

  return (
    <div className={`flex flex-col gap-3 ${compact ? 'p-2' : 'p-3'}`}>
      {/* 标题 */}
      {!compact && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">导演模式</h3>
          <div className="flex items-center gap-1 text-[10px] text-gray-400">
            <Info size={12} />
            <span>控制视频合成策略</span>
          </div>
        </div>
      )}

      {/* 模式选择按钮组 */}
      <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
        {DIRECTOR_MODES.map((mode) => {
          const Icon = mode.icon;
          const isActive = directorMode === mode.id;
          
          return (
            <button
              key={mode.id}
              onClick={() => setDirectorMode(mode.id)}
              className={`
                flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md
                text-xs font-medium transition-all duration-200
                ${isActive
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }
              `}
              title={mode.tip}
            >
              <Icon size={14} />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>

      {/* 当前模式描述 */}
      {showDescription && (
        <div className="text-[11px] text-gray-500 text-center">
          {currentMode.description}
          <span className="mx-1">·</span>
          {currentMode.tip}
        </div>
      )}

      {/* B-roll 智能增强开关（仅在混剪/纯素材模式显示） */}
      {directorMode !== 'pure-avatar' && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex flex-col">
            <span className="text-xs text-gray-700">智能 B-roll</span>
            <span className="text-[10px] text-gray-400">
              {globalBrollEnabled ? '自动建议素材' : '手动添加素材'}
            </span>
          </div>
          <button
            onClick={() => setGlobalBrollEnabled(!globalBrollEnabled)}
            className={`
              flex items-center gap-1 px-2 py-1 rounded-full text-xs
              transition-colors duration-200
              ${globalBrollEnabled
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
              }
            `}
          >
            {globalBrollEnabled ? (
              <>
                <ToggleRight size={14} />
                <span>开启</span>
              </>
            ) : (
              <>
                <ToggleLeft size={14} />
                <span>关闭</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 紧凑版导演模式切换器 - 用于工具栏
 */
export function DirectorModeCompact() {
  const directorMode = useEditorStore((s) => s.directorMode);
  const setDirectorMode = useEditorStore((s) => s.setDirectorMode);

  const currentMode = useMemo(
    () => DIRECTOR_MODES.find((m) => m.id === directorMode) || DIRECTOR_MODES[1],
    [directorMode]
  );

  const Icon = currentMode.icon;

  // 循环切换模式
  const handleClick = () => {
    const currentIndex = DIRECTOR_MODES.findIndex((m) => m.id === directorMode);
    const nextIndex = (currentIndex + 1) % DIRECTOR_MODES.length;
    setDirectorMode(DIRECTOR_MODES[nextIndex].id);
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                 text-gray-500 hover:text-gray-700 hover:bg-gray-100
                 transition-all duration-200"
      title={`导演模式: ${currentMode.label} - ${currentMode.tip} (点击切换)`}
    >
      <Icon size={14} />
      <span className="text-[10px] font-medium">{currentMode.label}</span>
    </button>
  );
}
