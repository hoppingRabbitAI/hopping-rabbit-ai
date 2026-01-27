/**
 * 积分守卫 - 通用积分检查工具
 * 
 * 积分消耗规则由后端统一管理（ai_model_credits 表，固定计费）
 * 前端通过 API 获取所需积分并检查
 * 
 * 使用方式：
 * ```typescript
 * import { checkCreditsBeforeAction } from '@/lib/utils/credits-guard';
 * 
 * const handleGenerate = async () => {
 *   const canProceed = await checkCreditsBeforeAction('ai_create', credits?.credits_balance);
 *   if (!canProceed) return;
 *   await doGenerate();
 * };
 * ```
 */

import { pricingModal } from '@/lib/stores/pricing-modal-store';
import { API_BASE_URL, getAuthToken } from '@/lib/api/client';

/**
 * 后端定义的 model_key 常量
 * 仅作为类型提示，实际积分消耗由后端 ai_model_credits 表决定
 */
export type ModelKey = 
  | 'ai_create'            // AI 智能剪辑
  | 'kling_lip_sync'       // Kling 口型同步
  | 'kling_video_gen'      // Kling 视频生成
  | string;                // 允许其他后端新增的 key

/**
 * 从后端获取模型所需积分（固定计费）
 */
export async function getRequiredCredits(modelKey: ModelKey): Promise<number | null> {
  try {
    const token = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${API_BASE_URL}/credits/calculate`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ model_key: modelKey }),
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    return data.credits_required;
  } catch (error) {
    console.error('获取积分消耗失败:', error);
    return null;
  }
}

/**
 * 执行操作前检查积分是否充足（实时调用后端）
 * 
 * @param modelKey - 后端定义的模型标识 (ai_model_credits 表)
 * @returns true = 积分充足可继续, false = 积分不足已弹窗
 */
export async function checkCreditsBeforeAction(
  modelKey: ModelKey,
  options?: {
    onSuccess?: () => void;
  }
): Promise<boolean> {
  try {
    const token = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 调用后端一次性获取所需积分和当前余额
    const response = await fetch(`${API_BASE_URL}/credits/check-model`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ model_key: modelKey }),
    });

    if (!response.ok) {
      // 402 = 积分不足
      if (response.status === 402) {
        pricingModal.open({
          triggerReason: 'quota_exceeded',
          quotaType: 'credits',
          onSuccess: options?.onSuccess,
        });
        return false;
      }
      console.error('积分检查失败:', response.status);
      return false;
    }

    const data = await response.json();
    
    // 后端返回 allowed: true/false
    if (!data.allowed) {
      pricingModal.open({
        triggerReason: 'quota_exceeded',
        quotaType: 'credits',
        onSuccess: options?.onSuccess,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('积分检查失败:', error);
    return false;
  }
}

/**
 * 同步版本 - 直接传入已知的积分消耗值（本地比较，仅用于 UI 显示）
 */
export function checkCreditsAndProceed(
  currentCredits: number | undefined | null,
  requiredCredits: number,
  options?: {
    onSuccess?: () => void;
  }
): boolean {
  const available = currentCredits ?? 0;
  
  if (available < requiredCredits) {
    pricingModal.open({
      triggerReason: 'quota_exceeded',
      quotaType: 'credits',
      onSuccess: options?.onSuccess,
    });
    return false;
  }
  
  return true;
}

