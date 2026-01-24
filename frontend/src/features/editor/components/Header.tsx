'use client';

import { useState } from 'react';
import { Cpu, ArrowLeft, LogOut, ChevronDown, Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEditorStore } from '../store/editor-store';
import { useAuthStore } from '@/features/editor/store/auth-store';
import { ExportDialog } from './ExportDialog';

export function Header() {
  const router = useRouter();
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const processType = useEditorStore((s) => s.processType);
  const { user, logout } = useAuthStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const userInitials = user?.email ? user.email.substring(0, 2).toUpperCase() : 'U';

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <header className="h-14 flex items-center justify-between px-4 bg-white z-50">
      <div className="flex items-center space-x-3">
        {/* 返回按钮 */}
        <button
          onClick={() => router.push('/workspace')}
          className="flex items-center space-x-1.5 text-gray-500 hover:text-gray-900 transition-colors text-sm"
          title="返回项目列表"
        >
          <ArrowLeft size={16} />
          <span>返回</span>
        </button>

        <div className="h-5 w-px bg-gray-200" />

        {/* Logo */}
        <div
          className="flex items-center space-x-2.5 cursor-pointer"
          onClick={() => router.push('/workspace')}
        >
          <div className="w-8 h-8 flex items-center justify-center overflow-hidden">
            <img src="/rabbit-logo.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <span className="text-sm font-bold tracking-tight text-gray-900">
            编辑器
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-3">
        {/* 处理状态指示器 */}
        {isProcessing && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-full text-xs text-gray-600 font-medium">
            <Cpu size={14} className="animate-spin" />
            <span>
              {processType === 'stt' ? 'AI 语音转写中...' : '正在优化冗余片段...'}
            </span>
          </div>
        )}

        {/* 导出按钮 */}
        <button
          onClick={() => setShowExportDialog(true)}
          disabled={isProcessing}
          className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          导出
        </button>

        {/* 用户菜单 */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center space-x-1 px-1.5 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center text-[9px] text-gray-600 font-bold">
              {userInitials}
            </div>
            <ChevronDown size={10} className="text-gray-500" />
          </button>

          {showUserMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-xl z-50 py-1">
                <div className="px-2 py-1.5 border-b border-gray-100">
                  <p className="text-[9px] text-gray-500 truncate">{user?.email}</p>
                </div>
                <Link
                  href="/settings"
                  className="w-full px-2 py-1.5 text-left text-[10px] text-gray-600 hover:bg-gray-50 flex items-center space-x-1.5 transition-colors"
                  onClick={() => setShowUserMenu(false)}
                >
                  <Settings size={12} />
                  <span>账户设置</span>
                </Link>
                <button
                  onClick={handleLogout}
                  className="w-full px-2 py-1.5 text-left text-[10px] text-red-500 hover:bg-red-50 flex items-center space-x-1.5 transition-colors"
                >
                  <LogOut size={12} />
                  <span>退出登录</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 导出对话框 */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />
    </header>
  );
}
