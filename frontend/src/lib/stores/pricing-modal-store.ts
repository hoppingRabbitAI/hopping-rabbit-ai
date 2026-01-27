/**
 * Pricing Modal 状态管理
 * 全局管理定价弹窗的打开/关闭状态
 */
import { create } from 'zustand';

export type PricingModalTrigger = 'quota_exceeded' | 'feature_locked' | 'manual' | 'upgrade';

interface PricingModalState {
  isOpen: boolean;
  triggerReason: PricingModalTrigger;
  quotaType?: string;
  currentTier?: string;
  onSuccess?: () => void;
}

interface PricingModalStore extends PricingModalState {
  openPricingModal: (options?: {
    triggerReason?: PricingModalTrigger;
    quotaType?: string;
    currentTier?: string;
    onSuccess?: () => void;
  }) => void;
  closePricingModal: () => void;
}

export const usePricingModalStore = create<PricingModalStore>((set) => ({
  isOpen: false,
  triggerReason: 'manual',
  quotaType: undefined,
  currentTier: undefined,
  onSuccess: undefined,

  openPricingModal: (options) => {
    set({
      isOpen: true,
      triggerReason: options?.triggerReason || 'manual',
      quotaType: options?.quotaType,
      currentTier: options?.currentTier,
      onSuccess: options?.onSuccess,
    });
  },

  closePricingModal: () => {
    set({
      isOpen: false,
      triggerReason: 'manual',
      quotaType: undefined,
      currentTier: undefined,
      onSuccess: undefined,
    });
  },
}));

// 便捷方法，可以直接导入使用
export const pricingModal = {
  open: (options?: Parameters<PricingModalStore['openPricingModal']>[0]) => {
    usePricingModalStore.getState().openPricingModal(options);
  },
  close: () => {
    usePricingModalStore.getState().closePricingModal();
  },
};
