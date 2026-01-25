-- ============================================================================
-- HoppingRabbit AI - 订阅系统完整架构
-- 
-- 设计原则:
-- 1. 订阅计划与用户订阅分离，支持灵活调价
-- 2. 积分发放有完整流水记录，可追溯
-- 3. 支持月付/年付，自动续期标记
-- 4. 预留 Stripe 集成字段
-- ============================================================================

-- ============================================================================
-- 1. 订阅计划表 (subscription_plans)
-- 定义所有可购买的订阅方案
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- 基本信息
    name TEXT NOT NULL,                    -- 'Basic', 'Pro', 'Ultimate', 'Creator'
    slug TEXT NOT NULL UNIQUE,             -- 'basic', 'pro', 'ultimate', 'creator'
    description TEXT,                      -- 方案描述
    
    -- 定价 (美元)
    price_monthly DECIMAL(10, 2) NOT NULL DEFAULT 0,
    price_yearly DECIMAL(10, 2) NOT NULL DEFAULT 0,
    
    -- 积分配额
    credits_per_month INTEGER NOT NULL DEFAULT 0,    -- 每月发放积分
    bonus_credits INTEGER DEFAULT 0,                  -- 首次订阅奖励积分
    
    -- 功能限制
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 结构示例:
    -- {
    --   "concurrent_videos": 2,
    --   "concurrent_images": 2,
    --   "concurrent_characters": 1,
    --   "ai_create_free_gens": 8,
    --   "access_all_models": false,
    --   "access_all_features": false,
    --   "early_access_advanced": false,
    --   "extra_credits_discount": 0,
    --   "unlimited_access": []
    -- }
    
    -- Stripe 集成 (预留)
    stripe_price_id_monthly TEXT,
    stripe_price_id_yearly TEXT,
    stripe_product_id TEXT,
    
    -- 显示控制
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_popular BOOLEAN DEFAULT false,
    badge_text TEXT,                       -- '85% OFF', 'MOST POPULAR'
    badge_color TEXT,                      -- 'pink', 'green'
    
    -- 元数据
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. 用户订阅表 (user_subscriptions)
-- 记录用户的订阅状态
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    
    -- 订阅状态
    status TEXT NOT NULL DEFAULT 'active',
    -- 可选值: 'active', 'canceled', 'past_due', 'expired', 'trialing'
    
    -- 计费周期
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',  -- 'monthly' | 'yearly'
    
    -- 时间信息
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL,
    canceled_at TIMESTAMPTZ,
    
    -- 自动续期
    auto_renew BOOLEAN DEFAULT true,
    
    -- 支付信息 (Stripe 预留)
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    payment_method TEXT,                   -- 'stripe', 'manual', 'dev_mode'
    
    -- 实际支付金额 (记录折扣后的价格)
    amount_paid DECIMAL(10, 2),
    currency TEXT DEFAULT 'USD',
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 约束: 一个用户同一时间只能有一个活跃订阅
    CONSTRAINT unique_active_subscription UNIQUE (user_id, status) 
        -- PostgreSQL 不支持部分唯一约束在 CREATE TABLE 中，改用触发器
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan_id ON user_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_period_end ON user_subscriptions(current_period_end);

-- ============================================================================
-- 3. 订阅历史表 (subscription_history)
-- 记录订阅变更历史，用于审计
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES user_subscriptions(id),
    
    -- 变更信息
    action TEXT NOT NULL,                  -- 'created', 'upgraded', 'downgraded', 'canceled', 'renewed', 'expired'
    from_plan_id UUID REFERENCES subscription_plans(id),
    to_plan_id UUID REFERENCES subscription_plans(id),
    
    -- 金额信息
    amount DECIMAL(10, 2),
    currency TEXT DEFAULT 'USD',
    
    -- 详情
    reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_history_user_id ON subscription_history(user_id);

-- ============================================================================
-- 4. 确保表有所有必需列 (兼容已存在的表)
-- ============================================================================

-- 如果表已存在，添加可能缺失的列
DO $$ 
BEGIN
    -- 添加 credits_per_month 列
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscription_plans' AND column_name = 'credits_per_month') THEN
        ALTER TABLE subscription_plans ADD COLUMN credits_per_month INTEGER NOT NULL DEFAULT 0;
    END IF;
    
    -- 添加 bonus_credits 列
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscription_plans' AND column_name = 'bonus_credits') THEN
        ALTER TABLE subscription_plans ADD COLUMN bonus_credits INTEGER DEFAULT 0;
    END IF;
    
    -- 添加 features 列
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscription_plans' AND column_name = 'features') THEN
        ALTER TABLE subscription_plans ADD COLUMN features JSONB NOT NULL DEFAULT '{}'::jsonb;
    END IF;
    
    -- 添加 display_order 列
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscription_plans' AND column_name = 'display_order') THEN
        ALTER TABLE subscription_plans ADD COLUMN display_order INTEGER DEFAULT 0;
    END IF;
    
    -- 添加 is_active 列
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscription_plans' AND column_name = 'is_active') THEN
        ALTER TABLE subscription_plans ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
    
    -- 添加 is_popular 列
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscription_plans' AND column_name = 'is_popular') THEN
        ALTER TABLE subscription_plans ADD COLUMN is_popular BOOLEAN DEFAULT false;
    END IF;
    
    -- 添加 badge_text 列
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscription_plans' AND column_name = 'badge_text') THEN
        ALTER TABLE subscription_plans ADD COLUMN badge_text TEXT;
    END IF;
    
    -- 添加 badge_color 列
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'subscription_plans' AND column_name = 'badge_color') THEN
        ALTER TABLE subscription_plans ADD COLUMN badge_color TEXT;
    END IF;
END $$;

-- ============================================================================
-- 5. 插入默认订阅计划
-- ============================================================================

INSERT INTO subscription_plans (
    slug, name, description, 
    price_monthly, price_yearly, 
    credits_per_month, bonus_credits,
    features, 
    display_order, is_active, is_popular, badge_text
) VALUES 
-- Free 计划
(
    'free', 'Free', '免费体验基础功能',
    0, 0,
    100, 0,
    '{
        "concurrent_videos": 1,
        "concurrent_images": 1,
        "concurrent_characters": 0,
        "ai_create_free_gens": 3,
        "access_all_models": false,
        "access_all_features": false,
        "early_access_advanced": false,
        "extra_credits_discount": 0,
        "storage_mb": 500,
        "max_projects": 3,
        "watermark": true,
        "unlimited_access": []
    }'::jsonb,
    0, true, false, NULL
),
-- Basic 计划
(
    'basic', 'Basic', '适合初次体验 AI 视频创作',
    9, 108,
    150, 0,
    '{
        "concurrent_videos": 2,
        "concurrent_images": 2,
        "concurrent_characters": 1,
        "ai_create_free_gens": 8,
        "access_all_models": false,
        "access_all_features": false,
        "early_access_advanced": false,
        "extra_credits_discount": 0,
        "storage_mb": 2000,
        "max_projects": 10,
        "watermark": false,
        "unlimited_access": []
    }'::jsonb,
    1, true, false, NULL
),
-- Pro 计划
(
    'pro', 'Pro', '适合日常内容创作者',
    29, 208.8,
    600, 50,
    '{
        "concurrent_videos": 3,
        "concurrent_images": 4,
        "concurrent_characters": 2,
        "ai_create_free_gens": 13,
        "access_all_models": true,
        "access_all_features": true,
        "early_access_advanced": false,
        "extra_credits_discount": 0,
        "storage_mb": 10000,
        "max_projects": 50,
        "watermark": false,
        "unlimited_access": ["image_generation", "ai_create"]
    }'::jsonb,
    2, true, false, NULL
),
-- Ultimate 计划
(
    'ultimate', 'Ultimate', '专业创作者的明智之选',
    49, 294,
    1200, 100,
    '{
        "concurrent_videos": 4,
        "concurrent_images": 8,
        "concurrent_characters": 3,
        "ai_create_free_gens": 35,
        "access_all_models": true,
        "access_all_features": true,
        "early_access_advanced": true,
        "extra_credits_discount": 10,
        "storage_mb": 50000,
        "max_projects": 200,
        "watermark": false,
        "unlimited_access": ["image_generation", "ai_create", "kling_all"]
    }'::jsonb,
    3, true, true, 'MOST POPULAR'
),
-- Creator 计划
(
    'creator', 'Creator', '专家级大规模生产',
    249, 448.8,
    6000, 500,
    '{
        "concurrent_videos": 8,
        "concurrent_images": 8,
        "concurrent_characters": 6,
        "ai_create_free_gens": 35,
        "access_all_models": true,
        "access_all_features": true,
        "early_access_advanced": true,
        "extra_credits_discount": 15,
        "storage_mb": 200000,
        "max_projects": -1,
        "watermark": false,
        "unlimited_access": ["image_generation", "ai_create", "kling_all", "all_models"]
    }'::jsonb,
    4, true, false, '2 YEAR OFFER'
)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_monthly = EXCLUDED.price_monthly,
    price_yearly = EXCLUDED.price_yearly,
    credits_per_month = EXCLUDED.credits_per_month,
    bonus_credits = EXCLUDED.bonus_credits,
    features = EXCLUDED.features,
    display_order = EXCLUDED.display_order,
    is_active = EXCLUDED.is_active,
    is_popular = EXCLUDED.is_popular,
    badge_text = EXCLUDED.badge_text,
    updated_at = NOW();

-- ============================================================================
-- 6. 更新 user_credits 表结构 (如果需要)
-- ============================================================================

-- 添加订阅关联字段
ALTER TABLE user_credits 
ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES user_subscriptions(id),
ADD COLUMN IF NOT EXISTS subscription_credits_remaining INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS next_credits_refresh_at TIMESTAMPTZ;

-- ============================================================================
-- 7. 更新 credit_transactions 表 (添加订阅相关类型)
-- ============================================================================

-- 确保有订阅相关的交易类型
COMMENT ON TABLE credit_transactions IS '
积分交易记录表

transaction_type 可选值:
- subscription_grant: 订阅发放的月度积分
- subscription_bonus: 订阅首次奖励积分
- topup_purchase: 充值购买积分
- ai_task_consume: AI 任务消耗
- ai_task_refund: AI 任务退款
- manual_adjustment: 人工调整
- promotion_grant: 促销活动赠送
';

-- ============================================================================
-- 8. RLS 策略
-- ============================================================================

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_history ENABLE ROW LEVEL SECURITY;

-- subscription_plans: 所有人可读
DROP POLICY IF EXISTS "subscription_plans_select" ON subscription_plans;
CREATE POLICY "subscription_plans_select" ON subscription_plans
    FOR SELECT USING (true);

-- user_subscriptions: 用户只能看自己的
DROP POLICY IF EXISTS "user_subscriptions_select" ON user_subscriptions;
CREATE POLICY "user_subscriptions_select" ON user_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_subscriptions_insert" ON user_subscriptions;
CREATE POLICY "user_subscriptions_insert" ON user_subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_subscriptions_update" ON user_subscriptions;
CREATE POLICY "user_subscriptions_update" ON user_subscriptions
    FOR UPDATE USING (auth.uid() = user_id);

-- subscription_history: 用户只能看自己的
DROP POLICY IF EXISTS "subscription_history_select" ON subscription_history;
CREATE POLICY "subscription_history_select" ON subscription_history
    FOR SELECT USING (auth.uid() = user_id);

-- ============================================================================
-- 9. 触发器: 订阅更新时更新 updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_subscription_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_subscription_updated_at ON user_subscriptions;
CREATE TRIGGER trigger_update_subscription_updated_at
    BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_subscription_updated_at();

DROP TRIGGER IF EXISTS trigger_update_plan_updated_at ON subscription_plans;
CREATE TRIGGER trigger_update_plan_updated_at
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_subscription_updated_at();
