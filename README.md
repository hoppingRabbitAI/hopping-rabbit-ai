# Lepus AI

> ✨ **看到什么想变成什么，传张照片就能做到。**
>
> 参考图驱动的 AI 视觉创作平台 — Visual Editor + AI 能力节点 + 转场模板系统

## 产品定位

用户在抖音/小红书/Pinterest 看到某个发色、某套穿搭、某个场景——第一反应是 **"如果是我会怎样"**。

Lepus 让这个念头 30 秒内变成一个视频：

```
用户的照片 + 任意参考图/Trend 模板 → AI 理解差异 → 生成变身视频
```

## ✨ 核心能力

- 🎨 **Visual Editor 画布** — 自由拖拽节点，连线构建 AI 工作流
- 🔄 **转场模板系统** — 模板导入→AI 指纹分析→一键复刻转场效果
- 👗 **AI 换装/变装** — 参考图驱动的服装变换、发型变换
- 💄 **美颜/打光/风格化** — 智能美颜、AI 打光、风格迁移
- 🧑 **数字人形象** — 创建个人数字分身，跨场景复用
- 🖼️ **背景替换** — 5 阶段 AI Pipeline，保持人物自然
- 🎬 **AI 视频生成** — 图生视频、多图转视频、运动控制
- 📊 **Trend 发现** — 热门模板发现 & 一键同款

## 🚀 快速开始

### 环境要求

- Node.js 18+ / pnpm 8+
- Python 3.11+
- Docker & Docker Compose

### 启动开发环境

```bash
# 配置环境变量
#   backend/.env          — API 密钥、LLM、Kling AI 等
#   frontend/.env.local   — NEXT_PUBLIC_* 变量
# 从 Supabase Dashboard → Settings → API 获取配置

# 一键启动
./start-dev.sh
```

详细本地开发指南见 [LOCAL_DEV_GUIDE.md](LOCAL_DEV_GUIDE.md)

### 访问地址

| 服务 | 地址 |
|------|------|
| 前端 (Visual Editor) | http://localhost:3000 |
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |

## 📁 项目结构

```
lepus-ai/
├── frontend/                    # Next.js 前端
│   └── src/
│       ├── app/visual-editor/   # Visual Editor 主路由
│       ├── components/
│       │   └── visual-editor/   # 画布核心组件
│       │       └── workflow/    # 工作流节点、模板、生成器
│       ├── stores/              # Zustand 状态管理
│       └── lib/api/             # API 客户端
├── backend/                     # Python FastAPI 后端
│   └── app/
│       ├── api/                 # API 路由
│       │   ├── v2_canvas.py     # 画布会话
│       │   ├── v2_capabilities.py # AI 能力注册
│       │   ├── v2_templates.py  # Trend 模板
│       │   ├── templates.py     # 转场模板
│       │   └── ...
│       ├── services/            # 业务服务
│       │   ├── ai_capability_service.py
│       │   ├── template_render_service.py
│       │   ├── background_replace_workflow.py
│       │   ├── kling_ai_service.py
│       │   └── ...
│       └── tasks/               # Celery 异步任务
├── supabase/                    # 数据库 Schema & 迁移
├── docs/                        # 设计文档
└── docker-compose.yml
```

## 🔧 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14, TypeScript, Tailwind CSS, Zustand |
| 后端 | Python 3.11, FastAPI, Celery, RabbitMQ, Redis |
| AI 引擎 | Kling AI (图/视频生成、人脸交换、口型同步) |
| 数据库 | Supabase (PostgreSQL + Auth + Storage) |
| 视频渲染 | Remotion (服务端视频合成) |

## 📚 文档

| 文档 | 说明 |
|------|------|
| [PRODUCT_PRD_V1.md](docs/PRODUCT_PRD_V1.md) | 产品需求文档 |
| [VISUAL_EDITOR_CREATOR_CANVAS_PLAN.md](docs/VISUAL_EDITOR_CREATOR_CANVAS_PLAN.md) | Visual Editor 画布设计 |
| [AI_CAPABILITY_SYSTEM.md](docs/AI_CAPABILITY_SYSTEM.md) | AI 能力集成 |
| [TEMPLATE_INGEST_AND_RENDER_WORKFLOW.md](docs/TEMPLATE_INGEST_AND_RENDER_WORKFLOW.md) | 模板系统工作流 |
| [TRANSITION_TEMPLATE_V1_SPEC.md](docs/TRANSITION_TEMPLATE_V1_SPEC.md) | 转场模板技术规格 |
| [DEVELOPMENT_STANDARDS.md](docs/DEVELOPMENT_STANDARDS.md) | 开发规范 |

## 📄 License

MIT License © 2024
