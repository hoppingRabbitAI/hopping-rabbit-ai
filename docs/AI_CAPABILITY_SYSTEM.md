# AI 能力集成系统

> 合并自：KLING_AI_API / KLING_AI_INTEGRATION / CLIP_VIDEO_EXPORT_ARCHITECTURE / RABBIT_HOLE_AI_DESIGN
> 
> 本文档涵盖可灵 AI 集成、Clip 导出架构、Rabbit Hole 创作工具集。

---

## 1. 系统概览

### 1.1 AI 能力矩阵

| 能力 | API | 主要用途 |
|------|-----|----------|
| 口型同步 (Lip Sync) | Kling `/lipsync/create` | 数字人口播 |
| 文生视频 | Kling `/video/text2video` | 场景生成 |
| 图生视频 | Kling `/video/image2video` | 产品图动态化 |
| 图像编辑 | Kling `/omni-image` | 背景替换、Inpainting |
| AI 换脸 | Kling `/face-swap` | 内容复用 |

### 1.2 Rabbit Hole 产品定位

**Rabbit Hole** 是 HoppingRabbit AI 的 AI 创作工具集，专为**口播用户**打造：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户价值主张                                  │
├─────────────────────────────────────────────────────────────────────┤
│   🎭 数字人口播      一段音频 → 多个数字人形象 → 批量口播视频        │
│   🖼️ 产品动态化     静态产品图 → 动态展示视频 → 带货素材            │
│   🔄 内容复用       一条口播 → 换脸/换背景 → 多版本分发              │
│   ✂️ 无缝剪辑       AI生成 → 素材库 → 编辑器 → 精细调整              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 可灵 AI 集成

### 2.1 认证配置

```bash
# .env
KLING_AI_ACCESS_KEY=your-access-key
KLING_AI_SECRET_KEY=your-secret-key
```

### 2.2 API 端点

| 功能 | 端点 | 说明 |
|------|------|------|
| 口型同步 | `/lipsync/create` | 音频 + 形象 → 口播视频 |
| 文生视频 | `/video/text2video` | 提示词 → 视频 |
| 图生视频 | `/video/image2video` | 图片 → 动态视频 |
| 图像编辑 | `/omni-image` | 图片编辑（Inpainting） |

### 2.3 后端服务

```python
# backend/app/services/kling_ai_client.py
class KlingAIClient:
    async def create_lipsync(self, audio_url, avatar_url) -> Task
    async def create_text2video(self, prompt, duration) -> Task
    async def create_image2video(self, image_url, prompt) -> Task
    async def edit_image(self, image_url, mask_url, prompt) -> Task
    async def get_task_status(self, task_id) -> TaskStatus
```

---

## 3. Clip 视频导出架构

### 3.1 核心约束

| 约束 | 说明 |
|------|------|
| **时长精确匹配** | AI 生成视频时长必须与原 clip 毫秒级一致 |
| **音频对齐** | 生成的画面必须与原 clip 音频完美对齐 |
| **格式统一** | 默认 MP4 格式 |

**输出公式**：
```
最终视频 = AI 生成的画面 + 原 Clip 的音频
时长: 必须相等到毫秒级
```

### 3.2 导出流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                          API Layer                                   │
│  /api/clips/{clip_id}/export                                        │
│  /api/clips/{clip_id}/ai-enhance                                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ClipExportService                                │
│  - 片段裁剪 (FFmpeg)                                                 │
│  - 格式转换 (HLS → MP4)                                              │
│  - 公网 URL 生成                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Storage Layer                                 │
│  Cloudflare Stream (HLS) ←→ Supabase Storage (MP4)                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 存储对比

| 存储位置 | 格式 | 前端播放 | 后端处理 | AI 模型输入 |
|---------|------|---------|---------|------------|
| Cloudflare Stream | HLS | ✅ HLS.js | ❌ OpenCV 不支持 | ❌ 需要文件 |
| Supabase Storage | MP4 | ✅ 原生 | ✅ 直接读取 | ✅ URL/文件 |

---

## 4. Rabbit Hole 用户旅程

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Workspace   │         │ Rabbit Hole  │         │   Editor     │
│   工作台入口  │ ──────▶ │  AI创作工具集 │ ──────▶ │  视频编辑器  │
└──────────────┘         └──────────────┘         └──────────────┘
                                │                        │
                                ▼                        ▼
                        ┌────────────────┐      ┌────────────────┐
                        │  AI 创作工具   │      │  Clip级AI工具  │
                        │ ─────────────  │      │ ─────────────  │
                        │ • 数字人口播   │      │ • 口型同步     │
                        │ • 图生视频     │      │ • AI换脸       │
                        │ • 文生视频     │      │ • 换背景       │
                        │ • 批量生成     │      │ • 画质增强     │
                        └────────┬───────┘      └────────────────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │   我的素材     │
                        │   (Assets)     │
                        └────────────────┘
```

---

## 5. Celery 异步任务

### 5.1 任务队列

```python
# backend/app/tasks/ai_tasks.py
@celery.task(queue='gpu')
def process_ai_generation(task_id: str, capability_type: str, params: dict):
    """GPU 密集型 AI 生成任务"""
    ...

@celery.task(queue='cpu')
def process_video_export(clip_id: str, format: str):
    """CPU 密集型视频处理任务"""
    ...
```

### 5.2 进度推送

```typescript
// WebSocket 进度更新
{
  type: 'task_progress',
  task_id: 'task-xxx',
  progress: 0.6,
  status: 'processing',
  message: '正在生成视频...'
}
```

---

## 6. 详细实现参考

完整设计文档请查看归档：
- [KLING_AI_API.md](archive/KLING_AI_API.md)
- [KLING_AI_INTEGRATION.md](archive/KLING_AI_INTEGRATION.md)
- [CLIP_VIDEO_EXPORT_ARCHITECTURE.md](archive/CLIP_VIDEO_EXPORT_ARCHITECTURE.md)
- [RABBIT_HOLE_AI_DESIGN.md](archive/RABBIT_HOLE_AI_DESIGN.md)
