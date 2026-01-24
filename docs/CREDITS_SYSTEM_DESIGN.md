# HoppingRabbit AI - 积分制配额系统设计

> 📅 创建日期: 2026-01-25  
> � 实现日期: 2026-01-26  
> 📌 状态: ✅ 已完成 (Phase 1)  
> 🎯 目标: 将"次数制"升级为"积分制"，精确匹配模型成本与订阅价值

---

## 实现进度

| 模块 | 状态 | 文件 |
|------|------|------|
| 数据库迁移 | ✅ 完成 | `supabase/migrations/20260126_add_credits_system.sql` |
| CreditService | ✅ 完成 | `backend/app/services/credit_service.py` |
| Credits API | ✅ 完成 | `backend/app/api/credits.py` |
| 前端 Hook | ✅ 完成 | `frontend/src/lib/hooks/useCredits.tsx` |
| 积分显示组件 | ✅ 完成 | `frontend/src/components/subscription/CreditsDisplay.tsx` |
| 设置页面 Tab | ✅ 完成 | `frontend/src/app/settings/page.tsx` (积分明细 Tab) |
| AI 任务集成 | ✅ 完成 | `backend/app/tasks/credits_integration.py` |
| Schema 合并 | ✅ 完成 | `supabase/schema_complete.sql` (21 张表) |

---

## 一、当前设计问题分析

### 1.1 现有配额模型

```
┌─────────────────────────────────────────────────────────────┐
│  当前: 次数制配额                                             │
├─────────────────────────────────────────────────────────────┤
│  • free_trials_total = 6       # 固定试用次数                │
│  • ai_tasks_daily_limit = 10   # 每日 AI 任务上限            │
│  • storage_limit_mb = 500      # 存储上限                    │
│  • max_projects = 3            # 项目数上限                  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 核心问题

| 问题 | 说明 |
|------|------|
| **成本不均衡** | "一键智剪"(Whisper) 消耗 $0.01，"AI 换脸"(Kling) 消耗 $0.50，但都算 1 次 |
| **定价难对齐** | Pro $19.99/月，100次 AI 任务，但如果用户全用高消耗功能，成本可能超订阅价 |
| **灵活性差** | 新模型接入时，难以动态调整权重 |
| **用户感知模糊** | 用户不知道为什么同样功能，有的"便宜"有的"贵" |

---

## 二、积分制设计目标

### 2.1 核心原则

```
┌─────────────────────────────────────────────────────────────┐
│  1 积分 ≈ $0.01 成本 (可调整系数)                            │
│  订阅价格 = 月度积分 × 成本系数 + 利润空间                    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 设计目标

1. **精确计费**: 每个 AI 模型调用消耗对应的积分
2. **成本可控**: 月度积分总量确保不亏损
3. **用户透明**: 用户清楚知道每个操作的消耗
4. **灵活扩展**: 新模型只需配置积分消耗，无需改代码

---

## 三、模型消耗成本测算

### 3.1 当前集成的 AI 能力

| 功能 | 模型/服务 | 单次成本估算 | 建议积分 |
|------|-----------|--------------|----------|
| 语音转文字 | Whisper API | ~$0.006/分钟 | 1-3 积分/分钟 |
| 智能分析 | GPT-4 | ~$0.03-0.06/次 | 5-10 积分 |
| 填充词检测 | 内部模型 | ~$0.01 | 2 积分 |
| 人声分离 | Demucs | ~$0.02 | 3 积分 |
| **口型同步** | Kling Lip Sync | ~$0.30-0.50 | 50-80 积分 |
| **AI 换脸** | Kling Face Swap | ~$0.40-0.60 | 60-100 积分 |
| **文生图** | DALL-E 3 / SD | ~$0.04-0.08 | 8-15 积分 |
| **图生视频** | Kling I2V | ~$0.50-1.00 | 80-150 积分 |
| **文生视频** | Kling T2V | ~$1.00-2.00 | 150-300 积分 |

### 3.2 积分定价计算

```
假设 Pro 用户 $19.99/月

目标毛利率: 60% → 可用成本 $8.00
安全系数: 0.8 → 实际可用 $6.40
1 积分 = $0.01 成本

月度积分额度 = $6.40 / $0.01 = 640 积分 (约 700 取整)
```

---

## 四、数据库架构设计

### 4.1 新增表结构

```sql
-- ============================================================================
-- 1. AI 模型积分消耗配置表 (ai_model_credits)
-- 定义每种 AI 操作消耗的积分数
-- ============================================================================
CREATE TABLE ai_model_credits (
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
    category TEXT,                   -- 'transcription', 'generation', 'enhancement'
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预置数据
INSERT INTO ai_model_credits (model_key, model_name, provider, credits_per_call, credits_per_minute, min_credits, estimated_cost_usd, category) VALUES
-- 基础功能 (低消耗)
('whisper_transcribe', '语音转文字', 'openai', NULL, 1.5, 1, 0.006, 'transcription'),
('filler_detection', '填充词检测', 'internal', 2, NULL, 2, 0.01, 'analysis'),
('vad', '语音活动检测', 'internal', 1, NULL, 1, 0.005, 'analysis'),
('stem_separation', '人声分离', 'internal', NULL, 0.5, 3, 0.02, 'enhancement'),

-- 智能分析 (中消耗)
('gpt4_analysis', 'AI 智能分析', 'openai', 8, NULL, 5, 0.04, 'analysis'),
('smart_clip', '智能剪辑', 'internal', 15, NULL, 10, 0.08, 'editing'),
('smart_camera', '智能运镜', 'internal', 10, NULL, 8, 0.05, 'editing'),

-- AI 生成 (高消耗)
('kling_lip_sync', 'AI 口型同步', 'kling', NULL, 8.0, 50, 0.40, 'generation'),
('kling_face_swap', 'AI 换脸', 'kling', NULL, 10.0, 60, 0.50, 'generation'),
('kling_i2v', '图生视频', 'kling', 100, NULL, 80, 0.60, 'generation'),
('kling_t2v', '文生视频', 'kling', 200, NULL, 150, 1.20, 'generation'),
('dalle3', 'AI 图片生成', 'openai', 12, NULL, 10, 0.08, 'generation');

-- ============================================================================
-- 2. 用户积分账户表 (user_credits) - 替代/扩展 user_quotas
-- ============================================================================
CREATE TABLE user_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    
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

-- ============================================================================
-- 3. 积分消耗记录表 (credit_transactions)
-- 详细记录每一笔积分变动
-- ============================================================================
CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    
    -- 交易类型
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'consume',      -- 消耗 (使用 AI 功能)
        'grant',        -- 发放 (订阅续费、首次赠送)
        'refund',       -- 退款 (任务失败退回)
        'purchase',     -- 购买 (额外充值)
        'expire',       -- 过期 (月度积分清零)
        'adjust'        -- 调整 (客服手动调整)
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
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(transaction_type);

-- ============================================================================
-- 4. 更新订阅计划表 (添加积分配置)
-- ============================================================================
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS monthly_credits INTEGER DEFAULT 0;

UPDATE subscription_plans SET monthly_credits = 100 WHERE slug = 'free';      -- 免费版 100 积分/月
UPDATE subscription_plans SET monthly_credits = 700 WHERE slug = 'pro';       -- Pro 700 积分/月
UPDATE subscription_plans SET monthly_credits = 3000 WHERE slug = 'enterprise'; -- Enterprise 3000 积分/月
```

### 4.2 表关系图

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ subscription_    │     │ user_credits     │     │ credit_          │
│ plans            │     │                  │     │ transactions     │
├──────────────────┤     ├──────────────────┤     ├──────────────────┤
│ monthly_credits  │────▶│ monthly_credits_ │────▶│ credits_amount   │
│                  │     │ limit            │     │ model_key        │
└──────────────────┘     │ credits_balance  │     │ ai_task_id       │
                         └──────────────────┘     └──────────────────┘
                                  │                        │
                                  │                        │
                                  ▼                        ▼
                         ┌──────────────────┐     ┌──────────────────┐
                         │ ai_tasks         │     │ ai_model_credits │
                         ├──────────────────┤     ├──────────────────┤
                         │ task_type        │────▶│ model_key        │
                         │ credits_consumed │     │ credits_per_call │
                         └──────────────────┘     │ credits_per_sec  │
                                                  └──────────────────┘
```

---

## 五、后端服务设计

### 5.1 CreditService 核心类

```python
# backend/app/services/credit_service.py

class CreditService:
    """积分服务 - 管理用户积分的消耗、发放、查询"""
    
    async def get_user_credits(self, user_id: str) -> dict:
        """获取用户积分信息"""
        
    async def calculate_credits(self, model_key: str, params: dict) -> int:
        """计算操作所需积分
        
        Args:
            model_key: 模型标识 ('kling_lip_sync', 'whisper_transcribe')
            params: 参数 {'duration_seconds': 30, ...}
            
        Returns:
            所需积分数
        """
        
    async def check_credits(self, user_id: str, required: int) -> dict:
        """检查积分是否充足"""
        
    async def consume_credits(
        self, 
        user_id: str, 
        model_key: str, 
        credits: int,
        ai_task_id: str = None,
        description: str = None
    ) -> bool:
        """消耗积分并记录"""
        
    async def refund_credits(self, user_id: str, ai_task_id: str) -> bool:
        """任务失败时退还积分"""
        
    async def grant_monthly_credits(self, user_id: str) -> bool:
        """发放月度积分 (订阅续费时调用)"""
        
    async def get_model_pricing(self, model_key: str = None) -> list:
        """获取模型积分定价表 (前端展示用)"""
```

### 5.2 积分计算逻辑

```python
async def calculate_credits(self, model_key: str, params: dict) -> int:
    """
    计算积分消耗
    
    计算逻辑:
    1. 固定积分: credits_per_call
    2. 时长计费: credits_per_second × duration (向上取整)
    3. 分钟计费: credits_per_minute × ceil(duration/60)
    4. 应用 min/max 限制
    """
    model = await self._get_model_config(model_key)
    
    if model['credits_per_call']:
        # 固定消耗
        credits = model['credits_per_call']
    elif model['credits_per_second']:
        # 按秒计费
        duration = params.get('duration_seconds', 0)
        credits = math.ceil(duration * model['credits_per_second'])
    elif model['credits_per_minute']:
        # 按分钟计费
        duration = params.get('duration_seconds', 0)
        minutes = math.ceil(duration / 60)
        credits = math.ceil(minutes * model['credits_per_minute'])
    else:
        credits = model['min_credits']
    
    # 应用限制
    credits = max(credits, model['min_credits'])
    if model['max_credits']:
        credits = min(credits, model['max_credits'])
    
    return credits
```

### 5.3 与 AI 任务集成

```python
# 在 AI 任务创建时预扣积分
async def create_ai_task(user_id, task_type, params):
    # 1. 计算所需积分
    credits_required = await credit_service.calculate_credits(task_type, params)
    
    # 2. 检查余额
    check = await credit_service.check_credits(user_id, credits_required)
    if not check['allowed']:
        raise InsufficientCreditsError(check['message'])
    
    # 3. 预扣积分 (冻结)
    await credit_service.hold_credits(user_id, credits_required, task_id)
    
    # 4. 创建任务
    task = await create_task(...)
    
    return task

# 任务完成时确认扣除
async def on_task_complete(task_id, success):
    if success:
        await credit_service.confirm_credits(task_id)
    else:
        await credit_service.refund_credits(task_id)
```

---

## 六、前端展示设计

### 6.1 积分显示组件

```tsx
// QuotaDisplay.tsx - 更新为积分显示

interface CreditDisplayProps {
  credits: {
    balance: number;         // 当前余额
    monthlyLimit: number;    // 月度配额
    monthlyUsed: number;     // 本月已用
    paidCredits: number;     // 充值积分
  };
}

// 显示示例:
// ┌────────────────────────────┐
// │ 💎 积分余额: 523           │
// │ ━━━━━━━━━━━━━━━━━━━━ 75%   │
// │ 本月已用 177 / 700         │
// │                            │
// │ [升级获取更多积分]          │
// └────────────────────────────┘
```

### 6.2 操作前积分预估

```tsx
// 用户点击 AI 功能前显示预估消耗

<AIActionButton
  action="lip_sync"
  estimatedCredits={65}
  userBalance={523}
>
  <span>AI 口型同步</span>
  <span className="text-xs text-gray-400">约消耗 65 积分</span>
</AIActionButton>

// 余额不足时
<AIActionButton
  disabled
  insufficientCredits
>
  <span>AI 口型同步</span>
  <span className="text-xs text-red-400">需要 65 积分，余额不足</span>
</AIActionButton>
```

### 6.3 积分消耗明细页

```tsx
// /settings/credits 页面

// ┌────────────────────────────────────────────────┐
// │  积分使用明细                                    │
// ├────────────────────────────────────────────────┤
// │  今天                                          │
// │  ├─ AI 口型同步        -65 积分   14:32        │
// │  ├─ 语音转文字 (2分钟)  -3 积分   14:28        │
// │  └─ 智能剪辑           -15 积分   14:20        │
// │                                                │
// │  昨天                                          │
// │  ├─ 月度积分发放       +700 积分  00:00        │
// │  └─ AI 换脸             -80 积分   23:45       │
// └────────────────────────────────────────────────┘
```

---

## 七、订阅计划调整

### 7.1 新定价方案

| 计划 | 价格 | 月度积分 | 积分单价 | 主要功能 |
|------|------|----------|----------|----------|
| **Free** | $0 | 100 | - | 基础 AI 功能体验 |
| **Pro** | $19.99 | 700 | $0.029/积分 | 所有功能 + 优先处理 |
| **Enterprise** | $49.99 | 3000 | $0.017/积分 | 无限制 + API + 定制 |

### 7.2 积分购买包 (可选增值)

| 包名 | 积分 | 价格 | 单价 | 有效期 |
|------|------|------|------|--------|
| 小包 | 100 | $2.99 | $0.030 | 永久 |
| 中包 | 500 | $12.99 | $0.026 | 永久 |
| 大包 | 1500 | $34.99 | $0.023 | 永久 |

---

## 八、迁移方案

### 8.1 迁移步骤

```
Phase 1: 准备 (无感知)
├── 创建新表结构
├── 部署 CreditService
└── 双写: 同时更新 user_quotas 和 user_credits

Phase 2: 灰度切换
├── 新用户使用积分制
├── 老用户保持次数制
└── 监控运行数据

Phase 3: 全量迁移
├── 老用户配额转换为积分
│   └── free_trials_remaining × 10 → credits
├── 前端切换到积分显示
└── 废弃 user_quotas 表
```

### 8.2 老用户配额转换

```python
async def migrate_user_to_credits(user_id):
    old_quota = await get_user_quota(user_id)
    
    # 转换公式
    initial_credits = (
        old_quota['free_trials_remaining'] * 15 +  # 每次试用 → 15 积分
        old_quota['ai_tasks_remaining_today'] * 5   # 今日任务 → 5 积分
    )
    
    # 创建新积分账户
    await create_user_credits(user_id, initial_credits)
```

---

## 九、监控与风控

### 9.1 关键指标

```
1. 用户平均积分消耗率 = 月消耗积分 / 月度配额
2. 模型成本覆盖率 = 积分收入 / 模型调用成本
3. 积分库存周转率 = 发放积分 / 消耗积分
4. 高消耗用户比例 = 消耗 >80% 配额用户数 / 总用户数
```

### 9.2 风控策略

```python
# 1. 单日消耗上限
MAX_DAILY_CONSUMPTION = monthly_limit * 0.5  # 单日最多用一半月配额

# 2. 异常检测
if hourly_consumption > avg_hourly * 10:
    alert("异常消耗", user_id)

# 3. 模型调用频率限制
RATE_LIMITS = {
    'kling_lip_sync': '10/hour',
    'kling_t2v': '5/hour',
}
```

---

## 十、实施计划

| 阶段 | 内容 | 时间 |
|------|------|------|
| **Phase 1** | 数据库表创建、CreditService 开发 | 1 周 |
| **Phase 2** | AI 任务集成、前端组件开发 | 1 周 |
| **Phase 3** | 灰度测试、数据迁移 | 1 周 |
| **Phase 4** | 全量上线、监控完善 | 1 周 |

---

## 十一、总结

积分制相比次数制的优势:

| 维度 | 次数制 | 积分制 |
|------|--------|--------|
| **成本精确性** | ❌ 所有操作等价 | ✅ 按模型成本定价 |
| **定价灵活性** | ❌ 难以调整 | ✅ 只需改积分配置 |
| **用户公平性** | ❌ 重度用户吃亏 | ✅ 用多少付多少 |
| **收入可预测** | ❌ 依赖使用模式 | ✅ 积分 = 成本锚定 |
| **新模型接入** | ❌ 需要改代码 | ✅ 只需配置积分 |

**建议**: 现阶段保持次数制快速上线，同时并行开发积分制，在有足够用户数据后平滑切换。

---

*文档维护: 根据模型成本变化定期更新积分定价*
