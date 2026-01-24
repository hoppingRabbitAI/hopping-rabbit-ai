# HoppingRabbit AI - 登录与用户系统开发路线图

> 📅 创建日期: 2026-01-24  
> 🔄 最后更新: 2026-01-25
> 📌 状态: 开发中 (第一至四阶段完成)

---

## 📊 当前系统状态概览

### ✅ 已完成功能

| 模块 | 文件位置 | 说明 |
|------|----------|------|
| 邮箱密码登录 | `frontend/src/app/login/page.tsx` | Supabase Auth + JWT |
| Token 验证 | `backend/app/api/auth.py` | 后端 JWT 解析与验证，支持降级 |
| 路由守卫 | `frontend/src/components/AuthGuard.tsx` | 自动跳转未登录用户 |
| Session 管理 | `frontend/src/features/editor/store/auth-store.ts` | 自动刷新 Token |
| 登录页 UI | `frontend/src/app/login/page.tsx` | 现代化设计，响应式 |

### ❌ 未实现功能

- 用户注册 (Signup)
- Google OAuth 登录
- 忘记密码 / 重置密码
- 用户配额与试用次数
- 用户资料 (Profile)
- 用户设置页面
- 会员订阅系统

---

## 🚀 开发计划

### 第一阶段：核心认证完善 (Week 1)

#### 1.1 用户注册功能

**前端任务:**
- [ ] 新建 `/signup` 页面
- [ ] 注册表单：邮箱、密码、确认密码
- [ ] 密码强度校验
- [ ] 服务条款勾选
- [ ] 注册成功后邮箱验证提示页

**后端任务:**
- [ ] Supabase Auth 配置邮件模板
- [ ] 用户注册后自动创建 `user_profiles` 和 `user_quotas` 记录

**文件清单:**
```
frontend/src/app/signup/page.tsx          # 注册页面
frontend/src/components/auth/SignupForm.tsx  # 注册表单组件
```

**API 接口:** 使用 Supabase SDK `supabase.auth.signUp()`

---

#### 1.2 忘记密码 / 重置密码

**前端任务:**
- [ ] 新建 `/forgot-password` 页面（输入邮箱）
- [ ] 新建 `/reset-password` 页面（设置新密码）
- [ ] 密码重置链接参数处理

**流程图:**
```
用户点击"忘记密码"
    ↓
输入注册邮箱
    ↓
Supabase 发送重置链接邮件
    ↓
用户点击邮件中的链接
    ↓
跳转到 /reset-password?token=xxx
    ↓
输入新密码并确认
    ↓
密码重置成功，跳转登录页
```

**文件清单:**
```
frontend/src/app/forgot-password/page.tsx
frontend/src/app/reset-password/page.tsx
```

**API 接口:**
- `supabase.auth.resetPasswordForEmail(email)`
- `supabase.auth.updateUser({ password })`

---

### 第二阶段：OAuth 与配额系统 (Week 2)

#### 2.1 Google OAuth 登录

**Supabase 配置:**
1. 进入 Supabase Dashboard → Authentication → Providers
2. 启用 Google Provider
3. 配置 Google Cloud Console OAuth 凭据
4. 设置回调 URL: `https://rduiyxvzknaxomrrehzs.supabase.co/auth/v1/callback`

**前端任务:**
- [ ] 添加 "Sign in with Google" 按钮到登录页
- [ ] 处理 OAuth 回调
- [ ] `auth-store.ts` 新增 `loginWithGoogle()` 方法

**代码示例:**
```typescript
// auth-store.ts
loginWithGoogle: async () => {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/workspace`
    }
  });
  if (error) throw error;
}
```

**文件修改:**
```
frontend/src/app/login/page.tsx           # 添加 Google 登录按钮
frontend/src/features/editor/store/auth-store.ts  # 新增 OAuth 方法
frontend/src/components/auth/GoogleLoginButton.tsx  # 新组件
```

---

#### 2.2 用户配额系统

**数据库表设计:**
```sql
-- ============================================================================
-- 用户配额表 (user_quotas)
-- 追踪用户的试用次数、额度、存储限制等
-- ============================================================================
CREATE TABLE user_quotas (
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
    ai_tasks_reset_at DATE,                    -- 下次重置日期
    
    -- 存储限制 (MB)
    storage_limit_mb INTEGER DEFAULT 500,      -- 存储上限
    storage_used_mb INTEGER DEFAULT 0,         -- 已用存储
    
    -- 项目限制
    max_projects INTEGER DEFAULT 3,            -- 最大项目数
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_quotas_user_id ON user_quotas(user_id);
CREATE INDEX idx_user_quotas_tier ON user_quotas(tier);
```

**后端服务:**
```python
# backend/app/services/quota_service.py

class QuotaService:
    async def check_quota(self, user_id: str, action: str) -> dict:
        """检查用户是否有足够配额"""
        pass
    
    async def consume_quota(self, user_id: str, action: str, amount: int = 1):
        """消耗配额"""
        pass
    
    async def get_user_quota(self, user_id: str) -> dict:
        """获取用户配额信息"""
        pass
    
    async def reset_daily_quotas(self):
        """重置每日配额 (定时任务)"""
        pass
```

**前端组件:**
```
frontend/src/components/subscription/QuotaDisplay.tsx   # 配额显示组件
frontend/src/components/subscription/UpgradeModal.tsx   # 升级提示弹窗
```

**API 接口:**
```
GET  /api/users/me/quota     # 获取当前用户配额
POST /api/quota/consume      # 消耗配额 (内部调用)
```

---

### 第三阶段：用户资料与设置 (Week 3)

#### 3.1 用户 Profile 系统

**数据库表设计:**
```sql
-- ============================================================================
-- 用户资料表 (user_profiles)
-- 存储用户的个人信息和偏好设置
-- ============================================================================
CREATE TABLE user_profiles (
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

-- 创建触发器：新用户注册时自动创建 profile
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (user_id)
    VALUES (NEW.id);
    
    INSERT INTO user_quotas (user_id)
    VALUES (NEW.id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_user_profile();
```

---

#### 3.2 用户设置页面

**页面结构:**
```
/settings
├── /settings/profile      # 个人资料
├── /settings/security     # 安全设置 (密码修改)
├── /settings/preferences  # 偏好设置
└── /settings/billing      # 账单与订阅 (预留)
```

**文件清单:**
```
frontend/src/app/settings/layout.tsx
frontend/src/app/settings/page.tsx
frontend/src/app/settings/profile/page.tsx
frontend/src/app/settings/security/page.tsx
frontend/src/app/settings/preferences/page.tsx
```

**API 接口:**
```
GET    /api/users/me/profile        # 获取用户资料
PATCH  /api/users/me/profile        # 更新用户资料
POST   /api/users/me/avatar         # 上传头像
DELETE /api/users/me                # 删除账号
```

---

### 第四阶段：会员订阅框架 (Week 4)

> ⚠️ 此阶段仅搭建框架，不接入真实支付。等待香港银行卡就绪后接入 Stripe。

#### 4.1 订阅计划表

```sql
-- ============================================================================
-- 订阅计划表 (subscription_plans)
-- ============================================================================
CREATE TABLE subscription_plans (
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
    /*
    features 示例:
    {
        "ai_tasks_daily": 100,
        "storage_mb": 10240,
        "max_projects": -1,        // -1 表示无限制
        "export_quality": ["1080p", "4k"],
        "priority_support": true,
        "watermark_free": true
    }
    */
    
    -- 显示设置
    display_order INTEGER DEFAULT 0,
    is_popular BOOLEAN DEFAULT false,  -- 推荐标签
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预置数据
INSERT INTO subscription_plans (name, slug, price_monthly, price_yearly, features, display_order, is_popular) VALUES
('Free', 'free', 0, 0, '{
    "ai_tasks_daily": 6,
    "storage_mb": 500,
    "max_projects": 3,
    "export_quality": ["720p"],
    "watermark_free": false
}'::jsonb, 1, false),

('Pro', 'pro', 19.99, 199.99, '{
    "ai_tasks_daily": 100,
    "storage_mb": 10240,
    "max_projects": 20,
    "export_quality": ["1080p", "4k"],
    "watermark_free": true,
    "priority_support": false
}'::jsonb, 2, true),

('Enterprise', 'enterprise', 49.99, 499.99, '{
    "ai_tasks_daily": -1,
    "storage_mb": 102400,
    "max_projects": -1,
    "export_quality": ["1080p", "4k", "8k"],
    "watermark_free": true,
    "priority_support": true,
    "api_access": true
}'::jsonb, 3, false);

-- ============================================================================
-- 用户订阅表 (user_subscriptions)
-- ============================================================================
CREATE TABLE user_subscriptions (
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

CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);
```

---

#### 4.2 定价页面

**文件清单:**
```
frontend/src/app/pricing/page.tsx
frontend/src/components/subscription/PricingCard.tsx
frontend/src/components/subscription/FeatureList.tsx
frontend/src/components/subscription/BillingToggle.tsx  # 月付/年付切换
```

---

## 📁 完整文件结构 (新增)

```
hoppingrabbit-ai/
├── frontend/src/
│   ├── app/
│   │   ├── signup/
│   │   │   └── page.tsx              # 注册页面
│   │   ├── forgot-password/
│   │   │   └── page.tsx              # 忘记密码
│   │   ├── reset-password/
│   │   │   └── page.tsx              # 重置密码
│   │   ├── settings/
│   │   │   ├── layout.tsx            # 设置页布局
│   │   │   ├── page.tsx              # 设置首页
│   │   │   ├── profile/page.tsx      # 个人资料
│   │   │   ├── security/page.tsx     # 安全设置
│   │   │   └── preferences/page.tsx  # 偏好设置
│   │   └── pricing/
│   │       └── page.tsx              # 定价页面
│   │
│   └── components/
│       ├── auth/
│       │   ├── SignupForm.tsx
│       │   ├── GoogleLoginButton.tsx
│       │   ├── PasswordResetForm.tsx
│       │   └── EmailVerificationNotice.tsx
│       │
│       └── subscription/
│           ├── QuotaDisplay.tsx      # 配额显示
│           ├── UpgradeModal.tsx      # 升级提示
│           ├── PricingCard.tsx       # 定价卡片
│           ├── FeatureList.tsx       # 功能列表
│           └── BillingToggle.tsx     # 计费周期切换
│
├── backend/app/
│   ├── api/
│   │   ├── users.py                  # 用户资料 API
│   │   └── subscriptions.py          # 订阅 API
│   │
│   └── services/
│       └── quota_service.py          # 配额检查服务
│
└── supabase/migrations/
    ├── 20260125_add_user_profiles.sql
    ├── 20260125_add_user_quotas.sql
    └── 20260125_add_subscription_tables.sql
```

---

## 🔗 API 接口汇总

### 用户相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users/me` | 获取当前用户信息 |
| GET | `/api/users/me/profile` | 获取用户资料 |
| PATCH | `/api/users/me/profile` | 更新用户资料 |
| POST | `/api/users/me/avatar` | 上传头像 |
| DELETE | `/api/users/me` | 删除账号 |

### 配额相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users/me/quota` | 获取用户配额 |
| GET | `/api/quota/check` | 检查指定操作是否有配额 |

### 订阅相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plans` | 获取所有订阅计划 |
| GET | `/api/users/me/subscription` | 获取当前订阅 |
| POST | `/api/subscriptions/checkout` | 创建支付会话 (Stripe) |
| POST | `/api/subscriptions/cancel` | 取消订阅 |
| POST | `/api/webhooks/stripe` | Stripe Webhook |

---

## ⏰ 开发时间线

```
┌─────────────────────────────────────────────────────────────────────┐
│                        开发时间线 (4 周)                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Week 1                   Week 2                                    │
│  ┌─────────────┐         ┌─────────────┐                           │
│  │ ✨ 注册页面  │         │ 🔐 Google   │                           │
│  │ ✨ 忘记密码  │         │    OAuth    │                           │
│  │ ✨ 重置密码  │         │ 📊 配额系统 │                           │
│  └─────────────┘         └─────────────┘                           │
│                                                                     │
│  Week 3                   Week 4                                    │
│  ┌─────────────┐         ┌─────────────┐                           │
│  │ 👤 用户资料  │         │ 💳 订阅框架 │                           │
│  │ ⚙️ 设置页面  │         │ 📄 定价页面 │                           │
│  │ 🖼️ 头像上传  │         │ 🧪 沙盒测试 │                           │
│  └─────────────┘         └─────────────┘                           │
│                                                                     │
│  ────────────────────────────────────────────────────────────────   │
│                              ↓                                      │
│                    香港银行卡就绪后                                    │
│                    接入 Stripe 生产环境                               │
│                    正式上线收款功能                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 里程碑检查点

- [x] **M1**: 用户可以注册新账号并验证邮箱 ✅ 2026-01-24
- [x] **M2**: 用户可以通过 Google 一键登录 ✅ 2026-01-25
- [x] **M3**: 忘记密码流程完整可用 ✅ 2026-01-24
- [x] **M4**: 配额系统上线，免费用户有 6 次试用 ✅ 2026-01-25
- [x] **M5**: 用户可以编辑个人资料和头像 ✅ 2026-01-25
- [x] **M6**: 定价页面展示三档订阅计划 ✅ 2026-01-25
- [ ] **M7**: Stripe 沙盒环境测试支付流程
- [ ] **M8**: (待银行卡就绪) 正式接入支付

---

## 📝 备注

1. **Supabase 邮件配置**: 需要在 Supabase Dashboard 配置 SMTP 或使用默认邮件服务
2. **Google OAuth**: 需要在 Google Cloud Console 创建 OAuth 2.0 凭据
3. **Stripe 集成**: 使用测试模式 API Key 进行开发，生产环境需要香港银行账户
4. **头像存储**: 使用 Supabase Storage，创建 `avatars` bucket

---

*文档维护: 根据实际开发进度更新检查点状态*
