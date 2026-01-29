# 可灵AI API 集成文档

本文档详细说明 HoppingRabbit AI 与可灵AI (Kling AI) 的集成方案。

## 1. 概述

可灵AI 提供以下核心能力用于口播视频创作：

| 功能 | 描述 | 主要用途 |
|------|------|----------|
| 口型同步 (Lip Sync) | 让视频中的人物口型匹配新音频 | 数字人口播、配音替换 |
| 文生视频 (Text to Video) | 根据文字描述生成视频 | 背景视频、B-roll 素材 |
| 图生视频 (Image to Video) | 将图片转换为动态视频 | 产品图动态化 |
| 多图生视频 (Multi-Image) | 多张参考图生成视频 | 复杂场景转换 |
| 动作控制 (Motion Control) | 让图片人物执行参考动作 | 动作迁移 |
| 视频延长 (Video Extend) | 延长视频时长 | 素材扩展 |
| 图像生成 (Image Generation) | 文生图/图生图 | 封面、缩略图 |
| Omni-Image (O1) | 高级多模态图像生成 | 复杂图像合成 |

## 2. 认证配置

### 2.1 环境变量

在 `backend/.env` 中配置：

```env
# 可灵 AI 配置
# 推荐使用 AK/SK 方式（更安全）
KLING_ACCESS_KEY=your_access_key
KLING_SECRET_KEY=your_secret_key

# 备用：静态 Token（不推荐）
KLING_AI_API_TOKEN=your_jwt_token

# API 基础 URL（北京节点）
KLING_API_BASE_URL=https://api-beijing.klingai.com
```

### 2.2 JWT 认证

客户端自动使用 AK/SK 生成 JWT Token：

```python
from app.services.kling_client import get_kling_client

client = get_kling_client()
# JWT 会在每次请求时自动生成，有效期 30 分钟
```

---

## 3. API 使用示例

### 3.1 文生视频 (Text to Video)

**Endpoint**: `POST /api/kling/text2video`

**请求体**:
```json
{
  "prompt": "A cinematic shot of a cyberpunk city, night time, rain, neon lights",
  "model_name": "kling-v2-1-master",
  "aspect_ratio": "16:9",
  "duration": "5",
  "cfg_scale": 0.5
}
```

**响应体**:
```json
{
  "task_id": "845014248110960707",
  "message": "任务已创建",
  "status": "pending"
}
```

**运镜控制示例**:
```json
{
  "prompt": "A golden retriever running on the beach",
  "camera_control": {
    "type": "simple",
    "config": {
      "zoom": 0.5,
      "pan": 0.0,
      "tilt": 0.0,
      "roll": 0.0,
      "horizontal": 0.0,
      "vertical": 0.0
    }
  }
}
```

### 3.2 图生视频 (Image to Video)

**Endpoint**: `POST /api/kling/image2video`

**请求体**:
```json
{
  "image": "https://example.com/product.jpg",
  "prompt": "The product rotates slowly",
  "model_name": "kling-v2-5-turbo",
  "duration": "5"
}
```

**首尾帧模式**:
```json
{
  "image": "https://example.com/start_frame.jpg",
  "image_tail": "https://example.com/end_frame.jpg",
  "prompt": "Smooth transition between two scenes"
}
```

### 3.3 口型同步 (Lip Sync)

口型同步分为两步：

**第一步：人脸识别**

**Endpoint**: `POST /api/kling/lipsync/identify-face`

```json
{
  "video_url": "https://example.com/video_with_face.mp4"
}
```

**响应**:
```json
{
  "session_id": "sess_123...",
  "face_data": [
    {
      "face_id": "face_abc...",
      "face_image": "https://...",
      "start_time": 0,
      "end_time": 5200
    }
  ]
}
```

**第二步：创建对口型任务**

**Endpoint**: `POST /api/kling/lipsync`

```json
{
  "video_url": "https://example.com/video.mp4",
  "audio_url": "https://example.com/new_audio.mp3",
  "face_index": 0,
  "sound_volume": 1.0,
  "original_audio_volume": 0.3
}
```

### 3.4 Omni-Image (O1)

**Endpoint**: `POST /api/kling/images/omni`

支持多图引用语法 `<<<image_N>>>`：

```json
{
  "prompt": "让<<<image_1>>>和<<<image_2>>>坐在一起吃火锅",
  "image_list": [
    "https://example.com/person1.jpg",
    "https://example.com/person2.jpg"
  ],
  "aspect_ratio": "auto"
}
```

### 3.5 任务查询

**统一查询接口**: `GET /api/kling/tasks/{category}/{task_type}/{task_id}`

示例：
- 查询文生视频: `GET /api/kling/tasks/videos/text2video/845014248110960707`
- 查询图像生成: `GET /api/kling/tasks/images/generations/task_img_123`
- 查询对口型: `GET /api/kling/tasks/videos/advanced-lip-sync/task_456`

**响应**:
```json
{
  "task_id": "845014248110960707",
  "task_status": "succeed",
  "task_result": {
    "videos": [
      {
        "id": "vid_xxx",
        "url": "https://cdn.klingai.com/...",
        "duration": "5"
      }
    ]
  }
}
```

---

## 4. 回调机制

### 4.1 配置回调 URL

在 `.env` 中设置：

```env
CALLBACK_BASE_URL=https://api.yourdomain.com
```

任务创建时会自动添加回调地址。

### 4.2 回调端点

**Endpoint**: `POST /api/callback/kling`

**回调 Payload**:
```json
{
  "task_id": "task_123456",
  "task_status": "succeed",
  "task_result": {
    "videos": [
      {
        "url": "https://cdn.klingai.com/...",
        "duration": "5"
      }
    ]
  }
}
```

### 4.3 本地调试

使用 ngrok 暴露本地服务：

```bash
# 启动本地服务
uvicorn app.main:app --port 8000

# 启动 ngrok
ngrok http 8000

# 设置回调 URL
export CALLBACK_BASE_URL=https://xxxx.ngrok-free.app
```

---

## 5. Pydantic 模型

所有请求/响应模型定义在 `app/schemas/kling.py`：

```python
from app.schemas.kling import (
    # 视频生成
    Text2VideoRequest,
    Image2VideoRequest,
    MultiImage2VideoRequest,
    MotionControlRequest,
    VideoExtendRequest,
    
    # 口型同步
    IdentifyFaceRequest,
    LipSyncRequest,
    FaceChoose,
    
    # 图像生成
    GenerateImageRequest,
    OmniImageRequest,
    
    # 响应
    TaskResponse,
    TaskQueryResponse,
    FaceIdentifyResponse,
    
    # 枚举
    ModelName,
    Mode,
    AspectRatio,
    TaskStatus,
    CameraControlType,
)
```

### 5.1 Base64 自动清洗

所有图片/音频字段会自动清洗 `data:xxx;base64,` 前缀：

```python
from app.schemas.kling import Image2VideoRequest

# 前端可以直接传带前缀的 Base64
request = Image2VideoRequest(
    image="data:image/jpeg;base64,/9j/4AAQ..."
)
# 验证后自动变成: /9j/4AAQ...
```

---

## 6. 客户端使用

### 6.1 获取客户端

```python
from app.services.kling_client import get_kling_client

async def my_function():
    client = get_kling_client()
    
    # 文生视频
    result = await client.create_text2video({
        "prompt": "A beautiful sunset",
        "duration": "5"
    })
    
    # 查询任务
    task = await client.get_text2video_task(result["data"]["task_id"])
```

### 6.2 生命周期管理

在 FastAPI 应用中：

```python
from app.services.kling_client import close_kling_client

@app.on_event("shutdown")
async def shutdown_event():
    await close_kling_client()
```

---

## 7. 错误处理

### 7.1 常见错误码

| 错误码 | 描述 | 解决方案 |
|--------|------|----------|
| 401 | 认证失败 | 检查 AK/SK 或 Token 配置 |
| 400 | 参数错误 | 检查请求参数格式 |
| 429 | 请求过于频繁 | 降低请求频率 |
| 500 | 服务器错误 | 重试或联系支持 |

### 7.2 错误响应格式

```json
{
  "code": 1001,
  "message": "Invalid parameter: prompt is required",
  "request_id": "req_xxx"
}
```

---

## 8. 计费说明

| 功能 | 积分消耗 |
|------|----------|
| AI 口型同步 | 50 积分/次 |
| AI 换脸 | 60 积分/次 |
| 图生视频 | 100 积分/次 |
| 文生视频 | 200 积分/次 |
| 运动控制 | 80 积分/次 |
| Omni 图像 | 50 积分/次 |

---

## 9. 最佳实践

1. **使用回调模式** - 避免轮询，提高效率
2. **Base64 大小限制** - 图片不超过 10MB
3. **提示词优化** - 使用详细、具体的描述
4. **错误重试** - 对于 5xx 错误使用指数退避重试
5. **任务状态检查** - 生成任务是异步的，需要查询状态

---

## 10. 相关文件

- `app/schemas/kling.py` - Pydantic 模型定义
- `app/services/kling_client.py` - HTTP 客户端
- `app/services/kling_ai_service.py` - 业务服务层
- `app/api/kling.py` - API 路由
- `app/tasks/` - Celery 异步任务
