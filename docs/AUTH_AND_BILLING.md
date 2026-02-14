# 认证与计费系统

> **合并自**：AUTH_SYSTEM_ROADMAP / CREDITS_SYSTEM_DESIGN / SUPABASE_AUTH_SETUP
>
> 覆盖：Supabase Auth 配置 → 用户体系 → 积分制配额 → 订阅计划

---

## 一、Supabase 认证配置

### 1.1 环境变量

```dotenv
# backend/.env
SUPABASE_URL=https://rduiyxvzknaxomrrehzs.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx

# frontend/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://rduiyxvzknaxomrrehzs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx
```

### 1.2 认证流程

```
用户输入邮箱/密码
    ↓
前端调用 Supabase Auth
    ↓
返回 JWT Token + User Info
    ↓
auth-store 存储 accessToken → 持久化 localStorage
    ↓
API Client 自动注入 Authorization: Bearer {token}
    ↓
后端验证 JWT → 提取 user_id → 执行业务逻辑
```

### 1.3 Mock 用户

在 Supabase Dashboard → Authentication → Users → Add user：
- Email: `hxymock@ai.com`，Password: `0000`，✅ Auto Confirm User

---

## 二、已完成功能

| 模块 | 文件 | 状态 |
|------|------|------|
| 邮箱密码登录 | `frontend/src/app/login/page.tsx` | ✅ |
| Token 验证 | `backend/app/api/auth.py` | ✅ |
| 路由守卫 | `frontend/src/components/AuthGuard.tsx` | ✅ |
| Session 管理 | `frontend/src/features/editor/store/auth-store.ts` | ✅ |
| 用户注册 | `frontend/src/app/signup/` | ✅ |
| Google OAuth | `frontend/src/components/auth/GoogleLoginButton.tsx` | ✅ |
| 忘记/重置密码 | `frontend/src/app/forgot-password/` + `reset-password/` | ✅ |
| 用户配额系统 | `backend/app/services/quota_service.py` | ✅ |
| 用户 Profile | `user_profiles` 表 + 设置页 | ✅ |
| 定价页面 | `frontend/src/app/pricing/page.tsx` | ✅ |
| **积分制 Phase 1** | CreditService + API + 前端 Hook | ✅ |

---

## 三、积分制配额系统

### 3.1 设计原则

```
1 积分 ≈ $0.01 成本
订阅价格 = 月度积分 × 成本系数 + 利润空间
```

### 3.2 模型积分消耗

| 功能 | 模型/服务 | 单次成本 | 建议积分 |
|------|-----------|----------|----------|
| 语音转文字 | Whisper API | ~$0.006/分钟 | 1-3/分钟 |
| 智能分析 | GPT-4 | ~$0.03-0.06 | 5-10 |
| 口型同步 | Kling Lip Sync | ~$0.30-0.50 | 50-80 |
| AI 换脸 | Kling Face Swap | ~$0.40-0.60 | 60-100 |
| 图生视频 | Kling I2V | ~$0.50-1.00 | 80-150 |
| 文生视频 | Kling T2V | ~$1.00-2.00 | 150-300 |
| AI 图片生成 | DALL-E 3 / SD | ~$0.04-0.08 | 8-15 |

### 3.3 数据库表

#### ai_model_credits（积分定价配置）

```sql
CREATE TABLE ai_model_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_key TEXT NOT NULL UNIQUE,      -- 'kling_lip_sync' 等
    model_name TEXT NOT NULL,
    provider TEXT NOT NULL,              -- 'openai', 'kling', 'internal'
    credits_per_call INTEGER,            -- 固定积分/次
    credits_per_second DECIMAL(10,4),    -- 按秒计费
    credits_per_minute DECIMAL(10,4),    -- 按分钟计费
    min_credits INTEGER DEFAULT 1,
    max_credits INTEGER,
    estimated_cost_usd DECIMAL(10,4),
    is_active BOOLEAN DEFAULT true,
    category TEXT                         -- 'transcription','generation','enhancement'
);
```

#### user_credits（用户积分账户）

```sql
CREATE TABLE user_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    tier TEXT NOT NULL DEFAULT 'free',
    credits_balance INTEGER DEFAULT 0,
    credits_total_granted INTEGER DEFAULT 0,
    credits_total_consumed INTEGER DEFAULT 0,
    monthly_credits_limit INTEGER DEFAULT 100,
    monthly_credits_used INTEGER DEFAULT 0,
    monthly_reset_at TIMESTAMPTZ,
    free_trial_credits INTEGER DEFAULT 50,
    paid_credits INTEGER DEFAULT 0,
    storage_limit_mb INTEGER DEFAULT 500,
    max_projects INTEGER DEFAULT 3
);
```

#### credit_transactions（积分流水）

```sql
CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    transaction_type TEXT NOT NULL,  -- consume/grant/refund/purchase/expire/adjust
    credits_amount INTEGER NOT NULL, -- 正数=增加，负数=减少
    credits_before INTEGER NOT NULL,
    credits_after INTEGER NOT NULL,
    model_key TEXT,
    ai_task_id UUID,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.4 CreditService

```python
# backend/app/services/credit_service.py
class CreditService:
    async def get_user_credits(self, user_id: str) -> dict
    async def calculate_credits(self, model_key: str, params: dict) -> int
    async def check_credits(self, user_id: str, required: int) -> dict
    async def consume_credits(self, user_id, model_key, credits, ai_task_id) -> bool
    async def refund_credits(self, user_id: str, ai_task_id: str) -> bool
    async def grant_monthly_credits(self, user_id: str) -> bool
    async def get_model_pricing(self, model_key: str = None) -> list
```

积分计算逻辑：
1. 固定积分：`credits_per_call`
2. 时长计费：`credits_per_second × duration`（向上取整）
3. 分钟计费：`credits_per_minute × ceil(duration/60)`
4. 应用 min/max 限制

### 3.5 AI 任务集成

```python
async def create_ai_task(user_id, task_type, params):
    credits_required = await credit_service.calculate_credits(task_type, params)
    check = await credit_service.check_credits(user_id, credits_required)
    if not check['allowed']:
        raise InsufficientCreditsError(check['message'])
    await credit_service.hold_credits(user_id, credits_required, task_id)
    task = await create_task(...)
    return task

# 任务完成：confirm_credits() / 失败：refund_credits()
```

---

## 四、订阅计划

### 4.1 定价方案

| 计划 | 价格 | 月度积分 | 积分单价 |
|------|------|----------|----------|
| Free | $0 | 100 | - |
| Pro | $19.99/月 | 700 | $0.029 |
| Enterprise | $49.99/月 | 3000 | $0.017 |

### 4.2 积分购买包（可选增值）

| 包名 | 积分 | 价格 | 有效期 |
|------|------|------|--------|
| 小包 | 100 | $2.99 | 永久 |
| 中包 | 500 | $12.99 | 永久 |
| 大包 | 1500 | $34.99 | 永久 |

### 4.3 数据库

```sql
CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,         -- free/pro/enterprise
    price_monthly DECIMAL(10,2),
    price_yearly DECIMAL(10,2),
    monthly_credits INTEGER DEFAULT 0,
    features JSONB NOT NULL DEFAULT '{}',
    is_popular BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status TEXT NOT NULL DEFAULT 'active',
    billing_cycle TEXT,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    stripe_customer_id TEXT,           -- 预留 Stripe
    stripe_subscription_id TEXT
);
```

---

## 五、前端组件

### 5.1 积分显示

```tsx
// frontend/src/components/subscription/CreditsDisplay.tsx
// 显示余额、月度用量进度条、升级入口
```

### 5.2 操作前预估

每个 AI 按钮显示预估积分消耗，余额不足时禁用并提示。

### 5.3 积分明细页

`/settings` 积分明细 Tab — 按时间展示每笔积分变动。

---

## 六、API 汇总

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/verify` | 验证 Token |
| GET | `/api/auth/me` | 当前用户 |

### 用户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users/me/profile` | 获取资料 |
| PATCH | `/api/users/me/profile` | 更新资料 |
| POST | `/api/users/me/avatar` | 上传头像 |

### 积分

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/credits/balance` | 积分余额 |
| GET | `/api/credits/history` | 消耗明细 |
| GET | `/api/credits/pricing` | 模型定价表 |

### 订阅

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plans` | 订阅计划列表 |
| GET | `/api/users/me/subscription` | 当前订阅 |
| POST | `/api/subscriptions/checkout` | Stripe 支付（预留） |

---

## 七、待办

| 项 | 状态 |
|----|------|
| Stripe 沙盒测试 | ⬜ 待银行卡就绪 |
| Stripe 生产接入 | ⬜ 依赖香港银行账户 |
| 老用户配额→积分迁移 | ⬜ Phase 3 |
| 风控策略上线 | ⬜ 单日消耗上限 + 异常检测 |

---

## 八、关键文件索引

| 文件 | 用途 |
|------|------|
| `backend/app/api/auth.py` | JWT 验证 |
| `backend/app/api/credits.py` | 积分 API |
| `backend/app/services/credit_service.py` | 积分核心逻辑 |
| `backend/app/tasks/credits_integration.py` | AI 任务积分扣减 |
| `frontend/src/features/editor/store/auth-store.ts` | 前端认证状态 |
| `frontend/src/lib/hooks/useCredits.tsx` | 积分 Hook |
| `frontend/src/components/subscription/CreditsDisplay.tsx` | 积分 UI |
| `supabase/migrations/20260126_add_credits_system.sql` | 积分表迁移 |
