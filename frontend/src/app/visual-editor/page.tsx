'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

// 动态导入主组件，避免 SSR 问题（画布库需要浏览器环境）
const VisualEditor = dynamic(
  () => import('@/components/visual-editor/VisualEditor'),
  { 
    ssr: false,
    loading: () => (
      <div className="h-screen w-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-2xl shadow-lg border border-gray-200">
          <Loader2 className="w-8 h-8 text-gray-800 animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm font-medium">加载视觉编辑器...</p>
        </div>
      </div>
    ),
  }
);

export default function VisualEditorPage() {
  return (
    <Suspense fallback={
      <div className="h-screen w-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-800 animate-spin" />
      </div>
    }>
      <VisualEditor />
    </Suspense>
  );
}
