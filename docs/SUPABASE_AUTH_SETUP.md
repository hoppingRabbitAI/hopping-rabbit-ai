# HoppingRabbit AI - Supabase 认证设置指南

## 1. 获取 Supabase API Keys

1. 访问 [Supabase Dashboard](https://supabase.com/dashboard)
2. 选择你的项目: `rduiyxvzknaxomrrehzs`
3. 点击左侧菜单 **Settings** → **API**
4. 复制以下信息:
   - **Project URL**: `https://rduiyxvzknaxomrrehzs.supabase.co`
   - **anon public key**: 以 `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.` 开头的长字符串

## 2. 配置环境变量

### 后端 (`backend/.env`)
```dotenv
SUPABASE_URL=https://rduiyxvzknaxomrrehzs.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx  # 替换为实际的 key
```

### 前端 (`frontend/.env.local`)
```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://rduiyxvzknaxomrrehzs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx  # 替换为实际的 key
```

## 3. 创建 Mock 用户

### 方法一: 通过 Dashboard 创建（推荐）

1. 访问 [Supabase Dashboard](https://supabase.com/dashboard/project/rduiyxvzknaxomrrehzs)
2. 点击左侧菜单 **Authentication** → **Users**
3. 点击 **Add user** → **Create new user**
4. 填写信息:
   - **Email**: `hxymock@ai.com`
   - **Password**: `0000`
   - ✅ 勾选 **Auto Confirm User** (跳过邮箱验证)
5. 点击 **Create user**

### 方法二: 通过 SQL Editor 创建

在 Supabase Dashboard 的 SQL Editor 中执行:

```sql
-- 注意: 这需要 service_role 权限
-- 建议使用方法一 (Dashboard UI) 更简单
```

## 4. 验证设置

### 启动后端
```bash
cd backend
source .venv/bin/activate
DEV_MODE=true uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 启动前端
```bash
cd frontend
npm run dev
```

### 测试登录
1. 访问 http://localhost:3000/login
2. 使用账号登录:
   - 邮箱: `hxymock@ai.com`
   - 密码: `0000`

## 5. 认证流程说明

```
┌─────────────────────────────────────────────────────────────────┐
│                       HoppingRabbit AI 认证流程                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [用户] ─────────────────────────────────────────────────────►  │
│    │                                                            │
│    │ 1. 输入邮箱/密码                                            │
│    ▼                                                            │
│  [前端 Login Page]                                              │
│    │                                                            │
│    │ 2. 调用 Supabase Auth                                       │
│    ▼                                                            │
│  [Supabase Auth] ◄─── 验证凭据 ───►                             │
│    │                                                            │
│    │ 3. 返回 JWT Token + User Info                              │
│    ▼                                                            │
│  [前端 auth-store]                                              │
│    │ • 存储 accessToken                                         │
│    │ • 存储 user 信息                                           │
│    │ • 持久化到 localStorage                                    │
│    ▼                                                            │
│  [前端 API Client]                                              │
│    │ • 每次请求自动注入 Authorization: Bearer {token}            │
│    ▼                                                            │
│  [后端 API]                                                     │
│    │ • 验证 JWT Token                                           │
│    │ • 提取 user_id                                             │
│    │ • 执行业务逻辑                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 6. API 端点

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/auth/login` | POST | 用户登录 | 否 |
| `/api/auth/logout` | POST | 用户登出 | 是 |
| `/api/auth/verify` | GET | 验证 Token | 可选 |
| `/api/auth/me` | GET | 获取当前用户 | 是 |
| `/api/projects` | GET | 获取项目列表 | 是 |
| ... | ... | 其他业务 API | 是 |

## 7. 常见问题

### Q: 登录提示 "Invalid API key"
**A**: 请检查 `.env` 文件中的 `SUPABASE_ANON_KEY` 是否正确。正确的 key 应该以 `eyJ` 开头。

### Q: 登录提示 "邮箱或密码错误"
**A**: 
1. 确认已在 Supabase Dashboard 创建用户
2. 确认用户已被确认 (Auto Confirm 或手动确认)
3. 确认密码正确

### Q: 页面一直显示 "验证登录状态..."
**A**: 
1. 检查浏览器 Console 是否有错误
2. 确认 Supabase 服务正常
3. 清除 localStorage 后重试
