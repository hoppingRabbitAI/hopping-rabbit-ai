# 可灵 AI 集成架构文档

> **版本**: 2.0 | **更新日期**: 2026-01-23 | **状态**: 生产就绪 ✅

---

## 📋 目录

1. [架构概览](#-架构概览)
2. [已实现功能](#-已实现功能)
3. [代码结构](#-代码结构)
4. [API 接口参考](#-api-接口参考)
5. [使用示例](#-使用示例)
6. [配置说明](#-配置说明)
7. [模型支持](#-模型支持)
8. [错误处理](#-错误处理)

---

## 🏗️ 架构概览

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **API 层** | FastAPI | RESTful API 路由 (`/api/kling/*`) |
| **任务层** | Celery | 异步任务队列，10+ Worker 任务 |
| **服务层** | httpx + JWT | 可灵 AI API 客户端封装 |
| **存储层** | Supabase | PostgreSQL (ai_tasks) + Storage (assets) |
| **消息队列** | Upstash Redis | Celery Broker (SSL rediss://) |

### 数据流架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端 (Next.js)                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  数字人口播面板  │  │   产品展示面板   │  │   图像生成面板   │          │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘          │
└───────────┼─────────────────────┼─────────────────────┼─────────────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FastAPI 后端                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     /api/kling/* 路由层 (kling.py)                    │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐     │  │
│  │  │  /lip-sync  │ │/text-to-video│ │/image-gen  │ │ /omni-image │     │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘     │  │
│  └───────────────────────────────┬───────────────────────────────────────┘  │
│                                  │                                          │
│  ┌───────────────────────────────▼───────────────────────────────────────┐  │
│  │               KlingAIClient 服务层 (kling_ai_service.py)              │  │
│  │  • JWT 认证 (HS256)  • 统一错误处理  • 异步 HTTP 客户端              │  │
│  └───────────────────────────────┬───────────────────────────────────────┘  │
│                                  │                                          │
│  ┌───────────────────────────────▼───────────────────────────────────────┐  │
│  │                    Celery 任务层 (tasks/*.py)                         │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐         │  │
│  │  │ lip_sync   │ │ text2video │ │ image_gen  │ │ omni_image │  ...    │  │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘         │  │
│  │                        ▲                                              │  │
│  │                        │ 共享工具                                     │  │
│  │              ┌─────────┴─────────┐                                    │  │
│  │              │  ai_task_base.py  │ ← 公共函数模块                     │  │
│  │              └───────────────────┘                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ HTTPS
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │    可灵 AI API   │  │     Supabase     │  │  Upstash Redis   │
   │   (北京节点)     │  │   PostgreSQL +   │  │  (Celery Broker) │
   │                  │  │     Storage      │  │                  │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
```

### 任务执行流程

```
1. 创建任务
   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
   │  前端    │───▶│  API层   │───▶│ ai_tasks │───▶│ Celery   │
   │ POST请求 │    │ 创建记录 │    │  pending │    │ 调度任务 │
   └──────────┘    └──────────┘    └──────────┘    └──────────┘

2. 异步处理
   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
   │  Worker  │───▶│ 调用可灵 │───▶│ 轮询状态 │───▶│ 下载结果 │
   │ 执行任务 │    │  AI API  │    │  (30次)  │    │ 上传存储 │
   └──────────┘    └──────────┘    └──────────┘    └──────────┘

3. 结果回调
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │ 更新状态 │───▶│ 创建Asset│───▶│  前端    │
   │ completed│    │  记录    │    │  轮询获取│
   └──────────┘    └──────────┘    └──────────┘
```

---

## ✅ 已实现功能

### 视频生成 (7个)

| # | 功能 | 端点 | 可灵 API | 任务文件 | 状态 |
|---|------|------|----------|----------|------|
| 1 | **口型同步** | `POST /kling/lip-sync` | `/v1/videos/advanced-lip-sync` | `lip_sync.py` | ✅ |
| 2 | **文生视频** | `POST /kling/text-to-video` | `/v1/videos/text2video` | `text_to_video.py` | ✅ |
| 3 | **图生视频** | `POST /kling/image-to-video` | `/v1/videos/image2video` | `image_to_video.py` | ✅ |
| 4 | **多图生视频** | `POST /kling/multi-image-to-video` | `/v1/videos/multi-image2video` | `multi_image_to_video.py` | ✅ |
| 5 | **动作控制** | `POST /kling/motion-control` | `/v1/videos/motion-control` | `motion_control.py` | ✅ |
| 6 | **视频延长** | `POST /kling/video-extend` | `/v1/videos/video-extend` | `video_extend.py` | ✅ |
| 7 | **AI换脸** | `POST /kling/face-swap` | 待定 | `face_swap.py` | 🔄 |

### 图像生成 (2个)

| # | 功能 | 端点 | 可灵 API | 任务文件 | 状态 |
|---|------|------|----------|----------|------|
| 8 | **图像生成** | `POST /kling/image-generation` | `/v1/images/generations` | `image_generation.py` | ✅ |
| 9 | **Omni-Image** | `POST /kling/omni-image` | `/v1/images/omni-image` | `omni_image.py` | ✅ |

### 口播工作流 (3个)

| 功能 | 端点 | 说明 |
|------|------|------|
| 数字人口播 | `POST /kling/koubo/digital-human` | 音频 + 数字人 → 口播视频 |
| 批量换脸 | `POST /kling/koubo/batch-avatars` | 一条视频 → 多个形象版本 |
| 产品展示 | `POST /kling/koubo/product-showcase` | 产品图 → 动态展示视频 |

---

## 📂 代码结构

```
backend/app/
│
├── api/
│   └── kling.py                    # 🌐 API 路由层 (~450 行)
│       ├── LipSyncRequest          # Pydantic 请求模型
│       ├── TextToVideoRequest
│       ├── ImageToVideoRequest
│       ├── MultiImageToVideoRequest
│       ├── MotionControlRequest
│       ├── VideoExtendRequest
│       ├── ImageGenerationRequest
│       ├── OmniImageRequest
│       ├── FaceSwapRequest
│       ├── _create_ai_task()       # 公共任务创建函数
│       └── router                  # FastAPI Router
│
├── services/
│   └── kling_ai_service.py         # 🔧 服务层 (~1800 行)
│       ├── KlingAIClient           # API 客户端类
│       │   ├── _make_request()     # 统一 HTTP 请求
│       │   ├── _get_jwt_token()    # JWT 认证
│       │   ├── identify_face()     # 人脸识别
│       │   ├── create_lip_sync_task()
│       │   ├── get_lip_sync_task()
│       │   ├── create_text_to_video_task()
│       │   ├── get_text_to_video_task()
│       │   ├── create_image_to_video_task()
│       │   ├── get_image_to_video_task()
│       │   ├── create_multi_image_to_video_task()
│       │   ├── get_multi_image_to_video_task()
│       │   ├── create_motion_control_task()
│       │   ├── get_motion_control_task()
│       │   ├── create_video_extend_task()
│       │   ├── get_video_extend_task()
│       │   ├── create_image_generation_task()
│       │   ├── get_image_generation_task()
│       │   ├── create_omni_image_task()
│       │   └── get_omni_image_task()
│       └── KouboService            # 口播场景封装类
│
├── tasks/
│   ├── ai_task_base.py             # ⭐ 公共工具模块 (NEW)
│   │   ├── update_ai_task()        # 更新任务字段
│   │   ├── update_ai_task_progress() # 更新进度
│   │   ├── update_ai_task_status() # 更新状态
│   │   ├── mark_task_started()     # 标记开始
│   │   ├── mark_task_completed()   # 标记完成
│   │   ├── mark_task_failed()      # 标记失败
│   │   ├── download_file()         # 下载文件
│   │   ├── upload_to_storage()     # 上传到 Supabase
│   │   ├── download_and_upload()   # 下载+上传
│   │   ├── create_asset_record()   # 创建资产记录
│   │   ├── poll_task_status()      # 轮询任务状态
│   │   └── run_async_task()        # 运行异步任务
│   │
│   ├── lip_sync.py                 # 口型同步任务
│   ├── text_to_video.py            # 文生视频任务
│   ├── image_to_video.py           # 图生视频任务
│   ├── multi_image_to_video.py     # 多图生视频任务
│   ├── motion_control.py           # 动作控制任务
│   ├── video_extend.py             # 视频延长任务
│   ├── image_generation.py         # 图像生成任务
│   ├── omni_image.py               # Omni-Image 任务
│   └── face_swap.py                # AI换脸任务
│
└── celery_config.py                # Celery 配置
    └── include = [                 # 任务注册列表
        "app.tasks.lip_sync",
        "app.tasks.text_to_video",
        "app.tasks.image_to_video",
        "app.tasks.multi_image_to_video",
        "app.tasks.motion_control",
        "app.tasks.video_extend",
        "app.tasks.image_generation",
        "app.tasks.omni_image",
        "app.tasks.face_swap",
        ...
    ]
```

---

## 🔌 API 接口参考

### 通用响应格式

**创建任务成功:**
```json
{
  "success": true,
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending"
}
```

**查询任务状态:**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "task_type": "lip_sync",
  "status": "completed",
  "progress": 100,
  "status_message": "任务完成",
  "output_url": "https://xxx.supabase.co/storage/v1/object/public/assets/...",
  "output_asset_id": "uuid",
  "result_metadata": { ... },
  "created_at": "2026-01-23T10:00:00Z",
  "started_at": "2026-01-23T10:00:05Z",
  "completed_at": "2026-01-23T10:05:00Z"
}
```

### 视频生成接口

#### 1. 口型同步 (Lip Sync)

```http
POST /api/kling/lip-sync
Content-Type: application/json

{
  "video_url": "https://example.com/video.mp4",
  "audio_url": "https://example.com/audio.mp3",
  "face_index": 0,
  "sound_volume": 1.0,
  "original_audio_volume": 1.0
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| video_url | string | ✅ | 原视频 URL |
| audio_url | string | ✅ | 音频 URL |
| face_index | int | ❌ | 人脸索引，默认 0 |
| sound_volume | float | ❌ | 驱动音量 (0-1)，默认 1.0 |
| original_audio_volume | float | ❌ | 原音量 (0-1)，默认 1.0 |

#### 2. 文生视频 (Text-to-Video)

```http
POST /api/kling/text-to-video
Content-Type: application/json

{
  "prompt": "一个年轻女性在办公室微笑着介绍产品",
  "negative_prompt": "模糊, 低质量",
  "model_name": "kling-v1-6",
  "duration": "5",
  "aspect_ratio": "16:9",
  "cfg_scale": 0.5
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| prompt | string | ✅ | 视频描述 |
| negative_prompt | string | ❌ | 负面提示词 |
| model_name | string | ❌ | 模型名，默认 kling-v1-6 |
| duration | string | ❌ | 时长 "5" 或 "10"，默认 "5" |
| aspect_ratio | string | ❌ | 宽高比，默认 "16:9" |
| cfg_scale | float | ❌ | CFG 强度 (0-1)，默认 0.5 |

#### 3. 图生视频 (Image-to-Video)

```http
POST /api/kling/image-to-video
Content-Type: application/json

{
  "image": "https://example.com/product.jpg",
  "prompt": "缓慢旋转展示产品细节",
  "model_name": "kling-v1",
  "duration": "5",
  "cfg_scale": 0.5
}
```

#### 4. 多图生视频 (Multi-Image-to-Video)

```http
POST /api/kling/multi-image-to-video
Content-Type: application/json

{
  "images": [
    "https://example.com/scene1.jpg",
    "https://example.com/scene2.jpg",
    "https://example.com/scene3.jpg"
  ],
  "prompt": "场景平滑过渡",
  "model_name": "kling-v1-5",
  "duration": "5"
}
```

#### 5. 动作控制 (Motion Control)

```http
POST /api/kling/motion-control
Content-Type: application/json

{
  "image": "https://example.com/avatar.jpg",
  "video_url": "https://example.com/motion_ref.mp4",
  "prompt": "保持表情自然",
  "mode": "pro",
  "duration": "5"
}
```

#### 6. 视频延长 (Video Extend)

```http
POST /api/kling/video-extend
Content-Type: application/json

{
  "video_id": "kling-generated-video-id",
  "prompt": "继续当前动作",
  "extend_direction": "end",
  "cfg_scale": 0.5
}
```

### 图像生成接口

#### 7. 图像生成 (Image Generation)

```http
POST /api/kling/image-generation
Content-Type: application/json

{
  "prompt": "专业的产品展示背景，简约风格",
  "negative_prompt": "杂乱, 文字",
  "model_name": "kling-v2-1",
  "resolution": "2k",
  "n": 4,
  "aspect_ratio": "16:9"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| prompt | string | ✅ | 图像描述 |
| negative_prompt | string | ❌ | 负面提示词 |
| model_name | string | ❌ | 模型名，默认 kling-v2-1 |
| resolution | string | ❌ | 分辨率 "1k"/"1.5k"/"2k"，默认 "2k" |
| n | int | ❌ | 生成数量 (1-9)，默认 1 |
| aspect_ratio | string | ❌ | 宽高比，默认 "1:1" |
| image | string | ❌ | 参考图 URL (图生图模式) |

#### 8. Omni-Image (多模态图像)

```http
POST /api/kling/omni-image
Content-Type: application/json

{
  "prompt": "将 <<<image_1>>> 中的人物放到 <<<image_2>>> 的场景中",
  "image_list": [
    {"image": "https://example.com/person.jpg"},
    {"image": "https://example.com/background.jpg"}
  ],
  "model_name": "kling-image-o1",
  "resolution": "2k",
  "n": 1,
  "aspect_ratio": "auto"
}
```

### 任务管理接口

```http
# 查询单个任务状态
GET /api/kling/ai-task/{task_id}

# 获取任务列表（支持分页和筛选）
GET /api/kling/ai-tasks?status=completed&task_type=lip_sync&page=1&page_size=20

# 取消任务
POST /api/kling/ai-task/{task_id}/cancel

# 获取能力列表
GET /api/kling/capabilities
```

---

## 💻 使用示例

### Python 调用示例

```python
import requests
import time

BASE_URL = "http://localhost:8000/api/kling"

# 1. 创建口型同步任务
response = requests.post(f"{BASE_URL}/lip-sync", json={
    "video_url": "https://example.com/video.mp4",
    "audio_url": "https://example.com/audio.mp3",
    "face_index": 0
})
data = response.json()
task_id = data["task_id"]
print(f"✅ 任务创建成功: {task_id}")

# 2. 轮询任务状态
while True:
    status_res = requests.get(f"{BASE_URL}/ai-task/{task_id}")
    status = status_res.json()
    
    print(f"📊 进度: {status['progress']}% - {status.get('status_message', '')}")
    
    if status["status"] == "completed":
        print(f"🎉 完成! 输出: {status['output_url']}")
        break
    elif status["status"] == "failed":
        print(f"❌ 失败: {status.get('error_message', '未知错误')}")
        break
    
    time.sleep(5)
```

### 前端 TypeScript 示例

```typescript
// types/kling.ts
export interface AITask {
  task_id: string;
  task_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  status_message?: string;
  output_url?: string;
  output_asset_id?: string;
  error_message?: string;
  created_at: string;
  completed_at?: string;
}

// lib/kling-api.ts
const API_BASE = '/api/kling';

export async function createLipSync(params: {
  video_url: string;
  audio_url: string;
  face_index?: number;
}) {
  const res = await fetch(`${API_BASE}/lip-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function getTaskStatus(taskId: string): Promise<AITask> {
  const res = await fetch(`${API_BASE}/ai-task/${taskId}`);
  return res.json();
}

// hooks/useAITask.ts
import { useState, useEffect } from 'react';

export function useAITask(taskId: string | null) {
  const [task, setTask] = useState<AITask | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    setIsPolling(true);

    const poll = async () => {
      try {
        const status = await getTaskStatus(taskId);
        setTask(status);
        
        if (status.status === 'pending' || status.status === 'processing') {
          setTimeout(poll, 3000); // 3秒轮询
        } else {
          setIsPolling(false);
        }
      } catch (error) {
        console.error('轮询失败:', error);
        setIsPolling(false);
      }
    };

    poll();
  }, [taskId]);

  return { task, isPolling };
}
```

---

## ⚙️ 配置说明

### 环境变量 (.env)

```bash
# ============ 可灵 AI 配置 ============
KLING_API_KEY=AhEmA4GMDrhGEfNGkDRhYyT38C3JTLHe
KLING_API_SECRET=PEJPHdf99QkKENhkmkEnrEpRLPb33Ean
KLING_API_BASE_URL=https://api-beijing.klingai.com/v1

# ============ Redis (Celery Broker) ============
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379

# ============ Supabase ============
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
```

### Celery Worker 启动

```bash
cd backend
source .venv/bin/activate

# 加载环境变量
export $(grep -v '^#' .env | xargs)

# 启动 Worker
celery -A app.celery_config worker --loglevel=info

# 或使用 start-celery.sh 脚本
./start-celery.sh
```

### 数据库表结构

```sql
-- ai_tasks 表
CREATE TABLE ai_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_type VARCHAR(50) NOT NULL,
  source VARCHAR(50) DEFAULT 'rabbit_hole',
  provider VARCHAR(50) DEFAULT 'kling',
  status VARCHAR(20) DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  status_message TEXT,
  input_params JSONB,
  output_url TEXT,
  output_asset_id UUID,
  result_metadata JSONB,
  provider_task_id VARCHAR(100),
  error_code VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_ai_tasks_user_status ON ai_tasks(user_id, status);
CREATE INDEX idx_ai_tasks_type ON ai_tasks(task_type);
CREATE INDEX idx_ai_tasks_created ON ai_tasks(created_at DESC);
```

---

## 📦 模型支持

### 视频生成模型

| 模型 | 文生视频 | 图生视频 | 多图生视频 | 说明 |
|------|:--------:|:--------:|:----------:|------|
| `kling-v1` | ✅ | ✅ | ❌ | 基础版 |
| `kling-v1-5` | ✅ | ✅ | ✅ | 增强版，支持多图 |
| `kling-v1-6` | ✅ | ✅ | ✅ | **推荐**，最新版 |

### 图像生成模型

| 模型 | 文生图 | 图生图 | 特点 |
|------|:------:|:------:|------|
| `kling-v1` | ✅ | ✅ | 基础版 |
| `kling-v1-5` | ✅ | ✅ | 支持 face 参考 |
| `kling-v2` | ✅ | ✅ | 高质量 |
| `kling-v2-new` | ✅ | ✅ | 新版优化 |
| `kling-v2-1` | ✅ | ✅ | **推荐**，最新版 |
| `kling-image-o1` | ✅ | ✅ | Omni 多模态 |

---

## 🚨 错误处理

### 常见错误码

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| 1001 | 参数错误 | 检查请求参数格式 |
| 1002 | 认证失败 | 检查 API Key/Secret |
| 1003 | 配额不足 | 检查账户余额或额度 |
| 1004 | 内容审核失败 | 修改提示词内容 |
| 5001 | 服务器错误 | 稍后重试 |

### Celery 任务重试配置

```python
@celery_app.task(
    autoretry_for=(Exception,),
    retry_backoff=True,           # 指数退避
    retry_backoff_max=600,        # 最大 10 分钟
    retry_kwargs={"max_retries": 3},
)
def process_task(...):
    ...
```

---

## 🗺️ 后续规划

- [ ] WebSocket 实时进度推送
- [ ] 批量任务优化
- [ ] 结果缓存（相同输入不重复生成）
- [ ] 音频生成 (TTS) 功能
- [ ] 虚拟试穿功能
- [ ] 前端 AI 工作流组件

---

## 📚 参考文档

- [可灵 AI 官网](https://klingai.com/)
- [可灵 AI 开发者平台](https://platform.klingai.com/)
- [API 北京节点](https://api-beijing.klingai.com/v1)
