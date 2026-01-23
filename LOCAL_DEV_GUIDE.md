# HoppingRabbit AI - 本地开发启动指南

## 📋 前置要求

1. **Node.js** >= 18.0
2. **Python** >= 3.10
3. **pnpm** 包管理器
4. **Docker & Docker Compose** (推荐)
5. **ngrok** (用于接收 AI 回调)

## 🚀 启动模式选择

### 模式A: Docker完全容器化 🐳 (推荐)

**优点**: 环境一致、开箱即用、包含监控面板

```bash
# 启动所有服务（包括Celery）
docker-compose up frontend backend celery_cpu_worker redis rabbitmq flower

# 或后台运行
docker-compose up -d frontend backend celery_cpu_worker redis rabbitmq flower
```

✅ **服务地址**:
- 前端: http://localhost:3000
- 后端: http://localhost:8000
- Celery监控: http://localhost:5555
- RabbitMQ管理: http://localhost:15672 (guest/guest)

---

### 模式B: 混合模式 💻 (灵活调试)

**优点**: 快速重启单个服务、直接调试

## 🚀 启动步骤 (模式B - 混合模式)

### 1. 启动 Redis (如果没运行)
```bash
# macOS (Homebrew)
brew services start redis

# 或直接运行
redis-server
```

### 2. 启动后端 (FastAPI)
```bash
cd /Users/hexiangyang/rabbit-ai/hoppingrabbit-ai/backend
source /Users/hexiangyang/rabbit-ai/.venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
✅ 成功标志: `Application startup complete`
📍 地址: http://localhost:8000

### 3. 启动前端 (Next.js)
```bash
cd /Users/hexiangyang/rabbit-ai/hoppingrabbit-ai/frontend
pnpm dev
```
✅ 成功标志: `✓ Ready in X.Xs`
📍 地址: http://localhost:3000

### 4. 启动 Celery Worker (异步任务)
```bash
cd /Users/hexiangyang/rabbit-ai/hoppingrabbit-ai/backend
source /Users/hexiangyang/rabbit-ai/.venv/bin/activate
PYTHONPATH=$(pwd) celery -A app.celery_config worker --loglevel=info -Q default,gpu_medium
```
✅ 成功标志: `celery@xxx ready`

### 5. 启动 ngrok (AI 回调隧道)
```bash
ngrok http 8000
```
✅ 成功标志: 显示 `Forwarding https://xxx.ngrok-free.dev -> http://localhost:8000`

⚠️ **重要**: 每次启动 ngrok 后，需要更新后端的 `CALLBACK_BASE_URL` 环境变量为新的 ngrok 地址。

---

## 🔧 一键启动脚本

在项目根目录运行:
```bash
./start-dev.sh
```

---

## 📦 服务端口总览

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 Next.js | 3000 | Web 界面 |
| 后端 FastAPI | 8000 | API 服务 |
| Redis | 6379 | 消息队列 |
| ngrok | 4040 | 隧道控制台 |

---

## 🔍 常见问题

### Q: Celery 报错找不到模块
A: 确保设置了 `PYTHONPATH`:
```bash
PYTHONPATH=$(pwd) celery -A app.celery_config worker ...
```

### Q: 前端报 Supabase 连接错误
A: 检查 `frontend/.env.local` 是否配置了:
```
NEXT_PUBLIC_SUPABASE_URL=xxx
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
```

### Q: AI 回调收不到
A: 
1. 确认 ngrok 正在运行
2. 确认后端 `CALLBACK_BASE_URL` 设置正确
3. 检查 ngrok 控制台 http://127.0.0.1:4040 查看请求

### Q: Docker模式下如何查看Celery日志?
A: 
```bash
docker-compose logs -f celery_cpu_worker
```

### Q: 如何重启单个Docker服务?
A:
```bash
docker-compose restart celery_cpu_worker
```

---

## 🎯 快速命令参考

```bash
# Docker模式 - 启动所有服务
docker-compose up -d

# Docker模式 - 只启动开发必需的服务
docker-compose up -d redis rabbitmq backend frontend celery_cpu_worker

# 查看运行中的容器
docker-compose ps

# 停止所有服务
docker-compose down

# 清理并重新构建
docker-compose down -v
docker-compose build --no-cache
docker-compose up
```

---

## 📝 开发提示

- 后端代码修改会自动重载 (`--reload`)
- 前端代码修改会自动热更新
- Celery Worker 代码修改需要**重启**
