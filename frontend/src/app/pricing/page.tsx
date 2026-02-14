'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { pricingModal } from '@/lib/stores/pricing-modal-store';

/**
 * Pricing 页面
 * 重定向到 workspace 并打开定价弹窗
 * 保留此页面是为了兼容旧链接和 SEO
 */
export default function PricingPage() {
  const router = useRouter();

  useEffect(() => {
    // 打开定价弹窗
    pricingModal.open({ triggerReason: 'manual' });
    // 重定向到 workspace
    router.replace('/p');
  }, [router]);

  // 显示加载状态
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-gray-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-500">正在跳转...</p>
      </div>
    </div>
  );
}
