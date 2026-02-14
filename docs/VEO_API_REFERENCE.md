# Veo 3.1 & SeedDance 2.0 API 参考

> **来源**：Google Cloud Vertex AI - Generative AI
>
> **更新日期**：2026年2月13日
>
> **相关文档**：[KLING_API_REFERENCE.md](KLING_API_REFERENCE.md) | [AI_CAPABILITIES.md](AI_CAPABILITIES.md)

---

## 一、Veo 视频生成 API

### 1.1 Veo 简介

**Veo** 是 Google Cloud 推出的高品质视频生成模型，可创作各种主题和风格的超高品质视频，并能更好地理解真实世界的物理现象以及人类动作和表情的细微之处。

### 1.2 模型版本对比

| 模型 | 特点 | 适用场景 |
|------|------|----------|
| **Veo 3.1** | 最新版本，支持高达 4K 分辨率，支持视频+音频同步生成 | 高质量视频制作 |
| **Veo 3.1 Fast** | 快速生成版本，保持高质量但速度更快 | 快速原型和迭代 |
| **Veo 3** | 上一代版本，最高支持 1080p | 标准视频生成 |
| **Veo 3 Fast** | 上一代快速版本 | 标准快速生成 |
| **Veo 2** | 旧版本，支持高级控制功能 | 特殊控制需求 |

### 1.3 核心能力

| 能力 | 输入 | 输出 | 说明 |
|------|------|------|------|
| 文生视频（Text-to-Video） | 文本提示词 | 视频 | 根据文本描述生成视频 |
| 图生视频（Image-to-Video） | 参考图片 + 文本提示词 | 视频 | 基于图片生成视频 |
| 视频+音频生成 | 文本/图片提示词 | 视频 + 音频 | 同步生成画面和声音/音效 |
| 视频延长（Extend） | 已生成视频 + 提示词 | 延长视频 | 扩展视频时长 |
| 高级控制 | 开始帧/结束帧 + 提示词 | 视频 | 通过关键帧插值生成 |

### 1.4 价格表（Veo 3.1）

#### Veo 3.1 标准版

| 功能 | 输入 | 输出 | 分辨率 | 价格 |
|------|------|------|--------|------|
| 生成视频 + 音频 | 文本/图片提示词 | 视频 + 音频 | 720p, 1080p | **$0.40/秒** |
| 生成视频 + 音频 | 文本/图片提示词 | 视频 + 音频 | 4K | **$0.60/秒** |
| 视频生成（无音频） | 文本/图片提示词 | 视频 | 720p, 1080p | **$0.20/秒** |
| 视频生成（无音频） | 文本/图片提示词 | 视频 | 4K | **$0.40/秒** |

#### Veo 3.1 Fast 快速版

| 功能 | 输入 | 输出 | 分辨率 | 价格 |
|------|------|------|--------|------|
| 生成视频 + 音频 | 文本/图片提示词 | 视频 + 音频 | 720p, 1080p | **$0.15/秒** |
| 生成视频 + 音频 | 文本/图片提示词 | 视频 + 音频 | 4K | **$0.35/秒** |
| 视频生成（无音频） | 文本/图片提示词 | 视频 | 720p, 1080p | **$0.10/秒** |
| 视频生成（无音频） | 文本/图片提示词 | 视频 | 4K | **$0.30/秒** |

### 1.5 API 端点

```
# Vertex AI 端点
https://[LOCATION]-aiplatform.googleapis.com/v1/projects/[PROJECT_ID]/locations/[LOCATION]/publishers/google/models/veo-3.1:predict
```

### 1.6 请求示例（推测）

```python
# Python SDK 示例
from google.cloud import aiplatform

# 初始化客户端
aiplatform.init(project='your-project-id', location='us-central1')

# 文生视频
def generate_video_from_text(prompt: str, duration: int, resolution: str = "1080p"):
    """
    生成视频从文本
    
    Args:
        prompt: 视频描述提示词
        duration: 视频时长（秒）
        resolution: 分辨率（"720p", "1080p", "4K"）
    """
    endpoint = aiplatform.Endpoint('veo-3.1')
    
    request = {
        "instances": [{
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "generate_audio": True,  # 是否生成音频
            "aspect_ratio": "16:9",   # 视频比例
        }]
    }
    
    response = endpoint.predict(request)
    return response

# 图生视频
def generate_video_from_image(image_url: str, prompt: str, duration: int):
    """
    从图片生成视频
    
    Args:
        image_url: 参考图片URL
        prompt: 运动描述提示词
        duration: 视频时长（秒）
    """
    endpoint = aiplatform.Endpoint('veo-3.1')
    
    request = {
        "instances": [{
            "image": {
                "gcsUri": image_url  # 或 "bytesBase64Encoded"
            },
            "prompt": prompt,
            "duration": duration,
            "generate_audio": True
        }]
    }
    
    response = endpoint.predict(request)
    return response
```

### 1.7 参数说明（推测）

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `prompt` | string | ✅ | 文本描述，指导视频生成内容 |
| `image` | object | ❌ | 参考图片（图生视频时需要） |
| `duration` | integer | ✅ | 视频时长（秒），范围：1-10秒 |
| `resolution` | string | ❌ | 分辨率："720p", "1080p", "4K"（默认：1080p） |
| `generate_audio` | boolean | ❌ | 是否生成音频（默认：false） |
| `aspect_ratio` | string | ❌ | 视频比例："16:9", "9:16", "1:1"（默认：16:9） |
| `negative_prompt` | string | ❌ | 负面提示词，指定不希望出现的内容 |
| `seed` | integer | ❌ | 随机种子，用于可复现的生成 |
| `fps` | integer | ❌ | 帧率（默认：24） |

### 1.8 响应格式（推测）

```json
{
  "predictions": [{
    "video_url": "gs://bucket/path/to/video.mp4",
    "audio_url": "gs://bucket/path/to/audio.mp3",
    "duration": 5,
    "resolution": "1080p",
    "fps": 24,
    "file_size_bytes": 15728640,
    "generation_time_ms": 45000
  }],
  "metadata": {
    "task_id": "veo-task-12345",
    "model_version": "veo-3.1"
  }
}
```

---

## 二、SeedDance 2.0 API (未在 Vertex AI 中发现)

**注意**：在 Google Cloud Vertex AI 文档中，并未找到名为 "SeedDance 2.0" 的模型或 API。

可能的情况：
1. **SeedDance** 可能是其他厂商（如字节跳动、快手等）的模型
2. 或者是 Google Imagen 系列的别名或内部代号

### 2.1 Google Imagen 系列（图片生成）

如果您需要的是图片生成能力，Google 提供 **Imagen** 系列模型：

| 模型 | 功能 | 价格 |
|------|------|------|
| **Imagen 4 Ultra** | 超高质量图片生成 | $0.06/张 |
| **Imagen 4** | 高质量图片生成 + 提升（2K/3K/4K） | $0.04/张（生成） + $0.06/张（提升） |
| **Imagen 4 Fast** | 快速图片生成 | $0.02/张 |
| **Imagen 3** | 图片生成、修改、自定义 | $0.04/张 |
| **Imagen 3 Fast** | 快速图片生成 | $0.02/张 |

### 2.2 Imagen 核心功能

| 功能 | 说明 | API 方法 |
|------|------|----------|
| 图片生成 | 根据文本提示生成图片 | `generate` |
| 图片修改 | 使用蒙版或无蒙版修改图片 | `edit` |
| 自定义图片 | 基于主题训练后生成 | `custom` |
| 分辨率提升 | 将图片提升至 2K/3K/4K | `upscale` |
| 产品场景重构 | 在新场景中重新构想产品 | `product_recontext` |
| 虚拟试穿 | 生成人物穿不同服装的图片 | `virtual_tryon` |
| 视觉标注 | 为图片生成文字描述 | `caption` |
| 视觉问答 | 根据图片回答问题 | `vqa` |

---

## 三、集成到 Rabbit Hole 系统

### 3.1 Veo vs Kling 对比

| 维度 | Veo 3.1 | Kling AI |
|------|---------|----------|
| **提供商** | Google Cloud | 快影 AI |
| **认证方式** | Google Cloud IAM | Access Key + Secret Key |
| **价格（1080p）** | $0.20/秒（无音频） | 价格未公开 |
| **价格（4K）** | $0.40/秒（无音频） | - |
| **音频生成** | ✅ 支持同步生成 | ❌ 不支持 |
| **分辨率** | 720p, 1080p, 4K | 720p, 1080p |
| **时长** | 1-10秒 | 5-10秒 |
| **延长功能** | ✅ | ✅ |
| **高级控制** | ✅ 关键帧插值 | ✅ 运动控制 |

### 3.2 架构建议

```python
# backend/app/services/video_generation_service.py
from enum import Enum

class VideoProvider(Enum):
    KLING = "kling"
    VEO = "veo"

class VideoGenerationService:
    """
    统一视频生成服务
    支持多个 AI 提供商
    """
    
    def __init__(self, provider: VideoProvider = VideoProvider.KLING):
        self.provider = provider
        if provider == VideoProvider.KLING:
            self.client = KlingAIClient()
        elif provider == VideoProvider.VEO:
            self.client = VeoAIClient()
    
    async def generate_video(
        self,
        prompt: str,
        duration: int,
        image_url: Optional[str] = None,
        resolution: str = "1080p",
        with_audio: bool = False
    ) -> Task:
        """
        通用视频生成接口
        自动路由到合适的提供商
        """
        
        # 根据需求选择提供商
        if with_audio and self.provider == VideoProvider.KLING:
            # Kling 不支持音频，切换到 Veo
            logger.info("Switching to Veo for audio generation")
            client = VeoAIClient()
        else:
            client = self.client
        
        return await client.create_video(
            prompt=prompt,
            duration=duration,
            image_url=image_url,
            resolution=resolution,
            with_audio=with_audio
        )
```

### 3.3 成本优化策略

```python
# 根据需求智能选择提供商
def select_optimal_provider(
    resolution: str,
    duration: int,
    with_audio: bool,
    budget: float
) -> VideoProvider:
    """
    根据需求和预算选择最优提供商
    """
    
    # Veo 价格计算（每秒）
    veo_cost_per_sec = {
        "720p": 0.10 if with_audio else 0.10,
        "1080p": 0.15 if with_audio else 0.10,
        "4K": 0.35 if with_audio else 0.30
    }
    
    veo_total = veo_cost_per_sec.get(resolution, 0.15) * duration
    
    # Kling 价格（假设）
    kling_total = 0.08 * duration  # 假设 Kling 更便宜但无音频
    
    # 决策逻辑
    if with_audio:
        return VideoProvider.VEO  # Kling 不支持音频
    elif resolution == "4K":
        return VideoProvider.VEO  # 只有 Veo 支持 4K
    elif budget < veo_total:
        return VideoProvider.KLING  # 预算优先
    else:
        return VideoProvider.VEO  # 质量优先
```

### 3.4 数据库扩展

```sql
-- 扩展 ai_tasks 表以支持多提供商
ALTER TABLE ai_tasks 
ADD COLUMN provider VARCHAR(20) DEFAULT 'kling';

-- 添加索引
CREATE INDEX idx_ai_tasks_provider ON ai_tasks(provider);

-- 更新现有记录
UPDATE ai_tasks SET provider = 'kling' WHERE provider IS NULL;
```

---

## 四、最佳实践

### 4.1 提示词优化

#### Veo 提示词示例

```python
# 好的提示词（详细、具体）
good_prompt = """
A cinematic shot of a young woman in a flowing red dress walking through 
a sunlit meadow filled with wildflowers. The camera slowly tracks her 
movement from behind, capturing the dress billowing in the gentle breeze. 
Golden hour lighting, shallow depth of field, film grain aesthetic.
"""

# 差的提示词（模糊、笼统）
bad_prompt = "A woman walking in a field"
```

#### 提示词最佳实践

1. **详细描述场景**：环境、光线、氛围
2. **指定运动类型**：慢动作、快速、平稳
3. **明确镜头语言**：特写、广角、跟踪拍摄
4. **风格指引**：电影感、动画风格、写实
5. **技术参数**：景深、颗粒感、色调

### 4.2 分辨率选择策略

```python
def choose_resolution(use_case: str) -> str:
    """
    根据使用场景选择分辨率
    """
    resolution_map = {
        "social_media_portrait": "9:16|1080p",  # 竖屏社交媒体
        "social_media_landscape": "16:9|720p",   # 横屏社交媒体
        "product_demo": "16:9|1080p",            # 产品展示
        "high_end_commercial": "16:9|4K",        # 高端商业广告
        "quick_preview": "16:9|720p",            # 快速预览
    }
    return resolution_map.get(use_case, "16:9|1080p")
```

### 4.3 异步处理流程

```python
# 视频生成通常需要较长时间
@celery.task(queue='gpu', time_limit=600)
async def process_veo_generation(task_id: str, params: dict):
    """
    异步处理 Veo 视频生成
    """
    try:
        # 1. 更新状态为处理中
        await update_task_status(task_id, 'processing', 0.1)
        
        # 2. 调用 Veo API
        veo_client = VeoAIClient()
        result = await veo_client.generate_video(**params)
        
        # 3. 轮询检查生成状态
        while result.status != 'completed':
            await asyncio.sleep(5)
            result = await veo_client.get_task_status(result.task_id)
            progress = min(0.9, result.progress)
            await update_task_status(task_id, 'processing', progress)
        
        # 4. 下载并保存结果
        video_url = await download_and_save(result.video_url)
        await update_task_status(task_id, 'completed', 1.0, result_url=video_url)
        
        return {"status": "success", "video_url": video_url}
        
    except Exception as e:
        await update_task_status(task_id, 'failed', 0, error=str(e))
        raise
```

---

## 五、API 认证与配置

### 5.1 环境变量

```bash
# Google Cloud 认证
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# 或使用 API Key（推荐用于开发）
GOOGLE_CLOUD_API_KEY=your-api-key
```

### 5.2 Python 客户端初始化

```python
from google.cloud import aiplatform
from google.oauth2 import service_account

class VeoAIClient:
    def __init__(self):
        # 方式 1：使用服务账号
        credentials = service_account.Credentials.from_service_account_file(
            os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
        )
        
        aiplatform.init(
            project=os.getenv('GOOGLE_CLOUD_PROJECT_ID'),
            location=os.getenv('GOOGLE_CLOUD_LOCATION', 'us-central1'),
            credentials=credentials
        )
        
    async def create_video(
        self,
        prompt: str,
        duration: int,
        **kwargs
    ) -> dict:
        """创建视频生成任务"""
        # 实现细节...
        pass
```

---

## 六、参考链接

- [Vertex AI Generative AI 价格](https://cloud.google.com/vertex-ai/generative-ai/pricing?hl=zh-cn#veo)
- [Vertex AI 文档](https://cloud.google.com/vertex-ai/docs)
- [Google Cloud Python SDK](https://github.com/googleapis/python-aiplatform)

---

## 七、注意事项

1. **SeedDance 2.0 未找到**：在 Google Cloud 文档中未找到此模型，可能需要确认是否为其他平台的模型
2. **价格以美元计**：所有价格均为美元，需根据汇率换算
3. **按秒计费**：Veo 按生成视频的秒数计费，而非按请求次数
4. **异步生成**：视频生成通常需要数十秒到数分钟，需要异步处理
5. **配额限制**：需要向 Google Cloud 申请足够的 API 配额

---

## 八、更新日志

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2026-02-13 | v1.0 | 初始版本，基于 Google Cloud 价格页面整理 |
