# HoppingRabbit AI 技术设计文档
## 专业级视频编辑平台完整技术方案

> **Version**: 1.0.0  
> **Author**: 技术架构团队  
> **Last Updated**: 2026年1月6日  
> **Status**: 🚧 设计阶段

---

## 📋 文档目录

### 第一部分：整体架构设计
1. [系统架构概览](#1-系统架构概览)
2. [核心设计理念](#2-核心设计理念)
3. [技术栈选型](#3-技术栈选型)
4. [数据流设计](#4-数据流设计)

### 第二部分：后端 API 设计
5. [API 接口全景图](#5-api-接口全景图)
6. [项目管理模块](#6-项目管理模块)
7. [资源管理模块](#7-资源管理模块)
8. [AI 处理模块](#8-ai-处理模块)
9. [导出渲染模块](#9-导出渲染模块)

### 第三部分：数据库与存储
10. [数据库表结构设计](#10-数据库表结构设计)
11. [索引与查询优化](#11-索引与查询优化)
12. [对象存储策略](#12-对象存储策略)

### 第四部分：前端状态管理
13. [前端 Store 架构](#13-前端-store-架构)
14. [API 调用点映射](#14-api-调用点映射)
15. [毫秒级保存机制](#15-毫秒级保存机制)
16. [离线容灾方案](#16-离线容灾方案)

### 第五部分：AI 技术实现
17. [ASR 语音识别](#17-asr-语音识别)
18. [人声伴奏分离](#18-人声伴奏分离)
19. [说话人分离 (Diarization)](#19-说话人分离-diarization)
20. [智能剪辑算法](#20-智能剪辑算法)

### 第六部分：性能优化
21. [缓存策略设计](#21-缓存策略设计)
22. [视频代理与预览](#22-视频代理与预览)
23. [音频波形生成](#23-音频波形生成)
24. [CDN 与加速](#24-cdn-与加速)

### 第七部分：部署与运维
25. [Docker 容器化](#25-docker-容器化)
26. [Celery 任务队列](#26-celery-任务队列)
27. [监控与告警](#27-监控与告警)
28. [扩展性设计](#28-扩展性设计)

### 附录
- [A. 错误码规范](#附录a-错误码规范)
- [B. WebSocket 消息协议](#附录b-websocket-消息协议)
- [C. Timeline JSON Schema](#附录c-timeline-json-schema)
- [D. 性能指标 SLA](#附录d-性能指标-sla)

---

## 1. 系统架构概览

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         用户浏览器 (Browser)                              │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────────┐ │
│  │ Next.js App  │   │ IndexedDB    │   │ LocalStorage (Fallback)    │ │
│  │ (React 18)   │   │ (Timeline)   │   │ (Settings)                 │ │
│  └──────┬───────┘   └──────────────┘   └─────────────────────────────┘ │
└─────────┼─────────────────────────────────────────────────────────────────┘
          │ HTTPS / WebSocket
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      API Gateway / Load Balancer                        │
│                         (Nginx / Cloudflare)                             │
└─────────┬───────────────────────────────────────────────────────────────┘
          │
          ├──────────────┬────────────────┬──────────────────┐
          ▼              ▼                ▼                  ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  FastAPI    │  │  WebSocket   │  │  Supabase    │  │  Redis       │
│  (Backend)  │  │  Server      │  │  Storage     │  │  (Cache)     │
│  8000       │  │  8001        │  │  (S3-like)   │  │  6379        │
└──────┬──────┘  └──────────────┘  └──────────────┘  └──────────────┘
       │
       │ Dispatch Tasks
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Celery Task Queue (RabbitMQ)                         │
└─────────┬──────────────────────┬───────────────────────────────────────┘
          │                      │
          ▼                      ▼
┌─────────────────┐    ┌─────────────────────────────────────────────────┐
│  CPU Workers    │    │  GPU Workers (CUDA / M-Series Mac)              │
│  - Export       │    │  - Whisper (ASR)                                │
│  - Waveform     │    │  - Demucs (Stem Separation)                     │
│  - Thumbnail    │    │  - Pyannote (Speaker Diarization)               │
└─────────────────┘    └─────────────────────────────────────────────────┘
          │                      │
          └──────────┬───────────┘
                     ▼
          ┌─────────────────────┐
          │  Supabase Postgres  │
          │  (Metadata DB)      │
          └─────────────────────┘
```

### 1.2 技术分层

| 层级 | 职责 | 关键技术 | 响应时间目标 |
|------|------|----------|-------------|
| **呈现层** | UI 渲染、本地状态管理 | Next.js 14, Zustand, Canvas API | < 16ms (60 FPS) |
| **接口层** | API 网关、鉴权、限流 | FastAPI, JWT, Rate Limiter | < 100ms (P95) |
| **业务层** | 项目逻辑、任务调度 | Pydantic, Celery | < 200ms (P95) |
| **数据层** | 持久化存储 | Supabase Postgres, Redis | < 50ms (P99) |
| **计算层** | AI 推理、视频渲染 | Whisper, Demucs, FFmpeg | 异步（秒级到分钟级） |

---

## 2. 核心设计理念

### 2.1 类 CapCut 体验的四大支柱

#### ✅ 1. 乐观 UI (Optimistic UI)
**原则**: 所有用户操作立即在前端生效，不等待后端响应。

**实现方式**:
- 用户拖动片段时，立即更新 Zustand Store 中的 `clip.start` 属性。
- 同时发起 API 请求到 `/api/projects/save`（带防抖）。
- 如果请求失败，显示"离线模式"标识，数据存入 IndexedDB 待同步队列。

**代码示例**:
```typescript
// 前端：乐观更新
const moveClip = (clipId: string, newStart: number) => {
  // 1. 立即更新 UI（0ms 延迟）
  set(state => ({
    clips: state.clips.map(c => 
      c.id === clipId ? { ...c, start: newStart } : c
    )
  }));
  
  // 2. 异步同步到后端（防抖 3 秒）
  debouncedSaveToBackend();
};
```

#### ✅ 2. 增量同步 (Incremental Sync)
**问题**: 完整的项目 JSON 可能达到 10MB（包含数千个片段的元数据）。

**方案**: 使用 **Operation Log** (类似 Git Commits) 记录用户操作，只传输增量变更。

**数据结构**:
```typescript
interface Operation {
  id: string;
  type: 'UPDATE_CLIP' | 'DELETE_CLIP' | 'ADD_TRACK' | ...;
  timestamp: number;
  payload: any;
  appliedToServer: boolean;
}
```

#### ✅ 3. 多级缓存 (Multi-Tier Cache)
```
User Action
   ↓
Memory (Zustand) ────┐
   ↓                 │ 容灾备份
IndexedDB ──────────┘
   ↓
Backend API
   ↓
PostgreSQL
```

#### ✅ 4. 渐进式增强 (Progressive Enhancement)
- **网络良好**: 实时同步 + WebSocket 通知。
- **网络不稳定**: 自动降级为轮询模式。
- **完全离线**: 所有操作存入本地，联网后批量上传。

### 2.2 性能目标 (Performance SLA)

| 操作 | 目标延迟 | 测量方式 |
|------|---------|---------|
| 拖动片段 | < 16ms | `requestAnimationFrame` 帧率 |
| 切割视频 | < 50ms | 操作到 UI 更新 |
| 播放/暂停 | < 100ms | 点击到状态变化 |
| 加载项目 | < 2s | 首屏可交互时间 (TTI) |
| ASR 转写 (1分钟视频) | < 30s | Celery 任务完成时间 |
| 导出视频 (1080p, 5分钟) | < 3min | 后台任务完成时间 |

---

## 3. 技术栈选型

### 3.1 前端技术栈

| 组件 | 技术选型 | 理由 |
|------|---------|------|
| **框架** | Next.js 14 (App Router) | SSR + 静态优化，SEO 友好 |
| **状态管理** | Zustand | 轻量级，性能优于 Redux |
| **视频播放** | Video.js / Custom HTMLVideoElement | 精确控制播放进度 |
| **时间轴渲染** | Canvas API + Konva.js | 高性能绘制，支持数万元素 |
| **拖拽** | react-dnd / @dnd-kit | 触摸屏兼容，可访问性 |
| **本地存储** | Dexie.js (IndexedDB 封装) | 存储大型 JSON 对象 |
| **网络请求** | Axios + SWR | 自动重试 + 缓存 |

### 3.2 后端技术栈

| 组件 | 技术选型 | 理由 |
|------|---------|------|
| **Web 框架** | FastAPI 0.110+ | 原生异步，自动文档生成 |
| **任务队列** | Celery 5.3 + RabbitMQ | 成熟的分布式任务系统 |
| **数据库** | Supabase Postgres 15 | 开源，实时订阅，RLS |
| **缓存** | Redis 7.2 | 高性能，支持复杂数据结构 |
| **对象存储** | Supabase Storage (兼容 S3) | 免费额度，CDN 加速 |
| **ASR** | faster-whisper (Large V3) | 比 OpenAI Whisper 快 4x |
| **音频分离** | Demucs Hybrid Transformer | SOTA 人声分离质量 |
| **说话人分离** | pyannote.audio 3.1 | 工业级 Diarization |
| **视频处理** | FFmpeg 6.1 | 行业标准 |

### 3.3 基础设施

| 组件 | 技术选型 | 理由 |
|------|---------|------|
| **容器化** | Docker + Docker Compose | 本地开发环境一致性 |
| **反向代理** | Nginx / Caddy | 自动 HTTPS，限流 |
| **监控** | Prometheus + Grafana | 开源，可视化 |
| **日志** | Loki + Promtail | 与 Grafana 集成 |
| **CI/CD** | GitHub Actions | 免费，易配置 |

---

## 4. 数据流设计

### 4.1 用户上传视频流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant F as 前端
    participant API as FastAPI
    participant S3 as Supabase Storage
    participant MQ as RabbitMQ
    participant W as GPU Worker

    U->>F: 选择视频文件
    F->>API: POST /api/upload (文件元信息)
    API->>F: 返回预签名 URL
    F->>S3: 直传视频文件 (避免占用后端带宽)
    S3->>F: 上传完成
    F->>API: POST /api/projects/create (video_url)
    API->>MQ: 发布 transcribe_video 任务
    API->>F: 返回 project_id + task_id
    F->>U: 显示 "转写中..." 进度条

    loop 每2秒轮询
        F->>API: GET /api/tasks/{task_id}
        API->>F: { progress: 45% }
    end

    W->>API: 任务完成，更新 DB
    API->>F: WebSocket 推送完成事件
    F->>U: 显示 "转写完成，加载编辑器"
```

### 4.2 毫秒级自动保存流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant Z as Zustand Store
    participant IDB as IndexedDB
    participant D as Debouncer
    participant API as Backend API

    U->>Z: 拖动片段
    Z->>Z: 更新内存状态 (0ms)
    Z->>IDB: 写入本地备份 (5ms)
    Z->>D: 触发防抖定时器

    Note over D: 等待 3 秒无新操作

    D->>API: PATCH /api/projects/{id}/state
    alt 网络正常
        API->>D: 200 OK, version: 42
        D->>IDB: 标记已同步
    else 网络失败
        API->>D: 503 Service Unavailable
        D->>IDB: 加入待同步队列
        D->>U: 显示 "离线模式"
    end
```

---

## 5. API 接口全景图

### 5.1 接口分类总览

```
HoppingRabbit AI Backend API
├── /api/auth          # 🔐 认证鉴权（预留）
│   ├── POST   /register
│   ├── POST   /login
│   └── POST   /logout
│
├── /api/projects      # 📁 项目管理
│   ├── GET    /                      # 获取项目列表
│   ├── POST   /                      # 创建新项目
│   ├── GET    /{project_id}          # 获取项目详情
│   ├── PATCH  /{project_id}          # 更新项目元信息
│   ├── DELETE /{project_id}          # 删除项目
│   ├── PATCH  /{project_id}/state    # 保存时间轴状态（核心）
│   └── GET    /{project_id}/history  # 获取历史版本
│
├── /api/assets        # 🎬 资源管理
│   ├── GET    /                      # 获取资源列表
│   ├── POST   /presign-upload        # 获取上传签名 URL
│   ├── POST   /confirm-upload        # 确认上传完成
│   ├── DELETE /{asset_id}            # 删除资源
│   └── GET    /{asset_id}/waveform   # 获取音频波形数据
│
├── /api/tasks         # ⚙️ AI 计算任务
│   ├── POST   /asr                   # 触发 ASR 转写
│   ├── POST   /stem-separation       # 触发人声分离
│   ├── POST   /speaker-diarization   # 触发说话人分离
│   ├── POST   /auto-caption          # 触发自动字幕
│   ├── GET    /{task_id}             # 查询任务状态
│   └── DELETE /{task_id}             # 取消任务
│
├── /api/export        # 🎥 导出渲染
│   ├── POST   /                      # 提交导出任务
│   ├── GET    /{export_id}           # 查询导出进度
│   └── GET    /{export_id}/download  # 下载导出视频
│
└── /api/system        # 🛠️ 系统工具
    ├── GET    /health                # 健康检查
    ├── GET    /fonts                 # 获取字体列表
    └── GET    /presets               # 获取导出预设
```

### 5.2 核心接口设计细节

---

## 6. 项目管理模块

### 6.1 创建项目

**端点**: `POST /api/projects`

**请求体**:
```json
{
  "name": "我的第一个项目",
  "video_asset_id": "uuid-of-uploaded-video",
  "settings": {
    "resolution": { "width": 1920, "height": 1080 },
    "fps": 30,
    "sample_rate": 48000
  }
}
```

**响应体** (201 Created):
```json
{
  "id": "proj_a1b2c3d4e5f6",
  "name": "我的第一个项目",
  "status": "initializing",
  "created_at": "2026-01-06T10:30:00Z",
  "assets": [
    {
      "id": "asset_video_001",
      "type": "video",
      "url": "https://storage.supabase.co/videos/raw/proj_xxx.mp4",
      "proxy_url": "https://storage.supabase.co/videos/proxy/proj_xxx_720p.mp4",
      "metadata": {
        "duration": 125.5,
        "width": 1920,
        "height": 1080,
        "codec": "h264"
      }
    }
  ],
  "timeline": {
    "tracks": [],
    "clips": [],
    "version": 1
  }
}
```

**业务逻辑**:
1. 验证 `video_asset_id` 存在且属于当前用户。
2. 在数据库创建 `projects` 记录，状态为 `initializing`。
3. 异步触发 **视频预处理任务**:
   - 生成 720p 代理视频（用于编辑预览）。
   - 生成雪碧图（timeline 缩略图）。
   - 提取音频并生成波形数据。
4. 返回项目 ID，前端可立即跳转到编辑器页面。

---

### 6.2 保存项目状态（核心）

**端点**: `PATCH /api/projects/{project_id}/state`

**设计哲学**: 
- 支持**增量同步**和**全量同步**两种模式。
- 使用版本号 (Optimistic Concurrency Control) 避免冲突。

**请求体（增量模式）**:
```json
{
  "version": 42,  // 客户端当前版本号
  "operations": [
    {
      "type": "UPDATE_CLIP",
      "timestamp": 1704524400000,
      "payload": {
        "clip_id": "clip_001",
        "start": 5.2,
        "duration": 3.5
      }
    },
    {
      "type": "DELETE_TRACK",
      "timestamp": 1704524401000,
      "payload": {
        "track_id": "track_003"
      }
    }
  ]
}
```

**请求体（全量模式）**:
```json
{
  "version": 42,
  "timeline": {
    "tracks": [ /* 完整 tracks 数组 */ ],
    "clips": [ /* 完整 clips 数组 */ ],
    "effects": [ /* 特效配置 */ ]
  }
}
```

**响应体** (200 OK):
```json
{
  "success": true,
  "new_version": 43,
  "saved_at": "2026-01-06T10:35:12Z"
}
```

**冲突处理** (409 Conflict):
```json
{
  "error": "version_conflict",
  "message": "服务器版本为 45，客户端版本为 42",
  "server_version": 45,
  "suggestion": "请刷新页面重新加载最新状态"
}
```

**后端实现伪代码**:
```python
@router.patch("/projects/{project_id}/state")
async def save_project_state(
    project_id: str,
    request: SaveStateRequest,
    db: Database = Depends(get_db)
):
    # 1. 检查版本冲突
    current = await db.fetch_one(
        "SELECT version FROM projects WHERE id = $1", project_id
    )
    if current["version"] != request.version:
        raise HTTPException(409, detail={
            "error": "version_conflict",
            "server_version": current["version"]
        })
    
    # 2. 应用操作或保存全量状态
    if request.operations:
        # 增量模式：逐个应用操作
        for op in request.operations:
            await apply_operation(db, project_id, op)
    else:
        # 全量模式：替换整个 timeline
        await db.execute(
            "UPDATE projects SET timeline = $1 WHERE id = $2",
            request.timeline, project_id
        )
    
    # 3. 递增版本号
    new_version = request.version + 1
    await db.execute(
        "UPDATE projects SET version = $1, updated_at = NOW() WHERE id = $2",
        new_version, project_id
    )
    
    # 4. （可选）保存历史快照到 timeline_snapshots 表
    if new_version % 10 == 0:  # 每 10 个版本保存一次
        await save_snapshot(db, project_id, new_version)
    
    return {"success": True, "new_version": new_version}
```

---

### 6.3 获取项目历史版本

**端点**: `GET /api/projects/{project_id}/history`

**查询参数**:
- `limit`: 返回最近 N 个版本（默认 20）
- `before_version`: 分页参数

**响应体**:
```json
{
  "snapshots": [
    {
      "version": 50,
      "created_at": "2026-01-06T11:00:00Z",
      "description": "自动保存",
      "size_bytes": 1024000
    },
    {
      "version": 40,
      "created_at": "2026-01-06T10:45:00Z",
      "description": "手动保存检查点",
      "size_bytes": 980000
    }
  ]
}
```

**用途**: 实现"版本历史"功能，用户可以回滚到任意保存点。

---

## 7. 资源管理模块

### 7.1 获取预签名上传 URL

**端点**: `POST /api/assets/presign-upload`

**为什么需要这个接口？**
- 大文件（如 4K 视频）不应该经过 FastAPI 服务器。
- 直接从浏览器上传到对象存储（Supabase Storage / S3）。
- 后端只负责生成带权限的临时 URL。

**请求体**:
```json
{
  "file_name": "my_video.mp4",
  "file_size": 524288000,  // 500 MB
  "content_type": "video/mp4"
}
```

**响应体**:
```json
{
  "asset_id": "asset_abc123",
  "upload_url": "https://storage.supabase.co/v1/upload/videos/temp/abc123.mp4?token=...",
  "expires_in": 3600,  // 1 小时后过期
  "callback_url": "/api/assets/confirm-upload"
}
```

**前端上传流程**:
```typescript
// 1. 获取签名 URL
const { asset_id, upload_url } = await api.post('/assets/presign-upload', {
  file_name: file.name,
  file_size: file.size,
  content_type: file.type
});

// 2. 直传到对象存储
await axios.put(upload_url, file, {
  headers: { 'Content-Type': file.type },
  onUploadProgress: (e) => setProgress(e.loaded / e.total * 100)
});

// 3. 通知后端上传完成
await api.post('/assets/confirm-upload', { asset_id });
```

---

### 7.2 确认上传完成

**端点**: `POST /api/assets/confirm-upload`

**请求体**:
```json
{
  "asset_id": "asset_abc123"
}
```

**后端逻辑**:
1. 验证文件确实存在于对象存储中。
2. 使用 FFprobe 提取视频元数据（分辨率、时长、编码格式）。
3. 触发后台任务：
   - 生成代理视频（720p H.264）。
   - 生成雪碧图（每秒一帧）。
   - 提取音频并生成波形数据。
4. 更新 `assets` 表，设置状态为 `processing`。

**响应体**:
```json
{
  "asset_id": "asset_abc123",
  "status": "processing",
  "tasks": [
    { "type": "generate_proxy", "task_id": "task_001" },
    { "type": "extract_audio", "task_id": "task_002" },
    { "type": "generate_waveform", "task_id": "task_003" }
  ]
}
```

---

### 7.3 获取音频波形数据

**端点**: `GET /api/assets/{asset_id}/waveform`

**查询参数**:
- `resolution`: 每秒采样点数（默认 100）
- `cache`: 是否使用缓存（默认 true）

**响应体**:
```json
{
  "asset_id": "asset_abc123",
  "duration": 125.5,
  "sample_rate": 48000,
  "channels": 2,
  "data": {
    "left": [0.1, 0.3, 0.5, ..., 0.2],   // 12550 个点（125.5秒 × 100）
    "right": [0.12, 0.28, 0.48, ..., 0.18]
  },
  "peaks": {
    "min": -0.95,
    "max": 0.98
  }
}
```

**缓存策略**:
- 首次请求时计算并存入 Redis（key: `waveform:{asset_id}:{resolution}`）。
- 设置 TTL 为 7 天。
- 同时上传 `.waveform.json` 文件到对象存储作为永久备份。

**生成算法**:
```python
import librosa
import numpy as np

def generate_waveform(audio_path: str, target_points: int = 12000):
    # 1. 加载音频（只取单声道，降低计算量）
    y, sr = librosa.load(audio_path, sr=16000, mono=False)
    
    # 2. 计算每个采样窗口的 RMS 能量
    hop_length = len(y[0]) // target_points
    rms_left = librosa.feature.rms(y=y[0], hop_length=hop_length)[0]
    rms_right = librosa.feature.rms(y=y[1], hop_length=hop_length)[0]
    
    # 3. 归一化到 [-1, 1]
    max_val = max(rms_left.max(), rms_right.max())
    return {
        "left": (rms_left / max_val).tolist(),
        "right": (rms_right / max_val).tolist()
    }
```

---

## 8. AI 处理模块

### 8.1 触发 ASR 转写

**端点**: `POST /api/tasks/asr`

**请求体**:
```json
{
  "asset_id": "asset_abc123",
  "language": "zh",  // zh, en, auto
  "model": "large-v3",  // tiny, base, small, medium, large-v3
  "enable_diarization": true,  // 是否启用说话人分离
  "enable_word_timestamps": true  // 是否返回字级时间戳
}
```

**响应体**:
```json
{
  "task_id": "task_asr_xyz789",
  "status": "pending",
  "estimated_time": 45  // 预计需要 45 秒
}
```

**轮询任务状态**: `GET /api/tasks/task_asr_xyz789`

```json
{
  "task_id": "task_asr_xyz789",
  "status": "processing",  // pending | processing | completed | failed
  "progress": 68,
  "current_step": "正在转写音频...",
  "result": null
}
```

**任务完成时的 result 字段**:
```json
{
  "task_id": "task_asr_xyz789",
  "status": "completed",
  "progress": 100,
  "result": {
    "segments": [
      {
        "id": "seg_001",
        "text": "大家好，欢迎来到我的频道",
        "start": 0.5,
        "end": 3.2,
        "speaker": "SPEAKER_00",  // 说话人 ID（如果启用 diarization）
        "words": [
          { "word": "大家好", "start": 0.5, "end": 1.1, "confidence": 0.95 },
          { "word": "欢迎", "start": 1.2, "end": 1.6, "confidence": 0.92 },
          { "word": "来到", "start": 1.7, "end": 2.0, "confidence": 0.89 },
          { "word": "我的", "start": 2.1, "end": 2.5, "confidence": 0.94 },
          { "word": "频道", "start": 2.6, "end": 3.2, "confidence": 0.97 }
        ]
      },
      {
        "id": "seg_002",
        "text": "今天我们来聊一聊人工智能",
        "start": 3.5,
        "end": 6.8,
        "speaker": "SPEAKER_00",
        "words": [ /* ... */ ]
      }
    ],
    "language": "zh",
    "duration": 125.5,
    "word_count": 342
  }
}
```

**后端 Celery 任务实现要点**:

```python
@celery_app.task(bind=True)
def transcribe_with_diarization(self, asset_id: str, options: dict):
    try:
        # 1. 下载音频文件
        audio_path = download_asset(asset_id)
        
        # 2. 使用 faster-whisper 进行 ASR
        from faster_whisper import WhisperModel
        model = WhisperModel("large-v3", device="cuda", compute_type="float16")
        
        segments_raw, info = model.transcribe(
            audio_path,
            language=options["language"],
            word_timestamps=True,
            vad_filter=True,  # 过滤静音段
            vad_parameters=dict(min_silence_duration_ms=500)
        )
        
        # 3. 如果启用说话人分离
        if options["enable_diarization"]:
            from pyannote.audio import Pipeline
            diarization_pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=settings.HUGGINGFACE_TOKEN
            )
            diarization = diarization_pipeline(audio_path)
            
            # 4. 合并 ASR 和 Diarization 结果
            segments = merge_asr_and_diarization(segments_raw, diarization)
        else:
            segments = list(segments_raw)
        
        # 5. 保存结果到数据库
        save_transcription_result(asset_id, segments)
        
        return {"segments": segments, "language": info.language}
        
    except Exception as e:
        self.update_state(state="FAILURE", meta={"error": str(e)})
        raise
```

---

### 8.2 触发人声伴奏分离

**端点**: `POST /api/tasks/stem-separation`

**请求体**:
```json
{
  "asset_id": "asset_abc123",
  "model": "htdemucs",  // htdemucs | htdemucs_ft | mdx_extra
  "stems": ["vocals", "accompaniment"]  // 可选: drums, bass, other
}
```

**响应体**:
```json
{
  "task_id": "task_stem_xyz456",
  "status": "pending",
  "estimated_time": 120  // 预计 2 分钟
}
```

**任务完成后的 result**:
```json
{
  "task_id": "task_stem_xyz456",
  "status": "completed",
  "result": {
    "stems": [
      {
        "type": "vocals",
        "asset_id": "asset_vocals_001",
        "url": "https://storage.supabase.co/audio/stems/vocals_abc123.mp3",
        "duration": 125.5
      },
      {
        "type": "accompaniment",
        "asset_id": "asset_acc_001",
        "url": "https://storage.supabase.co/audio/stems/accompaniment_abc123.mp3",
        "duration": 125.5
      }
    ]
  }
}
```

**前端接收到结果后的处理**:
```typescript
// 1. 自动添加两条新音轨到时间轴
const { stems } = taskResult.result;

stems.forEach(stem => {
  const trackId = editorStore.addTrack(`${stem.type} Track`);
  editorStore.addClip({
    id: `clip_${stem.asset_id}`,
    type: 'audio',
    trackId,
    assetId: stem.asset_id,
    url: stem.url,
    start: 0,
    duration: stem.duration
  });
});

// 2. 可选：静音或删除原始音轨
editorStore.updateClip(originalClipId, { muted: true });
```

**Celery 任务实现**:
```python
@celery_app.task(bind=True)
def separate_stems(self, asset_id: str, options: dict):
    import demucs.separate
    
    # 1. 下载音频
    audio_path = download_asset(asset_id)
    
    # 2. 运行 Demucs
    self.update_state(state="PROCESSING", meta={"progress": 10})
    
    demucs.separate.main([
        "--two-stems", "vocals",  # 只分离人声和伴奏
        "-n", options["model"],
        audio_path
    ])
    
    # 3. 上传分离后的文件到对象存储
    stems = []
    for stem_type in ["vocals", "no_vocals"]:
        stem_path = f"separated/{stem_type}.wav"
        asset_id = upload_to_storage(stem_path)
        stems.append({
            "type": stem_type,
            "asset_id": asset_id,
            "url": get_asset_url(asset_id)
        })
    
    return {"stems": stems}
```

---

### 8.3 说话人分离 (Speaker Diarization)

**端点**: `POST /api/tasks/speaker-diarization`

**用途**: 在多人对话的视频中，识别"谁在什么时候说话"。

**请求体**:
```json
{
  "asset_id": "asset_abc123",
  "num_speakers": null,  // null 表示自动检测，也可以指定人数
  "min_speakers": 1,
  "max_speakers": 10
}
```

**响应体**:
```json
{
  "task_id": "task_diarization_xyz",
  "status": "pending"
}
```

**完成后的 result**:
```json
{
  "speakers": [
    {
      "speaker_id": "SPEAKER_00",
      "segments": [
        { "start": 0.5, "end": 5.2 },
        { "start": 12.3, "end": 18.7 }
      ],
      "total_speaking_time": 11.1
    },
    {
      "speaker_id": "SPEAKER_01",
      "segments": [
        { "start": 5.5, "end": 12.0 }
      ],
      "total_speaking_time": 6.5
    }
  ],
  "num_speakers_detected": 2
}
```

**前端应用场景**:
- 在时间轴上用不同颜色标记不同说话人的片段。
- 实现"只保留主讲人的话"功能（自动删除其他人的插话）。

---

## 9. 导出渲染模块

### 9.1 提交导出任务

**端点**: `POST /api/export`

**请求体**（核心：传递完整的 Timeline 描述）:
```json
{
  "project_id": "proj_abc123",
  "preset": "1080p_h264",  // 或自定义参数
  "custom_settings": {
    "resolution": { "width": 1920, "height": 1080 },
    "fps": 30,
    "video_codec": "libx264",
    "video_bitrate": "5M",
    "audio_codec": "aac",
    "audio_bitrate": "192k"
  },
  "timeline": {
    "duration": 125.5,
    "tracks": [
      {
        "id": "track_001",
        "type": "video",
        "clips": [
          {
            "id": "clip_001",
            "asset_id": "asset_abc123",
            "start": 0,
            "duration": 10.5,
            "trim_start": 2.3,  // 素材内偏移
            "trim_end": 12.8,
            "effects": [
              { "type": "speed", "rate": 1.2 },
              { "type": "crop", "x": 100, "y": 50, "width": 1720, "height": 980 }
            ]
          }
        ]
      },
      {
        "id": "track_002",
        "type": "audio",
        "clips": [ /* ... */ ]
      }
    ]
  }
}
```

**后端渲染流程**:

```python
@celery_app.task(bind=True)
def render_video(self, export_id: str, timeline: dict, settings: dict):
    import ffmpeg
    
    # 1. 解析 timeline，生成 FFmpeg 滤镜图
    filter_complex = build_filter_graph(timeline)
    
    # 2. 构建 FFmpeg 命令
    inputs = []
    for clip in get_all_clips(timeline):
        inputs.append(ffmpeg.input(clip["url"]))
    
    output = ffmpeg.output(
        *inputs,
        f"exports/{export_id}.mp4",
        vcodec=settings["video_codec"],
        acodec=settings["audio_codec"],
        video_bitrate=settings["video_bitrate"],
        filter_complex=filter_complex
    )
    
    # 3. 执行渲染（监控进度）
    process = output.run_async(pipe_stdout=True, pipe_stderr=True)
    
    while True:
        stderr_line = process.stderr.readline().decode()
        if "time=" in stderr_line:
            # 解析当前渲染到第几秒
            current_time = parse_ffmpeg_time(stderr_line)
            progress = int(current_time / timeline["duration"] * 100)
            self.update_state(state="PROCESSING", meta={"progress": progress})
        
        if process.poll() is not None:
            break
    
    # 4. 上传到对象存储
    final_url = upload_to_storage(f"exports/{export_id}.mp4")
    
    return {"download_url": final_url, "file_size": get_file_size(final_url)}
```

**FFmpeg 滤镜图示例**（针对上面的 timeline）:
```
ffmpeg -i input.mp4 \
  -filter_complex "\
    [0:v]trim=2.3:12.8,setpts=PTS-STARTPTS[v0]; \
    [v0]setpts=PTS/1.2[v1]; \
    [v1]crop=1720:980:100:50[vout]; \
  " \
  -map "[vout]" -map 0:a output.mp4
```

---

## 10. 数据库表结构设计

### 10.1 核心表设计

#### 10.1.1 projects 表（项目主表）

```sql
CREATE TABLE projects (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 用户关联（预留多租户支持）
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- 基本信息
    name TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    
    -- 项目设置
    settings JSONB NOT NULL DEFAULT '{
        "resolution": {"width": 1920, "height": 1080},
        "fps": 30,
        "sample_rate": 48000,
        "background_color": "#000000"
    }'::jsonb,
    
    -- 时间轴数据（核心字段）
    timeline JSONB NOT NULL DEFAULT '{
        "tracks": [],
        "clips": [],
        "effects": [],
        "markers": []
    }'::jsonb,
    
    -- 版本控制
    version INTEGER NOT NULL DEFAULT 1,
    last_synced_at TIMESTAMPTZ,
    last_synced_by UUID REFERENCES auth.users(id),
    
    -- 状态管理
    status TEXT NOT NULL DEFAULT 'draft',
        CHECK (status IN ('draft', 'ready', 'exporting', 'archived', 'deleted')),
    
    -- 统计信息
    duration FLOAT GENERATED ALWAYS AS (
        (timeline->>'duration')::float
    ) STORED,
    clip_count INTEGER GENERATED ALWAYS AS (
        jsonb_array_length(timeline->'clips')
    ) STORED,
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 索引
CREATE INDEX idx_projects_user_id ON projects(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX idx_projects_timeline_gin ON projects USING GIN (timeline);

-- 自动更新 updated_at
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

#### 10.1.2 assets 表（资源库）

```sql
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 所属项目
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 资源类型
    type TEXT NOT NULL CHECK (type IN (
        'video', 'audio', 'image', 'subtitle', 
        'stem_vocals', 'stem_accompaniment', 'stem_drums', 'stem_bass'
    )),
    
    -- 存储路径
    storage_path TEXT NOT NULL,  -- Supabase Storage 相对路径
    url TEXT NOT NULL,           -- 完整访问 URL
    proxy_url TEXT,              -- 代理视频 URL（低分辨率）
    thumbnail_url TEXT,          -- 缩略图
    sprite_sheet_url TEXT,       -- 雪碧图（时间轴预览）
    
    -- 文件信息
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,   -- 字节
    mime_type TEXT NOT NULL,
    
    -- 媒体元数据
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    /*
    视频示例:
    {
        "width": 1920,
        "height": 1080,
        "duration": 125.5,
        "fps": 30,
        "codec": "h264",
        "bitrate": 5000000,
        "has_audio": true
    }
    
    音频示例:
    {
        "duration": 125.5,
        "sample_rate": 48000,
        "channels": 2,
        "codec": "aac",
        "bitrate": 192000
    }
    */
    
    -- 波形数据（音频专用）
    waveform_data JSONB,  -- 存储波形峰值数组
    waveform_resolution INTEGER DEFAULT 100,  -- 每秒采样点数
    
    -- 来源标记
    is_generated BOOLEAN DEFAULT FALSE,  -- 是否为 AI 生成的衍生资源
    parent_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    generation_method TEXT,  -- 'asr', 'stem_separation', 'proxy_generation'
    
    -- 状态
    status TEXT NOT NULL DEFAULT 'uploading',
        CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
    processing_progress INTEGER DEFAULT 0,  -- 0-100
    error_message TEXT,
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 索引
CREATE INDEX idx_assets_project_id ON assets(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assets_user_id ON assets(user_id);
CREATE INDEX idx_assets_type ON assets(type);
CREATE INDEX idx_assets_parent_id ON assets(parent_asset_id);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_metadata_gin ON assets USING GIN (metadata);
```

#### 10.1.3 timeline_snapshots 表（版本历史）

```sql
CREATE TABLE timeline_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    -- 版本信息
    version INTEGER NOT NULL,
    version_hash TEXT,  -- SHA256(timeline JSON)，用于去重
    
    -- 快照数据
    timeline_data JSONB NOT NULL,
    
    -- 描述
    snapshot_type TEXT NOT NULL DEFAULT 'auto',
        CHECK (snapshot_type IN ('auto', 'manual', 'checkpoint')),
    description TEXT,
    
    -- 大小优化
    is_compressed BOOLEAN DEFAULT FALSE,
    compressed_size BIGINT,  -- 压缩后大小
    original_size BIGINT,    -- 原始大小
    
    -- 创建信息
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 过期策略
    expires_at TIMESTAMPTZ,  -- 自动快照 90 天后删除
    
    UNIQUE (project_id, version)
);

-- 索引
CREATE INDEX idx_snapshots_project_version ON timeline_snapshots(project_id, version DESC);
CREATE INDEX idx_snapshots_created_at ON timeline_snapshots(created_at DESC);
CREATE INDEX idx_snapshots_expires_at ON timeline_snapshots(expires_at) 
    WHERE expires_at IS NOT NULL;
```

#### 10.1.4 tasks 表（异步任务追踪）

```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 任务类型
    task_type TEXT NOT NULL CHECK (task_type IN (
        'asr', 'stem_separation', 'speaker_diarization',
        'generate_proxy', 'generate_waveform', 'generate_sprite',
        'export_video', 'auto_caption'
    )),
    
    -- 关联资源
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Celery 任务 ID
    celery_task_id TEXT NOT NULL UNIQUE,
    
    -- 状态
    status TEXT NOT NULL DEFAULT 'pending',
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0,  -- 0-100
    current_step TEXT,
    
    -- 配置参数
    input_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- 结果
    result JSONB,
    error_message TEXT,
    error_traceback TEXT,
    
    -- 性能指标
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    execution_time FLOAT GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (completed_at - started_at))
    ) STORED,
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_tasks_celery_id ON tasks(celery_task_id);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_asset_id ON tasks(asset_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_type_status ON tasks(task_type, status);
CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);
```

#### 10.1.5 export_jobs 表（导出任务）

```sql
CREATE TABLE export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 导出配置
    preset TEXT,  -- '1080p_h264', '4k_hevc', 'web_optimized'
    custom_settings JSONB,
    /*
    {
        "resolution": {"width": 1920, "height": 1080},
        "fps": 30,
        "video_codec": "libx264",
        "video_bitrate": "5M",
        "audio_codec": "aac",
        "audio_bitrate": "192k"
    }
    */
    
    -- 时间轴快照（导出时的状态）
    timeline_snapshot JSONB NOT NULL,
    
    -- 任务状态
    task_id UUID REFERENCES tasks(id),
    status TEXT NOT NULL DEFAULT 'queued',
        CHECK (status IN ('queued', 'rendering', 'uploading', 'completed', 'failed')),
    progress INTEGER DEFAULT 0,
    
    -- 输出文件
    output_url TEXT,
    output_file_size BIGINT,
    output_duration FLOAT,
    
    -- 错误信息
    error_message TEXT,
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ  -- 导出文件保留 7 天
);

-- 索引
CREATE INDEX idx_exports_project_id ON export_jobs(project_id);
CREATE INDEX idx_exports_user_id ON export_jobs(user_id);
CREATE INDEX idx_exports_status ON export_jobs(status);
CREATE INDEX idx_exports_expires_at ON export_jobs(expires_at) 
    WHERE expires_at IS NOT NULL;
```

#### 10.1.6 transcriptions 表（转写结果）

```sql
CREATE TABLE transcriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    
    -- 转写参数
    language TEXT NOT NULL,
    model TEXT NOT NULL,  -- 'large-v3', 'medium', etc.
    
    -- 转写结果
    segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    /*
    [
        {
            "id": "seg_001",
            "text": "大家好",
            "start": 0.5,
            "end": 1.2,
            "speaker": "SPEAKER_00",
            "words": [
                {"word": "大家好", "start": 0.5, "end": 1.2, "confidence": 0.95}
            ]
        }
    ]
    */
    
    -- 统计信息
    total_segments INTEGER GENERATED ALWAYS AS (
        jsonb_array_length(segments)
    ) STORED,
    total_words INTEGER,
    average_confidence FLOAT,
    
    -- 说话人分离
    has_diarization BOOLEAN DEFAULT FALSE,
    num_speakers INTEGER,
    
    -- 创建信息
    task_id UUID REFERENCES tasks(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_transcriptions_asset_id ON transcriptions(asset_id);
CREATE INDEX idx_transcriptions_project_id ON transcriptions(project_id);
CREATE INDEX idx_transcriptions_segments_gin ON transcriptions USING GIN (segments);
```

---

### 10.2 辅助表设计

#### 10.2.1 user_preferences 表

```sql
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 编辑器设置
    editor_settings JSONB DEFAULT '{
        "auto_save_interval": 3000,
        "default_track_height": 60,
        "waveform_color": "#4CAF50",
        "snap_to_grid": true,
        "grid_size": 0.1
    }'::jsonb,
    
    -- 导出预设
    export_presets JSONB DEFAULT '[]'::jsonb,
    
    -- 快捷键映射
    keyboard_shortcuts JSONB,
    
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 10.2.2 system_fonts 表

```sql
CREATE TABLE system_fonts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    font_family TEXT NOT NULL,
    
    -- 字体文件
    variants JSONB NOT NULL,  -- ['regular', 'bold', 'italic']
    file_urls JSONB NOT NULL,
    /*
    {
        "regular": "https://.../font-regular.woff2",
        "bold": "https://.../font-bold.woff2"
    }
    */
    
    -- 许可信息
    license TEXT,
    is_free BOOLEAN DEFAULT TRUE,
    
    -- 语言支持
    supported_languages TEXT[] DEFAULT ARRAY['zh', 'en'],
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 11. 索引与查询优化

### 11.1 查询性能优化

#### 11.1.1 最频繁查询（热路径）

```sql
-- 1. 加载项目详情（编辑器打开时）
-- 目标: < 50ms
EXPLAIN ANALYZE
SELECT 
    p.*,
    json_agg(DISTINCT a.*) FILTER (WHERE a.id IS NOT NULL) AS assets,
    json_agg(DISTINCT t.*) FILTER (WHERE t.id IS NOT NULL) AS recent_tasks
FROM projects p
LEFT JOIN assets a ON a.project_id = p.id AND a.deleted_at IS NULL
LEFT JOIN tasks t ON t.project_id = p.id AND t.created_at > NOW() - INTERVAL '1 hour'
WHERE p.id = $1 AND p.deleted_at IS NULL
GROUP BY p.id;

-- 优化: 添加部分索引
CREATE INDEX idx_assets_project_recent ON assets(project_id, created_at DESC) 
    WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '7 days';
```

#### 11.1.2 全文搜索（搜索转写文本）

```sql
-- 在 transcriptions 表添加全文搜索索引
ALTER TABLE transcriptions ADD COLUMN search_vector tsvector 
    GENERATED ALWAYS AS (
        to_tsvector('chinese_zh', 
            jsonb_path_query_array(segments, '$[*].text')::text
        )
    ) STORED;

CREATE INDEX idx_transcriptions_search ON transcriptions USING GIN (search_vector);

-- 搜索查询
SELECT t.id, t.asset_id, 
       ts_headline('chinese_zh', 
           (segments->>0)::text, 
           plainto_tsquery('chinese_zh', '人工智能')
       ) AS snippet
FROM transcriptions t
WHERE search_vector @@ plainto_tsquery('chinese_zh', '人工智能')
ORDER BY ts_rank(search_vector, plainto_tsquery('chinese_zh', '人工智能')) DESC
LIMIT 20;
```

### 11.2 分区策略

对于大用户量场景，按用户 ID 进行水平分区：

```sql
-- 将 projects 表分区（仅 PostgreSQL 12+）
CREATE TABLE projects_partitioned (
    LIKE projects INCLUDING ALL
) PARTITION BY HASH (user_id);

-- 创建 16 个分区
CREATE TABLE projects_part_0 PARTITION OF projects_partitioned
    FOR VALUES WITH (MODULUS 16, REMAINDER 0);
-- ... 创建 projects_part_1 到 projects_part_15
```

---

## 12. 对象存储策略

### 12.1 存储桶规划

```
videos/                    # 主要存储桶
├── raw/                   # 用户上传的原始视频
│   └── {project_id}/{filename}.mp4
├── proxy/                 # 720p 代理视频
│   └── {project_id}/{filename}_proxy.mp4
├── sprites/               # 时间轴雪碧图
│   └── {asset_id}.jpg
├── audio/                 # 提取的音频
│   └── stems/             # 分离后的音轨
│       ├── {asset_id}_vocals.mp3
│       └── {asset_id}_accompaniment.mp3
├── waveforms/             # 波形数据
│   └── {asset_id}.json
└── exports/               # 导出的视频
    └── {export_id}.mp4
```

### 12.2 生命周期策略

```json
{
  "rules": [
    {
      "name": "Delete temporary exports after 7 days",
      "prefix": "exports/",
      "expiration": { "days": 7 }
    },
    {
      "name": "Move old proxies to cold storage after 90 days",
      "prefix": "proxy/",
      "transitions": [
        {
          "days": 90,
          "storage_class": "GLACIER"
        }
      ]
    }
  ]
}
```

### 12.3 CDN 加速配置

```typescript
// 前端加载资源时自动选择最优 CDN
const getAssetUrl = (path: string) => {
  const cdnDomains = [
    'cdn1.hoppingrabbit.ai',
    'cdn2.hoppingrabbit.ai',
    'cdn3.hoppingrabbit.ai'
  ];
  
  // 根据路径哈希选择 CDN（简单负载均衡）
  const hash = path.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const domain = cdnDomains[hash % cdnDomains.length];
  
  return `https://${domain}/${path}`;
};
```

---

## 13. 前端 Store 架构

### 13.1 Zustand Store 分层设计

为了避免单一 Store 过于庞大，采用**切片模式 (Slices Pattern)**：

```typescript
// src/stores/index.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { createTimelineSlice, TimelineSlice } from './slices/timeline';
import { createProjectSlice, ProjectSlice } from './slices/project';
import { createPlaybackSlice, PlaybackSlice } from './slices/playback';
import { createSyncSlice, SyncSlice } from './slices/sync';

type EditorStore = TimelineSlice & ProjectSlice & PlaybackSlice & SyncSlice;

export const useEditorStore = create<EditorStore>()(
  devtools(
    persist(
      (set, get, api) => ({
        ...createTimelineSlice(set, get, api),
        ...createProjectSlice(set, get, api),
        ...createPlaybackSlice(set, get, api),
        ...createSyncSlice(set, get, api),
      }),
      {
        name: 'hoppingrabbit-editor',
        // 只持久化部分字段到 LocalStorage
        partialize: (state) => ({
          recentProjects: state.recentProjects,
          editorPreferences: state.editorPreferences,
        }),
      }
    )
  )
);
```

### 13.2 Timeline Slice（时间轴管理）

```typescript
// src/stores/slices/timeline.ts
export interface TimelineSlice {
  // ========== 状态 ==========
  tracks: Track[];
  clips: Clip[];
  selectedClipIds: Set<string>;
  
  // ========== 轨道操作 ==========
  addTrack: (type: ClipType, name?: string) => string;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;
  
  // ========== 片段操作 ==========
  addClip: (clip: Clip) => void;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  moveClip: (clipId: string, trackId: string, newStart: number) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  
  // ========== 多选操作 ==========
  selectClip: (clipId: string, addToSelection?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  deleteSelectedClips: () => void;
  
  // ========== 历史记录 ==========
  history: TimelineState[];
  historyIndex: number;
  undo: () => void;
  redo: () => void;
  saveSnapshot: () => void;
}

export const createTimelineSlice: StateCreator<TimelineSlice> = (set, get) => ({
  tracks: [],
  clips: [],
  selectedClipIds: new Set(),
  history: [],
  historyIndex: -1,
  
  addClip: (clip) => {
    set((state) => {
      const newClips = [...state.clips, clip];
      
      // 🔥 乐观更新：立即反映在 UI
      return { clips: newClips };
    });
    
    // 🔥 触发自动保存（防抖）
    get().debouncedSave();
  },
  
  updateClip: (clipId, updates) => {
    set((state) => ({
      clips: state.clips.map(c => 
        c.id === clipId ? { ...c, ...updates } : c
      )
    }));
    
    get().debouncedSave();
  },
  
  // ... 其他方法实现
});
```

### 13.3 Sync Slice（同步管理）

```typescript
// src/stores/slices/sync.ts
import { debounce } from 'lodash';

export interface SyncSlice {
  // ========== 同步状态 ==========
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  syncError: Error | null;
  isDirty: boolean;  // 是否有未保存的更改
  isOffline: boolean;
  
  // ========== 版本控制 ==========
  serverVersion: number;
  pendingOperations: Operation[];  // 离线时的操作队列
  
  // ========== 同步方法 ==========
  saveToServer: () => Promise<void>;
  debouncedSave: () => void;
  loadFromServer: (projectId: string) => Promise<void>;
  resolveConflict: (strategy: 'local' | 'server') => Promise<void>;
}

export const createSyncSlice: StateCreator<SyncSlice> = (set, get) => ({
  isSyncing: false,
  lastSyncedAt: null,
  syncError: null,
  isDirty: false,
  isOffline: false,
  serverVersion: 0,
  pendingOperations: [],
  
  saveToServer: async () => {
    const state = get();
    
    if (state.isSyncing) return;  // 防止并发保存
    
    set({ isSyncing: true, syncError: null });
    
    try {
      const response = await api.patch(`/api/projects/${state.projectId}/state`, {
        version: state.serverVersion,
        timeline: {
          tracks: state.tracks,
          clips: state.clips,
        }
      });
      
      set({
        isSyncing: false,
        lastSyncedAt: new Date(),
        serverVersion: response.new_version,
        isDirty: false,
        isOffline: false,
      });
      
    } catch (error) {
      if (error.response?.status === 409) {
        // 版本冲突
        set({ 
          syncError: new Error('版本冲突，请刷新页面'),
          isSyncing: false 
        });
        
      } else if (!navigator.onLine) {
        // 网络离线
        set({ 
          isOffline: true,
          isSyncing: false 
        });
        
        // 将当前状态加入离线队列
        saveToIndexedDB(state);
        
      } else {
        set({ 
          syncError: error,
          isSyncing: false 
        });
      }
    }
  },
  
  // 🔥 防抖保存（3秒内无新操作才触发）
  debouncedSave: debounce(() => {
    get().saveToServer();
  }, 3000),
  
  loadFromServer: async (projectId) => {
    const response = await api.get(`/api/projects/${projectId}`);
    
    set({
      projectId,
      tracks: response.timeline.tracks,
      clips: response.timeline.clips,
      serverVersion: response.version,
      lastSyncedAt: new Date(),
      isDirty: false,
    });
  },
});
```

---

## 14. API 调用点映射

### 14.1 前端组件与 API 的对应关系

| 组件 | 触发时机 | API 端点 | 作用 |
|------|---------|---------|------|
| **UploadModal** | 用户选择视频文件 | `POST /api/assets/presign-upload` | 获取上传签名 URL |
| **UploadModal** | 上传完成 | `POST /api/assets/confirm-upload` | 触发预处理任务 |
| **Editor (onMount)** | 打开项目 | `GET /api/projects/{id}` | 加载项目完整状态 |
| **TranscriptEditor** | 点击"开始转写" | `POST /api/tasks/asr` | 触发 ASR 任务 |
| **TranscriptEditor** | 轮询任务状态 | `GET /api/tasks/{task_id}` | 获取转写进度 |
| **AssetPanel** | 点击"人声分离" | `POST /api/tasks/stem-separation` | 分离人声和伴奏 |
| **Timeline** | 拖动片段、切割等 | `PATCH /api/projects/{id}/state` | 保存时间轴状态（防抖） |
| **Header** | 点击"导出" | `POST /api/export` | 提交导出任务 |
| **ExportDialog** | 轮询导出进度 | `GET /api/export/{export_id}` | 获取渲染进度 |
| **AssetPanel** | 加载音频波形 | `GET /api/assets/{asset_id}/waveform` | 获取波形数据 |

### 14.2 关键组件的 API 集成示例

#### 14.2.1 TranscriptEditor.tsx（转写功能）

```typescript
// src/components/editor/TranscriptEditor.tsx
export const TranscriptEditor = () => {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const { project, addAsset } = useEditorStore();
  
  const startTranscription = async () => {
    try {
      // 1. 发起 ASR 任务
      const response = await api.post('/api/tasks/asr', {
        asset_id: project.mainVideoAssetId,
        language: 'zh',
        model: 'large-v3',
        enable_diarization: true,
        enable_word_timestamps: true,
      });
      
      setTaskId(response.task_id);
      
      // 2. 开始轮询进度
      pollTaskStatus(response.task_id);
      
    } catch (error) {
      toast.error('启动转写失败');
    }
  };
  
  const pollTaskStatus = async (taskId: string) => {
    const interval = setInterval(async () => {
      const status = await api.get(`/api/tasks/${taskId}`);
      
      setProgress(status.progress);
      
      if (status.status === 'completed') {
        clearInterval(interval);
        
        // 3. 将转写结果加载到编辑器
        useEditorStore.setState({
          transcript: status.result.segments,
        });
        
        toast.success('转写完成！');
        
      } else if (status.status === 'failed') {
        clearInterval(interval);
        toast.error(status.error_message);
      }
    }, 2000);  // 每 2 秒轮询一次
  };
  
  return (
    <div>
      {taskId ? (
        <Progress value={progress} />
      ) : (
        <Button onClick={startTranscription}>开始转写</Button>
      )}
    </div>
  );
};
```

#### 14.2.2 Timeline.tsx（自动保存）

```typescript
// src/components/editor/Timeline.tsx
export const Timeline = () => {
  const { clips, updateClip, debouncedSave } = useEditorStore();
  
  const handleClipDrag = (clipId: string, newStart: number) => {
    // 🔥 立即更新 UI（0ms 延迟）
    updateClip(clipId, { start: newStart });
    
    // 🔥 debouncedSave 会在 3 秒后自动调用 saveToServer
    // 不需要手动调用任何保存方法
  };
  
  return (
    <div onMouseMove={handleDragMove}>
      {clips.map(clip => (
        <ClipComponent 
          key={clip.id} 
          clip={clip} 
          onDrag={handleClipDrag} 
        />
      ))}
    </div>
  );
};
```

---

## 15. 毫秒级保存机制

### 15.1 完整实现流程

```typescript
// src/lib/sync-manager.ts
import Dexie, { Table } from 'dexie';

// ========== IndexedDB 定义 ==========
class EditorDatabase extends Dexie {
  projects!: Table<ProjectState>;
  pendingOperations!: Table<Operation>;

  constructor() {
    super('HoppingRabbitEditor');
    this.version(1).stores({
      projects: 'id, lastModified',
      pendingOperations: '++id, projectId, timestamp, synced',
    });
  }
}

const db = new EditorDatabase();

// ========== 操作记录类型 ==========
interface Operation {
  id?: number;
  projectId: string;
  type: string;
  timestamp: number;
  payload: any;
  synced: boolean;
}

// ========== 同步管理器 ==========
export class SyncManager {
  private syncTimer: NodeJS.Timeout | null = null;
  private isDirty = false;
  
  constructor(private projectId: string) {
    this.setupAutoSync();
    this.setupOnlineListener();
  }
  
  // 记录操作（供 Zustand actions 调用）
  recordOperation(type: string, payload: any) {
    const operation: Operation = {
      projectId: this.projectId,
      type,
      timestamp: Date.now(),
      payload,
      synced: false,
    };
    
    // 1. 立即保存到 IndexedDB（5ms）
    db.pendingOperations.add(operation);
    
    // 2. 标记为脏数据
    this.isDirty = true;
    
    // 3. 重置防抖计时器
    this.resetSyncTimer();
  }
  
  private resetSyncTimer() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    
    // 3 秒后执行同步
    this.syncTimer = setTimeout(() => {
      this.syncToServer();
    }, 3000);
  }
  
  private async syncToServer() {
    if (!this.isDirty) return;
    
    try {
      // 1. 获取所有未同步的操作
      const operations = await db.pendingOperations
        .where({ projectId: this.projectId, synced: false })
        .toArray();
      
      if (operations.length === 0) return;
      
      // 2. 发送到服务器
      const response = await api.patch(
        `/api/projects/${this.projectId}/state`,
        {
          version: useEditorStore.getState().serverVersion,
          operations: operations.map(op => ({
            type: op.type,
            timestamp: op.timestamp,
            payload: op.payload,
          })),
        }
      );
      
      // 3. 标记为已同步
      await db.pendingOperations
        .where('id')
        .anyOf(operations.map(op => op.id!))
        .modify({ synced: true });
      
      // 4. 更新版本号
      useEditorStore.setState({
        serverVersion: response.new_version,
        lastSyncedAt: new Date(),
        isDirty: false,
      });
      
      this.isDirty = false;
      
    } catch (error) {
      console.error('Sync failed:', error);
      
      // 网络错误：标记为离线模式
      if (!navigator.onLine) {
        useEditorStore.setState({ isOffline: true });
      }
    }
  }
  
  // 监听网络恢复
  private setupOnlineListener() {
    window.addEventListener('online', () => {
      console.log('网络已恢复，开始同步...');
      this.syncToServer();
    });
  }
  
  // 自动保存（每 30 秒强制同步一次）
  private setupAutoSync() {
    setInterval(() => {
      if (this.isDirty) {
        this.syncToServer();
      }
    }, 30000);
  }
}
```

### 15.2 在 Zustand Store 中集成

```typescript
// src/stores/slices/timeline.ts
import { SyncManager } from '@/lib/sync-manager';

export const createTimelineSlice: StateCreator<TimelineSlice> = (set, get) => {
  let syncManager: SyncManager | null = null;
  
  return {
    // ... 状态定义
    
    initProject: (projectId: string) => {
      syncManager = new SyncManager(projectId);
    },
    
    updateClip: (clipId, updates) => {
      set((state) => ({
        clips: state.clips.map(c => 
          c.id === clipId ? { ...c, ...updates } : c
        )
      }));
      
      // 🔥 记录操作到同步队列
      syncManager?.recordOperation('UPDATE_CLIP', {
        clipId,
        updates,
      });
    },
    
    deleteClip: (clipId) => {
      set((state) => ({
        clips: state.clips.filter(c => c.id !== clipId)
      }));
      
      syncManager?.recordOperation('DELETE_CLIP', { clipId });
    },
  };
};
```

---

## 16. 离线容灾方案

### 16.1 三级容灾体系

```
[用户操作] 
    ↓
[Zustand 内存状态] (0ms 响应)
    ↓
[IndexedDB 本地持久化] (5ms 写入)
    ↓
[后端 PostgreSQL] (3s 防抖后同步)
```

### 16.2 离线模式处理

```typescript
// src/lib/offline-manager.ts
export class OfflineManager {
  static async saveFullSnapshot() {
    const state = useEditorStore.getState();
    
    await db.projects.put({
      id: state.projectId,
      tracks: state.tracks,
      clips: state.clips,
      lastModified: Date.now(),
    });
  }
  
  static async restoreFromLocal(projectId: string) {
    const localState = await db.projects.get(projectId);
    
    if (!localState) {
      throw new Error('本地未找到项目数据');
    }
    
    // 询问用户是否使用本地版本
    const useLocal = confirm(
      '检测到本地有未同步的更改，是否加载本地版本？\n' +
      `最后修改时间: ${new Date(localState.lastModified).toLocaleString()}`
    );
    
    if (useLocal) {
      useEditorStore.setState({
        tracks: localState.tracks,
        clips: localState.clips,
        isDirty: true,  // 标记需要同步
      });
      
      // 立即尝试同步到服务器
      new SyncManager(projectId).syncToServer();
    }
  }
}
```

### 16.3 冲突解决 UI

```typescript
// src/components/ConflictDialog.tsx
export const ConflictDialog = ({ serverVersion, localVersion }) => {
  const resolveConflict = async (strategy: 'local' | 'server') => {
    if (strategy === 'server') {
      // 放弃本地更改，使用服务器版本
      const response = await api.get(`/api/projects/${projectId}`);
      useEditorStore.setState({
        tracks: response.timeline.tracks,
        clips: response.timeline.clips,
        serverVersion: response.version,
      });
      
    } else {
      // 强制覆盖服务器版本
      await api.patch(`/api/projects/${projectId}/state`, {
        version: null,  // 绕过版本检查
        timeline: {
          tracks: useEditorStore.getState().tracks,
          clips: useEditorStore.getState().clips,
        },
        force_override: true,
      });
    }
  };
  
  return (
    <Dialog>
      <p>检测到版本冲突，请选择保留哪个版本：</p>
      <Button onClick={() => resolveConflict('local')}>
        保留我的更改（覆盖服务器）
      </Button>
      <Button onClick={() => resolveConflict('server')}>
        使用服务器版本（放弃我的更改）
      </Button>
    </Dialog>
  );
};
```

---

## 17. ASR 语音识别

### 17.1 技术选型对比

| 模型 | 精度 | 速度 | 显存需求 | 语言支持 | 推荐场景 |
|------|------|------|---------|---------|---------|
| **Whisper Tiny** | 中等 | 极快 | < 1GB | 99种 | 实时预览 |
| **Whisper Base** | 良好 | 快 | 1-2GB | 99种 | 快速草稿 |
| **Whisper Large-V3** | 优秀 | 中等 | 10GB | 99种 | **生产推荐** |
| **Paraformer** | 优秀 | 快 | 2-3GB | 中文 | 纯中文场景 |

**最终选择**: **faster-whisper Large-V3**
- 使用 CTranslate2 加速，比原版 Whisper 快 4 倍。
- 质量接近 OpenAI Whisper API。
- 本地部署，无 API 调用成本。

### 17.2 完整 ASR 任务实现

```python
# backend/app/tasks/transcribe.py
import os
import subprocess
from faster_whisper import WhisperModel
from pyannote.audio import Pipeline
import torch

from app.tasks import celery_app
from app.config import settings
from app.services.supabase_client import get_supabase

@celery_app.task(bind=True, max_retries=3)
def transcribe_video(
    self,
    asset_id: str,
    project_id: str,
    options: dict
):
    """
    完整的 ASR 流程：
    1. 下载视频
    2. 提取音频
    3. VAD 检测静音
    4. Whisper 转写
    5. 说话人分离（可选）
    6. 保存结果
    """
    try:
        # ========== Step 1: 下载资源 ==========
        self.update_state(
            state='PROCESSING',
            meta={'progress': 5, 'message': '正在下载视频...'}
        )
        
        supabase = get_supabase()
        asset = supabase.table('assets').select('*').eq('id', asset_id).single().execute()
        
        video_path = f"/tmp/{asset_id}.mp4"
        download_from_storage(asset.data['storage_path'], video_path)
        
        # ========== Step 2: 提取音频 ==========
        self.update_state(
            state='PROCESSING',
            meta={'progress': 10, 'message': '正在提取音频...'}
        )
        
        audio_path = f"/tmp/{asset_id}.wav"
        subprocess.run([
            'ffmpeg', '-i', video_path,
            '-vn',  # 不要视频流
            '-acodec', 'pcm_s16le',  # 16-bit PCM
            '-ar', '16000',  # 16kHz 采样率（Whisper 推荐）
            '-ac', '1',  # 单声道
            audio_path
        ], check=True)
        
        # ========== Step 3: 加载 Whisper 模型 ==========
        self.update_state(
            state='PROCESSING',
            meta={'progress': 20, 'message': '正在加载 Whisper 模型...'}
        )
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        
        model = WhisperModel(
            options.get('model', 'large-v3'),
            device=device,
            compute_type=compute_type,
            download_root=settings.MODEL_CACHE_DIR
        )
        
        # ========== Step 4: 执行转写 ==========
        self.update_state(
            state='PROCESSING',
            meta={'progress': 30, 'message': '正在转写音频...'}
        )
        
        segments_raw, info = model.transcribe(
            audio_path,
            language=options.get('language', 'zh'),
            word_timestamps=True,  # ✅ 获取字级时间戳
            vad_filter=True,  # ✅ 过滤静音段
            vad_parameters=dict(
                min_silence_duration_ms=500,  # 500ms 以上的静音才切分
                threshold=0.5  # VAD 置信度阈值
            ),
            beam_size=5,  # Beam Search 宽度（越大越准确但越慢）
        )
        
        # 转换为列表（生成器只能迭代一次）
        segments = list(segments_raw)
        
        # ========== Step 5: 说话人分离（可选）==========
        if options.get('enable_diarization', False):
            self.update_state(
                state='PROCESSING',
                meta={'progress': 60, 'message': '正在识别说话人...'}
            )
            
            diarization_pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=settings.HUGGINGFACE_TOKEN
            )
            
            # 运行 Diarization
            diarization = diarization_pipeline(audio_path)
            
            # 合并 ASR 和 Diarization 结果
            segments = merge_segments_with_speakers(segments, diarization)
        
        # ========== Step 6: 格式化输出 ==========
        formatted_segments = []
        for i, segment in enumerate(segments):
            formatted_segments.append({
                "id": f"seg_{i:04d}",
                "text": segment.text.strip(),
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "speaker": getattr(segment, 'speaker', None),
                "words": [
                    {
                        "word": word.word,
                        "start": round(word.start, 2),
                        "end": round(word.end, 2),
                        "confidence": round(word.probability, 2)
                    }
                    for word in segment.words
                ] if segment.words else []
            })
        
        # ========== Step 7: 保存到数据库 ==========
        self.update_state(
            state='PROCESSING',
            meta={'progress': 90, 'message': '正在保存结果...'}
        )
        
        supabase.table('transcriptions').insert({
            'asset_id': asset_id,
            'project_id': project_id,
            'language': info.language,
            'model': options.get('model', 'large-v3'),
            'segments': formatted_segments,
            'total_words': sum(len(seg['words']) for seg in formatted_segments),
            'average_confidence': calculate_avg_confidence(formatted_segments),
            'has_diarization': options.get('enable_diarization', False),
            'num_speakers': len(set(seg.get('speaker') for seg in formatted_segments if seg.get('speaker')))
        }).execute()
        
        # ========== Step 8: 清理临时文件 ==========
        os.remove(video_path)
        os.remove(audio_path)
        
        return {
            'segments': formatted_segments,
            'language': info.language,
            'duration': info.duration,
        }
        
    except Exception as e:
        self.update_state(
            state='FAILURE',
            meta={'error': str(e)}
        )
        raise


def merge_segments_with_speakers(whisper_segments, diarization):
    """
    将 Whisper 的转写结果与 Pyannote 的说话人分离结果合并
    """
    result = []
    
    for segment in whisper_segments:
        # 找到该时间段内的主要说话人
        speaker_votes = {}
        
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            # 计算重叠时间
            overlap_start = max(segment.start, turn.start)
            overlap_end = min(segment.end, turn.end)
            overlap_duration = max(0, overlap_end - overlap_start)
            
            if overlap_duration > 0:
                speaker_votes[speaker] = speaker_votes.get(speaker, 0) + overlap_duration
        
        # 选择占用时间最长的说话人
        if speaker_votes:
            main_speaker = max(speaker_votes, key=speaker_votes.get)
            segment.speaker = main_speaker
        
        result.append(segment)
    
    return result
```

### 17.3 VAD（静音检测）优化

```python
# backend/app/tasks/vad.py
import torch
import torchaudio

def detect_silence_segments(audio_path: str, threshold_db=-40, min_duration_ms=500):
    """
    使用 Silero VAD 检测静音片段
    返回需要删除的时间段
    """
    model, utils = torch.hub.load(
        repo_or_dir='snakers4/silero-vad',
        model='silero_vad',
        force_reload=False
    )
    
    (get_speech_timestamps, _, _, _, _) = utils
    
    # 加载音频
    waveform, sample_rate = torchaudio.load(audio_path)
    
    # 检测语音时间戳
    speech_timestamps = get_speech_timestamps(
        waveform,
        model,
        sampling_rate=sample_rate,
        min_silence_duration_ms=min_duration_ms,
        threshold=0.5
    )
    
    # 计算静音片段（语音之间的间隙）
    silence_segments = []
    audio_duration = waveform.shape[1] / sample_rate
    
    for i in range(len(speech_timestamps) - 1):
        silence_start = speech_timestamps[i]['end'] / sample_rate
        silence_end = speech_timestamps[i+1]['start'] / sample_rate
        
        if silence_end - silence_start >= min_duration_ms / 1000:
            silence_segments.append({
                'start': silence_start,
                'end': silence_end,
                'duration': silence_end - silence_start
            })
    
    return silence_segments
```

---

## 18. 人声伴奏分离

### 18.1 Demucs 模型对比

| 模型 | 质量 | 速度 | 输出 |
|------|------|------|------|
| **htdemucs** | ⭐⭐⭐⭐ | 中等 | vocals, drums, bass, other |
| **htdemucs_ft** | ⭐⭐⭐⭐⭐ | 慢 | vocals, drums, bass, other |
| **mdx_extra** | ⭐⭐⭐ | 快 | vocals, instrumental |

**推荐**: **htdemucs** （质量和速度平衡）

### 18.2 完整分离任务

```python
# backend/app/tasks/stem_separation.py
import demucs.separate
import os
from pathlib import Path

@celery_app.task(bind=True)
def separate_audio_stems(
    self,
    asset_id: str,
    project_id: str,
    options: dict
):
    """
    音频轨道分离：
    - vocals: 人声
    - accompaniment: 伴奏（drums + bass + other）
    """
    try:
        # 1. 下载音频文件
        self.update_state(state='PROCESSING', meta={'progress': 5})
        
        supabase = get_supabase()
        asset = supabase.table('assets').select('*').eq('id', asset_id).single().execute()
        
        audio_path = f"/tmp/{asset_id}.wav"
        download_from_storage(asset.data['storage_path'], audio_path)
        
        # 2. 运行 Demucs
        self.update_state(state='PROCESSING', meta={'progress': 10, 'message': '正在分离音轨...'})
        
        output_dir = f"/tmp/demucs_output/{asset_id}"
        os.makedirs(output_dir, exist_ok=True)
        
        # 使用 Two-Stems 模式（只分离人声和伴奏，速度更快）
        demucs.separate.main([
            "--two-stems", "vocals",  # 只输出 vocals 和 no_vocals
            "-n", options.get('model', 'htdemucs'),
            "-o", output_dir,
            audio_path
        ])
        
        # 3. 上传分离后的文件
        self.update_state(state='PROCESSING', meta={'progress': 70, 'message': '正在上传结果...'})
        
        model_name = options.get('model', 'htdemucs')
        vocals_path = f"{output_dir}/{model_name}/{Path(audio_path).stem}/vocals.wav"
        accompaniment_path = f"{output_dir}/{model_name}/{Path(audio_path).stem}/no_vocals.wav"
        
        # 上传到对象存储
        vocals_asset_id = upload_audio_to_storage(
            vocals_path,
            f"stems/{asset_id}_vocals.wav"
        )
        
        acc_asset_id = upload_audio_to_storage(
            accompaniment_path,
            f"stems/{asset_id}_accompaniment.wav"
        )
        
        # 4. 创建 assets 记录
        stems = []
        
        for stem_type, stem_asset_id, stem_path in [
            ('stem_vocals', vocals_asset_id, vocals_path),
            ('stem_accompaniment', acc_asset_id, accompaniment_path)
        ]:
            # 获取音频元数据
            duration = get_audio_duration(stem_path)
            file_size = os.path.getsize(stem_path)
            
            asset_record = supabase.table('assets').insert({
                'project_id': project_id,
                'type': stem_type,
                'storage_path': f"stems/{asset_id}_{stem_type}.wav",
                'url': get_public_url(f"stems/{asset_id}_{stem_type}.wav"),
                'file_name': f"{stem_type}.wav",
                'file_size': file_size,
                'mime_type': 'audio/wav',
                'metadata': {
                    'duration': duration,
                    'sample_rate': 44100,
                    'channels': 2,
                    'codec': 'pcm_s16le'
                },
                'is_generated': True,
                'parent_asset_id': asset_id,
                'generation_method': 'stem_separation',
                'status': 'ready'
            }).execute()
            
            stems.append({
                'type': stem_type,
                'asset_id': asset_record.data['id'],
                'url': asset_record.data['url'],
                'duration': duration
            })
        
        # 5. 清理临时文件
        import shutil
        shutil.rmtree(output_dir)
        os.remove(audio_path)
        
        return {'stems': stems}
        
    except Exception as e:
        self.update_state(state='FAILURE', meta={'error': str(e)})
        raise
```

### 18.3 实时进度监控

Demucs 本身不提供进度回调，可以通过监控输出日志实现：

```python
import subprocess
import re

def run_demucs_with_progress(self, audio_path, output_dir, model):
    """
    运行 Demucs 并解析进度
    """
    process = subprocess.Popen(
        ['demucs', '--two-stems', 'vocals', '-n', model, '-o', output_dir, audio_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True
    )
    
    for line in process.stdout:
        # 解析进度（Demucs 输出示例：Processing chunk 45/100）
        match = re.search(r'Processing chunk (\d+)/(\d+)', line)
        if match:
            current, total = int(match.group(1)), int(match.group(2))
            progress = int((current / total) * 100)
            
            self.update_state(
                state='PROCESSING',
                meta={'progress': 10 + int(progress * 0.6), 'message': f'分离中 {current}/{total}'}
            )
    
    process.wait()
    
    if process.returncode != 0:
        raise Exception('Demucs 执行失败')
```

---

## 19. 说话人分离 (Diarization)

### 19.1 Pyannote.audio Pipeline

```python
# backend/app/tasks/diarization.py
from pyannote.audio import Pipeline
import torch

@celery_app.task(bind=True)
def speaker_diarization(
    self,
    asset_id: str,
    project_id: str,
    options: dict
):
    """
    说话人分离：识别"谁在什么时候说话"
    """
    try:
        # 1. 下载音频
        audio_path = download_asset_audio(asset_id)
        
        # 2. 加载 Diarization Pipeline
        self.update_state(state='PROCESSING', meta={'progress': 10, 'message': '加载模型...'})
        
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=settings.HUGGINGFACE_TOKEN
        )
        
        # GPU 加速
        if torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))
        
        # 3. 运行 Diarization
        self.update_state(state='PROCESSING', meta={'progress': 20, 'message': '分析说话人...'})
        
        diarization = pipeline(
            audio_path,
            num_speakers=options.get('num_speakers'),  # None 表示自动检测
            min_speakers=options.get('min_speakers', 1),
            max_speakers=options.get('max_speakers', 10)
        )
        
        # 4. 格式化结果
        speakers = {}
        
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            if speaker not in speakers:
                speakers[speaker] = {
                    'speaker_id': speaker,
                    'segments': [],
                    'total_speaking_time': 0
                }
            
            segment = {
                'start': round(turn.start, 2),
                'end': round(turn.end, 2)
            }
            
            speakers[speaker]['segments'].append(segment)
            speakers[speaker]['total_speaking_time'] += turn.end - turn.start
        
        # 5. 保存结果
        result = {
            'speakers': list(speakers.values()),
            'num_speakers_detected': len(speakers)
        }
        
        supabase = get_supabase()
        supabase.table('tasks').update({
            'status': 'completed',
            'result': result
        }).eq('celery_task_id', self.request.id).execute()
        
        return result
        
    except Exception as e:
        self.update_state(state='FAILURE', meta={'error': str(e)})
        raise
```

### 19.2 前端应用：按说话人筛选

```typescript
// src/components/editor/SpeakerFilter.tsx
export const SpeakerFilter = () => {
  const { transcript, updateSegment } = useEditorStore();
  const [selectedSpeakers, setSelectedSpeakers] = useState<Set<string>>(new Set());
  
  // 获取所有说话人
  const speakers = useMemo(() => {
    const uniqueSpeakers = new Set<string>();
    transcript.forEach(seg => {
      if (seg.speaker) {
        uniqueSpeakers.add(seg.speaker);
      }
    });
    return Array.from(uniqueSpeakers);
  }, [transcript]);
  
  const toggleSpeaker = (speaker: string) => {
    const newSet = new Set(selectedSpeakers);
    if (newSet.has(speaker)) {
      newSet.delete(speaker);
    } else {
      newSet.add(speaker);
    }
    setSelectedSpeakers(newSet);
  };
  
  const deleteOtherSpeakers = () => {
    // 删除未选中说话人的所有片段
    transcript.forEach(seg => {
      if (seg.speaker && !selectedSpeakers.has(seg.speaker)) {
        updateSegment(seg.id, { is_deleted: true, delete_reason: 'speaker_filter' });
      }
    });
  };
  
  return (
    <div className="speaker-filter">
      <h3>说话人筛选</h3>
      {speakers.map(speaker => (
        <label key={speaker}>
          <input
            type="checkbox"
            checked={selectedSpeakers.has(speaker)}
            onChange={() => toggleSpeaker(speaker)}
          />
          {speaker}
        </label>
      ))}
      <Button onClick={deleteOtherSpeakers}>
        只保留选中的说话人
      </Button>
    </div>
  );
};
```

---

## 20. 智能剪辑算法

### 20.1 自动删除冗余片段

```python
# backend/app/tasks/smart_clean.py
@celery_app.task
def auto_delete_redundant_segments(project_id: str, options: dict):
    """
    智能剪辑：自动标记需要删除的片段
    1. 语气词/口头禅（"呃"、"嗯"、"那个"）
    2. 长时间静音（> 2秒）
    3. 重复语句
    """
    supabase = get_supabase()
    
    # 获取转写结果
    transcription = supabase.table('transcriptions') \
        .select('segments') \
        .eq('project_id', project_id) \
        .single() \
        .execute()
    
    segments = transcription.data['segments']
    suggestions = []
    
    # ========== 1. 检测语气词 ==========
    filler_words = ['呃', '嗯', '啊', '那个', '就是', '然后']
    
    for seg in segments:
        text = seg['text'].strip()
        if text in filler_words or len(text) <= 2:
            suggestions.append({
                'segment_id': seg['id'],
                'reason': 'filler_word',
                'confidence': 0.95,
                'description': f'检测到语气词："{text}"'
            })
    
    # ========== 2. 检测长时间静音 ==========
    for i in range(len(segments) - 1):
        gap = segments[i+1]['start'] - segments[i]['end']
        if gap > options.get('max_silence_duration', 2.0):
            suggestions.append({
                'segment_id': None,
                'time_range': [segments[i]['end'], segments[i+1]['start']],
                'reason': 'long_silence',
                'confidence': 0.9,
                'description': f'检测到 {gap:.1f} 秒静音'
            })
    
    # ========== 3. 检测重复语句 ==========
    for i in range(len(segments) - 1):
        similarity = calculate_text_similarity(
            segments[i]['text'],
            segments[i+1]['text']
        )
        if similarity > 0.8:  # 80% 相似度
            suggestions.append({
                'segment_id': segments[i+1]['id'],
                'reason': 'duplicate',
                'confidence': similarity,
                'description': '检测到重复语句'
            })
    
    return {'suggestions': suggestions, 'total': len(suggestions)}


def calculate_text_similarity(text1: str, text2: str) -> float:
    """计算文本相似度（Levenshtein 距离）"""
    from difflib import SequenceMatcher
    return SequenceMatcher(None, text1, text2).ratio()
```

### 20.2 前端智能剪辑 UI

```typescript
// src/components/editor/SmartCleanPanel.tsx
export const SmartCleanPanel = () => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const { projectId, updateSegment } = useEditorStore();
  
  const runSmartClean = async () => {
    const result = await api.post(`/api/tasks/smart-clean`, {
      project_id: projectId,
      options: {
        max_silence_duration: 2.0,
        remove_filler_words: true,
        remove_duplicates: true
      }
    });
    
    setSuggestions(result.suggestions);
  };
  
  const applyAllSuggestions = () => {
    suggestions.forEach(sug => {
      if (sug.segment_id) {
        updateSegment(sug.segment_id, {
          is_deleted: true,
          delete_reason: sug.reason
        });
      }
    });
  };
  
  return (
    <div>
      <Button onClick={runSmartClean}>运行智能剪辑</Button>
      
      {suggestions.length > 0 && (
        <>
          <p>找到 {suggestions.length} 个建议删除的片段</p>
          <Button onClick={applyAllSuggestions}>全部应用</Button>
          
          <ul>
            {suggestions.map(sug => (
              <li key={sug.segment_id}>
                {sug.description} (置信度: {(sug.confidence * 100).toFixed(0)}%)
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
```

---

## 21. 缓存策略设计

### 21.1 多级缓存架构

```
┌─────────────────────────────────────────────────────────┐
│ L1: 浏览器内存 (React State)        │ TTL: Session    │
│ - 当前项目的 Timeline 状态           │ 容量: ~10MB    │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ L2: IndexedDB                       │ TTL: 30 days    │
│ - 项目历史版本                       │ 容量: ~50MB    │
│ - 音频波形数据                       │                │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ L3: Redis (服务器端)                │ TTL: 7 days     │
│ - API 响应缓存                       │ 容量: 2GB      │
│ - 音频波形数据                       │                │
│ - 任务状态                          │                │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ L4: CDN Edge Cache                  │ TTL: 365 days   │
│ - 静态资源（代理视频、雪碧图）        │ 容量: Unlimited│
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ L5: Object Storage (Supabase/S3)    │ TTL: Permanent  │
│ - 原始视频文件                       │                │
│ - 导出的成品视频                     │                │
└─────────────────────────────────────────────────────────┘
```

### 21.2 Redis 缓存策略

```python
# backend/app/services/cache.py
import redis
import json
from functools import wraps
from app.config import settings

redis_client = redis.Redis(
    host=settings.REDIS_HOST,
    port=settings.REDIS_PORT,
    db=0,
    decode_responses=True
)

def cache_api_response(ttl: int = 300):
    """
    装饰器：缓存 API 响应
    
    用法:
    @cache_api_response(ttl=3600)
    async def get_project(project_id: str):
        ...
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 生成缓存 key
            cache_key = f"api:{func.__name__}:{args}:{kwargs}"
            
            # 尝试从缓存读取
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
            
            # 执行原函数
            result = await func(*args, **kwargs)
            
            # 写入缓存
            redis_client.setex(
                cache_key,
                ttl,
                json.dumps(result, default=str)
            )
            
            return result
        
        return wrapper
    return decorator


# 使用示例
@router.get("/projects/{project_id}")
@cache_api_response(ttl=60)  # 缓存 1 分钟
async def get_project(project_id: str):
    # ... 数据库查询
    return project_data
```

### 21.3 波形数据缓存

```python
# backend/app/services/waveform_cache.py
import numpy as np
import redis
import pickle

class WaveformCache:
    def __init__(self):
        self.redis = redis_client
    
    def get_waveform(self, asset_id: str, resolution: int = 100) -> dict | None:
        """从缓存获取波形数据"""
        cache_key = f"waveform:{asset_id}:{resolution}"
        
        data = self.redis.get(cache_key)
        if data:
            return pickle.loads(data)
        
        return None
    
    def set_waveform(self, asset_id: str, waveform_data: dict, resolution: int = 100):
        """存储波形数据到 Redis"""
        cache_key = f"waveform:{asset_id}:{resolution}"
        
        # 使用 pickle 序列化 NumPy 数组
        serialized = pickle.dumps(waveform_data)
        
        # 设置 7 天过期
        self.redis.setex(cache_key, 604800, serialized)
    
    def generate_and_cache(self, asset_id: str, audio_path: str, resolution: int = 100):
        """生成波形并缓存"""
        import librosa
        
        # 检查缓存
        cached = self.get_waveform(asset_id, resolution)
        if cached:
            return cached
        
        # 生成波形
        y, sr = librosa.load(audio_path, sr=16000, mono=False)
        
        hop_length = len(y[0]) // resolution
        rms_left = librosa.feature.rms(y=y[0], hop_length=hop_length)[0]
        rms_right = librosa.feature.rms(y=y[1], hop_length=hop_length)[0]
        
        max_val = max(rms_left.max(), rms_right.max())
        
        waveform_data = {
            "left": (rms_left / max_val).tolist(),
            "right": (rms_right / max_val).tolist(),
            "duration": len(y[0]) / sr,
            "sample_rate": sr
        }
        
        # 存入缓存
        self.set_waveform(asset_id, waveform_data, resolution)
        
        return waveform_data
```

---

## 22. 视频代理与预览

### 22.1 为什么需要代理视频？

| 问题 | 原始 4K 视频 | 720p 代理视频 |
|------|-------------|--------------|
| 文件大小 | 500 MB | 50 MB |
| 浏览器解码性能 | 卡顿（10 FPS） | 流畅（60 FPS） |
| 网络加载时间 | 30 秒 | 3 秒 |
| 预览精确度 | 完美 | 99.9% |

**结论**: 编辑时使用代理视频，导出时使用原始视频。

### 22.2 自动生成代理视频

```python
# backend/app/tasks/generate_proxy.py
@celery_app.task(bind=True)
def generate_proxy_video(self, asset_id: str):
    """
    生成编辑代理视频：
    - 分辨率: 720p (1280x720)
    - 编码: H.264
    - 码率: 2 Mbps
    - 帧率: 保持原始帧率
    """
    try:
        # 1. 下载原始视频
        supabase = get_supabase()
        asset = supabase.table('assets').select('*').eq('id', asset_id).single().execute()
        
        original_path = f"/tmp/{asset_id}_original.mp4"
        download_from_storage(asset.data['storage_path'], original_path)
        
        # 2. 使用 FFmpeg 生成代理视频
        self.update_state(state='PROCESSING', meta={'progress': 20})
        
        proxy_path = f"/tmp/{asset_id}_proxy.mp4"
        
        subprocess.run([
            'ffmpeg', '-i', original_path,
            '-vf', 'scale=-2:720',  # 保持宽高比，高度固定 720
            '-c:v', 'libx264',
            '-preset', 'fast',  # 平衡速度和质量
            '-crf', '23',  # 质量参数（18-28，越小越好）
            '-b:v', '2M',  # 码率 2 Mbps
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',  # 优化在线播放
            '-y',
            proxy_path
        ], check=True)
        
        # 3. 上传代理视频
        self.update_state(state='PROCESSING', meta={'progress': 80})
        
        proxy_storage_path = f"proxy/{asset_id}_720p.mp4"
        upload_to_storage(proxy_path, proxy_storage_path)
        
        proxy_url = get_public_url(proxy_storage_path)
        
        # 4. 更新 assets 表
        supabase.table('assets').update({
            'proxy_url': proxy_url,
            'status': 'ready'
        }).eq('id', asset_id).execute()
        
        # 5. 清理临时文件
        os.remove(original_path)
        os.remove(proxy_path)
        
        return {'proxy_url': proxy_url}
        
    except Exception as e:
        self.update_state(state='FAILURE', meta={'error': str(e)})
        raise
```

### 22.3 前端智能切换

```typescript
// src/hooks/useVideoSource.ts
export const useVideoSource = (assetId: string) => {
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isProxy, setIsProxy] = useState(true);
  
  useEffect(() => {
    const loadAsset = async () => {
      const asset = await api.get(`/api/assets/${assetId}`);
      
      // 优先使用代理视频（编辑模式）
      if (asset.proxy_url) {
        setVideoUrl(asset.proxy_url);
        setIsProxy(true);
      } else {
        // 后备方案：使用原始视频
        setVideoUrl(asset.url);
        setIsProxy(false);
      }
    };
    
    loadAsset();
  }, [assetId]);
  
  // 切换到原始视频（高质量预览）
  const switchToOriginal = async () => {
    const asset = await api.get(`/api/assets/${assetId}`);
    setVideoUrl(asset.url);
    setIsProxy(false);
  };
  
  return { videoUrl, isProxy, switchToOriginal };
};
```

---

## 23. 音频波形生成

### 23.1 高性能波形渲染

```typescript
// src/components/editor/Waveform.tsx
import { useEffect, useRef } from 'react';

interface WaveformProps {
  assetId: string;
  width: number;
  height: number;
  color?: string;
}

export const Waveform = ({ assetId, width, height, color = '#4CAF50' }: WaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const loadAndRender = async () => {
      // 1. 尝试从 IndexedDB 读取缓存
      const db = await openDB('waveforms');
      let waveformData = await db.get('waveforms', assetId);
      
      // 2. 如果没有缓存，从 API 获取
      if (!waveformData) {
        waveformData = await api.get(`/api/assets/${assetId}/waveform`);
        // 存入 IndexedDB
        await db.put('waveforms', waveformData, assetId);
      }
      
      // 3. 渲染到 Canvas
      renderWaveform(canvasRef.current!, waveformData, color);
    };
    
    loadAndRender();
  }, [assetId]);
  
  return <canvas ref={canvasRef} width={width} height={height} />;
};

function renderWaveform(
  canvas: HTMLCanvasElement,
  data: { left: number[]; right: number[] },
  color: string
) {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const halfHeight = height / 2;
  
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  
  const barWidth = width / data.left.length;
  
  data.left.forEach((amplitude, i) => {
    const x = i * barWidth;
    const barHeight = amplitude * halfHeight;
    
    // 绘制上半部分（左声道）
    ctx.fillRect(x, halfHeight - barHeight, barWidth - 1, barHeight);
    
    // 绘制下半部分（右声道）
    const rightAmplitude = data.right[i];
    const rightBarHeight = rightAmplitude * halfHeight;
    ctx.fillRect(x, halfHeight, barWidth - 1, rightBarHeight);
  });
}
```

### 23.2 波形数据压缩

对于长时间音频（如 1 小时），波形数据可能达到数 MB，需要压缩：

```python
# backend/app/services/waveform.py
def compress_waveform(waveform_data: dict, target_points: int = 2000) -> dict:
    """
    将高分辨率波形数据压缩到目标点数
    
    示例：
    - 原始: 100 points/sec × 3600 sec = 360,000 points
    - 压缩后: 2000 points (适合时间轴显示)
    """
    left = np.array(waveform_data['left'])
    right = np.array(waveform_data['right'])
    
    # 计算压缩比
    ratio = len(left) / target_points
    
    if ratio <= 1:
        return waveform_data  # 无需压缩
    
    # 分段取最大值（保留峰值信息）
    compressed_left = []
    compressed_right = []
    
    for i in range(target_points):
        start = int(i * ratio)
        end = int((i + 1) * ratio)
        
        compressed_left.append(float(left[start:end].max()))
        compressed_right.append(float(right[start:end].max()))
    
    return {
        'left': compressed_left,
        'right': compressed_right,
        'original_length': len(left),
        'compression_ratio': ratio
    }
```

---

## 24. CDN 与加速

### 24.1 Cloudflare CDN 配置

```typescript
// src/lib/cdn.ts
const CDN_ENDPOINTS = {
  video: 'https://video-cdn.hoppingrabbit.ai',
  audio: 'https://audio-cdn.hoppingrabbit.ai',
  static: 'https://static-cdn.hoppingrabbit.ai'
};

export const getCDNUrl = (path: string, type: 'video' | 'audio' | 'static') => {
  const endpoint = CDN_ENDPOINTS[type];
  return `${endpoint}/${path}`;
};

// 使用示例
const proxyVideoUrl = getCDNUrl('proxy/abc123_720p.mp4', 'video');
```

### 24.2 Range Request 支持（断点续传）

```python
# backend/app/api/routes.py
from fastapi.responses import StreamingResponse
from starlette.requests import Request

@router.get("/stream/{asset_id}")
async def stream_video(asset_id: str, request: Request):
    """
    支持 HTTP Range 请求的视频流媒体服务
    允许用户拖动进度条时快速跳转
    """
    asset = await db.fetch_one("SELECT * FROM assets WHERE id = $1", asset_id)
    file_path = get_file_path(asset['storage_path'])
    file_size = os.path.getsize(file_path)
    
    # 解析 Range header
    range_header = request.headers.get('Range')
    
    if not range_header:
        # 完整文件
        return StreamingResponse(
            open(file_path, 'rb'),
            media_type='video/mp4'
        )
    
    # 解析 Range: bytes=0-1023
    start, end = parse_range_header(range_header, file_size)
    
    def file_chunk_generator():
        with open(file_path, 'rb') as f:
            f.seek(start)
            remaining = end - start + 1
            chunk_size = 8192
            
            while remaining > 0:
                chunk = f.read(min(chunk_size, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
    
    return StreamingResponse(
        file_chunk_generator(),
        status_code=206,  # Partial Content
        headers={
            'Content-Range': f'bytes {start}-{end}/{file_size}',
            'Accept-Ranges': 'bytes',
            'Content-Length': str(end - start + 1)
        },
        media_type='video/mp4'
    )
```

### 24.3 预加载策略

```typescript
// src/hooks/useVideoPreload.ts
export const useVideoPreload = (clips: Clip[]) => {
  useEffect(() => {
    // 预加载接下来 3 个片段的代理视频
    const currentClipIndex = /* ... */;
    const nextClips = clips.slice(currentClipIndex + 1, currentClipIndex + 4);
    
    nextClips.forEach(clip => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = clip.proxy_url;
      link.as = 'video';
      document.head.appendChild(link);
    });
  }, [clips]);
};
```

---

## 25. Docker 容器化

### 25.1 完整的 Docker Compose 配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  # ========== 前端 ==========
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
      - NEXT_PUBLIC_WS_URL=ws://localhost:8001
    volumes:
      - ./frontend:/app
      - /app/node_modules
    depends_on:
      - backend

  # ========== 后端 API ==========
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/hoppingrabbit
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=amqp://guest:guest@rabbitmq:5672//
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_KEY=${SUPABASE_KEY}
    volumes:
      - ./backend:/app
      - model-cache:/root/.cache  # 缓存 AI 模型
    depends_on:
      - db
      - redis
      - rabbitmq

  # ========== Celery Worker (CPU 任务) ==========
  celery-worker-cpu:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: celery -A app.tasks worker --loglevel=info --queues=cpu --concurrency=4
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/hoppingrabbit
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=amqp://guest:guest@rabbitmq:5672//
    volumes:
      - ./backend:/app
      - /tmp:/tmp  # 临时文件
    depends_on:
      - rabbitmq
      - redis

  # ========== Celery Worker (GPU 任务) ==========
  celery-worker-gpu:
    build:
      context: ./backend
      dockerfile: Dockerfile.gpu
    command: celery -A app.tasks worker --loglevel=info --queues=gpu --concurrency=1
    runtime: nvidia  # 需要 nvidia-docker
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/hoppingrabbit
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=amqp://guest:guest@rabbitmq:5672//
      - CUDA_VISIBLE_DEVICES=0
    volumes:
      - ./backend:/app
      - model-cache:/root/.cache
      - /tmp:/tmp
    depends_on:
      - rabbitmq
      - redis
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  # ========== PostgreSQL ==========
  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=hoppingrabbit
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./supabase/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql

  # ========== Redis ==========
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  # ========== RabbitMQ ==========
  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"  # 管理界面
    environment:
      - RABBITMQ_DEFAULT_USER=guest
      - RABBITMQ_DEFAULT_PASS=guest
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq

  # ========== Nginx (反向代理) ==========
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - frontend
      - backend

volumes:
  postgres-data:
  redis-data:
  rabbitmq-data:
  model-cache:  # 共享 AI 模型缓存
```

### 25.2 GPU 优化的 Dockerfile

```dockerfile
# backend/Dockerfile.gpu
FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

# 安装 Python
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3-pip \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# 安装 CUDA 加速版本的库
RUN pip3 install --no-cache-dir \
    torch==2.1.0+cu121 \
    torchaudio==2.1.0+cu121 \
    --index-url https://download.pytorch.org/whl/cu121

# 复制代码
COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 26. Celery 任务队列

### 26.1 队列分离策略

```python
# backend/app/tasks/__init__.py
from celery import Celery

celery_app = Celery(
    'hoppingrabbit',
    broker='amqp://guest:guest@localhost:5672//',
    backend='redis://localhost:6379/0'
)

# ========== 队列配置 ==========
celery_app.conf.task_routes = {
    # CPU 密集型任务 -> cpu 队列
    'app.tasks.export.export_video': {'queue': 'cpu'},
    'app.tasks.export.generate_proxy': {'queue': 'cpu'},
    'app.tasks.export.generate_sprite': {'queue': 'cpu'},
    'app.tasks.export.generate_waveform': {'queue': 'cpu'},
    
    # GPU 密集型任务 -> gpu 队列
    'app.tasks.transcribe.transcribe_video': {'queue': 'gpu'},
    'app.tasks.stem_separation.separate_stems': {'queue': 'gpu'},
    'app.tasks.diarization.speaker_diarization': {'queue': 'gpu'},
}

# ========== 速率限制 ==========
celery_app.conf.task_annotations = {
    # GPU 任务限流（防止显存溢出）
    'app.tasks.transcribe.*': {'rate_limit': '2/m'},  # 每分钟最多 2 个
    'app.tasks.stem_separation.*': {'rate_limit': '1/m'},  # 每分钟最多 1 个
    
    # CPU 任务
    'app.tasks.export.*': {'rate_limit': '10/m'},
}

# ========== 超时设置 ==========
celery_app.conf.task_time_limit = 3600  # 1 小时硬超时
celery_app.conf.task_soft_time_limit = 3300  # 55 分钟软超时
```

### 26.2 任务优先级

```python
# 高优先级任务（实时预览）
@celery_app.task(priority=9)
def generate_thumbnail(asset_id: str):
    pass

# 中优先级任务（常规转写）
@celery_app.task(priority=5)
def transcribe_video(asset_id: str):
    pass

# 低优先级任务（后台导出）
@celery_app.task(priority=1)
def export_video(export_id: str):
    pass
```

### 26.3 任务重试与错误处理

```python
@celery_app.task(
    bind=True,
    max_retries=3,
    autoretry_for=(ConnectionError, TimeoutError),
    retry_backoff=True,  # 指数退避
    retry_backoff_max=600,  # 最大退避 10 分钟
    retry_jitter=True  # 加入随机性避免雷鸣羊群
)
def transcribe_video(self, asset_id: str, options: dict):
    try:
        # ... 任务逻辑
        pass
    except OutOfMemoryError as e:
        # 显存不足，记录错误但不重试
        logger.error(f"GPU OOM for asset {asset_id}")
        raise self.retry(exc=e, countdown=300)  # 5 分钟后重试
    except Exception as e:
        # 其他错误，标记任务失败
        update_task_status(self.request.id, 'failed', error=str(e))
        raise
```

---

## 27. 监控与告警

### 27.1 Prometheus + Grafana 集成

```yaml
# docker-compose.monitoring.yml
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
    depends_on:
      - prometheus

  # Celery 监控
  flower:
    build:
      context: ./backend
    command: celery -A app.tasks flower --port=5555
    ports:
      - "5555:5555"
    environment:
      - CELERY_BROKER_URL=amqp://guest:guest@rabbitmq:5672//
    depends_on:
      - rabbitmq
```

### 27.2 自定义指标暴露

```python
# backend/app/monitoring.py
from prometheus_client import Counter, Histogram, Gauge
from fastapi import Request
import time

# ========== 定义指标 ==========
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'HTTP request latency',
    ['method', 'endpoint']
)

ACTIVE_TASKS = Gauge(
    'celery_active_tasks',
    'Number of active Celery tasks',
    ['queue', 'task_type']
)

# ========== 中间件 ==========
@app.middleware("http")
async def prometheus_middleware(request: Request, call_next):
    start_time = time.time()
    
    response = await call_next(request)
    
    duration = time.time() - start_time
    
    REQUEST_COUNT.labels(
        method=request.method,
        endpoint=request.url.path,
        status=response.status_code
    ).inc()
    
    REQUEST_LATENCY.labels(
        method=request.method,
        endpoint=request.url.path
    ).observe(duration)
    
    return response

# ========== 暴露端点 ==========
from prometheus_client import make_asgi_app

metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)
```

### 27.3 关键告警规则

```yaml
# prometheus/alerts.yml
groups:
  - name: hoppingrabbit_alerts
    interval: 30s
    rules:
      # API 错误率过高
      - alert: HighErrorRate
        expr: |
          rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        annotations:
          summary: "API 错误率超过 5%"
      
      # GPU 任务队列积压
      - alert: GPUQueueBacklog
        expr: |
          celery_queue_length{queue="gpu"} > 10
        for: 10m
        annotations:
          summary: "GPU 任务队列积压超过 10 个"
      
      # 数据库连接池耗尽
      - alert: DatabaseConnectionPoolExhausted
        expr: |
          pg_stat_activity_count > 90
        for: 5m
        annotations:
          summary: "数据库连接数接近上限"
      
      # Redis 内存使用过高
      - alert: RedisMemoryHigh
        expr: |
          redis_memory_used_bytes / redis_memory_max_bytes > 0.8
        for: 5m
        annotations:
          summary: "Redis 内存使用率超过 80%"
```

---

## 28. 扩展性设计

### 28.1 水平扩展方案

```
                      Load Balancer (Nginx)
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
  Backend API 1       Backend API 2       Backend API 3
  (Stateless)         (Stateless)         (Stateless)
        │                    │                    │
        └────────────────────┴────────────────────┘
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
         PostgreSQL                   Redis Cluster
         (Primary + Replicas)         (Sharded)
                │
                ▼
          RabbitMQ Cluster
                │
        ┌───────┴────────┐
        ▼                ▼
   CPU Workers      GPU Workers
   (Auto-scale)     (Fixed)
```

### 28.2 数据库读写分离

```python
# backend/app/database.py
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine

# 主库（写）
engine_write = create_async_engine(
    "postgresql+asyncpg://user:pass@primary:5432/hoppingrabbit"
)

# 从库（读）
engine_read = create_async_engine(
    "postgresql+asyncpg://user:pass@replica:5432/hoppingrabbit"
)

class Database:
    @staticmethod
    async def execute_write(query: str, *args):
        async with engine_write.begin() as conn:
            return await conn.execute(query, *args)
    
    @staticmethod
    async def execute_read(query: str, *args):
        async with engine_read.begin() as conn:
            return await conn.execute(query, *args)
```

### 28.3 GPU 资源池管理

```python
# backend/app/gpu_pool.py
import asyncio
from contextlib import asynccontextmanager

class GPUPool:
    def __init__(self, num_gpus: int = 2):
        self.semaphores = {
            i: asyncio.Semaphore(1)  # 每个 GPU 同时只能跑 1 个任务
            for i in range(num_gpus)
        }
    
    @asynccontextmanager
    async def acquire(self):
        """获取一个可用的 GPU"""
        # 轮询找到空闲的 GPU
        for gpu_id, sem in self.semaphores.items():
            if not sem.locked():
                async with sem:
                    os.environ['CUDA_VISIBLE_DEVICES'] = str(gpu_id)
                    yield gpu_id
                    return
        
        # 所有 GPU 都忙，等待第一个空闲的
        tasks = [sem.acquire() for sem in self.semaphores.values()]
        done, pending = await asyncio.wait(
            tasks,
            return_when=asyncio.FIRST_COMPLETED
        )
        
        # 取消其他等待
        for p in pending:
            p.cancel()
        
        gpu_id = list(self.semaphores.keys())[list(done)[0]]
        os.environ['CUDA_VISIBLE_DEVICES'] = str(gpu_id)
        yield gpu_id

# 使用示例
gpu_pool = GPUPool(num_gpus=2)

@celery_app.task
async def transcribe_video(asset_id: str):
    async with gpu_pool.acquire() as gpu_id:
        logger.info(f"Using GPU {gpu_id} for transcription")
        # ... 运行 Whisper
```

---

## 附录A: 错误码规范

```typescript
// src/types/errors.ts
export enum ErrorCode {
  // 4xx 客户端错误
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  
  // 5xx 服务器错误
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  
  // 业务错误
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  TRANSCRIPTION_FAILED = 'TRANSCRIPTION_FAILED',
  EXPORT_FAILED = 'EXPORT_FAILED',
  GPU_OUT_OF_MEMORY = 'GPU_OUT_OF_MEMORY',
  TASK_TIMEOUT = 'TASK_TIMEOUT',
  
  // 同步错误
  VERSION_CONFLICT = 'VERSION_CONFLICT',
  SYNC_FAILED = 'SYNC_FAILED',
}

export interface APIError {
  code: ErrorCode;
  message: string;
  details?: any;
  timestamp: string;
}
```

---

## 附录B: WebSocket 消息协议

```typescript
// 客户端 -> 服务器
interface WSMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  payload: {
    project_id?: string;
    task_id?: string;
  };
}

// 服务器 -> 客户端
interface WSNotification {
  type: 'task_progress' | 'task_completed' | 'project_updated';
  payload: {
    task_id?: string;
    progress?: number;
    result?: any;
    error?: string;
  };
  timestamp: string;
}

// 使用示例
const ws = new WebSocket('ws://localhost:8001');

ws.send(JSON.stringify({
  type: 'subscribe',
  payload: { project_id: 'abc123' }
}));

ws.onmessage = (event) => {
  const notification: WSNotification = JSON.parse(event.data);
  
  if (notification.type === 'task_completed') {
    toast.success('任务完成！');
    loadTaskResult(notification.payload.task_id);
  }
};
```

---

## 附录C: Timeline JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "version": { "type": "number" },
    "duration": { "type": "number" },
    "tracks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "type": { "enum": ["video", "audio", "subtitle"] },
          "name": { "type": "string" },
          "layer": { "type": "number" },
          "muted": { "type": "boolean" },
          "solo": { "type": "boolean" }
        },
        "required": ["id", "type"]
      }
    },
    "clips": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "trackId": { "type": "string" },
          "assetId": { "type": "string" },
          "start": { "type": "number" },
          "duration": { "type": "number" },
          "trimStart": { "type": "number" },
          "trimEnd": { "type": "number" },
          "effects": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": { "type": "string" },
                "params": { "type": "object" }
              }
            }
          }
        },
        "required": ["id", "trackId", "assetId", "start", "duration"]
      }
    }
  }
}
```

---

## 附录D: 性能指标 SLA

| 操作 | P50 | P95 | P99 | 目标 |
|------|-----|-----|-----|------|
| **API 请求** |
| GET /projects | 50ms | 100ms | 200ms | < 100ms (P95) |
| PATCH /projects/state | 80ms | 150ms | 300ms | < 200ms (P95) |
| POST /upload | 10s | 30s | 60s | < 30s (P95) |
| **任务处理** |
| ASR (1分钟视频) | 15s | 30s | 45s | < 30s (P95) |
| 人声分离 (5分钟) | 60s | 120s | 180s | < 120s (P95) |
| 导出 1080p (5分钟) | 120s | 180s | 300s | < 180s (P95) |
| **前端性能** |
| 首屏加载 (TTI) | 1.5s | 2.5s | 4s | < 2.5s (P95) |
| 拖拽操作延迟 | 16ms | 32ms | 50ms | < 32ms (P95) |
| 时间轴渲染帧率 | 60 FPS | 50 FPS | 30 FPS | > 50 FPS (P95) |

---

## 总结与实施路线图

### Phase 1: 基础功能（2周）
- [x] 前端编辑器基础 UI
- [ ] 后端 API 框架搭建
- [ ] 数据库表创建
- [ ] 基础上传功能

### Phase 2: 核心 AI 功能（4周）
- [ ] Whisper ASR 集成
- [ ] 人声分离集成
- [ ] 波形数据生成
- [ ] 代理视频生成

### Phase 3: 高级功能（3周）
- [ ] 说话人分离
- [ ] 智能剪辑算法
- [ ] 视频导出渲染
- [ ] 毫秒级自动保存

### Phase 4: 性能优化（2周）
- [ ] Redis 缓存
- [ ] CDN 集成
- [ ] 数据库查询优化
- [ ] 前端懒加载

### Phase 5: 生产部署（1周）
- [ ] Docker 部署
- [ ] 监控告警
- [ ] 备份策略
- [ ] 负载测试

---

**文档编写完成日期**: 2026年1月6日  
**预计实施周期**: 12 周  
**团队配置建议**: 2 前端 + 2 后端 + 1 DevOps

---

*本文档是一个动态文件，应随着项目演进持续更新。*
