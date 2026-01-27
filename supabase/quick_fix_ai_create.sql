-- ============================================================================
-- 添加 ai_create 积分记录（100 积分/次）
-- 
-- 直接在 Supabase SQL Editor 执行此脚本
-- ============================================================================

-- 插入或更新 ai_create 记录
INSERT INTO ai_model_credits (
    model_key, 
    model_name, 
    provider, 
    credits_per_call,
    estimated_cost_usd, 
    category, 
    description
) VALUES (
    'ai_create',
    'AI 智能剪辑',
    'internal',
    100,          -- 固定 100 积分/次
    0.50,
    'editing',
    '一键智能剪辑 - 包含转录、智能分析、剪辑建议等全流程'
)
ON CONFLICT (model_key) DO UPDATE SET
    credits_per_call = 100,
    updated_at = NOW();

-- 验证插入结果
SELECT model_key, model_name, credits_per_call 
FROM ai_model_credits 
WHERE model_key = 'ai_create';
