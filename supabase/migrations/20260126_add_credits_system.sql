-- ============================================================================
-- HoppingRabbit AI - 积分制配额系统
-- 创建日期: 2026-01-26
-- 描述: 将次数制升级为积分制，精确匹配模型成本与订阅价值
-- ============================================================================

-- ============================================================================
-- 1. AI 模型积分消耗配置表 (ai_model_credits)
-- 定义每种 AI 操作消耗的积分数
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_model_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 模型标识
    model_key TEXT NOT NULL UNIQUE,  -- 'whisper', 'gpt4', 'kling_lip_sync', 'kling_face_swap'
    model_name TEXT NOT NULL,        -- 显示名称
    provider TEXT NOT NULL,          -- 'openai', 'kling', 'internal'
    
    -- 积分消耗配置
    credits_per_call INTEGER,        -- 固定积分/次 (简单操作)
    credits_per_second DECIMAL(10,4),-- 积分/秒 (音视频时长计费)
    credits_per_minute DECIMAL(10,4),-- 积分/分钟 (替代方案)
    min_credits INTEGER DEFAULT 1,   -- 最小消耗积分
    max_credits INTEGER,             -- 最大消耗积分上限 (防止超长视频)
    
    -- 成本追踪
    estimated_cost_usd DECIMAL(10,4),-- 预估单次成本 (USD)
    cost_updated_at TIMESTAMPTZ,     -- 成本更新时间
    
    -- 状态
    is_active BOOLEAN DEFAULT true,
    category TEXT,                   -- 'transcription', 'generation', 'enhancement', 'analysis', 'editing'
    description TEXT,                -- 功能描述
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预置 AI 模型积分配置数据
INSERT INTO ai_model_credits (model_key, model_name, provider, credits_per_call, credits_per_minute, credits_per_second, min_credits, max_credits, estimated_cost_usd, category, description) VALUES
-- 基础功能 (低消耗)
('whisper_transcribe', '语音转文字', 'openai', NULL, 1.5, NULL, 1, 100, 0.006, 'transcription', '将视频/音频中的语音转换为文字'),
('filler_detection', '填充词检测', 'internal', 2, NULL, NULL, 2, NULL, 0.01, 'analysis', '检测"嗯"、"啊"等填充词'),
('vad', '语音活动检测', 'internal', 1, NULL, NULL, 1, NULL, 0.005, 'analysis', '检测视频中的静音片段'),
('stem_separation', '人声分离', 'internal', NULL, 0.5, NULL, 3, 50, 0.02, 'enhancement', '分离人声和背景音乐'),
('diarization', '说话人识别', 'internal', NULL, 1.0, NULL, 3, 80, 0.015, 'analysis', '识别视频中的不同说话人'),

-- 智能分析 (中消耗)
('gpt4_analysis', 'AI 智能分析', 'openai', 8, NULL, NULL, 5, 20, 0.04, 'analysis', '使用 GPT-4 分析视频内容'),
('smart_clip', '智能剪辑', 'internal', 15, NULL, NULL, 10, 50, 0.08, 'editing', '一键智能剪辑视频'),
('smart_camera', '智能运镜', 'internal', 10, NULL, NULL, 8, 40, 0.05, 'editing', '自动添加镜头运动效果'),
('smart_clean', '智能清理', 'internal', 12, NULL, NULL, 8, 45, 0.06, 'editing', '自动去除静音和填充词'),

-- AI 图像生成 (中高消耗)
('dalle3', 'AI 图片生成', 'openai', 12, NULL, NULL, 10, NULL, 0.08, 'generation', 'DALL-E 3 文生图'),
('sd_generate', 'SD 图片生成', 'internal', 8, NULL, NULL, 6, NULL, 0.04, 'generation', 'Stable Diffusion 文生图'),

-- Kling AI 功能 (高消耗)
('kling_lip_sync', 'AI 口型同步', 'kling', NULL, NULL, 8.0, 50, 500, 0.40, 'generation', '让视频中的人物口型匹配新音频'),
('kling_face_swap', 'AI 换脸', 'kling', NULL, NULL, 10.0, 60, 600, 0.50, 'generation', '替换视频中的人脸'),
('kling_i2v', '图生视频', 'kling', 100, NULL, NULL, 80, 200, 0.60, 'generation', '将图片转换为动态视频'),
('kling_t2v', '文生视频', 'kling', 200, NULL, NULL, 150, 400, 1.20, 'generation', '根据文字描述生成视频'),
('kling_motion', '运动控制', 'kling', 80, NULL, NULL, 60, 180, 0.45, 'generation', '控制视频中物体的运动轨迹'),
('kling_omni_image', '全能图像', 'kling', 50, NULL, NULL, 40, 120, 0.30, 'generation', 'Kling 全能图像处理')
ON CONFLICT (model_key) DO UPDATE SET
    model_name = EXCLUDED.model_name,
    credits_per_call = EXCLUDED.credits_per_call,
    credits_per_minute = EXCLUDED.credits_per_minute,
    credits_per_second = EXCLUDED.credits_per_second,
    min_credits = EXCLUDED.min_credits,
    max_credits = EXCLUDED.max_credits,
    estimated_cost_usd = EXCLUDED.estimated_cost_usd,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    updated_at = NOW();

-- ============================================================================
-- 2. 用户积分账户表 (user_credits)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 会员等级
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    
    -- 积分余额
    credits_balance INTEGER DEFAULT 0,          -- 当前可用积分
    credits_total_granted INTEGER DEFAULT 0,    -- 历史总获得积分
    credits_total_consumed INTEGER DEFAULT 0,   -- 历史总消耗积分
    
    -- 月度配额
    monthly_credits_limit INTEGER DEFAULT 100,  -- 每月配额上限
    monthly_credits_used INTEGER DEFAULT 0,     -- 本月已用
    monthly_reset_at TIMESTAMPTZ,               -- 下次重置时间
    
    -- 免费试用
    free_trial_credits INTEGER DEFAULT 50,      -- 免费试用积分 (一次性)
    free_trial_used BOOLEAN DEFAULT FALSE,      -- 是否已使用试用
    
    -- 充值积分 (非订阅购买)
    paid_credits INTEGER DEFAULT 0,             -- 充值积分 (永不过期)
    
    -- 存储配额 (保留)
    storage_limit_mb INTEGER DEFAULT 500,
    storage_used_mb INTEGER DEFAULT 0,
    
    -- 项目配额 (保留)
    max_projects INTEGER DEFAULT 3,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credits_tier ON user_credits(tier);

-- ============================================================================
-- 3. 积分消耗记录表 (credit_transactions)
-- 详细记录每一笔积分变动
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 交易类型
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'consume',      -- 消耗 (使用 AI 功能)
        'grant',        -- 发放 (订阅续费、首次赠送)
        'refund',       -- 退款 (任务失败退回)
        'purchase',     -- 购买 (额外充值)
        'expire',       -- 过期 (月度积分清零)
        'adjust',       -- 调整 (客服手动调整)
        'hold',         -- 冻结 (任务进行中)
        'release'       -- 释放 (冻结取消)
    )),
    
    -- 积分变动
    credits_amount INTEGER NOT NULL,  -- 正数=增加，负数=减少
    credits_before INTEGER NOT NULL,  -- 变动前余额
    credits_after INTEGER NOT NULL,   -- 变动后余额
    
    -- 关联信息
    model_key TEXT,                   -- AI 模型 (consume 时)
    ai_task_id UUID,                  -- 关联的 AI 任务
    subscription_id UUID,             -- 关联的订阅 (grant 时)
    
    -- 详细信息
    description TEXT,                 -- 描述
    metadata JSONB DEFAULT '{}'::jsonb,  -- 额外信息 (时长、参数等)
    
    -- 状态 (用于冻结/释放)
    status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_ai_task ON credit_transactions(ai_task_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_status ON credit_transactions(status);

-- ============================================================================
-- 4. 更新订阅计划表 (添加积分配置)
-- ============================================================================
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS monthly_credits INTEGER DEFAULT 0;

UPDATE subscription_plans SET monthly_credits = 100 WHERE slug = 'free';
UPDATE subscription_plans SET monthly_credits = 700 WHERE slug = 'pro';
UPDATE subscription_plans SET monthly_credits = 3000 WHERE slug = 'enterprise';

-- ============================================================================
-- 5. AI 任务表添加积分字段
-- ============================================================================
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS credits_consumed INTEGER DEFAULT 0;
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS credits_held INTEGER DEFAULT 0;

-- ============================================================================
-- 6. RLS 策略
-- ============================================================================
ALTER TABLE ai_model_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- ai_model_credits: 所有人可读
DROP POLICY IF EXISTS "ai_model_credits_select" ON ai_model_credits;
CREATE POLICY "ai_model_credits_select" ON ai_model_credits
    FOR SELECT USING (true);

-- user_credits: 用户只能查看自己的
DROP POLICY IF EXISTS "user_credits_select" ON user_credits;
CREATE POLICY "user_credits_select" ON user_credits
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_credits_insert" ON user_credits;
CREATE POLICY "user_credits_insert" ON user_credits
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_credits_update" ON user_credits;
CREATE POLICY "user_credits_update" ON user_credits
    FOR UPDATE USING (auth.uid() = user_id);

-- credit_transactions: 用户只能查看自己的
DROP POLICY IF EXISTS "credit_transactions_select" ON credit_transactions;
CREATE POLICY "credit_transactions_select" ON credit_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- ============================================================================
-- 7. 触发器: 自动更新 updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_user_credits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_credits_updated_at ON user_credits;
CREATE TRIGGER trigger_user_credits_updated_at
    BEFORE UPDATE ON user_credits
    FOR EACH ROW
    EXECUTE FUNCTION update_user_credits_updated_at();

-- ============================================================================
-- 8. 函数: 初始化新用户积分账户
-- ============================================================================
CREATE OR REPLACE FUNCTION initialize_user_credits()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_credits (
        user_id,
        tier,
        credits_balance,
        credits_total_granted,
        monthly_credits_limit,
        free_trial_credits,
        monthly_reset_at
    ) VALUES (
        NEW.id,
        'free',
        50,  -- 初始赠送 50 积分
        50,
        100, -- 免费版每月 100 积分
        50,
        (DATE_TRUNC('month', NOW()) + INTERVAL '1 month')::TIMESTAMPTZ
    );
    
    -- 记录初始积分发放
    INSERT INTO credit_transactions (
        user_id,
        transaction_type,
        credits_amount,
        credits_before,
        credits_after,
        description
    ) VALUES (
        NEW.id,
        'grant',
        50,
        0,
        50,
        '新用户注册赠送积分'
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 注意: 需要在 auth.users 上创建触发器，但 Supabase 可能限制
-- 作为替代，可以在后端服务中处理新用户初始化

-- ============================================================================
-- 完成
-- ============================================================================
