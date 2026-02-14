# Backend Features 架构

> 按功能模块组织代码，每个 feature 包含完整的 API、Service、Task

## 目录结构

```
features/
├── workspace/          # 工作区流程（上传 → 处理 → 进入编辑器）
│   ├── api.py             # FastAPI 路由
│   ├── service.py         # 业务逻辑
│   └── schemas.py         # Pydantic 模型
│
├── editor/             # 编辑器核心（项目、轨道、片段、关键帧）
│   ├── api/
│   │   ├── projects.py
│   │   ├── tracks.py
│   │   ├── clips.py
│   │   └── keyframes.py
│   ├── service.py
│   └── schemas.py
│
├── ai/                 # AI 处理任务
│   ├── api.py             # 任务触发接口
│   ├── tasks/             # Celery 任务
│   │   └── transcribe.py     # ASR 转写
│   └── schemas.py
│
├── export/             # 导出功能
│   ├── api.py
│   ├── tasks/
│   │   ├── render.py
│   │   └── subtitle_burn.py
│   └── schemas.py
│
└── vision/             # 视觉分析
    └── service.py
```

## 迁移计划

采用渐进式迁移，保持服务稳定：

1. **Phase 1**: 新功能直接在 features/ 下开发
2. **Phase 2**: 将 workspace 模块迁入（上传流程独立性强）
3. **Phase 3**: 将 AI tasks 迁入
4. **Phase 4**: 将 editor 核心迁入
5. **Phase 5**: 将 export 迁入，清理旧代码

## 模块间依赖

```
workspace ──→ editor (创建项目后进入编辑器)
    │
    └──→ ai (处理任务)

editor ──→ ai (智能功能)
   │
   └──→ export (导出)
```

## 共享代码

保留在 `app/core/` 下：
- `config.py` - 配置
- `supabase.py` - Supabase 客户端
- `auth.py` - 认证中间件
