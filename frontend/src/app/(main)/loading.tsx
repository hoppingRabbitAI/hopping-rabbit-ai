import React from 'react';
import { Loader2 } from 'lucide-react';

/* ================================================================
   Global Loading — (main) route group
   Shown during page transitions inside (main)/
   ================================================================ */

export default function GlobalLoading() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
      <Loader2 className="w-6 h-6 text-accent-core animate-spin" />
    </div>
  );
}
