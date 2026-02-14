# AI 能力与视觉处理系统

> **合并自**：AI_CAPABILITY_SYSTEM / AI_VISUAL_SYSTEM
>
> 覆盖：AI 能力矩阵 → Kling / Doubao 集成 → Clip 导出 → 分镜策略 → 背景替换 → Inpainting → 增强生成
>
> API 端点参考：[KLING_API_REFERENCE.md](KLING_API_REFERENCE.md) | [DOUBAO_IMAGE_API_REFERENCE.md](DOUBAO_IMAGE_API_REFERENCE.md)

---

## 一、AI 能力矩阵

| 能力 | API | 主要用途 | 分类 |
|------|-----|----------|------|
| 口型同步 | Kling `/lipsync/create` | 数字人视频 | repair |
| 文生视频 | Kling `/video/text2video` | 场景生成 | dynamic |
| 图生视频 | Kling `/video/image2video` | 产品图动态化 | dynamic |
| 多图生视频 | Kling `/video/multi-image2video` | 转场生成 | dynamic |
| 动作控制 | Kling `/video/motion-control` | 运动引导 | dynamic |
| 视频延长 | Kling `/video/extend` | 时长扩展 | dynamic |
| 图像编辑 | Kling `/omni-image` | 背景替换 / Inpainting | structure |
| AI 换脸 | Kling `/omni-image` (face reference) | 内容复用（图→图，可选联动 image2video） | structure |
| 图像生成 | Kling `/image/generate` | AI 作图 | style |
| 🆕 文生图 | Doubao Seedream `/images/generations` | 高质量 2K 图像生成 | style |
| 🆕 图生图 | Doubao Seedream `/images/generations` + image | 参考图编辑/变换 | style |
| 🆕 多图参考生图 | Doubao Seedream `/images/generations` + image[] | 多图融合（如换装） | style |
| 🆕 连贯序列生图 | Doubao Seedream `/images/generations` + sequential | 一组风格统一的连贯图 | style |

新增 Enhance & Style 能力（详见 [AI_ENHANCE_STYLE_CAPABILITIES_PRD.md](AI_ENHANCE_STYLE_CAPABILITIES_PRD.md)）：
- 🆕 皮肤美化 (skin_enhance)
- 🆕 AI 打光 (relight)
- 🆕 换装试穿 (outfit_swap)
- 🆕 AI 穿搭师 (ai_stylist)
- 🆕 AI 穿搭内容 (outfit_shot)

---

## 二、Rabbit Hole 产品定位

**Rabbit Hole** 是 Lepus AI 的 AI 创作工具集：

```
┌─────────────────────────────────────────────────────────────────────┐
│   🎭 数字人视频      一段音频 → 多个形象 → 批量视频内容              │
│   🖼️ 产品动态化     静态产品图 → 动态展示视频 → 带货素材            │
│   🔄 内容复用       一条视频 → 换脸/换背景 → 多版本分发              │
│   ✂️ 无缝剪辑       AI生成 → 素材库 → 编辑器 → 精细调整              │
└─────────────────────────────────────────────────────────────────────┘
```

用户旅程：
```
Workspace 工作台 → Rabbit Hole AI创作 → Visual Editor 精调
                        │
                   ┌────┴────┐
                   ▼         ▼
              AI 创作工具  我的素材(Assets)
```

---

## 三-A、Kling AI 集成

### 3.1 认证

```bash
KLING_AI_ACCESS_KEY=your-access-key
KLING_AI_SECRET_KEY=your-secret-key
```

### 3.2 后端服务

```python
# backend/app/services/kling_ai_client.py
class KlingAIClient:
    async def create_lipsync(self, audio_url, avatar_url) -> Task
    async def create_text2video(self, prompt, duration) -> Task
    async def create_image2video(self, image_url, prompt) -> Task
    async def create_multi_image2video(self, images, prompt) -> Task
    async def edit_image(self, image_url, mask_url, prompt) -> Task
    async def get_task_status(self, task_id) -> TaskStatus
```

---

## 三-B、Doubao Seedream 4.0 集成

> 详细参数与用法见 [DOUBAO_IMAGE_API_REFERENCE.md](DOUBAO_IMAGE_API_REFERENCE.md)

### 认证

```bash
VOLCENGINE_ARK_API_KEY=your-ark-api-key  # 火山方舟 API Key（与 LLM 共用）
```

### 后端服务（待实现）

```python
# backend/app/services/doubao_image_service.py
class DoubaoImageService:
    async def generate_image(
        self,
        prompt: str,
        *,
        image: str | list[str] | None = None,  # 参考图
        sequential: bool = False,               # 是否连贯序列
        max_images: int = 1,                     # 最多张数
    ) -> dict
```

### 六种模式速查

| 模式 | image 参数 | sequential | 输出 |
|------|-----------|------------|------|
| 文生图 | — | disabled | 单张 |
| 文生一组图 | — | auto | 多张连贯 |
| 单图生单图 | `"url"` | disabled | 单张 |
| 单图生一组图 | `"url"` | auto | 多张连贯 |
| 多图参考生单图 | `["url1", "url2"]` | disabled | 单张 |
| 多图参考生一组图 | `["url1", "url2"]` | auto | 多张连贯 |

### 与 Kling 图像生成的差异

| 维度 | Doubao Seedream | Kling Image |
|------|----------------|-------------|
| 响应模式 | 同步 / SSE 流式 | 异步轮询 |
| 多图参考 | ✅ 原生支持 | ✅ image_list |
| 连贯序列 | ✅ sequential_image_generation | ❌ |
| 分辨率 | 2K | 1024×1024 |
| 鉴权 | Bearer Token | JWT HMAC-SHA256 |

---

## 四、Clip 视频导出

### 4.1 核心约束

```
最终视频 = AI 生成的画面 + 原 Clip 的音频
时长: 必须相等到毫秒级
```

### 4.2 导出流程

```
/api/clips/{clip_id}/export → ClipExportService → Storage
  - 片段裁剪 (FFmpeg)
  - 格式转换 (HLS → MP4)
  - 公网 URL 生成
```

### 4.3 存储

| 位置 | 格式 | 前端播放 | AI 模型输入 |
|------|------|---------|------------|
| Cloudflare Stream | HLS | ✅ | ❌ |
| Supabase Storage | MP4 | ✅ | ✅ |

---

## 五、分镜策略

### 5.1 三种模式

| 策略 | 说明 | 适用场景 | 分镜数 |
|------|------|----------|--------|
| 场景分镜 | 基于视觉变化检测 | 多镜头素材 | 3-10 |
| 分句分镜 | 基于 ASR 断句 | 语音清晰 | 10-30 |
| 段落分镜 | 基于语义分析 | 有章节结构 | 5-15 |

### 5.2 实现

```python
from scenedetect import detect, AdaptiveDetector, ContentDetector
# ContentDetector — 硬切检测
# AdaptiveDetector — 自适应（快速镜头）
# ThresholdDetector — 淡入淡出
```

### 5.3 数据流

```
Asset → Shot Segmentation Agent → Shots 数据 → Visual Editor
```

---

## 六、背景替换与 Inpainting

### 6.1 工作流

| 状态 | 说明 |
|------|------|
| 未分析 | 显示「开始 AI 分析」按钮 |
| 分析中 | 进度条，识别分镜、检测人物 |
| 分析完成 | 展示分镜列表，逐镜定制背景 |

### 6.2 Inpainting 架构

```
DrawingCanvas (mask 绘制) → POST /api/ai-capabilities/preview → Kling omni-image
                         ← PreviewDialog 预览结果
                         → POST /api/ai-capabilities/tasks/{id}/apply → 确认应用
```

功能支持：
- **局部替换**：绘制 mask → 替换指定区域
- **风格迁移**：无 mask 时整体风格变换
- **两步工作流**：先预览 → 确认后应用

### 6.3 细粒度优化

```
Step 1: 分离人物与背景（抠图 + 去人）
Step 2: 单独优化背景（prompt 生成新背景）
Step 3: 合成最终图
```

详细 Pipeline 设计见 [BACKGROUND_REPLACE_AGENT_WORKFLOW.md](BACKGROUND_REPLACE_AGENT_WORKFLOW.md)。

---

## 七、增强生成（迭代式）

### 7.1 支持的操作

| 操作 | 说明 |
|------|------|
| 重新生成 | 同参数换随机种子 |
| 相似生成 | 基于上一次结果 variation |
| 修改 prompt | 调整描述后重新生成 |
| 修改 mask | 重新涂抹修改区域 |
| 历史版本 | 对比多版本，选择最满意的 |

---

## 八、Celery 异步任务

```python
@celery.task(queue='gpu')
def process_ai_generation(task_id, capability_type, params):
    """GPU 密集型 AI 生成任务"""

@celery.task(queue='cpu')
def process_video_export(clip_id, format):
    """CPU 密集型视频处理"""
```

WebSocket 进度推送：
```json
{ "type": "task_progress", "task_id": "xxx", "progress": 0.6, "status": "processing" }
```

---

## 九、数据模型

### Shot（分镜）

```typescript
interface Shot {
  id: string;
  startTime: number;
  endTime: number;
  keyframeUrl: string;
  backgroundConfig?: {
    type: 'original' | 'custom';
    prompt?: string;
    generatedUrl?: string;
  };
}
```

### AITask

```typescript
interface AITask {
  id: string;
  capability_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  prompt: string;
  keyframe_url: string;
  mask_data_url?: string;
  result_url?: string;
  history: TaskVersion[];
}
```

---

## 十、详细实现参考

完整设计文档请查看归档：
- [KLING_AI_API.md](archive/KLING_AI_API.md)
- [KLING_AI_INTEGRATION.md](archive/KLING_AI_INTEGRATION.md)
- [CLIP_VIDEO_EXPORT_ARCHITECTURE.md](archive/CLIP_VIDEO_EXPORT_ARCHITECTURE.md)
- [RABBIT_HOLE_AI_DESIGN.md](archive/RABBIT_HOLE_AI_DESIGN.md)
- [AI_VISUAL_STUDIO_DESIGN.md](archive/AI_VISUAL_STUDIO_DESIGN.md)
- [SHOT_SEGMENTATION_DESIGN.md](archive/SHOT_SEGMENTATION_DESIGN.md)
- [ENHANCEMENT_FEATURE_DESIGN.md](archive/ENHANCEMENT_FEATURE_DESIGN.md)
- [IMAGE_EDITING_INPAINTING.md](archive/IMAGE_EDITING_INPAINTING.md)
