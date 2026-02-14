'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui';

/* ================================================================
   Global Error Boundary — (main) route group
   Catches runtime errors in any page under (main)/
   ================================================================ */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-6">
        <AlertTriangle className="w-7 h-7 text-semantic-error" />
      </div>
      <h1 className="text-xl font-bold text-hr-text-primary">出了点问题</h1>
      <p className="text-sm text-hr-text-secondary mt-2 max-w-sm">
        {error.message || '页面发生了未知错误，请重试'}
      </p>
      <Button variant="secondary" onClick={reset} className="mt-6">
        <RotateCcw className="w-4 h-4" />
        重试
      </Button>
    </div>
  );
}
