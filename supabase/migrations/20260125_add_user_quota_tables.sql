-- ============================================================================
-- HoppingRabbit AI - 用户配额与配置表
-- 迁移日期: 2026-01-25
-- 说明: 添加用户配额、用户资料、订阅计划相关表
-- ============================================================================

-- ============================================================================
-- 1. 用户资料表 (user_profiles)
-- 存储用户的个人信息和偏好设置
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY,  -- 与 auth.users.id 关联
    
    -- 基本信息
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    
    -- 联系信息
    phone TEXT,
    company TEXT,
    website TEXT,
    
    -- 偏好设置
    preferences JSONB DEFAULT '{
        "language": "zh-CN",
        "theme": "dark",
        "notifications": {
            "email": true,
            "browser": true,
            "marketing": false
        },
        "editor": {
            "autoSave": true,
            "autoSaveInterval": 30,
            "defaultResolution": "1080p"
        }
    }'::jsonb,
    
    -- 使用统计
    total_projects_created INTEGER DEFAULT 0,
    total_exports INTEGER DEFAULT 0,
    total_ai_tasks INTEGER DEFAULT 0,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. 用户配额表 (user_quotas)
-- 追踪用户的试用次数、额度、存储限制等
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_quotas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    
    -- 会员等级
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    
    -- 试用额度
    free_trials_total INTEGER DEFAULT 6,       -- 总试用次数
    free_trials_used INTEGER DEFAULT 0,        -- 已使用次数
    
    -- 月度额度 (Pro/Enterprise)
    monthly_credits INTEGER DEFAULT 0,         -- 月度配额
    credits_used_this_month INTEGER DEFAULT 0, -- 本月已用
    credits_reset_at TIMESTAMPTZ,              -- 下次重置时间
    
    -- AI 任务限制
    ai_tasks_daily_limit INTEGER DEFAULT 10,   -- 每日 AI 任务上限
    ai_tasks_used_today INTEGER DEFAULT 0,     -- 今日已用
    ai_tasks_reset_at DATE DEFAULT CURRENT_DATE, -- 下次重置日期
    
    -- 存储限制 (MB)
    storage_limit_mb INTEGER DEFAULT 500,      -- 存储上限
    storage_used_mb INTEGER DEFAULT 0,         -- 已用存储
    
    -- 项目限制
    max_projects INTEGER DEFAULT 3,            -- 最大项目数
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_quotas_user_id ON user_quotas(user_id);
CREATE INDEX IF NOT EXISTS idx_user_quotas_tier ON user_quotas(tier);

-- ============================================================================
-- 3. 订阅计划表 (subscription_plans)
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 计划信息
    name TEXT NOT NULL,           -- Free, Pro, Enterprise
    slug TEXT NOT NULL UNIQUE,    -- free, pro, enterprise
    description TEXT,
    
    -- 定价 (美元)
    price_monthly DECIMAL(10,2),
    price_yearly DECIMAL(10,2),
    
    -- 功能配置
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- 显示设置
    display_order INTEGER DEFAULT 0,
    is_popular BOOLEAN DEFAULT false,  -- 推荐标签
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预置订阅计划数据
INSERT INTO subscription_plans (name, slug, price_monthly, price_yearly, features, display_order, is_popular) VALUES
('Free', 'free', 0, 0, '{
    "free_trials": 6,
    "ai_tasks_daily": 10,
    "storage_mb": 500,
    "max_projects": 3,
    "export_quality": ["720p"],
    "watermark_free": false,
    "priority_support": false
}'::jsonb, 1, false),

('Pro', 'pro', 19.99, 199.99, '{
    "free_trials": -1,
    "ai_tasks_daily": 100,
    "storage_mb": 10240,
    "max_projects": 20,
    "export_quality": ["1080p", "4k"],
    "watermark_free": true,
    "priority_support": false
}'::jsonb, 2, true),

('Enterprise', 'enterprise', 49.99, 499.99, '{
    "free_trials": -1,
    "ai_tasks_daily": -1,
    "storage_mb": 102400,
    "max_projects": -1,
    "export_quality": ["1080p", "4k", "8k"],
    "watermark_free": true,
    "priority_support": true,
    "api_access": true
}'::jsonb, 3, false)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- 4. 用户订阅表 (user_subscriptions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    
    -- 订阅状态
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'cancelled', 'expired', 'past_due', 'trialing'
    )),
    
    -- 订阅周期
    billing_cycle TEXT CHECK (billing_cycle IN ('monthly', 'yearly')),
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT false,
    
    -- Stripe 集成 (预留)
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_price_id TEXT,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);

-- ============================================================================
-- 5. 触发器：新用户注册时自动创建 profile 和 quota
-- ============================================================================

-- 创建函数
CREATE OR REPLACE FUNCTION create_user_profile_and_quota()
RETURNS TRIGGER AS $$
BEGIN
    -- 创建用户资料
    INSERT INTO user_profiles (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    
    -- 创建用户配额
    INSERT INTO user_quotas (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建触发器 (在 auth.users 表上)
-- 注意：此触发器需要在 Supabase Dashboard SQL Editor 中执行
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- CREATE TRIGGER on_auth_user_created
--     AFTER INSERT ON auth.users
--     FOR EACH ROW
--     EXECUTE FUNCTION create_user_profile_and_quota();

-- ============================================================================
-- 6. RLS 策略 (行级安全)
-- ============================================================================

-- user_profiles RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- user_quotas RLS
ALTER TABLE user_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quota" ON user_quotas
    FOR SELECT USING (auth.uid() = user_id);

-- 只有服务端可以更新配额 (通过 service_role key)
CREATE POLICY "Service can update quotas" ON user_quotas
    FOR UPDATE USING (true);

-- subscription_plans RLS (公开读取)
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view plans" ON subscription_plans
    FOR SELECT USING (is_active = true);

-- user_subscriptions RLS
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription" ON user_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

-- ============================================================================
-- 完成
-- ============================================================================
