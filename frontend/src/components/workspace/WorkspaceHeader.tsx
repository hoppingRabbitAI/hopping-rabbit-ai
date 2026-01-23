'use client';

import React, { useState } from 'react';
import { ArrowLeft, LogOut, ChevronDown } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/features/editor/store/auth-store';

export function WorkspaceHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  
  // 判断是否在项目列表页（不需要返回按钮）
  const isProjectList = pathname === '/workspace' || pathname === '/';
  
  // 获取用户名称首字母
  const userInitials = user?.email ? user.email.substring(0, 2).toUpperCase() : 'U';
  
  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <nav className="fixed top-0 w-full h-20 border-b border-gray-200 bg-white/80 backdrop-blur-md z-50 px-8 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        {/* 返回按钮 - 非项目列表页显示 */}
        {!isProjectList && (
          <button
            onClick={() => router.push('/workspace')}
            className="flex items-center space-x-1.5 text-gray-500 hover:text-gray-900 transition-colors text-sm"
            title="返回项目列表"
          >
            <ArrowLeft size={18} />
            <span className="hidden sm:inline">返回</span>
          </button>
        )}
        
        {!isProjectList && <div className="h-8 w-px bg-gray-200" />}
        
        <div 
          className="flex items-center space-x-3 cursor-pointer"
          onClick={() => router.push('/workspace')}
        >
          <img src="/rabbit-logo.png" className="w-10 h-10" alt="Logo" />
          <span className="text-base font-black tracking-tighter italic uppercase text-gray-900">
            HOPPINGRABBIT
          </span>
        </div>
      </div>
      
      <div className="flex items-center space-x-8">
        <div className="hidden md:flex items-center space-x-8 text-xs font-bold text-gray-500 uppercase tracking-[0.15em]">
          <span className="text-gray-900 cursor-pointer">工作台</span>
          <span className="hover:text-gray-900 cursor-pointer transition-colors">资产库</span>
          <span className="hover:text-gray-900 cursor-pointer transition-colors">AI 实验室</span>
        </div>
        
        {/* 用户菜单 */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center space-x-2 px-3 py-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center text-xs text-gray-600 font-bold">
              {userInitials}
            </div>
            <ChevronDown size={14} className="text-gray-500" />
          </button>
          
          {showUserMenu && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-2">
                <div className="px-4 py-2 border-b border-gray-200">
                  <p className="text-xs text-gray-600 truncate">{user?.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full px-4 py-2.5 text-left text-sm text-red-500 hover:bg-red-50 flex items-center space-x-2 transition-colors"
                >
                  <LogOut size={16} />
                  <span>退出登录</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
