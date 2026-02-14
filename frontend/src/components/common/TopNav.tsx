'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, LogOut, Settings, User, Bell } from 'lucide-react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useCredits } from '@/lib/hooks/useCredits';

interface TopNavProps {
  /** 页面标题（可选，默认不显示） */
  title?: string;
  /** 是否显示返回按钮 */
  showBack?: boolean;
  /** 返回按钮点击处理（默认返回 /p） */
  onBack?: () => void;
  /** 右侧额外操作按钮 */
  rightActions?: React.ReactNode;
  /** 是否显示搜索框 */
  showSearch?: boolean;
  /** 搜索框占位符 */
  searchPlaceholder?: string;
  /** 搜索值变化回调 */
  onSearchChange?: (value: string) => void;
}

/**
 * 通用顶部导航栏
 * 
 * 统一各页面的导航栏样式，支持：
 * - Logo + 标题
 * - 返回按钮（可选）
 * - 右侧操作区（可扩展）
 * - 用户菜单（带积分进度）
 */
export function TopNav({
  title,
  showBack = false,
  onBack,
  rightActions,
  showSearch = false,
  searchPlaceholder = 'Search',
  onSearchChange,
}: TopNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const { credits } = useCredits();
  
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const userMenuRef = useRef<HTMLDivElement>(null);

  const userEmail = user?.email || 'User';
  const userInitials = userEmail.substring(0, 2).toUpperCase();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.push('/p');
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    onSearchChange?.(e.target.value);
  };

  return (
    <header className="h-14 px-4 flex items-center justify-between bg-white border-b border-gray-200 z-50">
      {/* Left Section */}
      <div className="flex items-center space-x-3">
        {/* 返回按钮 */}
        {showBack && (
          <>
            <button
              onClick={handleBack}
              className="flex items-center space-x-1.5 text-gray-500 hover:text-gray-900 transition-colors text-sm"
              title="返回"
            >
              <ArrowLeft size={16} />
              <span>返回</span>
            </button>
            <div className="h-5 w-px bg-gray-200" />
          </>
        )}

        {/* Logo */}
        <div
          className="flex items-center space-x-2 cursor-pointer"
          onClick={() => router.push('/p')}
        >
          <div className="w-8 h-8 flex items-center justify-center overflow-hidden">
            <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          {title && (
            <span className="text-sm font-bold tracking-tight text-gray-900">
              {title}
            </span>
          )}
        </div>

        {/* 搜索框 */}
        {showSearch && (
          <div className="relative ml-4">
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={handleSearchChange}
              className="w-60 h-8 pl-9 pr-4 bg-gray-100 border-none rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 transition-all"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        )}
      </div>

      {/* Right Section */}
      <div className="flex items-center space-x-2">
        {/* 页面特定操作 */}
        {rightActions}

        {/* 通知按钮 */}
        <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg relative transition-colors">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
        </button>

        {/* 用户菜单 */}
        <div
          className="relative"
          ref={userMenuRef}
          onMouseEnter={() => setShowUserMenu(true)}
          onMouseLeave={() => setShowUserMenu(false)}
        >
          <button className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-300 transition-colors text-xs font-bold">
            {userInitials}
          </button>

          {/* User Dropdown Menu */}
          {showUserMenu && (
            <div className="absolute top-full right-0 pt-2 w-56 z-50">
            <div className="bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              {/* User Info */}
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center text-gray-600">
                    <User size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{userEmail}</p>
                    <p className="text-xs text-gray-500">个人账户</p>
                  </div>
                </div>
                
                {/* 积分进度条 */}
                {credits && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>剩余额度</span>
                      <span className="text-gray-700 font-medium">
                        {credits.credits_balance.toLocaleString()}
                        {(credits.credits_total_granted ?? 0) > 0 && (
                          <span className="text-gray-400"> / {(credits.credits_total_granted ?? 0).toLocaleString()}</span>
                        )}
                      </span>
                    </div>
                    {/* 进度条: 剩余/累计获得 */}
                    {(credits.credits_total_granted ?? 0) > 0 && (
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gray-500 transition-all"
                          style={{
                            width: `${Math.min((credits.credits_balance / (credits.credits_total_granted ?? 1)) * 100, 100).toFixed(0)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Menu Items */}
              <div className="py-1">
                <Link
                  href="/settings"
                  className="w-full flex items-center space-x-3 px-4 py-2.5 text-gray-700 hover:bg-gray-50 transition-colors text-sm"
                  onClick={() => setShowUserMenu(false)}
                >
                  <Settings size={16} />
                  <span>设置</span>
                </Link>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center space-x-3 px-4 py-2.5 text-red-600 hover:bg-red-50 transition-colors text-sm"
                >
                  <LogOut size={16} />
                  <span>退出登录</span>
                </button>
              </div>
            </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
