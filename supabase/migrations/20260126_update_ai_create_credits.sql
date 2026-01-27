-- ============================================================================
-- 简化积分系统为固定计费
-- 
-- 变更:
-- 1. 更新 ai_create 积分消耗为 100
-- 2. 删除按时长计费相关字段（只保留 credits_per_call）
-- ============================================================================

-- 更新 ai_create 积分
UPDATE ai_model_credits SET
    credits_per_call = 100,
    updated_at = NOW()
WHERE model_key = 'ai_create';

-- 删除按时长计费相关字段（简化为只支持固定计费）
ALTER TABLE ai_model_credits 
    DROP COLUMN IF EXISTS credits_per_second,
    DROP COLUMN IF EXISTS credits_per_minute,
    DROP COLUMN IF EXISTS min_credits,
    DROP COLUMN IF EXISTS max_credits;

-- 更新表注释
COMMENT ON TABLE ai_model_credits IS '
AI 模型积分定价表（固定计费）

定价规则 (2026-01-26 更新):
- 提取字幕/音频 (voice-extract): 免费 (credits_per_call = 0)
- AI 智能剪辑 (ai-create): 100 积分/次 (ai_create)
- Kling AI 功能: 按功能固定收费

字段说明:
- model_key: 模型唯一标识
- credits_per_call: 每次调用消耗的积分
';
