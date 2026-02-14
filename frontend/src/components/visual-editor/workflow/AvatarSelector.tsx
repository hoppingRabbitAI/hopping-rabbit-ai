'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, User, X } from 'lucide-react';
import { digitalAvatarApi } from '@/lib/api/digital-avatars';
import type { DigitalAvatarTemplate } from '@/types/digital-avatar';

const AVATAR_STORAGE_KEY = 'visual-editor-last-avatar-id';

export interface SelectedAvatar {
  id: string;
  name: string;
  portraitUrl: string;
}

interface AvatarSelectorProps {
  disabled?: boolean;
  value: SelectedAvatar | null;
  onChange: (avatar: SelectedAvatar | null) => void;
}

export function AvatarSelector({ disabled, value, onChange }: AvatarSelectorProps) {
  const [avatars, setAvatars] = useState<DigitalAvatarTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // 加载用户的角色列表
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    digitalAvatarApi
      .listAvatars({ limit: 50 })
      .then((res) => {
        if (!cancelled) {
          const data = (res as any)?.avatars ?? (res as any)?.data?.avatars ?? [];
          setAvatars(data);
        }
      })
      .catch(() => {
        if (!cancelled) setAvatars([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 初始化：恢复上次选择
  useEffect(() => {
    if (value || avatars.length === 0) return;
    try {
      const savedId = localStorage.getItem(AVATAR_STORAGE_KEY);
      if (!savedId) return;
      const match = avatars.find((a) => a.id === savedId);
      if (match) {
        onChange({ id: match.id, name: match.name, portraitUrl: match.portrait_url });
      }
    } catch { /* ignore */ }
    // 只在 avatars 加载完后执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatars]);

  const handleSelect = useCallback(
    (avatar: DigitalAvatarTemplate) => {
      const selected: SelectedAvatar = {
        id: avatar.id,
        name: avatar.name,
        portraitUrl: avatar.portrait_url,
      };
      onChange(selected);
      try { localStorage.setItem(AVATAR_STORAGE_KEY, avatar.id); } catch { /* ignore */ }
      setOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange(null);
      try { localStorage.removeItem(AVATAR_STORAGE_KEY); } catch { /* ignore */ }
    },
    [onChange],
  );

  if (disabled) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-400">
        🎭 角色形象 — 当前能力不支持
      </div>
    );
  }

  return (
    <div className="relative">
      <label className="text-xs text-gray-600 mb-1 block">🎭 角色形象（可选 · 保持人物一致性）</label>

      {/* 选择按钮 */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-gray-300 transition-colors"
      >
        {value ? (
          <>
            <img
              src={value.portraitUrl}
              alt={value.name}
              className="h-7 w-7 rounded-full object-cover border border-gray-200"
            />
            <span className="flex-1 text-gray-900 truncate">{value.name}</span>
            <button
              type="button"
              onClick={handleClear}
              className="rounded p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50"
              title="不使用角色"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <User className="h-4 w-4 text-gray-400" />
            <span className="flex-1 text-gray-400">
              {loading ? '加载角色...' : avatars.length === 0 ? '暂无角色' : '选择角色'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          </>
        )}
      </button>

      {/* 下拉菜单 */}
      {open && avatars.length > 0 && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {/* 不使用角色 */}
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); try { localStorage.removeItem(AVATAR_STORAGE_KEY); } catch {} }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
            >
              <X className="h-4 w-4" />
              不使用角色
            </button>
            {avatars.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                onClick={() => handleSelect(avatar)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
                  value?.id === avatar.id ? 'bg-gray-50 text-gray-700' : 'text-gray-700'
                }`}
              >
                <img
                  src={avatar.portrait_url}
                  alt={avatar.name}
                  className="h-8 w-8 rounded-full object-cover border border-gray-200 flex-shrink-0"
                />
                <div className="flex-1 text-left truncate">
                  <div className="font-medium truncate">{avatar.name}</div>
                  {avatar.description && (
                    <div className="text-[11px] text-gray-400 truncate">{avatar.description}</div>
                  )}
                </div>
                {value?.id === avatar.id && (
                  <span className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-full">已选</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default AvatarSelector;
