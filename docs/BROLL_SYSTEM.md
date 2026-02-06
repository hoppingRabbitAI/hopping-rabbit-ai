# B-Roll 系统设计与实现（统一文档）

> 合并自：BROLL_AGENT_DESIGN / BROLL_FEATURE / BROLL_IMPLEMENTATION_SUMMARY / BROLL_PHASE_2_4_DESIGN / BROLL_PHASE2_4_COMPLETED
> 
> 目标：为「一键成片」与编辑器提供 **B-Roll 智能推荐 + 素材搜索 + 下载与多源支持** 的单一权威文档。

---

## 1. 系统定位与目标

B-Roll 系统是 AI 一键成片流程中的关键环节，通过语义分析自动为口播视频推荐合适的素材，并支持从素材库搜索、下载、拖拽到时间轴。

核心目标：
- 🎯 智能识别：判断是否需要 B-Roll
- 🎬 类型决策：视频或图片
- ⏱️ 时长匹配：与片段长度匹配
- 🔍 关键词提取：用于素材检索
- 📦 素材搜索：Pexels / Pixabay / Kling AI

---

## 2. 架构概览

### 2.1 工作流（Agent 侧）

```
输入片段列表 → LLM 语义分析 → 关键词/时长建议 → 素材搜索 → 排序返回
```

### 2.2 素材库侧（编辑器）

```
用户搜索 → 结果预览 → 拖拽到时间轴 → 下载到项目资源库（可选）
```

### 2.3 核心代码位置

```
backend/app/services/broll_agent.py
backend/app/api/broll.py
backend/app/tasks/broll_download.py
frontend/src/features/editor/components/BRollPanel.tsx
frontend/src/features/editor/components/Timeline.tsx
```

---

## 3. 规则与策略

### 3.1 何时需要 B-Roll

**强烈建议添加：**
- 描述具体事物
- 提到地点/场景
- 抽象概念（数据增长/概念解释）
- 列举/举例/情绪高潮/话题转折

**不建议添加：**
- 人物特写强调
- 过短片段（< 2 秒）
- 正在展示产品/互动性内容

### 3.2 类型选择

| 类型 | 适用场景 |
|------|---------|
| 视频 | 动态场景、产品演示、抽象概念 |
| 图片 | 静态物体、信息图表、截图 |

### 3.3 时长建议

- 2-5s：快速展示
- 5-10s：场景建立
- 10-15s：复杂概念

> 限制：B-Roll 时长不超过片段时长的 80%

---

## 4. API 与数据格式

### 4.1 搜索接口

```
GET /api/broll/search?source=pexels&query=nature&page=1&per_page=20
```

### 4.2 下载接口（项目资源库）

```
POST /api/broll/download
```

### 4.3 进度查询

```
GET /api/broll/download/{task_id}/status
```

### 4.4 Kling 任务

```
GET /api/broll/kling/tasks?project_id=...
```

---

## 5. 前端交互（编辑器）

- 左侧工具栏 B-roll 面板
- 支持搜索/热门标签/分页
- 支持拖拽到时间轴
- 支持下载进度显示
- 支持来源切换（Pexels / Pixabay / Kling）

### 5.1 PiP（画中画）摘要

- 支持显示模式：fullscreen / pip / mixed
- PiP 可配置：尺寸、默认位置、边距、圆角
- 可选人脸避让（MediaPipe Face Detection）
- mixed 模式可设定 PiP 比例与最小时长

---

## 6. 当前实现状态

### ✅ 已完成
- Pexels 搜索与拖拽
- B-roll 面板 UI
- 多源搜索（Pexels / Pixabay）
- B-roll 下载到项目资源库
- Kling AI 生成界面
- 下载进度与任务查询

### ⚠️ 可继续优化
- 智能匹配（基于上下文自动推荐）
- 搜索历史与收藏
- 高级筛选（时长/FPS/色调）
- AI 自动关键词生成

---

## 7. 环境配置

```
# backend/.env
PEXELS_API_KEY=...
PIXABAY_API_KEY=...
REDIS_URL=redis://localhost:6379/0
```

---

## 8. 文件清单（关键）

- backend/app/api/broll.py
- backend/app/tasks/broll_download.py
- frontend/src/features/editor/components/BRollPanel.tsx
- frontend/src/features/editor/components/Timeline.tsx
- supabase/migrations/20260127_add_broll_metadata.sql

---

## 9. 相关说明

- Pexels API：200 次/小时、20k/月
- 必须显示来源归属（前端已满足）
- 下载任务使用 Celery + Redis

---

**最后更新**: 2026-02-04
